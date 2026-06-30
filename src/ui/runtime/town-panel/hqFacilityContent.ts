import type { WorldState } from "../../../core/state.js";
import type { RosterUnit, Squad } from "../../../core/types.js";
import type { TownFacilityDescriptor, TownFacilityRenderContext, TownFacilityTabId } from "./types.js";

type HqFacilityStats = {
  squadCount: number;
  readySquadCount: number;
  fieldedSquadCount: number;
  readyTruckCount: number;
  fieldedTruckCount: number;
  warning: string | null;
};

const HQ_TAB_LABELS: Array<{ id: TownFacilityTabId; label: string }> = [
  { id: "squads", label: "Squads" },
  { id: "recruit", label: "Recruit" },
  { id: "training", label: "Training" }
];

export const getHqFacilityId = (townId: number): string => `hq:${townId}`;

const getSquadReadyTruckCount = (world: WorldState, squad: Squad): number =>
  squad.truckRosterIds.filter((id) => {
    const truck = world.roster.find((entry) => entry.id === id) ?? null;
    return truck?.kind === "truck" && truck.status === "available";
  }).length;

export const readHqFacilityStats = (world: WorldState): HqFacilityStats => {
  const readySquadCount = world.squads.filter((squad) => getSquadReadyTruckCount(world, squad) > 0).length;
  const fieldedSquadCount = world.squads.filter((squad) =>
    world.commandUnits.some((commandUnit) => commandUnit.squadId === squad.id && commandUnit.truckIds.length > 0)
  ).length;
  const readyTruckCount = world.roster.filter((entry) => entry.kind === "truck" && entry.status === "available").length;
  const fieldedTruckCount = world.roster.filter((entry) => entry.kind === "truck" && entry.status === "deployed").length;
  let warning: string | null = null;
  if (world.squads.length === 0) {
    warning = "No squads configured";
  } else if (readySquadCount === 0 || readyTruckCount === 0) {
    warning = "No ready squads";
  }
  return {
    squadCount: world.squads.length,
    readySquadCount,
    fieldedSquadCount,
    readyTruckCount,
    fieldedTruckCount,
    warning
  };
};

export const buildHqFacilityDescriptor = (world: WorldState, townId: number): TownFacilityDescriptor => {
  const stats = readHqFacilityStats(world);
  const squadLabel = stats.squadCount === 1 ? "squad" : "squads";
  return {
    id: getHqFacilityId(townId),
    type: "hq",
    townId,
    name: "HQ",
    icon: "HQ",
    summary: `${stats.squadCount} ${squadLabel} · ${stats.readySquadCount} ready · ${stats.fieldedSquadCount} field`,
    warning: stats.warning
  };
};

const getHqContentRenderKey = (context: TownFacilityRenderContext): string =>
  JSON.stringify({
    tab: context.activeTabId,
    phase: context.world.phase,
    selectedRosterId: context.world.selectedRosterId,
    selectedSquadId: context.world.selectedSquadId,
    squads: context.world.squads.map((squad) => ({
      id: squad.id,
      name: squad.name,
      truckRosterIds: squad.truckRosterIds,
      revision: squad.revision
    })),
    trucks: context.world.roster
      .filter((entry) => entry.kind === "truck")
      .map((truck) => ({
        id: truck.id,
        name: truck.name,
        status: truck.status,
        squadId: truck.squadId
      })),
    commandUnits: context.world.commandUnits.map((commandUnit) => ({
      id: commandUnit.id,
      squadId: commandUnit.squadId,
      truckIds: commandUnit.truckIds,
      revision: commandUnit.revision
    }))
  });

const createActionButton = (label: string, action: string): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "three-test-town-card-action three-test-hq-action";
  button.dataset.action = action;
  button.textContent = label;
  return button;
};

const createListButton = (
  label: string,
  action: string,
  payload: Record<string, string>,
  selected: boolean,
  dispatchAction: TownFacilityRenderContext["dispatchAction"]
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "three-test-hq-list-button";
  button.classList.toggle("is-selected", selected);
  button.textContent = label;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchAction(action, payload);
  });
  return button;
};

const getSelectedRosterTruck = (world: WorldState): RosterUnit | null => {
  const selected = world.selectedRosterId !== null
    ? world.roster.find((entry) => entry.id === world.selectedRosterId) ?? null
    : null;
  return selected?.kind === "truck" ? selected : null;
};

const bindActionButton = (
  button: HTMLButtonElement,
  dispatchAction: TownFacilityRenderContext["dispatchAction"]
): void => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (button.disabled) {
      return;
    }
    const action = button.dataset.action;
    if (!action) {
      return;
    }
    const payload: Record<string, string> = {};
    if (button.dataset.squadId) {
      payload.squadId = button.dataset.squadId;
    }
    if (button.dataset.rosterId) {
      payload.rosterId = button.dataset.rosterId;
    }
    dispatchAction(action, payload);
  });
};

const renderTabButtons = (root: HTMLElement, context: TownFacilityRenderContext): void => {
  const tabs = document.createElement("div");
  tabs.className = "three-test-facility-tabs";
  HQ_TAB_LABELS.forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "three-test-facility-tab";
    button.classList.toggle("is-active", context.activeTabId === tab.id);
    button.textContent = tab.label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      context.onTabChange(tab.id);
    });
    tabs.appendChild(button);
  });
  root.appendChild(tabs);
};

const renderSquadsTab = (root: HTMLElement, context: TownFacilityRenderContext): void => {
  const { world, dispatchAction } = context;
  const stats = readHqFacilityStats(world);
  const selectedSquad = world.squads.find((squad) => squad.id === world.selectedSquadId) ?? world.squads[0] ?? null;
  const selectedTruck = getSelectedRosterTruck(world);
  const summary = document.createElement("div");
  summary.className = "three-test-hq-summary";
  summary.textContent = `HQ · ${stats.squadCount} squads · ${stats.readyTruckCount} ready · ${stats.fieldedTruckCount} field`;
  const squadList = document.createElement("div");
  squadList.className = "three-test-hq-list";
  world.squads.forEach((squad) => {
    const active = world.commandUnits.find((commandUnit) => commandUnit.squadId === squad.id) ?? null;
    squadList.appendChild(
      createListButton(
        `${squad.name} ${getSquadReadyTruckCount(world, squad)} ready ${active?.truckIds.length ?? 0} field`,
        "select-squad",
        { squadId: String(squad.id) },
        selectedSquad?.id === squad.id,
        dispatchAction
      )
    );
  });
  const truckList = document.createElement("div");
  truckList.className = "three-test-hq-list";
  const truckRows = world.roster
    .filter((entry) => entry.kind === "truck" && entry.status !== "lost")
    .sort((left, right) => left.id - right.id);
  if (truckRows.length === 0) {
    const empty = document.createElement("div");
    empty.className = "three-test-hq-empty";
    empty.textContent = "No trucks recruited.";
    truckList.appendChild(empty);
  } else {
    truckRows.forEach((truck) => {
      const squad = world.squads.find((entry) => entry.id === truck.squadId) ?? null;
      truckList.appendChild(
        createListButton(
          `${truck.name} | ${truck.status} | ${squad?.name ?? "Unassigned"}`,
          "select-roster-id",
          { rosterId: String(truck.id) },
          selectedTruck?.id === truck.id,
          dispatchAction
        )
      );
    });
  }
  const squadActions = document.createElement("div");
  squadActions.className = "three-test-town-card-actions three-test-hq-action-grid";
  const createSquadButton = createActionButton("New Squad", "squad-create");
  const renameSquadButton = createActionButton("Rename", "squad-rename");
  const assignTruckButton = createActionButton("Assign Truck", "squad-assign-truck");
  const removeTruckButton = createActionButton("Remove Truck", "squad-remove-truck");
  assignTruckButton.dataset.rosterId = selectedTruck ? String(selectedTruck.id) : "";
  removeTruckButton.dataset.rosterId = selectedTruck ? String(selectedTruck.id) : "";
  assignTruckButton.disabled = !selectedTruck || selectedTruck.status !== "available";
  removeTruckButton.disabled = !selectedTruck || selectedTruck.status !== "available" || selectedTruck.squadId === null;
  [createSquadButton, renameSquadButton, assignTruckButton, removeTruckButton].forEach((button) =>
    bindActionButton(button, dispatchAction)
  );
  squadActions.append(createSquadButton, renameSquadButton, assignTruckButton, removeTruckButton);
  const deployActions = document.createElement("div");
  deployActions.className = "three-test-town-card-actions three-test-hq-action-grid";
  const dispatchSquadButton = createActionButton("Dispatch", "squad-dispatch");
  const recallSquadButton = createActionButton("Recall", "squad-recall");
  dispatchSquadButton.dataset.squadId = selectedSquad ? String(selectedSquad.id) : "";
  recallSquadButton.dataset.squadId = selectedSquad ? String(selectedSquad.id) : "";
  dispatchSquadButton.disabled = !selectedSquad || selectedSquad.truckRosterIds.length === 0;
  recallSquadButton.disabled = !selectedSquad || !world.commandUnits.some((entry) => entry.squadId === selectedSquad.id);
  [dispatchSquadButton, recallSquadButton].forEach((button) => bindActionButton(button, dispatchAction));
  deployActions.append(dispatchSquadButton, recallSquadButton);
  root.append(summary, squadList, truckList, squadActions, deployActions);
};

const renderRecruitTab = (root: HTMLElement, context: TownFacilityRenderContext): void => {
  const grid = document.createElement("div");
  grid.className = "three-test-town-card-actions three-test-hq-action-grid";
  const recruitTruckButton = createActionButton("Recruit Truck", "recruit-truck");
  const recruitFirefighterButton = createActionButton("Recruit Crew", "recruit-firefighter");
  const maintenanceOpen = context.world.phase === "maintenance";
  [recruitTruckButton, recruitFirefighterButton].forEach((button) => {
    button.disabled = !maintenanceOpen;
    button.title = maintenanceOpen ? "" : "Only available during maintenance.";
    bindActionButton(button, context.dispatchAction);
  });
  grid.append(recruitTruckButton, recruitFirefighterButton);
  const hint = document.createElement("div");
  hint.className = "three-test-hq-empty";
  hint.textContent = maintenanceOpen ? "Recruitment is available now." : "Recruitment is locked outside maintenance.";
  root.append(grid, hint);
};

const renderTrainingTab = (root: HTMLElement, context: TownFacilityRenderContext): void => {
  const grid = document.createElement("div");
  grid.className = "three-test-town-card-actions three-test-hq-action-grid";
  const trainButtons = [
    createActionButton("Speed", "train-speed"),
    createActionButton("Power", "train-power"),
    createActionButton("Range", "train-range"),
    createActionButton("Resilience", "train-resilience")
  ];
  const maintenanceOpen = context.world.phase === "maintenance";
  trainButtons.forEach((button) => {
    button.disabled = !maintenanceOpen;
    button.title = maintenanceOpen ? "" : "Only available during maintenance.";
    bindActionButton(button, context.dispatchAction);
    grid.appendChild(button);
  });
  const hint = document.createElement("div");
  hint.className = "three-test-hq-empty";
  hint.textContent = maintenanceOpen ? "Training is available now." : "Training is locked outside maintenance.";
  root.append(grid, hint);
};

export const renderHqFacilityContent = (root: HTMLElement, context: TownFacilityRenderContext): void => {
  const renderKey = getHqContentRenderKey(context);
  if (root.dataset.hqRenderKey === renderKey && root.childElementCount > 0) {
    return;
  }
  root.dataset.hqRenderKey = renderKey;
  root.replaceChildren();
  renderTabButtons(root, context);
  const body = document.createElement("div");
  body.className = "three-test-facility-tab-body";
  if (context.activeTabId === "recruit") {
    renderRecruitTab(body, context);
  } else if (context.activeTabId === "training") {
    renderTrainingTab(body, context);
  } else {
    renderSquadsTab(body, context);
  }
  root.appendChild(body);
};
