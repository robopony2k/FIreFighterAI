import { CAREER_YEARS, FIREBREAK_COST_PER_TILE, RECRUIT_FIREFIGHTER_COST, RECRUIT_TRUCK_COST, TRUCK_CAPACITY, TRAINING_COST } from "../core/config.js";
import { formatCurrency } from "../core/utils.js";
import { formatPhaseStatus } from "../core/time.js";
import { getCharacterDefinition, getCharacterFirebreakCost, getCharacterInitials } from "../core/characters.js";
import { loadLeaderboard } from "../persistence/leaderboard.js";
import { indexFor } from "../core/grid.js";
function renderLeaderboard(ui) {
    const entries = loadLeaderboard();
    ui.leaderboardList.innerHTML = "";
    entries.forEach((entry) => {
        const item = document.createElement("li");
        item.textContent = `${entry.name} - ${entry.score}`;
        ui.leaderboardList.appendChild(item);
    });
}
export function updateHud(ui, state) {
    ui.app.dataset.phase = state.phase;
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
    ui.deployClear.textContent = `Fuel Break ${formatCurrency(getCharacterFirebreakCost(state.campaign.characterId, FIREBREAK_COST_PER_TILE))} / tile`;
    const totalFirefighters = state.roster.filter((unit) => unit.kind === "firefighter").length;
    const totalTrucks = state.roster.filter((unit) => unit.kind === "truck").length;
    const availableFirefighters = state.roster.filter((unit) => unit.kind === "firefighter" && unit.status === "available").length;
    const availableTrucks = state.roster.filter((unit) => unit.kind === "truck" && unit.status === "available").length;
    const deployedTruckRosterIds = new Set(state.units.filter((unit) => unit.kind === "truck" && unit.rosterId !== null).map((unit) => unit.rosterId));
    const deployableFirefighters = state.roster.filter((unit) => unit.kind === "firefighter" &&
        unit.status === "available" &&
        unit.assignedTruckId !== null &&
        deployedTruckRosterIds.has(unit.assignedTruckId)).length;
    ui.rosterFirefighterCount.textContent = `${availableFirefighters}/${totalFirefighters}`;
    ui.rosterTruckCount.textContent = `${availableTrucks}/${totalTrucks}`;
    ui.deployFirefighter.textContent = `Deploy Firefighter (${deployableFirefighters})`;
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
        let assignmentLabel = "";
        if (entry.kind === "firefighter") {
            const truck = entry.assignedTruckId
                ? state.roster.find((unit) => unit.id === entry.assignedTruckId) ?? null
                : null;
            assignmentLabel = truck ? `Crew ${truck.name}` : "Crew Unassigned";
        }
        else if (entry.kind === "truck") {
            assignmentLabel = `Crew ${entry.crewIds.length}/${TRUCK_CAPACITY}`;
        }
        item.innerHTML = `<strong>${entry.name}</strong><div class="roster-meta">${entry.kind} - ${statusLabel}</div>
      <div class="roster-meta">${assignmentLabel}</div>
      <div class="roster-meta">Spd ${entry.training.speed} - Pow ${entry.training.power} - Rng ${entry.training.range} - Res ${entry.training.resilience}</div>`;
        ui.rosterList.appendChild(item);
    });
    const fireActive = state.phase === "fire";
    const maintenanceActive = state.phase === "maintenance";
    ui.deployFirefighter.disabled = !fireActive || deployableFirefighters <= 0;
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
    const crewPlanTrucks = state.roster.filter((unit) => unit.kind === "truck" && unit.status !== "lost");
    ui.crewPlanSelect.innerHTML = "";
    const defaultOption = document.createElement("option");
    defaultOption.value = "";
    defaultOption.textContent = crewPlanTrucks.length > 0 ? "Select truck" : "No trucks available";
    ui.crewPlanSelect.appendChild(defaultOption);
    crewPlanTrucks.forEach((truck) => {
        const option = document.createElement("option");
        option.value = truck.id.toString();
        option.textContent = `${truck.name} (${truck.crewIds.length}/${TRUCK_CAPACITY})`;
        if (selectedRoster && selectedRoster.kind === "firefighter") {
            option.disabled = truck.crewIds.length >= TRUCK_CAPACITY && truck.id !== selectedRoster.assignedTruckId;
        }
        else {
            option.disabled = truck.crewIds.length >= TRUCK_CAPACITY;
        }
        ui.crewPlanSelect.appendChild(option);
    });
    if (!maintenanceActive || !selectedRoster) {
        ui.crewPlanHint.textContent = "Select a roster entry to assign crews.";
        ui.crewPlanList.innerHTML = "";
        ui.crewPlanSelect.disabled = true;
        ui.crewPlanAssign.disabled = true;
        ui.crewPlanUnassign.disabled = true;
    }
    else if (selectedRoster.kind === "firefighter") {
        const assignedTruck = selectedRoster.assignedTruckId
            ? state.roster.find((unit) => unit.id === selectedRoster.assignedTruckId) ?? null
            : null;
        ui.crewPlanHint.textContent = assignedTruck
            ? `Assigned to ${assignedTruck.name}.`
            : "No truck assigned yet.";
        ui.crewPlanSelect.disabled = false;
        ui.crewPlanAssign.disabled = selectedRoster.status === "lost" || crewPlanTrucks.length === 0;
        ui.crewPlanUnassign.disabled = selectedRoster.status === "lost" || selectedRoster.assignedTruckId === null;
        ui.crewPlanSelect.value = assignedTruck ? assignedTruck.id.toString() : "";
        ui.crewPlanList.innerHTML = "";
        if (!assignedTruck) {
            const empty = document.createElement("div");
            empty.classList.add("crew-plan-empty");
            empty.textContent = "Choose a truck to assign this firefighter.";
            ui.crewPlanList.appendChild(empty);
        }
    }
    else {
        ui.crewPlanHint.textContent = `Crew ${selectedRoster.crewIds.length}/${TRUCK_CAPACITY} assigned.`;
        ui.crewPlanSelect.disabled = true;
        ui.crewPlanAssign.disabled = true;
        ui.crewPlanUnassign.disabled = true;
        ui.crewPlanList.innerHTML = "";
        if (selectedRoster.crewIds.length === 0) {
            const empty = document.createElement("div");
            empty.classList.add("crew-plan-empty");
            empty.textContent = "No crew assigned.";
            ui.crewPlanList.appendChild(empty);
        }
        else {
            selectedRoster.crewIds.forEach((id) => {
                const crew = state.roster.find((unit) => unit.id === id) ?? null;
                if (!crew) {
                    return;
                }
                const item = document.createElement("div");
                item.classList.add("crew-plan-item");
                item.textContent = crew.name;
                ui.crewPlanList.appendChild(item);
            });
        }
    }
    const selectedTruck = state.units.find((unit) => unit.selected && unit.kind === "truck") ?? null;
    ui.truckPanel.classList.toggle("hidden", !selectedTruck);
    if (selectedTruck) {
        const crewUnits = [];
        selectedTruck.crewIds.forEach((id) => {
            const unit = state.units.find((entry) => entry.id === id);
            if (unit) {
                crewUnits.push(unit);
            }
        });
        const onboardCount = crewUnits.filter((unit) => unit.carrierId === selectedTruck.id).length;
        const modeLabel = selectedTruck.crewMode === "boarded" ? "Boarded" : "Deployed";
        ui.truckCrewSummary.textContent = `Crew ${crewUnits.length}/${TRUCK_CAPACITY} - Onboard ${onboardCount} - Mode ${modeLabel}`;
        ui.truckCrewList.innerHTML = "";
        if (crewUnits.length === 0) {
            const empty = document.createElement("div");
            empty.classList.add("truck-crew-empty");
            empty.textContent = "No crew assigned.";
            ui.truckCrewList.appendChild(empty);
        }
        crewUnits.forEach((unit) => {
            const rosterEntry = unit.rosterId ? state.roster.find((entry) => entry.id === unit.rosterId) ?? null : null;
            let status = "Patrolling";
            if (unit.carrierId === selectedTruck.id) {
                status = "On board";
            }
            else if (unit.target && unit.pathIndex < unit.path.length) {
                status = "Moving";
            }
            else {
                const tile = state.tiles[indexFor(state.grid, Math.floor(unit.x), Math.floor(unit.y))];
                if (tile.fire > 0.15) {
                    status = "Engaging";
                }
            }
            const item = document.createElement("div");
            item.classList.add("truck-crew-item");
            const name = rosterEntry ? rosterEntry.name : `Crew ${unit.id}`;
            item.innerHTML = `<strong>${name}</strong><span>${status}</span>`;
            ui.truckCrewList.appendChild(item);
        });
        ui.truckCrewBoard.classList.toggle("active", selectedTruck.crewMode === "boarded");
        ui.truckCrewDeploy.classList.toggle("active", selectedTruck.crewMode === "deployed");
        ui.truckCrewBoard.disabled = false;
        ui.truckCrewDeploy.disabled = false;
    }
    else {
        ui.truckCrewSummary.textContent = "Select a truck to manage crew.";
        ui.truckCrewList.innerHTML = "";
        ui.truckCrewBoard.classList.remove("active");
        ui.truckCrewDeploy.classList.remove("active");
        ui.truckCrewBoard.disabled = true;
        ui.truckCrewDeploy.disabled = true;
    }
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
    }
    else {
        ui.overlayDetails.classList.add("hidden");
    }
    ui.overlayRestart.textContent = state.overlayAction === "restart" ? "Play Again" : "OK";
    if (state.leaderboardDirty) {
        renderLeaderboard(ui);
        state.leaderboardDirty = false;
    }
}
