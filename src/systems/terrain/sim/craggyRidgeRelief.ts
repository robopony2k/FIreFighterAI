import { hash2D } from "../../../mapgen/noise.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";

const MAX_FORMATIONS = 3;
const CANDIDATE_CAPACITY = 32;
const ELEVATION_HISTOGRAM_BINS = 64;
const MIN_INTERIOR_MASK = 0.34;
const MIN_RIDGE_STRENGTH = 0.42;
const MIN_FEATURE_WIDTH_TILES = 8;
const MAX_FEATURE_WIDTH_TILES = 14;
const MIN_FEATURE_LENGTH_TILES = 20;
const MAX_FEATURE_LENGTH_TILES = 48;
const MIN_UPLIFT = 0.012;
const MAX_UPLIFT = 0.035;
const HARD_UPLIFT_CAP = 0.04;

export type CraggyRidgeReliefInput = {
  seed: number;
  cols: number;
  rows: number;
  settings: Pick<MapGenSettings, "terrainArchetype" | "relief" | "ruggedness" | "maxHeight">;
  elevations: Float32Array;
  ridgeMask: Float32Array;
  interiorMask: Float32Array;
};

export type CraggyRidgeReliefResult = {
  formationCount: number;
  affectedTileCount: number;
  maxUplift: number;
  upliftMap: Float32Array;
};

type Formation = {
  anchorX: number;
  anchorY: number;
  tangentX: number;
  tangentY: number;
  length: number;
  width: number;
  amplitude: number;
  lobeCount: number;
  steepSide: number;
  seed: number;
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

const isEnabledArchetype = (archetype: MapGenSettings["terrainArchetype"]): boolean =>
  archetype === "MASSIF" || archetype === "LONG_SPINE";

const resolveHighlandThreshold = (input: CraggyRidgeReliefInput): number | null => {
  const { cols, rows, elevations, interiorMask } = input;
  const bins = new Uint32Array(ELEVATION_HISTOGRAM_BINS);
  const edgeMargin = Math.max(8, Math.floor(Math.min(cols, rows) * 0.055));
  let count = 0;
  for (let y = edgeMargin; y < rows - edgeMargin; y += 1) {
    const row = y * cols;
    for (let x = edgeMargin; x < cols - edgeMargin; x += 1) {
      const idx = row + x;
      if ((interiorMask[idx] ?? 0) < MIN_INTERIOR_MASK) {
        continue;
      }
      const height = clamp01(elevations[idx] ?? 0);
      const bin = Math.min(ELEVATION_HISTOGRAM_BINS - 1, Math.floor(height * ELEVATION_HISTOGRAM_BINS));
      bins[bin] += 1;
      count += 1;
    }
  }
  if (count === 0) {
    return null;
  }
  const target = Math.max(1, Math.ceil(count * 0.75));
  let cumulative = 0;
  for (let bin = 0; bin < bins.length; bin += 1) {
    cumulative += bins[bin] ?? 0;
    if (cumulative >= target) {
      return bin / ELEVATION_HISTOGRAM_BINS;
    }
  }
  return 0.75;
};

const resolveRidgeTangent = (
  ridgeMask: Float32Array,
  cols: number,
  rows: number,
  anchorX: number,
  anchorY: number,
  seed: number
): { x: number; y: number } => {
  const radius = 5;
  const center = ridgeMask[anchorY * cols + anchorX] ?? 0;
  let covarianceXX = 0;
  let covarianceXY = 0;
  let covarianceYY = 0;
  let weightSum = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    const y = anchorY + dy;
    if (y < 0 || y >= rows) {
      continue;
    }
    for (let dx = -radius; dx <= radius; dx += 1) {
      const x = anchorX + dx;
      if (x < 0 || x >= cols || (dx === 0 && dy === 0)) {
        continue;
      }
      const ridge = ridgeMask[y * cols + x] ?? 0;
      const distanceWeight = 1 - clamp01(Math.hypot(dx, dy) / (radius + 1));
      const weight = Math.max(0, ridge - Math.max(MIN_RIDGE_STRENGTH * 0.72, center * 0.42)) * distanceWeight;
      covarianceXX += dx * dx * weight;
      covarianceXY += dx * dy * weight;
      covarianceYY += dy * dy * weight;
      weightSum += weight;
    }
  }
  if (weightSum > 1e-5 && Math.abs(covarianceXX - covarianceYY) + Math.abs(covarianceXY) > 1e-5) {
    const angle = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }
  const fallbackAngle = hash2D(anchorX, anchorY, seed + 701) * Math.PI * 2;
  return { x: Math.cos(fallbackAngle), y: Math.sin(fallbackAngle) };
};

const insertCandidate = (
  score: number,
  x: number,
  y: number,
  scores: Float32Array,
  xs: Int32Array,
  ys: Int32Array,
  candidateCount: number
): number => {
  if (
    candidateCount >= CANDIDATE_CAPACITY &&
    score <= (scores[CANDIDATE_CAPACITY - 1] ?? Number.NEGATIVE_INFINITY)
  ) {
    return candidateCount;
  }
  const count = Math.min(CANDIDATE_CAPACITY, candidateCount + 1);
  let insertAt = Math.min(candidateCount, CANDIDATE_CAPACITY - 1);
  while (insertAt > 0 && score > (scores[insertAt - 1] ?? Number.NEGATIVE_INFINITY)) {
    if (insertAt < CANDIDATE_CAPACITY) {
      scores[insertAt] = scores[insertAt - 1] ?? Number.NEGATIVE_INFINITY;
      xs[insertAt] = xs[insertAt - 1] ?? 0;
      ys[insertAt] = ys[insertAt - 1] ?? 0;
    }
    insertAt -= 1;
  }
  if (insertAt < CANDIDATE_CAPACITY) {
    scores[insertAt] = score;
    xs[insertAt] = x;
    ys[insertAt] = y;
  }
  return count;
};

const buildFormationPlan = (
  input: CraggyRidgeReliefInput,
  highlandThreshold: number
): Formation[] => {
  const { seed, cols, rows, settings, elevations, ridgeMask, interiorMask } = input;
  const candidateScores = new Float32Array(CANDIDATE_CAPACITY);
  candidateScores.fill(Number.NEGATIVE_INFINITY);
  const candidateXs = new Int32Array(CANDIDATE_CAPACITY);
  const candidateYs = new Int32Array(CANDIDATE_CAPACITY);
  const minDim = Math.min(cols, rows);
  const edgeMargin = Math.max(10, Math.ceil(Math.min(MAX_FEATURE_LENGTH_TILES * 0.5 + 3, minDim * 0.2)));
  let candidateCount = 0;

  for (let y = edgeMargin; y < rows - edgeMargin; y += 1) {
    const row = y * cols;
    for (let x = edgeMargin; x < cols - edgeMargin; x += 1) {
      const idx = row + x;
      const ridge = ridgeMask[idx] ?? 0;
      const height = elevations[idx] ?? 0;
      const interior = interiorMask[idx] ?? 0;
      if (ridge < MIN_RIDGE_STRENGTH || height < highlandThreshold || interior < MIN_INTERIOR_MASK) {
        continue;
      }
      const left = elevations[idx - 1] ?? height;
      const right = elevations[idx + 1] ?? height;
      const up = elevations[idx - cols] ?? height;
      const down = elevations[idx + cols] ?? height;
      const convexity = clamp01((height - (left + right + up + down) * 0.25) * 18 + 0.5);
      const heightScore = smoothstep(highlandThreshold, Math.min(1, highlandThreshold + 0.18), height);
      const seedTieBreak = hash2D(x, y, seed + 4099) * 0.035;
      const score = ridge * 0.5 + heightScore * 0.28 + convexity * 0.14 + interior * 0.08 + seedTieBreak;
      candidateCount = insertCandidate(
        score,
        x,
        y,
        candidateScores,
        candidateXs,
        candidateYs,
        candidateCount
      );
    }
  }

  const requestedCount = 1 + Math.floor(hash2D(19, 23, seed + 6011) * MAX_FORMATIONS);
  const minimumSeparation = clamp(minDim * 0.12, 20, 42);
  const formations: Formation[] = [];
  const intensity = clamp01(settings.ruggedness * 0.5 + settings.relief * 0.3 + settings.maxHeight * 0.2);
  for (let candidate = 0; candidate < candidateCount && formations.length < requestedCount; candidate += 1) {
    const anchorX = candidateXs[candidate] ?? 0;
    const anchorY = candidateYs[candidate] ?? 0;
    if (formations.some((formation) => Math.hypot(anchorX - formation.anchorX, anchorY - formation.anchorY) < minimumSeparation)) {
      continue;
    }
    const formationSeed = seed + 7919 + formations.length * 1543 + anchorX * 17 + anchorY * 31;
    const tangent = resolveRidgeTangent(ridgeMask, cols, rows, anchorX, anchorY, formationSeed);
    const length = clamp(
      minDim * mix(0.1, 0.18, hash2D(anchorX, anchorY, formationSeed + 11)),
      MIN_FEATURE_LENGTH_TILES,
      MAX_FEATURE_LENGTH_TILES
    );
    const width = clamp(
      length * mix(0.31, 0.39, hash2D(anchorX, anchorY, formationSeed + 17)),
      MIN_FEATURE_WIDTH_TILES,
      MAX_FEATURE_WIDTH_TILES
    );
    const amplitude = clamp(
      mix(MIN_UPLIFT, MAX_UPLIFT, intensity) * mix(0.84, 1.08, hash2D(anchorX, anchorY, formationSeed + 29)),
      MIN_UPLIFT,
      HARD_UPLIFT_CAP
    );
    formations.push({
      anchorX,
      anchorY,
      tangentX: tangent.x,
      tangentY: tangent.y,
      length,
      width,
      amplitude,
      lobeCount: 3 + Math.floor(hash2D(anchorX, anchorY, formationSeed + 37) * 3),
      steepSide: hash2D(anchorX, anchorY, formationSeed + 41) < 0.5 ? -1 : 1,
      seed: formationSeed
    });
  }
  return formations;
};

const samplePeakLobes = (formation: Formation, along: number): number => {
  const halfLength = formation.length * 0.5;
  const spacing = formation.length * 0.8 / Math.max(1, formation.lobeCount - 1);
  let strongest = 0;
  for (let lobe = 0; lobe < formation.lobeCount; lobe += 1) {
    const centeredIndex = lobe - (formation.lobeCount - 1) * 0.5;
    const jitter = (hash2D(lobe, 53, formation.seed + 101) - 0.5) * spacing * 0.42;
    const center = centeredIndex * spacing + jitter;
    const missing = hash2D(lobe, 59, formation.seed + 211) < 0.2;
    const strength = missing
      ? mix(0.12, 0.3, hash2D(lobe, 61, formation.seed + 223))
      : mix(0.64, 1, hash2D(lobe, 67, formation.seed + 227));
    const radius = spacing * mix(0.5, 0.78, hash2D(lobe, 71, formation.seed + 229));
    const distance = (along - center) / Math.max(1, radius);
    strongest = Math.max(strongest, Math.exp(-distance * distance * 1.7) * strength);
  }
  const endFade = 1 - smoothstep(halfLength * 0.88, halfLength, Math.abs(along));
  return endFade * (0.38 + strongest * 0.62);
};

const rasterizeFormation = (
  formation: Formation,
  input: CraggyRidgeReliefInput,
  upliftMap: Float32Array
): { affectedTileCount: number; maxUplift: number } => {
  const { cols, rows, elevations, ridgeMask } = input;
  const halfLength = formation.length * 0.5;
  const halfWidth = formation.width * 0.5;
  const normalX = -formation.tangentY;
  const normalY = formation.tangentX;
  const radius = Math.ceil(Math.hypot(halfLength, halfWidth * 1.3) + 2);
  const minX = Math.max(0, Math.floor(formation.anchorX - radius));
  const maxX = Math.min(cols - 1, Math.ceil(formation.anchorX + radius));
  const minY = Math.max(0, Math.floor(formation.anchorY - radius));
  const maxY = Math.min(rows - 1, Math.ceil(formation.anchorY + radius));
  let affectedTileCount = 0;
  let maxUplift = 0;
  for (let y = minY; y <= maxY; y += 1) {
    const row = y * cols;
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - formation.anchorX;
      const dy = y - formation.anchorY;
      const along = dx * formation.tangentX + dy * formation.tangentY;
      if (Math.abs(along) >= halfLength) {
        continue;
      }
      const across = dx * normalX + dy * normalY;
      const onSteepSide = Math.sign(across || formation.steepSide) === formation.steepSide;
      const sideWidth = halfWidth * (onSteepSide ? 0.72 : 1.24);
      const across01 = Math.abs(across) / Math.max(1, sideWidth);
      if (across01 >= 1) {
        continue;
      }
      const crossProfile = Math.pow(1 - smoothstep(0.18, 1, across01), onSteepSide ? 1.15 : 1.65);
      const peakProfile = samplePeakLobes(formation, along);
      const support = clamp01(crossProfile * peakProfile);
      const uplift = Math.min(HARD_UPLIFT_CAP, formation.amplitude * support);
      if (uplift <= 1e-5) {
        continue;
      }
      const idx = row + x;
      const priorUplift = upliftMap[idx] ?? 0;
      if (uplift > priorUplift) {
        elevations[idx] = clamp01((elevations[idx] ?? 0) + uplift - priorUplift);
        upliftMap[idx] = uplift;
      }
      ridgeMask[idx] = Math.max(ridgeMask[idx] ?? 0, support);
      if (priorUplift <= 1e-5) {
        affectedTileCount += 1;
      }
      maxUplift = Math.max(maxUplift, uplift);
    }
  }
  return { affectedTileCount, maxUplift };
};

export const applyCraggyRidgeRelief = (input: CraggyRidgeReliefInput): CraggyRidgeReliefResult => {
  const upliftMap = new Float32Array(input.cols * input.rows);
  if (!isEnabledArchetype(input.settings.terrainArchetype)) {
    return { formationCount: 0, affectedTileCount: 0, maxUplift: 0, upliftMap };
  }
  const highlandThreshold = resolveHighlandThreshold(input);
  if (highlandThreshold === null) {
    return { formationCount: 0, affectedTileCount: 0, maxUplift: 0, upliftMap };
  }
  const formations = buildFormationPlan(input, highlandThreshold);
  let affectedTileCount = 0;
  let maxUplift = 0;
  formations.forEach((formation) => {
    const result = rasterizeFormation(formation, input, upliftMap);
    affectedTileCount += result.affectedTileCount;
    maxUplift = Math.max(maxUplift, result.maxUplift);
  });
  return {
    formationCount: formations.length,
    affectedTileCount,
    maxUplift,
    upliftMap
  };
};
