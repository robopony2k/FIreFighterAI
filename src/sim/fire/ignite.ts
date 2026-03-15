
import type { RNG } from "../../core/types.js";
import type { WorldState } from "../../core/state.js";
import { indexFor } from "../../core/grid.js";
import { markFireBlockActiveByTile } from "./activeBlocks.js";
import { markFireBounds } from "./bounds.js";
import { sampleIgnitionFireSeed, sampleIgnitionHeatMultiplier } from "./ignitionTuning.js";

const BASE_IGNITION_EXCLUSION_RADIUS = 8;
const EARLY_CAREER_PREFERRED_RADIUS = 24;
const MID_CAREER_PREFERRED_RADIUS = 48;
const LATE_CAREER_PREFERRED_RADIUS = 96;
const DISTANT_IGNITION_WEIGHT = 0.1;
const RANDOM_IGNITION_ATTEMPTS = 80;
const INITIAL_IGNITION_ATTEMPTS = 320;

type IgnitionCandidate = {
  x: number;
  y: number;
  idx: number;
};

type IgnitionRegion = "local" | "tail" | "any";

const isBlockedIgnitionType = (type: WorldState["tiles"][number]["type"]): boolean =>
  type === "water" ||
  type === "beach" ||
  type === "rocky" ||
  type === "bare" ||
  type === "base" ||
  type === "ash" ||
  type === "firebreak" ||
  type === "road";

const isPreferredInitialType = (type: WorldState["tiles"][number]["type"]): boolean =>
  type === "forest" || type === "grass" || type === "scrub" || type === "floodplain";

const getPreferredIgnitionRadius = (year: number): number => {
  if (year >= 15) {
    return Number.POSITIVE_INFINITY;
  }
  if (year >= 10) {
    return LATE_CAREER_PREFERRED_RADIUS;
  }
  if (year >= 5) {
    return MID_CAREER_PREFERRED_RADIUS;
  }
  return EARLY_CAREER_PREFERRED_RADIUS;
};

export const getIgnitionDistanceWeight = (state: WorldState, x: number, y: number): number => {
  const dist = Math.hypot(x - state.basePoint.x, y - state.basePoint.y);
  if (dist < BASE_IGNITION_EXCLUSION_RADIUS) {
    return 0;
  }
  const preferredRadius = getPreferredIgnitionRadius(state.year);
  if (!Number.isFinite(preferredRadius) || dist <= preferredRadius) {
    return 1;
  }
  return DISTANT_IGNITION_WEIGHT;
};

const getIgnitionRegion = (state: WorldState, x: number, y: number): IgnitionRegion | "excluded" => {
  const weight = getIgnitionDistanceWeight(state, x, y);
  if (weight <= 0) {
    return "excluded";
  }
  return weight >= 1 ? "local" : "tail";
};

const matchesIgnitionRegion = (region: IgnitionRegion, candidateRegion: IgnitionRegion | "excluded"): boolean =>
  region === "any" ? candidateRegion !== "excluded" : candidateRegion === region;

const isIgnitionCandidate = (
  state: WorldState,
  idx: number,
  options?: { preferredTerrainOnly?: boolean }
): boolean => {
  const tile = state.tiles[idx];
  if (!tile || state.tileFire[idx] > 0 || state.tileFuel[idx] <= 0 || isBlockedIgnitionType(tile.type)) {
    return false;
  }
  return options?.preferredTerrainOnly ? isPreferredInitialType(tile.type) : true;
};

const fallbackIgnitionCandidate = (
  state: WorldState,
  rng: RNG,
  options?: { preferredTerrainOnly?: boolean; region?: IgnitionRegion }
): IgnitionCandidate | null => {
  const region = options?.region ?? "any";
  let chosen: IgnitionCandidate | null = null;
  let chosenCount = 0;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      if (!isIgnitionCandidate(state, idx, options)) {
        continue;
      }
      const candidateRegion = getIgnitionRegion(state, x, y);
      if (!matchesIgnitionRegion(region, candidateRegion)) {
        continue;
      }
      chosenCount += 1;
      if (rng.next() <= 1 / chosenCount) {
        chosen = { x, y, idx };
      }
    }
  }
  return chosen;
};

export const findIgnitionCandidate = (
  state: WorldState,
  rng: RNG,
  options?: { maxAttempts?: number; preferredTerrainOnly?: boolean; region?: IgnitionRegion }
): IgnitionCandidate | null => {
  const maxAttempts = Math.max(1, Math.floor(options?.maxAttempts ?? RANDOM_IGNITION_ATTEMPTS));
  const tryRegion = (region: IgnitionRegion): IgnitionCandidate | null => {
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const x = Math.floor(rng.next() * state.grid.cols);
      const y = Math.floor(rng.next() * state.grid.rows);
      const idx = indexFor(state.grid, x, y);
      if (!isIgnitionCandidate(state, idx, options)) {
        continue;
      }
      const candidateRegion = getIgnitionRegion(state, x, y);
      if (!matchesIgnitionRegion(region, candidateRegion)) {
        continue;
      }
      return { x, y, idx };
    }
    return fallbackIgnitionCandidate(state, rng, { ...options, region });
  };
  const requestedRegion = options?.region ?? "any";
  if (requestedRegion !== "any") {
    return tryRegion(requestedRegion);
  }
  const primaryRegion: IgnitionRegion = rng.next() < DISTANT_IGNITION_WEIGHT ? "tail" : "local";
  const primaryCandidate = tryRegion(primaryRegion);
  if (primaryCandidate) {
    return primaryCandidate;
  }
  const secondaryRegion: IgnitionRegion = primaryRegion === "local" ? "tail" : "local";
  const secondaryCandidate = tryRegion(secondaryRegion);
  if (secondaryCandidate) {
    return secondaryCandidate;
  }
  return tryRegion("any");
};

export function igniteRandomFire(state: WorldState, rng: RNG, dayDelta: number, intensity: number): void {
  const ignitionChance = state.fireSettings.ignitionChancePerDay * dayDelta * intensity;
  if (rng.next() >= ignitionChance) {
    return;
  }
  const candidate = findIgnitionCandidate(state, rng, { maxAttempts: RANDOM_IGNITION_ATTEMPTS });
  if (!candidate) {
    return;
  }
  const tile = state.tiles[candidate.idx];
  tile.fire = sampleIgnitionFireSeed(rng, "random");
  tile.heat = Math.max(tile.heat, tile.ignitionPoint * sampleIgnitionHeatMultiplier(rng));
  state.tileFire[candidate.idx] = tile.fire;
  state.tileHeat[candidate.idx] = tile.heat;
  markFireBounds(state, candidate.x, candidate.y);
  markFireBlockActiveByTile(state, candidate.idx);
}

export { INITIAL_IGNITION_ATTEMPTS };
