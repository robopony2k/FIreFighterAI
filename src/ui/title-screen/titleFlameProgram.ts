type TitleFlameProgramUniforms = {
  glyphCount: WebGLUniformLocation;
  glyphCenters: WebGLUniformLocation;
  glyphHalfWidths: WebGLUniformLocation;
  time: WebGLUniformLocation;
  wind: WebGLUniformLocation;
  emitter: WebGLUniformLocation;
};

export type TitleFlameProgram = {
  render: (
    timeSeconds: number,
    wind: number,
    glyphCount: number,
    glyphCenters: Float32Array,
    glyphHalfWidths: Float32Array
  ) => void;
  uploadEmitterMask: (pixels: Uint8Array, width: number, height: number) => void;
  destroy: () => void;
};

const compileShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create title flame shader.");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }
  const log = gl.getShaderInfoLog(shader)?.trim() || "Unknown shader compile error.";
  gl.deleteShader(shader);
  throw new Error(`Failed to compile title flame shader: ${log}`);
};

const createProgram = (
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string
): WebGLProgram => {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error("Failed to create title flame program.");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return program;
  }
  const log = gl.getProgramInfoLog(program)?.trim() || "Unknown program link error.";
  gl.deleteProgram(program);
  throw new Error(`Failed to link title flame program: ${log}`);
};

const requireUniform = (
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation => {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`Missing title flame uniform: ${name}`);
  }
  return location;
};

export const createTitleFlameProgram = (canvas: HTMLCanvasElement): TitleFlameProgram => {
  const contextAttributes: WebGLContextAttributes & {
    powerPreference?: WebGLPowerPreference;
  } = {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: "high-performance"
  };
  const gl = (
    canvas.getContext("webgl", contextAttributes)
    ?? canvas.getContext("experimental-webgl", contextAttributes)
  ) as WebGLRenderingContext | null;
  if (!gl) {
    throw new Error("WebGL is unavailable for the title flame program.");
  }

  const vertexSource = `
    attribute vec2 a_position;
    varying vec2 v_uv;

    void main() {
      v_uv = a_position * 0.5 + 0.5;
      gl_Position = vec4(a_position, 0.0, 1.0);
    }
  `;

  const fragmentSource = `
    #ifdef GL_FRAGMENT_PRECISION_HIGH
    precision highp float;
    #else
    precision mediump float;
    #endif

    varying vec2 v_uv;

    uniform int u_glyphCount;
    uniform float u_glyphCenters[16];
    uniform float u_glyphHalfWidths[16];
    uniform float u_time;
    uniform float u_wind;
    uniform sampler2D u_emitter;

    vec2 hash(vec2 p) {
      p = vec2(
        dot(p, vec2(127.1, 311.7)),
        dot(p, vec2(269.5, 183.3))
      );
      return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
    }

    float noise(in vec2 p) {
      const float K1 = 0.366025404;
      const float K2 = 0.211324865;

      vec2 i = floor(p + (p.x + p.y) * K1);
      vec2 a = p - i + (i.x + i.y) * K2;
      vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
      vec2 b = a - o + K2;
      vec2 c = a - 1.0 + 2.0 * K2;

      vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
      vec3 n = h * h * h * h * vec3(
        dot(a, hash(i + 0.0)),
        dot(b, hash(i + o)),
        dot(c, hash(i + 1.0))
      );

      return dot(n, vec3(70.0));
    }

    float fbm(vec2 uv) {
      float f = 0.0;
      mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
      f += 0.5000 * noise(uv); uv = m * uv;
      f += 0.2500 * noise(uv); uv = m * uv;
      f += 0.1250 * noise(uv); uv = m * uv;
      f += 0.0625 * noise(uv);
      return 0.5 + 0.5 * f;
    }

    void main() {
      vec2 uv = v_uv;
      float glyphCenter = u_glyphCenters[0];
      float glyphHalfWidth = max(u_glyphHalfWidths[0], 0.001);
      float strength = 1.0;
      float minDist = 999.0;
      for (int i = 0; i < 16; i++) {
        if (i >= u_glyphCount) {
          break;
        }
        float center = u_glyphCenters[i];
        float dist = abs(uv.x - center);
        if (dist < minDist) {
          minDist = dist;
          glyphCenter = center;
          glyphHalfWidth = max(u_glyphHalfWidths[i], 0.001);
          strength = float(i + 1);
        }
      }
      float bandWarp = sin(uv.y * 6.4 + glyphCenter * 31.0 + u_time * 1.18) * 0.09 * glyphHalfWidth * uv.y;
      float qx = ((uv.x - glyphCenter) + bandWarp + u_wind * uv.y * uv.y * glyphHalfWidth * 0.9)
        / max(glyphHalfWidth * 4.2, 0.001);
      vec2 q = vec2(qx * (0.78 + uv.y * 0.06), uv.y * 1.56 - 0.31);
      float flameTime = max(3.0, 1.25 * strength) * u_time;
      float n = fbm(strength * q - vec2(0.0, flameTime));
      float c = 1.0 - 14.0 * pow(
        max(0.0, length(q * vec2(1.18 + q.y * 0.96, 0.58)) - n * max(0.0, q.y + 0.38)),
        1.12
      );
      float c1 = n * c * (1.62 - pow(2.05 * uv.y, 3.5));
      float emitter = texture2D(u_emitter, vec2(uv.x, 1.0 - uv.y)).r;
      c1 = clamp(c1 * (0.88 + emitter * 0.78), 0.0, 1.0);

      vec3 col = vec3(1.5 * c1, 1.5 * c1 * c1 * c1, pow(c1, 6.0));
      float alpha = clamp(c * (1.0 - pow(uv.y, 2.2)) * (0.52 + c1 * 0.96), 0.0, 1.0);
      gl_FragColor = vec4(col, alpha);
    }
  `;

  const program = createProgram(gl, vertexSource, fragmentSource);
  const positionLocation = gl.getAttribLocation(program, "a_position");
  if (positionLocation < 0) {
    gl.deleteProgram(program);
    throw new Error("Missing title flame position attribute.");
  }

  const uniforms: TitleFlameProgramUniforms = {
    glyphCount: requireUniform(gl, program, "u_glyphCount"),
    glyphCenters: requireUniform(gl, program, "u_glyphCenters[0]"),
    glyphHalfWidths: requireUniform(gl, program, "u_glyphHalfWidths[0]"),
    time: requireUniform(gl, program, "u_time"),
    wind: requireUniform(gl, program, "u_wind"),
    emitter: requireUniform(gl, program, "u_emitter")
  };

  const quadBuffer = gl.createBuffer();
  if (!quadBuffer) {
    gl.deleteProgram(program);
    throw new Error("Failed to allocate title flame quad buffer.");
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1
    ]),
    gl.STATIC_DRAW
  );

  const emitterTexture = gl.createTexture();
  if (!emitterTexture) {
    gl.deleteBuffer(quadBuffer);
    gl.deleteProgram(program);
    throw new Error("Failed to allocate title flame emitter texture.");
  }

  gl.bindTexture(gl.TEXTURE_2D, emitterTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);

  return {
    render: (
      timeSeconds: number,
      wind: number,
      glyphCount: number,
      glyphCenters: Float32Array,
      glyphHalfWidths: Float32Array
    ): void => {
      if (canvas.width === 0 || canvas.height === 0) {
        return;
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, emitterTexture);
      gl.uniform1i(uniforms.glyphCount, glyphCount);
      gl.uniform1fv(uniforms.glyphCenters, glyphCenters);
      gl.uniform1fv(uniforms.glyphHalfWidths, glyphHalfWidths);
      gl.uniform1f(uniforms.time, timeSeconds);
      gl.uniform1f(uniforms.wind, wind);
      gl.uniform1i(uniforms.emitter, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    uploadEmitterMask: (pixels: Uint8Array, width: number, height: number): void => {
      gl.bindTexture(gl.TEXTURE_2D, emitterTexture);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, pixels);
    },
    destroy: (): void => {
      gl.deleteTexture(emitterTexture);
      gl.deleteBuffer(quadBuffer);
      gl.deleteProgram(program);
    }
  };
};
