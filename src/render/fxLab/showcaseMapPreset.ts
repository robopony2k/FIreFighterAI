import { TILE_ID_TO_TYPE, TILE_TYPE_IDS, type WorldState } from "../../core/state.js";
import { TREE_TYPE_IDS, type TreeType } from "../../core/types.js";
import {
  FX_LAB_SHOWCASE_MAP_ID,
  FX_LAB_SHOWCASE_SIZE,
  type FxLabShowcaseMapState
} from "./showcaseMap.js";

export const FX_LAB_MAP_PRESET_VERSION = 1;

export type FxLabMapPreset = {
  schemaVersion: 1;
  mapId: typeof FX_LAB_SHOWCASE_MAP_ID;
  cols: number;
  rows: number;
  elevations: number[];
  tileTypes: number[];
  treeTypes: number[];
};

export const createFxLabMapPreset = (world: WorldState, map: FxLabShowcaseMapState): FxLabMapPreset => ({
  schemaVersion: FX_LAB_MAP_PRESET_VERSION,
  mapId: FX_LAB_SHOWCASE_MAP_ID,
  cols: world.grid.cols,
  rows: world.grid.rows,
  elevations: Array.from(world.tileElevation),
  tileTypes: Array.from(world.tileTypeId),
  treeTypes: Array.from(map.treeTypes)
});

const requireNumericArray = (value: unknown, name: string, length: number): number[] => {
  if (!Array.isArray(value) || value.length !== length || value.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    throw new Error(`${name} must contain exactly ${length} finite numbers.`);
  }
  return value;
};

export const parseFxLabMapPreset = (text: string, canonical: FxLabMapPreset, protectedMask: Uint8Array): FxLabMapPreset => {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new Error("Map preset is not valid JSON.");
  }
  if (!input || typeof input !== "object") throw new Error("Map preset must be a JSON object.");
  const value = input as Partial<FxLabMapPreset>;
  if (value.schemaVersion !== FX_LAB_MAP_PRESET_VERSION) throw new Error(`Unsupported map preset version: ${String(value.schemaVersion)}.`);
  if (value.mapId !== FX_LAB_SHOWCASE_MAP_ID) throw new Error(`Unsupported canonical map: ${String(value.mapId)}.`);
  if (value.cols !== FX_LAB_SHOWCASE_SIZE || value.rows !== FX_LAB_SHOWCASE_SIZE) throw new Error("Map preset dimensions must be 72x72.");
  const total = FX_LAB_SHOWCASE_SIZE * FX_LAB_SHOWCASE_SIZE;
  const elevations = requireNumericArray(value.elevations, "elevations", total);
  const tileTypes = requireNumericArray(value.tileTypes, "tileTypes", total);
  const treeTypes = requireNumericArray(value.treeTypes, "treeTypes", total);
  const validTileIds = new Set(Object.values(TILE_TYPE_IDS));
  const validTreeIds = new Set(Object.values(TREE_TYPE_IDS as Record<TreeType, number>));
  for (let i = 0; i < total; i += 1) {
    if (!Number.isInteger(tileTypes[i]) || !validTileIds.has(tileTypes[i]) || !TILE_ID_TO_TYPE[tileTypes[i]]) throw new Error(`Unknown terrain value at tile ${i}.`);
    if (!Number.isInteger(treeTypes[i]) || !validTreeIds.has(treeTypes[i])) throw new Error(`Unknown tree value at tile ${i}.`);
    if (!protectedMask[i] && (elevations[i] < 0.13 || elevations[i] > 0.82)) throw new Error(`Elevation outside editable bounds at tile ${i}.`);
    if (protectedMask[i] && (elevations[i] !== canonical.elevations[i] || tileTypes[i] !== canonical.tileTypes[i] || treeTypes[i] !== canonical.treeTypes[i])) {
      throw new Error(`Preset attempts to modify protected tile ${i}.`);
    }
  }
  return { schemaVersion: 1, mapId: FX_LAB_SHOWCASE_MAP_ID, cols: value.cols, rows: value.rows, elevations, tileTypes, treeTypes };
};

export const formatFxLabMapPreset = (preset: FxLabMapPreset): string => JSON.stringify(preset);
