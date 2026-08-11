const DIAGONAL_COST = Math.SQRT2;
const NEIGHBORS = [
  { dx: -1, dy: 0, cost: 1 }, { dx: 1, dy: 0, cost: 1 },
  { dx: 0, dy: -1, cost: 1 }, { dx: 0, dy: 1, cost: 1 },
  { dx: -1, dy: -1, cost: DIAGONAL_COST }, { dx: 1, dy: -1, cost: DIAGONAL_COST },
  { dx: -1, dy: 1, cost: DIAGONAL_COST }, { dx: 1, dy: 1, cost: DIAGONAL_COST }
] as const;
const UNIQUE_EDGES = [
  { dx: 1, dy: 0, cost: 1 }, { dx: 0, dy: 1, cost: 1 },
  { dx: 1, dy: 1, cost: DIAGONAL_COST }, { dx: -1, dy: 1, cost: DIAGONAL_COST }
] as const;

export type DrainageErosionInput = {
  cols: number;
  rows: number;
  elevations: ArrayLike<number>;
  oceanMask: Uint8Array;
  seaLevel: number;
  heightScale: number;
  relief: number;
  ruggedness: number;
  riverIntensity: number;
};

export type DrainageErosionResult = {
  elevations: Float32Array;
  filledElevation: Float32Array;
  depressionDepth: Float32Array;
  receiver: Int32Array;
  flowAccumulation: Float32Array;
  incision: Float32Array;
  deposition: Float32Array;
  wear: Float32Array;
  deposit: Float32Array;
  flowX: Float32Array;
  flowY: Float32Array;
  exportedSediment: number;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

class StableMinHeap {
  private readonly indices: number[] = [];
  private readonly priorities: number[] = [];

  get size(): number { return this.indices.length; }

  push(index: number, priority: number): void {
    let cursor = this.indices.length;
    this.indices.push(index);
    this.priorities.push(priority);
    while (cursor > 0) {
      const parent = (cursor - 1) >> 1;
      const parentPriority = this.priorities[parent] ?? 0;
      const parentIndex = this.indices[parent] ?? 0;
      if (parentPriority < priority || (parentPriority === priority && parentIndex <= index)) break;
      this.indices[cursor] = parentIndex;
      this.priorities[cursor] = parentPriority;
      cursor = parent;
    }
    this.indices[cursor] = index;
    this.priorities[cursor] = priority;
  }

  pop(): number {
    const result = this.indices[0] ?? -1;
    const lastIndex = this.indices.pop() ?? -1;
    const lastPriority = this.priorities.pop() ?? 0;
    if (this.indices.length === 0) return result;
    let cursor = 0;
    while (true) {
      const left = cursor * 2 + 1;
      const right = left + 1;
      if (left >= this.indices.length) break;
      let child = left;
      if (right < this.indices.length) {
        const leftPriority = this.priorities[left] ?? 0;
        const rightPriority = this.priorities[right] ?? 0;
        const leftIndex = this.indices[left] ?? 0;
        const rightIndex = this.indices[right] ?? 0;
        if (rightPriority < leftPriority || (rightPriority === leftPriority && rightIndex < leftIndex)) child = right;
      }
      const childPriority = this.priorities[child] ?? 0;
      const childIndex = this.indices[child] ?? 0;
      if (childPriority > lastPriority || (childPriority === lastPriority && childIndex >= lastIndex)) break;
      this.indices[cursor] = childIndex;
      this.priorities[cursor] = childPriority;
      cursor = child;
    }
    this.indices[cursor] = lastIndex;
    this.priorities[cursor] = lastPriority;
    return result;
  }
}

const buildDrainage = (input: DrainageErosionInput) => {
  const { cols, rows, oceanMask } = input;
  const total = cols * rows;
  const receiver = new Int32Array(total).fill(-2);
  const filled = Float32Array.from(input.elevations);
  const order = new Int32Array(total);
  const heap = new StableMinHeap();
  let orderLength = 0;
  const seedOutlet = (idx: number): void => {
    if (receiver[idx] !== -2) return;
    receiver[idx] = -1;
    heap.push(idx, filled[idx] ?? 0);
  };
  for (let idx = 0; idx < total; idx += 1) if (oceanMask[idx] > 0) seedOutlet(idx);
  for (let x = 0; x < cols; x += 1) { seedOutlet(x); seedOutlet((rows - 1) * cols + x); }
  for (let y = 0; y < rows; y += 1) { seedOutlet(y * cols); seedOutlet(y * cols + cols - 1); }

  while (heap.size > 0) {
    const idx = heap.pop();
    if (idx < 0) break;
    order[orderLength++] = idx;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (const neighbor of NEIGHBORS) {
      const nx = x + neighbor.dx;
      const ny = y + neighbor.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nIdx = ny * cols + nx;
      if (receiver[nIdx] !== -2) continue;
      receiver[nIdx] = idx;
      filled[nIdx] = Math.max(filled[nIdx] ?? 0, filled[idx] ?? 0);
      heap.push(nIdx, (filled[nIdx] ?? 0) + (neighbor.cost > 1 ? 1e-7 : 0));
    }
  }
  return { receiver, filled, order, orderLength };
};

const relaxSlopes = (
  elevations: Float32Array,
  oceanMask: Uint8Array,
  cols: number,
  rows: number,
  heightScale: number,
  seaLevel: number,
  wear: Float32Array,
  deposit: Float32Array
): void => {
  const total = cols * rows;
  const targetDelta = (angleDeg: number, distance: number): number =>
    Math.tan(angleDeg * Math.PI / 180) * distance / Math.max(1e-6, heightScale);
  const runPass = (activationStart: number, activationEnd: number, targetAngle: number): boolean => {
    const changes = new Float32Array(total);
    const requestedOut = new Float32Array(total);
    const requestedIn = new Float32Array(total);
    let changed = false;
    const visitTransfers = (visitor: (upper: number, lower: number, request: number) => void): void => {
      for (let y = 0; y < rows; y += 1) {
        for (let x = 0; x < cols; x += 1) {
          const idx = y * cols + x;
          if (oceanMask[idx] > 0) continue;
          for (const edge of UNIQUE_EDGES) {
            const nx = x + edge.dx;
            const ny = y + edge.dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const nIdx = ny * cols + nx;
            if (oceanMask[nIdx] > 0) continue;
            const signed = (elevations[idx] ?? 0) - (elevations[nIdx] ?? 0);
            const delta = Math.abs(signed);
            const angle = Math.atan(delta * heightScale / edge.cost) * 180 / Math.PI;
            const activation = smoothstep(activationStart, activationEnd, angle);
            const excess = Math.max(0, delta - targetDelta(targetAngle, edge.cost));
            if (activation <= 0 || excess <= 1e-7) continue;
            const upper = signed > 0 ? idx : nIdx;
            const lower = signed > 0 ? nIdx : idx;
            visitor(upper, lower, excess * 0.5 * activation);
          }
        }
      }
    };
    visitTransfers((upper, lower, request) => {
      requestedOut[upper] += request;
      requestedIn[lower] += request;
    });
    visitTransfers((upper, lower, request) => {
      const sourceCapacity = Math.max(0, (elevations[upper] ?? 0) - (seaLevel + 0.003));
      const sinkCapacity = Math.max(0, 1 - (elevations[lower] ?? 0));
      const sourceScale = Math.min(1, sourceCapacity / Math.max(1e-9, requestedOut[upper] ?? 0));
      const sinkScale = Math.min(1, sinkCapacity / Math.max(1e-9, requestedIn[lower] ?? 0));
      const transfer = request * Math.min(sourceScale, sinkScale);
      if (transfer <= 1e-7) return;
      changes[upper] -= transfer;
      changes[lower] += transfer;
      wear[upper] = Math.max(wear[upper] ?? 0, clamp01(transfer / 0.015));
      deposit[lower] = Math.max(deposit[lower] ?? 0, clamp01(transfer / 0.008));
      changed = true;
    });
    for (let idx = 0; idx < total; idx += 1) elevations[idx] = (elevations[idx] ?? 0) + changes[idx];
    return changed;
  };

  runPass(42, 52, 52);
  runPass(42, 52, 52);
  const runSafetySweep = (): boolean => {
    let changed = false;
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const idx = y * cols + x;
        if (oceanMask[idx] > 0) continue;
        for (const edge of UNIQUE_EDGES) {
          const nx = x + edge.dx;
          const ny = y + edge.dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const nIdx = ny * cols + nx;
          if (oceanMask[nIdx] > 0) continue;
          const signed = (elevations[idx] ?? 0) - (elevations[nIdx] ?? 0);
          const excess = Math.abs(signed) - targetDelta(60, edge.cost);
          if (excess <= 1e-7) continue;
          const upper = signed > 0 ? idx : nIdx;
          const lower = signed > 0 ? nIdx : idx;
          const transfer = Math.min(
            excess * 0.5,
            Math.max(0, (elevations[upper] ?? 0) - (seaLevel + 0.003)),
            Math.max(0, 1 - (elevations[lower] ?? 0))
          );
          if (transfer <= 1e-7) continue;
          elevations[upper] -= transfer;
          elevations[lower] += transfer;
          wear[upper] = Math.max(wear[upper] ?? 0, clamp01(transfer / 0.015));
          deposit[lower] = Math.max(deposit[lower] ?? 0, clamp01(transfer / 0.008));
          changed = true;
        }
      }
    }
    return changed;
  };
  for (let safety = 0; safety < 64 && runSafetySweep(); safety += 1) {
    // The fixed ceiling is reached only by pathological cliffs; ordinary terrain exits immediately.
  }
};

export const runDrainageErosion = (input: DrainageErosionInput): DrainageErosionResult => {
  const { cols, rows, oceanMask, seaLevel } = input;
  const total = cols * rows;
  const elevations = Float32Array.from(input.elevations);
  const { receiver, filled, order, orderLength } = buildDrainage({ ...input, elevations });
  const depressionDepth = new Float32Array(total);
  for (let idx = 0; idx < total; idx += 1) {
    depressionDepth[idx] = Math.max(0, (filled[idx] ?? 0) - (elevations[idx] ?? 0));
  }
  const accumulation = new Float32Array(total);
  for (let idx = 0; idx < total; idx += 1) accumulation[idx] = oceanMask[idx] > 0 ? 0 : 1;
  for (let cursor = orderLength - 1; cursor >= 0; cursor -= 1) {
    const idx = order[cursor] ?? -1;
    const target = idx >= 0 ? (receiver[idx] ?? -1) : -1;
    if (target >= 0) accumulation[target] += accumulation[idx] ?? 0;
  }
  let maxAccumulation = 1;
  for (let idx = 0; idx < total; idx += 1) maxAccumulation = Math.max(maxAccumulation, accumulation[idx] ?? 0);
  const accumulationDenom = Math.log1p(maxAccumulation);
  const flowAccumulation = new Float32Array(total);
  const wear = new Float32Array(total);
  const deposit = new Float32Array(total);
  const flowX = new Float32Array(total);
  const flowY = new Float32Array(total);
  const incision = new Float32Array(total);
  const deposition = new Float32Array(total);
  const sediment = new Float32Array(total);
  const erosionStrength = 0.004 + 0.011 * clamp01(
    input.riverIntensity * 0.3 + input.relief * 0.35 + input.ruggedness * 0.35
  );

  for (let idx = 0; idx < total; idx += 1) {
    flowAccumulation[idx] = accumulationDenom > 0
      ? clamp01(Math.log1p(accumulation[idx] ?? 0) / accumulationDenom)
      : 0;
    const target = receiver[idx] ?? -1;
    if (target < 0 || oceanMask[idx] > 0) continue;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const tx = target % cols;
    const ty = Math.floor(target / cols);
    const distance = Math.hypot(tx - x, ty - y) || 1;
    flowX[idx] = (tx - x) / distance;
    flowY[idx] = (ty - y) / distance;
    const center = elevations[idx] ?? 0;
    const targetHeight = elevations[target] ?? center;
    const slope = Math.max(0, (center - targetHeight) / distance);
    if (slope <= 0) continue;
    let minNeighbor = center;
    let maxNeighbor = center;
    for (const neighbor of NEIGHBORS) {
      const nx = x + neighbor.dx;
      const ny = y + neighbor.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const value = elevations[ny * cols + nx] ?? center;
      minNeighbor = Math.min(minNeighbor, value);
      maxNeighbor = Math.max(maxNeighbor, value);
    }
    const localRelief = maxNeighbor - minNeighbor;
    const streamPower = Math.sqrt(flowAccumulation[idx] ?? 0) * slope;
    const headroom = Math.max(0, center - (seaLevel + 0.003));
    incision[idx] = Math.min(0.015, localRelief * 0.45, headroom, streamPower * erosionStrength * 22);
  }

  let exportedSediment = 0;
  for (let cursor = orderLength - 1; cursor >= 0; cursor -= 1) {
    const idx = order[cursor] ?? -1;
    if (idx < 0 || oceanMask[idx] > 0) continue;
    const target = receiver[idx] ?? -1;
    const available = (sediment[idx] ?? 0) + (incision[idx] ?? 0);
    const capacity = (flowAccumulation[idx] ?? 0) * Math.max(0.00015, (incision[idx] ?? 0) * 1.8);
    const excess = Math.max(0, available - capacity);
    const localDeposit = Math.min(0.008, excess * 0.62);
    deposition[idx] = localDeposit;
    wear[idx] = clamp01((incision[idx] ?? 0) / 0.015);
    deposit[idx] = clamp01(localDeposit / 0.008);
    elevations[idx] = clamp01((elevations[idx] ?? 0) - (incision[idx] ?? 0) + localDeposit);
    const carried = Math.max(0, available - localDeposit);
    if (target >= 0 && oceanMask[target] === 0) sediment[target] += carried;
    else exportedSediment += carried;
  }

  relaxSlopes(elevations, oceanMask, cols, rows, input.heightScale, seaLevel, wear, deposit);
  return {
    elevations,
    filledElevation: filled,
    depressionDepth,
    receiver,
    flowAccumulation,
    incision,
    deposition,
    wear,
    deposit,
    flowX,
    flowY,
    exportedSediment
  };
};
