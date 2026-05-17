import { TRUCK_CAPACITY } from "../../core/config.js";
import type { InputState } from "../../core/inputState.js";
import type { WorldState } from "../../core/state.js";
import type {
  BehaviourMode,
  CommandIntent,
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
  update: (state: WorldState, inputState: InputState) => void;
};

export type UnitCommandTrayOptions = {
  onAction: UnitCommandTrayAction;
  onStatus: UnitCommandTrayStatus;
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

const createCommandGroupCard = (
  state: WorldState,
  cardModel: CommandGroupCard,
  selected: boolean,
  focused: boolean,
  onAction: UnitCommandTrayAction
): HTMLButtonElement => {
  const { commandUnit, trucks } = cardModel;
  const totalCrew = trucks.reduce((sum, truck) => sum + truck.crewIds.length, 0);
  const totalCrewCapacity = trucks.length * TRUCK_CAPACITY;
  const totalWater = trucks.reduce((sum, truck) => sum + truck.water, 0);
  const totalCapacity = trucks.reduce((sum, truck) => sum + truck.waterCapacity, 0);
  const waterRatio = getWaterRatio(totalWater, totalCapacity);
  const aggregateAlerts = trucks.flatMap((truck) => truck.currentAlerts);
  const highestAlert = resolveHighestAlert(aggregateAlerts);
  const effectiveStatus = resolveMajorityStatus(trucks);
  const overrideCount = trucks.filter((truck) => truck.truckOverrideIntent !== null).length;
  const intentLabel = commandUnit.currentIntent
    ? `${getCommandTypeLabel(commandUnit.currentIntent.type)} ${getBehaviourLabel(commandUnit.currentIntent.behaviourMode)}`
    : "Auto";

  const card = document.createElement("button");
  card.type = "button";
  card.className = "three-test-command-unit-card";
  card.classList.toggle("is-selected", selected);
  card.classList.toggle("is-focused", focused);

  const header = document.createElement("div");
  header.className = "three-test-command-unit-header";
  const name = document.createElement("div");
  name.className = "three-test-command-unit-name";
  name.textContent = commandUnit.name;
  const status = document.createElement("span");
  status.className = "three-test-command-unit-status";
  status.dataset.status = effectiveStatus;
  status.textContent = getStatusIcon(effectiveStatus);
  status.title = getStatusLabel(effectiveStatus);
  header.append(name, status);

  const metrics = document.createElement("div");
  metrics.className = "three-test-command-unit-stats";
  metrics.append(createStat("T", `${trucks.length}`), createStat("C", `${totalCrew}/${totalCrewCapacity}`));

  const waterLine = document.createElement("div");
  waterLine.className = "three-test-command-unit-waterline";
  const waterLabel = document.createElement("span");
  waterLabel.className = "three-test-command-unit-watericon";
  waterLabel.textContent = `W ${Math.round(waterRatio * 100)}%`;
  const waterBars = document.createElement("div");
  waterBars.className = "three-test-command-unit-waterbars";
  trucks.forEach((truck) => {
    const truckWaterRatio = getWaterRatio(truck.water, truck.waterCapacity);
    const pip = document.createElement("span");
    pip.className = "three-test-command-unit-waterbar";
    pip.dataset.level = getWaterLevel(truckWaterRatio);
    pip.textContent = "|";
    pip.title = `${getTruckLabel(state, truck)} ${Math.round(truckWaterRatio * 100)}% water`;
    waterBars.appendChild(pip);
  });
  waterLine.append(waterLabel, waterBars);

  const signals = document.createElement("div");
  signals.className = "three-test-command-unit-signals";
  const orderSignal = document.createElement("span");
  orderSignal.className = "three-test-command-unit-signal";
  orderSignal.dataset.kind = "status";
  orderSignal.textContent = intentLabel;
  signals.appendChild(orderSignal);
  if (highestAlert) {
    const alertSignal = document.createElement("span");
    alertSignal.className = "three-test-command-unit-alert";
    alertSignal.dataset.severity = getSeverityForAlert(highestAlert);
    alertSignal.textContent = getAlertText(highestAlert);
    if (getSeverityForAlert(highestAlert) === "critical") {
      alertSignal.classList.add("three-test-alert-pulse");
    }
    signals.appendChild(alertSignal);
  }

  card.append(header, metrics, waterLine, signals);
  card.title = `${commandUnit.name}. ${trucks.length} truck(s), ${totalCrew}/${totalCrewCapacity} crew, ${Math.round(
    waterRatio * 100
  )}% water. ${overrideCount > 0 ? `${intentLabel} with ${overrideCount} override.` : `${intentLabel}.`}`;
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

export const createUnitCommandTray = ({ onAction, onStatus }: UnitCommandTrayOptions): UnitCommandTray => {
  const element = document.createElement("div");
  element.className = "three-test-command-bar unit-command-tray";

  const left = document.createElement("div");
  left.className = "three-test-command-bar-left";
  const commandUnitRow = document.createElement("div");
  commandUnitRow.className = "three-test-command-unit-row";
  const truckStrip = document.createElement("div");
  truckStrip.className = "three-test-truck-strip hidden";
  const truckStripHeader = document.createElement("div");
  truckStripHeader.className = "three-test-truck-strip-header";
  const truckStripTitle = document.createElement("div");
  truckStripTitle.className = "three-test-truck-strip-title";
  const truckStripMeta = document.createElement("div");
  truckStripMeta.className = "three-test-truck-strip-meta";
  truckStripHeader.append(truckStripTitle, truckStripMeta);
  const truckStripRow = document.createElement("div");
  truckStripRow.className = "three-test-truck-strip-row";
  truckStrip.append(truckStripHeader, truckStripRow);
  left.append(commandUnitRow, truckStrip);

  const commandPanel = document.createElement("div");
  commandPanel.className = "three-test-command-panel";
  element.append(left, commandPanel);

  const update = (state: WorldState, inputState: InputState): void => {
    const commandUnits = [...state.commandUnits].sort((leftUnit, rightUnit) => leftUnit.id - rightUnit.id);
    const commandUnitById = new Map(commandUnits.map((entry) => [entry.id, entry] as const));
    const focusedCommandUnit =
      (state.focusedCommandUnitId !== null ? commandUnitById.get(state.focusedCommandUnitId) ?? null : null) ??
      (state.selectedCommandUnitIds.length === 1 ? commandUnitById.get(state.selectedCommandUnitIds[0]!) ?? null : null);
    const showTruckStrip =
      !!focusedCommandUnit && (state.selectionScope === "truck" || state.selectedCommandUnitIds.length === 1);
    const activeCommandMode = inputState.commandMode;

    commandUnitRow.replaceChildren();
    commandUnits.forEach((commandUnit) => {
      const trucks = getCommandUnitTrucks(state, commandUnit);
      if (trucks.length <= 0) {
        return;
      }
      const selected =
        state.selectedCommandUnitIds.includes(commandUnit.id) ||
        (state.selectionScope === "truck" && state.focusedCommandUnitId === commandUnit.id);
      commandUnitRow.appendChild(
        createCommandGroupCard(
          state,
          { commandUnit, trucks },
          selected,
          state.focusedCommandUnitId === commandUnit.id,
          onAction
        )
      );
    });

    if (showTruckStrip && focusedCommandUnit) {
      const focusedTrucks = getCommandUnitTrucks(state, focusedCommandUnit);
      truckStrip.classList.remove("hidden");
      truckStripTitle.textContent = `${focusedCommandUnit.name} Units`;
      truckStripMeta.textContent =
        state.selectionScope === "truck" ? `${state.selectedTruckIds.length} selected` : `${focusedTrucks.length} available`;
      truckStripRow.replaceChildren();
      focusedTrucks.forEach((truck) => {
        truckStripRow.appendChild(
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
    } else {
      truckStrip.classList.add("hidden");
      truckStripRow.replaceChildren();
    }

    commandPanel.replaceChildren();
    const title = document.createElement("div");
    title.className = "three-test-command-panel-title";
    title.textContent =
      state.selectionScope === "truck" && state.selectedTruckIds.length > 0
        ? "Truck Control"
        : focusedCommandUnit?.name ?? "Unit Command";
    const summary = document.createElement("div");
    summary.className = "three-test-command-panel-summary";
    if (state.selectionScope === "truck" && state.selectedTruckIds.length > 0) {
      summary.textContent = `${state.selectedTruckIds.length} truck(s) selected in ${focusedCommandUnit?.name ?? "command group"}.`;
    } else if (focusedCommandUnit) {
      summary.textContent = `${focusedCommandUnit.name} selected with ${focusedCommandUnit.truckIds.length} truck(s).`;
    } else {
      summary.textContent = "Select Alpha or Bravo to command a group.";
    }
    const hint = document.createElement("div");
    hint.className = "three-test-command-panel-hint";
    hint.textContent =
      state.selectionScope === "truck"
        ? "Truck overrides take priority until rejoined."
        : "Right-click issues the active command mode.";
    commandPanel.append(title, summary, hint);

    const modeSection = document.createElement("div");
    modeSection.className = "three-test-command-panel-section";
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
    behaviourSection.className = "three-test-command-panel-section";
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

    if (state.selectionScope === "truck" && state.selectedTruckIds.length > 0) {
      const overrideSection = document.createElement("div");
      overrideSection.className = "three-test-command-panel-section";
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
