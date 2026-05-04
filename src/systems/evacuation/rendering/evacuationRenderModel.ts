import type { WorldState } from "../../../core/state.js";
import type { Point } from "../../../core/types.js";
import { createEvacuationRoute } from "../sim/roadRoute.js";

export type EvacuationRouteRenderModel = {
  id: string;
  townId: number;
  active: boolean;
  tiles: Point[];
};

export type EvacuationVehicleRenderModel = {
  id: string;
  townId: number;
  prevX: number;
  prevY: number;
  x: number;
  y: number;
  yaw: number;
  colorSeed: number;
  destroyed: boolean;
};

export type EvacuationObstacleRenderModel = {
  id: string;
  townId: number;
  x: number;
  y: number;
};

export type EvacuationRenderModel = {
  routes: EvacuationRouteRenderModel[];
  vehicles: EvacuationVehicleRenderModel[];
  obstacles: EvacuationObstacleRenderModel[];
};

export const buildEvacuationRenderModel = (state: WorldState): EvacuationRenderModel => {
  const routes: EvacuationRouteRenderModel[] = [];
  const vehicles: EvacuationVehicleRenderModel[] = [];
  const obstacles: EvacuationObstacleRenderModel[] = [];

  for (const town of state.towns) {
    if (town.selectedEvacuationPoint && town.evacuationStatus === "PointSelected") {
      const route = createEvacuationRoute(state, town.id, town.selectedEvacuationPoint);
      if (route.ok) {
        routes.push({
          id: `preview-${town.id}`,
          townId: town.id,
          active: false,
          tiles: route.route.tiles
        });
      }
    }
  }

  for (const evacuation of state.activeEvacuations) {
    routes.push({
      id: evacuation.id,
      townId: evacuation.townId,
      active: true,
      tiles: evacuation.route.tiles
    });
    for (const vehicle of evacuation.vehicles) {
      if (evacuation.phase === "holding" && vehicle.status === "evacuated" && vehicle.holdKind === "hosted") {
        continue;
      }
      const lastRouteIndex = Math.max(0, evacuation.route.tiles.length - 1);
      const currentIndex = Math.max(0, Math.min(lastRouteIndex, vehicle.routeIndex));
      const nextIndex =
        evacuation.phase === "returning"
          ? Math.max(0, currentIndex - 1)
          : Math.min(lastRouteIndex, currentIndex + 1);
      const current = evacuation.route.tiles[currentIndex] ?? { x: vehicle.x, y: vehicle.y };
      const next = evacuation.route.tiles[nextIndex] ?? current;
      const progress = vehicle.status === "moving" ? Math.max(0, Math.min(1, vehicle.progress)) : 0;
      let x = current.x + (next.x - current.x) * progress;
      let y = current.y + (next.y - current.y) * progress;
      if (vehicle.status === "evacuated" && vehicle.holdKind === "parked") {
        x = Number.isFinite(vehicle.holdX) ? vehicle.holdX! : vehicle.x;
        y = Number.isFinite(vehicle.holdY) ? vehicle.holdY! : vehicle.y;
      }
      const prevX = Number.isFinite(vehicle.prevX) ? vehicle.prevX : vehicle.x;
      const prevY = Number.isFinite(vehicle.prevY) ? vehicle.prevY : vehicle.y;
      const yawFrom =
        currentIndex === lastRouteIndex && evacuation.phase !== "returning" && lastRouteIndex > 0
          ? evacuation.route.tiles[lastRouteIndex - 1] ?? current
          : currentIndex === 0 && (evacuation.phase === "returning" || vehicle.status === "returned") && lastRouteIndex > 0
            ? evacuation.route.tiles[1] ?? current
            : current;
      const yawTo =
        currentIndex === lastRouteIndex && evacuation.phase !== "returning" && lastRouteIndex > 0
          ? current
          : currentIndex === 0 && (evacuation.phase === "returning" || vehicle.status === "returned") && lastRouteIndex > 0
            ? current
            : next;
      const dx = yawTo.x - yawFrom.x;
      const dy = yawTo.y - yawFrom.y;
      const yaw = Math.abs(dx) + Math.abs(dy) > 0.0001 ? Math.atan2(dx, dy) : 0;
      if ((vehicle.status === "evacuated" && vehicle.holdKind !== "parked") || vehicle.status === "returned") {
        const lateral = ((vehicle.id % 5) - 2) * 0.16;
        const depth = (Math.floor(vehicle.id / 5) % 3) * 0.14;
        x += Math.cos(yaw) * lateral - Math.sin(yaw) * depth;
        y += -Math.sin(yaw) * lateral - Math.cos(yaw) * depth;
      }
      vehicles.push({
        id: `${evacuation.id}-${vehicle.id}`,
        townId: evacuation.townId,
        prevX,
        prevY,
        x,
        y,
        yaw,
        colorSeed: vehicle.colorSeed,
        destroyed: vehicle.status === "destroyed"
      });
    }
    for (const obstacle of evacuation.obstacles) {
      obstacles.push({
        id: `${evacuation.id}-obs-${obstacle.id}`,
        townId: evacuation.townId,
        x: obstacle.tile.x,
        y: obstacle.tile.y
      });
    }
  }

  return { routes, vehicles, obstacles };
};
