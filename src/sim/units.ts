import type { RNG, Point, Unit, UnitKind, UnitSkill, RosterUnit, Formation } from "../core/types.js";
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
  UNIT_LOSS_FIRE_THRESHOLD
} from "../core/config.js";
import { formatCurrency } from "../core/utils.js";
import { setStatus, resetStatus } from "../core/state.js";
import { getCharacterDefinition, getCharacterFirebreakCost } from "../core/characters.js";
import { inBounds, indexFor } from "../core/grid.js";
import { applyFuel } from "../core/tiles.js";
import { syncTileSoAIndex } from "../core/tileCache.js";
import { clearVegetationState } from "../core/vegetation.js";
import { findPath, getMoveSpeedMultiplier, isPassable } from "./pathing.js";
import { emitWaterSpray } from "./particles.js";
import { queueScoreFlowEvent } from "./scoring.js";

const FIRST_NAMES = ["Alex", "Casey", "Drew", "Jordan", "Parker", "Quinn", "Riley", "Sawyer", "Taylor", "Wyatt"];
const LAST_NAMES = ["Cedar", "Hawk", "Keel", "Marsh", "Reed", "Stone", "Sutter", "Vale", "Wells", "Yates"];
const TRUCK_PREFIX = ["Engine", "Tanker", "Brush", "Rescue"];
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const MOVING_SPRAY_SPEED_FACTOR = 0.42;
const TRUCK_SUPPORT_POSITION_TOLERANCE = 1.85;
const CREW_REISSUE_DISTANCE = 0.7;
const FIRE_FOCUS_CLUSTER_RADIUS = 1.8;

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
  if (state.budget < TRAINING_COST) {
    setStatus(state, "Insufficient budget for training.");
    return false;
  }
  unit.training[skill] += 1;
  state.budget -= TRAINING_COST;
  setStatus(state, `${unit.name} trained: ${skill} level ${unit.training[skill]}.`);
  return true;
}

const getTrainingMultiplier = (training: RosterUnit["training"]) => ({
  speed: 1 + training.speed * TRAINING_SPEED_GAIN,
  power: 1 + training.power * TRAINING_POWER_GAIN,
  range: 1 + training.range * TRAINING_RANGE_GAIN,
  resilience: training.resilience * TRAINING_RESILIENCE_GAIN
});

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
  const firebreakCost = getCharacterFirebreakCost(state.campaign.characterId, FIREBREAK_COST_PER_TILE);
  if (mode === "firefighter" || mode === "truck") {
    setStatus(state, `Deploy ${mode === "firefighter" ? "firefighter" : "truck"} units.`);
  } else if (mode === "clear") {
    setStatus(state, `Clear fuel breaks for ${formatCurrency(firebreakCost)} per tile.`);
  } else {
    resetStatus(state);
  }
}

export function clearUnitSelection(state: WorldState): void {
  state.units.forEach((current) => {
    current.selected = false;
  });
  state.selectedUnitIds = [];
  resetStatus(state);
}

export function selectUnit(state: WorldState, unit: Unit | null): void {
  state.units.forEach((current) => {
    current.selected = unit ? current.id === unit.id : false;
  });
  state.selectedUnitIds = unit ? [unit.id] : [];
  if (unit) {
    setStatus(state, `Unit ${unit.kind} selected. Click a tile to retask.`);
  } else {
    resetStatus(state);
  }
}

export function toggleUnitSelection(state: WorldState, unit: Unit): void {
  if (unit.selected) {
    unit.selected = false;
    state.selectedUnitIds = state.selectedUnitIds.filter((id) => id !== unit.id);
  } else {
    unit.selected = true;
    state.selectedUnitIds = [...state.selectedUnitIds, unit.id];
  }
  if (state.selectedUnitIds.length > 0) {
    setStatus(state, `${state.selectedUnitIds.length} unit(s) selected. Click to retask.`);
  } else {
    resetStatus(state);
  }
}

export function getSelectedUnits(state: WorldState): Unit[] {
  return state.units.filter((unit) => unit.selected);
}

export function createUnit(state: WorldState, kind: UnitKind, rng: RNG, rosterEntry?: RosterUnit | null): Unit {
  const config = UNIT_CONFIG[kind];
  const modifiers = getCharacterDefinition(state.campaign.characterId).modifiers;
  const rosterUnit = rosterEntry ?? state.roster.find((entry) => entry.kind === kind && entry.status === "available") ?? null;
  const training = rosterUnit ? getTrainingMultiplier(rosterUnit.training) : { speed: 1, power: 1, range: 1, resilience: 0 };
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
    speed: config.speed * modifiers.unitSpeedMultiplier * training.speed,
    radius: config.radius * training.range,
    hoseRange: config.hoseRange * training.range,
    power: config.power * modifiers.unitPowerMultiplier * training.power,
    selected: false,
    carrierId: null,
    passengerIds: [],
    assignedTruckId: null,
    crewIds: [],
    crewMode: "deployed",
    formation: rosterUnit ? rosterUnit.formation : "medium",
    attackTarget: null,
    sprayTarget: null
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
  const firebreakCost = getCharacterFirebreakCost(state.campaign.characterId, FIREBREAK_COST_PER_TILE);
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
  const firebreakCost = getCharacterFirebreakCost(state.campaign.characterId, FIREBREAK_COST_PER_TILE);
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
      const idx = indexFor(state.grid, x, y);
      const fireValue = state.tileFire[idx];
      const heatValue = state.tileHeat[idx];
      if (fireValue <= 0 && heatValue <= 0.05) {
        continue;
      }
      const falloff = clamp(1 - dist / Math.max(0.0001, radius), 0, 1);
      total += (fireValue * 1.35 + heatValue * 0.58) * (0.28 + falloff * 0.72);
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
      const idx = indexFor(state.grid, x, y);
      const fireValue = state.tileFire[idx];
      const heatValue = state.tileHeat[idx];
      if (fireValue <= 0 && heatValue <= 0.05) {
        continue;
      }
      const falloff = clamp(1 - dist / Math.max(0.0001, radius), 0, 1);
      const weight = (fireValue * 1.45 + heatValue * 0.62) * (0.35 + falloff * 0.65);
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

const getStandoffDistance = (hoseRange: number): number =>
  clamp(hoseRange * 0.85, 2.75, Math.max(2.75, hoseRange - 0.5));

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
    const averageStandoff = deployedCrew.reduce((sum, crew) => sum + getStandoffDistance(crew.hoseRange), 0) / deployedCrew.length;
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
  const averageStandoff = deployedCrew.reduce((sum, crew) => sum + getStandoffDistance(crew.hoseRange), 0) / deployedCrew.length;
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
    const standoffDistance = getStandoffDistance(crew.hoseRange);
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
    let best: Point | null = null;
    let bestFire = 0;
    const minX = Math.max(0, Math.floor(unit.x - scanRadius));
    const maxX = Math.min(state.grid.cols - 1, Math.floor(unit.x + scanRadius));
    const minY = Math.max(0, Math.floor(unit.y - scanRadius));
    const maxY = Math.min(state.grid.rows - 1, Math.floor(unit.y + scanRadius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const idx = indexFor(state.grid, x, y);
        const fireValue = state.tileFire[idx];
        if (fireValue > bestFire) {
          bestFire = fireValue;
          best = { x, y };
        }
      }
    }
    if (best && bestFire > 0.15) {
      setUnitTarget(state, unit, best.x, best.y, false, { silent: true });
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
      setStatus(state, `${unit.kind === "truck" ? "Truck" : "Firefighter"} lost in the fire.`);
    }
  }
}

export function recallUnits(state: WorldState): void {
  state.units = [];
  state.selectedUnitIds = [];
  state.roster.forEach((entry) => {
    if (entry.status === "deployed") {
      entry.status = "available";
    }
  });
}

type SuppressionProfile = {
  radius: number;
  power: number;
  suppressionRadius: number;
  hoseRange: number;
};

const getSuppressionProfile = (unit: Unit): SuppressionProfile => {
  let radius = unit.radius;
  let power = unit.power;

  if (unit.kind === "firefighter") {
    switch (unit.formation) {
      case "narrow":
        // Precision mode: tighter stream, longer throw, higher knockdown.
        radius *= 1.22;
        power *= 1.34;
        break;
      case "wide":
        // Suppression mode: broad coverage with lower per-tile intensity.
        radius *= 1.56;
        power *= 0.62;
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
    hoseRange: Math.max(suppressionRadius + 0.5, unit.hoseRange)
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
  let bestFireTarget: Point | null = null;
  let bestFireScore = 0;
  let bestHeatTarget: Point | null = null;
  let bestHeatScore = 0;

  for (let y = searchMinY; y <= searchMaxY; y += 1) {
    for (let x = searchMinX; x <= searchMaxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(unit.x - tileCenterX, unit.y - tileCenterY);
      if (dist > profile.hoseRange) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const fireValue = state.tileFire[idx];
      const heatValue = state.tileHeat[idx];
      if (fireValue <= 0 && heatValue <= 0.05) {
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
      const combinedWeight =
        (0.28 + forwardWeight * 0.72) *
        (0.3 + distanceWeight * 0.7) *
        (0.42 + areaWeight * 0.58) *
        (0.34 + targetWeight * 0.66) *
        (unit.sprayTarget ? 0.84 + stickyWeight * 0.52 : 1);
      if (fireValue > 0) {
        const fireScore = (0.2 + fireValue) * combinedWeight;
        if (fireScore > bestFireScore) {
          bestFireScore = fireScore;
          bestFireTarget = { x: tileCenterX, y: tileCenterY };
        }
      }
      if (heatValue > 0.05) {
        const heatScore = (0.15 + heatValue * 0.85) * combinedWeight;
        if (heatScore > bestHeatScore) {
          bestHeatScore = heatScore;
          bestHeatTarget = { x: tileCenterX, y: tileCenterY };
        }
      }
    }
  }

  const rawImpactTarget = bestFireTarget ?? bestHeatTarget;
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
      const idx = indexFor(state.grid, x, y);
      const fireValue = state.tileFire[idx];
      const heatValue = state.tileHeat[idx];
      if (fireValue <= 0 && heatValue <= 0.05) {
        continue;
      }
      const distanceWeight = clamp(1 - distToCenter / Math.max(0.0001, refineRadius), 0, 1);
      const stickyDistance = unit.sprayTarget
        ? Math.hypot(tileCenterX - unit.sprayTarget.x, tileCenterY - unit.sprayTarget.y)
        : 0;
      const stickyWeight = unit.sprayTarget
        ? clamp(1 - stickyDistance / Math.max(refineRadius * 2.1, 0.9), 0, 1)
        : 0;
      const weight =
        (fireValue * 1.45 + heatValue * 0.82) *
        distanceWeight *
        (unit.sprayTarget ? 0.9 + stickyWeight * 0.24 : 1);
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
      let heatValue = state.tileHeat[idx];
      if (heatValue > 0) {
        const prevHeatValue = heatValue;
        heatValue = Math.max(0, heatValue - profile.power * 1.1 * powerMultiplier * (0.45 + proximityWeight * 0.55));
        state.tileHeat[idx] = heatValue;
        tile.heat = heatValue;
        if (heatValue < prevHeatValue && idx < state.scoring.lastSuppressedAt.length) {
          state.scoring.lastSuppressedAt[idx] = suppressionTimestamp;
        }
        if (heatValue < tile.ignitionPoint) {
          clearScheduledIgnition(state, idx);
        }
      }
      let fireValue = state.tileFire[idx];
      if (fireValue > 0) {
        const before = fireValue;
        fireValue = Math.max(0, fireValue - profile.power * powerMultiplier * (0.45 + proximityWeight * 0.55));
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
    const profile = getSuppressionProfile(unit);
    applySuppressionAtTarget(state, unit, unit.sprayTarget, profile, powerMultiplier, suppressionTimestamp);
  });
}

export function applyExtinguish(state: WorldState, effects: EffectsState, rng: RNG, delta: number): void {
  prepareExtinguish(state, effects, rng);
  applyExtinguishStep(state, delta);
}

