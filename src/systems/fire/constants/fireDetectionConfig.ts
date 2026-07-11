import type { WatchTowerLevel } from "../../../core/types.js";

export type WatchTowerLevelTuning = {
  level: WatchTowerLevel;
  detectionRadius: number;
  detectionDelayDays: number;
  accuracyRadius: number;
  smokeSensitivity: number;
  buildCost: number;
  upgradeCost: number;
};

export const WATCH_TOWER_TYPE_ID = "town-watch-tower" as const;

export const WATCH_TOWER_LEVEL_TUNING: Record<WatchTowerLevel, WatchTowerLevelTuning> = {
  1: {
    level: 1,
    detectionRadius: 18,
    detectionDelayDays: 0.18,
    accuracyRadius: 7,
    smokeSensitivity: 0.82,
    buildCost: 420,
    upgradeCost: 0
  },
  2: {
    level: 2,
    detectionRadius: 28,
    detectionDelayDays: 0.1,
    accuracyRadius: 5,
    smokeSensitivity: 1,
    buildCost: 0,
    upgradeCost: 680
  },
  3: {
    level: 3,
    detectionRadius: 38,
    detectionDelayDays: 0.05,
    accuracyRadius: 3,
    smokeSensitivity: 1.24,
    buildCost: 0,
    upgradeCost: 1360
  },
  4: { level: 4, detectionRadius: 48, detectionDelayDays: 0.035, accuracyRadius: 2.5, smokeSensitivity: 1.36, buildCost: 0, upgradeCost: 2720 },
  5: { level: 5, detectionRadius: 58, detectionDelayDays: 0.028, accuracyRadius: 2.1, smokeSensitivity: 1.46, buildCost: 0, upgradeCost: 5440 },
  6: { level: 6, detectionRadius: 68, detectionDelayDays: 0.023, accuracyRadius: 1.8, smokeSensitivity: 1.54, buildCost: 0, upgradeCost: 10880 },
  7: { level: 7, detectionRadius: 78, detectionDelayDays: 0.02, accuracyRadius: 1.6, smokeSensitivity: 1.6, buildCost: 0, upgradeCost: 21760 },
  8: { level: 8, detectionRadius: 88, detectionDelayDays: 0.018, accuracyRadius: 1.5, smokeSensitivity: 1.65, buildCost: 0, upgradeCost: 43520 }
};

export const WATCH_TOWER_MAX_LEVEL: WatchTowerLevel = 8;
export const WATCH_TOWER_PLACEMENT_CONFIG = {
  townServiceRadius: 32,
  roadGraceTiles: 2,
  accessCostPerTile: 0.05,
  maxAccessCostMultiplier: 2,
  elevationBonusPer10Meters: 0.01,
  maxElevationBonus: 0.5,
  maxFootprintElevationDelta: 0.12,
  maxFootprintGrade: 0.18,
  constructionDaysPerLevel: 90
} as const;

export const FIRE_DETECTION_CONFIG = {
  minActiveFire: 0.02,
  minHeat01: 0.08,
  suspectedConfidence: 0.22,
  alertConfidence: 0.38,
  confirmedConfidence: 0.7,
  staleReportDays: 1.25,
  reportMergeRadius: 10,
  townRevealBuffer: 5,
  unitRevealRadius: 8,
  roadAssetRevealRadius: 3,
  smokeRevealTileCount: 18,
  smokeRevealScore: 14,
  fallbackConfidence: {
    town: 0.76,
    unit: 0.82,
    roadAsset: 0.62,
    smoke: 0.5
  },
  towerBaseConfidence: 0.34,
  towerPersistenceConfidencePerDay: 0.26,
  towerOverlapConfidence: 0.12,
  growthConfidenceScale: 0.025
} as const;

export const getWatchTowerLevelTuning = (level: WatchTowerLevel): WatchTowerLevelTuning =>
  WATCH_TOWER_LEVEL_TUNING[level] ?? WATCH_TOWER_LEVEL_TUNING[1];
