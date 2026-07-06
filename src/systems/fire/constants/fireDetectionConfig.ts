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
    upgradeCost: 980
  }
};

export const WATCH_TOWER_MAX_LEVEL: WatchTowerLevel = 3;

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
