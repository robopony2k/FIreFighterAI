import type { Tile } from "../../../core/types.js";
import { PHASES } from "../../../core/time.js";
import {
  BUILDING_CLEARED_LOT_DURATION_DAYS,
  BUILDING_EMPTY_LOT_DURATION_DAYS,
  BUILDING_ENCLOSED_DURATION_DAYS,
  BUILDING_FRAME_DURATION_DAYS,
  BUILDING_SITE_PREP_DURATION_DAYS
} from "../constants/settlementConstants.js";
import type {
  BuildingLifecycleStage,
  BuildingLifecycleState,
  BuildingLot,
  BuildingLotKind,
  BuildingLotStage
} from "../types/buildingTypes.js";

export const BUILDING_LIFECYCLE_STAGES: readonly BuildingLifecycleStage[] = [
  "empty_lot",
  "site_prep",
  "frame",
  "enclosed",
  "roofed",
  "charred_remains",
  "cleared_lot"
] as const;

export const BUILDING_LIFECYCLE_STAGE_IDS: Record<BuildingLifecycleStage, number> = {
  empty_lot: 0,
  site_prep: 1,
  frame: 2,
  enclosed: 3,
  roofed: 4,
  charred_remains: 5,
  cleared_lot: 6
};

export const BUILDING_LIFECYCLE_STAGE_BY_ID: readonly BuildingLifecycleStage[] = BUILDING_LIFECYCLE_STAGES;

export const BUILDING_LIFECYCLE_VISUAL_STEP_COUNTS: Record<BuildingLifecycleStage, number> = {
  empty_lot: 1,
  site_prep: 3,
  frame: 7,
  enclosed: 4,
  roofed: 1,
  charred_remains: 1,
  cleared_lot: 3
};

export const BUILDING_EXPANSION_STAGE_SEQUENCE: readonly BuildingLotStage[] = [
  "empty_lot",
  "site_prep",
  "frame",
  "enclosed"
] as const;

export const BUILDING_REBUILD_STAGE_SEQUENCE: readonly BuildingLotStage[] = [
  "cleared_lot",
  "site_prep",
  "frame",
  "enclosed"
] as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const SIMULATION_YEAR_DAYS = Math.max(1, PHASES.reduce((sum, phase) => sum + phase.duration, 0));
const HOUSE_STAGE_DURATION_DAYS: Record<BuildingLotStage, number> = {
  empty_lot: BUILDING_EMPTY_LOT_DURATION_DAYS,
  site_prep: BUILDING_SITE_PREP_DURATION_DAYS,
  frame: BUILDING_FRAME_DURATION_DAYS,
  enclosed: BUILDING_ENCLOSED_DURATION_DAYS,
  cleared_lot: BUILDING_CLEARED_LOT_DURATION_DAYS
};
const HOUSE_VISUAL_STAGE_ORDER: readonly BuildingLotStage[] = [
  "empty_lot",
  "site_prep",
  "frame",
  "enclosed"
] as const;
const ROOFED_STAGE_START_AGE_DAYS = HOUSE_VISUAL_STAGE_ORDER.reduce(
  (sum, stage) => sum + HOUSE_STAGE_DURATION_DAYS[stage],
  0
);

export const getBuildingLifecycleStageKey = (stage: BuildingLifecycleStage): string => stage;

export const getBuildingLifecycleStageId = (stage: BuildingLifecycleStage): number =>
  BUILDING_LIFECYCLE_STAGE_IDS[stage] ?? BUILDING_LIFECYCLE_STAGE_IDS.roofed;

export const getBuildingLifecycleStageFromId = (stageId: number): BuildingLifecycleStage => {
  const index = Math.max(0, Math.min(BUILDING_LIFECYCLE_STAGE_BY_ID.length - 1, Math.floor(stageId)));
  return BUILDING_LIFECYCLE_STAGE_BY_ID[index] ?? "roofed";
};

export const getBuildingLifecycleVisualStepCount = (stage: BuildingLifecycleStage): number =>
  BUILDING_LIFECYCLE_VISUAL_STEP_COUNTS[stage] ?? 1;

export const getFractionalSimulationYear = (careerDay: number): number => {
  const clampedCareerDay = Number.isFinite(careerDay) ? Math.max(0, careerDay) : 0;
  return 1 + clampedCareerDay / SIMULATION_YEAR_DAYS;
};

export const getBuildingLotStageSequence = (kind: BuildingLotKind): readonly BuildingLotStage[] =>
  kind === "rebuild" ? BUILDING_REBUILD_STAGE_SEQUENCE : BUILDING_EXPANSION_STAGE_SEQUENCE;

export const getBuildingLotStageDurationDays = (stage: BuildingLotStage): number =>
  HOUSE_STAGE_DURATION_DAYS[stage] ?? BUILDING_FRAME_DURATION_DAYS;

export const getCompletedConstructionYear = (currentYear: number): number =>
  currentYear - (ROOFED_STAGE_START_AGE_DAYS + 1) / SIMULATION_YEAR_DAYS;

const getConstructionAgeDays = (
  tile: Pick<Tile, "houseConstructionYear">,
  currentYear: number
): number => {
  const constructionYear = Number.isFinite(tile.houseConstructionYear) ? (tile.houseConstructionYear ?? currentYear) : currentYear;
  return Math.max(0, (currentYear - constructionYear) * SIMULATION_YEAR_DAYS);
};

const getStageProgress01 = (stage: BuildingLotStage, ageDays: number): number => {
  const index = HOUSE_VISUAL_STAGE_ORDER.indexOf(stage);
  if (index < 0) {
    return 1;
  }
  let stageStartDays = 0;
  for (let i = 0; i < index; i += 1) {
    stageStartDays += HOUSE_STAGE_DURATION_DAYS[HOUSE_VISUAL_STAGE_ORDER[i] ?? "frame"];
  }
  const duration = Math.max(1, HOUSE_STAGE_DURATION_DAYS[stage]);
  return clamp01((ageDays - stageStartDays) / duration);
};

export const resolveHouseLifecycleStage = (
  tile: Pick<Tile, "houseDestroyed" | "houseConstructionYear" | "houseDamage01">,
  currentYear: number
): BuildingLifecycleStage => {
  if (tile.houseDestroyed) {
    return "charred_remains";
  }
  const ageDays = getConstructionAgeDays(tile, currentYear);
  if (ageDays < BUILDING_EMPTY_LOT_DURATION_DAYS) {
    return "empty_lot";
  }
  if (ageDays < BUILDING_EMPTY_LOT_DURATION_DAYS + BUILDING_SITE_PREP_DURATION_DAYS) {
    return "site_prep";
  }
  if (ageDays < BUILDING_EMPTY_LOT_DURATION_DAYS + BUILDING_SITE_PREP_DURATION_DAYS + BUILDING_FRAME_DURATION_DAYS) {
    return "frame";
  }
  if (ageDays < ROOFED_STAGE_START_AGE_DAYS) {
    return "enclosed";
  }
  return "roofed";
};

export const resolveHouseLifecycleVisualStep = (
  tile: Pick<Tile, "houseDestroyed" | "houseConstructionYear" | "houseDamage01">,
  currentYear: number
): number => {
  const stage = resolveHouseLifecycleStage(tile, currentYear);
  const stepCount = getBuildingLifecycleVisualStepCount(stage);
  if (stepCount <= 1 || stage === "charred_remains" || stage === "roofed") {
    return 0;
  }
  const progress01 = getStageProgress01(stage as BuildingLotStage, getConstructionAgeDays(tile, currentYear));
  return Math.max(0, Math.min(stepCount - 1, Math.floor(progress01 * stepCount)));
};

export const resolveBuildingLotVisualStep = (
  lot: Pick<BuildingLot, "stage" | "stageProgressDays">
): number => {
  const stepCount = getBuildingLifecycleVisualStepCount(lot.stage);
  if (stepCount <= 1) {
    return 0;
  }
  const duration = Math.max(1, getBuildingLotStageDurationDays(lot.stage));
  const progress01 = clamp01((lot.stageProgressDays ?? 0) / duration);
  return Math.max(0, Math.min(stepCount - 1, Math.floor(progress01 * stepCount)));
};

export const resolveBuildingLifecycleState = (
  tile: Pick<Tile, "houseDestroyed" | "houseConstructionYear" | "houseDamage01">,
  currentYear: number
): BuildingLifecycleState => {
  return {
    constructionYear: Number.isFinite(tile.houseConstructionYear) ? (tile.houseConstructionYear ?? currentYear) : currentYear,
    damage01: clamp01(tile.houseDamage01 ?? 0),
    stage: resolveHouseLifecycleStage(tile, currentYear)
  };
};

export const advanceHouseDamage = (tile: Tile, nextDamage01: number): void => {
  tile.houseDamage01 = clamp01(Math.max(tile.houseDamage01 ?? 0, nextDamage01));
};

export const finalizeHouseBurn = (tile: Tile): void => {
  tile.houseDamage01 = 1;
  tile.houseDestroyed = true;
};
