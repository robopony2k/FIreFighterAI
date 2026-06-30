import { TRUCK_CAPACITY } from "../../core/config.js";
import type { InputState } from "../../core/inputState.js";
import type { WorldState } from "../../core/state.js";
import type {
  BehaviourMode,
  CommandIntent,
  CommandFormation,
  CommandType,
  CommandUnit,
  CommandUnitAlert,
  CommandUnitStatus,
  Unit
} from "../../core/types.js";

export type CommandMode = CommandType | "refill" | "hold";

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
  commandUnit: CommandUnit;
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

const COMMAND_BUTTONS: readonly CommandButtonSpec[] = [
  { label: "Move", mode: "move", action: "command-mode-move" },
  { label: "Suppress", mode: "suppress", action: "command-mode-suppress" },
  { label: "Contain", mode: "contain", action: "command-mode-contain" },
  { label: "Backburn", mode: "backburn", action: "command-mode-backburn", danger: true },
  {
    label: "Refill",
    mode: "refill",
    disabled: true,
    title: "Refill is unavailable in Phase 1 because no simulation command exists yet."
  },
  {
    label: "Hold",
    mode: "hold",
    disabled: true,
    title: "Hold is unavailable in Phase 1 because no simulation command exists yet."
  }
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
  return `${type[0]!.toUpperCase()}${type.slice(1)}`;
};

const getBehaviourLabel = (mode: BehaviourMode): string => `${mode[0]!.toUpperCase()}${mode.slice(1)}`;

const getStatusLabel = (status: CommandUnitStatus): string => `${status[0]!.toUpperCase()}${status.slice(1)}`;

const getStatusIcon = (status: CommandUnitStatus): string => {
  if (status === "suppressing") {
    return "SUP";
  }
  if (status === "moving") {
    return "MOV";
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
      return 2;
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
  const priority: CommandUnitStatus[] = ["retreating", "suppressing", "moving", "holding"];
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

const createSquadSlot = (
  cardModel: CommandGroupCard,
  selected: boolean,
  focused: boolean,
  hovered: boolean,
  slotIndex: number,
  onAction: UnitCommandTrayAction
): HTMLButtonElement => {
  const { commandUnit, trucks } = cardModel;
  const aggregateAlerts = trucks.flatMap((truck) => truck.currentAlerts);
  const highestAlert = resolveHighestAlert(aggregateAlerts);
  const effectiveStatus = resolveMajorityStatus(trucks);
  const intentLabel = commandUnit.currentIntent
    ? getCommandTypeLabel(commandUnit.currentIntent.type)
    : "Auto";

  const card = document.createElement("button");
  card.type = "button";
  card.className = "three-test-squad-slot";
  card.classList.toggle("is-selected", selected);
  card.classList.toggle("is-focused", focused);
  card.classList.toggle("is-world-hovered", hovered);

  const header = document.createElement("div");
  header.className = "three-test-squad-slot-header";
  const shortcut = document.createElement("span");
  shortcut.className = "three-test-squad-slot-key";
  shortcut.textContent = String(slotIndex + 1);
  const name = document.createElement("div");
  name.className = "three-test-squad-slot-name";
  name.textContent = commandUnit.name;
  const status = document.createElement("span");
  status.className = "three-test-squad-slot-status";
  status.dataset.status = effectiveStatus;
  status.textContent = getStatusIcon(effectiveStatus);
  status.title = getStatusLabel(effectiveStatus);
  header.append(shortcut, name, status);

  const signals = document.createElement("div");
  signals.className = "three-test-squad-slot-signals";
  const unitSignal = document.createElement("span");
  unitSignal.className = "three-test-squad-slot-signal";
  unitSignal.textContent = `${trucks.length} unit${trucks.length === 1 ? "" : "s"}`;
  const orderSignal = document.createElement("span");
  orderSignal.className = "three-test-squad-slot-signal";
  orderSignal.dataset.kind = "status";
  orderSignal.textContent = intentLabel;
  signals.append(unitSignal, orderSignal);
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

  card.append(header, signals);
  card.title = `${commandUnit.name}. Slot ${slotIndex + 1}. ${trucks.length} unit(s). ${intentLabel}.`;
  card.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onAction("select-command-unit", {
      commandUnitId: String(commandUnit.id),
      ...(event.shiftKey ? { toggle: "1" } : {})
    });
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
  const name = document.createElement("div");
  name.className = "three-test-squad-slot-name";
  name.textContent = "Empty";
  header.append(shortcut, name);

  const signals = document.createElement("div");
  signals.className = "three-test-squad-slot-signals";
  const status = document.createElement("span");
  status.className = "three-test-squad-slot-signal";
  status.textContent = "No squad";
  signals.appendChild(status);
  card.append(header, signals);
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
  const orderLabel = effectiveIntent ? getCommandTypeLabel(effectiveIntent.type) : "Auto";
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
  meta.textContent = `Water ${Math.round(waterRatio * 100)}% | Crew ${truck.crewIds.length}/${TRUCK_CAPACITY} | ${orderLabel}`;
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
  }/${TRUCK_CAPACITY}. ${orderLabel}.`;
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
  activeCommandMode: CommandType | null,
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

  const update = (state: WorldState, inputState: InputState, hoveredCommandUnitId: number | null = null): void => {
    const commandUnits = [...state.commandUnits].sort((leftUnit, rightUnit) => leftUnit.id - rightUnit.id);
    const commandUnitById = new Map(commandUnits.map((entry) => [entry.id, entry] as const));
    const focusedCommandUnit =
      (state.focusedCommandUnitId !== null ? commandUnitById.get(state.focusedCommandUnitId) ?? null : null) ??
      (state.selectedCommandUnitIds.length === 1 ? commandUnitById.get(state.selectedCommandUnitIds[0]!) ?? null : null);
    const activeCommandMode = inputState.commandMode;
    element.classList.toggle("is-collapsed", !focusedCommandUnit);
    element.classList.toggle("is-expanded", !!focusedCommandUnit);
    const occupiedSlots = commandUnits
      .map((commandUnit) => ({ commandUnit, trucks: getCommandUnitTrucks(state, commandUnit) }))
      .filter((entry) => entry.trucks.length > 0)
      .slice(0, SQUAD_SLOT_COUNT);

    slotColumn.replaceChildren();
    for (let slotIndex = 0; slotIndex < SQUAD_SLOT_COUNT; slotIndex += 1) {
      const slot = occupiedSlots[slotIndex] ?? null;
      if (!slot) {
        slotColumn.appendChild(createEmptySquadSlot(slotIndex));
        continue;
      }
      const { commandUnit, trucks } = slot;
      const selected =
        state.selectedCommandUnitIds.includes(commandUnit.id) ||
        (state.selectionScope === "truck" && state.focusedCommandUnitId === commandUnit.id);
      const slotButton = createSquadSlot(
        { commandUnit, trucks },
        selected,
        state.focusedCommandUnitId === commandUnit.id,
        hoveredCommandUnitId === commandUnit.id,
        slotIndex,
        onAction
      );
      slotButton.addEventListener("mouseenter", () => onSquadHover?.(commandUnit.id));
      slotButton.addEventListener("mouseleave", () => onSquadHover?.(null));
      slotColumn.appendChild(slotButton);
    }

    commandPanel.replaceChildren();
    if (!focusedCommandUnit) {
      return;
    }

    const focusedTrucks = getCommandUnitTrucks(state, focusedCommandUnit);
    const totalWater = focusedTrucks.reduce((sum, truck) => sum + truck.water, 0);
    const totalCapacity = focusedTrucks.reduce((sum, truck) => sum + truck.waterCapacity, 0);
    const waterRatio = getWaterRatio(totalWater, totalCapacity);
    const totalCrew = focusedTrucks.reduce((sum, truck) => sum + truck.crewIds.length, 0);
    const totalCrewCapacity = focusedTrucks.length * TRUCK_CAPACITY;
    const aggregateAlerts = focusedTrucks.flatMap((truck) => truck.currentAlerts);
    const highestAlert = resolveHighestAlert(aggregateAlerts);
    const effectiveStatus = resolveMajorityStatus(focusedTrucks);
    const intentLabel = focusedCommandUnit.currentIntent
      ? `${getCommandTypeLabel(focusedCommandUnit.currentIntent.type)} ${getBehaviourLabel(focusedCommandUnit.currentIntent.behaviourMode)}`
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
    if (inputState.pendingSquadDispatchId === focusedCommandUnit.squadId) {
      hint.textContent = "Click the world to place this squad.";
    } else if (state.selectionScope === "truck") {
      hint.textContent = "Truck overrides take priority until rejoined.";
    } else {
      hint.textContent = "Right-click issues the active command mode.";
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

    const modeSection = document.createElement("div");
    modeSection.className = "three-test-command-panel-section three-test-command-panel-section--commands";
    const modeLabel = document.createElement("div");
    modeLabel.className = "three-test-command-panel-label";
    modeLabel.textContent = `Active ${getCommandTypeLabel(activeCommandMode)}`;
    const modeGrid = document.createElement("div");
    modeGrid.className = "three-test-command-panel-grid three-test-command-panel-grid--commands";
    COMMAND_BUTTONS.forEach((spec) => {
      modeGrid.appendChild(createCommandButton(spec, activeCommandMode, onAction, onStatus));
    });
    modeSection.append(modeLabel, modeGrid);
    commandPanel.appendChild(modeSection);

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
