import type { RNG, Point } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { inBounds, indexFor } from "../core/grid.js";
import { carveRoad, collectRoadTiles, findNearestRoadTile, findRoadPath, findRoadPathToTarget, setRoadAt } from "./roads.js";

function isBuildable(state: WorldState, x: number, y: number): boolean {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const type = state.tiles[indexFor(state.grid, x, y)].type;
  return type === "grass" || type === "forest";
}

function placeHouseAt(state: WorldState, x: number, y: number, value: number, residents: number): boolean {
  if (!isBuildable(state, x, y)) {
    return false;
  }
  const tile = state.tiles[indexFor(state.grid, x, y)];
  tile.type = "house";
  tile.canopy = 0;
  tile.houseValue = value;
  tile.houseResidents = residents;
  tile.houseDestroyed = false;
  state.totalPropertyValue += value;
  state.totalPopulation += residents;
  state.totalHouses += 1;
  return true;
}

function isAdjacentToRoad(state: WorldState, x: number, y: number): boolean {
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ];
  return neighbors.some((point) => {
    if (!inBounds(state.grid, point.x, point.y)) {
      return false;
    }
    const type = state.tiles[indexFor(state.grid, point.x, point.y)].type;
    return type === "road" || type === "base";
  });
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
  roadBias: number
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
    if (!isAdjacentToRoad(state, x, y) && rng.next() < roadBias) {
      continue;
    }
    const value = valueMin + Math.floor(rng.next() * (valueMax - valueMin));
    const residents = residentsMin + Math.floor(rng.next() * (residentsMax - residentsMin));
    if (placeHouseAt(state, x, y, value, residents)) {
      placed += 1;
    }
  }
}

function placeRoadsideHouses(state: WorldState, rng: RNG, roadTiles: Point[], count: number): void {
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
    const value = 100 + Math.floor(rng.next() * 170);
    const residents = 1 + Math.floor(rng.next() * 3);
    if (placeHouseAt(state, pick.x, pick.y, value, residents)) {
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
  if (state.tiles[originIdx].type === "water") {
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
      if (state.tiles[idx].type === "water") {
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

function findClosestUnreachableLand(state: WorldState, reachable: Uint8Array): Point | null {
  let best: Point | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      if (reachable[idx] || state.tiles[idx].type === "water") {
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

function connectDetachedLand(state: WorldState, rng: RNG): void {
  let reachable = markReachableLand(state, state.basePoint);
  while (true) {
    const start = findClosestUnreachableLand(state, reachable);
    if (!start) {
      break;
    }
    const path = findRoadPathToTarget(
      state,
      start,
      (x, y) => {
        const idx = indexFor(state.grid, x, y);
        return reachable[idx] === 1 && state.tiles[idx].type !== "house";
      },
      { allowWater: true }
    );
    if (path.length === 0) {
      break;
    }
    path.forEach((point) => setRoadAt(state, rng, point.x, point.y, { allowBridge: true }));
    reachable = markReachableLand(state, state.basePoint);
  }
}

function ensureEvacuationRoute(state: WorldState, rng: RNG): void {
  const start = state.basePoint;
  const isEdge = (x: number, y: number) =>
    x === 0 || y === 0 || x === state.grid.cols - 1 || y === state.grid.rows - 1;
  const isValidEdge = (x: number, y: number) => {
    if (!isEdge(x, y)) {
      return false;
    }
    if (x === start.x && y === start.y) {
      return false;
    }
    return state.tiles[indexFor(state.grid, x, y)].type !== "house";
  };

  let allowBridge = false;
  let path = findRoadPathToTarget(state, start, isValidEdge, { allowWater: false });
  if (path.length === 0) {
    allowBridge = true;
    path = findRoadPathToTarget(state, start, isValidEdge, { allowWater: true });
  }
  if (path.length === 0) {
    return;
  }
  path.forEach((point) => setRoadAt(state, rng, point.x, point.y, { allowBridge }));
}

export function populateCommunities(state: WorldState, rng: RNG): void {
  state.totalPropertyValue = 0;
  state.totalPopulation = 0;
  state.totalHouses = 0;
  state.destroyedHouses = 0;

  const centralRadius = 7 + Math.floor(rng.next() * 3);
  const ringRadius = 3 + Math.floor(rng.next() * 2);
  const spokeCount = 4 + Math.floor(rng.next() * 3);
  const spokeLength = ringRadius + 7 + Math.floor(rng.next() * 6);

  carveRoadRing(state, rng, state.basePoint, ringRadius);

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
  placeVillageHouses(state, rng, state.basePoint, centralRadius, centralHouseCount, 150, 320, 2, 5, 0.85);

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
    if (findRoadPath(state, anchor, { x, y }).length === 0) {
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
    placeVillageHouses(state, rng, center, 6, houseCount, 120, 260, 1, 4, 0.75);
  });

  const roadTiles = collectRoadTiles(state);
  const roadsideTarget = 8 + Math.floor(rng.next() * 8);
  placeRoadsideHouses(state, rng, roadTiles, roadsideTarget);

  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      if (state.tiles[idx].type !== "house") {
        continue;
      }
      if (!isAdjacentToRoad(state, x, y)) {
        const target = findNearestRoadTile(state, { x, y });
        carveRoad(state, rng, { x, y }, target);
      }
    }
  }

  connectDetachedLand(state, rng);
  ensureEvacuationRoute(state, rng);
}

