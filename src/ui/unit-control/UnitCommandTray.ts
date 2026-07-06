import { TRUCK_CAPACITY } from "../../core/config.js";
import type { InputState } from "../../core/inputState.js";
import type { WorldState } from "../../core/state.js";
import type {
  BehaviourMode,
  CommandFireTask,
  CommandIntent,
  CommandFormation,
  CommandPlacementMode,
  CommandType,
  CommandUnit,
  CommandUnitAlert,
  CommandUnitStatus,
  RosterUnit,
  Squad,
  Unit
} from "../../core/types.js";
import { createSquadLoadoutTruckSlot } from "../squad-loadout/squadLoadoutIcons.js";

export type CommandMode = CommandPlacementMode | CommandFireTask;

type UnitCommandTrayAction = (action: string, payload?: Record<string, string>) => void;
type UnitCommandTrayStatus = (message: string) => void;

export type UnitCommandTray = {
  element: HTMLElement;
  update: (state: WorldState, inputState: InputState, hoveredCommandUnitId?: number | null) => void;
};

export type UnitCommandTrayOptions = {
  onAction: UnitCommandTrayAction;
  onStatus: UnitCommandTrayStatus;
  onSquadHover?: (commandUnitId: number | null) => void;
};

type CommandGroupCard = {
  commandUnit: CommandUnit | null;
  squad: Squad | null;
  rosterTrucks: RosterUnit[];
  trucks: Unit[];
};

type SelectedUnitCard = {
  truck: Unit;
  effectiveIntent: CommandIntent | null;
};

type CommandButtonSpec = {
  label: string;
  mode: CommandMode;
  action?: string;
  disabled?: boolean;
  danger?: boolean;
  title?: string;
};

type CommandBarSeverity = "none" | "warning" | "critical";

const SQUAD_SLOT_COUNT = 5;

const PLACEMENT_BUTTONS: readonly CommandButtonSpec[] = [
  { label: "Move", mode: "move", action: "command-placement-move" },
  { label: "Deploy", mode: "deploy", action: "command-placement-deploy" },
  { label: "Relocate", mode: "relocate", action: "command-placement-relocate" },
  { label: "Recall", mode: "recall", action: "command-placement-recall" }
];

const FIRE_TASK_BUTTONS: readonly CommandButtonSpec[] = [
  { label: "Suppress", mode: "suppress", action: "command-task-suppress" },
  { label: "Contain", mode: "contain", action: "command-task-contain" },
  { label: "Backburn", mode: "backburn", action: "command-task-backburn", danger: true },
  { label: "Hold Fire", mode: "hold_fire", action: "command-task-hold-fire" }
];

const BEHAVIOUR_BUTTONS: ReadonlyArray<{ label: string; action: string; mode: BehaviourMode }> = [
  { label: "Aggressive", action: "behaviour-aggressive", mode: "aggressive" },
  { label: "Balanced", action: "behaviour-balanced", mode: "balanced" },
  { label: "Defensive", action: "behaviour-defensive", mode: "defensive" }
];

const DISPATCH_FORMATION_BUTTONS: ReadonlyArray<{
  label: string;
  action: string;
  formation: Extract<CommandFormation, "line" | "wedge" | "arc">;
}> = [
  { label: "Line", action: "dispatch-formation-line", formation: "line" },
  { label: "Wedge", action: "dispatch-formation-wedge", formation: "wedge" },
  { label: "Arc", action: "dispatch-formation-arc", formation: "arc" }
];

const getUnitLabel = (state: WorldState, unitId: number): string => {
  const rosterUnit = state.roster.find((entry) => entry.id === unitId) ?? null;
  return rosterUnit?.name ?? `Unit ${unitId}`;
};

const getTruckLabel = (state: WorldState, truck: Unit): string =>
  truck.rosterId !== null ? getUnitLabel(state, truck.rosterId) : getUnitLabel(state, truck.id);

const getCommandUnitTrucks = (state: WorldState, commandUnit: CommandUnit): Unit[] =>
  commandUnit.truckIds
    .map((truckId) => state.units.find((entry) => entry.id === truckId && entry.kind === "truck") ?? null)
    .filter((entry): entry is Unit => !!entry)
    .sort((left, right) => (left.rosterId ?? left.id) - (right.rosterId ?? right.id));

const getSquadRosterTrucks = (state: WorldState, squad: Squad): RosterUnit[] => {
  const rosterTruckById = new Map(
    state.roster.filter((entry) => entry.kind === "truck" && entry.status !== "lost").map((entry) => [entry.id, entry] as const)
  );
  return squad.truckRosterIds.map((id) => rosterTruckById.get(id) ?? null).filter((entry): entry is RosterUnit => !!entry);
};

const getEffectiveTruckIntent = (
  truck: Unit,
  commandUnitById: ReadonlyMap<number, CommandUnit>
): CommandIntent | null => {
  if (truck.truckOverrideIntent) {
    return truck.truckOverrideIntent;
  }
  if (truck.commandUnitId === null) {
    return null;
  }
  return commandUnitById.get(truck.commandUnitId)?.currentIntent ?? null;
};

const getCommandTypeLabel = (type: CommandType | null): string => {
  if (!type) {
    return "Auto";
  }
  const label = type === "hold_fire" ? "Hold Fire" : type;
  return `${label[0]!.toUpperCase()}${label.slice(1)}`;
};

const getPlacementLabel = (mode: CommandPlacementMode | null): string => (mode ? getCommandTypeLabel(mode) : "Auto");

const getFireTaskLabel = (task: CommandFireTask | null): string => (task ? getCommandTypeLabel(task) : "Auto");

const getBehaviourLabel = (mode: BehaviourMode): string => `${mode[0]!.toUpperCase()}${mode.slice(1)}`;

const getStatusLabel = (status: CommandUnitStatus): string => `${status[0]!.toUpperCase()}${status.slice(1)}`;

const getCrewModeLabel = (truck: Unit): string => {
  if (truck.crewAction?.kind === "boarding" || truck.crewMode === "boarding") {
    return "Boarding";
  }
  if (truck.crewAction?.kind === "disembarking" || truck.crewMode === "disembarking") {
    return "Deploying";
  }
  return truck.crewMode === "boarded" ? "Boarded" : "Deployed";
};

const getProjectionLabel = (inputState: InputState): string | null => {
  const projection = inputState.formationProjection;
  if (!projection) {
    return null;
  }
  const degrees = Math.round((Math.atan2(projection.facing.y, projection.facing.x) * 180) / Math.PI);
  const normalizedDegrees = (degrees + 360) % 360;
  return `Projecting ${inputState.dispatchFormation} | width ${projection.widthTiles.toFixed(1)} | facing ${normalizedDegrees}deg`;
};

const getSquadTrayStatusLabel = (status: CommandUnitStatus, fielded: boolean, truckCount: number): string => {
  if (truckCount <= 0) {
    return "No Trucks";
  }
  if (!fielded) {
    return "At HQ";
  }
  if (status === "suppressing") {
    return "On fireline";
  }
  if (status === "moving") {
    return "En route";
  }
  if (status === "boarding") {
    return "Boarding";
  }
  if (status === "deploying") {
    return "Deploying";
  }
  if (status === "retreating") {
    return "Withdrawing";
  }
  return "Holding";
};

const getStatusIcon = (status: CommandUnitStatus): string => {
  if (status === "suppressing") {
    return "SUP";
  }
  if (status === "moving") {
    return "MOV";
  }
  if (status === "boarding") {
    return "BRD";
  }
  if (status === "deploying") {
    return "DEP";
  }
  if (status === "retreating") {
    return "RT";
  }
  return "HLD";
};

const getWaterRatio = (current: number, capacity: number): number =>
  capacity > 0 ? Math.max(0, Math.min(1, current / capacity)) : 1;

const getWaterLevel = (ratio: number): "empty" | "low" | "mid" | "high" => {
  if (ratio <= 0.2) {
    return "empty";
  }
  if (ratio <= 0.4) {
    return "low";
  }
  if (ratio <= 0.7) {
    return "mid";
  }
  return "high";
};

const getAlertPriority = (alert: CommandUnitAlert): number => {
  switch (alert) {
    case "danger":
    case "empty":
    case "critical":
      return 3;
    case "warning":
    case "crew_low":
    case "hose_unstaffed":
    case "crew_transition":
    case "deploy_required":
    case "out_of_range":
    case "holding_fire":
      return 2;
    case "driver_missing":
      return 3;
    case "low":
      return 1;
    default:
      return 0;
  }
};

const getAlertText = (alert: CommandUnitAlert): string => {
  switch (alert) {
    case "danger":
      return "Danger";
    case "empty":
      return "Empty";
    case "critical":
      return "Critical";
    case "warning":
      return "Warning";
    case "crew_low":
      return "Crew";
    case "driver_missing":
      return "No Driver";
    case "hose_unstaffed":
      return "No Hose";
    case "crew_transition":
      return "Crew Moving";
    case "deploy_required":
      return "Deploy";
    case "out_of_range":
      return "Out of Range";
    case "holding_fire":
      return "Hold Fire";
    case "low":
      return "Low";
    default:
      return "Alert";
  }
};

const resolveHighestAlert = (alerts: readonly CommandUnitAlert[]): CommandUnitAlert | null => {
  let best: CommandUnitAlert | null = null;
  let bestPriority = -1;
  alerts.forEach((alert) => {
    const priority = getAlertPriority(alert);
    if (priority > bestPriority) {
      bestPriority = priority;
      best = alert;
    }
  });
  return best;
};

const getSeverityForAlert = (alert: CommandUnitAlert | null): CommandBarSeverity => {
  if (!alert) {
    return "none";
  }
  return getAlertPriority(alert) >= 3 ? "critical" : "warning";
};

const resolveMajorityStatus = (trucks: Unit[]): CommandUnitStatus => {
  const counts = new Map<CommandUnitStatus, number>();
  trucks.forEach((truck) => counts.set(truck.currentStatus, (counts.get(truck.currentStatus) ?? 0) + 1));
  const priority: CommandUnitStatus[] = ["retreating", "suppressing", "deploying", "boarding", "moving", "holding"];
  let bestStatus: CommandUnitStatus = "holding";
  let bestCount = -1;
  priority.forEach((status) => {
    const count = counts.get(status) ?? 0;
    if (count > bestCount) {
      bestStatus = status;
      bestCount = count;
    }
  });
  return bestStatus;
};

const createStat = (label: string, value: string): HTMLSpanElement => {
  const stat = document.createElement("span");
  stat.className = "three-test-command-unit-stat";
  stat.textContent = `${label} ${value}`;
  return stat;
};

const createWaterMeter = (ratio: number, label: string): HTMLDivElement => {
  const meter = document.createElement("div");
  meter.className = "three-test-command-unit-water";
  meter.dataset.level = getWaterLevel(ratio);
  meter.title = label;
  const fill = document.createElement("div");
  fill.className = "three-test-command-unit-water-fill";
  fill.style.width = `${Math.round(ratio * 100)}%`;
  meter.appendChild(fill);
  return meter;
};

const appendTrayTruckSlot = (
  root: HTMLElement,
  crewCount: number,
  waterRatio: number | null,
  empty: boolean
): void => {
  const slot = createSquadLoadoutTruckSlot({
    slotClassName: "three-test-squad-slot-truck",
    crewCount,
    className: "three-test-squad-slot-crew-dots",
    dotClassName: "three-test-squad-slot-crew-dot",
    waterRatio,
    empty,
    includeCrewDots: !empty
  });
  root.appendChild(slot);
};

const createTrayTruckRack = (cardModel: CommandGroupCard): HTMLDivElement => {
  const rack = document.createElement("div");
  rack.className = "three-test-squad-slot-truck-rack";
  const fieldedByRosterId = new Map(
    cardModel.trucks
      .filter((truck) => truck.rosterId !== null)
      .map((truck) => [truck.rosterId as number, truck] as const)
  );
  for (let index = 0; index < SQUAD_SLOT_COUNT; index += 1) {
    const rosterTruck = cardModel.rosterTrucks[index] ?? null;
    const fieldedTruck =
      cardModel.trucks[index] ??
      (rosterTruck ? fieldedByRosterId.get(rosterTruck.id) ?? null : null);
    if (!rosterTruck && !fieldedTruck) {
      appendTrayTruckSlot(rack, 0, null, true);
      continue;
    }
    const crewCount = fieldedTruck?.crewIds.length ?? rosterTruck?.crewIds.length ?? 0;
    const waterRatio = fieldedTruck
      ? getWaterRatio(fieldedTruck.water, fieldedTruck.waterCapacity)
      : rosterTruck?.status === "available"
        ? 1
        : null;
    appendTrayTruckSlot(rack, crewCount, waterRatio, false);
  }
  return rack;
};

const createSquadSlot = (
  cardModel: CommandGroupCard,
  selected: boolean,
  focused: boolean,
  hovered: boolean,
  slotIndex: number,
  onAction: UnitCommandTrayAction
): HTMLButtonElement => {
  const { commandUnit, squad, rosterTrucks, trucks } = cardModel;
  const aggregateAlerts = trucks.flatMap((truck) => truck.currentAlerts);
  const highestAlert = resolveHighestAlert(aggregateAlerts);
  const effectiveStatus = trucks.length > 0 ? resolveMajorityStatus(trucks) : squad?.status ?? "holding";
  const fielded = !!commandUnit && trucks.length > 0;
  const truckCount = Math.max(trucks.length, rosterTrucks.length);
  const statusLabel = getSquadTrayStatusLabel(effectiveStatus, fielded, truckCount);
  const intentLabel = commandUnit?.currentIntent
    ? `${getPlacementLabel(commandUnit.currentIntent.placementMode)} | ${getFireTaskLabel(commandUnit.currentIntent.fireTask)}`
    : squad?.currentIntent
      ? `${getPlacementLabel(squad.currentIntent.placementMode)} | ${getFireTaskLabel(squad.currentIntent.fireTask)}`
    : "Auto";
  const slotName = commandUnit?.name ?? squad?.name ?? "Empty";

  const card = document.createElement("button");
  card.type = "button";
  card.className = "three-test-squad-slot";
  if (commandUnit) {
    card.dataset.commandUnitId = String(commandUnit.id);
  }
  if (squad) {
    card.dataset.squadId = String(squad.id);
  }
  card.classList.toggle("is-selected", selected);
  card.classList.toggle("is-focused", focused);
  card.classList.toggle("is-world-hovered", hovered);
  card.classList.toggle("is-at-hq", !fielded && truckCount > 0);
  card.classList.toggle("is-unstaffed", truckCount <= 0);

  const header = document.createElement("div");
  header.className = "three-test-squad-slot-header";
  const shortcut = document.createElement("span");
  shortcut.className = "three-test-squad-slot-key";
  shortcut.textContent = String(slotIndex + 1);
  shortcut.setAttribute("aria-hidden", "true");
  const name = document.createElement("div");
  name.className = "three-test-squad-slot-name";
  name.textContent = slotName;
  const status = document.createElement("span");
  status.className = "three-test-squad-slot-status";
  status.dataset.status = fielded ? effectiveStatus : truckCount > 0 ? "at-hq" : "empty";
  status.textContent = statusLabel;
  status.title = fielded ? getStatusLabel(effectiveStatus) : statusLabel;
  header.append(name, status);

  const truckRack = createTrayTruckRack(cardModel);
  const signals = document.createElement("div");
  signals.className = "three-test-squad-slot-signals";
  if (highestAlert) {
    const alertSignal = document.createElement("span");
    alertSignal.className = "three-test-squad-slot-alert";
    alertSignal.dataset.severity = getSeverityForAlert(highestAlert);
    alertSignal.textContent = getAlertText(highestAlert);
    if (getSeverityForAlert(highestAlert) === "critical") {
      alertSignal.classList.add("three-test-alert-pulse");
    }
    signals.appendChild(alertSignal);
  }

  const meta = document.createElement("div");
  meta.className = "three-test-squad-slot-meta";
  meta.appendChild(header);
  if (signals.childElementCount > 0) {
    meta.appendChild(signals);
  }
  const body = document.createElement("div");
  body.className = "three-test-squad-slot-body";
  body.append(truckRack, meta);
  card.append(shortcut, body);
  card.title = `${slotName}. Slot ${slotIndex + 1}. ${truckCount} truck${truckCount === 1 ? "" : "s"}. ${statusLabel}. ${intentLabel}.`;
  card.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (commandUnit) {
      onAction("select-command-unit", {
        commandUnitId: String(commandUnit.id),
        ...(event.shiftKey ? { toggle: "1" } : {})
      });
      return;
    }
    if (squad) {
      onAction("select-squad", { squadId: String(squad.id) });
    }
  });
  return card;
};

const createEmptySquadSlot = (slotIndex: number): HTMLButtonElement => {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "three-test-squad-slot is-empty";
  card.disabled = true;
  card.title = `Squad slot ${slotIndex + 1} is empty.`;

  const header = document.createElement("div");
  header.className = "three-test-squad-slot-header";
  const shortcut = document.createElement("span");
  shortcut.className = "three-test-squad-slot-key";
  shortcut.textContent = String(slotIndex + 1);
  shortcut.setAttribute("aria-hidden", "true");
  const name = document.createElement("div");
  name.className = "three-test-squad-slot-name";
  name.textContent = "Empty";
  const status = document.createElement("span");
  status.className = "three-test-squad-slot-status";
  status.dataset.status = "empty";
  status.textContent = "No squad";
  header.append(name, status);
  const truckRack = document.createElement("div");
  truckRack.className = "three-test-squad-slot-truck-rack";
  for (let index = 0; index < SQUAD_SLOT_COUNT; index += 1) {
    appendTrayTruckSlot(truckRack, 0, null, true);
  }
  const meta = document.createElement("div");
  meta.className = "three-test-squad-slot-meta";
  meta.appendChild(header);
  const body = document.createElement("div");
  body.className = "three-test-squad-slot-body";
  body.append(truckRack, meta);
  card.append(shortcut, body);
  return card;
};

const createSelectedUnitCard = (
  state: WorldState,
  cardModel: SelectedUnitCard,
  selected: boolean,
  onAction: UnitCommandTrayAction
): HTMLButtonElement => {
  const { truck, effectiveIntent } = cardModel;
  const waterRatio = getWaterRatio(truck.water, truck.waterCapacity);
  const highestAlert = resolveHighestAlert(truck.currentAlerts);
  const orderLabel = effectiveIntent
    ? `${getPlacementLabel(effectiveIntent.placementMode)} | ${getFireTaskLabel(effectiveIntent.fireTask)}`
    : "Auto";
  const name = getTruckLabel(state, truck);

  const card = document.createElement("button");
  card.type = "button";
  card.className = "three-test-truck-tile";
  card.classList.toggle("is-selected", selected);
  if (highestAlert && getSeverityForAlert(highestAlert) === "critical") {
    card.classList.add("three-test-alert-pulse");
  }

  const header = document.createElement("div");
  header.className = "three-test-truck-tile-header";
  const title = document.createElement("div");
  title.className = "three-test-truck-tile-name";
  title.textContent = name;
  const status = document.createElement("span");
  status.className = "three-test-truck-tile-status";
  status.dataset.status = truck.currentStatus;
  status.textContent = `${getStatusIcon(truck.currentStatus)} ${getStatusLabel(truck.currentStatus)}`;
  header.append(title, status);

  const meter = createWaterMeter(waterRatio, `${name} ${Math.round(waterRatio * 100)}% water`);
  const meta = document.createElement("div");
  meta.className = "three-test-truck-tile-meta";
  meta.textContent = `Water ${Math.round(waterRatio * 100)}% | Crew ${truck.crewIds.length}/${TRUCK_CAPACITY} ${getCrewModeLabel(truck)} | ${orderLabel}`;
  card.append(header, meter, meta);

  if (truck.truckOverrideIntent || highestAlert) {
    const chips = document.createElement("div");
    chips.className = "three-test-truck-tile-chips";
    if (truck.truckOverrideIntent) {
      const chip = document.createElement("span");
      chip.className = "three-test-truck-chip";
      chip.textContent = "Override";
      chips.appendChild(chip);
    }
    if (highestAlert) {
      const chip = document.createElement("span");
      chip.className = "three-test-truck-chip";
      chip.dataset.severity = getSeverityForAlert(highestAlert);
      chip.textContent = getAlertText(highestAlert);
      chips.appendChild(chip);
    }
    card.appendChild(chips);
  }

  card.title = `${name}. ${getStatusLabel(truck.currentStatus)}. Water ${Math.round(waterRatio * 100)}%. Crew ${
    truck.crewIds.length
  }/${TRUCK_CAPACITY} ${getCrewModeLabel(truck)}. ${orderLabel}.`;
  card.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onAction("select-truck", {
      truckId: String(truck.id),
      ...(event.shiftKey ? { toggle: "1" } : {})
    });
  });
  return card;
};

const createCommandButton = (
  spec: CommandButtonSpec,
  activeCommandMode: CommandMode,
  onAction: UnitCommandTrayAction,
  onStatus: UnitCommandTrayStatus
): HTMLButtonElement => {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "three-test-command-button";
  button.textContent = spec.label;
  button.disabled = spec.disabled ?? false;
  button.classList.toggle("is-active", spec.mode === activeCommandMode);
  if (spec.danger) {
    button.classList.add("is-danger");
  }
  if (spec.disabled) {
    button.title = spec.title ?? `${spec.label} is unavailable.`;
  } else {
    button.title = `Set ${spec.label} command mode.`;
  }
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (spec.disabled) {
      onStatus(spec.title ?? `${spec.label} is unavailable.`);
      return;
    }
    if (spec.action) {
      onAction(spec.action);
    }
  });
  return button;
};

export const createUnitCommandTray = ({ onAction, onStatus, onSquadHover }: UnitCommandTrayOptions): UnitCommandTray => {
  const element = document.createElement("div");
  element.className = "three-test-command-bar unit-command-tray";

  const slotColumn = document.createElement("div");
  slotColumn.className = "three-test-squad-slot-column";

  const commandPanel = document.createElement("div");
  commandPanel.className = "three-test-command-panel three-test-squad-detail-panel";
  element.append(slotColumn, commandPanel);
  let lastSlotRenderKey = "";
  let lastCommandPanelRenderKey = "";

  const applyHoveredSlotState = (hoveredCommandUnitId: number | null): void => {
    slotColumn.querySelectorAll<HTMLButtonElement>(".three-test-squad-slot[data-command-unit-id]").forEach((slot) => {
      slot.classList.toggle("is-world-hovered", slot.dataset.commandUnitId === String(hoveredCommandUnitId));
    });
  };

  const update = (state: WorldState, inputState: InputState, hoveredCommandUnitId: number | null = null): void => {
    const commandUnits = [...state.commandUnits].sort((leftUnit, rightUnit) => leftUnit.id - rightUnit.id);
    const commandUnitById = new Map(commandUnits.map((entry) => [entry.id, entry] as const));
    const focusedCommandUnit =
      (state.focusedCommandUnitId !== null ? commandUnitById.get(state.focusedCommandUnitId) ?? null : null) ??
      (state.selectedCommandUnitIds.length === 1 ? commandUnitById.get(state.selectedCommandUnitIds[0]!) ?? null : null);
    const activePlacementMode = inputState.placementMode;
    const activeFireTask = inputState.fireTask;
    element.classList.toggle("is-collapsed", !focusedCommandUnit);
    element.classList.toggle("is-expanded", !!focusedCommandUnit);
    const commandUnitBySquadId = new Map(
      commandUnits
        .filter((commandUnit) => commandUnit.squadId !== null)
        .map((commandUnit) => [commandUnit.squadId as number, commandUnit] as const)
    );
    const squadSlots: CommandGroupCard[] = state.squads.slice(0, SQUAD_SLOT_COUNT).map((squad) => {
      const commandUnit = commandUnitBySquadId.get(squad.id) ?? null;
      return {
        commandUnit,
        squad,
        rosterTrucks: getSquadRosterTrucks(state, squad),
        trucks: commandUnit ? getCommandUnitTrucks(state, commandUnit) : []
      };
    });
    const fallbackSlots: CommandGroupCard[] = commandUnits
      .filter((commandUnit) => commandUnit.squadId === null)
      .map((commandUnit) => ({
        commandUnit,
        squad: null,
        rosterTrucks: [],
        trucks: getCommandUnitTrucks(state, commandUnit)
      }));
    const occupiedSlots = (squadSlots.length > 0 ? squadSlots : fallbackSlots).slice(0, SQUAD_SLOT_COUNT);

    const slotRenderKey = JSON.stringify({
      focusedCommandUnitId: state.focusedCommandUnitId,
      selectedCommandUnitIds: state.selectedCommandUnitIds,
      selectedSquadId: state.selectedSquadId,
      selectedTruckIds: state.selectedTruckIds,
      selectionScope: state.selectionScope,
      slots: occupiedSlots.map(({ commandUnit, squad, rosterTrucks, trucks }) => ({
        commandUnitId: commandUnit?.id ?? null,
        squadId: squad?.id ?? null,
        name: commandUnit?.name ?? squad?.name ?? "Empty",
        currentIntent: commandUnit?.currentIntent ?? squad?.currentIntent ?? null,
        revision: (commandUnit?.revision ?? 0) + (squad?.revision ?? 0),
        rosterTrucks: rosterTrucks.map((truck) => ({
          id: truck.id,
          status: truck.status,
          crewCount: truck.crewIds.length
        })),
        trucks: trucks.map((truck) => ({
          id: truck.id,
          status: truck.currentStatus,
          alerts: truck.currentAlerts,
          waterBucket: Math.round(getWaterRatio(truck.water, truck.waterCapacity) * 20),
          crewCount: truck.crewIds.length,
          crewMode: truck.crewMode,
          crewAction: truck.crewAction
        }))
      }))
    });
    if (lastSlotRenderKey !== slotRenderKey) {
      lastSlotRenderKey = slotRenderKey;
      slotColumn.replaceChildren();
      for (let slotIndex = 0; slotIndex < SQUAD_SLOT_COUNT; slotIndex += 1) {
        const slot = occupiedSlots[slotIndex] ?? null;
        if (!slot) {
          slotColumn.appendChild(createEmptySquadSlot(slotIndex));
          continue;
        }
        const { commandUnit, squad } = slot;
        const selected =
          (commandUnit !== null &&
            (state.selectedCommandUnitIds.includes(commandUnit.id) ||
              (state.selectionScope === "truck" && state.focusedCommandUnitId === commandUnit.id))) ||
          (commandUnit === null && squad !== null && state.selectedSquadId === squad.id);
        const slotButton = createSquadSlot(
          slot,
          selected,
          commandUnit !== null && state.focusedCommandUnitId === commandUnit.id,
          false,
          slotIndex,
          onAction
        );
        slotButton.addEventListener("mouseenter", () => onSquadHover?.(commandUnit?.id ?? null));
        slotButton.addEventListener("mouseleave", () => onSquadHover?.(null));
        slotColumn.appendChild(slotButton);
      }
    }
    applyHoveredSlotState(hoveredCommandUnitId);

    if (!focusedCommandUnit) {
      if (lastCommandPanelRenderKey !== "none") {
        lastCommandPanelRenderKey = "none";
        commandPanel.replaceChildren();
      }
      return;
    }

    const focusedTrucks = getCommandUnitTrucks(state, focusedCommandUnit);
    const commandPanelRenderKey = JSON.stringify({
      focusedCommandUnitId: focusedCommandUnit.id,
      focusedCommandUnitName: focusedCommandUnit.name,
      focusedCommandUnitIntent: focusedCommandUnit.currentIntent,
      focusedCommandUnitRevision: focusedCommandUnit.revision,
      activePlacementMode,
      activeFireTask,
      behaviourMode: inputState.behaviourMode,
      dispatchFormation: inputState.dispatchFormation,
      formationProjection: inputState.formationProjection
        ? {
            width: Math.round(inputState.formationProjection.widthTiles * 10),
            facingX: Math.round(inputState.formationProjection.facing.x * 100),
            facingY: Math.round(inputState.formationProjection.facing.y * 100)
          }
        : null,
      pendingSquadDispatchId: inputState.pendingSquadDispatchId,
      selectionScope: state.selectionScope,
      selectedTruckIds: state.selectedTruckIds,
      trucks: focusedTrucks.map((truck) => ({
        id: truck.id,
        rosterId: truck.rosterId,
        name: getTruckLabel(state, truck),
        waterBucket: Math.round(getWaterRatio(truck.water, truck.waterCapacity) * 20),
        crewCount: truck.crewIds.length,
        crewMode: truck.crewMode,
        crewAction: truck.crewAction,
        currentStatus: truck.currentStatus,
        currentAlerts: truck.currentAlerts,
        truckOverrideIntent: truck.truckOverrideIntent,
        commandUnitId: truck.commandUnitId
      }))
    });
    if (lastCommandPanelRenderKey === commandPanelRenderKey) {
      return;
    }
    lastCommandPanelRenderKey = commandPanelRenderKey;
    commandPanel.replaceChildren();

    const totalWater = focusedTrucks.reduce((sum, truck) => sum + truck.water, 0);
    const totalCapacity = focusedTrucks.reduce((sum, truck) => sum + truck.waterCapacity, 0);
    const waterRatio = getWaterRatio(totalWater, totalCapacity);
    const totalCrew = focusedTrucks.reduce((sum, truck) => sum + truck.crewIds.length, 0);
    const totalCrewCapacity = focusedTrucks.length * TRUCK_CAPACITY;
    const aggregateAlerts = focusedTrucks.flatMap((truck) => truck.currentAlerts);
    const highestAlert = resolveHighestAlert(aggregateAlerts);
    const effectiveStatus = resolveMajorityStatus(focusedTrucks);
    const intentLabel = focusedCommandUnit.currentIntent
      ? `${getPlacementLabel(focusedCommandUnit.currentIntent.placementMode)} | ${getFireTaskLabel(focusedCommandUnit.currentIntent.fireTask)} ${getBehaviourLabel(focusedCommandUnit.currentIntent.behaviourMode)}`
      : "Auto";
    const stanceLabel = getBehaviourLabel(focusedCommandUnit.currentIntent?.behaviourMode ?? inputState.behaviourMode);

    const title = document.createElement("div");
    title.className = "three-test-command-panel-title";
    title.textContent = `${focusedCommandUnit.name} Squad`;

    const summary = document.createElement("div");
    summary.className = "three-test-command-panel-summary";
    summary.textContent = `${getStatusLabel(effectiveStatus)} | ${intentLabel}`;

    const metrics = document.createElement("div");
    metrics.className = "three-test-squad-detail-metrics";
    metrics.append(
      createStat("Units", `${focusedTrucks.length}`),
      createStat("Water", `${Math.round(waterRatio * 100)}%`),
      createStat("Crew", `${totalCrew}/${totalCrewCapacity}`),
      createStat("Stance", stanceLabel)
    );
    if (highestAlert) {
      const alert = document.createElement("span");
      alert.className = "three-test-command-unit-alert";
      alert.dataset.severity = getSeverityForAlert(highestAlert);
      alert.textContent = getAlertText(highestAlert);
      metrics.appendChild(alert);
    }

    const water = createWaterMeter(
      waterRatio,
      `${focusedCommandUnit.name} squad ${Math.round(totalWater)}/${Math.round(totalCapacity)} aggregate water`
    );

    const hint = document.createElement("div");
    hint.className = "three-test-command-panel-hint";
    const projectionLabel = getProjectionLabel(inputState);
    if (projectionLabel) {
      hint.textContent = projectionLabel;
    } else if (inputState.pendingSquadDispatchId === focusedCommandUnit.squadId) {
      hint.textContent = "Right-click the world to place this squad.";
    } else if (state.selectionScope === "truck") {
      hint.textContent = "Truck overrides take priority until rejoined.";
    } else {
      hint.textContent = "Right-click issues the active placement and task.";
    }

    const header = document.createElement("div");
    header.className = "three-test-squad-detail-header";
    header.append(title, summary, metrics);

    const unitRows = document.createElement("div");
    unitRows.className = "three-test-squad-unit-list";
    focusedTrucks.forEach((truck) => {
      unitRows.appendChild(
        createSelectedUnitCard(
          state,
          {
            truck,
            effectiveIntent: getEffectiveTruckIntent(truck, commandUnitById)
          },
          state.selectedTruckIds.includes(truck.id),
          onAction
        )
      );
    });

    commandPanel.append(header, water, unitRows, hint);

    const placementSection = document.createElement("div");
    placementSection.className = "three-test-command-panel-section three-test-command-panel-section--placement";
    const placementLabel = document.createElement("div");
    placementLabel.className = "three-test-command-panel-label";
    placementLabel.textContent = `Placement ${getPlacementLabel(activePlacementMode)}`;
    const placementGrid = document.createElement("div");
    placementGrid.className = "three-test-command-panel-grid three-test-command-panel-grid--commands three-test-command-panel-grid--placement";
    PLACEMENT_BUTTONS.forEach((spec) => {
      placementGrid.appendChild(createCommandButton(spec, activePlacementMode, onAction, onStatus));
    });
    placementSection.append(placementLabel, placementGrid);
    commandPanel.appendChild(placementSection);

    const taskSection = document.createElement("div");
    taskSection.className = "three-test-command-panel-section three-test-command-panel-section--tasks";
    const taskLabel = document.createElement("div");
    taskLabel.className = "three-test-command-panel-label";
    taskLabel.textContent = `Task ${getFireTaskLabel(activeFireTask)}`;
    const taskGrid = document.createElement("div");
    taskGrid.className = "three-test-command-panel-grid three-test-command-panel-grid--commands three-test-command-panel-grid--tasks";
    FIRE_TASK_BUTTONS.forEach((spec) => {
      taskGrid.appendChild(createCommandButton(spec, activeFireTask, onAction, onStatus));
    });
    taskSection.append(taskLabel, taskGrid);
    commandPanel.appendChild(taskSection);

    const behaviourSection = document.createElement("div");
    behaviourSection.className = "three-test-command-panel-section three-test-command-panel-section--stance";
    const behaviourLabel = document.createElement("div");
    behaviourLabel.className = "three-test-command-panel-label";
    behaviourLabel.textContent = `Stance ${getBehaviourLabel(inputState.behaviourMode)}`;
    const behaviourGrid = document.createElement("div");
    behaviourGrid.className = "three-test-command-panel-grid three-test-command-panel-grid--triple";
    BEHAVIOUR_BUTTONS.forEach((spec) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "three-test-command-button three-test-command-button--secondary";
      button.classList.toggle("is-active", inputState.behaviourMode === spec.mode);
      button.textContent = spec.label;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onAction(spec.action);
      });
      behaviourGrid.appendChild(button);
    });
    behaviourSection.append(behaviourLabel, behaviourGrid);
    commandPanel.appendChild(behaviourSection);

    const formationSection = document.createElement("div");
    formationSection.className = "three-test-command-panel-section three-test-command-panel-section--formation";
    const formationLabel = document.createElement("div");
    formationLabel.className = "three-test-command-panel-label";
    formationLabel.textContent = `Formation ${inputState.dispatchFormation}`;
    const formationGrid = document.createElement("div");
    formationGrid.className = "three-test-command-panel-grid three-test-command-panel-grid--triple";
    DISPATCH_FORMATION_BUTTONS.forEach((spec) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "three-test-command-button three-test-command-button--secondary";
      button.classList.toggle("is-active", inputState.dispatchFormation === spec.formation);
      button.textContent = spec.label;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onAction(spec.action);
      });
      formationGrid.appendChild(button);
    });
    formationSection.append(formationLabel, formationGrid);
    commandPanel.appendChild(formationSection);

    if (state.selectionScope === "truck" && state.selectedTruckIds.length > 0) {
      const overrideSection = document.createElement("div");
      overrideSection.className = "three-test-command-panel-section three-test-command-panel-section--overrides";
      const overrideLabel = document.createElement("div");
      overrideLabel.className = "three-test-command-panel-label";
      overrideLabel.textContent = "Truck Overrides";
      const overrideGrid = document.createElement("div");
      overrideGrid.className = "three-test-command-panel-grid";
      const rejoinButton = document.createElement("button");
      rejoinButton.type = "button";
      rejoinButton.className = "three-test-command-button";
      rejoinButton.textContent = "Rejoin Unit";
      rejoinButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onAction("rejoin-command-unit");
      });
      overrideGrid.appendChild(rejoinButton);
      overrideSection.append(overrideLabel, overrideGrid);
      commandPanel.appendChild(overrideSection);
    }
  };

  return { element, update };
};
