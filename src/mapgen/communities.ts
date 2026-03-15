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
  analyzeRoadEdgeQuality,
  backfillRoadEdgesFromAdjacency,
  carveRoad,
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
  diagonalPenalty: number
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
        diagonalPenalty
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

function connectDetachedLand(
  state: WorldState,
  rng: RNG,
  diagonalPenalty: number,
  bridgeTransitions: boolean
): void {
  connectDetachedLandPass(state, rng, false, diagonalPenalty);
  if (bridgeTransitions) {
    connectDetachedLandPass(state, rng, true, diagonalPenalty);
  }
}

export function placeSettlements(
  state: WorldState,
  rng: RNG,
  plan: SettlementPlacementResult | null = null
): SettlementPlacementResult {
  const diagonalPenalty = Math.max(0, plan?.diagonalPenalty ?? 0.18);
  const pruneRedundantDiagonals = plan?.pruneRedundantDiagonals ?? true;
  const bridgeTransitions = plan?.bridgeTransitions ?? true;
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
  const spokeCount = 4 + Math.floor(rng.next() * 3);
  const spokeLength = ringRadius + 7 + Math.floor(rng.next() * 6);

  carveRoadRing(state, rng, state.basePoint, ringRadius);

  if (fastMode) {
    assignTownNames(state, [{ x: state.basePoint.x, y: state.basePoint.y, radius: centralRadius + 2 }]);
    const fastSpokes = Math.min(4, spokeCount);
    for (let i = 0; i < fastSpokes; i += 1) {
      const angle = (Math.PI * 2 * i) / fastSpokes;
      const target = {
        x: Math.round(state.basePoint.x + Math.cos(angle) * spokeLength),
        y: Math.round(state.basePoint.y + Math.sin(angle) * spokeLength)
      };
      if (inBounds(state.grid, target.x, target.y)) {
        carveRoadLine(state, rng, state.basePoint, target);
      }
    }
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
      bridgeTransitions
    };
  }

  assignTownNames(state, [{ x: state.basePoint.x, y: state.basePoint.y, radius: centralRadius + 2 }]);

  for (let i = 0; i < spokeCount; i += 1) {
    const angle = (Math.PI * 2 * i) / spokeCount + (rng.next() - 0.5) * 0.5;
    const rawTarget = {
      x: Math.round(state.basePoint.x + Math.cos(angle) * spokeLength),
      y: Math.round(state.basePoint.y + Math.sin(angle) * spokeLength)
    };
    const nearby = findNearbyBuildable(state, rawTarget, 6);
    const target = nearby ?? (isBuildable(state, rawTarget.x, rawTarget.y) ? rawTarget : null);
    if (target && inBounds(state.grid, target.x, target.y)) {
      carveRoad(state, rng, state.basePoint, target, {
        bridgePolicy: bridgeTransitions ? "allow" : "never",
        diagonalPenalty
      });
    }
  }

  const centralHouseCount = 22 + Math.floor(rng.next() * 12);
  state.settlementRequestedHouses += centralHouseCount;
  placeVillageHouses(state, rng, state.basePoint, centralRadius, centralHouseCount, 150, 320, 2, 5, 0.85, context);

  const villageCenters: Point[] = [];
  const villageCount = 3 + Math.floor(rng.next() * 3);
  let attempts = 0;
  while (villageCenters.length < villageCount && attempts < 5000) {
    attempts += 1;
    const x = Math.floor(rng.next() * state.grid.cols);
    const y = Math.floor(rng.next() * state.grid.rows);
    if (!isBuildable(state, x, y)) {
      continue;
    }
    if (Math.hypot(x - state.basePoint.x, y - state.basePoint.y) < centralRadius + 12) {
      continue;
    }
    if (villageCenters.some((center) => Math.hypot(x - center.x, y - center.y) < 20)) {
      continue;
    }
    const anchor = findNearestRoadTile(state, { x, y });
    if (
      findRoadPath(state, anchor, { x, y }, {
        bridgePolicy: bridgeTransitions ? "allow" : "never",
        diagonalPenalty
      }).length === 0
    ) {
      continue;
    }
    villageCenters.push({ x, y });
  }

  assignTownNames(state, [
    { x: state.basePoint.x, y: state.basePoint.y, radius: centralRadius + 2 },
    ...villageCenters.map((center) => ({ x: center.x, y: center.y, radius: 6 }))
  ]);
  remapHousesToNearestTown(state);

  villageCenters.forEach((center) => {
    const anchor = findNearestRoadTile(state, center);
    carveRoad(state, rng, anchor, center, {
      bridgePolicy: bridgeTransitions ? "allow" : "never",
      diagonalPenalty
    });

    const localSize = 2 + Math.floor(rng.next() * 2);
    const localEnds = [
      { x: center.x + localSize, y: center.y },
      { x: center.x - localSize, y: center.y },
      { x: center.x, y: center.y + localSize },
      { x: center.x, y: center.y - localSize }
    ];
    localEnds.forEach((end) => {
      if (inBounds(state.grid, end.x, end.y)) {
        carveRoad(state, rng, center, end, {
          bridgePolicy: bridgeTransitions ? "allow" : "never",
          diagonalPenalty
        });
      }
    });

    const houseCount = 9 + Math.floor(rng.next() * 8);
    state.settlementRequestedHouses += houseCount;
    placeVillageHouses(state, rng, center, 6, houseCount, 120, 260, 1, 4, 0.75, context);
  });

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
          diagonalPenalty
        });
      }
    }
  }

  connectDetachedLand(state, rng, diagonalPenalty, bridgeTransitions);
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
    bridgeTransitions
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
  } = {}
): SettlementPlacementResult => {
  return {
    generatedRoads: false,
    diagonalPenalty: Math.max(0, options.diagonalPenalty ?? 0.18),
    pruneRedundantDiagonals: options.pruneRedundantDiagonals ?? true,
    bridgeTransitions: options.bridgeTransitions ?? true
  };
}

export function populateCommunities(state: WorldState, rng: RNG): void {
  const plan = placeSettlements(state, rng);
  connectSettlementsByRoad(state, rng, plan);
}

