export type RouteMotionPoint = {
  x: number;
  y: number;
};

export type RouteMotionTarget = RouteMotionPoint & {
  index: number;
};

export type AdvanceRouteMotionOptions = {
  x: number;
  y: number;
  movementBudget: number;
  getTarget: (position: RouteMotionPoint) => RouteMotionTarget | null;
  getSegmentSpeedScale?: (target: RouteMotionTarget, position: RouteMotionPoint) => number;
  canEnterTarget?: (target: RouteMotionTarget, position: RouteMotionPoint) => boolean;
  onReachTarget?: (target: RouteMotionTarget, position: RouteMotionPoint) => void;
  epsilon?: number;
  maxTargetsVisited?: number;
};

export type RouteMotionResult = {
  x: number;
  y: number;
  remainingBudget: number;
  targetsReached: number;
  blocked: boolean;
  arrived: boolean;
};

const DEFAULT_EPSILON = 0.0001;
const DEFAULT_MAX_TARGETS_VISITED = 512;

const sanitizePositive = (value: number, fallback: number): number =>
  Number.isFinite(value) && value > 0 ? value : fallback;

export const measureSegmentProgress = (
  from: RouteMotionPoint,
  to: RouteMotionPoint,
  position: RouteMotionPoint,
  epsilon = DEFAULT_EPSILON
): number => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq <= epsilon * epsilon) {
    return 0;
  }
  const progress = ((position.x - from.x) * dx + (position.y - from.y) * dy) / lengthSq;
  return Math.max(0, Math.min(1, progress));
};

export const advanceRouteMotion = (options: AdvanceRouteMotionOptions): RouteMotionResult => {
  let x = Number.isFinite(options.x) ? options.x : 0;
  let y = Number.isFinite(options.y) ? options.y : 0;
  let remainingBudget = Math.max(0, Number.isFinite(options.movementBudget) ? options.movementBudget : 0);
  const epsilon = sanitizePositive(options.epsilon ?? DEFAULT_EPSILON, DEFAULT_EPSILON);
  const maxTargetsVisited = Math.max(
    1,
    Math.floor(sanitizePositive(options.maxTargetsVisited ?? DEFAULT_MAX_TARGETS_VISITED, DEFAULT_MAX_TARGETS_VISITED))
  );
  let targetsReached = 0;
  let blocked = false;
  let arrived = false;

  while (remainingBudget > epsilon && targetsReached < maxTargetsVisited) {
    const position = { x, y };
    const target = options.getTarget(position);
    if (!target) {
      arrived = true;
      break;
    }
    if (options.canEnterTarget && !options.canEnterTarget(target, position)) {
      blocked = true;
      break;
    }
    const dx = target.x - x;
    const dy = target.y - y;
    const distance = Math.hypot(dx, dy);
    if (distance <= epsilon) {
      x = target.x;
      y = target.y;
      options.onReachTarget?.(target, { x, y });
      targetsReached += 1;
      continue;
    }
    const speedScale = sanitizePositive(options.getSegmentSpeedScale?.(target, position) ?? 1, 1);
    const reachableDistance = remainingBudget * speedScale;
    if (reachableDistance + epsilon >= distance) {
      x = target.x;
      y = target.y;
      remainingBudget = Math.max(0, remainingBudget - distance / speedScale);
      options.onReachTarget?.(target, { x, y });
      targetsReached += 1;
      continue;
    }
    const t = reachableDistance / distance;
    x += dx * t;
    y += dy * t;
    remainingBudget = 0;
  }

  if (!blocked && targetsReached < maxTargetsVisited && remainingBudget <= epsilon) {
    arrived = options.getTarget({ x, y }) === null;
  }

  return {
    x,
    y,
    remainingBudget,
    targetsReached,
    blocked,
    arrived
  };
};
