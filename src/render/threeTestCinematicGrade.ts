import * as THREE from "three";

export type ThreeTestCinematicGradeConfig = {
  contrast: number;
  midtoneDesaturation: number;
  vignetteStrength: number;
  vignetteSoftness: number;
  warmHighlightStrength: number;
  heightHazeStrength: number;
  heightHazeHorizon: number;
  heightHazeCurve: number;
  fogColor: THREE.ColorRepresentation;
};

export type ThreeTestCinematicGrade = {
  resize: (width: number, height: number, dpr: number) => void;
  renderSceneToScreen: (renderSceneFn: () => void) => boolean;
  setEnabled: (enabled: boolean) => void;
  setFogColor: (color: THREE.ColorRepresentation) => void;
  dispose: () => void;
};

const fullscreenVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const fullscreenFragmentShader = `
  uniform sampler2D uSceneTex;
  uniform vec3 uFogColor;
  uniform float uContrast;
  uniform float uMidtoneDesaturation;
  uniform float uVignetteStrength;
  uniform float uVignetteSoftness;
  uniform float uWarmHighlightStrength;
  uniform float uHeightHazeStrength;
  uniform float uHeightHazeHorizon;
  uniform float uHeightHazeCurve;

  varying vec2 vUv;

  float luma(vec3 color) {
    return dot(color, vec3(0.299, 0.587, 0.114));
  }

  void main() {
    vec4 src = texture2D(uSceneTex, vUv);
    vec3 color = src.rgb;

    color = (color - 0.5) * uContrast + 0.5;

    float y = luma(color);
    float midtoneMask = max(0.0, 1.0 - abs(y * 2.0 - 1.0));
    color = mix(color, vec3(y), uMidtoneDesaturation * midtoneMask);

    float highlight = smoothstep(0.66, 1.0, y);
    color += vec3(1.0, 0.48, 0.2) * (highlight * uWarmHighlightStrength);

    float topHaze = smoothstep(uHeightHazeHorizon, 1.0, vUv.y);
    float haze = pow(clamp(topHaze, 0.0, 1.0), max(0.01, uHeightHazeCurve)) * uHeightHazeStrength;
    color = mix(color, uFogColor, clamp(haze, 0.0, 1.0));

    vec2 centeredUv = vUv * 2.0 - 1.0;
    float edge = smoothstep(uVignetteSoftness, 1.2, length(centeredUv));
    color *= 1.0 - edge * uVignetteStrength;

    gl_FragColor = vec4(max(color, vec3(0.0)), src.a);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const createThreeTestCinematicGrade = (
  renderer: THREE.WebGLRenderer,
  config: ThreeTestCinematicGradeConfig
): ThreeTestCinematicGrade => {
  const fogColor = new THREE.Color(config.fogColor);
  const uniforms = {
    uSceneTex: { value: null as THREE.Texture | null },
    uFogColor: { value: fogColor },
    uContrast: { value: config.contrast },
    uMidtoneDesaturation: { value: config.midtoneDesaturation },
    uVignetteStrength: { value: config.vignetteStrength },
    uVignetteSoftness: { value: config.vignetteSoftness },
    uWarmHighlightStrength: { value: config.warmHighlightStrength },
    uHeightHazeStrength: { value: config.heightHazeStrength },
    uHeightHazeHorizon: { value: config.heightHazeHorizon },
    uHeightHazeCurve: { value: config.heightHazeCurve }
  };
  const postMaterial = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: fullscreenVertexShader,
    fragmentShader: fullscreenFragmentShader,
    depthWrite: false,
    depthTest: false,
    toneMapped: false
  });
  const postScene = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMaterial);
  postMesh.frustumCulled = false;
  postScene.add(postMesh);

  let enabled = false;
  let failed = false;
  let warnIssued = false;
  let viewportWidth = 1;
  let viewportHeight = 1;
  let viewportDpr = 1;
  let renderTarget: THREE.WebGLRenderTarget | null = null;

  const disposeRenderTarget = (): void => {
    if (!renderTarget) {
      return;
    }
    renderTarget.dispose();
    renderTarget = null;
  };

  const failAndDisable = (error: unknown): void => {
    if (!warnIssued) {
      console.warn("[threeTest] CinematicGrade post disabled; falling back to direct scene render.", error);
      warnIssued = true;
    }
    failed = true;
    enabled = false;
    disposeRenderTarget();
  };

  const ensureRenderTarget = (): boolean => {
    if (!enabled || failed) {
      return false;
    }
    if (renderTarget) {
      return true;
    }
    try {
      const width = Math.max(1, Math.round(viewportWidth * viewportDpr));
      const height = Math.max(1, Math.round(viewportHeight * viewportDpr));
      renderTarget = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false
      });
      renderTarget.texture.minFilter = THREE.LinearFilter;
      renderTarget.texture.magFilter = THREE.LinearFilter;
      renderTarget.texture.generateMipmaps = false;
      renderTarget.texture.name = "three-test-cinematic-grade";
      return true;
    } catch (error) {
      failAndDisable(error);
      return false;
    }
  };

  const resize = (width: number, height: number, dpr: number): void => {
    viewportWidth = Math.max(1, Math.floor(width));
    viewportHeight = Math.max(1, Math.floor(height));
    viewportDpr = Math.max(0.5, dpr);
    if (!renderTarget) {
      return;
    }
    try {
      renderTarget.setSize(
        Math.max(1, Math.round(viewportWidth * viewportDpr)),
        Math.max(1, Math.round(viewportHeight * viewportDpr))
      );
    } catch (error) {
      failAndDisable(error);
    }
  };

  const renderSceneToScreen = (renderSceneFn: () => void): boolean => {
    if (!enabled || failed || !ensureRenderTarget() || !renderTarget) {
      renderSceneFn();
      return false;
    }
    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.setRenderTarget(renderTarget);
      renderer.clear(true, true, true);
      renderSceneFn();
      uniforms.uSceneTex.value = renderTarget.texture;
      renderer.setRenderTarget(previousTarget);
      renderer.clear(true, true, true);
      renderer.render(postScene, postCamera);
      return true;
    } catch (error) {
      failAndDisable(error);
      renderSceneFn();
      return false;
    } finally {
      renderer.autoClear = previousAutoClear;
      if (renderer.getRenderTarget() !== previousTarget) {
        renderer.setRenderTarget(previousTarget);
      }
    }
  };

  const setEnabled = (nextEnabled: boolean): void => {
    enabled = nextEnabled && !failed;
    if (!enabled) {
      disposeRenderTarget();
      uniforms.uSceneTex.value = null;
    }
  };

  const setFogColor = (color: THREE.ColorRepresentation): void => {
    uniforms.uFogColor.value.set(color);
  };

  const dispose = (): void => {
    disposeRenderTarget();
    postMesh.geometry.dispose();
    postMaterial.dispose();
  };

  return {
    resize,
    renderSceneToScreen,
    setEnabled,
    setFogColor,
    dispose
  };
};
