import type { WorldState } from "../../../core/state.js";

export type FireFrontScanOptions = {
  minFire: number;
  minHeat01?: number;
  heatCap?: number;
};

export type ActiveFireFrontComponent = {
  tileIndices: number[];
  x: number;
  y: number;
  tileCount: number;
  priority: number;
};

type ScanBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.floor(value)));

const getScanBounds = (state: WorldState): ScanBounds | null => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  if (cols <= 0 || rows <= 0 || state.lastActiveFires <= 0) {
    return null;
  }
  if (!state.fireBoundsActive) {
    return { minX: 0, maxX: cols - 1, minY: 0, maxY: rows - 1 };
  }
  const bounds = {
    minX: clampInt(state.fireMinX, 0, cols - 1),
    maxX: clampInt(state.fireMaxX, 0, cols - 1),
    minY: clampInt(state.fireMinY, 0, rows - 1),
    maxY: clampInt(state.fireMaxY, 0, rows - 1)
  };
  return bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY ? bounds : null;
};

const isActiveFrontTile = (state: WorldState, idx: number, options: FireFrontScanOptions): boolean => {
  if ((state.tileFire[idx] ?? 0) > options.minFire) {
    return true;
  }
  const minHeat01 = options.minHeat01;
  if (minHeat01 === undefined) {
    return false;
  }
  return (state.tileHeat[idx] ?? 0) / Math.max(0.01, options.heatCap ?? 1) > minHeat01;
};

export const resolveActiveFireFrontComponents = (
  state: WorldState,
  options: FireFrontScanOptions
): ActiveFireFrontComponent[] => {
  const bounds = getScanBounds(state);
  if (!bounds) {
    return [];
  }

  const cols = state.grid.cols;
  const totalTiles = Math.max(0, state.grid.totalTiles);
  const visited = new Uint8Array(totalTiles);
  const queue = new Int32Array(totalTiles);
  const components: ActiveFireFrontComponent[] = [];

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const startIdx = y * cols + x;
      if (visited[startIdx] || !isActiveFrontTile(state, startIdx, options)) {
        continue;
      }

      let head = 0;
      let tail = 0;
      let totalFireScore = 0;
      let totalHeatScore = 0;
      let bestIdx = startIdx;
      let bestFire = state.tileFire[startIdx] ?? 0;
      let bestHeat = state.tileHeat[startIdx] ?? 0;
      const tileIndices: number[] = [];

      visited[startIdx] = 1;
      queue[tail++] = startIdx;

      while (head < tail) {
        const idx = queue[head++]!;
        const tileX = idx % cols;
        const tileY = Math.floor(idx / cols);
        const fire = state.tileFire[idx] ?? 0;
        const heat = state.tileHeat[idx] ?? 0;
        tileIndices.push(idx);
        totalFireScore += fire;
        totalHeatScore += heat;

        if (
          fire > bestFire ||
          (fire === bestFire && heat > bestHeat) ||
          (fire === bestFire &&
            heat === bestHeat &&
            (tileY < Math.floor(bestIdx / cols) ||
              (tileY === Math.floor(bestIdx / cols) && tileX < bestIdx % cols)))
        ) {
          bestIdx = idx;
          bestFire = fire;
          bestHeat = heat;
        }

        const maybePush = (nextX: number, nextY: number): void => {
          if (nextX < bounds.minX || nextX > bounds.maxX || nextY < bounds.minY || nextY > bounds.maxY) {
            return;
          }
          const nextIdx = nextY * cols + nextX;
          if (visited[nextIdx] || !isActiveFrontTile(state, nextIdx, options)) {
            return;
          }
          visited[nextIdx] = 1;
          queue[tail++] = nextIdx;
        };

        maybePush(tileX + 1, tileY);
        maybePush(tileX - 1, tileY);
        maybePush(tileX, tileY + 1);
        maybePush(tileX, tileY - 1);
      }

      components.push({
        tileIndices,
        x: bestIdx % cols,
        y: Math.floor(bestIdx / cols),
        tileCount: tileIndices.length,
        priority: totalFireScore * 2 + totalHeatScore * 0.15 + tileIndices.length * 0.01
      });
    }
  }

  return components.sort((left, right) => {
    if (right.priority !== left.priority) return right.priority - left.priority;
    if (right.tileCount !== left.tileCount) return right.tileCount - left.tileCount;
    if (left.y !== right.y) return left.y - right.y;
    return left.x - right.x;
  });
};

export const getComponentLineageIds = (
  component: ActiveFireFrontComponent,
  lineageByTile: Int32Array,
  cols: number,
  rows: number
): number[] => {
  const ids = new Set<number>();
  const addAt = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const id = lineageByTile[y * cols + x] ?? 0;
    if (id > 0) ids.add(id);
  };
  component.tileIndices.forEach((idx) => {
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    addAt(x, y);
    addAt(x + 1, y);
    addAt(x - 1, y);
    addAt(x, y + 1);
    addAt(x, y - 1);
  });
  return [...ids].sort((left, right) => left - right);
};

export const assignComponentLineage = (
  component: ActiveFireFrontComponent,
  lineageByTile: Int32Array,
  reportId: number
): void => {
  component.tileIndices.forEach((idx) => {
    lineageByTile[idx] = reportId;
  });
};

export const replaceLineageId = (lineageByTile: Int32Array, fromId: number, toId: number): void => {
  if (fromId === toId || fromId <= 0 || toId <= 0) return;
  for (let idx = 0; idx < lineageByTile.length; idx += 1) {
    if (lineageByTile[idx] === fromId) lineageByTile[idx] = toId;
  }
};
