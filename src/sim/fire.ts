import type { EffectsState } from "../core/effectsState.js";
import type { WorldState } from "../core/state.js";
import { destroyHouse as destroyHouseAnchor } from "../core/towns.js";
import type { RNG } from "../core/types.js";
import { clearVegetationState } from "../core/vegetation.js";
import { advanceHouseDamage } from "../systems/settlements/sim/buildingLifecycle.js";
import { runFireKernel } from "../systems/fire/sim/fireKernel.js";
import type { FireKernelHooks, FireKernelStepOptions } from "../systems/fire/sim/fireKernelTypes.js";
import { buildFireWorkBlocks, ensureFireBlocks, finalizeFireBlocks, markFireBlockNextByTile } from "./fire/activeBlocks.js";
import { resetFireBounds } from "./fire/bounds.js";
import type { FireWeatherResponse } from "./fire/fireWeather.js";
import { igniteRandomFire } from "./fire/ignite.js";
import { emitSmokeAt } from "./particles.js";
import { profEnd, profStart } from "./prof.js";
import { markAttributedFireLossTile, queueScoreFlowEvent } from "./scoring.js";
import { recordTownHouseLoss } from "./towns.js";

const createFxRng = (seed: number): RNG => {
  let state = seed >>> 0;
  return {
    next: () => {
      let t = (state += 0x6d2b79f5);
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }
  };
};

const createFireKernelHooks = (state: WorldState, effects: EffectsState): FireKernelHooks => ({
  profStart,
  profEnd,
  ensureFireBlocks,
  buildFireWorkBlocks,
  finalizeFireBlocks,
  markFireBlockNextByTile,
  resetFireBounds,
  emitSmoke: (event) => {
    emitSmokeAt(state, effects, createFxRng(event.seed), event.x, event.y, event.fireValue);
  },
  damageHouse: (event) => {
    const tile = state.tiles[event.idx];
    if (tile) {
      advanceHouseDamage(tile, event.damage01);
    }
  },
  destroyHouse: (event) => {
    const tile = state.tiles[event.idx];
    if (!tile || tile.type !== "house" || tile.houseDestroyed) {
      return;
    }
    const townId = state.tileTownId[event.idx] ?? -1;
    if (townId >= 0) {
      recordTownHouseLoss(state, townId);
    }
    if (!destroyHouseAnchor(state, event.idx)) {
      state.totalPropertyValue = Math.max(0, state.totalPropertyValue - Math.max(0, tile.houseValue));
      state.totalPopulation = Math.max(0, state.totalPopulation - Math.max(0, tile.houseResidents));
      tile.houseDestroyed = true;
      tile.houseDestroyedAtDay = state.careerDay;
      tile.houseDamage01 = 1;
    }
    state.destroyedHouses += 1;
    state.lostPropertyValue += tile.houseValue;
    state.lostResidents += tile.houseResidents;
    state.yearPropertyLost += tile.houseValue;
    state.yearLivesLost += tile.houseResidents;
    markAttributedFireLossTile(state, event.idx);
    queueScoreFlowEvent(state, "property", 1, undefined, event.x, event.y);
    if (tile.houseResidents > 0) {
      queueScoreFlowEvent(state, "lives", tile.houseResidents, undefined, event.x, event.y);
    }
  },
  clearBurnedVegetation: (event) => {
    const tile = state.tiles[event.idx];
    if (tile) {
      clearVegetationState(tile);
    }
  }
});

export function stepFire(
  state: WorldState,
  effects: EffectsState,
  rng: RNG,
  delta: number,
  spreadScale: number,
  dayFactor: number,
  burnoutFactor = 0,
  weatherResponse: FireWeatherResponse | null = null,
  climateIgnitionMultiplier = state.climateIgnitionMultiplier || 1,
  allowIgnitionEvents = true
): number {
  const options: FireKernelStepOptions = {
    delta,
    spreadScale,
    dayFactor,
    burnoutFactor,
    weatherResponse,
    climateIgnitionMultiplier,
    allowIgnitionEvents
  };
  return runFireKernel(state, rng, options, createFireKernelHooks(state, effects)).activeFires;
}

export { igniteRandomFire };
export { resetFireBounds };
