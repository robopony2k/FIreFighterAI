import * as THREE from "three";
import type { EffectsState } from "../core/effectsState.js";
import type { WorldState } from "../core/state.js";
import { getTerrainHeightScale, type TerrainSample } from "./threeTestTerrain.js";

const MAX_HOSE_SEGMENTS = 1024;
const MAX_WATER_PARTICLES = 4096;
const HOSE_BASE_Y = 0.08;
const HOSE_RADIUS = 0.017;
const HOSE_COLOR = new THREE.Color(0xffffff);
const WATER_COLOR = new THREE.Color(0x7ad4ff);

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

const waterVertexShader = `
  precision highp float;
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;
  varying float vFalloff;
  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float dist = max(1.0, -mvPosition.z);
    gl_PointSize = max(1.8, aSize * (140.0 / dist));
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = clamp(aAlpha, 0.0, 1.0);
    vFalloff = clamp(aSize / 6.0, 0.2, 1.0);
  }
`;

const waterFragmentShader = `
  precision highp float;
  uniform vec3 uColor;
  varying float vAlpha;
  varying float vFalloff;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r = length(uv);
    float edge = smoothstep(1.0, 0.25, r);
    if (edge <= 0.001) {
      discard;
    }
    float alpha = vAlpha * edge * vFalloff;
    gl_FragColor = vec4(uColor * alpha, alpha);
  }
`;

export type ThreeTestUnitFxLayer = {
  update: (
    world: WorldState,
    effects: EffectsState | null,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null
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
  const waterGeometry = new THREE.BufferGeometry();
  const waterPosAttr = new THREE.BufferAttribute(waterPositions, 3);
  const waterAlphaAttr = new THREE.BufferAttribute(waterAlpha, 1);
  const waterSizeAttr = new THREE.BufferAttribute(waterSize, 1);
  waterPosAttr.setUsage(THREE.DynamicDrawUsage);
  waterAlphaAttr.setUsage(THREE.DynamicDrawUsage);
  waterSizeAttr.setUsage(THREE.DynamicDrawUsage);
  waterGeometry.setAttribute("position", waterPosAttr);
  waterGeometry.setAttribute("aAlpha", waterAlphaAttr);
  waterGeometry.setAttribute("aSize", waterSizeAttr);
  waterGeometry.setDrawRange(0, 0);
  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: waterVertexShader,
    fragmentShader: waterFragmentShader,
    uniforms: {
      uColor: { value: WATER_COLOR.clone() }
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
    toneMapped: false
  });
  const waterPoints = new THREE.Points(waterGeometry, waterMaterial);
  waterPoints.frustumCulled = false;
  scene.add(waterPoints);

  const update = (
    world: WorldState,
    effects: EffectsState | null,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null
  ): void => {
    if (!sample || !terrainSize) {
      hoses.count = 0;
      waterGeometry.setDrawRange(0, 0);
      return;
    }

    const cols = Math.max(1, sample.cols);
    const rows = Math.max(1, sample.rows);
    const heightScale = getTerrainHeightScale(cols, rows);

    const trucks = new Map<number, (typeof world.units)[number]>();
    for (let i = 0; i < world.units.length; i += 1) {
      const unit = world.units[i];
      if (unit?.kind === "truck") {
        trucks.set(unit.id, unit);
      }
    }

    let hoseSegments = 0;
    for (let i = 0; i < world.units.length; i += 1) {
      const unit = world.units[i];
      if (!unit || unit.kind !== "firefighter" || unit.assignedTruckId === null) {
        continue;
      }
      const truck = trucks.get(unit.assignedTruckId) ?? null;
      if (!truck || truck.crewMode === "boarded" || unit.carrierId === truck.id) {
        continue;
      }
      if (hoseSegments >= MAX_HOSE_SEGMENTS) {
        break;
      }
      const crewX = toWorldX(unit.x, cols, terrainSize.width);
      const crewZ = toWorldZ(unit.y, rows, terrainSize.depth);
      const crewY = sampleHeight(sample, unit.x, unit.y) * heightScale + HOSE_BASE_Y + 0.18;

      const truckX = toWorldX(truck.x, cols, terrainSize.width);
      const truckZ = toWorldZ(truck.y, rows, terrainSize.depth);
      const truckY = sampleHeight(sample, truck.x, truck.y) * heightScale + HOSE_BASE_Y + 0.11;

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
      return;
    }
    const particleCount = Math.min(MAX_WATER_PARTICLES, spray.length);
    for (let i = 0; i < particleCount; i += 1) {
      const particle = spray[i];
      const wx = toWorldX(particle.x, cols, terrainSize.width);
      const wz = toWorldZ(particle.y, rows, terrainSize.depth);
      const wy = sampleHeight(sample, particle.x, particle.y) * heightScale + 0.14 + (1 - particle.alpha) * 0.1;
      const posOffset = i * 3;
      waterPositions[posOffset] = wx;
      waterPositions[posOffset + 1] = wy;
      waterPositions[posOffset + 2] = wz;
      waterAlpha[i] = clamp(particle.alpha, 0, 1);
      waterSize[i] = clamp(particle.size * 0.42, 1.5, 6.5);
    }
    waterGeometry.setDrawRange(0, particleCount);
    waterPosAttr.needsUpdate = true;
    waterAlphaAttr.needsUpdate = true;
    waterSizeAttr.needsUpdate = true;
  };

  const dispose = (): void => {
    scene.remove(hoses);
    scene.remove(waterPoints);
    hoseGeometry.dispose();
    hoseMaterial.dispose();
    waterGeometry.dispose();
    waterMaterial.dispose();
  };

  return { update, dispose };
};
