import type { RNG } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { APPROVAL_MIN, BASE_BUDGET, CAREER_YEARS, DAYS_PER_SECOND, GROWTH_SPEED_MULTIPLIER } from "../core/config.js";
import { formatCurrency } from "../core/utils.js";
import { getDayNightFactor, getFireSeasonIntensity, getFireSpreadScale, getPhaseInfo, PHASES } from "../core/time.js";
import { setStatus, resetStatus } from "../core/state.js";
import { indexFor } from "../core/grid.js";
import { randomizeWind, stepWind } from "./wind.js";
import { igniteRandomFire, stepFire } from "./fire.js";
import { stepHeat } from "./heat.js";
import { stepGrowth } from "./growth.js";
import { stepParticles } from "./particles.js";
import { applyExtinguish, clearFuelLine, deployUnit, selectUnit, setDeployMode, setUnitTarget, stepUnits } from "./units.js";

export function updatePhaseControls(state: WorldState): void {
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

export function extinguishAllFires(state: WorldState): void {
  state.tiles.forEach((tile) => {
    tile.fire = 0;
    tile.heat = 0;
  });
  state.smokeParticles = [];
  state.waterParticles = [];
}

export function calculateBudgetOutcome(state: WorldState): void {
  const propertyLossRatio = state.totalPropertyValue > 0 ? state.yearPropertyLost / state.totalPropertyValue : 0;
  const lifeLossRatio = state.totalPopulation > 0 ? state.yearLivesLost / state.totalPopulation : 0;
  const landLossRatio = state.totalLandTiles > 0 ? state.burnedTiles / state.totalLandTiles : 0;
  const responseScore = Math.max(0, Math.min(1, 1 - (propertyLossRatio * 0.7 + lifeLossRatio * 1.3 + landLossRatio * 0.4)));
  const containmentBonus = Math.max(0, Math.min(0.2, state.containedCount / 60));
  const rating = Math.max(0, Math.min(1, responseScore + containmentBonus));
  const previousApproval = state.approval;
  state.approval = Math.max(0, Math.min(1, state.approval * 0.65 + rating * 0.35));
  const carryOver = Math.floor(state.budget * 0.2);
  state.pendingBudget = Math.max(0, Math.floor(BASE_BUDGET * (0.7 + state.approval * 0.8 + rating * 0.5) + carryOver));
  state.careerScore += Math.floor(rating * 900 + (1 - propertyLossRatio) * 400 + (1 - lifeLossRatio) * 600);
  setStatus(
    state,
    `Budget review: approval ${Math.round(previousApproval * 100)}% -> ${Math.round(state.approval * 100)}%, next budget ${formatCurrency(
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
  state.containedCount = 0;
  state.units = [];
  selectUnit(state, null);
  setDeployMode(state, null);
}

export function setPhase(state: WorldState, rng: RNG, next: WorldState["phase"]): void {
  state.phase = next;
  if (state.phase !== "fire") {
    state.fireSeasonDay = 0;
  }
  updatePhaseControls(state);
  if (state.phase === "growth") {
    startNewYear(state);
    setStatus(state, `Year ${state.year} begins. Growth fuels the region.`);
    return;
  }
  if (state.phase === "maintenance") {
    setStatus(state, "Maintenance season: spend budget to cut firebreaks.");
    return;
  }
  if (state.phase === "fire") {
    state.fireSeasonDay = 0;
    randomizeWind(state, rng);
    pickInitialFires(state, rng);
    setStatus(state, "Fire season begins. Stay ahead of the line.");
    return;
  }
  extinguishAllFires(state);
  calculateBudgetOutcome(state);
}

export function advancePhase(state: WorldState, rng: RNG): void {
  const current = getPhaseInfo(state.phaseIndex).id;
  if (current === "fire") {
    extinguishAllFires(state);
    state.units = [];
  }
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
    if (current.id === "fire" && state.lastActiveFires > 0) {
      state.phaseDay = current.duration;
      break;
    }
    state.phaseDay -= current.duration;
    advancePhase(state, rng);
  }
}

export function pickInitialFires(state: WorldState, rng: RNG): void {
  let attempts = 0;
  let placed = 0;
  while (placed < 3 && attempts < 300) {
    attempts += 1;
    const x = Math.floor(rng.next() * state.grid.cols);
    const y = Math.floor(rng.next() * state.grid.rows);
    const idx = indexFor(state.grid, x, y);
    const tile = state.tiles[idx];
    if (tile.type === "forest" || tile.type === "grass") {
      const dist = Math.hypot(x - state.basePoint.x, y - state.basePoint.y);
      if (dist > 8 && tile.fire === 0) {
        tile.fire = 0.5 + rng.next() * 0.2;
        tile.heat = Math.max(tile.heat, tile.ignitionPoint * 1.4);
        placed += 1;
      }
    }
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
  if (baseTile.fire > 0 || baseTile.type === "ash") {
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
  const approvalBonus = Math.floor(state.approval * 500);
  const budgetBonus = Math.floor(state.budget * 0.5);
  const score = Math.max(0, Math.floor(state.careerScore + approvalBonus + budgetBonus));

  state.finalScore = score;
  state.overlayVisible = true;
  state.overlayTitle = victory ? "Career Complete" : "Command Relieved";
  const baseMessage =
    reason || (victory ? "Your twenty-year career leaves the region resilient." : "The region is overwhelmed.");
  state.overlayMessage = `${baseMessage} Final score: ${score}.`;
  state.scoreSubmitted = false;
  state.leaderboardDirty = true;
}

export function stepSim(state: WorldState, rng: RNG, delta: number): void {
  if (state.paused || state.gameOver) {
    return;
  }

  const dayDelta = delta * DAYS_PER_SECOND;
  const calendarDelta = state.phase === "growth" ? dayDelta * GROWTH_SPEED_MULTIPLIER : dayDelta;
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

  if (state.phase === "fire") {
    state.fireSeasonDay += dayDelta;
  }

  let activeFires = 0;
  if (state.phase === "fire") {
    stepWind(state, delta, rng);
    const dayFactor = getDayNightFactor(state.fireSeasonDay);
    const seasonIntensity = getFireSeasonIntensity(state.fireSeasonDay);
    const spreadScale = getFireSpreadScale(state.fireSeasonDay);
    igniteRandomFire(state, rng, dayDelta, dayFactor * seasonIntensity);
    stepUnits(state, delta);
    applyExtinguish(state, rng, delta);
    stepHeat(state, delta, spreadScale);
    activeFires = stepFire(state, rng, delta, spreadScale, dayFactor);
    state.lastActiveFires = activeFires;
  } else {
    state.lastActiveFires = 0;
  }

  stepParticles(state, delta);
  checkFailureConditions(state);
}

export function togglePause(state: WorldState): void {
  state.paused = !state.paused;
  if (state.paused) {
    setStatus(state, "Simulation paused.");
  } else {
    resetStatus(state);
  }
}

export function handleEscape(state: WorldState): void {
  selectUnit(state, null);
  setDeployMode(state, null);
}

export function handleDeployAction(state: WorldState, mode: WorldState["deployMode"]): void {
  setDeployMode(state, state.deployMode === mode ? null : mode);
  selectUnit(state, null);
}

export function handleUnitDeployment(state: WorldState, rng: RNG, tileX: number, tileY: number): void {
  if ((state.deployMode === "firefighter" || state.deployMode === "truck") && state.selectedUnitId === null) {
    deployUnit(state, rng, state.deployMode, tileX, tileY);
  }
}

export function handleUnitRetask(state: WorldState, tileX: number, tileY: number): void {
  if (state.selectedUnitId !== null) {
    const unit = state.units.find((current) => current.id === state.selectedUnitId) || null;
    if (unit) {
      setUnitTarget(state, unit, tileX, tileY);
    }
  }
}

export function handleClearLine(state: WorldState, rng: RNG, start: { x: number; y: number }, end: { x: number; y: number }): void {
  clearFuelLine(state, rng, start, end);
}

