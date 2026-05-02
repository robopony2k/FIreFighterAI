import type { FireFxWorldState } from "./fireFxTypes.js";

const FIRE_RENDER_SNAPSHOT_PADDING = 2;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const getSimFireEps = (world: FireFxWorldState): number =>
  Math.max(0.0001, Math.max(0.002, world.simPerf?.diffusionEps || 0.02) * 0.5);

export type FireRenderSnapshot = {
  cols: number;
  rows: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  tileFire: Float32Array;
  tileHeat: Float32Array;
  tileFuel: Float32Array;
  tileBurnAge: Float32Array;
  tileHeatRelease: Float32Array;
  tileWetness: Float32Array;
  lastActiveFires: number;
  fireBoundsActive: boolean;
};

export type FireFieldView = {
  alpha: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  hasBounds: boolean;
  lastActiveFires: number;
  getFireAt: (x: number, y: number) => number;
  getFireByIndex: (tileIdx: number) => number;
  getHeat01At: (x: number, y: number) => number;
  getHeat01ByIndex: (tileIdx: number) => number;
  getFuelAt: (x: number, y: number) => number;
  getFuelByIndex: (tileIdx: number) => number;
  getBurnAgeAt: (x: number, y: number) => number;
  getBurnAgeByIndex: (tileIdx: number) => number;
  getHeatReleaseAt: (x: number, y: number) => number;
  getHeatReleaseByIndex: (tileIdx: number) => number;
  getWetnessAt: (x: number, y: number) => number;
  getWetnessByIndex: (tileIdx: number) => number;
};

export const createEmptyFireRenderSnapshot = (
  cols: number,
  rows: number,
  lastActiveFires = 0,
  fireBoundsActive = false
): FireRenderSnapshot => ({
  cols,
  rows,
  minX: 0,
  maxX: -1,
  minY: 0,
  maxY: -1,
  width: 0,
  height: 0,
  tileFire: new Float32Array(0),
  tileHeat: new Float32Array(0),
  tileFuel: new Float32Array(0),
  tileBurnAge: new Float32Array(0),
  tileHeatRelease: new Float32Array(0),
  tileWetness: new Float32Array(0),
  lastActiveFires,
  fireBoundsActive
});

const snapshotHasSourceBounds = (snapshot: FireRenderSnapshot | null): boolean =>
  !!snapshot &&
  snapshot.width > 0 &&
  snapshot.lastActiveFires > 0;

const clampSnapshotBounds = (
  cols: number,
  rows: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): { minX: number; maxX: number; minY: number; maxY: number } => ({
  minX: clamp(minX, 0, Math.max(0, cols - 1)),
  maxX: clamp(maxX, 0, Math.max(0, cols - 1)),
  minY: clamp(minY, 0, Math.max(0, rows - 1)),
  maxY: clamp(maxY, 0, Math.max(0, rows - 1))
});

export const captureFireRenderSnapshot = (
  world: FireFxWorldState,
  previousSnapshot: FireRenderSnapshot | null
): FireRenderSnapshot => {
  const cols = world.grid.cols;
  const rows = world.grid.rows;
  const lastActiveFires = Math.max(0, world.lastActiveFires ?? 0);
  const fireBoundsActive = world.fireBoundsActive === true;
  const simFireEps = getSimFireEps(world);
  if (cols <= 0 || rows <= 0) {
    return createEmptyFireRenderSnapshot(cols, rows, lastActiveFires, fireBoundsActive);
  }
  if (lastActiveFires <= 0) {
    return createEmptyFireRenderSnapshot(cols, rows, lastActiveFires, fireBoundsActive);
  }
  let hasBounds = false;
  let minX = cols;
  let maxX = -1;
  let minY = rows;
  let maxY = -1;
  const scanMinX = fireBoundsActive ? clamp(world.fireMinX, 0, cols - 1) : 0;
  const scanMaxX = fireBoundsActive ? clamp(world.fireMaxX, 0, cols - 1) : cols - 1;
  const scanMinY = fireBoundsActive ? clamp(world.fireMinY, 0, rows - 1) : 0;
  const scanMaxY = fireBoundsActive ? clamp(world.fireMaxY, 0, rows - 1) : rows - 1;
  for (let y = scanMinY; y <= scanMaxY; y += 1) {
    const rowBase = y * cols;
    for (let x = scanMinX; x <= scanMaxX; x += 1) {
      const idx = rowBase + x;
      const fire = Math.max(0, world.tileFire[idx] ?? 0);
      if (fire <= simFireEps) {
        continue;
      }
      if (!hasBounds) {
        minX = maxX = x;
        minY = maxY = y;
        hasBounds = true;
        continue;
      }
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
  }
  if (hasBounds) {
    const clamped = clampSnapshotBounds(
      cols,
      rows,
      minX - FIRE_RENDER_SNAPSHOT_PADDING,
      maxX + FIRE_RENDER_SNAPSHOT_PADDING,
      minY - FIRE_RENDER_SNAPSHOT_PADDING,
      maxY + FIRE_RENDER_SNAPSHOT_PADDING
    );
    minX = clamped.minX;
    maxX = clamped.maxX;
    minY = clamped.minY;
    maxY = clamped.maxY;
  }
  const previousBoundsSnapshot = snapshotHasSourceBounds(previousSnapshot) ? previousSnapshot : null;
  if (previousBoundsSnapshot) {
    if (!hasBounds) {
      minX = previousBoundsSnapshot.minX;
      maxX = previousBoundsSnapshot.maxX;
      minY = previousBoundsSnapshot.minY;
      maxY = previousBoundsSnapshot.maxY;
      hasBounds = true;
    } else {
      minX = Math.min(minX, previousBoundsSnapshot.minX);
      maxX = Math.max(maxX, previousBoundsSnapshot.maxX);
      minY = Math.min(minY, previousBoundsSnapshot.minY);
      maxY = Math.max(maxY, previousBoundsSnapshot.maxY);
    }
  }
  if (!hasBounds || minX > maxX || minY > maxY) {
    return createEmptyFireRenderSnapshot(cols, rows, lastActiveFires, fireBoundsActive);
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const count = width * height;
  const tileFire = new Float32Array(count);
  const tileHeat = new Float32Array(count);
  const tileFuel = new Float32Array(count);
  const tileBurnAge = new Float32Array(count);
  const tileHeatRelease = new Float32Array(count);
  const tileWetness = new Float32Array(count);
  let write = 0;
  for (let y = minY; y <= maxY; y += 1) {
    const rowBase = y * cols;
    for (let x = minX; x <= maxX; x += 1) {
      const idx = rowBase + x;
      tileFire[write] = Math.max(0, world.tileFire[idx] ?? 0);
      tileHeat[write] = Math.max(0, world.tileHeat[idx] ?? 0);
      tileFuel[write] = clamp(world.tileFuel[idx] ?? 0, 0, 1);
      tileBurnAge[write] = Math.max(0, world.tileBurnAge[idx] ?? 0);
      tileHeatRelease[write] = Math.max(0, world.tileHeatRelease[idx] ?? 0);
      tileWetness[write] = clamp(world.tileSuppressionWetness[idx] ?? 0, 0, 1);
      write += 1;
    }
  }
  return {
    cols,
    rows,
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    tileFire,
    tileHeat,
    tileFuel,
    tileBurnAge,
    tileHeatRelease,
    tileWetness,
    lastActiveFires,
    fireBoundsActive
  };
};

const snapshotOffsetAt = (snapshot: FireRenderSnapshot, x: number, y: number): number => {
  if (snapshot.width <= 0 || x < snapshot.minX || x > snapshot.maxX || y < snapshot.minY || y > snapshot.maxY) {
    return -1;
  }
  return (y - snapshot.minY) * snapshot.width + (x - snapshot.minX);
};

const snapshotOffsetByIndex = (snapshot: FireRenderSnapshot, tileIdx: number): number => {
  if (snapshot.width <= 0 || snapshot.cols <= 0) {
    return -1;
  }
  const x = tileIdx % snapshot.cols;
  const y = Math.floor(tileIdx / snapshot.cols);
  return snapshotOffsetAt(snapshot, x, y);
};

const snapshotReadFloatAt = (
  snapshot: FireRenderSnapshot,
  x: number,
  y: number,
  source: Float32Array
): number => {
  const offset = snapshotOffsetAt(snapshot, x, y);
  return offset >= 0 ? source[offset] ?? 0 : 0;
};

const snapshotReadFloatByIndex = (
  snapshot: FireRenderSnapshot,
  tileIdx: number,
  source: Float32Array
): number => {
  const offset = snapshotOffsetByIndex(snapshot, tileIdx);
  return offset >= 0 ? source[offset] ?? 0 : 0;
};

export const createFireFieldView = (
  previousSnapshot: FireRenderSnapshot,
  currentSnapshot: FireRenderSnapshot,
  alpha: number,
  heatCap: number
): FireFieldView => {
  const clampedAlpha = clamp(alpha, 0, 1);
  const lerpFloat = (prevValue: number, nextValue: number): number =>
    prevValue + (nextValue - prevValue) * clampedAlpha;
  const previousHasBounds = previousSnapshot.width > 0;
  const currentHasBounds = currentSnapshot.width > 0;
  const minX = previousHasBounds && currentHasBounds
    ? Math.min(previousSnapshot.minX, currentSnapshot.minX)
    : currentHasBounds
      ? currentSnapshot.minX
      : previousSnapshot.minX;
  const maxX = previousHasBounds && currentHasBounds
    ? Math.max(previousSnapshot.maxX, currentSnapshot.maxX)
    : currentHasBounds
      ? currentSnapshot.maxX
      : previousSnapshot.maxX;
  const minY = previousHasBounds && currentHasBounds
    ? Math.min(previousSnapshot.minY, currentSnapshot.minY)
    : currentHasBounds
      ? currentSnapshot.minY
      : previousSnapshot.minY;
  const maxY = previousHasBounds && currentHasBounds
    ? Math.max(previousSnapshot.maxY, currentSnapshot.maxY)
    : currentHasBounds
      ? currentSnapshot.maxY
      : previousSnapshot.maxY;
  return {
    alpha: clampedAlpha,
    minX,
    maxX,
    minY,
    maxY,
    hasBounds: previousHasBounds || currentHasBounds,
    lastActiveFires: Math.max(previousSnapshot.lastActiveFires, currentSnapshot.lastActiveFires),
    getFireAt: (x: number, y: number): number =>
      lerpFloat(
        snapshotReadFloatAt(previousSnapshot, x, y, previousSnapshot.tileFire),
        snapshotReadFloatAt(currentSnapshot, x, y, currentSnapshot.tileFire)
      ),
    getFireByIndex: (tileIdx: number): number =>
      lerpFloat(
        snapshotReadFloatByIndex(previousSnapshot, tileIdx, previousSnapshot.tileFire),
        snapshotReadFloatByIndex(currentSnapshot, tileIdx, currentSnapshot.tileFire)
      ),
    getHeat01At: (x: number, y: number): number =>
      clamp(
        lerpFloat(
          snapshotReadFloatAt(previousSnapshot, x, y, previousSnapshot.tileHeat),
          snapshotReadFloatAt(currentSnapshot, x, y, currentSnapshot.tileHeat)
        ) / Math.max(0.01, heatCap),
        0,
        1
      ),
    getHeat01ByIndex: (tileIdx: number): number =>
      clamp(
        lerpFloat(
          snapshotReadFloatByIndex(previousSnapshot, tileIdx, previousSnapshot.tileHeat),
          snapshotReadFloatByIndex(currentSnapshot, tileIdx, currentSnapshot.tileHeat)
        ) / Math.max(0.01, heatCap),
        0,
        1
      ),
    getFuelAt: (x: number, y: number): number =>
      clamp(
        lerpFloat(
          snapshotReadFloatAt(previousSnapshot, x, y, previousSnapshot.tileFuel),
          snapshotReadFloatAt(currentSnapshot, x, y, currentSnapshot.tileFuel)
        ),
        0,
        1
      ),
    getFuelByIndex: (tileIdx: number): number =>
      clamp(
        lerpFloat(
          snapshotReadFloatByIndex(previousSnapshot, tileIdx, previousSnapshot.tileFuel),
          snapshotReadFloatByIndex(currentSnapshot, tileIdx, currentSnapshot.tileFuel)
        ),
        0,
        1
      ),
    getBurnAgeAt: (x: number, y: number): number =>
      Math.max(
        0,
        lerpFloat(
          snapshotReadFloatAt(previousSnapshot, x, y, previousSnapshot.tileBurnAge),
          snapshotReadFloatAt(currentSnapshot, x, y, currentSnapshot.tileBurnAge)
        )
      ),
    getBurnAgeByIndex: (tileIdx: number): number =>
      Math.max(
        0,
        lerpFloat(
          snapshotReadFloatByIndex(previousSnapshot, tileIdx, previousSnapshot.tileBurnAge),
          snapshotReadFloatByIndex(currentSnapshot, tileIdx, currentSnapshot.tileBurnAge)
        )
      ),
    getHeatReleaseAt: (x: number, y: number): number =>
      Math.max(
        0,
        lerpFloat(
          snapshotReadFloatAt(previousSnapshot, x, y, previousSnapshot.tileHeatRelease),
          snapshotReadFloatAt(currentSnapshot, x, y, currentSnapshot.tileHeatRelease)
        )
      ),
    getHeatReleaseByIndex: (tileIdx: number): number =>
      Math.max(
        0,
        lerpFloat(
          snapshotReadFloatByIndex(previousSnapshot, tileIdx, previousSnapshot.tileHeatRelease),
          snapshotReadFloatByIndex(currentSnapshot, tileIdx, currentSnapshot.tileHeatRelease)
        )
      ),
    getWetnessAt: (x: number, y: number): number =>
      clamp(
        lerpFloat(
          snapshotReadFloatAt(previousSnapshot, x, y, previousSnapshot.tileWetness),
          snapshotReadFloatAt(currentSnapshot, x, y, currentSnapshot.tileWetness)
        ),
        0,
        1
      ),
    getWetnessByIndex: (tileIdx: number): number =>
      clamp(
        lerpFloat(
          snapshotReadFloatByIndex(previousSnapshot, tileIdx, previousSnapshot.tileWetness),
          snapshotReadFloatByIndex(currentSnapshot, tileIdx, currentSnapshot.tileWetness)
        ),
        0,
        1
      )
  };
};

export const getNeighbourFireBias = (
  fireView: FireFieldView,
  cols: number,
  rows: number,
  x: number,
  y: number
): number => {
  let sum = 0;
  let count = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    const ny = y + oy;
    if (ny < 0 || ny >= rows) {
      continue;
    }
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const nx = x + ox;
      if (nx < 0 || nx >= cols) {
        continue;
      }
      sum += fireView.getFireAt(nx, ny);
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
};
