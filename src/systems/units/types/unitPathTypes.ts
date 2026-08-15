import type { Point } from "../../../core/types.js";

export type UnitMovementProfile = "foot" | "vehicle";

export type UnitPathResult = {
  status: "exact" | "nearest" | "none";
  requestedTarget: Point;
  resolvedTarget: Point | null;
  path: Point[];
};

export type UnitRouteResolution = {
  status: "exact" | "nearest";
  requestedTarget: Point;
  resolvedTarget: Point;
};
