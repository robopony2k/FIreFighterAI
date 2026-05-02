import type { ColorRepresentation } from "three";

import type { WorldState } from "../../../core/state.js";
import {
  DEFAULT_FIRE_BUDGET_SCALE,
  DEFAULT_FIRE_HERO_VOLUMETRIC_SHARE,
  DEFAULT_FIRE_WALL_BLEND
} from "../constants/fireRenderConstants.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export type FireFxWorldState = WorldState;

export type FireFxVisualBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type FireFxTerrainSize = {
  width: number;
  depth: number;
};

export type FireFxTerrainSample = {
  cols: number;
  rows: number;
  heightScaleMultiplier?: number;
};

export type FireFxTerrainSurface = {
  heightScale: number;
  step: number;
  toWorldX: (tileX: number) => number;
  toWorldZ: (tileY: number) => number;
  heightAtTileCoord: (tileX: number, tileY: number) => number;
};

export type FireFxTreeFlameProfile = {
  x: number;
  y: number;
  z: number;
  crownHeight: number;
  crownRadius: number;
  trunkHeight: number;
  treeCount: number;
};

export type FireFxTreeBurnController = {
  getTileBurnVisual: (tileIndex: number) => number;
  getTileBurnProgress: (tileIndex: number) => number;
  getTileAnchor: (tileIndex: number) => { x: number; y: number; z: number } | null;
  getTileFlameProfile: (tileIndex: number) => FireFxTreeFlameProfile | null;
  getVisualBounds: () => FireFxVisualBounds | null;
};

export type FireAnchorSource = "tree" | "structure" | "terrainSurface" | "rawFallback";
export type FireAnchorMode = "object" | "ground";

export type ResolvedFireAnchor = {
  tileIndex: number;
  tileX: number;
  tileY: number;
  position: { x: number; y: number; z: number };
  normal: { x: number; y: number; z: number };
  source: FireAnchorSource;
};

export type FireStructureAnchor = {
  position: { x: number; y: number; z: number };
  normal?: { x: number; y: number; z: number } | null;
};

export type FireStructureAnchorProvider = (
  tileIndex: number,
  tileX: number,
  tileY: number
) => FireStructureAnchor | null;

export type FireFxFallbackMode = "aggressive" | "gentle" | "off";
export type SparkMode = "tip" | "mixed" | "embers";
export type FireAnchorDebugMode = "off" | "tint" | "logRawFallbacks";

export type FireFxDebugControls = {
  wallBlend: number;
  heroVolumetricShare: number;
  budgetScale: number;
  fallbackMode: FireFxFallbackMode;
  flameIntensityBoost: number;
  groundGlowBoost: number;
  emberBoost: number;
  sparkDebug: boolean;
  sparkMode: SparkMode;
  smokeDensityScale: number;
  anchorDebugMode: FireAnchorDebugMode;
  showFrontPass: boolean;
  showClusterFlames: boolean;
  showSmoke: boolean;
  showSparks: boolean;
  showGroundGlow: boolean;
};

export type ThreeTestFireFxOptions = Partial<FireFxDebugControls>;

export const DEFAULT_FIRE_FX_DEBUG_CONTROLS: FireFxDebugControls = {
  wallBlend: DEFAULT_FIRE_WALL_BLEND,
  heroVolumetricShare: DEFAULT_FIRE_HERO_VOLUMETRIC_SHARE,
  budgetScale: DEFAULT_FIRE_BUDGET_SCALE,
  fallbackMode: "aggressive",
  flameIntensityBoost: 1,
  groundGlowBoost: 1,
  emberBoost: 1,
  sparkDebug: false,
  sparkMode: "tip",
  smokeDensityScale: 1,
  anchorDebugMode: "off",
  showFrontPass: true,
  showClusterFlames: true,
  showSmoke: true,
  showSparks: true,
  showGroundGlow: true
};

export const normalizeFireFxDebugControls = (
  controls: Partial<FireFxDebugControls> | undefined
): FireFxDebugControls => ({
  wallBlend: clamp(controls?.wallBlend ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.wallBlend, 0, 1),
  heroVolumetricShare: clamp(
    controls?.heroVolumetricShare ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.heroVolumetricShare,
    0,
    1
  ),
  budgetScale: clamp(controls?.budgetScale ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.budgetScale, 0.4, 1.25),
  fallbackMode:
    controls?.fallbackMode === "gentle" || controls?.fallbackMode === "off"
      ? controls.fallbackMode
      : DEFAULT_FIRE_FX_DEBUG_CONTROLS.fallbackMode,
  flameIntensityBoost: clamp(
    controls?.flameIntensityBoost ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.flameIntensityBoost,
    0.5,
    2
  ),
  groundGlowBoost: clamp(controls?.groundGlowBoost ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.groundGlowBoost, 0.5, 2),
  emberBoost: clamp(controls?.emberBoost ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.emberBoost, 0.5, 2),
  sparkDebug: controls?.sparkDebug === true,
  sparkMode:
    controls?.sparkMode === "mixed" || controls?.sparkMode === "embers"
      ? controls.sparkMode
      : DEFAULT_FIRE_FX_DEBUG_CONTROLS.sparkMode,
  smokeDensityScale: clamp(
    controls?.smokeDensityScale ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.smokeDensityScale,
    0.35,
    2.5
  ),
  anchorDebugMode:
    controls?.anchorDebugMode === "tint" || controls?.anchorDebugMode === "logRawFallbacks"
      ? controls.anchorDebugMode
      : DEFAULT_FIRE_FX_DEBUG_CONTROLS.anchorDebugMode,
  showFrontPass: controls?.showFrontPass ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.showFrontPass,
  showClusterFlames: controls?.showClusterFlames ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.showClusterFlames,
  showSmoke: controls?.showSmoke ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.showSmoke,
  showSparks: controls?.showSparks ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.showSparks,
  showGroundGlow: controls?.showGroundGlow ?? DEFAULT_FIRE_FX_DEBUG_CONTROLS.showGroundGlow
});

export type FireFxEnvironmentSignals = {
  smoke01: number;
  denseSmoke01: number;
  fireLoad01: number;
  orangeGlow01: number;
  sunDirection?: { x: number; y: number; z: number };
  sunTint?: ColorRepresentation;
  smokeTint?: ColorRepresentation;
};

export type SparkDebugSnapshot = {
  visibleFlameTiles: number;
  heroTipSparkAttempts: number;
  heroTipSparkEmitted: number;
  freeEmberAttempts: number;
  freeEmberEmitted: number;
  droppedByInstanceCap: number;
  finalSparkInstanceCount: number;
  clusterCount: number;
  clusteredTiles: number;
  clusterBedInstances: number;
  clusterPlumeSpawns: number;
  localSlotChurn: number;
  objectSlotChurn: number;
  frontSlotChurn: number;
  budgetClampedDrops: number;
  mode: SparkMode;
};

export type FireAudioClusterSnapshot = {
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  tileCount: number;
  heatMean01: number;
  heatSum01: number;
  fuelMean01: number;
  intensity01: number;
};

export type FireFxDebugTimings = {
  snapshot: number;
  analysis: number;
  analysisActiveTiles: number;
  analysisClusters: number;
  analysisFronts: number;
  analysisTilePlan: number;
  flameWrite: number;
  flameFront: number;
  flameCluster: number;
  flameTiles: number;
  smoke: number;
  upload: number;
  total: number;
};

export type FireFxDebugCounts = {
  fireInstances: number;
  fireCrossInstances: number;
  groundGlowInstances: number;
  smokeParticles: number;
  emberInstances: number;
  sparkStreakInstances: number;
  sparkPointInstances: number;
  activeFlameTiles: number;
  visibleFlameTiles: number;
  clusters: number;
  clusteredTiles: number;
  frontSegments: number;
  sampleStep: number;
  smokeRenderStride: number;
  smokeRenderCap: number;
  smokeSpawnFrameCap: number;
  rawFallbackAnchorTiles: number;
  candidateTiles: number;
  visibleTiles: number;
  culledTiles: number;
  frontCorridorsTested: number;
  frontCorridorsCulled: number;
  frontCorridorsEmitted: number;
  instancesCulledByVisibility: number;
  smokeParticlesCulledByVisibility: number;
};

export type FireFxDebugBudgets = {
  smokeBudgetScale: number;
  flameBudgetScale: number;
  effectiveSmokeBudgetScale: number;
  flameDensityScale: number;
  groundDensityScale: number;
  heroCrossDensity: number;
};

export type FireFxDebugModes = {
  renderPaused: boolean;
  overloaded: boolean;
  emergencyOverload: boolean;
  fallbackMode: FireFxFallbackMode;
  sparkMode: SparkMode;
  anchorDebugMode: FireAnchorDebugMode;
  showFrontPass: boolean;
  showClusterFlames: boolean;
  showSmoke: boolean;
  showSparks: boolean;
  showGroundGlow: boolean;
};

export type FireFxDebugSnapshot = {
  timingsMs: FireFxDebugTimings;
  counts: FireFxDebugCounts;
  budgets: FireFxDebugBudgets;
  continuity: Pick<
    SparkDebugSnapshot,
    "localSlotChurn" | "objectSlotChurn" | "frontSlotChurn" | "budgetClampedDrops"
  >;
  modes: FireFxDebugModes;
};

export const createEmptyFireFxDebugSnapshot = (
  controls: FireFxDebugControls = DEFAULT_FIRE_FX_DEBUG_CONTROLS
): FireFxDebugSnapshot => ({
  timingsMs: {
    snapshot: 0,
    analysis: 0,
    analysisActiveTiles: 0,
    analysisClusters: 0,
    analysisFronts: 0,
    analysisTilePlan: 0,
    flameWrite: 0,
    flameFront: 0,
    flameCluster: 0,
    flameTiles: 0,
    smoke: 0,
    upload: 0,
    total: 0
  },
  counts: {
    fireInstances: 0,
    fireCrossInstances: 0,
    groundGlowInstances: 0,
    smokeParticles: 0,
    emberInstances: 0,
    sparkStreakInstances: 0,
    sparkPointInstances: 0,
    activeFlameTiles: 0,
    visibleFlameTiles: 0,
    clusters: 0,
    clusteredTiles: 0,
    frontSegments: 0,
    sampleStep: 1,
    smokeRenderStride: 0,
    smokeRenderCap: 0,
    smokeSpawnFrameCap: 0,
    rawFallbackAnchorTiles: 0,
    candidateTiles: 0,
    visibleTiles: 0,
    culledTiles: 0,
    frontCorridorsTested: 0,
    frontCorridorsCulled: 0,
    frontCorridorsEmitted: 0,
    instancesCulledByVisibility: 0,
    smokeParticlesCulledByVisibility: 0
  },
  budgets: {
    smokeBudgetScale: 1,
    flameBudgetScale: 1,
    effectiveSmokeBudgetScale: 1,
    flameDensityScale: 1,
    groundDensityScale: 1,
    heroCrossDensity: 1
  },
  continuity: {
    localSlotChurn: 0,
    objectSlotChurn: 0,
    frontSlotChurn: 0,
    budgetClampedDrops: 0
  },
  modes: {
    renderPaused: false,
    overloaded: false,
    emergencyOverload: false,
    fallbackMode: controls.fallbackMode,
    sparkMode: controls.sparkMode,
    anchorDebugMode: controls.anchorDebugMode,
    showFrontPass: controls.showFrontPass,
    showClusterFlames: controls.showClusterFlames,
    showSmoke: controls.showSmoke,
    showSparks: controls.showSparks,
    showGroundGlow: controls.showGroundGlow
  }
});

export type ThreeTestFireFx = {
  captureSnapshot: (world: FireFxWorldState) => void;
  setSimulationAlpha: (alpha: number) => void;
  update: (
    frameTimeMs: number,
    world: FireFxWorldState,
    sample: FireFxTerrainSample | null,
    terrainSize: FireFxTerrainSize | null,
    terrainSurface: FireFxTerrainSurface | null,
    treeBurn: FireFxTreeBurnController | null,
    structureAnchorProvider: FireStructureAnchorProvider | null,
    fpsEstimate: number,
    sceneRenderMs: number,
    animationRate?: number
  ) => void;
  setEnvironmentSignals: (signals: FireFxEnvironmentSignals) => void;
  setDebugControls: (controls: Partial<FireFxDebugControls>) => void;
  getDebugControls: () => FireFxDebugControls;
  getSparkDebugSnapshot: () => SparkDebugSnapshot;
  getAudioClusterSnapshot: () => FireAudioClusterSnapshot[];
  getDebugSnapshot: () => FireFxDebugSnapshot;
  dispose: () => void;
};
