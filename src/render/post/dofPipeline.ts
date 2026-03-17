import * as THREE from "three";
import { createFullscreenPass, fullscreenVertexShader } from "./fullscreenPass.js";
import { createThreeTestCinematicGradePass, type ThreeTestCinematicGradeConfig } from "./cinematicGradePass.js";
import { dofBlurFragmentShader } from "./shaders/dofBlur.js";
import { dofCocFragmentShader } from "./shaders/dofCoc.js";
import { dofCompositeFragmentShader } from "./shaders/dofComposite.js";

export type DepthOfFieldFocusMode = "target" | "manual";

export type DepthOfFieldSettings = {
  enabled: boolean;
  focusMode: DepthOfFieldFocusMode;
  focusDistance: number;
  manualFocusDistance: number;
  focusRange: number;
  aperture: number;
  maxBlurRadius: number;
  blurScale: number;
  nearBlurEnabled: boolean;
};

export type ThreeTestPostPipelineStats = {
  postMs: number;
  dofMs: number;
  blurScale: number;
};

export type ThreeTestPostPipeline = {
  resize: (width: number, height: number, dpr: number) => void;
  render: (renderSceneFn: () => void) => boolean;
  setDofSettings: (settings: Partial<DepthOfFieldSettings>) => void;
  setGradeEnabled: (enabled: boolean) => void;
  setFogColor: (color: THREE.ColorRepresentation) => void;
  setHeightHazeStrength: (value: number) => void;
  setSunGlare: (x: number, y: number, intensity: number, color?: THREE.ColorRepresentation) => void;
  getStats: () => ThreeTestPostPipelineStats;
  dispose: () => void;
};

type CreateThreeTestPostPipelineOptions = {
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  gradeConfig: ThreeTestCinematicGradeConfig;
  dofSettings: DepthOfFieldSettings;
  gradeEnabled: boolean;
};

const FULL_RES_TARGET_MIN = 1;
const DOF_DEPTH_REJECT_SCALE = 0.2;

const disposeRenderTarget = (target: THREE.WebGLRenderTarget | null): null => {
  if (!target) {
    return null;
  }
  target.depthTexture?.dispose();
  target.dispose();
  return null;
};

const configureColorTarget = (target: THREE.WebGLRenderTarget, name: string): THREE.WebGLRenderTarget => {
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = false;
  target.texture.name = name;
  return target;
};

const createColorTarget = (width: number, height: number, name: string): THREE.WebGLRenderTarget =>
  configureColorTarget(
    new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: false,
      stencilBuffer: false
    }),
    name
  );

const createSceneTarget = (width: number, height: number): THREE.WebGLRenderTarget => {
  const target = configureColorTarget(
    new THREE.WebGLRenderTarget(width, height, {
      depthBuffer: true,
      stencilBuffer: false
    }),
    "three-test-scene-color"
  );
  const depthTexture = new THREE.DepthTexture(width, height, THREE.UnsignedIntType);
  depthTexture.format = THREE.DepthFormat;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;
  depthTexture.name = "three-test-scene-depth";
  target.depthTexture = depthTexture;
  return target;
};

export const createThreeTestPostPipeline = (
  options: CreateThreeTestPostPipelineOptions
): ThreeTestPostPipeline => {
  const { renderer, camera, gradeConfig } = options;
  let gradeEnabled = options.gradeEnabled;
  let dofSettings: DepthOfFieldSettings = {
    ...options.dofSettings
  };
  const stats: ThreeTestPostPipelineStats = {
    postMs: 0,
    dofMs: 0,
    blurScale: dofSettings.blurScale
  };

  const gradePass = createThreeTestCinematicGradePass(gradeConfig);
  gradePass.setEnabled(gradeEnabled);

  const cocUniforms = {
    uDepthTex: { value: null as THREE.DepthTexture | null },
    uFocusDistance: { value: 10 },
    uFocusRange: { value: 12 },
    uAperture: { value: 1 },
    uCameraNear: { value: camera.near },
    uCameraFar: { value: camera.far }
  };
  const cocPass = createFullscreenPass(
    new THREE.ShaderMaterial({
      uniforms: cocUniforms,
      vertexShader: fullscreenVertexShader,
      fragmentShader: dofCocFragmentShader,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    })
  );

  const blurUniforms = {
    uInputTex: { value: null as THREE.Texture | null },
    uCocTex: { value: null as THREE.Texture | null },
    uDepthTex: { value: null as THREE.DepthTexture | null },
    uInvResolution: { value: new THREE.Vector2(1, 1) },
    uBlurDirection: { value: new THREE.Vector2(1, 0) },
    uBlurScale: { value: dofSettings.blurScale },
    uMaxBlurRadius: { value: dofSettings.maxBlurRadius },
    uBlurSign: { value: 1 },
    uDepthRejectDistance: { value: Math.max(1.5, dofSettings.focusRange * DOF_DEPTH_REJECT_SCALE) },
    uCameraNear: { value: camera.near },
    uCameraFar: { value: camera.far }
  };
  const blurPass = createFullscreenPass(
    new THREE.ShaderMaterial({
      uniforms: blurUniforms,
      vertexShader: fullscreenVertexShader,
      fragmentShader: dofBlurFragmentShader,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    })
  );

  const compositeUniforms = {
    uSceneTex: { value: null as THREE.Texture | null },
    uCocTex: { value: null as THREE.Texture | null },
    uFarBlurTex: { value: null as THREE.Texture | null },
    uNearBlurTex: { value: null as THREE.Texture | null },
    uNearBlurEnabled: { value: dofSettings.nearBlurEnabled ? 1 : 0 }
  };
  const compositePass = createFullscreenPass(
    new THREE.ShaderMaterial({
      uniforms: compositeUniforms,
      vertexShader: fullscreenVertexShader,
      fragmentShader: dofCompositeFragmentShader,
      depthWrite: false,
      depthTest: false,
      toneMapped: false
    })
  );

  let viewportWidth = 1;
  let viewportHeight = 1;
  let viewportDpr = 1;
  let sceneTarget: THREE.WebGLRenderTarget | null = null;
  let cocTarget: THREE.WebGLRenderTarget | null = null;
  let farBlurTargetA: THREE.WebGLRenderTarget | null = null;
  let farBlurTargetB: THREE.WebGLRenderTarget | null = null;
  let nearBlurTargetA: THREE.WebGLRenderTarget | null = null;
  let nearBlurTargetB: THREE.WebGLRenderTarget | null = null;
  let compositeTarget: THREE.WebGLRenderTarget | null = null;
  let sceneTargetsDirty = true;
  let dofTargetsDirty = true;
  let postFailed = false;
  let dofFailed = false;
  let postWarnIssued = false;
  let dofWarnIssued = false;

  const disposeSceneTargets = (): void => {
    sceneTarget = disposeRenderTarget(sceneTarget);
    sceneTargetsDirty = true;
  };

  const disposeDofTargets = (): void => {
    cocTarget = disposeRenderTarget(cocTarget);
    farBlurTargetA = disposeRenderTarget(farBlurTargetA);
    farBlurTargetB = disposeRenderTarget(farBlurTargetB);
    nearBlurTargetA = disposeRenderTarget(nearBlurTargetA);
    nearBlurTargetB = disposeRenderTarget(nearBlurTargetB);
    compositeTarget = disposeRenderTarget(compositeTarget);
    dofTargetsDirty = true;
  };

  const failPost = (error: unknown): void => {
    if (!postWarnIssued) {
      console.warn("[threeTest] Post pipeline disabled; falling back to direct scene render.", error);
      postWarnIssued = true;
    }
    postFailed = true;
    gradeEnabled = false;
    dofSettings.enabled = false;
    gradePass.setEnabled(false);
    disposeSceneTargets();
    disposeDofTargets();
  };

  const failDof = (error: unknown): void => {
    if (!dofWarnIssued) {
      console.warn("[threeTest] DOF disabled; continuing with non-DOF post.", error);
      dofWarnIssued = true;
    }
    dofFailed = true;
    dofSettings.enabled = false;
    stats.dofMs = 0;
    disposeDofTargets();
  };

  const resolveFullResolution = (): { width: number; height: number } => ({
    width: Math.max(FULL_RES_TARGET_MIN, Math.round(viewportWidth * viewportDpr)),
    height: Math.max(FULL_RES_TARGET_MIN, Math.round(viewportHeight * viewportDpr))
  });

  const resolveBlurResolution = (): { width: number; height: number } => {
    const fullRes = resolveFullResolution();
    const scale = THREE.MathUtils.clamp(dofSettings.blurScale, 0.25, 1);
    return {
      width: Math.max(FULL_RES_TARGET_MIN, Math.round(fullRes.width * scale)),
      height: Math.max(FULL_RES_TARGET_MIN, Math.round(fullRes.height * scale))
    };
  };

  const ensureSceneTarget = (): boolean => {
    if (postFailed) {
      return false;
    }
    if (!sceneTargetsDirty && sceneTarget) {
      return true;
    }
    disposeSceneTargets();
    try {
      const size = resolveFullResolution();
      sceneTarget = createSceneTarget(size.width, size.height);
      sceneTargetsDirty = false;
      return true;
    } catch (error) {
      failPost(error);
      return false;
    }
  };

  const ensureDofTargets = (): boolean => {
    if (!dofSettings.enabled || dofFailed) {
      return false;
    }
    if (!sceneTarget && !ensureSceneTarget()) {
      return false;
    }
    if (!dofTargetsDirty && cocTarget && farBlurTargetA && farBlurTargetB && compositeTarget) {
      if (!dofSettings.nearBlurEnabled || (nearBlurTargetA && nearBlurTargetB)) {
        return true;
      }
    }
    disposeDofTargets();
    try {
      const fullSize = resolveFullResolution();
      const blurSize = resolveBlurResolution();
      cocTarget = createColorTarget(fullSize.width, fullSize.height, "three-test-dof-coc");
      farBlurTargetA = createColorTarget(blurSize.width, blurSize.height, "three-test-dof-far-a");
      farBlurTargetB = createColorTarget(blurSize.width, blurSize.height, "three-test-dof-far-b");
      if (dofSettings.nearBlurEnabled) {
        nearBlurTargetA = createColorTarget(blurSize.width, blurSize.height, "three-test-dof-near-a");
        nearBlurTargetB = createColorTarget(blurSize.width, blurSize.height, "three-test-dof-near-b");
      } else {
        nearBlurTargetA = null;
        nearBlurTargetB = null;
      }
      compositeTarget = createColorTarget(fullSize.width, fullSize.height, "three-test-dof-composite");
      dofTargetsDirty = false;
      return true;
    } catch (error) {
      failDof(error);
      return false;
    }
  };

  const updateCameraUniforms = (): void => {
    cocUniforms.uCameraNear.value = camera.near;
    cocUniforms.uCameraFar.value = camera.far;
    blurUniforms.uCameraNear.value = camera.near;
    blurUniforms.uCameraFar.value = camera.far;
  };

  const updateDofUniforms = (): void => {
    updateCameraUniforms();
    const focusDistance =
      dofSettings.focusMode === "manual"
        ? Math.max(camera.near, dofSettings.manualFocusDistance)
        : Math.max(camera.near, dofSettings.focusDistance);
    cocUniforms.uFocusDistance.value = focusDistance;
    cocUniforms.uFocusRange.value = Math.max(0.001, dofSettings.focusRange);
    cocUniforms.uAperture.value = Math.max(0, dofSettings.aperture);
    blurUniforms.uBlurScale.value = THREE.MathUtils.clamp(dofSettings.blurScale, 0.25, 1);
    blurUniforms.uMaxBlurRadius.value = Math.max(0, dofSettings.maxBlurRadius);
    blurUniforms.uDepthRejectDistance.value = Math.max(1.5, dofSettings.focusRange * DOF_DEPTH_REJECT_SCALE);
    compositeUniforms.uNearBlurEnabled.value = dofSettings.nearBlurEnabled ? 1 : 0;
    stats.blurScale = blurUniforms.uBlurScale.value;
  };

  const renderBlurChain = (
    inputTexture: THREE.Texture,
    sign: 1 | -1,
    horizontalTarget: THREE.WebGLRenderTarget,
    verticalTarget: THREE.WebGLRenderTarget
  ): THREE.Texture => {
    blurUniforms.uInputTex.value = inputTexture;
    blurUniforms.uCocTex.value = cocTarget?.texture ?? null;
    blurUniforms.uDepthTex.value = (sceneTarget?.depthTexture as THREE.DepthTexture | null) ?? null;
    blurUniforms.uBlurSign.value = sign;
    blurUniforms.uInvResolution.value.set(
      1 / Math.max(1, horizontalTarget.width),
      1 / Math.max(1, horizontalTarget.height)
    );
    blurUniforms.uBlurDirection.value.set(1, 0);
    blurPass.render(renderer, horizontalTarget);

    blurUniforms.uInputTex.value = horizontalTarget.texture;
    blurUniforms.uBlurDirection.value.set(0, 1);
    blurPass.render(renderer, verticalTarget);
    return verticalTarget.texture;
  };

  const render = (renderSceneFn: () => void): boolean => {
    if ((!gradeEnabled && !dofSettings.enabled) || postFailed) {
      stats.postMs = 0;
      stats.dofMs = 0;
      renderSceneFn();
      return !postFailed;
    }
    if (!ensureSceneTarget() || !sceneTarget) {
      stats.postMs = 0;
      stats.dofMs = 0;
      renderSceneFn();
      return false;
    }

    const previousTarget = renderer.getRenderTarget();
    const previousAutoClear = renderer.autoClear;
    const postStart = performance.now();
    let dofStart = 0;
    let finalTexture: THREE.Texture = sceneTarget.texture;

    try {
      renderer.autoClear = previousAutoClear;
      renderer.setRenderTarget(sceneTarget);
      renderSceneFn();

      if (dofSettings.enabled) {
        if (ensureDofTargets() && cocTarget && farBlurTargetA && farBlurTargetB && compositeTarget) {
          dofStart = performance.now();
          updateDofUniforms();
          cocUniforms.uDepthTex.value = (sceneTarget.depthTexture as THREE.DepthTexture | null) ?? null;
          cocPass.render(renderer, cocTarget);

          const farTexture = renderBlurChain(sceneTarget.texture, 1, farBlurTargetA, farBlurTargetB);
          compositeUniforms.uSceneTex.value = sceneTarget.texture;
          compositeUniforms.uCocTex.value = cocTarget.texture;
          compositeUniforms.uFarBlurTex.value = farTexture;
          compositeUniforms.uNearBlurTex.value = farTexture;

          if (dofSettings.nearBlurEnabled && nearBlurTargetA && nearBlurTargetB) {
            compositeUniforms.uNearBlurTex.value = renderBlurChain(sceneTarget.texture, -1, nearBlurTargetA, nearBlurTargetB);
          }

          compositePass.render(renderer, compositeTarget);
          finalTexture = compositeTarget.texture;
          stats.dofMs = performance.now() - dofStart;
        } else {
          stats.dofMs = 0;
        }
      } else {
        stats.dofMs = 0;
      }

      gradePass.render(renderer, finalTexture, previousTarget);
      stats.postMs = performance.now() - postStart;
      return true;
    } catch (error) {
      try {
        failPost(error);
      } finally {
        renderer.setRenderTarget(previousTarget);
        renderer.autoClear = previousAutoClear;
      }
      stats.postMs = 0;
      stats.dofMs = 0;
      renderSceneFn();
      return false;
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.autoClear = previousAutoClear;
    }
  };

  return {
    resize: (width, height, dpr) => {
      viewportWidth = Math.max(1, Math.floor(width));
      viewportHeight = Math.max(1, Math.floor(height));
      viewportDpr = Math.max(0.5, dpr);
      gradePass.resize(viewportWidth, viewportHeight);
      sceneTargetsDirty = true;
      dofTargetsDirty = true;
    },
    render,
    setDofSettings: (settings) => {
      const next = { ...dofSettings, ...settings };
      const blurScaleChanged = Math.abs(next.blurScale - dofSettings.blurScale) >= 0.001;
      const nearBlurChanged = next.nearBlurEnabled !== dofSettings.nearBlurEnabled;
      const enabledChanged = next.enabled !== dofSettings.enabled;
      dofSettings = next;
      if (blurScaleChanged || nearBlurChanged || enabledChanged) {
        dofTargetsDirty = true;
      }
      if (!dofSettings.enabled) {
        disposeDofTargets();
      }
      if (enabledChanged && !dofSettings.enabled && !gradeEnabled) {
        disposeSceneTargets();
      }
    },
    setGradeEnabled: (enabled) => {
      gradeEnabled = enabled;
      gradePass.setEnabled(enabled);
      if (!gradeEnabled && !dofSettings.enabled) {
        disposeSceneTargets();
      }
    },
    setFogColor: (color) => {
      gradePass.setFogColor(color);
    },
    setHeightHazeStrength: (value) => {
      gradePass.setHeightHazeStrength(value);
    },
    setSunGlare: (x, y, intensity, color) => {
      gradePass.setSunGlare(x, y, intensity, color);
    },
    getStats: () => ({
      postMs: stats.postMs,
      dofMs: stats.dofMs,
      blurScale: stats.blurScale
    }),
    dispose: () => {
      disposeSceneTargets();
      disposeDofTargets();
      gradePass.dispose();
      cocPass.dispose();
      blurPass.dispose();
      compositePass.dispose();
    }
  };
};
