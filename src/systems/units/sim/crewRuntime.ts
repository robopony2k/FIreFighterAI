import type { BehaviourMode, Formation, Point, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import {
  FIREFIGHTER_TETHER_DISTANCE,
  FORMATION_SPACING,
  TRUCK_BOARD_RADIUS,
  TRUCK_CAPACITY
} from "../../../core/config.js";
import { setStatus } from "../../../core/state.js";
import { inBounds } from "../../../core/grid.js";
import { isPassable } from "../../../sim/pathing.js";
import { TRUCK_SUPPORT_POSITION_TOLERANCE } from "../constants/runtimeConstants.js";
import { getRosterUnit, getUnitById, getUnitTile } from "../utils/unitLookup.js";
import { clearSuppressionTargets, findNearestPassable, setAttackTarget, setUnitTargetIfNeeded } from "./unitPathing.js";
import { findFireTargetNear } from "./threatAssessment.js";

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

export const clampTargetToTruckRange = (state: WorldState, truck: Unit, target: Point): Point => {
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

export const getAverageHoseRange = (crew: Unit[]): number => {
  if (crew.length === 0) {
    return 0;
  }
  let total = 0;
  for (const member of crew) {
    total += Math.max(0, member.hoseRange);
  }
  return total / crew.length;
};

export const getStandoffDistance = (hoseRange: number, behaviourMode: BehaviourMode = "balanced"): number => {
  const base = Math.max(2.75, Math.min(Math.max(2.75, hoseRange - 0.5), hoseRange * 0.85));
  if (behaviourMode === "aggressive") {
    return Math.max(2.35, base - 0.65);
  }
  if (behaviourMode === "defensive") {
    return base + 0.9;
  }
  return base;
};

export const findPassableStandoffSlot = (
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
  const deployedCrew = truck.crewIds.map((id) => getUnitById(state, id)).filter((crew): crew is Unit => !!crew);
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
        setUnitTargetIfNeeded(state, crew, truckTile.x, truckTile.y, { silent: true }, 0.8);
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
        setUnitTargetIfNeeded(state, truck, supportTile.x, supportTile.y, { silent: true }, 0.95);
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
        setUnitTargetIfNeeded(state, crew, truckTile.x, truckTile.y, { silent: true }, 0.8);
      }
    });
    if (
      truck.autonomous &&
      (!truck.target || truck.target.x !== supportTile.x || truck.target.y !== supportTile.y || truck.pathIndex >= truck.path.length)
    ) {
      setUnitTargetIfNeeded(state, truck, supportTile.x, supportTile.y, { silent: true }, 0.95);
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
      setUnitTargetIfNeeded(state, crew, returnTile.x, returnTile.y, { silent: true }, 0.8);
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
      setUnitTargetIfNeeded(state, crew, finalTarget.x, finalTarget.y, { silent: true });
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
