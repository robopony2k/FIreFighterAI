export type RiverRibbonScalarFieldInput = {
  cols: number;
  rows: number;
  channelClass: Uint8Array;
  channelWidth: Float32Array;
  channelDownstream: Int32Array;
  lakeMask?: Uint16Array;
  oceanMask?: Uint8Array;
};

export type RiverRibbonScalarField = {
  values: Float32Array;
  cellsX: number;
  cellsY: number;
  scale: number;
};

export const RIVER_RIBBON_FIELD_SCALE = 4;
const RIVER_RIBBON_FEATHER_CELLS = 0.25;
const STREAM_CLASS_MIN = 2;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const hasRiverRibbonMetadata = (input: {
  total: number;
  channelClass?: Uint8Array;
  channelWidth?: Float32Array;
  channelDownstream?: Int32Array;
}): boolean => {
  if (
    input.channelClass?.length !== input.total ||
    input.channelWidth?.length !== input.total ||
    input.channelDownstream?.length !== input.total
  ) {
    return false;
  }
  for (let index = 0; index < input.total; index += 1) {
    if ((input.channelClass[index] ?? 0) > 0 && (input.channelDownstream[index] ?? -1) >= 0) return true;
  }
  return false;
};

export const buildRiverRibbonScalarField = (
  input: RiverRibbonScalarFieldInput
): RiverRibbonScalarField | undefined => {
  const total = input.cols * input.rows;
  if (
    input.channelClass.length !== total ||
    input.channelWidth.length !== total ||
    input.channelDownstream.length !== total
  ) {
    return undefined;
  }
  const scale = RIVER_RIBBON_FIELD_SCALE;
  const cellsX = input.cols * scale;
  const cellsY = input.rows * scale;
  const rowStride = cellsX + 1;
  const values = new Float32Array((cellsX + 1) * (cellsY + 1));
  let sourceCount = 0;

  const updateBounds = (
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    signedDistanceAt: (x: number, y: number) => number
  ): void => {
    const sx0 = clamp(Math.floor(minX * scale), 0, cellsX);
    const sy0 = clamp(Math.floor(minY * scale), 0, cellsY);
    const sx1 = clamp(Math.ceil(maxX * scale), 0, cellsX);
    const sy1 = clamp(Math.ceil(maxY * scale), 0, cellsY);
    for (let sy = sy0; sy <= sy1; sy += 1) {
      const py = sy / scale;
      for (let sx = sx0; sx <= sx1; sx += 1) {
        const px = sx / scale;
        const signedDistance = signedDistanceAt(px, py);
        const scalar = clamp(0.5 + signedDistance / (RIVER_RIBBON_FEATHER_CELLS * 2), 0, 1);
        const fieldIndex = sy * rowStride + sx;
        if (scalar > values[fieldIndex]) values[fieldIndex] = scalar;
      }
    }
  };

  const addDisc = (x: number, y: number, radius: number): void => {
    const extent = radius + RIVER_RIBBON_FEATHER_CELLS;
    updateBounds(x - extent, y - extent, x + extent, y + extent, (px, py) =>
      radius - Math.hypot(px - x, py - y)
    );
  };

  const addTaperedSegment = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    radiusA: number,
    radiusB: number
  ): void => {
    const extent = Math.max(radiusA, radiusB) + RIVER_RIBBON_FEATHER_CELLS;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSq = dx * dx + dy * dy;
    updateBounds(
      Math.min(ax, bx) - extent,
      Math.min(ay, by) - extent,
      Math.max(ax, bx) + extent,
      Math.max(ay, by) + extent,
      (px, py) => {
        const t = lengthSq > 1e-8 ? clamp(((px - ax) * dx + (py - ay) * dy) / lengthSq, 0, 1) : 0;
        const radius = radiusA + (radiusB - radiusA) * t;
        return radius - Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
      }
    );
  };

  for (let index = 0; index < total; index += 1) {
    if ((input.channelClass[index] ?? 0) < STREAM_CLASS_MIN) continue;
    sourceCount += 1;
    const radius = Math.max(0.04, (input.channelWidth[index] ?? 0) * 0.5);
    const x = index % input.cols + 0.5;
    const y = Math.floor(index / input.cols) + 0.5;
    addDisc(x, y, radius);
    const target = input.channelDownstream[index] ?? -1;
    if (target < 0 || target >= total) continue;
    const targetClass = input.channelClass[target] ?? 0;
    const targetIsLake = (input.lakeMask?.[target] ?? 0) > 0;
    const targetIsOcean = (input.oceanMask?.[target] ?? 0) > 0;
    if (targetClass < STREAM_CLASS_MIN && !targetIsLake && !targetIsOcean) continue;
    const targetRadius = targetClass >= STREAM_CLASS_MIN
      ? Math.max(0.04, (input.channelWidth[target] ?? 0) * 0.5)
      : radius;
    const tx = target % input.cols + 0.5;
    const ty = Math.floor(target / input.cols) + 0.5;
    addTaperedSegment(x, y, tx, ty, radius, targetRadius);
  }

  if (input.lakeMask) {
    const isLakeCell = (x: number, y: number): boolean =>
      x >= 0 && y >= 0 && x < input.cols && y < input.rows && (input.lakeMask?.[y * input.cols + x] ?? 0) > 0;
    const setLakeBoundary = (sx0: number, sy0: number, sxStep: number, syStep: number): void => {
      for (let step = 0; step <= scale; step += 1) {
        const fieldIndex = (sy0 + syStep * step) * rowStride + sx0 + sxStep * step;
        values[fieldIndex] = Math.min(values[fieldIndex], 0.5001);
      }
    };
    for (let index = 0; index < total; index += 1) {
      if ((input.lakeMask[index] ?? 0) === 0) continue;
      sourceCount += 1;
      const x = index % input.cols;
      const y = Math.floor(index / input.cols);
      const sx0 = x * scale;
      const sy0 = y * scale;
      for (let sy = sy0; sy <= sy0 + scale; sy += 1) {
        const rowOffset = sy * rowStride;
        for (let sx = sx0; sx <= sx0 + scale; sx += 1) values[rowOffset + sx] = 1;
      }
    }
    for (let index = 0; index < total; index += 1) {
      if ((input.lakeMask[index] ?? 0) === 0) continue;
      const x = index % input.cols;
      const y = Math.floor(index / input.cols);
      const sx0 = x * scale;
      const sy0 = y * scale;
      if (!isLakeCell(x, y - 1)) setLakeBoundary(sx0, sy0, 1, 0);
      if (!isLakeCell(x + 1, y)) setLakeBoundary(sx0 + scale, sy0, 0, 1);
      if (!isLakeCell(x, y + 1)) setLakeBoundary(sx0, sy0 + scale, 1, 0);
      if (!isLakeCell(x - 1, y)) setLakeBoundary(sx0, sy0, 0, 1);
    }
  }
  return sourceCount > 0 ? { values, cellsX, cellsY, scale } : undefined;
};
