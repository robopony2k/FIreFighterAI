import { clamp } from "../../../../core/climate.js";
import { SUPPRESSION_WETNESS_BLOCK_THRESHOLD } from "../../../../core/config.js";
import type { WorldState } from "../../../../core/state.js";
import type { FireWeatherResponse } from "../fireWeather.js";
import { markFireBlockActiveByTile } from "../fireActiveBlocks.js";
import { markFireBounds } from "../fireBounds.js";
import { isExternallyIgnitableType } from "./ignitionEligibility.js";

export type IgnitionProbabilityResult = {
  probability: number;
  failureReason: "already-burning" | "no-fuel" | "non-ignitable" | "suppression-blocked" | null;
};

export const calculateIgnitionSuccessProbability = (
  state: WorldState,
  tileIndex: number,
  sourceStrength: number,
  weather: FireWeatherResponse
): IgnitionProbabilityResult => {
  const tile = state.tiles[tileIndex];
  if (!tile || !isExternallyIgnitableType(tile.type) || state.tileIgnitionPoint[tileIndex] <= 0) {
    return { probability: 0, failureReason: "non-ignitable" };
  }
  if (state.tileFire[tileIndex] > 0) return { probability: 0, failureReason: "already-burning" };
  if (state.tileFuel[tileIndex] <= 0) return { probability: 0, failureReason: "no-fuel" };
  const wetness = state.tileSuppressionWetness[tileIndex];
  if (wetness >= SUPPRESSION_WETNESS_BLOCK_THRESHOLD) {
    return { probability: 0, failureReason: "suppression-blocked" };
  }
  const fuel = clamp(state.tileFuel[tileIndex], 0, 1.5) / 1.5;
  const dryness = clamp(1 - state.tileMoisture[tileIndex], 0, 1);
  const resistance = clamp(0.55 / Math.max(0.05, state.tileIgnitionPoint[tileIndex]), 0.25, 1.5);
  const weatherReceptivity = clamp(
    0.12 + weather.ignition * 0.4 + weather.climateRisk * 0.32 + weather.climateIgnitionMultiplier * 0.08,
    0.05,
    1.25
  );
  const suppression = 1 - wetness / SUPPRESSION_WETNESS_BLOCK_THRESHOLD;
  return {
    probability: clamp(
      clamp(sourceStrength, 0, 1) * (0.2 + fuel * 0.8) * (0.18 + dryness * 0.82) * resistance * weatherReceptivity * suppression,
      0,
      0.95
    ),
    failureReason: null
  };
};

export const commitExternalIgnition = (state: WorldState, tileIndex: number, strength: number): void => {
  const tile = state.tiles[tileIndex];
  const x = tileIndex % state.grid.cols;
  const y = Math.floor(tileIndex / state.grid.cols);
  const fire = 0.08 + clamp(strength, 0, 1) * 0.12;
  const heat = Math.max(state.tileHeat[tileIndex], state.tileIgnitionPoint[tileIndex] * (1 + strength * 0.05));
  tile.fire = fire;
  tile.heat = heat;
  state.tileFire[tileIndex] = fire;
  state.tileHeat[tileIndex] = heat;
  state.tileBurnAge[tileIndex] = 0;
  state.tileHeatRelease[tileIndex] = 0;
  markFireBounds(state, x, y);
  markFireBlockActiveByTile(state, tileIndex);
};
