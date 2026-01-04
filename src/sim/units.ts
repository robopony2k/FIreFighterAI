import type { RNG, Point, Unit, UnitKind, UnitSkill, RosterUnit } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import {
  FIREBREAK_COST_PER_TILE,
  MAX_TRAINING_LEVEL,
  RECRUIT_FIREFIGHTER_COST,
  RECRUIT_TRUCK_COST,
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
import { findPath, isPassable } from "./pathing.js";
import { emitWaterSpray } from "./particles.js";

const FIRST_NAMES = ["Alex", "Casey", "Drew", "Jordan", "Parker", "Quinn", "Riley", "Sawyer", "Taylor", "Wyatt"];
const LAST_NAMES = ["Cedar", "Hawk", "Keel", "Marsh", "Reed", "Stone", "Sutter", "Vale", "Wells", "Yates"];
const TRUCK_PREFIX = ["Engine", "Tanker", "Brush", "Rescue"];

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
    status: "available"
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
  return {
    id: Date.now() + Math.floor(rng.next() * 10000),
    kind,
    rosterId: rosterUnit ? rosterUnit.id : null,
    autonomous: true,
    x: state.basePoint.x + 0.5,
    y: state.basePoint.y + 0.5,
    target: null,
    path: [],
    pathIndex: 0,
    speed: config.speed * modifiers.unitSpeedMultiplier * training.speed,
    radius: config.radius * training.range,
    power: config.power * modifiers.unitPowerMultiplier * training.power,
    selected: false
  };
}

export function setUnitTarget(state: WorldState, unit: Unit, tileX: number, tileY: number, manual = true): void {
  if (!inBounds(state.grid, tileX, tileY) || !isPassable(state, tileX, tileY)) {
    setStatus(state, "That location is blocked.");
    return;
  }
  if (manual) {
    unit.autonomous = false;
  }
  unit.target = { x: tileX, y: tileY };
  unit.path = findPath(state, { x: Math.floor(unit.x), y: Math.floor(unit.y) }, unit.target);
  unit.pathIndex = 0;
  setStatus(state, `${unit.kind} routing to ${tileX}, ${tileY}.`);
}

export function deployUnit(state: WorldState, rng: RNG, kind: UnitKind, tileX: number, tileY: number): void {
  if (state.phase !== "fire") {
    setStatus(state, "Units deploy during fire season only.");
    return;
  }
  const rosterEntry = state.roster.find((entry) => entry.kind === kind && entry.status === "available") ?? null;
  if (!rosterEntry) {
    setStatus(state, "No available units in the roster.");
    return;
  }
  const unit = createUnit(state, kind, rng, rosterEntry);
  rosterEntry.status = "deployed";
  state.units.push(unit);
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
  tile.canopy = 0;
  tile.ashAge = 0;
  applyFuel(tile, tile.moisture, rng);
  state.terrainDirty = true;
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

  while (true) {
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
    const dist = Math.hypot(unit.x - clickX, unit.y - clickY);
    if (dist < 0.6) {
      return unit;
    }
  }
  return null;
}

export function stepUnits(state: WorldState, delta: number): void {
  state.units.forEach((unit) => {
    if (unit.pathIndex < unit.path.length) {
      const next = unit.path[unit.pathIndex];
      const targetX = next.x + 0.5;
      const targetY = next.y + 0.5;
      const dx = targetX - unit.x;
      const dy = targetY - unit.y;
      const dist = Math.hypot(dx, dy);
      const step = unit.speed * delta;
      if (dist <= step || dist < 0.01) {
        unit.x = targetX;
        unit.y = targetY;
        unit.pathIndex += 1;
      } else {
        unit.x += (dx / dist) * step;
        unit.y += (dy / dist) * step;
      }
    }
  });
}

export function autoAssignTargets(state: WorldState): void {
  for (const unit of state.units) {
    if (!unit.autonomous) {
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
        const tile = state.tiles[indexFor(state.grid, x, y)];
        if (tile.fire > bestFire) {
          bestFire = tile.fire;
          best = { x, y };
        }
      }
    }
    if (best && bestFire > 0.15) {
      setUnitTarget(state, unit, best.x, best.y, false);
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
    const tile = state.tiles[indexFor(state.grid, Math.floor(unit.x), Math.floor(unit.y))];
    if (tile.fire < UNIT_LOSS_FIRE_THRESHOLD) {
      continue;
    }
    const rosterEntry = getRosterUnit(state, unit.rosterId);
    const resilience = rosterEntry ? getTrainingMultiplier(rosterEntry.training).resilience : 0;
    const baseRisk = unit.kind === "truck" ? 0.06 : 0.1;
    const risk = baseRisk * (tile.fire - UNIT_LOSS_FIRE_THRESHOLD + 0.15) * (1 - resilience) * delta;
    if (rng.next() < risk) {
      if (rosterEntry) {
        rosterEntry.status = "lost";
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

export function applyExtinguish(state: WorldState, rng: RNG, delta: number): void {
  const powerMultiplier = delta;
  state.units.forEach((unit) => {
    const radius = unit.radius;
    const minX = Math.max(0, Math.floor(unit.x - radius));
    const maxX = Math.min(state.grid.cols - 1, Math.ceil(unit.x + radius));
    const minY = Math.max(0, Math.floor(unit.y - radius));
    const maxY = Math.min(state.grid.rows - 1, Math.ceil(unit.y + radius));
    let closestFire: Point | null = null;
    let closestDist = Number.POSITIVE_INFINITY;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dist = Math.hypot(unit.x - (x + 0.5), unit.y - (y + 0.5));
        if (dist <= radius) {
          const tile = state.tiles[indexFor(state.grid, x, y)];
          if (tile.heat > 0) {
            tile.heat = Math.max(0, tile.heat - unit.power * 1.1 * powerMultiplier);
          }
          if (tile.fire > 0) {
            const before = tile.fire;
            tile.fire = Math.max(0, tile.fire - unit.power * powerMultiplier);
            if (before > 0 && tile.fire === 0 && tile.fuel > 0) {
              state.containedCount += 1;
            }
            if (dist < closestDist) {
              closestDist = dist;
              closestFire = { x: x + 0.5, y: y + 0.5 };
            }
          }
        }
      }
    }
    if (closestFire) {
      emitWaterSpray(state, rng, unit, closestFire);
    }
  });
}

