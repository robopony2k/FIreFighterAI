import { TILE_COLOR_RGB } from "../core/config.js";
import { TreeType, type TileType } from "../core/types.js";
import { darken, lighten, mixRgb, type RGB } from "./color.js";

export const FOREST_TONE_BASE = TILE_COLOR_RGB.forest;

export const FOREST_CANOPY_TONES: Record<TreeType, RGB> = {
  [TreeType.Pine]: darken(mixRgb(FOREST_TONE_BASE, { r: 48, g: 80, b: 64 }, 0.35), 0.08),
  [TreeType.Oak]: mixRgb(FOREST_TONE_BASE, { r: 110, g: 118, b: 58 }, 0.35),
  [TreeType.Maple]: mixRgb(FOREST_TONE_BASE, { r: 120, g: 92, b: 62 }, 0.32),
  [TreeType.Birch]: lighten(mixRgb(FOREST_TONE_BASE, { r: 148, g: 152, b: 98 }, 0.42), 0.05),
  [TreeType.Elm]: mixRgb(FOREST_TONE_BASE, { r: 72, g: 122, b: 86 }, 0.3),
  [TreeType.Scrub]: mixRgb(FOREST_TONE_BASE, TILE_COLOR_RGB.scrub, 0.5)
};

type TileLike = {
  type: TileType;
  treeType?: TreeType | null;
  dominantTreeType?: TreeType | null;
};

export const isGrassLikeType = (type: TileType): boolean =>
  type === "grass" || type === "scrub" || type === "floodplain";

export const isVegetationType = (type: TileType): boolean => type === "forest" || isGrassLikeType(type);

export const getForestTreeType = (tile: TileLike): TreeType =>
  tile.treeType ?? tile.dominantTreeType ?? TreeType.Pine;

export const getForestTreeColor = (tile: TileLike): RGB => {
  const treeType = getForestTreeType(tile);
  return FOREST_CANOPY_TONES[treeType] ?? FOREST_TONE_BASE;
};

