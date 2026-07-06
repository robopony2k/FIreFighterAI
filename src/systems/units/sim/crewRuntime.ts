import type { Formation, Point, TruckCrewMode, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import {
  FIREFIGHTER_TETHER_DISTANCE,
  FORMATION_SPACING,
  TRUCK_BOARD_RADIUS,
  TRUCK_CAPACITY
} from "../../../core/config.js";
import { setStatus } from "../../../core/state.js";
import { getRosterUnit, getUnitById, getUnitTile } from "../utils/unitLookup.js";
import { clampTargetToTruckRange, findPassableStandoffSlot, getAverageHoseRange, getStandoffDistance } from "./crewFormation.js";
import { clearSuppressionTargets, findNearestPassable, setAttackTarget, setUnitTargetIfNeeded } from "./unitPathing.js";
import { findFireTargetNear } from "./threatAssessment.js";
import {
  getTruckCrewDeploymentRoles,
  getTruckCrewReadiness,
  getTruckCrewTransitionDuration,
  getTruckCrewUnits,
  getTruckHoseOperators,
  isTruckCrewFullyBoarded
} from "./crewReadiness.js";

export const getAssignedTruck = (state: WorldState, firefighter: Unit): Unit | null => {
  if (firefighter.assignedTruckId === null) {
    return null;
  }
  const truck = getUnitById(state, firefighter.assignedTruckId);
  return truck && truck.kind === "truck" ? truck : null;
};

export const getNearestTruck = (state: WorldState, origin: Point): { unit: Unit; distance: number } | null => {
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

export const detachFromCarrier = (state: WorldState, firefighter: Unit): void => {
  if (firefighter.carrierId === null) {
    return;
  }
  const carrier = getUnitById(state, firefighter.carrierId);
  if (carrier) {
    carrier.passengerIds = carrier.passengerIds.filter((id) => id !== firefighter.id);
  }
  firefighter.carrierId = null;
};

export const boardTruck = (state: WorldState, firefighter: Unit, truck: Unit): boolean => {
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

const clearCrewSuppressionTargets = (crew: Unit[]): void => {
  crew.forEach((member) => clearSuppressionTargets(member));
};

const finishTruckCrewMode = (state: WorldState, truck: Unit, mode: "boarded" | "deployed"): void => {
  truck.crewMode = mode;
  truck.crewAction = null;
  if (mode === "deployed") {
    const roles = getTruckCrewDeploymentRoles(state, truck);
    truck.passengerIds = [];
    roles.assignments.forEach((assignment) => {
      const crew = assignment.unit;
      clearSuppressionTargets(crew);
      if (assignment.visible) {
        if (crew.carrierId === truck.id) {
          detachFromCarrier(state, crew);
        }
      } else if (crew.assignedTruckId === truck.id) {
        boardTruck(state, crew, truck);
      }
    });
    getTruckCrewUnits(state, truck).forEach((crew) => {
      if (!roles.assignmentByUnitId.has(crew.id) && crew.carrierId === truck.id) {
        detachFromCarrier(state, crew);
      }
    });
  }
};

const beginTruckCrewTransition = (
  state: WorldState,
  truck: Unit,
  kind: "boarding" | "disembarking"
): void => {
  if (truck.crewAction?.kind === kind) {
    return;
  }
  const total = getTruckCrewTransitionDuration(state, truck, kind);
  truck.crewMode = kind;
  truck.crewAction = { kind, remaining: total, total };
};

export const stepTruckCrewAction = (
  state: WorldState,
  truck: Unit,
  delta: number,
  kind?: "boarding" | "disembarking"
): void => {
  const action = truck.crewAction;
  if (!action || (kind && action.kind !== kind)) {
    return;
  }
  const crew = getTruckCrewUnits(state, truck);
  if (action.kind === "boarding") {
    if (crew.length <= 0 || !isTruckCrewFullyBoarded(state, truck)) {
      return;
    }
  } else if (truck.pathIndex < truck.path.length) {
    return;
  }
  action.remaining = Math.max(0, action.remaining - Math.max(0, delta));
  if (action.remaining > 0) {
    return;
  }
  finishTruckCrewMode(state, truck, action.kind === "boarding" ? "boarded" : "deployed");
  updateTruckCrewOrders(state, truck);
};

export const unassignFirefighterFromTruck = (state: WorldState, firefighter: Unit): void => {
  const truck = getAssignedTruck(state, firefighter);
  if (truck) {
    truck.crewIds = truck.crewIds.filter((id) => id !== firefighter.id);
    truck.passengerIds = truck.passengerIds.filter((id) => id !== firefighter.id);
  }
  firefighter.assignedTruckId = null;
  detachFromCarrier(state, firefighter);
};

export const assignFirefighterToTruck = (state: WorldState, firefighter: Unit, truck: Unit): boolean => {
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

export const updateTruckCrewOrders = (state: WorldState, truck: Unit): void => {
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
  const deployedCrew = getTruckCrewUnits(state, truck);
  const averageHoseRange = getAverageHoseRange(deployedCrew);
  const engagementRadius = FIREFIGHTER_TETHER_DISTANCE + averageHoseRange;
  const preferredFocus =
    deployedCrew.find((crew) => crew.attackTarget)?.attackTarget ??
    truck.attackTarget ??
    null;
  const fireFocus = deployedCrew.length > 0 ? findFireTargetNear(state, truckTile, engagementRadius, preferredFocus) : null;

  if (truck.crewMode === "boarding" || truck.crewMode === "boarded") {
    clearSuppressionTargets(truck);
    clearCrewSuppressionTargets(deployedCrew);
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
        setUnitTargetIfNeeded(state, crew, truckTile.x, truckTile.y, { silent: true }, 0.8);
      }
    }
    if (truck.crewMode === "boarding" || truck.crewAction?.kind === "boarding") {
      return;
    }
    return;
  }

  if (truck.crewMode === "disembarking" || truck.crewAction?.kind === "disembarking") {
    clearSuppressionTargets(truck);
    clearCrewSuppressionTargets(deployedCrew);
    return;
  }

  if (deployedCrew.length === 0) {
    clearSuppressionTargets(truck);
    return;
  }
  const roles = getTruckCrewDeploymentRoles(state, truck, deployedCrew);
  roles.assignments.forEach((assignment) => {
    const crew = assignment.unit;
    clearSuppressionTargets(crew);
    if (assignment.visible) {
      if (crew.carrierId === truck.id) {
        detachFromCarrier(state, crew);
      }
    } else if (crew.assignedTruckId === truck.id && crew.carrierId !== truck.id) {
      boardTruck(state, crew, truck);
    }
  });
  if (!fireFocus) {
    clearSuppressionTargets(truck);
    clearCrewSuppressionTargets(deployedCrew);
    return;
  }

  const dirX = fireFocus.x - truck.x;
  const dirY = fireFocus.y - truck.y;
  const dirMag = Math.hypot(dirX, dirY);
  const attackDirX = dirMag > 0.0001 ? dirX / dirMag : 1;
  const attackDirY = dirMag > 0.0001 ? dirY / dirMag : 0;
  const perpX = -attackDirY;
  const perpY = attackDirX;
  const supportTile = truckTile;

  const hoseOperators = new Set(getTruckHoseOperators(state, truck, deployedCrew).map((crew) => crew.id));
  roles.visibleCrew.forEach((assignment) => {
    const crew = assignment.unit;
    if (hoseOperators.has(crew.id)) {
      setAttackTarget(crew, fireFocus);
    }
    const distFromTruck = Math.hypot(crew.x - truck.x, crew.y - truck.y);
    if (distFromTruck > FIREFIGHTER_TETHER_DISTANCE) {
      const returnTile = findNearestPassable(state, supportTile.x, supportTile.y, 2) ?? truckTile;
      setUnitTargetIfNeeded(state, crew, returnTile.x, returnTile.y, { silent: true }, 0.8);
    }
  });

  setAttackTarget(truck, fireFocus);

  const isCrewIdle = roles.visibleCrew.every((assignment) => {
    const crew = assignment.unit;
    return !crew.target || crew.pathIndex >= crew.path.length;
  });
  if (!isCrewIdle) {
    return;
  }

  const formation = roles.visibleCrew[0]?.unit.formation ?? deployedCrew[0].formation;
  const spacing = FORMATION_SPACING[formation];
  const hoseTargets = new Map<number, Point>();
  const nozzleAssignments = roles.hoseOperators;
  nozzleAssignments.forEach((assignment, i) => {
    const crew = assignment.unit;
    const offset = (i - (nozzleAssignments.length - 1) / 2) * spacing;
    const standoffDistance = getStandoffDistance(crew.hoseRange, truck.behaviourMode);
    const desiredX = fireFocus.x - attackDirX * standoffDistance + perpX * offset;
    const desiredY = fireFocus.y - attackDirY * standoffDistance + perpY * offset;
    const finalTarget =
      findPassableStandoffSlot(state, desiredX, desiredY, fireFocus, attackDirX, attackDirY, 2) ??
      findNearestPassable(state, supportTile.x, supportTile.y, 2);
    if (finalTarget) {
      const clampedTarget = clampTargetToTruckRange(state, truck, finalTarget);
      if (assignment.hoseIndex !== null) {
        hoseTargets.set(assignment.hoseIndex, clampedTarget);
      }
      setUnitTargetIfNeeded(state, crew, clampedTarget.x, clampedTarget.y, { silent: true });
    }
  });
  if (roles.pumpOperator) {
    const desiredPumpX = truckTile.x + perpX * 0.85 - attackDirX * 0.2;
    const desiredPumpY = truckTile.y + perpY * 0.85 - attackDirY * 0.2;
    const pumpTarget = findNearestPassable(state, Math.round(desiredPumpX), Math.round(desiredPumpY), 1) ?? supportTile;
    const clampedPumpTarget = clampTargetToTruckRange(state, truck, pumpTarget);
    setUnitTargetIfNeeded(state, roles.pumpOperator.unit, clampedPumpTarget.x, clampedPumpTarget.y, { silent: true }, 0.45);
  }
  roles.assistants.forEach((assignment, i) => {
    const crew = assignment.unit;
    const hoseTarget = assignment.hoseIndex !== null ? hoseTargets.get(assignment.hoseIndex) : null;
    const side = i % 2 === 0 ? 1 : -1;
    const desiredX = hoseTarget
      ? hoseTarget.x - attackDirX * 1.15 + perpX * side * 0.42
      : truckTile.x + perpX * side * 0.65 - attackDirX * 0.65;
    const desiredY = hoseTarget
      ? hoseTarget.y - attackDirY * 1.15 + perpY * side * 0.42
      : truckTile.y + perpY * side * 0.65 - attackDirY * 0.65;
    const assistantTarget = findNearestPassable(state, Math.round(desiredX), Math.round(desiredY), 1) ?? supportTile;
    const clampedAssistantTarget = clampTargetToTruckRange(state, truck, assistantTarget);
    setUnitTargetIfNeeded(state, crew, clampedAssistantTarget.x, clampedAssistantTarget.y, { silent: true }, 0.45);
  });
};

export function setTruckCrewMode(
  state: WorldState,
  truckId: number,
  mode: Extract<TruckCrewMode, "boarded" | "deployed">,
  options?: { silent?: boolean; immediate?: boolean }
): void {
  const truck = getUnitById(state, truckId);
  if (!truck || truck.kind !== "truck") {
    return;
  }
  const crew = getTruckCrewUnits(state, truck);
  if (options?.immediate || crew.length === 0) {
    finishTruckCrewMode(state, truck, mode);
  } else if (mode === "boarded") {
    if (truck.crewMode !== "boarded" || !isTruckCrewFullyBoarded(state, truck)) {
      clearSuppressionTargets(truck);
      clearCrewSuppressionTargets(crew);
      beginTruckCrewTransition(state, truck, "boarding");
    }
  } else {
    if (truck.crewMode !== "deployed" || truck.crewAction !== null) {
      clearSuppressionTargets(truck);
      clearCrewSuppressionTargets(crew);
      beginTruckCrewTransition(state, truck, "disembarking");
    }
  }
  if (!options?.silent) {
    const readiness = getTruckCrewReadiness(state, truck);
    setStatus(
      state,
      mode === "boarded"
        ? `Crew boarding truck (${readiness.crewCount}/${TRUCK_CAPACITY}).`
        : `Crew disembarking and connecting ${readiness.hoseSlots} hose${readiness.hoseSlots === 1 ? "" : "s"}.`
    );
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
