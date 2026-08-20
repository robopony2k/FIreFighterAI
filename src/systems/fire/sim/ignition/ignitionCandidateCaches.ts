import type { WorldState } from "../../../../core/state.js";
import type { RNG } from "../../../../core/types.js";
import type { IgnitionCandidate } from "../../types/ignitionTypes.js";
import { isDynamicIgnitionCandidate, isExternallyIgnitableType } from "./ignitionEligibility.js";

interface WeightedCandidate extends IgnitionCandidate {
  cumulativeWeight: number;
}

interface SettlementPool {
  townId: number;
  activityWeight: number;
  candidates: WeightedCandidate[];
}

interface CandidateCache {
  structureRevision: number;
  terrainRevision: number;
  vegetationRevision: number;
  roadCandidates: WeightedCandidate[];
  settlementPools: SettlementPool[];
  rebuildCount: number;
}

const caches = new WeakMap<WorldState, CandidateCache>();
const CARDINAL = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

const bitCount4 = (value: number): number => {
  let count = 0;
  let bits = value & 15;
  while (bits > 0) {
    count += bits & 1;
    bits >>>= 1;
  }
  return count;
};

const toCumulative = (candidates: IgnitionCandidate[]): WeightedCandidate[] => {
  let cumulativeWeight = 0;
  return candidates.map((candidate) => {
    cumulativeWeight += Math.max(0.001, candidate.weight);
    return { ...candidate, cumulativeWeight };
  });
};

const nearestTownBoost = (state: WorldState, x: number, y: number): number => {
  let best = Number.POSITIVE_INFINITY;
  for (const town of state.towns) {
    best = Math.min(best, Math.hypot(x - town.cx, y - town.cy) / Math.max(1, town.radius));
  }
  return Number.isFinite(best) ? 1 + 0.55 / (1 + best) : 1;
};

const buildRoadCandidates = (state: WorldState): WeightedCandidate[] => {
  const weights = new Map<number, number>();
  const { cols, rows } = state.grid;
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    const tile = state.tiles[idx];
    if (!tile || (tile.type !== "road" && state.tileRoadBridge[idx] === 0)) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const roadWeight = 1 + Math.max(0, bitCount4(state.tileRoadEdges[idx]) - 1) * 0.22;
    for (const [dx, dy] of CARDINAL) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= rows) {
        continue;
      }
      const neighborIndex = ny * cols + nx;
      const neighbor = state.tiles[neighborIndex];
      if (!neighbor || state.tileFuel[neighborIndex] <= 0 || !isExternallyIgnitableType(neighbor.type)) {
        continue;
      }
      weights.set(neighborIndex, (weights.get(neighborIndex) ?? 0) + roadWeight * nearestTownBoost(state, nx, ny));
    }
  }
  return toCumulative([...weights.entries()].sort(([a], [b]) => a - b).map(([idx, weight]) => ({
    idx,
    x: idx % cols,
    y: Math.floor(idx / cols),
    weight
  })));
};

const buildSettlementPools = (state: WorldState): SettlementPool[] => state.towns.map((town) => {
  const radius = Math.max(2, town.radius + 3);
  const candidates: IgnitionCandidate[] = [];
  const minX = Math.max(0, Math.floor(town.cx - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(town.cx + radius));
  const minY = Math.max(0, Math.floor(town.cy - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(town.cy + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const idx = y * state.grid.cols + x;
      const tile = state.tiles[idx];
      const distance = Math.hypot(x - town.cx, y - town.cy);
      if (!tile || distance > radius || state.tileFuel[idx] <= 0 || !isExternallyIgnitableType(tile.type)) {
        continue;
      }
      const developed = tile.type === "house" || tile.type === "base" || state.tileStructure[idx] > 0;
      const belongsToTown = state.tileTownId[idx] === town.id;
      if (!developed && !belongsToTown && distance > town.radius + 1) {
        continue;
      }
      candidates.push({
        idx,
        x,
        y,
        weight: (developed ? 1.8 : 1) * (1.15 - 0.45 * Math.min(1, distance / radius))
      });
    }
  }
  return {
    townId: town.id,
    activityWeight: Math.max(1, Math.sqrt(Math.max(1, town.houseCount)) + Math.log2(Math.max(2, town.populationRemaining + 2))),
    candidates: toCumulative(candidates)
  };
}).filter((pool) => pool.candidates.length > 0);

const getCache = (state: WorldState): CandidateCache => {
  const existing = caches.get(state);
  if (
    existing &&
    existing.structureRevision === state.structureRevision &&
    existing.terrainRevision === state.terrainTypeRevision &&
    existing.vegetationRevision === state.vegetationRevision
  ) {
    return existing;
  }
  const cache: CandidateCache = {
    structureRevision: state.structureRevision,
    terrainRevision: state.terrainTypeRevision,
    vegetationRevision: state.vegetationRevision,
    roadCandidates: buildRoadCandidates(state),
    settlementPools: buildSettlementPools(state),
    rebuildCount: (existing?.rebuildCount ?? 0) + 1
  };
  caches.set(state, cache);
  return cache;
};

const sampleWeighted = (candidates: WeightedCandidate[], rng: RNG): IgnitionCandidate | null => {
  const total = candidates.length > 0 ? candidates[candidates.length - 1].cumulativeWeight : 0;
  if (total <= 0) {
    return null;
  }
  const target = rng.next() * total;
  let low = 0;
  let high = candidates.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (candidates[mid].cumulativeWeight < target) low = mid + 1;
    else high = mid;
  }
  const { cumulativeWeight: _, ...candidate } = candidates[low];
  return candidate;
};

const sampleValid = (state: WorldState, candidates: WeightedCandidate[], rng: RNG): IgnitionCandidate | null => {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = sampleWeighted(candidates, rng);
    if (candidate && isDynamicIgnitionCandidate(state, candidate.idx)) {
      return candidate;
    }
  }
  return null;
};

export const getRoadCandidateCount = (state: WorldState): number => getCache(state).roadCandidates.length;

export const selectRoadsideCandidate = (state: WorldState, rng: RNG): IgnitionCandidate | null =>
  sampleValid(state, getCache(state).roadCandidates, rng);

export const selectSettlementCandidate = (state: WorldState, rng: RNG): IgnitionCandidate | null => {
  const pools = getCache(state).settlementPools;
  const totalActivity = pools.reduce((sum, pool) => sum + pool.activityWeight, 0);
  if (totalActivity <= 0) return null;
  let target = rng.next() * totalActivity;
  let selected = pools[pools.length - 1];
  for (const pool of pools) {
    target -= pool.activityWeight;
    if (target <= 0) {
      selected = pool;
      break;
    }
  }
  return sampleValid(state, selected.candidates, rng);
};

export const getIgnitionCandidateCacheStats = (state: WorldState): { rebuildCount: number; roads: number; towns: number } => {
  const cache = getCache(state);
  return { rebuildCount: cache.rebuildCount, roads: cache.roadCandidates.length, towns: cache.settlementPools.length };
};
