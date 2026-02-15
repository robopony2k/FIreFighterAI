import type { WorldState } from "../../core/state.js";

const ACTIVE_FLAG = 1;
const WORK_FLAG = 2;
const NEXT_FLAG = 4;

export const ensureFireBlocks = (state: WorldState): void => {
  const desiredSize = Math.max(4, Math.floor(state.simPerf.blockSize || 16));
  if (state.fireBlockSize === desiredSize && state.tileBlockIndex.length === state.grid.totalTiles) {
    return;
  }
  const blockCols = Math.max(1, Math.ceil(state.grid.cols / desiredSize));
  const blockRows = Math.max(1, Math.ceil(state.grid.rows / desiredSize));
  const blockCount = blockCols * blockRows;
  state.fireBlockSize = desiredSize;
  state.fireBlockCols = blockCols;
  state.fireBlockRows = blockRows;
  state.fireBlockCount = blockCount;
  state.fireBlockFlags = new Uint8Array(blockCount);
  state.fireBlockActiveList = new Int32Array(blockCount);
  state.fireBlockWorkList = new Int32Array(blockCount);
  state.fireBlockNextList = new Int32Array(blockCount);
  state.fireBlockActiveCount = 0;
  state.fireBlockWorkCount = 0;
  state.fireBlockNextCount = 0;
  state.tileBlockIndex = new Int32Array(state.grid.totalTiles);
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    const x = i % state.grid.cols;
    const y = Math.floor(i / state.grid.cols);
    const bx = Math.floor(x / state.fireBlockSize);
    const by = Math.floor(y / state.fireBlockSize);
    state.tileBlockIndex[i] = by * state.fireBlockCols + bx;
  }
};

export const clearFireBlocks = (state: WorldState): void => {
  state.fireBlockFlags.fill(0);
  state.fireBlockActiveCount = 0;
  state.fireBlockWorkCount = 0;
  state.fireBlockNextCount = 0;
};

export const markFireBlockActiveByIndex = (state: WorldState, blockIndex: number): void => {
  if ((state.fireBlockFlags[blockIndex] & ACTIVE_FLAG) !== 0) {
    return;
  }
  state.fireBlockFlags[blockIndex] |= ACTIVE_FLAG;
  state.fireBlockActiveList[state.fireBlockActiveCount] = blockIndex;
  state.fireBlockActiveCount += 1;
};

export const markFireBlockActiveByTile = (state: WorldState, tileIndex: number): void => {
  const blockIndex = state.tileBlockIndex[tileIndex];
  markFireBlockActiveByIndex(state, blockIndex);
};

export const markFireBlockNextByIndex = (state: WorldState, blockIndex: number): void => {
  if ((state.fireBlockFlags[blockIndex] & NEXT_FLAG) !== 0) {
    return;
  }
  state.fireBlockFlags[blockIndex] |= NEXT_FLAG;
  state.fireBlockNextList[state.fireBlockNextCount] = blockIndex;
  state.fireBlockNextCount += 1;
};

export const markFireBlockNextByTile = (state: WorldState, tileIndex: number): void => {
  const blockIndex = state.tileBlockIndex[tileIndex];
  markFireBlockNextByIndex(state, blockIndex);
};

export const buildFireWorkBlocks = (state: WorldState): void => {
  let workCount = 0;
  const blockCols = state.fireBlockCols;
  const blockRows = state.fireBlockRows;
  for (let i = 0; i < state.fireBlockActiveCount; i += 1) {
    const blockIndex = state.fireBlockActiveList[i];
    const bx = blockIndex % blockCols;
    const by = Math.floor(blockIndex / blockCols);
    for (let oy = -1; oy <= 1; oy += 1) {
      const ny = by + oy;
      if (ny < 0 || ny >= blockRows) {
        continue;
      }
      const rowBase = ny * blockCols;
      for (let ox = -1; ox <= 1; ox += 1) {
        const nx = bx + ox;
        if (nx < 0 || nx >= blockCols) {
          continue;
        }
        const neighborIndex = rowBase + nx;
        if ((state.fireBlockFlags[neighborIndex] & WORK_FLAG) !== 0) {
          continue;
        }
        state.fireBlockFlags[neighborIndex] |= WORK_FLAG;
        state.fireBlockWorkList[workCount] = neighborIndex;
        workCount += 1;
      }
    }
  }
  state.fireBlockWorkCount = workCount;
};

export const finalizeFireBlocks = (state: WorldState): void => {
  for (let i = 0; i < state.fireBlockWorkCount; i += 1) {
    const blockIndex = state.fireBlockWorkList[i];
    state.fireBlockFlags[blockIndex] &= ~WORK_FLAG;
  }
  for (let i = 0; i < state.fireBlockActiveCount; i += 1) {
    const blockIndex = state.fireBlockActiveList[i];
    state.fireBlockFlags[blockIndex] &= ~ACTIVE_FLAG;
  }
  const nextCount = state.fireBlockNextCount;
  for (let i = 0; i < nextCount; i += 1) {
    const blockIndex = state.fireBlockNextList[i];
    state.fireBlockFlags[blockIndex] = (state.fireBlockFlags[blockIndex] & ~NEXT_FLAG) | ACTIVE_FLAG;
    state.fireBlockActiveList[i] = blockIndex;
  }
  state.fireBlockActiveCount = nextCount;
  state.fireBlockNextCount = 0;
  state.fireBlockWorkCount = 0;
};
