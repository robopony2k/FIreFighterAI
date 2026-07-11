import type { RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import type { EventBus } from "../core/eventBus.js";
import type { GameEvents, OverlayPayload } from "../core/gameEvents.js";
import {
  APPROVAL_MIN,
  BASE_BUDGET,
  CAREER_YEARS,
  DEFAULT_INCIDENT_TIME_SPEED_INDEX,
  DAYS_PER_SECOND,
  FIRE_WEATHER_RISK_MIN,
  GROWTH_WEATHER_MOISTURE_MIN,
  GROWTH_WEATHER_TEMP_MAX,
  GROWTH_WEATHER_TEMP_MIN,
  INCIDENT_FIRE_PACING_SCALE,
  INCIDENT_TIME_SPEED_OPTIONS,
  NEIGHBOR_DIRS,
  TIME_SPEED_OPTIONS,
  getTimeSpeedOptions
} from "../core/config.js";
import {
  clampTimeSpeedSliderValue,
  getResolvedTimeSpeedValue,
  isSimulationEffectivelyPaused as isCoreSimulationEffectivelyPaused,
  TIME_SPEED_SLIDER_MAX
} from "../core/timeSpeed.js";
import { formatCurrency } from "../core/utils.js";
import { getFireSeasonIntensity, getPhaseInfo, PHASES } from "../core/time.js";
import { RNG as RuntimeRng } from "../core/rng.js";
import { setStatus, resetStatus } from "../core/state.js";
import { maybeReport, profEnd, profStart } from "./prof.js";
import { inBounds, indexFor } from "../core/grid.js";
import { getCharacterBaseBudget, getCharacterDefinition } from "../core/characters.js";
import {
  ambientTemp,
  clamp,
  buildClimateTimeline,
  CLIMATE_IGNITION_MAX,
  CLIMATE_IGNITION_MIN,
  debugClimateChecks,
  DEFAULT_MOISTURE_PARAMS,
  moistureStep,
  VIRTUAL_CLIMATE_PARAMS
} from "../core/climate.js";
import { randomizeWind, stepWind } from "./wind.js";
import { resetFireBounds, stepFire } from "./fire.js";
import { INITIAL_IGNITION_ATTEMPTS, findIgnitionCandidate, igniteRandomFire } from "./fire/ignite.js";
import { clearFireBlocks, markFireBlockActiveByTile } from "./fire/activeBlocks.js";
import { advanceCareerDay, getClimateRisk } from "./climateRuntime.js";
import { isBaseTileLost } from "./failure.js";
import { updatePhaseControls } from "./lifecycle.js";
import { stepGrowth } from "./growth.js";
import { stepTownAlertPosture } from "./towns.js";
import { stepParticles } from "./particles.js";
import { freezeScoringSeason, queueScoreFlowEvent, startScoringSeason, stepScoring } from "./scoring.js";
import {
  applyExtinguishStep,
  applyUnitHazards,
  autoAssignTargets,
  clearFuelLine,
  deployUnit,
  issueSquadReturnOrders,
  prepareExtinguish,
  returnToFocusedCommandUnitSelection,
  seedStartingRoster,
  selectUnit,
  setDeployMode,
  setUnitTarget,
  stepUnits
} from "./units.js";
import {
  getAdaptiveFireSubstepMax,
  getBurnoutFactorForRisk,
  isRandomIgnitionWeatherViable,
  sampleFireWeatherResponse
} from "./fire/fireWeather.js";
import type { InputState } from "../core/inputState.js";
import type { EffectsState } from "../core/effectsState.js";
import { getRuntimeSettings, subscribeRuntimeSettings } from "../persistence/runtimeSettings.js";
import {
  backfillRoadEdgesInBounds,
  backfillRoadEdgesFromAdjacency,
  carveRoadDetailed,
  carveRoadPath,
  clearRoadEdges,
  collectConnectedRoadNeighbors,
  collectRoadTiles,
  mergeRoadTileBounds,
  findNearestRoadTile,
  pruneRoadDiagonalStubs,
  type RoadTileBounds
} from "../mapgen/roads.js";
import type { SettlementRoadAdapter } from "../systems/settlements/types/settlementTypes.js";
import { stepTownConstructionSchedule } from "../systems/settlements/sim/townConstruction.js";
import { stepWaterTowers } from "../systems/settlements/sim/waterTowerInfrastructure.js";
import { applyFireActivityMetrics } from "../systems/fire/sim/fireActivityState.js";
import { stepFireDetection, stepWatchTowerConstruction, type FireDetectionStepResult } from "../systems/fire/sim/fireDetection.js";
import type { FireDetectionReport } from "../core/types.js";
import { stepEvacuations } from "../systems/evacuation/sim/evacuationRuntime.js";
import type { EvacuationLossEvent } from "../systems/evacuation/types/evacuationTypes.js";
import {
  buildSeasonalRainForecastPeriods,
  SEASONAL_RAIN_EXTINGUISH_THRESHOLD,
  sampleSeasonalRainState
} from "../systems/climate/sim/seasonalRain.js";
import {
  hasDeferredFireRuntimeWork,
  resolveRuntimeWorkBudget
} from "../systems/fire/controllers/fireRuntimeController.js";
export { updatePhaseControls };

const FIRE_HEAT_PADDING = 8;
const YEAR_EVENTS: Record<number, string[]> = {};

const FORECAST_WINDOW_DAYS = 90;
const PHASE_YEAR_DAYS = PHASES.reduce((sum, phase) => sum + phase.duration, 0);
const VIRTUAL_YEAR_DAYS = Math.max(1, Math.floor(VIRTUAL_CLIMATE_PARAMS.seasonLen));
const CAREER_TOTAL_DAYS = VIRTUAL_YEAR_DAYS * CAREER_YEARS;
const CLIMATE_SEASONS = ["Winter", "Spring", "Summer", "Autumn"];
const RUNTIME_CONSTRUCTION_EVENT_DAYS_PER_TICK = 2;
let allowFireIgnitionEvents = getRuntimeSettings().randomFireIgnition;
let allowAnnualReport = getRuntimeSettings().annualReportEnabled;
let pauseOnFireEvent = getRuntimeSettings().pauseOnFireEvent;
let pauseOnAnnualReportEvent = getRuntimeSettings().pauseOnAnnualReportEvent;
let pauseOnRainEvent = getRuntimeSettings().pauseOnRainEvent;

const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

const resetStepPerfTelemetry = (state: WorldState): void => {
  state.simPerfCalendarMs = 0;
  state.simPerfTownConstructionMs = 0;
  state.simPerfGrowthMs = 0;
  state.simPerfGrowthBlocksProcessed = 0;
  state.simPerfGrowthTilesVisited = 0;
  state.simPerfGrowthTilesChanged = 0;
  state.simPerfUnitsMs = 0;
  state.simPerfFireMs = 0;
  state.simPerfScoringMs = 0;
  state.simPerfParticlesMs = 0;
};

subscribeRuntimeSettings((settings) => {
  allowFireIgnitionEvents = settings.randomFireIgnition;
  allowAnnualReport = settings.annualReportEnabled;
  pauseOnFireEvent = settings.pauseOnFireEvent;
  pauseOnAnnualReportEvent = settings.pauseOnAnnualReportEvent;
  pauseOnRainEvent = settings.pauseOnRainEvent;
});

type PhaseTransitionOptions = {
  openAnnualReport?: boolean;
};

let gameEvents: EventBus<GameEvents> | null = null;

export const setGameEventBus = (events: EventBus<GameEvents> | null): void => {
  gameEvents = events;
};

const emitOverlay = (payload: OverlayPayload): void => {
  gameEvents?.emit("overlay:show", payload);
};

const emitGameOver = (payload: GameEvents["game:over"]): void => {
  gameEvents?.emit("game:over", payload);
};

const applyEvacuationLossEvents = (state: WorldState, events: EvacuationLossEvent[]): void => {
  for (const event of events) {
    if (event.kind !== "vehicle-destroyed" || event.occupants <= 0) {
      continue;
    }
    state.lostResidents += event.occupants;
    state.yearLivesLost += event.occupants;
    const town = state.towns.find((entry) => entry.id === event.townId) ?? null;
    if (town) {
      town.nonApprovingHouseCount += Math.max(1, event.occupants / 4);
    }
    queueScoreFlowEvent(state, "lives", event.occupants, undefined, event.tileX, event.tileY);
  }
};

const ensureClimateTimeline = (state: WorldState): void => {
  if (state.climateTimeline && state.climateTimelineSeed === state.seed) {
    return;
  }
  state.climateTimeline = buildClimateTimeline(
    state.seed,
    CAREER_YEARS,
    VIRTUAL_CLIMATE_PARAMS,
    DEFAULT_MOISTURE_PARAMS
  );
  state.climateTimelineSeed = state.seed;
  state.climateForecast = {
    days: FORECAST_WINDOW_DAYS,
    temps: [],
    risk: Array.from({ length: FORECAST_WINDOW_DAYS }, () => 0),
    rainPeriods: []
  };
  state.climateForecastStart = -1;
  state.climateForecastDay = 0;
};

const updateClimateForDay = (state: WorldState, seasonDay: number, yearIndex = Math.max(0, state.year - 1)): void => {
  state.climateDay = seasonDay;
  state.climateYear = yearIndex;
  state.climateTemp = ambientTemp(seasonDay, yearIndex, state.seed, VIRTUAL_CLIMATE_PARAMS);
  state.climateMoisture = moistureStep(state.climateMoisture, state.climateTemp, DEFAULT_MOISTURE_PARAMS);
  const denom = Math.max(0.0001, DEFAULT_MOISTURE_PARAMS.Mmax - DEFAULT_MOISTURE_PARAMS.Mmin);
  const moistureNorm = clamp((state.climateMoisture - DEFAULT_MOISTURE_PARAMS.Mmin) / denom, 0, 1);
  state.climateIgnitionMultiplier = CLIMATE_IGNITION_MAX + (CLIMATE_IGNITION_MIN - CLIMATE_IGNITION_MAX) * moistureNorm;
  const dryness = 1 - moistureNorm;
  state.climateSpreadMultiplier = 0.6 + dryness * 1.4;
};

const syncClimateToCareerDay = (state: WorldState): void => {
  if (CAREER_TOTAL_DAYS <= 0) {
    return;
  }
  const targetTotal = clamp(Math.floor(state.careerDay), 0, Math.max(0, CAREER_TOTAL_DAYS - 1));
  const dayOffset = state.climateDay > 0 ? state.climateDay - 1 : -1;
  let currentTotal = state.climateYear * VIRTUAL_YEAR_DAYS + dayOffset;
  while (currentTotal < targetTotal) {
    currentTotal += 1;
    const yearIndex = Math.floor(currentTotal / VIRTUAL_YEAR_DAYS);
    const dayOfYear = (currentTotal % VIRTUAL_YEAR_DAYS) + 1;
    updateClimateForDay(state, dayOfYear, yearIndex);
  }
};

const updateClimateForecastWindow = (state: WorldState): void => {
  ensureClimateTimeline(state);
  const timeline = state.climateTimeline;
  const forecast = state.climateForecast;
  if (!timeline || !forecast) {
    return;
  }
  const totalDays = timeline.totalDays;
  const currentDay = clamp(Math.floor(state.careerDay), 0, Math.max(0, totalDays - 1));
  const maxWindowStart = Math.max(0, totalDays - FORECAST_WINDOW_DAYS);
  const windowStart = clamp(currentDay - 15, 0, maxWindowStart);
  if (forecast.days !== FORECAST_WINDOW_DAYS || forecast.risk.length !== FORECAST_WINDOW_DAYS) {
    forecast.days = FORECAST_WINDOW_DAYS;
    forecast.risk = Array.from({ length: FORECAST_WINDOW_DAYS }, () => 0);
    forecast.temps = [];
  }
  if (state.climateForecastStart !== windowStart) {
    for (let i = 0; i < FORECAST_WINDOW_DAYS; i += 1) {
      const idx = Math.min(windowStart + i, Math.max(0, totalDays - 1));
      forecast.risk[i] = timeline.risk[idx] ?? 0;
    }
    state.climateForecastStart = windowStart;
  }
  forecast.rainPeriods = buildSeasonalRainForecastPeriods(state.seed, windowStart, FORECAST_WINDOW_DAYS, VIRTUAL_YEAR_DAYS);
  state.climateForecastDay = clamp(currentDay - windowStart, 0, FORECAST_WINDOW_DAYS - 1);
};

const syncSeasonalRainToCareerDay = (state: WorldState): void => {
  state.seasonalRain = sampleSeasonalRainState(state.seed, state.careerDay, state.seasonalRain, VIRTUAL_YEAR_DAYS);
};

const ensureFireSnapshot = (state: WorldState): Float32Array => {
  if (state.fireSnapshot.length !== state.grid.totalTiles) {
    state.fireSnapshot = new Float32Array(state.grid.totalTiles);
  }
  return state.fireSnapshot;
};

const captureFireSnapshot = (state: WorldState): void => {
  const fireSnapshot = ensureFireSnapshot(state);
  for (let i = 0; i < state.tiles.length; i += 1) {
    fireSnapshot[i] = state.tiles[i].fire;
  }
};

const getForecastTemp = (state: WorldState): number => {
  const seedSwing = (state.seed % 7) - 3;
  const trend = Math.min(8, Math.floor((state.year - 1) * 0.6));
  return 28 + seedSwing + trend;
};

const getClimateSeasonIndex = (state: WorldState): number => {
  const yearDays = Math.max(1, VIRTUAL_YEAR_DAYS);
  const seasonLength = Math.max(1, Math.floor(yearDays / 4));
  const dayOfYear = ((Math.floor(state.careerDay) % yearDays) + yearDays) % yearDays + 1;
  return Math.min(3, Math.floor((dayOfYear - 1) / seasonLength));
};

const getClimateSeasonInfo = (state: WorldState): { label: string; start: number; end: number } => {
  const yearDays = Math.max(1, VIRTUAL_YEAR_DAYS);
  const seasonLength = Math.max(1, Math.floor(yearDays / 4));
  const seasonIndex = getClimateSeasonIndex(state);
  const start = seasonIndex * seasonLength + 1;
  const end = seasonIndex === 3 ? yearDays : (seasonIndex + 1) * seasonLength;
  return {
    label: CLIMATE_SEASONS[seasonIndex] ?? "Season",
    start,
    end
  };
};

const getPhaseSampleForCareerDay = (careerDay: number): { id: WorldState["phase"]; phaseDay: number } => {
  let remaining = ((careerDay % PHASE_YEAR_DAYS) + PHASE_YEAR_DAYS) % PHASE_YEAR_DAYS;
  for (const phase of PHASES) {
    if (remaining < phase.duration) {
      return {
        id: phase.id,
        phaseDay: remaining
      };
    }
    remaining -= phase.duration;
  }
  const fallback = PHASES[PHASES.length - 1];
  return {
    id: fallback.id,
    phaseDay: fallback.duration - 1
  };
};

const getTownCenterX = (town: WorldState["towns"][number]): number => (Number.isFinite(town.cx) ? town.cx : town.x);
const getTownCenterY = (town: WorldState["towns"][number]): number => (Number.isFinite(town.cy) ? town.cy : town.y);

const getMaxTimeSpeedIndex = (options: readonly number[]): number => Math.max(0, options.length - 1);

const getRuntimeRoadSearchBounds = (state: WorldState, start: { x: number; y: number }, end: { x: number; y: number }): RoadTileBounds => {
  const directDistance = Math.abs(start.x - end.x) + Math.abs(start.y - end.y);
  const padding = Math.max(12, Math.min(48, directDistance * 3 + 8));
  return {
    minX: Math.max(0, Math.min(start.x, end.x) - padding),
    maxX: Math.min(state.grid.cols - 1, Math.max(start.x, end.x) + padding),
    minY: Math.max(0, Math.min(start.y, end.y) - padding),
    maxY: Math.min(state.grid.rows - 1, Math.max(start.y, end.y) + padding)
  };
};

const getRuntimeRoadPathBounds = (path: readonly { x: number; y: number }[]): RoadTileBounds | null => {
  if (path.length <= 0) {
    return null;
  }
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < path.length; i += 1) {
    const point = path[i]!;
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minY) || !Number.isFinite(maxY)) {
    return null;
  }
  return { minX, maxX, minY, maxY };
};

const createRuntimeSettlementRoadAdapter = (): SettlementRoadAdapter => {
  let dirtyRoadBounds: RoadTileBounds | null = null;
  return {
    carveRoad: (nextState, start, end, options = {}) => {
      const profStartAt = profStart();
      nextState.settlementRuntimeRoadPathSearches += 1;
      const routeSeed =
        (nextState.seed ^
          Math.imul(start.x + 1, 73856093) ^
          Math.imul(start.y + 1, 19349663) ^
          Math.imul(end.x + 1, 83492791) ^
          Math.imul(end.y + 1, 2971215073 >>> 0)) >>>
        0;
      const result = carveRoadDetailed(nextState, new RuntimeRng(routeSeed), start, end, {
        ...options,
        searchBounds: getRuntimeRoadSearchBounds(nextState, start, end)
      });
      dirtyRoadBounds = mergeRoadTileBounds(dirtyRoadBounds, result.bounds);
      profEnd("runtimeRoad.carve", profStartAt);
      return result.carved;
    },
    carveRoadDetailed: (nextState, start, end, options = {}) => {
      const profStartAt = profStart();
      nextState.settlementRuntimeRoadPathSearches += 1;
      const routeSeed =
        (nextState.seed ^
          Math.imul(start.x + 1, 73856093) ^
          Math.imul(start.y + 1, 19349663) ^
          Math.imul(end.x + 1, 83492791) ^
          Math.imul(end.y + 1, 2971215073 >>> 0)) >>>
        0;
      const result = carveRoadDetailed(nextState, new RuntimeRng(routeSeed), start, end, {
        ...options,
        searchBounds: getRuntimeRoadSearchBounds(nextState, start, end)
      });
      dirtyRoadBounds = mergeRoadTileBounds(dirtyRoadBounds, result.bounds);
      profEnd("runtimeRoad.carveDetailed", profStartAt);
      return result;
    },
    carveRoadPath: (nextState, path, bridgeTileIndices = []) => {
      const profStartAt = profStart();
      if (path.length <= 0) {
        profEnd("runtimeRoad.replay", profStartAt);
        return false;
      }
      const first = path[0]!;
      const last = path[path.length - 1]!;
      const replaySeed =
        (nextState.seed ^
          Math.imul(first.x + 1, 2654435761 >>> 0) ^
          Math.imul(first.y + 1, 1597334677) ^
          Math.imul(last.x + 1, 2246822519 >>> 0) ^
          Math.imul(last.y + 1, 3266489917 >>> 0)) >>>
        0;
      const carved = carveRoadPath(nextState, new RuntimeRng(replaySeed), path, {
        allowBridgeIndices: new Set(bridgeTileIndices)
      });
      if (carved) {
        dirtyRoadBounds = mergeRoadTileBounds(dirtyRoadBounds, getRuntimeRoadPathBounds(path));
      }
      profEnd("runtimeRoad.replay", profStartAt);
      return carved;
    },
    collectConnectedRoadNeighbors,
    collectRoadTiles,
    findNearestRoadTile,
    clearRoadEdges: (nextState) => {
      dirtyRoadBounds = null;
      clearRoadEdges(nextState);
    },
    backfillRoadEdgesFromAdjacency: (nextState) => {
      const profStartAt = profStart();
      if (dirtyRoadBounds) {
        backfillRoadEdgesInBounds(nextState, dirtyRoadBounds, 2);
        dirtyRoadBounds = null;
      } else {
        backfillRoadEdgesFromAdjacency(nextState);
      }
      profEnd("runtimeRoad.backfill", profStartAt);
    },
    pruneRoadDiagonalStubs
  };
};

export const getActiveTimeSpeedOptions = (state: Pick<WorldState, "simTimeMode">): readonly number[] =>
  getTimeSpeedOptions(state.simTimeMode);

export const getActiveTimeSpeedValue = (
  state: Pick<WorldState, "simTimeMode" | "timeSpeedIndex" | "timeSpeedSliderValue" | "timeSpeedControlMode">
): number => getResolvedTimeSpeedValue(state);

export const syncActiveTimeSpeedIndex = (state: WorldState, nextIndex: number): void => {
  const options = getActiveTimeSpeedOptions(state);
  const clampedIndex = clamp(nextIndex, 0, getMaxTimeSpeedIndex(options));
  state.timeSpeedIndex = clampedIndex;
  if (state.simTimeMode === "incident") {
    state.incidentTimeSpeedIndex = clampedIndex;
  } else {
    state.strategicTimeSpeedIndex = clampedIndex;
  }
};

export const syncTimeSpeedSliderValue = (state: WorldState, nextValue: number): void => {
  state.timeSpeedSliderValue = clampTimeSpeedSliderValue(nextValue);
};

export const isSimulationEffectivelyPaused = (
  state: Pick<
    WorldState,
    "paused" | "gameOver" | "simTimeMode" | "timeSpeedIndex" | "timeSpeedSliderValue" | "timeSpeedControlMode"
  >
): boolean => isCoreSimulationEffectivelyPaused(state);

const enterIncidentMode = (state: WorldState, strategicIndexOverride?: number | null): void => {
  if (strategicIndexOverride !== undefined && strategicIndexOverride !== null) {
    state.strategicTimeSpeedIndex = clamp(strategicIndexOverride, 0, getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS));
  } else if (state.simTimeMode !== "incident") {
    state.strategicTimeSpeedIndex = clamp(state.timeSpeedIndex, 0, getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS));
  }
  state.simTimeMode = "incident";
  state.incidentTimeSpeedIndex = clamp(
    state.incidentTimeSpeedIndex,
    0,
    getMaxTimeSpeedIndex(INCIDENT_TIME_SPEED_OPTIONS)
  );
  state.timeSpeedIndex = state.incidentTimeSpeedIndex;
};

const exitIncidentMode = (state: WorldState): void => {
  if (state.simTimeMode !== "incident") {
    return;
  }
  state.incidentTimeSpeedIndex = clamp(state.timeSpeedIndex, 0, getMaxTimeSpeedIndex(INCIDENT_TIME_SPEED_OPTIONS));
  state.simTimeMode = "strategic";
  state.strategicTimeSpeedIndex = clamp(state.strategicTimeSpeedIndex, 0, getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS));
  state.timeSpeedIndex = state.strategicTimeSpeedIndex;
};

const recordLatestFireAlertFromReport = (state: WorldState, report: FireDetectionReport): void => {
  state.latestFireAlert = {
    id: report.id,
    tileX: report.tileX,
    tileY: report.tileY,
    townId: report.townId,
    year: state.year,
    careerDay: state.careerDay,
    phaseDay: state.phaseDay,
    confidence: report.confidence,
    confidenceLabel: report.confidenceLabel,
    reportState: report.state,
    source: report.source,
    message: report.message
  };
};

const clearLatestFireAlert = (state: WorldState): void => {
  state.latestFireAlert = null;
};

const restoreAdvanceToNextEventTimeControls = (
  state: WorldState,
  previousSpeedIndex?: number,
  previousSliderValue?: number
): void => {
  const advance = state.advanceToNextEvent;
  if (!advance) {
    return;
  }
  const restoredIndex = clamp(
    previousSpeedIndex ?? advance.previousTimeSpeedIndex,
    0,
    getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS)
  );
  state.strategicTimeSpeedIndex = restoredIndex;
  if (state.simTimeMode === "strategic") {
    state.timeSpeedIndex = restoredIndex;
  }
  state.timeSpeedSliderValue = clampTimeSpeedSliderValue(
    previousSliderValue ?? advance.previousTimeSpeedSliderValue
  );
  state.advanceToNextEvent = null;
};

const pauseForDetectedFireIncident = (
  state: WorldState,
  report: FireDetectionReport,
  previousSpeedIndex: number,
  previousSliderValue: number
): void => {
  recordLatestFireAlertFromReport(state, report);
  const incident = state.latestFireAlert;
  const nearestTown = incident && incident.townId >= 0
    ? state.towns.find((town) => town.id === incident.townId) ?? null
    : null;
  restoreAdvanceToNextEventTimeControls(state, previousSpeedIndex, previousSliderValue);
  enterIncidentMode(state, previousSpeedIndex);
  state.timeSpeedSliderValue = previousSliderValue;
  state.paused = true;
  if (nearestTown) {
    setStatus(state, `${incident?.message ?? `Fire incident detected near ${nearestTown.name}.`} Simulation paused.`);
  } else {
    setStatus(state, `${incident?.message ?? "Fire incident detected."} Simulation paused.`);
  }
};

const maybePauseForDetectedFireIncident = (
  state: WorldState,
  report: FireDetectionReport,
  previousSpeedIndex: number,
  previousSliderValue: number
): boolean => {
  if (!pauseOnFireEvent) {
    recordLatestFireAlertFromReport(state, report);
    return false;
  }
  pauseForDetectedFireIncident(state, report, previousSpeedIndex, previousSliderValue);
  return true;
};

const hasFireActivity = (
  state: Pick<WorldState, "fireActivityState">
): boolean => state.fireActivityState !== "idle";

const hasFireSimulationWork = (
  state: Pick<WorldState, "fireActivityState" | "fireBoundsActive" | "fireSimAccumulator">
): boolean => hasFireActivity(state) || state.fireBoundsActive || hasDeferredFireRuntimeWork(state);

const STRATEGIC_FIRE_SIM_STEP_CAP_DAYS = 0.5;

export const getStrategicFireSimulationStepCap = (state: WorldState): number | null => {
  if (state.simTimeMode !== "strategic" || state.gameOver) {
    return null;
  }
  if (hasFireSimulationWork(state)) {
    return STRATEGIC_FIRE_SIM_STEP_CAP_DAYS / Math.max(DAYS_PER_SECOND, 0.0001);
  }
  if (state.phase !== "fire" || !allowFireIgnitionEvents) {
    return null;
  }
  const weather = sampleFireWeatherResponse(state, state.careerDay);
  const fireEligibleWeather =
    weather.climateRisk >= FIRE_WEATHER_RISK_MIN || isRandomIgnitionWeatherViable(weather);
  return fireEligibleWeather ? STRATEGIC_FIRE_SIM_STEP_CAP_DAYS / Math.max(DAYS_PER_SECOND, 0.0001) : null;
};

const isGrowthWeather = (state: WorldState): boolean =>
  state.climateTemp >= GROWTH_WEATHER_TEMP_MIN &&
  state.climateTemp <= GROWTH_WEATHER_TEMP_MAX &&
  state.climateMoisture >= GROWTH_WEATHER_MOISTURE_MIN;

export const isAdvanceToNextEventAvailable = (state: WorldState): boolean =>
  !state.gameOver && state.simTimeMode === "strategic" && state.fireActivityState === "idle" && !state.advanceToNextEvent;

export const requestAdvanceToNextEvent = (state: WorldState): boolean => {
  if (!isAdvanceToNextEventAvailable(state)) {
    return false;
  }
  state.advanceToNextEvent = {
    active: true,
    previousPaused: state.paused,
    previousTimeSpeedIndex: clamp(state.strategicTimeSpeedIndex, 0, getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS)),
    previousTimeSpeedSliderValue: state.timeSpeedSliderValue,
    startedCareerDay: state.careerDay
  };
  state.paused = false;
  state.timeSpeedIndex = getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS);
  state.timeSpeedSliderValue = TIME_SPEED_SLIDER_MAX;
  setStatus(state, "Advancing to next event...");
  return true;
};

export const cancelAdvanceToNextEvent = (state: WorldState, reason?: string): void => {
  const advance = state.advanceToNextEvent;
  if (!advance) {
    return;
  }
  const restoredIndex = clamp(advance.previousTimeSpeedIndex, 0, getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS));
  state.paused = advance.previousPaused;
  state.strategicTimeSpeedIndex = restoredIndex;
  state.timeSpeedSliderValue = clampTimeSpeedSliderValue(advance.previousTimeSpeedSliderValue);
  if (state.simTimeMode === "strategic") {
    state.timeSpeedIndex = restoredIndex;
  }
  state.advanceToNextEvent = null;
  if (reason) {
    setStatus(state, reason);
  }
};

const getYearEventMessages = (year: number): string[] => YEAR_EVENTS[year] ?? [];

const extinguishSeasonCarryoverFires = (state: WorldState): void => {
  issueSquadReturnOrders(state);
  state.tiles.forEach((tile) => {
    tile.fire = 0;
    tile.heat = 0;
  });
  state.tileFire.fill(0);
  state.tileHeat.fill(0);
  state.tileBurnAge.fill(0);
  state.tileHeatRelease.fill(0);
  state.tileSuppressionWetness.fill(0);
  clearFireBlocks(state);
  state.lastActiveFires = 0;
  applyFireActivityMetrics(state, 0);
  resetFireBounds(state);
  clearLatestFireAlert(state);
};

const showSeasonOverlay = (state: WorldState): void => {
  if (state.gameOver) {
    return;
  }
  const details: string[] = [];
  const climateSeason = getClimateSeasonInfo(state);
  const seasonLabel = `${climateSeason.label} days ${climateSeason.start}-${climateSeason.end}`;
  const yearEvents = getYearEventMessages(state.year);
  if (yearEvents.length > 0) {
    details.push(...yearEvents);
  }
  if (state.phase === "growth") {
    const title = "Growth Update";
    const message = `Climate season: ${seasonLabel}. Vegetation is rebounding across the region.`;
    details.push("Observe regrowth from above.");
    details.push("Dismiss or wait to close.");
    emitOverlay({ title, message, details, action: "dismiss" });
    return;
  } else if (state.phase === "maintenance") {
    const title = "Maintenance Update";
    const message = `Climate season: ${seasonLabel}. Budget available: ${formatCurrency(state.budget)}.`;
    details.push("Recruit, train, and cut fuel breaks before fire activity builds.");
    details.push("Dismiss or wait to close.");
    emitOverlay({ title, message, details, action: "dismiss" });
    return;
  } else if (state.phase === "fire") {
    const forecast = getForecastTemp(state);
    const title = "Fire Operations";
    const message = `Climate season: ${seasonLabel}. Forecast: hot period with average temperatures around ${forecast}C.`;
    details.push("Be ready to deploy firefighters and trucks quickly.");
    details.push("Dismiss or wait to close.");
    emitOverlay({ title, message, details, action: "dismiss" });
    return;
  } else if (state.phase === "budget") {
    const forecast = getForecastTemp(state);
    const title = "Autumn Operations";
    const message = `Climate season: ${seasonLabel}. Late-season flare-ups can still run before winter shuts the year down.`;
    details.push(`Forecast easing toward ${forecast}C.`);
    details.push("Keep crews on containment and mop-up until the winter ledger closes.");
    details.push("Dismiss or wait to close.");
    emitOverlay({ title, message, details, action: "dismiss" });
    return;
  }
  details.push("Dismiss or wait to close.");
  emitOverlay({ title: "Update", message: `Climate season: ${seasonLabel}.`, details, action: "dismiss" });
};

export function extinguishAllFires(state: WorldState, effects: EffectsState): void {
  state.tiles.forEach((tile) => {
    tile.fire = 0;
    tile.heat = 0;
  });
  state.tileFire.fill(0);
  state.tileHeat.fill(0);
  state.tileBurnAge.fill(0);
  state.tileHeatRelease.fill(0);
  state.tileSuppressionWetness.fill(0);
  clearFireBlocks(state);
  effects.smokeParticles = [];
  effects.waterParticles = [];
  effects.waterStreams = [];
  state.lastActiveFires = 0;
  applyFireActivityMetrics(state, 0);
  resetFireBounds(state);
  clearLatestFireAlert(state);
}

const syncWeatherClearedFireScoringSnapshot = (state: WorldState): void => {
  captureFireSnapshot(state);
  state.scoring.prevFireBoundsActive = false;
  state.scoring.prevFireMinX = 0;
  state.scoring.prevFireMaxX = 0;
  state.scoring.prevFireMinY = 0;
  state.scoring.prevFireMaxY = 0;
  state.scoring.attributedFireLossTiles.clear();
};

const applySeasonalRainExtinguish = (state: WorldState, effects: EffectsState): void => {
  const rain = state.seasonalRain;
  if (!rain.active || rain.hasExtinguished || rain.intensity01 < SEASONAL_RAIN_EXTINGUISH_THRESHOLD) {
    return;
  }
  if (!hasFireActivity(state)) {
    return;
  }
  extinguishAllFires(state, effects);
  syncWeatherClearedFireScoringSnapshot(state);
  issueSquadReturnOrders(state);
  state.seasonalRain = {
    ...rain,
    hasExtinguished: true
  };
  setStatus(state, "Heavy autumn rain extinguished remaining fires.");
};

const maybePauseForSeasonalRainStart = (
  state: WorldState,
  previousSpeedIndex: number,
  previousSliderValue: number
): boolean => {
  const rain = state.seasonalRain;
  if (!rain.active || !rain.event || rain.hasStartPauseHandled) {
    return false;
  }
  state.seasonalRain = {
    ...rain,
    hasStartPauseHandled: true
  };
  if (!pauseOnRainEvent) {
    return false;
  }
  restoreAdvanceToNextEventTimeControls(state, previousSpeedIndex, previousSliderValue);
  state.paused = true;
  setStatus(state, "Autumn rain is moving in. Simulation paused.");
  return true;
};

export function calculateBudgetOutcome(state: WorldState): void {
  const propertyLossRatio = state.totalPropertyValue > 0 ? state.yearPropertyLost / state.totalPropertyValue : 0;
  const lifeLossRatio = state.totalPopulation > 0 ? state.yearLivesLost / state.totalPopulation : 0;
  const landLossRatio = state.totalLandTiles > 0 ? state.burnedTiles / state.totalLandTiles : 0;
  const character = getCharacterDefinition(state.campaign.characterId);
  const baseBudget = getCharacterBaseBudget(character.id, BASE_BUDGET);
  const responseScore = Math.max(0, Math.min(1, 1 - (propertyLossRatio * 0.7 + lifeLossRatio * 1.3 + landLossRatio * 0.4)));
  const containmentBonus = Math.max(0, Math.min(0.2, state.containedCount / 60 + character.modifiers.containmentBonus));
  const rating = Math.max(0, Math.min(1, responseScore + containmentBonus));
  const carryOver = Math.floor(state.budget * 0.2);
  state.pendingBudget = Math.max(0, Math.floor(baseBudget * (0.7 + state.approval * 0.8 + rating * 0.5) + carryOver));
  setStatus(
    state,
    `Budget review: approval ${Math.round(state.approval * 100)}%, rating ${Math.round(rating * 100)}%, next budget ${formatCurrency(
      state.pendingBudget
    )}.`
  );
  if (state.approval < APPROVAL_MIN) {
    endGame(state, false, "Public approval collapses. Command reassigned.");
  }
}

export function startNewYear(state: WorldState): void {
  state.budget = state.pendingBudget;
  state.yearPropertyLost = 0;
  state.yearLivesLost = 0;
  state.yearBurnedTiles = 0;
  state.containedCount = 0;
  selectUnit(state, null);
  setDeployMode(state, null);
}

const openAnnualReportForWinter = (state: WorldState): void => {
  freezeScoringSeason(state);
  extinguishSeasonCarryoverFires(state);
  calculateBudgetOutcome(state);
  if (state.gameOver) {
    return;
  }
  restoreAdvanceToNextEventTimeControls(state);
  state.annualReportOpen = true;
  state.paused = true;
  setStatus(
    state,
    `Winter maintenance begins. Review the annual ledger, then unlock ${formatCurrency(state.pendingBudget)} for the new year.`
  );
};

const resolveWinterRolloverWithoutReport = (state: WorldState): void => {
  freezeScoringSeason(state);
  extinguishSeasonCarryoverFires(state);
  calculateBudgetOutcome(state);
  if (state.gameOver) {
    return;
  }
  startNewYear(state);
  state.annualReportOpen = false;
  setStatus(
    state,
    `Maintenance season: ${formatCurrency(state.budget)} available for recruitment, training, and fuel breaks.`
  );
};

export function closeAnnualReport(state: WorldState): void {
  if (!state.annualReportOpen) {
    return;
  }
  startNewYear(state);
  state.annualReportOpen = false;
  state.paused = false;
  setStatus(
    state,
    `Maintenance season: ${formatCurrency(state.budget)} available for recruitment, training, and fuel breaks.`
  );
}

export function setPhase(state: WorldState, rng: RNG, next: WorldState["phase"], options: PhaseTransitionOptions = {}): void {
  state.phase = next;
  state.annualReportOpen = false;
  ensureClimateTimeline(state);
  updateClimateForecastWindow(state);
  updatePhaseControls(state);
  if (state.phase === "growth") {
    setStatus(state, `Year ${state.year} begins. Growth fuels the region.`);
    showSeasonOverlay(state);
    return;
  }
  if (state.phase === "maintenance") {
    if (options.openAnnualReport) {
      if (!allowAnnualReport || !pauseOnAnnualReportEvent) {
        resolveWinterRolloverWithoutReport(state);
        showSeasonOverlay(state);
        return;
      }
      openAnnualReportForWinter(state);
      return;
    }
    setStatus(state, "Maintenance season: spend budget to cut firebreaks.");
    showSeasonOverlay(state);
    return;
  }
  if (state.phase === "fire") {
    randomizeWind(state, rng);
    if (allowFireIgnitionEvents) {
      pickInitialFires(state, rng);
    }
    state.incidentTimeSpeedIndex = DEFAULT_INCIDENT_TIME_SPEED_INDEX;
    startScoringSeason(state);
    debugClimateChecks(state.seed, VIRTUAL_CLIMATE_PARAMS, DEFAULT_MOISTURE_PARAMS);
    setStatus(
      state,
      allowFireIgnitionEvents
        ? "Fire season begins. Stay ahead of the line."
        : "Fire season begins with ignition events disabled."
    );
    showSeasonOverlay(state);
    return;
  }
  setStatus(state, "Autumn operations: finish containment before winter.");
  showSeasonOverlay(state);
}

export function advancePhase(state: WorldState, rng: RNG): void {
  const current = getPhaseInfo(state.phaseIndex).id;
  if (current === "budget") {
    state.year += 1;
    if (state.year > CAREER_YEARS) {
      endGame(state, true, "Twenty years in command. The region endures.");
      return;
    }
  }
  state.phaseIndex = (state.phaseIndex + 1) % PHASES.length;
  const nextPhase = PHASES[state.phaseIndex].id;
  setPhase(state, rng, nextPhase, { openAnnualReport: current === "budget" && nextPhase === "maintenance" });
}

export function beginFireSeason(state: WorldState, rng: RNG): void {
  if (state.phase !== "maintenance") {
    return;
  }
  const fireIndex = PHASES.findIndex((entry) => entry.id === "fire");
  if (fireIndex < 0) {
    return;
  }
  state.phaseIndex = fireIndex;
  state.phaseDay = 0;
  setPhase(state, rng, "fire");
}

export function advanceCalendar(state: WorldState, rng: RNG, dayDelta: number): void {
  state.phaseDay += dayDelta;
  while (!state.gameOver) {
    const current = getPhaseInfo(state.phaseIndex);
    if (state.phaseDay < current.duration) {
      break;
    }
    state.phaseDay -= current.duration;
    advancePhase(state, rng);
  }
}

export function pickInitialFires(state: WorldState, rng: RNG): void {
  let placed = 0;
  const targetFires = state.year >= 15 ? 4 : state.year >= 10 ? 3 : state.year >= 5 ? 2 : 1;
  let minX = state.grid.cols;
  let maxX = -1;
  let minY = state.grid.rows;
  let maxY = -1;
  const primeNeighborHeat = (originX: number, originY: number): void => {
    const boost = 0.9;
    for (const offset of NEIGHBOR_DIRS) {
      const nx = originX + offset.x;
      const ny = originY + offset.y;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      const neighbor = state.tiles[nIdx];
      if (state.tileFire[nIdx] > 0 || state.tileFuel[nIdx] <= 0) {
        continue;
      }
      const nextHeat = Math.max(state.tileHeat[nIdx], neighbor.ignitionPoint * boost);
      neighbor.heat = nextHeat;
      state.tileHeat[nIdx] = nextHeat;
      markFireBlockActiveByTile(state, nIdx);
    }
  };
  const igniteTile = (tile: WorldState["tiles"][number], idx: number, x: number, y: number): void => {
    tile.fire = 0.5 + rng.next() * 0.2;
    tile.heat = Math.max(tile.heat, tile.ignitionPoint * 1.4);
    state.tileFire[idx] = tile.fire;
    state.tileHeat[idx] = tile.heat;
    markFireBlockActiveByTile(state, idx);
    placed += 1;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  };

  while (placed < targetFires) {
    const candidate = findIgnitionCandidate(state, rng, {
      maxAttempts: INITIAL_IGNITION_ATTEMPTS,
      preferredTerrainOnly: true
    });
    if (!candidate) {
      break;
    }
    igniteTile(state.tiles[candidate.idx], candidate.idx, candidate.x, candidate.y);
    primeNeighborHeat(candidate.x, candidate.y);
  }

  if (placed > 0) {
    state.fireBoundsActive = true;
    state.fireMinX = minX;
    state.fireMaxX = maxX;
    state.fireMinY = minY;
    state.fireMaxY = maxY;
    state.lastActiveFires = Math.max(state.lastActiveFires, placed);
    applyFireActivityMetrics(state, state.lastActiveFires);
  }
}

export function getBaseTile(state: WorldState): WorldState["tiles"][number] {
  return state.tiles[indexFor(state.grid, state.basePoint.x, state.basePoint.y)];
}

export function checkFailureConditions(state: WorldState): void {
  if (state.gameOver) {
    return;
  }
  const baseTile = getBaseTile(state);
  if (isBaseTileLost(baseTile)) {
    endGame(state, false, "The command base is lost.");
    return;
  }
  const propertyLossRatio = state.totalPropertyValue > 0 ? state.lostPropertyValue / state.totalPropertyValue : 0;
  const landLossRatio = state.totalLandTiles > 0 ? state.burnedTiles / state.totalLandTiles : 0;
  if (
    (state.totalHouses > 0 && state.destroyedHouses >= state.totalHouses) ||
    propertyLossRatio > 0.75 ||
    landLossRatio > 0.85
  ) {
    endGame(state, false, "The region is devastated beyond recovery.");
  }
}

export function endGame(state: WorldState, victory: boolean, reason?: string): void {
  if (state.gameOver) {
    return;
  }
  state.gameOver = true;
  state.paused = true;
  const score = Math.round(state.scoring.score);

  state.finalScore = score;
  const baseMessage =
    reason || (victory ? "Your twenty-year career leaves the region resilient." : "The region is overwhelmed.");
  const overlay = {
    title: victory ? "Career Complete" : "Command Relieved",
    message: `${baseMessage} Final score: ${score}.`,
    details: [] as string[],
    action: "restart" as const
  };
  emitOverlay(overlay);
  emitGameOver({ victory, reason: baseMessage, score, seed: state.seed });
}

export type StepSimOptions = {
  unitDelta?: number;
};

const sanitizeStepDelta = (value: number, fallback: number): number =>
  Number.isFinite(value) && value >= 0 ? value : fallback;

export function stepSim(
  state: WorldState,
  effects: EffectsState,
  rng: RNG,
  delta: number,
  options: StepSimOptions = {}
): void {
  if (state.advanceToNextEvent && state.gameOver) {
    cancelAdvanceToNextEvent(state);
  }
  if (isSimulationEffectivelyPaused(state)) {
    return;
  }
  resetStepPerfTelemetry(state);

  const dayDelta = delta * DAYS_PER_SECOND;
  const unitDelta = sanitizeStepDelta(options.unitDelta ?? delta, delta);
  const calendarDelta = dayDelta;
  const previousCareerDay = state.careerDay;
  const previousSpeedIndex = state.advanceToNextEvent
    ? clamp(state.advanceToNextEvent.previousTimeSpeedIndex, 0, getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS))
    : clamp(state.strategicTimeSpeedIndex, 0, getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS));
  const previousSliderValue = state.advanceToNextEvent
    ? clampTimeSpeedSliderValue(state.advanceToNextEvent.previousTimeSpeedSliderValue)
    : state.timeSpeedSliderValue;
  const calendarPerfStart = nowMs();
  advanceCalendar(state, rng, calendarDelta);
  advanceCareerDay(state, calendarDelta, PHASE_YEAR_DAYS, VIRTUAL_YEAR_DAYS, CAREER_TOTAL_DAYS);
  syncClimateToCareerDay(state);
  updateClimateForecastWindow(state);
  syncSeasonalRainToCareerDay(state);
  stepWaterTowers(state, dayDelta);
  stepWatchTowerConstruction(state, dayDelta);
  state.simPerfCalendarMs = nowMs() - calendarPerfStart;
  if (maybePauseForSeasonalRainStart(state, previousSpeedIndex, previousSliderValue)) {
    return;
  }
  applySeasonalRainExtinguish(state, effects);
  if (state.careerDay >= CAREER_TOTAL_DAYS && !state.gameOver) {
    endGame(state, true, "Career complete. The region passes into new hands.");
    if (state.advanceToNextEvent) {
      cancelAdvanceToNextEvent(state);
    }
    state.lastActiveFires = 0;
    applyFireActivityMetrics(state, 0);
    return;
  }
  if (state.gameOver) {
    if (state.advanceToNextEvent) {
      cancelAdvanceToNextEvent(state);
    }
    state.lastActiveFires = 0;
    applyFireActivityMetrics(state, 0);
    return;
  }
  const climateRisk = getClimateRisk(state);
  stepTownAlertPosture(state, dayDelta);
  applyEvacuationLossEvents(state, stepEvacuations(state, dayDelta));
  const townConstructionPerfStart = nowMs();
  const townConstructionProfStart = profStart();
  stepTownConstructionSchedule(state, createRuntimeSettlementRoadAdapter(), dayDelta, {
    maxEventDays: RUNTIME_CONSTRUCTION_EVENT_DAYS_PER_TICK
  });
  profEnd("townConstruction", townConstructionProfStart);
  state.simPerfTownConstructionMs = nowMs() - townConstructionPerfStart;
  const allowGrowth = state.phase === "growth" && isGrowthWeather(state);
  const allowIgnition = state.phase === "fire" && climateRisk >= FIRE_WEATHER_RISK_MIN;
  const allowFireSim = hasFireSimulationWork(state) || allowIgnition;

  if (allowGrowth) {
    const growthPerfStart = nowMs();
    const growthProfStart = profStart();
    stepGrowth(state, dayDelta, rng);
    profEnd("growthStep", growthProfStart);
    state.simPerfGrowthMs = nowMs() - growthPerfStart;
  }

  if (state.units.length > 0) {
    const unitsPerfStart = nowMs();
    autoAssignTargets(state);
    stepUnits(state, unitDelta);
    prepareExtinguish(state, effects, rng);
    applyUnitHazards(state, rng, unitDelta);
    state.simPerfUnitsMs = nowMs() - unitsPerfStart;
  }

  let activeFires = state.lastActiveFires;
  let fireActivityState = state.fireActivityState;
  state.firePerfSubsteps = 0;
  state.firePerfSimulatedDays = 0;
  state.firePerfDeferredDays = 0;
  state.firePerfTerrainMutations = 0;
  state.firePerfRangedDiffusionSamples = 0;
  state.firePerfIgniteCandidates = 0;
  if (allowFireSim) {
    const firePerfStart = nowMs();
    const maxConfiguredSubstep = Math.max(0.05, state.fireSettings.simTickSeconds || 0.05);
    state.fireSimAccumulator = Math.max(0, state.fireSimAccumulator + delta);
    const budget = resolveRuntimeWorkBudget(state, delta);
    let remaining = Math.min(state.fireSimAccumulator, budget.maxFireDeltaSeconds);
    const pendingBeforeStep = state.fireSimAccumulator;
    let careerCursor = Math.max(0, state.careerDay - pendingBeforeStep * DAYS_PER_SECOND);
    let fireSubsteps = 0;
    let fireDaysSimulated = 0;
    while (remaining > 0.0001 && fireSubsteps < budget.maxFireSubsteps) {
      const previewWeather = sampleFireWeatherResponse(state, careerCursor);
      const adaptiveSubstepDays = getAdaptiveFireSubstepMax(
        fireActivityState,
        previewWeather.climateRisk
      );
      const adaptiveSubstepDelta = adaptiveSubstepDays / Math.max(DAYS_PER_SECOND, 0.0001);
      const simDelta = Math.min(remaining, maxConfiguredSubstep, adaptiveSubstepDelta);
      const simDayDelta = simDelta * DAYS_PER_SECOND;
      const weatherCareerDay = careerCursor + simDayDelta * 0.5;
      const weather = sampleFireWeatherResponse(state, weatherCareerDay);
      const phaseSample = getPhaseSampleForCareerDay(weatherCareerDay);
      const burnoutFactor = getBurnoutFactorForRisk(weather.climateRisk);
      state.climateDay = weather.climateDayOfYear;
      state.climateYear = weather.climateYearIndex;
      state.climateTemp = weather.climateTemp;
      state.climateMoisture = weather.climateMoisture;
      state.climateIgnitionMultiplier = weather.climateIgnitionMultiplier;
      state.climateSpreadMultiplier = weather.climateSpreadMultiplier;
      stepWind(state, simDelta, rng);
      state.fireSeasonDay += simDayDelta;
      const seasonIntensity = phaseSample.id === "fire" ? getFireSeasonIntensity(phaseSample.phaseDay, state.fireSettings) : 1;
      const spreadScale = state.fireSettings.simSpeed * (0.55 + seasonIntensity * 0.45);
      if (allowFireIgnitionEvents && phaseSample.id === "fire" && isRandomIgnitionWeatherViable(weather)) {
        igniteRandomFire(state, rng, simDayDelta, clamp(weather.ignition, 0, 1.35));
        activeFires = Math.max(activeFires, state.lastActiveFires);
        fireActivityState = state.fireActivityState;
      }
      if (state.units.length > 0) {
        applyExtinguishStep(state, simDelta, weather.suppression);
      }
      activeFires = stepFire(
        state,
        effects,
        rng,
        state.simTimeMode === "incident" ? simDelta * INCIDENT_FIRE_PACING_SCALE : simDelta,
        spreadScale,
        1,
        burnoutFactor,
        weather,
        weather.climateIgnitionMultiplier,
        allowFireIgnitionEvents
      );
      fireActivityState = state.fireActivityState;
      if (weather.seasonIndex === 0 && weather.ignition < 0.04 && activeFires > 0) {
        extinguishAllFires(state, effects);
        activeFires = 0;
        fireActivityState = state.fireActivityState;
      }
      remaining -= simDelta;
      careerCursor += simDayDelta;
      fireSubsteps += 1;
      fireDaysSimulated += simDayDelta;
      state.fireSimAccumulator = Math.max(0, state.fireSimAccumulator - simDelta);
    }
    state.firePerfSubsteps = fireSubsteps;
    state.firePerfSimulatedDays = fireDaysSimulated;
    state.firePerfDeferredDays = state.fireSimAccumulator * DAYS_PER_SECOND;
    state.simPerfFireMs = nowMs() - firePerfStart;
  } else {
    state.fireSimAccumulator = 0;
    stepWind(state, delta, rng);
    applyFireActivityMetrics(state, 0);
  }
  state.lastActiveFires = activeFires;
  let fireDetection: FireDetectionStepResult = { alertReport: null, activeReportCount: 0 };
  if (hasFireActivity(state)) {
    fireDetection = stepFireDetection(state, dayDelta);
  }
  if (!hasFireActivity(state) || fireDetection.activeReportCount <= 0) {
    clearLatestFireAlert(state);
  }
  if (fireDetection.alertReport) {
    if (maybePauseForDetectedFireIncident(state, fireDetection.alertReport, previousSpeedIndex, previousSliderValue)) {
      stepParticles(state, effects, delta);
      return;
    }
  } else if (state.simTimeMode === "incident" && state.fireActivityState === "idle") {
    exitIncidentMode(state);
  }

  const scoringPerfStart = nowMs();
  stepScoring(state, dayDelta, climateRisk);
  state.simPerfScoringMs = nowMs() - scoringPerfStart;
  const particlesPerfStart = nowMs();
  stepParticles(state, effects, delta);
  state.simPerfParticlesMs = nowMs() - particlesPerfStart;
  checkFailureConditions(state);
  if (state.advanceToNextEvent && state.gameOver) {
    cancelAdvanceToNextEvent(state);
  }
  maybeReport(state);
}

export function togglePause(state: WorldState): void {
  if (state.advanceToNextEvent) {
    cancelAdvanceToNextEvent(state);
  }
  state.paused = !state.paused;
  if (state.paused) {
    setStatus(state, "Simulation paused.");
  } else {
    resetStatus(state);
  }
}

export function handleEscape(state: WorldState, inputState: InputState): void {
  if (state.selectionScope === "truck" && state.selectedTruckIds.length > 0) {
    returnToFocusedCommandUnitSelection(state);
  } else {
    selectUnit(state, null);
  }
  setDeployMode(state, null);
  inputState.placementMode = "move";
  inputState.fireTask = "suppress";
  inputState.formationStart = null;
  inputState.formationEnd = null;
  inputState.selectionBox = null;
}

export function handleDeployAction(state: WorldState, mode: WorldState["deployMode"]): void {
  setDeployMode(state, state.deployMode === mode ? null : mode);
  selectUnit(state, null);
}

export function handleUnitDeployment(state: WorldState, rng: RNG, tileX: number, tileY: number): void {
  if (state.deployMode === "firefighter" || state.deployMode === "truck") {
    deployUnit(state, rng, state.deployMode, tileX, tileY);
  }
}

export function handleUnitRetask(state: WorldState, tileX: number, tileY: number): void {
  if (state.selectedUnitIds.length === 0) {
    return;
  }
  const selectedUnits = state.units.filter((unit) => unit.selected);
  const selectedTrucks = selectedUnits.filter((unit) => unit.kind === "truck");

  if (selectedTrucks.length > 0) {
    selectedTrucks.forEach((unit) => {
      setUnitTarget(state, unit, tileX, tileY, true);
    });
    return;
  }

  // If only firefighters are selected, which shouldn't happen with the new UI changes,
  // show a single message instead of trying to command them.
  if (selectedUnits.every((unit) => unit.kind === "firefighter")) {
    setStatus(state, "Firefighters are controlled by their truck. Move the truck to reposition the crew.");
  }
}

export function handleClearLine(state: WorldState, rng: RNG, start: { x: number; y: number }, end: { x: number; y: number }): void {
  clearFuelLine(state, rng, start, end);
}

