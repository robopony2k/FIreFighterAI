
import type { WorldState } from "../core/state.js";
import { TILE_SIZE, UNIT_CONFIG } from "../core/config.js";
import { hash2D } from "../mapgen/noise.js";
import { getRenderHeightAt } from "./terrainCache.js";
import { isoProject } from "./iso.js";

type RenderUnit = WorldState["units"][number];

const getCrewSpreadOffset = (state: WorldState, unit: RenderUnit, truck: RenderUnit | null): { x: number; y: number } => {
  if (unit.kind !== "firefighter") {
    return { x: 0, y: 0 };
  }
  if (truck && truck.crewMode === "boarded" && unit.carrierId === truck.id) {
    return { x: 0, y: 0 };
  }
  const seed = hash2D(unit.id, truck ? truck.id : 0, state.seed + 113);
  const jitter = (hash2D(unit.id, 41, state.seed + 277) - 0.5) * 0.6;
  let angle = seed * Math.PI * 2;
  let radius = 0.12 + hash2D(unit.id, 73, state.seed + 431) * 0.08;

  if (truck && truck.crewIds.length > 0) {
    const crewIndex = truck.crewIds.indexOf(unit.id);
    const crewCount = Math.max(1, truck.crewIds.length);
    if (crewIndex >= 0) {
      angle = (crewIndex / crewCount) * Math.PI * 2 + jitter;
      radius = 0.16 + (hash2D(unit.id, 97, state.seed + 503) - 0.5) * 0.06;
    }
  }

  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
};

const drawCrewHose = (
  ctx: CanvasRenderingContext2D,
  start: { x: number; y: number },
  end: { x: number; y: number },
  seed: number
): void => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 4) {
    return;
  }
  const nx = dx / dist;
  const ny = dy / dist;
  const perpX = -ny;
  const perpY = nx;
  const curve = (seed - 0.5) * 2;
  const sag = Math.min(36, dist * 0.28);
  const midX = (start.x + end.x) / 2 + perpX * sag * 0.35 * curve;
  const midY = (start.y + end.y) / 2 + perpY * sag * 0.35 * curve + sag * 0.18;

  ctx.strokeStyle = "rgba(40, 35, 30, 0.55)";
  ctx.lineWidth = Math.max(1, TILE_SIZE * 0.05);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.quadraticCurveTo(midX, midY, end.x, end.y);
  ctx.stroke();
};

const drawTargetMarker = (ctx: CanvasRenderingContext2D, pos: { x: number; y: number }, size: number, color: string) => {
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(pos.x, pos.y - size);
  ctx.lineTo(pos.x + size, pos.y);
  ctx.lineTo(pos.x, pos.y + size);
  ctx.lineTo(pos.x - size, pos.y);
  ctx.closePath();
  ctx.stroke();
};

/**
 * @deprecated Legacy 2D renderer. Prefer the 3D render backend.
 */
export const drawUnits = (state: WorldState, ctx: CanvasRenderingContext2D, alpha = 1) => {
  const t = Math.max(0, Math.min(1, alpha));
  const renderPositions = new Map<number, { x: number; y: number }>();
  state.units.forEach((unit) => {
    renderPositions.set(unit.id, {
      x: unit.prevX + (unit.x - unit.prevX) * t,
      y: unit.prevY + (unit.y - unit.prevY) * t
    });
  });

  const truckById = new Map<number, RenderUnit>();
  state.units.forEach((unit) => {
    if (unit.kind === "truck") {
      truckById.set(unit.id, unit);
    }
  });

  const crewOffsets = new Map<number, { x: number; y: number }>();
  state.units.forEach((unit) => {
    if (unit.kind !== "firefighter") {
      return;
    }
    const truck = unit.assignedTruckId !== null ? truckById.get(unit.assignedTruckId) ?? null : null;
    crewOffsets.set(unit.id, getCrewSpreadOffset(state, unit, truck));
  });

  // Draw hoses first, so they appear underneath units
  state.units.forEach((unit) => {
    if (unit.kind !== "firefighter") {
      return;
    }
    const truck = unit.assignedTruckId !== null ? truckById.get(unit.assignedTruckId) ?? null : null;
    if (!truck || truck.crewMode === "boarded" || unit.carrierId === truck.id) {
      return;
    }
    const offset = crewOffsets.get(unit.id) ?? { x: 0, y: 0 };
    const crewPos = renderPositions.get(unit.id) ?? { x: unit.x, y: unit.y };
    const truckPos = renderPositions.get(truck.id) ?? { x: truck.x, y: truck.y };
    const crewX = crewPos.x + offset.x;
    const crewY = crewPos.y + offset.y;
    const truckHeight = getRenderHeightAt(state, truckPos.x, truckPos.y);
    const crewHeight = getRenderHeightAt(state, crewX, crewY);
    const truckAnchor = isoProject(truckPos.x, truckPos.y, truckHeight + TILE_SIZE * 0.35);
    const crewAnchor = isoProject(crewX, crewY, crewHeight + TILE_SIZE * 0.55);
    const dx = crewAnchor.x - truckAnchor.x;
    const dy = crewAnchor.y - truckAnchor.y;
    const dist = Math.hypot(dx, dy) || 1;
    const start = {
      x: truckAnchor.x + (dx / dist) * TILE_SIZE * 0.18,
      y: truckAnchor.y + (dy / dist) * TILE_SIZE * 0.12,
    };
    const end = {
      x: crewAnchor.x - (dx / dist) * TILE_SIZE * 0.1,
      y: crewAnchor.y - (dy / dist) * TILE_SIZE * 0.05,
    };
    drawCrewHose(ctx, start, end, hash2D(unit.id, truck.id, state.seed + 911));
  });

  // Draw all units
  state.units.forEach((unit) => {
    const offset = unit.kind === "firefighter" ? crewOffsets.get(unit.id) ?? { x: 0, y: 0 } : { x: 0, y: 0 };
    const unitPos = renderPositions.get(unit.id) ?? { x: unit.x, y: unit.y };
    const unitX = unitPos.x + offset.x;
    const unitY = unitPos.y + offset.y;
    const baseHeight = getRenderHeightAt(state, unitX, unitY);
    const ground = isoProject(unitX, unitY, baseHeight);
    const unitHeight = unit.kind === "truck" ? TILE_SIZE * 0.6 : TILE_SIZE * 0.75;
    const body = isoProject(unitX, unitY, baseHeight + unitHeight);

    // Shadow
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y + TILE_SIZE * 0.2, TILE_SIZE * 0.35, TILE_SIZE * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    const unitColor = UNIT_CONFIG[unit.kind].color;
    if (unit.kind === "firefighter") {
      const radius = TILE_SIZE * 0.24;
      ctx.fillStyle = unitColor;
      ctx.beginPath();
      ctx.arc(body.x, body.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#f7d27a"; // Helmet
      ctx.beginPath();
      ctx.arc(body.x, body.y - radius * 0.6, radius * 0.7, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = "rgba(0, 0, 0, 0.2)"; // Visor
      ctx.fillRect(body.x - radius * 0.4, body.y - radius * 0.25, radius * 0.8, radius * 0.3);
    } else {
      // Truck body
      const width = TILE_SIZE * 0.95;
      const height = TILE_SIZE * 0.45;
      ctx.fillStyle = unitColor;
      ctx.fillRect(body.x - width / 2, body.y - height / 2, width, height);
      ctx.fillStyle = "#f2c94c"; // Stripe
      ctx.fillRect(body.x - width * 0.42, body.y - height * 0.4, width * 0.35, height * 0.35);
      ctx.fillStyle = "rgba(0, 0, 0, 0.35)"; // Wheels
      ctx.beginPath();
      ctx.arc(body.x - width * 0.32, body.y + height * 0.45, TILE_SIZE * 0.1, 0, Math.PI * 2);
      ctx.arc(body.x + width * 0.32, body.y + height * 0.45, TILE_SIZE * 0.1, 0, Math.PI * 2);
      ctx.fill();
    }

    if (unit.selected) {
      // White outline for selected unit
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      if (unit.kind === "firefighter") {
        ctx.beginPath();
        ctx.arc(body.x, body.y, TILE_SIZE * 0.3, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        ctx.strokeRect(body.x - TILE_SIZE * 0.55, body.y - TILE_SIZE * 0.3, TILE_SIZE * 1.1, TILE_SIZE * 0.6);
      }

      // Ground selection circle
      ctx.strokeStyle = "rgba(240, 179, 59, 0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ground.x, ground.y + TILE_SIZE * 0.15, TILE_SIZE * 0.55, 0, Math.PI * 2);
      ctx.stroke();

      // Target line and marker
      if (unit.target) {
        const targetHeight = getRenderHeightAt(state, unit.target.x + 0.5, unit.target.y + 0.5);
        const target = isoProject(unit.target.x + 0.5, unit.target.y + 0.5, targetHeight + TILE_SIZE * 0.2);
        ctx.strokeStyle = "rgba(240, 179, 59, 0.7)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(ground.x, ground.y);
        ctx.lineTo(target.x, target.y);
        ctx.stroke();
        drawTargetMarker(ctx, target, TILE_SIZE * 0.35, "rgba(240, 179, 59, 0.9)");
      }
    }
  });
};
