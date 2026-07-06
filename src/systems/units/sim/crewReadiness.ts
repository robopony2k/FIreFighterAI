import type { Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { TRUCK_CAPACITY } from "../../../core/config.js";
import { getUnitById } from "../utils/unitLookup.js";

export const TRUCK_DRIVER_CREW_MIN = 1;
export const TRUCK_PRIMARY_HOSE_CREW_MIN = 2;
export const TRUCK_SECOND_HOSE_CREW_MIN = 4;

const BASE_BOARDING_SECONDS = 0.7;
const BASE_DISEMBARK_SECONDS = 0.9;

export type TruckCrewReadiness = {
  crewCount: number;
  passengerCount: number;
  canDrive: boolean;
  hoseSlots: number;
  transitionSpeedMultiplier: number;
  hoseRangeMultiplier: number;
};

export type TruckCrewDeploymentRole = "driver" | "pump_operator" | "primary_hose" | "secondary_hose" | "assistant";

export type TruckCrewDeploymentAssignment = {
  unit: Unit;
  role: TruckCrewDeploymentRole;
  hoseIndex: number | null;
  visible: boolean;
  canSpray: boolean;
};

export type TruckCrewDeploymentRoles = {
  assignments: TruckCrewDeploymentAssignment[];
  driver: TruckCrewDeploymentAssignment | null;
  pumpOperator: TruckCrewDeploymentAssignment | null;
  hoseOperators: TruckCrewDeploymentAssignment[];
  assistants: TruckCrewDeploymentAssignment[];
  visibleCrew: TruckCrewDeploymentAssignment[];
  assignmentByUnitId: Map<number, TruckCrewDeploymentAssignment>;
};

export const getTruckCrewUnits = (state: WorldState, truck: Unit): Unit[] =>
  truck.crewIds
    .map((id) => getUnitById(state, id))
    .filter((unit): unit is Unit => !!unit && unit.kind === "firefighter" && unit.assignedTruckId === truck.id)
    .slice(0, TRUCK_CAPACITY);

export const getTruckCrewReadiness = (state: WorldState, truck: Unit): TruckCrewReadiness => {
  const crew = getTruckCrewUnits(state, truck);
  const crewCount = crew.length;
  const passengerIds = new Set(truck.passengerIds);
  const passengerCount = crew.filter((unit) => unit.carrierId === truck.id && passengerIds.has(unit.id)).length;
  const progressionHoseBonus = Math.max(0, Math.floor(state.progression.resolved.truckHoseSlotBonus ?? 0));
  const maxUnlockedHoseSlots = 1 + progressionHoseBonus;
  const hoseSlots =
    crewCount >= TRUCK_SECOND_HOSE_CREW_MIN
      ? Math.min(2, maxUnlockedHoseSlots)
      : crewCount >= TRUCK_PRIMARY_HOSE_CREW_MIN
        ? 1
        : 0;
  const extraCrew = Math.max(0, crewCount - TRUCK_PRIMARY_HOSE_CREW_MIN);
  const transitionSpeedMultiplier = 1 + Math.min(3, extraCrew) * 0.18 + (crewCount >= TRUCK_CAPACITY ? 0.08 : 0);
  const hoseRangeMultiplier = 1 + (crewCount >= TRUCK_SECOND_HOSE_CREW_MIN ? 0.04 : 0) + (crewCount >= TRUCK_CAPACITY ? 0.04 : 0);
  return {
    crewCount,
    passengerCount,
    canDrive: crewCount >= TRUCK_DRIVER_CREW_MIN,
    hoseSlots,
    transitionSpeedMultiplier,
    hoseRangeMultiplier
  };
};

export const getTruckCrewTransitionDuration = (
  state: WorldState,
  truck: Unit,
  kind: "boarding" | "disembarking"
): number => {
  const readiness = getTruckCrewReadiness(state, truck);
  const base = kind === "boarding" ? BASE_BOARDING_SECONDS : BASE_DISEMBARK_SECONDS;
  return base / Math.max(0.25, readiness.transitionSpeedMultiplier);
};

export const isTruckCrewFullyBoarded = (state: WorldState, truck: Unit): boolean => {
  const readiness = getTruckCrewReadiness(state, truck);
  return readiness.crewCount > 0 && readiness.passengerCount >= readiness.crewCount;
};

export const getTruckCrewDeploymentRoles = (
  state: WorldState,
  truck: Unit,
  crew = getTruckCrewUnits(state, truck)
): TruckCrewDeploymentRoles => {
  const sortedCrew = crew.slice(0, TRUCK_CAPACITY).sort((left, right) => left.id - right.id);
  const readiness = getTruckCrewReadiness(state, truck);
  const assignments: TruckCrewDeploymentAssignment[] = [];
  const addAssignment = (
    unit: Unit | undefined,
    role: TruckCrewDeploymentRole,
    hoseIndex: number | null,
    visible: boolean,
    canSpray: boolean
  ): TruckCrewDeploymentAssignment | null => {
    if (!unit) {
      return null;
    }
    const assignment = { unit, role, hoseIndex, visible, canSpray };
    assignments.push(assignment);
    return assignment;
  };

  const driver = addAssignment(sortedCrew[0], "driver", null, false, false);
  const primaryHose = readiness.hoseSlots >= 1 ? addAssignment(sortedCrew[1], "primary_hose", 0, true, true) : null;
  const pumpOperator = sortedCrew.length >= 3 ? addAssignment(sortedCrew[2], "pump_operator", null, true, false) : null;
  if (readiness.hoseSlots >= 2) {
    addAssignment(sortedCrew[3], "secondary_hose", 1, true, true);
  }

  sortedCrew.forEach((unit) => {
    if (assignments.some((assignment) => assignment.unit.id === unit.id)) {
      return;
    }
    addAssignment(unit, "assistant", primaryHose ? primaryHose.hoseIndex : null, true, false);
  });

  const hoseOperators = assignments.filter((assignment) => assignment.canSpray);
  const assistants = assignments.filter((assignment) => assignment.role === "assistant");
  const visibleCrew = assignments.filter((assignment) => assignment.visible);
  const assignmentByUnitId = new Map<number, TruckCrewDeploymentAssignment>();
  assignments.forEach((assignment) => assignmentByUnitId.set(assignment.unit.id, assignment));
  return {
    assignments,
    driver,
    pumpOperator,
    hoseOperators,
    assistants,
    visibleCrew,
    assignmentByUnitId
  };
};

export const getTruckHoseOperators = (state: WorldState, truck: Unit, crew = getTruckCrewUnits(state, truck)): Unit[] => {
  if (truck.crewMode !== "deployed" || truck.crewAction !== null) {
    return [];
  }
  return getTruckCrewDeploymentRoles(state, truck, crew).hoseOperators
    .map((assignment) => assignment.unit)
    .filter((unit) => unit.carrierId === null);
};

export const canFirefighterOperateHose = (state: WorldState, unit: Unit): boolean => {
  if (unit.kind !== "firefighter" || unit.assignedTruckId === null || unit.carrierId !== null) {
    return false;
  }
  if (unit.pathIndex < unit.path.length) {
    return false;
  }
  const truck = getUnitById(state, unit.assignedTruckId);
  if (!truck || truck.kind !== "truck" || truck.crewMode !== "deployed" || truck.crewAction !== null) {
    return false;
  }
  return getTruckHoseOperators(state, truck).some((operator) => operator.id === unit.id);
};

export const getFirefighterHoseRangeMultiplier = (state: WorldState, unit: Unit): number => {
  if (unit.kind !== "firefighter" || unit.assignedTruckId === null) {
    return 1;
  }
  const truck = getUnitById(state, unit.assignedTruckId);
  if (!truck || truck.kind !== "truck") {
    return 1;
  }
  return getTruckCrewReadiness(state, truck).hoseRangeMultiplier;
};
