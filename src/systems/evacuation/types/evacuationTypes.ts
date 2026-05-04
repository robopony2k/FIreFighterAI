import type { Point } from "../../../core/types.js";

export type EvacuationStatus =
  | "None"
  | "PointSelected"
  | "EvacuationOrdered"
  | "Evacuating"
  | "Returning"
  | "Completed"
  | "Returned"
  | "Failed"
  | "Cancelled";

export type EvacuationVehicleStatus = "queued" | "moving" | "evacuated" | "returned" | "destroyed";

export type EvacuationPhase = "outbound" | "holding" | "returning" | "returned";

export type EvacuationVehicleHoldKind = "parked" | "hosted";

export type EvacuationVehicle = {
  id: number;
  evacuationId: string;
  townId: number;
  occupants: number;
  routeIndex: number;
  progress: number;
  heatExposure: number;
  status: EvacuationVehicleStatus;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  colorSeed: number;
  holdKind?: EvacuationVehicleHoldKind;
  holdX?: number;
  holdY?: number;
};

export type EvacuationObstacle = {
  id: number;
  evacuationId: string;
  townId: number;
  tile: Point;
  routeIndex: number;
  createdDay: number;
  capacityPenalty: number;
  blocksRoad: boolean;
};

export type EvacuationRoute = {
  townId: number;
  departure: Point;
  destination: Point;
  tiles: Point[];
  createdDay: number;
};

export type ActiveEvacuation = {
  id: string;
  townId: number;
  destinationTownId?: number;
  phase: EvacuationPhase;
  route: EvacuationRoute;
  vehicles: EvacuationVehicle[];
  obstacles: EvacuationObstacle[];
  nextVehicleId: number;
  nextObstacleId: number;
  spawnAccumulator: number;
  populationToSpawn: number;
};

export type EvacuationLossEvent = {
  kind: "vehicle-destroyed";
  evacuationId: string;
  townId: number;
  occupants: number;
  tileX: number;
  tileY: number;
};

export type EvacuationRouteResult =
  | {
      ok: true;
      route: EvacuationRoute;
    }
  | {
      ok: false;
      reason: "invalid-town" | "invalid-destination" | "no-town-road" | "no-route";
    };
