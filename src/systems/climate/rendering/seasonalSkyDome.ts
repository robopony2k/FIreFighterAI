import * as THREE from "three";
import {
  SEASONAL_CLOUD_NOISE,
  SEASONAL_CLOUD_NOISE_CHANNELS
} from "./seasonalCloudField.js";
import {
  seasonalSkyFragmentShader,
  seasonalSkyVertexShader
} from "./seasonalCloudShader.js";
import {
  SEASONAL_CLOUD_VOLUME,
  SEASONAL_CLOUD_VOLUME_ATLAS_HEIGHT,
  SEASONAL_CLOUD_VOLUME_ATLAS_WIDTH,
  SEASONAL_CLOUD_VOLUME_CHANNELS
} from "./seasonalCloudVolume.js";
import {
  SEASONAL_SKY_CONFIG,
  type SeasonalSkyState
} from "./seasonalSkyState.js";
import type { SeasonalCloudAdvectionState } from "./seasonalCloudAdvection.js";

export type SeasonalSkyDome = {
  mesh: THREE.Mesh;
  setState: (state: SeasonalSkyState) => void;
  setCloudMotion: (state: SeasonalCloudAdvectionState) => void;
  syncToCamera: (camera: THREE.Camera) => void;
  dispose: () => void;
};

type SkyRgb = {
  r: number;
  g: number;
  b: number;
};

const rgb = (r: number, g: number, b: number): SkyRgb => ({ r, g, b });
const toThreeColor = (color: SkyRgb): THREE.Color =>
  new THREE.Color().setRGB(color.r / 255, color.g / 255, color.b / 255, THREE.SRGBColorSpace);
const setThreeColor = (target: THREE.Color, color: SkyRgb): void => {
  target.setRGB(color.r / 255, color.g / 255, color.b / 255, THREE.SRGBColorSpace);
};

const createCloudNoiseTexture = (): THREE.DataTexture => {
  const texture = new THREE.DataTexture(
    SEASONAL_CLOUD_NOISE.data,
    SEASONAL_CLOUD_NOISE.size,
    SEASONAL_CLOUD_NOISE.size,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  if (SEASONAL_CLOUD_NOISE_CHANNELS !== 4) {
    throw new Error("Seasonal cloud noise must provide four packed channels.");
  }
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;
  return texture;
};

const createCloudVolumeTexture = (): THREE.DataTexture => {
  if (SEASONAL_CLOUD_VOLUME_CHANNELS !== 4) {
    throw new Error("Seasonal cloud volume must provide four packed channels.");
  }
  const texture = new THREE.DataTexture(
    SEASONAL_CLOUD_VOLUME.atlasData,
    SEASONAL_CLOUD_VOLUME_ATLAS_WIDTH,
    SEASONAL_CLOUD_VOLUME_ATLAS_HEIGHT,
    THREE.RGBAFormat,
    THREE.UnsignedByteType
  );
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.needsUpdate = true;
  return texture;
};

export const createSeasonalSkyDome = (): SeasonalSkyDome => {
  const cloudNoiseTexture = createCloudNoiseTexture();
  const cloudVolumeTexture = createCloudVolumeTexture();
  const uniforms = {
    uCloudNoiseTex: { value: cloudNoiseTexture },
    uCloudVolumeTex: { value: cloudVolumeTexture },
    uSkyTopColor: { value: toThreeColor(rgb(82, 126, 180)) },
    uSkyHorizonColor: { value: toThreeColor(rgb(235, 206, 148)) },
    uSunColor: { value: toThreeColor(rgb(255, 229, 184)) },
    uCloudNearColor: { value: toThreeColor(rgb(243, 241, 232)) },
    uCloudFarColor: { value: toThreeColor(rgb(210, 214, 222)) },
    uSunDirection: { value: new THREE.Vector3(0.6, 0.7, 0.25).normalize() },
    uCloudNearOffset: { value: new THREE.Vector2(0, 0) },
    uCloudFarOffset: { value: new THREE.Vector2(0.19, -0.11) },
    uCloudNearScale: { value: SEASONAL_SKY_CONFIG.cloudLayerScaleNear },
    uCloudFarScale: { value: SEASONAL_SKY_CONFIG.cloudLayerScaleFar },
    uCloudCoverage: { value: 0.06 },
    uOvercastStrength: { value: 0.2 },
    uSunVisibility: { value: 1 },
    uHazeStrength: { value: SEASONAL_SKY_CONFIG.hazeStrengthSummer },
    uCloudTimeDays: { value: 0 },
    uCloudSoftness: { value: 0.8 },
    uCloudDensity: { value: 0.4 },
    uCloudBaseHeight: { value: 1.65 },
    uCloudTopHeight: { value: 4.65 },
    uCloudCumulus: { value: 0.96 },
    uCloudFootprintScale: { value: 0.8 },
    uCloudVolumeScale: { value: 1.12 },
    uCloudErosion: { value: 0.78 },
    uCloudShadowStrength: { value: 0.42 },
    uCloudFootprintThresholdBias: { value: 0.015 }
  };
  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: seasonalSkyVertexShader,
    fragmentShader: seasonalSkyFragmentShader,
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    fog: false
  });
  const geometry = new THREE.SphereGeometry(1, 48, 28);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.scale.setScalar(96);
  mesh.renderOrder = -100;
  mesh.frustumCulled = false;

  const setState = (state: SeasonalSkyState): void => {
    setThreeColor(uniforms.uSkyTopColor.value, state.skyTopColor);
    setThreeColor(uniforms.uSkyHorizonColor.value, state.skyHorizonColor);
    setThreeColor(uniforms.uSunColor.value, state.sunColor);
    setThreeColor(uniforms.uCloudNearColor.value, state.cloudNearColor);
    setThreeColor(uniforms.uCloudFarColor.value, state.cloudFarColor);
    uniforms.uSunDirection.value.copy(state.sunDirection);
    uniforms.uCloudNearOffset.value.copy(state.cloudNearOffset);
    uniforms.uCloudFarOffset.value.copy(state.cloudFarOffset);
    uniforms.uCloudNearScale.value = state.cloudNearScale;
    uniforms.uCloudFarScale.value = state.cloudFarScale;
    uniforms.uCloudCoverage.value = state.cloudCoverage;
    uniforms.uOvercastStrength.value = state.overcastStrength;
    uniforms.uSunVisibility.value = state.sunVisibility;
    uniforms.uHazeStrength.value = state.hazeStrength;
    uniforms.uCloudTimeDays.value = state.cloudTimeDays;
    uniforms.uCloudSoftness.value = state.cloudSoftness01;
    uniforms.uCloudDensity.value = state.cloudDensity01;
    uniforms.uCloudBaseHeight.value = state.cloudProfile.baseHeight;
    uniforms.uCloudTopHeight.value = state.cloudProfile.topHeight;
    uniforms.uCloudCumulus.value = state.cloudProfile.cumulus01;
    uniforms.uCloudFootprintScale.value = state.cloudProfile.footprintScale;
    uniforms.uCloudVolumeScale.value = state.cloudProfile.volumeScale;
    uniforms.uCloudErosion.value = state.cloudProfile.erosionStrength;
    uniforms.uCloudShadowStrength.value = state.cloudProfile.shadowStrength;
    uniforms.uCloudFootprintThresholdBias.value =
      state.cloudProfile.footprintThresholdBias;
  };

  const setCloudMotion = (state: SeasonalCloudAdvectionState): void => {
    uniforms.uCloudNearOffset.value.set(state.nearX, state.nearY);
    uniforms.uCloudFarOffset.value.set(state.farX, state.farY);
    uniforms.uCloudTimeDays.value = state.morphTimeDays;
  };

  const syncToCamera = (camera: THREE.Camera): void => {
    mesh.position.copy(camera.position);
    if ("far" in camera && typeof camera.far === "number" && Number.isFinite(camera.far)) {
      mesh.scale.setScalar(Math.max(48, camera.far * 0.88));
    }
  };

  const dispose = (): void => {
    geometry.dispose();
    material.dispose();
    cloudNoiseTexture.dispose();
    cloudVolumeTexture.dispose();
  };

  return {
    mesh,
    setState,
    setCloudMotion,
    syncToCamera,
    dispose
  };
};
