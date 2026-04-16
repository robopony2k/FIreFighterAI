import type { RNG, RosterUnit, UnitKind, UnitSkill } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import {
  MAX_TRAINING_LEVEL,
  RECRUIT_FIREFIGHTER_COST,
  RECRUIT_TRUCK_COST,
  TRAINING_COST,
  TRUCK_CAPACITY
} from "../../../core/config.js";
import { setStatus } from "../../../core/state.js";
import { FIRST_NAMES, LAST_NAMES, TRUCK_PREFIX } from "../constants/runtimeConstants.js";
import { clamp } from "../utils/unitMath.js";
import { getRosterFirefighter, getRosterTruck, getRosterUnit } from "../utils/unitLookup.js";
import { buildUnitDerivedStats, createTraining } from "../utils/unitStats.js";

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
  if (!firefighter || firefighter.assignedTruckId === null) {
    return;
  }
  const truck = getRosterTruck(state, firefighter.assignedTruckId);
  unassignRosterFirefighter(state, firefighter);
  if (truck) {
    setStatus(state, `${firefighter.name} unassigned from ${truck.name}.`);
  }
}

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

export const getTrainingCostForState = (state: WorldState): number =>
  Math.max(1, Math.round(TRAINING_COST * state.progression.resolved.trainingCostMultiplier));

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
