import { TRUCK_CAPACITY } from "../../../core/config.js";
import type { RosterUnit, Squad } from "../../../core/types.js";
import {
  createSquadLoadoutCrewDots,
  createSquadLoadoutTruckSlot,
  SQUAD_LOADOUT_FIREFIGHTER_ICON,
  SQUAD_LOADOUT_TRUCK_ICON
} from "../../squad-loadout/squadLoadoutIcons.js";
import type { TownFacilityRenderContext } from "./types.js";

type DispatchAction = TownFacilityRenderContext["dispatchAction"];
type AssignmentSubtab = "squad-trucks" | "truck-crew";

type DragPayload =
  | { kind: "truck"; rosterId: number }
  | { kind: "crew"; rosterId: number };

type HqSquadAssignmentStats = {
  squadCount: number;
  readyTruckCount: number;
  fieldedTruckCount: number;
  readyCrewCount: number;
  totalCrewCount: number;
};

const DRAG_MIME = "application/x-firefighterai-hq-roster";
const activeSubtabByFacility = new Map<string, AssignmentSubtab>();
const FIXED_SQUAD_COUNT = 5;
const SQUAD_TRUCK_SLOT_COUNT = 5;

const statusLabel = (unit: RosterUnit): string =>
  unit.status === "lost" ? "Lost" : unit.status === "deployed" ? "Fielded" : "Ready";

const getActiveSubtab = (facilityId: string): AssignmentSubtab =>
  activeSubtabByFacility.get(facilityId) ?? "squad-trucks";

const setActiveSubtab = (facilityId: string, subtab: AssignmentSubtab): void => {
  activeSubtabByFacility.set(facilityId, subtab);
};

const canDragTruck = (truck: RosterUnit): boolean => truck.kind === "truck" && truck.status === "available";

const canEditCrew = (crew: RosterUnit, context: TownFacilityRenderContext): boolean =>
  context.world.phase === "maintenance" && crew.kind === "firefighter" && crew.status === "available";

const getTruckCrew = (truck: RosterUnit, roster: readonly RosterUnit[]): RosterUnit[] => {
  const crewById = new Map(
    roster.filter((entry) => entry.kind === "firefighter").map((entry) => [entry.id, entry] as const)
  );
  return truck.crewIds.map((id) => crewById.get(id) ?? null).filter((entry): entry is RosterUnit => !!entry);
};

const getSquadTrucks = (squad: Squad, roster: readonly RosterUnit[]): RosterUnit[] => {
  const truckById = new Map(
    roster.filter((entry) => entry.kind === "truck" && entry.status !== "lost").map((entry) => [entry.id, entry] as const)
  );
  return squad.truckRosterIds.map((id) => truckById.get(id) ?? null).filter((entry): entry is RosterUnit => !!entry);
};

const getTruckWaterRatio = (truck: RosterUnit, context: TownFacilityRenderContext): number | null => {
  if (truck.status === "available") {
    return 1;
  }
  const deployedTruck = context.world.units.find((unit) => unit.kind === "truck" && unit.rosterId === truck.id) ?? null;
  if (!deployedTruck || deployedTruck.waterCapacity <= 0) {
    return null;
  }
  return Math.max(0, Math.min(1, deployedTruck.water / deployedTruck.waterCapacity));
};

const makePayload = (payload: DragPayload): string => JSON.stringify(payload);

const readPayload = (event: DragEvent, currentDrag: DragPayload | null): DragPayload | null => {
  if (currentDrag) {
    return currentDrag;
  }
  const raw = event.dataTransfer?.getData(DRAG_MIME) || event.dataTransfer?.getData("text/plain");
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<DragPayload>;
    if ((parsed.kind === "truck" || parsed.kind === "crew") && Number.isFinite(parsed.rosterId)) {
      return { kind: parsed.kind, rosterId: Number(parsed.rosterId) };
    }
  } catch {
    return null;
  }
  return null;
};

const bindActivation = (
  element: HTMLElement,
  dispatchAction: DispatchAction,
  action: string,
  payload: Record<string, string>
): void => {
  const run = (event: Event): void => {
    event.preventDefault();
    event.stopPropagation();
    dispatchAction(action, payload);
  };
  element.addEventListener("click", run);
  element.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      run(event);
    }
  });
};

const createActionButton = (
  label: string,
  action: string,
  payload: Record<string, string>,
  dispatchAction: DispatchAction,
  disabled = false
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "three-test-hq-board-action";
  button.textContent = label;
  button.disabled = disabled;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!button.disabled) {
      dispatchAction(action, payload);
    }
  });
  return button;
};

const bindDropZone = (
  element: HTMLElement,
  accept: DragPayload["kind"],
  readCurrentDrag: (event: DragEvent) => DragPayload | null,
  onDrop: (payload: DragPayload) => void
): void => {
  element.addEventListener("dragover", (event) => {
    const payload = readCurrentDrag(event);
    if (payload?.kind !== accept) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
    element.classList.add("is-drop-ready");
  });
  element.addEventListener("dragleave", (event) => {
    if (event.currentTarget === element) {
      element.classList.remove("is-drop-ready");
    }
  });
  element.addEventListener("drop", (event) => {
    const payload = readCurrentDrag(event);
    element.classList.remove("is-drop-ready");
    if (payload?.kind !== accept) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    onDrop(payload);
  });
};

const bindDraggable = (
  element: HTMLElement,
  payload: DragPayload,
  setCurrentDrag: (payload: DragPayload | null) => void
): void => {
  element.draggable = true;
  element.addEventListener("dragstart", (event) => {
    event.stopPropagation();
    setCurrentDrag(payload);
    element.classList.add("is-dragging");
    event.dataTransfer?.setData(DRAG_MIME, makePayload(payload));
    event.dataTransfer?.setData("text/plain", makePayload(payload));
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
    }
  });
  element.addEventListener("dragend", () => {
    setCurrentDrag(null);
    element.classList.remove("is-dragging");
  });
};

const createColumnHeader = (title: string, meta: string): HTMLElement => {
  const header = document.createElement("div");
  header.className = "three-test-hq-column-header";
  const titleEl = document.createElement("span");
  titleEl.textContent = title;
  const metaEl = document.createElement("span");
  metaEl.textContent = meta;
  header.append(titleEl, metaEl);
  return header;
};

const appendEmptyCrewSlots = (root: HTMLElement, count: number): void => {
  for (let index = 0; index < count; index += 1) {
    const dot = document.createElement("span");
    dot.className = "three-test-hq-crew-dot";
    dot.textContent = SQUAD_LOADOUT_FIREFIGHTER_ICON;
    root.appendChild(dot);
  }
};

const createTruckSlot = (
  truck: RosterUnit | null,
  context: TownFacilityRenderContext,
  setCurrentDrag: (payload: DragPayload | null) => void
): HTMLElement => {
  if (!truck) {
    const slot = createSquadLoadoutTruckSlot({
      tagName: "div",
      slotClassName: "three-test-hq-vehicle-slot",
      crewCount: 0,
      className: "three-test-hq-vehicle-crew-dots",
      dotClassName: "three-test-hq-vehicle-crew-dot",
      empty: true,
      includeCrewDots: false
    });
    slot.title = "Open vehicle slot.";
    return slot;
  }
  const crew = getTruckCrew(truck, context.world.roster);
  const waterRatio = getTruckWaterRatio(truck, context);
  const slot = createSquadLoadoutTruckSlot({
    tagName: "div",
    slotClassName: "three-test-hq-vehicle-slot",
    crewCount: crew.length,
    className: "three-test-hq-vehicle-crew-dots",
    dotClassName: "three-test-hq-vehicle-crew-dot",
    waterRatio
  });
  slot.classList.toggle("is-selected", context.world.selectedRosterId === truck.id);
  slot.classList.toggle("is-disabled", truck.status !== "available");
  slot.dataset.rosterId = String(truck.id);
  slot.setAttribute("role", "button");
  slot.tabIndex = 0;
  slot.title = `${truck.name}. ${statusLabel(truck)}. ${crew.length}/${TRUCK_CAPACITY} crew.`;
  if (waterRatio !== null) {
    slot.title = `${slot.title} Water ${Math.round(waterRatio * 100)}%.`;
  }
  bindActivation(slot, context.dispatchAction, "select-roster-id", { rosterId: String(truck.id) });
  if (canDragTruck(truck)) {
    bindDraggable(slot, { kind: "truck", rosterId: truck.id }, setCurrentDrag);
  } else {
    slot.setAttribute("aria-disabled", "true");
  }
  return slot;
};

const createCrewIcon = (
  crew: RosterUnit,
  context: TownFacilityRenderContext,
  setCurrentDrag: (payload: DragPayload | null) => void
): HTMLElement => {
  const icon = document.createElement("div");
  icon.className = "three-test-hq-crew-icon";
  icon.classList.toggle("is-selected", context.world.selectedRosterId === crew.id);
  icon.classList.toggle("is-disabled", !canEditCrew(crew, context));
  icon.dataset.rosterId = String(crew.id);
  icon.setAttribute("role", "button");
  icon.tabIndex = 0;
  icon.textContent = SQUAD_LOADOUT_FIREFIGHTER_ICON;
  icon.title = `${crew.name}. ${statusLabel(crew)} crew.`;
  bindActivation(icon, context.dispatchAction, "select-roster-id", { rosterId: String(crew.id) });
  if (canEditCrew(crew, context)) {
    bindDraggable(icon, { kind: "crew", rosterId: crew.id }, setCurrentDrag);
  } else {
    icon.setAttribute("aria-disabled", "true");
  }
  return icon;
};

const renderSubtabs = (
  root: HTMLElement,
  context: TownFacilityRenderContext,
  activeSubtab: AssignmentSubtab,
  stats: HqSquadAssignmentStats
): void => {
  const summary = document.createElement("div");
  summary.className = "three-test-hq-board-summary";
  summary.textContent = `Squads ${stats.squadCount} | Trucks ${stats.readyTruckCount} ready, ${stats.fieldedTruckCount} fielded | Crew ${stats.readyCrewCount}/${stats.totalCrewCount} ready`;

  const tabs = document.createElement("div");
  tabs.className = "three-test-hq-assignment-subtabs";
  [
    { id: "squad-trucks" as const, label: "Squad Trucks" },
    { id: "truck-crew" as const, label: "Truck Crew" }
  ].forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "three-test-hq-assignment-subtab";
    button.classList.toggle("is-active", activeSubtab === tab.id);
    button.textContent = tab.label;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      setActiveSubtab(context.facility.id, tab.id);
      root.replaceChildren();
      renderHqSquadAssignmentBoard(root, context, stats);
    });
    tabs.appendChild(button);
  });
  root.append(summary, tabs);
};

const renderSquadTruckBoard = (
  root: HTMLElement,
  context: TownFacilityRenderContext,
  readCurrentDrag: (event: DragEvent) => DragPayload | null,
  setCurrentDrag: (payload: DragPayload | null) => void
): void => {
  const { world, dispatchAction } = context;
  const selectedSquad = world.squads.find((squad) => squad.id === world.selectedSquadId) ?? world.squads[0] ?? null;
  const unassignedTrucks = world.roster
    .filter((entry) => entry.kind === "truck" && entry.status !== "lost" && entry.squadId === null)
    .sort((left, right) => left.id - right.id);

  const board = document.createElement("div");
  board.className = "three-test-hq-assignment-board three-test-hq-assignment-board--trucks";
  world.squads.slice(0, FIXED_SQUAD_COUNT).forEach((squad) => {
    const trucks = getSquadTrucks(squad, world.roster);
    const ready = trucks.filter((truck) => truck.status === "available").length;
    const column = document.createElement("section");
    column.className = "three-test-hq-squad-column three-test-hq-squad-column--squad";
    column.classList.toggle("is-selected", selectedSquad?.id === squad.id);
    column.dataset.squadId = String(squad.id);
    column.appendChild(createColumnHeader(squad.name, `${ready} ready | ${trucks.length} assigned`));
    bindActivation(column, dispatchAction, "select-squad", { squadId: String(squad.id) });
    bindDropZone(column, "truck", readCurrentDrag, (payload) => {
      dispatchAction("squad-move-truck", { rosterId: String(payload.rosterId), squadId: String(squad.id) });
    });
    const slots = document.createElement("div");
    slots.className = "three-test-hq-vehicle-slots";
    for (let index = 0; index < SQUAD_TRUCK_SLOT_COUNT; index += 1) {
      slots.appendChild(createTruckSlot(trucks[index] ?? null, context, setCurrentDrag));
    }
    column.appendChild(slots);
    board.appendChild(column);
  });

  const truckPool = document.createElement("section");
  truckPool.className = "three-test-hq-squad-column three-test-hq-pool-column";
  truckPool.appendChild(createColumnHeader("Available Trucks", `${unassignedTrucks.length} unassigned`));
  bindDropZone(truckPool, "truck", readCurrentDrag, (payload) => {
    dispatchAction("squad-unassign-truck", { rosterId: String(payload.rosterId) });
  });
  const truckPoolList = document.createElement("div");
  truckPoolList.className = "three-test-hq-vehicle-slots";
  if (unassignedTrucks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "three-test-hq-board-empty";
    empty.textContent = "No unassigned trucks";
    truckPoolList.appendChild(empty);
  } else {
    unassignedTrucks.forEach((truck) => truckPoolList.appendChild(createTruckSlot(truck, context, setCurrentDrag)));
  }
  truckPool.appendChild(truckPoolList);
  board.appendChild(truckPool);

  const actions = document.createElement("div");
  actions.className = "three-test-town-card-actions three-test-hq-action-grid";
  actions.append(
    createActionButton("Dispatch", "squad-dispatch", { squadId: selectedSquad ? String(selectedSquad.id) : "" }, dispatchAction, !selectedSquad || selectedSquad.truckRosterIds.length === 0),
    createActionButton("Recall", "squad-recall", { squadId: selectedSquad ? String(selectedSquad.id) : "" }, dispatchAction, !selectedSquad || !world.commandUnits.some((entry) => entry.squadId === selectedSquad.id))
  );

  root.append(board, actions);
};

const renderTruckCrewBoard = (
  root: HTMLElement,
  context: TownFacilityRenderContext,
  readCurrentDrag: (event: DragEvent) => DragPayload | null,
  setCurrentDrag: (payload: DragPayload | null) => void
): void => {
  const { world, dispatchAction } = context;
  const selectedSquad = world.squads.find((squad) => squad.id === world.selectedSquadId) ?? world.squads[0] ?? null;
  const trucks = selectedSquad ? getSquadTrucks(selectedSquad, world.roster) : [];
  const unassignedCrew = world.roster
    .filter((entry) => entry.kind === "firefighter" && entry.status !== "lost" && entry.assignedTruckId === null)
    .sort((left, right) => left.id - right.id);
  const selectedRoster = world.selectedRosterId !== null
    ? world.roster.find((entry) => entry.id === world.selectedRosterId) ?? null
    : null;

  const layout = document.createElement("div");
  layout.className = "three-test-hq-crew-loadout-board";
  const squadHeader = document.createElement("section");
  squadHeader.className = "three-test-hq-crew-squad-panel";
  squadHeader.appendChild(
    createColumnHeader(
      selectedSquad ? `${selectedSquad.name} Crew` : "Squad Crew",
      selectedSquad ? `${trucks.length} squad truck${trucks.length === 1 ? "" : "s"}` : "No squad selected"
    )
  );
  layout.appendChild(squadHeader);

  const crewPool = document.createElement("section");
  crewPool.className = "three-test-hq-available-crew-panel";
  crewPool.appendChild(createColumnHeader("Available Crew", `${unassignedCrew.length} unassigned`));
  if (world.phase === "maintenance") {
    bindDropZone(crewPool, "crew", readCurrentDrag, (payload) => {
      dispatchAction("crew-unassign", { firefighterId: String(payload.rosterId) });
    });
  }
  const crewIcons = document.createElement("div");
  crewIcons.className = "three-test-hq-available-crew-icons";
  if (unassignedCrew.length === 0) {
    const empty = document.createElement("div");
    empty.className = "three-test-hq-board-empty";
    empty.textContent = "No unassigned crew";
    crewIcons.appendChild(empty);
  } else {
    unassignedCrew.forEach((crew) => crewIcons.appendChild(createCrewIcon(crew, context, setCurrentDrag)));
  }
  crewPool.appendChild(crewIcons);
  layout.appendChild(crewPool);

  const truckList = document.createElement("div");
  truckList.className = "three-test-hq-crew-truck-list";
  if (trucks.length === 0) {
    const empty = document.createElement("div");
    empty.className = "three-test-hq-board-empty three-test-hq-crew-squad-empty";
    empty.textContent = selectedSquad ? "No trucks assigned to this squad." : "Select a squad to manage truck crew.";
    truckList.appendChild(empty);
  }
  trucks.forEach((truck) => {
    const crew = getTruckCrew(truck, world.roster);
    const card = document.createElement("section");
    card.className = "three-test-hq-crew-truck-card";
    card.classList.toggle("is-selected", world.selectedRosterId === truck.id);
    card.classList.toggle("is-disabled", truck.status === "lost");
    card.dataset.rosterId = String(truck.id);
    card.title = `${truck.name}. ${crew.length}/${TRUCK_CAPACITY} crew.`;
    bindActivation(card, dispatchAction, "select-roster-id", { rosterId: String(truck.id) });
    const canAcceptCrew = world.phase === "maintenance" && truck.status !== "lost" && crew.length < TRUCK_CAPACITY;
    if (canAcceptCrew) {
      bindDropZone(card, "crew", readCurrentDrag, (payload) => {
        dispatchAction("crew-assign-to-truck", {
          firefighterId: String(payload.rosterId),
          truckId: String(truck.id)
        });
      });
    }

    const header = document.createElement("div");
    header.className = "three-test-hq-crew-truck-header";
    const title = document.createElement("span");
    title.textContent = truck.name;
    const meta = document.createElement("span");
    meta.textContent = `${statusLabel(truck)} ${crew.length}/${TRUCK_CAPACITY}`;
    header.append(title, meta);
    const cardIcon = document.createElement("span");
    cardIcon.className = "three-test-hq-chip-icon three-test-hq-chip-icon--truck";
    cardIcon.textContent = SQUAD_LOADOUT_TRUCK_ICON;
    header.prepend(cardIcon);
    const crewSlots = document.createElement("div");
    crewSlots.className = "three-test-hq-crew-slots";
    crew.forEach((member) => crewSlots.appendChild(createCrewIcon(member, context, setCurrentDrag)));
    appendEmptyCrewSlots(crewSlots, Math.max(0, TRUCK_CAPACITY - crew.length));
    card.append(header, crewSlots);
    truckList.appendChild(card);
  });
  if (selectedRoster?.kind === "firefighter" && selectedRoster.assignedTruckId !== null) {
    crewPool.title = `${selectedRoster.name} selected. Drag the firefighter icon here to unassign.`;
  }
  layout.appendChild(truckList);
  root.appendChild(layout);
};

export const renderHqSquadAssignmentBoard = (
  root: HTMLElement,
  context: TownFacilityRenderContext,
  stats: HqSquadAssignmentStats
): void => {
  let currentDrag: DragPayload | null = null;
  const setCurrentDrag = (payload: DragPayload | null): void => {
    currentDrag = payload;
  };
  const readCurrentDrag = (event: DragEvent): DragPayload | null => readPayload(event, currentDrag);
  const activeSubtab = getActiveSubtab(context.facility.id);

  renderSubtabs(root, context, activeSubtab, stats);
  if (activeSubtab === "truck-crew") {
    renderTruckCrewBoard(root, context, readCurrentDrag, setCurrentDrag);
  } else {
    renderSquadTruckBoard(root, context, readCurrentDrag, setCurrentDrag);
  }
};
