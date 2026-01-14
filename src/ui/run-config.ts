import type { CharacterId } from "../core/characters.js";
import type { MapSizeId } from "../core/config.js";

export type RunOptions = {
  unlimitedMoney: boolean;
};

export type NewRunConfig = {
  seed: number;
  mapSize: MapSizeId;
  characterId: CharacterId;
  callsign: string;
  options: RunOptions;
};

export const DEFAULT_RUN_SEED = 1337;
export const DEFAULT_MAP_SIZE: MapSizeId = "medium";
export const DEFAULT_RUN_OPTIONS: RunOptions = { unlimitedMoney: false };
