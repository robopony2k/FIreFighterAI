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
import { setStatus, resetStatus } from "../core/state.js";
import { maybeReport } from "./prof.js";
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
import { stepGrowth, stepTownSeasonScaling } from "./growth.js";
import { stepTownAlertPosture } from "./towns.js";
import { stepParticles } from "./particles.js";
import { freezeScoringSeason, startScoringSeason, stepScoring } from "./scoring.js";
import {
  applyExtinguishStep,
  applyUnitHazards,
  autoAssignTargets,
  clearFuelLine,
  deployUnit,
  prepareExtinguish,
  returnToFocusedCommandUnitSelection,
  seedStartingRoster,
  selectUnit,
  setDeployMode,
  setUnitTarget,
  stepUnits
} from "./units.js";
import { getAdaptiveFireSubstepMax, getBurnoutFactorForRisk, sampleFireWeatherResponse } from "./fire/fireWeather.js";
import type { InputState } from "../core/inputState.js";
import type { EffectsState } from "../core/effectsState.js";
export { updatePhaseControls };

const FIRE_HEAT_PADDING = 8;
const YEAR_EVENTS: Record<number, string[]> = {};

const FORECAST_WINDOW_DAYS = 90;
const PHASE_YEAR_DAYS = PHASES.reduce((sum, phase) => sum + phase.duration, 0);
const VIRTUAL_YEAR_DAYS = Math.max(1, Math.floor(VIRTUAL_CLIMATE_PARAMS.seasonLen));
const CAREER_TOTAL_DAYS = VIRTUAL_YEAR_DAYS * CAREER_YEARS;
const CLIMATE_SEASONS = ["Winter", "Spring", "Summer", "Autumn"];

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
    risk: Array.from({ length: FORECAST_WINDOW_DAYS }, () => 0)
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
  state.climateForecastDay = clamp(currentDay - windowStart, 0, FORECAST_WINDOW_DAYS - 1);
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

const findStrongestFireTile = (state: WorldState): { x: number; y: number } | null => {
  if (state.lastActiveFires <= 0 && !state.fireBoundsActive) {
    return null;
  }
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const minX = state.fireBoundsActive ? Math.max(0, state.fireMinX) : 0;
  const maxX = state.fireBoundsActive ? Math.min(cols - 1, state.fireMaxX) : cols - 1;
  const minY = state.fireBoundsActive ? Math.max(0, state.fireMinY) : 0;
  const maxY = state.fireBoundsActive ? Math.min(rows - 1, state.fireMaxY) : rows - 1;
  let bestScore = 0;
  let best: { x: number; y: number } | null = null;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const fire = state.tileFire[idx] ?? 0;
      if (fire <= 0) {
        continue;
      }
      const heat = state.tileHeat[idx] ?? 0;
      const score = fire * 2 + heat * 0.15;
      if (score > bestScore || !best) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
};

const resolveNearestTownIdForTile = (state: WorldState, x: number, y: number): number => {
  if (state.towns.length === 0) {
    return -1;
  }
  let bestTownId = -1;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const town of state.towns) {
    const dx = x - getTownCenterX(town);
    const dy = y - getTownCenterY(town);
    const distSq = dx * dx + dy * dy;
    if (distSq < bestDistSq || (distSq === bestDistSq && (bestTownId < 0 || town.id < bestTownId))) {
      bestDistSq = distSq;
      bestTownId = town.id;
    }
  }
  return bestTownId;
};

const recordLatestFireAlert = (state: WorldState, tileX: number, tileY: number): void => {
  state.latestFireAlert = {
    id: state.nextFireAlertId++,
    tileX,
    tileY,
    townId: resolveNearestTownIdForTile(state, tileX, tileY),
    year: state.year,
    careerDay: state.careerDay,
    phaseDay: state.phaseDay
  };
};

const clearLatestFireAlert = (state: WorldState): void => {
  state.latestFireAlert = null;
};

const hasActiveOrScheduledFire = (
  state: Pick<WorldState, "lastActiveFires" | "fireScheduledCount">
): boolean => state.lastActiveFires > 0 || state.fireScheduledCount > 0;

const hasFireSimulationWork = (
  state: Pick<WorldState, "lastActiveFires" | "fireBoundsActive" | "fireScheduledCount">
): boolean => hasActiveOrScheduledFire(state) || state.fireBoundsActive;

const isGrowthWeather = (state: WorldState): boolean =>
  state.climateTemp >= GROWTH_WEATHER_TEMP_MIN &&
  state.climateTemp <= GROWTH_WEATHER_TEMP_MAX &&
  state.climateMoisture >= GROWTH_WEATHER_MOISTURE_MIN;

export const isSkipToNextFireAvailable = (state: WorldState): boolean =>
  !state.gameOver && state.simTimeMode === "strategic" && !hasActiveOrScheduledFire(state) && !state.skipToNextFire;

export const requestSkipToNextFire = (state: WorldState): boolean => {
  if (!isSkipToNextFireAvailable(state)) {
    return false;
  }
  state.skipToNextFire = {
    active: true,
    previousPaused: state.paused,
    previousTimeSpeedIndex: clamp(state.strategicTimeSpeedIndex, 0, getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS)),
    previousTimeSpeedSliderValue: state.timeSpeedSliderValue,
    startedCareerDay: state.careerDay
  };
  state.paused = false;
  state.timeSpeedIndex = getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS);
  state.timeSpeedSliderValue = TIME_SPEED_SLIDER_MAX;
  setStatus(state, "Seeking next fire incident...");
  return true;
};

export const cancelSkipToNextFire = (state: WorldState, reason?: string): void => {
  const skip = state.skipToNextFire;
  if (!skip) {
    return;
  }
  const restoredIndex = clamp(skip.previousTimeSpeedIndex, 0, getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS));
  state.paused = skip.previousPaused;
  state.strategicTimeSpeedIndex = restoredIndex;
  state.timeSpeedSliderValue = clampTimeSpeedSliderValue(skip.previousTimeSpeedSliderValue);
  if (state.simTimeMode === "strategic") {
    state.timeSpeedIndex = restoredIndex;
  }
  state.skipToNextFire = null;
  if (reason) {
    setStatus(state, reason);
  }
};

const getYearEventMessages = (year: number): string[] => YEAR_EVENTS[year] ?? [];

const extinguishSeasonCarryoverFires = (state: WorldState): void => {
  state.tiles.forEach((tile) => {
    tile.fire = 0;
    tile.heat = 0;
  });
  state.tileFire.fill(0);
  state.tileHeat.fill(0);
  state.tileSuppressionWetness.fill(0);
  state.tileIgniteAt.fill(Number.POSITIVE_INFINITY);
  state.fireScheduledCount = 0;
  clearFireBlocks(state);
  state.lastActiveFires = 0;
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
    const message = `Climate season: ${seasonLabel}. Holdover fires can still run before winter shuts the year down.`;
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
  state.tileSuppressionWetness.fill(0);
  state.tileIgniteAt.fill(Number.POSITIVE_INFINITY);
  state.fireScheduledCount = 0;
  clearFireBlocks(state);
  effects.smokeParticles = [];
  effects.waterParticles = [];
  effects.waterStreams = [];
  state.lastActiveFires = 0;
  resetFireBounds(state);
  clearLatestFireAlert(state);
}

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
  state.annualReportOpen = true;
  state.paused = true;
  setStatus(
    state,
    `Winter maintenance begins. Review the annual ledger, then unlock ${formatCurrency(state.pendingBudget)} for the new year.`
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
      openAnnualReportForWinter(state);
      return;
    }
    setStatus(state, "Maintenance season: spend budget to cut firebreaks.");
    showSeasonOverlay(state);
    return;
  }
  if (state.phase === "fire") {
    randomizeWind(state, rng);
    pickInitialFires(state, rng);
    state.incidentTimeSpeedIndex = DEFAULT_INCIDENT_TIME_SPEED_INDEX;
    startScoringSeason(state);
    debugClimateChecks(state.seed, VIRTUAL_CLIMATE_PARAMS, DEFAULT_MOISTURE_PARAMS);
    setStatus(state, "Fire season begins. Stay ahead of the line.");
    showSeasonOverlay(state);
    return;
  }
  setStatus(state, "Autumn operations: contain holdover fires before winter.");
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

export function stepSim(state: WorldState, effects: EffectsState, rng: RNG, delta: number): void {
  if (state.skipToNextFire && state.gameOver) {
    cancelSkipToNextFire(state);
  }
  if (isSimulationEffectivelyPaused(state)) {
    return;
  }

  const dayDelta = delta * DAYS_PER_SECOND;
  const calendarDelta = dayDelta;
  const previousCareerDay = state.careerDay;
  advanceCalendar(state, rng, calendarDelta);
  advanceCareerDay(state, calendarDelta, PHASE_YEAR_DAYS, VIRTUAL_YEAR_DAYS, CAREER_TOTAL_DAYS);
  syncClimateToCareerDay(state);
  updateClimateForecastWindow(state);
  if (state.careerDay >= CAREER_TOTAL_DAYS && !state.gameOver) {
    endGame(state, true, "Career complete. The region passes into new hands.");
    if (state.skipToNextFire) {
      cancelSkipToNextFire(state);
    }
    state.lastActiveFires = 0;
    return;
  }
  if (state.gameOver) {
    if (state.skipToNextFire) {
      cancelSkipToNextFire(state);
    }
    state.lastActiveFires = 0;
    return;
  }
  const hadFireChainRisk = hasActiveOrScheduledFire(state);
  const climateRisk = getClimateRisk(state);
  stepTownSeasonScaling(state);
  stepTownAlertPosture(state, dayDelta);
  const allowGrowth = state.phase === "growth" && isGrowthWeather(state);
  const allowIgnition = state.phase === "fire" && climateRisk >= FIRE_WEATHER_RISK_MIN;
  const allowFireSim = hasFireSimulationWork(state) || allowIgnition;

  if (allowGrowth) {
    stepGrowth(state, dayDelta, rng);
  }

  if (state.units.length > 0) {
    autoAssignTargets(state);
    stepUnits(state, delta);
    prepareExtinguish(state, effects, rng);
    applyUnitHazards(state, rng, delta);
  }

  let activeFires = state.lastActiveFires;
  state.fireSimAccumulator = 0;
  state.firePerfSubsteps = 0;
  state.firePerfSimulatedDays = 0;
  if (allowFireSim) {
    const maxConfiguredSubstep = Math.max(0.05, state.fireSettings.simTickSeconds || 0.05);
    let remaining = delta;
    let careerCursor = previousCareerDay;
    let fireSubsteps = 0;
    let fireDaysSimulated = 0;
    while (remaining > 0.0001) {
      const previewWeather = sampleFireWeatherResponse(state, careerCursor);
      const adaptiveSubstepDays = getAdaptiveFireSubstepMax(
        activeFires,
        state.fireScheduledCount,
        state.fireBoundsActive,
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
      if (phaseSample.id === "fire" && weather.climateRisk >= FIRE_WEATHER_RISK_MIN) {
        igniteRandomFire(state, rng, simDayDelta, clamp(weather.ignition, 0, 1.35));
      }
      if (state.units.length > 0) {
        applyExtinguishStep(state, simDelta, weather.suppression);
      }
      activeFires = stepFire(
        state,
        effects,
        rng,
        simDelta,
        spreadScale,
        1,
        burnoutFactor,
        weather,
        weather.climateIgnitionMultiplier
      );
      if (weather.seasonIndex === 0 && weather.ignition < 0.04 && activeFires > 0) {
        extinguishAllFires(state, effects);
        activeFires = 0;
      }
      remaining -= simDelta;
      careerCursor += simDayDelta;
      fireSubsteps += 1;
      fireDaysSimulated += simDayDelta;
    }
    state.firePerfSubsteps = fireSubsteps;
    state.firePerfSimulatedDays = fireDaysSimulated;
  } else {
    stepWind(state, delta, rng);
  }
  state.lastActiveFires = activeFires;
  const hasActiveOrScheduledFireAfterStep = hasActiveOrScheduledFire(state);
  if (!hasActiveOrScheduledFireAfterStep) {
    clearLatestFireAlert(state);
  }
  if (!hadFireChainRisk && activeFires > 0) {
    const strongest = findStrongestFireTile(state);
    if (strongest) {
      recordLatestFireAlert(state, strongest.x, strongest.y);
      const previousSpeedIndex = state.skipToNextFire
        ? clamp(state.skipToNextFire.previousTimeSpeedIndex, 0, getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS))
        : clamp(state.strategicTimeSpeedIndex, 0, getMaxTimeSpeedIndex(TIME_SPEED_OPTIONS));
      const previousSliderValue = state.skipToNextFire
        ? clampTimeSpeedSliderValue(state.skipToNextFire.previousTimeSpeedSliderValue)
        : state.timeSpeedSliderValue;
      const incident = state.latestFireAlert;
      const nearestTown = incident && incident.townId >= 0
        ? state.towns.find((town) => town.id === incident.townId) ?? null
        : null;
      enterIncidentMode(state, previousSpeedIndex);
      state.timeSpeedSliderValue = previousSliderValue;
      state.paused = true;
      state.skipToNextFire = null;
      if (nearestTown) {
        setStatus(state, `Fire incident detected near ${nearestTown.name}. Simulation paused.`);
      } else {
        setStatus(state, "Fire incident detected. Simulation paused.");
      }
    }
  } else if (state.simTimeMode === "incident" && activeFires <= 0) {
    exitIncidentMode(state);
  }

  stepScoring(state, dayDelta, climateRisk);
  stepParticles(state, effects, delta);
  checkFailureConditions(state);
  if (state.skipToNextFire && state.gameOver) {
    cancelSkipToNextFire(state);
  }
  maybeReport(state);
}

export function togglePause(state: WorldState): void {
  if (state.skipToNextFire) {
    cancelSkipToNextFire(state);
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

