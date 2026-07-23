export type RiverMouthRenderTransition = {
  mouthMask: Uint8Array;
  mouthBlend: Float32Array;
  oceanOverlapMask: Uint8Array;
  openingEdges: Float32Array;
};

export type RiverMouthTransitionInput = {
  cols: number;
  rows: number;
  riverMask?: ArrayLike<number>;
  oceanMask?: ArrayLike<number>;
};

export const RIVER_MOUTH_RENDER_COVERAGE_FLOOR = 0.35;

export const resolveRiverMouthRenderCoverage = (coverage: number): number => {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(coverage) ? coverage : 0));
  return clamped > 0 ? Math.max(RIVER_MOUTH_RENDER_COVERAGE_FLOOR, clamped) : 0;
};

const ORTHOGONAL_NEIGHBORS = [
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 }
] as const;

const inBounds = (x: number, y: number, cols: number, rows: number): boolean =>
  x >= 0 && y >= 0 && x < cols && y < rows;

const pushOpeningEdge = (
  edges: number[],
  riverX: number,
  riverY: number,
  oceanX: number,
  oceanY: number
): void => {
  if (oceanX < riverX) {
    edges.push(riverX, riverY, riverX, riverY + 1);
  } else if (oceanX > riverX) {
    edges.push(riverX + 1, riverY, riverX + 1, riverY + 1);
  } else if (oceanY < riverY) {
    edges.push(riverX, riverY, riverX + 1, riverY);
  } else {
    edges.push(riverX, riverY + 1, riverX + 1, riverY + 1);
  }
};

export const buildRiverMouthRenderTransition = (
  input: RiverMouthTransitionInput
): RiverMouthRenderTransition => {
  const { cols, rows, riverMask, oceanMask } = input;
  const total = Math.max(0, cols * rows);
  const mouthMask = new Uint8Array(total);
  const mouthBlend = new Float32Array(total);
  const oceanOverlapMask = new Uint8Array(total);
  const openingEdges: number[] = [];
  if (!riverMask || !oceanMask || cols <= 0 || rows <= 0) {
    return { mouthMask, mouthBlend, oceanOverlapMask, openingEdges: new Float32Array() };
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      if ((riverMask[idx] ?? 0) <= 0 || (oceanMask[idx] ?? 0) > 0) {
        continue;
      }
      for (const { dx, dy } of ORTHOGONAL_NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny, cols, rows)) {
          continue;
        }
        const nIdx = ny * cols + nx;
        if ((oceanMask[nIdx] ?? 0) <= 0) {
          continue;
        }
        mouthMask[idx] = 1;
        mouthBlend[idx] = 1;
        oceanOverlapMask[idx] = 1;
        pushOpeningEdge(openingEdges, x, y, nx, ny);
      }
    }
  }

  // One upstream river ring starts the visual hand-off before the terminal
  // cell. This is render-only and never broadens the authoritative channel.
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      if (!mouthMask[idx]) {
        continue;
      }
      for (const { dx, dy } of ORTHOGONAL_NEIGHBORS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(nx, ny, cols, rows)) {
          continue;
        }
        const nIdx = ny * cols + nx;
        if ((riverMask[nIdx] ?? 0) > 0 && (oceanMask[nIdx] ?? 0) === 0 && !mouthMask[nIdx]) {
          mouthBlend[nIdx] = Math.max(mouthBlend[nIdx], 0.35);
        }
      }
    }
  }

  return {
    mouthMask,
    mouthBlend,
    oceanOverlapMask,
    openingEdges: new Float32Array(openingEdges)
  };
};

const rangesOverlap = (a0: number, a1: number, b0: number, b1: number, epsilon: number): boolean =>
  Math.min(Math.max(a0, a1), Math.max(b0, b1)) - Math.max(Math.min(a0, a1), Math.min(b0, b1)) > epsilon;

export const isRiverMouthOpeningSegment = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  openingEdges: ArrayLike<number>,
  epsilon = 1e-4
): boolean => {
  for (let i = 0; i + 3 < openingEdges.length; i += 4) {
    const ox0 = openingEdges[i] ?? 0;
    const oy0 = openingEdges[i + 1] ?? 0;
    const ox1 = openingEdges[i + 2] ?? 0;
    const oy1 = openingEdges[i + 3] ?? 0;
    const openingHorizontal = Math.abs(oy1 - oy0) <= epsilon;
    const segmentHorizontal = Math.abs(by - ay) <= epsilon;
    if (openingHorizontal && segmentHorizontal) {
      if (Math.abs(ay - oy0) <= epsilon && rangesOverlap(ax, bx, ox0, ox1, epsilon)) {
        return true;
      }
      continue;
    }
    const openingVertical = Math.abs(ox1 - ox0) <= epsilon;
    const segmentVertical = Math.abs(bx - ax) <= epsilon;
    if (
      openingVertical &&
      segmentVertical &&
      Math.abs(ax - ox0) <= epsilon &&
      rangesOverlap(ay, by, oy0, oy1, epsilon)
    ) {
      return true;
    }
  }
  return false;
};

export const applyRiverMouthOceanOverlap = (
  sampledMouthCoverage: ArrayLike<number> | undefined,
  oceanWater: Float32Array,
  oceanRatio: Float32Array,
  oceanSupportMask: Uint8Array,
  surfAttenuation?: Float32Array
): void => {
  if (!sampledMouthCoverage) {
    return;
  }
  const total = Math.min(sampledMouthCoverage.length, oceanSupportMask.length);
  for (let i = 0; i < total; i += 1) {
    const coverage = resolveRiverMouthRenderCoverage(sampledMouthCoverage[i] ?? 0);
    if (coverage <= 0) {
      continue;
    }
    oceanWater[i] = Math.max(oceanWater[i] ?? 0, coverage);
    oceanRatio[i] = Math.max(oceanRatio[i] ?? 0, coverage);
    oceanSupportMask[i] = 1;
    if (surfAttenuation) {
      surfAttenuation[i] = 0;
    }
  }
};
