import {
  FIRE_EMITTER_SLOT_VISIBLE_CUTOFF,
  FIRE_FRONT_CORRIDOR_MAX_SEGMENTS,
  FIRE_FRONT_SLOT_FALL_RATE,
  FIRE_FRONT_SLOT_RISE_RATE,
  FIRE_FRONT_SLOT_VISIBLE_CUTOFF,
  FIRE_GROUND_SLOT_FALL_RATE,
  FIRE_GROUND_SLOT_RISE_RATE,
  FIRE_LOCAL_SLOT_FALL_RATE,
  FIRE_LOCAL_SLOT_RISE_RATE,
  FIRE_OBJECT_SLOT_FALL_RATE,
  FIRE_OBJECT_SLOT_RISE_RATE,
  FIRE_VISUAL_TUNING
} from "../constants/fireRenderConstants.js";
import { clamp, smoothApproach } from "./fireRenderMath.js";
import type {
  FireCluster,
  FireRenderAnalysisState,
  FireRenderContinuityState,
  FrontCorridor,
  FrontCorridorSlotState
} from "./fireRenderPlanningTypes.js";

const createContinuityState = (): FireRenderContinuityState => ({
  smoothedFrontSegmentBudget: 0,
  smoothedPerTileFlameCap: FIRE_VISUAL_TUNING.tongueSpawnMax,
  smoothedPerTileGroundCap: FIRE_VISUAL_TUNING.groundFlameSpawnMax,
  localSlotChurn: 0,
  objectSlotChurn: 0,
  frontSlotChurn: 0,
  budgetClampedDrops: 0
});

export const createInitialFireRenderAnalysisState = (): FireRenderAnalysisState => ({
  tileStateCols: 0,
  tileStateRows: 0,
  tileFlameVisual: new Float32Array(0),
  tileIgnitionAgeSeconds: new Float32Array(0),
  tileSmokeVisual: new Float32Array(0),
  tileLocalFlameSlotActivation: new Float32Array(0),
  tileGroundFlameSlotActivation: new Float32Array(0),
  tileObjectFlameSlotActivation: new Float32Array(0),
  tileFrontPerimeter01: new Float32Array(0),
  tileFrontArrival01: new Float32Array(0),
  tileFrontAdvance01: new Float32Array(0),
  tileFrontDirX: new Float32Array(0),
  tileFrontDirZ: new Float32Array(0),
  tileActiveFlag: new Uint8Array(0),
  tileClusterId: new Int32Array(0),
  tileClusterRole: new Uint8Array(0),
  tileSmokeOcclusion01: new Float32Array(0),
  clusterQueue: new Int32Array(0),
  fireClusterPool: [],
  fireClusters: [],
  lastClusterRebuildMs: -Infinity,
  lastClusterActiveTileCount: 0,
  lastClusterSampleStep: 1,
  lastClusterMinX: -1,
  lastClusterMaxX: -1,
  lastClusterMinY: -1,
  lastClusterMaxY: -1,
  frontUpdateSerial: 0,
  frontEdgeStates: new Map(),
  frontCorridorSlotStates: new Map(),
  renderContinuityState: createContinuityState()
});

export const resetFireRenderContinuityState = (state: FireRenderAnalysisState): void => {
  state.renderContinuityState.localSlotChurn = 0;
  state.renderContinuityState.objectSlotChurn = 0;
  state.renderContinuityState.frontSlotChurn = 0;
  state.renderContinuityState.budgetClampedDrops = 0;
};

export const resetFireRenderAnalysisVisualState = (state: FireRenderAnalysisState): void => {
  state.frontEdgeStates.clear();
  state.frontCorridorSlotStates.clear();
  state.fireClusters.length = 0;
  state.fireClusterPool.length = 0;
  state.lastClusterRebuildMs = -Infinity;
  state.lastClusterActiveTileCount = 0;
  state.lastClusterSampleStep = 1;
  state.lastClusterMinX = -1;
  state.lastClusterMaxX = -1;
  state.lastClusterMinY = -1;
  state.lastClusterMaxY = -1;
  state.renderContinuityState = createContinuityState();
  state.tileFlameVisual.fill(0);
  state.tileIgnitionAgeSeconds.fill(0);
  state.tileSmokeVisual.fill(0);
  state.tileLocalFlameSlotActivation.fill(0);
  state.tileGroundFlameSlotActivation.fill(0);
  state.tileObjectFlameSlotActivation.fill(0);
  state.tileFrontPerimeter01.fill(0);
  state.tileFrontArrival01.fill(0);
  state.tileFrontAdvance01.fill(0);
  state.tileFrontDirX.fill(0);
  state.tileFrontDirZ.fill(0);
  state.tileActiveFlag.fill(0);
  state.tileClusterId.fill(-1);
  state.tileClusterRole.fill(0);
  state.tileSmokeOcclusion01.fill(0);
};

export const ensureFireRenderAnalysisState = (state: FireRenderAnalysisState, cols: number, rows: number): void => {
  if (cols === state.tileStateCols && rows === state.tileStateRows) {
    return;
  }
  const count = Math.max(0, cols * rows);
  state.tileStateCols = cols;
  state.tileStateRows = rows;
  state.tileFlameVisual = new Float32Array(count);
  state.tileIgnitionAgeSeconds = new Float32Array(count);
  state.tileSmokeVisual = new Float32Array(count);
  state.tileLocalFlameSlotActivation = new Float32Array(count * FIRE_VISUAL_TUNING.tongueSpawnMax);
  state.tileGroundFlameSlotActivation = new Float32Array(count * FIRE_VISUAL_TUNING.groundFlameSpawnMax);
  state.tileObjectFlameSlotActivation = new Float32Array(count * 2);
  state.tileFrontPerimeter01 = new Float32Array(count);
  state.tileFrontArrival01 = new Float32Array(count);
  state.tileFrontAdvance01 = new Float32Array(count);
  state.tileFrontDirX = new Float32Array(count);
  state.tileFrontDirZ = new Float32Array(count);
  state.tileActiveFlag = new Uint8Array(count);
  state.tileClusterId = new Int32Array(count).fill(-1);
  state.tileClusterRole = new Uint8Array(count);
  state.tileSmokeOcclusion01 = new Float32Array(count);
  state.clusterQueue = new Int32Array(count);
  resetFireRenderAnalysisVisualState(state);
};

export const getTileEmitterSlotIndex = (tileIdx: number, slot: number, maxSlots: number): number =>
  tileIdx * maxSlots + slot;

export const readTileEmitterSlotState = (slots: Float32Array, slotIndex: number): number => slots[slotIndex] ?? 0;

export const clearTileEmitterSlots = (slots: Float32Array, tileIdx: number, maxSlots: number): void => {
  const baseIndex = tileIdx * maxSlots;
  for (let slot = 0; slot < maxSlots; slot += 1) {
    slots[baseIndex + slot] = 0;
  }
};

export const updateTileEmitterSlots = (
  state: FireRenderAnalysisState,
  slots: Float32Array,
  tileIdx: number,
  maxSlots: number,
  targetCount: number,
  riseRate: number,
  fallRate: number,
  dtSeconds: number,
  visibleCutoff: number,
  churnKey: "localSlotChurn" | "objectSlotChurn" | null
): { activationSum: number; maxActivation: number; visibleCount: number } => {
  const baseIndex = tileIdx * maxSlots;
  let activationSum = 0;
  let maxActivation = 0;
  let visibleCount = 0;
  for (let slot = 0; slot < maxSlots; slot += 1) {
    const slotIndex = baseIndex + slot;
    const previous = readTileEmitterSlotState(slots, slotIndex);
    const targetActivation = clamp(targetCount - slot, 0, 1);
    const next = smoothApproach(previous, targetActivation, riseRate, fallRate, dtSeconds);
    slots[slotIndex] = next;
    if (churnKey && (previous > visibleCutoff) !== (next > visibleCutoff)) {
      state.renderContinuityState[churnKey] += 1;
    }
    activationSum += next;
    if (next > maxActivation) {
      maxActivation = next;
    }
    if (next > visibleCutoff) {
      visibleCount += 1;
    }
  }
  return { activationSum, maxActivation, visibleCount };
};

export const updateLocalTileEmitterSlots = (
  state: FireRenderAnalysisState,
  tileIdx: number,
  targetCount: number,
  dtSeconds: number
): { activationSum: number; maxActivation: number; visibleCount: number } =>
  updateTileEmitterSlots(
    state,
    state.tileLocalFlameSlotActivation,
    tileIdx,
    FIRE_VISUAL_TUNING.tongueSpawnMax,
    targetCount,
    FIRE_LOCAL_SLOT_RISE_RATE,
    FIRE_LOCAL_SLOT_FALL_RATE,
    dtSeconds,
    FIRE_EMITTER_SLOT_VISIBLE_CUTOFF,
    "localSlotChurn"
  );

export const updateGroundTileEmitterSlots = (
  state: FireRenderAnalysisState,
  tileIdx: number,
  targetCount: number,
  dtSeconds: number
): { activationSum: number; maxActivation: number; visibleCount: number } =>
  updateTileEmitterSlots(
    state,
    state.tileGroundFlameSlotActivation,
    tileIdx,
    FIRE_VISUAL_TUNING.groundFlameSpawnMax,
    targetCount,
    FIRE_GROUND_SLOT_RISE_RATE,
    FIRE_GROUND_SLOT_FALL_RATE,
    dtSeconds,
    FIRE_EMITTER_SLOT_VISIBLE_CUTOFF,
    null
  );

export const updateObjectTileEmitterSlots = (
  state: FireRenderAnalysisState,
  tileIdx: number,
  targetCount: number,
  dtSeconds: number
): { activationSum: number; maxActivation: number; visibleCount: number } =>
  updateTileEmitterSlots(
    state,
    state.tileObjectFlameSlotActivation,
    tileIdx,
    2,
    targetCount,
    FIRE_OBJECT_SLOT_RISE_RATE,
    FIRE_OBJECT_SLOT_FALL_RATE,
    dtSeconds,
    FIRE_EMITTER_SLOT_VISIBLE_CUTOFF,
    "objectSlotChurn"
  );

export const getFrontCorridorKey = (corridor: FrontCorridor): number =>
  ((((corridor.dir * 257 + corridor.fixedCoord) * 257 + corridor.startCoord) * 257 + corridor.endCoord) >>> 0);

const getFrontCorridorSlotKey = (corridorKey: number, slot: number): number =>
  corridorKey * FIRE_FRONT_CORRIDOR_MAX_SEGMENTS + slot;

export const updateFrontCorridorSlotActivation = (
  state: FireRenderAnalysisState,
  corridorKey: number,
  slot: number,
  targetActivation: number,
  frameId: number,
  dtSeconds: number
): number => {
  const slotKey = getFrontCorridorSlotKey(corridorKey, slot);
  let slotState: FrontCorridorSlotState | undefined = state.frontCorridorSlotStates.get(slotKey);
  if (!slotState) {
    slotState = { activation: 0, lastActiveFrame: frameId };
    state.frontCorridorSlotStates.set(slotKey, slotState);
  }
  const previous = slotState.activation;
  slotState.activation = smoothApproach(previous, targetActivation, FIRE_FRONT_SLOT_RISE_RATE, FIRE_FRONT_SLOT_FALL_RATE, dtSeconds);
  slotState.lastActiveFrame = frameId;
  if ((previous > FIRE_FRONT_SLOT_VISIBLE_CUTOFF) !== (slotState.activation > FIRE_FRONT_SLOT_VISIBLE_CUTOFF)) {
    state.renderContinuityState.frontSlotChurn += 1;
  }
  return slotState.activation;
};

export const decayInactiveFrontCorridorSlots = (
  state: FireRenderAnalysisState,
  frameId: number,
  dtSeconds: number
): void => {
  for (const [slotKey, slotState] of state.frontCorridorSlotStates) {
    if (slotState.lastActiveFrame === frameId) {
      continue;
    }
    const previous = slotState.activation;
    slotState.activation = smoothApproach(previous, 0, 0, FIRE_FRONT_SLOT_FALL_RATE, dtSeconds);
    if ((previous > FIRE_FRONT_SLOT_VISIBLE_CUTOFF) !== (slotState.activation > FIRE_FRONT_SLOT_VISIBLE_CUTOFF)) {
      state.renderContinuityState.frontSlotChurn += 1;
    }
    if (slotState.activation <= 0.01) {
      state.frontCorridorSlotStates.delete(slotKey);
    }
  }
};

export const releaseFireClusters = (state: FireRenderAnalysisState): void => {
  while (state.fireClusters.length > 0) {
    const cluster = state.fireClusters.pop();
    if (!cluster) {
      break;
    }
    cluster.tiles.length = 0;
    state.fireClusterPool.push(cluster);
  }
};

export const allocFireCluster = (state: FireRenderAnalysisState): FireCluster => {
  const cluster = state.fireClusterPool.pop();
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
    cluster.anchorSource = "terrainSurface";
    cluster.frontPerimeter01 = 0;
    cluster.frontArrival01 = 0;
    cluster.heatMean01 = 0;
    cluster.heatSum01 = 0;
    cluster.fuelMean01 = 0;
    cluster.intensity01 = 0;
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
    anchorSource: "terrainSurface",
    frontPerimeter01: 0,
    frontArrival01: 0,
    heatMean01: 0,
    heatSum01: 0,
    fuelMean01: 0,
    intensity01: 0,
    tiles: []
  };
};
