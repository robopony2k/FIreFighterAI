import type { WorldState } from "../core/state.js";
import type { Town } from "../core/types.js";
import {
  TOWN_ALERT_CHANGE_COOLDOWN_DAYS,
  TOWN_ALERT_FATIGUE_RATE_BY_POSTURE,
  TOWN_ALERT_MAX_POSTURE,
  TOWN_ALERT_RECOVERY_RATE,
  TOWN_EVAC_SPEED
} from "../core/config.js";
import { indexFor } from "../core/grid.js";
import { STRUCTURE_HOUSE } from "../core/towns.js";
import { clamp } from "../core/utils.js";

export type TownThreatLevel = "low" | "watch" | "high" | "critical";

const FIRE_EPS = 0.03;
const TOWN_THREAT_SCAN_RADIUS_MIN = 6;
const TOWN_THREAT_SCAN_RADIUS_SCALE = 2.1;

const clampPosture = (value: number): number => clamp(Math.trunc(value), 0, TOWN_ALERT_MAX_POSTURE);

const getTownApprovalBaseHouses = (town: Town): number => {
  const activeHouses = Math.max(0, Number.isFinite(town.houseCount) ? town.houseCount : 0);
  const lostHouses = Math.max(0, Number.isFinite(town.housesLost) ? Math.floor(town.housesLost) : 0);
  return Math.max(1, activeHouses + lostHouses);
};

// Town approval is derived from disapproving households, not from regional approval.
const syncTownApproval = (town: Town): void => {
  const houses = getTownApprovalBaseHouses(town);
  town.nonApprovingHouseCount = clamp(
    Number.isFinite(town.nonApprovingHouseCount) ? town.nonApprovingHouseCount : 0,
    0,
    houses
  );
  town.approval = clamp(1 - town.nonApprovingHouseCount / houses, 0, 1);
};

const normalizeTownState = (town: Town): void => {
  town.alertPosture = clampPosture(town.alertPosture ?? 0);
  town.alertCooldownDays = Math.max(0, Number.isFinite(town.alertCooldownDays) ? town.alertCooldownDays : 0);
  town.housesLost = Math.max(0, Number.isFinite(town.housesLost) ? Math.floor(town.housesLost) : 0);
  town.evacProgress = clamp(Number.isFinite(town.evacProgress) ? town.evacProgress : 0, 0, 1);
  if (town.evacState !== "in_progress" && town.evacState !== "complete") {
    town.evacState = "none";
  }
  if (
    town.evacuationStatus !== "PointSelected" &&
    town.evacuationStatus !== "EvacuationOrdered" &&
    town.evacuationStatus !== "Evacuating" &&
    town.evacuationStatus !== "Returning" &&
    town.evacuationStatus !== "Completed" &&
    town.evacuationStatus !== "Returned" &&
    town.evacuationStatus !== "Failed" &&
    town.evacuationStatus !== "Cancelled"
  ) {
    town.evacuationStatus = "None";
  }
  town.populationRemaining = Math.max(0, Math.floor(town.populationRemaining || 0));
  town.populationQueued = Math.max(0, Math.floor(town.populationQueued || 0));
  town.populationEvacuating = Math.max(0, Math.floor(town.populationEvacuating || 0));
  town.populationEvacuated = Math.max(0, Math.floor(town.populationEvacuated || 0));
  town.populationDead = Math.max(0, Math.floor(town.populationDead || 0));
  town.vehiclesQueued = Math.max(0, Math.floor(town.vehiclesQueued || 0));
  town.vehiclesMoving = Math.max(0, Math.floor(town.vehiclesMoving || 0));
  town.vehiclesDestroyed = Math.max(0, Math.floor(town.vehiclesDestroyed || 0));
  syncTownApproval(town);
};

const getTownById = (state: WorldState, townId: number): Town | null => {
  if (!Number.isInteger(townId) || townId < 0) {
    return null;
  }
  const direct = townId < state.towns.length ? state.towns[townId] : undefined;
  if (direct && direct.id === townId) {
    return direct;
  }
  for (const town of state.towns) {
    if (town.id === townId) {
      return town;
    }
  }
  return null;
};

const getTownCenterX = (town: Town): number => (Number.isFinite(town.cx) ? town.cx : town.x);
const getTownCenterY = (town: Town): number => (Number.isFinite(town.cy) ? town.cy : town.y);

export const getTownPostureLabel = (posture: number): string => {
  switch (clampPosture(posture)) {
    case 0:
      return "No Alert";
    case 1:
      return "Advice (Yellow)";
    case 2:
      return "Watch and Act (Orange)";
    case 3:
      return "Emergency Warning (Red)";
    default:
      return "No Alert";
  }
};

export const getTownThreatLabel = (level: TownThreatLevel): string => {
  if (level === "watch") {
    return "Watch";
  }
  if (level === "high") {
    return "High";
  }
  if (level === "critical") {
    return "Critical";
  }
  return "Low";
};

export const computeTownThreatScore = (state: WorldState, town: Town): number => {
  if (state.grid.cols <= 0 || state.grid.rows <= 0 || state.tileFire.length === 0) {
    return 0;
  }
  if (state.lastActiveFires <= 0 && !state.fireBoundsActive) {
    return 0;
  }
  const cx = getTownCenterX(town);
  const cy = getTownCenterY(town);
  const radius = Math.max(TOWN_THREAT_SCAN_RADIUS_MIN, Math.max(3, town.radius) * TOWN_THREAT_SCAN_RADIUS_SCALE);
  const radiusSq = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(cy + radius));
  let maxWeighted = 0;
  let weightedSum = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      const distSq = dx * dx + dy * dy;
      if (distSq > radiusSq) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const fire = state.tileFire[idx] ?? 0;
      if (fire <= FIRE_EPS) {
        continue;
      }
      const distNorm = Math.sqrt(distSq) / Math.max(0.001, radius);
      const proximity = Math.max(0, 1 - distNorm);
      const weighted = fire * (0.5 + 0.5 * proximity);
      if (weighted > maxWeighted) {
        maxWeighted = weighted;
      }
      weightedSum += fire * proximity;
    }
  }
  return clamp(Math.max(maxWeighted, weightedSum * 0.06), 0, 1.5);
};

export const getTownThreatLevel = (state: WorldState, town: Town): TownThreatLevel => {
  const score = computeTownThreatScore(state, town);
  if (score >= 0.6) {
    return "critical";
  }
  if (score >= 0.35) {
    return "high";
  }
  if (score >= 0.12) {
    return "watch";
  }
  return "low";
};

const isTownThreatLow = (state: WorldState, town: Town): boolean => {
  return getTownThreatLevel(state, town) === "low";
};

export const getTownBurningHouseCount = (state: WorldState, townId: number): number => {
  const town = getTownById(state, townId);
  if (!town) {
    return 0;
  }
  const cx = getTownCenterX(town);
  const cy = getTownCenterY(town);
  const radius = Math.max(4, Math.max(3, town.radius) * 1.8);
  const radiusSq = radius * radius;
  const minX = Math.max(0, Math.floor(cx - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(cx + radius));
  const minY = Math.max(0, Math.floor(cy - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(cy + radius));
  let count = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radiusSq) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      if (state.tileStructure[idx] !== STRUCTURE_HOUSE || state.tileTownId[idx] !== town.id) {
        continue;
      }
      if ((state.tileFire[idx] ?? 0) <= FIRE_EPS) {
        continue;
      }
      if (state.tiles[idx]?.type !== "house") {
        continue;
      }
      count += 1;
    }
  }
  return count;
};

const tickTownsOneDay = (state: WorldState): void => {
  for (const town of state.towns) {
    normalizeTownState(town);
    const posture = clampPosture(town.alertPosture);
    if (posture > 0) {
      const fatigueRate = TOWN_ALERT_FATIGUE_RATE_BY_POSTURE[posture] ?? 0;
      town.nonApprovingHouseCount += fatigueRate;
    } else if (isTownThreatLow(state, town)) {
      town.nonApprovingHouseCount -= TOWN_ALERT_RECOVERY_RATE;
    }

    const houses = getTownApprovalBaseHouses(town);
    town.nonApprovingHouseCount = clamp(town.nonApprovingHouseCount, 0, houses);
    town.approval = clamp(1 - town.nonApprovingHouseCount / houses, 0, 1);

    town.evacProgress = town.populationEvacuated + town.populationDead > 0
      ? clamp((town.populationEvacuated + town.populationDead) / Math.max(1, town.populationRemaining + town.populationEvacuated + town.populationDead), 0, 1)
      : 0;
  }
};

/*
 * Posture ladder + cooldown:
 * posture 0..3 (No Alert -> Advice -> Watch and Act -> Emergency Warning), with cooldown between changes.
 * Threat is computed from fire conditions and remains separate from this player-set posture.
 * Legacy warning posture no longer starts evacuation. Tactical evacuation commands own evacuation state.
 */
const changeTownAlertPosture = (state: WorldState, townId: number, delta: number): boolean => {
  const town = getTownById(state, townId);
  if (!town) {
    return false;
  }
  normalizeTownState(town);
  if (town.alertCooldownDays > 0) {
    return false;
  }
  const nextPosture = clampPosture(town.alertPosture + delta);
  if (nextPosture === town.alertPosture) {
    return false;
  }
  town.alertPosture = nextPosture;
  town.alertCooldownDays = TOWN_ALERT_CHANGE_COOLDOWN_DAYS;
  town.lastPostureChangeDay = state.careerDay;
  return true;
};

export const raiseTownAlertPosture = (state: WorldState, townId: number): boolean => {
  return changeTownAlertPosture(state, townId, 1);
};

export const lowerTownAlertPosture = (state: WorldState, townId: number): boolean => {
  return changeTownAlertPosture(state, townId, -1);
};

export const startTownEvacuation = (state: WorldState, townId: number): boolean => {
  const town = getTownById(state, townId);
  if (!town) {
    return false;
  }
  normalizeTownState(town);
  if (town.evacuationStatus !== "PointSelected" || town.evacState !== "none") {
    return false;
  }
  town.evacState = "none";
  town.evacProgress = 0;
  return true;
};

export const recordTownHouseLoss = (state: WorldState, townId: number): void => {
  const town = getTownById(state, townId);
  if (!town) {
    return;
  }
  normalizeTownState(town);
  town.housesLost += 1;
};

export const stepTownAlertPosture = (state: WorldState, dayDelta: number): void => {
  if (dayDelta <= 0 || state.towns.length === 0) {
    return;
  }
  for (const town of state.towns) {
    normalizeTownState(town);
    town.alertCooldownDays = Math.max(0, town.alertCooldownDays - dayDelta);
  }
  state.townAlertDayAccumulator = Math.max(0, state.townAlertDayAccumulator + dayDelta);
  while (state.townAlertDayAccumulator >= 1) {
    tickTownsOneDay(state);
    state.townAlertDayAccumulator -= 1;
  }
};
