import type { AreaTarget, CommandIntent, CommandTarget, FormationTarget, LineTarget, Point } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { indexFor } from "../../../core/grid.js";
import { THREAT_FIRE_EPS } from "../constants/runtimeConstants.js";
import { resolveFormationSlot } from "./formationProjection.js";
import { findNearestPassable } from "./unitPathing.js";

export const getCommandTargetBounds = (
  target: CommandTarget
): { minX: number; maxX: number; minY: number; maxY: number } => {
  if (target.kind === "point") {
    return {
      minX: target.point.x,
      maxX: target.point.x,
      minY: target.point.y,
      maxY: target.point.y
    };
  }
  if (target.kind === "formation") {
    const radius = Math.max(1, Math.ceil(target.widthTiles));
    return {
      minX: Math.floor(target.anchor.x - radius),
      maxX: Math.ceil(target.anchor.x + radius),
      minY: Math.floor(target.anchor.y - radius),
      maxY: Math.ceil(target.anchor.y + radius)
    };
  }
  return {
    minX: Math.min(target.start.x, target.end.x),
    maxX: Math.max(target.start.x, target.end.x),
    minY: Math.min(target.start.y, target.end.y),
    maxY: Math.max(target.start.y, target.end.y)
  };
};

export const getCommandTargetCenter = (target: CommandTarget): Point => {
  if (target.kind === "point") {
    return target.point;
  }
  if (target.kind === "formation") {
    return target.anchor;
  }
  return {
    x: Math.round((target.start.x + target.end.x) * 0.5),
    y: Math.round((target.start.y + target.end.y) * 0.5)
  };
};

const pointToSegmentDistance = (point: Point, start: Point, end: Point): number => {
  const abX = end.x - start.x;
  const abY = end.y - start.y;
  const abLenSq = abX * abX + abY * abY;
  if (abLenSq <= 1e-6) {
    return Math.hypot(point.x - start.x, point.y - start.y);
  }
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * abX + (point.y - start.y) * abY) / abLenSq));
  const qx = start.x + abX * t;
  const qy = start.y + abY * t;
  return Math.hypot(point.x - qx, point.y - qy);
};

const pointInCommandTarget = (point: Point, target: CommandTarget): boolean => {
  if (target.kind === "point") {
    return Math.abs(point.x - target.point.x) <= 2 && Math.abs(point.y - target.point.y) <= 2;
  }
  if (target.kind === "line") {
    return pointToSegmentDistance(point, target.start, target.end) <= 3.5;
  }
  if (target.kind === "formation") {
    return Math.hypot(point.x - target.anchor.x, point.y - target.anchor.y) <= Math.max(3.5, target.widthTiles * 0.55);
  }
  const bounds = getCommandTargetBounds(target);
  return point.x >= bounds.minX && point.x <= bounds.maxX && point.y >= bounds.minY && point.y <= bounds.maxY;
};

const resolveLooseSlotTarget = (state: WorldState, target: Point, count: number, index: number): Point => {
  if (count <= 1) {
    return target;
  }
  const angle = (Math.PI * 2 * index) / count;
  const radius = count <= 2 ? 1 : count <= 4 ? 2 : 3;
  const rawX = Math.round(target.x + Math.cos(angle) * radius);
  const rawY = Math.round(target.y + Math.sin(angle) * radius);
  return findNearestPassable(state, rawX, rawY, 2) ?? target;
};

const resolveAreaSlotTarget = (state: WorldState, target: AreaTarget, count: number, index: number): Point => {
  const bounds = getCommandTargetBounds(target);
  const width = Math.max(1, bounds.maxX - bounds.minX + 1);
  const height = Math.max(1, bounds.maxY - bounds.minY + 1);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const column = index % columns;
  const row = Math.floor(index / columns);
  const rawX = Math.round(bounds.minX + ((column + 0.5) / columns) * width);
  const rawY = Math.round(bounds.minY + ((row + 0.5) / rows) * height);
  return findNearestPassable(state, rawX, rawY, 2) ?? getCommandTargetCenter(target);
};

const resolveLineSlotTarget = (state: WorldState, target: LineTarget, count: number, index: number): Point => {
  const t = count <= 1 ? 0.5 : index / Math.max(1, count - 1);
  const rawX = Math.round(target.start.x + (target.end.x - target.start.x) * t);
  const rawY = Math.round(target.start.y + (target.end.y - target.start.y) * t);
  return findNearestPassable(state, rawX, rawY, 2) ?? getCommandTargetCenter(target);
};

const resolveProjectedFormationSlotTarget = (
  state: WorldState,
  target: FormationTarget,
  formation: CommandIntent["formation"],
  count: number,
  index: number
): Point => {
  const raw = resolveFormationSlot(target, formation, count, index);
  return findNearestPassable(state, raw.x, raw.y, 3) ?? getCommandTargetCenter(target);
};

const getOrientation = (target: CommandTarget): { center: Point; forwardX: number; forwardY: number } => {
  if (target.kind === "formation") {
    return {
      center: target.anchor,
      forwardX: target.facing.x,
      forwardY: target.facing.y
    };
  }
  if (target.kind === "line") {
    const dx = target.end.x - target.start.x;
    const dy = target.end.y - target.start.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    return {
      center: target.end,
      forwardX: dx / length,
      forwardY: dy / length
    };
  }
  const center = getCommandTargetCenter(target);
  return { center, forwardX: 0, forwardY: -1 };
};

const resolveWedgeSlotTarget = (state: WorldState, target: CommandTarget, count: number, index: number): Point => {
  const { center, forwardX, forwardY } = getOrientation(target);
  if (count <= 1) {
    return findNearestPassable(state, center.x, center.y, 2) ?? center;
  }
  const side = index % 2 === 0 ? -1 : 1;
  const rank = Math.floor((index + 1) / 2);
  const perpendicularX = -forwardY;
  const perpendicularY = forwardX;
  const spread = Math.max(1, rank) * 2;
  const back = Math.max(1, rank) * 2;
  const rawX = Math.round(center.x + perpendicularX * side * spread - forwardX * back);
  const rawY = Math.round(center.y + perpendicularY * side * spread - forwardY * back);
  return findNearestPassable(state, rawX, rawY, 3) ?? center;
};

const resolveArcSlotTarget = (state: WorldState, target: CommandTarget, count: number, index: number): Point => {
  const { center, forwardX, forwardY } = getOrientation(target);
  if (count <= 1) {
    return findNearestPassable(state, center.x, center.y, 2) ?? center;
  }
  const radius = Math.max(2, Math.min(6, count + 1));
  const arcWidth = Math.PI * 0.9;
  const t = count <= 1 ? 0.5 : index / Math.max(1, count - 1);
  const angleOffset = (t - 0.5) * arcWidth;
  const baseAngle = Math.atan2(forwardY, forwardX) + Math.PI;
  const angle = baseAngle + angleOffset;
  const rawX = Math.round(center.x + Math.cos(angle) * radius);
  const rawY = Math.round(center.y + Math.sin(angle) * radius);
  return findNearestPassable(state, rawX, rawY, 3) ?? center;
};

export const resolveIntentSlotTarget = (
  state: WorldState,
  intent: CommandIntent,
  count: number,
  index: number
): Point => {
  if (intent.formation === "area" && intent.target.kind === "area") {
    return resolveAreaSlotTarget(state, intent.target, count, index);
  }
  if (intent.target.kind === "formation") {
    return resolveProjectedFormationSlotTarget(state, intent.target, intent.formation, count, index);
  }
  if (intent.formation === "line" && intent.target.kind === "line") {
    return resolveLineSlotTarget(state, intent.target, count, index);
  }
  if (intent.formation === "wedge") {
    return resolveWedgeSlotTarget(state, intent.target, count, index);
  }
  if (intent.formation === "arc") {
    return resolveArcSlotTarget(state, intent.target, count, index);
  }
  return resolveLooseSlotTarget(state, getCommandTargetCenter(intent.target), count, index);
};

export const findNearestThreatForTarget = (
  state: WorldState,
  origin: Point,
  target: CommandTarget
): Point | null => {
  let best: Point | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  const bounds = getCommandTargetBounds(target);
  const minX = Math.max(0, bounds.minX - 4);
  const maxX = Math.min(state.grid.cols - 1, bounds.maxX + 4);
  const minY = Math.max(0, bounds.minY - 4);
  const maxY = Math.min(state.grid.rows - 1, bounds.maxY + 4);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const point = { x, y };
      const idx = indexFor(state.grid, x, y);
      const fireValue = state.tileFire[idx] ?? 0;
      const heatValue = state.tileHeat[idx] ?? 0;
      if (fireValue <= THREAT_FIRE_EPS && heatValue <= 0.08) {
        continue;
      }
      const nearTarget = pointInCommandTarget(point, target);
      const score = Math.hypot(origin.x - x, origin.y - y) + (nearTarget ? 0 : 6) - fireValue * 4 - heatValue * 0.5;
      if (score < bestScore) {
        bestScore = score;
        best = point;
      }
    }
  }
  return best;
};
