import { COAST_CLASS_BEACH, COAST_CLASS_CLIFF, COAST_CLASS_NONE, COAST_CLASS_SHELF_WATER, TILE_TYPE_IDS } from "../../../core/state.js";
import { fbmNoise, gradientNoise, hash2D, ridgedFbmNoise } from "../../../mapgen/noise.js";
import type { MapGenDebug, MapGenReporter } from "../../../mapgen/mapgenTypes.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";
import {
  buildArchetypeUpliftPlan,
  sampleArchetypeUplift,
  shapeArchetypeUpliftSample
} from "./archetypeUpliftField.js";
import { shapeIslandBoundary } from "./islandBoundaryShaping.js";
import {
  TERRAIN_GENERATION_LIMITS
} from "../constants/terrainGenerationLimits.js";

export type NoiseLandmassCoreInput = {
  seed: number;
  cols: number;
  rows: number;
  settings: MapGenSettings;
  includeRivers?: boolean;
  previewMode?: "noise" | "uplift" | "shape" | "surface" | "water" | "production";
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
  archetypeUpliftMap: Float32Array;
  archetypeBasinMap: Float32Array;
  coastlineEnvelopeMap: Float32Array;
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
  SHELF: 43_021,
  NONE: 0
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

const octaveGradientNoise01 = (x: number, y: number, seed: number, octaves: number): number => {
  let amplitude = 1;
  let frequency = 1;
  let sum = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += gradientNoise(x * frequency, y * frequency, seed + octave * 197) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return weight > 0 ? sum / weight : 0.5;
};

const buildSeaLevelMap = (
  cols: number,
  rows: number,
  settings: MapGenSettings,
  seaLevelBase: number
): { seaLevelBase: number; seaLevelMap: Float32Array } => {
  const total = cols * rows;
  const seaLevelMap = new Float32Array(total);
  const seaLevel = clamp(seaLevelBase, SEA_LEVEL_MIN, SEA_LEVEL_MAX);
  for (let i = 0; i < total; i += 1) {
    seaLevelMap[i] = seaLevel;
  }
  void settings;
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
  const targetOceanRatio = 1 - clamp(
    settings.landCoverageTarget,
    TERRAIN_GENERATION_LIMITS.landCoverageTarget.min,
    TERRAIN_GENERATION_LIMITS.landCoverageTarget.max
  );
  let low = SEA_LEVEL_MIN;
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

  const seaLevelMap = buildSeaLevelMap(cols, rows, settings, bestBase).seaLevelMap;
  const oceanMask = buildOceanMask(elevations, seaLevelMap, cols, rows);
  return {
    seaLevelBase: bestBase,
    seaLevelMap,
    oceanMask
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

  const threshold = mix(0.036, 0.02, riverIntensity);
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
  const previewMode = input.previewMode ?? "production";
  const includeDrainage = input.includeRivers !== false;
  const includeOcean = previewMode === "water";
  const applyBoundaryShaping = previewMode === "surface"
    || previewMode === "water"
    || previewMode === "production";
  const upliftOnlyPreview = previewMode === "uplift";
  const includeSurfaceDetail = previewMode !== "shape" && !upliftOnlyPreview;
  const total = cols * rows;
  const archetypeSeed = seed + ARCHETYPE_SEED_OFFSETS[settings.terrainArchetype];
  const surfaceNoiseSeed = seed;
  const rawNoiseMap = new Float32Array(total);
  const redistributedHeightMap = new Float32Array(total);
  const edgeDistanceMap = new Float32Array(total);
  const islandMask = new Float32Array(total);
  const ridgeMask = new Float32Array(total);
  const valleyMask = new Float32Array(total);
  const archetypeUpliftMap = new Float32Array(total);
  const archetypeBasinMap = new Float32Array(total);
  const coastlineEnvelopeMap = new Float32Array(total);
  const elevationFloatMap = new Float32Array(total);

  const angle = hash2D(17, 5, archetypeSeed + 911) * TAU;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const relief = clamp01(settings.relief);
  const ruggedness = clamp01(settings.ruggedness);
  const anisotropy = clamp01(settings.anisotropy);
  const embayment = clamp01(settings.embayment);
  const maxHeightPressure =
    clamp(
      settings.maxHeight,
      TERRAIN_GENERATION_LIMITS.maxHeight.min,
      TERRAIN_GENERATION_LIMITS.maxHeight.max
    )
    / 1.5;
  const asymmetry = clamp01(settings.asymmetry);
  const uplandDistribution = clamp01(settings.uplandDistribution);
  const ridgeFrequency = clamp01(settings.ridgeFrequency);
  const basinStrength = clamp01(settings.basinStrength);
  const noiseFrequency = clamp01(settings.noiseFrequency);
  const longSpine = settings.terrainArchetype === "LONG_SPINE";
  const twinBay = settings.terrainArchetype === "TWIN_BAY";
  const shelf = settings.terrainArchetype === "SHELF";
  const massif = settings.terrainArchetype === "MASSIF";
  const driftX = (hash2D(23, 29, archetypeSeed) - 0.5) * mix(0.03, 0.22, asymmetry);
  const driftY = (hash2D(31, 37, archetypeSeed) - 0.5) * mix(0.03, 0.22, asymmetry);
  const upliftPlan = buildArchetypeUpliftPlan(seed, settings);

  for (let y = 0; y < rows; y += 1) {
    const ny = rows <= 1 ? 0 : y / (rows - 1);
    const py = ny * 2 - 1;
    for (let x = 0; x < cols; x += 1) {
      const nx = cols <= 1 ? 0 : x / (cols - 1);
      const px = nx * 2 - 1;
      const archetypeUplift = shapeArchetypeUpliftSample(
        sampleArchetypeUplift(upliftPlan, nx, ny),
        settings
      );
      const warpX = (fbmNoise(nx * 2.1 + 17, ny * 2.1 - 9, surfaceNoiseSeed + 1001, 2) * 2 - 1) * mix(0.02, 0.16, settings.coastComplexity);
      const warpY = (fbmNoise(nx * 2 - 13, ny * 2 + 5, surfaceNoiseSeed + 1103, 2) * 2 - 1) * mix(0.02, 0.16, settings.coastComplexity);
      const wx = px + warpX + driftX;
      const wy = py + warpY + driftY;
      const along = wx * cos + wy * sin;
      const across = -wx * sin + wy * cos;
      const radialX = longSpine ? mix(0.55, 0.34, anisotropy) : mix(1.02, 0.82, anisotropy);
      const radialY = longSpine ? mix(1.3, 1.74, anisotropy) : mix(1, 0.9, anisotropy);
      const radial = Math.hypot(along * radialX, across * radialY);
      let island = Math.pow(
        clamp01(1 - radial / 1.08),
        1.2
      );
      let archetypeCoastIdentity = 0;
      if (longSpine) {
        const spineEnvelope = lineRidge(along, across, mix(0.42, 0.25, anisotropy), 1.04, Math.sin(along * 4.4 + hash2D(1, 2, archetypeSeed) * TAU) * 0.08);
        island = Math.max(island, spineEnvelope);
        archetypeCoastIdentity = spineEnvelope - smoothstep(1.08, 0.54, radial) * 0.42;
      } else if (twinBay) {
        const twinLobeA = gaussian(along, across, -0.46, -0.12, 0.46, 0.42);
        const twinLobeB = gaussian(along, across, 0.44, 0.12, 0.48, 0.4);
        island += twinLobeA * 0.42 + twinLobeB * 0.44;
        archetypeCoastIdentity = twinLobeA - twinLobeB;
      } else if (massif) {
        const massifAngle = Math.atan2(across, along);
        const massifLobes = Math.cos(massifAngle * 3 + upliftPlan.curvePhase)
          * smoothstep(0.14, 0.5, radial)
          * smoothstep(1.02, 0.54, radial);
        island += gaussian(along, across, 0, 0, 0.72, 0.66) * mix(0.12, 0.24, relief)
          + massifLobes * 0.46;
        archetypeCoastIdentity = massifLobes;
      } else if (shelf) {
        const shelfBand = smoothstep(0.12, 0.48, radial) * smoothstep(1.08, 0.58, radial);
        island += gaussian(along, across, -0.42, 0.22, 0.5, 0.32) * 0.36
          - along * shelfBand * 0.28;
        archetypeCoastIdentity = -along * shelfBand;
      }
      const bayA = lineRidge(along - mix(-0.42, -0.18, embayment), across - 0.72, mix(0.24, 0.42, embayment), 0.78, 0);
      const bayB = lineRidge(along - mix(0.26, 0.46, embayment), across + 0.72, mix(0.24, 0.42, embayment), 0.78, 0);
      const strait = twinBay ? lineRidge(along, across, mix(0.16, 0.28, embayment), 0.88, Math.sin(along * 3.2 + hash2D(8, 8, archetypeSeed) * TAU) * 0.08) : 0;
      const coastBand = smoothstep(0.18, 0.72, island) * (1 - smoothstep(0.72, 1.12, island));
      const headlandNoise = fbmNoise(nx * 3.4 + 11, ny * 3.4 - 17, surfaceNoiseSeed + 1409, 3) * 2 - 1;
      // Red Blob's square-bump distance reaches every rectangular border without
      // turning the interior heightfield into either a radial dome or a pyramid.
      const distance01 = 1 - (1 - px * px) * (1 - py * py);
      const structureInteriorFade = applyBoundaryShaping
        ? 1 - smoothstep(0.78, 0.985, distance01)
        : 1;
      const islandShape = applyBoundaryShaping ? 1 - distance01 : 1;
      const contourNoise = (
        fbmNoise(nx * 2.15 - 19, ny * 2.15 + 23, surfaceNoiseSeed + 1501, 3) * 0.72
        + gradientNoise(nx * 4.6 + 31, ny * 4.6 - 7, surfaceNoiseSeed + 1511) * 0.28
      ) * 2 - 1;
      const terrainScale = mix(0.42, 1.72, noiseFrequency) * mix(0.92, 1.12, ruggedness);
      const terrainOctaves = includeSurfaceDetail ? 4 : 3;
      const octaveTerrain =
        octaveGradientNoise01(nx * terrainScale + 13.7, ny * terrainScale - 9.2, surfaceNoiseSeed + 1601, terrainOctaves) * 2 - 1;
      const fineScale = terrainScale * mix(3.2, 4.8, ruggedness);
      const octaveFine = includeSurfaceDetail
        ? octaveGradientNoise01(nx * fineScale - 21.4, ny * fineScale + 6.8, surfaceNoiseSeed + 1801, 3) * 2 - 1
        : 0;
      const baseMask =
        (island - 0.5) * mix(0.14, 0.24, relief)
        + archetypeCoastIdentity * 0.52
        + headlandNoise * mix(0.04, 0.12, settings.coastComplexity) * (0.35 + coastBand * 0.65)
        - (bayA + bayB) * mix(0.025, 0.07, embayment)
        - strait * mix(0.03, 0.08, embayment);
      const coastlineBias = applyBoundaryShaping
        ? Math.tanh(baseMask / 0.1) * 0.1
        : 0;

      const landWeight = 1;
      const archetypeUpliftRise =
        archetypeUplift.uplift
        * structureInteriorFade
        * mix(0.02, 0.075, clamp01(relief * 0.58 + uplandDistribution * 0.22 + maxHeightPressure * 0.2));
      const archetypeBasinDrop =
        archetypeUplift.basinPreference
        * structureInteriorFade
        * mix(0.008, 0.045, clamp01(basinStrength * 0.66 + settings.riverIntensity * 0.18 + relief * 0.16));
      const broadSurfaceNoise = octaveTerrain
        * mix(0.07, 0.16, relief)
        * mix(0.72, 1, ruggedness);
      let ridge = 0;
      let valley = 0;
      let raw = clamp01(
        0.5
        + broadSurfaceNoise
        + coastlineBias
        + archetypeUpliftRise
        - archetypeBasinDrop
      );
      let fineDetail = includeSurfaceDetail
        ? octaveFine * mix(0.015, 0.055, ruggedness)
        : 0;
      if (includeSurfaceDetail) {
        const ridged = ridgedFbmNoise(nx * mix(6, 17, ridgeFrequency), ny * mix(6, 17, ridgeFrequency), surfaceNoiseSeed + 2711, 3);
        const surfaceRidgeTexture = smoothstep(0.34, 0.88, ridged)
          * smoothstep(0.24, 0.78, raw)
          * mix(0.04, 0.15, ruggedness);
        ridge = clamp01(surfaceRidgeTexture + archetypeUplift.uplift * structureInteriorFade * 0.32);
        valley = clamp01(archetypeUplift.basinPreference * structureInteriorFade);
        const detail = fbmNoise(nx * 12.5, ny * 12.5, surfaceNoiseSeed + 2203, 3) * 2 - 1;
        fineDetail += detail * mix(0.02, 0.072, ruggedness) * landWeight;
      }
      const redistributed = Math.pow(raw, mix(1.35, 0.74, relief));
      const boundary = applyBoundaryShaping
        ? shapeIslandBoundary(redistributed, px, py, contourNoise, settings.coastComplexity)
        : null;
      const macroHeight = boundary?.macroHeight ?? redistributed;
      const finalHeight = clamp01(macroHeight + fineDetail * (boundary?.detailFade ?? 1));
      const idx = y * cols + x;
      rawNoiseMap[idx] = clamp01(0.5 + (octaveTerrain * 0.82 + octaveFine * 0.18) * 0.5);
      redistributedHeightMap[idx] = redistributed;
      edgeDistanceMap[idx] = islandShape;
      islandMask[idx] = islandShape;
      ridgeMask[idx] = ridge;
      valleyMask[idx] = clamp01(
        valley * landWeight
        + archetypeUplift.basinPreference * 0.5 * structureInteriorFade
      );
      archetypeUpliftMap[idx] = archetypeUplift.uplift * structureInteriorFade;
      archetypeBasinMap[idx] = archetypeUplift.basinPreference * structureInteriorFade;
      coastlineEnvelopeMap[idx] = clamp01(island);
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
    archetypeUpliftMap,
    archetypeBasinMap,
    coastlineEnvelopeMap,
    valleyMask,
    flowMap: drainage.flowMap
  };
}

export async function buildNoiseLandmass(input: NoiseLandmassInput): Promise<NoiseLandmassResult> {
  await input.report?.("Building noise landmass...", 0.05);
  const result = buildNoiseLandmassCore(input);
  await input.yieldIfNeeded?.();
  await input.report?.("Noise landmass ready.", 1);
  return result;
}
