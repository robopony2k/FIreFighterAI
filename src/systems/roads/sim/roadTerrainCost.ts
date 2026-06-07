import type { RoadPathPlannerNodeState } from "../types/roadPathPlannerTypes.js";

export const createInitialRoadPathPlannerNodeState = (): RoadPathPlannerNodeState => ({
  waterTilesUsed: 0,
  consecutiveWater: 0,
  stepDx: 0,
  stepDy: 0,
  signedGrade: 0,
  crossfall: 0,
  steepRun: 0,
  stepsSinceTurn: 32767,
  turnDirection: 0,
  stepsSinceTurnDirectionChange: 32767,
  lateralLegLength: 0,
  stepsSinceHairpinDiscount: 32767,
  hairpinSteepStepRun: 0,
  cumulativeClimb: 0,
  cumulativeDescent: 0,
  switchbackTurns: 0,
  hairpinGradeDiscounts: 0,
  longStraightSteepSegments: 0
});

export const cloneRoadPathPlannerNodeState = (
  state: RoadPathPlannerNodeState
): RoadPathPlannerNodeState => ({ ...state });

export const buildRoadStreamerJoinOffsets = (radius: number): Array<{ dx: number; dy: number }> => {
  const offsets: Array<{ dx: number; dy: number }> = [{ dx: 0, dy: 0 }];
  const max = Math.max(0, Math.floor(radius));
  for (let dist = 1; dist <= max; dist += 1) {
    for (let dy = -dist; dy <= dist; dy += 1) {
      for (let dx = -dist; dx <= dist; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== dist) {
          continue;
        }
        offsets.push({ dx, dy });
      }
    }
  }
  return offsets;
};

export const getRoadStreamerJoinRadiusForMode = (mode: string): number =>
  mode === "mountainPass" ? 4 : mode === "switchback" ? 3 : 2;
