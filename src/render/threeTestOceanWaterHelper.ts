import * as THREE from "three";
import type { OceanWaterData } from "./threeTestTerrain.js";
import {
  DEFAULT_OCEAN_WATER_DEBUG_CONTROLS,
  normalizeOceanWaterDebugControls,
  type OceanWaterDebugControls
} from "./oceanWaterDebug.js";
import {
  createOceanSurfaceMaterial,
  type OceanUniforms
} from "./water/ocean/oceanSurfaceShader.js";

const disposeMaterial = (material: THREE.Material | THREE.Material[]): void => {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
};

const disposeTexture = (texture: THREE.Texture | null): void => {
  if (!texture) {
    return;
  }
  texture.dispose();
};

type ThreeTestOceanWaterHelperOptions = {
  scene: THREE.Scene;
  keyLight: THREE.DirectionalLight;
  skyTopColor: number;
  skyHorizonColor: number;
  fogColor: THREE.ColorRepresentation;
  fogNear: number;
  fogFar: number;
};

type OceanWaterPalette = {
  skyTopColor: THREE.ColorRepresentation;
  skyHorizonColor: THREE.ColorRepresentation;
  shallowColor: THREE.ColorRepresentation;
  deepColor: THREE.ColorRepresentation;
  sunColor: THREE.ColorRepresentation;
};

type OceanWaterFog = {
  color: THREE.ColorRepresentation;
  near: number;
  far: number;
};

type OceanBackdropEntry = {
  mesh: THREE.Mesh;
  uniforms: OceanUniforms;
  material: THREE.ShaderMaterial;
};

const DISTANT_OCEAN_EXTENSION_SCALE = 10.5;
const DISTANT_OCEAN_EXTENSION_MIN = 1400;
const DISTANT_OCEAN_EDGE_OVERLAP_STEPS = 1;
const DISTANT_OCEAN_SEGMENT_WORLD_SIZE = 220;

const createSolidTexture = (r: number, g: number, b: number, a = 255): THREE.DataTexture => {
  const texture = new THREE.DataTexture(new Uint8Array([r, g, b, a]), 1, 1, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
};

export class ThreeTestOceanWaterHelper {
  private readonly scene: THREE.Scene;
  private readonly keyLight: THREE.DirectionalLight;
  private currentPalette: {
    skyTopColor: THREE.Color;
    skyHorizonColor: THREE.Color;
    shallowColor: THREE.Color;
    deepColor: THREE.Color;
    sunColor: THREE.Color;
  };
  private fogState: {
    color: THREE.Color;
    near: number;
    far: number;
  };
  private mesh: THREE.Mesh | null = null;
  private backdropEntries: OceanBackdropEntry[] = [];
  private uniforms: OceanUniforms | null = null;
  private mask: THREE.Texture | null = null;
  private supportMap: THREE.Texture | null = null;
  private domainMap: THREE.Texture | null = null;
  private shoreSdf: THREE.Texture | null = null;
  private shoreTransitionMap: THREE.Texture | null = null;
  private flowMap: THREE.Texture | null = null;
  private rapidMap: THREE.Texture | null = null;
  private normal1: THREE.Texture | null = null;
  private normal2: THREE.Texture | null = null;
  private readonly backdropMask: THREE.DataTexture;
  private readonly backdropSupportMap: THREE.DataTexture;
  private readonly backdropDomainMap: THREE.DataTexture;
  private readonly backdropShoreSdf: THREE.DataTexture;
  private readonly backdropShoreTransitionMap: THREE.DataTexture;
  private debugControls: OceanWaterDebugControls = { ...DEFAULT_OCEAN_WATER_DEBUG_CONTROLS };

  constructor(options: ThreeTestOceanWaterHelperOptions) {
    this.scene = options.scene;
    this.keyLight = options.keyLight;
    this.currentPalette = {
      skyTopColor: new THREE.Color(options.skyTopColor),
      skyHorizonColor: new THREE.Color(options.skyHorizonColor),
      shallowColor: new THREE.Color(0x2f87c8),
      deepColor: new THREE.Color(0x1b5078),
      sunColor: new THREE.Color(0xfff0cf)
    };
    this.fogState = {
      color: new THREE.Color(options.fogColor),
      near: options.fogNear,
      far: options.fogFar
    };
    this.backdropMask = createSolidTexture(255, 255, 255, 255);
    this.backdropSupportMap = createSolidTexture(255, 255, 255, 255);
    this.backdropDomainMap = createSolidTexture(255, 0, 255, 255);
    this.backdropShoreSdf = createSolidTexture(255, 255, 255, 255);
    this.backdropShoreTransitionMap = createSolidTexture(0, 0, 0, 128);
  }

  private forEachUniformSet(visitor: (uniforms: OceanUniforms) => void): void {
    if (this.uniforms) {
      visitor(this.uniforms);
    }
    this.backdropEntries.forEach((entry) => visitor(entry.uniforms));
  }

  private applyDebugControlsToUniforms(): void {
    this.forEachUniformSet((uniforms) => {
      uniforms.u_shoreParamsA.value.set(
        this.debugControls.shoreSwashStart,
        this.debugControls.shoreSwashEnd,
        this.debugControls.shoreShoalEnd,
        this.debugControls.organicEdgeInset
      );
      uniforms.u_shoreParamsB.value.set(
        this.debugControls.swashPushMax,
        this.debugControls.swashPushFeather,
        this.debugControls.swashCoverageMin,
        this.debugControls.swashCoverageFadeEnd
      );
      uniforms.u_shoreFeatureMix.value.set(
        this.debugControls.enableOrganicEdge ? 1 : 0,
        this.debugControls.enableShorePulses ? 1 : 0,
        this.debugControls.enableTroughClamp ? 1 : 0,
        this.debugControls.enableSwashMotion ? 1 : 0
      );
      uniforms.u_shoreTuning.value.set(
        this.debugControls.enableSwashSheet ? 1 : 0,
        this.debugControls.waveAmpScale,
        this.debugControls.waveLengthScale,
        this.debugControls.shoreFoamScale
      );
      uniforms.u_shoreWaveShape.value.set(
        this.debugControls.shoreWaveAmpMinScale,
        this.debugControls.shoreWaveLengthMinScale,
        this.debugControls.enableShoreWaveModulation ? 1 : 0,
        0
      );
    });
  }

  private applyDebugVisibility(): void {
    if (this.mesh) {
      this.mesh.visible = this.debugControls.showOcean;
    }
    this.backdropEntries.forEach((entry) => {
      entry.mesh.visible = this.debugControls.showOcean;
    });
  }

  private createOceanUniforms(
    mask: THREE.Texture,
    supportMap: THREE.Texture,
    domainMap: THREE.Texture,
    shoreSdf: THREE.Texture,
    shoreTransitionMap: THREE.Texture,
    width: number,
    depth: number,
    sampleCols: number,
    sampleRows: number,
    qualityUniform: number,
    worldStepOverride?: THREE.Vector2,
    uvStepOverride?: THREE.Vector2
  ): OceanUniforms {
    const worldStep = worldStepOverride?.clone() ?? new THREE.Vector2(
      Math.max(0.1, width / Math.max(1, sampleCols - 1)),
      Math.max(0.1, depth / Math.max(1, sampleRows - 1))
    );
    const uvStep = uvStepOverride?.clone() ?? new THREE.Vector2(
      1 / Math.max(1, sampleCols - 1),
      1 / Math.max(1, sampleRows - 1)
    );
    return {
      u_time: { value: 0 },
      u_mask: { value: mask },
      u_supportMap: { value: supportMap },
      u_domainMap: { value: domainMap },
      u_shoreSdf: { value: shoreSdf },
      u_shoreTransitionMap: { value: shoreTransitionMap },
      u_color: { value: this.currentPalette.shallowColor.clone() },
      u_deepColor: { value: this.currentPalette.deepColor.clone() },
      u_opacity: { value: 0.97 },
      u_waveScale: { value: 0.145 },
      u_normalMap1: { value: this.normal1 as THREE.Texture },
      u_normalMap2: { value: this.normal2 as THREE.Texture },
      u_scroll1: { value: new THREE.Vector2(0.0024, 0.0012) },
      u_scroll2: { value: new THREE.Vector2(-0.0018, 0.0021) },
      u_normalScale: { value: 0.056 },
      u_normalStrength: { value: 0.78 },
      u_shininess: { value: 62.0 },
      u_lightDir: { value: this.keyLight.position.clone().normalize() },
      u_specular: { value: 0.44 },
      u_skyTopColor: { value: this.currentPalette.skyTopColor.clone() },
      u_skyHorizonColor: { value: this.currentPalette.skyHorizonColor.clone() },
      u_sunColor: { value: this.currentPalette.sunColor.clone() },
      u_fogColor: { value: this.fogState.color.clone() },
      u_fogNear: { value: this.fogState.near },
      u_fogFar: { value: this.fogState.far },
      u_waveAmp: { value: 1.8 },
      u_waveFreq: { value: new THREE.Vector2(11.0, 17.5) },
      u_waveVariance: { value: 0.84 },
      u_cellGrid: {
        value: new THREE.Vector2(
          Math.max(4, Math.floor((sampleCols - 1) * 0.14)),
          Math.max(4, Math.floor((sampleRows - 1) * 0.14))
        )
      },
      u_worldStep: { value: worldStep },
      u_uvStep: { value: uvStep },
      u_tideAmp: { value: 0.18 },
      u_tideFreq: { value: 0.085 },
      u_quality: { value: qualityUniform },
      u_shoreParamsA: {
        value: new THREE.Vector4(
          this.debugControls.shoreSwashStart,
          this.debugControls.shoreSwashEnd,
          this.debugControls.shoreShoalEnd,
          this.debugControls.organicEdgeInset
        )
      },
      u_shoreParamsB: {
        value: new THREE.Vector4(
          this.debugControls.swashPushMax,
          this.debugControls.swashPushFeather,
          this.debugControls.swashCoverageMin,
          this.debugControls.swashCoverageFadeEnd
        )
      },
      u_shoreFeatureMix: {
        value: new THREE.Vector4(
          this.debugControls.enableOrganicEdge ? 1 : 0,
          this.debugControls.enableShorePulses ? 1 : 0,
          this.debugControls.enableTroughClamp ? 1 : 0,
          this.debugControls.enableSwashMotion ? 1 : 0
        )
      },
      u_shoreTuning: {
        value: new THREE.Vector4(
          this.debugControls.enableSwashSheet ? 1 : 0,
          this.debugControls.waveAmpScale,
          this.debugControls.waveLengthScale,
          this.debugControls.shoreFoamScale
        )
      },
      u_shoreWaveShape: {
        value: new THREE.Vector4(
          this.debugControls.shoreWaveAmpMinScale,
          this.debugControls.shoreWaveLengthMinScale,
          this.debugControls.enableShoreWaveModulation ? 1 : 0,
          0
        )
      }
    };
  }

  private sampleHeightProfile(profile: Float32Array, t: number): number {
    if (profile.length === 0) {
      return 0;
    }
    const clampedT = THREE.MathUtils.clamp(t, 0, 1);
    const scaledIndex = clampedT * Math.max(0, profile.length - 1);
    const index = Math.floor(scaledIndex);
    const nextIndex = Math.min(profile.length - 1, index + 1);
    const mixT = scaledIndex - index;
    return THREE.MathUtils.lerp(profile[index] ?? 0, profile[nextIndex] ?? 0, mixT);
  }

  private getOceanEdgeProfiles(ocean: OceanWaterData): {
    north: Float32Array;
    south: Float32Array;
    west: Float32Array;
    east: Float32Array;
  } | null {
    if (!ocean.heights || ocean.heights.length !== ocean.sampleCols * ocean.sampleRows) {
      return null;
    }
    const north = ocean.heights.slice(0, ocean.sampleCols);
    const southStart = Math.max(0, (ocean.sampleRows - 1) * ocean.sampleCols);
    const south = ocean.heights.slice(southStart, southStart + ocean.sampleCols);
    const west = new Float32Array(ocean.sampleRows);
    const east = new Float32Array(ocean.sampleRows);
    for (let row = 0; row < ocean.sampleRows; row += 1) {
      const base = row * ocean.sampleCols;
      west[row] = ocean.heights[base] ?? 0;
      east[row] = ocean.heights[base + Math.max(0, ocean.sampleCols - 1)] ?? 0;
    }
    return { north, south, west, east };
  }

  private applyBackdropEdgeProfile(
    geometry: THREE.PlaneGeometry,
    ocean: OceanWaterData,
    edge: "north" | "south" | "west" | "east",
    width: number,
    depth: number
  ): void {
    const profiles = this.getOceanEdgeProfiles(ocean);
    if (!profiles) {
      return;
    }
    const positions = geometry.attributes.position as THREE.BufferAttribute;
    const oceanHalfWidth = ocean.width * 0.5;
    const oceanHalfDepth = ocean.depth * 0.5;
    const fadeDistance = Math.max(140, Math.min(360, Math.min(width, depth) * 0.35));
    const halfWidth = width * 0.5;
    const halfDepth = depth * 0.5;
    for (let i = 0; i < positions.count; i += 1) {
      const x = positions.getX(i);
      const z = positions.getZ(i);
      let profileHeight = 0;
      let distFromInnerEdge = 0;
      if (edge === "north" || edge === "south") {
        const sampleX = THREE.MathUtils.clamp(x, -oceanHalfWidth, oceanHalfWidth);
        const t = ocean.width > 0 ? sampleX / ocean.width + 0.5 : 0.5;
        profileHeight = this.sampleHeightProfile(edge === "north" ? profiles.north : profiles.south, t);
        distFromInnerEdge = edge === "north" ? halfDepth - z : z + halfDepth;
      } else {
        const sampleZ = THREE.MathUtils.clamp(z, -oceanHalfDepth, oceanHalfDepth);
        const t = ocean.depth > 0 ? sampleZ / ocean.depth + 0.5 : 0.5;
        profileHeight = this.sampleHeightProfile(edge === "west" ? profiles.west : profiles.east, t);
        distFromInnerEdge = edge === "west" ? halfWidth - x : x + halfWidth;
      }
      const fade = THREE.MathUtils.smoothstep(distFromInnerEdge, 0, fadeDistance);
      positions.setY(i, profileHeight * (1 - fade));
    }
    positions.needsUpdate = true;
  }

  public setPalette(palette: OceanWaterPalette): void {
    this.currentPalette.skyTopColor.set(palette.skyTopColor);
    this.currentPalette.skyHorizonColor.set(palette.skyHorizonColor);
    this.currentPalette.shallowColor.set(palette.shallowColor);
    this.currentPalette.deepColor.set(palette.deepColor);
    this.currentPalette.sunColor.set(palette.sunColor);
    this.forEachUniformSet((uniforms) => {
      uniforms.u_skyTopColor.value.copy(this.currentPalette.skyTopColor);
      uniforms.u_skyHorizonColor.value.copy(this.currentPalette.skyHorizonColor);
      uniforms.u_color.value.copy(this.currentPalette.shallowColor);
      uniforms.u_deepColor.value.copy(this.currentPalette.deepColor);
      uniforms.u_sunColor.value.copy(this.currentPalette.sunColor);
    });
  }

  public setNormalMaps(normal1: THREE.Texture, normal2: THREE.Texture): void {
    this.normal1 = normal1;
    this.normal2 = normal2;
    this.forEachUniformSet((uniforms) => {
      uniforms.u_normalMap1.value = normal1;
      uniforms.u_normalMap2.value = normal2;
    });
  }

  public setQuality(qualityUniform: number): void {
    this.forEachUniformSet((uniforms) => {
      uniforms.u_quality.value = qualityUniform;
    });
  }

  public setFog(fog: OceanWaterFog): void {
    this.fogState.color.set(fog.color);
    this.fogState.near = fog.near;
    this.fogState.far = fog.far;
    this.forEachUniformSet((uniforms) => {
      uniforms.u_fogColor.value.copy(this.fogState.color);
      uniforms.u_fogNear.value = this.fogState.near;
      uniforms.u_fogFar.value = this.fogState.far;
    });
  }

  public setLightDirectionFromKeyLight(): void {
    this.forEachUniformSet((uniforms) => {
      uniforms.u_lightDir.value.copy(this.keyLight.position).normalize();
    });
  }

  public setDebugControls(controls: Partial<OceanWaterDebugControls>): void {
    this.debugControls = normalizeOceanWaterDebugControls({ ...this.debugControls, ...controls });
    this.applyDebugControlsToUniforms();
    this.applyDebugVisibility();
  }

  public getDebugControls(): OceanWaterDebugControls {
    return { ...this.debugControls };
  }

  public update(timeMs: number): void {
    this.forEachUniformSet((uniforms) => {
      uniforms.u_time.value = timeMs * 0.001;
    });
  }

  private buildDistantOceanBackdrop(
    baseMesh: THREE.Mesh,
    ocean: OceanWaterData,
    qualityUniform: number
  ): void {
    const span = Math.max(ocean.width, ocean.depth);
    const extension = Math.max(DISTANT_OCEAN_EXTENSION_MIN, span * DISTANT_OCEAN_EXTENSION_SCALE);
    const oceanStepX = ocean.width / Math.max(1, ocean.sampleCols - 1);
    const oceanStepZ = ocean.depth / Math.max(1, ocean.sampleRows - 1);
    const extensionSegmentsX = Math.max(1, Math.ceil(extension / Math.max(1e-3, oceanStepX)));
    const extensionSegmentsZ = Math.max(1, Math.ceil(extension / Math.max(1e-3, oceanStepZ)));
    const alignedExtensionX = extensionSegmentsX * oceanStepX;
    const alignedExtensionZ = extensionSegmentsZ * oceanStepZ;
    const overlapSteps = DISTANT_OCEAN_EDGE_OVERLAP_STEPS;
    const overlapX = oceanStepX * overlapSteps;
    const overlapZ = oceanStepZ * overlapSteps;
    const mainWorldStep = new THREE.Vector2(Math.max(0.1, oceanStepX), Math.max(0.1, oceanStepZ));
    const mainUvStep = new THREE.Vector2(
      1 / Math.max(1, ocean.sampleCols - 1),
      1 / Math.max(1, ocean.sampleRows - 1)
    );
    const halfWidth = ocean.width * 0.5;
    const halfDepth = ocean.depth * 0.5;
    const fullWidth = ocean.width + alignedExtensionX * 2 + overlapX * 2;
    const stripDepth = alignedExtensionZ + overlapZ;
    const stripWidth = alignedExtensionX + overlapX;
    const createBackdropStrip = (
      width: number,
      depth: number,
      x: number,
      z: number,
      segmentsX: number,
      segmentsY: number,
      edge: "north" | "south" | "west" | "east"
    ): void => {
      const geometry = new THREE.PlaneGeometry(width, depth, segmentsX, segmentsY);
      geometry.rotateX(-Math.PI / 2);
      this.applyBackdropEdgeProfile(geometry, ocean, edge, width, depth);
      const uniforms = this.createOceanUniforms(
        this.backdropMask,
        this.backdropSupportMap,
        this.backdropDomainMap,
        this.backdropShoreSdf,
        this.backdropShoreTransitionMap,
        width,
        depth,
        segmentsX + 1,
        segmentsY + 1,
        qualityUniform,
        mainWorldStep,
        mainUvStep
      );
      const material = createOceanSurfaceMaterial(uniforms);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.copy(baseMesh.position);
      mesh.position.x += x;
      mesh.position.y += ocean.level;
      mesh.position.z += z;
      mesh.renderOrder = 1;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.backdropEntries.push({ mesh, uniforms, material });
    };

    createBackdropStrip(
      fullWidth,
      stripDepth,
      0,
      -(halfDepth + (alignedExtensionZ - overlapZ) * 0.5),
      Math.max(1, ocean.sampleCols - 1 + extensionSegmentsX * 2 + overlapSteps * 2),
      Math.max(2, extensionSegmentsZ + overlapSteps),
      "north"
    );
    createBackdropStrip(
      fullWidth,
      stripDepth,
      0,
      halfDepth + (alignedExtensionZ - overlapZ) * 0.5,
      Math.max(1, ocean.sampleCols - 1 + extensionSegmentsX * 2 + overlapSteps * 2),
      Math.max(2, extensionSegmentsZ + overlapSteps),
      "south"
    );
    createBackdropStrip(
      stripWidth,
      ocean.depth + overlapZ * 2,
      halfWidth + (alignedExtensionX - overlapX) * 0.5,
      0,
      Math.max(2, extensionSegmentsX + overlapSteps),
      Math.max(1, ocean.sampleRows - 1 + overlapSteps * 2),
      "east"
    );
    createBackdropStrip(
      stripWidth,
      ocean.depth + overlapZ * 2,
      -(halfWidth + (alignedExtensionX - overlapX) * 0.5),
      0,
      Math.max(2, extensionSegmentsX + overlapSteps),
      Math.max(1, ocean.sampleRows - 1 + overlapSteps * 2),
      "west"
    );
  }

  public clear(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      disposeMaterial(this.mesh.material);
      this.mesh = null;
      this.uniforms = null;
    }
    this.backdropEntries.forEach((entry) => {
      this.scene.remove(entry.mesh);
      entry.mesh.geometry.dispose();
      entry.material.dispose();
    });
    this.backdropEntries = [];
    disposeTexture(this.mask);
    disposeTexture(this.supportMap);
    disposeTexture(this.domainMap);
    disposeTexture(this.shoreSdf);
    disposeTexture(this.shoreTransitionMap);
    disposeTexture(this.flowMap);
    disposeTexture(this.rapidMap);
    this.mask = null;
    this.supportMap = null;
    this.domainMap = null;
    this.shoreSdf = null;
    this.shoreTransitionMap = null;
    this.flowMap = null;
    this.rapidMap = null;
  }

  public dispose(): void {
    this.clear();
    this.backdropMask.dispose();
    this.backdropSupportMap.dispose();
    this.backdropDomainMap.dispose();
    this.backdropShoreSdf.dispose();
    this.backdropShoreTransitionMap.dispose();
  }

  public rebuild(baseMesh: THREE.Mesh, ocean: OceanWaterData, qualityUniform: number): void {
    this.clear();
    this.mask = ocean.mask;
    this.supportMap = ocean.supportMap;
    this.domainMap = ocean.domainMap;
    this.shoreSdf = ocean.shoreSdf;
    this.shoreTransitionMap = ocean.shoreTransitionMap;
    this.flowMap = ocean.flowMap;
    this.rapidMap = ocean.rapidMap;

    const geometry = new THREE.PlaneGeometry(
      ocean.width,
      ocean.depth,
      Math.max(1, ocean.sampleCols - 1),
      Math.max(1, ocean.sampleRows - 1)
    );
    geometry.rotateX(-Math.PI / 2);
    if (ocean.heights) {
      const positions = geometry.attributes.position as THREE.BufferAttribute;
      const count = Math.min(positions.count, ocean.heights.length);
      for (let i = 0; i < count; i += 1) {
        positions.setY(i, ocean.heights[i]);
      }
      positions.needsUpdate = true;
    }

    this.uniforms = this.createOceanUniforms(
      this.mask,
      this.supportMap,
      this.domainMap,
      this.shoreSdf,
      this.shoreTransitionMap,
      ocean.width,
      ocean.depth,
      ocean.sampleCols,
      ocean.sampleRows,
      qualityUniform
    );

    const material = createOceanSurfaceMaterial(this.uniforms);
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.copy(baseMesh.position);
    this.mesh.position.y += ocean.level;
    this.mesh.renderOrder = 2;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.scene.add(this.mesh);
    this.buildDistantOceanBackdrop(baseMesh, ocean, qualityUniform);
    this.applyDebugControlsToUniforms();
    this.applyDebugVisibility();
  }
}
