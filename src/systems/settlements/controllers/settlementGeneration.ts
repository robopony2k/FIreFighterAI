import { inBounds, indexFor } from "../../../core/grid.js";
import type { WorldState } from "../../../core/state.js";
import type {
  Point,
  Town,
  TownGrowthFrontier,
  TownIndustryProfile,
  TownStreetArchetype
} from "../../../core/types.js";
import {
  BASE_PRE_GROWTH_YEARS,
  COASTAL_PROFILE_WATER_DISTANCE_MAX,
  COMPACT_TOWN_BLOCK_OFFSET,
  MAX_SETTLEMENT_PRE_GROWTH_YEARS,
  MIN_TOWN_RADIUS,
  RIBBON_TOWN_MIN_BUILD_SPAN,
  RIBBON_TOWN_RELIEF_MIN,
  RIBBON_TOWN_WATER_DISTANCE_MAX,
  TOWN_CORE_RADIUS,
  TOWN_INITIAL_BUILD_COOLDOWN_MAX_DAYS
} from "../constants/settlementConstants.js";
import { createPrecomputedSettlementGrowthPlan, simulateTownGrowthYears } from "../sim/townGrowth.js";
import {
  SETTLEMENT_PLOT_MAX_ANGLE_DEG,
  SETTLEMENT_TOWN_FALLBACK_ANGLE_DEG,
  computeSettlementTileAngleDeg,
  evaluateSettlementSiteFit,
  scoreSettlementAngle
} from "../sim/settlementTerrainFit.js";
import type { SettlementPlacementResult, SettlementRoadAdapter, SettlementRoadOptions } from "../types/settlementTypes.js";
import { hash2D } from "../../../mapgen/noise.js";

type TownSeedCandidate = Point & {
  score: number;
  localRelief: number;
  maxAngleDeg: number;
  meanAngleDeg: number;
  waterDistance: number;
  elevation: number;
  profile: TownIndustryProfile;
};

type LocalStreetBuildResult = {
  frontiers: TownGrowthFrontier[];
  streetArchetype: TownStreetArchetype;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const clampSettlementYears = (value: number | undefined): number => {
  if (!Number.isFinite(value)) {
    return BASE_PRE_GROWTH_YEARS;
  }
  return Math.max(0, Math.min(MAX_SETTLEMENT_PRE_GROWTH_YEARS, Math.round(value as number)));
};

const TOWN_NAME_POOL: readonly string[] = [
  "Ashbourne",
  "Ashford",
  "Ashbridge",
  "Ashmere",
  "Ashmoor",
  "Ashholt",
  "Ashhaven",
  "Ashwick",
  "Ashvale",
  "Ashgrove",
  "Cinderbrook",
  "Cinderford",
  "Cinderhollow",
  "Cindermere",
  "Emberleigh",
  "Emberford",
  "Emberfield",
  "Embervale",
  "Emberwick",
  "Emberton",
  "Burnside",
  "Burnham",
  "Burnhaven",
  "Burnholt",
  "Burnstead",
  "Burnwick",
  "Burnridge",
  "Burnmere",
  "Burnhollow",
  "Burncross",
  "Scorchfield",
  "Scorchford",
  "Scorchmere",
  "Scorchwell",
  "Charminster",
  "Charford",
  "Charbridge",
  "Charbury",
  "Charvale",
  "Charwood",
  "Smokebrook",
  "Smokeford",
  "Smokehaven",
  "Smokevale",
  "Sootbridge",
  "Sootmere",
  "Sooton",
  "Blackash",
  "Blackcinder",
  "Blackember",
  "Redhaven",
  "Redglen",
  "Redvale",
  "Brimstone Bay",
  "Brimstone Downs",
  "Firebreak Flats",
  "Firewatch Ridge",
  "Glowmere",
  "Hearthwick",
  "Pyrewick"
];

const createNameRng = (seed: number): (() => number) => {
  let state = (seed >>> 0) ^ 0xa511e9b3;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const shuffleTownNames = (seed: number): string[] => {
  const names = [...TOWN_NAME_POOL];
  const next = createNameRng(seed);
  for (let i = names.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(next() * (i + 1));
    const temp = names[i];
    names[i] = names[swapIndex]!;
    names[swapIndex] = temp!;
  }
  return names;
};

const isRoadLikeTile = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const type = state.tiles[idx]?.type;
  return type === "road" || type === "base" || (state.tileRoadBridge[idx] ?? 0) > 0;
};

const isBuildableType = (type: WorldState["tiles"][number]["type"]): boolean =>
  type === "grass" || type === "scrub" || type === "floodplain" || type === "forest" || type === "bare";

const isBuildable = (state: WorldState, x: number, y: number, heightScaleMultiplier = 1): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const tile = state.tiles[idx];
  if (!isBuildableType(tile.type) || state.structureMask[idx] > 0) {
    return false;
  }
  if (computeSettlementTileAngleDeg(state, x, y, { heightScaleMultiplier }) > SETTLEMENT_TOWN_FALLBACK_ANGLE_DEG) {
    return false;
  }
  const elevation = tile.elevation;
  let maxDiff = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
      if (!neighbor || neighbor.type === "water") {
        return false;
      }
      maxDiff = Math.max(maxDiff, Math.abs(elevation - neighbor.elevation));
    }
  }
  return maxDiff <= 0.07;
};

const computeLocalRelief = (state: WorldState, x: number, y: number): number => {
  const center = state.tiles[indexFor(state.grid, x, y)]?.elevation ?? 0;
  let maxDiff = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
      maxDiff = Math.max(maxDiff, Math.abs(center - (neighbor?.elevation ?? center)));
    }
  }
  return maxDiff;
};

const getSecondaryDirection = (primaryDir: { dx: number; dy: number }): { dx: number; dy: number } => ({
  dx: -primaryDir.dy,
  dy: primaryDir.dx
});

const measureBuildableSpan = (
  state: WorldState,
  center: Point,
  dx: number,
  dy: number,
  maxSteps: number
): number => {
  let span = 1;
  for (const sign of [-1, 1] as const) {
    for (let step = 1; step <= maxSteps; step += 1) {
      const x = center.x + dx * step * sign;
      const y = center.y + dy * step * sign;
      if (!isBuildable(state, x, y)) {
        break;
      }
      span += 1;
    }
  }
  return span;
};

const scoreCompactParallelSide = (
  state: WorldState,
  center: Point,
  primaryDir: { dx: number; dy: number },
  sideDir: { dx: number; dy: number }
): number => {
  let score = 0;
  const sampleCenter = {
    x: center.x + sideDir.dx * COMPACT_TOWN_BLOCK_OFFSET,
    y: center.y + sideDir.dy * COMPACT_TOWN_BLOCK_OFFSET
  };
  for (let step = -2; step <= 2; step += 1) {
    const x = sampleCenter.x + primaryDir.dx * step;
    const y = sampleCenter.y + primaryDir.dy * step;
    if (!inBounds(state.grid, x, y)) {
      continue;
    }
    if (isBuildable(state, x, y)) {
      score += 1;
      continue;
    }
    const tile = state.tiles[indexFor(state.grid, x, y)];
    if (tile && tile.type !== "water") {
      score += 0.15;
    }
  }
  return score;
};

const isCompactTownArchetype = (archetype: TownStreetArchetype): boolean =>
  archetype === "crossroads" || archetype === "main_street";

const classifyTownProfile = (candidate: {
  waterDistance: number;
  localRelief: number;
  elevation: number;
}): TownIndustryProfile => {
  if (candidate.localRelief >= 0.038 || candidate.elevation >= 0.66) {
    return "mining";
  }
  if (candidate.waterDistance <= COASTAL_PROFILE_WATER_DISTANCE_MAX && candidate.elevation < 0.6) {
    return "coastal";
  }
  if (candidate.localRelief <= 0.018 && candidate.waterDistance >= 6) {
    return "farming";
  }
  return "general";
};

const collectSettlementCandidates = (state: WorldState, townDensity: number, heightScaleMultiplier: number): TownSeedCandidate[] => {
  const candidates: TownSeedCandidate[] = [];
  const step = Math.max(1, Math.floor(Math.max(state.grid.cols, state.grid.rows) / 192));
  const minDim = Math.min(state.grid.cols, state.grid.rows);
  for (let y = 4; y < state.grid.rows - 4; y += step) {
    for (let x = 4; x < state.grid.cols - 4; x += step) {
      if (!isBuildable(state, x, y, heightScaleMultiplier)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      const distFromBase = Math.hypot(x - state.basePoint.x, y - state.basePoint.y);
      if (distFromBase < minDim * 0.12) {
        continue;
      }
      const waterDistance = Math.max(0, Math.floor(tile.waterDist ?? 99));
      const edgeDist = Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y);
      const edgeNorm = clamp01(edgeDist / Math.max(1, minDim * 0.24));
      const baseBand = 1 - Math.min(1, Math.abs(distFromBase / Math.max(1, minDim * 0.36) - 1));
      const localRelief = computeLocalRelief(state, x, y);
      const flatness = 1 - clamp01(localRelief * 12.5);
      const terrainFit = evaluateSettlementSiteFit(state, { x, y }, 3, { heightScaleMultiplier });
      if (terrainFit.maxAngleDeg > SETTLEMENT_TOWN_FALLBACK_ANGLE_DEG) {
        continue;
      }
      const angleScore = scoreSettlementAngle(Math.max(terrainFit.maxAngleDeg, terrainFit.meanAngleDeg));
      const waterAffinity = 1 - clamp01(Math.abs(waterDistance - 6) / 10);
      const profile = classifyTownProfile({
        waterDistance,
        localRelief,
        elevation: tile.elevation
      });
      let score = 0.12;
      score += flatness * 0.52;
      score += angleScore * 0.76;
      score += edgeNorm * 0.24;
      score += baseBand * 0.18;
      score += waterAffinity * (profile === "coastal" ? 0.22 : profile === "farming" ? 0.16 : 0.12);
      score += profile === "farming" ? 0.08 : profile === "general" ? 0.05 : profile === "coastal" ? 0.02 : 0;
      score += flatness >= 0.82 ? 0.04 : 0;
      score += terrainFit.maxAngleDeg <= SETTLEMENT_PLOT_MAX_ANGLE_DEG ? 0.08 : 0;
      score += (townDensity - 0.5) * 0.05;
      if (score <= 0.42) {
        continue;
      }
      candidates.push({
        x,
        y,
        score,
        localRelief,
        maxAngleDeg: terrainFit.maxAngleDeg,
        meanAngleDeg: terrainFit.meanAngleDeg,
        waterDistance,
        elevation: tile.elevation,
        profile
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
};

const markReachableLand = (state: WorldState, origin: Point): Uint8Array => {
  const total = state.grid.totalTiles;
  const visited = new Uint8Array(total);
  if (!inBounds(state.grid, origin.x, origin.y)) {
    return visited;
  }
  const originIdx = indexFor(state.grid, origin.x, origin.y);
  if (state.tiles[originIdx]?.type === "water") {
    return visited;
  }
  const queueX = new Int16Array(total);
  const queueY = new Int16Array(total);
  let head = 0;
  let tail = 0;
  queueX[tail] = origin.x;
  queueY[tail] = origin.y;
  tail += 1;
  visited[originIdx] = 1;
  while (head < tail) {
    const x = queueX[head]!;
    const y = queueY[head]!;
    head += 1;
    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    ];
    for (let i = 0; i < neighbors.length; i += 1) {
      const next = neighbors[i]!;
      if (!inBounds(state.grid, next.x, next.y)) {
        continue;
      }
      const idx = indexFor(state.grid, next.x, next.y);
      if (visited[idx] > 0 || state.tiles[idx]?.type === "water") {
        continue;
      }
      visited[idx] = 1;
      queueX[tail] = next.x;
      queueY[tail] = next.y;
      tail += 1;
    }
  }
  return visited;
};

const selectVillageSeeds = (
  state: WorldState,
  townDensity: number,
  spacing01: number,
  requestedCount: number,
  heightScaleMultiplier: number
): TownSeedCandidate[] => {
  const candidates = collectSettlementCandidates(state, townDensity, heightScaleMultiplier);
  const reachable = markReachableLand(state, state.basePoint);
  const chosen: TownSeedCandidate[] = [];
  const minDim = Math.min(state.grid.cols, state.grid.rows);
  const minSpacing = Math.max(12, Math.round(minDim * (0.08 + spacing01 * 0.1)));
  for (let i = 0; i < candidates.length && chosen.length < requestedCount; i += 1) {
    const candidate = candidates[i]!;
    if (reachable[indexFor(state.grid, candidate.x, candidate.y)] === 0) {
      continue;
    }
    if (chosen.some((existing) => Math.hypot(existing.x - candidate.x, existing.y - candidate.y) < minSpacing)) {
      continue;
    }
    chosen.push(candidate);
  }
  return chosen;
};

const pickStreetArchetype = (
  state: WorldState,
  candidate: TownSeedCandidate,
  primaryDir: { dx: number; dy: number }
): TownStreetArchetype => {
  if (candidate.profile === "coastal") {
    const secondaryDir = getSecondaryDirection(primaryDir);
    const buildSpan = measureBuildableSpan(state, candidate, secondaryDir.dx, secondaryDir.dy, COMPACT_TOWN_BLOCK_OFFSET + 1);
    if (
      candidate.waterDistance <= RIBBON_TOWN_WATER_DISTANCE_MAX &&
      (candidate.localRelief >= RIBBON_TOWN_RELIEF_MIN || buildSpan < RIBBON_TOWN_MIN_BUILD_SPAN)
    ) {
      return "ribbon";
    }
    return candidate.localRelief <= 0.024 ? "crossroads" : "main_street";
  }
  if (candidate.profile === "mining" && candidate.localRelief >= 0.032) {
    return "contour";
  }
  if (candidate.profile === "farming" && candidate.localRelief <= 0.026) {
    return "crossroads";
  }
  if (candidate.profile === "general" && candidate.localRelief <= 0.024) {
    return "crossroads";
  }
  return "main_street";
};

const chooseCardinalDirectionTowardWater = (state: WorldState, origin: Point): { dx: number; dy: number } | null => {
  let best: Point | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  const radius = 8;
  for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.tiles[idx]?.type !== "water") {
        continue;
      }
      const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  if (!best) {
    return null;
  }
  const dx = best.x - origin.x;
  const dy = best.y - origin.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return { dx: Math.sign(dx) || 1, dy: 0 };
  }
  return { dx: 0, dy: Math.sign(dy) || 1 };
};

const measureAxisRelief = (state: WorldState, center: Point, dx: number, dy: number): number => {
  let relief = 0;
  for (let step = 1; step <= 4; step += 1) {
    const x = center.x + dx * step;
    const y = center.y + dy * step;
    const px = center.x - dx * step;
    const py = center.y - dy * step;
    if (inBounds(state.grid, x, y)) {
      relief += computeLocalRelief(state, x, y);
    }
    if (inBounds(state.grid, px, py)) {
      relief += computeLocalRelief(state, px, py);
    }
  }
  return relief;
};

const choosePrimaryDirection = (state: WorldState, candidate: TownSeedCandidate): { dx: number; dy: number } => {
  if (candidate.profile === "coastal") {
    const waterDir = chooseCardinalDirectionTowardWater(state, candidate);
    if (waterDir) {
      return Math.abs(waterDir.dx) > 0 ? { dx: 0, dy: 1 } : { dx: 1, dy: 0 };
    }
  }
  const ewRelief = measureAxisRelief(state, candidate, 1, 0);
  const nsRelief = measureAxisRelief(state, candidate, 0, 1);
  if (candidate.profile === "mining") {
    return ewRelief <= nsRelief ? { dx: 1, dy: 0 } : { dx: 0, dy: 1 };
  }
  return ewRelief <= nsRelief ? { dx: 1, dy: 0 } : { dx: 0, dy: 1 };
};

const findBuildableNear = (state: WorldState, origin: Point, radius: number, heightScaleMultiplier = 1): Point | null => {
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      if (!isBuildable(state, x, y, heightScaleMultiplier)) {
        continue;
      }
      const angleDeg = computeSettlementTileAngleDeg(state, x, y, { heightScaleMultiplier });
      const score =
        Math.abs(origin.x - x) +
        Math.abs(origin.y - y) +
        computeLocalRelief(state, x, y) * 64 +
        Math.max(0, angleDeg - SETTLEMENT_PLOT_MAX_ANGLE_DEG) * 0.4 +
        (SETTLEMENT_PLOT_MAX_ANGLE_DEG - Math.min(SETTLEMENT_PLOT_MAX_ANGLE_DEG, angleDeg)) * -0.02;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
};

const buildRoadOptions = (plan: SettlementPlacementResult): SettlementRoadOptions => ({
  bridgePolicy: plan.bridgeTransitions ? "allow" : "never",
  heightScaleMultiplier: Math.max(0.1, plan.heightScaleMultiplier ?? 1),
  diagonalPenalty: Math.max(0, plan.diagonalPenalty ?? 0.18),
  preferredAngleDeg: 13,
  softAngleDeg: 20,
  avoidAngleDeg: 30,
  fallbackAngleDeg: 42,
  anglePenaltyWeight: 0.36,
  straightClimbPenaltyWeight: 0.44,
  contourTurnReliefWeight: 0.8
});

const buildConnectorRoadOptions = (plan: SettlementPlacementResult): SettlementRoadOptions => ({
  ...buildRoadOptions(plan),
  gradeLimitStart: 0.12,
  gradeLimitRelaxStep: 0.015,
  gradeLimitMax: 0.2,
  slopePenaltyWeight: 19,
  crossfallLimitStart: 0.08,
  crossfallLimitRelaxStep: 0.014,
  crossfallLimitMax: 0.16,
  crossfallPenaltyWeight: 17,
  gradeChangeLimitStart: 0.08,
  gradeChangeLimitRelaxStep: 0.014,
  gradeChangeLimitMax: 0.16,
  gradeChangePenaltyWeight: 15,
  riverBlockDistance: 0,
  riverPenaltyDistance: 2,
  riverPenaltyWeight: 4,
  turnPenalty: 0.04,
  bridgeStepCost: 18,
  bridgeMaxConsecutiveWater: 4,
  bridgeMaxWaterTilesPerPath: 10,
  anglePenaltyWeight: 0.5,
  straightClimbPenaltyWeight: 0.66,
  contourTurnReliefWeight: 1.05
});

const buildRescueConnectorRoadOptions = (plan: SettlementPlacementResult): SettlementRoadOptions => ({
  ...buildRoadOptions(plan),
  diagonalPenalty: Math.min(0.08, Math.max(0, plan.diagonalPenalty ?? 0.18)),
  gradeLimitStart: 0.14,
  gradeLimitRelaxStep: 0.025,
  gradeLimitMax: 0.38,
  slopePenaltyWeight: 30,
  crossfallLimitStart: 0.1,
  crossfallLimitRelaxStep: 0.025,
  crossfallLimitMax: 0.32,
  crossfallPenaltyWeight: 26,
  gradeChangeLimitStart: 0.1,
  gradeChangeLimitRelaxStep: 0.025,
  gradeChangeLimitMax: 0.32,
  gradeChangePenaltyWeight: 22,
  riverBlockDistance: 0,
  riverPenaltyDistance: 2,
  riverPenaltyWeight: 3,
  turnPenalty: 0.025,
  bridgeStepCost: 16,
  bridgeMaxConsecutiveWater: 8,
  bridgeMaxWaterTilesPerPath: 20,
  avoidAngleDeg: 30,
  fallbackAngleDeg: 64,
  anglePenaltyWeight: 1.18,
  straightClimbPenaltyWeight: 1.28,
  contourTurnReliefWeight: 1.2,
  allowMountainPassFallback: true
});

const buildConnectivityFallbackRoadOptions = (plan: SettlementPlacementResult): SettlementRoadOptions => ({
  ...buildRescueConnectorRoadOptions(plan),
  gradeLimitStart: 0.34,
  gradeLimitRelaxStep: 0.08,
  gradeLimitMax: 1.5,
  slopePenaltyWeight: 60,
  crossfallLimitStart: 0.28,
  crossfallLimitRelaxStep: 0.08,
  crossfallLimitMax: 1.2,
  crossfallPenaltyWeight: 56,
  gradeChangeLimitStart: 0.28,
  gradeChangeLimitRelaxStep: 0.08,
  gradeChangeLimitMax: 1.2,
  gradeChangePenaltyWeight: 48,
  avoidAngleDeg: 30,
  fallbackAngleDeg: 88,
  anglePenaltyWeight: 2.4,
  straightClimbPenaltyWeight: 3.2,
  contourTurnReliefWeight: 1.8,
  allowMountainPassFallback: true
});

const withConnectorSearchBounds = (
  state: WorldState,
  start: Point,
  end: Point,
  options: SettlementRoadOptions,
  padding: number
): SettlementRoadOptions => ({
  ...options,
  searchBounds: {
    minX: Math.max(0, Math.min(start.x, end.x) - padding),
    maxX: Math.min(state.grid.cols - 1, Math.max(start.x, end.x) + padding),
    minY: Math.max(0, Math.min(start.y, end.y) - padding),
    maxY: Math.min(state.grid.rows - 1, Math.max(start.y, end.y) + padding)
  }
});

const buildBoundedConnectorOptions = (
  state: WorldState,
  start: Point,
  end: Point,
  plan: SettlementPlacementResult,
  options: SettlementRoadOptions = buildConnectorRoadOptions(plan)
): SettlementRoadOptions => {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const padding = Math.max(14, Math.ceil(distance * 0.8));
  return withConnectorSearchBounds(state, start, end, options, padding);
};

const carveRoadSegments = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  segments: Array<{ start: Point; end: Point; options?: SettlementRoadOptions }>
): boolean => {
  if (segments.length === 0) {
    return false;
  }
  if (roadAdapter.carveRoadSequence) {
    return roadAdapter.carveRoadSequence(state, segments);
  }
  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i]!;
    if (!roadAdapter.carveRoad(state, segment.start, segment.end, segment.options)) {
      return false;
    }
  }
  return true;
};

const carveConnectorWithWaypoints = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  start: Point,
  end: Point,
  plan: SettlementPlacementResult,
  options: SettlementRoadOptions = buildConnectorRoadOptions(plan)
): boolean => {
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const segments = Math.max(4, Math.ceil(distance / 8));
  let current = start;
  const roadSegments: Array<{ start: Point; end: Point; options?: SettlementRoadOptions }> = [];
  for (let step = 1; step <= segments; step += 1) {
    const t = step / segments;
    const projected = {
      x: Math.round(start.x + (end.x - start.x) * t),
      y: Math.round(start.y + (end.y - start.y) * t)
    };
    const target = step === segments ? end : findBuildableNear(state, projected, 6, plan.heightScaleMultiplier ?? 1) ?? projected;
    roadSegments.push({ start: current, end: target, options: buildBoundedConnectorOptions(state, current, target, plan, options) });
    current = target;
  }
  return carveRoadSegments(state, roadAdapter, roadSegments);
};

const carveRescueConnectorWithWaypoints = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  start: Point,
  end: Point,
  plan: SettlementPlacementResult
): boolean => {
  const options = buildRescueConnectorRoadOptions(plan);
  if (roadAdapter.carveRoad(state, start, end, buildBoundedConnectorOptions(state, start, end, plan, options))) {
    return true;
  }
  if (roadAdapter.carveRoad(state, start, end, options)) {
    return true;
  }
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const segments = Math.max(5, Math.ceil(distance / 6));
  let current = start;
  const roadSegments: Array<{ start: Point; end: Point; options?: SettlementRoadOptions }> = [];
  for (let step = 1; step <= segments; step += 1) {
    const t = step / segments;
    const projected = {
      x: Math.round(start.x + (end.x - start.x) * t),
      y: Math.round(start.y + (end.y - start.y) * t)
    };
    const target = step === segments ? end : findBuildableNear(state, projected, 10, plan.heightScaleMultiplier ?? 1) ?? projected;
    roadSegments.push({ start: current, end: target, options: buildBoundedConnectorOptions(state, current, target, plan, options) });
    current = target;
  }
  if (carveRoadSegments(state, roadAdapter, roadSegments)) {
    return true;
  }
  return roadAdapter.carveRoad(state, start, end, buildConnectivityFallbackRoadOptions(plan));
};

const carveStreetArm = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  start: Point,
  dx: number,
  dy: number,
  length: number,
  plan: SettlementPlacementResult
): Point => {
  const projected = { x: start.x + dx * length, y: start.y + dy * length };
  const target = findBuildableNear(state, projected, 3, plan.heightScaleMultiplier ?? 1) ?? projected;
  if (roadAdapter.carveRoad(state, start, target, buildRoadOptions(plan))) {
    return target;
  }
  return start;
};

const pushFrontier = (
  frontiers: TownGrowthFrontier[],
  center: Point,
  point: Point,
  dx: number,
  dy: number,
  branchType: TownGrowthFrontier["branchType"],
  active: boolean
): void => {
  if (point.x === center.x && point.y === center.y) {
    return;
  }
  if (frontiers.some((frontier) => frontier.x === point.x && frontier.y === point.y && frontier.dx === dx && frontier.dy === dy)) {
    return;
  }
  frontiers.push({
    x: point.x,
    y: point.y,
    dx,
    dy,
    active,
    branchType
  });
};

const buildCompactStreetSkeleton = (
  state: WorldState,
  town: Town,
  primaryDir: { dx: number; dy: number },
  plan: SettlementPlacementResult,
  roadAdapter: SettlementRoadAdapter,
  isBaseTown: boolean
): LocalStreetBuildResult | null => {
  const archetype = isBaseTown ? "crossroads" : town.streetArchetype;
  const center = { x: town.x, y: town.y };
  const branchDir = getSecondaryDirection(primaryDir);
  const primaryHalfLength = isBaseTown ? 4 : archetype === "crossroads" ? 4 : 3;
  const secondaryHalfLength =
    isBaseTown || archetype === "crossroads" ? Math.max(2, primaryHalfLength - 1) : 2;
  const frontiers: TownGrowthFrontier[] = [];
  const forward = carveStreetArm(state, roadAdapter, center, primaryDir.dx, primaryDir.dy, primaryHalfLength, plan);
  const backward = carveStreetArm(state, roadAdapter, center, -primaryDir.dx, -primaryDir.dy, primaryHalfLength, plan);
  pushFrontier(frontiers, center, forward, primaryDir.dx, primaryDir.dy, "primary", true);
  pushFrontier(frontiers, center, backward, -primaryDir.dx, -primaryDir.dy, "primary", true);

  if (isBaseTown || archetype === "crossroads") {
    const left = carveStreetArm(state, roadAdapter, center, branchDir.dx, branchDir.dy, secondaryHalfLength, plan);
    const right = carveStreetArm(state, roadAdapter, center, -branchDir.dx, -branchDir.dy, secondaryHalfLength, plan);
    pushFrontier(frontiers, center, left, branchDir.dx, branchDir.dy, "secondary", true);
    pushFrontier(frontiers, center, right, -branchDir.dx, -branchDir.dy, "secondary", true);
    return {
      frontiers,
      streetArchetype: archetype
    };
  }

  const positiveSide = scoreCompactParallelSide(state, center, primaryDir, branchDir);
  const negativeSide = scoreCompactParallelSide(state, center, primaryDir, { dx: -branchDir.dx, dy: -branchDir.dy });
  const sideDir = positiveSide >= negativeSide ? branchDir : { dx: -branchDir.dx, dy: -branchDir.dy };
  const sideStreet = carveStreetArm(state, roadAdapter, center, sideDir.dx, sideDir.dy, secondaryHalfLength, plan);
  pushFrontier(frontiers, center, sideStreet, sideDir.dx, sideDir.dy, "secondary", true);
  return {
    frontiers,
    streetArchetype: archetype
  };
};

const buildLocalStreetSkeleton = (
  state: WorldState,
  town: Town,
  primaryDir: { dx: number; dy: number },
  plan: SettlementPlacementResult,
  roadAdapter: SettlementRoadAdapter,
  isBaseTown: boolean
): LocalStreetBuildResult => {
  const archetype = isBaseTown ? "crossroads" : town.streetArchetype;
  if (isBaseTown || isCompactTownArchetype(archetype)) {
    const compact = buildCompactStreetSkeleton(state, town, primaryDir, plan, roadAdapter, isBaseTown);
    if (compact) {
      return compact;
    }
  }
  const center = { x: town.x, y: town.y };
  const primaryHalfLength = isBaseTown ? 4 : archetype === "ribbon" ? 4 : 3;
  const secondaryHalfLength =
    isBaseTown ? 4 : archetype === "crossroads" ? 3 : archetype === "main_street" ? 2 : archetype === "ribbon" ? 2 : 1;
  const frontiers: TownGrowthFrontier[] = [];
  const forward = carveStreetArm(state, roadAdapter, center, primaryDir.dx, primaryDir.dy, primaryHalfLength, plan);
  const backward = carveStreetArm(state, roadAdapter, center, -primaryDir.dx, -primaryDir.dy, primaryHalfLength, plan);
  pushFrontier(frontiers, center, forward, primaryDir.dx, primaryDir.dy, "primary", true);
  pushFrontier(frontiers, center, backward, -primaryDir.dx, -primaryDir.dy, "primary", true);
  if (archetype === "crossroads" || archetype === "main_street" || archetype === "ribbon") {
    const branchDir = { dx: -primaryDir.dy, dy: primaryDir.dx };
    const left = carveStreetArm(state, roadAdapter, center, branchDir.dx, branchDir.dy, secondaryHalfLength, plan);
    const right = carveStreetArm(state, roadAdapter, center, -branchDir.dx, -branchDir.dy, secondaryHalfLength, plan);
    const activateSecondary = isBaseTown || archetype === "crossroads" || archetype === "main_street";
    pushFrontier(frontiers, center, left, branchDir.dx, branchDir.dy, "secondary", activateSecondary);
    pushFrontier(frontiers, center, right, -branchDir.dx, -branchDir.dy, "secondary", activateSecondary && archetype !== "ribbon");
  }
  return {
    frontiers,
    streetArchetype: archetype
  };
};

type TownConnectionEdge = {
  a: number;
  b: number;
  distance: number;
};

const compareTownConnectionEdges = (left: TownConnectionEdge, right: TownConnectionEdge): number => {
  if (left.distance !== right.distance) {
    return left.distance - right.distance;
  }
  if (left.a !== right.a) {
    return left.a - right.a;
  }
  return left.b - right.b;
};

const createTownConnectionEdgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

const buildTownConnectionPlan = (towns: Town[]): Array<[Town, Town]> => {
  if (towns.length <= 1) {
    return [];
  }
  const allEdges: TownConnectionEdge[] = [];
  for (let i = 0; i < towns.length; i += 1) {
    for (let j = i + 1; j < towns.length; j += 1) {
      allEdges.push({
        a: towns[i]!.id,
        b: towns[j]!.id,
        distance: Math.hypot(towns[i]!.x - towns[j]!.x, towns[i]!.y - towns[j]!.y)
      });
    }
  }
  allEdges.sort(compareTownConnectionEdges);
  const parent = new Int32Array(towns.length);
  for (let i = 0; i < towns.length; i += 1) {
    parent[i] = i;
  }
  const find = (value: number): number => {
    let current = value;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]!]!;
      current = parent[current]!;
    }
    return current;
  };
  const union = (left: number, right: number): boolean => {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) {
      return false;
    }
    parent[rightRoot] = leftRoot;
    return true;
  };
  const selected: TownConnectionEdge[] = [];
  const selectedKeys = new Set<string>();
  for (let i = 0; i < allEdges.length; i += 1) {
    const edge = allEdges[i]!;
    const key = createTownConnectionEdgeKey(edge.a, edge.b);
    if (selectedKeys.has(key) || !union(edge.a, edge.b)) {
      continue;
    }
    selectedKeys.add(key);
    selected.push(edge);
    if (selected.length >= towns.length - 1) {
      break;
    }
  }
  const byId = new Map<number, Town>(towns.map((town) => [town.id, town]));
  return selected
    .map((edge) => {
      const left = byId.get(edge.a);
      const right = byId.get(edge.b);
      return left && right ? ([left, right] as [Town, Town]) : null;
    })
    .filter((pair): pair is [Town, Town] => pair !== null);
};

const buildTownRecord = (
  id: number,
  worldSeed: number,
  name: string,
  center: TownSeedCandidate,
  streetArchetype: TownStreetArchetype
): Town => ({
  id,
  name,
  x: center.x,
  y: center.y,
  cx: center.x,
  cy: center.y,
  radius: MIN_TOWN_RADIUS,
  industryProfile: center.profile,
  streetArchetype,
  growthFrontiers: [],
  growthSeedYear: 0,
  simulatedGrowthYears: 0,
  houseCount: 0,
  housesLost: 0,
  alertPosture: 0,
  alertCooldownDays: 0,
  nonApprovingHouseCount: 0,
  approval: 1,
  evacState: "none",
  evacProgress: 0,
  evacuationStatus: "None",
  populationRemaining: 0,
  populationQueued: 0,
  populationEvacuating: 0,
  populationEvacuated: 0,
  populationDead: 0,
  vehiclesQueued: 0,
  vehiclesMoving: 0,
  vehiclesDestroyed: 0,
  lastPostureChangeDay: 0,
  desiredHouseDelta: 0,
  lastSeasonHouseDelta: 0,
  growthPressure: 0,
  recoveryPressure: 0,
  buildStartCooldownDays: Math.floor(
    hash2D(center.x + id * 17, center.y + id * 31, worldSeed ^ 0x51f15a1d) * (TOWN_INITIAL_BUILD_COOLDOWN_MAX_DAYS + 1)
  ),
  activeBuildCap: 1,
  buildStartSerial: 0
});

const findStreetNearTown = (state: WorldState, origin: Point, radius: number): Point | null => {
  let best: Point | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      if (!tile || (tile.type !== "road" && (state.tileRoadBridge[idx] ?? 0) === 0)) {
        continue;
      }
      const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
};

const selectTownConnectionAnchor = (
  state: WorldState,
  town: Town,
  target: Point,
  roadAdapter: SettlementRoadAdapter
): Point => {
  const activeFrontiers = town.growthFrontiers.filter((frontier) => frontier.active);
  if (activeFrontiers.length > 0) {
    let best = activeFrontiers[0]!;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < activeFrontiers.length; i += 1) {
      const frontier = activeFrontiers[i]!;
      const score =
        Math.abs(frontier.x - target.x) +
        Math.abs(frontier.y - target.y) +
        (frontier.branchType === "secondary" ? 0.5 : 0) +
        Math.hypot(frontier.x - town.x, frontier.y - town.y) * 0.08;
      if (score < bestScore) {
        bestScore = score;
        best = frontier;
      }
    }
    const nearbyStreet = findStreetNearTown(state, { x: best.x, y: best.y }, 2);
    return nearbyStreet ?? { x: best.x, y: best.y };
  }
  const localStreet = findStreetNearTown(state, { x: town.x, y: town.y }, 8);
  return localStreet ?? roadAdapter.findNearestRoadTile(state, { x: town.x, y: town.y });
};

const buildRoadComponentMap = (state: WorldState, roadAdapter: SettlementRoadAdapter): Int32Array => {
  const components = new Int32Array(state.grid.totalTiles);
  components.fill(-1);
  let componentId = 0;
  const queue: number[] = [];
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (components[idx] >= 0) {
      continue;
    }
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    if (!isRoadLikeTile(state, x, y)) {
      continue;
    }
    components[idx] = componentId;
    queue.push(idx);
    while (queue.length > 0) {
      const current = queue.pop()!;
      const cx = current % state.grid.cols;
      const cy = Math.floor(current / state.grid.cols);
      const neighbors = roadAdapter.collectConnectedRoadNeighbors(state, cx, cy);
      for (let i = 0; i < neighbors.length; i += 1) {
        const neighbor = neighbors[i]!;
        if (!isRoadLikeTile(state, neighbor.x, neighbor.y)) {
          continue;
        }
        const neighborIdx = indexFor(state.grid, neighbor.x, neighbor.y);
        if (components[neighborIdx] >= 0) {
          continue;
        }
        components[neighborIdx] = componentId;
        queue.push(neighborIdx);
      }
    }
    componentId += 1;
  }
  return components;
};

const getRoadComponentAt = (state: WorldState, components: Int32Array, point: Point): number => {
  if (!inBounds(state.grid, point.x, point.y) || !isRoadLikeTile(state, point.x, point.y)) {
    return -1;
  }
  return components[indexFor(state.grid, point.x, point.y)] ?? -1;
};

const resolveTownRoadAnchor = (
  state: WorldState,
  town: Town,
  target: Point,
  roadAdapter: SettlementRoadAdapter
): Point => {
  const selected = selectTownConnectionAnchor(state, town, target, roadAdapter);
  if (isRoadLikeTile(state, selected.x, selected.y)) {
    return selected;
  }
  return findStreetNearTown(state, { x: town.x, y: town.y }, 10) ?? { x: town.x, y: town.y };
};

const resolveBaseRoadAnchor = (state: WorldState, roadAdapter: SettlementRoadAdapter): Point =>
  isRoadLikeTile(state, state.basePoint.x, state.basePoint.y)
    ? state.basePoint
    : findStreetNearTown(state, state.basePoint, 6) ?? roadAdapter.findNearestRoadTile(state, state.basePoint);

const findNearestStreetExcludingBase = (state: WorldState, origin: Point): Point | null => {
  let best: Point | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      if (!tile || tile.type !== "road") {
        continue;
      }
      const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
};

const ensureBaseRoadConnectivity = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  plan: SettlementPlacementResult
): boolean => {
  if (!isRoadLikeTile(state, state.basePoint.x, state.basePoint.y)) {
    return false;
  }
  const target = findStreetNearTown(state, state.basePoint, 12) ?? findNearestStreetExcludingBase(state, state.basePoint);
  if (!target || (target.x === state.basePoint.x && target.y === state.basePoint.y)) {
    return false;
  }
  return (
    roadAdapter.carveRoad(
      state,
      state.basePoint,
      target,
      buildBoundedConnectorOptions(state, state.basePoint, target, plan, buildConnectorRoadOptions(plan))
    ) || roadAdapter.carveRoad(state, state.basePoint, target, buildRescueConnectorRoadOptions(plan))
  );
};

type RoadJunctionCandidate = Point & {
  score: number;
};

const distanceToSegment = (point: Point, start: Point, end: Point): number => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq <= 1e-6) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lenSq));
  const px = start.x + dx * t;
  const py = start.y + dy * t;
  return Math.hypot(point.x - px, point.y - py);
};

const collectRoadJunctionCandidates = (
  state: WorldState,
  anchors: Point[],
  plan: SettlementPlacementResult
): RoadJunctionCandidate[] => {
  const total = state.grid.totalTiles;
  const limit = Math.max(16, Math.min(total >= 16000 ? 96 : 32, Math.ceil(Math.sqrt(total) * 0.7)));
  const step = Math.max(3, Math.floor(Math.sqrt(total / Math.max(1, limit * 2))));
  const heightScaleMultiplier = plan.heightScaleMultiplier ?? 1;
  const candidates: RoadJunctionCandidate[] = [];
  for (let y = step; y < state.grid.rows - step; y += step) {
    for (let x = step; x < state.grid.cols - step; x += step) {
      if (!isBuildable(state, x, y, heightScaleMultiplier)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      if (!tile || tile.type === "water" || tile.type === "house" || tile.type === "base" || state.structureMask[idx] > 0) {
        continue;
      }
      const point = { x, y };
      let nearestLine = Number.POSITIVE_INFINITY;
      for (let i = 0; i < anchors.length; i += 1) {
        for (let j = i + 1; j < anchors.length; j += 1) {
          nearestLine = Math.min(nearestLine, distanceToSegment(point, anchors[i]!, anchors[j]!));
        }
      }
      const lineWindow = Math.max(8, step * 2.5);
      if (nearestLine > lineWindow) {
        continue;
      }
      const angleDeg = computeSettlementTileAngleDeg(state, x, y, { heightScaleMultiplier });
      const relief = computeLocalRelief(state, x, y);
      const existingRoadBonus = isRoadLikeTile(state, x, y) ? -8 : 0;
      candidates.push({
        x,
        y,
        score: angleDeg * 1.2 + relief * 220 + nearestLine * 0.7 + existingRoadBonus
      });
    }
  }
  candidates.sort((left, right) => left.score - right.score);
  const selected: RoadJunctionCandidate[] = [];
  const minSpacing = Math.max(5, step * 1.6);
  for (let i = 0; i < candidates.length && selected.length < limit; i += 1) {
    const candidate = candidates[i]!;
    if (selected.some((existing) => Math.hypot(existing.x - candidate.x, existing.y - candidate.y) < minSpacing)) {
      continue;
    }
    selected.push(candidate);
  }
  return selected;
};

const selectJunctionForConnection = (
  junctions: RoadJunctionCandidate[],
  start: Point,
  end: Point
): RoadJunctionCandidate | null => {
  let best: RoadJunctionCandidate | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const direct = Math.max(1, Math.hypot(end.x - start.x, end.y - start.y));
  for (let i = 0; i < junctions.length; i += 1) {
    const junction = junctions[i]!;
    const detour = Math.hypot(junction.x - start.x, junction.y - start.y) + Math.hypot(end.x - junction.x, end.y - junction.y);
    if (detour > direct * 1.7) {
      continue;
    }
    const segmentDist = distanceToSegment(junction, start, end);
    const score = junction.score + segmentDist * 2 + Math.max(0, detour - direct) * 1.4;
    if (score < bestScore) {
      bestScore = score;
      best = junction;
    }
  }
  return best;
};

const carveConnectorViaJunction = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  start: Point,
  end: Point,
  plan: SettlementPlacementResult,
  junctions: RoadJunctionCandidate[],
  options: SettlementRoadOptions = buildConnectorRoadOptions(plan)
): boolean => {
  const junction = selectJunctionForConnection(junctions, start, end);
  if (!junction) {
    return false;
  }
  return carveRoadSegments(state, roadAdapter, [
    { start, end: junction, options: buildBoundedConnectorOptions(state, start, junction, plan, options) },
    { start: junction, end, options: buildBoundedConnectorOptions(state, junction, end, plan, options) }
  ]);
};

const ensureTownLocalRoadAnchors = (
  state: WorldState,
  towns: Town[],
  roadAdapter: SettlementRoadAdapter,
  plan: SettlementPlacementResult
): boolean => {
  let repaired = false;
  for (let i = 0; i < towns.length; i += 1) {
    const town = towns[i]!;
    if (findStreetNearTown(state, { x: town.x, y: town.y }, 10)) {
      continue;
    }
    const start = roadAdapter.findNearestRoadTile(state, { x: town.x, y: town.y });
    const target = isBuildable(state, town.x, town.y, plan.heightScaleMultiplier ?? 1)
      ? { x: town.x, y: town.y }
      : findBuildableNear(state, { x: town.x, y: town.y }, 4, plan.heightScaleMultiplier ?? 1) ?? { x: town.x, y: town.y };
    if (start.x === target.x && start.y === target.y) {
      continue;
    }
    if (carveRescueConnectorWithWaypoints(state, roadAdapter, start, target, plan)) {
      repaired = true;
    }
  }
  return repaired;
};

const ensureTownLocalStreetLinks = (
  state: WorldState,
  towns: Town[],
  roadAdapter: SettlementRoadAdapter,
  plan: SettlementPlacementResult
): boolean => {
  let repaired = false;
  const baseAnchor = resolveBaseRoadAnchor(state, roadAdapter);
  for (let i = 0; i < towns.length; i += 1) {
    const town = towns[i]!;
    const localStreet = findStreetNearTown(state, { x: town.x, y: town.y }, 10);
    if (!localStreet) {
      continue;
    }
    if (
      roadAdapter.carveRoad(state, baseAnchor, localStreet, buildRescueConnectorRoadOptions(plan)) ||
      roadAdapter.carveRoad(state, baseAnchor, localStreet, buildConnectivityFallbackRoadOptions(plan))
    ) {
      repaired = true;
    }
    const selectedAnchor = resolveTownRoadAnchor(state, town, baseAnchor, roadAdapter);
    if (localStreet.x === selectedAnchor.x && localStreet.y === selectedAnchor.y) {
      continue;
    }
    const localOptions = buildRoadOptions(plan);
    if (
      roadAdapter.carveRoad(
        state,
        localStreet,
        selectedAnchor,
        buildBoundedConnectorOptions(state, localStreet, selectedAnchor, plan, localOptions)
      ) ||
      roadAdapter.carveRoad(state, localStreet, selectedAnchor, buildRescueConnectorRoadOptions(plan))
    ) {
      repaired = true;
    }
  }
  return repaired;
};

const ensureTownRoadConnectivity = (
  state: WorldState,
  towns: Town[],
  roadAdapter: SettlementRoadAdapter,
  plan: SettlementPlacementResult
): boolean => {
  let repairedAny = false;
  const maxPasses = Math.max(4, towns.length * 4);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    roadAdapter.backfillRoadEdgesFromAdjacency(state);
    repairedAny = ensureBaseRoadConnectivity(state, roadAdapter, plan) || repairedAny;
    repairedAny = ensureTownLocalStreetLinks(state, towns, roadAdapter, plan) || repairedAny;
    roadAdapter.backfillRoadEdgesFromAdjacency(state);
    const components = buildRoadComponentMap(state, roadAdapter);
    const baseAnchor = resolveBaseRoadAnchor(state, roadAdapter);
    const baseComponent = getRoadComponentAt(state, components, baseAnchor);
    if (baseComponent < 0) {
      return repairedAny;
    }
    const anchorEntries = towns.map((town) => ({
      town,
      anchor: resolveTownRoadAnchor(state, town, baseAnchor, roadAdapter),
      component: -1
    }));
    for (let i = 0; i < anchorEntries.length; i += 1) {
      const entry = anchorEntries[i]!;
      entry.component = getRoadComponentAt(state, components, entry.anchor);
    }
    const disconnected = anchorEntries.filter((entry) => entry.component !== baseComponent);
    if (disconnected.length === 0) {
      return repairedAny;
    }
    const candidates: Array<{
      connectedAnchor: Point;
      disconnectedAnchor: Point;
      disconnectedTown: Town;
      leftAnchor: Point;
      rightAnchor: Point;
      distance: number;
    }> = [];
    const connected = [
      { anchor: baseAnchor },
      ...anchorEntries.filter((entry) => entry.component === baseComponent).map((entry) => ({ anchor: entry.anchor }))
    ];
    const junctions = collectRoadJunctionCandidates(
      state,
      [baseAnchor, ...anchorEntries.map((entry) => entry.anchor)],
      plan
    );
    roadAdapter.recordGeneratedJunctions?.(junctions.length);
    for (let i = 0; i < connected.length; i += 1) {
      const left = connected[i]!;
      for (let j = 0; j < disconnected.length; j += 1) {
        const right = disconnected[j]!;
        const rightAnchor = resolveTownRoadAnchor(state, right.town, left.anchor, roadAdapter);
        candidates.push({
          connectedAnchor: left.anchor,
          disconnectedAnchor: rightAnchor,
          disconnectedTown: right.town,
          leftAnchor: left.anchor,
          rightAnchor,
          distance: Math.hypot(left.anchor.x - rightAnchor.x, left.anchor.y - rightAnchor.y)
        });
      }
    }
    candidates.sort((left, right) => left.distance - right.distance);
    let connectedAny = false;
    for (let i = 0; i < candidates.length; i += 1) {
      const candidate = candidates[i]!;
      const connectorOptions = buildConnectorRoadOptions(plan);
      if (
        carveConnectorViaJunction(state, roadAdapter, candidate.leftAnchor, candidate.rightAnchor, plan, junctions, connectorOptions) ||
        roadAdapter.carveRoad(
          state,
          candidate.leftAnchor,
          candidate.rightAnchor,
          buildBoundedConnectorOptions(state, candidate.leftAnchor, candidate.rightAnchor, plan, connectorOptions)
        ) ||
        carveConnectorWithWaypoints(state, roadAdapter, candidate.leftAnchor, candidate.rightAnchor, plan) ||
        carveRescueConnectorWithWaypoints(state, roadAdapter, candidate.connectedAnchor, candidate.disconnectedAnchor, plan)
      ) {
        connectedAny = true;
        repairedAny = true;
        break;
      }
    }
    if (!connectedAny) {
      break;
    }
  }
  return repairedAny;
};

const initializeSettlementState = (state: WorldState): void => {
  state.totalPropertyValue = 0;
  state.totalPopulation = 0;
  state.totalHouses = 0;
  state.destroyedHouses = 0;
  state.townGrowthAppliedYear = -1;
  state.townAlertDayAccumulator = 0;
  state.settlementRequestedHouses = 0;
  state.settlementPlacedHouses = 0;
  state.settlementPadReliefMax = 0;
  state.settlementPadReliefMean = 0;
  state.towns = [];
  if (state.structureMask.length !== state.grid.totalTiles) {
    state.structureMask = new Uint8Array(state.grid.totalTiles);
  } else {
    state.structureMask.fill(0);
  }
  if (state.tileTownId.length !== state.grid.totalTiles) {
    state.tileTownId = new Int16Array(state.grid.totalTiles).fill(-1);
  } else {
    state.tileTownId.fill(-1);
  }
  if (state.tileStructure.length !== state.grid.totalTiles) {
    state.tileStructure = new Uint8Array(state.grid.totalTiles);
  } else {
    state.tileStructure.fill(0);
  }
  state.settlementBuildDayAccumulator = 0;
  state.buildingLots = [];
  state.nextBuildingLotId = 1;
};

const seedTowns = (state: WorldState, plan: SettlementPlacementResult): Town[] => {
  const baseTerrainFit = evaluateSettlementSiteFit(state, state.basePoint, 3, {
    heightScaleMultiplier: plan.heightScaleMultiplier ?? 1
  });
  const centralCandidate: TownSeedCandidate = {
    x: state.basePoint.x,
    y: state.basePoint.y,
    score: 1,
    localRelief: computeLocalRelief(state, state.basePoint.x, state.basePoint.y),
    maxAngleDeg: baseTerrainFit.maxAngleDeg,
    meanAngleDeg: baseTerrainFit.meanAngleDeg,
    waterDistance: Math.floor(state.tiles[indexFor(state.grid, state.basePoint.x, state.basePoint.y)]?.waterDist ?? 99),
    elevation: state.tiles[indexFor(state.grid, state.basePoint.x, state.basePoint.y)]?.elevation ?? 0,
    profile: classifyTownProfile({
      waterDistance: Math.floor(state.tiles[indexFor(state.grid, state.basePoint.x, state.basePoint.y)]?.waterDist ?? 99),
      localRelief: computeLocalRelief(state, state.basePoint.x, state.basePoint.y),
      elevation: state.tiles[indexFor(state.grid, state.basePoint.x, state.basePoint.y)]?.elevation ?? 0
    })
  };
  const requestedVillageCount = Math.max(2, Math.round(2 + clamp01(plan.townDensity ?? 0.5) * 4));
  const villageSeeds = selectVillageSeeds(
    state,
    clamp01(plan.townDensity ?? 0.5),
    clamp01(plan.settlementSpacing ?? 0.55),
    requestedVillageCount,
    plan.heightScaleMultiplier ?? 1
  );
  const ranked = [centralCandidate, ...villageSeeds];
  const shuffledNames = shuffleTownNames(state.seed ^ state.grid.cols * 73856093 ^ state.grid.rows * 19349663);
  const towns: Town[] = [];
  for (let i = 0; i < ranked.length; i += 1) {
    const seed = ranked[i]!;
    const primaryDir = choosePrimaryDirection(state, seed);
    const streetArchetype = i === 0 ? "crossroads" : pickStreetArchetype(state, seed, primaryDir);
    towns.push(
      buildTownRecord(
        i,
        state.seed,
        `${shuffledNames[i % shuffledNames.length]}${i < shuffledNames.length ? "" : ` ${Math.floor(i / shuffledNames.length) + 1}`}`,
        seed,
        streetArchetype
      )
    );
  }
  state.towns = towns;
  return towns;
};

const connectTownRoads = (state: WorldState, towns: Town[], roadAdapter: SettlementRoadAdapter, plan: SettlementPlacementResult): void => {
  const connections = buildTownConnectionPlan(towns);
  const anchors = [resolveBaseRoadAnchor(state, roadAdapter), ...towns.map((town) => resolveTownRoadAnchor(state, town, state.basePoint, roadAdapter))];
  const junctions = collectRoadJunctionCandidates(state, anchors, plan);
  roadAdapter.recordGeneratedJunctions?.(junctions.length);
  for (let i = 0; i < connections.length; i += 1) {
    const [left, right] = connections[i]!;
    const leftRoad = selectTownConnectionAnchor(state, left, { x: right.x, y: right.y }, roadAdapter);
    const rightRoad = selectTownConnectionAnchor(state, right, { x: left.x, y: left.y }, roadAdapter);
    const connectorOptions = buildConnectorRoadOptions(plan);
    if (carveConnectorViaJunction(state, roadAdapter, leftRoad, rightRoad, plan, junctions, connectorOptions)) {
      continue;
    }
    if (roadAdapter.carveRoad(state, leftRoad, rightRoad, buildBoundedConnectorOptions(state, leftRoad, rightRoad, plan, connectorOptions))) {
      continue;
    }
    const fallbackLeft = roadAdapter.findNearestRoadTile(state, { x: left.x, y: left.y });
    const fallbackRight = roadAdapter.findNearestRoadTile(state, { x: right.x, y: right.y });
    if (carveConnectorViaJunction(state, roadAdapter, fallbackLeft, fallbackRight, plan, junctions, connectorOptions)) {
      continue;
    }
    if (roadAdapter.carveRoad(state, fallbackLeft, fallbackRight, buildBoundedConnectorOptions(state, fallbackLeft, fallbackRight, plan, connectorOptions))) {
      continue;
    }
    carveConnectorWithWaypoints(state, roadAdapter, fallbackLeft, fallbackRight, plan);
  }
};

const buildInitialRoadSkeletons = (
  state: WorldState,
  towns: Town[],
  roadAdapter: SettlementRoadAdapter,
  plan: SettlementPlacementResult
): void => {
  for (let i = 0; i < towns.length; i += 1) {
    const town = towns[i]!;
    const terrainFit = evaluateSettlementSiteFit(state, { x: town.x, y: town.y }, 3, {
      heightScaleMultiplier: plan.heightScaleMultiplier ?? 1
    });
    const candidate: TownSeedCandidate = {
      x: town.x,
      y: town.y,
      score: 1,
      localRelief: computeLocalRelief(state, town.x, town.y),
      maxAngleDeg: terrainFit.maxAngleDeg,
      meanAngleDeg: terrainFit.meanAngleDeg,
      waterDistance: Math.floor(state.tiles[indexFor(state.grid, town.x, town.y)]?.waterDist ?? 99),
      elevation: state.tiles[indexFor(state.grid, town.x, town.y)]?.elevation ?? 0,
      profile: town.industryProfile
    };
    const primaryDir = choosePrimaryDirection(state, candidate);
    const result = buildLocalStreetSkeleton(state, town, primaryDir, plan, roadAdapter, i === 0);
    town.growthFrontiers = result.frontiers;
    town.streetArchetype = result.streetArchetype;
    town.radius = Math.max(MIN_TOWN_RADIUS, TOWN_CORE_RADIUS + result.frontiers.length);
  }
  roadAdapter.backfillRoadEdgesFromAdjacency(state);
};

export const createSettlementPlacementPlan = (
  options: {
    diagonalPenalty?: number;
    pruneRedundantDiagonals?: boolean;
    bridgeTransitions?: boolean;
    heightScaleMultiplier?: number;
    townDensity?: number;
    bridgeAllowance?: number;
    settlementSpacing?: number;
    roadStrictness?: number;
    settlementPreGrowthYears?: number;
  } = {}
): SettlementPlacementResult => ({
  generatedRoads: false,
  diagonalPenalty: Math.max(0, options.diagonalPenalty ?? 0.18),
  pruneRedundantDiagonals: options.pruneRedundantDiagonals ?? true,
  bridgeTransitions: options.bridgeTransitions ?? true,
  heightScaleMultiplier: Math.max(0.1, options.heightScaleMultiplier ?? 1),
  townDensity: clamp01(options.townDensity ?? 0.5),
  bridgeAllowance: clamp01(options.bridgeAllowance ?? (options.bridgeTransitions ? 0.7 : 0.2)),
  settlementSpacing: clamp01(options.settlementSpacing ?? 0.55),
  roadStrictness: clamp01(options.roadStrictness ?? 0.5),
  settlementPreGrowthYears: clampSettlementYears(options.settlementPreGrowthYears)
});

export const executeSettlementPlacementPlan = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  plan: SettlementPlacementResult | null
): SettlementPlacementResult => {
  const realized = createSettlementPlacementPlan(plan ?? {});
  if (realized.generatedRoads) {
    return realized;
  }
  initializeSettlementState(state);
  const towns = seedTowns(state, realized);
  buildInitialRoadSkeletons(state, towns, roadAdapter, realized);
  connectTownRoads(state, towns, roadAdapter, realized);
  ensureTownRoadConnectivity(state, towns, roadAdapter, realized);
  roadAdapter.backfillRoadEdgesFromAdjacency(state);
  simulateTownGrowthYears(state, roadAdapter, clampSettlementYears(realized.settlementPreGrowthYears));
  ensureTownLocalRoadAnchors(state, towns, roadAdapter, realized);
  connectTownRoads(state, towns, roadAdapter, realized);
  ensureTownRoadConnectivity(state, towns, roadAdapter, realized);
  roadAdapter.backfillRoadEdgesFromAdjacency(state);
  if (realized.pruneRedundantDiagonals) {
    roadAdapter.pruneRoadDiagonalStubs(state);
    roadAdapter.backfillRoadEdgesFromAdjacency(state);
    ensureTownRoadConnectivity(state, towns, roadAdapter, realized);
    roadAdapter.backfillRoadEdgesFromAdjacency(state);
  }
  state.plannedTownGrowth = createPrecomputedSettlementGrowthPlan(state, roadAdapter);
  state.settlementRequestedHouses = state.totalHouses;
  state.settlementPlacedHouses = state.totalHouses;
  realized.generatedRoads = true;
  return realized;
};

export const repairSettlementRoadConnectivity = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  plan: SettlementPlacementResult | null
): boolean => {
  const realized = createSettlementPlacementPlan(plan ?? {});
  roadAdapter.backfillRoadEdgesFromAdjacency(state);
  let repaired = ensureTownLocalRoadAnchors(state, state.towns, roadAdapter, realized);
  repaired = ensureTownRoadConnectivity(state, state.towns, roadAdapter, realized) || repaired;
  roadAdapter.backfillRoadEdgesFromAdjacency(state);
  if (realized.pruneRedundantDiagonals) {
    roadAdapter.pruneRoadDiagonalStubs(state);
    roadAdapter.backfillRoadEdgesFromAdjacency(state);
    repaired = ensureTownRoadConnectivity(state, state.towns, roadAdapter, realized) || repaired;
    roadAdapter.backfillRoadEdgesFromAdjacency(state);
  }
  return repaired;
};

export const populateCommunities = (state: WorldState, roadAdapter: SettlementRoadAdapter): void => {
  executeSettlementPlacementPlan(state, roadAdapter, createSettlementPlacementPlan());
};
