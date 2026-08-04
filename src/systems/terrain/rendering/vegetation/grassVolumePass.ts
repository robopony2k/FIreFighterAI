import * as THREE from "three";
import {
  GRASS_PCG_MARCH_STEPS,
  grassPcgBladeFragmentShader,
  grassPcgBladeVertexShader
} from "./grassPcgBladeShader.js";
import { grassVolumeCompositeFragmentShader } from "./grassVolumeCompositeShader.js";
import { createGrassVolumeField, type GrassVolumeField, type GrassVolumeTerrainInput } from "./grassVolumeField.js";
import {
  createGrassVolumeNoiseFields,
  GRASS_VOLUME_WIND_VECTOR_RANGE
} from "./grassVolumeNoiseFields.js";
import {
  DEFAULT_GRASS_VOLUME_CONTROLS,
  grassVolumeDebugViewToUniform,
  grassVolumeFragmentShader,
  grassVolumeVertexShader,
  normalizeGrassVolumeControls,
  resolveGrassVolumeDryness,
  type GrassVolumeControls,
  type GrassVolumeVariant
} from "./grassVolumeShader.js";

export type GrassVolumePassState = {
  timeSeconds: number;
  windX: number;
  windZ: number;
  windStrength: number;
  sunDirection: THREE.Vector3;
  controls: GrassVolumeControls;
};

export type GrassVolumePassStatus = {
  supported: boolean;
  message: string;
};

export type GrassVolumePass = {
  setTerrain: (input: GrassVolumeTerrainInput | null) => void;
  render: (
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    state: GrassVolumePassState,
    renderScene: () => void
  ) => void;
  resize: () => void;
  getStatus: () => GrassVolumePassStatus;
  dispose: () => void;
};

export const GRASS_VOLUME_RENDER_SCALE = 0.60;

const configureTarget = (target: THREE.WebGLRenderTarget): THREE.WebGLRenderTarget => {
  target.texture.name = "fx-lab-grass-scene-color";
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = false;
  const depthTexture = new THREE.DepthTexture(target.width, target.height, THREE.UnsignedIntType);
  depthTexture.name = "fx-lab-grass-scene-depth";
  depthTexture.format = THREE.DepthFormat;
  depthTexture.minFilter = THREE.NearestFilter;
  depthTexture.magFilter = THREE.NearestFilter;
  target.depthTexture = depthTexture;
  return target;
};

const configureGrassTarget = (target: THREE.WebGLRenderTarget): THREE.WebGLRenderTarget => {
  target.texture.name = "fx-lab-grass-volume-layer";
  target.texture.colorSpace = THREE.NoColorSpace;
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = false;
  return target;
};

export const createGrassVolumePass = (renderer: THREE.WebGLRenderer): GrassVolumePass => {
  const grassUniforms = {
    uSceneDepth: { value: null as THREE.DepthTexture | null },
    uTerrainField: { value: null as THREE.DataTexture | null },
    uWindField: { value: null as THREE.Texture | null },
    uVariationField: { value: null as THREE.Texture | null },
    uFieldSize: { value: new THREE.Vector2(1, 1) },
    uWorldSize: { value: new THREE.Vector2(1, 1) },
    uHeightRange: { value: new THREE.Vector2(0, 1) },
    uFieldCellWorldSize: { value: 1 },
    uProjectionScale: { value: 1 },
    uWindVectorRange: { value: GRASS_VOLUME_WIND_VECTOR_RANGE },
    uCameraPosition: { value: new THREE.Vector3() },
    uInverseViewProjection: { value: new THREE.Matrix4() },
    uSunDirection: { value: new THREE.Vector3(1, 1, 1).normalize() },
    uDryness: { value: DEFAULT_GRASS_VOLUME_CONTROLS.dryness },
    uGrassLength: { value: DEFAULT_GRASS_VOLUME_CONTROLS.grassLength },
    uDensity: { value: DEFAULT_GRASS_VOLUME_CONTROLS.density },
    uWindResponse: { value: DEFAULT_GRASS_VOLUME_CONTROLS.windResponse },
    uDebugView: { value: 0 }
  };
  const grassMaterial = new THREE.ShaderMaterial({
    uniforms: grassUniforms,
    vertexShader: grassVolumeVertexShader,
    fragmentShader: grassVolumeFragmentShader,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    toneMapped: false
  });
  const pcgBladeMaterial = new THREE.ShaderMaterial({
    uniforms: grassUniforms,
    vertexShader: grassPcgBladeVertexShader,
    fragmentShader: grassPcgBladeFragmentShader,
    glslVersion: THREE.GLSL3,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    toneMapped: false
  });
  const compositeUniforms = {
    uSceneColor: { value: null as THREE.Texture | null },
    uGrassLayer: { value: null as THREE.Texture | null }
  };
  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: compositeUniforms,
    vertexShader: grassVolumeVertexShader,
    fragmentShader: grassVolumeCompositeFragmentShader,
    depthTest: false,
    depthWrite: false,
    transparent: false,
    toneMapped: false
  });
  const geometry = new THREE.PlaneGeometry(2, 2);
  const grassMesh = new THREE.Mesh(geometry, grassMaterial);
  grassMesh.frustumCulled = false;
  const grassScene = new THREE.Scene();
  grassScene.add(grassMesh);
  const compositeMesh = new THREE.Mesh(geometry, compositeMaterial);
  compositeMesh.frustumCulled = false;
  const compositeScene = new THREE.Scene();
  compositeScene.add(compositeMesh);
  const overlayCamera = new THREE.Camera();
  const drawingBufferSize = new THREE.Vector2();
  const inverseViewProjection = new THREE.Matrix4();
  const noiseFields = createGrassVolumeNoiseFields();
  let terrainField: GrassVolumeField | null = null;
  let sceneTarget: THREE.WebGLRenderTarget | null = null;
  let grassTarget: THREE.WebGLRenderTarget | null = null;
  let targetInvalidated = true;
  let disposed = false;
  let allocationFailed = false;
  let noiseFieldFailed = false;
  let activeVariant: GrassVolumeVariant = DEFAULT_GRASS_VOLUME_CONTROLS.variant;
  let variantFallback = false;
  let warned = false;
  const depthSupported = renderer.capabilities.isWebGL2 || renderer.extensions.has("WEBGL_depth_texture");

  const warnOnce = (message: string, error?: unknown): void => {
    if (warned) return;
    warned = true;
    console.warn(`[grassVolume] ${message}`, error ?? "");
  };

  const disposeTargets = (): void => {
    sceneTarget?.depthTexture?.dispose();
    sceneTarget?.dispose();
    sceneTarget = null;
    grassTarget?.dispose();
    grassTarget = null;
  };

  const ensureTargets = (): THREE.WebGLRenderTarget | null => {
    if (!depthSupported || allocationFailed || disposed) return null;
    renderer.getDrawingBufferSize(drawingBufferSize);
    const width = Math.max(1, Math.floor(drawingBufferSize.x));
    const height = Math.max(1, Math.floor(drawingBufferSize.y));
    const grassWidth = Math.max(1, Math.round(width * GRASS_VOLUME_RENDER_SCALE));
    const grassHeight = Math.max(1, Math.round(height * GRASS_VOLUME_RENDER_SCALE));
    if (
      !targetInvalidated
      && sceneTarget?.width === width
      && sceneTarget.height === height
      && grassTarget?.width === grassWidth
      && grassTarget.height === grassHeight
    ) return sceneTarget;
    disposeTargets();
    try {
      sceneTarget = configureTarget(new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false
      }));
      grassTarget = configureGrassTarget(new THREE.WebGLRenderTarget(grassWidth, grassHeight, {
        depthBuffer: false,
        stencilBuffer: false,
        type: THREE.UnsignedByteType,
        format: THREE.RGBAFormat
      }));
      targetInvalidated = false;
      return sceneTarget;
    } catch (error) {
      disposeTargets();
      allocationFailed = true;
      warnOnce("Full-resolution colour/depth target allocation failed; rendering the normal scene.", error);
      return null;
    }
  };

  return {
    setTerrain: (input) => {
      terrainField?.dispose();
      terrainField = null;
      grassUniforms.uTerrainField.value = null;
      if (!input) return;
      terrainField = createGrassVolumeField(input);
      grassUniforms.uTerrainField.value = terrainField.texture;
      grassUniforms.uFieldSize.value.set(terrainField.sampleCols, terrainField.sampleRows);
      grassUniforms.uWorldSize.value.set(terrainField.width, terrainField.depth);
      grassUniforms.uHeightRange.value.set(terrainField.minHeight, terrainField.maxHeight);
      grassUniforms.uFieldCellWorldSize.value = Math.max(
        terrainField.width / Math.max(1, terrainField.sampleCols - 1),
        terrainField.depth / Math.max(1, terrainField.sampleRows - 1)
      );
      noiseFields.setWorldSize(terrainField.width, terrainField.depth);
    },
    render: (activeRenderer, camera, state, renderScene) => {
      const controls = normalizeGrassVolumeControls(state.controls);
      const requestedPcg = controls.variant === "pcg-sdf";
      const usePcg = requestedPcg && renderer.capabilities.isWebGL2;
      activeVariant = usePcg ? "pcg-sdf" : "volume-clumps";
      variantFallback = requestedPcg && !usePcg;
      grassMesh.material = usePcg ? pcgBladeMaterial : grassMaterial;
      const target = controls.enabled && terrainField ? ensureTargets() : null;
      if (!target || !grassTarget) {
        renderScene();
        return;
      }
      if (!noiseFields.update(
        activeRenderer,
        state.timeSeconds * controls.windSpeed,
        state.windX,
        state.windZ,
        state.windStrength
      )) {
        noiseFieldFailed = true;
        renderScene();
        return;
      }
      camera.updateMatrixWorld();
      inverseViewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse).invert();
      grassUniforms.uCameraPosition.value.copy(camera.position);
      grassUniforms.uInverseViewProjection.value.copy(inverseViewProjection);
      grassUniforms.uWindField.value = noiseFields.getWindTexture();
      grassUniforms.uVariationField.value = noiseFields.getVariationTexture();
      grassUniforms.uProjectionScale.value = grassTarget.height * 0.5 * camera.projectionMatrix.elements[5];
      grassUniforms.uSunDirection.value.copy(state.sunDirection).normalize();
      grassUniforms.uDryness.value = resolveGrassVolumeDryness(controls, state.timeSeconds);
      grassUniforms.uGrassLength.value = controls.grassLength;
      grassUniforms.uDensity.value = controls.density;
      grassUniforms.uWindResponse.value = controls.windResponse;
      grassUniforms.uDebugView.value = grassVolumeDebugViewToUniform(controls.debugView);

      const previousTarget = activeRenderer.getRenderTarget();
      try {
        activeRenderer.setRenderTarget(target);
        renderScene();
        grassUniforms.uSceneDepth.value = target.depthTexture as THREE.DepthTexture;
        activeRenderer.setRenderTarget(grassTarget);
        activeRenderer.render(grassScene, overlayCamera);
        compositeUniforms.uSceneColor.value = target.texture;
        compositeUniforms.uGrassLayer.value = grassTarget.texture;
        activeRenderer.setRenderTarget(previousTarget);
        activeRenderer.render(compositeScene, overlayCamera);
      } catch (error) {
        allocationFailed = true;
        warnOnce("Grass rendering failed; subsequent frames will use the normal scene.", error);
        activeRenderer.setRenderTarget(previousTarget);
        renderScene();
      } finally {
        activeRenderer.setRenderTarget(previousTarget);
      }
    },
    resize: () => {
      targetInvalidated = true;
    },
    getStatus: () => {
      if (!depthSupported) return { supported: false, message: "Depth textures are unavailable; normal scene fallback active." };
      if (allocationFailed) return { supported: false, message: "Grass target failed; normal scene fallback active." };
      if (noiseFieldFailed) return { supported: false, message: "Grass field cache failed; normal scene fallback active." };
      if (!terrainField) return { supported: true, message: "Waiting for terrain field." };
      if (variantFallback) {
        return { supported: true, message: "PCG SDF blades require WebGL2; Volume Clumps fallback active." };
      }
      if (activeVariant === "pcg-sdf") {
        return {
          supported: true,
          message: `60% PCG SDF grass ready (${GRASS_PCG_MARCH_STEPS}-step ceiling, ${noiseFields.getResolution()}px field cache).`
        };
      }
      return {
        supported: true,
        message: `60% stabilized 96/64/40-step grass ready (${noiseFields.getResolution()}px field cache).`
      };
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      terrainField?.dispose();
      terrainField = null;
      noiseFields.dispose();
      disposeTargets();
      geometry.dispose();
      grassMaterial.dispose();
      pcgBladeMaterial.dispose();
      compositeMaterial.dispose();
    }
  };
};
