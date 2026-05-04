import type { WorldState } from "../../../core/state.js";
import type { Point } from "../../../core/types.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import {
  EVACUATION_EXTREME_FIRE_THRESHOLD,
  EVACUATION_EXTREME_HEAT_THRESHOLD,
  EVACUATION_HEAT_EXPOSURE_LIMIT,
  EVACUATION_HEAT_EXPOSURE_RATE,
  EVACUATION_ROAD_SLOT_CAPACITY,
  EVACUATION_VEHICLE_CAPACITY,
  EVACUATION_VEHICLE_SPAWN_INTERVAL_DAYS,
  EVACUATION_VEHICLE_SPEED_TILES_PER_DAY
} from "../constants/runtimeConstants.js";
import type {
  ActiveEvacuation,
  EvacuationLossEvent,
  EvacuationObstacle,
  EvacuationRoute,
  EvacuationVehicle
} from "../types/evacuationTypes.js";

const EVACUATION_APPROVAL_PEOPLE_PER_HOUSEHOLD = 8;
const EVACUATION_ORIGIN_DISPLACEMENT_DISAPPROVAL_PER_HOUSEHOLD_DAY = 0.04;
const EVACUATION_HOST_OVER_CAPACITY_DISAPPROVAL_PER_HOUSEHOLD_DAY = 0.06;

const getTownCenterX = (town: WorldState["towns"][number]): number => (Number.isFinite(town.cx) ? town.cx : town.x);
const getTownCenterY = (town: WorldState["towns"][number]): number => (Number.isFinite(town.cy) ? town.cy : town.y);

const getTownById = (state: WorldState, townId: number): WorldState["towns"][number] | null =>
  state.towns.find((entry) => entry.id === townId) ?? null;

const getTownPopulation = (state: WorldState, townId: number): number => {
  let population = 0;
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileTownId[idx] === townId && state.tiles[idx]?.type === "house" && !state.tiles[idx].houseDestroyed) {
      population += Math.max(0, Math.floor(state.tiles[idx].houseResidents || 0));
    }
  }
  return population;
};

const findDestinationTownId = (state: WorldState, originTownId: number, destination: Point): number | undefined => {
  const x = Math.trunc(destination.x);
  const y = Math.trunc(destination.y);
  if (inBounds(state.grid, x, y)) {
    const directTownId = state.tileTownId[indexFor(state.grid, x, y)] ?? -1;
    if (directTownId >= 0 && directTownId !== originTownId && getTownById(state, directTownId)) {
      return directTownId;
    }
  }
  let bestTownId: number | undefined;
  let bestDistSq = Number.POSITIVE_INFINITY;
  for (const town of state.towns) {
    if (town.id === originTownId) {
      continue;
    }
    const radius = Math.max(3, Number.isFinite(town.radius) ? town.radius : 3);
    const dx = destination.x - getTownCenterX(town);
    const dy = destination.y - getTownCenterY(town);
    const distSq = dx * dx + dy * dy;
    if (distSq <= radius * radius && distSq < bestDistSq) {
      bestDistSq = distSq;
      bestTownId = town.id;
    }
  }
  return bestTownId;
};

const syncTownEvacuationCounts = (state: WorldState, evacuation: ActiveEvacuation): void => {
  const town = state.towns.find((entry) => entry.id === evacuation.townId);
  if (!town) {
    return;
  }
  let queuedPeople = evacuation.phase === "outbound" ? evacuation.populationToSpawn : 0;
  let movingPeople = 0;
  let evacuatedPeople = 0;
  let returnedPeople = 0;
  let deadPeople = 0;
  let vehiclesQueued = 0;
  let vehiclesMoving = 0;
  let vehiclesDestroyed = 0;
  for (const vehicle of evacuation.vehicles) {
    if (vehicle.status === "queued") {
      queuedPeople += vehicle.occupants;
      vehiclesQueued += 1;
    } else if (vehicle.status === "moving") {
      movingPeople += vehicle.occupants;
      vehiclesMoving += 1;
    } else if (vehicle.status === "evacuated") {
      evacuatedPeople += vehicle.occupants;
    } else if (vehicle.status === "returned") {
      returnedPeople += vehicle.occupants;
    } else if (vehicle.status === "destroyed") {
      deadPeople += vehicle.occupants;
      vehiclesDestroyed += 1;
    }
  }
  town.populationQueued = Math.max(0, queuedPeople);
  town.populationEvacuating = Math.max(0, movingPeople);
  town.populationEvacuated = Math.max(0, evacuatedPeople);
  town.populationRemaining = Math.max(
    0,
    evacuation.phase === "returned" ? returnedPeople : town.populationQueued + town.populationEvacuating
  );
  town.populationDead = Math.max(0, deadPeople);
  town.vehiclesQueued = vehiclesQueued;
  town.vehiclesMoving = vehiclesMoving;
  town.vehiclesDestroyed = vehiclesDestroyed;
};

export const createActiveEvacuation = (
  state: WorldState,
  id: string,
  town: WorldState["towns"][number],
  route: EvacuationRoute
): ActiveEvacuation => {
  const population = Math.max(0, getTownPopulation(state, town.id));
  town.populationRemaining = population;
  town.populationQueued = population;
  town.populationEvacuating = 0;
  town.populationEvacuated = 0;
  town.populationDead = 0;
  town.vehiclesQueued = 0;
  town.vehiclesMoving = 0;
  town.vehiclesDestroyed = 0;
  return {
    id,
    townId: town.id,
    destinationTownId: findDestinationTownId(state, town.id, route.destination),
    phase: "outbound",
    route,
    vehicles: [],
    obstacles: [],
    nextVehicleId: 1,
    nextObstacleId: 1,
    spawnAccumulator: EVACUATION_VEHICLE_SPAWN_INTERVAL_DAYS,
    populationToSpawn: population
  };
};

export const orderEvacuationReturnHome = (state: WorldState, townId: number): boolean => {
  const town = state.towns.find((entry) => entry.id === townId);
  if (!town || !town.activeEvacuationId || town.evacuationStatus !== "Completed") {
    return false;
  }
  const evacuation = state.activeEvacuations.find((entry) => entry.id === town.activeEvacuationId);
  if (!evacuation || evacuation.phase !== "holding") {
    return false;
  }
  const endIndex = getRouteEndIndex(evacuation);
  let returnableVehicles = 0;
  for (const vehicle of evacuation.vehicles) {
    if (vehicle.status !== "evacuated") {
      continue;
    }
    const destination = evacuation.route.tiles[endIndex];
    if (!destination) {
      continue;
    }
    vehicle.status = "queued";
    vehicle.routeIndex = endIndex;
    vehicle.progress = 0;
    vehicle.holdKind = undefined;
    vehicle.holdX = undefined;
    vehicle.holdY = undefined;
    vehicle.x = destination.x;
    vehicle.y = destination.y;
    vehicle.prevX = destination.x;
    vehicle.prevY = destination.y;
    returnableVehicles += 1;
  }
  if (returnableVehicles <= 0) {
    return false;
  }
  evacuation.phase = "returning";
  town.evacuationStatus = "Returning";
  syncTownEvacuationCounts(state, evacuation);
  return true;
};

const getVehicleTileKey = (vehicle: EvacuationVehicle): string => `${Math.floor(vehicle.x)}:${Math.floor(vehicle.y)}`;
const getRouteKey = (point: Point): string => `${point.x}:${point.y}`;

const getRouteEndIndex = (evacuation: ActiveEvacuation): number => Math.max(0, evacuation.route.tiles.length - 1);

const getNextRouteIndex = (evacuation: ActiveEvacuation, vehicle: EvacuationVehicle): number | null => {
  if (evacuation.phase === "returning") {
    return vehicle.routeIndex > 0 ? vehicle.routeIndex - 1 : null;
  }
  return vehicle.routeIndex < getRouteEndIndex(evacuation) ? vehicle.routeIndex + 1 : null;
};

const isParkingTile = (state: WorldState, x: number, y: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const tile = state.tiles[indexFor(state.grid, x, y)];
  if (!tile) {
    return false;
  }
  const idx = indexFor(state.grid, x, y);
  if ((state.tileFire[idx] ?? tile.fire ?? 0) >= EVACUATION_EXTREME_FIRE_THRESHOLD) {
    return false;
  }
  if ((state.tileHeat[idx] ?? tile.heat ?? 0) >= EVACUATION_EXTREME_HEAT_THRESHOLD) {
    return false;
  }
  return tile.type !== "road" && tile.type !== "base" && tile.type !== "water" && tile.type !== "house";
};

const findVehicleHoldPosition = (state: WorldState, evacuation: ActiveEvacuation, vehicle: EvacuationVehicle): Point => {
  const destination = evacuation.route.tiles[getRouteEndIndex(evacuation)] ?? evacuation.route.destination;
  const candidates: Point[] = [];
  for (let radius = 1; radius <= 4; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        const x = destination.x + dx;
        const y = destination.y + dy;
        if (isParkingTile(state, x, y)) {
          candidates.push({ x, y });
        }
      }
    }
    if (candidates.length > vehicle.id + 2) {
      break;
    }
  }
  const chosen = candidates.length > 0 ? candidates[(vehicle.id - 1) % candidates.length]! : destination;
  const lateral = ((vehicle.id % 3) - 1) * 0.18;
  const depth = (Math.floor(vehicle.id / 3) % 3 - 1) * 0.18;
  return { x: chosen.x + lateral, y: chosen.y + depth };
};

const clearVehicleFromOccupancy = (occupancy: Map<string, number>, vehicle: EvacuationVehicle): void => {
  const currentKey = getVehicleTileKey(vehicle);
  const currentCount = (occupancy.get(currentKey) ?? 0) - 1;
  if (currentCount > 0) {
    occupancy.set(currentKey, currentCount);
  } else {
    occupancy.delete(currentKey);
  }
};

const markVehicleArrived = (
  state: WorldState,
  evacuation: ActiveEvacuation,
  vehicle: EvacuationVehicle,
  occupancy: Map<string, number>
): void => {
  clearVehicleFromOccupancy(occupancy, vehicle);
  vehicle.progress = 0;
  if (evacuation.phase === "returning") {
    vehicle.status = "returned";
    vehicle.holdKind = undefined;
    vehicle.holdX = undefined;
    vehicle.holdY = undefined;
    return;
  }
  vehicle.status = "evacuated";
  if (evacuation.destinationTownId !== undefined) {
    vehicle.holdKind = "hosted";
    vehicle.holdX = undefined;
    vehicle.holdY = undefined;
    return;
  }
  const hold = findVehicleHoldPosition(state, evacuation, vehicle);
  vehicle.holdKind = "parked";
  vehicle.holdX = hold.x;
  vehicle.holdY = hold.y;
  vehicle.x = hold.x;
  vehicle.y = hold.y;
  vehicle.prevX = hold.x;
  vehicle.prevY = hold.y;
};

const buildOccupancy = (evacuation: ActiveEvacuation): Map<string, number> => {
  const occupancy = new Map<string, number>();
  for (const vehicle of evacuation.vehicles) {
    if (vehicle.status !== "moving" && vehicle.status !== "queued") {
      continue;
    }
    const key = getVehicleTileKey(vehicle);
    occupancy.set(key, (occupancy.get(key) ?? 0) + 1);
  }
  return occupancy;
};

const buildBlockedTiles = (evacuation: ActiveEvacuation): Set<string> => {
  const blocked = new Set<string>();
  for (const obstacle of evacuation.obstacles) {
    if (obstacle.blocksRoad) {
      blocked.add(getRouteKey(obstacle.tile));
    }
  }
  return blocked;
};

const canEnterTile = (occupancy: Map<string, number>, blocked: Set<string>, point: Point): boolean => {
  const key = getRouteKey(point);
  if (blocked.has(key)) {
    return false;
  }
  return (occupancy.get(key) ?? 0) < EVACUATION_ROAD_SLOT_CAPACITY;
};

const spawnVehicle = (evacuation: ActiveEvacuation): void => {
  const occupants = Math.min(EVACUATION_VEHICLE_CAPACITY, evacuation.populationToSpawn);
  if (occupants <= 0 || evacuation.route.tiles.length === 0) {
    return;
  }
  const start = evacuation.route.tiles[0]!;
  const vehicleId = evacuation.nextVehicleId++;
  evacuation.populationToSpawn -= occupants;
  evacuation.vehicles.push({
    id: vehicleId,
    evacuationId: evacuation.id,
    townId: evacuation.townId,
    occupants,
    routeIndex: 0,
    progress: 0,
    heatExposure: 0,
    status: "queued",
    x: start.x,
    y: start.y,
    prevX: start.x,
    prevY: start.y,
    colorSeed: ((evacuation.townId + 1) * 73856093) ^ (vehicleId * 19349663),
    holdKind: undefined,
    holdX: undefined,
    holdY: undefined
  });
};

const canSpawnAtDeparture = (evacuation: ActiveEvacuation): boolean => {
  const start = evacuation.route.tiles[0];
  if (!start) {
    return false;
  }
  const startKey = getRouteKey(start);
  const occupied = evacuation.vehicles.reduce((count, vehicle) => {
    if ((vehicle.status === "queued" || vehicle.status === "moving") && getVehicleTileKey(vehicle) === startKey) {
      return count + 1;
    }
    return count;
  }, 0);
  return occupied < EVACUATION_ROAD_SLOT_CAPACITY;
};

const destroyVehicle = (
  state: WorldState,
  evacuation: ActiveEvacuation,
  vehicle: EvacuationVehicle,
  tile: Point,
  events: EvacuationLossEvent[]
): void => {
  if (vehicle.status === "destroyed" || vehicle.status === "evacuated" || vehicle.status === "returned") {
    return;
  }
  vehicle.status = "destroyed";
  const obstacle: EvacuationObstacle = {
    id: evacuation.nextObstacleId++,
    evacuationId: evacuation.id,
    townId: evacuation.townId,
    tile: { x: tile.x, y: tile.y },
    routeIndex: vehicle.routeIndex,
    createdDay: state.careerDay,
    capacityPenalty: 1,
    blocksRoad: true
  };
  evacuation.obstacles.push(obstacle);
  events.push({
    kind: "vehicle-destroyed",
    evacuationId: evacuation.id,
    townId: evacuation.townId,
    occupants: vehicle.occupants,
    tileX: tile.x,
    tileY: tile.y
  });
};

const applyHeatExposure = (
  state: WorldState,
  evacuation: ActiveEvacuation,
  vehicle: EvacuationVehicle,
  stepDays: number,
  events: EvacuationLossEvent[]
): boolean => {
  const tileX = Math.max(0, Math.min(state.grid.cols - 1, Math.floor(vehicle.x)));
  const tileY = Math.max(0, Math.min(state.grid.rows - 1, Math.floor(vehicle.y)));
  const idx = indexFor(state.grid, tileX, tileY);
  const fire = state.tileFire[idx] ?? state.tiles[idx]?.fire ?? 0;
  const heat = state.tileHeat[idx] ?? state.tiles[idx]?.heat ?? 0;
  if (fire >= EVACUATION_EXTREME_FIRE_THRESHOLD || heat >= EVACUATION_EXTREME_HEAT_THRESHOLD) {
    destroyVehicle(state, evacuation, vehicle, { x: tileX, y: tileY }, events);
    return true;
  }
  vehicle.heatExposure += Math.max(0, fire * 1.25 + heat * 0.45) * EVACUATION_HEAT_EXPOSURE_RATE * stepDays;
  if (vehicle.heatExposure >= EVACUATION_HEAT_EXPOSURE_LIMIT) {
    destroyVehicle(state, evacuation, vehicle, { x: tileX, y: tileY }, events);
    return true;
  }
  return false;
};

const advanceVehicle = (
  state: WorldState,
  evacuation: ActiveEvacuation,
  vehicle: EvacuationVehicle,
  stepDays: number,
  occupancy: Map<string, number>,
  blocked: Set<string>,
  events: EvacuationLossEvent[]
): void => {
  if (vehicle.status === "destroyed" || vehicle.status === "evacuated" || vehicle.status === "returned") {
    return;
  }
  vehicle.prevX = vehicle.x;
  vehicle.prevY = vehicle.y;
  if (applyHeatExposure(state, evacuation, vehicle, stepDays, events)) {
    return;
  }
  const firstNextIndex = getNextRouteIndex(evacuation, vehicle);
  if (firstNextIndex === null) {
    markVehicleArrived(state, evacuation, vehicle, occupancy);
    return;
  }
  const next = evacuation.route.tiles[firstNextIndex]!;
  if (!canEnterTile(occupancy, blocked, next)) {
    vehicle.status = "queued";
    return;
  }
  vehicle.status = "moving";
  vehicle.progress += EVACUATION_VEHICLE_SPEED_TILES_PER_DAY * stepDays;
  while (vehicle.progress >= 1) {
    clearVehicleFromOccupancy(occupancy, vehicle);
    const nextIndex = getNextRouteIndex(evacuation, vehicle);
    if (nextIndex === null) {
      markVehicleArrived(state, evacuation, vehicle, occupancy);
      return;
    }
    vehicle.routeIndex = nextIndex;
    vehicle.progress -= 1;
    const current = evacuation.route.tiles[vehicle.routeIndex]!;
    vehicle.x = current.x;
    vehicle.y = current.y;
    const nextKey = getRouteKey(current);
    occupancy.set(nextKey, (occupancy.get(nextKey) ?? 0) + 1);
    const upcomingIndex = getNextRouteIndex(evacuation, vehicle);
    if (upcomingIndex === null) {
      markVehicleArrived(state, evacuation, vehicle, occupancy);
      return;
    }
    const upcoming = evacuation.route.tiles[upcomingIndex]!;
    if (!canEnterTile(occupancy, blocked, upcoming)) {
      vehicle.status = "queued";
      vehicle.progress = 0;
      return;
    }
  }
};

const applyEvacuationApprovalPressure = (state: WorldState, evacuation: ActiveEvacuation, stepDays: number): void => {
  if (stepDays <= 0 || evacuation.phase === "returned") {
    return;
  }
  const originTown = getTownById(state, evacuation.townId);
  if (!originTown) {
    return;
  }
  let displacedPeople = 0;
  let hostedPeople = 0;
  for (const vehicle of evacuation.vehicles) {
    if (vehicle.status === "destroyed" || vehicle.status === "returned") {
      continue;
    }
    if (vehicle.status === "evacuated" || vehicle.status === "moving" || vehicle.status === "queued") {
      displacedPeople += vehicle.occupants;
    }
    if (evacuation.phase === "holding" && vehicle.status === "evacuated" && vehicle.holdKind === "hosted") {
      hostedPeople += vehicle.occupants;
    }
  }
  if (displacedPeople > 0) {
    originTown.nonApprovingHouseCount +=
      (displacedPeople / EVACUATION_APPROVAL_PEOPLE_PER_HOUSEHOLD) *
      EVACUATION_ORIGIN_DISPLACEMENT_DISAPPROVAL_PER_HOUSEHOLD_DAY *
      stepDays;
  }
  if (hostedPeople <= 0 || evacuation.destinationTownId === undefined) {
    return;
  }
  const hostTown = getTownById(state, evacuation.destinationTownId);
  if (!hostTown || hostTown.id === originTown.id) {
    return;
  }
  hostTown.nonApprovingHouseCount +=
    (hostedPeople / EVACUATION_APPROVAL_PEOPLE_PER_HOUSEHOLD) *
    EVACUATION_HOST_OVER_CAPACITY_DISAPPROVAL_PER_HOUSEHOLD_DAY *
    stepDays;
};

export const stepEvacuations = (state: WorldState, stepDays: number): EvacuationLossEvent[] => {
  if (stepDays <= 0 || state.activeEvacuations.length === 0) {
    return [];
  }
  const events: EvacuationLossEvent[] = [];
  for (const evacuation of state.activeEvacuations) {
    const town = state.towns.find((entry) => entry.id === evacuation.townId);
    if (!town) {
      continue;
    }
    if (evacuation.phase !== "outbound" && evacuation.phase !== "returning") {
      applyEvacuationApprovalPressure(state, evacuation, stepDays);
      syncTownEvacuationCounts(state, evacuation);
      continue;
    }
    town.evacuationStatus = evacuation.phase === "returning" ? "Returning" : "Evacuating";
    if (evacuation.phase === "outbound") {
      evacuation.spawnAccumulator += stepDays;
      while (
        evacuation.populationToSpawn > 0 &&
        evacuation.spawnAccumulator >= EVACUATION_VEHICLE_SPAWN_INTERVAL_DAYS &&
        canSpawnAtDeparture(evacuation)
      ) {
        evacuation.spawnAccumulator -= EVACUATION_VEHICLE_SPAWN_INTERVAL_DAYS;
        spawnVehicle(evacuation);
      }
    }

    const occupancy = buildOccupancy(evacuation);
    const blocked = buildBlockedTiles(evacuation);
    for (const vehicle of evacuation.vehicles) {
      advanceVehicle(state, evacuation, vehicle, stepDays, occupancy, blocked, events);
    }

    let activePeople = evacuation.phase === "outbound" ? evacuation.populationToSpawn : 0;
    let evacuatedPeople = 0;
    let returnedPeople = 0;
    let deadPeople = 0;
    for (const vehicle of evacuation.vehicles) {
      if (vehicle.status === "evacuated") {
        evacuatedPeople += vehicle.occupants;
      } else if (vehicle.status === "returned") {
        returnedPeople += vehicle.occupants;
      } else if (vehicle.status === "destroyed") {
        deadPeople += vehicle.occupants;
      } else if (vehicle.status === "queued" || vehicle.status === "moving") {
        activePeople += vehicle.occupants;
      }
    }
    syncTownEvacuationCounts(state, evacuation);
    applyEvacuationApprovalPressure(state, evacuation, stepDays);
    if (activePeople <= 0 && evacuation.populationToSpawn <= 0) {
      if (evacuation.phase === "returning") {
        evacuation.phase = "returned";
        town.evacuationStatus = returnedPeople > 0 ? "Returned" : "Failed";
        syncTownEvacuationCounts(state, evacuation);
      } else {
        evacuation.phase = evacuatedPeople > 0 ? "holding" : "returned";
        town.evacuationStatus = deadPeople > 0 && evacuatedPeople <= 0 ? "Failed" : "Completed";
        syncTownEvacuationCounts(state, evacuation);
      }
    }
  }
  return events;
};
