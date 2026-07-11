import type {
  FireDetectionConfidenceLabel,
  FireDetectionReport,
  FireDetectionReportState,
  FireDetectionSource,
  FireKnowledgeState,
  WatchTower,
  WatchTowerLevel
} from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { TILE_TYPE_IDS } from "../../../core/state.js";
import {
  FIRE_DETECTION_CONFIG,
  WATCH_TOWER_MAX_LEVEL,
  WATCH_TOWER_PLACEMENT_CONFIG,
  WATCH_TOWER_TYPE_ID,
  getWatchTowerLevelTuning
} from "../constants/fireDetectionConfig.js";
import { getWatchTowerFootprintSampleOffsets } from "../types/watchTowerFootprint.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export type FireDetectionStepResult = {
  alertReport: FireDetectionReport | null;
  activeReportCount: number;
};

const createFireKnowledgeState = (totalTiles: number): FireKnowledgeState => ({
  tileState: new Uint8Array(totalTiles),
  tileConfidence: new Float32Array(totalTiles),
  tileDetectionProgress: new Float32Array(totalTiles),
  tileFirstKnownDay: new Float32Array(totalTiles).fill(-1),
  tileLastSeenDay: new Float32Array(totalTiles).fill(-1),
  reports: [],
  latestReportId: null
});

export const ensureFireKnowledgeState = (state: WorldState): FireKnowledgeState => {
  const total = state.grid.totalTiles;
  if (
    !state.fireKnowledge ||
    state.fireKnowledge.tileState.length !== total ||
    state.fireKnowledge.tileConfidence.length !== total ||
    state.fireKnowledge.tileDetectionProgress.length !== total ||
    state.fireKnowledge.tileFirstKnownDay.length !== total ||
    state.fireKnowledge.tileLastSeenDay.length !== total
  ) {
    state.fireKnowledge = createFireKnowledgeState(total);
  }
  return state.fireKnowledge;
};

export const getFireDetectionConfidenceLabel = (confidence: number): FireDetectionConfidenceLabel => {
  if (confidence >= FIRE_DETECTION_CONFIG.confirmedConfidence) {
    return "High";
  }
  if (confidence >= FIRE_DETECTION_CONFIG.alertConfidence) {
    return "Medium";
  }
  return "Low";
};

export const isFireTileKnownToPlayer = (state: WorldState, tileIndex: number): boolean =>
  (ensureFireKnowledgeState(state).tileState[tileIndex] ?? 0) > 0;

export const isFireTileConfirmedToPlayer = (state: WorldState, tileIndex: number): boolean =>
  (ensureFireKnowledgeState(state).tileState[tileIndex] ?? 0) >= 2;

export const getWatchTowerForTown = (state: WorldState, townId: number): WatchTower | null =>
  (state.watchTowers ?? []).find((tower) => tower.townId === townId && tower.typeId === WATCH_TOWER_TYPE_ID) ?? null;

const applyTowerTuning = (tower: WatchTower): void => {
  const tuning = getWatchTowerLevelTuning(tower.level);
  tower.detectionRadius = tuning.detectionRadius * tower.siteElevationMultiplier;
  tower.detectionDelayDays = tuning.detectionDelayDays;
  tower.accuracyRadius = tuning.accuracyRadius;
};

const isBuildableWatchTowerTile = (state: WorldState, x: number, y: number): boolean => {
  if (x < 0 || y < 0 || x >= state.grid.cols || y >= state.grid.rows) {
    return false;
  }
  const idx = y * state.grid.cols + x;
  const typeId = state.tileTypeId[idx] ?? -1;
  return (
    typeId !== TILE_TYPE_IDS.water &&
    typeId !== TILE_TYPE_IDS.road &&
    typeId !== TILE_TYPE_IDS.house &&
    typeId !== TILE_TYPE_IDS.base &&
    (state.tileOceanMask[idx] ?? 0) <= 0 &&
    (state.tileLakeMask[idx] ?? 0) <= 0 &&
    (state.structureMask[idx] ?? 0) <= 0
  );
};

export type WatchTowerPlacementQuote = {
  valid: boolean;
  reason: string;
  invalidReasonCode: "town-not-found" | "maintenance-only" | "tower-exists" | "blocked" | "out-of-range" | "cliff" | null;
  x: number;
  y: number;
  roadAccessDistance: number;
  accessMultiplier: number;
  accessSurcharge: number;
  elevationMultiplier: number;
  maxFootprintElevationDelta: number;
  maxFootprintGrade: number;
  effectiveRadius: number;
  totalCost: number;
  constructionDays: number;
};

export const getWatchTowerUpgradeQuote = (tower: WatchTower): { cost: number; constructionDays: number } | null => {
  if (tower.level >= WATCH_TOWER_MAX_LEVEL) return null;
  const nextLevel = (tower.level + 1) as WatchTowerLevel;
  const difficultTiles = Math.max(0, tower.roadAccessDistance - WATCH_TOWER_PLACEMENT_CONFIG.roadGraceTiles);
  const accessMultiplier = Math.min(WATCH_TOWER_PLACEMENT_CONFIG.maxAccessCostMultiplier, 1 + difficultTiles * WATCH_TOWER_PLACEMENT_CONFIG.accessCostPerTile);
  return {
    cost: Math.round(getWatchTowerLevelTuning(nextLevel).upgradeCost * accessMultiplier),
    constructionDays: WATCH_TOWER_PLACEMENT_CONFIG.constructionDaysPerLevel
  };
};

const getElevation = (state: WorldState, x: number, y: number): number =>
  state.tileElevation[y * state.grid.cols + x] ?? state.tiles[y * state.grid.cols + x]?.elevation ?? 0;

const sampleElevation = (state: WorldState, x: number, y: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(state.grid.cols - 1, x0 + 1);
  const y1 = Math.min(state.grid.rows - 1, y0 + 1);
  const tx = x - x0;
  const ty = y - y0;
  const top = getElevation(state, x0, y0) * (1 - tx) + getElevation(state, x1, y0) * tx;
  const bottom = getElevation(state, x0, y1) * (1 - tx) + getElevation(state, x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
};

const getNearestRoadDistance = (state: WorldState, x: number, y: number): number => {
  let best = Math.hypot(state.grid.cols, state.grid.rows);
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if ((state.tileTypeId[idx] ?? -1) !== TILE_TYPE_IDS.road) continue;
    best = Math.min(best, Math.hypot((idx % state.grid.cols) - x, Math.floor(idx / state.grid.cols) - y));
  }
  return best;
};

export const quoteWatchTowerPlacement = (state: WorldState, townId: number, x: number, y: number): WatchTowerPlacementQuote => {
  const town = state.towns.find((entry) => entry.id === townId) ?? null;
  const ix = Math.round(x);
  const iy = Math.round(y);
  const base = getWatchTowerLevelTuning(1);
  let reason = "";
  let invalidReasonCode: WatchTowerPlacementQuote["invalidReasonCode"] = null;
  if (!town) { reason = "Town not found."; invalidReasonCode = "town-not-found"; }
  else if (state.phase !== "maintenance") { reason = "Watch towers can only be placed during maintenance."; invalidReasonCode = "maintenance-only"; }
  else if (getWatchTowerForTown(state, townId)) { reason = "This town already has a watch tower."; invalidReasonCode = "tower-exists"; }
  const townX = town ? (Number.isFinite(town.cx) ? town.cx : town.x) : ix;
  const townY = town ? (Number.isFinite(town.cy) ? town.cy : town.y) : iy;
  const centerX = ix + 0.5;
  const centerY = iy + 0.5;
  const footprintOffsets = getWatchTowerFootprintSampleOffsets();
  const footprintPoints = footprintOffsets.map((offset) => ({ x: centerX + offset.x, y: centerY + offset.y }));
  if (!reason && footprintPoints.some((point) => point.x < 0 || point.y < 0 || point.x >= state.grid.cols || point.y >= state.grid.rows || !isBuildableWatchTowerTile(state, Math.min(state.grid.cols - 1, Math.floor(point.x)), Math.min(state.grid.rows - 1, Math.floor(point.y))))) {
    reason = "Choose clear land away from roads, water, structures, and map edges.";
    invalidReasonCode = "blocked";
  }
  if (!reason && Math.hypot(ix - townX, iy - townY) > WATCH_TOWER_PLACEMENT_CONFIG.townServiceRadius) { reason = "Site is outside this town's service range."; invalidReasonCode = "out-of-range"; }
  const footprintElevations = footprintPoints.every((point) => point.x >= 0 && point.y >= 0 && point.x < state.grid.cols && point.y < state.grid.rows)
    ? footprintPoints.map((point) => sampleElevation(state, point.x, point.y))
    : [0];
  const maxFootprintElevationDelta = Math.max(...footprintElevations) - Math.min(...footprintElevations);
  let maxFootprintGrade = 0;
  for (let i = 1; i < footprintPoints.length; i += 1) {
    const distance = Math.max(0.001, Math.hypot(footprintPoints[i].x - footprintPoints[0].x, footprintPoints[i].y - footprintPoints[0].y));
    maxFootprintGrade = Math.max(maxFootprintGrade, Math.abs(footprintElevations[i] - footprintElevations[0]) / distance);
  }
  if (!reason && (maxFootprintElevationDelta > WATCH_TOWER_PLACEMENT_CONFIG.maxFootprintElevationDelta || maxFootprintGrade > WATCH_TOWER_PLACEMENT_CONFIG.maxFootprintGrade)) {
    reason = "Cliff or terrain too steep for watch tower footings.";
    invalidReasonCode = "cliff";
  }
  const roadAccessDistance = getNearestRoadDistance(state, ix, iy);
  const difficultTiles = Math.max(0, roadAccessDistance - WATCH_TOWER_PLACEMENT_CONFIG.roadGraceTiles);
  const accessMultiplier = Math.min(WATCH_TOWER_PLACEMENT_CONFIG.maxAccessCostMultiplier, 1 + difficultTiles * WATCH_TOWER_PLACEMENT_CONFIG.accessCostPerTile);
  const townElevation = town ? getElevation(state, clamp(Math.round(townX), 0, state.grid.cols - 1), clamp(Math.round(townY), 0, state.grid.rows - 1)) : 0;
  const elevationMeters = Math.max(0, (getElevation(state, clamp(ix, 0, state.grid.cols - 1), clamp(iy, 0, state.grid.rows - 1)) - townElevation) * 100);
  const elevationMultiplier = 1 + Math.min(WATCH_TOWER_PLACEMENT_CONFIG.maxElevationBonus, (elevationMeters / 10) * WATCH_TOWER_PLACEMENT_CONFIG.elevationBonusPer10Meters);
  const totalCost = Math.round(base.buildCost * accessMultiplier);
  return {
    valid: reason === "", reason, invalidReasonCode, x: ix, y: iy, roadAccessDistance, accessMultiplier,
    accessSurcharge: totalCost - base.buildCost, elevationMultiplier, maxFootprintElevationDelta, maxFootprintGrade,
    effectiveRadius: base.detectionRadius * elevationMultiplier,
    totalCost,
    constructionDays: WATCH_TOWER_PLACEMENT_CONFIG.constructionDaysPerLevel
  };
};

const resolveWatchTowerBuildSite = (
  state: WorldState,
  town: WorldState["towns"][number],
  detectionRadius: number
): { x: number; y: number } => {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const cx = Number.isFinite(town.cx) ? town.cx : town.x;
  const cy = Number.isFinite(town.cy) ? town.cy : town.y;
  const townRadius = Math.max(0, town.radius ?? 0);
  const placementDistance = Math.min(Math.max(townRadius + 3, 5), Math.max(1, detectionRadius - 2));
  const directions = [
    { x: 0, y: -1 },
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: -1 },
    { x: 1, y: 1 },
    { x: -1, y: 1 }
  ];
  const start = Math.abs(town.id) % directions.length;
  let bestFallback = {
    x: clamp(Math.round(cx), 0, Math.max(0, cols - 1)),
    y: clamp(Math.round(cy), 0, Math.max(0, rows - 1)),
    distSq: Number.POSITIVE_INFINITY
  };

  for (let i = 0; i < directions.length; i += 1) {
    const direction = directions[(start + i) % directions.length];
    const length = Math.hypot(direction.x, direction.y) || 1;
    const x = clamp(Math.round(cx + (direction.x / length) * placementDistance), 0, Math.max(0, cols - 1));
    const y = clamp(Math.round(cy + (direction.y / length) * placementDistance), 0, Math.max(0, rows - 1));
    const distSq = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (distSq < bestFallback.distSq) {
      bestFallback = { x, y, distSq };
    }
    if (isBuildableWatchTowerTile(state, x, y)) {
      return { x, y };
    }
  }

  return { x: bestFallback.x, y: bestFallback.y };
};

export const buildWatchTowerForTown = (
  state: WorldState,
  townId: number,
  requestedSite?: { x: number; y: number }
): { ok: boolean; message: string; tower: WatchTower | null } => {
  const town = state.towns.find((entry) => entry.id === townId) ?? null;
  if (!town) {
    return { ok: false, message: "Town not found.", tower: null };
  }
  if (state.phase !== "maintenance") {
    return { ok: false, message: "Watch towers can only be built during maintenance.", tower: null };
  }
  const existing = getWatchTowerForTown(state, townId);
  if (existing) {
    return { ok: false, message: `${town.name} already has a watch tower.`, tower: existing };
  }
  const tuning = getWatchTowerLevelTuning(1);
  const site = requestedSite ?? resolveWatchTowerBuildSite(state, town, tuning.detectionRadius);
  const quote = quoteWatchTowerPlacement(state, townId, site.x, site.y);
  if (!quote.valid) return { ok: false, message: quote.reason, tower: null };
  if (state.budget < quote.totalCost) return { ok: false, message: `Need $${quote.totalCost} to build this watch tower.`, tower: null };
  const tower: WatchTower = {
    id: state.nextWatchTowerId++,
    typeId: WATCH_TOWER_TYPE_ID,
    townId,
    x: site.x,
    y: site.y,
    level: 1,
    detectionRadius: quote.effectiveRadius,
    detectionDelayDays: tuning.detectionDelayDays,
    accuracyRadius: tuning.accuracyRadius,
    active: false,
    builtCareerDay: state.careerDay,
    siteElevationMultiplier: quote.elevationMultiplier,
    roadAccessDistance: quote.roadAccessDistance,
    constructionKind: "build",
    constructionTargetLevel: 1,
    constructionDaysRemaining: quote.constructionDays
  };
  state.budget -= quote.totalCost;
  state.watchTowers.push(tower);
  for (let oy = -1; oy <= 1; oy += 1) for (let ox = -1; ox <= 1; ox += 1) {
    const sx = site.x + ox;
    const sy = site.y + oy;
    if (sx >= 0 && sy >= 0 && sx < state.grid.cols && sy < state.grid.rows) state.structureMask[sy * state.grid.cols + sx] = 1;
  }
  state.structureRevision += 1;
  return { ok: true, message: `Watch tower construction started near ${town.name} (${quote.constructionDays.toFixed(2)}d).`, tower };
};

export const upgradeWatchTowerForTown = (
  state: WorldState,
  townId: number
): { ok: boolean; message: string; tower: WatchTower | null } => {
  const town = state.towns.find((entry) => entry.id === townId) ?? null;
  const tower = getWatchTowerForTown(state, townId);
  if (!town || !tower) {
    return { ok: false, message: "Build a watch tower first.", tower: null };
  }
  if (tower.level >= WATCH_TOWER_MAX_LEVEL) {
    return { ok: false, message: `${town.name} watch tower is already fully upgraded.`, tower };
  }
  if (tower.constructionKind) return { ok: false, message: "Finish the current tower work first.", tower };
  const nextLevel = (tower.level + 1) as WatchTowerLevel;
  const quote = getWatchTowerUpgradeQuote(tower)!;
  const cost = quote.cost;
  if (state.budget < cost) {
    return { ok: false, message: `Need $${cost} to upgrade this watch tower.`, tower };
  }
  state.budget -= cost;
  tower.active = false;
  tower.constructionKind = "upgrade";
  tower.constructionTargetLevel = nextLevel;
  tower.constructionDaysRemaining = quote.constructionDays;
  state.structureRevision += 1;
  return { ok: true, message: `${town.name} watch tower upgrade to level ${nextLevel} started.`, tower };
};

const getNearestTownIdForTile = (state: WorldState, x: number, y: number): number => {
  let bestId = -1;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const town of state.towns) {
    const cx = Number.isFinite(town.cx) ? town.cx : town.x;
    const cy = Number.isFinite(town.cy) ? town.cy : town.y;
    const distSq = (x - cx) * (x - cx) + (y - cy) * (y - cy);
    if (distSq < bestDistSq || (distSq === bestDistSq && (bestId < 0 || town.id < bestId))) {
      bestId = town.id;
      bestDistSq = distSq;
    }
  }
  return bestId;
};

const getDirectionFromTown = (state: WorldState, townId: number, x: number, y: number): string => {
  const town = state.towns.find((entry) => entry.id === townId) ?? null;
  if (!town) {
    return "in the region";
  }
  const dx = x - (Number.isFinite(town.cx) ? town.cx : town.x);
  const dy = y - (Number.isFinite(town.cy) ? town.cy : town.y);
  const vertical = dy < -2 ? "north" : dy > 2 ? "south" : "";
  const horizontal = dx < -2 ? "west" : dx > 2 ? "east" : "";
  return vertical && horizontal ? `${vertical}-${horizontal}` : vertical || horizontal || "nearby";
};

const formatReportMessage = (state: WorldState, report: FireDetectionReport): string => {
  const town = state.towns.find((entry) => entry.id === report.townId) ?? null;
  const confidence = getFireDetectionConfidenceLabel(report.confidence);
  if (town) {
    return `Smoke reported ${getDirectionFromTown(state, town.id, report.tileX, report.tileY)} of ${town.name}. Confidence: ${confidence}.`;
  }
  return `Smoke reported at tile ${report.tileX},${report.tileY}. Confidence: ${confidence}.`;
};

const deterministicOffset = (seed: number, id: number, radius: number): { x: number; y: number } => {
  const angleSeed = Math.sin((seed + id * 101) * 12.9898) * 43758.5453;
  const radiusSeed = Math.sin((seed + id * 173) * 78.233) * 24634.6345;
  const angle = (angleSeed - Math.floor(angleSeed)) * Math.PI * 2;
  const distance = Math.max(0, radius) * Math.sqrt(radiusSeed - Math.floor(radiusSeed));
  return { x: Math.round(Math.cos(angle) * distance), y: Math.round(Math.sin(angle) * distance) };
};

const updateTileKnowledge = (
  knowledge: FireKnowledgeState,
  tileIndex: number,
  confidence: number,
  careerDay: number
): void => {
  const nextConfidence = clamp(Math.max(knowledge.tileConfidence[tileIndex] ?? 0, confidence), 0, 1);
  knowledge.tileConfidence[tileIndex] = nextConfidence;
  knowledge.tileState[tileIndex] =
    nextConfidence >= FIRE_DETECTION_CONFIG.confirmedConfidence ? 2 : nextConfidence > 0 ? 1 : 0;
  if ((knowledge.tileFirstKnownDay[tileIndex] ?? -1) < 0) {
    knowledge.tileFirstKnownDay[tileIndex] = careerDay;
  }
  knowledge.tileLastSeenDay[tileIndex] = careerDay;
};

const hasRoadAssetNear = (state: WorldState, x: number, y: number): boolean => {
  const radius = FIRE_DETECTION_CONFIG.roadAssetRevealRadius;
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  for (let oy = -radius; oy <= radius; oy += 1) {
    const sy = y + oy;
    if (sy < 0 || sy >= rows) {
      continue;
    }
    for (let ox = -radius; ox <= radius; ox += 1) {
      const sx = x + ox;
      if (sx < 0 || sx >= cols || ox * ox + oy * oy > radius * radius) {
        continue;
      }
      const idx = sy * cols + sx;
      const typeId = state.tileTypeId[idx] ?? -1;
      if (
        typeId === TILE_TYPE_IDS.road ||
        typeId === TILE_TYPE_IDS.house ||
        typeId === TILE_TYPE_IDS.base ||
        (state.structureMask[idx] ?? 0) > 0
      ) {
        return true;
      }
    }
  }
  return false;
};

const getFallbackReveal = (
  state: WorldState,
  x: number,
  y: number,
  smokeRevealActive: boolean
): { source: FireDetectionSource; confidence: number } | null => {
  for (const town of state.towns) {
    const cx = Number.isFinite(town.cx) ? town.cx : town.x;
    const cy = Number.isFinite(town.cy) ? town.cy : town.y;
    const radius = Math.max(0, town.radius + FIRE_DETECTION_CONFIG.townRevealBuffer);
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) <= radius * radius) {
      return { source: "town", confidence: FIRE_DETECTION_CONFIG.fallbackConfidence.town };
    }
  }
  for (const unit of state.units) {
    if (unit.kind === "firefighter" && unit.carrierId !== null) {
      continue;
    }
    const radius = FIRE_DETECTION_CONFIG.unitRevealRadius;
    if ((x - unit.x) * (x - unit.x) + (y - unit.y) * (y - unit.y) <= radius * radius) {
      return { source: "unit", confidence: FIRE_DETECTION_CONFIG.fallbackConfidence.unit };
    }
  }
  if (hasRoadAssetNear(state, x, y)) {
    return { source: "roadAsset", confidence: FIRE_DETECTION_CONFIG.fallbackConfidence.roadAsset };
  }
  if (smokeRevealActive) {
    return { source: "smoke", confidence: FIRE_DETECTION_CONFIG.fallbackConfidence.smoke };
  }
  return null;
};

const findReportForTile = (
  knowledge: FireKnowledgeState,
  x: number,
  y: number,
  careerDay: number
): FireDetectionReport | null => {
  let best: FireDetectionReport | null = null;
  let bestDistSq = Number.POSITIVE_INFINITY;
  const radius = FIRE_DETECTION_CONFIG.reportMergeRadius;
  const radiusSq = radius * radius;
  for (const report of knowledge.reports) {
    if (careerDay - report.lastUpdatedDay > FIRE_DETECTION_CONFIG.staleReportDays) {
      continue;
    }
    const distSq = (x - report.actualTileX) * (x - report.actualTileX) + (y - report.actualTileY) * (y - report.actualTileY);
    if (distSq <= radiusSq && distSq < bestDistSq) {
      best = report;
      bestDistSq = distSq;
    }
  }
  return best;
};

const updateReport = (
  state: WorldState,
  knowledge: FireKnowledgeState,
  input: {
    tileIndex: number;
    x: number;
    y: number;
    confidence: number;
    source: FireDetectionSource;
    towerIds: number[];
    accuracyRadius: number;
    tileCount: number;
  }
): FireDetectionReport => {
  let report = findReportForTile(knowledge, input.x, input.y, state.careerDay);
  if (!report) {
    const id = state.nextFireDetectionReportId++;
    const offset = deterministicOffset(state.seed, id, input.accuracyRadius);
    report = {
      id,
      tileX: clamp(input.x + offset.x, 0, state.grid.cols - 1),
      tileY: clamp(input.y + offset.y, 0, state.grid.rows - 1),
      actualTileX: input.x,
      actualTileY: input.y,
      townId: getNearestTownIdForTile(state, input.x, input.y),
      confidence: 0,
      confidenceLabel: "Low",
      state: "suspected",
      source: input.source,
      firstReportedDay: state.careerDay,
      lastUpdatedDay: state.careerDay,
      active: true,
      alerted: false,
      towerIds: [],
      tileCount: 0,
      message: ""
    };
    knowledge.reports.push(report);
  }

  report.active = true;
  report.lastUpdatedDay = state.careerDay;
  report.actualTileX = input.x;
  report.actualTileY = input.y;
  report.townId = getNearestTownIdForTile(state, input.x, input.y);
  report.confidence = clamp(Math.max(report.confidence, input.confidence), 0, 1);
  report.confidenceLabel = getFireDetectionConfidenceLabel(report.confidence);
  report.state = report.confidence >= FIRE_DETECTION_CONFIG.confirmedConfidence ? "confirmed" : "suspected";
  report.source = report.confidence >= input.confidence ? report.source : input.source;
  report.towerIds = Array.from(new Set([...report.towerIds, ...input.towerIds])).sort((a, b) => a - b);
  report.tileCount = Math.max(report.tileCount, input.tileCount);
  const blend = report.confidence;
  report.tileX = Math.round(report.tileX * (1 - blend) + input.x * blend);
  report.tileY = Math.round(report.tileY * (1 - blend) + input.y * blend);
  report.message = formatReportMessage(state, report);
  knowledge.latestReportId = report.id;
  updateTileKnowledge(knowledge, input.tileIndex, report.confidence, state.careerDay);
  return report;
};

export const stepWatchTowerConstruction = (state: WorldState, dayDelta: number): void => {
  if (dayDelta > 0) {
    for (const tower of state.watchTowers ?? []) {
      if (!tower.constructionKind) continue;
      tower.constructionDaysRemaining = Math.max(0, tower.constructionDaysRemaining - dayDelta);
      if (tower.constructionDaysRemaining > 0) continue;
      if (tower.constructionTargetLevel) tower.level = tower.constructionTargetLevel;
      tower.constructionKind = null;
      tower.constructionTargetLevel = null;
      tower.active = true;
      applyTowerTuning(tower);
      state.structureRevision += 1;
    }
  }
};

export const stepFireDetection = (state: WorldState, dayDelta: number): FireDetectionStepResult => {
  const knowledge = ensureFireKnowledgeState(state);
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const heatCap = Math.max(0.01, state.fireSettings.heatCap);
  let activeTileCount = 0;
  let smokeScore = 0;
  for (const report of knowledge.reports) {
    report.active = false;
  }
  if (cols <= 0 || rows <= 0 || state.lastActiveFires <= 0) {
    return { alertReport: null, activeReportCount: 0 };
  }

  const minX = state.fireBoundsActive ? clamp(state.fireMinX, 0, cols - 1) : 0;
  const maxX = state.fireBoundsActive ? clamp(state.fireMaxX, 0, cols - 1) : cols - 1;
  const minY = state.fireBoundsActive ? clamp(state.fireMinY, 0, rows - 1) : 0;
  const maxY = state.fireBoundsActive ? clamp(state.fireMaxY, 0, rows - 1) : rows - 1;
  for (let y = minY; y <= maxY; y += 1) {
    let idx = y * cols + minX;
    for (let x = minX; x <= maxX; x += 1, idx += 1) {
      const fire = state.tileFire[idx] ?? 0;
      const heat01 = (state.tileHeat[idx] ?? 0) / heatCap;
      const intensity = clamp(Math.max(fire, heat01 * 0.6), 0, 1);
      if (fire <= FIRE_DETECTION_CONFIG.minActiveFire && heat01 <= FIRE_DETECTION_CONFIG.minHeat01) {
        continue;
      }
      activeTileCount += 1;
      smokeScore += intensity;
    }
  }
  const smokeRevealActive =
    activeTileCount >= FIRE_DETECTION_CONFIG.smokeRevealTileCount ||
    smokeScore >= FIRE_DETECTION_CONFIG.smokeRevealScore;
  let alertReport: FireDetectionReport | null = null;

  for (let y = minY; y <= maxY; y += 1) {
    let idx = y * cols + minX;
    for (let x = minX; x <= maxX; x += 1, idx += 1) {
      const fire = state.tileFire[idx] ?? 0;
      const heat01 = (state.tileHeat[idx] ?? 0) / heatCap;
      const intensity = clamp(Math.max(fire, heat01 * 0.6), 0, 1);
      if (fire <= FIRE_DETECTION_CONFIG.minActiveFire && heat01 <= FIRE_DETECTION_CONFIG.minHeat01) {
        continue;
      }

      let towerConfidence = 0;
      let towerAccuracy = Number.POSITIVE_INFINITY;
      const towerIds: number[] = [];
      for (const tower of state.watchTowers ?? []) {
        if (!tower.active) {
          continue;
        }
        const dx = x - tower.x;
        const dy = y - tower.y;
        if (dx * dx + dy * dy > tower.detectionRadius * tower.detectionRadius) {
          continue;
        }
        const tuning = getWatchTowerLevelTuning(tower.level);
        towerIds.push(tower.id);
        towerAccuracy = Math.min(towerAccuracy, tower.accuracyRadius);
        knowledge.tileDetectionProgress[idx] =
          (knowledge.tileDetectionProgress[idx] ?? 0) +
          Math.max(0, dayDelta) * intensity * tuning.smokeSensitivity;
        if ((knowledge.tileDetectionProgress[idx] ?? 0) >= tower.detectionDelayDays) {
          towerConfidence = Math.max(
            towerConfidence,
            FIRE_DETECTION_CONFIG.towerBaseConfidence +
              Math.min(0.28, (knowledge.tileDetectionProgress[idx] ?? 0) * FIRE_DETECTION_CONFIG.towerPersistenceConfidencePerDay) +
              Math.max(0, towerIds.length - 1) * FIRE_DETECTION_CONFIG.towerOverlapConfidence +
              Math.min(0.18, activeTileCount * FIRE_DETECTION_CONFIG.growthConfidenceScale)
          );
        }
      }

      const fallback = getFallbackReveal(state, x, y, smokeRevealActive);
      const confidence = Math.max(towerConfidence, fallback?.confidence ?? 0);
      if (confidence <= 0) {
        continue;
      }
      const source: FireDetectionSource = towerConfidence >= (fallback?.confidence ?? 0) ? "watchTower" : fallback!.source;
      const report = updateReport(state, knowledge, {
        tileIndex: idx,
        x,
        y,
        confidence,
        source,
        towerIds,
        accuracyRadius: Number.isFinite(towerAccuracy) ? towerAccuracy : FIRE_DETECTION_CONFIG.reportMergeRadius,
        tileCount: activeTileCount
      });
      if (!report.alerted && report.confidence >= FIRE_DETECTION_CONFIG.alertConfidence) {
        report.alerted = true;
        alertReport = report;
      }
    }
  }

  const activeReportCount = knowledge.reports.filter((report) => report.active).length;
  if (activeReportCount <= 0) {
    knowledge.latestReportId = null;
  }
  return { alertReport, activeReportCount };
};

export const getLatestFireDetectionReport = (state: WorldState): FireDetectionReport | null => {
  const knowledge = ensureFireKnowledgeState(state);
  const id = knowledge.latestReportId;
  return id === null ? null : knowledge.reports.find((report) => report.id === id) ?? null;
};

export const getReportStateLabel = (state: FireDetectionReportState): string =>
  state === "confirmed" ? "Confirmed" : "Suspected";
