import * as THREE from "three";
import type { OceanWaterData } from "./threeTestTerrain.js";
import {
  DEFAULT_OCEAN_WATER_DEBUG_CONTROLS,
  normalizeOceanWaterDebugControls,
  type OceanWaterDebugControls
} from "./oceanWaterDebug.js";

type OceanUniforms = {
  u_time: { value: number };
  u_mask: { value: THREE.Texture };
  u_supportMap: { value: THREE.Texture };
  u_domainMap: { value: THREE.Texture };
  u_shoreSdf: { value: THREE.Texture };
  u_color: { value: THREE.Color };
  u_deepColor: { value: THREE.Color };
  u_opacity: { value: number };
  u_waveScale: { value: number };
  u_normalMap1: { value: THREE.Texture };
  u_normalMap2: { value: THREE.Texture };
  u_scroll1: { value: THREE.Vector2 };
  u_scroll2: { value: THREE.Vector2 };
  u_normalScale: { value: number };
  u_normalStrength: { value: number };
  u_shininess: { value: number };
  u_lightDir: { value: THREE.Vector3 };
  u_specular: { value: number };
  u_skyTopColor: { value: THREE.Color };
  u_skyHorizonColor: { value: THREE.Color };
  u_sunColor: { value: THREE.Color };
  u_fogColor: { value: THREE.Color };
  u_fogNear: { value: number };
  u_fogFar: { value: number };
  u_waveAmp: { value: number };
  u_waveFreq: { value: THREE.Vector2 };
  u_waveVariance: { value: number };
  u_cellGrid: { value: THREE.Vector2 };
  u_worldStep: { value: THREE.Vector2 };
  u_uvStep: { value: THREE.Vector2 };
  u_tideAmp: { value: number };
  u_tideFreq: { value: number };
  u_quality: { value: number };
  u_shoreParamsA: { value: THREE.Vector4 };
  u_shoreParamsB: { value: THREE.Vector4 };
  u_shoreFeatureMix: { value: THREE.Vector4 };
  u_shoreTuning: { value: THREE.Vector4 };
  u_shoreWaveShape: { value: THREE.Vector4 };
};

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
  private flowMap: THREE.Texture | null = null;
  private rapidMap: THREE.Texture | null = null;
  private normal1: THREE.Texture | null = null;
  private normal2: THREE.Texture | null = null;
  private readonly backdropMask: THREE.DataTexture;
  private readonly backdropSupportMap: THREE.DataTexture;
  private readonly backdropDomainMap: THREE.DataTexture;
  private readonly backdropShoreSdf: THREE.DataTexture;
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
      u_waveAmp: { value: 1.35 },
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

  private createMainOceanMaterial(uniforms: OceanUniforms): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: uniforms as any,
      transparent: true,
      depthWrite: true,
      depthTest: true,
      side: THREE.FrontSide,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vGeomNormal;
        varying float vDisp;
        varying float vSdf;
        varying float vOcean;
        varying float vSurfAtten;
        uniform float u_time;
        uniform sampler2D u_domainMap;
        uniform sampler2D u_shoreSdf;
        uniform float u_waveAmp;
        uniform vec2 u_waveFreq;
        uniform float u_waveVariance;
        uniform vec2 u_cellGrid;
        uniform vec2 u_worldStep;
        uniform vec2 u_uvStep;
        uniform float u_tideAmp;
        uniform float u_tideFreq;
        uniform float u_quality;
        uniform vec4 u_shoreParamsA;
        uniform vec4 u_shoreParamsB;
        uniform vec4 u_shoreFeatureMix;
        uniform vec4 u_shoreTuning;
        uniform vec4 u_shoreWaveShape;
        float hash21(vec2 p) {
          vec2 q = fract(p * vec2(123.34, 456.21));
          q += dot(q, q + 45.32);
          return fract(q.x * q.y);
        }
        float valueNoise21(vec2 p) {
          vec2 cell = floor(p);
          vec2 f = fract(p);
          vec2 smoothF = f * f * (3.0 - 2.0 * f);
          float a = hash21(cell);
          float b = hash21(cell + vec2(1.0, 0.0));
          float c = hash21(cell + vec2(0.0, 1.0));
          float d = hash21(cell + vec2(1.0, 1.0));
          return mix(mix(a, b, smoothF.x), mix(c, d, smoothF.x), smoothF.y);
        }
        vec3 getDisplacementWeights(float quality) {
          if (quality < 0.5) {
            return vec3(0.7, 0.35, 0.72);
          }
          if (quality < 1.5) {
            return vec3(1.0, 1.0, 1.0);
          }
          return vec3(1.18, 1.08, 1.08);
        }
        vec2 sampleShoreGradient(vec2 uvCoord) {
          vec2 stepX = vec2(u_uvStep.x, 0.0);
          vec2 stepY = vec2(0.0, u_uvStep.y);
          float sdfPosX = texture2D(u_shoreSdf, uvCoord + stepX).r * 2.0 - 1.0;
          float sdfNegX = texture2D(u_shoreSdf, uvCoord - stepX).r * 2.0 - 1.0;
          float sdfPosY = texture2D(u_shoreSdf, uvCoord + stepY).r * 2.0 - 1.0;
          float sdfNegY = texture2D(u_shoreSdf, uvCoord - stepY).r * 2.0 - 1.0;
          vec2 grad = vec2(sdfPosX - sdfNegX, sdfPosY - sdfNegY);
          float gradLen = length(grad);
          if (gradLen < 1e-4) {
            return vec2(0.93, 0.37);
          }
          return grad / gradLen;
        }
        float computeOrganicShoreInset(vec2 worldXZ, float positiveSdf) {
          float surfBand = 1.0 - smoothstep(
            u_shoreParamsA.y,
            u_shoreParamsA.z,
            positiveSdf
          );
          float edgePresence = smoothstep(
            u_shoreParamsA.x * 0.25,
            u_shoreParamsA.z,
            positiveSdf
          );
          float edgeNoiseA = valueNoise21(worldXZ * vec2(0.082, 0.069) + vec2(17.3, 9.1));
          float edgeNoiseB = valueNoise21(worldXZ * vec2(0.163, 0.141) + vec2(-4.7, 13.6));
          float edgeNoise = smoothstep(0.18, 0.86, edgeNoiseA * 0.68 + edgeNoiseB * 0.32);
          return mix(0.34, 1.0, edgeNoise) * u_shoreParamsA.w * edgePresence * surfBand * u_shoreFeatureMix.x;
        }
        vec3 gerstnerWave(
          vec2 samplePos,
          vec2 dir,
          float wavelength,
          float amplitude,
          float steepness,
          float speed,
          float phaseOffset
        ) {
          vec2 d = normalize(dir);
          float waveLengthSafe = max(1.0, wavelength);
          float k = 6.28318530718 / waveLengthSafe;
          float phase = k * dot(d, samplePos) - speed * u_time + phaseOffset;
          float s = sin(phase);
          float c = cos(phase);
          float qa = steepness / max(k * amplitude * 3.0, 1.0);
          return vec3(d.x * qa * amplitude * c, amplitude * s, d.y * qa * amplitude * c);
        }
        vec3 computeDisplacedPosition(vec3 p, vec2 uvCoord, out float ocean, out float sdf, out float surfAtten) {
          vec2 worldXZ = (modelMatrix * vec4(p, 1.0)).xz;
          vec4 domain = texture2D(u_domainMap, uvCoord);
          ocean = domain.r;
          float shoreTerrainBase = domain.g * 10.0;
          float coverage = domain.b;
          surfAtten = domain.a;
          sdf = texture2D(u_shoreSdf, uvCoord).r * 2.0 - 1.0;
          float positiveSdf = max(0.0, sdf);
          float shorelineSdf = max(0.0, positiveSdf - computeOrganicShoreInset(worldXZ, positiveSdf));
          vec2 shoreOut = sampleShoreGradient(uvCoord);
          vec2 shoreIn = -shoreOut;
          vec2 shoreAlong = vec2(-shoreIn.y, shoreIn.x);
          vec2 inlandUvStep = vec2(shoreIn.x * u_uvStep.x, shoreIn.y * u_uvStep.y);
          vec2 alongUvStep = vec2(shoreAlong.x * u_uvStep.x, shoreAlong.y * u_uvStep.y);
          vec2 inlandUvA = clamp(uvCoord + inlandUvStep * 0.75, vec2(0.0), vec2(1.0));
          vec2 inlandUvB = clamp(uvCoord + inlandUvStep * 1.6, vec2(0.0), vec2(1.0));
          vec2 inlandUvC = clamp(uvCoord + inlandUvStep * 2.9 + alongUvStep * 0.35, vec2(0.0), vec2(1.0));
          vec2 inlandUvD = clamp(uvCoord + inlandUvStep * 4.4 - alongUvStep * 0.35, vec2(0.0), vec2(1.0));
          float shoreTerrainA = texture2D(u_domainMap, inlandUvA).g * 10.0;
          float shoreTerrainB = texture2D(u_domainMap, inlandUvB).g * 10.0;
          float shoreTerrainC = texture2D(u_domainMap, inlandUvC).g * 10.0;
          float shoreTerrainD = texture2D(u_domainMap, inlandUvD).g * 10.0;
          float shoreTerrainFloor = max(
            max(shoreTerrainBase, shoreTerrainA),
            max(shoreTerrainB, max(shoreTerrainC, shoreTerrainD))
          );
          float shoreWaveBlend = smoothstep(
            u_shoreParamsA.x,
            u_shoreParamsA.z,
            shorelineSdf
          );
          float localWaveAmpScale = mix(
            1.0,
            mix(u_shoreWaveShape.x, 1.0, shoreWaveBlend),
            u_shoreWaveShape.z
          );
          float localWaveLengthScale = mix(
            1.0,
            mix(u_shoreWaveShape.y, 1.0, shoreWaveBlend),
            u_shoreWaveShape.z
          );
          float shoreWaveMod = (1.0 - shoreWaveBlend) * u_shoreWaveShape.z;
          float shoreWaveSuppression = max(0.0, 1.0 - localWaveAmpScale) * shoreWaveMod;
          float shorePresence = smoothstep(
            -u_shoreParamsB.y,
            u_shoreParamsA.y,
            shorelineSdf
          );
          float shoalBlend = smoothstep(
            u_shoreParamsA.y,
            u_shoreParamsA.z,
            shorelineSdf
          );
          float swashWeight = 1.0 - smoothstep(
            u_shoreParamsA.x,
            u_shoreParamsA.y,
            shorelineSdf
          );
          float shoalWeight =
            smoothstep(u_shoreParamsA.x, u_shoreParamsA.y, shorelineSdf) *
            (1.0 - smoothstep(u_shoreParamsA.y, u_shoreParamsA.z, shorelineSdf));
          float surfWeight = max(swashWeight, shoalWeight);
          float swashCoverage = smoothstep(
            u_shoreParamsB.z,
            u_shoreParamsB.w,
            coverage
          );
          float coverageStrength = mix(1.0, swashCoverage, swashWeight);
          vec3 weights = getDisplacementWeights(u_quality);
          float domainStrength = clamp(ocean * 1.35, 0.0, 1.0) * coverageStrength;
          float attenuation = clamp(surfAtten, 0.0, 0.94);
          float swellAmp =
            u_waveAmp *
            u_shoreTuning.y *
            weights.x *
            mix(0.2, 1.0, shoalBlend) *
            localWaveAmpScale *
            domainStrength *
            shorePresence *
            (1.0 - attenuation * (shoalWeight * 0.42 + swashWeight * 0.68));
          float baseAmp = max(1e-4, swellAmp);
          vec2 noiseUv = worldXZ * vec2(0.013, 0.011);
          float cellNoiseA = valueNoise21(noiseUv + vec2(0.17, 0.61));
          float cellNoiseB = valueNoise21(noiseUv * 1.13 + vec2(2.91, 1.37));
          float cellNoiseC = valueNoise21(noiseUv * 0.72 + vec2(4.73, 0.29));
          float lenVarianceA = mix(0.09, 0.2, clamp(u_waveVariance, 0.0, 1.0));
          float lenVarianceB = mix(0.12, 0.24, clamp(u_waveVariance, 0.0, 1.0));
          float wave1Len =
            mix(u_waveFreq.x * (1.0 - lenVarianceA), u_waveFreq.x * (1.0 + lenVarianceA), cellNoiseA) *
            u_shoreTuning.z *
            localWaveLengthScale;
          float wave2Len =
            mix(u_waveFreq.y * (1.0 - lenVarianceB), u_waveFreq.y * (1.0 + lenVarianceB), cellNoiseB) *
            u_shoreTuning.z *
            localWaveLengthScale;
          float wave3Len = mix(
            u_waveFreq.x * mix(0.34, 0.28, clamp(u_waveVariance, 0.0, 1.0)),
            u_waveFreq.y * mix(0.46, 0.54, clamp(u_waveVariance, 0.0, 1.0)),
            clamp(0.5 + (cellNoiseC - 0.5) * 0.72, 0.0, 1.0)
          ) * u_shoreTuning.z * localWaveLengthScale;
          vec3 disp = vec3(0.0);
          disp += gerstnerWave(worldXZ, vec2(0.96, 0.28), wave1Len, swellAmp * 0.78, 0.98, 1.82, 0.0);
          disp += gerstnerWave(worldXZ, vec2(-0.42, 0.91), wave2Len, swellAmp * 0.54, 0.86, 1.46, 1.7);
          disp += gerstnerWave(worldXZ, vec2(0.63, -0.78), wave3Len, swellAmp * 0.32 * weights.y, 0.76, 2.24, 3.1);
          float shorePhaseA =
            dot(worldXZ, normalize(shoreIn + shoreAlong * 0.26)) *
              (6.28318530718 / max(4.2, wave1Len * 0.42)) -
            u_time * mix(2.8, 3.6, cellNoiseA) +
            cellNoiseB * 6.28318530718;
          float shorePhaseB =
            dot(worldXZ, normalize(shoreIn - shoreAlong * 0.31)) *
              (6.28318530718 / max(5.6, wave2Len * 0.36)) -
            u_time * mix(3.2, 4.1, cellNoiseC) +
            1.7;
          float shorePulseA = max(0.0, sin(shorePhaseA));
          float shorePulseB = max(0.0, sin(shorePhaseB));
          shorePulseA *= shorePulseA;
          shorePulseB *= shorePulseB;
          float shorePulse =
            smoothstep(0.12, 0.92, shorePulseA * 0.62 + shorePulseB * 0.38) *
            (1.0 - smoothstep(u_shoreParamsA.x * 0.4, u_shoreParamsA.z, shorelineSdf));
          float surfImpact = shoalWeight * 0.78 + swashWeight;
          float lappingLift =
            shorePulse *
            baseAmp *
            (0.82 + attenuation * 0.34 + shoreWaveSuppression * 0.28) *
            mix(0.34, 1.18, surfImpact) *
            u_shoreFeatureMix.y;
          disp.y += lappingLift;
          float crestOnlyDisp = max(0.0, disp.y);
          disp.y = mix(
            disp.y,
            crestOnlyDisp,
            clamp(swashWeight * 0.86 + shoreWaveSuppression * 0.42, 0.0, 1.0)
          );
          float waveModMinDisp = -baseAmp * mix(
            1.0,
            0.06,
            clamp(shoreWaveSuppression * 1.1 + swashWeight * 0.52, 0.0, 1.0)
          );
          disp.y = mix(disp.y, max(disp.y, waveModMinDisp), shoreWaveMod);
          float tide =
            sin(u_time * u_tideFreq + dot(worldXZ, vec2(0.012, -0.01))) *
            u_tideAmp *
            weights.z *
            domainStrength *
            mix(0.35, 1.0, shoalBlend) *
            shorePresence;
          float minDisp = -baseAmp * mix(1.0, 0.15, surfWeight);
          float shoreFloorWeight = 1.0 - smoothstep(u_shoreParamsA.x, u_shoreParamsA.z, shorelineSdf);
          float shoreFloorDisp = shoreTerrainFloor - 0.02 - p.y - tide;
          minDisp = max(minDisp, mix(-1e4, shoreFloorDisp, shoreFloorWeight));
          disp.y = mix(disp.y, max(disp.y, minDisp), u_shoreFeatureMix.z);
          vec3 displaced = p + disp;
          displaced.y += tide;
          return displaced;
        }
        void main() {
          vUv = uv;
          float ocean;
          float sdf;
          float surfAtten;
          vec3 displaced = computeDisplacedPosition(position, vUv, ocean, sdf, surfAtten);
          float oceanX;
          float sdfX;
          float surfAttenX;
          float oceanZ;
          float sdfZ;
          float surfAttenZ;
          vec3 displacedX = computeDisplacedPosition(
            position + vec3(u_worldStep.x, 0.0, 0.0),
            vUv + vec2(u_uvStep.x, 0.0),
            oceanX,
            sdfX,
            surfAttenX
          );
          vec3 displacedZ = computeDisplacedPosition(
            position + vec3(0.0, 0.0, u_worldStep.y),
            vUv + vec2(0.0, u_uvStep.y),
            oceanZ,
            sdfZ,
            surfAttenZ
          );
          vec3 tangentX = displacedX - displaced;
          vec3 tangentZ = displacedZ - displaced;
          vec3 geomNormalLocal = cross(tangentZ, tangentX);
          if (length(geomNormalLocal) < 1e-4) {
            geomNormalLocal = vec3(0.0, 1.0, 0.0);
          }
          geomNormalLocal = normalize(geomNormalLocal);
          vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
          vWorldPos = worldPos.xyz;
          vGeomNormal = normalize(mat3(modelMatrix) * geomNormalLocal);
          vDisp = displaced.y - position.y;
          vSdf = sdf;
          vOcean = ocean;
          vSurfAtten = surfAtten;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vGeomNormal;
        varying float vDisp;
        varying float vSdf;
        varying float vOcean;
        varying float vSurfAtten;
        uniform sampler2D u_mask;
        uniform sampler2D u_supportMap;
        uniform sampler2D u_domainMap;
        uniform sampler2D u_shoreSdf;
        uniform vec3 u_color;
        uniform vec3 u_deepColor;
        uniform float u_opacity;
        uniform float u_time;
        uniform float u_waveScale;
        uniform vec2 u_waveFreq;
        uniform float u_waveVariance;
        uniform float u_normalScale;
        uniform float u_normalStrength;
        uniform vec2 u_uvStep;
        uniform float u_shininess;
        uniform vec3 u_lightDir;
        uniform float u_specular;
        uniform vec3 u_skyTopColor;
        uniform vec3 u_skyHorizonColor;
        uniform vec3 u_sunColor;
        uniform vec3 u_fogColor;
        uniform float u_fogNear;
        uniform float u_fogFar;
        uniform sampler2D u_normalMap1;
        uniform sampler2D u_normalMap2;
        uniform vec2 u_scroll1;
        uniform vec2 u_scroll2;
        uniform float u_quality;
        uniform vec4 u_shoreParamsA;
        uniform vec4 u_shoreParamsB;
        uniform vec4 u_shoreFeatureMix;
        uniform vec4 u_shoreTuning;
        uniform vec4 u_shoreWaveShape;
        float hash21(vec2 p) {
          vec2 q = fract(p * vec2(123.34, 456.21));
          q += dot(q, q + 45.32);
          return fract(q.x * q.y);
        }
        float valueNoise21(vec2 p) {
          vec2 cell = floor(p);
          vec2 f = fract(p);
          vec2 smoothF = f * f * (3.0 - 2.0 * f);
          float a = hash21(cell);
          float b = hash21(cell + vec2(1.0, 0.0));
          float c = hash21(cell + vec2(0.0, 1.0));
          float d = hash21(cell + vec2(1.0, 1.0));
          return mix(mix(a, b, smoothF.x), mix(c, d, smoothF.x), smoothF.y);
        }
        vec3 getSurfaceWeights(float quality) {
          if (quality < 0.5) {
            return vec3(0.85, 0.15, 0.8);
          }
          if (quality < 1.5) {
            return vec3(1.0, 1.0, 1.0);
          }
          return vec3(1.1, 1.15, 1.08);
        }
        vec2 sampleShoreGradient(vec2 uvCoord) {
          vec2 stepX = vec2(u_uvStep.x, 0.0);
          vec2 stepY = vec2(0.0, u_uvStep.y);
          float sdfPosX = texture2D(u_shoreSdf, uvCoord + stepX).r * 2.0 - 1.0;
          float sdfNegX = texture2D(u_shoreSdf, uvCoord - stepX).r * 2.0 - 1.0;
          float sdfPosY = texture2D(u_shoreSdf, uvCoord + stepY).r * 2.0 - 1.0;
          float sdfNegY = texture2D(u_shoreSdf, uvCoord - stepY).r * 2.0 - 1.0;
          vec2 grad = vec2(sdfPosX - sdfNegX, sdfPosY - sdfNegY);
          float gradLen = length(grad);
          if (gradLen < 1e-4) {
            return vec2(0.93, 0.37);
          }
          return grad / gradLen;
        }
        float computeOrganicShoreInset(vec2 worldXZ, float positiveSdf) {
          float surfBand = 1.0 - smoothstep(
            u_shoreParamsA.y,
            u_shoreParamsA.z,
            positiveSdf
          );
          float edgePresence = smoothstep(
            u_shoreParamsA.x * 0.25,
            u_shoreParamsA.z,
            positiveSdf
          );
          float edgeNoiseA = valueNoise21(worldXZ * vec2(0.082, 0.069) + vec2(17.3, 9.1));
          float edgeNoiseB = valueNoise21(worldXZ * vec2(0.163, 0.141) + vec2(-4.7, 13.6));
          float edgeNoise = smoothstep(0.18, 0.86, edgeNoiseA * 0.68 + edgeNoiseB * 0.32);
          return mix(0.34, 1.0, edgeNoise) * u_shoreParamsA.w * edgePresence * surfBand * u_shoreFeatureMix.x;
        }
        float computeShorePulse(vec2 worldXZ, vec2 uvCoord, float shorelineSdf) {
          vec2 noiseUv = worldXZ * vec2(0.013, 0.011);
          float cellNoiseA = valueNoise21(noiseUv + vec2(0.17, 0.61));
          float cellNoiseB = valueNoise21(noiseUv * 1.13 + vec2(2.91, 1.37));
          float cellNoiseC = valueNoise21(noiseUv * 0.72 + vec2(4.73, 0.29));
          float lenVarianceA = mix(0.09, 0.2, clamp(u_waveVariance, 0.0, 1.0));
          float lenVarianceB = mix(0.12, 0.24, clamp(u_waveVariance, 0.0, 1.0));
          float shoreWaveBlend = smoothstep(
            u_shoreParamsA.x,
            u_shoreParamsA.z,
            shorelineSdf
          );
          float localWaveLengthScale = mix(
            1.0,
            mix(u_shoreWaveShape.y, 1.0, shoreWaveBlend),
            u_shoreWaveShape.z
          );
          float wave1Len =
            mix(u_waveFreq.x * (1.0 - lenVarianceA), u_waveFreq.x * (1.0 + lenVarianceA), cellNoiseA) *
            u_shoreTuning.z *
            localWaveLengthScale;
          float wave2Len =
            mix(u_waveFreq.y * (1.0 - lenVarianceB), u_waveFreq.y * (1.0 + lenVarianceB), cellNoiseB) *
            u_shoreTuning.z *
            localWaveLengthScale;
          vec2 shoreOut = sampleShoreGradient(uvCoord);
          vec2 shoreIn = -shoreOut;
          vec2 shoreAlong = vec2(-shoreIn.y, shoreIn.x);
          float shorePhaseA =
            dot(worldXZ, normalize(shoreIn + shoreAlong * 0.26)) *
              (6.28318530718 / max(4.2, wave1Len * 0.42)) -
            u_time * mix(2.8, 3.6, cellNoiseA) +
            cellNoiseB * 6.28318530718;
          float shorePhaseB =
            dot(worldXZ, normalize(shoreIn - shoreAlong * 0.31)) *
              (6.28318530718 / max(5.6, wave2Len * 0.36)) -
            u_time * mix(3.2, 4.1, cellNoiseC) +
            1.7;
          float shorePulseA = max(0.0, sin(shorePhaseA));
          float shorePulseB = max(0.0, sin(shorePhaseB));
          shorePulseA *= shorePulseA;
          shorePulseB *= shorePulseB;
          float pulseMix = smoothstep(0.12, 0.92, shorePulseA * 0.62 + shorePulseB * 0.38);
          float surfBand = 1.0 - smoothstep(u_shoreParamsA.x * 0.4, u_shoreParamsA.z, shorelineSdf);
          return pulseMix * surfBand * u_shoreFeatureMix.y;
        }
        void main() {
          float support = texture2D(u_supportMap, vUv).r;
          float sdf = texture2D(u_shoreSdf, vUv).r * 2.0 - 1.0;
          float domainWater = texture2D(u_domainMap, vUv).b;
          float positiveSdf = max(0.0, sdf);
          float inlandDepth = max(0.0, -sdf);
          float shorelineSdf = max(0.0, positiveSdf - computeOrganicShoreInset(vWorldPos.xz, positiveSdf));
          float shoreWaveBlend = smoothstep(
            u_shoreParamsA.x,
            u_shoreParamsA.z,
            shorelineSdf
          );
          float localWaveAmpScale = mix(
            1.0,
            mix(u_shoreWaveShape.x, 1.0, shoreWaveBlend),
            u_shoreWaveShape.z
          );
          float localWaveLengthScale = mix(
            1.0,
            mix(u_shoreWaveShape.y, 1.0, shoreWaveBlend),
            u_shoreWaveShape.z
          );
          float shoreWaveMod = (1.0 - shoreWaveBlend) * u_shoreWaveShape.z;
          float shoreWaveSuppression = max(0.0, 1.0 - localWaveAmpScale) * shoreWaveMod;
          float shoreWaveCompression = max(0.0, 1.0 - localWaveLengthScale) * shoreWaveMod;
          float shorePresence = smoothstep(
            -u_shoreParamsB.y,
            u_shoreParamsA.y,
            shorelineSdf
          );
          float shoalBlend = smoothstep(
            u_shoreParamsA.y,
            u_shoreParamsA.z,
            shorelineSdf
          );
          float swashWeight = 1.0 - smoothstep(
            u_shoreParamsA.x,
            u_shoreParamsA.y,
            shorelineSdf
          );
          float shoalWeight =
            smoothstep(u_shoreParamsA.x, u_shoreParamsA.y, shorelineSdf) *
            (1.0 - smoothstep(u_shoreParamsA.y, u_shoreParamsA.z, shorelineSdf));
          float surfWeight = max(swashWeight, shoalWeight);
          float swashCoverage = smoothstep(
            u_shoreParamsB.z,
            u_shoreParamsB.w,
            domainWater
          );
          float coverageStrength = mix(
            1.0,
            swashCoverage,
            clamp(swashWeight * 0.92 + shoreWaveSuppression * 0.24, 0.0, 1.0)
          );
          float shoreImpact = shoalWeight * 0.76 + swashWeight;
          float shorePulse = computeShorePulse(vWorldPos.xz, vUv, shorelineSdf);
          float swashBand = 1.0 - smoothstep(0.0, u_shoreParamsA.y + u_shoreParamsB.y, shorelineSdf);
          float inlandReach = max(0.016, u_shoreParamsB.y * 0.7 + u_shoreParamsB.x * 0.22);
          float inlandFade = 1.0 - smoothstep(0.0, inlandReach, inlandDepth);
          float shoreMotionMask = swashBand * inlandFade;
          float coastalMask = max(
            shoreMotionMask,
            surfWeight * smoothstep(0.02, 0.25, domainWater)
          );
          float pulseWash = shorePulse * (
            0.03 +
            0.065 * shoreImpact +
            shoreWaveCompression * 0.03
          ) * coastalMask;
          float waveModWash = shoreWaveSuppression * (
            0.025 +
            0.05 * max(surfWeight, shorePresence) +
            shoreWaveCompression * 0.025
          ) * coastalMask;
          float swashAdvance =
            shorePulse *
            u_shoreParamsB.x *
            clamp(0.14 + swashWeight * 1.04 + shoalWeight * 0.42 + clamp(vSurfAtten, 0.0, 1.0) * 0.18, 0.0, 1.0) *
            shoreMotionMask *
            u_shoreFeatureMix.w;
          float shorelineAdvance = swashAdvance + pulseWash + waveModWash;
          float shoreRenderSdf = shorelineSdf - shorelineAdvance;
          float renderShoreClip = smoothstep(
            -u_shoreParamsB.y,
            u_shoreParamsA.y,
            shoreRenderSdf
          );
          renderShoreClip *= max(
            shoreMotionMask,
            smoothstep(u_shoreParamsA.x, u_shoreParamsA.z, shorelineSdf)
          );
          float effectiveCoverage = mix(
            domainWater,
            domainWater * swashCoverage,
            clamp(swashWeight + shoreWaveSuppression * 0.22, 0.0, 1.0)
          );
          float swashCoverBand = max(
            swashWeight + shoalWeight * 0.34,
            max(shoreMotionMask * 0.42, shoreWaveSuppression * 0.28 * coastalMask)
          );
          float swashSheet =
            smoothstep(-u_shoreParamsB.y, 0.055, shoreRenderSdf) *
            (0.12 + 0.46 * shorePulse) *
            swashCoverBand *
            u_shoreTuning.x *
            coastalMask;
          float shorelineCover = clamp(shorelineAdvance * 4.2, 0.0, 1.0) * coastalMask;
          float renderCoverage = max(max(effectiveCoverage, swashSheet * 1.02), shorelineCover);
          if (
            (support < 0.5 && swashSheet < 0.02 && sdf <= 0.0) ||
            renderShoreClip < 0.01 ||
            (swashWeight > 1e-3 && renderCoverage < u_shoreParamsB.z)
          ) discard;
          float mask = texture2D(u_mask, vUv).a;
          float shoreFade = smoothstep(-u_shoreParamsB.y * 0.4, u_shoreParamsA.z, shoreRenderSdf);
          float shorelineFilm = shorelineCover * mix(0.24, 0.52, min(1.0, shoreImpact + shorePulse * 0.18));
          float alpha =
            u_opacity *
            max(
              max(
                renderShoreClip *
                  max(
                    mask * mix(0.54, 1.0, shoreFade),
                    domainWater * mix(0.48, 1.0, shoalBlend)
                  ),
                shorelineFilm
              ),
              swashSheet * mix(0.66, 0.92, shoreImpact)
            );
          alpha *= max(max(coverageStrength, swashSheet * 1.24), shorelineCover);
          if (alpha < 0.01) discard;
          vec3 surfaceWeights = getSurfaceWeights(u_quality);
          vec2 worldUv = vWorldPos.xz * u_waveScale;
          float viewDist = length(cameraPosition - vWorldPos);
          float farT = smoothstep(70.0, 240.0, viewDist);
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float grazing = 1.0 - clamp(abs(viewDir.y), 0.0, 1.0);
          vec2 uv1 = worldUv * 3.4 + u_scroll1 * (u_time * 0.95);
          vec2 uv2 = worldUv * 5.4 + u_scroll2 * (u_time * 1.15);
          vec2 farUv = worldUv * 0.36;
          vec2 uvFar1 = farUv * 2.0 + u_scroll1 * (u_time * 0.36);
          vec2 uvFar2 = farUv * 2.8 + u_scroll2 * (u_time * 0.42);
          vec2 nearXY = texture2D(u_normalMap1, uv1).xy * 2.0 - 1.0 + (texture2D(u_normalMap2, uv2).xy * 2.0 - 1.0) * 0.58;
          vec2 farXY = texture2D(u_normalMap1, uvFar1).xy * 2.0 - 1.0 + (texture2D(u_normalMap2, uvFar2).xy * 2.0 - 1.0) * 0.4;
          vec2 nXY = mix(nearXY, farXY, farT * 0.82);
          float normalScale = u_normalScale * 1.16 * surfaceWeights.x * (1.0 + farT * 0.14) * (1.0 + grazing * 0.22);
          vec3 normalMapN = normalize(vec3(nXY.x * normalScale * u_normalStrength, 1.0, nXY.y * normalScale * u_normalStrength));
          vec3 geomN = normalize(vGeomNormal);
          float normalMix = clamp(0.26 + surfaceWeights.x * 0.18 - grazing * 0.02, 0.24, 0.48);
          vec3 n = normalize(mix(geomN, normalMapN, normalMix));
          vec3 lightDir = normalize(u_lightDir);
          float diffuse = max(dot(n, lightDir), 0.0);
          vec3 halfDir = normalize(lightDir + viewDir);
          float specBase = pow(max(dot(n, halfDir), 0.0), max(1.0, u_shininess));
          float crestMask = clamp(smoothstep(0.14, 0.68, max(0.0, vDisp)) * 0.7 + smoothstep(0.995, 0.72, geomN.y) * 0.3, 0.0, 1.0);
          float spec = specBase * u_specular * 0.64 * surfaceWeights.z * mix(0.18, 1.0, crestMask) * (0.82 + 0.58 * grazing);
          float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.1);
          float shoreDist = max(0.0, shoreRenderSdf);
          float depthFactor = clamp(pow(shoreDist, 0.55), 0.0, 1.0);
          vec3 baseColor = mix(u_color, u_deepColor, depthFactor * (0.28 + 0.32 * vOcean));
          float foamWidth = mix(0.22, 0.4, clamp(vSurfAtten * 1.05 + shoreImpact * 0.55, 0.0, 1.0));
          float foamBand = 1.0 - smoothstep(-u_shoreParamsB.y * 0.65, foamWidth, shoreRenderSdf);
          float lappingA = sin(u_time * 1.9 + dot(vWorldPos.xz, vec2(1.9, 1.3))) * 0.5 + 0.5;
          float lappingB = sin(u_time * 2.7 - dot(vWorldPos.xz, vec2(1.1, -1.7))) * 0.5 + 0.5;
          float crestFoam = smoothstep(0.3, 0.92, max(0.0, vDisp)) * mix(0.06, 0.18, shoreImpact);
          float lappingStrength = mix(1.0, 1.28, clamp(vSurfAtten, 0.0, 1.0)) + shoreImpact * 0.18 + shorePulse * 0.22;
          float foam =
            (foamBand * (0.22 + (lappingA * 0.65 + lappingB * 0.35) * 0.38 + shorePulse * 0.16) * (lappingStrength + shoreImpact * 0.2) + crestFoam) *
            mix(0.42, 0.72, shoreImpact) *
            surfaceWeights.y *
            u_shoreTuning.w;
          vec3 foamColor = vec3(0.95, 0.98, 1.0);
          vec3 litBase = mix(baseColor, foamColor, clamp(foam, 0.0, 1.0) * mix(0.52, 0.76, shoreImpact));
          float skyT = clamp(0.58 + 0.42 * viewDir.y, 0.0, 1.0);
          vec3 skyReflect = mix(u_skyHorizonColor, u_skyTopColor, skyT);
          float sunExp = mix(176.0, 100.0, grazing);
          float sunGlitter = pow(max(dot(reflect(-viewDir, n), lightDir), 0.0), sunExp) * (0.12 + 0.96 * vOcean) * (0.18 + 0.64 * crestMask) * (0.8 + 0.56 * grazing);
          vec3 reflection = skyReflect * (fresnel * 0.36) + u_sunColor * (sunGlitter * 0.25);
          float swellShade = clamp(0.94 + vDisp * 0.24 + (1.0 - geomN.y) * 0.52, 0.84, 1.24);
          vec3 color = litBase * (0.78 + diffuse * 0.2) * swellShade + skyReflect * (0.08 + 0.07 * grazing) + reflection + u_sunColor * spec;
          float fogFactor = pow(smoothstep(u_fogNear, u_fogFar, viewDist), 1.15);
          color = mix(color, u_fogColor, fogFactor);
          alpha = mix(alpha, 1.0, fogFactor * 0.18);
          gl_FragColor = vec4(color, alpha);
        }
      `
    });
  }

  private createBackdropMaterial(uniforms: OceanUniforms): THREE.ShaderMaterial {
    return this.createMainOceanMaterial(uniforms);
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
        width,
        depth,
        segmentsX + 1,
        segmentsY + 1,
        qualityUniform,
        mainWorldStep,
        mainUvStep
      );
      const material = this.createBackdropMaterial(uniforms);
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
    disposeTexture(this.flowMap);
    disposeTexture(this.rapidMap);
    this.mask = null;
    this.supportMap = null;
    this.domainMap = null;
    this.shoreSdf = null;
    this.flowMap = null;
    this.rapidMap = null;
  }

  public dispose(): void {
    this.clear();
    this.backdropMask.dispose();
    this.backdropSupportMap.dispose();
    this.backdropDomainMap.dispose();
    this.backdropShoreSdf.dispose();
  }

  public rebuild(baseMesh: THREE.Mesh, ocean: OceanWaterData, qualityUniform: number): void {
    this.clear();
    this.mask = ocean.mask;
    this.supportMap = ocean.supportMap;
    this.domainMap = ocean.domainMap;
    this.shoreSdf = ocean.shoreSdf;
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
      ocean.width,
      ocean.depth,
      ocean.sampleCols,
      ocean.sampleRows,
      qualityUniform
    );

    const material = this.createMainOceanMaterial(this.uniforms);
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
