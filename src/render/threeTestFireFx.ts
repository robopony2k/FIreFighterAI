import * as THREE from "three";
import type { RenderSim } from "./simView.js";
import { createParticleBuffers, createSmokeShaderMaterial } from "./particles.js";
import type { TerrainSample, TreeBurnController, TreeFlameProfile } from "./threeTestTerrain.js";
import { getTerrainHeightScale } from "./threeTestTerrain.js";
import { FUEL_PROFILES, TILE_COLORS } from "../core/config.js";
import { TILE_ID_TO_TYPE, TILE_TYPE_IDS } from "../core/state.js";

const FIRE_MAX_INSTANCES = 720;
const FIRE_CROSS_MAX_INSTANCES = 320;
const SMOKE_MAX_INSTANCES = 1400;
const EMBER_MAX_INSTANCES = 1600;
const SPARK_STREAK_MAX_INSTANCES = 2200;
const SPARK_POINT_MAX_INSTANCES = 5200;
const GLOW_MAX_INSTANCES = FIRE_MAX_INSTANCES * 2;
const ASH_PREVIEW_MAX_INSTANCES = 1700;
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
const FIRE_MIN_INTENSITY_FLOOR = 0.001;
const FIRE_FLAME_VISUAL_FLOOR = 0.006;
const FIRE_MIN_HEAT = 0.12;
const TREE_BURN_FLAME_VISUAL_MIN = 0.08;
const TREE_BURN_CARRY_PROGRESS_MIN = 0.08;
const TREE_BURN_CARRY_FUEL_MIN = 0.03;
const ASH_PREVIEW_Y_OFFSET = 0.06;
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const FLAME_CELL_LATERAL_LIMIT = 0.45;
const FLAME_WIND_GAIN = 2.1;
const SMOKE_LAYER_MAX = 3;
const TAU = Math.PI * 2;
const ENABLE_FLAME_FRONT_PASS = true;
const DEFAULT_FIRE_WALL_BLEND = 0.62;
const DEFAULT_FIRE_HERO_VOLUMETRIC_SHARE = 0.55;
const DEFAULT_FIRE_BUDGET_SCALE = 1.0;
const FIRE_RENDER_SNAPSHOT_PADDING = 2;
const FIRE_FRONT_MAX_INSTANCES = 320;
const FIRE_FRONT_MIN_INSTANCES = 48;
const FIRE_FRONT_RUN_MAX_SEGMENTS = 9;
const FIRE_FRONT_VISUAL_MIN = 0.08;
const FIRE_FRONT_PASS_MIN_WEIGHT = 6;
const FIRE_FRONT_NEIGHBOUR_RATIO = 0.72;
const FIRE_FRONT_NEIGHBOUR_HEAT_RATIO = 0.76;
const FIRE_VISUAL_TUNING = {
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
const FIRE_SHADER_TIME_SCALE = 0.5;
const FLAME_MOTION_TIME_SCALE = 0.44;
const SPARK_MOTION_TIME_SCALE = 0.62;
const FLAME_BILLBOARD_OVERSCAN_X = 1.32;
const FLAME_BILLBOARD_OVERSCAN_Y = 1.28;
const FLAME_CORE_BILLBOARD_OVERSCAN_X = 1.16;
const FLAME_CORE_BILLBOARD_OVERSCAN_Y = 1.1;
const FLAME_RENDER_SIZE_SCALE = 0.88;
const FLAME_JET_KERNEL_MIN = 2;
const FLAME_JET_KERNEL_MAX = 5;
const CLUSTER_UPDATE_MS = 48;
const CLUSTER_MIN_TILES = 3;
const CLUSTER_FULL_BLEND_TILES = 9;
const INTERIOR_NEIGHBOR_MIN = 6;
const CLUSTER_BED_MAX_PER_CLUSTER = 32;
const CLUSTER_PLUME_MAX_PER_CLUSTER = 3;
const CLUSTER_EDGE_HEIGHT_SCALE = 0.74;
const CLUSTER_INTERIOR_HEIGHT_SCALE = 0.5;
const CLUSTER_EDGE_WIDTH_SCALE = 1.3;
const CLUSTER_INTERIOR_WIDTH_SCALE = 1.62;
const CLUSTER_INTERIOR_KERNEL_CAP = 2;
const CLUSTER_EDGE_KERNEL_CAP = 3;
const SMOKE_OCCL_STRENGTH_ALPHA = 0.65;
const SMOKE_OCCL_STRENGTH_EMISSIVE = 0.55;
const EMISSIVE_CLAMP = 1.55;
const EMISSIVE_KNEE = 1.25;
const IGNITION_RAMP_SECONDS_BASE = 0.8;
const IGNITION_RAMP_SECONDS_MIN = 0.24;
const IGNITION_RAMP_ACCELERATION = 0.68;
const SCHEDULED_PREHEAT_MAX_SCALE = 0.25;
const ASH_PREVIEW_FIRE_MAX = 0.04;
const ASH_PREVIEW_HEAT_MAX = 0.12;
const ASH_PREVIEW_FLAME_MAX = 0.05;
const FLAME_VISUAL_RELEASE_SECONDS = 0.15;
const SPARK_VISIBLE_FLAME_MIN = 0.12;
const SPARK_VISIBLE_HEAT_MIN = 0.08;
const LOCAL_FLAME_MIN_HEIGHT_TILES = 0.13;
const LOCAL_FLAME_MIN_WIDTH_TILES = 0.095;
const OBJECT_FLAME_MIN_HEIGHT_TILES = 0.15;
const OBJECT_FLAME_MIN_WIDTH_TILES = 0.105;
const GROUND_FLAME_MIN_HEIGHT_TILES = 0.085;
const GROUND_FLAME_MIN_WIDTH_TILES = 0.06;

const ASH_PREVIEW_BASE_FUEL_BY_TYPE_ID = TILE_ID_TO_TYPE.map((tileType) => Math.max(0, FUEL_PROFILES[tileType].baseFuel));

const isAshPreviewCandidateType = (typeId: number): boolean =>
  typeId === TILE_TYPE_IDS.grass ||
  typeId === TILE_TYPE_IDS.scrub ||
  typeId === TILE_TYPE_IDS.floodplain ||
  typeId === TILE_TYPE_IDS.forest;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const fract = (value: number): number => value - Math.floor(value);
const hash1 = (value: number): number => fract(Math.sin(value * 12.9898) * 43758.5453);
const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};
const smoothApproach = (current: number, target: number, riseRate: number, fallRate: number, dtSeconds: number): number => {
  const rate = target >= current ? riseRate : fallRate;
  const k = 1 - Math.exp(-Math.max(0, rate) * Math.max(0, dtSeconds));
  return current + (target - current) * k;
};
const getVisualWindResponse = (
  windStrength: number
): { flame: number; spark: number; smoke: number; smokeUpwind: number } => {
  const wind01 = clamp(windStrength, 0, 1);
  const eased = smoothstep(0, 1, wind01);
  const shared = 0.42 + eased * 0.72;
  return {
    flame: shared * 1.02,
    spark: shared * 0.92,
    smoke: shared * 1.14,
    smokeUpwind: 0.22 + (1 - eased) * 0.14
  };
};
const worldUnitsForPixels = (
  camera: THREE.Camera,
  distance: number,
  pixelSize: number,
  viewportHeightPx: number
): number => {
  const safePixels = Math.max(0, pixelSize);
  const safeViewport = Math.max(1, viewportHeightPx);
  const perspectiveCamera = camera as THREE.PerspectiveCamera & { isPerspectiveCamera?: boolean };
  if (perspectiveCamera.isPerspectiveCamera) {
    const fovRad = ((perspectiveCamera.fov ?? 45) * Math.PI) / 180;
    return (2 * Math.tan(fovRad * 0.5) * Math.max(0.001, distance) * safePixels) / safeViewport;
  }
  const orthographicCamera = camera as THREE.OrthographicCamera & { isOrthographicCamera?: boolean };
  if (orthographicCamera.isOrthographicCamera) {
    const top = orthographicCamera.top ?? 1;
    const bottom = orthographicCamera.bottom ?? -1;
    const zoom = Math.max(0.0001, orthographicCamera.zoom ?? 1);
    const verticalSpan = Math.max(0.001, (top - bottom) / zoom);
    return (verticalSpan * safePixels) / safeViewport;
  }
  return 0;
};
const getSimFireEps = (world: RenderSim): number => {
  const heatEps = Math.max(0.002, world.simPerf?.diffusionEps || 0.02);
  return Math.max(FIRE_MIN_INTENSITY_FLOOR, heatEps * 0.5);
};
const swapDepthOrder = (depth: Float32Array, order: Uint16Array, a: number, b: number): void => {
  const d = depth[a];
  depth[a] = depth[b];
  depth[b] = d;
  const o = order[a];
  order[a] = order[b];
  order[b] = o;
};
const sortDepthBackToFront = (depth: Float32Array, order: Uint16Array, left: number, right: number): void => {
  let i = left;
  let j = right;
  const pivot = depth[(left + right) >> 1];
  while (i <= j) {
    while (depth[i] > pivot) {
      i += 1;
    }
    while (depth[j] < pivot) {
      j -= 1;
    }
    if (i <= j) {
      swapDepthOrder(depth, order, i, j);
      i += 1;
      j -= 1;
    }
  }
  if (left < j) {
    sortDepthBackToFront(depth, order, left, j);
  }
  if (i < right) {
    sortDepthBackToFront(depth, order, i, right);
  }
};
const sortSmokeParticlesByDepth = (depth: Float32Array, order: Uint16Array, count: number): void => {
  if (count > 1) {
    sortDepthBackToFront(depth, order, 0, count - 1);
  }
};
type NeighbourFireFront = {
  centerTileX: number;
  centerTileY: number;
  strength: number;
};
type FireRenderSnapshot = {
  cols: number;
  rows: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  tileFire: Float32Array;
  tileHeat: Float32Array;
  tileFuel: Float32Array;
  scheduled: Uint8Array;
  lastActiveFires: number;
  fireScheduledCount: number;
  fireBoundsActive: boolean;
};

type FireFieldView = {
  alpha: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  hasBounds: boolean;
  lastActiveFires: number;
  fireScheduledCount: number;
  getFireAt: (x: number, y: number) => number;
  getFireByIndex: (tileIdx: number) => number;
  getHeat01At: (x: number, y: number) => number;
  getHeat01ByIndex: (tileIdx: number) => number;
  getFuelAt: (x: number, y: number) => number;
  getFuelByIndex: (tileIdx: number) => number;
  getScheduledAt: (x: number, y: number) => number;
  getScheduledByIndex: (tileIdx: number) => number;
};

const createEmptyFireRenderSnapshot = (
  cols: number,
  rows: number,
  lastActiveFires = 0,
  fireScheduledCount = 0,
  fireBoundsActive = false
): FireRenderSnapshot => ({
  cols,
  rows,
  minX: 0,
  maxX: -1,
  minY: 0,
  maxY: -1,
  width: 0,
  height: 0,
  tileFire: new Float32Array(0),
  tileHeat: new Float32Array(0),
  tileFuel: new Float32Array(0),
  scheduled: new Uint8Array(0),
  lastActiveFires,
  fireScheduledCount,
  fireBoundsActive
});

const snapshotHasSourceBounds = (snapshot: FireRenderSnapshot | null): boolean =>
  !!snapshot &&
  snapshot.width > 0 &&
  (snapshot.fireBoundsActive || snapshot.lastActiveFires > 0 || snapshot.fireScheduledCount > 0);

const clampSnapshotBounds = (
  cols: number,
  rows: number,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number
): { minX: number; maxX: number; minY: number; maxY: number } => ({
  minX: clamp(minX, 0, Math.max(0, cols - 1)),
  maxX: clamp(maxX, 0, Math.max(0, cols - 1)),
  minY: clamp(minY, 0, Math.max(0, rows - 1)),
  maxY: clamp(maxY, 0, Math.max(0, rows - 1))
});

const captureFireRenderSnapshot = (
  world: RenderSim,
  previousSnapshot: FireRenderSnapshot | null
): FireRenderSnapshot => {
  const cols = world.grid.cols;
  const rows = world.grid.rows;
  const lastActiveFires = Math.max(0, world.lastActiveFires ?? 0);
  const fireScheduledCount = Math.max(0, world.fireScheduledCount ?? 0);
  const fireBoundsActive = world.fireBoundsActive === true;
  const heatCap = Math.max(0.01, world.fireSettings.heatCap);
  const simFireEps = getSimFireEps(world);
  const heatEps = Math.max(0.06, (world.simPerf?.diffusionEps || 0.02) * 2.5);
  if (cols <= 0 || rows <= 0) {
    return createEmptyFireRenderSnapshot(cols, rows, lastActiveFires, fireScheduledCount, fireBoundsActive);
  }
  let hasBounds = false;
  let minX = cols;
  let maxX = -1;
  let minY = rows;
  let maxY = -1;
  const scanMinX = fireBoundsActive ? clamp(world.fireMinX, 0, cols - 1) : 0;
  const scanMaxX = fireBoundsActive ? clamp(world.fireMaxX, 0, cols - 1) : cols - 1;
  const scanMinY = fireBoundsActive ? clamp(world.fireMinY, 0, rows - 1) : 0;
  const scanMaxY = fireBoundsActive ? clamp(world.fireMaxY, 0, rows - 1) : rows - 1;
  for (let y = scanMinY; y <= scanMaxY; y += 1) {
    const rowBase = y * cols;
    for (let x = scanMinX; x <= scanMaxX; x += 1) {
      const idx = rowBase + x;
      const scheduled = world.tileIgniteAt[idx] < Number.POSITIVE_INFINITY;
      const fire = Math.max(0, world.tileFire[idx] ?? 0);
      const heat01 = clamp((world.tileHeat[idx] ?? 0) / heatCap, 0, 1);
      if (fire <= simFireEps && heat01 <= heatEps && !scheduled) {
        continue;
      }
      if (!hasBounds) {
        minX = maxX = x;
        minY = maxY = y;
        hasBounds = true;
        continue;
      }
      if (x < minX) {
        minX = x;
      }
      if (x > maxX) {
        maxX = x;
      }
      if (y < minY) {
        minY = y;
      }
      if (y > maxY) {
        maxY = y;
      }
    }
  }
  if (hasBounds) {
    const clamped = clampSnapshotBounds(
      cols,
      rows,
      minX - FIRE_RENDER_SNAPSHOT_PADDING,
      maxX + FIRE_RENDER_SNAPSHOT_PADDING,
      minY - FIRE_RENDER_SNAPSHOT_PADDING,
      maxY + FIRE_RENDER_SNAPSHOT_PADDING
    );
    minX = clamped.minX;
    maxX = clamped.maxX;
    minY = clamped.minY;
    maxY = clamped.maxY;
  }
  const previousBoundsSnapshot = snapshotHasSourceBounds(previousSnapshot) ? previousSnapshot : null;
  if (previousBoundsSnapshot) {
    if (!hasBounds) {
      minX = previousBoundsSnapshot.minX;
      maxX = previousBoundsSnapshot.maxX;
      minY = previousBoundsSnapshot.minY;
      maxY = previousBoundsSnapshot.maxY;
      hasBounds = true;
    } else {
      minX = Math.min(minX, previousBoundsSnapshot.minX);
      maxX = Math.max(maxX, previousBoundsSnapshot.maxX);
      minY = Math.min(minY, previousBoundsSnapshot.minY);
      maxY = Math.max(maxY, previousBoundsSnapshot.maxY);
    }
  }
  if (!hasBounds || minX > maxX || minY > maxY) {
    return createEmptyFireRenderSnapshot(cols, rows, lastActiveFires, fireScheduledCount, fireBoundsActive);
  }
  const width = maxX - minX + 1;
  const height = maxY - minY + 1;
  const count = width * height;
  const tileFire = new Float32Array(count);
  const tileHeat = new Float32Array(count);
  const tileFuel = new Float32Array(count);
  const scheduled = new Uint8Array(count);
  let scheduledWithinBounds = 0;
  let write = 0;
  for (let y = minY; y <= maxY; y += 1) {
    const rowBase = y * cols;
    for (let x = minX; x <= maxX; x += 1) {
      const idx = rowBase + x;
      tileFire[write] = Math.max(0, world.tileFire[idx] ?? 0);
      tileHeat[write] = Math.max(0, world.tileHeat[idx] ?? 0);
      tileFuel[write] = clamp(world.tileFuel[idx] ?? 0, 0, 1);
      const scheduledNow = world.tileIgniteAt[idx] < Number.POSITIVE_INFINITY ? 1 : 0;
      scheduled[write] = scheduledNow;
      scheduledWithinBounds += scheduledNow;
      write += 1;
    }
  }
  return {
    cols,
    rows,
    minX,
    maxX,
    minY,
    maxY,
    width,
    height,
    tileFire,
    tileHeat,
    tileFuel,
    scheduled,
    lastActiveFires,
    fireScheduledCount: Math.max(fireScheduledCount, scheduledWithinBounds),
    fireBoundsActive
  };
};

const snapshotOffsetAt = (snapshot: FireRenderSnapshot, x: number, y: number): number => {
  if (
    snapshot.width <= 0 ||
    x < snapshot.minX ||
    x > snapshot.maxX ||
    y < snapshot.minY ||
    y > snapshot.maxY
  ) {
    return -1;
  }
  return (y - snapshot.minY) * snapshot.width + (x - snapshot.minX);
};

const snapshotOffsetByIndex = (snapshot: FireRenderSnapshot, tileIdx: number): number => {
  if (snapshot.width <= 0 || snapshot.cols <= 0) {
    return -1;
  }
  const x = tileIdx % snapshot.cols;
  const y = Math.floor(tileIdx / snapshot.cols);
  return snapshotOffsetAt(snapshot, x, y);
};

const snapshotReadFloatAt = (
  snapshot: FireRenderSnapshot,
  x: number,
  y: number,
  source: Float32Array
): number => {
  const offset = snapshotOffsetAt(snapshot, x, y);
  return offset >= 0 ? source[offset] ?? 0 : 0;
};

const snapshotReadFloatByIndex = (
  snapshot: FireRenderSnapshot,
  tileIdx: number,
  source: Float32Array
): number => {
  const offset = snapshotOffsetByIndex(snapshot, tileIdx);
  return offset >= 0 ? source[offset] ?? 0 : 0;
};

const snapshotReadByteAt = (
  snapshot: FireRenderSnapshot,
  x: number,
  y: number,
  source: Uint8Array
): number => {
  const offset = snapshotOffsetAt(snapshot, x, y);
  return offset >= 0 ? source[offset] ?? 0 : 0;
};

const snapshotReadByteByIndex = (
  snapshot: FireRenderSnapshot,
  tileIdx: number,
  source: Uint8Array
): number => {
  const offset = snapshotOffsetByIndex(snapshot, tileIdx);
  return offset >= 0 ? source[offset] ?? 0 : 0;
};

const createFireFieldView = (
  previousSnapshot: FireRenderSnapshot,
  currentSnapshot: FireRenderSnapshot,
  alpha: number,
  heatCap: number
): FireFieldView => {
  const clampedAlpha = clamp(alpha, 0, 1);
  const lerpFloat = (prevValue: number, nextValue: number): number =>
    prevValue + (nextValue - prevValue) * clampedAlpha;
  const previousHasBounds = previousSnapshot.width > 0;
  const currentHasBounds = currentSnapshot.width > 0;
  const minX = previousHasBounds && currentHasBounds
    ? Math.min(previousSnapshot.minX, currentSnapshot.minX)
    : currentHasBounds
      ? currentSnapshot.minX
      : previousSnapshot.minX;
  const maxX = previousHasBounds && currentHasBounds
    ? Math.max(previousSnapshot.maxX, currentSnapshot.maxX)
    : currentHasBounds
      ? currentSnapshot.maxX
      : previousSnapshot.maxX;
  const minY = previousHasBounds && currentHasBounds
    ? Math.min(previousSnapshot.minY, currentSnapshot.minY)
    : currentHasBounds
      ? currentSnapshot.minY
      : previousSnapshot.minY;
  const maxY = previousHasBounds && currentHasBounds
    ? Math.max(previousSnapshot.maxY, currentSnapshot.maxY)
    : currentHasBounds
      ? currentSnapshot.maxY
      : previousSnapshot.maxY;
  return {
    alpha: clampedAlpha,
    minX,
    maxX,
    minY,
    maxY,
    hasBounds: previousHasBounds || currentHasBounds,
    lastActiveFires: Math.max(previousSnapshot.lastActiveFires, currentSnapshot.lastActiveFires),
    fireScheduledCount: Math.max(previousSnapshot.fireScheduledCount, currentSnapshot.fireScheduledCount),
    getFireAt: (x: number, y: number): number =>
      lerpFloat(
        snapshotReadFloatAt(previousSnapshot, x, y, previousSnapshot.tileFire),
        snapshotReadFloatAt(currentSnapshot, x, y, currentSnapshot.tileFire)
      ),
    getFireByIndex: (tileIdx: number): number =>
      lerpFloat(
        snapshotReadFloatByIndex(previousSnapshot, tileIdx, previousSnapshot.tileFire),
        snapshotReadFloatByIndex(currentSnapshot, tileIdx, currentSnapshot.tileFire)
      ),
    getHeat01At: (x: number, y: number): number =>
      clamp(
        lerpFloat(
          snapshotReadFloatAt(previousSnapshot, x, y, previousSnapshot.tileHeat),
          snapshotReadFloatAt(currentSnapshot, x, y, currentSnapshot.tileHeat)
        ) / Math.max(0.01, heatCap),
        0,
        1
      ),
    getHeat01ByIndex: (tileIdx: number): number =>
      clamp(
        lerpFloat(
          snapshotReadFloatByIndex(previousSnapshot, tileIdx, previousSnapshot.tileHeat),
          snapshotReadFloatByIndex(currentSnapshot, tileIdx, currentSnapshot.tileHeat)
        ) / Math.max(0.01, heatCap),
        0,
        1
      ),
    getFuelAt: (x: number, y: number): number =>
      clamp(
        lerpFloat(
          snapshotReadFloatAt(previousSnapshot, x, y, previousSnapshot.tileFuel),
          snapshotReadFloatAt(currentSnapshot, x, y, currentSnapshot.tileFuel)
        ),
        0,
        1
      ),
    getFuelByIndex: (tileIdx: number): number =>
      clamp(
        lerpFloat(
          snapshotReadFloatByIndex(previousSnapshot, tileIdx, previousSnapshot.tileFuel),
          snapshotReadFloatByIndex(currentSnapshot, tileIdx, currentSnapshot.tileFuel)
        ),
        0,
        1
      ),
    getScheduledAt: (x: number, y: number): number =>
      clamp(
        lerpFloat(
          snapshotReadByteAt(previousSnapshot, x, y, previousSnapshot.scheduled),
          snapshotReadByteAt(currentSnapshot, x, y, currentSnapshot.scheduled)
        ),
        0,
        1
      ),
    getScheduledByIndex: (tileIdx: number): number =>
      clamp(
        lerpFloat(
          snapshotReadByteByIndex(previousSnapshot, tileIdx, previousSnapshot.scheduled),
          snapshotReadByteByIndex(currentSnapshot, tileIdx, currentSnapshot.scheduled)
        ),
        0,
        1
      )
  };
};

const getNeighbourFireBias = (fireView: FireFieldView, cols: number, rows: number, x: number, y: number): number => {
  let sum = 0;
  let count = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    const ny = y + oy;
    if (ny < 0 || ny >= rows) {
      continue;
    }
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const nx = x + ox;
      if (nx < 0 || nx >= cols) {
        continue;
      }
      sum += fireView.getFireAt(nx, ny);
      count += 1;
    }
  }
  return count > 0 ? sum / count : 0;
};
const getNeighbourFireFront = (
  fireView: FireFieldView,
  cols: number,
  rows: number,
  x: number,
  y: number,
  simFireEps: number,
  windX: number,
  windY: number
): NeighbourFireFront => {
  const localFire = fireView.getFireAt(x, y);
  let weightedX = 0;
  let weightedY = 0;
  let weightedDirX = 0;
  let weightedDirY = 0;
  let weightedSum = 0;
  let neighborSum = 0;
  let neighborCount = 0;
  for (let oy = -1; oy <= 1; oy += 1) {
    const ny = y + oy;
    if (ny < 0 || ny >= rows) {
      continue;
    }
    for (let ox = -1; ox <= 1; ox += 1) {
      if (ox === 0 && oy === 0) {
        continue;
      }
      const nx = x + ox;
      if (nx < 0 || nx >= cols) {
        continue;
      }
      const nFire = fireView.getFireAt(nx, ny);
      if (nFire <= simFireEps) {
        continue;
      }
      const distWeight = ox === 0 || oy === 0 ? 1 : 0.72;
      const weight = Math.max(0, nFire - localFire * 0.35) * distWeight;
      if (weight <= 0) {
        continue;
      }
      weightedX += (nx + 0.5) * weight;
      weightedY += (ny + 0.5) * weight;
      weightedDirX += ox * weight;
      weightedDirY += oy * weight;
      weightedSum += weight;
      neighborSum += nFire;
      neighborCount += 1;
    }
  }
  if (weightedSum <= 0.0001) {
    return { centerTileX: x + 0.5, centerTileY: y + 0.5, strength: 0 };
  }
  const centerTileX = weightedX / weightedSum;
  const centerTileY = weightedY / weightedSum;
  const neighborAvg = neighborCount > 0 ? neighborSum / neighborCount : 0;
  const dirLen = Math.hypot(weightedDirX, weightedDirY);
  const windLen = Math.hypot(windX, windY);
  let windAlign = 0;
  if (dirLen > 0.0001 && windLen > 0.0001) {
    const dirX = weightedDirX / dirLen;
    const dirY = weightedDirY / dirLen;
    const normWindX = windX / windLen;
    const normWindY = windY / windLen;
    windAlign = Math.max(0, dirX * normWindX + dirY * normWindY);
  }
  const cluster = clamp(weightedSum / 2.6, 0, 1);
  const gradient = clamp(neighborAvg - localFire + 0.15, 0, 1);
  const strength = clamp(gradient * 0.62 + cluster * 0.24 + windAlign * 0.34, 0, 1);
  return { centerTileX, centerTileY, strength };
};

export type FireFxFallbackMode = "aggressive" | "gentle" | "off";
export type SparkMode = "tip" | "mixed" | "embers";

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
  smokeDensityScale: 1
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
  )
});

export type FireFxEnvironmentSignals = {
  smoke01: number;
  denseSmoke01: number;
  fireLoad01: number;
  orangeGlow01: number;
  sunDirection?: { x: number; y: number; z: number };
  sunTint?: THREE.ColorRepresentation;
  smokeTint?: THREE.ColorRepresentation;
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
  mode: SparkMode;
};

type ClusterRole = 0 | 1 | 2;

type FireCluster = {
  id: number;
  tileCount: number;
  centroidX: number;
  centroidZ: number;
  spanAxisX: number;
  spanAxisZ: number;
  depthAxisX: number;
  depthAxisZ: number;
  radius: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  intensity: number;
  edgeTiles: number;
  interiorTiles: number;
  bedBudget: number;
  plumeBudget: number;
  sourceIdx: number;
  baseY: number;
  tiles: number[];
};

const fireVertexShader = `
  attribute float aIntensity;
  attribute float aSeed;
  attribute float aBaseCurve;
  attribute float aClusterBlend;
  attribute float aSmokeOcc;
  attribute float aRole;

  uniform float uTime;
  uniform vec2 uWind;

  varying vec2 vUv;
  varying float vIntensity;
  varying float vSeed;
  varying float vBaseCurve;
  varying float vClusterBlend;
  varying float vSmokeOcc;
  varying float vRole;

  void main() {
    vUv = uv;
    vIntensity = aIntensity;
    vSeed = aSeed;
    vBaseCurve = aBaseCurve;
    vClusterBlend = aClusterBlend;
    vSmokeOcc = aSmokeOcc;
    vRole = aRole;

    vec3 transformed = position;
    float windMag = length(uWind);
    float frontRole = step(2.5, aRole);
    float edgeFade = 1.0 - uv.y;
    float wobblePhase = uTime * (1.25 + windMag * 0.7) + aSeed * 31.7 + uv.y * 7.5;
    float windPhase = uTime * (1.45 + windMag * 0.85) + aSeed * 17.9;
    float windGust = 0.7 + 0.3 * sin(windPhase);
    transformed.x += (sin(wobblePhase) + 0.35 * sin(wobblePhase * 1.5 + 1.4)) * 0.0075 * (0.32 + aIntensity) * edgeFade;
    transformed.y += sin(uTime * 1.3 + aSeed * 17.3) * 0.0048 * (0.3 + aIntensity) * edgeFade;
    float frontTopMask = smoothstep(0.28, 1.0, uv.y);
    float frontTongueA = sin(uTime * 12.6 + aSeed * 41.0 + uv.x * 18.0);
    float frontTongueB = sin(uTime * 17.7 + aSeed * 19.0 + uv.x * 31.0 + uv.y * 2.6);
    float frontTongueC = sin(uTime * 22.8 + aSeed * 53.0 + uv.x * 43.0 - uv.y * 5.1);
    float frontTongue = frontTongueA + 0.7 * frontTongueB + 0.34 * frontTongueC;
    float frontTongueLift = pow(max(0.0, frontTongue * 0.44), 1.24) * frontTopMask * frontTopMask;
    transformed.x += frontTongue * 0.0064 * frontRole * frontTopMask;
    transformed.y += frontTongueLift * 0.104 * frontRole;
    transformed.x += uWind.x * (0.006 + uv.y * uv.y * 0.038) * windGust * (0.2 + aIntensity * 0.5);
    transformed.z += uWind.y * (0.006 + uv.y * uv.y * 0.038) * windGust * (0.2 + aIntensity * 0.5);

    vec4 worldPosition = instanceMatrix * vec4(transformed, 1.0);
    float lean = uv.y * uv.y * (0.045 + aIntensity * 0.12 + windMag * 0.04);
    worldPosition.x += uWind.x * lean;
    worldPosition.z += uWind.y * lean;
    gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
  }
`;

const fireFragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform float uCore;
  uniform float uAlphaScale;

  varying vec2 vUv;
  varying float vIntensity;
  varying float vSeed;
  varying float vBaseCurve;
  varying float vClusterBlend;
  varying float vSmokeOcc;
  varying float vRole;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
  }

  float fbm(vec2 p) {
    float sum = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 4; i++) {
      sum += amp * noise(p);
      p = p * 2.03 + vec2(17.13, 9.31);
      amp *= 0.5;
    }
    return sum;
  }

  void main() {
    float clusterBlend = clamp(vClusterBlend, 0.0, 1.0);
    float smokeOcc = clamp(vSmokeOcc, 0.0, 1.0);
    float frontRole = smoothstep(2.5, 3.5, vRole);
    float role01 = clamp(vRole * 0.5, 0.0, 1.0);
    float x = (vUv.x * 2.0 - 1.0) * 1.12;
    float y = clamp(vUv.y * 1.08 - 0.04, 0.0, 1.02);
    float uvEdge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float boundaryFade = smoothstep(0.0, 0.095, uvEdge);

    float rise = uTime * (1.2 + vIntensity * 0.98 + vSeed * 0.24 + frontRole * 0.94);
    vec2 flowUv = vec2(x * 1.18 + (vSeed - 0.5) * 0.8, y * 2.18 - rise);
    float curlA = fbm(flowUv + vec2(uTime * 0.12, uTime * 0.31));
    float curlB = fbm(flowUv * 1.72 + vec2(vSeed * 7.0, uTime * 0.53));
    float curlC = fbm(flowUv * 2.3 + vec2(4.1, uTime * 0.86 + vSeed * 11.0));
    float turbulence = mix(curlA, curlB, 0.56);
    float detail = mix(curlB, curlC, 0.38);

    float xWarp = x +
      (turbulence - 0.5) * (0.16 - 0.09 * y) +
      sin(y * 9.4 + uTime * 3.0 + vSeed * 13.0) * 0.028 * (0.52 + vIntensity);

    float taper = mix(1.0, mix(0.56, 0.34, frontRole), smoothstep(0.05, 1.0, y));
    float frontRadiusScale = mix(1.0, 0.76, frontRole);
    float coreRadius = (0.24 + vIntensity * 0.22 + uCore * 0.05) * taper * frontRadiusScale;
    float lobeSpread = mix(1.0, 1.08, frontRole);
    float lobeShiftA = (0.22 + 0.05 * sin(vSeed * 6.283 + y * 6.6 + uTime * 1.2)) * taper * lobeSpread;
    float lobeShiftB = (-0.2 + 0.06 * cos(vSeed * 8.61 + y * 5.9 + uTime * 1.08)) * taper * lobeSpread;
    float lobeRadiusA = coreRadius * (0.46 + 0.1 * curlA);
    float lobeRadiusB = coreRadius * (0.4 + 0.1 * detail);

    float dCore = abs(xWarp) - coreRadius;
    float dLobeA = abs(xWarp - lobeShiftA) - lobeRadiusA;
    float dLobeB = abs(xWarp - lobeShiftB) - lobeRadiusB;
    float plasmaField = min(dCore, min(dLobeA, dLobeB));
    float shellMask = 1.0 - smoothstep(-0.02, 0.1, plasmaField);

    float radialNorm = abs(xWarp) / max(coreRadius + lobeRadiusA * 0.35 + lobeRadiusB * 0.35, 0.001);
    float radialFalloff = 1.0 - smoothstep(0.14, 1.0, radialNorm);
    float curlMask = smoothstep(0.22, 0.93, detail + (1.0 - y) * 0.42);
    float curveLift = clamp(vBaseCurve, 0.0, 1.0) * pow(abs(xWarp), 1.25) * 0.14;
    float baseFade = smoothstep(curveLift, curveLift + 0.05, y);
    float topTongueNoise = fbm(vec2(xWarp * 4.8 + vSeed * 13.7, y * 7.0 - uTime * 8.1));
    float topTongueWave = sin(xWarp * 19.2 - uTime * 17.7 + vSeed * 21.0) * 0.16;
    float tongueColumnsA = 0.5 + 0.5 * sin(xWarp * 15.8 - uTime * (14.4 + frontRole * 7.2) + vSeed * 17.0);
    float tongueColumnsB = 0.5 + 0.5 * sin(xWarp * 10.6 + uTime * (10.8 + frontRole * 5.1) + vSeed * 31.0);
    float tongueColumns = clamp(tongueColumnsA * 0.84 + tongueColumnsB * 0.58 + topTongueNoise * 0.86 - 0.7, 0.0, 1.0);
    float tongueShape = pow(tongueColumns, mix(1.0, 1.55, frontRole));
    float tongueSurge = 0.5 + 0.5 * sin(uTime * (9.6 + vSeed * 6.0) + xWarp * 4.8 + vSeed * 27.0);
    float tongueLift = frontRole * (tongueShape * (0.16 + tongueSurge * 0.14) + (topTongueNoise - 0.5) * 0.12);
    float topEdgeShift = frontRole * ((topTongueNoise - 0.5) * 0.54 + topTongueWave + tongueLift);
    float topFade = 1.0 - smoothstep(0.62, 0.94, y + (detail - 0.5) * 0.05 - topEdgeShift);
    float tongueGap = smoothstep(0.3, 0.9, y) * (1.0 - smoothstep(0.14, 0.58, tongueShape + (topTongueNoise - 0.5) * 0.16));
    float forkColumnsA = pow(max(0.0, 0.5 + 0.5 * sin(xWarp * 23.4 - uTime * 21.6 + vSeed * 29.0)), 5.6);
    float forkColumnsB = pow(max(0.0, 0.5 + 0.5 * sin(xWarp * 31.6 + uTime * 26.1 + vSeed * 43.0)), 6.4);
    float forkColumns = max(forkColumnsA, forkColumnsB * 0.9);
    float forkPeak = 0.48 + tongueShape * 0.2 + forkColumns * 0.28 + (topTongueNoise - 0.5) * 0.16;
    float forkCut = 1.0 - smoothstep(forkPeak, 1.02, y);
    float prongColumns = pow(max(0.0, 0.5 + 0.5 * sin(xWarp * 37.0 - uTime * 29.7 + vSeed * 37.0)), 6.8);
    float prongGap = smoothstep(0.56, 0.98, y) * smoothstep(0.52, 0.9, max(prongColumns, forkColumns * 0.84) + (topTongueNoise - 0.5) * 0.18);
    float splitPulse = 0.5 + 0.5 * sin(uTime * (11.7 + vSeed * 4.8) + xWarp * 6.2 + vSeed * 33.0);
    float splitGap = smoothstep(0.68, 1.0, y) * smoothstep(0.62, 0.92, splitPulse * prongColumns + (topTongueNoise - 0.5) * 0.22);
    float alpha = shellMask * radialFalloff * curlMask * baseFade * topFade * boundaryFade;
    float alphaBase = (0.42 + vIntensity * 0.66) * mix(1.0, 1.14, uCore);
    alpha *= alphaBase * uAlphaScale;
    alpha *= 0.78 + detail * 0.22;
    alpha *= mix(1.0, 0.56 + tongueShape * 0.56, frontRole);
    alpha *= 1.0 - frontRole * tongueGap * 0.9;
    alpha *= mix(1.0, forkCut, frontRole);
    alpha *= 1.0 - frontRole * prongGap * 0.86;
    alpha *= 1.0 - frontRole * splitGap * 0.72;
    alpha *= 1.0 - smokeOcc * smoothstep(0.35, 1.0, y) * clusterBlend * ${SMOKE_OCCL_STRENGTH_ALPHA.toFixed(2)};
    if (alpha < 0.012) {
      discard;
    }

    float heat = clamp(
      vIntensity * 0.56 +
      (1.0 - y) * 0.48 +
      (1.0 - radialNorm) * 0.3 +
      detail * 0.24 +
      uCore * 0.16,
      0.0,
      1.0
    );
    vec3 deepRed = vec3(0.33, 0.03, 0.01);
    vec3 emberRed = vec3(0.68, 0.09, 0.02);
    vec3 orange = vec3(0.95, 0.31, 0.05);
    vec3 whiteHot = vec3(1.0, 0.78, 0.5);
    float baseHot = smoothstep(0.0, 0.52, heat);
    vec3 color = mix(deepRed, emberRed, baseHot);
    color = mix(color, orange, smoothstep(0.28, 0.84, heat));

    float thickness = radialFalloff * (0.8 + detail * 0.2) * (1.0 - y * 0.24);
    float whiteMask = smoothstep(0.9, 1.0, heat) * (1.0 - smoothstep(0.26, 0.78, y)) * (1.0 - smoothstep(0.38, 0.92, radialNorm));
    color = mix(color, whiteHot, whiteMask * 0.18);
    float edgeCool = smoothstep(0.32, 1.0, radialNorm);
    vec3 edgeColor = mix(deepRed, emberRed, 0.5);
    color = mix(color, edgeColor, edgeCool * 0.76);
    float baseBand = mix(1.0, 1.32, clusterBlend) * mix(1.0, 1.12, role01) * (1.0 - smoothstep(0.28, 0.92, y));
    float topBand = 1.0 - clusterBlend * smoothstep(0.42, 1.0, y) * 0.34;
    float emissive = (0.84 + heat * 0.44 + thickness * 0.42 + uCore * 0.14) * baseBand * topBand;
    emissive *= 1.0 - smokeOcc * smoothstep(0.45, 1.0, y) * clusterBlend * ${SMOKE_OCCL_STRENGTH_EMISSIVE.toFixed(2)};
    float over = max(0.0, emissive - ${EMISSIVE_KNEE.toFixed(2)});
    emissive = min(${EMISSIVE_CLAMP.toFixed(2)}, ${EMISSIVE_KNEE.toFixed(2)} + over / (1.0 + over / max(0.0001, ${(
      EMISSIVE_CLAMP - EMISSIVE_KNEE
    ).toFixed(2)})));
    color *= emissive * (1.0 - edgeCool * 0.18);

    gl_FragColor = vec4(color, max(alpha, 0.0));
  }
`;

const createFireShaderMaterial = (core: number, alphaScale: number): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    vertexShader: fireVertexShader,
    fragmentShader: fireFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uCore: { value: core },
      uAlphaScale: { value: alphaScale },
      uWind: { value: new THREE.Vector2() }
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  });

const ashPreviewVertexShader = `
  attribute float aProgress;
  attribute float aSeed;

  varying vec2 vUv;
  varying float vProgress;
  varying float vSeed;

  void main() {
    vUv = uv;
    vProgress = clamp(aProgress, 0.0, 1.2);
    vSeed = aSeed;
    vec4 worldPosition = instanceMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * modelViewMatrix * worldPosition;
  }
`;

const ashPreviewFragmentShader = `
  precision highp float;

  uniform float uTime;
  uniform vec3 uAshBaseColor;
  uniform vec3 uAshWarmScorchColor;
  uniform vec3 uAshCharScorchColor;

  varying vec2 vUv;
  varying float vProgress;
  varying float vSeed;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }

  void main() {
    float progress = clamp(vProgress, 0.0, 1.0);
    if (progress <= 0.01) {
      discard;
    }

    // Use larger dither cells so scorch-to-ash transitions form broader patches
    // and reduce high-frequency jagged edges along the ash field boundary.
    vec2 coarseCell = floor(vUv * vec2(8.0, 8.0) + vec2(vSeed * 37.1, vSeed * 19.7));
    vec2 fineCell = floor(vUv * vec2(16.0, 16.0) + vec2(vSeed * 83.3, vSeed * 41.9));
    float coarse = hash(coarseCell);
    float fine = hash(fineCell);
    float checker = mod(floor(vUv.x * 10.0) + floor(vUv.y * 10.0) + floor(vSeed * 29.0), 2.0);
    float dither = clamp(mix(coarse, fine, 0.38) * 0.88 + checker * 0.12, 0.0, 1.0);
    float coverage = clamp(pow(progress, 0.62) * 1.15, 0.0, 1.0);
    if (dither > coverage) {
      discard;
    }

    float edge = min(min(vUv.x, 1.0 - vUv.x), min(vUv.y, 1.0 - vUv.y));
    float edgeFade = smoothstep(0.0, 0.05, edge);
    vec3 warmScorch = uAshWarmScorchColor;
    vec3 charScorch = uAshCharScorchColor;
    float ashNoise = hash(floor(vUv * vec2(7.0, 7.0) + vec2(vSeed * 71.0, vSeed * 37.0)));
    vec3 ashNear = mix(
      uAshBaseColor * vec3(1.05, 1.0, 0.94),
      uAshBaseColor * vec3(0.94, 0.92, 1.02),
      ashNoise
    );
    float charT = smoothstep(0.08, 0.58, progress);
    float ashT = smoothstep(0.24, 1.0, progress);
    vec3 color = mix(warmScorch, charScorch, charT);
    color = mix(color, ashNear, ashT);
    color *= mix(0.92, 1.03, ashNoise);
    float alpha = (0.22 + progress * 0.62) * edgeFade;
    gl_FragColor = vec4(color * alpha, alpha);
  }
`;

const createAshPreviewMaterial = (): THREE.ShaderMaterial => {
  const ashBaseColor = new THREE.Color(TILE_COLORS.ash);
  const ashWarmScorchColor = ashBaseColor.clone().lerp(new THREE.Color(0.34, 0.27, 0.2), 0.62);
  const ashCharScorchColor = ashBaseColor.clone().lerp(new THREE.Color(0.25, 0.22, 0.2), 0.45);
  return new THREE.ShaderMaterial({
    vertexShader: ashPreviewVertexShader,
    fragmentShader: ashPreviewFragmentShader,
    uniforms: {
      uTime: { value: 0 },
      uAshBaseColor: { value: ashBaseColor },
      uAshWarmScorchColor: { value: ashWarmScorchColor },
      uAshCharScorchColor: { value: ashCharScorchColor }
    },
    transparent: true,
    premultipliedAlpha: true,
    depthWrite: false,
    depthTest: true,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
    blending: THREE.NormalBlending,
    side: THREE.DoubleSide,
    toneMapped: false
  });
};

const createRadialTexture = (size: number, stops: Array<{ stop: number; color: string }>): THREE.CanvasTexture => {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported");
  }
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  stops.forEach((entry) => {
    gradient.addColorStop(entry.stop, entry.color);
  });
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
};

export type ThreeTestFireFx = {
  captureSnapshot: (world: RenderSim) => void;
  setSimulationAlpha: (alpha: number) => void;
  update: (
    time: number,
    world: RenderSim,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null,
    treeBurn: TreeBurnController | null,
    fpsEstimate: number,
    sceneRenderMs: number
  ) => void;
  setEnvironmentSignals: (signals: FireFxEnvironmentSignals) => void;
  setDebugControls: (controls: Partial<FireFxDebugControls>) => void;
  getDebugControls: () => FireFxDebugControls;
  getSparkDebugSnapshot: () => SparkDebugSnapshot;
  dispose: () => void;
};

export const createThreeTestFireFx = (
  scene: THREE.Scene,
  camera: THREE.Camera,
  options: ThreeTestFireFxOptions = {}
): ThreeTestFireFx => {
  let debugControls = normalizeFireFxDebugControls(options);
  const smokeWarmBase = new THREE.Color(0.56, 0.46, 0.37);
  const smokeWarmHot = new THREE.Color(0.8, 0.46, 0.24);
  const smokeCoolBase = new THREE.Color(0.43, 0.41, 0.4);
  const smokeCoolHot = new THREE.Color(0.54, 0.42, 0.34);
  const smokeStainBase = new THREE.Color(0.74, 0.33, 0.11);
  const smokeStainHot = new THREE.Color(0.96, 0.39, 0.12);
  const smokeUnderglowBase = new THREE.Color(0.92, 0.32, 0.12);
  const smokeUnderglowHot = new THREE.Color(0.99, 0.4, 0.14);
  const smokeWarmScratch = new THREE.Color();
  const smokeCoolScratch = new THREE.Color();
  const smokeStainScratch = new THREE.Color();
  const smokeUnderglowScratch = new THREE.Color();
  const smokeTintScratch = new THREE.Color();
  const sunDirectionTarget = new THREE.Vector3(0.68, 0.74, 0.2).normalize();
  const sunDirectionCurrent = sunDirectionTarget.clone();
  const sunTintTarget = new THREE.Color(1.0, 0.62, 0.28);
  const sunTintCurrent = sunTintTarget.clone();
  const smokeTintTarget = new THREE.Color(0.56, 0.46, 0.37);
  const smokeTintCurrent = smokeTintTarget.clone();
  const envTarget: FireFxEnvironmentSignals = {
    smoke01: 0,
    denseSmoke01: 0,
    fireLoad01: 0,
    orangeGlow01: 0,
    sunDirection: sunDirectionTarget.clone(),
    sunTint: sunTintTarget.clone(),
    smokeTint: smokeTintTarget.clone()
  };
  const envCurrent: FireFxEnvironmentSignals = {
    smoke01: 0,
    denseSmoke01: 0,
    fireLoad01: 0,
    orangeGlow01: 0,
    sunDirection: sunDirectionCurrent.clone(),
    sunTint: sunTintCurrent.clone(),
    smokeTint: smokeTintCurrent.clone()
  };
  const glowTexture = createRadialTexture(96, [
    { stop: 0, color: "rgba(255, 198, 118, 0.94)" },
    { stop: 0.18, color: "rgba(255, 126, 48, 0.74)" },
    { stop: 0.5, color: "rgba(232, 78, 28, 0.38)" },
    { stop: 0.82, color: "rgba(136, 28, 10, 0.14)" },
    { stop: 1, color: "rgba(0, 0, 0, 0)" }
  ]);
  const emberTexture = createRadialTexture(64, [
    { stop: 0, color: "rgba(255, 216, 156, 1)" },
    { stop: 0.4, color: "rgba(255, 132, 56, 0.92)" },
    { stop: 1, color: "rgba(0, 0, 0, 0)" }
  ]);
  const sparkStreakTexture = createRadialTexture(96, [
    { stop: 0, color: "rgba(255, 220, 170, 1)" },
    { stop: 0.24, color: "rgba(255, 164, 90, 0.95)" },
    { stop: 0.58, color: "rgba(246, 108, 42, 0.58)" },
    { stop: 1, color: "rgba(0, 0, 0, 0)" }
  ]);
  const fireMaterial = createFireShaderMaterial(0, 0.92 * debugControls.flameIntensityBoost);
  const fireCrossMaterial = createFireShaderMaterial(0, 0.58 * debugControls.flameIntensityBoost);
  const fireCoreMaterial = createFireShaderMaterial(1, 0.68 * debugControls.flameIntensityBoost);
  const ashPreviewMaterial = createAshPreviewMaterial();
  const smokeMaterial = createSmokeShaderMaterial({
    pointScale: 240,
    // Keep smoke heavy and ashy with an orange fire-stained base in severe burn fronts.
    warmColor: smokeWarmBase.clone(),
    coolColor: smokeCoolBase.clone(),
    warmStainColor: smokeStainBase.clone(),
    underglowColor: smokeUnderglowBase.clone(),
    underglowStrength: 0,
    sunDirection: new THREE.Vector3(0.68, 0.74, 0.2),
    sunTint: new THREE.Color(1.0, 0.62, 0.28),
    baseSigma: 8.8,
    thinThickness: 1.7,
    thickThickness: 4.4,
    scatterStrength: 0.35,
    occlusionStrength: 1.05
  });
  const groundGlowMaterial = new THREE.MeshBasicMaterial({
    map: glowTexture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexColors: true,
    opacity: 0.96,
    toneMapped: false
  });
  const emberMaterial = new THREE.MeshBasicMaterial({
    map: emberTexture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexColors: true,
    opacity: 1,
    toneMapped: false
  });
  const sparkDebugEmberMaterial = new THREE.MeshBasicMaterial({
    map: emberTexture,
    color: 0xff40ff,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexColors: true,
    opacity: 1,
    toneMapped: false
  });
  const sparkDebugStreakMaterial = new THREE.MeshBasicMaterial({
    map: sparkStreakTexture,
    color: 0xff40ff,
    transparent: true,
    alphaTest: 0.02,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexColors: true,
    opacity: 1,
    toneMapped: false
  });
  const sparkStreakMaterial = new THREE.MeshBasicMaterial({
    map: sparkStreakTexture,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexColors: true,
    opacity: 1,
    toneMapped: false
  });
  const sparkPointMaterial = new THREE.PointsMaterial({
    map: emberTexture,
    transparent: true,
    alphaTest: 0.01,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    vertexColors: true,
    size: debugControls.sparkDebug ? 4 : 1.4,
    sizeAttenuation: false,
    opacity: debugControls.sparkDebug ? 1 : 0.95,
    toneMapped: false
  });
  const fireGeometry = new THREE.PlaneGeometry(1, 1, 6, 10);
  const fireCrossGeometry = new THREE.PlaneGeometry(1, 1, 4, 8);
  const fireCoreGeometry = new THREE.PlaneGeometry(1, 1, 4, 8);
  const smokeBuffers = createParticleBuffers(SMOKE_MAX_INSTANCES);
  const ashPreviewGeometry = new THREE.PlaneGeometry(1, 1);
  const groundGlowGeometry = new THREE.PlaneGeometry(1, 1);
  const emberGeometry = new THREE.PlaneGeometry(1, 1);
  const sparkStreakGeometry = new THREE.PlaneGeometry(1, 1);
  const sparkPointGeometry = new THREE.BufferGeometry();
  fireGeometry.translate(0, 0.5, 0);
  fireCrossGeometry.translate(0, 0.5, 0);
  fireCoreGeometry.translate(0, 0.5, 0);
  sparkStreakGeometry.translate(0, 0.5, 0);
  ashPreviewGeometry.rotateX(-Math.PI / 2);
  groundGlowGeometry.rotateX(-Math.PI / 2);
  const fireIntensityAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_MAX_INSTANCES), 1);
  const fireSeedAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_MAX_INSTANCES), 1);
  const fireBaseCurveAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_MAX_INSTANCES), 1);
  const fireClusterBlendAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_MAX_INSTANCES), 1);
  const fireSmokeOccAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_MAX_INSTANCES), 1);
  const fireRoleAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_MAX_INSTANCES), 1);
  const fireCrossIntensityAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_CROSS_MAX_INSTANCES), 1);
  const fireCrossSeedAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_CROSS_MAX_INSTANCES), 1);
  const fireCrossBaseCurveAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_CROSS_MAX_INSTANCES), 1);
  const fireCrossClusterBlendAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_CROSS_MAX_INSTANCES), 1);
  const fireCrossSmokeOccAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_CROSS_MAX_INSTANCES), 1);
  const fireCrossRoleAttr = new THREE.InstancedBufferAttribute(new Float32Array(FIRE_CROSS_MAX_INSTANCES), 1);
  const ashPreviewProgressAttr = new THREE.InstancedBufferAttribute(new Float32Array(ASH_PREVIEW_MAX_INSTANCES), 1);
  const ashPreviewSeedAttr = new THREE.InstancedBufferAttribute(new Float32Array(ASH_PREVIEW_MAX_INSTANCES), 1);
  fireIntensityAttr.setUsage(THREE.DynamicDrawUsage);
  fireSeedAttr.setUsage(THREE.DynamicDrawUsage);
  fireBaseCurveAttr.setUsage(THREE.DynamicDrawUsage);
  fireClusterBlendAttr.setUsage(THREE.DynamicDrawUsage);
  fireSmokeOccAttr.setUsage(THREE.DynamicDrawUsage);
  fireRoleAttr.setUsage(THREE.DynamicDrawUsage);
  fireCrossIntensityAttr.setUsage(THREE.DynamicDrawUsage);
  fireCrossSeedAttr.setUsage(THREE.DynamicDrawUsage);
  fireCrossBaseCurveAttr.setUsage(THREE.DynamicDrawUsage);
  fireCrossClusterBlendAttr.setUsage(THREE.DynamicDrawUsage);
  fireCrossSmokeOccAttr.setUsage(THREE.DynamicDrawUsage);
  fireCrossRoleAttr.setUsage(THREE.DynamicDrawUsage);
  ashPreviewProgressAttr.setUsage(THREE.DynamicDrawUsage);
  ashPreviewSeedAttr.setUsage(THREE.DynamicDrawUsage);
  fireGeometry.setAttribute("aIntensity", fireIntensityAttr);
  fireGeometry.setAttribute("aSeed", fireSeedAttr);
  fireGeometry.setAttribute("aBaseCurve", fireBaseCurveAttr);
  fireGeometry.setAttribute("aClusterBlend", fireClusterBlendAttr);
  fireGeometry.setAttribute("aSmokeOcc", fireSmokeOccAttr);
  fireGeometry.setAttribute("aRole", fireRoleAttr);
  fireCrossGeometry.setAttribute("aIntensity", fireCrossIntensityAttr);
  fireCrossGeometry.setAttribute("aSeed", fireCrossSeedAttr);
  fireCrossGeometry.setAttribute("aBaseCurve", fireCrossBaseCurveAttr);
  fireCrossGeometry.setAttribute("aClusterBlend", fireCrossClusterBlendAttr);
  fireCrossGeometry.setAttribute("aSmokeOcc", fireCrossSmokeOccAttr);
  fireCrossGeometry.setAttribute("aRole", fireCrossRoleAttr);
  ashPreviewGeometry.setAttribute("aProgress", ashPreviewProgressAttr);
  ashPreviewGeometry.setAttribute("aSeed", ashPreviewSeedAttr);
  fireCoreGeometry.setAttribute("aIntensity", fireIntensityAttr);
  fireCoreGeometry.setAttribute("aSeed", fireSeedAttr);
  fireCoreGeometry.setAttribute("aBaseCurve", fireBaseCurveAttr);
  fireCoreGeometry.setAttribute("aClusterBlend", fireClusterBlendAttr);
  fireCoreGeometry.setAttribute("aSmokeOcc", fireSmokeOccAttr);
  fireCoreGeometry.setAttribute("aRole", fireRoleAttr);
  const fireMesh = new THREE.InstancedMesh(fireGeometry, fireMaterial, FIRE_MAX_INSTANCES);
  fireMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fireMesh.renderOrder = 6;
  fireMesh.frustumCulled = false;
  fireMesh.count = 0;
  scene.add(fireMesh);
  const fireCrossMesh = new THREE.InstancedMesh(fireCrossGeometry, fireCrossMaterial, FIRE_CROSS_MAX_INSTANCES);
  fireCrossMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fireCrossMesh.renderOrder = 6;
  fireCrossMesh.frustumCulled = false;
  fireCrossMesh.count = 0;
  scene.add(fireCrossMesh);
  const fireCoreMesh = new THREE.InstancedMesh(fireCoreGeometry, fireCoreMaterial, FIRE_MAX_INSTANCES);
  fireCoreMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  fireCoreMesh.renderOrder = 7;
  fireCoreMesh.frustumCulled = false;
  fireCoreMesh.count = 0;
  scene.add(fireCoreMesh);
  const ashPreviewMesh = new THREE.InstancedMesh(ashPreviewGeometry, ashPreviewMaterial, ASH_PREVIEW_MAX_INSTANCES);
  ashPreviewMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  ashPreviewMesh.renderOrder = 5;
  ashPreviewMesh.frustumCulled = false;
  ashPreviewMesh.count = 0;
  scene.add(ashPreviewMesh);
  const groundGlowMesh = new THREE.InstancedMesh(groundGlowGeometry, groundGlowMaterial, GLOW_MAX_INSTANCES);
  groundGlowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  groundGlowMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(GLOW_MAX_INSTANCES * 3), 3);
  groundGlowMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  groundGlowMesh.renderOrder = 4;
  groundGlowMesh.frustumCulled = false;
  groundGlowMesh.count = 0;
  scene.add(groundGlowMesh);
  const smokePoints = new THREE.Points(smokeBuffers.geometry, smokeMaterial);
  smokePoints.renderOrder = 5;
  smokePoints.frustumCulled = false;
  scene.add(smokePoints);
  const emberMesh = new THREE.InstancedMesh(
    emberGeometry,
    debugControls.sparkDebug ? sparkDebugEmberMaterial : emberMaterial,
    EMBER_MAX_INSTANCES
  );
  emberMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  emberMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(EMBER_MAX_INSTANCES * 3), 3);
  emberMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  emberMesh.renderOrder = debugControls.sparkDebug ? 12 : 9;
  emberMesh.frustumCulled = false;
  emberMesh.count = 0;
  scene.add(emberMesh);
  const sparkStreakMesh = new THREE.InstancedMesh(
    sparkStreakGeometry,
    debugControls.sparkDebug ? sparkDebugStreakMaterial : sparkStreakMaterial,
    SPARK_STREAK_MAX_INSTANCES
  );
  sparkStreakMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  sparkStreakMesh.instanceColor = new THREE.InstancedBufferAttribute(
    new Float32Array(SPARK_STREAK_MAX_INSTANCES * 3),
    3
  );
  sparkStreakMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
  sparkStreakMesh.renderOrder = debugControls.sparkDebug ? 13 : 10;
  sparkStreakMesh.frustumCulled = false;
  sparkStreakMesh.count = 0;
  scene.add(sparkStreakMesh);
  const sparkPointPositions = new Float32Array(SPARK_POINT_MAX_INSTANCES * 3);
  const sparkPointColors = new Float32Array(SPARK_POINT_MAX_INSTANCES * 3);
  const sparkPointPositionAttr = new THREE.BufferAttribute(sparkPointPositions, 3);
  const sparkPointColorAttr = new THREE.BufferAttribute(sparkPointColors, 3);
  sparkPointPositionAttr.setUsage(THREE.DynamicDrawUsage);
  sparkPointColorAttr.setUsage(THREE.DynamicDrawUsage);
  sparkPointGeometry.setAttribute("position", sparkPointPositionAttr);
  sparkPointGeometry.setAttribute("color", sparkPointColorAttr);
  sparkPointGeometry.setDrawRange(0, 0);
  const sparkPoints = new THREE.Points(sparkPointGeometry, sparkPointMaterial);
  sparkPoints.renderOrder = debugControls.sparkDebug ? 14 : 11;
  sparkPoints.frustumCulled = false;
  scene.add(sparkPoints);

  const applySparkDebugPresentation = (): void => {
    const sparkDebug = debugControls.sparkDebug;
    emberMesh.material = sparkDebug ? sparkDebugEmberMaterial : emberMaterial;
    sparkStreakMesh.material = sparkDebug ? sparkDebugStreakMaterial : sparkStreakMaterial;
    emberMesh.renderOrder = sparkDebug ? 12 : 9;
    sparkStreakMesh.renderOrder = sparkDebug ? 13 : 10;
    sparkPoints.renderOrder = sparkDebug ? 14 : 11;
    sparkPointMaterial.size = sparkDebug ? 4 : 1.4;
    sparkPointMaterial.opacity = sparkDebug ? 1 : 0.95;
    sparkPointMaterial.needsUpdate = true;
  };
  applySparkDebugPresentation();

  const fireBillboard = new THREE.Object3D();
  const fireCrossBillboard = new THREE.Object3D();
  const ashPreviewBillboard = new THREE.Object3D();
  const groundGlowBillboard = new THREE.Object3D();
  const emberBillboard = new THREE.Object3D();
  const sparkStreakBillboard = new THREE.Object3D();
  const ashPreviewNormal = new THREE.Vector3(0, 1, 0);
  const ashPreviewOffset = new THREE.Vector3();
  let previousTimeMs: number | null = null;
  let tileStateCols = 0;
  let tileStateRows = 0;
  let tileFlameVisual = new Float32Array(0);
  let tileIgnitionAgeSeconds = new Float32Array(0);
  let tileAshPreviewVisual = new Float32Array(0);
  let tileSmokeVisual = new Float32Array(0);
  let tileFrontStrength = new Float32Array(0);
  let tileFuelReference = new Float32Array(0);
  let tileSmokeSpawnAccum = new Float32Array(0);
  let tileActiveFlag = new Uint8Array(0);
  let tileClusterId = new Int32Array(0);
  let tileClusterRole = new Uint8Array(0);
  let tileSmokeOcclusion01 = new Float32Array(0);
  let clusterQueue = new Int32Array(0);
  const fireClusterPool: FireCluster[] = [];
  const fireClusters: FireCluster[] = [];
  let lastClusterRebuildMs = -Infinity;
  let lastClusterActiveTileCount = 0;
  let lastClusterSampleStep = 1;
  let lastClusterMinX = -1;
  let lastClusterMaxX = -1;
  let lastClusterMinY = -1;
  let lastClusterMaxY = -1;
  let smokeSpawnCursor = 0;
  let smokeSpawnSequence = 0;
  const smokeParticleActive = new Uint8Array(SMOKE_MAX_INSTANCES);
  const smokeParticleAge = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleLife = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleX = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleY = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleZ = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleVx = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleVy = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleVz = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSeed = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleIntensity = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSoot = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleBaseSize = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSourceX = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSourceY = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSourceZ = new Float32Array(SMOKE_MAX_INSTANCES);
  const smokeParticleSourceIdx = new Int32Array(SMOKE_MAX_INSTANCES).fill(-1);
  const smokeRenderOrder = new Uint16Array(SMOKE_MAX_INSTANCES);
  const smokeRenderDepth = new Float32Array(SMOKE_MAX_INSTANCES);
  const cameraWorldPos = new THREE.Vector3();
  const cameraForward = new THREE.Vector3();
  const sparkSizeScratch = new THREE.Vector3();
  const sparkDirectionScratch = new THREE.Vector3();
  let pendingDeltaSeconds = 0;
  let lastRebuildTimeMs = -Infinity;
  let visualsCleared = true;
  let fireSimulationAlpha = 1;
  let previousFireSnapshot: FireRenderSnapshot | null = null;
  let currentFireSnapshot: FireRenderSnapshot | null = null;
  let smokeBudgetScale = 1;
  let flameBudgetScale = 1;
  let smokeFallbackAccum = 0;
  let smokeRecoveryAccum = 0;
  let flameFallbackAccum = 0;
  let flameRecoveryAccum = 0;
  let sparkDebugSnapshot: SparkDebugSnapshot = {
    visibleFlameTiles: 0,
    heroTipSparkAttempts: 0,
    heroTipSparkEmitted: 0,
    freeEmberAttempts: 0,
    freeEmberEmitted: 0,
    droppedByInstanceCap: 0,
    finalSparkInstanceCount: 0,
    clusterCount: 0,
    clusteredTiles: 0,
    clusterBedInstances: 0,
    clusterPlumeSpawns: 0,
    mode: debugControls.sparkMode
  };

  const clearVisuals = (): void => {
    fireMesh.count = 0;
    fireCrossMesh.count = 0;
    fireCoreMesh.count = 0;
    ashPreviewMesh.count = 0;
    groundGlowMesh.count = 0;
    smokeBuffers.geometry.setDrawRange(0, 0);
    emberMesh.count = 0;
    sparkStreakMesh.count = 0;
    sparkPointGeometry.setDrawRange(0, 0);
    sparkDebugSnapshot = {
      visibleFlameTiles: 0,
      heroTipSparkAttempts: 0,
      heroTipSparkEmitted: 0,
      freeEmberAttempts: 0,
      freeEmberEmitted: 0,
      droppedByInstanceCap: 0,
      finalSparkInstanceCount: 0,
      clusterCount: 0,
      clusteredTiles: 0,
      clusterBedInstances: 0,
      clusterPlumeSpawns: 0,
      mode: debugControls.sparkMode
    };
    visualsCleared = true;
  };

  const setSimulationAlpha = (alpha: number): void => {
    fireSimulationAlpha = clamp(alpha, 0, 1);
  };

  const captureSnapshot = (world: RenderSim): void => {
    const gridChanged =
      !currentFireSnapshot ||
      currentFireSnapshot.cols !== world.grid.cols ||
      currentFireSnapshot.rows !== world.grid.rows;
    const previousSource = gridChanged ? null : currentFireSnapshot;
    const nextSnapshot = captureFireRenderSnapshot(world, previousSource);
    if (gridChanged || !currentFireSnapshot) {
      previousFireSnapshot = nextSnapshot;
      currentFireSnapshot = nextSnapshot;
      return;
    }
    previousFireSnapshot = currentFireSnapshot;
    currentFireSnapshot = nextSnapshot;
  };

  const ensureClusterState = (count: number): void => {
    if (tileActiveFlag.length !== count) {
      tileActiveFlag = new Uint8Array(count);
      tileClusterId = new Int32Array(count).fill(-1);
      tileClusterRole = new Uint8Array(count);
      tileSmokeOcclusion01 = new Float32Array(count);
      clusterQueue = new Int32Array(count);
      fireClusters.length = 0;
      fireClusterPool.length = 0;
      lastClusterRebuildMs = -Infinity;
      lastClusterActiveTileCount = 0;
      lastClusterSampleStep = 1;
      lastClusterMinX = -1;
      lastClusterMaxX = -1;
      lastClusterMinY = -1;
      lastClusterMaxY = -1;
    }
  };

  const setEnvironmentSignals = (signals: FireFxEnvironmentSignals): void => {
    envTarget.smoke01 = clamp(signals.smoke01, 0, 1);
    envTarget.denseSmoke01 = clamp(signals.denseSmoke01, 0, 1);
    envTarget.fireLoad01 = clamp(signals.fireLoad01, 0, 1);
    envTarget.orangeGlow01 = clamp(signals.orangeGlow01, 0, 1);
    if (signals.sunDirection) {
      sunDirectionTarget.set(signals.sunDirection.x, signals.sunDirection.y, signals.sunDirection.z).normalize();
    }
    if (signals.sunTint) {
      sunTintTarget.set(signals.sunTint);
    }
    if (signals.smokeTint) {
      smokeTintTarget.set(signals.smokeTint);
    }
  };

  const ensureTileState = (cols: number, rows: number): void => {
    if (cols === tileStateCols && rows === tileStateRows) {
      return;
    }
    const count = Math.max(0, cols * rows);
    tileStateCols = cols;
    tileStateRows = rows;
    tileFlameVisual = new Float32Array(count);
    tileIgnitionAgeSeconds = new Float32Array(count);
    tileAshPreviewVisual = new Float32Array(count);
    tileSmokeVisual = new Float32Array(count);
    tileFrontStrength = new Float32Array(count);
    tileFuelReference = new Float32Array(count);
    tileSmokeSpawnAccum = new Float32Array(count);
    ensureClusterState(count);
  };

  type ClusterBudgetState = {
    clusteredTiles: number;
    clusterCoverage: number;
    reserveBed: number;
    reservePlume: number;
    reserveTileJets: number;
  };

  const releaseFireClusters = (): void => {
    while (fireClusters.length > 0) {
      const cluster = fireClusters.pop();
      if (!cluster) {
        break;
      }
      cluster.tiles.length = 0;
      fireClusterPool.push(cluster);
    }
  };

  const allocFireCluster = (): FireCluster => {
    const cluster = fireClusterPool.pop();
    if (cluster) {
      cluster.tiles.length = 0;
      cluster.tileCount = 0;
      cluster.centroidX = 0;
      cluster.centroidZ = 0;
      cluster.spanAxisX = 1;
      cluster.spanAxisZ = 0;
      cluster.depthAxisX = 0;
      cluster.depthAxisZ = 1;
      cluster.radius = 0;
      cluster.minX = 0;
      cluster.maxX = 0;
      cluster.minY = 0;
      cluster.maxY = 0;
      cluster.intensity = 0;
      cluster.edgeTiles = 0;
      cluster.interiorTiles = 0;
      cluster.bedBudget = 0;
      cluster.plumeBudget = 0;
      cluster.sourceIdx = -1;
      cluster.baseY = 0;
      return cluster;
    }
    return {
      id: -1,
      tileCount: 0,
      centroidX: 0,
      centroidZ: 0,
      spanAxisX: 1,
      spanAxisZ: 0,
      depthAxisX: 0,
      depthAxisZ: 1,
      radius: 0,
      minX: 0,
      maxX: 0,
      minY: 0,
      maxY: 0,
      intensity: 0,
      edgeTiles: 0,
      interiorTiles: 0,
      bedBudget: 0,
      plumeBudget: 0,
      sourceIdx: -1,
      baseY: 0,
      tiles: []
    };
  };

  const buildFireClusters = (
    world: RenderSim,
    fireView: FireFieldView,
    cols: number,
    rows: number,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    sampleStep: number,
    simFireEps: number,
    windX: number,
    windZ: number,
    treeBurn: TreeBurnController | null,
    terrainSize: { width: number; depth: number },
    heightScale: number
  ): { clusterCount: number; clusteredTiles: number } => {
    tileActiveFlag.fill(0);
    tileClusterId.fill(-1);
    tileClusterRole.fill(0);
    tileSmokeOcclusion01.fill(0);
    releaseFireClusters();
    let queueHead = 0;
    let queueTail = 0;

    for (let y = minY; y <= maxY; y += sampleStep) {
      for (let x = minX; x <= maxX; x += sampleStep) {
        const idx = y * cols + x;
        const fire = fireView.getFireByIndex(idx);
        const heat = fireView.getHeat01ByIndex(idx);
        const fuel = fireView.getFuelByIndex(idx);
        const isAshTile = (world.tileTypeId[idx] ?? -1) === TILE_TYPE_IDS.ash;
        const flameProfile: TreeFlameProfile | null = treeBurn?.getTileFlameProfile(idx) ?? null;
        const burnProgress = treeBurn?.getTileBurnProgress(idx) ?? 0;
        const treeBurnVisual = treeBurn?.getTileBurnVisual(idx) ?? 0;
        const hasCarryFuel = fuel > TREE_BURN_CARRY_FUEL_MIN && !isAshTile;
        const hasTreeCarryFlame =
          hasCarryFuel &&
          flameProfile !== null &&
          treeBurnVisual > TREE_BURN_FLAME_VISUAL_MIN &&
          burnProgress > TREE_BURN_CARRY_PROGRESS_MIN &&
          heat > 0.08;
        if (fire > simFireEps || hasTreeCarryFlame) {
          tileActiveFlag[idx] = 1;
        }
      }
    }

    let clusterId = 0;
    let clusteredTiles = 0;
    for (let y = minY; y <= maxY; y += 1) {
      const rowBase = y * cols;
      for (let x = minX; x <= maxX; x += 1) {
        const idx = rowBase + x;
        if (tileActiveFlag[idx] === 0 || tileClusterId[idx] >= 0) {
          continue;
        }
        const cluster = allocFireCluster();
        cluster.id = clusterId;
        cluster.minX = x;
        cluster.maxX = x;
        cluster.minY = y;
        cluster.maxY = y;
        cluster.sourceIdx = idx;
        let weightedX = 0;
        let weightedZ = 0;
        let weightedY = 0;
        let weightSum = 0;
        let weightMax = 0;
        queueHead = 0;
        queueTail = 0;
        clusterQueue[queueTail++] = idx;
        tileClusterId[idx] = clusterId;
        while (queueHead < queueTail) {
          const current = clusterQueue[queueHead++];
          const cx = current % cols;
          const cy = Math.floor(current / cols);
          cluster.tiles.push(current);
          cluster.tileCount += 1;
          if (cx < cluster.minX) {
            cluster.minX = cx;
          }
          if (cx > cluster.maxX) {
            cluster.maxX = cx;
          }
          if (cy < cluster.minY) {
            cluster.minY = cy;
          }
          if (cy > cluster.maxY) {
            cluster.maxY = cy;
          }
          const fire = fireView.getFireByIndex(current);
          const heat = fireView.getHeat01ByIndex(current);
          const treeBurnVisual = treeBurn?.getTileBurnVisual(current) ?? 0;
          const w = clamp(Math.max(fire, heat * 0.5, treeBurnVisual * 0.75), 0.01, 1.4);
          const worldTileX = ((cx + 0.5) / cols - 0.5) * terrainSize.width;
          const worldTileZ = ((cy + 0.5) / rows - 0.5) * terrainSize.depth;
          const tileY = clamp(world.tileElevation[current] ?? 0, -1, 1) * heightScale;
          weightedX += worldTileX * w;
          weightedZ += worldTileZ * w;
          weightedY += tileY * w;
          weightSum += w;
          if (w > weightMax) {
            weightMax = w;
          }
          for (let oy = -sampleStep; oy <= sampleStep; oy += sampleStep) {
            for (let ox = -sampleStep; ox <= sampleStep; ox += sampleStep) {
              if (ox === 0 && oy === 0) {
                continue;
              }
              const nx = cx + ox;
              const ny = cy + oy;
              if (nx < minX || nx > maxX || ny < minY || ny > maxY) {
                continue;
              }
              const nIdx = ny * cols + nx;
              if (tileActiveFlag[nIdx] === 0 || tileClusterId[nIdx] >= 0) {
                continue;
              }
              tileClusterId[nIdx] = clusterId;
              clusterQueue[queueTail++] = nIdx;
            }
          }
        }
        if (cluster.tileCount < CLUSTER_MIN_TILES) {
          for (let i = 0; i < cluster.tiles.length; i += 1) {
            const tid = cluster.tiles[i];
            tileClusterId[tid] = -1;
            tileClusterRole[tid] = 0;
          }
          cluster.tiles.length = 0;
          fireClusterPool.push(cluster);
          continue;
        }
        cluster.centroidX = weightedX / Math.max(0.0001, weightSum);
        cluster.centroidZ = weightedZ / Math.max(0.0001, weightSum);
        cluster.baseY = weightedY / Math.max(0.0001, weightSum);
        const avgWeight = weightSum / Math.max(1, cluster.tileCount);
        cluster.intensity = clamp(avgWeight * 0.7 + weightMax * 0.3, 0, 1.25);
        let radius = 0;
        let edgeTiles = 0;
        let interiorTiles = 0;
        let covXX = 0;
        let covXZ = 0;
        let covZZ = 0;
        for (let i = 0; i < cluster.tiles.length; i += 1) {
          const tid = cluster.tiles[i];
          const tx = tid % cols;
          const ty = Math.floor(tid / cols);
          const wx = ((tx + 0.5) / cols - 0.5) * terrainSize.width;
          const wz = ((ty + 0.5) / rows - 0.5) * terrainSize.depth;
          const dx = wx - cluster.centroidX;
          const dz = wz - cluster.centroidZ;
          covXX += dx * dx;
          covXZ += dx * dz;
          covZZ += dz * dz;
          radius = Math.max(radius, Math.hypot(wx - cluster.centroidX, wz - cluster.centroidZ));
          let neighborCount = 0;
          for (let oy = -sampleStep; oy <= sampleStep; oy += sampleStep) {
            for (let ox = -sampleStep; ox <= sampleStep; ox += sampleStep) {
              if (ox === 0 && oy === 0) {
                continue;
              }
              const nx = tx + ox;
              const ny = ty + oy;
              if (nx < minX || nx > maxX || ny < minY || ny > maxY) {
                continue;
              }
              const nIdx = ny * cols + nx;
              if (tileClusterId[nIdx] === clusterId) {
                neighborCount += 1;
              }
            }
          }
          if (neighborCount >= INTERIOR_NEIGHBOR_MIN) {
            tileClusterRole[tid] = 2;
            interiorTiles += 1;
          } else {
            tileClusterRole[tid] = 1;
            edgeTiles += 1;
          }
        }
        let spanAxisX = 1;
        let spanAxisZ = 0;
        const covTrace = covXX + covZZ;
        if (covTrace > 0.0001) {
          const angle = 0.5 * Math.atan2(2 * covXZ, covXX - covZZ);
          spanAxisX = Math.cos(angle);
          spanAxisZ = Math.sin(angle);
        }
        const windLen = Math.hypot(windX, windZ);
        if (windLen > 0.0001) {
          const crossWindAxisX = -windZ / windLen;
          const crossWindAxisZ = windX / windLen;
          if (spanAxisX * crossWindAxisX + spanAxisZ * crossWindAxisZ < 0) {
            spanAxisX *= -1;
            spanAxisZ *= -1;
          }
          const crossWindBlend = cluster.tileCount >= CLUSTER_FULL_BLEND_TILES ? 0.45 : 0.22;
          spanAxisX += (crossWindAxisX - spanAxisX) * crossWindBlend;
          spanAxisZ += (crossWindAxisZ - spanAxisZ) * crossWindBlend;
          const spanLen = Math.hypot(spanAxisX, spanAxisZ) || 1;
          spanAxisX /= spanLen;
          spanAxisZ /= spanLen;
        }
        let depthAxisX = -spanAxisZ;
        let depthAxisZ = spanAxisX;
        if (windLen > 0.0001) {
          const windNormX = windX / windLen;
          const windNormZ = windZ / windLen;
          if (depthAxisX * windNormX + depthAxisZ * windNormZ < 0) {
            depthAxisX *= -1;
            depthAxisZ *= -1;
          }
        }
        cluster.spanAxisX = spanAxisX;
        cluster.spanAxisZ = spanAxisZ;
        cluster.depthAxisX = depthAxisX;
        cluster.depthAxisZ = depthAxisZ;
        cluster.radius = Math.max(radius, Math.min(terrainSize.width / cols, terrainSize.depth / rows) * 0.8);
        cluster.edgeTiles = edgeTiles;
        cluster.interiorTiles = interiorTiles;
        fireClusters.push(cluster);
        clusteredTiles += cluster.tileCount;
        clusterId += 1;
      }
    }
    return { clusterCount: fireClusters.length, clusteredTiles };
  };

  const computeClusterBudgets = (
    flameBudgetScale: number,
    activeFlameTileCount: number,
    clusteredTiles: number,
    availableFlameInstances: number
  ): ClusterBudgetState => {
    const clusterCoverage = clusteredTiles / Math.max(1, activeFlameTileCount);
    const flameCapacity = Math.max(96, availableFlameInstances);
    const reserveBed = Math.max(0, Math.round(flameCapacity * clusterCoverage * 0.14 * flameBudgetScale));
    const reservePlume = Math.max(0, Math.round(flameCapacity * clusterCoverage * 0.08 * flameBudgetScale));
    const reserveTileJets = clamp(
      flameCapacity - reserveBed - reservePlume,
      Math.max(80, Math.round(flameCapacity * 0.3)),
      flameCapacity
    );
    let weightSum = 0;
    for (let i = 0; i < fireClusters.length; i += 1) {
      const cluster = fireClusters[i];
      weightSum += cluster.tileCount * (0.65 + cluster.intensity * 0.35);
    }
    for (let i = 0; i < fireClusters.length; i += 1) {
      const cluster = fireClusters[i];
      const clusterWeight = cluster.tileCount * (0.65 + cluster.intensity * 0.35);
      const normW = weightSum > 0 ? clusterWeight / weightSum : 1 / Math.max(1, fireClusters.length);
      cluster.bedBudget =
        reserveBed > 0
          ? clamp(Math.round(reserveBed * normW), 2, CLUSTER_BED_MAX_PER_CLUSTER)
          : 0;
      let plumeAnchors = reservePlume > 0 ? (cluster.tileCount > 25 ? 3 : cluster.tileCount > 10 ? 2 : 1) : 0;
      if (flameBudgetScale < 0.72) {
        plumeAnchors = Math.min(plumeAnchors, 2);
      }
      if (flameBudgetScale < 0.5) {
        plumeAnchors = 1;
      }
      if (cluster.intensity < 0.24) {
        plumeAnchors = Math.min(plumeAnchors, 1);
      }
      cluster.plumeBudget = clamp(plumeAnchors, 0, CLUSTER_PLUME_MAX_PER_CLUSTER);
    }
    return {
      clusteredTiles,
      clusterCoverage,
      reserveBed,
      reservePlume,
      reserveTileJets
    };
  };

  const update = (
    time: number,
    world: RenderSim,
    sample: TerrainSample | null,
    terrainSize: { width: number; depth: number } | null,
    treeBurn: TreeBurnController | null,
    fpsEstimate: number,
    sceneRenderMs: number
  ): void => {
    const frameDeltaSeconds =
      previousTimeMs === null ? 1 / 60 : clamp((time - previousTimeMs) * 0.001, 1 / 240, 0.2);
    previousTimeMs = time;
    pendingDeltaSeconds = Math.min(0.3, pendingDeltaSeconds + frameDeltaSeconds);
    if (!sample || !terrainSize) {
      clearVisuals();
      return;
    }
    const cols = sample.cols;
    const rows = sample.rows;
    if (cols <= 0 || rows <= 0) {
      clearVisuals();
      return;
    }
    ensureTileState(cols, rows);
    if (
      !currentFireSnapshot ||
      !previousFireSnapshot ||
      currentFireSnapshot.cols !== cols ||
      currentFireSnapshot.rows !== rows ||
      previousFireSnapshot.cols !== cols ||
      previousFireSnapshot.rows !== rows
    ) {
      captureSnapshot(world);
    }
    const previousSnapshot = previousFireSnapshot ?? captureFireRenderSnapshot(world, null);
    const currentSnapshot = currentFireSnapshot ?? previousSnapshot;
    const treeBounds = treeBurn?.getVisualBounds() ?? null;
    const heatCap = Math.max(0.01, world.fireSettings.heatCap);
    const fireAlpha = world.simTimeMode === "incident" ? 1 : fireSimulationAlpha;
    const fireView = createFireFieldView(previousSnapshot, currentSnapshot, fireAlpha, heatCap);
    const hasActiveFire = fireView.lastActiveFires > 0;
    const hasPendingIgnition = fireView.fireScheduledCount > 0;
    const hasFireWork = hasActiveFire || hasPendingIgnition || fireView.hasBounds;
    const useFireBounds = fireView.hasBounds;
    if (!useFireBounds && !treeBounds) {
      if (!visualsCleared) {
        clearVisuals();
      }
      pendingDeltaSeconds = 0;
      return;
    }
    const minIntervalMs = hasFireWork ? FIRE_FX_ACTIVE_UPDATE_INTERVAL_MS : FIRE_FX_IDLE_UPDATE_INTERVAL_MS;
    if (time - lastRebuildTimeMs < minIntervalMs) {
      return;
    }
    lastRebuildTimeMs = time;
    const deltaSeconds = clamp(pendingDeltaSeconds, 1 / 240, 0.08);
    pendingDeltaSeconds = 0;
    const envAlpha = 1 - Math.exp(-deltaSeconds / 1.2);
    envCurrent.smoke01 += (envTarget.smoke01 - envCurrent.smoke01) * envAlpha;
    envCurrent.denseSmoke01 += (envTarget.denseSmoke01 - envCurrent.denseSmoke01) * envAlpha;
    envCurrent.fireLoad01 += (envTarget.fireLoad01 - envCurrent.fireLoad01) * envAlpha;
    envCurrent.orangeGlow01 += (envTarget.orangeGlow01 - envCurrent.orangeGlow01) * envAlpha;
    sunDirectionCurrent.lerp(sunDirectionTarget, envAlpha).normalize();
    sunTintCurrent.lerp(sunTintTarget, envAlpha);
    smokeTintCurrent.lerp(smokeTintTarget, envAlpha);
    const envOrange = clamp(envCurrent.orangeGlow01, 0, 1);
    const wallBlend = debugControls.wallBlend;
    const heroVolumetricShare = debugControls.heroVolumetricShare;
    const flameBudgetBaseScale = debugControls.budgetScale;
    const flameIntensityBoost = debugControls.flameIntensityBoost;
    const groundGlowBoost = debugControls.groundGlowBoost;
    const emberBoost = debugControls.emberBoost;
    const flameHeightBoost = clamp(0.94 + (debugControls.flameIntensityBoost - 1) * 0.72, 0.8, 1.4);
    const flameWidthBoost = clamp((1 + (debugControls.flameIntensityBoost - 1) * 0.28) * 1.18, 0.96, 1.55);
    const groundGlowSizeBoost = clamp(1 + (debugControls.groundGlowBoost - 1) * 0.9, 0.85, 1.8);
    const groundGlowCountBoost = clamp(1 + (debugControls.groundGlowBoost - 1) * 0.75, 0.8, 1.6);
    const emberEjectBoost = clamp(1 + (debugControls.emberBoost - 1) * 1.15, 0.85, 2.2);
    const sparkDebug = debugControls.sparkDebug;
    const sparkMode = debugControls.sparkMode;
    const useTipStreaks = sparkMode !== "embers";
    const useFreeEmbers = sparkMode !== "tip";
    const freeEmberModeScale = sparkMode === "mixed" ? 0.4 : 1;
    const fallbackMode = debugControls.fallbackMode;
    const smokeDensityScale = debugControls.smokeDensityScale;
    if (Number.isFinite(fpsEstimate) && fpsEstimate > 0 && Number.isFinite(sceneRenderMs) && sceneRenderMs > 0) {
      const overloaded = fpsEstimate < SMOKE_QUALITY_FALLBACK_FPS || sceneRenderMs > SMOKE_QUALITY_FALLBACK_SCENE_MS;
      if (overloaded) {
        smokeFallbackAccum += deltaSeconds;
      } else {
        smokeFallbackAccum = Math.max(0, smokeFallbackAccum - deltaSeconds * 0.7);
      }
      const healthy = fpsEstimate > SMOKE_QUALITY_RECOVERY_FPS && sceneRenderMs < SMOKE_QUALITY_RECOVERY_SCENE_MS;
      if (healthy) {
        smokeRecoveryAccum += deltaSeconds;
      } else {
        smokeRecoveryAccum = Math.max(0, smokeRecoveryAccum - deltaSeconds * 0.4);
      }
      if (smokeFallbackAccum >= SMOKE_QUALITY_FALLBACK_SECONDS) {
        smokeBudgetScale = Math.max(SMOKE_BUDGET_MIN_SCALE, smokeBudgetScale * 0.8);
        smokeFallbackAccum = 0;
        smokeRecoveryAccum = 0;
      } else if (smokeRecoveryAccum >= SMOKE_QUALITY_RECOVERY_SECONDS) {
        smokeBudgetScale = Math.min(1, smokeBudgetScale + 0.08);
        smokeRecoveryAccum = 0;
      }
      if (fallbackMode !== "off") {
        const fallbackFps = fallbackMode === "gentle" ? 54 : 58;
        const recoveryFps = fallbackMode === "gentle" ? 60 : 62;
        const fallbackSceneMs = fallbackMode === "gentle" ? 15 : 13;
        const recoverySceneMs = fallbackMode === "gentle" ? 11.5 : 10.5;
        const fallbackSeconds = fallbackMode === "gentle" ? 1.7 : 0.85;
        const recoverySeconds = fallbackMode === "gentle" ? 4.2 : 5.5;
        const overloadedFlames = fpsEstimate < fallbackFps || sceneRenderMs > fallbackSceneMs;
        if (overloadedFlames) {
          flameFallbackAccum += deltaSeconds;
        } else {
          flameFallbackAccum = Math.max(0, flameFallbackAccum - deltaSeconds * 0.75);
        }
        const healthyFlames = fpsEstimate > recoveryFps && sceneRenderMs < recoverySceneMs;
        if (healthyFlames) {
          flameRecoveryAccum += deltaSeconds;
        } else {
          flameRecoveryAccum = Math.max(0, flameRecoveryAccum - deltaSeconds * 0.45);
        }
        if (flameFallbackAccum >= fallbackSeconds) {
          const decay = fallbackMode === "gentle" ? 0.88 : 0.74;
          flameBudgetScale = Math.max(FLAME_BUDGET_MIN_SCALE, flameBudgetScale * decay);
          flameFallbackAccum = 0;
          flameRecoveryAccum = 0;
        } else if (flameRecoveryAccum >= recoverySeconds) {
          const recoveryStep = fallbackMode === "gentle" ? 0.05 : 0.1;
          flameBudgetScale = Math.min(1, flameBudgetScale + recoveryStep);
          flameRecoveryAccum = 0;
        }
      } else {
        flameBudgetScale = 1;
        flameFallbackAccum = 0;
        flameRecoveryAccum = 0;
      }
    }
    const minX =
      useFireBounds || treeBounds
        ? Math.max(0, Math.min(useFireBounds ? fireView.minX : cols - 1, treeBounds?.minX ?? cols - 1))
        : 0;
    const maxX =
      useFireBounds || treeBounds
        ? Math.min(cols - 1, Math.max(useFireBounds ? fireView.maxX : 0, treeBounds?.maxX ?? 0))
        : cols - 1;
    const minY =
      useFireBounds || treeBounds
        ? Math.max(0, Math.min(useFireBounds ? fireView.minY : rows - 1, treeBounds?.minY ?? rows - 1))
        : 0;
    const maxY =
      useFireBounds || treeBounds
        ? Math.min(rows - 1, Math.max(useFireBounds ? fireView.maxY : 0, treeBounds?.maxY ?? 0))
        : rows - 1;
    const width = Math.max(1, maxX - minX + 1);
    const height = Math.max(1, maxY - minY + 1);
    const area = width * height;
    const sampleStep =
      area <= 8192
        ? 1
        : Math.max(1, Math.ceil(Math.sqrt(area / Math.max(1, FIRE_MAX_INSTANCES))));
    const tileSpanX = terrainSize.width / Math.max(1, cols);
    const tileSpanZ = terrainSize.depth / Math.max(1, rows);
    const tileSpan = Math.max(0.0001, Math.min(tileSpanX, tileSpanZ));
    const sampleFootprint = tileSpan;
    const sparkFootprint = tileSpan;
    const viewportHeightPx = typeof window !== "undefined" ? Math.max(1, window.innerHeight) : 1080;
    const heightScale = getTerrainHeightScale(cols, rows);
    const simFireEps = getSimFireEps(world);
    const flamePresenceEps = Math.max(FIRE_FLAME_VISUAL_FLOOR, simFireEps * 0.9);
    const wind = world.wind;
    const windX = wind?.dx ?? 0;
    const windZ = wind?.dy ?? 0;
    const windStrength = wind?.strength ?? 0;
    const windResponse = getVisualWindResponse(windStrength);
    const crossWindX = -windZ;
    const crossWindZ = windX;
    const windLeanX = windX * windStrength * windResponse.flame;
    const windLeanZ = windZ * windStrength * windResponse.flame;
    const timeSeconds = time * 0.001;
    const flameTimeSeconds = timeSeconds * FLAME_MOTION_TIME_SCALE;
    const sparkTimeSeconds = timeSeconds * SPARK_MOTION_TIME_SCALE;
    const fireShaderTime = timeSeconds * FIRE_SHADER_TIME_SCALE;
    fireMaterial.uniforms.uTime.value = fireShaderTime;
    fireCrossMaterial.uniforms.uTime.value = fireShaderTime;
    fireCoreMaterial.uniforms.uTime.value = fireShaderTime;
    fireMaterial.uniforms.uAlphaScale.value = 0.92 * flameIntensityBoost;
    fireCrossMaterial.uniforms.uAlphaScale.value = 0.58 * flameIntensityBoost;
    fireCoreMaterial.uniforms.uAlphaScale.value = 0.68 * flameIntensityBoost;
    ashPreviewMaterial.uniforms.uTime.value = timeSeconds;
    fireMaterial.uniforms.uWind.value.set(windLeanX * FLAME_WIND_GAIN, windLeanZ * FLAME_WIND_GAIN);
    fireCrossMaterial.uniforms.uWind.value.set(windLeanX * FLAME_WIND_GAIN, windLeanZ * FLAME_WIND_GAIN);
    fireCoreMaterial.uniforms.uWind.value.set(windLeanX * FLAME_WIND_GAIN, windLeanZ * FLAME_WIND_GAIN);
    smokeMaterial.uniforms.uTime.value = timeSeconds;
    smokeWarmScratch.copy(smokeWarmBase).lerp(smokeWarmHot, envOrange);
    smokeCoolScratch.copy(smokeCoolBase).lerp(smokeCoolHot, envOrange);
    smokeStainScratch.copy(smokeStainBase).lerp(smokeStainHot, envOrange);
    smokeUnderglowScratch.copy(smokeUnderglowBase).lerp(smokeUnderglowHot, envOrange * 0.5);
    smokeTintScratch.copy(smokeTintCurrent);
    smokeWarmScratch.lerp(smokeTintScratch, 0.16 + envCurrent.smoke01 * 0.12);
    smokeCoolScratch.lerp(smokeTintScratch, 0.22 + envCurrent.denseSmoke01 * 0.18);
    smokeStainScratch.lerp(smokeTintScratch, 0.08 + envCurrent.fireLoad01 * 0.12);
    (smokeMaterial.uniforms.uWarmCol.value as THREE.Color).copy(smokeWarmScratch);
    (smokeMaterial.uniforms.uCoolCol.value as THREE.Color).copy(smokeCoolScratch);
    (smokeMaterial.uniforms.uWarmStainCol.value as THREE.Color).copy(smokeStainScratch);
    (smokeMaterial.uniforms.uSunDir.value as THREE.Vector3).copy(sunDirectionCurrent);
    (smokeMaterial.uniforms.uSunTint.value as THREE.Color).copy(sunTintCurrent);
    smokeMaterial.uniforms.uWarmStartY.value = -heightScale * 0.1;
    smokeMaterial.uniforms.uWarmRangeY.value = Math.max(tileSpan * 8, heightScale * 0.65);
    (smokeMaterial.uniforms.uUnderglowColor.value as THREE.Color).copy(smokeUnderglowScratch);
    smokeMaterial.uniforms.uUnderglowStrength.value = 0.1 + envOrange * 0.55;
    smokeMaterial.uniforms.uUnderglowStartY.value = -heightScale * 0.08;
    smokeMaterial.uniforms.uUnderglowRangeY.value = Math.max(tileSpan * 5.5, heightScale * 0.46);
    groundGlowMaterial.opacity = clamp(0.9 + envOrange * 0.22, 0.85, 1);
    const cameraAny = camera as THREE.Camera & { isOrthographicCamera?: boolean; zoom?: number };
    const zoomScale = cameraAny.isOrthographicCamera ? clamp(cameraAny.zoom ?? 1, 0.2, 8) : 1;
    smokeMaterial.uniforms.uZoomScale.value = zoomScale;
    camera.getWorldPosition(cameraWorldPos);
    camera.getWorldDirection(cameraForward);
    const topView01 = smoothstep(0.18, 0.78, Math.abs(cameraForward.y));
    const terrainMinX = -terrainSize.width * 0.5;
    const terrainMaxX = terrainSize.width * 0.5;
    const terrainMinZ = -terrainSize.depth * 0.5;
    const terrainMaxZ = terrainSize.depth * 0.5;
    const flameFallbackPressure = clamp(1 - flameBudgetScale, 0, 1);
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
      heroVolumetricShare * flameBudgetBaseScale * (1 - flameFallbackPressure * 1.45),
      0,
      1
    );
    const crossSliceBudget01 = clamp((flameBudgetScale - 0.38) / 0.62, 0, 1);
    const sliceComplexityScale = clamp(1 - crossSliceBudget01 * 0.18, 0.72, 1);
    const kernelBudgetScale = flameBudgetScale >= 0.8 ? 1 : flameBudgetScale >= 0.58 ? 0.78 : 0.6;
    const ashPreviewCap = Math.max(
      180,
      Math.floor(
        ASH_PREVIEW_MAX_INSTANCES *
          clamp(flameBudgetBaseScale * (0.72 + flameBudgetScale * 0.28), 0.45, 1)
      )
    );
    const sparkStreakCap = Math.max(
      140,
      Math.floor(
        SPARK_STREAK_MAX_INSTANCES *
          clamp(flameBudgetBaseScale * (0.66 + flameBudgetScale * 0.34), 0.35, 1)
      )
    );
    const emberCap = Math.max(
      120,
      Math.floor(
        EMBER_MAX_INSTANCES *
          clamp(flameBudgetBaseScale * (0.62 + flameBudgetScale * 0.38), 0.32, 1)
      )
    );
    let fireCount = 0;
    let fireCrossCount = 0;
    let ashPreviewCount = 0;
    let glowCount = 0;
    let smokeCount = 0;
    let emberCount = 0;
    let sparkStreakCount = 0;
    let sparkPointCount = 0;
    let visibleFlameTiles = 0;
    let heroTipSparkAttempts = 0;
    let heroTipSparkEmitted = 0;
    let freeEmberAttempts = 0;
    let freeEmberEmitted = 0;
    let droppedByInstanceCap = 0;
    let clusterCount = 0;
    let clusteredTiles = 0;
    let frontSegmentCount = 0;
    let clusterBedInstances = 0;
    let clusterPlumeSpawns = 0;
    let smokeSpawnsThisFrame = 0;
    const pushSparkPoint = (x: number, y: number, z: number, r: number, g: number, b: number): void => {
      if (sparkPointCount >= SPARK_POINT_MAX_INSTANCES) {
        return;
      }
      const base = sparkPointCount * 3;
      sparkPointPositions[base] = x;
      sparkPointPositions[base + 1] = y;
      sparkPointPositions[base + 2] = z;
      sparkPointColors[base] = r;
      sparkPointColors[base + 1] = g;
      sparkPointColors[base + 2] = b;
      sparkPointCount += 1;
    };
    const setSparkStreakTransform = (
      x: number,
      y: number,
      z: number,
      width: number,
      height: number,
      dirX: number,
      dirY: number,
      dirZ: number
    ): void => {
      sparkStreakBillboard.position.set(x, y, z);
      sparkStreakBillboard.quaternion.copy(camera.quaternion);
      sparkDirectionScratch.set(dirX, dirY, dirZ);
      if (sparkDirectionScratch.lengthSq() > 0.000001) {
        sparkDirectionScratch.transformDirection(camera.matrixWorldInverse);
        const screenLen = Math.hypot(sparkDirectionScratch.x, sparkDirectionScratch.y);
        if (screenLen > 0.0001) {
          sparkStreakBillboard.rotateZ(-Math.atan2(sparkDirectionScratch.x, sparkDirectionScratch.y));
        }
      }
      sparkStreakBillboard.scale.set(width, height, width);
      sparkStreakBillboard.updateMatrix();
    };
    const effectiveSmokeBudgetScale = clamp(smokeBudgetScale * smokeDensityScale, 0.2, 2.5);
    const smokeSpawnFrameCap = Math.max(24, Math.floor(SMOKE_MAX_INSTANCES * 0.26 * effectiveSmokeBudgetScale));
    const smokeRenderCap = Math.max(180, Math.floor(SMOKE_MAX_INSTANCES * effectiveSmokeBudgetScale));
    const smokeRenderStride =
      effectiveSmokeBudgetScale >= 0.9 ? 1 : effectiveSmokeBudgetScale >= 0.7 ? 2 : effectiveSmokeBudgetScale >= 0.5 ? 3 : 4;
    let activeFlameTileCount = 0;
    let visualActiveWeight = 0;
    for (let y = minY; y <= maxY; y += 1) {
      const rowBase = y * cols;
      for (let x = minX; x <= maxX; x += 1) {
        const idx = rowBase + x;
        const fire = fireView.getFireByIndex(idx);
        if (fire > simFireEps) {
          activeFlameTileCount += 1;
          visualActiveWeight += clamp(
            smoothstep(simFireEps * 0.5, 0.45, fire) + fire * 0.2 + fireView.getHeat01ByIndex(idx) * 0.14,
            0,
            1.2
          );
          continue;
        }
        const heat = fireView.getHeat01ByIndex(idx);
        if (heat <= 0.08) {
          continue;
        }
        const fuel = fireView.getFuelByIndex(idx);
        const isAshTile = (world.tileTypeId[idx] ?? -1) === TILE_TYPE_IDS.ash;
        if (fuel <= TREE_BURN_CARRY_FUEL_MIN || isAshTile) {
          continue;
        }
        const flameProfile: TreeFlameProfile | null = treeBurn?.getTileFlameProfile(idx) ?? null;
        if (!flameProfile) {
          continue;
        }
        const treeBurnVisual = treeBurn?.getTileBurnVisual(idx) ?? 0;
        const burnProgress = treeBurn?.getTileBurnProgress(idx) ?? 0;
        if (treeBurnVisual > TREE_BURN_FLAME_VISUAL_MIN && burnProgress > TREE_BURN_CARRY_PROGRESS_MIN) {
          activeFlameTileCount += 1;
          visualActiveWeight += clamp(treeBurnVisual * 0.72 + heat * 0.18, 0, 0.95);
        }
      }
    }
    const boundsChanged =
      sampleStep !== lastClusterSampleStep ||
      minX !== lastClusterMinX ||
      maxX !== lastClusterMaxX ||
      minY !== lastClusterMinY ||
      maxY !== lastClusterMaxY;
    const activeCountChanged =
      Math.abs(activeFlameTileCount - lastClusterActiveTileCount) / Math.max(1, lastClusterActiveTileCount) > 0.15;
    const shouldRebuildClusters =
      time - lastClusterRebuildMs >= CLUSTER_UPDATE_MS || activeCountChanged || boundsChanged;
    if (shouldRebuildClusters) {
      const clusterBuild = buildFireClusters(
        world,
        fireView,
        cols,
        rows,
        minX,
        maxX,
        minY,
        maxY,
        sampleStep,
        simFireEps,
        windX,
        windZ,
        treeBurn,
        terrainSize,
        heightScale
      );
      clusterCount = clusterBuild.clusterCount;
      clusteredTiles = clusterBuild.clusteredTiles;
      lastClusterRebuildMs = time;
      lastClusterActiveTileCount = activeFlameTileCount;
      lastClusterSampleStep = sampleStep;
      lastClusterMinX = minX;
      lastClusterMaxX = maxX;
      lastClusterMinY = minY;
      lastClusterMaxY = maxY;
    } else {
      clusterCount = fireClusters.length;
      clusteredTiles = fireClusters.reduce((sum, cluster) => sum + cluster.tileCount, 0);
    }
    const windDirLen = Math.hypot(windX, windZ);
    const windNormX = windDirLen > 0.0001 ? windX / windDirLen : 0;
    const windNormZ = windDirLen > 0.0001 ? windZ / windDirLen : 0;
    const getHeat01 = (tileIdx: number): number => fireView.getHeat01ByIndex(tileIdx);
    const getGroundY = (tileIdx: number): number => clamp(world.tileElevation[tileIdx] ?? 0, -1, 1) * heightScale;
    const getFrontEdgeStrength = (
      activeIdx: number,
      neighbourIdx: number,
      normalX: number,
      normalZ: number
    ): number => {
      const activeFire = fireView.getFireByIndex(activeIdx);
      if (activeFire <= simFireEps) {
        return 0;
      }
      const activeHeat = getHeat01(activeIdx);
      const neighbourFire = neighbourIdx >= 0 ? fireView.getFireByIndex(neighbourIdx) : 0;
      const neighbourHeat = neighbourIdx >= 0 ? getHeat01(neighbourIdx) : 0;
      const unburntNeighbour = neighbourIdx < 0 || neighbourFire <= simFireEps;
      const fireRatio = activeFire / Math.max(simFireEps, neighbourFire + simFireEps);
      const heatRatio = activeHeat / Math.max(0.04, neighbourHeat + 0.04);
      if (
        !unburntNeighbour &&
        fireRatio < FIRE_FRONT_NEIGHBOUR_RATIO &&
        heatRatio < FIRE_FRONT_NEIGHBOUR_HEAT_RATIO &&
        neighbourFire >= activeFire * 0.82
      ) {
        return 0;
      }
      const fireDrop = Math.max(0, activeFire - neighbourFire);
      const heatDrop = Math.max(0, activeHeat - neighbourHeat);
      const windPush = windDirLen > 0.0001 ? Math.max(0, normalX * windNormX + normalZ * windNormZ) : 0;
      return clamp(
        activeFire * 0.56 +
          activeHeat * 0.22 +
          fireDrop * 0.68 +
          heatDrop * 0.26 +
          (unburntNeighbour ? 0.2 : 0) +
          windPush * 0.24,
        0,
        1.35
      );
    };
    const getFrontEdgeVisualStrength = (
      activeIdx: number,
      neighbourIdx: number,
      normalX: number,
      normalZ: number
    ): number => {
      const targetStrength = getFrontEdgeStrength(activeIdx, neighbourIdx, normalX, normalZ);
      const smoothedFront = activeIdx >= 0 ? tileFrontStrength[activeIdx] ?? 0 : 0;
      return Math.min(targetStrength, smoothedFront * 1.08 + 0.1);
    };
    let visualFrontWeight = 0;
    if (ENABLE_FLAME_FRONT_PASS) {
      for (let y = minY; y <= maxY; y += sampleStep) {
        const rowBase = y * cols;
        for (let x = minX; x <= maxX; x += sampleStep) {
          const idx = rowBase + x;
          const fire = fireView.getFireByIndex(idx);
          let frontStrengthTarget = 0;
          if (fire > simFireEps) {
            const westIdx = x - sampleStep >= minX ? idx - sampleStep : -1;
            const eastIdx = x + sampleStep <= maxX ? idx + sampleStep : -1;
            const northIdx = y - sampleStep >= minY ? idx - sampleStep * cols : -1;
            const southIdx = y + sampleStep <= maxY ? idx + sampleStep * cols : -1;
            frontStrengthTarget = Math.max(frontStrengthTarget, getFrontEdgeStrength(idx, westIdx, -1, 0));
            frontStrengthTarget = Math.max(frontStrengthTarget, getFrontEdgeStrength(idx, eastIdx, 1, 0));
            frontStrengthTarget = Math.max(frontStrengthTarget, getFrontEdgeStrength(idx, northIdx, 0, -1));
            frontStrengthTarget = Math.max(frontStrengthTarget, getFrontEdgeStrength(idx, southIdx, 0, 1));
          }
          const smoothedFront = smoothApproach(tileFrontStrength[idx] ?? 0, frontStrengthTarget, 14.0, 10.0, deltaSeconds);
          tileFrontStrength[idx] = smoothedFront;
          if (fire > simFireEps && frontStrengthTarget > FIRE_FRONT_VISUAL_MIN) {
            visualFrontWeight += smoothstep(FIRE_FRONT_VISUAL_MIN * 0.4, 0.42, frontStrengthTarget);
          }
        }
      }
    }
    const frontBudgetFloor =
      visualFrontWeight >= 8
        ? Math.min(FIRE_FRONT_MIN_INSTANCES, Math.round(visualFrontWeight * 2.5))
        : 0;
    const frontPassActive =
      ENABLE_FLAME_FRONT_PASS &&
      visualFrontWeight >= FIRE_FRONT_PASS_MIN_WEIGHT &&
      activeFlameTileCount >= 4;
    const frontSegmentBudget = frontPassActive
      ? clamp(
          Math.round(
            Math.min(FIRE_FRONT_MAX_INSTANCES, visualFrontWeight * 2.35 + visualActiveWeight * 0.16) *
              clamp(flameDensityScale, 0.28, 1.05)
          ),
          frontBudgetFloor,
          FIRE_FRONT_MAX_INSTANCES
        )
      : 0;
    const flameTileCapacity = clamp(FIRE_MAX_INSTANCES - frontSegmentBudget, 96, FIRE_MAX_INSTANCES);
    const clusterBudgetState = computeClusterBudgets(
      flameBudgetScale,
      Math.max(activeFlameTileCount, Math.round(Math.max(1, visualActiveWeight))),
      clusteredTiles,
      flameTileCapacity
    );
    const perTileFlameCap =
      visualActiveWeight > 0.01
        ? clamp(
            Math.floor(clusterBudgetState.reserveTileJets / Math.max(1, visualActiveWeight)),
            1,
            FIRE_VISUAL_TUNING.tongueSpawnMax
          )
        : FIRE_VISUAL_TUNING.tongueSpawnMax;
    const perTileCrossCap =
      visualActiveWeight > 0.01
        ? clamp(Math.floor(FIRE_CROSS_MAX_INSTANCES / Math.max(1, visualActiveWeight)), 0, 5)
        : 5;
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
    const emitFrontRun = (
      orientation: "horizontal" | "vertical",
      fixedCoord: number,
      startCoord: number,
      endCoord: number,
      normalX: number,
      normalZ: number,
      strengthSum: number,
      heatSum: number,
      fireSum: number,
      groundYSum: number,
      sampleCount: number
    ): void => {
      if (!ENABLE_FLAME_FRONT_PASS || sampleCount <= 0 || frontSegmentCount >= frontSegmentBudget) {
        return;
      }
      const avgStrength = strengthSum / sampleCount;
      if (avgStrength <= FIRE_FRONT_VISUAL_MIN) {
        return;
      }
      const frontScale01 = smoothstep(FIRE_FRONT_VISUAL_MIN * 0.4, 0.42, avgStrength);
      if (frontScale01 <= 0.02) {
        return;
      }
      const avgHeat = heatSum / sampleCount;
      const avgFire = fireSum / sampleCount;
      const avgGroundY = groundYSum / sampleCount;
      const blockSpan = (orientation === "horizontal" ? tileSpanX : tileSpanZ) * sampleStep;
      const runBlockCount = Math.floor((endCoord - startCoord) / sampleStep) + 1;
      const runSpan = Math.max(blockSpan, runBlockCount * blockSpan);
      const tangentX = orientation === "horizontal" ? 1 : 0;
      const tangentZ = orientation === "horizontal" ? 0 : 1;
      let runCenterX = 0;
      let runCenterZ = 0;
      if (orientation === "horizontal") {
        const startCenterX = ((startCoord + sampleStep * 0.5) / cols - 0.5) * terrainSize.width;
        const endCenterX = ((endCoord + sampleStep * 0.5) / cols - 0.5) * terrainSize.width;
        const sourceRow = clamp(normalZ < 0 ? fixedCoord : fixedCoord - sampleStep, minY, maxY);
        const sourceCenterZ = ((sourceRow + sampleStep * 0.5) / rows - 0.5) * terrainSize.depth;
        runCenterX = (startCenterX + endCenterX) * 0.5;
        runCenterZ = sourceCenterZ + normalZ * tileSpanZ * sampleStep * 0.5;
      } else {
        const startCenterZ = ((startCoord + sampleStep * 0.5) / rows - 0.5) * terrainSize.depth;
        const endCenterZ = ((endCoord + sampleStep * 0.5) / rows - 0.5) * terrainSize.depth;
        const sourceCol = clamp(normalX < 0 ? fixedCoord : fixedCoord - sampleStep, minX, maxX);
        const sourceCenterX = ((sourceCol + sampleStep * 0.5) / cols - 0.5) * terrainSize.width;
        runCenterX = sourceCenterX + normalX * tileSpanX * sampleStep * 0.5;
        runCenterZ = (startCenterZ + endCenterZ) * 0.5;
      }
      const maxSegments = Math.min(
        FIRE_FRONT_RUN_MAX_SEGMENTS,
        frontSegmentBudget - frontSegmentCount,
        FIRE_MAX_INSTANCES - fireCount
      );
      if (maxSegments <= 0) {
        return;
      }
      const baseSegments = Math.max(1, Math.ceil(runSpan / Math.max(sampleFootprint * 1.45, blockSpan * 0.82)));
      const idealSegmentCount = clamp(
        Math.round(baseSegments * (0.9 + avgStrength * 0.7)),
        1,
        FIRE_FRONT_RUN_MAX_SEGMENTS
      );
      const segmentStride = idealSegmentCount > maxSegments ? Math.ceil(idealSegmentCount / Math.max(1, maxSegments)) : 1;
      const segmentPhase =
        segmentStride > 1
          ? Math.floor(
              hash1(fixedCoord * 0.731 + startCoord * 0.173 + endCoord * 0.097 + normalX * 11.3 + normalZ * 7.1) *
                segmentStride
            )
          : 0;
      const segmentSpacing = runSpan / Math.max(1, idealSegmentCount);
      const windPush = windDirLen > 0.0001 ? Math.max(0, normalX * windNormX + normalZ * windNormZ) : 0;
      const tangentYaw = Math.atan2(tangentX + windX * 0.16, tangentZ + windZ * 0.16);
      for (let segment = 0; segment < idealSegmentCount && fireCount < FIRE_MAX_INSTANCES; segment += 1) {
        if (segmentStride > 1 && segment % segmentStride !== segmentPhase) {
          continue;
        }
        if (frontSegmentCount >= frontSegmentBudget) {
          break;
        }
        const s1 = hash1(fixedCoord * 0.731 + startCoord * 0.173 + endCoord * 0.097 + segment * 3.17 + normalX * 11.3 + normalZ * 7.1);
        const s2 = hash1(fixedCoord * 1.131 + startCoord * 0.217 + endCoord * 0.119 + segment * 5.41 + 2.7);
        const s3 = hash1(fixedCoord * 0.593 + startCoord * 0.149 + endCoord * 0.181 + segment * 7.03 + 9.4);
        const along =
          -runSpan * 0.5 +
          segmentSpacing * (segment + 0.5) +
          (s1 - 0.5) * segmentSpacing * 0.48;
        const centerX =
          clamp(runCenterX + tangentX * along + normalX * (s2 - 0.5) * sampleFootprint * 0.18, terrainMinX, terrainMaxX);
        const centerZ =
          clamp(runCenterZ + tangentZ * along + normalZ * (s2 - 0.5) * sampleFootprint * 0.18, terrainMinZ, terrainMaxZ);
        const surge =
          0.72 +
          Math.pow(s2, 1.55) * 0.74 +
          0.24 * Math.sin(flameTimeSeconds * (4.1 + s3 * 3.1) + s1 * TAU);
        const collapse =
          0.62 +
          0.38 * (0.5 + 0.5 * Math.sin(flameTimeSeconds * (2.3 + s1 * 2.1) + s2 * TAU));
        const heightRaw =
          sampleFootprint *
          (0.34 + avgStrength * 0.78 + avgHeat * 0.14 + windPush * 0.12) *
          (0.76 + s2 * 0.36) *
          surge *
          collapse *
          flameHeightBoost *
          0.8 *
          FLAME_RENDER_SIZE_SCALE *
          frontScale01;
        const widthRaw =
          Math.max(blockSpan * 0.74, segmentSpacing * (0.88 + s1 * 0.12)) *
          (0.91 + windPush * 0.07) *
          flameWidthBoost *
          FLAME_RENDER_SIZE_SCALE *
          frontScale01;
        const height = Math.min(heightRaw, sampleFootprint * 1.6 * flameHeightBoost * FLAME_RENDER_SIZE_SCALE);
        const width = Math.min(widthRaw, sampleFootprint * 1.35);
        const baseY = avgGroundY - sampleFootprint * 0.015;
        const cameraYaw = Math.atan2(cameraWorldPos.x - centerX, cameraWorldPos.z - centerZ);
        const yaw = cameraYaw * 0.88 + tangentYaw * 0.12 + Math.sin(flameTimeSeconds * 0.92 + s3 * TAU) * 0.06;
        const mainPitch = topView01 * 0.18;
        fireBillboard.position.set(centerX, baseY, centerZ);
        fireBillboard.rotation.set(mainPitch, yaw, 0);
        fireBillboard.scale.set(
          width * FLAME_BILLBOARD_OVERSCAN_X,
          height * FLAME_BILLBOARD_OVERSCAN_Y,
          width * FLAME_BILLBOARD_OVERSCAN_X
        );
        fireBillboard.updateMatrix();
        fireMesh.setMatrixAt(fireCount, fireBillboard.matrix);
        fireIntensityAttr.setX(fireCount, clamp(0.62 + avgFire * 0.36 + avgStrength * 0.24 + windPush * 0.12, 0, 1.25));
        fireSeedAttr.setX(fireCount, fract(s1 + s3 + segment * 0.13));
        fireBaseCurveAttr.setX(fireCount, 0.08 + avgHeat * 0.22);
        fireClusterBlendAttr.setX(fireCount, 0.08);
        fireSmokeOccAttr.setX(fireCount, clamp(0.06 + avgHeat * 0.12, 0, 0.22));
        fireRoleAttr.setX(fireCount, 3);
        const sliceOffset = (0.14 + topView01 * 0.26) * (s1 > 0.5 ? 1 : -1);
        fireBillboard.position.set(centerX, baseY + sampleFootprint * 0.01, centerZ);
        fireBillboard.rotation.set(mainPitch * 0.7, yaw + sliceOffset, 0);
        fireBillboard.scale.set(
          width * 0.52 * FLAME_CORE_BILLBOARD_OVERSCAN_X,
          height * 0.46 * FLAME_CORE_BILLBOARD_OVERSCAN_Y,
          width * 0.52 * FLAME_CORE_BILLBOARD_OVERSCAN_X
        );
        fireBillboard.updateMatrix();
        fireCoreMesh.setMatrixAt(fireCount, fireBillboard.matrix);
        if (topView01 > 0.24 && fireCrossCount < FIRE_CROSS_MAX_INSTANCES) {
          fireCrossBillboard.position.set(centerX, baseY + sampleFootprint * 0.005, centerZ);
          fireCrossBillboard.rotation.set(mainPitch * 0.52, yaw - sliceOffset * 0.82, 0);
          fireCrossBillboard.scale.set(
            width * 0.82 * FLAME_BILLBOARD_OVERSCAN_X,
            height * 0.82 * FLAME_BILLBOARD_OVERSCAN_Y,
            width * 0.82 * FLAME_BILLBOARD_OVERSCAN_X
          );
          fireCrossBillboard.updateMatrix();
          fireCrossMesh.setMatrixAt(fireCrossCount, fireCrossBillboard.matrix);
          fireCrossIntensityAttr.setX(fireCrossCount, clamp(0.56 + avgFire * 0.32 + avgStrength * 0.2, 0, 1.12));
          fireCrossSeedAttr.setX(fireCrossCount, fract(s2 + s3 + segment * 0.17));
          fireCrossBaseCurveAttr.setX(fireCrossCount, 0.08 + avgHeat * 0.18);
          fireCrossClusterBlendAttr.setX(fireCrossCount, 0.08);
          fireCrossSmokeOccAttr.setX(fireCrossCount, clamp(0.05 + avgHeat * 0.1, 0, 0.2));
          fireCrossRoleAttr.setX(fireCrossCount, 3);
          fireCrossCount += 1;
        }
        fireCount += 1;
        frontSegmentCount += 1;
        if (glowCount < GLOW_MAX_INSTANCES) {
          const glowLength = Math.max(blockSpan * 0.9, width * 0.72);
          const glowDepth = sampleFootprint * (0.36 + avgStrength * 0.28) * groundGlowSizeBoost;
          groundGlowBillboard.position.set(
            centerX + normalX * sampleFootprint * 0.03,
            baseY + 0.03,
            centerZ + normalZ * sampleFootprint * 0.03
          );
          groundGlowBillboard.rotation.set(0, tangentYaw, 0);
          groundGlowBillboard.scale.set(glowLength, glowDepth, 1);
          groundGlowBillboard.updateMatrix();
          groundGlowMesh.setMatrixAt(glowCount, groundGlowBillboard.matrix);
          const frontGlow = clamp((0.38 + avgStrength * 0.9 + s2 * 0.18) * groundGlowBoost, 0, 3.2);
          groundGlowMesh.instanceColor?.setXYZ(
            glowCount,
            frontGlow * 1.16,
            frontGlow * (0.38 + s2 * 0.14),
            frontGlow * (0.04 + s1 * 0.03)
          );
          glowCount += 1;
        }
        if (sparkPointCount < SPARK_POINT_MAX_INSTANCES && avgStrength > 0.3 && s3 > 0.56) {
          const sparkDrift = sampleFootprint * (0.18 + windStrength * 0.44 + s2 * 0.2);
          pushSparkPoint(
            clamp(centerX + windX * sparkDrift + tangentX * (s1 - 0.5) * segmentSpacing * 0.16, terrainMinX, terrainMaxX),
            baseY + height * (0.52 + s3 * 0.24),
            clamp(centerZ + windZ * sparkDrift + tangentZ * (s2 - 0.5) * segmentSpacing * 0.16, terrainMinZ, terrainMaxZ),
            1.2 + avgStrength * 0.3,
            0.58 + avgHeat * 0.18,
            0.12
          );
        }
      }
    };
    const emitFrontRuns = (): void => {
      if (!ENABLE_FLAME_FRONT_PASS || frontSegmentBudget <= 0) {
        return;
      }
      for (let yEdge = minY; yEdge <= maxY + sampleStep; yEdge += sampleStep) {
        let runStart = -1;
        let runEnd = -1;
        let runNormalZ = 0;
        let strengthSum = 0;
        let heatSum = 0;
        let fireSum = 0;
        let groundYSum = 0;
        let sampleCount = 0;
        for (let x = minX; x <= maxX; x += sampleStep) {
          const northY = yEdge - sampleStep;
          const southY = yEdge;
          const northIdx = northY >= minY && northY <= maxY ? northY * cols + x : -1;
          const southIdx = southY >= minY && southY <= maxY ? southY * cols + x : -1;
          let edgeStrength = 0;
          let normalZ = 0;
          let activeIdx = -1;
          const northStrength = northIdx >= 0 ? getFrontEdgeVisualStrength(northIdx, southIdx, 0, 1) : 0;
          const southStrength = southIdx >= 0 ? getFrontEdgeVisualStrength(southIdx, northIdx, 0, -1) : 0;
          if (northStrength >= southStrength && northStrength > FIRE_FRONT_VISUAL_MIN) {
            edgeStrength = northStrength;
            normalZ = 1;
            activeIdx = northIdx;
          } else if (southStrength > FIRE_FRONT_VISUAL_MIN) {
            edgeStrength = southStrength;
            normalZ = -1;
            activeIdx = southIdx;
          }
          if (activeIdx >= 0) {
            if (runStart < 0 || normalZ !== runNormalZ || x !== runEnd + sampleStep) {
              if (runStart >= 0) {
                emitFrontRun(
                  "horizontal",
                  yEdge,
                  runStart,
                  runEnd,
                  0,
                  runNormalZ,
                  strengthSum,
                  heatSum,
                  fireSum,
                  groundYSum,
                  sampleCount
                );
              }
              runStart = x;
              runNormalZ = normalZ;
              strengthSum = 0;
              heatSum = 0;
              fireSum = 0;
              groundYSum = 0;
              sampleCount = 0;
            }
            runEnd = x;
            strengthSum += edgeStrength;
            heatSum += getHeat01(activeIdx);
            fireSum += fireView.getFireByIndex(activeIdx);
            groundYSum += getGroundY(activeIdx);
            sampleCount += 1;
          } else if (runStart >= 0) {
            emitFrontRun(
              "horizontal",
              yEdge,
              runStart,
              runEnd,
              0,
              runNormalZ,
              strengthSum,
              heatSum,
              fireSum,
              groundYSum,
              sampleCount
            );
            runStart = -1;
            runEnd = -1;
            runNormalZ = 0;
            strengthSum = 0;
            heatSum = 0;
            fireSum = 0;
            groundYSum = 0;
            sampleCount = 0;
          }
        }
        if (runStart >= 0) {
          emitFrontRun(
            "horizontal",
            yEdge,
            runStart,
            runEnd,
            0,
            runNormalZ,
            strengthSum,
            heatSum,
            fireSum,
            groundYSum,
            sampleCount
          );
        }
      }
      for (let xEdge = minX; xEdge <= maxX + sampleStep; xEdge += sampleStep) {
        let runStart = -1;
        let runEnd = -1;
        let runNormalX = 0;
        let strengthSum = 0;
        let heatSum = 0;
        let fireSum = 0;
        let groundYSum = 0;
        let sampleCount = 0;
        for (let y = minY; y <= maxY; y += sampleStep) {
          const westX = xEdge - sampleStep;
          const eastX = xEdge;
          const westIdx = westX >= minX && westX <= maxX ? y * cols + westX : -1;
          const eastIdx = eastX >= minX && eastX <= maxX ? y * cols + eastX : -1;
          let edgeStrength = 0;
          let normalX = 0;
          let activeIdx = -1;
          const westStrength = westIdx >= 0 ? getFrontEdgeVisualStrength(westIdx, eastIdx, 1, 0) : 0;
          const eastStrength = eastIdx >= 0 ? getFrontEdgeVisualStrength(eastIdx, westIdx, -1, 0) : 0;
          if (westStrength >= eastStrength && westStrength > FIRE_FRONT_VISUAL_MIN) {
            edgeStrength = westStrength;
            normalX = 1;
            activeIdx = westIdx;
          } else if (eastStrength > FIRE_FRONT_VISUAL_MIN) {
            edgeStrength = eastStrength;
            normalX = -1;
            activeIdx = eastIdx;
          }
          if (activeIdx >= 0) {
            if (runStart < 0 || normalX !== runNormalX || y !== runEnd + sampleStep) {
              if (runStart >= 0) {
                emitFrontRun(
                  "vertical",
                  xEdge,
                  runStart,
                  runEnd,
                  runNormalX,
                  0,
                  strengthSum,
                  heatSum,
                  fireSum,
                  groundYSum,
                  sampleCount
                );
              }
              runStart = y;
              runNormalX = normalX;
              strengthSum = 0;
              heatSum = 0;
              fireSum = 0;
              groundYSum = 0;
              sampleCount = 0;
            }
            runEnd = y;
            strengthSum += edgeStrength;
            heatSum += getHeat01(activeIdx);
            fireSum += fireView.getFireByIndex(activeIdx);
            groundYSum += getGroundY(activeIdx);
            sampleCount += 1;
          } else if (runStart >= 0) {
            emitFrontRun(
              "vertical",
              xEdge,
              runStart,
              runEnd,
              runNormalX,
              0,
              strengthSum,
              heatSum,
              fireSum,
              groundYSum,
              sampleCount
            );
            runStart = -1;
            runEnd = -1;
            runNormalX = 0;
            strengthSum = 0;
            heatSum = 0;
            fireSum = 0;
            groundYSum = 0;
            sampleCount = 0;
          }
        }
        if (runStart >= 0) {
          emitFrontRun(
            "vertical",
            xEdge,
            runStart,
            runEnd,
            runNormalX,
            0,
            strengthSum,
            heatSum,
            fireSum,
            groundYSum,
            sampleCount
          );
        }
      }
    };

    const emitClusterFlameBed = (cluster: FireCluster): void => {
      if (cluster.bedBudget <= 0) {
        return;
      }
      const bedCount = clamp(
        Math.round(cluster.tileCount * (0.9 + cluster.intensity * 0.7) * flameBudgetScale),
        2,
        Math.min(CLUSTER_BED_MAX_PER_CLUSTER, cluster.bedBudget)
      );
      const radius = Math.max(tileSpan * 0.8, cluster.radius * 1.1);
      const clusterBlend = clamp(
        (cluster.tileCount - CLUSTER_MIN_TILES) / Math.max(1, CLUSTER_FULL_BLEND_TILES - CLUSTER_MIN_TILES),
        0,
        1
      );
      const smokeOccBase = clamp(0.25 + cluster.intensity * 0.45, 0, 1);
      if (sparkDebug) {
        const centroidR = 0.6 + cluster.intensity * 2.2;
        const centroidG = 0.45 + cluster.intensity * 0.95;
        pushSparkPoint(cluster.centroidX, cluster.baseY + tileSpan * 0.18, cluster.centroidZ, centroidR, centroidG, 0.2);
        const minWX = ((cluster.minX + 0.5) / cols - 0.5) * terrainSize.width;
        const maxWX = ((cluster.maxX + 0.5) / cols - 0.5) * terrainSize.width;
        const minWZ = ((cluster.minY + 0.5) / rows - 0.5) * terrainSize.depth;
        const maxWZ = ((cluster.maxY + 0.5) / rows - 0.5) * terrainSize.depth;
        pushSparkPoint(minWX, cluster.baseY + tileSpan * 0.06, minWZ, 0.3, 1.8, 0.3);
        pushSparkPoint(maxWX, cluster.baseY + tileSpan * 0.06, maxWZ, 0.3, 1.8, 0.3);
      }
      for (let bi = 0; bi < bedCount && fireCount < FIRE_MAX_INSTANCES; bi += 1) {
        const b1 = hash1(cluster.id * 1.337 + bi * 7.11 + 0.47);
        const b2 = hash1(cluster.id * 0.913 + bi * 11.7 + 3.21);
        const b3 = hash1(cluster.id * 1.777 + bi * 4.91 + 6.73);
        const theta = b1 * TAU;
        const spanRadius = radius * (1.15 + clusterBlend * 0.38 + windStrength * 0.18);
        const depthRadius = radius * (0.34 + cluster.intensity * 0.12);
        const spanOffset = Math.cos(theta) * Math.sqrt(b2) * spanRadius;
        const depthOffset = Math.sin(theta) * Math.pow(b2, 0.72) * depthRadius;
        const x =
          cluster.centroidX +
          cluster.spanAxisX * spanOffset +
          cluster.depthAxisX * depthOffset +
          cluster.depthAxisX * (b3 - 0.5) * radius * 0.12;
        const z =
          cluster.centroidZ +
          cluster.spanAxisZ * spanOffset +
          cluster.depthAxisZ * depthOffset +
          cluster.depthAxisZ * (b3 - 0.5) * radius * 0.12;
        const wX = clamp(x, terrainMinX, terrainMaxX);
        const wZ = clamp(z, terrainMinZ, terrainMaxZ);
        const pulse = 0.85 + 0.15 * Math.sin(flameTimeSeconds * (0.5 + b3 * 0.7) + b2 * TAU);
        const h = tileSpan * (0.055 + cluster.intensity * 0.085) * (0.84 + b3 * 0.4) * pulse * FLAME_RENDER_SIZE_SCALE;
        const w = Math.max(tileSpan * 0.12, h * (2.35 + b2 * 1.2)) * FLAME_RENDER_SIZE_SCALE;
        const yaw = Math.atan2(cameraWorldPos.x - wX, cameraWorldPos.z - wZ) + Math.sin(flameTimeSeconds * 0.45 + b1 * TAU) * 0.08;
        const intensity = clamp((0.35 + cluster.intensity * 0.7) * pulse, 0, 1);
        fireBillboard.position.set(wX, cluster.baseY + h * 0.4, wZ);
        fireBillboard.rotation.set(0, yaw, 0);
        fireBillboard.scale.set(w * FLAME_BILLBOARD_OVERSCAN_X, h * FLAME_BILLBOARD_OVERSCAN_Y, w * FLAME_BILLBOARD_OVERSCAN_X);
        fireBillboard.updateMatrix();
        fireMesh.setMatrixAt(fireCount, fireBillboard.matrix);
        fireIntensityAttr.setX(fireCount, intensity);
        fireSeedAttr.setX(fireCount, fract(cluster.id * 0.173 + b1 + bi * 0.11));
        fireBaseCurveAttr.setX(fireCount, 0);
        fireClusterBlendAttr.setX(fireCount, clusterBlend);
        fireSmokeOccAttr.setX(fireCount, smokeOccBase);
        fireRoleAttr.setX(fireCount, 2);
        fireBillboard.rotation.set(0, yaw + Math.PI * 0.5, 0);
        fireBillboard.scale.set(
          w * 0.64 * FLAME_CORE_BILLBOARD_OVERSCAN_X,
          h * 0.48 * FLAME_CORE_BILLBOARD_OVERSCAN_Y,
          w * 0.64 * FLAME_CORE_BILLBOARD_OVERSCAN_X
        );
        fireBillboard.updateMatrix();
        fireCoreMesh.setMatrixAt(fireCount, fireBillboard.matrix);
        fireCount += 1;
        clusterBedInstances += 1;
      }
    };

    const emitClusterPlumes = (cluster: FireCluster): void => {
      if (cluster.plumeBudget <= 0 || smokeSpawnsThisFrame >= smokeSpawnFrameCap) {
        return;
      }
      const plumeAnchors = clamp(cluster.plumeBudget, 1, CLUSTER_PLUME_MAX_PER_CLUSTER);
      for (let anchor = 0; anchor < plumeAnchors && smokeSpawnsThisFrame < smokeSpawnFrameCap; anchor += 1) {
        const a1 = hash1(cluster.id * 0.377 + anchor * 3.17 + 9.1);
        const a2 = hash1(cluster.id * 0.823 + anchor * 5.27 + 4.3);
        const a3 = hash1(cluster.id * 1.173 + anchor * 7.31 + 2.7);
        const anchorTheta = a1 * TAU;
        const anchorR = Math.sqrt(a2) * cluster.radius * 0.42;
        const anchorX = clamp(
          cluster.centroidX + Math.cos(anchorTheta) * anchorR + windX * cluster.radius * 0.18 * windResponse.smoke,
          terrainMinX,
          terrainMaxX
        );
        const anchorZ = clamp(
          cluster.centroidZ + Math.sin(anchorTheta) * anchorR + windZ * cluster.radius * 0.18 * windResponse.smoke,
          terrainMinZ,
          terrainMaxZ
        );
        const spawnCount = clamp(
          Math.round((2 + cluster.intensity * 5 + cluster.tileCount * 0.08) * effectiveSmokeBudgetScale),
          1,
          8
        );
        for (let spawn = 0; spawn < spawnCount && smokeSpawnsThisFrame < smokeSpawnFrameCap; spawn += 1) {
          const r1 = hash1(a1 * 17.0 + spawn * 1.31 + timeSeconds * 0.19);
          const r2 = hash1(a2 * 23.0 + spawn * 2.17 + 7.0);
          const r3 = hash1(a3 * 29.0 + spawn * 3.11 + 13.0);
          const theta = r1 * TAU;
          const radial = Math.sqrt(r2) * cluster.radius * 0.28;
          const offsetX = Math.cos(theta) * radial;
          const offsetZ = Math.sin(theta) * radial;
          const velAlongWind = windStrength * windResponse.smoke * tileSpan * (0.74 + cluster.intensity * 1.9 + r3 * 1.1);
          const velCross = (r2 - 0.5) * tileSpan * (0.3 + cluster.intensity * 0.72);
          const spawnDownwind = velAlongWind * 0.08;
          const slot = smokeSpawnCursor;
          smokeSpawnCursor = (smokeSpawnCursor + 1) % SMOKE_MAX_INSTANCES;
          smokeParticleActive[slot] = 1;
          smokeParticleAge[slot] = 0;
          smokeParticleLife[slot] = 10.5 + cluster.intensity * 13.5 + r1 * 4.4 + windStrength * 2.8;
          smokeParticleX[slot] = anchorX + offsetX + crossWindX * velCross * 0.24 + windX * spawnDownwind;
          smokeParticleY[slot] = cluster.baseY + 0.16 + r3 * tileSpan * 0.42;
          smokeParticleZ[slot] = anchorZ + offsetZ + crossWindZ * velCross * 0.24 + windZ * spawnDownwind;
          smokeParticleVx[slot] = windX * velAlongWind + crossWindX * velCross;
          smokeParticleVy[slot] = tileSpan * (0.62 + cluster.intensity * 1.22 + r3 * 0.42);
          smokeParticleVz[slot] = windZ * velAlongWind + crossWindZ * velCross;
          smokeParticleSeed[slot] = r3;
          smokeParticleIntensity[slot] = clamp(cluster.intensity * (0.72 + r2 * 0.3), 0, 1.2);
          smokeParticleSoot[slot] = clamp(0.28 + cluster.intensity * 0.48 + (r2 - 0.5) * 0.1, 0, 1);
          smokeParticleBaseSize[slot] = tileSpan * (1.22 + cluster.intensity * 1.9 + r2 * 0.95);
          smokeParticleSourceX[slot] = anchorX;
          smokeParticleSourceY[slot] = cluster.baseY + 0.12;
          smokeParticleSourceZ[slot] = anchorZ;
          smokeParticleSourceIdx[slot] = cluster.sourceIdx;
          smokeSpawnsThisFrame += 1;
          clusterPlumeSpawns += 1;
        }
      }
    };

    emitFrontRuns();
    for (let i = 0; i < fireClusters.length; i += 1) {
      emitClusterFlameBed(fireClusters[i]);
      emitClusterPlumes(fireClusters[i]);
    }
    for (let y = minY; y <= maxY; y += sampleStep) {
      const rowBase = y * cols;
      for (let x = minX; x <= maxX; x += sampleStep) {
        const idx = rowBase + x;
        const fire = fireView.getFireByIndex(idx);
        const heat = fireView.getHeat01ByIndex(idx);
        const fuel = fireView.getFuelByIndex(idx);
        const scheduled = fireView.getScheduledByIndex(idx);
        const typeId = world.tileTypeId[idx] ?? -1;
        const isAshTile = (world.tileTypeId[idx] ?? -1) === TILE_TYPE_IDS.ash;
        const flameProfile: TreeFlameProfile | null = treeBurn?.getTileFlameProfile(idx) ?? null;
        const burnProgress = treeBurn?.getTileBurnProgress(idx) ?? 0;
        const isStructureTile = typeId === TILE_TYPE_IDS.house || typeId === TILE_TYPE_IDS.base;
        const hasActiveFire = fire > simFireEps;
        const treeBurnVisual = treeBurn?.getTileBurnVisual(idx) ?? 0;
        const hasCarryFuel = fuel > TREE_BURN_CARRY_FUEL_MIN && !isAshTile;
        const hasTreeCarryFlame =
          !hasActiveFire &&
          hasCarryFuel &&
          flameProfile !== null &&
          treeBurnVisual > TREE_BURN_FLAME_VISUAL_MIN &&
          burnProgress > TREE_BURN_CARRY_PROGRESS_MIN &&
          heat > 0.08;
        const neighbourFire = getNeighbourFireBias(fireView, cols, rows, x, y);
        const flameVisual = hasActiveFire
          ? Math.max(fire, treeBurnVisual * 0.95)
          : hasTreeCarryFlame
            ? treeBurnVisual * 0.72
            : 0;
        const scheduledPreheat = !hasActiveFire
          ? clamp(scheduled * smoothstep(0.03, 0.18, heat) * SCHEDULED_PREHEAT_MAX_SCALE, 0, SCHEDULED_PREHEAT_MAX_SCALE)
          : 0;
        const hasVisualFlame = hasActiveFire || hasTreeCarryFlame || scheduledPreheat > 0.01;
        if (hasVisualFlame) {
          visibleFlameTiles += 1;
        }
        const targetFlameBase = hasActiveFire
          ? clamp(flameVisual * 0.6 + heat * 0.28 + treeBurnVisual * 0.16, 0, 1)
          : hasTreeCarryFlame
            ? clamp(flameVisual * 0.8 + heat * 0.24, 0, 1)
            : scheduledPreheat;
        const previousFlame = tileFlameVisual[idx] ?? 0;
        let ignitionAgeSeconds = tileIgnitionAgeSeconds[idx] ?? 0;
        const sustainIgnitionAge =
          hasActiveFire ||
          scheduledPreheat > 0.01 ||
          fire > simFireEps * 0.35 ||
          previousFlame > 0.04;
        if (sustainIgnitionAge) {
          ignitionAgeSeconds = Math.min(8, ignitionAgeSeconds + deltaSeconds);
        } else {
          ignitionAgeSeconds = Math.max(0, ignitionAgeSeconds - deltaSeconds * 6);
        }
        tileIgnitionAgeSeconds[idx] = ignitionAgeSeconds;
        const radiantDrive = clamp(heat * 0.62 + neighbourFire * 0.88, 0, 1.2);
        const rampSecondsEffective = clamp(
          IGNITION_RAMP_SECONDS_BASE * (1 - radiantDrive * IGNITION_RAMP_ACCELERATION),
          IGNITION_RAMP_SECONDS_MIN,
          IGNITION_RAMP_SECONDS_BASE
        );
        const ignitionRamp01 = hasActiveFire
          ? smoothstep(0, rampSecondsEffective, ignitionAgeSeconds)
          : hasTreeCarryFlame
            ? 1
            : scheduledPreheat > 0.01
              ? smoothstep(0, rampSecondsEffective * 0.7, ignitionAgeSeconds) * scheduledPreheat / SCHEDULED_PREHEAT_MAX_SCALE
              : 0;
        const rampFloor = hasActiveFire ? 0.1 : scheduledPreheat > 0.01 ? 0.02 : 1;
        const targetFlame = hasActiveFire
          ? clamp(targetFlameBase * (rampFloor + (1 - rampFloor) * ignitionRamp01), 0, 1)
          : clamp(targetFlameBase, 0, 1);
        let smoothedFlame = hasVisualFlame
          ? smoothApproach(
              previousFlame,
              targetFlame,
              9.4,
              Math.max(7.6, 1 / Math.max(0.001, FLAME_VISUAL_RELEASE_SECONDS)),
              deltaSeconds
            )
          : smoothApproach(
              previousFlame,
              0,
              0,
              Math.max(8.2, 1 / Math.max(0.001, FLAME_VISUAL_RELEASE_SECONDS)),
              deltaSeconds
            );
        tileFlameVisual[idx] = smoothedFlame;
        const targetSmoke = hasActiveFire || hasTreeCarryFlame
          ? clamp(Math.max(targetFlameBase * 0.85, heat * 0.95, treeBurnVisual * 0.8), 0, 1.2)
          : 0;
        const smoothedSmoke = hasActiveFire || hasTreeCarryFlame
          ? smoothApproach(tileSmokeVisual[idx] ?? 0, targetSmoke, 10.0, 6.6, deltaSeconds)
          : smoothApproach(tileSmokeVisual[idx] ?? 0, 0, 0, 9.4, deltaSeconds);
        tileSmokeVisual[idx] = smoothedSmoke;
        const tileCluster = tileClusterId[idx] >= 0 ? fireClusters[tileClusterId[idx]] ?? null : null;
        const tileRole = tileCluster ? (tileClusterRole[idx] as ClusterRole) : 0;
        const clusterBlend = tileCluster
          ? clamp(
              (tileCluster.tileCount - CLUSTER_MIN_TILES) / Math.max(1, CLUSTER_FULL_BLEND_TILES - CLUSTER_MIN_TILES),
              0,
              1
            )
          : 0;
        const frontDominance = clamp((tileFrontStrength[idx] ?? 0) * (hasActiveFire ? 1 : 0.18), 0, 1.25);
        if (tileCluster) {
          const tileCenterXOcc = ((x + 0.5) / cols - 0.5) * terrainSize.width;
          const tileCenterZOcc = ((y + 0.5) / rows - 0.5) * terrainSize.depth;
          const distNorm = Math.hypot(tileCenterXOcc - tileCluster.centroidX, tileCenterZOcc - tileCluster.centroidZ) /
            Math.max(tileSpan * 0.75, tileCluster.radius * 1.05);
          const plumeInfluence = 1 - smoothstep(0.38, 1.08, distNorm);
          tileSmokeOcclusion01[idx] = clamp(
            smoothedSmoke * (0.48 + clusterBlend * 0.25) + plumeInfluence * clusterBlend * (0.24 + tileCluster.intensity * 0.26),
            0,
            1
          );
        } else {
          tileSmokeOcclusion01[idx] = clamp(smoothedSmoke * 0.16, 0, 1);
        }
        const hasFlame = smoothedFlame > flamePresenceEps;
        const hasPlume = hasFlame || smoothedSmoke > 0.02;
        const sparkVisibleThreshold = Math.max(flamePresenceEps * 1.6, SPARK_VISIBLE_FLAME_MIN);
        const canPreviewAsh = isAshPreviewCandidateType(typeId);
        let targetAshPreview = 0;
        const ashSuppressed =
          fire > ASH_PREVIEW_FIRE_MAX ||
          heat > ASH_PREVIEW_HEAT_MAX ||
          smoothedFlame > ASH_PREVIEW_FLAME_MAX ||
          scheduled > 0.05 ||
          hasTreeCarryFlame;
        if (canPreviewAsh && !ashSuppressed) {
          const baseFuelRef = ASH_PREVIEW_BASE_FUEL_BY_TYPE_ID[typeId] ?? 0;
          const fallbackFuelRef = Math.max(0.01, baseFuelRef * 0.42);
          const previousFuelRef = tileFuelReference[idx] ?? 0;
          const nextFuelRef = Math.max(previousFuelRef, fuel, fallbackFuelRef);
          tileFuelReference[idx] = nextFuelRef;
          const fuelDepletion = clamp(1 - fuel / Math.max(0.01, nextFuelRef), 0, 1);
          const heatDrive = clamp((heat - 0.05) * 0.62 + treeBurnVisual * 0.18, 0, 1);
          targetAshPreview = clamp(Math.max(fuelDepletion * 1.08, heatDrive * 0.82), 0, 1);
        } else {
          tileFuelReference[idx] = 0;
        }
        if (isAshTile) {
          targetAshPreview = 0;
        }
        const ashPreview = smoothApproach(tileAshPreviewVisual[idx] ?? 0, targetAshPreview, 7.2, 2.9, deltaSeconds);
        tileAshPreviewVisual[idx] = ashPreview;
        if (ashPreview > 0.03 && ashPreviewCount < ashPreviewCap) {
          const tileCenterXPreview = ((x + 0.5) / cols - 0.5) * terrainSize.width;
          const tileCenterZPreview = ((y + 0.5) / rows - 0.5) * terrainSize.depth;
          const x1 = Math.min(cols - 1, x + sampleStep);
          const y1 = Math.min(rows - 1, y + sampleStep);
          const rowBase1 = y1 * cols;
          const e00 = clamp(world.tileElevation[idx] ?? 0, -1, 1);
          const e10 = clamp(world.tileElevation[rowBase + x1] ?? e00, -1, 1);
          const e01 = clamp(world.tileElevation[rowBase1 + x] ?? e00, -1, 1);
          const e11 = clamp(world.tileElevation[rowBase1 + x1] ?? e00, -1, 1);
          const x0 = Math.max(0, x - sampleStep);
          const y0 = Math.max(0, y - sampleStep);
          const rowBase0 = y0 * cols;
          const left = clamp(world.tileElevation[rowBase + x0] ?? e00, -1, 1);
          const right = clamp(world.tileElevation[rowBase + x1] ?? e00, -1, 1);
          const down = clamp(world.tileElevation[rowBase0 + x] ?? e00, -1, 1);
          const up = clamp(world.tileElevation[rowBase1 + x] ?? e00, -1, 1);
          const spanX = Math.max(0.0001, tileSpanX * Math.max(1, x1 - x0));
          const spanZ = Math.max(0.0001, tileSpanZ * Math.max(1, y1 - y0));
          const slopeX = ((right - left) * heightScale) / spanX;
          const slopeZ = ((up - down) * heightScale) / spanZ;
          ashPreviewNormal.set(-slopeX, 1, -slopeZ).normalize();
          const groundPreviewY = (e00 + e10 + e01 + e11) * 0.25 * heightScale;
          ashPreviewOffset.copy(ashPreviewNormal).multiplyScalar(ASH_PREVIEW_Y_OFFSET);
          ashPreviewBillboard.position.set(
            tileCenterXPreview + ashPreviewOffset.x,
            groundPreviewY + ashPreviewOffset.y,
            tileCenterZPreview + ashPreviewOffset.z
          );
          ashPreviewBillboard.quaternion.setFromUnitVectors(WORLD_UP, ashPreviewNormal);
          ashPreviewBillboard.scale.set(tileSpanX * sampleStep * 0.96, tileSpanZ * sampleStep * 0.96, 1);
          ashPreviewBillboard.updateMatrix();
          ashPreviewMesh.setMatrixAt(ashPreviewCount, ashPreviewBillboard.matrix);
          ashPreviewProgressAttr.setX(ashPreviewCount, ashPreview);
          ashPreviewSeedAttr.setX(ashPreviewCount, hash1(idx * 0.137 + 17.3));
          ashPreviewCount += 1;
        }
        if (!hasPlume) {
          tileSmokeSpawnAccum[idx] = Math.max(0, (tileSmokeSpawnAccum[idx] ?? 0) - deltaSeconds * 0.6);
          continue;
        }
        const intensity = clamp(Math.max(smoothedFlame, heat * 0.5), 0, 1);
        const flameIntensity = clamp(smoothedFlame, 0, 1);
        const flameSize01 = smoothstep(0.0, 0.3, flameIntensity);
        const normX = (x + 0.5) / cols;
        const normZ = (y + 0.5) / rows;
        const tileCenterX = (normX - 0.5) * terrainSize.width;
        const tileCenterZ = (normZ - 0.5) * terrainSize.depth;
        const tileHalfX = tileSpanX * 0.46;
        const tileHalfZ = tileSpanZ * 0.46;
        const minTileX = tileCenterX - tileHalfX;
        const maxTileX = tileCenterX + tileHalfX;
        const minTileZ = tileCenterZ - tileHalfZ;
        const maxTileZ = tileCenterZ + tileHalfZ;
        const anchor = treeBurn?.getTileAnchor(idx);
        const crownToTrunk = smoothstep(0.32, 0.88, burnProgress);
        const trunkDescent = smoothstep(0.58, 1.0, burnProgress);
        const worldX = anchor ? clamp(anchor.x, minTileX, maxTileX) : tileCenterX;
        const worldZ = anchor ? clamp(anchor.z, minTileZ, maxTileZ) : tileCenterZ;
        const frontSample = hasActiveFire
          ? getNeighbourFireFront(fireView, cols, rows, x, y, simFireEps, windX, windZ)
          : { centerTileX: x + 0.5, centerTileY: y + 0.5, strength: 0 };
        const frontWorldX = (frontSample.centerTileX / cols - 0.5) * terrainSize.width;
        const frontWorldZ = (frontSample.centerTileY / rows - 0.5) * terrainSize.depth;
        const frontBlend = clamp(wallBlend * frontSample.strength, 0, 0.72);
        const flameSourceX = clamp(worldX * (1 - frontBlend) + frontWorldX * frontBlend, terrainMinX, terrainMaxX);
        const flameSourceZ = clamp(worldZ * (1 - frontBlend) + frontWorldZ * frontBlend, terrainMinZ, terrainMaxZ);
        const elevation = world.tileElevation[idx] ?? 0;
        const baseY = anchor ? anchor.y : clamp(elevation, -1, 1) * heightScale;
        const tileSeed = hash1(idx + 0.123);
        const clusterNoise = hash1(idx * 0.173 + 5.17);
        const clusterBias = clamp(
          (neighbourFire - flameIntensity) * FIRE_VISUAL_TUNING.clusterStrength + (clusterNoise - 0.5) * 0.3,
          -0.45,
          0.55
        );
        const slowFlicker =
          0.5 + 0.5 * Math.sin(flameTimeSeconds * (0.45 + clusterNoise * 0.5) + clusterNoise * TAU);
        const ignitionRampStrength = hasActiveFire ? clamp(0.28 + ignitionRamp01 * 0.72, 0.28, 1) : 1;
        const tongueDrive = clamp(
          (flameIntensity * 0.9 + heat * 0.38 + clusterBias * 0.7 + slowFlicker * 0.24 - 0.1) * ignitionRampStrength,
          0,
          1.2
        );
        const roleHeightScale =
          tileRole === 2
            ? CLUSTER_INTERIOR_HEIGHT_SCALE
            : tileRole === 1
              ? CLUSTER_EDGE_HEIGHT_SCALE
              : 1;
        const roleWidthScale =
          tileRole === 2
            ? CLUSTER_INTERIOR_WIDTH_SCALE
            : tileRole === 1
              ? CLUSTER_EDGE_WIDTH_SCALE
              : 1;
        const tongueCountRaw =
          FIRE_VISUAL_TUNING.tongueSpawnMin +
          (FIRE_VISUAL_TUNING.tongueSpawnMax - FIRE_VISUAL_TUNING.tongueSpawnMin) * clamp(tongueDrive, 0, 1);
        let flameletCount = Math.round(tongueCountRaw);
        if (tongueDrive < 0.24 && slowFlicker < 0.42) {
          flameletCount = 0;
        }
        flameletCount = Math.round(flameletCount * flameDensityScale * sliceComplexityScale);
        if (tileRole === 2) {
          flameletCount = Math.min(flameletCount, flameBudgetScale < 0.62 ? 1 : CLUSTER_INTERIOR_KERNEL_CAP);
        } else if (tileRole === 1) {
          flameletCount = Math.min(flameletCount, CLUSTER_EDGE_KERNEL_CAP);
        }
        flameletCount = Math.max(0, Math.min(FIRE_VISUAL_TUNING.tongueSpawnMax, flameletCount));
        flameletCount = Math.min(flameletCount, perTileFlameCap);
        flameletCount = Math.round(flameletCount * (0.45 + ignitionRamp01 * 0.55));
        const hasObjectAnchorFlame = flameProfile !== null || isStructureTile;
        const frontRead01 =
          frontPassActive
            ? smoothstep(FIRE_FRONT_VISUAL_MIN, 0.56, frontDominance) * smoothstep(FIRE_FRONT_PASS_MIN_WEIGHT, 12, visualFrontWeight)
            : 0;
        const preserveLocalDetail =
          flameProfile !== null
            ? 0.34
            : isStructureTile
              ? 0.28
              : frontPassActive
                ? 0.18
                : hasActiveFire
                  ? 0.58
                  : 0.22;
        const localDetailScale = clamp(
          preserveLocalDetail +
            frontRead01 * (flameProfile !== null ? 0.22 : isStructureTile ? 0.16 : 0.08) +
            (tileRole === 1 ? 0.08 : 0),
          preserveLocalDetail,
          hasObjectAnchorFlame ? 0.62 : frontPassActive ? 0.28 : 0.74
        );
        const sparkVisual01 = clamp(
          smoothstep(sparkVisibleThreshold, 0.5, smoothedFlame) *
            smoothstep(
              SPARK_VISIBLE_HEAT_MIN,
              0.4,
              Math.max(heat, treeBurnVisual * 0.72 + smoothedFlame * 0.42 + frontRead01 * 0.16)
            ),
          0,
          1
        );
        const sparkWindFactor = windResponse.spark;
        const sparkFrontFactor = frontPassActive
          ? clamp(0.22 + frontRead01 * 0.9 + (tileRole === 1 ? 0.12 : 0), 0.22, 1.18)
          : 0.58;
        const sparkActive =
          hasFlame &&
          sparkVisual01 > 0.035 &&
          (hasActiveFire || hasTreeCarryFlame || treeBurnVisual > TREE_BURN_FLAME_VISUAL_MIN);
        flameletCount = Math.round(flameletCount * localDetailScale);
        if (frontPassActive && tileRole === 2 && frontDominance < FIRE_FRONT_VISUAL_MIN && flameProfile === null) {
          flameletCount = 0;
        }
        const sustainInteriorFlame =
          hasActiveFire &&
          flameProfile === null &&
          fire > 0.16 &&
          heat > 0.2 &&
          smoothedFlame > Math.max(flamePresenceEps * 1.1, 0.08);
        if (sustainInteriorFlame && flameletCount <= 0) {
          flameletCount = 1;
        }
        const heroCount =
          flameletCount <= 0
            ? 0
            : Math.max(
                hasActiveFire ? (ignitionRamp01 >= 0.45 ? 1 : 0) : 1,
                Math.min(
                  tileRole === 2 ? 1 : tileRole === 1 ? 2 : 4,
                  Math.round(flameletCount * (0.22 + ignitionRamp01 * 0.16) + (1 - crownToTrunk) * 0.55)
                )
              );
        const windStrengthBoost = (0.35 + windStrength * windStrength * 0.9) * windResponse.flame;
        const crownRadius = flameProfile ? flameProfile.crownRadius * (0.9 + Math.min(0.5, flameProfile.treeCount * 0.08)) : tileSpan * FLAME_CELL_LATERAL_LIMIT;
        const trunkRadius = flameProfile ? Math.max(tileSpan * 0.1, crownRadius * 0.22) : tileSpan * 0.16;
        const sourceRadius =
          (crownRadius * (1 - crownToTrunk) + trunkRadius * crownToTrunk) *
          (tileRole === 2 ? 1.08 : tileRole === 1 ? 1.04 : 1);
        const lateralLimit = Math.max(
          tileSpan * 0.14,
          sourceRadius * (1.26 - crownToTrunk * 0.46) + sampleFootprint * (0.22 + wallBlend * frontSample.strength * 1.05)
        );
        const crownSourceY = flameProfile ? flameProfile.y + flameProfile.crownHeight * 0.72 : baseY + tileSpan * 0.45;
        const trunkSourceY = flameProfile
          ? flameProfile.y + flameProfile.trunkHeight * (0.95 + (0.2 - 0.95) * trunkDescent)
          : baseY + tileSpan * (0.28 + (0.12 - 0.28) * trunkDescent);
        const sourceYBase = crownSourceY * (1 - crownToTrunk) + trunkSourceY * crownToTrunk;
        const roofSourceY = baseY + tileSpan * (typeId === TILE_TYPE_IDS.base ? 0.42 : 0.34);
        const objectSourceY = flameProfile !== null ? crownSourceY : roofSourceY;
        const objectSourceX = flameProfile !== null ? flameProfile.x : worldX;
        const objectSourceZ = flameProfile !== null ? flameProfile.z : worldZ;
        const objectFlameDrive = clamp(
          smoothedFlame * (hasActiveFire ? clamp(0.22 + ignitionRamp01 * 0.78, 0.22, 1) : 1),
          0,
          1
        );
        const objectFlameScale01 = smoothstep(0.04, 0.32, objectFlameDrive);
        const frontDirXRaw = frontWorldX - worldX;
        const frontDirZRaw = frontWorldZ - worldZ;
        const frontDirLen = Math.hypot(frontDirXRaw, frontDirZRaw);
        const fallbackDirX = windDirLen > 0.0001 ? windX / windDirLen : Math.cos(tileSeed * TAU);
        const fallbackDirZ = windDirLen > 0.0001 ? windZ / windDirLen : Math.sin(tileSeed * TAU);
        const frontDirX = frontDirLen > 0.0001 ? frontDirXRaw / frontDirLen : fallbackDirX;
        const frontDirZ = frontDirLen > 0.0001 ? frontDirZRaw / frontDirLen : fallbackDirZ;
        const sideDirX = -frontDirZ;
        const sideDirZ = frontDirX;
        const emitterLobeCountBase = Math.max(
          FLAME_JET_KERNEL_MIN,
          Math.min(FLAME_JET_KERNEL_MAX, Math.round(2 + flameIntensity * 2 + frontSample.strength * 2.1))
        );
        const emitterLobeCount = Math.max(
          FLAME_JET_KERNEL_MIN,
          Math.min(FLAME_JET_KERNEL_MAX, Math.round(emitterLobeCountBase * kernelBudgetScale))
        );
        const emitterLobeCountRoleCapped = tileRole === 2
          ? Math.min(emitterLobeCount, flameBudgetScale < 0.62 ? 1 : CLUSTER_INTERIOR_KERNEL_CAP)
          : tileRole === 1
            ? Math.min(emitterLobeCount, CLUSTER_EDGE_KERNEL_CAP)
            : emitterLobeCount;
        const emitterBaseRadius = sourceRadius * (0.28 + flameIntensity * 0.2 + frontSample.strength * 0.24);
        const kernelDriftPhase = flameTimeSeconds * (0.22 + tileSeed * 0.31) + tileSeed * TAU;
        let jetClusterX = clamp(
          flameSourceX +
            frontDirX * Math.sin(kernelDriftPhase) * emitterBaseRadius * 0.34 +
            sideDirX * Math.cos(kernelDriftPhase * 1.17) * emitterBaseRadius * 0.29,
          terrainMinX,
          terrainMaxX
        );
        let jetClusterZ = clamp(
          flameSourceZ +
            frontDirZ * Math.sin(kernelDriftPhase) * emitterBaseRadius * 0.34 +
            sideDirZ * Math.cos(kernelDriftPhase * 1.17) * emitterBaseRadius * 0.29,
          terrainMinZ,
          terrainMaxZ
        );
        if (tileCluster) {
          const clusterOffsetX = flameSourceX - tileCluster.centroidX;
          const clusterOffsetZ = flameSourceZ - tileCluster.centroidZ;
          const spanOffset = clusterOffsetX * tileCluster.spanAxisX + clusterOffsetZ * tileCluster.spanAxisZ;
          const depthOffset = clusterOffsetX * tileCluster.depthAxisX + clusterOffsetZ * tileCluster.depthAxisZ;
          const spanPreserve = tileRole === 2 ? 1.08 : 0.94;
          const depthCompress = tileRole === 2 ? 0.18 : 0.4;
          const bandCenterX =
            tileCluster.centroidX +
            tileCluster.spanAxisX * spanOffset * spanPreserve +
            tileCluster.depthAxisX * depthOffset * depthCompress;
          const bandCenterZ =
            tileCluster.centroidZ +
            tileCluster.spanAxisZ * spanOffset * spanPreserve +
            tileCluster.depthAxisZ * depthOffset * depthCompress;
          const clusterCenterBlend = clusterBlend * (tileRole === 2 ? 0.24 : 0.12);
          jetClusterX = clamp(
            jetClusterX * (1 - clusterCenterBlend) + bandCenterX * clusterCenterBlend,
            terrainMinX,
            terrainMaxX
          );
          jetClusterZ = clamp(
            jetClusterZ * (1 - clusterCenterBlend) + bandCenterZ * clusterCenterBlend,
            terrainMinZ,
            terrainMaxZ
          );
        }
        let tileTipSparkEmitted = 0;
        let tileCrossSlices = 0;
        if (hasFlame) {
          for (let flamelet = 0; flamelet < flameletCount && fireCount < FIRE_MAX_INSTANCES; flamelet += 1) {
          const s1 = hash1(idx * 1.173 + flamelet * 11.0 + 19.7);
          const s2 = hash1(idx * 0.917 + flamelet * 17.0 + 41.3);
          const s3 = hash1(idx * 1.411 + flamelet * 23.0 + 67.9);
          const isHero = flamelet < heroCount;
          const sizeVar =
            FIRE_VISUAL_TUNING.sizeVariationMin +
            s1 * (FIRE_VISUAL_TUNING.sizeVariationMax - FIRE_VISUAL_TUNING.sizeVariationMin);
          const leanVar =
            FIRE_VISUAL_TUNING.leanVariationMin +
            s2 * (FIRE_VISUAL_TUNING.leanVariationMax - FIRE_VISUAL_TUNING.leanVariationMin);
          const flickerRate =
            FIRE_VISUAL_TUNING.flickerRateMin +
            s2 * (FIRE_VISUAL_TUNING.flickerRateMax - FIRE_VISUAL_TUNING.flickerRateMin);
          const lobeCount = Math.max(1, emitterLobeCountRoleCapped);
          const emitterIdx = (flamelet + Math.floor(tileSeed * lobeCount * 1.7)) % lobeCount;
          const emitterSeed = hash1(idx * 0.377 + emitterIdx * 13.1 + 5.9);
          const emitterAngle = ((emitterIdx + emitterSeed * 0.35) / lobeCount) * TAU + tileSeed * TAU * 0.17;
          const emitterBreath = 0.82 + 0.18 * Math.sin(flameTimeSeconds * (0.24 + emitterSeed * 0.28) + emitterSeed * TAU);
          const emitterAlong = Math.cos(emitterAngle) * emitterBaseRadius * (0.75 + emitterSeed * 0.55) * emitterBreath;
          const emitterAcross = Math.sin(emitterAngle) * emitterBaseRadius * (0.58 + (1 - emitterSeed) * 0.48);
          const emitterX = frontDirX * emitterAlong + sideDirX * emitterAcross;
          const emitterZ = frontDirZ * emitterAlong + sideDirZ * emitterAcross;
          const tierBase = isHero
            ? 0.72 + s3 * 0.42 + (s1 - 0.5) * 0.18
            : 0.36 + s3 * 0.56 + (s2 - 0.5) * 0.18;
          const tierScale = clamp(tierBase * sizeVar, isHero ? 0.54 : 0.28, isHero ? 1.42 : 1.08);
          const phaseRate = isHero ? 0.18 + flickerRate * 0.14 : 0.46 + flickerRate * 0.55;
          const phase = fract(
            flameTimeSeconds * phaseRate + s3 + emitterSeed * 0.41 + (isHero ? flamelet * 0.03 : flamelet * 0.09)
          );
          const riseT = isHero ? Math.pow(phase, 1.35) : Math.pow(phase, 2.0);
          const baseSpread =
            sourceRadius * (isHero ? 0.24 + flameIntensity * 0.34 : 0.34 + flameIntensity * 0.5) +
            sampleFootprint * (isHero ? 0.1 : 0.18);
          const spawnX = emitterX + (s1 - 0.5) * baseSpread;
          const spawnZ = emitterZ + (s2 - 0.5) * baseSpread;
          const heroLaneT = isHero && heroCount > 1 ? fract((flamelet + s3 * 0.7) / heroCount + emitterSeed * 0.19) : 0.5;
          const heroLane = (heroLaneT - 0.5) * 2;
          const heroLaneX = isHero ? heroLane * sourceRadius * (0.28 + flameIntensity * 0.28) : 0;
          const heroLaneZ = isHero
            ? Math.sin(heroLane * 1.6 + s2 * TAU * 0.35 + emitterSeed * TAU * 0.2) * sourceRadius * (0.16 + flameIntensity * 0.12)
            : 0;
          const jetSpin = flameTimeSeconds * (0.62 + flickerRate * 0.38 + emitterSeed * 0.24) + emitterSeed * TAU + flamelet * 0.21;
          const helixRadius = sourceRadius * (isHero ? 0.12 : 0.08) * (0.35 + riseT * 1.1 + s2 * 0.3);
          const helixX = Math.cos(jetSpin + riseT * 6.2) * helixRadius;
          const helixZ = Math.sin(jetSpin * 1.08 + riseT * 5.6) * helixRadius;
          const jetBend = windStrength * windResponse.flame * sampleFootprint * (0.018 + riseT * 0.22);
          const bendX = windX * jetBend + sideDirX * (s3 - 0.5) * sampleFootprint * (0.04 + riseT * 0.1);
          const bendZ = windZ * jetBend + sideDirZ * (s1 - 0.5) * sampleFootprint * (0.04 + riseT * 0.1);
          const curlAmp = sourceRadius * (isHero ? 0.2 : 0.16) * tierScale;
          const curlX = Math.sin(phase * (isHero ? 6.4 : 10.4) + s1 * Math.PI * 2) * curlAmp;
          const curlZ = Math.cos(phase * (isHero ? 5.8 : 9.2) + s2 * Math.PI * 2) * curlAmp * 0.55;
          const lashPhase =
            flameTimeSeconds * (isHero ? 0.74 + flickerRate * 0.92 : 0.92 + flickerRate * 1.2) + s1 * TAU + phase * 4.2;
          const lashDamp = 1 - smoothstep(0.64, 1.0, riseT);
          const lashAmp = sourceRadius * (isHero ? 0.26 : 0.17) * (0.35 + flameIntensity * 0.85 + heat * 0.35) * lashDamp;
          const lashX = Math.sin(lashPhase) * lashAmp;
          const lashZ = Math.cos(lashPhase * 1.17 + s3 * TAU) * lashAmp * 0.68;
          const windFlicker = 0.76 + 0.24 * Math.sin(flameTimeSeconds * 2.1 + s2 * Math.PI * 2);
          const windScale =
            tileSpan * (0.006 + flameIntensity * 0.02 + heat * 0.015 + leanVar * 0.05) * windStrengthBoost * windFlicker;
          const windOffsetX = windX * windScale * (0.22 + riseT * 0.52);
          const windOffsetZ = windZ * windScale * (0.22 + riseT * 0.52);
          const riseHeight =
            (sampleFootprint * (0.14 + flameIntensity * 0.34 + heat * 0.2) + sourceRadius * 0.42) * tierScale;
          const flameRise =
            riseT *
            riseHeight *
            (isHero ? 0.4 : 0.22) *
            flameHeightBoost *
            FLAME_RENDER_SIZE_SCALE *
            flameSize01;
          const heightPulse = isHero ? 0.92 + 0.08 * (1 - phase * phase) : 0.9 + 0.1 * (1 - phase);
          const flameHeightBase = Math.max(
            tileSpan * (isHero ? 0.18 : 0.1),
            (sampleFootprint * (0.2 + heat * 0.25 + flameIntensity * 0.2) + sourceRadius * 0.32) *
              tierScale *
              heightPulse *
              flameHeightBoost *
              roleHeightScale
          );
          const flameWidthBase = Math.max(
            tileSpan * (isHero ? 0.18 : 0.11),
            flameHeightBase * (isHero ? 0.86 + 0.18 * s1 : 0.66 + 0.18 * s1) * flameWidthBoost * roleWidthScale
          );
          const flameHeight =
            Math.max(
              tileSpan * (isHero ? LOCAL_FLAME_MIN_HEIGHT_TILES * 1.12 : LOCAL_FLAME_MIN_HEIGHT_TILES),
              flameHeightBase * FLAME_RENDER_SIZE_SCALE
            ) * flameSize01;
          const flameWidth =
            Math.max(
              tileSpan * (isHero ? LOCAL_FLAME_MIN_WIDTH_TILES * 1.1 : LOCAL_FLAME_MIN_WIDTH_TILES),
              flameWidthBase * FLAME_RENDER_SIZE_SCALE
            ) * flameSize01;
          const flameY = sourceYBase + flameRise;
          let lateralX = spawnX + heroLaneX + helixX + bendX + curlX + lashX + windOffsetX;
          let lateralZ = spawnZ + heroLaneZ + helixZ + bendZ + curlZ + lashZ + windOffsetZ;
          const softLimit = lateralLimit * (isHero ? 0.7 : 0.92) * (0.88 + s3 * 0.22);
          if (Math.abs(lateralX) > softLimit) {
            lateralX = Math.sign(lateralX) * (softLimit + (Math.abs(lateralX) - softLimit) * 0.1);
          }
          if (Math.abs(lateralZ) > softLimit) {
            lateralZ = Math.sign(lateralZ) * (softLimit + (Math.abs(lateralZ) - softLimit) * 0.1);
          }
          const localLimit = lateralLimit * (1.02 + emitterSeed * 0.34 + frontSample.strength * 0.2);
          lateralX = clamp(lateralX, -localLimit, localLimit);
          lateralZ = clamp(lateralZ, -localLimit, localLimit);
          const flameWorldX = clamp(flameSourceX + lateralX, terrainMinX, terrainMaxX);
          const flameWorldZ = clamp(flameSourceZ + lateralZ, terrainMinZ, terrainMaxZ);
          const jetTangentX =
            helixX * 1.1 + curlX * 0.8 + lashX * 0.7 + windOffsetX * 0.6 + windX * sampleFootprint * (0.05 + riseT * 0.08);
          const jetTangentZ =
            helixZ * 1.1 + curlZ * 0.8 + lashZ * 0.7 + windOffsetZ * 0.6 + windZ * sampleFootprint * (0.05 + riseT * 0.08);
          const jetYaw = Math.atan2(jetTangentX + 0.0001, jetTangentZ + 0.0001);
          const cameraYaw = Math.atan2(cameraWorldPos.x - flameWorldX, cameraWorldPos.z - flameWorldZ);
          const yawBlend = 0.18 + (1 - crossSliceBudget01) * 0.22;
          const slicePhase = flameTimeSeconds * (0.42 + emitterSeed * 0.33) + emitterSeed * TAU;
          const yawTurbulence = Math.sin(lashPhase * 0.63 + emitterSeed * TAU) * 0.09;
          const baseYaw = jetYaw * (1 - yawBlend) + cameraYaw * yawBlend + yawTurbulence;
          const sliceYawA = baseYaw + Math.sin(slicePhase) * 0.07;
          const sliceYawB = baseYaw + Math.PI * 0.5 + Math.cos(slicePhase * 1.27 + s3 * TAU) * 0.11;
          const sliceYawC = baseYaw + Math.PI * 0.25 + Math.sin(slicePhase * 1.53 + s2 * TAU) * 0.09;
          fireBillboard.position.set(flameWorldX, flameY, flameWorldZ);
          fireBillboard.rotation.set(0, sliceYawA, 0);
          fireBillboard.scale.set(
            flameWidth * FLAME_BILLBOARD_OVERSCAN_X,
            flameHeight * FLAME_BILLBOARD_OVERSCAN_Y,
            flameWidth * FLAME_BILLBOARD_OVERSCAN_X
          );
          fireBillboard.updateMatrix();
          fireMesh.setMatrixAt(fireCount, fireBillboard.matrix);
          const stageBoost = 0.85 + (1 - crownToTrunk) * 0.2;
          const flickerIntensity = clamp(
            (flameIntensity * (isHero ? 0.78 : 0.56) * (0.78 + 0.22 * (1 - phase)) + heat * (isHero ? 0.18 : 0.1)) * stageBoost,
            0,
            1
          );
          fireIntensityAttr.setX(fireCount, flickerIntensity);
          fireSeedAttr.setX(fireCount, fract(tileSeed + s3 + flamelet * 0.19));
          const crownCurve = clamp(0.12 + (1 - crownToTrunk) * 0.75, 0, 1);
          fireBaseCurveAttr.setX(fireCount, crownCurve);
          fireClusterBlendAttr.setX(fireCount, clusterBlend);
          fireSmokeOccAttr.setX(fireCount, tileSmokeOcclusion01[idx] ?? 0);
          fireRoleAttr.setX(fireCount, tileRole);
          fireBillboard.rotation.set(0, sliceYawB, 0);
          fireBillboard.scale.set(
            flameWidth * 0.62 * FLAME_CORE_BILLBOARD_OVERSCAN_X,
            flameHeight * 0.58 * FLAME_CORE_BILLBOARD_OVERSCAN_Y,
            flameWidth * 0.62 * FLAME_CORE_BILLBOARD_OVERSCAN_X
          );
          fireBillboard.updateMatrix();
          fireCoreMesh.setMatrixAt(fireCount, fireBillboard.matrix);
          const flameEnergy = clamp(flameIntensity * 0.7 + intensity * 0.55 + heat * 0.38 + (isHero ? 0.12 : 0), 0, 1.4);
          const crossNoise = hash1(idx * 0.913 + flamelet * 3.77 + 59.1);
          const roleCrossGate = tileRole === 2 ? 0.42 : tileRole === 1 ? 0.9 : 1;
          const crossProbability = clamp(
            (flameEnergy - 0.34) * (0.32 + crossSliceBudget01 * 0.92) * (0.4 + heroCrossDensity * 0.6) * roleCrossGate,
            0,
            1
          );
          const useCrossSlice =
            crossSliceBudget01 > 0.06 &&
            tileCrossSlices < perTileCrossCap &&
            fireCrossCount < FIRE_CROSS_MAX_INSTANCES &&
            crossNoise < crossProbability &&
            (tileRole !== 2 || flameEnergy > 0.94) &&
            (isHero || flameEnergy > 0.76);
          if (useCrossSlice) {
            fireCrossBillboard.position.set(flameWorldX, flameY, flameWorldZ);
            fireCrossBillboard.rotation.set(0, sliceYawC, 0);
            fireCrossBillboard.scale.set(
              flameWidth * 0.92 * FLAME_BILLBOARD_OVERSCAN_X,
              flameHeight * 0.96 * FLAME_BILLBOARD_OVERSCAN_Y,
              flameWidth * 0.92 * FLAME_BILLBOARD_OVERSCAN_X
            );
            fireCrossBillboard.updateMatrix();
            fireCrossMesh.setMatrixAt(fireCrossCount, fireCrossBillboard.matrix);
            fireCrossIntensityAttr.setX(fireCrossCount, flickerIntensity * clamp(0.88 + flameEnergy * 0.16, 0.88, 1.08));
            fireCrossSeedAttr.setX(fireCrossCount, fract(tileSeed + s3 + flamelet * 0.19 + 0.37));
            fireCrossBaseCurveAttr.setX(fireCrossCount, crownCurve);
            fireCrossClusterBlendAttr.setX(fireCrossCount, clusterBlend);
            fireCrossSmokeOccAttr.setX(fireCrossCount, tileSmokeOcclusion01[idx] ?? 0);
            fireCrossRoleAttr.setX(fireCrossCount, tileRole);
            fireCrossCount += 1;
            tileCrossSlices += 1;
          }
          fireCount += 1;
          if (isHero && useTipStreaks && sparkActive) {
            const flameScale = clamp(flameHeight / Math.max(tileSpan * 0.55, 0.001), 0.7, 2.8);
            const streakCount = clamp(
              Math.round(
                (1 + intensity * 2.2 + windStrength * 1.7 + Math.max(0, flameScale - 1) * 1.3) *
                  (0.45 + sparkVisual01 * 0.9) *
                  (0.72 + sparkFrontFactor * 0.18)
              ),
              1,
              6
            );
            heroTipSparkAttempts += streakCount;
            for (let streak = 0; streak < streakCount; streak += 1) {
              if (sparkStreakCount >= sparkStreakCap) {
                droppedByInstanceCap += streakCount - streak;
                break;
              }
              const streakSeed = fract(s1 * 0.43 + s2 * 0.71 + streak * 0.37);
              const tipPulse = 0.6 + 0.4 * Math.sin(sparkTimeSeconds * (2.4 + streakSeed * 0.9) + streakSeed * TAU);
              const tipAge = fract(sparkTimeSeconds * (0.92 + streakSeed * 0.45) + streakSeed * 4.7 + streak * 0.23);
              const tipFade =
                smoothstep(0.02, 0.18, tipAge) *
                (1 - smoothstep(0.58, 1.0, tipAge)) *
                (0.72 + sparkVisual01 * 0.5);
              const tipLift = flameHeight * (0.56 + tipAge * 1.28 + streakSeed * 0.2 + streak * 0.015);
              const tipDrift =
                sampleFootprint *
                (0.1 + windStrength * 0.34) *
                (0.48 + streakSeed * 0.26 + tipAge * 1.12) *
                sparkFrontFactor *
                (0.62 + sparkWindFactor * 0.38);
              const laneSpin = sparkTimeSeconds * (0.42 + streakSeed * 0.32) + tipAge * (1.35 + intensity * 0.95);
              const laneAngle = streakSeed * TAU + s2 * TAU * 0.5 + streak * 0.57 + laneSpin;
              const laneSpread =
                sampleFootprint *
                (0.03 + intensity * 0.08 + (1 - clamp(windStrength, 0, 1)) * 0.05) *
                (0.46 + flameScale * 0.2);
              const laneRadius = laneSpread * (0.12 + 0.56 * tipAge);
              const laneX = Math.cos(laneAngle) * laneRadius;
              const laneZ = Math.sin(laneAngle) * laneRadius;
              const jitterPhase = sparkTimeSeconds * (2.8 + streakSeed * 1.7) + streak * 1.9 + s3 * TAU + tipAge * 7.6;
              const jitterAmp = sampleFootprint * (0.008 + 0.022 * tipAge + 0.01 * flameScale);
              const jitterX = Math.sin(jitterPhase) * jitterAmp + Math.cos(jitterPhase * 0.63 + laneAngle) * jitterAmp * 0.55;
              const jitterZ =
                Math.cos(jitterPhase * 1.13) * jitterAmp + Math.sin(jitterPhase * 0.71 + laneAngle) * jitterAmp * 0.48;
              const sideDrift =
                (tipAge - 0.5) * sampleFootprint * (0.05 + intensity * 0.12 + (1 - clamp(windStrength, 0, 1)) * 0.08);
              const tipDownwind =
                sampleFootprint * (0.08 + windStrength * 0.34 + tipAge * (0.16 + intensity * 0.12)) * sparkWindFactor;
              const tipCrossScatter =
                sampleFootprint * (0.014 + (1 - clamp(windStrength, 0, 1)) * 0.028 + streakSeed * 0.016);
              const tipX = clamp(
                flameWorldX +
                  laneX * 0.45 +
                  jitterX * 0.6 +
                  windX * (tipDrift + tipDownwind) +
                  crossWindX * ((streakSeed - 0.5) * tipCrossScatter + sideDrift * 0.42),
                terrainMinX,
                terrainMaxX
              );
              const tipZ = clamp(
                flameWorldZ +
                  laneZ * 0.45 +
                  jitterZ * 0.6 +
                  windZ * (tipDrift + tipDownwind) +
                  crossWindZ * ((s3 - 0.5) * tipCrossScatter + sideDrift * 0.38),
                terrainMinZ,
                terrainMaxZ
              );
              const tipY = flameY + tipLift + Math.sin(jitterPhase * 0.52 + streakSeed * TAU) * sampleFootprint * 0.02;
              const tipDistance = sparkSizeScratch.set(tipX, tipY, tipZ).distanceTo(cameraWorldPos);
              const minPixelWidth = worldUnitsForPixels(
                camera,
                tipDistance,
                sparkDebug ? 8 : 2,
                viewportHeightPx
              );
              const minPixelHeight = worldUnitsForPixels(
                camera,
                tipDistance,
                sparkDebug ? 18 : 6,
                viewportHeightPx
              );
              const streakWidth = Math.max(
                sparkDebug ? tileSpan * 0.16 : tileSpan * 0.055,
                sparkFootprint * (0.042 + intensity * 0.06 + streakSeed * 0.022),
                minPixelWidth
              );
              const streakHeight = Math.max(
                sparkDebug ? tileSpan * 0.42 : tileSpan * 0.2,
                sparkFootprint * (0.44 + intensity * 0.82 + tipPulse * 0.24 + windStrength * 0.22 + streakSeed * 0.1),
                flameHeight * (0.28 + tipPulse * 0.22 + windStrength * 0.16 + streakSeed * 0.08),
                minPixelHeight
              );
              const streakDirX =
                windX * sparkWindFactor * (0.7 + tipAge * 1.55 + windStrength * 1.2) +
                jetTangentX * (0.05 + tipAge * 0.07) +
                crossWindX * ((streakSeed - 0.5) * 0.14);
              const streakDirY = 0.9 + tipAge * 1.45 + intensity * 0.32;
              const streakDirZ =
                windZ * sparkWindFactor * (0.7 + tipAge * 1.55 + windStrength * 1.2) +
                jetTangentZ * (0.05 + tipAge * 0.07) +
                crossWindZ * ((s3 - 0.5) * 0.14);
              setSparkStreakTransform(tipX, tipY, tipZ, streakWidth, streakHeight, streakDirX, streakDirY, streakDirZ);
              sparkStreakMesh.setMatrixAt(sparkStreakCount, sparkStreakBillboard.matrix);
              if (sparkDebug) {
                const debugPhase = streak % 3;
                if (debugPhase === 0) {
                  sparkStreakMesh.instanceColor?.setXYZ(sparkStreakCount, 3.0, 1.2, 0.1);
                  pushSparkPoint(tipX, tipY + streakHeight * (0.14 + tipAge * 0.22), tipZ, 3.0 * tipFade, 1.2 * tipFade, 0.1 * tipFade);
                } else if (debugPhase === 1) {
                  sparkStreakMesh.instanceColor?.setXYZ(sparkStreakCount, 2.8, 2.2, 0.35);
                  pushSparkPoint(tipX, tipY + streakHeight * (0.14 + tipAge * 0.22), tipZ, 2.8 * tipFade, 2.2 * tipFade, 0.35 * tipFade);
                } else {
                  sparkStreakMesh.instanceColor?.setXYZ(sparkStreakCount, 3.2, 3.0, 1.1);
                  pushSparkPoint(tipX, tipY + streakHeight * (0.14 + tipAge * 0.22), tipZ, 3.2 * tipFade, 3.0 * tipFade, 1.1 * tipFade);
                }
              } else {
                const streakBright = clamp((0.95 + intensity * 1.1 + tipPulse * 0.35) * emberBoost * tipFade, 0, 2.3);
                sparkStreakMesh.instanceColor?.setXYZ(
                  sparkStreakCount,
                  streakBright,
                  clamp(streakBright * 0.74, 0, 2.0),
                  clamp(streakBright * 0.16, 0, 0.7)
                );
                const dotBright = clamp((1.25 + intensity * 1.35 + tipPulse * 0.5) * emberBoost * tipFade, 0, 2.9);
                const dotR = dotBright;
                const dotG = clamp(dotBright * 0.72, 0, 2.4);
                const dotB = clamp(dotBright * 0.12, 0, 0.8);
                const primaryDotY = tipY + streakHeight * (0.14 + tipAge * 0.22);
                pushSparkPoint(
                  tipX,
                  primaryDotY,
                  tipZ,
                  dotR,
                  dotG,
                  dotB
                );
                if (sparkVisual01 > 0.58 && streakSeed > 0.42) {
                  const trailFade = smoothstep(0.06, 0.3, tipAge) * (0.45 + sparkVisual01 * 0.3);
                  pushSparkPoint(
                    tipX + windX * streakWidth * 0.42,
                    primaryDotY - streakHeight * 0.08,
                    tipZ + windZ * streakWidth * 0.42,
                    dotR * 0.46 * trailFade,
                    dotG * 0.46 * trailFade,
                    dotB * 0.46 * trailFade
                  );
                }
              }
              sparkStreakCount += 1;
              heroTipSparkEmitted += 1;
              tileTipSparkEmitted += 1;
            }
          }
        }
        }
        if (hasObjectAnchorFlame && hasFlame && objectFlameDrive > 0.08) {
          const objectFlameCount = Math.min(
            flameProfile !== null ? 2 : 1,
            Math.max(1, Math.round((0.5 + objectFlameDrive * 0.75) * sliceComplexityScale))
          );
          const objectRadius = flameProfile !== null
            ? Math.max(tileSpan * 0.08, crownRadius * 0.22)
            : tileSpan * (typeId === TILE_TYPE_IDS.base ? 0.18 : 0.14);
          const objectRole = 0;
          for (let objectFlame = 0; objectFlame < objectFlameCount && fireCount < FIRE_MAX_INSTANCES; objectFlame += 1) {
            const o1 = hash1(idx * 0.613 + objectFlame * 7.17 + 3.9);
            const o2 = hash1(idx * 1.231 + objectFlame * 5.71 + 13.3);
            const o3 = hash1(idx * 0.887 + objectFlame * 9.41 + 29.7);
            const objectPhase = flameTimeSeconds * (0.72 + o2 * 0.8) + o3 * TAU;
            const objectPulse = 0.8 + 0.2 * Math.sin(objectPhase);
            const objectHeightBase =
              tileSpan *
              (flameProfile !== null ? 0.18 + objectFlameDrive * 0.22 : 0.13 + objectFlameDrive * 0.18) *
              (0.82 + o2 * 0.22) *
              flameHeightBoost *
              objectPulse;
            const objectWidthBase = Math.max(
              objectRadius * 0.44,
              objectHeightBase * (flameProfile !== null ? 0.4 + o1 * 0.12 : 0.5 + o1 * 0.12) * flameWidthBoost
            );
            const objectHeight =
              Math.max(
                tileSpan *
                  (flameProfile !== null ? OBJECT_FLAME_MIN_HEIGHT_TILES * 1.08 : OBJECT_FLAME_MIN_HEIGHT_TILES),
                objectHeightBase * FLAME_RENDER_SIZE_SCALE
              ) * objectFlameScale01;
            const objectWidth =
              Math.max(
                tileSpan *
                  (flameProfile !== null ? OBJECT_FLAME_MIN_WIDTH_TILES * 1.08 : OBJECT_FLAME_MIN_WIDTH_TILES),
                objectWidthBase * FLAME_RENDER_SIZE_SCALE
              ) * objectFlameScale01;
            const objectOffsetAngle = o1 * TAU + Math.sin(objectPhase * 0.46) * 0.4;
            const objectOffsetRadius = objectRadius * (flameProfile !== null ? 0.52 : 0.28) * Math.sqrt(o2);
            const objectWorldX = clamp(
              objectSourceX + Math.cos(objectOffsetAngle) * objectOffsetRadius + windX * objectRadius * 0.08,
              terrainMinX,
              terrainMaxX
            );
            const objectWorldZ = clamp(
              objectSourceZ + Math.sin(objectOffsetAngle) * objectOffsetRadius + windZ * objectRadius * 0.08,
              terrainMinZ,
              terrainMaxZ
            );
            const objectYaw = Math.atan2(cameraWorldPos.x - objectWorldX, cameraWorldPos.z - objectWorldZ);
            const objectSliceYaw = objectYaw + Math.sin(objectPhase * 0.7 + o1 * TAU) * 0.08;
            fireBillboard.position.set(objectWorldX, objectSourceY + objectHeight * 0.42, objectWorldZ);
            fireBillboard.rotation.set(0, objectSliceYaw, 0);
            fireBillboard.scale.set(
              objectWidth * FLAME_BILLBOARD_OVERSCAN_X,
              objectHeight * FLAME_BILLBOARD_OVERSCAN_Y,
              objectWidth * FLAME_BILLBOARD_OVERSCAN_X
            );
            fireBillboard.updateMatrix();
            fireMesh.setMatrixAt(fireCount, fireBillboard.matrix);
            fireIntensityAttr.setX(
              fireCount,
              clamp(
                (flameProfile !== null ? 0.22 : 0.18) +
                  objectFlameDrive * 0.52 +
                  treeBurnVisual * 0.12 +
                  heat * 0.08,
                0,
                1
              )
            );
            fireSeedAttr.setX(fireCount, fract(tileSeed + o3 + objectFlame * 0.23));
            fireBaseCurveAttr.setX(fireCount, flameProfile !== null ? 0.38 : 0.12);
            fireClusterBlendAttr.setX(fireCount, Math.min(clusterBlend, 0.16));
            fireSmokeOccAttr.setX(fireCount, tileSmokeOcclusion01[idx] ?? 0);
            fireRoleAttr.setX(fireCount, objectRole);
            fireBillboard.rotation.set(0, objectSliceYaw + Math.PI * 0.5, 0);
            fireBillboard.scale.set(
              objectWidth * 0.62 * FLAME_CORE_BILLBOARD_OVERSCAN_X,
              objectHeight * 0.58 * FLAME_CORE_BILLBOARD_OVERSCAN_Y,
              objectWidth * 0.62 * FLAME_CORE_BILLBOARD_OVERSCAN_X
            );
            fireBillboard.updateMatrix();
            fireCoreMesh.setMatrixAt(fireCount, fireBillboard.matrix);
            if (topView01 > 0.32 && fireCrossCount < FIRE_CROSS_MAX_INSTANCES && o3 > 0.28 && objectFlameDrive > 0.32) {
              fireCrossBillboard.position.set(objectWorldX, objectSourceY + objectHeight * 0.42, objectWorldZ);
              fireCrossBillboard.rotation.set(0, objectSliceYaw + Math.PI * 0.26, 0);
              fireCrossBillboard.scale.set(
                objectWidth * 0.84 * FLAME_BILLBOARD_OVERSCAN_X,
                objectHeight * 0.88 * FLAME_BILLBOARD_OVERSCAN_Y,
                objectWidth * 0.84 * FLAME_BILLBOARD_OVERSCAN_X
              );
              fireCrossBillboard.updateMatrix();
              fireCrossMesh.setMatrixAt(fireCrossCount, fireCrossBillboard.matrix);
              fireCrossIntensityAttr.setX(fireCrossCount, clamp(0.52 + flameIntensity * 0.34 + heat * 0.1, 0, 1));
              fireCrossSeedAttr.setX(fireCrossCount, fract(tileSeed + o2 + objectFlame * 0.31));
              fireCrossBaseCurveAttr.setX(fireCrossCount, flameProfile !== null ? 0.34 : 0.1);
              fireCrossClusterBlendAttr.setX(fireCrossCount, Math.min(clusterBlend, 0.16));
              fireCrossSmokeOccAttr.setX(fireCrossCount, tileSmokeOcclusion01[idx] ?? 0);
              fireCrossRoleAttr.setX(fireCrossCount, objectRole);
              fireCrossCount += 1;
            }
            fireCount += 1;
          }
        }
        if (useTipStreaks && sparkActive && tileTipSparkEmitted === 0 && sparkVisual01 > 0.26) {
          heroTipSparkAttempts += 1;
          if (sparkStreakCount < sparkStreakCap) {
            const fallbackSeed = hash1(idx * 0.777 + 71.3);
            const fallbackPulse =
              0.68 + 0.32 * Math.sin(sparkTimeSeconds * (2.1 + fallbackSeed * 0.9) + fallbackSeed * TAU);
            const fallbackGate = clamp(
              fallbackPulse * (sparkVisual01 * 0.82 + windStrength * 0.18 + sparkFrontFactor * 0.12),
              0,
              1
            );
            if (fallbackGate > 0.48) {
              const fallbackAge = fract(sparkTimeSeconds * (0.85 + fallbackSeed * 0.35) + fallbackSeed * 2.6);
              const fallbackFade =
                smoothstep(0.02, 0.18, fallbackAge) *
                (1 - smoothstep(0.58, 1.0, fallbackAge)) *
                (0.72 + sparkVisual01 * 0.45);
              const fallbackYBase = sourceYBase + sampleFootprint * (0.62 + flameIntensity * 0.85 + fallbackAge * 0.75);
              const fallbackLaneSpin = sparkTimeSeconds * (0.38 + fallbackSeed * 0.28) + fallbackAge * 1.2;
              const fallbackLaneAngle = fallbackSeed * TAU + hash1(idx * 0.183 + 11.2) * TAU * 0.35 + fallbackLaneSpin;
              const fallbackLaneRadius =
                sampleFootprint *
                (0.03 + flameIntensity * 0.07 + (1 - clamp(windStrength, 0, 1)) * 0.03) *
                (0.16 + fallbackAge * 0.52);
              const fallbackLaneX = Math.cos(fallbackLaneAngle) * fallbackLaneRadius;
              const fallbackLaneZ = Math.sin(fallbackLaneAngle) * fallbackLaneRadius;
              const fallbackJitterPhase = sparkTimeSeconds * (2.9 + fallbackSeed * 1.9) + fallbackSeed * 6.1 + fallbackAge * 6.8;
              const fallbackJitterAmp = sampleFootprint * (0.008 + fallbackAge * 0.02);
              const fallbackJitterX =
                Math.sin(fallbackJitterPhase) * fallbackJitterAmp + Math.cos(fallbackJitterPhase * 0.66) * fallbackJitterAmp * 0.52;
              const fallbackJitterZ =
                Math.cos(fallbackJitterPhase * 1.2) * fallbackJitterAmp + Math.sin(fallbackJitterPhase * 0.8) * fallbackJitterAmp * 0.46;
              const fallbackSideDrift =
                (fallbackAge - 0.5) * sampleFootprint * (0.04 + flameIntensity * 0.12 + (1 - clamp(windStrength, 0, 1)) * 0.06);
              const fallbackDownwind = sampleFootprint * (0.1 + windStrength * 0.3 + fallbackAge * 0.22) * sparkWindFactor;
              const fallbackX = clamp(
                jetClusterX +
                  fallbackLaneX * 0.42 +
                  fallbackJitterX * 0.55 +
                  windX * fallbackDownwind +
                  crossWindX * ((fallbackSeed - 0.5) * sampleFootprint * 0.08 + fallbackSideDrift),
                terrainMinX,
                terrainMaxX
              );
              const fallbackZ = clamp(
                jetClusterZ +
                  fallbackLaneZ * 0.42 +
                  fallbackJitterZ * 0.55 +
                  windZ * fallbackDownwind +
                  crossWindZ * ((fallbackSeed - 0.5) * sampleFootprint * 0.08 + fallbackSideDrift * 0.85),
                terrainMinZ,
                terrainMaxZ
              );
              const fallbackY = fallbackYBase + Math.sin(fallbackJitterPhase * 0.38) * sampleFootprint * 0.02;
              const fallbackDistance = sparkSizeScratch.set(fallbackX, fallbackY, fallbackZ).distanceTo(cameraWorldPos);
              const fallbackPixelWidth = worldUnitsForPixels(
                camera,
                fallbackDistance,
                sparkDebug ? 7 : 1.8,
                viewportHeightPx
              );
              const fallbackPixelHeight = worldUnitsForPixels(
                camera,
                fallbackDistance,
                sparkDebug ? 15 : 5,
                viewportHeightPx
              );
              const fallbackWidth = Math.max(
                sparkDebug ? tileSpan * 0.14 : tileSpan * 0.05,
                sparkFootprint * (0.04 + flameIntensity * 0.05),
                fallbackPixelWidth
              );
              const fallbackHeight = Math.max(
                sparkDebug ? tileSpan * 0.35 : tileSpan * 0.18,
                sparkFootprint * (0.34 + flameIntensity * 0.5 + fallbackPulse * 0.18 + windStrength * 0.18),
                fallbackPixelHeight
              );
              const fallbackDirX =
                windX * sparkWindFactor * (0.78 + fallbackAge * 1.6 + windStrength * 1.15) +
                crossWindX * ((fallbackSeed - 0.5) * 0.12);
              const fallbackDirY = 0.92 + fallbackAge * 1.2 + flameIntensity * 0.24;
              const fallbackDirZ =
                windZ * sparkWindFactor * (0.78 + fallbackAge * 1.6 + windStrength * 1.15) +
                crossWindZ * ((fallbackSeed - 0.5) * 0.12);
              setSparkStreakTransform(
                fallbackX,
                fallbackY,
                fallbackZ,
                fallbackWidth,
                fallbackHeight,
                fallbackDirX,
                fallbackDirY,
                fallbackDirZ
              );
              sparkStreakMesh.setMatrixAt(sparkStreakCount, sparkStreakBillboard.matrix);
              if (sparkDebug) {
                sparkStreakMesh.instanceColor?.setXYZ(sparkStreakCount, 3.0, 1.3, 0.14);
                pushSparkPoint(
                  fallbackX,
                  fallbackY + fallbackHeight * (0.1 + fallbackAge * 0.16),
                  fallbackZ,
                  3.0 * fallbackFade,
                  1.3 * fallbackFade,
                  0.14 * fallbackFade
                );
              } else {
                const fallbackBright = clamp(
                  (1.05 + flameIntensity * 1.15 + fallbackPulse * 0.4) * emberBoost * fallbackFade,
                  0,
                  2.3
                );
                sparkStreakMesh.instanceColor?.setXYZ(
                  sparkStreakCount,
                  fallbackBright,
                  clamp(fallbackBright * 0.72, 0, 1.85),
                  clamp(fallbackBright * 0.14, 0, 0.55)
                );
                const fallbackDotBright = clamp(
                  (1.18 + flameIntensity * 1.3 + fallbackPulse * 0.35) * emberBoost * fallbackFade,
                  0,
                  2.7
                );
                const fallbackDotR = fallbackDotBright;
                const fallbackDotG = clamp(fallbackDotBright * 0.7, 0, 1.95);
                const fallbackDotB = clamp(fallbackDotBright * 0.12, 0, 0.65);
                const fallbackDotY = fallbackY + fallbackHeight * (0.1 + fallbackAge * 0.16);
                pushSparkPoint(
                  fallbackX,
                  fallbackDotY,
                  fallbackZ,
                  fallbackDotR,
                  fallbackDotG,
                  fallbackDotB
                );
                if (sparkVisual01 > 0.62) {
                  pushSparkPoint(
                    fallbackX + windX * fallbackWidth * 0.34,
                    fallbackDotY - fallbackHeight * 0.08,
                    fallbackZ + windZ * fallbackWidth * 0.34,
                    fallbackDotR * 0.42,
                    fallbackDotG * 0.42,
                    fallbackDotB * 0.42
                  );
                }
              }
              sparkStreakCount += 1;
              heroTipSparkEmitted += 1;
              tileTipSparkEmitted = 1;
            }
          } else {
            droppedByInstanceCap += 1;
          }
        }
        const groundFlameDrive = hasActiveFire
          ? clamp(
              (intensity * 0.78 + heat * 0.5 + clusterBias * 0.45 + slowFlicker * 0.15 - 0.1) * ignitionRampStrength,
              0,
              1.2
            )
          : 0;
        const groundCountRaw =
          FIRE_VISUAL_TUNING.groundFlameSpawnMin +
          (FIRE_VISUAL_TUNING.groundFlameSpawnMax - FIRE_VISUAL_TUNING.groundFlameSpawnMin) * clamp(groundFlameDrive, 0, 1);
        let groundFlameCount = Math.round(groundCountRaw * groundDensityScale);
        if (groundFlameDrive < 0.2 && slowFlicker < 0.35) {
          groundFlameCount = Math.max(0, groundFlameCount - 2);
        }
        const groundDetailScale = clamp(
          (frontPassActive ? 0.08 : 0.26) + (1 - clamp(frontRead01, 0, 1)) * 0.42 + (flameProfile !== null ? 0.08 : 0),
          0.06,
          frontPassActive ? 0.58 : 0.82
        );
        groundFlameCount = Math.round(groundFlameCount * groundDetailScale);
        groundFlameCount = Math.min(groundFlameCount, perTileGroundCap);
        const sustainGroundFlame =
          hasActiveFire &&
          fire > 0.22 &&
          heat > 0.24 &&
          smoothedFlame > Math.max(flamePresenceEps * 1.1, 0.1);
        if (sustainGroundFlame && groundFlameCount <= 0) {
          groundFlameCount = 1;
        }
        for (let groundFlame = 0; groundFlame < groundFlameCount && fireCount < FIRE_MAX_INSTANCES; groundFlame += 1) {
          const g1 = hash1(idx * 1.621 + groundFlame * 7.11 + 13.7);
          const g2 = hash1(idx * 0.743 + groundFlame * 9.31 + 23.1);
          const g3 = hash1(idx * 1.177 + groundFlame * 5.93 + 31.9);
          const gRate =
            FIRE_VISUAL_TUNING.flickerRateMin +
            g2 * (FIRE_VISUAL_TUNING.flickerRateMax - FIRE_VISUAL_TUNING.flickerRateMin);
          const gPhase = fract(flameTimeSeconds * gRate + g3 * 7.1);
          const gFlicker = 0.72 + 0.28 * Math.sin(gPhase * TAU + g1 * TAU);
          const gRadius = tileSpan * (0.16 + groundFlameDrive * 0.26);
          const gTheta = g1 * TAU;
          const gOffsetR = Math.sqrt(g2) * gRadius;
          const gX = Math.cos(gTheta) * gOffsetR;
          const gZ = Math.sin(gTheta) * gOffsetR;
          const gHeightBase =
            tileSpan *
            (0.08 + groundFlameDrive * 0.22) *
            (0.74 + gFlicker * 0.45) *
            (0.85 + g3 * 0.4) *
            flameHeightBoost *
            roleHeightScale;
          const gWidthBase = Math.max(tileSpan * 0.06, gHeightBase * (0.56 + g2 * 0.26) * flameWidthBoost * roleWidthScale);
          const gHeight =
            Math.max(tileSpan * GROUND_FLAME_MIN_HEIGHT_TILES, gHeightBase * FLAME_RENDER_SIZE_SCALE) * flameSize01;
          const gWidth =
            Math.max(tileSpan * GROUND_FLAME_MIN_WIDTH_TILES, gWidthBase * FLAME_RENDER_SIZE_SCALE) * flameSize01;
          const gWindLean = tileSpan * windResponse.flame * (0.015 + groundFlameDrive * 0.05 + windStrength * 0.03);
          const groundWorldX = clamp(jetClusterX + gX + windX * gWindLean, terrainMinX, terrainMaxX);
          const groundWorldZ = clamp(jetClusterZ + gZ + windZ * gWindLean, terrainMinZ, terrainMaxZ);
          const groundYaw = Math.atan2(cameraWorldPos.x - groundWorldX, cameraWorldPos.z - groundWorldZ);
          fireBillboard.position.set(groundWorldX, baseY + gHeight * 0.42, groundWorldZ);
          fireBillboard.rotation.set(0, groundYaw, 0);
          fireBillboard.scale.set(
            gWidth * FLAME_BILLBOARD_OVERSCAN_X,
            gHeight * FLAME_BILLBOARD_OVERSCAN_Y,
            gWidth * FLAME_BILLBOARD_OVERSCAN_X
          );
          fireBillboard.updateMatrix();
          fireMesh.setMatrixAt(fireCount, fireBillboard.matrix);
          const groundIntensity = clamp(groundFlameDrive * (0.38 + 0.38 * gFlicker), 0, 1);
          fireIntensityAttr.setX(fireCount, groundIntensity);
          fireSeedAttr.setX(fireCount, fract(tileSeed * 0.71 + g3 + groundFlame * 0.11));
          fireBaseCurveAttr.setX(fireCount, 0);
          fireClusterBlendAttr.setX(fireCount, clusterBlend);
          fireSmokeOccAttr.setX(fireCount, tileSmokeOcclusion01[idx] ?? 0);
          fireRoleAttr.setX(fireCount, tileRole);
          fireBillboard.scale.set(
            gWidth * 0.66 * FLAME_CORE_BILLBOARD_OVERSCAN_X,
            gHeight * 0.52 * FLAME_CORE_BILLBOARD_OVERSCAN_Y,
            gWidth * 0.66 * FLAME_CORE_BILLBOARD_OVERSCAN_X
          );
          fireBillboard.updateMatrix();
          fireCoreMesh.setMatrixAt(fireCount, fireBillboard.matrix);
          fireCount += 1;
        }
        if (hasActiveFire && glowCount < GLOW_MAX_INSTANCES) {
          const glowDrive = clamp(
            (flameIntensity * 0.46 + intensity * 0.7 + heat * 0.4 + Math.max(0, clusterBias) * 0.38 + slowFlicker * 0.22) *
              ignitionRampStrength,
            0,
            1.2
          );
          const glowBaseInstances = glowDrive > 0.8 ? 4 : glowDrive > 0.46 ? 3 : glowDrive > 0.2 ? 2 : 1;
          const glowPerTileMax = envOrange > 0.75 ? 5 : 4;
          const frontGlowScale = clamp(0.22 + frontDominance * 0.86, 0.16, 1);
          const glowInstances = Math.max(
            glowDrive > 0.08 ? 1 : 0,
            Math.min(
              glowPerTileMax,
              Math.round(glowBaseInstances * groundGlowCountBoost * ignitionRampStrength * frontGlowScale)
            )
          );
          for (let gi = 0; gi < glowInstances && glowCount < GLOW_MAX_INSTANCES; gi += 1) {
            const g1 = hash1(idx * 1.27 + gi * 7.37 + 0.9);
            const g2 = hash1(idx * 0.83 + gi * 11.1 + 4.3);
            const jitterR = sampleFootprint * (0.08 + glowDrive * 0.22) * Math.sqrt(g1);
            const jitterTheta = g2 * TAU;
            const jitterX = Math.cos(jitterTheta) * jitterR;
            const jitterZ = Math.sin(jitterTheta) * jitterR;
            const pulse = 0.78 + 0.22 * Math.sin(flameTimeSeconds * (0.72 + g1 * 0.9) + g2 * TAU);
            const glowSize =
              (0.58 + glowDrive * 1.02 + g1 * 0.24) *
              sampleFootprint *
              FIRE_VISUAL_TUNING.glowRadius *
              groundGlowSizeBoost *
              (1 + envOrange * 0.42);
            const glowWorldX = clamp(jetClusterX + jitterX, minTileX, maxTileX);
            const glowWorldZ = clamp(jetClusterZ + jitterZ, minTileZ, maxTileZ);
            groundGlowBillboard.position.set(glowWorldX, baseY + 0.05, glowWorldZ);
            groundGlowBillboard.quaternion.identity();
            groundGlowBillboard.scale.set(glowSize, glowSize, glowSize);
            groundGlowBillboard.updateMatrix();
            groundGlowMesh.setMatrixAt(glowCount, groundGlowBillboard.matrix);
            const glowBase = (0.24 + glowDrive * FIRE_VISUAL_TUNING.glowStrength * 1.15) * pulse * groundGlowBoost;
            const glow = clamp(glowBase * (1 + envOrange * 0.72), 0, 3.4);
            const glowR = glow * 1.12;
            const glowG = glow * (0.42 + g2 * 0.18 + envOrange * 0.14);
            const glowB = glow * (0.04 + g1 * 0.04) * (1 - envOrange * 0.45);
            groundGlowMesh.instanceColor?.setXYZ(glowCount, glowR, glowG, glowB);
            glowCount += 1;
          }
        }
        if (useFreeEmbers && sparkActive && emberCount < emberCap) {
          const sparkPulse = 0.84 + 0.16 * Math.sin(sparkTimeSeconds * (1.3 + tileSeed * 0.8) + tileSeed * TAU);
          const sparkDrive = Math.max(
            0,
            (sparkVisual01 * 2.6 +
              flameIntensity * 0.9 +
              intensity * 0.65 +
              heat * 0.48 +
              Math.max(0, clusterBias) * 0.26 +
              windStrength * 0.9 +
              frontRead01 * 0.55 +
              (hasActiveFire ? 0.22 : 0.08)) *
              ignitionRampStrength -
              0.44
          );
          const emberBurstCap = Math.max(4, Math.min(6, Math.round(4 + (emberBoost - 1) * 4)));
          const emberBursts = Math.max(
            0,
            Math.min(
              emberBurstCap,
              Math.floor(
                sparkDrive * FIRE_VISUAL_TUNING.sparkRate * sparkPulse * emberEjectBoost * freeEmberModeScale
              )
            )
          );
          freeEmberAttempts += emberBursts;
          for (let burst = 0; burst < emberBursts && emberCount < emberCap; burst += 1) {
            if (emberCount >= emberCap) {
              droppedByInstanceCap += emberBursts - burst;
              break;
            }
            const emberSeed = fract(tileSeed * (13.17 + burst * 5.31) + burst * 0.37);
            const lifeRate = 0.1 + emberSeed * 0.22;
            const life = Math.pow(fract(sparkTimeSeconds * lifeRate + emberSeed * 5.7), 1.45);
            const lifeT = Math.pow(life, 0.82);
            const sourceLift = sampleFootprint * (0.48 + flameIntensity * 0.95 + heat * 0.35);
            const riseHeightRaw =
              (0.45 + lifeT * lifeT * (1.65 + intensity * 4.4 + windStrength * 1.3)) *
              sampleFootprint *
              emberEjectBoost;
            const riseHeight = Math.min(
              riseHeightRaw,
              sampleFootprint *
                (sparkDebug ? 0.72 + intensity * 1.1 + windStrength * 0.35 : 1.25 + intensity * 2.4 + windStrength * 0.9)
            );
            const swirlPhase = sparkTimeSeconds * (1.7 + emberSeed * 1.1) + emberSeed * 35.0 + lifeT * 8.4;
            const swirl =
              (1.0 - lifeT * 0.82) *
              (0.12 + (1 - clamp(windStrength, 0, 1)) * 0.18) *
              sampleFootprint *
              (1 + (emberEjectBoost - 1) * 0.18);
            const outwardPhase = emberSeed * TAU + lifeT * (4.4 + intensity * 2.3);
            const outward = sampleFootprint * (0.015 + lifeT * (0.09 + intensity * 0.08));
            const outwardX = Math.cos(outwardPhase) * outward;
            const outwardZ = Math.sin(outwardPhase * 1.08 + emberSeed * 2.7) * outward;
            const lateralX =
              (Math.sin(swirlPhase) * swirl + outwardX + (emberSeed - 0.5) * 0.08 * sampleFootprint) *
              (0.5 + (1 - clamp(windStrength, 0, 1)) * 0.32);
            const lateralZ =
              (Math.cos(swirlPhase * 1.13) * swirl + outwardZ + (fract(emberSeed * 7.1) - 0.5) * 0.08 * sampleFootprint) *
              (0.5 + (1 - clamp(windStrength, 0, 1)) * 0.32);
            const downwind =
              windStrength *
              (0.86 + lifeT * (3.5 + intensity * 2.1)) *
              sampleFootprint *
              (1 + (emberEjectBoost - 1) * 0.28) *
              sparkWindFactor;
            const weave =
              Math.sin(swirlPhase * 0.71 + lifeT * 5.2) *
              sampleFootprint *
              (0.008 + lifeT * 0.045 + (1 - clamp(windStrength, 0, 1)) * 0.018);
            const crosswind =
              (fract(emberSeed * 11.9) - 0.5) *
              (0.12 + lifeT * 0.34 + (1 - clamp(windStrength, 0, 1)) * 0.12) *
              sampleFootprint *
              (1 + (emberEjectBoost - 1) * 0.15) +
              weave;
            const launchDownwind =
              sampleFootprint * (0.06 + windStrength * 0.24 + sparkVisual01 * 0.08 + frontRead01 * 0.06);
            emberBillboard.position.set(
              jetClusterX + lateralX + windX * (launchDownwind + downwind) + crossWindX * crosswind,
              sourceYBase + sourceLift + riseHeight,
              jetClusterZ + lateralZ + windZ * (launchDownwind + downwind) + crossWindZ * crosswind
            );
            const emberSize =
              (0.16 + (1 - lifeT) * 0.32 + intensity * 0.12 + windStrength * 0.06) *
              sampleFootprint *
              (1 + (emberBoost - 1) * 0.36);
            const emberDistance = sparkSizeScratch.copy(emberBillboard.position).distanceTo(cameraWorldPos);
            const emberPixelFloor = worldUnitsForPixels(
              camera,
              emberDistance,
              sparkDebug ? 12 : 5,
              viewportHeightPx
            );
            const emberSizeClamped = Math.max(
              sparkDebug ? Math.max(tileSpan * 0.2, sparkFootprint * 0.45) : Math.max(tileSpan * 0.12, sparkFootprint * 0.28),
              emberPixelFloor,
              emberSize
            );
            emberBillboard.scale.set(emberSizeClamped, emberSizeClamped * 1.3, emberSizeClamped);
            emberBillboard.quaternion.copy(camera.quaternion);
            emberBillboard.updateMatrix();
            emberMesh.setMatrixAt(emberCount, emberBillboard.matrix);
            if (sparkDebug) {
              const debugPhase = burst % 3;
              if (debugPhase === 0) {
                emberMesh.instanceColor?.setXYZ(emberCount, 3.0, 1.2, 0.1);
              } else if (debugPhase === 1) {
                emberMesh.instanceColor?.setXYZ(emberCount, 2.8, 2.2, 0.35);
              } else {
                emberMesh.instanceColor?.setXYZ(emberCount, 3.2, 3.0, 1.1);
              }
            } else {
              const emberAgeFade = 1 - smoothstep(0.82, 1.0, life);
              const emberHot = clamp((1 - life) * 1.05 + intensity * 0.62, 0, 1);
              const emberBright = clamp(
                (1.05 + emberHot * 1.35) * (0.92 + emberAgeFade * 0.95) * emberBoost,
                0,
                3.4
              );
              emberMesh.instanceColor?.setXYZ(
                emberCount,
                emberBright,
                clamp(emberBright * (0.62 + 0.5 * emberHot), 0, 2.8),
                clamp(emberBright * (0.1 + 0.24 * emberHot), 0, 1.9)
              );
            }
            emberCount += 1;
            freeEmberEmitted += 1;
          }
        }
        const smokeIntensity01 = clamp(smoothedSmoke, 0, 1);
        const smokeDrive = Math.max(smokeIntensity01, targetSmoke * 0.85);
        if (hasActiveFire && smokeDrive > 0.005 && smokeSpawnsThisFrame < smokeSpawnFrameCap) {
          const roleSmokeScale = tileRole === 2 ? 1.22 : tileRole === 1 ? 1.08 : 1;
          const fuelNow = fireView.getFuelByIndex(idx);
          const sootBase = clamp(
            0.16 + smokeDrive * 0.34 + (1 - fuelNow) * 0.3 + heat * 0.08 + clusterBlend * 0.12 * roleSmokeScale,
            0,
            1
          );
          const emissionRate =
            (0.18 + Math.pow(smokeDrive, 1.5) * 6.8 + heat * 0.55 + windStrength * 0.28) *
            (0.75 + sampleStep * 0.22) *
            roleSmokeScale *
            smokeDensityScale;
          let spawnCarry = (tileSmokeSpawnAccum[idx] ?? 0) + emissionRate * deltaSeconds;
          const spawnCount = Math.min(9, Math.floor(spawnCarry));
          spawnCarry -= spawnCount;
          tileSmokeSpawnAccum[idx] = spawnCarry;
          const spawnLimit = Math.min(spawnCount, smokeSpawnFrameCap - smokeSpawnsThisFrame);
          const plumeRadius = sampleFootprint * (0.14 + smokeDrive * 0.58);
          const baseSize = tileSpan * (0.9 + smokeDrive * 1.28);
          for (let spawn = 0; spawn < spawnLimit; spawn += 1) {
            const nonce = smokeSpawnSequence++;
            const r1 = hash1(idx * 1.173 + nonce * 0.137 + timeSeconds * 0.19);
            const r2 = hash1(idx * 0.917 + nonce * 0.223 + 17.0);
            const r3 = hash1(idx * 1.411 + nonce * 0.311 + 41.0);
            const theta = r1 * TAU;
            const radial = Math.sqrt(r2) * plumeRadius;
            const offsetX = Math.cos(theta) * radial;
            const offsetZ = Math.sin(theta) * radial;
            const velAlongWind = windStrength * windResponse.smoke * tileSpan * (0.52 + smokeDrive * 1.6 + r3 * 0.8);
            const velCross = (r2 - 0.5) * tileSpan * (0.22 + smokeDrive * 0.55);
            const spawnDownwind = velAlongWind * (0.06 + smokeDrive * 0.02);
            const slot = smokeSpawnCursor;
            smokeSpawnCursor = (smokeSpawnCursor + 1) % SMOKE_MAX_INSTANCES;
            smokeParticleActive[slot] = 1;
            smokeParticleAge[slot] = 0;
            smokeParticleLife[slot] = 8.5 + smokeDrive * 11.5 + r1 * 3.8 + windStrength * 2.2;
            smokeParticleX[slot] = jetClusterX + offsetX + crossWindX * velCross * 0.22 + windX * spawnDownwind;
            smokeParticleY[slot] = sourceYBase + 0.18 + r3 * tileSpan * 0.34;
            smokeParticleZ[slot] = jetClusterZ + offsetZ + crossWindZ * velCross * 0.22 + windZ * spawnDownwind;
            smokeParticleVx[slot] = windX * velAlongWind + crossWindX * velCross;
            smokeParticleVy[slot] = tileSpan * (0.46 + smokeDrive * 0.95 + r3 * 0.36);
            smokeParticleVz[slot] = windZ * velAlongWind + crossWindZ * velCross;
            smokeParticleSeed[slot] = r3;
            smokeParticleIntensity[slot] = smokeDrive;
            smokeParticleSoot[slot] = clamp(sootBase + (r2 - 0.5) * 0.08, 0, 1);
            smokeParticleBaseSize[slot] = baseSize * (1.02 + r2 * 0.72);
            smokeParticleSourceX[slot] = jetClusterX;
            smokeParticleSourceY[slot] = sourceYBase + 0.12;
            smokeParticleSourceZ[slot] = jetClusterZ;
            smokeParticleSourceIdx[slot] = idx;
            smokeSpawnsThisFrame += 1;
          }
        }
      }
    }
    for (let i = 0; i < SMOKE_MAX_INSTANCES; i += 1) {
      if (smokeParticleActive[i] === 0) {
        continue;
      }
      const sourceIdx = smokeParticleSourceIdx[i];
      const sourceFire = sourceIdx >= 0 ? fireView.getFireByIndex(sourceIdx) : 0;
      const sourceHeat = sourceIdx >= 0 ? fireView.getHeat01ByIndex(sourceIdx) : 0;
      const sourceSmoke = sourceIdx >= 0 ? tileSmokeVisual[sourceIdx] ?? 0 : 0;
      if (sourceIdx < 0 || (sourceFire <= simFireEps && sourceHeat < 0.08 && sourceSmoke < 0.06)) {
        smokeParticleActive[i] = 0;
        smokeParticleSourceIdx[i] = -1;
        continue;
      }
      const lifeSeconds = Math.max(0.5, smokeParticleLife[i]);
      const age = smokeParticleAge[i] + deltaSeconds / lifeSeconds;
      if (age >= 1) {
        smokeParticleActive[i] = 0;
        smokeParticleSourceIdx[i] = -1;
        continue;
      }
      smokeParticleAge[i] = age;
      const seed = smokeParticleSeed[i];
      const intensity = smokeParticleIntensity[i];
      const age2 = age * age;
      const age3 = age2 * age;
      const sourceX = smokeParticleSourceX[i];
      const sourceZ = smokeParticleSourceZ[i];
      const downwindOffset = windStrength * windResponse.smoke * tileSpan * (age2 * (6.2 + intensity * 12.2) + age3 * 10.4);
      const centerX = sourceX + windX * downwindOffset;
      const centerZ = sourceZ + windZ * downwindOffset;
      const drag = Math.exp(-deltaSeconds * (0.08 + age * 0.14));
      const shear = 0.28 + age * 3.4 + windStrength * (0.8 + age * 2.2);
      smokeParticleVx[i] =
        smokeParticleVx[i] * drag +
        windX * windStrength * windResponse.smoke * tileSpan * deltaSeconds * 0.12 * shear;
      smokeParticleVz[i] =
        smokeParticleVz[i] * drag +
        windZ * windStrength * windResponse.smoke * tileSpan * deltaSeconds * 0.12 * shear;
      // Widen plume with age and wind: older smoke spreads into larger downwind lobes.
      const seedAngle = seed * TAU;
      const seedDirX = Math.cos(seedAngle);
      const seedDirZ = Math.sin(seedAngle);
      const spreadAge = Math.pow(age, 1.35);
      const baseSpread = tileSpan * spreadAge * (1.4 + intensity * 3.2);
      const windSpread = tileSpan * spreadAge * windStrength * windResponse.smoke * (4.8 + intensity * 3.4);
      const crossJitter = seed * 2 - 1;
      let spreadTargetX = centerX + seedDirX * (baseSpread + windSpread * 0.35) + crossWindX * (crossJitter * windSpread);
      let spreadTargetZ = centerZ + seedDirZ * (baseSpread + windSpread * 0.35) + crossWindZ * (crossJitter * windSpread);
      if (windDirLen > 0.0001) {
        const seedAlong = seedDirX * windNormX + seedDirZ * windNormZ;
        const seedCross = seedDirX * crossWindX + seedDirZ * crossWindZ;
        const alongSpread =
          windSpread * (0.44 + Math.max(0, seedAlong) * 0.82) -
          baseSpread * windResponse.smokeUpwind * Math.max(0, -seedAlong);
        const crossSpread =
          seedCross * (baseSpread * 0.9 + windSpread * 0.22) +
          crossJitter * windSpread * 0.38;
        spreadTargetX = centerX + windNormX * alongSpread + crossWindX * crossSpread;
        spreadTargetZ = centerZ + windNormZ * alongSpread + crossWindZ * crossSpread;
      }
      const cohesion = (1 - age) * (0.95 + intensity * 0.6) + 0.04;
      smokeParticleVx[i] += (spreadTargetX - smokeParticleX[i]) * cohesion * deltaSeconds;
      smokeParticleVz[i] += (spreadTargetZ - smokeParticleZ[i]) * cohesion * deltaSeconds;
      // Monotonic convection: avoid any downward spring pull that creates visible dip/rebound motion.
      smokeParticleVy[i] =
        smokeParticleVy[i] * (1 - deltaSeconds * (0.04 + age * 0.05)) +
        tileSpan * deltaSeconds * (0.22 + intensity * 0.16 + age * 0.2);
      const minRise = tileSpan * (0.06 + intensity * 0.04 + age * 0.06);
      if (smokeParticleVy[i] < minRise) {
        smokeParticleVy[i] = minRise;
      }
      const prevY = smokeParticleY[i];
      const swirlPhase = timeSeconds * (0.28 + seed * 0.62) + seed * 21.7 + age * 7.6;
      const swirlAmp = tileSpan * deltaSeconds * (0.008 + age * 0.024 + intensity * 0.012);
      smokeParticleX[i] += smokeParticleVx[i] * deltaSeconds + Math.sin(swirlPhase) * swirlAmp;
      smokeParticleY[i] += smokeParticleVy[i] * deltaSeconds;
      if (smokeParticleY[i] < prevY) {
        smokeParticleY[i] = prevY + tileSpan * deltaSeconds * 0.01;
      }
      smokeParticleZ[i] += smokeParticleVz[i] * deltaSeconds + Math.cos(swirlPhase * 1.17) * swirlAmp;
      const dx = smokeParticleX[i] - cameraWorldPos.x;
      const dy = smokeParticleY[i] - cameraWorldPos.y;
      const dz = smokeParticleZ[i] - cameraWorldPos.z;
      if (smokeCount >= smokeRenderCap) {
        continue;
      }
      if (smokeRenderStride > 1 && (i % smokeRenderStride) !== 0) {
        continue;
      }
      smokeRenderDepth[smokeCount] = dx * cameraForward.x + dy * cameraForward.y + dz * cameraForward.z;
      smokeRenderOrder[smokeCount] = i;
      smokeCount += 1;
    }
    sortSmokeParticlesByDepth(smokeRenderDepth, smokeRenderOrder, smokeCount);
    for (let draw = 0; draw < smokeCount; draw += 1) {
      const i = smokeRenderOrder[draw];
      const writeIndex = draw;
      const i3 = writeIndex * 3;
      smokeBuffers.positions[i3] = smokeParticleX[i];
      smokeBuffers.positions[i3 + 1] = smokeParticleY[i];
      smokeBuffers.positions[i3 + 2] = smokeParticleZ[i];
      smokeBuffers.aAge01[writeIndex] = smokeParticleAge[i];
      smokeBuffers.aSeed[writeIndex] = smokeParticleSeed[i];
      smokeBuffers.aIntensity[writeIndex] = smokeParticleIntensity[i];
      smokeBuffers.aSoot[writeIndex] = smokeParticleSoot[i];
      smokeBuffers.aSize[writeIndex] = smokeParticleBaseSize[i] * (1.2 + smokeParticleAge[i] * 3.35);
    }
    fireMesh.count = fireCount;
    fireCrossMesh.count = fireCrossCount;
    fireCoreMesh.count = fireCount;
    ashPreviewMesh.count = ashPreviewCount;
    groundGlowMesh.count = glowCount;
    smokeBuffers.geometry.setDrawRange(0, smokeCount);
    emberMesh.count = emberCount;
    sparkStreakMesh.count = sparkStreakCount;
    sparkPointGeometry.setDrawRange(0, sparkPointCount);
    sparkDebugSnapshot = {
      visibleFlameTiles,
      heroTipSparkAttempts,
      heroTipSparkEmitted,
      freeEmberAttempts,
      freeEmberEmitted,
      droppedByInstanceCap,
      finalSparkInstanceCount: sparkStreakCount + emberCount + sparkPointCount,
      clusterCount,
      clusteredTiles,
      clusterBedInstances,
      clusterPlumeSpawns,
      mode: debugControls.sparkMode
    };
    visualsCleared = false;
    fireMesh.instanceMatrix.needsUpdate = true;
    fireCrossMesh.instanceMatrix.needsUpdate = true;
    fireCoreMesh.instanceMatrix.needsUpdate = true;
    ashPreviewMesh.instanceMatrix.needsUpdate = true;
    groundGlowMesh.instanceMatrix.needsUpdate = true;
    emberMesh.instanceMatrix.needsUpdate = true;
    sparkStreakMesh.instanceMatrix.needsUpdate = true;
    smokeBuffers.positionAttr.needsUpdate = true;
    smokeBuffers.ageAttr.needsUpdate = true;
    smokeBuffers.seedAttr.needsUpdate = true;
    smokeBuffers.intensityAttr.needsUpdate = true;
    smokeBuffers.sootAttr.needsUpdate = true;
    smokeBuffers.sizeAttr.needsUpdate = true;
    fireIntensityAttr.needsUpdate = true;
    fireSeedAttr.needsUpdate = true;
    fireBaseCurveAttr.needsUpdate = true;
    fireClusterBlendAttr.needsUpdate = true;
    fireSmokeOccAttr.needsUpdate = true;
    fireRoleAttr.needsUpdate = true;
    fireCrossIntensityAttr.needsUpdate = true;
    fireCrossSeedAttr.needsUpdate = true;
    fireCrossBaseCurveAttr.needsUpdate = true;
    fireCrossClusterBlendAttr.needsUpdate = true;
    fireCrossSmokeOccAttr.needsUpdate = true;
    fireCrossRoleAttr.needsUpdate = true;
    ashPreviewProgressAttr.needsUpdate = true;
    ashPreviewSeedAttr.needsUpdate = true;
    if (groundGlowMesh.instanceColor) {
      groundGlowMesh.instanceColor.needsUpdate = true;
    }
    if (emberMesh.instanceColor) {
      emberMesh.instanceColor.needsUpdate = true;
    }
    if (sparkStreakMesh.instanceColor) {
      sparkStreakMesh.instanceColor.needsUpdate = true;
    }
    sparkPointPositionAttr.needsUpdate = true;
    sparkPointColorAttr.needsUpdate = true;
  };

  const dispose = (): void => {
    scene.remove(fireMesh);
    scene.remove(fireCrossMesh);
    scene.remove(fireCoreMesh);
    scene.remove(ashPreviewMesh);
    scene.remove(groundGlowMesh);
    scene.remove(smokePoints);
    scene.remove(emberMesh);
    scene.remove(sparkStreakMesh);
    scene.remove(sparkPoints);
    fireGeometry.dispose();
    fireCrossGeometry.dispose();
    fireCoreGeometry.dispose();
    ashPreviewGeometry.dispose();
    groundGlowGeometry.dispose();
    smokeBuffers.geometry.dispose();
    emberGeometry.dispose();
    sparkStreakGeometry.dispose();
    sparkPointGeometry.dispose();
    fireMaterial.dispose();
    fireCrossMaterial.dispose();
    fireCoreMaterial.dispose();
    ashPreviewMaterial.dispose();
    groundGlowMaterial.dispose();
    smokeMaterial.dispose();
    emberMaterial.dispose();
    sparkStreakMaterial.dispose();
    sparkDebugEmberMaterial.dispose();
    sparkDebugStreakMaterial.dispose();
    sparkPointMaterial.dispose();
    glowTexture.dispose();
    emberTexture.dispose();
    sparkStreakTexture.dispose();
  };

  const getSparkDebugSnapshot = (): SparkDebugSnapshot => ({ ...sparkDebugSnapshot });

  const setDebugControls = (controls: Partial<FireFxDebugControls>): void => {
    if (Object.keys(controls).length === 0) {
      return;
    }
    const next = normalizeFireFxDebugControls({ ...debugControls, ...controls });
    const sparkPresentationChanged = next.sparkDebug !== debugControls.sparkDebug;
    debugControls = next;
    if (sparkPresentationChanged) {
      applySparkDebugPresentation();
    }
  };

  const getDebugControls = (): FireFxDebugControls => ({ ...debugControls });

  return {
    captureSnapshot,
    setSimulationAlpha,
    update,
    setEnvironmentSignals,
    setDebugControls,
    getDebugControls,
    getSparkDebugSnapshot,
    dispose
  };
};
