import type { RNG, Point } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { HOUSE_VARIANTS } from "../core/buildingFootprints.js";
import { DEBUG_TERRAIN } from "../core/config.js";
import { inBounds, indexFor } from "../core/grid.js";
import {
  carveRoad,
  collectRoadTiles,
  findNearestRoadTile,
  findRoadPath,
  findRoadPathToTarget,
  getRoadGenerationStats,
  isRoadLikeTile,
  resetRoadGenerationStats,
  setRoadAt
} from "./roads.js";

const HOUSE_BUFFER_RADIUS = 1;
const HOUSE_FOOTPRINT_EPS = 1e-4;

type HouseFootprintBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

type HousePlacementContext = {
  bufferMask: Uint8Array;
  footprints: Map<number, HouseFootprintBounds>;
};

export type SettlementPlacementResult = {
  generatedRoads: boolean;
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

const pickHouseVariant = (seed: number) => {
  if (HOUSE_VARIANTS.length === 0) {
    return { sizeX: 1, sizeZ: 1 };
  }
  const index = Math.floor(noiseAt(seed + 6.1) * HOUSE_VARIANTS.length);
  const variant = HOUSE_VARIANTS[Math.min(HOUSE_VARIANTS.length - 1, Math.max(0, index))];
  return { sizeX: Math.max(0.01, variant.sizeX), sizeZ: Math.max(0.01, variant.sizeZ) };
};

const getHouseFootprintBounds = (tileX: number, tileY: number, rotation: number, seed: number): HouseFootprintBounds => {
  const variant = pickHouseVariant(seed);
  const rotate = Math.abs(Math.sin(rotation)) > 0.5;
  const width = rotate ? variant.sizeZ : variant.sizeX;
  const depth = rotate ? variant.sizeX : variant.sizeZ;
  const centerX = tileX + 0.5;
  const centerY = tileY + 0.5;
  const minX = Math.floor(centerX - width / 2);
  const maxX = Math.floor(centerX + width / 2 - HOUSE_FOOTPRINT_EPS);
  const minY = Math.floor(centerY - depth / 2);
  const maxY = Math.floor(centerY + depth / 2 - HOUSE_FOOTPRINT_EPS);
  return { minX, maxX, minY, maxY };
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
  const type = state.tiles[indexFor(state.grid, x, y)].type;
  return isBuildableType(type);
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
  if (!isBuildable(state, x, y)) {
    return false;
  }
  tile.type = "house";
  tile.canopy = 0;
  tile.canopyCover = 0;
  tile.stemDensity = 0;
  tile.dominantTreeType = null;
  tile.treeType = null;
  tile.houseValue = value;
  tile.houseResidents = residents;
  tile.houseDestroyed = false;
  state.totalPropertyValue += value;
  state.totalPopulation += residents;
  state.totalHouses += 1;
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
  let bestDist = Number.POSITIVE_INFINITY;
  for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      if (!inBounds(state.grid, x, y) || !isBuildable(state, x, y)) {
        continue;
      }
      const dist = Math.hypot(origin.x - x, origin.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
}

function carveRoadRing(state: WorldState, rng: RNG, center: Point, radius: number): void {
  for (let dx = -radius; dx <= radius; dx += 1) {
    setRoadAt(state, rng, center.x + dx, center.y - radius);
    setRoadAt(state, rng, center.x + dx, center.y + radius);
  }
  for (let dy = -radius; dy <= radius; dy += 1) {
    setRoadAt(state, rng, center.x - radius, center.y + dy);
    setRoadAt(state, rng, center.x + radius, center.y + dy);
  }
}

function carveRoadLine(state: WorldState, rng: RNG, start: Point, end: Point): void {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));
  if (steps <= 0) {
    setRoadAt(state, rng, start.x, start.y);
    return;
  }
  const stepX = dx / steps;
  const stepY = dy / steps;
  let x = start.x;
  let y = start.y;
  for (let i = 0; i <= steps; i += 1) {
    setRoadAt(state, rng, Math.round(x), Math.round(y));
    x += stepX;
    y += stepY;
  }
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
): void {
  let placed = 0;
  let tries = 0;
  const maxTries = count * 40;
  while (placed < count && tries < maxTries) {
    tries += 1;
    const angle = rng.next() * Math.PI * 2;
    const dist = 2 + rng.next() * radius;
    const x = Math.round(center.x + Math.cos(angle) * dist);
    const y = Math.round(center.y + Math.sin(angle) * dist);
    if (!isBuildable(state, x, y) || !isHouseSpacingOk(state, x, y)) {
      continue;
    }
    const seed = y * state.grid.cols + x;
    const rotation = pickHouseRotation(state, x, y, seed);
    const bounds = getHouseFootprintBounds(x, y, rotation, seed);
    if (!canPlaceHouseFootprint(state, bounds, context)) {
      continue;
    }
    if (!isFootprintAdjacentToRoad(state, bounds) && rng.next() < roadBias) {
      continue;
    }
    const value = valueMin + Math.floor(rng.next() * (valueMax - valueMin));
    const residents = residentsMin + Math.floor(rng.next() * (residentsMax - residentsMin));
    if (placeHouseAt(state, x, y, value, residents, bounds, context)) {
      placed += 1;
    }
  }
}

function placeRoadsideHouses(
  state: WorldState,
  rng: RNG,
  roadTiles: Point[],
  count: number,
  context: HousePlacementContext
): void {
  let placed = 0;
  let tries = 0;
  const maxTries = count * 40;
  while (placed < count && tries < maxTries) {
    tries += 1;
    const road = roadTiles[Math.floor(rng.next() * roadTiles.length)];
    if (!road) {
      return;
    }
    const candidates = [
      { x: road.x + 1, y: road.y },
      { x: road.x - 1, y: road.y },
      { x: road.x, y: road.y + 1 },
      { x: road.x, y: road.y - 1 }
    ];
    const pick = candidates[Math.floor(rng.next() * candidates.length)];
    if (!isBuildable(state, pick.x, pick.y) || !isHouseSpacingOk(state, pick.x, pick.y)) {
      continue;
    }
    const seed = pick.y * state.grid.cols + pick.x;
    const rotation = pickHouseRotation(state, pick.x, pick.y, seed);
    const bounds = getHouseFootprintBounds(pick.x, pick.y, rotation, seed);
    if (!canPlaceHouseFootprint(state, bounds, context)) {
      continue;
    }
    const value = 100 + Math.floor(rng.next() * 170);
    const residents = 1 + Math.floor(rng.next() * 3);
    if (placeHouseAt(state, pick.x, pick.y, value, residents, bounds, context)) {
      placed += 1;
    }
  }
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

function connectDetachedLandPass(state: WorldState, rng: RNG, allowBridge: boolean): void {
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
      { bridgePolicy: allowBridge ? "allow" : "never" }
    );
    if (path.length === 0) {
      break;
    }
    path.forEach((point) => {
      const idx = indexFor(state.grid, point.x, point.y);
      const isBridgeTile = state.tiles[idx].type === "water" && state.tileRiverMask[idx] > 0;
      setRoadAt(state, rng, point.x, point.y, { allowBridge: allowBridge && isBridgeTile });
    });
    const nextReachable = markReachableLand(state, state.basePoint);
    const nextCount = countReachable(nextReachable);
    if (nextCount <= reachableCount) {
      break;
    }
    reachable = nextReachable;
    reachableCount = nextCount;
  }
}

function connectDetachedLand(state: WorldState, rng: RNG): void {
  connectDetachedLandPass(state, rng, false);
  connectDetachedLandPass(state, rng, true);
}

export function placeSettlements(state: WorldState, rng: RNG): SettlementPlacementResult {
  state.totalPropertyValue = 0;
  state.totalPopulation = 0;
  state.totalHouses = 0;
  state.destroyedHouses = 0;
  if (state.structureMask.length !== state.grid.totalTiles) {
    state.structureMask = new Uint8Array(state.grid.totalTiles);
  } else {
    state.structureMask.fill(0);
  }
  const context: HousePlacementContext = {
    bufferMask: new Uint8Array(state.grid.totalTiles),
    footprints: new Map<number, HouseFootprintBounds>()
  };
  resetRoadGenerationStats();

  const maxDim = Math.max(state.grid.cols, state.grid.rows);
  const fastMode = maxDim >= 1024;
  const centralRadius = 7 + Math.floor(rng.next() * 3);
  const ringRadius = 3 + Math.floor(rng.next() * 2);
  const spokeCount = 4 + Math.floor(rng.next() * 3);
  const spokeLength = ringRadius + 7 + Math.floor(rng.next() * 6);

  carveRoadRing(state, rng, state.basePoint, ringRadius);

  if (fastMode) {
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
    placeVillageHouses(state, rng, state.basePoint, centralRadius, centralHouseCount, 150, 320, 2, 5, 0.85, context);
    return { generatedRoads: true };
  }

  for (let i = 0; i < spokeCount; i += 1) {
    const angle = (Math.PI * 2 * i) / spokeCount + (rng.next() - 0.5) * 0.5;
    const rawTarget = {
      x: Math.round(state.basePoint.x + Math.cos(angle) * spokeLength),
      y: Math.round(state.basePoint.y + Math.sin(angle) * spokeLength)
    };
    const nearby = findNearbyBuildable(state, rawTarget, 6);
    const target = nearby ?? (isBuildable(state, rawTarget.x, rawTarget.y) ? rawTarget : null);
    if (target && inBounds(state.grid, target.x, target.y)) {
      carveRoad(state, rng, state.basePoint, target);
    }
  }

  const centralHouseCount = 22 + Math.floor(rng.next() * 12);
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
    if (findRoadPath(state, anchor, { x, y }, { bridgePolicy: "allow" }).length === 0) {
      continue;
    }
    villageCenters.push({ x, y });
  }

  villageCenters.forEach((center) => {
    const anchor = findNearestRoadTile(state, center);
    carveRoad(state, rng, anchor, center);

    const localSize = 2 + Math.floor(rng.next() * 2);
    const localEnds = [
      { x: center.x + localSize, y: center.y },
      { x: center.x - localSize, y: center.y },
      { x: center.x, y: center.y + localSize },
      { x: center.x, y: center.y - localSize }
    ];
    localEnds.forEach((end) => {
      if (inBounds(state.grid, end.x, end.y)) {
        carveRoad(state, rng, center, end);
      }
    });

    const houseCount = 9 + Math.floor(rng.next() * 8);
    placeVillageHouses(state, rng, center, 6, houseCount, 120, 260, 1, 4, 0.75, context);
  });

  const roadTiles = collectRoadTiles(state);
  const roadsideTarget = 8 + Math.floor(rng.next() * 8);
  placeRoadsideHouses(state, rng, roadTiles, roadsideTarget, context);

  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      if (state.tiles[idx].type !== "house") {
        continue;
      }
      const bounds = context.footprints.get(idx) ?? { minX: x, maxX: x, minY: y, maxY: y };
      if (!isFootprintAdjacentToRoad(state, bounds)) {
        const entry = findFootprintEntryTile(state, bounds);
        if (!entry) {
          continue;
        }
        const target = findNearestRoadTile(state, entry);
        carveRoad(state, rng, entry, target);
      }
    }
  }

  connectDetachedLand(state, rng);
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
      `[roadgen] roads=${roadTileCount} bridges=${bridgeTiles} paths=${stats.pathsFound}/${stats.pathsAttempted} maxGrade=${stats.maxRealizedGrade.toFixed(3)} minRiverClearance=${minClearance} bridgeSegments=${stats.bridgeSegments}`
    );
  }
  return { generatedRoads: true };
}

export function connectSettlementsByRoad(
  _state: WorldState,
  _rng: RNG,
  plan: SettlementPlacementResult | null
): void {
  if (!plan || plan.generatedRoads) {
    return;
  }
}

export function populateCommunities(state: WorldState, rng: RNG): void {
  const plan = placeSettlements(state, rng);
  connectSettlementsByRoad(state, rng, plan);
}

