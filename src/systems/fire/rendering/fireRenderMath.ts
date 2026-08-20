export const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const fract = (value: number): number => value - Math.floor(value);

export const hash1 = (value: number): number => fract(Math.sin(value * 12.9898) * 43758.5453);

export const resolveSmokeAnimationRate = (simulationAnimationRate: number): number =>
  Math.max(0, Number.isFinite(simulationAnimationRate) ? simulationAnimationRate : 0);

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const smoothApproach = (
  current: number,
  target: number,
  riseRate: number,
  fallRate: number,
  dtSeconds: number
): number => {
  const rate = target >= current ? riseRate : fallRate;
  const k = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dtSeconds));
  return current + (target - current) * k;
};

export const accumulateSmokeEmission = (
  carry: number,
  emissionsPerSecond: number,
  deltaSeconds: number,
  maxSpawns: number
): { carry: number; spawnCount: number } => {
  const safeCarry = Number.isFinite(carry) ? clamp(carry, 0, 0.999999) : 0;
  const accumulated =
    safeCarry + Math.max(0, Number.isFinite(emissionsPerSecond) ? emissionsPerSecond : 0) *
      Math.max(0, Number.isFinite(deltaSeconds) ? deltaSeconds : 0);
  const availableSpawns = Math.floor(accumulated + 1e-9);
  return {
    carry: Math.max(0, accumulated - availableSpawns),
    spawnCount: Math.min(Math.max(0, Math.floor(maxSpawns)), availableSpawns)
  };
};

const getStableSmokeSlotPriority = (index: number): number => {
  let value = (Math.max(0, Math.floor(index)) + 0x9e3779b9) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97) >>> 0;
  return (value ^ (value >>> 15)) >>> 0;
};

export const buildStableSmokeSelectionOrder = (slotCount: number): Uint16Array => {
  const safeSlotCount = Math.min(0x10000, Math.max(0, Math.floor(slotCount)));
  const slots = Array.from({ length: safeSlotCount }, (_, index) => index);
  slots.sort((a, b) => getStableSmokeSlotPriority(a) - getStableSmokeSlotPriority(b) || a - b);
  return Uint16Array.from(slots);
};

export const selectStableVisibleSmokeSlots = (
  priorityOrder: Uint16Array,
  visibleSlots: Uint8Array,
  maxSelected: number,
  output: Uint16Array
): number => {
  const selectionLimit = Math.min(output.length, Math.max(0, Math.floor(maxSelected)));
  let selectedCount = 0;
  for (let priority = 0; priority < priorityOrder.length && selectedCount < selectionLimit; priority += 1) {
    const slot = priorityOrder[priority]!;
    if (slot >= visibleSlots.length || visibleSlots[slot] === 0) {
      continue;
    }
    output[selectedCount] = slot;
    selectedCount += 1;
  }
  return selectedCount;
};

export const normalizeXZ = (x: number, z: number): { x: number; z: number } => {
  const length = Math.hypot(x, z);
  if (length <= 1e-5) {
    return { x: 0, z: 0 };
  }
  return { x: x / length, z: z / length };
};

export const getVisualWindResponse = (
  windStrength: number
): { flame: number; spark: number; smoke: number; smokeUpwind: number } => {
  const wind01 = clamp(windStrength, 0, 1);
  return {
    flame: 0.65 + wind01 * 0.9,
    spark: 0.75 + wind01 * 1.05,
    smoke: 0.85 + wind01 * 1.25,
    smokeUpwind: 0.25 + (1 - wind01) * 0.18
  };
};

const swapDepthOrder = (depth: Float32Array, order: Uint16Array, a: number, b: number): void => {
  const depthTmp = depth[a]!;
  depth[a] = depth[b]!;
  depth[b] = depthTmp;
  const orderTmp = order[a]!;
  order[a] = order[b]!;
  order[b] = orderTmp;
};

const sortDepthBackToFront = (depth: Float32Array, order: Uint16Array, left: number, right: number): void => {
  if (left >= right) {
    return;
  }
  const pivot = depth[(left + right) >> 1] ?? 0;
  let i = left;
  let j = right;
  while (i <= j) {
    while ((depth[i] ?? 0) > pivot) {
      i += 1;
    }
    while ((depth[j] ?? 0) < pivot) {
      j -= 1;
    }
    if (i <= j) {
      swapDepthOrder(depth, order, i, j);
      i += 1;
      j -= 1;
    }
  }
  if (left < j) {
    sortDepthBackToFront(depth, order, left, j);
  }
  if (i < right) {
    sortDepthBackToFront(depth, order, i, right);
  }
};

export const sortSmokeParticlesByDepth = (depth: Float32Array, order: Uint16Array, count: number): void => {
  if (count > 1) {
    sortDepthBackToFront(depth, order, 0, count - 1);
  }
};
