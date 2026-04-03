import { clamp } from "../core/utils.js";
import { hash2D } from "./noise.js";

const TAU = Math.PI * 2;
const DEFAULT_GAIN = 0.5;
const DEFAULT_LACUNARITY = 2;
const KERNEL_FALLOFF = 0.6;
const KERNEL_RADIUS = Math.sqrt(1 / KERNEL_FALLOFF);

export type DirectionalErosionParams = {
  scaleM: number;
  octaves: number;
  slopeStrength: number;
  branchStrength: number;
  gain?: number;
  lacunarity?: number;
};

export type DirectionalErosionSample = {
  value: number;
  derivX: number;
  derivY: number;
};

type Vec2 = {
  x: number;
  y: number;
};

const normalizeVector = (x: number, y: number, fallbackX = 1, fallbackY = 0): Vec2 => {
  const length = Math.hypot(x, y);
  if (length < 1e-6) {
    return { x: fallbackX, y: fallbackY };
  }
  return { x: x / length, y: y / length };
};

const jitteredCellOffset = (cellX: number, cellY: number, seed: number): Vec2 => {
  const angle = hash2D(cellX, cellY, seed) * TAU;
  const radius = 0.18 + hash2D(cellX, cellY, seed + 911) * 0.26;
  return {
    x: Math.cos(angle) * radius,
    y: Math.sin(angle) * radius
  };
};

const phaseJitter = (cellX: number, cellY: number, seed: number): number =>
  (hash2D(cellX, cellY, seed + 131) * 2 - 1) * Math.PI;

const sampleDirectionalKernel = (
  px: number,
  py: number,
  directionX: number,
  directionY: number,
  seed: number
): DirectionalErosionSample => {
  const cellX = Math.floor(px);
  const cellY = Math.floor(py);
  const localX = px - cellX;
  const localY = py - cellY;
  let value = 0;
  let derivX = 0;
  let derivY = 0;
  let weightSum = 0;

  for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
    for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
      const neighborX = cellX + offsetX;
      const neighborY = cellY + offsetY;
      const jitter = jitteredCellOffset(neighborX, neighborY, seed + 17);
      const centerX = offsetX + 0.5 + jitter.x;
      const centerY = offsetY + 0.5 + jitter.y;
      const dx = localX - centerX;
      const dy = localY - centerY;
      const dist2 = dx * dx + dy * dy;
      if (dist2 >= KERNEL_RADIUS * KERNEL_RADIUS) {
        continue;
      }

      const falloff = 1 - dist2 * KERNEL_FALLOFF;
      if (falloff <= 0) {
        continue;
      }
      const falloff2 = falloff * falloff;
      const weight = falloff2 * falloff;
      const wavePhase = (dx * directionX + dy * directionY) * TAU + phaseJitter(neighborX, neighborY, seed);
      const waveSin = Math.sin(wavePhase);
      const waveCos = Math.cos(wavePhase);
      const weightDerivScale = -6 * KERNEL_FALLOFF * falloff2;
      const weightDerivX = weightDerivScale * dx;
      const weightDerivY = weightDerivScale * dy;

      value += waveSin * weight;
      derivX += weight * (waveCos * TAU * directionX) + waveSin * weightDerivX;
      derivY += weight * (waveCos * TAU * directionY) + waveSin * weightDerivY;
      weightSum += weight;
    }
  }

  if (weightSum <= 1e-6) {
    return { value: 0, derivX: 0, derivY: 0 };
  }

  return {
    value: clamp(value / weightSum, -1, 1),
    derivX: derivX / weightSum,
    derivY: derivY / weightSum
  };
};

export const sampleDirectionalErosionDetail = (
  worldX: number,
  worldY: number,
  downhillX: number,
  downhillY: number,
  seed: number,
  params: DirectionalErosionParams
): DirectionalErosionSample => {
  const gain = params.gain ?? DEFAULT_GAIN;
  const lacunarity = params.lacunarity ?? DEFAULT_LACUNARITY;
  const octaves = Math.max(1, Math.round(params.octaves));
  const baseScale = Math.max(1, params.scaleM);
  const downhill = normalizeVector(downhillX, downhillY, 1, 0);
  const baseFlow = {
    x: downhill.x * Math.max(0.05, params.slopeStrength),
    y: downhill.y * Math.max(0.05, params.slopeStrength)
  };

  let flow = normalizeVector(baseFlow.x, baseFlow.y, downhill.x, downhill.y);
  let amplitude = 1;
  let frequency = 1;
  let amplitudeSum = 0;
  let accumValue = 0;
  let accumDerivX = 0;
  let accumDerivY = 0;

  for (let octave = 0; octave < octaves; octave += 1) {
    const sample = sampleDirectionalKernel(
      (worldX / baseScale) * frequency,
      (worldY / baseScale) * frequency,
      flow.x,
      flow.y,
      seed + octave * 101
    );

    accumValue += sample.value * amplitude;
    accumDerivX += sample.derivX * amplitude;
    accumDerivY += sample.derivY * amplitude;
    amplitudeSum += amplitude;

    const bend = {
      x: -accumDerivY * params.branchStrength,
      y: accumDerivX * params.branchStrength
    };
    flow = normalizeVector(baseFlow.x + bend.x, baseFlow.y + bend.y, downhill.x, downhill.y);
    amplitude *= gain;
    frequency *= lacunarity;
  }

  if (amplitudeSum <= 1e-6) {
    return { value: 0, derivX: 0, derivY: 0 };
  }

  return {
    value: clamp(accumValue / amplitudeSum, -1, 1),
    derivX: accumDerivX / amplitudeSum,
    derivY: accumDerivY / amplitudeSum
  };
};
