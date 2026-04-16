import * as THREE from "three";
import {
  DEBUG_TERRAIN_RENDER,
  ENABLE_GRASS_DETAIL_FX,
  TILE_COLOR_RGB
} from "../core/config.js";
import { getHouseFootprintBounds, pickHouseFootprint } from "../core/houseFootprints.js";
import { getTerrainHeightScale } from "../core/terrainScale.js";
import { getVegetationRenderHeightMultiplier } from "../core/vegetation.js";
import {
  COAST_CLASS_BEACH,
  COAST_CLASS_CLIFF,
  COAST_CLASS_NONE,
  COAST_CLASS_SHELF_WATER,
  TILE_ID_TO_TYPE,
  TILE_TYPE_IDS
} from "../core/state.js";
import { TreeType, TREE_TYPE_IDS, type Town } from "../core/types.js";
import type { FirestationAsset, HouseAssets, HouseVariant, TreeAssets, TreeMeshTemplate, TreeVariant } from "./threeTestAssets.js";
import { TREE_MODEL_PATHS } from "./threeTestAssets.js";
import { applyGrassDetailFx } from "./grassDetailFx.js";
import { getRoadAtlasVersion } from "./terrain/canvas/roadAtlas.js";
import {
  buildRoadOverlayTexture as buildRoadOverlayTextureInternal,
  setRoadOverlayMaxSize as setRoadOverlayMaxSizeInternal
} from "./terrain/canvas/roadOverlay.js";
import { buildTownLabelGroup } from "./terrain/canvas/townLabelSprites.js";
import { buildBridgeDeckMesh, type BridgeDeckSurfaceInput } from "./terrain/roads/bridgeDeckMesh.js";
import { buildRoadDeckMesh } from "./terrain/roads/roadDeckMesh.js";
import {
  ROAD_SURFACE_WIDTH,
  ROAD_TEX_SCALE
} from "./terrain/roads/roadGeometryConstants.js";
import { buildRoadRetainingWallMesh } from "./terrain/roads/roadRetainingWallMesh.js";
import { buildDistanceField } from "./terrain/shared/distanceField.js";
import {
  buildTerrainHeightProvenance,
  collectTerrainHeightAnomalies,
  type TerrainHeightAnomaly,
  type TerrainHeightProvenance,
  type TerrainRenderDebugOptions
} from "./terrain/debug/terrainHeightProvenance.js";
import {
  RIVER_FIELD_THRESHOLD,
  buildBoundaryEdgesFromIndexedContour,
  buildRiverRenderDomain,
  buildSnappedRiverContourVertices,
  type RiverRenderDomain
} from "./terrain/water/riverRenderDomain.js";
import {
  WATERFALL_DEBUG_FLAG_BEST_DROP_OK,
  WATERFALL_DEBUG_FLAG_CANDIDATE,
  WATERFALL_DEBUG_FLAG_EMITTED,
  WATERFALL_DEBUG_FLAG_LOCAL_DROP_OK,
  WATERFALL_DEBUG_FLAG_OCEANISH,
  WATERFALL_DEBUG_FLAG_RIVER,
  WATERFALL_DEBUG_FLAG_STEP_OK,
  WATERFALL_DEBUG_FLAG_WATER,
  WATERFALL_MIN_DROP_NORM,
  WATERFALL_VERTICALITY_MIN,
  buildWaterfallInstances,
  type WaterfallDebugData,
  type WaterfallRiverDomainInput
} from "./terrain/water/waterfallBuilder.js";
import { buildRiverMeshData as buildRiverMeshDataInternal, type RiverWaterData } from "./terrain/water/riverMeshData.js";
import { buildWaterSurfaceHeights } from "./terrain/water/waterSurfaceHeights.js";
import {
  createRiverSpaceTransform,
  validateRiverSpaceTransform
} from "./terrain/water/waterSampling.js";
import {
  buildRapidMapTexture,
  buildRiverFlowTexture,
  buildWaterSupportMapTexture,
  type WaterSampleRatios
} from "./terrain/water/waterTextures.js";
import {
  buildShoreTransitionData,
  buildShoreTransitionMapTexture,
  type ShoreTransitionData
} from "./terrain/water/shoreTransition.js";
import { applyShoreTransitionTerrainMaterial } from "./terrain/water/shoreTransitionTerrainMaterial.js";
import {
  applyTreeSeasonShader,
  applyTrunkTopCropShader,
  createTreeBurnController,
  getTreeBurnRole,
  TREE_BURN_FUEL_EPS,
  TREE_BURN_LEAF_PIVOT_HEIGHT_FACTOR,
  TREE_BURN_MIXED_PIVOT_HEIGHT_FACTOR,
  TREE_BURN_TRUNK_PIVOT_HEIGHT_FACTOR,
  TREE_LEAF_DROP_BIAS_MAX,
  type TreeBurnMeshState,
  type TreeFlameProfile,
  type TreeSeasonVisualConfig,
  type TreeBurnController
} from "./terrain/vegetation/treeBurnController.js";
import {
  buildTileTexture as buildTileTextureInternal,
  sampleTouchesWorldBorder
} from "./terrain/textures/tileTexture.js";

export { getTerrainHeightScale };
export { getRoadAtlasVersion };
export { ROAD_SURFACE_WIDTH, ROAD_TEX_SCALE };
export {
  WATERFALL_DEBUG_FLAG_BEST_DROP_OK,
  WATERFALL_DEBUG_FLAG_CANDIDATE,
  WATERFALL_DEBUG_FLAG_EMITTED,
  WATERFALL_DEBUG_FLAG_LOCAL_DROP_OK,
  WATERFALL_DEBUG_FLAG_OCEANISH,
  WATERFALL_DEBUG_FLAG_RIVER,
  WATERFALL_DEBUG_FLAG_STEP_OK,
  WATERFALL_DEBUG_FLAG_WATER,
  WATERFALL_VERTICALITY_MIN
} from "./terrain/water/waterfallBuilder.js";
export type {
  TerrainBridgeAbutmentDebug,
  TerrainBridgeAnchorDebug,
  TerrainBridgeBoundsDebug,
  TerrainBridgeComponentDebug,
  TerrainBridgeDebug,
  TerrainBridgeSpanDebug,
  TerrainBridgeTileDebug
} from "./terrain/roads/bridgeDebug.js";
export type { TreeBurnController, TreeFlameProfile, TreeSeasonVisualConfig } from "./terrain/vegetation/treeBurnController.js";
export type { RiverRenderDomain } from "./terrain/water/riverRenderDomain.js";
export type { RiverWaterData } from "./terrain/water/riverMeshData.js";
export type { WaterSampleRatios } from "./terrain/water/waterTextures.js";
export type { WaterfallDebugData } from "./terrain/water/waterfallBuilder.js";
export type { TerrainHeightAnomaly, TerrainHeightProvenance, TerrainRenderDebugOptions } from "./terrain/debug/terrainHeightProvenance.js";

export type TerrainSample = {
  cols: number;
  rows: number;
  elevations: Float32Array;
  heightScaleMultiplier?: number;
  tileTypes?: Uint8Array;
  treeTypes?: Uint8Array;
  tileFire?: Float32Array;
  tileHeat?: Float32Array;
  tileFuel?: Float32Array;
  heatCap?: number;
  tileMoisture?: Float32Array;
  tileVegetationAge?: Float32Array;
  tileCanopyCover?: Float32Array;
  tileStemDensity?: Uint8Array;
  riverMask?: Uint8Array;
  oceanMask?: Uint8Array;
  seaLevel?: Float32Array;
  coastDistance?: Uint16Array;
  coastClass?: Uint8Array;
  roadBridgeMask?: Uint8Array;
  roadEdges?: Uint8Array;
  roadWallEdges?: Uint8Array;
  erosionWear?: Float32Array;
  riverBed?: Float32Array;
  riverSurface?: Float32Array;
  riverStepStrength?: Float32Array;
  climateDryness?: number;
  debugTypeColors?: boolean;
  treesEnabled?: boolean;
  fastUpdate?: boolean;
  fullResolution?: boolean;
  worldSeed?: number;
  towns?: Town[];
  vegetationRevision?: number;
  structureRevision?: number;
  dynamicStructures?: boolean;
  debugRenderOptions?: TerrainRenderDebugOptions;
};

type RGB = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const medianOfValues = (values: number[]): number => {
  if (values.length === 0) {
    return 0;
  }
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length * 0.5);
  if ((sorted.length & 1) === 1) {
    return sorted[mid] ?? 0;
  }
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) * 0.5;
};
const mixRgb = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t
});
const lighten = (color: RGB, amount: number): RGB => mixRgb(color, { r: 255, g: 255, b: 255 }, clamp(amount, 0, 1));
const darken = (color: RGB, amount: number): RGB => mixRgb(color, { r: 0, g: 0, b: 0 }, clamp(amount, 0, 1));
const getCoastProfileValue = (values: readonly number[], distance: number): number =>
  values[Math.max(0, Math.min(values.length - 1, distance - 1))] ?? values[values.length - 1] ?? 0;

const pointToSegmentDistance2D = (
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number => {
  const abX = bx - ax;
  const abY = by - ay;
  const abLenSq = abX * abX + abY * abY;
  if (abLenSq <= 1e-8) {
    return Math.hypot(px - ax, py - ay);
  }
  const t = clamp(((px - ax) * abX + (py - ay) * abY) / abLenSq, 0, 1);
  const qx = ax + abX * t;
  const qy = ay + abY * t;
  return Math.hypot(px - qx, py - qy);
};

const computeBoundaryMismatchStats = (
  aEdges: ArrayLike<number>,
  bEdges: ArrayLike<number>
): { mean: number; max: number; countA: number; countB: number } => {
  const countA = Math.floor(aEdges.length / 4);
  const countB = Math.floor(bEdges.length / 4);
  if (countA <= 0 || countB <= 0) {
    return { mean: 0, max: 0, countA, countB };
  }
  let sum = 0;
  let total = 0;
  let max = 0;
  const accumulate = (src: ArrayLike<number>, srcCount: number, dst: ArrayLike<number>, dstCount: number): void => {
    for (let i = 0; i < srcCount; i += 1) {
      const base = i * 4;
      const mx = (src[base] + src[base + 2]) * 0.5;
      const my = (src[base + 1] + src[base + 3]) * 0.5;
      let best = Number.POSITIVE_INFINITY;
      for (let j = 0; j < dstCount; j += 1) {
        const d = j * 4;
        const dist = pointToSegmentDistance2D(mx, my, dst[d], dst[d + 1], dst[d + 2], dst[d + 3]);
        if (dist < best) {
          best = dist;
          if (best <= 1e-4) {
            break;
          }
        }
      }
      if (!Number.isFinite(best)) {
        continue;
      }
      sum += best;
      total += 1;
      if (best > max) {
        max = best;
      }
    }
  };
  accumulate(aEdges, countA, bEdges, countB);
  accumulate(bEdges, countB, aEdges, countA);
  return {
    mean: total > 0 ? sum / total : 0,
    max,
    countA,
    countB
  };
};

const HEIGHT_SAMPLE_NODE_WEIGHT = 0.85;
const HEIGHT_SAMPLE_SPIKE_THRESHOLD = 0.014;
const HEIGHT_SAMPLE_SPIKE_CLAMP_MARGIN = 0.003;
const HEIGHT_SAMPLE_SPIKE_PASSES = 3;
const HEIGHT_SAMPLE_SPIKE_SUPPORTED_NEIGHBOR_MAX = 2;
const MIXED_WATER_VERTEX_MIN_COUNT = 2;
const MIXED_WATER_VERTEX_LAND_BLEND = 0.28;
const MIXED_WATER_VERTEX_MARGIN = 0.0015;
const MIXED_SUPPORT_VERTEX_LAND_BLEND = 0.16;
const MIXED_SUPPORT_VERTEX_MARGIN = 0.0008;
const MIXED_SUPPORT_VERTEX_RANGE_THRESHOLD = 0.01;
const WATER_ALPHA_MIN_RATIO = 0.1;
const OCEAN_RATIO_MIN = 0.1;
const RIVER_RATIO_MIN = 0.2;
const RIVER_RENDER_SUPPORT_RATIO_MIN = 0.04;
const OCEAN_SAMPLE_SUPPORT_FLOOR = 0.12;
const EDGE_WATER_SAMPLE_RATIO = 0.2;
const INTERIOR_WATER_SAMPLE_RATIO = 0.5;
const OCEAN_SHORE_TERRAIN_BAND = 3;
const OCEAN_TERRAIN_CUTOUT_BAND = 6;
const COAST_SAMPLE_BEACH_LAND_HEIGHTS = [0.014, 0.032] as const;
const COAST_SAMPLE_BEACH_WET_DEPTHS = [0.003, 0.006, 0.01, 0.015, 0.021, 0.028] as const;
const COAST_SAMPLE_CLIFF_LAND_MIN = [0.045, 0.085] as const;
const COAST_SAMPLE_SHELF_DOMINANCE_MIN = 0.5;
const COAST_SAMPLE_LAND_DOMINANCE_MIN = 0.18;
const OCEAN_BEACH_WAVE_DAMP_MAX = 0.88;
const OCEAN_CLIFF_WAVE_DAMP_MAX = 0.48;
const COAST_GEOMETRY_WATER_DEPTH_PER_CELL = 0.012;
const COAST_GEOMETRY_WATER_MAX_DEPTH = 0.08;
const COAST_GEOMETRY_LAND_RELAX_BAND = 10;
const COAST_GEOMETRY_LAND_RISE_PER_CELL = 0.012;
const OCEAN_SURFACE_SHORE_CLIP_BAND = 2;
const OCEAN_BORDER_OPEN_WATER_DISTANCE_MIN = OCEAN_SURFACE_SHORE_CLIP_BAND + 2;
const WATER_ALPHA_POWER = 0.85;
const SHORE_SDF_MAX_DISTANCE = 7;
const RIVER_BANK_MAX_DISTANCE = 5;
const WATER_SURFACE_LIFT_OCEAN = 0.08;
const WATER_SURFACE_LIFT_RIVER = 0.012;
const RIVER_SURFACE_BANK_CLEARANCE = 0.02;
const RIVER_CUTOUT_FIELD_DILATE = 0;
const STEP_ROCKY_TINT_MAX = 0.28;
const TREE_SCALE_BASE = 0.75;
const TREE_SCALE_STEP_GAIN = 0.06;
const TREE_SCALE_STEP_CAP = 0.4;
const TREE_HEIGHT_FACTOR = 1.8;
const MEDIUM_TERRAIN_DETAIL_THRESHOLD = 256;
const LARGE_TERRAIN_DETAIL_THRESHOLD = 512;
const TREE_DENSITY_SCALE_MEDIUM = 0.8;
const TREE_DENSITY_SCALE_LARGE = 0.62;
const TREE_ATTEMPT_CAP_MEDIUM = 2;
const TREE_ATTEMPT_CAP_LARGE = 1;
const TREE_VARIANT_CAP_MEDIUM = 2;
const TREE_VARIANT_CAP_LARGE = 1;
const TREE_INSTANCE_BUDGET_MEDIUM = 28000;
const TREE_INSTANCE_BUDGET_LARGE = 18000;
const DETAILED_STRUCTURE_THRESHOLD = 512;
const SCRUB_PLACEHOLDER_BASE_CHANCE = 0.42;
const SCRUB_PLACEHOLDER_MAX_INSTANCES = 30000;
const SCRUB_PLACEHOLDER_SCALE_MIN = 0.55;
const SCRUB_PLACEHOLDER_SCALE_MAX = 0.95;
export const setRoadOverlayMaxSize = (size: number): void => {
  setRoadOverlayMaxSizeInternal(size);
};
const SUN_DIR = (() => {
  const x = 0.55;
  const y = 0.78;
  const z = 0.32;
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
})();

const FOREST_TONE_BASE = TILE_COLOR_RGB.forest;
const FOREST_CANOPY_TONES: Record<TreeType, RGB> = {
  [TreeType.Pine]: darken(mixRgb(FOREST_TONE_BASE, { r: 48, g: 80, b: 64 }, 0.35), 0.08),
  [TreeType.Oak]: mixRgb(FOREST_TONE_BASE, { r: 110, g: 118, b: 58 }, 0.35),
  [TreeType.Maple]: mixRgb(FOREST_TONE_BASE, { r: 120, g: 92, b: 62 }, 0.32),
  [TreeType.Birch]: lighten(mixRgb(FOREST_TONE_BASE, { r: 148, g: 152, b: 98 }, 0.42), 0.05),
  [TreeType.Elm]: mixRgb(FOREST_TONE_BASE, { r: 72, g: 122, b: 86 }, 0.3),
  [TreeType.Scrub]: mixRgb(FOREST_TONE_BASE, TILE_COLOR_RGB.scrub, 0.5)
};
const FOREST_TINT_BY_ID: RGB[] = [];
FOREST_TINT_BY_ID[TREE_TYPE_IDS[TreeType.Pine]] = FOREST_CANOPY_TONES[TreeType.Pine];
FOREST_TINT_BY_ID[TREE_TYPE_IDS[TreeType.Oak]] = FOREST_CANOPY_TONES[TreeType.Oak];
FOREST_TINT_BY_ID[TREE_TYPE_IDS[TreeType.Maple]] = FOREST_CANOPY_TONES[TreeType.Maple];
FOREST_TINT_BY_ID[TREE_TYPE_IDS[TreeType.Birch]] = FOREST_CANOPY_TONES[TreeType.Birch];
FOREST_TINT_BY_ID[TREE_TYPE_IDS[TreeType.Elm]] = FOREST_CANOPY_TONES[TreeType.Elm];
FOREST_TINT_BY_ID[TREE_TYPE_IDS[TreeType.Scrub]] = FOREST_CANOPY_TONES[TreeType.Scrub];

let threeTestLoggedTotal = -1;

type TreeInstance = {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  treeType: TreeType;
  variantIndex: number;
  tileIndex: number;
  tileX: number;
  tileY: number;
};

type ScrubPlaceholderInstance = {
  x: number;
  y: number;
  z: number;
  scale: number;
  rotation: number;
  colorJitter: number;
};

export type OceanWaterData = {
  mask: THREE.DataTexture;
  supportMap: THREE.DataTexture;
  domainMap: THREE.DataTexture;
  shoreSdf: THREE.DataTexture;
  shoreTransitionMap: THREE.DataTexture;
  flowMap: THREE.DataTexture;
  rapidMap: THREE.DataTexture;
  // World-space base Y for the water mesh.
  level: number;
  sampleCols: number;
  sampleRows: number;
  width: number;
  depth: number;
  // World-space Y offsets relative to `level`.
  heights?: Float32Array;
};

export type TerrainWaterData = {
  ocean: OceanWaterData;
  river?: RiverWaterData;
  // Packed x,z,top,drop,dirX,dirZ,width; top/drop are world-space offsets relative to `level`.
  waterfallInstances?: Float32Array;
  waterfallDebug?: WaterfallDebugData;
};

type HouseSpot = {
  x: number;
  y: number;
  z: number;
  footprintX: number;
  footprintZ: number;
  minTileX: number;
  maxTileX: number;
  minTileY: number;
  maxTileY: number;
  rotation: number;
  seed: number;
  groundMin: number;
  groundMax: number;
  variantKey: string | null;
  variantSource: string | null;
};

type SampleFloatReducer = "mean" | "min" | "max";

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const buildPalette = (): number[][] =>
  TILE_ID_TO_TYPE.map((tileType) => {
    const rgb = TILE_COLOR_RGB[tileType];
    return [rgb.r / 255, rgb.g / 255, rgb.b / 255];
  });

const noiseAt = (value: number): number => {
  const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
};

const pickHouseRotation = (
  tileX: number,
  tileY: number,
  cols: number,
  rows: number,
  tileTypes: Uint8Array,
  roadId: number,
  baseId: number,
  seed: number
): number => {
  const isRoadLike = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return false;
    }
    const typeId = tileTypes[y * cols + x];
    return typeId === roadId || typeId === baseId;
  };
  const roadEW = isRoadLike(tileX - 1, tileY) || isRoadLike(tileX + 1, tileY);
  const roadNS = isRoadLike(tileX, tileY - 1) || isRoadLike(tileX, tileY + 1);
  const flip = noiseAt(seed + 21.4) < 0.5 ? 0 : Math.PI;
  if (roadEW && !roadNS) {
    return flip;
  }
  if (roadNS && !roadEW) {
    return Math.PI / 2 + flip;
  }
  return noiseAt(seed + 9.1) < 0.5 ? 0 : Math.PI / 2;
};

export const buildSampleHeightMap = (
  sample: TerrainSample,
  sampleCols: number,
  sampleRows: number,
  step: number,
  waterId: number
): Float32Array => {
  const { cols, rows, elevations, tileTypes } = sample;
  const heights = new Float32Array(sampleCols * sampleRows);
  if (step <= 1) {
    let offset = 0;
    for (let row = 0; row < sampleRows; row += 1) {
      for (let col = 0; col < sampleCols; col += 1) {
        let sum = 0;
        let count = 0;
        let landSum = 0;
        let landCount = 0;
        let waterSum = 0;
        let waterCount = 0;
        let supportSum = 0;
        let supportCount = 0;
        let heightMin = Number.POSITIVE_INFINITY;
        let heightMax = Number.NEGATIVE_INFINITY;
        const contributorHeights: number[] = [];
        const landHeights: number[] = [];
        const minY = Math.max(0, row - 1);
        const maxY = Math.min(rows - 1, row);
        const minX = Math.max(0, col - 1);
        const maxX = Math.min(cols - 1, col);
        for (let y = minY; y <= maxY; y += 1) {
          const rowBase = y * cols;
          for (let x = minX; x <= maxX; x += 1) {
            const idx = rowBase + x;
            const height = elevations[idx] ?? 0;
            sum += height;
            count += 1;
            contributorHeights.push(height);
            if (height < heightMin) {
              heightMin = height;
            }
            if (height > heightMax) {
              heightMax = height;
            }
            const coastClass = sample.coastClass?.[idx] ?? COAST_CLASS_NONE;
            const seaLevel = sample.seaLevel?.[idx];
            const waterLike =
              tileTypes?.[idx] === waterId ||
              (sample.riverMask?.[idx] ?? 0) > 0 ||
              (sample.oceanMask?.[idx] ?? 0) > 0 ||
              coastClass === COAST_CLASS_SHELF_WATER ||
              (seaLevel !== undefined && Number.isFinite(seaLevel) && height <= seaLevel + 0.0015);
            if (tileTypes?.[idx] === waterId) {
              waterSum += height;
              waterCount += 1;
            }
            if (waterLike) {
              supportSum += height;
              supportCount += 1;
            } else {
              landSum += height;
              landCount += 1;
              landHeights.push(height);
            }
          }
        }
        const avg = count > 0 ? sum / count : 0;
        const contributorMedian = medianOfValues(contributorHeights);
        const heightRange =
          Number.isFinite(heightMin) && Number.isFinite(heightMax) ? Math.max(0, heightMax - heightMin) : 0;
        if (
          supportCount >= MIXED_WATER_VERTEX_MIN_COUNT &&
          landCount > 0 &&
          heightRange >= MIXED_SUPPORT_VERTEX_RANGE_THRESHOLD
        ) {
          const supportAvg = supportSum / supportCount;
          const landMedian = medianOfValues(landHeights);
          const mixedTarget = Math.min(
            avg,
            contributorMedian + MIXED_SUPPORT_VERTEX_MARGIN,
            supportAvg + (landMedian - supportAvg) * MIXED_SUPPORT_VERTEX_LAND_BLEND + MIXED_SUPPORT_VERTEX_MARGIN
          );
          heights[offset] = clamp(mixedTarget, 0, 1);
        } else if (waterCount >= MIXED_WATER_VERTEX_MIN_COUNT && landCount > 0) {
          const waterAvg = waterSum / waterCount;
          const landAvg = landSum / landCount;
          const mixedTarget =
            waterAvg + (landAvg - waterAvg) * MIXED_WATER_VERTEX_LAND_BLEND + MIXED_WATER_VERTEX_MARGIN;
          heights[offset] = clamp(Math.min(avg, mixedTarget), 0, 1);
        } else if (waterCount > 0 && landCount > 0) {
          const landAvg = landSum / landCount;
          const waterAvg = waterSum / waterCount;
          const waterBlend = clamp(waterCount / count, 0.25, 0.75);
          heights[offset] = clamp(landAvg * (1 - waterBlend) + waterAvg * waterBlend, 0, 1);
        } else {
          heights[offset] = clamp(avg, 0, 1);
        }
        offset += 1;
      }
    }
    return heights;
  }
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const idx = tileY * cols + tileX;
      const endX = Math.min(cols, tileX + step);
      const endY = Math.min(rows, tileY + step);
      let sum = 0;
      let count = 0;
      let waterCount = 0;
      let waterSum = 0;
      let coastalLandCount = 0;
      let shelfCount = 0;
      let coastalCount = 0;
      let coastalSum = 0;
      let coastalMaxHeight = 0;
      for (let y = tileY; y < endY; y += 1) {
        const rowBase = y * cols;
        for (let x = tileX; x < endX; x += 1) {
          const tileIdx = rowBase + x;
          const height = elevations[tileIdx] ?? 0;
          sum += height;
          count += 1;
          if (tileTypes && tileTypes[tileIdx] === waterId) {
            waterCount += 1;
            waterSum += height;
          }
          const coastClass = sample.coastClass?.[tileIdx] ?? COAST_CLASS_NONE;
          if (coastClass === COAST_CLASS_SHELF_WATER) {
            shelfCount += 1;
            coastalCount += 1;
            coastalSum += height;
            if (height > coastalMaxHeight) {
              coastalMaxHeight = height;
            }
          } else if (coastClass === COAST_CLASS_BEACH || coastClass === COAST_CLASS_CLIFF) {
            coastalLandCount += 1;
            coastalCount += 1;
            coastalSum += height;
            if (height > coastalMaxHeight) {
              coastalMaxHeight = height;
            }
          }
        }
      }
      const touchesWorldBorder = sampleTouchesWorldBorder(tileX, tileY, endX, endY, cols, rows);
      const waterRatio = count > 0 ? waterCount / count : 0;
      const waterThreshold = touchesWorldBorder ? EDGE_WATER_SAMPLE_RATIO : INTERIOR_WATER_SAMPLE_RATIO;
      const keepShoreAsLand = coastalLandCount > 0 && coastalLandCount >= shelfCount;
      if (tileTypes && waterRatio >= waterThreshold && !keepShoreAsLand) {
        heights[offset] = waterCount > 0 ? waterSum / waterCount : 0;
        offset += 1;
        continue;
      }
      if (coastalCount > 0) {
        const coastalAvg = coastalSum / coastalCount;
        const coastalRepresentative = coastalAvg * 0.7 + coastalMaxHeight * 0.3;
        const inlandCount = Math.max(0, count - coastalCount);
        const inlandAvg = inlandCount > 0 ? (sum - coastalSum) / inlandCount : coastalRepresentative;
        const coastalBias = coastalLandCount > 0 ? 0.72 : 0.58;
        heights[offset] = clamp(inlandAvg * (1 - coastalBias) + coastalRepresentative * coastalBias, 0, 1);
        offset += 1;
        continue;
      }
      const avg = count > 0 ? sum / count : 0;
      const nodeHeight = elevations[idx] ?? avg;
      const blended = nodeHeight * HEIGHT_SAMPLE_NODE_WEIGHT + avg * (1 - HEIGHT_SAMPLE_NODE_WEIGHT);
      heights[offset] = clamp(blended, 0, 1);
      offset += 1;
    }
  }
  return heights;
};

export const buildOceanMask = (cols: number, rows: number, tileTypes: Uint8Array, waterId: number): Uint8Array => {
  const total = cols * rows;
  const mask = new Uint8Array(total);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  const pushIfWater = (idx: number) => {
    if (mask[idx] || tileTypes[idx] !== waterId) {
      return;
    }
    mask[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };
  for (let x = 0; x < cols; x += 1) {
    pushIfWater(x);
    pushIfWater((rows - 1) * cols + x);
  }
  for (let y = 1; y < rows - 1; y += 1) {
    pushIfWater(y * cols);
    pushIfWater(y * cols + (cols - 1));
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    if (x > 0) {
      pushIfWater(idx - 1);
    }
    if (x < cols - 1) {
      pushIfWater(idx + 1);
    }
    if (y > 0) {
      pushIfWater(idx - cols);
    }
    if (y < rows - 1) {
      pushIfWater(idx + cols);
    }
  }
  return mask;
};

const suppressIsolatedHeightSamples = (
  heights: Float32Array,
  sampleCols: number,
  sampleRows: number,
  sampleTypes?: Uint8Array,
  waterId?: number
): void => {
  if (sampleCols < 3 || sampleRows < 3) {
    return;
  }
  const next = new Float32Array(heights.length);
  const neighbors = new Float32Array(8);
  for (let pass = 0; pass < HEIGHT_SAMPLE_SPIKE_PASSES; pass += 1) {
    let changed = false;
    next.set(heights);
    for (let row = 1; row < sampleRows - 1; row += 1) {
      for (let col = 1; col < sampleCols - 1; col += 1) {
        const idx = row * sampleCols + col;
        if (sampleTypes && waterId !== undefined && sampleTypes[idx] === waterId) {
          continue;
        }
        const center = heights[idx] ?? 0;
        let neighborSum = 0;
        let supportCount = 0;
        let write = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) {
              continue;
            }
            const nIdx = (row + oy) * sampleCols + (col + ox);
            const value = heights[nIdx] ?? center;
            neighbors[write] = value;
            write += 1;
            neighborSum += value;
            if (value >= center - HEIGHT_SAMPLE_SPIKE_THRESHOLD * 0.45) {
              supportCount += 1;
            }
          }
        }
        if (write !== 8) {
          continue;
        }
        for (let i = 1; i < neighbors.length; i += 1) {
          const value = neighbors[i];
          let j = i - 1;
          while (j >= 0 && neighbors[j] > value) {
            neighbors[j + 1] = neighbors[j];
            j -= 1;
          }
          neighbors[j + 1] = value;
        }
        const neighborAvg = neighborSum / 8;
        const neighborMedian = (neighbors[3] + neighbors[4]) * 0.5;
        const supportedPeak = supportCount > HEIGHT_SAMPLE_SPIKE_SUPPORTED_NEIGHBOR_MAX;
        if (
          supportedPeak ||
          center - neighborMedian <= HEIGHT_SAMPLE_SPIKE_THRESHOLD ||
          center - neighborAvg <= HEIGHT_SAMPLE_SPIKE_THRESHOLD * 0.7
        ) {
          continue;
        }
        const clamped = Math.max(neighborAvg, neighborMedian + HEIGHT_SAMPLE_SPIKE_CLAMP_MARGIN);
        if (clamped >= center) {
          continue;
        }
        next[idx] = clamped;
        changed = true;
      }
    }
    heights.set(next);
    if (!changed) {
      break;
    }
  }
};

export const computeWaterLevel = (
  sample: TerrainSample,
  waterId: number,
  oceanMask?: Uint8Array | null,
  riverMask?: Uint8Array | null
): number | null => {
  const tileTypes = sample.tileTypes;
  if (!tileTypes) {
    return null;
  }
  const { elevations } = sample;
  const bins = 32;
  const counts = new Uint32Array(bins);
  const sums = new Float32Array(bins);
  let total = 0;
  for (let i = 0; i < elevations.length; i += 1) {
    if (tileTypes[i] !== waterId || (oceanMask && !oceanMask[i]) || (riverMask && riverMask[i])) {
      continue;
    }
    const height = clamp(elevations[i] ?? 0, 0, 1);
    const bin = Math.min(bins - 1, Math.floor(height * (bins - 1)));
    counts[bin] += 1;
    sums[bin] += height;
    total += 1;
  }
  if (total === 0) {
    return null;
  }
  if (total < 8) {
    const sum = sums.reduce((acc, value) => acc + value, 0);
    return sum / total;
  }
  const target = Math.max(1, Math.ceil(total * 0.25));
  let taken = 0;
  let sum = 0;
  let count = 0;
  for (let bin = bins - 1; bin >= 0; bin -= 1) {
    const binCount = counts[bin];
    if (binCount === 0) {
      continue;
    }
    const take = Math.min(binCount, target - taken);
    const avg = sums[bin] / binCount;
    sum += avg * take;
    count += take;
    taken += take;
    if (taken >= target) {
      break;
    }
  }
  return count > 0 ? sum / count : null;
};

export const buildSampleTypeMap = (
  sample: TerrainSample,
  sampleCols: number,
  sampleRows: number,
  step: number,
  grassId: number,
  waterId: number,
  typeCount: number,
  priorityIds: number[]
): Uint8Array => {
  const { cols, rows, tileTypes } = sample;
  const types = new Uint8Array(sampleCols * sampleRows);
  const counts = new Uint16Array(typeCount);
  const priorityRank = new Int16Array(typeCount);
  priorityRank.fill(-1);
  priorityIds.forEach((id, index) => {
    if (id >= 0 && id < typeCount) {
      priorityRank[id] = index;
    }
  });
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const endX = Math.min(cols, tileX + step);
      const endY = Math.min(rows, tileY + step);
      counts.fill(0);
      let maxType = grassId;
      let maxCount = 0;
      let waterCount = 0;
      let total = 0;
      let priorityType = -1;
      let priorityScore = Number.POSITIVE_INFINITY;
      for (let y = tileY; y < endY; y += 1) {
        const rowBase = y * cols;
        for (let x = tileX; x < endX; x += 1) {
          const idx = rowBase + x;
          const typeId = tileTypes ? tileTypes[idx] ?? grassId : grassId;
          const nextCount = (counts[typeId] += 1);
          if (nextCount > maxCount) {
            maxCount = nextCount;
            maxType = typeId;
          }
          const rank = priorityRank[typeId];
          if (rank >= 0 && rank < priorityScore) {
            priorityScore = rank;
            priorityType = typeId;
          }
          total += 1;
          if (typeId === waterId) {
            waterCount += 1;
          }
        }
      }
      if (total > 0 && waterCount === total) {
        types[offset] = waterId;
      } else if (priorityType >= 0) {
        types[offset] = priorityType;
      } else {
        const touchesWorldBorder = sampleTouchesWorldBorder(tileX, tileY, endX, endY, cols, rows);
        const waterRatio = total > 0 ? waterCount / total : 0;
        const waterThreshold = touchesWorldBorder ? EDGE_WATER_SAMPLE_RATIO : INTERIOR_WATER_SAMPLE_RATIO;
        if (waterRatio >= waterThreshold) {
          types[offset] = waterId;
        } else {
          types[offset] = maxType;
        }
      }
      offset += 1;
    }
  }
  return types;
};

const createDataTexture = (
  data: Uint8Array,
  width: number,
  height: number,
  magFilter: THREE.MagnificationTextureFilter,
  minFilter: THREE.MinificationTextureFilter
): THREE.DataTexture => {
  const flipped = new Uint8Array(data.length);
  const rowStride = width * 4;
  for (let y = 0; y < height; y += 1) {
    const src = y * rowStride;
    const dst = (height - 1 - y) * rowStride;
    flipped.set(data.subarray(src, src + rowStride), dst);
  }
  const texture = new THREE.DataTexture(flipped, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = magFilter;
  texture.minFilter = minFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  return texture;
};

const buildSampleWaterRatios = (
  sample: TerrainSample,
  sampleCols: number,
  sampleRows: number,
  step: number,
  waterId: number,
  oceanMask?: Uint8Array | null,
  riverMask?: Uint8Array | null
): WaterSampleRatios => {
  const { cols, rows, tileTypes } = sample;
  const total = sampleCols * sampleRows;
  const water = new Float32Array(total);
  const ocean = new Float32Array(total);
  const river = new Float32Array(total);
  if (!tileTypes || cols <= 0 || rows <= 0) {
    return { water, ocean, river };
  }
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const endX = Math.min(cols, tileX + step);
      const endY = Math.min(rows, tileY + step);
      let waterCount = 0;
      let oceanCount = 0;
      let riverCount = 0;
      let count = 0;
      for (let y = tileY; y < endY; y += 1) {
        const rowBase = y * cols;
        for (let x = tileX; x < endX; x += 1) {
          const idx = rowBase + x;
          count += 1;
          if (tileTypes[idx] !== waterId) {
            continue;
          }
          waterCount += 1;
          if (riverMask && riverMask[idx]) {
            riverCount += 1;
            continue;
          }
          if (!oceanMask || oceanMask[idx]) {
            oceanCount += 1;
          }
        }
      }
      const inv = count > 0 ? 1 / count : 0;
      let waterRatio = waterCount * inv;
      let oceanRatio = oceanCount * inv;
      let riverRatio = riverCount * inv;
      if (oceanCount > 0) {
        oceanRatio = Math.max(oceanRatio, OCEAN_SAMPLE_SUPPORT_FLOOR);
        // Keep ocean cells from collapsing during downsample while avoiding
        // blanket widening of inland rivers.
        waterRatio = Math.max(waterRatio, oceanRatio);
      }
      water[offset] = clamp(waterRatio, 0, 1);
      ocean[offset] = clamp(oceanRatio, 0, 1);
      river[offset] = clamp(riverRatio, 0, 1);
      offset += 1;
    }
  }
  return { water, ocean, river };
};

const buildSampleOptionalFloatMap = (
  sample: TerrainSample,
  source: Float32Array | undefined,
  sampleCols: number,
  sampleRows: number,
  step: number,
  includeMask?: Uint8Array | null,
  reducer: SampleFloatReducer = "mean"
): Float32Array | undefined => {
  const { cols, rows } = sample;
  if (!source || source.length !== cols * rows || cols <= 0 || rows <= 0) {
    return undefined;
  }
  const sampled = new Float32Array(sampleCols * sampleRows).fill(Number.NaN);
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const endX = Math.min(cols, tileX + step);
      const endY = Math.min(rows, tileY + step);
      let acc = reducer === "min" ? Number.POSITIVE_INFINITY : reducer === "max" ? Number.NEGATIVE_INFINITY : 0;
      let count = 0;
      for (let y = tileY; y < endY; y += 1) {
        const rowBase = y * cols;
        for (let x = tileX; x < endX; x += 1) {
          const idx = rowBase + x;
          if (includeMask && !includeMask[idx]) {
            continue;
          }
          const value = source[idx];
          if (!Number.isFinite(value)) {
            continue;
          }
          if (reducer === "min") {
            acc = Math.min(acc, value);
          } else if (reducer === "max") {
            acc = Math.max(acc, value);
          } else {
            acc += value;
          }
          count += 1;
        }
      }
      if (count > 0) {
        sampled[offset] = reducer === "mean" ? acc / count : acc;
      }
      offset += 1;
    }
  }
  return sampled;
};

const buildSampleMaskCoverage = (
  sample: TerrainSample,
  sourceMask: Uint8Array | undefined,
  sampleCols: number,
  sampleRows: number,
  step: number
): Float32Array | undefined => {
  const { cols, rows } = sample;
  if (!sourceMask || sourceMask.length !== cols * rows || cols <= 0 || rows <= 0) {
    return undefined;
  }
  const sampled = new Float32Array(sampleCols * sampleRows);
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const endX = Math.min(cols, tileX + step);
      const endY = Math.min(rows, tileY + step);
      let count = 0;
      let support = 0;
      for (let y = tileY; y < endY; y += 1) {
        const rowBase = y * cols;
        for (let x = tileX; x < endX; x += 1) {
          count += 1;
          if (sourceMask[rowBase + x] > 0) {
            support += 1;
          }
        }
      }
      sampled[offset] = count > 0 ? support / count : 0;
      offset += 1;
    }
  }
  return sampled;
};

export type SampledCoastData = {
  oceanCoverage?: Float32Array;
  seaLevel?: Float32Array;
  coastDistance?: Uint16Array;
  coastClass?: Uint8Array;
  beachWeight?: Float32Array;
  cliffWeight?: Float32Array;
  shelfWeight?: Float32Array;
};

export type TerrainRenderSurface = {
  sample: TerrainSample;
  cols: number;
  rows: number;
  step: number;
  sampleCols: number;
  sampleRows: number;
  width: number;
  depth: number;
  size: { width: number; depth: number };
  heightScale: number;
  sampleHeights: Float32Array;
  rawSampleHeights?: Float32Array;
  finalSampleHeights?: Float32Array;
  sampleTypes: Uint8Array;
  coastData: SampledCoastData;
  sampleOceanCoverage?: Float32Array;
  sampleCoastDistance?: Uint16Array;
  sampleCoastClass?: Uint8Array;
  oceanMask: Uint8Array | null;
  riverMask: Uint8Array | null;
  waterLevel: number | null;
  waterRatios: WaterSampleRatios;
  waterSupportMask: Uint8Array;
  waterSurfaceHeights: Float32Array;
  oceanRenderRatios?: WaterSampleRatios;
  oceanSupportMask?: Uint8Array;
  oceanSurfAttenuation?: Float32Array;
  shoreTransition?: ShoreTransitionData;
  sampledErosionWear?: Float32Array;
  sampledRiverSurface?: Float32Array;
  sampledRiverStepStrength?: Float32Array;
  sampledRiverCoverage?: Float32Array;
  riverRenderDomain?: RiverRenderDomain;
  structureTopHeightsWorld?: Float32Array;
  debugHeightAnomalies?: TerrainHeightAnomaly[];
  getHeightProvenance?: (tileX: number, tileY: number) => TerrainHeightProvenance | null;
  heightAtSample: (x: number, y: number) => number;
  heightAtTileCoord: (tileX: number, tileY: number) => number;
  heightAtTile: (tileX: number, tileY: number) => number;
  obstructionHeightAtTileCoordWorld?: (tileX: number, tileY: number) => number;
  toWorldX: (tileX: number) => number;
  toWorldZ: (tileY: number) => number;
};

const buildSampleCoastData = (
  sample: TerrainSample,
  sampleCols: number,
  sampleRows: number,
  step: number
): SampledCoastData => {
  const total = sampleCols * sampleRows;
  const oceanCoverage = buildSampleMaskCoverage(sample, sample.oceanMask, sampleCols, sampleRows, step);
  const seaLevel = buildSampleOptionalFloatMap(sample, sample.seaLevel, sampleCols, sampleRows, step, null, "mean");
  const coastDistance = new Uint16Array(total);
  const beachWeight = new Float32Array(total);
  const cliffWeight = new Float32Array(total);
  const shelfWeight = new Float32Array(total);
  const coastClass = new Uint8Array(total);
  if (
    !sample.coastClass ||
    sample.coastClass.length !== sample.cols * sample.rows ||
    !sample.coastDistance ||
    sample.coastDistance.length !== sample.cols * sample.rows
  ) {
    return { oceanCoverage, seaLevel, coastDistance, coastClass, beachWeight, cliffWeight, shelfWeight };
  }
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(sample.rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(sample.cols - 1, col * step);
      const endX = Math.min(sample.cols, tileX + step);
      const endY = Math.min(sample.rows, tileY + step);
      let count = 0;
      let beach = 0;
      let cliff = 0;
      let shelf = 0;
      let beachDistanceSum = 0;
      let cliffDistanceSum = 0;
      let shelfDistanceSum = 0;
      for (let y = tileY; y < endY; y += 1) {
        const rowBase = y * sample.cols;
        for (let x = tileX; x < endX; x += 1) {
          count += 1;
          const idx = rowBase + x;
          const klass = sample.coastClass[idx] ?? COAST_CLASS_NONE;
          const distance = sample.coastDistance[idx] ?? 0;
          if (klass === COAST_CLASS_BEACH) {
            beach += 1;
            beachDistanceSum += distance;
          } else if (klass === COAST_CLASS_CLIFF) {
            cliff += 1;
            cliffDistanceSum += distance;
          } else if (klass === COAST_CLASS_SHELF_WATER) {
            shelf += 1;
            shelfDistanceSum += distance;
          }
        }
      }
      const inv = count > 0 ? 1 / count : 0;
      beachWeight[offset] = beach * inv;
      cliffWeight[offset] = cliff * inv;
      shelfWeight[offset] = shelf * inv;
      if (shelfWeight[offset] >= COAST_SAMPLE_SHELF_DOMINANCE_MIN) {
        coastClass[offset] = COAST_CLASS_SHELF_WATER;
        coastDistance[offset] = Math.max(1, Math.round(shelfDistanceSum / Math.max(1, shelf)));
      } else if (
        beachWeight[offset] >= COAST_SAMPLE_LAND_DOMINANCE_MIN &&
        beachWeight[offset] >= cliffWeight[offset]
      ) {
        coastClass[offset] = COAST_CLASS_BEACH;
        coastDistance[offset] = Math.max(1, Math.round(beachDistanceSum / Math.max(1, beach)));
      } else if (cliffWeight[offset] >= COAST_SAMPLE_LAND_DOMINANCE_MIN) {
        coastClass[offset] = COAST_CLASS_CLIFF;
        coastDistance[offset] = Math.max(1, Math.round(cliffDistanceSum / Math.max(1, cliff)));
      } else {
        coastClass[offset] = COAST_CLASS_NONE;
        coastDistance[offset] = 0;
      }
      offset += 1;
    }
  }
  return { oceanCoverage, seaLevel, coastDistance, coastClass, beachWeight, cliffWeight, shelfWeight };
};

const buildWaterMaskTexture = (
  sampleCols: number,
  sampleRows: number,
  ratios: WaterSampleRatios
): THREE.DataTexture => {
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  for (let i = 0; i < ratios.water.length; i += 1) {
    const ratio = clamp(ratios.water[i] ?? 0, 0, 1);
    const ramp = clamp((ratio - WATER_ALPHA_MIN_RATIO) / (1 - WATER_ALPHA_MIN_RATIO), 0, 1);
    const alpha = Math.round(Math.pow(ramp, WATER_ALPHA_POWER) * 255);
    const base = i * 4;
    data[base] = 255;
    data[base + 1] = 255;
    data[base + 2] = 255;
    data[base + 3] = alpha;
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};

const buildWaterSupportMask = (
  waterRatios: WaterSampleRatios,
  oceanSupportMask: Uint8Array,
  sampledRiverCoverage?: Float32Array
): Uint8Array => {
  const support = new Uint8Array(oceanSupportMask.length);
  for (let i = 0; i < oceanSupportMask.length; i += 1) {
    const riverCoverage = sampledRiverCoverage?.[i] ?? 0;
    const riverRatio = waterRatios.river[i] ?? 0;
    const riverBacked =
      riverCoverage >= RIVER_RENDER_SUPPORT_RATIO_MIN || riverRatio >= RIVER_RATIO_MIN * 0.5;
    support[i] = oceanSupportMask[i] > 0 || riverBacked ? 1 : 0;
  }
  return support;
};

const buildWaterDomainMapTexture = (
  sampleCols: number,
  sampleRows: number,
  ratios: WaterSampleRatios,
  surfAttenuation?: Float32Array | null,
  shoreTerrainHeightAboveWater?: Float32Array | null
): THREE.DataTexture => {
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  for (let i = 0; i < ratios.water.length; i += 1) {
    const waterRatio = clamp(ratios.water[i] ?? 0, 0, 1);
    const oceanRatio = clamp(ratios.ocean[i] ?? 0, 0, waterRatio);
    const ramp = clamp((waterRatio - WATER_ALPHA_MIN_RATIO) / (1 - WATER_ALPHA_MIN_RATIO), 0, 1);
    const alpha = Math.round(Math.pow(ramp, WATER_ALPHA_POWER) * 255);
    const base = i * 4;
    data[base] = Math.round(oceanRatio * 255);
    data[base + 1] = Math.round(clamp((shoreTerrainHeightAboveWater?.[i] ?? 0) / 10, 0, 1) * 255);
    data[base + 2] = Math.round(waterRatio * 255);
    data[base + 3] = surfAttenuation ? Math.round(clamp(surfAttenuation[i] ?? 0, 0, 1) * 255) : alpha;
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};

const buildShoreSdfTextureFromSupportMask = (
  supportMask: Uint8Array,
  sampleCols: number,
  sampleRows: number
): THREE.DataTexture => {
  const distToWater = buildDistanceField(supportMask, sampleCols, sampleRows, 1);
  const distToLand = buildDistanceField(supportMask, sampleCols, sampleRows, 0);
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  for (let i = 0; i < supportMask.length; i += 1) {
    const isWater = supportMask[i] > 0;
    const waterDist = distToWater[i] >= 0 ? distToWater[i] : SHORE_SDF_MAX_DISTANCE;
    const landDist = distToLand[i] >= 0 ? distToLand[i] : SHORE_SDF_MAX_DISTANCE;
    const signed = isWater ? landDist : -waterDist;
    const normalized = clamp(signed / SHORE_SDF_MAX_DISTANCE, -1, 1);
    const encoded = Math.round((normalized * 0.5 + 0.5) * 255);
    const base = i * 4;
    data[base] = encoded;
    data[base + 1] = encoded;
    data[base + 2] = encoded;
    data[base + 3] = 255;
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};

type OceanRenderSupportData = {
  oceanRatios: WaterSampleRatios;
  oceanSupportMask: Uint8Array;
  surfAttenuation: Float32Array;
};

const buildOceanRenderSupportData = (
  cols: number,
  rows: number,
  sampleCols: number,
  sampleRows: number,
  step: number,
  sampleTypes: Uint8Array,
  waterId: number,
  ratios: WaterSampleRatios,
  sampleOceanCoverage: Float32Array | undefined,
  sampleCoastClass: Uint8Array | undefined,
  sampleCoastDistance: Uint16Array | undefined,
  coastData: SampledCoastData
): OceanRenderSupportData => {
  const total = sampleCols * sampleRows;
  const oceanSupportMask = new Uint8Array(total);
  const oceanRatios: WaterSampleRatios = {
    water: new Float32Array(total),
    ocean: new Float32Array(total),
    river: new Float32Array(total)
  };
  const surfAttenuation = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const sampleX = i % sampleCols;
    const sampleY = Math.floor(i / sampleCols);
    const worldBorderDistance = Math.min(
      sampleX,
      sampleY,
      Math.max(0, sampleCols - 1 - sampleX),
      Math.max(0, sampleRows - 1 - sampleY)
    );
    const tileX = Math.min(cols - 1, sampleX * step);
    const tileY = Math.min(rows - 1, sampleY * step);
    const endX = Math.min(cols, tileX + step);
    const endY = Math.min(rows, tileY + step);
    const touchesWorldBorder = sampleTouchesWorldBorder(tileX, tileY, endX, endY, cols, rows);
    const ocean = clamp(sampleOceanCoverage?.[i] ?? ratios.ocean[i] ?? 0, 0, 1);
    const coastClass = sampleCoastClass?.[i] ?? COAST_CLASS_NONE;
    const coastDistance = sampleCoastDistance?.[i] ?? 0;
    const bandT = coastDistance > 0
      ? clamp(1 - (coastDistance - 1) / COAST_SAMPLE_BEACH_WET_DEPTHS.length, 0, 1)
      : 0;
    const beachInfluence = clamp(
      (coastData.beachWeight?.[i] ?? 0) + (coastData.shelfWeight?.[i] ?? 0) + (coastClass === COAST_CLASS_SHELF_WATER ? 0.65 : 0),
      0,
      1
    );
    const cliffInfluence = clamp(coastData.cliffWeight?.[i] ?? 0, 0, 1);
    const borderOpenOcean =
      touchesWorldBorder &&
      ocean >= OCEAN_RATIO_MIN &&
      coastDistance > OCEAN_BORDER_OPEN_WATER_DISTANCE_MIN;
    const borderBlendOpenOcean =
      worldBorderDistance <= 1 &&
      ocean >= OCEAN_RATIO_MIN &&
      coastDistance > OCEAN_SURFACE_SHORE_CLIP_BAND;
    if (borderBlendOpenOcean) {
      oceanRatios.water[i] = 1;
      oceanRatios.ocean[i] = 1;
      oceanSupportMask[i] = 1;
      surfAttenuation[i] = 0;
      continue;
    }
    oceanRatios.water[i] = ocean;
    oceanRatios.ocean[i] = ocean;
    if (borderOpenOcean) {
      oceanSupportMask[i] = 1;
      surfAttenuation[i] = 0;
      continue;
    }
    oceanSupportMask[i] =
      ((coastClass === COAST_CLASS_SHELF_WATER || sampleTypes[i] === waterId) && ocean >= OCEAN_RATIO_MIN)
        ? 1
        : 0;
    surfAttenuation[i] = clamp(
      bandT * Math.max(beachInfluence * OCEAN_BEACH_WAVE_DAMP_MAX, cliffInfluence * OCEAN_CLIFF_WAVE_DAMP_MAX),
      0,
      1
    );
  }
  return { oceanRatios, oceanSupportMask, surfAttenuation };
};

const buildRiverCutoutAlphaMap = (
  riverDomain: RiverRenderDomain | undefined
): THREE.DataTexture | undefined => {
  if (!riverDomain) {
    return undefined;
  }
  const cols = riverDomain.cols;
  const rows = riverDomain.rows;
  if (cols <= 0 || rows <= 0) {
    return undefined;
  }
  const texCols = Math.max(256, Math.min(4096, cols * 8));
  const texRows = Math.max(256, Math.min(4096, rows * 8));
  const inside = new Uint8Array(texCols * texRows);
  const vertices = riverDomain.contourVertices;
  const indices = riverDomain.contourIndices;
  const toTexX = (x: number): number => (x / Math.max(1, cols)) * texCols;
  const toTexY = (y: number): number => (y / Math.max(1, rows)) * texRows;
  const edgeFn = (ax: number, ay: number, bx: number, by: number, px: number, py: number): number => {
    return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
  };

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i] * 2;
    const i1 = indices[i + 1] * 2;
    const i2 = indices[i + 2] * 2;
    if (i2 + 1 >= vertices.length) {
      continue;
    }
    const ax = toTexX(vertices[i0]);
    const ay = toTexY(vertices[i0 + 1]);
    const bx = toTexX(vertices[i1]);
    const by = toTexY(vertices[i1 + 1]);
    const cx = toTexX(vertices[i2]);
    const cy = toTexY(vertices[i2 + 1]);
    const minX = clamp(Math.floor(Math.min(ax, bx, cx)) - 1, 0, texCols - 1);
    const maxX = clamp(Math.ceil(Math.max(ax, bx, cx)) + 1, 0, texCols - 1);
    const minY = clamp(Math.floor(Math.min(ay, by, cy)) - 1, 0, texRows - 1);
    const maxY = clamp(Math.ceil(Math.max(ay, by, cy)) + 1, 0, texRows - 1);
    for (let y = minY; y <= maxY; y += 1) {
      const py = y + 0.5;
      const rowBase = y * texCols;
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const e0 = edgeFn(ax, ay, bx, by, px, py);
        const e1 = edgeFn(bx, by, cx, cy, px, py);
        const e2 = edgeFn(cx, cy, ax, ay, px, py);
        const insideTri = (e0 >= -1e-5 && e1 >= -1e-5 && e2 >= -1e-5) || (e0 <= 1e-5 && e1 <= 1e-5 && e2 <= 1e-5);
        if (insideTri) {
          inside[rowBase + x] = 1;
        }
      }
    }
  }

  const data = new Uint8Array(texCols * texRows * 4);
  for (let i = 0; i < inside.length; i += 1) {
    const encoded = inside[i] ? 0 : 255;
    const base = i * 4;
    data[base] = encoded;
    data[base + 1] = encoded;
    data[base + 2] = encoded;
    data[base + 3] = 255;
  }
  return createDataTexture(data, texCols, texRows, THREE.LinearFilter, THREE.LinearFilter);
};

const applyRiverTerrainTriangleCutout = (
  geometry: THREE.BufferGeometry,
  sampleCols: number,
  sampleRows: number,
  riverDomain: RiverRenderDomain | undefined
): void => {
  if (!riverDomain || sampleCols < 2 || sampleRows < 2) {
    return;
  }
  riverDomain.cutoutBoundaryVertexHeights = undefined;
  riverDomain.cutoutBoundaryWallEdges = undefined;
  const index = geometry.getIndex();
  if (!index) {
    return;
  }
  const positionAttr = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!positionAttr) {
    return;
  }
  const uvAttr = geometry.getAttribute("uv") as THREE.BufferAttribute | undefined;
  const src = index.array as ArrayLike<number>;
  const vertexCount = sampleCols * sampleRows;
  const positions = positionAttr.array as ArrayLike<number>;
  const uvs = uvAttr?.array as ArrayLike<number> | undefined;
  let minWorldX = Number.POSITIVE_INFINITY;
  let maxWorldX = Number.NEGATIVE_INFINITY;
  let minWorldZ = Number.POSITIVE_INFINITY;
  let maxWorldZ = Number.NEGATIVE_INFINITY;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const px = positions[i] as number;
    const pz = positions[i + 2] as number;
    if (px < minWorldX) minWorldX = px;
    if (px > maxWorldX) maxWorldX = px;
    if (pz < minWorldZ) minWorldZ = pz;
    if (pz > maxWorldZ) maxWorldZ = pz;
  }
  const worldWidth = Number.isFinite(minWorldX) && Number.isFinite(maxWorldX) ? Math.max(1e-5, maxWorldX - minWorldX) : 1;
  const worldDepth = Number.isFinite(minWorldZ) && Number.isFinite(maxWorldZ) ? Math.max(1e-5, maxWorldZ - minWorldZ) : 1;
  const worldTransform = createRiverSpaceTransform(
    riverDomain.cols,
    riverDomain.rows,
    worldWidth,
    worldDepth,
    sampleCols,
    sampleRows
  );
  const contourIndices = Array.from(riverDomain.contourIndices);
  const snappedContourVertices = buildSnappedRiverContourVertices(riverDomain, contourIndices);
  const snappedBoundaryEdges = buildBoundaryEdgesFromIndexedContour(snappedContourVertices, contourIndices);
  const clipBoundaryEdges = snappedBoundaryEdges.length >= 4 ? snappedBoundaryEdges : riverDomain.boundaryEdges;
  const vf = riverDomain.vertexField;
  const vfCols = riverDomain.cols + 1;
  const vIdx = (x: number, y: number): number => y * vfCols + x;
  const sampleFieldRaw = (xEdge: number, yEdge: number): number => {
    const x = clamp(xEdge, 0, riverDomain.cols);
    const y = clamp(yEdge, 0, riverDomain.rows);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(riverDomain.cols, x0 + 1);
    const y1 = Math.min(riverDomain.rows, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const s00 = vf[vIdx(x0, y0)] ?? 0;
    const s10 = vf[vIdx(x1, y0)] ?? s00;
    const s01 = vf[vIdx(x0, y1)] ?? s00;
    const s11 = vf[vIdx(x1, y1)] ?? s10;
    const sx0 = s00 * (1 - tx) + s10 * tx;
    const sx1 = s01 * (1 - tx) + s11 * tx;
    return sx0 * (1 - ty) + sx1 * ty;
  };
  const sampleField = (xEdge: number, yEdge: number): number => {
    let value = sampleFieldRaw(xEdge, yEdge);
    const r = RIVER_CUTOUT_FIELD_DILATE;
    if (r <= 1e-6) {
      return value;
    }
    const offsets = [
      [r, 0], [-r, 0], [0, r], [0, -r],
      [r * 0.7, r * 0.7], [-r * 0.7, r * 0.7], [r * 0.7, -r * 0.7], [-r * 0.7, -r * 0.7]
    ];
    for (let i = 0; i < offsets.length; i += 1) {
      const o = offsets[i];
      value = Math.max(value, sampleFieldRaw(xEdge + o[0], yEdge + o[1]));
    }
    return value;
  };
  const transform = createRiverSpaceTransform(riverDomain.cols, riverDomain.rows, 1, 1, sampleCols, sampleRows);
  const toEdgeX = (gridX: number): number => transform.gridToEdgeX(gridX);
  const toEdgeY = (gridY: number): number => transform.gridToEdgeY(gridY);
  type CutVertex = {
    x: number;
    y: number;
    z: number;
    u: number;
    v: number;
    ex: number;
    ey: number;
    s: number;
    boundary: boolean;
  };
  const threshold = RIVER_FIELD_THRESHOLD;
  const eps = 1e-6;
  const makeVertex = (vertexIndex: number): CutVertex | null => {
    if (vertexIndex < 0 || vertexIndex >= vertexCount) {
      return null;
    }
    const gridX = vertexIndex % sampleCols;
    const gridY = Math.floor(vertexIndex / sampleCols);
    const ex = toEdgeX(gridX);
    const ey = toEdgeY(gridY);
    const posBase = vertexIndex * 3;
    if (posBase + 2 >= positions.length) {
      return null;
    }
    const uvBase = vertexIndex * 2;
    return {
      x: positions[posBase],
      y: positions[posBase + 1],
      z: positions[posBase + 2],
      u: uvs && uvBase + 1 < uvs.length ? uvs[uvBase] : 0,
      v: uvs && uvBase + 1 < uvs.length ? uvs[uvBase + 1] : 0,
      ex,
      ey,
      s: sampleField(ex, ey),
      boundary: false
    };
  };
  const interpolate = (a: CutVertex, b: CutVertex): CutVertex => {
    const delta = b.s - a.s;
    const estimateT = Math.abs(delta) <= eps ? 0.5 : clamp((threshold - a.s) / delta, 0, 1);
    const segX = b.ex - a.ex;
    const segY = b.ey - a.ey;
    const segLenSq = segX * segX + segY * segY;
    let t = estimateT;
    let ex = a.ex + segX * t;
    let ey = a.ey + segY * t;
    if (segLenSq > 1e-10 && clipBoundaryEdges.length >= 4) {
      let bestScore = Number.POSITIVE_INFINITY;
      let bestT = t;
      let bestX = ex;
      let bestY = ey;
      const cross2 = (ax: number, ay: number, bx: number, by: number): number => ax * by - ay * bx;
      for (let e = 0; e < clipBoundaryEdges.length; e += 4) {
        const cx = clipBoundaryEdges[e];
        const cy = clipBoundaryEdges[e + 1];
        const dx = clipBoundaryEdges[e + 2];
        const dy = clipBoundaryEdges[e + 3];
        const edgeX = dx - cx;
        const edgeY = dy - cy;
        const denom = cross2(segX, segY, edgeX, edgeY);
        if (Math.abs(denom) <= 1e-9) {
          continue;
        }
        const relX = cx - a.ex;
        const relY = cy - a.ey;
        const hitT = cross2(relX, relY, edgeX, edgeY) / denom;
        const hitU = cross2(relX, relY, segX, segY) / denom;
        if (hitT < -1e-6 || hitT > 1 + 1e-6 || hitU < -1e-6 || hitU > 1 + 1e-6) {
          continue;
        }
        const clampedT = clamp(hitT, 0, 1);
        const hx = a.ex + segX * clampedT;
        const hy = a.ey + segY * clampedT;
        const score = Math.abs(clampedT - estimateT);
        if (score < bestScore) {
          bestScore = score;
          bestT = clampedT;
          bestX = hx;
          bestY = hy;
          if (bestScore <= 1e-4) {
            break;
          }
        }
      }
      if (Number.isFinite(bestScore)) {
        t = bestT;
        ex = bestX;
        ey = bestY;
      }
    }
    return {
      x: worldTransform.edgeToWorldX(ex),
      y: a.y + (b.y - a.y) * t,
      z: worldTransform.edgeToWorldY(ey),
      u: a.u + (b.u - a.u) * t,
      v: a.v + (b.v - a.v) * t,
      ex,
      ey,
      s: threshold,
      boundary: true
    };
  };
  const clipTriangle = (a: CutVertex, b: CutVertex, c: CutVertex): CutVertex[] => {
    let poly: CutVertex[] = [a, b, c];
    const output: CutVertex[] = [];
    let prev = poly[poly.length - 1];
    let prevInside = prev.s < threshold;
    for (let i = 0; i < poly.length; i += 1) {
      const cur = poly[i];
      const curInside = cur.s < threshold;
      if (curInside !== prevInside) {
        output.push(interpolate(prev, cur));
      }
      if (curInside) {
        output.push(cur);
      }
      prev = cur;
      prevInside = curInside;
    }
    return output;
  };

  const outPositions: number[] = [];
  const outUvs: number[] = [];
  type BoundarySegment = { ax: number; ay: number; az: number; bx: number; by: number; bz: number };
  const boundarySegments: BoundarySegment[] = [];
  const boundaryEdgeMap = new Map<string, { count: number; ax: number; ay: number; az: number; bx: number; by: number; bz: number; boundary: boolean }>();
  const boundaryQuant = 8192;
  const boundaryVertexKey = (v: CutVertex): string => `${Math.round(v.ex * boundaryQuant)},${Math.round(v.ey * boundaryQuant)}`;
  const directBoundaryVertexHeightByKey = new Map<string, number>();
  const registerBoundaryVertexHeight = (v: CutVertex): void => {
    if (!v.boundary) {
      return;
    }
    const key = boundaryVertexKey(v);
    const existing = directBoundaryVertexHeightByKey.get(key);
    if (existing === undefined || v.y > existing) {
      directBoundaryVertexHeightByKey.set(key, v.y);
    }
  };
  const registerBoundaryEdge = (a: CutVertex, b: CutVertex): void => {
    const keyA = boundaryVertexKey(a);
    const keyB = boundaryVertexKey(b);
    if (keyA === keyB) {
      return;
    }
    const forward = keyA < keyB;
    const edgeKey = forward ? `${keyA}|${keyB}` : `${keyB}|${keyA}`;
    const ax = forward ? a.ex : b.ex;
    const ay = forward ? a.ey : b.ey;
    const az = forward ? a.y : b.y;
    const bx = forward ? b.ex : a.ex;
    const by = forward ? b.ey : a.ey;
    const bz = forward ? b.y : a.y;
    const boundary = a.boundary && b.boundary;
    const existing = boundaryEdgeMap.get(edgeKey);
    if (!existing) {
      boundaryEdgeMap.set(edgeKey, { count: 1, ax, ay, az, bx, by, bz, boundary });
      return;
    }
    existing.count += 1;
    existing.boundary = existing.boundary || boundary;
    if (boundary) {
      if (az > existing.az) {
        existing.az = az;
      }
      if (bz > existing.bz) {
        existing.bz = bz;
      }
    }
  };
  const registerBoundarySegment = (a: CutVertex, b: CutVertex): void => {
    if (!a.boundary || !b.boundary) {
      return;
    }
    registerBoundaryVertexHeight(a);
    registerBoundaryVertexHeight(b);
    const dx = b.ex - a.ex;
    const dy = b.ey - a.ey;
    if (dx * dx + dy * dy <= 1e-10) {
      return;
    }
    boundarySegments.push({
      ax: a.ex,
      ay: a.ey,
      az: a.y,
      bx: b.ex,
      by: b.ey,
      bz: b.y
    });
  };
  const triCount = Math.floor(src.length / 3);
  let cutCount = 0;
  for (let i = 0; i < src.length; i += 3) {
    const ia = src[i] as number;
    const ib = src[i + 1] as number;
    const ic = src[i + 2] as number;
    if (
      ia < 0 ||
      ib < 0 ||
      ic < 0 ||
      ia >= vertexCount ||
      ib >= vertexCount ||
      ic >= vertexCount
    ) {
      continue;
    }
    const a = makeVertex(ia);
    const b = makeVertex(ib);
    const c = makeVertex(ic);
    if (!a || !b || !c) {
      continue;
    }
    const clipped = clipTriangle(a, b, c);
    if (clipped.length < 3) {
      cutCount += 1;
      continue;
    }
    const changed = clipped.length !== 3 || clipped.some((v) => v.boundary);
    if (changed) {
      cutCount += 1;
    }
    for (let e = 0; e < clipped.length; e += 1) {
      const vA = clipped[e];
      const vB = clipped[(e + 1) % clipped.length];
      registerBoundarySegment(vA, vB);
    }
    const base = clipped[0];
    for (let t = 1; t < clipped.length - 1; t += 1) {
      let p1 = clipped[t];
      let p2 = clipped[t + 1];
      const e1x = p1.x - base.x;
      const e1y = p1.y - base.y;
      const e1z = p1.z - base.z;
      const e2x = p2.x - base.x;
      const e2y = p2.y - base.y;
      const e2z = p2.z - base.z;
      const nx = e1y * e2z - e1z * e2y;
      const ny = e1z * e2x - e1x * e2z;
      const nz = e1x * e2y - e1y * e2x;
      if (Math.hypot(nx, ny, nz) <= 1e-9) {
        continue;
      }
      if (ny < 0) {
        const swap = p1;
        p1 = p2;
        p2 = swap;
      }
      outPositions.push(
        base.x, base.y, base.z,
        p1.x, p1.y, p1.z,
        p2.x, p2.y, p2.z
      );
      outUvs.push(
        base.u, base.v,
        p1.u, p1.v,
        p2.u, p2.v
      );
      registerBoundaryEdge(base, p1);
      registerBoundaryEdge(p1, p2);
      registerBoundaryEdge(p2, base);
    }
  }
  const cutBoundaryEdges: number[] = [];
  const cutBoundaryWallEdges: number[] = [];
  boundaryEdgeMap.forEach((record) => {
    if (record.count !== 1 || !record.boundary) {
      return;
    }
    cutBoundaryEdges.push(record.ax, record.ay, record.bx, record.by);
    cutBoundaryWallEdges.push(record.ax, record.ay, record.az, record.bx, record.by, record.bz);
  });
  riverDomain.cutoutBoundaryEdges =
    cutBoundaryEdges.length >= 4
      ? new Float32Array(cutBoundaryEdges)
      : snappedBoundaryEdges.length >= 4
        ? snappedBoundaryEdges
        : riverDomain.boundaryEdges;
  riverDomain.cutoutBoundaryWallEdges =
    cutBoundaryWallEdges.length >= 6
      ? new Float32Array(cutBoundaryWallEdges)
      : undefined;
  if (boundarySegments.length > 0 && riverDomain.cutoutBoundaryEdges.length >= 4) {
    const quantScale = 8192;
    const keyOf = (x: number, y: number): string => `${Math.round(x * quantScale)},${Math.round(y * quantScale)}`;
    const boundaryHeightByKey = new Map<string, { x: number; y: number; height: number }>();
    const addBoundaryHeight = (x: number, y: number, worldY: number): void => {
      const key = keyOf(x, y);
      const existing = boundaryHeightByKey.get(key);
      if (existing) {
        if (worldY > existing.height) {
          existing.height = worldY;
        }
        return;
      }
      boundaryHeightByKey.set(key, { x, y, height: worldY });
    };
    const sampleBoundaryHeight = (x: number, y: number): number => {
      let bestDist = Number.POSITIVE_INFINITY;
      let bestHeight = Number.NaN;
      let envelopeHeight = Number.NEGATIVE_INFINITY;
      for (let i = 0; i < boundarySegments.length; i += 1) {
        const seg = boundarySegments[i];
        const abX = seg.bx - seg.ax;
        const abY = seg.by - seg.ay;
        const lenSq = abX * abX + abY * abY;
        if (lenSq <= 1e-10) {
          continue;
        }
        const t = clamp(((x - seg.ax) * abX + (y - seg.ay) * abY) / lenSq, 0, 1);
        const qx = seg.ax + abX * t;
        const qy = seg.ay + abY * t;
        const dist = Math.hypot(x - qx, y - qy);
        const hitHeight = seg.az + (seg.bz - seg.az) * t;
        if (dist <= 0.32 && hitHeight > envelopeHeight) {
          envelopeHeight = hitHeight;
        }
        if (dist < bestDist) {
          bestDist = dist;
          bestHeight = hitHeight;
          if (bestDist <= 1e-5) {
            break;
          }
        }
      }
      if (Number.isFinite(envelopeHeight)) {
        return envelopeHeight;
      }
      return bestDist <= 0.45 ? bestHeight : Number.NaN;
    };
    for (let i = 0; i < riverDomain.cutoutBoundaryEdges.length; i += 4) {
      const ax = riverDomain.cutoutBoundaryEdges[i];
      const ay = riverDomain.cutoutBoundaryEdges[i + 1];
      const bx = riverDomain.cutoutBoundaryEdges[i + 2];
      const by = riverDomain.cutoutBoundaryEdges[i + 3];
      const aKey = keyOf(ax, ay);
      const aExact = directBoundaryVertexHeightByKey.get(aKey);
      const aHeight = Number.isFinite(aExact) ? (aExact as number) : sampleBoundaryHeight(ax, ay);
      if (Number.isFinite(aHeight)) {
        addBoundaryHeight(ax, ay, aHeight);
      }
      const bKey = keyOf(bx, by);
      const bExact = directBoundaryVertexHeightByKey.get(bKey);
      const bHeight = Number.isFinite(bExact) ? (bExact as number) : sampleBoundaryHeight(bx, by);
      if (Number.isFinite(bHeight)) {
        addBoundaryHeight(bx, by, bHeight);
      }
    }
    if (boundaryHeightByKey.size > 0) {
      const packed: number[] = [];
      boundaryHeightByKey.forEach((record) => {
        packed.push(record.x, record.y, record.height);
      });
      riverDomain.cutoutBoundaryVertexHeights = new Float32Array(packed);
    }
  }
  if (riverDomain.debugStats) {
    const mismatch = computeBoundaryMismatchStats(riverDomain.cutoutBoundaryEdges, riverDomain.boundaryEdges);
    riverDomain.debugStats.cutoutBoundaryEdgeCount = mismatch.countA;
    riverDomain.debugStats.boundaryMismatchMean = mismatch.mean;
    riverDomain.debugStats.boundaryMismatchMax = mismatch.max;
    if (DEBUG_TERRAIN_RENDER) {
      console.log(
        `[threeTestTerrain] river boundary mismatch cutoutEdges=${mismatch.countA} domainEdges=${mismatch.countB} mean=${mismatch.mean.toFixed(4)} max=${mismatch.max.toFixed(4)}`
      );
    }
  }
  if (outPositions.length < 9) {
    return;
  }
  geometry.setIndex(null);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(outPositions), 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array(outUvs), 2));
  // Geometry topology changed from indexed grid to clipped non-indexed tris.
  // Drop stale normals/groups so downstream normal recompute and draw ranges stay valid.
  geometry.deleteAttribute("normal");
  geometry.clearGroups();
  geometry.addGroup(0, outPositions.length / 3, 0);
  if (DEBUG_TERRAIN_RENDER) {
    const kept = triCount - cutCount;
    console.log(
      `[threeTestTerrain] river terrain cutout tris total=${triCount} cut=${cutCount} kept=${kept}`
    );
  }
};

const buildRiverMeshData = (
  sample: TerrainSample,
  waterId: number,
  heightScale: number,
  width: number,
  depth: number,
  waterLevelWorld: number,
  riverDomain: RiverRenderDomain | undefined,
  waterfallInstances?: Float32Array
): RiverWaterData | undefined =>
  buildRiverMeshDataInternal(
    sample,
    waterId,
    heightScale,
    width,
    depth,
    waterLevelWorld,
    riverDomain,
    waterfallInstances,
    {
      riverSurfaceBankClearance: RIVER_SURFACE_BANK_CLEARANCE,
      waterSurfaceLiftRiver: WATER_SURFACE_LIFT_RIVER
    }
  );
export const buildRoadOverlayTexture = (
  sample: TerrainSample,
  roadId: number,
  baseId: number,
  roadWidth: number,
  scale: number
): THREE.Texture | null =>
  buildRoadOverlayTextureInternal(sample, roadId, baseId, roadWidth, scale);

export const buildTileTexture = (
  sample: TerrainSample,
  sampleCols: number,
  sampleRows: number,
  step: number,
  palette: number[][],
  grassId: number,
  scrubId: number,
  floodplainId: number,
  beachId: number,
  forestId: number,
  waterId: number,
  roadId: number | null,
  heightScale: number,
  sampleHeights: Float32Array,
  sampleTypes: Uint8Array,
  waterRatio: Float32Array | null,
  oceanRatio: Float32Array | null,
  riverRatio: Float32Array | null,
  sampledErosionWear: Float32Array | null,
  sampledRiverCoverage: Float32Array | null,
  riverStepStrength: Float32Array | null | undefined,
  debugTypeColors: boolean
): THREE.DataTexture =>
  buildTileTextureInternal(
    sample,
    sampleCols,
    sampleRows,
    step,
    palette,
    grassId,
    scrubId,
    floodplainId,
    beachId,
    forestId,
    waterId,
    roadId,
    heightScale,
    sampleHeights,
    sampleTypes,
    waterRatio,
    oceanRatio,
    riverRatio,
    sampledErosionWear,
    sampledRiverCoverage,
    riverStepStrength,
    debugTypeColors,
    {
      forestToneBase: FOREST_TONE_BASE,
      forestTintById: FOREST_TINT_BY_ID,
      noiseAt,
      waterAlphaMinRatio: WATER_ALPHA_MIN_RATIO,
      oceanBorderOpenWaterDistanceMin: OCEAN_BORDER_OPEN_WATER_DISTANCE_MIN,
      oceanSurfaceShoreClipBand: OCEAN_SURFACE_SHORE_CLIP_BAND,
      oceanRatioMin: OCEAN_RATIO_MIN,
      riverRatioMin: RIVER_RATIO_MIN,
      stepRockyTintMax: STEP_ROCKY_TINT_MAX,
      sunDir: SUN_DIR
    }
  );

export const getTerrainStep = (size: number, fullResolution = false): number => {
  if (fullResolution) {
    return 1;
  }
  if (size >= 1024) {
    return 4;
  }
  if (size >= 512) {
    return 3;
  }
  if (size >= 256) {
    return 2;
  }
  return 1;
};

export const prepareTerrainRenderSurface = (
  sample: TerrainSample,
): TerrainRenderSurface => {
  const { cols, rows } = sample;
  const debugRenderOptions = sample.debugRenderOptions;
  const grassId = TILE_TYPE_IDS.grass;
  const beachId = TILE_TYPE_IDS.beach;
  const rockyId = TILE_TYPE_IDS.rocky;
  const waterId = TILE_TYPE_IDS.water;
  const baseId = TILE_TYPE_IDS.base;
  const houseId = TILE_TYPE_IDS.house;
  const roadId = TILE_TYPE_IDS.road;
  const firebreakId = TILE_TYPE_IDS.firebreak;
  const ashId = TILE_TYPE_IDS.ash;
  const step = getTerrainStep(Math.max(cols, rows), sample.fullResolution ?? false);
  const sampleCols = Math.floor((cols - 1) / step) + 1;
  const sampleRows = Math.floor((rows - 1) / step) + 1;
  const width = (sampleCols - 1) * step;
  const depth = (sampleRows - 1) * step;
  const heightScale = getTerrainHeightScale(cols, rows, sample.heightScaleMultiplier ?? 1);
  const rawSampleHeights = buildSampleHeightMap(sample, sampleCols, sampleRows, step, waterId);
  const finalSampleHeights = new Float32Array(rawSampleHeights);
  const coastData = buildSampleCoastData(sample, sampleCols, sampleRows, step);
  const oceanMask = sample.oceanMask ?? (sample.tileTypes ? buildOceanMask(cols, rows, sample.tileTypes, waterId) : null);
  const riverMask = sample.riverMask ?? null;
  const waterLevel = computeWaterLevel(sample, waterId, oceanMask, riverMask);
  const hasAuthoritativeCoastProfile =
    !!sample.seaLevel &&
    sample.seaLevel.length === cols * rows &&
    !!sample.coastDistance &&
    sample.coastDistance.length === cols * rows &&
    !!sample.coastClass &&
    sample.coastClass.length === cols * rows;
  const sampleTypes = buildSampleTypeMap(
    sample,
    sampleCols,
    sampleRows,
    step,
    grassId,
    waterId,
    TILE_ID_TO_TYPE.length,
    [baseId, houseId, roadId, firebreakId, ashId]
  );
  suppressIsolatedHeightSamples(finalSampleHeights, sampleCols, sampleRows, sampleTypes, waterId);
  const sampleOceanCoverage = coastData.oceanCoverage;
  const sampleCoastDistance = coastData.coastDistance;
  const sampleCoastClass = coastData.coastClass;
  for (let i = 0; i < sampleTypes.length; i += 1) {
    const typeId = sampleTypes[i] ?? grassId;
    if (typeId === baseId || typeId === houseId || typeId === firebreakId || (roadId !== null && typeId === roadId)) {
      continue;
    }
    const coastClass = sampleCoastClass?.[i] ?? COAST_CLASS_NONE;
    if (coastClass === COAST_CLASS_SHELF_WATER) {
      sampleTypes[i] = waterId;
    } else if (coastClass === COAST_CLASS_BEACH) {
      sampleTypes[i] = beachId;
    } else if (coastClass === COAST_CLASS_CLIFF && typeId === waterId) {
      sampleTypes[i] = rockyId;
    }
  }
  const sampleDistanceToLand = (() => {
    const total = sampleCols * sampleRows;
    const mapped = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) {
      mapped[i] = sampleTypes[i] === waterId ? 1 : 0;
    }
    return buildDistanceField(mapped, sampleCols, sampleRows, 0);
  })();
  if (waterLevel !== null) {
    for (let row = 0; row < sampleRows; row += 1) {
      const tileY = Math.min(rows - 1, row * step);
      const endY = Math.min(rows, tileY + step);
      for (let col = 0; col < sampleCols; col += 1) {
        const tileX = Math.min(cols - 1, col * step);
        const endX = Math.min(cols, tileX + step);
        const idx = row * sampleCols + col;
        if (sampleTypes[idx] !== waterId) {
          continue;
        }
        const touchesWorldBorder = sampleTouchesWorldBorder(tileX, tileY, endX, endY, cols, rows);
        const coastalDistanceToLand =
          sampleDistanceToLand[idx] >= 0 ? sampleDistanceToLand[idx] : sampleCols + sampleRows;
        const renderSeaLevel = waterLevel;
        const coastDistance = sampleCoastDistance?.[idx] ?? coastalDistanceToLand;
        const coastClass = sampleCoastClass?.[idx] ?? COAST_CLASS_NONE;
        let isOcean = false;
        let isRiver = false;
        if (oceanMask) {
          for (let y = tileY; y < endY && !isOcean; y += 1) {
            const rowBase = y * cols;
            for (let x = tileX; x < endX; x += 1) {
              const tileIndex = rowBase + x;
              if (riverMask && riverMask[tileIndex]) {
                isRiver = true;
                break;
              }
              if (oceanMask[tileIndex]) {
                isOcean = true;
                break;
              }
            }
          }
        }
        if ((!oceanMask || isOcean) && !isRiver) {
          if (touchesWorldBorder) {
            finalSampleHeights[idx] = renderSeaLevel;
            continue;
          }
          const targetSeabed =
            coastClass === COAST_CLASS_SHELF_WATER && coastDistance > 0
              ? clamp(renderSeaLevel - getCoastProfileValue(COAST_SAMPLE_BEACH_WET_DEPTHS, coastDistance), 0, 1)
              : clamp(
                  renderSeaLevel -
                    Math.min(COAST_GEOMETRY_WATER_MAX_DEPTH, coastalDistanceToLand * COAST_GEOMETRY_WATER_DEPTH_PER_CELL),
                  0,
                  1
                );
          finalSampleHeights[idx] = Math.min(finalSampleHeights[idx], targetSeabed);
        }
      }
    }
  }
  const waterRatios = buildSampleWaterRatios(sample, sampleCols, sampleRows, step, waterId, oceanMask, riverMask);
  if (waterLevel !== null && !hasAuthoritativeCoastProfile) {
    const total = sampleCols * sampleRows;
    const sampleOceanSupport = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) {
      const oceanCoverage = clamp(sampleOceanCoverage?.[i] ?? waterRatios.ocean[i] ?? 0, 0, 1);
      sampleOceanSupport[i] =
        (((sampleCoastClass?.[i] ?? COAST_CLASS_NONE) === COAST_CLASS_SHELF_WATER) || sampleTypes[i] === waterId) &&
        oceanCoverage >= OCEAN_RATIO_MIN
          ? 1
          : 0;
    }
    const sampleDistanceToOcean = buildDistanceField(sampleOceanSupport, sampleCols, sampleRows, 1);
    for (let i = 0; i < total; i += 1) {
      const typeId = sampleTypes[i] ?? grassId;
      if (typeId === waterId) {
        continue;
      }
      if (typeId === baseId || typeId === houseId || typeId === firebreakId || typeId === ashId) {
        continue;
      }
      if (roadId !== null && typeId === roadId) {
        continue;
      }
      if ((waterRatios.river[i] ?? 0) >= RIVER_RATIO_MIN * 0.5) {
        continue;
      }
      const coastalDistanceToOcean = sampleDistanceToOcean[i];
      if (coastalDistanceToOcean <= 0 || coastalDistanceToOcean > COAST_GEOMETRY_LAND_RELAX_BAND) {
        continue;
      }
      const renderSeaLevel = waterLevel;
      const coastClass = sampleCoastClass?.[i] ?? COAST_CLASS_NONE;
      const coastDistance = sampleCoastDistance?.[i] ?? coastalDistanceToOcean;
      const targetHeight =
        coastClass === COAST_CLASS_BEACH && coastDistance > 0
          ? clamp(renderSeaLevel + getCoastProfileValue(COAST_SAMPLE_BEACH_LAND_HEIGHTS, coastDistance), 0, 1)
          : coastClass === COAST_CLASS_CLIFF && coastDistance > 0
            ? clamp(renderSeaLevel + getCoastProfileValue(COAST_SAMPLE_CLIFF_LAND_MIN, coastDistance), 0, 1)
            : clamp(
                renderSeaLevel + coastalDistanceToOcean * COAST_GEOMETRY_LAND_RISE_PER_CELL,
                0,
                1
              );
      if (coastClass === COAST_CLASS_CLIFF && coastDistance > 0) {
        finalSampleHeights[i] = Math.max(finalSampleHeights[i], targetHeight);
        continue;
      }
      if (coastClass === COAST_CLASS_BEACH && coastDistance > 0 && finalSampleHeights[i] < targetHeight) {
        finalSampleHeights[i] = targetHeight;
        continue;
      }
      if (finalSampleHeights[i] <= targetHeight) {
        continue;
      }
      const relax = 1 - smoothstep(1, COAST_GEOMETRY_LAND_RELAX_BAND + 1, coastalDistanceToOcean);
      finalSampleHeights[i] = clamp(finalSampleHeights[i] * (1 - relax) + targetHeight * relax, 0, 1);
    }
  }
  const sampledRiverSurface = buildSampleOptionalFloatMap(
    sample,
    sample.riverSurface,
    sampleCols,
    sampleRows,
    step,
    riverMask,
    "min"
  );
  const sampledRiverStepStrength = buildSampleOptionalFloatMap(
    sample,
    sample.riverStepStrength,
    sampleCols,
    sampleRows,
    step,
    riverMask,
    "max"
  );
  const sampledErosionWear = buildSampleOptionalFloatMap(
    sample,
    sample.erosionWear,
    sampleCols,
    sampleRows,
    step,
    undefined,
    "mean"
  );
  const riverRenderDomain = buildRiverRenderDomain(sample, waterId);
  const sampledRiverCoverage = buildSampleMaskCoverage(
    sample,
    riverRenderDomain?.renderSupport ?? riverMask ?? undefined,
    sampleCols,
    sampleRows,
    step
  );
  const { oceanRatios: oceanRenderRatios, oceanSupportMask, surfAttenuation: oceanSurfAttenuation } =
    buildOceanRenderSupportData(
      cols,
      rows,
      sampleCols,
      sampleRows,
      step,
      sampleTypes,
      waterId,
      waterRatios,
      sampleOceanCoverage,
      sampleCoastClass,
      sampleCoastDistance,
      coastData
    );
  const waterSupportMask = buildWaterSupportMask(waterRatios, oceanSupportMask, sampledRiverCoverage);
  if (step === 1) {
    suppressIsolatedHeightSamples(finalSampleHeights, sampleCols, sampleRows, sampleTypes, waterId);
  }
  const sampleHeights =
    debugRenderOptions?.terrainHeightMode === "raw"
      ? new Float32Array(rawSampleHeights)
      : finalSampleHeights;
  const waterSurfaceHeights = buildWaterSurfaceHeights(
    sampleHeights,
    waterSupportMask,
    waterRatios.ocean,
    waterRatios.river,
    sampleCols,
    sampleRows,
    waterLevel,
    sampledRiverSurface,
    sampledRiverStepStrength,
    {
      oceanRatioMin: OCEAN_RATIO_MIN,
      riverRatioMin: RIVER_RATIO_MIN
    }
  );
  const shoreTerrainHeightAboveWater = new Float32Array(sampleCols * sampleRows);
  const waterLevelWorld = waterLevel !== null ? clamp(waterLevel, 0, 1) * heightScale : 0;
  for (let i = 0; i < sampleCols * sampleRows; i += 1) {
    const terrainWorld = (sampleHeights[i] ?? 0) * heightScale;
    shoreTerrainHeightAboveWater[i] = Math.max(0, terrainWorld - waterLevelWorld);
  }
  const shoreTransition = buildShoreTransitionData({
    sampleCols,
    sampleRows,
    oceanSupportMask,
    sampleCoastClass,
    coastData,
    shoreTerrainHeightAboveWater,
    oceanRatio: oceanRenderRatios.ocean
  });
  if (DEBUG_TERRAIN_RENDER && riverRenderDomain) {
    const transform = createRiverSpaceTransform(
      riverRenderDomain.cols,
      riverRenderDomain.rows,
      width,
      depth,
      sampleCols,
      sampleRows
    );
    const check = validateRiverSpaceTransform(transform, sampleCols, sampleRows);
    console.log(
      `[threeTestTerrain] river xform validation worldRoundTripMax=${check.worldRoundTripMax.toFixed(5)} sampleRoundTripMax=${check.sampleRoundTripMax.toFixed(5)}`
    );
  }
  const heightAtSample = (x: number, y: number): number => {
    const clampedX = Math.max(0, Math.min(sampleCols - 1, x));
    const clampedY = Math.max(0, Math.min(sampleRows - 1, y));
    return sampleHeights[clampedY * sampleCols + clampedX] ?? 0;
  };
  const heightAtTileCoord = (tileX: number, tileY: number): number => {
    const sx = clamp(tileX / step, 0, sampleCols - 1);
    const sy = clamp(tileY / step, 0, sampleRows - 1);
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(sampleCols - 1, x0 + 1);
    const y1 = Math.min(sampleRows - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const h00 = heightAtSample(x0, y0);
    const h10 = heightAtSample(x1, y0);
    const h01 = heightAtSample(x0, y1);
    const h11 = heightAtSample(x1, y1);
    const hx0 = h00 * (1 - tx) + h10 * tx;
    const hx1 = h01 * (1 - tx) + h11 * tx;
    return hx0 * (1 - ty) + hx1 * ty;
  };
  const heightAtTile = (tileX: number, tileY: number): number => heightAtTileCoord(tileX + 0.5, tileY + 0.5);
  const structureTopHeights = new Float32Array(cols * rows);
  structureTopHeights.fill(Number.NEGATIVE_INFINITY);
  const sampleStructureTopHeightAtTileCoord = (tileX: number, tileY: number): number => {
    const ix = clamp(Math.floor(tileX), 0, cols - 1);
    const iy = clamp(Math.floor(tileY), 0, rows - 1);
    return structureTopHeights[iy * cols + ix] ?? Number.NEGATIVE_INFINITY;
  };
  const surface: TerrainRenderSurface = {
    sample,
    cols,
    rows,
    step,
    sampleCols,
    sampleRows,
    width,
    depth,
    size: { width, depth },
    heightScale,
    sampleHeights,
    rawSampleHeights,
    finalSampleHeights,
    sampleTypes,
    coastData,
    sampleOceanCoverage,
    sampleCoastDistance,
    sampleCoastClass,
    oceanMask,
    riverMask,
    waterLevel,
    waterRatios,
    waterSupportMask,
    waterSurfaceHeights,
    oceanRenderRatios,
    oceanSupportMask,
    oceanSurfAttenuation,
    shoreTransition,
    sampledErosionWear,
    sampledRiverSurface,
    sampledRiverStepStrength,
    sampledRiverCoverage,
    riverRenderDomain,
    structureTopHeightsWorld: structureTopHeights,
    debugHeightAnomalies: undefined,
    getHeightProvenance: undefined,
    heightAtSample,
    heightAtTileCoord,
    heightAtTile,
    obstructionHeightAtTileCoordWorld: (tileX: number, tileY: number): number =>
      Math.max(heightAtTileCoord(tileX, tileY) * heightScale, sampleStructureTopHeightAtTileCoord(tileX, tileY)),
    toWorldX: (tileX: number): number => (tileX / Math.max(1, cols) - 0.5) * width,
    toWorldZ: (tileY: number): number => (tileY / Math.max(1, rows) - 0.5) * depth
  };
  if (debugRenderOptions?.enableHeightProvenance) {
    surface.getHeightProvenance = (tileX: number, tileY: number): TerrainHeightProvenance | null =>
      buildTerrainHeightProvenance(surface, tileX, tileY);
    const anomalies = collectTerrainHeightAnomalies(surface, Math.max(1, debugRenderOptions.anomalyLogLimit ?? 5));
    surface.debugHeightAnomalies = anomalies;
    if (debugRenderOptions.logHeightAnomalies !== false && anomalies.length > 0) {
      const summary = anomalies
        .map(
          (anomaly) =>
            `${anomaly.stage}@tile(${anomaly.tileX},${anomaly.tileY}) sample(${anomaly.sampleX},${anomaly.sampleY}) delta=${anomaly.delta.toFixed(4)} value=${anomaly.value.toFixed(4)} base=${anomaly.baseline.toFixed(4)}`
        )
        .join(" | ");
      console.warn(`[threeTestTerrain] height anomalies ${summary}`);
    }
  }
  return surface;
};

export const buildTerrainMesh = (
  surface: TerrainRenderSurface,
  treeAssets: TreeAssets | null,
  houseAssets: HouseAssets | null,
  firestationAsset: FirestationAsset | null,
  seasonVisualConfig?: TreeSeasonVisualConfig
): {
  mesh: THREE.Mesh;
  size: { width: number; depth: number };
  water?: TerrainWaterData;
  treeBurn?: TreeBurnController;
} => {
  const sample = surface.sample;
  const debugRenderOptions = sample.debugRenderOptions;
  const { cols, rows, elevations } = sample;
  const palette = buildPalette();
  const grassId = TILE_TYPE_IDS.grass;
  const scrubId = TILE_TYPE_IDS.scrub;
  const floodplainId = TILE_TYPE_IDS.floodplain;
  const forestId = TILE_TYPE_IDS.forest;
  const beachId = TILE_TYPE_IDS.beach;
  const rockyId = TILE_TYPE_IDS.rocky;
  const waterId = TILE_TYPE_IDS.water;
  const baseId = TILE_TYPE_IDS.base;
  const houseId = TILE_TYPE_IDS.house;
  const roadId = TILE_TYPE_IDS.road;
  const firebreakId = TILE_TYPE_IDS.firebreak;
  const ashId = TILE_TYPE_IDS.ash;
  const maxMapSpan = Math.max(cols, rows);
  const {
    step,
    sampleCols,
    sampleRows,
    width,
    depth,
    sampleHeights,
    sampleTypes,
    coastData,
    sampleOceanCoverage,
    sampleCoastDistance,
    sampleCoastClass,
    oceanMask,
    riverMask,
    waterLevel,
    waterRatios,
    waterSupportMask,
    waterSurfaceHeights,
    oceanRenderRatios,
    oceanSupportMask: surfaceOceanSupportMask,
    oceanSurfAttenuation,
    shoreTransition,
    sampledErosionWear,
    sampledRiverSurface,
    sampledRiverStepStrength,
    sampledRiverCoverage,
    riverRenderDomain,
    heightAtTileCoord,
    heightAtTile,
    heightScale,
    toWorldX,
    toWorldZ
  } = surface;
  const isLargeTerrain = maxMapSpan >= LARGE_TERRAIN_DETAIL_THRESHOLD;
  const isMediumTerrain = !isLargeTerrain && maxMapSpan >= MEDIUM_TERRAIN_DETAIL_THRESHOLD;
  const treeDensitySafetyScale = isLargeTerrain ? TREE_DENSITY_SCALE_LARGE : isMediumTerrain ? TREE_DENSITY_SCALE_MEDIUM : 1;
  const treeAttemptCap = isLargeTerrain ? TREE_ATTEMPT_CAP_LARGE : isMediumTerrain ? TREE_ATTEMPT_CAP_MEDIUM : 3;
  const treeVariantCap = isLargeTerrain ? TREE_VARIANT_CAP_LARGE : isMediumTerrain ? TREE_VARIANT_CAP_MEDIUM : Number.POSITIVE_INFINITY;
  const treeInstanceBudget = isLargeTerrain
    ? TREE_INSTANCE_BUDGET_LARGE
    : isMediumTerrain
      ? TREE_INSTANCE_BUDGET_MEDIUM
      : Number.POSITIVE_INFINITY;
  const useDetailedStructures = maxMapSpan < DETAILED_STRUCTURE_THRESHOLD;
  const geometry = new THREE.PlaneGeometry(width, depth, sampleCols - 1, sampleRows - 1);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = Number.NEGATIVE_INFINITY;
  let waterHeightSum = 0;
  let waterCount = 0;
  let vertexIndex = 0;
  const treeInstances: TreeInstance[] = [];
  const scrubPlaceholderInstances: ScrubPlaceholderInstance[] = [];
  const treeTileProfilesRaw = new Map<
    number,
    {
      x: number;
      y: number;
      z: number;
      crownHeight: number;
      crownRadius: number;
      trunkHeight: number;
      count: number;
    }
  >();
  const allowTrees = sample.treesEnabled ?? true;
  const seasonVisual = seasonVisualConfig && seasonVisualConfig.enabled ? seasonVisualConfig : null;
  const hasTreeAssets =
    allowTrees &&
    !!treeAssets &&
    Object.values(treeAssets).some((variants) => Array.isArray(variants) && variants.length > 0);
  const limitTreeVariants = (variants: TreeVariant[]): TreeVariant[] => {
    if (treeVariantCap >= variants.length) {
      return variants;
    }
    return variants.slice(0, treeVariantCap);
  };
  const getTreeVariants = (type: TreeType): TreeVariant[] => {
    if (!treeAssets) {
      return [];
    }
    const direct = treeAssets[type] ?? [];
    if (direct.length > 0) {
      return limitTreeVariants(direct);
    }
    const scrubFallback = treeAssets[TreeType.Scrub] ?? [];
    if (scrubFallback.length > 0) {
      return limitTreeVariants(scrubFallback);
    }
    return limitTreeVariants(treeAssets[TreeType.Pine] ?? []);
  };
  const hasNativeScrubVariants = (treeAssets?.[TreeType.Scrub]?.length ?? 0) > 0;
  const treeTypes = sample.treeTypes;
  const tileVegetationAge = sample.tileVegetationAge;
  const tileCanopyCover = sample.tileCanopyCover;
  const tileStemDensity = sample.tileStemDensity;
  const birchId = TREE_TYPE_IDS[TreeType.Birch];
  const pineId = TREE_TYPE_IDS[TreeType.Pine];
  const oakId = TREE_TYPE_IDS[TreeType.Oak];
  const mapleId = TREE_TYPE_IDS[TreeType.Maple];
  const elmId = TREE_TYPE_IDS[TreeType.Elm];
  const houseMask = sample.tileTypes
    ? (() => {
      const mask = new Uint8Array(cols * rows);
      const tiles = sample.tileTypes!;

        for (let tileY = 0; tileY < rows; tileY += 1) {
          const rowBase = tileY * cols;
          for (let tileX = 0; tileX < cols; tileX += 1) {
            const idx = rowBase + tileX;
            const type = tiles[idx];
            if (type !== houseId) {
              continue;
            }
            const seed = idx;
            const rotation = pickHouseRotation(tileX, tileY, cols, rows, tiles, roadId, baseId, seed);
            const footprint = pickHouseFootprint(seed);
            const bounds = getHouseFootprintBounds(tileX, tileY, rotation, footprint);
            for (let fy = bounds.minY; fy <= bounds.maxY; fy += 1) {
              if (fy < 0 || fy >= rows) {
                continue;
              }
              const row = fy * cols;
              for (let fx = bounds.minX; fx <= bounds.maxX; fx += 1) {
                if (fx < 0 || fx >= cols) {
                  continue;
                }
                mask[row + fx] = 1;
              }
            }
          }
        }

        return mask;
      })()
    : null;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const idx = tileY * cols + tileX;
      const height = sampleHeights[vertexIndex] ?? 0;
      const clampedHeight = clamp(height, -1, 1);
      const y = clampedHeight * heightScale;
      positions.setY(vertexIndex, y);
      minHeight = Math.min(minHeight, y);
      maxHeight = Math.max(maxHeight, y);
      const typeId = sampleTypes[vertexIndex] ?? grassId;
      if (typeId === waterId) {
        waterHeightSum += y;
        waterCount += 1;
      }
      const edgeBand = 3;
      if (tileX < edgeBand || tileY < edgeBand || tileX >= cols - edgeBand || tileY >= rows - edgeBand) {
        vertexIndex += 1;
        continue;
      }
      const leftIdx = col > 0 ? vertexIndex - 1 : vertexIndex;
      const rightIdx = col < sampleCols - 1 ? vertexIndex + 1 : vertexIndex;
      const upIdx = row > 0 ? vertexIndex - sampleCols : vertexIndex;
      const downIdx = row < sampleRows - 1 ? vertexIndex + sampleCols : vertexIndex;
      const neighborWater =
        sampleTypes[leftIdx] === waterId ||
        sampleTypes[rightIdx] === waterId ||
        sampleTypes[upIdx] === waterId ||
        sampleTypes[downIdx] === waterId;
      if (neighborWater) {
        vertexIndex += 1;
        continue;
      }
      if (houseMask && houseMask[idx]) {
        vertexIndex += 1;
        continue;
      }
      const slope =
        Math.max(
          Math.abs((sampleHeights[leftIdx] ?? height) - height),
          Math.abs((sampleHeights[rightIdx] ?? height) - height),
          Math.abs((sampleHeights[upIdx] ?? height) - height),
          Math.abs((sampleHeights[downIdx] ?? height) - height)
        );
      if (slope > 0.12) {
        vertexIndex += 1;
        continue;
      }
      const densityScale = Math.min(1.5, 1 + Math.max(0, step - 1) * 0.2) * treeDensitySafetyScale;
      const centerX = ((tileX + 0.5) / Math.max(1, cols) - 0.5) * width;
      const centerZ = ((tileY + 0.5) / Math.max(1, rows) - 0.5) * depth;
      const vegetationType =
        typeId === forestId
          ? "forest"
          : typeId === scrubId
            ? "scrub"
            : typeId === floodplainId
              ? "floodplain"
              : typeId === grassId
                ? "grass"
                : null;
      const stemDensity = Math.max(0, tileStemDensity?.[idx] ?? 0);
      const canopyCover = clamp(tileCanopyCover?.[idx] ?? 0, 0, 1);
      const vegetationAgeYears = Math.max(0, tileVegetationAge?.[idx] ?? 0);
      let placedTreeOnTile = false;
      if (vegetationType && stemDensity > 0 && canopyCover > 0.015 && treeInstances.length < treeInstanceBudget) {
        const dominantId = treeTypes ? treeTypes[idx] : 255;
        const isForest = typeId === forestId;
        const forestScale =
          dominantId === pineId
            ? 1.05
            : dominantId === oakId
            ? 1
            : dominantId === mapleId
            ? 0.98
            : dominantId === elmId
            ? 1.02
            : dominantId === birchId
                  ? 0.9
                  : 1;
        const baseScale =
          TREE_SCALE_BASE + Math.min(TREE_SCALE_STEP_CAP, Math.max(0, step - 1) * TREE_SCALE_STEP_GAIN);
        const typeScale = isForest ? forestScale : typeId === scrubId ? 0.75 : 0.6;
        const vegetationHeightScale = getVegetationRenderHeightMultiplier(vegetationType, vegetationAgeYears);
        const canopyHeightScale = clamp(0.72 + canopyCover * 0.55, 0.72, 1.28);
        let treeType: TreeType = TreeType.Scrub;
        if (isForest) {
          if (dominantId === birchId) {
            treeType = TreeType.Birch;
          } else if (dominantId === oakId) {
            treeType = TreeType.Oak;
          } else if (dominantId === mapleId) {
            treeType = TreeType.Maple;
          } else if (dominantId === elmId) {
            treeType = TreeType.Elm;
          } else {
            treeType = TreeType.Pine;
          }
        }
        const variants = hasTreeAssets ? getTreeVariants(treeType) : [];
        const rawCount =
          stemDensity *
          (isForest ? 0.45 : typeId === scrubId ? 0.4 : 0.35) *
          densityScale *
          (0.4 + canopyCover * 0.8);
        let attempts = Math.min(Math.max(1, treeAttemptCap * 2 + 1), Math.floor(rawCount));
        const fractionalCount = rawCount - Math.floor(rawCount);
        if (
          attempts < Math.max(1, treeAttemptCap * 2 + 1) &&
          noiseAt(idx + 11.7) < fractionalCount
        ) {
          attempts += 1;
        }
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (treeInstances.length >= treeInstanceBudget) {
            break;
          }
          const jitterRange = Math.max(0.1, step * 0.42);
          const jitterX = (noiseAt(idx + 0.27 + attempt * 0.31) - 0.5) * jitterRange;
          const jitterZ = (noiseAt(idx + 0.61 + attempt * 0.29) - 0.5) * jitterRange;
          const variantIndex =
            variants.length > 0 ? Math.floor(noiseAt(idx + 9.7 + attempt * 0.53) * variants.length) : 0;
          const variant = variants.length > 0 ? variants[variantIndex] ?? variants[0] : null;
          const targetHeight = baseScale * typeScale * vegetationHeightScale * canopyHeightScale * TREE_HEIGHT_FACTOR;
          const sourceHeight = Math.max(0.35, variant?.height ?? 1.5);
          const scale = (targetHeight / sourceHeight) * (0.85 + noiseAt(idx + 7.9 + attempt * 0.41) * 0.3);
          const rotation = noiseAt(idx + 3.3 + attempt * 0.23) * Math.PI * 2;
          // Place trees relative to tile centers (not terrain vertices), then jitter within the tile.
          const x = centerX + jitterX;
          const z = centerZ + jitterZ;
          const treeY = y + (variant ? variant.baseOffset * scale : 0);
          const treeHeight = Math.max(0.2, sourceHeight * scale);
          const crownHeight = Math.max(0.25, treeHeight * 0.72);
          const trunkHeight = Math.max(0.2, treeHeight * 0.45);
          const crownRadius = Math.max(0.16, treeHeight * (isForest ? 0.22 : 0.18));
          treeInstances.push({
            x,
            y: treeY,
            z,
            scale,
            rotation,
            treeType,
            variantIndex,
            tileIndex: idx,
            tileX,
            tileY
          });
          placedTreeOnTile = true;
          const profile = treeTileProfilesRaw.get(idx);
          if (profile) {
            profile.x += x;
            profile.y += treeY;
            profile.z += z;
            profile.crownHeight += crownHeight;
            profile.crownRadius += crownRadius;
            profile.trunkHeight += trunkHeight;
            profile.count += 1;
          } else {
            treeTileProfilesRaw.set(idx, { x, y: treeY, z, crownHeight, crownRadius, trunkHeight, count: 1 });
          }
        }
      }
      if (
        typeId === scrubId &&
        !placedTreeOnTile &&
        scrubPlaceholderInstances.length < SCRUB_PLACEHOLDER_MAX_INSTANCES
      ) {
        const placeholderChance = Math.min(
          0.68,
          SCRUB_PLACEHOLDER_BASE_CHANCE * densityScale * (0.45 + canopyCover * 0.9)
        );
        if (noiseAt(idx + 14.39) < placeholderChance) {
          const jitterRange = Math.max(0.1, step * 0.34);
          const jitterX = (noiseAt(idx + 2.91) - 0.5) * jitterRange;
          const jitterZ = (noiseAt(idx + 3.17) - 0.5) * jitterRange;
          if (hasNativeScrubVariants && treeInstances.length < treeInstanceBudget) {
            const scrubVariants = getTreeVariants(TreeType.Scrub);
            const variantIndex =
              scrubVariants.length > 0 ? Math.floor(noiseAt(idx + 9.73) * scrubVariants.length) : 0;
            const variant = scrubVariants.length > 0 ? scrubVariants[variantIndex] ?? scrubVariants[0] : null;
            const baseScale =
              TREE_SCALE_BASE + Math.min(TREE_SCALE_STEP_CAP, Math.max(0, step - 1) * TREE_SCALE_STEP_GAIN);
            const targetHeight =
              baseScale *
              0.75 *
              getVegetationRenderHeightMultiplier("scrub", vegetationAgeYears) *
              clamp(0.76 + canopyCover * 0.5, 0.76, 1.18) *
              TREE_HEIGHT_FACTOR;
            const sourceHeight = Math.max(0.35, variant?.height ?? 1.5);
            const scale = (targetHeight / sourceHeight) * (0.82 + noiseAt(idx + 6.41) * 0.24);
            const rotation = noiseAt(idx + 8.23) * Math.PI * 2;
            const x = centerX + jitterX;
            const z = centerZ + jitterZ;
            const treeY = y + (variant ? variant.baseOffset * scale : 0);
            treeInstances.push({
              x,
              y: treeY,
              z,
              scale,
              rotation,
              treeType: TreeType.Scrub,
              variantIndex,
              tileIndex: idx,
              tileX,
              tileY
            });
            const crownHeight = targetHeight * 0.64;
            const crownRadius = targetHeight * 0.2;
            const trunkHeight = targetHeight * 0.36;
            const profile = treeTileProfilesRaw.get(idx);
            if (profile) {
              profile.x += x;
              profile.y += treeY;
              profile.z += z;
              profile.crownHeight += crownHeight;
              profile.crownRadius += crownRadius;
              profile.trunkHeight += trunkHeight;
              profile.count += 1;
            } else {
              treeTileProfilesRaw.set(idx, { x, y: treeY, z, crownHeight, crownRadius, trunkHeight, count: 1 });
            }
            placedTreeOnTile = true;
          } else {
            const scale =
              SCRUB_PLACEHOLDER_SCALE_MIN +
              noiseAt(idx + 6.41) * (SCRUB_PLACEHOLDER_SCALE_MAX - SCRUB_PLACEHOLDER_SCALE_MIN);
            scrubPlaceholderInstances.push({
              x: centerX + jitterX,
              y,
              z: centerZ + jitterZ,
              scale,
              rotation: noiseAt(idx + 8.23) * Math.PI * 2,
              colorJitter: noiseAt(idx + 9.57)
            });
          }
        }
      }
      vertexIndex += 1;
    }
  }
  if (!debugRenderOptions?.disableRiverCutout) {
    applyRiverTerrainTriangleCutout(geometry, sampleCols, sampleRows, riverRenderDomain);
  }
  geometry.computeVertexNormals();
  if (DEBUG_TERRAIN_RENDER && threeTestLoggedTotal !== cols * rows) {
    console.log(
      `ThreeTest heights: min=${minHeight.toFixed(2)} max=${maxHeight.toFixed(2)} scale=${heightScale.toFixed(2)}`
    );
    threeTestLoggedTotal = cols * rows;
  }

  const tileTexture = buildTileTexture(
    sample,
    sampleCols,
    sampleRows,
    step,
    palette,
    grassId,
    scrubId,
    floodplainId,
    TILE_TYPE_IDS.beach,
    forestId,
    waterId,
    roadId,
    heightScale,
    sampleHeights,
    sampleTypes,
    waterRatios.water,
    waterRatios.ocean,
    waterRatios.river,
    sampledErosionWear ?? null,
    sampledRiverCoverage ?? null,
    sampledRiverStepStrength,
    sample.debugTypeColors ?? false
  );
  const material = new THREE.MeshStandardMaterial({
    map: tileTexture,
    roughness: 0.88,
    metalness: 0
  });
  material.transparent = false;
  material.alphaTest = 0.5;
  if (ENABLE_GRASS_DETAIL_FX) {
    applyGrassDetailFx(material, {
      enabled: ENABLE_GRASS_DETAIL_FX,
      tileWorldSize: step,
      seed: sample.worldSeed ?? 0,
      sampleTypes,
      sampleCols,
      sampleRows,
      grassTypeId: grassId,
      originX: -width * 0.5,
      originZ: -depth * 0.5
    });
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  const roadOverlay = buildRoadOverlayTexture(sample, roadId, baseId, ROAD_SURFACE_WIDTH, ROAD_TEX_SCALE);
  if (roadOverlay) {
    const roadMaterial = new THREE.MeshStandardMaterial({
      map: roadOverlay,
      color: new THREE.Color(0xffffff),
      transparent: true,
      depthWrite: false,
      roughness: 0.9,
      metalness: 0.05,
      side: THREE.DoubleSide,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2
    });
    roadMaterial.alphaTest = 0.02;
    const roadMesh = new THREE.Mesh(geometry, roadMaterial);
    roadMesh.castShadow = false;
    roadMesh.receiveShadow = true;
    roadMesh.renderOrder = 1;
    roadMesh.userData.roadOverlay = true;
    roadMesh.userData.roadOverlayVersion = getRoadAtlasVersion();
    mesh.add(roadMesh);
  }
  const roadDeckMesh = buildRoadDeckMesh(sample, width, depth, heightScale, roadOverlay, roadId, baseId, heightAtTileCoord);
  if (roadDeckMesh) {
    mesh.add(roadDeckMesh);
  }
  const bridgeDeckSurface: BridgeDeckSurfaceInput = {
    sample,
    cols,
    rows,
    width,
    depth,
    step,
    sampleCols,
    sampleRows,
    heightScale,
    heightAtTileCoord,
    toWorldX,
    toWorldZ,
    waterRatio: waterRatios.water,
    waterSurfaceHeights
  };
  if (!debugRenderOptions?.disableBridges) {
    const bridgeDeck = buildBridgeDeckMesh(bridgeDeckSurface, roadOverlay, roadId, baseId);
    mesh.userData.bridgeDebug = bridgeDeck.debug;
    if (bridgeDeck.group) {
      mesh.add(bridgeDeck.group);
    }
  } else {
    mesh.userData.bridgeDebug = null;
  }
  const roadWallMesh = buildRoadRetainingWallMesh(sample, width, depth, heightScale, roadId, baseId, heightAtTileCoord);
  if (roadWallMesh) {
    mesh.add(roadWallMesh);
  }
  const treeBurnMeshStates: TreeBurnMeshState[] = [];
  if (hasTreeAssets && treeInstances.length > 0) {
    const treeGroup = new THREE.Group();
    const whiteColor = new THREE.Color(1, 1, 1);
    const dummy = new THREE.Object3D();
    const tempMatrix = new THREE.Matrix4();
    const addVariantInstances = (treeType: TreeType, variants: TreeVariant[]) => {
      const instances = treeInstances.filter((instance) => instance.treeType === treeType);
      if (instances.length === 0 || variants.length === 0) {
        return;
      }
      const buckets = variants.map(() => [] as TreeInstance[]);
      instances.forEach((instance) => {
        const index = Math.min(variants.length - 1, Math.max(0, instance.variantIndex));
        buckets[index].push(instance);
      });
      variants.forEach((variant, variantIndex) => {
        const variantInstances = buckets[variantIndex];
        if (variantInstances.length === 0) {
          return;
        }
        variant.meshes.forEach((meshTemplate) => {
          const role = getTreeBurnRole(meshTemplate.material);
          if (role === "trunk") {
            applyTrunkTopCropShader(meshTemplate.material);
          }
          applyTreeSeasonShader(meshTemplate.material, seasonVisual, treeType);
          if (!meshTemplate.geometry.boundingBox) {
            meshTemplate.geometry.computeBoundingBox();
          }
          const geometryBounds = meshTemplate.geometry.boundingBox;
          const cropMinY = geometryBounds?.min.y ?? 0;
          const cropMaxY = geometryBounds?.max.y ?? 0;
          const instanced = new THREE.InstancedMesh(
            meshTemplate.geometry,
            meshTemplate.material,
            variantInstances.length
          );
          instanced.castShadow = true;
          instanced.receiveShadow = true;
          const baseMatrix = meshTemplate.baseMatrix;
          const tileIndices = new Uint32Array(variantInstances.length);
          const tileX = new Uint16Array(variantInstances.length);
          const tileY = new Uint16Array(variantInstances.length);
          const baseX = new Float32Array(variantInstances.length);
          const baseY = new Float32Array(variantInstances.length);
          const baseZ = new Float32Array(variantInstances.length);
          const baseRotation = new Float32Array(variantInstances.length);
          const baseScale = new Float32Array(variantInstances.length);
          const scalePivotY = new Float32Array(variantInstances.length);
          const fuelReference = new Float32Array(variantInstances.length);
          const burnProgress = new Float32Array(variantInstances.length);
          const burnQ = new Uint8Array(variantInstances.length);
          const visibilityQ = new Uint8Array(variantInstances.length).fill(255);
          const seasonPhaseOffset = seasonVisual ? new Float32Array(variantInstances.length) : null;
          const seasonRateJitter = seasonVisual ? new Float32Array(variantInstances.length) : null;
          const leafDropBias = seasonVisual ? new Float32Array(variantInstances.length) : null;
          const autumnHueBias = seasonVisual ? new Float32Array(variantInstances.length) : null;
          const cropTopAttr =
            role === "trunk"
              ? new THREE.InstancedBufferAttribute(new Float32Array(variantInstances.length), 1)
              : null;
          if (cropTopAttr) {
            cropTopAttr.setUsage(THREE.DynamicDrawUsage);
            cropTopAttr.array.fill(cropMaxY + 1);
            instanced.geometry.setAttribute("aCropTop", cropTopAttr);
          }
          variantInstances.forEach((instance, i) => {
            tileIndices[i] = instance.tileIndex;
            tileX[i] = instance.tileX;
            tileY[i] = instance.tileY;
            baseX[i] = instance.x;
            baseY[i] = instance.y;
            baseZ[i] = instance.z;
            baseRotation[i] = instance.rotation;
            baseScale[i] = instance.scale;
            const treeHeight = Math.max(0.2, variant.height * instance.scale);
            const pivotFactor =
              role === "leaf"
                ? TREE_BURN_LEAF_PIVOT_HEIGHT_FACTOR
                : role === "mixed"
                  ? TREE_BURN_MIXED_PIVOT_HEIGHT_FACTOR
                  : TREE_BURN_TRUNK_PIVOT_HEIGHT_FACTOR;
            scalePivotY[i] = treeHeight * pivotFactor;
            const baseFuel = sample.tileFuel?.[instance.tileIndex] ?? 1;
            fuelReference[i] = Math.max(TREE_BURN_FUEL_EPS, baseFuel);
            dummy.position.set(instance.x, instance.y, instance.z);
            dummy.rotation.set(0, instance.rotation, 0);
            dummy.scale.set(instance.scale, instance.scale, instance.scale);
            dummy.updateMatrix();
            tempMatrix.copy(dummy.matrix).multiply(baseMatrix);
            instanced.setMatrixAt(i, tempMatrix);
            instanced.setColorAt(i, whiteColor);
            if (
              seasonVisual &&
              seasonPhaseOffset &&
              seasonRateJitter &&
              leafDropBias &&
              autumnHueBias
            ) {
              const worldSeed = sample.worldSeed ?? 0;
              const treeTypeId = TREE_TYPE_IDS[instance.treeType] ?? 0;
              const noiseBase =
                worldSeed * 0.000013 +
                instance.tileIndex * 0.173 +
                i * 0.619 +
                variantIndex * 1.331 +
                treeTypeId * 0.41;
              const n0 = noiseAt(noiseBase + 0.11);
              const n1 = noiseAt(noiseBase + 1.37);
              const n2 = noiseAt(noiseBase + 2.71);
              const n3 = noiseAt(noiseBase + 3.97);
              seasonPhaseOffset[i] = (n0 * 2 - 1) * seasonVisual.phaseShiftMax;
              seasonRateJitter[i] = (n1 * 2 - 1) * seasonVisual.rateJitter;
              leafDropBias[i] = (n2 * 2 - 1) * TREE_LEAF_DROP_BIAS_MAX;
              autumnHueBias[i] = (n3 * 2 - 1) * seasonVisual.autumnHueJitter;
            }
          });
          if (
            seasonVisual &&
            seasonPhaseOffset &&
            seasonRateJitter &&
            leafDropBias &&
            autumnHueBias
          ) {
            const geometry = instanced.geometry;
            const phaseAttr = new THREE.InstancedBufferAttribute(seasonPhaseOffset, 1);
            const rateAttr = new THREE.InstancedBufferAttribute(seasonRateJitter, 1);
            const leafAttr = new THREE.InstancedBufferAttribute(leafDropBias, 1);
            const hueAttr = new THREE.InstancedBufferAttribute(autumnHueBias, 1);
            phaseAttr.setUsage(THREE.StaticDrawUsage);
            rateAttr.setUsage(THREE.StaticDrawUsage);
            leafAttr.setUsage(THREE.StaticDrawUsage);
            hueAttr.setUsage(THREE.StaticDrawUsage);
            geometry.setAttribute("aSeasonPhaseOffset", phaseAttr);
            geometry.setAttribute("aSeasonRateJitter", rateAttr);
            geometry.setAttribute("aLeafDropBias", leafAttr);
            geometry.setAttribute("aAutumnHueBias", hueAttr);
          }
          instanced.instanceMatrix.needsUpdate = true;
          if (instanced.instanceColor) {
            instanced.instanceColor.setUsage(THREE.DynamicDrawUsage);
            instanced.instanceColor.needsUpdate = true;
          }
          treeBurnMeshStates.push({
            mesh: instanced,
            role,
            baseMatrix,
            tileIndices,
            tileX,
            tileY,
            baseX,
            baseY,
            baseZ,
            baseRotation,
            baseScale,
            scalePivotY,
            fuelReference,
            burnProgress,
            burnQ,
            visibilityQ,
            cropTopAttr,
            cropMinY,
            cropMaxY
          });
          treeGroup.add(instanced);
        });
      });
    };
    (Object.keys(TREE_MODEL_PATHS) as TreeType[]).forEach((treeType) => {
      addVariantInstances(treeType, getTreeVariants(treeType));
    });
    mesh.add(treeGroup);
  } else if (treeInstances.length > 0) {
    const treeGroup = new THREE.Group();
    const trunkGeometry = new THREE.CylinderGeometry(0.1, 0.12, 1, 6);
    const canopyGeometry = new THREE.SphereGeometry(0.35, 9, 7);
    const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x5f4330, roughness: 0.92, metalness: 0.03 });
    const canopyMaterial = new THREE.MeshStandardMaterial({
      color: 0x4d8f4e,
      roughness: 0.9,
      metalness: 0,
      vertexColors: true
    });
    const trunkMesh = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, treeInstances.length);
    const canopyMesh = new THREE.InstancedMesh(canopyGeometry, canopyMaterial, treeInstances.length);
    const canopyColor = new THREE.Color();
    const dummy = new THREE.Object3D();
    trunkMesh.castShadow = true;
    trunkMesh.receiveShadow = true;
    canopyMesh.castShadow = true;
    canopyMesh.receiveShadow = true;
    treeInstances.forEach((instance, i) => {
      const treeHeight = Math.max(0.7, instance.scale * TREE_HEIGHT_FACTOR * 0.95);
      const trunkHeight = Math.max(0.22, treeHeight * 0.44);
      const canopyHeight = Math.max(0.28, treeHeight * 0.66);
      const canopyRadius = Math.max(0.18, treeHeight * 0.23);
      const trunkRadius = Math.max(0.05, canopyRadius * 0.22);

      dummy.position.set(instance.x, instance.y + trunkHeight * 0.5, instance.z);
      dummy.rotation.set(0, instance.rotation, 0);
      dummy.scale.set(trunkRadius / 0.1, trunkHeight, trunkRadius / 0.1);
      dummy.updateMatrix();
      trunkMesh.setMatrixAt(i, dummy.matrix);

      dummy.position.set(instance.x, instance.y + trunkHeight + canopyHeight * 0.26, instance.z);
      dummy.rotation.set(0, instance.rotation, 0);
      dummy.scale.set(canopyRadius / 0.35, canopyHeight / 0.7, canopyRadius / 0.35);
      dummy.updateMatrix();
      canopyMesh.setMatrixAt(i, dummy.matrix);

      const tint = FOREST_CANOPY_TONES[instance.treeType] ?? FOREST_TONE_BASE;
      canopyColor.setRGB(tint.r / 255, tint.g / 255, tint.b / 255);
      canopyMesh.setColorAt(i, canopyColor);
    });
    trunkMesh.instanceMatrix.needsUpdate = true;
    canopyMesh.instanceMatrix.needsUpdate = true;
    if (canopyMesh.instanceColor) {
      canopyMesh.instanceColor.needsUpdate = true;
    }
    treeGroup.add(trunkMesh);
    treeGroup.add(canopyMesh);
    mesh.add(treeGroup);
  }
  if (scrubPlaceholderInstances.length > 0) {
    const shrubGeometry = new THREE.IcosahedronGeometry(0.24, 0);
    const shrubMaterial = new THREE.MeshStandardMaterial({
      color: 0x5f7d49,
      roughness: 0.94,
      metalness: 0.02,
      vertexColors: true
    });
    const shrubMesh = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, scrubPlaceholderInstances.length);
    const baseScrub = TILE_COLOR_RGB.scrub;
    const baseR = baseScrub.r / 255;
    const baseG = baseScrub.g / 255;
    const baseB = baseScrub.b / 255;
    const tintColor = new THREE.Color();
    const dummy = new THREE.Object3D();
    shrubMesh.castShadow = true;
    shrubMesh.receiveShadow = true;
    scrubPlaceholderInstances.forEach((instance, index) => {
      const tint = 0.9 + instance.colorJitter * 0.22;
      const warmShift = (instance.colorJitter - 0.5) * 0.06;
      tintColor.setRGB(
        clamp(baseR * (tint + warmShift), 0, 1),
        clamp(baseG * (tint + 0.03), 0, 1),
        clamp(baseB * (tint - warmShift * 0.6), 0, 1)
      );
      dummy.position.set(instance.x, instance.y + instance.scale * 0.2, instance.z);
      dummy.rotation.set(0, instance.rotation, 0);
      dummy.scale.set(instance.scale, instance.scale * 0.68, instance.scale);
      dummy.updateMatrix();
      shrubMesh.setMatrixAt(index, dummy.matrix);
      shrubMesh.setColorAt(index, tintColor);
    });
    shrubMesh.instanceMatrix.needsUpdate = true;
    if (shrubMesh.instanceColor) {
      shrubMesh.instanceColor.needsUpdate = true;
    }
    mesh.add(shrubMesh);
  }
  const markStructureTopHeight = (
    minTileX: number,
    maxTileX: number,
    minTileY: number,
    maxTileY: number,
    topY: number
  ): void => {
    const structureTopHeights = surface.structureTopHeightsWorld;
    if (!structureTopHeights || !Number.isFinite(topY)) {
      return;
    }
    const clampedMinX = clamp(Math.floor(minTileX), 0, cols - 1);
    const clampedMaxX = clamp(Math.floor(maxTileX), 0, cols - 1);
    const clampedMinY = clamp(Math.floor(minTileY), 0, rows - 1);
    const clampedMaxY = clamp(Math.floor(maxTileY), 0, rows - 1);
    for (let y = clampedMinY; y <= clampedMaxY; y += 1) {
      const rowBase = y * cols;
      for (let x = clampedMinX; x <= clampedMaxX; x += 1) {
        const idx = rowBase + x;
        structureTopHeights[idx] = Math.max(structureTopHeights[idx] ?? Number.NEGATIVE_INFINITY, topY);
      }
    }
  };
  if (sample.tileTypes && !sample.dynamicStructures) {
    const tileTypes = sample.tileTypes;
    const baseTiles: { tileX: number; tileY: number; x: number; z: number; groundMin: number; groundMax: number }[] = [];
    const houseSpots: HouseSpot[] = [];
    for (let tileY = 0; tileY < rows; tileY += 1) {
      const rowBase = tileY * cols;
      for (let tileX = 0; tileX < cols; tileX += 1) {
        const typeId = tileTypes[rowBase + tileX];
        const normX = (tileX + 0.5) / cols;
        const normZ = (tileY + 0.5) / rows;
        const x = (normX - 0.5) * width;
        const z = (normZ - 0.5) * depth;
        const height = heightAtTile(tileX, tileY) * heightScale;
        const seed = rowBase + tileX;
        const right = Math.min(cols, tileX + 1);
        const bottom = Math.min(rows, tileY + 1);
        const h00 = heightAtTileCoord(tileX, tileY) * heightScale;
        const h10 = heightAtTileCoord(right, tileY) * heightScale;
        const h01 = heightAtTileCoord(tileX, bottom) * heightScale;
        const h11 = heightAtTileCoord(right, bottom) * heightScale;
        const tileGroundMin = Math.min(h00, h10, h01, h11);
        const tileGroundMax = Math.max(h00, h10, h01, h11);
        if (typeId !== baseId && typeId !== houseId) {
          continue;
        }
        if (typeId === baseId) {
          baseTiles.push({ tileX, tileY, x, z, groundMin: tileGroundMin, groundMax: tileGroundMax });
        } else {
          const rotation = pickHouseRotation(tileX, tileY, cols, rows, tileTypes, roadId, baseId, seed);
          const footprint = pickHouseFootprint(seed);
          const bounds = getHouseFootprintBounds(tileX, tileY, rotation, footprint);
          const minX = clamp(bounds.minX, 0, cols - 1);
          const maxX = clamp(bounds.maxX, 0, cols - 1);
          const minY = clamp(bounds.minY, 0, rows - 1);
          const maxY = clamp(bounds.maxY, 0, rows - 1);
          let groundMin = Number.POSITIVE_INFINITY;
          let groundMax = Number.NEGATIVE_INFINITY;
          for (let fy = minY; fy <= maxY + 1; fy += 1) {
            const clampedY = clamp(fy, 0, rows);
            for (let fx = minX; fx <= maxX + 1; fx += 1) {
              const clampedX = clamp(fx, 0, cols);
              const h = heightAtTileCoord(clampedX, clampedY) * heightScale;
              groundMin = Math.min(groundMin, h);
              groundMax = Math.max(groundMax, h);
            }
          }
          if (!Number.isFinite(groundMin) || !Number.isFinite(groundMax)) {
            groundMin = height;
            groundMax = height;
          }
          houseSpots.push({
            x,
            y: height,
            z,
            footprintX: bounds.width,
            footprintZ: bounds.depth,
            minTileX: minX,
            maxTileX: maxX,
            minTileY: minY,
            maxTileY: maxY,
            rotation,
            seed,
            groundMin,
            groundMax,
            variantKey: footprint.name ?? null,
            variantSource: footprint.source ?? null
          });
        }
      }
    }
    const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xa0a7ad, roughness: 0.75, metalness: 0.1 });
    const houseMaterial = new THREE.MeshStandardMaterial({ color: 0xc19a66, roughness: 0.8, metalness: 0.08 });
    const foundationMaterial = new THREE.MeshStandardMaterial({
      color: 0x4b4036,
      roughness: 0.95,
      metalness: 0
    });
    const dummy = new THREE.Object3D();
    if (baseTiles.length > 0) {
      const minTileX = Math.min(...baseTiles.map((tile) => tile.tileX));
      const maxTileX = Math.max(...baseTiles.map((tile) => tile.tileX));
      const minTileY = Math.min(...baseTiles.map((tile) => tile.tileY));
      const maxTileY = Math.max(...baseTiles.map((tile) => tile.tileY));
      const centerTileX = (minTileX + maxTileX) / 2 + 0.5;
      const centerTileY = (minTileY + maxTileY) / 2 + 0.5;
      const centerX = (centerTileX / cols - 0.5) * width;
      const centerZ = (centerTileY / rows - 0.5) * depth;
      const baseFootprintX = Math.max(1, maxTileX - minTileX + 1);
      const baseFootprintZ = Math.max(1, maxTileY - minTileY + 1);
      let groundMin = Math.min(...baseTiles.map((tile) => tile.groundMin));
      let groundMax = Math.max(...baseTiles.map((tile) => tile.groundMax));
      const rotation = baseFootprintX >= baseFootprintZ ? 0 : Math.PI / 2;

      if (useDetailedStructures && firestationAsset && firestationAsset.meshes.length > 0) {
        const footprintTarget = Math.max(baseFootprintX, baseFootprintZ) * 0.85;
        const assetFootprint = Math.max(firestationAsset.size.x, firestationAsset.size.z);
        const scale = footprintTarget / Math.max(0.01, assetFootprint);
        const foundationTop = groundMax + 0.01;
        const baseY = foundationTop + firestationAsset.baseOffset * scale;
        const topY = baseY + Math.max(0.2, firestationAsset.size.y * scale);
        const baseGroup = new THREE.Group();
        const tempMatrix = new THREE.Matrix4();
        firestationAsset.meshes.forEach((meshTemplate) => {
          const instanced = new THREE.InstancedMesh(meshTemplate.geometry, meshTemplate.material, 1);
          instanced.castShadow = true;
          instanced.receiveShadow = true;
          dummy.position.set(centerX, baseY, centerZ);
          dummy.rotation.set(0, rotation, 0);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          tempMatrix.copy(dummy.matrix).multiply(meshTemplate.baseMatrix);
          instanced.setMatrixAt(0, tempMatrix);
          instanced.instanceMatrix.needsUpdate = true;
          baseGroup.add(instanced);
        });
        if (groundMin < foundationTop - 0.01) {
          const foundationHeight = Math.max(0.1, foundationTop - groundMin);
          const foundation = new THREE.Mesh(buildingGeometry, foundationMaterial);
          foundation.scale.set(baseFootprintX, foundationHeight, baseFootprintZ);
          foundation.position.set(centerX, groundMin + foundationHeight / 2, centerZ);
          foundation.rotation.set(0, rotation, 0);
          foundation.castShadow = true;
          foundation.receiveShadow = true;
          baseGroup.add(foundation);
        }
        markStructureTopHeight(minTileX, maxTileX, minTileY, maxTileY, topY);
        mesh.add(baseGroup);
      } else {
        const topY = groundMax + 0.6;
        const base = new THREE.Mesh(buildingGeometry, baseMaterial);
        base.scale.set(baseFootprintX, 0.6, baseFootprintZ);
        base.position.set(centerX, groundMax + 0.3, centerZ);
        base.rotation.set(0, rotation, 0);
        base.castShadow = true;
        base.receiveShadow = true;
        mesh.add(base);
        if (groundMin < groundMax - 0.01) {
          const foundationHeight = Math.max(0.1, groundMax - groundMin);
          const foundation = new THREE.Mesh(buildingGeometry, foundationMaterial);
          foundation.scale.set(baseFootprintX, foundationHeight, baseFootprintZ);
          foundation.position.set(centerX, groundMin + foundationHeight / 2, centerZ);
          foundation.rotation.set(0, rotation, 0);
          foundation.castShadow = true;
          foundation.receiveShadow = true;
          mesh.add(foundation);
        }
        markStructureTopHeight(minTileX, maxTileX, minTileY, maxTileY, topY);
      }
    }

    if (houseSpots.length > 0) {
      const availableHouseVariants = houseAssets?.variants ?? [];
      const houseByKey = new Map<string, HouseVariant[]>();
      const houseBySource = new Map<string, HouseVariant[]>();
      const houseByTheme: Record<HouseVariant["theme"], HouseVariant[]> = {
        brick: [],
        wood: []
      };
      availableHouseVariants.forEach((variant) => {
        houseByTheme[variant.theme].push(variant);
        const sourceKey = variant.source.toLowerCase();
        const sourceList = houseBySource.get(sourceKey);
        if (sourceList) {
          sourceList.push(variant);
        } else {
          houseBySource.set(sourceKey, [variant]);
        }
        if (variant.buildKey) {
          const key = variant.buildKey.toLowerCase();
          const list = houseByKey.get(key);
          if (list) {
            list.push(variant);
          } else {
            houseByKey.set(key, [variant]);
          }
        }
      });
      const pickHouseVariant = (spot: HouseSpot): HouseVariant | null => {
        const key = spot.variantKey ? spot.variantKey.toLowerCase() : null;
        if (key) {
          const matches = houseByKey.get(key);
          if (matches && matches.length > 0) {
            const index = Math.floor(noiseAt(spot.seed + 0.2) * matches.length);
            return matches[Math.min(matches.length - 1, Math.max(0, index))];
          }
        }
        const source = (spot.variantSource ?? "").toLowerCase();
        if (source) {
          const sourceMatches = houseBySource.get(source);
          if (sourceMatches && sourceMatches.length > 0) {
            const index = Math.floor(noiseAt(spot.seed + 0.27) * sourceMatches.length);
            return sourceMatches[Math.min(sourceMatches.length - 1, Math.max(0, index))];
          }
        }
        const theme =
          /brick/i.test(source) ? "brick" : /wood/i.test(source) ? "wood" : null;
        const bucket = theme ? houseByTheme[theme] : availableHouseVariants;
        if (bucket.length === 0) {
          return null;
        }
        const index = Math.floor(noiseAt(spot.seed + 0.2) * bucket.length);
        return bucket[Math.min(bucket.length - 1, Math.max(0, index))];
      };
      type HouseBatchInstance = { spot: HouseSpot; scale: number; baseY: number };
      type FoundationInstance = {
        x: number;
        y: number;
        z: number;
        scaleX: number;
        scaleY: number;
        scaleZ: number;
        rotation: number;
      };
      const variantIds = new Map<HouseVariant, number>();
      availableHouseVariants.forEach((variant, index) => {
        variantIds.set(variant, index);
      });
      const detailedBatches = new Map<string, { template: TreeMeshTemplate; instances: HouseBatchInstance[] }>();
      const fallbackInstances: HouseSpot[] = [];
      const foundationInstances: FoundationInstance[] = [];

      houseSpots.forEach((spot) => {
        const footprintX = Math.max(0.5, spot.footprintX);
        const footprintZ = Math.max(0.5, spot.footprintZ);
        const foundationTop = spot.groundMax + 0.01;
        if (spot.groundMin < foundationTop - 0.01) {
          const foundationHeight = Math.max(0.1, foundationTop - spot.groundMin);
          foundationInstances.push({
            x: spot.x,
            y: spot.groundMin + foundationHeight / 2,
            z: spot.z,
            scaleX: footprintX,
            scaleY: foundationHeight,
            scaleZ: footprintZ,
            rotation: spot.rotation
          });
        }
        const variant = pickHouseVariant(spot);
        if (useDetailedStructures && variant && variant.meshes.length > 0) {
          const sizeX = Math.max(0.01, variant.size?.x ?? 0);
          const sizeZ = Math.max(0.01, variant.size?.z ?? 0);
          const sizeY = Math.max(0.2, variant.size?.y ?? 0.6);
          const fitScale = Math.min(footprintX / sizeX, footprintZ / sizeZ);
          const scale = Math.max(0.01, fitScale * 0.98 * (variant.scaleBias ?? 1));
          const baseY = foundationTop + variant.baseOffset * scale;
          const topY = baseY + sizeY * scale;
          const variantId = variantIds.get(variant) ?? 0;
          markStructureTopHeight(spot.minTileX, spot.maxTileX, spot.minTileY, spot.maxTileY, topY);
          variant.meshes.forEach((meshTemplate, meshIndex) => {
            const key = `${variantId}:${meshIndex}`;
            const existing = detailedBatches.get(key);
            if (existing) {
              existing.instances.push({ spot, scale, baseY });
            } else {
              detailedBatches.set(key, {
                template: meshTemplate,
                instances: [{ spot, scale, baseY }]
              });
            }
          });
        } else {
          markStructureTopHeight(spot.minTileX, spot.maxTileX, spot.minTileY, spot.maxTileY, foundationTop + 0.6);
          fallbackInstances.push(spot);
        }
      });

      const tempMatrix = new THREE.Matrix4();
      detailedBatches.forEach((batch) => {
        const { template, instances } = batch;
        if (instances.length === 0) {
          return;
        }
        const instanced = new THREE.InstancedMesh(template.geometry, template.material, instances.length);
        instanced.castShadow = true;
        instanced.receiveShadow = true;
        instances.forEach((instance, index) => {
          dummy.position.set(instance.spot.x, instance.baseY, instance.spot.z);
          dummy.rotation.set(0, instance.spot.rotation, 0);
          dummy.scale.set(instance.scale, instance.scale, instance.scale);
          dummy.updateMatrix();
          tempMatrix.copy(dummy.matrix).multiply(template.baseMatrix);
          instanced.setMatrixAt(index, tempMatrix);
        });
        instanced.instanceMatrix.needsUpdate = true;
        mesh.add(instanced);
      });

      if (fallbackInstances.length > 0) {
        const fallbackMesh = new THREE.InstancedMesh(buildingGeometry, houseMaterial, fallbackInstances.length);
        fallbackMesh.castShadow = true;
        fallbackMesh.receiveShadow = true;
        fallbackInstances.forEach((spot, index) => {
          const footprintX = Math.max(0.5, spot.footprintX);
          const footprintZ = Math.max(0.5, spot.footprintZ);
          const foundationTop = spot.groundMax + 0.01;
          dummy.position.set(spot.x, foundationTop + 0.3, spot.z);
          dummy.rotation.set(0, spot.rotation, 0);
          dummy.scale.set(footprintX, 0.6, footprintZ);
          dummy.updateMatrix();
          fallbackMesh.setMatrixAt(index, dummy.matrix);
        });
        fallbackMesh.instanceMatrix.needsUpdate = true;
        mesh.add(fallbackMesh);
      }

      if (foundationInstances.length > 0) {
        const foundationMesh = new THREE.InstancedMesh(buildingGeometry, foundationMaterial, foundationInstances.length);
        foundationMesh.castShadow = true;
        foundationMesh.receiveShadow = true;
        foundationInstances.forEach((instance, index) => {
          dummy.position.set(instance.x, instance.y, instance.z);
          dummy.rotation.set(0, instance.rotation, 0);
          dummy.scale.set(instance.scaleX, instance.scaleY, instance.scaleZ);
          dummy.updateMatrix();
          foundationMesh.setMatrixAt(index, dummy.matrix);
        });
        foundationMesh.instanceMatrix.needsUpdate = true;
        mesh.add(foundationMesh);
      }
    }

  }
  const townLabelGroup = buildTownLabelGroup({
    towns: sample.towns,
    width,
    depth,
    cols,
    rows,
    heightScale,
    heightAtTile
  });
  if (townLabelGroup) {
    mesh.add(townLabelGroup);
  }

  let water: TerrainWaterData | undefined;
  const oceanLevel = waterLevel;
  const ratios = waterRatios;
  const supportMask = waterSupportMask;
  let hasVisibleWater = false;
  for (let i = 0; i < supportMask.length; i += 1) {
    if (supportMask[i] > 0) {
      hasVisibleWater = true;
      break;
    }
  }
  if (hasVisibleWater) {
    let resolvedOceanRatios = oceanRenderRatios;
    let resolvedOceanSupportMask = surfaceOceanSupportMask;
    let resolvedSurfAttenuation = oceanSurfAttenuation;
    if (!resolvedOceanRatios || !resolvedOceanSupportMask || !resolvedSurfAttenuation) {
      const oceanRenderSupport = buildOceanRenderSupportData(
        cols,
        rows,
        sampleCols,
        sampleRows,
        step,
        sampleTypes,
        waterId,
        ratios,
        sampleOceanCoverage,
        sampleCoastClass,
        sampleCoastDistance,
        coastData
      );
      resolvedOceanRatios = oceanRenderSupport.oceanRatios;
      resolvedOceanSupportMask = oceanRenderSupport.oceanSupportMask;
      resolvedSurfAttenuation = oceanRenderSupport.surfAttenuation;
      surface.oceanRenderRatios = resolvedOceanRatios;
      surface.oceanSupportMask = resolvedOceanSupportMask;
      surface.oceanSurfAttenuation = resolvedSurfAttenuation;
    }
    const zeroRiver = new Float32Array(sampleCols * sampleRows);
    const oceanMaskTexture = buildWaterMaskTexture(sampleCols, sampleRows, resolvedOceanRatios);
    const oceanSupportMap = buildWaterSupportMapTexture(sampleCols, sampleRows, resolvedOceanSupportMask);
    const shoreSdf = buildShoreSdfTextureFromSupportMask(resolvedOceanSupportMask, sampleCols, sampleRows);
    const normalizedOceanHeights = buildWaterSurfaceHeights(
      sampleHeights,
      resolvedOceanSupportMask,
      resolvedOceanRatios.ocean,
      zeroRiver,
      sampleCols,
      sampleRows,
      oceanLevel,
      undefined,
      undefined,
      {
        oceanRatioMin: OCEAN_RATIO_MIN,
        riverRatioMin: RIVER_RATIO_MIN
      }
    );
    const normalizedWaterHeights = waterSurfaceHeights;
    const oceanFlowMap = buildRiverFlowTexture(
      normalizedOceanHeights,
      sampleTypes,
      sampleCols,
      sampleRows,
      waterId,
      zeroRiver
    );
    const oceanRapidMap = buildRapidMapTexture(
      normalizedOceanHeights,
      sampleCols,
      sampleRows,
      resolvedOceanRatios,
      undefined
    );
    let representativeLevel = oceanLevel;
    if (representativeLevel === null) {
      let oceanWeightedSum = 0;
      let oceanWeightedCount = 0;
      const fallbackWeightedValues: number[] = [];
      for (let i = 0; i < normalizedOceanHeights.length; i += 1) {
        const waterRatio = resolvedOceanRatios.water[i] ?? 0;
        if (waterRatio < WATER_ALPHA_MIN_RATIO) {
          continue;
        }
        const h = clamp(normalizedOceanHeights[i] ?? 0, 0, 1);
        const oceanWeight = clamp(resolvedOceanRatios.ocean[i] ?? 0, 0, 1);
        if (oceanWeight >= OCEAN_RATIO_MIN * 0.5) {
          const weight = Math.max(oceanWeight, 0.001);
          oceanWeightedSum += h * weight;
          oceanWeightedCount += weight;
        }
        const w = Math.max(waterRatio, 0.001);
        const repeats = Math.max(1, Math.min(4, Math.floor(w * 4)));
        for (let r = 0; r < repeats; r += 1) {
          fallbackWeightedValues.push(h);
        }
      }
      if (oceanWeightedCount > 0) {
        representativeLevel = oceanWeightedSum / oceanWeightedCount;
      } else if (fallbackWeightedValues.length > 0) {
        fallbackWeightedValues.sort((a, b) => a - b);
        const qIndex = Math.floor((fallbackWeightedValues.length - 1) * 0.25);
        representativeLevel = fallbackWeightedValues[Math.max(0, qIndex)] ?? null;
      }
    }
    const fallbackLevelWorld = waterCount > 0 ? waterHeightSum / Math.max(1, waterCount) : 0;
    const waterLevelWorld =
      representativeLevel !== null ? clamp(representativeLevel, 0, 1) * heightScale : fallbackLevelWorld;
    const shoreTerrainHeightAboveWater = new Float32Array(sampleCols * sampleRows);
    for (let i = 0; i < sampleCols * sampleRows; i += 1) {
      const terrainWorld = (sampleHeights[i] ?? 0) * heightScale;
      shoreTerrainHeightAboveWater[i] = Math.max(0, terrainWorld - waterLevelWorld);
    }
    const oceanDomainMap = buildWaterDomainMapTexture(
      sampleCols,
      sampleRows,
      resolvedOceanRatios,
      resolvedSurfAttenuation,
      shoreTerrainHeightAboveWater
    );
    const resolvedShoreTransition =
      shoreTransition ??
      buildShoreTransitionData({
        sampleCols,
        sampleRows,
        oceanSupportMask: resolvedOceanSupportMask,
        sampleCoastClass,
        coastData,
        shoreTerrainHeightAboveWater,
        oceanRatio: resolvedOceanRatios.ocean
      });
    surface.shoreTransition = resolvedShoreTransition;
    const shoreTransitionMap = buildShoreTransitionMapTexture(sampleCols, sampleRows, resolvedShoreTransition);
    applyShoreTransitionTerrainMaterial(material, { shoreTransitionMap });
    const oceanHeights = new Float32Array(normalizedOceanHeights.length);
    for (let i = 0; i < normalizedOceanHeights.length; i += 1) {
      const surfaceWorld = clamp(normalizedOceanHeights[i] ?? 0, 0, 1) * heightScale;
      oceanHeights[i] = surfaceWorld - waterLevelWorld + WATER_SURFACE_LIFT_OCEAN;
    }
    const waterHeights = new Float32Array(normalizedWaterHeights.length);
    let validationCount = 0;
    let terrainWaterMean = 0;
    let surfaceWaterMean = 0;
    for (let i = 0; i < normalizedWaterHeights.length; i += 1) {
      const ratio = ratios.water[i] ?? 0;
      const riverRatio = clamp(ratios.river[i] ?? 0, 0, 1);
      const riverWeight = clamp((riverRatio - 0.08) / 0.42, 0, 1);
      const lift = WATER_SURFACE_LIFT_OCEAN * (1 - riverWeight) + WATER_SURFACE_LIFT_RIVER * riverWeight;
      let surfaceWorld = clamp(normalizedWaterHeights[i] ?? 0, 0, 1) * heightScale;
      if (riverRatio >= RIVER_RATIO_MIN) {
        const x = i % sampleCols;
        const y = Math.floor(i / sampleCols);
        let minBankWorld = Number.POSITIVE_INFINITY;
        const neighbors = [
          { x: x - 1, y },
          { x: x + 1, y },
          { x, y: y - 1 },
          { x, y: y + 1 },
          { x: x - 1, y: y - 1 },
          { x: x + 1, y: y - 1 },
          { x: x - 1, y: y + 1 },
          { x: x + 1, y: y + 1 }
        ];
        for (const neighbor of neighbors) {
          if (
            neighbor.x < 0 ||
            neighbor.y < 0 ||
            neighbor.x >= sampleCols ||
            neighbor.y >= sampleRows
          ) {
            continue;
          }
          const nIdx = neighbor.y * sampleCols + neighbor.x;
          if (supportMask[nIdx] > 0) {
            continue;
          }
          minBankWorld = Math.min(minBankWorld, (sampleHeights[nIdx] ?? 0) * heightScale);
        }
        if (Number.isFinite(minBankWorld)) {
          const maxSurfaceWorld = minBankWorld - RIVER_SURFACE_BANK_CLEARANCE;
          surfaceWorld = Math.min(surfaceWorld, maxSurfaceWorld);
        }
      }
      const offsetY = surfaceWorld - waterLevelWorld + lift;
      waterHeights[i] = offsetY;
      if (ratio < WATER_ALPHA_MIN_RATIO || riverRatio >= RIVER_RATIO_MIN) {
        continue;
      }
      if (DEBUG_TERRAIN_RENDER) {
        validationCount += 1;
        terrainWaterMean += (sampleHeights[i] ?? 0) * heightScale;
        surfaceWaterMean += waterLevelWorld + offsetY;
      }
    }
    if (DEBUG_TERRAIN_RENDER && validationCount > 0) {
      terrainWaterMean /= validationCount;
      surfaceWaterMean /= validationCount;
      const delta = Math.abs(surfaceWaterMean - terrainWaterMean);
      if (delta > 0.35) {
        console.warn(
          `[threeTestTerrain] Water/terrain mean Y mismatch: delta=${delta.toFixed(3)} terrain=${terrainWaterMean.toFixed(3)} surface=${surfaceWaterMean.toFixed(3)} samples=${validationCount}`
        );
      }
    }
    const waterfallMinDrop = Math.max(0.12, WATERFALL_MIN_DROP_NORM * heightScale);
    const waterfallRiverDomain: WaterfallRiverDomainInput | undefined = riverRenderDomain
      ? {
          cols: riverRenderDomain.cols,
          rows: riverRenderDomain.rows,
          boundaryEdges: riverRenderDomain.boundaryEdges,
          cutoutBoundaryEdges: riverRenderDomain.cutoutBoundaryEdges,
          debugStats: riverRenderDomain.debugStats
        }
      : undefined;
    const waterfall = buildWaterfallInstances(
      waterHeights,
      supportMask,
      ratios.ocean,
      sampleCols,
      sampleRows,
      step,
      ratios.river,
      sampledRiverStepStrength,
      waterfallMinDrop,
      width,
      depth,
      waterfallRiverDomain
    );
    const waterfallInstances = waterfall.instances;
    const river = buildRiverMeshData(
      sample,
      waterId,
      heightScale,
      width,
      depth,
      waterLevelWorld,
      riverRenderDomain,
      waterfallInstances
    );
    water = {
      ocean: {
        mask: oceanMaskTexture,
        supportMap: oceanSupportMap,
        domainMap: oceanDomainMap,
        shoreSdf,
        shoreTransitionMap,
        flowMap: oceanFlowMap,
        rapidMap: oceanRapidMap,
        level: waterLevelWorld,
        sampleCols,
        sampleRows,
        width,
        depth,
        heights: oceanHeights
      },
      river,
      waterfallInstances,
      waterfallDebug: waterfall.debug
    };
  }

  const treeTileProfiles = new Map<number, TreeFlameProfile>();
  treeTileProfilesRaw.forEach((profile, tileIndex) => {
    const count = Math.max(1, profile.count);
    treeTileProfiles.set(tileIndex, {
      x: profile.x / count,
      y: profile.y / count,
      z: profile.z / count,
      crownHeight: profile.crownHeight / count,
      crownRadius: profile.crownRadius / count,
      trunkHeight: profile.trunkHeight / count,
      treeCount: count
    });
  });
  const treeBurn =
    treeBurnMeshStates.length > 0
      ? createTreeBurnController(treeBurnMeshStates, TILE_TYPE_IDS.ash, treeTileProfiles)
      : undefined;
  return { mesh, size: { width, depth }, water, treeBurn };
};


