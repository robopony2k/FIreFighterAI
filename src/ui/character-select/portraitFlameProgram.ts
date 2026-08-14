import type { PortraitFlameDynamics } from "./portraitFlameDynamics.js";

type PortraitFlameProgramUniforms = {
  time: WebGLUniformLocation;
  wind: WebGLUniformLocation;
  flameHeight: WebGLUniformLocation;
  emitterCount: WebGLUniformLocation;
  heat: WebGLUniformLocation;
  opacity: WebGLUniformLocation;
  turbulence: WebGLUniformLocation;
  wallBlend: WebGLUniformLocation;
};

export type PortraitFlameProgram = {
  render: (timeSeconds: number, wind: number, dynamics: PortraitFlameDynamics) => void;
  destroy: () => void;
};

const compileShader = (gl: WebGLRenderingContext, type: number, source: string): WebGLShader => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create portrait flame shader.");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }
  const log = gl.getShaderInfoLog(shader)?.trim() || "Unknown shader compile error.";
  gl.deleteShader(shader);
  throw new Error(`Failed to compile portrait flame shader: ${log}`);
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
    throw new Error("Failed to create portrait flame program.");
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
  throw new Error(`Failed to link portrait flame program: ${log}`);
};

const requireUniform = (
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  name: string
): WebGLUniformLocation => {
  const location = gl.getUniformLocation(program, name);
  if (!location) {
    throw new Error(`Missing portrait flame uniform: ${name}`);
  }
  return location;
};

export const createPortraitFlameProgram = (canvas: HTMLCanvasElement): PortraitFlameProgram => {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    powerPreference: "high-performance"
  }) as WebGLRenderingContext | null;
  if (!gl) {
    throw new Error("WebGL is unavailable for the portrait flame program.");
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
    uniform float u_time;
    uniform float u_wind;
    uniform float u_flameHeight;
    uniform int u_emitterCount;
    uniform float u_heat;
    uniform float u_opacity;
    uniform float u_turbulence;
    uniform float u_wallBlend;

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
      float flameHeight = clamp(u_flameHeight, 0.05, 1.0);
      float localY = v_uv.y / flameHeight;
      if (localY > 1.0) {
        gl_FragColor = vec4(0.0);
        return;
      }

      float emitterCount = max(float(u_emitterCount), 1.0);
      float emitterSpacing = 1.0 / emitterCount;
      float combinedHeat = 0.0;
      float combinedShape = 0.0;
      for (int i = 0; i < 8; i++) {
        if (i >= u_emitterCount) {
          break;
        }
        float emitterIndex = float(i);
        float emitterCenter = (emitterIndex + 0.5) * emitterSpacing;
        float phase = emitterIndex * 7.31;
        float warp = sin(localY * 6.2 + phase + u_time * 1.18)
          * 0.085 * u_turbulence * localY;
        float windShear = u_wind * localY * localY * 0.055;
        float fieldX = (v_uv.x - emitterCenter) / (emitterSpacing * 1.8) + warp + windShear;
        float fieldY = localY - 0.2;
        float n = fbm(vec2(
          fieldX * (1.05 + emitterIndex * 0.025) + phase * 0.11,
          fieldY * 1.42 - u_time * (2.6 + emitterIndex * 0.09)
        ));
        float radius = length(vec2(fieldX * (1.2 + fieldY * 0.62), fieldY * 0.68));
        float shape = clamp(
          1.0 - 9.0 * pow(max(0.0, radius - n * max(0.0, fieldY + 0.34)), 1.15),
          0.0,
          1.0
        );
        float heightFade = 1.0 - smoothstep(0.78, 1.0, localY);
        float heatEnvelope = 1.35 - pow(localY, 2.6);
        float heat = clamp(n * shape * heatEnvelope * heightFade, 0.0, 1.0);
        combinedHeat = 1.0 - (1.0 - combinedHeat) * (1.0 - heat);
        combinedShape = 1.0 - (1.0 - combinedShape) * (1.0 - shape * heightFade);
      }

      float wallWarp = sin(localY * 5.1 + u_time * 1.05)
        * 0.1 * u_turbulence * localY;
      float wallNoise = fbm(vec2(
        (v_uv.x - 0.5) * 2.15 + wallWarp + u_wind * localY * localY * 0.075,
        localY * 1.5 - u_time * 2.1
      ));
      float wallTop = 0.62 + wallNoise * 0.52;
      float wallShape = 1.0 - smoothstep(wallTop - 0.12, wallTop + 0.08, localY);
      float wallHeat = clamp(
        (0.42 + wallNoise * 0.95) * wallShape * (1.25 - localY * 0.35),
        0.0,
        1.0
      );
      float unionHeat = 1.0 - (1.0 - combinedHeat) * (1.0 - wallHeat);
      float unionShape = 1.0 - (1.0 - combinedShape) * (1.0 - wallShape);
      combinedHeat = mix(combinedHeat, unionHeat, u_wallBlend);
      combinedShape = mix(combinedShape, unionShape, u_wallBlend);

      float c1 = clamp(combinedHeat * u_heat, 0.0, 1.0);
      vec3 color = vec3(
        1.5 * c1,
        1.5 * c1 * c1 * c1,
        pow(c1, 6.0)
      );
      float heatAlpha = smoothstep(0.01, 0.2, c1);
      float alpha = clamp(
        combinedShape * heatAlpha * (0.16 + c1 * 1.08) * u_opacity,
        0.0,
        1.0
      );
      gl_FragColor = vec4(color, alpha);
    }
  `;

  const program = createProgram(gl, vertexSource, fragmentSource);
  const positionLocation = gl.getAttribLocation(program, "a_position");
  if (positionLocation < 0) {
    gl.deleteProgram(program);
    throw new Error("Missing portrait flame position attribute.");
  }
  const uniforms: PortraitFlameProgramUniforms = {
    time: requireUniform(gl, program, "u_time"),
    wind: requireUniform(gl, program, "u_wind"),
    flameHeight: requireUniform(gl, program, "u_flameHeight"),
    emitterCount: requireUniform(gl, program, "u_emitterCount"),
    heat: requireUniform(gl, program, "u_heat"),
    opacity: requireUniform(gl, program, "u_opacity"),
    turbulence: requireUniform(gl, program, "u_turbulence"),
    wallBlend: requireUniform(gl, program, "u_wallBlend")
  };

  const quadBuffer = gl.createBuffer();
  if (!quadBuffer) {
    gl.deleteProgram(program);
    throw new Error("Failed to allocate portrait flame quad buffer.");
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW
  );
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 0);

  return {
    render: (timeSeconds: number, wind: number, dynamics: PortraitFlameDynamics): void => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1f(uniforms.time, timeSeconds);
      gl.uniform1f(uniforms.wind, wind);
      gl.uniform1f(uniforms.flameHeight, dynamics.flameHeight);
      gl.uniform1i(uniforms.emitterCount, Math.min(8, Math.max(0, Math.round(dynamics.emitterCount))));
      gl.uniform1f(uniforms.heat, dynamics.heat);
      gl.uniform1f(uniforms.opacity, dynamics.opacity);
      gl.uniform1f(uniforms.turbulence, dynamics.turbulence);
      gl.uniform1f(uniforms.wallBlend, dynamics.wallBlend);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
    destroy: (): void => {
      gl.deleteBuffer(quadBuffer);
      gl.deleteProgram(program);
    }
  };
};
