import type {
  AreaTarget,
  BehaviourMode,
  CommandFormation,
  CommandIntent,
  CommandTarget,
  CommandType,
  CommandUnit,
  CommandUnitAlert,
  CommandUnitStatus,
  LineTarget,
  Point,
  RNG,
  RosterUnit,
  Unit,
  UnitKind,
  UnitSkill,
  Formation
} from "../core/types.js";
import type { WorldState } from "../core/state.js";
import type { EffectsState } from "../core/effectsState.js";
import {
  FIREBREAK_COST_PER_TILE,
  FIREFIGHTER_TETHER_DISTANCE,
  FORMATION_SPACING,
  MAX_TRAINING_LEVEL,
  RECRUIT_FIREFIGHTER_COST,
  RECRUIT_TRUCK_COST,
  TRUCK_BOARD_RADIUS,
  TRUCK_CAPACITY,
  TRAINING_COST,
  TRAINING_POWER_GAIN,
  TRAINING_RANGE_GAIN,
  TRAINING_RESILIENCE_GAIN,
  TRAINING_SPEED_GAIN,
  UNIT_CONFIG,
  UNIT_LOSS_FIRE_THRESHOLD,
  SUPPRESSION_WETNESS_BLOCK_THRESHOLD
} from "../core/config.js";
import { formatCurrency } from "../core/utils.js";
import { setStatus, resetStatus, TILE_TYPE_IDS } from "../core/state.js";
import { getCharacterDefinition, getCharacterFirebreakCost } from "../core/characters.js";
import { inBounds, indexFor } from "../core/grid.js";
import { applyFuel } from "../core/tiles.js";
import { syncTileSoAIndex } from "../core/tileCache.js";
import { clearVegetationState } from "../core/vegetation.js";
import { findPath, getMoveSpeedMultiplier, isPassable } from "./pathing.js";
import { emitWaterSpray } from "./particles.js";
import { queueScoreFlowEvent } from "./scoring.js";
import { markFireBlockActiveByTile } from "./fire/activeBlocks.js";

const FIRST_NAMES = ["Alex", "Casey", "Drew", "Jordan", "Parker", "Quinn", "Riley", "Sawyer", "Taylor", "Wyatt"];
const LAST_NAMES = ["Cedar", "Hawk", "Keel", "Marsh", "Reed", "Stone", "Sutter", "Vale", "Wells", "Yates"];
const TRUCK_PREFIX = ["Engine", "Tanker", "Brush", "Rescue"];
const COMMAND_UNIT_NAMES = ["Alpha", "Bravo", "Charlie", "Delta"];
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const MOVING_SPRAY_SPEED_FACTOR = 0.6;
const TRUCK_SUPPORT_POSITION_TOLERANCE = 1.85;
const CREW_REISSUE_DISTANCE = 0.7;
const FIRE_FOCUS_CLUSTER_RADIUS = 1.8;
const THREAT_FIRE_EPS = 0.03;
const THREAT_HOLDOVER_HEAT_EPS = 0.08;
const THREAT_HOLDOVER_WETNESS_EPS = 0.06;
const THREAT_ASSET_RADIUS = 2;
const THREAT_NEIGHBOR_DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
  { dx: 1, dy: 1 },
  { dx: 1, dy: -1 },
  { dx: -1, dy: 1 },
  { dx: -1, dy: -1 }
];
const TRUCK_WATER_CAPACITY = 100;
const TRUCK_WATER_REFILL_RATE = 18;
const TRUCK_WATER_USE_RATE = 2.4;
const FIREFIGHTER_WATER_USE_RATE = 1.6;
const TRUCK_RIVER_REFILL_RADIUS = 2;
const TRUCK_WATER_LOW_RATIO = 0.35;
const TRUCK_WATER_CRITICAL_RATIO = 0.2;
const BACKBURN_IGNITE_INTERVAL_DAYS = 0.18;
const BACKBURN_IGNITE_RADIUS = 3.5;

const createTraining = (): RosterUnit["training"] => ({
  speed: 0,
  power: 0,
  range: 0,
  resilience: 0
});

const getRosterUnit = (state: WorldState, rosterId: number | null): RosterUnit | null => {
  if (rosterId === null) {
    return null;
  }
  return state.roster.find((unit) => unit.id === rosterId) ?? null;
};

const getRosterTruck = (state: WorldState, rosterId: number | null): RosterUnit | null => {
  const unit = getRosterUnit(state, rosterId);
  if (!unit || unit.kind !== "truck") {
    return null;
  }
  return unit;
};

const getRosterFirefighter = (state: WorldState, rosterId: number | null): RosterUnit | null => {
  const unit = getRosterUnit(state, rosterId);
  if (!unit || unit.kind !== "firefighter") {
    return null;
  }
  return unit;
};

const unassignRosterFirefighter = (state: WorldState, firefighter: RosterUnit): void => {
  if (firefighter.assignedTruckId === null) {
    return;
  }
  const truck = getRosterTruck(state, firefighter.assignedTruckId);
  if (truck) {
    truck.crewIds = truck.crewIds.filter((id) => id !== firefighter.id);
  }
  firefighter.assignedTruckId = null;
};

export function assignRosterCrew(state: WorldState, firefighterId: number, truckId: number): boolean {
  if (state.phase !== "maintenance") {
    setStatus(state, "Crew assignments are managed during winter.");
    return false;
  }
  const firefighter = getRosterFirefighter(state, firefighterId);
  const truck = getRosterTruck(state, truckId);
  if (!firefighter || !truck) {
    return false;
  }
  if (firefighter.status === "lost" || truck.status === "lost") {
    return false;
  }
  if (truck.crewIds.length >= TRUCK_CAPACITY) {
    setStatus(state, "Truck crew is at capacity.");
    return false;
  }
  if (firefighter.assignedTruckId === truck.id) {
    return true;
  }
  unassignRosterFirefighter(state, firefighter);
  truck.crewIds.push(firefighter.id);
  firefighter.assignedTruckId = truck.id;
  setStatus(state, `${firefighter.name} assigned to ${truck.name}.`);
  return true;
}

export function unassignRosterCrew(state: WorldState, firefighterId: number): void {
  if (state.phase !== "maintenance") {
    setStatus(state, "Crew assignments are managed during winter.");
    return;
  }
  const firefighter = getRosterFirefighter(state, firefighterId);
  if (!firefighter) {
    return;
  }
  if (firefighter.assignedTruckId === null) {
    return;
  }
  const truck = getRosterTruck(state, firefighter.assignedTruckId);
  unassignRosterFirefighter(state, firefighter);
  if (truck) {
    setStatus(state, `${firefighter.name} unassigned from ${truck.name}.`);
  }
}

const nextTruckName = (state: WorldState): string => {
  const index = state.roster.filter((unit) => unit.kind === "truck").length + 1;
  const prefix = TRUCK_PREFIX[index % TRUCK_PREFIX.length];
  return `${prefix} ${index}`;
};

const nextFirefighterName = (rng: RNG): string => {
  const first = FIRST_NAMES[Math.floor(rng.next() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(rng.next() * LAST_NAMES.length)];
  return `${first} ${last}`;
};

const getTruckSortKey = (unit: Unit): number => unit.rosterId ?? unit.id;

const getCommandUnitById = (state: WorldState, commandUnitId: number | null): CommandUnit | null => {
  if (commandUnitId === null) {
    return null;
  }
  return state.commandUnits.find((entry) => entry.id === commandUnitId) ?? null;
};

const getCommandUnitTruckIds = (state: WorldState, commandUnitId: number): number[] => {
  const commandUnit = getCommandUnitById(state, commandUnitId);
  if (!commandUnit) {
    return [];
  }
  return commandUnit.truckIds.filter((truckId) => getUnitById(state, truckId)?.kind === "truck");
};

const getCommandUnitName = (index: number): string => {
  if (index < COMMAND_UNIT_NAMES.length) {
    return COMMAND_UNIT_NAMES[index]!;
  }
  return `Unit ${index + 1}`;
};

const normalizeCommandUnitSelection = (state: WorldState): void => {
  const validCommandUnitIds = new Set(state.commandUnits.map((entry) => entry.id));
  state.selectedCommandUnitIds = state.selectedCommandUnitIds.filter((id) => validCommandUnitIds.has(id));
  const validTruckIds = new Set(state.units.filter((unit) => unit.kind === "truck").map((unit) => unit.id));
  state.selectedTruckIds = state.selectedTruckIds.filter((id) => validTruckIds.has(id));
  if (state.focusedCommandUnitId !== null && !validCommandUnitIds.has(state.focusedCommandUnitId)) {
    state.focusedCommandUnitId = null;
  }
  if (state.focusedCommandUnitId === null) {
    if (state.selectedTruckIds.length > 0) {
      const focusedTruck = getUnitById(state, state.selectedTruckIds[0]!) ?? null;
      state.focusedCommandUnitId = focusedTruck?.commandUnitId ?? null;
    } else if (state.selectedCommandUnitIds.length > 0) {
      state.focusedCommandUnitId = state.selectedCommandUnitIds[0]!;
    }
  }
};

const syncMirroredTruckSelection = (state: WorldState): void => {
  let selectedTruckIds: number[] = [];
  if (state.selectionScope === "truck") {
    selectedTruckIds = [...state.selectedTruckIds];
  } else {
    const truckIds = new Set<number>();
    state.selectedCommandUnitIds.forEach((commandUnitId) => {
      getCommandUnitTruckIds(state, commandUnitId).forEach((truckId) => truckIds.add(truckId));
    });
    selectedTruckIds = [...truckIds];
  }
  state.selectedUnitIds = selectedTruckIds;
  state.units.forEach((unit) => {
    unit.selected = unit.kind === "truck" && selectedTruckIds.includes(unit.id);
  });
};

export const syncCommandUnits = (state: WorldState): void => {
  const deployedTrucks = state.units
    .filter((unit) => unit.kind === "truck")
    .sort((left, right) => getTruckSortKey(left) - getTruckSortKey(right));
  const previousByName = new Map(state.commandUnits.map((entry, index) => [entry.name, { entry, index }] as const));
  if (deployedTrucks.length === 0) {
    state.commandUnits = [];
    state.selectedCommandUnitIds = [];
    state.selectedTruckIds = [];
    state.focusedCommandUnitId = null;
    state.commandUnitsRevision += 1;
    syncMirroredTruckSelection(state);
    return;
  }

  const nextGroupCount =
    deployedTrucks.length <= 1
      ? 1
      : Math.min(deployedTrucks.length, Math.max(2, Math.min(4, Math.ceil(deployedTrucks.length / 5))));
  const nextCommandUnits: CommandUnit[] = [];
  let cursor = 0;
  for (let groupIndex = 0; groupIndex < nextGroupCount; groupIndex += 1) {
    const remainingGroups = nextGroupCount - groupIndex;
    const remainingTrucks = deployedTrucks.length - cursor;
    const chunkSize = Math.max(1, Math.ceil(remainingTrucks / remainingGroups));
    const chunk = deployedTrucks.slice(cursor, cursor + chunkSize);
    cursor += chunkSize;
    const name = getCommandUnitName(groupIndex);
    const previous = previousByName.get(name)?.entry ?? null;
    nextCommandUnits.push({
      id: previous?.id ?? state.nextCommandUnitId++,
      name,
      truckIds: chunk.map((unit) => unit.id),
      currentIntent: previous?.currentIntent ?? null,
      status: previous?.status ?? "holding",
      revision: (previous?.revision ?? 0) + 1
    });
  }

  state.units.forEach((unit) => {
    unit.commandUnitId = null;
  });
  nextCommandUnits.forEach((commandUnit) => {
    commandUnit.truckIds.forEach((truckId) => {
      const truck = getUnitById(state, truckId);
      if (!truck) {
        return;
      }
      truck.commandUnitId = commandUnit.id;
      truck.crewIds.forEach((crewId) => {
        const crew = getUnitById(state, crewId);
        if (crew) {
          crew.commandUnitId = commandUnit.id;
        }
      });
    });
  });
  state.commandUnits = nextCommandUnits;
  state.commandUnitsRevision += 1;
  normalizeCommandUnitSelection(state);
  syncMirroredTruckSelection(state);
};

const setSelectionStatus = (state: WorldState): void => {
  if (state.selectionScope === "truck") {
    if (state.selectedTruckIds.length > 0) {
      setStatus(state, `${state.selectedTruckIds.length} truck(s) selected. Right-click to issue orders.`);
    } else {
      resetStatus(state);
    }
    return;
  }
  if (state.selectedCommandUnitIds.length > 0) {
    const label =
      state.selectedCommandUnitIds.length === 1
        ? getCommandUnitById(state, state.selectedCommandUnitIds[0]!)?.name ?? "Command unit"
        : `${state.selectedCommandUnitIds.length} command units`;
    setStatus(state, `${label} selected. Right-click to issue orders.`);
  } else {
    resetStatus(state);
  }
};

export const clearCommandSelection = (state: WorldState): void => {
  state.selectedCommandUnitIds = [];
  state.selectedTruckIds = [];
  state.focusedCommandUnitId = null;
  state.selectionScope = "commandUnit";
  syncMirroredTruckSelection(state);
  resetStatus(state);
};

export const selectCommandUnit = (
  state: WorldState,
  commandUnitId: number | null,
  options?: { append?: boolean; toggle?: boolean }
): void => {
  if (commandUnitId === null) {
    clearCommandSelection(state);
    return;
  }
  const commandUnit = getCommandUnitById(state, commandUnitId);
  if (!commandUnit) {
    return;
  }
  state.selectionScope = "commandUnit";
  if (options?.toggle) {
    if (state.selectedCommandUnitIds.includes(commandUnitId)) {
      state.selectedCommandUnitIds = state.selectedCommandUnitIds.filter((id) => id !== commandUnitId);
    } else {
      state.selectedCommandUnitIds = [...state.selectedCommandUnitIds, commandUnitId];
    }
  } else if (options?.append) {
    if (!state.selectedCommandUnitIds.includes(commandUnitId)) {
      state.selectedCommandUnitIds = [...state.selectedCommandUnitIds, commandUnitId];
    }
  } else {
    state.selectedCommandUnitIds = [commandUnitId];
  }
  state.selectedTruckIds = [];
  state.focusedCommandUnitId = commandUnitId;
  syncMirroredTruckSelection(state);
  setSelectionStatus(state);
};

export const selectTruck = (
  state: WorldState,
  truck: Unit | null,
  options?: { append?: boolean; toggle?: boolean }
): void => {
  if (!truck || truck.kind !== "truck") {
    clearCommandSelection(state);
    return;
  }
  state.selectionScope = "truck";
  if (options?.toggle) {
    if (state.selectedTruckIds.includes(truck.id)) {
      state.selectedTruckIds = state.selectedTruckIds.filter((id) => id !== truck.id);
    } else {
      state.selectedTruckIds = [...state.selectedTruckIds, truck.id];
    }
  } else if (options?.append) {
    if (!state.selectedTruckIds.includes(truck.id)) {
      state.selectedTruckIds = [...state.selectedTruckIds, truck.id];
    }
  } else {
    state.selectedTruckIds = [truck.id];
  }
  state.selectedCommandUnitIds = [];
  state.focusedCommandUnitId = truck.commandUnitId;
  syncMirroredTruckSelection(state);
  setSelectionStatus(state);
};

export const returnToFocusedCommandUnitSelection = (state: WorldState): void => {
  if (state.selectionScope !== "truck") {
    return;
  }
  const focusedCommandUnitId =
    state.focusedCommandUnitId ??
    (state.selectedTruckIds.length > 0 ? getUnitById(state, state.selectedTruckIds[0]!)?.commandUnitId ?? null : null);
  state.selectionScope = "commandUnit";
  state.selectedTruckIds = [];
  state.selectedCommandUnitIds = focusedCommandUnitId !== null ? [focusedCommandUnitId] : [];
  state.focusedCommandUnitId = focusedCommandUnitId;
  syncMirroredTruckSelection(state);
  setSelectionStatus(state);
};

export const getSelectedTrucks = (state: WorldState): Unit[] =>
  state.units.filter((unit) => unit.kind === "truck" && state.selectedUnitIds.includes(unit.id));

export const getSelectedCommandUnits = (state: WorldState): CommandUnit[] =>
  state.commandUnits.filter((entry) => state.selectedCommandUnitIds.includes(entry.id));

const cloneCommandTarget = (target: CommandTarget): CommandTarget => {
  if (target.kind === "point") {
    return {
      kind: "point",
      point: { x: target.point.x, y: target.point.y }
    };
  }
  if (target.kind === "line") {
    return {
      kind: "line",
      start: { x: target.start.x, y: target.start.y },
      end: { x: target.end.x, y: target.end.y }
    };
  }
  return {
    kind: "area",
    start: { x: target.start.x, y: target.start.y },
    end: { x: target.end.x, y: target.end.y }
  };
};

const cloneCommandIntent = (intent: CommandIntent): CommandIntent => ({
  type: intent.type,
  target: cloneCommandTarget(intent.target),
  formation: intent.formation,
  behaviourMode: intent.behaviourMode
});

const commandTargetsEqual = (left: CommandTarget | null, right: CommandTarget | null): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "point":
      return right.kind === "point" && left.point.x === right.point.x && left.point.y === right.point.y;
    case "line":
    case "area":
      return (
        right.kind === left.kind &&
        left.start.x === right.start.x &&
        left.start.y === right.start.y &&
        left.end.x === right.end.x &&
        left.end.y === right.end.y
      );
  }
};

const commandIntentsEqual = (left: CommandIntent | null, right: CommandIntent | null): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.type === right.type &&
    left.formation === right.formation &&
    left.behaviourMode === right.behaviourMode &&
    commandTargetsEqual(left.target, right.target)
  );
};

export const clearTruckOverrideIntents = (state: WorldState, truckIds?: number[]): void => {
  const clearSet = truckIds ? new Set(truckIds) : null;
  state.units.forEach((unit) => {
    if (unit.kind !== "truck") {
      return;
    }
    if (clearSet && !clearSet.has(unit.id)) {
      return;
    }
    unit.truckOverrideIntent = null;
  });
};

export const clearSelectedTruckOverrides = (state: WorldState): void => {
  if (state.selectedTruckIds.length === 0) {
    return;
  }
  clearTruckOverrideIntents(state, state.selectedTruckIds);
  setStatus(state, "Selected trucks rejoined their command unit.");
};

const getSelectionCommandTargets = (state: WorldState): Unit[] => {
  if (state.selectionScope === "truck") {
    return getSelectedTrucks(state);
  }
  const truckIds = new Set<number>();
  getSelectedCommandUnits(state).forEach((commandUnit) => {
    commandUnit.truckIds.forEach((truckId) => truckIds.add(truckId));
  });
  return state.units.filter((unit) => unit.kind === "truck" && truckIds.has(unit.id));
};

export const applyCommandIntentToSelection = (state: WorldState, intent: CommandIntent): void => {
  if (state.selectionScope === "truck") {
    const selectedTrucks = getSelectedTrucks(state);
    selectedTrucks.forEach((truck) => {
      truck.truckOverrideIntent = cloneCommandIntent(intent);
    });
    if (selectedTrucks.length > 0) {
      setStatus(state, `${selectedTrucks.length} truck(s) assigned ${intent.type} orders.`);
    }
    return;
  }
  const selectedCommandUnits = getSelectedCommandUnits(state);
  selectedCommandUnits.forEach((commandUnit) => {
    commandUnit.currentIntent = cloneCommandIntent(intent);
    commandUnit.revision += 1;
  });
  clearTruckOverrideIntents(
    state,
    selectedCommandUnits.flatMap((commandUnit) => commandUnit.truckIds)
  );
  if (selectedCommandUnits.length > 0) {
    const label = selectedCommandUnits.length === 1 ? selectedCommandUnits[0]!.name : `${selectedCommandUnits.length} command units`;
    setStatus(state, `${label} assigned ${intent.type} orders.`);
  }
};

export const getEffectiveTruckIntent = (state: WorldState, truck: Unit): CommandIntent | null => {
  if (truck.kind !== "truck") {
    return null;
  }
  if (truck.truckOverrideIntent) {
    return truck.truckOverrideIntent;
  }
  return getCommandUnitById(state, truck.commandUnitId)?.currentIntent ?? null;
};

const getCommandTargetBounds = (target: CommandTarget): { minX: number; maxX: number; minY: number; maxY: number } => {
  if (target.kind === "point") {
    return {
      minX: target.point.x,
      maxX: target.point.x,
      minY: target.point.y,
      maxY: target.point.y
    };
  }
  return {
    minX: Math.min(target.start.x, target.end.x),
    maxX: Math.max(target.start.x, target.end.x),
    minY: Math.min(target.start.y, target.end.y),
    maxY: Math.max(target.start.y, target.end.y)
  };
};

const getCommandTargetCenter = (target: CommandTarget): Point => {
  if (target.kind === "point") {
    return target.point;
  }
  if (target.kind === "line") {
    return {
      x: Math.round((target.start.x + target.end.x) * 0.5),
      y: Math.round((target.start.y + target.end.y) * 0.5)
    };
  }
  return {
    x: Math.round((target.start.x + target.end.x) * 0.5),
    y: Math.round((target.start.y + target.end.y) * 0.5)
  };
};

const pointToSegmentDistance = (point: Point, start: Point, end: Point): number => {
  const abX = end.x - start.x;
  const abY = end.y - start.y;
  const abLenSq = abX * abX + abY * abY;
  if (abLenSq <= 1e-6) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = clamp(((point.x - start.x) * abX + (point.y - start.y) * abY) / abLenSq, 0, 1);
  const qx = start.x + abX * t;
  const qy = start.y + abY * t;
  return Math.hypot(point.x - qx, point.y - qy);
};

const pointInCommandTarget = (point: Point, target: CommandTarget): boolean => {
  if (target.kind === "point") {
    return Math.abs(point.x - target.point.x) <= 2 && Math.abs(point.y - target.point.y) <= 2;
  }
  if (target.kind === "line") {
    return pointToSegmentDistance(point, target.start, target.end) <= 3.5;
  }
  const bounds = getCommandTargetBounds(target);
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
};

const resolveLooseSlotTarget = (state: WorldState, target: Point, count: number, index: number): Point => {
  if (count <= 1) {
    return target;
  }
  const angle = (Math.PI * 2 * index) / count;
  const radius = count <= 2 ? 1 : count <= 4 ? 2 : 3;
  const rawX = Math.round(target.x + Math.cos(angle) * radius);
  const rawY = Math.round(target.y + Math.sin(angle) * radius);
  return findNearestPassable(state, rawX, rawY, 2) ?? target;
};

const resolveAreaSlotTarget = (state: WorldState, target: AreaTarget, count: number, index: number): Point => {
  const bounds = getCommandTargetBounds(target);
  const width = Math.max(1, bounds.maxX - bounds.minX + 1);
  const height = Math.max(1, bounds.maxY - bounds.minY + 1);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const rawX = Math.round(bounds.minX + ((column + 0.5) / columns) * width);
  const rawY = Math.round(bounds.minY + ((row + 0.5) / rows) * height);
  return findNearestPassable(state, rawX, rawY, 2) ?? getCommandTargetCenter(target);
};

const resolveLineSlotTarget = (state: WorldState, target: LineTarget, count: number, index: number): Point => {
  const t = count <= 1 ? 0.5 : index / Math.max(1, count - 1);
  const rawX = Math.round(target.start.x + (target.end.x - target.start.x) * t);
  const rawY = Math.round(target.start.y + (target.end.y - target.start.y) * t);
  return findNearestPassable(state, rawX, rawY, 2) ?? getCommandTargetCenter(target);
};

const resolveIntentSlotTarget = (state: WorldState, intent: CommandIntent, count: number, index: number): Point => {
  if (intent.formation === "area" && intent.target.kind === "area") {
    return resolveAreaSlotTarget(state, intent.target, count, index);
  }
  if (intent.formation === "line" && intent.target.kind === "line") {
    return resolveLineSlotTarget(state, intent.target, count, index);
  }
  return resolveLooseSlotTarget(state, getCommandTargetCenter(intent.target), count, index);
};

const findNearestThreatForTarget = (state: WorldState, origin: Point, target: CommandTarget): Point | null => {
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const bounds = getCommandTargetBounds(target);
  const minX = Math.max(0, bounds.minX - 4);
  const maxX = Math.min(state.grid.cols - 1, bounds.maxX + 4);
  const minY = Math.max(0, bounds.minY - 4);
  const maxY = Math.min(state.grid.rows - 1, bounds.maxY + 4);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const point = { x, y };
      const idx = indexFor(state.grid, x, y);
      const fireValue = state.tileFire[idx] ?? 0;
      const heatValue = state.tileHeat[idx] ?? 0;
      if (fireValue <= THREAT_FIRE_EPS && heatValue <= 0.08) {
        continue;
      }
      const nearTarget = pointInCommandTarget(point, target);
      const score =
        Math.hypot(origin.x - x, origin.y - y) +
        (nearTarget ? 0 : 6) -
        fireValue * 4 -
        heatValue * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = point;
      }
    }
  }
  return best;
};

const isTruckUnsafe = (state: WorldState, truck: Unit): boolean => {
  const tile = getUnitTile(truck);
  const idx = indexFor(state.grid, tile.x, tile.y);
  return (state.tileFire[idx] ?? 0) >= 0.2 || (state.tileHeat[idx] ?? 0) >= 0.45;
};

const moveTruckAwayFromThreat = (state: WorldState, truck: Unit, threatPoint: Point): void => {
  const tile = getUnitTile(truck);
  const dx = tile.x - threatPoint.x;
  const dy = tile.y - threatPoint.y;
  const scale = Math.max(1, Math.hypot(dx, dy));
  const retreatX = Math.round(tile.x + (dx / scale) * 3);
  const retreatY = Math.round(tile.y + (dy / scale) * 3);
  const retreatTile = findNearestPassable(state, retreatX, retreatY, 3) ?? tile;
  setUnitTargetIfNeeded(state, truck, retreatTile.x, retreatTile.y, false, { silent: true }, 0.8);
  truck.currentStatus = "retreating";
};

const igniteBackburnTile = (state: WorldState, tileX: number, tileY: number): boolean => {
  if (!inBounds(state.grid, tileX, tileY)) {
    return false;
  }
  const idx = indexFor(state.grid, tileX, tileY);
  const target = state.tiles[idx];
  if (!target || target.fuel <= 0 || target.type === "water" || target.type === "road" || target.type === "base" || target.type === "house") {
    return false;
  }
  if ((state.tileFire[idx] ?? 0) > THREAT_FIRE_EPS) {
    return false;
  }
  target.fire = Math.min(1, 0.4 + target.fuel * 0.2);
  target.heat = Math.max(target.heat, target.ignitionPoint * 1.1);
  state.tileFire[idx] = target.fire;
  state.tileHeat[idx] = target.heat;
  clearScheduledIgnition(state, idx);
  markFireBlockActiveByTile(state, idx);
  return true;
};

const maybeIgniteBackburn = (state: WorldState, truck: Unit, intent: CommandIntent, slotTarget: Point): void => {
  if (intent.type !== "backburn" || intent.target.kind !== "area") {
    return;
  }
  if (truck.pathIndex < truck.path.length) {
    return;
  }
  if (state.careerDay - truck.lastBackburnAt < BACKBURN_IGNITE_INTERVAL_DAYS) {
    return;
  }
  const bounds = getCommandTargetBounds(intent.target);
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let y = Math.max(0, bounds.minY); y <= Math.min(state.grid.rows - 1, bounds.maxY); y += 1) {
    for (let x = Math.max(0, bounds.minX); x <= Math.min(state.grid.cols - 1, bounds.maxX); x += 1) {
      const point = { x, y };
      if (Math.hypot(point.x - slotTarget.x, point.y - slotTarget.y) > BACKBURN_IGNITE_RADIUS) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const fireValue = state.tileFire[idx] ?? 0;
      if (fireValue > THREAT_FIRE_EPS) {
        continue;
      }
      const tile = state.tiles[idx];
      if (!tile || tile.fuel <= 0 || tile.type === "water" || tile.type === "road" || tile.type === "base" || tile.type === "house") {
        continue;
      }
      const score = Math.hypot(x - slotTarget.x, y - slotTarget.y);
      if (score < bestScore) {
        bestScore = score;
        best = point;
      }
    }
  }
  if (!best) {
    return;
  }
  if (igniteBackburnTile(state, best.x, best.y)) {
    truck.lastBackburnAt = state.careerDay;
  }
};

const updateTruckAlerts = (state: WorldState, truck: Unit): void => {
  const alerts: CommandUnitAlert[] = [];
  const waterRatio = truck.waterCapacity > 0 ? truck.water / truck.waterCapacity : 1;
  if (waterRatio <= 0) {
    alerts.push("empty");
  } else if (waterRatio <= TRUCK_WATER_CRITICAL_RATIO) {
    alerts.push("critical");
  } else if (waterRatio <= TRUCK_WATER_LOW_RATIO) {
    alerts.push("low");
  }
  if (truck.crewIds.length <= 1) {
    alerts.push("crew_low");
  }
  if (isTruckUnsafe(state, truck)) {
    alerts.push("danger");
  }
  truck.currentAlerts = alerts;
};

const isTruckNearRiverWaterSource = (state: WorldState, truck: Unit): boolean => {
  const tile = getUnitTile(truck);
  for (let dy = -TRUCK_RIVER_REFILL_RADIUS; dy <= TRUCK_RIVER_REFILL_RADIUS; dy += 1) {
    for (let dx = -TRUCK_RIVER_REFILL_RADIUS; dx <= TRUCK_RIVER_REFILL_RADIUS; dx += 1) {
      const nx = tile.x + dx;
      const ny = tile.y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const idx = indexFor(state.grid, nx, ny);
      if (state.tileRiverMask[idx] > 0) {
        return true;
      }
    }
  }
  return false;
};

const isTruckGroupActivelySpraying = (state: WorldState, truck: Unit): boolean => {
  if (truck.water <= 0.01) {
    return false;
  }
  if (truck.sprayTarget) {
    return true;
  }
  return state.units.some(
    (unit) =>
      unit.kind === "firefighter" &&
      unit.carrierId === null &&
      unit.assignedTruckId === truck.id &&
      unit.sprayTarget !== null
  );
};

const updateTruckWater = (state: WorldState, truck: Unit, delta: number): void => {
  if (truck.kind !== "truck" || truck.waterCapacity <= 0) {
    return;
  }
  const tile = getUnitTile(truck);
  const idx = indexFor(state.grid, tile.x, tile.y);
  if (state.tiles[idx]?.type === "base") {
    truck.water = clamp(truck.water + truck.waterRefillRate * delta, 0, truck.waterCapacity);
    return;
  }
  if (isTruckNearRiverWaterSource(state, truck) && !isTruckGroupActivelySpraying(state, truck)) {
    truck.water = clamp(truck.water + TRUCK_WATER_USE_RATE * delta, 0, truck.waterCapacity);
  }
};

const getUnitWaterSourceTruck = (state: WorldState, unit: Unit): Unit | null => {
  if (unit.kind === "truck") {
    return unit;
  }
  if (unit.assignedTruckId === null) {
    return null;
  }
  const truck = getUnitById(state, unit.assignedTruckId);
  return truck && truck.kind === "truck" ? truck : null;
};

const canUnitSpray = (state: WorldState, unit: Unit): boolean => {
  const truck = getUnitWaterSourceTruck(state, unit);
  if (!truck || truck.waterCapacity <= 0) {
    return true;
  }
  return truck.water > 0.01;
};

const spendUnitWater = (state: WorldState, unit: Unit, delta: number): void => {
  const truck = getUnitWaterSourceTruck(state, unit);
  if (!truck || truck.waterCapacity <= 0) {
    return;
  }
  const useRate = unit.kind === "truck" ? TRUCK_WATER_USE_RATE : FIREFIGHTER_WATER_USE_RATE;
  const spend = delta * useRate;
  truck.water = clamp(truck.water - spend, 0, truck.waterCapacity);
  const truckTile = getUnitTile(truck);
  const truckIdx = indexFor(state.grid, truckTile.x, truckTile.y);
  if (state.tiles[truckIdx]?.type !== "base" && isTruckNearRiverWaterSource(state, truck)) {
    truck.water = clamp(truck.water + spend, 0, truck.waterCapacity);
  }
};

const applyTruckCommandIntent = (state: WorldState, truck: Unit, selectedTrucks: Unit[], selectedIndex: number): void => {
  const intent = getEffectiveTruckIntent(state, truck);
  if (!intent) {
    truck.behaviourMode = "balanced";
    updateTruckAlerts(state, truck);
    if (truck.pathIndex < truck.path.length) {
      truck.currentStatus = "moving";
    } else if (truck.attackTarget || truck.sprayTarget) {
      truck.currentStatus = "suppressing";
    } else {
      truck.currentStatus = "holding";
    }
    return;
  }

  truck.behaviourMode = intent.behaviourMode;
  const slotTarget = resolveIntentSlotTarget(state, intent, selectedTrucks.length, selectedIndex);
  const nearbyThreat = findNearestThreatForTarget(state, slotTarget, intent.target);

  if (intent.type === "move") {
    clearSuppressionTargets(truck);
    truck.autonomous = false;
    setTruckCrewMode(state, truck.id, "boarded", { silent: true });
    setUnitTargetIfNeeded(state, truck, slotTarget.x, slotTarget.y, false, { silent: true }, 0.8);
    truck.currentStatus = truck.pathIndex < truck.path.length ? "moving" : "holding";
    updateTruckAlerts(state, truck);
    return;
  }

  truck.autonomous = true;
  setAttackTarget(truck, nearbyThreat ? { x: nearbyThreat.x + 0.5, y: nearbyThreat.y + 0.5 } : null);
  if (intent.behaviourMode === "defensive" && nearbyThreat && isTruckUnsafe(state, truck)) {
    moveTruckAwayFromThreat(state, truck, nearbyThreat);
    updateTruckAlerts(state, truck);
    return;
  }
  if (truck.pathIndex >= truck.path.length) {
    const distToSlot = Math.hypot(truck.x - (slotTarget.x + 0.5), truck.y - (slotTarget.y + 0.5));
    if (distToSlot > TRUCK_SUPPORT_POSITION_TOLERANCE * 0.75) {
      setTruckCrewMode(state, truck.id, "boarded", { silent: true });
      setUnitTargetIfNeeded(state, truck, slotTarget.x, slotTarget.y, false, { silent: true }, 0.8);
    }
  } else {
    setTruckCrewMode(state, truck.id, "boarded", { silent: true });
  }
  if (intent.type === "backburn") {
    maybeIgniteBackburn(state, truck, intent, slotTarget);
  }
  if (truck.pathIndex < truck.path.length) {
    truck.currentStatus = "moving";
  } else if (nearbyThreat) {
    truck.currentStatus = intent.behaviourMode === "defensive" && isTruckUnsafe(state, truck) ? "retreating" : "suppressing";
  } else {
    truck.currentStatus = "holding";
  }
  updateTruckAlerts(state, truck);
};

const updateCommandUnitStatuses = (state: WorldState): void => {
  state.commandUnits.forEach((commandUnit) => {
    const trucks = commandUnit.truckIds
      .map((truckId) => getUnitById(state, truckId))
      .filter((truck): truck is Unit => !!truck && truck.kind === "truck");
    const priority: CommandUnitStatus[] = ["retreating", "suppressing", "moving", "holding"];
    commandUnit.status = priority.find((status) => trucks.some((truck) => truck.currentStatus === status)) ?? "holding";
  });
};

const applyCommandIntentControl = (state: WorldState, delta: number): void => {
  syncCommandUnits(state);
  state.units.forEach((unit) => {
    if (unit.kind === "truck") {
      updateTruckWater(state, unit, delta);
    }
  });
  const trucks = state.units
    .filter((unit) => unit.kind === "truck")
    .sort((left, right) => getTruckSortKey(left) - getTruckSortKey(right));
  trucks.forEach((truck) => {
    const cohort = truck.truckOverrideIntent
      ? trucks.filter((entry) => entry.truckOverrideIntent && commandIntentsEqual(entry.truckOverrideIntent, truck.truckOverrideIntent))
      : truck.commandUnitId !== null
        ? getCommandUnitTruckIds(state, truck.commandUnitId)
            .map((truckId) => getUnitById(state, truckId))
            .filter((entry): entry is Unit => !!entry && entry.kind === "truck")
            .sort((left, right) => getTruckSortKey(left) - getTruckSortKey(right))
        : [truck];
    const selectedIndex = Math.max(0, cohort.findIndex((entry) => entry.id === truck.id));
    applyTruckCommandIntent(state, truck, cohort, selectedIndex);
  });
  updateCommandUnitStatuses(state);
};

export function seedStartingRoster(state: WorldState, rng: RNG): void {
  if (state.roster.length > 0) {
    return;
  }
  recruitUnit(state, rng, "firefighter", true);
  recruitUnit(state, rng, "firefighter", true);
  recruitUnit(state, rng, "truck", true);
  const truck = state.roster.find((unit) => unit.kind === "truck") ?? null;
  if (!truck) {
    return;
  }
  truck.crewIds = [];
  const starters = state.roster.filter((unit) => unit.kind === "firefighter");
  starters.slice(0, TRUCK_CAPACITY).forEach((firefighter) => {
    firefighter.assignedTruckId = truck.id;
    truck.crewIds.push(firefighter.id);
  });
}

export function recruitUnit(state: WorldState, rng: RNG, kind: UnitKind, free = false): boolean {
  if (state.phase !== "maintenance" && !free) {
    setStatus(state, "Recruitment is only available during winter.");
    return false;
  }
  const cost = kind === "truck" ? RECRUIT_TRUCK_COST : RECRUIT_FIREFIGHTER_COST;
  if (!free && state.budget < cost) {
    setStatus(state, "Insufficient budget to recruit.");
    return false;
  }
  const entry: RosterUnit = {
    id: state.nextRosterId,
    kind,
    name: kind === "truck" ? nextTruckName(state) : nextFirefighterName(rng),
    training: createTraining(),
    status: "available",
    assignedTruckId: null,
    crewIds: [],
    formation: "medium"
  };
  state.nextRosterId += 1;
  state.roster.push(entry);
  state.selectedRosterId = entry.id;
  if (!free) {
    state.budget -= cost;
  }
  setStatus(state, `${entry.name} recruited and ready for training.`);
  return true;
}

export function trainSelectedUnit(state: WorldState, skill: UnitSkill): boolean {
  if (state.phase !== "maintenance") {
    setStatus(state, "Training is only available during winter.");
    return false;
  }
  const unit = getRosterUnit(state, state.selectedRosterId);
  if (!unit || unit.status === "lost") {
    setStatus(state, "Select an available unit to train.");
    return false;
  }
  if (unit.training[skill] >= MAX_TRAINING_LEVEL) {
    setStatus(state, "Training level maxed.");
    return false;
  }
  const trainingCost = getTrainingCostForState(state);
  if (state.budget < trainingCost) {
    setStatus(state, "Insufficient budget for training.");
    return false;
  }
  unit.training[skill] += 1;
  state.budget -= trainingCost;
  setStatus(state, `${unit.name} trained: ${skill} level ${unit.training[skill]}.`);
  return true;
}

const getTrainingMultiplier = (training: RosterUnit["training"]) => ({
  speed: 1 + training.speed * TRAINING_SPEED_GAIN,
  power: 1 + training.power * TRAINING_POWER_GAIN,
  range: 1 + training.range * TRAINING_RANGE_GAIN,
  resilience: training.resilience * TRAINING_RESILIENCE_GAIN
});

const getFallbackTrainingMultiplier = () => ({
  speed: 1,
  power: 1,
  range: 1,
  resilience: 0
});

type DerivedUnitStats = {
  speed: number;
  radius: number;
  hoseRange: number;
  power: number;
  waterCapacity: number;
  waterRefillRate: number;
};

export const getTrainingCostForState = (state: WorldState): number =>
  Math.max(1, Math.round(TRAINING_COST * state.progression.resolved.trainingCostMultiplier));

export const getFirebreakCostForState = (state: WorldState): number =>
  Math.max(
    1,
    Math.round(
      getCharacterFirebreakCost(state.campaign.characterId, FIREBREAK_COST_PER_TILE) *
        state.progression.resolved.firebreakCostMultiplier
    )
  );

const buildUnitDerivedStats = (state: WorldState, kind: UnitKind, rosterUnit?: RosterUnit | null): DerivedUnitStats => {
  const config = UNIT_CONFIG[kind];
  const characterModifiers = getCharacterDefinition(state.campaign.characterId).modifiers;
  const progressionModifiers = state.progression.resolved;
  const training = rosterUnit ? getTrainingMultiplier(rosterUnit.training) : getFallbackTrainingMultiplier();
  return {
    speed: config.speed * characterModifiers.unitSpeedMultiplier * progressionModifiers.unitSpeedMultiplier * training.speed,
    radius: config.radius * training.range,
    hoseRange: config.hoseRange * progressionModifiers.unitHoseRangeMultiplier * training.range,
    power: config.power * characterModifiers.unitPowerMultiplier * progressionModifiers.unitPowerMultiplier * training.power,
    waterCapacity: kind === "truck" ? TRUCK_WATER_CAPACITY * progressionModifiers.truckWaterCapacityMultiplier : 0,
    waterRefillRate: kind === "truck" ? TRUCK_WATER_REFILL_RATE * progressionModifiers.truckWaterRefillRateMultiplier : 0
  };
};

export const syncProgressionUnitStats = (state: WorldState): void => {
  state.units.forEach((unit) => {
    const rosterUnit = getRosterUnit(state, unit.rosterId);
    const derivedStats = buildUnitDerivedStats(state, unit.kind, rosterUnit);
    const waterRatio =
      unit.kind === "truck" && unit.waterCapacity > 0 ? clamp(unit.water / unit.waterCapacity, 0, 1) : 1;
    unit.speed = derivedStats.speed;
    unit.radius = derivedStats.radius;
    unit.hoseRange = derivedStats.hoseRange;
    unit.power = derivedStats.power;
    unit.waterCapacity = derivedStats.waterCapacity;
    unit.waterRefillRate = derivedStats.waterRefillRate;
    unit.water = unit.kind === "truck" ? clamp(derivedStats.waterCapacity * waterRatio, 0, derivedStats.waterCapacity) : 0;
  });
};

const getUnitTile = (unit: Unit): Point => ({
  x: Math.floor(unit.x),
  y: Math.floor(unit.y)
});

const getUnitById = (state: WorldState, id: number): Unit | null =>
  state.units.find((unit) => unit.id === id) ?? null;

const getAssignedTruck = (state: WorldState, firefighter: Unit): Unit | null => {
  if (firefighter.assignedTruckId === null) {
    return null;
  }
  const truck = getUnitById(state, firefighter.assignedTruckId);
  return truck && truck.kind === "truck" ? truck : null;
};

const getNearestTruck = (state: WorldState, origin: Point): { unit: Unit; distance: number } | null => {
  let best: Unit | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (const unit of state.units) {
    if (unit.kind !== "truck") {
      continue;
    }
    const dist = Math.hypot(origin.x - unit.x, origin.y - unit.y);
    if (dist < bestDist) {
      bestDist = dist;
      best = unit;
    }
  }
  return best ? { unit: best, distance: bestDist } : null;
};

const detachFromCarrier = (state: WorldState, firefighter: Unit): void => {
  if (firefighter.carrierId === null) {
    return;
  }
  const carrier = getUnitById(state, firefighter.carrierId);
  if (carrier) {
    carrier.passengerIds = carrier.passengerIds.filter((id) => id !== firefighter.id);
  }
  firefighter.carrierId = null;
};

const boardTruck = (state: WorldState, firefighter: Unit, truck: Unit): boolean => {
  if (truck.kind !== "truck") {
    return false;
  }
  if (firefighter.assignedTruckId !== truck.id) {
    return false;
  }
  if (truck.passengerIds.length >= TRUCK_CAPACITY) {
    return false;
  }
  if (firefighter.carrierId !== null) {
    detachFromCarrier(state, firefighter);
  }
  if (!truck.passengerIds.includes(firefighter.id)) {
    truck.passengerIds.push(firefighter.id);
  }
  firefighter.carrierId = truck.id;
  firefighter.path = [];
  firefighter.pathIndex = 0;
  firefighter.x = truck.x;
  firefighter.y = truck.y;
  firefighter.attackTarget = null;
  firefighter.sprayTarget = null;
  return true;
};

const unassignFirefighterFromTruck = (state: WorldState, firefighter: Unit): void => {
  const truck = getAssignedTruck(state, firefighter);
  if (truck) {
    truck.crewIds = truck.crewIds.filter((id) => id !== firefighter.id);
    truck.passengerIds = truck.passengerIds.filter((id) => id !== firefighter.id);
  }
  firefighter.assignedTruckId = null;
  detachFromCarrier(state, firefighter);
};

const assignFirefighterToTruck = (state: WorldState, firefighter: Unit, truck: Unit): boolean => {
  if (truck.kind !== "truck") {
    return false;
  }
  if (truck.crewIds.length >= TRUCK_CAPACITY) {
    return false;
  }
  if (firefighter.assignedTruckId === truck.id) {
    return true;
  }
  if (firefighter.assignedTruckId !== null) {
    unassignFirefighterFromTruck(state, firefighter);
  }
  truck.crewIds.push(firefighter.id);
  firefighter.assignedTruckId = truck.id;
  return true;
};

const clampTargetToTruckRange = (state: WorldState, truck: Unit, target: Point): Point => {
  const truckTile = getUnitTile(truck);
  const dx = target.x - truckTile.x;
  const dy = target.y - truckTile.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= FIREFIGHTER_TETHER_DISTANCE) {
    return target;
  }
  const scale = FIREFIGHTER_TETHER_DISTANCE / Math.max(0.0001, dist);
  const rawX = Math.round(truckTile.x + dx * scale);
  const rawY = Math.round(truckTile.y + dy * scale);
  const clamped = findNearestPassable(state, rawX, rawY, 2);
  return clamped ?? truckTile;
};

const getSelectedTruck = (state: WorldState): Unit | null => {
  for (const unit of state.units) {
    if (unit.selected && unit.kind === "truck") {
      return unit;
    }
  }
  return null;
};

export function setDeployMode(state: WorldState, mode: UnitKind | "clear" | null, options?: { silent?: boolean }): void {
  state.deployMode = mode;
  if (options?.silent) {
    return;
  }
  const firebreakCost = getFirebreakCostForState(state);
  if (mode === "firefighter" || mode === "truck") {
    setStatus(state, `Deploy ${mode === "firefighter" ? "firefighter" : "truck"} units.`);
  } else if (mode === "clear") {
    setStatus(state, `Clear fuel breaks for ${formatCurrency(firebreakCost)} per tile.`);
  } else {
    resetStatus(state);
  }
}

export function clearUnitSelection(state: WorldState): void {
  clearCommandSelection(state);
}

export function selectUnit(state: WorldState, unit: Unit | null): void {
  if (!unit) {
    clearCommandSelection(state);
    return;
  }
  if (unit.kind === "firefighter" && unit.assignedTruckId !== null) {
    const assignedTruck = getUnitById(state, unit.assignedTruckId);
    if (assignedTruck) {
      selectCommandUnit(state, assignedTruck.commandUnitId);
      return;
    }
  }
  if (unit.kind === "truck") {
    selectCommandUnit(state, unit.commandUnitId);
    return;
  }
  clearCommandSelection(state);
}

export function toggleUnitSelection(state: WorldState, unit: Unit): void {
  if (unit.kind === "firefighter" && unit.assignedTruckId !== null) {
    const assignedTruck = getUnitById(state, unit.assignedTruckId);
    if (assignedTruck) {
      selectCommandUnit(state, assignedTruck.commandUnitId, { toggle: true });
    }
    return;
  }
  if (unit.kind === "truck") {
    selectCommandUnit(state, unit.commandUnitId, { toggle: true });
  }
}

export function getSelectedUnits(state: WorldState): Unit[] {
  return getSelectedTrucks(state);
}

export function createUnit(state: WorldState, kind: UnitKind, rng: RNG, rosterEntry?: RosterUnit | null): Unit {
  const rosterUnit = rosterEntry ?? state.roster.find((entry) => entry.kind === kind && entry.status === "available") ?? null;
  const derivedStats = buildUnitDerivedStats(state, kind, rosterUnit);
  const spawnX = state.basePoint.x + 0.5;
  const spawnY = state.basePoint.y + 0.5;
  return {
    id: state.nextUnitId++,
    kind,
    rosterId: rosterUnit ? rosterUnit.id : null,
    autonomous: kind !== "truck",
    x: spawnX,
    y: spawnY,
    prevX: spawnX,
    prevY: spawnY,
    target: null,
    path: [],
    pathIndex: 0,
    speed: derivedStats.speed,
    radius: derivedStats.radius,
    hoseRange: derivedStats.hoseRange,
    power: derivedStats.power,
    selected: false,
    carrierId: null,
    passengerIds: [],
    assignedTruckId: null,
    commandUnitId: null,
    crewIds: [],
    crewMode: "deployed",
    formation: rosterUnit ? rosterUnit.formation : "medium",
    behaviourMode: "balanced",
    attackTarget: null,
    sprayTarget: null,
    truckOverrideIntent: null,
    water: derivedStats.waterCapacity,
    waterCapacity: derivedStats.waterCapacity,
    waterRefillRate: derivedStats.waterRefillRate,
    lastBackburnAt: Number.NEGATIVE_INFINITY,
    currentStatus: "holding",
    currentAlerts: []
  };
}

export function setUnitTarget(
  state: WorldState,
  unit: Unit,
  tileX: number,
  tileY: number,
  manual = true,
  options?: { silent?: boolean }
): void {
  if (!inBounds(state.grid, tileX, tileY) || !isPassable(state, tileX, tileY)) {
    if (!options?.silent) {
      setStatus(state, "That location is blocked.");
    }
    return;
  }
  if (manual) {
    unit.autonomous = false;
  }

  // New control scheme logic
  if (unit.kind === "firefighter") {
    if (manual) {
      setStatus(state, "Firefighters are controlled by their truck. Move the truck to reposition the crew.");
      return;
    }
  } else if (unit.kind === "truck" && manual) {
    setTruckCrewMode(state, unit.id, "boarded", { silent: true });
  }

  unit.target = { x: tileX, y: tileY };
  unit.path = findPath(state, { x: Math.floor(unit.x), y: Math.floor(unit.y) }, unit.target);
  unit.pathIndex = 0;
  if (!options?.silent) {
    setStatus(state, `${unit.kind} routing to ${tileX}, ${tileY}.`);
  }
}

export function deployUnit(state: WorldState, rng: RNG, kind: UnitKind, tileX: number, tileY: number): void {
  const selectedRoster = getRosterUnit(state, state.selectedRosterId);
  let rosterEntry: RosterUnit | null =
    selectedRoster && selectedRoster.kind === kind && selectedRoster.status === "available" ? selectedRoster : null;
  const deployedTruckMap = new Map<number, Unit>();
  state.units.forEach((unit) => {
    if (unit.kind === "truck" && unit.rosterId !== null) {
      deployedTruckMap.set(unit.rosterId, unit);
    }
  });
  if (!rosterEntry) {
    if (kind === "firefighter") {
      rosterEntry =
        state.roster.find(
          (entry) =>
            entry.kind === "firefighter" &&
            entry.status === "available" &&
            entry.assignedTruckId !== null &&
            deployedTruckMap.has(entry.assignedTruckId)
        ) ?? null;
    } else {
      rosterEntry = state.roster.find((entry) => entry.kind === kind && entry.status === "available") ?? null;
    }
  }
  if (!rosterEntry) {
    setStatus(state, "No available units in the roster.");
    return;
  }
  let assignedTruck: Unit | null = null;
  if (kind === "firefighter") {
    if (rosterEntry.assignedTruckId === null) {
      setStatus(state, "Assign this firefighter to a truck before deploying.");
      return;
    }
    assignedTruck = deployedTruckMap.get(rosterEntry.assignedTruckId) ?? null;
    if (!assignedTruck) {
      setStatus(state, "Assigned truck is not deployed.");
      return;
    }
    if (assignedTruck.crewIds.length >= TRUCK_CAPACITY) {
      setStatus(state, "Assigned truck is at crew capacity.");
      return;
    }
  }
  const unit = createUnit(state, kind, rng, rosterEntry);
  rosterEntry.status = "deployed";
  state.units.push(unit);
  if (kind === "firefighter" && assignedTruck) {
    if (!assignFirefighterToTruck(state, unit, assignedTruck)) {
      state.units = state.units.filter((entry) => entry.id !== unit.id);
      rosterEntry.status = "available";
      setStatus(state, "Assigned truck is at crew capacity.");
      return;
    }
    if (!boardTruck(state, unit, assignedTruck)) {
      const truckTile = getUnitTile(assignedTruck);
      setUnitTarget(state, unit, truckTile.x, truckTile.y, false, { silent: true });
    }
    syncCommandUnits(state);
    return;
  }
  if (kind === "truck") {
    unit.crewMode = "boarded";
    const crewRoster = state.roster.filter(
      (entry) =>
        entry.kind === "firefighter" &&
        entry.status === "available" &&
        entry.assignedTruckId === rosterEntry.id
    );
    let deployedCrew = 0;
    crewRoster.forEach((crewEntry) => {
      if (deployedCrew >= TRUCK_CAPACITY) {
        return;
      }
      const crewUnit = createUnit(state, "firefighter", rng, crewEntry);
      crewEntry.status = "deployed";
      state.units.push(crewUnit);
      if (!assignFirefighterToTruck(state, crewUnit, unit) || !boardTruck(state, crewUnit, unit)) {
        const truckTile = getUnitTile(unit);
        setUnitTarget(state, crewUnit, truckTile.x, truckTile.y, false, { silent: true });
      }
      deployedCrew += 1;
    });
    setTruckCrewMode(state, unit.id, "boarded", { silent: true });
  }
  setUnitTarget(state, unit, tileX, tileY, false);
  syncCommandUnits(state);
}

export function clearFuelAt(state: WorldState, rng: RNG, tileX: number, tileY: number, showStatus = true): boolean {
  if (state.phase !== "maintenance") {
    if (showStatus) {
      setStatus(state, "Fuel breaks can only be cut during maintenance.");
    }
    return false;
  }
  if (!inBounds(state.grid, tileX, tileY)) {
    return false;
  }
  const firebreakCost = getFirebreakCostForState(state);
  const tile = state.tiles[indexFor(state.grid, tileX, tileY)];
  if (tile.type === "water" || tile.type === "base" || tile.type === "house" || tile.type === "road") {
    if (showStatus) {
      setStatus(state, "That location cannot be cleared.");
    }
    return false;
  }
  if (tile.type === "firebreak") {
    if (showStatus) {
      setStatus(state, "Fuel break already established.");
    }
    return false;
  }
  if (state.budget < firebreakCost) {
    if (showStatus) {
      setStatus(state, "Insufficient budget.");
    }
    return false;
  }
  if (tile.type === "ash") {
    state.burnedTiles = Math.max(0, state.burnedTiles - 1);
  }
  tile.type = "firebreak";
  state.terrainTypeRevision += 1;
  state.vegetationRevision += 1;
  clearVegetationState(tile);
  tile.dominantTreeType = null;
  tile.treeType = null;
  tile.ashAge = 0;
  applyFuel(tile, tile.moisture, rng);
  state.terrainDirty = true;
  syncTileSoAIndex(state, indexFor(state.grid, tileX, tileY));
  state.budget -= firebreakCost;
  if (showStatus) {
    setStatus(state, "Fuel break established.");
  }
  return true;
}

export function clearFuelLine(state: WorldState, rng: RNG, start: Point, end: Point): void {
  if (state.phase !== "maintenance") {
    setStatus(state, "Fuel breaks can only be cut during maintenance.");
    return;
  }
  if (
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(end.x) ||
    !Number.isFinite(end.y)
  ) {
    setStatus(state, "Invalid fuel break coordinates.");
    return;
  }
  const firebreakCost = getFirebreakCostForState(state);
  if (state.budget < firebreakCost) {
    setStatus(state, "Insufficient budget.");
    return;
  }
  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cleared = 0;
  let spent = 0;
  let steps = 0;
  const maxSteps = state.grid.totalTiles + 1;

  while (true) {
    steps += 1;
    if (steps > maxSteps) {
      console.warn("Fuel break line traversal aborted due to unexpected path length.", { start, end, maxSteps });
      setStatus(state, "Fuel break line aborted due to an invalid path.");
      return;
    }
    if (state.budget < firebreakCost) {
      break;
    }
    if (clearFuelAt(state, rng, x0, y0, false)) {
      cleared += 1;
      spent += firebreakCost;
    }
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  if (cleared > 0) {
    setStatus(state, `Fuel break carved across ${cleared} tiles for ${formatCurrency(spent)}.`);
  } else {
    setStatus(state, "No valid tiles to clear along that line.");
  }
}

export function getUnitAt(state: WorldState, tileX: number, tileY: number): Unit | null {
  const clickX = tileX + 0.5;
  const clickY = tileY + 0.5;
  for (const unit of state.units) {
    if (unit.carrierId !== null) {
      continue;
    }
    const dist = Math.hypot(unit.x - clickX, unit.y - clickY);
    if (dist < 0.6) {
      return unit;
    }
  }
  return null;
}

export function stepUnits(state: WorldState, delta: number): void {
  applyCommandIntentControl(state, delta);
  state.units.forEach((unit) => {
    unit.prevX = unit.x;
    unit.prevY = unit.y;
  });

  const unitsById = new Map<number, Unit>();
  state.units.forEach((unit) => {
    unitsById.set(unit.id, unit);
  });

  const advanceUnit = (unit: Unit) => {
    if (unit.pathIndex < unit.path.length) {
      const next = unit.path[unit.pathIndex];
      const targetX = next.x + 0.5;
      const targetY = next.y + 0.5;
      const dx = targetX - unit.x;
      const dy = targetY - unit.y;
      const dist = Math.hypot(dx, dy);
      const tile = getUnitTile(unit);
      const speedMultiplier = getMoveSpeedMultiplier(state, tile.x, tile.y, next.x, next.y);
      let step = unit.speed * speedMultiplier * delta;
      if (unit.kind === "firefighter" && unit.sprayTarget) {
        const distToSpray = Math.hypot(unit.sprayTarget.x - unit.x, unit.sprayTarget.y - unit.y);
        if (distToSpray <= unit.hoseRange + Math.max(0.35, unit.radius * 0.35)) {
          step *= MOVING_SPRAY_SPEED_FACTOR;
        }
      }
      if (dist <= step || dist < 0.01) {
        unit.x = targetX;
        unit.y = targetY;
        unit.pathIndex += 1;
      } else {
        unit.x += (dx / dist) * step;
        unit.y += (dy / dist) * step;
      }
    }
  };

  state.units.forEach((unit) => {
    if (unit.kind === "truck") {
      const isWaitingForCrew = unit.crewMode === "boarded" && unit.passengerIds.length < unit.crewIds.length;
      if (!isWaitingForCrew) {
        advanceUnit(unit);
      }
      const hasArrived = unit.pathIndex >= unit.path.length;
      if (hasArrived && unit.crewMode === "boarded") {
        updateTruckCrewOrders(state, unit);
      }
    }
  });

  state.units.forEach((unit) => {
    if (unit.kind !== "firefighter") {
      return;
    }
    if (unit.carrierId !== null) {
      const carrier = unitsById.get(unit.carrierId);
      if (!carrier) {
        unit.carrierId = null;
      } else {
        unit.x = carrier.x;
        unit.y = carrier.y;
        if (unit.target) {
          const distToTarget = Math.hypot(unit.target.x + 0.5 - carrier.x, unit.target.y + 0.5 - carrier.y);
          if (distToTarget <= 0.8) {
            detachFromCarrier(state, unit);
            unit.path = findPath(state, getUnitTile(unit), unit.target);
            unit.pathIndex = 0;
          }
        }
      }
      return;
    }
    advanceUnit(unit);
  });
}

type SuppressionThreatClass = "burning" | "pending" | "holdover" | "cold";

const isSuppressionIgnitableTypeId = (tid: number): boolean =>
  tid !== TILE_TYPE_IDS.water &&
  tid !== TILE_TYPE_IDS.ash &&
  tid !== TILE_TYPE_IDS.firebreak &&
  tid !== TILE_TYPE_IDS.beach &&
  tid !== TILE_TYPE_IDS.rocky &&
  tid !== TILE_TYPE_IDS.bare &&
  tid !== TILE_TYPE_IDS.road;

const getSuppressionThreatClass = (state: WorldState, idx: number): SuppressionThreatClass => {
  const fireValue = state.tileFire[idx] ?? 0;
  const heatValue = state.tileHeat[idx] ?? 0;
  const wetnessValue = state.tileSuppressionWetness[idx] ?? 0;
  const scheduled = state.tileIgniteAt[idx] < Number.POSITIVE_INFINITY;
  const ignitionPoint = Math.max(0.0001, state.tileIgnitionPoint[idx] ?? 0.0001);

  if (fireValue > THREAT_FIRE_EPS) {
    return "burning";
  }
  if (scheduled || heatValue >= ignitionPoint * 0.78) {
    return "pending";
  }
  if (heatValue >= Math.max(THREAT_HOLDOVER_HEAT_EPS, ignitionPoint * 0.45) || (wetnessValue > THREAT_HOLDOVER_WETNESS_EPS && heatValue > 0.04)) {
    return "holdover";
  }
  return "cold";
};

const getNearbyAssetWeight = (state: WorldState, x: number, y: number): number => {
  let weight = 1;
  for (let dy = -THREAT_ASSET_RADIUS; dy <= THREAT_ASSET_RADIUS; dy += 1) {
    for (let dx = -THREAT_ASSET_RADIUS; dx <= THREAT_ASSET_RADIUS; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const tid = state.tileTypeId[indexFor(state.grid, nx, ny)] ?? -1;
      if (tid === TILE_TYPE_IDS.base) {
        weight = Math.max(weight, 1.85);
      } else if (tid === TILE_TYPE_IDS.house) {
        weight = Math.max(weight, 1.5);
      }
    }
  }
  return weight;
};

const getSuppressionThreatScore = (state: WorldState, x: number, y: number): number => {
  const idx = indexFor(state.grid, x, y);
  const threatClass = getSuppressionThreatClass(state, idx);
  if (threatClass === "cold") {
    return 0;
  }

  const fireValue = state.tileFire[idx] ?? 0;
  const heatValue = state.tileHeat[idx] ?? 0;
  const wetnessValue = state.tileSuppressionWetness[idx] ?? 0;
  const scheduled = state.tileIgniteAt[idx] < Number.POSITIVE_INFINITY;
  let burningNeighbors = 0;
  let exposedNeighbors = 0;
  let supportiveNeighbors = 0;

  for (const offset of THREAT_NEIGHBOR_DIRS) {
    const nx = x + offset.dx;
    const ny = y + offset.dy;
    if (!inBounds(state.grid, nx, ny)) {
      continue;
    }
    const nidx = indexFor(state.grid, nx, ny);
    const neighborFire = state.tileFire[nidx] ?? 0;
    const neighborFuel = state.tileFuel[nidx] ?? 0;
    const neighborTypeId = state.tileTypeId[nidx] ?? -1;
    const neighborThreat = getSuppressionThreatClass(state, nidx);
    if (neighborFire > THREAT_FIRE_EPS) {
      burningNeighbors += 1;
      supportiveNeighbors += 1;
    } else if (neighborThreat === "pending" || neighborThreat === "holdover") {
      supportiveNeighbors += 1;
    }
    if (neighborFuel > 0 && isSuppressionIgnitableTypeId(neighborTypeId) && neighborFire <= THREAT_FIRE_EPS) {
      exposedNeighbors += 1;
    }
  }

  const classWeight =
    threatClass === "burning"
      ? 1.3 + fireValue * 1.15
      : threatClass === "pending"
        ? 0.95 + heatValue * 0.82 + (scheduled ? 0.18 : 0)
        : 0.6 + heatValue * 0.45 + wetnessValue * 0.28;
  const assetWeight = getNearbyAssetWeight(state, x, y);
  const flankWeight =
    threatClass === "burning" || threatClass === "pending"
      ? clamp(0.75 + exposedNeighbors * 0.2 - Math.max(0, burningNeighbors - 4) * 0.1, 0.55, 1.8)
      : clamp(0.85 + supportiveNeighbors * 0.08 + exposedNeighbors * 0.06, 0.7, 1.4);
  const continuityWeight = clamp(0.8 + supportiveNeighbors * 0.08, 0.8, 1.5);
  return classWeight * assetWeight * flankWeight * continuityWeight;
};

const getClusterSuppressionScore = (state: WorldState, centerX: number, centerY: number, radius: number): number => {
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(centerY + radius));
  let total = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(centerX - tileCenterX, centerY - tileCenterY);
      if (dist > radius) {
        continue;
      }
      const threatScore = getSuppressionThreatScore(state, x, y);
      if (threatScore <= 0) {
        continue;
      }
      const falloff = clamp(1 - dist / Math.max(0.0001, radius), 0, 1);
      total += threatScore * (0.28 + falloff * 0.72);
    }
  }
  return total;
};

const refineSuppressionFocus = (state: WorldState, origin: Point, radius: number): Point => {
  const minX = Math.max(0, Math.floor(origin.x - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(origin.x + radius));
  const minY = Math.max(0, Math.floor(origin.y - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(origin.y + radius));
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(origin.x - tileCenterX, origin.y - tileCenterY);
      if (dist > radius) {
        continue;
      }
      const threatScore = getSuppressionThreatScore(state, x, y);
      if (threatScore <= 0) {
        continue;
      }
      const falloff = clamp(1 - dist / Math.max(0.0001, radius), 0, 1);
      const weight = threatScore * (0.35 + falloff * 0.65);
      if (weight <= 0) {
        continue;
      }
      totalWeight += weight;
      weightedX += tileCenterX * weight;
      weightedY += tileCenterY * weight;
    }
  }
  if (totalWeight <= 0.0001) {
    return origin;
  }
  return { x: weightedX / totalWeight, y: weightedY / totalWeight };
};

const findFireTargetNear = (state: WorldState, center: Point, radius: number, preferredFocus: Point | null = null): Point | null => {
  let best: Point | null = null;
  let bestScore = 0;
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(center.y + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(center.x - tileCenterX, center.y - tileCenterY);
      if (dist > radius) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const fireValue = state.tileFire[idx];
      const heatValue = state.tileHeat[idx];
      if (fireValue <= 0 && heatValue <= 0.05) {
        continue;
      }
      const clusterScore = getClusterSuppressionScore(state, tileCenterX, tileCenterY, FIRE_FOCUS_CLUSTER_RADIUS);
      if (clusterScore <= 0.08) {
        continue;
      }
      const distanceWeight = clamp(1 - dist / Math.max(0.0001, radius), 0, 1);
      const preferredDistance = preferredFocus ? Math.hypot(tileCenterX - preferredFocus.x, tileCenterY - preferredFocus.y) : 0;
      const preferredWeight = preferredFocus
        ? clamp(1 - preferredDistance / Math.max(FIRE_FOCUS_CLUSTER_RADIUS * 2.5, radius * 0.4, 1), 0, 1)
        : 0;
      const score = clusterScore * (0.34 + distanceWeight * 0.66) * (preferredFocus ? 0.86 + preferredWeight * 0.44 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = { x: tileCenterX, y: tileCenterY };
      }
    }
  }
  return best && bestScore > 0.18 ? refineSuppressionFocus(state, best, FIRE_FOCUS_CLUSTER_RADIUS) : null;
};

const setAttackTarget = (unit: Unit, target: Point | null): void => {
  unit.attackTarget = target ? { x: target.x, y: target.y } : null;
};

const setSprayTarget = (unit: Unit, target: Point | null): void => {
  unit.sprayTarget = target ? { x: target.x, y: target.y } : null;
};

const clearSuppressionTargets = (unit: Unit): void => {
  setAttackTarget(unit, null);
  setSprayTarget(unit, null);
};

const setUnitTargetIfNeeded = (
  state: WorldState,
  unit: Unit,
  tileX: number,
  tileY: number,
  manual = false,
  options?: { silent?: boolean },
  tolerance = CREW_REISSUE_DISTANCE
): void => {
  if (unit.target && unit.target.x === tileX && unit.target.y === tileY && unit.pathIndex < unit.path.length) {
    return;
  }
  const distToTarget = Math.hypot(unit.x - (tileX + 0.5), unit.y - (tileY + 0.5));
  if (distToTarget <= tolerance && (!unit.target || unit.pathIndex >= unit.path.length)) {
    unit.target = { x: tileX, y: tileY };
    unit.path = [];
    unit.pathIndex = 0;
    return;
  }
  setUnitTarget(state, unit, tileX, tileY, manual, options);
};

const getAverageHoseRange = (crew: Unit[]): number => {
  if (crew.length === 0) {
    return 0;
  }
  let total = 0;
  for (const member of crew) {
    total += Math.max(0, member.hoseRange);
  }
  return total / crew.length;
};

const getStandoffDistance = (hoseRange: number, behaviourMode: BehaviourMode = "balanced"): number => {
  const base = clamp(hoseRange * 0.85, 2.75, Math.max(2.75, hoseRange - 0.5));
  if (behaviourMode === "aggressive") {
    return Math.max(2.35, base - 0.65);
  }
  if (behaviourMode === "defensive") {
    return base + 0.9;
  }
  return base;
};

const findPassableStandoffSlot = (
  state: WorldState,
  desiredX: number,
  desiredY: number,
  fireTarget: Point,
  attackDirX: number,
  attackDirY: number,
  radius = 2
): Point | null => {
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let r = 0; r <= radius; r += 1) {
    const minX = Math.max(0, Math.floor(desiredX - r));
    const maxX = Math.min(state.grid.cols - 1, Math.ceil(desiredX + r));
    const minY = Math.max(0, Math.floor(desiredY - r));
    const maxY = Math.min(state.grid.rows - 1, Math.ceil(desiredY + r));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (r > 0 && Math.abs(x - desiredX) < r && Math.abs(y - desiredY) < r) {
          continue;
        }
        if (!inBounds(state.grid, x, y) || !isPassable(state, x, y)) {
          continue;
        }
        const fireSideDot = (x - fireTarget.x) * attackDirX + (y - fireTarget.y) * attackDirY;
        if (fireSideDot > 0.2) {
          continue;
        }
        const score = Math.hypot(x - desiredX, y - desiredY);
        if (score < bestScore) {
          bestScore = score;
          best = { x, y };
        }
      }
    }
    if (best) {
      return best;
    }
  }
  return null;
};

const updateTruckCrewOrders = (state: WorldState, truck: Unit): void => {
  if (truck.kind !== "truck") {
    return;
  }
  truck.crewIds = truck.crewIds.filter((id) => {
    const crew = getUnitById(state, id);
    if (!crew || crew.kind !== "firefighter") {
      return false;
    }
    crew.assignedTruckId = truck.id;
    return true;
  });
  truck.passengerIds = truck.passengerIds.filter((id) => truck.crewIds.includes(id));
  const truckTile = getUnitTile(truck);
  const deployedCrew = truck.crewIds.map((id) => getUnitById(state, id)).filter((c) => c) as Unit[];
  const averageHoseRange = getAverageHoseRange(deployedCrew);
  const engagementRadius = FIREFIGHTER_TETHER_DISTANCE + averageHoseRange;
  const preferredFocus =
    deployedCrew.find((crew) => crew.attackTarget)?.attackTarget ??
    truck.attackTarget ??
    truck.sprayTarget ??
    null;
  const fireFocus = deployedCrew.length > 0 ? findFireTargetNear(state, truckTile, engagementRadius, preferredFocus) : null;

  if (truck.crewMode === "boarded") {
    clearSuppressionTargets(truck);
    for (const id of truck.crewIds) {
      const crew = getUnitById(state, id);
      if (!crew || crew.carrierId === truck.id) {
        continue;
      }
      clearSuppressionTargets(crew);
      const distToTruck = Math.hypot(crew.x - truck.x, crew.y - truck.y);
      if (distToTruck <= TRUCK_BOARD_RADIUS && truck.passengerIds.length < TRUCK_CAPACITY) {
        boardTruck(state, crew, truck);
      } else {
        setUnitTargetIfNeeded(state, crew, truckTile.x, truckTile.y, false, { silent: true }, 0.8);
      }
    }
    if (deployedCrew.length === 0 || !fireFocus || truck.pathIndex < truck.path.length) {
      return;
    }
    const dirX = fireFocus.x - truck.x;
    const dirY = fireFocus.y - truck.y;
    const dirMag = Math.hypot(dirX, dirY);
    const attackDirX = dirMag > 0.0001 ? dirX / dirMag : 1;
    const attackDirY = dirMag > 0.0001 ? dirY / dirMag : 0;
    const averageStandoff =
      deployedCrew.reduce((sum, crew) => sum + getStandoffDistance(crew.hoseRange, truck.behaviourMode), 0) /
      deployedCrew.length;
    const desiredSupportX = fireFocus.x - attackDirX * (averageStandoff + 2.0);
    const desiredSupportY = fireFocus.y - attackDirY * (averageStandoff + 2.0);
    const supportTile =
      findPassableStandoffSlot(state, desiredSupportX, desiredSupportY, fireFocus, attackDirX, attackDirY, 2) ??
      findNearestPassable(state, Math.round(desiredSupportX), Math.round(desiredSupportY), 2) ??
      truckTile;
    const supportDist = Math.hypot(truckTile.x - supportTile.x, truckTile.y - supportTile.y);
    if (supportDist > TRUCK_SUPPORT_POSITION_TOLERANCE) {
      if (
        truck.autonomous &&
        (!truck.target || truck.target.x !== supportTile.x || truck.target.y !== supportTile.y || truck.pathIndex >= truck.path.length)
      ) {
        setUnitTargetIfNeeded(state, truck, supportTile.x, supportTile.y, false, { silent: true }, 0.95);
      }
      return;
    }
    truck.crewMode = "deployed";
    truck.passengerIds = [];
    for (const crew of deployedCrew) {
      if (crew.carrierId === truck.id) {
        detachFromCarrier(state, crew);
      }
    }
  }

  if (deployedCrew.length === 0) {
    clearSuppressionTargets(truck);
    return;
  }
  if (!fireFocus) {
    clearSuppressionTargets(truck);
    deployedCrew.forEach((crew) => clearSuppressionTargets(crew));
    return;
  }

  const dirX = fireFocus.x - truck.x;
  const dirY = fireFocus.y - truck.y;
  const dirMag = Math.hypot(dirX, dirY);
  const attackDirX = dirMag > 0.0001 ? dirX / dirMag : 1;
  const attackDirY = dirMag > 0.0001 ? dirY / dirMag : 0;
  const perpX = -attackDirY;
  const perpY = attackDirX;
  const averageStandoff =
    deployedCrew.reduce((sum, crew) => sum + getStandoffDistance(crew.hoseRange, truck.behaviourMode), 0) /
    deployedCrew.length;
  const desiredSupportX = fireFocus.x - attackDirX * (averageStandoff + 2.0);
  const desiredSupportY = fireFocus.y - attackDirY * (averageStandoff + 2.0);
  const supportTile =
    findPassableStandoffSlot(state, desiredSupportX, desiredSupportY, fireFocus, attackDirX, attackDirY, 2) ??
    findNearestPassable(state, Math.round(desiredSupportX), Math.round(desiredSupportY), 2) ??
    truckTile;
  const supportDist = Math.hypot(truckTile.x - supportTile.x, truckTile.y - supportTile.y);

  if (supportDist > TRUCK_SUPPORT_POSITION_TOLERANCE) {
    truck.crewMode = "boarded";
    clearSuppressionTargets(truck);
    deployedCrew.forEach((crew) => {
      clearSuppressionTargets(crew);
      if (crew.carrierId === truck.id) {
        return;
      }
      const distToTruck = Math.hypot(crew.x - truck.x, crew.y - truck.y);
      if (distToTruck <= TRUCK_BOARD_RADIUS && truck.passengerIds.length < TRUCK_CAPACITY) {
        boardTruck(state, crew, truck);
      } else {
        setUnitTargetIfNeeded(state, crew, truckTile.x, truckTile.y, false, { silent: true }, 0.8);
      }
    });
    if (
      truck.autonomous &&
      (!truck.target || truck.target.x !== supportTile.x || truck.target.y !== supportTile.y || truck.pathIndex >= truck.path.length)
    ) {
      setUnitTargetIfNeeded(state, truck, supportTile.x, supportTile.y, false, { silent: true }, 0.95);
    }
    return;
  }

  deployedCrew.forEach((crew) => {
    if (crew.carrierId === truck.id) {
      detachFromCarrier(state, crew);
    }
    setAttackTarget(crew, fireFocus);
    const distFromTruck = Math.hypot(crew.x - truck.x, crew.y - truck.y);
    if (distFromTruck > FIREFIGHTER_TETHER_DISTANCE) {
      const returnTile = findNearestPassable(state, supportTile.x, supportTile.y, 2) ?? truckTile;
      setUnitTargetIfNeeded(state, crew, returnTile.x, returnTile.y, false, { silent: true }, 0.8);
    }
  });

  setAttackTarget(
    truck,
    Math.hypot(fireFocus.x - truck.x, fireFocus.y - truck.y) <= truck.hoseRange + 0.75 ? fireFocus : null
  );

  const isCrewIdle = deployedCrew.every((crew) => !crew.target || crew.pathIndex >= crew.path.length);
  if (!isCrewIdle) {
    return;
  }

  const formation = deployedCrew[0].formation;
  const spacing = FORMATION_SPACING[formation];
  const crewSize = deployedCrew.length;
  deployedCrew.forEach((crew, i) => {
    const offset = (i - (crewSize - 1) / 2) * spacing;
    const standoffDistance = getStandoffDistance(crew.hoseRange, truck.behaviourMode);
    const desiredX = fireFocus.x - attackDirX * standoffDistance + perpX * offset;
    const desiredY = fireFocus.y - attackDirY * standoffDistance + perpY * offset;
    const finalTarget =
      findPassableStandoffSlot(state, desiredX, desiredY, fireFocus, attackDirX, attackDirY, 2) ??
      findNearestPassable(state, supportTile.x, supportTile.y, 2);
    if (finalTarget) {
      setUnitTargetIfNeeded(state, crew, finalTarget.x, finalTarget.y, false, { silent: true });
    }
  });
};

export function setTruckCrewMode(
  state: WorldState,
  truckId: number,
  mode: "boarded" | "deployed",
  options?: { silent?: boolean }
): void {
  const truck = getUnitById(state, truckId);
  if (!truck || truck.kind !== "truck") {
    return;
  }
  truck.crewMode = mode;
  if (mode === "deployed") {
    truck.crewIds.forEach((id) => {
      const crew = getUnitById(state, id);
      if (crew) {
        detachFromCarrier(state, crew);
      }
    });
    truck.passengerIds = [];
  }
  if (!options?.silent) {
    setStatus(state, mode === "boarded" ? "Crew boarding truck." : "Crew deployed around truck.");
  }
  updateTruckCrewOrders(state, truck);
}

export function setCrewFormation(state: WorldState, truckId: number, formation: Formation): void {
  const truck = getUnitById(state, truckId);
  if (!truck || truck.kind !== "truck") {
    return;
  }
  truck.crewIds.forEach((id) => {
    const crewMember = getUnitById(state, id);
    if (crewMember) {
      crewMember.formation = formation;
    }
  });
  const rosterTruck = getRosterUnit(state, truck.rosterId);
  if (rosterTruck) {
    rosterTruck.crewIds.forEach((id) => {
      const rosterCrew = getRosterUnit(state, id);
      if (rosterCrew) {
        rosterCrew.formation = formation;
      }
    });
  }
  const name = rosterTruck ? rosterTruck.name : "Truck";
  setStatus(state, `${name} crew set to ${formation} formation.`);
}

export function autoAssignTargets(state: WorldState): void {
  applyCommandIntentControl(state, 0);
  state.units.forEach((unit) => {
    if (unit.kind === "truck") {
      updateTruckCrewOrders(state, unit);
    }
  });

  for (const unit of state.units) {
    if (!unit.autonomous) {
      continue;
    }
    if (unit.kind === "firefighter" && unit.assignedTruckId !== null) {
      continue;
    }
    if (unit.target && unit.pathIndex < unit.path.length) {
      continue;
    }
    const scanRadius = unit.kind === "truck" ? 8 : 6;
    const threatFocus = findFireTargetNear(state, { x: unit.x, y: unit.y }, scanRadius, unit.attackTarget ?? unit.sprayTarget ?? null);
    if (threatFocus) {
      const best = findNearestPassable(state, Math.floor(threatFocus.x), Math.floor(threatFocus.y), 2);
      if (best) {
        setUnitTarget(state, unit, best.x, best.y, false, { silent: true });
      }
    }
  }
}

const findNearestPassable = (state: WorldState, x: number, y: number, radius = 2): Point | null => {
  if (inBounds(state.grid, x, y) && isPassable(state, x, y)) {
    return { x, y };
  }
  for (let r = 1; r <= radius; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.abs(dx) !== r && Math.abs(dy) !== r) {
          continue;
        }
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(state.grid, nx, ny)) {
          continue;
        }
        if (isPassable(state, nx, ny)) {
          return { x: nx, y: ny };
        }
      }
    }
  }
  return null;
};

export function assignFormationTargets(state: WorldState, units: Unit[], start: Point, end: Point): void {
  if (units.length === 0) {
    return;
  }
  const count = units.length;
  for (let i = 0; i < count; i += 1) {
    const t = count === 1 ? 0.5 : i / (count - 1);
    const rawX = Math.round(start.x + (end.x - start.x) * t);
    const rawY = Math.round(start.y + (end.y - start.y) * t);
    const target = findNearestPassable(state, rawX, rawY, 2);
    if (target) {
      setUnitTarget(state, units[i], target.x, target.y, true);
    }
  }
}

export function applyUnitHazards(state: WorldState, rng: RNG, delta: number): void {
  let lostUnit = false;
  for (let i = state.units.length - 1; i >= 0; i -= 1) {
    const unit = state.units[i];
    const idx = indexFor(state.grid, Math.floor(unit.x), Math.floor(unit.y));
    const fireValue = state.tileFire[idx];
    if (fireValue < UNIT_LOSS_FIRE_THRESHOLD) {
      continue;
    }
    const rosterEntry = getRosterUnit(state, unit.rosterId);
    const resilience = rosterEntry ? getTrainingMultiplier(rosterEntry.training).resilience : 0;
    const baseRisk = unit.kind === "truck" ? 0.06 : 0.1;
    const risk = baseRisk * (fireValue - UNIT_LOSS_FIRE_THRESHOLD + 0.15) * (1 - resilience) * delta;
    if (rng.next() < risk) {
      if (unit.kind === "firefighter") {
        queueScoreFlowEvent(state, "lives", 1, undefined, Math.floor(unit.x), Math.floor(unit.y));
      }
      if (rosterEntry) {
        rosterEntry.status = "lost";
        if (rosterEntry.kind === "truck") {
          rosterEntry.crewIds.forEach((id) => {
            const crew = getRosterFirefighter(state, id);
            if (crew) {
              crew.assignedTruckId = null;
            }
          });
          rosterEntry.crewIds = [];
        } else if (rosterEntry.kind === "firefighter" && rosterEntry.assignedTruckId !== null) {
          const truck = getRosterTruck(state, rosterEntry.assignedTruckId);
          if (truck) {
            truck.crewIds = truck.crewIds.filter((id) => id !== rosterEntry.id);
          }
          rosterEntry.assignedTruckId = null;
        }
      }
      if (unit.kind === "truck" && unit.passengerIds.length > 0) {
        unit.passengerIds.forEach((id) => {
          const passenger = getUnitById(state, id);
          if (passenger) {
            passenger.carrierId = null;
          }
        });
        unit.passengerIds = [];
        unit.crewIds.forEach((id) => {
          const crew = getUnitById(state, id);
          if (crew) {
            crew.assignedTruckId = null;
          }
        });
        unit.crewIds = [];
      } else if (unit.carrierId !== null) {
        const carrier = getUnitById(state, unit.carrierId);
        if (carrier) {
          carrier.passengerIds = carrier.passengerIds.filter((id) => id !== unit.id);
        }
      }
      if (unit.assignedTruckId !== null) {
        const truck = getUnitById(state, unit.assignedTruckId);
        if (truck) {
          truck.crewIds = truck.crewIds.filter((id) => id !== unit.id);
          truck.passengerIds = truck.passengerIds.filter((id) => id !== unit.id);
        }
      }
      if (unit.selected) {
        unit.selected = false;
        state.selectedUnitIds = state.selectedUnitIds.filter((id) => id !== unit.id);
      }
      state.units.splice(i, 1);
      lostUnit = true;
      setStatus(state, `${unit.kind === "truck" ? "Truck" : "Firefighter"} lost in the fire.`);
    }
  }
  if (lostUnit) {
    syncCommandUnits(state);
  }
}

export function recallUnits(state: WorldState): void {
  state.units = [];
  state.roster.forEach((entry) => {
    if (entry.status === "deployed") {
      entry.status = "available";
    }
  });
  syncCommandUnits(state);
  clearCommandSelection(state);
}

type SuppressionProfile = {
  radius: number;
  power: number;
  suppressionRadius: number;
  hoseRange: number;
  wetness: number;
};

const getSuppressionProfile = (unit: Unit): SuppressionProfile => {
  let radius = unit.radius;
  let power = unit.power;
  let hoseRange = unit.hoseRange;
  let wetness = 1;

  if (unit.kind === "firefighter") {
    switch (unit.formation) {
      case "narrow":
        radius *= 0.95;
        power *= 1.45;
        hoseRange *= 1.15;
        wetness *= 0.85;
        break;
      case "wide":
        radius *= 1.35;
        power *= 0.9;
        wetness *= 1.25;
        break;
      case "medium":
      default:
        break;
    }
  }

  const suppressionRadius = radius + 0.18;
  return {
    radius,
    power,
    suppressionRadius,
    hoseRange: Math.max(suppressionRadius + 0.5, hoseRange),
    wetness
  };
};

const clearScheduledIgnition = (state: WorldState, idx: number): void => {
  if (state.tileIgniteAt[idx] < Number.POSITIVE_INFINITY) {
    state.tileIgniteAt[idx] = Number.POSITIVE_INFINITY;
    state.fireScheduledCount = Math.max(0, state.fireScheduledCount - 1);
  }
};

const resolvePreferredAim = (unit: Unit): Point | null =>
  unit.attackTarget ??
  unit.sprayTarget ??
  (unit.target && unit.pathIndex < unit.path.length
    ? {
        x: unit.target.x + 0.5,
        y: unit.target.y + 0.5
      }
    : null);

const resolveSuppressionImpactTarget = (
  state: WorldState,
  unit: Unit,
  profile: SuppressionProfile
): Point | null => {
  const preferredAim = resolvePreferredAim(unit);
  let forwardDirX = 1;
  let forwardDirY = 0;
  if (preferredAim) {
    const aimMag = Math.hypot(preferredAim.x - unit.x, preferredAim.y - unit.y);
    if (aimMag > 0.0001) {
      forwardDirX = (preferredAim.x - unit.x) / aimMag;
      forwardDirY = (preferredAim.y - unit.y) / aimMag;
    }
  }

  const searchMinX = Math.max(0, Math.floor(unit.x - profile.hoseRange));
  const searchMaxX = Math.min(state.grid.cols - 1, Math.ceil(unit.x + profile.hoseRange));
  const searchMinY = Math.max(0, Math.floor(unit.y - profile.hoseRange));
  const searchMaxY = Math.min(state.grid.rows - 1, Math.ceil(unit.y + profile.hoseRange));
  let bestTarget: Point | null = null;
  let bestScore = 0;

  for (let y = searchMinY; y <= searchMaxY; y += 1) {
    for (let x = searchMinX; x <= searchMaxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(unit.x - tileCenterX, unit.y - tileCenterY);
      if (dist > profile.hoseRange) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const threatClass = getSuppressionThreatClass(state, idx);
      if (threatClass === "cold") {
        continue;
      }
      const threatScore = getSuppressionThreatScore(state, x, y);
      if (threatScore <= 0) {
        continue;
      }
      const forwardDot =
        dist > 0.0001 ? ((tileCenterX - unit.x) * forwardDirX + (tileCenterY - unit.y) * forwardDirY) / dist : 1;
      if (preferredAim && forwardDot < -0.05) {
        continue;
      }
      const forwardWeight = preferredAim ? clamp((forwardDot + 0.1) / 1.1, 0, 1) : 1;
      if (forwardWeight <= 0) {
        continue;
      }
      const distanceWeight = clamp(1 - dist / Math.max(0.0001, profile.hoseRange), 0, 1);
      const targetDistance = preferredAim ? Math.hypot(tileCenterX - preferredAim.x, tileCenterY - preferredAim.y) : 0;
      const targetWeight =
        preferredAim ? clamp(1 - targetDistance / Math.max(profile.hoseRange * 0.9, 0.0001), 0, 1) : 1;
      const areaScore = getClusterSuppressionScore(
        state,
        tileCenterX,
        tileCenterY,
        Math.max(1.05, Math.min(2.1, profile.suppressionRadius * 1.15))
      );
      const areaWeight = clamp(areaScore / 4.2, 0, 1);
      const stickyDistance = unit.sprayTarget
        ? Math.hypot(tileCenterX - unit.sprayTarget.x, tileCenterY - unit.sprayTarget.y)
        : 0;
      const stickyWeight = unit.sprayTarget
        ? clamp(1 - stickyDistance / Math.max(profile.hoseRange * 0.5, profile.suppressionRadius * 2, 0.9), 0, 1)
        : 0;
      const threatPriority =
        threatClass === "burning" ? 1.2 : threatClass === "pending" ? 0.9 : 0.68;
      const combinedWeight =
        (0.28 + forwardWeight * 0.72) *
        (0.3 + distanceWeight * 0.7) *
        (0.42 + areaWeight * 0.58) *
        (0.34 + targetWeight * 0.66) *
        (unit.sprayTarget ? 0.84 + stickyWeight * 0.52 : 1);
      const score = threatScore * threatPriority * combinedWeight;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = { x: tileCenterX, y: tileCenterY };
      }
    }
  }

  const rawImpactTarget = bestTarget;
  if (!rawImpactTarget) {
    return null;
  }

  const refineRadius = Math.max(1.1, Math.min(profile.suppressionRadius * 1.55, profile.hoseRange * 0.42));
  const refineMinX = Math.max(0, Math.floor(rawImpactTarget.x - refineRadius));
  const refineMaxX = Math.min(state.grid.cols - 1, Math.ceil(rawImpactTarget.x + refineRadius));
  const refineMinY = Math.max(0, Math.floor(rawImpactTarget.y - refineRadius));
  const refineMaxY = Math.min(state.grid.rows - 1, Math.ceil(rawImpactTarget.y + refineRadius));
  let refinedWeightTotal = 0;
  let refinedTargetX = 0;
  let refinedTargetY = 0;

  for (let y = refineMinY; y <= refineMaxY; y += 1) {
    for (let x = refineMinX; x <= refineMaxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const distToCenter = Math.hypot(rawImpactTarget.x - tileCenterX, rawImpactTarget.y - tileCenterY);
      if (distToCenter > refineRadius) {
        continue;
      }
      const threatScore = getSuppressionThreatScore(state, x, y);
      if (threatScore <= 0) {
        continue;
      }
      const distanceWeight = clamp(1 - distToCenter / Math.max(0.0001, refineRadius), 0, 1);
      const stickyDistance = unit.sprayTarget
        ? Math.hypot(tileCenterX - unit.sprayTarget.x, tileCenterY - unit.sprayTarget.y)
        : 0;
      const stickyWeight = unit.sprayTarget
        ? clamp(1 - stickyDistance / Math.max(refineRadius * 2.1, 0.9), 0, 1)
        : 0;
      const weight = threatScore * distanceWeight * (unit.sprayTarget ? 0.9 + stickyWeight * 0.24 : 1);
      if (weight <= 0) {
        continue;
      }
      refinedWeightTotal += weight;
      refinedTargetX += tileCenterX * weight;
      refinedTargetY += tileCenterY * weight;
    }
  }

  return refinedWeightTotal > 0.0001
    ? { x: refinedTargetX / refinedWeightTotal, y: refinedTargetY / refinedWeightTotal }
    : rawImpactTarget;
};

const applySuppressionAtTarget = (
  state: WorldState,
  unit: Unit,
  impactTarget: Point,
  profile: SuppressionProfile,
  powerMultiplier: number,
  suppressionTimestamp: number
): void => {
  const impactMinX = Math.max(0, Math.floor(impactTarget.x - profile.suppressionRadius));
  const impactMaxX = Math.min(state.grid.cols - 1, Math.ceil(impactTarget.x + profile.suppressionRadius));
  const impactMinY = Math.max(0, Math.floor(impactTarget.y - profile.suppressionRadius));
  const impactMaxY = Math.min(state.grid.rows - 1, Math.ceil(impactTarget.y + profile.suppressionRadius));
  const radiusSafe = Math.max(0.0001, profile.suppressionRadius);

  for (let y = impactMinY; y <= impactMaxY; y += 1) {
    for (let x = impactMinX; x <= impactMaxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(impactTarget.x - tileCenterX, impactTarget.y - tileCenterY);
      if (dist > profile.suppressionRadius) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      const proximityWeight = Math.max(0, 1 - dist / radiusSafe);
      const wetnessGain = profile.power * profile.wetness * powerMultiplier * (0.75 + proximityWeight * 0.85);
      state.tileSuppressionWetness[idx] = clamp((state.tileSuppressionWetness[idx] ?? 0) + wetnessGain, 0, 1);
      clearScheduledIgnition(state, idx);
      let heatValue = state.tileHeat[idx];
      if (heatValue > 0) {
        const prevHeatValue = heatValue;
        heatValue = Math.max(0, heatValue - profile.power * 1.55 * powerMultiplier * (0.45 + proximityWeight * 0.55));
        state.tileHeat[idx] = heatValue;
        tile.heat = heatValue;
        if (heatValue < prevHeatValue && idx < state.scoring.lastSuppressedAt.length) {
          state.scoring.lastSuppressedAt[idx] = suppressionTimestamp;
        }
        if (heatValue < tile.ignitionPoint * (1 + SUPPRESSION_WETNESS_BLOCK_THRESHOLD)) {
          clearScheduledIgnition(state, idx);
        }
      }
      let fireValue = state.tileFire[idx];
      if (fireValue > 0) {
        const before = fireValue;
        fireValue = Math.max(0, fireValue - profile.power * 1.05 * powerMultiplier * (0.45 + proximityWeight * 0.55));
        state.tileFire[idx] = fireValue;
        tile.fire = fireValue;
        if (fireValue < before && idx < state.scoring.lastSuppressedAt.length) {
          state.scoring.lastSuppressedAt[idx] = suppressionTimestamp;
        }
        if (before > 0 && fireValue === 0) {
          heatValue = Math.min(state.tileHeat[idx], tile.ignitionPoint * 0.25);
          state.tileHeat[idx] = heatValue;
          tile.heat = heatValue;
          clearScheduledIgnition(state, idx);
          if (state.tileFuel[idx] > 0) {
            state.containedCount += 1;
          }
        }
      }
      if (heatValue > 0.01 || fireValue > THREAT_FIRE_EPS || state.tileSuppressionWetness[idx] > 0.01) {
        markFireBlockActiveByTile(state, idx);
      }
    }
  }
};

export function prepareExtinguish(state: WorldState, effects: EffectsState, rng: RNG): void {
  effects.waterStreams = [];
  state.units.forEach((unit) => {
    if (unit.kind === "firefighter" && unit.carrierId !== null) {
      setSprayTarget(unit, null);
      return;
    }
    if (!canUnitSpray(state, unit)) {
      setSprayTarget(unit, null);
      return;
    }
    const profile = getSuppressionProfile(unit);
    const impactTarget = resolveSuppressionImpactTarget(state, unit, profile);
    if (!impactTarget) {
      setSprayTarget(unit, null);
      return;
    }
    setSprayTarget(unit, impactTarget);
    emitWaterSpray(state, effects, rng, unit, impactTarget);
  });
}

export function applyExtinguishStep(state: WorldState, delta: number, suppressionScale = 1): void {
  const powerMultiplier = Math.max(0, delta) * Math.max(0, suppressionScale);
  if (powerMultiplier <= 0) {
    return;
  }
  const suppressionTimestamp = state.careerDay;
  state.units.forEach((unit) => {
    if (unit.kind === "firefighter" && unit.carrierId !== null) {
      return;
    }
    if (!unit.sprayTarget) {
      return;
    }
    if (!canUnitSpray(state, unit)) {
      setSprayTarget(unit, null);
      return;
    }
    const profile = getSuppressionProfile(unit);
    applySuppressionAtTarget(state, unit, unit.sprayTarget, profile, powerMultiplier, suppressionTimestamp);
    spendUnitWater(state, unit, delta);
  });
}

export function applyExtinguish(state: WorldState, effects: EffectsState, rng: RNG, delta: number): void {
  prepareExtinguish(state, effects, rng);
  applyExtinguishStep(state, delta);
}

