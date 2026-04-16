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
  return {
    kind: "area",
    start: { x: target.start.x, y: target.start.y },
    end: { x: target.end.x, y: target.end.y }
  };
};

export const cloneCommandIntent = (intent: CommandIntent): CommandIntent => ({
  type: intent.type,
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
    left.formation === right.formation &&
    left.behaviourMode === right.behaviourMode &&
    commandTargetsEqual(left.target, right.target)
  );
};
