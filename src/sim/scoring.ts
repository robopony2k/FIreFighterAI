import type { WorldState } from "../core/state.js";
import type { ApprovalTier, RiskTier, ScoreEventSeverity, ScoringSeasonSummary } from "../core/types.js";
import {
  DAYS_PER_SECOND,
  SCORE_APPROVAL_HOUSE_LOSS_DISAPPROVAL,
  SCORE_APPROVAL_TIERS,
  SCORE_BURNOUT_POINTS_PER_FUEL,
  SCORE_DIFFICULTY_YEAR_MULTIPLIER,
  SCORE_HOUSE_LOSS_PENALTY,
  SCORE_LIFE_LOSS_PENALTY,
  SCORE_RISK_TIERS,
  SCORE_SQUIRT_BONUS_RATE,
  SCORE_STREAK_HOUSE_CAP_DAYS,
  SCORE_STREAK_HOUSE_MAX_BONUS,
  SCORE_STREAK_LIFE_CAP_DAYS,
  SCORE_STREAK_LIFE_MAX_BONUS,
  SCORE_STREAK_TOTAL_CAP,
  SCORE_SUPPRESSION_ASSIST_SECONDS
} from "../core/config.js";
import { clamp } from "../core/utils.js";

const FIRE_EPS = 0.0001;
// Tray timing lives here so UI fade duration stays aligned with score-event TTL.
const DEFAULT_EVENT_TTL_SECONDS = 8;
const NEGATIVE_EVENT_TTL_SECONDS = DEFAULT_EVENT_TTL_SECONDS * 2;
const MAX_EVENT_COUNT = 10;
const APPROVAL_TIER_ORDER: ApprovalTier[] = ["D", "C", "B", "A", "S"];

const getApprovalTierFloor = (tier: ApprovalTier): number => {
  const found = SCORE_APPROVAL_TIERS.find((entry) => entry.tier === tier);
  return found?.minApproval ?? 0;
};

const getTownApprovalWeight = (town: WorldState["towns"][number]): number => {
  const activeHouses = Math.max(0, Number.isFinite(town.houseCount) ? town.houseCount : 0);
  const lostHouses = Math.max(0, Number.isFinite(town.housesLost) ? Math.floor(town.housesLost) : 0);
  return Math.max(1, activeHouses + lostHouses);
};

const ensureScoringBuffers = (state: WorldState): void => {
  const totalTiles = state.grid.totalTiles;
  if (state.scoring.burnStartFuel.length !== totalTiles) {
    state.scoring.burnStartFuel = new Float32Array(totalTiles).fill(-1);
  }
  if (state.scoring.lastSuppressedAt.length !== totalTiles) {
    state.scoring.lastSuppressedAt = new Float32Array(totalTiles).fill(Number.NEGATIVE_INFINITY);
  }
  if (state.fireSnapshot.length !== totalTiles) {
    state.fireSnapshot = new Float32Array(totalTiles);
  }
};

const syncTownLossSnapshotLength = (state: WorldState): void => {
  const currentLength = state.scoring.previousTownHousesLost.length;
  if (currentLength === state.towns.length) {
    return;
  }
  const snapshot = new Int32Array(state.towns.length);
  for (let i = 0; i < snapshot.length; i += 1) {
    const previous = i < currentLength ? state.scoring.previousTownHousesLost[i] : 0;
    const current = Math.max(0, Math.floor(state.towns[i]?.housesLost ?? 0));
    snapshot[i] = Math.max(previous, current);
  }
  state.scoring.previousTownHousesLost = snapshot;
};

const stepScoreEvents = (state: WorldState, stepSeconds: number): void => {
  if (stepSeconds <= 0 || state.scoring.events.length === 0) {
    return;
  }
  for (const event of state.scoring.events) {
    event.remainingSeconds -= stepSeconds;
  }
  state.scoring.events = state.scoring.events.filter((event) => event.remainingSeconds > 0);
};

const pushScoreEvent = (
  state: WorldState,
  message: string,
  severity: ScoreEventSeverity,
  ttlSeconds = DEFAULT_EVENT_TTL_SECONDS
): void => {
  state.scoring.events.push({
    id: state.scoring.nextEventId++,
    message,
    severity,
    remainingSeconds: ttlSeconds
  });
  if (state.scoring.events.length > MAX_EVENT_COUNT) {
    state.scoring.events = state.scoring.events.slice(state.scoring.events.length - MAX_EVENT_COUNT);
  }
};

const formatDeltaPoints = (value: number): string => {
  const abs = Math.round(Math.abs(value)).toLocaleString();
  return `${value >= 0 ? "+" : "-"}${abs}`;
};

const countLostFirefighters = (state: WorldState): number =>
  state.roster.reduce((count, member) => {
    if (member.kind === "firefighter" && member.status === "lost") {
      return count + 1;
    }
    return count;
  }, 0);

const applyTownHouseLossApprovalHit = (state: WorldState): void => {
  syncTownLossSnapshotLength(state);
  for (let i = 0; i < state.towns.length; i += 1) {
    const town = state.towns[i];
    const current = Math.max(0, Math.floor(town.housesLost));
    const previous = state.scoring.previousTownHousesLost[i] ?? 0;
    if (current > previous) {
      const delta = current - previous;
      town.nonApprovingHouseCount += delta * SCORE_APPROVAL_HOUSE_LOSS_DISAPPROVAL;
    }
    state.scoring.previousTownHousesLost[i] = current;
  }
};

const recomputeGlobalApproval = (state: WorldState): void => {
  if (state.towns.length === 0) {
    state.approval = clamp(state.approval, 0, 1);
    state.scoring.approval01 = state.approval;
    return;
  }
  let weightedApproval = 0;
  let totalWeight = 0;
  for (const town of state.towns) {
    const weight = getTownApprovalWeight(town);
    town.nonApprovingHouseCount = clamp(town.nonApprovingHouseCount, 0, weight);
    town.approval = clamp(1 - town.nonApprovingHouseCount / weight, 0, 1);
    weightedApproval += town.approval * weight;
    totalWeight += weight;
  }
  state.approval = totalWeight > 0 ? clamp(weightedApproval / totalWeight, 0, 1) : clamp(state.approval, 0, 1);
  state.scoring.approval01 = state.approval;
};

const applyLossPenalties = (state: WorldState): void => {
  const scoring = state.scoring;

  const currentDestroyedHouses = Math.max(0, Math.floor(state.destroyedHouses));
  const houseDelta = Math.max(0, currentDestroyedHouses - scoring.previousDestroyedHouses);
  scoring.previousDestroyedHouses = currentDestroyedHouses;
  if (houseDelta > 0) {
    const penalty = houseDelta * SCORE_HOUSE_LOSS_PENALTY;
    scoring.lossPenalties += penalty;
    scoring.seasonHouseLossPenalties += penalty;
    scoring.noHouseLossDays = 0;
    scoring.hadHouseLossToday = true;
    pushScoreEvent(
      state,
      `${formatDeltaPoints(-penalty)} HOUSE LOST${houseDelta > 1 ? ` x${houseDelta}` : ""}`,
      "negative",
      NEGATIVE_EVENT_TTL_SECONDS
    );
  }

  const currentLostResidents = Math.max(0, Math.floor(state.lostResidents));
  const residentDelta = Math.max(0, currentLostResidents - scoring.previousLostResidents);
  scoring.previousLostResidents = currentLostResidents;
  if (residentDelta > 0) {
    const penalty = residentDelta * SCORE_LIFE_LOSS_PENALTY;
    scoring.lossPenalties += penalty;
    scoring.seasonCivilianLifeLossPenalties += penalty;
    scoring.noLifeLossDays = 0;
    scoring.hadLifeLossToday = true;
    pushScoreEvent(
      state,
      `${formatDeltaPoints(-penalty)} CIVILIAN LIFE LOST${residentDelta > 1 ? ` x${residentDelta}` : ""}`,
      "negative",
      NEGATIVE_EVENT_TTL_SECONDS
    );
  }

  const currentLostFirefighters = countLostFirefighters(state);
  const firefighterDelta = Math.max(0, currentLostFirefighters - scoring.previousLostFirefighters);
  scoring.previousLostFirefighters = currentLostFirefighters;
  if (firefighterDelta > 0) {
    const penalty = firefighterDelta * SCORE_LIFE_LOSS_PENALTY;
    scoring.lossPenalties += penalty;
    scoring.seasonFirefighterLifeLossPenalties += penalty;
    scoring.noLifeLossDays = 0;
    scoring.hadLifeLossToday = true;
    pushScoreEvent(
      state,
      `${formatDeltaPoints(-penalty)} FIREFIGHTER LOST${firefighterDelta > 1 ? ` x${firefighterDelta}` : ""}`,
      "negative",
      NEGATIVE_EVENT_TTL_SECONDS
    );
  }
};

const applyStreakProgress = (state: WorldState, dayDelta: number): void => {
  const scoring = state.scoring;
  if (dayDelta <= 0) {
    return;
  }
  scoring.dayAccumulator = Math.max(0, scoring.dayAccumulator + dayDelta);
  while (scoring.dayAccumulator >= 1) {
    scoring.dayAccumulator -= 1;
    if (!scoring.hadHouseLossToday) {
      scoring.noHouseLossDays += 1;
    }
    if (!scoring.hadLifeLossToday) {
      scoring.noLifeLossDays += 1;
    }
    scoring.hadHouseLossToday = false;
    scoring.hadLifeLossToday = false;
  }
};

const scoreFireTransitions = (state: WorldState): { burnoutPoints: number; squirtBonusPoints: number } => {
  const scoring = state.scoring;
  let burnoutPoints = 0;
  let squirtBonusPoints = 0;
  const cols = state.grid.cols;
  const rows = state.grid.rows;

  let regionActive = false;
  let minX = cols;
  let maxX = -1;
  let minY = rows;
  let maxY = -1;
  const includeBounds = (active: boolean, left: number, right: number, top: number, bottom: number): void => {
    if (!active) {
      return;
    }
    regionActive = true;
    minX = Math.min(minX, left);
    maxX = Math.max(maxX, right);
    minY = Math.min(minY, top);
    maxY = Math.max(maxY, bottom);
  };

  includeBounds(
    scoring.prevFireBoundsActive,
    scoring.prevFireMinX,
    scoring.prevFireMaxX,
    scoring.prevFireMinY,
    scoring.prevFireMaxY
  );
  includeBounds(state.fireBoundsActive, state.fireMinX, state.fireMaxX, state.fireMinY, state.fireMaxY);

  if (regionActive) {
    const left = clamp(minX, 0, cols - 1);
    const right = clamp(maxX, 0, cols - 1);
    const top = clamp(minY, 0, rows - 1);
    const bottom = clamp(maxY, 0, rows - 1);
    if (left <= right && top <= bottom) {
      const assistWindowDays = Math.max(0, SCORE_SUPPRESSION_ASSIST_SECONDS * DAYS_PER_SECOND);
      for (let y = top; y <= bottom; y += 1) {
        let idx = y * cols + left;
        for (let x = left; x <= right; x += 1, idx += 1) {
          const previousFire = state.fireSnapshot[idx] > FIRE_EPS;
          const currentFireValue = state.tileFire[idx] ?? 0;
          const currentFire = currentFireValue > FIRE_EPS;
          if (!previousFire && currentFire) {
            scoring.burnStartFuel[idx] = Math.max(0, state.tileFuel[idx] ?? 0);
          } else if (previousFire && !currentFire) {
            const fuelNow = Math.max(0, state.tileFuel[idx] ?? 0);
            let startFuel = scoring.burnStartFuel[idx];
            if (!Number.isFinite(startFuel) || startFuel < 0) {
              startFuel = fuelNow;
            }
            const fuelConsumed = Math.max(0, startFuel - fuelNow);
            if (fuelConsumed > 0) {
              const burnout = fuelConsumed * SCORE_BURNOUT_POINTS_PER_FUEL;
              burnoutPoints += burnout;
              if (assistWindowDays > 0 && state.careerDay - scoring.lastSuppressedAt[idx] <= assistWindowDays) {
                squirtBonusPoints += burnout * SCORE_SQUIRT_BONUS_RATE;
              }
            }
            scoring.burnStartFuel[idx] = -1;
            scoring.lastSuppressedAt[idx] = Number.NEGATIVE_INFINITY;
          }
          state.fireSnapshot[idx] = currentFireValue;
        }
      }
    }
  }

  scoring.prevFireBoundsActive = state.fireBoundsActive;
  scoring.prevFireMinX = state.fireMinX;
  scoring.prevFireMaxX = state.fireMaxX;
  scoring.prevFireMinY = state.fireMinY;
  scoring.prevFireMaxY = state.fireMaxY;

  if (burnoutPoints > 0) {
    scoring.grossPoints += burnoutPoints;
    scoring.seasonBurnoutPoints += burnoutPoints;
  }
  if (squirtBonusPoints > 0) {
    scoring.grossPoints += squirtBonusPoints;
    scoring.seasonSquirtBonusPoints += squirtBonusPoints;
  }

  return { burnoutPoints, squirtBonusPoints };
};

const getApprovalTierInfo = (approval01: number): { tier: ApprovalTier; multiplier: number } => {
  for (const entry of SCORE_APPROVAL_TIERS) {
    if (approval01 >= entry.minApproval) {
      return { tier: entry.tier, multiplier: entry.multiplier };
    }
  }
  const fallback = SCORE_APPROVAL_TIERS[SCORE_APPROVAL_TIERS.length - 1];
  return { tier: fallback.tier, multiplier: fallback.multiplier };
};

const getRiskTierInfo = (risk01: number): { tier: RiskTier; multiplier: number } => {
  for (const entry of SCORE_RISK_TIERS) {
    if (risk01 >= entry.minRisk) {
      return { tier: entry.tier, multiplier: entry.multiplier };
    }
  }
  const fallback = SCORE_RISK_TIERS[SCORE_RISK_TIERS.length - 1];
  return { tier: fallback.tier, multiplier: fallback.multiplier };
};

const applyMultiplierUpdate = (state: WorldState, climateRisk: number, emitTierChangeEvents: boolean): void => {
  const scoring = state.scoring;
  const previousApprovalTier = scoring.approvalTier;

  const approval01 = clamp(state.approval, 0, 1);
  const approvalInfo = getApprovalTierInfo(approval01);
  const riskInfo = getRiskTierInfo(clamp(climateRisk, 0, 1));

  const houseRatio =
    SCORE_STREAK_HOUSE_CAP_DAYS > 0
      ? clamp(Math.min(scoring.noHouseLossDays, SCORE_STREAK_HOUSE_CAP_DAYS) / SCORE_STREAK_HOUSE_CAP_DAYS, 0, 1)
      : 1;
  const lifeRatio =
    SCORE_STREAK_LIFE_CAP_DAYS > 0
      ? clamp(Math.min(scoring.noLifeLossDays, SCORE_STREAK_LIFE_CAP_DAYS) / SCORE_STREAK_LIFE_CAP_DAYS, 0, 1)
      : 1;
  const houseStreakMult = 1 + houseRatio * SCORE_STREAK_HOUSE_MAX_BONUS;
  const lifeStreakMult = 1 + lifeRatio * SCORE_STREAK_LIFE_MAX_BONUS;

  scoring.difficultyMult = 1 + Math.max(0, state.year - 1) * SCORE_DIFFICULTY_YEAR_MULTIPLIER;
  scoring.approvalMult = approvalInfo.multiplier;
  scoring.approvalTier = approvalInfo.tier;
  scoring.approval01 = approval01;
  scoring.riskTier = riskInfo.tier;
  scoring.riskMult = riskInfo.multiplier;
  scoring.streakMult = Math.min(SCORE_STREAK_TOTAL_CAP, houseStreakMult * lifeStreakMult);

  if (scoring.approvalTier === "S") {
    scoring.nextApprovalTier = null;
    scoring.nextApprovalThreshold01 = null;
    scoring.nextTierProgress01 = 1;
  } else {
    const currentTierIndex = APPROVAL_TIER_ORDER.indexOf(scoring.approvalTier);
    const nextTier = APPROVAL_TIER_ORDER[currentTierIndex + 1] ?? null;
    const currentFloor = getApprovalTierFloor(scoring.approvalTier);
    const nextFloor = nextTier ? getApprovalTierFloor(nextTier) : 1;
    const span = Math.max(0.0001, nextFloor - currentFloor);
    scoring.nextApprovalTier = nextTier;
    scoring.nextApprovalThreshold01 = nextFloor;
    scoring.nextTierProgress01 = clamp((approval01 - currentFloor) / span, 0, 1);
  }

  if (emitTierChangeEvents && previousApprovalTier !== scoring.approvalTier) {
    pushScoreEvent(state, `Approval Tier: ${previousApprovalTier} -> ${scoring.approvalTier}`, "info", DEFAULT_EVENT_TTL_SECONDS);
  }

  scoring.totalMult = scoring.difficultyMult * scoring.approvalMult * scoring.streakMult * scoring.riskMult;
  scoring.score = (scoring.grossPoints - scoring.lossPenalties) * scoring.totalMult;
  state.careerScore = scoring.score;
};

export const initScoringForRun = (state: WorldState): void => {
  ensureScoringBuffers(state);
  state.scoring.grossPoints = 0;
  state.scoring.lossPenalties = 0;
  state.scoring.score = 0;
  state.scoring.difficultyMult = 1;
  state.scoring.approvalMult = 1;
  state.scoring.streakMult = 1;
  state.scoring.riskMult = 1;
  state.scoring.totalMult = 1;
  state.scoring.approvalTier = "B";
  state.scoring.riskTier = "low";
  state.scoring.approval01 = clamp(state.approval, 0, 1);
  state.scoring.nextApprovalTier = "A";
  state.scoring.nextApprovalThreshold01 = 0.75;
  state.scoring.nextTierProgress01 = 0;
  state.scoring.noHouseLossDays = 0;
  state.scoring.noLifeLossDays = 0;
  state.scoring.dayAccumulator = 0;
  state.scoring.hadHouseLossToday = false;
  state.scoring.hadLifeLossToday = false;
  state.scoring.seasonBurnoutPoints = 0;
  state.scoring.seasonSquirtBonusPoints = 0;
  state.scoring.seasonOtherPositivePoints = 0;
  state.scoring.seasonHouseLossPenalties = 0;
  state.scoring.seasonCivilianLifeLossPenalties = 0;
  state.scoring.seasonFirefighterLifeLossPenalties = 0;
  state.scoring.seasonCriticalAssetLossPenalties = 0;
  state.scoring.seasonStartScore = 0;
  state.scoring.seasonFinalScore = 0;
  state.scoring.seasonApprovalMultIntegral = 0;
  state.scoring.seasonRiskMultIntegral = 0;
  state.scoring.seasonSampleSeconds = 0;
  state.scoring.seasonSummary = null;
  state.scoring.events = [];
  state.scoring.nextEventId = 1;
  state.scoring.previousDestroyedHouses = Math.max(0, Math.floor(state.destroyedHouses));
  state.scoring.previousLostResidents = Math.max(0, Math.floor(state.lostResidents));
  state.scoring.previousLostFirefighters = countLostFirefighters(state);
  state.scoring.previousTownHousesLost = new Int32Array(state.towns.length);
  for (let i = 0; i < state.towns.length; i += 1) {
    state.scoring.previousTownHousesLost[i] = Math.max(0, Math.floor(state.towns[i].housesLost));
  }
  state.scoring.burnStartFuel.fill(-1);
  state.scoring.lastSuppressedAt.fill(Number.NEGATIVE_INFINITY);
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    const fireValue = state.tileFire[i] ?? 0;
    state.fireSnapshot[i] = fireValue;
    if (fireValue > FIRE_EPS) {
      state.scoring.burnStartFuel[i] = Math.max(0, state.tileFuel[i] ?? 0);
    }
  }
  state.scoring.prevFireBoundsActive = state.fireBoundsActive;
  state.scoring.prevFireMinX = state.fireMinX;
  state.scoring.prevFireMaxX = state.fireMaxX;
  state.scoring.prevFireMinY = state.fireMinY;
  state.scoring.prevFireMaxY = state.fireMaxY;

  recomputeGlobalApproval(state);
  applyMultiplierUpdate(state, 0, false);
  state.scoring.seasonStartScore = state.scoring.score;
  state.scoring.seasonFinalScore = state.scoring.score;
  state.finalScore = Math.round(state.scoring.score);
};

export const startScoringSeason = (state: WorldState): void => {
  state.scoring.seasonBurnoutPoints = 0;
  state.scoring.seasonSquirtBonusPoints = 0;
  state.scoring.seasonOtherPositivePoints = 0;
  state.scoring.seasonHouseLossPenalties = 0;
  state.scoring.seasonCivilianLifeLossPenalties = 0;
  state.scoring.seasonFirefighterLifeLossPenalties = 0;
  state.scoring.seasonCriticalAssetLossPenalties = 0;
  state.scoring.seasonApprovalMultIntegral = 0;
  state.scoring.seasonRiskMultIntegral = 0;
  state.scoring.seasonSampleSeconds = 0;
  state.scoring.seasonSummary = null;
  state.scoring.seasonStartScore = state.scoring.score;
  state.scoring.seasonFinalScore = state.scoring.score;
};

export const freezeScoringSeason = (state: WorldState): void => {
  const scoring = state.scoring;
  const totalLosses =
    scoring.seasonHouseLossPenalties +
    scoring.seasonCivilianLifeLossPenalties +
    scoring.seasonFirefighterLifeLossPenalties +
    scoring.seasonCriticalAssetLossPenalties;
  const totalPositives = scoring.seasonBurnoutPoints + scoring.seasonSquirtBonusPoints + scoring.seasonOtherPositivePoints;
  const averageApprovalMult =
    scoring.seasonSampleSeconds > 0 ? scoring.seasonApprovalMultIntegral / scoring.seasonSampleSeconds : scoring.approvalMult;
  const averageRiskMult =
    scoring.seasonSampleSeconds > 0 ? scoring.seasonRiskMultIntegral / scoring.seasonSampleSeconds : scoring.riskMult;
  scoring.seasonFinalScore = scoring.score;
  const summary: ScoringSeasonSummary = {
    burnoutPoints: scoring.seasonBurnoutPoints,
    squirtBonusPoints: scoring.seasonSquirtBonusPoints,
    otherPositivePoints: scoring.seasonOtherPositivePoints,
    houseLossPenalties: scoring.seasonHouseLossPenalties,
    civilianLifeLossPenalties: scoring.seasonCivilianLifeLossPenalties,
    firefighterLifeLossPenalties: scoring.seasonFirefighterLifeLossPenalties,
    criticalAssetLossPenalties: scoring.seasonCriticalAssetLossPenalties,
    netBasePoints: totalPositives - totalLosses,
    seasonStartScore: scoring.seasonStartScore,
    seasonFinalScore: scoring.seasonFinalScore,
    seasonDeltaScore: scoring.seasonFinalScore - scoring.seasonStartScore,
    averageApprovalMult,
    averageRiskMult,
    finalDifficultyMult: scoring.difficultyMult,
    finalApprovalMult: scoring.approvalMult,
    finalStreakMult: scoring.streakMult,
    finalRiskMult: scoring.riskMult,
    finalTotalMult: scoring.totalMult,
    finalApprovalTier: scoring.approvalTier,
    finalRiskTier: scoring.riskTier,
    finalNoHouseLossDays: scoring.noHouseLossDays,
    finalNoLifeLossDays: scoring.noLifeLossDays
  };
  scoring.seasonSummary = summary;
};

export const stepScoring = (state: WorldState, dayDelta: number, climateRisk: number): void => {
  const stepDays = Math.max(0, dayDelta);
  ensureScoringBuffers(state);
  syncTownLossSnapshotLength(state);
  stepScoreEvents(state, stepDays);

  applyTownHouseLossApprovalHit(state);
  applyLossPenalties(state);
  recomputeGlobalApproval(state);

  const { burnoutPoints, squirtBonusPoints } = scoreFireTransitions(state);
  if (burnoutPoints > 0) {
    pushScoreEvent(state, `${formatDeltaPoints(burnoutPoints)} Burnout`, "positive");
  }
  if (squirtBonusPoints > 0) {
    pushScoreEvent(state, `${formatDeltaPoints(squirtBonusPoints)} Squirt Bonus`, "positive");
  }

  applyStreakProgress(state, stepDays);
  applyMultiplierUpdate(state, climateRisk, true);

  if (stepDays > 0) {
    state.scoring.seasonApprovalMultIntegral += state.scoring.approvalMult * stepDays;
    state.scoring.seasonRiskMultIntegral += state.scoring.riskMult * stepDays;
    state.scoring.seasonSampleSeconds += stepDays;
  }
  state.scoring.seasonFinalScore = state.scoring.score;
};
