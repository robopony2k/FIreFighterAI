import * as THREE from "three";
import type { TerrainWaterData } from "./threeTestTerrain.js";
import { ThreeTestOceanWaterHelper } from "./threeTestOceanWaterHelper.js";
import { ThreeTestRiverWaterHelper } from "./threeTestRiverWaterHelper.js";
import { ThreeTestWaterfallHelper } from "./threeTestWaterfallHelper.js";

export type WaterQualityProfile = "fast" | "balanced" | "high";

type ThreeTestWaterSystemOptions = {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  keyLight: THREE.DirectionalLight;
  skyTopColor: number;
  skyHorizonColor: number;
  preferredQuality: WaterQualityProfile;
};

const WATER_QUALITY_FALLBACK_FPS = 56;
const WATER_QUALITY_RECOVERY_FPS = 61;
const WATER_QUALITY_FALLBACK_SECONDS = 2.5;
const WATER_QUALITY_RECOVERY_SECONDS = 8;

const waterQualityToUniform = (quality: WaterQualityProfile): number =>
  quality === "fast" ? 0 : quality === "high" ? 2 : 1;

const disposeTexture = (texture: THREE.Texture | null): void => {
  if (!texture) {
    return;
  }
  texture.dispose();
};

export class ThreeTestWaterSystem {
  private readonly renderer: THREE.WebGLRenderer;
  private preferredQuality: WaterQualityProfile;
  private quality: WaterQualityProfile;
  private fallbackAccum = 0;
  private recoveryAccum = 0;
  private readonly oceanHelper: ThreeTestOceanWaterHelper;
  private readonly riverHelper: ThreeTestRiverWaterHelper;
  private readonly waterfallHelper: ThreeTestWaterfallHelper;

  private waterNormal1: THREE.Texture | null = null;
  private waterNormal2: THREE.Texture | null = null;
  private waterNormalLoading = false;
  private waterNormalsPending = 0;
  private readonly defaultNormal1: THREE.DataTexture;
  private readonly defaultNormal2: THREE.DataTexture;

  constructor(options: ThreeTestWaterSystemOptions) {
    this.renderer = options.renderer;
    this.preferredQuality = options.preferredQuality;
    this.quality = options.preferredQuality;
    this.defaultNormal1 = this.makeNeutralNormal();
    this.defaultNormal2 = this.makeNeutralNormal();
    this.oceanHelper = new ThreeTestOceanWaterHelper({
      scene: options.scene,
      keyLight: options.keyLight,
      skyTopColor: options.skyTopColor,
      skyHorizonColor: options.skyHorizonColor
    });
    this.riverHelper = new ThreeTestRiverWaterHelper({
      scene: options.scene,
      keyLight: options.keyLight,
      skyTopColor: options.skyTopColor,
      skyHorizonColor: options.skyHorizonColor
    });
    this.waterfallHelper = new ThreeTestWaterfallHelper({
      scene: options.scene
    });
    this.applyQualityProfile(this.quality);
  }

  private makeNeutralNormal(): THREE.DataTexture {
    const size = 2;
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i += 1) {
      const base = i * 4;
      data[base] = 128;
      data[base + 1] = 128;
      data[base + 2] = 255;
      data[base + 3] = 255;
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.needsUpdate = true;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    return tex;
  }

  private getActiveNormal1(): THREE.Texture {
    return this.waterNormal1 ?? this.defaultNormal1;
  }

  private getActiveNormal2(): THREE.Texture {
    return this.waterNormal2 ?? this.defaultNormal2;
  }

  private pushNormalMapsToHelpers(): void {
    const normal1 = this.getActiveNormal1();
    const normal2 = this.getActiveNormal2();
    this.oceanHelper.setNormalMaps(normal1, normal2);
    this.riverHelper.setNormalMaps(normal1, normal2);
  }

  private ensureWaterNormals(): void {
    if (this.waterNormalLoading || (this.waterNormal1 && this.waterNormal2)) {
      return;
    }
    this.waterNormalLoading = true;
    this.waterNormalsPending = 2;
    const loader = new THREE.TextureLoader();
    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const markDone = (): void => {
      this.waterNormalsPending = Math.max(0, this.waterNormalsPending - 1);
      if (this.waterNormalsPending === 0) {
        this.waterNormalLoading = false;
      }
    };
    loader.load(
      "assets/textures/water1.png",
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = maxAniso;
        tex.generateMipmaps = false;
        this.waterNormal1 = tex;
        this.pushNormalMapsToHelpers();
        markDone();
      },
      undefined,
      () => markDone()
    );
    loader.load(
      "assets/textures/water2.png",
      (tex) => {
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.minFilter = THREE.LinearFilter;
        tex.magFilter = THREE.LinearFilter;
        tex.anisotropy = maxAniso;
        tex.generateMipmaps = false;
        this.waterNormal2 = tex;
        this.pushNormalMapsToHelpers();
        markDone();
      },
      undefined,
      () => markDone()
    );
  }

  private applyQualityProfile(next: WaterQualityProfile): void {
    this.quality = next;
    const qualityValue = waterQualityToUniform(next);
    this.oceanHelper.setQuality(qualityValue);
    this.riverHelper.setQuality(qualityValue);
    this.waterfallHelper.setQuality(qualityValue);
  }

  public setPreferredQuality(next: WaterQualityProfile): void {
    this.preferredQuality = next;
    this.applyQualityProfile(next);
    this.fallbackAccum = 0;
    this.recoveryAccum = 0;
  }

  public update(timeMs: number, dtSeconds: number, fpsEstimate: number, sceneRenderMs: number): void {
    this.oceanHelper.update(timeMs);
    this.riverHelper.update(timeMs);
    this.waterfallHelper.update(timeMs);
    if (!(dtSeconds > 0) || !Number.isFinite(fpsEstimate) || fpsEstimate <= 0) {
      return;
    }
    if (this.quality !== "fast") {
      if (fpsEstimate < WATER_QUALITY_FALLBACK_FPS) {
        this.fallbackAccum += dtSeconds;
      } else {
        this.fallbackAccum = Math.max(0, this.fallbackAccum - dtSeconds * 0.6);
      }
      if (this.fallbackAccum >= WATER_QUALITY_FALLBACK_SECONDS) {
        this.applyQualityProfile("fast");
        this.fallbackAccum = 0;
        this.recoveryAccum = 0;
      }
      return;
    }
    if (this.preferredQuality === "fast") {
      return;
    }
    if (fpsEstimate > WATER_QUALITY_RECOVERY_FPS && sceneRenderMs < 14) {
      this.recoveryAccum += dtSeconds;
    } else {
      this.recoveryAccum = Math.max(0, this.recoveryAccum - dtSeconds * 0.7);
    }
    if (this.recoveryAccum >= WATER_QUALITY_RECOVERY_SECONDS) {
      this.applyQualityProfile(this.preferredQuality);
      this.recoveryAccum = 0;
      this.fallbackAccum = 0;
    }
  }

  public setLightDirectionFromKeyLight(): void {
    this.oceanHelper.setLightDirectionFromKeyLight();
    this.riverHelper.setLightDirectionFromKeyLight();
  }

  public clear(): void {
    this.oceanHelper.clear();
    this.riverHelper.clear();
    this.waterfallHelper.clear();
  }

  public dispose(): void {
    this.clear();
    this.oceanHelper.dispose();
    this.riverHelper.dispose();
    this.waterfallHelper.dispose();
    disposeTexture(this.waterNormal1);
    disposeTexture(this.waterNormal2);
    this.waterNormal1 = null;
    this.waterNormal2 = null;
    this.defaultNormal1.dispose();
    this.defaultNormal2.dispose();
  }

  public rebuild(baseMesh: THREE.Mesh, water: TerrainWaterData): void {
    this.clear();
    this.pushNormalMapsToHelpers();
    this.ensureWaterNormals();
    const qualityValue = waterQualityToUniform(this.quality);
    this.oceanHelper.rebuild(baseMesh, water.ocean, qualityValue);
    if (water.river) {
      this.riverHelper.rebuild(baseMesh, water.river, qualityValue);
    } else {
      this.riverHelper.clear();
    }
    this.waterfallHelper.rebuild(baseMesh, water.ocean.level, water.waterfallInstances, qualityValue);
    this.applyQualityProfile(this.quality);
  }
}

