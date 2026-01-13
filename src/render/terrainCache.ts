
import type { WorldState } from "../core/state.js";
import { inBounds, indexFor } from "../core/grid.js";
import { hash2D } from "../mapgen/noise.js";
import { getHeightAt as getSmoothedHeightAt, getTileHeight, isoProject } from "./iso.js";
import {
  TILE_SIZE,
  HEIGHT_SCALE,
  ISO_TILE_WIDTH,
  ISO_TILE_HEIGHT,
  TILE_COLOR_RGB,
  LIGHT_DIR,
  ELEVATION_TINT_LOW,
  ELEVATION_TINT_HIGH,
  DRY_TINT,
  WET_TINT,
  TILE_COLORS,
} from "../core/config.js";
import { clamp } from "../core/utils.js";
import { rgbString, mixRgb, scaleRgb, lighten, darken, type RGB } from "./color.js";

// Constants
const RENDER_TERRAIN_SIDES = true;
const RENDER_TERRAIN_TREES = true;
const SIDE_SHADE_TOP = 0.88;
const SIDE_SHADE_BOTTOM = 0.58;
const TERRAIN_OUTLINE_ALPHA = 0.08;
const TERRAIN_CACHE_INTERVAL_MS = 400;
const TERRAIN_PADDING = TILE_SIZE * 6;
const TERRAIN_INTERACTION_COOLDOWN_MS = 120;

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
let treeBurnScratch: { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | null = null;

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

  ctx.fillStyle = rgbString(trunk);
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
  treeSprites = {
    forest: buildTreeSpriteSet(TILE_COLOR_RGB.forest, trunkColor),
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

const shadeTileColor = (state: WorldState, tile: WorldState["tiles"][number], x: number, y: number) => {
  const elev = tile.type === "water" ? 0 : tile.elevation;
  
  let base: RGB;
  if (tile.type === "grass" && tile.fire > 0) {
    base = TILE_COLOR_RGB.ON_FIRE_GRASS;
  } else if (tile.type === "forest" && tile.fire > 0) {
    base = darken(TILE_COLOR_RGB.forest, 0.2); // Scorched earth color
  } else if (tile.type === "grass" || tile.type === "forest") {
    base = mixRgb(TILE_COLOR_RGB.grass, TILE_COLOR_RGB.forest, clamp(tile.canopy, 0, 1));
  } else {
    base = TILE_COLOR_RGB[tile.type];
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
  const heightBoost = 0.9 + elev * 0.24;
  const shade = clamp(heightBoost * (0.96 + slope * 0.7) * (1 + relief * 0.5), 0.7, 1.18);
  const tintAmount = tile.type === "water" ? 0.05 : 0.12 + elev * 0.22;
  const tint = {
    r: ELEVATION_TINT_LOW.r + (ELEVATION_TINT_HIGH.r - ELEVATION_TINT_LOW.r) * elev,
    g: ELEVATION_TINT_LOW.g + (ELEVATION_TINT_HIGH.g - ELEVATION_TINT_LOW.g) * elev,
    b: ELEVATION_TINT_LOW.b + (ELEVATION_TINT_HIGH.b - ELEVATION_TINT_LOW.b) * elev,
  };

  let mixed = mixRgb(base, tint, tintAmount);
  if (tile.type === "grass" || tile.type === "forest") {
    const moistureTint = mixRgb(DRY_TINT, WET_TINT, clamp(tile.moisture, 0, 1));
    const moistureAmount = 0.12 + tile.moisture * 0.18;
    mixed = mixRgb(mixed, moistureTint, moistureAmount);
  }
  const noise = state.colorNoiseMap[indexFor(state.grid, x, y)];
  const noiseShift = (noise - 0.5) * 0.05;
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
  if (tile.type !== "grass" && tile.type !== "forest") {
    return;
  }
  const detailFactor = clamp(detail, 0, 1);
  if (detailFactor <= 0.05) {
    return;
  }
  const canopy = clamp(tile.canopy, 0, 1);
  if (tile.type === "grass" && canopy < 0.2) {
    return;
  }
  const densityBase = tile.type === "forest" ? 0.32 + canopy * 0.55 : 0.12 + canopy * 0.35;
  const density = densityBase * (0.55 + detailFactor * 0.45);
  if (tileSeed(state, x, y, 1) > density) {
    return;
  }
  const stage: TreeStage =
    canopy < 0.28 ? "sapling" : canopy < 0.45 ? "young" : canopy < 0.7 ? "mature" : "old";
  const maxCount = tile.type === "forest" ? 4 : 2;
  const rawCount = Math.floor(tileSeed(state, x, y, 2) * (maxCount + 1));
  const count = Math.round(rawCount * (0.6 + detailFactor * 0.4));
  if (count <= 0) {
    return;
  }
  const spriteSet = ensureTreeSprites();
  const sprites = tile.type === "forest" ? spriteSet.forest[stage] : spriteSet.grass[stage];

  for (let i = 0; i < count; i += 1) {
    const jitterX = (tileSeed(state, x, y, 10 + i) - 0.5) * 0.45;
    const jitterY = (tileSeed(state, x, y, 20 + i) - 0.5) * 0.45;
    const sprite = sprites[Math.floor(tileSeed(state, x, y, 30 + i) * sprites.length)];
    const scale = 0.9 + canopy * 0.15 + tileSeed(state, x, y, 40 + i) * 0.12;
    const base = isoProject(x + 0.5 + jitterX, y + 0.5 + jitterY, height + TILE_SIZE * 0.05);
    const width = sprite.width * scale;
    const heightPx = sprite.height * scale;
    const drawX = base.x - sprite.anchorX * scale;
    const drawY = base.y - sprite.anchorY * scale;
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
      context.drawImage(scratch.canvas, drawX, drawY, width, heightPx);
    } else {
      context.drawImage(sprite.canvas, drawX, drawY, width, heightPx);
    }
  }
};

export const ensureTerrainCache = (state: WorldState, now: number): TerrainCache => {
  const { cols, rows } = state.grid;
  const maxHeight = HEIGHT_SCALE;
  const originX = -rows * ISO_TILE_WIDTH * 0.5 - TERRAIN_PADDING;
  const originY = -maxHeight - TERRAIN_PADDING;
  const width = (cols + rows) * ISO_TILE_WIDTH * 0.5 + TERRAIN_PADDING * 2;
  const height = (cols + rows) * ISO_TILE_HEIGHT * 0.5 + maxHeight + TERRAIN_PADDING * 2;
  const timeReady = !terrainCache || now - terrainCache.lastBuild > TERRAIN_CACHE_INTERVAL_MS;
  const interactionCooldown = now - state.lastInteractionTime < TERRAIN_INTERACTION_COOLDOWN_MS;
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
        const top = shadeTileColor(state, tile, x, y);
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

        if (RENDER_TERRAIN_TREES && state.renderTrees) {
          drawTreesOnTile(state, ctx, tile, x, y, heightValue, 1);
        }

        if (tile.type === "house") {
          const roof = isoProject(x + 0.5, y + 0.5, heightValue + TILE_SIZE * 0.35);
          ctx.fillStyle = TILE_COLORS.house;
          ctx.beginPath();
          ctx.moveTo(roof.x, roof.y - TILE_SIZE * 0.28);
          ctx.lineTo(roof.x + TILE_SIZE * 0.32, roof.y);
          ctx.lineTo(roof.x, roof.y + TILE_SIZE * 0.28);
          ctx.lineTo(roof.x - TILE_SIZE * 0.32, roof.y);
          ctx.closePath();
          ctx.fill();
        }
      }
    }

    terrainCache.lastBuild = now;
    state.terrainDirty = false;
  }

  return terrainCache;
};
