import { RECRUIT_FIREFIGHTER_COST, RECRUIT_TRUCK_COST } from "../../../core/config.js";
import type { WorldState } from "../../../core/state.js";
import type { RosterUnit, Squad } from "../../../core/types.js";
import { formatCurrency } from "../../../core/utils.js";
import { renderHqSquadAssignmentBoard } from "./hqSquadAssignmentBoard.js";
import type { TownFacilityDescriptor, TownFacilityRenderContext, TownFacilityTabId } from "./types.js";

type HqFacilityStats = {
  squadCount: number;
  readySquadCount: number;
  fieldedSquadCount: number;
  readyTruckCount: number;
  fieldedTruckCount: number;
  totalTruckCount: number;
  readyCrewCount: number;
  totalCrewCount: number;
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
  const totalTruckCount = world.roster.filter((entry) => entry.kind === "truck" && entry.status !== "lost").length;
  const readyCrewCount = world.roster.filter((entry) => entry.kind === "firefighter" && entry.status === "available").length;
  const totalCrewCount = world.roster.filter((entry) => entry.kind === "firefighter" && entry.status !== "lost").length;
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
    totalTruckCount,
    readyCrewCount,
    totalCrewCount,
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
    budget: Math.floor(context.world.budget),
    selectedRosterId: context.world.selectedRosterId,
    selectedSquadId: context.world.selectedSquadId,
    crew: context.world.roster
      .filter((entry) => entry.kind === "firefighter")
      .map((crew) => ({
        id: crew.id,
        status: crew.status,
        assignedTruckId: crew.assignedTruckId,
        training: crew.training
      })),
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
        squadId: truck.squadId,
        crewIds: truck.crewIds,
        training: truck.training
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

const createPricedActionButton = (label: string, action: string, cost: number): HTMLButtonElement => {
  const button = createActionButton(label, action);
  const labelSpan = document.createElement("span");
  labelSpan.className = "three-test-hq-action-label";
  labelSpan.textContent = label;
  const costSpan = document.createElement("span");
  costSpan.className = "three-test-hq-action-meta";
  costSpan.textContent = formatCurrency(cost);
  button.replaceChildren(labelSpan, costSpan);
  return button;
};

const getSelectedRosterUnit = (world: WorldState): RosterUnit | null => {
  const selected = world.selectedRosterId !== null
    ? world.roster.find((entry) => entry.id === world.selectedRosterId) ?? null
    : null;
  return selected;
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
  renderHqSquadAssignmentBoard(root, context, readHqFacilityStats(context.world));
};

const renderRecruitTab = (root: HTMLElement, context: TownFacilityRenderContext): void => {
  const stats = readHqFacilityStats(context.world);
  const budget = Math.max(0, Math.floor(context.world.budget));
  const maintenanceOpen = context.world.phase === "maintenance";
  const summary = document.createElement("div");
  summary.className = "three-test-hq-recruit-summary";
  const budgetItem = document.createElement("span");
  budgetItem.textContent = `Budget ${formatCurrency(budget)}`;
  const truckItem = document.createElement("span");
  truckItem.textContent = `Trucks ${stats.readyTruckCount}/${stats.totalTruckCount}`;
  const crewItem = document.createElement("span");
  crewItem.textContent = `Crew ${stats.readyCrewCount}/${stats.totalCrewCount}`;
  summary.append(budgetItem, truckItem, crewItem);

  const grid = document.createElement("div");
  grid.className = "three-test-town-card-actions three-test-hq-action-grid";
  const recruitTruckButton = createPricedActionButton("Recruit Truck", "recruit-truck", RECRUIT_TRUCK_COST);
  const recruitFirefighterButton = createPricedActionButton("Recruit Crew", "recruit-firefighter", RECRUIT_FIREFIGHTER_COST);
  [
    { button: recruitTruckButton, cost: RECRUIT_TRUCK_COST, label: "truck" },
    { button: recruitFirefighterButton, cost: RECRUIT_FIREFIGHTER_COST, label: "crew" }
  ].forEach(({ button, cost, label }) => {
    const affordable = budget >= cost;
    button.disabled = !maintenanceOpen || !affordable;
    button.title = !maintenanceOpen
      ? "Only available during maintenance."
      : affordable
        ? `Recruit ${label} for ${formatCurrency(cost)}.`
        : `Need ${formatCurrency(cost)} to recruit ${label}.`;
    bindActionButton(button, context.dispatchAction);
  });
  grid.append(recruitTruckButton, recruitFirefighterButton);
  const hint = document.createElement("div");
  hint.className = "three-test-hq-empty";
  hint.textContent = maintenanceOpen ? "Recruitment is available now." : "Recruitment is locked outside maintenance.";
  root.append(summary, grid, hint);
};

const renderTrainingTab = (root: HTMLElement, context: TownFacilityRenderContext): void => {
  const selected = getSelectedRosterUnit(context.world);
  const summary = document.createElement("div");
  summary.className = "three-test-hq-training-summary";
  summary.textContent = selected
    ? `Selected unit training - ${selected.name} (${selected.kind === "truck" ? "truck" : "crew"})`
    : "Selected unit training - select a truck or firefighter chip first.";
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
    button.disabled = !maintenanceOpen || !selected || selected.status === "lost";
    button.title = !maintenanceOpen
      ? "Only available during maintenance."
      : selected && selected.status !== "lost"
        ? `Train selected unit: ${selected.name}.`
        : "Select an available roster unit first.";
    bindActionButton(button, context.dispatchAction);
    grid.appendChild(button);
  });
  const hint = document.createElement("div");
  hint.className = "three-test-hq-empty";
  hint.textContent = maintenanceOpen
    ? "Training applies to the selected roster unit until a broader training model is chosen."
    : "Training is locked outside maintenance.";
  root.append(summary, grid, hint);
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
