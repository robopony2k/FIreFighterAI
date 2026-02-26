import * as THREE from "three";
import type { EffectsState } from "../core/effectsState.js";
import type { WorldState } from "../core/state.js";
import type { WaterSprayMode } from "../core/types.js";
import { getTerrainHeightScale, type TerrainSample } from "./threeTestTerrain.js";

const MAX_HOSE_SEGMENTS = 1024;
const MAX_WATER_PARTICLES = 4096;
const MAX_WATER_CONES = 768;
const HOSE_BASE_Y = 0.08;
const HOSE_RADIUS = 0.017;
const HOSE_COLOR = new THREE.Color(0xffffff);
const WATER_CORE_COLOR = new THREE.Color(0xf4fcff);
const WATER_EDGE_COLOR = new THREE.Color(0x6ecbff);
const WATER_MIST_COLOR = new THREE.Color(0xc2ebff);
const WATER_CONE_CORE_COLOR = new THREE.Color(0xeef8ff);
const WATER_CONE_EDGE_COLOR = new THREE.Color(0x89d7ff);

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const bilerp = (h00: number, h10: number, h01: number, h11: number, tx: number, ty: number): number => {
  const hx0 = h00 * (1 - tx) + h10 * tx;
  const hx1 = h01 * (1 - tx) + h11 * tx;
  return hx0 * (1 - ty) + hx1 * ty;
};

const sampleHeight = (sample: TerrainSample, tileX: number, tileY: number): number => {
  const cols = Math.max(1, sample.cols);
  const rows = Math.max(1, sample.rows);
  const x = clamp(tileX - 0.5, 0, cols - 1);
  const y = clamp(tileY - 0.5, 0, rows - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const idx00 = y0 * cols + x0;
  const idx10 = y0 * cols + x1;
  const idx01 = y1 * cols + x0;
  const idx11 = y1 * cols + x1;
  const h00 = sample.elevations[idx00] ?? 0;
  const h10 = sample.elevations[idx10] ?? h00;
  const h01 = sample.elevations[idx01] ?? h00;
  const h11 = sample.elevations[idx11] ?? h00;
  return bilerp(h00, h10, h01, h11, tx, ty);
};

const toWorldX = (tileX: number, cols: number, width: number): number => (tileX / Math.max(1, cols) - 0.5) * width;
const toWorldZ = (tileY: number, rows: number, depth: number): number => (tileY / Math.max(1, rows) - 0.5) * depth;

const sprayModeToValue = (mode?: WaterSprayMode): number => {
  if (mode === "precision") {
    return 0;
  }
  if (mode === "suppression") {
    return 2;
  }
  return 1;
};

const defaultVolumeForMode = (modeValue: number): number => {
  if (modeValue <= 0.5) {
    return 0.9;
  }
  if (modeValue >= 1.5) {
    return 0.55;
  }
  return 0.75;
};

const defaultPulseForMode = (modeValue: number): number => {
  if (modeValue <= 0.5) {
    return 8.2;
  }
  if (modeValue >= 1.5) {
    return 4.8;
  }
  return 6.3;
};

const waterVertexShader = `
  precision highp float;
  attribute float aAlpha;
  attribute float aSize;
  attribute float aMode;
  attribute float aVolume;
  attribute float aSeed;
  attribute float aPulseHz;
  attribute float aAge01;
  uniform float uTimeSec;
  varying float vAlpha;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vPulse;
  varying float vAge01;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float dist = max(1.0, -mvPosition.z);
    float mode01 = clamp(aMode * 0.5, 0.0, 1.0);
    float pulse = 0.74 + 0.26 * sin(uTimeSec * (aPulseHz + mode01 * 0.8) + aSeed * 31.4159);
    float volumeScale = mix(0.8, 1.4, clamp(aVolume, 0.0, 1.0));
    float ageFade = 1.0 - smoothstep(0.62, 1.0, clamp(aAge01, 0.0, 1.0));
    float sizeScale = mix(0.82, 1.36, mode01);
    float streamScale = mix(1.22, 0.92, mode01);
    float pointSize = aSize * (162.0 / dist) * pulse * volumeScale * sizeScale * streamScale * mix(0.62, 1.0, ageFade);
    gl_PointSize = max(2.0, pointSize);
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = clamp(aAlpha, 0.0, 1.0) * mix(1.18, 0.8, mode01);
    vMode = clamp(aMode, 0.0, 2.0);
    vVolume = clamp(aVolume, 0.0, 1.0);
    vSeed = aSeed;
    vPulse = pulse;
    vAge01 = clamp(aAge01, 0.0, 1.0);
  }
`;

const waterFragmentShader = `
  precision highp float;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  uniform vec3 uMistColor;
  uniform float uTimeSec;
  varying float vAlpha;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  varying float vPulse;
  varying float vAge01;

  float hash(vec2 p) {
    p = fract(p * vec2(0.3183099, 0.3678794) + vec2(vSeed, vSeed * 1.73));
    p += dot(p, p + 17.13);
    return fract(p.x * p.y * 39.71);
  }

  void main() {
    float mode01 = clamp(vMode * 0.5, 0.0, 1.0);
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    uv.x *= mix(0.78, 1.28, mode01);
    float radial = length(uv);
    float shell = 1.0 - smoothstep(0.44, 1.0, radial);
    if (shell <= 0.001) {
      discard;
    }
    float core = 1.0 - smoothstep(0.0, mix(0.36, 0.6, mode01), radial);
    float outer = 1.0 - smoothstep(0.58, 1.04, radial);
    float noise = hash(gl_PointCoord * vec2(13.7, 17.9) + vec2(vSeed * 41.3, uTimeSec * 0.75 + vSeed));
    float breakup = mix(0.86, 0.64, mode01);
    float mist = smoothstep(mix(0.45, 0.22, mode01), 1.0, noise + outer * breakup);
    float pulseGlow = 0.75 + vPulse * 0.45;
    float volumeBoost = mix(0.72, 1.3, vVolume);
    float lifeFade = 1.0 - smoothstep(0.72, 1.0, vAge01);
    float alpha = vAlpha * outer * pulseGlow * volumeBoost * lifeFade;
    alpha *= mix(1.3, 0.78, mode01);
    alpha *= mix(0.7, 1.0, shell);
    alpha = clamp(alpha, 0.0, 1.0);
    if (alpha <= 0.01) {
      discard;
    }

    vec3 color = mix(uEdgeColor, uCoreColor, core);
    color = mix(color, uMistColor, mist * mode01 * 0.55);
    color += vec3(core * 0.18 * (0.6 + vVolume * 0.7));
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

const waterConeVertexShader = `
  precision highp float;
  attribute float aMode;
  attribute float aVolume;
  attribute float aSeed;
  varying float vAlong;
  varying float vRadial;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;
  void main() {
    vAlong = clamp(position.y + 0.5, 0.0, 1.0);
    vRadial = clamp(length(position.xz), 0.0, 1.0);
    vMode = clamp(aMode, 0.0, 2.0);
    vVolume = clamp(aVolume, 0.0, 1.0);
    vSeed = aSeed;
    vec4 worldPos = modelMatrix * instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const waterConeFragmentShader = `
  precision highp float;
  uniform float uTimeSec;
  uniform vec3 uCoreColor;
  uniform vec3 uEdgeColor;
  varying float vAlong;
  varying float vRadial;
  varying float vMode;
  varying float vVolume;
  varying float vSeed;

  float wave(float x) {
    return 0.5 + 0.5 * sin(x);
  }

  void main() {
    float mode01 = clamp(vMode * 0.5, 0.0, 1.0);
    float startFade = smoothstep(0.0, 0.05, vAlong);
    float endFade = 1.0 - smoothstep(0.9, 1.0, vAlong);
    float body = startFade * endFade;
    float radialFade = 1.0 - smoothstep(0.52, 1.0, vRadial);
    float pulseSpeed = mix(10.4, 5.8, mode01);
    float pulseFreq = mix(26.0, 16.0, mode01);
    float pulse = wave(vAlong * pulseFreq - uTimeSec * pulseSpeed + vSeed * 17.0);
    float pulseBand = smoothstep(0.52, 1.0, pulse);
    float coneAlpha = body * radialFade;
    coneAlpha *= mix(0.22, 0.38, vVolume);
    coneAlpha *= mix(1.18, 0.82, mode01);
    coneAlpha *= mix(0.68, 1.0, pulseBand);
    coneAlpha *= mix(1.08, 0.82, vAlong);
    coneAlpha = clamp(coneAlpha, 0.0, 1.0);
    if (coneAlpha <= 0.01) {
      discard;
    }
    vec3 color = mix(uEdgeColor, uCoreColor, 1.0 - vRadial);
    color += vec3(0.12, 0.2, 0.26) * pulseBand * (0.4 + vVolume * 0.4);
    gl_FragColor = vec4(color, coneAlpha);
  }
`;

type SprayConeAggregate = {
  sourceX: number;
  sourceY: number;
  sourceZ: number;
  sumVelX: number;
  sumVelZ: number;
  sumSpeed: number;
  sumMode: number;
  sumVolume: number;
  sumPulseHz: number;
  sumMaxLife: number;
  particleCount: number;
  seed: number;
};

export type ThreeTestUnitFxLayer = {
  update: (
    world: WorldState,
    effects: EffectsState | null,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null,
    interpolationAlpha: number,
    timeMs: number
  ) => void;
  dispose: () => void;
};

export const createThreeTestUnitFxLayer = (scene: THREE.Scene): ThreeTestUnitFxLayer => {
  const hoseGeometry = new THREE.CylinderGeometry(HOSE_RADIUS, HOSE_RADIUS, 1, 6, 1, true);
  const hoseMaterial = new THREE.MeshStandardMaterial({
    color: HOSE_COLOR,
    emissive: new THREE.Color(0x1a1a1a),
    emissiveIntensity: 0.35,
    roughness: 0.68,
    metalness: 0.04,
    transparent: true,
    opacity: 0.94,
    depthWrite: false
  });
  const hoses = new THREE.InstancedMesh(hoseGeometry, hoseMaterial, MAX_HOSE_SEGMENTS);
  hoses.count = 0;
  hoses.frustumCulled = false;
  scene.add(hoses);
  const hoseMatrix = new THREE.Matrix4();
  const hoseMidpoint = new THREE.Vector3();
  const hoseDirection = new THREE.Vector3();
  const hoseQuaternion = new THREE.Quaternion();
  const hoseScale = new THREE.Vector3(1, 1, 1);
  const hoseUpAxis = new THREE.Vector3(0, 1, 0);

  const waterPositions = new Float32Array(MAX_WATER_PARTICLES * 3);
  const waterAlpha = new Float32Array(MAX_WATER_PARTICLES);
  const waterSize = new Float32Array(MAX_WATER_PARTICLES);
  const waterMode = new Float32Array(MAX_WATER_PARTICLES);
  const waterVolume = new Float32Array(MAX_WATER_PARTICLES);
  const waterSeed = new Float32Array(MAX_WATER_PARTICLES);
  const waterPulseHz = new Float32Array(MAX_WATER_PARTICLES);
  const waterAge01 = new Float32Array(MAX_WATER_PARTICLES);
  const waterGeometry = new THREE.BufferGeometry();
  const waterPosAttr = new THREE.BufferAttribute(waterPositions, 3);
  const waterAlphaAttr = new THREE.BufferAttribute(waterAlpha, 1);
  const waterSizeAttr = new THREE.BufferAttribute(waterSize, 1);
  const waterModeAttr = new THREE.BufferAttribute(waterMode, 1);
  const waterVolumeAttr = new THREE.BufferAttribute(waterVolume, 1);
  const waterSeedAttr = new THREE.BufferAttribute(waterSeed, 1);
  const waterPulseAttr = new THREE.BufferAttribute(waterPulseHz, 1);
  const waterAgeAttr = new THREE.BufferAttribute(waterAge01, 1);
  waterPosAttr.setUsage(THREE.DynamicDrawUsage);
  waterAlphaAttr.setUsage(THREE.DynamicDrawUsage);
  waterSizeAttr.setUsage(THREE.DynamicDrawUsage);
  waterModeAttr.setUsage(THREE.DynamicDrawUsage);
  waterVolumeAttr.setUsage(THREE.DynamicDrawUsage);
  waterSeedAttr.setUsage(THREE.DynamicDrawUsage);
  waterPulseAttr.setUsage(THREE.DynamicDrawUsage);
  waterAgeAttr.setUsage(THREE.DynamicDrawUsage);
  waterGeometry.setAttribute("position", waterPosAttr);
  waterGeometry.setAttribute("aAlpha", waterAlphaAttr);
  waterGeometry.setAttribute("aSize", waterSizeAttr);
  waterGeometry.setAttribute("aMode", waterModeAttr);
  waterGeometry.setAttribute("aVolume", waterVolumeAttr);
  waterGeometry.setAttribute("aSeed", waterSeedAttr);
  waterGeometry.setAttribute("aPulseHz", waterPulseAttr);
  waterGeometry.setAttribute("aAge01", waterAgeAttr);
  waterGeometry.setDrawRange(0, 0);
  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    uniforms: {
      uCoreColor: { value: WATER_CORE_COLOR.clone() },
      uEdgeColor: { value: WATER_EDGE_COLOR.clone() },
      uMistColor: { value: WATER_MIST_COLOR.clone() },
      uTimeSec: { value: 0 }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false
  });
  const waterPoints = new THREE.Points(waterGeometry, waterMaterial);
  waterPoints.frustumCulled = false;
  scene.add(waterPoints);
  const waterConeGeometry = new THREE.CylinderGeometry(1, 0.08, 1, 16, 1, true);
  const coneModeData = new Float32Array(MAX_WATER_CONES);
  const coneVolumeData = new Float32Array(MAX_WATER_CONES);
  const coneSeedData = new Float32Array(MAX_WATER_CONES);
  const coneModeAttr = new THREE.InstancedBufferAttribute(coneModeData, 1);
  const coneVolumeAttr = new THREE.InstancedBufferAttribute(coneVolumeData, 1);
  const coneSeedAttr = new THREE.InstancedBufferAttribute(coneSeedData, 1);
  coneModeAttr.setUsage(THREE.DynamicDrawUsage);
  coneVolumeAttr.setUsage(THREE.DynamicDrawUsage);
  coneSeedAttr.setUsage(THREE.DynamicDrawUsage);
  waterConeGeometry.setAttribute("aMode", coneModeAttr);
  waterConeGeometry.setAttribute("aVolume", coneVolumeAttr);
  waterConeGeometry.setAttribute("aSeed", coneSeedAttr);
  const waterConeMaterial = new THREE.ShaderMaterial({
    vertexShader: waterConeVertexShader,
    fragmentShader: waterConeFragmentShader,
    uniforms: {
      uTimeSec: { value: 0 },
      uCoreColor: { value: WATER_CONE_CORE_COLOR.clone() },
      uEdgeColor: { value: WATER_CONE_EDGE_COLOR.clone() }
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    blending: THREE.NormalBlending,
    toneMapped: false
  });
  const waterCones = new THREE.InstancedMesh(waterConeGeometry, waterConeMaterial, MAX_WATER_CONES);
  waterCones.count = 0;
  waterCones.frustumCulled = false;
  waterCones.renderOrder = 3;
  scene.add(waterCones);
  const coneMatrix = new THREE.Matrix4();
  const coneMidpoint = new THREE.Vector3();
  const coneDirection = new THREE.Vector3();
  const coneQuaternion = new THREE.Quaternion();
  const coneScale = new THREE.Vector3(1, 1, 1);

  const update = (
    world: WorldState,
    effects: EffectsState | null,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null,
    interpolationAlpha: number,
    timeMs: number
  ): void => {
    waterMaterial.uniforms.uTimeSec.value = timeMs * 0.001;
    waterConeMaterial.uniforms.uTimeSec.value = timeMs * 0.001;
    if (!sample || !terrainSize) {
      hoses.count = 0;
      waterGeometry.setDrawRange(0, 0);
      waterCones.count = 0;
      return;
    }

    const cols = Math.max(1, sample.cols);
    const rows = Math.max(1, sample.rows);
    const heightScale = getTerrainHeightScale(cols, rows);
    const worldPerTileX = terrainSize.width / cols;
    const worldPerTileZ = terrainSize.depth / rows;
    const worldPerTile = (worldPerTileX + worldPerTileZ) * 0.5;

    const resolveInterpolatedPosition = (
      unit: WorldState["units"][number]
    ): { x: number; y: number } => {
      const alpha = clamp(interpolationAlpha, 0, 1);
      return {
        x: unit.prevX + (unit.x - unit.prevX) * alpha,
        y: unit.prevY + (unit.y - unit.prevY) * alpha
      };
    };

    const trucks = new Map<number, { unit: WorldState["units"][number]; x: number; y: number }>();
    const nozzleByUnitId = new Map<number, { x: number; y: number; z: number }>();
    for (let i = 0; i < world.units.length; i += 1) {
      const unit = world.units[i];
      if (!unit) {
        continue;
      }
      const unitTile = resolveInterpolatedPosition(unit);
      if (unit.kind === "truck") {
        trucks.set(unit.id, { unit, x: unitTile.x, y: unitTile.y });
      }
      const nozzleX = toWorldX(unitTile.x, cols, terrainSize.width);
      const nozzleZ = toWorldZ(unitTile.y, rows, terrainSize.depth);
      const nozzleY =
        sampleHeight(sample, unitTile.x, unitTile.y) * heightScale + (unit.kind === "truck" ? HOSE_BASE_Y + 0.13 : HOSE_BASE_Y + 0.2);
      nozzleByUnitId.set(unit.id, { x: nozzleX, y: nozzleY, z: nozzleZ });
    }

    let hoseSegments = 0;
    for (let i = 0; i < world.units.length; i += 1) {
      const unit = world.units[i];
      if (!unit || unit.kind !== "firefighter" || unit.assignedTruckId === null) {
        continue;
      }
      const truckRef = trucks.get(unit.assignedTruckId) ?? null;
      if (!truckRef || truckRef.unit.crewMode === "boarded" || unit.carrierId === truckRef.unit.id) {
        continue;
      }
      if (hoseSegments >= MAX_HOSE_SEGMENTS) {
        break;
      }
      const crewTile = resolveInterpolatedPosition(unit);
      const crewX = toWorldX(crewTile.x, cols, terrainSize.width);
      const crewZ = toWorldZ(crewTile.y, rows, terrainSize.depth);
      const crewY = sampleHeight(sample, crewTile.x, crewTile.y) * heightScale + HOSE_BASE_Y + 0.18;

      const truckX = toWorldX(truckRef.x, cols, terrainSize.width);
      const truckZ = toWorldZ(truckRef.y, rows, terrainSize.depth);
      const truckY = sampleHeight(sample, truckRef.x, truckRef.y) * heightScale + HOSE_BASE_Y + 0.11;

      hoseDirection.set(crewX - truckX, crewY - truckY, crewZ - truckZ);
      const hoseLength = hoseDirection.length();
      if (hoseLength <= 0.0001) {
        continue;
      }
      hoseDirection.multiplyScalar(1 / hoseLength);
      hoseMidpoint.set((truckX + crewX) * 0.5, (truckY + crewY) * 0.5, (truckZ + crewZ) * 0.5);
      hoseQuaternion.setFromUnitVectors(hoseUpAxis, hoseDirection);
      hoseScale.set(1, hoseLength, 1);
      hoseMatrix.compose(hoseMidpoint, hoseQuaternion, hoseScale);
      hoses.setMatrixAt(hoseSegments, hoseMatrix);
      hoseSegments += 1;
    }
    hoses.count = hoseSegments;
    hoses.instanceMatrix.needsUpdate = true;

    const spray = effects?.waterParticles ?? null;
    if (!spray || spray.length === 0) {
      waterGeometry.setDrawRange(0, 0);
      waterCones.count = 0;
      return;
    }
    const particleCount = Math.min(MAX_WATER_PARTICLES, spray.length);
    const coneBySource = new Map<number, SprayConeAggregate>();
    for (let i = 0; i < particleCount; i += 1) {
      const particle = spray[i];
      const modeValue = sprayModeToValue(particle.sprayMode);
      const volume = clamp(particle.sprayVolume ?? defaultVolumeForMode(modeValue), 0, 1);
      const modeSizeScale = modeValue <= 0.5 ? 0.9 : modeValue >= 1.5 ? 1.34 : 1.06;
      const wx = toWorldX(particle.x, cols, terrainSize.width);
      const wz = toWorldZ(particle.y, rows, terrainSize.depth);
      const lift = (1 - clamp(particle.alpha, 0, 1)) * (0.08 + modeValue * 0.05);
      const wy = sampleHeight(sample, particle.x, particle.y) * heightScale + 0.13 + lift;
      const particleLife01 =
        particle.maxLife > 0
          ? clamp(1 - particle.life / particle.maxLife, 0, 1)
          : clamp(1 - particle.alpha, 0, 1);
      const posOffset = i * 3;
      waterPositions[posOffset] = wx;
      waterPositions[posOffset + 1] = wy;
      waterPositions[posOffset + 2] = wz;
      waterAlpha[i] = clamp(particle.alpha, 0, 1);
      waterSize[i] = clamp(particle.size * 0.44 * modeSizeScale * (0.82 + volume * 0.5), 1.4, 8.4);
      waterMode[i] = modeValue;
      waterVolume[i] = volume;
      waterSeed[i] = Number.isFinite(particle.spraySeed) ? particle.spraySeed! : (i * 0.61803398875) % 1;
      waterPulseHz[i] = Number.isFinite(particle.sprayPulseHz)
        ? Math.max(2, Math.min(12, particle.sprayPulseHz!))
        : defaultPulseForMode(modeValue);
      waterAge01[i] = particleLife01;

      const sourceId = particle.spraySourceId;
      if (typeof sourceId !== "number") {
        continue;
      }
      const source = nozzleByUnitId.get(sourceId);
      if (!source) {
        continue;
      }
      const velocityX = particle.vx * worldPerTileX;
      const velocityZ = particle.vy * worldPerTileZ;
      const speed = Math.hypot(velocityX, velocityZ);
      let aggregate = coneBySource.get(sourceId);
      if (!aggregate) {
        aggregate = {
          sourceX: source.x,
          sourceY: source.y,
          sourceZ: source.z,
          sumVelX: 0,
          sumVelZ: 0,
          sumSpeed: 0,
          sumMode: 0,
          sumVolume: 0,
          sumPulseHz: 0,
          sumMaxLife: 0,
          particleCount: 0,
          seed: Number.isFinite(particle.spraySeed) ? particle.spraySeed! : (sourceId * 0.61803398875) % 1
        };
        coneBySource.set(sourceId, aggregate);
      }
      aggregate.sumVelX += velocityX;
      aggregate.sumVelZ += velocityZ;
      aggregate.sumSpeed += speed;
      aggregate.sumMode += modeValue;
      aggregate.sumVolume += volume;
      aggregate.sumPulseHz += waterPulseHz[i];
      aggregate.sumMaxLife += Math.max(0.1, particle.maxLife);
      aggregate.particleCount += 1;
    }
    waterGeometry.setDrawRange(0, particleCount);
    waterPosAttr.needsUpdate = true;
    waterAlphaAttr.needsUpdate = true;
    waterSizeAttr.needsUpdate = true;
    waterModeAttr.needsUpdate = true;
    waterVolumeAttr.needsUpdate = true;
    waterSeedAttr.needsUpdate = true;
    waterPulseAttr.needsUpdate = true;
    waterAgeAttr.needsUpdate = true;

    let coneCount = 0;
    coneBySource.forEach((aggregate) => {
      if (coneCount >= MAX_WATER_CONES || aggregate.particleCount <= 0) {
        return;
      }
      const inv = 1 / aggregate.particleCount;
      const avgMode = aggregate.sumMode * inv;
      const avgVolume = clamp(aggregate.sumVolume * inv, 0, 1);
      const avgPulseHz = Math.max(2.4, Math.min(12, aggregate.sumPulseHz * inv));
      const avgSpeed = aggregate.sumSpeed * inv;
      const avgMaxLife = aggregate.sumMaxLife * inv;
      const modeLengthScale = avgMode <= 0.5 ? 1.18 : avgMode >= 1.5 ? 0.83 : 1;
      const length = clamp(
        (avgSpeed * avgMaxLife * 0.55 + worldPerTile * 0.85) * modeLengthScale,
        worldPerTile * 0.8,
        worldPerTile * 7.5
      );
      const radiusTiles = avgMode <= 0.5 ? 0.42 : avgMode >= 1.5 ? 0.95 : 0.66;
      const radius = Math.max(worldPerTile * 0.08, radiusTiles * worldPerTile * (0.82 + avgVolume * 0.58));
      coneDirection.set(aggregate.sumVelX, Math.max(0.0001, avgSpeed * 0.14), aggregate.sumVelZ);
      if (coneDirection.lengthSq() <= 1e-7) {
        coneDirection.set(0, 0.08, 1);
      } else {
        coneDirection.normalize();
      }
      const startX = aggregate.sourceX + coneDirection.x * worldPerTile * 0.12;
      const startY = aggregate.sourceY + 0.02 + coneDirection.y * worldPerTile * 0.1;
      const startZ = aggregate.sourceZ + coneDirection.z * worldPerTile * 0.12;
      coneMidpoint.set(
        startX + coneDirection.x * length * 0.5,
        startY + coneDirection.y * length * 0.5,
        startZ + coneDirection.z * length * 0.5
      );
      coneQuaternion.setFromUnitVectors(hoseUpAxis, coneDirection);
      coneScale.set(radius, length, radius);
      coneMatrix.compose(coneMidpoint, coneQuaternion, coneScale);
      waterCones.setMatrixAt(coneCount, coneMatrix);
      coneModeAttr.setX(coneCount, avgMode);
      coneVolumeAttr.setX(coneCount, avgVolume);
      coneSeedAttr.setX(coneCount, aggregate.seed + avgPulseHz * 0.013);
      coneCount += 1;
    });
    waterCones.count = coneCount;
    waterCones.instanceMatrix.needsUpdate = true;
    coneModeAttr.needsUpdate = true;
    coneVolumeAttr.needsUpdate = true;
    coneSeedAttr.needsUpdate = true;
  };

  const dispose = (): void => {
    scene.remove(hoses);
    scene.remove(waterPoints);
    scene.remove(waterCones);
    hoseGeometry.dispose();
    hoseMaterial.dispose();
    waterGeometry.dispose();
    waterMaterial.dispose();
    waterConeGeometry.dispose();
    waterConeMaterial.dispose();
  };

  return { update, dispose };
};
