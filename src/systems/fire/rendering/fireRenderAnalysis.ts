import type { FireFxDebugControls, FireFxFallbackMode } from "./fireFxTypes.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const SMOKE_QUALITY_FALLBACK_FPS = 56;
const SMOKE_QUALITY_RECOVERY_FPS = 61;
const SMOKE_QUALITY_FALLBACK_SCENE_MS = 14;
const SMOKE_QUALITY_RECOVERY_SCENE_MS = 11;
const SMOKE_QUALITY_FALLBACK_SECONDS = 1.2;
const SMOKE_QUALITY_RECOVERY_SECONDS = 5;
const SMOKE_BUDGET_MIN_SCALE = 0.3;
const FLAME_BUDGET_MIN_SCALE = 0.35;
const FIRE_FX_ACTIVE_UPDATE_INTERVAL_MS = 16;
const FIRE_FX_IDLE_UPDATE_INTERVAL_MS = 120;
const FIRE_FX_PAUSED_UPDATE_INTERVAL_MS = 90;
const FIRE_FX_PAUSED_FLAME_BUDGET_SCALE = 0.42;
const FIRE_FX_PAUSED_SMOKE_DENSITY_SCALE = 0.08;
const FIRE_FX_PAUSED_MIN_SMOKE_RENDER_CAP = 32;
const FIRE_FX_OVERLOAD_FPS = 45;
const FIRE_FX_OVERLOAD_SCENE_MS = 24;
const FIRE_FX_OVERLOAD_FLAME_BUDGET_SCALE = 0.62;
const FIRE_FX_OVERLOAD_SMOKE_DENSITY_SCALE = 0.28;
const FIRE_FX_OVERLOAD_MAX_SMOKE_RENDER_CAP = 480;
const FIRE_FX_OVERLOAD_SMOKE_RENDER_STRIDE = 6;
const FIRE_FX_EMERGENCY_FPS = 34;
const FIRE_FX_EMERGENCY_SCENE_MS = 34;
const FIRE_FX_EMERGENCY_FLAME_BUDGET_SCALE = 0.4;
const FIRE_FX_EMERGENCY_SMOKE_DENSITY_SCALE = 0.12;
const FIRE_FX_EMERGENCY_MAX_SMOKE_RENDER_CAP = 224;
const FIRE_FX_EMERGENCY_SMOKE_RENDER_STRIDE = 8;
const SPARK_STREAK_MAX_INSTANCES = 2200;
const EMBER_MAX_INSTANCES = 1600;
const SMOKE_MAX_INSTANCES = 2400;
const FIRE_MAX_INSTANCES = 720;
const SMOKE_VISUAL_RATE_SCALE = 14;
const SMOKE_VISUAL_RATE_MAX = 4;

export type FireRenderAdaptiveState = {
  smokeBudgetScale: number;
  flameBudgetScale: number;
  smokeFallbackAccum: number;
  smokeRecoveryAccum: number;
  flameFallbackAccum: number;
  flameRecoveryAccum: number;
};

export type FireRenderAdaptiveInput = {
  controls: FireFxDebugControls;
  frameDeltaSeconds: number;
  deltaSeconds: number;
  fpsEstimate: number;
  sceneRenderMs: number;
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
  flameRecoveryAccum: 0
});

const applyFallbackMode = (
  fallbackMode: FireFxFallbackMode,
  fpsEstimate: number,
  sceneRenderMs: number,
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
  const fallbackFps = fallbackMode === "gentle" ? 54 : 58;
  const recoveryFps = fallbackMode === "gentle" ? 60 : 62;
  const fallbackSceneMs = fallbackMode === "gentle" ? 15 : 13;
  const recoverySceneMs = fallbackMode === "gentle" ? 11.5 : 10.5;
  const fallbackSeconds = fallbackMode === "gentle" ? 1.7 : 0.85;
  const recoverySeconds = fallbackMode === "gentle" ? 4.2 : 5.5;
  let nextFlameFallbackAccum = flameFallbackAccum;
  let nextFlameRecoveryAccum = flameRecoveryAccum;
  let nextFlameBudgetScale = flameBudgetScale;
  const overloadedFlames = fpsEstimate < fallbackFps || sceneRenderMs > fallbackSceneMs;
  if (overloadedFlames) {
    nextFlameFallbackAccum += deltaSeconds;
  } else {
    nextFlameFallbackAccum = Math.max(0, nextFlameFallbackAccum - deltaSeconds * 0.75);
  }
  const healthyFlames = fpsEstimate > recoveryFps && sceneRenderMs < recoverySceneMs;
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
  const emergencyOverload =
    (Number.isFinite(input.fpsEstimate) && input.fpsEstimate > 0 && input.fpsEstimate <= FIRE_FX_EMERGENCY_FPS) ||
    (Number.isFinite(input.sceneRenderMs) && input.sceneRenderMs >= FIRE_FX_EMERGENCY_SCENE_MS);
  const overloaded =
    emergencyOverload ||
    ((Number.isFinite(input.fpsEstimate) && input.fpsEstimate > 0 && input.fpsEstimate <= FIRE_FX_OVERLOAD_FPS) ||
      (Number.isFinite(input.sceneRenderMs) && input.sceneRenderMs >= FIRE_FX_OVERLOAD_SCENE_MS));

  let nextState: FireRenderAdaptiveState = { ...state };
  const pressureFlameBudgetScale = isRenderPaused
    ? FIRE_FX_PAUSED_FLAME_BUDGET_SCALE
    : emergencyOverload
      ? FIRE_FX_EMERGENCY_FLAME_BUDGET_SCALE
      : overloaded
        ? FIRE_FX_OVERLOAD_FLAME_BUDGET_SCALE
        : 1;

  if (
    Number.isFinite(input.fpsEstimate) &&
    input.fpsEstimate > 0 &&
    Number.isFinite(input.sceneRenderMs) &&
    input.sceneRenderMs > 0
  ) {
    const overloadedSmoke =
      input.fpsEstimate < SMOKE_QUALITY_FALLBACK_FPS || input.sceneRenderMs > SMOKE_QUALITY_FALLBACK_SCENE_MS;
    if (overloadedSmoke) {
      nextState.smokeFallbackAccum += input.frameDeltaSeconds;
    } else {
      nextState.smokeFallbackAccum = Math.max(0, nextState.smokeFallbackAccum - input.frameDeltaSeconds * 0.7);
    }
    const healthySmoke =
      input.fpsEstimate > SMOKE_QUALITY_RECOVERY_FPS && input.sceneRenderMs < SMOKE_QUALITY_RECOVERY_SCENE_MS;
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
      input.fpsEstimate,
      input.sceneRenderMs,
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
      ? FIRE_FX_PAUSED_SMOKE_DENSITY_SCALE
      : emergencyOverload
        ? FIRE_FX_EMERGENCY_SMOKE_DENSITY_SCALE
        : overloaded
          ? FIRE_FX_OVERLOAD_SMOKE_DENSITY_SCALE
          : 1);

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
    isRenderPaused ? 0.08 : 0.2,
    2.5
  );
  const smokeSpawnFrameCap = Math.max(
    12,
    Math.min(
      emergencyOverload ? 48 : overloaded ? 96 : smokeMaxInstances,
      Math.floor(smokeMaxInstances * 0.26 * effectiveSmokeBudgetScale)
    )
  );
  const smokeRenderCapTarget = Math.floor(smokeMaxInstances * effectiveSmokeBudgetScale);
  const smokeRenderCap = Math.max(
    isRenderPaused ? FIRE_FX_PAUSED_MIN_SMOKE_RENDER_CAP : 180,
    Math.min(
      isRenderPaused
        ? FIRE_FX_PAUSED_MIN_SMOKE_RENDER_CAP * 4
        : emergencyOverload
          ? FIRE_FX_EMERGENCY_MAX_SMOKE_RENDER_CAP
          : overloaded
            ? FIRE_FX_OVERLOAD_MAX_SMOKE_RENDER_CAP
            : smokeMaxInstances,
      smokeRenderCapTarget
    )
  );
  const smokeRenderStride = isRenderPaused
    ? Math.max(4, FIRE_FX_OVERLOAD_SMOKE_RENDER_STRIDE)
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
    140,
    Math.floor(
      SPARK_STREAK_MAX_INSTANCES *
        clamp(flameBudgetBaseScale * (0.66 + nextState.flameBudgetScale * 0.34), 0.35, 1)
    )
  );
  const emberCap = Math.max(
    120,
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
