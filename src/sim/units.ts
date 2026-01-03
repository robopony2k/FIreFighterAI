import type { RNG, Point, Unit, UnitKind } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { FIREBREAK_COST_PER_TILE, UNIT_CONFIG } from "../core/config.js";
import { formatCurrency } from "../core/utils.js";
import { setStatus, resetStatus } from "../core/state.js";
import { inBounds, indexFor } from "../core/grid.js";
import { applyFuel } from "../core/tiles.js";
import { findPath, isPassable } from "./pathing.js";
import { emitWaterSpray } from "./particles.js";

export function setDeployMode(state: WorldState, mode: UnitKind | "clear" | null, options?: { silent?: boolean }): void {
  state.deployMode = mode;
  if (options?.silent) {
    return;
  }
  if (mode === "firefighter" || mode === "truck") {
    setStatus(state, `Deploy ${mode === "firefighter" ? "firefighter" : "truck"} units.`);
  } else if (mode === "clear") {
    setStatus(state, `Clear fuel breaks for ${formatCurrency(FIREBREAK_COST_PER_TILE)} per tile.`);
  } else {
    resetStatus(state);
  }
}

export function selectUnit(state: WorldState, unit: Unit | null): void {
  state.units.forEach((current) => {
    current.selected = unit ? current.id === unit.id : false;
  });
  state.selectedUnitId = unit ? unit.id : null;
  if (unit) {
    setStatus(state, `Unit ${unit.kind} selected. Click a tile to retask.`);
  } else {
    resetStatus(state);
  }
}

export function createUnit(state: WorldState, kind: UnitKind, rng: RNG): Unit {
  const config = UNIT_CONFIG[kind];
  return {
    id: Date.now() + Math.floor(rng.next() * 10000),
    kind,
    x: state.basePoint.x + 0.5,
    y: state.basePoint.y + 0.5,
    target: null,
    path: [],
    pathIndex: 0,
    speed: config.speed,
    radius: config.radius,
    power: config.power,
    selected: false
  };
}

export function setUnitTarget(state: WorldState, unit: Unit, tileX: number, tileY: number): void {
  if (!inBounds(state.grid, tileX, tileY) || !isPassable(state, tileX, tileY)) {
    setStatus(state, "That location is blocked.");
    return;
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
  const config = UNIT_CONFIG[kind];
  if (state.budget < config.cost) {
    setStatus(state, "Insufficient budget.");
    return;
  }
  const unit = createUnit(state, kind, rng);
  state.units.push(unit);
  state.budget -= config.cost;
  setUnitTarget(state, unit, tileX, tileY);
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
  if (state.budget < FIREBREAK_COST_PER_TILE) {
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
  state.budget -= FIREBREAK_COST_PER_TILE;
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
  if (state.budget < FIREBREAK_COST_PER_TILE) {
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
    if (state.budget < FIREBREAK_COST_PER_TILE) {
      break;
    }
    if (clearFuelAt(state, rng, x0, y0, false)) {
      cleared += 1;
      spent += FIREBREAK_COST_PER_TILE;
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

