import type { WorldState } from "../core/state.js";
import { TILE_TYPE_IDS } from "../core/state.js";
import { clamp } from "../core/utils.js";

export type RGB = { r: number; g: number; b: number };

export type ThermalPalette = {
  low: RGB;
  mid: RGB;
  high: RGB;
};

const TYPE_WATER = TILE_TYPE_IDS.water;
const TYPE_FOREST = TILE_TYPE_IDS.forest;
const TYPE_ASH = TILE_TYPE_IDS.ash;
const TYPE_ROAD = TILE_TYPE_IDS.road;
const TYPE_BASE = TILE_TYPE_IDS.base;
const TYPE_HOUSE = TILE_TYPE_IDS.house;
const TYPE_FIREBREAK = TILE_TYPE_IDS.firebreak;
const TYPE_BEACH = TILE_TYPE_IDS.beach;
const TYPE_FLOODPLAIN = TILE_TYPE_IDS.floodplain;
const TYPE_SCRUB = TILE_TYPE_IDS.scrub;
const TYPE_ROCKY = TILE_TYPE_IDS.rocky;
const TYPE_BARE = TILE_TYPE_IDS.bare;

const mix = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t
});

const buildRanges = (sourceSize: number, destSize: number): { start: Int32Array; end: Int32Array } => {
  const start = new Int32Array(destSize);
  const end = new Int32Array(destSize);
  for (let i = 0; i < destSize; i += 1) {
    const min = Math.floor((i / destSize) * sourceSize);
    const max = Math.max(min + 1, Math.ceil(((i + 1) / destSize) * sourceSize));
    start[i] = min;
    end[i] = Math.min(sourceSize, max);
  }
  return { start, end };
};

const getAmbientTileHeat01 = (
  world: WorldState,
  idx: number,
  typeId: number,
  riverMask: Uint8Array | undefined
): number => {
  if (typeId === TYPE_WATER) {
    return riverMask && riverMask[idx] > 0 ? 0.06 : 0.025;
  }

  const tiles = world.tiles;
  const moisture = clamp(world.tileMoisture[idx] ?? tiles[idx]?.moisture ?? 0, 0, 1);
  const dryness = 1 - moisture;
  const elevation = clamp(world.tileElevation[idx] ?? tiles[idx]?.elevation ?? 0, 0, 1);
  const canopy = clamp(world.tileCanopyCover[idx] ?? tiles[idx]?.canopyCover ?? tiles[idx]?.canopy ?? 0, 0, 1);
  const valley = clamp((world.valleyMap[idx] ?? 0) * 3.2, 0, 1);
  const noise = clamp(world.colorNoiseMap[idx] ?? 0.5, 0, 1);
  const waterDist01 = clamp((tiles[idx]?.waterDist ?? 24) / 24, 0, 1);

  let ambient = 0.19;
  ambient += dryness * 0.24;
  ambient += waterDist01 * 0.07;
  ambient += (noise - 0.5) * 0.18;
  ambient += (0.45 - canopy) * 0.08;
  ambient -= elevation * 0.1;
  ambient -= moisture * 0.08;
  ambient -= canopy * 0.1;
  ambient -= valley * 0.2;

  switch (typeId) {
    case TYPE_BEACH:
      ambient += 0.06;
      break;
    case TYPE_FLOODPLAIN:
      ambient -= 0.06;
      break;
    case TYPE_SCRUB:
      ambient += 0.04;
      break;
    case TYPE_FOREST:
      ambient -= 0.05;
      break;
    case TYPE_ROCKY:
      ambient += 0.08;
      break;
    case TYPE_BARE:
      ambient += 0.12;
      break;
    case TYPE_ASH:
      ambient += 0.12;
      break;
    case TYPE_ROAD:
      ambient += 0.05;
      break;
    case TYPE_BASE:
    case TYPE_HOUSE:
      ambient += 0.06;
      break;
    case TYPE_FIREBREAK:
      ambient += 0.03;
      break;
    default:
      break;
  }

  if (riverMask && riverMask[idx] > 0) {
    ambient = Math.min(ambient, 0.08 + ambient * 0.18);
  }

  return clamp(ambient, 0.025, 0.66);
};

export const buildThermalBackdropField = (
  world: WorldState,
  mapWidth: number,
  mapHeight: number
): Float32Array => {
  const field = new Float32Array(mapWidth * mapHeight);
  const cols = world.grid.cols;
  const rows = world.grid.rows;
  if (cols <= 0 || rows <= 0) {
    return field;
  }

  const { start: xStart, end: xEnd } = buildRanges(cols, mapWidth);
  const { start: yStart, end: yEnd } = buildRanges(rows, mapHeight);
  const tileTypes = world.tileTypeId;
  const riverMask = world.tileRiverMask;

  for (let py = 0; py < mapHeight; py += 1) {
    const minY = yStart[py];
    const maxY = yEnd[py];
    for (let px = 0; px < mapWidth; px += 1) {
      const minX = xStart[px];
      const maxX = xEnd[px];
      let sum = 0;
      let coolest = 1;
      let sampleCount = 0;
      let waterCount = 0;
      let riverCount = 0;

      for (let ty = minY; ty < maxY; ty += 1) {
        let idx = ty * cols + minX;
        for (let tx = minX; tx < maxX; tx += 1, idx += 1) {
          const typeId = tileTypes[idx] ?? 0;
          const ambient = getAmbientTileHeat01(world, idx, typeId, riverMask);
          sum += ambient;
          coolest = Math.min(coolest, ambient);
          sampleCount += 1;
          if (typeId === TYPE_WATER) {
            waterCount += 1;
          }
          if (riverMask && riverMask[idx] > 0) {
            riverCount += 1;
          }
        }
      }

      const avg = sampleCount > 0 ? sum / sampleCount : 0.2;
      const waterRatio = sampleCount > 0 ? waterCount / sampleCount : 0;
      const riverRatio = sampleCount > 0 ? riverCount / sampleCount : 0;
      const coolBlend = clamp(waterRatio * 0.82 + riverRatio * 0.55, 0, 0.9);
      let value = avg * (1 - coolBlend) + coolest * coolBlend;
      if (riverRatio > 0 && waterRatio < 0.25) {
        value -= riverRatio * 0.05;
      }
      field[py * mapWidth + px] = clamp(value, 0, 1);
    }
  }

  return field;
};

export const buildThermalHotspotField = (
  world: WorldState,
  mapWidth: number,
  mapHeight: number
): Float32Array => {
  const field = new Float32Array(mapWidth * mapHeight);
  const cols = world.grid.cols;
  const rows = world.grid.rows;
  if (cols <= 0 || rows <= 0) {
    return field;
  }

  const fire = world.tileFire;
  const heat = world.tileHeat;
  const heatCap = Math.max(0.01, world.fireSettings.heatCap);
  const baseRadiusPx = clamp(Math.round(1 + Math.max(cols / mapWidth, rows / mapHeight) * 0.2), 1, 4);

  let minX = 0;
  let maxX = cols - 1;
  let minY = 0;
  let maxY = rows - 1;
  if (world.fireBoundsActive) {
    minX = clamp(world.fireMinX - 2, 0, cols - 1);
    maxX = clamp(world.fireMaxX + 2, 0, cols - 1);
    minY = clamp(world.fireMinY - 2, 0, rows - 1);
    maxY = clamp(world.fireMaxY + 2, 0, rows - 1);
  } else if (world.fireActivityState === "idle") {
    return field;
  }

  for (let y = minY; y <= maxY; y += 1) {
    let idx = y * cols + minX;
    for (let x = minX; x <= maxX; x += 1, idx += 1) {
      const fire01 = clamp(fire[idx] ?? 0, 0, 1);
      const heat01 = clamp((heat[idx] ?? 0) / heatCap, 0, 1);
      const hotspot01 = clamp(Math.max(fire01 * 1.18, heat01 * 0.88), 0, 1);
      if (hotspot01 <= 0.025) {
        continue;
      }

      const px = clamp(Math.floor(((x + 0.5) / cols) * mapWidth), 0, mapWidth - 1);
      const py = clamp(Math.floor(((y + 0.5) / rows) * mapHeight), 0, mapHeight - 1);
      const radius = baseRadiusPx + Math.round(fire01 * 2 + heat01);

      for (let oy = -radius; oy <= radius; oy += 1) {
        const sy = py + oy;
        if (sy < 0 || sy >= mapHeight) {
          continue;
        }
        for (let ox = -radius; ox <= radius; ox += 1) {
          const sx = px + ox;
          if (sx < 0 || sx >= mapWidth) {
            continue;
          }
          const dist = Math.hypot(ox, oy);
          if (dist > radius + 0.15) {
            continue;
          }
          const falloff = 1 - dist / (radius + 0.15);
          const contribution = hotspot01 * (0.35 + 0.65 * Math.pow(Math.max(0, falloff), 0.9));
          const sampleIdx = sy * mapWidth + sx;
          if (contribution > field[sampleIdx]) {
            field[sampleIdx] = contribution;
          }
        }
      }
    }
  }

  return field;
};

export const paintThermalField = (
  data: Uint8ClampedArray,
  backdrop: Float32Array,
  hotspots: Float32Array,
  palette: ThermalPalette
): void => {
  const pixelCount = Math.min(backdrop.length, hotspots.length);
  for (let i = 0; i < pixelCount; i += 1) {
    const ambient = clamp(0.04 + backdrop[i] * 0.72, 0, 0.72);
    const hotspotBoost = hotspots[i] > 0 ? Math.pow(hotspots[i], 0.6) : 0;
    const heat01 = clamp(ambient * (1 - hotspotBoost * 0.34) + hotspotBoost * 1.05, 0, 1);
    const color =
      heat01 <= 0.5
        ? mix(palette.low, palette.mid, heat01 / 0.5)
        : mix(palette.mid, palette.high, (heat01 - 0.5) / 0.5);
    const base = i * 4;
    data[base] = Math.round(color.r);
    data[base + 1] = Math.round(color.g);
    data[base + 2] = Math.round(color.b);
    data[base + 3] = 255;
  }
};
