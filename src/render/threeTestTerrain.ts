import * as THREE from "three";
import {
  DEBUG_TERRAIN_RENDER,
  ENABLE_GRASS_DETAIL_FX,
  FUEL_PROFILES,
  HEIGHT_MAP_RATIO,
  HEIGHT_SCALE,
  TILE_COLOR_RGB,
  TILE_SIZE
} from "../core/config.js";
import { HOUSE_VARIANTS } from "../core/buildingFootprints.js";
import { TILE_ID_TO_TYPE, TILE_TYPE_IDS } from "../core/state.js";
import { TreeType, TREE_TYPE_IDS, type Town } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import type { FirestationAsset, HouseAssets, HouseVariant, TreeAssets, TreeMeshTemplate, TreeVariant } from "./threeTestAssets.js";
import { TREE_MODEL_PATHS } from "./threeTestAssets.js";
import { applyGrassDetailFx } from "./grassDetailFx.js";

export type TerrainSample = {
  cols: number;
  rows: number;
  elevations: Float32Array;
  tileTypes?: Uint8Array;
  treeTypes?: Uint8Array;
  tileFuel?: Float32Array;
  tileMoisture?: Float32Array;
  riverMask?: Uint8Array;
  roadBridgeMask?: Uint8Array;
  roadEdges?: Uint8Array;
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
  structureRevision?: number;
  dynamicStructures?: boolean;
};

export type TreeSeasonVisualConfig = {
  enabled: boolean;
  uniforms: {
    uRisk01: { value: number };
    uSeasonT01: { value: number };
    uWorldSeed: { value: number };
  };
  phaseShiftMax: number;
  rateJitter: number;
  autumnHueJitter: number;
};

type RGB = { r: number; g: number; b: number };

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const mixRgb = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t
});
const lighten = (color: RGB, amount: number): RGB => mixRgb(color, { r: 255, g: 255, b: 255 }, clamp(amount, 0, 1));
const darken = (color: RGB, amount: number): RGB => mixRgb(color, { r: 0, g: 0, b: 0 }, clamp(amount, 0, 1));

type RiverSpaceTransform = {
  worldToEdgeX: (worldX: number) => number;
  worldToEdgeY: (worldZ: number) => number;
  edgeToWorldX: (edgeX: number) => number;
  edgeToWorldY: (edgeY: number) => number;
  gridToEdgeX: (gridX: number) => number;
  gridToEdgeY: (gridY: number) => number;
  edgeToGridX: (edgeX: number) => number;
  edgeToGridY: (edgeY: number) => number;
};

const createRiverSpaceTransform = (
  cols: number,
  rows: number,
  width: number,
  depth: number,
  sampleCols: number,
  sampleRows: number
): RiverSpaceTransform => {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const safeWidth = Math.max(1e-5, width);
  const safeDepth = Math.max(1e-5, depth);
  const safeSampleCols = Math.max(1, sampleCols - 1);
  const safeSampleRows = Math.max(1, sampleRows - 1);
  return {
    worldToEdgeX: (worldX: number): number => (worldX / safeWidth + 0.5) * safeCols,
    worldToEdgeY: (worldZ: number): number => (worldZ / safeDepth + 0.5) * safeRows,
    edgeToWorldX: (edgeX: number): number => (edgeX / safeCols - 0.5) * safeWidth,
    edgeToWorldY: (edgeY: number): number => (edgeY / safeRows - 0.5) * safeDepth,
    gridToEdgeX: (gridX: number): number => (gridX / safeSampleCols) * safeCols,
    gridToEdgeY: (gridY: number): number => (gridY / safeSampleRows) * safeRows,
    edgeToGridX: (edgeX: number): number => (edgeX / safeCols) * safeSampleCols,
    edgeToGridY: (edgeY: number): number => (edgeY / safeRows) * safeSampleRows
  };
};

const validateRiverSpaceTransform = (
  transform: RiverSpaceTransform,
  sampleCols: number,
  sampleRows: number
): { worldRoundTripMax: number; sampleRoundTripMax: number } => {
  let worldRoundTripMax = 0;
  let sampleRoundTripMax = 0;
  const samplePoints = [
    [0, 0],
    [sampleCols - 1, 0],
    [0, sampleRows - 1],
    [sampleCols - 1, sampleRows - 1],
    [(sampleCols - 1) * 0.5, (sampleRows - 1) * 0.5],
    [(sampleCols - 1) * 0.25, (sampleRows - 1) * 0.6],
    [(sampleCols - 1) * 0.73, (sampleRows - 1) * 0.19]
  ];
  for (let i = 0; i < samplePoints.length; i += 1) {
    const point = samplePoints[i];
    const gridX = point[0];
    const gridY = point[1];
    const edgeX = transform.gridToEdgeX(gridX);
    const edgeY = transform.gridToEdgeY(gridY);
    const worldX = transform.edgeToWorldX(edgeX);
    const worldY = transform.edgeToWorldY(edgeY);
    const edgeBackX = transform.worldToEdgeX(worldX);
    const edgeBackY = transform.worldToEdgeY(worldY);
    worldRoundTripMax = Math.max(worldRoundTripMax, Math.abs(edgeBackX - edgeX), Math.abs(edgeBackY - edgeY));
    const gridBackX = transform.edgeToGridX(edgeX);
    const gridBackY = transform.edgeToGridY(edgeY);
    sampleRoundTripMax = Math.max(sampleRoundTripMax, Math.abs(gridBackX - gridX), Math.abs(gridBackY - gridY));
  }
  return { worldRoundTripMax, sampleRoundTripMax };
};

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

const TERRAIN_HEIGHT_EXAGGERATION = 1.35;
const HEIGHT_SAMPLE_PEAK_WEIGHT = 0.65;
const WATER_ALPHA_MIN_RATIO = 0.1;
const OCEAN_RATIO_MIN = 0.1;
const RIVER_RATIO_MIN = 0.2;
const OCEAN_SAMPLE_SUPPORT_FLOOR = 0.12;
const WATER_ALPHA_POWER = 0.85;
const SHORE_SDF_MAX_DISTANCE = 7;
const RIVER_BANK_MAX_DISTANCE = 5;
const WATERFALL_MAX_INSTANCES = 96;
const WATERFALL_MIN_DROP_NORM = 0.006;
const WATERFALL_MIN_RIVER_RATIO = 0.28;
const WATERFALL_MAX_DROP = 1.6;
const WATERFALL_MAX_OCEAN_RATIO = 0.08;
const WATERFALL_MIN_STEP_STRENGTH = 0.12;
const WATER_SURFACE_LIFT_OCEAN = 0.08;
const WATER_SURFACE_LIFT_RIVER = 0.012;
const RIVER_SURFACE_BANK_CLEARANCE = 0.02;
const RIVER_MIN_DEPTH_NORM = 0.006;
const WATERFALL_TOP_OFFSET = 0.04;
const WATERFALL_DROP_PADDING = 0.05;
const RIVER_STEP_BLEND_BLOCK_THRESHOLD = 0.26;
const RIVER_MIN_VISUAL_WIDTH_CELLS = 1.35;
const RIVER_DIAGONAL_FILL_MAX_ADDS_PER_CELL = 1;
const RIVER_WIDTH_EXPAND_MAX_PASSES = 1;
const RIVER_FIELD_THRESHOLD = 0.5;
const RIVER_VERTEX_FIELD_BLUR_BLEND = 0;
const RIVER_CUTOUT_FIELD_DILATE = 0;
const BANK_INSET = 0.004;
const WALL_MIN_HEIGHT = 0.02;
const WALL_RISE_GUARD = 0.001;
const WALL_TOP_OVERLAP = 0.0012;
const WALL_TOP_MAX_UNDERCUT = 0.0004;
const WALL_WATER_OVERLAP = 0.002;
const RIVER_EDGE_SURFACE_UNDERSHOOT = 0.002;
const WATERFALL_ANCHOR_ERR_WARN = 0.03;
const WALL_TOP_GAP_WARN = 0.05;
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
const TREE_BURN_UPDATE_INTERVAL_MS = 120;
const TREE_BURN_FUEL_EPS = 0.02;
const TREE_BURN_FIRE_BOUNDS_PADDING = 2;
const TREE_BURN_VISIBLE_EPS = 0.004;
const TREE_BURN_PROGRESS_PER_SECOND = 0.12;
const TREE_BURN_RECOVERY_PER_SECOND = 0.08;
const TREE_BURN_ASH_CATCHUP_PER_SECOND = 1.85;
const TREE_BURN_POST_FIRE_TAIL_MS = 8000;
const TREE_BURN_ACTIVE_FIRE_EPS = 0.015;
const TREE_BURN_ACTIVE_HEAT_EPS = 0.12;
const TREE_BURN_CARRY_HEAT_EPS = 0.08;
const TREE_BURN_VISUAL_EPS = 0.06;
const TREE_BURN_FUEL_GAUGE_START = 0.16;
const TREE_BURN_FUEL_GAUGE_END = 0.95;
const TREE_BURN_EMBER_TAIL_START = 0.58;
const TREE_BURN_EMBER_TAIL_END = 0.98;
const TREE_BURN_COMPLETE_TARGET = 1.12;
const TREE_BURN_LEAF_PIVOT_HEIGHT_FACTOR = 0.72;
const TREE_BURN_MIXED_PIVOT_HEIGHT_FACTOR = 0.46;
const TREE_BURN_TRUNK_PIVOT_HEIGHT_FACTOR = 0.06;
const TREE_LEAF_DROP_BIAS_MAX = 0.22;
const TOWN_LABEL_SCREEN_HEIGHT = 0.025;
const TOWN_LABEL_LIFT_METERS = 100;
const ENABLE_TOWN_LABEL_SPRITES = false;
export const ROAD_SURFACE_WIDTH = 0.5;
const ROAD_SURFACE_OFFSET = 0.001;
export const ROAD_TEX_SCALE = 12;
const ROAD_TEX_MAX_SIZE = 4096;
const ROAD_ATLAS_V2_METADATA_PATH = "assets/textures/road_atlas_v2.json";
const ROAD_ATLAS_FALLBACK_IMAGE_PATH = "assets/textures/ROAD_TILES.png";
const ROAD_ATLAS_FALLBACK_TILE_SIZE = 64;
let roadOverlayMaxSize = ROAD_TEX_MAX_SIZE;

export const setRoadOverlayMaxSize = (size: number): void => {
  const safe = Math.max(256, Math.floor(size));
  roadOverlayMaxSize = safe;
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
const DRY_TINT_BY_TILE: Record<number, [number, number, number]> = {
  [TILE_TYPE_IDS.grass]: [0.72, 0.62, 0.34],
  [TILE_TYPE_IDS.scrub]: [0.68, 0.58, 0.32],
  [TILE_TYPE_IDS.floodplain]: [0.66, 0.61, 0.42],
  [TILE_TYPE_IDS.forest]: [0.48, 0.44, 0.28]
};
const WET_TINT_BY_TILE: Record<number, [number, number, number]> = {
  [TILE_TYPE_IDS.grass]: [0.38, 0.56, 0.32],
  [TILE_TYPE_IDS.scrub]: [0.42, 0.53, 0.33],
  [TILE_TYPE_IDS.floodplain]: [0.48, 0.6, 0.4],
  [TILE_TYPE_IDS.forest]: [0.33, 0.46, 0.31]
};
const SCORCH_WARM_TINT: [number, number, number] = [0.34, 0.25, 0.16];
const SCORCH_CHAR_TINT: [number, number, number] = [0.19, 0.18, 0.17];
const BASE_FUEL_BY_TILE_ID = TILE_ID_TO_TYPE.map((tileType) => Math.max(0, FUEL_PROFILES[tileType]?.baseFuel ?? 0));

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

type TreeBurnMeshRole = "leaf" | "trunk" | "mixed";

type TreeBurnMeshState = {
  mesh: THREE.InstancedMesh;
  role: TreeBurnMeshRole;
  baseMatrix: THREE.Matrix4;
  tileIndices: Uint32Array;
  tileX: Uint16Array;
  tileY: Uint16Array;
  baseX: Float32Array;
  baseY: Float32Array;
  baseZ: Float32Array;
  baseRotation: Float32Array;
  baseScale: Float32Array;
  scalePivotY: Float32Array;
  fuelReference: Float32Array;
  burnProgress: Float32Array;
  burnQ: Uint8Array;
  visibilityQ: Uint8Array;
  cropTopAttr: THREE.InstancedBufferAttribute | null;
  cropMinY: number;
  cropMaxY: number;
};

export type TreeFlameProfile = {
  x: number;
  y: number;
  z: number;
  crownHeight: number;
  crownRadius: number;
  trunkHeight: number;
  treeCount: number;
};

export type TreeBurnController = {
  update: (timeMs: number, world: WorldState) => void;
  getTileBurnVisual: (tileIndex: number) => number;
  getTileBurnProgress: (tileIndex: number) => number;
  getTileAnchor: (tileIndex: number) => { x: number; y: number; z: number } | null;
  getTileFlameProfile: (tileIndex: number) => TreeFlameProfile | null;
  getVisualBounds: () => { minX: number; maxX: number; minY: number; maxY: number } | null;
};

export type OceanWaterData = {
  mask: THREE.DataTexture;
  supportMap: THREE.DataTexture;
  domainMap: THREE.DataTexture;
  shoreSdf: THREE.DataTexture;
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

export type RiverWaterData = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  wallPositions?: Float32Array;
  wallUvs?: Float32Array;
  wallIndices?: Uint32Array;
  bankDist: Float32Array;
  flowDir: Float32Array;
  flowSpeed: Float32Array;
  rapid: Float32Array;
  supportMap: THREE.DataTexture;
  flowMap: THREE.DataTexture;
  rapidMap: THREE.DataTexture;
  riverBankMap: THREE.DataTexture;
  waterfallInfluenceMap: THREE.DataTexture;
  level: number;
  cols: number;
  rows: number;
  width: number;
  depth: number;
  debugRiverDomainStats?: RiverDomainDebugStats;
};

export type TerrainWaterData = {
  ocean: OceanWaterData;
  river?: RiverWaterData;
  // Packed x,z,top,drop,dirX,dirZ,width; top/drop are world-space offsets relative to `level`.
  waterfallInstances?: Float32Array;
};

type HouseSpot = {
  x: number;
  y: number;
  z: number;
  footprintX: number;
  footprintZ: number;
  rotation: number;
  seed: number;
  groundMin: number;
  groundMax: number;
  variantKey: string | null;
  variantSource: string | null;
};

type WaterComponent = {
  indices: number[];
  min: number;
};

type WaterfallCandidate = {
  sampleCol: number;
  sampleRow: number;
  x: number;
  z: number;
  top: number;
  drop: number;
  dirX: number;
  dirZ: number;
  width: number;
};

type RiverContourVertex = {
  x: number;
  y: number;
};

type RiverContourEdge = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
};

type RiverContourPolygon = RiverContourVertex[];

type RiverDomainDebugStats = {
  baseCount: number;
  renderCount: number;
  contourVertexCount: number;
  contourTriangleCount: number;
  boundaryEdgeCount: number;
  cutoutBoundaryEdgeCount: number;
  boundaryMismatchMean: number;
  boundaryMismatchMax: number;
  wallQuadCount: number;
  protrudingVertexRatio: number;
  waterfallAnchorErrorMean: number;
  waterfallAnchorErrorMax: number;
  wallTopGapMean: number;
  wallTopGapMax: number;
};

type RiverRenderDomain = {
  cols: number;
  rows: number;
  baseSupport: Uint8Array;
  renderSupport: Uint8Array;
  vertexField: Float32Array;
  contourVertices: Float32Array;
  contourIndices: Uint32Array;
  boundaryEdges: Float32Array;
  cutoutBoundaryEdges: Float32Array;
  cutoutBoundaryVertexHeights?: Float32Array;
  cutoutBoundaryWallEdges?: Float32Array;
  distanceToBank: Int16Array;
  debugStats?: RiverDomainDebugStats;
};

type WaterSampleRatios = {
  water: Float32Array;
  ocean: Float32Array;
  river: Float32Array;
};

type SampleFloatReducer = "mean" | "min" | "max";

type RoadAtlas = {
  canvas: HTMLCanvasElement;
  tileSize: number;
  tileStride: number;
  cols: number;
  rows: number;
  version: number;
  tiles: Record<string, { col: number; row: number }>;
};

type RoadAtlasMetadata = {
  version: number;
  image: string;
  tileSize: number;
  tileStride: number;
  tiles: Record<string, { col: number; row: number }>;
};

const ROAD_EDGE_N = 1 << 0;
const ROAD_EDGE_E = 1 << 1;
const ROAD_EDGE_S = 1 << 2;
const ROAD_EDGE_W = 1 << 3;
const ROAD_EDGE_NE = 1 << 4;
const ROAD_EDGE_NW = 1 << 5;
const ROAD_EDGE_SE = 1 << 6;
const ROAD_EDGE_SW = 1 << 7;
const ROAD_EDGE_CARDINAL_MASK = ROAD_EDGE_N | ROAD_EDGE_E | ROAD_EDGE_S | ROAD_EDGE_W;
const ROAD_EDGE_DIAGONAL_MASK = ROAD_EDGE_NE | ROAD_EDGE_NW | ROAD_EDGE_SE | ROAD_EDGE_SW;

const ROAD_EDGE_DIRS: Array<{ dx: number; dy: number; bit: number; diagonal: boolean }> = [
  { dx: 0, dy: -1, bit: ROAD_EDGE_N, diagonal: false },
  { dx: 1, dy: 0, bit: ROAD_EDGE_E, diagonal: false },
  { dx: 0, dy: 1, bit: ROAD_EDGE_S, diagonal: false },
  { dx: -1, dy: 0, bit: ROAD_EDGE_W, diagonal: false },
  { dx: 1, dy: -1, bit: ROAD_EDGE_NE, diagonal: true },
  { dx: -1, dy: -1, bit: ROAD_EDGE_NW, diagonal: true },
  { dx: 1, dy: 1, bit: ROAD_EDGE_SE, diagonal: true },
  { dx: -1, dy: 1, bit: ROAD_EDGE_SW, diagonal: true }
];

const ROAD_ATLAS_FALLBACK_METADATA: RoadAtlasMetadata = {
  version: 2,
  image: ROAD_ATLAS_FALLBACK_IMAGE_PATH,
  tileSize: ROAD_ATLAS_FALLBACK_TILE_SIZE,
  tileStride: ROAD_ATLAS_FALLBACK_TILE_SIZE,
  tiles: {
    base_isolated: { col: 0, row: 0 },
    base_endcap_cardinal: { col: 1, row: 0 },
    base_endcap_diagonal: { col: 0, row: 1 },
    base_corner_ne: { col: 0, row: 2 },
    base_straight: { col: 1, row: 0 },
    base_corner: { col: 0, row: 2 },
    base_tee: { col: 3, row: 0 },
    base_cross: { col: 2, row: 0 },
    diag_pair_nesw: { col: 0, row: 1 },
    diag_pair_nwse: { col: 1, row: 1 },
    mix_cardinal_diag_adjacent: { col: 2, row: 2 },
    mix_straight_diag_single_ns: { col: 2, row: 2 },
    mix_straight_diag_single_ew: { col: 2, row: 3 },
    mix_straight_diag_pair_ns: { col: 1, row: 1 },
    mix_straight_diag_pair_ew: { col: 0, row: 1 },
    mix_corner_diag_outer: { col: 4, row: 3 },
    mix_tee_diag: { col: 3, row: 0 },
    mix_hub_dense: { col: 2, row: 0 },
    mix_diag_to_straight_w_ne: { col: 2, row: 2 },
    mix_diag_to_straight_w_se: { col: 2, row: 2 },
    diag_infill_ne: { col: 5, row: 1 },
    bridge_abutment_cardinal: { col: 4, row: 1 },
    bridge_abutment_diagonal: { col: 5, row: 1 },
    straight_ew: { col: 0, row: 0 },
    straight_ns: { col: 1, row: 0 },
    corner_es: { col: 4, row: 0 },
    corner_sw: { col: 5, row: 0 },
    corner_ne: { col: 0, row: 2 },
    corner_nw: { col: 1, row: 2 },
    tee_missing_n: { col: 3, row: 0 },
    cross: { col: 2, row: 0 }
  }
};

let roadAtlasCache: RoadAtlas | null = null;
let roadAtlasLoading = false;
let roadAtlasVersion = 0;
const townLabelMaterialCache = new Map<string, { material: THREE.SpriteMaterial; aspect: number }>();

export const getRoadAtlasVersion = (): number => roadAtlasVersion;

const toRoadAtlasMetadata = (raw: unknown): RoadAtlasMetadata | null => {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const candidate = raw as {
    version?: unknown;
    image?: unknown;
    tileSize?: unknown;
    tileStride?: unknown;
    tiles?: unknown;
  };
  const image = typeof candidate.image === "string" && candidate.image.length > 0
    ? candidate.image
    : ROAD_ATLAS_FALLBACK_METADATA.image;
  const tileSize = Number(candidate.tileSize);
  const safeTileSize = Number.isFinite(tileSize) && tileSize > 0
    ? Math.round(tileSize)
    : ROAD_ATLAS_FALLBACK_METADATA.tileSize;
  const tileStrideRaw = Number(candidate.tileStride);
  const safeTileStride =
    Number.isFinite(tileStrideRaw) && tileStrideRaw > 0 ? Math.round(tileStrideRaw) : safeTileSize;
  const versionRaw = Number(candidate.version);
  const version = Number.isFinite(versionRaw) ? Math.max(1, Math.round(versionRaw)) : 2;
  const tilesRaw = candidate.tiles;
  if (!tilesRaw || typeof tilesRaw !== "object") {
    return null;
  }
  const tiles: Record<string, { col: number; row: number }> = {};
  for (const [key, value] of Object.entries(tilesRaw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") {
      continue;
    }
    const entry = value as { col?: unknown; row?: unknown };
    const col = Number(entry.col);
    const row = Number(entry.row);
    if (!Number.isFinite(col) || !Number.isFinite(row)) {
      continue;
    }
    tiles[key] = {
      col: Math.max(0, Math.floor(col)),
      row: Math.max(0, Math.floor(row))
    };
  }
  if (Object.keys(tiles).length === 0) {
    return null;
  }
  return {
    version,
    image,
    tileSize: safeTileSize,
    tileStride: safeTileStride,
    tiles
  };
};

const loadImageElement = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });

const ensureRoadAtlas = (): void => {
  if (roadAtlasCache || roadAtlasLoading) {
    return;
  }
  if (typeof document === "undefined") {
    return;
  }
  roadAtlasLoading = true;
  void (async () => {
    let metadata = ROAD_ATLAS_FALLBACK_METADATA;
    if (typeof fetch === "function") {
      try {
        const response = await fetch(ROAD_ATLAS_V2_METADATA_PATH, { cache: "no-store" });
        if (response.ok) {
          const json = await response.json();
          const parsed = toRoadAtlasMetadata(json);
          if (parsed) {
            metadata = parsed;
          }
        }
      } catch {
        // Atlas metadata is optional; fallback metadata keeps rendering alive.
      }
    }

    try {
      const image = await loadImageElement(metadata.image);
      const width = Math.max(1, image.width);
      const height = Math.max(1, image.height);
      const tileSize = Math.max(1, Math.floor(metadata.tileSize));
      const tileStride = Math.max(tileSize, Math.floor(metadata.tileStride));
      const cols = Math.max(1, Math.floor(width / tileStride));
      const rows = Math.max(1, Math.floor(height / tileStride));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return;
      }
      ctx.drawImage(image, 0, 0);
      roadAtlasCache = {
        canvas,
        tileSize,
        tileStride,
        cols,
        rows,
        version: metadata.version,
        tiles: metadata.tiles
      };
      roadAtlasVersion += 1;
    } catch {
      // If atlas loading fails we'll continue with procedural fallback.
    } finally {
      roadAtlasLoading = false;
    }
  })();
};

const getRoadAtlas = (): RoadAtlas | null => {
  ensureRoadAtlas();
  return roadAtlasCache;
};

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const drawRoundedRect = (
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
): void => {
  const r = Math.min(radius, width * 0.5, height * 0.5);
  context.beginPath();
  context.moveTo(x + r, y);
  context.lineTo(x + width - r, y);
  context.quadraticCurveTo(x + width, y, x + width, y + r);
  context.lineTo(x + width, y + height - r);
  context.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  context.lineTo(x + r, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - r);
  context.lineTo(x, y + r);
  context.quadraticCurveTo(x, y, x + r, y);
  context.closePath();
};

const getTownLabelMaterial = (name: string): { material: THREE.SpriteMaterial; aspect: number } => {
  const normalizedName = name.trim();
  const cached = townLabelMaterialCache.get(normalizedName);
  if (cached) {
    return cached;
  }
  if (typeof document === "undefined") {
    const fallbackMaterial = new THREE.SpriteMaterial({
      color: 0xf3dfb8,
      transparent: true,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false
    });
    fallbackMaterial.toneMapped = false;
    const fallback = { material: fallbackMaterial, aspect: 1.8 };
    townLabelMaterialCache.set(normalizedName, fallback);
    return fallback;
  }
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    const fallbackMaterial = new THREE.SpriteMaterial({
      color: 0xf3dfb8,
      transparent: true,
      sizeAttenuation: false,
      depthTest: false,
      depthWrite: false
    });
    fallbackMaterial.toneMapped = false;
    const fallback = { material: fallbackMaterial, aspect: 1.8 };
    townLabelMaterialCache.set(normalizedName, fallback);
    return fallback;
  }
  const fontPx = 52;
  const paddingX = 54;
  const paddingY = 24;
  const strokeWidth = 4;
  const pixelRatio = 2;
  const font = `700 ${fontPx}px "Trebuchet MS", "Segoe UI", sans-serif`;
  context.font = font;
  const measuredWidth = Math.ceil(context.measureText(normalizedName).width);
  const layoutWidth = Math.max(280, measuredWidth + paddingX * 2);
  const layoutHeight = fontPx + paddingY * 2;
  canvas.width = layoutWidth * pixelRatio;
  canvas.height = layoutHeight * pixelRatio;
  context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
  context.clearRect(0, 0, layoutWidth, layoutHeight);
  drawRoundedRect(context, strokeWidth * 0.5, strokeWidth * 0.5, layoutWidth - strokeWidth, layoutHeight - strokeWidth, 18);
  context.fillStyle = "rgba(33, 25, 18, 0.78)";
  context.fill();
  context.strokeStyle = "rgba(255, 231, 176, 0.95)";
  context.lineWidth = strokeWidth;
  context.stroke();
  context.font = font;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#fff3d5";
  context.fillText(normalizedName, layoutWidth * 0.5, layoutHeight * 0.53);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false
  });
  material.toneMapped = false;
  const created = { material, aspect: layoutWidth / layoutHeight };
  townLabelMaterialCache.set(normalizedName, created);
  return created;
};

const createTownLabelSprite = (
  town: Town,
  width: number,
  depth: number,
  cols: number,
  rows: number,
  heightScale: number,
  heightAtTile: (tileX: number, tileY: number) => number
): THREE.Sprite | null => {
  const tileX = clamp(Math.floor(town.x), 0, cols - 1);
  const tileY = clamp(Math.floor(town.y), 0, rows - 1);
  const worldX = ((tileX + 0.5) / Math.max(1, cols) - 0.5) * width;
  const worldZ = ((tileY + 0.5) / Math.max(1, rows) - 0.5) * depth;
  const groundY = heightAtTile(tileX, tileY) * heightScale;
  const labelHeight = TOWN_LABEL_SCREEN_HEIGHT;
  const labelLift = TOWN_LABEL_LIFT_METERS / Math.max(0.001, TILE_SIZE);
  const { material, aspect } = getTownLabelMaterial(town.name);
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(labelHeight * aspect, labelHeight, 1);
  sprite.position.set(worldX, groundY + labelLift, worldZ);
  sprite.renderOrder = 25;
  return sprite;
};

const getTreeBurnRole = (material: THREE.Material | THREE.Material[]): TreeBurnMeshRole => {
  const materials = Array.isArray(material) ? material : [material];
  let leafCount = 0;
  materials.forEach((mat) => {
    if ((mat as THREE.Material & { userData?: Record<string, unknown> }).userData?.treeLeafHint === true) {
      leafCount += 1;
    }
  });
  if (leafCount <= 0) {
    // Low-poly imports often ship as a single combined material with no leaf naming hints.
    // Treat those as mixed so they fully collapse instead of relying on trunk-only top cropping.
    return materials.length <= 1 ? "mixed" : "trunk";
  }
  if (leafCount >= materials.length) {
    return "leaf";
  }
  return "mixed";
};

const applyTrunkTopCropShader = (material: THREE.Material | THREE.Material[]): void => {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((mat) => {
    const standard = mat as THREE.MeshStandardMaterial & { userData?: Record<string, unknown> };
    if (!(standard instanceof THREE.MeshStandardMaterial)) {
      return;
    }
    if (!standard.userData) {
      standard.userData = {};
    }
    if (standard.userData.treeTrunkTopCropPatched) {
      return;
    }
    const priorOnBeforeCompile = standard.onBeforeCompile;
    standard.onBeforeCompile = (shader, renderer) => {
      if (priorOnBeforeCompile) {
        priorOnBeforeCompile(shader, renderer);
      }
      shader.vertexShader =
        `attribute float aCropTop;\n` +
        `varying float vCropTop;\n` +
        `varying float vCropLocalY;\n` +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n` + `vCropTop = aCropTop;\n` + `vCropLocalY = transformed.y;`
      );
      shader.fragmentShader =
        `varying float vCropTop;\n` + `varying float vCropLocalY;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        `void main() {\n` + `  if (vCropLocalY > vCropTop) discard;`
      );
    };
    standard.userData.treeTrunkTopCropPatched = true;
    standard.needsUpdate = true;
  });
};

const getDeciduousStrength = (treeType: TreeType): number => {
  if (treeType === TreeType.Pine) {
    return 0;
  }
  if (treeType === TreeType.Scrub) {
    return 0.45;
  }
  return 1;
};

const applyTreeSeasonShader = (
  material: THREE.Material | THREE.Material[],
  seasonVisual: TreeSeasonVisualConfig | null,
  treeType: TreeType
): void => {
  if (!seasonVisual || !seasonVisual.enabled) {
    return;
  }
  const materials = Array.isArray(material) ? material : [material];
  const deciduousStrength = getDeciduousStrength(treeType);
  materials.forEach((mat) => {
    const standard = mat as THREE.MeshStandardMaterial & { userData?: Record<string, unknown> };
    if (!(standard instanceof THREE.MeshStandardMaterial)) {
      return;
    }
    if (!standard.userData) {
      standard.userData = {};
    }
    if (standard.userData.treeSeasonPatched) {
      return;
    }
    const isLeafMaterial = standard.userData.treeLeafHint === true;
    if (isLeafMaterial && deciduousStrength > 0.01) {
      standard.transparent = true;
    }
    const priorOnBeforeCompile = standard.onBeforeCompile;
    standard.onBeforeCompile = (shader, renderer) => {
      if (priorOnBeforeCompile) {
        priorOnBeforeCompile(shader, renderer);
      }
      shader.uniforms.uRisk01 = seasonVisual.uniforms.uRisk01;
      shader.uniforms.uSeasonT01 = seasonVisual.uniforms.uSeasonT01;
      shader.vertexShader =
        `attribute float aSeasonPhaseOffset;\n` +
        `attribute float aSeasonRateJitter;\n` +
        `attribute float aLeafDropBias;\n` +
        `attribute float aAutumnHueBias;\n` +
        `varying float vTreeSeasonT;\n` +
        `varying float vLeafDropBias;\n` +
        `varying float vAutumnHueBias;\n` +
        `uniform float uSeasonT01;\n` +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          "vTreeSeasonT = fract(uSeasonT01 * (1.0 + aSeasonRateJitter) + aSeasonPhaseOffset);",
          "vLeafDropBias = aLeafDropBias;",
          "vAutumnHueBias = aAutumnHueBias;"
        ].join("\n")
      );
      shader.fragmentShader =
        `uniform float uRisk01;\n` +
        `varying float vTreeSeasonT;\n` +
        `varying float vLeafDropBias;\n` +
        `varying float vAutumnHueBias;\n` +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "float seasonT = fract(vTreeSeasonT);",
          "float risk = clamp(uRisk01, 0.0, 1.0);",
          "float autumn = smoothstep(0.62, 0.70, seasonT) * (1.0 - smoothstep(0.90, 0.98, seasonT));",
          "float winterA = 1.0 - smoothstep(0.08, 0.18, seasonT);",
          "float winterB = smoothstep(0.88, 0.96, seasonT);",
          "float winter = clamp(winterA + winterB, 0.0, 1.0);",
          "float spring = smoothstep(0.18, 0.28, seasonT) * (1.0 - smoothstep(0.42, 0.52, seasonT));",
          "vec3 riskTint = vec3(0.77, 0.64, 0.40);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, riskTint, risk * 0.24);",
          "vec3 autumnGold = vec3(0.90, 0.68, 0.31);",
          "vec3 autumnRust = vec3(0.73, 0.39, 0.22);",
          "vec3 autumnTint = mix(autumnGold, autumnRust, clamp(0.5 + vAutumnHueBias * 0.5, 0.0, 1.0));",
          "diffuseColor.rgb = mix(diffuseColor.rgb, autumnTint, autumn * 0.30);",
          "float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));",
          "vec3 winterTint = vec3(luma * 0.95, luma * 0.97, luma * 1.01);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, winterTint, winter * 0.36);",
          "diffuseColor.rgb *= 1.0 + spring * 0.06;"
        ].join("\n")
      );
      if (isLeafMaterial && deciduousStrength > 0.01) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <dithering_fragment>",
          [
            "float dropStart = 0.72 + vLeafDropBias * 0.12;",
            "float dropEnd = 0.98 + vLeafDropBias * 0.12;",
            "float leafDrop = smoothstep(dropStart, dropEnd, seasonT);",
            `float leafPresence = clamp(1.0 - leafDrop * ${deciduousStrength.toFixed(4)}, 0.06, 1.0);`,
            "diffuseColor.a *= leafPresence;",
            "#include <dithering_fragment>"
          ].join("\n")
        );
      }
    };
    standard.userData.treeSeasonPatched = true;
    standard.needsUpdate = true;
  });
};

const createTreeBurnController = (
  meshStates: TreeBurnMeshState[],
  ashId: number,
  tileProfiles: Map<number, TreeFlameProfile>
): TreeBurnController => {
  const dummy = new THREE.Object3D();
  const tempMatrix = new THREE.Matrix4();
  const tempColor = new THREE.Color(1, 1, 1);
  const whiteTint = new THREE.Color(1, 1, 1);
  const leafScorchTint = new THREE.Color(1.08, 0.79, 0.45);
  const leafCharTint = new THREE.Color(0.2, 0.19, 0.18);
  const trunkScorchTint = new THREE.Color(1.02, 0.66, 0.43);
  const trunkCharTint = new THREE.Color(0.26, 0.24, 0.22);
  let lastUpdateMs = 0;
  let postFireTailUntilMs = 0;
  let tileVisual = new Map<number, number>();
  let tileProgress = new Map<number, number>();
  let visualBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;

  const applyState = (state: TreeBurnMeshState, index: number, burn: number): boolean => {
    let scorch = 0;
    let char = 0;
    let visibility = 1;
    if (state.role === "leaf") {
      scorch = smoothstep(0.12, 0.55, burn);
      char = smoothstep(0.45, 0.82, burn);
      visibility = 1 - smoothstep(0.54, 0.88, burn);
      tempColor.copy(whiteTint).lerp(leafScorchTint, scorch).lerp(leafCharTint, char);
    } else if (state.role === "trunk") {
      // Delay trunk disappearance so flame visibility leads structural collapse.
      scorch = smoothstep(0.45, 0.82, burn);
      char = smoothstep(0.68, 0.96, burn);
      visibility = 1 - smoothstep(0.78, 1.04, burn);
      tempColor.copy(whiteTint).lerp(trunkScorchTint, scorch).lerp(trunkCharTint, char);
    } else {
      scorch = smoothstep(0.2, 0.72, burn);
      char = smoothstep(0.7, 1.02, burn);
      visibility = 1 - smoothstep(0.82, 1.08, burn);
      tempColor.copy(whiteTint).lerp(leafScorchTint, scorch).lerp(trunkCharTint, char);
    }
    visibility = clamp(visibility, 0, 1);
    const burnQ = Math.round(clamp(burn, 0, 1.2) * (255 / 1.2));
    const visibilityQ = Math.round(visibility * 255);
    if (state.burnQ[index] === burnQ && state.visibilityQ[index] === visibilityQ) {
      return false;
    }
    state.burnQ[index] = burnQ;
    state.visibilityQ[index] = visibilityQ;
    const scaleFactor = visibility <= TREE_BURN_VISIBLE_EPS ? 0 : visibility;
    const baseScale = state.baseScale[index];
    let posY = state.baseY[index] + (1 - scaleFactor) * state.scalePivotY[index];
    let scaleX = baseScale * scaleFactor;
    let scaleY = baseScale * scaleFactor;
    let scaleZ = baseScale * scaleFactor;
    if (state.role === "trunk") {
      // Trunks use top-down clipping instead of geometric squashing.
      posY = state.baseY[index];
      scaleX = baseScale;
      scaleY = baseScale;
      scaleZ = baseScale;
      if (state.cropTopAttr) {
        const cropSpan = Math.max(0, state.cropMaxY - state.cropMinY);
        const cropTop = state.cropMinY + cropSpan * scaleFactor - 1e-4;
        state.cropTopAttr.setX(index, cropTop);
      }
    }
    dummy.position.set(state.baseX[index], posY, state.baseZ[index]);
    dummy.rotation.set(0, state.baseRotation[index], 0);
    dummy.scale.set(scaleX, scaleY, scaleZ);
    dummy.updateMatrix();
    tempMatrix.copy(dummy.matrix).multiply(state.baseMatrix);
    state.mesh.setMatrixAt(index, tempMatrix);
    state.mesh.setColorAt(index, tempColor);
    return true;
  };

  return {
    update: (timeMs: number, world: WorldState) => {
      if (timeMs - lastUpdateMs < TREE_BURN_UPDATE_INTERVAL_MS) {
        return;
      }
      const elapsedMs = lastUpdateMs > 0 ? timeMs - lastUpdateMs : TREE_BURN_UPDATE_INTERVAL_MS;
      const dt = Math.max(0.001, elapsedMs / 1000);
      lastUpdateMs = timeMs;
      const hasActiveFire = (world.lastActiveFires ?? 0) > 0;
      const useFireBounds = hasActiveFire && world.fireBoundsActive;
      if (hasActiveFire) {
        postFireTailUntilMs = timeMs + TREE_BURN_POST_FIRE_TAIL_MS;
      }
      if (!hasActiveFire && timeMs > postFireTailUntilMs) {
        return;
      }
      const fire = world.tileFire;
      const fuel = world.tileFuel;
      const heat = world.tileHeat;
      const typeIds = world.tileTypeId;
      const heatCap = Math.max(0.01, world.fireSettings.heatCap);
      const minX = useFireBounds ? world.fireMinX - TREE_BURN_FIRE_BOUNDS_PADDING : 0;
      const maxX = useFireBounds ? world.fireMaxX + TREE_BURN_FIRE_BOUNDS_PADDING : -1;
      const minY = useFireBounds ? world.fireMinY - TREE_BURN_FIRE_BOUNDS_PADDING : 0;
      const maxY = useFireBounds ? world.fireMaxY + TREE_BURN_FIRE_BOUNDS_PADDING : -1;
      const nextTileVisual = tileVisual;
      const nextTileProgress = tileProgress;
      nextTileVisual.clear();
      nextTileProgress.clear();
      let nextBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
      meshStates.forEach((state) => {
        let changed = false;
        let minChanged = Number.POSITIVE_INFINITY;
        let maxChanged = -1;
        for (let i = 0; i < state.tileIndices.length; i += 1) {
          const tileIndex = state.tileIndices[i];
          const tileX = state.tileX[i];
          const tileY = state.tileY[i];
          const nearActiveFire =
            useFireBounds && tileX >= minX && tileX <= maxX && tileY >= minY && tileY <= maxY;
          const hasPriorTransition = state.burnQ[i] > 0 || state.visibilityQ[i] < 255;
          if (!nearActiveFire && !hasPriorTransition) {
            continue;
          }
          const isAsh = (typeIds[tileIndex] ?? -1) === ashId;
          const fireNow = clamp(fire[tileIndex] ?? 0, 0, 1);
          const heatNow = clamp((heat[tileIndex] ?? 0) / heatCap, 0, 1);
          const fuelNow = Math.max(0, fuel[tileIndex] ?? 0);
          if (!nearActiveFire && !isAsh && fireNow <= 0 && fuelNow > TREE_BURN_FUEL_EPS && !hasPriorTransition) {
            continue;
          }
          if (fuelNow > state.fuelReference[i] * 1.08) {
            state.fuelReference[i] = fuelNow;
          }
          const fuelRef = Math.max(TREE_BURN_FUEL_EPS, state.fuelReference[i]);
          const fuelRatio = clamp(fuelNow / fuelRef, 0, 1.2);
          const depletion = clamp(1 - fuelRatio, 0, 1);
          let targetBurn = clamp(1 - fuelRatio, 0, 1.15);
          const currentBurn = state.burnProgress[i] ?? 0;
          const carryHeatActive =
            !isAsh &&
            fireNow <= TREE_BURN_ACTIVE_FIRE_EPS &&
            heatNow > TREE_BURN_CARRY_HEAT_EPS &&
            fuelNow > TREE_BURN_FUEL_EPS &&
            currentBurn > 0.06;
          // Treat carry heat as active while fuel remains so tree collapse tracks the visible carry-flame phase.
          const burningNow =
            fireNow > TREE_BURN_ACTIVE_FIRE_EPS ||
            carryHeatActive ||
            (!isAsh && heatNow > TREE_BURN_ACTIVE_HEAT_EPS && depletion > 0.06);
          if (burningNow) {
            const flameDrivenBurn = clamp(fireNow * 0.74 + heatNow * 0.24, 0, 1.05);
            const fuelDrivenBurn = smoothstep(TREE_BURN_FUEL_GAUGE_START, TREE_BURN_FUEL_GAUGE_END, depletion) * 0.82;
            targetBurn = Math.max(targetBurn, flameDrivenBurn, fuelDrivenBurn);
            if (!isAsh) {
              // Keep some lag so structure does not vanish before the tile is nearly exhausted.
              const flameCap = flameDrivenBurn + 0.26 + depletion * 0.58;
              targetBurn = Math.min(targetBurn, flameCap);
            }
            if (isAsh) {
              targetBurn = Math.max(targetBurn, TREE_BURN_COMPLETE_TARGET);
            }
          } else if (isAsh) {
            // Once converted to ash, quickly finish the structural collapse.
            targetBurn = Math.max(targetBurn, TREE_BURN_COMPLETE_TARGET);
          } else {
            // Let late-stage fuel depletion keep advancing burn even if flame intensity just dipped.
            const emberTailBurn = smoothstep(TREE_BURN_EMBER_TAIL_START, TREE_BURN_EMBER_TAIL_END, depletion) * 0.8;
            targetBurn = Math.max(Math.min(currentBurn, targetBurn), emberTailBurn);
          }
          let nextBurn = currentBurn;
          let riseRate = TREE_BURN_PROGRESS_PER_SECOND;
          if (burningNow) {
            riseRate *= 1 + fireNow * 0.9 + heatNow * 0.35 + depletion * 0.7;
          } else if (!isAsh && depletion > TREE_BURN_EMBER_TAIL_START) {
            riseRate *= 1 + (depletion - TREE_BURN_EMBER_TAIL_START) * 0.7;
          }
          if (isAsh) {
            riseRate = Math.max(riseRate, TREE_BURN_ASH_CATCHUP_PER_SECOND);
          }
          if (targetBurn > currentBurn) {
            nextBurn = Math.min(targetBurn, currentBurn + dt * riseRate);
          } else if (targetBurn < currentBurn) {
            nextBurn = Math.max(targetBurn, currentBurn - dt * TREE_BURN_RECOVERY_PER_SECOND);
          }
          state.burnProgress[i] = nextBurn;
          if (applyState(state, i, nextBurn)) {
            changed = true;
            if (i < minChanged) {
              minChanged = i;
            }
            if (i > maxChanged) {
              maxChanged = i;
            }
          }
          const prevBurn = nextTileProgress.get(tileIndex) ?? 0;
          if (nextBurn > prevBurn) {
            nextTileProgress.set(tileIndex, nextBurn);
          }
          let burnVisual = Math.max(fireNow, heatNow * 0.55);
          if (burningNow && nextBurn > 0.08) {
            burnVisual = Math.max(burnVisual, 0.16 + nextBurn * 0.45);
          } else if (!burningNow) {
            burnVisual *= 0.45;
          }
          const prevVisual = nextTileVisual.get(tileIndex) ?? 0;
          if (burnVisual > prevVisual) {
            nextTileVisual.set(tileIndex, burnVisual);
          }
          if (burnVisual > TREE_BURN_VISUAL_EPS) {
            if (!nextBounds) {
              nextBounds = { minX: tileX, maxX: tileX, minY: tileY, maxY: tileY };
            } else {
              if (tileX < nextBounds.minX) nextBounds.minX = tileX;
              if (tileX > nextBounds.maxX) nextBounds.maxX = tileX;
              if (tileY < nextBounds.minY) nextBounds.minY = tileY;
              if (tileY > nextBounds.maxY) nextBounds.maxY = tileY;
            }
          }
        }
        if (changed && maxChanged >= minChanged) {
          const instanceCount = maxChanged - minChanged + 1;
          const matrixAttr = state.mesh.instanceMatrix;
          matrixAttr.clearUpdateRanges();
          matrixAttr.addUpdateRange(minChanged * 16, instanceCount * 16);
          matrixAttr.needsUpdate = true;
          if (state.mesh.instanceColor) {
            const colorAttr = state.mesh.instanceColor;
            colorAttr.setUsage(THREE.DynamicDrawUsage);
            colorAttr.clearUpdateRanges();
            colorAttr.addUpdateRange(minChanged * 3, instanceCount * 3);
            colorAttr.needsUpdate = true;
          }
          if (state.cropTopAttr) {
            state.cropTopAttr.clearUpdateRanges();
            state.cropTopAttr.addUpdateRange(minChanged, instanceCount);
            state.cropTopAttr.needsUpdate = true;
          }
        }
      });
      visualBounds = nextBounds;
    },
    getTileBurnVisual: (tileIndex: number): number => {
      return tileVisual.get(tileIndex) ?? 0;
    },
    getTileBurnProgress: (tileIndex: number): number => {
      return tileProgress.get(tileIndex) ?? 0;
    },
    getTileAnchor: (tileIndex: number): { x: number; y: number; z: number } | null => {
      const profile = tileProfiles.get(tileIndex);
      return profile ? { x: profile.x, y: profile.y, z: profile.z } : null;
    },
    getTileFlameProfile: (tileIndex: number): TreeFlameProfile | null => {
      return tileProfiles.get(tileIndex) ?? null;
    },
    getVisualBounds: (): { minX: number; maxX: number; minY: number; maxY: number } | null => {
      return visualBounds;
    }
  };
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

const HOUSE_FOOTPRINT_EPS = 1e-4;

const pickHouseFootprint = (seed: number) => {
  if (HOUSE_VARIANTS.length === 0) {
    return { source: "", name: "default", sizeX: 1, sizeY: 1, sizeZ: 1 };
  }
  const index = Math.floor(noiseAt(seed + 6.1) * HOUSE_VARIANTS.length);
  return HOUSE_VARIANTS[Math.min(HOUSE_VARIANTS.length - 1, Math.max(0, index))];
};

const getHouseFootprintDims = (rotation: number, footprint: { sizeX: number; sizeZ: number }) => {
  const rotate = Math.abs(Math.sin(rotation)) > 0.5;
  const width = rotate ? footprint.sizeZ : footprint.sizeX;
  const depth = rotate ? footprint.sizeX : footprint.sizeZ;
  return {
    width: Math.max(0.01, width),
    depth: Math.max(0.01, depth)
  };
};

const getHouseFootprintBounds = (
  tileX: number,
  tileY: number,
  rotation: number,
  footprint: { sizeX: number; sizeZ: number }
) => {
  const { width, depth } = getHouseFootprintDims(rotation, footprint);
  const centerX = tileX + 0.5;
  const centerY = tileY + 0.5;
  const minX = Math.floor(centerX - width / 2);
  const maxX = Math.floor(centerX + width / 2 - HOUSE_FOOTPRINT_EPS);
  const minY = Math.floor(centerY - depth / 2);
  const maxY = Math.floor(centerY + depth / 2 - HOUSE_FOOTPRINT_EPS);
  return { minX, maxX, minY, maxY, width, depth };
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
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const idx = tileY * cols + tileX;
      if (step <= 1) {
        heights[offset] = elevations[idx] ?? 0;
        offset += 1;
        continue;
      }
      const endX = Math.min(cols, tileX + step);
      const endY = Math.min(rows, tileY + step);
      let sum = 0;
      let count = 0;
      let maxHeight = 0;
      let waterCount = 0;
      let waterSum = 0;
      for (let y = tileY; y < endY; y += 1) {
        const rowBase = y * cols;
        for (let x = tileX; x < endX; x += 1) {
          const tileIdx = rowBase + x;
          const height = elevations[tileIdx] ?? 0;
          sum += height;
          count += 1;
          if (height > maxHeight) {
            maxHeight = height;
          }
          if (tileTypes && tileTypes[tileIdx] === waterId) {
            waterCount += 1;
            waterSum += height;
          }
        }
      }
      if (tileTypes && waterCount > count * 0.2) {
        heights[offset] = waterCount > 0 ? waterSum / waterCount : 0;
        offset += 1;
        continue;
      }
      const avg = count > 0 ? sum / count : 0;
      const blended = avg * (1 - HEIGHT_SAMPLE_PEAK_WEIGHT) + maxHeight * HEIGHT_SAMPLE_PEAK_WEIGHT;
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
        const waterRatio = total > 0 ? waterCount / total : 0;
        if (waterRatio >= 0.2) {
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
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = magFilter;
  texture.minFilter = minFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
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
  sampleTypes: Uint8Array,
  waterId: number
): Uint8Array => {
  const support = new Uint8Array(sampleTypes.length);
  for (let i = 0; i < sampleTypes.length; i += 1) {
    support[i] = sampleTypes[i] === waterId ? 1 : 0;
  }
  return support;
};

const buildWaterSupportMapTexture = (
  sampleCols: number,
  sampleRows: number,
  supportMask: Uint8Array
): THREE.DataTexture => {
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  for (let i = 0; i < supportMask.length; i += 1) {
    const v = supportMask[i] ? 255 : 0;
    const base = i * 4;
    data[base] = v;
    data[base + 1] = v;
    data[base + 2] = v;
    data[base + 3] = 255;
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.NearestFilter, THREE.NearestFilter);
};

const buildWaterDomainMapTexture = (
  sampleCols: number,
  sampleRows: number,
  ratios: WaterSampleRatios
): THREE.DataTexture => {
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  for (let i = 0; i < ratios.water.length; i += 1) {
    const waterRatio = clamp(ratios.water[i] ?? 0, 0, 1);
    const oceanRatio = clamp(ratios.ocean[i] ?? 0, 0, waterRatio);
    const riverRatio = clamp(ratios.river[i] ?? 0, 0, waterRatio);
    const ramp = clamp((waterRatio - WATER_ALPHA_MIN_RATIO) / (1 - WATER_ALPHA_MIN_RATIO), 0, 1);
    const alpha = Math.round(Math.pow(ramp, WATER_ALPHA_POWER) * 255);
    const base = i * 4;
    data[base] = Math.round(oceanRatio * 255);
    data[base + 1] = Math.round(riverRatio * 255);
    data[base + 2] = Math.round(waterRatio * 255);
    data[base + 3] = alpha;
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};

const buildRiverBankMapTexture = (
  sampleCols: number,
  sampleRows: number,
  supportMask: Uint8Array,
  riverRatio: Float32Array
): THREE.DataTexture => {
  const total = sampleCols * sampleRows;
  const riverSupport = new Uint8Array(total);
  for (let i = 0; i < total; i += 1) {
    riverSupport[i] = supportMask[i] && (riverRatio[i] ?? 0) >= RIVER_RATIO_MIN ? 1 : 0;
  }
  const distToRiver = buildDistanceField(riverSupport, sampleCols, sampleRows, 1);
  const distToNonRiver = buildDistanceField(riverSupport, sampleCols, sampleRows, 0);
  const data = new Uint8Array(total * 4);
  for (let i = 0; i < total; i += 1) {
    const inside = riverSupport[i] > 0;
    const distInside = distToNonRiver[i] >= 0 ? distToNonRiver[i] : RIVER_BANK_MAX_DISTANCE;
    const distOutside = distToRiver[i] >= 0 ? distToRiver[i] : RIVER_BANK_MAX_DISTANCE;
    const signed = inside ? distInside : -distOutside;
    const normalized = clamp(signed / RIVER_BANK_MAX_DISTANCE, -1, 1);
    const encoded = Math.round((normalized * 0.5 + 0.5) * 255);
    const base = i * 4;
    data[base] = encoded;
    data[base + 1] = encoded;
    data[base + 2] = encoded;
    data[base + 3] = 255;
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};

const buildDistanceField = (
  sampleTypes: Uint8Array,
  sampleCols: number,
  sampleRows: number,
  targetType: number
): Int16Array => {
  const total = sampleCols * sampleRows;
  const dist = new Int16Array(total);
  dist.fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i += 1) {
    if (sampleTypes[i] !== targetType) {
      continue;
    }
    dist[i] = 0;
    queue[tail] = i;
    tail += 1;
  }
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const d = dist[idx];
    const x = idx % sampleCols;
    const y = Math.floor(idx / sampleCols);
    const nextD = (d + 1) as number;
    if (x > 0) {
      const n = idx - 1;
      if (dist[n] === -1) {
        dist[n] = nextD;
        queue[tail] = n;
        tail += 1;
      }
    }
    if (x < sampleCols - 1) {
      const n = idx + 1;
      if (dist[n] === -1) {
        dist[n] = nextD;
        queue[tail] = n;
        tail += 1;
      }
    }
    if (y > 0) {
      const n = idx - sampleCols;
      if (dist[n] === -1) {
        dist[n] = nextD;
        queue[tail] = n;
        tail += 1;
      }
    }
    if (y < sampleRows - 1) {
      const n = idx + sampleCols;
      if (dist[n] === -1) {
        dist[n] = nextD;
        queue[tail] = n;
        tail += 1;
      }
    }
  }
  return dist;
};

const buildShoreSdfTexture = (
  sampleTypes: Uint8Array,
  sampleCols: number,
  sampleRows: number,
  waterId: number
): THREE.DataTexture => {
  const distToWater = buildDistanceField(sampleTypes, sampleCols, sampleRows, waterId);
  const distToLand = (() => {
    const total = sampleCols * sampleRows;
    const mapped = new Uint8Array(total);
    for (let i = 0; i < total; i += 1) {
      mapped[i] = sampleTypes[i] === waterId ? 1 : 0;
    }
    return buildDistanceField(mapped, sampleCols, sampleRows, 0);
  })();
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  for (let i = 0; i < sampleTypes.length; i += 1) {
    const isWater = sampleTypes[i] === waterId;
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

const buildRiverFlowTexture = (
  sampleHeights: Float32Array,
  sampleTypes: Uint8Array,
  sampleCols: number,
  sampleRows: number,
  waterId: number,
  riverRatio: Float32Array
): THREE.DataTexture => {
  const total = sampleCols * sampleRows;
  const data = new Uint8Array(total * 4);
  const sampleHeight = (x: number, y: number): number => {
    const clampedX = clamp(x, 0, sampleCols - 1);
    const clampedY = clamp(y, 0, sampleRows - 1);
    return sampleHeights[clampedY * sampleCols + clampedX] ?? 0;
  };
  for (let i = 0; i < total; i += 1) {
    const base = i * 4;
    const riverStrength = clamp(riverRatio[i] ?? 0, 0, 1);
    if (sampleTypes[i] !== waterId || riverStrength <= 0.02) {
      data[base] = 128;
      data[base + 1] = 128;
      data[base + 2] = 0;
      data[base + 3] = 0;
      continue;
    }
    const x = i % sampleCols;
    const y = Math.floor(i / sampleCols);
    const center = sampleHeight(x, y);
    let dirX = 0;
    let dirY = 0;
    let bestDrop = 0;
    const neighbors = [
      { x: x - 1, y, dx: -1, dy: 0 },
      { x: x + 1, y, dx: 1, dy: 0 },
      { x, y: y - 1, dx: 0, dy: -1 },
      { x, y: y + 1, dx: 0, dy: 1 }
    ];
    neighbors.forEach((neighbor) => {
      if (neighbor.x < 0 || neighbor.y < 0 || neighbor.x >= sampleCols || neighbor.y >= sampleRows) {
        return;
      }
      const nIdx = neighbor.y * sampleCols + neighbor.x;
      if (sampleTypes[nIdx] !== waterId) {
        return;
      }
      const drop = center - sampleHeights[nIdx];
      if (drop > bestDrop) {
        bestDrop = drop;
        dirX = neighbor.dx;
        dirY = neighbor.dy;
      }
    });
    const gradX = sampleHeight(x - 1, y) - sampleHeight(x + 1, y);
    const gradY = sampleHeight(x, y - 1) - sampleHeight(x, y + 1);
    if (bestDrop <= 0.0001) {
      dirX = gradX;
      dirY = gradY;
    }
    let len = Math.hypot(dirX, dirY);
    if (len <= 0.0001) {
      const n = noiseAt(i * 0.37 + 1.7) * Math.PI * 2;
      dirX = Math.cos(n);
      dirY = Math.sin(n);
      len = 1;
    }
    dirX /= len;
    dirY /= len;
    const speed = clamp(bestDrop * 22 + Math.hypot(gradX, gradY) * 4, 0, 1);
    data[base] = Math.round((dirX * 0.5 + 0.5) * 255);
    data[base + 1] = Math.round((dirY * 0.5 + 0.5) * 255);
    data[base + 2] = Math.round(speed * 255);
    data[base + 3] = Math.round(riverStrength * 255);
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};

const buildRapidMapTexture = (
  waterHeights: Float32Array,
  sampleCols: number,
  sampleRows: number,
  ratios: WaterSampleRatios,
  riverStepStrength?: Float32Array
): THREE.DataTexture => {
  const total = sampleCols * sampleRows;
  const data = new Uint8Array(total * 4);
  for (let i = 0; i < total; i += 1) {
    const base = i * 4;
    const water = clamp(ratios.water[i] ?? 0, 0, 1);
    const river = clamp(ratios.river[i] ?? 0, 0, 1);
    if (water < WATER_ALPHA_MIN_RATIO || river <= 0.01) {
      data[base] = 0;
      data[base + 1] = 0;
      data[base + 2] = 0;
      data[base + 3] = 0;
      continue;
    }
    const rawStep = riverStepStrength ? riverStepStrength[i] : 0;
    const step = Number.isFinite(rawStep) ? clamp(rawStep as number, 0, 1) : 0;
    const x = i % sampleCols;
    const y = Math.floor(i / sampleCols);
    const left = x > 0 ? waterHeights[i - 1] : waterHeights[i];
    const right = x < sampleCols - 1 ? waterHeights[i + 1] : waterHeights[i];
    const up = y > 0 ? waterHeights[i - sampleCols] : waterHeights[i];
    const down = y < sampleRows - 1 ? waterHeights[i + sampleCols] : waterHeights[i];
    const grad = Math.hypot(right - left, down - up);
    const flow = clamp(grad * 7.5, 0, 1);
    const rapid = clamp(step * 0.72 + flow * 0.58 + river * 0.24, 0, 1);
    const ramp = clamp((water - WATER_ALPHA_MIN_RATIO) / (1 - WATER_ALPHA_MIN_RATIO), 0, 1);
    const alpha = Math.pow(ramp, WATER_ALPHA_POWER);
    data[base] = Math.round(step * 255);
    data[base + 1] = Math.round(flow * 255);
    data[base + 2] = Math.round(river * 255);
    data[base + 3] = Math.round(clamp(alpha * rapid, 0, 1) * 255);
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};

const buildWaterfallInstances = (
  waterHeights: Float32Array,
  supportMask: Uint8Array,
  oceanRatio: Float32Array,
  sampleCols: number,
  sampleRows: number,
  riverRatio: Float32Array,
  riverStepStrength: Float32Array | undefined,
  minDrop: number,
  width: number,
  depth: number,
  riverDomain?: RiverRenderDomain
): Float32Array | undefined => {
  const candidates: WaterfallCandidate[] = [];
  const total = sampleCols * sampleRows;
  const cellWorldX = width / Math.max(1, sampleCols);
  const cellWorldZ = depth / Math.max(1, sampleRows);
  const cellWorld = Math.max(1e-4, Math.min(cellWorldX, cellWorldZ));
  const isWaterCell = (idx: number): boolean => (supportMask[idx] ?? 0) > 0;
  const isRiverCell = (idx: number): boolean => (riverRatio[idx] ?? 0) >= WATERFALL_MIN_RIVER_RATIO;
  const isOceanish = (idx: number): boolean => (oceanRatio[idx] ?? 0) >= WATERFALL_MAX_OCEAN_RATIO;
  const isValidCoord = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < sampleCols && y < sampleRows;
  const toWorldX = (x: number): number => ((x + 0.5) / Math.max(1, sampleCols) - 0.5) * width;
  const toWorldZ = (y: number): number => ((y + 0.5) / Math.max(1, sampleRows) - 0.5) * depth;
  const sampleWaterHeight = (fx: number, fy: number): number => {
    const x = clamp(fx, 0, sampleCols - 1);
    const y = clamp(fy, 0, sampleRows - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(sampleCols - 1, x0 + 1);
    const y1 = Math.min(sampleRows - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const h00 = waterHeights[y0 * sampleCols + x0] ?? 0;
    const h10 = waterHeights[y0 * sampleCols + x1] ?? h00;
    const h01 = waterHeights[y1 * sampleCols + x0] ?? h00;
    const h11 = waterHeights[y1 * sampleCols + x1] ?? h10;
    const hx0 = h00 * (1 - tx) + h10 * tx;
    const hx1 = h01 * (1 - tx) + h11 * tx;
    return hx0 * (1 - ty) + hx1 * ty;
  };
  const sampleRiverHeight = (fx: number, fy: number): number => {
    const x = clamp(fx, 0, sampleCols - 1);
    const y = clamp(fy, 0, sampleRows - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(sampleCols - 1, x0 + 1);
    const y1 = Math.min(sampleRows - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const samples = [
      { x: x0, y: y0, w: (1 - tx) * (1 - ty) },
      { x: x1, y: y0, w: tx * (1 - ty) },
      { x: x0, y: y1, w: (1 - tx) * ty },
      { x: x1, y: y1, w: tx * ty }
    ];
    let weighted = 0;
    let wSum = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const s = samples[i];
      const idx = s.y * sampleCols + s.x;
      if (!isWaterCell(idx) || !isRiverCell(idx) || isOceanish(idx)) {
        continue;
      }
      const h = waterHeights[idx];
      if (!Number.isFinite(h)) {
        continue;
      }
      weighted += h * s.w;
      wSum += s.w;
    }
    if (wSum > 1e-5) {
      return weighted / wSum;
    }
    const nearestX = clamp(Math.round(x), 0, sampleCols - 1);
    const nearestY = clamp(Math.round(y), 0, sampleRows - 1);
    let bestIdx = -1;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let radius = 1; radius <= 4 && bestIdx < 0; radius += 1) {
      const minX = Math.max(0, nearestX - radius);
      const maxX = Math.min(sampleCols - 1, nearestX + radius);
      const minY = Math.max(0, nearestY - radius);
      const maxY = Math.min(sampleRows - 1, nearestY + radius);
      for (let sy = minY; sy <= maxY; sy += 1) {
        for (let sx = minX; sx <= maxX; sx += 1) {
          const idx = sy * sampleCols + sx;
          if (!isWaterCell(idx) || !isRiverCell(idx) || isOceanish(idx)) {
            continue;
          }
          const h = waterHeights[idx];
          if (!Number.isFinite(h)) {
            continue;
          }
          const dx = sx - x;
          const dy = sy - y;
          const distSq = dx * dx + dy * dy;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestIdx = idx;
          }
        }
      }
    }
    if (bestIdx >= 0) {
      return waterHeights[bestIdx];
    }
    return sampleWaterHeight(fx, fy);
  };
  const worldToGridX = (worldX: number): number => (worldX / Math.max(1e-4, width) + 0.5) * sampleCols - 0.5;
  const worldToGridY = (worldZ: number): number => (worldZ / Math.max(1e-4, depth) + 0.5) * sampleRows - 0.5;
  const sampleRiverOccupancy = (fx: number, fy: number): number => {
    const x = clamp(fx, 0, sampleCols - 1);
    const y = clamp(fy, 0, sampleRows - 1);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(sampleCols - 1, x0 + 1);
    const y1 = Math.min(sampleRows - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const sampleValue = (sx: number, sy: number): number => {
      const idx = sy * sampleCols + sx;
      if (!isWaterCell(idx) || !isRiverCell(idx) || isOceanish(idx)) {
        return 0;
      }
      return 1;
    };
    const s00 = sampleValue(x0, y0);
    const s10 = sampleValue(x1, y0);
    const s01 = sampleValue(x0, y1);
    const s11 = sampleValue(x1, y1);
    const sx0 = s00 * (1 - tx) + s10 * tx;
    const sx1 = s01 * (1 - tx) + s11 * tx;
    return sx0 * (1 - ty) + sx1 * ty;
  };
  const measureWorldCrossSection = (
    centerX: number,
    centerZ: number,
    flowX: number,
    flowZ: number
  ): { halfWidth: number; shiftX: number; shiftZ: number } => {
    let perpX = -flowZ;
    let perpZ = flowX;
    const len = Math.hypot(perpX, perpZ);
    if (len <= 1e-5) {
      perpX = 1;
      perpZ = 0;
    } else {
      perpX /= len;
      perpZ /= len;
    }
    const stepDist = Math.max(0.05, cellWorld * 0.32);
    const maxDist = Math.max(cellWorld * 8.0, 0.6);
    const sampleSpan = (sign: number): number => {
      let span = 0;
      for (let dist = stepDist; dist <= maxDist; dist += stepDist) {
        const wx = centerX + perpX * sign * dist;
        const wz = centerZ + perpZ * sign * dist;
        const occ = sampleRiverOccupancy(worldToGridX(wx), worldToGridY(wz));
        if (occ < 0.42) {
          break;
        }
        span = dist;
      }
      return span;
    };
    const neg = sampleSpan(-1);
    const pos = sampleSpan(1);
    const shift = clamp((pos - neg) * 0.5, -cellWorld * 1.2, cellWorld * 1.2);
    const halfWidth = clamp(Math.max(cellWorld * 0.45, (neg + pos) * 0.5 + cellWorld * 0.2), cellWorld * 0.45, cellWorld * 3.2);
    return { halfWidth, shiftX: perpX * shift, shiftZ: perpZ * shift };
  };
  const sampleLocalDropAtWorld = (
    centerX: number,
    centerZ: number,
    dirX: number,
    dirZ: number,
    lipHeight: number
  ): number => {
    let minHeight = lipHeight;
    const stepDist = Math.max(cellWorld * 0.55, 0.08);
    const maxDist = Math.max(cellWorld * 4.2, 0.9);
    for (let dist = stepDist; dist <= maxDist; dist += stepDist) {
      const wx = centerX + dirX * dist;
      const wz = centerZ + dirZ * dist;
      const h = sampleRiverHeight(worldToGridX(wx), worldToGridY(wz));
      if (!Number.isFinite(h)) {
        continue;
      }
      minHeight = Math.min(minHeight, h);
    }
    return clamp(lipHeight - minHeight + WATERFALL_DROP_PADDING * 0.6, minDrop * 0.85, WATERFALL_MAX_DROP);
  };
  const measureCrossSection = (
    centerCol: number,
    centerRow: number,
    flowX: number,
    flowY: number
  ): { halfWidth: number; centerShift: number } => {
    let perpX = -flowY;
    let perpY = flowX;
    const perpLen = Math.hypot(perpX, perpY);
    if (perpLen <= 1e-5) {
      perpX = 1;
      perpY = 0;
    } else {
      perpX /= perpLen;
      perpY /= perpLen;
    }
    const sampleSpan = (sign: number): number => {
      let span = 0;
      const maxSteps = 8;
      for (let s = 1; s <= maxSteps; s += 1) {
        const sx = Math.round(centerCol + perpX * sign * s);
        const sy = Math.round(centerRow + perpY * sign * s);
        if (!isValidCoord(sx, sy)) {
          break;
        }
        const sIdx = sy * sampleCols + sx;
        if (!isWaterCell(sIdx) || !isRiverCell(sIdx) || isOceanish(sIdx)) {
          break;
        }
        span = s;
      }
      return span;
    };
    const negSpan = sampleSpan(-1);
    const posSpan = sampleSpan(1);
    const halfCells = 0.5 + 0.5 * (negSpan + posSpan);
    const shiftCells = (posSpan - negSpan) * 0.5;
    return {
      halfWidth: clamp(halfCells * cellWorld, cellWorld * 0.45, cellWorld * 2.6),
      centerShift: shiftCells * cellWorld
    };
  };

  for (let row = 1; row < sampleRows - 1; row += 1) {
    for (let col = 1; col < sampleCols - 1; col += 1) {
      const idx = row * sampleCols + col;
      if (!isWaterCell(idx)) {
        continue;
      }
      if (!isRiverCell(idx)) {
        continue;
      }
      const rawStepStrength = riverStepStrength ? riverStepStrength[idx] : 0;
      const stepStrength = Number.isFinite(rawStepStrength) ? clamp(rawStepStrength as number, 0, 1) : 0;
      if (stepStrength < WATERFALL_MIN_STEP_STRENGTH) {
        continue;
      }
      if (isOceanish(idx)) {
        continue;
      }
      const center = waterHeights[idx] ?? 0;
      if (!Number.isFinite(center)) {
        continue;
      }
      let bestDrop = 0;
      let bestDx = 0;
      let bestDy = 0;
      const dirs = [
        { dx: -1, dy: 0 },
        { dx: 1, dy: 0 },
        { dx: 0, dy: -1 },
        { dx: 0, dy: 1 }
      ];
      dirs.forEach((dir) => {
        const nx = col + dir.dx;
        const ny = row + dir.dy;
        if (!isValidCoord(nx, ny)) {
          return;
        }
        const nIdx = ny * sampleCols + nx;
        if (nIdx < 0 || nIdx >= total || !isWaterCell(nIdx)) {
          return;
        }
        if (!isRiverCell(nIdx) || isOceanish(nIdx)) {
          return;
        }
        const neighborHeight = waterHeights[nIdx] ?? 0;
        if (!Number.isFinite(neighborHeight)) {
          return;
        }
        const drop = center - neighborHeight;
        if (drop > bestDrop) {
          bestDrop = drop;
          bestDx = dir.dx;
          bestDy = dir.dy;
        }
      });
      if (bestDrop < minDrop) {
        continue;
      }
      const nx1 = col + bestDx;
      const ny1 = row + bestDy;
      const nx2 = col + bestDx * 2;
      const ny2 = row + bestDy * 2;
      if (!isValidCoord(nx1, ny1) || !isValidCoord(nx2, ny2)) {
        continue;
      }
      const idx1 = ny1 * sampleCols + nx1;
      const idx2 = ny2 * sampleCols + nx2;
      if (!isWaterCell(idx1) || !isWaterCell(idx2) || !isRiverCell(idx1) || !isRiverCell(idx2)) {
        continue;
      }
      if (isOceanish(idx1) || isOceanish(idx2)) {
        continue;
      }
      const h2 = waterHeights[idx2] ?? 0;
      if (!Number.isFinite(h2)) {
        continue;
      }
      let downstreamMin = h2;
      for (let stepMul = 3; stepMul <= 5; stepMul += 1) {
        const nx = col + bestDx * stepMul;
        const ny = row + bestDy * stepMul;
        if (!isValidCoord(nx, ny)) {
          break;
        }
        const nIdx = ny * sampleCols + nx;
        if (!isWaterCell(nIdx) || !isRiverCell(nIdx) || isOceanish(nIdx)) {
          break;
        }
        const h = waterHeights[nIdx] ?? Number.NaN;
        if (!Number.isFinite(h)) {
          break;
        }
        downstreamMin = Math.min(downstreamMin, h);
      }
      const localDrop = center - downstreamMin;
      if (localDrop < minDrop * 0.9 || localDrop > WATERFALL_MAX_DROP) {
        continue;
      }
      const x0 = toWorldX(col);
      const z0 = toWorldZ(row);
      const x1 = toWorldX(nx2);
      const z1 = toWorldZ(ny2);
      let dirX = x1 - x0;
      let dirZ = z1 - z0;
      const len = Math.hypot(dirX, dirZ) || 1;
      dirX /= len;
      dirZ /= len;
      const lipX = x0 + dirX * (cellWorldX * Math.abs(bestDx) * 0.5);
      const lipZ = z0 + dirZ * (cellWorldZ * Math.abs(bestDy) * 0.5);
      const cross = measureCrossSection(col, row, dirX, dirZ);
      const halfWidth = clamp(cross.halfWidth * (0.96 + stepStrength * 0.08), cellWorld * 0.45, cellWorld * 2.8);
      const centerX = lipX + (-dirZ) * cross.centerShift;
      const centerZ = lipZ + dirX * cross.centerShift;
      candidates.push({
        sampleCol: col,
        sampleRow: row,
        x: centerX,
        z: centerZ,
        top: center + WATERFALL_TOP_OFFSET,
        drop: Math.min(WATERFALL_MAX_DROP, localDrop + WATERFALL_DROP_PADDING + stepStrength * minDrop * 0.7),
        dirX,
        dirZ,
        width: halfWidth
      });
    }
  }
  if (candidates.length === 0) {
    return undefined;
  }
  candidates.sort((a, b) => b.drop - a.drop);

  type Cluster = {
    x: number;
    z: number;
    top: number;
    drop: number;
    dirX: number;
    dirZ: number;
    width: number;
    weight: number;
    minCol: number;
    maxCol: number;
    minRow: number;
    maxRow: number;
    count: number;
  };
  const clusters: Cluster[] = [];
  const minSampleSpacing = 2;
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    const candidateWeight = Math.max(0.05, candidate.drop);
    let bestCluster = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let j = 0; j < clusters.length; j += 1) {
      const cluster = clusters[j];
      const dirDot = candidate.dirX * cluster.dirX + candidate.dirZ * cluster.dirZ;
      if (dirDot < 0.7) {
        continue;
      }
      const dx = Math.abs(candidate.sampleCol - Math.round((cluster.minCol + cluster.maxCol) * 0.5));
      const dy = Math.abs(candidate.sampleRow - Math.round((cluster.minRow + cluster.maxRow) * 0.5));
      if (dx > minSampleSpacing || dy > minSampleSpacing) {
        continue;
      }
      const worldDist = Math.hypot(candidate.x - cluster.x, candidate.z - cluster.z);
      const maxWorldDist = Math.max(0.8, (candidate.width + cluster.width) * 1.65);
      if (worldDist > maxWorldDist) {
        continue;
      }
      if (worldDist < bestScore) {
        bestScore = worldDist;
        bestCluster = j;
      }
    }
    if (bestCluster < 0) {
      clusters.push({
        x: candidate.x,
        z: candidate.z,
        top: candidate.top,
        drop: candidate.drop,
        dirX: candidate.dirX,
        dirZ: candidate.dirZ,
        width: candidate.width,
        weight: candidateWeight,
        minCol: candidate.sampleCol,
        maxCol: candidate.sampleCol,
        minRow: candidate.sampleRow,
        maxRow: candidate.sampleRow,
        count: 1
      });
      continue;
    }
    const cluster = clusters[bestCluster];
    const totalWeight = cluster.weight + candidateWeight;
    cluster.x = (cluster.x * cluster.weight + candidate.x * candidateWeight) / totalWeight;
    cluster.z = (cluster.z * cluster.weight + candidate.z * candidateWeight) / totalWeight;
    cluster.top = (cluster.top * cluster.weight + candidate.top * candidateWeight) / totalWeight;
    cluster.drop = Math.max(cluster.drop, candidate.drop);
    cluster.width = Math.max(cluster.width, candidate.width);
    const dirLen = Math.hypot(cluster.dirX + candidate.dirX, cluster.dirZ + candidate.dirZ) || 1;
    cluster.dirX = (cluster.dirX + candidate.dirX) / dirLen;
    cluster.dirZ = (cluster.dirZ + candidate.dirZ) / dirLen;
    cluster.weight = totalWeight;
    cluster.minCol = Math.min(cluster.minCol, candidate.sampleCol);
    cluster.maxCol = Math.max(cluster.maxCol, candidate.sampleCol);
    cluster.minRow = Math.min(cluster.minRow, candidate.sampleRow);
    cluster.maxRow = Math.max(cluster.maxRow, candidate.sampleRow);
    cluster.count += 1;
  }

  if (clusters.length === 0) {
    return undefined;
  }

  clusters.sort((a, b) => b.drop - a.drop);
  const limit = Math.min(WATERFALL_MAX_INSTANCES, clusters.length);
  const out = new Float32Array(limit * 7);
  const contourEdges = riverDomain?.boundaryEdges;
  const contourCols = riverDomain?.cols ?? sampleCols;
  const contourRows = riverDomain?.rows ?? sampleRows;
  const contourSpace = createRiverSpaceTransform(contourCols, contourRows, width, depth, sampleCols, sampleRows);
  const debugStats = riverDomain?.debugStats;
  let anchorErrSum = 0;
  let anchorErrMax = 0;
  let anchorErrCount = 0;

  const snapClusterToContour = (cluster: Cluster): Cluster => {
    const snapped = { ...cluster };
    if (contourEdges && contourEdges.length >= 4) {
      const pX = contourSpace.worldToEdgeX(cluster.x);
      const pY = contourSpace.worldToEdgeY(cluster.z);
      let bestDistSq = Number.POSITIVE_INFINITY;
      let bestEdgeX = pX;
      let bestEdgeY = pY;
      let bestSegmentLenWorld = 0;
      let bestTanX = cluster.dirX;
      let bestTanZ = cluster.dirZ;
      for (let i = 0; i < contourEdges.length; i += 4) {
        const ax = contourEdges[i];
        const ay = contourEdges[i + 1];
        const bx = contourEdges[i + 2];
        const by = contourEdges[i + 3];
        const abX = bx - ax;
        const abY = by - ay;
        const abLenSq = abX * abX + abY * abY;
        if (abLenSq <= 1e-6) {
          continue;
        }
        const t = clamp(((pX - ax) * abX + (pY - ay) * abY) / abLenSq, 0, 1);
        const qx = ax + abX * t;
        const qy = ay + abY * t;
        const dx = pX - qx;
        const dy = pY - qy;
        const distSq = dx * dx + dy * dy;
        if (distSq < bestDistSq) {
          bestDistSq = distSq;
          bestEdgeX = qx;
          bestEdgeY = qy;
          const segWorldX = (abX / Math.max(1, contourCols)) * width;
          const segWorldZ = (abY / Math.max(1, contourRows)) * depth;
          bestSegmentLenWorld = Math.hypot(segWorldX, segWorldZ);
          if (bestSegmentLenWorld > 1e-6) {
            bestTanX = segWorldX / bestSegmentLenWorld;
            bestTanZ = segWorldZ / bestSegmentLenWorld;
          }
        }
      }
      if (Number.isFinite(bestDistSq) && bestDistSq <= 4) {
        const targetX = contourSpace.edgeToWorldX(bestEdgeX);
        const targetZ = contourSpace.edgeToWorldY(bestEdgeY);
        const toTargetX = targetX - snapped.x;
        const toTargetZ = targetZ - snapped.z;
        const snapWorldDist = Math.hypot(toTargetX, toTargetZ);
        const maxSnapWorld = Math.max(cellWorld * 0.18, Math.min(snapped.width * 0.35, cellWorld * 0.95));
        if (snapWorldDist > maxSnapWorld && snapWorldDist > 1e-5) {
          const t = maxSnapWorld / snapWorldDist;
          snapped.x += toTargetX * t;
          snapped.z += toTargetZ * t;
        } else {
          snapped.x = targetX;
          snapped.z = targetZ;
        }
        if (bestSegmentLenWorld > 0) {
          const tangentDot = bestTanX * snapped.dirX + bestTanZ * snapped.dirZ;
          if (Math.abs(tangentDot) >= 0.35) {
            if (tangentDot < 0) {
              bestTanX = -bestTanX;
              bestTanZ = -bestTanZ;
            }
            snapped.dirX = bestTanX;
            snapped.dirZ = bestTanZ;
          }
        }
      }
    }

    const localCross = measureWorldCrossSection(snapped.x, snapped.z, snapped.dirX, snapped.dirZ);
    snapped.x += localCross.shiftX;
    snapped.z += localCross.shiftZ;
    snapped.width = clamp(Math.max(snapped.width * 0.82, localCross.halfWidth), cellWorld * 0.45, cellWorld * 3.2);

    const sampleX = contourSpace.edgeToGridX(contourSpace.worldToEdgeX(snapped.x));
    const sampleY = contourSpace.edgeToGridY(contourSpace.worldToEdgeY(snapped.z));
    const sampledHeight = sampleRiverHeight(sampleX, sampleY);
    if (Number.isFinite(sampledHeight)) {
      const targetTop = sampledHeight + WATERFALL_TOP_OFFSET;
      const maxAdjust = Math.max(0.08, Math.min(0.55, snapped.drop * 0.7));
      snapped.top = clamp(targetTop, cluster.top - maxAdjust, cluster.top + maxAdjust);
      const measuredDrop = sampleLocalDropAtWorld(snapped.x, snapped.z, snapped.dirX, snapped.dirZ, sampledHeight);
      snapped.drop = clamp(Math.max(snapped.drop * 0.65, measuredDrop), minDrop * 0.8, WATERFALL_MAX_DROP);
    }
    return snapped;
  };

  for (let i = 0; i < limit; i += 1) {
    const cluster = snapClusterToContour(clusters[i]);
    const clusteredWidth = clamp(cluster.width, cellWorld * 0.45, cellWorld * 2.9);
    const base = i * 7;
    out[base] = cluster.x;
    out[base + 1] = cluster.z;
    out[base + 2] = cluster.top;
    out[base + 3] = cluster.drop;
    out[base + 4] = cluster.dirX;
    out[base + 5] = cluster.dirZ;
    out[base + 6] = clusteredWidth;
    const sampledSurface = sampleRiverHeight(
      contourSpace.edgeToGridX(contourSpace.worldToEdgeX(cluster.x)),
      contourSpace.edgeToGridY(contourSpace.worldToEdgeY(cluster.z))
    );
    if (Number.isFinite(sampledSurface)) {
      const anchorError = Math.abs(cluster.top - WATERFALL_TOP_OFFSET - sampledSurface);
      anchorErrSum += anchorError;
      anchorErrMax = Math.max(anchorErrMax, anchorError);
      anchorErrCount += 1;
    }
  }
  if (debugStats) {
    debugStats.waterfallAnchorErrorMean = anchorErrCount > 0 ? anchorErrSum / anchorErrCount : 0;
    debugStats.waterfallAnchorErrorMax = anchorErrMax;
    if (debugStats.waterfallAnchorErrorMax > WATERFALL_ANCHOR_ERR_WARN) {
      console.warn(
        `[threeTestTerrain] waterfall anchor warning mean=${debugStats.waterfallAnchorErrorMean.toFixed(4)} max=${debugStats.waterfallAnchorErrorMax.toFixed(4)}`
      );
    }
  }
  return out;
};

const buildWaterfallInfluenceMap = (
  sampleCols: number,
  sampleRows: number,
  width: number,
  depth: number,
  supportMask: Uint8Array,
  waterfallInstances?: Float32Array
): THREE.DataTexture => {
  const total = sampleCols * sampleRows;
  const lipField = new Float32Array(total);
  const plungeField = new Float32Array(total);
  if (waterfallInstances && waterfallInstances.length >= 7) {
    const cellWorldX = width / Math.max(1, sampleCols - 1);
    const cellWorldZ = depth / Math.max(1, sampleRows - 1);
    const cellWorld = Math.max(0.001, Math.min(cellWorldX, cellWorldZ));
    const waterfallCount = Math.floor(waterfallInstances.length / 7);
    for (let i = 0; i < waterfallCount; i += 1) {
      const base = i * 7;
      const x = waterfallInstances[base];
      const z = waterfallInstances[base + 1];
      const drop = Math.max(0.06, waterfallInstances[base + 3]);
      const dirX = waterfallInstances[base + 4];
      const dirZ = waterfallInstances[base + 5];
      const halfWidth = Math.max(0.08, waterfallInstances[base + 6]);
      const influenceStrength = clamp(drop / 1.6, 0, 1);
      const streamLen = Math.max(halfWidth * 1.6, drop * 0.6);
      const lipX = x - dirX * (streamLen * 0.35);
      const lipZ = z - dirZ * (streamLen * 0.35);
      const plungeX = x + dirX * (streamLen * 0.6);
      const plungeZ = z + dirZ * (streamLen * 0.6);
      const lipRadius = Math.max(1, Math.round((halfWidth * 1.45) / cellWorld));
      const plungeRadius = Math.max(1, Math.round((halfWidth * 1.95 + drop * 0.35) / cellWorld));
      const stamp = (
        cxWorld: number,
        czWorld: number,
        radius: number,
        target: Float32Array,
        strengthScale: number
      ): void => {
        const u = clamp(cxWorld / Math.max(1e-4, width) + 0.5, 0, 1);
        const v = clamp(czWorld / Math.max(1e-4, depth) + 0.5, 0, 1);
        const cx = Math.round(u * Math.max(1, sampleCols - 1));
        const cy = Math.round(v * Math.max(1, sampleRows - 1));
        const minY = Math.max(0, cy - radius);
        const maxY = Math.min(sampleRows - 1, cy + radius);
        const minX = Math.max(0, cx - radius);
        const maxX = Math.min(sampleCols - 1, cx + radius);
        for (let y = minY; y <= maxY; y += 1) {
          const rowBase = y * sampleCols;
          for (let xCell = minX; xCell <= maxX; xCell += 1) {
            const idx = rowBase + xCell;
            if (!supportMask[idx]) {
              continue;
            }
            const dx = xCell - cx;
            const dy = y - cy;
            const dist = Math.hypot(dx, dy);
            if (dist > radius) {
              continue;
            }
            const t = 1 - dist / Math.max(1, radius);
            const influence = t * t * strengthScale * influenceStrength;
            target[idx] = Math.max(target[idx], influence);
          }
        }
      };
      stamp(lipX, lipZ, lipRadius, lipField, 0.92);
      stamp(plungeX, plungeZ, plungeRadius, plungeField, 1.0);
    }
  }
  const data = new Uint8Array(total * 4);
  for (let i = 0; i < total; i += 1) {
    const base = i * 4;
    const lip = clamp(lipField[i], 0, 1);
    const plunge = clamp(plungeField[i], 0, 1);
    const combined = clamp(lip * 0.55 + plunge * 0.85, 0, 1);
    data[base] = Math.round(lip * 255);
    data[base + 1] = Math.round(plunge * 255);
    data[base + 2] = Math.round(combined * 255);
    data[base + 3] = Math.round(combined * 255);
  }
  return createDataTexture(data, sampleCols, sampleRows, THREE.LinearFilter, THREE.LinearFilter);
};

const buildRenderRiverSupportMasks = (
  sample: TerrainSample,
  waterId: number
): { base: Uint8Array; render: Uint8Array } | undefined => {
  const tileTypes = sample.tileTypes;
  const riverMask = sample.riverMask;
  if (!tileTypes || !riverMask) {
    return undefined;
  }
  const cols = sample.cols;
  const rows = sample.rows;
  if (cols < 2 || rows < 2) {
    return undefined;
  }
  const riverSurface = sample.riverSurface;
  const total = cols * rows;
  const base = new Uint8Array(total);
  let sourceCount = 0;
  for (let i = 0; i < total; i += 1) {
    const hasSurface = !riverSurface || Number.isFinite(riverSurface[i]);
    base[i] = tileTypes[i] === waterId && riverMask[i] > 0 && hasSurface ? 1 : 0;
    if (base[i]) {
      sourceCount += 1;
    }
  }
  if (sourceCount === 0) {
    return undefined;
  }

  const render = new Uint8Array(base);
  const isValid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
  const idxAt = (x: number, y: number): number => y * cols + x;
  const orthDirs = [
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 }
  ];
  const diagDirs = [
    { dx: -1, dy: -1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: 1 }
  ];
  for (let pass = 0; pass < RIVER_WIDTH_EXPAND_MAX_PASSES; pass += 1) {
    const source = render;
    const additions = new Map<number, number>();
    const isSourceActive = (idx: number): boolean => source[idx] > 0;
    const isTaken = (idx: number): boolean => source[idx] > 0 || additions.has(idx);
    const isNonRiverWaterCell = (idx: number): boolean => tileTypes[idx] === waterId && riverMask[idx] === 0;
    const canAdd = (idx: number): boolean => !isTaken(idx) && !isNonRiverWaterCell(idx);
    const neighborSupport = (x: number, y: number): number => {
      let support = 0;
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) {
            continue;
          }
          const nx = x + ox;
          const ny = y + oy;
          if (!isValid(nx, ny)) {
            continue;
          }
          if (isSourceActive(idxAt(nx, ny))) {
            support += 1;
          }
        }
      }
      return support;
    };
    const bridgeScore = (candidateIdx: number, aIdx: number, bIdx: number): number => {
      const elev = sample.elevations[candidateIdx] ?? 0;
      const elevA = sample.elevations[aIdx] ?? elev;
      const elevB = sample.elevations[bIdx] ?? elev;
      const x = candidateIdx % cols;
      const y = Math.floor(candidateIdx / cols);
      const crowdedPenalty = neighborSupport(x, y) >= 5 ? 0.2 : 0;
      return Math.abs(elev - elevA) + Math.abs(elev - elevB) + crowdedPenalty;
    };
    const addCandidate = (idx: number, score: number): void => {
      if (!canAdd(idx)) {
        return;
      }
      const existing = additions.get(idx);
      if (existing === undefined || score < existing) {
        additions.set(idx, score);
      }
    };
    const addBridge = (firstIdx: number, secondIdx: number, leftIdx: number, rightIdx: number): void => {
      const canFirst = canAdd(firstIdx);
      const canSecond = canAdd(secondIdx);
      if (!canFirst && !canSecond) {
        return;
      }
      if (canFirst && !canSecond) {
        addCandidate(firstIdx, bridgeScore(firstIdx, leftIdx, rightIdx));
        return;
      }
      if (!canFirst && canSecond) {
        addCandidate(secondIdx, bridgeScore(secondIdx, leftIdx, rightIdx));
        return;
      }
      const firstScore = bridgeScore(firstIdx, leftIdx, rightIdx);
      const secondScore = bridgeScore(secondIdx, leftIdx, rightIdx);
      addCandidate(firstScore <= secondScore ? firstIdx : secondIdx, Math.min(firstScore, secondScore));
    };
    // 1) Bridge pure diagonal checkerboard links only.
    for (let y = 0; y < rows - 1; y += 1) {
      for (let x = 0; x < cols - 1; x += 1) {
        const a = idxAt(x, y);
        const b = idxAt(x + 1, y);
        const c = idxAt(x, y + 1);
        const d = idxAt(x + 1, y + 1);
        const aOn = isSourceActive(a);
        const bOn = isSourceActive(b);
        const cOn = isSourceActive(c);
        const dOn = isSourceActive(d);
        if (aOn && dOn && !bOn && !cOn) {
          addBridge(b, c, a, d);
        } else if (!aOn && !dOn && bOn && cOn) {
          addBridge(a, d, b, c);
        }
      }
    }
    // 2) Fill single-cell axial gaps only.
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const idx = idxAt(x, y);
        if (isSourceActive(idx) || additions.has(idx)) {
          continue;
        }
        if (isNonRiverWaterCell(idx)) {
          continue;
        }
        const west = x > 0 && isSourceActive(idxAt(x - 1, y));
        const east = x < cols - 1 && isSourceActive(idxAt(x + 1, y));
        const north = y > 0 && isSourceActive(idxAt(x, y - 1));
        const south = y < rows - 1 && isSourceActive(idxAt(x, y + 1));
        if ((west && east) || (north && south)) {
          addCandidate(idx, 0.02);
        }
      }
    }
    // 3) For diagonal-only source cells, add one orthogonal bridge.
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const idx = idxAt(x, y);
        if (!isSourceActive(idx)) {
          continue;
        }
        const west = x > 0 && isSourceActive(idxAt(x - 1, y));
        const east = x < cols - 1 && isSourceActive(idxAt(x + 1, y));
        const north = y > 0 && isSourceActive(idxAt(x, y - 1));
        const south = y < rows - 1 && isSourceActive(idxAt(x, y + 1));
        const orthCount = (west ? 1 : 0) + (east ? 1 : 0) + (north ? 1 : 0) + (south ? 1 : 0);
        if (orthCount > 0) {
          continue;
        }
        const diagNeighbors: number[] = [];
        if (x > 0 && y > 0 && isSourceActive(idxAt(x - 1, y - 1))) {
          diagNeighbors.push(idxAt(x - 1, y - 1));
        }
        if (x < cols - 1 && y > 0 && isSourceActive(idxAt(x + 1, y - 1))) {
          diagNeighbors.push(idxAt(x + 1, y - 1));
        }
        if (x > 0 && y < rows - 1 && isSourceActive(idxAt(x - 1, y + 1))) {
          diagNeighbors.push(idxAt(x - 1, y + 1));
        }
        if (x < cols - 1 && y < rows - 1 && isSourceActive(idxAt(x + 1, y + 1))) {
          diagNeighbors.push(idxAt(x + 1, y + 1));
        }
        if (diagNeighbors.length === 0) {
          continue;
        }
        const bestDiag = diagNeighbors
          .slice()
          .sort((aIdx, bIdx) => {
            const da = Math.abs((sample.elevations[aIdx] ?? 0) - (sample.elevations[idx] ?? 0));
            const db = Math.abs((sample.elevations[bIdx] ?? 0) - (sample.elevations[idx] ?? 0));
            return da - db;
          })[0];
        const dx = (bestDiag % cols) - x;
        const dy = Math.floor(bestDiag / cols) - y;
        const bridgeA = idxAt(x + dx, y);
        const bridgeB = idxAt(x, y + dy);
        const canA = canAdd(bridgeA);
        const canB = canAdd(bridgeB);
        if (!canA && !canB) {
          continue;
        }
        if (canA && !canB) {
          addCandidate(bridgeA, bridgeScore(bridgeA, idx, bestDiag));
          continue;
        }
        if (!canA && canB) {
          addCandidate(bridgeB, bridgeScore(bridgeB, idx, bestDiag));
          continue;
        }
        const scoreA = bridgeScore(bridgeA, idx, bestDiag);
        const scoreB = bridgeScore(bridgeB, idx, bestDiag);
        addCandidate(scoreA <= scoreB ? bridgeA : bridgeB, Math.min(scoreA, scoreB));
      }
    }
    if (additions.size === 0) {
      break;
    }
    const maxAdds = Math.max(1, sourceCount * RIVER_DIAGONAL_FILL_MAX_ADDS_PER_CELL);
    const ranked = Array.from(additions.entries()).sort((a, b) => a[1] - b[1]);
    for (let i = 0; i < ranked.length && i < maxAdds; i += 1) {
      const idx = ranked[i][0];
      render[idx] = 1;
    }
  }

  return { base, render };
};

const buildRiverRenderDomain = (
  sample: TerrainSample,
  waterId: number
): RiverRenderDomain | undefined => {
  const masks = buildRenderRiverSupportMasks(sample, waterId);
  if (!masks) {
    return undefined;
  }
  const cols = sample.cols;
  const rows = sample.rows;
  const { base: baseSupport, render: renderSupport } = masks;
  const renderCount = (() => {
    let count = 0;
    for (let i = 0; i < renderSupport.length; i += 1) {
      if (renderSupport[i] > 0) {
        count += 1;
      }
    }
    return count;
  })();
  if (renderCount === 0) {
    return undefined;
  }

  const vertexField = new Float32Array((cols + 1) * (rows + 1));
  const vIdx = (x: number, y: number): number => y * (cols + 1) + x;
  const isValid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
  const idxAt = (x: number, y: number): number => y * cols + x;
  for (let y = 0; y <= rows; y += 1) {
    for (let x = 0; x <= cols; x += 1) {
      let sum = 0;
      let count = 0;
      const cells = [
        { x: x - 1, y: y - 1 },
        { x, y: y - 1 },
        { x: x - 1, y },
        { x, y }
      ];
      for (let i = 0; i < cells.length; i += 1) {
        const c = cells[i];
        if (!isValid(c.x, c.y)) {
          continue;
        }
        sum += renderSupport[idxAt(c.x, c.y)] ? 1 : 0;
        count += 1;
      }
      vertexField[vIdx(x, y)] = count > 0 ? sum / count : 0;
    }
  }
  if (RIVER_VERTEX_FIELD_BLUR_BLEND > 0) {
    const smoothed = new Float32Array(vertexField.length);
    const vIsValid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x <= cols && y <= rows;
    for (let y = 0; y <= rows; y += 1) {
      for (let x = 0; x <= cols; x += 1) {
        let sum = 0;
        let wSum = 0;
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            const sx = x + ox;
            const sy = y + oy;
            if (!vIsValid(sx, sy)) {
              continue;
            }
            const w = ox === 0 && oy === 0 ? 4 : ox === 0 || oy === 0 ? 2 : 1;
            sum += vertexField[vIdx(sx, sy)] * w;
            wSum += w;
          }
        }
        const base = vertexField[vIdx(x, y)];
        const blur = wSum > 0 ? sum / wSum : base;
        const blended = base * (1 - RIVER_VERTEX_FIELD_BLUR_BLEND) + blur * RIVER_VERTEX_FIELD_BLUR_BLEND;
        smoothed[vIdx(x, y)] = Math.max(base, blended * 0.96);
      }
    }
    vertexField.set(smoothed);
  }

  type ScalarPoint = { v: RiverContourVertex; s: number };
  type EdgeCountRecord = { count: number; a: number; b: number };
  const threshold = RIVER_FIELD_THRESHOLD;
  const quantScale = 4096;
  const contourVertices: number[] = [];
  const contourIndices: number[] = [];
  const vertexToIndex = new Map<string, number>();
  const edgeCounts = new Map<string, EdgeCountRecord>();

  const quantKey = (x: number, y: number): string => `${Math.round(x * quantScale)},${Math.round(y * quantScale)}`;
  const undirectedEdgeKey = (a: number, b: number): string => {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  };
  const getOrCreateVertexIndex = (v: RiverContourVertex): number => {
    const key = quantKey(v.x, v.y);
    const existing = vertexToIndex.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const idx = contourVertices.length / 2;
    contourVertices.push(v.x, v.y);
    vertexToIndex.set(key, idx);
    return idx;
  };
  const registerOrientedEdge = (a: number, b: number): void => {
    if (a === b) {
      return;
    }
    const key = undirectedEdgeKey(a, b);
    const existing = edgeCounts.get(key);
    if (!existing) {
      edgeCounts.set(key, { count: 1, a, b });
      return;
    }
    existing.count += 1;
  };
  const polygonArea = (poly: RiverContourPolygon): number => {
    let area = 0;
    for (let i = 0; i < poly.length; i += 1) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      area += a.x * b.y - b.x * a.y;
    }
    return area * 0.5;
  };
  const cleanPolygon = (poly: RiverContourPolygon): RiverContourPolygon => {
    const out: RiverContourPolygon = [];
    for (let i = 0; i < poly.length; i += 1) {
      const cur = poly[i];
      const prev = out.length > 0 ? out[out.length - 1] : null;
      if (!prev || Math.hypot(cur.x - prev.x, cur.y - prev.y) > 1e-5) {
        out.push(cur);
      }
    }
    if (out.length >= 3) {
      const first = out[0];
      const last = out[out.length - 1];
      if (Math.hypot(first.x - last.x, first.y - last.y) <= 1e-5) {
        out.pop();
      }
    }
    return out;
  };
  const addPolygon = (polygon: RiverContourPolygon): void => {
    const cleaned = cleanPolygon(polygon);
    if (cleaned.length < 3) {
      return;
    }
    const area = polygonArea(cleaned);
    if (Math.abs(area) <= 1e-6) {
      return;
    }
    const oriented = area > 0 ? cleaned : [...cleaned].reverse();
    const polyIndices = oriented.map((v) => getOrCreateVertexIndex(v));
    for (let i = 1; i < polyIndices.length - 1; i += 1) {
      contourIndices.push(polyIndices[0], polyIndices[i], polyIndices[i + 1]);
    }
    for (let i = 0; i < polyIndices.length; i += 1) {
      const a = polyIndices[i];
      const b = polyIndices[(i + 1) % polyIndices.length];
      registerOrientedEdge(a, b);
    }
  };
  const interpolate = (a: ScalarPoint, b: ScalarPoint): ScalarPoint => {
    const delta = b.s - a.s;
    const t = Math.abs(delta) <= 1e-5 ? 0.5 : clamp((threshold - a.s) / delta, 0, 1);
    return {
      v: {
        x: a.v.x + (b.v.x - a.v.x) * t,
        y: a.v.y + (b.v.y - a.v.y) * t
      },
      s: threshold
    };
  };
  const clipTriangleInside = (v0: ScalarPoint, v1: ScalarPoint, v2: ScalarPoint): RiverContourPolygon => {
    let poly: ScalarPoint[] = [v0, v1, v2];
    const out: ScalarPoint[] = [];
    for (let i = 0; i < poly.length; i += 1) {
      const cur = poly[i];
      const nxt = poly[(i + 1) % poly.length];
      const curIn = cur.s >= threshold;
      const nxtIn = nxt.s >= threshold;
      if (curIn && nxtIn) {
        out.push(nxt);
      } else if (curIn && !nxtIn) {
        out.push(interpolate(cur, nxt));
      } else if (!curIn && nxtIn) {
        out.push(interpolate(cur, nxt));
        out.push(nxt);
      }
    }
    poly = out;
    if (poly.length < 3) {
      return [];
    }
    return poly.map((p) => p.v);
  };
  const emitTriangleClipped = (
    a: RiverContourVertex,
    sa: number,
    b: RiverContourVertex,
    sb: number,
    c: RiverContourVertex,
    sc: number
  ): void => {
    const poly = clipTriangleInside({ v: a, s: sa }, { v: b, s: sb }, { v: c, s: sc });
    if (poly.length < 3) {
      return;
    }
    addPolygon(poly);
  };

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const a: RiverContourVertex = { x, y };
      const b: RiverContourVertex = { x: x + 1, y };
      const c: RiverContourVertex = { x: x + 1, y: y + 1 };
      const d: RiverContourVertex = { x, y: y + 1 };
      const sa = vertexField[vIdx(x, y)];
      const sb = vertexField[vIdx(x + 1, y)];
      const sc = vertexField[vIdx(x + 1, y + 1)];
      const sd = vertexField[vIdx(x, y + 1)];
      const caseMask =
        (sa >= threshold ? 1 : 0) |
        (sb >= threshold ? 2 : 0) |
        (sc >= threshold ? 4 : 0) |
        (sd >= threshold ? 8 : 0);
      if (caseMask === 0) {
        continue;
      }
      let splitAC = true;
      if (caseMask === 5 || caseMask === 10) {
        // Asymptotic-decider style tie-break for ambiguous cases.
        const center = (sa + sb + sc + sd) * 0.25;
        const centerInside = center >= threshold;
        if (caseMask === 5) {
          splitAC = centerInside;
        } else {
          splitAC = !centerInside;
        }
      }
      if (splitAC) {
        emitTriangleClipped(a, sa, b, sb, c, sc);
        emitTriangleClipped(a, sa, c, sc, d, sd);
      } else {
        emitTriangleClipped(a, sa, b, sb, d, sd);
        emitTriangleClipped(b, sb, c, sc, d, sd);
      }
    }
  }

  if (contourIndices.length === 0 || contourVertices.length < 6) {
    return undefined;
  }

  const boundaryEdges: number[] = [];
  edgeCounts.forEach((record) => {
    if (record.count !== 1) {
      return;
    }
    const aOffset = record.a * 2;
    const bOffset = record.b * 2;
    boundaryEdges.push(
      contourVertices[aOffset],
      contourVertices[aOffset + 1],
      contourVertices[bOffset],
      contourVertices[bOffset + 1]
    );
  });

  const baseCount = (() => {
    let count = 0;
    for (let i = 0; i < baseSupport.length; i += 1) {
      if (baseSupport[i]) {
        count += 1;
      }
    }
    return count;
  })();

  return {
    cols,
    rows,
    baseSupport,
    renderSupport,
    vertexField,
    contourVertices: new Float32Array(contourVertices),
    contourIndices: new Uint32Array(contourIndices),
    boundaryEdges: new Float32Array(boundaryEdges),
    cutoutBoundaryEdges: new Float32Array(boundaryEdges),
    distanceToBank: buildDistanceField(renderSupport, cols, rows, 0),
    debugStats: DEBUG_TERRAIN_RENDER
      ? {
          baseCount,
          renderCount,
          contourVertexCount: contourVertices.length / 2,
          contourTriangleCount: contourIndices.length / 3,
          boundaryEdgeCount: boundaryEdges.length / 4,
          cutoutBoundaryEdgeCount: 0,
          boundaryMismatchMean: 0,
          boundaryMismatchMax: 0,
          wallQuadCount: 0,
          protrudingVertexRatio: 0,
          waterfallAnchorErrorMean: 0,
          waterfallAnchorErrorMax: 0,
          wallTopGapMean: 0,
          wallTopGapMax: 0
        }
      : undefined
  };
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

const buildBoundaryEdgesFromIndexedContour = (
  contourVerticesXY: Float32Array,
  contourTriIndices: ArrayLike<number>
): Float32Array => {
  type BoundaryRecord = { count: number; a: number; b: number };
  const edgeMap = new Map<string, BoundaryRecord>();
  const addEdge = (a: number, b: number): void => {
    if (a === b) {
      return;
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const existing = edgeMap.get(key);
    if (!existing) {
      edgeMap.set(key, { count: 1, a, b });
      return;
    }
    existing.count += 1;
  };
  for (let i = 0; i < contourTriIndices.length; i += 3) {
    const a = contourTriIndices[i] as number;
    const b = contourTriIndices[i + 1] as number;
    const c = contourTriIndices[i + 2] as number;
    if (a < 0 || b < 0 || c < 0) {
      continue;
    }
    addEdge(a, b);
    addEdge(b, c);
    addEdge(c, a);
  }
  const edges: number[] = [];
  edgeMap.forEach((record) => {
    if (record.count !== 1) {
      return;
    }
    const aOff = record.a * 2;
    const bOff = record.b * 2;
    if (
      aOff + 1 >= contourVerticesXY.length ||
      bOff + 1 >= contourVerticesXY.length
    ) {
      return;
    }
    edges.push(
      contourVerticesXY[aOff],
      contourVerticesXY[aOff + 1],
      contourVerticesXY[bOff],
      contourVerticesXY[bOff + 1]
    );
  });
  return new Float32Array(edges);
};

const buildSnappedRiverContourVertices = (
  riverDomain: RiverRenderDomain,
  contourIndices: number[]
): Float32Array => {
  const contourVertexCount = riverDomain.contourVertices.length / 2;
  const snapped = new Float32Array(riverDomain.contourVertices);
  if (contourVertexCount === 0) {
    return snapped;
  }
  const cutoutEdges =
    riverDomain.cutoutBoundaryEdges && riverDomain.cutoutBoundaryEdges.length >= 4
      ? riverDomain.cutoutBoundaryEdges
      : riverDomain.boundaryEdges;
  if (!cutoutEdges || cutoutEdges.length < 4) {
    return snapped;
  }
  const quantScale = 8192;
  const keyOf = (x: number, y: number): string => `${Math.round(x * quantScale)},${Math.round(y * quantScale)}`;
  const boundaryFlags = new Uint8Array(contourVertexCount);
  const boundaryEdgeMap = new Map<string, { count: number; a: number; b: number }>();
  const addBoundaryCandidate = (a: number, b: number): void => {
    if (a === b) {
      return;
    }
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    const existing = boundaryEdgeMap.get(key);
    if (!existing) {
      boundaryEdgeMap.set(key, { count: 1, a, b });
      return;
    }
    existing.count += 1;
  };
  for (let i = 0; i < contourIndices.length; i += 3) {
    const a = contourIndices[i] as number;
    const b = contourIndices[i + 1] as number;
    const c = contourIndices[i + 2] as number;
    if (
      a < 0 || b < 0 || c < 0 ||
      a >= contourVertexCount || b >= contourVertexCount || c >= contourVertexCount
    ) {
      continue;
    }
    addBoundaryCandidate(a, b);
    addBoundaryCandidate(b, c);
    addBoundaryCandidate(c, a);
  }
  boundaryEdgeMap.forEach((record) => {
    if (record.count !== 1) {
      return;
    }
    boundaryFlags[record.a] = 1;
    boundaryFlags[record.b] = 1;
  });
  const cutoutEndpointLookup = new Map<string, { x: number; y: number }>();
  const registerEndpoint = (x: number, y: number): void => {
    const key = keyOf(x, y);
    if (!cutoutEndpointLookup.has(key)) {
      cutoutEndpointLookup.set(key, { x, y });
    }
  };
  for (let e = 0; e < cutoutEdges.length; e += 4) {
    registerEndpoint(cutoutEdges[e], cutoutEdges[e + 1]);
    registerEndpoint(cutoutEdges[e + 2], cutoutEdges[e + 3]);
  }
  for (let i = 0; i < contourVertexCount; i += 1) {
    if (!boundaryFlags[i]) {
      continue;
    }
    const vx = snapped[i * 2];
    const vy = snapped[i * 2 + 1];
    const exact = cutoutEndpointLookup.get(keyOf(vx, vy));
    if (exact) {
      snapped[i * 2] = exact.x;
      snapped[i * 2 + 1] = exact.y;
      continue;
    }
    let bestDist = Number.POSITIVE_INFINITY;
    let bestX = vx;
    let bestY = vy;
    for (let e = 0; e < cutoutEdges.length; e += 4) {
      const ax = cutoutEdges[e];
      const ay = cutoutEdges[e + 1];
      const bx = cutoutEdges[e + 2];
      const by = cutoutEdges[e + 3];
      const abX = bx - ax;
      const abY = by - ay;
      const lenSq = abX * abX + abY * abY;
      if (lenSq <= 1e-8) {
        continue;
      }
      const t = clamp(((vx - ax) * abX + (vy - ay) * abY) / lenSq, 0, 1);
      const qx = ax + abX * t;
      const qy = ay + abY * t;
      const dist = Math.hypot(vx - qx, vy - qy);
      if (dist < bestDist) {
        bestDist = dist;
        bestX = qx;
        bestY = qy;
        if (bestDist <= 1e-4) {
          break;
        }
      }
    }
    if (Number.isFinite(bestDist)) {
      snapped[i * 2] = bestX;
      snapped[i * 2 + 1] = bestY;
    }
  }
  return snapped;
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
): RiverWaterData | undefined => {
  if (!sample.tileTypes || !riverDomain) {
    return undefined;
  }
  const cols = sample.cols;
  const rows = sample.rows;
  if (cols < 2 || rows < 2) {
    return undefined;
  }
  if (riverDomain.contourIndices.length < 3 || riverDomain.contourVertices.length < 6) {
    return undefined;
  }
  const riverSurface = sample.riverSurface;
  const total = cols * rows;
  const riverSupportBase = riverDomain.baseSupport;
  const renderSupport = riverDomain.renderSupport;

  const isValid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < cols && y < rows;
  const idxAt = (x: number, y: number): number => y * cols + x;

  const riverRatio = new Float32Array(total);
  const riverTypes = new Uint8Array(total);
  const surfaceNorm = new Float32Array(total);
  const rapidAttrCenter = new Float32Array(total);
  const flowSpeedCenter = new Float32Array(total);
  const flowDirX = new Float32Array(total);
  const flowDirY = new Float32Array(total);
  const surfaceWorld = new Float32Array(total).fill(Number.NaN);
  const lipSurfaceOverride = new Float32Array(total).fill(Number.NaN);
  const riverBed = sample.riverBed;
  const riverStepStrength = sample.riverStepStrength;
  const minDepthWorld = RIVER_MIN_DEPTH_NORM * heightScale;

  for (let i = 0; i < total; i += 1) {
    if (!renderSupport[i]) {
      continue;
    }
    riverRatio[i] = 1;
    riverTypes[i] = waterId;
  }

  const sampleSurfaceWorld = (idx: number): number => {
    if (!renderSupport[idx]) {
      return (sample.elevations[idx] ?? 0) * heightScale;
    }
    const source = riverSupportBase[idx] > 0;
    let surfaceY = (sample.elevations[idx] ?? 0) * heightScale;
    let bedY = surfaceY - minDepthWorld;
    if (source) {
      const surface = Number.isFinite(riverSurface?.[idx]) ? clamp(riverSurface?.[idx] as number, 0, 1) : sample.elevations[idx] ?? 0;
      const bed = Number.isFinite(riverBed?.[idx]) ? clamp(riverBed?.[idx] as number, 0, 1) : surface - RIVER_MIN_DEPTH_NORM;
      surfaceY = surface * heightScale;
      bedY = bed * heightScale;
    } else {
      let sum = 0;
      let count = 0;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) {
            continue;
          }
          const nx = x + ox;
          const ny = y + oy;
          if (!isValid(nx, ny)) {
            continue;
          }
          const nIdx = idxAt(nx, ny);
          if (!riverSupportBase[nIdx]) {
            continue;
          }
          const nSurface = Number.isFinite(riverSurface?.[nIdx]) ? clamp(riverSurface?.[nIdx] as number, 0, 1) : sample.elevations[nIdx] ?? 0;
          sum += nSurface * heightScale;
          count += 1;
        }
      }
      if (count > 0) {
        surfaceY = sum / count;
      }
      bedY = surfaceY - minDepthWorld;
    }
    surfaceY = Math.max(surfaceY, bedY + minDepthWorld);
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    let minBankWorld = Number.POSITIVE_INFINITY;
    for (let oy = -1; oy <= 1; oy += 1) {
      for (let ox = -1; ox <= 1; ox += 1) {
        if (ox === 0 && oy === 0) {
          continue;
        }
        const nx = x + ox;
        const ny = y + oy;
        if (!isValid(nx, ny)) {
          continue;
        }
          const nIdx = idxAt(nx, ny);
          if (renderSupport[nIdx]) {
            continue;
          }
          minBankWorld = Math.min(minBankWorld, (sample.elevations[nIdx] ?? 0) * heightScale);
      }
    }
    if (Number.isFinite(minBankWorld)) {
      surfaceY = Math.min(surfaceY, minBankWorld - RIVER_SURFACE_BANK_CLEARANCE);
    }
    return surfaceY;
  };

  for (let i = 0; i < total; i += 1) {
    if (!renderSupport[i]) {
      continue;
    }
    surfaceWorld[i] = sampleSurfaceWorld(i);
    surfaceNorm[i] = clamp(surfaceWorld[i] / Math.max(1e-4, heightScale), 0, 1);
    const step = Number.isFinite(riverStepStrength?.[i]) ? clamp(riverStepStrength?.[i] as number, 0, 1) : 0;
    rapidAttrCenter[i] = step;
  }

  if (waterfallInstances && waterfallInstances.length >= 7) {
    const instanceCount = Math.floor(waterfallInstances.length / 7);
    const cellWorldX = width / Math.max(1, cols - 1);
    const cellWorldZ = depth / Math.max(1, rows - 1);
    const cellWorld = Math.max(1e-4, Math.min(cellWorldX, cellWorldZ));
    for (let i = 0; i < instanceCount; i += 1) {
      const base = i * 7;
      const centerX = waterfallInstances[base];
      const centerZ = waterfallInstances[base + 1];
      const topOffset = waterfallInstances[base + 2];
      const drop = Math.max(0.1, waterfallInstances[base + 3]);
      const dirX = waterfallInstances[base + 4];
      const dirZ = waterfallInstances[base + 5];
      const halfWidth = Math.max(0.08, waterfallInstances[base + 6]);
      const lipSurface = waterLevelWorld + topOffset - WATERFALL_TOP_OFFSET;
      const poolSurface = lipSurface - drop + Math.min(0.018, drop * 0.12);
      const upstreamLen = Math.max(cellWorld * 4.2, halfWidth * 2.6);
      const downstreamLen = Math.max(cellWorld * 4.8, halfWidth * 3.0);
      const transitionHalfLen = Math.max(cellWorld * 0.28, halfWidth * 0.22);
      const radiusWorld = Math.max(upstreamLen, downstreamLen, halfWidth * 1.35);
      const radiusCells = Math.max(1, Math.ceil(radiusWorld / cellWorld));
      const u = clamp(centerX / Math.max(1e-4, width) + 0.5, 0, 1);
      const v = clamp(centerZ / Math.max(1e-4, depth) + 0.5, 0, 1);
      const cx = Math.round(u * Math.max(1, cols - 1));
      const cy = Math.round(v * Math.max(1, rows - 1));
      const minY = Math.max(0, cy - radiusCells);
      const maxY = Math.min(rows - 1, cy + radiusCells);
      const minX = Math.max(0, cx - radiusCells);
      const maxX = Math.min(cols - 1, cx + radiusCells);
      for (let y = minY; y <= maxY; y += 1) {
        const rowBase = y * cols;
        for (let x = minX; x <= maxX; x += 1) {
          const idx = rowBase + x;
          if (!renderSupport[idx] || !Number.isFinite(surfaceWorld[idx])) {
            continue;
          }
          const wx = ((x + 0.5) / Math.max(1, cols) - 0.5) * width - centerX;
          const wz = ((y + 0.5) / Math.max(1, rows) - 0.5) * depth - centerZ;
          const along = wx * dirX + wz * dirZ;
          const perp = Math.abs(wx * -dirZ + wz * dirX);
          if (along < -upstreamLen || along > downstreamLen) {
            continue;
          }
          if (perp > Math.max(cellWorld * 0.85, halfWidth * 1.05)) {
            continue;
          }
          const baseSurface = surfaceWorld[idx];
          if (along <= -transitionHalfLen) {
            const maxLipLift = Math.max(0.03, Math.min(0.42, drop * 0.62));
            const upstreamFade = clamp((-along - transitionHalfLen) / Math.max(cellWorld, upstreamLen), 0, 1);
            const upstreamSurface = lipSurface - upstreamFade * Math.min(0.018, drop * 0.1);
            const clampedUpstream = clamp(upstreamSurface, baseSurface, baseSurface + maxLipLift);
            surfaceWorld[idx] = Math.max(baseSurface, clampedUpstream);
            const prevLip = lipSurfaceOverride[idx];
            lipSurfaceOverride[idx] = Number.isFinite(prevLip)
              ? Math.max(prevLip, clampedUpstream)
              : clampedUpstream;
            continue;
          }
          if (along >= transitionHalfLen) {
            const poolFade = clamp((along - transitionHalfLen) / Math.max(cellWorld, downstreamLen), 0, 1);
            const poolRise = poolFade * Math.min(0.014, drop * 0.08);
            const targetPoolSurface = poolSurface + poolRise;
            surfaceWorld[idx] = Math.min(baseSurface, targetPoolSurface);
            continue;
          }
          const t = clamp((along + transitionHalfLen) / Math.max(1e-4, transitionHalfLen * 2), 0, 1);
          const seamSurface = lipSurface * (1 - t) + poolSurface * t;
          surfaceWorld[idx] = baseSurface * 0.35 + seamSurface * 0.65;
        }
      }
    }
  }

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = idxAt(x, y);
      if (!renderSupport[idx]) {
        continue;
      }
      const center = surfaceWorld[idx];
      const left = isValid(x - 1, y) && renderSupport[idxAt(x - 1, y)] ? surfaceWorld[idxAt(x - 1, y)] : center;
      const right = isValid(x + 1, y) && renderSupport[idxAt(x + 1, y)] ? surfaceWorld[idxAt(x + 1, y)] : center;
      const up = isValid(x, y - 1) && renderSupport[idxAt(x, y - 1)] ? surfaceWorld[idxAt(x, y - 1)] : center;
      const down = isValid(x, y + 1) && renderSupport[idxAt(x, y + 1)] ? surfaceWorld[idxAt(x, y + 1)] : center;
      let dx = left - right;
      let dy = up - down;
      const len = Math.hypot(dx, dy);
      if (len <= 1e-5) {
        const n = noiseAt(idx * 0.37 + 1.7) * Math.PI * 2;
        dx = Math.cos(n);
        dy = Math.sin(n);
      } else {
        dx /= len;
        dy /= len;
      }
      flowDirX[idx] = dx;
      flowDirY[idx] = dy;
      const grad = Math.hypot(right - left, down - up);
      rapidAttrCenter[idx] = clamp(rapidAttrCenter[idx] * 0.65 + grad * 0.42, 0, 1);
      flowSpeedCenter[idx] = clamp(0.35 + grad * 5.0 + rapidAttrCenter[idx] * 1.2, 0.25, 2.4);
    }
  }

  const riverSupportMap = buildWaterSupportMapTexture(cols, rows, renderSupport);
  const riverFlowMap = buildRiverFlowTexture(surfaceNorm, riverTypes, cols, rows, waterId, riverRatio);
  const riverRatios: WaterSampleRatios = { water: riverRatio, ocean: new Float32Array(total), river: riverRatio };
  const riverRapidMap = buildRapidMapTexture(surfaceNorm, cols, rows, riverRatios, riverStepStrength);
  const riverBankMap = buildRiverBankMapTexture(cols, rows, renderSupport, riverRatio);
  const riverWaterfallInfluence = buildWaterfallInfluenceMap(
    cols,
    rows,
    width,
    depth,
    renderSupport,
    waterfallInstances
  );

  const positions: number[] = [];
  const uvs: number[] = [];
  const bankDist: number[] = [];
  const flowDir: number[] = [];
  const flowSpeed: number[] = [];
  const rapid: number[] = [];
  const contourQuantScale = 8192;
  const contourKeyOf = (x: number, y: number): string =>
    `${Math.round(x * contourQuantScale)},${Math.round(y * contourQuantScale)}`;
  const contourWaterOffsetByKey = new Map<string, number>();
  const contourBoundaryTerrainWorldByKey = new Map<string, number>();
  const indices = Array.from(riverDomain.contourIndices);
  const distToNonRiver = riverDomain.distanceToBank;
  const renderContourVertices = buildSnappedRiverContourVertices(riverDomain, indices);
  const packedCutoutWallEdges = riverDomain.cutoutBoundaryWallEdges;
  if (packedCutoutWallEdges && packedCutoutWallEdges.length >= 6) {
    const registerBoundaryTerrainHeight = (x: number, y: number, worldY: number): void => {
      if (!Number.isFinite(worldY)) {
        return;
      }
      const key = contourKeyOf(x, y);
      const existing = contourBoundaryTerrainWorldByKey.get(key);
      if (existing === undefined || worldY > existing) {
        contourBoundaryTerrainWorldByKey.set(key, worldY);
      }
    };
    for (let i = 0; i + 5 < packedCutoutWallEdges.length; i += 6) {
      registerBoundaryTerrainHeight(
        packedCutoutWallEdges[i],
        packedCutoutWallEdges[i + 1],
        packedCutoutWallEdges[i + 2]
      );
      registerBoundaryTerrainHeight(
        packedCutoutWallEdges[i + 3],
        packedCutoutWallEdges[i + 4],
        packedCutoutWallEdges[i + 5]
      );
    }
  }

  const riverSpace = createRiverSpaceTransform(cols, rows, width, depth, cols + 1, rows + 1);
  const worldXEdge = (x: number): number => riverSpace.edgeToWorldX(x);
  const worldZEdge = (y: number): number => riverSpace.edgeToWorldY(y);
  const sampleFromCells = (fx: number, fy: number, getter: (idx: number) => number): number => {
    const cx = fx - 0.5;
    const cy = fy - 0.5;
    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    let sum = 0;
    let wSum = 0;
    for (let oy = 0; oy <= 1; oy += 1) {
      for (let ox = 0; ox <= 1; ox += 1) {
        const sx = x0 + ox;
        const sy = y0 + oy;
        if (!isValid(sx, sy)) {
          continue;
        }
        const idx = idxAt(sx, sy);
        if (!renderSupport[idx]) {
          continue;
        }
        const wx = 1 - Math.abs(cx - sx);
        const wy = 1 - Math.abs(cy - sy);
        const w = Math.max(0, wx) * Math.max(0, wy);
        if (w <= 1e-5) {
          continue;
        }
        const value = getter(idx);
        if (!Number.isFinite(value)) {
          continue;
        }
        sum += value * w;
        wSum += w;
      }
    }
    if (wSum > 1e-5) {
      return sum / wSum;
    }
    const nearestX = clamp(Math.round(cx), 0, cols - 1);
    const nearestY = clamp(Math.round(cy), 0, rows - 1);
    let bestIdx = -1;
    let bestDistSq = Number.POSITIVE_INFINITY;
    for (let radius = 0; radius <= 5 && bestIdx < 0; radius += 1) {
      const minX = Math.max(0, nearestX - radius);
      const maxX = Math.min(cols - 1, nearestX + radius);
      const minY = Math.max(0, nearestY - radius);
      const maxY = Math.min(rows - 1, nearestY + radius);
      for (let sy = minY; sy <= maxY; sy += 1) {
        for (let sx = minX; sx <= maxX; sx += 1) {
          const idx = idxAt(sx, sy);
          if (!renderSupport[idx]) {
            continue;
          }
          const dx = sx - cx;
          const dy = sy - cy;
          const distSq = dx * dx + dy * dy;
          if (distSq < bestDistSq) {
            bestDistSq = distSq;
            bestIdx = idx;
          }
        }
      }
    }
    if (bestIdx >= 0) {
      return getter(bestIdx);
    }
    return Number.NaN;
  };
  const sampleSurfaceOffset = (fx: number, fy: number): number => {
    const surface = sampleFromCells(fx, fy, (idx) => surfaceWorld[idx]);
    const lip = sampleFromCells(fx, fy, (idx) => lipSurfaceOverride[idx]);
    let topWorld = Number.isFinite(lip) ? Math.max(surface, lip) : surface;
    let minBankWorld = Number.POSITIVE_INFINITY;
    const vx = Math.floor(fx);
    const vy = Math.floor(fy);
    const candidates = [
      { x: vx - 1, y: vy - 1 },
      { x: vx, y: vy - 1 },
      { x: vx - 1, y: vy },
      { x: vx, y: vy }
    ];
    for (let i = 0; i < candidates.length; i += 1) {
      const c = candidates[i];
      if (!isValid(c.x, c.y)) {
        continue;
      }
      const idx = idxAt(c.x, c.y);
      if (renderSupport[idx]) {
        continue;
      }
      minBankWorld = Math.min(minBankWorld, (sample.elevations[idx] ?? 0) * heightScale);
    }
    if (Number.isFinite(minBankWorld)) {
      topWorld = Math.min(topWorld, minBankWorld - RIVER_EDGE_SURFACE_UNDERSHOOT);
    }
    if (!Number.isFinite(topWorld)) {
      return WATER_SURFACE_LIFT_RIVER;
    }
    return topWorld - waterLevelWorld + WATER_SURFACE_LIFT_RIVER;
  };
  const sampleBankDist = (fx: number, fy: number): number => {
    const value = sampleFromCells(fx, fy, (idx) => (distToNonRiver[idx] >= 0 ? distToNonRiver[idx] : 0));
    return clamp((Number.isFinite(value) ? value : 0) / Math.max(2, RIVER_MIN_VISUAL_WIDTH_CELLS * 2.5), 0, 1);
  };
  const sampleFlow = (fx: number, fy: number): { x: number; y: number } => {
    const x = sampleFromCells(fx, fy, (idx) => flowDirX[idx]);
    const y = sampleFromCells(fx, fy, (idx) => flowDirY[idx]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return { x: 1, y: 0 };
    }
    const len = Math.hypot(x, y) || 1;
    return { x: x / len, y: y / len };
  };
  const sampleRapid = (fx: number, fy: number): number => {
    const value = sampleFromCells(fx, fy, (idx) => rapidAttrCenter[idx]);
    return clamp(Number.isFinite(value) ? value : 0, 0, 1);
  };
  const sampleFlowSpeed = (fx: number, fy: number): number => {
    const value = sampleFromCells(fx, fy, (idx) => flowSpeedCenter[idx]);
    return clamp(Number.isFinite(value) ? value : 0.35, 0.25, 2.4);
  };
  const addVertex = (v: RiverContourVertex): void => {
    const flow = sampleFlow(v.x, v.y);
    let waterOffset = sampleSurfaceOffset(v.x, v.y);
    const boundaryTerrainWorld = contourBoundaryTerrainWorldByKey.get(contourKeyOf(v.x, v.y));
    if (Number.isFinite(boundaryTerrainWorld)) {
      // Keep boundary water strictly below the cutout terrain top so wall top can always cover it.
      const maxBoundarySurfaceOffset = (boundaryTerrainWorld as number) - waterLevelWorld - WALL_WATER_OVERLAP;
      if (Number.isFinite(maxBoundarySurfaceOffset)) {
        waterOffset = Math.min(waterOffset, maxBoundarySurfaceOffset);
      }
    }
    positions.push(worldXEdge(v.x), waterOffset, worldZEdge(v.y));
    uvs.push(v.x / Math.max(1, cols), v.y / Math.max(1, rows));
    bankDist.push(sampleBankDist(v.x, v.y));
    flowDir.push(flow.x, flow.y);
    flowSpeed.push(sampleFlowSpeed(v.x, v.y));
    rapid.push(sampleRapid(v.x, v.y));
    contourWaterOffsetByKey.set(contourKeyOf(v.x, v.y), waterOffset);
  };
  for (let i = 0; i < renderContourVertices.length; i += 2) {
    addVertex({
      x: renderContourVertices[i],
      y: renderContourVertices[i + 1]
    });
  }
  if (indices.length === 0 || positions.length / 3 !== renderContourVertices.length / 2) {
    return undefined;
  }

  const wallPositions: number[] = [];
  const wallUvs: number[] = [];
  const wallIndices: number[] = [];
  const sampleTerrainWorld = (fx: number, fy: number): number => {
    const sx = clamp(fx - 0.5, 0, cols - 1);
    const sy = clamp(fy - 0.5, 0, rows - 1);
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const h00 = (sample.elevations[idxAt(x0, y0)] ?? 0) * heightScale;
    const h10 = (sample.elevations[idxAt(x1, y0)] ?? 0) * heightScale;
    const h01 = (sample.elevations[idxAt(x0, y1)] ?? 0) * heightScale;
    const h11 = (sample.elevations[idxAt(x1, y1)] ?? 0) * heightScale;
    const hx0 = h00 * (1 - tx) + h10 * tx;
    const hx1 = h01 * (1 - tx) + h11 * tx;
    return hx0 * (1 - ty) + hx1 * ty;
  };
  const sampleOutsideBank = (
    fx: number,
    fy: number,
    outX: number,
    outY: number,
    fallback: number,
    inset: number = BANK_INSET
  ): number => {
    let nearest = Number.NaN;
    let sum = 0;
    let count = 0;
    const rayStep = 0.16;
    for (let step = 1; step <= 4; step += 1) {
      const px = fx + outX * rayStep * step;
      const py = fy + outY * rayStep * step;
      if (px < 0 || py < 0 || px > cols || py > rows) {
        continue;
      }
      const cellX = clamp(Math.floor(px), 0, cols - 1);
      const cellY = clamp(Math.floor(py), 0, rows - 1);
      const idx = idxAt(cellX, cellY);
      if (renderSupport[idx]) {
        continue;
      }
      const bank = sampleTerrainWorld(px, py) - waterLevelWorld - inset;
      if (!Number.isFinite(bank)) {
        continue;
      }
      if (!Number.isFinite(nearest)) {
        nearest = bank;
      }
      sum += bank;
      count += 1;
    }
    if (!Number.isFinite(nearest)) {
      return fallback;
    }
    const avg = sum / Math.max(1, count);
    // Bias toward the nearest outside sample so the wall follows the cut edge closely.
    return nearest * 0.72 + avg * 0.28;
  };
  const sampleSupportValue = (fx: number, fy: number): number => {
    const sx = clamp(fx - 0.5, 0, cols - 1);
    const sy = clamp(fy - 0.5, 0, rows - 1);
    const x0 = Math.floor(sx);
    const y0 = Math.floor(sy);
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = sx - x0;
    const ty = sy - y0;
    const s00 = renderSupport[idxAt(x0, y0)] ? 1 : 0;
    const s10 = renderSupport[idxAt(x1, y0)] ? 1 : 0;
    const s01 = renderSupport[idxAt(x0, y1)] ? 1 : 0;
    const s11 = renderSupport[idxAt(x1, y1)] ? 1 : 0;
    const sx0 = s00 * (1 - tx) + s10 * tx;
    const sx1 = s01 * (1 - tx) + s11 * tx;
    return sx0 * (1 - ty) + sx1 * ty;
  };
  const resolveOutward = (
    midX: number,
    midY: number,
    candidateX: number,
    candidateY: number
  ): { x: number; y: number } => {
    const probe = 0.28;
    const plus = sampleSupportValue(midX + candidateX * probe, midY + candidateY * probe);
    const minus = sampleSupportValue(midX - candidateX * probe, midY - candidateY * probe);
    // Outward should move away from river support.
    if (plus > minus + 1e-4) {
      return { x: -candidateX, y: -candidateY };
    }
    return { x: candidateX, y: candidateY };
  };
  const sampleAnyOutsideBank = (fx: number, fy: number, fallback: number): number => {
    let best = Number.NaN;
    const dirs = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [0.7071, 0.7071], [-0.7071, 0.7071], [0.7071, -0.7071], [-0.7071, -0.7071]
    ];
    for (let i = 0; i < dirs.length; i += 1) {
      const dir = dirs[i];
      const bank = sampleOutsideBank(fx, fy, dir[0], dir[1], Number.NaN);
      if (!Number.isFinite(bank)) {
        continue;
      }
      if (!Number.isFinite(best)) {
        best = bank;
      } else {
        best = Math.min(best, bank);
      }
    }
    return Number.isFinite(best) ? best : fallback;
  };
  let wallTopGapSum = 0;
  let wallTopGapMax = 0;
  let wallTopGapCount = 0;
  const packedWallBoundaryEdges =
    riverDomain.cutoutBoundaryWallEdges && riverDomain.cutoutBoundaryWallEdges.length >= 6
      ? riverDomain.cutoutBoundaryWallEdges
      : undefined;
  const wallBoundaryEdgesFromContour = buildBoundaryEdgesFromIndexedContour(renderContourVertices, indices);
  const wallBoundaryEdgesFallback =
    wallBoundaryEdgesFromContour.length >= 4
      ? wallBoundaryEdgesFromContour
      : riverDomain.cutoutBoundaryEdges && riverDomain.cutoutBoundaryEdges.length >= 4
        ? riverDomain.cutoutBoundaryEdges
        : riverDomain.boundaryEdges;
  type WallEdgeProfile = RiverContourEdge & {
    outX: number;
    outY: number;
    terrainWorldA?: number;
    terrainWorldB?: number;
  };
  type WallVertexProfile = { top: number; bottom: number; terrainTop: number };
  const wallQuantScale = 8192;
  const wallKeyOf = (x: number, y: number): string => `${Math.round(x * wallQuantScale)},${Math.round(y * wallQuantScale)}`;
  const cutoutBoundaryTerrainByKey = new Map<string, number>();
  const packedBoundaryHeights = riverDomain.cutoutBoundaryVertexHeights;
  if (packedBoundaryHeights && packedBoundaryHeights.length >= 3) {
    for (let i = 0; i + 2 < packedBoundaryHeights.length; i += 3) {
      const hx = packedBoundaryHeights[i];
      const hy = packedBoundaryHeights[i + 1];
      const hWorld = packedBoundaryHeights[i + 2];
      cutoutBoundaryTerrainByKey.set(wallKeyOf(hx, hy), hWorld);
    }
  }
  const wallEdges: WallEdgeProfile[] = [];
  const wallVertexOutward = new Map<string, { x: number; y: number; outX: number; outY: number; count: number }>();
  const addVertexOutward = (x: number, y: number, outX: number, outY: number): void => {
    const key = wallKeyOf(x, y);
    const existing = wallVertexOutward.get(key);
    if (existing) {
      existing.outX += outX;
      existing.outY += outY;
      existing.count += 1;
      return;
    }
    wallVertexOutward.set(key, { x, y, outX, outY, count: 1 });
  };
  if (packedWallBoundaryEdges) {
    for (let i = 0; i < packedWallBoundaryEdges.length; i += 6) {
      const ax = packedWallBoundaryEdges[i];
      const ay = packedWallBoundaryEdges[i + 1];
      const az = packedWallBoundaryEdges[i + 2];
      const bx = packedWallBoundaryEdges[i + 3];
      const by = packedWallBoundaryEdges[i + 4];
      const bz = packedWallBoundaryEdges[i + 5];
      const ex = bx - ax;
      const ey = by - ay;
      const eLen = Math.hypot(ex, ey);
      if (eLen <= 1e-5) {
        continue;
      }
      // Polygon winding is stabilized as CCW, so outward is to the right of edge direction.
      const candX = ey / eLen;
      const candY = -ex / eLen;
      const midX = (ax + bx) * 0.5;
      const midY = (ay + by) * 0.5;
      const resolved = resolveOutward(midX, midY, candX, candY);
      wallEdges.push({
        ax,
        ay,
        bx,
        by,
        outX: resolved.x,
        outY: resolved.y,
        terrainWorldA: Number.isFinite(az) ? az : undefined,
        terrainWorldB: Number.isFinite(bz) ? bz : undefined
      });
      addVertexOutward(ax, ay, resolved.x, resolved.y);
      addVertexOutward(bx, by, resolved.x, resolved.y);
    }
  } else {
    for (let i = 0; i < wallBoundaryEdgesFallback.length; i += 4) {
      const ax = wallBoundaryEdgesFallback[i];
      const ay = wallBoundaryEdgesFallback[i + 1];
      const bx = wallBoundaryEdgesFallback[i + 2];
      const by = wallBoundaryEdgesFallback[i + 3];
      const ex = bx - ax;
      const ey = by - ay;
      const eLen = Math.hypot(ex, ey);
      if (eLen <= 1e-5) {
        continue;
      }
      // Polygon winding is stabilized as CCW, so outward is to the right of edge direction.
      const candX = ey / eLen;
      const candY = -ex / eLen;
      const midX = (ax + bx) * 0.5;
      const midY = (ay + by) * 0.5;
      const resolved = resolveOutward(midX, midY, candX, candY);
      wallEdges.push({
        ax,
        ay,
        bx,
        by,
        outX: resolved.x,
        outY: resolved.y
      });
      addVertexOutward(ax, ay, resolved.x, resolved.y);
      addVertexOutward(bx, by, resolved.x, resolved.y);
    }
  }
  const wallVertexProfiles = new Map<string, WallVertexProfile>();
  const resolveWallVertexProfile = (
    x: number,
    y: number,
    fallbackOutX: number,
    fallbackOutY: number,
    exactTerrainWorld?: number
  ): WallVertexProfile => {
    const waterFromContour = contourWaterOffsetByKey.get(wallKeyOf(x, y));
    const waterSurface = Number.isFinite(waterFromContour) ? (waterFromContour as number) : sampleSurfaceOffset(x, y);
    if (Number.isFinite(exactTerrainWorld)) {
      const terrainTop = (exactTerrainWorld as number) - waterLevelWorld;
      let top = terrainTop + WALL_TOP_OVERLAP;
      if (Number.isFinite(waterSurface)) {
        top = Math.max(top, (waterSurface as number) + WALL_WATER_OVERLAP);
      }
      let bottom = top - WALL_MIN_HEIGHT;
      if (Number.isFinite(waterSurface)) {
        bottom = Math.min(bottom, waterSurface - WALL_WATER_OVERLAP);
      }
      bottom = Math.min(bottom, terrainTop - WALL_RISE_GUARD);
      return { top, bottom, terrainTop };
    }
    const key = wallKeyOf(x, y);
    const cached = wallVertexProfiles.get(key);
    if (cached) {
      return cached;
    }
    const accum = wallVertexOutward.get(key);
    let outX = accum?.outX ?? fallbackOutX;
    let outY = accum?.outY ?? fallbackOutY;
    const len = Math.hypot(outX, outY);
    if (len > 1e-5) {
      outX /= len;
      outY /= len;
    } else {
      outX = fallbackOutX;
      outY = fallbackOutY;
    }
    const boundaryTerrainWorld = cutoutBoundaryTerrainByKey.get(key);
    const terrainTop = (Number.isFinite(boundaryTerrainWorld) ? (boundaryTerrainWorld as number) : sampleTerrainWorld(x, y)) - waterLevelWorld;
    let top = Math.max(terrainTop - WALL_TOP_MAX_UNDERCUT, terrainTop + WALL_TOP_OVERLAP);
    if (Number.isFinite(waterSurface)) {
      top = Math.max(top, (waterSurface as number) + WALL_WATER_OVERLAP);
    }
    let bottom = top - WALL_MIN_HEIGHT;
    if (Number.isFinite(waterSurface)) {
      bottom = Math.min(bottom, waterSurface - WALL_WATER_OVERLAP);
    }
    bottom = Math.min(bottom, terrainTop - WALL_RISE_GUARD);
    const profile: WallVertexProfile = { top, bottom, terrainTop };
    wallVertexProfiles.set(key, profile);
    return profile;
  };
  const pushWallEdge = (edge: WallEdgeProfile): void => {
    const profileA = resolveWallVertexProfile(edge.ax, edge.ay, edge.outX, edge.outY, edge.terrainWorldA);
    const profileB = resolveWallVertexProfile(edge.bx, edge.by, edge.outX, edge.outY, edge.terrainWorldB);
    const gapA = Math.abs(profileA.terrainTop - profileA.top);
    const gapB = Math.abs(profileB.terrainTop - profileB.top);
    wallTopGapSum += gapA + gapB;
    wallTopGapMax = Math.max(wallTopGapMax, gapA, gapB);
    wallTopGapCount += 2;
    const vBase = wallPositions.length / 3;
    wallPositions.push(
      worldXEdge(edge.ax), profileA.top, worldZEdge(edge.ay),
      worldXEdge(edge.bx), profileB.top, worldZEdge(edge.by),
      worldXEdge(edge.bx), profileB.bottom, worldZEdge(edge.by),
      worldXEdge(edge.ax), profileA.bottom, worldZEdge(edge.ay)
    );
    const edgeWorldLen = Math.hypot(worldXEdge(edge.bx) - worldXEdge(edge.ax), worldZEdge(edge.by) - worldZEdge(edge.ay));
    const wallHeight = Math.max(
      WALL_MIN_HEIGHT,
      (Math.abs(profileA.bottom - profileA.top) + Math.abs(profileB.bottom - profileB.top)) * 0.5
    );
    wallUvs.push(
      0, 0,
      edgeWorldLen, 0,
      edgeWorldLen, wallHeight,
      0, wallHeight
    );
    wallIndices.push(
      vBase, vBase + 1, vBase + 2,
      vBase, vBase + 2, vBase + 3
    );
  };
  for (let i = 0; i < wallEdges.length; i += 1) {
    pushWallEdge(wallEdges[i]);
  }

  if (riverDomain.debugStats && positions.length >= 3) {
    let protruding = 0;
    for (let i = 0; i < positions.length; i += 3) {
      const vx = renderContourVertices[(i / 3) * 2];
      const vy = renderContourVertices[(i / 3) * 2 + 1];
      const bank = sampleAnyOutsideBank(vx, vy, positions[i + 1] + WALL_MIN_HEIGHT);
      if (Number.isFinite(bank) && positions[i + 1] > bank + WALL_RISE_GUARD) {
        protruding += 1;
      }
    }
    riverDomain.debugStats.wallQuadCount = wallIndices.length / 6;
    riverDomain.debugStats.protrudingVertexRatio = protruding / Math.max(1, positions.length / 3);
    riverDomain.debugStats.wallTopGapMean = wallTopGapCount > 0 ? wallTopGapSum / wallTopGapCount : 0;
    riverDomain.debugStats.wallTopGapMax = wallTopGapMax;
    if (riverDomain.debugStats.protrudingVertexRatio > 0.04) {
      console.warn(
        `[threeTestTerrain] river domain wall alignment warning protrudingRatio=${riverDomain.debugStats.protrudingVertexRatio.toFixed(3)}`
      );
    }
    if (riverDomain.debugStats.wallTopGapMax > WALL_TOP_GAP_WARN) {
      console.warn(
        `[threeTestTerrain] river wall top-gap warning mean=${riverDomain.debugStats.wallTopGapMean.toFixed(4)} max=${riverDomain.debugStats.wallTopGapMax.toFixed(4)}`
      );
    }
  }

  return {
    positions: new Float32Array(positions),
    uvs: new Float32Array(uvs),
    indices: new Uint32Array(indices),
    wallPositions: wallPositions.length > 0 ? new Float32Array(wallPositions) : undefined,
    wallUvs: wallUvs.length > 0 ? new Float32Array(wallUvs) : undefined,
    wallIndices: wallIndices.length > 0 ? new Uint32Array(wallIndices) : undefined,
    bankDist: new Float32Array(bankDist),
    flowDir: new Float32Array(flowDir),
    flowSpeed: new Float32Array(flowSpeed),
    rapid: new Float32Array(rapid),
    supportMap: riverSupportMap,
    flowMap: riverFlowMap,
    rapidMap: riverRapidMap,
    riverBankMap,
    waterfallInfluenceMap: riverWaterfallInfluence,
    level: waterLevelWorld,
    cols,
    rows,
    width,
    depth,
    debugRiverDomainStats: riverDomain.debugStats
  };
};

export const buildRoadOverlayTexture = (
  sample: TerrainSample,
  roadId: number,
  baseId: number,
  roadWidth: number,
  scale: number
): THREE.Texture | null => {
  const tileTypes = sample.tileTypes;
  const roadBridgeMask = sample.roadBridgeMask;
  const roadEdges = sample.roadEdges;
  if (!tileTypes) {
    return null;
  }
  const { cols, rows } = sample;
  const total = cols * rows;
  const hasRoadEdges = !!roadEdges && roadEdges.length === total;
  const getIndex = (x: number, y: number): number => y * cols + x;
  const isRoadLike = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return false;
    }
    const idx = getIndex(x, y);
    const type = tileTypes[idx];
    return type === roadId || type === baseId || (roadBridgeMask ? roadBridgeMask[idx] > 0 : false);
  };
  const isBridge = (x: number, y: number): boolean => {
    if (!roadBridgeMask || x < 0 || y < 0 || x >= cols || y >= rows) {
      return false;
    }
    return roadBridgeMask[getIndex(x, y)] > 0;
  };
  const getRoadMask = (x: number, y: number): number => {
    if (!isRoadLike(x, y)) {
      return 0;
    }
    if (hasRoadEdges && roadEdges) {
      const idx = getIndex(x, y);
      let mask = roadEdges[idx] ?? 0;
      let sanitized = 0;
      for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
        const dir = ROAD_EDGE_DIRS[i];
        if ((mask & dir.bit) === 0) {
          continue;
        }
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (!isRoadLike(nx, ny)) {
          continue;
        }
        sanitized |= dir.bit;
      }
      if (sanitized !== 0) {
        return sanitized;
      }
    }
    let mask = 0;
    if (isRoadLike(x, y - 1)) {
      mask |= ROAD_EDGE_N;
    }
    if (isRoadLike(x + 1, y)) {
      mask |= ROAD_EDGE_E;
    }
    if (isRoadLike(x, y + 1)) {
      mask |= ROAD_EDGE_S;
    }
    if (isRoadLike(x - 1, y)) {
      mask |= ROAD_EDGE_W;
    }
    if (isRoadLike(x + 1, y - 1)) {
      mask |= ROAD_EDGE_NE;
    }
    if (isRoadLike(x - 1, y - 1)) {
      mask |= ROAD_EDGE_NW;
    }
    if (isRoadLike(x + 1, y + 1)) {
      mask |= ROAD_EDGE_SE;
    }
    if (isRoadLike(x - 1, y + 1)) {
      mask |= ROAD_EDGE_SW;
    }
    return mask;
  };

  const popCount4 = (mask: number, bits: number[]): number =>
    Number((mask & bits[0]) > 0) +
    Number((mask & bits[1]) > 0) +
    Number((mask & bits[2]) > 0) +
    Number((mask & bits[3]) > 0);

  const cardinalRotation = (bit: number): number => {
    if (bit === ROAD_EDGE_N) {
      return 0;
    }
    if (bit === ROAD_EDGE_E) {
      return Math.PI / 2;
    }
    if (bit === ROAD_EDGE_S) {
      return Math.PI;
    }
    return -Math.PI / 2;
  };

  const diagonalRotation = (bit: number): number => {
    if (bit === ROAD_EDGE_NE) {
      return 0;
    }
    if (bit === ROAD_EDGE_SE) {
      return Math.PI / 2;
    }
    if (bit === ROAD_EDGE_SW) {
      return Math.PI;
    }
    return -Math.PI / 2;
  };
  const cornerRotationFromNe = (corner: "NE" | "SE" | "SW" | "NW"): number => {
    if (corner === "NE") {
      return 0;
    }
    if (corner === "SE") {
      return Math.PI / 2;
    }
    if (corner === "SW") {
      return Math.PI;
    }
    return -Math.PI / 2;
  };
  const firstSetBit = (mask: number, bits: number[]): number => {
    for (let i = 0; i < bits.length; i += 1) {
      if ((mask & bits[i]) > 0) {
        return bits[i];
      }
    }
    return 0;
  };
  const longCornerWToNeRotation = (orthBit: number, diagBit: number): number | null => {
    if (orthBit === ROAD_EDGE_W && diagBit === ROAD_EDGE_NE) {
      return 0;
    }
    if (orthBit === ROAD_EDGE_N && diagBit === ROAD_EDGE_SE) {
      return Math.PI / 2;
    }
    if (orthBit === ROAD_EDGE_E && diagBit === ROAD_EDGE_SW) {
      return Math.PI;
    }
    if (orthBit === ROAD_EDGE_S && diagBit === ROAD_EDGE_NW) {
      return -Math.PI / 2;
    }
    return null;
  };
  const longCornerWToSeRotation = (orthBit: number, diagBit: number): number | null => {
    if (orthBit === ROAD_EDGE_W && diagBit === ROAD_EDGE_SE) {
      return 0;
    }
    if (orthBit === ROAD_EDGE_N && diagBit === ROAD_EDGE_SW) {
      return Math.PI / 2;
    }
    if (orthBit === ROAD_EDGE_E && diagBit === ROAD_EDGE_NW) {
      return Math.PI;
    }
    if (orthBit === ROAD_EDGE_S && diagBit === ROAD_EDGE_NE) {
      return -Math.PI / 2;
    }
    return null;
  };
  const teeRotation = (missingBit: number): number => {
    // Atlas base_tee source is missing WEST (N+E+S connected) at 0 rotation.
    if (missingBit === ROAD_EDGE_W) {
      return 0;
    }
    if (missingBit === ROAD_EDGE_N) {
      return Math.PI / 2;
    }
    if (missingBit === ROAD_EDGE_E) {
      return Math.PI;
    }
    return -Math.PI / 2;
  };
  const cornerRotation = (orthMask: number): number => {
    if ((orthMask & (ROAD_EDGE_N | ROAD_EDGE_E)) === (ROAD_EDGE_N | ROAD_EDGE_E)) {
      return 0;
    }
    if ((orthMask & (ROAD_EDGE_E | ROAD_EDGE_S)) === (ROAD_EDGE_E | ROAD_EDGE_S)) {
      return Math.PI / 2;
    }
    if ((orthMask & (ROAD_EDGE_S | ROAD_EDGE_W)) === (ROAD_EDGE_S | ROAD_EDGE_W)) {
      return Math.PI;
    }
    return -Math.PI / 2;
  };

  const atlas = getRoadAtlas();
  const maxTileSpan = Math.max(1, Math.max(cols, rows));
  const maxSize = roadOverlayMaxSize || ROAD_TEX_MAX_SIZE;
  const baseScale = Math.round(scale);
  const tileSize = atlas
    ? Math.max(1, Math.min(atlas.tileSize, Math.floor(maxSize / maxTileSpan)))
    : Math.max(1, Math.min(baseScale, Math.floor(maxSize / maxTileSpan)));

  if (atlas && tileSize > 0) {
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, cols * tileSize);
    canvas.height = Math.max(1, rows * tileSize);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    ctx.imageSmoothingEnabled = true;
    const atlasTileSize = atlas.tileSize;
    const resolveTile = (...ids: string[]): { col: number; row: number } | null => {
      for (let i = 0; i < ids.length; i += 1) {
        const id = ids[i];
        const tile = atlas.tiles[id];
        if (tile) {
          return tile;
        }
      }
      return null;
    };
    const drawAtlasTile = (
      tileIds: string[],
      tileX: number,
      tileY: number,
      rotation = 0,
      scaleFactor = 1,
      align: "center" | "NW" | "NE" | "SE" | "SW" = "center"
    ) => {
      const tile = resolveTile(...tileIds);
      if (!tile) {
        return;
      }
      if (tile.col >= atlas.cols || tile.row >= atlas.rows) {
        return;
      }
      const srcX = tile.col * atlas.tileStride;
      const srcY = tile.row * atlas.tileStride;
      if (srcX + atlasTileSize > atlas.canvas.width || srcY + atlasTileSize > atlas.canvas.height) {
        return;
      }
      const dstSize = tileSize * scaleFactor;
      let dx = tileX * tileSize;
      let dy = tileY * tileSize;
      if (align === "center") {
        dx += (tileSize - dstSize) / 2;
        dy += (tileSize - dstSize) / 2;
      } else {
        if (align.includes("N")) {
          dy += 0;
        }
        if (align.includes("S")) {
          dy += tileSize - dstSize;
        }
        if (align.includes("W")) {
          dx += 0;
        }
        if (align.includes("E")) {
          dx += tileSize - dstSize;
        }
      }
      ctx.save();
      ctx.translate(dx + dstSize / 2, dy + dstSize / 2);
      ctx.rotate(rotation);
      ctx.drawImage(
        atlas.canvas,
        srcX,
        srcY,
        atlasTileSize,
        atlasTileSize,
        -dstSize / 2,
        -dstSize / 2,
        dstSize,
        dstSize
      );
      ctx.restore();
    };
    const drawInfillAt = (targetX: number, targetY: number, corner: "NE" | "SE" | "SW" | "NW"): void => {
      if (targetX < 0 || targetY < 0 || targetX >= cols || targetY >= rows) {
        return;
      }
      if (isRoadLike(targetX, targetY)) {
        return;
      }
      drawAtlasTile(["diag_infill_ne"], targetX, targetY, cornerRotationFromNe(corner));
    };

    for (let tileY = 0; tileY < rows; tileY += 1) {
      for (let tileX = 0; tileX < cols; tileX += 1) {
        if (!isRoadLike(tileX, tileY)) {
          continue;
        }
        const mask = getRoadMask(tileX, tileY);
        const orthMask = mask & ROAD_EDGE_CARDINAL_MASK;
        const diagMask = mask & ROAD_EDGE_DIAGONAL_MASK;
        const orthCount = popCount4(orthMask, [ROAD_EDGE_N, ROAD_EDGE_E, ROAD_EDGE_S, ROAD_EDGE_W]);
        const diagCount = popCount4(diagMask, [ROAD_EDGE_NE, ROAD_EDGE_NW, ROAD_EDGE_SE, ROAD_EDGE_SW]);

        const isStraightOrth =
          orthCount === 2 &&
          (((orthMask & (ROAD_EDGE_N | ROAD_EDGE_S)) === (ROAD_EDGE_N | ROAD_EDGE_S)) ||
            ((orthMask & (ROAD_EDGE_E | ROAD_EDGE_W)) === (ROAD_EDGE_E | ROAD_EDGE_W)));
        const isCornerOrth = orthCount === 2 && !isStraightOrth;

        // Layer A: orth topology (use dedicated corner/tee/cross when available).
        if (orthCount >= 4) {
          drawAtlasTile(["base_cross"], tileX, tileY);
        } else if (orthCount === 3) {
          const missing =
            (orthMask & ROAD_EDGE_N) === 0 ? ROAD_EDGE_N :
            (orthMask & ROAD_EDGE_E) === 0 ? ROAD_EDGE_E :
            (orthMask & ROAD_EDGE_S) === 0 ? ROAD_EDGE_S : ROAD_EDGE_W;
          drawAtlasTile(["base_tee"], tileX, tileY, teeRotation(missing));
        } else if (isCornerOrth) {
          drawAtlasTile(["base_corner_ne", "base_corner", "corner_ne"], tileX, tileY, cornerRotation(orthMask));
        } else if (orthCount === 0 && diagCount === 0) {
          drawAtlasTile(["base_isolated"], tileX, tileY);
        } else {
          if ((orthMask & ROAD_EDGE_N) > 0) {
            drawAtlasTile(["base_endcap_cardinal"], tileX, tileY, cardinalRotation(ROAD_EDGE_N));
          }
          if ((orthMask & ROAD_EDGE_E) > 0) {
            drawAtlasTile(["base_endcap_cardinal"], tileX, tileY, cardinalRotation(ROAD_EDGE_E));
          }
          if ((orthMask & ROAD_EDGE_S) > 0) {
            drawAtlasTile(["base_endcap_cardinal"], tileX, tileY, cardinalRotation(ROAD_EDGE_S));
          }
          if ((orthMask & ROAD_EDGE_W) > 0) {
            drawAtlasTile(["base_endcap_cardinal"], tileX, tileY, cardinalRotation(ROAD_EDGE_W));
          }
        }

        // Layer B: diagonal stubs from diagonal endcaps.
        if ((diagMask & ROAD_EDGE_NE) > 0) {
          drawAtlasTile(["base_endcap_diagonal"], tileX, tileY, diagonalRotation(ROAD_EDGE_NE));
        }
        if ((diagMask & ROAD_EDGE_NW) > 0) {
          drawAtlasTile(["base_endcap_diagonal"], tileX, tileY, diagonalRotation(ROAD_EDGE_NW));
        }
        if ((diagMask & ROAD_EDGE_SE) > 0) {
          drawAtlasTile(["base_endcap_diagonal"], tileX, tileY, diagonalRotation(ROAD_EDGE_SE));
        }
        if ((diagMask & ROAD_EDGE_SW) > 0) {
          drawAtlasTile(["base_endcap_diagonal"], tileX, tileY, diagonalRotation(ROAD_EDGE_SW));
        }

        // Layer C: mixed-pattern overlays for common orth+diag combinations.
        if (orthCount === 1 && diagCount === 1) {
          const orthBit = firstSetBit(orthMask, [ROAD_EDGE_N, ROAD_EDGE_E, ROAD_EDGE_S, ROAD_EDGE_W]);
          const diagBit = firstSetBit(diagMask, [ROAD_EDGE_NE, ROAD_EDGE_NW, ROAD_EDGE_SE, ROAD_EDGE_SW]);
          const longRotationNe = longCornerWToNeRotation(orthBit, diagBit);
          const longRotationSe = longCornerWToSeRotation(orthBit, diagBit);
          if (longRotationNe !== null) {
            drawAtlasTile(["mix_diag_to_straight_w_ne"], tileX, tileY, longRotationNe);
          } else if (longRotationSe !== null) {
            drawAtlasTile(["mix_diag_to_straight_w_se"], tileX, tileY, longRotationSe);
          } else {
            drawAtlasTile(["mix_cardinal_diag_adjacent"], tileX, tileY, cardinalRotation(orthBit));
          }
        } else if (orthCount === 1 && diagCount > 1) {
          const orthBit = firstSetBit(orthMask, [ROAD_EDGE_N, ROAD_EDGE_E, ROAD_EDGE_S, ROAD_EDGE_W]);
          drawAtlasTile(["mix_cardinal_diag_adjacent"], tileX, tileY, cardinalRotation(orthBit));
        } else if (orthCount === 2 && diagCount === 1) {
          const isNS = (orthMask & (ROAD_EDGE_N | ROAD_EDGE_S)) === (ROAD_EDGE_N | ROAD_EDGE_S);
          const isEW = (orthMask & (ROAD_EDGE_E | ROAD_EDGE_W)) === (ROAD_EDGE_E | ROAD_EDGE_W);
          if (isNS) {
            drawAtlasTile(["mix_straight_diag_single_ns"], tileX, tileY);
          } else if (isEW) {
            drawAtlasTile(["mix_straight_diag_single_ew"], tileX, tileY);
          } else {
            drawAtlasTile(["mix_corner_diag_outer"], tileX, tileY, cornerRotation(orthMask));
          }
        } else if (orthCount === 2 && diagCount >= 2) {
          const isNS = (orthMask & (ROAD_EDGE_N | ROAD_EDGE_S)) === (ROAD_EDGE_N | ROAD_EDGE_S);
          const isEW = (orthMask & (ROAD_EDGE_E | ROAD_EDGE_W)) === (ROAD_EDGE_E | ROAD_EDGE_W);
          if (isNS) {
            drawAtlasTile(["mix_straight_diag_pair_ns"], tileX, tileY);
          } else if (isEW) {
            drawAtlasTile(["mix_straight_diag_pair_ew"], tileX, tileY);
          } else {
            drawAtlasTile(["mix_corner_diag_outer"], tileX, tileY, cornerRotation(orthMask));
          }
        } else if (orthCount === 3 && diagCount >= 1) {
          const missing =
            (orthMask & ROAD_EDGE_N) === 0 ? ROAD_EDGE_N :
            (orthMask & ROAD_EDGE_E) === 0 ? ROAD_EDGE_E :
            (orthMask & ROAD_EDGE_S) === 0 ? ROAD_EDGE_S : ROAD_EDGE_W;
          drawAtlasTile(["mix_tee_diag"], tileX, tileY, cardinalRotation(missing));
        } else if ((orthCount >= 3 && diagCount >= 2) || (orthCount >= 2 && diagCount >= 3)) {
          drawAtlasTile(["mix_hub_dense"], tileX, tileY);
        }

        // Layer C2: diagonal infill into adjacent non-road cells for exposed diagonals.
        const useNE =
          (diagMask & ROAD_EDGE_NE) > 0 && !((orthMask & ROAD_EDGE_N) > 0 && (orthMask & ROAD_EDGE_E) > 0);
        const useNW =
          (diagMask & ROAD_EDGE_NW) > 0 && !((orthMask & ROAD_EDGE_N) > 0 && (orthMask & ROAD_EDGE_W) > 0);
        const useSE =
          (diagMask & ROAD_EDGE_SE) > 0 && !((orthMask & ROAD_EDGE_S) > 0 && (orthMask & ROAD_EDGE_E) > 0);
        const useSW =
          (diagMask & ROAD_EDGE_SW) > 0 && !((orthMask & ROAD_EDGE_S) > 0 && (orthMask & ROAD_EDGE_W) > 0);

        if (useNE) {
          drawInfillAt(tileX + 1, tileY, "NW");
          drawInfillAt(tileX, tileY - 1, "SE");
        }
        if (useNW) {
          drawInfillAt(tileX - 1, tileY, "NE");
          drawInfillAt(tileX, tileY - 1, "SW");
        }
        if (useSE) {
          drawInfillAt(tileX + 1, tileY, "SW");
          drawInfillAt(tileX, tileY + 1, "NE");
        }
        if (useSW) {
          drawInfillAt(tileX - 1, tileY, "SE");
          drawInfillAt(tileX, tileY + 1, "NW");
        }

        // Layer D: bridge transition abutments.
        if (roadBridgeMask && !isBridge(tileX, tileY)) {
          for (let i = 0; i < ROAD_EDGE_DIRS.length; i += 1) {
            const dir = ROAD_EDGE_DIRS[i];
            if ((mask & dir.bit) === 0) {
              continue;
            }
            const nx = tileX + dir.dx;
            const ny = tileY + dir.dy;
            if (!isBridge(nx, ny)) {
              continue;
            }
            drawAtlasTile(
              [dir.diagonal ? "bridge_abutment_diagonal" : "bridge_abutment_cardinal"],
              tileX,
              tileY,
              dir.diagonal ? diagonalRotation(dir.bit) : cardinalRotation(dir.bit)
            );
          }
        }
      }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.flipY = true;
    texture.generateMipmaps = false;
    texture.anisotropy = 4;
    return texture;
  }
  const texCols = Math.max(1, cols * tileSize);
  const texRows = Math.max(1, rows * tileSize);
  const data = new Uint8Array(texCols * texRows * 4);
  const roadColor = TILE_COLOR_RGB.road;
  const roadPixels = Math.max(1, Math.round(roadWidth * tileSize));
  const bandStart = Math.floor((tileSize - roadPixels) / 2);
  const bandEnd = Math.min(tileSize - 1, bandStart + roadPixels - 1);
  const halfPixels = Math.max(0.5, roadPixels / 2);
  const center = (tileSize - 1) / 2;
  const snipSize = Math.max(1, Math.round(roadPixels * 0.5));
  const setPixel = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= texCols || y >= texRows) {
      return;
    }
    const idx = (y * texCols + x) * 4;
    data[idx] = roadColor.r;
    data[idx + 1] = roadColor.g;
    data[idx + 2] = roadColor.b;
    data[idx + 3] = 255;
  };
  const fillRect = (x0: number, y0: number, x1: number, y1: number) => {
    const minX = Math.max(0, Math.min(x0, x1));
    const maxX = Math.min(texCols - 1, Math.max(x0, x1));
    const minY = Math.max(0, Math.min(y0, y1));
    const maxY = Math.min(texRows - 1, Math.max(y0, y1));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        setPixel(x, y);
      }
    }
  };
  const drawLine = (x0: number, y0: number, x1: number, y1: number) => {
    const minX = Math.max(0, Math.floor(Math.min(x0, x1) - halfPixels - 1));
    const maxX = Math.min(texCols - 1, Math.ceil(Math.max(x0, x1) + halfPixels + 1));
    const minY = Math.max(0, Math.floor(Math.min(y0, y1) - halfPixels - 1));
    const maxY = Math.min(texRows - 1, Math.ceil(Math.max(y0, y1) + halfPixels + 1));
    const dx = x1 - x0;
    const dy = y1 - y0;
    const lenSq = dx * dx + dy * dy || 1;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const px = x + 0.5;
        const py = y + 0.5;
        const t = Math.max(0, Math.min(1, ((px - x0) * dx + (py - y0) * dy) / lenSq));
        const sx = x0 + dx * t;
        const sy = y0 + dy * t;
        const distSq = (px - sx) * (px - sx) + (py - sy) * (py - sy);
        if (distSq <= halfPixels * halfPixels) {
          setPixel(x, y);
        }
      }
    }
  };
  const tileOffsetX = (tileX: number) => tileX * tileSize;
  const tileOffsetY = (tileY: number) => tileY * tileSize;
  const stampRect = (tileX: number, tileY: number, x0: number, y0: number, x1: number, y1: number) => {
    const ox = tileOffsetX(tileX);
    const oy = tileOffsetY(tileY);
    fillRect(ox + x0, oy + y0, ox + x1, oy + y1);
  };
  const stampCorner = (tileX: number, tileY: number, corner: "NW" | "NE" | "SE" | "SW") => {
    if (tileX < 0 || tileY < 0 || tileX >= cols || tileY >= rows) {
      return;
    }
    const ox = tileOffsetX(tileX);
    const oy = tileOffsetY(tileY);
    const x0 = corner.includes("E") ? tileSize - snipSize : 0;
    const y0 = corner.includes("S") ? tileSize - snipSize : 0;
    fillRect(ox + x0, oy + y0, ox + x0 + snipSize - 1, oy + y0 + snipSize - 1);
  };
  const drawDiagonal = (tileX: number, tileY: number, corner: "NE" | "NW" | "SE" | "SW") => {
    const ox = tileOffsetX(tileX);
    const oy = tileOffsetY(tileY);
    const cx = ox + center;
    const cy = oy + center;
    const ex = ox + (corner.includes("E") ? tileSize - 1 : 0);
    const ey = oy + (corner.includes("S") ? tileSize - 1 : 0);
    drawLine(cx, cy, ex, ey);
    stampCorner(tileX, tileY, corner);
  };

  for (let tileY = 0; tileY < rows; tileY += 1) {
    for (let tileX = 0; tileX < cols; tileX += 1) {
      if (!isRoadLike(tileX, tileY)) {
        continue;
      }
      const mask = getRoadMask(tileX, tileY);
      const n = (mask & ROAD_EDGE_N) > 0;
      const s = (mask & ROAD_EDGE_S) > 0;
      const w = (mask & ROAD_EDGE_W) > 0;
      const e = (mask & ROAD_EDGE_E) > 0;
      const ne = (mask & ROAD_EDGE_NE) > 0;
      const nw = (mask & ROAD_EDGE_NW) > 0;
      const se = (mask & ROAD_EDGE_SE) > 0;
      const sw = (mask & ROAD_EDGE_SW) > 0;

      if (n) {
        stampRect(tileX, tileY, bandStart, 0, bandEnd, bandEnd);
      }
      if (s) {
        stampRect(tileX, tileY, bandStart, bandStart, bandEnd, tileSize - 1);
      }
      if (w) {
        stampRect(tileX, tileY, 0, bandStart, bandEnd, bandEnd);
      }
      if (e) {
        stampRect(tileX, tileY, bandStart, bandStart, tileSize - 1, bandEnd);
      }

      const useNE = ne && !(n && e);
      const useNW = nw && !(n && w);
      const useSE = se && !(s && e);
      const useSW = sw && !(s && w);

      if (useNE) {
        drawDiagonal(tileX, tileY, "NE");
        if (!e) {
          stampCorner(tileX + 1, tileY, "NW");
        }
        if (!n) {
          stampCorner(tileX, tileY - 1, "SE");
        }
      }
      if (useNW) {
        drawDiagonal(tileX, tileY, "NW");
        if (!w) {
          stampCorner(tileX - 1, tileY, "NE");
        }
        if (!n) {
          stampCorner(tileX, tileY - 1, "SW");
        }
      }
      if (useSE) {
        drawDiagonal(tileX, tileY, "SE");
        if (!e) {
          stampCorner(tileX + 1, tileY, "SW");
        }
        if (!s) {
          stampCorner(tileX, tileY + 1, "NE");
        }
      }
      if (useSW) {
        drawDiagonal(tileX, tileY, "SW");
        if (!w) {
          stampCorner(tileX - 1, tileY, "SE");
        }
        if (!s) {
          stampCorner(tileX, tileY + 1, "NW");
        }
      }

      const hasAny =
        n || s || w || e || useNE || useNW || useSE || useSW;
      if (!hasAny) {
        stampRect(tileX, tileY, bandStart, bandStart, bandEnd, bandEnd);
      }
    }
  }

  const texture = new THREE.DataTexture(data, texCols, texRows, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.generateMipmaps = false;
  texture.anisotropy = 4;
  return texture;
};

const buildBridgeDeckMesh = (
  sample: TerrainSample,
  width: number,
  depth: number,
  heightScale: number
): THREE.InstancedMesh | null => {
  const bridgeMask = sample.roadBridgeMask;
  if (!bridgeMask || bridgeMask.length === 0) {
    return null;
  }
  const { cols, rows, elevations } = sample;
  const riverSurface = sample.riverSurface;
  const bridgeIndices: number[] = [];
  for (let i = 0; i < bridgeMask.length; i += 1) {
    if (bridgeMask[i] > 0) {
      bridgeIndices.push(i);
    }
  }
  if (bridgeIndices.length === 0) {
    return null;
  }

  const roadColor = TILE_COLOR_RGB.road;
  const bridgeColor = new THREE.Color(
    clamp((roadColor.r + 28) / 255, 0, 1),
    clamp((roadColor.g + 28) / 255, 0, 1),
    clamp((roadColor.b + 28) / 255, 0, 1)
  );
  const deckGeometry = new THREE.BoxGeometry(1, 1, 1);
  const deckMaterial = new THREE.MeshStandardMaterial({
    color: bridgeColor,
    roughness: 0.92,
    metalness: 0.03
  });
  const mesh = new THREE.InstancedMesh(deckGeometry, deckMaterial, bridgeIndices.length);
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();

  const neighborOffsets = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
    { x: 1, y: 1 },
    { x: 1, y: -1 },
    { x: -1, y: 1 },
    { x: -1, y: -1 }
  ];

  for (let i = 0; i < bridgeIndices.length; i += 1) {
    const idx = bridgeIndices[i];
    const tileX = idx % cols;
    const tileY = Math.floor(idx / cols);
    const n = tileY > 0 && bridgeMask[(tileY - 1) * cols + tileX] > 0;
    const s = tileY < rows - 1 && bridgeMask[(tileY + 1) * cols + tileX] > 0;
    const w = tileX > 0 && bridgeMask[tileY * cols + tileX - 1] > 0;
    const e = tileX < cols - 1 && bridgeMask[tileY * cols + tileX + 1] > 0;

    const alongX = e || w;
    const alongZ = n || s;
    const deckWidth = alongX && !alongZ ? 1.26 : alongX && alongZ ? 1.08 : 0.98;
    const deckDepth = alongZ && !alongX ? 1.26 : alongX && alongZ ? 1.08 : 0.98;
    const deckThickness = 0.08;

    const rawSurface = Number.isFinite(riverSurface?.[idx]) ? (riverSurface?.[idx] as number) : elevations[idx] ?? 0;
    const riverSurfaceY = clamp(rawSurface, 0, 1) * heightScale;

    let bankY = Number.NEGATIVE_INFINITY;
    for (const offset of neighborOffsets) {
      const nx = tileX + offset.x;
      const ny = tileY + offset.y;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = ny * cols + nx;
      if (bridgeMask[nIdx] > 0) {
        continue;
      }
      bankY = Math.max(bankY, clamp(elevations[nIdx] ?? 0, 0, 1) * heightScale);
    }
    if (!Number.isFinite(bankY)) {
      bankY = clamp(elevations[idx] ?? 0, 0, 1) * heightScale;
    }
    const deckY = Math.max(riverSurfaceY + 0.35, bankY + 0.12);

    position.set(
      ((tileX + 0.5) / Math.max(1, cols) - 0.5) * width,
      deckY,
      ((tileY + 0.5) / Math.max(1, rows) - 0.5) * depth
    );
    scale.set(deckWidth, deckThickness, deckDepth);
    matrix.compose(position, quaternion, scale);
    mesh.setMatrixAt(i, matrix);
  }

  mesh.castShadow = false;
  mesh.receiveShadow = true;
  mesh.renderOrder = 2;
  mesh.userData.bridgeDeck = true;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
};

const buildWaterSurfaceHeights = (
  sampleHeights: Float32Array,
  supportMask: Uint8Array,
  oceanRatio: Float32Array,
  riverRatio: Float32Array,
  sampleCols: number,
  sampleRows: number,
  oceanLevel: number | null,
  sampledRiverSurface?: Float32Array,
  sampledRiverStepStrength?: Float32Array
): Float32Array => {
  const total = sampleCols * sampleRows;
  const heights = new Float32Array(total).fill(Number.NaN);
  const visited = new Uint8Array(total);
  const queue = new Int32Array(total);
  const components: WaterComponent[] = [];
  let head = 0;
  let tail = 0;

  const push = (idx: number) => {
    visited[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };

  const hasWater = (idx: number): boolean => (supportMask[idx] ?? 0) > 0;
  const hasOcean = (idx: number): boolean =>
    hasWater(idx) && (oceanRatio[idx] ?? 0) >= OCEAN_RATIO_MIN;
  const isRiverCell = (idx: number): boolean =>
    hasWater(idx) && (riverRatio[idx] ?? 0) >= RIVER_RATIO_MIN;

  for (let i = 0; i < total; i += 1) {
    if (!hasWater(i) || !isRiverCell(i) || !sampledRiverSurface) {
      continue;
    }
    const riverSurface = sampledRiverSurface[i];
    if (!Number.isFinite(riverSurface)) {
      continue;
    }
    heights[i] = clamp(riverSurface, 0, 1);
  }

  const floodComponent = (seed: number, predicate: (idx: number) => boolean): WaterComponent | null => {
    if (visited[seed] || !predicate(seed)) {
      return null;
    }
    head = 0;
    tail = 0;
    push(seed);
    const component: WaterComponent = { indices: [], min: Number.POSITIVE_INFINITY };
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      component.indices.push(idx);
      component.min = Math.min(component.min, sampleHeights[idx] ?? 0);
      const x = idx % sampleCols;
      const y = Math.floor(idx / sampleCols);
      const neighbors = [idx - 1, idx + 1, idx - sampleCols, idx + sampleCols];
      for (const nIdx of neighbors) {
        if (nIdx < 0 || nIdx >= total) {
          continue;
        }
        if (visited[nIdx] || !predicate(nIdx)) {
          continue;
        }
        const nx = nIdx % sampleCols;
        const ny = Math.floor(nIdx / sampleCols);
        if (Math.abs(nx - x) + Math.abs(ny - y) !== 1) {
          continue;
        }
        push(nIdx);
      }
    }
    return component;
  };

  for (let i = 0; i < total; i += 1) {
    if (visited[i] || !hasOcean(i)) {
      continue;
    }
    const component = floodComponent(i, hasOcean);
    if (!component) {
      continue;
    }
    components.push(component);
  }

  for (const component of components) {
    const level = oceanLevel !== null ? clamp(oceanLevel, 0, 1) : clamp(component.min + 0.01, 0, 1);
    component.indices.forEach((idx) => {
      heights[idx] = level;
    });
  }

  visited.fill(0);
  for (let i = 0; i < total; i += 1) {
    if (visited[i] || !hasWater(i) || Number.isFinite(heights[i])) {
      continue;
    }
    const component = floodComponent(i, (idx) => hasWater(idx) && !Number.isFinite(heights[idx]));
    if (!component) {
      continue;
    }
    const level = clamp(component.min + 0.01, 0, 1);
    component.indices.forEach((idx) => {
      heights[idx] = level;
    });
  }

  for (let i = 0; i < total; i += 1) {
    if (!Number.isFinite(heights[i])) {
      heights[i] = sampleHeights[i] ?? 0;
    }
  }

  if (sampledRiverSurface && oceanLevel !== null) {
    const oceanLevelClamped = clamp(oceanLevel, 0, 1);
    for (let i = 0; i < total; i += 1) {
      if (!hasWater(i)) {
        continue;
      }
      const river = clamp(riverRatio[i] ?? 0, 0, 1);
      const ocean = clamp(oceanRatio[i] ?? 0, 0, 1);
      if (river <= 0.01 || ocean <= 0.01) {
        continue;
      }
      const riverSurface = sampledRiverSurface[i];
      if (!Number.isFinite(riverSurface)) {
        continue;
      }
      const rawStepStrength = sampledRiverStepStrength ? sampledRiverStepStrength[i] : 0;
      const stepStrength = Number.isFinite(rawStepStrength) ? clamp(rawStepStrength as number, 0, 1) : 0;
      if (stepStrength >= RIVER_STEP_BLEND_BLOCK_THRESHOLD) {
        continue;
      }
      const estuaryBlend = clamp((Math.min(river, ocean) - 0.06) / 0.24, 0, 1);
      if (estuaryBlend <= 0) {
        continue;
      }
      const blended = clamp(riverSurface * (1 - estuaryBlend) + oceanLevelClamped * estuaryBlend, 0, 1);
      heights[i] = blended;
    }
  }

  const smoothed = new Float32Array(total);
  for (let row = 0; row < sampleRows; row += 1) {
    for (let col = 0; col < sampleCols; col += 1) {
      const idx = row * sampleCols + col;
      if (!hasWater(idx)) {
        smoothed[idx] = heights[idx];
        continue;
      }
      const center = heights[idx];
      let sum = center;
      let count = 1;
      const neighbors = [idx - 1, idx + 1, idx - sampleCols, idx + sampleCols];
      for (const nIdx of neighbors) {
        if (nIdx < 0 || nIdx >= total || !hasWater(nIdx)) {
          continue;
        }
        sum += heights[nIdx];
        count += 1;
      }
      const avg = sum / Math.max(1, count);
      const river = clamp(riverRatio[idx] ?? 0, 0, 1);
      const ocean = clamp(oceanRatio[idx] ?? 0, 0, 1);
      const rawStepStrength = sampledRiverStepStrength ? sampledRiverStepStrength[idx] : 0;
      const stepStrength = Number.isFinite(rawStepStrength) ? clamp(rawStepStrength as number, 0, 1) : 0;
      const estuary = clamp((Math.min(river, ocean) - 0.05) / 0.2, 0, 1);
      const inlandRiver = clamp((river - ocean * 0.6 - 0.06) / 0.55, 0, 1);
      const stepBlend = clamp((stepStrength - 0.14) / (0.5 - 0.14), 0, 1);
      const stepDampen = 1 - stepBlend;
      const smoothAmt = (0.03 + estuary * 0.2) * (1 - inlandRiver * 0.72) * stepDampen;
      const target = center * (1 - smoothAmt) + avg * smoothAmt;
      const maxDelta = (0.004 + estuary * 0.035) * (1 - inlandRiver * 0.65) * stepDampen;
      if (maxDelta <= 1e-5) {
        smoothed[idx] = center;
      } else {
        smoothed[idx] = clamp(target, center - maxDelta, center + maxDelta);
      }
    }
  }
  heights.set(smoothed);
  if (sampledRiverSurface) {
    for (let i = 0; i < total; i += 1) {
      if (!hasWater(i)) {
        continue;
      }
      const riverSurface = sampledRiverSurface[i];
      if (!Number.isFinite(riverSurface)) {
        continue;
      }
      const river = clamp(riverRatio[i] ?? 0, 0, 1);
      const ocean = clamp(oceanRatio[i] ?? 0, 0, 1);
      const rawStepStrength = sampledRiverStepStrength ? sampledRiverStepStrength[i] : 0;
      const stepStrength = Number.isFinite(rawStepStrength) ? clamp(rawStepStrength as number, 0, 1) : 0;
      const riverDominance = clamp((river - ocean * 0.65 - 0.04) / 0.55, 0, 1);
      const stepKeep = clamp((stepStrength - 0.08) / 0.26, 0, 1);
      const preserve = clamp(riverDominance * 0.25 + stepKeep * 0.7, 0, 0.92);
      if (preserve <= 1e-5) {
        continue;
      }
      heights[i] = clamp(heights[i] * (1 - preserve) + riverSurface * preserve, 0, 1);
    }
  }

  return heights;
};

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
  sampledRiverCoverage: Float32Array | null,
  riverStepStrength: Float32Array | null | undefined,
  debugTypeColors: boolean
): THREE.DataTexture => {
  const { cols, rows } = sample;
  const treeTypes = sample.treeTypes;
  const riverMask = sample.riverMask;
  const tileMoisture = sample.tileMoisture;
  const climateDryness = clamp(sample.climateDryness ?? 0.35, 0, 1);
  const ashId = TILE_TYPE_IDS.ash;
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  const getRoadGroundColor = (row: number, col: number): number[] => {
    if (roadId === null) {
      return palette[grassId] ?? [0, 0, 0];
    }
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    let count = 0;
    const addNeighbor = (nRow: number, nCol: number) => {
      if (nRow < 0 || nCol < 0 || nRow >= sampleRows || nCol >= sampleCols) {
        return;
      }
      const t = sampleTypes[nRow * sampleCols + nCol];
      if (t === roadId) {
        return;
      }
      const source = t === waterId ? palette[grassId] : palette[t] ?? palette[grassId];
      if (!source) {
        return;
      }
      sumR += source[0];
      sumG += source[1];
      sumB += source[2];
      count += 1;
    };
    addNeighbor(row - 1, col);
    addNeighbor(row + 1, col);
    addNeighbor(row, col - 1);
    addNeighbor(row, col + 1);
    addNeighbor(row - 1, col - 1);
    addNeighbor(row - 1, col + 1);
    addNeighbor(row + 1, col - 1);
    addNeighbor(row + 1, col + 1);
    if (count === 0) {
      return palette[grassId] ?? [0, 0, 0];
    }
    return [sumR / count, sumG / count, sumB / count];
  };
  const heightAtSample = (x: number, y: number): number => {
    const clampedX = Math.max(0, Math.min(sampleCols - 1, x));
    const clampedY = Math.max(0, Math.min(sampleRows - 1, y));
    return sampleHeights[clampedY * sampleCols + clampedX] ?? 0;
  };
  let offset = 0;
  for (let row = 0; row < sampleRows; row += 1) {
    const tileY = Math.min(rows - 1, row * step);
    for (let col = 0; col < sampleCols; col += 1) {
      const tileX = Math.min(cols - 1, col * step);
      const idx = tileY * cols + tileX;
      const sampleIndex = row * sampleCols + col;
      const typeId = sampleTypes[sampleIndex] ?? grassId;
      const localWaterRatio = waterRatio ? clamp(waterRatio[sampleIndex] ?? 0, 0, 1) : typeId === waterId ? 1 : 0;
      const localOceanRatio = oceanRatio ? clamp(oceanRatio[sampleIndex] ?? 0, 0, 1) : localWaterRatio;
      const localRiverRatio = riverRatio ? clamp(riverRatio[sampleIndex] ?? 0, 0, 1) : 0;
      const localRiverCoverage = sampledRiverCoverage ? clamp(sampledRiverCoverage[sampleIndex] ?? 0, 0, 1) : localRiverRatio;
      const riverMaskAtTile = riverMask ? riverMask[idx] > 0 : false;
      const riverMaskNearby = (() => {
        if (!riverMask) {
          return false;
        }
        for (let oy = -1; oy <= 1; oy += 1) {
          for (let ox = -1; ox <= 1; ox += 1) {
            if (ox === 0 && oy === 0) {
              continue;
            }
            const nx = tileX + ox;
            const ny = tileY + oy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
              continue;
            }
            if (riverMask[ny * cols + nx] > 0) {
              return true;
            }
          }
        }
        return false;
      })();
      const rawStepStrength = riverStepStrength ? riverStepStrength[sampleIndex] : 0;
      const localStepStrength = Number.isFinite(rawStepStrength) ? clamp(rawStepStrength as number, 0, 1) : 0;
      let colorType = typeId;
      if (!debugTypeColors) {
        if (typeId === forestId) {
          colorType = grassId;
        } else if (typeId === beachId) {
          const riverBank =
            riverMaskAtTile ||
            riverMaskNearby ||
            localRiverCoverage >= 0.06 ||
            (localRiverRatio >= 0.03 &&
              localOceanRatio < Math.max(0.28, localRiverRatio * 1.25));
          if (riverBank) {
            colorType = grassId;
          }
        } else if (typeId === waterId) {
          const riverDominant =
            riverMaskAtTile ||
            localRiverCoverage >= 0.1 ||
            localRiverRatio >= Math.max(0.08, localOceanRatio * 0.7);
          const oceanShoreDominant = localOceanRatio >= Math.max(0.22, localRiverRatio * 1.35);
          const hasLandNeighbor =
            row === 0 ||
            col === 0 ||
            row === sampleRows - 1 ||
            col === sampleCols - 1 ||
            sampleTypes[sampleIndex - 1] !== waterId ||
            sampleTypes[sampleIndex + 1] !== waterId ||
            sampleTypes[sampleIndex - sampleCols] !== waterId ||
            sampleTypes[sampleIndex + sampleCols] !== waterId;
          if (riverDominant) {
            // River channels are rendered by the river mesh; terrain underlay should be bank/bed tones.
            colorType = floodplainId;
          } else {
            colorType = oceanShoreDominant && hasLandNeighbor ? beachId : waterId;
          }
        }
      }
      let color = palette[colorType] ?? palette[grassId];
      if (!debugTypeColors && roadId !== null && typeId === roadId) {
        color = getRoadGroundColor(row, col);
      }
      if (!debugTypeColors && typeId === forestId) {
        const dominantId = treeTypes ? treeTypes[idx] : 255;
        const tint = FOREST_TINT_BY_ID[dominantId] ?? FOREST_TONE_BASE;
        const tintColor: [number, number, number] = [tint.r / 255, tint.g / 255, tint.b / 255];
        const mixFactor = 0.55;
        color = [
          color[0] * (1 - mixFactor) + tintColor[0] * mixFactor,
          color[1] * (1 - mixFactor) + tintColor[1] * mixFactor,
          color[2] * (1 - mixFactor) + tintColor[2] * mixFactor
        ];
      }
      if (!debugTypeColors && typeId === ashId) {
        const ashNoise = noiseAt(idx * 5.131 + 91.7);
        const ashCool = noiseAt(idx * 1.977 + 13.4);
        const ashBase = 0.18 + ashNoise * 0.18;
        color = [
          ashBase * 0.95,
          ashBase * 0.93,
          ashBase * (1.0 + ashCool * 0.08)
        ];
      }
      if (!debugTypeColors && (typeId === grassId || typeId === scrubId || typeId === floodplainId || typeId === forestId)) {
        const localMoisture = tileMoisture ? clamp(tileMoisture[idx] ?? 0.5, 0, 1) : 0.5;
        const localDryness = 1 - localMoisture;
        const effectiveDryness = clamp(climateDryness * 0.72 + localDryness * 0.28, 0, 1);
        const dryTint = DRY_TINT_BY_TILE[typeId] ?? DRY_TINT_BY_TILE[grassId];
        const wetTint = WET_TINT_BY_TILE[typeId] ?? WET_TINT_BY_TILE[grassId];
        const dryWeight =
          (typeId === grassId ? 0.58 : typeId === scrubId ? 0.62 : typeId === floodplainId ? 0.34 : 0.26) *
          effectiveDryness;
        const wetWeight =
          (typeId === floodplainId ? 0.18 : 0.08) * (1 - effectiveDryness);
        color = [
          color[0] * (1 - dryWeight) + dryTint[0] * dryWeight,
          color[1] * (1 - dryWeight) + dryTint[1] * dryWeight,
          color[2] * (1 - dryWeight) + dryTint[2] * dryWeight
        ];
        if (wetWeight > 0.0001) {
          color = [
            color[0] * (1 - wetWeight) + wetTint[0] * wetWeight,
            color[1] * (1 - wetWeight) + wetTint[1] * wetWeight,
          color[2] * (1 - wetWeight) + wetTint[2] * wetWeight
          ];
        }
      }
      if (!debugTypeColors && sample.tileFuel && (typeId === grassId || typeId === scrubId || typeId === floodplainId || typeId === forestId)) {
        const baseFuel = BASE_FUEL_BY_TILE_ID[typeId] ?? 0;
        if (baseFuel > 0) {
          const localMoisture = tileMoisture ? clamp(tileMoisture[idx] ?? 0.5, 0, 1) : 0.5;
          const expectedFuel = Math.max(0.01, baseFuel * (1 - localMoisture * 0.6));
          const fuelNow = clamp(sample.tileFuel[idx] ?? expectedFuel, 0, expectedFuel);
          const fuelDepletion = clamp(1 - fuelNow / expectedFuel, 0, 1);
          const warmScorch = smoothstep(0.3, 0.85, fuelDepletion);
          const charScorch = smoothstep(0.62, 0.98, fuelDepletion);
          const warmMix = (typeId === forestId ? 0.46 : 0.34) * warmScorch;
          const charMix = (typeId === forestId ? 0.54 : 0.4) * charScorch;
          color = [
            color[0] * (1 - warmMix) + SCORCH_WARM_TINT[0] * warmMix,
            color[1] * (1 - warmMix) + SCORCH_WARM_TINT[1] * warmMix,
            color[2] * (1 - warmMix) + SCORCH_WARM_TINT[2] * warmMix
          ];
          color = [
            color[0] * (1 - charMix) + SCORCH_CHAR_TINT[0] * charMix,
            color[1] * (1 - charMix) + SCORCH_CHAR_TINT[1] * charMix,
            color[2] * (1 - charMix) + SCORCH_CHAR_TINT[2] * charMix
          ];
        }
      }
      if (!debugTypeColors && typeId === waterId && localRiverRatio >= RIVER_RATIO_MIN) {
        const rockyColor = palette[TILE_TYPE_IDS.rocky] ?? color;
        const floodColor = palette[floodplainId] ?? palette[grassId] ?? color;
        const wetBankColor: [number, number, number] = [
          floodColor[0] * 0.72 + rockyColor[0] * 0.28,
          floodColor[1] * 0.76 + rockyColor[1] * 0.24,
          floodColor[2] * 0.8 + rockyColor[2] * 0.2
        ];
        const blend = clamp(localRiverRatio * 1.25 + localRiverCoverage * 0.35, 0, 0.9);
        const riverbedColor: [number, number, number] = [
          color[0] * (1 - blend) + wetBankColor[0] * blend,
          color[1] * (1 - blend) + wetBankColor[1] * blend,
          color[2] * (1 - blend) + wetBankColor[2] * blend
        ];
        const rockyStepBlend = clamp(localStepStrength * STEP_ROCKY_TINT_MAX, 0, STEP_ROCKY_TINT_MAX);
        color = [
          riverbedColor[0] * (1 - rockyStepBlend) + rockyColor[0] * rockyStepBlend,
          riverbedColor[1] * (1 - rockyStepBlend) + rockyColor[1] * rockyStepBlend,
          riverbedColor[2] * (1 - rockyStepBlend) + rockyColor[2] * rockyStepBlend
        ];
      }
      const height = heightAtSample(col, row);
      const baseNoise = noiseAt(idx + 1);
      const fineNoise = (noiseAt(idx * 3.7 + 17.7) - 0.5) * 0.04;
      const heightTone = clamp(0.88 + height * 0.08, 0.72, 1.05);
      const noise = (baseNoise - 0.5) * 0.08;
      const heightLeft = heightAtSample(col - 1, row);
      const heightRight = heightAtSample(col + 1, row);
      const heightUp = heightAtSample(col, row - 1);
      const heightDown = heightAtSample(col, row + 1);
      const dx = (heightRight - heightLeft) * heightScale;
      const dz = (heightDown - heightUp) * heightScale;
      const nx = -dx;
      const ny = 2;
      const nz = -dz;
      const nLen = Math.hypot(nx, ny, nz) || 1;
      const light =
        (nx / nLen) * SUN_DIR.x + (ny / nLen) * SUN_DIR.y + (nz / nLen) * SUN_DIR.z;
      const shade = clamp(0.68 + light * 0.32, 0.55, 1);
      const slope = Math.sqrt(dx * dx + dz * dz);
      const occlusion = clamp(1 - slope * 0.06, 0.7, 1);
      const ashToneBoost = !debugTypeColors && typeId === ashId ? 1.18 : 1;
      const tone = heightTone * shade * occlusion * ashToneBoost;
      const rawR = color[0];
      const rawG = color[1];
      const rawB = color[2];
      const r = clamp((debugTypeColors ? rawR : (rawR + noise) * tone + fineNoise), 0, 1) * 255;
      const g = clamp((debugTypeColors ? rawG : (rawG + noise) * tone + fineNoise), 0, 1) * 255;
      const b = clamp((debugTypeColors ? rawB : (rawB + noise) * tone + fineNoise), 0, 1) * 255;
      const alpha =
        !debugTypeColors && localOceanRatio >= WATER_ALPHA_MIN_RATIO
          ? 0
          : 255;
      data[offset] = Math.round(r);
      data[offset + 1] = Math.round(g);
      data[offset + 2] = Math.round(b);
      data[offset + 3] = alpha;
      offset += 4;
    }
  }
  const texture = new THREE.DataTexture(data, sampleCols, sampleRows, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = true;
  texture.generateMipmaps = false;
  return texture;
};

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

export const getTerrainHeightScale = (cols: number, rows: number): number => {
  const baseScale = Math.max(HEIGHT_SCALE / TILE_SIZE, Math.min(cols, rows) * HEIGHT_MAP_RATIO);
  return baseScale * TERRAIN_HEIGHT_EXAGGERATION;
};

export const buildTerrainMesh = (
  sample: TerrainSample,
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
  const { cols, rows, elevations } = sample;
  const palette = buildPalette();
  const grassId = TILE_TYPE_IDS.grass;
  const scrubId = TILE_TYPE_IDS.scrub;
  const floodplainId = TILE_TYPE_IDS.floodplain;
  const forestId = TILE_TYPE_IDS.forest;
  const waterId = TILE_TYPE_IDS.water;
  const baseId = TILE_TYPE_IDS.base;
  const houseId = TILE_TYPE_IDS.house;
  const roadId = TILE_TYPE_IDS.road;
  const firebreakId = TILE_TYPE_IDS.firebreak;
  const ashId = TILE_TYPE_IDS.ash;
  const maxMapSpan = Math.max(cols, rows);
  const step = getTerrainStep(maxMapSpan, sample.fullResolution ?? false);
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
  const sampleCols = Math.floor((cols - 1) / step) + 1;
  const sampleRows = Math.floor((rows - 1) / step) + 1;
  const width = (sampleCols - 1) * step;
  const depth = (sampleRows - 1) * step;
  const sampleHeights = buildSampleHeightMap(sample, sampleCols, sampleRows, step, waterId);
  const oceanMask = sample.tileTypes ? buildOceanMask(cols, rows, sample.tileTypes, waterId) : null;
  const riverMask = sample.riverMask ?? null;
  const waterLevel = computeWaterLevel(sample, waterId, oceanMask, riverMask);
  const parcelTargetElev = sample.tileTypes ? new Float32Array(cols * rows).fill(Number.NaN) : null;
  let baseTargetElev: number | null = null;
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
        let isOcean = false;
        let isRiver = false;
        if (oceanMask) {
          for (let y = tileY; y < endY && !isOcean; y += 1) {
            const rowBase = y * cols;
            for (let x = tileX; x < endX; x += 1) {
              const idx = rowBase + x;
              if (riverMask && riverMask[idx]) {
                isRiver = true;
                break;
              }
              if (oceanMask[idx]) {
                isOcean = true;
                break;
              }
            }
          }
        }
        if ((!oceanMask || isOcean) && !isRiver) {
          sampleHeights[idx] = waterLevel;
        }
      }
    }
  }
  const waterRatios = buildSampleWaterRatios(sample, sampleCols, sampleRows, step, waterId, oceanMask, riverMask);
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
  const riverRenderDomain = buildRiverRenderDomain(sample, waterId);
  const sampledRiverCoverage = buildSampleMaskCoverage(
    sample,
    riverRenderDomain?.renderSupport ?? riverMask ?? undefined,
    sampleCols,
    sampleRows,
    step
  );
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
  const heightAtTile = (tileX: number, tileY: number): number => {
    return heightAtTileCoord(tileX + 0.5, tileY + 0.5);
  };

  const geometry = new THREE.PlaneGeometry(width, depth, sampleCols - 1, sampleRows - 1);
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  const heightScale = getTerrainHeightScale(cols, rows);
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
  const birchId = TREE_TYPE_IDS[TreeType.Birch];
  const pineId = TREE_TYPE_IDS[TreeType.Pine];
  const oakId = TREE_TYPE_IDS[TreeType.Oak];
  const mapleId = TREE_TYPE_IDS[TreeType.Maple];
  const elmId = TREE_TYPE_IDS[TreeType.Elm];
  const houseMask = sample.tileTypes
    ? (() => {
        const mask = new Uint8Array(cols * rows);
        const tiles = sample.tileTypes!;
        const elevations = sample.elevations;
        const applyFlatten = (bounds: { minX: number; maxX: number; minY: number; maxY: number }, targetElev: number) => {
          const minX = clamp(bounds.minX, 0, cols - 1);
          const maxX = clamp(bounds.maxX, 0, cols - 1);
          const minY = clamp(bounds.minY, 0, rows - 1);
          const maxY = clamp(bounds.maxY, 0, rows - 1);
          const startCol = clamp(Math.floor(minX / step), 0, sampleCols - 1);
          const endCol = clamp(Math.floor(maxX / step), 0, sampleCols - 1);
          const startRow = clamp(Math.floor(minY / step), 0, sampleRows - 1);
          const endRow = clamp(Math.floor(maxY / step), 0, sampleRows - 1);
          for (let row = startRow; row <= endRow; row += 1) {
            const rowBase = row * sampleCols;
            for (let col = startCol; col <= endCol; col += 1) {
              sampleHeights[rowBase + col] = targetElev;
            }
          }
        };
        const computeAverageElev = (bounds: { minX: number; maxX: number; minY: number; maxY: number }): number => {
          const minX = clamp(bounds.minX, 0, cols - 1);
          const maxX = clamp(bounds.maxX, 0, cols - 1);
          const minY = clamp(bounds.minY, 0, rows - 1);
          const maxY = clamp(bounds.maxY, 0, rows - 1);
          let sum = 0;
          let count = 0;
          for (let y = minY; y <= maxY; y += 1) {
            const rowBase = y * cols;
            for (let x = minX; x <= maxX; x += 1) {
              sum += elevations[rowBase + x] ?? 0;
              count += 1;
            }
          }
          if (count === 0) {
            return 0;
          }
          return clamp(sum / count, 0, 1);
        };

        let baseMinX = cols;
        let baseMaxX = -1;
        let baseMinY = rows;
        let baseMaxY = -1;
        let baseSum = 0;
        let baseCount = 0;

        for (let tileY = 0; tileY < rows; tileY += 1) {
          const rowBase = tileY * cols;
          for (let tileX = 0; tileX < cols; tileX += 1) {
            const idx = rowBase + tileX;
            const type = tiles[idx];
            if (type === baseId) {
              baseMinX = Math.min(baseMinX, tileX);
              baseMaxX = Math.max(baseMaxX, tileX);
              baseMinY = Math.min(baseMinY, tileY);
              baseMaxY = Math.max(baseMaxY, tileY);
              baseSum += elevations[idx] ?? 0;
              baseCount += 1;
              continue;
            }
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
            const targetElev = computeAverageElev(bounds);
            if (parcelTargetElev) {
              parcelTargetElev[idx] = targetElev;
            }
            applyFlatten(bounds, targetElev);
          }
        }

        if (baseCount > 0) {
          const bounds = { minX: baseMinX, maxX: baseMaxX, minY: baseMinY, maxY: baseMaxY };
          const targetElev = clamp(baseSum / baseCount, 0, 1);
          baseTargetElev = targetElev;
          applyFlatten(bounds, targetElev);
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
      let treeChance = 0;
      if (typeId === forestId) {
        treeChance = 0.85 * densityScale;
      } else if (typeId === scrubId) {
        treeChance = 0.18 * densityScale;
      } else if (typeId === floodplainId) {
        treeChance = 0.12 * densityScale;
      } else if (typeId === grassId) {
        treeChance = 0.08 * densityScale;
      }
      let placedTreeOnTile = false;
      if (treeChance > 0 && treeInstances.length < treeInstanceBudget) {
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
        const attempts = isForest ? Math.min(treeAttemptCap, 1 + Math.floor(noiseAt(idx + 11.7) * (1 + densityScale))) : 1;
        for (let attempt = 0; attempt < attempts; attempt += 1) {
          if (treeInstances.length >= treeInstanceBudget) {
            break;
          }
          if (noiseAt(idx + 5.1 + attempt * 0.37) >= treeChance) {
            continue;
          }
          const jitterRange = Math.max(0.1, step * 0.42);
          const jitterX = (noiseAt(idx + 0.27 + attempt * 0.31) - 0.5) * jitterRange;
          const jitterZ = (noiseAt(idx + 0.61 + attempt * 0.29) - 0.5) * jitterRange;
          const variantIndex =
            variants.length > 0 ? Math.floor(noiseAt(idx + 9.7 + attempt * 0.53) * variants.length) : 0;
          const variant = variants.length > 0 ? variants[variantIndex] ?? variants[0] : null;
          const targetHeight = baseScale * typeScale * TREE_HEIGHT_FACTOR;
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
        const placeholderChance = Math.min(0.68, SCRUB_PLACEHOLDER_BASE_CHANCE * densityScale);
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
            const targetHeight = baseScale * 0.75 * TREE_HEIGHT_FACTOR;
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
  applyRiverTerrainTriangleCutout(geometry, sampleCols, sampleRows, riverRenderDomain);
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
  const bridgeDeckMesh = buildBridgeDeckMesh(sample, width, depth, heightScale);
  if (bridgeDeckMesh) {
    mesh.add(bridgeDeckMesh);
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
          if (parcelTargetElev && Number.isFinite(parcelTargetElev[seed])) {
            const parcelElev = parcelTargetElev[seed] * heightScale;
            groundMin = parcelElev;
            groundMax = parcelElev;
          }
          houseSpots.push({
            x,
            y: height,
            z,
            footprintX: bounds.width,
            footprintZ: bounds.depth,
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
      if (baseTargetElev !== null) {
        const elev = baseTargetElev * heightScale;
        groundMin = elev;
        groundMax = elev;
      }
      const rotation = baseFootprintX >= baseFootprintZ ? 0 : Math.PI / 2;

      if (useDetailedStructures && firestationAsset && firestationAsset.meshes.length > 0) {
        const footprintTarget = Math.max(baseFootprintX, baseFootprintZ) * 0.85;
        const assetFootprint = Math.max(firestationAsset.size.x, firestationAsset.size.z);
        const scale = footprintTarget / Math.max(0.01, assetFootprint);
        const foundationTop = groundMax + 0.01;
        const baseY = foundationTop + firestationAsset.baseOffset * scale;
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
        mesh.add(baseGroup);
      } else {
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
          const fitScale = Math.min(footprintX / sizeX, footprintZ / sizeZ);
          const scale = Math.max(0.01, fitScale * 0.98);
          const baseY = foundationTop + variant.baseOffset * scale;
          const variantId = variantIds.get(variant) ?? 0;
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
  if (ENABLE_TOWN_LABEL_SPRITES && sample.towns && sample.towns.length > 0) {
    const townLabelGroup = new THREE.Group();
    sample.towns.forEach((town) => {
      if (typeof town.name !== "string" || town.name.trim().length === 0) {
        return;
      }
      if (!Number.isFinite(town.x) || !Number.isFinite(town.y)) {
        return;
      }
      const sprite = createTownLabelSprite(town, width, depth, cols, rows, heightScale, heightAtTile);
      if (!sprite) {
        return;
      }
      townLabelGroup.add(sprite);
    });
    if (townLabelGroup.children.length > 0) {
      mesh.add(townLabelGroup);
    }
  }

  let water: TerrainWaterData | undefined;
  const oceanLevel = computeWaterLevel(sample, waterId, oceanMask, riverMask);
  const ratios = waterRatios;
  const supportMask = buildWaterSupportMask(sampleTypes, waterId);
  let hasVisibleWater = false;
  for (let i = 0; i < supportMask.length; i += 1) {
    if (supportMask[i] > 0 || (ratios.water[i] ?? 0) > 0) {
      hasVisibleWater = true;
      break;
    }
  }
  if (hasVisibleWater) {
    const oceanSupportMask = new Uint8Array(sampleCols * sampleRows);
    const oceanRatios: WaterSampleRatios = {
      water: new Float32Array(sampleCols * sampleRows),
      ocean: new Float32Array(sampleCols * sampleRows),
      river: new Float32Array(sampleCols * sampleRows)
    };
    for (let i = 0; i < sampleCols * sampleRows; i += 1) {
      const ocean = clamp(ratios.ocean[i] ?? 0, 0, 1);
      oceanRatios.water[i] = ocean;
      oceanRatios.ocean[i] = ocean;
      oceanSupportMask[i] = ocean >= OCEAN_RATIO_MIN ? 1 : 0;
    }
    const zeroRiver = new Float32Array(sampleCols * sampleRows);
    const oceanMaskTexture = buildWaterMaskTexture(sampleCols, sampleRows, oceanRatios);
    const oceanSupportMap = buildWaterSupportMapTexture(sampleCols, sampleRows, oceanSupportMask);
    const oceanDomainMap = buildWaterDomainMapTexture(sampleCols, sampleRows, oceanRatios);
    const shoreSdf = buildShoreSdfTexture(sampleTypes, sampleCols, sampleRows, waterId);
    const normalizedOceanHeights = buildWaterSurfaceHeights(
      sampleHeights,
      oceanSupportMask,
      oceanRatios.ocean,
      zeroRiver,
      sampleCols,
      sampleRows,
      oceanLevel,
      undefined,
      undefined
    );
    const normalizedWaterHeights = buildWaterSurfaceHeights(
      sampleHeights,
      supportMask,
      ratios.ocean,
      ratios.river,
      sampleCols,
      sampleRows,
      oceanLevel,
      sampledRiverSurface,
      sampledRiverStepStrength
    );
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
      oceanRatios,
      undefined
    );
    let representativeLevel = oceanLevel;
    if (representativeLevel === null) {
      let oceanWeightedSum = 0;
      let oceanWeightedCount = 0;
      const fallbackWeightedValues: number[] = [];
      for (let i = 0; i < normalizedOceanHeights.length; i += 1) {
        const waterRatio = oceanRatios.water[i] ?? 0;
        if (waterRatio < WATER_ALPHA_MIN_RATIO) {
          continue;
        }
        const h = clamp(normalizedOceanHeights[i] ?? 0, 0, 1);
        const oceanWeight = clamp(oceanRatios.ocean[i] ?? 0, 0, 1);
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
      if (ratio < WATER_ALPHA_MIN_RATIO) {
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
    const waterfallInstances = buildWaterfallInstances(
      waterHeights,
      supportMask,
      ratios.ocean,
      sampleCols,
      sampleRows,
      ratios.river,
      sampledRiverStepStrength,
      waterfallMinDrop,
      width,
      depth,
      riverRenderDomain
    );
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
      waterfallInstances
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
