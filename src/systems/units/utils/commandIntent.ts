import type { CommandIntent, CommandTarget } from "../../../core/types.js";

export const cloneCommandTarget = (target: CommandTarget): CommandTarget => {
  if (target.kind === "point") {
    return {
      kind: "point",
      point: { x: target.point.x, y: target.point.y }
    };
  }
  if (target.kind === "line") {
    return {
      kind: "line",
      start: { x: target.start.x, y: target.start.y },
      end: { x: target.end.x, y: target.end.y }
    };
  }
  if (target.kind === "formation") {
    return {
      kind: "formation",
      anchor: { x: target.anchor.x, y: target.anchor.y },
      facing: { x: target.facing.x, y: target.facing.y },
      widthTiles: target.widthTiles
    };
  }
  return {
    kind: "area",
    start: { x: target.start.x, y: target.start.y },
    end: { x: target.end.x, y: target.end.y }
  };
};

export const cloneCommandIntent = (intent: CommandIntent): CommandIntent => ({
  type: intent.type,
  placementMode: intent.placementMode,
  fireTask: intent.fireTask,
  target: cloneCommandTarget(intent.target),
  formation: intent.formation,
  behaviourMode: intent.behaviourMode
});

export const commandTargetsEqual = (left: CommandTarget | null, right: CommandTarget | null): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right || left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "point":
      return right.kind === "point" && left.point.x === right.point.x && left.point.y === right.point.y;
    case "line":
    case "area":
      return (
        right.kind === left.kind &&
        left.start.x === right.start.x &&
        left.start.y === right.start.y &&
        left.end.x === right.end.x &&
        left.end.y === right.end.y
      );
    case "formation":
      return (
        right.kind === "formation" &&
        left.anchor.x === right.anchor.x &&
        left.anchor.y === right.anchor.y &&
        left.facing.x === right.facing.x &&
        left.facing.y === right.facing.y &&
        left.widthTiles === right.widthTiles
      );
  }
};

export const commandIntentsEqual = (left: CommandIntent | null, right: CommandIntent | null): boolean => {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return (
    left.type === right.type &&
    left.placementMode === right.placementMode &&
    left.fireTask === right.fireTask &&
    left.formation === right.formation &&
    left.behaviourMode === right.behaviourMode &&
    commandTargetsEqual(left.target, right.target)
  );
};
