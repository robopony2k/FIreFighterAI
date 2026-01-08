import { APPROVAL_MIN, BASE_BUDGET, CAREER_YEARS, DAYS_PER_SECOND, FIRE_PHASE_TIME_SCALE, FIRE_SIM_TICK_SECONDS, GROWTH_SPEED_MULTIPLIER, HECTARES_PER_TILE, ZOOM_MIN } from "../core/config.js";
import { formatCurrency } from "../core/utils.js";
import { getDayNightFactor, getFireSeasonIntensity, getFireSpreadScale, getPhaseInfo, PHASES } from "../core/time.js";
import { setStatus, resetStatus } from "../core/state.js";
import { inBounds, indexFor } from "../core/grid.js";
import { NEIGHBOR_DIRS } from "../core/config.js";
import { getCharacterBaseBudget, getCharacterDefinition } from "../core/characters.js";
import { randomizeWind, stepWind } from "./wind.js";
import { igniteRandomFire, stepFire } from "./fire.js";
import { stepGrowth } from "./growth.js";
import { stepParticles } from "./particles.js";
import { applyExtinguish, applyUnitHazards, autoAssignTargets, clearFuelLine, deployUnit, recallUnits, selectUnit, setDeployMode, setUnitTarget, stepUnits } from "./units.js";
const FIRE_HEAT_PADDING = 8;
const YEAR_EVENTS = {};
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
const getYearEventMessages = (year) => YEAR_EVENTS[year] ?? [];
const showSeasonOverlay = (state) => {
    if (state.gameOver) {
        return;
    }
    const details = [];
    const yearEvents = getYearEventMessages(state.year);
    if (yearEvents.length > 0) {
        details.push(...yearEvents);
    }
    if (state.phase === "growth") {
        state.overlayTitle = "Spring Growth";
        state.overlayMessage = "Vegetation is rebounding across the region.";
        details.push("Observe regrowth from above. Interactions are paused during spring.");
    }
    else if (state.phase === "maintenance") {
        state.overlayTitle = "Winter Planning";
        state.overlayMessage = `It's wintertime. You have a budget of ${formatCurrency(state.budget)} to prepare.`;
        details.push("Recruit, train, and cut fuel breaks before summer.");
    }
    else if (state.phase === "fire") {
        const forecast = getForecastTemp(state);
        state.overlayTitle = "Summer Fire Season";
        state.overlayMessage = `It's summertime. Forecast: hot summer with average temperatures around ${forecast}°C.`;
        details.push("Be ready to deploy firefighters and trucks quickly.");
    }
    else if (state.phase === "budget") {
        const housesSaved = Math.max(0, state.totalHouses - state.destroyedHouses);
        const burnedHectares = Math.round(state.yearBurnedTiles * HECTARES_PER_TILE);
        state.overlayTitle = "Autumn Review";
        state.overlayMessage = "Annual performance review and scorecard.";
        details.push(`Approval rating: ${Math.round(state.approval * 100)}%.`);
        details.push(`Houses saved: ${housesSaved}/${state.totalHouses}.`);
        details.push(`Land burned: ${burnedHectares} ha.`);
        details.push(`Lives lost: ${state.yearLivesLost}.`);
        details.push("Politics & lobbying: placeholder.");
    }
    details.push("Press OK to continue.");
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
    state.smokeParticles = [];
    state.waterParticles = [];
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
    recallUnits(state);
    selectUnit(state, null);
    setDeployMode(state, null);
}
export function setPhase(state, rng, next) {
    state.phase = next;
    if (state.phase !== "fire") {
        state.fireSeasonDay = 0;
        state.fireSimAccumulator = 0;
        state.fireWork = null;
        state.fireBoundsActive = false;
    }
    updatePhaseControls(state);
    if (state.phase === "growth") {
        startNewYear(state);
        if (!state.growthView) {
            state.growthView = {
                zoom: state.zoom,
                camera: { ...state.cameraCenter }
            };
        }
        state.zoom = ZOOM_MIN;
        state.cameraCenter = { x: state.grid.cols * 0.5, y: state.grid.rows * 0.5 };
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
        state.fireSeasonDay = 0;
        state.fireSimAccumulator = 0;
        state.fireWork = null;
        state.fireBoundsActive = false;
        randomizeWind(state, rng);
        pickInitialFires(state, rng);
        captureFireSnapshot(state);
        setStatus(state, "Fire season begins. Stay ahead of the line.");
        showSeasonOverlay(state);
        return;
    }
    extinguishAllFires(state);
    calculateBudgetOutcome(state);
    showSeasonOverlay(state);
}
export function advancePhase(state, rng) {
    const current = getPhaseInfo(state.phaseIndex).id;
    const leavingGrowth = current === "growth";
    if (current === "fire") {
        extinguishAllFires(state);
        recallUnits(state);
    }
    if (current === "budget") {
        state.year += 1;
        if (state.year > CAREER_YEARS) {
            endGame(state, true, "Twenty years in command. The region endures.");
            return;
        }
    }
    state.phaseIndex = (state.phaseIndex + 1) % PHASES.length;
    if (leavingGrowth && state.growthView) {
        state.zoom = state.growthView.zoom;
        state.cameraCenter = { ...state.growthView.camera };
        state.growthView = null;
    }
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
        if (current.id === "fire" && state.lastActiveFires > 0) {
            state.phaseDay = current.duration;
            break;
        }
        state.phaseDay -= current.duration;
        advancePhase(state, rng);
    }
}
export function pickInitialFires(state, rng) {
    let attempts = 0;
    let placed = 0;
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
    while (placed < 3 && attempts < 300) {
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
    if (placed < 3) {
        for (let y = 0; y < state.grid.rows && placed < 3; y += 1) {
            for (let x = 0; x < state.grid.cols && placed < 3; x += 1) {
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
    const phaseScale = state.phase === "growth" ? GROWTH_SPEED_MULTIPLIER : state.phase === "fire" ? FIRE_PHASE_TIME_SCALE : 1;
    const calendarDelta = dayDelta * phaseScale;
    if (state.phase !== "maintenance") {
        advanceCalendar(state, rng, calendarDelta);
    }
    if (state.gameOver) {
        state.lastActiveFires = 0;
        return;
    }
    if (state.phase === "growth") {
        stepGrowth(state, dayDelta * GROWTH_SPEED_MULTIPLIER, rng);
    }
    let activeFires = state.lastActiveFires;
    if (state.phase === "fire") {
        autoAssignTargets(state);
        stepUnits(state, delta);
        applyExtinguish(state, rng, delta);
        applyUnitHazards(state, rng, delta);
        state.fireSimAccumulator = Math.min(state.fireSimAccumulator + delta, FIRE_SIM_TICK_SECONDS * 2);
        if (state.fireSimAccumulator >= FIRE_SIM_TICK_SECONDS) {
            const simDelta = FIRE_SIM_TICK_SECONDS;
            const simDayDelta = simDelta * DAYS_PER_SECOND * FIRE_PHASE_TIME_SCALE;
            state.fireSeasonDay += simDayDelta;
            captureFireSnapshot(state);
            stepWind(state, simDelta, rng);
            const dayFactor = getDayNightFactor(state.fireSeasonDay);
            const seasonIntensity = getFireSeasonIntensity(state.fireSeasonDay);
            const spreadScale = getFireSpreadScale(state.fireSeasonDay);
            igniteRandomFire(state, rng, simDayDelta, dayFactor * seasonIntensity);
            activeFires = stepFire(state, rng, simDelta, spreadScale, dayFactor);
            state.fireSimAccumulator = Math.max(0, state.fireSimAccumulator - FIRE_SIM_TICK_SECONDS);
        }
        else {
            activeFires = 0;
        }
        state.lastActiveFires = activeFires;
    }
    else {
        state.lastActiveFires = 0;
    }
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
    const selectedTrucks = state.units.filter((unit) => unit.selected && unit.kind === "truck");
    if (selectedTrucks.length > 0) {
        selectedTrucks.forEach((unit) => {
            setUnitTarget(state, unit, tileX, tileY, true);
        });
        return;
    }
    state.units.forEach((unit) => {
        if (unit.selected) {
            setUnitTarget(state, unit, tileX, tileY, true);
        }
    });
}
export function handleClearLine(state, rng, start, end) {
    clearFuelLine(state, rng, start, end);
}
