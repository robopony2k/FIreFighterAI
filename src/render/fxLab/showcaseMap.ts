import {
  COAST_CLASS_BEACH,
  COAST_CLASS_CLIFF,
  COAST_CLASS_NONE,
  COAST_CLASS_SHELF_WATER,
  TILE_TYPE_IDS,
  type WorldState
} from "../../core/state.js";
import { TREE_TYPE_IDS, TreeType, type TileType } from "../../core/types.js";

export const FX_LAB_SHOWCASE_MAP_ID = "fx-showcase-v1";
export const FX_LAB_SHOWCASE_SIZE = 72;
export const FX_LAB_SHOWCASE_SEA_LEVEL = 0.12;

export type FxLabTerrainStamp =
  | "raise"
  | "lower"
  | "flatten"
  | "grass"
  | "scrub"
  | "forest"
  | "rocky"
  | "bare"
  | "ash"
  | "clearing";

export type FxLabShowcaseMapState = {
  treeTypes: Uint8Array;
  baseFuel: Float32Array;
  protectedMask: Uint8Array;
};

export type FxLabStampResult = { changed: number; protected: number };

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const bump = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): number => {
  const d = Math.sqrt(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2);
  return 1 - smoothstep(0, 1, d);
};

const terrainFuel = (type: TileType): number => ({
  water: 0.02,
  beach: 0.04,
  floodplain: 0.46,
  grass: 0.78,
  scrub: 0.58,
  forest: 1,
  rocky: 0.12,
  bare: 0.08,
  ash: 0.03,
  road: 0.02,
  base: 0.02,
  house: 0.5,
  firebreak: 0.02
})[type];

const setLandType = (
  world: WorldState,
  map: FxLabShowcaseMapState,
  idx: number,
  type: TileType,
  treeType = TreeType.Scrub
): void => {
  world.tileTypeId[idx] = TILE_TYPE_IDS[type];
  const tile = world.tiles[idx];
  if (tile) tile.type = type;
  const fuel = terrainFuel(type);
  map.baseFuel[idx] = fuel;
  world.tileFuel[idx] = fuel;
  if (tile) tile.fuel = fuel;
  const forest = type === "forest";
  const scrub = type === "scrub";
  const floodplain = type === "floodplain";
  world.tileMoisture[idx] = forest ? 0.74 : floodplain ? 0.82 : scrub ? 0.48 : type === "ash" ? 0.18 : 0.56;
  world.tileVegetationAge[idx] = forest ? 28 : scrub ? 10 : floodplain ? 7 : type === "grass" ? 4 : 0;
  world.tileCanopyCover[idx] = forest ? 0.88 : scrub ? 0.3 : floodplain ? 0.12 : type === "grass" ? 0.06 : 0;
  world.tileStemDensity[idx] = forest ? 176 : scrub ? 78 : floodplain ? 12 : 0;
  world.tileSpreadBoost[idx] = forest ? 1.1 : scrub ? 0.92 : floodplain ? 0.72 : type === "grass" ? 0.78 : 0.2;
  world.tileHeatRetention[idx] = forest ? 1.15 : type === "rocky" ? 0.92 : type === "road" || type === "base" ? 0.24 : 0.84;
  world.tileWindFactor[idx] = forest ? 0.76 : 1;
  world.tileHeatTransferCap[idx] = type === "road" || type === "base" || type === "firebreak" ? 0.2 : 1;
  map.treeTypes[idx] = TREE_TYPE_IDS[treeType];
};

const buildDistanceField = (cols: number, rows: number, source: Uint8Array): Uint16Array => {
  const distances = new Uint16Array(cols * rows);
  distances.fill(cols + rows + 4);
  const queue = new Int32Array(cols * rows);
  let head = 0;
  let tail = 0;
  source.forEach((value, idx) => {
    if (value > 0) {
      distances[idx] = 0;
      queue[tail++] = idx;
    }
  });
  while (head < tail) {
    const idx = queue[head++];
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const neighbors = [x > 0 ? idx - 1 : -1, x + 1 < cols ? idx + 1 : -1, y > 0 ? idx - cols : -1, y + 1 < rows ? idx + cols : -1];
    for (const next of neighbors) {
      if (next >= 0 && distances[next] > distances[idx] + 1) {
        distances[next] = distances[idx] + 1;
        queue[tail++] = next;
      }
    }
  }
  return distances;
};

const shorelineRow = (x: number): number => {
  if (x < 14) return 12 + x * 0.16;
  if (x < 29) return 14.2 - (x - 14) * 0.12;
  if (x < 44) return 12.4 + (x - 29) * 0.18;
  if (x < 58) return 15.1 - (x - 44) * 0.23;
  return 11.9 + (x - 58) * 0.08;
};

const stampOceanAndCoast = (world: WorldState, map: FxLabShowcaseMapState): void => {
  const { cols, rows, totalTiles } = world.grid;
  world.tileOceanMask.fill(0);
  world.tileCoastClass.fill(COAST_CLASS_NONE);
  world.tileCoastDistance.fill(0);
  for (let i = 0; i < totalTiles; i += 1) world.tileSeaLevel[i] = FX_LAB_SHOWCASE_SEA_LEVEL;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      if (y + 0.5 > shorelineRow(x)) continue;
      world.tileOceanMask[idx] = 1;
      map.protectedMask[idx] = 1;
      setLandType(world, map, idx, "water");
    }
  }
  const toOcean = buildDistanceField(cols, rows, world.tileOceanMask);
  const landMask = Uint8Array.from(world.tileOceanMask, (value) => value > 0 ? 0 : 1);
  const toLand = buildDistanceField(cols, rows, landMask);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      if (world.tileOceanMask[idx]) {
        const distance = toLand[idx];
        world.tileCoastDistance[idx] = distance;
        world.tileCoastClass[idx] = distance <= 6 ? COAST_CLASS_SHELF_WATER : COAST_CLASS_NONE;
        world.tileElevation[idx] = Math.min(world.tileElevation[idx], FX_LAB_SHOWCASE_SEA_LEVEL - (0.004 + distance * 0.004));
        continue;
      }
      const distance = toOcean[idx];
      world.tileCoastDistance[idx] = distance;
      if (distance < 1 || distance > 2) continue;
      const cliff = x >= 29 && x <= 43;
      world.tileCoastClass[idx] = cliff ? COAST_CLASS_CLIFF : COAST_CLASS_BEACH;
      map.protectedMask[idx] = 1;
      if (cliff) {
        world.tileElevation[idx] = Math.max(world.tileElevation[idx], 0.2 + distance * 0.055);
        setLandType(world, map, idx, "rocky");
      } else {
        world.tileElevation[idx] = FX_LAB_SHOWCASE_SEA_LEVEL + 0.012 * distance;
        setLandType(world, map, idx, "beach");
      }
    }
  }
};

const riverCenterX = (y: number): number => {
  if (y >= 54) return 51 - (y - 54) * 0.25;
  if (y >= 42) return 51 - (54 - y) * 0.45;
  if (y >= 28) return 45.6 + (42 - y) * 0.16;
  return 47.8 - (28 - y) * 0.14;
};

const stampHydrology = (world: WorldState, map: FxLabShowcaseMapState): void => {
  const { cols, rows } = world.grid;
  const lakeCx = 51;
  const lakeCy = 57;
  for (let y = 51; y <= 63; y += 1) {
    for (let x = 44; x <= 58; x += 1) {
      const d = Math.sqrt(((x - lakeCx) / 7) ** 2 + ((y - lakeCy) / 5.3) ** 2);
      if (d > 1) continue;
      const idx = y * cols + x;
      const surface = 0.48;
      world.tileElevation[idx] = surface - 0.025 * (1 - d * 0.45);
      world.tileRiverMask[idx] = 0;
      world.tileLakeMask[idx] = 1;
      world.tileLakeSurface[idx] = surface;
      world.tileRiverBed[idx] = surface - 0.032;
      world.tileRiverSurface[idx] = surface;
      world.tileMoisture[idx] = 1;
      map.protectedMask[idx] = 1;
      setLandType(world, map, idx, "water");
    }
  }
  for (let y = 53; y >= 15; y -= 1) {
    const downstream = (53 - y) / 38;
    const center = riverCenterX(y);
    const waterfall = y >= 34 && y <= 36;
    const surface = 0.475 - downstream * 0.25 - (y <= 35 ? 0.095 : 0);
    const width = y <= 18 ? 2.1 : waterfall ? 1.35 : 1.15;
    for (let x = Math.floor(center - width - 2); x <= Math.ceil(center + width + 2); x += 1) {
      if (x < 0 || x >= cols) continue;
      const idx = y * cols + x;
      const distance = Math.abs(x + 0.5 - center);
      if (distance <= width) {
        world.tileElevation[idx] = Math.min(world.tileElevation[idx], surface - 0.018);
        world.tileRiverMask[idx] = 1;
        world.tileRiverBed[idx] = surface - (waterfall ? 0.04 : 0.024);
        world.tileRiverSurface[idx] = surface;
        world.tileRiverStepStrength[idx] = waterfall ? 0.98 : y >= 39 && y <= 42 ? 0.34 : 0.04;
        world.tileMoisture[idx] = 1;
        map.protectedMask[idx] = 1;
        setLandType(world, map, idx, "water");
      } else if (distance <= width + 1.7 && world.tileOceanMask[idx] === 0) {
        setLandType(world, map, idx, "floodplain");
        world.tileElevation[idx] = Math.max(world.tileElevation[idx], surface + 0.018);
      }
    }
  }
};

const stampInfrastructure = (world: WorldState, map: FxLabShowcaseMapState): void => {
  const cols = world.grid.cols;
  for (let x = 9; x <= 61; x += 1) {
    const y = 44;
    const idx = y * cols + x;
    setLandType(world, map, idx, "road");
    map.protectedMask[idx] = 1;
    world.tileRoadEdges[idx] = 5;
    if (world.tileRiverMask[idx]) world.tileRoadBridge[idx] = 1;
  }
  for (let y = 42; y <= 46; y += 1) {
    for (let x = 18; x <= 24; x += 1) {
      const idx = y * cols + x;
      setLandType(world, map, idx, "base");
      map.protectedMask[idx] = 1;
      world.tileElevation[idx] = 0.29;
    }
  }
  for (let y = 25; y <= 27; y += 1) {
    for (let x = 18; x <= 31; x += 1) {
      const idx = y * cols + x;
      setLandType(world, map, idx, "firebreak");
      map.protectedMask[idx] = 1;
    }
  }
  const houseSites = [[12, 48], [15, 50], [18, 49], [21, 51]] as const;
  for (const [x, y] of houseSites) {
    const idx = y * cols + x;
    setLandType(world, map, idx, "house");
    map.protectedMask[idx] = 1;
    world.tileStructure[idx] = 1;
    world.structureMask[idx] = 1;
  }
};

export const createFxLabShowcaseMap = (world: WorldState): FxLabShowcaseMapState => {
  const { cols, rows, totalTiles } = world.grid;
  if (cols !== FX_LAB_SHOWCASE_SIZE || rows !== FX_LAB_SHOWCASE_SIZE) throw new Error("FX showcase map requires a 72x72 grid.");
  const map: FxLabShowcaseMapState = {
    treeTypes: new Uint8Array(totalTiles),
    baseFuel: new Float32Array(totalTiles),
    protectedMask: new Uint8Array(totalTiles)
  };
  world.tileRiverMask.fill(0);
  world.tileLakeMask.fill(0);
  world.tileLakeSurface.fill(Number.NaN);
  world.tileLakeOutletMask.fill(0);
  world.tileRoadBridge.fill(0);
  world.tileRoadEdges.fill(0);
  world.tileRoadWallEdges.fill(0);
  world.tileRiverBed.fill(Number.NaN);
  world.tileRiverSurface.fill(Number.NaN);
  world.tileRiverStepStrength.fill(0);
  world.tileStructure.fill(0);
  world.structureMask.fill(0);
  world.tileTownId.fill(-1);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const plateau = bump(x, y, 18, 57, 16, 12) * 0.23;
      const ridge = bump(x, y, 37, 48, 9, 24) * 0.32;
      const easternHill = bump(x, y, 58, 34, 13, 15) * 0.2;
      const valley = bump(x, y, 47, 35, 8, 20) * 0.12;
      world.tileElevation[idx] = 0.18 + y * 0.0024 + plateau + ridge + easternHill - valley;
      let type: TileType = "grass";
      let tree = TreeType.Scrub;
      if (x <= 8 || (x >= 57 && y >= 45)) type = "rocky";
      else if (x >= 28 && x <= 43 && y >= 42) type = "forest";
      else if (x >= 49 && y >= 20 && y <= 43) type = "scrub";
      else if (x >= 8 && x <= 16 && y >= 20 && y <= 32) type = "bare";
      else if (x >= 18 && x <= 25 && y >= 17 && y <= 23) type = "ash";
      if (type === "forest") tree = (x + y) % 5 === 0 ? TreeType.Maple : (x + y) % 2 === 0 ? TreeType.Pine : TreeType.Oak;
      setLandType(world, map, idx, type, tree);
    }
  }
  stampOceanAndCoast(world, map);
  stampHydrology(world, map);
  stampInfrastructure(world, map);
  world.totalLandTiles = Math.max(1, totalTiles - world.tileOceanMask.reduce((sum, value) => sum + (value ? 1 : 0), 0));
  world.basePoint = { x: 21, y: 44 };
  world.terrainTypeRevision += 1;
  world.vegetationRevision += 1;
  world.structureRevision += 1;
  world.terrainDirty = false;
  return map;
};

export const applyFxLabTerrainStamp = (
  world: WorldState,
  map: FxLabShowcaseMapState,
  stamp: FxLabTerrainStamp,
  centerX: number,
  centerY: number,
  radius: 2 | 4 | 7
): FxLabStampResult => {
  const cx = Math.floor(centerX);
  const cy = Math.floor(centerY);
  const centerIdx = clamp(cy, 0, world.grid.rows - 1) * world.grid.cols + clamp(cx, 0, world.grid.cols - 1);
  const flattenHeight = world.tileElevation[centerIdx];
  let changed = 0;
  let protectedCount = 0;
  for (let y = Math.max(0, cy - radius); y <= Math.min(world.grid.rows - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(world.grid.cols - 1, cx + radius); x += 1) {
      const distance = Math.hypot(x - cx, y - cy);
      if (distance > radius) continue;
      const idx = y * world.grid.cols + x;
      if (map.protectedMask[idx]) {
        protectedCount += 1;
        continue;
      }
      const strength = 1 - distance / (radius + 0.5);
      if (stamp === "raise") world.tileElevation[idx] = clamp(world.tileElevation[idx] + 0.025 * strength, 0.13, 0.82);
      else if (stamp === "lower") world.tileElevation[idx] = clamp(world.tileElevation[idx] - 0.025 * strength, 0.13, 0.82);
      else if (stamp === "flatten") world.tileElevation[idx] += (flattenHeight - world.tileElevation[idx]) * Math.min(1, 0.62 * strength + 0.2);
      else if (stamp === "clearing") setLandType(world, map, idx, "grass");
      else setLandType(world, map, idx, stamp);
      const tile = world.tiles[idx];
      if (tile) tile.elevation = world.tileElevation[idx];
      changed += 1;
    }
  }
  if (changed > 0) {
    world.terrainTypeRevision += 1;
    world.vegetationRevision += 1;
    world.terrainDirty = true;
  }
  return { changed, protected: protectedCount };
};

export const replaceFxLabEditableMap = (
  world: WorldState,
  map: FxLabShowcaseMapState,
  elevations: readonly number[],
  tileTypes: readonly number[],
  treeTypes: readonly number[]
): void => {
  for (let i = 0; i < world.grid.totalTiles; i += 1) {
    if (map.protectedMask[i]) continue;
    world.tileElevation[i] = elevations[i];
    const typeId = tileTypes[i];
    const type = Object.entries(TILE_TYPE_IDS).find(([, value]) => value === typeId)?.[0] as TileType;
    setLandType(world, map, i, type, Object.values(TreeType)[treeTypes[i]] ?? TreeType.Scrub);
    map.treeTypes[i] = treeTypes[i];
    const tile = world.tiles[i];
    if (tile) tile.elevation = elevations[i];
  }
  world.terrainTypeRevision += 1;
  world.vegetationRevision += 1;
  world.terrainDirty = true;
};
