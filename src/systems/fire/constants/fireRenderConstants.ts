export const FIRE_MAX_INSTANCES = 720;
export const FIRE_CROSS_MAX_INSTANCES = 320;
export const SMOKE_MAX_INSTANCES = 2400;
export const EMBER_MAX_INSTANCES = 1600;
export const SPARK_STREAK_MAX_INSTANCES = 2200;
export const SPARK_POINT_MAX_INSTANCES = 5200;
export const GLOW_MAX_INSTANCES = FIRE_MAX_INSTANCES * 2;

export const SMOKE_QUALITY_FALLBACK_FPS = 56;
export const SMOKE_QUALITY_RECOVERY_FPS = 61;
export const SMOKE_QUALITY_FALLBACK_SCENE_MS = 14;
export const SMOKE_QUALITY_RECOVERY_SCENE_MS = 11;
export const SMOKE_QUALITY_FALLBACK_SECONDS = 1.2;
export const SMOKE_QUALITY_RECOVERY_SECONDS = 5;
export const SMOKE_BUDGET_MIN_SCALE = 0.3;
export const SMOKE_INITIAL_AGE01 = 0.04;
export const FLAME_BUDGET_MIN_SCALE = 0.35;

export const FIRE_FX_ACTIVE_UPDATE_INTERVAL_MS = 16;
export const FIRE_FX_IDLE_UPDATE_INTERVAL_MS = 120;
export const FIRE_FX_PAUSED_UPDATE_INTERVAL_MS = 90;
export const FIRE_FX_PAUSED_FLAME_BUDGET_SCALE = 0.78;
export const FIRE_FX_PAUSED_SMOKE_DENSITY_SCALE = 0.08;
export const FIRE_FX_PAUSED_MIN_SMOKE_RENDER_CAP = 32;
export const FIRE_FX_PAUSED_VISUAL_SETTLE_DELTA_SECONDS = 1 / 24;
export const FIRE_FX_OVERLOAD_FPS = 45;
export const FIRE_FX_OVERLOAD_SCENE_MS = 24;
export const FIRE_FX_OVERLOAD_FLAME_BUDGET_SCALE = 0.62;
export const FIRE_FX_OVERLOAD_SMOKE_DENSITY_SCALE = 0.28;
export const FIRE_FX_OVERLOAD_MAX_SMOKE_RENDER_CAP = 480;
export const FIRE_FX_OVERLOAD_SMOKE_RENDER_STRIDE = 6;
export const FIRE_FX_EMERGENCY_FPS = 34;
export const FIRE_FX_EMERGENCY_SCENE_MS = 34;
export const FIRE_FX_EMERGENCY_FLAME_BUDGET_SCALE = 0.4;
export const FIRE_FX_EMERGENCY_SMOKE_DENSITY_SCALE = 0.12;
export const FIRE_FX_EMERGENCY_MAX_SMOKE_RENDER_CAP = 224;
export const FIRE_FX_EMERGENCY_SMOKE_RENDER_STRIDE = 8;

export const FIRE_MIN_INTENSITY_FLOOR = 0.001;
export const FIRE_FLAME_VISUAL_FLOOR = 0.006;
export const FIRE_MIN_HEAT = 0.12;
export const TREE_BURN_FLAME_VISUAL_MIN = 0.08;
export const TREE_BURN_CARRY_PROGRESS_MIN = 0.08;
export const TREE_BURN_CARRY_FUEL_MIN = 0.03;
export const FLAME_CELL_LATERAL_LIMIT = 0.45;
export const FLAME_WIND_GAIN = 2.1;
export const SMOKE_LAYER_MAX = 3;
export const TAU = Math.PI * 2;
export const ENABLE_FLAME_FRONT_PASS = true;

export const DEFAULT_FIRE_WALL_BLEND = 0.62;
export const DEFAULT_FIRE_HERO_VOLUMETRIC_SHARE = 0.55;
export const DEFAULT_FIRE_BUDGET_SCALE = 1.0;

export const FIRE_FRONT_MAX_INSTANCES = 320;
export const FIRE_FRONT_MIN_INSTANCES = 48;
export const FIRE_FRONT_CORRIDOR_MAX_SEGMENTS = 14;
export const FIRE_FRONT_VISUAL_MIN = 0.08;
export const FIRE_FRONT_PASS_MIN_WEIGHT = 6;
export const FIRE_EMITTER_SLOT_VISIBLE_CUTOFF = 0.08;
export const FIRE_FRONT_SLOT_VISIBLE_CUTOFF = 0.06;
export const FIRE_LOCAL_SLOT_RISE_RATE = 19;
export const FIRE_LOCAL_SLOT_FALL_RATE = 6.4;
export const FIRE_GROUND_SLOT_RISE_RATE = 15.5;
export const FIRE_GROUND_SLOT_FALL_RATE = 5.4;
export const FIRE_OBJECT_SLOT_RISE_RATE = 16.5;
export const FIRE_OBJECT_SLOT_FALL_RATE = 4.1;
export const FIRE_FRONT_SLOT_RISE_RATE = 15.2;
export const FIRE_FRONT_SLOT_FALL_RATE = 5.2;
export const FIRE_FRONT_BUDGET_RISE_RATE = 6.2;
export const FIRE_FRONT_BUDGET_FALL_RATE = 7.4;
export const FIRE_TILE_CAP_RISE_RATE = 7.8;
export const FIRE_TILE_CAP_FALL_RATE = 9.6;

export const FIRE_VISUAL_TUNING = {
  tongueSpawnMin: 0,
  tongueSpawnMax: 8,
  groundFlameSpawnMin: 1,
  groundFlameSpawnMax: 10,
  clusterStrength: 0.58,
  sparkRate: 2.2,
  sparkMax: EMBER_MAX_INSTANCES,
  glowRadius: 0.98,
  glowStrength: 0.98,
  sizeVariationMin: 0.75,
  sizeVariationMax: 1.35,
  leanVariationMin: 0.02,
  leanVariationMax: 0.2,
  flickerRateMin: 0.34,
  flickerRateMax: 1.95
} as const;

export const FIRE_SHADER_TIME_SCALE = 0.5;
export const FLAME_MOTION_TIME_SCALE = 0.44;
export const SPARK_MOTION_TIME_SCALE = 0.62;
export const SMOKE_VISUAL_RATE_SCALE = 14;
export const SMOKE_VISUAL_RATE_MAX = 4;
export const FLAME_BILLBOARD_OVERSCAN_X = 1.32;
export const FLAME_BILLBOARD_OVERSCAN_Y = 1.28;
export const FLAME_CORE_BILLBOARD_OVERSCAN_X = 1.16;
export const FLAME_CORE_BILLBOARD_OVERSCAN_Y = 1.1;
export const FLAME_RENDER_SIZE_SCALE = 0.88;
export const FLAME_JET_KERNEL_MIN = 2;
export const FLAME_JET_KERNEL_MAX = 5;

export const CLUSTER_UPDATE_MS = 48;
export const CLUSTER_MIN_TILES = 3;
export const CLUSTER_FULL_BLEND_TILES = 9;
export const INTERIOR_NEIGHBOR_MIN = 6;
export const CLUSTER_BED_MAX_PER_CLUSTER = 32;
export const CLUSTER_PLUME_MAX_PER_CLUSTER = 3;
export const CLUSTER_EDGE_HEIGHT_SCALE = 0.74;
export const CLUSTER_INTERIOR_HEIGHT_SCALE = 0.5;
export const CLUSTER_EDGE_WIDTH_SCALE = 1.3;
export const CLUSTER_INTERIOR_WIDTH_SCALE = 1.62;
export const CLUSTER_INTERIOR_KERNEL_CAP = 2;
export const CLUSTER_EDGE_KERNEL_CAP = 3;

export const IGNITION_RAMP_SECONDS_BASE = 0.8;
export const IGNITION_RAMP_SECONDS_MIN = 0.24;
export const IGNITION_RAMP_ACCELERATION = 0.68;
export const FLAME_VISUAL_RELEASE_SECONDS = 0.15;
export const SPARK_VISIBLE_FLAME_MIN = 0.12;
export const SPARK_VISIBLE_HEAT_MIN = 0.08;
export const LOCAL_FLAME_MIN_HEIGHT_TILES = 0.13;
export const LOCAL_FLAME_MIN_WIDTH_TILES = 0.095;
export const OBJECT_FLAME_MIN_HEIGHT_TILES = 0.15;
export const OBJECT_FLAME_MIN_WIDTH_TILES = 0.105;
export const GROUND_FLAME_MIN_HEIGHT_TILES = 0.085;
export const GROUND_FLAME_MIN_WIDTH_TILES = 0.06;

export const FIRE_FRONT_SLOT_ORDER = [7, 3, 10, 1, 5, 8, 12, 0, 2, 4, 6, 9, 11, 13] as const;
export const FIRE_FRONT_SLOT_RANK = (() => {
  const rank = new Uint8Array(FIRE_FRONT_CORRIDOR_MAX_SEGMENTS);
  for (let i = 0; i < FIRE_FRONT_SLOT_ORDER.length; i += 1) {
    rank[FIRE_FRONT_SLOT_ORDER[i]!] = i;
  }
  return rank;
})();
