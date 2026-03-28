import type { RNG, Point, Town } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { DEBUG_TERRAIN } from "../core/config.js";
import { inBounds, indexFor } from "../core/grid.js";
import { getHouseFootprintBounds, pickHouseFootprint, type HouseFootprintBounds } from "../core/houseFootprints.js";
import {
  placeHouse,
  removeHouse,
  recountTownHouses,
  resolveNearestTownId,
  validateTownInvariants,
  STRUCTURE_HOUSE,
  STRUCTURE_NONE
} from "../core/towns.js";
import {
  ROAD_EDGE_DIRS,
  analyzeRoadEdgeQuality,
  backfillRoadEdgesFromAdjacency,
  carveRoad,
  carveRoadToTarget,
  carveRoadPath,
  clearRoadEdges,
  collectRoadTiles,
  findNearestRoadTile,
  findRoadPath,
  findRoadPathToTarget,
  getRoadGenerationStats,
  isRoadLikeTile,
  pruneRoadDiagonalStubs,
  resetRoadGenerationStats
} from "./roads.js";

const HOUSE_BUFFER_RADIUS = 1;
const BUILDABLE_SLOPE_LIMIT = 0.07;
const BUILDABLE_SLOPE_SCORE_WEIGHT = 20;
const HOUSE_PARCEL_APRON = 1;
const HOUSE_PREFERRED_RELIEF_LIMIT = 0.025;
const HOUSE_HARD_RELIEF_LIMIT = 0.055;
const HOUSE_RELIEF_SCORE_WEIGHT = 140;
const DETACHED_TOWN_CONNECTOR_HEIGHT_SCALE_CAP = 1;
const DETACHED_TOWN_CONNECTOR_CANDIDATE_LIMIT = 4;
const DETACHED_TOWN_WAYPOINT_SLOPE_LIMIT = 0.11;
const DETACHED_TOWN_WAYPOINT_SCORE_WEIGHT = 12;
const DETACHED_TOWN_WAYPOINT_OFFSET_MIN = 6;
const DETACHED_TOWN_WAYPOINT_OFFSET_MAX = 18;
const ENABLE_DEBUG_DETACHED_LAND_RECOVERY = false;

type DetachedTownConnectorRoadOptions = NonNullable<Parameters<typeof carveRoad>[4]>;

type HousePlacementContext = {
  bufferMask: Uint8Array;
  footprints: Map<number, HouseFootprintBounds>;
};

type HousePlacementCandidate = {
  x: number;
  y: number;
  bounds: HouseFootprintBounds;
  relief: number;
  score: number;
};

export type SettlementPlacementResult = {
  generatedRoads: boolean;
  diagonalPenalty?: number;
  pruneRedundantDiagonals?: boolean;
  bridgeTransitions?: boolean;
  heightScaleMultiplier?: number;
  townDensity?: number;
  bridgeAllowance?: number;
  settlementSpacing?: number;
  roadStrictness?: number;
};

type TownCenterSeed = Point & {
  radius: number;
};

const TOWN_NAME_POOL: readonly string[] = [
  "Ashbourne",
  "Ashford",
  "Ashbridge",
  "Ashmere",
  "Ashmoor",
  "Ashholt",
  "Ashhaven",
  "Ashwick",
  "Ashvale",
  "Ashgrove",
  "Cinderbrook",
  "Cinderford",
  "Cinderhollow",
  "Cindermere",
  "Emberleigh",
  "Emberford",
  "Emberfield",
  "Embervale",
  "Emberwick",
  "Emberton",
  "Burnside",
  "Burnham",
  "Burnhaven",
  "Burnholt",
  "Burnstead",
  "Burnwick",
  "Burnridge",
  "Burnmere",
  "Burnhollow",
  "Burncross",
  "Scorchfield",
  "Scorchford",
  "Scorchmere",
  "Scorchwell",
  "Charminster",
  "Charford",
  "Charbridge",
  "Charbury",
  "Charvale",
  "Charwood",
  "Smokebrook",
  "Smokeford",
  "Smokehaven",
  "Smokevale",
  "Sootbridge",
  "Sootmere",
  "Sooton",
  "Blackash",
  "Blackcinder",
  "Blackember",
  "Redhaven",
  "Redglen",
  "Redvale",
  "Brimstone Bay",
  "Brimstone Downs",
  "Firebreak Flats",
  "Firewatch Ridge",
  "Glowmere",
  "Hearthwick",
  "Pyrewick"
];

const createTownNameRng = (seed: number): (() => number) => {
  let state = (seed >>> 0) ^ 0xa511e9b3;
  return (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const shuffleTownNames = (seed: number): string[] => {
  const names = [...TOWN_NAME_POOL];
  const next = createTownNameRng(seed);
  for (let i = names.length - 1; i > 0; i -= 1) {
    const swapIndex = Math.floor(next() * (i + 1));
    const temp = names[i];
    names[i] = names[swapIndex];
    names[swapIndex] = temp;
  }
  return names;
};

const assignTownNames = (state: WorldState, centers: TownCenterSeed[]): void => {
  if (centers.length === 0) {
    state.towns = [];
    return;
  }
  const unique: TownCenterSeed[] = [];
  const seen = new Set<string>();
  centers.forEach((center) => {
    const key = `${center.x},${center.y}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    unique.push(center);
  });
  const ranked = unique
    .map((center, index) => ({
      x: center.x,
      y: center.y,
      radius: center.radius,
      index,
      dist: Math.hypot(center.x - state.basePoint.x, center.y - state.basePoint.y)
    }))
    .sort((a, b) => {
      if (a.index === 0 && b.index !== 0) {
        return -1;
      }
      if (b.index === 0 && a.index !== 0) {
        return 1;
      }
      if (a.dist !== b.dist) {
        return a.dist - b.dist;
      }
      if (a.y !== b.y) {
        return a.y - b.y;
      }
      return a.x - b.x;
    });
  const shuffledNames = shuffleTownNames(state.seed ^ state.grid.cols * 73856093 ^ state.grid.rows * 19349663);
  const towns: Town[] = ranked.map((center, index) => {
    const baseName = shuffledNames[index % shuffledNames.length];
    const suffix = index < shuffledNames.length ? "" : ` ${Math.floor(index / shuffledNames.length) + 1}`;
    return {
      id: index,
      name: `${baseName}${suffix}`,
      cx: center.x,
      cy: center.y,
      x: center.x,
      y: center.y,
      radius: Math.max(3, center.radius),
      houseCount: 0,
      housesLost: 0,
      alertPosture: 0,
      alertCooldownDays: 0,
      nonApprovingHouseCount: 0,
      approval: 1,
      evacState: "none",
      evacProgress: 0,
      lastPostureChangeDay: 0,
      desiredHouseDelta: 0,
      lastSeasonHouseDelta: 0
    };
  });
  state.towns = towns;
};

const noiseAt = (value: number): number => {
  const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const pickHouseRotation = (state: WorldState, tileX: number, tileY: number, seed: number): number => {
  const isRoadLike = (x: number, y: number): boolean => {
    return isRoadLikeTile(state, x, y);
  };
  const roadEW = isRoadLike(tileX - 1, tileY) || isRoadLike(tileX + 1, tileY);
  const roadNS = isRoadLike(tileX, tileY - 1) || isRoadLike(tileX, tileY + 1);
  const flip = noiseAt(seed + 21.4) < 0.5 ? 0 : Math.PI;
  if (roadEW && !roadNS) {
    return flip;
  }
  if (roadNS && !roadEW) {
    return Math.PI / 2 + flip;
  }
  return noiseAt(seed + 9.1) < 0.5 ? 0 : Math.PI / 2;
};

const isBuildableType = (type: WorldState["tiles"][number]["type"]): boolean =>
  type === "grass" || type === "scrub" || type === "floodplain" || type === "forest";

const canPlaceHouseFootprint = (
  state: WorldState,
  bounds: HouseFootprintBounds,
  context: HousePlacementContext
): boolean => {
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        return false;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.structureMask[idx] || context.bufferMask[idx]) {
        return false;
      }
      if (!isBuildableType(state.tiles[idx].type)) {
        return false;
      }
    }
  }
  return true;
};

const evaluateHouseFootprintRelief = (
  state: WorldState,
  bounds: HouseFootprintBounds,
  context: HousePlacementContext
): number | null => {
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;
  for (let y = bounds.minY - HOUSE_PARCEL_APRON; y <= bounds.maxY + HOUSE_PARCEL_APRON; y += 1) {
    for (let x = bounds.minX - HOUSE_PARCEL_APRON; x <= bounds.maxX + HOUSE_PARCEL_APRON; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        return null;
      }
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      const isFootprintTile = x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY;
      if (state.structureMask[idx] || context.bufferMask[idx]) {
        return null;
      }
      if (tile.type === "water" || tile.type === "base" || tile.type === "house") {
        return null;
      }
      if (isFootprintTile && !isBuildableType(tile.type)) {
        return null;
      }
      if (!isFootprintTile && !(isBuildableType(tile.type) || tile.type === "road")) {
        return null;
      }
      minElevation = Math.min(minElevation, tile.elevation);
      maxElevation = Math.max(maxElevation, tile.elevation);
    }
  }
  if (!Number.isFinite(minElevation) || !Number.isFinite(maxElevation)) {
    return null;
  }
  return maxElevation - minElevation;
};

const evaluateHousePlacementCandidate = (
  state: WorldState,
  x: number,
  y: number,
  origin: Point,
  context: HousePlacementContext
): HousePlacementCandidate | null => {
  if (!inBounds(state.grid, x, y) || !isHouseSpacingOk(state, x, y)) {
    return null;
  }
  const seed = y * state.grid.cols + x;
  const rotation = pickHouseRotation(state, x, y, seed);
  const footprint = pickHouseFootprint(seed);
  const bounds = getHouseFootprintBounds(x, y, rotation, footprint);
  if (!canPlaceHouseFootprint(state, bounds, context)) {
    return null;
  }
  const relief = evaluateHouseFootprintRelief(state, bounds, context);
  if (relief === null || relief > HOUSE_HARD_RELIEF_LIMIT) {
    return null;
  }
  const distance = Math.hypot(origin.x - x, origin.y - y);
  return {
    x,
    y,
    bounds,
    relief,
    score: distance + relief * HOUSE_RELIEF_SCORE_WEIGHT
  };
};

const findBestHouseSite = (
  state: WorldState,
  origin: Point,
  normalRadius: number,
  fallbackRadius: number,
  context: HousePlacementContext
): HousePlacementCandidate | null => {
  let preferred: HousePlacementCandidate | null = null;
  let fallback: HousePlacementCandidate | null = null;
  const consider = (candidate: HousePlacementCandidate): void => {
    if (candidate.relief <= HOUSE_PREFERRED_RELIEF_LIMIT) {
      if (!preferred || candidate.score < preferred.score) {
        preferred = candidate;
      }
      return;
    }
    if (!fallback || candidate.score < fallback.score) {
      fallback = candidate;
    }
  };

  const scan = (radius: number, minRadius = 0): void => {
    for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
      for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
        const dist = Math.hypot(origin.x - x, origin.y - y);
        if (dist < minRadius || dist > radius) {
          continue;
        }
        const candidate = evaluateHousePlacementCandidate(state, x, y, origin, context);
        if (candidate) {
          consider(candidate);
        }
      }
    }
  };

  scan(normalRadius);
  if (preferred) {
    return preferred;
  }
  if (fallbackRadius > normalRadius) {
    scan(fallbackRadius, normalRadius);
  }
  return fallback;
};

const markHouseFootprint = (
  state: WorldState,
  bounds: HouseFootprintBounds,
  context: HousePlacementContext
): void => {
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      state.structureMask[idx] = 1;
    }
  }
  const minX = bounds.minX - HOUSE_BUFFER_RADIUS;
  const maxX = bounds.maxX + HOUSE_BUFFER_RADIUS;
  const minY = bounds.minY - HOUSE_BUFFER_RADIUS;
  const maxY = bounds.maxY + HOUSE_BUFFER_RADIUS;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      context.bufferMask[idx] = 1;
    }
  }
};

const isFootprintAdjacentToRoad = (state: WorldState, bounds: HouseFootprintBounds): boolean => {
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      const neighbors = [
        { x: x + 1, y },
        { x: x - 1, y },
        { x, y: y + 1 },
        { x, y: y - 1 }
      ];
      for (const point of neighbors) {
        if (!inBounds(state.grid, point.x, point.y)) {
          continue;
        }
        if (
          point.x >= bounds.minX &&
          point.x <= bounds.maxX &&
          point.y >= bounds.minY &&
          point.y <= bounds.maxY
        ) {
          continue;
        }
        if (isRoadLikeTile(state, point.x, point.y)) {
          return true;
        }
      }
    }
  }
  return false;
};

const findFootprintEntryTile = (state: WorldState, bounds: HouseFootprintBounds): Point | null => {
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const minX = bounds.minX - HOUSE_BUFFER_RADIUS;
  const maxX = bounds.maxX + HOUSE_BUFFER_RADIUS;
  const minY = bounds.minY - HOUSE_BUFFER_RADIUS;
  const maxY = bounds.maxY + HOUSE_BUFFER_RADIUS;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        continue;
      }
      if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.structureMask[idx]) {
        continue;
      }
      const type = state.tiles[idx].type;
      if (type === "water") {
        continue;
      }
      const score = Math.abs(x - state.basePoint.x) + Math.abs(y - state.basePoint.y);
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
};

function isBuildable(state: WorldState, x: number, y: number): boolean {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const type = state.tiles[idx].type;
  if (!isBuildableType(type)) {
    return false;
  }
  const center = state.tiles[idx].elevation;
  let maxDiff = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
      if (!neighbor || neighbor.type === "water") {
        return false;
      }
      maxDiff = Math.max(maxDiff, Math.abs(center - neighbor.elevation));
    }
  }
  return maxDiff <= BUILDABLE_SLOPE_LIMIT;
}

function placeHouseAt(
  state: WorldState,
  x: number,
  y: number,
  value: number,
  residents: number,
  bounds: HouseFootprintBounds,
  context: HousePlacementContext
): boolean {
  if (!canPlaceHouseFootprint(state, bounds, context)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const tile = state.tiles[idx];
  tile.houseValue = value;
  tile.houseResidents = residents;
  tile.houseDestroyed = false;
  const townId = resolveNearestTownId(state, x, y);
  if (townId < 0 || !placeHouse(state, idx, townId)) {
    return false;
  }
  markHouseFootprint(state, bounds, context);
  context.footprints.set(idx, bounds);
  return true;
}

function countAdjacentHouses(state: WorldState, x: number, y: number): number {
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ];
  let count = 0;
  neighbors.forEach((point) => {
    if (!inBounds(state.grid, point.x, point.y)) {
      return;
    }
    if (state.tiles[indexFor(state.grid, point.x, point.y)].type === "house") {
      count += 1;
    }
  });
  return count;
}

function isHouseSpacingOk(state: WorldState, x: number, y: number): boolean {
  return countAdjacentHouses(state, x, y) <= 2;
}

function findNearbyBuildable(state: WorldState, origin: Point, radius: number): Point | null {
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      if (!inBounds(state.grid, x, y) || !isBuildable(state, x, y)) {
        continue;
      }
      const dist = Math.hypot(origin.x - x, origin.y - y);
      const idx = indexFor(state.grid, x, y);
      const center = state.tiles[idx].elevation;
      let maxDiff = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(state.grid, nx, ny)) {
            continue;
          }
          const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
          if (!neighbor) {
            continue;
          }
          maxDiff = Math.max(maxDiff, Math.abs(center - neighbor.elevation));
        }
      }
      const score = dist + maxDiff * BUILDABLE_SLOPE_SCORE_WEIGHT;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

function findSettlementRoadHub(state: WorldState, center: Point, minRadius: number, maxRadius: number): Point {
  const centerIdx = indexFor(state.grid, center.x, center.y);
  const centerElevation = state.tiles[centerIdx]?.elevation ?? 0;
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = center.y - maxRadius; y <= center.y + maxRadius; y += 1) {
    for (let x = center.x - maxRadius; x <= center.x + maxRadius; x += 1) {
      if (!inBounds(state.grid, x, y) || !isBuildable(state, x, y)) {
        continue;
      }
      const dx = x - center.x;
      const dy = y - center.y;
      const chebyshev = Math.max(Math.abs(dx), Math.abs(dy));
      if (chebyshev < minRadius || chebyshev > maxRadius) {
        continue;
      }
      const dist = Math.hypot(dx, dy);
      const idx = indexFor(state.grid, x, y);
      const elevation = state.tiles[idx]?.elevation ?? centerElevation;
      const downhillBias = Math.max(0, centerElevation - elevation);
      const uphillPenalty = Math.max(0, elevation - centerElevation);
      let localRelief = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) {
            continue;
          }
          const nx = x + ox;
          const ny = y + oy;
          if (!inBounds(state.grid, nx, ny)) {
            continue;
          }
          localRelief = Math.max(localRelief, Math.abs(elevation - (state.tiles[indexFor(state.grid, nx, ny)]?.elevation ?? elevation)));
        }
      }
      const score = dist * 0.3 + localRelief * BUILDABLE_SLOPE_SCORE_WEIGHT * 1.1 + uphillPenalty * 160 - downhillBias * 180;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best ?? center;
}

function findNearestConnectedRoadTile(state: WorldState, origin: Point, networkOrigin: Point): Point {
  const start = findNearestRoadTile(state, networkOrigin);
  const startIdx = indexFor(state.grid, start.x, start.y);
  if (!isRoadLikeTile(state, start.x, start.y)) {
    return start;
  }
  const visited = new Uint8Array(state.grid.totalTiles);
  const queue = new Int32Array(state.grid.totalTiles);
  let head = 0;
  let tail = 0;
  queue[tail] = startIdx;
  tail += 1;
  visited[startIdx] = 1;
  let best = start;
  let bestDist = Math.abs(origin.x - start.x) + Math.abs(origin.y - start.y);

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = { x, y };
    }
    const mask = state.tileRoadEdges[idx] ?? 0;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      if (visited[nIdx] > 0 || !isRoadLikeTile(state, nx, ny)) {
        continue;
      }
      visited[nIdx] = 1;
      queue[tail] = nIdx;
      tail += 1;
    }
  }

  return best;
}

function buildConnectedRoadMask(state: WorldState, networkOrigin: Point): Uint8Array {
  const visited = new Uint8Array(state.grid.totalTiles);
  const start = findNearestRoadTile(state, networkOrigin);
  const startIdx = indexFor(state.grid, start.x, start.y);
  if (!isRoadLikeTile(state, start.x, start.y)) {
    return visited;
  }
  const queue = new Int32Array(state.grid.totalTiles);
  let head = 0;
  let tail = 0;
  queue[tail] = startIdx;
  tail += 1;
  visited[startIdx] = 1;

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    const mask = state.tileRoadEdges[idx] ?? 0;
    for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
      const dir = ROAD_EDGE_DIRS[i];
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      if (visited[nIdx] > 0 || !isRoadLikeTile(state, nx, ny)) {
        continue;
      }
      visited[nIdx] = 1;
      queue[tail] = nIdx;
      tail += 1;
    }
  }

  return visited;
}

type RoadComponentSnapshot = {
  componentByIdx: Int32Array;
  componentCount: number;
  roadTileIndices: number[][];
};

function buildRoadComponentSnapshot(state: WorldState): RoadComponentSnapshot {
  const componentByIdx = new Int32Array(state.grid.totalTiles).fill(-1);
  const roadTileIndices: number[][] = [];
  let componentCount = 0;
  const queue = new Int32Array(state.grid.totalTiles);

  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (componentByIdx[idx] >= 0) {
      continue;
    }
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    if (!isRoadLikeTile(state, x, y)) {
      continue;
    }
    const tiles: number[] = [];
    let head = 0;
    let tail = 0;
    queue[tail] = idx;
    tail += 1;
    componentByIdx[idx] = componentCount;
    while (head < tail) {
      const current = queue[head];
      head += 1;
      tiles.push(current);
      const cx = current % state.grid.cols;
      const cy = Math.floor(current / state.grid.cols);
      const mask = state.tileRoadEdges[current] ?? 0;
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i];
        if ((mask & dir.bit) === 0) {
          continue;
        }
        const nx = cx + dir.dx;
        const ny = cy + dir.dy;
        if (!inBounds(state.grid, nx, ny) || !isRoadLikeTile(state, nx, ny)) {
          continue;
        }
        const nIdx = indexFor(state.grid, nx, ny);
        if (componentByIdx[nIdx] >= 0) {
          continue;
        }
        componentByIdx[nIdx] = componentCount;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    roadTileIndices.push(tiles);
    componentCount += 1;
  }

  return { componentByIdx, componentCount, roadTileIndices };
}

function findNearestRoadTileInComponent(
  state: WorldState,
  snapshot: RoadComponentSnapshot,
  componentId: number,
  origin: Point
): Point | null {
  const tiles = snapshot.roadTileIndices[componentId];
  if (!tiles || tiles.length === 0) {
    return null;
  }
  let best: Point | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let i = 0; i < tiles.length; i += 1) {
    const idx = tiles[i]!;
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
    if (dist < bestDist) {
      bestDist = dist;
      best = { x, y };
    }
  }
  return best;
}

function listNearestRoadTilesInComponent(
  state: WorldState,
  snapshot: RoadComponentSnapshot,
  componentId: number,
  origin: Point,
  limit: number
): Point[] {
  const tiles = snapshot.roadTileIndices[componentId];
  if (!tiles || tiles.length === 0) {
    return [];
  }
  return [...tiles]
    .sort((left, right) => {
      const lx = left % state.grid.cols;
      const ly = Math.floor(left / state.grid.cols);
      const rx = right % state.grid.cols;
      const ry = Math.floor(right / state.grid.cols);
      const leftDist = Math.abs(origin.x - lx) + Math.abs(origin.y - ly);
      const rightDist = Math.abs(origin.x - rx) + Math.abs(origin.y - ry);
      return leftDist - rightDist;
    })
    .slice(0, limit)
    .map((idx) => ({ x: idx % state.grid.cols, y: Math.floor(idx / state.grid.cols) }));
}

function buildDetachedTownConnectorCandidates(
  state: WorldState,
  snapshot: RoadComponentSnapshot,
  componentId: number,
  ownTown: Point,
  targetTown: Point,
  limit: number
): Point[] {
  const result: Point[] = [];
  const seen = new Set<string>();
  const addCandidate = (point: Point | null): void => {
    if (!point) {
      return;
    }
    const key = `${point.x},${point.y}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    result.push(point);
  };
  addCandidate(findNearestRoadTileInComponent(state, snapshot, componentId, ownTown));
  const nearby = listNearestRoadTilesInComponent(state, snapshot, componentId, targetTown, limit);
  for (let i = 0; i < nearby.length; i += 1) {
    addCandidate(nearby[i]!);
  }
  return result;
}

function isDetachedTownWaypointCandidate(state: WorldState, x: number, y: number): boolean {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  if (state.structureMask[idx] > 0) {
    return false;
  }
  const tile = state.tiles[idx];
  if (!tile || tile.type === "water" || tile.type === "house" || tile.type === "base") {
    return false;
  }
  if (isRoadLikeTile(state, x, y)) {
    return true;
  }
  const center = tile.elevation;
  let maxDiff = 0;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
      if (!neighbor || neighbor.type === "water") {
        return false;
      }
      maxDiff = Math.max(maxDiff, Math.abs(center - neighbor.elevation));
    }
  }
  return maxDiff <= DETACHED_TOWN_WAYPOINT_SLOPE_LIMIT;
}

function findNearbyDetachedTownWaypoint(state: WorldState, origin: Point, radius: number): Point | null {
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      if (!isDetachedTownWaypointCandidate(state, x, y)) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const elevation = state.tiles[idx]?.elevation ?? 0;
      let maxDiff = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(state.grid, nx, ny)) {
            continue;
          }
          const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
          if (!neighbor) {
            continue;
          }
          maxDiff = Math.max(maxDiff, Math.abs(elevation - neighbor.elevation));
        }
      }
      const dist = Math.hypot(origin.x - x, origin.y - y);
      const score = dist + maxDiff * DETACHED_TOWN_WAYPOINT_SCORE_WEIGHT;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

function collectDetachedTownConnectorWaypoints(state: WorldState, start: Point, end: Point): Point[] {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normalX = -dy / length;
  const normalY = dx / length;
  const offset = Math.min(
    DETACHED_TOWN_WAYPOINT_OFFSET_MAX,
    Math.max(DETACHED_TOWN_WAYPOINT_OFFSET_MIN, length * 0.16)
  );
  const anchorPoint = (t: number, lateral = 0): Point => ({
    x: Math.round(start.x + dx * t + normalX * lateral),
    y: Math.round(start.y + dy * t + normalY * lateral)
  });
  const anchors = [
    anchorPoint(0.5),
    anchorPoint(0.35),
    anchorPoint(0.65),
    anchorPoint(0.5, offset),
    anchorPoint(0.5, -offset)
  ];
  const waypoints: Point[] = [];
  const seen = new Set<string>();
  const radii = [4, 8, 12];
  for (let anchorIndex = 0; anchorIndex < anchors.length; anchorIndex += 1) {
    const anchor = anchors[anchorIndex]!;
    for (let radiusIndex = 0; radiusIndex < radii.length; radiusIndex += 1) {
      const radius = radii[radiusIndex]!;
      const waypoint = findNearbyDetachedTownWaypoint(state, anchor, radius);
      if (!waypoint) {
        continue;
      }
      if (
        Math.abs(waypoint.x - start.x) + Math.abs(waypoint.y - start.y) < 4 ||
        Math.abs(waypoint.x - end.x) + Math.abs(waypoint.y - end.y) < 4
      ) {
        continue;
      }
      const key = `${waypoint.x},${waypoint.y}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      waypoints.push(waypoint);
    }
  }
  return waypoints;
}

function buildDetachedTownConnectorRoadOptions(
  bridgeTransitions: boolean,
  diagonalPenalty: number,
  heightScaleMultiplier: number
): DetachedTownConnectorRoadOptions {
  return {
    bridgePolicy: bridgeTransitions ? "allow" : "never",
    heightScaleMultiplier,
    diagonalPenalty: Math.min(diagonalPenalty, 0.01),
    turnPenalty: 0.002,
    gradeLimitStart: 0.14,
    gradeLimitRelaxStep: 0.03,
    gradeLimitMax: 0.55,
    slopePenaltyWeight: 10,
    crossfallLimitStart: 0.1,
    crossfallLimitRelaxStep: 0.025,
    crossfallLimitMax: 0.4,
    crossfallPenaltyWeight: 8,
    gradeChangeLimitStart: 0.1,
    gradeChangeLimitRelaxStep: 0.025,
    gradeChangeLimitMax: 0.4,
    gradeChangePenaltyWeight: 8,
    riverBlockDistance: 0,
    riverPenaltyDistance: 1,
    riverPenaltyWeight: 2,
    bridgeStepCost: 12,
    bridgeMaxConsecutiveWater: 5,
    bridgeMaxWaterTilesPerPath: 10
  };
}

function buildFallbackTownConnectorRoadOptions(
  bridgeTransitions: boolean,
  heightScaleMultiplier: number
): DetachedTownConnectorRoadOptions {
  return {
    bridgePolicy: bridgeTransitions ? "allow" : "never",
    heightScaleMultiplier,
    diagonalPenalty: 0,
    turnPenalty: 0,
    gradeLimitStart: 0.2,
    gradeLimitRelaxStep: 0.05,
    gradeLimitMax: 0.8,
    slopePenaltyWeight: 4,
    crossfallLimitStart: 0.12,
    crossfallLimitRelaxStep: 0.03,
    crossfallLimitMax: 0.5,
    crossfallPenaltyWeight: 4,
    gradeChangeLimitStart: 0.12,
    gradeChangeLimitRelaxStep: 0.03,
    gradeChangeLimitMax: 0.5,
    gradeChangePenaltyWeight: 4,
    riverBlockDistance: 0,
    riverPenaltyDistance: 0,
    riverPenaltyWeight: 0,
    bridgeStepCost: 8,
    bridgeMaxConsecutiveWater: 6,
    bridgeMaxWaterTilesPerPath: 16
  };
}

function buildEmergencyTownConnectorRoadOptions(
  bridgeTransitions: boolean,
  heightScaleMultiplier: number
): DetachedTownConnectorRoadOptions {
  return {
    bridgePolicy: bridgeTransitions ? "allow" : "never",
    heightScaleMultiplier,
    diagonalPenalty: 0,
    turnPenalty: 0,
    gradeLimitStart: 0.35,
    gradeLimitRelaxStep: 0.1,
    gradeLimitMax: 1,
    slopePenaltyWeight: 1,
    crossfallLimitStart: 0.18,
    crossfallLimitRelaxStep: 0.05,
    crossfallLimitMax: 0.7,
    crossfallPenaltyWeight: 1,
    gradeChangeLimitStart: 0.18,
    gradeChangeLimitRelaxStep: 0.05,
    gradeChangeLimitMax: 0.7,
    gradeChangePenaltyWeight: 1,
    riverBlockDistance: 0,
    riverPenaltyDistance: 0,
    riverPenaltyWeight: 0,
    bridgeStepCost: 6,
    bridgeMaxConsecutiveWater: 8,
    bridgeMaxWaterTilesPerPath: 24
  };
}

function carveRoadToRoadComponent(
  state: WorldState,
  rng: RNG,
  start: Point,
  snapshot: RoadComponentSnapshot,
  targetComponentId: number,
  options: DetachedTownConnectorRoadOptions
): boolean {
  const startIdx = indexFor(state.grid, start.x, start.y);
  if (snapshot.componentByIdx[startIdx] === targetComponentId) {
    return true;
  }
  return (
    carveRoadToTarget(
      state,
      rng,
      start,
      (x, y) => {
        const idx = indexFor(state.grid, x, y);
        return snapshot.componentByIdx[idx] === targetComponentId && idx !== startIdx;
      },
      options
    ) !== null
  );
}

function connectDetachedTownRoadPairViaWaypoint(
  state: WorldState,
  rng: RNG,
  start: Point,
  end: Point,
  options: DetachedTownConnectorRoadOptions
): boolean {
  const waypoints = collectDetachedTownConnectorWaypoints(state, start, end);
  for (let i = 0; i < waypoints.length; i += 1) {
    const waypoint = waypoints[i]!;
    const pathToWaypoint = findRoadPath(state, start, waypoint, options);
    if (pathToWaypoint.length === 0) {
      continue;
    }
    const pathFromWaypoint = findRoadPath(state, end, waypoint, options);
    if (pathFromWaypoint.length === 0) {
      continue;
    }
    if (!carveRoad(state, rng, start, waypoint, options)) {
      continue;
    }
    if (!carveRoad(state, rng, end, waypoint, options)) {
      continue;
    }
    return true;
  }
  return false;
}

function connectDetachedTownRoadComponents(
  state: WorldState,
  rng: RNG,
  bridgeTransitions: boolean,
  diagonalPenalty: number,
  heightScaleMultiplier: number
): void {
  const connectorHeightScales =
    heightScaleMultiplier > DETACHED_TOWN_CONNECTOR_HEIGHT_SCALE_CAP + 1e-6
      ? [heightScaleMultiplier, DETACHED_TOWN_CONNECTOR_HEIGHT_SCALE_CAP]
      : [heightScaleMultiplier];
  const maxIterations = Math.max(4, state.towns.length * 3);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const snapshot = buildRoadComponentSnapshot(state);
    const componentToTown = new Map<number, Point>();
    for (let i = 0; i < state.towns.length; i += 1) {
      const town = state.towns[i];
      const road = findNearestRoadTile(state, { x: town.x, y: town.y });
      const idx = indexFor(state.grid, road.x, road.y);
      const componentId = snapshot.componentByIdx[idx];
      if (componentId >= 0 && !componentToTown.has(componentId)) {
        componentToTown.set(componentId, { x: town.x, y: town.y });
      }
    }
    const townComponents = [...componentToTown.keys()];
    if (townComponents.length <= 1) {
      return;
    }

    const pairs: Array<{ a: number; b: number; distance: number }> = [];
    for (let i = 0; i < townComponents.length; i += 1) {
      for (let j = i + 1; j < townComponents.length; j += 1) {
        const a = townComponents[i]!;
        const b = townComponents[j]!;
        const townA = componentToTown.get(a)!;
        const townB = componentToTown.get(b)!;
        pairs.push({
          a,
          b,
          distance: Math.hypot(townA.x - townB.x, townA.y - townB.y)
        });
      }
    }
    pairs.sort((left, right) => left.distance - right.distance);

    let connected = false;
    for (let i = 0; i < pairs.length; i += 1) {
      const pair = pairs[i]!;
      const townA = componentToTown.get(pair.a)!;
      const townB = componentToTown.get(pair.b)!;
      const startCandidates = buildDetachedTownConnectorCandidates(
        state,
        snapshot,
        pair.a,
        townA,
        townB,
        DETACHED_TOWN_CONNECTOR_CANDIDATE_LIMIT
      );
      const endCandidates = buildDetachedTownConnectorCandidates(
        state,
        snapshot,
        pair.b,
        townB,
        townA,
        DETACHED_TOWN_CONNECTOR_CANDIDATE_LIMIT
      );
      for (let scaleIndex = 0; scaleIndex < connectorHeightScales.length && !connected; scaleIndex += 1) {
        const connectorHeightScaleMultiplier = connectorHeightScales[scaleIndex]!;
        const connectorOptions = buildDetachedTownConnectorRoadOptions(
          bridgeTransitions,
          diagonalPenalty,
          connectorHeightScaleMultiplier
        );
        for (let startIndex = 0; startIndex < startCandidates.length && !connected; startIndex += 1) {
          const start = startCandidates[startIndex]!;
          if (carveRoadToRoadComponent(state, rng, start, snapshot, pair.b, connectorOptions)) {
            connected = true;
          }
        }
        for (let endIndex = 0; endIndex < endCandidates.length && !connected; endIndex += 1) {
          const end = endCandidates[endIndex]!;
          if (carveRoadToRoadComponent(state, rng, end, snapshot, pair.a, connectorOptions)) {
            connected = true;
          }
        }
        const waypointStartCandidates = startCandidates.slice(0, 2);
        const waypointEndCandidates = endCandidates.slice(0, 2);
        for (let startIndex = 0; startIndex < waypointStartCandidates.length && !connected; startIndex += 1) {
          const start = waypointStartCandidates[startIndex]!;
          for (let endIndex = 0; endIndex < waypointEndCandidates.length && !connected; endIndex += 1) {
            const end = waypointEndCandidates[endIndex]!;
            if (connectDetachedTownRoadPairViaWaypoint(state, rng, start, end, connectorOptions)) {
              connected = true;
            }
          }
        }
      }
    }

    if (!connected) {
      return;
    }
  }
}

function carveRoadToBuildableArea(
  state: WorldState,
  rng: RNG,
  start: Point,
  center: Point,
  options: {
    radius?: number;
    bridgePolicy?: "allow" | "never";
    diagonalPenalty?: number;
    heightScaleMultiplier?: number;
  } = {}
): Point | null {
  const searchRadii = [Math.max(2, options.radius ?? 3), 5, 7, 9];
  for (let index = 0; index < searchRadii.length; index += 1) {
    const radius = searchRadii[index]!;
    const result = carveRoadToTarget(
      state,
      rng,
      start,
      (x, y) =>
        Math.max(Math.abs(x - center.x), Math.abs(y - center.y)) <= radius &&
        isBuildable(state, x, y),
      options
    );
    if (result) {
      return result;
    }
  }
  const nearby = findNearbyBuildable(state, center, 10);
  if (nearby && carveRoad(state, rng, start, nearby, options)) {
    return nearby;
  }
  if (carveRoad(state, rng, start, center, options)) {
    return center;
  }
  return null;
}

function hasRoadPathToBuildableArea(
  state: WorldState,
  start: Point,
  center: Point,
  options: {
    radius?: number;
    bridgePolicy?: "allow" | "never";
    diagonalPenalty?: number;
    heightScaleMultiplier?: number;
  } = {}
): boolean {
  const searchRadii = [Math.max(2, options.radius ?? 3), 5, 7, 9];
  for (let index = 0; index < searchRadii.length; index += 1) {
    const radius = searchRadii[index]!;
    const path = findRoadPathToTarget(
      state,
      start,
      (x, y) =>
        Math.max(Math.abs(x - center.x), Math.abs(y - center.y)) <= radius &&
        isBuildable(state, x, y),
      options
    );
    if (path.length > 0) {
      return true;
    }
  }
  const nearby = findNearbyBuildable(state, center, 10);
  if (!nearby) {
    return false;
  }
  return findRoadPath(state, start, nearby, options).length > 0;
}

function carveRoadRing(state: WorldState, rng: RNG, center: Point, radius: number): void {
  if (radius <= 0) {
    carveRoadPath(state, rng, [center]);
    return;
  }
  const points: Point[] = [];
  for (let dx = -radius; dx <= radius; dx += 1) {
    points.push({ x: center.x + dx, y: center.y - radius });
  }
  for (let dy = -radius + 1; dy <= radius; dy += 1) {
    points.push({ x: center.x + radius, y: center.y + dy });
  }
  for (let dx = radius - 1; dx >= -radius; dx -= 1) {
    points.push({ x: center.x + dx, y: center.y + radius });
  }
  for (let dy = radius - 1; dy >= -radius + 1; dy -= 1) {
    points.push({ x: center.x - radius, y: center.y + dy });
  }
  if (points.length > 0) {
    points.push(points[0]);
  }
  carveRoadPath(state, rng, points);
}

function carveRoadLine(state: WorldState, rng: RNG, start: Point, end: Point): void {
  const points: Point[] = [];
  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;
  const dx = Math.abs(x1 - x0);
  const sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0);
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;

  while (true) {
    points.push({ x: x0, y: y0 });
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = err * 2;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }

  carveRoadPath(state, rng, points);
}

function placeVillageHouses(
  state: WorldState,
  rng: RNG,
  center: Point,
  radius: number,
  count: number,
  valueMin: number,
  valueMax: number,
  residentsMin: number,
  residentsMax: number,
  roadBias: number,
  context: HousePlacementContext
): number {
  let placed = 0;
  let tries = 0;
  const maxTries = count * 40;
  while (placed < count && tries < maxTries) {
    tries += 1;
    const angle = rng.next() * Math.PI * 2;
    const dist = 2 + rng.next() * radius;
    const x = Math.round(center.x + Math.cos(angle) * dist);
    const y = Math.round(center.y + Math.sin(angle) * dist);
    const site = findBestHouseSite(state, { x, y }, 3, 6, context);
    if (!site) {
      continue;
    }
    if (!isFootprintAdjacentToRoad(state, site.bounds) && rng.next() < roadBias) {
      continue;
    }
    const value = valueMin + Math.floor(rng.next() * (valueMax - valueMin));
    const residents = residentsMin + Math.floor(rng.next() * (residentsMax - residentsMin));
    if (placeHouseAt(state, site.x, site.y, value, residents, site.bounds, context)) {
      placed += 1;
    }
  }
  return placed;
}

function placeRoadsideHouses(
  state: WorldState,
  rng: RNG,
  roadTiles: Point[],
  count: number,
  context: HousePlacementContext
): number {
  let placed = 0;
  let tries = 0;
  const maxTries = count * 40;
  while (placed < count && tries < maxTries) {
    tries += 1;
    const road = roadTiles[Math.floor(rng.next() * roadTiles.length)];
    if (!road) {
      return placed;
    }
    const candidates = [
      { x: road.x + 1, y: road.y },
      { x: road.x - 1, y: road.y },
      { x: road.x, y: road.y + 1 },
      { x: road.x, y: road.y - 1 }
    ];
    const pick = candidates[Math.floor(rng.next() * candidates.length)];
    const site = findBestHouseSite(state, pick, 2, 4, context);
    if (!site) {
      continue;
    }
    const value = 100 + Math.floor(rng.next() * 170);
    const residents = 1 + Math.floor(rng.next() * 3);
    if (placeHouseAt(state, site.x, site.y, value, residents, site.bounds, context)) {
      placed += 1;
    }
  }
  return placed;
}

function markReachableLand(state: WorldState, origin: Point): Uint8Array {
  const total = state.grid.totalTiles;
  const visited = new Uint8Array(total);
  if (!inBounds(state.grid, origin.x, origin.y)) {
    return visited;
  }
  const originIdx = indexFor(state.grid, origin.x, origin.y);
  if ((state.tiles[originIdx].type === "water" && state.tileRoadBridge[originIdx] === 0) || state.structureMask[originIdx]) {
    return visited;
  }

  const queueX = new Int16Array(total);
  const queueY = new Int16Array(total);
  let head = 0;
  let tail = 0;
  queueX[tail] = origin.x;
  queueY[tail] = origin.y;
  tail += 1;
  visited[originIdx] = 1;

  while (head < tail) {
    const x = queueX[head];
    const y = queueY[head];
    head += 1;
    const neighbors = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    ];
    for (const next of neighbors) {
      if (!inBounds(state.grid, next.x, next.y)) {
        continue;
      }
      const idx = indexFor(state.grid, next.x, next.y);
      if (visited[idx]) {
        continue;
      }
      if ((state.tiles[idx].type === "water" && state.tileRoadBridge[idx] === 0) || state.structureMask[idx]) {
        continue;
      }
      visited[idx] = 1;
      queueX[tail] = next.x;
      queueY[tail] = next.y;
      tail += 1;
    }
  }

  return visited;
}

function countReachable(reachable: Uint8Array): number {
  let count = 0;
  for (let i = 0; i < reachable.length; i += 1) {
    if (reachable[i]) {
      count += 1;
    }
  }
  return count;
}

function findClosestUnreachableLand(state: WorldState, reachable: Uint8Array): Point | null {
  let best: Point | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      if (reachable[idx] || (state.tiles[idx].type === "water" && state.tileRoadBridge[idx] === 0) || state.structureMask[idx]) {
        continue;
      }
      const dist = Math.abs(x - state.basePoint.x) + Math.abs(y - state.basePoint.y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
}

function connectDetachedLandPass(
  state: WorldState,
  rng: RNG,
  allowBridge: boolean,
  diagonalPenalty: number,
  heightScaleMultiplier: number
): void {
  let reachable = markReachableLand(state, state.basePoint);
  let reachableCount = countReachable(reachable);
  const maxIterations = Math.min(state.grid.totalTiles, 4096);
  for (let iteration = 0; iteration < maxIterations; iteration += 1) {
    const start = findClosestUnreachableLand(state, reachable);
    if (!start) {
      break;
    }
    const path = findRoadPathToTarget(
      state,
      start,
      (x, y) => {
        const idx = indexFor(state.grid, x, y);
        return reachable[idx] === 1 && state.tiles[idx].type !== "house" && state.structureMask[idx] === 0;
      },
      {
        bridgePolicy: allowBridge ? "allow" : "never",
        diagonalPenalty,
        heightScaleMultiplier
      }
    );
    if (path.length === 0) {
      break;
    }
    if (allowBridge) {
      const bridgeIndices = new Set<number>();
      path.forEach((point) => {
        const idx = indexFor(state.grid, point.x, point.y);
        if (state.tiles[idx].type === "water" && state.tileRiverMask[idx] > 0) {
          bridgeIndices.add(idx);
        }
      });
      carveRoadPath(state, rng, path, { allowBridgeIndices: bridgeIndices });
    } else {
      carveRoadPath(state, rng, path);
    }
    const nextReachable = markReachableLand(state, state.basePoint);
    const nextCount = countReachable(nextReachable);
    if (nextCount <= reachableCount) {
      break;
    }
    reachable = nextReachable;
    reachableCount = nextCount;
  }
}

function remapHousesToNearestTown(state: WorldState): void {
  if (state.towns.length === 0) {
    return;
  }
  const cols = state.grid.cols;
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileStructure[idx] !== STRUCTURE_HOUSE) {
      continue;
    }
    const tile = state.tiles[idx];
    if (!tile || tile.type !== "house" || tile.houseDestroyed) {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const targetTownId = resolveNearestTownId(state, x, y);
    const currentTownId = state.tileTownId[idx];
    if (targetTownId < 0 || targetTownId === currentTownId) {
      continue;
    }
    const value = tile.houseValue;
    const residents = tile.houseResidents;
    if (!removeHouse(state, idx)) {
      continue;
    }
    tile.houseValue = value;
    tile.houseResidents = residents;
    tile.houseDestroyed = false;
    if (!placeHouse(state, idx, targetTownId)) {
      tile.houseValue = value;
      tile.houseResidents = residents;
      tile.houseDestroyed = false;
      placeHouse(state, idx, currentTownId);
    }
  }
  recountTownHouses(state);
}

function validateTownState(state: WorldState): void {
  const invariants = validateTownInvariants(state);
  if (!invariants.ok) {
    const detail = invariants.errors.slice(0, 8).join(" | ");
    console.warn(`[towns] invariant failure: ${detail}`);
  }
}

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const countNeighborWater = (state: WorldState, x: number, y: number): number => {
  let water = 0;
  const neighbors = [
    { x: x - 1, y },
    { x: x + 1, y },
    { x, y: y - 1 },
    { x, y: y + 1 }
  ];
  neighbors.forEach((point) => {
    if (!inBounds(state.grid, point.x, point.y)) {
      water += 1;
      return;
    }
    const idx = indexFor(state.grid, point.x, point.y);
    if (state.tiles[idx].type === "water") {
      water += 1;
    }
  });
  return water;
};

const distanceToNearestRiver = (state: WorldState, x: number, y: number, radius: number): number => {
  let best = radius + 1;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const idx = indexFor(state.grid, nx, ny);
      if (state.tileRiverMask[idx] === 0) {
        continue;
      }
      best = Math.min(best, Math.abs(dx) + Math.abs(dy));
    }
  }
  return best;
};

const distanceToNearestWater = (state: WorldState, x: number, y: number, radius: number): number => {
  let best = radius + 1;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const idx = indexFor(state.grid, nx, ny);
      if (state.tiles[idx].type !== "water") {
        continue;
      }
      best = Math.min(best, Math.abs(dx) + Math.abs(dy));
    }
  }
  return best;
};

type TownCandidate = Point & {
  score: number;
};

const collectSettlementCandidates = (state: WorldState, townDensity: number): TownCandidate[] => {
  const candidates: TownCandidate[] = [];
  const step = Math.max(1, Math.floor(Math.max(state.grid.cols, state.grid.rows) / 192));
  const minDim = Math.min(state.grid.cols, state.grid.rows);
  for (let y = 4; y < state.grid.rows - 4; y += step) {
    for (let x = 4; x < state.grid.cols - 4; x += step) {
      if (!isBuildable(state, x, y)) {
        continue;
      }
      const tile = state.tiles[indexFor(state.grid, x, y)];
      const distFromBase = Math.hypot(x - state.basePoint.x, y - state.basePoint.y);
      if (distFromBase < minDim * 0.12) {
        continue;
      }
      const edgeDist = Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y);
      const edgeNorm = clamp01(edgeDist / Math.max(1, minDim * 0.28));
      const coastalness = countNeighborWater(state, x, y) / 4;
      const waterDistanceNorm = clamp01(Math.min(10, distanceToNearestWater(state, x, y, 10)) / 10);
      const riverDistanceNorm = clamp01(Math.min(10, distanceToNearestRiver(state, x, y, 10)) / 10);
      const riverSuitability = 1 - Math.min(1, Math.abs(riverDistanceNorm - 0.45) / 0.45);
      const baseBand = 1 - Math.min(1, Math.abs(distFromBase / Math.max(1, minDim * 0.36) - 1));
      const localRelief = [
        x > 0 ? Math.abs(tile.elevation - state.tiles[indexFor(state.grid, x - 1, y)].elevation) : 0,
        x < state.grid.cols - 1 ? Math.abs(tile.elevation - state.tiles[indexFor(state.grid, x + 1, y)].elevation) : 0,
        y > 0 ? Math.abs(tile.elevation - state.tiles[indexFor(state.grid, x, y - 1)].elevation) : 0,
        y < state.grid.rows - 1 ? Math.abs(tile.elevation - state.tiles[indexFor(state.grid, x, y + 1)].elevation) : 0
      ].reduce((best, value) => Math.max(best, value), 0);
      const flatness = 1 - clamp01(localRelief * 8.5);
      let score = 0.1;
      score += flatness * 0.92;
      score += edgeNorm * 0.4;
      score += waterDistanceNorm * 0.38;
      score += riverSuitability * 0.18;
      score += baseBand * 0.16;
      score -= coastalness * 0.42;
      score += (townDensity - 0.5) * 0.05;
      if (score <= 0.35) {
        continue;
      }
      candidates.push({
        x,
        y,
        score
      });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
};

const selectVillageCenters = (
  state: WorldState,
  townDensity: number,
  spacing01: number,
  requestedCount: number,
  selectionCount = requestedCount
): Point[] => {
  const candidates = collectSettlementCandidates(state, townDensity);
  const minDim = Math.min(state.grid.cols, state.grid.rows);
  const minSpacing = Math.max(12, Math.round(minDim * (0.08 + spacing01 * 0.1)));
  const chosen: TownCandidate[] = [];
  for (let i = 0; i < candidates.length && chosen.length < selectionCount; i += 1) {
    const candidate = candidates[i];
    if (chosen.some((existing) => Math.hypot(existing.x - candidate.x, existing.y - candidate.y) < minSpacing)) {
      continue;
    }
    chosen.push(candidate);
  }
  return chosen.map(({ x, y }) => ({ x, y }));
};

type TownConnectionEdge = {
  a: number;
  b: number;
  distance: number;
};

type TownRoadConnectivitySnapshot = {
  componentByTownId: Map<number, number>;
  componentCount: number;
};

const createTownConnectionEdgeKey = (a: number, b: number): string => (a < b ? `${a}:${b}` : `${b}:${a}`);

const compareTownConnectionEdges = (left: TownConnectionEdge, right: TownConnectionEdge): number => {
  if (left.distance !== right.distance) {
    return left.distance - right.distance;
  }
  if (left.a !== right.a) {
    return left.a - right.a;
  }
  return left.b - right.b;
};

const collectAllTownConnectionEdges = (towns: Town[]): TownConnectionEdge[] => {
  const edges: TownConnectionEdge[] = [];
  for (let i = 0; i < towns.length; i += 1) {
    const town = towns[i]!;
    for (let j = i + 1; j < towns.length; j += 1) {
      const other = towns[j]!;
      edges.push({
        a: town.id,
        b: other.id,
        distance: Math.hypot(town.x - other.x, town.y - other.y)
      });
    }
  }
  edges.sort(compareTownConnectionEdges);
  return edges;
};

export function buildTownConnectionPlan(towns: Town[]): Array<[Town, Town]> {
  if (towns.length <= 1) {
    return [];
  }

  const allEdges = collectAllTownConnectionEdges(towns);
  const neighborEdges: TownConnectionEdge[] = [];
  const neighborEdgeKeys = new Set<string>();

  for (let i = 0; i < towns.length; i += 1) {
    const town = towns[i]!;
    const neighbors: TownConnectionEdge[] = [];
    for (let j = i + 1; j < towns.length; j += 1) {
      const other = towns[j]!;
      neighbors.push({
        a: town.id,
        b: other.id,
        distance: Math.hypot(town.x - other.x, town.y - other.y)
      });
    }
    for (let j = 0; j < i; j += 1) {
      const other = towns[j]!;
      neighbors.push({
        a: other.id,
        b: town.id,
        distance: Math.hypot(town.x - other.x, town.y - other.y)
      });
    }
    neighbors.sort(compareTownConnectionEdges);
    const nearestCount = Math.min(2, neighbors.length);
    for (let k = 0; k < nearestCount; k += 1) {
      const edge = neighbors[k]!;
      const key = createTownConnectionEdgeKey(edge.a, edge.b);
      if (neighborEdgeKeys.has(key)) {
        continue;
      }
      neighborEdgeKeys.add(key);
      neighborEdges.push(edge);
    }
  }

  neighborEdges.sort(compareTownConnectionEdges);

  const parent = new Int32Array(towns.length);
  for (let i = 0; i < towns.length; i += 1) {
    parent[i] = i;
  }
  const find = (value: number): number => {
    let current = value;
    while (parent[current] !== current) {
      parent[current] = parent[parent[current]!]!;
      current = parent[current]!;
    }
    return current;
  };
  const union = (leftId: number, rightId: number): boolean => {
    const leftRoot = find(leftId);
    const rightRoot = find(rightId);
    if (leftRoot === rightRoot) {
      return false;
    }
    parent[rightRoot] = leftRoot;
    return true;
  };

  const townById = new Map<number, Town>(towns.map((town) => [town.id, town]));
  const selected: TownConnectionEdge[] = [];
  const selectedKeys = new Set<string>();
  const addIfConnecting = (edge: TownConnectionEdge): void => {
    const key = createTownConnectionEdgeKey(edge.a, edge.b);
    if (selectedKeys.has(key)) {
      return;
    }
    if (!union(edge.a, edge.b)) {
      return;
    }
    selectedKeys.add(key);
    selected.push(edge);
  };

  for (let i = 0; i < neighborEdges.length; i += 1) {
    addIfConnecting(neighborEdges[i]!);
  }
  for (let i = 0; i < allEdges.length; i += 1) {
    if (selected.length >= towns.length - 1) {
      break;
    }
    addIfConnecting(allEdges[i]!);
  }

  selected.sort(compareTownConnectionEdges);
  return selected
    .map((edge) => {
      const left = townById.get(edge.a);
      const right = townById.get(edge.b);
      return left && right ? ([left, right] as [Town, Town]) : null;
    })
    .filter((pair): pair is [Town, Town] => pair !== null);
}

function buildTownRoadConnectivitySnapshot(
  state: WorldState,
  towns: Town[],
  townRoadHubs: Map<number, Point>
): TownRoadConnectivitySnapshot {
  const roadSnapshot = buildRoadComponentSnapshot(state);
  const componentByTownId = new Map<number, number>();
  const componentIds = new Set<number>();
  for (let i = 0; i < towns.length; i += 1) {
    const town = towns[i]!;
    const hub = townRoadHubs.get(town.id) ?? { x: town.x, y: town.y };
    const road = findNearestRoadTile(state, hub);
    const roadIdx = indexFor(state.grid, road.x, road.y);
    const componentId = roadSnapshot.componentByIdx[roadIdx];
    if (componentId < 0) {
      continue;
    }
    componentByTownId.set(town.id, componentId);
    componentIds.add(componentId);
  }
  return {
    componentByTownId,
    componentCount: componentIds.size
  };
}

function carveTownPairConnection(
  state: WorldState,
  rng: RNG,
  leftTown: Town,
  rightTown: Town,
  townRoadHubs: Map<number, Point>,
  bridgeTransitions: boolean,
  diagonalPenalty: number,
  heightScaleMultiplier: number
): boolean {
  const leftHub = townRoadHubs.get(leftTown.id) ?? { x: leftTown.x, y: leftTown.y };
  const rightHub = townRoadHubs.get(rightTown.id) ?? { x: rightTown.x, y: rightTown.y };
  const connectorOptions = buildDetachedTownConnectorRoadOptions(
    bridgeTransitions,
    diagonalPenalty,
    Math.min(heightScaleMultiplier, DETACHED_TOWN_CONNECTOR_HEIGHT_SCALE_CAP)
  );
  const roadSnapshot = buildRoadComponentSnapshot(state);
  const leftRoad = findNearestRoadTile(state, leftHub);
  const rightRoad = findNearestRoadTile(state, rightHub);
  const leftComponent = roadSnapshot.componentByIdx[indexFor(state.grid, leftRoad.x, leftRoad.y)];
  const rightComponent = roadSnapshot.componentByIdx[indexFor(state.grid, rightRoad.x, rightRoad.y)];

  if (leftComponent >= 0 && rightComponent >= 0) {
    if (leftComponent === rightComponent) {
      return true;
    }
    const startAnchor =
      findNearestRoadTileInComponent(state, roadSnapshot, leftComponent, rightHub) ?? leftRoad;
    if (carveRoadToRoadComponent(state, rng, startAnchor, roadSnapshot, rightComponent, connectorOptions)) {
      return true;
    }
    const fallbackOptions = buildFallbackTownConnectorRoadOptions(
      bridgeTransitions,
      Math.min(heightScaleMultiplier, DETACHED_TOWN_CONNECTOR_HEIGHT_SCALE_CAP)
    );
    if (carveRoadToRoadComponent(state, rng, startAnchor, roadSnapshot, rightComponent, fallbackOptions)) {
      return true;
    }
    const emergencyOptions = buildEmergencyTownConnectorRoadOptions(
      bridgeTransitions,
      Math.min(heightScaleMultiplier, DETACHED_TOWN_CONNECTOR_HEIGHT_SCALE_CAP)
    );
    return carveRoadToRoadComponent(state, rng, startAnchor, roadSnapshot, rightComponent, emergencyOptions);
  }

  if (leftHub.x === rightHub.x && leftHub.y === rightHub.y) {
    return false;
  }
  if (carveRoad(state, rng, leftHub, rightHub, connectorOptions)) {
    return true;
  }
  const fallbackOptions = buildFallbackTownConnectorRoadOptions(
    bridgeTransitions,
    Math.min(heightScaleMultiplier, DETACHED_TOWN_CONNECTOR_HEIGHT_SCALE_CAP)
  );
  if (carveRoad(state, rng, leftHub, rightHub, fallbackOptions)) {
    return true;
  }
  const emergencyOptions = buildEmergencyTownConnectorRoadOptions(
    bridgeTransitions,
    Math.min(heightScaleMultiplier, DETACHED_TOWN_CONNECTOR_HEIGHT_SCALE_CAP)
  );
  return carveRoad(state, rng, leftHub, rightHub, emergencyOptions);
}

function ensureTownRoadGraphConnected(
  state: WorldState,
  rng: RNG,
  towns: Town[],
  townRoadHubs: Map<number, Point>,
  attemptedEdgeKeys: Set<string>,
  bridgeTransitions: boolean,
  diagonalPenalty: number,
  heightScaleMultiplier: number
): void {
  if (towns.length <= 1) {
    return;
  }
  const townById = new Map<number, Town>(towns.map((town) => [town.id, town]));
  const candidateEdges = collectAllTownConnectionEdges(towns);

  while (true) {
    const connectivity = buildTownRoadConnectivitySnapshot(state, towns, townRoadHubs);
    if (connectivity.componentCount <= 1) {
      return;
    }

    let nextEdge: TownConnectionEdge | null = null;
    for (let i = 0; i < candidateEdges.length; i += 1) {
      const edge = candidateEdges[i]!;
      const key = createTownConnectionEdgeKey(edge.a, edge.b);
      if (attemptedEdgeKeys.has(key)) {
        continue;
      }
      const leftComponent = connectivity.componentByTownId.get(edge.a);
      const rightComponent = connectivity.componentByTownId.get(edge.b);
      if (leftComponent === undefined || rightComponent === undefined || leftComponent === rightComponent) {
        continue;
      }
      nextEdge = edge;
      break;
    }

    if (!nextEdge) {
      return;
    }

    attemptedEdgeKeys.add(createTownConnectionEdgeKey(nextEdge.a, nextEdge.b));
    const leftTown = townById.get(nextEdge.a);
    const rightTown = townById.get(nextEdge.b);
    if (!leftTown || !rightTown) {
      continue;
    }
    carveTownPairConnection(
      state,
      rng,
      leftTown,
      rightTown,
      townRoadHubs,
      bridgeTransitions,
      diagonalPenalty,
      heightScaleMultiplier
    );
  }
}

function createTownLocalRoadHub(
  state: WorldState,
  rng: RNG,
  center: Point,
  options: {
    hubMinRadius: number;
    hubMaxRadius: number;
    localRadius: number;
    branchLength: number;
    bridgeTransitions: boolean;
    diagonalPenalty: number;
    heightScaleMultiplier: number;
  }
): Point {
  const hubCandidate = findSettlementRoadHub(state, center, options.hubMinRadius, options.hubMaxRadius);
  const hub =
    (hubCandidate.x !== center.x || hubCandidate.y !== center.y) &&
    carveRoad(state, rng, center, hubCandidate, {
      bridgePolicy: "never",
      diagonalPenalty: options.diagonalPenalty,
      heightScaleMultiplier: options.heightScaleMultiplier
    })
      ? hubCandidate
      : center;

  carveRoadRing(state, rng, hub, options.localRadius);

  const localEnds = [
    { x: hub.x + options.branchLength, y: hub.y },
    { x: hub.x - options.branchLength, y: hub.y },
    { x: hub.x, y: hub.y + options.branchLength },
    { x: hub.x, y: hub.y - options.branchLength }
  ];
  localEnds.forEach((end) => {
    if (!inBounds(state.grid, end.x, end.y)) {
      return;
    }
    carveRoadToBuildableArea(state, rng, hub, end, {
      radius: 2,
      bridgePolicy: options.bridgeTransitions ? "allow" : "never",
      diagonalPenalty: options.diagonalPenalty,
      heightScaleMultiplier: options.heightScaleMultiplier
    });
  });

  return hub;
}

function connectDetachedLand(
  state: WorldState,
  rng: RNG,
  diagonalPenalty: number,
  bridgeTransitions: boolean,
  heightScaleMultiplier: number
): void {
  connectDetachedLandPass(state, rng, false, diagonalPenalty, heightScaleMultiplier);
  if (bridgeTransitions) {
    connectDetachedLandPass(state, rng, true, diagonalPenalty, heightScaleMultiplier);
  }
}

export function placeSettlements(
  state: WorldState,
  rng: RNG,
  plan: SettlementPlacementResult | null = null
): SettlementPlacementResult {
  const diagonalPenalty = Math.max(0, plan?.diagonalPenalty ?? 0.18);
  const pruneRedundantDiagonals = plan?.pruneRedundantDiagonals ?? true;
  const bridgeAllowance = clamp01(plan?.bridgeAllowance ?? (plan?.bridgeTransitions ? 0.7 : 0.2));
  const bridgeTransitions = plan?.bridgeTransitions ?? bridgeAllowance >= 0.14;
  const heightScaleMultiplier = Math.max(0.1, plan?.heightScaleMultiplier ?? 1);
  const townDensity = clamp01(plan?.townDensity ?? 0.5);
  const settlementSpacing = clamp01(plan?.settlementSpacing ?? 0.55);
  state.totalPropertyValue = 0;
  state.totalPopulation = 0;
  state.totalHouses = 0;
  state.destroyedHouses = 0;
  state.townGrowthAppliedYear = -1;
  state.townAlertDayAccumulator = 0;
  state.settlementRequestedHouses = 0;
  state.settlementPlacedHouses = 0;
  state.settlementPadReliefMax = 0;
  state.settlementPadReliefMean = 0;
  state.towns = [];
  if (state.structureMask.length !== state.grid.totalTiles) {
    state.structureMask = new Uint8Array(state.grid.totalTiles);
  } else {
    state.structureMask.fill(0);
  }
  if (state.tileTownId.length !== state.grid.totalTiles) {
    state.tileTownId = new Int16Array(state.grid.totalTiles).fill(-1);
  } else {
    state.tileTownId.fill(-1);
  }
  if (state.tileStructure.length !== state.grid.totalTiles) {
    state.tileStructure = new Uint8Array(state.grid.totalTiles);
  } else {
    state.tileStructure.fill(STRUCTURE_NONE);
  }
  const context: HousePlacementContext = {
    bufferMask: new Uint8Array(state.grid.totalTiles),
    footprints: new Map<number, HouseFootprintBounds>()
  };
  resetRoadGenerationStats();
  clearRoadEdges(state);

  const maxDim = Math.max(state.grid.cols, state.grid.rows);
  const fastMode = maxDim >= 1024;
  const centralRadius = 7 + Math.floor(rng.next() * 3);
  const ringRadius = 3 + Math.floor(rng.next() * 2);
  const baseTownSeed = { x: state.basePoint.x, y: state.basePoint.y, radius: centralRadius + 2 };

  if (fastMode) {
    assignTownNames(state, [baseTownSeed]);
    createTownLocalRoadHub(state, rng, state.basePoint, {
      hubMinRadius: 6,
      hubMaxRadius: Math.max(12, ringRadius + 7),
      localRadius: ringRadius,
      branchLength: ringRadius + 2,
      bridgeTransitions,
      diagonalPenalty,
      heightScaleMultiplier
    });
    const centralHouseCount = 12 + Math.floor(rng.next() * 8);
    state.settlementRequestedHouses += centralHouseCount;
    placeVillageHouses(state, rng, state.basePoint, centralRadius, centralHouseCount, 150, 320, 2, 5, 0.85, context);
    state.settlementPlacedHouses = state.totalHouses;
    remapHousesToNearestTown(state);
    validateTownState(state);
    backfillRoadEdgesFromAdjacency(state);
    if (pruneRedundantDiagonals) {
      pruneRoadDiagonalStubs(state);
    }
    return {
      generatedRoads: true,
      diagonalPenalty,
      pruneRedundantDiagonals,
      bridgeTransitions,
      heightScaleMultiplier,
      townDensity,
      bridgeAllowance,
      settlementSpacing
    };
  }

  const requestedVillageCount = Math.max(2, Math.round(2 + townDensity * 4));
  const villageCenterCandidates = selectVillageCenters(
    state,
    townDensity,
    settlementSpacing,
    requestedVillageCount,
    requestedVillageCount * 5
  );
  const baseReachableLand = markReachableLand(state, state.basePoint);
  const villageCenters: Point[] = [];
  for (let i = 0; i < villageCenterCandidates.length && villageCenters.length < requestedVillageCount; i += 1) {
    const candidate = villageCenterCandidates[i]!;
    const idx = indexFor(state.grid, candidate.x, candidate.y);
    if (baseReachableLand[idx] === 0) {
      continue;
    }
    villageCenters.push(candidate);
  }

  assignTownNames(state, [baseTownSeed, ...villageCenters.map((center) => ({ x: center.x, y: center.y, radius: 6 }))]);

  const townRoadHubs = new Map<number, Point>();
  for (let i = 0; i < state.towns.length; i += 1) {
    const town = state.towns[i]!;
    const isBaseTown = i === 0;
    const localRadius = isBaseTown ? ringRadius : 2 + Math.floor(rng.next() * 2);
    const hub = createTownLocalRoadHub(state, rng, { x: town.x, y: town.y }, {
      hubMinRadius: isBaseTown ? 6 : 2,
      hubMaxRadius: isBaseTown ? Math.max(12, ringRadius + 7) : 7,
      localRadius,
      branchLength: localRadius + (isBaseTown ? 2 : 1),
      bridgeTransitions,
      diagonalPenalty,
      heightScaleMultiplier
    });
    townRoadHubs.set(town.id, hub);
  }

  const connectionPlan = buildTownConnectionPlan(state.towns);
  const attemptedTownEdges = new Set<string>();
  for (let i = 0; i < connectionPlan.length; i += 1) {
    const [leftTown, rightTown] = connectionPlan[i]!;
    carveTownPairConnection(
      state,
      rng,
      leftTown,
      rightTown,
      townRoadHubs,
      bridgeTransitions,
      diagonalPenalty,
      heightScaleMultiplier
    );
  }
  ensureTownRoadGraphConnected(
    state,
    rng,
    state.towns,
    townRoadHubs,
    attemptedTownEdges,
    bridgeTransitions,
    diagonalPenalty,
    heightScaleMultiplier
  );

  const centralHouseCount = 22 + Math.floor(rng.next() * 12);
  state.settlementRequestedHouses += centralHouseCount;
  placeVillageHouses(state, rng, state.basePoint, centralRadius, centralHouseCount, 150, 320, 2, 5, 0.85, context);

  villageCenters.forEach((center) => {
    const houseCount = 9 + Math.floor(rng.next() * 8);
    state.settlementRequestedHouses += houseCount;
    placeVillageHouses(state, rng, center, 6, houseCount, 120, 260, 1, 4, 0.75, context);
  });

  remapHousesToNearestTown(state);

  const roadTiles = collectRoadTiles(state);
  const roadsideTarget = 8 + Math.floor(rng.next() * 8);
  state.settlementRequestedHouses += roadsideTarget;
  placeRoadsideHouses(state, rng, roadTiles, roadsideTarget, context);

  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      if (state.tiles[idx].type !== "house") {
        continue;
      }
      const bounds = context.footprints.get(idx) ?? { minX: x, maxX: x, minY: y, maxY: y, width: 1, depth: 1 };
      if (!isFootprintAdjacentToRoad(state, bounds)) {
        const entry = findFootprintEntryTile(state, bounds);
        if (!entry) {
          continue;
        }
        const target = findNearestRoadTile(state, entry);
        carveRoad(state, rng, entry, target, {
          bridgePolicy: bridgeTransitions ? "allow" : "never",
          diagonalPenalty,
          heightScaleMultiplier
        });
      }
    }
  }

  if (ENABLE_DEBUG_DETACHED_LAND_RECOVERY) {
    connectDetachedLand(state, rng, diagonalPenalty, bridgeTransitions, heightScaleMultiplier);
  }
  backfillRoadEdgesFromAdjacency(state);
  if (pruneRedundantDiagonals) {
    pruneRoadDiagonalStubs(state);
  }
  remapHousesToNearestTown(state);
  validateTownState(state);
  const edgeQuality = analyzeRoadEdgeQuality(state);
  if (DEBUG_TERRAIN) {
    const stats = getRoadGenerationStats();
    let bridgeTiles = 0;
    for (let i = 0; i < state.tileRoadBridge.length; i += 1) {
      if (state.tileRoadBridge[i] > 0) {
        bridgeTiles += 1;
      }
    }
    const roadTileCount = collectRoadTiles(state).length;
    const minClearance = Number.isFinite(stats.minRiverClearance) ? stats.minRiverClearance.toString() : "n/a";
    console.log(
      `[roadgen] roads=${roadTileCount} bridges=${bridgeTiles} paths=${stats.pathsFound}/${stats.pathsAttempted} maxGrade=${stats.maxRealizedGrade.toFixed(3)} maxCrossfall=${stats.maxRealizedCrossfall.toFixed(3)} maxGradeChange=${stats.maxRealizedGradeChange.toFixed(3)} minRiverClearance=${minClearance} bridgeSegments=${stats.bridgeSegments} ignoredDiag=${edgeQuality.ignoredDiagonalCount} unmatched=${edgeQuality.unmatchedPatternCount}`
    );
  }
  state.settlementPlacedHouses = state.totalHouses;
  return {
    generatedRoads: true,
    diagonalPenalty,
    pruneRedundantDiagonals,
    bridgeTransitions,
    heightScaleMultiplier,
    townDensity,
    bridgeAllowance,
    settlementSpacing
  };
}

export function connectSettlementsByRoad(
  state: WorldState,
  rng: RNG,
  plan: SettlementPlacementResult | null
): void {
  if (!plan || plan.generatedRoads) {
    return;
  }
  const realized = placeSettlements(state, rng, plan);
  plan.generatedRoads = realized.generatedRoads;
  plan.diagonalPenalty = realized.diagonalPenalty;
  plan.pruneRedundantDiagonals = realized.pruneRedundantDiagonals;
  plan.bridgeTransitions = realized.bridgeTransitions;
}

export const createSettlementPlacementPlan = (
  options: {
    diagonalPenalty?: number;
    pruneRedundantDiagonals?: boolean;
    bridgeTransitions?: boolean;
    heightScaleMultiplier?: number;
    townDensity?: number;
    bridgeAllowance?: number;
    settlementSpacing?: number;
    roadStrictness?: number;
  } = {}
): SettlementPlacementResult => {
  return {
    generatedRoads: false,
    diagonalPenalty: Math.max(0, options.diagonalPenalty ?? 0.18),
    pruneRedundantDiagonals: options.pruneRedundantDiagonals ?? true,
    bridgeTransitions: options.bridgeTransitions ?? true,
    heightScaleMultiplier: Math.max(0.1, options.heightScaleMultiplier ?? 1),
    townDensity: clamp01(options.townDensity ?? 0.5),
    bridgeAllowance: clamp01(options.bridgeAllowance ?? (options.bridgeTransitions ? 0.7 : 0.2)),
    settlementSpacing: clamp01(options.settlementSpacing ?? 0.55),
    roadStrictness: clamp01(options.roadStrictness ?? 0.5)
  };
}

export function populateCommunities(state: WorldState, rng: RNG): void {
  const plan = placeSettlements(state, rng);
  connectSettlementsByRoad(state, rng, plan);
}
