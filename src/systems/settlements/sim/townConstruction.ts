import type { WorldState } from "../../../core/state.js";
import { PHASES } from "../../../core/time.js";
import { completePlannedHouse, retireDestroyedHouseToLot } from "../../../core/towns.js";
import { hash2D } from "../../../mapgen/noise.js";
import {
  BUILDING_RUIN_PERSISTENCE_DAYS,
  TOWN_BUILD_START_COOLDOWN_MAX_DAYS,
  TOWN_BUILD_START_COOLDOWN_MIN_DAYS,
  TOWN_CONSTRUCTION_PAUSE_POSTURE,
  TOWN_CONSTRUCTION_SLOW_POSTURE,
  TOWN_CONSTRUCTION_SLOWDOWN_FACTOR
} from "../constants/settlementConstants.js";
import type { BuildingLot } from "../types/buildingTypes.js";
import type { SettlementRoadAdapter } from "../types/settlementTypes.js";
import {
  getBuildingLotStageDurationDays,
  getBuildingLotStageSequence,
  getCompletedConstructionYear,
  getFractionalSimulationYear
} from "./buildingLifecycle.js";
import {
  rebuildGrowthContext,
  reserveTownExpansionLot,
  stepRuntimeTownGrowth,
  tryDensifyTownHousing,
  updateTownEnvelope
} from "./townGrowth.js";

const SIMULATION_YEAR_DAYS = Math.max(1, PHASES.reduce((sum, phase) => sum + phase.duration, 0));
const BULK_CONSTRUCTION_THRESHOLD_DAYS = 4;

export type TownConstructionScheduleOptions = {
  maxEventDays?: number;
};

type SimulationDayContext = {
  careerDay: number;
  phase: WorldState["phase"];
  year: number;
  simulationYear: number;
  phaseDay: number;
};

const isValidTownId = (state: WorldState, townId: number): boolean =>
  Number.isInteger(townId) && townId >= 0 && townId < state.towns.length && state.towns[townId]?.id === townId;

const normalizeTownConstructionState = (state: WorldState): void => {
  for (let i = 0; i < state.towns.length; i += 1) {
    const town = state.towns[i]!;
    town.growthPressure = Math.max(0, Math.trunc(town.growthPressure ?? 0));
    town.recoveryPressure = Math.max(0, Math.trunc(town.recoveryPressure ?? 0));
    town.buildStartCooldownDays = Math.max(
      0,
      Number.isFinite(town.buildStartCooldownDays) ? town.buildStartCooldownDays : 0
    );
    town.activeBuildCap = Math.max(1, Math.min(3, Math.trunc(town.activeBuildCap ?? 1)));
    town.buildStartSerial = Math.max(0, Math.trunc(town.buildStartSerial ?? 0));
  }
};

const sampleSimulationDay = (careerDay: number): SimulationDayContext => {
  const clampedCareerDay = Number.isFinite(careerDay) ? Math.max(0, careerDay) : 0;
  let remaining = ((clampedCareerDay % SIMULATION_YEAR_DAYS) + SIMULATION_YEAR_DAYS) % SIMULATION_YEAR_DAYS;
  let phase: WorldState["phase"] = PHASES[0]?.id ?? "growth";
  for (let i = 0; i < PHASES.length; i += 1) {
    const phaseDef = PHASES[i]!;
    if (remaining < phaseDef.duration) {
      phase = phaseDef.id;
      break;
    }
    remaining -= phaseDef.duration;
  }
  return {
    careerDay: clampedCareerDay,
    phase,
    year: Math.max(1, Math.floor(clampedCareerDay / SIMULATION_YEAR_DAYS) + 1),
    simulationYear: getFractionalSimulationYear(clampedCareerDay),
    phaseDay: remaining
  };
};

const computeTownActiveBuildCap = (town: WorldState["towns"][number]): number => {
  let cap = 1;
  if (town.houseCount >= 28) {
    cap = 3;
  } else if (town.houseCount >= 10) {
    cap = 2;
  }
  if ((town.approval ?? 1) < 0.45) {
    cap -= 1;
  }
  return Math.max(1, Math.min(3, cap));
};

const getTownConstructionRate = (posture: number): number => {
  const clampedPosture = Math.max(0, Math.trunc(posture ?? 0));
  if (clampedPosture >= TOWN_CONSTRUCTION_PAUSE_POSTURE) {
    return 0;
  }
  if (clampedPosture >= TOWN_CONSTRUCTION_SLOW_POSTURE) {
    return TOWN_CONSTRUCTION_SLOWDOWN_FACTOR;
  }
  return 1;
};

const getNextTownBuildCooldownDays = (state: WorldState, town: WorldState["towns"][number]): number => {
  const span = TOWN_BUILD_START_COOLDOWN_MAX_DAYS - TOWN_BUILD_START_COOLDOWN_MIN_DAYS + 1;
  const serial = Math.max(1, Math.trunc(town.buildStartSerial ?? 0));
  return (
    TOWN_BUILD_START_COOLDOWN_MIN_DAYS +
    Math.floor(hash2D(town.id + 1, serial, state.seed ^ 0x67bbff1d) * Math.max(1, span))
  );
};

const groupLotsByTown = (state: WorldState): BuildingLot[][] => {
  const grouped = Array.from({ length: state.towns.length }, () => [] as BuildingLot[]);
  for (let i = 0; i < state.buildingLots.length; i += 1) {
    const lot = state.buildingLots[i]!;
    if (!isValidTownId(state, lot.townId)) {
      continue;
    }
    grouped[lot.townId]!.push(lot);
  }
  for (let i = 0; i < grouped.length; i += 1) {
    grouped[i]!.sort((left, right) => left.id - right.id);
  }
  return grouped;
};

const buildRebuildQueues = (
  state: WorldState,
  currentDay: number
): { ruinedCounts: Int32Array; eligibleQueues: number[][] } => {
  const ruinedCounts = new Int32Array(state.towns.length);
  const eligibleQueues = Array.from({ length: state.towns.length }, () => [] as number[]);
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    const tile = state.tiles[idx];
    if (!tile || tile.type !== "house" || !tile.houseDestroyed) {
      continue;
    }
    const townId = tile.houseTownId ?? -1;
    if (!isValidTownId(state, townId)) {
      continue;
    }
    ruinedCounts[townId] += 1;
    const destroyedAtDay = Number.isFinite(tile.houseDestroyedAtDay) ? (tile.houseDestroyedAtDay ?? currentDay) : currentDay;
    if (destroyedAtDay + BUILDING_RUIN_PERSISTENCE_DAYS <= currentDay) {
      eligibleQueues[townId]!.push(idx);
    }
  }
  for (let townId = 0; townId < eligibleQueues.length; townId += 1) {
    eligibleQueues[townId]!.sort((left, right) => {
      const leftTile = state.tiles[left];
      const rightTile = state.tiles[right];
      const leftDestroyedAt = Number.isFinite(leftTile?.houseDestroyedAtDay)
        ? (leftTile?.houseDestroyedAtDay ?? currentDay)
        : currentDay;
      const rightDestroyedAt = Number.isFinite(rightTile?.houseDestroyedAtDay)
        ? (rightTile?.houseDestroyedAtDay ?? currentDay)
        : currentDay;
      if (leftDestroyedAt !== rightDestroyedAt) {
        return leftDestroyedAt - rightDestroyedAt;
      }
      return left - right;
    });
  }
  return { ruinedCounts, eligibleQueues };
};

const advanceBuildingLot = (
  lot: BuildingLot,
  progressDays: number
): { completed: boolean; stageChanged: boolean } => {
  if (progressDays <= 0) {
    return { completed: false, stageChanged: false };
  }
  let remainingProgress = progressDays;
  let stageChanged = false;
  while (remainingProgress > 1e-6) {
    const duration = Math.max(1, getBuildingLotStageDurationDays(lot.stage));
    const needed = Math.max(0, duration - Math.max(0, lot.stageProgressDays));
    if (remainingProgress + 1e-6 < needed) {
      lot.stageProgressDays = Math.max(0, lot.stageProgressDays + remainingProgress);
      return { completed: false, stageChanged };
    }
    remainingProgress = Math.max(0, remainingProgress - needed);
    lot.stageProgressDays = 0;
    const sequence = getBuildingLotStageSequence(lot.kind);
    const stageIndex = sequence.indexOf(lot.stage);
    const nextStage = stageIndex >= 0 ? sequence[stageIndex + 1] : null;
    stageChanged = true;
    if (!nextStage) {
      return { completed: true, stageChanged: true };
    }
    lot.stage = nextStage;
  }
  return { completed: false, stageChanged };
};

const createBuildingLot = (
  state: WorldState,
  townId: number,
  kind: BuildingLot["kind"],
  anchorIndex: number,
  styleSeed: number,
  stage: BuildingLot["stage"],
  startedDay: number,
  houseValue: number,
  houseResidents: number
): BuildingLot => ({
  id: state.nextBuildingLotId++,
  townId,
  kind,
  anchorIndex,
  styleSeed,
  stage,
  stageProgressDays: 0,
  startedDay,
  houseValue,
  houseResidents
});

const startTownRebuildLot = (
  state: WorldState,
  townId: number,
  ruinedHouseIndex: number,
  currentDay: number
): BuildingLot | null => {
  const tile = state.tiles[ruinedHouseIndex];
  if (!tile || tile.type !== "house" || !tile.houseDestroyed) {
    return null;
  }
  const houseValue = Math.max(1, Math.floor(tile.houseValue || 160));
  const houseResidents = Math.max(0, Math.floor(tile.houseResidents || 2));
  if (!retireDestroyedHouseToLot(state, ruinedHouseIndex)) {
    return null;
  }
  return createBuildingLot(
    state,
    townId,
    "rebuild",
    ruinedHouseIndex,
    Number.isFinite(tile.houseStyleSeed) ? Math.trunc(tile.houseStyleSeed as number) : ruinedHouseIndex,
    "cleared_lot",
    currentDay,
    houseValue,
    houseResidents
  );
};

const startTownExpansionLot = (
  state: WorldState,
  town: WorldState["towns"][number],
  currentDay: number,
  effectiveYear: number,
  roadAdapter: SettlementRoadAdapter,
  context: ReturnType<typeof rebuildGrowthContext>
): BuildingLot | null => {
  const reservation = reserveTownExpansionLot(state, town, context, roadAdapter, effectiveYear);
  if (!reservation) {
    return null;
  }
  return createBuildingLot(
    state,
    town.id,
    "expansion",
    reservation.anchorIndex,
    reservation.styleSeed,
    "empty_lot",
    currentDay,
    reservation.houseValue,
    reservation.houseResidents
  );
};

const processConstructionDay = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  dayContext: SimulationDayContext
): void => {
  normalizeTownConstructionState(state);
  stepRuntimeTownGrowth(state, dayContext.phase, dayContext.year);

  let lotsByTown = groupLotsByTown(state);
  const { ruinedCounts, eligibleQueues } = buildRebuildQueues(state, dayContext.careerDay);

  for (let townId = 0; townId < state.towns.length; townId += 1) {
    const town = state.towns[townId]!;
    town.activeBuildCap = computeTownActiveBuildCap(town);
    const progressRate = getTownConstructionRate(town.alertPosture);
    if (progressRate > 0) {
      town.buildStartCooldownDays = Math.max(0, town.buildStartCooldownDays - progressRate);
    }
  }

  const completedLotIds = new Set<number>();
  const completedLots: BuildingLot[] = [];
  for (let townId = 0; townId < lotsByTown.length; townId += 1) {
    const town = state.towns[townId]!;
    const progressRate = getTownConstructionRate(town.alertPosture);
    if (progressRate <= 0) {
      continue;
    }
    const activeLots = lotsByTown[townId]!;
    for (let i = 0; i < activeLots.length; i += 1) {
      const lot = activeLots[i]!;
      const result = advanceBuildingLot(lot, progressRate);
      if (!result.stageChanged) {
        continue;
      }
      if (result.completed) {
        completedLotIds.add(lot.id);
        completedLots.push(lot);
        continue;
      }
      state.structureRevision += 1;
    }
  }

  if (completedLots.length > 0) {
    state.buildingLots = state.buildingLots.filter((lot) => !completedLotIds.has(lot.id));
    let rebuiltContext = rebuildGrowthContext(state);
    const failedCompletions: BuildingLot[] = [];
    for (let i = 0; i < completedLots.length; i += 1) {
      const lot = completedLots[i]!;
      if (
        !completePlannedHouse(
          state,
          lot.anchorIndex,
          lot.townId,
          lot.houseValue,
          lot.houseResidents,
          getCompletedConstructionYear(dayContext.simulationYear),
          lot.styleSeed
        )
      ) {
        failedCompletions.push(lot);
        continue;
      }
      updateTownEnvelope(state, state.towns[lot.townId]!);
    }
    if (failedCompletions.length > 0) {
      state.buildingLots.push(...failedCompletions);
      console.warn(
        `[towns] failed to complete ${failedCompletions.length} construction lot(s): ${failedCompletions
          .map((lot) => lot.id)
          .join(", ")}`
      );
    }
    rebuiltContext = rebuildGrowthContext(state);
    void rebuiltContext;
    lotsByTown = groupLotsByTown(state);
  }

  let context = rebuildGrowthContext(state);
  for (let townId = 0; townId < state.towns.length; townId += 1) {
    const town = state.towns[townId]!;
    const activeLots = lotsByTown[townId]!;
    const activeRecoveryCount = activeLots.filter((lot) => lot.kind === "rebuild").length;
    town.recoveryPressure = Math.max(0, ruinedCounts[townId] + activeRecoveryCount);

    if (getTownConstructionRate(town.alertPosture) <= 0) {
      continue;
    }
    if (town.buildStartCooldownDays > 1e-6) {
      continue;
    }
    if (activeLots.length >= town.activeBuildCap) {
      continue;
    }

    const rebuildQueue = eligibleQueues[townId]!;
    if (rebuildQueue.length > 0) {
      const rebuildLot = startTownRebuildLot(state, townId, rebuildQueue.shift()!, dayContext.careerDay);
      if (rebuildLot) {
        town.buildStartSerial += 1;
        town.buildStartCooldownDays = getNextTownBuildCooldownDays(state, town);
        town.recoveryPressure = Math.max(0, town.recoveryPressure - 1);
        state.buildingLots.push(rebuildLot);
        activeLots.push(rebuildLot);
        updateTownEnvelope(state, town);
      }
      continue;
    }

    if (dayContext.phase !== "growth" || town.growthPressure <= 0) {
      continue;
    }
    const reserveRecoverySlot = rebuildQueue.length > 0 && activeRecoveryCount <= 0 ? 1 : 0;
    const expansionSlots = town.activeBuildCap - activeLots.length - reserveRecoverySlot;
    if (expansionSlots <= 0) {
      continue;
    }

    const effectiveYear = Math.max(
      0,
      dayContext.year - 1,
      Math.floor(town.simulatedGrowthYears ?? 0)
    );
    const expansionLot = startTownExpansionLot(state, town, dayContext.careerDay, effectiveYear, roadAdapter, context);
    if (!expansionLot) {
      if (tryDensifyTownHousing(state, town)) {
        town.growthPressure = Math.max(0, town.growthPressure - 1);
        town.buildStartSerial += 1;
        town.buildStartCooldownDays = getNextTownBuildCooldownDays(state, town);
        state.structureRevision += 1;
        updateTownEnvelope(state, town);
      } else {
        town.growthPressure = Math.max(0, town.growthPressure - 1);
        town.buildStartSerial += 1;
        town.buildStartCooldownDays = getNextTownBuildCooldownDays(state, town);
      }
      continue;
    }
    town.buildStartSerial += 1;
    town.buildStartCooldownDays = getNextTownBuildCooldownDays(state, town);
    town.growthPressure = Math.max(0, town.growthPressure - 1);
    state.buildingLots.push(expansionLot);
    activeLots.push(expansionLot);
    state.structureRevision += 1;
    updateTownEnvelope(state, town);
  }
};

const getDaysUntilPhaseBoundary = (dayContext: SimulationDayContext): number => {
  const phaseDef = PHASES.find((entry) => entry.id === dayContext.phase) ?? PHASES[0]!;
  return Math.max(1, Math.ceil(Math.max(0.000001, phaseDef.duration - dayContext.phaseDay)));
};

const getDaysUntilLotStageEvent = (lot: BuildingLot, progressRate: number): number => {
  if (progressRate <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  const duration = Math.max(1, getBuildingLotStageDurationDays(lot.stage));
  const remaining = Math.max(0, duration - Math.max(0, lot.stageProgressDays));
  return Math.max(1, Math.ceil(remaining / progressRate));
};

const getDaysUntilRuinEligible = (
  state: WorldState,
  townId: number,
  currentDay: number
): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    const tile = state.tiles[idx];
    if (!tile || tile.type !== "house" || !tile.houseDestroyed || tile.houseTownId !== townId) {
      continue;
    }
    const destroyedAtDay = Number.isFinite(tile.houseDestroyedAtDay) ? (tile.houseDestroyedAtDay ?? currentDay) : currentDay;
    const eligibleIn = Math.max(0, destroyedAtDay + BUILDING_RUIN_PERSISTENCE_DAYS - currentDay);
    best = Math.min(best, Math.max(1, Math.ceil(eligibleIn)));
  }
  return best;
};

const computeConstructionSkipWindowDays = (
  state: WorldState,
  dayContext: SimulationDayContext
): number => {
  normalizeTownConstructionState(state);
  if (dayContext.phase === "growth" && state.townGrowthAppliedYear !== dayContext.year) {
    return 1;
  }
  const lotsByTown = groupLotsByTown(state);
  const { eligibleQueues } = buildRebuildQueues(state, dayContext.careerDay);
  let nextEventDays = getDaysUntilPhaseBoundary(dayContext);
  for (let townId = 0; townId < state.towns.length; townId += 1) {
    const town = state.towns[townId]!;
    town.activeBuildCap = computeTownActiveBuildCap(town);
    const progressRate = getTownConstructionRate(town.alertPosture);
    if (progressRate <= 0) {
      continue;
    }
    const activeLots = lotsByTown[townId]!;
    const hasCapacity = activeLots.length < town.activeBuildCap;
    const hasGrowthWork = dayContext.phase === "growth" && town.growthPressure > 0;
    const hasRecoveryWork = eligibleQueues[townId]!.length > 0;
    if (hasCapacity && town.buildStartCooldownDays <= 1e-6 && (hasGrowthWork || hasRecoveryWork)) {
      return 1;
    }
    if (hasCapacity && (hasGrowthWork || hasRecoveryWork) && town.buildStartCooldownDays > 1e-6) {
      nextEventDays = Math.min(nextEventDays, Math.max(1, Math.ceil(town.buildStartCooldownDays / progressRate)));
    }
    if (hasCapacity && !hasRecoveryWork) {
      nextEventDays = Math.min(nextEventDays, getDaysUntilRuinEligible(state, townId, dayContext.careerDay));
    }
    for (let i = 0; i < activeLots.length; i += 1) {
      nextEventDays = Math.min(nextEventDays, getDaysUntilLotStageEvent(activeLots[i]!, progressRate));
    }
  }
  return Number.isFinite(nextEventDays) ? Math.max(1, Math.floor(nextEventDays)) : getDaysUntilPhaseBoundary(dayContext);
};

const advancePassiveConstructionDays = (
  state: WorldState,
  days: number
): void => {
  if (days <= 0) {
    return;
  }
  normalizeTownConstructionState(state);
  const lotsByTown = groupLotsByTown(state);
  for (let townId = 0; townId < state.towns.length; townId += 1) {
    const town = state.towns[townId]!;
    town.activeBuildCap = computeTownActiveBuildCap(town);
    const progressRate = getTownConstructionRate(town.alertPosture);
    if (progressRate <= 0) {
      continue;
    }
    town.buildStartCooldownDays = Math.max(0, town.buildStartCooldownDays - progressRate * days);
    const activeLots = lotsByTown[townId]!;
    for (let i = 0; i < activeLots.length; i += 1) {
      const lot = activeLots[i]!;
      const duration = Math.max(1, getBuildingLotStageDurationDays(lot.stage));
      lot.stageProgressDays = Math.min(duration - 1e-6, Math.max(0, lot.stageProgressDays + progressRate * days));
    }
  }
};

const processConstructionWholeDays = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  firstCareerDay: number,
  wholeDays: number,
  maxEventDays: number
): number => {
  let day = firstCareerDay;
  let remaining = wholeDays;
  let processedDays = 0;
  let eventDays = 0;
  while (remaining > 0 && eventDays < maxEventDays) {
    const dayContext = sampleSimulationDay(day);
    const skipWindow = computeConstructionSkipWindowDays(state, dayContext);
    const passiveDays = Math.min(remaining, Math.max(0, skipWindow - 1));
    if (passiveDays >= BULK_CONSTRUCTION_THRESHOLD_DAYS) {
      advancePassiveConstructionDays(state, passiveDays);
      day += passiveDays;
      remaining -= passiveDays;
      processedDays += passiveDays;
      continue;
    }
    processConstructionDay(state, roadAdapter, dayContext);
    day += 1;
    remaining -= 1;
    processedDays += 1;
    eventDays += 1;
  }
  return processedDays;
};

export const stepTownConstructionSchedule = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  dayDelta: number,
  options: TownConstructionScheduleOptions = {}
): void => {
  if (dayDelta <= 0 || state.towns.length <= 0) {
    return;
  }
  normalizeTownConstructionState(state);
  state.settlementBuildDayAccumulator = Math.max(0, state.settlementBuildDayAccumulator + dayDelta);
  const wholeDays = Math.floor(state.settlementBuildDayAccumulator);
  if (wholeDays <= 0) {
    return;
  }
  const firstCareerDay = Math.floor(state.careerDay - state.settlementBuildDayAccumulator + 1);
  const processedDays = processConstructionWholeDays(
    state,
    roadAdapter,
    firstCareerDay,
    wholeDays,
    Math.max(1, Math.floor(options.maxEventDays ?? Number.POSITIVE_INFINITY))
  );
  state.settlementBuildDayAccumulator = Math.max(0, state.settlementBuildDayAccumulator - processedDays);
  if (state.settlementBuildDayAccumulator >= 1) {
    state.settlementBuildDayAccumulator %= 1;
  }
};
