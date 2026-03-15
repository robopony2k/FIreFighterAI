import type { WorldState } from "../core/state.js";
import type { ApprovalTier, RiskTier, ScoreEventLane, ScoreEventSeverity, ScoringSeasonSummary } from "../core/types.js";
import {
  DAYS_PER_SECOND,
  SCORE_APPROVAL_HOUSE_LOSS_DISAPPROVAL,
  SCORE_APPROVAL_TIERS,
  SCORE_DIFFICULTY_YEAR_MULTIPLIER,
  SCORE_EXTINGUISHED_TILE_POINTS,
  SCORE_HOUSE_LOSS_PENALTY,
  SCORE_LIFE_LOSS_PENALTY,
  SCORE_RISK_TIERS,
  SCORE_STREAK_HOUSE_CAP_DAYS,
  SCORE_STREAK_HOUSE_MAX_BONUS,
  SCORE_STREAK_LIFE_CAP_DAYS,
  SCORE_STREAK_LIFE_MAX_BONUS,
  SCORE_STREAK_TOTAL_CAP,
  SCORE_SUPPRESSION_ASSIST_SECONDS
} from "../core/config.js";
import { clamp } from "../core/utils.js";

const FIRE_EPS = 0.0001;
const DEFAULT_EVENT_TTL_SECONDS = 1.1;
const NEGATIVE_EVENT_TTL_SECONDS = 1.6;
const MAX_EVENT_COUNT = 12;
const APPROVAL_TIER_ORDER: ApprovalTier[] = ["D", "C", "B", "A", "S"];

type LaneDelta = {
  lane: ScoreEventLane;
  deltaCount: number;
  deltaPoints: number;
  severity: ScoreEventSeverity;
  ttlSeconds?: number;
  detail?: string;
};

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
  lane: ScoreEventLane,
  deltaCount: number,
  deltaPoints: number,
  severity: ScoreEventSeverity,
  ttlSeconds = DEFAULT_EVENT_TTL_SECONDS,
  detail?: string
): void => {
  state.scoring.events.push({
    id: state.scoring.nextEventId++,
    lane,
    deltaCount,
    deltaPoints,
    severity,
    remainingSeconds: ttlSeconds,
    detail
  });
  if (state.scoring.events.length > MAX_EVENT_COUNT) {
    state.scoring.events = state.scoring.events.slice(state.scoring.events.length - MAX_EVENT_COUNT);
  }
};

const countLostFirefighters = (state: WorldState): number =>
  state.roster.reduce((count, member) => {
    if (member.kind === "firefighter" && member.status === "lost") {
      return count + 1;
    }
    return count;
  }, 0);

const buildDetail = (parts: string[]): string | undefined => {
  if (parts.length === 0) {
    return undefined;
  }
  return parts.join(" | ");
};

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

const applyLossPenalties = (state: WorldState): LaneDelta[] => {
  const scoring = state.scoring;
  const deltas: LaneDelta[] = [];

  const currentDestroyedHouses = Math.max(0, Math.floor(state.destroyedHouses));
  const houseDelta = Math.max(0, currentDestroyedHouses - scoring.previousDestroyedHouses);
  scoring.previousDestroyedHouses = currentDestroyedHouses;
  if (houseDelta > 0) {
    const penalty = houseDelta * SCORE_HOUSE_LOSS_PENALTY;
    scoring.lossPenalties += penalty;
    scoring.seasonPropertyDamageCount += houseDelta;
    scoring.seasonPropertyDamagePenalties += penalty;
    scoring.seasonDestroyedHouseCount += houseDelta;
    scoring.seasonHouseLossPenalties += penalty;
    scoring.noHouseLossDays = 0;
    scoring.hadHouseLossToday = true;
    deltas.push({
      lane: "property",
      deltaCount: houseDelta,
      deltaPoints: -penalty,
      severity: "negative",
      ttlSeconds: NEGATIVE_EVENT_TTL_SECONDS,
      detail: buildDetail([`${houseDelta} house${houseDelta === 1 ? "" : "s"}`])
    });
  }

  const currentLostResidents = Math.max(0, Math.floor(state.lostResidents));
  const residentDelta = Math.max(0, currentLostResidents - scoring.previousLostResidents);
  scoring.previousLostResidents = currentLostResidents;
  if (residentDelta > 0) {
    const penalty = residentDelta * SCORE_LIFE_LOSS_PENALTY;
    scoring.lossPenalties += penalty;
    scoring.seasonLivesLostCount += residentDelta;
    scoring.seasonCivilianLivesLost += residentDelta;
    scoring.seasonLifeLossPenalties += penalty;
    scoring.seasonCivilianLifeLossPenalties += penalty;
    scoring.noLifeLossDays = 0;
    scoring.hadLifeLossToday = true;
    deltas.push({
      lane: "lives",
      deltaCount: residentDelta,
      deltaPoints: -penalty,
      severity: "negative",
      ttlSeconds: NEGATIVE_EVENT_TTL_SECONDS,
      detail: buildDetail([`${residentDelta} civilian${residentDelta === 1 ? "" : "s"}`])
    });
  }

  const currentLostFirefighters = countLostFirefighters(state);
  const firefighterDelta = Math.max(0, currentLostFirefighters - scoring.previousLostFirefighters);
  scoring.previousLostFirefighters = currentLostFirefighters;
  if (firefighterDelta > 0) {
    const penalty = firefighterDelta * SCORE_LIFE_LOSS_PENALTY;
    scoring.lossPenalties += penalty;
    scoring.seasonLivesLostCount += firefighterDelta;
    scoring.seasonFirefighterLivesLost += firefighterDelta;
    scoring.seasonLifeLossPenalties += penalty;
    scoring.seasonFirefighterLifeLossPenalties += penalty;
    scoring.noLifeLossDays = 0;
    scoring.hadLifeLossToday = true;
    deltas.push({
      lane: "lives",
      deltaCount: firefighterDelta,
      deltaPoints: -penalty,
      severity: "negative",
      ttlSeconds: NEGATIVE_EVENT_TTL_SECONDS,
      detail: buildDetail([`${firefighterDelta} firefighter${firefighterDelta === 1 ? "" : "s"}`])
    });
  }

  if (deltas.length === 0) {
    return deltas;
  }

  const propertyDelta = deltas.filter((entry) => entry.lane === "property");
  const livesDelta = deltas.filter((entry) => entry.lane === "lives");
  const merged: LaneDelta[] = [];
  if (propertyDelta.length > 0) {
    merged.push({
      lane: "property",
      deltaCount: propertyDelta.reduce((sum, entry) => sum + entry.deltaCount, 0),
      deltaPoints: propertyDelta.reduce((sum, entry) => sum + entry.deltaPoints, 0),
      severity: "negative",
      ttlSeconds: NEGATIVE_EVENT_TTL_SECONDS,
      detail: buildDetail(propertyDelta.flatMap((entry) => (entry.detail ? [entry.detail] : [])))
    });
  }
  if (livesDelta.length > 0) {
    merged.push({
      lane: "lives",
      deltaCount: livesDelta.reduce((sum, entry) => sum + entry.deltaCount, 0),
      deltaPoints: livesDelta.reduce((sum, entry) => sum + entry.deltaPoints, 0),
      severity: "negative",
      ttlSeconds: NEGATIVE_EVENT_TTL_SECONDS,
      detail: buildDetail(livesDelta.flatMap((entry) => (entry.detail ? [entry.detail] : [])))
    });
  }
  return merged;
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

const scoreExtinguishTransitions = (state: WorldState): LaneDelta | null => {
  const scoring = state.scoring;
  let extinguishCount = 0;
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
          if (previousFire && !currentFire) {
            const assisted =
              assistWindowDays > 0 && state.careerDay - scoring.lastSuppressedAt[idx] <= assistWindowDays;
            if (assisted) {
              extinguishCount += 1;
            }
            scoring.lastSuppressedAt[idx] = Number.NEGATIVE_INFINITY;
            scoring.burnStartFuel[idx] = -1;
          } else if (!previousFire && currentFire) {
            scoring.burnStartFuel[idx] = Math.max(0, state.tileFuel[idx] ?? 0);
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

  if (extinguishCount <= 0) {
    return null;
  }

  const points = extinguishCount * SCORE_EXTINGUISHED_TILE_POINTS;
  scoring.grossPoints += points;
  scoring.seasonExtinguishedCount += extinguishCount;
  scoring.seasonExtinguishPoints += points;
  return {
    lane: "extinguished",
    deltaCount: extinguishCount,
    deltaPoints: points,
    severity: "positive",
    ttlSeconds: DEFAULT_EVENT_TTL_SECONDS,
    detail: `${extinguishCount} assisted tile${extinguishCount === 1 ? "" : "s"}`
  };
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

const applyMultiplierUpdate = (state: WorldState, climateRisk: number): void => {
  const scoring = state.scoring;
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

  scoring.totalMult = scoring.difficultyMult * scoring.approvalMult * scoring.streakMult * scoring.riskMult;
  scoring.seasonMultipliedPositivePoints = scoring.grossPoints * scoring.totalMult;
  scoring.score = scoring.seasonStartScore + scoring.seasonMultipliedPositivePoints - scoring.lossPenalties;
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
  state.scoring.seasonExtinguishedCount = 0;
  state.scoring.seasonExtinguishPoints = 0;
  state.scoring.seasonPropertyDamageCount = 0;
  state.scoring.seasonPropertyDamagePenalties = 0;
  state.scoring.seasonDestroyedHouseCount = 0;
  state.scoring.seasonCriticalAssetLossCount = 0;
  state.scoring.seasonHouseLossPenalties = 0;
  state.scoring.seasonCriticalAssetLossPenalties = 0;
  state.scoring.seasonLivesLostCount = 0;
  state.scoring.seasonCivilianLivesLost = 0;
  state.scoring.seasonFirefighterLivesLost = 0;
  state.scoring.seasonLifeLossPenalties = 0;
  state.scoring.seasonCivilianLifeLossPenalties = 0;
  state.scoring.seasonFirefighterLifeLossPenalties = 0;
  state.scoring.seasonMultipliedPositivePoints = 0;
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
    state.fireSnapshot[i] = state.tileFire[i] ?? 0;
  }
  state.scoring.prevFireBoundsActive = state.fireBoundsActive;
  state.scoring.prevFireMinX = state.fireMinX;
  state.scoring.prevFireMaxX = state.fireMaxX;
  state.scoring.prevFireMinY = state.fireMinY;
  state.scoring.prevFireMaxY = state.fireMaxY;

  recomputeGlobalApproval(state);
  applyMultiplierUpdate(state, 0);
  state.scoring.seasonStartScore = state.scoring.score;
  state.scoring.seasonFinalScore = state.scoring.score;
  state.finalScore = Math.round(state.scoring.score);
};

export const startScoringSeason = (state: WorldState): void => {
  state.scoring.grossPoints = 0;
  state.scoring.lossPenalties = 0;
  state.scoring.seasonExtinguishedCount = 0;
  state.scoring.seasonExtinguishPoints = 0;
  state.scoring.seasonPropertyDamageCount = 0;
  state.scoring.seasonPropertyDamagePenalties = 0;
  state.scoring.seasonDestroyedHouseCount = 0;
  state.scoring.seasonCriticalAssetLossCount = 0;
  state.scoring.seasonHouseLossPenalties = 0;
  state.scoring.seasonCriticalAssetLossPenalties = 0;
  state.scoring.seasonLivesLostCount = 0;
  state.scoring.seasonCivilianLivesLost = 0;
  state.scoring.seasonFirefighterLivesLost = 0;
  state.scoring.seasonLifeLossPenalties = 0;
  state.scoring.seasonCivilianLifeLossPenalties = 0;
  state.scoring.seasonFirefighterLifeLossPenalties = 0;
  state.scoring.seasonMultipliedPositivePoints = 0;
  state.scoring.seasonApprovalMultIntegral = 0;
  state.scoring.seasonRiskMultIntegral = 0;
  state.scoring.seasonSampleSeconds = 0;
  state.scoring.seasonSummary = null;
  state.scoring.events = [];
  state.scoring.seasonStartScore = state.scoring.score;
  state.scoring.seasonFinalScore = state.scoring.score;
};

export const freezeScoringSeason = (state: WorldState): void => {
  const scoring = state.scoring;
  const propertyDamagePenalties = scoring.seasonHouseLossPenalties + scoring.seasonCriticalAssetLossPenalties;
  const lifeLossPenalties = scoring.seasonCivilianLifeLossPenalties + scoring.seasonFirefighterLifeLossPenalties;
  const positiveBasePoints = scoring.seasonExtinguishPoints;
  const averageApprovalMult =
    scoring.seasonSampleSeconds > 0 ? scoring.seasonApprovalMultIntegral / scoring.seasonSampleSeconds : scoring.approvalMult;
  const averageRiskMult =
    scoring.seasonSampleSeconds > 0 ? scoring.seasonRiskMultIntegral / scoring.seasonSampleSeconds : scoring.riskMult;
  scoring.seasonMultipliedPositivePoints = positiveBasePoints * scoring.totalMult;
  scoring.seasonFinalScore = scoring.seasonStartScore + scoring.seasonMultipliedPositivePoints - propertyDamagePenalties - lifeLossPenalties;
  scoring.score = scoring.seasonFinalScore;
  state.careerScore = scoring.score;
  const summary: ScoringSeasonSummary = {
    extinguishedCount: scoring.seasonExtinguishedCount,
    extinguishPoints: scoring.seasonExtinguishPoints,
    propertyDamageCount: scoring.seasonPropertyDamageCount,
    propertyDamagePenalties,
    destroyedHouseCount: scoring.seasonDestroyedHouseCount,
    criticalAssetLossCount: scoring.seasonCriticalAssetLossCount,
    houseLossPenalties: scoring.seasonHouseLossPenalties,
    criticalAssetLossPenalties: scoring.seasonCriticalAssetLossPenalties,
    livesLostCount: scoring.seasonLivesLostCount,
    civilianLivesLost: scoring.seasonCivilianLivesLost,
    firefighterLivesLost: scoring.seasonFirefighterLivesLost,
    lifeLossPenalties,
    civilianLifeLossPenalties: scoring.seasonCivilianLifeLossPenalties,
    firefighterLifeLossPenalties: scoring.seasonFirefighterLifeLossPenalties,
    positiveBasePoints,
    multipliedPositivePoints: scoring.seasonMultipliedPositivePoints,
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
  state.finalScore = Math.round(state.scoring.score);
};

export const stepScoring = (state: WorldState, dayDelta: number, climateRisk: number): void => {
  const stepDays = Math.max(0, dayDelta);
  ensureScoringBuffers(state);
  syncTownLossSnapshotLength(state);
  stepScoreEvents(state, stepDays);

  applyTownHouseLossApprovalHit(state);
  const lossDeltas = applyLossPenalties(state);
  recomputeGlobalApproval(state);

  const extinguishDelta = scoreExtinguishTransitions(state);
  if (extinguishDelta) {
    pushScoreEvent(
      state,
      extinguishDelta.lane,
      extinguishDelta.deltaCount,
      extinguishDelta.deltaPoints,
      extinguishDelta.severity,
      extinguishDelta.ttlSeconds,
      extinguishDelta.detail
    );
  }
  for (const delta of lossDeltas) {
    pushScoreEvent(state, delta.lane, delta.deltaCount, delta.deltaPoints, delta.severity, delta.ttlSeconds, delta.detail);
  }

  applyStreakProgress(state, stepDays);
  applyMultiplierUpdate(state, climateRisk);

  if (stepDays > 0) {
    state.scoring.seasonApprovalMultIntegral += state.scoring.approvalMult * stepDays;
    state.scoring.seasonRiskMultIntegral += state.scoring.riskMult * stepDays;
    state.scoring.seasonSampleSeconds += stepDays;
  }
  state.scoring.seasonFinalScore = state.scoring.score;
};
