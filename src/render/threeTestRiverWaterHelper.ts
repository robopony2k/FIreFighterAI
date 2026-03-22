import * as THREE from "three";
import type { RiverWaterData } from "./threeTestTerrain.js";
import {
  DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS,
  type TerrainWaterDebugControls
} from "./terrainWaterDebug.js";

type RiverUniforms = {
  u_time: { value: number };
  u_color: { value: THREE.Color };
  u_deepColor: { value: THREE.Color };
  u_opacity: { value: number };
  u_normalMap1: { value: THREE.Texture };
  u_normalMap2: { value: THREE.Texture };
  u_waveScale: { value: number };
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
  u_quality: { value: number };
  u_waterfallInfluenceMap: { value: THREE.Texture };
  u_flowSpeedScale: { value: number };
  u_normalStrengthScale: { value: number };
  u_foamScale: { value: number };
  u_specularScale: { value: number };
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

type ThreeTestRiverWaterHelperOptions = {
  scene: THREE.Scene;
  keyLight: THREE.DirectionalLight;
  skyTopColor: number;
  skyHorizonColor: number;
  fogColor: THREE.ColorRepresentation;
  fogNear: number;
  fogFar: number;
};

type RiverWaterPalette = {
  skyTopColor: THREE.ColorRepresentation;
  skyHorizonColor: THREE.ColorRepresentation;
  shallowColor: THREE.ColorRepresentation;
  deepColor: THREE.ColorRepresentation;
  sunColor: THREE.ColorRepresentation;
};

type RiverWaterFog = {
  color: THREE.ColorRepresentation;
  near: number;
  far: number;
};

export class ThreeTestRiverWaterHelper {
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
  private wallMesh: THREE.Mesh | null = null;
  private uniforms: RiverUniforms | null = null;
  private normal1: THREE.Texture | null = null;
  private normal2: THREE.Texture | null = null;
  private supportMap: THREE.Texture | null = null;
  private flowMap: THREE.Texture | null = null;
  private rapidMap: THREE.Texture | null = null;
  private riverBankMap: THREE.Texture | null = null;
  private waterfallInfluenceMap: THREE.Texture | null = null;
  private debugControls: TerrainWaterDebugControls = { ...DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS };

  constructor(options: ThreeTestRiverWaterHelperOptions) {
    this.scene = options.scene;
    this.keyLight = options.keyLight;
    this.currentPalette = {
      skyTopColor: new THREE.Color(options.skyTopColor),
      skyHorizonColor: new THREE.Color(options.skyHorizonColor),
      shallowColor: new THREE.Color(0x3f86bf),
      deepColor: new THREE.Color(0x1a4d79),
      sunColor: new THREE.Color(0xfff0cf)
    };
    this.fogState = {
      color: new THREE.Color(options.fogColor),
      near: options.fogNear,
      far: options.fogFar
    };
  }

  public setPalette(palette: RiverWaterPalette): void {
    this.currentPalette.skyTopColor.set(palette.skyTopColor);
    this.currentPalette.skyHorizonColor.set(palette.skyHorizonColor);
    this.currentPalette.shallowColor.set(palette.shallowColor);
    this.currentPalette.deepColor.set(palette.deepColor);
    this.currentPalette.sunColor.set(palette.sunColor);
    if (!this.uniforms) {
      return;
    }
    this.uniforms.u_skyTopColor.value.copy(this.currentPalette.skyTopColor);
    this.uniforms.u_skyHorizonColor.value.copy(this.currentPalette.skyHorizonColor);
    this.uniforms.u_color.value.copy(this.currentPalette.shallowColor);
    this.uniforms.u_deepColor.value.copy(this.currentPalette.deepColor);
    this.uniforms.u_sunColor.value.copy(this.currentPalette.sunColor);
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

  public setDebugControls(controls: TerrainWaterDebugControls): void {
    this.debugControls = { ...controls };
    if (this.mesh) {
      this.mesh.visible = this.debugControls.showRiver;
    }
    if (this.wallMesh) {
      this.wallMesh.visible = this.debugControls.showRiver;
    }
    if (!this.uniforms) {
      return;
    }
    this.uniforms.u_flowSpeedScale.value = this.debugControls.riverFlowSpeedScale;
    this.uniforms.u_normalStrengthScale.value = this.debugControls.riverNormalStrengthScale;
    this.uniforms.u_foamScale.value = this.debugControls.riverFoamScale;
    this.uniforms.u_specularScale.value = this.debugControls.riverSpecularScale;
  }

  public setFog(fog: RiverWaterFog): void {
    this.fogState.color.set(fog.color);
    this.fogState.near = fog.near;
    this.fogState.far = fog.far;
    if (!this.uniforms) {
      return;
    }
    this.uniforms.u_fogColor.value.copy(this.fogState.color);
    this.uniforms.u_fogNear.value = this.fogState.near;
    this.uniforms.u_fogFar.value = this.fogState.far;
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
    if (this.wallMesh) {
      this.scene.remove(this.wallMesh);
      this.wallMesh.geometry.dispose();
      disposeMaterial(this.wallMesh.material);
      this.wallMesh = null;
    }
    disposeTexture(this.supportMap);
    disposeTexture(this.flowMap);
    disposeTexture(this.rapidMap);
    disposeTexture(this.riverBankMap);
    disposeTexture(this.waterfallInfluenceMap);
    this.supportMap = null;
    this.flowMap = null;
    this.rapidMap = null;
    this.riverBankMap = null;
    this.waterfallInfluenceMap = null;
  }

  public dispose(): void {
    this.clear();
  }

  public rebuild(baseMesh: THREE.Mesh, river: RiverWaterData, qualityUniform: number): void {
    this.clear();
    this.supportMap = river.supportMap;
    this.flowMap = river.flowMap;
    this.rapidMap = river.rapidMap;
    this.riverBankMap = river.riverBankMap;
    this.waterfallInfluenceMap = river.waterfallInfluenceMap;

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(river.positions, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(river.uvs, 2));
    geometry.setAttribute("a_bankDist", new THREE.BufferAttribute(river.bankDist, 1));
    geometry.setAttribute("a_flowDir", new THREE.BufferAttribute(river.flowDir, 2));
    geometry.setAttribute("a_flowSpeed", new THREE.BufferAttribute(river.flowSpeed, 1));
    geometry.setAttribute("a_rapid", new THREE.BufferAttribute(river.rapid, 1));
    geometry.setIndex(new THREE.BufferAttribute(river.indices, 1));
    geometry.computeVertexNormals();

    this.uniforms = {
      u_time: { value: 0 },
      u_color: { value: this.currentPalette.shallowColor.clone() },
      u_deepColor: { value: this.currentPalette.deepColor.clone() },
      u_opacity: { value: 0.95 },
      u_normalMap1: { value: this.normal1 as THREE.Texture },
      u_normalMap2: { value: this.normal2 as THREE.Texture },
      u_waveScale: { value: 0.34 },
      u_scroll1: { value: new THREE.Vector2(0.014, 0.01) },
      u_scroll2: { value: new THREE.Vector2(-0.013, 0.016) },
      u_normalScale: { value: 0.07 },
      u_normalStrength: { value: 1.1 },
      u_shininess: { value: 54 },
      u_lightDir: { value: this.keyLight.position.clone().normalize() },
      u_specular: { value: 0.36 },
      u_skyTopColor: { value: this.currentPalette.skyTopColor.clone() },
      u_skyHorizonColor: { value: this.currentPalette.skyHorizonColor.clone() },
      u_sunColor: { value: this.currentPalette.sunColor.clone() },
      u_fogColor: { value: this.fogState.color.clone() },
      u_fogNear: { value: this.fogState.near },
      u_fogFar: { value: this.fogState.far },
      u_quality: { value: qualityUniform },
      u_waterfallInfluenceMap: { value: this.waterfallInfluenceMap },
      u_flowSpeedScale: { value: this.debugControls.riverFlowSpeedScale },
      u_normalStrengthScale: { value: this.debugControls.riverNormalStrengthScale },
      u_foamScale: { value: this.debugControls.riverFoamScale },
      u_specularScale: { value: this.debugControls.riverSpecularScale }
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms as any,
      transparent: false,
      depthWrite: true,
      depthTest: true,
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vGeomNormal;
        varying float vDisp;
        varying float vBankDist;
        varying vec2 vFlowDir;
        varying float vFlowSpeed;
        varying float vRapid;
        uniform float u_time;
        uniform float u_quality;
        uniform float u_flowSpeedScale;
        attribute float a_bankDist;
        attribute vec2 a_flowDir;
        attribute float a_flowSpeed;
        attribute float a_rapid;
        float sampleRiverWave(
          vec2 worldXZ,
          vec2 flowN,
          float centerFactor,
          float speedFactor,
          float rapid,
          float qualityFactor
        ) {
          vec2 crossDir = vec2(-flowN.y, flowN.x);
          float downstream = dot(worldXZ, flowN);
          float across = dot(worldXZ, crossDir);
          float broadPhase = downstream * 0.22 - u_time * (1.0 + speedFactor * 1.08);
          float crestPhase = downstream * 0.44 - u_time * (1.52 + speedFactor * 1.46 + rapid * 0.62) + across * 0.035;
          float chopPhase = downstream * 0.78 - u_time * (2.18 + speedFactor * 1.94 + rapid * 1.14) - across * 0.075;
          float broad = sin(broadPhase);
          float crest = sin(crestPhase);
          float chop = sin(chopPhase);
          float sharpened = max(0.0, crest);
          sharpened *= sharpened;
          float amplitude = mix(0.0038, 0.0145, centerFactor) * qualityFactor;
          amplitude *= mix(0.86, 1.18, clamp((speedFactor - 0.25) / 3.15, 0.0, 1.0));
          amplitude *= 0.92 + rapid * 0.4;
          return (broad * 0.58 + crest * 0.24 + chop * 0.1 + sharpened * 0.18) * amplitude;
        }
        void main() {
          vUv = uv;
          vBankDist = a_bankDist;
          vFlowDir = a_flowDir;
          vFlowSpeed = a_flowSpeed;
          vRapid = a_rapid;
          float detailFactor = clamp(u_quality * 0.5, 0.0, 1.0);
          float qualityFactor = mix(0.68, 1.0, detailFactor);
          float centerFactor = smoothstep(0.08, 0.6, a_bankDist);
          float speedFactor = clamp(a_flowSpeed * u_flowSpeedScale, 0.25, 3.4);
          vec2 flowN = normalize(a_flowDir + vec2(1e-4, 0.0));
          vec2 worldXZ = (modelMatrix * vec4(position, 1.0)).xz;
          float waveDisp = sampleRiverWave(worldXZ, flowN, centerFactor, speedFactor, a_rapid, qualityFactor);
          vec3 displaced = position + vec3(0.0, waveDisp, 0.0);
          const float sampleStep = 0.65;
          float dispX = sampleRiverWave(worldXZ + vec2(sampleStep, 0.0), flowN, centerFactor, speedFactor, a_rapid, qualityFactor);
          float dispZ = sampleRiverWave(worldXZ + vec2(0.0, sampleStep), flowN, centerFactor, speedFactor, a_rapid, qualityFactor);
          vec3 tangentX = vec3(sampleStep, dispX - waveDisp, 0.0);
          vec3 tangentZ = vec3(0.0, dispZ - waveDisp, sampleStep);
          vec3 geomNormalLocal = cross(tangentZ, tangentX);
          if (length(geomNormalLocal) < 1e-4) {
            geomNormalLocal = vec3(0.0, 1.0, 0.0);
          }
          geomNormalLocal = normalize(geomNormalLocal);
          vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
          vWorldPos = worldPos.xyz;
          vGeomNormal = normalize(mat3(modelMatrix) * geomNormalLocal);
          vDisp = waveDisp;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying vec3 vWorldPos;
        varying vec3 vGeomNormal;
        varying float vDisp;
        varying float vBankDist;
        varying vec2 vFlowDir;
        varying float vFlowSpeed;
        varying float vRapid;
        uniform float u_time;
        uniform vec3 u_color;
        uniform vec3 u_deepColor;
        uniform float u_opacity;
        uniform sampler2D u_normalMap1;
        uniform sampler2D u_normalMap2;
        uniform float u_waveScale;
        uniform vec2 u_scroll1;
        uniform vec2 u_scroll2;
        uniform float u_normalScale;
        uniform float u_normalStrength;
        uniform float u_shininess;
        uniform vec3 u_lightDir;
        uniform float u_specular;
        uniform vec3 u_skyTopColor;
        uniform vec3 u_skyHorizonColor;
        uniform vec3 u_sunColor;
        uniform vec3 u_fogColor;
        uniform float u_fogNear;
        uniform float u_fogFar;
        uniform float u_quality;
        uniform sampler2D u_waterfallInfluenceMap;
        uniform float u_flowSpeedScale;
        uniform float u_normalStrengthScale;
        uniform float u_foamScale;
        uniform float u_specularScale;
        void main() {
          float qualityFactor = step(0.5, u_quality);
          float edge = smoothstep(0.02, 0.25, vBankDist);
          float edgeFeather = smoothstep(0.0, 0.14, vBankDist);
          vec2 worldUv = vWorldPos.xz * u_waveScale;
          vec2 flowN = normalize(vFlowDir + vec2(1e-4));
          float flowSpeed = clamp(vFlowSpeed * u_flowSpeedScale, 0.25, 3.4);
          vec2 flowOffset = flowN * (u_time * (0.07 + vRapid * 0.2) * flowSpeed);
          vec2 uv1 = worldUv * 8.0 + flowOffset * 1.7 + u_scroll1 * (u_time * 1.8);
          vec2 uv2 = worldUv * 10.4 - flowOffset.yx * 1.4 + u_scroll2 * (u_time * 2.2);
          vec2 nXY = texture2D(u_normalMap1, uv1).xy * 2.0 - 1.0 + (texture2D(u_normalMap2, uv2).xy * 2.0 - 1.0) * 0.85;
          vec3 viewDir = normalize(cameraPosition - vWorldPos);
          float viewDist = length(cameraPosition - vWorldPos);
          float grazing = 1.0 - clamp(abs(viewDir.y), 0.0, 1.0);
          vec3 normalMapN = normalize(
            vec3(
              nXY.x * u_normalScale * u_normalStrength * u_normalStrengthScale,
              1.0,
              nXY.y * u_normalScale * u_normalStrength * u_normalStrengthScale
            )
          );
          vec3 geomN = normalize(vGeomNormal);
          float crestMask = clamp(
            smoothstep(0.0025, 0.0155, max(0.0, vDisp)) * 0.76 + smoothstep(0.998, 0.88, geomN.y) * 0.24,
            0.0,
            1.0
          );
          vec3 n = normalize(mix(geomN, normalMapN, 0.68));
          vec3 lightDir = normalize(u_lightDir);
          float diffuse = max(dot(n, lightDir), 0.0);
          vec3 halfDir = normalize(lightDir + viewDir);
          float specBase = pow(max(dot(n, halfDir), 0.0), max(1.0, u_shininess));
          vec4 fall = texture2D(u_waterfallInfluenceMap, vUv);
          float lipFoam = smoothstep(0.06, 0.7, fall.r);
          float plungeFoam = smoothstep(0.05, 0.82, fall.g);
          float seamRapid = smoothstep(0.05, 0.78, fall.a);
          float fallBoost = clamp(fall.b * 1.35 + lipFoam * 0.28 + plungeFoam * 0.42, 0.0, 1.0);
          float rapid = clamp(vRapid * (0.68 + qualityFactor * 0.38) + fallBoost * 0.62 + seamRapid * 0.82 + plungeFoam * 0.2, 0.0, 1.0);
          float spec = specBase * u_specular * u_specularScale * (0.4 + rapid * 0.8 + seamRapid * 0.26) * (0.7 + 0.45 * grazing);
          spec *= mix(0.82, 1.14, crestMask);
          float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.5);
          vec3 baseColor = mix(u_color, u_deepColor, clamp(1.0 - edge * 1.2, 0.0, 1.0) * 0.42);
          float centerBand = smoothstep(0.08, 0.55, vBankDist) * (1.0 - smoothstep(0.62, 0.95, vBankDist));
          float ripplePhase = dot(worldUv, flowN * 18.0) - u_time * (2.4 + flowSpeed * 1.6);
          float centerRipple = 0.5 + 0.5 * sin(ripplePhase);
          float seamPulse = 0.5 + 0.5 * sin(ripplePhase * 1.45 + u_time * 5.2);
          float foam =
            ((1.0 - edge) * (0.1 + rapid * 0.28) + rapid * 0.14 + centerBand * centerRipple * (0.05 + rapid * 0.09)) *
            u_foamScale;
          foam += crestMask * (0.05 + rapid * 0.07 + centerBand * 0.03) * u_foamScale;
          foam += seamRapid * (0.18 + seamPulse * 0.24 + centerBand * 0.06) * u_foamScale;
          foam += lipFoam * (0.28 + seamPulse * 0.34) * u_foamScale;
          foam += plungeFoam * (0.46 + seamPulse * 0.52) * u_foamScale;
          vec3 foamColor = vec3(0.93, 0.97, 1.0);
          vec3 litBase = mix(baseColor, foamColor, clamp(foam, 0.0, 1.0) * (0.5 + edgeFeather * 0.1));
          litBase = mix(litBase, foamColor, clamp(seamRapid * 0.34 + lipFoam * 0.42 + plungeFoam * 0.7, 0.0, 0.92));
          litBase = mix(litBase, foamColor, crestMask * 0.12);
          float skyT = clamp(0.58 + 0.42 * viewDir.y, 0.0, 1.0);
          vec3 skyReflect = mix(u_skyHorizonColor, u_skyTopColor, skyT);
          float sunGlitter = pow(max(dot(reflect(-viewDir, n), lightDir), 0.0), mix(130.0, 74.0, grazing)) * (0.24 + rapid * 0.7);
          vec3 reflection = skyReflect * (fresnel * 0.22) + u_sunColor * (sunGlitter * 0.12);
          float flowShade = clamp(0.96 + vDisp * 8.0 + (1.0 - geomN.y) * 0.28 + seamRapid * 0.08, 0.88, 1.22);
          vec3 color = litBase * (0.82 + diffuse * 0.2) * flowShade + reflection + u_sunColor * spec;
          float fogFactor = pow(smoothstep(u_fogNear, u_fogFar, viewDist), 1.15);
          color = mix(color, u_fogColor, fogFactor);
          gl_FragColor = vec4(color, 1.0);
        }
      `
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.mesh.position.y = baseMesh.position.y + river.level;
    this.mesh.renderOrder = 3;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.visible = this.debugControls.showRiver;
    this.scene.add(this.mesh);

    if (river.wallPositions && river.wallUvs && river.wallIndices) {
      const wallGeometry = new THREE.BufferGeometry();
      wallGeometry.setAttribute("position", new THREE.BufferAttribute(river.wallPositions, 3));
      wallGeometry.setAttribute("uv", new THREE.BufferAttribute(river.wallUvs, 2));
      wallGeometry.setIndex(new THREE.BufferAttribute(river.wallIndices, 1));
      wallGeometry.computeVertexNormals();
      const wallMaterial = new THREE.MeshStandardMaterial({
        color: 0x8f825f,
        roughness: 0.9,
        metalness: 0.02,
        depthWrite: true,
        depthTest: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        side: THREE.DoubleSide
      });
      this.wallMesh = new THREE.Mesh(wallGeometry, wallMaterial);
      this.wallMesh.position.y = baseMesh.position.y + river.level;
      this.wallMesh.renderOrder = 2;
      this.wallMesh.castShadow = false;
      this.wallMesh.receiveShadow = true;
      this.wallMesh.visible = this.debugControls.showRiver;
      this.scene.add(this.wallMesh);
    }
    this.setDebugControls(this.debugControls);
  }
}
