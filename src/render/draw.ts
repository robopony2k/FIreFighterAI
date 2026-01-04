import type { WorldState } from "../core/state.js";
import {
  FIRE_COLORS,
  LIGHT_DIR,
  TILE_COLORS,
  TILE_COLOR_RGB,
  TILE_SIZE,
  UNIT_CONFIG,
  WATER_PARTICLE_COLOR,
  WET_TINT,
  DRY_TINT,
  ELEVATION_TINT_HIGH,
  ELEVATION_TINT_LOW,
  ISO_TILE_HEIGHT,
  ISO_TILE_WIDTH,
  HEIGHT_SCALE,
  HEIGHT_WATER_DROP,
  FIRE_RENDER_SMOOTH_SECONDS
} from "../core/config.js";
import { clamp } from "../core/utils.js";
import { inBounds, indexFor } from "../core/grid.js";
import { hash2D } from "../mapgen/noise.js";
import { getViewTransform, isoProject } from "./iso.js";

const rgbString = (color: { r: number; g: number; b: number }): string =>
  `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;

const mixRgb = (a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t
});

const scaleRgb = (color: { r: number; g: number; b: number }, factor: number) => ({
  r: clamp(color.r * factor, 0, 255),
  g: clamp(color.g * factor, 0, 255),
  b: clamp(color.b * factor, 0, 255)
});

const RENDER_TERRAIN_SIDES = true;
const RENDER_TERRAIN_TREES = true;
const VOXEL_LAYERED_TERRAIN = true;
const SIDE_SHADE_TOP = 0.88;
const SIDE_SHADE_BOTTOM = 0.58;
const TERRAIN_HEIGHT_STEPS = 12;
const TERRAIN_OUTLINE_ALPHA = 0.08;
const TERRAIN_STEP_HEIGHT = HEIGHT_SCALE / TERRAIN_HEIGHT_STEPS;

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

let treeSprites: TreeSpriteSet | null = null;

const lighten = (color: { r: number; g: number; b: number }, amount: number) =>
  mixRgb(color, { r: 255, g: 255, b: 255 }, clamp(amount, 0, 1));

const darken = (color: { r: number; g: number; b: number }, amount: number) =>
  mixRgb(color, { r: 0, g: 0, b: 0 }, clamp(amount, 0, 1));

const quantizeElevation = (elevation: number) =>
  Math.round(elevation * TERRAIN_HEIGHT_STEPS) / TERRAIN_HEIGHT_STEPS;

const buildTreeSprite = (
  size: number,
  canopy: { r: number; g: number; b: number },
  trunk: { r: number; g: number; b: number },
  highlight: { r: number; g: number; b: number },
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

  const drawLayer = (offset: number, scale: number, color: { r: number; g: number; b: number }) => {
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
    anchorY: height - size * 0.08
  };
};

const buildTreeSpriteSet = (
  baseColor: { r: number; g: number; b: number },
  trunkColor: { r: number; g: number; b: number }
): Record<TreeStage, TreeSprite[]> => {
  const stages: { id: TreeStage; size: number; tone: number; layers: number }[] = [
    { id: "sapling", size: TILE_SIZE * 0.55, tone: 0.22, layers: 1 },
    { id: "young", size: TILE_SIZE * 0.75, tone: 0.12, layers: 2 },
    { id: "mature", size: TILE_SIZE * 0.95, tone: 0.04, layers: 2 },
    { id: "old", size: TILE_SIZE * 1.1, tone: -0.08, layers: 3 }
  ];
  const result: Record<TreeStage, TreeSprite[]> = {
    sapling: [],
    young: [],
    mature: [],
    old: []
  };
  stages.forEach((stage) => {
    for (let variant = 0; variant < 3; variant += 1) {
      const tone = stage.tone + variant * 0.02;
      const canopy =
        tone >= 0 ? lighten(baseColor, tone) : darken(baseColor, Math.abs(tone));
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
    grass: buildTreeSpriteSet(TILE_COLOR_RGB.grass, trunkColor)
  };
  return treeSprites;
};

const shadeTileColor = (state: WorldState, tile: WorldState["tiles"][number], x: number, y: number) => {
  const elev = tile.type === "water" ? 0 : quantizeElevation(tile.elevation);
  const base =
    tile.type === "grass" || tile.type === "forest"
      ? mixRgb(TILE_COLOR_RGB.grass, TILE_COLOR_RGB.forest, clamp(tile.canopy, 0, 1))
      : TILE_COLOR_RGB[tile.type];
  const left = inBounds(state.grid, x - 1, y)
    ? quantizeElevation(state.tiles[indexFor(state.grid, x - 1, y)].elevation)
    : elev;
  const right = inBounds(state.grid, x + 1, y)
    ? quantizeElevation(state.tiles[indexFor(state.grid, x + 1, y)].elevation)
    : elev;
  const up = inBounds(state.grid, x, y - 1)
    ? quantizeElevation(state.tiles[indexFor(state.grid, x, y - 1)].elevation)
    : elev;
  const down = inBounds(state.grid, x, y + 1)
    ? quantizeElevation(state.tiles[indexFor(state.grid, x, y + 1)].elevation)
    : elev;
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
    b: ELEVATION_TINT_LOW.b + (ELEVATION_TINT_HIGH.b - ELEVATION_TINT_LOW.b) * elev
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
    b: clamp(mixed.b * shade * noiseShade, 0, 255)
  };
};

const getRenderHeightForTile = (tile: WorldState["tiles"][number]): number => {
  if (tile.type === "water") {
    return -HEIGHT_WATER_DROP;
  }
  const quantized = quantizeElevation(tile.elevation);
  return quantized * HEIGHT_SCALE;
};

const getRenderHeightAt = (state: WorldState, wx: number, wy: number): number => {
  const x = Math.floor(wx);
  const y = Math.floor(wy);
  if (!inBounds(state.grid, x, y)) {
    return 0;
  }
  return getRenderHeightForTile(state.tiles[indexFor(state.grid, x, y)]);
};

const drawTargetMarker = (ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, size: number, color: string) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y - size);
  ctx.lineTo(pos.x + size, pos.y);
  ctx.lineTo(pos.x, pos.y + size);
  ctx.lineTo(pos.x - size, pos.y);
  ctx.closePath();
  ctx.stroke();
};

const drawVoxelSide = (
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  heightTop: number,
  heightBottom: number,
  topColor: { r: number; g: number; b: number }
) => {
  const diff = heightTop - heightBottom;
  if (diff <= 0.1) {
    return;
  }
  const steps = Math.max(1, Math.ceil(diff / TERRAIN_STEP_HEIGHT));
  for (let i = 0; i < steps; i += 1) {
    const bandTop = heightTop - i * TERRAIN_STEP_HEIGHT;
    const bandBottom = Math.max(heightTop - (i + 1) * TERRAIN_STEP_HEIGHT, heightBottom);
    const t = steps === 1 ? 0 : i / (steps - 1);
    const shade = SIDE_SHADE_TOP - (SIDE_SHADE_TOP - SIDE_SHADE_BOTTOM) * t;
    ctx.fillStyle = rgbString(scaleRgb(topColor, shade));
    const up1 = isoProject(x1, y1, bandTop);
    const up2 = isoProject(x2, y2, bandTop);
    const low1 = isoProject(x1, y1, bandBottom);
    const low2 = isoProject(x2, y2, bandBottom);
    ctx.beginPath();
    ctx.moveTo(up1.x, up1.y);
    ctx.lineTo(up2.x, up2.y);
    ctx.lineTo(low2.x, low2.y);
    ctx.lineTo(low1.x, low1.y);
    ctx.closePath();
    ctx.fill();
  }
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
    context.drawImage(sprite.canvas, base.x - sprite.anchorX * scale, base.y - sprite.anchorY * scale, width, heightPx);
  }
};

const TERRAIN_CACHE_INTERVAL_MS = 400;
const TERRAIN_PADDING = TILE_SIZE * 6;

type TerrainCache = {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  originX: number;
  originY: number;
  width: number;
  height: number;
  lastBuild: number;
};

let terrainCache: TerrainCache | null = null;

const ensureTerrainCache = (state: WorldState, now: number): TerrainCache => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const maxHeight = HEIGHT_SCALE;
  const originX = -rows * ISO_TILE_WIDTH * 0.5 - TERRAIN_PADDING;
  const originY = -maxHeight - TERRAIN_PADDING;
  const width = (cols + rows) * ISO_TILE_WIDTH * 0.5 + TERRAIN_PADDING * 2;
  const height = (cols + rows) * ISO_TILE_HEIGHT * 0.5 + maxHeight + TERRAIN_PADDING * 2;
  const timeReady = !terrainCache || now - terrainCache.lastBuild > TERRAIN_CACHE_INTERVAL_MS;
  const needsRebuild =
    !terrainCache ||
    terrainCache.width !== Math.ceil(width) ||
    terrainCache.height !== Math.ceil(height) ||
    (state.terrainDirty && timeReady);

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
      lastBuild: 0
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
        const tile = state.tiles[indexFor(state.grid, x, y)];
        const heightValue = getRenderHeightForTile(tile);
        const top = shadeTileColor(state, tile, x, y);
        const p0 = isoProject(x, y, heightValue);
        const p1 = isoProject(x + 1, y, heightValue);
        const p2 = isoProject(x + 1, y + 1, heightValue);
        const p3 = isoProject(x, y + 1, heightValue);

        if (RENDER_TERRAIN_SIDES) {
          const eastNeighborHeight = inBounds(state.grid, x + 1, y)
            ? getRenderHeightForTile(state.tiles[indexFor(state.grid, x + 1, y)])
            : 0;
          if (eastNeighborHeight < heightValue - 0.1) {
            if (VOXEL_LAYERED_TERRAIN) {
              drawVoxelSide(ctx, x + 1, y, x + 1, y + 1, heightValue, eastNeighborHeight, top);
            } else {
              const sideTop = scaleRgb(top, SIDE_SHADE_TOP);
              const sideBottom = scaleRgb(top, SIDE_SHADE_BOTTOM);
              const low1 = isoProject(x + 1, y, eastNeighborHeight);
              const low2 = isoProject(x + 1, y + 1, eastNeighborHeight);
              const grad = ctx.createLinearGradient(p1.x, p1.y, low1.x, low1.y);
              grad.addColorStop(0, rgbString(sideTop));
              grad.addColorStop(1, rgbString(sideBottom));
              ctx.fillStyle = grad;
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.lineTo(low2.x, low2.y);
              ctx.lineTo(low1.x, low1.y);
              ctx.closePath();
              ctx.fill();
            }
          }

          const southNeighborHeight = inBounds(state.grid, x, y + 1)
            ? getRenderHeightForTile(state.tiles[indexFor(state.grid, x, y + 1)])
            : 0;
          if (southNeighborHeight < heightValue - 0.1) {
            if (VOXEL_LAYERED_TERRAIN) {
              drawVoxelSide(ctx, x, y + 1, x + 1, y + 1, heightValue, southNeighborHeight, top);
            } else {
              const sideTop = scaleRgb(top, SIDE_SHADE_TOP);
              const sideBottom = scaleRgb(top, SIDE_SHADE_BOTTOM);
              const low1 = isoProject(x, y + 1, southNeighborHeight);
              const low2 = isoProject(x + 1, y + 1, southNeighborHeight);
              const grad = ctx.createLinearGradient(p3.x, p3.y, low1.x, low1.y);
              grad.addColorStop(0, rgbString(sideTop));
              grad.addColorStop(1, rgbString(sideBottom));
              ctx.fillStyle = grad;
              ctx.beginPath();
              ctx.moveTo(p3.x, p3.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.lineTo(low2.x, low2.y);
              ctx.lineTo(low1.x, low1.y);
              ctx.closePath();
              ctx.fill();
            }
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

const getVisibleBounds = (
  state: WorldState,
  canvas: HTMLCanvasElement,
  view: { scale: number; offsetX: number; offsetY: number }
) => {
  const toWorld = (screenX: number, screenY: number) => {
    const worldX = (screenX - view.offsetX) / view.scale;
    const worldY = (screenY - view.offsetY) / view.scale;
    const isoX = worldX / (ISO_TILE_WIDTH * 0.5);
    const isoY = worldY / (ISO_TILE_HEIGHT * 0.5);
    return {
      x: (isoY + isoX) / 2,
      y: (isoY - isoX) / 2
    };
  };

  const corners = [
    toWorld(0, 0),
    toWorld(canvas.width, 0),
    toWorld(0, canvas.height),
    toWorld(canvas.width, canvas.height)
  ];
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const corner of corners) {
    minX = Math.min(minX, corner.x);
    maxX = Math.max(maxX, corner.x);
    minY = Math.min(minY, corner.y);
    maxY = Math.max(maxY, corner.y);
  }
  const pad = view.scale < 1 ? 6 : 4;
  return {
    startX: clamp(Math.floor(minX) - pad, 0, state.grid.cols - 1),
    endX: clamp(Math.ceil(maxX) + pad, 0, state.grid.cols - 1),
    startY: clamp(Math.floor(minY) - pad, 0, state.grid.rows - 1),
    endY: clamp(Math.ceil(maxY) + pad, 0, state.grid.rows - 1)
  };
};

export function draw(state: WorldState, canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
  const view = getViewTransform(state, canvas);
  const now = performance.now();
  const cache = ensureTerrainCache(state, now);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);

  ctx.drawImage(cache.canvas, cache.originX, cache.originY);

  if (state.renderEffects) {
    const fireBlend =
      state.phase === "fire" && FIRE_RENDER_SMOOTH_SECONDS > 0
        ? clamp(state.fireSimAccumulator / FIRE_RENDER_SMOOTH_SECONDS, 0, 1)
        : 1;
    if (state.formationStart && state.formationEnd) {
      const startHeight = getRenderHeightForTile(
        state.tiles[indexFor(state.grid, state.formationStart.x, state.formationStart.y)]
      );
      const endHeight = getRenderHeightForTile(
        state.tiles[indexFor(state.grid, state.formationEnd.x, state.formationEnd.y)]
      );
      const start = isoProject(state.formationStart.x + 0.5, state.formationStart.y + 0.5, startHeight + TILE_SIZE * 0.1);
      const end = isoProject(state.formationEnd.x + 0.5, state.formationEnd.y + 0.5, endHeight + TILE_SIZE * 0.1);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    const { startX, endX, startY, endY } = getVisibleBounds(state, canvas, view);
    const sumStart = startX + startY;
    const sumEnd = endX + endY;

    for (let sum = sumStart; sum <= sumEnd; sum += 1) {
      const xStart = Math.max(startX, sum - endY);
      const xEnd = Math.min(endX, sum - startY);
      for (let x = xStart; x <= xEnd; x += 1) {
        const y = sum - x;
        const idx = indexFor(state.grid, x, y);
        const tile = state.tiles[idx];
        const height = getRenderHeightForTile(tile);
        const prevFire = state.fireSnapshot[idx] || 0;
        const fire = prevFire + (tile.fire - prevFire) * fireBlend;
        if (fire > 0) {
          const intensity = clamp(fire, 0.2, 1);
          const colorIndex = Math.min(FIRE_COLORS.length - 1, Math.floor(intensity * FIRE_COLORS.length));
          const center = isoProject(x + 0.5, y + 0.5, height + TILE_SIZE * 0.4);
          ctx.fillStyle = FIRE_COLORS[colorIndex];
          ctx.globalAlpha = 0.6 + intensity * 0.3;
          ctx.beginPath();
          ctx.arc(center.x, center.y, TILE_SIZE * (0.3 + intensity * 0.35), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }
    }

    state.units.forEach((unit) => {
      const baseHeight = getRenderHeightAt(state, unit.x, unit.y);
      const ground = isoProject(unit.x, unit.y, baseHeight);
      const head = isoProject(unit.x, unit.y, baseHeight + TILE_SIZE * 1.2);
      ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
      ctx.beginPath();
      ctx.ellipse(ground.x, ground.y + TILE_SIZE * 0.2, TILE_SIZE * 0.35, TILE_SIZE * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = UNIT_CONFIG[unit.kind].color;
      ctx.beginPath();
      ctx.arc(head.x, head.y, TILE_SIZE * 0.32, 0, Math.PI * 2);
      ctx.fill();
      if (unit.selected) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.strokeStyle = "rgba(240, 179, 59, 0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(ground.x, ground.y + TILE_SIZE * 0.15, TILE_SIZE * 0.55, 0, Math.PI * 2);
        ctx.stroke();
        if (unit.target) {
          const targetHeight = getRenderHeightAt(state, unit.target.x + 0.5, unit.target.y + 0.5);
          const target = isoProject(unit.target.x + 0.5, unit.target.y + 0.5, targetHeight + TILE_SIZE * 0.2);
          ctx.strokeStyle = "rgba(240, 179, 59, 0.7)";
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(ground.x, ground.y);
          ctx.lineTo(target.x, target.y);
          ctx.stroke();
          drawTargetMarker(ctx, target, TILE_SIZE * 0.35, "rgba(240, 179, 59, 0.9)");
        }
      }
    });

    state.smokeParticles.forEach((particle) => {
      const baseHeight = getRenderHeightAt(state, particle.x, particle.y);
      const rise = (1 - particle.alpha) * TILE_SIZE * 5;
      const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 2 + rise);
      const alpha = clamp(particle.alpha * 0.6, 0, 0.6);
      ctx.fillStyle = `rgba(70, 70, 70, ${alpha})`;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, particle.size * 0.5, 0, Math.PI * 2);
      ctx.fill();
    });

    ctx.fillStyle = WATER_PARTICLE_COLOR;
    state.waterParticles.forEach((particle) => {
      const baseHeight = getRenderHeightAt(state, particle.x, particle.y);
      const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 0.5);
      ctx.globalAlpha = clamp(particle.alpha, 0, 1);
      ctx.fillRect(pos.x - particle.size / 2, pos.y - particle.size / 2, particle.size, particle.size);
    });
    ctx.globalAlpha = 1;
  }
  if (state.selectionBox) {
    const { x1, y1, x2, y2 } = state.selectionBox;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgba(240, 179, 59, 0.15)";
    ctx.strokeStyle = "rgba(240, 179, 59, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(left, top, width, height);
    ctx.strokeRect(left, top, width, height);
  }
}

