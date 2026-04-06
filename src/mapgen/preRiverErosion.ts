import { clamp } from "../core/utils.js";

const DIAGONAL_COST = Math.SQRT2;

type Neighbor = {
  dx: number;
  dy: number;
  cost: number;
};

const NEIGHBORS: readonly Neighbor[] = [
  { dx: -1, dy: 0, cost: 1 },
  { dx: 1, dy: 0, cost: 1 },
  { dx: 0, dy: -1, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },
  { dx: -1, dy: -1, cost: DIAGONAL_COST },
  { dx: 1, dy: -1, cost: DIAGONAL_COST },
  { dx: -1, dy: 1, cost: DIAGONAL_COST },
  { dx: 1, dy: 1, cost: DIAGONAL_COST }
];

export type PreRiverErosionInput = {
  cols: number;
  rows: number;
  elevations: ArrayLike<number>;
  landShape: ArrayLike<number>;
  basinSignal?: ArrayLike<number>;
  ruggedness: number;
  riverIntensity: number;
  basinStrength: number;
  coastalShelfWidth: number;
};

export type PreRiverErosionFields = {
  wear: Float32Array;
  flowX: Float32Array;
  flowY: Float32Array;
};

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp(t, 0, 1);

const normalizeVector = (x: number, y: number): { x: number; y: number } => {
  const length = Math.hypot(x, y);
  if (length <= 1e-6) {
    return { x: 0, y: 0 };
  }
  return { x: x / length, y: y / length };
};

export const buildPreRiverErosionFields = (input: PreRiverErosionInput): PreRiverErosionFields => {
  const {
    cols,
    rows,
    elevations,
    landShape,
    basinSignal,
    ruggedness,
    riverIntensity,
    basinStrength,
    coastalShelfWidth
  } = input;
  const total = cols * rows;
  const receiver = new Int32Array(total).fill(-1);
  const indices = Array.from({ length: total }, (_, index) => index);
  const landMask = new Uint8Array(total);
  const donorCount = new Uint8Array(total);
  const baseWear = new Float32Array(total);
  const flowX = new Float32Array(total);
  const flowY = new Float32Array(total);
  const localSlope = new Float32Array(total);
  const accumulation = new Float32Array(total);

  let maxSlope = 0;
  for (let idx = 0; idx < total; idx += 1) {
    const shape = clamp(landShape[idx] ?? 0, 0, 1);
    const elevation = elevations[idx] ?? 0;
    const basin = clamp(basinSignal?.[idx] ?? 0, 0, 1);
    if (shape <= 0.06 || elevation <= 0.012) {
      continue;
    }
    landMask[idx] = 1;
    accumulation[idx] = 1 + shape * 0.12 + basin * 0.22;

    const x = idx % cols;
    const y = Math.floor(idx / cols);
    let bestReceiver = -1;
    let bestSlope = 0;
    let bestDx = 0;
    let bestDy = 0;
    for (let i = 0; i < NEIGHBORS.length; i += 1) {
      const neighbor = NEIGHBORS[i];
      const nx = x + neighbor.dx;
      const ny = y + neighbor.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = ny * cols + nx;
      const neighborShape = clamp(landShape[nIdx] ?? 0, 0, 1);
      if (neighborShape <= 0.03) {
        continue;
      }
      const drop = elevation - (elevations[nIdx] ?? elevation);
      if (drop <= 1e-5) {
        continue;
      }
      const slope = drop / neighbor.cost;
      if (slope <= bestSlope) {
        continue;
      }
      bestReceiver = nIdx;
      bestSlope = slope;
      bestDx = neighbor.dx / neighbor.cost;
      bestDy = neighbor.dy / neighbor.cost;
    }
    if (bestReceiver < 0) {
      continue;
    }
    receiver[idx] = bestReceiver;
    donorCount[bestReceiver] = Math.min(255, donorCount[bestReceiver] + 1);
    localSlope[idx] = bestSlope;
    flowX[idx] = bestDx;
    flowY[idx] = bestDy;
    maxSlope = Math.max(maxSlope, bestSlope);
  }

  indices.sort((left, right) => (elevations[right] ?? 0) - (elevations[left] ?? 0));
  for (let i = 0; i < indices.length; i += 1) {
    const idx = indices[i];
    const target = receiver[idx];
    if (target >= 0) {
      accumulation[target] += accumulation[idx];
    }
  }

  let maxAccumulation = 0;
  for (let idx = 0; idx < total; idx += 1) {
    if (!landMask[idx]) {
      continue;
    }
    maxAccumulation = Math.max(maxAccumulation, accumulation[idx]);
  }

  const slopeRef = Math.max(1e-4, maxSlope * mix(0.24, 0.46, ruggedness));
  const logAccumRef = Math.log1p(Math.max(1, maxAccumulation));
  for (let idx = 0; idx < total; idx += 1) {
    if (!landMask[idx]) {
      continue;
    }
    const shape = clamp(landShape[idx] ?? 0, 0, 1);
    const basin = clamp(basinSignal?.[idx] ?? 0, 0, 1);
    const accumNorm = logAccumRef > 1e-6 ? Math.log1p(accumulation[idx]) / logAccumRef : 0;
    const slopeNorm = smoothstep(slopeRef * 0.08, slopeRef, localSlope[idx]);
    const donorNorm = smoothstep(0, 2.5, donorCount[idx]);
    const coastAttenuation = smoothstep(0.12, 0.44, shape) * mix(1, 0.9, coastalShelfWidth);
    const channelPower =
      Math.pow(accumNorm, mix(0.92, 0.72, riverIntensity))
      * Math.pow(slopeNorm, mix(0.98, 0.76, ruggedness));
    const convergence = clamp(donorNorm * 0.52 + basin * mix(0.08, 0.26, basinStrength), 0, 1);
    baseWear[idx] = clamp(channelPower * (0.74 + convergence * 0.44) * coastAttenuation, 0, 1);
  }

  const wear = new Float32Array(total);
  for (let idx = 0; idx < total; idx += 1) {
    if (!landMask[idx]) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    let weightedSum = baseWear[idx] * 1.2;
    let totalWeight = 1.2;
    let maxNeighbor = baseWear[idx];
    for (let i = 0; i < NEIGHBORS.length; i += 1) {
      const neighbor = NEIGHBORS[i];
      const nx = x + neighbor.dx;
      const ny = y + neighbor.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = ny * cols + nx;
      if (!landMask[nIdx]) {
        continue;
      }
      const weight = neighbor.cost > 1 ? 0.35 : 0.55;
      weightedSum += baseWear[nIdx] * weight;
      totalWeight += weight;
      maxNeighbor = Math.max(maxNeighbor, baseWear[nIdx] * (neighbor.cost > 1 ? 0.78 : 0.9));
    }
    const averaged = totalWeight > 0 ? weightedSum / totalWeight : baseWear[idx];
    const shoulderSupport =
      smoothstep(0.16, 0.54, averaged)
      * (1 - smoothstep(0.28, 0.82, baseWear[idx]))
      * 0.28;
    wear[idx] = clamp(baseWear[idx] * 0.78 + averaged * 0.16 + maxNeighbor * 0.06 + shoulderSupport, 0, 1);
  }

  for (let idx = 0; idx < total; idx += 1) {
    if (!landMask[idx] || receiver[idx] >= 0) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    let avgX = 0;
    let avgY = 0;
    let count = 0;
    for (let i = 0; i < NEIGHBORS.length; i += 1) {
      const neighbor = NEIGHBORS[i];
      const nx = x + neighbor.dx;
      const ny = y + neighbor.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = ny * cols + nx;
      if (!landMask[nIdx]) {
        continue;
      }
      avgX += flowX[nIdx];
      avgY += flowY[nIdx];
      count += 1;
    }
    if (count <= 0) {
      continue;
    }
    const normalized = normalizeVector(avgX / count, avgY / count);
    flowX[idx] = normalized.x;
    flowY[idx] = normalized.y;
  }

  return { wear, flowX, flowY };
};
