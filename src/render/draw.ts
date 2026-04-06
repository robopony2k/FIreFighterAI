import type { WorldState } from "../core/state.js";
import type { InputState } from "../core/inputState.js";
import type { EffectsState } from "../core/effectsState.js";
import { DEBUG_TERRAIN_RENDER, TILE_SIZE, TILE_COLOR_RGB, getTimeSpeedOptions } from "../core/config.js";
import { indexFor } from "../core/grid.js";
import { getHeightScale, getTileHeight, getViewTransform, isoProject, setHeightScale } from "./iso.js";
import { ensureTileSoA } from "../core/tileCache.js";
import { getVisibleBounds } from "./view.js";
import type { ViewTransform } from "./view.js";
import { ensureTerrainCache, ensureTreeLayerCache, getRenderHeightAt } from "./terrainCache.js";
import { updateFireSmoothing, drawFireFx } from "./fireFx.js";
import { drawUnits } from "./units.js";
import { drawParticles } from "./particles.js";
import { clamp } from "../core/utils.js";
import { darken, mixRgb, lighten } from "./color.js";
import { hash2D } from "../mapgen/noise.js";
import type { RenderState } from "./renderState.js";
import { getForestTreeColor, isGrassLikeType, isVegetationType } from "./vegetationPalette.js";

const formatNumber = (value: number, digits = 3): string => (Number.isFinite(value) ? value.toFixed(digits) : "inf");

const formatOptional = (value: number | undefined | null, digits = 3): string =>
  typeof value === "number" ? value.toFixed(digits) : "n/a";

const GRID_COLORS = {
  beach: darken(TILE_COLOR_RGB.beach, 0.25),
  floodplain: darken(TILE_COLOR_RGB.floodplain, 0.35),
  grass: darken(TILE_COLOR_RGB.grass, 0.35),
  scrub: darken(TILE_COLOR_RGB.scrub, 0.35),
  forest: darken(TILE_COLOR_RGB.forest, 0.4),
  rocky: darken(TILE_COLOR_RGB.rocky, 0.3),
  bare: darken(TILE_COLOR_RGB.bare, 0.3),
  ash: { r: 72, g: 62, b: 54 },
  road: darken(TILE_COLOR_RGB.road, 0.28),
  base: darken(TILE_COLOR_RGB.base, 0.2),
  house: darken(TILE_COLOR_RGB.house, 0.2),
  firebreak: darken(TILE_COLOR_RGB.firebreak, 0.25)
};

const rgbaString = (color: { r: number; g: number; b: number }, alpha: number) =>
  `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha})`;

let terrainRenderStatsTotal = -1;
const logTerrainRenderStats = (state: WorldState): void => {
  if (!DEBUG_TERRAIN_RENDER) {
    return;
  }
  if (state.grid.totalTiles === terrainRenderStatsTotal) {
    return;
  }
  const elevations = state.tileElevation;
  if (!elevations || elevations.length === 0) {
    return;
  }
  let min = 1;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < elevations.length; i += 1) {
    const value = elevations[i];
    min = Math.min(min, value);
    max = Math.max(max, value);
    sum += value;
  }
  const mean = sum / Math.max(1, elevations.length);
  const heightScale = getHeightScale(state);
  console.log(
    `Render heights: elev[min=${min.toFixed(3)} max=${max.toFixed(3)} mean=${mean.toFixed(3)}] heightMax=${(
      max * heightScale
    ).toFixed(2)}`
  );
  terrainRenderStatsTotal = state.grid.totalTiles;
};

const COAST_EDGE_N = 1;
const COAST_EDGE_E = 2;
const COAST_EDGE_S = 4;
const COAST_EDGE_W = 8;
const COAST_BAND_PX = TILE_SIZE * 0.78;
const COAST_JITTER_PX = 3.4;
const COAST_BAND_ALPHA = 0.6;
const COAST_BAND_ALPHA_JITTER = 0.2;
const COAST_CORNER_RADIUS_MULT = 1.1;
const COAST_CORNER_INSET = 0.18;
const COAST_CORNER_ALPHA = 0.5;
const COAST_CORNER_STRETCH = 1.6;
const COAST_CORNER_SQUASH = 0.78;
const COAST_WATER_LIGHTEN = 0.22;
const SHALLOWS_BAND_PX = TILE_SIZE * 1.1;
const SHALLOWS_JITTER_PX = 2.4;
const SHALLOWS_ALPHA = 0.35;
const SHALLOWS_ALPHA_JITTER = 0.1;
const SHALLOWS_LIGHTEN = 0.28;
const SHALLOWS_WASH_BAND_PX = TILE_SIZE * 1.6;
const SHALLOWS_WASH_ALPHA = 0.22;
const SHALLOWS_WASH_ALPHA_JITTER = 0.08;
const LAND_SHORE_BAND_PX = TILE_SIZE * 0.6;
const LAND_SHORE_JITTER_PX = 2.1;
const LAND_SHORE_BAND_ALPHA = 0.5;
const LAND_SHORE_BAND_ALPHA_JITTER = 0.18;
const LAND_SHORE_CORNER_RADIUS_MULT = 1.05;
const LAND_SHORE_CORNER_INSET = 0.22;
const LAND_SHORE_CORNER_ALPHA = 0.45;
const LAND_SHORE_CORNER_STRETCH = 1.55;
const LAND_SHORE_CORNER_SQUASH = 0.8;
const LAND_SHORE_WATER_BLEND = 0.28;
const LAND_WASH_BAND_PX = TILE_SIZE * 1.45;
const LAND_WASH_ALPHA = 0.22;
const LAND_WASH_ALPHA_JITTER = 0.08;
const SHORE_NOISE_WIDTH = 0.14;
const SHORE_NOISE_ALPHA = 0.1;
const SHALLOW_WATER_COLOR = mixRgb(TILE_COLOR_RGB.water, TILE_COLOR_RGB.grass, 0.22);
const COASTLINE_SMOOTH_ITERATIONS = 3;
const COASTLINE_STROKE_WIDTH = TILE_SIZE * 1.1;
const COASTLINE_STROKE_ALPHA = 0.55;
const COASTLINE_EDGE_WIDTH = TILE_SIZE * 0.2;
const COASTLINE_EDGE_ALPHA = 0.28;
const COASTLINE_EDGE_DARKEN = 0.2;
const COASTLINE_COLOR = mixRgb(TILE_COLOR_RGB.firebreak, TILE_COLOR_RGB.grass, 0.68);

type CoastPoint = { x: number; y: number };
type CoastSegment = { a: CoastPoint; b: CoastPoint };
type CoastlinePath = { points: CoastPoint[]; closed: boolean };

let coastlineCache: {
  paths: CoastlinePath[];
  tilesRef: WorldState["tiles"];
  cols: number;
  rows: number;
} | null = null;

const getBaseTileColor = (state: WorldState, tile: WorldState["tiles"][number]) => {
  if (isVegetationType(tile.type)) {
    const canopy = clamp(tile.canopyCover ?? tile.canopy, 0, 1);
    const base = tile.type === "forest" ? TILE_COLOR_RGB.grass : TILE_COLOR_RGB[tile.type] ?? TILE_COLOR_RGB.grass;
    const forestTone = tile.type === "forest" ? getForestTreeColor(tile) : TILE_COLOR_RGB.forest;
    return mixRgb(base, forestTone, canopy);
  }
  if (tile.type === "ash") {
    return TILE_COLOR_RGB.ash;
  }
  if (tile.type === "firebreak") {
    return TILE_COLOR_RGB.firebreak;
  }
  return TILE_COLOR_RGB[tile.type] ?? TILE_COLOR_RGB.grass;
};

const getShoreLandColor = (state: WorldState, tile: WorldState["tiles"][number]) => {
  const base = getBaseTileColor(state, tile);
  const sandMix = mixRgb(base, TILE_COLOR_RGB.firebreak, tile.type === "forest" ? 0.25 : 0.35);
  return mixRgb(sandMix, TILE_COLOR_RGB.grass, 0.2);
};

const computeCoastEdgeMask = (state: WorldState, x: number, y: number): number => {
  const tile = state.tiles[indexFor(state.grid, x, y)];
  if (tile.type !== "water") {
    return 0;
  }
  let mask = 0;
  if (y > 0 && state.tiles[indexFor(state.grid, x, y - 1)].type !== "water") {
    mask |= COAST_EDGE_N;
  }
  if (x < state.grid.cols - 1 && state.tiles[indexFor(state.grid, x + 1, y)].type !== "water") {
    mask |= COAST_EDGE_E;
  }
  if (y < state.grid.rows - 1 && state.tiles[indexFor(state.grid, x, y + 1)].type !== "water") {
    mask |= COAST_EDGE_S;
  }
  if (x > 0 && state.tiles[indexFor(state.grid, x - 1, y)].type !== "water") {
    mask |= COAST_EDGE_W;
  }
  return mask;
};

const isFeatherableLandTile = (tile: WorldState["tiles"][number]): boolean =>
  tile.type !== "water" && tile.type !== "road" && tile.type !== "base" && tile.type !== "house";

const computeLandCoastEdgeMask = (state: WorldState, x: number, y: number): number => {
  const tile = state.tiles[indexFor(state.grid, x, y)];
  if (!isFeatherableLandTile(tile)) {
    return 0;
  }
  let mask = 0;
  if (y > 0 && state.tiles[indexFor(state.grid, x, y - 1)].type === "water") {
    mask |= COAST_EDGE_N;
  }
  if (x < state.grid.cols - 1 && state.tiles[indexFor(state.grid, x + 1, y)].type === "water") {
    mask |= COAST_EDGE_E;
  }
  if (y < state.grid.rows - 1 && state.tiles[indexFor(state.grid, x, y + 1)].type === "water") {
    mask |= COAST_EDGE_S;
  }
  if (x > 0 && state.tiles[indexFor(state.grid, x - 1, y)].type === "water") {
    mask |= COAST_EDGE_W;
  }
  return mask;
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
    if (pos.x < 0 || pos.y < 0 || pos.x >= state.grid.cols || pos.y >= state.grid.rows) {
      landWeight += pos.w;
      return;
    }
    const neighbor = state.tiles[indexFor(state.grid, pos.x, pos.y)];
    if (neighbor.type !== "water") {
      landWeight += pos.w;
    }
  });
  return totalWeight > 0 ? clamp(landWeight / totalWeight, 0, 1) : 0;
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
    if (pos.x < 0 || pos.y < 0 || pos.x >= state.grid.cols || pos.y >= state.grid.rows) {
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

const getTileCorners = (state: WorldState, x: number, y: number) => {
  const h00 = getRenderHeightAt(state, x, y);
  const h10 = getRenderHeightAt(state, x + 1, y);
  const h11 = getRenderHeightAt(state, x + 1, y + 1);
  const h01 = getRenderHeightAt(state, x, y + 1);
  const p0 = isoProject(x, y, h00);
  const p1 = isoProject(x + 1, y, h10);
  const p2 = isoProject(x + 1, y + 1, h11);
  const p3 = isoProject(x, y + 1, h01);
  return { p0, p1, p2, p3 };
};

const clipToTile = (
  ctx: CanvasRenderingContext2D,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number }
) => {
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.clip();
};

const getShoreNoise = (state: WorldState, x: number, y: number, offset: number) => {
  const widthNoise = (hash2D(x + offset * 19, y + offset * 23, state.seed + offset * 151) - 0.5) * 2;
  const alphaNoise = (hash2D(x + offset * 29, y + offset * 31, state.seed + offset * 197) - 0.5) * 2;
  return {
    width: 1 + widthNoise * SHORE_NOISE_WIDTH,
    alpha: 1 + alphaNoise * SHORE_NOISE_ALPHA
  };
};

const getShoreAnchor = (
  state: WorldState,
  x: number,
  y: number,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  center: { x: number; y: number },
  wantWater: boolean
) => {
  const midN = { x: (p0.x + p1.x) * 0.5, y: (p0.y + p1.y) * 0.5 };
  const midE = { x: (p1.x + p2.x) * 0.5, y: (p1.y + p2.y) * 0.5 };
  const midS = { x: (p2.x + p3.x) * 0.5, y: (p2.y + p3.y) * 0.5 };
  const midW = { x: (p3.x + p0.x) * 0.5, y: (p3.y + p0.y) * 0.5 };
  const dirs = [
    { dx: 0, dy: -1, point: midN, weight: 1 },
    { dx: 1, dy: 0, point: midE, weight: 1 },
    { dx: 0, dy: 1, point: midS, weight: 1 },
    { dx: -1, dy: 0, point: midW, weight: 1 },
    { dx: 1, dy: -1, point: p1, weight: 0.7 },
    { dx: 1, dy: 1, point: p2, weight: 0.7 },
    { dx: -1, dy: 1, point: p3, weight: 0.7 },
    { dx: -1, dy: -1, point: p0, weight: 0.7 }
  ];
  let sumX = 0;
  let sumY = 0;
  let sumW = 0;
  dirs.forEach((dir) => {
    const nx = x + dir.dx;
    const ny = y + dir.dy;
    if (nx < 0 || ny < 0 || nx >= state.grid.cols || ny >= state.grid.rows) {
      return;
    }
    const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
    const isWater = neighbor.type === "water";
    if (wantWater !== isWater) {
      return;
    }
    sumX += (dir.point.x - center.x) * dir.weight;
    sumY += (dir.point.y - center.y) * dir.weight;
    sumW += dir.weight;
  });
  if (sumW <= 0) {
    return null;
  }
  const dirX = sumX / sumW;
  const dirY = sumY / sumW;
  const len = Math.hypot(dirX, dirY);
  if (len <= 0.001) {
    return null;
  }
  const ray = { x: dirX / len, y: dirY / len };
  const edges: Array<[ { x: number; y: number }, { x: number; y: number } ]> = [
    [p0, p1],
    [p1, p2],
    [p2, p3],
    [p3, p0]
  ];
  const cross = (ax: number, ay: number, bx: number, by: number) => ax * by - ay * bx;
  let bestX = 0;
  let bestY = 0;
  let bestT = Number.POSITIVE_INFINITY;
  let hasBest = false;
  edges.forEach(([a, b]) => {
    const sx = b.x - a.x;
    const sy = b.y - a.y;
    const denom = cross(ray.x, ray.y, sx, sy);
    if (Math.abs(denom) < 1e-6) {
      return;
    }
    const ax = a.x - center.x;
    const ay = a.y - center.y;
    const t = cross(ax, ay, sx, sy) / denom;
    const u = cross(ax, ay, ray.x, ray.y) / denom;
    if (t >= 0 && u >= 0 && u <= 1) {
      if (t < bestT) {
        bestT = t;
        bestX = center.x + ray.x * t;
        bestY = center.y + ray.y * t;
        hasBest = true;
      }
    }
  });
  if (!hasBest) {
    return null;
  }
  return { x: bestX, y: bestY };
};

const drawShoreWash = (
  ctx: CanvasRenderingContext2D,
  p0: { x: number; y: number },
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  anchor: { x: number; y: number },
  center: { x: number; y: number },
  color: { r: number; g: number; b: number },
  bandPx: number,
  alpha: number
) => {
  const dx = center.x - anchor.x;
  const dy = center.y - anchor.y;
  const len = Math.hypot(dx, dy);
  if (len <= 0.001) {
    return;
  }
  const t = Math.min(1, bandPx / len);
  const inner = { x: anchor.x + dx * t, y: anchor.y + dy * t };
  const grad = ctx.createLinearGradient(anchor.x, anchor.y, inner.x, inner.y);
  grad.addColorStop(0, rgbaString(color, alpha));
  grad.addColorStop(1, rgbaString(color, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.fill();
};

const getWaterSurfaceCorners = (state: WorldState, x: number, y: number) => {
  const tile = state.tiles[indexFor(state.grid, x, y)];
  const waterHeight = getTileHeight(tile);
  const landInfluence = getSmoothedWaterInfluence(state, x, y);
  const surfaceBlend = clamp(landInfluence * 0.85, 0, 0.8);
  const h00 = getRenderHeightAt(state, x, y);
  const h10 = getRenderHeightAt(state, x + 1, y);
  const h11 = getRenderHeightAt(state, x + 1, y + 1);
  const h01 = getRenderHeightAt(state, x, y + 1);
  const w00 = waterHeight + (h00 - waterHeight) * surfaceBlend;
  const w10 = waterHeight + (h10 - waterHeight) * surfaceBlend;
  const w11 = waterHeight + (h11 - waterHeight) * surfaceBlend;
  const w01 = waterHeight + (h01 - waterHeight) * surfaceBlend;
  const p0 = isoProject(x, y, w00);
  const p1 = isoProject(x + 1, y, w10);
  const p2 = isoProject(x + 1, y + 1, w11);
  const p3 = isoProject(x, y + 1, w01);
  return { p0, p1, p2, p3, landInfluence };
};

const drawWaterShallowsForTile = (state: WorldState, ctx: CanvasRenderingContext2D, x: number, y: number) => {
  const edgeMask = computeCoastEdgeMask(state, x, y);
  if (!edgeMask) {
    return;
  }
  const { p0, p1, p2, p3, landInfluence } = getWaterSurfaceCorners(state, x, y);
  const center = {
    x: (p0.x + p1.x + p2.x + p3.x) * 0.25,
    y: (p0.y + p1.y + p2.y + p3.y) * 0.25
  };
  const noise = getShoreNoise(state, x, y, 3);
  const bandBase = SHALLOWS_BAND_PX * noise.width;
  const baseColor = lighten(TILE_COLOR_RGB.water, clamp(SHALLOWS_LIGHTEN + landInfluence * 0.12, 0, 0.6));
  const anchor = getShoreAnchor(state, x, y, p0, p1, p2, p3, center, false);
  if (anchor) {
    const washJitter =
      1 + (hash2D(x + 19, y + 23, state.seed + 1213) - 0.5) * SHALLOWS_WASH_ALPHA_JITTER;
    const washAlpha = clamp(SHALLOWS_WASH_ALPHA * noise.alpha * washJitter, 0, 0.25);
    drawShoreWash(ctx, p0, p1, p2, p3, anchor, center, baseColor, SHALLOWS_WASH_BAND_PX * noise.width, washAlpha);
  }

  const drawEdge = (edgeId: number, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const jitter = (hash2D(x + edgeId * 41, y + edgeId * 43, state.seed + 881) - 0.5) * 2 * SHALLOWS_JITTER_PX;
    const band = Math.max(0.5, bandBase + jitter);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    const toCenter = { x: center.x - mid.x, y: center.y - mid.y };
    if (nx * toCenter.x + ny * toCenter.y < 0) {
      nx = -nx;
      ny = -ny;
    }
    const a2 = { x: a.x + nx * band, y: a.y + ny * band };
    const b2 = { x: b.x + nx * band, y: b.y + ny * band };
    const outerMid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    const innerMid = { x: (a2.x + b2.x) * 0.5, y: (a2.y + b2.y) * 0.5 };
    const alphaJitter =
      1 + (hash2D(x + edgeId * 47, y + edgeId * 53, state.seed + 907) - 0.5) * SHALLOWS_ALPHA_JITTER;
    const edgeAlpha = clamp(SHALLOWS_ALPHA * noise.alpha * alphaJitter, 0, 0.4);
    const grad = ctx.createLinearGradient(outerMid.x, outerMid.y, innerMid.x, innerMid.y);
    grad.addColorStop(0, rgbaString(baseColor, edgeAlpha));
    grad.addColorStop(1, rgbaString(baseColor, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.lineTo(a2.x, a2.y);
    ctx.closePath();
    ctx.fill();
  };

  ctx.save();
  clipToTile(ctx, p0, p1, p2, p3);
  if (edgeMask & COAST_EDGE_N) {
    drawEdge(1, p0, p1);
  }
  if (edgeMask & COAST_EDGE_E) {
    drawEdge(2, p1, p2);
  }
  if (edgeMask & COAST_EDGE_S) {
    drawEdge(3, p2, p3);
  }
  if (edgeMask & COAST_EDGE_W) {
    drawEdge(4, p3, p0);
  }
  ctx.restore();
};

const drawCoastBandForTile = (
  state: WorldState,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number
) => {
  const edgeMask = computeCoastEdgeMask(state, x, y);
  const neLand =
    x < state.grid.cols - 1 &&
    y > 0 &&
    state.tiles[indexFor(state.grid, x + 1, y - 1)].type !== "water";
  const seLand =
    x < state.grid.cols - 1 &&
    y < state.grid.rows - 1 &&
    state.tiles[indexFor(state.grid, x + 1, y + 1)].type !== "water";
  const swLand =
    x > 0 &&
    y < state.grid.rows - 1 &&
    state.tiles[indexFor(state.grid, x - 1, y + 1)].type !== "water";
  const nwLand =
    x > 0 &&
    y > 0 &&
    state.tiles[indexFor(state.grid, x - 1, y - 1)].type !== "water";
  if (!edgeMask && !neLand && !seLand && !swLand && !nwLand) {
    return;
  }
  const { p0, p1, p2, p3, landInfluence } = getWaterSurfaceCorners(state, x, y);
  const center = {
    x: (p0.x + p1.x + p2.x + p3.x) * 0.25,
    y: (p0.y + p1.y + p2.y + p3.y) * 0.25
  };
  const noise = getShoreNoise(state, x, y, 1);
  const bandBase = COAST_BAND_PX * noise.width;

  const drawEdge = (edgeId: number, a: { x: number; y: number }, b: { x: number; y: number }, neighborTile: WorldState["tiles"][number]) => {
    const edgeNoise = hash2D(x + edgeId * 11, y + edgeId * 29, state.seed + 991);
    const jitter = (edgeNoise * 2 - 1) * COAST_JITTER_PX;
    const band = Math.max(0.5, bandBase + jitter);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    const toCenter = { x: center.x - mid.x, y: center.y - mid.y };
    if (nx * toCenter.x + ny * toCenter.y < 0) {
      nx = -nx;
      ny = -ny;
    }
    const a2 = { x: a.x + nx * band, y: a.y + ny * band };
    const b2 = { x: b.x + nx * band, y: b.y + ny * band };
    const outerMid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    const innerMid = { x: (a2.x + b2.x) * 0.5, y: (a2.y + b2.y) * 0.5 };
    const shoreBase = lighten(TILE_COLOR_RGB.water, clamp(COAST_WATER_LIGHTEN + landInfluence * 0.12, 0, 0.6));
    const outerColor = shoreBase;
    const grad = ctx.createLinearGradient(outerMid.x, outerMid.y, innerMid.x, innerMid.y);
    const alphaJitter = 1 + (hash2D(x + edgeId * 17, y + edgeId * 37, state.seed + 733) - 0.5) * COAST_BAND_ALPHA_JITTER;
    const edgeAlpha = clamp(COAST_BAND_ALPHA * noise.alpha * alphaJitter, 0, 0.6);
    grad.addColorStop(0, rgbaString(outerColor, edgeAlpha));
    grad.addColorStop(1, rgbaString(TILE_COLOR_RGB.water, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.lineTo(a2.x, a2.y);
    ctx.closePath();
    ctx.fill();
  };

  if (edgeMask & COAST_EDGE_N) {
    const neighbor = state.tiles[indexFor(state.grid, x, y - 1)];
    drawEdge(1, p0, p1, neighbor);
  }
  if (edgeMask & COAST_EDGE_E) {
    const neighbor = state.tiles[indexFor(state.grid, x + 1, y)];
    drawEdge(2, p1, p2, neighbor);
  }
  if (edgeMask & COAST_EDGE_S) {
    const neighbor = state.tiles[indexFor(state.grid, x, y + 1)];
    drawEdge(3, p2, p3, neighbor);
  }
  if (edgeMask & COAST_EDGE_W) {
    const neighbor = state.tiles[indexFor(state.grid, x - 1, y)];
    drawEdge(4, p3, p0, neighbor);
  }

  const cornerPairs = [
    { mask: COAST_EDGE_N | COAST_EDGE_E, corner: p1, id: 11, neighbors: [[0, -1], [1, 0]], diag: neLand },
    { mask: COAST_EDGE_E | COAST_EDGE_S, corner: p2, id: 12, neighbors: [[1, 0], [0, 1]], diag: seLand },
    { mask: COAST_EDGE_S | COAST_EDGE_W, corner: p3, id: 13, neighbors: [[0, 1], [-1, 0]], diag: swLand },
    { mask: COAST_EDGE_W | COAST_EDGE_N, corner: p0, id: 14, neighbors: [[-1, 0], [0, -1]], diag: nwLand }
  ];
  const cornerRadius = Math.max(0.5, bandBase * COAST_CORNER_RADIUS_MULT);
  ctx.save();
  clipToTile(ctx, p0, p1, p2, p3);
  cornerPairs.forEach((corner) => {
    const hasAnyEdge = (edgeMask & corner.mask) !== 0;
    const hasBothEdges = (edgeMask & corner.mask) === corner.mask;
    const hasSingleEdge = hasAnyEdge && !hasBothEdges;
    const hasDiag = corner.diag;
    let cornerScale = 0;
    let radiusScale = 0;
    if (hasBothEdges) {
      cornerScale = hasDiag ? 1.12 : 1;
      radiusScale = hasDiag ? 1.05 : 1;
    } else if (hasSingleEdge && hasDiag) {
      cornerScale = 0.65;
      radiusScale = 0.78;
    } else if (hasDiag) {
      cornerScale = 0.45;
      radiusScale = 0.68;
    } else {
      return;
    }
    const outerColor = lighten(TILE_COLOR_RGB.water, clamp(COAST_WATER_LIGHTEN + landInfluence * 0.16, 0, 0.6));
    const alphaJitter =
      1 + (hash2D(x + corner.id * 19, y + corner.id * 27, state.seed + 901) - 0.5) * COAST_BAND_ALPHA_JITTER;
    const cornerAlpha = clamp(COAST_CORNER_ALPHA * noise.alpha * alphaJitter * cornerScale, 0, 0.6);
    const insetX = corner.corner.x + (center.x - corner.corner.x) * COAST_CORNER_INSET;
    const insetY = corner.corner.y + (center.y - corner.corner.y) * COAST_CORNER_INSET;
    const angle = Math.atan2(center.y - insetY, center.x - insetX);
    const radius = cornerRadius * radiusScale;
    ctx.save();
    ctx.translate(insetX, insetY);
    ctx.rotate(angle);
    ctx.scale(COAST_CORNER_STRETCH, COAST_CORNER_SQUASH);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    grad.addColorStop(0, rgbaString(outerColor, cornerAlpha));
    grad.addColorStop(1, rgbaString(outerColor, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();
};

const drawLandShoreFeatherForTile = (
  state: WorldState,
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number
) => {
  const edgeMask = computeLandCoastEdgeMask(state, x, y);
  const neWater =
    x < state.grid.cols - 1 &&
    y > 0 &&
    state.tiles[indexFor(state.grid, x + 1, y - 1)].type === "water";
  const seWater =
    x < state.grid.cols - 1 &&
    y < state.grid.rows - 1 &&
    state.tiles[indexFor(state.grid, x + 1, y + 1)].type === "water";
  const swWater =
    x > 0 &&
    y < state.grid.rows - 1 &&
    state.tiles[indexFor(state.grid, x - 1, y + 1)].type === "water";
  const nwWater =
    x > 0 &&
    y > 0 &&
    state.tiles[indexFor(state.grid, x - 1, y - 1)].type === "water";
  if (!edgeMask && !neWater && !seWater && !swWater && !nwWater) {
    return;
  }
  const tile = state.tiles[indexFor(state.grid, x, y)];
  const { p0, p1, p2, p3 } = getTileCorners(state, x, y);
  const center = {
    x: (p0.x + p1.x + p2.x + p3.x) * 0.25,
    y: (p0.y + p1.y + p2.y + p3.y) * 0.25
  };
  const noise = getShoreNoise(state, x, y, 2);
  const bandBase = LAND_SHORE_BAND_PX * noise.width;
  const shoreColor = mixRgb(getShoreLandColor(state, tile), SHALLOW_WATER_COLOR, LAND_SHORE_WATER_BLEND);
  const anchor = getShoreAnchor(state, x, y, p0, p1, p2, p3, center, true);
  if (anchor) {
    const washJitter =
      1 + (hash2D(x + 31, y + 37, state.seed + 1301) - 0.5) * LAND_WASH_ALPHA_JITTER;
    const washAlpha = clamp(LAND_WASH_ALPHA * noise.alpha * washJitter, 0, 0.3);
    drawShoreWash(ctx, p0, p1, p2, p3, anchor, center, shoreColor, LAND_WASH_BAND_PX * noise.width, washAlpha);
  }

  const drawEdge = (edgeId: number, a: { x: number; y: number }, b: { x: number; y: number }) => {
    const edgeNoise = hash2D(x + edgeId * 23, y + edgeId * 31, state.seed + 1451);
    const jitter = (edgeNoise * 2 - 1) * LAND_SHORE_JITTER_PX;
    const band = Math.max(0.5, bandBase + jitter);
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    let nx = -dy / len;
    let ny = dx / len;
    const mid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    const toCenter = { x: center.x - mid.x, y: center.y - mid.y };
    if (nx * toCenter.x + ny * toCenter.y < 0) {
      nx = -nx;
      ny = -ny;
    }
    const a2 = { x: a.x + nx * band, y: a.y + ny * band };
    const b2 = { x: b.x + nx * band, y: b.y + ny * band };
    const outerMid = { x: (a.x + b.x) * 0.5, y: (a.y + b.y) * 0.5 };
    const innerMid = { x: (a2.x + b2.x) * 0.5, y: (a2.y + b2.y) * 0.5 };
    const alphaJitter = 1 + (hash2D(x + edgeId * 29, y + edgeId * 41, state.seed + 1601) - 0.5) * LAND_SHORE_BAND_ALPHA_JITTER;
    const edgeAlpha = clamp(LAND_SHORE_BAND_ALPHA * noise.alpha * alphaJitter, 0, 0.6);
    const grad = ctx.createLinearGradient(outerMid.x, outerMid.y, innerMid.x, innerMid.y);
    grad.addColorStop(0, rgbaString(shoreColor, edgeAlpha));
    grad.addColorStop(1, rgbaString(shoreColor, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b2.x, b2.y);
    ctx.lineTo(a2.x, a2.y);
    ctx.closePath();
    ctx.fill();
  };

  if (edgeMask & COAST_EDGE_N) {
    drawEdge(1, p0, p1);
  }
  if (edgeMask & COAST_EDGE_E) {
    drawEdge(2, p1, p2);
  }
  if (edgeMask & COAST_EDGE_S) {
    drawEdge(3, p2, p3);
  }
  if (edgeMask & COAST_EDGE_W) {
    drawEdge(4, p3, p0);
  }

  const cornerPairs = [
    { mask: COAST_EDGE_N | COAST_EDGE_E, corner: p1, id: 21, diag: neWater },
    { mask: COAST_EDGE_E | COAST_EDGE_S, corner: p2, id: 22, diag: seWater },
    { mask: COAST_EDGE_S | COAST_EDGE_W, corner: p3, id: 23, diag: swWater },
    { mask: COAST_EDGE_W | COAST_EDGE_N, corner: p0, id: 24, diag: nwWater }
  ];
  const cornerRadius = Math.max(0.5, bandBase * LAND_SHORE_CORNER_RADIUS_MULT);
  ctx.save();
  clipToTile(ctx, p0, p1, p2, p3);
  cornerPairs.forEach((corner) => {
    const hasAnyEdge = (edgeMask & corner.mask) !== 0;
    const hasBothEdges = (edgeMask & corner.mask) === corner.mask;
    const hasSingleEdge = hasAnyEdge && !hasBothEdges;
    const hasDiag = corner.diag;
    let cornerScale = 0;
    let radiusScale = 0;
    if (hasBothEdges) {
      cornerScale = hasDiag ? 1.08 : 1;
      radiusScale = hasDiag ? 1.04 : 1;
    } else if (hasSingleEdge && hasDiag) {
      cornerScale = 0.6;
      radiusScale = 0.78;
    } else if (hasDiag) {
      cornerScale = 0.42;
      radiusScale = 0.66;
    } else {
      return;
    }
    const alphaJitter =
      1 + (hash2D(x + corner.id * 13, y + corner.id * 17, state.seed + 1709) - 0.5) * LAND_SHORE_BAND_ALPHA_JITTER;
    const cornerAlpha = clamp(LAND_SHORE_CORNER_ALPHA * noise.alpha * alphaJitter * cornerScale, 0, 0.6);
    const insetX = corner.corner.x + (center.x - corner.corner.x) * LAND_SHORE_CORNER_INSET;
    const insetY = corner.corner.y + (center.y - corner.corner.y) * LAND_SHORE_CORNER_INSET;
    const angle = Math.atan2(center.y - insetY, center.x - insetX);
    const radius = cornerRadius * radiusScale;
    ctx.save();
    ctx.translate(insetX, insetY);
    ctx.rotate(angle);
    ctx.scale(LAND_SHORE_CORNER_STRETCH, LAND_SHORE_CORNER_SQUASH);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
    grad.addColorStop(0, rgbaString(shoreColor, cornerAlpha));
    grad.addColorStop(1, rgbaString(shoreColor, 0));
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
  ctx.restore();
};

const drawCoastBands = (
  state: WorldState,
  renderState: RenderState,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  view: ViewTransform
) => {
  const bounds = getVisibleBounds(state, renderState, canvas, view);
  for (let y = bounds.startY; y <= bounds.endY; y += 1) {
    for (let x = bounds.startX; x <= bounds.endX; x += 1) {
      if (state.tiles[indexFor(state.grid, x, y)].type !== "water") {
        continue;
      }
      drawWaterShallowsForTile(state, ctx, x, y);
      drawCoastBandForTile(state, ctx, x, y);
    }
  }
};

const drawLandShoreFeather = (
  state: WorldState,
  renderState: RenderState,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  view: ViewTransform
) => {
  const bounds = getVisibleBounds(state, renderState, canvas, view);
  for (let y = bounds.startY; y <= bounds.endY; y += 1) {
    for (let x = bounds.startX; x <= bounds.endX; x += 1) {
      drawLandShoreFeatherForTile(state, ctx, x, y);
    }
  }
};

const pointKey = (point: CoastPoint) => `${point.x},${point.y}`;

const pointsEqual = (a: CoastPoint, b: CoastPoint) => a.x === b.x && a.y === b.y;

const buildCoastSegments = (state: WorldState): CoastSegment[] => {
  const segments: CoastSegment[] = [];
  const { cols, rows } = state.grid;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const tile = state.tiles[indexFor(state.grid, x, y)];
      if (tile.type === "water") {
        continue;
      }
      const northWater = y === 0 || state.tiles[indexFor(state.grid, x, y - 1)].type === "water";
      const eastWater = x === cols - 1 || state.tiles[indexFor(state.grid, x + 1, y)].type === "water";
      const southWater = y === rows - 1 || state.tiles[indexFor(state.grid, x, y + 1)].type === "water";
      const westWater = x === 0 || state.tiles[indexFor(state.grid, x - 1, y)].type === "water";
      const p00 = { x, y };
      const p10 = { x: x + 1, y };
      const p11 = { x: x + 1, y: y + 1 };
      const p01 = { x, y: y + 1 };
      if (northWater) {
        segments.push({ a: p00, b: p10 });
      }
      if (eastWater) {
        segments.push({ a: p10, b: p11 });
      }
      if (southWater) {
        segments.push({ a: p11, b: p01 });
      }
      if (westWater) {
        segments.push({ a: p01, b: p00 });
      }
    }
  }
  return segments;
};

const traceCoastlines = (segments: CoastSegment[]): CoastlinePath[] => {
  const adjacency = new Map<string, number[]>();
  const used = new Array(segments.length).fill(false);
  segments.forEach((segment, index) => {
    const aKey = pointKey(segment.a);
    const bKey = pointKey(segment.b);
    const aList = adjacency.get(aKey) ?? [];
    aList.push(index);
    adjacency.set(aKey, aList);
    const bList = adjacency.get(bKey) ?? [];
    bList.push(index);
    adjacency.set(bKey, bList);
  });

  const nextSegment = (current: CoastPoint, prev: CoastPoint | null) => {
    const list = adjacency.get(pointKey(current));
    if (!list) {
      return -1;
    }
    let fallback = -1;
    for (const idx of list) {
      if (used[idx]) {
        continue;
      }
      const seg = segments[idx];
      const other = pointsEqual(seg.a, current) ? seg.b : seg.a;
      if (prev && pointsEqual(other, prev)) {
        if (fallback === -1) {
          fallback = idx;
        }
        continue;
      }
      return idx;
    }
    return fallback;
  };

  const coastlines: CoastlinePath[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    if (used[i]) {
      continue;
    }
    used[i] = true;
    const seed = segments[i];
    const points: CoastPoint[] = [seed.a, seed.b];

    let current = seed.b;
    let previous = seed.a;
    while (true) {
      const nextIdx = nextSegment(current, previous);
      if (nextIdx === -1) {
        break;
      }
      used[nextIdx] = true;
      const nextSeg = segments[nextIdx];
      const nextPoint = pointsEqual(nextSeg.a, current) ? nextSeg.b : nextSeg.a;
      points.push(nextPoint);
      previous = current;
      current = nextPoint;
    }

    const backward: CoastPoint[] = [];
    current = seed.a;
    previous = seed.b;
    while (true) {
      const nextIdx = nextSegment(current, previous);
      if (nextIdx === -1) {
        break;
      }
      used[nextIdx] = true;
      const nextSeg = segments[nextIdx];
      const nextPoint = pointsEqual(nextSeg.a, current) ? nextSeg.b : nextSeg.a;
      backward.push(nextPoint);
      previous = current;
      current = nextPoint;
    }

    if (backward.length > 0) {
      backward.reverse();
      points.unshift(...backward);
    }

    let closed = false;
    if (points.length >= 3 && pointsEqual(points[0], points[points.length - 1])) {
      closed = true;
      points.pop();
    }
    if (points.length >= 2) {
      coastlines.push({ points, closed });
    }
  }

  return coastlines;
};

const smoothCoastline = (points: CoastPoint[], closed: boolean, iterations: number) => {
  let result = points;
  for (let iter = 0; iter < iterations; iter += 1) {
    if (result.length < 2) {
      break;
    }
    const next: CoastPoint[] = [];
    if (!closed) {
      next.push(result[0]);
    }
    const count = result.length;
    const limit = closed ? count : count - 1;
    for (let i = 0; i < limit; i += 1) {
      const a = result[i];
      const b = result[(i + 1) % count];
      const q = { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 };
      const r = { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 };
      next.push(q, r);
    }
    if (!closed) {
      next.push(result[count - 1]);
    }
    result = next;
  }
  return result;
};

const simplifyCoastline = (points: CoastPoint[], closed: boolean): CoastPoint[] => {
  if (points.length < 3) {
    return points;
  }
  const result: CoastPoint[] = [];
  const count = points.length;
  for (let i = 0; i < count; i += 1) {
    const prev = points[(i - 1 + count) % count];
    const current = points[i];
    const next = points[(i + 1) % count];
    if (!closed && (i === 0 || i === count - 1)) {
      result.push(current);
      continue;
    }
    const colinearX = prev.x === current.x && current.x === next.x;
    const colinearY = prev.y === current.y && current.y === next.y;
    if (colinearX || colinearY) {
      continue;
    }
    result.push(current);
  }
  return result.length >= 2 ? result : points;
};

const buildCoastlinePaths = (state: WorldState): CoastlinePath[] => {
  const segments = buildCoastSegments(state);
  const traced = traceCoastlines(segments);
  return traced.map((path) => ({
    closed: path.closed,
    points: smoothCoastline(simplifyCoastline(path.points, path.closed), path.closed, COASTLINE_SMOOTH_ITERATIONS)
  }));
};

const ensureCoastlineCache = (state: WorldState) => {
  if (
    !coastlineCache ||
    coastlineCache.tilesRef !== state.tiles ||
    coastlineCache.cols !== state.grid.cols ||
    coastlineCache.rows !== state.grid.rows
  ) {
    coastlineCache = {
      paths: buildCoastlinePaths(state),
      tilesRef: state.tiles,
      cols: state.grid.cols,
      rows: state.grid.rows
    };
  }
  return coastlineCache;
};

const drawCoastlinePaths = (state: WorldState, ctx: CanvasRenderingContext2D) => {
  const coastline = ensureCoastlineCache(state);
  if (coastline.paths.length === 0) {
    return;
  }
  const edgeColor = darken(COASTLINE_COLOR, COASTLINE_EDGE_DARKEN);
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = rgbaString(COASTLINE_COLOR, COASTLINE_STROKE_ALPHA);
  ctx.lineWidth = COASTLINE_STROKE_WIDTH;
  coastline.paths.forEach((path) => {
    if (path.points.length < 2) {
      return;
    }
    const first = path.points[0];
    const start = isoProject(first.x, first.y, getRenderHeightAt(state, first.x, first.y));
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    for (let i = 1; i < path.points.length; i += 1) {
      const point = path.points[i];
      const pos = isoProject(point.x, point.y, getRenderHeightAt(state, point.x, point.y));
      ctx.lineTo(pos.x, pos.y);
    }
    if (path.closed) {
      ctx.closePath();
    }
    ctx.stroke();
  });

  if (COASTLINE_EDGE_ALPHA > 0 && COASTLINE_EDGE_WIDTH > 0) {
    ctx.strokeStyle = rgbaString(edgeColor, COASTLINE_EDGE_ALPHA);
    ctx.lineWidth = COASTLINE_EDGE_WIDTH;
    coastline.paths.forEach((path) => {
      if (path.points.length < 2) {
        return;
      }
      const first = path.points[0];
      const start = isoProject(first.x, first.y, getRenderHeightAt(state, first.x, first.y));
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      for (let i = 1; i < path.points.length; i += 1) {
        const point = path.points[i];
        const pos = isoProject(point.x, point.y, getRenderHeightAt(state, point.x, point.y));
        ctx.lineTo(pos.x, pos.y);
      }
      if (path.closed) {
        ctx.closePath();
      }
      ctx.stroke();
    });
  }
  ctx.restore();
};

const drawGridOverlay = (
  state: WorldState,
  renderState: RenderState,
  inputState: InputState,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  view: { scale: number; offsetX: number; offsetY: number }
): void => {
  const zoomFactor = clamp((view.scale - 0.75) / 1.3, 0, 1);
  const gridActive =
    state.deployMode !== null ||
    state.selectedUnitIds.length > 0 ||
    inputState.selectionBox !== null ||
    inputState.formationStart !== null ||
    inputState.formationEnd !== null ||
    inputState.clearLineStart !== null;
  const hoverBoost = inputState.debugHoverTile !== null;
  const baseAlpha = 0.03 + 0.1 * zoomFactor;
  const boostAlpha = (gridActive || hoverBoost ? 0.24 : 0) * zoomFactor;
  const alpha = clamp(baseAlpha + boostAlpha, 0, 0.35);
  if (alpha < 0.02) {
    return;
  }

  const bounds = getVisibleBounds(state, renderState, canvas, view);
  ctx.save();
  ctx.lineWidth = Math.max(0.8, 1.1 / view.scale);

  for (let y = bounds.startY; y <= bounds.endY; y += 1) {
    for (let x = bounds.startX; x <= bounds.endX; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      if (tile.type === "water" || tile.type === "road" || tile.type === "base" || tile.type === "house") {
        continue;
      }
      let tileAlpha = alpha;
      if (tile.type === "forest") {
        tileAlpha *= 0.75;
      } else if (tile.type === "ash") {
        tileAlpha *= 0.6;
      }
      if (tile.waterDist <= 1) {
        tileAlpha *= 0.2;
      } else if (tile.waterDist === 2) {
        tileAlpha *= 0.5;
      }
      const nearRoad =
        (x > 0 && ["road", "base"].includes(state.tiles[indexFor(state.grid, x - 1, y)].type)) ||
        (x < state.grid.cols - 1 && ["road", "base"].includes(state.tiles[indexFor(state.grid, x + 1, y)].type)) ||
        (y > 0 && ["road", "base"].includes(state.tiles[indexFor(state.grid, x, y - 1)].type)) ||
        (y < state.grid.rows - 1 && ["road", "base"].includes(state.tiles[indexFor(state.grid, x, y + 1)].type));
      if (nearRoad) {
        tileAlpha *= 0.3;
      }
      if (tileAlpha < 0.01) {
        continue;
      }
      const p0 = isoProject(x, y, getRenderHeightAt(state, x, y));
      const p1 = isoProject(x + 1, y, getRenderHeightAt(state, x + 1, y));
      const p2 = isoProject(x + 1, y + 1, getRenderHeightAt(state, x + 1, y + 1));
      const p3 = isoProject(x, y + 1, getRenderHeightAt(state, x, y + 1));
      const color = GRID_COLORS[tile.type] ?? GRID_COLORS.grass;
      ctx.strokeStyle = rgbaString(color, tileAlpha);
      const edgeAllowed = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= state.grid.cols || ny >= state.grid.rows) {
          return false;
        }
        const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
        return neighbor.type !== "water" && neighbor.type !== "road" && neighbor.type !== "base";
      };
      if (edgeAllowed(x, y - 1)) {
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      if (edgeAllowed(x + 1, y)) {
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
      if (edgeAllowed(x, y + 1)) {
        ctx.beginPath();
        ctx.moveTo(p2.x, p2.y);
        ctx.lineTo(p3.x, p3.y);
        ctx.stroke();
      }
      if (edgeAllowed(x - 1, y)) {
        ctx.beginPath();
        ctx.moveTo(p3.x, p3.y);
        ctx.lineTo(p0.x, p0.y);
        ctx.stroke();
      }
    }
  }

  if (inputState.debugHoverTile) {
    const { x, y } = inputState.debugHoverTile;
    const p0 = isoProject(x, y, getRenderHeightAt(state, x, y));
    const p1 = isoProject(x + 1, y, getRenderHeightAt(state, x + 1, y));
    const p2 = isoProject(x + 1, y + 1, getRenderHeightAt(state, x + 1, y + 1));
    const p3 = isoProject(x, y + 1, getRenderHeightAt(state, x, y + 1));
    ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
    ctx.lineWidth = Math.max(1.2, 1.6 / view.scale);
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.stroke();
  }

  ctx.restore();
};

const drawDebugCellHighlight = (
  state: WorldState,
  ctx: CanvasRenderingContext2D,
  view: { scale: number },
  tileX: number,
  tileY: number
): void => {
  const idx = indexFor(state.grid, tileX, tileY);
  const p0 = isoProject(tileX, tileY, getRenderHeightAt(state, tileX, tileY));
  const p1 = isoProject(tileX + 1, tileY, getRenderHeightAt(state, tileX + 1, tileY));
  const p2 = isoProject(tileX + 1, tileY + 1, getRenderHeightAt(state, tileX + 1, tileY + 1));
  const p3 = isoProject(tileX, tileY + 1, getRenderHeightAt(state, tileX, tileY + 1));

  ctx.save();
  ctx.lineWidth = Math.max(1, 1.5 / view.scale);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.fillStyle = "rgba(255, 255, 255, 0.08)";
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.lineTo(p1.x, p1.y);
  ctx.lineTo(p2.x, p2.y);
  ctx.lineTo(p3.x, p3.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const drawDebugCellPanel = (
  state: WorldState,
  renderState: RenderState,
  inputState: InputState,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  tileX: number,
  tileY: number
): void => {
  const idx = indexFor(state.grid, tileX, tileY);
  const tile = state.tiles[idx];
  const cachedFire = state.tileFire[idx];
  const cachedHeat = state.tileHeat[idx];
  const cachedFuel = state.tileFuel[idx];
  const cachedWetness = state.tileSuppressionWetness[idx];
  const cachedIgniteAt = state.tileIgniteAt[idx];
  const cachedIgnition = state.tileIgnitionPoint[idx];
  const cachedBurnRate = state.tileBurnRate[idx];
  const cachedHeatOutput = state.tileHeatOutput[idx];
  const smoothFire = renderState.renderFireSmooth[idx];
  const inBounds =
    state.fireBoundsActive &&
    tileX >= state.fireMinX &&
    tileX <= state.fireMaxX &&
    tileY >= state.fireMinY &&
    tileY <= state.fireMaxY;
  const hoverWorld = inputState.debugHoverWorld;
  const height = getRenderHeightAt(state, tileX + 0.5, tileY + 0.5);

  const lines = [
    `cell ${tileX},${tileY}`,
    `type=${tile.type} id=${state.tileTypeId[idx] ?? "n/a"} base=${tile.isBase ? "1" : "0"}`,
    `phase=${state.phase} paused=${state.paused ? "1" : "0"} fireDay=${formatNumber(state.fireSeasonDay, 2)}`,
    `substeps=${state.firePerfSubsteps} fireDays=${formatNumber(state.firePerfSimulatedDays, 2)} active=${state.lastActiveFires}`,
    `fire=${formatNumber(tile.fire)} heat=${formatNumber(tile.heat)} fuel=${formatNumber(tile.fuel)}`,
    `ignite=${formatNumber(tile.ignitionPoint)} burn=${formatNumber(tile.burnRate)} heatOut=${formatNumber(tile.heatOutput)}`,
    `spread=${formatOptional(tile.spreadBoost)} cap=${formatOptional(tile.heatTransferCap)} retain=${formatOptional(tile.heatRetention)}`,
    `wind=${formatOptional(tile.windFactor)} moist=${formatNumber(tile.moisture)} canopy=${formatNumber(tile.canopy)}`,
    `ashAge=${formatNumber(tile.ashAge, 2)} elev=${formatNumber(tile.elevation)} height=${formatNumber(height, 2)}`,
    `cache fire=${formatNumber(cachedFire)} heat=${formatNumber(cachedHeat)} fuel=${formatNumber(cachedFuel)} wet=${formatNumber(cachedWetness)}`,
    `cache ignite=${formatNumber(cachedIgnition)} burn=${formatNumber(cachedBurnRate)} heatOut=${formatNumber(cachedHeatOutput)}`,
    `igniteAt=${formatNumber(cachedIgniteAt, 3)} smooth=${formatNumber(smoothFire)}`,
    `bounds active=${state.fireBoundsActive ? "1" : "0"} in=${inBounds ? "1" : "0"}`,
    hoverWorld ? `world ${formatNumber(hoverWorld.x, 2)},${formatNumber(hoverWorld.y, 2)}` : "world n/a"
  ];

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textBaseline = "top";
  const padding = 8;
  const lineHeight = 14;
  let maxWidth = 0;
  lines.forEach((line) => {
    const width = ctx.measureText(line).width;
    if (width > maxWidth) {
      maxWidth = width;
    }
  });
  const boxWidth = Math.min(canvas.width - padding * 2, maxWidth + padding * 2);
  const boxHeight = lines.length * lineHeight + padding * 2;
  const boxX = Math.max(padding, canvas.width - boxWidth - padding);
  const boxY = Math.max(padding, canvas.height - boxHeight - padding);
  ctx.fillStyle = "rgba(0, 0, 0, 0.75)";
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.2)";
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
  ctx.fillStyle = "#e8e8e8";
  lines.forEach((line, i) => {
    ctx.fillText(line, boxX + padding, boxY + padding + i * lineHeight);
  });
  ctx.restore();
};

/**
 * The main rendering function for the game.
 * Orchestrates drawing the terrain, fire, units, particles, and UI elements.
 * @param state The current world state.
 * @param canvas The target HTML canvas element.
 * @param ctx The 2D rendering context of the canvas.
 * @param alpha Interpolation factor between the previous and current sim step.
 */
/**
 * @deprecated Legacy 2D renderer. Prefer the 3D render backend.
 */
export function draw(
  state: WorldState,
  renderState: RenderState,
  inputState: InputState,
  effectsState: EffectsState,
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  alpha = 1
): void {
  // Ensure the Structure-of-Arrays tile data is in sync with the main state.
  ensureTileSoA(state);
  setHeightScale(getHeightScale(state));
  logTerrainRenderStats(state);

  const view = getViewTransform(state, renderState, canvas);
  const now = performance.now();
  const frameDeltaMs = renderState.lastRenderTime > 0 ? Math.min(200, Math.max(0, now - renderState.lastRenderTime)) : 16.6667;
  const timeSpeedOptions = getTimeSpeedOptions(state.simTimeMode);
  const timeSpeedIndex = Math.max(0, Math.min(timeSpeedOptions.length - 1, state.timeSpeedIndex ?? 0));
  const fireAnimationRate = state.paused ? 0 : (timeSpeedOptions[timeSpeedIndex] ?? 1);
  if (renderState.fireAnimationTimeMs <= 0) {
    renderState.fireAnimationTimeMs = now;
  } else if (frameDeltaMs > 0 && fireAnimationRate > 0) {
    renderState.fireAnimationTimeMs += frameDeltaMs * fireAnimationRate;
  }

  // Update smoothed fire values for rendering
  updateFireSmoothing(state, renderState, now);
  renderState.lastRenderTime = now;

  // --- Main Rendering ---
  const cache = ensureTerrainCache(state, inputState, now);

  // Reset transform and clear screen
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Apply camera view transform
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);

  // Draw the pre-rendered terrain from its cache
  ctx.drawImage(cache.canvas, cache.originX, cache.originY);
  drawCoastlinePaths(state, ctx);
  drawGridOverlay(state, renderState, inputState, canvas, ctx, view);
  const treeLayer = ensureTreeLayerCache(state, renderState, inputState, now);
  if (treeLayer) {
    ctx.drawImage(treeLayer.canvas, treeLayer.originX, treeLayer.originY);
  }

  if (renderState.renderEffects) {
    // Draw formation line for units
    if (inputState.formationStart && inputState.formationEnd) {
      const startHeight = getRenderHeightAt(state, inputState.formationStart.x + 0.5, inputState.formationStart.y + 0.5);
      const endHeight = getRenderHeightAt(state, inputState.formationEnd.x + 0.5, inputState.formationEnd.y + 0.5);
      const start = isoProject(
        inputState.formationStart.x + 0.5,
        inputState.formationStart.y + 0.5,
        startHeight + TILE_SIZE * 0.1
      );
      const end = isoProject(
        inputState.formationEnd.x + 0.5,
        inputState.formationEnd.y + 0.5,
        endHeight + TILE_SIZE * 0.1
      );
      ctx.strokeStyle = "rgba(255, 255, 255, 0.65)";
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 6]);
      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const visibleBounds = getVisibleBounds(state, renderState, canvas, view);

    // Draw all fire effects
    drawFireFx(state, renderState, ctx, visibleBounds, view);

    // Draw all units and their related effects (selection, hoses)
    drawUnits(state, ctx, alpha);

    // Draw non-fire particles (smoke, water)
    drawParticles(state, effectsState, ctx);
  }

  // Draw screen-space UI elements like the selection box
  if (inputState.debugCellEnabled && inputState.debugHoverTile) {
    drawDebugCellHighlight(state, ctx, view, inputState.debugHoverTile.x, inputState.debugHoverTile.y);
  }
  if (inputState.debugCellEnabled && inputState.debugHoverTile) {
    drawDebugCellPanel(
      state,
      renderState,
      inputState,
      canvas,
      ctx,
      inputState.debugHoverTile.x,
      inputState.debugHoverTile.y
    );
  }
  if (inputState.selectionBox) {
    const { x1, y1, x2, y2 } = inputState.selectionBox;
    const left = Math.min(x1, x2);
    const top = Math.min(y1, y2);
    const width = Math.abs(x2 - x1);
    const height = Math.abs(y2 - y1);

    // Reset transform to draw in screen space
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgba(240, 179, 59, 0.15)";
    ctx.strokeStyle = "rgba(240, 179, 59, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.fillRect(left, top, width, height);
    ctx.strokeRect(left, top, width, height);
  }
}
