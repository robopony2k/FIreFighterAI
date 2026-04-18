import type { Tile } from "../../../core/types.js";
import { PHASES } from "../../../core/time.js";
import type { BuildingLifecycleStage, BuildingLifecycleState } from "../types/buildingTypes.js";

export const BUILDING_LIFECYCLE_STAGES: readonly BuildingLifecycleStage[] = [
  "foundation",
  "frame",
  "enclosed",
  "finished",
  "damaged",
  "burnt_frame"
] as const;

export const BUILDING_LIFECYCLE_STAGE_IDS: Record<BuildingLifecycleStage, number> = {
  foundation: 0,
  frame: 1,
  enclosed: 2,
  finished: 3,
  damaged: 4,
  burnt_frame: 5
};

export const BUILDING_LIFECYCLE_STAGE_BY_ID: readonly BuildingLifecycleStage[] = BUILDING_LIFECYCLE_STAGES;
export const BUILDING_LIFECYCLE_VISUAL_STEP_COUNTS: Record<BuildingLifecycleStage, number> = {
  foundation: 3,
  frame: 7,
  enclosed: 4,
  finished: 1,
  damaged: 1,
  burnt_frame: 1
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const SIMULATION_YEAR_DAYS = Math.max(1, PHASES.reduce((sum, phase) => sum + phase.duration, 0));
const FOUNDATION_STAGE_MAX_AGE_YEARS = 0.03;
const FRAME_STAGE_MAX_AGE_YEARS = 0.09;
const ENCLOSED_STAGE_MAX_AGE_YEARS = 0.18;

export const getBuildingLifecycleStageKey = (stage: BuildingLifecycleStage): string => stage;

export const getBuildingLifecycleStageId = (stage: BuildingLifecycleStage): number =>
  BUILDING_LIFECYCLE_STAGE_IDS[stage] ?? BUILDING_LIFECYCLE_STAGE_IDS.finished;

export const getBuildingLifecycleStageFromId = (stageId: number): BuildingLifecycleStage => {
  const index = Math.max(0, Math.min(BUILDING_LIFECYCLE_STAGE_BY_ID.length - 1, Math.floor(stageId)));
  return BUILDING_LIFECYCLE_STAGE_BY_ID[index] ?? "finished";
};

export const getBuildingLifecycleVisualStepCount = (stage: BuildingLifecycleStage): number =>
  BUILDING_LIFECYCLE_VISUAL_STEP_COUNTS[stage] ?? 1;

export const getFractionalSimulationYear = (careerDay: number): number => {
  const clampedCareerDay = Number.isFinite(careerDay) ? Math.max(0, careerDay) : 0;
  return 1 + clampedCareerDay / SIMULATION_YEAR_DAYS;
};

const getConstructionAgeYears = (
  tile: Pick<Tile, "houseConstructionYear">,
  currentYear: number
): number => {
  const constructionYear = Number.isFinite(tile.houseConstructionYear) ? (tile.houseConstructionYear ?? currentYear) : currentYear;
  return Math.max(0, currentYear - constructionYear);
};

export const resolveHouseLifecycleStage = (tile: Pick<Tile, "houseDestroyed" | "houseConstructionYear" | "houseDamage01">, currentYear: number): BuildingLifecycleStage => {
  if (tile.houseDestroyed) {
    return "burnt_frame";
  }
  const damage01 = clamp01(tile.houseDamage01 ?? 0);
  if (damage01 >= 0.6) {
    return "damaged";
  }
  const ageYears = getConstructionAgeYears(tile, currentYear);
  if (ageYears < FOUNDATION_STAGE_MAX_AGE_YEARS) {
    return "foundation";
  }
  if (ageYears < FRAME_STAGE_MAX_AGE_YEARS) {
    return "frame";
  }
  if (ageYears < ENCLOSED_STAGE_MAX_AGE_YEARS) {
    return "enclosed";
  }
  return "finished";
};

const resolveStageProgress01 = (
  stage: BuildingLifecycleStage,
  ageYears: number
): number => {
  if (stage === "foundation") {
    return clamp01(ageYears / FOUNDATION_STAGE_MAX_AGE_YEARS);
  }
  if (stage === "frame") {
    return clamp01(
      (ageYears - FOUNDATION_STAGE_MAX_AGE_YEARS) /
        Math.max(0.0001, FRAME_STAGE_MAX_AGE_YEARS - FOUNDATION_STAGE_MAX_AGE_YEARS)
    );
  }
  if (stage === "enclosed") {
    return clamp01(
      (ageYears - FRAME_STAGE_MAX_AGE_YEARS) /
        Math.max(0.0001, ENCLOSED_STAGE_MAX_AGE_YEARS - FRAME_STAGE_MAX_AGE_YEARS)
    );
  }
  return 1;
};

export const resolveHouseLifecycleVisualStep = (
  tile: Pick<Tile, "houseDestroyed" | "houseConstructionYear" | "houseDamage01">,
  currentYear: number
): number => {
  const stage = resolveHouseLifecycleStage(tile, currentYear);
  const stepCount = getBuildingLifecycleVisualStepCount(stage);
  if (stepCount <= 1) {
    return 0;
  }
  const progress01 = resolveStageProgress01(stage, getConstructionAgeYears(tile, currentYear));
  return Math.max(0, Math.min(stepCount - 1, Math.floor(progress01 * stepCount)));
};

export const resolveBuildingLifecycleState = (
  tile: Pick<Tile, "houseDestroyed" | "houseConstructionYear" | "houseDamage01">,
  currentYear: number
): BuildingLifecycleState => {
  const stage = resolveHouseLifecycleStage(tile, currentYear);
  return {
    constructionYear: Number.isFinite(tile.houseConstructionYear) ? (tile.houseConstructionYear ?? currentYear) : currentYear,
    damage01: clamp01(tile.houseDamage01 ?? 0),
    stage
  };
};

export const advanceHouseDamage = (tile: Tile, nextDamage01: number): void => {
  tile.houseDamage01 = clamp01(Math.max(tile.houseDamage01 ?? 0, nextDamage01));
};

export const finalizeHouseBurn = (tile: Tile): void => {
  tile.houseDamage01 = 1;
  tile.houseDestroyed = true;
};
