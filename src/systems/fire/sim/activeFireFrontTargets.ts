import type { WorldState } from "../../../core/state.js";

const ACTIVE_FIRE_FRONT_EPS = 0.03;

export type ActiveFireFrontTarget = {
  x: number;
  y: number;
  tileCount: number;
  priority: number;
};

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.floor(value)));

const isActiveFireTile = (state: WorldState, idx: number): boolean => (state.tileFire[idx] ?? 0) > ACTIVE_FIRE_FRONT_EPS;

const getScanBounds = (
  state: WorldState
): { minX: number; maxX: number; minY: number; maxY: number } | null => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  if (cols <= 0 || rows <= 0 || state.lastActiveFires <= 0) {
    return null;
  }
  if (!state.fireBoundsActive) {
    return {
      minX: 0,
      maxX: cols - 1,
      minY: 0,
      maxY: rows - 1
    };
  }
  const minX = clampInt(state.fireMinX, 0, cols - 1);
  const maxX = clampInt(state.fireMaxX, 0, cols - 1);
  const minY = clampInt(state.fireMinY, 0, rows - 1);
  const maxY = clampInt(state.fireMaxY, 0, rows - 1);
  return minX <= maxX && minY <= maxY ? { minX, maxX, minY, maxY } : null;
};

export const resolveActiveFireFrontTargets = (state: WorldState): ActiveFireFrontTarget[] => {
  const bounds = getScanBounds(state);
  if (!bounds) {
    return [];
  }

  const cols = state.grid.cols;
  const totalTiles = Math.max(0, state.grid.totalTiles);
  const visited = new Uint8Array(totalTiles);
  const queue = new Int32Array(totalTiles);
  const targets: ActiveFireFrontTarget[] = [];

  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const startIdx = y * cols + x;
      if (visited[startIdx] || !isActiveFireTile(state, startIdx)) {
        continue;
      }

      let head = 0;
      let tail = 0;
      let tileCount = 0;
      let totalFireScore = 0;
      let totalHeatScore = 0;
      let bestIdx = startIdx;
      let bestFire = state.tileFire[startIdx] ?? 0;
      let bestHeat = state.tileHeat[startIdx] ?? 0;

      visited[startIdx] = 1;
      queue[tail++] = startIdx;

      while (head < tail) {
        const idx = queue[head++]!;
        const tileX = idx % cols;
        const tileY = Math.floor(idx / cols);
        const fire = state.tileFire[idx] ?? 0;
        const heat = state.tileHeat[idx] ?? 0;
        tileCount += 1;
        totalFireScore += fire;
        totalHeatScore += heat;

        if (
          fire > bestFire ||
          (fire === bestFire && heat > bestHeat) ||
          (fire === bestFire && heat === bestHeat && (tileY < Math.floor(bestIdx / cols) || (tileY === Math.floor(bestIdx / cols) && tileX < bestIdx % cols)))
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
          if (visited[nextIdx] || !isActiveFireTile(state, nextIdx)) {
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

      targets.push({
        x: bestIdx % cols,
        y: Math.floor(bestIdx / cols),
        tileCount,
        priority: totalFireScore * 2 + totalHeatScore * 0.15 + tileCount * 0.01
      });
    }
  }

  return targets.sort((left, right) => {
    if (right.priority !== left.priority) {
      return right.priority - left.priority;
    }
    if (right.tileCount !== left.tileCount) {
      return right.tileCount - left.tileCount;
    }
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    return left.x - right.x;
  });
};
