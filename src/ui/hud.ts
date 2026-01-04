import type { WorldState } from "../core/state.js";
import {
  CAREER_YEARS,
  FIREBREAK_COST_PER_TILE,
  RECRUIT_FIREFIGHTER_COST,
  RECRUIT_TRUCK_COST,
  TRAINING_COST
} from "../core/config.js";
import { formatCurrency } from "../core/utils.js";
import { formatPhaseStatus } from "../core/time.js";
import { getCharacterDefinition, getCharacterFirebreakCost, getCharacterInitials } from "../core/characters.js";
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
  const character = getCharacterDefinition(state.campaign.characterId);
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
  ui.chiefName.textContent = character.name;
  ui.chiefTitle.textContent = character.title;
  ui.chiefPortraitInitials.textContent = getCharacterInitials(character.name);
  ui.chiefPortraitImage.src = character.portrait;
  ui.chiefPortraitImage.alt = `${character.name} portrait`;
  ui.chiefPortrait.classList.add("has-photo");
  ui.chiefPortrait.style.setProperty("--chief-accent", character.accent);
  ui.deployClear.textContent = `Fuel Break ${formatCurrency(
    getCharacterFirebreakCost(state.campaign.characterId, FIREBREAK_COST_PER_TILE)
  )} / tile`;

  const totalFirefighters = state.roster.filter((unit) => unit.kind === "firefighter").length;
  const totalTrucks = state.roster.filter((unit) => unit.kind === "truck").length;
  const availableFirefighters = state.roster.filter(
    (unit) => unit.kind === "firefighter" && unit.status === "available"
  ).length;
  const availableTrucks = state.roster.filter((unit) => unit.kind === "truck" && unit.status === "available").length;
  ui.rosterFirefighterCount.textContent = `${availableFirefighters}/${totalFirefighters}`;
  ui.rosterTruckCount.textContent = `${availableTrucks}/${totalTrucks}`;
  ui.deployFirefighter.textContent = `Deploy Firefighter (${availableFirefighters})`;
  ui.deployTruck.textContent = `Deploy Truck (${availableTrucks})`;
  ui.recruitFirefighter.textContent = `Recruit Firefighter ${formatCurrency(RECRUIT_FIREFIGHTER_COST)}`;
  ui.recruitTruck.textContent = `Recruit Truck ${formatCurrency(RECRUIT_TRUCK_COST)}`;
  ui.trainSpeed.textContent = `Train Speed ${formatCurrency(TRAINING_COST)}`;
  ui.trainPower.textContent = `Train Power ${formatCurrency(TRAINING_COST)}`;
  ui.trainRange.textContent = `Train Range ${formatCurrency(TRAINING_COST)}`;
  ui.trainResilience.textContent = `Train Resilience ${formatCurrency(TRAINING_COST)}`;

  ui.rosterList.innerHTML = "";
  state.roster.forEach((entry) => {
    const item = document.createElement("div");
    item.classList.add("roster-item");
    item.dataset.id = entry.id.toString();
    if (entry.id === state.selectedRosterId) {
      item.classList.add("selected");
    }
    if (entry.status === "lost") {
      item.classList.add("lost");
    }
    const statusLabel = entry.status === "lost" ? "Lost" : entry.status === "deployed" ? "Deployed" : "Available";
    item.innerHTML = `<strong>${entry.name}</strong><div class="roster-meta">${entry.kind} · ${statusLabel}</div>
      <div class="roster-meta">Spd ${entry.training.speed} · Pow ${entry.training.power} · Rng ${entry.training.range} · Res ${entry.training.resilience}</div>`;
    ui.rosterList.appendChild(item);
  });

  const fireActive = state.phase === "fire";
  const maintenanceActive = state.phase === "maintenance";
  ui.deployFirefighter.disabled = !fireActive;
  ui.deployTruck.disabled = !fireActive;
  ui.deployClear.disabled = !maintenanceActive;
  ui.beginFireSeason.disabled = !maintenanceActive;
  ui.recruitFirefighter.disabled = !maintenanceActive;
  ui.recruitTruck.disabled = !maintenanceActive;
  const selectedRoster = state.roster.find((unit) => unit.id === state.selectedRosterId) ?? null;
  const canTrain = maintenanceActive && selectedRoster !== null && selectedRoster.status !== "lost";
  ui.trainSpeed.disabled = !canTrain;
  ui.trainPower.disabled = !canTrain;
  ui.trainRange.disabled = !canTrain;
  ui.trainResilience.disabled = !canTrain;

  ui.deployFirefighter.classList.toggle("active", state.deployMode === "firefighter");
  ui.deployTruck.classList.toggle("active", state.deployMode === "truck");
  ui.deployClear.classList.toggle("active", state.deployMode === "clear");

  ui.overlay.classList.toggle("hidden", !state.overlayVisible);
  ui.overlayTitle.textContent = state.overlayTitle;
  ui.overlayMessage.textContent = state.overlayMessage;
  ui.overlayDetails.innerHTML = "";
  if (state.overlayDetails.length > 0) {
    state.overlayDetails.forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = entry;
      ui.overlayDetails.appendChild(item);
    });
    ui.overlayDetails.classList.remove("hidden");
  } else {
    ui.overlayDetails.classList.add("hidden");
  }
  ui.overlayRestart.textContent = state.overlayAction === "restart" ? "Play Again" : "OK";

  if (state.leaderboardDirty) {
    renderLeaderboard(ui);
    state.leaderboardDirty = false;
  }
}

