import * as THREE from "three";
import {
  DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS,
  type TerrainWaterDebugControls
} from "./terrainWaterDebug.js";

const WATERFALL_INSTANCE_STRIDE = 7;

type WaterfallUniforms = {
  u_time: { value: number };
  u_color: { value: THREE.Color };
  u_opacity: { value: number };
  u_fogColor: { value: THREE.Color };
  u_fogNear: { value: number };
  u_fogFar: { value: number };
  u_quality: { value: number };
  u_foamScale: { value: number };
  u_mistScale: { value: number };
  u_speedScale: { value: number };
};

type WaterfallImpactUniforms = {
  u_time: { value: number };
  u_color: { value: THREE.Color };
  u_edgeColor: { value: THREE.Color };
  u_opacity: { value: number };
  u_fogColor: { value: THREE.Color };
  u_fogNear: { value: number };
  u_fogFar: { value: number };
  u_quality: { value: number };
  u_foamScale: { value: number };
  u_mistScale: { value: number };
  u_speedScale: { value: number };
};

const disposeMaterial = (material: THREE.Material | THREE.Material[]): void => {
  if (Array.isArray(material)) {
    material.forEach((entry) => entry.dispose());
    return;
  }
  material.dispose();
};

const fract = (value: number): number => value - Math.floor(value);

const seededNoise = (seed: number): number => fract(Math.sin(seed * 127.1 + 311.7) * 43758.5453123);
const WATERFALL_IMPACT_PARTICLE_BUDGET_BALANCED = 224;
const WATERFALL_IMPACT_PARTICLE_BUDGET_HIGH = 384;
const WATERFALL_IMPACT_PER_FALL_CAP_BALANCED = 16;
const WATERFALL_IMPACT_PER_FALL_CAP_HIGH = 24;
const WATERFALL_IMPACT_POINT_SIZE_MAX = 72;
const WATERFALL_VISUAL_FALLSTYLE_MIN = 0.55;

type ThreeTestWaterfallHelperOptions = {
  scene: THREE.Scene;
  fogColor: THREE.ColorRepresentation;
  fogNear: number;
  fogFar: number;
};

type WaterfallFog = {
  color: THREE.ColorRepresentation;
  near: number;
  far: number;
};

export class ThreeTestWaterfallHelper {
  private readonly scene: THREE.Scene;
  private mesh: THREE.InstancedMesh | null = null;
  private uniforms: WaterfallUniforms | null = null;
  private impactPoints: THREE.Points | null = null;
  private impactUniforms: WaterfallImpactUniforms | null = null;
  private readonly dummy = new THREE.Object3D();
  private fogState: {
    color: THREE.Color;
    near: number;
    far: number;
  };
  private qualityUniform = 1;
  private sourceInstances: Float32Array | null = null;
  private sourceLevel = 0;
  private sourceBaseMeshY = 0;
  private dropNormAttr: THREE.InstancedBufferAttribute | null = null;
  private fallStyleAttr: THREE.InstancedBufferAttribute | null = null;
  private debugControls: TerrainWaterDebugControls = { ...DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS };

  constructor(options: ThreeTestWaterfallHelperOptions) {
    this.scene = options.scene;
    this.fogState = {
      color: new THREE.Color(options.fogColor),
      near: options.fogNear,
      far: options.fogFar
    };
  }

  public setQuality(qualityUniform: number): void {
    this.qualityUniform = qualityUniform;
    if (this.uniforms) {
      this.uniforms.u_quality.value = qualityUniform;
    }
    if (this.impactUniforms) {
      this.impactUniforms.u_quality.value = qualityUniform;
    }
    this.syncVisibility();
  }

  public setDebugControls(controls: TerrainWaterDebugControls): void {
    const widthChanged = Math.abs(this.debugControls.waterfallWidthScale - controls.waterfallWidthScale) > 1e-4;
    this.debugControls = { ...controls };
    this.applyDebugUniforms();
    if (widthChanged) {
      this.applyInstanceTransforms();
    }
    this.syncVisibility();
  }

  public setFog(fog: WaterfallFog): void {
    this.fogState.color.set(fog.color);
    this.fogState.near = fog.near;
    this.fogState.far = fog.far;
    if (this.uniforms) {
      this.uniforms.u_fogColor.value.copy(this.fogState.color);
      this.uniforms.u_fogNear.value = this.fogState.near;
      this.uniforms.u_fogFar.value = this.fogState.far;
    }
    if (this.impactUniforms) {
      this.impactUniforms.u_fogColor.value.copy(this.fogState.color);
      this.impactUniforms.u_fogNear.value = this.fogState.near;
      this.impactUniforms.u_fogFar.value = this.fogState.far;
    }
  }

  public update(timeMs: number): void {
    if (this.uniforms) {
      this.uniforms.u_time.value = timeMs * 0.001;
    }
    if (this.impactUniforms) {
      this.impactUniforms.u_time.value = timeMs * 0.001;
    }
  }

  private syncVisibility(): void {
    if (this.mesh) {
      this.mesh.visible = this.qualityUniform > 0.5 && this.debugControls.showWaterfalls;
    }
    if (this.impactPoints) {
      this.impactPoints.visible = this.qualityUniform > 0.5 && this.debugControls.showWaterfalls;
    }
  }

  private applyDebugUniforms(): void {
    if (this.uniforms) {
      this.uniforms.u_opacity.value = 0.84 * this.debugControls.waterfallOpacityScale;
      this.uniforms.u_foamScale.value = this.debugControls.waterfallFoamScale;
      this.uniforms.u_mistScale.value = this.debugControls.waterfallMistScale;
      this.uniforms.u_speedScale.value = this.debugControls.waterfallSpeedScale;
    }
    if (this.impactUniforms) {
      this.impactUniforms.u_opacity.value = 0.68 * this.debugControls.waterfallOpacityScale;
      this.impactUniforms.u_foamScale.value = this.debugControls.waterfallFoamScale;
      this.impactUniforms.u_mistScale.value = this.debugControls.waterfallMistScale;
      this.impactUniforms.u_speedScale.value = this.debugControls.waterfallSpeedScale;
    }
  }

  private describeWaterfallShape(drop: number, halfWidth: number): {
    fallStyle: number;
    rapidness: number;
    run: number;
    sheetLength: number;
    pitch: number;
    widthScale: number;
    thickness: number;
    plungeForward: number;
  } {
    const aspect = drop / Math.max(0.12, halfWidth * 1.8);
    const fallStyle = THREE.MathUtils.clamp((aspect - 0.2) / 0.48, 0, 1);
    const rapidness = 1 - fallStyle;
    const apronRun = Math.max(halfWidth * 0.16, drop * 0.12);
    const curtainRun = Math.max(halfWidth * 0.06, drop * 0.035);
    const run = THREE.MathUtils.lerp(apronRun, curtainRun, fallStyle);
    const sheetLength = drop * THREE.MathUtils.lerp(1.03, 1.07, fallStyle);
    return {
      fallStyle,
      rapidness,
      run,
      sheetLength,
      pitch: 0,
      widthScale: THREE.MathUtils.lerp(1.12, 1.0, fallStyle),
      thickness: THREE.MathUtils.lerp(0.72, 1.02, fallStyle),
      plungeForward: run * THREE.MathUtils.lerp(0.82, 0.96, fallStyle)
    };
  }

  private applyInstanceTransforms(): void {
    if (!this.mesh || !this.sourceInstances) {
      return;
    }
    const waterfallCount = Math.floor(this.sourceInstances.length / WATERFALL_INSTANCE_STRIDE);
    for (let i = 0; i < waterfallCount; i += 1) {
      const base = i * WATERFALL_INSTANCE_STRIDE;
      const x = this.sourceInstances[base];
      const z = this.sourceInstances[base + 1];
      const top = this.sourceInstances[base + 2];
      const drop = Math.max(0.1, this.sourceInstances[base + 3]);
      const dirX = this.sourceInstances[base + 4];
      const dirZ = this.sourceInstances[base + 5];
      const halfWidth = Math.max(0.08, this.sourceInstances[base + 6]) * this.debugControls.waterfallWidthScale;
      const shape = this.describeWaterfallShape(drop, halfWidth);
      if (shape.fallStyle < WATERFALL_VISUAL_FALLSTYLE_MIN) {
        this.dummy.position.set(x, top + 0.012, z);
        this.dummy.rotation.set(0, 0, 0);
        this.dummy.scale.set(0.0001, 0.0001, 0.0001);
        this.dummy.updateMatrix();
        this.mesh.setMatrixAt(i, this.dummy.matrix);
        this.dropNormAttr?.setX(i, 0);
        this.fallStyleAttr?.setX(i, 0);
        continue;
      }
      const yaw = Math.atan2(dirX, dirZ);
      this.dummy.position.set(
        x,
        top + 0.012,
        z
      );
      this.dummy.rotation.set(0, yaw, 0);
      this.dummy.scale.set(halfWidth * 2.0 * shape.widthScale, shape.sheetLength, shape.thickness);
      this.dummy.updateMatrix();
      this.mesh.setMatrixAt(i, this.dummy.matrix);
      this.dropNormAttr?.setX(i, Math.min(1, drop / 1.6));
      this.fallStyleAttr?.setX(i, shape.fallStyle);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.dropNormAttr) {
      this.dropNormAttr.needsUpdate = true;
    }
    if (this.fallStyleAttr) {
      this.fallStyleAttr.needsUpdate = true;
    }
    this.mesh.position.y = this.sourceBaseMeshY + this.sourceLevel;
    this.rebuildImpactParticles();
  }

  private clearImpactPoints(): void {
    if (!this.impactPoints) {
      this.impactUniforms = null;
      return;
    }
    this.scene.remove(this.impactPoints);
    this.impactPoints.geometry.dispose();
    disposeMaterial(this.impactPoints.material);
    this.impactPoints = null;
    this.impactUniforms = null;
  }

  private rebuildImpactParticles(): void {
    this.clearImpactPoints();
    if (!this.sourceInstances || this.qualityUniform < 0.5) {
      return;
    }
    const waterfallCount = Math.floor(this.sourceInstances.length / WATERFALL_INSTANCE_STRIDE);
    if (waterfallCount <= 0) {
      return;
    }

    const particleBudget =
      this.qualityUniform > 1.5 ? WATERFALL_IMPACT_PARTICLE_BUDGET_HIGH : WATERFALL_IMPACT_PARTICLE_BUDGET_BALANCED;
    const perFallCap =
      this.qualityUniform > 1.5 ? WATERFALL_IMPACT_PER_FALL_CAP_HIGH : WATERFALL_IMPACT_PER_FALL_CAP_BALANCED;
    const counts = new Uint16Array(waterfallCount);
    let particleCount = 0;
    for (let i = 0; i < waterfallCount; i += 1) {
      const base = i * WATERFALL_INSTANCE_STRIDE;
      const drop = Math.max(0.1, this.sourceInstances[base + 3]);
      const halfWidth = Math.max(0.08, this.sourceInstances[base + 6]) * this.debugControls.waterfallWidthScale;
      const shape = this.describeWaterfallShape(drop, halfWidth);
      if (shape.fallStyle < WATERFALL_VISUAL_FALLSTYLE_MIN) {
        counts[i] = 0;
        continue;
      }
      const desiredCount = THREE.MathUtils.clamp(
        Math.round(4 + drop * (8 + shape.fallStyle * 8) + halfWidth * (4 + shape.fallStyle * 6)),
        4,
        perFallCap
      );
      const allowedCount = Math.max(0, Math.min(desiredCount, particleBudget - particleCount));
      counts[i] = allowedCount;
      particleCount += allowedCount;
      if (particleCount >= particleBudget) {
        break;
      }
    }
    if (particleCount <= 0) {
      return;
    }

    const positions = new Float32Array(particleCount * 3);
    const velocities = new Float32Array(particleCount * 3);
    const alpha = new Float32Array(particleCount);
    const size = new Float32Array(particleCount);
    const seed = new Float32Array(particleCount);
    const life = new Float32Array(particleCount);
    let cursor = 0;

    for (let i = 0; i < waterfallCount; i += 1) {
      const base = i * WATERFALL_INSTANCE_STRIDE;
      const x = this.sourceInstances[base];
      const z = this.sourceInstances[base + 1];
      const top = this.sourceInstances[base + 2];
      const drop = Math.max(0.1, this.sourceInstances[base + 3]);
      const dirX = this.sourceInstances[base + 4];
      const dirZ = this.sourceInstances[base + 5];
      const dirLength = Math.hypot(dirX, dirZ) || 1;
      const flowX = dirX / dirLength;
      const flowZ = dirZ / dirLength;
      const crossX = -flowZ;
      const crossZ = flowX;
      const halfWidth = Math.max(0.08, this.sourceInstances[base + 6]) * this.debugControls.waterfallWidthScale;
      const shape = this.describeWaterfallShape(drop, halfWidth);
      if (shape.fallStyle < WATERFALL_VISUAL_FALLSTYLE_MIN) {
        continue;
      }
      const baseX = x + flowX * shape.plungeForward;
      const baseY = top - drop + Math.min(0.04, drop * 0.16);
      const baseZ = z + flowZ * shape.plungeForward;
      const dropNorm = THREE.MathUtils.clamp(drop / 1.6, 0, 1);
      const localCount = counts[i] ?? 0;
      if (localCount <= 0) {
        continue;
      }

      for (let p = 0; p < localCount; p += 1) {
        const particleSeed = (i + 1) * 137.2 + (p + 1) * 19.7;
        const randA = seededNoise(particleSeed);
        const randB = seededNoise(particleSeed + 1.91);
        const randC = seededNoise(particleSeed + 4.37);
        const randD = seededNoise(particleSeed + 7.13);
        const randE = seededNoise(particleSeed + 9.71);
        const lateral =
          (randA * 2 - 1) *
          halfWidth *
          THREE.MathUtils.lerp(0.34, 0.88, shape.fallStyle) *
          (0.24 + randB * 0.94);
        const downstreamStart =
          (randC - 0.2) * Math.max(halfWidth * THREE.MathUtils.lerp(0.22, 0.44, shape.fallStyle), shape.run * 0.16);
        const spawnY = baseY + randD * Math.min(0.05, drop * 0.08);
        const sideVel = lateral * (0.14 + randE * THREE.MathUtils.lerp(0.12, 0.38, shape.fallStyle));
        const forwardVel =
          Math.max(0.05, shape.run * THREE.MathUtils.lerp(0.34, 0.58, shape.fallStyle)) * (0.62 + randB * 0.82);
        const upVel =
          Math.max(0.05, drop * THREE.MathUtils.lerp(0.12, 0.54, shape.fallStyle)) * (0.84 + randD * 1.04);
        const idx3 = cursor * 3;
        positions[idx3] = baseX + crossX * lateral + flowX * downstreamStart;
        positions[idx3 + 1] = spawnY;
        positions[idx3 + 2] = baseZ + crossZ * lateral + flowZ * downstreamStart;
        velocities[idx3] = crossX * sideVel + flowX * forwardVel;
        velocities[idx3 + 1] = upVel;
        velocities[idx3 + 2] = crossZ * sideVel + flowZ * forwardVel;
        alpha[cursor] = THREE.MathUtils.lerp(0.22, 0.92, dropNorm) * THREE.MathUtils.lerp(0.78, 1.0, shape.fallStyle) * (0.72 + randC * 0.22);
        size[cursor] = THREE.MathUtils.lerp(0.28, 2.2, dropNorm) * THREE.MathUtils.lerp(0.86, 1.18, shape.fallStyle) * (0.78 + randE * 0.54);
        seed[cursor] = randE;
        life[cursor] = THREE.MathUtils.lerp(0.46, 1.3, dropNorm) * (0.82 + randA * 0.4);
        cursor += 1;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aVelocity", new THREE.BufferAttribute(velocities, 3));
    geometry.setAttribute("aAlpha", new THREE.BufferAttribute(alpha, 1));
    geometry.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
    geometry.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geometry.setAttribute("aLife", new THREE.BufferAttribute(life, 1));
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) {
      geometry.boundingSphere.radius += 3.5;
    }

    this.impactUniforms = {
      u_time: { value: this.uniforms?.u_time.value ?? 0 },
      u_color: { value: new THREE.Color(0xf4fbff) },
      u_edgeColor: { value: new THREE.Color(0x9ccff7) },
      u_opacity: { value: 0.68 * this.debugControls.waterfallOpacityScale },
      u_fogColor: { value: this.fogState.color.clone() },
      u_fogNear: { value: this.fogState.near },
      u_fogFar: { value: this.fogState.far },
      u_quality: { value: this.qualityUniform },
      u_foamScale: { value: this.debugControls.waterfallFoamScale },
      u_mistScale: { value: this.debugControls.waterfallMistScale },
      u_speedScale: { value: this.debugControls.waterfallSpeedScale }
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.impactUniforms as any,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
      toneMapped: false,
      vertexShader: `
        varying float vAlpha;
        varying float vSeed;
        varying vec3 vWorldPos;
        attribute vec3 aVelocity;
        attribute float aAlpha;
        attribute float aSize;
        attribute float aSeed;
        attribute float aLife;
        uniform float u_time;
        uniform float u_opacity;
        uniform float u_quality;
        uniform float u_foamScale;
        uniform float u_mistScale;
        uniform float u_speedScale;
        void main() {
          float enabled = step(0.5, u_quality);
          float cycle = fract(u_time * (0.8 + aLife * 0.72) * u_speedScale + aSeed);
          float arc = sin(cycle * 3.14159265);
          float fade = pow(max(arc, 0.0), 1.45);
          vec3 splash = position + aVelocity * cycle;
          splash.y += arc * (0.05 + aLife * 0.18) - cycle * cycle * (0.08 + aLife * 0.2);
          vec4 worldPos = modelMatrix * vec4(splash, 1.0);
          vWorldPos = worldPos.xyz;
          vec4 mvPosition = viewMatrix * worldPos;
          float dist = max(1.0, -mvPosition.z);
          float sizeBoost =
            (0.86 + min(u_mistScale, 2.5) * 0.2) *
            (0.92 + min(u_foamScale, 2.5) * 0.12) *
            (0.9 + fade * 0.35);
          float pointSize = max(3.0, aSize * sizeBoost * (96.0 / dist) * (0.82 + aLife * 0.24));
          gl_PointSize = enabled * min(pointSize, ${WATERFALL_IMPACT_POINT_SIZE_MAX.toFixed(1)});
          gl_Position = projectionMatrix * mvPosition;
          vAlpha = clamp(aAlpha * fade * u_opacity, 0.0, 1.0);
          vSeed = aSeed;
        }
      `,
      fragmentShader: `
        varying float vAlpha;
        varying float vSeed;
        varying vec3 vWorldPos;
        uniform float u_time;
        uniform vec3 u_color;
        uniform vec3 u_edgeColor;
        uniform vec3 u_fogColor;
        uniform float u_fogNear;
        uniform float u_fogFar;
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(133.1, 271.7))) * 43758.5453123 + vSeed * 19.0);
        }
        void main() {
          vec2 uv = gl_PointCoord * 2.0 - 1.0;
          float radial = length(uv);
          float body = 1.0 - smoothstep(0.12, 0.96, radial);
          float ring = smoothstep(0.22, 0.54, radial) * (1.0 - smoothstep(0.72, 1.0, radial));
          float spokes = 0.72 + 0.28 * sin(atan(uv.y, uv.x) * 5.0 + u_time * 2.6 + vSeed * 17.0);
          float noise = hash(gl_PointCoord * vec2(8.7, 12.1) + vec2(vSeed * 13.0, u_time * 0.7));
          float alpha = body * (0.58 + 0.22 * noise) + ring * spokes * 0.7;
          alpha *= vAlpha;
          alpha *= 1.0 - smoothstep(0.82, 1.0, radial);
          if (alpha <= 0.01) discard;
          vec3 color = mix(u_edgeColor, u_color, 1.0 - smoothstep(0.0, 0.42, radial));
          color += u_color * ring * 0.12;
          float viewDist = length(cameraPosition - vWorldPos);
          float fogFactor = pow(smoothstep(u_fogNear, u_fogFar, viewDist), 1.05);
          color = mix(color, u_fogColor, fogFactor);
          alpha = mix(alpha, 1.0, fogFactor * 0.14);
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    this.impactPoints = new THREE.Points(geometry, material);
    this.impactPoints.position.y = this.sourceBaseMeshY + this.sourceLevel;
    this.impactPoints.frustumCulled = true;
    this.impactPoints.renderOrder = 4.6;
    this.scene.add(this.impactPoints);
  }

  public clear(): void {
    this.sourceInstances = null;
    this.dropNormAttr = null;
    this.fallStyleAttr = null;
    this.clearImpactPoints();
    if (!this.mesh) {
      this.uniforms = null;
      return;
    }
    this.scene.remove(this.mesh);
    this.mesh.geometry.dispose();
    disposeMaterial(this.mesh.material);
    this.mesh = null;
    this.uniforms = null;
  }

  public dispose(): void {
    this.clear();
  }

  public rebuild(baseMesh: THREE.Mesh, level: number, instances: Float32Array | undefined, qualityUniform: number): void {
    this.clear();
    if (!instances || instances.length < WATERFALL_INSTANCE_STRIDE) {
      return;
    }
    const waterfallCount = Math.floor(instances.length / WATERFALL_INSTANCE_STRIDE);
    if (waterfallCount <= 0) {
      return;
    }
    this.sourceInstances = instances;
    this.sourceLevel = level;
    this.sourceBaseMeshY = baseMesh.position.y;
    this.qualityUniform = qualityUniform;

    const geometry = new THREE.PlaneGeometry(1, 1, 8, 24);
    geometry.translate(0, -0.5, 0);
    this.dropNormAttr = new THREE.InstancedBufferAttribute(new Float32Array(waterfallCount), 1);
    this.fallStyleAttr = new THREE.InstancedBufferAttribute(new Float32Array(waterfallCount), 1);
    geometry.setAttribute("aDropNorm", this.dropNormAttr);
    geometry.setAttribute("aFallStyle", this.fallStyleAttr);

    this.uniforms = {
      u_time: { value: 0 },
      u_color: { value: new THREE.Color(0xa8ddff) },
      u_opacity: { value: 0.84 * this.debugControls.waterfallOpacityScale },
      u_fogColor: { value: this.fogState.color.clone() },
      u_fogNear: { value: this.fogState.near },
      u_fogFar: { value: this.fogState.far },
      u_quality: { value: qualityUniform },
      u_foamScale: { value: this.debugControls.waterfallFoamScale },
      u_mistScale: { value: this.debugControls.waterfallMistScale },
      u_speedScale: { value: this.debugControls.waterfallSpeedScale }
    };

    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms as any,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: `
        varying vec2 vUv;
        varying float vDropNorm;
        varying float vFallStyle;
        varying vec3 vWorldPos;
        attribute float aDropNorm;
        attribute float aFallStyle;
        uniform float u_time;
        uniform float u_speedScale;
        void main() {
          vUv = uv;
          vDropNorm = aDropNorm;
          vFallStyle = aFallStyle;
          vec3 localPos = position;
          float down01 = 1.0 - uv.y;
          float centerWeight = 1.0 - smoothstep(0.26, 0.94, abs(uv.x - 0.5) * 2.0);
          float forwardBow = down01 * mix(0.42, 1.0, down01);
          float shoulder = smoothstep(0.0, 0.78, down01);
          float rapidCurve = (1.0 - aFallStyle) * shoulder;
          float lipLead = smoothstep(0.62, 1.0, uv.y);
          float curtainRipple = sin(uv.y * 22.0 + uv.x * 9.0 + u_time * (2.6 + aDropNorm * 1.8) * u_speedScale);
          localPos.x += curtainRipple * centerWeight * (0.012 + aDropNorm * 0.016);
          localPos.z += centerWeight * ((0.018 + aDropNorm * 0.034) * shoulder + rapidCurve * (0.026 + aDropNorm * 0.036));
          vec4 worldPos = modelMatrix * instanceMatrix * vec4(localPos, 1.0);
          vec3 forwardVec = (instanceMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz;
          float forwardLen = max(length(forwardVec), 1e-4);
          vec3 forwardDir = forwardVec / forwardLen;
          float worldBend =
            centerWeight *
            (
              lipLead * mix(0.05, 0.14, aFallStyle) +
              forwardBow * mix(0.08, 0.26, aFallStyle) * (0.65 + aDropNorm * 0.55) +
              rapidCurve * (0.03 + aDropNorm * 0.06)
            );
          worldPos.xyz += forwardDir * worldBend;
          vWorldPos = worldPos.xyz;
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        varying vec2 vUv;
        varying float vDropNorm;
        varying float vFallStyle;
        varying vec3 vWorldPos;
        uniform float u_time;
        uniform vec3 u_color;
        uniform float u_opacity;
        uniform vec3 u_fogColor;
        uniform float u_fogNear;
        uniform float u_fogFar;
        uniform float u_quality;
        uniform float u_foamScale;
        uniform float u_mistScale;
        uniform float u_speedScale;
        float hash21(vec2 p) {
          vec2 q = fract(p * vec2(123.34, 456.21));
          q += dot(q, q + 45.32);
          return fract(q.x * q.y);
        }
        void main() {
          float enabled = step(0.5, u_quality);
          float centerBand = 1.0 - smoothstep(mix(0.24, 0.34, vFallStyle), 0.5, abs(vUv.x - 0.5));
          float sideFade = smoothstep(0.0, 0.06, vUv.x) * (1.0 - smoothstep(0.94, 1.0, vUv.x));
          float t = u_time * 2.8 * u_speedScale;
          vec2 pixelUv = floor(vUv * vec2(34.0, 72.0)) / vec2(34.0, 72.0);
          float streamA = sin((pixelUv.y * 22.0 + t * 4.2) + pixelUv.x * 16.0);
          float streamB = cos((pixelUv.y * 34.0 + t * 5.1) - pixelUv.x * 11.0);
          float streak = clamp(streamA * 0.35 + streamB * 0.25 + 0.55, 0.0, 1.0);
          float breakup = hash21(vec2(floor(pixelUv.x * 18.0), floor((pixelUv.y + t * 0.35) * 28.0)));
          float body = (mix(0.36, 0.48, vFallStyle) + streak * mix(0.44, 0.58, vFallStyle)) * mix(0.68, 1.0, breakup);
          float dropBoost = clamp(vDropNorm, 0.0, 1.0);
          float topFoam = smoothstep(0.68, 1.0, vUv.y) * mix(0.34, 0.22, vFallStyle) * (0.6 + dropBoost * 0.5) * u_foamScale;
          float plungeZone = 1.0 - smoothstep(0.0, 0.24, vUv.y);
          float splashCells = step(0.57, hash21(vec2(floor(pixelUv.x * 24.0), floor((pixelUv.y + t * 0.55) * 14.0))));
          float bottomFoam =
            plungeZone *
            (0.58 + 0.42 * streak) *
            mix(0.62, 0.9, vFallStyle) *
            (0.74 + dropBoost * 0.58) *
            mix(0.82, 1.18, splashCells) *
            u_foamScale;
          float mistPulse = 0.72 + 0.28 * sin(t * 2.3 + vUv.x * 18.0);
          float mist = (1.0 - smoothstep(0.0, 0.16, vUv.y)) * mistPulse * mix(0.64, 1.0, vFallStyle) * (0.8 + dropBoost * 0.75) * u_mistScale;
          float rapidWash = (1.0 - vFallStyle) * smoothstep(0.08, 0.86, vUv.y) * centerBand * (0.22 + streak * 0.28) * u_foamScale;
          vec3 pseudoN = normalize(vec3((vUv.x - 0.5) * 2.15 + (streak - 0.5) * 0.4, 1.0, (streak - 0.5) * 1.3));
          vec3 lightDir = normalize(vec3(-0.35, 0.86, 0.37));
          float diffuse = 0.58 + 0.42 * max(dot(pseudoN, lightDir), 0.0);
          float rim = pow(1.0 - clamp(abs(vUv.x - 0.5) * 2.0, 0.0, 1.0), 2.0);
          float sparkle = pow(max(dot(reflect(-lightDir, pseudoN), vec3(0.0, 0.0, 1.0)), 0.0), 14.0) * (0.2 + dropBoost * 0.4);
          float alpha = u_opacity * enabled * centerBand * sideFade * (body * 0.62 + bottomFoam * 0.84 + topFoam * 0.31 + rapidWash * 0.42);
          if (alpha < 0.03) discard;
          vec3 foamColor = vec3(0.93, 0.97, 1.0);
          float foamMix = clamp(bottomFoam * 0.92 + mist * 0.48 + topFoam * 0.4 + rapidWash * 0.56 + plungeZone * splashCells * 0.32, 0.0, 1.0);
          vec3 color = mix(u_color, foamColor, foamMix);
          color *= diffuse * (0.92 + rim * 0.2);
          color += foamColor * sparkle;
          float viewDist = length(cameraPosition - vWorldPos);
          float fogFactor = pow(smoothstep(u_fogNear, u_fogFar, viewDist), 1.1);
          color = mix(color, u_fogColor, fogFactor);
          alpha = mix(alpha, 1.0, fogFactor * 0.2);
          gl_FragColor = vec4(color, alpha);
        }
      `
    });

    this.mesh = new THREE.InstancedMesh(geometry, material, waterfallCount);
    this.mesh.renderOrder = 4;
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    this.applyDebugUniforms();
    this.applyInstanceTransforms();
    this.syncVisibility();
  }
}
