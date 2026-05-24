import type { WorldState } from "../../../core/state.js";
import type { FireWeatherResponse } from "./fireWeather.js";

export type FireKernelStepOptions = {
  delta: number;
  spreadScale: number;
  dayFactor: number;
  burnoutFactor?: number;
  weatherResponse?: FireWeatherResponse | null;
  climateIgnitionMultiplier?: number;
  allowIgnitionEvents?: boolean;
};

export type FireKernelSmokeEvent = {
  idx: number;
  x: number;
  y: number;
  fireValue: number;
  seed: number;
};

export type FireKernelHouseDamageEvent = {
  idx: number;
  damage01: number;
};

export type FireKernelHouseLossEvent = {
  idx: number;
  x: number;
  y: number;
};

export type FireKernelVegetationBurnoutEvent = {
  idx: number;
};

export type FireKernelHooks = {
  profStart: () => number;
  profEnd: (name: string, start: number) => void;
  ensureFireBlocks: (state: WorldState) => void;
  buildFireWorkBlocks: (state: WorldState) => void;
  finalizeFireBlocks: (state: WorldState) => void;
  markFireBlockNextByTile: (state: WorldState, tileIndex: number) => void;
  resetFireBounds: (state: WorldState) => void;
  emitSmoke: (event: FireKernelSmokeEvent) => void;
  damageHouse: (event: FireKernelHouseDamageEvent) => void;
  destroyHouse: (event: FireKernelHouseLossEvent) => void;
  clearBurnedVegetation: (event: FireKernelVegetationBurnoutEvent) => void;
};

export type FireKernelResult = {
  activeFires: number;
  smokeEvents: number;
  houseDamageEvents: number;
  houseLossEvents: number;
  vegetationBurnoutEvents: number;
};
