import { COAST_CLASS_BEACH, COAST_CLASS_CLIFF, COAST_CLASS_NONE, COAST_CLASS_SHELF_WATER, TILE_TYPE_IDS } from "../../../core/state.js";
import { fbmNoise, hash2D, ridgedFbmNoise } from "../../../mapgen/noise.js";
import type { MapGenDebug, MapGenDebugPhase, MapGenReporter } from "../../../mapgen/mapgenTypes.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";

export type NoiseLandmassCoreInput = {
  seed: number;
  cols: number;
  rows: number;
  settings: MapGenSettings;
  includeRivers?: boolean;
  previewMode?: "shape" | "relief" | "water";
};

export type NoiseLandmassInput = NoiseLandmassCoreInput & {
  report?: MapGenReporter;
  yieldIfNeeded?: () => Promise<boolean>;
  debug?: MapGenDebug;
};

export type NoiseLandmassResult = {
  elevationMap: number[];
  elevationFloatMap: Float32Array;
  riverMask: Uint8Array;
  seaLevelBase: number;
  seaLevelMap: Float32Array;
  oceanMask: Uint8Array;
  tileTypes: Uint8Array;
  coastDistance: Uint16Array;
  coastClass: Uint8Array;
  erosionWearMap: Float32Array;
  erosionDepositMap: Float32Array;
  erosionHardnessMap: Float32Array;
  erosionFlowXMap: Float32Array;
  erosionFlowYMap: Float32Array;
  tectonicStressMap: Float32Array;
  tectonicTrendXMap: Float32Array;
  tectonicTrendYMap: Float32Array;
  rawNoiseMap: Float32Array;
  redistributedHeightMap: Float32Array;
  edgeDistanceMap: Float32Array;
  islandMask: Float32Array;
  ridgeMask: Float32Array;
  valleyMask: Float32Array;
  flowMap: Float32Array;
};

const SEA_LEVEL = 0.5;
const SEA_LEVEL_MIN = 0.02;
const SEA_LEVEL_MAX = 0.72;
const UNVISITED = -1;
const TAU = Math.PI * 2;
const CARDINAL_OFFSETS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 }
] as const;
const DRAINAGE_OFFSETS = [
  ...CARDINAL_OFFSETS,
  { dx: 1, dy: 1 },
  { dx: -1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: -1 }
] as const;
const ARCHETYPE_SEED_OFFSETS: Record<MapGenSettings["terrainArchetype"], number> = {
  MASSIF: 11_003,
  LONG_SPINE: 23_017,
  TWIN_BAY: 37_019,
  SHELF: 43_021
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);
const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

class MinHeap {
  private readonly indices: number[] = [];
  private readonly priorities: number[] = [];

  get size(): number {
    return this.indices.length;
  }

  push(index: number, priority: number): void {
    let i = this.indices.length;
    this.indices.push(index);
    this.priorities.push(priority);
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if ((this.priorities[parent] ?? 0) <= priority) {
        break;
      }
      this.indices[i] = this.indices[parent]!;
      this.priorities[i] = this.priorities[parent]!;
      i = parent;
    }
    this.indices[i] = index;
    this.priorities[i] = priority;
  }

  pop(): number {
    const result = this.indices[0] ?? -1;
    const lastIndex = this.indices.pop() ?? -1;
    const lastPriority = this.priorities.pop() ?? 0;
    if (this.indices.length === 0) {
      return result;
    }
    let i = 0;
    while (true) {
      const left = i * 2 + 1;
      const right = left + 1;
      if (left >= this.indices.length) {
        break;
      }
      const child =
        right < this.indices.length && (this.priorities[right] ?? 0) < (this.priorities[left] ?? 0)
          ? right
          : left;
      if ((this.priorities[child] ?? 0) >= lastPriority) {
        break;
      }
      this.indices[i] = this.indices[child]!;
      this.priorities[i] = this.priorities[child]!;
      i = child;
    }
    this.indices[i] = lastIndex;
    this.priorities[i] = lastPriority;
    return result;
  }
}

const lineRidge = (along: number, across: number, width: number, length: number, curve: number): number => {
  const curvedAcross = across - curve;
  const cross = Math.exp(-(curvedAcross * curvedAcross) / Math.max(0.0001, width * width));
  return cross * smoothstep(length, length * 0.58, Math.abs(along));
};

const gaussian = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): number => {
  const dx = (x - cx) / Math.max(0.0001, rx);
  const dy = (y - cy) / Math.max(0.0001, ry);
  return Math.exp(-(dx * dx + dy * dy));
};

const edgeDistance01 = (x: number, y: number, cols: number, rows: number): number => {
  const nx = cols <= 1 ? 0 : x / (cols - 1);
  const ny = rows <= 1 ? 0 : y / (rows - 1);
  const dx = Math.min(nx, 1 - nx);
  const dy = Math.min(ny, 1 - ny);
  return clamp01(Math.min(dx, dy) * 2);
};

const buildSeaLevelMap = (
  cols: number,
  rows: number,
  settings: MapGenSettings,
  seaLevelBase: number
): { seaLevelBase: number; seaLevelMap: Float32Array } => {
  const total = cols * rows;
  const seaLevelMap = new Float32Array(total);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const edge = edgeDistance01(x, y, cols, rows);
      seaLevelMap[y * cols + x] = clamp(seaLevelBase + (1 - edge) * settings.edgeWaterBias, SEA_LEVEL_MIN, SEA_LEVEL_MAX);
    }
  }
  return { seaLevelBase, seaLevelMap };
};

const countMaskCoverage = (mask: Uint8Array): number => {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] > 0) {
      count += 1;
    }
  }
  return count;
};

const resolveCalibratedSeaLevel = (
  elevations: Float32Array,
  cols: number,
  rows: number,
  settings: MapGenSettings
): { seaLevelBase: number; seaLevelMap: Float32Array; oceanMask: Uint8Array } => {
  const total = Math.max(1, cols * rows);
  const targetOceanRatio = clamp(1 - settings.landCoverageTarget, 0.18, 0.68);
  const biasOffset = (clamp01(settings.seaLevelBias) - 0.5) * 0.16;
  let low = SEA_LEVEL_MIN - Math.max(0, settings.edgeWaterBias);
  let high = SEA_LEVEL_MAX;
  let bestBase = settings.baseWaterThreshold;
  let bestError = Number.POSITIVE_INFINITY;

  for (let i = 0; i < 18; i += 1) {
    const mid = (low + high) * 0.5;
    const seaLevelMap = buildSeaLevelMap(cols, rows, settings, mid).seaLevelMap;
    const oceanMask = buildOceanMask(elevations, seaLevelMap, cols, rows);
    const oceanRatio = countMaskCoverage(oceanMask) / total;
    const error = Math.abs(oceanRatio - targetOceanRatio);
    if (error < bestError) {
      bestError = error;
      bestBase = mid;
    }
    if (oceanRatio < targetOceanRatio) {
      low = mid;
    } else {
      high = mid;
    }
  }

  const biasedBase = clamp(bestBase + biasOffset, SEA_LEVEL_MIN - Math.max(0, settings.edgeWaterBias), SEA_LEVEL_MAX);
  const biasedMap = buildSeaLevelMap(cols, rows, settings, biasedBase).seaLevelMap;
  const biasedOcean = buildOceanMask(elevations, biasedMap, cols, rows);
  return {
    seaLevelBase: biasedBase,
    seaLevelMap: biasedMap,
    oceanMask: biasedOcean
  };
};

const buildOceanMask = (
  elevations: Float32Array,
  seaLevelMap: Float32Array,
  cols: number,
  rows: number
): Uint8Array => {
  const total = cols * rows;
  const water = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    water[i] = (elevations[i] ?? 0) <= (seaLevelMap[i] ?? SEA_LEVEL) ? 1 : 0;
  }
  const ocean = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const enqueue = (idx: number): void => {
    if (water[idx] === 0 || ocean[idx] > 0) {
      return;
    }
    ocean[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };
  for (let x = 0; x < cols; x += 1) {
    enqueue(x);
    enqueue((rows - 1) * cols + x);
  }
  for (let y = 0; y < rows; y += 1) {
    enqueue(y * cols);
    enqueue(y * cols + cols - 1);
  }
  while (head < tail) {
    const idx = queue[head] ?? 0;
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (let i = 0; i < CARDINAL_OFFSETS.length; i += 1) {
      const offset = CARDINAL_OFFSETS[i]!;
      const nx = x + offset.dx;
      const ny = y + offset.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      enqueue(ny * cols + nx);
    }
  }
  return ocean;
};

const buildDistanceFromMask = (mask: Uint8Array, cols: number, rows: number): Uint16Array => {
  const total = cols * rows;
  const distance = new Uint16Array(total);
  distance.fill(65535);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i += 1) {
    if (mask[i] > 0) {
      distance[i] = 0;
      queue[tail] = i;
      tail += 1;
    }
  }
  while (head < tail) {
    const idx = queue[head] ?? 0;
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const nextDistance = Math.min(65534, (distance[idx] ?? 0) + 1);
    for (let i = 0; i < CARDINAL_OFFSETS.length; i += 1) {
      const offset = CARDINAL_OFFSETS[i]!;
      const nx = x + offset.dx;
      const ny = y + offset.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = ny * cols + nx;
      if ((distance[nIdx] ?? 0) <= nextDistance) {
        continue;
      }
      distance[nIdx] = nextDistance;
      queue[tail] = nIdx;
      tail += 1;
    }
  }
  return distance;
};

const emitPhase = async (
  input: NoiseLandmassInput,
  phase: MapGenDebugPhase,
  elevations: Float32Array,
  tileTypes?: Uint8Array,
  riverMask?: Uint8Array,
  oceanMask?: Uint8Array,
  seaLevel?: Float32Array,
  coastDistance?: Uint16Array,
  coastClass?: Uint8Array
): Promise<void> => {
  if (!input.debug) {
    return;
  }
  await input.debug.onPhase({
    phase,
    elevations: Float32Array.from(elevations),
    tileTypes,
    riverMask,
    oceanMask,
    seaLevel,
    coastDistance,
    coastClass
  });
  if (input.debug.waitForStep) {
    await input.debug.waitForStep();
  }
};

const buildTileTypesAndCoast = (
  elevations: Float32Array,
  oceanMask: Uint8Array,
  riverMask: Uint8Array,
  seaLevelMap: Float32Array,
  cols: number,
  rows: number,
  includeRivers: boolean
): { tileTypes: Uint8Array; coastDistance: Uint16Array; coastClass: Uint8Array } => {
  const total = cols * rows;
  const landMask = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    landMask[i] = oceanMask[i] === 0 ? 1 : 0;
  }
  const distToOcean = buildDistanceFromMask(oceanMask, cols, rows);
  const distToLand = buildDistanceFromMask(landMask, cols, rows);
  const tileTypes = new Uint8Array(total);
  const coastDistance = new Uint16Array(total);
  const coastClass = new Uint8Array(total);
  tileTypes.fill(TILE_TYPE_IDS.grass);
  coastClass.fill(COAST_CLASS_NONE);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      if (oceanMask[idx] > 0) {
        tileTypes[idx] = TILE_TYPE_IDS.water;
        const dist = distToLand[idx] ?? 0;
        coastDistance[idx] = dist < 65535 ? dist : 0;
        coastClass[idx] = dist > 0 && dist <= 4 ? COAST_CLASS_SHELF_WATER : COAST_CLASS_NONE;
        continue;
      }
      const dist = distToOcean[idx] ?? 0;
      coastDistance[idx] = dist < 65535 ? dist : 0;
      if (includeRivers && riverMask[idx] > 0) {
        tileTypes[idx] = TILE_TYPE_IDS.water;
        continue;
      }
      if (dist > 0 && dist <= 5) {
        const elevation = elevations[idx] ?? SEA_LEVEL;
        const seaLevel = seaLevelMap[idx] ?? SEA_LEVEL;
        let maxSlope = 0;
        for (let i = 0; i < CARDINAL_OFFSETS.length; i += 1) {
          const offset = CARDINAL_OFFSETS[i]!;
          const nx = x + offset.dx;
          const ny = y + offset.dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
            continue;
          }
          maxSlope = Math.max(maxSlope, Math.abs(elevation - (elevations[ny * cols + nx] ?? elevation)));
        }
        const beach = maxSlope <= 0.035 && elevation - seaLevel <= 0.075;
        coastClass[idx] = beach ? COAST_CLASS_BEACH : COAST_CLASS_CLIFF;
        tileTypes[idx] = beach ? TILE_TYPE_IDS.beach : TILE_TYPE_IDS.rocky;
      }
    }
  }
  return { tileTypes, coastDistance, coastClass };
};

const buildDrainage = (
  seed: number,
  cols: number,
  rows: number,
  settings: MapGenSettings,
  elevations: Float32Array,
  oceanMask: Uint8Array,
  seaLevelMap: Float32Array,
  ridgeMask: Float32Array,
  valleyMask: Float32Array,
  distToOcean: Uint16Array
): {
  riverMask: Uint8Array;
  flowMap: Float32Array;
  erosionWearMap: Float32Array;
  erosionDepositMap: Float32Array;
  erosionHardnessMap: Float32Array;
  erosionFlowXMap: Float32Array;
  erosionFlowYMap: Float32Array;
} => {
  const total = cols * rows;
  const riverMask = new Uint8Array(total);
  const flowMap = new Float32Array(total);
  const erosionWearMap = new Float32Array(total);
  const erosionDepositMap = new Float32Array(total);
  const erosionHardnessMap = new Float32Array(total);
  const erosionFlowXMap = new Float32Array(total);
  const erosionFlowYMap = new Float32Array(total);
  const downslope = new Int32Array(total);
  downslope.fill(UNVISITED);
  const order = new Int32Array(total);
  let orderLength = 0;
  const heap = new MinHeap();
  for (let i = 0; i < total; i += 1) {
    if (oceanMask[i] > 0) {
      downslope[i] = -1;
      heap.push(i, elevations[i] ?? 0);
    }
  }
  while (heap.size > 0 && orderLength < total) {
    const idx = heap.pop();
    if (idx < 0) {
      break;
    }
    order[orderLength] = idx;
    orderLength += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (let i = 0; i < DRAINAGE_OFFSETS.length; i += 1) {
      const offset = DRAINAGE_OFFSETS[i]!;
      const nx = x + offset.dx;
      const ny = y + offset.dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = ny * cols + nx;
      if (downslope[nIdx] !== UNVISITED) {
        continue;
      }
      downslope[nIdx] = idx;
      heap.push(nIdx, (elevations[nIdx] ?? 0) + (Math.abs(offset.dx) + Math.abs(offset.dy) > 1 ? 0.0006 : 0));
    }
  }

  const riverIntensity = clamp01(settings.riverIntensity);
  for (let y = 0; y < rows; y += 1) {
    const ny = rows <= 1 ? 0 : y / (rows - 1);
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const elevation = elevations[idx] ?? 0;
      const seaLevel = seaLevelMap[idx] ?? SEA_LEVEL;
      if (oceanMask[idx] > 0 || elevation <= seaLevel + 0.006) {
        continue;
      }
      const nx = cols <= 1 ? 0 : x / (cols - 1);
      const rain = fbmNoise(nx * 5.5, ny * 5.5, seed + 3511, 2);
      const coastMoisture = 1 - clamp((distToOcean[idx] ?? 0) / Math.max(6, Math.min(cols, rows) * 0.18), 0, 1);
      const heightDrying = smoothstep(seaLevel + 0.04, 0.95, elevation) * 0.28;
      flowMap[idx] = mix(0.02, 0.13, riverIntensity) * Math.pow(clamp01(0.22 + rain * 0.55 + coastMoisture * 0.22 - heightDrying), 2);
    }
  }

  for (let i = orderLength - 1; i >= 0; i -= 1) {
    const idx = order[i] ?? -1;
    if (idx < 0) {
      continue;
    }
    const down = downslope[idx] ?? -1;
    if (down >= 0) {
      flowMap[down] += flowMap[idx] ?? 0;
    }
  }

  const threshold = mix(0.036, 0.02, riverIntensity) * mix(1.12, 0.72, settings.riverBudget);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const down = downslope[idx] ?? -1;
      const elevation = elevations[idx] ?? 0;
      const seaLevel = seaLevelMap[idx] ?? SEA_LEVEL;
      if (down >= 0) {
        const dx = (down % cols) - x;
        const dy = Math.floor(down / cols) - y;
        const len = Math.hypot(dx, dy) || 1;
        erosionFlowXMap[idx] = dx / len;
        erosionFlowYMap[idx] = dy / len;
      }
      const slope = down >= 0 ? Math.max(0, elevation - (elevations[down] ?? elevation)) : 0;
      const flow = flowMap[idx] ?? 0;
      erosionWearMap[idx] = clamp01(valleyMask[idx] * 0.72 + smoothstep(0.012, 0.12, flow) * 0.42 + smoothstep(0.002, 0.04, slope) * 0.24);
      erosionDepositMap[idx] = clamp01((1 - smoothstep(0.002, 0.024, slope)) * smoothstep(0.02, 0.16, flow) * 0.45);
      erosionHardnessMap[idx] = clamp01(0.42 + ridgeMask[idx] * 0.42 + ridgedFbmNoise(x * 0.04, y * 0.04, seed + 8011, 1) * 0.16);
      if (oceanMask[idx] === 0 && flow >= threshold && elevation > seaLevel + 0.018) {
        riverMask[idx] = 1;
      }
    }
  }
  return { riverMask, flowMap, erosionWearMap, erosionDepositMap, erosionHardnessMap, erosionFlowXMap, erosionFlowYMap };
};

type DrainageFields = ReturnType<typeof buildDrainage>;

const buildEmptyDrainage = (total: number): DrainageFields => ({
  riverMask: new Uint8Array(total),
  flowMap: new Float32Array(total),
  erosionWearMap: new Float32Array(total),
  erosionDepositMap: new Float32Array(total),
  erosionHardnessMap: new Float32Array(total),
  erosionFlowXMap: new Float32Array(total),
  erosionFlowYMap: new Float32Array(total)
});

export function buildNoiseLandmassCore(input: NoiseLandmassCoreInput): NoiseLandmassResult {
  const { seed, cols, rows, settings } = input;
  const previewMode = input.previewMode ?? "relief";
  const includeDrainage = input.includeRivers !== false;
  const includeOcean = previewMode === "water";
  const includeDetailRelief = previewMode !== "shape";
  const total = cols * rows;
  const archetypeSeed = seed + ARCHETYPE_SEED_OFFSETS[settings.terrainArchetype];
  const rawNoiseMap = new Float32Array(total);
  const redistributedHeightMap = new Float32Array(total);
  const edgeDistanceMap = new Float32Array(total);
  const islandMask = new Float32Array(total);
  const ridgeMask = new Float32Array(total);
  const valleyMask = new Float32Array(total);
  const elevationFloatMap = new Float32Array(total);

  const angle = hash2D(17, 5, archetypeSeed + 911) * TAU;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const relief = clamp01(settings.relief);
  const ruggedness = clamp01(settings.ruggedness);
  const anisotropy = clamp01(settings.anisotropy);
  const embayment = clamp01(settings.embayment);
  const compactness = clamp01(settings.islandCompactness);
  const landCoverageTarget = clamp(settings.landCoverageTarget, 0.32, 0.82);
  const landTargetOffset = (landCoverageTarget - 0.62) / 0.5;
  const interiorRise = clamp01(settings.interiorRise);
  const asymmetry = clamp01(settings.asymmetry);
  const ridgeFrequency = clamp01(settings.ridgeFrequency);
  const basinStrength = clamp01(settings.basinStrength);
  const longSpine = settings.terrainArchetype === "LONG_SPINE";
  const twinBay = settings.terrainArchetype === "TWIN_BAY";
  const shelf = settings.terrainArchetype === "SHELF";
  const massif = settings.terrainArchetype === "MASSIF";
  const driftX = (hash2D(23, 29, archetypeSeed) - 0.5) * mix(0.03, 0.22, asymmetry);
  const driftY = (hash2D(31, 37, archetypeSeed) - 0.5) * mix(0.03, 0.22, asymmetry);
  const ridgeAngle = angle + (settings.ridgeAlignment - 0.5) * Math.PI * 0.72;
  const ridgeCos = Math.cos(ridgeAngle);
  const ridgeSin = Math.sin(ridgeAngle);

  for (let y = 0; y < rows; y += 1) {
    const ny = rows <= 1 ? 0 : y / (rows - 1);
    const py = ny * 2 - 1;
    for (let x = 0; x < cols; x += 1) {
      const nx = cols <= 1 ? 0 : x / (cols - 1);
      const px = nx * 2 - 1;
      const warpX = (fbmNoise(nx * 2.1 + 17, ny * 2.1 - 9, archetypeSeed + 1001, 2) * 2 - 1) * mix(0.02, 0.16, settings.coastComplexity);
      const warpY = (fbmNoise(nx * 2 - 13, ny * 2 + 5, archetypeSeed + 1103, 2) * 2 - 1) * mix(0.02, 0.16, settings.coastComplexity);
      const wx = px + warpX + driftX;
      const wy = py + warpY + driftY;
      const along = wx * cos + wy * sin;
      const across = -wx * sin + wy * cos;
      const radialX = longSpine ? mix(0.55, 0.34, anisotropy) : mix(1.02, 0.82, anisotropy);
      const radialY = longSpine ? mix(1.3, 1.74, anisotropy) : mix(1, 0.9, anisotropy);
      const radial = Math.hypot(along * radialX, across * radialY);
      const targetRadius = mix(0.94, 1.18, landCoverageTarget);
      let island = Math.pow(
        clamp01(1 - radial / (mix(1.24, 0.98, compactness) * targetRadius)),
        mix(0.92, 1.72, compactness)
      );
      if (longSpine) {
        island = Math.max(island, lineRidge(along, across, mix(0.42, 0.25, anisotropy), 1.04, Math.sin(along * 4.4 + hash2D(1, 2, archetypeSeed) * TAU) * 0.08));
      } else if (twinBay) {
        island += gaussian(along, across, -0.46, -0.12, 0.46, 0.42) * 0.34 + gaussian(along, across, 0.44, 0.12, 0.48, 0.4) * 0.36;
      } else if (massif) {
        island += gaussian(along, across, 0.02, -0.02, 0.62, 0.58) * mix(0.22, 0.46, interiorRise);
      } else if (shelf) {
        island += gaussian(along, across, -0.42, 0.22, 0.5, 0.32) * 0.18;
      }
      const bayA = lineRidge(along - mix(-0.42, -0.18, embayment), across - 0.72, mix(0.24, 0.42, embayment), 0.78, 0);
      const bayB = lineRidge(along - mix(0.26, 0.46, embayment), across + 0.72, mix(0.24, 0.42, embayment), 0.78, 0);
      const strait = twinBay ? lineRidge(along, across, mix(0.16, 0.28, embayment), 0.88, Math.sin(along * 3.2 + hash2D(8, 8, archetypeSeed) * TAU) * 0.08) : 0;
      const coastBand = smoothstep(0.18, 0.72, island) * (1 - smoothstep(0.72, 1.12, island));
      const headlandNoise = fbmNoise(nx * 3.4 + 11, ny * 3.4 - 17, archetypeSeed + 1409, 3) * 2 - 1;
      const edge = edgeDistance01(x, y, cols, rows);
      const radialEnvelope = clamp01(1 - Math.hypot(px, py) / mix(1.02, 1.36, landCoverageTarget));
      const edgeEnvelope = smoothstep(0.02, mix(0.54, 0.82, landCoverageTarget), edge);
      const islandEnvelope = Math.pow(
        mix(edgeEnvelope, radialEnvelope, mix(0.25, 0.48, compactness)),
        mix(0.82, 1.42, compactness)
      );
      const baseMask =
        island * mix(1.22, 1.56, relief)
        + (islandEnvelope - 0.5) * mix(0.28, 0.46, compactness)
        + landTargetOffset * 0.2
        + headlandNoise * mix(0.08, 0.26, settings.coastComplexity) * coastBand
        - (bayA + bayB) * mix(0.18, 0.52, embayment)
        - strait * mix(0.2, 0.58, embayment)
        - 0.46;

      const landWeight = smoothstep(-0.035, 0.16, baseMask);
      let ridge = 0;
      let valley = 0;
      let raw = clamp01(
        0.5
        + baseMask * mix(0.28, 0.42, relief)
        + landWeight * mix(0.025, 0.08, interiorRise)
      );
      if (includeDetailRelief) {
        const ridgeAlong = wx * ridgeCos + wy * ridgeSin;
        const ridgeAcross = -wx * ridgeSin + wy * ridgeCos;
        const ridgeCurve = Math.sin(ridgeAlong * TAU * mix(0.34, 0.78, ridgeFrequency) + hash2D(2, 2, archetypeSeed) * TAU) * mix(0.03, 0.16, ruggedness);
        ridge = clamp01(lineRidge(ridgeAlong, ridgeAcross, longSpine ? mix(0.11, 0.065, anisotropy) : mix(0.16, 0.08, ruggedness), longSpine ? 0.95 : 0.72, ridgeCurve));
        valley = clamp01(
          lineRidge(ridgeAlong, ridgeAcross, mix(0.09, 0.18, basinStrength), 1, (longSpine ? 0.22 : 0))
          + lineRidge(ridgeAlong, ridgeAcross, mix(0.08, 0.16, basinStrength), 0.92, -(longSpine ? 0.22 : 0.32))
          + (bayA + bayB + strait) * mix(0.2, 0.7, embayment)
        );
        const detail = fbmNoise(nx * 12.5, ny * 12.5, archetypeSeed + 2203, 3) * 2 - 1;
        const ridged = ridgedFbmNoise(nx * mix(6, 17, ridgeFrequency), ny * mix(6, 17, ridgeFrequency), archetypeSeed + 2711, 3);
        raw = clamp01(
          raw
          + detail * mix(0.014, 0.06, ruggedness) * landWeight
          + ridge * ridged * mix(0.06, 0.34, settings.maxHeight)
          - valley * mix(0.025, 0.17, settings.riverIntensity * 0.6 + basinStrength * 0.4)
        );
      }
      const edgeLift = Math.pow(edge, mix(0.78, 1.45, settings.coastalShelfWidth));
      const redistributed = Math.pow(raw, mix(1.35, 0.74, relief));
      const shapeHeight = clamp01(
        0.5
        + baseMask * mix(0.24, 0.36, relief)
        + smoothstep(0.08, 0.92, edge) * mix(0.015, 0.08, interiorRise)
      );
      const reliefHeight = clamp01(
        redistributed * mix(0.76, 1.08, edgeLift)
        + smoothstep(0.08, 0.92, edge) * mix(0.02, 0.12, interiorRise)
      );
      const finalHeight = includeDetailRelief ? reliefHeight : shapeHeight;
      const idx = y * cols + x;
      rawNoiseMap[idx] = raw;
      redistributedHeightMap[idx] = redistributed;
      edgeDistanceMap[idx] = edge;
      islandMask[idx] = clamp01(baseMask * 0.5 + 0.5);
      ridgeMask[idx] = ridge;
      valleyMask[idx] = valley * landWeight;
      elevationFloatMap[idx] = finalHeight;
    }
  }

  const { seaLevelBase, seaLevelMap, oceanMask: resolvedOceanMask } =
    resolveCalibratedSeaLevel(elevationFloatMap, cols, rows, settings);
  const oceanMask = includeOcean ? resolvedOceanMask : new Uint8Array(total);
  const drainageDistance = buildDistanceFromMask(resolvedOceanMask, cols, rows);
  const drainage = includeDrainage
    ? buildDrainage(seed, cols, rows, settings, elevationFloatMap, resolvedOceanMask, seaLevelMap, ridgeMask, valleyMask, drainageDistance)
    : buildEmptyDrainage(total);
  const visibleRiverMask = new Uint8Array(total);
  const coast = buildTileTypesAndCoast(elevationFloatMap, oceanMask, visibleRiverMask, seaLevelMap, cols, rows, false);

  return {
    elevationMap: Array.from(elevationFloatMap),
    elevationFloatMap,
    riverMask: visibleRiverMask,
    seaLevelBase,
    seaLevelMap,
    oceanMask,
    tileTypes: coast.tileTypes,
    coastDistance: coast.coastDistance,
    coastClass: coast.coastClass,
    erosionWearMap: drainage.erosionWearMap,
    erosionDepositMap: drainage.erosionDepositMap,
    erosionHardnessMap: drainage.erosionHardnessMap,
    erosionFlowXMap: drainage.erosionFlowXMap,
    erosionFlowYMap: drainage.erosionFlowYMap,
    tectonicStressMap: ridgeMask,
    tectonicTrendXMap: drainage.erosionFlowXMap,
    tectonicTrendYMap: drainage.erosionFlowYMap,
    rawNoiseMap,
    redistributedHeightMap,
    edgeDistanceMap,
    islandMask,
    ridgeMask,
    valleyMask,
    flowMap: drainage.flowMap
  };
}

export async function buildNoiseLandmass(input: NoiseLandmassInput): Promise<NoiseLandmassResult> {
  await input.report?.("Building noise landmass...", 0.05);
  const result = buildNoiseLandmassCore(input);
  await input.yieldIfNeeded?.();
  await emitPhase(
    input,
    "terrain:relief",
    result.redistributedHeightMap,
    result.tileTypes,
    result.riverMask,
    result.oceanMask,
    result.seaLevelMap,
    result.coastDistance,
    result.coastClass
  );
  await emitPhase(
    input,
    "terrain:carving",
    result.elevationFloatMap,
    result.tileTypes,
    result.riverMask,
    result.oceanMask,
    result.seaLevelMap,
    result.coastDistance,
    result.coastClass
  );
  await emitPhase(
    input,
    "terrain:flooding",
    result.elevationFloatMap,
    result.tileTypes,
    result.riverMask,
    result.oceanMask,
    result.seaLevelMap,
    result.coastDistance,
    result.coastClass
  );
  await emitPhase(
    input,
    "terrain:elevation",
    result.elevationFloatMap,
    result.tileTypes,
    result.riverMask,
    result.oceanMask,
    result.seaLevelMap,
    result.coastDistance,
    result.coastClass
  );
  await input.report?.("Noise landmass ready.", 1);
  return result;
}
