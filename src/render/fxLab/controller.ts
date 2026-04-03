import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createEffectsState, type EffectsState } from "../../core/effectsState.js";
import {
  COAST_CLASS_BEACH,
  COAST_CLASS_CLIFF,
  COAST_CLASS_NONE,
  COAST_CLASS_SHELF_WATER,
  createInitialState,
  TILE_TYPE_IDS,
  type WorldState
} from "../../core/state.js";
import { TREE_TYPE_IDS, TreeType, type Formation, type Grid, type Unit, type WaterSprayMode } from "../../core/types.js";
import { buildTerrainMesh, prepareTerrainRenderSurface, type TerrainRenderSurface, type TerrainSample } from "../threeTestTerrain.js";
import { ThreeTestWaterSystem } from "../threeTestWater.js";
import {
  createThreeTestFireFx,
  normalizeFireFxDebugControls,
  type FireFxDebugControls,
  type ThreeTestFireFx
} from "../threeTestFireFx.js";
import {
  createThreeTestUnitFxLayer,
  normalizeWaterFxDebugControls,
  type WaterFxDebugSnapshot,
  type ThreeTestUnitFxLayer,
  type WaterFxDebugControls
} from "../threeTestUnitFx.js";
import { createThreeTestUnitsLayer, type ThreeTestUnitsLayer } from "../threeTestUnits.js";
import { getTreeAssetsCache, loadTreeAssets, type TreeAssets } from "../threeTestAssets.js";
import { getRequiredWebGLContext } from "../webglContext.js";
import {
  buildFxLabOverrides,
  cloneDefaultFireFxDebugControls,
  cloneDefaultOceanWaterDebugControls,
  cloneDefaultTerrainWaterDebugControls,
  cloneDefaultWaterFxDebugControls,
  formatFxLabOverrides
} from "./controls.js";
import type { OceanWaterDebugControls } from "../oceanWaterDebug.js";
import type { TerrainWaterDebugControls } from "../terrainWaterDebug.js";
import { applyFxLabScenarioFrame, type FxLabScenarioFrameContext } from "./scenarios.js";
import {
  normalizeFxLabScenarioId,
  type FxLabOverrides,
  type FxLabPlacementMode,
  type FxLabScenarioId
} from "./types.js";

const FX_LAB_GRID_SIZE = 72;
const FX_LAB_SEED = 18032026;
const DEFAULT_STEP_SECONDS = 1 / 30;
const FX_LAB_OCEAN_SEA_LEVEL = 0.12;
const FX_LAB_COAST_BEACH_MAX_SLOPE = 0.3;
const FX_LAB_COAST_BEACH_MAX_RELIEF = 0.16;
const FX_LAB_COAST_BEACH_MAX_HEIGHT_ABOVE_SEA = 0.28;
const FX_LAB_COAST_BEACH_LAND_BAND = 2;
const FX_LAB_COAST_BEACH_SHELF_BAND = 6;
const FX_LAB_COAST_BEACH_DRY_HEIGHTS = [0.01, 0.024] as const;
const FX_LAB_COAST_BEACH_WET_DEPTHS = [0.003, 0.006, 0.01, 0.015, 0.021, 0.028] as const;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const fract = (value: number): number => value - Math.floor(value);
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) <= 1e-6) {
    return value >= edge1 ? 1 : 0;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const getCoastBandValue = (values: readonly number[], distance: number): number => {
  if (distance <= 0) {
    return values[0] ?? 0;
  }
  return values[Math.min(values.length - 1, distance - 1)] ?? values[values.length - 1] ?? 0;
};

const buildDistanceField = (
  cols: number,
  rows: number,
  isSource: (idx: number) => boolean
): Uint16Array => {
  const total = cols * rows;
  const maxDistance = cols + rows + 4;
  const distances = new Uint16Array(total);
  distances.fill(maxDistance);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i += 1) {
    if (!isSource(i)) {
      continue;
    }
    distances[i] = 0;
    queue[tail] = i;
    tail += 1;
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const nextDistance = distances[idx] + 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (x > 0) {
      const nIdx = idx - 1;
      if (nextDistance < distances[nIdx]) {
        distances[nIdx] = nextDistance;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (x + 1 < cols) {
      const nIdx = idx + 1;
      if (nextDistance < distances[nIdx]) {
        distances[nIdx] = nextDistance;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (y > 0) {
      const nIdx = idx - cols;
      if (nextDistance < distances[nIdx]) {
        distances[nIdx] = nextDistance;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    if (y + 1 < rows) {
      const nIdx = idx + cols;
      if (nextDistance < distances[nIdx]) {
        distances[nIdx] = nextDistance;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
  }
  return distances;
};

const applyOceanShorelineClassification = (
  world: WorldState,
  treeTypes: Uint8Array,
  baseFuel: Float32Array
): void => {
  const { cols, rows, totalTiles } = world.grid;
  const seaLevel = FX_LAB_OCEAN_SEA_LEVEL;
  const shorelineByColumn = new Float32Array(cols);
  for (let x = 0; x < cols; x += 1) {
    const bayA = Math.exp(-((x - cols * 0.22) * (x - cols * 0.22)) / 84);
    const bayB = Math.exp(-((x - cols * 0.72) * (x - cols * 0.72)) / 96);
    const headland = Math.exp(-((x - cols * 0.5) * (x - cols * 0.5)) / 220);
    const macro =
      11.8 +
      Math.sin(x * 0.11 + 0.6) * 1.4 +
      Math.sin(x * 0.047 + 1.9) * 1.1 +
      bayA * 1.6 +
      bayB * 1.3 -
      headland * 1.1;
    shorelineByColumn[x] = clamp(macro, 8.2, 17.8);
  }

  for (let i = 0; i < totalTiles; i += 1) {
    world.tileSeaLevel[i] = seaLevel;
    world.tileOceanMask[i] = 0;
    world.tileCoastDistance[i] = 0;
    world.tileCoastClass[i] = COAST_CLASS_NONE;
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      if (world.tileRiverMask[idx] > 0) {
        continue;
      }
      const shoreline =
        shorelineByColumn[x] +
        Math.sin(x * 0.37 + y * 0.21 + 0.9) * 0.34 +
        Math.sin(x * 0.13 - y * 0.19 + 1.7) * 0.21;
      if (y + 0.5 > shoreline) {
        continue;
      }
      world.tileOceanMask[idx] = 1;
      world.tileTypeId[idx] = TILE_TYPE_IDS.water;
      world.tileMoisture[idx] = 1;
      world.tileVegetationAge[idx] = 0;
      world.tileCanopyCover[idx] = 0;
      world.tileStemDensity[idx] = 0;
      world.tileHeatRetention[idx] = 0.28;
      world.tileWindFactor[idx] = 1.04;
      world.tileHeatTransferCap[idx] = 0.18;
      treeTypes[idx] = TREE_TYPE_IDS[TreeType.Scrub];
      baseFuel[idx] = 0.02;
      world.tileFuel[idx] = 0.02;
    }
  }

  const distToOcean = buildDistanceField(cols, rows, (idx) => world.tileOceanMask[idx] > 0);
  const distToLand = buildDistanceField(cols, rows, (idx) => world.tileOceanMask[idx] === 0);

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const elevation = world.tileElevation[idx] ?? 0;
      if (world.tileRiverMask[idx] > 0) {
        world.tileCoastDistance[idx] = 0;
        world.tileCoastClass[idx] = COAST_CLASS_NONE;
        continue;
      }
      if (world.tileOceanMask[idx] > 0) {
        const distance = distToLand[idx] ?? 0;
        world.tileCoastDistance[idx] = distance;
        if (distance >= 1 && distance <= FX_LAB_COAST_BEACH_SHELF_BAND) {
          world.tileCoastClass[idx] = COAST_CLASS_SHELF_WATER;
          const targetDepth = getCoastBandValue(FX_LAB_COAST_BEACH_WET_DEPTHS, distance);
          world.tileElevation[idx] = Math.min(elevation, seaLevel - targetDepth);
        } else {
          const deepDistance = Math.max(0, distance - FX_LAB_COAST_BEACH_SHELF_BAND);
          const depth = 0.03 + deepDistance * 0.0035;
          world.tileElevation[idx] = Math.min(elevation, seaLevel - depth);
        }
        continue;
      }

      const distance = distToOcean[idx] ?? 0;
      world.tileCoastDistance[idx] = distance;
      if (distance < 1 || distance > FX_LAB_COAST_BEACH_LAND_BAND) {
        continue;
      }

      let minElevation = elevation;
      let maxElevation = elevation;
      let localSlope = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= rows) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= cols) {
            continue;
          }
          const nIdx = ny * cols + nx;
          if (world.tileOceanMask[nIdx] > 0 || world.tileRiverMask[nIdx] > 0) {
            continue;
          }
          const neighborElevation = world.tileElevation[nIdx] ?? elevation;
          minElevation = Math.min(minElevation, neighborElevation);
          maxElevation = Math.max(maxElevation, neighborElevation);
          if (nIdx !== idx) {
            localSlope = Math.max(localSlope, Math.abs(elevation - neighborElevation));
          }
        }
      }

      const relief = maxElevation - minElevation;
      const isBeach =
        localSlope <= FX_LAB_COAST_BEACH_MAX_SLOPE &&
        relief <= FX_LAB_COAST_BEACH_MAX_RELIEF &&
        elevation - seaLevel <= FX_LAB_COAST_BEACH_MAX_HEIGHT_ABOVE_SEA &&
        world.tileTypeId[idx] !== TILE_TYPE_IDS.base &&
        world.tileTypeId[idx] !== TILE_TYPE_IDS.road;

      world.tileCoastClass[idx] = isBeach ? COAST_CLASS_BEACH : COAST_CLASS_CLIFF;
      if (!isBeach) {
        continue;
      }

      world.tileTypeId[idx] = TILE_TYPE_IDS.beach;
      world.tileElevation[idx] = Math.min(
        world.tileElevation[idx],
        seaLevel + getCoastBandValue(FX_LAB_COAST_BEACH_DRY_HEIGHTS, distance)
      );
      world.tileMoisture[idx] = Math.max(world.tileMoisture[idx], 0.42);
      world.tileVegetationAge[idx] = 0;
      world.tileCanopyCover[idx] = 0;
      world.tileStemDensity[idx] = 0;
      treeTypes[idx] = TREE_TYPE_IDS[TreeType.Scrub];
      baseFuel[idx] = Math.min(baseFuel[idx], 0.08);
      world.tileFuel[idx] = Math.min(world.tileFuel[idx], baseFuel[idx]);
    }
  }
};

type FxLabSceneState = {
  world: WorldState;
  effects: EffectsState;
  sample: TerrainSample;
  truck: Unit;
  firefighter: Unit;
  baseFuel: Float32Array;
};

type ManualTruckPlacement = {
  x: number;
  y: number;
  formation: Formation;
};

type ManualSprayTarget = {
  x: number;
  y: number;
};

export type FxLabController = {
  start: () => void;
  stop: () => void;
  resize: () => void;
  dispose: () => void;
  setScenario: (scenarioId: FxLabScenarioId) => void;
  getScenario: () => FxLabScenarioId;
  restart: () => void;
  step: (seconds?: number) => void;
  setPaused: (paused: boolean) => void;
  isPaused: () => boolean;
  setTimeScale: (value: number) => void;
  getTimeScale: () => number;
  setPlacementMode: (mode: FxLabPlacementMode) => void;
  getPlacementMode: () => FxLabPlacementMode;
  clearPlacementOverrides: () => void;
  setManualSprayEnabled: (enabled: boolean) => void;
  isManualSprayEnabled: () => boolean;
  setManualSprayMode: (mode: WaterSprayMode) => void;
  getManualSprayMode: () => WaterSprayMode;
  clearManualSprayTarget: () => void;
  hasManualSprayTarget: () => boolean;
  getWaterDebugSnapshot: () => WaterFxDebugSnapshot;
  setFireDebugControls: (controls: Partial<FireFxDebugControls>) => void;
  getFireDebugControls: () => FireFxDebugControls;
  resetFireDebugControls: () => void;
  setWaterDebugControls: (controls: Partial<WaterFxDebugControls>) => void;
  getWaterDebugControls: () => WaterFxDebugControls;
  resetWaterDebugControls: () => void;
  setOceanWaterDebugControls: (controls: Partial<OceanWaterDebugControls>) => void;
  getOceanWaterDebugControls: () => OceanWaterDebugControls;
  resetOceanWaterDebugControls: () => void;
  setTerrainWaterDebugControls: (controls: Partial<TerrainWaterDebugControls>) => void;
  getTerrainWaterDebugControls: () => TerrainWaterDebugControls;
  resetTerrainWaterDebugControls: () => void;
  resetAllDebugControls: () => void;
  getOverridePayload: () => FxLabOverrides;
  getOverridePayloadText: () => string;
};

const createLabUnit = (
  id: number,
  kind: Unit["kind"],
  x: number,
  y: number,
  formation: Formation,
  assignedTruckId: number | null
): Unit => ({
  id,
  kind,
  rosterId: null,
  autonomous: false,
  x,
  y,
  prevX: x,
  prevY: y,
  target: null,
  path: [],
  pathIndex: 0,
  speed: kind === "truck" ? 2.2 : 1.8,
  radius: kind === "truck" ? 1.4 : 1.1,
  hoseRange: kind === "truck" ? 8.2 : 7.3,
  power: kind === "truck" ? 1.2 : 1,
  selected: false,
  carrierId: null,
  passengerIds: [],
  assignedTruckId,
  commandUnitId: kind === "truck" ? 1 : assignedTruckId ? 1 : null,
  crewIds: kind === "truck" ? [2] : [],
  crewMode: kind === "truck" ? "deployed" : "deployed",
  formation,
  behaviourMode: "balanced",
  attackTarget: null,
  sprayTarget: null,
  truckOverrideIntent: null,
  water: kind === "truck" ? 100 : 0,
  waterCapacity: kind === "truck" ? 100 : 0,
  waterRefillRate: kind === "truck" ? 18 : 0,
  lastBackburnAt: Number.NEGATIVE_INFINITY,
  currentStatus: "holding",
  currentAlerts: []
});

const applyRiverWaterfallCorridor = (world: WorldState, treeTypes: Uint8Array, baseFuel: Float32Array): void => {
  const { cols, rows } = world.grid;
  const riverStartRow = 8;
  const riverEndRow = rows - 9;
  const centerline = new Float32Array(rows).fill(Number.NaN);
  const surfaceByRow = new Float32Array(rows).fill(Number.NaN);
  const widthByRow = new Float32Array(rows);
  const stepByRow = new Float32Array(rows);
  const bankBoostByRow = new Float32Array(rows);
  let surface = 0.492;

  const centerXAt = (y: number): number => 45.2 + Math.sin(y * 0.094) * 0.82 + Math.sin(y * 0.031 + 0.7) * 0.34;
  const rapidShelfCenter = 24.8;
  const mainFallCenter = 35.9;
  const plungePoolCenter = 38.3;
  const originalSurfaceByRow = new Float32Array(rows).fill(Number.NaN);

  for (let y = riverStartRow; y <= riverEndRow; y += 1) {
    const t = (y - riverStartRow) / Math.max(1, riverEndRow - riverStartRow);
    const rapidShelf = Math.exp(-((y - rapidShelfCenter) * (y - rapidShelfCenter)) / 2.8);
    const mainFall = Math.exp(-((y - mainFallCenter) * (y - mainFallCenter)) / 0.72);
    const plungePool = Math.exp(-((y - plungePoolCenter) * (y - plungePoolCenter)) / 4.8);
    let drop = 0.00074 + t * 0.00016;
    if (y === 24) {
      drop += 0.008;
    } else if (y === 25) {
      drop += 0.0045;
    } else if (y === 26) {
      drop += 0.0012;
    } else if (y === 35) {
      drop += 0.006;
    } else if (y === 36) {
      drop += 0.152;
    } else if (y === 37) {
      drop += 0.004;
    } else if (y >= 38 && y <= 40) {
      drop += 0.00002;
    } else if (y === 41) {
      drop += 0.0008;
    }
    surface = Math.max(0.214, surface - drop);
    centerline[y] = centerXAt(y);
    surfaceByRow[y] = surface;
    originalSurfaceByRow[y] = surface;
    widthByRow[y] = 1.02 + t * 0.05 + rapidShelf * 0.08 + plungePool * 0.24 + mainFall * 0.1;
    stepByRow[y] = clamp(0.035 + rapidShelf * 0.34 + mainFall * 0.98 + plungePool * 0.08, 0, 1);
    bankBoostByRow[y] = rapidShelf * 0.014 + mainFall * 0.064 + plungePool * 0.028;
  }

  if (riverEndRow >= 40) {
    const rapidShelfLip = surfaceByRow[23];
    if (Number.isFinite(rapidShelfLip)) {
      surfaceByRow[24] = rapidShelfLip - 0.0022;
      surfaceByRow[25] = rapidShelfLip - 0.0108;
      surfaceByRow[26] = surfaceByRow[25] - 0.0007;
    }
    const lipSurface = surfaceByRow[34];
    if (Number.isFinite(lipSurface)) {
      const poolSurface = Math.max(0.214, lipSurface - 0.158);
      surfaceByRow[35] = lipSurface - 0.0003;
      surfaceByRow[36] = poolSurface;
      surfaceByRow[37] = poolSurface - 0.00015;
      surfaceByRow[38] = poolSurface - 0.00024;
      surfaceByRow[39] = poolSurface - 0.00034;
      for (let y = 40; y <= riverEndRow; y += 1) {
        const baseDelta = Number.isFinite(originalSurfaceByRow[y - 1]) && Number.isFinite(originalSurfaceByRow[y])
          ? Math.max(0.00008, originalSurfaceByRow[y - 1] - originalSurfaceByRow[y])
          : 0.00012;
        surfaceByRow[y] = Math.max(0.214, surfaceByRow[y - 1] - baseDelta);
      }
    }
  }

  for (let y = riverStartRow; y <= riverEndRow; y += 1) {
    const t = (y - riverStartRow) / Math.max(1, riverEndRow - riverStartRow);
    const centerX = centerline[y];
    const baseSurface = surfaceByRow[y];
    const channelWidth = widthByRow[y];
    const stepStrength = stepByRow[y];
    const bankBoost = bankBoostByRow[y];
    const rapidShelf = Math.exp(-((y - rapidShelfCenter) * (y - rapidShelfCenter)) / 2.8);
    const mainFall = Math.exp(-((y - mainFallCenter) * (y - mainFallCenter)) / 0.72);
    const plungePool = Math.exp(-((y - plungePoolCenter) * (y - plungePoolCenter)) / 4.8);
    const bankWidth = channelWidth + 1.02 + plungePool * 0.42 + mainFall * 0.24;
    const minX = Math.max(0, Math.floor(centerX - bankWidth - 1));
    const maxX = Math.min(cols - 1, Math.ceil(centerX + bankWidth + 1));
    for (let x = minX; x <= maxX; x += 1) {
      const idx = y * cols + x;
      const tileCenterX = x + 0.5;
      const dist = Math.abs(tileCenterX - centerX);
      if (dist > bankWidth) {
        continue;
      }

      const bankBlend = 1 - dist / Math.max(0.001, bankWidth);
      world.tileMoisture[idx] = Math.max(world.tileMoisture[idx], 0.66 + bankBlend * 0.22);
      world.tileHeatRetention[idx] = Math.min(world.tileHeatRetention[idx], 0.82);
      world.tileSpreadBoost[idx] = Math.min(world.tileSpreadBoost[idx], 0.92);

      if (dist <= channelWidth) {
        const channelBlend = 1 - dist / Math.max(0.001, channelWidth);
        const depthBase = 0.018 + t * 0.004 + rapidShelf * 0.004 + plungePool * 0.026 + mainFall * 0.014;
        const localDepth = depthBase * (0.72 + channelBlend * 0.4);
        const localSurface = baseSurface + (1 - channelBlend) * 0.0018;
        const localBed = localSurface - localDepth;
        const channelCap = localBed + 0.004 + (1 - channelBlend) * 0.01;
        world.tileElevation[idx] = Math.min(world.tileElevation[idx], channelCap);
        world.tileTypeId[idx] = TILE_TYPE_IDS.water;
        world.tileRiverMask[idx] = 1;
        world.tileRiverBed[idx] = Number.isFinite(world.tileRiverBed[idx])
          ? Math.min(world.tileRiverBed[idx], localBed)
          : localBed;
        world.tileRiverSurface[idx] = Number.isFinite(world.tileRiverSurface[idx])
          ? Math.min(world.tileRiverSurface[idx], localSurface)
          : localSurface;
        world.tileRiverStepStrength[idx] = Math.max(
          world.tileRiverStepStrength[idx] ?? 0,
          stepStrength * (0.52 + channelBlend * 0.48)
        );
        world.tileMoisture[idx] = 1;
        world.tileHeatRetention[idx] = 0.32;
        world.tileWindFactor[idx] = 1.04;
        world.tileHeatTransferCap[idx] = 0.18;
        world.tileVegetationAge[idx] = 0;
        world.tileCanopyCover[idx] = 0;
        world.tileStemDensity[idx] = 0;
        treeTypes[idx] = TREE_TYPE_IDS[TreeType.Scrub];
        baseFuel[idx] = 0.02;
        world.tileFuel[idx] = baseFuel[idx];
        continue;
      }

      const bankChannelBlend = 1 - (dist - channelWidth) / Math.max(0.001, bankWidth - channelWidth);
      const desiredBankHeight =
        baseSurface +
        0.016 +
        bankChannelBlend * (0.014 + bankBoost) +
        mainFall * 0.05 +
        plungePool * 0.018;
      world.tileElevation[idx] = Math.max(world.tileElevation[idx], desiredBankHeight);
      if (
        (mainFall > 0.12 || rapidShelf > 0.3) &&
        bankChannelBlend > 0.16 &&
        world.tileTypeId[idx] !== TILE_TYPE_IDS.base &&
        world.tileTypeId[idx] !== TILE_TYPE_IDS.road
      ) {
        world.tileTypeId[idx] = TILE_TYPE_IDS.rocky;
        baseFuel[idx] = Math.min(baseFuel[idx], mainFall > 0.2 ? 0.12 : 0.18);
        world.tileFuel[idx] = Math.min(world.tileFuel[idx], baseFuel[idx]);
        world.tileCanopyCover[idx] = Math.min(world.tileCanopyCover[idx], 0.06);
        world.tileStemDensity[idx] = Math.min(world.tileStemDensity[idx], 18);
      } else if (world.tileTypeId[idx] === TILE_TYPE_IDS.grass && bankChannelBlend > 0.44) {
        world.tileTypeId[idx] = TILE_TYPE_IDS.floodplain;
        baseFuel[idx] = Math.min(baseFuel[idx], 0.46);
        world.tileFuel[idx] = Math.min(world.tileFuel[idx], baseFuel[idx]);
      }
    }
  }
};

const applyTerrainLayout = (world: WorldState): { treeTypes: Uint8Array; baseFuel: Float32Array } => {
  const cols = world.grid.cols;
  const rows = world.grid.rows;
  const total = world.grid.totalTiles;
  const treeTypes = new Uint8Array(total);
  const baseFuel = new Float32Array(total);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const nx = x / Math.max(1, cols - 1) - 0.5;
      const ny = y / Math.max(1, rows - 1) - 0.5;
      const rolling = Math.sin(x * 0.18) * 0.08 + Math.cos(y * 0.14) * 0.06;
      const hillWest = Math.exp(-(((x - 18) * (x - 18) + (y - 24) * (y - 24)) / 180)) * 0.38;
      const hillEast = Math.exp(-(((x - 52) * (x - 52) + (y - 46) * (y - 46)) / 260)) * 0.32;
      const ridge = Math.exp(-((x - 38) * (x - 38)) / 520) * (0.08 + Math.max(0, ny + 0.2) * 0.16);
      world.tileElevation[idx] = 0.14 + rolling + hillWest + hillEast + ridge + (nx * nx + ny * ny) * 0.04;

      const roadBand = y >= 41 && y <= 45 && x >= 12 && x <= 32;
      const basePad = x >= 21 && x <= 25 && y >= 40 && y <= 44;
      const forestWest = (x - 44) * (x - 44) + (y - 28) * (y - 28) < 150;
      const forestEast = (x - 56) * (x - 56) + (y - 48) * (y - 48) < 120;
      const scrubBelt = !forestWest && !forestEast && x >= 30 && x <= 54 && y >= 18 && y <= 58;
      const rockyEdge = x <= 4 || y <= 4 || x >= cols - 5 || y >= rows - 5;

      let tileType = TILE_TYPE_IDS.grass;
      if (basePad) {
        tileType = TILE_TYPE_IDS.base;
      } else if (roadBand) {
        tileType = TILE_TYPE_IDS.road;
      } else if (forestWest || forestEast) {
        tileType = TILE_TYPE_IDS.forest;
      } else if (scrubBelt && (x + y) % 3 !== 0) {
        tileType = TILE_TYPE_IDS.scrub;
      } else if (rockyEdge) {
        tileType = TILE_TYPE_IDS.rocky;
      }

      world.tileTypeId[idx] = tileType;
      world.tileRiverMask[idx] = 0;
      world.tileRoadBridge[idx] = 0;
      world.tileRoadEdges[idx] = 0;
      world.tileRoadWallEdges[idx] = 0;
      world.tileRiverBed[idx] = Number.NaN;
      world.tileRiverSurface[idx] = Number.NaN;
      world.tileRiverStepStrength[idx] = 0;
      world.tileStructure[idx] = 0;
      world.structureMask[idx] = 0;
      world.tileTownId[idx] = -1;
      world.tileSpreadBoost[idx] = tileType === TILE_TYPE_IDS.forest ? 1.1 : tileType === TILE_TYPE_IDS.scrub ? 0.92 : 0.78;
      world.tileHeatRetention[idx] = tileType === TILE_TYPE_IDS.forest ? 1.15 : tileType === TILE_TYPE_IDS.road ? 0.24 : 0.84;
      world.tileWindFactor[idx] = tileType === TILE_TYPE_IDS.forest ? 0.76 : 1;
      world.tileHeatTransferCap[idx] = tileType === TILE_TYPE_IDS.base ? 0.2 : 1;
      world.tileMoisture[idx] = tileType === TILE_TYPE_IDS.forest ? 0.76 : tileType === TILE_TYPE_IDS.scrub ? 0.48 : 0.58;
      world.tileVegetationAge[idx] = tileType === TILE_TYPE_IDS.forest ? 26 : tileType === TILE_TYPE_IDS.scrub ? 9 : 4;
      world.tileCanopyCover[idx] = tileType === TILE_TYPE_IDS.forest ? 0.9 : tileType === TILE_TYPE_IDS.scrub ? 0.32 : 0.08;
      world.tileStemDensity[idx] = tileType === TILE_TYPE_IDS.forest ? 180 : tileType === TILE_TYPE_IDS.scrub ? 84 : 0;
      treeTypes[idx] =
        tileType === TILE_TYPE_IDS.forest
          ? (x + y) % 2 === 0
            ? TREE_TYPE_IDS[TreeType.Pine]
            : TREE_TYPE_IDS[TreeType.Oak]
          : TREE_TYPE_IDS[TreeType.Scrub];
      baseFuel[idx] =
        tileType === TILE_TYPE_IDS.forest
          ? 1
          : tileType === TILE_TYPE_IDS.grass
            ? 0.78
            : tileType === TILE_TYPE_IDS.scrub
              ? 0.58
              : tileType === TILE_TYPE_IDS.road
                ? 0.08
                : tileType === TILE_TYPE_IDS.base
                  ? 0.04
                  : 0.2;
      world.tileFuel[idx] = baseFuel[idx];
    }
  }
  applyRiverWaterfallCorridor(world, treeTypes, baseFuel);
  applyOceanShorelineClassification(world, treeTypes, baseFuel);
  let landTiles = 0;
  for (let i = 0; i < total; i += 1) {
    const tileType = world.tileTypeId[i];
    landTiles +=
      tileType === TILE_TYPE_IDS.road || tileType === TILE_TYPE_IDS.base || tileType === TILE_TYPE_IDS.water ? 0 : 1;
  }
  world.totalLandTiles = Math.max(1, landTiles);
  world.basePoint = { x: 23, y: 42 };
  world.terrainTypeRevision = 1;
  world.vegetationRevision = 1;
  world.structureRevision = 0;
  world.terrainDirty = false;
  return { treeTypes, baseFuel };
};

const createSceneState = (): FxLabSceneState => {
  const grid: Grid = {
    cols: FX_LAB_GRID_SIZE,
    rows: FX_LAB_GRID_SIZE,
    totalTiles: FX_LAB_GRID_SIZE * FX_LAB_GRID_SIZE
  };
  const world = createInitialState(FX_LAB_SEED, grid);
  world.phase = "fire";
  world.simTimeMode = "incident";
  world.paused = true;
  world.climateMoisture = 0.62;
  world.climateTemp = 29;
  world.fireSettings.heatCap = 5.4;
  const truck = createLabUnit(1, "truck", 23.5, 42.5, "medium", null);
  const firefighter = createLabUnit(2, "firefighter", 24.9, 43.5, "medium", truck.id);
  truck.crewIds = [firefighter.id];
  world.units = [truck, firefighter];
  world.nextUnitId = 3;
  const { treeTypes, baseFuel } = applyTerrainLayout(world);
  const sample: TerrainSample = {
    cols: grid.cols,
    rows: grid.rows,
    elevations: world.tileElevation,
    tileTypes: world.tileTypeId,
    treeTypes,
    tileFire: world.tileFire,
    tileHeat: world.tileHeat,
    tileFuel: world.tileFuel,
    heatCap: world.fireSettings.heatCap,
    tileMoisture: world.tileMoisture,
    tileVegetationAge: world.tileVegetationAge,
    tileCanopyCover: world.tileCanopyCover,
    tileStemDensity: world.tileStemDensity,
    riverMask: world.tileRiverMask,
    oceanMask: world.tileOceanMask,
    seaLevel: world.tileSeaLevel,
    coastDistance: world.tileCoastDistance,
    coastClass: world.tileCoastClass,
    roadBridgeMask: world.tileRoadBridge,
    roadEdges: world.tileRoadEdges,
    roadWallEdges: world.tileRoadWallEdges,
    riverBed: world.tileRiverBed,
    riverSurface: world.tileRiverSurface,
    riverStepStrength: world.tileRiverStepStrength,
    climateDryness: 0.44,
    debugTypeColors: false,
    treesEnabled: true,
    worldSeed: world.seed,
    towns: [],
    vegetationRevision: world.vegetationRevision,
    structureRevision: world.structureRevision,
    dynamicStructures: false
  };
  return {
    world,
    effects: createEffectsState(),
    sample,
    truck,
    firefighter,
    baseFuel
  };
};

const disposeTerrainMesh = (mesh: THREE.Mesh | null): void => {
  if (!mesh) {
    return;
  }
  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    if (child.geometry) {
      child.geometry.dispose();
    }
    const disposeMaterial = (material: THREE.Material): void => {
      const textured = material as THREE.Material & { map?: THREE.Texture | null };
      if (textured.map) {
        textured.map.dispose();
      }
      material.dispose();
    };
    if (Array.isArray(child.material)) {
      child.material.forEach((entry) => disposeMaterial(entry));
      return;
    }
    disposeMaterial(child.material);
  });
};

export const createFxLabController = (
  canvas: HTMLCanvasElement,
  initialScenarioId: FxLabScenarioId = "fire-line"
): FxLabController => {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context: getRequiredWebGLContext(canvas, "FX Lab"),
    antialias: true,
    alpha: false,
    powerPreference: "default"
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;
  renderer.setClearColor(0x0d1117, 1);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1e2430, 22, 86);
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 240);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  camera.position.set(22, 16, 24);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 1.4, 0);

  const hemisphere = new THREE.HemisphereLight(0x8ab4ff, 0x493629, 0.78);
  const ambient = new THREE.AmbientLight(0xffffff, 0.28);
  const keyLight = new THREE.DirectionalLight(0xffe5bf, 1.15);
  keyLight.position.set(18, 28, 10);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.bias = -0.00035;
  keyLight.shadow.normalBias = 0.02;
  scene.add(hemisphere, ambient, keyLight, keyLight.target);
  const waterSystem = new ThreeTestWaterSystem({
    scene,
    renderer,
    keyLight,
    skyTopColor: 0x8ab4ff,
    skyHorizonColor: 0xd7e6f5,
    fogColor: 0x1e2430,
    fogNear: 22,
    fogFar: 86,
    preferredQuality: "high"
  });

  const sceneState = createSceneState();
  let currentScenarioId = normalizeFxLabScenarioId(initialScenarioId);
  let fireDebugControls = cloneDefaultFireFxDebugControls();
  let waterDebugControls = cloneDefaultWaterFxDebugControls();
  let oceanWaterDebugControls = cloneDefaultOceanWaterDebugControls();
  let terrainWaterDebugControls = cloneDefaultTerrainWaterDebugControls();
  let terrainMesh: THREE.Mesh | null = null;
  let terrainSize: { width: number; depth: number } | null = null;
  let terrainSurface: TerrainRenderSurface | null = null;
  let treeAssets: TreeAssets | null = getTreeAssetsCache();
  let disposed = false;
  let running = false;
  let rafId = 0;
  let paused = false;
  let timeScale = 1;
  let labTimeMs = 0;
  let lastFrameMs: number | null = null;
  let lastSceneRenderMs = 9;
  let skipNextAdvance = false;
  let placementMode: FxLabPlacementMode = "none";
  let manualTruckPlacement: ManualTruckPlacement | null = null;
  let manualFirefighterPlacement: { x: number; y: number } | null = null;
  let manualSprayEnabled = false;
  let manualSprayMode: WaterSprayMode = "balanced";
  let manualSprayTarget: ManualSprayTarget | null = null;

  const fireFx: ThreeTestFireFx = createThreeTestFireFx(scene, camera, fireDebugControls);
  const unitsLayer: ThreeTestUnitsLayer = createThreeTestUnitsLayer(scene);
  const unitFxLayer: ThreeTestUnitFxLayer = createThreeTestUnitFxLayer(scene);
  const sprayTargetMarker = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.42, 24),
    new THREE.MeshBasicMaterial({
      color: 0x7ad8ff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false
    })
  );
  sprayTargetMarker.rotation.x = -Math.PI * 0.5;
  sprayTargetMarker.renderOrder = 20;
  sprayTargetMarker.visible = false;
  scene.add(sprayTargetMarker);
  fireFx.setSimulationAlpha(1);
  fireFx.setDebugControls(fireDebugControls);
  unitFxLayer.setDebugControls(waterDebugControls);
  waterSystem.setOceanDebugControls(oceanWaterDebugControls);
  waterSystem.setDebugControls(terrainWaterDebugControls);

  const fitCameraToTerrain = (): void => {
    if (!terrainSize) {
      return;
    }
    if (currentScenarioId === "ocean-shoreline") {
      const shoreFocus = (() => {
        const coastDistance = sceneState.sample.coastDistance;
        const oceanMask = sceneState.sample.oceanMask;
        if (!coastDistance || !oceanMask || coastDistance.length !== oceanMask.length) {
          return { x: FX_LAB_GRID_SIZE * 0.5, y: FX_LAB_GRID_SIZE * 0.12 };
        }
        let sumX = 0;
        let sumY = 0;
        let count = 0;
        for (let i = 0; i < oceanMask.length; i += 1) {
          if ((oceanMask[i] ?? 0) <= 0 || (coastDistance[i] ?? 0) > 2) {
            continue;
          }
          sumX += i % FX_LAB_GRID_SIZE;
          sumY += Math.floor(i / FX_LAB_GRID_SIZE);
          count += 1;
        }
        if (count <= 0) {
          return { x: FX_LAB_GRID_SIZE * 0.5, y: FX_LAB_GRID_SIZE * 0.12 };
        }
        return { x: sumX / count, y: sumY / count };
      })();
      const focusWorldX = (shoreFocus.x / FX_LAB_GRID_SIZE - 0.5) * terrainSize.width;
      const focusWorldZ = (shoreFocus.y / FX_LAB_GRID_SIZE - 0.5) * terrainSize.depth;
      const distance = Math.max(9, Math.max(terrainSize.width, terrainSize.depth) * 0.18);
      camera.position.set(focusWorldX - distance * 0.3, Math.max(4.2, distance * 0.18), focusWorldZ + distance * 0.56);
      controls.target.set(focusWorldX, 0.85, focusWorldZ - distance * 0.04);
      controls.minDistance = Math.max(4, distance * 0.32);
      controls.maxDistance = Math.max(24, distance * 2.6);
      camera.updateProjectionMatrix();
      controls.update();
      return;
    }
    if (currentScenarioId === "river-waterfall") {
      const focusTileX = 45.0;
      const focusTileY = 36.1;
      const focusWorldX = (focusTileX / FX_LAB_GRID_SIZE - 0.5) * terrainSize.width;
      const focusWorldZ = (focusTileY / FX_LAB_GRID_SIZE - 0.5) * terrainSize.depth;
      const distance = Math.max(10, Math.max(terrainSize.width, terrainSize.depth) * 0.22);
      camera.position.set(focusWorldX - distance * 0.44, Math.max(6, distance * 0.32), focusWorldZ + distance * 0.54);
      controls.target.set(focusWorldX, 1.2, focusWorldZ - distance * 0.04);
      controls.minDistance = Math.max(5, distance * 0.42);
      controls.maxDistance = Math.max(42, distance * 3.2);
      camera.updateProjectionMatrix();
      controls.update();
      return;
    }
    const distance = Math.max(12, Math.max(terrainSize.width, terrainSize.depth) * 0.55);
    camera.position.set(distance * 0.62, distance * 0.42, distance * 0.74);
    controls.target.set(0, 1.5, 0);
    controls.minDistance = Math.max(6, distance * 0.18);
    controls.maxDistance = Math.max(70, distance * 3.4);
    camera.updateProjectionMatrix();
    controls.update();
  };

  const rebuildTerrain = (): void => {
    if (disposed) {
      return;
    }
    waterSystem.clear();
    if (terrainMesh) {
      scene.remove(terrainMesh);
      disposeTerrainMesh(terrainMesh);
      terrainMesh = null;
    }
    terrainSurface = prepareTerrainRenderSurface(sceneState.sample);
    const result = buildTerrainMesh(terrainSurface, treeAssets, null, null);
    terrainMesh = result.mesh;
    terrainSize = result.size;
    scene.add(terrainMesh);
    if (result.water) {
      waterSystem.rebuild(terrainMesh, result.water);
    }
    waterSystem.setLightDirectionFromKeyLight();
    fitCameraToTerrain();
  };

  const hydrateTreeAssets = (): void => {
    if (treeAssets) {
      return;
    }
    void loadTreeAssets()
      .then((assets) => {
        if (disposed) {
          return;
        }
        treeAssets = assets;
        rebuildTerrain();
      })
      .catch((error) => {
        console.warn("[fxLab] Failed to load tree assets for background hydration.", error);
      });
  };

  const resetDynamicState = (): void => {
    sceneState.world.tileFire.fill(0);
    sceneState.world.tileHeat.fill(0);
    sceneState.world.tileSuppressionWetness.fill(0);
    sceneState.world.tileIgniteAt.fill(Number.POSITIVE_INFINITY);
    sceneState.world.tileFuel.set(sceneState.baseFuel);
    sceneState.world.lastActiveFires = 0;
    sceneState.world.fireScheduledCount = 0;
    sceneState.world.fireBoundsActive = false;
    sceneState.world.fireMinX = 0;
    sceneState.world.fireMaxX = 0;
    sceneState.world.fireMinY = 0;
    sceneState.world.fireMaxY = 0;
    sceneState.world.units.forEach((unit) => {
      unit.attackTarget = null;
      unit.sprayTarget = null;
    });
    sceneState.effects.waterStreams.length = 0;
    sceneState.effects.waterParticles.length = 0;
    sceneState.effects.smokeParticles.length = 0;
  };

  const setUnitPose = (unit: Unit, x: number, y: number, formation?: Formation): void => {
    unit.prevX = unit.x = x;
    unit.prevY = unit.y = y;
    if (formation) {
      unit.formation = formation;
    }
  };

  const setPlacementMode = (mode: FxLabPlacementMode): void => {
    placementMode = mode;
    controls.enabled = mode === "none";
    canvas.style.cursor = mode === "none" ? "" : "crosshair";
  };

  const clearPlacementOverrides = (): void => {
    manualTruckPlacement = null;
    manualFirefighterPlacement = null;
    renderOnce();
  };

  const clearManualSprayTarget = (): void => {
    manualSprayTarget = null;
    renderOnce();
  };

  const setWind = (dx: number, dy: number, strength: number, name: string): void => {
    const length = Math.hypot(dx, dy);
    const inv = length > 0.0001 ? 1 / length : 0;
    sceneState.world.wind = {
      name,
      dx: dx * inv,
      dy: dy * inv,
      strength: clamp(strength, 0, 1)
    };
  };

  const addFireDisk = (cx: number, cy: number, radius: number, intensity: number, heatScale = 4): void => {
    const { cols, rows } = sceneState.world.grid;
    const minX = Math.max(0, Math.floor(cx - radius - 1));
    const maxX = Math.min(cols - 1, Math.ceil(cx + radius + 1));
    const minY = Math.max(0, Math.floor(cy - radius - 1));
    const maxY = Math.min(rows - 1, Math.ceil(cy + radius + 1));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dist = Math.hypot(x - cx, y - cy);
        if (dist > radius) {
          continue;
        }
        const falloff = Math.pow(1 - dist / Math.max(0.0001, radius), 0.72);
        const idx = y * cols + x;
        const fire = intensity * falloff;
        sceneState.world.tileFire[idx] = Math.max(sceneState.world.tileFire[idx] ?? 0, fire);
        sceneState.world.tileHeat[idx] = Math.max(sceneState.world.tileHeat[idx] ?? 0, fire * heatScale);
        sceneState.world.tileFuel[idx] = Math.max(0.08, Math.min(sceneState.world.tileFuel[idx], sceneState.baseFuel[idx] * (0.96 - fire * 0.26)));
      }
    }
  };

  const distanceToSegment = (px: number, py: number, x0: number, y0: number, x1: number, y1: number): number => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lenSq = dx * dx + dy * dy;
    if (lenSq <= 0.0001) {
      return Math.hypot(px - x0, py - y0);
    }
    const t = clamp(((px - x0) * dx + (py - y0) * dy) / lenSq, 0, 1);
    return Math.hypot(px - (x0 + dx * t), py - (y0 + dy * t));
  };

  const addFireLine = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    thickness: number,
    intensity: number,
    heatScale = 4
  ): void => {
    const { cols, rows } = sceneState.world.grid;
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - thickness - 1));
    const maxX = Math.min(cols - 1, Math.ceil(Math.max(x0, x1) + thickness + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - thickness - 1));
    const maxY = Math.min(rows - 1, Math.ceil(Math.max(y0, y1) + thickness + 1));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dist = distanceToSegment(x, y, x0, y0, x1, y1);
        if (dist > thickness) {
          continue;
        }
        const idx = y * cols + x;
        const fire = intensity * Math.pow(1 - dist / Math.max(0.0001, thickness), 0.82);
        sceneState.world.tileFire[idx] = Math.max(sceneState.world.tileFire[idx] ?? 0, fire);
        sceneState.world.tileHeat[idx] = Math.max(sceneState.world.tileHeat[idx] ?? 0, fire * heatScale);
        sceneState.world.tileFuel[idx] = Math.max(0.08, Math.min(sceneState.world.tileFuel[idx], sceneState.baseFuel[idx] * (0.94 - fire * 0.22)));
      }
    }
  };

  const addScheduledRing = (cx: number, cy: number, innerRadius: number, outerRadius: number): void => {
    const { cols, rows } = sceneState.world.grid;
    const minX = Math.max(0, Math.floor(cx - outerRadius - 1));
    const maxX = Math.min(cols - 1, Math.ceil(cx + outerRadius + 1));
    const minY = Math.max(0, Math.floor(cy - outerRadius - 1));
    const maxY = Math.min(rows - 1, Math.ceil(cy + outerRadius + 1));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dist = Math.hypot(x - cx, y - cy);
        if (dist < innerRadius || dist > outerRadius) {
          continue;
        }
        const idx = y * cols + x;
        sceneState.world.tileIgniteAt[idx] = 0;
        sceneState.world.tileHeat[idx] = Math.max(sceneState.world.tileHeat[idx] ?? 0, sceneState.world.fireSettings.heatCap * 0.08);
      }
    }
  };

  const getModePulse = (mode: WaterSprayMode): number =>
    mode === "precision" ? 8.1 : mode === "suppression" ? 4.7 : 6.4;

  const TAU = Math.PI * 2;

  const getModeSize = (mode: WaterSprayMode, seed: number): number =>
    mode === "precision"
      ? 1.2 + seed * 0.8
      : mode === "suppression"
        ? 2.1 + seed * 1.1
        : 1.6 + seed * 0.9;

  const getManualSprayConfig = (
    mode: WaterSprayMode
  ): { volume: number; intensity: number; particleCount: number; sweepJitter: number } => {
    if (mode === "precision") {
      return { volume: 0.96, intensity: 1, particleCount: 120, sweepJitter: 0.12 };
    }
    if (mode === "suppression") {
      return { volume: 0.72, intensity: 1, particleCount: 190, sweepJitter: 0.28 };
    }
    return { volume: 0.78, intensity: 1, particleCount: 150, sweepJitter: 0.24 };
  };

  const getDefaultSprayTarget = (): ManualSprayTarget => ({
    x: clamp(sceneState.firefighter.x + 7.2, 0.5, sceneState.world.grid.cols - 0.5),
    y: clamp(sceneState.firefighter.y - 1.8, 0.5, sceneState.world.grid.rows - 0.5)
  });

  const getFireFocusPoint = (): { x: number; y: number } | null => {
    const { cols, totalTiles } = sceneState.world.grid;
    let weightedX = 0;
    let weightedY = 0;
    let totalWeight = 0;
    for (let idx = 0; idx < totalTiles; idx += 1) {
      const fire = sceneState.world.tileFire[idx] ?? 0;
      const heat = sceneState.world.tileHeat[idx] ?? 0;
      const scheduled = sceneState.world.tileIgniteAt[idx] < Number.POSITIVE_INFINITY ? 0.08 : 0;
      const weight = Math.max(fire, heat * 0.12, scheduled);
      if (weight <= 0.01) {
        continue;
      }
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      weightedX += (x + 0.5) * weight;
      weightedY += (y + 0.5) * weight;
      totalWeight += weight;
    }
    if (totalWeight <= 0.001) {
      return null;
    }
    return {
      x: weightedX / totalWeight,
      y: weightedY / totalWeight
    };
  };

  const getActiveManualSprayTarget = (): ManualSprayTarget => {
    if (manualSprayTarget) {
      return manualSprayTarget;
    }
    return getFireFocusPoint() ?? getDefaultSprayTarget();
  };

  const emitWaterStream = (options: {
    sourceUnitId: number;
    targetX: number;
    targetY: number;
    mode: WaterSprayMode;
    volume: number;
    intensity: number;
    particleCount?: number;
    sweepJitter?: number;
  }): void => {
    const sourceUnit = sceneState.world.units.find((unit) => unit.id === options.sourceUnitId) ?? sceneState.firefighter;
    sourceUnit.sprayTarget = { x: options.targetX, y: options.targetY };
    sceneState.effects.waterStreams.push({
      sourceUnitId: options.sourceUnitId,
      sourceX: sourceUnit.x,
      sourceY: sourceUnit.y,
      targetX: options.targetX,
      targetY: options.targetY,
      mode: options.mode,
      volume: clamp(options.volume, 0, 1),
      intensity: clamp(options.intensity, 0, 1)
    });
    const particleCount = Math.max(
      24,
      Math.min(
        420,
        Math.round(
          options.particleCount ??
            (options.mode === "precision" ? 180 : options.mode === "suppression" ? 360 : 260)
        )
      )
    );
    const jitterScale = options.sweepJitter ?? 0.18;
    const dx = options.targetX - sourceUnit.x;
    const dy = options.targetY - sourceUnit.y;
    const length = Math.max(0.0001, Math.hypot(dx, dy));
    const nx = -dy / length;
    const ny = dx / length;
    const speed = options.mode === "precision" ? 2.2 : options.mode === "suppression" ? 1.28 : 1.74;
    const modeSpreadScale = options.mode === "suppression" ? 1.52 : options.mode === "precision" ? 0.24 : 0.88;
    for (let i = 0; i < particleCount; i += 1) {
      const seed = fract(i * 0.61803398875 + options.sourceUnitId * 0.137);
      const seedA = fract(seed * 1.73 + 0.17);
      const seedB = fract(seed * 2.41 + 0.43);
      const seedC = fract(seed * 3.19 + 0.71);
      const flow = fract(labTimeMs * 0.001 * speed + i / particleCount + seedA * 0.09);
      const along =
        1 -
        Math.pow(
          1 - flow,
          options.mode === "suppression" ? 1.74 : options.mode === "precision" ? 1.02 : 1.4
        );
      const tipBias = Math.pow(along, options.mode === "suppression" ? 1.56 : options.mode === "precision" ? 1.12 : 1.28);
      const spread =
        jitterScale *
        modeSpreadScale *
        (0.03 + tipBias * (options.mode === "suppression" ? 0.48 : options.mode === "precision" ? 0.06 : 0.24)) *
        (0.72 + seedB * 0.68);
      const lateral =
        ((seedA * 2 - 1) * 0.82 + Math.sin(labTimeMs * 0.0011 + seedC * TAU) * 0.18) * spread;
      const axialJitter = ((seedB * 2 - 1) * 0.08 + Math.cos(labTimeMs * 0.0009 + seedA * TAU) * 0.04) * spread;
      const x = sourceUnit.x + dx * along + nx * lateral + (dx / length) * axialJitter;
      const y = sourceUnit.y + dy * along + ny * lateral + (dy / length) * axialJitter;
      const maxLife = options.mode === "precision" ? 0.78 : options.mode === "suppression" ? 0.92 : 0.84;
      sceneState.effects.waterParticles.push({
        x,
        y,
        vx: 0,
        vy: 0,
        life: maxLife * clamp(1 - along * 0.94, 0.05, 1),
        maxLife,
        size: getModeSize(options.mode, seed),
        alpha: clamp(0.28 + tipBias * 0.68, 0.14, 1),
        sprayMode: options.mode,
        sprayVolume: clamp(options.volume * (0.86 + seed * 0.22), 0, 1),
        spraySeed: seed,
        sprayPulseHz: getModePulse(options.mode) * (0.92 + seed * 0.18),
        spraySourceId: options.sourceUnitId
      });
    }
  };

  const finalizeFireState = (): void => {
    const { cols, rows, totalTiles } = sceneState.world.grid;
    let activeCount = 0;
    let scheduledCount = 0;
    let hasBounds = false;
    let minX = cols;
    let maxX = -1;
    let minY = rows;
    let maxY = -1;
    for (let idx = 0; idx < totalTiles; idx += 1) {
      const fire = sceneState.world.tileFire[idx] ?? 0;
      const heat = sceneState.world.tileHeat[idx] ?? 0;
      const scheduled = sceneState.world.tileIgniteAt[idx] < Number.POSITIVE_INFINITY;
      if (fire > 0.02) {
        activeCount += 1;
      }
      if (scheduled) {
        scheduledCount += 1;
      }
      if (fire <= 0.001 && heat <= 0.04 && !scheduled) {
        continue;
      }
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      hasBounds = true;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    sceneState.world.lastActiveFires = activeCount;
    sceneState.world.fireScheduledCount = scheduledCount;
    sceneState.world.fireBoundsActive = hasBounds;
    sceneState.world.fireMinX = hasBounds ? minX : 0;
    sceneState.world.fireMaxX = hasBounds ? maxX : 0;
    sceneState.world.fireMinY = hasBounds ? minY : 0;
    sceneState.world.fireMaxY = hasBounds ? maxY : 0;
  };

  const applyScenarioFrame = (): void => {
    resetDynamicState();
    const context: FxLabScenarioFrameContext = {
      world: sceneState.world,
      effects: sceneState.effects,
      truck: sceneState.truck,
      firefighter: sceneState.firefighter,
      timeSeconds: labTimeMs * 0.001,
      cols: sceneState.world.grid.cols,
      rows: sceneState.world.grid.rows,
      setWind,
      placeTruck: (x, y, formation) => {
        const placement = manualTruckPlacement;
        setUnitPose(
          sceneState.truck,
          placement?.x ?? x,
          placement?.y ?? y,
          placement?.formation ?? formation
        );
      },
      placeFirefighter: (x, y) => {
        const placement = manualFirefighterPlacement;
        setUnitPose(
          sceneState.firefighter,
          placement?.x ?? x,
          placement?.y ?? y,
          sceneState.firefighter.formation
        );
      },
      addFireDisk,
      addFireLine,
      addScheduledRing,
      emitWaterStream
    };
    applyFxLabScenarioFrame(currentScenarioId, context);
    if (manualSprayEnabled) {
      const target = getActiveManualSprayTarget();
      const config = getManualSprayConfig(manualSprayMode);
      emitWaterStream({
        sourceUnitId: sceneState.firefighter.id,
        targetX: target.x,
        targetY: target.y,
        mode: manualSprayMode,
        volume: config.volume,
        intensity: config.intensity,
        particleCount: config.particleCount,
        sweepJitter: config.sweepJitter
      });
    }
    finalizeFireState();
    fireFx.captureSnapshot(sceneState.world);
    const fireLoad01 = clamp(sceneState.world.lastActiveFires / 160, 0, 1);
    fireFx.setEnvironmentSignals({
      smoke01: clamp(0.24 + fireLoad01 * 0.52, 0, 1),
      denseSmoke01: clamp(0.18 + fireLoad01 * 0.44, 0, 1),
      fireLoad01,
      orangeGlow01: clamp(0.36 + fireLoad01 * 0.44, 0, 1),
      sunDirection: { x: 0.62, y: 0.74, z: 0.24 },
      sunTint: 0xffc784,
      smokeTint: 0xb4b2ad
    });
  };

  const updateSprayTargetMarker = (timeMs: number): void => {
    const showMarker = manualSprayEnabled || placementMode === "spray-target" || manualSprayTarget !== null;
    if (!showMarker || !terrainSurface) {
      sprayTargetMarker.visible = false;
      return;
    }
    const target = getActiveManualSprayTarget();
    const worldX = terrainSurface.toWorldX(target.x);
    const worldZ = terrainSurface.toWorldZ(target.y);
    const worldY = terrainSurface.heightAtTileCoord(target.x, target.y) * terrainSurface.heightScale + 0.06;
    const pulse = 1 + Math.sin(timeMs * 0.006) * 0.08;
    sprayTargetMarker.visible = true;
    sprayTargetMarker.position.set(worldX, worldY, worldZ);
    sprayTargetMarker.scale.setScalar(pulse);
  };

  const pickTerrainTile = (clientX: number, clientY: number): { x: number; y: number } | null => {
    if (!terrainMesh || !terrainSize) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObject(terrainMesh, false)[0];
    if (!hit) {
      return null;
    }
    const { cols, rows } = sceneState.world.grid;
    return {
      x: clamp(((hit.point.x / terrainSize.width) + 0.5) * cols, 0.5, cols - 0.5),
      y: clamp(((hit.point.z / terrainSize.depth) + 0.5) * rows, 0.5, rows - 0.5)
    };
  };

  const handleCanvasPointerDown = (event: PointerEvent): void => {
    if (placementMode === "none" || event.button !== 0) {
      return;
    }
    const tile = pickTerrainTile(event.clientX, event.clientY);
    if (!tile) {
      return;
    }
    event.preventDefault();
    if (placementMode === "truck") {
      manualTruckPlacement = {
        x: tile.x,
        y: tile.y,
        formation: sceneState.truck.formation
      };
    } else if (placementMode === "spray-target") {
      manualSprayTarget = tile;
    } else {
      manualFirefighterPlacement = tile;
    }
    renderOnce();
  };

  const renderFrame = (now: number): void => {
    if (disposed) {
      return;
    }
    if (running) {
      rafId = window.requestAnimationFrame(renderFrame);
    }
    const frameDeltaMs = lastFrameMs === null ? 16.6667 : Math.min(64, Math.max(1, now - lastFrameMs));
    lastFrameMs = now;
    if (skipNextAdvance) {
      skipNextAdvance = false;
    } else if (!paused) {
      labTimeMs += frameDeltaMs * timeScale;
    }
    controls.update();
    waterSystem.setLightDirectionFromKeyLight();
    waterSystem.update(now, frameDeltaMs * 0.001, 1000 / Math.max(1, frameDeltaMs), lastSceneRenderMs);
    applyScenarioFrame();
    fireFx.update(now, sceneState.world, sceneState.sample, terrainSize, terrainSurface, null, null, 60, lastSceneRenderMs);
    unitsLayer.update(sceneState.world, terrainSurface, 1);
    unitFxLayer.update(sceneState.world, sceneState.effects, terrainSurface, 1, now);
    updateSprayTargetMarker(now);
    const renderStartedAt = performance.now();
    renderer.render(scene, camera);
    lastSceneRenderMs = performance.now() - renderStartedAt;
  };

  const renderOnce = (): void => {
    if (running) {
      return;
    }
    skipNextAdvance = true;
    lastFrameMs = performance.now();
    renderFrame(lastFrameMs);
  };

  const resize = (): void => {
    const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  rebuildTerrain();
  hydrateTreeAssets();
  resize();
  renderOnce();
  canvas.addEventListener("pointerdown", handleCanvasPointerDown);

  return {
    start: () => {
      if (running || disposed) {
        return;
      }
      running = true;
      lastFrameMs = null;
      rafId = window.requestAnimationFrame(renderFrame);
    },
    stop: () => {
      running = false;
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    },
    resize,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
      }
      canvas.removeEventListener("pointerdown", handleCanvasPointerDown);
      setPlacementMode("none");
      controls.dispose();
      fireFx.dispose();
      unitFxLayer.dispose();
      unitsLayer.dispose();
      waterSystem.dispose();
      scene.remove(sprayTargetMarker);
      sprayTargetMarker.geometry.dispose();
      (sprayTargetMarker.material as THREE.Material).dispose();
      if (terrainMesh) {
        scene.remove(terrainMesh);
        disposeTerrainMesh(terrainMesh);
        terrainMesh = null;
      }
      terrainSurface = null;
      renderer.dispose();
    },
    setScenario: (scenarioId: FxLabScenarioId) => {
      currentScenarioId = normalizeFxLabScenarioId(scenarioId);
      setPlacementMode("none");
      manualTruckPlacement = null;
      manualFirefighterPlacement = null;
      labTimeMs = 0;
      fitCameraToTerrain();
      renderOnce();
    },
    getScenario: () => currentScenarioId,
    restart: () => {
      setPlacementMode("none");
      manualTruckPlacement = null;
      manualFirefighterPlacement = null;
      labTimeMs = 0;
      renderOnce();
    },
    step: (seconds = DEFAULT_STEP_SECONDS) => {
      labTimeMs += Math.max(0.001, seconds) * 1000;
      renderOnce();
    },
    setPaused: (nextPaused: boolean) => {
      paused = nextPaused;
    },
    isPaused: () => paused,
    setTimeScale: (value: number) => {
      timeScale = clamp(value, 0.1, 4);
    },
    getTimeScale: () => timeScale,
    setPlacementMode,
    getPlacementMode: () => placementMode,
    clearPlacementOverrides,
    setManualSprayEnabled: (enabled: boolean) => {
      manualSprayEnabled = enabled;
      renderOnce();
    },
    isManualSprayEnabled: () => manualSprayEnabled,
    setManualSprayMode: (mode: WaterSprayMode) => {
      manualSprayMode = mode;
      renderOnce();
    },
    getManualSprayMode: () => manualSprayMode,
    clearManualSprayTarget,
    hasManualSprayTarget: () => manualSprayTarget !== null,
    getWaterDebugSnapshot: () => unitFxLayer.getDebugSnapshot(),
    setFireDebugControls: (controls: Partial<FireFxDebugControls>) => {
      fireDebugControls = normalizeFireFxDebugControls({ ...fireDebugControls, ...controls });
      fireFx.setDebugControls(controls);
      renderOnce();
    },
    getFireDebugControls: () => ({ ...fireDebugControls }),
    resetFireDebugControls: () => {
      fireDebugControls = cloneDefaultFireFxDebugControls();
      fireFx.setDebugControls(fireDebugControls);
      renderOnce();
    },
    setWaterDebugControls: (controls: Partial<WaterFxDebugControls>) => {
      waterDebugControls = normalizeWaterFxDebugControls({ ...waterDebugControls, ...controls });
      unitFxLayer.setDebugControls(controls);
      renderOnce();
    },
    getWaterDebugControls: () => ({ ...waterDebugControls }),
    resetWaterDebugControls: () => {
      waterDebugControls = cloneDefaultWaterFxDebugControls();
      unitFxLayer.setDebugControls(waterDebugControls);
      renderOnce();
    },
    setOceanWaterDebugControls: (controls: Partial<OceanWaterDebugControls>) => {
      waterSystem.setOceanDebugControls(controls);
      oceanWaterDebugControls = waterSystem.getOceanDebugControls();
      renderOnce();
    },
    getOceanWaterDebugControls: () => ({ ...oceanWaterDebugControls }),
    resetOceanWaterDebugControls: () => {
      oceanWaterDebugControls = cloneDefaultOceanWaterDebugControls();
      waterSystem.setOceanDebugControls(oceanWaterDebugControls);
      renderOnce();
    },
    setTerrainWaterDebugControls: (controls: Partial<TerrainWaterDebugControls>) => {
      waterSystem.setDebugControls(controls);
      terrainWaterDebugControls = waterSystem.getDebugControls();
      renderOnce();
    },
    getTerrainWaterDebugControls: () => ({ ...terrainWaterDebugControls }),
    resetTerrainWaterDebugControls: () => {
      terrainWaterDebugControls = cloneDefaultTerrainWaterDebugControls();
      waterSystem.setDebugControls(terrainWaterDebugControls);
      renderOnce();
    },
    resetAllDebugControls: () => {
      fireDebugControls = cloneDefaultFireFxDebugControls();
      waterDebugControls = cloneDefaultWaterFxDebugControls();
      oceanWaterDebugControls = cloneDefaultOceanWaterDebugControls();
      terrainWaterDebugControls = cloneDefaultTerrainWaterDebugControls();
      fireFx.setDebugControls(fireDebugControls);
      unitFxLayer.setDebugControls(waterDebugControls);
      waterSystem.setOceanDebugControls(oceanWaterDebugControls);
      waterSystem.setDebugControls(terrainWaterDebugControls);
      renderOnce();
    },
    getOverridePayload: () => buildFxLabOverrides(fireDebugControls, waterDebugControls, terrainWaterDebugControls, oceanWaterDebugControls),
    getOverridePayloadText: () => formatFxLabOverrides(fireDebugControls, waterDebugControls, terrainWaterDebugControls, oceanWaterDebugControls)
  };
};
