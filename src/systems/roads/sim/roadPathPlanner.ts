export type RoadPathMode = "normal" | "switchback" | "mountainPass";

export type RoadPlannerStepContext = {
  mode: RoadPathMode;
  hasPreviousLandStep: boolean;
  previousDx: number;
  previousDy: number;
  nextDx: number;
  nextDy: number;
  previousSignedGrade: number;
  nextSignedGrade: number;
  previousCrossfall: number;
  nextCrossfall: number;
  stepAngleDeg: number;
  tileAngleDeg: number;
  softAngleDeg: number;
  avoidAngleDeg: number;
  straightClimbPenaltyWeight: number;
  contourTurnReliefWeight: number;
  previousSteepRun: number;
  previousStepsSinceTurn: number;
  previousCumulativeClimb: number;
  previousCumulativeDescent: number;
};

export type RoadPlannerStepScore = {
  costAdjustment: number;
  turnPenaltyMultiplier: number;
  nextSteepRun: number;
  nextStepsSinceTurn: number;
  nextCumulativeClimb: number;
  nextCumulativeDescent: number;
  switchbackTurn: boolean;
  longStraightSteep: boolean;
};

const SWITCHBACK_MIN_TURN_SPACING = 4;
const SWITCHBACK_STEEP_GRADE = 0.04;
const LONG_STRAIGHT_STEEP_RUN = 4;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const sameDirection = (ctx: RoadPlannerStepContext): boolean =>
  ctx.previousDx === ctx.nextDx && ctx.previousDy === ctx.nextDy;

const isTurn = (ctx: RoadPlannerStepContext): boolean =>
  ctx.hasPreviousLandStep && !sameDirection(ctx);

const isSteepStep = (ctx: RoadPlannerStepContext): boolean =>
  Math.max(ctx.stepAngleDeg, ctx.tileAngleDeg) > ctx.softAngleDeg ||
  Math.abs(ctx.nextSignedGrade) >= SWITCHBACK_STEEP_GRADE;

const isSustainedClimb = (ctx: RoadPlannerStepContext): boolean =>
  sameDirection(ctx) &&
  Math.sign(ctx.previousSignedGrade) === Math.sign(ctx.nextSignedGrade) &&
  Math.abs(ctx.nextSignedGrade) > Math.abs(ctx.previousSignedGrade) * 0.72;

const contourRelief = (ctx: RoadPlannerStepContext): number => {
  const previousSeverity = Math.max(Math.abs(ctx.previousSignedGrade), ctx.previousCrossfall);
  const nextSeverity = Math.max(Math.abs(ctx.nextSignedGrade), ctx.nextCrossfall);
  const severityRelief = Math.max(0, previousSeverity - nextSeverity);
  const angleRelief = Math.max(0, Math.max(ctx.stepAngleDeg, ctx.tileAngleDeg) - ctx.softAngleDeg) * 0.026;
  return clamp(severityRelief * 6.2 + angleRelief * ctx.contourTurnReliefWeight, 0, 0.9);
};

export const scoreRoadPlannerStep = (ctx: RoadPlannerStepContext): RoadPlannerStepScore => {
  const steep = isSteepStep(ctx);
  const turn = isTurn(ctx);
  const cumulativeDelta = Math.max(0, ctx.nextSignedGrade);
  const descentDelta = Math.max(0, -ctx.nextSignedGrade);
  const nextCumulativeClimb = ctx.previousCumulativeClimb + cumulativeDelta;
  const nextCumulativeDescent = ctx.previousCumulativeDescent + descentDelta;
  const nextStepsSinceTurn = turn ? 0 : Math.min(32767, ctx.previousStepsSinceTurn + 1);
  const nextSteepRun =
    ctx.hasPreviousLandStep && steep && isSustainedClimb(ctx)
      ? Math.min(32767, ctx.previousSteepRun + 1)
      : steep
        ? 1
        : 0;

  let costAdjustment = 0;
  let turnPenaltyMultiplier = 1;
  let switchbackTurn = false;

  if (steep && isSustainedClimb(ctx)) {
    const angleRatio = clamp(
      (Math.max(ctx.stepAngleDeg, ctx.tileAngleDeg) - ctx.softAngleDeg) /
        Math.max(1e-6, ctx.avoidAngleDeg - ctx.softAngleDeg),
      0,
      2
    );
    const modeMultiplier = ctx.mode === "normal" ? 1.55 : ctx.mode === "switchback" ? 4.8 : 3.1;
    const runMultiplier = 1 + Math.max(0, nextSteepRun - 1) * 0.92;
    costAdjustment += angleRatio * ctx.straightClimbPenaltyWeight * modeMultiplier * runMultiplier;
  }

  if (turn && steep) {
    const spacing = ctx.previousStepsSinceTurn;
    const enoughSpacing = spacing >= SWITCHBACK_MIN_TURN_SPACING;
    const relief = contourRelief(ctx);
    if (ctx.mode === "switchback" || ctx.mode === "mountainPass") {
      if (enoughSpacing && relief > 0.04) {
        switchbackTurn = true;
        turnPenaltyMultiplier = 1 - clamp(0.48 + relief, 0, 0.94);
        costAdjustment -= relief * ctx.contourTurnReliefWeight * 0.82;
      } else if (!enoughSpacing) {
        costAdjustment += (SWITCHBACK_MIN_TURN_SPACING - spacing) * 0.58;
      } else {
        turnPenaltyMultiplier = 1 - relief * 0.45;
      }
    } else {
      turnPenaltyMultiplier = 1 - relief * 0.55;
    }
  }

  return {
    costAdjustment,
    turnPenaltyMultiplier: clamp(turnPenaltyMultiplier, 0.08, 1.35),
    nextSteepRun,
    nextStepsSinceTurn,
    nextCumulativeClimb,
    nextCumulativeDescent,
    switchbackTurn,
    longStraightSteep: nextSteepRun >= LONG_STRAIGHT_STEEP_RUN
  };
};
