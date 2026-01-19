import { APPROVAL_MIN, BASE_BUDGET, CAREER_YEARS, DAYS_PER_SECOND, FIRE_WEATHER_BURNOUT_RISK, FIRE_WEATHER_RISK_MIN, GROWTH_WEATHER_MOISTURE_MIN, GROWTH_WEATHER_TEMP_MAX, GROWTH_WEATHER_TEMP_MIN, HECTARES_PER_TILE } from "../core/config.js";
import { formatCurrency } from "../core/utils.js";
import { getDayNightFactor, getFireSeasonIntensity, getPhaseInfo, PHASES } from "../core/time.js";
import { setStatus, resetStatus } from "../core/state.js";
import { inBounds, indexFor } from "../core/grid.js";
import { NEIGHBOR_DIRS } from "../core/config.js";
import { getCharacterBaseBudget, getCharacterDefinition } from "../core/characters.js";
import { ambientTemp, clamp, buildClimateTimeline, CLIMATE_IGNITION_MAX, CLIMATE_IGNITION_MIN, debugClimateChecks, DEFAULT_MOISTURE_PARAMS, moistureStep, VIRTUAL_CLIMATE_PARAMS } from "../core/climate.js";
import { randomizeWind, stepWind } from "./wind.js";
import { igniteRandomFire, resetFireBounds, stepFire } from "./fire.js";
import { stepGrowth } from "./growth.js";
import { stepParticles } from "./particles.js";
import { applyExtinguish, applyUnitHazards, autoAssignTargets, clearFuelLine, deployUnit, selectUnit, setDeployMode, setUnitTarget, stepUnits } from "./units.js";
const FIRE_HEAT_PADDING = 8;
const YEAR_EVENTS = {};
const FORECAST_WINDOW_DAYS = 90;
const PHASE_YEAR_DAYS = PHASES.reduce((sum, phase) => sum + phase.duration, 0);
const VIRTUAL_YEAR_DAYS = Math.max(1, Math.floor(VIRTUAL_CLIMATE_PARAMS.seasonLen));
const CAREER_TOTAL_DAYS = VIRTUAL_YEAR_DAYS * CAREER_YEARS;
const CLIMATE_SEASONS = ["Winter", "Spring", "Summer", "Autumn"];
const CLIMATE_SPREAD_BASE = 0.6;
const CLIMATE_SPREAD_RANGE = 1.4;
const CLIMATE_RISK_WEIGHT_IGNITION = 0.55;
const CLIMATE_RISK_WEIGHT_SPREAD = 0.45;
const ensureClimateTimeline = (state) => {
    if (state.climateTimeline && state.climateTimelineSeed === state.seed) {
        return;
    }
    state.climateTimeline = buildClimateTimeline(state.seed, CAREER_YEARS, VIRTUAL_CLIMATE_PARAMS, DEFAULT_MOISTURE_PARAMS);
    state.climateTimelineSeed = state.seed;
    state.climateForecast = {
        days: FORECAST_WINDOW_DAYS,
        temps: [],
        risk: Array.from({ length: FORECAST_WINDOW_DAYS }, () => 0)
    };
    state.climateForecastStart = -1;
    state.climateForecastDay = 0;
};
const updateClimateForDay = (state, seasonDay, yearIndex = Math.max(0, state.year - 1)) => {
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
const getClimateRisk = (state) => {
    const ignitionRange = Math.max(0.0001, CLIMATE_IGNITION_MAX - CLIMATE_IGNITION_MIN);
    const ignitionNorm = clamp((state.climateIgnitionMultiplier - CLIMATE_IGNITION_MIN) / ignitionRange, 0, 1);
    const spreadNorm = clamp((state.climateSpreadMultiplier - CLIMATE_SPREAD_BASE) / CLIMATE_SPREAD_RANGE, 0, 1);
    return clamp(CLIMATE_RISK_WEIGHT_IGNITION * ignitionNorm + CLIMATE_RISK_WEIGHT_SPREAD * spreadNorm, 0, 1);
};
const advanceCareerDay = (state, calendarDelta) => {
    if (!Number.isFinite(calendarDelta) || calendarDelta <= 0) {
        return;
    }
    const scale = PHASE_YEAR_DAYS > 0 ? VIRTUAL_YEAR_DAYS / PHASE_YEAR_DAYS : 1;
    state.careerDay = Math.min(state.careerDay + calendarDelta * scale, CAREER_TOTAL_DAYS);
};
const syncClimateToCareerDay = (state) => {
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
const updateClimateForecastWindow = (state) => {
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
const ensureFireSnapshot = (state) => {
    if (state.fireSnapshot.length !== state.grid.totalTiles) {
        state.fireSnapshot = new Float32Array(state.grid.totalTiles);
    }
    return state.fireSnapshot;
};
const captureFireSnapshot = (state) => {
    const fireSnapshot = ensureFireSnapshot(state);
    for (let i = 0; i < state.tiles.length; i += 1) {
        fireSnapshot[i] = state.tiles[i].fire;
    }
};
const getForecastTemp = (state) => {
    const seedSwing = (state.seed % 7) - 3;
    const trend = Math.min(8, Math.floor((state.year - 1) * 0.6));
    return 28 + seedSwing + trend;
};
const getClimateSeasonIndex = (state) => {
    const yearDays = Math.max(1, VIRTUAL_YEAR_DAYS);
    const seasonLength = Math.max(1, Math.floor(yearDays / 4));
    const dayOfYear = ((Math.floor(state.careerDay) % yearDays) + yearDays) % yearDays + 1;
    return Math.min(3, Math.floor((dayOfYear - 1) / seasonLength));
};
const getClimateSeasonInfo = (state) => {
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
const isGrowthWeather = (state) => state.climateTemp >= GROWTH_WEATHER_TEMP_MIN &&
    state.climateTemp <= GROWTH_WEATHER_TEMP_MAX &&
    state.climateMoisture >= GROWTH_WEATHER_MOISTURE_MIN;
const getYearEventMessages = (year) => YEAR_EVENTS[year] ?? [];
const showSeasonOverlay = (state) => {
    if (state.gameOver) {
        return;
    }
    const details = [];
    const climateSeason = getClimateSeasonInfo(state);
    const seasonLabel = `${climateSeason.label} days ${climateSeason.start}-${climateSeason.end}`;
    const yearEvents = getYearEventMessages(state.year);
    if (yearEvents.length > 0) {
        details.push(...yearEvents);
    }
    if (state.phase === "growth") {
        state.overlayTitle = "Growth Update";
        state.overlayMessage = `Climate season: ${seasonLabel}. Vegetation is rebounding across the region.`;
        details.push("Observe regrowth from above.");
    }
    else if (state.phase === "maintenance") {
        state.overlayTitle = "Maintenance Update";
        state.overlayMessage = `Climate season: ${seasonLabel}. Budget available: ${formatCurrency(state.budget)}.`;
        details.push("Recruit, train, and cut fuel breaks before fire activity builds.");
    }
    else if (state.phase === "fire") {
        const forecast = getForecastTemp(state);
        state.overlayTitle = "Fire Operations";
        state.overlayMessage = `Climate season: ${seasonLabel}. Forecast: hot period with average temperatures around ${forecast}C.`;
        details.push("Be ready to deploy firefighters and trucks quickly.");
    }
    else if (state.phase === "budget") {
        const housesSaved = Math.max(0, state.totalHouses - state.destroyedHouses);
        const burnedHectares = Math.round(state.yearBurnedTiles * HECTARES_PER_TILE);
        state.overlayTitle = "Budget Review";
        state.overlayMessage = `Climate season: ${seasonLabel}. Annual performance review and scorecard.`;
        details.push(`Approval rating: ${Math.round(state.approval * 100)}%.`);
        details.push(`Houses saved: ${housesSaved}/${state.totalHouses}.`);
        details.push(`Land burned: ${burnedHectares} ha.`);
        details.push(`Lives lost: ${state.yearLivesLost}.`);
        details.push("Politics & lobbying: placeholder.");
    }
    details.push("Dismiss or wait to close.");
    state.overlayDetails = details;
    state.overlayAction = "dismiss";
    state.overlayVisible = true;
};
export function updatePhaseControls(state) {
    const fireActive = state.phase === "fire";
    const maintenanceActive = state.phase === "maintenance";
    if (!fireActive && (state.deployMode === "firefighter" || state.deployMode === "truck")) {
        state.deployMode = null;
    }
    if (!maintenanceActive && state.deployMode === "clear") {
        state.deployMode = null;
    }
    if (!fireActive) {
        selectUnit(state, null);
    }
}
export function extinguishAllFires(state) {
    state.tiles.forEach((tile) => {
        tile.fire = 0;
        tile.heat = 0;
    });
    state.tileFire.fill(0);
    state.tileHeat.fill(0);
    state.tileIgniteAt.fill(Number.POSITIVE_INFINITY);
    state.smokeParticles = [];
    state.waterParticles = [];
    state.lastActiveFires = 0;
    resetFireBounds(state);
}
export function calculateBudgetOutcome(state) {
    const propertyLossRatio = state.totalPropertyValue > 0 ? state.yearPropertyLost / state.totalPropertyValue : 0;
    const lifeLossRatio = state.totalPopulation > 0 ? state.yearLivesLost / state.totalPopulation : 0;
    const landLossRatio = state.totalLandTiles > 0 ? state.burnedTiles / state.totalLandTiles : 0;
    const character = getCharacterDefinition(state.campaign.characterId);
    const baseBudget = getCharacterBaseBudget(character.id, BASE_BUDGET);
    const responseScore = Math.max(0, Math.min(1, 1 - (propertyLossRatio * 0.7 + lifeLossRatio * 1.3 + landLossRatio * 0.4)));
    const containmentBonus = Math.max(0, Math.min(0.2, state.containedCount / 60 + character.modifiers.containmentBonus));
    const rating = Math.max(0, Math.min(1, responseScore + containmentBonus));
    const previousApproval = state.approval;
    const retention = Math.max(0.45, Math.min(0.85, 0.65 * character.modifiers.approvalRetentionMultiplier));
    const ratingWeight = 1 - retention;
    state.approval = Math.max(0, Math.min(1, state.approval * retention + rating * ratingWeight));
    const carryOver = Math.floor(state.budget * 0.2);
    state.pendingBudget = Math.max(0, Math.floor(baseBudget * (0.7 + state.approval * 0.8 + rating * 0.5) + carryOver));
    state.careerScore += Math.floor(rating * 900 + (1 - propertyLossRatio) * 400 + (1 - lifeLossRatio) * 600);
    setStatus(state, `Budget review: approval ${Math.round(previousApproval * 100)}% -> ${Math.round(state.approval * 100)}%, next budget ${formatCurrency(state.pendingBudget)}.`);
    if (state.approval < APPROVAL_MIN) {
        endGame(state, false, "Public approval collapses. Command reassigned.");
    }
}
export function startNewYear(state) {
    state.budget = state.pendingBudget;
    state.yearPropertyLost = 0;
    state.yearLivesLost = 0;
    state.yearBurnedTiles = 0;
    state.containedCount = 0;
    selectUnit(state, null);
    setDeployMode(state, null);
}
export function setPhase(state, rng, next) {
    state.phase = next;
    ensureClimateTimeline(state);
    updateClimateForecastWindow(state);
    updatePhaseControls(state);
    if (state.phase === "growth") {
        startNewYear(state);
        setStatus(state, `Year ${state.year} begins. Growth fuels the region.`);
        showSeasonOverlay(state);
        return;
    }
    if (state.phase === "maintenance") {
        setStatus(state, "Maintenance season: spend budget to cut firebreaks.");
        showSeasonOverlay(state);
        return;
    }
    if (state.phase === "fire") {
        randomizeWind(state, rng);
        pickInitialFires(state, rng);
        debugClimateChecks(state.seed, VIRTUAL_CLIMATE_PARAMS, DEFAULT_MOISTURE_PARAMS);
        captureFireSnapshot(state);
        setStatus(state, "Fire season begins. Stay ahead of the line.");
        showSeasonOverlay(state);
        return;
    }
    calculateBudgetOutcome(state);
    showSeasonOverlay(state);
}
export function advancePhase(state, rng) {
    const current = getPhaseInfo(state.phaseIndex).id;
    if (current === "budget") {
        state.year += 1;
        if (state.year > CAREER_YEARS) {
            endGame(state, true, "Twenty years in command. The region endures.");
            return;
        }
    }
    state.phaseIndex = (state.phaseIndex + 1) % PHASES.length;
    setPhase(state, rng, PHASES[state.phaseIndex].id);
}
export function beginFireSeason(state, rng) {
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
export function advanceCalendar(state, rng, dayDelta) {
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
export function pickInitialFires(state, rng) {
    let attempts = 0;
    let placed = 0;
    const targetFires = state.year >= 15 ? 4 : state.year >= 10 ? 3 : state.year >= 5 ? 2 : 1;
    let minX = state.grid.cols;
    let maxX = -1;
    let minY = state.grid.rows;
    let maxY = -1;
    const primeNeighborHeat = (originX, originY) => {
        const boost = 0.9;
        for (const offset of NEIGHBOR_DIRS) {
            const nx = originX + offset.x;
            const ny = originY + offset.y;
            if (!inBounds(state.grid, nx, ny)) {
                continue;
            }
            const neighbor = state.tiles[indexFor(state.grid, nx, ny)];
            if (neighbor.fire > 0 || neighbor.fuel <= 0) {
                continue;
            }
            neighbor.heat = Math.max(neighbor.heat, neighbor.ignitionPoint * boost);
        }
    };
    const isBlockedType = (tile) => tile.type === "water" || tile.type === "base" || tile.type === "ash" || tile.type === "firebreak" || tile.type === "road";
    const canIgnite = (tile) => tile.fire === 0 && tile.fuel > 0 && !isBlockedType(tile);
    const igniteTile = (tile, x, y) => {
        tile.fire = 0.5 + rng.next() * 0.2;
        tile.heat = Math.max(tile.heat, tile.ignitionPoint * 1.4);
        placed += 1;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
    };
    while (placed < targetFires && attempts < 300) {
        attempts += 1;
        const x = Math.floor(rng.next() * state.grid.cols);
        const y = Math.floor(rng.next() * state.grid.rows);
        const idx = indexFor(state.grid, x, y);
        const tile = state.tiles[idx];
        if (tile.type === "forest" || tile.type === "grass") {
            const dist = Math.hypot(x - state.basePoint.x, y - state.basePoint.y);
            if (dist > 8 && canIgnite(tile)) {
                igniteTile(tile, x, y);
                primeNeighborHeat(x, y);
            }
        }
    }
    if (placed < targetFires) {
        for (let y = 0; y < state.grid.rows && placed < targetFires; y += 1) {
            for (let x = 0; x < state.grid.cols && placed < targetFires; x += 1) {
                const idx = indexFor(state.grid, x, y);
                const tile = state.tiles[idx];
                if (!canIgnite(tile)) {
                    continue;
                }
                const dist = Math.hypot(x - state.basePoint.x, y - state.basePoint.y);
                if (dist < 3) {
                    continue;
                }
                igniteTile(tile, x, y);
                primeNeighborHeat(x, y);
            }
        }
    }
    if (placed > 0) {
        state.fireBoundsActive = true;
        state.fireMinX = minX;
        state.fireMaxX = maxX;
        state.fireMinY = minY;
        state.fireMaxY = maxY;
    }
}
export function getBaseTile(state) {
    return state.tiles[indexFor(state.grid, state.basePoint.x, state.basePoint.y)];
}
export function checkFailureConditions(state) {
    if (state.gameOver) {
        return;
    }
    const baseTile = getBaseTile(state);
    if (baseTile.fire > 0 || baseTile.type === "ash") {
        endGame(state, false, "The command base is lost.");
        return;
    }
    const propertyLossRatio = state.totalPropertyValue > 0 ? state.lostPropertyValue / state.totalPropertyValue : 0;
    const landLossRatio = state.totalLandTiles > 0 ? state.burnedTiles / state.totalLandTiles : 0;
    if ((state.totalHouses > 0 && state.destroyedHouses >= state.totalHouses) ||
        propertyLossRatio > 0.75 ||
        landLossRatio > 0.85) {
        endGame(state, false, "The region is devastated beyond recovery.");
    }
}
export function endGame(state, victory, reason) {
    if (state.gameOver) {
        return;
    }
    state.gameOver = true;
    state.paused = true;
    const approvalBonus = Math.floor(state.approval * 500);
    const budgetBonus = Math.floor(state.budget * 0.5);
    const score = Math.max(0, Math.floor(state.careerScore + approvalBonus + budgetBonus));
    state.finalScore = score;
    state.overlayVisible = true;
    state.overlayTitle = victory ? "Career Complete" : "Command Relieved";
    const baseMessage = reason || (victory ? "Your twenty-year career leaves the region resilient." : "The region is overwhelmed.");
    state.overlayMessage = `${baseMessage} Final score: ${score}.`;
    state.overlayDetails = [];
    state.overlayAction = "restart";
    state.scoreSubmitted = false;
    state.leaderboardDirty = true;
}
export function stepSim(state, rng, delta) {
    if (state.paused || state.gameOver) {
        return;
    }
    const dayDelta = delta * DAYS_PER_SECOND;
    const calendarDelta = dayDelta;
    advanceCalendar(state, rng, calendarDelta);
    advanceCareerDay(state, calendarDelta);
    syncClimateToCareerDay(state);
    updateClimateForecastWindow(state);
    if (state.careerDay >= CAREER_TOTAL_DAYS && !state.gameOver) {
        endGame(state, true, "Career complete. The region passes into new hands.");
        state.lastActiveFires = 0;
        return;
    }
    if (state.gameOver) {
        state.lastActiveFires = 0;
        return;
    }
    const climateRisk = getClimateRisk(state);
    const allowGrowth = state.phase === "growth" && isGrowthWeather(state);
    const allowIgnition = state.phase === "fire" && climateRisk >= FIRE_WEATHER_RISK_MIN;
    const allowFireSim = state.lastActiveFires > 0 || state.fireBoundsActive || allowIgnition;
    const burnoutFactor = climateRisk < FIRE_WEATHER_BURNOUT_RISK
        ? clamp(1 - climateRisk / Math.max(0.0001, FIRE_WEATHER_BURNOUT_RISK), 0, 1)
        : 0;
    if (allowGrowth) {
        stepGrowth(state, dayDelta, rng);
    }
    if (state.units.length > 0) {
        autoAssignTargets(state);
        stepUnits(state, delta);
        applyExtinguish(state, rng, delta);
        applyUnitHazards(state, rng, delta);
    }
    stepWind(state, delta, rng);
    let activeFires = state.lastActiveFires;
    if (allowFireSim) {
        const simTickSeconds = Math.max(0, state.fireSettings.simTickSeconds);
        state.fireSimAccumulator = Math.min(state.fireSimAccumulator + delta, simTickSeconds * 2);
        const simDelta = Math.min(state.fireSimAccumulator, simTickSeconds);
        if (simDelta > 0) {
            const simDayDelta = simDelta * DAYS_PER_SECOND;
            state.fireSeasonDay += simDayDelta;
            captureFireSnapshot(state);
            const dayFactor = getDayNightFactor(state.careerDay, state.fireSettings);
            const seasonDay = state.phase === "fire" ? state.phaseDay : state.fireSeasonDay;
            const seasonIntensity = getFireSeasonIntensity(seasonDay, state.fireSettings);
            const spreadScale = state.fireSettings.simSpeed * (0.55 + seasonIntensity * 0.45);
            const ignitionIntensity = dayFactor * climateRisk * state.climateIgnitionMultiplier;
            if (allowIgnition) {
                igniteRandomFire(state, rng, simDayDelta, ignitionIntensity);
            }
            activeFires = stepFire(state, rng, simDelta, spreadScale, dayFactor, burnoutFactor);
            state.fireSimAccumulator = Math.max(0, state.fireSimAccumulator - simDelta);
        }
        else {
            activeFires = state.lastActiveFires;
        }
    }
    else {
        state.fireSimAccumulator = 0;
    }
    state.lastActiveFires = activeFires;
    stepParticles(state, delta);
    checkFailureConditions(state);
}
export function togglePause(state) {
    state.paused = !state.paused;
    if (state.paused) {
        setStatus(state, "Simulation paused.");
    }
    else {
        resetStatus(state);
    }
}
export function handleEscape(state) {
    selectUnit(state, null);
    setDeployMode(state, null);
    state.formationStart = null;
    state.formationEnd = null;
    state.selectionBox = null;
}
export function handleDeployAction(state, mode) {
    setDeployMode(state, state.deployMode === mode ? null : mode);
    selectUnit(state, null);
}
export function handleUnitDeployment(state, rng, tileX, tileY) {
    if (state.deployMode === "firefighter" || state.deployMode === "truck") {
        deployUnit(state, rng, state.deployMode, tileX, tileY);
    }
}
export function handleUnitRetask(state, tileX, tileY) {
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
export function handleClearLine(state, rng, start, end) {
    clearFuelLine(state, rng, start, end);
}
