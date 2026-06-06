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
  previousTurnDirection: number;
  previousStepsSinceTurnDirectionChange: number;
  previousLateralLegLength: number;
  previousStepsSinceHairpinDiscount: number;
  previousHairpinSteepStepRun: number;
  previousCumulativeClimb: number;
  previousCumulativeDescent: number;
  localPlatformCrossfall: number;
  localPlatformAngleDeg: number;
  riverDistance: number;
  riverBlockDistance: number;
};

export type RoadPlannerStepScore = {
  costAdjustment: number;
  gradePenaltyMultiplier: number;
  turnPenaltyMultiplier: number;
  nextSteepRun: number;
  nextStepsSinceTurn: number;
  nextTurnDirection: number;
  nextStepsSinceTurnDirectionChange: number;
  nextLateralLegLength: number;
  nextStepsSinceHairpinDiscount: number;
  nextHairpinSteepStepRun: number;
  nextCumulativeClimb: number;
  nextCumulativeDescent: number;
  switchbackTurn: boolean;
  hairpinGradeDiscount: boolean;
  longStraightSteep: boolean;
};

const SWITCHBACK_MIN_TURN_SPACING = 6;
const SWITCHBACK_STEEP_GRADE = 0.04;
const LONG_STRAIGHT_STEEP_RUN = 4;
const HAIRPIN_GRADE_MULTIPLIER = 0.5;
const HAIRPIN_MIN_LATERAL_LEG_LENGTH = 6;
const HAIRPIN_MIN_DISCOUNT_SPACING = 8;
const HAIRPIN_MAX_STEEP_STEP_RUN = 2;
const HAIRPIN_MIN_TURN_DEG = 70;
const HAIRPIN_PREFERRED_TURN_DEG = 90;
const HAIRPIN_ACTIVATION_ANGLE_DEG = 16;
const HAIRPIN_MAX_PLATFORM_CROSSFALL = 0.22;
const HAIRPIN_MAX_PLATFORM_ANGLE_OVER_AVOID_DEG = 4;

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

const directionTurnDeg = (ctx: RoadPlannerStepContext): number => {
  if (!isTurn(ctx)) {
    return 0;
  }
  const previousLength = Math.hypot(ctx.previousDx, ctx.previousDy);
  const nextLength = Math.hypot(ctx.nextDx, ctx.nextDy);
  if (previousLength <= 0 || nextLength <= 0) {
    return 0;
  }
  const dot = ctx.previousDx * ctx.nextDx + ctx.previousDy * ctx.nextDy;
  return (Math.acos(clamp(dot / (previousLength * nextLength), -1, 1)) * 180) / Math.PI;
};

const directionTurnSign = (ctx: RoadPlannerStepContext): number => {
  if (!isTurn(ctx)) {
    return 0;
  }
  const cross = ctx.previousDx * ctx.nextDy - ctx.previousDy * ctx.nextDx;
  return cross < 0 ? -1 : cross > 0 ? 1 : 0;
};

const hasGradeTrendRelief = (ctx: RoadPlannerStepContext): boolean => {
  const previousGrade = Math.abs(ctx.previousSignedGrade);
  const nextGrade = Math.abs(ctx.nextSignedGrade);
  if (previousGrade <= 1e-6) {
    return nextGrade <= SWITCHBACK_STEEP_GRADE * 2.25;
  }
  if (Math.sign(ctx.previousSignedGrade) !== Math.sign(ctx.nextSignedGrade)) {
    return true;
  }
  if (nextGrade <= previousGrade * 1.15) {
    return true;
  }
  const climbBias = ctx.previousCumulativeClimb - ctx.previousCumulativeDescent;
  return (
    (climbBias > 0 && ctx.nextSignedGrade <= ctx.previousSignedGrade) ||
    (climbBias < 0 && ctx.nextSignedGrade >= ctx.previousSignedGrade)
  );
};

const computeHairpinGradeMultiplier = (ctx: RoadPlannerStepContext): number => {
  const crossfallRatio = clamp(ctx.localPlatformCrossfall / Math.max(1e-6, HAIRPIN_MAX_PLATFORM_CROSSFALL), 0, 1);
  const angleLimit = ctx.avoidAngleDeg + HAIRPIN_MAX_PLATFORM_ANGLE_OVER_AVOID_DEG;
  const angleRatio = clamp(
    (ctx.localPlatformAngleDeg - ctx.softAngleDeg) / Math.max(1e-6, angleLimit - ctx.softAngleDeg),
    0,
    1
  );
  return clamp(HAIRPIN_GRADE_MULTIPLIER + (crossfallRatio * 0.07 + angleRatio * 0.03), 0.35, 0.6);
};

const isHairpinGradeDiscountEligible = (ctx: RoadPlannerStepContext, steep: boolean, turn: boolean): boolean => {
  if (ctx.mode !== "switchback" && ctx.mode !== "mountainPass") {
    return false;
  }
  if (!ctx.hasPreviousLandStep || !steep || !turn) {
    return false;
  }
  const terrainAngle = Math.max(ctx.stepAngleDeg, ctx.tileAngleDeg);
  const terrainActive =
    terrainAngle >= Math.max(HAIRPIN_ACTIVATION_ANGLE_DEG, ctx.softAngleDeg) ||
    Math.abs(ctx.nextSignedGrade) >= SWITCHBACK_STEEP_GRADE;
  const enoughTurnSpacing = ctx.previousStepsSinceTurn >= SWITCHBACK_MIN_TURN_SPACING;
  const enoughLateralLeg = ctx.previousLateralLegLength >= HAIRPIN_MIN_LATERAL_LEG_LENGTH;
  const enoughDiscountSpacing = ctx.previousStepsSinceHairpinDiscount >= HAIRPIN_MIN_DISCOUNT_SPACING;
  const substantialTurn = directionTurnDeg(ctx) >= HAIRPIN_MIN_TURN_DEG;
  const trendRelief = hasGradeTrendRelief(ctx);
  const shortSteepRun = ctx.previousHairpinSteepStepRun < HAIRPIN_MAX_STEEP_STEP_RUN;
  const stablePlatform =
    ctx.localPlatformCrossfall <= HAIRPIN_MAX_PLATFORM_CROSSFALL &&
    ctx.localPlatformAngleDeg <= ctx.avoidAngleDeg + HAIRPIN_MAX_PLATFORM_ANGLE_OVER_AVOID_DEG;
  const awayFromWaterCut = ctx.riverDistance > Math.max(1, ctx.riverBlockDistance);

  if (!terrainActive || !substantialTurn || !stablePlatform || !awayFromWaterCut) {
    return false;
  }
  const matchedContext =
    Number(enoughTurnSpacing) +
    Number(enoughLateralLeg) +
    Number(enoughDiscountSpacing) +
    Number(trendRelief) +
    Number(shortSteepRun);
  return matchedContext >= 4;
};

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
  const turnSign = directionTurnSign(ctx);
  const turnDirectionChanged =
    turn && turnSign !== 0 && ctx.previousTurnDirection !== 0 && turnSign !== ctx.previousTurnDirection;
  const nextTurnDirection = turn && turnSign !== 0 ? turnSign : ctx.previousTurnDirection;
  const nextStepsSinceTurnDirectionChange = turnDirectionChanged
    ? 0
    : Math.min(32767, ctx.previousStepsSinceTurnDirectionChange + 1);
  const hairpinGradeDiscount = isHairpinGradeDiscountEligible(ctx, steep, turn);
  const nextLateralLegLength = hairpinGradeDiscount
    ? 0
    : turn
      ? 0
      : Math.min(32767, ctx.previousLateralLegLength + 1);
  const nextStepsSinceHairpinDiscount = hairpinGradeDiscount
    ? 0
    : Math.min(32767, ctx.previousStepsSinceHairpinDiscount + 1);
  const nextHairpinSteepStepRun = steep
    ? Math.min(32767, ctx.previousHairpinSteepStepRun + (hairpinGradeDiscount ? 1 : 0))
    : 0;
  const nextSteepRun =
    ctx.hasPreviousLandStep && steep && isSustainedClimb(ctx)
      ? Math.min(32767, ctx.previousSteepRun + 1)
      : steep
        ? 1
        : 0;

  let costAdjustment = 0;
  const gradePenaltyMultiplier = hairpinGradeDiscount ? computeHairpinGradeMultiplier(ctx) : 1;
  let turnPenaltyMultiplier = 1;
  let switchbackTurn = false;

  if (steep && isSustainedClimb(ctx)) {
    const angleRatio = clamp(
      (Math.max(ctx.stepAngleDeg, ctx.tileAngleDeg) - ctx.softAngleDeg) /
        Math.max(1e-6, ctx.avoidAngleDeg - ctx.softAngleDeg),
      0,
      2
    );
    const gradeRatio = clamp(Math.abs(ctx.nextSignedGrade) / Math.max(1e-6, SWITCHBACK_STEEP_GRADE * 3), 0, 2);
    const severityRatio = Math.max(angleRatio, gradeRatio);
    const modeMultiplier = ctx.mode === "normal" ? 1.55 : ctx.mode === "switchback" ? 4.8 : 3.1;
    const runMultiplier = 1 + Math.max(0, nextSteepRun - 1) * 0.92;
    costAdjustment += severityRatio * ctx.straightClimbPenaltyWeight * modeMultiplier * runMultiplier;
  }

  if (turn && steep) {
    const spacing = ctx.previousStepsSinceTurn;
    const enoughSpacing = spacing >= SWITCHBACK_MIN_TURN_SPACING;
    const relief = contourRelief(ctx);
    const turnDeg = directionTurnDeg(ctx);
    if (ctx.mode === "switchback" || ctx.mode === "mountainPass") {
      if (turnDeg < HAIRPIN_PREFERRED_TURN_DEG) {
        const stairStepRatio = (HAIRPIN_PREFERRED_TURN_DEG - turnDeg) / HAIRPIN_PREFERRED_TURN_DEG;
        costAdjustment += stairStepRatio * (ctx.mode === "switchback" ? 3.5 : 1.6);
      }
      if (turnDirectionChanged && ctx.previousStepsSinceTurnDirectionChange < 5) {
        costAdjustment += (5 - ctx.previousStepsSinceTurnDirectionChange) * (ctx.mode === "switchback" ? 1.45 : 0.75);
      }
      if (enoughSpacing && relief > 0.04) {
        switchbackTurn = true;
        turnPenaltyMultiplier = 1 - clamp(0.34 + relief * 0.78, 0, 0.86);
        costAdjustment -= relief * ctx.contourTurnReliefWeight * 0.62;
      } else if (!enoughSpacing) {
        costAdjustment += (SWITCHBACK_MIN_TURN_SPACING - spacing) * 1.55;
      } else {
        turnPenaltyMultiplier = 1 - relief * 0.45;
      }
    } else {
      turnPenaltyMultiplier = 1 - relief * 0.55;
    }
  }

  return {
    costAdjustment,
    gradePenaltyMultiplier,
    turnPenaltyMultiplier: clamp(turnPenaltyMultiplier, 0.08, 1.35),
    nextSteepRun,
    nextStepsSinceTurn,
    nextTurnDirection,
    nextStepsSinceTurnDirectionChange,
    nextLateralLegLength,
    nextStepsSinceHairpinDiscount,
    nextHairpinSteepStepRun,
    nextCumulativeClimb,
    nextCumulativeDescent,
    switchbackTurn,
    hairpinGradeDiscount,
    longStraightSteep: nextSteepRun >= LONG_STRAIGHT_STEEP_RUN
  };
};
