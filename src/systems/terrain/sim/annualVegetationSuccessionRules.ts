import { indexFor, inBounds } from "../../../core/grid.js";
import type { WorldState } from "../../../core/state.js";
import type { TileType } from "../../../core/types.js";
import { clamp } from "../../../core/utils.js";
import { hash2D } from "../../../mapgen/noise.js";

export const MIN_ANNUAL_TREE_SUITABILITY = 0.32;
export const MATURE_ANNUAL_WOODY_THRESHOLD = 0.65;
export const ASH_ANNUAL_RECOVERY_CHANCE = 0.65;
export const FIREBREAK_ANNUAL_RECOVERY_CHANCE = 0.12;
export const BARE_ANNUAL_RECOVERY_CHANCE = 0.18;
export const GRASS_SHRUB_BACKGROUND_CHANCE = 0.04;
export const GRASS_SHRUB_PRESSURE_CHANCE = 0.18;
export const SHRUB_FOREST_BACKGROUND_CHANCE = 0.03;
export const SHRUB_FOREST_PRESSURE_CHANCE = 0.27;
export const GRASS_FOREST_PRESSURE_CHANCE = 0.1;

const ANNUAL_ESTABLISHMENT_WINDOWS = 3;
const WOODY_NEIGHBORS = [
  { x: 1, y: 0, weight: 1 },
  { x: -1, y: 0, weight: 1 },
  { x: 0, y: 1, weight: 1 },
  { x: 0, y: -1, weight: 1 },
  { x: 1, y: 1, weight: 0.7 },
  { x: -1, y: -1, weight: 0.7 },
  { x: 1, y: -1, weight: 0.7 },
  { x: -1, y: 1, weight: 0.7 }
] as const;

export type AnnualWoodyPressure = { forest: number; woody: number };

export const isProtectedAnnualVegetationType = (type: TileType): boolean =>
  type === "water" || type === "beach" || type === "rocky" || type === "road" || type === "base" || type === "house";

export const sampleAnnualVegetation = (
  state: WorldState,
  x: number,
  y: number,
  year: number,
  salt: number
): number => hash2D(x + year * 37, y + salt * 53, state.seed + salt * 9973);

export const getAnnualEstablishmentProbability = (chancePerWindow: number): number =>
  1 - Math.pow(1 - clamp(chancePerWindow, 0, 1), ANNUAL_ESTABLISHMENT_WINDOWS);

export const getAnnualWoodyPressure = (
  state: WorldState,
  forestMask: Uint8Array,
  shrubMask: Uint8Array,
  x: number,
  y: number
): AnnualWoodyPressure => {
  let forest = 0;
  let woody = 0;
  for (const neighbor of WOODY_NEIGHBORS) {
    const nx = x + neighbor.x;
    const ny = y + neighbor.y;
    if (!inBounds(state.grid, nx, ny)) continue;
    const idx = indexFor(state.grid, nx, ny);
    const canopy = clamp(state.tiles[idx]?.canopyCover ?? 0, 0, 1);
    if (forestMask[idx] === 1) {
      const contribution = neighbor.weight * canopy;
      forest += contribution;
      woody += contribution;
    } else if (shrubMask[idx] === 1) {
      woody += neighbor.weight * canopy * 0.6;
    }
  }
  return { forest: clamp(forest, 0, 1), woody: clamp(woody, 0, 1) };
};

export const getAnnualNeighborForestType = (
  state: WorldState,
  forestMask: Uint8Array,
  x: number,
  y: number
): WorldState["tiles"][number]["treeType"] => {
  let bestType: WorldState["tiles"][number]["treeType"] = null;
  let bestWeight = 0;
  for (const neighbor of WOODY_NEIGHBORS) {
    const nx = x + neighbor.x;
    const ny = y + neighbor.y;
    if (!inBounds(state.grid, nx, ny)) continue;
    const idx = indexFor(state.grid, nx, ny);
    if (forestMask[idx] !== 1) continue;
    const tile = state.tiles[idx];
    const treeType = tile.treeType ?? tile.dominantTreeType;
    const weight = neighbor.weight * clamp(tile.canopyCover, 0, 1);
    if (treeType && weight > bestWeight) {
      bestType = treeType;
      bestWeight = weight;
    }
  }
  return bestType;
};
