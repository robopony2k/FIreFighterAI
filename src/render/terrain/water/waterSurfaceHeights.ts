type WaterComponent = {
  indices: number[];
  min: number;
};

type WaterSurfaceHeightsDeps = {
  oceanRatioMin: number;
  riverRatioMin: number;
};

const RIVER_STEP_BLEND_BLOCK_THRESHOLD = 0.26;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const buildWaterSurfaceHeights = (
  sampleHeights: Float32Array,
  supportMask: Uint8Array,
  oceanRatio: Float32Array,
  riverRatio: Float32Array,
  sampleCols: number,
  sampleRows: number,
  oceanLevel: number | null,
  sampledRiverSurface: Float32Array | undefined,
  sampledRiverStepStrength: Float32Array | undefined,
  deps: WaterSurfaceHeightsDeps
): Float32Array => {
  const total = sampleCols * sampleRows;
  const heights = new Float32Array(total).fill(Number.NaN);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const components: WaterComponent[] = [];
  let head = 0;
  let tail = 0;

  const push = (idx: number) => {
    visited[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };

  const hasWater = (idx: number): boolean => (supportMask[idx] ?? 0) > 0;
  const hasOcean = (idx: number): boolean =>
    hasWater(idx) && (oceanRatio[idx] ?? 0) >= deps.oceanRatioMin;
  const isRiverCell = (idx: number): boolean =>
    hasWater(idx) && (riverRatio[idx] ?? 0) >= deps.riverRatioMin;

  for (let i = 0; i < total; i += 1) {
    if (!hasWater(i) || !isRiverCell(i) || !sampledRiverSurface) {
      continue;
    }
    const riverSurface = sampledRiverSurface[i];
    if (!Number.isFinite(riverSurface)) {
      continue;
    }
    heights[i] = clamp(riverSurface, 0, 1);
  }

  const floodComponent = (seed: number, predicate: (idx: number) => boolean): WaterComponent | null => {
    if (visited[seed] || !predicate(seed)) {
      return null;
    }
    head = 0;
    tail = 0;
    push(seed);
    const component: WaterComponent = { indices: [], min: Number.POSITIVE_INFINITY };
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      component.indices.push(idx);
      component.min = Math.min(component.min, sampleHeights[idx] ?? 0);
      const x = idx % sampleCols;
      const y = Math.floor(idx / sampleCols);
      const neighbors = [idx - 1, idx + 1, idx - sampleCols, idx + sampleCols];
      for (const nIdx of neighbors) {
        if (nIdx < 0 || nIdx >= total) {
          continue;
        }
        if (visited[nIdx] || !predicate(nIdx)) {
          continue;
        }
        const nx = nIdx % sampleCols;
        const ny = Math.floor(nIdx / sampleCols);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) {
          continue;
        }
        push(nIdx);
      }
    }
    return component;
  };

  for (let i = 0; i < total; i += 1) {
    if (visited[i] || !hasOcean(i)) {
      continue;
    }
    const component = floodComponent(i, hasOcean);
    if (!component) {
      continue;
    }
    components.push(component);
  }

  for (const component of components) {
    const level = oceanLevel !== null ? clamp(oceanLevel, 0, 1) : clamp(component.min + 0.01, 0, 1);
    component.indices.forEach((idx) => {
      heights[idx] = level;
    });
  }

  for (let i = 0; i < total; i += 1) {
    if (!Number.isFinite(heights[i])) {
      heights[i] = sampleHeights[i] ?? 0;
    }
  }

  if (sampledRiverSurface && oceanLevel !== null) {
    const oceanLevelClamped = clamp(oceanLevel, 0, 1);
    for (let i = 0; i < total; i += 1) {
      if (!hasWater(i)) {
        continue;
      }
      const river = clamp(riverRatio[i] ?? 0, 0, 1);
      const ocean = clamp(oceanRatio[i] ?? 0, 0, 1);
      if (river <= 0.01 || ocean <= 0.01) {
        continue;
      }
      const riverSurface = sampledRiverSurface[i];
      if (!Number.isFinite(riverSurface)) {
        continue;
      }
      const rawStepStrength = sampledRiverStepStrength ? sampledRiverStepStrength[i] : 0;
      const stepStrength = Number.isFinite(rawStepStrength) ? clamp(rawStepStrength as number, 0, 1) : 0;
      if (stepStrength >= RIVER_STEP_BLEND_BLOCK_THRESHOLD) {
        continue;
      }
      const estuaryBlend = clamp((Math.min(river, ocean) - 0.06) / 0.24, 0, 1);
      if (estuaryBlend <= 0) {
        continue;
      }
      const blended = clamp(riverSurface * (1 - estuaryBlend) + oceanLevelClamped * estuaryBlend, 0, 1);
      heights[i] = blended;
    }
  }

  const smoothed = new Float32Array(total);
  for (let row = 0; row < sampleRows; row += 1) {
    for (let col = 0; col < sampleCols; col += 1) {
      const idx = row * sampleCols + col;
      if (!hasWater(idx)) {
        smoothed[idx] = heights[idx];
        continue;
      }
      const center = heights[idx];
      let sum = center;
      let count = 1;
      const neighbors = [idx - 1, idx + 1, idx - sampleCols, idx + sampleCols];
      for (const nIdx of neighbors) {
        if (nIdx < 0 || nIdx >= total || !hasWater(nIdx)) {
          continue;
        }
        sum += heights[nIdx];
        count += 1;
      }
      const avg = sum / Math.max(1, count);
      const river = clamp(riverRatio[idx] ?? 0, 0, 1);
      const ocean = clamp(oceanRatio[idx] ?? 0, 0, 1);
      const rawStepStrength = sampledRiverStepStrength ? sampledRiverStepStrength[idx] : 0;
      const stepStrength = Number.isFinite(rawStepStrength) ? clamp(rawStepStrength as number, 0, 1) : 0;
      const estuary = clamp((Math.min(river, ocean) - 0.05) / 0.2, 0, 1);
      const inlandRiver = clamp((river - ocean * 0.6 - 0.06) / 0.55, 0, 1);
      const stepBlend = clamp((stepStrength - 0.14) / (0.5 - 0.14), 0, 1);
      const stepDampen = 1 - stepBlend;
      const smoothAmt = (0.03 + estuary * 0.2) * (1 - inlandRiver * 0.72) * stepDampen;
      const target = center * (1 - smoothAmt) + avg * smoothAmt;
      const maxDelta = (0.004 + estuary * 0.035) * (1 - inlandRiver * 0.65) * stepDampen;
      if (maxDelta <= 1e-5) {
        smoothed[idx] = center;
      } else {
        smoothed[idx] = clamp(target, center - maxDelta, center + maxDelta);
      }
    }
  }
  heights.set(smoothed);

  if (sampledRiverSurface) {
    for (let i = 0; i < total; i += 1) {
      if (!hasWater(i)) {
        continue;
      }
      const riverSurface = sampledRiverSurface[i];
      if (!Number.isFinite(riverSurface)) {
        continue;
      }
      const river = clamp(riverRatio[i] ?? 0, 0, 1);
      const ocean = clamp(oceanRatio[i] ?? 0, 0, 1);
      const rawStepStrength = sampledRiverStepStrength ? sampledRiverStepStrength[i] : 0;
      const stepStrength = Number.isFinite(rawStepStrength) ? clamp(rawStepStrength as number, 0, 1) : 0;
      const riverDominance = clamp((river - ocean * 0.65 - 0.04) / 0.55, 0, 1);
      const stepKeep = clamp((stepStrength - 0.08) / 0.26, 0, 1);
      const preserve = clamp(riverDominance * 0.25 + stepKeep * 0.7, 0, 0.92);
      if (preserve <= 1e-5) {
        continue;
      }
      heights[i] = clamp(heights[i] * (1 - preserve) + riverSurface * preserve, 0, 1);
    }
  }

  return heights;
};
