import { getHouseFootprintBounds, pickHouseFootprint, type HouseFootprintBounds } from "../../../core/houseFootprints.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import type { WorldState } from "../../../core/state.js";
import {
  placeHouse,
  removeHouse,
  recountTownHouses,
  validateTownInvariants,
  STRUCTURE_HOUSE,
  STRUCTURE_NONE
} from "../../../core/towns.js";
import type { Point, Town, TownGrowthFrontier } from "../../../core/types.js";
import { clamp } from "../../../core/utils.js";
import { getFractionalSimulationYear } from "./buildingLifecycle.js";
import {
  BUILDABLE_SLOPE_LIMIT,
  FRONTAGE_SCAN_MARGIN,
  FRONTIER_EXTENSION_MAX,
  FRONTIER_EXTENSION_MIN,
  HOUSE_BUFFER_RADIUS,
  MAX_FRONTIERS_BY_ARCHETYPE,
  MIN_TOWN_RADIUS,
  SECONDARY_BRANCH_MAX,
  SECONDARY_BRANCH_MIN,
  TOWN_CORE_RADIUS
} from "../constants/settlementConstants.js";
import type { SettlementRoadAdapter, SettlementRoadOptions } from "../types/settlementTypes.js";

type GrowthMode = "mapgen" | "runtime";

type GrowthContext = {
  footprints: Map<number, HouseFootprintBounds>;
};

type FrontageCandidate = {
  x: number;
  y: number;
  bounds: HouseFootprintBounds;
  score: number;
  distCenter: number;
};

const clamp01 = (value: number): number => clamp(value, 0, 1);

const noiseAt = (value: number): number => {
  const sample = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return sample - Math.floor(sample);
};

const isStreetTile = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const type = state.tiles[idx]?.type;
  return type === "road" || (state.tileRoadBridge[idx] ?? 0) > 0;
};

const isBuildableType = (type: WorldState["tiles"][number]["type"]): boolean =>
  type === "grass" || type === "scrub" || type === "floodplain" || type === "forest" || type === "bare";

const pickRestoredTileType = (moisture: number, elevation: number): WorldState["tiles"][number]["type"] => {
  if (elevation > 0.84) {
    return moisture > 0.42 ? "rocky" : "bare";
  }
  if (moisture >= 0.68) {
    return elevation < 0.48 ? "floodplain" : "forest";
  }
  if (moisture >= 0.46) {
    return "forest";
  }
  if (moisture >= 0.26) {
    return "grass";
  }
  return "scrub";
};

const restoreFormerRoadTile = (state: WorldState, idx: number): void => {
  const tile = state.tiles[idx];
  tile.type = pickRestoredTileType(tile.moisture, tile.elevation);
  tile.isBase = false;
  tile.buildingClass = null;
  state.tileRoadBridge[idx] = 0;
  state.tileRoadEdges[idx] = 0;
  state.tileRoadWallEdges[idx] = 0;
};

const getTownCenterX = (town: Town): number => (Number.isFinite(town.cx) ? town.cx : town.x);

const getTownCenterY = (town: Town): number => (Number.isFinite(town.cy) ? town.cy : town.y);

const isBuildable = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  const tile = state.tiles[idx];
  if (!isBuildableType(tile.type) || state.tileStructure[idx] !== STRUCTURE_NONE) {
    return false;
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
  return maxDiff <= BUILDABLE_SLOPE_LIMIT;
};

const pickHouseRotationFromRoad = (state: WorldState, tileX: number, tileY: number, seed: number): number => {
  const roadEW = isStreetTile(state, tileX - 1, tileY) || isStreetTile(state, tileX + 1, tileY);
  const roadNS = isStreetTile(state, tileX, tileY - 1) || isStreetTile(state, tileX, tileY + 1);
  const flip = noiseAt(seed + 21.4) < 0.5 ? 0 : Math.PI;
  if (roadEW && !roadNS) {
    return flip;
  }
  if (roadNS && !roadEW) {
    return Math.PI / 2 + flip;
  }
  return noiseAt(seed + 9.1) < 0.5 ? 0 : Math.PI / 2;
};

const footprintTouchesStreet = (state: WorldState, bounds: HouseFootprintBounds): boolean => {
  for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
    if (isStreetTile(state, x, bounds.minY - 1) || isStreetTile(state, x, bounds.maxY + 1)) {
      return true;
    }
  }
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    if (isStreetTile(state, bounds.minX - 1, y) || isStreetTile(state, bounds.maxX + 1, y)) {
      return true;
    }
  }
  return false;
};

const markHouseFootprint = (state: WorldState, bounds: HouseFootprintBounds, context: GrowthContext): void => {
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        continue;
      }
      state.structureMask[indexFor(state.grid, x, y)] = 1;
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
      state.structureMask[indexFor(state.grid, x, y)] = 1;
    }
  }
};

const canPlaceHouseFootprint = (state: WorldState, bounds: HouseFootprintBounds): boolean => {
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        return false;
      }
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      if (
        state.structureMask[idx] !== 0 ||
        state.tileStructure[idx] !== STRUCTURE_NONE ||
        tile.type === "water" ||
        tile.type === "road" ||
        tile.type === "base" ||
        tile.type === "house"
      ) {
        return false;
      }
    }
  }
  return true;
};

const rebuildGrowthContext = (state: WorldState): GrowthContext => {
  state.structureMask.fill(0);
  const context: GrowthContext = {
    footprints: new Map<number, HouseFootprintBounds>()
  };
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileStructure[idx] !== STRUCTURE_HOUSE || state.tiles[idx]?.type !== "house") {
      continue;
    }
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    const rotation = pickHouseRotationFromRoad(state, x, y, idx + state.seed);
    const bounds = getHouseFootprintBounds(x, y, rotation, pickHouseFootprint(idx));
    markHouseFootprint(state, bounds, context);
    context.footprints.set(idx, bounds);
  }
  return context;
};

const computeDeterministicHouseValue = (state: WorldState, idx: number, townId: number, effectiveYear: number): number => {
  const sample = noiseAt(state.seed * 0.17 + idx * 0.29 + townId * 13.11 + effectiveYear * 3.7);
  return 120 + Math.floor(sample * 220);
};

const computeDeterministicHouseResidents = (
  state: WorldState,
  idx: number,
  townId: number,
  effectiveYear: number
): number => {
  const sample = noiseAt(state.seed * 0.11 + idx * 0.31 + townId * 9.3 + effectiveYear * 5.1);
  return 1 + Math.floor(sample * 4);
};

const placeFrontageHouse = (
  state: WorldState,
  town: Town,
  candidate: FrontageCandidate,
  context: GrowthContext,
  effectiveYear: number,
  constructionYear: number
): boolean => {
  if (!canPlaceHouseFootprint(state, candidate.bounds)) {
    return false;
  }
  const idx = indexFor(state.grid, candidate.x, candidate.y);
  const tile = state.tiles[idx];
  tile.houseValue = computeDeterministicHouseValue(state, idx, town.id, effectiveYear);
  tile.houseResidents = computeDeterministicHouseResidents(state, idx, town.id, effectiveYear);
  tile.houseDestroyed = false;
  if (!placeHouse(state, idx, town.id, constructionYear)) {
    return false;
  }
  markHouseFootprint(state, candidate.bounds, context);
  context.footprints.set(idx, candidate.bounds);
  return true;
};

const estimateTownBounds = (state: WorldState, town: Town): { minX: number; maxX: number; minY: number; maxY: number } => {
  let minX = Math.max(0, Math.floor(getTownCenterX(town) - Math.max(MIN_TOWN_RADIUS, town.radius) - FRONTAGE_SCAN_MARGIN));
  let maxX = Math.min(
    state.grid.cols - 1,
    Math.ceil(getTownCenterX(town) + Math.max(MIN_TOWN_RADIUS, town.radius) + FRONTAGE_SCAN_MARGIN)
  );
  let minY = Math.max(0, Math.floor(getTownCenterY(town) - Math.max(MIN_TOWN_RADIUS, town.radius) - FRONTAGE_SCAN_MARGIN));
  let maxY = Math.min(
    state.grid.rows - 1,
    Math.ceil(getTownCenterY(town) + Math.max(MIN_TOWN_RADIUS, town.radius) + FRONTAGE_SCAN_MARGIN)
  );
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileTownId[idx] !== town.id || state.tileStructure[idx] !== STRUCTURE_HOUSE) {
      continue;
    }
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    minX = Math.min(minX, Math.max(0, x - FRONTAGE_SCAN_MARGIN));
    maxX = Math.max(maxX, Math.min(state.grid.cols - 1, x + FRONTAGE_SCAN_MARGIN));
    minY = Math.min(minY, Math.max(0, y - FRONTAGE_SCAN_MARGIN));
    maxY = Math.max(maxY, Math.min(state.grid.rows - 1, y + FRONTAGE_SCAN_MARGIN));
  }
  for (let i = 0; i < town.growthFrontiers.length; i += 1) {
    const frontier = town.growthFrontiers[i]!;
    minX = Math.min(minX, Math.max(0, frontier.x - FRONTAGE_SCAN_MARGIN));
    maxX = Math.max(maxX, Math.min(state.grid.cols - 1, frontier.x + FRONTAGE_SCAN_MARGIN));
    minY = Math.min(minY, Math.max(0, frontier.y - FRONTAGE_SCAN_MARGIN));
    maxY = Math.max(maxY, Math.min(state.grid.rows - 1, frontier.y + FRONTAGE_SCAN_MARGIN));
  }
  return { minX, maxX, minY, maxY };
};

const countAdjacentOwnedHouses = (state: WorldState, townId: number, x: number, y: number): number => {
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ];
  let count = 0;
  for (let i = 0; i < neighbors.length; i += 1) {
    const point = neighbors[i]!;
    if (!inBounds(state.grid, point.x, point.y)) {
      continue;
    }
    const idx = indexFor(state.grid, point.x, point.y);
    if (state.tileStructure[idx] === STRUCTURE_HOUSE && state.tileTownId[idx] === townId) {
      count += 1;
    }
  }
  return count;
};

const countRoadDegree = (state: WorldState, x: number, y: number): number => {
  if (!isStreetTile(state, x, y)) {
    return 0;
  }
  const mask = state.tileRoadEdges[indexFor(state.grid, x, y)] ?? 0;
  let degree = 0;
  for (let bit = mask; bit !== 0; bit &= bit - 1) {
    degree += 1;
  }
  return degree;
};

const computeFrontageScore = (
  state: WorldState,
  town: Town,
  point: Point,
  roadX: number,
  roadY: number,
  setback: number,
  distFrontier: number,
  ownedAdjacency: number
): number => {
  const distCenter = Math.hypot(point.x - getTownCenterX(town), point.y - getTownCenterY(town));
  const coreRadius = Math.max(TOWN_CORE_RADIUS + 1, Math.min(Math.max(MIN_TOWN_RADIUS, town.radius) * 0.45, TOWN_CORE_RADIUS + 4));
  const coreOverflow = Math.max(0, distCenter - coreRadius);
  const roadDegree = countRoadDegree(state, roadX, roadY);
  const intersectionBias = roadDegree >= 3 ? -1.25 : roadDegree === 2 ? -0.35 : 0.45;
  const earlyCoreBias = town.houseCount < 8 ? distCenter * 0.7 + coreOverflow * 1.3 : 0;
  return (
    distCenter * 0.95 +
    coreOverflow * 1.9 +
    Math.min(distFrontier, 12) * 0.08 +
    setback * 0.45 -
    ownedAdjacency * 1.5 +
    intersectionBias +
    earlyCoreBias
  );
};

const collectFrontageCandidates = (state: WorldState, town: Town, context: GrowthContext): FrontageCandidate[] => {
  const bounds = estimateTownBounds(state, town);
  const candidates = new Map<string, FrontageCandidate>();
  const activeFrontiers = town.growthFrontiers.filter((frontier) => frontier.active);
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!isStreetTile(state, x, y)) {
        continue;
      }
      const roadNeighbors = [
        { dx: 1, dy: 0 },
        { dx: -1, dy: 0 },
        { dx: 0, dy: 1 },
        { dx: 0, dy: -1 }
      ];
      for (let i = 0; i < roadNeighbors.length; i += 1) {
        const side = roadNeighbors[i]!;
        for (let setback = 1; setback <= 2; setback += 1) {
          const point = {
            x: x + side.dx * setback,
            y: y + side.dy * setback
          };
          if (!inBounds(state.grid, point.x, point.y) || !isBuildable(state, point.x, point.y)) {
            continue;
          }
          const key = `${point.x},${point.y}`;
          const seed = indexFor(state.grid, point.x, point.y) + town.id * 101;
          const rotation = pickHouseRotationFromRoad(state, point.x, point.y, seed);
          const boundsAtPoint = getHouseFootprintBounds(point.x, point.y, rotation, pickHouseFootprint(seed));
          if (!canPlaceHouseFootprint(state, boundsAtPoint) || !footprintTouchesStreet(state, boundsAtPoint)) {
            continue;
          }
          const distCenter = Math.hypot(point.x - getTownCenterX(town), point.y - getTownCenterY(town));
          let distFrontier = 0;
          if (activeFrontiers.length > 0) {
            distFrontier = activeFrontiers.reduce(
              (best, frontier) => Math.min(best, Math.abs(point.x - frontier.x) + Math.abs(point.y - frontier.y)),
              Number.POSITIVE_INFINITY
            );
          }
          const ownedAdjacency = countAdjacentOwnedHouses(state, town.id, point.x, point.y);
          const score = computeFrontageScore(state, town, point, x, y, setback, distFrontier, ownedAdjacency);
          const existing = candidates.get(key);
          if (existing && existing.score <= score) {
            continue;
          }
          candidates.set(key, {
            x: point.x,
            y: point.y,
            bounds: boundsAtPoint,
            score,
            distCenter
          });
        }
      }
    }
  }
  return [...candidates.values()].sort((left, right) => {
    if (left.score !== right.score) {
      return left.score - right.score;
    }
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    return left.x - right.x;
  });
};

const evaluateTargetRelief = (state: WorldState, x: number, y: number): number => {
  const idx = indexFor(state.grid, x, y);
  const center = state.tiles[idx]?.elevation ?? 0;
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
      maxDiff = Math.max(maxDiff, Math.abs(center - (state.tiles[indexFor(state.grid, nx, ny)]?.elevation ?? center)));
    }
  }
  return maxDiff;
};

const findBuildableTargetNear = (state: WorldState, origin: Point, radius: number): Point | null => {
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      if (!isBuildable(state, x, y)) {
        continue;
      }
      const score =
        Math.abs(origin.x - x) +
        Math.abs(origin.y - y) +
        evaluateTargetRelief(state, x, y) * 64 +
        (isStreetTile(state, x, y) ? 10 : 0);
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
};

const buildRoadOptions = (state: WorldState): SettlementRoadOptions => ({
  bridgePolicy: "allow",
  heightScaleMultiplier: 1,
  diagonalPenalty: Math.max(0, Math.min(0.4, state.tileRoadEdges.length > 0 ? 0.18 : 0.18))
});

const determineExtensionLength = (town: Town): number => {
  if (town.streetArchetype === "ribbon") {
    return FRONTIER_EXTENSION_MAX;
  }
  if (town.streetArchetype === "contour") {
    return FRONTIER_EXTENSION_MIN + 1;
  }
  if (town.streetArchetype === "crossroads") {
    return FRONTIER_EXTENSION_MIN + 2;
  }
  return FRONTIER_EXTENSION_MIN + 1;
};

const selectGrowthFrontier = (town: Town): TownGrowthFrontier | null => {
  const active = town.growthFrontiers.filter((frontier) => frontier.active);
  if (active.length === 0) {
    return null;
  }
  let best = active[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < active.length; i += 1) {
    const frontier = active[i]!;
    const score =
      Math.hypot(frontier.x - town.x, frontier.y - town.y) +
      (frontier.branchType === "primary" ? 0.55 : 0) +
      (frontier.dx === 0 || frontier.dy === 0 ? 0 : 0.2);
    if (score < bestScore) {
      bestScore = score;
      best = frontier;
    }
  }
  return best;
};

const extendTownFrontier = (
  state: WorldState,
  town: Town,
  roadAdapter: SettlementRoadAdapter,
  frontier: TownGrowthFrontier
): boolean => {
  const extensionLength = determineExtensionLength(town);
  for (let len = extensionLength; len >= FRONTIER_EXTENSION_MIN; len -= 1) {
    const projected = { x: frontier.x + frontier.dx * len, y: frontier.y + frontier.dy * len };
    const target = findBuildableTargetNear(state, projected, 3);
    if (!target) {
      continue;
    }
    if (roadAdapter.carveRoad(state, { x: frontier.x, y: frontier.y }, target, buildRoadOptions(state))) {
      frontier.x = target.x;
      frontier.y = target.y;
      frontier.active = true;
      return true;
    }
  }
  frontier.active = false;
  return false;
};

const addSecondaryStreet = (state: WorldState, town: Town, roadAdapter: SettlementRoadAdapter): boolean => {
  const maxFrontiers = MAX_FRONTIERS_BY_ARCHETYPE[town.streetArchetype];
  if (town.growthFrontiers.length >= maxFrontiers) {
    return false;
  }
  const source =
    [...town.growthFrontiers]
      .sort((left, right) => {
        const leftScore = Math.hypot(left.x - town.x, left.y - town.y) + (left.branchType === "primary" ? 0 : 0.35);
        const rightScore = Math.hypot(right.x - town.x, right.y - town.y) + (right.branchType === "primary" ? 0 : 0.35);
        return leftScore - rightScore;
      })
      .find((frontier) => frontier.active) ?? selectGrowthFrontier(town) ?? town.growthFrontiers[0];
  if (!source) {
    return false;
  }
  const candidateDirs = [
    { dx: -source.dy, dy: source.dx },
    { dx: source.dy, dy: -source.dx }
  ];
  for (let i = 0; i < candidateDirs.length; i += 1) {
    const dir = candidateDirs[(i + town.id) % candidateDirs.length]!;
    const projected = {
      x: source.x + dir.dx * SECONDARY_BRANCH_MAX,
      y: source.y + dir.dy * SECONDARY_BRANCH_MAX
    };
    const target = findBuildableTargetNear(state, projected, SECONDARY_BRANCH_MIN);
    if (!target) {
      continue;
    }
    if (!roadAdapter.carveRoad(state, { x: source.x, y: source.y }, target, buildRoadOptions(state))) {
      continue;
    }
    town.growthFrontiers.push({
      x: target.x,
      y: target.y,
      dx: dir.dx,
      dy: dir.dy,
      active: true,
      branchType: "secondary"
    });
    return true;
  }
  return false;
};

const shouldAddSecondaryStreetEarly = (town: Town, bestFrontage: FrontageCandidate | null): boolean => {
  if (town.growthFrontiers.length >= MAX_FRONTIERS_BY_ARCHETYPE[town.streetArchetype]) {
    return false;
  }
  const activeSecondaryCount = town.growthFrontiers.filter(
    (frontier) => frontier.active && frontier.branchType === "secondary"
  ).length;
  const desiredSecondaryCount =
    town.streetArchetype === "crossroads" ? 2 : town.streetArchetype === "main_street" ? 1 : town.streetArchetype === "ribbon" ? 1 : 0;
  if (desiredSecondaryCount === 0 || activeSecondaryCount >= desiredSecondaryCount) {
    return false;
  }
  if (!bestFrontage) {
    return true;
  }
  return bestFrontage.distCenter > TOWN_CORE_RADIUS + 1 || town.houseCount < 8;
};

const collectOwnedHouses = (state: WorldState, townId: number): number[] => {
  const result: number[] = [];
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileStructure[idx] === STRUCTURE_HOUSE && state.tileTownId[idx] === townId && state.tiles[idx]?.type === "house") {
      result.push(idx);
    }
  }
  return result;
};

const pruneUnusedDeadEnds = (state: WorldState, town: Town, roadAdapter: SettlementRoadAdapter): void => {
  void state;
  void town;
  void roadAdapter;
};

const updateTownEnvelope = (state: WorldState, town: Town): void => {
  let sumX = town.x;
  let sumY = town.y;
  let count = 1;
  let maxRadius = MIN_TOWN_RADIUS;
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileTownId[idx] !== town.id || state.tileStructure[idx] !== STRUCTURE_HOUSE) {
      continue;
    }
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    sumX += x;
    sumY += y;
    count += 1;
    maxRadius = Math.max(maxRadius, Math.hypot(x - town.x, y - town.y) + 2.5);
  }
  for (let i = 0; i < town.growthFrontiers.length; i += 1) {
    const frontier = town.growthFrontiers[i]!;
    sumX += frontier.x;
    sumY += frontier.y;
    count += 1;
    maxRadius = Math.max(maxRadius, Math.hypot(frontier.x - town.x, frontier.y - town.y) + 2);
  }
  town.cx = sumX / count;
  town.cy = sumY / count;
  town.radius = Math.max(MIN_TOWN_RADIUS, maxRadius);
};

const computeRuntimePenalty = (town: Town): number => {
  const total = Math.max(1, town.houseCount + town.housesLost);
  const lossShare = town.housesLost / total;
  const approvalPenalty = 1 - clamp01(town.approval);
  return lossShare * 1.6 + approvalPenalty * 1.1;
};

const computeGrowthScore = (town: Town, mode: GrowthMode): number => {
  const frontierBoost = town.growthFrontiers.filter((frontier) => frontier.active).length * 0.12;
  const profileBoost =
    town.industryProfile === "farming" ? 0.18 : town.industryProfile === "coastal" ? 0.12 : town.industryProfile === "mining" ? -0.04 : 0.08;
  const runtimePenalty = mode === "runtime" ? computeRuntimePenalty(town) : 0;
  return Math.max(0.1, 1 + frontierBoost + profileBoost - runtimePenalty);
};

const computeRegionalGrowthBudget = (state: WorldState, effectiveYear: number): number => {
  const base = Math.max(1, state.towns.length);
  return base + Math.floor(Math.max(0, effectiveYear) / 5);
};

const assignDesiredGrowthDeltas = (state: WorldState, effectiveYear: number, mode: GrowthMode): void => {
  const budget = computeRegionalGrowthBudget(state, effectiveYear);
  const scored = state.towns.map((town) => ({
    town,
    score: computeGrowthScore(town, mode)
  }));
  const scoreSum = scored.reduce((sum, entry) => sum + entry.score, 0);
  let assigned = 0;
  const remainders: Array<{ town: Town; remainder: number }> = [];
  for (let i = 0; i < scored.length; i += 1) {
    const entry = scored[i]!;
    const raw = scoreSum > 0 ? (budget * entry.score) / scoreSum : 0;
    const whole = Math.floor(raw);
    entry.town.desiredHouseDelta = whole;
    entry.town.lastSeasonHouseDelta = 0;
    assigned += whole;
    remainders.push({ town: entry.town, remainder: raw - whole });
  }
  remainders.sort((left, right) => {
    if (right.remainder !== left.remainder) {
      return right.remainder - left.remainder;
    }
    return left.town.id - right.town.id;
  });
  let leftover = budget - assigned;
  for (let i = 0; i < remainders.length && leftover > 0; i += 1) {
    remainders[i]!.town.desiredHouseDelta = Math.trunc(remainders[i]!.town.desiredHouseDelta ?? 0) + 1;
    leftover -= 1;
  }
  if (mode === "runtime") {
    for (let i = 0; i < state.towns.length; i += 1) {
      const town = state.towns[i]!;
      const penalty = computeRuntimePenalty(town);
      if (penalty > 0.58) {
        town.desiredHouseDelta = Math.max(-2, Math.trunc(town.desiredHouseDelta ?? 0) - 2);
      } else if (penalty > 0.32) {
        town.desiredHouseDelta = Math.max(-1, Math.trunc(town.desiredHouseDelta ?? 0) - 1);
      }
    }
  }
};

const growTown = (
  state: WorldState,
  town: Town,
  desiredDelta: number,
  context: GrowthContext,
  roadAdapter: SettlementRoadAdapter,
  effectiveYear: number,
  constructionYear: number
): number => {
  let placed = 0;
  let safety = 0;
  while (placed < desiredDelta && safety < desiredDelta * 8 + 12) {
    safety += 1;
    const frontage = collectFrontageCandidates(state, town, context);
    if (shouldAddSecondaryStreetEarly(town, frontage[0] ?? null) && addSecondaryStreet(state, town, roadAdapter)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (frontage.length > 0) {
      if (placeFrontageHouse(state, town, frontage[0]!, context, effectiveYear, constructionYear)) {
        placed += 1;
        continue;
      }
    }
    const activeFrontier = selectGrowthFrontier(town);
    if (activeFrontier && extendTownFrontier(state, town, roadAdapter, activeFrontier)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (addSecondaryStreet(state, town, roadAdapter)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    break;
  }
  if (placed > 0) {
    pruneUnusedDeadEnds(state, town, roadAdapter);
  }
  return placed;
};

const shrinkTown = (state: WorldState, town: Town, delta: number, roadAdapter: SettlementRoadAdapter): number => {
  const owned = collectOwnedHouses(state, town.id);
  owned.sort((left, right) => {
    const lx = left % state.grid.cols;
    const ly = Math.floor(left / state.grid.cols);
    const rx = right % state.grid.cols;
    const ry = Math.floor(right / state.grid.cols);
    const leftDist = Math.hypot(lx - getTownCenterX(town), ly - getTownCenterY(town));
    const rightDist = Math.hypot(rx - getTownCenterX(town), ry - getTownCenterY(town));
    if (leftDist !== rightDist) {
      return rightDist - leftDist;
    }
    return left - right;
  });
  let removed = 0;
  for (let i = 0; i < owned.length && removed < delta; i += 1) {
    if (removeHouse(state, owned[i]!)) {
      removed += 1;
    }
  }
  if (removed > 0) {
    pruneUnusedDeadEnds(state, town, roadAdapter);
  }
  return removed;
};

const applyTownGrowthStep = (state: WorldState, roadAdapter: SettlementRoadAdapter, effectiveYear: number, mode: GrowthMode): void => {
  if (state.towns.length === 0) {
    return;
  }
  recountTownHouses(state);
  let context = rebuildGrowthContext(state);
  const constructionYear = mode === "runtime" ? getFractionalSimulationYear(state.careerDay) : effectiveYear;
  assignDesiredGrowthDeltas(state, effectiveYear, mode);
  for (let i = 0; i < state.towns.length; i += 1) {
    const town = state.towns[i]!;
    const desiredDelta = Math.trunc(town.desiredHouseDelta ?? 0);
    if (desiredDelta > 0) {
      const placed = growTown(state, town, desiredDelta, context, roadAdapter, effectiveYear, constructionYear);
      town.lastSeasonHouseDelta = placed;
    } else if (desiredDelta < 0) {
      const removed = shrinkTown(state, town, Math.abs(desiredDelta), roadAdapter);
      town.lastSeasonHouseDelta = -removed;
      context = rebuildGrowthContext(state);
    } else {
      town.lastSeasonHouseDelta = 0;
    }
    town.simulatedGrowthYears = Math.max(town.simulatedGrowthYears, effectiveYear + 1);
    updateTownEnvelope(state, town);
  }
  state.settlementPlacedHouses = state.totalHouses;
  recountTownHouses(state);
  const invariant = validateTownInvariants(state);
  if (!invariant.ok) {
    console.warn(`[towns] growth invariant failure: ${invariant.errors.slice(0, 8).join(" | ")}`);
  }
};

export const simulateTownGrowthYears = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  years: number
): void => {
  for (let year = 0; year < years; year += 1) {
    applyTownGrowthStep(state, roadAdapter, year, "mapgen");
  }
};

export const stepRuntimeTownGrowth = (state: WorldState, roadAdapter: SettlementRoadAdapter): void => {
  if (state.phase !== "growth" || state.townGrowthAppliedYear === state.year) {
    return;
  }
  state.townGrowthAppliedYear = state.year;
  const effectiveYear =
    state.towns.length > 0
      ? Math.max(
          state.year - 1,
          Math.max(...state.towns.map((town) => Math.max(0, Math.floor(town.simulatedGrowthYears ?? 0))))
        )
      : state.year - 1;
  applyTownGrowthStep(state, roadAdapter, effectiveYear, "runtime");
};
