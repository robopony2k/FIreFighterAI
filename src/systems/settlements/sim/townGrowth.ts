import {
  getHouseFootprintBounds,
  getHouseFootprintDims,
  pickHouseFootprint,
  type HouseFootprintBounds
} from "../../../core/houseFootprints.js";
import {
  findBestRoadReferenceForPlot,
  getRoadConnectionOffsets,
  getRoadFrontageOffsets,
  pickHouseRotationFromRoadMask
} from "../../../core/roadAlignment.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import type { WorldState } from "../../../core/state.js";
import { hash2D } from "../../../mapgen/noise.js";
import {
  placeHouse,
  removeHouse,
  recountTownHouses,
  upgradeHouseDensity,
  validateTownInvariants,
  STRUCTURE_HOUSE,
  STRUCTURE_NONE
} from "../../../core/towns.js";
import type { Point, Town, TownGrowthFrontier } from "../../../core/types.js";
import { clamp } from "../../../core/utils.js";
import { getCompletedConstructionYear, getFractionalSimulationYear } from "./buildingLifecycle.js";
import {
  BUILDABLE_SLOPE_LIMIT,
  COMPACT_TOWN_ASPECT_HARD_LIMIT,
  COMPACT_TOWN_ASPECT_SOFT_LIMIT,
  COMPACT_TOWN_BLOCK_OFFSET,
  COMPACT_TOWN_BRANCH_TARGET_ROAD_BUFFER,
  COMPACT_TOWN_CONNECTOR_OFFSET,
  COMPACT_TOWN_INTERIOR_BRANCH_SCAN_RADIUS,
  COMPACT_TOWN_LONG_AXIS_PENALTY,
  COMPACT_TOWN_MAX_ROAD_RADIUS,
  COMPACT_TOWN_MIN_CORE_HOUSES,
  FRONTAGE_SCAN_MARGIN,
  FRONTIER_EXTENSION_MAX,
  FRONTIER_EXTENSION_MIN,
  HOUSE_BUFFER_RADIUS,
  MAX_FRONTIERS_BY_ARCHETYPE,
  MIN_TOWN_RADIUS,
  SECONDARY_BRANCH_MAX,
  SECONDARY_BRANCH_MIN,
  TOWN_CORE_RADIUS,
  TOWN_FRONTIER_BOOTSTRAP_LENGTH,
  TOWN_FRONTIER_RECOVERY_RADIUS_BONUS
} from "../constants/settlementConstants.js";
import type { SettlementRoadAdapter, SettlementRoadOptions } from "../types/settlementTypes.js";

type GrowthMode = "mapgen" | "runtime";

export type GrowthContext = {
  footprints: Map<number, HouseFootprintBounds>;
  clearanceRects: Map<number, HouseClearanceRect>;
};

type FrontageCandidate = {
  x: number;
  y: number;
  bounds: HouseFootprintBounds;
  clearanceRect: HouseClearanceRect;
  styleSeed: number;
  score: number;
  distCenter: number;
  elongationPenalty: number;
};

export type ReservedBuildingLotCandidate = {
  anchorIndex: number;
  styleSeed: number;
  houseValue: number;
  houseResidents: number;
};

type TownEnvelopeMetrics = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  aspect: number;
  longAxis: "x" | "y";
};

type TownRoadAnchorCandidate = {
  x: number;
  y: number;
  dx: number;
  dy: number;
  score: number;
};

type HouseClearanceRect = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

const clamp01 = (value: number): number => clamp(value, 0, 1);
const COMPACT_TOWN_BRANCH_ASPECT_LIMIT = 1.35;
const TOWN_DENSIFY_RESIDENT_DELTA = 2;
const TOWN_DENSIFY_VALUE_DELTA = 90;
const HOUSE_CLEARANCE_MARGIN = 0.08;

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

const getRoadMaskAt = (state: WorldState, x: number, y: number): number => {
  if (!inBounds(state.grid, x, y)) {
    return 0;
  }
  return state.tileRoadEdges[indexFor(state.grid, x, y)] ?? 0;
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

const isCompactTownArchetype = (town: Town): boolean =>
  town.streetArchetype === "crossroads" || town.streetArchetype === "main_street";

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
  const reference = findBestRoadReferenceForPlot(tileX, tileY, (x, y) => isStreetTile(state, x, y), (x, y) => getRoadMaskAt(state, x, y));
  return pickHouseRotationFromRoadMask(reference?.roadMask ?? 0, seed);
};

const footprintTouchesStreet = (state: WorldState, bounds: HouseFootprintBounds): boolean => {
  for (let y = bounds.minY - 1; y <= bounds.maxY + 1; y += 1) {
    for (let x = bounds.minX - 1; x <= bounds.maxX + 1; x += 1) {
      if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
        continue;
      }
      if (isStreetTile(state, x, y)) {
        return true;
      }
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

const createHouseClearanceRect = (
  tileX: number,
  tileY: number,
  rotation: number,
  footprint: Parameters<typeof getHouseFootprintDims>[1]
): HouseClearanceRect => {
  const { width, depth } = getHouseFootprintDims(rotation, footprint);
  const centerX = tileX + 0.5;
  const centerY = tileY + 0.5;
  return {
    minX: centerX - width / 2 - HOUSE_CLEARANCE_MARGIN,
    maxX: centerX + width / 2 + HOUSE_CLEARANCE_MARGIN,
    minY: centerY - depth / 2 - HOUSE_CLEARANCE_MARGIN,
    maxY: centerY + depth / 2 + HOUSE_CLEARANCE_MARGIN
  };
};

const clearanceRectsOverlap = (left: HouseClearanceRect, right: HouseClearanceRect): boolean =>
  left.minX < right.maxX && left.maxX > right.minX && left.minY < right.maxY && left.maxY > right.minY;

const canPlaceHouseClearance = (context: GrowthContext, rect: HouseClearanceRect): boolean => {
  for (const existing of context.clearanceRects.values()) {
    if (clearanceRectsOverlap(existing, rect)) {
      return false;
    }
  }
  return true;
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

export const rebuildGrowthContext = (state: WorldState): GrowthContext => {
  state.structureMask.fill(0);
  const context: GrowthContext = {
    footprints: new Map<number, HouseFootprintBounds>(),
    clearanceRects: new Map<number, HouseClearanceRect>()
  };
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    const tile = state.tiles[idx];
    if (tile?.type !== "house") {
      continue;
    }
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    const styleSeed = Number.isFinite(tile.houseStyleSeed) ? Math.trunc(tile.houseStyleSeed as number) : idx;
    const rotation = pickHouseRotationFromRoad(state, x, y, styleSeed);
    const footprint = pickHouseFootprint(styleSeed);
    const bounds = getHouseFootprintBounds(x, y, rotation, footprint, "asset");
    markHouseFootprint(state, bounds, context);
    context.footprints.set(idx, bounds);
    context.clearanceRects.set(idx, createHouseClearanceRect(x, y, rotation, footprint));
  }
  for (let i = 0; i < state.buildingLots.length; i += 1) {
    const lot = state.buildingLots[i]!;
    const anchorIndex = lot.anchorIndex;
    const x = anchorIndex % state.grid.cols;
    const y = Math.floor(anchorIndex / state.grid.cols);
    const rotation = pickHouseRotationFromRoad(state, x, y, lot.styleSeed);
    const footprint = pickHouseFootprint(lot.styleSeed);
    const bounds = getHouseFootprintBounds(x, y, rotation, footprint, "asset");
    markHouseFootprint(state, bounds, context);
    context.footprints.set(anchorIndex, bounds);
    context.clearanceRects.set(anchorIndex, createHouseClearanceRect(x, y, rotation, footprint));
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
  if (!placeHouse(state, idx, town.id, constructionYear, candidate.styleSeed)) {
    return false;
  }
  markHouseFootprint(state, candidate.bounds, context);
  context.footprints.set(idx, candidate.bounds);
  context.clearanceRects.set(idx, candidate.clearanceRect);
  return true;
};

const selectDeterministicFrontageCandidate = (
  state: WorldState,
  town: Town,
  frontage: readonly FrontageCandidate[]
): FrontageCandidate | null => {
  if (frontage.length <= 0) {
    return null;
  }
  const candidatePoolSize = Math.min(3, frontage.length);
  const choice =
    candidatePoolSize <= 1
      ? 0
      : Math.floor(hash2D(town.id + 1, Math.max(0, town.buildStartSerial ?? 0) + 1, state.seed ^ 0x2db9f8db) * candidatePoolSize);
  return frontage[Math.max(0, Math.min(candidatePoolSize - 1, choice))] ?? frontage[0] ?? null;
};

export const reserveTownExpansionLot = (
  state: WorldState,
  town: Town,
  context: GrowthContext,
  roadAdapter: SettlementRoadAdapter,
  effectiveYear: number
): ReservedBuildingLotCandidate | null => {
  let safety = 0;
  while (safety < 12) {
    safety += 1;
    ensureTownGrowthFrontiers(state, town, roadAdapter);
    const metrics = buildTownEnvelopeMetrics(state, town);
    const roadGrowthCapped = isCompactTownRoadGrowthCapped(state, town);
    const needsSecondAxis = isCompactTownArchetype(town) && getActiveFrontierAxisCount(town) < 2 && town.houseCount >= 1;
    const frontage = collectFrontageCandidates(state, town, context);
    const frontagePool =
      isCompactTownArchetype(town) && metrics.aspect >= COMPACT_TOWN_ASPECT_SOFT_LIMIT
        ? frontage.filter((candidate) => candidate.elongationPenalty <= 0.01)
        : frontage;
    const usableFrontage = frontagePool.length > 0 ? frontagePool : frontage;
    if (
      isCompactTownArchetype(town) &&
      (usableFrontage.length <= 0 || roadGrowthCapped) &&
      addInteriorBlockStreet(state, town, roadAdapter, metrics)
    ) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    const selected = selectDeterministicFrontageCandidate(state, town, usableFrontage);
    if (selected && canPlaceHouseFootprint(state, selected.bounds)) {
      const anchorIndex = indexFor(state.grid, selected.x, selected.y);
      markHouseFootprint(state, selected.bounds, context);
      context.footprints.set(anchorIndex, selected.bounds);
      context.clearanceRects.set(anchorIndex, selected.clearanceRect);
      return {
        anchorIndex,
        styleSeed: selected.styleSeed,
        houseValue: computeDeterministicHouseValue(state, anchorIndex, town.id, effectiveYear),
        houseResidents: computeDeterministicHouseResidents(state, anchorIndex, town.id, effectiveYear)
      };
    }
    if (!roadGrowthCapped && needsSecondAxis && addMissingCompactAxisStreet(state, town, roadAdapter)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (!roadGrowthCapped && shouldAddSecondaryStreetEarly(state, town, usableFrontage[0] ?? null, metrics) && addSecondaryStreet(state, town, roadAdapter, metrics)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (!roadGrowthCapped && tryExtendAnyGrowthFrontier(state, town, roadAdapter, metrics)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (!roadGrowthCapped && addSecondaryStreet(state, town, roadAdapter, metrics)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (!town.growthFrontiers.some((frontier) => frontier.active)) {
      ensureTownGrowthFrontiers(state, town, roadAdapter);
      if (town.growthFrontiers.some((frontier) => frontier.active)) {
        continue;
      }
    }
    break;
  }
  return null;
};

const estimateTownBounds = (state: WorldState, town: Town): { minX: number; maxX: number; minY: number; maxY: number } => {
  let minX = state.grid.cols - 1;
  let maxX = 0;
  let minY = state.grid.rows - 1;
  let maxY = 0;
  let foundExtent = false;
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileTownId[idx] !== town.id || state.tileStructure[idx] !== STRUCTURE_HOUSE) {
      continue;
    }
    foundExtent = true;
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  for (let i = 0; i < town.growthFrontiers.length; i += 1) {
    const frontier = town.growthFrontiers[i]!;
    if (!frontier.active) {
      continue;
    }
    foundExtent = true;
    minX = Math.min(minX, frontier.x);
    maxX = Math.max(maxX, frontier.x);
    minY = Math.min(minY, frontier.y);
    maxY = Math.max(maxY, frontier.y);
  }
  if (!foundExtent) {
    const centerX = Math.round(getTownCenterX(town));
    const centerY = Math.round(getTownCenterY(town));
    const fallbackRadius = MIN_TOWN_RADIUS + FRONTAGE_SCAN_MARGIN;
    return {
      minX: Math.max(0, centerX - fallbackRadius),
      maxX: Math.min(state.grid.cols - 1, centerX + fallbackRadius),
      minY: Math.max(0, centerY - fallbackRadius),
      maxY: Math.min(state.grid.rows - 1, centerY + fallbackRadius)
    };
  }
  return {
    minX: Math.max(0, minX - FRONTAGE_SCAN_MARGIN),
    maxX: Math.min(state.grid.cols - 1, maxX + FRONTAGE_SCAN_MARGIN),
    minY: Math.max(0, minY - FRONTAGE_SCAN_MARGIN),
    maxY: Math.min(state.grid.rows - 1, maxY + FRONTAGE_SCAN_MARGIN)
  };
};

const buildTownEnvelopeMetrics = (state: WorldState, town: Town): TownEnvelopeMetrics => {
  const bounds = estimateTownBounds(state, town);
  const width = bounds.maxX - bounds.minX + 1;
  const height = bounds.maxY - bounds.minY + 1;
  return {
    ...bounds,
    width,
    height,
    aspect: Math.max(width, height) / Math.max(1, Math.min(width, height)),
    longAxis: width >= height ? "x" : "y"
  };
};

const pruneInactiveGrowthFrontiers = (town: Town): void => {
  if (town.growthFrontiers.every((frontier) => frontier.active)) {
    return;
  }
  town.growthFrontiers = town.growthFrontiers.filter((frontier) => frontier.active);
};

const hasStreetTargetBuffer = (state: WorldState, origin: Point, radius: number): boolean => {
  for (let y = origin.y - radius; y <= origin.y + radius; y += 1) {
    for (let x = origin.x - radius; x <= origin.x + radius; x += 1) {
      if (!inBounds(state.grid, x, y)) {
        continue;
      }
      if (isStreetTile(state, x, y)) {
        return true;
      }
    }
  }
  return false;
};

const getCompactTownRoadRadius = (state: WorldState, town: Town): number => {
  const centerX = getTownCenterX(town);
  const centerY = getTownCenterY(town);
  let maxRadius = 0;
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileTownId[idx] !== town.id || state.tileStructure[idx] !== STRUCTURE_HOUSE) {
      continue;
    }
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    maxRadius = Math.max(maxRadius, Math.hypot(x - centerX, y - centerY));
  }
  for (let i = 0; i < town.growthFrontiers.length; i += 1) {
    const frontier = town.growthFrontiers[i]!;
    if (!frontier.active) {
      continue;
    }
    maxRadius = Math.max(maxRadius, Math.hypot(frontier.x - centerX, frontier.y - centerY));
  }
  return maxRadius;
};

const isCompactTownRoadGrowthCapped = (state: WorldState, town: Town): boolean =>
  isCompactTownArchetype(town) && getCompactTownRoadRadius(state, town) >= COMPACT_TOWN_MAX_ROAD_RADIUS;

const getActiveFrontierAxisCount = (town: Town): number =>
  new Set(
    town.growthFrontiers
      .filter((frontier) => frontier.active)
      .map((frontier) => (Math.abs(frontier.dx) > Math.abs(frontier.dy) ? "x" : "y"))
  ).size;

const pushGrowthFrontier = (
  town: Town,
  point: Point,
  dx: number,
  dy: number,
  branchType: TownGrowthFrontier["branchType"]
): void => {
  if (
    town.growthFrontiers.some(
      (frontier) => frontier.x === point.x && frontier.y === point.y && frontier.dx === dx && frontier.dy === dy
    )
  ) {
    return;
  }
  town.growthFrontiers.push({
    x: point.x,
    y: point.y,
    dx,
    dy,
    active: true,
    branchType
  });
};

const getRoadConnectionDirections = (state: WorldState, x: number, y: number): Array<{ dx: number; dy: number }> => {
  const offsets = getRoadConnectionOffsets(getRoadMaskAt(state, x, y)).filter((dir) => isStreetTile(state, x + dir.dx, y + dir.dy));
  if (offsets.length > 0) {
    return offsets;
  }
  const fallback: Array<{ dx: number; dy: number }> = [];
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if ((dx === 0 && dy === 0) || !isStreetTile(state, x + dx, y + dy)) {
        continue;
      }
      fallback.push({ dx, dy });
    }
  }
  return fallback;
};

const getRecoveredFrontierDirection = (
  state: WorldState,
  town: Town,
  point: Point
): { dx: number; dy: number } | null => {
  const neighbors = getRoadConnectionDirections(state, point.x, point.y);
  if (neighbors.length <= 0) {
    return null;
  }
  if (neighbors.length === 1) {
    return { dx: -neighbors[0]!.dx, dy: -neighbors[0]!.dy };
  }
  const centerX = getTownCenterX(town);
  const centerY = getTownCenterY(town);
  const offsetX = point.x - centerX;
  const offsetY = point.y - centerY;
  let best: { dx: number; dy: number } | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < neighbors.length; i += 1) {
    const outward = {
      dx: -neighbors[i]!.dx,
      dy: -neighbors[i]!.dy
    };
    const score = outward.dx * offsetX + outward.dy * offsetY;
    if (score > bestScore) {
      bestScore = score;
      best = outward;
    }
  }
  return best ?? { dx: -neighbors[0]!.dx, dy: -neighbors[0]!.dy };
};

const recoverGrowthFrontiersFromRoads = (state: WorldState, town: Town): boolean => {
  if (town.growthFrontiers.some((frontier) => frontier.active)) {
    return false;
  }
  const centerX = getTownCenterX(town);
  const centerY = getTownCenterY(town);
  const scanRadius = isCompactTownArchetype(town)
    ? Math.min(COMPACT_TOWN_MAX_ROAD_RADIUS + TOWN_FRONTIER_RECOVERY_RADIUS_BONUS, Math.ceil(town.radius + TOWN_FRONTIER_RECOVERY_RADIUS_BONUS))
    : Math.ceil(town.radius + TOWN_FRONTIER_RECOVERY_RADIUS_BONUS);
  const candidates: Array<{
    x: number;
    y: number;
    dx: number;
    dy: number;
    axis: "x" | "y";
    branchType: TownGrowthFrontier["branchType"];
    roadDegree: number;
    distCenter: number;
  }> = [];
  for (let y = Math.max(0, Math.floor(centerY - scanRadius)); y <= Math.min(state.grid.rows - 1, Math.ceil(centerY + scanRadius)); y += 1) {
    for (let x = Math.max(0, Math.floor(centerX - scanRadius)); x <= Math.min(state.grid.cols - 1, Math.ceil(centerX + scanRadius)); x += 1) {
      if (!isStreetTile(state, x, y)) {
        continue;
      }
      const distCenter = Math.hypot(x - centerX, y - centerY);
      if (distCenter < TOWN_CORE_RADIUS - 0.5 || distCenter > scanRadius + 0.5) {
        continue;
      }
      const roadDegree = countRoadDegree(state, x, y);
      if (roadDegree <= 0 || roadDegree > 2) {
        continue;
      }
      const dir = getRecoveredFrontierDirection(state, town, { x, y });
      if (!dir || (dir.dx === 0 && dir.dy === 0)) {
        continue;
      }
      const axis = Math.abs(dir.dx) >= Math.abs(dir.dy) ? "x" : "y";
      candidates.push({
        x,
        y,
        dx: dir.dx,
        dy: dir.dy,
        axis,
        branchType: axis === "x" ? "primary" : "secondary",
        roadDegree,
        distCenter
      });
    }
  }
  candidates.sort((left, right) => {
    if (left.roadDegree !== right.roadDegree) {
      return left.roadDegree - right.roadDegree;
    }
    if (right.distCenter !== left.distCenter) {
      return right.distCenter - left.distCenter;
    }
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    return left.x - right.x;
  });
  const selectedAxes = new Set<"x" | "y">();
  const targetCount = isCompactTownArchetype(town) ? 2 : Math.min(2, MAX_FRONTIERS_BY_ARCHETYPE[town.streetArchetype]);
  for (let i = 0; i < candidates.length && town.growthFrontiers.length < targetCount; i += 1) {
    const candidate = candidates[i]!;
    if (selectedAxes.has(candidate.axis) && isCompactTownArchetype(town)) {
      continue;
    }
    pushGrowthFrontier(town, { x: candidate.x, y: candidate.y }, candidate.dx, candidate.dy, candidate.branchType);
    selectedAxes.add(candidate.axis);
  }
  return town.growthFrontiers.some((frontier) => frontier.active);
};

const findCentralStreetAnchor = (state: WorldState, town: Town): Point | null => {
  const centerX = Math.round(getTownCenterX(town));
  const centerY = Math.round(getTownCenterY(town));
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = centerY - (TOWN_CORE_RADIUS + 2); y <= centerY + (TOWN_CORE_RADIUS + 2); y += 1) {
    for (let x = centerX - (TOWN_CORE_RADIUS + 2); x <= centerX + (TOWN_CORE_RADIUS + 2); x += 1) {
      if (!isStreetTile(state, x, y)) {
        continue;
      }
      const dist = Math.abs(x - centerX) + Math.abs(y - centerY);
      const degreePenalty = countRoadDegree(state, x, y) > 2 ? 1 : 0;
      const score = dist + degreePenalty;
      if (score < bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
};

const bootstrapTownCoreRoads = (state: WorldState, town: Town, roadAdapter: SettlementRoadAdapter): boolean => {
  if (town.growthFrontiers.some((frontier) => frontier.active)) {
    return false;
  }
  const center = {
    x: Math.round(getTownCenterX(town)),
    y: Math.round(getTownCenterY(town))
  };
  const localAnchor = findCentralStreetAnchor(state, town) ?? center;
  const axisPairs = [
    [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 }
    ],
    [
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 }
    ]
  ] as const;
  const scoredPairs = axisPairs
    .map((pair) => ({
      pair,
      score: pair.reduce((sum, dir) => {
        const projected = {
          x: localAnchor.x + dir.dx * TOWN_FRONTIER_BOOTSTRAP_LENGTH,
          y: localAnchor.y + dir.dy * TOWN_FRONTIER_BOOTSTRAP_LENGTH
        };
        return sum + (findBuildableTargetNear(state, projected, 2) ? 1 : 0);
      }, 0)
    }))
    .sort((left, right) => right.score - left.score);
  const desiredPairs = town.streetArchetype === "crossroads" ? 2 : 1;
  let seededPairs = 0;
  for (let pairIndex = 0; pairIndex < scoredPairs.length && seededPairs < desiredPairs; pairIndex += 1) {
    const entry = scoredPairs[pairIndex]!;
    if (entry.score <= 0) {
      continue;
    }
    let addedForPair = false;
    for (let dirIndex = 0; dirIndex < entry.pair.length; dirIndex += 1) {
      const dir = entry.pair[dirIndex]!;
      const projected = {
        x: localAnchor.x + dir.dx * TOWN_FRONTIER_BOOTSTRAP_LENGTH,
        y: localAnchor.y + dir.dy * TOWN_FRONTIER_BOOTSTRAP_LENGTH
      };
      const target = findBuildableTargetNear(state, projected, 2);
      if (!target) {
        continue;
      }
      if (!roadAdapter.carveRoad(state, localAnchor, target, buildRoadOptions(state))) {
        continue;
      }
      pushGrowthFrontier(town, target, dir.dx, dir.dy, pairIndex === 0 ? "primary" : "secondary");
      addedForPair = true;
    }
    if (addedForPair) {
      seededPairs += 1;
    }
  }
  return town.growthFrontiers.some((frontier) => frontier.active);
};

const ensureTownGrowthFrontiers = (
  state: WorldState,
  town: Town,
  roadAdapter: SettlementRoadAdapter
): void => {
  pruneInactiveGrowthFrontiers(town);
  if (town.growthFrontiers.some((frontier) => frontier.active)) {
    return;
  }
  if (recoverGrowthFrontiersFromRoads(state, town)) {
    updateTownEnvelope(state, town);
    return;
  }
  if (bootstrapTownCoreRoads(state, town, roadAdapter)) {
    roadAdapter.backfillRoadEdgesFromAdjacency(state);
    updateTownEnvelope(state, town);
  }
};

const computeInteriorBranchEnvelopeImpact = (
  metrics: TownEnvelopeMetrics,
  anchor: Point,
  dir: { dx: number; dy: number }
): {
  alignsLongAxis: boolean;
  shortAxisExpansion: number;
  longAxisExpansion: number;
  insideEnvelope: boolean;
} => {
  const projectedX = anchor.x + dir.dx * COMPACT_TOWN_BLOCK_OFFSET;
  const projectedY = anchor.y + dir.dy * COMPACT_TOWN_BLOCK_OFFSET;
  const expandX = projectedX < metrics.minX ? metrics.minX - projectedX : projectedX > metrics.maxX ? projectedX - metrics.maxX : 0;
  const expandY = projectedY < metrics.minY ? metrics.minY - projectedY : projectedY > metrics.maxY ? projectedY - metrics.maxY : 0;
  return {
    alignsLongAxis:
      (metrics.longAxis === "x" && Math.abs(dir.dx) > Math.abs(dir.dy)) ||
      (metrics.longAxis === "y" && Math.abs(dir.dy) > Math.abs(dir.dx)),
    shortAxisExpansion: metrics.longAxis === "x" ? expandY : expandX,
    longAxisExpansion: metrics.longAxis === "x" ? expandX : expandY,
    insideEnvelope: expandX <= 0 && expandY <= 0
  };
};

const computeLongAxisPenalty = (town: Town, metrics: TownEnvelopeMetrics, point: Point): number => {
  if (!isCompactTownArchetype(town) || metrics.aspect < COMPACT_TOWN_ASPECT_SOFT_LIMIT) {
    return 0;
  }
  const centerX = getTownCenterX(town);
  const centerY = getTownCenterY(town);
  const longComponent = metrics.longAxis === "x" ? Math.abs(point.x - centerX) : Math.abs(point.y - centerY);
  const shortComponent = metrics.longAxis === "x" ? Math.abs(point.y - centerY) : Math.abs(point.x - centerX);
  const overflow = Math.max(0, longComponent - shortComponent * 1.1);
  if (overflow <= 0) {
    return 0;
  }
  const aspectWeight = 0.35 + Math.max(0, metrics.aspect - COMPACT_TOWN_ASPECT_SOFT_LIMIT);
  return overflow * COMPACT_TOWN_LONG_AXIS_PENALTY * aspectWeight;
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

const hasTownIntersection = (state: WorldState, town: Town): boolean => {
  const centerX = getTownCenterX(town);
  const centerY = getTownCenterY(town);
  const scanRadius = Math.max(TOWN_CORE_RADIUS + 2, Math.ceil(town.radius));
  for (let y = Math.max(0, Math.floor(centerY - scanRadius)); y <= Math.min(state.grid.rows - 1, Math.ceil(centerY + scanRadius)); y += 1) {
    for (let x = Math.max(0, Math.floor(centerX - scanRadius)); x <= Math.min(state.grid.cols - 1, Math.ceil(centerX + scanRadius)); x += 1) {
      if (!isStreetTile(state, x, y)) {
        continue;
      }
      if (Math.hypot(x - centerX, y - centerY) > scanRadius + 0.5) {
        continue;
      }
      if (countRoadDegree(state, x, y) >= 3) {
        return true;
      }
    }
  }
  return false;
};

const computeFrontageScore = (
  state: WorldState,
  town: Town,
  metrics: TownEnvelopeMetrics,
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
  const earlyCoreBias = town.houseCount < COMPACT_TOWN_MIN_CORE_HOUSES ? distCenter * 0.7 + coreOverflow * 1.3 : 0;
  const elongationPenalty = computeLongAxisPenalty(town, metrics, point);
  return (
    distCenter * 0.95 +
    coreOverflow * 1.9 +
    Math.min(distFrontier, 12) * 0.08 +
    setback * 0.45 -
    ownedAdjacency * 1.5 +
    intersectionBias +
    earlyCoreBias +
    elongationPenalty
  );
};

const collectFrontageCandidates = (state: WorldState, town: Town, context: GrowthContext): FrontageCandidate[] => {
  const metrics = buildTownEnvelopeMetrics(state, town);
  const bounds = metrics;
  const candidates = new Map<string, FrontageCandidate>();
  const activeFrontiers = town.growthFrontiers.filter((frontier) => frontier.active);
  const centerX = getTownCenterX(town);
  const centerY = getTownCenterY(town);
  const compactRoadCoreRadius = Math.max(
    TOWN_CORE_RADIUS + 3,
    Math.min(COMPACT_TOWN_MAX_ROAD_RADIUS + 1, Math.max(MIN_TOWN_RADIUS, town.radius)) * 0.95
  );
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (!isStreetTile(state, x, y)) {
        continue;
      }
      if (isCompactTownArchetype(town)) {
        const nearCompactFrontier = activeFrontiers.some(
          (frontier) => Math.abs(frontier.x - x) + Math.abs(frontier.y - y) <= COMPACT_TOWN_BLOCK_OFFSET + 4
        );
        const nearCompactCore = Math.hypot(x - centerX, y - centerY) <= compactRoadCoreRadius;
        if (!nearCompactFrontier && !nearCompactCore) {
          continue;
        }
      }
      const roadNeighbors = getRoadFrontageOffsets(getRoadMaskAt(state, x, y));
      for (let i = 0; i < roadNeighbors.length; i += 1) {
        const side = roadNeighbors[i]!;
        const maxSetback = side.dx !== 0 && side.dy !== 0 ? 1 : 2;
        for (let setback = 1; setback <= maxSetback; setback += 1) {
          const point = {
            x: x + side.dx * setback,
            y: y + side.dy * setback
          };
          if (!inBounds(state.grid, point.x, point.y) || !isBuildable(state, point.x, point.y)) {
            continue;
          }
          const key = `${point.x},${point.y}`;
          const seed = indexFor(state.grid, point.x, point.y) + town.id * 101;
          const rotation = pickHouseRotationFromRoadMask(getRoadMaskAt(state, x, y), seed);
          const footprint = pickHouseFootprint(seed);
          const boundsAtPoint = getHouseFootprintBounds(point.x, point.y, rotation, footprint, "asset");
          const clearanceRect = createHouseClearanceRect(point.x, point.y, rotation, footprint);
          if (
            !canPlaceHouseClearance(context, clearanceRect) ||
            !canPlaceHouseFootprint(state, boundsAtPoint) ||
            !footprintTouchesStreet(state, boundsAtPoint)
          ) {
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
          const elongationPenalty = computeLongAxisPenalty(town, metrics, point);
          const score = computeFrontageScore(state, town, metrics, point, x, y, setback, distFrontier, ownedAdjacency);
          const existing = candidates.get(key);
          if (existing && existing.score <= score) {
            continue;
          }
          candidates.set(key, {
            x: point.x,
            y: point.y,
            bounds: boundsAtPoint,
            clearanceRect,
            styleSeed: seed,
            score,
            distCenter,
            elongationPenalty
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

const collectTownRoadAnchorCandidates = (
  state: WorldState,
  town: Town,
  metrics: TownEnvelopeMetrics
): TownRoadAnchorCandidate[] => {
  const centerX = getTownCenterX(town);
  const centerY = getTownCenterY(town);
  const backtrack = Math.max(1, COMPACT_TOWN_CONNECTOR_OFFSET - 1);
  const candidates = new Map<string, TownRoadAnchorCandidate>();
  const activeFrontiers = town.growthFrontiers.filter((frontier) => frontier.active);
  for (let i = 0; i < activeFrontiers.length; i += 1) {
    const frontier = activeFrontiers[i]!;
    const anchorCandidate = {
      x: frontier.x - frontier.dx * backtrack,
      y: frontier.y - frontier.dy * backtrack
    };
    const anchor = isStreetTile(state, anchorCandidate.x, anchorCandidate.y) ? anchorCandidate : { x: frontier.x, y: frontier.y };
    const degree = countRoadDegree(state, anchor.x, anchor.y);
    if (degree > 2) {
      continue;
    }
    const directions = [
      { dx: -frontier.dy, dy: frontier.dx },
      { dx: frontier.dy, dy: -frontier.dx }
    ];
    for (let directionIndex = 0; directionIndex < directions.length; directionIndex += 1) {
      const dir = directions[directionIndex]!;
      const impact = computeInteriorBranchEnvelopeImpact(metrics, anchor, dir);
      if (metrics.aspect >= COMPACT_TOWN_ASPECT_SOFT_LIMIT && impact.alignsLongAxis) {
        continue;
      }
      const projected = {
        x: anchor.x + dir.dx * COMPACT_TOWN_BLOCK_OFFSET,
        y: anchor.y + dir.dy * COMPACT_TOWN_BLOCK_OFFSET
      };
      if (hasStreetTargetBuffer(state, projected, COMPACT_TOWN_BRANCH_TARGET_ROAD_BUFFER)) {
        continue;
      }
      const key = `${anchor.x},${anchor.y},${dir.dx},${dir.dy}`;
      const shortAxisDistance =
        metrics.longAxis === "x" ? Math.abs(anchor.y - centerY) : Math.abs(anchor.x - centerX);
      const frontierDistance = Math.hypot(anchor.x - centerX, anchor.y - centerY);
      const score =
        impact.shortAxisExpansion * 3.8 -
        impact.longAxisExpansion * 2.2 +
        shortAxisDistance * 0.12 +
        frontierDistance * 0.06 +
        (frontier.branchType === "primary" ? 0.35 : 0) -
        degree * 0.45;
      candidates.set(key, { x: anchor.x, y: anchor.y, dx: dir.dx, dy: dir.dy, score });
    }
  }
  return [...candidates.values()].sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }
    if (left.y !== right.y) {
      return left.y - right.y;
    }
    return left.x - right.x;
  });
};

const addInteriorBlockStreet = (
  state: WorldState,
  town: Town,
  roadAdapter: SettlementRoadAdapter,
  metrics: TownEnvelopeMetrics
): boolean => {
  const anchors = collectTownRoadAnchorCandidates(state, town, metrics);
  for (let i = 0; i < anchors.length; i += 1) {
    const anchor = anchors[i]!;
    const projected = {
      x: anchor.x + anchor.dx * COMPACT_TOWN_BLOCK_OFFSET,
      y: anchor.y + anchor.dy * COMPACT_TOWN_BLOCK_OFFSET
    };
    const target = findBuildableTargetNear(state, projected, COMPACT_TOWN_INTERIOR_BRANCH_SCAN_RADIUS);
    if (!target) {
      continue;
    }
    if (hasStreetTargetBuffer(state, target, COMPACT_TOWN_BRANCH_TARGET_ROAD_BUFFER)) {
      continue;
    }
    if (!roadAdapter.carveRoad(state, { x: anchor.x, y: anchor.y }, target, buildRoadOptions(state))) {
      continue;
    }
    if (
      town.growthFrontiers.some(
        (frontier) => frontier.x === target.x && frontier.y === target.y && frontier.dx === anchor.dx && frontier.dy === anchor.dy
      )
    ) {
      continue;
    }
    town.growthFrontiers.push({
      x: target.x,
      y: target.y,
      dx: anchor.dx,
      dy: anchor.dy,
      active: true,
      branchType: "secondary"
    });
    return true;
  }
  return false;
};

const addMissingCompactAxisStreet = (
  state: WorldState,
  town: Town,
  roadAdapter: SettlementRoadAdapter
): boolean => {
  const centerX = getTownCenterX(town);
  const centerY = getTownCenterY(town);
  const frontiers = [...town.growthFrontiers]
    .filter((frontier) => frontier.active)
    .sort((left, right) => {
      if (left.branchType !== right.branchType) {
        return left.branchType === "primary" ? -1 : 1;
      }
      return Math.hypot(right.x - centerX, right.y - centerY) - Math.hypot(left.x - centerX, left.y - centerY);
    });
  for (let i = 0; i < frontiers.length; i += 1) {
    const frontier = frontiers[i]!;
    const anchorCandidate = {
      x: frontier.x - frontier.dx,
      y: frontier.y - frontier.dy
    };
    const anchor = isStreetTile(state, anchorCandidate.x, anchorCandidate.y) ? anchorCandidate : { x: frontier.x, y: frontier.y };
    const candidateDirs = [
      { dx: -frontier.dy, dy: frontier.dx },
      { dx: frontier.dy, dy: -frontier.dx }
    ];
    for (let dirIndex = 0; dirIndex < candidateDirs.length; dirIndex += 1) {
      const dir = candidateDirs[dirIndex]!;
      const projected = {
        x: anchor.x + dir.dx * COMPACT_TOWN_BLOCK_OFFSET,
        y: anchor.y + dir.dy * COMPACT_TOWN_BLOCK_OFFSET
      };
      const target = findBuildableTargetNear(state, projected, COMPACT_TOWN_INTERIOR_BRANCH_SCAN_RADIUS);
      if (!target || hasStreetTargetBuffer(state, target, COMPACT_TOWN_BRANCH_TARGET_ROAD_BUFFER)) {
        continue;
      }
      if (!roadAdapter.carveRoad(state, { x: anchor.x, y: anchor.y }, target, buildRoadOptions(state))) {
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
  }
  const presentAxes = new Set(
    town.growthFrontiers
      .filter((frontier) => frontier.active)
      .map((frontier) => (Math.abs(frontier.dx) > Math.abs(frontier.dy) ? "x" : "y"))
  );
  const localAnchor = findCentralStreetAnchor(state, town);
  if (!localAnchor) {
    return false;
  }
  const fallbackDirs =
    presentAxes.has("x") && !presentAxes.has("y")
      ? [
          { dx: 0, dy: 1 },
          { dx: 0, dy: -1 }
        ]
      : presentAxes.has("y") && !presentAxes.has("x")
        ? [
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 }
          ]
        : [
            { dx: 1, dy: 0 },
            { dx: -1, dy: 0 },
            { dx: 0, dy: 1 },
            { dx: 0, dy: -1 }
          ];
  for (let i = 0; i < fallbackDirs.length; i += 1) {
    const dir = fallbackDirs[i]!;
    const projected = {
      x: localAnchor.x + dir.dx * COMPACT_TOWN_BLOCK_OFFSET,
      y: localAnchor.y + dir.dy * COMPACT_TOWN_BLOCK_OFFSET
    };
    const target = findBuildableTargetNear(state, projected, COMPACT_TOWN_INTERIOR_BRANCH_SCAN_RADIUS);
    if (!target || hasStreetTargetBuffer(state, target, COMPACT_TOWN_BRANCH_TARGET_ROAD_BUFFER)) {
      continue;
    }
    if (!roadAdapter.carveRoad(state, localAnchor, target, buildRoadOptions(state))) {
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

const buildRoadOptions = (state: WorldState): SettlementRoadOptions => ({
  bridgePolicy: "allow",
  heightScaleMultiplier: 1,
  diagonalPenalty: Math.max(0, Math.min(0.35, state.tileRoadEdges.length > 0 ? 0.14 : 0.14)),
  gradeLimitStart: 0.12,
  gradeLimitRelaxStep: 0.02,
  gradeLimitMax: 0.24,
  slopePenaltyWeight: 12,
  crossfallLimitStart: 0.08,
  crossfallLimitRelaxStep: 0.018,
  crossfallLimitMax: 0.18,
  crossfallPenaltyWeight: 10,
  gradeChangeLimitStart: 0.08,
  gradeChangeLimitRelaxStep: 0.018,
  gradeChangeLimitMax: 0.18,
  gradeChangePenaltyWeight: 8,
  riverBlockDistance: 0,
  riverPenaltyDistance: 1,
  riverPenaltyWeight: 3,
  turnPenalty: 0.03,
  bridgeStepCost: 16,
  bridgeMaxConsecutiveWater: 3,
  bridgeMaxWaterTilesPerPath: 6
});

const determineExtensionLength = (town: Town, metrics?: TownEnvelopeMetrics): number => {
  if (town.streetArchetype === "ribbon") {
    return FRONTIER_EXTENSION_MAX;
  }
  if (town.streetArchetype === "contour") {
    return FRONTIER_EXTENSION_MIN + 1;
  }
  if (town.streetArchetype === "crossroads") {
    return metrics && metrics.aspect >= COMPACT_TOWN_ASPECT_SOFT_LIMIT ? FRONTIER_EXTENSION_MIN : FRONTIER_EXTENSION_MIN + 1;
  }
  if (town.streetArchetype === "main_street") {
    return FRONTIER_EXTENSION_MIN;
  }
  return FRONTIER_EXTENSION_MIN + 1;
};

const getGrowthFrontierScore = (
  town: Town,
  frontier: TownGrowthFrontier,
  metrics?: TownEnvelopeMetrics
): number => {
  const centerX = getTownCenterX(town);
  const centerY = getTownCenterY(town);
  const axisPenalty =
    metrics &&
    isCompactTownArchetype(town) &&
    metrics.aspect >= COMPACT_TOWN_ASPECT_SOFT_LIMIT &&
    ((metrics.longAxis === "x" && Math.abs(frontier.dx) > Math.abs(frontier.dy)) ||
      (metrics.longAxis === "y" && Math.abs(frontier.dy) > Math.abs(frontier.dx)))
      ? COMPACT_TOWN_LONG_AXIS_PENALTY * (1 + Math.max(0, metrics.aspect - COMPACT_TOWN_ASPECT_SOFT_LIMIT))
      : 0;
  const hardLimitPenalty =
    axisPenalty > 0 && metrics && metrics.aspect >= COMPACT_TOWN_ASPECT_HARD_LIMIT ? 8 : 0;
  return (
    Math.hypot(frontier.x - centerX, frontier.y - centerY) +
    (frontier.branchType === "primary" ? 0.55 : 0) +
    (frontier.dx === 0 || frontier.dy === 0 ? 0 : 0.2) +
    axisPenalty +
    hardLimitPenalty
  );
};

const selectGrowthFrontier = (town: Town, metrics?: TownEnvelopeMetrics): TownGrowthFrontier | null => {
  const active = town.growthFrontiers.filter((frontier) => frontier.active);
  if (active.length === 0) {
    return null;
  }
  let best = active[0]!;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 0; i < active.length; i += 1) {
    const frontier = active[i]!;
    const score = getGrowthFrontierScore(town, frontier, metrics);
    if (score < bestScore) {
      bestScore = score;
      best = frontier;
    }
  }
  return best;
};

const tryExtendAnyGrowthFrontier = (
  state: WorldState,
  town: Town,
  roadAdapter: SettlementRoadAdapter,
  metrics?: TownEnvelopeMetrics
): boolean => {
  const active = town.growthFrontiers
    .filter((frontier) => frontier.active)
    .sort((left, right) => getGrowthFrontierScore(town, left, metrics) - getGrowthFrontierScore(town, right, metrics));
  for (let i = 0; i < active.length; i += 1) {
    if (extendTownFrontier(state, town, roadAdapter, active[i]!, metrics)) {
      return true;
    }
  }
  return false;
};

const extendTownFrontier = (
  state: WorldState,
  town: Town,
  roadAdapter: SettlementRoadAdapter,
  frontier: TownGrowthFrontier,
  metrics?: TownEnvelopeMetrics
): boolean => {
  if (
    metrics &&
    isCompactTownArchetype(town) &&
    getActiveFrontierAxisCount(town) >= 2 &&
    metrics.aspect >= COMPACT_TOWN_BRANCH_ASPECT_LIMIT &&
    ((metrics.longAxis === "x" && Math.abs(frontier.dx) > Math.abs(frontier.dy)) ||
      (metrics.longAxis === "y" && Math.abs(frontier.dy) > Math.abs(frontier.dx)))
  ) {
    frontier.active = false;
    return false;
  }
  const extensionLength = determineExtensionLength(town, metrics);
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

const addSecondaryStreet = (
  state: WorldState,
  town: Town,
  roadAdapter: SettlementRoadAdapter,
  metrics: TownEnvelopeMetrics = buildTownEnvelopeMetrics(state, town)
): boolean => {
  pruneInactiveGrowthFrontiers(town);
  if (isCompactTownRoadGrowthCapped(state, town)) {
    return false;
  }
  const maxFrontiers = MAX_FRONTIERS_BY_ARCHETYPE[town.streetArchetype];
  if (town.growthFrontiers.length >= maxFrontiers) {
    return false;
  }
  if (isCompactTownArchetype(town) && getActiveFrontierAxisCount(town) >= 2) {
    return false;
  }
  const centerX = getTownCenterX(town);
  const centerY = getTownCenterY(town);
  if (isCompactTownArchetype(town) && addInteriorBlockStreet(state, town, roadAdapter, metrics)) {
    return true;
  }
  const source =
    [...town.growthFrontiers]
      .sort((left, right) => {
        const leftScore = Math.hypot(left.x - centerX, left.y - centerY) + (left.branchType === "primary" ? 0 : 0.35);
        const rightScore = Math.hypot(right.x - centerX, right.y - centerY) + (right.branchType === "primary" ? 0 : 0.35);
        return leftScore - rightScore;
      })
      .find((frontier) => frontier.active) ?? selectGrowthFrontier(town, metrics) ?? town.growthFrontiers[0];
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

const shouldAddSecondaryStreetEarly = (
  state: WorldState,
  town: Town,
  bestFrontage: FrontageCandidate | null,
  metrics: TownEnvelopeMetrics
): boolean => {
  if (town.growthFrontiers.length >= MAX_FRONTIERS_BY_ARCHETYPE[town.streetArchetype]) {
    return false;
  }
  const activeSecondaryCount = town.growthFrontiers.filter(
    (frontier) => frontier.active && frontier.branchType === "secondary"
  ).length;
  const desiredSecondaryCount =
    town.streetArchetype === "crossroads" ? 2 : town.streetArchetype === "main_street" ? 1 : town.streetArchetype === "ribbon" ? 1 : 0;
  if (desiredSecondaryCount === 0 || activeSecondaryCount >= desiredSecondaryCount) {
    if (!isCompactTownArchetype(town)) {
      return false;
    }
  }
  if (isCompactTownArchetype(town)) {
    const branchHouseThreshold = Math.max(3, Math.floor(COMPACT_TOWN_MIN_CORE_HOUSES / 2));
    if (isCompactTownRoadGrowthCapped(state, town)) {
      return false;
    }
    if (getActiveFrontierAxisCount(town) < 2) {
      return town.houseCount >= 1;
    }
    if (metrics.aspect >= COMPACT_TOWN_ASPECT_SOFT_LIMIT) {
      return true;
    }
    if (!bestFrontage) {
      return true;
    }
    return town.houseCount >= branchHouseThreshold && bestFrontage.distCenter > TOWN_CORE_RADIUS + 1;
  }
  if (!bestFrontage) {
    return true;
  }
  return bestFrontage.distCenter > TOWN_CORE_RADIUS + 1 || town.houseCount < COMPACT_TOWN_MIN_CORE_HOUSES;
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

const getHouseAdjacentRoadDegree = (state: WorldState, x: number, y: number): number => {
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ];
  let best = 0;
  for (let i = 0; i < neighbors.length; i += 1) {
    const point = neighbors[i]!;
    if (!inBounds(state.grid, point.x, point.y) || !isStreetTile(state, point.x, point.y)) {
      continue;
    }
    best = Math.max(best, countRoadDegree(state, point.x, point.y));
  }
  return best;
};

const canCompactTownDensify = (
  state: WorldState,
  town: Town,
  metrics: TownEnvelopeMetrics,
  frontageCount: number
): boolean => {
  if (!isCompactTownArchetype(town) || town.houseCount < Math.max(4, COMPACT_TOWN_MIN_CORE_HOUSES - 2)) {
    return false;
  }
  if (isCompactTownRoadGrowthCapped(state, town)) {
    return true;
  }
  if (metrics.aspect >= COMPACT_TOWN_ASPECT_HARD_LIMIT) {
    return true;
  }
  return frontageCount <= 0 && getActiveFrontierAxisCount(town) >= 2 && metrics.aspect >= COMPACT_TOWN_ASPECT_SOFT_LIMIT;
};

export const tryDensifyTownHousing = (
  state: WorldState,
  town: Town,
  metrics: TownEnvelopeMetrics = buildTownEnvelopeMetrics(state, town),
  frontageCount = 0
): boolean => {
  if (!canCompactTownDensify(state, town, metrics, frontageCount)) {
    return false;
  }
  const centerX = getTownCenterX(town);
  const centerY = getTownCenterY(town);
  const houses = collectOwnedHouses(state, town.id);
  houses.sort((left, right) => {
    const leftTile = state.tiles[left]!;
    const rightTile = state.tiles[right]!;
    const leftX = left % state.grid.cols;
    const leftY = Math.floor(left / state.grid.cols);
    const rightX = right % state.grid.cols;
    const rightY = Math.floor(right / state.grid.cols);
    const leftRoadDegree = getHouseAdjacentRoadDegree(state, leftX, leftY);
    const rightRoadDegree = getHouseAdjacentRoadDegree(state, rightX, rightY);
    const leftAdjacency = countAdjacentOwnedHouses(state, town.id, leftX, leftY);
    const rightAdjacency = countAdjacentOwnedHouses(state, town.id, rightX, rightY);
    const leftClassPenalty = leftTile.buildingClass === "residential_low" ? 0 : leftTile.buildingClass === "residential_mid" ? 1.4 : 99;
    const rightClassPenalty =
      rightTile.buildingClass === "residential_low" ? 0 : rightTile.buildingClass === "residential_mid" ? 1.4 : 99;
    const leftScore =
      Math.hypot(leftX - centerX, leftY - centerY) * 0.75 +
      computeLongAxisPenalty(town, metrics, { x: leftX, y: leftY }) * 0.2 -
      leftRoadDegree * 1.35 -
      leftAdjacency * 0.45 +
      leftClassPenalty;
    const rightScore =
      Math.hypot(rightX - centerX, rightY - centerY) * 0.75 +
      computeLongAxisPenalty(town, metrics, { x: rightX, y: rightY }) * 0.2 -
      rightRoadDegree * 1.35 -
      rightAdjacency * 0.45 +
      rightClassPenalty;
    if (leftScore !== rightScore) {
      return leftScore - rightScore;
    }
    return left - right;
  });
  for (let i = 0; i < houses.length; i += 1) {
    const idx = houses[i]!;
    const tile = state.tiles[idx];
    const currentClass = tile?.buildingClass ?? "residential_low";
    const nextClass =
      currentClass === "residential_low"
        ? "residential_mid"
        : currentClass === "residential_mid"
          ? "residential_high"
          : null;
    if (!nextClass) {
      continue;
    }
    const residentDelta = currentClass === "residential_low" ? TOWN_DENSIFY_RESIDENT_DELTA : TOWN_DENSIFY_RESIDENT_DELTA + 1;
    const valueDelta = currentClass === "residential_low" ? TOWN_DENSIFY_VALUE_DELTA : TOWN_DENSIFY_VALUE_DELTA + 30;
    if (upgradeHouseDensity(state, idx, nextClass, residentDelta, valueDelta)) {
      return true;
    }
  }
  return false;
};

const pruneUnusedDeadEnds = (state: WorldState, town: Town, roadAdapter: SettlementRoadAdapter): void => {
  void state;
  void town;
  void roadAdapter;
};

export const updateTownEnvelope = (state: WorldState, town: Town): void => {
  let sumX = 0;
  let sumY = 0;
  let count = 0;
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
  }
  for (let i = 0; i < town.growthFrontiers.length; i += 1) {
    const frontier = town.growthFrontiers[i]!;
    if (!frontier.active) {
      continue;
    }
    sumX += frontier.x;
    sumY += frontier.y;
    count += 1;
  }
  if (count <= 0) {
    town.cx = town.x;
    town.cy = town.y;
    town.radius = MIN_TOWN_RADIUS;
    return;
  }
  town.cx = sumX / count;
  town.cy = sumY / count;
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileTownId[idx] !== town.id || state.tileStructure[idx] !== STRUCTURE_HOUSE) {
      continue;
    }
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    maxRadius = Math.max(maxRadius, Math.hypot(x - town.cx, y - town.cy) + 2.5);
  }
  for (let i = 0; i < town.growthFrontiers.length; i += 1) {
    const frontier = town.growthFrontiers[i]!;
    if (!frontier.active) {
      continue;
    }
    maxRadius = Math.max(maxRadius, Math.hypot(frontier.x - town.cx, frontier.y - town.cy) + 2);
  }
  if (isCompactTownArchetype(town)) {
    maxRadius = Math.min(maxRadius, COMPACT_TOWN_MAX_ROAD_RADIUS + 2);
  }
  town.radius = Math.max(MIN_TOWN_RADIUS, maxRadius);
  if (town.streetArchetype === "crossroads" && !hasTownIntersection(state, town)) {
    town.streetArchetype = "main_street";
  }
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
    ensureTownGrowthFrontiers(state, town, roadAdapter);
    const metrics = buildTownEnvelopeMetrics(state, town);
    const roadGrowthCapped = isCompactTownRoadGrowthCapped(state, town);
    const needsSecondAxis = isCompactTownArchetype(town) && getActiveFrontierAxisCount(town) < 2 && town.houseCount >= 1;
    const frontage = collectFrontageCandidates(state, town, context);
    const frontagePool =
      isCompactTownArchetype(town) && metrics.aspect >= COMPACT_TOWN_ASPECT_SOFT_LIMIT
        ? frontage.filter((candidate) => candidate.elongationPenalty <= 0.01)
        : frontage;
    const usableFrontage = frontagePool.length > 0 ? frontagePool : frontage;
    if (
      isCompactTownArchetype(town) &&
      (usableFrontage.length <= 0 || roadGrowthCapped) &&
      addInteriorBlockStreet(state, town, roadAdapter, metrics)
    ) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (!roadGrowthCapped && needsSecondAxis && addMissingCompactAxisStreet(state, town, roadAdapter)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (usableFrontage.length > 0) {
      if (placeFrontageHouse(state, town, usableFrontage[0]!, context, effectiveYear, constructionYear)) {
        placed += 1;
        continue;
      }
    }
    if (!roadGrowthCapped && needsSecondAxis && addMissingCompactAxisStreet(state, town, roadAdapter)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (tryDensifyTownHousing(state, town, metrics, usableFrontage.length)) {
      placed += 1;
      continue;
    }
    if (!roadGrowthCapped && shouldAddSecondaryStreetEarly(state, town, usableFrontage[0] ?? null, metrics) && addSecondaryStreet(state, town, roadAdapter, metrics)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (!roadGrowthCapped && tryExtendAnyGrowthFrontier(state, town, roadAdapter, metrics)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (!roadGrowthCapped && addSecondaryStreet(state, town, roadAdapter, metrics)) {
      roadAdapter.backfillRoadEdgesFromAdjacency(state);
      continue;
    }
    if (!town.growthFrontiers.some((frontier) => frontier.active)) {
      ensureTownGrowthFrontiers(state, town, roadAdapter);
      if (town.growthFrontiers.some((frontier) => frontier.active)) {
        continue;
      }
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
  const constructionYear =
    mode === "runtime"
      ? getFractionalSimulationYear(state.careerDay)
      : getCompletedConstructionYear(getFractionalSimulationYear(state.careerDay));
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

export const stepRuntimeTownGrowth = (
  state: WorldState,
  phase: WorldState["phase"] = state.phase,
  year = state.year
): void => {
  if (phase !== "growth" || state.townGrowthAppliedYear === year) {
    return;
  }
  state.townGrowthAppliedYear = year;
  const effectiveYear =
    state.towns.length > 0
      ? Math.max(
          year - 1,
          Math.max(...state.towns.map((town) => Math.max(0, Math.floor(town.simulatedGrowthYears ?? 0))))
        )
      : year - 1;
  assignDesiredGrowthDeltas(state, effectiveYear, "runtime");
  for (let i = 0; i < state.towns.length; i += 1) {
    const town = state.towns[i]!;
    const desiredDelta = Math.trunc(town.desiredHouseDelta ?? 0);
    town.lastSeasonHouseDelta = desiredDelta;
    if (desiredDelta > 0) {
      town.growthPressure = Math.max(0, (town.growthPressure ?? 0) + desiredDelta);
    } else if (desiredDelta < 0) {
      town.growthPressure = Math.max(0, (town.growthPressure ?? 0) + desiredDelta);
    }
    town.simulatedGrowthYears = Math.max(town.simulatedGrowthYears, effectiveYear + 1);
  }
};
