import type { CommandFormation, FormationTarget, Point } from "../../../core/types.js";

export type FormationProjectionSlot = Point & {
  index: number;
};

export type FormationProjection = {
  anchor: Point;
  facing: Point;
  widthTiles: number;
  slots: FormationProjectionSlot[];
};

export type FormationProjectionInput = {
  anchor: Point;
  cursor?: Point | null;
  formation: CommandFormation;
  count: number;
  fallbackFacing?: Point | null;
  minWidthTiles?: number;
  maxWidthTiles?: number;
};

const DEFAULT_FACING: Point = { x: 0, y: -1 };
const DEFAULT_MIN_WIDTH_TILES = 2;
const DEFAULT_MAX_WIDTH_TILES = 24;
const MIN_DIRECTION_LENGTH = 0.001;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const normalize = (vector: Point | null | undefined): Point | null => {
  if (!vector) {
    return null;
  }
  const length = Math.hypot(vector.x, vector.y);
  if (!Number.isFinite(length) || length < MIN_DIRECTION_LENGTH) {
    return null;
  }
  return { x: vector.x / length, y: vector.y / length };
};

export const getAutoFormationWidthTiles = (formation: CommandFormation, count: number): number => {
  const safeCount = Math.max(1, Math.floor(count));
  if (safeCount <= 1) {
    return DEFAULT_MIN_WIDTH_TILES;
  }
  if (formation === "wedge") {
    return Math.max(DEFAULT_MIN_WIDTH_TILES, Math.ceil(safeCount / 2) * 4);
  }
  if (formation === "arc") {
    return Math.max(DEFAULT_MIN_WIDTH_TILES, (safeCount - 1) * 2.5);
  }
  return Math.max(DEFAULT_MIN_WIDTH_TILES, (safeCount - 1) * 2);
};

export const resolveFormationFacing = (anchor: Point, cursor?: Point | null, fallbackFacing?: Point | null): Point => {
  return (
    normalize(cursor ? { x: cursor.x - anchor.x, y: cursor.y - anchor.y } : null) ??
    normalize(fallbackFacing) ??
    DEFAULT_FACING
  );
};

export const createFormationTarget = ({
  anchor,
  cursor,
  formation,
  count,
  fallbackFacing = null,
  minWidthTiles = DEFAULT_MIN_WIDTH_TILES,
  maxWidthTiles = DEFAULT_MAX_WIDTH_TILES
}: FormationProjectionInput): FormationTarget => {
  const facing = resolveFormationFacing(anchor, cursor, fallbackFacing);
  const autoWidth = getAutoFormationWidthTiles(formation, count);
  const dragWidth = cursor ? Math.hypot(cursor.x - anchor.x, cursor.y - anchor.y) * 2 : autoWidth;
  const widthTiles = clamp(Math.max(autoWidth, dragWidth), minWidthTiles, maxWidthTiles);
  return {
    kind: "formation",
    anchor: { x: anchor.x, y: anchor.y },
    facing,
    widthTiles
  };
};

const resolveLineSlot = (target: FormationTarget, count: number, index: number): FormationProjectionSlot => {
  if (count <= 1) {
    return { index, x: target.anchor.x, y: target.anchor.y };
  }
  const t = index / Math.max(1, count - 1);
  const offset = (t - 0.5) * target.widthTiles;
  const perpendicularX = -target.facing.y;
  const perpendicularY = target.facing.x;
  return {
    index,
    x: target.anchor.x + perpendicularX * offset,
    y: target.anchor.y + perpendicularY * offset
  };
};

const resolveWedgeSlot = (target: FormationTarget, count: number, index: number): FormationProjectionSlot => {
  if (count <= 1 || index === 0) {
    return { index, x: target.anchor.x, y: target.anchor.y };
  }
  const pairIndex = Math.floor((index + 1) / 2);
  const pairCount = Math.max(1, Math.ceil((count - 1) / 2));
  const rank01 = pairIndex / pairCount;
  const side = index % 2 === 0 ? -1 : 1;
  const perpendicularX = -target.facing.y;
  const perpendicularY = target.facing.x;
  const sideOffset = (target.widthTiles * 0.5) * rank01 * side;
  const backOffset = target.widthTiles * 0.55 * rank01;
  return {
    index,
    x: target.anchor.x + perpendicularX * sideOffset - target.facing.x * backOffset,
    y: target.anchor.y + perpendicularY * sideOffset - target.facing.y * backOffset
  };
};

const resolveArcSlot = (target: FormationTarget, count: number, index: number): FormationProjectionSlot => {
  if (count <= 1) {
    return { index, x: target.anchor.x, y: target.anchor.y };
  }
  const radius = Math.max(1, target.widthTiles * 0.5);
  const arcWidth = Math.PI * 0.9;
  const t = index / Math.max(1, count - 1);
  const angle = Math.atan2(target.facing.y, target.facing.x) + (t - 0.5) * arcWidth;
  return {
    index,
    x: target.anchor.x + Math.cos(angle) * radius,
    y: target.anchor.y + Math.sin(angle) * radius
  };
};

export const resolveFormationProjection = (
  target: FormationTarget,
  formation: CommandFormation,
  count: number
): FormationProjection => {
  const safeCount = Math.max(1, Math.floor(count));
  const slots: FormationProjectionSlot[] = [];
  for (let index = 0; index < safeCount; index += 1) {
    if (formation === "wedge") {
      slots.push(resolveWedgeSlot(target, safeCount, index));
    } else if (formation === "arc") {
      slots.push(resolveArcSlot(target, safeCount, index));
    } else {
      slots.push(resolveLineSlot(target, safeCount, index));
    }
  }
  return {
    anchor: target.anchor,
    facing: target.facing,
    widthTiles: target.widthTiles,
    slots
  };
};

export const resolveFormationSlot = (
  target: FormationTarget,
  formation: CommandFormation,
  count: number,
  index: number
): Point => {
  const projection = resolveFormationProjection(target, formation, count);
  const slot = projection.slots[Math.max(0, Math.min(projection.slots.length - 1, index))] ?? projection.slots[0];
  return slot ? { x: Math.round(slot.x), y: Math.round(slot.y) } : { x: target.anchor.x, y: target.anchor.y };
};
