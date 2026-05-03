import type { FireFxDebugControls, FireFxFallbackMode } from "./fireFxTypes.js";
import {
  CLUSTER_UPDATE_MS,
  EMBER_MAX_INSTANCES,
  FIRE_CROSS_MAX_INSTANCES,
  FIRE_FX_ACTIVE_UPDATE_INTERVAL_MS,
  FIRE_FX_EMERGENCY_FLAME_BUDGET_SCALE,
  FIRE_FX_EMERGENCY_MAX_SMOKE_RENDER_CAP,
  FIRE_FX_EMERGENCY_SCENE_MS,
  FIRE_FX_EMERGENCY_SMOKE_DENSITY_SCALE,
  FIRE_FX_EMERGENCY_SMOKE_RENDER_STRIDE,
  FIRE_FX_IDLE_UPDATE_INTERVAL_MS,
  FIRE_FX_NORMAL_MAX_SMOKE_RENDER_CAP,
  FIRE_FX_NORMAL_SMOKE_DENSITY_SCALE,
  FIRE_FX_NORMAL_SMOKE_SPAWN_FRAME_CAP,
  FIRE_FX_OVERLOAD_FLAME_BUDGET_SCALE,
  FIRE_FX_OVERLOAD_MAX_SMOKE_RENDER_CAP,
  FIRE_FX_OVERLOAD_SCENE_MS,
  FIRE_FX_OVERLOAD_SMOKE_DENSITY_SCALE,
  FIRE_FX_OVERLOAD_SMOKE_RENDER_STRIDE,
  FIRE_FX_PAUSED_FLAME_BUDGET_SCALE,
  FIRE_FX_PAUSED_UPDATE_INTERVAL_MS,
  FIRE_FRONT_MAX_INSTANCES,
  FIRE_MAX_INSTANCES,
  FIRE_TILE_CAP_FALL_RATE,
  FIRE_TILE_CAP_RISE_RATE,
  FIRE_VISUAL_TUNING,
  FLAME_BUDGET_MIN_SCALE,
  SMOKE_BUDGET_MIN_SCALE,
  SMOKE_MAX_INSTANCES,
  SMOKE_QUALITY_FALLBACK_SCENE_MS,
  SMOKE_QUALITY_FALLBACK_SECONDS,
  SMOKE_QUALITY_RECOVERY_SCENE_MS,
  SMOKE_QUALITY_RECOVERY_SECONDS,
  SMOKE_VISUAL_RATE_MAX,
  SMOKE_VISUAL_RATE_SCALE,
  SPARK_STREAK_MAX_INSTANCES
} from "../constants/fireRenderConstants.js";
import {
  buildOrReuseFireClusters,
  computeClusterBudgets,
  syncAudioClusterSnapshots,
  updateClusterFrontFields
} from "./fireClusterAnalysis.js";
import { analyzeFireFronts } from "./fireFrontAnalysis.js";
import { createInitialFireRenderAnalysisState } from "./fireRenderAnalysisState.js";
import { smoothApproach } from "./fireRenderMath.js";
import type {
  FireRenderCameraContext,
  FireRenderAnalysisTimings,
  FireRenderAnalysisState,
  FireRenderEnvironmentContext,
  FireRenderFramePlan,
  FireRenderTimingContext,
  FireRenderVisualContext,
  FireRenderWindContext
} from "./fireRenderPlanningTypes.js";
import { measureActiveFireTiles, planFireTileVisuals } from "./fireTileRenderPlanning.js";
import type {
  FireAudioClusterSnapshot,
  FireFxTerrainSize,
  FireFxTerrainSurface,
  FireFxTreeBurnController,
  FireFxWorldState,
  ResolvedFireAnchor
} from "./fireFxTypes.js";
import type { FireFieldView } from "./fireRenderSnapshot.js";
import type { FireFxVisibilityContext } from "./fireFxVisibility.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export type FireRenderAdaptiveState = {
  smokeBudgetScale: number;
  flameBudgetScale: number;
  smokeFallbackAccum: number;
  smokeRecoveryAccum: number;
  flameFallbackAccum: number;
  flameRecoveryAccum: number;
  overloadActive: boolean;
  overloadFallbackAccum: number;
  overloadRecoveryAccum: number;
  emergencyOverloadActive: boolean;
  emergencyFallbackAccum: number;
  emergencyRecoveryAccum: number;
};

export type FireRenderAdaptiveInput = {
  controls: FireFxDebugControls;
  frameDeltaSeconds: number;
  deltaSeconds: number;
  fpsEstimate: number;
  sceneRenderMs: number;
  fireFxMs: number;
  animationRate: number;
  hasFireWork: boolean;
  hasActiveSmoke: boolean;
  trackedFireTiles: number;
  area: number;
  smokeOnlyMode: boolean;
  fireMaxInstances?: number;
  smokeMaxInstances?: number;
};

export type FireRenderBudgetPlan = {
  isRenderPaused: boolean;
  smokeAnimationRate: number;
  minIntervalMs: number;
  emergencyOverload: boolean;
  overloaded: boolean;
  flameBudgetBaseScale: number;
  smokeDensityScale: number;
  flameDensityScale: number;
  groundDensityScale: number;
  heroCrossDensity: number;
  effectiveSmokeBudgetScale: number;
  smokeSpawnFrameCap: number;
  smokeRenderCap: number;
  smokeRenderStride: number;
  sparkStreakCap: number;
  emberCap: number;
  sampleStep: number;
  preferSparseFullResolution: boolean;
  nextAdaptiveState: FireRenderAdaptiveState;
};

export const createInitialFireRenderAdaptiveState = (): FireRenderAdaptiveState => ({
  smokeBudgetScale: 1,
  flameBudgetScale: 1,
  smokeFallbackAccum: 0,
  smokeRecoveryAccum: 0,
  flameFallbackAccum: 0,
  flameRecoveryAccum: 0,
  overloadActive: false,
  overloadFallbackAccum: 0,
  overloadRecoveryAccum: 0,
  emergencyOverloadActive: false,
  emergencyFallbackAccum: 0,
  emergencyRecoveryAccum: 0
});

const FIRE_FX_OVERLOAD_ENTER_SECONDS = 0.22;
const FIRE_FX_OVERLOAD_EXIT_SECONDS = 0.85;
const FIRE_FX_EMERGENCY_ENTER_SECONDS = 0.12;
const FIRE_FX_EMERGENCY_EXIT_SECONDS = 0.45;
const FIRE_FX_LOCAL_OVERLOAD_MS = 14;
const FIRE_FX_LOCAL_EMERGENCY_MS = 26;

const updateStickyMode = (
  active: boolean,
  rawActive: boolean,
  dtSeconds: number,
  enterSeconds: number,
  exitSeconds: number,
  fallbackAccum: number,
  recoveryAccum: number
): { active: boolean; fallbackAccum: number; recoveryAccum: number } => {
  let nextActive = active;
  let nextFallbackAccum = fallbackAccum;
  let nextRecoveryAccum = recoveryAccum;
  if (rawActive) {
    nextFallbackAccum += dtSeconds;
    nextRecoveryAccum = 0;
    if (nextFallbackAccum >= enterSeconds) {
      nextActive = true;
      nextFallbackAccum = enterSeconds;
    }
  } else {
    nextRecoveryAccum += dtSeconds;
    nextFallbackAccum = 0;
    if (nextRecoveryAccum >= exitSeconds) {
      nextActive = false;
      nextRecoveryAccum = exitSeconds;
    }
  }
  return {
    active: nextActive,
    fallbackAccum: nextFallbackAccum,
    recoveryAccum: nextRecoveryAccum
  };
};

const applyFallbackMode = (
  fallbackMode: FireFxFallbackMode,
  pressureMs: number,
  deltaSeconds: number,
  flameBudgetScale: number,
  flameFallbackAccum: number,
  flameRecoveryAccum: number
): Pick<FireRenderAdaptiveState, "flameBudgetScale" | "flameFallbackAccum" | "flameRecoveryAccum"> => {
  if (fallbackMode === "off") {
    return {
      flameBudgetScale: 1,
      flameFallbackAccum: 0,
      flameRecoveryAccum: 0
    };
  }
  const fallbackSceneMs = fallbackMode === "gentle" ? 15 : 13;
  const recoverySceneMs = fallbackMode === "gentle" ? 11.5 : 10.5;
  const fallbackSeconds = fallbackMode === "gentle" ? 1.7 : 0.85;
  const recoverySeconds = fallbackMode === "gentle" ? 4.2 : 5.5;
  let nextFlameFallbackAccum = flameFallbackAccum;
  let nextFlameRecoveryAccum = flameRecoveryAccum;
  let nextFlameBudgetScale = flameBudgetScale;
  const overloadedFlames = pressureMs > fallbackSceneMs;
  if (overloadedFlames) {
    nextFlameFallbackAccum += deltaSeconds;
  } else {
    nextFlameFallbackAccum = Math.max(0, nextFlameFallbackAccum - deltaSeconds * 0.75);
  }
  const healthyFlames = pressureMs < recoverySceneMs;
  if (healthyFlames) {
    nextFlameRecoveryAccum += deltaSeconds;
  } else {
    nextFlameRecoveryAccum = Math.max(0, nextFlameRecoveryAccum - deltaSeconds * 0.45);
  }
  if (nextFlameFallbackAccum >= fallbackSeconds) {
    const decay = fallbackMode === "gentle" ? 0.88 : 0.74;
    nextFlameBudgetScale = Math.max(FLAME_BUDGET_MIN_SCALE, nextFlameBudgetScale * decay);
    nextFlameFallbackAccum = 0;
    nextFlameRecoveryAccum = 0;
  } else if (nextFlameRecoveryAccum >= recoverySeconds) {
    const recoveryStep = fallbackMode === "gentle" ? 0.05 : 0.1;
    nextFlameBudgetScale = Math.min(1, nextFlameBudgetScale + recoveryStep);
    nextFlameRecoveryAccum = 0;
  }
  return {
    flameBudgetScale: nextFlameBudgetScale,
    flameFallbackAccum: nextFlameFallbackAccum,
    flameRecoveryAccum: nextFlameRecoveryAccum
  };
};

export const buildFireRenderBudgetPlan = (
  state: FireRenderAdaptiveState,
  input: FireRenderAdaptiveInput
): FireRenderBudgetPlan => {
  const fireMaxInstances = input.fireMaxInstances ?? FIRE_MAX_INSTANCES;
  const smokeMaxInstances = input.smokeMaxInstances ?? SMOKE_MAX_INSTANCES;
  const isRenderPaused = input.animationRate <= 0.0001;
  const smokeAnimationRate = clamp(Math.max(0, input.animationRate) * SMOKE_VISUAL_RATE_SCALE, 0, SMOKE_VISUAL_RATE_MAX);
  const minIntervalMs =
    isRenderPaused
      ? FIRE_FX_PAUSED_UPDATE_INTERVAL_MS
      : input.hasFireWork || input.hasActiveSmoke
        ? FIRE_FX_ACTIVE_UPDATE_INTERVAL_MS
        : FIRE_FX_IDLE_UPDATE_INTERVAL_MS;
  let nextState: FireRenderAdaptiveState = { ...state };
  const firePressureMs = Math.max(
    Number.isFinite(input.sceneRenderMs) ? input.sceneRenderMs : 0,
    Number.isFinite(input.fireFxMs) ? input.fireFxMs : 0
  );
  const rawEmergencyOverload =
    (Number.isFinite(input.sceneRenderMs) && input.sceneRenderMs >= FIRE_FX_EMERGENCY_SCENE_MS) ||
    (Number.isFinite(input.fireFxMs) && input.fireFxMs >= FIRE_FX_LOCAL_EMERGENCY_MS);
  const rawOverload =
    rawEmergencyOverload ||
    (Number.isFinite(input.sceneRenderMs) && input.sceneRenderMs >= FIRE_FX_OVERLOAD_SCENE_MS) ||
    (Number.isFinite(input.fireFxMs) && input.fireFxMs >= FIRE_FX_LOCAL_OVERLOAD_MS);
  if (isRenderPaused) {
    nextState.overloadActive = false;
    nextState.overloadFallbackAccum = 0;
    nextState.overloadRecoveryAccum = 0;
    nextState.emergencyOverloadActive = false;
    nextState.emergencyFallbackAccum = 0;
    nextState.emergencyRecoveryAccum = 0;
  } else {
    const emergencyMode = updateStickyMode(
      nextState.emergencyOverloadActive,
      rawEmergencyOverload,
      input.frameDeltaSeconds,
      FIRE_FX_EMERGENCY_ENTER_SECONDS,
      FIRE_FX_EMERGENCY_EXIT_SECONDS,
      nextState.emergencyFallbackAccum,
      nextState.emergencyRecoveryAccum
    );
    nextState.emergencyOverloadActive = emergencyMode.active;
    nextState.emergencyFallbackAccum = emergencyMode.fallbackAccum;
    nextState.emergencyRecoveryAccum = emergencyMode.recoveryAccum;
    const overloadMode = updateStickyMode(
      nextState.overloadActive,
      rawOverload || emergencyMode.active,
      input.frameDeltaSeconds,
      FIRE_FX_OVERLOAD_ENTER_SECONDS,
      FIRE_FX_OVERLOAD_EXIT_SECONDS,
      nextState.overloadFallbackAccum,
      nextState.overloadRecoveryAccum
    );
    nextState.overloadActive = overloadMode.active || emergencyMode.active;
    nextState.overloadFallbackAccum = overloadMode.fallbackAccum;
    nextState.overloadRecoveryAccum = overloadMode.recoveryAccum;
  }
  const emergencyOverload = nextState.emergencyOverloadActive;
  const overloaded = nextState.overloadActive;
  const pressureFlameBudgetScale = isRenderPaused
    ? FIRE_FX_PAUSED_FLAME_BUDGET_SCALE
    : emergencyOverload
      ? FIRE_FX_EMERGENCY_FLAME_BUDGET_SCALE
      : overloaded
        ? FIRE_FX_OVERLOAD_FLAME_BUDGET_SCALE
        : 1;

  if (
    !isRenderPaused &&
    Number.isFinite(firePressureMs) &&
    firePressureMs > 0
  ) {
    const overloadedSmoke = firePressureMs > SMOKE_QUALITY_FALLBACK_SCENE_MS;
    if (overloadedSmoke) {
      nextState.smokeFallbackAccum += input.frameDeltaSeconds;
    } else {
      nextState.smokeFallbackAccum = Math.max(0, nextState.smokeFallbackAccum - input.frameDeltaSeconds * 0.7);
    }
    const healthySmoke = firePressureMs < SMOKE_QUALITY_RECOVERY_SCENE_MS;
    if (healthySmoke) {
      nextState.smokeRecoveryAccum += input.frameDeltaSeconds;
    } else {
      nextState.smokeRecoveryAccum = Math.max(0, nextState.smokeRecoveryAccum - input.frameDeltaSeconds * 0.4);
    }
    if (nextState.smokeFallbackAccum >= SMOKE_QUALITY_FALLBACK_SECONDS) {
      nextState.smokeBudgetScale = Math.max(SMOKE_BUDGET_MIN_SCALE, nextState.smokeBudgetScale * 0.8);
      nextState.smokeFallbackAccum = 0;
      nextState.smokeRecoveryAccum = 0;
    } else if (nextState.smokeRecoveryAccum >= SMOKE_QUALITY_RECOVERY_SECONDS) {
      nextState.smokeBudgetScale = Math.min(1, nextState.smokeBudgetScale + 0.08);
      nextState.smokeRecoveryAccum = 0;
    }
    const flameFallbackState = applyFallbackMode(
      input.controls.fallbackMode,
      firePressureMs,
      input.deltaSeconds,
      nextState.flameBudgetScale,
      nextState.flameFallbackAccum,
      nextState.flameRecoveryAccum
    );
    nextState = { ...nextState, ...flameFallbackState };
  }

  const flameBudgetBaseScale = input.controls.budgetScale * pressureFlameBudgetScale;
  const smokeDensityScale =
    input.controls.smokeDensityScale *
    (isRenderPaused
      ? FIRE_FX_NORMAL_SMOKE_DENSITY_SCALE
      : emergencyOverload
        ? FIRE_FX_EMERGENCY_SMOKE_DENSITY_SCALE
        : overloaded
          ? FIRE_FX_OVERLOAD_SMOKE_DENSITY_SCALE
          : FIRE_FX_NORMAL_SMOKE_DENSITY_SCALE);

  const flameFallbackPressure = clamp(1 - nextState.flameBudgetScale, 0, 1);
  const flameDensityScale = clamp(
    flameBudgetBaseScale * (1 - Math.max(0, flameFallbackPressure - 0.12) * 1.05),
    0.2,
    1.25
  );
  const groundDensityScale = clamp(
    flameBudgetBaseScale * (1 - Math.max(0, flameFallbackPressure - 0.32) * 1.25),
    0.18,
    1.15
  );
  const heroCrossDensity = clamp(
    input.controls.heroVolumetricShare * flameBudgetBaseScale * (1 - flameFallbackPressure * 1.45),
    0,
    1
  );
  const effectiveSmokeBudgetScale = clamp(
    nextState.smokeBudgetScale * smokeDensityScale,
    0.1,
    2.5
  );
  const smokeSpawnFrameCap = Math.max(
    isRenderPaused ? 0 : 12,
    Math.min(
      emergencyOverload ? 48 : overloaded ? 96 : FIRE_FX_NORMAL_SMOKE_SPAWN_FRAME_CAP,
      Math.floor(smokeMaxInstances * 0.26 * effectiveSmokeBudgetScale)
    )
  );
  const smokeRenderCapTarget = Math.floor(smokeMaxInstances * effectiveSmokeBudgetScale);
  const smokeRenderCap = Math.max(
    96,
    Math.min(
      isRenderPaused
        ? FIRE_FX_NORMAL_MAX_SMOKE_RENDER_CAP
        : emergencyOverload
          ? FIRE_FX_EMERGENCY_MAX_SMOKE_RENDER_CAP
          : overloaded
            ? FIRE_FX_OVERLOAD_MAX_SMOKE_RENDER_CAP
            : FIRE_FX_NORMAL_MAX_SMOKE_RENDER_CAP,
      smokeRenderCapTarget
    )
  );
  const smokeRenderStride = isRenderPaused
    ? 1
    : emergencyOverload
      ? FIRE_FX_EMERGENCY_SMOKE_RENDER_STRIDE
      : overloaded
        ? FIRE_FX_OVERLOAD_SMOKE_RENDER_STRIDE
        : effectiveSmokeBudgetScale >= 0.9
          ? 1
          : effectiveSmokeBudgetScale >= 0.7
            ? 2
            : effectiveSmokeBudgetScale >= 0.5
              ? 3
              : 4;
  const preferSparseFullResolution = input.trackedFireTiles > 0 && input.area / input.trackedFireTiles >= 32;
  const sampleStep =
    preferSparseFullResolution || input.area <= 8192
      ? 1
      : Math.max(1, Math.ceil(Math.sqrt(input.area / Math.max(1, fireMaxInstances))));
  const sparkStreakCap = Math.max(
    48,
    Math.floor(
      SPARK_STREAK_MAX_INSTANCES *
        clamp(flameBudgetBaseScale * (0.66 + nextState.flameBudgetScale * 0.34), 0.35, 1)
    )
  );
  const emberCap = Math.max(
    48,
    Math.floor(EMBER_MAX_INSTANCES * clamp(flameBudgetBaseScale * (0.62 + nextState.flameBudgetScale * 0.38), 0.32, 1))
  );
  return {
    isRenderPaused,
    smokeAnimationRate,
    minIntervalMs,
    emergencyOverload,
    overloaded,
    flameBudgetBaseScale,
    smokeDensityScale,
    flameDensityScale,
    groundDensityScale,
    heroCrossDensity,
    effectiveSmokeBudgetScale,
    smokeSpawnFrameCap,
    smokeRenderCap,
    smokeRenderStride,
    sparkStreakCap,
    emberCap,
    sampleStep,
    preferSparseFullResolution,
    nextAdaptiveState: nextState
  };
};

export { createInitialFireRenderAnalysisState };
export type { FireRenderAnalysisState };

export type AnalyzeFireRenderFrameInput = {
  state: FireRenderAnalysisState;
  audioClusters: FireAudioClusterSnapshot[];
  world: FireFxWorldState;
  fireView: FireFieldView;
  terrainSize: FireFxTerrainSize;
  terrainSurface: FireFxTerrainSurface | null;
  treeBurn: FireFxTreeBurnController | null;
  timing: FireRenderTimingContext;
  wind: FireRenderWindContext;
  camera: FireRenderCameraContext;
  visual: FireRenderVisualContext;
  environment: FireRenderEnvironmentContext;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  area: number;
  trackedFireTiles: number;
  visibility: FireFxVisibilityContext | null;
  resolveGroundAnchor: (tileIdx: number) => ResolvedFireAnchor;
  resolveObjectAnchor: (tileIdx: number) => ResolvedFireAnchor;
};

export const analyzeFireRenderFrame = (input: AnalyzeFireRenderFrameInput): FireRenderFramePlan => {
  const {
    state,
    audioClusters,
    world,
    fireView,
    terrainSize,
    terrainSurface,
    treeBurn,
    timing,
    wind,
    camera,
    visual,
    environment,
    minX,
    maxX,
    minY,
    maxY,
    area,
    trackedFireTiles,
    visibility,
    resolveGroundAnchor,
    resolveObjectAnchor
  } = input;

  const analysisTimingsMs: FireRenderAnalysisTimings = {
    activeTiles: 0,
    clusters: 0,
    fronts: 0,
    tilePlan: 0
  };
  const activeTilesStartedAt = performance.now();
  const { activeFlameTileCount, visualActiveWeight } = measureActiveFireTiles({
    world,
    fireView,
    treeBurn,
    cols: world.grid.cols,
    minX,
    maxX,
    minY,
    maxY,
    simFireEps: environment.simFireEps
  });
  analysisTimingsMs.activeTiles = performance.now() - activeTilesStartedAt;

  const clustersStartedAt = performance.now();
  const clusterBuild = buildOrReuseFireClusters({
    state,
    frameTimeMs: timing.frameTimeMs,
    world,
    fireView,
    cols: world.grid.cols,
    rows: world.grid.rows,
    minX,
    maxX,
    minY,
    maxY,
    sampleStep: visual.sampleStep,
    simFireEps: environment.simFireEps,
    windX: wind.windX,
    windZ: wind.windZ,
    treeBurn,
    terrainSize,
    resolveGroundAnchor,
    activeFlameTileCount,
    clusterUpdateMs: CLUSTER_UPDATE_MS
  });
  analysisTimingsMs.clusters = performance.now() - clustersStartedAt;

  const frontPassEnabled = visual.showFrontPass && !visual.emergencyOverload;
  const frontsStartedAt = performance.now();
  const frontAnalysis = analyzeFireFronts({
    state,
    world,
    fireView,
    treeBurn,
    cols: world.grid.cols,
    rows: world.grid.rows,
    minX,
    maxX,
    minY,
    maxY,
    simFireEps: environment.simFireEps,
    deltaSeconds: timing.deltaSeconds,
    windNormX: wind.windNormX,
    windNormZ: wind.windNormZ,
    windDirLen: wind.windDirLen,
    activeFlameTileCount,
    visualActiveWeight,
    flameDensityScale: visual.flameDensityScale,
    frontPassEnabled,
    visibility,
    resolveGroundAnchor
  });
  analysisTimingsMs.fronts = performance.now() - frontsStartedAt;

  const flameTileCapacity = clamp(FIRE_MAX_INSTANCES - frontAnalysis.frontSegmentBudget, 96, FIRE_MAX_INSTANCES);
  const clusterBudgetState = computeClusterBudgets(
    state,
    visual.flameBudgetScale,
    Math.max(activeFlameTileCount, Math.round(Math.max(1, visualActiveWeight))),
    clusterBuild.clusteredTiles,
    flameTileCapacity
  );
  const perTileFlameCap =
    visualActiveWeight > 0.01
      ? clamp(Math.floor(clusterBudgetState.reserveTileJets / Math.max(1, visualActiveWeight)), 1, FIRE_VISUAL_TUNING.tongueSpawnMax)
      : FIRE_VISUAL_TUNING.tongueSpawnMax;
  const guaranteedFlameInstances =
    visualActiveWeight > 0.01
      ? Math.min(clusterBudgetState.reserveTileJets, Math.round(visualActiveWeight * perTileFlameCap))
      : 0;
  const perTileGroundCap =
    visualActiveWeight > 0.01
      ? clamp(
          Math.floor(Math.max(0, clusterBudgetState.reserveTileJets - guaranteedFlameInstances) / Math.max(1, visualActiveWeight)),
          0,
          FIRE_VISUAL_TUNING.groundFlameSpawnMax
        )
      : FIRE_VISUAL_TUNING.groundFlameSpawnMax;
  state.renderContinuityState.smoothedPerTileFlameCap = smoothApproach(
    state.renderContinuityState.smoothedPerTileFlameCap,
    perTileFlameCap,
    FIRE_TILE_CAP_RISE_RATE,
    FIRE_TILE_CAP_FALL_RATE,
    timing.deltaSeconds
  );
  state.renderContinuityState.smoothedPerTileGroundCap = smoothApproach(
    state.renderContinuityState.smoothedPerTileGroundCap,
    perTileGroundCap,
    FIRE_TILE_CAP_RISE_RATE,
    FIRE_TILE_CAP_FALL_RATE,
    timing.deltaSeconds
  );

  updateClusterFrontFields(state);

  const tilePlanStartedAt = performance.now();
  const visiblePlan = planFireTileVisuals({
    state,
    world,
    fireView,
    treeBurn,
    terrainSize,
    cols: world.grid.cols,
    rows: world.grid.rows,
    minX,
    maxX,
    minY,
    maxY,
    sampleStep: visual.sampleStep,
    simFireEps: environment.simFireEps,
    flamePresenceEps: environment.flamePresenceEps,
    deltaSeconds: timing.deltaSeconds,
    smokeDeltaSeconds: timing.smokeDeltaSeconds,
    tileSpan: environment.tileSpan,
    flameDensityScale: visual.flameDensityScale,
    groundDensityScale: visual.groundDensityScale,
    sliceComplexityScale: clamp(1 - clamp((visual.flameBudgetScale - 0.38) / 0.62, 0, 1) * 0.18, 0.72, 1),
    flameBudgetScale: visual.flameBudgetScale,
    frontPassActive: frontAnalysis.frontPassActive,
    frontFieldReadScale: frontAnalysis.frontFieldReadScale,
    visibility
  });
  analysisTimingsMs.tilePlan = performance.now() - tilePlanStartedAt;

  syncAudioClusterSnapshots(state, audioClusters);

  const crossSliceBudget01 = clamp((visual.flameBudgetScale - 0.38) / 0.62, 0, 1);
  const sliceComplexityScale = clamp(1 - crossSliceBudget01 * 0.18, 0.72, 1);
  const kernelBudgetScale = visual.flameBudgetScale >= 0.8 ? 1 : visual.flameBudgetScale >= 0.58 ? 0.78 : 0.6;
  const perTileCrossCap = visualActiveWeight > 0.01 ? clamp(Math.floor(FIRE_CROSS_MAX_INSTANCES / Math.max(1, visualActiveWeight)), 0, 5) : 5;

  return {
    world,
    fireView,
    bounds: {
      minX,
      maxX,
      minY,
      maxY,
      width: Math.max(1, maxX - minX + 1),
      height: Math.max(1, maxY - minY + 1),
      area,
      trackedFireTiles
    },
    terrainSize,
    terrainSurface,
    treeBurn,
    timing,
    wind,
    camera,
    visual,
    environment,
    state,
    resolveGroundAnchor,
    resolveObjectAnchor,
    activeFlameTileCount,
    visualActiveWeight,
    visibleFlameTiles: visiblePlan.visibleFlameTiles,
    clusterCount: clusterBuild.clusterCount,
    clusteredTiles: clusterBuild.clusteredTiles,
    frontFrameId: frontAnalysis.frontFrameId,
    frontPassActive: frontAnalysis.frontPassActive,
    frontSegmentBudget: frontAnalysis.frontSegmentBudget,
    frontFieldReadScale: frontAnalysis.frontFieldReadScale,
    perTileCrossCap,
    sliceComplexityScale,
    kernelBudgetScale,
    frontCorridors: frontAnalysis.frontCorridors,
    audioClusters,
    analysisTimingsMs
  };
};
