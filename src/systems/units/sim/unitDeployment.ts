import type { RNG, RosterUnit, Unit, UnitKind } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { TRUCK_CAPACITY } from "../../../core/config.js";
import { inBounds } from "../../../core/grid.js";
import { resetStatus, setStatus } from "../../../core/state.js";
import { isPassable } from "../../../sim/pathing.js";
import { buildUnitDerivedStats } from "../utils/unitStats.js";
import { getRosterUnit, getUnitTile } from "../utils/unitLookup.js";
import { boardTruck, assignFirefighterToTruck, setTruckCrewMode } from "./crewRuntime.js";
import { syncCommandUnits } from "./commandUnits.js";
import { routeUnitToTile } from "./unitPathing.js";

export function setUnitDeployMode(state: WorldState, mode: UnitKind | null, options?: { silent?: boolean }): void {
  state.deployMode = mode;
  if (options?.silent) {
    return;
  }
  if (mode === "firefighter" || mode === "truck") {
    setStatus(state, `Deploy ${mode === "firefighter" ? "firefighter" : "truck"} units.`);
  } else {
    resetStatus(state);
  }
}

export function createUnit(state: WorldState, kind: UnitKind, _rng: RNG, rosterEntry?: RosterUnit | null): Unit {
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

  if (unit.kind === "firefighter") {
    if (manual) {
      setStatus(state, "Firefighters are controlled by their truck. Move the truck to reposition the crew.");
      return;
    }
  } else if (unit.kind === "truck" && manual) {
    setTruckCrewMode(state, unit.id, "boarded", { silent: true });
  }

  routeUnitToTile(state, unit, tileX, tileY, {
    silent: options?.silent,
    statusMessage: `${unit.kind} routing to ${tileX}, ${tileY}.`
  });
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
