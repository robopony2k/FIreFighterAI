import type {
  FireAnchorSource,
  FireAudioClusterSnapshot,
  FireFxTerrainSize,
  FireFxTerrainSurface,
  FireFxTreeBurnController,
  FireFxTreeFlameProfile,
  FireFxWorldState,
  ResolvedFireAnchor
} from "./fireFxTypes.js";
import type { FireFieldView } from "./fireRenderSnapshot.js";

export type FrontDirection = 0 | 1 | 2 | 3;
export type FrontEdgeOrientation = "horizontal" | "vertical";
export type ClusterRole = 0 | 1 | 2;

export type DirectedFrontEdgeState = {
  key: number;
  sourceTileIdx: number;
  destTileIdx: number;
  sourceTileX: number;
  sourceTileY: number;
  destTileX: number;
  destTileY: number;
  dir: FrontDirection;
  normalX: number;
  normalZ: number;
  tangentX: number;
  tangentZ: number;
  orientation: FrontEdgeOrientation;
  fixedCoord: number;
  alongCoord: number;
  edgeCenterX: number;
  edgeCenterY: number;
  edgeCenterZ: number;
  normalY: number;
  dominantSource: FireAnchorSource;
  presence01: number;
  advance01: number;
  sourceDrive01: number;
  destIgnition01: number;
  passed01: number;
  lastActiveFrame: number;
};

export type FrontCorridor = {
  dir: FrontDirection;
  orientation: FrontEdgeOrientation;
  fixedCoord: number;
  startCoord: number;
  endCoord: number;
  states: DirectedFrontEdgeState[];
  dominantSource: FireAnchorSource;
  presence01: number;
  advance01: number;
  sourceDrive01: number;
  destIgnition01: number;
  passed01: number;
};

export type FrontCorridorSlotState = {
  activation: number;
  lastActiveFrame: number;
};

export type FireRenderContinuityState = {
  smoothedFrontSegmentBudget: number;
  smoothedPerTileFlameCap: number;
  smoothedPerTileGroundCap: number;
  localSlotChurn: number;
  objectSlotChurn: number;
  frontSlotChurn: number;
  budgetClampedDrops: number;
};

export type FireCluster = {
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
  anchorSource: FireAnchorSource;
  frontPerimeter01: number;
  frontArrival01: number;
  heatMean01: number;
  heatSum01: number;
  fuelMean01: number;
  intensity01: number;
  tiles: number[];
};

export type FireRenderAnalysisState = {
  tileStateCols: number;
  tileStateRows: number;
  tileFlameVisual: Float32Array;
  tileIgnitionAgeSeconds: Float32Array;
  tileSmokeVisual: Float32Array;
  tileLocalFlameSlotActivation: Float32Array;
  tileGroundFlameSlotActivation: Float32Array;
  tileObjectFlameSlotActivation: Float32Array;
  tileFrontPerimeter01: Float32Array;
  tileFrontArrival01: Float32Array;
  tileFrontAdvance01: Float32Array;
  tileFrontDirX: Float32Array;
  tileFrontDirZ: Float32Array;
  tileActiveFlag: Uint8Array;
  tileClusterId: Int32Array;
  tileClusterRole: Uint8Array;
  tileSmokeOcclusion01: Float32Array;
  clusterQueue: Int32Array;
  fireClusterPool: FireCluster[];
  fireClusters: FireCluster[];
  lastClusterRebuildMs: number;
  lastClusterActiveTileCount: number;
  lastClusterSampleStep: number;
  lastClusterMinX: number;
  lastClusterMaxX: number;
  lastClusterMinY: number;
  lastClusterMaxY: number;
  frontUpdateSerial: number;
  frontEdgeStates: Map<number, DirectedFrontEdgeState>;
  frontCorridorSlotStates: Map<number, FrontCorridorSlotState>;
  renderContinuityState: FireRenderContinuityState;
};

export type FireClusterBudgetState = {
  clusteredTiles: number;
  clusterCoverage: number;
  reserveBed: number;
  reservePlume: number;
  reserveTileJets: number;
};

export type FireRenderBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
  area: number;
  trackedFireTiles: number;
};

export type FireRenderTimingContext = {
  frameTimeMs: number;
  frameDeltaSeconds: number;
  deltaSeconds: number;
  smokeDeltaSeconds: number;
  animationTimeMs: number;
  smokeAnimationTimeMs: number;
  flameTimeSeconds: number;
  sparkTimeSeconds: number;
  fireShaderTime: number;
};

export type FireRenderWindContext = {
  windX: number;
  windZ: number;
  windStrength: number;
  crossWindX: number;
  crossWindZ: number;
  windNormX: number;
  windNormZ: number;
  windDirLen: number;
  windLeanX: number;
  windLeanZ: number;
  windResponse: {
    flame: number;
    spark: number;
    smoke: number;
    smokeUpwind: number;
  };
};

export type FireRenderCameraContext = {
  cameraWorldPos: { x: number; y: number; z: number };
  cameraForward: { x: number; y: number; z: number };
  topView01: number;
  zoomScale: number;
  viewportHeightPx: number;
};

export type FireRenderVisualContext = {
  isRenderPaused: boolean;
  overloaded: boolean;
  emergencyOverload: boolean;
  wallBlend: number;
  flameIntensityBoost: number;
  groundGlowBoost: number;
  emberBoost: number;
  flameHeightBoost: number;
  flameWidthBoost: number;
  groundGlowSizeBoost: number;
  groundGlowCountBoost: number;
  emberEjectBoost: number;
  sparkDebug: boolean;
  sparkMode: "tip" | "mixed" | "embers";
  showFrontPass: boolean;
  showClusterFlames: boolean;
  showSmoke: boolean;
  showSparks: boolean;
  showGroundGlow: boolean;
  useTipStreaks: boolean;
  useFreeEmbers: boolean;
  freeEmberModeScale: number;
  flameBudgetBaseScale: number;
  smokeBudgetScale: number;
  flameBudgetScale: number;
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
};

export type FireRenderEnvironmentContext = {
  envOrange: number;
  heightScale: number;
  simFireEps: number;
  flamePresenceEps: number;
  tileSpanX: number;
  tileSpanZ: number;
  tileSpan: number;
  sampleFootprint: number;
  sparkFootprint: number;
  terrainMinX: number;
  terrainMaxX: number;
  terrainMinZ: number;
  terrainMaxZ: number;
};

export type FireRenderFramePlan = {
  world: FireFxWorldState;
  fireView: FireFieldView;
  bounds: FireRenderBounds;
  terrainSize: FireFxTerrainSize;
  terrainSurface: FireFxTerrainSurface | null;
  treeBurn: FireFxTreeBurnController | null;
  timing: FireRenderTimingContext;
  wind: FireRenderWindContext;
  camera: FireRenderCameraContext;
  visual: FireRenderVisualContext;
  environment: FireRenderEnvironmentContext;
  state: FireRenderAnalysisState;
  resolveGroundAnchor: (tileIdx: number) => ResolvedFireAnchor;
  resolveObjectAnchor: (tileIdx: number) => ResolvedFireAnchor;
  activeFlameTileCount: number;
  visualActiveWeight: number;
  visibleFlameTiles: number;
  clusterCount: number;
  clusteredTiles: number;
  frontFrameId: number;
  frontPassActive: boolean;
  frontSegmentBudget: number;
  frontFieldReadScale: number;
  perTileCrossCap: number;
  sliceComplexityScale: number;
  kernelBudgetScale: number;
  frontCorridors: FrontCorridor[];
  audioClusters: FireAudioClusterSnapshot[];
};

export type FireTileVisualPlan = {
  tileIndex: number;
  tileX: number;
  tileY: number;
  fire: number;
  heat: number;
  fuel: number;
  wetness: number;
  typeId: number;
  isAshTile: boolean;
  flameProfile: FireFxTreeFlameProfile | null;
};
