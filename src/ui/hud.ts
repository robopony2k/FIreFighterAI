import type { WorldState } from "../core/state.js";
import { CAREER_YEARS } from "../core/config.js";
import { formatCurrency } from "../core/utils.js";
import { formatPhaseStatus } from "../core/time.js";
import { loadLeaderboard } from "../persistence/leaderboard.js";
import type { UIRefs } from "./dom.js";

function renderLeaderboard(ui: UIRefs): void {
  const entries = loadLeaderboard();
  ui.leaderboardList.innerHTML = "";
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = `${entry.name} - ${entry.score}`;
    ui.leaderboardList.appendChild(item);
  });
}

export function updateHud(ui: UIRefs, state: WorldState): void {
  ui.seedValue.textContent = state.seed.toString();
  ui.budgetValue.textContent = formatCurrency(state.budget);
  ui.approvalValue.textContent = `${Math.round(state.approval * 100)}%`;
  ui.yearValue.textContent = `${state.year} / ${CAREER_YEARS}`;
  ui.phaseValue.textContent = formatPhaseStatus(state.phase, state.phaseIndex, state.phaseDay);
  ui.firesValue.textContent = state.lastActiveFires.toString();
  ui.scoreValue.textContent = state.careerScore.toLocaleString();
  ui.windValue.textContent = state.phase === "fire" ? `${state.wind.name} ${Math.round(state.wind.strength * 10)}` : "Calm";
  ui.propertyLossValue.textContent = formatCurrency(state.lostPropertyValue);
  ui.livesLossValue.textContent = state.lostResidents.toLocaleString();
  ui.statusText.textContent = state.statusMessage;

  const fireActive = state.phase === "fire";
  const maintenanceActive = state.phase === "maintenance";
  ui.deployFirefighter.disabled = !fireActive;
  ui.deployTruck.disabled = !fireActive;
  ui.deployClear.disabled = !maintenanceActive;
  ui.beginFireSeason.disabled = !maintenanceActive;

  ui.deployFirefighter.classList.toggle("active", state.deployMode === "firefighter");
  ui.deployTruck.classList.toggle("active", state.deployMode === "truck");
  ui.deployClear.classList.toggle("active", state.deployMode === "clear");

  ui.overlay.classList.toggle("hidden", !state.overlayVisible);
  ui.overlayTitle.textContent = state.overlayTitle;
  ui.overlayMessage.textContent = state.overlayMessage;

  if (state.leaderboardDirty) {
    renderLeaderboard(ui);
    state.leaderboardDirty = false;
  }
}

