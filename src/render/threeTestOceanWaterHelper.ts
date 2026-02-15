import * as THREE from "three";
import type { OceanWaterData } from "./threeTestTerrain.js";

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
  u_waveAmp: { value: number };
  u_waveFreq: { value: THREE.Vector2 };
  u_waveVariance: { value: number };
  u_cellGrid: { value: THREE.Vector2 };
  u_worldStep: { value: THREE.Vector2 };
  u_uvStep: { value: THREE.Vector2 };
  u_tideAmp: { value: number };
  u_tideFreq: { value: number };
  u_quality: { value: number };
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
};

export class ThreeTestOceanWaterHelper {
  private readonly scene: THREE.Scene;
  private readonly keyLight: THREE.DirectionalLight;
  private readonly skyTopColor: number;
  private readonly skyHorizonColor: number;
  private mesh: THREE.Mesh | null = null;
  private uniforms: OceanUniforms | null = null;
  private mask: THREE.Texture | null = null;
  private supportMap: THREE.Texture | null = null;
  private domainMap: THREE.Texture | null = null;
  private shoreSdf: THREE.Texture | null = null;
  private flowMap: THREE.Texture | null = null;
  private rapidMap: THREE.Texture | null = null;
  private normal1: THREE.Texture | null = null;
  private normal2: THREE.Texture | null = null;

  constructor(options: ThreeTestOceanWaterHelperOptions) {
    this.scene = options.scene;
    this.keyLight = options.keyLight;
    this.skyTopColor = options.skyTopColor;
    this.skyHorizonColor = options.skyHorizonColor;
  }

  public setNormalMaps(normal1: THREE.Texture, normal2: THREE.Texture): void {
    this.normal1 = normal1;
    this.normal2 = normal2;
    if (this.uniforms) {
      this.uniforms.u_normalMap1.value = normal1;
      this.uniforms.u_normalMap2.value = normal2;
    }
  }

  public setQuality(qualityUniform: number): void {
    if (this.uniforms) {
      this.uniforms.u_quality.value = qualityUniform;
    }
  }

  public setLightDirectionFromKeyLight(): void {
    if (!this.uniforms) {
      return;
    }
    this.uniforms.u_lightDir.value.copy(this.keyLight.position).normalize();
  }

  public update(timeMs: number): void {
    if (this.uniforms) {
      this.uniforms.u_time.value = timeMs * 0.001;
    }
  }

  public clear(): void {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      disposeMaterial(this.mesh.material);
      this.mesh = null;
      this.uniforms = null;
    }
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

    this.uniforms = {
      u_time: { value: 0 },
      u_mask: { value: this.mask },
      u_supportMap: { value: this.supportMap },
      u_domainMap: { value: this.domainMap },
      u_shoreSdf: { value: this.shoreSdf },
      u_color: { value: new THREE.Color(0x2f87c8) },
      u_deepColor: { value: new THREE.Color(0x1b5078) },
      u_opacity: { value: 0.985 },
      u_waveScale: { value: 0.38 },
      u_normalMap1: { value: this.normal1 as THREE.Texture },
      u_normalMap2: { value: this.normal2 as THREE.Texture },
      u_scroll1: { value: new THREE.Vector2(0.02, 0.01) },
      u_scroll2: { value: new THREE.Vector2(-0.015, 0.018) },
      u_normalScale: { value: 0.08 },
      u_normalStrength: { value: 1.0 },
      u_shininess: { value: 72.0 },
      u_lightDir: { value: this.keyLight.position.clone().normalize() },
      u_specular: { value: 0.42 },
      u_skyTopColor: { value: new THREE.Color(this.skyTopColor) },
      u_skyHorizonColor: { value: new THREE.Color(this.skyHorizonColor) },
      u_sunColor: { value: new THREE.Color(0xfff0cf) },
      u_waveAmp: { value: 0.088 },
      u_waveFreq: { value: new THREE.Vector2(0.44, 0.39) },
      u_waveVariance: { value: 1.62 },
      u_cellGrid: {
        value: new THREE.Vector2(
          Math.max(6, Math.floor((ocean.sampleCols - 1) * 0.5)),
          Math.max(6, Math.floor((ocean.sampleRows - 1) * 0.5))
        )
      },
      u_worldStep: {
        value: new THREE.Vector2(
          Math.max(0.1, ocean.width / Math.max(1, ocean.sampleCols - 1)),
          Math.max(0.1, ocean.depth / Math.max(1, ocean.sampleRows - 1))
        )
      },
      u_uvStep: {
        value: new THREE.Vector2(
          1 / Math.max(1, ocean.sampleCols - 1),
          1 / Math.max(1, ocean.sampleRows - 1)
        )
      },
      u_tideAmp: { value: 0.036 },
      u_tideFreq: { value: 0.38 },
      u_quality: { value: qualityUniform }
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms as any,
      transparent: true,
      depthWrite: false,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vGeomNormal;
        varying float vDisp;
        varying float vSdf;
        varying float vOcean;
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
        float hash21(vec2 p) {
          vec2 q = fract(p * vec2(123.34, 456.21));
          q += dot(q, q + 45.32);
          return fract(q.x * q.y);
        }
        float computeDisplacement(vec3 p, vec2 uvCoord, float ocean, float shoreDamp, float qualityFactor, float highQuality) {
          float waveA = sin((p.x * u_waveFreq.x) + u_time * 0.75) * cos((p.z * u_waveFreq.y) - u_time * 0.62);
          float waveB = sin((p.x + p.z) * (u_waveFreq.x * 0.58) + u_time * 1.12);
          vec2 cellCoord = floor(uvCoord * u_cellGrid);
          float cellNoiseA = hash21(cellCoord + vec2(0.17, 0.61));
          float cellNoiseB = hash21(cellCoord.yx + vec2(2.91, 1.37));
          float cellAmp = mix(0.82, 1.32, cellNoiseA);
          float cellWaveA = sin(p.x * (u_waveFreq.x * 1.8) + p.z * (u_waveFreq.y * 1.4) + u_time * (0.9 + cellNoiseA * 0.7));
          float cellWaveB = cos(p.x * (u_waveFreq.x * 2.1) - p.z * (u_waveFreq.y * 1.9) - u_time * (1.05 + cellNoiseB * 0.65));
          float cellWave = (cellWaveA * 0.62 + cellWaveB * 0.38) * cellAmp;
          float tide = sin(u_time * u_tideFreq);
          float displacement =
            ocean * shoreDamp * qualityFactor *
            (((waveA + waveB * (0.55 + 0.2 * highQuality)) + cellWave * u_waveVariance * (0.72 + 0.4 * highQuality)) * u_waveAmp + tide * u_tideAmp);
          float troughLimit = u_waveAmp * mix(0.18, 0.33, highQuality) * (0.66 + 0.34 * shoreDamp);
          float crestLimit = u_waveAmp * (4.1 + 0.85 * highQuality);
          float crestBias = ocean * shoreDamp * qualityFactor * u_waveAmp * 0.4;
          return clamp(displacement + crestBias, -troughLimit, crestLimit);
        }
        void main() {
          vUv = uv;
          float ocean = texture2D(u_domainMap, vUv).r;
          float sdf = texture2D(u_shoreSdf, vUv).r * 2.0 - 1.0;
          float qualityFactor = step(0.5, u_quality);
          float highQuality = step(1.5, u_quality);
          float shoreDamp = smoothstep(0.02, 0.2, max(0.0, sdf));
          float displacement = computeDisplacement(position, vUv, ocean, shoreDamp, qualityFactor, highQuality);
          float dispX = computeDisplacement(position + vec3(u_worldStep.x, 0.0, 0.0), vUv + vec2(u_uvStep.x, 0.0), ocean, shoreDamp, qualityFactor, highQuality);
          float dispZ = computeDisplacement(position + vec3(0.0, 0.0, u_worldStep.y), vUv + vec2(0.0, u_uvStep.y), ocean, shoreDamp, qualityFactor, highQuality);
          vec3 tangentX = vec3(u_worldStep.x, dispX - displacement, 0.0);
          vec3 tangentZ = vec3(0.0, dispZ - displacement, u_worldStep.y);
          vec3 geomNormalLocal = cross(tangentZ, tangentX);
          if (length(geomNormalLocal) < 1e-4) {
            geomNormalLocal = vec3(0.0, 1.0, 0.0);
          }
          geomNormalLocal = normalize(geomNormalLocal);
          vec3 displaced = position;
          displaced.y += displacement;
          vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
          vWorldPos = worldPos.xyz;
          vGeomNormal = normalize(mat3(modelMatrix) * geomNormalLocal);
          vDisp = displacement;
          vSdf = sdf;
          vOcean = ocean;
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
        uniform sampler2D u_mask;
        uniform sampler2D u_supportMap;
        uniform sampler2D u_domainMap;
        uniform vec3 u_color;
        uniform vec3 u_deepColor;
        uniform float u_opacity;
        uniform float u_time;
        uniform float u_waveScale;
        uniform float u_normalScale;
        uniform float u_normalStrength;
        uniform float u_shininess;
        uniform vec3 u_lightDir;
        uniform float u_specular;
        uniform vec3 u_skyTopColor;
        uniform vec3 u_skyHorizonColor;
        uniform vec3 u_sunColor;
        uniform sampler2D u_normalMap1;
        uniform sampler2D u_normalMap2;
        uniform vec2 u_scroll1;
        uniform vec2 u_scroll2;
        uniform float u_quality;
        void main() {
          float support = texture2D(u_supportMap, vUv).r;
          if (support < 0.5) discard;
          float mask = texture2D(u_mask, vUv).a;
          float domainWater = texture2D(u_domainMap, vUv).b;
          float shoreFade = smoothstep(-0.02, 0.08, vSdf);
          float alpha = u_opacity * max(mask * mix(0.34, 1.0, shoreFade), domainWater * 0.92);
          if (alpha < 0.01) discard;
          vec2 worldUv = vWorldPos.xz * u_waveScale;
          float viewDist = length(cameraPosition - vWorldPos);
          float farT = smoothstep(70.0, 240.0, viewDist);
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float grazing = 1.0 - clamp(abs(viewDir.y), 0.0, 1.0);
          vec2 uv1 = worldUv * 6.2 + u_scroll1 * (u_time * 2.1);
          vec2 uv2 = worldUv * 9.4 + u_scroll2 * (u_time * 2.7);
          vec2 farUv = worldUv * 0.56;
          vec2 uvFar1 = farUv * 2.2 + u_scroll1 * (u_time * 0.72);
          vec2 uvFar2 = farUv * 3.1 + u_scroll2 * (u_time * 0.86);
          vec2 nearXY = texture2D(u_normalMap1, uv1).xy * 2.0 - 1.0 + (texture2D(u_normalMap2, uv2).xy * 2.0 - 1.0) * 0.9;
          vec2 farXY = texture2D(u_normalMap1, uvFar1).xy * 2.0 - 1.0 + (texture2D(u_normalMap2, uvFar2).xy * 2.0 - 1.0) * 0.85;
          vec2 nXY = mix(nearXY, farXY, farT * 0.88);
          float qualityFactor = step(0.5, u_quality);
          float normalScale = u_normalScale * (0.7 + qualityFactor * 0.6) * (1.0 + farT * 0.28) * (1.0 + grazing * 0.42);
          vec3 normalMapN = normalize(vec3(nXY.x * normalScale * u_normalStrength, 1.0, nXY.y * normalScale * u_normalStrength));
          vec3 geomN = normalize(vGeomNormal);
          vec3 n = normalize(mix(geomN, normalMapN, clamp(0.68 + qualityFactor * 0.22 - grazing * 0.1, 0.54, 0.9)));
          vec3 lightDir = normalize(u_lightDir);
          float diffuse = max(dot(n, lightDir), 0.0);
          vec3 halfDir = normalize(lightDir + viewDir);
          float specBase = pow(max(dot(n, halfDir), 0.0), max(1.0, u_shininess));
          float crestMask = clamp(smoothstep(0.012, 0.08, max(0.0, vDisp)) * 0.7 + smoothstep(0.997, 0.82, geomN.y) * 0.3, 0.0, 1.0);
          float spec = specBase * u_specular * (0.25 + qualityFactor * 0.34) * mix(0.14, 1.0, crestMask) * (0.72 + 0.6 * grazing);
          float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 4.0);
          float shoreDist = max(0.0, vSdf);
          float depthFactor = clamp(pow(shoreDist, 0.55), 0.0, 1.0);
          vec3 baseColor = mix(u_color, u_deepColor, depthFactor * (0.28 + 0.32 * vOcean));
          float foamBand = 1.0 - smoothstep(0.01, 0.19, shoreDist);
          float lappingA = sin(u_time * 1.9 + dot(vWorldPos.xz, vec2(1.9, 1.3))) * 0.5 + 0.5;
          float lappingB = sin(u_time * 2.7 - dot(vWorldPos.xz, vec2(1.1, -1.7))) * 0.5 + 0.5;
          float foam = foamBand * (0.26 + (lappingA * 0.65 + lappingB * 0.35) * 0.54) * (0.32 + qualityFactor * 0.48);
          vec3 foamColor = vec3(0.95, 0.98, 1.0);
          vec3 litBase = mix(baseColor, foamColor, clamp(foam, 0.0, 1.0) * 0.52);
          float skyT = clamp(0.58 + 0.42 * viewDir.y, 0.0, 1.0);
          vec3 skyReflect = mix(u_skyHorizonColor, u_skyTopColor, skyT);
          float sunExp = mix(160.0, 88.0, grazing);
          float sunGlitter = pow(max(dot(reflect(-viewDir, n), lightDir), 0.0), sunExp) * (0.08 + 0.92 * vOcean) * (0.2 + 0.8 * crestMask) * (0.7 + 0.5 * grazing);
          vec3 reflection = skyReflect * (fresnel * 0.3) + u_sunColor * (sunGlitter * 0.18);
          vec3 color = litBase * (0.8 + diffuse * 0.24) + skyReflect * (0.05 + 0.03 * grazing) + reflection + u_sunColor * spec;
          gl_FragColor = vec4(color, alpha);
        }
      `
    });
    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = baseMesh.position.y + ocean.level;
    this.mesh.renderOrder = 2;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.scene.add(this.mesh);
  }
}
