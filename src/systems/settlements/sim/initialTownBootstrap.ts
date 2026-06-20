import type { WorldState } from "../../../core/state.js";
import { hash2D } from "../../../mapgen/noise.js";
import type { SettlementRoadAdapter } from "../types/settlementTypes.js";
import { placeInitialTownHouses } from "./townGrowth.js";

export type InitialTownBootstrapSummary = {
  requestedHouses: number;
  placedHouses: number;
  targetsByTown: number[];
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const getInitialTownHouseTarget = (
  worldSeed: number,
  townId: number,
  townDensity: number
): number => {
  const base = Math.round(6 + 14 * clamp01(townDensity));
  const sample = hash2D(townId + 1, base, worldSeed ^ 0x51f15e);
  const variation = sample < 1 / 3 ? -1 : sample >= 2 / 3 ? 1 : 0;
  return Math.max(4, Math.min(20, base + variation));
};

export const bootstrapInitialTowns = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  townDensity: number
): InitialTownBootstrapSummary => {
  const targetsByTown = state.towns.map((town) =>
    getInitialTownHouseTarget(state.seed, town.id, townDensity)
  );
  let placedHouses = 0;
  for (let i = 0; i < state.towns.length; i += 1) {
    const town = state.towns[i];
    if (!town) {
      continue;
    }
    placedHouses += placeInitialTownHouses(state, town, targetsByTown[i] ?? 0, roadAdapter);
  }
  const requestedHouses = targetsByTown.reduce((sum, target) => sum + target, 0);
  state.settlementRequestedHouses = requestedHouses;
  state.settlementPlacedHouses = state.totalHouses;
  return { requestedHouses, placedHouses, targetsByTown };
};
