import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CAREER_YEARS, TILE_SIZE, TOWN_ALERT_MAX_POSTURE, getTimeSpeedOptions } from "../core/config.js";
import { VIRTUAL_CLIMATE_PARAMS } from "../core/climate.js";
import type { EffectsState } from "../core/effectsState.js";
import {
  formatTimeSpeedValue,
  getResolvedTimeSpeedValue,
  isSimulationEffectivelyPaused,
  stepTimeSpeedSliderValue,
  TIME_SPEED_SLIDER_MAX,
  TIME_SPEED_SLIDER_MIN,
  TIME_SPEED_SLIDER_STEP
} from "../core/timeSpeed.js";
import { getHouseFootprintBounds, pickHouseFootprint } from "../core/houseFootprints.js";
import { findBestRoadReferenceForPlot, pickHouseRotationFromRoadMask } from "../core/roadAlignment.js";
import { getBuildingLifecycleStageFromId, getBuildingLifecycleStageId } from "../systems/settlements/sim/buildingLifecycle.js";
import { createConstructionFxRuntime } from "../systems/settlements/rendering/constructionFxRuntime.js";
import { getProceduralHouseVariantKey } from "../systems/settlements/rendering/proceduralHouseBuilder.js";
import {
  createProceduralWaterTowerModel,
  WATER_TOWER_BASE_WIDTH_TILES,
  WATER_TOWER_FOOTING_SIZE_TILES
} from "../systems/settlements/rendering/proceduralWaterTowerModel.js";
import type { RenderBuildingLot } from "../systems/settlements/types/buildingTypes.js";
import { createProceduralWatchTowerModel } from "../systems/fire/rendering/proceduralWatchTowerModel.js";
import { getWatchTowerForTown, quoteWatchTowerPlacement } from "../systems/fire/sim/fireDetection.js";
import { getWatchTowerLegOffsets, WATCH_TOWER_GRID_ROTATION_RADIANS } from "../systems/fire/types/watchTowerFootprint.js";
import { createFormationProjectionLayer } from "../systems/units/rendering/formationProjectionLayer.js";
import { createFormationTarget } from "../systems/units/sim/formationProjection.js";
import { buildEvacuationRenderModel } from "../systems/evacuation/rendering/evacuationRenderModel.js";
import { generateWorldClimateSeed } from "../systems/climate/sim/worldClimateSeed.js";
import type { SeasonalRainState } from "../systems/climate/types/seasonalRain.js";
import { resolveSeasonalRainScreenWind } from "../systems/climate/rendering/seasonalRainOverlayPass.js";
import { buildTerrainWindOverlaySamples } from "../systems/fire/rendering/terrainWindOverlay.js";
import {
  TerrainShadowBlendController,
  type TerrainShadowLightSlot
} from "../systems/terrain/rendering/terrainShadowBlendController.js";
import {
  finalizeInstancedMeshBounds,
  partitionTerrainInstances
} from "../systems/terrain/rendering/terrainRenderChunks.js";
import { createVehicleModelLayer, type VehicleModelInstance } from "./vehicleModelLayer.js";
import type { InputState } from "../core/inputState.js";
import { indexFor } from "../core/grid.js";
import { TILE_ID_TO_TYPE, TILE_TYPE_IDS } from "../core/state.js";
import type { ClimateForecast, CommandFireTask, CommandPlacementMode, CommandUnitAlert, CommandUnitStatus, Town } from "../core/types.js";
import type { RenderSim } from "./simView.js";
import { createHudState, setHudViewport, type HudTheme } from "./hud/hudState.js";
import { handleHudClick, handleHudKey, renderHud } from "./hud/hud.js";
import { buildEnvironmentPalette, computeFireLoad01 } from "./environmentPalette.js";
import { buildLightingDirectorState, type LightingDirectorInput, type LightingDirectorState } from "./lightingDirector.js";
import { createSeasonalSkyDome } from "./seasonalSky.js";
import { sampleSeasonalWeatherVisualState } from "../systems/climate/rendering/seasonalWeatherVisualState.js";
import {
  getMinimapModeLabel,
  MINIMAP_MODE_CAPABILITIES,
  type MinimapMode
} from "../ui/runtime/minimap/minimapModes.js";
import { createFacilityPanel, renderFacilityPanel, type FacilityPanelElements } from "../ui/runtime/town-panel/facilityPanel.js";
import { collectTownFacilities } from "../ui/runtime/town-panel/facilityRegistry.js";
import {
  createTownFacilitiesSection,
  renderTownFacilitiesSection,
  type TownFacilitiesSectionElements
} from "../ui/runtime/town-panel/townFacilitiesSection.js";
import type { SelectedTownFacility, TownFacilityDescriptor, TownFacilityTabId } from "../ui/runtime/town-panel/types.js";
import { hasProgressionCapability } from "../systems/progression/sim/techTree.js";
import {
  DEFAULT_THERMAL_PALETTE,
  buildThermalBackdropField,
  paintMinimapRaster
} from "../ui/runtime/minimap/minimapRaster.js";
import { canvasUiFont } from "../ui/typography.js";
import {
  getFirestationAssetCache,
  getHouseAssetsCache,
  getTreeAssetsCache,
  loadFirestationAsset,
  loadHouseAssets,
  loadTreeAssets,
  type FirestationAsset,
  type HouseAssets,
  type TreeAssets
} from "./threeTestAssets.js";
import {
  getTownBurningHouseCount,
  getTownPostureLabel,
  getTownThreatLabel,
  getTownThreatLevel
} from "../sim/towns.js";
import { isAdvanceToNextEventAvailable } from "../sim/index.js";
import { isHeadquartersTown, resolveHeadquartersTownId } from "../systems/units/index.js";
import {
  applyTerrainSurfaceColors,
  buildPalette,
  buildRoadOverlayTexture,
  buildTerrainMesh,
  buildTileTexture,
  getRoadAtlasVersion,
  getTerrainRoadVisualSignature,
  getTerrainHeightScale,
  getTerrainStep,
  prepareTerrainRenderSurface,
  prepareTerrainRenderVisualSurface,
  refreshTerrainScorchedGroundMaterial,
  refreshTerrainRoadVisuals,
  ROAD_SURFACE_WIDTH,
  ROAD_TEX_SCALE,
  setRoadOverlayMaxSize,
  type TerrainRenderSurface,
  type TreeSeasonVisualConfig,
  type TreeBurnController,
  type TerrainSample,
  type TerrainWaterData,
  type WaterfallDebugData,
  WATERFALL_DEBUG_FLAG_BEST_DROP_OK,
  WATERFALL_DEBUG_FLAG_CANDIDATE,
  WATERFALL_DEBUG_FLAG_EMITTED,
  WATERFALL_DEBUG_FLAG_LOCAL_DROP_OK,
  WATERFALL_DEBUG_FLAG_OCEANISH,
  WATERFALL_DEBUG_FLAG_RIVER,
  WATERFALL_DEBUG_FLAG_STEP_OK,
  WATERFALL_VERTICALITY_MIN,
  WATERFALL_DEBUG_FLAG_WATER
} from "./threeTestTerrain.js";
import { setTerrainRoadHighContrast } from "./terrain/roads/roadHighContrast.js";
import { createThreeTestFireFx, type FireFxDebugSnapshot } from "./threeTestFireFx.js";
import { createThreeTestWorldAudio, type WorldAudioChannelControls } from "./threeTestWorldAudio.js";
import { createThreeTestUnitFxLayer } from "./threeTestUnitFx.js";
import type { TerrainWaterDebugControls } from "./terrainWaterDebug.js";
import { ThreeTestWaterSystem, type WaterQualityProfile } from "./threeTestWater.js";
import { resolveOceanSurfaceContext } from "./water/ocean/oceanSurfaceContext.js";
import { createThreeTestUnitsLayer } from "./threeTestUnits.js";
import { createThreeTestPostPipeline, type DepthOfFieldSettings } from "./post/dofPipeline.js";
import type { ThreeTestCinematicGradeConfig } from "./post/cinematicGradePass.js";
import { getRequiredWebGLContext } from "./webglContext.js";
import { resolveStructureGrounding } from "./terrain/shared/structureGrounding.js";
import {
  assignTerrainTextureMap,
  disposeQueuedTerrainTextures,
  flushTerrainTextureDisposals,
  queueTerrainTextureDisposals,
  type PendingTerrainTextureDisposal
} from "../systems/terrain/rendering/terrainTextureSwap.js";
import { setInlandWaterSeamDebugMaterialMode } from "../systems/terrain/rendering/inlandWaterSeamDebugMaterial.js";
import { findNearestInlandWaterTerrainSeamSegment } from "../systems/terrain/rendering/inlandWaterTerrainSeam.js";
import { CardStateModel } from "../ui/cards/cardState.js";
import { resolveTownLabelDepthAwareLayout } from "../ui/town-labels/townLabelOcclusion.js";
import { createUnitCommandTray } from "../ui/unit-control/UnitCommandTray.js";
import { dispatchPhaseUiCommand } from "../ui/phase/commandChannel.js";
import {
  RISK_THRESHOLDS,
  SEASON_LABELS,
  computeForecastPeriodLayout,
  computeSeasonLayout
} from "../ui/phase/forecastLayout.js";
import {
  AUDIO_CONTROL_CHANNELS,
  SIMULATION_TOGGLE_SPECS,
  TIME_CONTROL_ACTIONS,
  getRuntimeWidgetTitle,
  getTimeSpeedAction
} from "../ui/runtime/widgets/registry.js";
import { getThreeDockCardSpec } from "../ui/runtime/widgets/threeDock.js";
import type { AudioChannelId, RuntimeWidgetId } from "../ui/runtime/widgets/types.js";
import type { UiAudioController } from "../audio/uiAudio.js";
import { getRuntimeSettings, setRuntimeSetting, subscribeRuntimeSettings } from "../persistence/runtimeSettings.js";
import { constrainCameraToTerrain } from "../systems/terrain/rendering/terrainCameraConstraints.js";
import { WebGlGpuTimer } from "../core/rendering/webglGpuTimer.js";

export type SeasonVisualState = {
  seasonT01: number;
  risk01: number;
  mode: "auto" | "manual";
  manualSeasonT01?: number;
};

type EnvironmentSignalState = {
  seasonT01: number;
  risk01: number;
  fireLoad01: number;
};

export type ThreeTestPerfSnapshot = {
  frameMs: number;
  frameLastMs: number;
  controlsMs: number;
  treeBurnMs: number;
  fireFxMs: number;
  fireFxDebug: FireFxDebugSnapshot | null;
  sceneRenderMs: number;
  sceneRenderLastMs: number;
  postMs: number;
  dofMs: number;
  hudMs: number;
  uiRenderMs: number;
  gpuWorldMs: number | null;
  gpuShadowRefreshMs: number | null;
  gpuPostMs: number | null;
  gpuUiMs: number | null;
  activeShadowLights: number;
  shadowRefreshCount: number;
  terrainChunkCount: number;
  terrainVisibleChunkCount: number;
  terrainCulledInstanceCount: number;
  roadOverlayTriangles: number;
  roadOverlaySourceTriangles: number;
  postPassCount: number;
  vehicleBufferUploads: number;
  fps: number;
  rafGapMs: number;
  rafGapLastMs: number;
  rafGapMaxMs: number;
  hitchCount: number;
  lastHitchMs: number;
  terrainSetMs: number;
  terrainSetLastMs: number;
  terrainSetMaxMs: number;
  terrainSetCount: number;
  terrainSetFastReuseCount: number;
  terrainSetFullRebuildCount: number;
  terrainSetFullRebuildReason: string;
  terrainSetIntent: string;
  terrainSetPath: string;
  terrainSetDominantStep: string;
  terrainSetMaxDominantStep: string;
  terrainSetMaxIntent: string;
  terrainSetMaxPath: string;
  terrainGeometrySignature: string;
  terrainGeometrySignatureChanged: boolean;
  terrainSetPrepareMs: number;
  terrainSetPrepareLastMs: number;
  terrainSetStaticPrepareMs: number;
  terrainSetStaticPrepareLastMs: number;
  terrainSetStaticPrepareCount: number;
  terrainSetVisualPrepareMs: number;
  terrainSetVisualPrepareLastMs: number;
  terrainSetVisualPrepareCount: number;
  terrainSetPrepareSkippedCount: number;
  terrainSetReuseCheckMs: number;
  terrainSetReuseCheckLastMs: number;
  terrainSetColorMs: number;
  terrainSetColorLastMs: number;
  terrainSetTextureMs: number;
  terrainSetTextureLastMs: number;
  terrainSetTextureSwapMs: number;
  terrainSetTextureSwapLastMs: number;
  terrainSetRoadSignatureMs: number;
  terrainSetRoadSignatureLastMs: number;
  terrainSetStructureMs: number;
  terrainSetStructureLastMs: number;
  terrainSetFullDisposeMs: number;
  terrainSetFullDisposeLastMs: number;
  terrainSetFullBuildMs: number;
  terrainSetFullBuildLastMs: number;
  terrainSetWaterMs: number;
  terrainSetWaterLastMs: number;
  terrainRoadRefreshMs: number;
  terrainRoadRefreshLastMs: number;
  terrainRoadRefreshCount: number;
  sceneCalls: number;
  sceneTriangles: number;
  sceneLines: number;
  scenePoints: number;
  totalCalls: number;
  memoryGeometries: number;
  memoryTextures: number;
  contextLosses: number;
  contextRestores: number;
  waterfallCount: number;
  waterfallCandidateCount: number;
  waterfallClusterCount: number;
  waterfallEmittedCount: number;
  waterfallRejectedVerticalCount: number;
  waterfallRejectedLongRunCount: number;
  waterfallWallQuadCount: number;
  waterfallWallTriangleCount: number;
  waterfallWallQuadBreakdown: string;
  environmentFogEnabled: boolean;
  waterfallDebugHighlightEnabled: boolean;
  waterfallAnchorErrorMean: number;
  waterfallAnchorErrorMax: number;
  waterfallWallTopGapMean: number;
  waterfallWallTopGapMax: number;
};

export type ThreeTestTerrainUpdateIntent = {
  label: string;
  geometry?: boolean;
  surfaceColor?: boolean;
  vegetation?: boolean;
  roads?: boolean;
  structure?: boolean;
  debug?: boolean;
  fireVisual?: boolean;
  dirtyTileBounds?: {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  };
};

type NormalizedThreeTestTerrainUpdateIntent = Omit<Required<ThreeTestTerrainUpdateIntent>, "dirtyTileBounds"> & {
  dirtyTileBounds?: ThreeTestTerrainUpdateIntent["dirtyTileBounds"];
};

export type ThreeTestPanToTileOptions = {
  transition?: "snap" | "contextual";
};

export type ThreeTestController = {
  start: () => void;
  stop: () => void;
  resize: () => void;
  prime: () => void;
  captureFireSnapshot: (world: RenderSim) => void;
  setSimulationAlpha: (alpha: number) => void;
  isCameraInteracting: () => boolean;
  setTerrain: (sample: TerrainSample, intent?: ThreeTestTerrainUpdateIntent) => void;
  setSeasonVisualState: (state: SeasonVisualState) => void;
  setSeason: (index: number) => void;
  setClimateDryness: (value: number) => void;
  setSeasonalRainState: (state: SeasonalRainState | null) => void;
  setPhaseLabel: (text: string) => void;
  setSeasonLabel: (text: string) => void;
  setClimateForecast: (
    forecast: ClimateForecast | null,
    day: number,
    startDay: number,
    yearDays: number,
    meta: string | null
  ) => void;
  setBaseCardOpen: (open: boolean) => void;
  panToTile: (tileX: number, tileY: number, options?: ThreeTestPanToTileOptions) => void;
  setEnvironmentFogEnabled: (enabled: boolean) => void;
  getEnvironmentFogEnabled: () => boolean;
  setRoadHighContrastEnabled: (enabled: boolean) => void;
  getRoadHighContrastEnabled: () => boolean;
  setTerrainWaterDebugControls: (controls: Partial<TerrainWaterDebugControls>) => void;
  getTerrainWaterDebugControls: () => TerrainWaterDebugControls;
  getPerfSnapshot: () => ThreeTestPerfSnapshot;
};

type TerrainClimateUniforms = {
  uRisk01: { value: number };
  uSeasonT01: { value: number };
  uWorldSeed: { value: number };
};

type HudAudioChannelSettings = {
  muted: boolean;
  volume: number;
};

type HudAudioChannelControls = {
  getSettings: () => HudAudioChannelSettings;
  toggleMuted: () => void;
  setVolume: (value: number) => void;
  onChange: (listener: (settings: HudAudioChannelSettings) => void) => () => void;
};

type ThreeTestRenderFlags = {
  cinematicGrade: boolean;
  dof: boolean;
};

type ThreeTestRenderState = {
  flags: ThreeTestRenderFlags;
};

type ThreeTestCinematicLookConfig = ThreeTestCinematicGradeConfig & {
  exposure: number;
  fogDensity: number;
  fogStartDistance: number;
  fogRampDistance: number;
  fireFlameIntensityBoost: number;
  fireGlowBoost: number;
  emberBoost: number;
};

let threeTestInitCount = 0;
let activeThreeTestCleanup: (() => void) | null = null;
const HUD_REDRAW_INTERVAL_MS = 120;
const DOM_DOCK_REDRAW_INTERVAL_MS = 120;
const ADAPTIVE_DPR_FALLBACK_FPS = 55;
const ADAPTIVE_DPR_RECOVERY_FPS = 60;
const ADAPTIVE_DPR_FALLBACK_SCENE_MS = 13.2;
const ADAPTIVE_DPR_RECOVERY_SCENE_MS = 9.4;
const ADAPTIVE_DPR_FALLBACK_SECONDS = 1.1;
const ADAPTIVE_DPR_RECOVERY_SECONDS = 7.5;
const ADAPTIVE_DPR_STEP_DOWN = 0.2;
const ADAPTIVE_DPR_STEP_UP = 0.1;
const FRAME_CAP_TOLERANCE_MS = 0.75;
const STATIC_FRAME_HEARTBEAT_MS = 250;
const THREE_TEST_ENV_FOG_ENABLED = true;
const THREE_TEST_SHADOW_VIEW_PADDING = 1.08;
const THREE_TEST_SHADOW_HEIGHT_PADDING = 1.28;
const THREE_TEST_SHADOW_MIN_EXTENT = 12;
const THREE_TEST_SHADOW_MAX_TERRAIN_RATIO = 0.45;
const THREE_TEST_SHADOW_EXTENT_EPSILON = 0.35;
const THREE_TEST_SHADOW_FAR_EPSILON = 1;
const THREE_TEST_SHADOW_DIRECTION_STEP_DEG = 0.65;
const THREE_TEST_SHADOW_BLEND_DURATION_MS = 760;
const THREE_TEST_SHADOW_MINIMUM_STEADY_HOLD_MS = 1_200;
const THREE_TEST_SHADOW_LIGHT_SHARE = 0.72;
const THREE_TEST_LEGACY_EXPOSURE = 1.05;
const THREE_TEST_CINEMATIC_GRADE_CONFIG: ThreeTestCinematicLookConfig = {
  exposure: 0.94,
  fogColor: 0x2f3238,
  fogDensity: 0.0065,
  fogStartDistance: 40,
  fogRampDistance: 52,
  heightHazeStrength: 0.07,
  heightHazeHorizon: 0.7,
  heightHazeCurve: 2.1,
  contrast: 1.08,
  midtoneDesaturation: 0.12,
  vignetteStrength: 0.2,
  vignetteSoftness: 0.72,
  warmHighlightStrength: 0.06,
  fireFlameIntensityBoost: 1.22,
  fireGlowBoost: 1.36,
  emberBoost: 1.42
};
const GROUND_PHASE_SHIFT_MAX = 0.06;
const TREE_PHASE_SHIFT_MAX = 0.08;
const TREE_RATE_JITTER = 0.1;
const AUTUMN_HUE_JITTER = 0.18;
const SEASON_VISUAL_EPSILON = 0.0005;
const LEGACY_INDEX_TO_SEASON_T = [0.25, 0.5, 0.75, 0] as const;
const PERF_HITCH_THRESHOLD_MS = 45;
const CAMERA_INTERACTION_HOLD_MS = 450;
const HOVER_PICK_INTERVAL_MS = 90;
const FORMATION_DRAG_THRESHOLD_PX = 6;
const FORMATION_HOLD_THRESHOLD_MS = 180;
const TOWN_LABEL_LIFT_METERS = 100;
const TOWN_LABEL_UPDATE_INTERVAL_MS = 120;
const TOWN_LABEL_SCREEN_OFFSET_Y = -24;
const TOWN_LABEL_CONNECTOR_ORIGIN_X = 12;
const TOWN_LABEL_MAX_Z_INDEX = 20000;
const TOWN_LABEL_OCCLUSION_MAX_LIFT_METERS = 420;
const TOWN_LABEL_OCCLUSION_VERTICAL_CLEARANCE = 2.5;
const TOWN_LABEL_OCCLUSION_LABEL_CLEARANCE = 3.5;
const TOWN_LABEL_CONNECTOR_CLEARANCE = 0.8;
const TOWN_LABEL_OCCLUSION_SAMPLE_COUNT = 36;
const SQUAD_MARKER_LIFT_METERS = 122;
const SQUAD_MARKER_SCREEN_OFFSET_Y = -20;
const SQUAD_MARKER_STACK_OFFSET_PX = 24;
const SQUAD_MARKER_CLUSTER_X_PX = 150;
const SQUAD_MARKER_CLUSTER_Y_PX = 54;
const SQUAD_MARKER_DISPERSED_RADIUS_TILES = 7;
const SQUAD_MARKER_SMOOTHING_ALPHA = 0.22;
const BASE_LABEL_LIFT_METERS = 115;
const BASE_LABEL_SCREEN_OFFSET_Y = -22;
const BASE_LABEL_CONNECTOR_ORIGIN_X = 12;
const HOVER_DEBUG_LABEL_LIFT_METERS = 88;
const HOVER_DEBUG_LABEL_SCREEN_OFFSET_Y = -18;
const HOVER_DEBUG_LABEL_CONNECTOR_ORIGIN_X = 16;
const HOVER_DEBUG_PANEL_GAP_X = 28;
const HOVER_DEBUG_PANEL_GAP_Y = 20;
const HOVER_DEBUG_TILE_SAFE_RADIUS_PX = 34;
const HOVER_DEBUG_TILE_BORDER_INSET = 0.08;
const HOVER_DEBUG_TILE_BORDER_LIFT = 0.05;
const HOVER_DEBUG_TILE_WATCH_COLOR = 0xffd447;
const HOVER_DEBUG_TILE_HIGH_COLOR = 0xff9738;
const HOVER_DEBUG_TILE_CRITICAL_COLOR = 0xd13232;
const MINIMAP_REDRAW_INTERVAL_MS = 140;
const SATELLITE_MINIMAP_MAX_SIZE = 256;
const SATELLITE_MINIMAP_REFRESH_DAYS = 3;
type ThreeTestMinimapMode = MinimapMode | "satellite";
const THREE_TEST_MINIMAP_MODES: readonly ThreeTestMinimapMode[] = [
  "terrain",
  "satellite",
  "topographic",
  "moisture",
  "thermal"
];
const getThreeTestMinimapModeLabel = (mode: ThreeTestMinimapMode): string =>
  mode === "satellite" ? "Satellite" : getMinimapModeLabel(mode);
const UNIT_TRAY_UPDATE_INTERVAL_MS = 90;
const UNIT_COMMAND_PATH_LIFT = 0.07;
const UNIT_COMMAND_MARKER_LIFT = 0.1;
const UNIT_COMMAND_MARKER_RADIUS = 0.06;
const SCORE_FLOW_PULSE_POOL_SIZE = 18;
const SCORE_FLOW_PULSE_DURATION_MS = 1050;
const SCORE_FLOW_PULSE_LIFT = 0.05;
const EVACUATION_CAR_MODEL_PATH = "assets/3d/GLTF/Vehicles/CAR_01.glb";
const EVACUATION_CAR_TARGET_LENGTH = 0.38;
const EVACUATION_CAR_YAW_OFFSET = 0;
const EVACUATION_CAR_GROUND_OFFSET = -0.015;
const EVACUATION_CAR_NORMAL_SAMPLE_TILES = 0.22;
const EVACUATION_CAR_COLORS = [
  0xd9ded8,
  0x7e8d98,
  0xb84d45,
  0x3f6f8e,
  0xd6b35f,
  0x5e6b5d
] as const;
const TERRAIN_CAMERA_MIN_POLAR_ANGLE = THREE.MathUtils.degToRad(8);
const TERRAIN_CAMERA_MAX_POLAR_ANGLE = THREE.MathUtils.degToRad(78);
const TERRAIN_CAMERA_TARGET_GROUND_CLEARANCE = 0.04;
const TERRAIN_CAMERA_BODY_GROUND_CLEARANCE = 0.35;
const EVACUATION_CAR_ACCENT_COLORS = [
  0xf2efe6,
  0x9ec5d6,
  0xf0a15d,
  0x89a85b,
  0xc57b95,
  0x5c8fd6
] as const;
const EVACUATION_CAR_DESTROYED_COLOR = 0x161616;
const EVACUATION_CAR_DESTROYED_ACCENT_COLOR = 0x2b2b2b;
const CLIMATE_RISK_LABELS = ["Low", "Moderate", "High", "Extreme"] as const;
const CLIMATE_TEMP_DOMAIN_MIN = Math.floor(
  VIRTUAL_CLIMATE_PARAMS.tMid - VIRTUAL_CLIMATE_PARAMS.tAmp - VIRTUAL_CLIMATE_PARAMS.noiseAmp
);
const CLIMATE_TEMP_DOMAIN_MAX = Math.ceil(
  VIRTUAL_CLIMATE_PARAMS.tMid +
    VIRTUAL_CLIMATE_PARAMS.tAmp +
    VIRTUAL_CLIMATE_PARAMS.noiseAmp +
    8 +
    VIRTUAL_CLIMATE_PARAMS.warmingPerYear * Math.max(0, CAREER_YEARS - 1)
);

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const mixChannel = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRgb = (
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  t: number
): { r: number; g: number; b: number } => ({
  r: Math.round(mixChannel(a.r, b.r, t)),
  g: Math.round(mixChannel(a.g, b.g, t)),
  b: Math.round(mixChannel(a.b, b.b, t))
});
const getDisplayedTimeSpeedIndices = (options: readonly number[]): number[] => {
  const last = Math.max(0, options.length - 1);
  return [...new Set([0, Math.min(1, last), Math.min(2, last), last])];
};
const wrap01 = (value: number): number => {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};
const formatDebugNumber = (value: number, digits = 2): string =>
  Number.isFinite(value) ? value.toFixed(digits) : "n/a";
const lerpWrapped01 = (current: number, target: number, alpha: number): number => {
  const c = wrap01(current);
  const t = wrap01(target);
  let delta = t - c;
  if (delta > 0.5) {
    delta -= 1;
  } else if (delta < -0.5) {
    delta += 1;
  }
  return wrap01(c + delta * alpha);
};
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
const rgbToHex = (color: { r: number; g: number; b: number }): number =>
  (Math.round(color.r) << 16) | (Math.round(color.g) << 8) | Math.round(color.b);
const cloneHudTheme = (theme: HudTheme): HudTheme => ({
  ...theme,
  chartBandColors: [...theme.chartBandColors] as [string, string, string, string],
  chartSeasonColors: [...theme.chartSeasonColors] as [string, string, string, string],
  thermalLow: { ...theme.thermalLow },
  thermalMid: { ...theme.thermalMid },
  thermalHigh: { ...theme.thermalHigh }
});

export const createThreeTest = (
  canvas: HTMLCanvasElement,
  world: RenderSim,
  inputState: InputState,
  effectsState: EffectsState | null = null,
  uiAudio: UiAudioController | null = null,
  musicControls: HudAudioChannelControls | null = null,
  worldAudioControls: WorldAudioChannelControls | null = null
): ThreeTestController => {
  threeTestInitCount += 1;
  if (threeTestInitCount > 1) {
    console.warn("[threeTest] HUD initialized more than once; previous instance will be torn down.");
  }
  if (activeThreeTestCleanup) {
    activeThreeTestCleanup();
    activeThreeTestCleanup = null;
  }
  const runtimeSettings = getRuntimeSettings();
  const ENABLE_THREE_TEST_SEASONAL_RECOLOR = runtimeSettings.seasonal;
  const THREE_TEST_HUD_MODE = runtimeSettings.hud;
  const THREE_TEST_DISABLE_HUD = runtimeSettings.nohud || THREE_TEST_HUD_MODE !== "canvas";
  const THREE_TEST_DISABLE_FX = runtimeSettings.nofx;
  const THREE_TEST_MAX_DPR = Math.max(0.5, Math.min(4, runtimeSettings.dpr));
  const THREE_TEST_ADAPTIVE_DPR_ENABLED = runtimeSettings.autodpr;
  const THREE_TEST_MIN_DPR = Math.max(0.5, Math.min(THREE_TEST_MAX_DPR, runtimeSettings.mindpr));
  const THREE_TEST_FRAME_CAP_FPS = Math.max(30, Math.min(120, runtimeSettings.fps > 0 ? runtimeSettings.fps : 60));
  const THREE_TEST_FRAME_MIN_MS = 1000 / THREE_TEST_FRAME_CAP_FPS;
  const THREE_TEST_DEFAULT_WATER_QUALITY: WaterQualityProfile = runtimeSettings.waterq;
  const THREE_TEST_RIVER_VIEW = runtimeSettings.rivercam;
  const THREE_TEST_RIVER_VIEW_LOCK = runtimeSettings.rivercamlock;
  const THREE_TEST_SHADOWS_ENABLED = runtimeSettings.shadows;
  const THREE_TEST_DETAILED_STRUCTURES_ENABLED = runtimeSettings.detailedstructures;
  const THREE_TEST_FIRE_WALL_BLEND = Math.max(0, Math.min(1, runtimeSettings.firewall));
  const THREE_TEST_FIRE_HERO_VOL = Math.max(0, Math.min(1, runtimeSettings.firevol));
  const THREE_TEST_FIRE_BUDGET_SCALE = Math.max(0.4, Math.min(1.25, runtimeSettings.fxbudget));
  const THREE_TEST_FX_FALLBACK = runtimeSettings.fxfallback;
  const THREE_TEST_SPARK_DEBUG = runtimeSettings.sparkdebug;
  const THREE_TEST_SHADOW_MAP_SIZE = Math.max(
    512,
    Math.min(4096, 2 ** Math.round(Math.log2(Math.max(1, runtimeSettings.shadowres))))
  );
  const THREE_TEST_CINEMATIC_GRADE_ENABLED = runtimeSettings.cinematic;
  const THREE_TEST_DOF_ENABLED = runtimeSettings.dof;
  const THREE_TEST_DOF_FOCUS_PARAM = runtimeSettings.doffocus;
  const THREE_TEST_DOF_FOCUS_MODE: DepthOfFieldSettings["focusMode"] = THREE_TEST_DOF_FOCUS_PARAM === null ? "target" : "manual";
  const THREE_TEST_DOF_FOCUS_RANGE = Math.max(4, Math.min(120, runtimeSettings.dofrange));
  const THREE_TEST_DOF_APERTURE = Math.max(0, Math.min(1.5, runtimeSettings.dofaperture));
  const THREE_TEST_DOF_MAX_BLUR_RADIUS = Math.max(1, Math.min(18, runtimeSettings.dofradius));
  const THREE_TEST_DOF_BASE_BLUR_SCALE = Math.max(0.25, Math.min(0.5, runtimeSettings.dofscale));
  const THREE_TEST_DOF_NEAR_ENABLED = runtimeSettings.dofnear;
  const render: ThreeTestRenderState = {
    flags: {
      cinematicGrade: THREE_TEST_CINEMATIC_GRADE_ENABLED,
      dof: THREE_TEST_DOF_ENABLED
    }
  };
  let cinematicGradeEnabled = render.flags.cinematicGrade;
  let dofEnabled = render.flags.dof;
  const webglContext = getRequiredWebGLContext(canvas, "3D mode");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context: webglContext,
    antialias: true,
    alpha: false,
    powerPreference: "default"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio ?? 1, THREE_TEST_MAX_DPR));
  renderer.setClearColor(0x0c0d11, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = cinematicGradeEnabled
    ? THREE_TEST_CINEMATIC_GRADE_CONFIG.exposure
    : THREE_TEST_LEGACY_EXPOSURE;
  renderer.shadowMap.enabled = THREE_TEST_SHADOWS_ENABLED;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = !ENABLE_THREE_TEST_SEASONAL_RECOLOR;
  renderer.autoClear = false;
  renderer.info.autoReset = false;
  const gpuTimer = new WebGlGpuTimer(webglContext);
  setRoadOverlayMaxSize(renderer.capabilities.maxTextureSize || 4096);

  const scene = new THREE.Scene();
  const uiScene = new THREE.Scene();
  const horizonColor = cinematicGradeEnabled ? 0x2a2019 : 0xffdab9;
  const zenithColor = cinematicGradeEnabled ? 0x1a212c : 0x87ceeb;
  scene.background = null;
  const seasonalSky = createSeasonalSkyDome();
  scene.add(seasonalSky.mesh);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(2.6, 2.2, 3.4);
  camera.lookAt(0, 0, 0);
  const uiCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  uiCamera.position.set(0, 0, 5);
  const cinematicFog = new THREE.Fog(
    THREE_TEST_CINEMATIC_GRADE_CONFIG.fogColor,
    THREE_TEST_CINEMATIC_GRADE_CONFIG.fogStartDistance,
    THREE_TEST_CINEMATIC_GRADE_CONFIG.fogStartDistance + THREE_TEST_CINEMATIC_GRADE_CONFIG.fogRampDistance
  );
  let environmentFogEnabled = THREE_TEST_ENV_FOG_ENABLED;
  const applyCinematicLook = (enabled: boolean): void => {
    renderer.toneMappingExposure = enabled
      ? THREE_TEST_CINEMATIC_GRADE_CONFIG.exposure
      : THREE_TEST_LEGACY_EXPOSURE;
    scene.fog = environmentFogEnabled ? cinematicFog : null;
  };
  applyCinematicLook(cinematicGradeEnabled);

  const hemisphere = new THREE.HemisphereLight(zenithColor, 0x4d433b, 0.65);
  scene.add(hemisphere);
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffe6c2, 0.95);
  keyLight.position.set(4, 5, 2);
  keyLight.castShadow = false;
  scene.add(keyLight);
  const createShadowBlendLight = (): THREE.DirectionalLight => {
    const light = new THREE.DirectionalLight(0xffe6c2, 0);
    light.castShadow = THREE_TEST_SHADOWS_ENABLED;
    light.shadow.mapSize.width = THREE_TEST_SHADOW_MAP_SIZE;
    light.shadow.mapSize.height = THREE_TEST_SHADOW_MAP_SIZE;
    light.shadow.bias = -0.00035;
    light.shadow.normalBias = 0.02;
    light.shadow.intensity = 1;
    light.shadow.autoUpdate = false;
    return light;
  };
  const previousShadowLight = createShadowBlendLight();
  const nextShadowLight = createShadowBlendLight();
  scene.add(previousShadowLight);
  scene.add(nextShadowLight);
  const fillLight = new THREE.DirectionalLight(0x88a9c9, 0.35);
  fillLight.position.set(-4, 2.5, -2);
  scene.add(fillLight);
  scene.add(keyLight.target);
  scene.add(previousShadowLight.target);
  scene.add(nextShadowLight.target);
  scene.add(fillLight.target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.screenSpacePanning = false;
  controls.minPolarAngle = TERRAIN_CAMERA_MIN_POLAR_ANGLE;
  controls.maxPolarAngle = TERRAIN_CAMERA_MAX_POLAR_ANGLE;
  controls.minDistance = 3;
  controls.maxDistance = 120;
  controls.target.set(0, 0, 0);
  const dofSettings: DepthOfFieldSettings = {
    enabled: dofEnabled,
    focusMode: THREE_TEST_DOF_FOCUS_MODE,
    focusDistance: Math.max(0.001, camera.position.distanceTo(controls.target)),
    manualFocusDistance: THREE_TEST_DOF_FOCUS_PARAM !== null
      ? Math.max(camera.near, THREE_TEST_DOF_FOCUS_PARAM)
      : Math.max(0.001, camera.position.distanceTo(controls.target)),
    focusRange: THREE_TEST_DOF_FOCUS_RANGE,
    aperture: THREE_TEST_DOF_APERTURE,
    maxBlurRadius: THREE_TEST_DOF_MAX_BLUR_RADIUS,
    blurScale: THREE_TEST_DOF_BASE_BLUR_SCALE,
    nearBlurEnabled: THREE_TEST_DOF_NEAR_ENABLED
  };
  let postPipeline: ReturnType<typeof createThreeTestPostPipeline> | null = null;
  try {
    postPipeline = createThreeTestPostPipeline({
      renderer,
      camera,
      gradeConfig: {
        contrast: THREE_TEST_CINEMATIC_GRADE_CONFIG.contrast,
        midtoneDesaturation: THREE_TEST_CINEMATIC_GRADE_CONFIG.midtoneDesaturation,
        vignetteStrength: THREE_TEST_CINEMATIC_GRADE_CONFIG.vignetteStrength,
        vignetteSoftness: THREE_TEST_CINEMATIC_GRADE_CONFIG.vignetteSoftness,
        warmHighlightStrength: THREE_TEST_CINEMATIC_GRADE_CONFIG.warmHighlightStrength,
        heightHazeStrength: environmentFogEnabled ? THREE_TEST_CINEMATIC_GRADE_CONFIG.heightHazeStrength : 0,
        heightHazeHorizon: THREE_TEST_CINEMATIC_GRADE_CONFIG.heightHazeHorizon,
        heightHazeCurve: THREE_TEST_CINEMATIC_GRADE_CONFIG.heightHazeCurve,
        fogColor: THREE_TEST_CINEMATIC_GRADE_CONFIG.fogColor
      },
      dofSettings,
      gradeEnabled: cinematicGradeEnabled,
      gpuTimer
    });
  } catch (error) {
    cinematicGradeEnabled = false;
    dofEnabled = false;
    render.flags.cinematicGrade = false;
    render.flags.dof = false;
    console.warn("[threeTest] Post pipeline setup failed; using direct scene rendering.", error);
    applyCinematicLook(false);
  }
  type CameraFlightState = {
    startedAt: number;
    durationMs: number;
    startTarget: THREE.Vector3;
    startPosition: THREE.Vector3;
    endTarget: THREE.Vector3;
    endPosition: THREE.Vector3;
    arcLift: number;
  };
  let cameraFlight: CameraFlightState | null = null;
  let lastCameraMotionAt = 0;
  const markCameraMotion = (): void => {
    lastCameraMotionAt = performance.now();
  };
  const cancelCameraFlight = (): void => {
    cameraFlight = null;
  };
  const handleControlsStart = (): void => {
    cancelCameraFlight();
    markCameraMotion();
  };
  controls.addEventListener("start", handleControlsStart);
  controls.addEventListener("change", markCameraMotion);
  controls.addEventListener("end", markCameraMotion);

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xd34b2a, roughness: 0.55, metalness: 0.2 })
  );
  cube.castShadow = true;
  scene.add(cube);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(6, 6),
    new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.9;
  ground.receiveShadow = true;
  scene.add(ground);

  const fireFx = createThreeTestFireFx(scene, camera, {
    wallBlend: THREE_TEST_FIRE_WALL_BLEND,
    heroVolumetricShare: THREE_TEST_FIRE_HERO_VOL,
    budgetScale: THREE_TEST_FIRE_BUDGET_SCALE,
    fallbackMode: THREE_TEST_FX_FALLBACK,
    showSparks: false,
    flameIntensityBoost: cinematicGradeEnabled ? THREE_TEST_CINEMATIC_GRADE_CONFIG.fireFlameIntensityBoost : 1,
    groundGlowBoost: cinematicGradeEnabled ? THREE_TEST_CINEMATIC_GRADE_CONFIG.fireGlowBoost : 1,
    emberBoost: cinematicGradeEnabled ? THREE_TEST_CINEMATIC_GRADE_CONFIG.emberBoost : 1,
    sparkDebug: THREE_TEST_SPARK_DEBUG
  });
  const worldAudio = worldAudioControls ? createThreeTestWorldAudio(camera, worldAudioControls) : null;
  const constructionFx = createConstructionFxRuntime(scene, camera, worldAudioControls);
  fireFx.captureSnapshot(world);
  const unitsLayer = createThreeTestUnitsLayer(scene);
  const unitFxLayer = createThreeTestUnitFxLayer(scene);
  const formationProjectionLayer = createFormationProjectionLayer();
  scene.add(formationProjectionLayer.group);
  type UnitCommandVisual = {
    line: THREE.Line;
    destination: THREE.Mesh;
  };
  type ScoreFlowPulse = {
    mesh: THREE.Mesh;
    material: THREE.MeshBasicMaterial;
    startAt: number;
    endAt: number;
    baseScale: number;
  };
  const unitCommandVisualGroup = new THREE.Group();
  unitCommandVisualGroup.name = "three-test-unit-commands";
  scene.add(unitCommandVisualGroup);
  const evacuationVisualGroup = new THREE.Group();
  evacuationVisualGroup.name = "three-test-evacuations";
  scene.add(evacuationVisualGroup);
  const evacuationVehicleLayer = createVehicleModelLayer(scene, {
    name: "three-test-evacuation-car",
    modelPath: EVACUATION_CAR_MODEL_PATH,
    maxInstances: 512,
    targetLength: EVACUATION_CAR_TARGET_LENGTH,
    yawOffset: EVACUATION_CAR_YAW_OFFSET,
    modelGroundOffset: EVACUATION_CAR_GROUND_OFFSET,
    tintMaterialPatterns: [/basic color/i, /window/i],
    fallbackLift: 0.22,
    normalSampleTiles: EVACUATION_CAR_NORMAL_SAMPLE_TILES,
    fallbackGeometry: new THREE.BoxGeometry(0.22, 0.11, 0.34),
    fallbackMaterial: new THREE.MeshStandardMaterial({
      color: 0x4f9fff,
      roughness: 0.62,
      metalness: 0.12,
      vertexColors: true
    })
  });
  const scoreFlowPulseGroup = new THREE.Group();
  scoreFlowPulseGroup.name = "three-test-score-flow-pulses";
  scene.add(scoreFlowPulseGroup);
  const hoverDebugTileHighlightPositions = new Float32Array(8 * 3);
  const hoverDebugTileHighlightGeometry = new THREE.BufferGeometry();
  hoverDebugTileHighlightGeometry.setAttribute(
    "position",
    new THREE.BufferAttribute(hoverDebugTileHighlightPositions, 3)
  );
  hoverDebugTileHighlightGeometry.setIndex([
    0, 1, 5,
    0, 5, 4,
    1, 2, 6,
    1, 6, 5,
    2, 3, 7,
    2, 7, 6,
    3, 0, 4,
    3, 4, 7
  ]);
  const hoverDebugTileHighlightMaterial = new THREE.MeshBasicMaterial({
    color: 0x99d6ff,
    transparent: true,
    opacity: 0.88,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false
  });
  hoverDebugTileHighlightMaterial.toneMapped = false;
  const hoverDebugTileHighlight = new THREE.Mesh(
    hoverDebugTileHighlightGeometry,
    hoverDebugTileHighlightMaterial
  );
  hoverDebugTileHighlight.name = "three-test-hover-debug-tile";
  hoverDebugTileHighlight.visible = false;
  hoverDebugTileHighlight.frustumCulled = false;
  hoverDebugTileHighlight.renderOrder = 4;
  scene.add(hoverDebugTileHighlight);
  const unitCommandPathMaterial = new THREE.LineBasicMaterial({
    color: 0xb8e6ff,
    transparent: true,
    opacity: 0.92,
    depthWrite: false
  });
  const unitCommandMarkerGeometry = new THREE.SphereGeometry(UNIT_COMMAND_MARKER_RADIUS, 10, 10);
  const scoreFlowPulseGeometry = new THREE.RingGeometry(0.34, 0.5, 32);
  const unitCommandMarkerMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff0b8,
    emissive: 0x5b4b17,
    emissiveIntensity: 0.8,
    roughness: 0.45,
    metalness: 0.05
  });
  const unitCommandVisuals = new Map<number, UnitCommandVisual>();
  const scoreFlowPulses: ScoreFlowPulse[] = [];
  let lastConsumedScoreFlowEventId = 0;
  for (let i = 0; i < SCORE_FLOW_PULSE_POOL_SIZE; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffa357,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(scoreFlowPulseGeometry, material);
    mesh.rotation.x = -Math.PI * 0.5;
    mesh.visible = false;
    mesh.frustumCulled = false;
    mesh.renderOrder = 7;
    scoreFlowPulseGroup.add(mesh);
    scoreFlowPulses.push({
      mesh,
      material,
      startAt: Number.NEGATIVE_INFINITY,
      endAt: Number.NEGATIVE_INFINITY,
      baseScale: 1
    });
  }

  const hudState = createHudState();
  const hudCanvas = document.createElement("canvas");
  const hudCtx = hudCanvas.getContext("2d");
  if (!hudCtx) {
    throw new Error("Canvas not supported");
  }
  const createHudTexture = (canvasElement: HTMLCanvasElement): THREE.CanvasTexture => {
    const texture = new THREE.CanvasTexture(canvasElement);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
  };

  let hudTexture = createHudTexture(hudCanvas);
  const hudMaterial = new THREE.SpriteMaterial({ map: hudTexture, transparent: true });
  hudMaterial.toneMapped = false;
  hudMaterial.depthTest = false;
  hudMaterial.depthWrite = false;
  const hudSprite = new THREE.Sprite(hudMaterial);
  hudSprite.center.set(0, 1);
  uiScene.add(hudSprite);

  const townOverlayRoot = document.createElement("div");
  townOverlayRoot.className = "three-test-town-overlay hidden";
  canvas.parentElement?.appendChild(townOverlayRoot);
  const squadMarkerOverlayRoot = document.createElement("div");
  squadMarkerOverlayRoot.className = "three-test-squad-marker-overlay hidden";
  canvas.parentElement?.appendChild(squadMarkerOverlayRoot);

  const cardState = new CardStateModel();
  const worldCardState = new CardStateModel();
  const dockCardState = new CardStateModel();
  const baseCardId = "base:main";

  const dockOverlayRoot = document.createElement("div");
  dockOverlayRoot.className = "three-test-dock-overlay hidden";
  canvas.parentElement?.appendChild(dockOverlayRoot);

  const unitTrayRoot = document.createElement("div");
  unitTrayRoot.className = "three-test-unit-tray hidden";
  canvas.parentElement?.appendChild(unitTrayRoot);
  const sparkDebugOverlay = document.createElement("div");
  sparkDebugOverlay.className = THREE_TEST_SPARK_DEBUG
    ? "three-test-spark-debug"
    : "three-test-spark-debug hidden";
  sparkDebugOverlay.textContent = "Sparks: waiting for fire fx...";
  canvas.parentElement?.appendChild(sparkDebugOverlay);
  let sparkDebugLastUiAt = -Infinity;
  let sparkDebugLastLogAt = -Infinity;
  const hoverDebugRoot = document.createElement("div");
  hoverDebugRoot.className = "three-test-debug-nameplate hidden";
  const hoverDebugConnector = document.createElement("div");
  hoverDebugConnector.className = "three-test-town-connector three-test-debug-connector";
  const hoverDebugHeader = document.createElement("div");
  hoverDebugHeader.className = "three-test-debug-nameplate-header";
  const hoverDebugTitle = document.createElement("div");
  hoverDebugTitle.className = "three-test-debug-title";
  const hoverDebugBadge = document.createElement("span");
  hoverDebugBadge.className = "three-test-debug-badge";
  hoverDebugHeader.append(hoverDebugTitle, hoverDebugBadge);
  const hoverDebugMeta = document.createElement("div");
  hoverDebugMeta.className = "three-test-debug-meta";
  const hoverDebugDetails = document.createElement("div");
  hoverDebugDetails.className = "three-test-debug-details";
  hoverDebugRoot.append(hoverDebugHeader, hoverDebugMeta, hoverDebugDetails);
  townOverlayRoot.append(hoverDebugRoot, hoverDebugConnector);

  const TOWN_ICON_HOUSES = "H";
  const TOWN_ICON_BURNING = "F";
  const TOWN_ICON_LOST = "X";
  const TOWN_ICON_APPROVAL = "AP";
  const TOWN_ICON_EVAC = "EV";
  const TOWN_ICON_COOLDOWN = "CD";
  const TOWN_ICON_WARNING = "AL";
  const TOWN_ICON_WARN_UP = "UP";
  const TOWN_ICON_WARN_DOWN = "DN";
  const TOWN_ICON_CLEAR_TREES = "CLR";
  const TOWN_ICON_UPGRADE = "UPG";
  const TOWN_ICON_COST = "$";
  const TOWN_ICON_TIME = "T";
  const CARD_PIN_ICON = "📍";
  const CARD_PINNED_ICON = "📌";
  const CARD_FOCUS_ICON = "👁";
  const TOWN_LABEL_HOVER_DELAY_MS = 150;
  const TOWN_CLEAR_TREES_COST_DEFAULT = 120;
  const TOWN_CLEAR_TREES_DAYS_DEFAULT = 2;
  const TOWN_UPGRADE_EQUIP_COST_DEFAULT = 180;
  const TOWN_UPGRADE_EQUIP_DAYS_DEFAULT = 3;
  const playUiCue = (cue: "hover" | "click" | "toggle" | "confirm"): void => {
    uiAudio?.play(cue);
  };
  let removeUiAudioChangeListener: (() => void) | null = null;
  let removeMusicControlsChangeListener: (() => void) | null = null;
  let removeWorldAudioChangeListener: (() => void) | null = null;
  let removeRuntimeSettingsChangeListener: (() => void) | null = null;
  type HoverDebugTone = "default" | "watch" | "high" | "critical";
  type HoverDebugSection = {
    key: string;
    label: string;
    lines: string[];
    tone?: HoverDebugTone;
  };
  type HoverDebugContext = {
    tileX: number;
    tileY: number;
    tileIndex: number;
    hoverGrid: { x: number; y: number } | null;
    sample: TerrainSample;
    terrainWater: TerrainWaterData | null;
    heightScale: number;
  };
  type HoverDebugSectionBuilder = (context: HoverDebugContext) => HoverDebugSection | null;

  type TownLabelElements = {
    root: HTMLDivElement;
    connector: HTMLDivElement;
    mainButton: HTMLButtonElement;
    dot: HTMLSpanElement;
    name: HTMLSpanElement;
    hqBadge: HTMLSpanElement;
    meta: HTMLDivElement;
    metaText: HTMLSpanElement;
    metaAlert: HTMLSpanElement;
  };
  type SquadMarkerElements = {
    root: HTMLButtonElement;
    connector: HTMLDivElement;
    icon: HTMLSpanElement;
    name: HTMLSpanElement;
    meta: HTMLSpanElement;
    status: HTMLSpanElement;
  };
  type TownCardElements = {
    root: HTMLDivElement;
    pinButton: HTMLButtonElement;
    focusButton: HTMLButtonElement;
    closeButton: HTMLButtonElement;
    topLine: HTMLDivElement;
    dot: HTMLSpanElement;
    name: HTMLSpanElement;
    hqBadge: HTMLSpanElement;
    postureChip: HTMLSpanElement;
    approvalChip: HTMLSpanElement;
    cooldownChip: HTMLSpanElement;
    summary: HTMLDivElement;
    summaryText: HTMLSpanElement;
    summaryAlert: HTMLSpanElement;
    evac: HTMLDivElement;
    selectEvacDestinationButton: HTMLButtonElement;
    selectEvacDestinationMeta: HTMLSpanElement;
    issueEvacuationButton: HTMLButtonElement;
    issueEvacuationMeta: HTMLSpanElement;
    returnEvacuationButton: HTMLButtonElement;
    returnEvacuationMeta: HTMLSpanElement;
    cancelEvacuationButton: HTMLButtonElement;
    cancelEvacuationMeta: HTMLSpanElement;
    upgradeButton: HTMLButtonElement;
    upgradeMeta: HTMLSpanElement;
    facilitiesSection: TownFacilitiesSectionElements;
  };
  type TownScreenAnchor = {
    rootX: number;
    rootY: number;
    rootWidth: number;
    rootHeight: number;
    zIndex: number;
  };
  type TownUiSnapshot = {
    threatLevel: ReturnType<typeof getTownThreatLevel>;
    threatLabel: string;
    threatClass: string;
    posture: number;
    postureLabel: string;
    cooldown: number;
    houses: number;
    burning: number;
    lost: number;
    approvalPct: number;
    nonApproving: number;
    evacState: Town["evacState"];
    evacPct: number;
    evacuationStatus: Town["evacuationStatus"];
    populationRemaining: number;
    populationEvacuating: number;
    populationEvacuated: number;
    populationDead: number;
    vehiclesQueued: number;
    vehiclesMoving: number;
    vehiclesDestroyed: number;
    hasSelectedEvacuationPoint: boolean;
    clearTreesCost: number;
    clearTreesDays: number;
    upgradeCost: number;
    upgradeDays: number;
  };
  type BaseCardElements = {
    root: HTMLDivElement;
    connector: HTMLDivElement;
    mainButton: HTMLButtonElement;
    summary: HTMLDivElement;
    cardRoot: HTMLDivElement;
    cardSummary: HTMLDivElement;
    recruitHint: HTMLDivElement;
    pinButton: HTMLButtonElement;
    focusButton: HTMLButtonElement;
    closeButton: HTMLButtonElement;
    recruitFirefighterButton: HTMLButtonElement;
    recruitTruckButton: HTMLButtonElement;
    trainSpeedButton: HTMLButtonElement;
    trainPowerButton: HTMLButtonElement;
    trainRangeButton: HTMLButtonElement;
    trainResilienceButton: HTMLButtonElement;
    deployTruckButton: HTMLButtonElement;
    deployFirefighterButton: HTMLButtonElement;
  };
  type FireAlertCardElements = {
    root: HTMLDivElement;
    summary: HTMLDivElement;
    details: HTMLDivElement;
    zoomButton: HTMLButtonElement;
    openTownButton: HTMLButtonElement;
    deployTruckButton: HTMLButtonElement;
    deployCrewButton: HTMLButtonElement;
    dismissButton: HTMLButtonElement;
  };
  type SquadMarkerLayoutEntry = {
    commandUnitId: number;
    anchorScreenX: number;
    anchorScreenY: number;
    baseRootY: number;
    rootWidth: number;
    rootHeight: number;
    zIndex: number;
    selected: boolean;
    distanceSq: number;
  };
  type SquadMarkerAnchor = {
    x: number;
    y: number;
  };

  const townLabelElements = new Map<number, TownLabelElements>();
  const squadMarkerElements = new Map<number, SquadMarkerElements>();
  const squadMarkerAnchors = new Map<number, SquadMarkerAnchor>();
  const townAnchors = new Map<number, TownScreenAnchor>();
  let baseAnchor: TownScreenAnchor | null = null;
  const pinnedTownCards = new Map<number, TownCardElements>();
  let selectedTownId: number | null = null;
  let selectedFacility: SelectedTownFacility | null = null;
  const activeFacilityTabs = new Map<string, TownFacilityTabId>();
  let focusedTownId: number | null = null;
  let baseFocused = false;
  let hoverTownId: number | null = null;
  let hoverPeekTownId: number | null = null;
  let hoverDelayHandle: number | null = null;
  let lastTownMetricsUpdateAt = -Infinity;
  let visibleFireAlertId: number | null = null;
  let dismissedFireAlertId: number | null = null;
  let activeFireAlertTownId: number | null = null;
  let activeFireAlertTile: { x: number; y: number } | null = null;

  const createTownCardAction = (
    iconText: string,
    tooltip: string,
    metaText = ""
  ): { button: HTMLButtonElement; meta: HTMLSpanElement } => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "three-test-town-card-action";
    button.title = tooltip;
    const icon = document.createElement("span");
    icon.className = "three-test-town-card-action-icon";
    icon.textContent = iconText;
    const meta = document.createElement("span");
    meta.className = "three-test-town-card-action-meta";
    meta.textContent = metaText;
    button.append(icon, meta);
    return { button, meta };
  };

  const applyPinButtonState = (button: HTMLButtonElement, pinned: boolean): void => {
    button.textContent = pinned ? CARD_PINNED_ICON : CARD_PIN_ICON;
    button.title = pinned ? "Unpin" : "Pin";
    button.setAttribute("aria-label", pinned ? "Unpin card" : "Pin card");
  };

  const createTownCardElements = (pinned = false): TownCardElements => {
    const townCardRoot = document.createElement("div");
    townCardRoot.className = `three-test-town-card hidden${pinned ? " is-pinned" : ""}`;
    const townCardHeader = document.createElement("div");
    townCardHeader.className = "three-test-town-card-header";
    const townCardTopLine = document.createElement("div");
    townCardTopLine.className = "three-test-town-nameplate-main three-test-town-card-top-line";
    const townCardNameDot = document.createElement("span");
    townCardNameDot.className = "three-test-town-dot is-low";
    townCardNameDot.title = "Fire threat";
    const townCardName = document.createElement("span");
    townCardName.className = "three-test-town-name";
    const townCardHqBadge = document.createElement("span");
    townCardHqBadge.className = "three-test-town-hq-badge hidden";
    townCardHqBadge.textContent = "HQ";
    townCardHqBadge.title = "Headquarters";
    townCardTopLine.append(townCardNameDot, townCardName, townCardHqBadge);
    const townCardHeaderActions = document.createElement("div");
    townCardHeaderActions.className = "three-test-town-card-header-actions";
    const townCardPinButton = document.createElement("button");
    townCardPinButton.type = "button";
    townCardPinButton.className = "three-test-town-card-pin";
    applyPinButtonState(townCardPinButton, pinned);
    const townCardFocusButton = document.createElement("button");
    townCardFocusButton.type = "button";
    townCardFocusButton.className = "three-test-town-card-focus";
    townCardFocusButton.textContent = CARD_FOCUS_ICON;
    townCardFocusButton.title = "Center and zoom camera";
    townCardFocusButton.setAttribute("aria-label", "Center and zoom camera");
    const townCardCloseButton = document.createElement("button");
    townCardCloseButton.type = "button";
    townCardCloseButton.className = "three-test-town-card-close";
    townCardCloseButton.textContent = "x";
    townCardHeaderActions.append(townCardPinButton, townCardFocusButton, townCardCloseButton);
    townCardHeader.append(townCardTopLine, townCardHeaderActions);
    const townCardStatus = document.createElement("div");
    townCardStatus.className = "three-test-town-card-status";
    const townCardPosture = document.createElement("span");
    townCardPosture.className = "three-test-town-card-chip posture-0";
    const townCardApproval = document.createElement("span");
    townCardApproval.className = "three-test-town-card-chip";
    const townCardCooldown = document.createElement("span");
    townCardCooldown.className = "three-test-town-card-chip hidden";
    townCardStatus.append(townCardPosture, townCardApproval, townCardCooldown);
    const townCardSummary = document.createElement("div");
    townCardSummary.className = "three-test-town-card-metrics three-test-town-summary-line";
    const townCardSummaryText = document.createElement("span");
    townCardSummaryText.className = "three-test-town-summary-text";
    const townCardSummaryAlert = document.createElement("span");
    townCardSummaryAlert.className = "three-test-town-alert-badge alert-0";
    townCardSummary.append(townCardSummaryText, townCardSummaryAlert);
    const townCardEvac = document.createElement("div");
    townCardEvac.className = "three-test-town-card-evac hidden";
    const townCardActions = document.createElement("div");
    townCardActions.className = "three-test-town-card-actions";
    const selectEvacAction = createTownCardAction(TOWN_ICON_EVAC, "Select evacuation destination");
    const issueEvacAction = createTownCardAction(TOWN_ICON_WARN_UP, "Issue evacuation");
    const returnEvacAction = createTownCardAction("R", "Return evacuees home");
    const cancelEvacAction = createTownCardAction("x", "Cancel evacuation selection");
    const upgradeAction = createTownCardAction(TOWN_ICON_UPGRADE, "Invest in firefighting equipment");
    townCardActions.append(
      selectEvacAction.button,
      issueEvacAction.button,
      returnEvacAction.button,
      cancelEvacAction.button,
      upgradeAction.button
    );
    const facilitiesSection = createTownFacilitiesSection();
    townCardRoot.append(townCardHeader, townCardSummary, townCardStatus, townCardEvac, townCardActions, facilitiesSection.root);
    townOverlayRoot.appendChild(townCardRoot);
    return {
      root: townCardRoot,
      pinButton: townCardPinButton,
      focusButton: townCardFocusButton,
      closeButton: townCardCloseButton,
      topLine: townCardTopLine,
      dot: townCardNameDot,
      name: townCardName,
      hqBadge: townCardHqBadge,
      postureChip: townCardPosture,
      approvalChip: townCardApproval,
      cooldownChip: townCardCooldown,
      summary: townCardSummary,
      summaryText: townCardSummaryText,
      summaryAlert: townCardSummaryAlert,
      evac: townCardEvac,
      selectEvacDestinationButton: selectEvacAction.button,
      selectEvacDestinationMeta: selectEvacAction.meta,
      issueEvacuationButton: issueEvacAction.button,
      issueEvacuationMeta: issueEvacAction.meta,
      returnEvacuationButton: returnEvacAction.button,
      returnEvacuationMeta: returnEvacAction.meta,
      cancelEvacuationButton: cancelEvacAction.button,
      cancelEvacuationMeta: cancelEvacAction.meta,
      upgradeButton: upgradeAction.button,
      upgradeMeta: upgradeAction.meta,
      facilitiesSection
    };
  };

  const townCardElements = createTownCardElements(false);
  const facilityPanelElements: FacilityPanelElements = createFacilityPanel();
  townOverlayRoot.appendChild(facilityPanelElements.root);
  const fireAlertCardRoot = document.createElement("div");
  fireAlertCardRoot.className = "three-test-town-card three-test-fire-alert-card hidden";
  const fireAlertHeader = document.createElement("div");
  fireAlertHeader.className = "three-test-town-card-header";
  const fireAlertTitle = document.createElement("div");
  fireAlertTitle.className = "three-test-town-nameplate-main";
  fireAlertTitle.innerHTML = `<span class="three-test-town-dot is-critical"></span><span class="three-test-town-name">Fire Alert</span>`;
  fireAlertHeader.appendChild(fireAlertTitle);
  const fireAlertSummary = document.createElement("div");
  fireAlertSummary.className = "three-test-town-card-metrics three-test-town-summary-line";
  const fireAlertDetails = document.createElement("div");
  fireAlertDetails.className = "three-test-fire-alert-details";
  const fireAlertActions = document.createElement("div");
  fireAlertActions.className = "three-test-town-card-actions";
  const createFireAlertAction = (label: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "three-test-town-card-action";
    button.textContent = label;
    return button;
  };
  const fireAlertZoomButton = createFireAlertAction("Zoom to Fire");
  const fireAlertOpenTownButton = createFireAlertAction("Open Town");
  const fireAlertDeployTruckButton = createFireAlertAction("Dispatch Squad");
  const fireAlertDeployCrewButton = createFireAlertAction("Open HQ");
  const fireAlertDismissButton = createFireAlertAction("Dismiss");
  fireAlertActions.append(
    fireAlertZoomButton,
    fireAlertOpenTownButton,
    fireAlertDeployTruckButton,
    fireAlertDeployCrewButton,
    fireAlertDismissButton
  );
  fireAlertCardRoot.append(fireAlertHeader, fireAlertSummary, fireAlertDetails, fireAlertActions);
  townOverlayRoot.appendChild(fireAlertCardRoot);
  const fireAlertCardElements: FireAlertCardElements = {
    root: fireAlertCardRoot,
    summary: fireAlertSummary,
    details: fireAlertDetails,
    zoomButton: fireAlertZoomButton,
    openTownButton: fireAlertOpenTownButton,
    deployTruckButton: fireAlertDeployTruckButton,
    deployCrewButton: fireAlertDeployCrewButton,
    dismissButton: fireAlertDismissButton
  };

  const baseLabelRoot = document.createElement("div");
  baseLabelRoot.className = "three-test-town-nameplate three-test-base-nameplate";
  const baseConnector = document.createElement("div");
  baseConnector.className = "three-test-town-connector three-test-base-connector";
  const baseMainButton = document.createElement("button");
  baseMainButton.type = "button";
  baseMainButton.className = "three-test-town-nameplate-main-btn";
  baseMainButton.innerHTML = `<div class="three-test-town-nameplate-main"><span class="three-test-town-dot is-watch"></span><span class="three-test-town-name">Base Ops</span></div>`;
  const baseSummary = document.createElement("div");
  baseSummary.className = "three-test-town-nameplate-meta";
  baseSummary.innerHTML = `<span class="three-test-town-summary-text">--</span>`;
  baseLabelRoot.append(baseMainButton, baseSummary);
  townOverlayRoot.append(baseLabelRoot, baseConnector);

  const baseCardRoot = document.createElement("div");
  baseCardRoot.className = "three-test-town-card three-test-base-card hidden";
  const baseCardHeader = document.createElement("div");
  baseCardHeader.className = "three-test-town-card-header";
  const baseCardTitle = document.createElement("div");
  baseCardTitle.className = "three-test-town-nameplate-main";
  baseCardTitle.innerHTML = `<span class="three-test-town-dot is-watch"></span><span class="three-test-town-name">Base Ops</span>`;
  const baseCardHeaderActions = document.createElement("div");
  baseCardHeaderActions.className = "three-test-town-card-header-actions";
  const baseCardPinButton = document.createElement("button");
  baseCardPinButton.type = "button";
  baseCardPinButton.className = "three-test-town-card-pin";
  applyPinButtonState(baseCardPinButton, false);
  const baseCardFocusButton = document.createElement("button");
  baseCardFocusButton.type = "button";
  baseCardFocusButton.className = "three-test-town-card-focus";
  baseCardFocusButton.textContent = CARD_FOCUS_ICON;
  baseCardFocusButton.title = "Center and zoom camera";
  baseCardFocusButton.setAttribute("aria-label", "Center and zoom camera");
  const baseCardCloseButton = document.createElement("button");
  baseCardCloseButton.type = "button";
  baseCardCloseButton.className = "three-test-town-card-close";
  baseCardCloseButton.textContent = "x";
  baseCardHeaderActions.append(baseCardPinButton, baseCardFocusButton, baseCardCloseButton);
  baseCardHeader.append(baseCardTitle, baseCardHeaderActions);
  const baseCardSummary = document.createElement("div");
  baseCardSummary.className = "three-test-town-card-metrics";
  const createBaseSection = (title: string): { root: HTMLDivElement; grid: HTMLDivElement } => {
    const root = document.createElement("div");
    root.className = "three-test-base-section";
    const heading = document.createElement("div");
    heading.className = "three-test-base-section-title";
    heading.textContent = title;
    const grid = document.createElement("div");
    grid.className = "three-test-town-card-actions";
    root.append(heading, grid);
    return { root, grid };
  };
  const createBaseActionButton = (label: string, action: string): HTMLButtonElement => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "three-test-town-card-action";
    button.dataset.action = action;
    button.textContent = label;
    return button;
  };
  const deploySection = createBaseSection("Deploy");
  const deployTruckButton = createBaseActionButton("Deploy Truck", "deploy-truck");
  const deployFirefighterButton = createBaseActionButton("Deploy Crew", "deploy-firefighter");
  deploySection.grid.append(deployTruckButton, deployFirefighterButton);
  const recruitSection = createBaseSection("Recruit");
  const recruitTruckButton = createBaseActionButton("Recruit Truck", "recruit-truck");
  const recruitFirefighterButton = createBaseActionButton("Recruit Crew", "recruit-firefighter");
  recruitSection.grid.append(recruitTruckButton, recruitFirefighterButton);
  const trainSection = createBaseSection("Train");
  const trainSpeedButton = createBaseActionButton("Speed", "train-speed");
  const trainPowerButton = createBaseActionButton("Power", "train-power");
  const trainRangeButton = createBaseActionButton("Range", "train-range");
  const trainResilienceButton = createBaseActionButton("Resilience", "train-resilience");
  trainSection.grid.append(trainSpeedButton, trainPowerButton, trainRangeButton, trainResilienceButton);
  const recruitHint = document.createElement("div");
  recruitHint.className = "three-test-base-hint";
  recruitHint.textContent = "Recruit and training are available in maintenance phase.";
  baseCardRoot.append(baseCardHeader, baseCardSummary, deploySection.root, recruitSection.root, trainSection.root, recruitHint);
  townOverlayRoot.appendChild(baseCardRoot);
  const baseCardElements: BaseCardElements = {
    root: baseLabelRoot,
    connector: baseConnector,
    mainButton: baseMainButton,
    summary: baseSummary,
    cardRoot: baseCardRoot,
    cardSummary: baseCardSummary,
    recruitHint,
    pinButton: baseCardPinButton,
    focusButton: baseCardFocusButton,
    closeButton: baseCardCloseButton,
    recruitFirefighterButton,
    recruitTruckButton,
    trainSpeedButton,
    trainPowerButton,
    trainRangeButton,
    trainResilienceButton,
    deployTruckButton,
    deployFirefighterButton
  };
  worldCardState.register(baseCardId);

  type DockCardElements = {
    id: string;
    root: HTMLDivElement;
    headerRow: HTMLDivElement;
    headerButton: HTMLButtonElement;
    indicatorChip: HTMLSpanElement;
    titleLabel: HTMLSpanElement;
    body: HTMLDivElement;
    summary: HTMLDivElement;
    details: HTMLDivElement;
    pinButton: HTMLButtonElement;
    closeButton: HTMLButtonElement;
    applyState: () => void;
  };

  const rightDockRoot = document.createElement("div");
  rightDockRoot.className = "three-test-right-dock";
  dockOverlayRoot.appendChild(rightDockRoot);
  const dockCards = new Map<string, DockCardElements>();

  const applyDockCardStates = (): void => {
    dockCards.forEach((card) => card.applyState());
  };

  const createDockCard = (id: string, title: string, indicator: string): DockCardElements => {
    dockCardState.register(id);
    dockCardState.setPinned(id, true);
    const root = document.createElement("div");
    root.className = "three-test-dock-card";
    root.dataset.cardId = id;
    const headerRow = document.createElement("div");
    headerRow.className = "three-test-dock-card-header";
    const headerButton = document.createElement("button");
    headerButton.type = "button";
    headerButton.className = "three-test-dock-card-header-main";
    const indicatorChip = document.createElement("span");
    indicatorChip.className = "three-test-dock-card-icon";
    indicatorChip.textContent = indicator;
    const titleLabel = document.createElement("span");
    titleLabel.className = "three-test-dock-card-title";
    titleLabel.textContent = title;
    headerButton.append(indicatorChip, titleLabel);
    const headerActions = document.createElement("div");
    headerActions.className = "three-test-dock-card-header-actions";
    const pinButton = document.createElement("button");
    pinButton.type = "button";
    pinButton.className = "three-test-dock-card-pin";
    applyPinButtonState(pinButton, true);
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "three-test-dock-card-close";
    closeButton.textContent = "x";
    closeButton.title = "Minimize";
    closeButton.setAttribute("aria-label", "Minimize card");
    headerActions.append(pinButton, closeButton);
    headerRow.append(headerButton, headerActions);
    const body = document.createElement("div");
    body.className = "three-test-dock-card-body";
    const summary = document.createElement("div");
    summary.className = "three-test-dock-card-summary";
    const details = document.createElement("div");
    details.className = "three-test-dock-card-details";
    body.append(summary, details);
    root.append(headerRow, body);
    rightDockRoot.appendChild(root);

    const applyState = (): void => {
      const snapshot = dockCardState.get(id);
      root.dataset.state = snapshot.visual;
      root.classList.toggle("is-collapsed", snapshot.visual === "collapsed");
      root.classList.toggle("is-expanded", snapshot.visual === "expanded");
      root.classList.toggle("is-peek", snapshot.visual === "peek");
      root.classList.toggle("is-pinned", snapshot.pinned);
      root.classList.toggle("is-focused", snapshot.focused);
      applyPinButtonState(pinButton, snapshot.pinned);
      const anyFocused = dockCardState.snapshots().some((entry) => entry.focused && entry.visual !== "collapsed");
      root.classList.toggle("is-dimmed", anyFocused && !snapshot.focused && snapshot.visual === "collapsed");
    };

    root.addEventListener("mouseenter", () => {
      playUiCue("hover");
      dockCardState.hoverEnter(id);
      applyDockCardStates();
    });
    root.addEventListener("mouseleave", () => {
      dockCardState.hoverLeave(id);
      applyDockCardStates();
    });
    headerButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("click");
      const snapshot = dockCardState.get(id);
      if (snapshot.pinned) {
        return;
      }
      if (snapshot.visual === "expanded") {
        dockCardState.collapse(id);
      } else {
        dockCardState.clickExpand(id);
      }
      applyDockCardStates();
    });
    pinButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("toggle");
      dockCardState.togglePin(id);
      applyDockCardStates();
    });
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("click");
      dockCardState.setPinned(id, false);
      dockCardState.collapse(id);
      applyDockCardStates();
    });
    const card: DockCardElements = {
      id,
      root,
      headerRow,
      headerButton,
      indicatorChip,
      titleLabel,
      body,
      summary,
      details,
      pinButton,
      closeButton,
      applyState
    };
    dockCards.set(id, card);
    applyDockCardStates();
    return card;
  };

  const climateCardSpec = getThreeDockCardSpec("dock:climate");
  const minimapCardSpec = getThreeDockCardSpec("dock:minimap");
  const timeCardSpec = getThreeDockCardSpec("dock:time");
  const createConfiguredDockCard = (spec: ReturnType<typeof getThreeDockCardSpec>, summary: string): DockCardElements => {
    const card = createDockCard(spec.id, spec.title, summary);
    spec.indicatorClassNames.forEach((className) => card.indicatorChip.classList.add(className));
    card.indicatorChip.title = spec.indicatorTitle;
    return card;
  };
  const climateCardId = climateCardSpec.id;
  const minimapCardId = minimapCardSpec.id;
  const timeCardId = timeCardSpec.id;
  const climateDock = createConfiguredDockCard(climateCardSpec, "--%");
  const minimapDock = createConfiguredDockCard(minimapCardSpec, "--");
  const timeDock = createConfiguredDockCard(timeCardSpec, "Y1 WINTER");

  const climateChartCanvas = document.createElement("canvas");
  climateChartCanvas.className = "three-test-climate-chart";
  const climateKpis = document.createElement("div");
  climateKpis.className = "three-test-dock-kpis";
  const climateSummaryContent = document.createElement("div");
  climateSummaryContent.className = "three-test-dock-summary-block";
  climateSummaryContent.append(climateKpis, climateChartCanvas);

  const minimapCanvas = document.createElement("canvas");
  minimapCanvas.className = "three-test-minimap-canvas";
  const minimapSummaryContent = document.createElement("div");
  minimapSummaryContent.className = "three-test-dock-summary-block";
  const minimapLayersWrap = document.createElement("div");
  minimapLayersWrap.className = "three-test-minimap-layers";
  const minimapModeGroupName = `three-test-minimap-mode-${threeTestInitCount}`;
  let minimapMode: ThreeTestMinimapMode = "terrain";
  const minimapOverlays = {
    wind: true,
    units: true
  };
  const minimapModeControls = new Map<ThreeTestMinimapMode, HTMLLabelElement>();
  const minimapOverlayControls = new Map<keyof typeof minimapOverlays, HTMLLabelElement>();
  const isMinimapModeUnlocked = (mode: ThreeTestMinimapMode): boolean =>
    mode === "satellite"
      ? hasProgressionCapability(world.progression, "minimap.mode.satellite")
      : hasProgressionCapability(world.progression, MINIMAP_MODE_CAPABILITIES[mode]);
  const addModeToggle = (mode: ThreeTestMinimapMode, label: string): void => {
    const wrap = document.createElement("label");
    wrap.className = "three-test-minimap-layer";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = minimapModeGroupName;
    input.checked = minimapMode === mode;
    input.addEventListener("change", () => {
      if (!input.checked) {
        return;
      }
      playUiCue("toggle");
      minimapMode = mode;
      if (mode === "satellite") {
        markSatelliteMinimapDirty();
      }
      lastMinimapRasterAt = -Infinity;
    });
    const text = document.createElement("span");
    text.textContent = label;
    wrap.append(input, text);
    minimapLayersWrap.appendChild(wrap);
    minimapModeControls.set(mode, wrap);
  };
  const addOverlayToggle = (key: keyof typeof minimapOverlays, label: string): void => {
    const wrap = document.createElement("label");
    wrap.className = "three-test-minimap-layer";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = minimapOverlays[key];
    input.addEventListener("change", () => {
      playUiCue("toggle");
      minimapOverlays[key] = input.checked;
      lastMinimapRasterAt = -Infinity;
    });
    const text = document.createElement("span");
    text.textContent = label;
    wrap.append(input, text);
    minimapLayersWrap.appendChild(wrap);
    minimapOverlayControls.set(key, wrap);
  };
  THREE_TEST_MINIMAP_MODES.forEach((mode) => addModeToggle(mode, getThreeTestMinimapModeLabel(mode)));
  addOverlayToggle("wind", "Wind");
  addOverlayToggle("units", "Units");
  minimapSummaryContent.append(minimapCanvas);

  minimapCanvas.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("click");
    const rect = minimapCanvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const localX = event.clientX - rect.left;
    const localY = event.clientY - rect.top;
    const tileX = Math.max(0, Math.min(world.grid.cols - 1, Math.floor((localX / rect.width) * world.grid.cols)));
    const tileY = Math.max(0, Math.min(world.grid.rows - 1, Math.floor((localY / rect.height) * world.grid.rows)));
    dispatchPhaseUiCommand({
      type: "minimap-pan",
      tile: { x: tileX, y: tileY }
    });
  });

  const timeSummary = document.createElement("div");
  timeSummary.className = "three-test-dock-kpis";
  const timeControls = document.createElement("div");
  timeControls.className = "three-test-time-controls";
  const pauseButton = document.createElement("button");
  pauseButton.type = "button";
  pauseButton.className = "three-test-time-button is-pause";
  pauseButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchPhaseUiCommand({ type: "action", action: TIME_CONTROL_ACTIONS.pause.action });
  });
  timeControls.appendChild(pauseButton);
  const speedButtons: HTMLButtonElement[] = [];
  Array.from({ length: 4 }).forEach(() => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "three-test-time-button";
    button.textContent = "--";
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const rawIndex = button.dataset.speedIndex;
      if (!rawIndex) {
        return;
      }
      const index = Number(rawIndex);
      if (!Number.isFinite(index)) {
        return;
      }
      dispatchPhaseUiCommand({ type: "action", action: getTimeSpeedAction(index).action });
    });
    timeControls.appendChild(button);
    speedButtons.push(button);
  });
  const speedSliderWrap = document.createElement("label");
  speedSliderWrap.className = "three-test-time-slider hidden";
  const speedSliderCaption = document.createElement("span");
  speedSliderCaption.className = "three-test-time-slider-caption";
  speedSliderCaption.textContent = "Speed";
  const speedSlider = document.createElement("input");
  speedSlider.type = "range";
  speedSlider.className = "three-test-time-slider-input";
  speedSlider.min = `${TIME_SPEED_SLIDER_MIN}`;
  speedSlider.max = `${TIME_SPEED_SLIDER_MAX}`;
  speedSlider.step = `${TIME_SPEED_SLIDER_STEP}`;
  speedSlider.value = "1";
  speedSlider.addEventListener("input", (event) => {
    event.preventDefault();
    event.stopPropagation();
    const nextValue = Number(speedSlider.value);
    if (!Number.isFinite(nextValue)) {
      return;
    }
    dispatchPhaseUiCommand({
      type: "action",
      action: TIME_CONTROL_ACTIONS.sliderSet.action,
      payload: { value: `${nextValue}` }
    });
  });
  const speedSliderValue = document.createElement("span");
  speedSliderValue.className = "three-test-time-slider-value";
  speedSliderValue.textContent = "1x";
  speedSliderWrap.append(speedSliderCaption, speedSlider, speedSliderValue);
  timeControls.appendChild(speedSliderWrap);
  const advanceToNextEventButton = document.createElement("button");
  advanceToNextEventButton.type = "button";
  advanceToNextEventButton.className = "three-test-time-button";
  advanceToNextEventButton.textContent = ">>>";
  advanceToNextEventButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchPhaseUiCommand({ type: "action", action: TIME_CONTROL_ACTIONS.advanceToNextEvent.action });
  });
  timeControls.appendChild(advanceToNextEventButton);
  const createDockSection = (titleText: string, content: HTMLElement): HTMLElement => {
    const section = document.createElement("section");
    section.className = "three-test-time-section";
    const title = document.createElement("div");
    title.className = "three-test-time-section-title";
    title.textContent = titleText;
    section.append(title, content);
    return section;
  };
  const timeAudioControls = document.createElement("div");
  timeAudioControls.className = "three-test-time-audio";
  const createTimeVolumeControls = (): {
    root: HTMLDivElement;
    muteButton: HTMLButtonElement;
    volumeLabel: HTMLSpanElement;
    volumeSlider: HTMLInputElement;
  } => {
    const root = document.createElement("div");
    root.className = "three-test-time-audio-group";
    const muteButton = document.createElement("button");
    muteButton.type = "button";
    muteButton.className = "three-test-time-button";
    const volumeWrap = document.createElement("label");
    volumeWrap.className = "three-test-time-volume";
    const volumeLabel = document.createElement("span");
    volumeLabel.className = "three-test-time-volume-label";
    const volumeSlider = document.createElement("input");
    volumeSlider.type = "range";
    volumeSlider.min = "0";
    volumeSlider.max = "1";
    volumeSlider.step = "0.01";
    volumeSlider.className = "three-test-time-volume-slider";
    volumeWrap.append(volumeLabel, volumeSlider);
    root.append(muteButton, volumeWrap);
    return { root, muteButton, volumeLabel, volumeSlider };
  };
  const dockAudioControls = new Map<
    AudioChannelId,
    ReturnType<typeof createTimeVolumeControls>
  >();
  AUDIO_CONTROL_CHANNELS.forEach((channel) => {
    const controls = createTimeVolumeControls();
    controls.root.dataset.audioChannel = channel.id;
    dockAudioControls.set(channel.id, controls);
    timeAudioControls.appendChild(controls.root);
  });
  const sfxControls = dockAudioControls.get("sfx")!;
  const worldTimeControls = dockAudioControls.get("world")!;
  const musicTimeControls = dockAudioControls.get("music")!;
  const timeAudioSection = createDockSection(getRuntimeWidgetTitle("audioControls", "threeDock"), timeAudioControls);
  const timeTestingControls = document.createElement("div");
  timeTestingControls.className = "three-test-time-testing";
  const createTimeToggleControls = (
    labelText: string,
    descriptionText: string
  ): { root: HTMLLabelElement; input: HTMLInputElement } => {
    const root = document.createElement("label");
    root.className = "three-test-time-toggle";
    const copy = document.createElement("span");
    copy.className = "three-test-time-toggle-copy";
    const label = document.createElement("span");
    label.className = "three-test-time-toggle-label";
    label.textContent = labelText;
    const description = document.createElement("span");
    description.className = "three-test-time-toggle-description";
    description.textContent = descriptionText;
    copy.append(label, description);
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "three-test-time-toggle-input";
    root.append(copy, input);
    return { root, input };
  };
  const dockToggleControls = new Map<
    (typeof SIMULATION_TOGGLE_SPECS)[number]["setting"],
    ReturnType<typeof createTimeToggleControls>
  >();
  SIMULATION_TOGGLE_SPECS.forEach((toggle) => {
    const controls = createTimeToggleControls(toggle.title, toggle.description);
    controls.root.dataset.runtimeSetting = toggle.setting;
    dockToggleControls.set(toggle.setting, controls);
    timeTestingControls.appendChild(controls.root);
  });
  const timeTestingSection = createDockSection(
    getRuntimeWidgetTitle("simulationSettings", "threeDock"),
    timeTestingControls
  );
  const settingsTabs = document.createElement("div");
  settingsTabs.className = "three-test-settings-tabs";
  const settingsTabBar = document.createElement("div");
  settingsTabBar.className = "three-test-settings-tabbar";
  const settingsMainTab = document.createElement("button");
  settingsMainTab.type = "button";
  settingsMainTab.className = "three-test-settings-tab is-active";
  settingsMainTab.textContent = "Main";
  const settingsEventsTab = document.createElement("button");
  settingsEventsTab.type = "button";
  settingsEventsTab.className = "three-test-settings-tab";
  settingsEventsTab.textContent = "Events";
  const settingsMainPanel = document.createElement("div");
  settingsMainPanel.className = "three-test-settings-tab-panel";
  const settingsEventsPanel = document.createElement("div");
  settingsEventsPanel.className = "three-test-settings-tab-panel hidden";
  const setActiveSettingsTab = (tab: "main" | "events"): void => {
    const mainActive = tab === "main";
    settingsMainTab.classList.toggle("is-active", mainActive);
    settingsEventsTab.classList.toggle("is-active", !mainActive);
    settingsMainPanel.classList.toggle("hidden", !mainActive);
    settingsEventsPanel.classList.toggle("hidden", mainActive);
  };
  settingsMainTab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveSettingsTab("main");
  });
  settingsEventsTab.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    setActiveSettingsTab("events");
  });
  settingsTabBar.append(settingsMainTab, settingsEventsTab);
  settingsMainPanel.append(timeControls, timeAudioSection);
  settingsEventsPanel.appendChild(timeTestingSection);
  settingsTabs.append(settingsTabBar, settingsMainPanel, settingsEventsPanel);
  const mutedAudioIcon = "\u{1F507}";
  const unmutedAudioIcon = "\u{1F50A}";
  const applyRuntimeToggleState = (): void => {
    const settings = getRuntimeSettings();
    SIMULATION_TOGGLE_SPECS.forEach((toggle) => {
      const controls = dockToggleControls.get(toggle.setting);
      if (controls) {
        controls.input.checked = Boolean(settings[toggle.setting]);
      }
    });
  };

  const applyDockChannelState = (channelId: AudioChannelId, settings: { muted: boolean; volume: number }, available: boolean): void => {
    const controls = dockAudioControls.get(channelId);
    const channel = AUDIO_CONTROL_CHANNELS.find((entry) => entry.id === channelId);
    if (!controls || !channel) {
      return;
    }
    const volumePct = Math.round(Math.max(0, Math.min(1, settings.volume)) * 100);
    controls.muteButton.textContent = settings.muted ? mutedAudioIcon : unmutedAudioIcon;
    controls.muteButton.title = settings.muted ? channel.mutedTitle : channel.unmutedTitle;
    controls.muteButton.setAttribute("aria-pressed", settings.muted ? "true" : "false");
    controls.muteButton.setAttribute("aria-label", settings.muted ? channel.mutedAriaLabel : channel.unmutedAriaLabel);
    controls.volumeLabel.textContent = `${channel.label} ${volumePct}%`;
    controls.volumeSlider.value = settings.volume.toFixed(2);
    controls.muteButton.disabled = !available;
    controls.volumeSlider.disabled = !available || settings.muted;
  };

  const applyDockAudioState = (settings: { muted: boolean; volume: number }): void =>
    applyDockChannelState("sfx", settings, !!uiAudio);

  const applyDockMusicState = (settings: { muted: boolean; volume: number }): void =>
    applyDockChannelState("music", settings, !!musicControls);

  const applyDockWorldState = (settings: { muted: boolean; volume: number }): void =>
    applyDockChannelState("world", settings, !!worldAudioControls);

  if (uiAudio) {
    removeUiAudioChangeListener = uiAudio.onChange((settings) => {
      applyDockAudioState(settings);
    });
    sfxControls.muteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("toggle");
      uiAudio.toggleMuted();
    });
    sfxControls.volumeSlider.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      const next = Number(target.value);
      if (!Number.isFinite(next)) {
        return;
      }
      uiAudio.setVolume(next);
    });
  } else {
    applyDockAudioState({ muted: false, volume: AUDIO_CONTROL_CHANNELS.find((channel) => channel.id === "sfx")?.defaultVolume ?? 0.65 });
  }

  if (musicControls) {
    removeMusicControlsChangeListener = musicControls.onChange((settings) => {
      applyDockMusicState(settings);
    });
    musicTimeControls.muteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("toggle");
      musicControls.toggleMuted();
    });
    musicTimeControls.volumeSlider.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      const next = Number(target.value);
      if (!Number.isFinite(next)) {
        return;
      }
      musicControls.setVolume(next);
    });
  } else {
    applyDockMusicState({
      muted: false,
      volume: AUDIO_CONTROL_CHANNELS.find((channel) => channel.id === "music")?.defaultVolume ?? 0.35
    });
  }

  if (worldAudioControls) {
    removeWorldAudioChangeListener = worldAudioControls.onChange((settings) => {
      applyDockWorldState(settings);
    });
    worldTimeControls.muteButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("toggle");
      worldAudioControls.toggleMuted();
    });
    worldTimeControls.volumeSlider.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) {
        return;
      }
      const next = Number(target.value);
      if (!Number.isFinite(next)) {
        return;
      }
      worldAudioControls.setVolume(next);
    });
  } else {
    applyDockWorldState({
      muted: false,
      volume: AUDIO_CONTROL_CHANNELS.find((channel) => channel.id === "world")?.defaultVolume ?? 0.55
    });
  }

  SIMULATION_TOGGLE_SPECS.forEach((toggle) => {
    const controls = dockToggleControls.get(toggle.setting);
    controls?.input.addEventListener("change", (event) => {
      event.stopPropagation();
      playUiCue("toggle");
      setRuntimeSetting(toggle.setting, controls.input.checked);
    });
  });
  applyRuntimeToggleState();
  removeRuntimeSettingsChangeListener = subscribeRuntimeSettings(() => {
    applyRuntimeToggleState();
  });

  const summaryContentByWidget = new Map<RuntimeWidgetId, HTMLElement>([
    ["climate", climateSummaryContent],
    ["minimap", minimapSummaryContent],
    ["timeControls", timeSummary]
  ]);
  const detailContentByWidget = new Map<RuntimeWidgetId, HTMLElement>([
    ["minimap", minimapLayersWrap],
    ["timeControls", settingsTabs]
  ]);
  climateCardSpec.summaryWidgets.forEach((widgetId) => {
    const content = summaryContentByWidget.get(widgetId);
    if (content) {
      climateDock.summary.appendChild(content);
    }
  });
  minimapCardSpec.summaryWidgets.forEach((widgetId) => {
    const content = summaryContentByWidget.get(widgetId);
    if (content) {
      minimapDock.summary.appendChild(content);
    }
  });
  minimapCardSpec.detailWidgets.forEach((widgetId) => {
    const content = detailContentByWidget.get(widgetId);
    if (content) {
      minimapDock.details.appendChild(content);
    }
  });
  timeCardSpec.summaryWidgets.forEach((widgetId) => {
    const content = summaryContentByWidget.get(widgetId);
    if (content) {
      timeDock.summary.appendChild(content);
    }
  });
  timeCardSpec.detailWidgets.forEach((widgetId) => {
    const content = detailContentByWidget.get(widgetId);
    if (content) {
      timeDock.details.appendChild(content);
    }
  });

  const getTileColor = (tileId: number): { r: number; g: number; b: number } => {
    const type = TILE_ID_TO_TYPE[tileId] ?? "grass";
    switch (type) {
      case "water":
        return { r: 48, g: 110, b: 151 };
      case "road":
        return { r: 183, g: 176, b: 150 };
      case "base":
        return { r: 161, g: 47, b: 29 };
      case "house":
        return { r: 192, g: 138, b: 90 };
      case "forest":
        return { r: 47, g: 93, b: 49 };
      case "ash":
        return { r: 74, g: 74, b: 74 };
      case "firebreak":
        return { r: 214, g: 198, b: 166 };
      case "scrub":
        return { r: 99, g: 113, b: 71 };
      default:
        return { r: 90, g: 143, b: 78 };
    }
  };

  const resolveHoverDebugTileHighlightHex = (tileId: number, tone: HoverDebugTone): number => {
    switch (tone) {
      case "watch":
        return HOVER_DEBUG_TILE_WATCH_COLOR;
      case "high":
        return HOVER_DEBUG_TILE_HIGH_COLOR;
      case "critical":
        return HOVER_DEBUG_TILE_CRITICAL_COLOR;
      default: {
        const base = getTileColor(tileId);
        const r = Math.round(base.r + (255 - base.r) * 0.38);
        const g = Math.round(base.g + (255 - base.g) * 0.38);
        const b = Math.round(base.b + (255 - base.b) * 0.38);
        return (r << 16) | (g << 8) | b;
      }
    }
  };

  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

  const drawClimateSparkline = (
    canvasElement: HTMLCanvasElement,
    values: number[],
    markerIndex: number,
    mode: "risk" | "temp",
    chartContext: {
      forecastStartDay: number;
      forecastYearDays: number;
      forecastWindowDays: number;
      rainPeriods?: ClimateForecast["rainPeriods"];
    }
  ): void => {
    const rect = canvasElement.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1 || values.length === 0) {
      return;
    }
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvasElement.width !== width || canvasElement.height !== height) {
      canvasElement.width = width;
      canvasElement.height = height;
    }
    const ctx = canvasElement.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.clearRect(0, 0, width, height);

    const leftPad = mode === "risk" ? 54 : 46;
    const rightPad = 10;
    const topPad = 8;
    const bottomPad = 30;
    const plotX = leftPad;
    const plotY = topPad;
    const plotWidth = Math.max(12, width - leftPad - rightPad);
    const plotHeight = Math.max(12, height - topPad - bottomPad);

    const domainMin = mode === "risk" ? 0 : CLIMATE_TEMP_DOMAIN_MIN;
    const domainMax = mode === "risk" ? 1 : CLIMATE_TEMP_DOMAIN_MAX;
    const domainSpan = Math.max(0.0001, domainMax - domainMin);
    const toY = (value: number): number => {
      const normalized = clamp01((value - domainMin) / domainSpan);
      return plotY + (1 - normalized) * plotHeight;
    };
    const toX = (index: number): number => plotX + (index / Math.max(1, values.length - 1)) * plotWidth;

    const seasonLayout = computeSeasonLayout(
      Math.max(0, Math.floor(chartContext.forecastStartDay)),
      Math.max(1, Math.floor(chartContext.forecastYearDays)),
      Math.max(1, Math.floor(chartContext.forecastWindowDays)),
      { width: plotWidth, height: plotHeight, padding: 0 }
    );

    ctx.fillStyle = "rgba(14, 11, 9, 0.78)";
    ctx.fillRect(plotX, plotY, plotWidth, plotHeight);

    const seasonBandColors = [
      "rgba(43, 104, 140, 0.13)",
      "rgba(90, 143, 78, 0.12)",
      "rgba(240, 179, 59, 0.13)",
      "rgba(209, 74, 44, 0.13)"
    ];
    seasonLayout.bands.forEach((band) => {
      ctx.fillStyle = seasonBandColors[band.seasonIndex] ?? seasonBandColors[0];
      ctx.fillRect(plotX + band.x, plotY, band.width, plotHeight);
    });

    if (mode === "risk") {
      const riskBandColors = [
        "rgba(43, 104, 140, 0.2)",
        "rgba(90, 143, 78, 0.18)",
        "rgba(240, 179, 59, 0.2)",
        "rgba(209, 74, 44, 0.22)"
      ];
      const riskBandHeight = plotHeight / CLIMATE_RISK_LABELS.length;
      for (let i = 0; i < CLIMATE_RISK_LABELS.length; i += 1) {
        const y = plotY + plotHeight - riskBandHeight * (i + 1);
        ctx.fillStyle = riskBandColors[i] ?? riskBandColors[0];
        ctx.fillRect(plotX, y, plotWidth, riskBandHeight);
      }
      ctx.font = canvasUiFont(500, 10);
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      CLIMATE_RISK_LABELS.forEach((label, index) => {
        const bandCenter = (index + 0.5) / CLIMATE_RISK_LABELS.length;
        const y = plotY + plotHeight - bandCenter * plotHeight;
        ctx.fillStyle = "rgba(255, 236, 202, 0.9)";
        ctx.fillText(label, 4, y);
      });
      ctx.strokeStyle = "rgba(255, 226, 181, 0.26)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      RISK_THRESHOLDS.forEach((value) => {
        const y = toY(value);
        ctx.beginPath();
        ctx.moveTo(plotX, y);
        ctx.lineTo(plotX + plotWidth, y);
        ctx.stroke();
      });
      ctx.setLineDash([]);
    } else {
      const tickCount = 5;
      ctx.font = canvasUiFont(500, 10);
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      for (let i = 0; i < tickCount; i += 1) {
        const t = i / Math.max(1, tickCount - 1);
        const value = domainMin + t * domainSpan;
        const y = plotY + plotHeight - t * plotHeight;
        ctx.strokeStyle = "rgba(255, 226, 181, 0.24)";
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(plotX, y);
        ctx.lineTo(plotX + plotWidth, y);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "rgba(255, 236, 202, 0.9)";
        ctx.fillText(`${Math.round(value)}C`, 4, y);
      }
    }

    ctx.strokeStyle = "rgba(255, 226, 181, 0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(plotX, plotY);
    ctx.lineTo(plotX, plotY + plotHeight);
    ctx.lineTo(plotX + plotWidth, plotY + plotHeight);
    ctx.stroke();

    ctx.strokeStyle = "rgba(255, 226, 181, 0.24)";
    ctx.lineWidth = 1;
    ctx.setLineDash([1, 4]);
    seasonLayout.markers.forEach((markerX) => {
      const x = plotX + markerX;
      ctx.beginPath();
      ctx.moveTo(x, plotY);
      ctx.lineTo(x, plotY + plotHeight);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    const seasonLabelY = plotY + plotHeight + 13;
    const maxSeasonLabels = Math.max(1, Math.floor(plotWidth / 68));
    const seasonStep = Math.ceil(seasonLayout.labels.length / maxSeasonLabels);
    ctx.font = canvasUiFont(600, 9);
    ctx.fillStyle = "rgba(255, 228, 186, 0.86)";
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    seasonLayout.labels.forEach((labelData, index) => {
      if (index % seasonStep !== 0) {
        return;
      }
      const x = plotX + (labelData.leftPercent / 100) * plotWidth;
      ctx.fillText(labelData.label.toUpperCase(), x, seasonLabelY);
    });

    const areaGradient = ctx.createLinearGradient(0, plotY + plotHeight, 0, plotY);
    if (mode === "risk") {
      areaGradient.addColorStop(0, "rgba(43, 104, 140, 0.26)");
      areaGradient.addColorStop(0.58, "rgba(240, 179, 59, 0.3)");
      areaGradient.addColorStop(1, "rgba(209, 74, 44, 0.34)");
    } else {
      areaGradient.addColorStop(0, "rgba(43, 104, 140, 0.3)");
      areaGradient.addColorStop(1, "rgba(240, 179, 59, 0.34)");
    }
    ctx.fillStyle = areaGradient;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = toX(index);
      const y = toY(value);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    const lastX = toX(values.length - 1);
    const firstX = toX(0);
    ctx.lineTo(lastX, plotY + plotHeight);
    ctx.lineTo(firstX, plotY + plotHeight);
    ctx.closePath();
    ctx.fill();

    const rainLayout = computeForecastPeriodLayout(
      chartContext.rainPeriods ?? [],
      Math.max(0, Math.floor(chartContext.forecastStartDay)),
      Math.max(1, Math.floor(chartContext.forecastWindowDays)),
      { width: plotWidth, height: plotHeight, padding: 0 }
    );
    rainLayout.bands.forEach((band) => {
      const x = plotX + band.x;
      ctx.fillStyle = "rgba(89, 168, 222, 0.22)";
      ctx.fillRect(x, plotY, band.width, plotHeight);
      ctx.strokeStyle = "rgba(130, 210, 255, 0.68)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x + 0.5, plotY + 0.5, Math.max(0, band.width - 1), Math.max(0, plotHeight - 1));
    });

    const lineGradient = ctx.createLinearGradient(plotX, 0, plotX + plotWidth, 0);
    if (mode === "risk") {
      lineGradient.addColorStop(0, "rgba(99, 183, 255, 0.98)");
      lineGradient.addColorStop(0.55, "rgba(240, 179, 59, 0.98)");
      lineGradient.addColorStop(1, "rgba(232, 92, 56, 0.98)");
    } else {
      lineGradient.addColorStop(0, "rgba(99, 183, 255, 0.98)");
      lineGradient.addColorStop(1, "rgba(240, 179, 59, 0.98)");
    }
    ctx.strokeStyle = lineGradient;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = toX(index);
      const y = toY(value);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();

    const clampedMarker = Math.max(0, Math.min(values.length - 1, markerIndex));
    const markerX = toX(clampedMarker);
    const markerY = toY(values[clampedMarker] ?? values[0] ?? domainMin);
    ctx.strokeStyle = "rgba(240, 179, 59, 0.98)";
    ctx.lineWidth = 1.2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(markerX, plotY);
    ctx.lineTo(markerX, plotY + plotHeight + 4);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.fillStyle = "rgba(255, 229, 171, 0.98)";
    ctx.beginPath();
    ctx.arc(markerX, markerY, 2.2, 0, Math.PI * 2);
    ctx.fill();
  };

  let lastMinimapRasterAt = -Infinity;
  let lastMinimapThermalBackdrop: ReturnType<typeof buildThermalBackdropField> = new Float32Array(0);
  let lastMinimapThermalBackdropWidth = 0;
  let lastMinimapThermalBackdropHeight = 0;
  let lastMinimapThermalBackdropRevision = -1;
  let satelliteMinimapTarget: THREE.WebGLRenderTarget | null = null;
  let satelliteMinimapPixels = new Uint8Array(0);
  let satelliteMinimapDirty = true;
  let satelliteMinimapCacheKey = "";
  let satelliteMinimapVisualRevision = 0;
  let satelliteMinimapCapturedDay = -Infinity;
  let satelliteMinimapRetryAfterMs = -Infinity;
  const satelliteMinimapCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
  const satelliteMinimapCanvas = document.createElement("canvas");
  const satelliteMinimapCtx = satelliteMinimapCanvas.getContext("2d");

  const markSatelliteMinimapDirty = (): void => {
    satelliteMinimapDirty = true;
  };

  const markSatelliteMinimapVisualsDirty = (): void => {
    satelliteMinimapVisualRevision += 1;
    markSatelliteMinimapDirty();
  };

  const disposeSatelliteMinimapTarget = (): void => {
    if (!satelliteMinimapTarget) {
      return;
    }
    satelliteMinimapTarget.dispose();
    satelliteMinimapTarget = null;
  };

  const ensureSatelliteMinimapTarget = (width: number, height: number): THREE.WebGLRenderTarget | null => {
    if (satelliteMinimapTarget && satelliteMinimapTarget.width === width && satelliteMinimapTarget.height === height) {
      return satelliteMinimapTarget;
    }
    disposeSatelliteMinimapTarget();
    try {
      satelliteMinimapTarget = new THREE.WebGLRenderTarget(width, height, {
        depthBuffer: true,
        stencilBuffer: false
      });
      satelliteMinimapTarget.texture.generateMipmaps = false;
      satelliteMinimapTarget.texture.minFilter = THREE.LinearFilter;
      satelliteMinimapTarget.texture.magFilter = THREE.LinearFilter;
      satelliteMinimapTarget.texture.colorSpace = THREE.SRGBColorSpace;
      return satelliteMinimapTarget;
    } catch (error) {
      satelliteMinimapRetryAfterMs = performance.now() + 1000;
      console.warn("[threeTest] Satellite minimap render target allocation failed.", error);
      return null;
    }
  };

  const getSatelliteMinimapCaptureSize = (width: number, height: number): { width: number; height: number } => {
    const maxDim = Math.max(width, height, 1);
    const scale = Math.min(1, SATELLITE_MINIMAP_MAX_SIZE / maxDim);
    return {
      width: Math.max(1, Math.floor(width * scale)),
      height: Math.max(1, Math.floor(height * scale))
    };
  };

  const fitSatelliteMinimapCamera = (width: number, height: number): void => {
    const terrainSize = lastTerrainSize;
    if (!terrainSize) {
      return;
    }
    const terrainWidth = Math.max(1, terrainSize.width);
    const terrainDepth = Math.max(1, terrainSize.depth);
    const aspect = Math.max(0.01, width / Math.max(1, height));
    let viewWidth = terrainWidth;
    let viewDepth = viewWidth / aspect;
    if (viewDepth < terrainDepth) {
      viewDepth = terrainDepth;
      viewWidth = viewDepth * aspect;
    }
    const span = Math.max(viewWidth, viewDepth);
    satelliteMinimapCamera.left = -viewWidth * 0.5;
    satelliteMinimapCamera.right = viewWidth * 0.5;
    satelliteMinimapCamera.top = viewDepth * 0.5;
    satelliteMinimapCamera.bottom = -viewDepth * 0.5;
    satelliteMinimapCamera.near = 0.1;
    satelliteMinimapCamera.far = Math.max(500, span * 6);
    satelliteMinimapCamera.position.set(0, Math.max(80, span * 2), 0.001);
    satelliteMinimapCamera.up.set(0, 0, -1);
    satelliteMinimapCamera.lookAt(0, 0, 0);
    satelliteMinimapCamera.updateProjectionMatrix();
  };

  const getSatelliteMinimapCacheKey = (width: number, height: number): string => {
    const size = lastTerrainSize;
    const sizeKey = size ? `${size.width.toFixed(2)}x${size.depth.toFixed(2)}` : "no-terrain";
    return [
      width,
      height,
      world.grid.cols,
      world.grid.rows,
      sizeKey,
      satelliteMinimapVisualRevision
    ].join(":");
  };

  const captureSatelliteMinimap = (width: number, height: number, cacheKey: string): boolean => {
    if (!lastTerrainSize || !satelliteMinimapCtx) {
      return false;
    }
    const target = ensureSatelliteMinimapTarget(width, height);
    if (!target) {
      return false;
    }

    fitSatelliteMinimapCamera(width, height);
    const requiredPixels = width * height * 4;
    if (satelliteMinimapPixels.length !== requiredPixels) {
      satelliteMinimapPixels = new Uint8Array(requiredPixels);
    }
    if (satelliteMinimapCanvas.width !== width || satelliteMinimapCanvas.height !== height) {
      satelliteMinimapCanvas.width = width;
      satelliteMinimapCanvas.height = height;
    }

    const previousTarget = renderer.getRenderTarget();
    const previousViewport = new THREE.Vector4();
    const previousScissor = new THREE.Vector4();
    const previousClearColor = new THREE.Color();
    renderer.getViewport(previousViewport);
    renderer.getScissor(previousScissor);
    const previousScissorTest = renderer.getScissorTest();
    renderer.getClearColor(previousClearColor);
    const previousClearAlpha = renderer.getClearAlpha();
    const previousXrEnabled = renderer.xr.enabled;

    try {
      renderer.xr.enabled = false;
      renderer.setRenderTarget(target);
      renderer.setViewport(0, 0, width, height);
      renderer.setScissorTest(false);
      renderer.setClearColor(0x21485f, 1);
      renderer.clear(true, true, true);
      renderer.render(scene, satelliteMinimapCamera);
      renderer.readRenderTargetPixels(target, 0, 0, width, height, satelliteMinimapPixels);

      const image = satelliteMinimapCtx.createImageData(width, height);
      const stride = width * 4;
      for (let y = 0; y < height; y += 1) {
        const sourceStart = (height - 1 - y) * stride;
        const targetStart = y * stride;
        image.data.set(satelliteMinimapPixels.subarray(sourceStart, sourceStart + stride), targetStart);
      }
      satelliteMinimapCtx.putImageData(image, 0, 0);
      satelliteMinimapCacheKey = cacheKey;
      satelliteMinimapCapturedDay = world.careerDay ?? 0;
      satelliteMinimapDirty = false;
      satelliteMinimapRetryAfterMs = -Infinity;
      return true;
    } catch (error) {
      satelliteMinimapDirty = true;
      satelliteMinimapRetryAfterMs = performance.now() + 1000;
      console.warn("[threeTest] Satellite minimap capture failed; keeping the previous cached image.", error);
      return false;
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setViewport(previousViewport);
      renderer.setScissor(previousScissor);
      renderer.setScissorTest(previousScissorTest);
      renderer.setClearColor(previousClearColor, previousClearAlpha);
      renderer.xr.enabled = previousXrEnabled;
    }
  };

  const drawSatelliteMinimapCanvas = (ctx: CanvasRenderingContext2D, width: number, height: number): void => {
    const captureSize = getSatelliteMinimapCaptureSize(width, height);
    const cacheKey = getSatelliteMinimapCacheKey(captureSize.width, captureSize.height);
    const currentDay = world.careerDay ?? 0;
    const staleByDays =
      Number.isFinite(satelliteMinimapCapturedDay) &&
      currentDay - satelliteMinimapCapturedDay >= SATELLITE_MINIMAP_REFRESH_DAYS;
    const needsCapture =
      satelliteMinimapDirty ||
      satelliteMinimapCanvas.width <= 0 ||
      satelliteMinimapCanvas.height <= 0 ||
      satelliteMinimapCacheKey !== cacheKey ||
      staleByDays;

    if (needsCapture && performance.now() >= satelliteMinimapRetryAfterMs) {
      captureSatelliteMinimap(captureSize.width, captureSize.height, cacheKey);
    }

    ctx.clearRect(0, 0, width, height);
    if (satelliteMinimapCanvas.width > 0 && satelliteMinimapCanvas.height > 0) {
      const smoothing = ctx.imageSmoothingEnabled;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(satelliteMinimapCanvas, 0, 0, width, height);
      ctx.imageSmoothingEnabled = smoothing;
      return;
    }
    ctx.fillStyle = "#21485f";
    ctx.fillRect(0, 0, width, height);
  };

  const drawMinimapCanvas = (canvasElement: HTMLCanvasElement): void => {
    const rect = canvasElement.getBoundingClientRect();
    if (rect.width <= 2 || rect.height <= 2 || world.grid.cols <= 0 || world.grid.rows <= 0) {
      return;
    }
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    if (canvasElement.width !== width || canvasElement.height !== height) {
      canvasElement.width = width;
      canvasElement.height = height;
    }
    const ctx = canvasElement.getContext("2d");
    if (!ctx) {
      return;
    }
    if (minimapMode === "satellite") {
      drawSatelliteMinimapCanvas(ctx, width, height);
      return;
    }
    const image = ctx.createImageData(width, height);
    const data = image.data;
    const cols = world.grid.cols;
    const rows = world.grid.rows;
    if (minimapMode === "thermal") {
      const terrainRevision = world.terrainTypeRevision ?? 0;
      if (
        lastMinimapThermalBackdrop.length !== width * height ||
        lastMinimapThermalBackdropWidth !== width ||
        lastMinimapThermalBackdropHeight !== height ||
        lastMinimapThermalBackdropRevision !== terrainRevision
      ) {
        lastMinimapThermalBackdrop = buildThermalBackdropField(world, width, height);
        lastMinimapThermalBackdropWidth = width;
        lastMinimapThermalBackdropHeight = height;
        lastMinimapThermalBackdropRevision = terrainRevision;
      }
    }
    paintMinimapRaster(data, world, minimapMode, width, height, {
      thermalBackdrop: lastMinimapThermalBackdrop,
      thermalPalette: DEFAULT_THERMAL_PALETTE
    });
    ctx.putImageData(image, 0, 0);
    if (minimapMode !== "thermal") {
      const reports = world.fireKnowledge?.reports ?? [];
      reports.forEach((report) => {
        if (!report.active) {
          return;
        }
        const px = ((report.tileX + 0.5) / Math.max(1, cols)) * width;
        const py = ((report.tileY + 0.5) / Math.max(1, rows)) * height;
        ctx.save();
        ctx.strokeStyle = report.state === "confirmed" ? "rgba(255, 93, 55, 0.98)" : "rgba(255, 202, 92, 0.92)";
        ctx.fillStyle = report.state === "confirmed" ? "rgba(255, 93, 55, 0.28)" : "rgba(255, 202, 92, 0.2)";
        ctx.lineWidth = report.state === "confirmed" ? 1.8 : 1.2;
        ctx.setLineDash(report.state === "confirmed" ? [] : [3, 2]);
        ctx.beginPath();
        ctx.arc(px, py, report.state === "confirmed" ? 4.2 : 5.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      });
    }
    if (
      minimapOverlays.units &&
      hasProgressionCapability(world.progression, "minimap.overlay.units") &&
      world.units.length > 0
    ) {
      ctx.save();
      world.units.forEach((unit) => {
        if (unit.kind === "firefighter" && unit.carrierId !== null) {
          return;
        }
        const px = (unit.x / Math.max(1, cols)) * width;
        const py = (unit.y / Math.max(1, rows)) * height;
        ctx.fillStyle = unit.kind === "truck" ? "rgba(99, 183, 255, 0.95)" : "rgba(255, 230, 115, 0.95)";
        ctx.beginPath();
        ctx.arc(px, py, unit.kind === "truck" ? 2.8 : 1.8, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }
    if (minimapOverlays.wind && hasProgressionCapability(world.progression, "minimap.overlay.wind")) {
      const climateSeed = generateWorldClimateSeed(world.seed);
      const centerX = width * 0.14;
      const centerY = height * 0.14;
      const len = Math.max(8, Math.min(width, height) * 0.08);
      const barbLen = Math.max(9, Math.min(width, height) * 0.07);
      const barbColor =
        minimapMode === "thermal"
          ? "rgba(115, 235, 255, 0.95)"
          : minimapMode === "topographic"
            ? "rgba(255, 238, 128, 0.96)"
            : minimapMode === "moisture"
              ? "rgba(255, 247, 214, 0.96)"
              : "rgba(255, 255, 255, 0.96)";
      const drawBarb = (x: number, y: number, dx: number, dy: number, strength: number): void => {
        const mag = Math.hypot(dx, dy);
        const scaledLen = barbLen * Math.max(0, Math.min(1.6, strength));
        if (strength <= 0.04 || mag <= 0.0001 || scaledLen < 2.25) {
          ctx.fillStyle = "rgba(8, 10, 14, 0.78)";
          ctx.beginPath();
          ctx.arc(x, y, 2.3, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = barbColor;
          ctx.beginPath();
          ctx.arc(x, y, 1.35, 0, Math.PI * 2);
          ctx.fill();
          return;
        }
        const ux = dx / mag;
        const uy = dy / mag;
        const endX = x + ux * scaledLen;
        const endY = y + uy * scaledLen;
        const side = scaledLen * 0.28;
        ctx.strokeStyle = "rgba(8, 10, 14, 0.78)";
        ctx.lineWidth = 3.1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(endX, endY);
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - ux * side - uy * side * 0.7, endY - uy * side + ux * side * 0.7);
        ctx.moveTo(endX - ux * side * 0.45, endY - uy * side * 0.45);
        ctx.lineTo(endX - ux * side * 1.15 + uy * side * 0.55, endY - uy * side * 1.15 - ux * side * 0.55);
        ctx.stroke();
        ctx.strokeStyle = barbColor;
        ctx.lineWidth = 1.65;
        ctx.stroke();
      };
      const drawArrow = (dx: number, dy: number, strength: number, color: string, offsetY: number): void => {
        const mag = Math.hypot(dx, dy);
        if (mag <= 0.0001) {
          return;
        }
        const ux = dx / mag;
        const uy = dy / mag;
        const scaledLen = len * Math.max(0.4, Math.min(1, strength));
        const startY = centerY + offsetY;
        const endX = centerX + ux * scaledLen;
        const endY = startY + uy * scaledLen;
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(centerX, startY);
        ctx.lineTo(endX, endY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(endX, endY);
        ctx.lineTo(endX - ux * 4 - uy * 2.5, endY - uy * 4 + ux * 2.5);
        ctx.lineTo(endX - ux * 4 + uy * 2.5, endY - uy * 4 - ux * 2.5);
        ctx.closePath();
        ctx.fill();
      };
      buildTerrainWindOverlaySamples(world).forEach((sample) => {
        drawBarb(sample.x01 * width, sample.y01 * height, sample.dx, sample.dy, sample.strength);
      });
      drawArrow(
        Math.cos(climateSeed.prevailingWindAngleRad),
        Math.sin(climateSeed.prevailingWindAngleRad),
        climateSeed.prevailingWindStrength,
        "rgba(83, 211, 194, 0.95)",
        0
      );
      drawArrow(world.wind?.dx ?? 0, world.wind?.dy ?? 0, world.wind?.strength ?? 0, "rgba(240, 243, 247, 0.95)", 9);
    }
    if (
      lastTerrainSize &&
      minimapOverlays.units &&
      hasProgressionCapability(world.progression, "minimap.overlay.units")
    ) {
      const worldWidth = Math.max(1, lastTerrainSize.width);
      const worldDepth = Math.max(1, lastTerrainSize.depth);
      const tx = clamp01(camera.position.x / worldWidth + 0.5);
      const ty = clamp01(camera.position.z / worldDepth + 0.5);
      const cx = tx * width;
      const cy = ty * height;
      const lookDir = controls.target.clone().sub(camera.position);
      lookDir.y = 0;
      if (lookDir.lengthSq() > 1e-6) {
        lookDir.normalize();
      }
      const wedgeLen = Math.max(10, Math.min(width, height) * 0.12);
      const tipX = cx + lookDir.x * wedgeLen;
      const tipY = cy + lookDir.z * wedgeLen;
      ctx.strokeStyle = "rgba(90, 205, 255, 0.95)";
      ctx.fillStyle = "rgba(90, 205, 255, 0.2)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(cx, cy, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    }
  };

  const getClimateRiskSeries = (): number[] => {
    if (world.climateForecast && world.climateForecast.risk.length > 0) {
      return world.climateForecast.risk.map((value) => clamp01(value));
    }
    const fallback = clamp01(world.climateSpreadMultiplier ?? world.climateIgnitionMultiplier ?? 0.3);
    return [fallback];
  };

  const getCurrentSeasonLabel = (): string => {
    const yearDays = Math.max(1, Math.floor(world.climateTimeline?.daysPerYear ?? 360));
    const dayInYear = ((world.careerDay ?? 0) % yearDays + yearDays) % yearDays;
    const seasonIndex = Math.min(3, Math.floor((dayInYear / yearDays) * 4));
    return SEASON_LABELS[seasonIndex] ?? "Season";
  };

  let lastDockOverlayUpdateAt = -Infinity;
  let lastClimateKpiKey = "";
  let lastTimeSummaryKey = "";
  const updateDockOverlay = (time: number): void => {
    if (!THREE_TEST_DISABLE_HUD) {
      dockOverlayRoot.classList.add("hidden");
      return;
    }
    dockOverlayRoot.classList.remove("hidden");
    if (time - lastDockOverlayUpdateAt < DOM_DOCK_REDRAW_INTERVAL_MS) {
      return;
    }
    lastDockOverlayUpdateAt = time;
    const forecastDays = Math.max(1, world.climateForecast?.days ?? getClimateRiskSeries().length);
    const markerIndex = Math.max(0, Math.min(forecastDays - 1, Math.floor(world.climateForecastDay ?? 0)));
    const riskSeries = getClimateRiskSeries();
    const riskNow = riskSeries[Math.min(markerIndex, riskSeries.length - 1)] ?? 0;
    const riskPct = Math.round(clamp01(riskNow) * 100);
    const seasonLabel = getCurrentSeasonLabel();
    const minimapUnlocked = hasProgressionCapability(world.progression, "runtime.minimap");
    const windUnlocked = hasProgressionCapability(world.progression, "climate.wind");
    const unitsUnlocked = hasProgressionCapability(world.progression, "minimap.overlay.units");
    minimapDock.root.hidden = !minimapUnlocked;
    minimapModeControls.forEach((control, mode) => {
      control.hidden = !isMinimapModeUnlocked(mode);
    });
    minimapOverlayControls.get("wind")!.hidden = !hasProgressionCapability(world.progression, "minimap.overlay.wind");
    minimapOverlayControls.get("units")!.hidden = !unitsUnlocked;
    if (!isMinimapModeUnlocked(minimapMode)) {
      minimapMode = THREE_TEST_MINIMAP_MODES.find(isMinimapModeUnlocked) ?? "terrain";
      minimapModeControls.forEach((control, mode) => {
        const input = control.querySelector("input");
        if (input instanceof HTMLInputElement) {
          input.checked = mode === minimapMode;
        }
      });
      lastMinimapRasterAt = -Infinity;
    }
    const windSpeed = Math.round(Math.max(0, world.wind.strength) * 10);
    const windDir = (world.wind.name ?? "Calm").toUpperCase();
    const climateKpiKey = `${riskPct}|${windUnlocked ? `${world.wind.name}|${windSpeed}` : "locked"}`;
    if (climateKpiKey !== lastClimateKpiKey) {
      lastClimateKpiKey = climateKpiKey;
      climateKpis.innerHTML = "";
      const kpiRisk = document.createElement("div");
      kpiRisk.textContent = `Risk ${riskPct}%`;
      climateKpis.append(kpiRisk);
      if (windUnlocked) {
        const kpiWind = document.createElement("div");
        kpiWind.textContent = `Wind ${world.wind.name} ${windSpeed}`;
        climateKpis.append(kpiWind);
      }
    }
    climateDock.indicatorChip.textContent = `${riskPct}%`;
    climateDock.indicatorChip.classList.remove("is-low", "is-moderate", "is-high", "is-extreme");
    if (riskNow < 0.25) {
      climateDock.indicatorChip.classList.add("is-low");
    } else if (riskNow < 0.5) {
      climateDock.indicatorChip.classList.add("is-moderate");
    } else if (riskNow < 0.75) {
      climateDock.indicatorChip.classList.add("is-high");
    } else {
      climateDock.indicatorChip.classList.add("is-extreme");
    }
    timeDock.indicatorChip.textContent = `Y${Math.max(1, world.year)} ${seasonLabel.toUpperCase()}`;
    minimapDock.indicatorChip.textContent = windUnlocked ? `${windDir} ${windSpeed}` : "MAP";
    const climateSeries = riskSeries;
    const climateChartContext = {
      forecastStartDay: Math.max(0, world.climateForecastStart ?? 0),
      forecastYearDays: Math.max(1, Math.floor(world.climateTimeline?.daysPerYear ?? 360)),
      forecastWindowDays: forecastDays,
      rainPeriods: world.climateForecast?.rainPeriods ?? []
    };
    const climateState = dockCardState.get(climateCardId).visual;
    if (climateState === "peek" || climateState === "expanded") {
      drawClimateSparkline(climateChartCanvas, climateSeries, markerIndex, "risk", climateChartContext);
    }

    minimapDock.summary.title = "Click minimap to pan camera";
    if (time - lastMinimapRasterAt >= MINIMAP_REDRAW_INTERVAL_MS) {
      const minimapState = dockCardState.get(minimapCardId).visual;
      if (minimapState === "peek" || minimapState === "expanded") {
        drawMinimapCanvas(minimapCanvas);
      }
      lastMinimapRasterAt = time;
    }

    const activeSpeedOptions = getTimeSpeedOptions(world.simTimeMode);
    const activeSpeedIndex = Math.max(0, Math.min(activeSpeedOptions.length - 1, world.timeSpeedIndex ?? 0));
    const speedValue = getResolvedTimeSpeedValue(world);
    const speedLabel = formatTimeSpeedValue(speedValue);
    const timeModeLabel = world.simTimeMode === "incident" ? "Incident" : "Strategic";
    const advanceToNextEventActive = !!world.advanceToNextEvent;
    const canAdvanceToNextEvent = isAdvanceToNextEventAvailable(world);
    const usingSlider = world.timeSpeedControlMode === "slider";
    const effectivelyPaused = isSimulationEffectivelyPaused(world);
    const timeSummaryKey = `${effectivelyPaused}|${timeModeLabel}|${speedLabel}|${world.phase}|${advanceToNextEventActive}|${canAdvanceToNextEvent}`;
    if (timeSummaryKey !== lastTimeSummaryKey) {
      lastTimeSummaryKey = timeSummaryKey;
      timeSummary.innerHTML = "";
      const timeLine = document.createElement("div");
      timeLine.textContent = effectivelyPaused ? "State Paused" : "State Running";
      const speedLine = document.createElement("div");
      speedLine.textContent = `${timeModeLabel} ${speedLabel}`;
      const phaseLine = document.createElement("div");
      phaseLine.textContent = `Phase ${world.phase}`;
      const advanceLine = document.createElement("div");
      advanceLine.textContent = advanceToNextEventActive
        ? "Advancing to next event..."
        : canAdvanceToNextEvent
          ? "Next event advance ready"
          : "Next event advance unavailable";
      timeSummary.append(timeLine, speedLine, phaseLine, advanceLine);
    }
    pauseButton.textContent = world.paused ? ">" : "||";
    pauseButton.title = world.paused ? "Resume simulation" : "Pause simulation";
    pauseButton.setAttribute("aria-label", world.paused ? "Resume simulation" : "Pause simulation");
    const displayedSpeedIndices = getDisplayedTimeSpeedIndices(activeSpeedOptions);
    speedButtons.forEach((button, slot) => {
      button.classList.toggle("hidden", usingSlider);
      const index = displayedSpeedIndices[slot];
      if (index === undefined || index < 0 || index >= activeSpeedOptions.length) {
        button.disabled = true;
        button.classList.add("hidden");
        return;
      }
      const buttonLabel = formatTimeSpeedValue(activeSpeedOptions[index] ?? 1);
      button.classList.remove("hidden");
      button.disabled = false;
      button.dataset.speedIndex = String(index);
      button.dataset.speedLabel = buttonLabel;
      button.textContent = slot === speedButtons.length - 1 && index === activeSpeedOptions.length - 1 ? ">>" : buttonLabel;
      button.classList.toggle("is-active", index === activeSpeedIndex);
      const speedLabelText = button.dataset.speedLabel ?? button.textContent ?? "";
      button.title = `Set ${timeModeLabel.toLowerCase()} speed to ${speedLabelText}`;
      button.setAttribute("aria-label", `Set ${timeModeLabel.toLowerCase()} speed to ${speedLabelText}`);
    });
    speedSliderWrap.classList.toggle("hidden", !usingSlider);
    speedSlider.value = `${speedValue}`;
    speedSlider.title = `Set ${timeModeLabel.toLowerCase()} speed to ${speedLabel}`;
    speedSlider.setAttribute("aria-label", `Set ${timeModeLabel.toLowerCase()} speed`);
    speedSliderValue.textContent = speedLabel;
    advanceToNextEventButton.disabled = !canAdvanceToNextEvent || advanceToNextEventActive;
    advanceToNextEventButton.textContent = advanceToNextEventActive ? "..." : ">>>";
    if (advanceToNextEventActive) {
      advanceToNextEventButton.title = "Advancing time to next enabled event.";
      advanceToNextEventButton.setAttribute("aria-label", "Seeking next event");
    } else if (canAdvanceToNextEvent) {
      advanceToNextEventButton.title = "Advance time until the next enabled event.";
      advanceToNextEventButton.setAttribute("aria-label", "Advance to next event");
    } else {
      advanceToNextEventButton.title = "Available when fire activity has fully cleared.";
      advanceToNextEventButton.setAttribute("aria-label", "Advance to next event unavailable");
    }
    applyDockCardStates();
  };

  let lastUnitTrayUpdateAt = -Infinity;
  let hoveredSquadSlotId: number | null = null;
  let hoveredSquadMarkerId: number | null = null;

  const getSquadTrucks = (commandUnit: RenderSim["commandUnits"][number]): RenderSim["units"] =>
    commandUnit.truckIds
      .map((truckId) => world.units.find((entry) => entry.id === truckId && entry.kind === "truck") ?? null)
      .filter((entry): entry is RenderSim["units"][number] => !!entry)
      .sort((left, right) => (left.rosterId ?? left.id) - (right.rosterId ?? right.id));

  const getCommandLabel = (value: CommandPlacementMode | CommandFireTask | null): string => {
    if (!value) {
      return "Auto";
    }
    const label = value === "hold_fire" ? "Hold Fire" : value;
    return `${label[0]!.toUpperCase()}${label.slice(1)}`;
  };

  const getSquadStatusLabel = (status: CommandUnitStatus): string => `${status[0]!.toUpperCase()}${status.slice(1)}`;

  const getSquadStatusIcon = (status: CommandUnitStatus): string => {
    if (status === "suppressing") {
      return "SUP";
    }
    if (status === "moving") {
      return "MOV";
    }
    if (status === "boarding") {
      return "BRD";
    }
    if (status === "deploying") {
      return "DEP";
    }
    if (status === "retreating") {
      return "RT";
    }
    return "HLD";
  };

  const getSquadAlertPriority = (alert: CommandUnitAlert): number => {
    switch (alert) {
      case "danger":
      case "empty":
      case "critical":
        return 3;
      case "warning":
      case "crew_low":
      case "hose_unstaffed":
      case "crew_transition":
      case "deploy_required":
      case "out_of_range":
      case "holding_fire":
        return 2;
      case "driver_missing":
        return 3;
      case "low":
        return 1;
      default:
        return 0;
    }
  };

  const getSquadAlertText = (alert: CommandUnitAlert): string => {
    switch (alert) {
      case "danger":
        return "Danger";
      case "empty":
        return "Empty";
      case "critical":
        return "Critical";
      case "warning":
        return "Warning";
      case "crew_low":
        return "Crew";
      case "driver_missing":
        return "No Driver";
      case "hose_unstaffed":
        return "No Hose";
      case "crew_transition":
        return "Crew Moving";
      case "deploy_required":
        return "Deploy";
      case "out_of_range":
        return "Out of Range";
      case "holding_fire":
        return "Hold Fire";
      case "low":
        return "Low";
      default:
        return "Alert";
    }
  };

  const resolveHighestSquadAlert = (alerts: readonly CommandUnitAlert[]): CommandUnitAlert | null => {
    let best: CommandUnitAlert | null = null;
    let bestPriority = -1;
    alerts.forEach((alert) => {
      const priority = getSquadAlertPriority(alert);
      if (priority > bestPriority) {
        bestPriority = priority;
        best = alert;
      }
    });
    return best;
  };

  const resolveMajoritySquadStatus = (trucks: RenderSim["units"]): CommandUnitStatus => {
    const counts = new Map<CommandUnitStatus, number>();
    trucks.forEach((truck) => counts.set(truck.currentStatus, (counts.get(truck.currentStatus) ?? 0) + 1));
    const priority: CommandUnitStatus[] = ["retreating", "suppressing", "deploying", "boarding", "moving", "holding"];
    let bestStatus: CommandUnitStatus = "holding";
    let bestCount = -1;
    priority.forEach((status) => {
      const count = counts.get(status) ?? 0;
      if (count > bestCount) {
        bestStatus = status;
        bestCount = count;
      }
    });
    return bestStatus;
  };

  const resolveInterpolatedUnitPosition = (unit: RenderSim["units"][number]): { x: number; y: number } => {
    const alpha = clamp01(simulationAlpha);
    return {
      x: unit.prevX + (unit.x - unit.prevX) * alpha,
      y: unit.prevY + (unit.y - unit.prevY) * alpha
    };
  };

  const dispatchSelectionAction = (action: string, payload?: Record<string, string>): void => {
    dispatchPhaseUiCommand({ type: "action", action, payload });
  };

  const dispatchStatusCommand = (message: string): void => {
    dispatchPhaseUiCommand({ type: "status", message });
  };

  const unitCommandTray = createUnitCommandTray({
    onAction: dispatchSelectionAction,
    onStatus: dispatchStatusCommand,
    onSquadHover: (commandUnitId) => {
      hoveredSquadSlotId = commandUnitId;
    }
  });
  unitTrayRoot.append(unitCommandTray.element);

  const dispatchMapPrimaryCommand = (
    tile: { x: number; y: number },
    options?: { shiftKey?: boolean; altKey?: boolean }
  ): void => {
    dispatchPhaseUiCommand({
      type: "map-primary",
      tile,
      shiftKey: options?.shiftKey,
      altKey: options?.altKey
    });
  };

  const dispatchClearFuelBreakCommand = (tile: { x: number; y: number }): void => {
    dispatchPhaseUiCommand({ type: "map-clear-fuel-break", tile });
  };

  const dispatchRetaskCommand = (tile: { x: number; y: number }): void => {
    dispatchPhaseUiCommand({ type: "map-retask", tile });
  };

  const dispatchFormationCommand = (
    start: { x: number; y: number },
    end: { x: number; y: number },
    projection = inputState.formationProjection
  ): void => {
    dispatchPhaseUiCommand({ type: "map-formation", start, end, projection: projection ?? undefined });
  };

  const dispatchTownAlertCommand = (townId: number, direction: "raise" | "lower"): boolean => {
    const town = world.towns.find((entry) => entry.id === townId) ?? null;
    if (!town) {
      return false;
    }
    const previousPosture = town.alertPosture;
    const previousCooldown = town.alertCooldownDays;
    const previousEvacState = town.evacState;
    dispatchPhaseUiCommand({ type: "town-alert", townId, direction });
    return (
      town.alertPosture !== previousPosture ||
      town.alertCooldownDays !== previousCooldown ||
      town.evacState !== previousEvacState
    );
  };

  const dispatchTownEvacuationCommand = (
    townId: number,
    type: "town-evac-select" | "town-evac-cancel" | "town-evac-issue" | "town-evac-return"
  ): boolean => {
    const town = world.towns.find((entry) => entry.id === townId) ?? null;
    if (!town) {
      return false;
    }
    const previousStatus = town.evacuationStatus;
    const previousPoint = town.selectedEvacuationPoint
      ? `${town.selectedEvacuationPoint.x}:${town.selectedEvacuationPoint.y}`
      : "";
    dispatchPhaseUiCommand({ type, townId });
    const nextPoint = town.selectedEvacuationPoint
      ? `${town.selectedEvacuationPoint.x}:${town.selectedEvacuationPoint.y}`
      : "";
    return town.evacuationStatus !== previousStatus || previousPoint !== nextPoint;
  };

  const selectAndPanToSquad = (
    commandUnit: RenderSim["commandUnits"][number],
    anchor: SquadMarkerAnchor,
    options?: { toggle?: boolean; append?: boolean }
  ): void => {
    const payload: Record<string, string> = {};
    if (options?.toggle) {
      payload.toggle = "1";
    }
    if (options?.append) {
      payload.append = "1";
    }
    payload.commandUnitId = String(commandUnit.id);
    dispatchSelectionAction("select-command-unit", payload);
    dispatchPhaseUiCommand({
      type: "minimap-pan",
      tile: {
        x: Math.floor(anchor.x),
        y: Math.floor(anchor.y)
      }
    });
  };

  const removeSquadMarker = (commandUnitId: number): void => {
    const entry = squadMarkerElements.get(commandUnitId);
    if (!entry) {
      return;
    }
    entry.connector.remove();
    entry.root.remove();
    squadMarkerElements.delete(commandUnitId);
    squadMarkerAnchors.delete(commandUnitId);
  };

  const ensureSquadMarker = (commandUnitId: number): SquadMarkerElements => {
    const existing = squadMarkerElements.get(commandUnitId);
    if (existing) {
      return existing;
    }
    const root = document.createElement("button");
    root.type = "button";
    root.className = "three-test-squad-marker hidden";
    const header = document.createElement("div");
    header.className = "three-test-squad-marker-header";
    const icon = document.createElement("span");
    icon.className = "three-test-squad-marker-icon";
    icon.textContent = "SQ";
    const name = document.createElement("span");
    name.className = "three-test-squad-marker-name";
    const status = document.createElement("span");
    status.className = "three-test-squad-marker-status";
    const meta = document.createElement("span");
    meta.className = "three-test-squad-marker-meta";
    const connector = document.createElement("div");
    connector.className = "three-test-squad-marker-connector";
    header.append(icon, name, status);
    root.append(header, meta);
    root.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    root.addEventListener("mouseenter", () => {
      hoveredSquadMarkerId = commandUnitId;
      unitCommandTray.update(world, inputState, hoveredSquadMarkerId);
    });
    root.addEventListener("mouseleave", () => {
      hoveredSquadMarkerId = null;
      unitCommandTray.update(world, inputState, hoveredSquadMarkerId);
    });
    root.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const commandUnit = world.commandUnits.find((entry) => entry.id === commandUnitId) ?? null;
      const anchor = squadMarkerAnchors.get(commandUnitId) ?? null;
      if (!commandUnit || !anchor) {
        return;
      }
      selectAndPanToSquad(commandUnit, anchor, { toggle: event.shiftKey });
    });
    squadMarkerOverlayRoot.append(root, connector);
    const created: SquadMarkerElements = { root, connector, icon, name, meta, status };
    squadMarkerElements.set(commandUnitId, created);
    return created;
  };

  const updateUnitTrayOverlay = (time: number): void => {
    if (!THREE_TEST_DISABLE_HUD) {
      unitTrayRoot.classList.add("hidden");
      return;
    }
    if (time - lastUnitTrayUpdateAt < UNIT_TRAY_UPDATE_INTERVAL_MS) {
      return;
    }
    lastUnitTrayUpdateAt = time;
    unitTrayRoot.classList.remove("hidden");
    unitCommandTray.update(world, inputState, hoveredSquadMarkerId);
  };

  const resolveSquadMarkerAnchor = (
    commandUnitId: number,
    trucks: RenderSim["units"]
  ): SquadMarkerAnchor | null => {
    if (trucks.length <= 0) {
      return null;
    }
    const positions = trucks.map((truck) => resolveInterpolatedUnitPosition(truck));
    const average = positions.reduce(
      (sum, position) => ({ x: sum.x + position.x / positions.length, y: sum.y + position.y / positions.length }),
      { x: 0, y: 0 }
    );
    const maxDistance = positions.reduce(
      (max, position) => Math.max(max, Math.hypot(position.x - average.x, position.y - average.y)),
      0
    );
    const target =
      maxDistance > SQUAD_MARKER_DISPERSED_RADIUS_TILES
        ? positions[0]!
        : average;
    const previous = squadMarkerAnchors.get(commandUnitId) ?? null;
    if (!previous) {
      return { ...target };
    }
    return {
      x: previous.x + (target.x - previous.x) * SQUAD_MARKER_SMOOTHING_ALPHA,
      y: previous.y + (target.y - previous.y) * SQUAD_MARKER_SMOOTHING_ALPHA
    };
  };

  const updateSquadMarkerOverlay = (): void => {
    if (!lastTerrainSurface || !lastTerrainSize) {
      squadMarkerOverlayRoot.classList.add("hidden");
      squadMarkerElements.forEach((entry) => {
        entry.root.classList.add("hidden");
        entry.connector.style.display = "none";
      });
      return;
    }

    const commandUnits = [...world.commandUnits].sort((left, right) => left.id - right.id);
    if (commandUnits.length <= 0) {
      squadMarkerOverlayRoot.classList.add("hidden");
      Array.from(squadMarkerElements.keys()).forEach((commandUnitId) => removeSquadMarker(commandUnitId));
      return;
    }

    squadMarkerOverlayRoot.classList.remove("hidden");
    const labelLift = SQUAD_MARKER_LIFT_METERS / Math.max(0.001, TILE_SIZE);
    const occlusionMaxLift = Math.max(
      labelLift,
      lastTerrainSurface.heightScale * 1.45,
      TOWN_LABEL_OCCLUSION_MAX_LIFT_METERS / Math.max(0.001, TILE_SIZE)
    );
    const viewportWidth = Math.max(1, hudState.viewport.width);
    const viewportHeight = Math.max(1, hudState.viewport.height);
    const markerWorld = new THREE.Vector3();
    const connectorWorld = new THREE.Vector3();
    const markerProjected = new THREE.Vector3();
    const connectorProjected = new THREE.Vector3();
    const liveIds = new Set<number>();
    const layoutEntries: SquadMarkerLayoutEntry[] = [];

    for (const commandUnit of commandUnits) {
      const trucks = getSquadTrucks(commandUnit);
      if (trucks.length <= 0) {
        continue;
      }
      liveIds.add(commandUnit.id);
      const anchor = resolveSquadMarkerAnchor(commandUnit.id, trucks);
      if (!anchor) {
        continue;
      }
      squadMarkerAnchors.set(commandUnit.id, anchor);
      const entry = ensureSquadMarker(commandUnit.id);
      const selected =
        world.selectedCommandUnitIds.includes(commandUnit.id) ||
        (world.selectionScope === "truck" && world.focusedCommandUnitId === commandUnit.id);
      const highlighted = selected || hoveredSquadSlotId === commandUnit.id || hoveredSquadMarkerId === commandUnit.id;
      const aggregateAlerts = trucks.flatMap((truck) => truck.currentAlerts);
      const highestAlert = resolveHighestSquadAlert(aggregateAlerts);
      const effectiveStatus = resolveMajoritySquadStatus(trucks);
      const intentLabel = commandUnit.currentIntent
        ? `${getCommandLabel(commandUnit.currentIntent.placementMode)} | ${getCommandLabel(commandUnit.currentIntent.fireTask)}`
        : "Auto";
      const worldX = lastTerrainSurface.toWorldX(anchor.x);
      const worldZ = lastTerrainSurface.toWorldZ(anchor.y);
      const groundY = lastTerrainSurface.heightAtTileCoord(anchor.x, anchor.y) * lastTerrainSurface.heightScale;
      const labelLayout = resolveTownLabelDepthAwareLayout({
        camera,
        surface: lastTerrainSurface,
        worldX,
        groundY,
        worldZ,
        baseLift: labelLift,
        maxLift: occlusionMaxLift,
        verticalClearance: TOWN_LABEL_OCCLUSION_VERTICAL_CLEARANCE,
        labelClearance: TOWN_LABEL_OCCLUSION_LABEL_CLEARANCE,
        connectorClearance: TOWN_LABEL_CONNECTOR_CLEARANCE,
        sampleCount: TOWN_LABEL_OCCLUSION_SAMPLE_COUNT
      });
      connectorWorld.set(worldX, labelLayout.connectorY, worldZ);
      markerWorld.set(worldX, labelLayout.labelY, worldZ);
      markerProjected.copy(markerWorld).project(camera);
      connectorProjected.copy(connectorWorld).project(camera);
      const isVisible =
        markerProjected.z > -1 &&
        markerProjected.z < 1 &&
        markerProjected.x >= -1.1 &&
        markerProjected.x <= 1.1 &&
        markerProjected.y >= -1.2 &&
        markerProjected.y <= 1.2;
      entry.name.textContent = commandUnit.name;
      entry.status.textContent = getSquadStatusIcon(effectiveStatus);
      entry.status.dataset.status = effectiveStatus;
      entry.status.title = getSquadStatusLabel(effectiveStatus);
      entry.meta.textContent = `${trucks.length} unit${trucks.length === 1 ? "" : "s"} | ${intentLabel}`;
      entry.root.classList.toggle("is-selected", selected);
      entry.root.classList.toggle("is-hovered", highlighted && !selected);
      entry.root.classList.toggle("has-alert", !!highestAlert);
      entry.root.dataset.alert = highestAlert ? (getSquadAlertPriority(highestAlert) >= 3 ? "critical" : "warning") : "none";
      entry.root.title = `${commandUnit.name} squad. ${trucks.length} unit(s). ${getSquadStatusLabel(effectiveStatus)}. ${intentLabel}${
        highestAlert ? `. ${getSquadAlertText(highestAlert)} warning` : ""
      }. Click to select and center the camera.`;
      entry.root.setAttribute("aria-label", entry.root.title);
      if (!isVisible) {
        entry.root.classList.add("hidden");
        entry.connector.style.display = "none";
        continue;
      }

      const screenX = (markerProjected.x * 0.5 + 0.5) * viewportWidth;
      const screenY = (-markerProjected.y * 0.5 + 0.5) * viewportHeight;
      const depth01 = clamp01((markerProjected.z + 1) * 0.5);
      const zIndex = Math.max(1, Math.min(TOWN_LABEL_MAX_Z_INDEX, Math.round((1 - depth01) * TOWN_LABEL_MAX_Z_INDEX)));
      entry.root.classList.remove("hidden");
      const rootWidth = Math.max(136, entry.root.offsetWidth);
      const rootHeight = Math.max(42, entry.root.offsetHeight);
      const connectorScreenX = (connectorProjected.x * 0.5 + 0.5) * viewportWidth;
      const connectorScreenY = (-connectorProjected.y * 0.5 + 0.5) * viewportHeight;
      const isConnectorProjectedVisible =
        connectorProjected.z > -1 &&
        connectorProjected.z < 1 &&
        connectorProjected.x >= -1.5 &&
        connectorProjected.x <= 1.5 &&
        connectorProjected.y >= -1.5 &&
        connectorProjected.y <= 1.5;
      layoutEntries.push({
        commandUnitId: commandUnit.id,
        anchorScreenX: screenX,
        anchorScreenY: isConnectorProjectedVisible ? connectorScreenY : screenY,
        baseRootY: screenY + SQUAD_MARKER_SCREEN_OFFSET_Y,
        rootWidth,
        rootHeight,
        zIndex,
        selected: highlighted,
        distanceSq: camera.position.distanceToSquared(markerWorld)
      });
    }

    Array.from(squadMarkerElements.keys()).forEach((commandUnitId) => {
      if (!liveIds.has(commandUnitId)) {
        removeSquadMarker(commandUnitId);
      }
    });

    if (layoutEntries.length <= 0) {
      squadMarkerOverlayRoot.classList.add("hidden");
      return;
    }

    layoutEntries.sort((a, b) => {
      if (a.selected !== b.selected) {
        return a.selected ? -1 : 1;
      }
      if (a.distanceSq !== b.distanceSq) {
        return a.distanceSq - b.distanceSq;
      }
      return a.commandUnitId - b.commandUnitId;
    });

    const placedEntries: Array<{ anchorScreenX: number; baseRootY: number; stackDepth: number }> = [];
    for (const layout of layoutEntries) {
      const entry = squadMarkerElements.get(layout.commandUnitId);
      if (!entry) {
        continue;
      }
      let stackDepth = 0;
      for (const placed of placedEntries) {
        const sameCluster =
          Math.abs(layout.anchorScreenX - placed.anchorScreenX) <= SQUAD_MARKER_CLUSTER_X_PX &&
          Math.abs(layout.baseRootY - placed.baseRootY) <= SQUAD_MARKER_CLUSTER_Y_PX;
        if (sameCluster) {
          stackDepth = Math.max(stackDepth, placed.stackDepth + 1);
        }
      }
      const rootX = layout.anchorScreenX - layout.rootWidth * 0.5;
      const rootY = layout.baseRootY - stackDepth * SQUAD_MARKER_STACK_OFFSET_PX;
      entry.root.style.zIndex = `${layout.selected ? layout.zIndex + 2 : layout.zIndex}`;
      entry.root.style.transform = `translate3d(${rootX.toFixed(1)}px, ${rootY.toFixed(1)}px, 0)`;
      const connectorStartY = Math.max(rootY + layout.rootHeight - 3, rootY + 10);
      const connectorLength = layout.anchorScreenY - connectorStartY;
      if (connectorLength >= 6) {
        entry.connector.style.display = "block";
        entry.connector.style.height = `${connectorLength.toFixed(1)}px`;
        entry.connector.style.zIndex = `${Math.max(1, layout.zIndex - 1)}`;
        entry.connector.style.transform = `translate3d(${(layout.anchorScreenX - 1).toFixed(1)}px, ${connectorStartY.toFixed(1)}px, 0)`;
      } else {
        entry.connector.style.display = "none";
      }
      placedEntries.push({
        anchorScreenX: layout.anchorScreenX,
        baseRootY: layout.baseRootY,
        stackDepth
      });
    }
  };

  const getTownCenterX = (town: Town): number => (Number.isFinite(town.cx) ? town.cx : town.x);
  const getTownCenterY = (town: Town): number => (Number.isFinite(town.cy) ? town.cy : town.y);

  const getThreatClass = (town: Town): string => {
    const level = getTownThreatLevel(world, town);
    if (level === "watch") {
      return "is-watch";
    }
    if (level === "high") {
      return "is-high";
    }
    if (level === "critical") {
      return "is-critical";
    }
    return "is-low";
  };

  const getTownById = (townId: number): Town | null => {
    if (!Number.isInteger(townId) || townId < 0) {
      return null;
    }
    const direct = townId < world.towns.length ? world.towns[townId] : undefined;
    if (direct && direct.id === townId) {
      return direct;
    }
    for (const town of world.towns) {
      if (town.id === townId) {
        return town;
      }
    }
    return null;
  };

  const focusCameraOnTile = (tileX: number, tileY: number): void => {
    if (!lastTerrainSurface) {
      return;
    }
    const cols = Math.max(1, world.grid.cols);
    const rows = Math.max(1, world.grid.rows);
    const clampedX = Math.max(0, Math.min(cols - 1, Math.floor(tileX)));
    const clampedY = Math.max(0, Math.min(rows - 1, Math.floor(tileY)));
    const worldX = lastTerrainSurface.toWorldX(clampedX + 0.5);
    const worldZ = lastTerrainSurface.toWorldZ(clampedY + 0.5);
    const worldY = lastTerrainSurface.heightAtTile(clampedX, clampedY) * lastTerrainSurface.heightScale;
    const target = new THREE.Vector3(worldX, worldY, worldZ);
    const currentDistance = Math.max(0.001, camera.position.distanceTo(controls.target));
    const desiredDistance = Math.max(
      controls.minDistance * 1.3,
      Math.min(controls.maxDistance, currentDistance * 0.62)
    );
    // 45-degree downward view: vertical offset equals horizontal offset.
    const horizontalDistance = desiredDistance / Math.SQRT2;
    const verticalDistance = desiredDistance / Math.SQRT2;
    const heading = camera.position.clone().sub(controls.target);
    heading.y = 0;
    if (heading.lengthSq() < 1e-6) {
      heading.set(1, 0, 1);
    }
    heading.normalize().multiplyScalar(horizontalDistance);
    const endPosition = new THREE.Vector3(target.x + heading.x, target.y + verticalDistance, target.z + heading.z);
    const startTarget = controls.target.clone();
    const startPosition = camera.position.clone();
    const travel =
      startPosition.distanceTo(endPosition) +
      startTarget.distanceTo(target) * 0.85;
    const durationMs = Math.max(420, Math.min(1100, travel * 190));
    cameraFlight = {
      startedAt: performance.now(),
      durationMs,
      startTarget,
      startPosition,
      endTarget: target,
      endPosition,
      arcLift: 0
    };
    markCameraMotion();
  };

  const focusCameraOnTown = (townId: number): void => {
    const town = getTownById(townId);
    if (!town) {
      return;
    }
    focusCameraOnTile(Math.floor(getTownCenterX(town)), Math.floor(getTownCenterY(town)));
  };

  const focusCameraOnBase = (): void => {
    const hqTownId = resolveHeadquartersTownId(world);
    if (hqTownId !== null) {
      focusCameraOnTown(hqTownId);
      return;
    }
    focusCameraOnTile(Math.floor(world.basePoint.x), Math.floor(world.basePoint.y));
  };

  const readTownMaintenanceData = (town: Town): { clearTreesCost: number; clearTreesDays: number; upgradeCost: number; upgradeDays: number } => {
    const maybeTown = town as Town & {
      clearTreesCost?: number;
      clearTreesDays?: number;
      upgradeEquipmentCost?: number;
      upgradeEquipmentDays?: number;
    };
    const clearTreesCost = Number.isFinite(maybeTown.clearTreesCost)
      ? Math.max(0, Math.round(maybeTown.clearTreesCost!))
      : TOWN_CLEAR_TREES_COST_DEFAULT;
    const clearTreesDays = Number.isFinite(maybeTown.clearTreesDays)
      ? Math.max(1, Math.round(maybeTown.clearTreesDays!))
      : TOWN_CLEAR_TREES_DAYS_DEFAULT;
    const upgradeCost = Number.isFinite(maybeTown.upgradeEquipmentCost)
      ? Math.max(0, Math.round(maybeTown.upgradeEquipmentCost!))
      : TOWN_UPGRADE_EQUIP_COST_DEFAULT;
    const upgradeDays = Number.isFinite(maybeTown.upgradeEquipmentDays)
      ? Math.max(1, Math.round(maybeTown.upgradeEquipmentDays!))
      : TOWN_UPGRADE_EQUIP_DAYS_DEFAULT;
    return { clearTreesCost, clearTreesDays, upgradeCost, upgradeDays };
  };

  const readTownUiSnapshot = (town: Town): TownUiSnapshot => {
    const threatLevel = getTownThreatLevel(world, town);
    const threatLabel = getTownThreatLabel(threatLevel);
    const threatClass = getThreatClass(town);
    const posture = Math.max(0, Math.min(TOWN_ALERT_MAX_POSTURE, Math.trunc(town.alertPosture ?? 0)));
    const postureLabel = getTownPostureLabel(posture);
    const cooldown = Math.max(0, town.alertCooldownDays ?? 0);
    const houses = Math.max(0, Math.floor(town.houseCount ?? 0));
    const burning = getTownBurningHouseCount(world, town.id);
    const lost = Math.max(0, Math.floor(town.housesLost ?? 0));
    const nonApproving = Math.max(0, Math.min(houses, Math.round(town.nonApprovingHouseCount ?? 0)));
    const approvalPct = Math.round(Math.max(0, Math.min(1, town.approval ?? 1)) * 100);
    const evacPct = Math.round(Math.max(0, Math.min(1, town.evacProgress ?? 0)) * 100);
    const maintenance = readTownMaintenanceData(town);
    const populationRemaining = Math.max(0, Math.floor(town.populationRemaining ?? 0));
    const populationEvacuating = Math.max(0, Math.floor(town.populationEvacuating ?? 0));
    const populationEvacuated = Math.max(0, Math.floor(town.populationEvacuated ?? 0));
    const populationDead = Math.max(0, Math.floor(town.populationDead ?? 0));
    return {
      threatLevel,
      threatLabel,
      threatClass,
      posture,
      postureLabel,
      cooldown,
      houses,
      burning,
      lost,
      approvalPct,
      nonApproving,
      evacState: town.evacState,
      evacPct,
      evacuationStatus: town.evacuationStatus ?? "None",
      populationRemaining,
      populationEvacuating,
      populationEvacuated,
      populationDead,
      vehiclesQueued: Math.max(0, Math.floor(town.vehiclesQueued ?? 0)),
      vehiclesMoving: Math.max(0, Math.floor(town.vehiclesMoving ?? 0)),
      vehiclesDestroyed: Math.max(0, Math.floor(town.vehiclesDestroyed ?? 0)),
      hasSelectedEvacuationPoint: !!town.selectedEvacuationPoint,
      clearTreesCost: maintenance.clearTreesCost,
      clearTreesDays: maintenance.clearTreesDays,
      upgradeCost: maintenance.upgradeCost,
      upgradeDays: maintenance.upgradeDays
    };
  };

  const formatTownIconRow = (snapshot: TownUiSnapshot, includeEvac = false): string => {
    let row = `${TOWN_ICON_HOUSES}${snapshot.houses}  ${TOWN_ICON_BURNING}${snapshot.burning}  ${TOWN_ICON_LOST}${snapshot.lost}  ${TOWN_ICON_APPROVAL}${snapshot.approvalPct}%`;
    if (includeEvac && snapshot.evacuationStatus !== "None" && snapshot.evacuationStatus !== "Cancelled") {
      row += `  ${TOWN_ICON_EVAC}${snapshot.populationEvacuated}/${Math.max(1, snapshot.populationRemaining + snapshot.populationEvacuated + snapshot.populationDead)}`;
    }
    return row;
  };

  const formatTownHoverPeekRow = (snapshot: TownUiSnapshot): string => {
    const totalHouses = Math.max(snapshot.houses, snapshot.houses + snapshot.lost);
    return `H=${snapshot.houses}/${totalHouses} F=${snapshot.burning} AP=${snapshot.approvalPct}%`;
  };

  const getCompactAlertLabel = (posture: number): string => {
    if (posture >= 3) {
      return "EMERGENCY";
    }
    if (posture >= 2) {
      return "WATCH+ACT";
    }
    if (posture >= 1) {
      return "ADVICE";
    }
    return "NO ALERT";
  };

  const clearTownHoverDelay = (): void => {
    if (hoverDelayHandle !== null) {
      window.clearTimeout(hoverDelayHandle);
      hoverDelayHandle = null;
    }
  };

  const scheduleTownHoverPeek = (townId: number): void => {
    if (pinnedTownCards.has(townId)) {
      return;
    }
    hoverTownId = townId;
    clearTownHoverDelay();
    hoverDelayHandle = window.setTimeout(() => {
      hoverDelayHandle = null;
      if (hoverTownId !== townId || selectedTownId === townId) {
        return;
      }
      hoverPeekTownId = townId;
      updateTownMetrics();
    }, TOWN_LABEL_HOVER_DELAY_MS);
  };

  const clearTownHoverPeek = (townId: number): void => {
    if (hoverTownId === townId) {
      hoverTownId = null;
    }
    clearTownHoverDelay();
    if (hoverPeekTownId === townId) {
      hoverPeekTownId = null;
      updateTownMetrics();
    }
  };

  const closeTownFacility = (): void => {
    selectedFacility = null;
    facilityPanelElements.root.classList.add("hidden");
    facilityPanelElements.content.replaceChildren();
    refreshWatchTowerOverlay();
  };

  const closeTownFacilityForTown = (townId: number): void => {
    if (selectedFacility?.townId === townId) {
      closeTownFacility();
    }
  };

  const openTownFacility = (townId: number, facilityId: string): void => {
    const town = getTownById(townId);
    if (!town) {
      closeTownFacility();
      return;
    }
    openTownCard(townId);
    selectedFacility = { townId, facilityId };
    const facility = collectTownFacilities(world, town).find((entry) => entry.id === facilityId) ?? null;
    activeFacilityTabs.set(
      facilityId,
      activeFacilityTabs.get(facilityId) ?? (facility?.type === "hq" ? "squads" : "overview")
    );
    updateTownMetrics();
    refreshWatchTowerOverlay();
  };

  const renderSelectedFacilityPanel = (): void => {
    if (!selectedFacility) {
      facilityPanelElements.root.classList.add("hidden");
      return;
    }
    const town = getTownById(selectedFacility.townId);
    if (!town) {
      closeTownFacility();
      return;
    }
    const facility = collectTownFacilities(world, town).find((entry) => entry.id === selectedFacility?.facilityId) ?? null;
    if (!facility) {
      closeTownFacility();
      return;
    }
    renderFacilityPanel(
      facilityPanelElements,
      world,
      town,
      facility,
      activeFacilityTabs.get(facility.id) ?? (facility.type === "hq" ? "squads" : "overview"),
      (action, payload) => {
        playUiCue("confirm");
        inputState.lastInteractionTime = performance.now();
        dispatchSelectionAction(action, payload);
        updateTownMetrics();
      },
      (tabId) => {
        activeFacilityTabs.set(facility.id, tabId);
        updateTownMetrics();
      }
    );
  };

  const openHeadquartersFacility = (): boolean => {
    const hqTownId = resolveHeadquartersTownId(world);
    if (hqTownId === null) {
      return false;
    }
    const town = getTownById(hqTownId);
    if (!town) {
      return false;
    }
    const facility = collectTownFacilities(world, town).find((entry) => entry.type === "hq") ?? null;
    if (!facility) {
      return false;
    }
    openTownFacility(hqTownId, facility.id);
    return true;
  };

  const updateTownCardLayout = (townId: number, snapshot: TownUiSnapshot, card: TownCardElements): void => {
    const town = getTownById(townId);
    if (!town) {
      card.root.classList.add("hidden");
      return;
    }
    card.name.textContent = town.name;
    const facilities = collectTownFacilities(world, town);
    const selectedFacilityId = selectedFacility?.townId === town.id ? selectedFacility.facilityId : null;
    card.hqBadge.classList.toggle("hidden", !isHeadquartersTown(world, town.id));
    renderTownFacilitiesSection(card.facilitiesSection, facilities, selectedFacilityId, (facility: TownFacilityDescriptor) => {
      playUiCue("click");
      inputState.lastInteractionTime = performance.now();
      openTownFacility(town.id, facility.id);
    });
    card.dot.className = `three-test-town-dot ${snapshot.threatClass}`;
    card.dot.title = `Fire threat: ${snapshot.threatLabel}`;
    card.postureChip.className = `three-test-town-card-chip posture-${snapshot.posture}`;
    card.postureChip.textContent = `${TOWN_ICON_WARNING}${snapshot.posture}`;
    card.postureChip.title = `Warning level: ${snapshot.postureLabel}`;
    card.approvalChip.textContent = `${TOWN_ICON_APPROVAL}${snapshot.approvalPct}%`;
    card.approvalChip.title = `Approval: ${snapshot.approvalPct}%`;
    if (snapshot.cooldown > 0) {
      card.cooldownChip.textContent = `${TOWN_ICON_COOLDOWN}${snapshot.cooldown.toFixed(1)}d`;
      card.cooldownChip.title = `Cooldown ${snapshot.cooldown.toFixed(1)}d`;
      card.cooldownChip.classList.remove("hidden");
    } else {
      card.cooldownChip.classList.add("hidden");
    }
    const compactAlertLabel = getCompactAlertLabel(snapshot.posture);
    card.summaryText.textContent = formatTownHoverPeekRow(snapshot);
    card.summaryAlert.className = `three-test-town-alert-badge alert-${snapshot.posture}`;
    card.summaryAlert.textContent = `[${compactAlertLabel}]`;
    card.summary.title = `Houses ${snapshot.houses}/${Math.max(snapshot.houses, snapshot.houses + snapshot.lost)}, Burning ${snapshot.burning}, Approval ${snapshot.approvalPct}%, Alert ${snapshot.postureLabel}`;
    if (snapshot.evacuationStatus === "PointSelected") {
      card.evac.textContent = `${TOWN_ICON_EVAC} route selected`;
      card.evac.title = "Evacuation route selected";
      card.evac.classList.remove("hidden");
    } else if (snapshot.evacuationStatus === "Evacuating" || snapshot.evacuationStatus === "EvacuationOrdered") {
      card.evac.textContent = `${TOWN_ICON_EVAC}${snapshot.populationEvacuated} out  ${snapshot.populationEvacuating} moving  ${snapshot.vehiclesQueued} queued`;
      card.evac.title = `Evacuating: ${snapshot.populationEvacuated} evacuated, ${snapshot.populationDead} dead, ${snapshot.vehiclesDestroyed} vehicles destroyed`;
      card.evac.classList.remove("hidden");
    } else if (snapshot.evacuationStatus === "Completed") {
      card.evac.textContent = `${TOWN_ICON_EVAC}${snapshot.populationEvacuated} evacuated`;
      card.evac.title = "Evacuation complete; evacuees are waiting at the selected destination";
      card.evac.classList.remove("hidden");
    } else if (snapshot.evacuationStatus === "Returning") {
      card.evac.textContent = `${TOWN_ICON_EVAC}${snapshot.populationEvacuating} returning  ${snapshot.vehiclesQueued} queued`;
      card.evac.title = "Evacuees returning home along the locked route";
      card.evac.classList.remove("hidden");
    } else if (snapshot.evacuationStatus === "Returned") {
      card.evac.textContent = `${TOWN_ICON_EVAC}returned home`;
      card.evac.title = "Evacuees returned home";
      card.evac.classList.remove("hidden");
    } else if (snapshot.evacuationStatus === "Failed") {
      card.evac.textContent = `${TOWN_ICON_EVAC}${snapshot.populationDead} dead`;
      card.evac.title = "Evacuation failed";
      card.evac.classList.remove("hidden");
    } else {
      card.evac.classList.add("hidden");
    }

    const evacuationLocked =
      snapshot.evacuationStatus === "EvacuationOrdered" ||
      snapshot.evacuationStatus === "Evacuating" ||
      snapshot.evacuationStatus === "Returning" ||
      snapshot.evacuationStatus === "Completed" ||
      snapshot.evacuationStatus === "Returned" ||
      snapshot.evacuationStatus === "Failed";
    card.selectEvacDestinationButton.disabled = evacuationLocked;
    card.issueEvacuationButton.disabled = !snapshot.hasSelectedEvacuationPoint || evacuationLocked;
    card.returnEvacuationButton.disabled =
      snapshot.evacuationStatus !== "Completed" || snapshot.populationEvacuated <= 0;
    card.cancelEvacuationButton.disabled = snapshot.evacuationStatus !== "PointSelected";
    card.selectEvacDestinationMeta.textContent = snapshot.hasSelectedEvacuationPoint ? "selected" : "";
    card.issueEvacuationMeta.textContent = snapshot.hasSelectedEvacuationPoint && !evacuationLocked ? "order" : "";
    card.returnEvacuationMeta.textContent =
      snapshot.evacuationStatus === "Completed" && snapshot.populationEvacuated > 0 ? "home" : "";
    card.cancelEvacuationMeta.textContent = snapshot.evacuationStatus === "PointSelected" ? "clear" : "";
    card.selectEvacDestinationButton.title = "Select evacuation destination";
    card.issueEvacuationButton.title = "Issue evacuation";
    card.returnEvacuationButton.title = "Return evacuees home";
    card.cancelEvacuationButton.title = "Cancel evacuation selection";

    card.upgradeMeta.textContent = `${TOWN_ICON_COST}${snapshot.upgradeCost}  ${TOWN_ICON_TIME}${snapshot.upgradeDays}d`;
    card.upgradeButton.title = `Invest in firefighting equipment (${TOWN_ICON_COST}${snapshot.upgradeCost} ${TOWN_ICON_TIME}${snapshot.upgradeDays}d)`;
  };

  const syncFocusedTown = (): void => {
    if (selectedTownId !== null) {
      focusedTownId = selectedTownId;
      baseFocused = false;
      return;
    }
    if (focusedTownId !== null && pinnedTownCards.has(focusedTownId)) {
      baseFocused = false;
      return;
    }
    const firstPinned = pinnedTownCards.keys().next();
    focusedTownId = firstPinned.done ? null : firstPinned.value;
    if (focusedTownId !== null) {
      baseFocused = false;
    }
  };

  const removePinnedTownCard = (townId: number): void => {
    const card = pinnedTownCards.get(townId);
    if (!card) {
      return;
    }
    closeTownFacilityForTown(townId);
    card.root.remove();
    pinnedTownCards.delete(townId);
    if (focusedTownId === townId) {
      focusedTownId = null;
    }
    syncFocusedTown();
  };

  const bindTownCardHandlers = (
    card: TownCardElements,
    resolveTownId: () => number | null,
    isPinnedCard: boolean
  ): void => {
    card.root.addEventListener("mouseenter", () => {
      playUiCue("hover");
    });
    card.selectEvacDestinationButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("confirm");
      const townId = resolveTownId();
      if (townId === null) {
        return;
      }
      if (dispatchTownEvacuationCommand(townId, "town-evac-select")) {
        inputState.lastInteractionTime = performance.now();
      }
      updateTownMetrics();
    });
    card.issueEvacuationButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("confirm");
      const townId = resolveTownId();
      if (townId === null) {
        return;
      }
      if (dispatchTownEvacuationCommand(townId, "town-evac-issue")) {
        inputState.lastInteractionTime = performance.now();
      }
      updateTownMetrics();
    });
    card.returnEvacuationButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("confirm");
      const townId = resolveTownId();
      if (townId === null) {
        return;
      }
      if (dispatchTownEvacuationCommand(townId, "town-evac-return")) {
        inputState.lastInteractionTime = performance.now();
      }
      updateTownMetrics();
    });
    card.cancelEvacuationButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("toggle");
      const townId = resolveTownId();
      if (townId === null) {
        return;
      }
      if (dispatchTownEvacuationCommand(townId, "town-evac-cancel")) {
        inputState.lastInteractionTime = performance.now();
      }
      updateTownMetrics();
    });
    card.upgradeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("click");
      inputState.lastInteractionTime = performance.now();
    });
    card.pinButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("toggle");
      const townId = resolveTownId();
      if (townId === null) {
        return;
      }
      if (isPinnedCard) {
        removePinnedTownCard(townId);
        updateTownMetrics();
        return;
      }
      if (!pinnedTownCards.has(townId)) {
        const pinnedCard = createTownCardElements(true);
        bindTownCardHandlers(pinnedCard, () => townId, true);
        pinnedTownCards.set(townId, pinnedCard);
      }
      selectedTownId = null;
      focusedTownId = townId;
      syncFocusedTown();
      updateTownMetrics();
    });
    card.focusButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("click");
      const townId = resolveTownId();
      if (townId === null) {
        return;
      }
      inputState.lastInteractionTime = performance.now();
      focusCameraOnTown(townId);
    });
    card.closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("click");
      const townId = resolveTownId();
      if (townId === null) {
        return;
      }
      if (isPinnedCard) {
        removePinnedTownCard(townId);
      } else if (selectedTownId === townId) {
        closeTownFacilityForTown(townId);
        selectedTownId = null;
      }
      syncFocusedTown();
      updateTownMetrics();
    });
    card.root.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
      const townId = resolveTownId();
      if (townId === null) {
        return;
      }
      focusedTownId = townId;
      syncFocusedTown();
      updateTownMetrics();
    });
  };

  bindTownCardHandlers(townCardElements, () => selectedTownId, false);
  facilityPanelElements.root.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  facilityPanelElements.closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("click");
    closeTownFacility();
    updateTownMetrics();
  });

  const dispatchBaseAction = (action: string): void => {
    dispatchPhaseUiCommand({ type: "action", action });
  };
  fireAlertCardElements.root.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
  });
  fireAlertCardElements.zoomButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("click");
    if (!activeFireAlertTile) {
      return;
    }
    inputState.lastInteractionTime = performance.now();
    focusCameraOnTile(activeFireAlertTile.x, activeFireAlertTile.y);
  });
  fireAlertCardElements.openTownButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("click");
    if (activeFireAlertTownId === null) {
      return;
    }
    inputState.lastInteractionTime = performance.now();
    openTownCard(activeFireAlertTownId);
  });
  fireAlertCardElements.deployTruckButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("confirm");
    dispatchBaseAction("squad-dispatch");
  });
  fireAlertCardElements.deployCrewButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("confirm");
    openHeadquartersFacility();
  });
  fireAlertCardElements.dismissButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("click");
    if (visibleFireAlertId !== null) {
      dismissedFireAlertId = visibleFireAlertId;
    }
    activeFireAlertTownId = null;
    activeFireAlertTile = null;
    fireAlertCardElements.root.classList.add("hidden");
  });

  const updateBaseCardState = (): void => {
    if (!baseAnchor) {
      baseCardElements.root.classList.add("hidden");
      baseCardElements.connector.style.display = "none";
      baseCardElements.cardRoot.classList.add("hidden");
      return;
    }
    const snapshot = worldCardState.get(baseCardId);
    baseCardElements.cardRoot.classList.toggle("hidden", snapshot.visual !== "expanded");
    baseCardElements.root.classList.toggle("is-selected", snapshot.visual === "expanded");
    baseCardElements.root.classList.toggle("is-hover-peek", snapshot.visual === "peek");
    baseCardElements.cardRoot.classList.toggle("is-focused", baseFocused);
    baseCardElements.cardRoot.classList.toggle("is-dimmed", (focusedTownId !== null || baseFocused) && !baseFocused);
    applyPinButtonState(baseCardElements.pinButton, snapshot.pinned);
  };

  const setBaseCardOpenInternal = (open: boolean): void => {
    if (open) {
      worldCardState.clickExpand(baseCardId);
      baseFocused = true;
      closeTownFacility();
      selectedTownId = null;
      focusedTownId = null;
    } else {
      worldCardState.setPinned(baseCardId, false);
      worldCardState.collapse(baseCardId);
      if (baseFocused) {
        baseFocused = false;
      }
      syncFocusedTown();
    }
    updateBaseCardState();
    updateTownMetrics();
  };

  baseCardElements.mainButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("click");
    openHeadquartersFacility();
  });
  baseCardElements.root.addEventListener("mouseenter", () => {
    playUiCue("hover");
    worldCardState.hoverEnter(baseCardId);
    updateBaseCardState();
  });
  baseCardElements.root.addEventListener("mouseleave", () => {
    worldCardState.hoverLeave(baseCardId);
    updateBaseCardState();
  });
  baseCardElements.cardRoot.addEventListener("pointerdown", (event) => {
    event.stopPropagation();
    baseFocused = true;
    closeTownFacility();
    selectedTownId = null;
    focusedTownId = null;
    updateTownMetrics();
    updateBaseCardState();
  });
  baseCardElements.pinButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("toggle");
    const pinned = worldCardState.togglePin(baseCardId);
    baseFocused = true;
    closeTownFacility();
    selectedTownId = null;
    focusedTownId = null;
    if (!pinned) {
      worldCardState.collapse(baseCardId);
      baseFocused = false;
      syncFocusedTown();
    }
    updateBaseCardState();
    updateTownMetrics();
  });
  baseCardElements.focusButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("click");
    inputState.lastInteractionTime = performance.now();
    focusCameraOnBase();
  });
  baseCardElements.closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("click");
    worldCardState.setPinned(baseCardId, false);
    worldCardState.collapse(baseCardId);
    baseFocused = false;
    syncFocusedTown();
    updateBaseCardState();
    updateTownMetrics();
  });
  baseCardElements.deployTruckButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchBaseAction("deploy-truck");
  });
  baseCardElements.deployFirefighterButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchBaseAction("deploy-firefighter");
  });
  baseCardElements.recruitTruckButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchBaseAction("recruit-truck");
  });
  baseCardElements.recruitFirefighterButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchBaseAction("recruit-firefighter");
  });
  baseCardElements.trainSpeedButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchBaseAction("train-speed");
  });
  baseCardElements.trainPowerButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchBaseAction("train-power");
  });
  baseCardElements.trainRangeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchBaseAction("train-range");
  });
  baseCardElements.trainResilienceButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchBaseAction("train-resilience");
  });

  const getAnchoredCardPosition = (
    anchor: TownScreenAnchor,
    cardWidth: number,
    cardHeight: number,
    viewportWidth: number,
    viewportHeight: number
  ): { x: number; y: number } => {
    const viewportPadding = 8;
    const anchorGap = 10;
    let x = anchor.rootX;
    // Keep expanded card vertically aligned with the billboard anchor by default.
    let y = anchor.rootY;
    if (y + cardHeight > viewportHeight - viewportPadding) {
      y = anchor.rootY - cardHeight - anchorGap;
    }
    if (x + cardWidth > viewportWidth - viewportPadding) {
      x = viewportWidth - cardWidth - viewportPadding;
    }
    x = Math.max(viewportPadding, x);
    const maxY = Math.max(viewportPadding, viewportHeight - cardHeight - viewportPadding);
    y = Math.max(viewportPadding, Math.min(maxY, y));
    return { x, y };
  };

  const updateTownCardPosition = (viewportWidth: number, viewportHeight: number): void => {
    const placeCard = (townId: number, card: TownCardElements): void => {
      const anchor = townAnchors.get(townId);
      if (!anchor) {
        card.root.classList.add("hidden");
        return;
      }
      const measuredWidth = card.root.offsetWidth;
      const measuredHeight = card.root.offsetHeight;
      const cardWidth = Math.max(292, measuredWidth > 0 ? measuredWidth : 336);
      const cardHeight = Math.max(180, measuredHeight > 0 ? measuredHeight : 238);
      const { x, y } = getAnchoredCardPosition(
        anchor,
        cardWidth,
        cardHeight,
        viewportWidth,
        viewportHeight
      );
      card.root.classList.remove("hidden");
      card.root.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      card.root.style.zIndex = `${Math.max(2, anchor.zIndex + 2)}`;
    };

    if (selectedTownId !== null && !pinnedTownCards.has(selectedTownId)) {
      placeCard(selectedTownId, townCardElements);
    } else {
      townCardElements.root.classList.add("hidden");
    }
    pinnedTownCards.forEach((card, townId) => {
      placeCard(townId, card);
    });

    if (selectedFacility !== null) {
      const anchor = townAnchors.get(selectedFacility.townId);
      if (!anchor) {
        facilityPanelElements.root.classList.add("hidden");
        return;
      }
      const townCard = pinnedTownCards.get(selectedFacility.townId) ?? townCardElements;
      const townCardWidth = Math.max(292, townCard.root.offsetWidth > 0 ? townCard.root.offsetWidth : 336);
      const townCardHeight = Math.max(180, townCard.root.offsetHeight > 0 ? townCard.root.offsetHeight : 238);
      const townCardPosition = getAnchoredCardPosition(anchor, townCardWidth, townCardHeight, viewportWidth, viewportHeight);
      const panelWidth = Math.max(292, facilityPanelElements.root.offsetWidth > 0 ? facilityPanelElements.root.offsetWidth : 340);
      const panelHeight = Math.max(220, facilityPanelElements.root.offsetHeight > 0 ? facilityPanelElements.root.offsetHeight : 360);
      const gap = 10;
      let x = townCardPosition.x + townCardWidth + gap;
      if (x + panelWidth > viewportWidth - 8) {
        x = townCardPosition.x - panelWidth - gap;
      }
      if (x < 8) {
        x = Math.max(8, viewportWidth - panelWidth - 8);
      }
      const y = Math.max(8, Math.min(viewportHeight - panelHeight - 8, townCardPosition.y));
      facilityPanelElements.root.classList.remove("hidden");
      facilityPanelElements.root.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
      facilityPanelElements.root.style.zIndex = `${Math.max(4, anchor.zIndex + 5)}`;
    } else {
      facilityPanelElements.root.classList.add("hidden");
    }
  };

  const toggleTownCard = (townId: number): void => {
    hoverPeekTownId = null;
    clearTownHoverDelay();
    const previousTownId = selectedTownId ?? selectedFacility?.townId ?? null;
    if (pinnedTownCards.has(townId)) {
      selectedTownId = null;
      focusedTownId = townId;
    } else {
      selectedTownId = selectedTownId === townId ? null : townId;
      focusedTownId = selectedTownId;
    }
    if (selectedTownId !== townId || (previousTownId !== null && previousTownId !== townId)) {
      closeTownFacility();
    }
    syncFocusedTown();
    updateTownMetrics();
  };

  const openTownCard = (townId: number): void => {
    const town = getTownById(townId);
    if (!town) {
      return;
    }
    baseFocused = false;
    hoverPeekTownId = null;
    clearTownHoverDelay();
    if (selectedFacility && selectedFacility.townId !== town.id) {
      closeTownFacility();
    }
    if (pinnedTownCards.has(town.id)) {
      selectedTownId = null;
      focusedTownId = town.id;
    } else {
      selectedTownId = town.id;
      focusedTownId = town.id;
    }
    syncFocusedTown();
    updateTownMetrics();
  };

  const removeTownLabel = (townId: number): void => {
    const entry = townLabelElements.get(townId);
    if (!entry) {
      return;
    }
    clearTownHoverPeek(townId);
    removePinnedTownCard(townId);
    townAnchors.delete(townId);
    entry.connector.remove();
    entry.root.remove();
    townLabelElements.delete(townId);
    closeTownFacilityForTown(townId);
    if (focusedTownId === townId) {
      focusedTownId = null;
    }
  };

  const ensureTownLabels = (): void => {
    const liveIds = new Set<number>();
    for (const town of world.towns) {
      const townId = town.id;
      liveIds.add(townId);
      if (townLabelElements.has(townId)) {
        continue;
      }
      const root = document.createElement("div");
      root.className = "three-test-town-nameplate";
      const connector = document.createElement("div");
      connector.className = "three-test-town-connector";
      const mainButton = document.createElement("button");
      mainButton.type = "button";
      mainButton.className = "three-test-town-nameplate-main-btn";
      const compact = document.createElement("div");
      compact.className = "three-test-town-nameplate-main";
      const dot = document.createElement("span");
      dot.className = "three-test-town-dot is-low";
      const name = document.createElement("span");
      name.className = "three-test-town-name";
      const hqBadge = document.createElement("span");
      hqBadge.className = "three-test-town-hq-badge hidden";
      hqBadge.textContent = "HQ";
      hqBadge.title = "Headquarters";
      const meta = document.createElement("div");
      meta.className = "three-test-town-nameplate-meta";
      const metaText = document.createElement("span");
      metaText.className = "three-test-town-summary-text";
      const metaAlert = document.createElement("span");
      metaAlert.className = "three-test-town-alert-badge alert-0";
      meta.append(metaText, metaAlert);
      compact.append(dot, name, hqBadge);
      mainButton.append(compact);
      root.append(mainButton, meta);
      const clearTownLabelFocus = (): void => {
        const activeElement = document.activeElement;
        if (activeElement instanceof HTMLElement && root.contains(activeElement)) {
          activeElement.blur();
        }
      };
      mainButton.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        playUiCue("click");
        baseFocused = false;
        toggleTownCard(townId);
        if (selectedTownId !== townId && !root.matches(":hover")) {
          clearTownLabelFocus();
        }
      });
      root.addEventListener("mouseenter", () => {
        scheduleTownHoverPeek(townId);
      });
      root.addEventListener("mouseleave", () => {
        clearTownHoverPeek(townId);
        if (selectedTownId !== townId) {
          clearTownLabelFocus();
        }
      });
      townOverlayRoot.append(root, connector);
      townLabelElements.set(townId, {
        root,
        connector,
        mainButton,
        dot,
        name,
        hqBadge,
        meta,
        metaText,
        metaAlert
      });
    }
    const staleIds = Array.from(townLabelElements.keys());
    for (const townId of staleIds) {
      if (!liveIds.has(townId)) {
        removeTownLabel(townId);
      }
    }
    if (selectedTownId !== null && !liveIds.has(selectedTownId)) {
      closeTownFacilityForTown(selectedTownId);
      selectedTownId = null;
      syncFocusedTown();
      updateTownMetrics();
    }
    if (selectedFacility !== null && !liveIds.has(selectedFacility.townId)) {
      closeTownFacility();
    }
  };

  const updateTownMetrics = (): void => {
    const hasFocusedTown = focusedTownId !== null || baseFocused;
    for (const town of world.towns) {
      const entry = townLabelElements.get(town.id);
      if (!entry) {
        continue;
      }
      const snapshot = readTownUiSnapshot(town);
      const selected = selectedTownId === town.id;
      const pinnedCard = pinnedTownCards.get(town.id) ?? null;
      const showHoverPeek = hoverPeekTownId === town.id && !selected && !pinnedCard;
      const highlighted = selected || !!pinnedCard;
      const compactAlertLabel = getCompactAlertLabel(snapshot.posture);
      entry.dot.className = `three-test-town-dot ${snapshot.threatClass}`;
      entry.name.textContent = town.name;
      const isHq = isHeadquartersTown(world, town.id);
      entry.hqBadge.classList.toggle("hidden", !isHq);
      entry.metaText.textContent = formatTownHoverPeekRow(snapshot);
      entry.metaAlert.className = `three-test-town-alert-badge alert-${snapshot.posture}`;
      entry.metaAlert.textContent = `[${compactAlertLabel}]`;
      entry.meta.title = `Houses ${snapshot.houses}/${Math.max(snapshot.houses, snapshot.houses + snapshot.lost)}, Burning ${snapshot.burning}, Approval ${snapshot.approvalPct}%, Alert ${snapshot.postureLabel}`;
      entry.root.dataset.threat = snapshot.threatLevel;
      entry.root.classList.toggle("is-selected", highlighted);
      entry.root.classList.toggle("is-hover-peek", showHoverPeek);
      entry.root.classList.toggle("is-dimmed", hasFocusedTown && focusedTownId !== town.id);
      entry.connector.classList.toggle("is-dimmed", hasFocusedTown && focusedTownId !== town.id);
      if (selected && !pinnedCard) {
        applyPinButtonState(townCardElements.pinButton, false);
        townCardElements.root.classList.toggle("is-focused", focusedTownId === town.id && !baseFocused);
        townCardElements.root.classList.toggle("is-dimmed", hasFocusedTown && focusedTownId !== town.id);
        updateTownCardLayout(town.id, snapshot, townCardElements);
      }
      if (pinnedCard) {
        applyPinButtonState(pinnedCard.pinButton, true);
        pinnedCard.root.classList.toggle("is-focused", focusedTownId === town.id && !baseFocused);
        pinnedCard.root.classList.toggle("is-dimmed", hasFocusedTown && focusedTownId !== town.id);
        updateTownCardLayout(town.id, snapshot, pinnedCard);
      }
    }
    if (selectedTownId === null || pinnedTownCards.has(selectedTownId)) {
      townCardElements.root.classList.add("hidden");
    }
    renderSelectedFacilityPanel();
  };

  const findCurrentStrongestFireTile = (): { x: number; y: number } | null => {
    if (world.fireActivityState === "idle" && !world.fireBoundsActive) {
      return null;
    }
    const cols = world.grid.cols;
    const rows = world.grid.rows;
    const minX = world.fireBoundsActive ? Math.max(0, world.fireMinX) : 0;
    const maxX = world.fireBoundsActive ? Math.min(cols - 1, world.fireMaxX) : cols - 1;
    const minY = world.fireBoundsActive ? Math.max(0, world.fireMinY) : 0;
    const maxY = world.fireBoundsActive ? Math.min(rows - 1, world.fireMaxY) : rows - 1;
    let bestScore = 0;
    let bestTile: { x: number; y: number } | null = null;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const idx = indexFor(world.grid, x, y);
        const fire = world.tileFire[idx] ?? 0;
        const heat = world.tileHeat[idx] ?? 0;
        const heatRelease = world.tileHeatRelease[idx] ?? 0;
        const score = fire * 2 + heat * 0.15 + heatRelease * 0.22;
        if (score <= 0) {
          continue;
        }
        if (score > bestScore || !bestTile) {
          bestScore = score;
          bestTile = { x, y };
        }
      }
    }
    return bestTile;
  };

  const updateFireAlertCard = (): void => {
    const alert = world.latestFireAlert;
    if (!alert) {
      visibleFireAlertId = null;
      activeFireAlertTownId = null;
      activeFireAlertTile = null;
      fireAlertCardElements.root.classList.add("hidden");
      return;
    }
    if (dismissedFireAlertId === alert.id) {
      activeFireAlertTownId = null;
      activeFireAlertTile = null;
      fireAlertCardElements.root.classList.add("hidden");
      return;
    }
    visibleFireAlertId = alert.id;
    activeFireAlertTile = { x: alert.tileX, y: alert.tileY };
    activeFireAlertTownId = alert.townId >= 0 ? alert.townId : null;
    const town = activeFireAlertTownId !== null ? getTownById(activeFireAlertTownId) : null;
    if (town) {
      const snapshot = readTownUiSnapshot(town);
      fireAlertCardElements.summary.textContent =
        alert.message ?? `${town.name} | Tile ${alert.tileX},${alert.tileY}`;
      fireAlertCardElements.details.textContent =
        `${alert.reportState === "confirmed" ? "Confirmed" : "Suspected"} fire | Confidence ${alert.confidenceLabel ?? "Medium"} | Houses ${snapshot.houses} | Alert ${snapshot.postureLabel}`;
      fireAlertCardElements.openTownButton.disabled = false;
      fireAlertCardElements.openTownButton.title = `Open ${town.name} card`;
    } else {
      fireAlertCardElements.summary.textContent = alert.message ?? `Incident Tile ${alert.tileX},${alert.tileY}`;
      fireAlertCardElements.details.textContent =
        `${alert.reportState === "confirmed" ? "Confirmed" : "Suspected"} fire | Confidence ${alert.confidenceLabel ?? "Medium"}`;
      fireAlertCardElements.openTownButton.disabled = true;
      fireAlertCardElements.openTownButton.title = "No nearby town for this incident.";
    }
    fireAlertCardElements.root.classList.remove("hidden");
  };

  const hideHoverDebugBillboard = (): void => {
    hoverDebugRoot.classList.add("hidden");
    hoverDebugConnector.style.display = "none";
    hoverDebugTileHighlight.visible = false;
  };

  const hoverDebugToneRank: Record<HoverDebugTone, number> = {
    default: 0,
    watch: 1,
    high: 2,
    critical: 3
  };

  const mergeHoverDebugTone = (current: HoverDebugTone, next?: HoverDebugTone): HoverDebugTone => {
    if (!next) {
      return current;
    }
    return hoverDebugToneRank[next] > hoverDebugToneRank[current] ? next : current;
  };

  const updateHoverDebugTileHighlight = (
    tileX: number,
    tileY: number,
    tone: HoverDebugTone,
    tileId: number
  ): void => {
    if (!lastTerrainSurface) {
      hoverDebugTileHighlight.visible = false;
      return;
    }
    const surface = lastTerrainSurface;
    const inset = HOVER_DEBUG_TILE_BORDER_INSET;
    const setVertex = (index: number, gridX: number, gridY: number): void => {
      const offset = index * 3;
      hoverDebugTileHighlightPositions[offset] = surface.toWorldX(gridX);
      hoverDebugTileHighlightPositions[offset + 1] =
        surface.heightAtTileCoord(gridX, gridY) * surface.heightScale + HOVER_DEBUG_TILE_BORDER_LIFT;
      hoverDebugTileHighlightPositions[offset + 2] = surface.toWorldZ(gridY);
    };
    setVertex(0, tileX, tileY);
    setVertex(1, tileX + 1, tileY);
    setVertex(2, tileX + 1, tileY + 1);
    setVertex(3, tileX, tileY + 1);
    setVertex(4, tileX + inset, tileY + inset);
    setVertex(5, tileX + 1 - inset, tileY + inset);
    setVertex(6, tileX + 1 - inset, tileY + 1 - inset);
    setVertex(7, tileX + inset, tileY + 1 - inset);
    const positionAttribute = hoverDebugTileHighlightGeometry.getAttribute("position");
    if (positionAttribute) {
      positionAttribute.needsUpdate = true;
    }
    hoverDebugTileHighlightMaterial.color.setHex(resolveHoverDebugTileHighlightHex(tileId, tone));
    hoverDebugTileHighlight.visible = true;
  };

  const formatWaterfallStatus = (flags: number, debug: WaterfallDebugData, sampleIdx: number): string => {
    if ((flags & WATERFALL_DEBUG_FLAG_WATER) === 0) {
      return "dry";
    }
    if ((flags & WATERFALL_DEBUG_FLAG_RIVER) === 0) {
      return "not-river";
    }
    const parts: string[] = [];
    if (flags & WATERFALL_DEBUG_FLAG_OCEANISH) {
      parts.push("oceanish");
    }
    if ((flags & WATERFALL_DEBUG_FLAG_STEP_OK) === 0) {
      parts.push(`step<${formatDebugNumber(debug.stepThreshold, 2)}`);
    } else if ((flags & WATERFALL_DEBUG_FLAG_BEST_DROP_OK) === 0) {
      parts.push(`best<${formatDebugNumber(debug.minDrop, 2)}`);
    } else if ((flags & WATERFALL_DEBUG_FLAG_LOCAL_DROP_OK) === 0) {
      parts.push(`local<${formatDebugNumber(debug.localDropThreshold, 2)}`);
    } else if (Number.isFinite(debug.verticality[sampleIdx]) && (debug.verticality[sampleIdx] ?? 0) < WATERFALL_VERTICALITY_MIN) {
      parts.push(`vertical<${formatDebugNumber(WATERFALL_VERTICALITY_MIN, 2)}`);
    } else if (
      Number.isFinite(debug.runToPool[sampleIdx]) &&
      Number.isFinite(debug.runLimit[sampleIdx]) &&
      (debug.runToPool[sampleIdx] ?? 0) > (debug.runLimit[sampleIdx] ?? Number.POSITIVE_INFINITY)
    ) {
      parts.push(`run>${formatDebugNumber(debug.runLimit[sampleIdx] ?? Number.NaN, 2)}`);
    } else {
      parts.push("pass");
    }
    if (flags & WATERFALL_DEBUG_FLAG_CANDIDATE) {
      parts.push("candidate");
    }
    if (flags & WATERFALL_DEBUG_FLAG_EMITTED) {
      parts.push("emitted");
    }
    return parts.join(" | ");
  };

  type NearestWaterfallInstance = {
    index: number;
    distanceTiles: number;
    gridX: number;
    gridY: number;
    drop: number;
    width: number;
    top: number;
    dirX: number;
    dirZ: number;
  };

  const findNearestWaterfallInstance = (
    hoverGridX: number,
    hoverGridY: number,
    sample: TerrainSample
  ): NearestWaterfallInstance | null => {
    const spans = lastTerrainWater?.inland?.surface.waterfalls;
    if (!spans || spans.length === 0 || !lastTerrainSize) {
      return null;
    }
    let best: NearestWaterfallInstance | null = null;
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i];
      const gridX = span.sourceIndex % sample.cols;
      const gridY = Math.floor(span.sourceIndex / sample.cols);
      const distanceTiles = Math.hypot(gridX - hoverGridX, gridY - hoverGridY);
      if (best && distanceTiles >= best.distanceTiles) {
        continue;
      }
      best = {
        index: i,
        distanceTiles,
        gridX,
        gridY,
        top: span.topWorldY,
        drop: span.dropWorld,
        dirX: span.flowWorldX,
        dirZ: span.flowWorldZ,
        width: span.halfWidthWorld
      };
    }
    return best;
  };

  const getUnitsAtTile = (tileX: number, tileY: number): Array<(typeof world.units)[number]> => {
    return world.units.filter((unit) => {
      if (unit.kind === "firefighter" && unit.carrierId !== null) {
        return false;
      }
      return Math.floor(unit.x) === tileX && Math.floor(unit.y) === tileY;
    });
  };

  const resolveHouseRotationForDebug = (
    tileX: number,
    tileY: number,
    seed: number,
    tileTypes: ArrayLike<number>,
    roadEdges: ArrayLike<number> | undefined,
    cols: number,
    rows: number
  ): number => {
    const isRoadLike = (x: number, y: number): boolean => {
      if (x < 0 || y < 0 || x >= cols || y >= rows) {
        return false;
      }
      const typeId = tileTypes[y * cols + x] ?? -1;
      return typeId === TILE_TYPE_IDS.road || typeId === TILE_TYPE_IDS.base;
    };
    const reference = findBestRoadReferenceForPlot(
      tileX,
      tileY,
      isRoadLike,
      (x, y) => {
        if (!roadEdges || x < 0 || y < 0 || x >= cols || y >= rows) {
          return 0;
        }
        return roadEdges[y * cols + x] ?? 0;
      }
    );
    return pickHouseRotationFromRoadMask(reference?.roadMask ?? 0, seed);
  };

  const computeHoverBiomeShape = (
    tileX: number,
    tileY: number,
    tileIndex: number,
    heightScale: number
  ): { slope: number; relief: number; renderGrade: number; renderAngleDeg: number } => {
    const center = world.tileElevation[tileIndex] ?? world.tiles[tileIndex]?.elevation ?? 0;
    let maxCardinalDiff = 0;
    let minElevation = center;
    let maxElevation = center;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = tileY + dy;
      if (ny < 0 || ny >= world.grid.rows) {
        continue;
      }
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = tileX + dx;
        if (nx < 0 || nx >= world.grid.cols || (dx === 0 && dy === 0)) {
          continue;
        }
        const nIdx = ny * world.grid.cols + nx;
        const neighbor = world.tileElevation[nIdx] ?? world.tiles[nIdx]?.elevation ?? center;
        minElevation = Math.min(minElevation, neighbor);
        maxElevation = Math.max(maxElevation, neighbor);
        if (Math.abs(dx) + Math.abs(dy) === 1) {
          maxCardinalDiff = Math.max(maxCardinalDiff, Math.abs(center - neighbor));
        }
      }
    }
    const tileSpan = lastTerrainSurface
      ? Math.min(
          lastTerrainSurface.width / Math.max(1, lastTerrainSurface.cols),
          lastTerrainSurface.depth / Math.max(1, lastTerrainSurface.rows)
        )
      : 1;
    const renderGrade = (maxCardinalDiff * heightScale) / Math.max(1e-4, tileSpan);
    return {
      slope: maxCardinalDiff,
      relief: maxElevation - minElevation,
      renderGrade,
      renderAngleDeg: (Math.atan(renderGrade) * 180) / Math.PI
    };
  };

  const buildHoverCellSection: HoverDebugSectionBuilder = (context) => {
    const tile = world.tiles[context.tileIndex];
    if (!tile) {
      return null;
    }
    const hoveredUnits = getUnitsAtTile(context.tileX, context.tileY);
    const cachedWetness = world.tileSuppressionWetness[context.tileIndex] ?? 0;
    const cachedBurnAge = world.tileBurnAge[context.tileIndex] ?? 0;
    const cachedHeatRelease = world.tileHeatRelease[context.tileIndex] ?? 0;
    const biomeShape = computeHoverBiomeShape(context.tileX, context.tileY, context.tileIndex, context.heightScale);
    const lines = [
      `type=${tile.type} id=${world.tileTypeId[context.tileIndex] ?? "n/a"} base=${tile.isBase ? "1" : "0"}`,
      `elev=${formatDebugNumber(world.tileElevation[context.tileIndex] ?? tile.elevation, 3)} y=${formatDebugNumber((world.tileElevation[context.tileIndex] ?? 0) * context.heightScale, 2)} moist=${formatDebugNumber(world.tileMoisture[context.tileIndex] ?? tile.moisture, 2)}`,
      `biome slope=${formatDebugNumber(biomeShape.slope, 3)} relief=${formatDebugNumber(biomeShape.relief, 3)} grade=${formatDebugNumber(biomeShape.renderGrade, 2)} angle=${formatDebugNumber(biomeShape.renderAngleDeg, 0)}deg`,
      `fire=${formatDebugNumber(world.tileFire[context.tileIndex] ?? tile.fire, 2)} heat=${formatDebugNumber(world.tileHeat[context.tileIndex] ?? tile.heat, 2)} fuel=${formatDebugNumber(world.tileFuel[context.tileIndex] ?? tile.fuel, 2)}`,
      `wet=${formatDebugNumber(cachedWetness, 2)} burnAge=${formatDebugNumber(cachedBurnAge, 2)} release=${formatDebugNumber(cachedHeatRelease, 2)}`
    ];
    if (hoveredUnits.length > 0) {
      const summary = hoveredUnits
        .slice(0, 2)
        .map((unit) => `${unit.kind === "truck" ? "T" : "C"}#${unit.id}${unit.selected ? "*" : ""}`)
        .join(" ");
      lines.push(`units=${summary}${hoveredUnits.length > 2 ? ` +${hoveredUnits.length - 2}` : ""}`);
    }
    const tileTypeId = world.tileTypeId[context.tileIndex] ?? -1;
    if (tileTypeId === TILE_TYPE_IDS.house && context.sample.tileTypes && lastTerrainSurface) {
      const seed = context.sample.houseStyleSeeds?.[context.tileIndex] ?? (context.tileIndex >>> 0);
      const rotation = resolveHouseRotationForDebug(
        context.tileX,
        context.tileY,
        seed,
        context.sample.tileTypes,
        context.sample.roadEdges,
        context.sample.cols,
        context.sample.rows
      );
      const footprint = pickHouseFootprint(seed);
      const bounds = getHouseFootprintBounds(context.tileX, context.tileY, rotation, footprint);
      const lifecycleStage = getBuildingLifecycleStageFromId(
        context.sample.houseLifecycleStages?.[context.tileIndex] ?? getBuildingLifecycleStageId("roofed")
      );
      const lifecycleStep = context.sample.houseLifecycleSteps?.[context.tileIndex] ?? 0;
      const grounding = resolveStructureGrounding({
        surface: context.sample,
        minTileX: Math.max(0, Math.min(context.sample.cols - 1, bounds.minX)),
        maxTileX: Math.max(0, Math.min(context.sample.cols - 1, bounds.maxX)),
        minTileY: Math.max(0, Math.min(context.sample.rows - 1, bounds.minY)),
        maxTileY: Math.max(0, Math.min(context.sample.rows - 1, bounds.maxY)),
        heightScale: lastTerrainSurface.heightScale,
        heightAtTileCoord: lastTerrainSurface.heightAtTileCoord
      });
      lines.push(`house=${footprint.name} roof=${footprint.roofType} stage=${lifecycleStage}:${lifecycleStep}`);
      lines.push(
        `bounds=${bounds.minX}..${bounds.maxX},${bounds.minY}..${bounds.maxY} footprint=${formatDebugNumber(bounds.width, 2)}x${formatDebugNumber(bounds.depth, 2)} rot=${formatDebugNumber((rotation * 180) / Math.PI, 0)}deg`
      );
      lines.push(
        `worldCenter=${formatDebugNumber(lastTerrainSurface.toWorldX(context.tileX + 0.5), 2)},${formatDebugNumber(lastTerrainSurface.toWorldZ(context.tileY + 0.5), 2)} foundation=${formatDebugNumber(grounding.foundationBottom, 2)}..${formatDebugNumber(grounding.foundationTop, 2)}`
      );
    }
    return {
      key: "cell",
      label: "CELL",
      lines
    };
  };

  const buildHoverWaterfallSection: HoverDebugSectionBuilder = (context) => {
    const debug = context.terrainWater?.waterfallDebug ?? null;
    const riverMask = context.sample.riverMask?.[context.tileIndex] ?? 0;
    const lakeId = context.sample.lakeMask?.[context.tileIndex] ?? 0;
    const oceanMask = context.sample.oceanMask?.[context.tileIndex] ?? 0;
    if (!debug && riverMask <= 0 && (world.tileTypeId[context.tileIndex] ?? -1) !== TILE_TYPE_IDS.water) {
      return null;
    }
    const sampleStep = Math.max(1, debug?.sampleStep ?? getTerrainStep(Math.max(context.sample.cols, context.sample.rows), context.sample.fullResolution ?? false));
    const sampleCols = debug?.sampleCols ?? Math.floor((context.sample.cols - 1) / sampleStep) + 1;
    const sampleRows = debug?.sampleRows ?? Math.floor((context.sample.rows - 1) / sampleStep) + 1;
    const sampleCol = Math.max(0, Math.min(sampleCols - 1, Math.floor(context.tileX / sampleStep)));
    const sampleRow = Math.max(0, Math.min(sampleRows - 1, Math.floor(context.tileY / sampleStep)));
    const sampleIdx = sampleRow * sampleCols + sampleCol;
    const flags = debug ? debug.flags[sampleIdx] ?? 0 : 0;
    const riverSurfaceRaw = context.sample.riverSurface?.[context.tileIndex];
    const riverSurfaceWorld = Number.isFinite(riverSurfaceRaw) ? (riverSurfaceRaw as number) * context.heightScale : Number.NaN;
    const lakeSurfaceRaw = context.sample.lakeSurface?.[context.tileIndex];
    const lakeSurfaceWorld = Number.isFinite(lakeSurfaceRaw) ? (lakeSurfaceRaw as number) * context.heightScale : Number.NaN;
    const tileStep = context.sample.riverStepStrength?.[context.tileIndex] ?? Number.NaN;
    const hoverGridX = context.hoverGrid?.x ?? context.tileX + 0.5;
    const hoverGridY = context.hoverGrid?.y ?? context.tileY + 0.5;
    const nearestInstance = findNearestWaterfallInstance(hoverGridX, hoverGridY, context.sample);
    const inlandDiagnostics = context.terrainWater?.inland?.surface.diagnostics;
    const terrainSeam = context.terrainWater?.inland?.surface.terrainSeam;
    const nearestSeam = terrainSeam
      ? findNearestInlandWaterTerrainSeamSegment(terrainSeam, hoverGridX, hoverGridY)
      : undefined;
    const lines = [
      `kind=${lakeId > 0 ? `lake#${lakeId}` : riverMask > 0 ? "river" : oceanMask > 0 ? "ocean" : "none"} riverY=${formatDebugNumber(riverSurfaceWorld, 2)} lakeY=${formatDebugNumber(lakeSurfaceWorld, 2)} tileStep=${formatDebugNumber(tileStep, 2)}`
    ];
    if (inlandDiagnostics) {
      lines.push(
        `seam originalMove=${formatDebugNumber(inlandDiagnostics.originalBoundaryDisplacementMax, 6)} preError=${formatDebugNumber(inlandDiagnostics.maximumPreConformanceError, 6)} unmatched=${inlandDiagnostics.unmatchedSeamVertexCount} tJunction=${inlandDiagnostics.seamTjunctionCount}`
      );
      lines.push(
        `shared=${inlandDiagnostics.sharedSegmentCount} degenerate=${inlandDiagnostics.degenerateBoundaryTriangleCount} skirtGap=${formatDebugNumber(inlandDiagnostics.skirtJointGapMax, 6)} guard=${formatDebugNumber(inlandDiagnostics.guardOverlapMin, 6)}`
      );
    }
    if (nearestSeam && terrainSeam) {
      const segment = nearestSeam.segment;
      const a = terrainSeam.vertices[segment.a];
      const b = terrainSeam.vertices[segment.b];
      const t = nearestSeam.t;
      const lerp = (left: number, right: number): number => left + (right - left) * t;
      const sourceTriangles = Array.from(new Set([...a.sourceTerrainTriangleIds, ...b.sourceTerrainTriangleIds]));
      lines.push(
        `segment=${segment.id} contour=${segment.sourceContourSegmentId} d=${formatDebugNumber(nearestSeam.distance, 4)} mouth=${segment.openToOcean ? 1 : 0}`
      );
      lines.push(
        `xz original=${formatDebugNumber(lerp(a.originalEdgeX, b.originalEdgeX), 4)},${formatDebugNumber(lerp(a.originalEdgeY, b.originalEdgeY), 4)} rendered=${formatDebugNumber(lerp(a.renderedEdgeX, b.renderedEdgeX), 4)},${formatDebugNumber(lerp(a.renderedEdgeY, b.renderedEdgeY), 4)} forced=${formatDebugNumber(Math.max(a.forcedDisplacementCells, b.forcedDisplacementCells), 6)}`
      );
      lines.push(
        `height terrain=${formatDebugNumber(lerp(a.terrainTopWorldY, b.terrainTopWorldY), 3)} water=${formatDebugNumber(lerp(a.waterWorldY, b.waterWorldY), 3)} skirt=${formatDebugNumber(lerp(a.skirtBottomWorldY, b.skirtBottomWorldY), 3)}`
      );
      lines.push(
        `sourceTri=${sourceTriangles.slice(0, 4).join("/") || "n/a"} normal=${a.normalClassification} uv=${a.uvClassification}`
      );
    }
    if (debug) {
      lines.push(
        `sample=${sampleCol},${sampleRow} step=${formatDebugNumber(debug.stepStrength[sampleIdx] ?? Number.NaN, 2)} best=${formatDebugNumber(debug.bestNeighborDrop[sampleIdx] ?? Number.NaN, 2)} local=${formatDebugNumber(debug.localDrop[sampleIdx] ?? Number.NaN, 2)}`
      );
      lines.push(
        `profile immediate=${formatDebugNumber(debug.immediateDrop[sampleIdx] ?? Number.NaN, 2)} total=${formatDebugNumber(debug.totalDrop[sampleIdx] ?? Number.NaN, 2)} vertical=${formatDebugNumber(debug.verticality[sampleIdx] ?? Number.NaN, 2)} run=${formatDebugNumber(debug.runToPool[sampleIdx] ?? Number.NaN, 2)}/${formatDebugNumber(debug.runLimit[sampleIdx] ?? Number.NaN, 2)}`
      );
      lines.push(
        `status=${lakeId > 0 && (flags & WATERFALL_DEBUG_FLAG_RIVER) === 0 ? "lake (not procedural river candidate)" : formatWaterfallStatus(flags, debug, sampleIdx)}`
      );
    } else {
      lines.push("status=no sampled waterfall debug");
    }
    if (nearestInstance) {
      lines.push(
        `fx#${nearestInstance.index} d=${formatDebugNumber(nearestInstance.distanceTiles, 2)} drop=${formatDebugNumber(nearestInstance.drop, 2)} width=${formatDebugNumber(nearestInstance.width, 2)} top=${formatDebugNumber(nearestInstance.top, 2)}`
      );
    } else {
      lines.push("fx=none emitted");
    }
    if (debug) {
      let summary = `emit=${debug.emittedCount}/${debug.candidateCount} clusters=${debug.clusterCount} lowVert=${debug.lowVerticalityRejectedCount} longRun=${debug.longRunRejectedCount}`;
      const riverStats = context.terrainWater?.inland?.mesh.debugRiverDomainStats;
      if (riverStats) {
        summary += ` anchorMax=${formatDebugNumber(riverStats.waterfallAnchorErrorMax, 3)}`;
      }
      lines.push(summary);
    }
    let tone: HoverDebugTone = "default";
    if (flags & WATERFALL_DEBUG_FLAG_EMITTED) {
      tone = "watch";
    } else if (flags & WATERFALL_DEBUG_FLAG_CANDIDATE) {
      tone = "watch";
    } else if ((flags & WATERFALL_DEBUG_FLAG_RIVER) && (flags & WATERFALL_DEBUG_FLAG_LOCAL_DROP_OK) === 0) {
      tone = "high";
    }
    return {
      key: "waterfall",
      label: "WATERFALL",
      lines,
      tone
    };
  };

  // Add builders here to extend the hover debug billboard for other systems.
  const hoverDebugSectionBuilders: HoverDebugSectionBuilder[] = [buildHoverCellSection, buildHoverWaterfallSection];

  const buildCellClipboardPayload = (
    tileX: number,
    tileY: number,
    hoverGrid: { x: number; y: number } | null
  ): string | null => {
    const tileIndex = indexFor(world.grid, tileX, tileY);
    const tile = world.tiles[tileIndex];
    if (!tile) {
      return null;
    }
    const sample = lastSample;
    const terrainSurface = lastTerrainSurface;
    const units = getUnitsAtTile(tileX, tileY).map((unit) => ({
      id: unit.id,
      kind: unit.kind,
      selected: unit.selected,
      x: unit.x,
      y: unit.y,
      target: unit.target ? { x: unit.target.x, y: unit.target.y } : null,
      pathLength: unit.path.length,
      pathIndex: unit.pathIndex,
      carrierId: unit.carrierId,
      assignedTruckId: unit.assignedTruckId
    }));
    const sections =
      sample && terrainSurface
        ? hoverDebugSectionBuilders
            .map((buildSection) =>
              buildSection({
                tileX,
                tileY,
                tileIndex,
                hoverGrid,
                sample,
                terrainWater: lastTerrainWater,
                heightScale: terrainSurface.heightScale
              })
            )
            .filter((section): section is HoverDebugSection => !!section && section.lines.length > 0)
            .map((section) => ({
              key: section.key,
              label: section.label,
              tone: section.tone ?? "default",
              lines: [...section.lines]
            }))
        : [];
    const payload = {
      copiedAt: new Date().toISOString(),
      cell: {
        x: tileX,
        y: tileY,
        index: tileIndex
      },
      hoverGrid,
      worldPosition: terrainSurface
        ? {
            x: terrainSurface.toWorldX(tileX + 0.5),
            y: sampleSurfaceHeightAtTile(tileX, tileY),
            z: terrainSurface.toWorldZ(tileY + 0.5)
          }
        : null,
      tile,
      soa: {
        typeId: world.tileTypeId[tileIndex] ?? null,
        elevation: world.tileElevation[tileIndex] ?? null,
        moisture: world.tileMoisture[tileIndex] ?? null,
        fire: world.tileFire[tileIndex] ?? null,
        heat: world.tileHeat[tileIndex] ?? null,
        fuel: world.tileFuel[tileIndex] ?? null,
        ignitionPoint: world.tileIgnitionPoint[tileIndex] ?? null,
        burnRate: world.tileBurnRate[tileIndex] ?? null,
        heatOutput: world.tileHeatOutput[tileIndex] ?? null,
        spreadBoost: world.tileSpreadBoost[tileIndex] ?? null,
        heatTransferCap: world.tileHeatTransferCap[tileIndex] ?? null,
        heatRetention: world.tileHeatRetention[tileIndex] ?? null,
        windFactor: world.tileWindFactor[tileIndex] ?? null,
        vegetationAge: world.tileVegetationAge[tileIndex] ?? null,
        canopyCover: world.tileCanopyCover[tileIndex] ?? null,
        stemDensity: world.tileStemDensity[tileIndex] ?? null,
        riverMask: world.tileRiverMask[tileIndex] ?? null,
        lakeId: world.tileLakeMask[tileIndex] ?? null,
        lakeSurface: world.tileLakeSurface[tileIndex] ?? null,
        lakeOutlet: world.tileLakeOutletMask[tileIndex] ?? null,
        oceanMask: world.tileOceanMask[tileIndex] ?? null,
        seaLevel: world.tileSeaLevel[tileIndex] ?? null,
        coastDistance: world.tileCoastDistance[tileIndex] ?? null,
        coastClass: world.tileCoastClass[tileIndex] ?? null,
        roadBridge: world.tileRoadBridge[tileIndex] ?? null,
        roadEdges: world.tileRoadEdges[tileIndex] ?? null,
        roadWallEdges: world.tileRoadWallEdges[tileIndex] ?? null,
        riverBed: world.tileRiverBed[tileIndex] ?? null,
        riverSurface: world.tileRiverSurface[tileIndex] ?? null,
        riverStepStrength: world.tileRiverStepStrength[tileIndex] ?? null,
        waterfallSource: world.tileWaterfallSourceMask[tileIndex] ?? null,
        waterfallTarget: world.tileWaterfallTarget[tileIndex] ?? null,
        waterfallDrop: world.tileWaterfallDrop[tileIndex] ?? null,
        structureMask: world.structureMask[tileIndex] ?? null,
        townId: world.tileTownId[tileIndex] ?? null,
        structure: world.tileStructure[tileIndex] ?? null
      },
      units,
      hoverDebug: sections
    };
    return JSON.stringify(payload, null, 2);
  };

  const copyCellStateToClipboard = async (
    payload: string,
    tileX: number,
    tileY: number,
    suppressSuccessStatus = false
  ): Promise<void> => {
    if (!navigator.clipboard?.writeText) {
      dispatchStatusCommand(`Clipboard is unavailable for cell ${tileX}, ${tileY}.`);
      return;
    }
    try {
      await navigator.clipboard.writeText(payload);
      if (!suppressSuccessStatus) {
        dispatchStatusCommand(`Copied cell ${tileX}, ${tileY} to the clipboard.`);
      }
    } catch {
      dispatchStatusCommand(`Clipboard access failed for cell ${tileX}, ${tileY}.`);
    }
  };

  const updateHoverDebugBillboard = (
    viewportWidth: number,
    viewportHeight: number,
    width: number,
    depth: number,
    heightScale: number
  ): void => {
    if (!inputState.debugCellEnabled || !inputState.debugHoverTile || !lastSample || !lastTerrainSize || !lastTerrainSurface) {
      hideHoverDebugBillboard();
      return;
    }
    const cols = Math.max(1, world.grid.cols);
    const rows = Math.max(1, world.grid.rows);
    const tileX = Math.max(0, Math.min(cols - 1, Math.floor(inputState.debugHoverTile.x)));
    const tileY = Math.max(0, Math.min(rows - 1, Math.floor(inputState.debugHoverTile.y)));
    const tileIndex = indexFor(world.grid, tileX, tileY);
    if (!world.tiles[tileIndex]) {
      hideHoverDebugBillboard();
      return;
    }
    const hoverGrid = inputState.debugHoverWorld ? { x: inputState.debugHoverWorld.x, y: inputState.debugHoverWorld.y } : null;
    const context: HoverDebugContext = {
      tileX,
      tileY,
      tileIndex,
      hoverGrid,
      sample: lastSample,
      terrainWater: lastTerrainWater,
      heightScale
    };
    const sections = hoverDebugSectionBuilders
      .map((buildSection) => buildSection(context))
      .filter((section): section is HoverDebugSection => !!section && section.lines.length > 0);
    if (sections.length <= 0) {
      hideHoverDebugBillboard();
      return;
    }
    let tone: HoverDebugTone = "default";
    sections.forEach((section) => {
      tone = mergeHoverDebugTone(tone, section.tone);
    });
    updateHoverDebugTileHighlight(tileX, tileY, tone, world.tileTypeId[tileIndex] ?? 0);
    const tile = world.tiles[tileIndex];
    const detailFragment = document.createDocumentFragment();
    sections.forEach((section) => {
      const sectionRoot = document.createElement("div");
      sectionRoot.className = "three-test-debug-section";
      const label = document.createElement("div");
      label.className = "three-test-debug-section-label";
      label.textContent = section.label;
      sectionRoot.appendChild(label);
      section.lines.forEach((line) => {
        const lineNode = document.createElement("div");
        lineNode.className = "three-test-debug-line";
        lineNode.textContent = line;
        sectionRoot.appendChild(lineNode);
      });
      detailFragment.appendChild(sectionRoot);
    });
    hoverDebugTitle.textContent = `Cell ${tileX},${tileY}`;
    hoverDebugBadge.textContent = tile.type.toUpperCase();
    const groundY = sampleSurfaceHeightAtTile(tileX, tileY) ?? 0;
    hoverDebugMeta.textContent =
      `${hoverGrid ? `grid ${formatDebugNumber(hoverGrid.x, 2)},${formatDebugNumber(hoverGrid.y, 2)}` : "grid n/a"} | y ${formatDebugNumber(groundY, 2)}`;
    hoverDebugDetails.replaceChildren(detailFragment);
    hoverDebugRoot.dataset.tone = tone;
    const worldX = lastTerrainSurface ? lastTerrainSurface.toWorldX(tileX + 0.5) : ((tileX + 0.5) / cols - 0.5) * width;
    const worldZ = lastTerrainSurface ? lastTerrainSurface.toWorldZ(tileY + 0.5) : ((tileY + 0.5) / rows - 0.5) * depth;
    const labelLift = HOVER_DEBUG_LABEL_LIFT_METERS / Math.max(0.001, TILE_SIZE);
    hoverDebugGroundWorld.set(worldX, groundY, worldZ);
    hoverDebugLabelWorld.set(worldX, groundY + labelLift, worldZ);
    hoverDebugLabelProjected.copy(hoverDebugLabelWorld).project(camera);
    hoverDebugGroundProjected.copy(hoverDebugGroundWorld).project(camera);
    const isVisible =
      hoverDebugLabelProjected.z > -1 &&
      hoverDebugLabelProjected.z < 1 &&
      hoverDebugLabelProjected.x >= -1.1 &&
      hoverDebugLabelProjected.x <= 1.1 &&
      hoverDebugLabelProjected.y >= -1.2 &&
      hoverDebugLabelProjected.y <= 1.2;
    const viewportPadding = 8;
    hoverDebugRoot.classList.remove("hidden");
    const rootWidth = Math.max(244, hoverDebugRoot.offsetWidth);
    const rootHeight = Math.max(96, hoverDebugRoot.offsetHeight);
    const clampRootX = (value: number): number =>
      Math.max(viewportPadding, Math.min(viewportWidth - rootWidth - viewportPadding, value));
    const clampRootY = (value: number): number =>
      Math.max(viewportPadding, Math.min(viewportHeight - rootHeight - viewportPadding, value));
    if (!isVisible) {
      hoverDebugRoot.style.zIndex = "20001";
      hoverDebugRoot.style.transform = `translate3d(${clampRootX(viewportPadding).toFixed(1)}px, ${clampRootY(viewportHeight - rootHeight - viewportPadding).toFixed(1)}px, 0)`;
      hoverDebugConnector.style.display = "none";
      return;
    }
    const screenX = (hoverDebugLabelProjected.x * 0.5 + 0.5) * viewportWidth;
    const screenY = (-hoverDebugLabelProjected.y * 0.5 + 0.5) * viewportHeight;
    const groundScreenX = (hoverDebugGroundProjected.x * 0.5 + 0.5) * viewportWidth;
    const groundScreenY = (-hoverDebugGroundProjected.y * 0.5 + 0.5) * viewportHeight;
    const preferRight = groundScreenX <= viewportWidth * 0.5;
    const sideCandidates = preferRight
      ? [
          { x: groundScreenX + HOVER_DEBUG_PANEL_GAP_X, y: groundScreenY - rootHeight * 0.5 },
          { x: groundScreenX - rootWidth - HOVER_DEBUG_PANEL_GAP_X, y: groundScreenY - rootHeight * 0.5 }
        ]
      : [
          { x: groundScreenX - rootWidth - HOVER_DEBUG_PANEL_GAP_X, y: groundScreenY - rootHeight * 0.5 },
          { x: groundScreenX + HOVER_DEBUG_PANEL_GAP_X, y: groundScreenY - rootHeight * 0.5 }
        ];
    const placementCandidates = [
      ...sideCandidates,
      { x: screenX - rootWidth * 0.5, y: groundScreenY - rootHeight - HOVER_DEBUG_PANEL_GAP_Y },
      { x: screenX - rootWidth * 0.5, y: groundScreenY + HOVER_DEBUG_PANEL_GAP_Y }
    ];
    let rootX = clampRootX(screenX - HOVER_DEBUG_LABEL_CONNECTOR_ORIGIN_X);
    let rootY = clampRootY(screenY + HOVER_DEBUG_LABEL_SCREEN_OFFSET_Y);
    for (let i = 0; i < placementCandidates.length; i += 1) {
      const candidate = placementCandidates[i];
      const candidateX = clampRootX(candidate.x);
      const candidateY = clampRootY(candidate.y);
      const obscuresHoverTile =
        groundScreenX >= candidateX - HOVER_DEBUG_TILE_SAFE_RADIUS_PX &&
        groundScreenX <= candidateX + rootWidth + HOVER_DEBUG_TILE_SAFE_RADIUS_PX &&
        groundScreenY >= candidateY - HOVER_DEBUG_TILE_SAFE_RADIUS_PX &&
        groundScreenY <= candidateY + rootHeight + HOVER_DEBUG_TILE_SAFE_RADIUS_PX;
      rootX = candidateX;
      rootY = candidateY;
      if (!obscuresHoverTile) {
        break;
      }
    }
    const depth01 = Math.max(0, Math.min(1, (hoverDebugLabelProjected.z + 1) * 0.5));
    const zIndex = Math.max(1, Math.min(TOWN_LABEL_MAX_Z_INDEX, Math.round((1 - depth01) * TOWN_LABEL_MAX_Z_INDEX)));
    hoverDebugRoot.style.zIndex = `${Math.max(2, zIndex + 1)}`;
    hoverDebugRoot.style.transform = `translate3d(${rootX.toFixed(1)}px, ${rootY.toFixed(1)}px, 0)`;
    const isGroundProjectedVisible =
      hoverDebugGroundProjected.z > -1 &&
      hoverDebugGroundProjected.z < 1 &&
      hoverDebugGroundProjected.x >= -1.5 &&
      hoverDebugGroundProjected.x <= 1.5 &&
      hoverDebugGroundProjected.y >= -1.5 &&
      hoverDebugGroundProjected.y <= 1.5;
    const connectorStartX = Math.max(rootX, Math.min(groundScreenX, rootX + rootWidth));
    const connectorStartY = Math.max(rootY, Math.min(groundScreenY, rootY + rootHeight));
    const connectorDx = groundScreenX - connectorStartX;
    const connectorDy = groundScreenY - connectorStartY;
    const connectorLength = Math.hypot(connectorDx, connectorDy);
    if (isGroundProjectedVisible && connectorLength >= 4) {
      hoverDebugConnector.style.display = "block";
      hoverDebugConnector.style.width = `${connectorLength.toFixed(1)}px`;
      hoverDebugConnector.style.zIndex = `${Math.max(1, zIndex - 1)}`;
      hoverDebugConnector.style.transform = `translate3d(${connectorStartX.toFixed(1)}px, ${connectorStartY.toFixed(1)}px, 0) rotate(${Math.atan2(connectorDy, connectorDx).toFixed(4)}rad)`;
    } else {
      hoverDebugConnector.style.display = "none";
    }
  };

  const handleTownOverlayPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (dockOverlayRoot.contains(target) || unitTrayRoot.contains(target) || squadMarkerOverlayRoot.contains(target)) {
      return;
    }
    if (fireAlertCardElements.root.contains(target)) {
      return;
    }
    if (facilityPanelElements.root.contains(target)) {
      return;
    }
    if (baseCardElements.cardRoot.contains(target) || baseCardElements.root.contains(target)) {
      baseFocused = true;
      closeTownFacility();
      selectedTownId = null;
      focusedTownId = null;
      updateBaseCardState();
      updateTownMetrics();
      return;
    }
    if (townCardElements.root.contains(target)) {
      return;
    }
    for (const [townId, pinnedCard] of pinnedTownCards) {
      if (pinnedCard.root.contains(target)) {
        baseFocused = false;
        focusedTownId = townId;
        syncFocusedTown();
        updateTownMetrics();
        return;
      }
    }
    const clickedLabel = Array.from(townLabelElements.entries()).find(([, entry]) => entry.root.contains(target)) ?? null;
    if (clickedLabel) {
      baseFocused = false;
      focusedTownId = clickedLabel[0];
      syncFocusedTown();
      updateTownMetrics();
      return;
    }
    if (selectedTownId !== null) {
      closeTownFacilityForTown(selectedTownId);
      selectedTownId = null;
      hoverPeekTownId = null;
    } else if (selectedFacility !== null) {
      closeTownFacility();
    }
    const baseSnapshot = worldCardState.get(baseCardId);
    baseFocused = false;
    if (baseSnapshot.visual === "expanded" && !baseSnapshot.pinned) {
      worldCardState.collapse(baseCardId);
    }
    dockCardState.dismissNonPinned();
    applyDockCardStates();
    syncFocusedTown();
    updateBaseCardState();
    updateTownMetrics();
  };

  const townLabelWorld = new THREE.Vector3();
  const townConnectorWorld = new THREE.Vector3();
  const townLabelProjected = new THREE.Vector3();
  const townConnectorProjected = new THREE.Vector3();
  const baseLabelWorld = new THREE.Vector3();
  const baseConnectorWorld = new THREE.Vector3();
  const baseLabelProjected = new THREE.Vector3();
  const baseConnectorProjected = new THREE.Vector3();
  const hoverDebugLabelWorld = new THREE.Vector3();
  const hoverDebugGroundWorld = new THREE.Vector3();
  const hoverDebugLabelProjected = new THREE.Vector3();
  const hoverDebugGroundProjected = new THREE.Vector3();

  const updateTownOverlay = (time: number): void => {
    if (!lastSample || !lastTerrainSize || !lastTerrainSurface) {
      townOverlayRoot.classList.add("hidden");
      townAnchors.clear();
      baseAnchor = null;
      hideHoverDebugBillboard();
      townCardElements.root.classList.add("hidden");
      fireAlertCardElements.root.classList.add("hidden");
      visibleFireAlertId = null;
      dismissedFireAlertId = null;
      activeFireAlertTownId = null;
      activeFireAlertTile = null;
      pinnedTownCards.forEach((card) => card.root.classList.add("hidden"));
      baseCardElements.root.classList.add("hidden");
      baseCardElements.connector.style.display = "none";
      baseCardElements.cardRoot.classList.add("hidden");
      closeTownFacility();
      if (selectedTownId !== null) {
        selectedTownId = null;
      }
      focusedTownId = null;
      baseFocused = false;
      updateTownMetrics();
      return;
    }
    townOverlayRoot.classList.remove("hidden");
    ensureTownLabels();
    if (time - lastTownMetricsUpdateAt >= TOWN_LABEL_UPDATE_INTERVAL_MS) {
      updateTownMetrics();
      updateFireAlertCard();
      lastTownMetricsUpdateAt = time;
    }
    const cols = Math.max(1, world.grid.cols);
    const rows = Math.max(1, world.grid.rows);
    const width = lastTerrainSize.width;
    const depth = lastTerrainSize.depth;
    const heightScale = lastTerrainSurface.heightScale;
    const labelLift = TOWN_LABEL_LIFT_METERS / Math.max(0.001, TILE_SIZE);
    const baseLabelLift = BASE_LABEL_LIFT_METERS / Math.max(0.001, TILE_SIZE);
    const occlusionMaxLift = Math.max(
      labelLift,
      baseLabelLift,
      heightScale * 1.45,
      TOWN_LABEL_OCCLUSION_MAX_LIFT_METERS / Math.max(0.001, TILE_SIZE)
    );
    const viewportWidth = Math.max(1, hudState.viewport.width);
    const viewportHeight = Math.max(1, hudState.viewport.height);
    const availableTrucks = world.roster.filter((unit) => unit.kind === "truck" && unit.status === "available").length;
    const availableCrews = world.roster.filter((unit) => unit.kind === "firefighter" && unit.status === "available").length;
    baseCardElements.summary.innerHTML = `<span class="three-test-town-summary-text">Trucks ${availableTrucks} | Crews ${availableCrews}</span>`;
    baseCardElements.cardSummary.textContent = `Deploy Truck ${availableTrucks} | Deploy Crew ${availableCrews}`;
    const maintenanceOpen = world.phase === "maintenance";
    const recruitButtons = [baseCardElements.recruitTruckButton, baseCardElements.recruitFirefighterButton];
    const trainButtons = [
      baseCardElements.trainSpeedButton,
      baseCardElements.trainPowerButton,
      baseCardElements.trainRangeButton,
      baseCardElements.trainResilienceButton
    ];
    recruitButtons.forEach((button) => {
      button.disabled = !maintenanceOpen;
      button.title = maintenanceOpen ? "" : "Only available during maintenance.";
    });
    trainButtons.forEach((button) => {
      button.disabled = !maintenanceOpen;
      button.title = maintenanceOpen ? "" : "Only available during maintenance.";
    });
    baseCardElements.deployTruckButton.disabled = availableTrucks <= 0;
    baseCardElements.deployFirefighterButton.disabled = availableCrews <= 0;
    baseCardElements.recruitHint.textContent = maintenanceOpen
      ? "Recruit and train available now."
      : "Recruit and training are locked outside maintenance.";

    for (const town of world.towns) {
      const entry = townLabelElements.get(town.id);
      if (!entry) {
        continue;
      }
      const tileX = Math.max(0, Math.min(cols - 1, Math.floor(getTownCenterX(town))));
      const tileY = Math.max(0, Math.min(rows - 1, Math.floor(getTownCenterY(town))));
      const worldX = lastTerrainSurface.toWorldX(tileX + 0.5);
      const worldZ = lastTerrainSurface.toWorldZ(tileY + 0.5);
      const groundY = lastTerrainSurface.heightAtTile(tileX, tileY) * heightScale;
      const labelLayout = resolveTownLabelDepthAwareLayout({
        camera,
        surface: lastTerrainSurface,
        worldX,
        groundY,
        worldZ,
        baseLift: labelLift,
        maxLift: occlusionMaxLift,
        verticalClearance: TOWN_LABEL_OCCLUSION_VERTICAL_CLEARANCE,
        labelClearance: TOWN_LABEL_OCCLUSION_LABEL_CLEARANCE,
        connectorClearance: TOWN_LABEL_CONNECTOR_CLEARANCE,
        sampleCount: TOWN_LABEL_OCCLUSION_SAMPLE_COUNT
      });
      townConnectorWorld.set(worldX, labelLayout.connectorY, worldZ);
      townLabelWorld.set(worldX, labelLayout.labelY, worldZ);
      townLabelProjected.copy(townLabelWorld).project(camera);
      townConnectorProjected.copy(townConnectorWorld).project(camera);
      const isVisible =
        townLabelProjected.z > -1 &&
        townLabelProjected.z < 1 &&
        townLabelProjected.x >= -1.1 &&
        townLabelProjected.x <= 1.1 &&
        townLabelProjected.y >= -1.2 &&
        townLabelProjected.y <= 1.2;
      if (!isVisible) {
        entry.root.classList.add("hidden");
        entry.connector.style.display = "none";
        townAnchors.delete(town.id);
        continue;
      }
      const screenX = (townLabelProjected.x * 0.5 + 0.5) * viewportWidth;
      const screenY = (-townLabelProjected.y * 0.5 + 0.5) * viewportHeight;
      const connectorScreenX = (townConnectorProjected.x * 0.5 + 0.5) * viewportWidth;
      const connectorScreenY = (-townConnectorProjected.y * 0.5 + 0.5) * viewportHeight;
      const rootX = screenX - TOWN_LABEL_CONNECTOR_ORIGIN_X;
      const rootY = screenY + TOWN_LABEL_SCREEN_OFFSET_Y;
      const depth01 = Math.max(0, Math.min(1, (townLabelProjected.z + 1) * 0.5));
      const zIndex = Math.max(1, Math.min(TOWN_LABEL_MAX_Z_INDEX, Math.round((1 - depth01) * TOWN_LABEL_MAX_Z_INDEX)));
      const isConnectorProjectedVisible =
        townConnectorProjected.z > -1 &&
        townConnectorProjected.z < 1 &&
        townConnectorProjected.x >= -1.5 &&
        townConnectorProjected.x <= 1.5 &&
        townConnectorProjected.y >= -1.5 &&
        townConnectorProjected.y <= 1.5;
      const rootHeight = Math.max(0, entry.root.offsetHeight);
      const rootWidth = Math.max(0, entry.root.offsetWidth);
      entry.root.classList.remove("hidden");
      entry.root.style.zIndex = `${zIndex}`;
      entry.root.style.transform = `translate3d(${rootX}px, ${rootY}px, 0)`;
      townAnchors.set(town.id, { rootX, rootY, rootWidth, rootHeight, zIndex });
      entry.root.style.clipPath = "none";
      const connectorStartScreenY = Math.max(rootY + 1, rootY + rootHeight - 1);
      const connectorEndScreenY = connectorScreenY;
      const connectorLength = connectorEndScreenY - connectorStartScreenY;
      const connectorXError = Math.abs(connectorScreenX - screenX);
      if (isConnectorProjectedVisible && connectorLength >= 4 && connectorXError <= viewportWidth * 0.25) {
        entry.connector.style.display = "block";
        entry.connector.style.width = `${connectorLength.toFixed(1)}px`;
        entry.connector.style.zIndex = `${Math.max(1, zIndex - 1)}`;
        entry.connector.style.transform = `translate3d(${screenX.toFixed(1)}px, ${connectorStartScreenY.toFixed(1)}px, 0) rotate(90deg)`;
      } else {
        entry.connector.style.display = "none";
      }
    }

    const baseTileX = Math.max(0, Math.min(cols - 1, Math.floor(world.basePoint.x)));
    const baseTileY = Math.max(0, Math.min(rows - 1, Math.floor(world.basePoint.y)));
    const baseWorldX = lastTerrainSurface.toWorldX(baseTileX + 0.5);
    const baseWorldZ = lastTerrainSurface.toWorldZ(baseTileY + 0.5);
    const baseGroundY = lastTerrainSurface.heightAtTile(baseTileX, baseTileY) * heightScale;
    const baseLabelLayout = resolveTownLabelDepthAwareLayout({
      camera,
      surface: lastTerrainSurface,
      worldX: baseWorldX,
      groundY: baseGroundY,
      worldZ: baseWorldZ,
      baseLift: baseLabelLift,
      maxLift: occlusionMaxLift,
      verticalClearance: TOWN_LABEL_OCCLUSION_VERTICAL_CLEARANCE,
      labelClearance: TOWN_LABEL_OCCLUSION_LABEL_CLEARANCE,
      connectorClearance: TOWN_LABEL_CONNECTOR_CLEARANCE,
      sampleCount: TOWN_LABEL_OCCLUSION_SAMPLE_COUNT
    });
    baseConnectorWorld.set(baseWorldX, baseLabelLayout.connectorY, baseWorldZ);
    baseLabelWorld.set(baseWorldX, baseLabelLayout.labelY, baseWorldZ);
    baseLabelProjected.copy(baseLabelWorld).project(camera);
    baseConnectorProjected.copy(baseConnectorWorld).project(camera);
    const baseVisible = false &&
      baseLabelProjected.z > -1 &&
      baseLabelProjected.z < 1 &&
      baseLabelProjected.x >= -1.1 &&
      baseLabelProjected.x <= 1.1 &&
      baseLabelProjected.y >= -1.2 &&
      baseLabelProjected.y <= 1.2;
    if (baseVisible) {
      const screenX = (baseLabelProjected.x * 0.5 + 0.5) * viewportWidth;
      const screenY = (-baseLabelProjected.y * 0.5 + 0.5) * viewportHeight;
      const connectorScreenX = (baseConnectorProjected.x * 0.5 + 0.5) * viewportWidth;
      const connectorScreenY = (-baseConnectorProjected.y * 0.5 + 0.5) * viewportHeight;
      const rootX = screenX - BASE_LABEL_CONNECTOR_ORIGIN_X;
      const rootY = screenY + BASE_LABEL_SCREEN_OFFSET_Y;
      const depth01 = Math.max(0, Math.min(1, (baseLabelProjected.z + 1) * 0.5));
      const zIndex = Math.max(1, Math.min(TOWN_LABEL_MAX_Z_INDEX, Math.round((1 - depth01) * TOWN_LABEL_MAX_Z_INDEX)));
      const rootHeight = Math.max(0, baseCardElements.root.offsetHeight);
      const rootWidth = Math.max(0, baseCardElements.root.offsetWidth);
      baseAnchor = { rootX, rootY, rootWidth, rootHeight, zIndex };
      baseCardElements.root.classList.remove("hidden");
      baseCardElements.root.style.zIndex = `${zIndex}`;
      baseCardElements.root.style.transform = `translate3d(${rootX.toFixed(1)}px, ${rootY.toFixed(1)}px, 0)`;
      const connectorStartScreenY = Math.max(rootY + 1, rootY + rootHeight - 1);
      const connectorLength = connectorScreenY - connectorStartScreenY;
      const connectorXError = Math.abs(connectorScreenX - screenX);
      const isConnectorProjectedVisible =
        baseConnectorProjected.z > -1 &&
        baseConnectorProjected.z < 1 &&
        baseConnectorProjected.x >= -1.5 &&
        baseConnectorProjected.x <= 1.5 &&
        baseConnectorProjected.y >= -1.5 &&
        baseConnectorProjected.y <= 1.5;
      if (isConnectorProjectedVisible && connectorLength >= 4 && connectorXError <= viewportWidth * 0.25) {
        baseCardElements.connector.style.display = "block";
        baseCardElements.connector.style.width = `${connectorLength.toFixed(1)}px`;
        baseCardElements.connector.style.zIndex = `${Math.max(1, zIndex - 1)}`;
        baseCardElements.connector.style.transform = `translate3d(${screenX.toFixed(1)}px, ${connectorStartScreenY.toFixed(1)}px, 0) rotate(90deg)`;
      } else {
        baseCardElements.connector.style.display = "none";
      }
    } else {
      baseAnchor = null;
      baseCardElements.root.classList.add("hidden");
      baseCardElements.connector.style.display = "none";
      baseCardElements.cardRoot.classList.add("hidden");
    }

    updateTownCardPosition(viewportWidth, viewportHeight);
    if (baseAnchor) {
      const baseSnapshot = worldCardState.get(baseCardId);
      const hasAnyFocus = focusedTownId !== null || baseFocused;
      baseCardElements.root.classList.toggle("is-dimmed", hasAnyFocus && !baseFocused);
      if (baseSnapshot.visual === "expanded") {
        const measuredWidth = baseCardElements.cardRoot.offsetWidth;
        const measuredHeight = baseCardElements.cardRoot.offsetHeight;
        const cardWidth = Math.max(292, measuredWidth > 0 ? measuredWidth : 352);
        const cardHeight = Math.max(180, measuredHeight > 0 ? measuredHeight : 248);
        const { x, y } = getAnchoredCardPosition(baseAnchor, cardWidth, cardHeight, viewportWidth, viewportHeight);
        baseCardElements.cardRoot.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0)`;
        baseCardElements.cardRoot.style.zIndex = `${Math.max(2, baseAnchor.zIndex + 4)}`;
      }
    }
    updateHoverDebugBillboard(viewportWidth, viewportHeight, width, depth, heightScale);
    updateBaseCardState();
  };

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  const watchTowerOverlay = new THREE.Group();
  watchTowerOverlay.name = "watch-tower-coverage-overlay";
  scene.add(watchTowerOverlay);
  const watchTowerQuoteTooltip = document.createElement("div");
  watchTowerQuoteTooltip.className = "watch-tower-placement-quote";
  Object.assign(watchTowerQuoteTooltip.style, {
    position: "fixed", zIndex: "10020", pointerEvents: "none", display: "none",
    maxWidth: "260px", padding: "8px 10px", borderRadius: "6px",
    background: "rgba(12, 20, 18, 0.92)", color: "#eef7f1", border: "1px solid rgba(120, 220, 170, 0.75)",
    font: "600 12px/1.35 Barlow, sans-serif", whiteSpace: "pre-line", boxShadow: "0 4px 16px rgba(0,0,0,0.35)"
  });
  document.body.appendChild(watchTowerQuoteTooltip);
  const hideWatchTowerQuoteTooltip = (): void => { watchTowerQuoteTooltip.style.display = "none"; };
  const showWatchTowerQuoteTooltip = (event: MouseEvent, quote: ReturnType<typeof quoteWatchTowerPlacement>): void => {
    watchTowerQuoteTooltip.textContent = quote.valid
      ? `Cost $${quote.totalCost}${quote.accessSurcharge > 0 ? ` (+$${quote.accessSurcharge} access)` : ""}\nConstruction ${quote.constructionDays.toFixed(0)} days\nRadius ${quote.effectiveRadius.toFixed(1)} · High ground +${Math.round((quote.elevationMultiplier - 1) * 100)}%`
      : quote.reason;
    watchTowerQuoteTooltip.style.borderColor = quote.valid ? (quote.elevationMultiplier > 1.001 ? "#61d9ff" : "#68e18c") : "#ff5b55";
    watchTowerQuoteTooltip.style.display = "block";
    const margin = 10;
    const offset = 16;
    const width = watchTowerQuoteTooltip.offsetWidth;
    const height = watchTowerQuoteTooltip.offsetHeight;
    watchTowerQuoteTooltip.style.left = `${Math.max(margin, Math.min(window.innerWidth - width - margin, event.clientX + offset))}px`;
    watchTowerQuoteTooltip.style.top = `${Math.max(margin, Math.min(window.innerHeight - height - margin, event.clientY + offset))}px`;
  };
  const clearWatchTowerOverlay = (): void => {
    while (watchTowerOverlay.children.length > 0) {
      const child = watchTowerOverlay.children.pop();
      if (!child) continue;
      child.traverse((object) => {
        if (!(object instanceof THREE.Mesh || object instanceof THREE.Line)) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => material.dispose());
      });
    }
  };
  const refreshWatchTowerOverlay = (): void => {
    clearWatchTowerOverlay();
    if (!lastTerrainSurface) return;
    const overlaySurface = lastTerrainSurface;
    const placementTownId = inputState.watchTowerPlacementTownId;
    const placementTile = inputState.watchTowerPlacementTile;
    const selectedTower = selectedFacility?.facilityId.startsWith("watch-tower:")
      ? getWatchTowerForTown(world, selectedFacility.townId)
      : null;
    if (placementTownId === null && !selectedTower) return;
    const tileX = placementTile?.x ?? selectedTower?.x;
    const tileY = placementTile?.y ?? selectedTower?.y;
    if (tileX === undefined || tileY === undefined) return;
    const quote = placementTownId !== null ? quoteWatchTowerPlacement(world, placementTownId, tileX, tileY) : null;
    const radius = quote?.effectiveRadius ?? selectedTower?.detectionRadius ?? 0;
    const valid = quote?.valid ?? true;
    const elevated = (quote?.elevationMultiplier ?? selectedTower?.siteElevationMultiplier ?? 1) > 1.001;
    const color = valid ? (selectedTower?.constructionKind ? 0xd89a45 : elevated ? 0x61d9ff : 0x68e18c) : 0xff5b55;
    const centerX = overlaySurface.toWorldX(tileX + 0.5);
    const centerZ = overlaySurface.toWorldZ(tileY + 0.5);
    const centerY = overlaySurface.heightAtTile(Math.round(tileX), Math.round(tileY)) * overlaySurface.heightScale + 0.06;
    const tileSpan = overlaySurface.size.width / Math.max(1, world.grid.cols);
    const points = Array.from({ length: 97 }, (_, index) => {
      const angle = (index / 96) * Math.PI * 2;
      const sampleX = tileX + 0.5 + Math.cos(angle) * radius;
      const sampleY = tileY + 0.5 + Math.sin(angle) * radius;
      const x = overlaySurface.toWorldX(sampleX);
      const z = overlaySurface.toWorldZ(sampleY);
      const sx = Math.max(0, Math.min(world.grid.cols - 1, Math.floor(sampleX)));
      const sy = Math.max(0, Math.min(world.grid.rows - 1, Math.floor(sampleY)));
      const y = overlaySurface.heightAtTile(sx, sy) * overlaySurface.heightScale + 0.08;
      return new THREE.Vector3(x, y, z);
    });
    watchTowerOverlay.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })));
    if (quote) {
      const ghost = createProceduralWatchTowerModel(1);
      ghost.position.set(centerX, centerY, centerZ);
      ghost.rotation.y = WATCH_TOWER_GRID_ROTATION_RADIANS;
      ghost.scale.setScalar(Math.max(0.7, Math.min(1.2, tileSpan)));
      ghost.traverse((object) => { if (object instanceof THREE.Mesh) object.material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: valid ? 0.42 : 0.25, wireframe: !valid }); });
      watchTowerOverlay.add(ghost);
    }
  };
  let lastHoverPickAt = 0;
  type TerrainPick = { tileX: number; tileY: number; worldX: number; worldY: number };
  const pickTerrainTile = (event: MouseEvent): TerrainPick | null => {
    if (!terrainMesh || !lastSample || !lastTerrainSize) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    // Pick only the terrain surface mesh; recursive picks over trees/buildings are expensive.
    const hits = raycaster.intersectObject(terrainMesh, false);
    if (hits.length === 0) {
      return null;
    }
    const hit = hits[0];
    const localPoint = terrainMesh.worldToLocal(hit.point.clone());
    const width = lastTerrainSize.width || 1;
    const depth = lastTerrainSize.depth || 1;
    const worldX = (localPoint.x / width + 0.5) * lastSample.cols;
    const worldY = (localPoint.z / depth + 0.5) * lastSample.rows;
    const tileX = Math.floor(worldX);
    const tileY = Math.floor(worldY);
    if (tileX < 0 || tileY < 0 || tileX >= lastSample.cols || tileY >= lastSample.rows) {
      return null;
    }
    return { tileX, tileY, worldX, worldY };
  };

  const clearDebugHover = (): void => {
    if (!inputState.debugHoverTile && !inputState.debugHoverWorld) {
      return;
    }
    inputState.debugHoverTile = null;
    inputState.debugHoverWorld = null;
  };
  type FormationCameraControlState = {
    enabled: boolean;
    enablePan: boolean;
    enableRotate: boolean;
    enableZoom: boolean;
  };
  let isFormationDrag = false;
  let formationDragStartPx: { x: number; y: number } | null = null;
  let formationDragStartedAt = 0;
  let formationHoldTimer = 0;
  let formationCameraControlState: FormationCameraControlState | null = null;
  const canStartFormationGesture = (): boolean =>
    world.selectedUnitIds.length > 0 || inputState.pendingSquadDispatchId !== null;
  const suspendFormationCameraControls = (): void => {
    if (formationCameraControlState) {
      return;
    }
    formationCameraControlState = {
      enabled: controls.enabled,
      enablePan: controls.enablePan,
      enableRotate: controls.enableRotate,
      enableZoom: controls.enableZoom
    };
    controls.enabled = false;
    controls.enablePan = false;
    controls.enableRotate = false;
    controls.enableZoom = false;
  };
  const resumeFormationCameraControls = (): void => {
    if (!formationCameraControlState) {
      return;
    }
    const previous = formationCameraControlState;
    formationCameraControlState = null;
    controls.enablePan = previous.enablePan;
    controls.enableRotate = previous.enableRotate;
    controls.enableZoom = previous.enableZoom;
    controls.enabled = running ? previous.enabled : false;
  };
  const getFormationProjectionUnitCount = (): number => {
    if (inputState.pendingSquadDispatchId !== null) {
      const activeCommandUnit = world.commandUnits.find((entry) => entry.squadId === inputState.pendingSquadDispatchId) ?? null;
      if (activeCommandUnit) {
        return Math.max(1, activeCommandUnit.truckIds.length);
      }
      const squad = world.squads.find((entry) => entry.id === inputState.pendingSquadDispatchId) ?? null;
      return Math.max(1, squad?.truckRosterIds.length ?? 1);
    }
    return Math.max(1, world.selectedUnitIds.length);
  };
  const getFormationFallbackFacing = (anchor: { x: number; y: number }): { x: number; y: number } | null => {
    const selectedTrucks = world.units.filter((unit) => unit.kind === "truck" && world.selectedUnitIds.includes(unit.id));
    if (selectedTrucks.length > 0) {
      const center = selectedTrucks.reduce(
        (sum, unit) => ({ x: sum.x + unit.x, y: sum.y + unit.y }),
        { x: 0, y: 0 }
      );
      center.x /= selectedTrucks.length;
      center.y /= selectedTrucks.length;
      return { x: anchor.x + 0.5 - center.x, y: anchor.y + 0.5 - center.y };
    }
    return { x: anchor.x - world.basePoint.x, y: anchor.y - world.basePoint.y };
  };
  const updateFormationProjection = (cursor: { x: number; y: number } | null): void => {
    if (!inputState.formationStart || !cursor) {
      inputState.formationProjection = null;
      return;
    }
    inputState.formationProjection = createFormationTarget({
      anchor: inputState.formationStart,
      cursor,
      formation: inputState.dispatchFormation,
      count: getFormationProjectionUnitCount(),
      fallbackFacing: getFormationFallbackFacing(inputState.formationStart)
    });
  };
  const cancelFormationDrag = (): void => {
    isFormationDrag = false;
    formationDragStartPx = null;
    formationDragStartedAt = 0;
    if (formationHoldTimer) {
      window.clearTimeout(formationHoldTimer);
      formationHoldTimer = 0;
    }
    resumeFormationCameraControls();
    inputState.formationStart = null;
    inputState.formationEnd = null;
    inputState.formationProjection = null;
  };

  const handleCanvasMouseMove = (event: MouseEvent): void => {
    if (!running) {
      return;
    }
    if (inputState.watchTowerPlacementTownId !== null) {
      const placementHit = pickTerrainTile(event);
      const previousTile = inputState.watchTowerPlacementTile;
      inputState.watchTowerPlacementTile = placementHit ? { x: placementHit.tileX, y: placementHit.tileY } : null;
      if (placementHit && (previousTile?.x !== placementHit.tileX || previousTile?.y !== placementHit.tileY)) {
        const quote = quoteWatchTowerPlacement(world, inputState.watchTowerPlacementTownId, placementHit.tileX, placementHit.tileY);
        dispatchStatusCommand(quote.valid
          ? `Tower preview: $${quote.totalCost}, ${quote.constructionDays.toFixed(2)}d, radius ${quote.effectiveRadius.toFixed(1)}, high ground +${Math.round((quote.elevationMultiplier - 1) * 100)}%.`
          : quote.reason);
      }
      if (placementHit) showWatchTowerQuoteTooltip(event, quoteWatchTowerPlacement(world, inputState.watchTowerPlacementTownId, placementHit.tileX, placementHit.tileY));
      else hideWatchTowerQuoteTooltip();
      refreshWatchTowerOverlay();
      return;
    }
    if (isFormationDrag) {
      const hit = pickTerrainTile(event);
      if (hit) {
        inputState.formationEnd = { x: hit.tileX, y: hit.tileY };
        const dragDistance = formationDragStartPx
          ? Math.hypot(event.clientX - formationDragStartPx.x, event.clientY - formationDragStartPx.y)
          : 0;
        const heldMs = formationDragStartedAt > 0 ? performance.now() - formationDragStartedAt : 0;
        if (dragDistance >= FORMATION_DRAG_THRESHOLD_PX || heldMs >= FORMATION_HOLD_THRESHOLD_MS) {
          updateFormationProjection(inputState.formationEnd);
        }
      }
      return;
    }
    if (!inputState.debugCellEnabled) {
      clearDebugHover();
      return;
    }
    if (event.buttons !== 0) {
      clearDebugHover();
      return;
    }
    const now = performance.now();
    if (now - lastHoverPickAt < HOVER_PICK_INTERVAL_MS) {
      return;
    }
    lastHoverPickAt = now;
    const hit = pickTerrainTile(event);
    if (!hit) {
      clearDebugHover();
      return;
    }
    inputState.debugHoverTile = { x: hit.tileX, y: hit.tileY };
    inputState.debugHoverWorld = { x: hit.worldX, y: hit.worldY };
  };

  const handleCanvasMouseLeave = (): void => {
    hideWatchTowerQuoteTooltip();
    clearDebugHover();
    cancelFormationDrag();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!running) {
      return;
    }
    if (event.key === "F8") {
      setEnvironmentFogEnabled(!environmentFogEnabled);
      event.preventDefault();
      return;
    }
    if (event.key === "Escape") {
      inputState.watchTowerPlacementTownId = null;
      inputState.watchTowerPlacementTile = null;
      hideWatchTowerQuoteTooltip();
      refreshWatchTowerOverlay();
      selectedTownId = null;
      closeTownFacility();
      hoverPeekTownId = null;
      const baseSnapshot = worldCardState.get(baseCardId);
      baseFocused = false;
      if (baseSnapshot.visual === "expanded" && !baseSnapshot.pinned) {
        worldCardState.collapse(baseCardId);
      }
      dockCardState.dismissNonPinned();
      syncFocusedTown();
      updateBaseCardState();
      updateTownMetrics();
      applyDockCardStates();
    }
    if (!THREE_TEST_DISABLE_HUD) {
      handleHudKey(event, world, hudState);
    }
  };

  const handleCanvasClick = (event: MouseEvent): void => {
    if (!running) {
      return;
    }
    if (inputState.watchTowerPlacementTownId !== null) {
      const placementHit = pickTerrainTile(event);
      if (placementHit) {
        dispatchSelectionAction("watch-tower-build", { townId: String(inputState.watchTowerPlacementTownId), x: String(placementHit.tileX), y: String(placementHit.tileY) });
      }
      refreshWatchTowerOverlay();
      if (inputState.watchTowerPlacementTownId === null) hideWatchTowerQuoteTooltip();
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? hudState.viewport.width / rect.width : 1;
    const scaleY = rect.height > 0 ? hudState.viewport.height / rect.height : 1;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    if (!THREE_TEST_DISABLE_HUD) {
      const handled = handleHudClick(x, y, world, hudState, dispatchSelectionAction);
      if (handled) {
        return;
      }
    }
    if (structureOverlayGroup) {
      pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc, camera);
      const structureHits = raycaster.intersectObject(structureOverlayGroup, true);
      for (const hit of structureHits) {
        let target: THREE.Object3D | null = hit.object;
        while (target && !Number.isFinite(target.userData?.watchTowerTownId)) target = target.parent;
        if (!target) continue;
        const towerTownId = Number(target.userData.watchTowerTownId);
        openTownFacility(towerTownId, `watch-tower:${towerTownId}`);
        inputState.lastInteractionTime = performance.now();
        return;
      }
    }
    const tile = pickTerrainTile(event);
    if (!tile) {
      return;
    }
    const mapTile = { x: tile.tileX, y: tile.tileY };
    const clipboardPayload = inputState.debugCellEnabled
      ? buildCellClipboardPayload(tile.tileX, tile.tileY, { x: tile.worldX, y: tile.worldY })
      : null;
    const handledPrimary = world.deployMode !== "clear";
    if (handledPrimary) {
      dispatchMapPrimaryCommand(mapTile, { shiftKey: event.shiftKey, altKey: event.altKey });
    }
    const handledClear = !handledPrimary && world.deployMode === "clear" && world.phase === "maintenance";
    if (handledClear) {
      dispatchClearFuelBreakCommand(mapTile);
    }
    if (clipboardPayload) {
      void copyCellStateToClipboard(clipboardPayload, tile.tileX, tile.tileY, handledPrimary || handledClear);
    }
    if (handledPrimary || handledClear) {
      inputState.lastInteractionTime = performance.now();
    }
  };

  const handleCanvasMouseDown = (event: MouseEvent): void => {
    if (!running || event.button !== 2) {
      return;
    }
    if (!canStartFormationGesture()) {
      return;
    }
    const tile = pickTerrainTile(event);
    if (!tile) {
      resumeFormationCameraControls();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    suspendFormationCameraControls();
    isFormationDrag = true;
    formationDragStartPx = { x: event.clientX, y: event.clientY };
    formationDragStartedAt = performance.now();
    inputState.formationStart = { x: tile.tileX, y: tile.tileY };
    inputState.formationEnd = { x: tile.tileX, y: tile.tileY };
    inputState.formationProjection = null;
    if (formationHoldTimer) {
      window.clearTimeout(formationHoldTimer);
    }
    formationHoldTimer = window.setTimeout(() => {
      if (isFormationDrag && inputState.formationEnd) {
        updateFormationProjection(inputState.formationEnd);
      }
      formationHoldTimer = 0;
    }, FORMATION_HOLD_THRESHOLD_MS);
    inputState.lastInteractionTime = performance.now();
  };

  const handleCanvasMouseUp = (event: MouseEvent): void => {
    if (!running || event.button !== 2 || !isFormationDrag) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const hit = pickTerrainTile(event);
    const start = inputState.formationStart ? { ...inputState.formationStart } : null;
    const end = hit ? { x: hit.tileX, y: hit.tileY } : inputState.formationEnd ? { ...inputState.formationEnd } : null;
    const dragDistance = formationDragStartPx
      ? Math.hypot(event.clientX - formationDragStartPx.x, event.clientY - formationDragStartPx.y)
      : 0;
    const heldMs = formationDragStartedAt > 0 ? performance.now() - formationDragStartedAt : 0;
    if (!start || !end) {
      cancelFormationDrag();
      return;
    }
    if (dragDistance < FORMATION_DRAG_THRESHOLD_PX && heldMs < FORMATION_HOLD_THRESHOLD_MS) {
      if (inputState.pendingSquadDispatchId !== null) {
        dispatchMapPrimaryCommand(end, { shiftKey: event.shiftKey, altKey: event.altKey });
        inputState.lastInteractionTime = performance.now();
      } else if (world.selectedUnitIds.length > 0) {
        dispatchRetaskCommand(end);
        inputState.lastInteractionTime = performance.now();
      }
      cancelFormationDrag();
      return;
    }
    updateFormationProjection(end);
    const projection = inputState.formationProjection;
    const handledFormation = world.selectedUnitIds.length > 0 || inputState.pendingSquadDispatchId !== null;
    if (handledFormation) {
      dispatchFormationCommand(start, end, projection);
    }
    if (handledFormation) {
      inputState.lastInteractionTime = performance.now();
    }
    cancelFormationDrag();
  };

  const handleWindowMouseUp = (event: MouseEvent): void => {
    if (isFormationDrag) {
      handleCanvasMouseUp(event);
    } else {
      resumeFormationCameraControls();
    }
  };

  const handleWindowBlur = (): void => {
    cancelFormationDrag();
  };

  const handleCanvasPointerDown = (event: PointerEvent): void => {
    if (!running || event.button !== 2 || !canStartFormationGesture()) {
      return;
    }
    if (pickTerrainTile(event)) {
      suspendFormationCameraControls();
    }
  };

  const handleCanvasContextMenu = (event: MouseEvent): void => {
    if (!running) {
      return;
    }
    event.preventDefault();
  };

  document.addEventListener("keydown", handleKeyDown);
  canvas.addEventListener("click", handleCanvasClick);
  canvas.addEventListener("pointerdown", handleCanvasPointerDown, true);
  canvas.addEventListener("mousedown", handleCanvasMouseDown, true);
  window.addEventListener("mouseup", handleWindowMouseUp, true);
  window.addEventListener("pointerdown", handleTownOverlayPointerDown, true);
  window.addEventListener("blur", handleWindowBlur);
  canvas.addEventListener("contextmenu", handleCanvasContextMenu);
  canvas.addEventListener("mousemove", handleCanvasMouseMove);
  canvas.addEventListener("mouseleave", handleCanvasMouseLeave);
  const handleContextLost = (event: Event): void => {
    event.preventDefault();
    contextLosses += 1;
    console.warn("[threeTest] WebGL context lost.");
  };
  const handleContextRestored = (): void => {
    contextRestores += 1;
    console.warn("[threeTest] WebGL context restored.");
  };
  canvas.addEventListener("webglcontextlost", handleContextLost as EventListener, false);
  canvas.addEventListener("webglcontextrestored", handleContextRestored as EventListener, false);

  let terrainMesh: THREE.Mesh | null = null;
  let terrainRoadOverlayMesh: THREE.Mesh | null = null;
  let roadHighContrastEnabled = false;
  const pendingTerrainTextureDisposals: PendingTerrainTextureDisposal[] = [];
  const waterSystem = new ThreeTestWaterSystem({
    scene,
    renderer,
    keyLight,
    skyTopColor: zenithColor,
    skyHorizonColor: horizonColor,
    fogColor: THREE_TEST_CINEMATIC_GRADE_CONFIG.fogColor,
    fogNear: THREE_TEST_CINEMATIC_GRADE_CONFIG.fogStartDistance,
    fogFar:
      THREE_TEST_CINEMATIC_GRADE_CONFIG.fogStartDistance + THREE_TEST_CINEMATIC_GRADE_CONFIG.fogRampDistance,
    preferredQuality: THREE_TEST_DEFAULT_WATER_QUALITY
  });
  const applyDomEnvironmentTheme = (theme: ReturnType<typeof buildEnvironmentPalette>["hud"]["dom"]): void => {
    const overlayRoot = canvas.closest(".three-test-overlay") as HTMLElement | null;
    const cardRoot = canvas.closest(".three-test-card") as HTMLElement | null;
    const targets = [
      overlayRoot,
      cardRoot,
      canvas.parentElement,
      townOverlayRoot,
      squadMarkerOverlayRoot,
      dockOverlayRoot,
      unitTrayRoot
    ];
    targets.forEach((target) => {
      if (!target) {
        return;
      }
      target.style.setProperty("--three-test-overlay-bg", theme.overlayBackground);
      target.style.setProperty("--three-test-card-bg", theme.cardBackground);
      target.style.setProperty("--three-test-card-border", theme.cardBorder);
      target.style.setProperty("--three-test-card-header-bg", theme.cardHeaderBackground);
      target.style.setProperty("--three-test-text-primary", theme.textPrimary);
      target.style.setProperty("--three-test-text-muted", theme.textMuted);
      target.style.setProperty("--three-test-button-bg", theme.buttonBackground);
      target.style.setProperty("--three-test-button-bg-hover", theme.buttonHoverBackground);
      target.style.setProperty("--three-test-button-border", theme.buttonBorder);
      target.style.setProperty("--three-test-button-disabled-bg", theme.buttonDisabledBackground);
      target.style.setProperty("--three-test-button-disabled-border", theme.buttonDisabledBorder);
      target.style.setProperty("--three-test-accent", theme.accent);
      target.style.setProperty("--three-test-risk-low-bg", theme.riskLowBackground);
      target.style.setProperty("--three-test-risk-low-border", theme.riskLowBorder);
      target.style.setProperty("--three-test-risk-low-text", theme.riskLowText);
      target.style.setProperty("--three-test-risk-moderate-bg", theme.riskModerateBackground);
      target.style.setProperty("--three-test-risk-moderate-border", theme.riskModerateBorder);
      target.style.setProperty("--three-test-risk-moderate-text", theme.riskModerateText);
      target.style.setProperty("--three-test-risk-high-bg", theme.riskHighBackground);
      target.style.setProperty("--three-test-risk-high-border", theme.riskHighBorder);
      target.style.setProperty("--three-test-risk-high-text", theme.riskHighText);
      target.style.setProperty("--three-test-risk-extreme-bg", theme.riskExtremeBackground);
      target.style.setProperty("--three-test-risk-extreme-border", theme.riskExtremeBorder);
      target.style.setProperty("--three-test-risk-extreme-text", theme.riskExtremeText);
      target.style.setProperty("--three-test-info-bg", theme.infoBackground);
      target.style.setProperty("--three-test-info-border", theme.infoBorder);
      target.style.setProperty("--three-test-info-text", theme.infoText);
      target.style.setProperty("--three-test-chart-bg", theme.chartBackground);
      target.style.setProperty("--three-test-chart-border", theme.chartBorder);
      target.style.setProperty("--three-test-minimap-bg", theme.minimapBackground);
      target.style.setProperty("--three-test-unit-card-bg", theme.unitCardBackground);
      target.style.setProperty("--three-test-unit-card-border", theme.unitCardBorder);
    });
  };
  let applyEnvironmentPalette = (_force = false): void => {};
  let treeAssets: TreeAssets | null = getTreeAssetsCache();
  let houseAssets: HouseAssets | null = getHouseAssetsCache();
  let firestationAsset: FirestationAsset | null = getFirestationAssetCache();
  let lastSample: TerrainSample | null = null;
  let lastTerrainSurface: TerrainRenderSurface | null = null;
  let lastTerrainWater: TerrainWaterData | null = null;
  let assetRebuildPending = false;
  let lastTerrainSize: { width: number; depth: number } | null = null;
  let structureOverlayGroup: THREE.Group | null = null;
  let lastStructureRevision = -1;
  let lastStructureOverlayKey = "";
  let treeBurnController: TreeBurnController | null = null;
  let cameraLockedToTerrain = false;
  const applyTerrainCameraConstraints = (): boolean => {
    if (!lastTerrainSurface) {
      return false;
    }
    const changed = constrainCameraToTerrain(camera, controls.target, lastTerrainSurface, {
      targetGroundClearance: TERRAIN_CAMERA_TARGET_GROUND_CLEARANCE,
      cameraGroundClearance: TERRAIN_CAMERA_BODY_GROUND_CLEARANCE
    });
    if (changed) {
      markCameraMotion();
    }
    return changed;
  };
  const yearDays = Math.max(1, Math.floor((world.climateTimeline?.daysPerYear ?? 360) || 360));
  const initialSeasonT01 = wrap01((world.careerDay ?? 0) / yearDays);
  const terrainClimateUniforms: TerrainClimateUniforms = {
    uRisk01: { value: 0.35 },
    uSeasonT01: { value: initialSeasonT01 },
    uWorldSeed: { value: world.seed ?? 0 }
  };
  let seasonVisualState: SeasonVisualState = {
    seasonT01: initialSeasonT01,
    risk01: 0.35,
    mode: "auto"
  };
  let seasonalRainState: SeasonalRainState | null = null;
  let environmentTarget: EnvironmentSignalState = {
    seasonT01: initialSeasonT01,
    risk01: 0.35,
    fireLoad01: computeFireLoad01(world.lastActiveFires, world.grid.totalTiles)
  };
  let environmentCurrent: EnvironmentSignalState = { ...environmentTarget };
  let lastEnvironmentApplied: EnvironmentSignalState | null = null;
  let currentEnvironmentPalette = buildEnvironmentPalette(environmentCurrent);
  let lastLightingApplied: LightingDirectorState | null = null;
  let lastDynamicEnvironmentKey = "";
  let activeShadowLightCount = THREE_TEST_SHADOWS_ENABLED ? 1 : 0;
  let shadowRefreshPendingForFrame = false;
  let shadowRefreshCount = 0;
  const shadowBlendController = new TerrainShadowBlendController({
    mapSize: THREE_TEST_SHADOW_MAP_SIZE,
    viewPadding: THREE_TEST_SHADOW_VIEW_PADDING,
    heightPadding: THREE_TEST_SHADOW_HEIGHT_PADDING,
    minExtent: THREE_TEST_SHADOW_MIN_EXTENT,
    maxTerrainRatio: THREE_TEST_SHADOW_MAX_TERRAIN_RATIO,
    extentEpsilon: THREE_TEST_SHADOW_EXTENT_EPSILON,
    farEpsilon: THREE_TEST_SHADOW_FAR_EPSILON,
    directionStepDeg: THREE_TEST_SHADOW_DIRECTION_STEP_DEG,
    blendDurationMs: THREE_TEST_SHADOW_BLEND_DURATION_MS,
    minimumSteadyHoldMs: THREE_TEST_SHADOW_MINIMUM_STEADY_HOLD_MS
  });
  const glareProjection = new THREE.Vector3();
  const glareForward = new THREE.Vector3();
  const getCurrentLightingInput = (): LightingDirectorInput => {
    return {
      seasonT01: environmentCurrent.seasonT01,
      risk01: environmentCurrent.risk01,
      careerDay: world.careerDay ?? 0,
      windDx: world.wind?.dx ?? 0,
      windDy: world.wind?.dy ?? 0,
      windStrength: world.wind?.strength ?? 0,
      rainIntensity01: seasonalRainState?.visualIntensity01 ?? 0,
      rainSeed: seasonalRainState?.event?.seed,
      worldSeed: world.seed,
      timeSpeedValue: getResolvedTimeSpeedValue(world)
    };
  };
  const collectFarSidePerimeterDistances = (): { min: number; max: number; terrainSpan: number; focusDistance: number } => {
    const focusDistance = Math.max(1, camera.position.distanceTo(controls.target));
    const terrainWidth = lastTerrainSize?.width ?? focusDistance * 1.8;
    const terrainDepth = lastTerrainSize?.depth ?? focusDistance * 1.8;
    const terrainSpan = Math.max(terrainWidth, terrainDepth);
    const halfWidth = terrainWidth * 0.5;
    const halfDepth = terrainDepth * 0.5;
    const sampleY = controls.target.y;
    let viewDirX = controls.target.x - camera.position.x;
    let viewDirY = controls.target.y - camera.position.y;
    let viewDirZ = controls.target.z - camera.position.z;
    const viewDirLength = Math.max(1e-4, Math.hypot(viewDirX, viewDirY, viewDirZ));
    viewDirX /= viewDirLength;
    viewDirY /= viewDirLength;
    viewDirZ /= viewDirLength;
    let farMin = Number.POSITIVE_INFINITY;
    let farMax = 0;
    let farCount = 0;
    const accumulateFarDistance = (x: number, z: number, relaxed = false): void => {
      const offsetX = x - controls.target.x;
      const offsetY = sampleY - controls.target.y;
      const offsetZ = z - controls.target.z;
      const forward = offsetX * viewDirX + offsetY * viewDirY + offsetZ * viewDirZ;
      if (!relaxed && forward < -terrainSpan * 0.04) {
        return;
      }
      const dist = Math.hypot(camera.position.x - x, camera.position.y - sampleY, camera.position.z - z);
      farMin = Math.min(farMin, dist);
      farMax = Math.max(farMax, dist);
      farCount += 1;
    };
    accumulateFarDistance(-halfWidth, -halfDepth);
    accumulateFarDistance(0, -halfDepth);
    accumulateFarDistance(halfWidth, -halfDepth);
    accumulateFarDistance(halfWidth, 0);
    accumulateFarDistance(halfWidth, halfDepth);
    accumulateFarDistance(0, halfDepth);
    accumulateFarDistance(-halfWidth, halfDepth);
    accumulateFarDistance(-halfWidth, 0);
    if (farCount === 0) {
      farMin = Number.POSITIVE_INFINITY;
      farMax = 0;
      accumulateFarDistance(-halfWidth, -halfDepth, true);
      accumulateFarDistance(0, -halfDepth, true);
      accumulateFarDistance(halfWidth, -halfDepth, true);
      accumulateFarDistance(halfWidth, 0, true);
      accumulateFarDistance(halfWidth, halfDepth, true);
      accumulateFarDistance(0, halfDepth, true);
      accumulateFarDistance(-halfWidth, halfDepth, true);
      accumulateFarDistance(-halfWidth, 0, true);
    }
    return {
      min: farMin,
      max: farMax,
      terrainSpan,
      focusDistance
    };
  };
  const syncCinematicFogDistance = (fogDensity: number): void => {
    const densityScale = THREE.MathUtils.clamp(
      fogDensity / Math.max(0.0001, THREE_TEST_CINEMATIC_GRADE_CONFIG.fogDensity),
      0.75,
      1.85
    );
    const { min: farSideMin, max: farSideMax, terrainSpan, focusDistance } = collectFarSidePerimeterDistances();
    const focusBuffer = Math.max(16, terrainSpan * 0.08);
    const startGap = Math.max(focusBuffer, (farSideMin - focusDistance) * 0.35);
    const fullGap = Math.max(
      startGap + Math.max(14, terrainSpan * 0.08),
      terrainSpan * 0.18,
      (farSideMax - focusDistance) * 0.92
    );
    cinematicFog.near = Math.max(
      focusDistance + 10,
      focusDistance + startGap / Math.pow(densityScale, 0.18)
    );
    cinematicFog.far = Math.max(
      cinematicFog.near + 14,
      focusDistance + fullGap / Math.pow(densityScale, 0.72)
    );
    waterSystem.setFog(cinematicFog.color.getHex(), cinematicFog.near, cinematicFog.far);
  };
  const syncFogState = (lighting: LightingDirectorState | null): void => {
    scene.fog = environmentFogEnabled ? cinematicFog : null;
    const fogColorHex = lighting ? rgbToHex(lighting.fogColor) : cinematicFog.color.getHex();
    postPipeline?.setFogColor(fogColorHex);
    if (!environmentFogEnabled) {
      postPipeline?.setHeightHazeStrength(0);
      waterSystem.setFog(fogColorHex, 1_000_000, 1_000_001);
      return;
    }
    if (lighting) {
      cinematicFog.color.set(fogColorHex);
      syncCinematicFogDistance(lighting.fogDensity);
      postPipeline?.setHeightHazeStrength(lighting.hazeStrength);
      return;
    }
    postPipeline?.setHeightHazeStrength(THREE_TEST_CINEMATIC_GRADE_CONFIG.heightHazeStrength);
    waterSystem.setFog(cinematicFog.color.getHex(), cinematicFog.near, cinematicFog.far);
  };
  const setEnvironmentFogEnabled = (enabled: boolean): void => {
    environmentFogEnabled = enabled;
    applyCinematicLook(cinematicGradeEnabled);
    syncFogState(lastLightingApplied);
  };
  const getEnvironmentFogEnabled = (): boolean => environmentFogEnabled;
  const setRoadHighContrastEnabled = (enabled: boolean): void => {
    roadHighContrastEnabled = enabled;
    if (terrainMesh) {
      setTerrainRoadHighContrast(terrainMesh, enabled);
      markSatelliteMinimapVisualsDirty();
    }
  };
  const getRoadHighContrastEnabled = (): boolean => roadHighContrastEnabled;
  let resolveCameraInteracting = (): boolean => false;
  const requestShadowRefresh = (): void => {
    shadowBlendController.requestRefresh();
  };
  const configureShadowBlendLight = (
    light: THREE.DirectionalLight,
    slot: TerrainShadowLightSlot,
    shadowExtent: number,
    shadowFar: number
  ): void => {
    light.position.copy(slot.position);
    light.target.position.copy(slot.target);
    const shadowCam = light.shadow.camera as THREE.OrthographicCamera;
    shadowCam.left = -shadowExtent;
    shadowCam.right = shadowExtent;
    shadowCam.top = shadowExtent;
    shadowCam.bottom = -shadowExtent;
    shadowCam.near = 0.1;
    shadowCam.far = shadowFar;
    shadowCam.updateProjectionMatrix();
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
    if (slot.needsShadowUpdate && light.castShadow) {
      light.shadow.needsUpdate = true;
      slot.needsShadowUpdate = false;
      if (light.visible) {
        renderer.shadowMap.needsUpdate = true;
        shadowRefreshPendingForFrame = true;
      }
    }
  };
  const syncDirectionalLightRig = (lighting: LightingDirectorState): void => {
    const focusPoint = controls.target;
    const cameraDistance = camera.position.distanceTo(focusPoint);
    const shadowState = shadowBlendController.update({
      timeMs: performance.now(),
      sunDirection: lighting.sunDirection,
      focusPoint,
      cameraDistance,
      cameraFovDeg: camera.fov,
      cameraAspect: camera.aspect,
      terrainSize: lastTerrainSize,
      cameraInteracting: resolveCameraInteracting()
    });
    const visualLightDistance = Math.max(shadowState.lightDistance, 18);
    keyLight.position.copy(focusPoint).addScaledVector(lighting.sunDirection, visualLightDistance);
    keyLight.target.position.copy(focusPoint);
    fillLight.position.copy(focusPoint).addScaledVector(lighting.fillDirection, visualLightDistance * 0.72);
    fillLight.target.position.copy(focusPoint);
    keyLight.target.updateMatrixWorld();
    fillLight.target.updateMatrixWorld();
    keyLight.updateMatrixWorld();
    fillLight.updateMatrixWorld();
    keyLight.intensity = THREE_TEST_SHADOWS_ENABLED
      ? lighting.sunIntensity * (1 - THREE_TEST_SHADOW_LIGHT_SHARE)
      : lighting.sunIntensity;
    previousShadowLight.intensity = THREE_TEST_SHADOWS_ENABLED
      ? lighting.sunIntensity * THREE_TEST_SHADOW_LIGHT_SHARE * shadowState.slots[0].weight
      : 0;
    nextShadowLight.intensity = THREE_TEST_SHADOWS_ENABLED
      ? lighting.sunIntensity * THREE_TEST_SHADOW_LIGHT_SHARE * shadowState.slots[1].weight
      : 0;
    previousShadowLight.visible = THREE_TEST_SHADOWS_ENABLED && (shadowState.blendActive || shadowState.slots[0].weight > 0.0001);
    nextShadowLight.visible = THREE_TEST_SHADOWS_ENABLED && (shadowState.blendActive || shadowState.slots[1].weight > 0.0001);
    activeShadowLightCount = THREE_TEST_SHADOWS_ENABLED ? shadowState.activeLightCount : 0;
    configureShadowBlendLight(previousShadowLight, shadowState.slots[0], shadowState.shadowExtent, shadowState.shadowFar);
    configureShadowBlendLight(nextShadowLight, shadowState.slots[1], shadowState.shadowExtent, shadowState.shadowFar);
    waterSystem.setLightDirectionFromKeyLight();
  };
  const applyLightingState = (lighting: LightingDirectorState): void => {
    keyLight.color.set(rgbToHex(lighting.sunColor));
    previousShadowLight.color.set(rgbToHex(lighting.sunColor));
    nextShadowLight.color.set(rgbToHex(lighting.sunColor));
    previousShadowLight.shadow.intensity = lighting.shadowContrast;
    nextShadowLight.shadow.intensity = lighting.shadowContrast;
    fillLight.color.set(rgbToHex(lighting.fillColor));
    fillLight.intensity = lighting.fillIntensity;
    ambient.color.set(rgbToHex(lighting.fogColor));
    ambient.intensity = lighting.ambientIntensity;
    hemisphere.color.set(rgbToHex(mixRgb(lighting.skyTopColor, lighting.skyHorizonColor, 0.24)));
    hemisphere.groundColor.set(
      rgbToHex(mixRgb(lighting.skyHorizonColor, { r: 118, g: 112, b: 102 }, 0.72 + lighting.overcastStrength * 0.08))
    );
    hemisphere.intensity = Math.min(1, 0.48 + lighting.ambientIntensity * 1.18);
    syncDirectionalLightRig(lighting);
  };
  const syncWaterEnvironment = (
    lighting: LightingDirectorState,
    input: LightingDirectorInput = getCurrentLightingInput()
  ): void => {
    const waterSkyHorizon = mixRgb(lighting.skyHorizonColor, lighting.skyTopColor, 0.32);
    waterSystem.setPalette({
      ...currentEnvironmentPalette.water,
      skyTop: lighting.skyTopColor,
      skyHorizon: waterSkyHorizon,
      oceanShallow: lighting.oceanShallowColor,
      oceanDeep: lighting.oceanDeepColor,
      sun: lighting.waterSunColor
    });
    waterSystem.setOceanSurfaceContext(resolveOceanSurfaceContext({
      windDx: input.windDx,
      windDy: input.windDy,
      windStrength01: input.windStrength,
      rainIntensity01: input.rainIntensity01
    }));
  };
  const syncSunGlare = (lighting: LightingDirectorState | null): void => {
    if (!postPipeline || !lighting) {
      return;
    }
    camera.getWorldDirection(glareForward);
    const alignment = Math.max(0, glareForward.dot(lighting.sunDirection));
    if (alignment <= 0.001) {
      postPipeline.setSunGlare(0.5, 0.5, 0);
      return;
    }
    glareProjection.copy(camera.position).addScaledVector(lighting.sunDirection, 2400).project(camera);
    if (glareProjection.z < -1 || glareProjection.z > 1) {
      postPipeline.setSunGlare(0.5, 0.5, 0);
      return;
    }
    const screenX = glareProjection.x * 0.5 + 0.5;
    const screenY = glareProjection.y * 0.5 + 0.5;
    const screenMax = Math.max(Math.abs(glareProjection.x), Math.abs(glareProjection.y));
    if (screenMax >= 1.02) {
      postPipeline.setSunGlare(0.5, 0.5, 0);
      return;
    }
    const screenFade = 1 - THREE.MathUtils.smoothstep(screenMax, 0.72, 1.02);
    const forwardFade = Math.pow(THREE.MathUtils.smoothstep(alignment, 0.55, 0.98), 1.7);
    const glare = Math.max(0, Math.min(0.18, lighting.glareIntensity * forwardFade * screenFade));
    postPipeline.setSunGlare(screenX, screenY, glare, rgbToHex(lighting.sunColor));
  };
  const applyDynamicEnvironmentState = (force = false): void => {
    const input = getCurrentLightingInput();
    const dynamicKey = [
      Math.round(input.seasonT01 / SEASON_VISUAL_EPSILON),
      Math.round(input.risk01 / SEASON_VISUAL_EPSILON),
      input.careerDay,
      input.windDx,
      input.windDy,
      input.windStrength,
      input.rainIntensity01,
      input.rainSeed ?? -1,
      input.worldSeed,
      input.timeSpeedValue,
      currentEnvironmentPalette.signals.fireLoad01
    ].join("|");
    if (!force && dynamicKey === lastDynamicEnvironmentKey) {
      return;
    }
    lastDynamicEnvironmentKey = dynamicKey;
    const lighting = buildLightingDirectorState(input);
    seasonalSky.setState(lighting);
    syncFogState(lighting);
    fireFx.setEnvironmentSignals({
      smoke01: currentEnvironmentPalette.signals.smoke01,
      denseSmoke01: currentEnvironmentPalette.signals.denseSmoke01,
      fireLoad01: currentEnvironmentPalette.signals.fireLoad01,
      orangeGlow01: currentEnvironmentPalette.signals.orangeGlow01,
      sunDirection: lighting.sunDirection,
      sunTint: rgbToHex(lighting.sunColor),
      smokeTint: rgbToHex(lighting.smokeTint)
    });
    applyLightingState(lighting);
    syncWaterEnvironment(lighting, input);
    lastLightingApplied = lighting;
    if (force) {
      requestShadowRefresh();
    }
  };
  applyEnvironmentPalette = (force = false): void => {
    if (!ENABLE_THREE_TEST_SEASONAL_RECOLOR) {
      return;
    }
    const changed =
      !lastEnvironmentApplied ||
      Math.abs(environmentCurrent.seasonT01 - lastEnvironmentApplied.seasonT01) >= SEASON_VISUAL_EPSILON ||
      Math.abs(environmentCurrent.risk01 - lastEnvironmentApplied.risk01) >= SEASON_VISUAL_EPSILON ||
      Math.abs(environmentCurrent.fireLoad01 - lastEnvironmentApplied.fireLoad01) >= SEASON_VISUAL_EPSILON;
    if (!force && !changed) {
      return;
    }
    currentEnvironmentPalette = buildEnvironmentPalette(environmentCurrent);
    hudState.theme = cloneHudTheme(currentEnvironmentPalette.hud.canvas);
    applyDomEnvironmentTheme(currentEnvironmentPalette.hud.dom);
    lastEnvironmentApplied = { ...environmentCurrent };
    applyDynamicEnvironmentState(force);
  };
  if (ENABLE_THREE_TEST_SEASONAL_RECOLOR) {
    applyEnvironmentPalette(true);
  } else {
    currentEnvironmentPalette = buildEnvironmentPalette(environmentCurrent);
    hudState.theme = cloneHudTheme(currentEnvironmentPalette.hud.canvas);
    applyDomEnvironmentTheme(currentEnvironmentPalette.hud.dom);
    applyDynamicEnvironmentState(true);
  }
  const treeSeasonVisualConfig: TreeSeasonVisualConfig = {
    enabled: ENABLE_THREE_TEST_SEASONAL_RECOLOR,
    uniforms: terrainClimateUniforms,
    phaseShiftMax: TREE_PHASE_SHIFT_MAX,
    rateJitter: TREE_RATE_JITTER,
    autumnHueJitter: AUTUMN_HUE_JITTER
  };

  let raf = 0;
  let running = false;
  let simulationAlpha = 1;
  let lastFrameTime = 0;
  let hudScaleX = 1;
  let hudScaleY = 1;
  let lastHudRenderMs = 0;
  let contextLosses = 0;
  let contextRestores = 0;
  const viewProjMatrix = new THREE.Matrix4();
  const invViewProjMatrix = new THREE.Matrix4();
  const hudInvViewProj = new Array<number>(16).fill(0);
  const hudCameraSnapshot = {
    kind: "perspective" as const,
    position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
    invViewProj: hudInvViewProj
  };
  hudState.camera = hudCameraSnapshot;
  let pendingResize: { width: number; height: number } | null = null;
  let adaptiveDpr = Math.max(THREE_TEST_MIN_DPR, Math.min(window.devicePixelRatio ?? 1, THREE_TEST_MAX_DPR));
  let adaptiveDprFallbackAccum = 0;
  let adaptiveDprRecoveryAccum = 0;
  const threePerf: ThreeTestPerfSnapshot = {
    frameMs: 0,
    frameLastMs: 0,
    controlsMs: 0,
    treeBurnMs: 0,
    fireFxMs: 0,
    fireFxDebug: null,
    sceneRenderMs: 0,
    sceneRenderLastMs: 0,
    postMs: 0,
    dofMs: 0,
    hudMs: 0,
    uiRenderMs: 0,
    gpuWorldMs: null,
    gpuShadowRefreshMs: null,
    gpuPostMs: null,
    gpuUiMs: null,
    activeShadowLights: activeShadowLightCount,
    shadowRefreshCount: 0,
    terrainChunkCount: 0,
    terrainVisibleChunkCount: 0,
    terrainCulledInstanceCount: 0,
    roadOverlayTriangles: 0,
    roadOverlaySourceTriangles: 0,
    postPassCount: 0,
    vehicleBufferUploads: 0,
    fps: 0,
    rafGapMs: 0,
    rafGapLastMs: 0,
    rafGapMaxMs: 0,
    hitchCount: 0,
    lastHitchMs: 0,
    terrainSetMs: 0,
    terrainSetLastMs: 0,
    terrainSetMaxMs: 0,
    terrainSetCount: 0,
    terrainSetFastReuseCount: 0,
    terrainSetFullRebuildCount: 0,
    terrainSetFullRebuildReason: "none",
    terrainSetIntent: "initial",
    terrainSetPath: "none",
    terrainSetDominantStep: "none",
    terrainSetMaxDominantStep: "none",
    terrainSetMaxIntent: "none",
    terrainSetMaxPath: "none",
    terrainGeometrySignature: "none",
    terrainGeometrySignatureChanged: false,
    terrainSetPrepareMs: 0,
    terrainSetPrepareLastMs: 0,
    terrainSetStaticPrepareMs: 0,
    terrainSetStaticPrepareLastMs: 0,
    terrainSetStaticPrepareCount: 0,
    terrainSetVisualPrepareMs: 0,
    terrainSetVisualPrepareLastMs: 0,
    terrainSetVisualPrepareCount: 0,
    terrainSetPrepareSkippedCount: 0,
    terrainSetReuseCheckMs: 0,
    terrainSetReuseCheckLastMs: 0,
    terrainSetColorMs: 0,
    terrainSetColorLastMs: 0,
    terrainSetTextureMs: 0,
    terrainSetTextureLastMs: 0,
    terrainSetTextureSwapMs: 0,
    terrainSetTextureSwapLastMs: 0,
    terrainSetRoadSignatureMs: 0,
    terrainSetRoadSignatureLastMs: 0,
    terrainSetStructureMs: 0,
    terrainSetStructureLastMs: 0,
    terrainSetFullDisposeMs: 0,
    terrainSetFullDisposeLastMs: 0,
    terrainSetFullBuildMs: 0,
    terrainSetFullBuildLastMs: 0,
    terrainSetWaterMs: 0,
    terrainSetWaterLastMs: 0,
    terrainRoadRefreshMs: 0,
    terrainRoadRefreshLastMs: 0,
    terrainRoadRefreshCount: 0,
    sceneCalls: 0,
    sceneTriangles: 0,
    sceneLines: 0,
    scenePoints: 0,
    totalCalls: 0,
    memoryGeometries: 0,
    memoryTextures: 0,
    contextLosses: 0,
    contextRestores: 0,
    waterfallCount: 0,
    waterfallCandidateCount: 0,
    waterfallClusterCount: 0,
    waterfallEmittedCount: 0,
    waterfallRejectedVerticalCount: 0,
    waterfallRejectedLongRunCount: 0,
    waterfallWallQuadCount: 0,
    waterfallWallTriangleCount: 0,
    waterfallWallQuadBreakdown: "n/a",
    environmentFogEnabled: true,
    waterfallDebugHighlightEnabled: false,
    waterfallAnchorErrorMean: Number.NaN,
    waterfallAnchorErrorMax: Number.NaN,
    waterfallWallTopGapMean: Number.NaN,
    waterfallWallTopGapMax: Number.NaN
  };
  const smoothPerf = (current: number, next: number): number => (current > 0 ? current * 0.86 + next * 0.14 : next);
  type TerrainSetTimingKey =
    | "prepare"
    | "staticPrepare"
    | "visualPrepare"
    | "reuseCheck"
    | "color"
    | "texture"
    | "textureSwap"
    | "roadSignature"
    | "structure"
    | "fullDispose"
    | "fullBuild"
    | "water";
  const terrainSetTimingFields: Record<TerrainSetTimingKey, { avg: keyof ThreeTestPerfSnapshot; last: keyof ThreeTestPerfSnapshot }> = {
    prepare: { avg: "terrainSetPrepareMs", last: "terrainSetPrepareLastMs" },
    staticPrepare: { avg: "terrainSetStaticPrepareMs", last: "terrainSetStaticPrepareLastMs" },
    visualPrepare: { avg: "terrainSetVisualPrepareMs", last: "terrainSetVisualPrepareLastMs" },
    reuseCheck: { avg: "terrainSetReuseCheckMs", last: "terrainSetReuseCheckLastMs" },
    color: { avg: "terrainSetColorMs", last: "terrainSetColorLastMs" },
    texture: { avg: "terrainSetTextureMs", last: "terrainSetTextureLastMs" },
    textureSwap: { avg: "terrainSetTextureSwapMs", last: "terrainSetTextureSwapLastMs" },
    roadSignature: { avg: "terrainSetRoadSignatureMs", last: "terrainSetRoadSignatureLastMs" },
    structure: { avg: "terrainSetStructureMs", last: "terrainSetStructureLastMs" },
    fullDispose: { avg: "terrainSetFullDisposeMs", last: "terrainSetFullDisposeLastMs" },
    fullBuild: { avg: "terrainSetFullBuildMs", last: "terrainSetFullBuildLastMs" },
    water: { avg: "terrainSetWaterMs", last: "terrainSetWaterLastMs" }
  };
  const resetTerrainSetLastTimings = (): void => {
    for (const field of Object.values(terrainSetTimingFields)) {
      (threePerf[field.last] as number) = 0;
    }
    threePerf.terrainRoadRefreshLastMs = 0;
    threePerf.terrainSetDominantStep = "none";
  };
  const recordTerrainSetTiming = (key: TerrainSetTimingKey, ms: number): void => {
    const field = terrainSetTimingFields[key];
    (threePerf[field.last] as number) = ms;
    (threePerf[field.avg] as number) = smoothPerf(threePerf[field.avg] as number, ms);
  };
  const getDominantTerrainSetStep = (): string => {
    let dominant = "none";
    let dominantMs = 0;
    for (const [key, field] of Object.entries(terrainSetTimingFields) as Array<
      [TerrainSetTimingKey, { avg: keyof ThreeTestPerfSnapshot; last: keyof ThreeTestPerfSnapshot }]
    >) {
      const ms = threePerf[field.last] as number;
      if (ms > dominantMs) {
        dominant = key;
        dominantMs = ms;
      }
    }
    return dominant;
  };
  const normalizeTerrainUpdateIntent = (
    intent: ThreeTestTerrainUpdateIntent | undefined,
    fastUpdate: boolean
  ): NormalizedThreeTestTerrainUpdateIntent => ({
    label: intent?.label ?? (fastUpdate ? "fast-unspecified" : "full"),
    geometry: intent?.geometry ?? !fastUpdate,
    surfaceColor: intent?.surfaceColor ?? true,
    vegetation: intent?.vegetation ?? false,
    roads: intent?.roads ?? true,
    structure: intent?.structure ?? true,
    debug: intent?.debug ?? false,
    fireVisual: intent?.fireVisual ?? false,
    dirtyTileBounds: intent?.dirtyTileBounds
  });
  const isOnlyTerrainUpdateIntent = (
    intent: NormalizedThreeTestTerrainUpdateIntent,
    key: "roads" | "structure" | "vegetation"
  ): boolean => {
    const hasTarget = intent[key];
    if (!hasTarget) {
      return false;
    }
    return (
      !intent.geometry &&
      !intent.surfaceColor &&
      !intent.debug &&
      !intent.fireVisual &&
      (key === "roads" || !intent.roads) &&
      (key === "structure" || !intent.structure) &&
      (key === "vegetation" || !intent.vegetation)
    );
  };
  const isFireVisualOnlyTerrainUpdateIntent = (
    intent: NormalizedThreeTestTerrainUpdateIntent
  ): boolean =>
    intent.fireVisual &&
    !intent.geometry &&
    !intent.surfaceColor &&
    !intent.vegetation &&
    !intent.roads &&
    !intent.structure &&
    !intent.debug;
  let lastRafAt = 0;
  let lastPresentedAt = 0;

  const sampleSurfaceHeightAtTileCoord = (tileX: number, tileY: number): number | null =>
    lastTerrainSurface ? lastTerrainSurface.heightAtTileCoord(tileX, tileY) * lastTerrainSurface.heightScale : null;

  const sampleSurfaceHeightAtTile = (tileX: number, tileY: number): number | null =>
    lastTerrainSurface ? lastTerrainSurface.heightAtTile(tileX, tileY) * lastTerrainSurface.heightScale : null;

  const toWorldCommandPoint = (tileX: number, tileY: number, lift: number): THREE.Vector3 | null => {
    if (!lastTerrainSurface) {
      return null;
    }
    const y = sampleSurfaceHeightAtTileCoord(tileX, tileY);
    if (y === null) {
      return null;
    }
    const x = lastTerrainSurface.toRenderedWorldX(tileX);
    const z = lastTerrainSurface.toRenderedWorldZ(tileY);
    const worldY = y + lift;
    return new THREE.Vector3(x, worldY, z);
  };

  const evacuationPreviewMaterial = new THREE.LineBasicMaterial({
    color: 0xf6d36d,
    transparent: true,
    opacity: 0.82
  });
  const evacuationActiveMaterial = new THREE.LineBasicMaterial({
    color: 0x66c7ff,
    transparent: true,
    opacity: 0.9
  });
  const evacuationObstacleMaterial = new THREE.MeshStandardMaterial({
    color: 0x2f2a24,
    roughness: 0.9,
    metalness: 0.03
  });
  const evacuationObstacleGeometry = new THREE.BoxGeometry(0.28, 0.1, 0.28);

  const resolveEvacuationVehicleColor = (colorSeed: number, destroyed: boolean): THREE.Color => {
    if (destroyed) {
      return new THREE.Color(EVACUATION_CAR_DESTROYED_COLOR);
    }
    const index = Math.abs(Math.trunc(colorSeed)) % EVACUATION_CAR_COLORS.length;
    return new THREE.Color(EVACUATION_CAR_COLORS[index]);
  };

  const resolveEvacuationVehicleAccentColor = (colorSeed: number, destroyed: boolean): THREE.Color => {
    if (destroyed) {
      return new THREE.Color(EVACUATION_CAR_DESTROYED_ACCENT_COLOR);
    }
    const index = Math.abs((Math.trunc(colorSeed) ^ 0x9e3779b9) | 0) % EVACUATION_CAR_ACCENT_COLORS.length;
    return new THREE.Color(EVACUATION_CAR_ACCENT_COLORS[index]);
  };

  let lastEvacuationStaticKey = "";
  const clearEvacuationVisuals = (): void => {
    while (evacuationVisualGroup.children.length > 0) {
      const child = evacuationVisualGroup.children[evacuationVisualGroup.children.length - 1];
      if (!child) {
        continue;
      }
      evacuationVisualGroup.remove(child);
      if (child instanceof THREE.Line || (child instanceof THREE.Mesh && child.geometry !== evacuationObstacleGeometry)) {
        child.geometry.dispose();
      }
    }
    lastEvacuationStaticKey = "";
  };

  const updateEvacuationVisuals = (): void => {
    clearEvacuationVisuals();
    if (!lastTerrainSurface) {
      evacuationVehicleLayer.update(null, []);
      return;
    }
    const model = buildEvacuationRenderModel(world);
    const vehicleInstances: VehicleModelInstance[] = [];
    const staticKey = [
      ...model.routes.map((route) => `${route.active ? 1 : 0}:${route.tiles.map((tile) => `${tile.x},${tile.y}`).join(";")}`),
      ...model.obstacles.map((obstacle) => `o:${obstacle.x},${obstacle.y}`)
    ].join("|");
    if (staticKey !== lastEvacuationStaticKey) {
      clearEvacuationVisuals();
      lastEvacuationStaticKey = staticKey;
      for (const route of model.routes) {
        const points: THREE.Vector3[] = [];
        for (const tile of route.tiles) {
          const point = toWorldCommandPoint(tile.x + 0.5, tile.y + 0.5, route.active ? 0.18 : 0.14);
          if (point) {
            points.push(point);
          }
        }
        if (points.length >= 2) {
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(points),
            route.active ? evacuationActiveMaterial : evacuationPreviewMaterial
          );
          line.frustumCulled = true;
          line.geometry.computeBoundingSphere();
          line.renderOrder = route.active ? 9 : 8;
          evacuationVisualGroup.add(line);
        }
      }
      for (const obstacle of model.obstacles) {
        const point = toWorldCommandPoint(obstacle.x + 0.5, obstacle.y + 0.5, 0.12);
        if (point) {
          const mesh = new THREE.Mesh(evacuationObstacleGeometry, evacuationObstacleMaterial);
          mesh.position.copy(point);
          mesh.renderOrder = 10;
          evacuationVisualGroup.add(mesh);
        }
      }
    }
    for (const vehicle of model.vehicles) {
      const alpha = clamp01(simulationAlpha);
      vehicleInstances.push({
        x: vehicle.prevX + (vehicle.x - vehicle.prevX) * alpha + 0.5,
        y: vehicle.prevY + (vehicle.y - vehicle.prevY) * alpha + 0.5,
        yaw: vehicle.yaw,
        color: resolveEvacuationVehicleColor(vehicle.colorSeed, vehicle.destroyed),
        modelAccentColor: resolveEvacuationVehicleAccentColor(vehicle.colorSeed, vehicle.destroyed)
      });
    }
    evacuationVehicleLayer.update(lastTerrainSurface, vehicleInstances);
  };

  const acquireScoreFlowPulse = (): ScoreFlowPulse => {
    let candidate = scoreFlowPulses[0];
    for (let i = 1; i < scoreFlowPulses.length; i += 1) {
      if (scoreFlowPulses[i].endAt < candidate.endAt) {
        candidate = scoreFlowPulses[i];
      }
    }
    return candidate;
  };

  const spawnScoreFlowPulse = (kind: "property" | "lives", tileX: number, tileY: number, time: number): void => {
    const worldPoint = toWorldCommandPoint(tileX + 0.5, tileY + 0.5, SCORE_FLOW_PULSE_LIFT);
    if (!worldPoint) {
      return;
    }
    const pulse = acquireScoreFlowPulse();
    pulse.startAt = time;
    pulse.endAt = time + SCORE_FLOW_PULSE_DURATION_MS;
    pulse.baseScale = kind === "property" ? 0.95 : 1.18;
    pulse.mesh.visible = true;
    pulse.mesh.position.copy(worldPoint);
    pulse.mesh.scale.setScalar(pulse.baseScale);
    pulse.material.color.setHex(kind === "property" ? 0xffa357 : 0xff6f74);
    pulse.material.opacity = kind === "property" ? 0.82 : 0.9;
  };

  const updateScoreFlowPulses = (time: number): void => {
    const flowEvents = world.scoring?.flowEvents ?? [];
    for (const event of flowEvents) {
      if (event.id <= lastConsumedScoreFlowEventId) {
        continue;
      }
      if (
        (event.kind === "property" || event.kind === "lives") &&
        Number.isFinite(event.tileX) &&
        Number.isFinite(event.tileY)
      ) {
        spawnScoreFlowPulse(event.kind, event.tileX!, event.tileY!, time);
      }
      lastConsumedScoreFlowEventId = Math.max(lastConsumedScoreFlowEventId, event.id);
    }

    for (const pulse of scoreFlowPulses) {
      if (time >= pulse.endAt) {
        pulse.mesh.visible = false;
        pulse.material.opacity = 0;
        continue;
      }
      if (time < pulse.startAt) {
        continue;
      }
      const duration = Math.max(1, pulse.endAt - pulse.startAt);
      const progress = Math.max(0, Math.min(1, (time - pulse.startAt) / duration));
      pulse.mesh.visible = true;
      pulse.mesh.scale.setScalar(pulse.baseScale * (0.65 + progress * 1.75));
      pulse.material.opacity = (1 - progress) * (pulse.baseScale > 1 ? 0.88 : 0.78);
    }
  };

  const getInterpolatedUnitTile = (unit: (typeof world.units)[number]): { x: number; y: number } => {
    const alpha = clamp01(simulationAlpha);
    return {
      x: unit.prevX + (unit.x - unit.prevX) * alpha,
      y: unit.prevY + (unit.y - unit.prevY) * alpha
    };
  };

  const acquireUnitCommandVisual = (unitId: number): UnitCommandVisual => {
    const existing = unitCommandVisuals.get(unitId);
    if (existing) {
      return existing;
    }
    const line = new THREE.Line(new THREE.BufferGeometry(), unitCommandPathMaterial);
    line.frustumCulled = false;
    line.renderOrder = 5;
    const destination = new THREE.Mesh(unitCommandMarkerGeometry, unitCommandMarkerMaterial);
    destination.frustumCulled = false;
    destination.renderOrder = 6;
    unitCommandVisualGroup.add(line, destination);
    const created: UnitCommandVisual = { line, destination };
    unitCommandVisuals.set(unitId, created);
    return created;
  };

  const removeUnitCommandVisual = (unitId: number): void => {
    const existing = unitCommandVisuals.get(unitId);
    if (!existing) {
      return;
    }
    unitCommandVisualGroup.remove(existing.line, existing.destination);
    existing.line.geometry.dispose();
    unitCommandVisuals.delete(unitId);
  };

  const clearUnitCommandVisuals = (): void => {
    Array.from(unitCommandVisuals.keys()).forEach((unitId) => removeUnitCommandVisual(unitId));
  };

  const updateUnitCommandVisuals = (): void => {
    if (!lastTerrainSize || world.units.length === 0) {
      clearUnitCommandVisuals();
      return;
    }
    const activeUnitIds = new Set<number>();
    for (let i = 0; i < world.units.length; i += 1) {
      const unit = world.units[i];
      if (!unit.selected || !unit.target) {
        continue;
      }
      const tilePoints: Array<{ x: number; y: number }> = [];
      const interpolated = getInterpolatedUnitTile(unit);
      tilePoints.push({ x: interpolated.x, y: interpolated.y });
      if (unit.pathIndex < unit.path.length) {
        for (let pathIndex = unit.pathIndex; pathIndex < unit.path.length; pathIndex += 1) {
          const waypoint = unit.path[pathIndex];
          tilePoints.push({ x: waypoint.x + 0.5, y: waypoint.y + 0.5 });
        }
      }
      const destinationX = unit.target.x + 0.5;
      const destinationY = unit.target.y + 0.5;
      const tail = tilePoints[tilePoints.length - 1] ?? null;
      if (!tail || Math.hypot(tail.x - destinationX, tail.y - destinationY) > 0.01) {
        tilePoints.push({ x: destinationX, y: destinationY });
      }

      const worldPoints: THREE.Vector3[] = [];
      for (let pointIndex = 0; pointIndex < tilePoints.length; pointIndex += 1) {
        const tilePoint = tilePoints[pointIndex];
        const worldPoint = toWorldCommandPoint(tilePoint.x, tilePoint.y, UNIT_COMMAND_PATH_LIFT);
        if (worldPoint) {
          worldPoints.push(worldPoint);
        }
      }
      if (worldPoints.length <= 0) {
        continue;
      }
      const visual = acquireUnitCommandVisual(unit.id);
      activeUnitIds.add(unit.id);
      if (worldPoints.length >= 2) {
        const lineGeometry = visual.line.geometry;
        const positionAttr = lineGeometry.getAttribute("position");
        if (!positionAttr || positionAttr.count < worldPoints.length) {
          lineGeometry.dispose();
          visual.line.geometry = new THREE.BufferGeometry().setFromPoints(worldPoints);
        } else {
          lineGeometry.setFromPoints(worldPoints);
          lineGeometry.setDrawRange(0, worldPoints.length);
        }
        visual.line.geometry.computeBoundingSphere();
        visual.line.visible = true;
      } else {
        visual.line.visible = false;
      }
      const destinationPoint = toWorldCommandPoint(destinationX, destinationY, UNIT_COMMAND_MARKER_LIFT);
      if (destinationPoint) {
        visual.destination.visible = true;
        visual.destination.position.copy(destinationPoint);
      } else {
        visual.destination.visible = false;
      }
    }
    Array.from(unitCommandVisuals.keys()).forEach((unitId) => {
      if (!activeUnitIds.has(unitId)) {
        removeUnitCommandVisual(unitId);
      }
    });
  };

  const ensureTerrainVertexColorsWhite = (geometry: THREE.BufferGeometry): void => {
    if (geometry.userData?.terrainVertexColorsWhite === true) {
      return;
    }
    const positionAttr = geometry.getAttribute("position");
    if (!positionAttr) {
      return;
    }
    const colorAttr = geometry.getAttribute("color");
    const expectedLength = positionAttr.count * 3;
    if (!colorAttr || colorAttr.count !== positionAttr.count || !("array" in colorAttr)) {
      const colors = new Float32Array(expectedLength);
      colors.fill(1);
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.userData.terrainVertexColorsWhite = true;
      return;
    }
    const colorArray = colorAttr.array;
    if (colorArray.length !== expectedLength) {
      const colors = new Float32Array(expectedLength);
      colors.fill(1);
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      geometry.userData.terrainVertexColorsWhite = true;
      return;
    }
    colorArray.fill(1);
    colorAttr.needsUpdate = true;
    geometry.userData.terrainVertexColorsWhite = true;
  };

  const disposeStructureOverlay = (): void => {
    if (!structureOverlayGroup) {
      return;
    }
    scene.remove(structureOverlayGroup);
    structureOverlayGroup.traverse((child) => {
      if (!(child instanceof THREE.Mesh)) {
        return;
      }
      child.geometry.dispose();
      if (Array.isArray(child.material)) {
        child.material.forEach((material) => material.dispose());
      } else {
        child.material.dispose();
      }
    });
    structureOverlayGroup = null;
  };

  const rebuildStructureOverlay = (
    sample: TerrainSample,
    surface: TerrainRenderSurface | null = lastTerrainSurface
  ): void => {
    const structureRevision = sample.structureRevision ?? -1;
    const watchTowerVisualKey = (sample.watchTowers ?? [])
      .map((tower) => `${tower.id}:${tower.level}:${tower.active ? 1 : 0}:${tower.x.toFixed(2)},${tower.y.toFixed(2)}`)
      .join("|");
    const waterTowerVisualKey = (sample.waterTowers ?? [])
      .filter((tower) => tower.active)
      .map((tower) => `${tower.id}:${tower.x.toFixed(2)},${tower.y.toFixed(2)}`)
      .join("|");
    const structureAssetKey = THREE_TEST_DETAILED_STRUCTURES_ENABLED
      ? `${houseAssets?.variants.length ?? 0}:${firestationAsset ? 1 : 0}:detailed:procedural-towers-v1:${watchTowerVisualKey}:${waterTowerVisualKey}`
      : `simple:procedural-towers-v1:${watchTowerVisualKey}:${waterTowerVisualKey}`;
    const structureOverlayKey = `${sample.cols}x${sample.rows}:${sample.worldSeed ?? -1}:${structureAssetKey}`;
    const shouldRenderDynamic = sample.dynamicStructures === true;
    if (!shouldRenderDynamic) {
      disposeStructureOverlay();
      lastStructureRevision = structureRevision;
      lastStructureOverlayKey = structureOverlayKey;
      return;
    }
    if (
      structureRevision === lastStructureRevision &&
      structureOverlayKey === lastStructureOverlayKey &&
      structureOverlayGroup &&
      structureOverlayGroup.parent === scene
    ) {
      return;
    }
    disposeStructureOverlay();
    if (!sample.tileTypes || !surface || sample.cols <= 0 || sample.rows <= 0) {
      lastStructureRevision = structureRevision;
      lastStructureOverlayKey = structureOverlayKey;
      return;
    }

    const houseId = TILE_TYPE_IDS.house;
    const baseId = TILE_TYPE_IDS.base;
    const cols = sample.cols;
    const rows = sample.rows;
    const tileTypes = sample.tileTypes;
    const roadEdges = sample.roadEdges;
    const clampToRange = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
    const noiseAt = (value: number): number => {
      const s = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
      return s - Math.floor(s);
    };
    const pickHouseRotation = (
      tileX: number,
      tileY: number,
      seed: number
    ): number => {
      const isRoadLike = (x: number, y: number): boolean => {
        if (x < 0 || y < 0 || x >= cols || y >= rows) {
          return false;
        }
        const typeId = tileTypes[y * cols + x];
        return typeId === TILE_TYPE_IDS.road || typeId === baseId;
      };
      const reference = findBestRoadReferenceForPlot(
        tileX,
        tileY,
        isRoadLike,
        (x, y) => {
          if (!roadEdges || x < 0 || y < 0 || x >= cols || y >= rows) {
            return 0;
          }
          return roadEdges[y * cols + x] ?? 0;
        }
      );
      return pickHouseRotationFromRoadMask(reference?.roadMask ?? 0, seed);
    };
    const elevationAt = (tileX: number, tileY: number): number => {
      const clampedX = clampToRange(tileX, 0, cols);
      const clampedY = clampToRange(tileY, 0, rows);
      return surface.heightAtTileCoord(clampedX, clampedY) * surface.heightScale;
    };

    type OverlayHouseSpot = {
      tileX: number;
      tileY: number;
      x: number;
      z: number;
      footprintX: number;
      footprintZ: number;
      rotation: number;
      seed: number;
      supportBottom: number;
      supportTop: number;
      variantKey: string | null;
      variantSource: string | null;
      lifecycleStageId: number;
      lifecycleStep: number;
    };
    const houseSpots: OverlayHouseSpot[] = [];
    let baseMinX = cols;
    let baseMaxX = -1;
    let baseMinY = rows;
    let baseMaxY = -1;
    for (let idx = 0; idx < tileTypes.length; idx += 1) {
      const type = tileTypes[idx];
      if (type === houseId) {
        const tileX = idx % cols;
        const tileY = Math.floor(idx / cols);
        const seed = sample.houseStyleSeeds?.[idx] ?? (idx >>> 0);
        const lifecycleStageId = sample.houseLifecycleStages?.[idx] ?? getBuildingLifecycleStageId("roofed");
        const lifecycleStage = getBuildingLifecycleStageFromId(lifecycleStageId);
        const lifecycleStep = sample.houseLifecycleSteps?.[idx] ?? 0;
        const rotation = pickHouseRotation(tileX, tileY, seed);
        const footprint = pickHouseFootprint(seed);
        const bounds = getHouseFootprintBounds(tileX, tileY, rotation, footprint);
        const minX = clampToRange(bounds.minX, 0, cols - 1);
        const maxX = clampToRange(bounds.maxX, 0, cols - 1);
        const minY = clampToRange(bounds.minY, 0, rows - 1);
        const maxY = clampToRange(bounds.maxY, 0, rows - 1);
        const grounding = resolveStructureGrounding({
          surface: sample,
          minTileX: minX,
          maxTileX: maxX,
          minTileY: minY,
          maxTileY: maxY,
          heightScale: surface.heightScale,
          heightAtTileCoord: surface.heightAtTileCoord
        });
        houseSpots.push({
          tileX,
          tileY,
          x: surface.toWorldX(tileX + 0.5),
          z: surface.toWorldZ(tileY + 0.5),
          footprintX: bounds.width,
          footprintZ: bounds.depth,
          rotation,
          seed,
          supportBottom: grounding.foundationBottom,
          supportTop: grounding.foundationTop,
          variantKey: getProceduralHouseVariantKey(footprint.name ?? "procedural", lifecycleStage, lifecycleStep),
          variantSource: footprint.source ?? null,
          lifecycleStageId,
          lifecycleStep
        });
        continue;
      }
      if (type !== baseId) {
        continue;
      }
      const tileX = idx % cols;
      const tileY = Math.floor(idx / cols);
      baseMinX = Math.min(baseMinX, tileX);
      baseMaxX = Math.max(baseMaxX, tileX);
      baseMinY = Math.min(baseMinY, tileY);
      baseMaxY = Math.max(baseMaxY, tileY);
    }
    const activeBuildingLots = sample.buildingLots ?? [];
    for (let i = 0; i < activeBuildingLots.length; i += 1) {
      const lot = activeBuildingLots[i] as RenderBuildingLot;
      const anchorIndex = lot.anchorIndex;
      const tileX = anchorIndex % cols;
      const tileY = Math.floor(anchorIndex / cols);
      const seed = lot.styleSeed;
      const lifecycleStageId = lot.stageId;
      const lifecycleStage = getBuildingLifecycleStageFromId(lifecycleStageId);
      const lifecycleStep = lot.stageStep ?? 0;
      const rotation = pickHouseRotation(tileX, tileY, seed);
      const footprint = pickHouseFootprint(seed);
      const bounds = getHouseFootprintBounds(tileX, tileY, rotation, footprint);
      const minX = clampToRange(bounds.minX, 0, cols - 1);
      const maxX = clampToRange(bounds.maxX, 0, cols - 1);
      const minY = clampToRange(bounds.minY, 0, rows - 1);
      const maxY = clampToRange(bounds.maxY, 0, rows - 1);
      const grounding = resolveStructureGrounding({
        surface: sample,
        minTileX: minX,
        maxTileX: maxX,
        minTileY: minY,
        maxTileY: maxY,
        heightScale: surface.heightScale,
        heightAtTileCoord: surface.heightAtTileCoord
      });
      houseSpots.push({
        tileX,
        tileY,
        x: surface.toWorldX(tileX + 0.5),
        z: surface.toWorldZ(tileY + 0.5),
        footprintX: bounds.width,
        footprintZ: bounds.depth,
        rotation,
        seed,
        supportBottom: grounding.foundationBottom,
        supportTop: grounding.foundationTop,
        variantKey: getProceduralHouseVariantKey(footprint.name ?? "procedural", lifecycleStage, lifecycleStep),
        variantSource: footprint.source ?? null,
        lifecycleStageId,
        lifecycleStep
      });
    }

    const group = new THREE.Group();
    group.name = "dynamic-structures";
    const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
    const houseMaterial = new THREE.MeshStandardMaterial({ color: 0xc19a66, roughness: 0.82, metalness: 0.06 });
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xa0a7ad, roughness: 0.74, metalness: 0.12 });
    const foundationMaterial = new THREE.MeshStandardMaterial({ color: 0x4b4036, roughness: 0.95, metalness: 0 });
    const dummy = new THREE.Object3D();

    if (houseSpots.length > 0) {
      type OverlayHouseVariant = HouseAssets["variants"][number];
      type HouseBatchInstance = {
        spot: OverlayHouseSpot;
        scaleX: number;
        scaleY: number;
        scaleZ: number;
        baseY: number;
      };
      type FoundationInstance = {
        x: number;
        y: number;
        z: number;
        scaleX: number;
        scaleY: number;
        scaleZ: number;
        rotation: number;
        tileX: number;
        tileY: number;
      };
      const availableHouseVariants = THREE_TEST_DETAILED_STRUCTURES_ENABLED ? houseAssets?.variants ?? [] : [];
      const houseByKey = new Map<string, OverlayHouseVariant[]>();
      const houseBySource = new Map<string, OverlayHouseVariant[]>();
      const houseByTheme: Record<OverlayHouseVariant["theme"], OverlayHouseVariant[]> = {
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
        if (!variant.buildKey) {
          return;
        }
        const key = variant.buildKey.toLowerCase();
        const list = houseByKey.get(key);
        if (list) {
          list.push(variant);
        } else {
          houseByKey.set(key, [variant]);
        }
      });
      const pickHouseVariant = (spot: OverlayHouseSpot): OverlayHouseVariant | null => {
        const key = spot.variantKey ? spot.variantKey.toLowerCase() : null;
        if (key) {
          const keyMatches = houseByKey.get(key);
          if (keyMatches && keyMatches.length > 0) {
            const index = Math.floor(noiseAt(spot.seed + 0.2) * keyMatches.length);
            return keyMatches[Math.min(keyMatches.length - 1, Math.max(0, index))];
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
        const theme = /brick/i.test(source) ? "brick" : /wood/i.test(source) ? "wood" : null;
        const bucket = theme ? houseByTheme[theme] : availableHouseVariants;
        if (bucket.length === 0) {
          return null;
        }
        const index = Math.floor(noiseAt(spot.seed + 0.33) * bucket.length);
        return bucket[Math.min(bucket.length - 1, Math.max(0, index))];
      };

      const variantIds = new Map<OverlayHouseVariant, number>();
      availableHouseVariants.forEach((variant, index) => {
        variantIds.set(variant, index);
      });
      const detailedBatches = new Map<
        string,
        { template: OverlayHouseVariant["meshes"][number]; instances: HouseBatchInstance[] }
      >();
      const fallbackInstances: OverlayHouseSpot[] = [];
      const foundationInstances: FoundationInstance[] = [];

      houseSpots.forEach((spot) => {
        const footprintX = Math.max(0.5, spot.footprintX);
        const footprintZ = Math.max(0.5, spot.footprintZ);
        const supportTop = spot.supportTop;
        if (spot.supportBottom < supportTop - 0.01) {
          const foundationHeight = Math.max(0.1, supportTop - spot.supportBottom);
          foundationInstances.push({
            x: spot.x,
            y: spot.supportBottom + foundationHeight / 2,
            z: spot.z,
            scaleX: footprintX,
            scaleY: foundationHeight,
            scaleZ: footprintZ,
            rotation: spot.rotation,
            tileX: spot.tileX,
            tileY: spot.tileY
          });
        }

        const variant = pickHouseVariant(spot);
        if (THREE_TEST_DETAILED_STRUCTURES_ENABLED && variant && variant.meshes.length > 0) {
          const planSizeX = Math.max(0.01, variant.planFootprint?.x ?? variant.size?.x ?? 0);
          const planSizeZ = Math.max(0.01, variant.planFootprint?.y ?? variant.size?.z ?? 0);
          const fitBias = 0.98 * (variant.scaleBias ?? 1);
          const rawScaleX = Math.max(0.01, (footprintX / planSizeX) * fitBias);
          const rawScaleZ = Math.max(0.01, (footprintZ / planSizeZ) * fitBias);
          const useUniformScale = variant.heightScaleMode === "uniform";
          const uniformScale = Math.min(rawScaleX, rawScaleZ);
          const scaleX = useUniformScale ? uniformScale : rawScaleX;
          const scaleY = useUniformScale ? uniformScale : 1;
          const scaleZ = useUniformScale ? uniformScale : rawScaleZ;
          const baseY = supportTop + variant.baseOffset * scaleY;
          const variantId = variantIds.get(variant) ?? 0;
          variant.meshes.forEach((meshTemplate, meshIndex) => {
            const key = `${variantId}:${meshIndex}`;
            const existing = detailedBatches.get(key);
            if (existing) {
              existing.instances.push({ spot, scaleX, scaleY, scaleZ, baseY });
            } else {
              detailedBatches.set(key, {
                template: meshTemplate,
                instances: [{ spot, scaleX, scaleY, scaleZ, baseY }]
              });
            }
          });
          return;
        }
        fallbackInstances.push(spot);
      });

      const tempMatrix = new THREE.Matrix4();
      detailedBatches.forEach((batch) => {
        const { template, instances } = batch;
        if (instances.length === 0) {
          return;
        }
        partitionTerrainInstances(instances, (instance) => ({ x: instance.spot.tileX, y: instance.spot.tileY })).forEach(({ key, instances: chunkInstances }) => {
          const geometry = template.geometry.clone();
          const material = Array.isArray(template.material)
            ? template.material.map((entry) => entry.clone())
            : template.material.clone();
          const instanced = new THREE.InstancedMesh(geometry, material, chunkInstances.length);
          instanced.name = `dynamic-house-${key}`;
          instanced.userData.terrainChunkKey = key;
          instanced.castShadow = true;
          instanced.receiveShadow = true;
          chunkInstances.forEach((instance, index) => {
            dummy.position.set(instance.spot.x, instance.baseY, instance.spot.z);
            dummy.rotation.set(0, instance.spot.rotation, 0);
            dummy.scale.set(instance.scaleX, instance.scaleY, instance.scaleZ);
            dummy.updateMatrix();
            tempMatrix.copy(dummy.matrix).multiply(template.baseMatrix);
            instanced.setMatrixAt(index, tempMatrix);
          });
          instanced.instanceMatrix.needsUpdate = true;
          finalizeInstancedMeshBounds(instanced);
          group.add(instanced);
        });
      });

      if (fallbackInstances.length > 0) {
        partitionTerrainInstances(fallbackInstances, (spot) => ({ x: spot.tileX, y: spot.tileY })).forEach(({ key, instances }) => {
          const fallbackMesh = new THREE.InstancedMesh(buildingGeometry, houseMaterial, instances.length);
          fallbackMesh.name = `dynamic-house-fallback-${key}`;
          fallbackMesh.userData.terrainChunkKey = key;
          fallbackMesh.castShadow = true;
          fallbackMesh.receiveShadow = true;
          instances.forEach((spot, index) => {
            const footprintX = Math.max(0.5, spot.footprintX);
            const footprintZ = Math.max(0.5, spot.footprintZ);
            dummy.position.set(spot.x, spot.supportTop + 0.3, spot.z);
            dummy.rotation.set(0, spot.rotation, 0);
            dummy.scale.set(footprintX, 0.6, footprintZ);
            dummy.updateMatrix();
            fallbackMesh.setMatrixAt(index, dummy.matrix);
          });
          fallbackMesh.instanceMatrix.needsUpdate = true;
          finalizeInstancedMeshBounds(fallbackMesh);
          group.add(fallbackMesh);
        });
      }

      if (foundationInstances.length > 0) {
        partitionTerrainInstances(foundationInstances, (instance) => ({ x: instance.tileX, y: instance.tileY })).forEach(({ key, instances }) => {
          const foundationMesh = new THREE.InstancedMesh(buildingGeometry, foundationMaterial, instances.length);
          foundationMesh.name = `dynamic-house-foundation-${key}`;
          foundationMesh.userData.terrainChunkKey = key;
          foundationMesh.castShadow = true;
          foundationMesh.receiveShadow = true;
          instances.forEach((instance, index) => {
            dummy.position.set(instance.x, instance.y, instance.z);
            dummy.rotation.set(0, instance.rotation, 0);
            dummy.scale.set(instance.scaleX, instance.scaleY, instance.scaleZ);
            dummy.updateMatrix();
            foundationMesh.setMatrixAt(index, dummy.matrix);
          });
          foundationMesh.instanceMatrix.needsUpdate = true;
          finalizeInstancedMeshBounds(foundationMesh);
          group.add(foundationMesh);
        });
      }
    }

    if (baseMinX <= baseMaxX && baseMinY <= baseMaxY) {
      const centerTileX = (baseMinX + baseMaxX) * 0.5;
      const centerTileY = (baseMinY + baseMaxY) * 0.5;
      const centerX = surface.toWorldX(centerTileX + 0.5);
      const centerZ = surface.toWorldZ(centerTileY + 0.5);
      const baseFootprintX = Math.max(1, baseMaxX - baseMinX + 1);
      const baseFootprintZ = Math.max(1, baseMaxY - baseMinY + 1);
      const rotation = baseFootprintX >= baseFootprintZ ? 0 : Math.PI / 2;
      const grounding = resolveStructureGrounding({
        surface: sample,
        minTileX: baseMinX,
        maxTileX: baseMaxX,
        minTileY: baseMinY,
        maxTileY: baseMaxY,
        heightScale: surface.heightScale,
        heightAtTileCoord: surface.heightAtTileCoord
      });
      const supportBottom = grounding.foundationBottom;
      const supportTop = grounding.foundationTop;

      if (THREE_TEST_DETAILED_STRUCTURES_ENABLED && firestationAsset && firestationAsset.meshes.length > 0) {
        const footprintTarget = Math.max(baseFootprintX, baseFootprintZ) * 0.85;
        const assetFootprint = Math.max(firestationAsset.size.x, firestationAsset.size.z);
        const scale = footprintTarget / Math.max(0.01, assetFootprint);
        const baseY = supportTop + firestationAsset.baseOffset * scale;
        const tempMatrix = new THREE.Matrix4();
        firestationAsset.meshes.forEach((template) => {
          const geometry = template.geometry.clone();
          const material = Array.isArray(template.material)
            ? template.material.map((entry) => entry.clone())
            : template.material.clone();
          const instanced = new THREE.InstancedMesh(geometry, material, 1);
          instanced.castShadow = true;
          instanced.receiveShadow = true;
          dummy.position.set(centerX, baseY, centerZ);
          dummy.rotation.set(0, rotation, 0);
          dummy.scale.set(scale, scale, scale);
          dummy.updateMatrix();
          tempMatrix.copy(dummy.matrix).multiply(template.baseMatrix);
          instanced.setMatrixAt(0, tempMatrix);
          instanced.instanceMatrix.needsUpdate = true;
          group.add(instanced);
        });
        if (supportBottom < supportTop - 0.01) {
          const foundationHeight = Math.max(0.1, supportTop - supportBottom);
          const foundation = new THREE.Mesh(buildingGeometry, foundationMaterial);
          foundation.scale.set(baseFootprintX, foundationHeight, baseFootprintZ);
          foundation.position.set(centerX, supportBottom + foundationHeight / 2, centerZ);
          foundation.rotation.set(0, rotation, 0);
          foundation.castShadow = true;
          foundation.receiveShadow = true;
          group.add(foundation);
        }
      } else {
        const baseMesh = new THREE.Mesh(buildingGeometry, baseMaterial);
        baseMesh.castShadow = true;
        baseMesh.receiveShadow = true;
        baseMesh.scale.set(baseFootprintX, 0.66, baseFootprintZ);
        baseMesh.position.set(centerX, supportTop + baseMesh.scale.y * 0.5, centerZ);
        group.add(baseMesh);
        if (supportBottom < supportTop - 0.01) {
          const foundationHeight = Math.max(0.1, supportTop - supportBottom);
          const foundation = new THREE.Mesh(buildingGeometry, foundationMaterial);
          foundation.scale.set(baseFootprintX, foundationHeight, baseFootprintZ);
          foundation.position.set(centerX, supportBottom + foundationHeight / 2, centerZ);
          foundation.rotation.set(0, rotation, 0);
          foundation.castShadow = true;
          foundation.receiveShadow = true;
          group.add(foundation);
        }
      }
    }

    const visibleWatchTowers = sample.watchTowers ?? [];
    if (visibleWatchTowers.length > 0) {
      visibleWatchTowers.forEach((tower) => {
        const tileX = clampToRange(Math.round(tower.x), 0, cols - 1);
        const tileY = clampToRange(Math.round(tower.y), 0, rows - 1);
        const centerX = surface.toWorldX(tileX + 0.5);
        const centerZ = surface.toWorldZ(tileY + 0.5);
        const legOffsets = getWatchTowerLegOffsets();
        const legGrounds = legOffsets.map((offset) => surface.heightAtTileCoord(tileX + 0.5 + offset.x, tileY + 0.5 + offset.y) * surface.heightScale);
        const supportTop = Math.max(...legGrounds);
        const rotation = WATCH_TOWER_GRID_ROTATION_RADIANS;
        const towerModel = createProceduralWatchTowerModel(tower.level);
        towerModel.userData.watchTowerTownId = tower.townId;
        towerModel.userData.watchTowerId = tower.id;
        if (!tower.active) towerModel.traverse((object) => { if (object instanceof THREE.Mesh) object.material = new THREE.MeshStandardMaterial({ color: 0xb88b56, transparent: true, opacity: 0.58 }); });
        towerModel.position.set(centerX, supportTop, centerZ);
        towerModel.rotation.set(0, rotation, 0);
        group.add(towerModel);
        {
          const footingMaterial = new THREE.MeshStandardMaterial({ color: 0xb8bab5, roughness: 0.92, metalness: 0.02 });
          for (let legIndex = 0; legIndex < legOffsets.length; legIndex += 1) {
            const offset = legOffsets[legIndex];
            const legGround = legGrounds[legIndex];
            const foundationHeight = Math.max(0.08, supportTop - legGround + 0.08);
            const footing = new THREE.Mesh(buildingGeometry, footingMaterial);
            footing.name = "watch-tower-grounding-pier";
            footing.scale.set(0.34, foundationHeight, 0.34);
            footing.position.set(surface.toWorldX(tileX + 0.5 + offset.x), legGround + foundationHeight / 2, surface.toWorldZ(tileY + 0.5 + offset.y));
            footing.castShadow = true;
            footing.receiveShadow = true;
            group.add(footing);
          }
        }
      });
    }

    const activeWaterTowers = (sample.waterTowers ?? []).filter((tower) => tower.active);
    if (activeWaterTowers.length > 0) {
      activeWaterTowers.forEach((tower) => {
        const tileX = clampToRange(Math.round(tower.x), 0, cols - 1);
        const tileY = clampToRange(Math.round(tower.y), 0, rows - 1);
        const centerX = surface.toWorldX(tileX + 0.5);
        const centerZ = surface.toWorldZ(tileY + 0.5);
        const grounding = resolveStructureGrounding({
          surface: sample,
          minTileX: Math.max(0, tileX - 1),
          maxTileX: Math.min(cols - 1, tileX + 1),
          minTileY: Math.max(0, tileY - 1),
          maxTileY: Math.min(rows - 1, tileY + 1),
          heightScale: surface.heightScale,
          heightAtTileCoord: surface.heightAtTileCoord
        });
        const supportTop = grounding.foundationTop;
        const supportBottom = grounding.foundationBottom;
        const rotation = noiseAt(tower.id * 3.17 + (sample.worldSeed ?? 0)) * Math.PI * 2;
        const towerModel = createProceduralWaterTowerModel();
        towerModel.position.set(centerX, supportTop, centerZ);
        towerModel.rotation.set(0, rotation, 0);
        group.add(towerModel);
        if (supportBottom < supportTop - 0.01) {
          const foundationHeight = Math.max(0.08, supportTop - supportBottom);
          const footingMaterial = new THREE.MeshStandardMaterial({ color: 0xb8bab5, roughness: 0.92, metalness: 0.02 });
          const halfBase = WATER_TOWER_BASE_WIDTH_TILES * 0.5;
          for (const [localX, localZ] of [[-halfBase, -halfBase], [halfBase, -halfBase], [halfBase, halfBase], [-halfBase, halfBase]] as const) {
            const rotatedX = localX * Math.cos(rotation) - localZ * Math.sin(rotation);
            const rotatedZ = localX * Math.sin(rotation) + localZ * Math.cos(rotation);
            const footing = new THREE.Mesh(buildingGeometry, footingMaterial);
            footing.name = "water-tower-grounding-pier";
            footing.scale.set(WATER_TOWER_FOOTING_SIZE_TILES, foundationHeight, WATER_TOWER_FOOTING_SIZE_TILES);
            footing.position.set(centerX + rotatedX, supportBottom + foundationHeight / 2, centerZ + rotatedZ);
            footing.rotation.set(0, rotation, 0);
            footing.castShadow = true;
            footing.receiveShadow = true;
            group.add(footing);
          }
        }
      });
    }

    if (group.children.length > 0) {
      structureOverlayGroup = group;
      scene.add(group);
    } else {
      group.clear();
      structureOverlayGroup = null;
    }
    lastStructureRevision = structureRevision;
    lastStructureOverlayKey = structureOverlayKey;
  };

  const cleanup = (): void => {
    cancelCameraFlight();
    running = false;
    controls.enabled = false;
    if (raf) {
      window.cancelAnimationFrame(raf);
      raf = 0;
    }
    document.removeEventListener("keydown", handleKeyDown);
    canvas.removeEventListener("click", handleCanvasClick);
    canvas.removeEventListener("pointerdown", handleCanvasPointerDown, true);
    canvas.removeEventListener("mousedown", handleCanvasMouseDown, true);
    window.removeEventListener("mouseup", handleWindowMouseUp, true);
    window.removeEventListener("pointerdown", handleTownOverlayPointerDown, true);
    window.removeEventListener("blur", handleWindowBlur);
    canvas.removeEventListener("contextmenu", handleCanvasContextMenu);
    canvas.removeEventListener("mousemove", handleCanvasMouseMove);
    canvas.removeEventListener("mouseleave", handleCanvasMouseLeave);
    canvas.removeEventListener("webglcontextlost", handleContextLost as EventListener, false);
    canvas.removeEventListener("webglcontextrestored", handleContextRestored as EventListener, false);
    controls.removeEventListener("start", handleControlsStart);
    controls.removeEventListener("change", markCameraMotion);
    controls.removeEventListener("end", markCameraMotion);
    clearDebugHover();
    cancelFormationDrag();
    clearTownHoverDelay();
    lastTerrainWater = null;
    lastTerrainSurface = null;
    lastTerrainSize = null;
    disposeSatelliteMinimapTarget();
    disposeStructureOverlay();
    clearUnitCommandVisuals();
    clearEvacuationVisuals();
    lastStructureOverlayKey = "";
    lastStructureRevision = -1;
    townLabelElements.clear();
    squadMarkerElements.clear();
    squadMarkerAnchors.clear();
    pinnedTownCards.clear();
    dockCards.clear();
    closeTownFacility();
    selectedTownId = null;
    focusedTownId = null;
    baseFocused = false;
    townOverlayRoot.remove();
    squadMarkerOverlayRoot.remove();
    dockOverlayRoot.remove();
    unitTrayRoot.remove();
    sparkDebugOverlay.remove();
    watchTowerQuoteTooltip.remove();
    removeUiAudioChangeListener?.();
    removeUiAudioChangeListener = null;
    removeMusicControlsChangeListener?.();
    removeMusicControlsChangeListener = null;
    removeWorldAudioChangeListener?.();
    removeWorldAudioChangeListener = null;
    removeRuntimeSettingsChangeListener?.();
    removeRuntimeSettingsChangeListener = null;
    uiScene.remove(hudSprite);
    hudTexture.dispose();
    hudMaterial.dispose();
    fireFx.dispose();
    constructionFx.dispose();
    worldAudio?.dispose();
    unitsLayer.dispose();
    unitFxLayer.dispose();
    formationProjectionLayer.dispose();
    scene.remove(formationProjectionLayer.group);
    scene.remove(scoreFlowPulseGroup);
    scoreFlowPulses.forEach((pulse) => pulse.material.dispose());
    scoreFlowPulseGeometry.dispose();
    scene.remove(hoverDebugTileHighlight);
    hoverDebugTileHighlightGeometry.dispose();
    hoverDebugTileHighlightMaterial.dispose();
    scene.remove(unitCommandVisualGroup);
    scene.remove(evacuationVisualGroup);
    evacuationVehicleLayer.dispose();
    evacuationPreviewMaterial.dispose();
    evacuationActiveMaterial.dispose();
    evacuationObstacleMaterial.dispose();
    evacuationObstacleGeometry.dispose();
    unitCommandPathMaterial.dispose();
    unitCommandMarkerGeometry.dispose();
    unitCommandMarkerMaterial.dispose();
    postPipeline?.dispose();
    postPipeline = null;
    gpuTimer.dispose();
    scene.remove(seasonalSky.mesh);
    seasonalSky.dispose();
    waterSystem.dispose();
    disposeQueuedTerrainTextures(pendingTerrainTextureDisposals);
    renderer.dispose();
  };

  activeThreeTestCleanup = cleanup;

  const scheduleResize = (): void => {
    const rect = canvas.getBoundingClientRect();
    pendingResize = {
      width: Math.max(1, Math.floor(rect.width)),
      height: Math.max(1, Math.floor(rect.height))
    };
  };

  const applyResize = (width: number, height: number): void => {
    const deviceDpr = Math.min(window.devicePixelRatio ?? 1, THREE_TEST_MAX_DPR);
    if (THREE_TEST_ADAPTIVE_DPR_ENABLED) {
      adaptiveDpr = Math.max(THREE_TEST_MIN_DPR, Math.min(deviceDpr, adaptiveDpr));
    } else {
      adaptiveDpr = deviceDpr;
    }
    const effectiveDpr = THREE_TEST_ADAPTIVE_DPR_ENABLED ? adaptiveDpr : deviceDpr;
    renderer.setPixelRatio(effectiveDpr);
    renderer.setSize(width, height, false);
    postPipeline?.resize(width, height, effectiveDpr);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    uiCamera.left = 0;
    uiCamera.right = width;
    uiCamera.top = height;
    uiCamera.bottom = 0;
    uiCamera.updateProjectionMatrix();
    const maxTexSize = renderer.capabilities.maxTextureSize || 4096;
    const maxScale = Math.min(
      (maxTexSize - 2) / Math.max(1, width),
      (maxTexSize - 2) / Math.max(1, height)
    );
    // Keep HUD text crisp by matching effective DPR (capped by texture limits).
    const targetHudScale = Math.max(0.1, Math.min(effectiveDpr, maxScale));
    const nextHudWidth = Math.max(1, Math.round(width * targetHudScale));
    const nextHudHeight = Math.max(1, Math.round(height * targetHudScale));
    const sizeChanged = hudCanvas.width !== nextHudWidth || hudCanvas.height !== nextHudHeight;
    if (sizeChanged) {
      hudCanvas.width = nextHudWidth;
      hudCanvas.height = nextHudHeight;
      const nextTexture = createHudTexture(hudCanvas);
      hudMaterial.map = nextTexture;
      hudMaterial.needsUpdate = true;
      hudTexture.dispose();
      hudTexture = nextTexture;
    }
    hudScaleX = nextHudWidth / Math.max(1, width);
    hudScaleY = nextHudHeight / Math.max(1, height);
    hudCtx.setTransform(hudScaleX, 0, 0, hudScaleY, 0, 0);
    setHudViewport(hudState, width, height, Math.max(hudScaleX, hudScaleY));
    hudSprite.scale.set(width, height, 1);
    hudSprite.position.set(0, height, 0);
    hudTexture.needsUpdate = true;
    lastFrameTime = 0;
    lastPresentedAt = 0;
  };

  const resize = (): void => {
    scheduleResize();
    if (!running && pendingResize) {
      applyResize(pendingResize.width, pendingResize.height);
      pendingResize = null;
    }
  };

  const updateCameraFlight = (time: number): void => {
    if (!cameraFlight) {
      return;
    }
    const elapsedMs = Math.max(0, time - cameraFlight.startedAt);
    const progress = cameraFlight.durationMs > 0 ? Math.min(1, elapsedMs / cameraFlight.durationMs) : 1;
    const eased = easeInOutCubic(progress);
    controls.target.lerpVectors(cameraFlight.startTarget, cameraFlight.endTarget, eased);
    camera.position.lerpVectors(cameraFlight.startPosition, cameraFlight.endPosition, eased);
    if (cameraFlight.arcLift > 0) {
      camera.position.y += Math.sin(Math.PI * eased) * cameraFlight.arcLift;
    }
    if (progress >= 1) {
      controls.target.copy(cameraFlight.endTarget);
      camera.position.copy(cameraFlight.endPosition);
      cameraFlight = null;
    }
    markCameraMotion();
  };

  const resolveActiveDofBlurScale = (): number => {
    const deviceDpr = Math.min(window.devicePixelRatio ?? 1, THREE_TEST_MAX_DPR);
    if (!THREE_TEST_ADAPTIVE_DPR_ENABLED || adaptiveDpr >= deviceDpr - 0.15) {
      return THREE_TEST_DOF_BASE_BLUR_SCALE;
    }
    return Math.min(THREE_TEST_DOF_BASE_BLUR_SCALE, 0.25);
  };

  const syncDofSettings = (): void => {
    if (!postPipeline) {
      return;
    }
    postPipeline.setDofSettings({
      enabled: dofEnabled,
      focusDistance: Math.max(0.001, camera.position.distanceTo(controls.target)),
      blurScale: resolveActiveDofBlurScale()
    });
  };

  const disableDof = (): void => {
    if (!dofEnabled) {
      return;
    }
    dofEnabled = false;
    render.flags.dof = false;
    postPipeline?.setDofSettings({ enabled: false });
  };

  const disableCinematicGrade = (): void => {
    if (!cinematicGradeEnabled) {
      return;
    }
    cinematicGradeEnabled = false;
    render.flags.cinematicGrade = false;
    postPipeline?.setGradeEnabled(false);
    applyCinematicLook(false);
  };

  const disablePostProcessing = (): void => {
    disableDof();
    disableCinematicGrade();
  };

  const renderWorldScene = (): void => {
    const gpuLabel = shadowRefreshPendingForFrame ? "shadowRefresh" : "world";
    const gpuTimerActive = gpuTimer.begin(gpuLabel);
    renderer.clear();
    renderer.render(scene, camera);
    threePerf.sceneCalls = smoothPerf(threePerf.sceneCalls, renderer.info.render.calls);
    threePerf.sceneTriangles = smoothPerf(threePerf.sceneTriangles, renderer.info.render.triangles);
    threePerf.sceneLines = smoothPerf(threePerf.sceneLines, renderer.info.render.lines);
    threePerf.scenePoints = smoothPerf(threePerf.scenePoints, renderer.info.render.points);
    if (gpuTimerActive) {
      gpuTimer.end();
    }
    if (shadowRefreshPendingForFrame) {
      shadowRefreshCount += 1;
      shadowRefreshPendingForFrame = false;
    }
  };

  const isSeasonalRainVisualActive = (): boolean =>
    !THREE_TEST_DISABLE_FX && (seasonalRainState?.visualIntensity01 ?? 0) > 0.001;

  const syncSeasonalRainPostState = (): void => {
    const rain = seasonalRainState;
    const screenWind = resolveSeasonalRainScreenWind(camera, world.wind);
    const weatherVisual = sampleSeasonalWeatherVisualState({
      careerDay: world.careerDay ?? 0,
      seasonT01: seasonVisualState.seasonT01,
      rainIntensity01: rain?.visualIntensity01 ?? 0,
      rainSeed: rain?.event?.seed,
      worldSeed: world.seed,
      windDx: world.wind?.dx ?? 0,
      windDy: world.wind?.dy ?? 0,
      windStrength: world.wind?.strength ?? 0
    });
    postPipeline?.setSeasonalRainState({
      enabled: !THREE_TEST_DISABLE_FX && Boolean(rain?.active),
      intensity01: rain?.intensity01 ?? 0,
      visualIntensity01: rain?.visualIntensity01 ?? 0,
      seed: rain?.event?.seed ?? world.seed,
      timeSeconds: weatherVisual.rainTimeSeconds,
      windScreenX: screenWind.x,
      windScreenY: screenWind.y,
      windStrength01: screenWind.strength01
    });
  };

  const renderWorldPass = (): void => {
    if ((cinematicGradeEnabled || dofEnabled || isSeasonalRainVisualActive()) && postPipeline) {
      const renderedWithPost = postPipeline.render(renderWorldScene);
      if (!renderedWithPost) {
        disablePostProcessing();
      }
      return;
    }
    renderWorldScene();
  };

  let lastStaticFrameKey = "";
  let lastWorldRenderAt = -Infinity;
  const shouldRenderWorldFrame = (time: number): boolean => {
    if (
      !THREE_TEST_DISABLE_HUD ||
      !world.paused ||
      world.lastActiveFires > 0 ||
      isSeasonalRainVisualActive() ||
      world.units.some((unit) => unit.kind === "firefighter" && unit.carrierId === null) ||
      (lastSample?.buildingLots ?? []).some((lot) => {
        const stage = getBuildingLifecycleStageFromId(lot.stageId);
        return stage === "site_prep" || stage === "frame" || stage === "enclosed";
      }) ||
      cameraFlight !== null ||
      resolveCameraInteracting() ||
      scoreFlowPulses.some((pulse) => pulse.mesh.visible)
    ) {
      lastStaticFrameKey = "";
      return true;
    }
    const unitKey = world.units
      .map((unit) => `${unit.id}:${unit.x},${unit.y},${unit.prevX},${unit.prevY},${unit.selected ? 1 : 0},${unit.pathIndex}`)
      .join(";");
    const staticKey = [
      camera.position.x,
      camera.position.y,
      camera.position.z,
      controls.target.x,
      controls.target.y,
      controls.target.z,
      world.careerDay,
      world.terrainTypeRevision ?? 0,
      lastSample?.structureRevision ?? -1,
      unitKey
    ].join("|");
    if (staticKey !== lastStaticFrameKey) {
      lastStaticFrameKey = staticKey;
      return true;
    }
    return time - lastWorldRenderAt >= STATIC_FRAME_HEARTBEAT_MS;
  };

  const renderFrame = (time: number): void => {
    if (!running) {
      return;
    }
    const rafGapMs = lastRafAt > 0 ? Math.max(0, time - lastRafAt) : 0;
    lastRafAt = time;
    if (rafGapMs > 0) {
      threePerf.rafGapMs = smoothPerf(threePerf.rafGapMs, rafGapMs);
      threePerf.rafGapLastMs = rafGapMs;
      threePerf.rafGapMaxMs = Math.max(rafGapMs, threePerf.rafGapMaxMs * 0.997);
      if (rafGapMs >= PERF_HITCH_THRESHOLD_MS) {
        threePerf.hitchCount += 1;
        threePerf.lastHitchMs = rafGapMs;
      }
    }
    if (
      THREE_TEST_FRAME_MIN_MS > 0 &&
      lastPresentedAt > 0 &&
      time - lastPresentedAt + FRAME_CAP_TOLERANCE_MS < THREE_TEST_FRAME_MIN_MS
    ) {
      raf = window.requestAnimationFrame(renderFrame);
      return;
    }
    lastPresentedAt = time;
    const frameStart = performance.now();
    const dt = lastFrameTime > 0 ? (time - lastFrameTime) / 1000 : 0;
    lastFrameTime = time;
    if (ENABLE_THREE_TEST_SEASONAL_RECOLOR) {
      const nextEnvironmentTarget: EnvironmentSignalState = {
        seasonT01: seasonVisualState.seasonT01,
        risk01: seasonVisualState.risk01,
        fireLoad01: computeFireLoad01(world.lastActiveFires, world.grid.totalTiles)
      };
      const targetChanged =
        Math.abs(nextEnvironmentTarget.seasonT01 - environmentTarget.seasonT01) >= SEASON_VISUAL_EPSILON ||
        Math.abs(nextEnvironmentTarget.risk01 - environmentTarget.risk01) >= SEASON_VISUAL_EPSILON ||
        Math.abs(nextEnvironmentTarget.fireLoad01 - environmentTarget.fireLoad01) >= SEASON_VISUAL_EPSILON;
      if (targetChanged) {
        environmentTarget = nextEnvironmentTarget;
      }
      if (dt > 0) {
        const envAlpha = 1 - Math.exp(-dt / 1.6);
        environmentCurrent.seasonT01 = lerpWrapped01(environmentCurrent.seasonT01, environmentTarget.seasonT01, envAlpha);
        environmentCurrent.risk01 += (environmentTarget.risk01 - environmentCurrent.risk01) * envAlpha;
        environmentCurrent.fireLoad01 += (environmentTarget.fireLoad01 - environmentCurrent.fireLoad01) * envAlpha;
      } else {
        environmentCurrent = { ...environmentTarget };
      }
      applyEnvironmentPalette();
    }
    applyDynamicEnvironmentState();
    let instantFps = 0;
    if (dt > 0) {
      instantFps = 1 / Math.max(1 / 240, dt);
      threePerf.fps = smoothPerf(threePerf.fps, instantFps);
    }
    if (pendingResize) {
      applyResize(pendingResize.width, pendingResize.height);
      pendingResize = null;
    }
    cube.rotation.y = time * 0.0006;
    cube.rotation.x = time * 0.00035;
    const simulationAnimationRate = isSimulationEffectivelyPaused(world) ? 0 : getResolvedTimeSpeedValue(world);
    waterSystem.update(
      time,
      dt,
      threePerf.fps > 0 ? threePerf.fps : instantFps,
      threePerf.sceneRenderMs,
      simulationAnimationRate
    );
    const controlsStart = performance.now();
    updateCameraFlight(time);
    controls.update();
    applyTerrainCameraConstraints();
    syncCameraClipPlanes();
    threePerf.controlsMs = smoothPerf(threePerf.controlsMs, performance.now() - controlsStart);
    seasonalSky.syncToCamera(camera);
    if (environmentFogEnabled) {
      syncCinematicFogDistance(lastLightingApplied?.fogDensity ?? THREE_TEST_CINEMATIC_GRADE_CONFIG.fogDensity);
    }
    if (lastLightingApplied) {
      syncDirectionalLightRig(lastLightingApplied);
    }
    syncSunGlare(lastLightingApplied);
    syncSeasonalRainPostState();
    syncDofSettings();
    const treeBurnStart = performance.now();
    if (
      !THREE_TEST_DISABLE_FX &&
      treeBurnController &&
      (world.lastActiveFires > 0 || treeBurnController.getVisualBounds() !== null)
    ) {
      treeBurnController.update(time, world);
    }
    threePerf.treeBurnMs = smoothPerf(threePerf.treeBurnMs, performance.now() - treeBurnStart);
    const fireFxStart = performance.now();
    if (!THREE_TEST_DISABLE_FX) {
      fireFx.update(
        time,
        world,
        lastSample,
        lastTerrainSize,
        lastTerrainSurface,
        treeBurnController,
        null,
        threePerf.fps > 0 ? threePerf.fps : instantFps,
        threePerf.sceneRenderMs,
        simulationAnimationRate
      );
      threePerf.fireFxDebug = fireFx.getDebugSnapshot();
      if (THREE_TEST_SPARK_DEBUG) {
        const snapshot = fireFx.getSparkDebugSnapshot();
        if (time - sparkDebugLastUiAt >= 100) {
          sparkDebugOverlay.textContent =
            `SPARK DEBUG` +
            ` | flames:${snapshot.visibleFlameTiles}` +
            ` | clusters:${snapshot.clusterCount}/${snapshot.clusteredTiles}` +
            ` | bed:${snapshot.clusterBedInstances}` +
            ` | plume:${snapshot.clusterPlumeSpawns}` +
            ` | tip:${snapshot.heroTipSparkEmitted}/${snapshot.heroTipSparkAttempts}` +
            ` | dropped:${snapshot.droppedByInstanceCap}` +
            ` | total:${snapshot.finalSparkInstanceCount}`;
          sparkDebugLastUiAt = time;
        }
        if (time - sparkDebugLastLogAt >= 1000) {
          console.info("[threeTest:sparkdebug]", snapshot);
          sparkDebugLastLogAt = time;
        }
      }
    } else {
      threePerf.fireFxDebug = null;
    }
    worldAudio?.update(
      time,
      dt,
      world,
      lastTerrainSurface,
      fireFx.getAudioClusterSnapshot(),
      simulationAlpha
    );
    constructionFx.update(time, dt, lastSample, lastTerrainSurface, simulationAnimationRate);
    threePerf.fireFxMs = smoothPerf(threePerf.fireFxMs, performance.now() - fireFxStart);
    unitsLayer.update(world, lastTerrainSurface, simulationAlpha);
    unitFxLayer.update(world, effectsState, lastTerrainSurface, simulationAlpha, time);
    formationProjectionLayer.update(
      lastTerrainSurface,
      inputState.formationProjection,
      inputState.dispatchFormation,
      getFormationProjectionUnitCount()
    );
    updateUnitCommandVisuals();
    updateEvacuationVisuals();
    updateScoreFlowPulses(time);
    updateTownOverlay(time);
    updateSquadMarkerOverlay();
    updateDockOverlay(time);
    updateUnitTrayOverlay(time);
    refreshRoadOverlayIfNeeded();
    renderer.info.reset();
    const sceneRenderStart = performance.now();
    const renderedWorldFrame = shouldRenderWorldFrame(time);
    if (renderedWorldFrame) {
      renderWorldPass();
      renderer.clearDepth();
      lastWorldRenderAt = time;
    }
    const postStats = postPipeline?.getStats() ?? null;
    const sceneRenderRawMs = performance.now() - sceneRenderStart;
    threePerf.sceneRenderLastMs = sceneRenderRawMs;
    threePerf.sceneRenderMs = smoothPerf(threePerf.sceneRenderMs, sceneRenderRawMs);
    threePerf.postMs = smoothPerf(threePerf.postMs, postStats?.postMs ?? 0);
    threePerf.dofMs = smoothPerf(threePerf.dofMs, postStats?.dofMs ?? 0);
    threePerf.postPassCount = postStats?.passCount ?? 0;
    const fpsEstimate = threePerf.fps > 0 ? threePerf.fps : instantFps;
    if (THREE_TEST_ADAPTIVE_DPR_ENABLED && dt > 0) {
      const overloaded =
        (fpsEstimate > 0 && fpsEstimate < ADAPTIVE_DPR_FALLBACK_FPS) ||
        threePerf.sceneRenderMs > ADAPTIVE_DPR_FALLBACK_SCENE_MS;
      if (overloaded) {
        adaptiveDprFallbackAccum += dt;
      } else {
        adaptiveDprFallbackAccum = Math.max(0, adaptiveDprFallbackAccum - dt * 0.7);
      }
      const healthy =
        fpsEstimate > ADAPTIVE_DPR_RECOVERY_FPS &&
        threePerf.sceneRenderMs < ADAPTIVE_DPR_RECOVERY_SCENE_MS;
      if (healthy) {
        adaptiveDprRecoveryAccum += dt;
      } else {
        adaptiveDprRecoveryAccum = Math.max(0, adaptiveDprRecoveryAccum - dt * 0.45);
      }
      const maxAdaptiveDpr = Math.min(window.devicePixelRatio ?? 1, THREE_TEST_MAX_DPR);
      if (adaptiveDprFallbackAccum >= ADAPTIVE_DPR_FALLBACK_SECONDS && adaptiveDpr > THREE_TEST_MIN_DPR + 0.001) {
        adaptiveDpr = Math.max(THREE_TEST_MIN_DPR, adaptiveDpr - ADAPTIVE_DPR_STEP_DOWN);
        adaptiveDprFallbackAccum = 0;
        adaptiveDprRecoveryAccum = 0;
        scheduleResize();
      } else if (adaptiveDprRecoveryAccum >= ADAPTIVE_DPR_RECOVERY_SECONDS && adaptiveDpr < maxAdaptiveDpr - 0.001) {
        adaptiveDpr = Math.min(maxAdaptiveDpr, adaptiveDpr + ADAPTIVE_DPR_STEP_UP);
        adaptiveDprRecoveryAccum = 0;
        scheduleResize();
      }
    }
    const hudStart = performance.now();
    if (!THREE_TEST_DISABLE_HUD && (lastHudRenderMs <= 0 || time - lastHudRenderMs >= HUD_REDRAW_INTERVAL_MS)) {
      hudCtx.setTransform(1, 0, 0, 1, 0, 0);
      hudCtx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
      hudCtx.setTransform(hudScaleX, 0, 0, hudScaleY, 0, 0);
      viewProjMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      invViewProjMatrix.copy(viewProjMatrix).invert();
      hudCameraSnapshot.position.x = camera.position.x;
      hudCameraSnapshot.position.y = camera.position.y;
      hudCameraSnapshot.position.z = camera.position.z;
      const invElements = invViewProjMatrix.elements;
      for (let i = 0; i < 16; i += 1) {
        hudInvViewProj[i] = invElements[i] ?? 0;
      }
      renderHud(hudCtx, world, hudState, inputState, dt);
      hudTexture.needsUpdate = true;
      lastHudRenderMs = time;
    }
    threePerf.hudMs = smoothPerf(threePerf.hudMs, performance.now() - hudStart);
    const uiRenderStart = performance.now();
    const uiGpuTimerActive = !THREE_TEST_DISABLE_HUD && gpuTimer.begin("ui");
    if (!THREE_TEST_DISABLE_HUD) {
      renderer.render(uiScene, uiCamera);
    }
    if (uiGpuTimerActive) {
      gpuTimer.end();
    }
    flushTerrainTextureDisposals(pendingTerrainTextureDisposals);
    threePerf.uiRenderMs = smoothPerf(threePerf.uiRenderMs, performance.now() - uiRenderStart);
    threePerf.totalCalls = smoothPerf(threePerf.totalCalls, renderer.info.render.calls);
    threePerf.memoryGeometries = smoothPerf(threePerf.memoryGeometries, renderer.info.memory.geometries);
    threePerf.memoryTextures = smoothPerf(threePerf.memoryTextures, renderer.info.memory.textures);
    threePerf.contextLosses = contextLosses;
    threePerf.contextRestores = contextRestores;
    const gpuSnapshot = gpuTimer.getSnapshot();
    threePerf.gpuWorldMs = gpuSnapshot.world;
    threePerf.gpuShadowRefreshMs = gpuSnapshot.shadowRefresh;
    threePerf.gpuPostMs = gpuSnapshot.post;
    threePerf.gpuUiMs = gpuSnapshot.ui;
    threePerf.activeShadowLights = activeShadowLightCount;
    threePerf.shadowRefreshCount = shadowRefreshCount;
    threePerf.vehicleBufferUploads = unitsLayer.getVehicleBufferUploadCount() + evacuationVehicleLayer.getBufferUploadCount();
    const frameRawMs = performance.now() - frameStart;
    threePerf.frameLastMs = frameRawMs;
    threePerf.frameMs = smoothPerf(threePerf.frameMs, frameRawMs);
    raf = window.requestAnimationFrame(renderFrame);
  };

  const start = (): void => {
    if (running) {
      return;
    }
    running = true;
    worldAudio?.setRunning(true);
    constructionFx.setRunning(true);
    controls.enabled = true;
    lastPresentedAt = 0;
    resize();
    raf = window.requestAnimationFrame(renderFrame);
  };

  const prime = (): void => {
    if (pendingResize) {
      applyResize(pendingResize.width, pendingResize.height);
      pendingResize = null;
    }
    if (THREE_TEST_SHADOWS_ENABLED) {
      const previousVisible = previousShadowLight.visible;
      const nextVisible = nextShadowLight.visible;
      previousShadowLight.visible = true;
      nextShadowLight.visible = true;
      renderer.compile(scene, camera);
      previousShadowLight.visible = previousVisible;
      nextShadowLight.visible = nextVisible;
    }
    renderer.compile(scene, camera);
    seasonalSky.syncToCamera(camera);
    if (lastLightingApplied) {
      syncDirectionalLightRig(lastLightingApplied);
      syncSunGlare(lastLightingApplied);
    }
    renderer.info.reset();
    renderWorldPass();
    if (!THREE_TEST_DISABLE_HUD) {
      renderer.clearDepth();
      renderer.render(uiScene, uiCamera);
    }
  };

  const isCameraInteracting = (): boolean => {
    if (!running) {
      return false;
    }
    return performance.now() - lastCameraMotionAt <= CAMERA_INTERACTION_HOLD_MS;
  };
  resolveCameraInteracting = isCameraInteracting;

  const stop = (): void => {
    cancelCameraFlight();
    running = false;
    worldAudio?.setRunning(false);
    constructionFx.setRunning(false);
    controls.enabled = false;
    clearDebugHover();
    lastRafAt = 0;
    lastPresentedAt = 0;
    if (raf) {
      window.cancelAnimationFrame(raf);
    }
  };

  const setSeasonVisualState = (next: SeasonVisualState): void => {
    if (!ENABLE_THREE_TEST_SEASONAL_RECOLOR) {
      return;
    }
    const mode = next.mode === "manual" ? "manual" : "auto";
    const seasonInput = mode === "manual" && Number.isFinite(next.manualSeasonT01) ? next.manualSeasonT01! : next.seasonT01;
    const seasonT01 = wrap01(seasonInput);
    const risk01 = clamp01(next.risk01);
    const seasonUnchanged = Math.abs(seasonT01 - terrainClimateUniforms.uSeasonT01.value) < SEASON_VISUAL_EPSILON;
    const riskUnchanged = Math.abs(risk01 - terrainClimateUniforms.uRisk01.value) < SEASON_VISUAL_EPSILON;
    const modeUnchanged = seasonVisualState.mode === mode;
    if (seasonUnchanged && riskUnchanged && modeUnchanged) {
      return;
    }
    terrainClimateUniforms.uSeasonT01.value = seasonT01;
    terrainClimateUniforms.uRisk01.value = risk01;
    seasonVisualState = {
      seasonT01,
      risk01,
      mode,
      manualSeasonT01: Number.isFinite(next.manualSeasonT01) ? wrap01(next.manualSeasonT01!) : undefined
    };
    environmentTarget = {
      seasonT01,
      risk01,
      fireLoad01: computeFireLoad01(world.lastActiveFires, world.grid.totalTiles)
    };
    if (!running) {
      environmentCurrent = { ...environmentTarget };
      applyEnvironmentPalette(true);
    }
  };

  const setSeason = (index: number): void => {
    const bucket = Math.max(0, Math.min(LEGACY_INDEX_TO_SEASON_T.length - 1, Math.round(index)));
    const seasonT01 = LEGACY_INDEX_TO_SEASON_T[bucket] ?? 0;
    setSeasonVisualState({
      seasonT01,
      risk01: seasonVisualState.risk01,
      mode: "manual",
      manualSeasonT01: seasonT01
    });
  };

  const setClimateDryness = (value: number): void => {
    setSeasonVisualState({
      seasonT01: seasonVisualState.seasonT01,
      risk01: clamp01(value),
      mode: seasonVisualState.mode,
      manualSeasonT01: seasonVisualState.manualSeasonT01
    });
  };

  const setPhaseLabel = (text: string): void => {
    hudState.phaseLabelOverride = text;
  };

  const setSeasonalRainState = (next: SeasonalRainState | null): void => {
    seasonalRainState = next;
    if (!next || next.visualIntensity01 <= 0.001) {
      const weatherVisual = sampleSeasonalWeatherVisualState({
        careerDay: world.careerDay ?? 0,
        seasonT01: seasonVisualState.seasonT01,
        rainIntensity01: 0,
        rainSeed: next?.event?.seed,
        worldSeed: world.seed,
        windDx: world.wind?.dx ?? 0,
        windDy: world.wind?.dy ?? 0,
        windStrength: world.wind?.strength ?? 0
      });
      postPipeline?.setSeasonalRainState({
        enabled: false,
        intensity01: 0,
        visualIntensity01: 0,
        seed: world.seed,
        timeSeconds: weatherVisual.rainTimeSeconds,
        windScreenX: 0,
        windScreenY: 0,
        windStrength01: 0
      });
    }
  };

  const setSeasonLabel = (text: string): void => {
    hudState.seasonLabelOverride = text;
  };

  const setClimateForecast = (
    forecast: ClimateForecast | null,
    day: number,
    startDay: number,
    yearDays: number,
    meta: string | null
  ): void => {
    if (!forecast) {
      hudState.forecastOverride = null;
      return;
    }
    hudState.forecastOverride = {
      forecast,
      forecastDay: day,
      forecastStartDay: startDay,
      forecastYearDays: yearDays,
      forecastMeta: meta
    };
  };

  const setSimulationAlpha = (alpha: number): void => {
    simulationAlpha = clamp01(alpha);
    fireFx.setSimulationAlpha(simulationAlpha);
  };

  const captureFireSnapshot = (nextWorld: RenderSim): void => {
    fireFx.captureSnapshot(nextWorld);
  };

  const panToTile = (tileX: number, tileY: number, options: ThreeTestPanToTileOptions = {}): void => {
    if (!lastTerrainSurface) {
      return;
    }
    const cols = Math.max(1, world.grid.cols);
    const rows = Math.max(1, world.grid.rows);
    const clampedX = Math.max(0, Math.min(cols - 1, Math.floor(tileX)));
    const clampedY = Math.max(0, Math.min(rows - 1, Math.floor(tileY)));
    const worldX = lastTerrainSurface.toWorldX(clampedX + 0.5);
    const worldZ = lastTerrainSurface.toWorldZ(clampedY + 0.5);
    const worldY = lastTerrainSurface.heightAtTile(clampedX, clampedY) * lastTerrainSurface.heightScale;
    const endTarget = new THREE.Vector3(worldX, worldY, worldZ);
    const cameraOffset = camera.position.clone().sub(controls.target);
    const endPosition = endTarget.clone().add(cameraOffset);
    if (options.transition === "contextual") {
      const startTarget = controls.target.clone();
      const startPosition = camera.position.clone();
      const targetTravel = startTarget.distanceTo(endTarget);
      const tileSpan = Math.max(lastTerrainSurface.size.width / cols, lastTerrainSurface.size.depth / rows);
      const closeTravel = tileSpan * 5;
      const farTravel = tileSpan * 34;
      const travel01 = clamp01((targetTravel - closeTravel) / Math.max(tileSpan, farTravel - closeTravel));
      const currentDistance = Math.max(controls.minDistance, startPosition.distanceTo(startTarget));
      const arcLift = easeOutCubic(travel01) * Math.min(controls.maxDistance * 0.22, Math.max(tileSpan * 2, currentDistance * 0.42));
      const durationMs = Math.round(180 + easeOutCubic(Math.min(1, targetTravel / Math.max(tileSpan, farTravel))) * 720);
      cameraFlight = {
        startedAt: performance.now(),
        durationMs,
        startTarget,
        startPosition,
        endTarget,
        endPosition,
        arcLift
      };
      markCameraMotion();
      return;
    }
    cancelCameraFlight();
    controls.target.copy(endTarget);
    camera.position.copy(endPosition);
    controls.update();
    applyTerrainCameraConstraints();
    markCameraMotion();
  };

  const setBaseCardOpen = (open: boolean): void => {
    if (open && openHeadquartersFacility()) {
      return;
    }
    setBaseCardOpenInternal(false);
  };

  const setTerrainWaterDebugControls = (controls: Partial<TerrainWaterDebugControls>): void => {
    waterSystem.setDebugControls(controls);
    if (terrainMesh) {
      setInlandWaterSeamDebugMaterialMode(
        terrainMesh.material,
        waterSystem.getDebugControls().inlandWaterSeamDebugMode
      );
    }
  };

  const getTerrainWaterDebugControls = (): TerrainWaterDebugControls => waterSystem.getDebugControls();

  const collectTerrainChunkStats = (): { total: number; visible: number; culledInstances: number } => {
    if (!terrainMesh) {
      return { total: 0, visible: 0, culledInstances: 0 };
    }
    camera.updateMatrixWorld();
    terrainMesh.updateMatrixWorld(true);
    structureOverlayGroup?.updateMatrixWorld(true);
    const viewProjection = new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    const frustum = new THREE.Frustum().setFromProjectionMatrix(viewProjection);
    const worldSphere = new THREE.Sphere();
    let total = 0;
    let visible = 0;
    let culledInstances = 0;
    const collectRoot = (root: THREE.Object3D): void => root.traverse((child) => {
      if (!(child instanceof THREE.InstancedMesh) || !child.userData?.terrainChunkKey) {
        return;
      }
      total += 1;
      if (!child.boundingSphere) {
        child.computeBoundingSphere();
      }
      const isVisible = child.visible && !!child.boundingSphere && frustum.intersectsSphere(worldSphere.copy(child.boundingSphere).applyMatrix4(child.matrixWorld));
      if (isVisible) {
        visible += 1;
      } else {
        culledInstances += child.count;
      }
    });
    collectRoot(terrainMesh);
    if (structureOverlayGroup) {
      collectRoot(structureOverlayGroup);
    }
    return { total, visible, culledInstances };
  };

  const getPerfSnapshot = (): ThreeTestPerfSnapshot => {
    const waterfallDebug = lastTerrainWater?.waterfallDebug ?? null;
    const riverDebug = lastTerrainWater?.inland?.mesh.debugRiverDomainStats;
    const waterDebugControls = waterSystem.getDebugControls();
    const waterfallCount = lastTerrainWater?.inland?.surface.waterfalls.length ?? 0;
    const waterfallWallTriangleCount = Math.floor((lastTerrainWater?.inland?.mesh.waterfallWallIndices?.length ?? 0) / 3);
    const waterfallWallQuadCount =
      riverDebug?.wallQuadCount && Number.isFinite(riverDebug.wallQuadCount)
        ? Math.max(0, Math.round((lastTerrainWater?.inland?.mesh.waterfallWallIndices?.length ?? 0) / 6))
        : Math.max(0, Math.round((lastTerrainWater?.inland?.mesh.waterfallWallIndices?.length ?? 0) / 6));
    const waterfallWallQuadBreakdown = riverDebug?.waterfallWallQuadCounts?.length
      ? riverDebug.waterfallWallQuadCounts
          .slice(0, 8)
          .map((count) => Math.max(0, Math.round(count)).toString())
          .join("/")
      : "n/a";
    const terrainChunks = collectTerrainChunkStats();
    return {
      frameMs: threePerf.frameMs,
      frameLastMs: threePerf.frameLastMs,
      controlsMs: threePerf.controlsMs,
      treeBurnMs: threePerf.treeBurnMs,
      fireFxMs: threePerf.fireFxMs,
      fireFxDebug: threePerf.fireFxDebug
        ? {
            timingsMs: { ...threePerf.fireFxDebug.timingsMs },
            counts: { ...threePerf.fireFxDebug.counts },
            budgets: { ...threePerf.fireFxDebug.budgets },
            continuity: { ...threePerf.fireFxDebug.continuity },
            modes: { ...threePerf.fireFxDebug.modes }
          }
        : null,
      sceneRenderMs: threePerf.sceneRenderMs,
      sceneRenderLastMs: threePerf.sceneRenderLastMs,
      postMs: threePerf.postMs,
      dofMs: threePerf.dofMs,
      hudMs: threePerf.hudMs,
      uiRenderMs: threePerf.uiRenderMs,
      gpuWorldMs: threePerf.gpuWorldMs,
      gpuShadowRefreshMs: threePerf.gpuShadowRefreshMs,
      gpuPostMs: threePerf.gpuPostMs,
      gpuUiMs: threePerf.gpuUiMs,
      activeShadowLights: activeShadowLightCount,
      shadowRefreshCount,
      terrainChunkCount: terrainChunks.total,
      terrainVisibleChunkCount: terrainChunks.visible,
      terrainCulledInstanceCount: terrainChunks.culledInstances,
      roadOverlayTriangles: Number(terrainRoadOverlayMesh?.geometry.userData?.sparseTriangleCount ?? 0),
      roadOverlaySourceTriangles: Number(terrainRoadOverlayMesh?.geometry.userData?.sourceTriangleCount ?? 0),
      postPassCount: threePerf.postPassCount,
      vehicleBufferUploads: threePerf.vehicleBufferUploads,
      fps: threePerf.fps,
      rafGapMs: threePerf.rafGapMs,
      rafGapLastMs: threePerf.rafGapLastMs,
      rafGapMaxMs: threePerf.rafGapMaxMs,
      hitchCount: threePerf.hitchCount,
      lastHitchMs: threePerf.lastHitchMs,
      terrainSetMs: threePerf.terrainSetMs,
      terrainSetLastMs: threePerf.terrainSetLastMs,
      terrainSetMaxMs: threePerf.terrainSetMaxMs,
      terrainSetCount: threePerf.terrainSetCount,
      terrainSetFastReuseCount: threePerf.terrainSetFastReuseCount,
      terrainSetFullRebuildCount: threePerf.terrainSetFullRebuildCount,
      terrainSetFullRebuildReason: threePerf.terrainSetFullRebuildReason,
      terrainSetIntent: threePerf.terrainSetIntent,
      terrainSetPath: threePerf.terrainSetPath,
      terrainSetDominantStep: threePerf.terrainSetDominantStep,
      terrainSetMaxDominantStep: threePerf.terrainSetMaxDominantStep,
      terrainSetMaxIntent: threePerf.terrainSetMaxIntent,
      terrainSetMaxPath: threePerf.terrainSetMaxPath,
      terrainGeometrySignature: threePerf.terrainGeometrySignature,
      terrainGeometrySignatureChanged: threePerf.terrainGeometrySignatureChanged,
      terrainSetPrepareMs: threePerf.terrainSetPrepareMs,
      terrainSetPrepareLastMs: threePerf.terrainSetPrepareLastMs,
      terrainSetStaticPrepareMs: threePerf.terrainSetStaticPrepareMs,
      terrainSetStaticPrepareLastMs: threePerf.terrainSetStaticPrepareLastMs,
      terrainSetStaticPrepareCount: threePerf.terrainSetStaticPrepareCount,
      terrainSetVisualPrepareMs: threePerf.terrainSetVisualPrepareMs,
      terrainSetVisualPrepareLastMs: threePerf.terrainSetVisualPrepareLastMs,
      terrainSetVisualPrepareCount: threePerf.terrainSetVisualPrepareCount,
      terrainSetPrepareSkippedCount: threePerf.terrainSetPrepareSkippedCount,
      terrainSetReuseCheckMs: threePerf.terrainSetReuseCheckMs,
      terrainSetReuseCheckLastMs: threePerf.terrainSetReuseCheckLastMs,
      terrainSetColorMs: threePerf.terrainSetColorMs,
      terrainSetColorLastMs: threePerf.terrainSetColorLastMs,
      terrainSetTextureMs: threePerf.terrainSetTextureMs,
      terrainSetTextureLastMs: threePerf.terrainSetTextureLastMs,
      terrainSetTextureSwapMs: threePerf.terrainSetTextureSwapMs,
      terrainSetTextureSwapLastMs: threePerf.terrainSetTextureSwapLastMs,
      terrainSetRoadSignatureMs: threePerf.terrainSetRoadSignatureMs,
      terrainSetRoadSignatureLastMs: threePerf.terrainSetRoadSignatureLastMs,
      terrainSetStructureMs: threePerf.terrainSetStructureMs,
      terrainSetStructureLastMs: threePerf.terrainSetStructureLastMs,
      terrainSetFullDisposeMs: threePerf.terrainSetFullDisposeMs,
      terrainSetFullDisposeLastMs: threePerf.terrainSetFullDisposeLastMs,
      terrainSetFullBuildMs: threePerf.terrainSetFullBuildMs,
      terrainSetFullBuildLastMs: threePerf.terrainSetFullBuildLastMs,
      terrainSetWaterMs: threePerf.terrainSetWaterMs,
      terrainSetWaterLastMs: threePerf.terrainSetWaterLastMs,
      terrainRoadRefreshMs: threePerf.terrainRoadRefreshMs,
      terrainRoadRefreshLastMs: threePerf.terrainRoadRefreshLastMs,
      terrainRoadRefreshCount: threePerf.terrainRoadRefreshCount,
      sceneCalls: threePerf.sceneCalls,
      sceneTriangles: threePerf.sceneTriangles,
      sceneLines: threePerf.sceneLines,
      scenePoints: threePerf.scenePoints,
      totalCalls: threePerf.totalCalls,
      memoryGeometries: threePerf.memoryGeometries,
      memoryTextures: threePerf.memoryTextures,
      contextLosses: threePerf.contextLosses,
      contextRestores: threePerf.contextRestores,
      waterfallCount,
      waterfallCandidateCount: waterfallDebug?.candidateCount ?? 0,
      waterfallClusterCount: waterfallDebug?.clusterCount ?? 0,
      waterfallEmittedCount: waterfallDebug?.emittedCount ?? 0,
      waterfallRejectedVerticalCount: waterfallDebug?.lowVerticalityRejectedCount ?? 0,
      waterfallRejectedLongRunCount: waterfallDebug?.longRunRejectedCount ?? 0,
      waterfallWallQuadCount,
      waterfallWallTriangleCount,
      waterfallWallQuadBreakdown,
      environmentFogEnabled: getEnvironmentFogEnabled(),
      waterfallDebugHighlightEnabled: waterDebugControls.waterfallDebugHighlight,
      waterfallAnchorErrorMean: riverDebug?.waterfallAnchorErrorMean ?? Number.NaN,
      waterfallAnchorErrorMax: riverDebug?.waterfallAnchorErrorMax ?? Number.NaN,
      waterfallWallTopGapMean: riverDebug?.wallTopGapMean ?? Number.NaN,
      waterfallWallTopGapMax: riverDebug?.wallTopGapMax ?? Number.NaN
    };
  };

  const syncCameraClipPlanes = (): void => {
    const terrainSpan = lastTerrainSize ? Math.max(lastTerrainSize.width, lastTerrainSize.depth) : 12;
    const cameraDistance = Math.max(1, camera.position.distanceTo(controls.target));
    const nextNear = Math.max(0.1, Math.min(1.5, cameraDistance * 0.002));
    const nextFar = Math.max(500, terrainSpan * 14, controls.maxDistance * 3, cameraDistance * 10);
    if (Math.abs(camera.near - nextNear) <= 1e-4 && Math.abs(camera.far - nextFar) <= 1e-2) {
      return;
    }
    camera.near = nextNear;
    camera.far = nextFar;
    camera.updateProjectionMatrix();
  };

  const updateCameraForSize = (size: number): void => {
    cancelCameraFlight();
    const distance = Math.max(8, size * 0.6);
    // Fog parameters are managed by CinematicGrade mode.
    camera.position.set(distance * 0.65, distance * 0.55, distance * 0.65);
    if (THREE_TEST_RIVER_VIEW === "top") {
      camera.position.set(0, distance * 1.35, 0.001);
    } else if (THREE_TEST_RIVER_VIEW === "under") {
      camera.position.set(distance * 0.55, -distance * 0.42, distance * 0.55);
    } else if (THREE_TEST_RIVER_VIEW === "oblique") {
      camera.position.set(distance * 0.7, distance * 0.5, distance * 0.58);
    }
    controls.minDistance = Math.max(3, distance * 0.15);
    controls.maxDistance = Math.max(120, distance * 4);
    controls.target.set(0, 0, 0);
    if (THREE_TEST_RIVER_VIEW_LOCK) {
      controls.enableRotate = false;
      controls.enablePan = false;
      controls.enableZoom = false;
    }
    controls.update();
    applyTerrainCameraConstraints();
    syncCameraClipPlanes();
    seasonalSky.syncToCamera(camera);
    if (lastLightingApplied) {
      syncDirectionalLightRig(lastLightingApplied);
      syncSunGlare(lastLightingApplied);
    }
    requestShadowRefresh();
  };

  const findRoadOverlayMesh = (root: THREE.Object3D): THREE.Mesh | null => {
    let found: THREE.Mesh | null = null;
    root.traverse((child) => {
      if (found || !(child instanceof THREE.Mesh)) {
        return;
      }
      if ((child as THREE.Mesh).userData?.roadOverlay) {
        found = child as THREE.Mesh;
      }
    });
    return found;
  };

  const patchTerrainClimateMaterial = (material: THREE.Material): void => {
    const standard = material as THREE.MeshStandardMaterial & { userData?: Record<string, unknown> };
    if (!(standard instanceof THREE.MeshStandardMaterial)) {
      return;
    }
    if (!standard.userData) {
      standard.userData = {};
    }
    if (standard.userData.terrainClimatePatched) {
      return;
    }
    const priorOnBeforeCompile = standard.onBeforeCompile;
    standard.onBeforeCompile = (shader, renderer) => {
      if (priorOnBeforeCompile) {
        priorOnBeforeCompile(shader, renderer);
      }
      shader.uniforms.uRisk01 = terrainClimateUniforms.uRisk01;
      shader.uniforms.uSeasonT01 = terrainClimateUniforms.uSeasonT01;
      shader.uniforms.uWorldSeed = terrainClimateUniforms.uWorldSeed;
      shader.fragmentShader =
        `uniform float uRisk01;\n` +
        `uniform float uSeasonT01;\n` +
        `uniform float uWorldSeed;\n` +
        `float terrainHash12Climate(vec2 p){\n` +
        `  vec3 p3 = fract(vec3(p.xyx) * 0.1031);\n` +
        `  p3 += dot(p3, p3.yzx + 33.33);\n` +
        `  return fract((p3.x + p3.y) * p3.z);\n` +
        `}\n` +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "float risk = clamp(uRisk01, 0.0, 1.0);",
          "vec2 seasonUv = vMapUv;",
          "float seasonNoise = terrainHash12Climate(seasonUv * vec2(211.7, 173.3) + vec2(uWorldSeed * 0.0013, uWorldSeed * 0.0021));",
          "float autumnNoise = terrainHash12Climate(seasonUv * vec2(381.1, 289.7) + vec2(11.7, 5.3) + vec2(uWorldSeed * 0.0007));",
          `float localSeasonT = fract(uSeasonT01 + (seasonNoise - 0.5) * ${GROUND_PHASE_SHIFT_MAX.toFixed(4)});`,
          "float vegMask = clamp((diffuseColor.g - max(diffuseColor.r, diffuseColor.b) - 0.01) * 4.0, 0.0, 1.0);",
          "vec3 dryTint = vec3(0.78, 0.67, 0.42);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, dryTint, vegMask * risk * 0.38);",
          "float spring = smoothstep(0.18, 0.28, localSeasonT) * (1.0 - smoothstep(0.42, 0.52, localSeasonT));",
          "float summer = smoothstep(0.42, 0.52, localSeasonT) * (1.0 - smoothstep(0.66, 0.76, localSeasonT));",
          "float autumn = smoothstep(0.62, 0.7, localSeasonT) * (1.0 - smoothstep(0.90, 0.98, localSeasonT));",
          "float winterA = 1.0 - smoothstep(0.08, 0.18, localSeasonT);",
          "float winterB = smoothstep(0.88, 0.96, localSeasonT);",
          "float winter = clamp(winterA + winterB, 0.0, 1.0);",
          `float autumnHueBias = clamp((autumnNoise * 2.0 - 1.0) * ${AUTUMN_HUE_JITTER.toFixed(4)}, -${AUTUMN_HUE_JITTER.toFixed(4)}, ${AUTUMN_HUE_JITTER.toFixed(4)});`,
          "vec3 autumnGold = vec3(0.90, 0.69, 0.32);",
          "vec3 autumnRust = vec3(0.73, 0.41, 0.24);",
          "vec3 autumnTint = mix(autumnGold, autumnRust, 0.5 + autumnHueBias * 0.5);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, autumnTint, vegMask * autumn * 0.34);",
          "float springLift = vegMask * spring * 0.09;",
          "float summerLift = vegMask * summer * 0.04;",
          "diffuseColor.rgb *= 1.0 + springLift + summerLift;",
          "float winterMix = vegMask * winter * 0.36;",
          "float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));",
          "vec3 winterTint = mix(vec3(luma), vec3(luma * 0.96, luma * 0.98, luma * 1.03), 0.5);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, winterTint, winterMix);"
        ].join("\n")
      );
    };
    standard.userData.terrainClimatePatched = true;
    standard.needsUpdate = true;
  };

  const patchTerrainClimateMaterials = (material: THREE.Material | THREE.Material[]): void => {
    if (!ENABLE_THREE_TEST_SEASONAL_RECOLOR) {
      return;
    }
    if (Array.isArray(material)) {
      material.forEach((entry) => patchTerrainClimateMaterial(entry));
      return;
    }
    patchTerrainClimateMaterial(material);
  };

  const typedArrayEqual = (
    a: ArrayLike<number> | null | undefined,
    b: ArrayLike<number> | null | undefined,
    epsilon = 1e-6
  ): boolean => {
    if (!a || !b) {
      return !a && !b;
    }
    if (a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i += 1) {
      if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > epsilon) {
        return false;
      }
    }
    return true;
  };

  const geometryRelevantTileTypesEqual = (previous: TerrainSample, next: TerrainSample): boolean => {
    const previousHasStaticWater = !!previous.oceanMask || !!previous.riverMask || !!previous.lakeMask;
    const nextHasStaticWater = !!next.oceanMask || !!next.riverMask || !!next.lakeMask;
    if (previousHasStaticWater && nextHasStaticWater && previous.dynamicStructures && next.dynamicStructures) {
      return true;
    }
    const previousTypes = previous.tileTypes;
    const nextTypes = next.tileTypes;
    if (!previousTypes || !nextTypes) {
      return previousTypes === nextTypes;
    }
    if (previousTypes.length !== nextTypes.length) {
      return false;
    }
    const baseId = TILE_TYPE_IDS.base;
    const houseId = TILE_TYPE_IDS.house;
    const waterId = TILE_TYPE_IDS.water;
    const trackStructureTiles = !previous.dynamicStructures || !next.dynamicStructures;
    for (let i = 0; i < previousTypes.length; i += 1) {
      const previousType = previousTypes[i];
      const nextType = nextTypes[i];
      const previousRelevant =
        previousType === waterId ||
        (trackStructureTiles && (previousType === baseId || previousType === houseId));
      const nextRelevant =
        nextType === waterId ||
        (trackStructureTiles && (nextType === baseId || nextType === houseId));
      if ((previousRelevant || nextRelevant) && previousType !== nextType) {
        return false;
      }
    }
    return true;
  };

  const staticTerrainSourceMatchesCache = (sample: TerrainSample): boolean => {
    if (!terrainMesh || !lastSample || !lastTerrainSurface || !lastTerrainSize) {
      return false;
    }
    if (!sample.fastUpdate) {
      return false;
    }
    if (sample.cols !== lastSample.cols || sample.rows !== lastSample.rows) {
      return false;
    }
    if (sample.elevations !== lastSample.elevations) {
      return false;
    }
    if (sample.heightScaleMultiplier !== lastSample.heightScaleMultiplier || sample.fullResolution !== lastSample.fullResolution) {
      return false;
    }
    if (
      sample.oceanMask !== lastSample.oceanMask ||
      sample.riverMask !== lastSample.riverMask ||
      sample.lakeMask !== lastSample.lakeMask ||
      sample.seaLevel !== lastSample.seaLevel ||
      sample.coastDistance !== lastSample.coastDistance ||
      sample.coastClass !== lastSample.coastClass ||
      sample.erosionWear !== lastSample.erosionWear ||
      sample.riverSurface !== lastSample.riverSurface ||
      sample.riverStepStrength !== lastSample.riverStepStrength ||
      sample.lakeSurface !== lastSample.lakeSurface
    ) {
      return false;
    }
    if (sample.dynamicStructures !== lastSample.dynamicStructures) {
      return false;
    }
    if (!sample.dynamicStructures && (sample.structureRevision ?? -1) !== (lastSample.structureRevision ?? -1)) {
      return false;
    }
    if (!geometryRelevantTileTypesEqual(lastSample, sample)) {
      return false;
    }
    const step = getTerrainStep(Math.max(sample.cols, sample.rows), sample.fullResolution ?? false);
    const sampleCols = Math.floor((sample.cols - 1) / step) + 1;
    const sampleRows = Math.floor((sample.rows - 1) / step) + 1;
    const heightScale = getTerrainHeightScale(sample.cols, sample.rows, sample.heightScaleMultiplier ?? 1);
    return (
      step === lastTerrainSurface.step &&
      sampleCols === lastTerrainSurface.sampleCols &&
      sampleRows === lastTerrainSurface.sampleRows &&
      Math.abs(heightScale - lastTerrainSurface.heightScale) <= 1e-6
    );
  };

  const canReuseTerrainSurface = (sample: TerrainSample, surface: TerrainRenderSurface): boolean => {
    if (!lastSample || !lastTerrainSurface || !lastTerrainSize) {
      return false;
    }
    if (sample.cols !== lastSample.cols || sample.rows !== lastSample.rows) {
      return false;
    }
    if (sample.elevations.length !== lastSample.elevations.length) {
      return false;
    }
    if (sample.dynamicStructures !== lastSample.dynamicStructures) {
      return false;
    }
    if (!sample.dynamicStructures && (sample.structureRevision ?? -1) !== (lastSample.structureRevision ?? -1)) {
      return false;
    }
    if (!geometryRelevantTileTypesEqual(lastSample, sample)) {
      return false;
    }
    if (
      Math.abs(lastTerrainSurface.size.width - surface.size.width) > 1e-6 ||
      Math.abs(lastTerrainSurface.size.depth - surface.size.depth) > 1e-6 ||
      Math.abs(lastTerrainSurface.heightScale - surface.heightScale) > 1e-6 ||
      lastTerrainSurface.step !== surface.step ||
      lastTerrainSurface.sampleCols !== surface.sampleCols ||
      lastTerrainSurface.sampleRows !== surface.sampleRows ||
      lastTerrainSurface.geometrySignature !== surface.geometrySignature ||
      !typedArrayEqual(lastTerrainSurface.oceanMask, surface.oceanMask, 0) ||
      !typedArrayEqual(lastTerrainSurface.riverMask, surface.riverMask, 0) ||
      !typedArrayEqual(lastTerrainSurface.waterRatios.water, surface.waterRatios.water) ||
      !typedArrayEqual(lastTerrainSurface.waterRatios.ocean, surface.waterRatios.ocean) ||
      !typedArrayEqual(lastTerrainSurface.waterRatios.river, surface.waterRatios.river) ||
      !typedArrayEqual(lastTerrainSurface.sampledRiverSurface, surface.sampledRiverSurface) ||
      !typedArrayEqual(lastTerrainSurface.sampledRiverStepStrength, surface.sampledRiverStepStrength) ||
      !typedArrayEqual(lastTerrainSurface.sampledRiverCoverage, surface.sampledRiverCoverage) ||
      !typedArrayEqual(lastTerrainSurface.sampledLakeSurface, surface.sampledLakeSurface) ||
      !typedArrayEqual(lastTerrainSurface.sampledLakeCoverage, surface.sampledLakeCoverage)
    ) {
      return false;
    }
    const previousWaterLevel = lastTerrainSurface.waterLevel;
    const nextWaterLevel = surface.waterLevel;
    if (previousWaterLevel === null || nextWaterLevel === null) {
      return previousWaterLevel === nextWaterLevel;
    }
    return Math.abs(previousWaterLevel - nextWaterLevel) <= 1e-6;
  };

  const getTerrainSurfaceReuseBlocker = (sample: TerrainSample, surface: TerrainRenderSurface | null): string => {
    if (!terrainMesh) {
      return "no-mesh";
    }
    if (!sample.fastUpdate) {
      return assetRebuildPending ? "asset-rebuild" : "full-sample";
    }
    if (!surface) {
      return "no-surface";
    }
    if (!lastSample || !lastTerrainSurface || !lastTerrainSize) {
      return "no-cache";
    }
    if (sample.cols !== lastSample.cols || sample.rows !== lastSample.rows) {
      return "size";
    }
    if (sample.elevations.length !== lastSample.elevations.length) {
      return "height-length";
    }
    if (sample.dynamicStructures !== lastSample.dynamicStructures) {
      return "structure-mode";
    }
    if (!sample.dynamicStructures && (sample.structureRevision ?? -1) !== (lastSample.structureRevision ?? -1)) {
      return "structure-geometry";
    }
    if (!geometryRelevantTileTypesEqual(lastSample, sample)) {
      return "water-or-structure-type";
    }
    if (
      Math.abs(lastTerrainSurface.size.width - surface.size.width) > 1e-6 ||
      Math.abs(lastTerrainSurface.size.depth - surface.size.depth) > 1e-6 ||
      Math.abs(lastTerrainSurface.heightScale - surface.heightScale) > 1e-6 ||
      lastTerrainSurface.step !== surface.step ||
      lastTerrainSurface.sampleCols !== surface.sampleCols ||
      lastTerrainSurface.sampleRows !== surface.sampleRows
    ) {
      return "surface-layout";
    }
    if (lastTerrainSurface.geometrySignature !== surface.geometrySignature) {
      return "geometry-signature";
    }
    if (
      !typedArrayEqual(lastTerrainSurface.oceanMask, surface.oceanMask, 0) ||
      !typedArrayEqual(lastTerrainSurface.riverMask, surface.riverMask, 0) ||
      !typedArrayEqual(lastTerrainSurface.waterRatios.water, surface.waterRatios.water) ||
      !typedArrayEqual(lastTerrainSurface.waterRatios.ocean, surface.waterRatios.ocean) ||
      !typedArrayEqual(lastTerrainSurface.waterRatios.river, surface.waterRatios.river)
    ) {
      return "water-geometry";
    }
    if (
      !typedArrayEqual(lastTerrainSurface.sampledRiverSurface, surface.sampledRiverSurface) ||
      !typedArrayEqual(lastTerrainSurface.sampledRiverStepStrength, surface.sampledRiverStepStrength) ||
      !typedArrayEqual(lastTerrainSurface.sampledRiverCoverage, surface.sampledRiverCoverage) ||
      !typedArrayEqual(lastTerrainSurface.sampledLakeSurface, surface.sampledLakeSurface) ||
      !typedArrayEqual(lastTerrainSurface.sampledLakeCoverage, surface.sampledLakeCoverage)
    ) {
      return "water-detail";
    }
    const previousWaterLevel = lastTerrainSurface.waterLevel;
    const nextWaterLevel = surface.waterLevel;
    if (previousWaterLevel === null || nextWaterLevel === null) {
      return previousWaterLevel === nextWaterLevel ? "unknown" : "water-level";
    }
    return Math.abs(previousWaterLevel - nextWaterLevel) <= 1e-6 ? "unknown" : "water-level";
  };

  const updateTerrainSurface = (
    sample: TerrainSample,
    surface: TerrainRenderSurface,
    intent: NormalizedThreeTestTerrainUpdateIntent
  ): boolean => {
    const reuseCheckStartedAt = performance.now();
    const canReuse = Boolean(terrainMesh && sample.fastUpdate && canReuseTerrainSurface(sample, surface));
    recordTerrainSetTiming("reuseCheck", performance.now() - reuseCheckStartedAt);
    if (!terrainMesh || !sample.fastUpdate || !canReuse) {
      return false;
    }
    const roadOnly = isOnlyTerrainUpdateIntent(intent, "roads");
    const structureOnly = isOnlyTerrainUpdateIntent(intent, "structure");
    const vegetationOnly = isOnlyTerrainUpdateIntent(intent, "vegetation");
    const shouldUpdateBaseSurface = !roadOnly && !structureOnly && !vegetationOnly;
    const shouldCheckRoadVisuals = !structureOnly && !vegetationOnly && (intent.roads || intent.geometry || intent.debug || intent.label === "fast-unspecified");
    threePerf.terrainSetPath = roadOnly ? "road-only" : structureOnly ? "structure-only" : vegetationOnly ? "vegetation-only" : "fast";
    const terrainSurfaceShadingMode = sample.debugRenderOptions?.terrainSurfaceShadingMode ?? "refined";
    const useLegacyFacetedTerrain = terrainSurfaceShadingMode === "legacyFaceted";
    const useTextureColorFastPath = !useLegacyFacetedTerrain && sample.fastUpdate === true;
    const palette = buildPalette();
    const grassId = TILE_TYPE_IDS.grass;
    const forestId = TILE_TYPE_IDS.forest;
    const waterId = TILE_TYPE_IDS.water;
    const roadId = TILE_TYPE_IDS.road;
    if (shouldUpdateBaseSurface && terrainMesh.geometry instanceof THREE.BufferGeometry) {
      const colorStartedAt = performance.now();
      try {
        if (useLegacyFacetedTerrain) {
          terrainMesh.geometry.deleteAttribute("color");
        } else if (useTextureColorFastPath) {
          ensureTerrainVertexColorsWhite(terrainMesh.geometry);
        } else {
          applyTerrainSurfaceColors(terrainMesh.geometry, sample, surface);
        }
      } finally {
        recordTerrainSetTiming("color", performance.now() - colorStartedAt);
      }
    }
    if (shouldUpdateBaseSurface) {
      const textureStartedAt = performance.now();
      const currentTexture = (() => {
        if (!intent.dirtyTileBounds || sample.debugTypeColors || sample.debugScalarField) {
          return null;
        }
        const material = terrainMesh.material;
        const firstMaterial = Array.isArray(material) ? material[0] : material;
        const map = (firstMaterial as THREE.Material & { map?: THREE.Texture | null }).map;
        return map instanceof THREE.DataTexture ? map : null;
      })();
      const tileTexture = buildTileTexture(
        sample,
        surface.sampleCols,
        surface.sampleRows,
        surface.step,
        palette,
        grassId,
        TILE_TYPE_IDS.scrub,
        TILE_TYPE_IDS.floodplain,
        TILE_TYPE_IDS.beach,
        forestId,
        waterId,
        roadId,
        surface.heightScale,
        surface.sampleHeights,
        surface.sampleTypes,
        surface.waterRatios.water,
        surface.waterRatios.ocean,
        surface.waterRatios.river,
        surface.sampledErosionWear ?? null,
        surface.sampledRiverCoverage ?? null,
        surface.sampledLakeCoverage ?? null,
        surface.sampledRiverStepStrength,
        sample.debugTypeColors ?? false,
        useLegacyFacetedTerrain || useTextureColorFastPath ? "legacy" : "mask",
        {
          includeDynamicFireScorch: false,
          sampleCoastClass: surface.sampleCoastClass,
          sampleCoastDistance: surface.sampleCoastDistance,
          updateTarget:
            currentTexture && intent.dirtyTileBounds
              ? {
                  sourceTexture: currentTexture,
                  dirtyTileBounds: intent.dirtyTileBounds
                }
              : undefined
        }
      );
      recordTerrainSetTiming("texture", performance.now() - textureStartedAt);
      const textureSwapStartedAt = performance.now();
      if (tileTexture !== currentTexture) {
        const previousMaps = assignTerrainTextureMap(terrainMesh.material, tileTexture);
        queueTerrainTextureDisposals(pendingTerrainTextureDisposals, previousMaps);
      }
      refreshTerrainScorchedGroundMaterial(terrainMesh.material, sample, surface, !useLegacyFacetedTerrain);
      recordTerrainSetTiming("textureSwap", performance.now() - textureSwapStartedAt);
    }

    if (shouldCheckRoadVisuals) {
      const roadSignatureStartedAt = performance.now();
      const nextRoadSignature = getTerrainRoadVisualSignature(sample);
      const previousRoadSignature = terrainMesh.userData?.roadVisualSignature;
      const roadMesh = terrainRoadOverlayMesh ?? findRoadOverlayMesh(terrainMesh);
      const roadOverlayVersion = roadMesh?.userData?.roadOverlayVersion ?? -1;
      recordTerrainSetTiming("roadSignature", performance.now() - roadSignatureStartedAt);
      if (nextRoadSignature !== previousRoadSignature || getRoadAtlasVersion() !== roadOverlayVersion) {
        const roadStartedAt = performance.now();
        terrainRoadOverlayMesh = refreshTerrainRoadVisuals(terrainMesh, sample, surface);
        const roadRefreshMs = performance.now() - roadStartedAt;
        threePerf.terrainRoadRefreshLastMs = roadRefreshMs;
        threePerf.terrainRoadRefreshMs = smoothPerf(threePerf.terrainRoadRefreshMs, roadRefreshMs);
        threePerf.terrainRoadRefreshCount += 1;
      } else if (roadMesh) {
        terrainRoadOverlayMesh = roadMesh;
      }
      if (roadHighContrastEnabled) {
        setTerrainRoadHighContrast(terrainMesh, true);
      }
    }
    lastTerrainSurface = surface;
    lastTerrainSize = surface.size;
    return true;
  };


  const setTerrain = (sample: TerrainSample, updateIntent?: ThreeTestTerrainUpdateIntent): void => {
    const setTerrainStartedAt = performance.now();
    resetTerrainSetLastTimings();
    try {
      let nextSample = sample;
      if (assetRebuildPending && nextSample.fastUpdate) {
        assetRebuildPending = false;
        nextSample = {
          ...nextSample,
          fastUpdate: false
        };
      }
      if (Number.isFinite(nextSample.worldSeed)) {
        terrainClimateUniforms.uWorldSeed.value = nextSample.worldSeed as number;
      }
      if (!nextSample.fastUpdate) {
        assetRebuildPending = false;
      }
      const intent = normalizeTerrainUpdateIntent(updateIntent, Boolean(nextSample.fastUpdate));
      const satelliteRelevantTerrainUpdate =
        intent.geometry || intent.vegetation || intent.roads || intent.structure || intent.debug;
      threePerf.terrainSetIntent = intent.label;
      threePerf.terrainSetPath = "pending";
      if (nextSample.fastUpdate && isFireVisualOnlyTerrainUpdateIntent(intent)) {
        threePerf.terrainSetPath = "fire-visual-skip";
        return;
      }
      const roadOnly = isOnlyTerrainUpdateIntent(intent, "roads");
      const structureOnly = isOnlyTerrainUpdateIntent(intent, "structure");
      const vegetationOnly = isOnlyTerrainUpdateIntent(intent, "vegetation");
      const shouldPrepareVisualSurface = !roadOnly && !structureOnly && !vegetationOnly;
      const canUseStaticCache = staticTerrainSourceMatchesCache(nextSample);
      let nextSurface: TerrainRenderSurface | null = null;
      let preparedStaticSurface = false;
      if (nextSample.cols > 1 && nextSample.rows > 1 && nextSample.elevations.length > 0) {
        if (canUseStaticCache && lastTerrainSurface) {
          if (shouldPrepareVisualSurface) {
            const visualPrepareStartedAt = performance.now();
            nextSurface = prepareTerrainRenderVisualSurface(nextSample, lastTerrainSurface);
            const visualPrepareMs = performance.now() - visualPrepareStartedAt;
            recordTerrainSetTiming("prepare", visualPrepareMs);
            recordTerrainSetTiming("visualPrepare", visualPrepareMs);
            threePerf.terrainSetVisualPrepareCount += 1;
          } else {
            nextSurface = {
              ...lastTerrainSurface,
              sample: nextSample
            };
            threePerf.terrainSetPrepareSkippedCount += 1;
          }
        }
        if (!nextSurface) {
          const prepareStartedAt = performance.now();
          nextSurface = prepareTerrainRenderSurface(nextSample);
          const staticPrepareMs = performance.now() - prepareStartedAt;
          recordTerrainSetTiming("prepare", staticPrepareMs);
          recordTerrainSetTiming("staticPrepare", staticPrepareMs);
          threePerf.terrainSetStaticPrepareCount += 1;
          preparedStaticSurface = true;
        }
      }
      threePerf.terrainGeometrySignature = nextSurface?.geometrySignature ?? "none";
      threePerf.terrainGeometrySignatureChanged =
        !!nextSurface && !!lastTerrainSurface && lastTerrainSurface.geometrySignature !== nextSurface.geometrySignature;
      const blockerStartedAt = performance.now();
      const fullRebuildReason =
        canUseStaticCache && nextSurface && !preparedStaticSurface ? "none" : getTerrainSurfaceReuseBlocker(nextSample, nextSurface);
      recordTerrainSetTiming("reuseCheck", performance.now() - blockerStartedAt);
      if (nextSurface && updateTerrainSurface(nextSample, nextSurface, intent)) {
        threePerf.terrainSetFastReuseCount += 1;
        threePerf.terrainSetFullRebuildReason = "none";
        lastSample = nextSample;
        lastTerrainSurface = nextSurface;
        lastTerrainSize = nextSurface.size;
        applyTerrainCameraConstraints();
        if (!vegetationOnly) {
          const structureStartedAt = performance.now();
          rebuildStructureOverlay(nextSample, nextSurface);
          recordTerrainSetTiming("structure", performance.now() - structureStartedAt);
        }
        if (satelliteRelevantTerrainUpdate) {
          markSatelliteMinimapVisualsDirty();
        }
        requestShadowRefresh();
        return;
      }
      threePerf.terrainSetFullRebuildCount += 1;
      threePerf.terrainSetFullRebuildReason = fullRebuildReason;
      threePerf.terrainSetPath = "full";
      lastSample = nextSample;
      if (terrainMesh) {
        const fullDisposeStartedAt = performance.now();
        const activeTerrainMesh = terrainMesh;
        scene.remove(activeTerrainMesh);
        activeTerrainMesh.traverse((child) => {
          if (!(child instanceof THREE.Mesh)) {
            return;
          }
          if (child === activeTerrainMesh) {
            return;
          }
          const meshChild = child as THREE.Mesh;
          if (meshChild.geometry && meshChild.geometry !== activeTerrainMesh.geometry) {
            meshChild.geometry.dispose();
          }
          const material = meshChild.material;
          const disposeMaterial = (mat: THREE.Material) => {
            const textured = mat as THREE.Material & { map?: THREE.Texture | null };
            if (textured.map) {
              textured.map.dispose();
            }
            mat.dispose();
          };
          if (Array.isArray(material)) {
            material.forEach((mat) => disposeMaterial(mat));
          } else {
            disposeMaterial(material);
          }
        });
        activeTerrainMesh.geometry.dispose();
        if (Array.isArray(activeTerrainMesh.material)) {
          activeTerrainMesh.material.forEach((material) => {
            const textured = material as THREE.Material & { map?: THREE.Texture | null };
            if (textured.map) {
              textured.map.dispose();
            }
            material.dispose();
          });
        } else {
          const textured = activeTerrainMesh.material as THREE.Material & { map?: THREE.Texture | null };
          if (textured.map) {
            textured.map.dispose();
          }
          activeTerrainMesh.material.dispose();
        }
        terrainMesh = null;
        terrainRoadOverlayMesh = null;
        treeBurnController = null;
        recordTerrainSetTiming("fullDispose", performance.now() - fullDisposeStartedAt);
      }
      const waterClearStartedAt = performance.now();
      waterSystem.clear();
      recordTerrainSetTiming("water", performance.now() - waterClearStartedAt);
      lastTerrainWater = null;
      if (nextSample.cols <= 1 || nextSample.rows <= 1 || nextSample.elevations.length === 0) {
        threePerf.terrainSetPath = "empty";
        lastTerrainSurface = null;
        lastTerrainSize = null;
        const structureStartedAt = performance.now();
        disposeStructureOverlay();
        recordTerrainSetTiming("structure", performance.now() - structureStartedAt);
        lastStructureRevision = nextSample.structureRevision ?? -1;
        lastStructureOverlayKey = `${nextSample.cols}x${nextSample.rows}:${nextSample.worldSeed ?? -1}`;
        ground.visible = true;
        if (satelliteRelevantTerrainUpdate) {
          markSatelliteMinimapVisualsDirty();
        }
        return;
      }
      if (!nextSurface) {
        ground.visible = true;
        return;
      }
      const fullBuildStartedAt = performance.now();
      const { mesh, size, water, treeBurn } = buildTerrainMesh(
        nextSurface,
        treeAssets,
        houseAssets,
        firestationAsset,
        treeSeasonVisualConfig
      );
      recordTerrainSetTiming("fullBuild", performance.now() - fullBuildStartedAt);
      terrainMesh = mesh;
      setInlandWaterSeamDebugMaterialMode(
        terrainMesh.material,
        waterSystem.getDebugControls().inlandWaterSeamDebugMode
      );
      terrainRoadOverlayMesh = findRoadOverlayMesh(terrainMesh);
      if (roadHighContrastEnabled) {
        setTerrainRoadHighContrast(terrainMesh, true);
      }
      patchTerrainClimateMaterials(terrainMesh.material);
      treeBurnController = treeBurn ?? null;
      scene.add(terrainMesh);
      ground.visible = false;

      const maxSize = Math.max(size.width, size.depth);
      const previousTerrainSize = lastTerrainSize;
      lastTerrainSurface = nextSurface;
      const sizeChanged =
        !previousTerrainSize ||
        Math.abs(previousTerrainSize.width - size.width) > 0.01 ||
        Math.abs(previousTerrainSize.depth - size.depth) > 0.01;
      if (!cameraLockedToTerrain || sizeChanged) {
        updateCameraForSize(maxSize);
        cameraLockedToTerrain = true;
      } else {
        applyTerrainCameraConstraints();
      }
      lastTerrainSize = size;
      if (lastLightingApplied) {
        applyLightingState(lastLightingApplied);
      }

      if (water) {
        const waterStartedAt = performance.now();
        lastTerrainWater = water;
        waterSystem.rebuild(mesh, water);
        recordTerrainSetTiming("water", performance.now() - waterStartedAt);
      }
      if (lastLightingApplied) {
        applyLightingState(lastLightingApplied);
        syncWaterEnvironment(lastLightingApplied);
      }
      const structureStartedAt = performance.now();
      rebuildStructureOverlay(nextSample, nextSurface);
      recordTerrainSetTiming("structure", performance.now() - structureStartedAt);
      if (satelliteRelevantTerrainUpdate) {
        markSatelliteMinimapVisualsDirty();
      }
      requestShadowRefresh();
    } finally {
      const terrainSetMs = performance.now() - setTerrainStartedAt;
      const terrainSetMaxBeforeDecay = threePerf.terrainSetMaxMs * 0.997;
      const dominantStep = getDominantTerrainSetStep();
      threePerf.terrainSetDominantStep = dominantStep;
      if (terrainSetMs >= terrainSetMaxBeforeDecay) {
        threePerf.terrainSetMaxDominantStep = dominantStep;
        threePerf.terrainSetMaxIntent = threePerf.terrainSetIntent;
        threePerf.terrainSetMaxPath = threePerf.terrainSetPath;
      }
      threePerf.terrainSetLastMs = terrainSetMs;
      threePerf.terrainSetMs = smoothPerf(threePerf.terrainSetMs, terrainSetMs);
      threePerf.terrainSetMaxMs = Math.max(terrainSetMs, terrainSetMaxBeforeDecay);
      threePerf.terrainSetCount += 1;
      threePerf.fps = 0;
      threePerf.rafGapMs = 0;
      threePerf.rafGapLastMs = 0;
      lastFrameTime = 0;
      lastPresentedAt = 0;
    }
  };

  const rebuildTerrainFromLastSample = (): void => {
    if (!lastSample) {
      assetRebuildPending = true;
      return;
    }
    setTerrain({
      ...lastSample,
      fastUpdate: false
    });
  };
  const refreshRoadOverlayIfNeeded = (): void => {
    if (!terrainMesh || !lastSample || !terrainRoadOverlayMesh) {
      return;
    }
    const nextRoadVersion = getRoadAtlasVersion();
    const currentRoadVersion = terrainRoadOverlayMesh.userData?.roadOverlayVersion ?? -1;
    if (nextRoadVersion === currentRoadVersion) {
      return;
    }
    const roadOverlay = buildRoadOverlayTexture(
      lastSample,
      TILE_TYPE_IDS.road,
      TILE_TYPE_IDS.base,
      ROAD_SURFACE_WIDTH,
      ROAD_TEX_SCALE
    );
    if (!roadOverlay) {
      return;
    }
    const roadMaterial = terrainRoadOverlayMesh.material as THREE.Material & { map?: THREE.Texture | null };
    if (roadMaterial.map) {
      roadMaterial.map.dispose();
    }
    roadMaterial.map = roadOverlay;
    roadMaterial.needsUpdate = true;
    terrainRoadOverlayMesh.userData.roadOverlayVersion = nextRoadVersion;
    if (roadHighContrastEnabled) {
      setTerrainRoadHighContrast(terrainMesh, true);
    }
    markSatelliteMinimapVisualsDirty();
  };
  const needTreeAssets = runtimeSettings.trees && !treeAssets;
  const needHouseAssets = THREE_TEST_DETAILED_STRUCTURES_ENABLED && !houseAssets;
  const needFirestationAsset = THREE_TEST_DETAILED_STRUCTURES_ENABLED && !firestationAsset;
  let pendingAssetSettles =
    (needTreeAssets ? 1 : 0) +
    (needHouseAssets ? 1 : 0) +
    (needFirestationAsset ? 1 : 0);
  let assetRebuildQueued = false;
  const queueAssetRebuild = (): void => {
    if (assetRebuildQueued || pendingAssetSettles > 0) {
      return;
    }
    assetRebuildPending = true;
    assetRebuildQueued = true;
    window.requestAnimationFrame(() => {
      assetRebuildQueued = false;
      rebuildTerrainFromLastSample();
    });
  };
  const markAssetSettled = (): void => {
    pendingAssetSettles = Math.max(0, pendingAssetSettles - 1);
    if (pendingAssetSettles === 0) {
      queueAssetRebuild();
    }
  };

  if (needTreeAssets) {
    void loadTreeAssets()
      .then((assets) => {
        treeAssets = assets;
        markAssetSettled();
      })
      .catch((error) => {
        console.warn("Failed to load tree models.", error);
        markAssetSettled();
      });
  }

  if (needHouseAssets) {
    void loadHouseAssets()
      .then((assets) => {
        houseAssets = assets;
        markAssetSettled();
      })
      .catch((error) => {
        console.warn("Failed to load house models.", error);
        markAssetSettled();
      });
  }

  if (needFirestationAsset) {
    void loadFirestationAsset()
      .then((asset) => {
        firestationAsset = asset;
        markAssetSettled();
      })
      .catch((error) => {
        console.warn("Failed to load firestation model.", error);
        markAssetSettled();
      });
  }

  return {
    start,
    stop,
    resize,
    prime,
    captureFireSnapshot,
    setSimulationAlpha,
    isCameraInteracting,
    setTerrain,
    setSeasonVisualState,
    setSeason,
    setClimateDryness,
    setSeasonalRainState,
    setPhaseLabel,
    setSeasonLabel,
    setClimateForecast,
    setBaseCardOpen,
    panToTile,
    setEnvironmentFogEnabled,
    getEnvironmentFogEnabled,
    setRoadHighContrastEnabled,
    getRoadHighContrastEnabled,
    setTerrainWaterDebugControls,
    getTerrainWaterDebugControls,
    getPerfSnapshot
  };
};
