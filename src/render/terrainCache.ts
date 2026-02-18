
import type { WorldState } from "../core/state.js";
import type { InputState } from "../core/inputState.js";
import type { RenderState } from "./renderState.js";
import { TreeType } from "../core/types.js";
import { inBounds, indexFor } from "../core/grid.js";
import { hash2D } from "../mapgen/noise.js";
import { getHeightAt as getSmoothedHeightAt, getHeightScale, getTileHeight, isoProject } from "./iso.js";
import {
  TILE_SIZE,
  ISO_TILE_WIDTH,
  ISO_TILE_HEIGHT,
  TILE_COLOR_RGB,
  LIGHT_DIR,
  ELEVATION_TINT_LOW,
  ELEVATION_TINT_HIGH,
  DRY_TINT,
  WET_TINT,
} from "../core/config.js";
import { clamp } from "../core/utils.js";
import { rgbString, mixRgb, scaleRgb, lighten, darken, type RGB } from "./color.js";
import {
  FOREST_CANOPY_TONES,
  getForestTreeType,
  getForestTreeColor,
  isGrassLikeType,
  isVegetationType
} from "./vegetationPalette.js";

// Constants
const RENDER_TERRAIN_SIDES = true;
const RENDER_TERRAIN_TREES = true;
const SIDE_SHADE_TOP = 0.88;
const SIDE_SHADE_BOTTOM = 0.58;
const TERRAIN_OUTLINE_ALPHA = 0;
const TERRAIN_CACHE_INTERVAL_MS = 400;
const TERRAIN_PADDING = TILE_SIZE * 6;
const TERRAIN_INTERACTION_COOLDOWN_MS = 120;
const ROAD_WIDTH = TILE_SIZE * 0.45;
const ROAD_EDGE_WIDTH = ROAD_WIDTH + 1.4;
const ROAD_HEIGHT_OFFSET = TILE_SIZE * 0.04;
const ROAD_CENTER_SHIFT = 0.2;
const ROAD_WIDTH_JITTER = 0.12;
const ROAD_VERGE_ALPHA = 0.22;
const ROAD_PAD_SCALE = 1.25;
const SHORE_SAND_DISTANCE = 1;
const SHORE_SAND_ALPHA = 0.45;
const SHORE_SAND_EDGE_ALPHA = 0.2;
const WATER_SURFACE_ALPHA = 0.98;
const SHALLOW_WATER_BLEND = 0.6;

// Types
type TreeStage = "sapling" | "young" | "mature" | "old";

type TreeSprite = {
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  anchorX: number;
  anchorY: number;
};

type TreeSpriteSet = {
  forest: Record<TreeStage, TreeSprite[]>;
  forestByType: Record<TreeType, Record<TreeStage, TreeSprite[]>>;
  grass: Record<TreeStage, TreeSprite[]>;
};

export type TerrainCache = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  originX: number;
  originY: number;
  width: number;
  height: number;
  lastBuild: number;
};

// Module-level state for caches
let treeSprites: TreeSpriteSet | null = null;
let terrainCache: TerrainCache | null = null;
let treeLayerCache: TerrainCache | null = null;
let treeBurnScratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

/**
 * @deprecated Legacy 2D terrain cache path. Prefer the 3D render backend.
 */
export const resetTerrainCaches = (): void => {
  terrainCache = null;
  treeLayerCache = null;
  treeBurnScratch = null;
};

export const getRenderHeightForTile = (tile: WorldState["tiles"][number]): number => {
  return getTileHeight(tile);
};

export const getRenderHeightAt = (state: WorldState, wx: number, wy: number): number => {
  return getSmoothedHeightAt(state, wx, wy);
};

const buildTreeSprite = (
  size: number,
  canopy: RGB,
  trunk: RGB,
  highlight: RGB,
  variant: number,
  layers: number
): TreeSprite => {
  const canopyWidth = size * (0.95 + variant * 0.08);
  const canopyHeight = size * (1.05 + variant * 0.08);
  const trunkWidth = Math.max(2, size * 0.16);
  const trunkHeight = size * 0.38;
  const width = Math.ceil(canopyWidth * 1.4);
  const height = Math.ceil(canopyHeight + trunkHeight + size * 0.25);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported");
  }

  const centerX = width / 2;
  const baseY = height - size * 0.08;

  ctx.save();
  ctx.globalAlpha = 0.18;
  ctx.fillStyle = "rgb(0, 0, 0)";
  ctx.beginPath();
  ctx.ellipse(centerX, baseY + size * 0.08, canopyWidth * 0.28, canopyHeight * 0.14, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const trunkLight = lighten(trunk, 0.12);
  const trunkDark = darken(trunk, 0.2);
  const trunkGrad = ctx.createLinearGradient(centerX - trunkWidth / 2, 0, centerX + trunkWidth / 2, 0);
  trunkGrad.addColorStop(0, rgbString(trunkLight));
  trunkGrad.addColorStop(1, rgbString(trunkDark));
  ctx.fillStyle = trunkGrad;
  ctx.fillRect(centerX - trunkWidth / 2, baseY - trunkHeight, trunkWidth, trunkHeight);

  const drawLayer = (offset: number, scale: number, color: RGB) => {
    const layerHeight = canopyHeight * scale;
    const layerWidth = canopyWidth * scale;
    ctx.fillStyle = rgbString(color);
    ctx.beginPath();
    ctx.moveTo(centerX, baseY - trunkHeight - offset - layerHeight);
    ctx.lineTo(centerX + layerWidth / 2, baseY - trunkHeight - offset);
    ctx.lineTo(centerX - layerWidth / 2, baseY - trunkHeight - offset);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = rgbString(darken(color, 0.18));
    ctx.beginPath();
    ctx.moveTo(centerX, baseY - trunkHeight - offset - layerHeight);
    ctx.lineTo(centerX + layerWidth / 2, baseY - trunkHeight - offset);
    ctx.lineTo(centerX + layerWidth * 0.12, baseY - trunkHeight - offset);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };

  for (let i = 0; i < layers; i += 1) {
    const offset = i * size * 0.18;
    const scale = 1 - i * 0.18;
    drawLayer(offset, scale, canopy);
  }

  ctx.fillStyle = rgbString(highlight);
  ctx.beginPath();
  ctx.moveTo(centerX - canopyWidth * 0.18, baseY - trunkHeight - canopyHeight * 0.82);
  ctx.lineTo(centerX - canopyWidth * 0.02, baseY - trunkHeight - canopyHeight * 0.35);
  ctx.lineTo(centerX - canopyWidth * 0.3, baseY - trunkHeight - canopyHeight * 0.35);
  ctx.closePath();
  ctx.fill();

  return {
    canvas,
    width,
    height,
    anchorX: width / 2,
    anchorY: height - size * 0.08,
  };
};

const buildTreeSpriteSet = (baseColor: RGB, trunkColor: RGB): Record<TreeStage, TreeSprite[]> => {
  const stages: { id: TreeStage; size: number; tone: number; layers: number }[] = [
    { id: "sapling", size: TILE_SIZE * 0.55, tone: 0.22, layers: 1 },
    { id: "young", size: TILE_SIZE * 0.75, tone: 0.12, layers: 2 },
    { id: "mature", size: TILE_SIZE * 0.95, tone: 0.04, layers: 2 },
    { id: "old", size: TILE_SIZE * 1.1, tone: -0.08, layers: 3 },
  ];
  const result: Record<TreeStage, TreeSprite[]> = {
    sapling: [],
    young: [],
    mature: [],
    old: [],
  };
  stages.forEach((stage) => {
    for (let variant = 0; variant < 3; variant += 1) {
      const tone = stage.tone + variant * 0.02;
      const canopy = tone >= 0 ? lighten(baseColor, tone) : darken(baseColor, Math.abs(tone));
      const highlight = lighten(canopy, 0.18);
      result[stage.id].push(buildTreeSprite(stage.size, canopy, trunkColor, highlight, variant, stage.layers));
    }
  });
  return result;
};

const ensureTreeSprites = (): TreeSpriteSet => {
  if (treeSprites) {
    return treeSprites;
  }
  const trunkColor = { r: 73, g: 54, b: 38 };
  const forestByType: Record<TreeType, Record<TreeStage, TreeSprite[]>> = {
    [TreeType.Pine]: buildTreeSpriteSet(FOREST_CANOPY_TONES[TreeType.Pine], trunkColor),
    [TreeType.Oak]: buildTreeSpriteSet(FOREST_CANOPY_TONES[TreeType.Oak], trunkColor),
    [TreeType.Maple]: buildTreeSpriteSet(FOREST_CANOPY_TONES[TreeType.Maple], trunkColor),
    [TreeType.Birch]: buildTreeSpriteSet(FOREST_CANOPY_TONES[TreeType.Birch], trunkColor),
    [TreeType.Elm]: buildTreeSpriteSet(FOREST_CANOPY_TONES[TreeType.Elm], trunkColor),
    [TreeType.Scrub]: buildTreeSpriteSet(FOREST_CANOPY_TONES[TreeType.Scrub], trunkColor)
  };
  treeSprites = {
    forest: buildTreeSpriteSet(TILE_COLOR_RGB.forest, trunkColor),
    forestByType,
    grass: buildTreeSpriteSet(TILE_COLOR_RGB.grass, trunkColor),
  };
  return treeSprites;
};

const ensureTreeBurnScratch = (width: number, height: number) => {
  if (!treeBurnScratch) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas not supported");
    }
    treeBurnScratch = { canvas, ctx };
  }
  if (treeBurnScratch.canvas.width !== width || treeBurnScratch.canvas.height !== height) {
    treeBurnScratch.canvas.width = width;
    treeBurnScratch.canvas.height = height;
  } else {
    treeBurnScratch.ctx.setTransform(1, 0, 0, 1, 0, 0);
    treeBurnScratch.ctx.clearRect(0, 0, width, height);
  }
  return treeBurnScratch;
};

const getBaseTileColor = (state: WorldState, tile: WorldState["tiles"][number]): RGB => {
  if (isGrassLikeType(tile.type) && tile.fire > 0) {
    return TILE_COLOR_RGB.ON_FIRE_GRASS;
  }
  if (tile.type === "forest" && tile.fire > 0) {
    return darken(getForestTreeColor(tile), 0.2);
  }
  if (isVegetationType(tile.type)) {
    const canopy = clamp(tile.canopyCover ?? tile.canopy, 0, 1);
    const base = tile.type === "forest" ? TILE_COLOR_RGB.grass : TILE_COLOR_RGB[tile.type] ?? TILE_COLOR_RGB.grass;
    const forestTone = tile.type === "forest" ? getForestTreeColor(tile) : TILE_COLOR_RGB.forest;
    return mixRgb(base, forestTone, canopy);
  }
  return TILE_COLOR_RGB[tile.type] ?? TILE_COLOR_RGB.grass;
};

const getRoadbedColor = (state: WorldState, x: number, y: number): RGB => {
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ];
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  neighbors.forEach((pos) => {
    if (!inBounds(state.grid, pos.x, pos.y)) {
      return;
    }
    const neighbor = state.tiles[indexFor(state.grid, pos.x, pos.y)];
    if (neighbor.type === "water" || neighbor.type === "road" || neighbor.type === "base") {
      return;
    }
    const base = getBaseTileColor(state, neighbor);
    sumR += base.r;
    sumG += base.g;
    sumB += base.b;
    count += 1;
  });
  if (count > 0) {
    return { r: sumR / count, g: sumG / count, b: sumB / count };
  }
  const noise = clamp(state.colorNoiseMap[indexFor(state.grid, x, y)], 0, 1);
  return mixRgb(TILE_COLOR_RGB.grass, TILE_COLOR_RGB.forest, 0.3 + noise * 0.4);
};

const getWaterEdgeBaseColor = (state: WorldState, x: number, y: number): RGB => {
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ];
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let count = 0;
  neighbors.forEach((pos) => {
    if (!inBounds(state.grid, pos.x, pos.y)) {
      return;
    }
    const neighbor = state.tiles[indexFor(state.grid, pos.x, pos.y)];
    if (neighbor.type === "water") {
      return;
    }
    const base = getBaseTileColor(state, neighbor);
    sumR += base.r;
    sumG += base.g;
    sumB += base.b;
    count += 1;
  });
  if (count === 0) {
    return TILE_COLOR_RGB.water;
  }
  const landColor = { r: sumR / count, g: sumG / count, b: sumB / count };
  const sandBlend = mixRgb(landColor, SAND_COLOR, 0.4);
  const blendStrength = clamp(count / 4, 0, 1);
  const shallow = mixRgb(SHALLOW_WATER_COLOR, sandBlend, 0.35);
  return mixRgb(TILE_COLOR_RGB.water, shallow, 0.25 + blendStrength * 0.35);
};

const getWaterLandInfluence = (state: WorldState, x: number, y: number): number => {
  const neighbors = [
    { x: x + 1, y, w: 1 },
    { x: x - 1, y, w: 1 },
    { x, y: y + 1, w: 1 },
    { x, y: y - 1, w: 1 },
    { x: x + 1, y: y + 1, w: 0.7 },
    { x: x + 1, y: y - 1, w: 0.7 },
    { x: x - 1, y: y + 1, w: 0.7 },
    { x: x - 1, y: y - 1, w: 0.7 }
  ];
  let landWeight = 0;
  let totalWeight = 0;
  neighbors.forEach((pos) => {
    totalWeight += pos.w;
    if (!inBounds(state.grid, pos.x, pos.y)) {
      landWeight += pos.w;
      return;
    }
    const neighbor = state.tiles[indexFor(state.grid, pos.x, pos.y)];
    if (neighbor.type !== "water") {
      landWeight += pos.w;
    }
  });
  if (totalWeight <= 0) {
    return 0;
  }
  return clamp(landWeight / totalWeight, 0, 1);
};

const getSmoothedWaterInfluence = (state: WorldState, x: number, y: number): number => {
  let sum = getWaterLandInfluence(state, x, y);
  let count = 1;
  const cardinals = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ];
  cardinals.forEach((pos) => {
    if (!inBounds(state.grid, pos.x, pos.y)) {
      return;
    }
    const neighbor = state.tiles[indexFor(state.grid, pos.x, pos.y)];
    if (neighbor.type !== "water") {
      return;
    }
    sum += getWaterLandInfluence(state, pos.x, pos.y);
    count += 1;
  });
  return clamp(sum / count, 0, 1);
};

const shadeTileColor = (
  state: WorldState,
  tile: WorldState["tiles"][number],
  x: number,
  y: number,
  debugTypeColors: boolean,
  baseOverride?: RGB
) => {
  const elev = tile.type === "water" ? 0 : tile.elevation;
  
  if (debugTypeColors) {
    return TILE_COLOR_RGB[tile.type] ?? TILE_COLOR_RGB.grass;
  }

  let base: RGB;
  if (baseOverride) {
    base = baseOverride;
  } else {
    base = getBaseTileColor(state, tile);
  }
  if (!baseOverride && tile.type !== "water" && tile.type !== "house") {
    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    ];
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    neighbors.forEach((pos) => {
      if (!inBounds(state.grid, pos.x, pos.y)) {
        return;
      }
      const neighbor = state.tiles[indexFor(state.grid, pos.x, pos.y)];
      if (neighbor.type === "water" || neighbor.type === "road" || neighbor.type === "base" || neighbor.type === "house") {
        return;
      }
      const neighborBase = getBaseTileColor(state, neighbor);
      sumR += neighborBase.r;
      sumG += neighborBase.g;
      sumB += neighborBase.b;
      count += 1;
    });
    if (count > 0) {
      const neighborAvg = { r: sumR / count, g: sumG / count, b: sumB / count };
      base = mixRgb(base, neighborAvg, 0.12);
    }
  }

  const sampleElev = (nx: number, ny: number): number => {
    if (!inBounds(state.grid, nx, ny)) {
      return elev;
    }
    const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
    return neighbor.type === "water" ? 0 : neighbor.elevation;
  };
  const left = sampleElev(x - 1, y);
  const right = sampleElev(x + 1, y);
  const up = sampleElev(x, y - 1);
  const down = sampleElev(x, y + 1);
  const dx = right - left;
  const dy = down - up;
  const slope = dx * LIGHT_DIR.x + dy * LIGHT_DIR.y;
  const avg = (left + right + up + down) * 0.25;
  const relief = clamp((elev - avg) * 1.35, -0.2, 0.2);
  const isWater = tile.type === "water";
  const heightBoost = isWater ? 1 : 0.9 + elev * 0.24;
  const shade = isWater ? 1 : clamp(heightBoost * (0.96 + slope * 0.7) * (1 + relief * 0.5), 0.7, 1.18);
  const tintAmount = isWater ? 0.03 : 0.12 + elev * 0.22;
  const tint = {
    r: ELEVATION_TINT_LOW.r + (ELEVATION_TINT_HIGH.r - ELEVATION_TINT_LOW.r) * elev,
    g: ELEVATION_TINT_LOW.g + (ELEVATION_TINT_HIGH.g - ELEVATION_TINT_LOW.g) * elev,
    b: ELEVATION_TINT_LOW.b + (ELEVATION_TINT_HIGH.b - ELEVATION_TINT_LOW.b) * elev,
  };

  let mixed = mixRgb(base, tint, tintAmount);
  if (isVegetationType(tile.type)) {
    const moistureTint = mixRgb(DRY_TINT, WET_TINT, clamp(tile.moisture, 0, 1));
    const moistureAmount = 0.12 + tile.moisture * 0.18;
    mixed = mixRgb(mixed, moistureTint, moistureAmount);
  } else if (baseOverride) {
    const moistureTint = mixRgb(DRY_TINT, WET_TINT, clamp(tile.moisture, 0, 1));
    const moistureAmount = 0.06 + tile.moisture * 0.08;
    mixed = mixRgb(mixed, moistureTint, moistureAmount);
  }
  const noise = state.colorNoiseMap[indexFor(state.grid, x, y)];
  const noiseShift = (noise - 0.5) * (isWater ? 0.02 : 0.05);
  const noiseShade = 1 + noiseShift;

  return {
    r: clamp(mixed.r * shade * noiseShade, 0, 255),
    g: clamp(mixed.g * shade * noiseShade, 0, 255),
    b: clamp(mixed.b * shade * noiseShade, 0, 255),
  };
};

const drawRampSide = (
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  heightTop1: number,
  heightTop2: number,
  heightBottom1: number,
  heightBottom2: number,
  topColor: { r: number; g: number; b: number }
) => {
  const top = Math.max(heightTop1, heightTop2);
  const bottom = Math.max(heightBottom1, heightBottom2);
  if (top - bottom <= 0.1) {
    return;
  }
  const up1 = isoProject(x1, y1, heightTop1);
  const up2 = isoProject(x2, y2, heightTop2);
  const low1 = isoProject(x1, y1, heightBottom1);
  const low2 = isoProject(x2, y2, heightBottom2);
  const grad = ctx.createLinearGradient(
    (up1.x + up2.x) * 0.5,
    (up1.y + up2.y) * 0.5,
    (low1.x + low2.x) * 0.5,
    (low1.y + low2.y) * 0.5
  );
  grad.addColorStop(0, rgbString(scaleRgb(topColor, SIDE_SHADE_TOP)));
  grad.addColorStop(1, rgbString(scaleRgb(topColor, SIDE_SHADE_BOTTOM)));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(up1.x, up1.y);
  ctx.lineTo(up2.x, up2.y);
  ctx.lineTo(low2.x, low2.y);
  ctx.lineTo(low1.x, low1.y);
  ctx.closePath();
  ctx.fill();
};

const tileSeed = (state: WorldState, x: number, y: number, offset: number) =>
  hash2D(x + offset * 31, y + offset * 57, state.seed + offset * 131);

const drawTreesOnTile = (
  state: WorldState,
  context: CanvasRenderingContext2D,
  tile: WorldState["tiles"][number],
  x: number,
  y: number,
  height: number,
  detail: number
) => {
  if (!isVegetationType(tile.type)) {
    return;
  }
  const detailFactor = clamp(detail, 0, 1);
  if (detailFactor <= 0.05) {
    return;
  }
  const canopy = clamp(tile.canopyCover ?? tile.canopy, 0, 1);
  const grassLike = isGrassLikeType(tile.type);
  if (grassLike && canopy < 0.12) {
    return;
  }
  const stage: TreeStage =
    canopy < 0.28 ? "sapling" : canopy < 0.45 ? "young" : canopy < 0.7 ? "mature" : "old";
  let count = 0;
  if (tile.type === "forest") {
    const stemDensity = Math.max(0, Math.round(tile.stemDensity ?? 0));
    const baseCount = Math.round(stemDensity * (0.6 + detailFactor * 0.4));
    const jitter = Math.round((tileSeed(state, x, y, 2) - 0.5) * 2);
    count = clamp(baseCount + jitter, 0, stemDensity);
  } else {
    const densityBase = 0.12 + canopy * 0.35;
    const density = densityBase * (0.55 + detailFactor * 0.45);
    if (tileSeed(state, x, y, 1) > density) {
      return;
    }
    const maxCount = 2;
    const rawCount = Math.floor(tileSeed(state, x, y, 2) * (maxCount + 1));
    count = Math.round(rawCount * (0.6 + detailFactor * 0.4));
  }
  if (count <= 0) {
    return;
  }
  const spriteSet = ensureTreeSprites();
  const sprites =
    tile.type === "forest"
      ? (spriteSet.forestByType[getForestTreeType(tile)] ?? spriteSet.forest)[stage]
      : spriteSet.grass[stage];

  for (let i = 0; i < count; i += 1) {
    const jitterX = (tileSeed(state, x, y, 10 + i) - 0.5) * 0.45;
    const jitterY = (tileSeed(state, x, y, 20 + i) - 0.5) * 0.45;
    const sprite = sprites[Math.floor(tileSeed(state, x, y, 30 + i) * sprites.length)];
    const scale = 0.9 + canopy * 0.15 + tileSeed(state, x, y, 40 + i) * 0.12;
    const rotation = (tileSeed(state, x, y, 50 + i) - 0.5) * 0.35;
    const base = isoProject(x + 0.5 + jitterX, y + 0.5 + jitterY, height + TILE_SIZE * 0.05);
    const width = sprite.width * scale;
    const heightPx = sprite.height * scale;
    const drawImage = (image: HTMLCanvasElement) => {
      if (Math.abs(rotation) > 0.001) {
        context.save();
        context.translate(base.x, base.y);
        context.rotate(rotation);
        context.drawImage(
          image,
          -sprite.anchorX * scale,
          -sprite.anchorY * scale,
          width,
          heightPx
        );
        context.restore();
        return;
      }
      const drawX = base.x - sprite.anchorX * scale;
      const drawY = base.y - sprite.anchorY * scale;
      context.drawImage(image, drawX, drawY, width, heightPx);
    };
    if (tile.fire > 0 && tile.fuel < 1) {
      const scratch = ensureTreeBurnScratch(sprite.width, sprite.height);
      scratch.ctx.drawImage(sprite.canvas, 0, 0);
      scratch.ctx.globalCompositeOperation = "source-atop";
      scratch.ctx.fillStyle = "rgba(0, 0, 0, 0.35)";
      scratch.ctx.fillRect(0, 0, sprite.width, sprite.height);
      scratch.ctx.globalCompositeOperation = "destination-out";
      const burnHeight = sprite.height * (1 - tile.fuel);
      scratch.ctx.fillRect(0, 0, sprite.width, burnHeight);
      scratch.ctx.globalCompositeOperation = "source-over";
      drawImage(scratch.canvas);
    } else {
      drawImage(sprite.canvas);
    }
  }
};

const ROAD_CORE_COLOR = lighten(TILE_COLOR_RGB.road, 0.08);
const ROAD_VERGE_COLOR = mixRgb(TILE_COLOR_RGB.firebreak, TILE_COLOR_RGB.grass, 0.6);
const SAND_COLOR = lighten(TILE_COLOR_RGB.firebreak, 0.08);
const SHALLOW_WATER_COLOR = mixRgb(TILE_COLOR_RGB.water, TILE_COLOR_RGB.grass, 0.22);

const isRoadTile = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const type = state.tiles[indexFor(state.grid, x, y)].type;
  return type === "road" || type === "base";
};

const isRoadAdjacent = (state: WorldState, x: number, y: number): boolean => {
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      if (isRoadTile(state, x + dx, y + dy)) {
        return true;
      }
    }
  }
  return false;
};

const getRoadFlow = (state: WorldState, x: number, y: number): { dx: number; dy: number; count: number } => {
  const dirs = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
    { dx: 1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },
    { dx: -1, dy: -1 }
  ];
  let dx = 0;
  let dy = 0;
  let count = 0;
  dirs.forEach((dir) => {
    if (isRoadTile(state, x + dir.dx, y + dir.dy)) {
      dx += dir.dx;
      dy += dir.dy;
      count += 1;
    }
  });
  return { dx, dy, count };
};

const getRoadAnchor = (state: WorldState, x: number, y: number, heightValue?: number) => {
  const height =
    typeof heightValue === "number" ? heightValue : getSmoothedHeightAt(state, x + 0.5, y + 0.5);
  const flow = getRoadFlow(state, x, y);
  let offsetX = 0;
  let offsetY = 0;
  if (flow.count > 0) {
    const len = Math.hypot(flow.dx, flow.dy);
    if (len > 0) {
      let shift = ROAD_CENTER_SHIFT;
      if (flow.count === 2 && flow.dx !== 0 && flow.dy !== 0) {
        shift *= 1.45;
      }
      if (flow.count >= 3) {
        shift *= 0.45;
      }
      offsetX = (flow.dx / len) * shift;
      offsetY = (flow.dy / len) * shift;
    }
  }
  return isoProject(x + 0.5 + offsetX, y + 0.5 + offsetY, height + ROAD_HEIGHT_OFFSET);
};

const drawRoadOverlay = (
  state: WorldState,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heightValue: number
): void => {
  const center = getRoadAnchor(state, x, y, heightValue);
  const neighbors: Array<{
    dir: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
    pos: { x: number; y: number };
    height: number;
  }> = [];
  const addNeighbor = (dir: "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw", nx: number, ny: number) => {
    if (!isRoadTile(state, nx, ny)) {
      return;
    }
    neighbors.push({ dir, pos: getRoadAnchor(state, nx, ny), height: getSmoothedHeightAt(state, nx + 0.5, ny + 0.5) });
  };
  addNeighbor("n", x, y - 1);
  addNeighbor("s", x, y + 1);
  addNeighbor("e", x + 1, y);
  addNeighbor("w", x - 1, y);
  addNeighbor("ne", x + 1, y - 1);
  addNeighbor("nw", x - 1, y - 1);
  addNeighbor("se", x + 1, y + 1);
  addNeighbor("sw", x - 1, y + 1);

  const isOpposite = (a: string, b: string) =>
    (a === "n" && b === "s") ||
    (a === "s" && b === "n") ||
    (a === "e" && b === "w") ||
    (a === "w" && b === "e") ||
    (a === "ne" && b === "sw") ||
    (a === "sw" && b === "ne") ||
    (a === "nw" && b === "se") ||
    (a === "se" && b === "nw");

  const cardinals = neighbors.filter((neighbor) => ["n", "s", "e", "w"].includes(neighbor.dir));
  const diagonals = neighbors.filter((neighbor) => ["ne", "nw", "se", "sw"].includes(neighbor.dir));
  let activeNeighbors = neighbors;
  if (neighbors.length > 2) {
    if (cardinals.length >= 2) {
      activeNeighbors = cardinals;
    } else if (cardinals.length === 1 && diagonals.length > 0) {
      const flow = getRoadFlow(state, x, y);
      const len = Math.hypot(flow.dx, flow.dy);
      let best = diagonals[0];
      if (len > 0) {
        const fx = flow.dx / len;
        const fy = flow.dy / len;
        let bestDot = -Infinity;
        diagonals.forEach((diag) => {
          const dir =
            diag.dir === "ne"
              ? { x: 1, y: -1 }
              : diag.dir === "nw"
              ? { x: -1, y: -1 }
              : diag.dir === "se"
              ? { x: 1, y: 1 }
              : { x: -1, y: 1 };
          const dLen = Math.hypot(dir.x, dir.y) || 1;
          const dot = (dir.x / dLen) * fx + (dir.y / dLen) * fy;
          if (dot > bestDot) {
            bestDot = dot;
            best = diag;
          }
        });
      }
      activeNeighbors = [cardinals[0], best];
    }
  }

  const baseHeight = heightValue;
  const avgNeighborHeight =
    activeNeighbors.length > 0
      ? activeNeighbors.reduce((sum, neighbor) => sum + neighbor.height, 0) / activeNeighbors.length
      : baseHeight;
  const slope = clamp((avgNeighborHeight - baseHeight) / (TILE_SIZE * 0.6), -0.2, 0.2);
  const slopeAmount = Math.min(Math.abs(slope) * 0.7, 0.2);
  const isCurve = activeNeighbors.length === 2 && !isOpposite(activeNeighbors[0].dir, activeNeighbors[1].dir);
  const curveLight = !Number.isNaN(slope) && slope < 0 && isCurve ? 0.06 : 0;
  const widthNoise = tileSeed(state, x, y, 61) - 0.5;
  const widthScale = 1 + widthNoise * ROAD_WIDTH_JITTER;

  const renderRoad = (color: RGB, width: number, extraLight = 0) => {
    const adjusted =
      slope > 0 ? darken(color, slopeAmount) : lighten(color, Math.max(0, slopeAmount * 0.6 + extraLight));
    ctx.strokeStyle = rgbString(adjusted);
    ctx.lineWidth = width * widthScale;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (activeNeighbors.length === 0) {
      ctx.fillStyle = rgbString(adjusted);
      ctx.beginPath();
      ctx.arc(center.x, center.y, Math.max(1.2, width * 0.28 * widthScale), 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (activeNeighbors.length === 1) {
      ctx.beginPath();
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(activeNeighbors[0].pos.x, activeNeighbors[0].pos.y);
      ctx.stroke();
      return;
    }
    if (activeNeighbors.length === 2) {
      const [a, b] = activeNeighbors;
      ctx.beginPath();
      if (isOpposite(a.dir, b.dir)) {
        ctx.moveTo(a.pos.x, a.pos.y);
        ctx.lineTo(b.pos.x, b.pos.y);
      } else {
        ctx.moveTo(a.pos.x, a.pos.y);
        ctx.quadraticCurveTo(center.x, center.y, b.pos.x, b.pos.y);
      }
      ctx.stroke();
      return;
    }
    ctx.beginPath();
    activeNeighbors.forEach((neighbor) => {
      ctx.moveTo(center.x, center.y);
      ctx.lineTo(neighbor.pos.x, neighbor.pos.y);
    });
    ctx.stroke();
  };

  if (activeNeighbors.length >= 3) {
    const padSize = ROAD_EDGE_WIDTH * widthScale * ROAD_PAD_SCALE;
    const padTone =
      slope > 0 ? darken(ROAD_CORE_COLOR, slopeAmount * 0.6) : lighten(ROAD_CORE_COLOR, slopeAmount * 0.3 + curveLight);
    ctx.fillStyle = rgbString(padTone);
    ctx.beginPath();
    ctx.arc(center.x, center.y, padSize * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgbString(lighten(padTone, 0.06));
    ctx.beginPath();
    ctx.arc(center.x, center.y, padSize * 0.38, 0, Math.PI * 2);
    ctx.fill();
  }

  renderRoad(ROAD_CORE_COLOR, ROAD_WIDTH, curveLight);
};

const drawBaseOnTile = (
  state: WorldState,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  heightValue: number
): void => {
  const baseColor = TILE_COLOR_RGB.base;
  const padTop = lighten(baseColor, 0.12);
  const padSideLight = lighten(baseColor, 0.04);
  const padSideDark = darken(baseColor, 0.24);
  const padInset = 0.05;
  const padHeight = TILE_SIZE * 0.08;
  const padZ = heightValue + TILE_SIZE * 0.02;

  const drawBox = (inset: number, height: number, top: RGB, sideLight: RGB, sideDark: RGB, z: number) => {
    const baseNW = isoProject(x + inset, y + inset, z);
    const baseNE = isoProject(x + 1 - inset, y + inset, z);
    const baseSE = isoProject(x + 1 - inset, y + 1 - inset, z);
    const baseSW = isoProject(x + inset, y + 1 - inset, z);
    const topZ = z + height;
    const topNW = isoProject(x + inset, y + inset, topZ);
    const topNE = isoProject(x + 1 - inset, y + inset, topZ);
    const topSE = isoProject(x + 1 - inset, y + 1 - inset, topZ);
    const topSW = isoProject(x + inset, y + 1 - inset, topZ);

    ctx.fillStyle = rgbString(sideLight);
    ctx.beginPath();
    ctx.moveTo(topNE.x, topNE.y);
    ctx.lineTo(topSE.x, topSE.y);
    ctx.lineTo(baseSE.x, baseSE.y);
    ctx.lineTo(baseNE.x, baseNE.y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = rgbString(sideDark);
    ctx.beginPath();
    ctx.moveTo(topSE.x, topSE.y);
    ctx.lineTo(topSW.x, topSW.y);
    ctx.lineTo(baseSW.x, baseSW.y);
    ctx.lineTo(baseSE.x, baseSE.y);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = rgbString(top);
    ctx.beginPath();
    ctx.moveTo(topNW.x, topNW.y);
    ctx.lineTo(topNE.x, topNE.y);
    ctx.lineTo(topSE.x, topSE.y);
    ctx.lineTo(topSW.x, topSW.y);
    ctx.closePath();
    ctx.fill();
  };

  drawBox(padInset, padHeight, padTop, padSideLight, padSideDark, padZ);

  const dist = Math.abs(x - state.basePoint.x) + Math.abs(y - state.basePoint.y);
  const seed = tileSeed(state, x, y, 143);
  const buildingZ = padZ + padHeight;

  if (dist === 0) {
    const mainInset = 0.18;
    const mainHeight = TILE_SIZE * 0.52;
    const mainTop = lighten(baseColor, 0.2);
    const mainSideLight = lighten(baseColor, 0.06);
    const mainSideDark = darken(baseColor, 0.28);
    drawBox(mainInset, mainHeight, mainTop, mainSideLight, mainSideDark, buildingZ);

    const roofInset = mainInset + 0.08;
    const roofHeight = TILE_SIZE * 0.05;
    const roofTop = lighten(baseColor, 0.28);
    drawBox(roofInset, roofHeight, roofTop, lighten(baseColor, 0.14), darken(baseColor, 0.18), buildingZ + mainHeight);
  } else if (dist <= 1 && seed > 0.45) {
    const shedInset = clamp(0.28 + (seed - 0.45) * 0.18, 0.26, 0.42);
    const shedHeight = TILE_SIZE * (0.22 + (seed - 0.45) * 0.16);
    const shedTop = lighten(baseColor, 0.18);
    drawBox(shedInset, shedHeight, shedTop, lighten(baseColor, 0.05), darken(baseColor, 0.24), buildingZ);
  }
};

const drawHouseOnTile = (
  state: WorldState,
  ctx: CanvasRenderingContext2D,
  tile: WorldState["tiles"][number],
  x: number,
  y: number,
  heightValue: number
): void => {
  const seedA = tileSeed(state, x, y, 81);
  const seedB = tileSeed(state, x, y, 97);
  const seedC = tileSeed(state, x, y, 113);
  const baseInset = 0.16 + seedA * 0.08;
  const roofInset = clamp(baseInset + 0.06 + seedB * 0.05, baseInset + 0.04, 0.38);
  const heightScale = tile.houseDestroyed ? 0.65 : 1;
  const wallHeight = TILE_SIZE * (0.26 + seedB * 0.18) * heightScale;
  const roofHeight = TILE_SIZE * (0.14 + seedC * 0.1) * heightScale;
  const baseZ = heightValue + TILE_SIZE * 0.04;
  const roofBaseZ = baseZ + wallHeight;
  const roofTopZ = roofBaseZ + roofHeight;

  const baseNW = isoProject(x + baseInset, y + baseInset, baseZ);
  const baseNE = isoProject(x + 1 - baseInset, y + baseInset, baseZ);
  const baseSE = isoProject(x + 1 - baseInset, y + 1 - baseInset, baseZ);
  const baseSW = isoProject(x + baseInset, y + 1 - baseInset, baseZ);

  const topNW = isoProject(x + baseInset, y + baseInset, roofBaseZ);
  const topNE = isoProject(x + 1 - baseInset, y + baseInset, roofBaseZ);
  const topSE = isoProject(x + 1 - baseInset, y + 1 - baseInset, roofBaseZ);
  const topSW = isoProject(x + baseInset, y + 1 - baseInset, roofBaseZ);

  const roofNW = isoProject(x + roofInset, y + roofInset, roofTopZ);
  const roofNE = isoProject(x + 1 - roofInset, y + roofInset, roofTopZ);
  const roofSE = isoProject(x + 1 - roofInset, y + 1 - roofInset, roofTopZ);
  const roofSW = isoProject(x + roofInset, y + 1 - roofInset, roofTopZ);

  const baseColor = tile.houseDestroyed ? mixRgb(TILE_COLOR_RGB.ash, TILE_COLOR_RGB.house, 0.2) : TILE_COLOR_RGB.house;
  const wallLight = lighten(baseColor, tile.houseDestroyed ? 0.04 : 0.12);
  const wallDark = darken(baseColor, tile.houseDestroyed ? 0.24 : 0.18);
  const roofBase = tile.houseDestroyed ? darken(baseColor, 0.3) : darken(baseColor, 0.08);
  const roofLight = lighten(roofBase, tile.houseDestroyed ? 0.02 : 0.09);
  const roofDark = darken(roofBase, tile.houseDestroyed ? 0.12 : 0.22);
  const roofTop = lighten(roofBase, tile.houseDestroyed ? 0.05 : 0.14);

  ctx.fillStyle = rgbString(wallLight);
  ctx.beginPath();
  ctx.moveTo(topNE.x, topNE.y);
  ctx.lineTo(topSE.x, topSE.y);
  ctx.lineTo(baseSE.x, baseSE.y);
  ctx.lineTo(baseNE.x, baseNE.y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgbString(wallDark);
  ctx.beginPath();
  ctx.moveTo(topSE.x, topSE.y);
  ctx.lineTo(topSW.x, topSW.y);
  ctx.lineTo(baseSW.x, baseSW.y);
  ctx.lineTo(baseSE.x, baseSE.y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgbString(roofLight);
  ctx.beginPath();
  ctx.moveTo(topNE.x, topNE.y);
  ctx.lineTo(topSE.x, topSE.y);
  ctx.lineTo(roofSE.x, roofSE.y);
  ctx.lineTo(roofNE.x, roofNE.y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgbString(roofDark);
  ctx.beginPath();
  ctx.moveTo(topSE.x, topSE.y);
  ctx.lineTo(topSW.x, topSW.y);
  ctx.lineTo(roofSW.x, roofSW.y);
  ctx.lineTo(roofSE.x, roofSE.y);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = rgbString(roofTop);
  ctx.beginPath();
  ctx.moveTo(roofNW.x, roofNW.y);
  ctx.lineTo(roofNE.x, roofNE.y);
  ctx.lineTo(roofSE.x, roofSE.y);
  ctx.lineTo(roofSW.x, roofSW.y);
  ctx.closePath();
  ctx.fill();
};

/**
 * @deprecated Legacy 2D terrain cache path. Prefer the 3D render backend.
 */
export const ensureTerrainCache = (state: WorldState, inputState: InputState, now: number): TerrainCache => {
  const { cols, rows } = state.grid;
  const maxHeight = getHeightScale(state);
  const originX = -rows * ISO_TILE_WIDTH * 0.5 - TERRAIN_PADDING;
  const originY = -maxHeight - TERRAIN_PADDING;
  const width = (cols + rows) * ISO_TILE_WIDTH * 0.5 + TERRAIN_PADDING * 2;
  const height = (cols + rows) * ISO_TILE_HEIGHT * 0.5 + maxHeight + TERRAIN_PADDING * 2;
  const timeReady = !terrainCache || now - terrainCache.lastBuild > TERRAIN_CACHE_INTERVAL_MS;
  const interactionCooldown = now - inputState.lastInteractionTime < TERRAIN_INTERACTION_COOLDOWN_MS;
  const needsRebuild =
    !terrainCache ||
    terrainCache.width !== Math.ceil(width) ||
    terrainCache.height !== Math.ceil(height) ||
    (state.terrainDirty && timeReady && !interactionCooldown);

  if (!terrainCache) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas not supported");
    }
    terrainCache = {
      canvas,
      ctx,
      originX,
      originY,
      width: Math.ceil(width),
      height: Math.ceil(height),
      lastBuild: 0,
    };
  }

  if (needsRebuild) {
    terrainCache.originX = originX;
    terrainCache.originY = originY;
    terrainCache.width = Math.ceil(width);
    terrainCache.height = Math.ceil(height);
    terrainCache.canvas.width = terrainCache.width;
    terrainCache.canvas.height = terrainCache.height;
    const ctx = terrainCache.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, terrainCache.width, terrainCache.height);
    ctx.setTransform(1, 0, 0, 1, -originX, -originY);

    for (let sum = 0; sum <= cols + rows - 2; sum += 1) {
      for (let x = 0; x < cols; x += 1) {
        const y = sum - x;
        if (y < 0 || y >= rows) {
          continue;
        }
        const tileIndex = indexFor(state.grid, x, y);
        const tile = state.tiles[tileIndex];
        const h00 = getSmoothedHeightAt(state, x, y);
        const h10 = getSmoothedHeightAt(state, x + 1, y);
        const h11 = getSmoothedHeightAt(state, x + 1, y + 1);
        const h01 = getSmoothedHeightAt(state, x, y + 1);
        const heightValue = (h00 + h10 + h11 + h01) * 0.25;
        let baseOverride: RGB | undefined;
        if (tile.type === "road") {
          baseOverride = getRoadbedColor(state, x, y);
        } else if (tile.type === "water") {
          baseOverride = getWaterEdgeBaseColor(state, x, y);
        } else if (tile.type === "house" || tile.type === "base") {
          baseOverride = TILE_COLOR_RGB.grass;
        }
        const top = shadeTileColor(state, tile, x, y, inputState.debugTypeColors, baseOverride);
        const p0 = isoProject(x, y, h00);
        const p1 = isoProject(x + 1, y, h10);
        const p2 = isoProject(x + 1, y + 1, h11);
        const p3 = isoProject(x, y + 1, h01);

        if (RENDER_TERRAIN_SIDES) {
          if (x === cols - 1) {
            const baseHeight = Math.min(0, Math.min(h10, h11));
            drawRampSide(ctx, x + 1, y, x + 1, y + 1, h10, h11, baseHeight, baseHeight, top);
          }
          if (y === rows - 1) {
            const baseHeight = Math.min(0, Math.min(h01, h11));
            drawRampSide(ctx, x, y + 1, x + 1, y + 1, h01, h11, baseHeight, baseHeight, top);
          }
        }

        ctx.fillStyle = rgbString(top);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.closePath();
        ctx.fill();
        if (TERRAIN_OUTLINE_ALPHA > 0) {
          ctx.strokeStyle = `rgba(0, 0, 0, ${TERRAIN_OUTLINE_ALPHA})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        if (tile.type === "water") {
          const waterHeight = getTileHeight(tile);
          const landInfluence = getSmoothedWaterInfluence(state, x, y);
          const surfaceBlend = clamp(landInfluence * 0.85, 0, 0.8);
          const w00 = waterHeight + (h00 - waterHeight) * surfaceBlend;
          const w10 = waterHeight + (h10 - waterHeight) * surfaceBlend;
          const w11 = waterHeight + (h11 - waterHeight) * surfaceBlend;
          const w01 = waterHeight + (h01 - waterHeight) * surfaceBlend;
          const wp0 = isoProject(x, y, w00);
          const wp1 = isoProject(x + 1, y, w10);
          const wp2 = isoProject(x + 1, y + 1, w11);
          const wp3 = isoProject(x, y + 1, w01);
          const shoreTint = getWaterEdgeBaseColor(state, x, y);
          const waterTone = mixRgb(
            TILE_COLOR_RGB.water,
            mixRgb(SHALLOW_WATER_COLOR, shoreTint, 0.5),
            clamp(landInfluence * SHALLOW_WATER_BLEND, 0, 1)
          );
          ctx.globalAlpha = WATER_SURFACE_ALPHA;
          ctx.fillStyle = rgbString(waterTone);
          ctx.beginPath();
          ctx.moveTo(wp0.x, wp0.y);
          ctx.lineTo(wp1.x, wp1.y);
          ctx.lineTo(wp2.x, wp2.y);
          ctx.lineTo(wp3.x, wp3.y);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        } else if (
          tile.type !== "road" &&
          tile.type !== "base" &&
          tile.type !== "house" &&
          tile.waterDist > 0 &&
          tile.waterDist <= SHORE_SAND_DISTANCE
        ) {
          const rawBlend = clamp((SHORE_SAND_DISTANCE - (tile.waterDist - 1)) / SHORE_SAND_DISTANCE, 0, 1);
          const sandBlend = rawBlend * rawBlend * (3 - 2 * rawBlend);
          const edgeScale = tile.waterDist === 1 ? SHORE_SAND_EDGE_ALPHA : 1;
          ctx.globalAlpha = SHORE_SAND_ALPHA * sandBlend * edgeScale;
          ctx.fillStyle = rgbString(SAND_COLOR);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        if (
          tile.type !== "road" &&
          tile.type !== "base" &&
          tile.type !== "house" &&
          tile.type !== "water" &&
          isRoadAdjacent(state, x, y)
        ) {
          const vergeNoise = tileSeed(state, x, y, 73);
          const vergeAlpha = ROAD_VERGE_ALPHA * (0.65 + vergeNoise * 0.55);
          const vergeColor = mixRgb(top, ROAD_VERGE_COLOR, 0.6);
          ctx.globalAlpha = vergeAlpha;
          ctx.fillStyle = rgbString(vergeColor);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        if (tile.type === "road") {
          drawRoadOverlay(state, ctx, x, y, heightValue);
        }

        if (tile.type === "base") {
          drawBaseOnTile(state, ctx, x, y, heightValue);
        }

        if (tile.type === "house") {
          drawHouseOnTile(state, ctx, tile, x, y, heightValue);
        }
      }
    }

    terrainCache.lastBuild = now;
    state.terrainDirty = false;
  }

  return terrainCache;
};

/**
 * @deprecated Legacy 2D terrain cache path. Prefer the 3D render backend.
 */
export const ensureTreeLayerCache = (
  state: WorldState,
  renderState: RenderState,
  inputState: InputState,
  now: number
): TerrainCache | null => {
  if (!RENDER_TERRAIN_TREES || !renderState.renderTrees) {
    return null;
  }
  const { cols, rows } = state.grid;
  const maxHeight = getHeightScale(state);
  const originX = -rows * ISO_TILE_WIDTH * 0.5 - TERRAIN_PADDING;
  const originY = -maxHeight - TERRAIN_PADDING;
  const width = (cols + rows) * ISO_TILE_WIDTH * 0.5 + TERRAIN_PADDING * 2;
  const height = (cols + rows) * ISO_TILE_HEIGHT * 0.5 + maxHeight + TERRAIN_PADDING * 2;
  const timeReady = !treeLayerCache || now - treeLayerCache.lastBuild > TERRAIN_CACHE_INTERVAL_MS;
  const interactionCooldown = now - inputState.lastInteractionTime < TERRAIN_INTERACTION_COOLDOWN_MS;
  const baseBuild = terrainCache?.lastBuild ?? 0;
  const needsRebuild =
    !treeLayerCache ||
    treeLayerCache.width !== Math.ceil(width) ||
    treeLayerCache.height !== Math.ceil(height) ||
    treeLayerCache.lastBuild < baseBuild ||
    (state.terrainDirty && timeReady && !interactionCooldown);

  if (!treeLayerCache) {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas not supported");
    }
    treeLayerCache = {
      canvas,
      ctx,
      originX,
      originY,
      width: Math.ceil(width),
      height: Math.ceil(height),
      lastBuild: 0,
    };
  }

  if (needsRebuild) {
    treeLayerCache.originX = originX;
    treeLayerCache.originY = originY;
    treeLayerCache.width = Math.ceil(width);
    treeLayerCache.height = Math.ceil(height);
    treeLayerCache.canvas.width = treeLayerCache.width;
    treeLayerCache.canvas.height = treeLayerCache.height;
    const ctx = treeLayerCache.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, treeLayerCache.width, treeLayerCache.height);
    ctx.setTransform(1, 0, 0, 1, -originX, -originY);

    for (let sum = 0; sum <= cols + rows - 2; sum += 1) {
      for (let x = 0; x < cols; x += 1) {
        const y = sum - x;
        if (y < 0 || y >= rows) {
          continue;
        }
        const tileIndex = indexFor(state.grid, x, y);
        const tile = state.tiles[tileIndex];
        if (!isVegetationType(tile.type)) {
          continue;
        }
        const h00 = getSmoothedHeightAt(state, x, y);
        const h10 = getSmoothedHeightAt(state, x + 1, y);
        const h11 = getSmoothedHeightAt(state, x + 1, y + 1);
        const h01 = getSmoothedHeightAt(state, x, y + 1);
        const heightValue = (h00 + h10 + h11 + h01) * 0.25;
        drawTreesOnTile(state, ctx, tile, x, y, heightValue, 1);
      }
    }

    treeLayerCache.lastBuild = now;
  }

  return treeLayerCache;
};
