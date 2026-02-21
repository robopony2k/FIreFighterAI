import type { WorldState } from "../../core/state.js";
import type { InputState } from "../../core/inputState.js";
import {
  FIREBREAK_COST_PER_TILE,
  RECRUIT_FIREFIGHTER_COST,
  RECRUIT_TRUCK_COST,
  TRAINING_COST,
  TRUCK_CAPACITY
} from "../../core/config.js";
import { formatCurrency } from "../../core/utils.js";
import { getPhaseInfo } from "../../core/time.js";
import { getCharacterFirebreakCost } from "../../core/characters.js";
import type { SelectedEntity } from "./types.js";
import type { Formation } from "../../core/types.js";
import type { CrewPanelData } from "./components/MaintenanceCrewPanel.js";
import { GameState } from "./gameState.js";
import { UIController } from "./uiController.js";

export type PhaseUiApi = {
  sync: (world: WorldState, inputState: InputState) => void;
  state: GameState;
  controller: UIController;
};

const getSelection = (world: WorldState): SelectedEntity => {
  if (world.selectedUnitIds.length !== 1) {
    return { kind: "none" };
  }
  const selected = world.units.find((unit) => unit.id === world.selectedUnitIds[0]) ?? null;
  if (!selected) {
    return { kind: "none" };
  }
  let crewFormation: Formation | null = null;
  if (selected.kind === "truck" && selected.crewIds.length > 0) {
    const crewMember = world.units.find((u) => u.id === selected.crewIds[0]);
    if (crewMember) {
      crewFormation = crewMember.formation;
    }
  }
  return {
    kind: "unit",
    id: selected.id,
    unitType: selected.kind,
    crewFormation
  };
};

const getInteractionMode = (world: WorldState, inputState: InputState) => {
  if (world.deployMode === "clear") {
    return "fuelBreak";
  }
  if (world.deployMode === "firefighter" || world.deployMode === "truck") {
    return "deploy";
  }
  if (inputState.formationStart) {
    return "formation";
  }
  return "default";
};

export const initPhaseUI = (container: HTMLElement): PhaseUiApi => {
  const state = new GameState();
  const root = document.createElement("div");
  root.className = "phase-ui";
  container.appendChild(root);
  const controller = new UIController(root, state);

  const sync = (world: WorldState, inputState: InputState) => {
    const phaseInfo = getPhaseInfo(world.phaseIndex);
    const progress = phaseInfo.duration > 0 ? world.phaseDay / phaseInfo.duration : 0;
    state.setPhase(world.phase);
    state.setPhaseProgress(progress);
    state.setSelection(getSelection(world));
    state.setInteractionMode(getInteractionMode(world, inputState));
    state.setPaused(world.paused);
    state.setTimeSpeedIndex(world.timeSpeedIndex);
    state.setAlert(world.statusMessage && world.statusMessage !== "Ready." ? world.statusMessage : null);
    const windStrength = Math.round(world.wind.strength * 10);
    const windLabel = windStrength > 0 ? `Wind ${world.wind.name} ${windStrength}` : "Wind Calm";
    const tempLabel = Number.isFinite(world.climateTemp) ? `${Math.round(world.climateTemp)}C` : "n/a";
    const approvalPct = Math.round(Math.max(0, Math.min(1, world.approval)) * 100);
    const totalHouses = Number.isFinite(world.totalHouses) ? Math.max(0, Math.floor(world.totalHouses)) : 0;
    const destroyedHouses = Number.isFinite(world.destroyedHouses) ? Math.max(0, Math.floor(world.destroyedHouses)) : 0;
    const houseCount = Math.max(0, totalHouses - destroyedHouses);
    const forecastMeta = `Year ${world.year} | ${tempLabel} | ${windLabel} | Approval ${approvalPct}% | Houses ${houseCount}`;
    state.setForecast(
      world.climateForecast ?? null,
      world.climateForecastDay ?? 0,
      Math.max(0, world.climateForecastStart ?? 0),
      world.climateTimeline?.daysPerYear ?? 360,
      forecastMeta
    );
    controller.setPanelData("miniMap", { world });

    const rosterFirefighters = world.roster.filter((unit) => unit.kind === "firefighter");
    const rosterList = world.roster.map((entry) => {
      let assignmentLabel = "";
      if (entry.kind === "firefighter") {
        const truck = entry.assignedTruckId
          ? world.roster.find((unit) => unit.id === entry.assignedTruckId) ?? null
          : null;
        assignmentLabel = truck ? `Crew ${truck.name}` : "Crew Unassigned";
      } else {
        assignmentLabel = `Crew ${entry.crewIds.length}/${TRUCK_CAPACITY}`;
      }
      return {
        id: entry.id,
        name: entry.name,
        kind: entry.kind,
        status: entry.status,
        assignment: assignmentLabel,
        training: { ...entry.training }
      };
    });
    const totalFirefighters = rosterFirefighters.length;
    const totalTrucks = world.roster.filter((unit) => unit.kind === "truck").length;
    const availableFirefighters = rosterFirefighters.filter((unit) => unit.status === "available").length;
    const availableTrucks = world.roster.filter((unit) => unit.kind === "truck" && unit.status === "available").length;
    const selectedRoster =
      world.selectedRosterId !== null
        ? world.roster.find((unit) => unit.id === world.selectedRosterId) ?? null
        : null;
    const canTrain = world.phase === "maintenance" && selectedRoster !== null && selectedRoster.status !== "lost";

    controller.setPanelData("maintenanceRoster", {
      totalFirefighters,
      availableFirefighters,
      totalTrucks,
      availableTrucks,
      roster: rosterList,
      selectedId: world.selectedRosterId ?? null,
      recruitFirefighterCost: formatCurrency(RECRUIT_FIREFIGHTER_COST),
      recruitTruckCost: formatCurrency(RECRUIT_TRUCK_COST),
      trainingCost: formatCurrency(TRAINING_COST),
      canTrain
    });

    const crewPlanTrucks = world.roster.filter((unit) => unit.kind === "truck" && unit.status !== "lost");
    const crewPanelData: CrewPanelData = {
      summary: `Trucks ready: ${crewPlanTrucks.length}. Crew plan is locked in before fire season.`,
      hint:
        crewPlanTrucks.length > 0
          ? "Select a firefighter in the roster, then choose a truck and click Assign."
          : "Recruit a truck to assign crews.",
      selectionLabel: "No roster selected.",
      trucks: crewPlanTrucks.map((truck) => ({
        id: truck.id,
        name: truck.name,
        crewCount: truck.crewIds.length,
        capacity: TRUCK_CAPACITY,
        disabled: false
      })),
      selectedTruckId: null,
      selectedRosterId: selectedRoster ? selectedRoster.id : null,
      selectEnabled: false,
      assignEnabled: false,
      unassignEnabled: false,
      showAssignControls: false,
      crewList: [] as string[]
    };

    if (selectedRoster && world.phase === "maintenance") {
      if (selectedRoster.kind === "firefighter") {
        const assignedTruck = selectedRoster.assignedTruckId
          ? world.roster.find((unit) => unit.id === selectedRoster.assignedTruckId) ?? null
          : null;
        if (assignedTruck) {
          crewPanelData.hint = `Assigned to ${assignedTruck.name}. Choose a different truck to reassign.`;
        } else {
          crewPanelData.hint =
            crewPlanTrucks.length > 0 ? "Choose a truck below and click Assign." : "No trucks available. Recruit a truck to assign crews.";
        }
        crewPanelData.selectionLabel = `${selectedRoster.name} - Firefighter`;
        crewPanelData.selectedTruckId = assignedTruck ? assignedTruck.id : null;
        crewPanelData.selectEnabled = selectedRoster.status !== "lost" && crewPlanTrucks.length > 0;
        crewPanelData.assignEnabled = selectedRoster.status !== "lost" && crewPlanTrucks.length > 0;
        crewPanelData.unassignEnabled = selectedRoster.status !== "lost" && selectedRoster.assignedTruckId !== null;
        crewPanelData.showAssignControls = true;
        crewPanelData.trucks = crewPlanTrucks.map((truck) => ({
          id: truck.id,
          name: truck.name,
          crewCount: truck.crewIds.length,
          capacity: TRUCK_CAPACITY,
          disabled: truck.crewIds.length >= TRUCK_CAPACITY && truck.id !== selectedRoster.assignedTruckId
        }));
        if (assignedTruck) {
          crewPanelData.crewList = assignedTruck.crewIds
            .map((id) => world.roster.find((unit) => unit.id === id)?.name ?? "")
            .filter((name) => name);
        }
      } else {
        crewPanelData.hint = "Truck selected. Assigned crew listed below. Select a firefighter in the roster to assign them to a truck.";
        crewPanelData.selectionLabel = `${selectedRoster.name} - Truck`;
        crewPanelData.selectedTruckId = selectedRoster.id;
        crewPanelData.crewList = selectedRoster.crewIds
          .map((id) => world.roster.find((unit) => unit.id === id)?.name ?? "")
          .filter((name) => name);
      }
    }

    controller.setPanelData("maintenanceCrew", crewPanelData);

    controller.setPanelData("fuelBreak", {
      active: world.deployMode === "clear",
      costPerTile: formatCurrency(getCharacterFirebreakCost(world.campaign.characterId, FIREBREAK_COST_PER_TILE)),
      toolLabel: "Drag to carve a fire break"
    });

    const deployedTruckRosterIds = new Set(
      world.units.filter((unit) => unit.kind === "truck" && unit.rosterId !== null).map((unit) => unit.rosterId as number)
    );
    const deployableFirefighters = world.roster.filter(
      (unit) =>
        unit.kind === "firefighter" &&
        unit.status === "available" &&
        unit.assignedTruckId !== null &&
        deployedTruckRosterIds.has(unit.assignedTruckId)
    ).length;
    const truckSlots = world.units
      .filter((unit) => unit.kind === "truck")
      .sort((a, b) => (a.rosterId ?? a.id) - (b.rosterId ?? b.id))
      .slice(0, 10)
      .map((truck, index) => {
        const rosterName = truck.rosterId
          ? world.roster.find((entry) => entry.id === truck.rosterId)?.name ?? null
          : null;
        const hotkey = index === 9 ? "0" : String(index + 1);
        return {
          id: truck.id,
          name: rosterName ?? `Truck ${index + 1}`,
          crewCount: truck.crewIds.length,
          crewCapacity: TRUCK_CAPACITY,
          crewMode: truck.crewMode,
          hotkey,
          selected: world.selectedUnitIds.includes(truck.id)
        };
      });
    controller.setPanelData("fireDeploy", {
      trucks: truckSlots,
      deployableFirefighters,
      availableTrucks,
      activeMode: world.deployMode === "firefighter" ? "firefighter" : world.deployMode === "truck" ? "truck" : null
    });

    const unitGroups = [
      {
        label: "Trucks",
        units: world.units
          .filter((unit) => unit.kind === "truck")
          .map((unit) => ({
            name: world.roster.find((entry) => entry.id === unit.rosterId)?.name ?? `Truck ${unit.id}`,
            status: unit.target && unit.pathIndex < unit.path.length ? "Moving" : "Holding"
          }))
      },
      {
        label: "Firefighters",
        units: world.units
          .filter((unit) => unit.kind === "firefighter")
          .map((unit) => ({
            name: world.roster.find((entry) => entry.id === unit.rosterId)?.name ?? `Crew ${unit.id}`,
            status: unit.carrierId ? "On board" : unit.target && unit.pathIndex < unit.path.length ? "Moving" : "Patrolling"
          }))
      }
    ];
    controller.setPanelData("fireUnitList", { groups: unitGroups });

    controller.setPanelData("budgetReport", {
      summary: `Year ${world.year} summary.`,
      approval: `${Math.round(world.approval * 100)}%`,
      losses: `${formatCurrency(world.lostPropertyValue)} lost, ${world.lostResidents} lives`
    });
  };

  return {
    sync,
    state,
    controller
  };
};
