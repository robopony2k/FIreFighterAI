import { clamp } from "../../../core/utils.js";

const NEIGHBORS_4 = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 }
] as const;

type HeapNode = {
  index: number;
  priority: number;
};

class MinHeap {
  private readonly nodes: HeapNode[] = [];

  get size(): number {
    return this.nodes.length;
  }

  push(node: HeapNode): void {
    this.nodes.push(node);
    this.bubbleUp(this.nodes.length - 1);
  }

  pop(): HeapNode | null {
    if (this.nodes.length === 0) {
      return null;
    }
    const first = this.nodes[0];
    const last = this.nodes.pop();
    if (last && this.nodes.length > 0) {
      this.nodes[0] = last;
      this.bubbleDown(0);
    }
    return first ?? null;
  }

  private bubbleUp(index: number): void {
    let child = index;
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2);
      const childNode = this.nodes[child];
      const parentNode = this.nodes[parent];
      if (!childNode || !parentNode || compareNode(childNode, parentNode) >= 0) {
        break;
      }
      this.nodes[child] = parentNode;
      this.nodes[parent] = childNode;
      child = parent;
    }
  }

  private bubbleDown(index: number): void {
    let parent = index;
    while (true) {
      const left = parent * 2 + 1;
      const right = left + 1;
      let best = parent;
      if (left < this.nodes.length && compareNode(this.nodes[left], this.nodes[best]) < 0) {
        best = left;
      }
      if (right < this.nodes.length && compareNode(this.nodes[right], this.nodes[best]) < 0) {
        best = right;
      }
      if (best === parent) {
        break;
      }
      const parentNode = this.nodes[parent];
      this.nodes[parent] = this.nodes[best];
      this.nodes[best] = parentNode;
      parent = best;
    }
  }
}

export type DepressionBasin = {
  id: number;
  tiles: number[];
  floorIndex: number;
  outletIndex: number;
  outletTargetIndex: number;
  spillElevation: number;
  minElevation: number;
  maxDepth: number;
  area: number;
  rainfallScore: number;
  runoffScore: number;
  catchmentRunoff: number;
};

export type DepressionBasinSolveResult = {
  filledElevation: Float32Array;
  flowTarget: Int32Array;
  runoffAccumulation: Float32Array;
  flow: Float32Array;
  basinIdByTile: Int32Array;
  basins: DepressionBasin[];
};

export type DepressionBasinSolveInput = {
  cols: number;
  rows: number;
  elevationMap: ArrayLike<number>;
  oceanMask: Uint8Array;
  rainfall: Float32Array;
  minDepth: number;
};

const compareNode = (a: HeapNode | undefined, b: HeapNode | undefined): number => {
  if (!a || !b) {
    return 0;
  }
  return a.priority - b.priority || a.index - b.index;
};

const idxAt = (x: number, y: number, cols: number): number => y * cols + x;

const isEdge = (idx: number, cols: number, rows: number): boolean => {
  const x = idx % cols;
  const y = Math.floor(idx / cols);
  return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
};

const buildPriorityFlood = (input: DepressionBasinSolveInput): {
  filledElevation: Float32Array;
  flowTarget: Int32Array;
} => {
  const { cols, rows, elevationMap, oceanMask } = input;
  const total = cols * rows;
  const filledElevation = new Float32Array(total);
  const flowTarget = new Int32Array(total);
  const visited = new Uint8Array(total);
  flowTarget.fill(-1);
  const heap = new MinHeap();

  for (let idx = 0; idx < total; idx += 1) {
    if (oceanMask[idx] === 0 && !isEdge(idx, cols, rows)) {
      continue;
    }
    const elevation = elevationMap[idx] ?? 0;
    filledElevation[idx] = elevation;
    visited[idx] = 1;
    heap.push({ index: idx, priority: elevation });
  }

  while (heap.size > 0) {
    const node = heap.pop();
    if (!node) {
      break;
    }
    const idx = node.index;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const currentFill = filledElevation[idx] ?? (elevationMap[idx] ?? 0);
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = idxAt(nx, ny, cols);
      if (visited[nIdx] > 0) {
        continue;
      }
      const nElevation = elevationMap[nIdx] ?? currentFill;
      const nFill = Math.max(nElevation, currentFill);
      filledElevation[nIdx] = nFill;
      flowTarget[nIdx] = idx;
      visited[nIdx] = 1;
      heap.push({ index: nIdx, priority: nFill });
    }
  }

  for (let idx = 0; idx < total; idx += 1) {
    if (visited[idx] === 0) {
      filledElevation[idx] = elevationMap[idx] ?? 0;
    }
  }

  return { filledElevation, flowTarget };
};

const accumulateRunoff = (
  cols: number,
  rows: number,
  oceanMask: Uint8Array,
  rainfall: Float32Array,
  elevationMap: ArrayLike<number>,
  filledElevation: Float32Array,
  flowTarget: Int32Array
): { runoffAccumulation: Float32Array; flow: Float32Array } => {
  const total = cols * rows;
  const runoffAccumulation = new Float32Array(total);
  const order = Array.from({ length: total }, (_, idx) => idx);
  for (let idx = 0; idx < total; idx += 1) {
    runoffAccumulation[idx] = oceanMask[idx] > 0 ? 0 : Math.max(0, rainfall[idx] ?? 0);
  }
  order.sort((a, b) =>
    (filledElevation[b] ?? 0) - (filledElevation[a] ?? 0) ||
    (elevationMap[b] ?? 0) - (elevationMap[a] ?? 0) ||
    a - b
  );
  for (const idx of order) {
    if (oceanMask[idx] > 0) {
      continue;
    }
    const target = flowTarget[idx] ?? -1;
    if (target < 0 || target >= total) {
      continue;
    }
    runoffAccumulation[target] += (runoffAccumulation[idx] ?? 0) * 0.86;
  }

  const samples: number[] = [];
  for (let idx = 0; idx < total; idx += 1) {
    if (oceanMask[idx] === 0 && runoffAccumulation[idx] > 0) {
      samples.push(runoffAccumulation[idx]);
    }
  }
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.min(samples.length - 1, Math.floor(samples.length * 0.95))] ?? 1;
  const denom = Math.max(0.0001, p95);
  const flow = new Float32Array(total);
  for (let idx = 0; idx < total; idx += 1) {
    flow[idx] = clamp((runoffAccumulation[idx] ?? 0) / denom, 0, 1);
  }
  return { runoffAccumulation, flow };
};

const collectBasinComponents = (input: DepressionBasinSolveInput, filledElevation: Float32Array): {
  basinIdByTile: Int32Array;
  components: number[][];
} => {
  const { cols, rows, elevationMap, oceanMask, minDepth } = input;
  const total = cols * rows;
  const basinIdByTile = new Int32Array(total);
  basinIdByTile.fill(-1);
  const components: number[][] = [];
  const queue = new Int32Array(total);
  const minFillDepth = Math.max(0.0015, minDepth * 0.35);

  for (let start = 0; start < total; start += 1) {
    if (
      basinIdByTile[start] >= 0 ||
      oceanMask[start] > 0 ||
      (filledElevation[start] ?? 0) - (elevationMap[start] ?? 0) < minFillDepth
    ) {
      continue;
    }
    const id = components.length;
    const tiles: number[] = [];
    let head = 0;
    let tail = 0;
    queue[tail] = start;
    tail += 1;
    basinIdByTile[start] = id;
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      tiles.push(idx);
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      for (const dir of NEIGHBORS_4) {
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          continue;
        }
        const nIdx = idxAt(nx, ny, cols);
        if (
          basinIdByTile[nIdx] >= 0 ||
          oceanMask[nIdx] > 0 ||
          (filledElevation[nIdx] ?? 0) - (elevationMap[nIdx] ?? 0) < minFillDepth
        ) {
          continue;
        }
        basinIdByTile[nIdx] = id;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    components.push(tiles);
  }

  return { basinIdByTile, components };
};

const measureComponent = (
  id: number,
  tiles: number[],
  input: DepressionBasinSolveInput,
  filledElevation: Float32Array,
  flowTarget: Int32Array,
  runoffAccumulation: Float32Array,
  flow: Float32Array,
  basinIdByTile: Int32Array
): DepressionBasin => {
  const { cols, rows, elevationMap, rainfall } = input;
  let minElevation = Number.POSITIVE_INFINITY;
  let floorIndex = tiles[0] ?? 0;
  let spillElevation = 0;
  let rainfallSum = 0;
  let flowSum = 0;
  let catchmentRunoff = 0;

  for (const idx of tiles) {
    const elevation = elevationMap[idx] ?? 0;
    const fill = filledElevation[idx] ?? elevation;
    if (elevation < minElevation || (elevation === minElevation && idx < floorIndex)) {
      minElevation = elevation;
      floorIndex = idx;
    }
    spillElevation = Math.max(spillElevation, fill);
    rainfallSum += rainfall[idx] ?? 0;
    flowSum += flow[idx] ?? 0;
    catchmentRunoff = Math.max(catchmentRunoff, runoffAccumulation[idx] ?? 0);
  }

  let outletIndex = -1;
  let outletTargetIndex = -1;
  let outletScore = Number.POSITIVE_INFINITY;
  const tileSetId = id;
  for (const idx of tiles) {
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (const dir of NEIGHBORS_4) {
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = idxAt(nx, ny, cols);
      if ((basinIdByTile[nIdx] ?? -1) === tileSetId) {
        continue;
      }
      const targetFill = filledElevation[nIdx] ?? (elevationMap[nIdx] ?? spillElevation);
      const targetElevation = elevationMap[nIdx] ?? targetFill;
      const followsDrainage = (flowTarget[idx] ?? -1) === nIdx ? -0.004 : 0;
      const score = Math.abs(targetFill - spillElevation) + targetElevation * 0.01 + followsDrainage + nIdx * 1e-9;
      if (score < outletScore) {
        outletScore = score;
        outletIndex = idx;
        outletTargetIndex = nIdx;
      }
    }
  }

  const area = tiles.length;
  const maxDepth = spillElevation - (Number.isFinite(minElevation) ? minElevation : spillElevation);
  return {
    id: id + 1,
    tiles,
    floorIndex,
    outletIndex,
    outletTargetIndex,
    spillElevation,
    minElevation: Number.isFinite(minElevation) ? minElevation : spillElevation,
    maxDepth,
    area,
    rainfallScore: rainfallSum / Math.max(1, area),
    runoffScore: flowSum / Math.max(1, area),
    catchmentRunoff
  };
};

export const solveDepressionBasins = (input: DepressionBasinSolveInput): DepressionBasinSolveResult => {
  const { cols, rows } = input;
  const { filledElevation, flowTarget } = buildPriorityFlood(input);
  const { runoffAccumulation, flow } = accumulateRunoff(
    cols,
    rows,
    input.oceanMask,
    input.rainfall,
    input.elevationMap,
    filledElevation,
    flowTarget
  );
  const { basinIdByTile, components } = collectBasinComponents(input, filledElevation);
  const basins = components.map((tiles, id) =>
    measureComponent(id, tiles, input, filledElevation, flowTarget, runoffAccumulation, flow, basinIdByTile)
  );
  basins.sort((a, b) =>
    b.catchmentRunoff - a.catchmentRunoff ||
    b.runoffScore - a.runoffScore ||
    b.maxDepth - a.maxDepth ||
    a.floorIndex - b.floorIndex
  );
  return {
    filledElevation,
    flowTarget,
    runoffAccumulation,
    flow,
    basinIdByTile,
    basins
  };
};
