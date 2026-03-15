import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CAREER_YEARS, TILE_SIZE, TIME_SPEED_OPTIONS, TOWN_ALERT_MAX_POSTURE } from "../core/config.js";
import { VIRTUAL_CLIMATE_PARAMS } from "../core/climate.js";
import type { EffectsState } from "../core/effectsState.js";
import { getHouseFootprintBounds, pickHouseFootprint } from "../core/houseFootprints.js";
import type { InputState } from "../core/inputState.js";
import { indexFor } from "../core/grid.js";
import { TILE_ID_TO_TYPE, TILE_TYPE_IDS } from "../core/state.js";
import type { ClimateForecast, Town } from "../core/types.js";
import type { RenderSim } from "./simView.js";
import { createHudState, setHudViewport, type HudTheme } from "./hud/hudState.js";
import { handleHudClick, handleHudKey, renderHud } from "./hud/hud.js";
import { buildEnvironmentPalette, computeFireLoad01 } from "./environmentPalette.js";
import { buildLightingDirectorState, type LightingDirectorState } from "./lightingDirector.js";
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
  handleClearFuelBreakTileClick,
  handleMapFormationDragCommand,
  handleMapPrimaryTileClick,
  handleMapRetaskTileCommand
} from "../sim/input/mapTileActions.js";
import {
  getTownBurningHouseCount,
  getTownPostureLabel,
  getTownThreatLabel,
  getTownThreatLevel,
  lowerTownAlertPosture,
  raiseTownAlertPosture
} from "../sim/towns.js";
import {
  buildPalette,
  buildRoadOverlayTexture,
  buildSampleHeightMap,
  buildSampleTypeMap,
  buildTerrainMesh,
  buildTileTexture,
  computeWaterLevel,
  getTerrainHeightScale,
  getTerrainStep,
  getRoadAtlasVersion,
  ROAD_SURFACE_WIDTH,
  ROAD_TEX_SCALE,
  setRoadOverlayMaxSize,
  buildOceanMask,
  type TreeSeasonVisualConfig,
  type TreeBurnController,
  type TerrainSample
} from "./threeTestTerrain.js";
import { createThreeTestFireFx, type SparkMode } from "./threeTestFireFx.js";
import { createThreeTestCinematicGrade, type ThreeTestCinematicGradeConfig } from "./threeTestCinematicGrade.js";
import { createThreeTestUnitFxLayer } from "./threeTestUnitFx.js";
import { ThreeTestWaterSystem, type WaterQualityProfile } from "./threeTestWater.js";
import { createThreeTestUnitsLayer } from "./threeTestUnits.js";
import { CardStateModel } from "../ui/cards/cardState.js";
import { dispatchPhaseUiCommand } from "../ui/phase/commandChannel.js";
import { RISK_THRESHOLDS, SEASON_LABELS, computeSeasonLayout } from "../ui/phase/forecastLayout.js";
import type { UiAudioController } from "../audio/uiAudio.js";

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
  timeSpeedIndex: number;
};

export type ThreeTestPerfSnapshot = {
  frameMs: number;
  frameLastMs: number;
  controlsMs: number;
  treeBurnMs: number;
  fireFxMs: number;
  sceneRenderMs: number;
  sceneRenderLastMs: number;
  hudMs: number;
  uiRenderMs: number;
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
  sceneCalls: number;
  sceneTriangles: number;
  sceneLines: number;
  scenePoints: number;
  totalCalls: number;
  memoryGeometries: number;
  memoryTextures: number;
  contextLosses: number;
  contextRestores: number;
};

export type ThreeTestController = {
  start: () => void;
  stop: () => void;
  resize: () => void;
  prime: () => void;
  setSimulationAlpha: (alpha: number) => void;
  isCameraInteracting: () => boolean;
  setTerrain: (sample: TerrainSample) => void;
  setSeasonVisualState: (state: SeasonVisualState) => void;
  setSeason: (index: number) => void;
  setClimateDryness: (value: number) => void;
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
  panToTile: (tileX: number, tileY: number) => void;
  getPerfSnapshot: () => ThreeTestPerfSnapshot;
};

type TerrainClimateUniforms = {
  uRisk01: { value: number };
  uSeasonT01: { value: number };
  uWorldSeed: { value: number };
};

type HudMusicSettings = {
  muted: boolean;
  volume: number;
};

type HudMusicControls = {
  getSettings: () => HudMusicSettings;
  toggleMuted: () => void;
  setVolume: (value: number) => void;
  onChange: (listener: (settings: HudMusicSettings) => void) => () => void;
};

type ThreeTestRenderFlags = {
  cinematicGrade: boolean;
};

type ThreeTestRenderState = {
  flags: ThreeTestRenderFlags;
};

type ThreeTestCinematicLookConfig = ThreeTestCinematicGradeConfig & {
  exposure: number;
  fogDensity: number;
  fireFlameIntensityBoost: number;
  fireGlowBoost: number;
  emberBoost: number;
};

let threeTestInitCount = 0;
let activeThreeTestCleanup: (() => void) | null = null;
const HUD_REDRAW_INTERVAL_MS = 120;
const THREE_TEST_QUERY = typeof window !== "undefined" ? new URLSearchParams(window.location.search) : null;
const ENABLE_THREE_TEST_SEASONAL_RECOLOR = THREE_TEST_QUERY?.get("seasonal") !== "0";
const THREE_TEST_HUD_MODE = (THREE_TEST_QUERY?.get("hud") ?? "dom").toLowerCase();
const THREE_TEST_DISABLE_HUD = THREE_TEST_QUERY?.get("nohud") === "1" || THREE_TEST_HUD_MODE !== "canvas";
const THREE_TEST_DISABLE_FX = THREE_TEST_QUERY?.get("nofx") === "1";
const THREE_TEST_DPR_PARAM = Number(THREE_TEST_QUERY?.get("dpr"));
const THREE_TEST_MAX_DPR = Number.isFinite(THREE_TEST_DPR_PARAM) ? Math.max(0.5, Math.min(4, THREE_TEST_DPR_PARAM)) : 1.5;
const THREE_TEST_ADAPTIVE_DPR_ENABLED = THREE_TEST_QUERY?.get("autodpr") !== "0";
const THREE_TEST_MIN_DPR_PARAM = Number(THREE_TEST_QUERY?.get("mindpr"));
const THREE_TEST_MIN_DPR = Number.isFinite(THREE_TEST_MIN_DPR_PARAM)
  ? Math.max(0.5, Math.min(THREE_TEST_MAX_DPR, THREE_TEST_MIN_DPR_PARAM))
  : Math.min(1, THREE_TEST_MAX_DPR);
const THREE_TEST_FPS_PARAM = Number(THREE_TEST_QUERY?.get("fps"));
// Safety cap in all modes to avoid runaway GPU usage from uncapped render loops.
const THREE_TEST_FRAME_CAP_FPS = !Number.isFinite(THREE_TEST_FPS_PARAM)
  ? 60
  : Math.max(30, Math.min(120, THREE_TEST_FPS_PARAM > 0 ? THREE_TEST_FPS_PARAM : 60));
const THREE_TEST_FRAME_MIN_MS = 1000 / THREE_TEST_FRAME_CAP_FPS;
const ADAPTIVE_DPR_FALLBACK_FPS = 55;
const ADAPTIVE_DPR_RECOVERY_FPS = 60;
const ADAPTIVE_DPR_FALLBACK_SCENE_MS = 13.2;
const ADAPTIVE_DPR_RECOVERY_SCENE_MS = 9.4;
const ADAPTIVE_DPR_FALLBACK_SECONDS = 1.1;
const ADAPTIVE_DPR_RECOVERY_SECONDS = 7.5;
const ADAPTIVE_DPR_STEP_DOWN = 0.2;
const ADAPTIVE_DPR_STEP_UP = 0.1;
const THREE_TEST_WATER_QUALITY_PARAM = (THREE_TEST_QUERY?.get("waterq") ?? "").toLowerCase();
const THREE_TEST_DEFAULT_WATER_QUALITY: WaterQualityProfile =
  THREE_TEST_WATER_QUALITY_PARAM === "fast" ||
  THREE_TEST_WATER_QUALITY_PARAM === "balanced" ||
  THREE_TEST_WATER_QUALITY_PARAM === "high"
    ? THREE_TEST_WATER_QUALITY_PARAM
    : "balanced";
const THREE_TEST_RIVER_VIEW = (THREE_TEST_QUERY?.get("rivercam") ?? "").toLowerCase();
const THREE_TEST_RIVER_VIEW_LOCK = THREE_TEST_QUERY?.get("rivercamlock") === "1";
const THREE_TEST_FIRE_WALL_PARAM = Number(THREE_TEST_QUERY?.get("firewall"));
const THREE_TEST_FIRE_WALL_BLEND = Number.isFinite(THREE_TEST_FIRE_WALL_PARAM)
  ? Math.max(0, Math.min(1, THREE_TEST_FIRE_WALL_PARAM))
  : 0.62;
const THREE_TEST_FIRE_VOL_PARAM = Number(THREE_TEST_QUERY?.get("firevol"));
const THREE_TEST_FIRE_HERO_VOL = Number.isFinite(THREE_TEST_FIRE_VOL_PARAM)
  ? Math.max(0, Math.min(1, THREE_TEST_FIRE_VOL_PARAM))
  : 0.55;
const THREE_TEST_FX_BUDGET_PARAM = Number(THREE_TEST_QUERY?.get("fxbudget"));
const THREE_TEST_FIRE_BUDGET_SCALE = Number.isFinite(THREE_TEST_FX_BUDGET_PARAM)
  ? Math.max(0.4, Math.min(1.25, THREE_TEST_FX_BUDGET_PARAM))
  : 1.0;
const THREE_TEST_FX_FALLBACK_PARAM = (THREE_TEST_QUERY?.get("fxfallback") ?? "").toLowerCase();
const THREE_TEST_FX_FALLBACK =
  THREE_TEST_FX_FALLBACK_PARAM === "gentle" || THREE_TEST_FX_FALLBACK_PARAM === "off"
    ? THREE_TEST_FX_FALLBACK_PARAM
    : "aggressive";
const THREE_TEST_SPARK_DEBUG = THREE_TEST_QUERY?.get("sparkdebug") === "1";
const THREE_TEST_SPARK_MODE_PARAM = (THREE_TEST_QUERY?.get("sparkmode") ?? "").toLowerCase();
const THREE_TEST_SPARK_MODE: SparkMode =
  THREE_TEST_SPARK_MODE_PARAM === "mixed" || THREE_TEST_SPARK_MODE_PARAM === "embers"
    ? THREE_TEST_SPARK_MODE_PARAM
    : "tip";
const THREE_TEST_ENV_FOG_ENABLED = true;
const THREE_TEST_SHADOW_RES_PARAM = Number(THREE_TEST_QUERY?.get("shadowres"));
const THREE_TEST_SHADOW_MAP_SIZE = Number.isFinite(THREE_TEST_SHADOW_RES_PARAM) && THREE_TEST_SHADOW_RES_PARAM > 0
  ? Math.max(512, Math.min(4096, 2 ** Math.round(Math.log2(THREE_TEST_SHADOW_RES_PARAM))))
  : 2048;
const THREE_TEST_SHADOW_VIEW_PADDING = 1.08;
const THREE_TEST_SHADOW_HEIGHT_PADDING = 1.28;
const THREE_TEST_SHADOW_MIN_EXTENT = 12;
const THREE_TEST_SHADOW_MAX_TERRAIN_RATIO = 0.45;
const THREE_TEST_SHADOW_TARGET_EPSILON = 0.2;
const THREE_TEST_SHADOW_EXTENT_EPSILON = 0.35;
const THREE_TEST_SHADOW_FAR_EPSILON = 1;
const THREE_TEST_SHADOW_AZIMUTH_EPSILON_DEG = 0.25;
const THREE_TEST_SHADOW_ELEVATION_EPSILON_DEG = 0.5;
const THREE_TEST_CINEMATIC_PARAM = (THREE_TEST_QUERY?.get("cinematic") ?? "").trim();
const THREE_TEST_CINEMATIC_GRADE_ENABLED = THREE_TEST_CINEMATIC_PARAM !== "0";
const THREE_TEST_LEGACY_EXPOSURE = 1.05;
const THREE_TEST_CINEMATIC_GRADE_CONFIG: ThreeTestCinematicLookConfig = {
  exposure: 0.94,
  fogColor: 0x2f3238,
  fogDensity: 0.0065,
  heightHazeStrength: 0.09,
  heightHazeHorizon: 0.58,
  heightHazeCurve: 1.6,
  contrast: 1.08,
  midtoneDesaturation: 0.12,
  vignetteStrength: 0.2,
  vignetteSoftness: 0.72,
  warmHighlightStrength: 0.06,
  fireFlameIntensityBoost: 1.22,
  fireGlowBoost: 1.36,
  emberBoost: 1.42
};
const FAST_OCEAN_SAMPLE_SUPPORT_FLOOR = 0.12;
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
const TOWN_LABEL_LIFT_METERS = 100;
const TOWN_LABEL_UPDATE_INTERVAL_MS = 120;
const TOWN_LABEL_SCREEN_OFFSET_Y = -24;
const TOWN_LABEL_CONNECTOR_ORIGIN_X = 12;
const TOWN_LABEL_MAX_Z_INDEX = 20000;
const BASE_LABEL_LIFT_METERS = 115;
const BASE_LABEL_SCREEN_OFFSET_Y = -22;
const BASE_LABEL_CONNECTOR_ORIGIN_X = 12;
const MINIMAP_REDRAW_INTERVAL_MS = 140;
const UNIT_TRAY_UPDATE_INTERVAL_MS = 90;
const UNIT_COMMAND_PATH_LIFT = 0.07;
const UNIT_COMMAND_MARKER_LIFT = 0.1;
const UNIT_COMMAND_MARKER_RADIUS = 0.06;
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
const wrap01 = (value: number): number => {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};
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
  musicControls: HudMusicControls | null = null
): ThreeTestController => {
  threeTestInitCount += 1;
  if (threeTestInitCount > 1) {
    console.warn("[threeTest] HUD initialized more than once; previous instance will be torn down.");
  }
  if (activeThreeTestCleanup) {
    activeThreeTestCleanup();
    activeThreeTestCleanup = null;
  }
  const render: ThreeTestRenderState = {
    flags: {
      cinematicGrade: THREE_TEST_CINEMATIC_GRADE_ENABLED
    }
  };
  let cinematicGradeEnabled = render.flags.cinematicGrade;
  const renderer = new THREE.WebGLRenderer({
    canvas,
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
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = !ENABLE_THREE_TEST_SEASONAL_RECOLOR;
  renderer.autoClear = false;
  setRoadOverlayMaxSize(renderer.capabilities.maxTextureSize || 4096);

  const scene = new THREE.Scene();
  const uiScene = new THREE.Scene();
  const horizonColor = cinematicGradeEnabled ? 0x2a2019 : 0xffdab9;
  const zenithColor = cinematicGradeEnabled ? 0x1a212c : 0x87ceeb;
  const gradientCanvas = document.createElement("canvas");
  gradientCanvas.width = 2;
  gradientCanvas.height = 256;
  const skyContext = gradientCanvas.getContext("2d")!;
  const repaintSkyGradient = (topColor: THREE.ColorRepresentation, horizonColorValue: THREE.ColorRepresentation): void => {
    const top = new THREE.Color(topColor);
    const horizon = new THREE.Color(horizonColorValue);
    const gradient = skyContext.createLinearGradient(0, 0, 0, gradientCanvas.height);
    gradient.addColorStop(0, top.getStyle());
    gradient.addColorStop(0.45, top.getStyle());
    gradient.addColorStop(0.55, horizon.getStyle());
    gradient.addColorStop(1, horizon.getStyle());
    skyContext.fillStyle = gradient;
    skyContext.fillRect(0, 0, gradientCanvas.width, gradientCanvas.height);
  };
  repaintSkyGradient(zenithColor, horizonColor);
  const texture = new THREE.CanvasTexture(gradientCanvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  scene.background = texture;

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(2.6, 2.2, 3.4);
  camera.lookAt(0, 0, 0);
  const uiCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  uiCamera.position.set(0, 0, 5);
  const cinematicFog = new THREE.FogExp2(
    THREE_TEST_CINEMATIC_GRADE_CONFIG.fogColor,
    THREE_TEST_CINEMATIC_GRADE_CONFIG.fogDensity
  );
  const applyCinematicLook = (enabled: boolean): void => {
    renderer.toneMappingExposure = enabled
      ? THREE_TEST_CINEMATIC_GRADE_CONFIG.exposure
      : THREE_TEST_LEGACY_EXPOSURE;
    scene.fog = THREE_TEST_ENV_FOG_ENABLED ? cinematicFog : null;
  };
  applyCinematicLook(cinematicGradeEnabled);
  let cinematicGradePost: ReturnType<typeof createThreeTestCinematicGrade> | null = null;
  try {
    cinematicGradePost = createThreeTestCinematicGrade(renderer, {
      contrast: THREE_TEST_CINEMATIC_GRADE_CONFIG.contrast,
      midtoneDesaturation: THREE_TEST_CINEMATIC_GRADE_CONFIG.midtoneDesaturation,
      vignetteStrength: THREE_TEST_CINEMATIC_GRADE_CONFIG.vignetteStrength,
      vignetteSoftness: THREE_TEST_CINEMATIC_GRADE_CONFIG.vignetteSoftness,
      warmHighlightStrength: THREE_TEST_CINEMATIC_GRADE_CONFIG.warmHighlightStrength,
      heightHazeStrength: THREE_TEST_ENV_FOG_ENABLED ? THREE_TEST_CINEMATIC_GRADE_CONFIG.heightHazeStrength : 0,
      heightHazeHorizon: THREE_TEST_CINEMATIC_GRADE_CONFIG.heightHazeHorizon,
      heightHazeCurve: THREE_TEST_CINEMATIC_GRADE_CONFIG.heightHazeCurve,
      fogColor: THREE_TEST_CINEMATIC_GRADE_CONFIG.fogColor
    });
    cinematicGradePost.setEnabled(cinematicGradeEnabled);
  } catch (error) {
    cinematicGradeEnabled = false;
    render.flags.cinematicGrade = false;
    console.warn("[threeTest] CinematicGrade setup failed; using legacy scene rendering.", error);
    applyCinematicLook(false);
  }

  const hemisphere = new THREE.HemisphereLight(zenithColor, 0x4d433b, 0.65);
  scene.add(hemisphere);
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffe6c2, 0.95);
  keyLight.position.set(4, 5, 2);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = THREE_TEST_SHADOW_MAP_SIZE;
  keyLight.shadow.mapSize.height = THREE_TEST_SHADOW_MAP_SIZE;
  keyLight.shadow.bias = -0.00035;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x88a9c9, 0.35);
  fillLight.position.set(-4, 2.5, -2);
  scene.add(fillLight);
  scene.add(keyLight.target);
  scene.add(fillLight.target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.minDistance = 3;
  controls.maxDistance = 120;
  controls.target.set(0, 0, 0);
  type CameraFlightState = {
    startedAt: number;
    durationMs: number;
    startTarget: THREE.Vector3;
    startPosition: THREE.Vector3;
    endTarget: THREE.Vector3;
    endPosition: THREE.Vector3;
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
    flameIntensityBoost: cinematicGradeEnabled ? THREE_TEST_CINEMATIC_GRADE_CONFIG.fireFlameIntensityBoost : 1,
    groundGlowBoost: cinematicGradeEnabled ? THREE_TEST_CINEMATIC_GRADE_CONFIG.fireGlowBoost : 1,
    emberBoost: cinematicGradeEnabled ? THREE_TEST_CINEMATIC_GRADE_CONFIG.emberBoost : 1,
    sparkDebug: THREE_TEST_SPARK_DEBUG,
    sparkMode: THREE_TEST_SPARK_MODE
  });
  const unitsLayer = createThreeTestUnitsLayer(scene);
  const unitFxLayer = createThreeTestUnitFxLayer(scene);
  type UnitCommandVisual = {
    line: THREE.Line;
    destination: THREE.Mesh;
  };
  const unitCommandVisualGroup = new THREE.Group();
  unitCommandVisualGroup.name = "three-test-unit-commands";
  scene.add(unitCommandVisualGroup);
  const unitCommandPathMaterial = new THREE.LineBasicMaterial({
    color: 0xb8e6ff,
    transparent: true,
    opacity: 0.92,
    depthWrite: false
  });
  const unitCommandMarkerGeometry = new THREE.SphereGeometry(UNIT_COMMAND_MARKER_RADIUS, 10, 10);
  const unitCommandMarkerMaterial = new THREE.MeshStandardMaterial({
    color: 0xfff0b8,
    emissive: 0x5b4b17,
    emissiveIntensity: 0.8,
    roughness: 0.45,
    metalness: 0.05
  });
  const unitCommandVisuals = new Map<number, UnitCommandVisual>();

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

  type TownLabelElements = {
    root: HTMLDivElement;
    connector: HTMLDivElement;
    mainButton: HTMLButtonElement;
    dot: HTMLSpanElement;
    name: HTMLSpanElement;
    meta: HTMLDivElement;
    metaText: HTMLSpanElement;
    metaAlert: HTMLSpanElement;
  };
  type TownCardElements = {
    root: HTMLDivElement;
    pinButton: HTMLButtonElement;
    focusButton: HTMLButtonElement;
    closeButton: HTMLButtonElement;
    topLine: HTMLDivElement;
    dot: HTMLSpanElement;
    name: HTMLSpanElement;
    postureChip: HTMLSpanElement;
    approvalChip: HTMLSpanElement;
    cooldownChip: HTMLSpanElement;
    summary: HTMLDivElement;
    summaryText: HTMLSpanElement;
    summaryAlert: HTMLSpanElement;
    evac: HTMLDivElement;
    raiseButton: HTMLButtonElement;
    raiseMeta: HTMLSpanElement;
    lowerButton: HTMLButtonElement;
    lowerMeta: HTMLSpanElement;
    clearTreesButton: HTMLButtonElement;
    clearTreesMeta: HTMLSpanElement;
    upgradeButton: HTMLButtonElement;
    upgradeMeta: HTMLSpanElement;
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

  const townLabelElements = new Map<number, TownLabelElements>();
  const townAnchors = new Map<number, TownScreenAnchor>();
  let baseAnchor: TownScreenAnchor | null = null;
  const pinnedTownCards = new Map<number, TownCardElements>();
  let selectedTownId: number | null = null;
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
    townCardTopLine.append(townCardNameDot, townCardName);
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
    const raiseAction = createTownCardAction(TOWN_ICON_WARN_UP, "Raise warning level (next posture)");
    const lowerAction = createTownCardAction(TOWN_ICON_WARN_DOWN, "Lower warning level");
    const clearTreesAction = createTownCardAction(TOWN_ICON_CLEAR_TREES, "Clear trees around town");
    const upgradeAction = createTownCardAction(TOWN_ICON_UPGRADE, "Invest in firefighting equipment");
    townCardActions.append(raiseAction.button, lowerAction.button, clearTreesAction.button, upgradeAction.button);
    townCardRoot.append(townCardHeader, townCardSummary, townCardStatus, townCardEvac, townCardActions);
    townOverlayRoot.appendChild(townCardRoot);
    return {
      root: townCardRoot,
      pinButton: townCardPinButton,
      focusButton: townCardFocusButton,
      closeButton: townCardCloseButton,
      topLine: townCardTopLine,
      dot: townCardNameDot,
      name: townCardName,
      postureChip: townCardPosture,
      approvalChip: townCardApproval,
      cooldownChip: townCardCooldown,
      summary: townCardSummary,
      summaryText: townCardSummaryText,
      summaryAlert: townCardSummaryAlert,
      evac: townCardEvac,
      raiseButton: raiseAction.button,
      raiseMeta: raiseAction.meta,
      lowerButton: lowerAction.button,
      lowerMeta: lowerAction.meta,
      clearTreesButton: clearTreesAction.button,
      clearTreesMeta: clearTreesAction.meta,
      upgradeButton: upgradeAction.button,
      upgradeMeta: upgradeAction.meta
    };
  };

  const townCardElements = createTownCardElements(false);
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
  const fireAlertDeployTruckButton = createFireAlertAction("Deploy Truck");
  const fireAlertDeployCrewButton = createFireAlertAction("Deploy Crew");
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
    applyPinButtonState(pinButton, false);
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

  const climateCardId = "dock:climate";
  const minimapCardId = "dock:minimap";
  const timeCardId = "dock:time";
  const climateDock = createDockCard(climateCardId, "FIRE RISK", "--%");
  const minimapDock = createDockCard(minimapCardId, "MINIMAP", "--");
  const timeDock = createDockCard(timeCardId, "TIME", "Y1 WINTER");
  climateDock.indicatorChip.classList.add("three-test-dock-card-icon-risk", "is-low");
  climateDock.indicatorChip.title = "Forecast risk";
  minimapDock.indicatorChip.classList.add("three-test-dock-card-icon-info");
  minimapDock.indicatorChip.title = "Wind";
  timeDock.indicatorChip.classList.add("three-test-dock-card-icon-info");
  timeDock.indicatorChip.title = "Year and season";

  const climateChartCanvas = document.createElement("canvas");
  climateChartCanvas.className = "three-test-climate-chart";
  const climateKpis = document.createElement("div");
  climateKpis.className = "three-test-dock-kpis";
  climateDock.summary.append(climateKpis, climateChartCanvas);

  const minimapCanvas = document.createElement("canvas");
  minimapCanvas.className = "three-test-minimap-canvas";
  const minimapLayersWrap = document.createElement("div");
  minimapLayersWrap.className = "three-test-minimap-layers";
  const minimapLayers = {
    terrain: true,
    fire: true,
    moisture: false,
    wind: true,
    units: true
  };
  const addLayerToggle = (key: keyof typeof minimapLayers, label: string): void => {
    const wrap = document.createElement("label");
    wrap.className = "three-test-minimap-layer";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = minimapLayers[key];
    input.addEventListener("change", () => {
      playUiCue("toggle");
      minimapLayers[key] = input.checked;
      lastMinimapRasterAt = -Infinity;
    });
    const text = document.createElement("span");
    text.textContent = label;
    wrap.append(input, text);
    minimapLayersWrap.appendChild(wrap);
  };
  addLayerToggle("terrain", "Terrain");
  addLayerToggle("fire", "Heat");
  addLayerToggle("moisture", "Moisture");
  addLayerToggle("wind", "Wind");
  addLayerToggle("units", "Units");
  minimapDock.summary.append(minimapCanvas);
  minimapDock.details.append(minimapLayersWrap);

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
    dispatchPhaseUiCommand({ type: "action", action: "pause" });
  });
  timeControls.appendChild(pauseButton);
  const speedButtons: Array<{ index: number; button: HTMLButtonElement }> = [];
  const speedPresets = [
    { index: 0, label: "1/2", title: "0.5x" },
    { index: 1, label: "1", title: "1x" },
    { index: 2, label: "2", title: "2x" },
    { index: Math.max(0, TIME_SPEED_OPTIONS.length - 1), label: ">>", title: "Max speed" }
  ];
  const usedSpeedIndices = new Set<number>();
  speedPresets.forEach((preset) => {
    if (!Number.isFinite(preset.index) || preset.index < 0 || preset.index >= TIME_SPEED_OPTIONS.length) {
      return;
    }
    if (usedSpeedIndices.has(preset.index)) {
      return;
    }
    usedSpeedIndices.add(preset.index);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "three-test-time-button";
    button.textContent = preset.label;
    button.dataset.speedLabel = preset.title;
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatchPhaseUiCommand({ type: "action", action: `time-speed-${preset.index}` });
    });
    timeControls.appendChild(button);
    speedButtons.push({ index: preset.index, button });
  });
  const nextFireButton = document.createElement("button");
  nextFireButton.type = "button";
  nextFireButton.className = "three-test-time-button";
  nextFireButton.textContent = ">>>";
  nextFireButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    dispatchPhaseUiCommand({ type: "action", action: "time-skip-next-fire" });
  });
  timeControls.appendChild(nextFireButton);
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
  const sfxControls = createTimeVolumeControls();
  const musicTimeControls = createTimeVolumeControls();
  timeAudioControls.append(sfxControls.root, musicTimeControls.root);

  const applyDockAudioState = (settings: { muted: boolean; volume: number }): void => {
    const volumePct = Math.round(Math.max(0, Math.min(1, settings.volume)) * 100);
    sfxControls.muteButton.textContent = settings.muted ? "🔇" : "🔊";
    sfxControls.muteButton.title = settings.muted ? "Unmute UI SFX" : "Mute UI SFX";
    sfxControls.muteButton.setAttribute("aria-pressed", settings.muted ? "true" : "false");
    sfxControls.muteButton.setAttribute("aria-label", settings.muted ? "Unmute UI sound effects" : "Mute UI sound effects");
    sfxControls.volumeLabel.textContent = `SFX ${volumePct}%`;
    sfxControls.volumeSlider.value = settings.volume.toFixed(2);
    sfxControls.muteButton.disabled = !uiAudio;
    sfxControls.volumeSlider.disabled = !uiAudio || settings.muted;
  };

  const applyDockMusicState = (settings: { muted: boolean; volume: number }): void => {
    const volumePct = Math.round(Math.max(0, Math.min(1, settings.volume)) * 100);
    musicTimeControls.muteButton.textContent = settings.muted ? "🔇" : "🔊";
    musicTimeControls.muteButton.title = settings.muted ? "Unmute music" : "Mute music";
    musicTimeControls.muteButton.setAttribute("aria-pressed", settings.muted ? "true" : "false");
    musicTimeControls.muteButton.setAttribute("aria-label", settings.muted ? "Unmute music" : "Mute music");
    musicTimeControls.volumeLabel.textContent = `Music ${volumePct}%`;
    musicTimeControls.volumeSlider.value = settings.volume.toFixed(2);
    musicTimeControls.muteButton.disabled = !musicControls;
    musicTimeControls.volumeSlider.disabled = !musicControls || settings.muted;
  };

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
    applyDockAudioState({ muted: false, volume: 0.65 });
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
    applyDockMusicState({ muted: false, volume: 0.35 });
  }

  timeDock.summary.append(timeSummary);
  timeDock.details.append(timeControls, timeAudioControls);

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
      ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
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
      ctx.font = "500 10px ui-sans-serif, system-ui, sans-serif";
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
    ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
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
    const image = ctx.createImageData(width, height);
    const data = image.data;
    const cols = world.grid.cols;
    const rows = world.grid.rows;
    for (let py = 0; py < height; py += 1) {
      const ty = Math.max(0, Math.min(rows - 1, Math.floor((py / height) * rows)));
      for (let px = 0; px < width; px += 1) {
        const tx = Math.max(0, Math.min(cols - 1, Math.floor((px / width) * cols)));
        const idx = ty * cols + tx;
        let r = 35;
        let g = 38;
        let b = 42;
        if (minimapLayers.terrain) {
          const color = getTileColor(world.tileTypeId[idx] ?? 0);
          r = color.r;
          g = color.g;
          b = color.b;
        }
        if (minimapLayers.moisture) {
          const moisture = clamp01(world.tileMoisture[idx] ?? 0);
          b = Math.min(255, b + Math.round(moisture * 120));
          g = Math.min(255, g + Math.round(moisture * 55));
        }
        if (minimapLayers.fire) {
          const heat = clamp01(world.tileFire[idx] ?? 0);
          if (heat > 0.01) {
            r = Math.max(r, Math.round(180 + heat * 75));
            g = Math.min(g, Math.round(70 + (1 - heat) * 80));
            b = Math.min(b, Math.round(40 + (1 - heat) * 60));
          }
        }
        const base = (py * width + px) * 4;
        data[base] = r;
        data[base + 1] = g;
        data[base + 2] = b;
        data[base + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    if (minimapLayers.units && world.units.length > 0) {
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
    if (minimapLayers.wind) {
      const centerX = width * 0.14;
      const centerY = height * 0.14;
      const len = Math.max(8, Math.min(width, height) * 0.08) * Math.max(0.4, world.wind?.strength ?? 0.4);
      const dx = (world.wind?.dx ?? 0) * len;
      const dy = (world.wind?.dy ?? 0) * len;
      ctx.strokeStyle = "rgba(240, 243, 247, 0.95)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.lineTo(centerX + dx, centerY + dy);
      ctx.stroke();
    }
    if (lastTerrainSize && minimapLayers.units) {
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

  const updateDockOverlay = (time: number): void => {
    if (!THREE_TEST_DISABLE_HUD) {
      dockOverlayRoot.classList.add("hidden");
      return;
    }
    dockOverlayRoot.classList.remove("hidden");
    const forecastDays = Math.max(1, world.climateForecast?.days ?? getClimateRiskSeries().length);
    const markerIndex = Math.max(0, Math.min(forecastDays - 1, Math.floor(world.climateForecastDay ?? 0)));
    const riskSeries = getClimateRiskSeries();
    const riskNow = riskSeries[Math.min(markerIndex, riskSeries.length - 1)] ?? 0;
    const riskPct = Math.round(clamp01(riskNow) * 100);
    const seasonLabel = getCurrentSeasonLabel();
    const windSpeed = Math.round(Math.max(0, world.wind.strength) * 10);
    const windDir = (world.wind.name ?? "Calm").toUpperCase();
    climateKpis.innerHTML = "";
    const kpiRisk = document.createElement("div");
    kpiRisk.textContent = `Risk ${riskPct}%`;
    const kpiWind = document.createElement("div");
    kpiWind.textContent = `Wind ${world.wind.name} ${windSpeed}`;
    climateKpis.append(kpiRisk, kpiWind);
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
    minimapDock.indicatorChip.textContent = `${windDir} ${windSpeed}`;
    const climateSeries = riskSeries;
    const climateChartContext = {
      forecastStartDay: Math.max(0, world.climateForecastStart ?? 0),
      forecastYearDays: Math.max(1, Math.floor(world.climateTimeline?.daysPerYear ?? 360)),
      forecastWindowDays: forecastDays
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

    const activeSpeedIndex = Math.max(0, Math.min(TIME_SPEED_OPTIONS.length - 1, world.timeSpeedIndex ?? 0));
    const speedValue = TIME_SPEED_OPTIONS[activeSpeedIndex] ?? 1;
    const speedLabel = Number.isInteger(speedValue) ? speedValue.toFixed(0) : speedValue.toFixed(1);
    const skipToNextFireActive = !!world.skipToNextFire;
    const canSkipToNextFire = !world.gameOver && world.lastActiveFires <= 0 && !skipToNextFireActive;
    timeSummary.innerHTML = "";
    const timeLine = document.createElement("div");
    timeLine.textContent = world.paused ? "State Paused" : "State Running";
    const speedLine = document.createElement("div");
    speedLine.textContent = `Speed ${speedLabel}x`;
    const phaseLine = document.createElement("div");
    phaseLine.textContent = `Phase ${world.phase}`;
    const skipLine = document.createElement("div");
    skipLine.textContent = skipToNextFireActive
      ? "Seeking next fire..."
      : canSkipToNextFire
        ? "Next fire skip ready"
        : "Next fire skip unavailable";
    timeSummary.append(timeLine, speedLine, phaseLine, skipLine);
    pauseButton.textContent = world.paused ? ">" : "||";
    pauseButton.title = world.paused ? "Resume simulation" : "Pause simulation";
    pauseButton.setAttribute("aria-label", world.paused ? "Resume simulation" : "Pause simulation");
    speedButtons.forEach(({ index, button }) => {
      button.classList.toggle("is-active", index === activeSpeedIndex);
      const speedLabelText = button.dataset.speedLabel ?? button.textContent ?? "";
      button.title = `Set speed to ${speedLabelText}`;
      button.setAttribute("aria-label", `Set speed to ${speedLabelText}`);
    });
    nextFireButton.disabled = !canSkipToNextFire || skipToNextFireActive;
    nextFireButton.textContent = skipToNextFireActive ? "..." : ">>>";
    if (skipToNextFireActive) {
      nextFireButton.title = "Advancing time to next fire incident.";
      nextFireButton.setAttribute("aria-label", "Seeking next fire");
    } else if (canSkipToNextFire) {
      nextFireButton.title = "Advance time until the next fire starts.";
      nextFireButton.setAttribute("aria-label", "Skip to next fire");
    } else {
      nextFireButton.title = "Available when no fires are currently active.";
      nextFireButton.setAttribute("aria-label", "Skip to next fire unavailable");
    }
    applyDockCardStates();
  };

  type UnitTrayCardElements = {
    root: HTMLDivElement;
    name: HTMLDivElement;
    metrics: HTMLDivElement;
    actionA: HTMLButtonElement;
    actionB: HTMLButtonElement;
  };
  const unitTrayList = document.createElement("div");
  unitTrayList.className = "three-test-unit-tray-list";
  const unitTrayDetailCard = document.createElement("div");
  unitTrayDetailCard.className = "three-test-unit-detail hidden";
  const unitTrayGroupCard = document.createElement("div");
  unitTrayGroupCard.className = "three-test-unit-detail hidden";
  unitTrayRoot.append(unitTrayList, unitTrayDetailCard, unitTrayGroupCard);
  const unitTrayCards = new Map<number, UnitTrayCardElements>();
  let lastUnitTrayUpdateAt = -Infinity;

  const getUnitLabel = (unitId: number): string => {
    const rosterUnit = world.roster.find((entry) => entry.id === unitId) ?? null;
    if (rosterUnit) {
      return rosterUnit.name;
    }
    return `Unit ${unitId}`;
  };

  const getUnitMoveStatus = (unit: RenderSim["units"][number]): string =>
    unit.target && unit.pathIndex < unit.path.length ? "Moving" : "Holding";

  const getSprayModeLabel = (formation: "narrow" | "medium" | "wide"): string => {
    if (formation === "narrow") {
      return "Precision";
    }
    if (formation === "wide") {
      return "Suppression";
    }
    return "Balanced";
  };

  const ensureUnitTrayCard = (unitId: number): UnitTrayCardElements => {
    const existing = unitTrayCards.get(unitId);
    if (existing) {
      return existing;
    }
    cardState.register(`unit:${unitId}`);
    const root = document.createElement("div");
    root.className = "three-test-unit-card";
    const name = document.createElement("div");
    name.className = "three-test-unit-name";
    const metrics = document.createElement("div");
    metrics.className = "three-test-unit-metrics";
    const actions = document.createElement("div");
    actions.className = "three-test-unit-actions";
    const actionA = document.createElement("button");
    actionA.type = "button";
    actionA.className = "three-test-unit-action";
    const actionB = document.createElement("button");
    actionB.type = "button";
    actionB.className = "three-test-unit-action";
    actions.append(actionA, actionB);
    root.append(name, metrics, actions);
    root.addEventListener("pointerdown", (event) => {
      event.stopPropagation();
    });
    root.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatchPhaseUiCommand({ type: "action", action: "select-unit", payload: { unitId: String(unitId) } });
    });
    unitTrayList.appendChild(root);
    const created: UnitTrayCardElements = { root, name, metrics, actionA, actionB };
    unitTrayCards.set(unitId, created);
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
    if (world.units.length <= 0) {
      unitTrayRoot.classList.add("hidden");
      return;
    }
    unitTrayRoot.classList.remove("hidden");
    const visibleUnits = world.units.filter((unit) => unit.kind === "truck" || unit.carrierId === null);
    const liveIds = new Set<number>();
    visibleUnits.forEach((unit) => {
      liveIds.add(unit.id);
      const card = ensureUnitTrayCard(unit.id);
      const rosterLabel = unit.rosterId !== null ? getUnitLabel(unit.rosterId) : getUnitLabel(unit.id);
      const selected = world.selectedUnitIds.includes(unit.id);
      card.root.classList.toggle("is-selected", selected);
      card.name.textContent = `${rosterLabel} (${unit.kind})`;
      const crewMode = unit.kind === "truck" ? unit.crewMode : "foot";
      const sprayMode = unit.kind === "truck" ? getSprayModeLabel(unit.formation) : "n/a";
      card.metrics.textContent = `Move ${getUnitMoveStatus(unit)} | Crew ${crewMode} | Spray ${sprayMode}`;
      if (unit.kind === "truck") {
        card.actionA.disabled = false;
        card.actionA.textContent = unit.crewMode === "boarded" ? "Deploy" : "Board";
        card.actionA.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          dispatchPhaseUiCommand({ type: "action", action: "select-unit", payload: { unitId: String(unit.id) } });
          dispatchPhaseUiCommand({
            type: "action",
            action: unit.crewMode === "boarded" ? "crew-deploy" : "crew-board"
          });
        };
        card.actionB.disabled = false;
        card.actionB.textContent = "Backburn";
        card.actionB.onclick = (event) => {
          event.preventDefault();
          event.stopPropagation();
          dispatchPhaseUiCommand({ type: "action", action: "select-unit", payload: { unitId: String(unit.id) } });
          dispatchPhaseUiCommand({ type: "action", action: "backburn" });
        };
      } else {
        card.actionA.disabled = true;
        card.actionA.textContent = "Crew";
        card.actionA.onclick = null;
        card.actionB.disabled = true;
        card.actionB.textContent = "Task";
        card.actionB.onclick = null;
      }
    });

    Array.from(unitTrayCards.keys()).forEach((unitId) => {
      if (liveIds.has(unitId)) {
        return;
      }
      const card = unitTrayCards.get(unitId);
      if (card) {
        card.root.remove();
      }
      unitTrayCards.delete(unitId);
      cardState.remove(`unit:${unitId}`);
    });

    const selectedUnits = world.units.filter((unit) => world.selectedUnitIds.includes(unit.id));
    if (selectedUnits.length === 1) {
      const unit = selectedUnits[0];
      const rosterLabel = unit.rosterId !== null ? getUnitLabel(unit.rosterId) : getUnitLabel(unit.id);
      const etaSteps = Math.max(0, unit.path.length - unit.pathIndex);
      const targetText = unit.target ? `${unit.target.x},${unit.target.y}` : "--";
      unitTrayGroupCard.classList.add("hidden");
      unitTrayDetailCard.classList.remove("hidden");
      unitTrayDetailCard.innerHTML = "";
      const title = document.createElement("div");
      title.className = "three-test-unit-detail-title";
      title.textContent = `${rosterLabel} (${unit.kind})`;
      const stats = document.createElement("div");
      stats.className = "three-test-unit-detail-stats";
      stats.textContent = `Crew ${unit.crewIds.length} | Passengers ${unit.passengerIds.length} | Target ${targetText} | ETA ${etaSteps} | Speed ${unit.speed.toFixed(
        2
      )} | Radius ${unit.radius.toFixed(2)} | Power ${unit.power.toFixed(2)}`;
      const actions = document.createElement("div");
      actions.className = "three-test-unit-detail-actions";
      const addAction = (label: string, action: string): void => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "three-test-unit-action";
        button.textContent = label;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          dispatchPhaseUiCommand({ type: "action", action: "select-unit", payload: { unitId: String(unit.id) } });
          dispatchPhaseUiCommand({ type: "action", action });
        });
        actions.appendChild(button);
      };
      if (unit.kind === "truck") {
        addAction(unit.crewMode === "boarded" ? "Deploy Crew" : "Board Crew", unit.crewMode === "boarded" ? "crew-deploy" : "crew-board");
        addAction("Spray Precision", "formation-narrow");
        addAction("Spray Balanced", "formation-medium");
        addAction("Spray Suppression", "formation-wide");
      }
      unitTrayDetailCard.append(title, stats, actions);
    } else if (selectedUnits.length > 1) {
      const selectedTrucks = selectedUnits.filter((unit) => unit.kind === "truck");
      unitTrayDetailCard.classList.add("hidden");
      unitTrayGroupCard.classList.remove("hidden");
      unitTrayGroupCard.innerHTML = "";
      const title = document.createElement("div");
      title.className = "three-test-unit-detail-title";
      title.textContent = `${selectedUnits.length} units selected`;
      const stats = document.createElement("div");
      stats.className = "three-test-unit-detail-stats";
      stats.textContent = `Shared truck actions apply to ${selectedTrucks.length} selected trucks.`;
      const actions = document.createElement("div");
      actions.className = "three-test-unit-detail-actions";
      const addShared = (label: string, action: string): void => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "three-test-unit-action";
        button.textContent = label;
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          dispatchPhaseUiCommand({ type: "action", action });
        });
        actions.appendChild(button);
      };
      addShared("Board Crew", "crew-board");
      addShared("Deploy Crew", "crew-deploy");
      addShared("Precision", "formation-narrow");
      addShared("Balanced", "formation-medium");
      addShared("Suppression", "formation-wide");
      unitTrayGroupCard.append(title, stats, actions);
    } else {
      unitTrayDetailCard.classList.add("hidden");
      unitTrayGroupCard.classList.add("hidden");
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
    if (!lastTerrainSize) {
      return;
    }
    const cols = Math.max(1, world.grid.cols);
    const rows = Math.max(1, world.grid.rows);
    const clampedX = Math.max(0, Math.min(cols - 1, Math.floor(tileX)));
    const clampedY = Math.max(0, Math.min(rows - 1, Math.floor(tileY)));
    const worldX = ((clampedX + 0.5) / cols - 0.5) * lastTerrainSize.width;
    const worldZ = ((clampedY + 0.5) / rows - 0.5) * lastTerrainSize.depth;
    const idx = indexFor(world.grid, clampedX, clampedY);
    const worldY = (world.tileElevation[idx] ?? 0) * getTerrainHeightScale(cols, rows);
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
      endPosition
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
      clearTreesCost: maintenance.clearTreesCost,
      clearTreesDays: maintenance.clearTreesDays,
      upgradeCost: maintenance.upgradeCost,
      upgradeDays: maintenance.upgradeDays
    };
  };

  const formatTownIconRow = (snapshot: TownUiSnapshot, includeEvac = false): string => {
    let row = `${TOWN_ICON_HOUSES}${snapshot.houses}  ${TOWN_ICON_BURNING}${snapshot.burning}  ${TOWN_ICON_LOST}${snapshot.lost}  ${TOWN_ICON_APPROVAL}${snapshot.approvalPct}%`;
    if (includeEvac && snapshot.evacState === "in_progress") {
      row += `  ${TOWN_ICON_EVAC}${snapshot.evacPct}%`;
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

  const updateTownCardLayout = (townId: number, snapshot: TownUiSnapshot, card: TownCardElements): void => {
    const town = getTownById(townId);
    if (!town) {
      card.root.classList.add("hidden");
      return;
    }
    card.name.textContent = town.name;
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
    if (snapshot.evacState === "in_progress") {
      card.evac.textContent = `${TOWN_ICON_EVAC}${snapshot.evacPct}%`;
      card.evac.title = `Evacuation in progress: ${snapshot.evacPct}%`;
      card.evac.classList.remove("hidden");
    } else if (snapshot.evacState === "complete") {
      card.evac.textContent = `${TOWN_ICON_EVAC}100%`;
      card.evac.title = "Evacuation complete";
      card.evac.classList.remove("hidden");
    } else {
      card.evac.classList.add("hidden");
    }

    const raiseOnCooldown = snapshot.cooldown > 0 && snapshot.posture < TOWN_ALERT_MAX_POSTURE;
    const lowerOnCooldown = snapshot.cooldown > 0 && snapshot.posture > 0;
    card.raiseButton.disabled = snapshot.posture >= TOWN_ALERT_MAX_POSTURE || snapshot.cooldown > 0;
    card.lowerButton.disabled = snapshot.posture <= 0 || snapshot.cooldown > 0;
    card.raiseMeta.textContent = raiseOnCooldown
      ? `${TOWN_ICON_COOLDOWN}${snapshot.cooldown.toFixed(1)}d`
      : "";
    card.lowerMeta.textContent = lowerOnCooldown
      ? `${TOWN_ICON_COOLDOWN}${snapshot.cooldown.toFixed(1)}d`
      : "";
    card.raiseButton.title = raiseOnCooldown
      ? `Cooldown ${snapshot.cooldown.toFixed(1)}d`
      : "Raise warning level (next posture)";
    card.lowerButton.title = lowerOnCooldown
      ? `Cooldown ${snapshot.cooldown.toFixed(1)}d`
      : "Lower warning level";

    card.clearTreesMeta.textContent = `${TOWN_ICON_COST}${snapshot.clearTreesCost}  ${TOWN_ICON_TIME}${snapshot.clearTreesDays}d`;
    card.upgradeMeta.textContent = `${TOWN_ICON_COST}${snapshot.upgradeCost}  ${TOWN_ICON_TIME}${snapshot.upgradeDays}d`;
    card.clearTreesButton.title = `Clear trees around town (${TOWN_ICON_COST}${snapshot.clearTreesCost} ${TOWN_ICON_TIME}${snapshot.clearTreesDays}d)`;
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
    card.raiseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("confirm");
      const townId = resolveTownId();
      if (townId === null) {
        return;
      }
      if (raiseTownAlertPosture(world, townId)) {
        inputState.lastInteractionTime = performance.now();
      }
      updateTownMetrics();
    });
    card.lowerButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("confirm");
      const townId = resolveTownId();
      if (townId === null) {
        return;
      }
      if (lowerTownAlertPosture(world, townId)) {
        inputState.lastInteractionTime = performance.now();
      }
      updateTownMetrics();
    });
    card.clearTreesButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      playUiCue("click");
      inputState.lastInteractionTime = performance.now();
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
    dispatchBaseAction("deploy-truck");
  });
  fireAlertCardElements.deployCrewButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    playUiCue("confirm");
    dispatchBaseAction("deploy-firefighter");
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
    const snapshot = worldCardState.get(baseCardId);
    const nextOpen = snapshot.visual !== "expanded";
    setBaseCardOpenInternal(nextOpen);
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
  };

  const toggleTownCard = (townId: number): void => {
    hoverPeekTownId = null;
    clearTownHoverDelay();
    if (pinnedTownCards.has(townId)) {
      selectedTownId = null;
      focusedTownId = townId;
    } else {
      selectedTownId = selectedTownId === townId ? null : townId;
      focusedTownId = selectedTownId;
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
      const meta = document.createElement("div");
      meta.className = "three-test-town-nameplate-meta";
      const metaText = document.createElement("span");
      metaText.className = "three-test-town-summary-text";
      const metaAlert = document.createElement("span");
      metaAlert.className = "three-test-town-alert-badge alert-0";
      meta.append(metaText, metaAlert);
      compact.append(dot, name);
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
      selectedTownId = null;
      syncFocusedTown();
      updateTownMetrics();
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
      fireAlertCardElements.summary.textContent = `${town.name} | Tile ${alert.tileX},${alert.tileY}`;
      fireAlertCardElements.details.textContent = `Burning ${snapshot.burning} | Houses ${snapshot.houses} | Alert ${snapshot.postureLabel}`;
      fireAlertCardElements.openTownButton.disabled = false;
      fireAlertCardElements.openTownButton.title = `Open ${town.name} card`;
    } else {
      fireAlertCardElements.summary.textContent = `Incident Tile ${alert.tileX},${alert.tileY}`;
      fireAlertCardElements.details.textContent = "No nearby town linked to this ignition.";
      fireAlertCardElements.openTownButton.disabled = true;
      fireAlertCardElements.openTownButton.title = "No nearby town for this incident.";
    }
    fireAlertCardElements.root.classList.remove("hidden");
  };

  const handleTownOverlayPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (dockOverlayRoot.contains(target) || unitTrayRoot.contains(target)) {
      return;
    }
    if (fireAlertCardElements.root.contains(target)) {
      return;
    }
    if (baseCardElements.cardRoot.contains(target) || baseCardElements.root.contains(target)) {
      baseFocused = true;
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
      selectedTownId = null;
      hoverPeekTownId = null;
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
  const townGroundWorld = new THREE.Vector3();
  const townLabelProjected = new THREE.Vector3();
  const townGroundProjected = new THREE.Vector3();
  const baseLabelWorld = new THREE.Vector3();
  const baseGroundWorld = new THREE.Vector3();
  const baseLabelProjected = new THREE.Vector3();
  const baseGroundProjected = new THREE.Vector3();

  const updateTownOverlay = (time: number): void => {
    if (!lastSample || !lastTerrainSize) {
      townOverlayRoot.classList.add("hidden");
      townAnchors.clear();
      baseAnchor = null;
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
    const heightScale = getTerrainHeightScale(cols, rows);
    const labelLift = TOWN_LABEL_LIFT_METERS / Math.max(0.001, TILE_SIZE);
    const baseLabelLift = BASE_LABEL_LIFT_METERS / Math.max(0.001, TILE_SIZE);
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
      const idx = indexFor(world.grid, tileX, tileY);
      const worldX = ((tileX + 0.5) / cols - 0.5) * width;
      const worldZ = ((tileY + 0.5) / rows - 0.5) * depth;
      const groundY = (world.tileElevation[idx] ?? 0) * heightScale;
      townGroundWorld.set(worldX, groundY, worldZ);
      townLabelWorld.set(worldX, groundY + labelLift, worldZ);
      townLabelProjected.copy(townLabelWorld).project(camera);
      townGroundProjected.copy(townGroundWorld).project(camera);
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
      const groundScreenX = (townGroundProjected.x * 0.5 + 0.5) * viewportWidth;
      const groundScreenY = (-townGroundProjected.y * 0.5 + 0.5) * viewportHeight;
      const rootX = screenX - TOWN_LABEL_CONNECTOR_ORIGIN_X;
      const rootY = screenY + TOWN_LABEL_SCREEN_OFFSET_Y;
      const depth01 = Math.max(0, Math.min(1, (townLabelProjected.z + 1) * 0.5));
      const zIndex = Math.max(1, Math.min(TOWN_LABEL_MAX_Z_INDEX, Math.round((1 - depth01) * TOWN_LABEL_MAX_Z_INDEX)));
      const isGroundProjectedVisible =
        townGroundProjected.z > -1 &&
        townGroundProjected.z < 1 &&
        townGroundProjected.x >= -1.5 &&
        townGroundProjected.x <= 1.5 &&
        townGroundProjected.y >= -1.5 &&
        townGroundProjected.y <= 1.5;
      const rootHeight = Math.max(0, entry.root.offsetHeight);
      const rootWidth = Math.max(0, entry.root.offsetWidth);
      entry.root.classList.remove("hidden");
      entry.root.style.zIndex = `${zIndex}`;
      entry.root.style.transform = `translate3d(${rootX}px, ${rootY}px, 0)`;
      townAnchors.set(town.id, { rootX, rootY, rootWidth, rootHeight, zIndex });
      entry.root.style.clipPath = "none";
      const connectorStartScreenY = Math.max(rootY + 1, rootY + rootHeight - 1);
      const connectorEndScreenY = groundScreenY;
      const connectorLength = connectorEndScreenY - connectorStartScreenY;
      const connectorXError = Math.abs(groundScreenX - screenX);
      if (isGroundProjectedVisible && connectorLength >= 4 && connectorXError <= viewportWidth * 0.25) {
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
    const baseIdx = indexFor(world.grid, baseTileX, baseTileY);
    const baseWorldX = ((baseTileX + 0.5) / cols - 0.5) * width;
    const baseWorldZ = ((baseTileY + 0.5) / rows - 0.5) * depth;
    const baseGroundY = (world.tileElevation[baseIdx] ?? 0) * heightScale;
    baseGroundWorld.set(baseWorldX, baseGroundY, baseWorldZ);
    baseLabelWorld.set(baseWorldX, baseGroundY + baseLabelLift, baseWorldZ);
    baseLabelProjected.copy(baseLabelWorld).project(camera);
    baseGroundProjected.copy(baseGroundWorld).project(camera);
    const baseVisible =
      baseLabelProjected.z > -1 &&
      baseLabelProjected.z < 1 &&
      baseLabelProjected.x >= -1.1 &&
      baseLabelProjected.x <= 1.1 &&
      baseLabelProjected.y >= -1.2 &&
      baseLabelProjected.y <= 1.2;
    if (baseVisible) {
      const screenX = (baseLabelProjected.x * 0.5 + 0.5) * viewportWidth;
      const screenY = (-baseLabelProjected.y * 0.5 + 0.5) * viewportHeight;
      const groundScreenX = (baseGroundProjected.x * 0.5 + 0.5) * viewportWidth;
      const groundScreenY = (-baseGroundProjected.y * 0.5 + 0.5) * viewportHeight;
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
      const connectorLength = groundScreenY - connectorStartScreenY;
      const connectorXError = Math.abs(groundScreenX - screenX);
      if (connectorLength >= 4 && connectorXError <= viewportWidth * 0.25) {
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
    updateBaseCardState();
  };

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
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
  let isFormationDrag = false;
  let formationDragStartPx: { x: number; y: number } | null = null;
  const cancelFormationDrag = (): void => {
    isFormationDrag = false;
    formationDragStartPx = null;
    inputState.formationStart = null;
    inputState.formationEnd = null;
  };

  const handleCanvasMouseMove = (event: MouseEvent): void => {
    if (!running) {
      return;
    }
    if (isFormationDrag) {
      const hit = pickTerrainTile(event);
      if (hit) {
        inputState.formationEnd = { x: hit.tileX, y: hit.tileY };
      }
      return;
    }
    if (!inputState.debugCellEnabled) {
      clearDebugHover();
      return;
    }
    if (event.buttons !== 0 || isCameraInteracting()) {
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
    clearDebugHover();
    cancelFormationDrag();
  };
  const pointerCommandRng = { next: (): number => Math.random() };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (!running) {
      return;
    }
    if (event.key === "Escape") {
      selectedTownId = null;
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
      handleHudKey(event, hudState);
    }
  };

  const handleCanvasClick = (event: MouseEvent): void => {
    if (!running) {
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width > 0 ? hudState.viewport.width / rect.width : 1;
    const scaleY = rect.height > 0 ? hudState.viewport.height / rect.height : 1;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    if (!THREE_TEST_DISABLE_HUD) {
      const handled = handleHudClick(x, y, world, hudState);
      if (handled) {
        return;
      }
    }
    const tile = pickTerrainTile(event);
    if (!tile) {
      return;
    }
    const mapTile = { x: tile.tileX, y: tile.tileY };
    const handledPrimary = handleMapPrimaryTileClick({
      state: world,
      inputState,
      rng: pointerCommandRng,
      tile: mapTile,
      shiftKey: event.shiftKey
    });
    if (handledPrimary) {
      inputState.lastInteractionTime = performance.now();
      return;
    }
    const handledClear = handleClearFuelBreakTileClick({
      state: world,
      inputState,
      rng: pointerCommandRng,
      tile: mapTile
    });
    if (handledClear) {
      inputState.lastInteractionTime = performance.now();
    }
  };

  const handleCanvasMouseDown = (event: MouseEvent): void => {
    if (!running || event.button !== 2) {
      return;
    }
    if (world.selectedUnitIds.length === 0) {
      return;
    }
    const tile = pickTerrainTile(event);
    if (!tile) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    isFormationDrag = true;
    formationDragStartPx = { x: event.clientX, y: event.clientY };
    inputState.formationStart = { x: tile.tileX, y: tile.tileY };
    inputState.formationEnd = { x: tile.tileX, y: tile.tileY };
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
    cancelFormationDrag();
    if (!start || !end) {
      return;
    }
    if (dragDistance < FORMATION_DRAG_THRESHOLD_PX) {
      const handledRetask = handleMapRetaskTileCommand({ state: world, tile: end });
      if (handledRetask) {
        inputState.lastInteractionTime = performance.now();
      }
      return;
    }
    const handledFormation = handleMapFormationDragCommand({ state: world, start, end });
    if (handledFormation) {
      inputState.lastInteractionTime = performance.now();
    }
  };

  const handleWindowMouseUp = (event: MouseEvent): void => {
    if (isFormationDrag) {
      handleCanvasMouseUp(event);
    }
  };

  const handleWindowBlur = (): void => {
    cancelFormationDrag();
  };

  const handleCanvasContextMenu = (event: MouseEvent): void => {
    if (!running) {
      return;
    }
    event.preventDefault();
  };

  document.addEventListener("keydown", handleKeyDown);
  canvas.addEventListener("click", handleCanvasClick);
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
  const waterSystem = new ThreeTestWaterSystem({
    scene,
    renderer,
    keyLight,
    skyTopColor: zenithColor,
    skyHorizonColor: horizonColor,
    preferredQuality: THREE_TEST_DEFAULT_WATER_QUALITY
  });
  const applyDomEnvironmentTheme = (theme: ReturnType<typeof buildEnvironmentPalette>["hud"]["dom"]): void => {
    const overlayRoot = canvas.closest(".three-test-overlay") as HTMLElement | null;
    const cardRoot = canvas.closest(".three-test-card") as HTMLElement | null;
    const targets = [overlayRoot, cardRoot, canvas.parentElement, townOverlayRoot, dockOverlayRoot, unitTrayRoot];
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
  let assetRebuildPending = false;
  let lastTerrainSize: { width: number; depth: number } | null = null;
  let structureOverlayGroup: THREE.Group | null = null;
  let lastStructureRevision = -1;
  let lastStructureOverlayKey = "";
  let treeBurnController: TreeBurnController | null = null;
  let cameraLockedToTerrain = false;
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
  let environmentTarget: EnvironmentSignalState = {
    seasonT01: initialSeasonT01,
    risk01: 0.35,
    fireLoad01: computeFireLoad01(world.lastActiveFires, world.grid.totalTiles),
    timeSpeedIndex: Math.max(0, Math.min(TIME_SPEED_OPTIONS.length - 1, world.timeSpeedIndex ?? 0))
  };
  let environmentCurrent: EnvironmentSignalState = { ...environmentTarget };
  let lastEnvironmentApplied: EnvironmentSignalState | null = null;
  let lastLightingApplied: LightingDirectorState | null = null;
  let shadowRefreshPending = true;
  let lastShadowRefreshAt = -Infinity;
  let lastShadowAzimuthDeg = Number.NaN;
  let lastShadowElevationDeg = Number.NaN;
  let lastShadowCameraInteracting = false;
  const lastShadowFocusPoint = new THREE.Vector3(Number.NaN, Number.NaN, Number.NaN);
  let lastShadowExtent = Number.NaN;
  let lastShadowFar = Number.NaN;
  const requestShadowRefresh = (): void => {
    shadowRefreshPending = true;
  };
  const getLightDistance = (): number => {
    const terrainSpan = lastTerrainSize ? Math.max(lastTerrainSize.width, lastTerrainSize.depth) : 12;
    const cameraDistance = camera.position.distanceTo(controls.target);
    return Math.max(18, Math.min(terrainSpan * 0.85, Math.max(terrainSpan * 0.4, cameraDistance * 1.9)));
  };
  const getShadowExtent = (): number => {
    const terrainSpan = lastTerrainSize ? Math.max(lastTerrainSize.width, lastTerrainSize.depth) : 12;
    const cameraDistance = Math.max(1, camera.position.distanceTo(controls.target));
    const halfFovRadians = THREE.MathUtils.degToRad(camera.fov * 0.5);
    const visibleHalfHeight = Math.tan(halfFovRadians) * cameraDistance;
    const visibleHalfWidth = visibleHalfHeight * Math.max(1, camera.aspect);
    const focusExtent = Math.max(
      terrainSpan * 0.1,
      visibleHalfWidth * THREE_TEST_SHADOW_VIEW_PADDING,
      visibleHalfHeight * THREE_TEST_SHADOW_HEIGHT_PADDING
    );
    return Math.max(
      THREE_TEST_SHADOW_MIN_EXTENT,
      Math.min(Math.max(THREE_TEST_SHADOW_MIN_EXTENT, terrainSpan * THREE_TEST_SHADOW_MAX_TERRAIN_RATIO), focusExtent)
    );
  };
  const syncDirectionalLightRig = (lighting: LightingDirectorState): void => {
    const focusPoint = controls.target;
    const lightDistance = Math.max(getLightDistance(), getShadowExtent() * 1.8);
    keyLight.position.copy(focusPoint).addScaledVector(lighting.sunDirection, lightDistance);
    keyLight.target.position.copy(focusPoint);
    fillLight.position.copy(focusPoint).addScaledVector(lighting.fillDirection, lightDistance * 0.72);
    fillLight.target.position.copy(focusPoint);
    const shadowCam = keyLight.shadow.camera as THREE.OrthographicCamera;
    const shadowExtent = getShadowExtent();
    const shadowFar = Math.max(120, lightDistance * 2.35);
    shadowCam.left = -shadowExtent;
    shadowCam.right = shadowExtent;
    shadowCam.top = shadowExtent;
    shadowCam.bottom = -shadowExtent;
    shadowCam.near = 0.1;
    shadowCam.far = shadowFar;
    shadowCam.updateProjectionMatrix();
    keyLight.target.updateMatrixWorld();
    fillLight.target.updateMatrixWorld();
    keyLight.updateMatrixWorld();
    fillLight.updateMatrixWorld();
    const focusChanged =
      !Number.isFinite(lastShadowFocusPoint.x) ||
      focusPoint.distanceTo(lastShadowFocusPoint) >= THREE_TEST_SHADOW_TARGET_EPSILON;
    const extentChanged =
      !Number.isFinite(lastShadowExtent) || Math.abs(shadowExtent - lastShadowExtent) >= THREE_TEST_SHADOW_EXTENT_EPSILON;
    const farChanged = !Number.isFinite(lastShadowFar) || Math.abs(shadowFar - lastShadowFar) >= THREE_TEST_SHADOW_FAR_EPSILON;
    if (focusChanged || extentChanged || farChanged) {
      shadowRefreshPending = true;
    }
    lastShadowFocusPoint.copy(focusPoint);
    lastShadowExtent = shadowExtent;
    lastShadowFar = shadowFar;
    waterSystem.setLightDirectionFromKeyLight();
  };
  const applyLightingState = (lighting: LightingDirectorState): void => {
    keyLight.color.set(rgbToHex(lighting.sunColor));
    keyLight.intensity = lighting.sunIntensity;
    fillLight.color.set(rgbToHex(lighting.fillColor));
    fillLight.intensity = lighting.fillIntensity;
    ambient.color.set(rgbToHex(lighting.fogColor));
    ambient.intensity = lighting.ambientIntensity;
    hemisphere.intensity = Math.min(0.9, 0.56 + lighting.ambientIntensity * 1.08);
    syncDirectionalLightRig(lighting);
  };
  const maybeRefreshShadowMap = (time: number, lighting: LightingDirectorState | null, cameraInteracting: boolean): void => {
    if (!renderer.shadowMap.enabled || !keyLight.castShadow || !lighting) {
      return;
    }
    if (lastShadowCameraInteracting && !cameraInteracting) {
      shadowRefreshPending = true;
    }
    lastShadowCameraInteracting = cameraInteracting;
    const azimuthChanged =
      !Number.isFinite(lastShadowAzimuthDeg) ||
      Math.abs(lighting.sunAzimuthDeg - lastShadowAzimuthDeg) >= THREE_TEST_SHADOW_AZIMUTH_EPSILON_DEG;
    const elevationChanged =
      !Number.isFinite(lastShadowElevationDeg) ||
      Math.abs(lighting.sunElevationDeg - lastShadowElevationDeg) >= THREE_TEST_SHADOW_ELEVATION_EPSILON_DEG;
    if (azimuthChanged || elevationChanged) {
      shadowRefreshPending = true;
    }
    if (!shadowRefreshPending || time - lastShadowRefreshAt < lighting.shadowRefreshMinMs) {
      return;
    }
    renderer.shadowMap.needsUpdate = true;
    lastShadowRefreshAt = time;
    lastShadowAzimuthDeg = lighting.sunAzimuthDeg;
    lastShadowElevationDeg = lighting.sunElevationDeg;
    shadowRefreshPending = false;
  };
  applyEnvironmentPalette = (force = false): void => {
    if (!ENABLE_THREE_TEST_SEASONAL_RECOLOR) {
      return;
    }
    const changed =
      !lastEnvironmentApplied ||
      Math.abs(environmentCurrent.seasonT01 - lastEnvironmentApplied.seasonT01) >= SEASON_VISUAL_EPSILON ||
      Math.abs(environmentCurrent.risk01 - lastEnvironmentApplied.risk01) >= SEASON_VISUAL_EPSILON ||
      Math.abs(environmentCurrent.fireLoad01 - lastEnvironmentApplied.fireLoad01) >= SEASON_VISUAL_EPSILON ||
      environmentCurrent.timeSpeedIndex !== lastEnvironmentApplied.timeSpeedIndex;
    if (!force && !changed) {
      return;
    }
    const palette = buildEnvironmentPalette(environmentCurrent);
    const lighting = buildLightingDirectorState(environmentCurrent);
    fireFx.setEnvironmentSignals({
      smoke01: palette.signals.smoke01,
      denseSmoke01: palette.signals.denseSmoke01,
      fireLoad01: palette.signals.fireLoad01,
      orangeGlow01: palette.signals.orangeGlow01,
      sunDirection: lighting.sunDirection,
      sunTint: rgbToHex(lighting.sunColor),
      smokeTint: rgbToHex(lighting.smokeTint)
    });
    repaintSkyGradient(rgbToHex(palette.atmosphere.skyTop), rgbToHex(palette.atmosphere.skyHorizon));
    texture.needsUpdate = true;
    if (THREE_TEST_ENV_FOG_ENABLED) {
      cinematicFog.color.set(rgbToHex(lighting.fogColor));
      cinematicFog.density = lighting.fogDensity;
      cinematicGradePost?.setFogColor(rgbToHex(lighting.fogColor));
      cinematicGradePost?.setHeightHazeStrength(lighting.hazeStrength);
    }
    hemisphere.color.set(rgbToHex(palette.atmosphere.hemisphereSky));
    hemisphere.groundColor.set(rgbToHex(palette.atmosphere.hemisphereGround));
    applyLightingState(lighting);
    waterSystem.setPalette({
      ...palette.water,
      sun: lighting.waterSunColor
    });
    hudState.theme = cloneHudTheme(palette.hud.canvas);
    applyDomEnvironmentTheme(palette.hud.dom);
    lastEnvironmentApplied = { ...environmentCurrent };
    lastLightingApplied = lighting;
    if (force) {
      requestShadowRefresh();
    }
  };
  applyEnvironmentPalette(true);
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
    sceneRenderMs: 0,
    sceneRenderLastMs: 0,
    hudMs: 0,
    uiRenderMs: 0,
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
    sceneCalls: 0,
    sceneTriangles: 0,
    sceneLines: 0,
    scenePoints: 0,
    totalCalls: 0,
    memoryGeometries: 0,
    memoryTextures: 0,
    contextLosses: 0,
    contextRestores: 0
  };
  const smoothPerf = (current: number, next: number): number => (current > 0 ? current * 0.86 + next * 0.14 : next);
  let lastRafAt = 0;
  let lastPresentedAt = 0;

  const sampleWorldHeight = (tileX: number, tileY: number): number => {
    const cols = Math.max(1, world.grid.cols);
    const rows = Math.max(1, world.grid.rows);
    const x = Math.max(0, Math.min(cols - 1, tileX - 0.5));
    const y = Math.max(0, Math.min(rows - 1, tileY - 0.5));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = Math.min(cols - 1, x0 + 1);
    const y1 = Math.min(rows - 1, y0 + 1);
    const tx = x - x0;
    const ty = y - y0;
    const h00 = world.tileElevation[indexFor(world.grid, x0, y0)] ?? 0;
    const h10 = world.tileElevation[indexFor(world.grid, x1, y0)] ?? h00;
    const h01 = world.tileElevation[indexFor(world.grid, x0, y1)] ?? h00;
    const h11 = world.tileElevation[indexFor(world.grid, x1, y1)] ?? h00;
    const hx0 = h00 * (1 - tx) + h10 * tx;
    const hx1 = h01 * (1 - tx) + h11 * tx;
    const elevation = hx0 * (1 - ty) + hx1 * ty;
    return elevation * getTerrainHeightScale(cols, rows);
  };

  const toWorldCommandPoint = (tileX: number, tileY: number, lift: number): THREE.Vector3 | null => {
    if (!lastTerrainSize) {
      return null;
    }
    const cols = Math.max(1, world.grid.cols);
    const rows = Math.max(1, world.grid.rows);
    const x = (tileX / cols - 0.5) * lastTerrainSize.width;
    const z = (tileY / rows - 0.5) * lastTerrainSize.depth;
    const y = sampleWorldHeight(tileX, tileY) + lift;
    return new THREE.Vector3(x, y, z);
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
        visual.line.geometry.setFromPoints(worldPoints);
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

  const rebuildStructureOverlay = (sample: TerrainSample): void => {
    const structureRevision = sample.structureRevision ?? -1;
    const structureAssetKey = `${houseAssets?.variants.length ?? 0}:${firestationAsset ? 1 : 0}`;
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
    if (!sample.tileTypes || !lastTerrainSize || sample.cols <= 0 || sample.rows <= 0) {
      lastStructureRevision = structureRevision;
      lastStructureOverlayKey = structureOverlayKey;
      return;
    }

    const houseId = TILE_TYPE_IDS.house;
    const baseId = TILE_TYPE_IDS.base;
    const cols = sample.cols;
    const rows = sample.rows;
    const tileTypes = sample.tileTypes;
    const elevations = sample.elevations;
    const width = lastTerrainSize.width;
    const depth = lastTerrainSize.depth;
    const heightScale = getTerrainHeightScale(cols, rows);
    const toWorldX = (tileX: number): number => ((tileX + 0.5) / cols - 0.5) * width;
    const toWorldZ = (tileY: number): number => ((tileY + 0.5) / rows - 0.5) * depth;
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
    const elevationAt = (tileX: number, tileY: number): number => {
      const clampedX = clampToRange(tileX, 0, cols - 1);
      const clampedY = clampToRange(tileY, 0, rows - 1);
      return (elevations[clampedY * cols + clampedX] ?? 0) * heightScale;
    };

    type OverlayHouseSpot = {
      x: number;
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
        const seed = Math.imul(idx + 1, 1103515245) >>> 0;
        const rotation = pickHouseRotation(tileX, tileY, seed);
        const footprint = pickHouseFootprint(seed);
        const bounds = getHouseFootprintBounds(tileX, tileY, rotation, footprint);
        const minX = clampToRange(bounds.minX, 0, cols - 1);
        const maxX = clampToRange(bounds.maxX, 0, cols - 1);
        const minY = clampToRange(bounds.minY, 0, rows - 1);
        const maxY = clampToRange(bounds.maxY, 0, rows - 1);
        let groundMin = Number.POSITIVE_INFINITY;
        let groundMax = Number.NEGATIVE_INFINITY;
        for (let fy = minY; fy <= maxY + 1; fy += 1) {
          for (let fx = minX; fx <= maxX + 1; fx += 1) {
            const h = elevationAt(fx, fy);
            groundMin = Math.min(groundMin, h);
            groundMax = Math.max(groundMax, h);
          }
        }
        if (!Number.isFinite(groundMin) || !Number.isFinite(groundMax)) {
          const fallbackH = elevationAt(tileX, tileY);
          groundMin = fallbackH;
          groundMax = fallbackH;
        }
        houseSpots.push({
          x: toWorldX(tileX),
          z: toWorldZ(tileY),
          footprintX: bounds.width,
          footprintZ: bounds.depth,
          rotation,
          seed,
          groundMin,
          groundMax,
          variantKey: footprint.name ?? null,
          variantSource: footprint.source ?? null
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

    const group = new THREE.Group();
    group.name = "dynamic-structures";
    const buildingGeometry = new THREE.BoxGeometry(1, 1, 1);
    const houseMaterial = new THREE.MeshStandardMaterial({ color: 0xc19a66, roughness: 0.82, metalness: 0.06 });
    const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xa0a7ad, roughness: 0.74, metalness: 0.12 });
    const foundationMaterial = new THREE.MeshStandardMaterial({ color: 0x4b4036, roughness: 0.95, metalness: 0 });
    const dummy = new THREE.Object3D();

    if (houseSpots.length > 0) {
      type OverlayHouseVariant = HouseAssets["variants"][number];
      type HouseBatchInstance = { spot: OverlayHouseSpot; scale: number; baseY: number };
      type FoundationInstance = {
        x: number;
        y: number;
        z: number;
        scaleX: number;
        scaleY: number;
        scaleZ: number;
        rotation: number;
      };
      const availableHouseVariants = houseAssets?.variants ?? [];
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
        if (variant && variant.meshes.length > 0) {
          const sizeX = Math.max(0.01, variant.size?.x ?? 0);
          const sizeZ = Math.max(0.01, variant.size?.z ?? 0);
          const fitScale = Math.min(footprintX / sizeX, footprintZ / sizeZ);
          const scale = Math.max(0.01, fitScale * 0.98 * (variant.scaleBias ?? 1));
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
        const geometry = template.geometry.clone();
        const material = Array.isArray(template.material)
          ? template.material.map((entry) => entry.clone())
          : template.material.clone();
        const instanced = new THREE.InstancedMesh(geometry, material, instances.length);
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
        group.add(instanced);
      });

      if (fallbackInstances.length > 0) {
        const fallbackMesh = new THREE.InstancedMesh(buildingGeometry, houseMaterial, fallbackInstances.length);
        fallbackMesh.castShadow = true;
        fallbackMesh.receiveShadow = true;
        fallbackInstances.forEach((spot, index) => {
          const foundationTop = spot.groundMax + 0.01;
          const footprintX = Math.max(0.5, spot.footprintX);
          const footprintZ = Math.max(0.5, spot.footprintZ);
          dummy.position.set(spot.x, foundationTop + 0.3, spot.z);
          dummy.rotation.set(0, spot.rotation, 0);
          dummy.scale.set(footprintX, 0.6, footprintZ);
          dummy.updateMatrix();
          fallbackMesh.setMatrixAt(index, dummy.matrix);
        });
        fallbackMesh.instanceMatrix.needsUpdate = true;
        group.add(fallbackMesh);
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
        group.add(foundationMesh);
      }
    }

    if (baseMinX <= baseMaxX && baseMinY <= baseMaxY) {
      const centerTileX = (baseMinX + baseMaxX) * 0.5;
      const centerTileY = (baseMinY + baseMaxY) * 0.5;
      const centerX = ((centerTileX + 0.5) / cols - 0.5) * width;
      const centerZ = ((centerTileY + 0.5) / rows - 0.5) * depth;
      const baseFootprintX = Math.max(1, baseMaxX - baseMinX + 1);
      const baseFootprintZ = Math.max(1, baseMaxY - baseMinY + 1);
      const rotation = baseFootprintX >= baseFootprintZ ? 0 : Math.PI / 2;

      let groundMin = Number.POSITIVE_INFINITY;
      let groundMax = Number.NEGATIVE_INFINITY;
      for (let fy = baseMinY; fy <= baseMaxY + 1; fy += 1) {
        for (let fx = baseMinX; fx <= baseMaxX + 1; fx += 1) {
          const h = elevationAt(fx, fy);
          groundMin = Math.min(groundMin, h);
          groundMax = Math.max(groundMax, h);
        }
      }
      if (!Number.isFinite(groundMin) || !Number.isFinite(groundMax)) {
        groundMin = elevationAt(Math.floor(centerTileX), Math.floor(centerTileY));
        groundMax = groundMin;
      }

      if (firestationAsset && firestationAsset.meshes.length > 0) {
        const footprintTarget = Math.max(baseFootprintX, baseFootprintZ) * 0.85;
        const assetFootprint = Math.max(firestationAsset.size.x, firestationAsset.size.z);
        const scale = footprintTarget / Math.max(0.01, assetFootprint);
        const foundationTop = groundMax + 0.01;
        const baseY = foundationTop + firestationAsset.baseOffset * scale;
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
        if (groundMin < foundationTop - 0.01) {
          const foundationHeight = Math.max(0.1, foundationTop - groundMin);
          const foundation = new THREE.Mesh(buildingGeometry, foundationMaterial);
          foundation.scale.set(baseFootprintX, foundationHeight, baseFootprintZ);
          foundation.position.set(centerX, groundMin + foundationHeight / 2, centerZ);
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
        baseMesh.position.set(centerX, groundMax + baseMesh.scale.y * 0.5, centerZ);
        group.add(baseMesh);
        if (groundMin < groundMax - 0.01) {
          const foundationHeight = Math.max(0.1, groundMax - groundMin);
          const foundation = new THREE.Mesh(buildingGeometry, foundationMaterial);
          foundation.scale.set(baseFootprintX, foundationHeight, baseFootprintZ);
          foundation.position.set(centerX, groundMin + foundationHeight / 2, centerZ);
          foundation.rotation.set(0, rotation, 0);
          foundation.castShadow = true;
          foundation.receiveShadow = true;
          group.add(foundation);
        }
      }
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
    disposeStructureOverlay();
    clearUnitCommandVisuals();
    lastStructureOverlayKey = "";
    lastStructureRevision = -1;
    townLabelElements.clear();
    pinnedTownCards.clear();
    dockCards.clear();
    unitTrayCards.clear();
    selectedTownId = null;
    focusedTownId = null;
    baseFocused = false;
    townOverlayRoot.remove();
    dockOverlayRoot.remove();
    unitTrayRoot.remove();
    sparkDebugOverlay.remove();
    removeUiAudioChangeListener?.();
    removeUiAudioChangeListener = null;
    removeMusicControlsChangeListener?.();
    removeMusicControlsChangeListener = null;
    uiScene.remove(hudSprite);
    hudTexture.dispose();
    hudMaterial.dispose();
    fireFx.dispose();
    unitsLayer.dispose();
    unitFxLayer.dispose();
    scene.remove(unitCommandVisualGroup);
    unitCommandPathMaterial.dispose();
    unitCommandMarkerGeometry.dispose();
    unitCommandMarkerMaterial.dispose();
    cinematicGradePost?.dispose();
    cinematicGradePost = null;
    waterSystem.dispose();
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
    cinematicGradePost?.resize(width, height, effectiveDpr);
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
    if (progress >= 1) {
      controls.target.copy(cameraFlight.endTarget);
      camera.position.copy(cameraFlight.endPosition);
      cameraFlight = null;
    }
    markCameraMotion();
  };

  const disableCinematicGrade = (): void => {
    if (!cinematicGradeEnabled) {
      return;
    }
    cinematicGradeEnabled = false;
    render.flags.cinematicGrade = false;
    cinematicGradePost?.setEnabled(false);
    applyCinematicLook(false);
  };

  const renderWorldScene = (): void => {
    renderer.clear();
    renderer.render(scene, camera);
  };

  const renderWorldPass = (): void => {
    if (cinematicGradeEnabled && cinematicGradePost) {
      const renderedWithPost = cinematicGradePost.renderSceneToScreen(renderWorldScene);
      if (!renderedWithPost) {
        disableCinematicGrade();
      }
      return;
    }
    renderWorldScene();
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
    if (THREE_TEST_FRAME_MIN_MS > 0 && lastPresentedAt > 0 && time - lastPresentedAt < THREE_TEST_FRAME_MIN_MS) {
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
        fireLoad01: computeFireLoad01(world.lastActiveFires, world.grid.totalTiles),
        timeSpeedIndex: Math.max(0, Math.min(TIME_SPEED_OPTIONS.length - 1, world.timeSpeedIndex ?? 0))
      };
      const targetChanged =
        Math.abs(nextEnvironmentTarget.seasonT01 - environmentTarget.seasonT01) >= SEASON_VISUAL_EPSILON ||
        Math.abs(nextEnvironmentTarget.risk01 - environmentTarget.risk01) >= SEASON_VISUAL_EPSILON ||
        Math.abs(nextEnvironmentTarget.fireLoad01 - environmentTarget.fireLoad01) >= SEASON_VISUAL_EPSILON ||
        nextEnvironmentTarget.timeSpeedIndex !== environmentTarget.timeSpeedIndex;
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
      environmentCurrent.timeSpeedIndex = environmentTarget.timeSpeedIndex;
      applyEnvironmentPalette();
    }
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
    waterSystem.update(time, dt, threePerf.fps > 0 ? threePerf.fps : instantFps, threePerf.sceneRenderMs);
    const controlsStart = performance.now();
    updateCameraFlight(time);
    controls.update();
    threePerf.controlsMs = smoothPerf(threePerf.controlsMs, performance.now() - controlsStart);
    if (lastLightingApplied) {
      syncDirectionalLightRig(lastLightingApplied);
    }
    maybeRefreshShadowMap(time, lastLightingApplied, isCameraInteracting());
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
        treeBurnController,
        threePerf.fps > 0 ? threePerf.fps : instantFps,
        threePerf.sceneRenderMs
      );
      if (THREE_TEST_SPARK_DEBUG) {
        const snapshot = fireFx.getSparkDebugSnapshot();
        if (time - sparkDebugLastUiAt >= 100) {
          sparkDebugOverlay.textContent =
            `SPARK DEBUG (${snapshot.mode})` +
            ` | flames:${snapshot.visibleFlameTiles}` +
            ` | clusters:${snapshot.clusterCount}/${snapshot.clusteredTiles}` +
            ` | bed:${snapshot.clusterBedInstances}` +
            ` | plume:${snapshot.clusterPlumeSpawns}` +
            ` | tip:${snapshot.heroTipSparkEmitted}/${snapshot.heroTipSparkAttempts}` +
            ` | embers:${snapshot.freeEmberEmitted}/${snapshot.freeEmberAttempts}` +
            ` | dropped:${snapshot.droppedByInstanceCap}` +
            ` | total:${snapshot.finalSparkInstanceCount}`;
          sparkDebugLastUiAt = time;
        }
        if (time - sparkDebugLastLogAt >= 1000) {
          console.info("[threeTest:sparkdebug]", snapshot);
          sparkDebugLastLogAt = time;
        }
      }
    }
    threePerf.fireFxMs = smoothPerf(threePerf.fireFxMs, performance.now() - fireFxStart);
    unitsLayer.update(world, lastSample, lastTerrainSize, simulationAlpha);
    unitFxLayer.update(world, effectsState, lastSample, lastTerrainSize, simulationAlpha, time);
    updateUnitCommandVisuals();
    updateTownOverlay(time);
    updateDockOverlay(time);
    updateUnitTrayOverlay(time);
    refreshRoadOverlayIfNeeded();
    const sceneRenderStart = performance.now();
    renderWorldPass();
    renderer.clearDepth();
    const sceneRenderRawMs = performance.now() - sceneRenderStart;
    threePerf.sceneRenderLastMs = sceneRenderRawMs;
    threePerf.sceneRenderMs = smoothPerf(threePerf.sceneRenderMs, sceneRenderRawMs);
    threePerf.sceneCalls = smoothPerf(threePerf.sceneCalls, renderer.info.render.calls);
    threePerf.sceneTriangles = smoothPerf(threePerf.sceneTriangles, renderer.info.render.triangles);
    threePerf.sceneLines = smoothPerf(threePerf.sceneLines, renderer.info.render.lines);
    threePerf.scenePoints = smoothPerf(threePerf.scenePoints, renderer.info.render.points);
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
    if (!THREE_TEST_DISABLE_HUD) {
      renderer.render(uiScene, uiCamera);
    }
    threePerf.uiRenderMs = smoothPerf(threePerf.uiRenderMs, performance.now() - uiRenderStart);
    threePerf.totalCalls = smoothPerf(threePerf.totalCalls, renderer.info.render.calls);
    threePerf.memoryGeometries = smoothPerf(threePerf.memoryGeometries, renderer.info.memory.geometries);
    threePerf.memoryTextures = smoothPerf(threePerf.memoryTextures, renderer.info.memory.textures);
    threePerf.contextLosses = contextLosses;
    threePerf.contextRestores = contextRestores;
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
    renderer.compile(scene, camera);
    if (lastLightingApplied) {
      syncDirectionalLightRig(lastLightingApplied);
    }
    maybeRefreshShadowMap(performance.now(), lastLightingApplied, false);
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

  const stop = (): void => {
    cancelCameraFlight();
    running = false;
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
      fireLoad01: computeFireLoad01(world.lastActiveFires, world.grid.totalTiles),
      timeSpeedIndex: Math.max(0, Math.min(TIME_SPEED_OPTIONS.length - 1, world.timeSpeedIndex ?? 0))
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
  };

  const panToTile = (tileX: number, tileY: number): void => {
    if (!lastTerrainSize) {
      return;
    }
    cancelCameraFlight();
    const cols = Math.max(1, world.grid.cols);
    const rows = Math.max(1, world.grid.rows);
    const clampedX = Math.max(0, Math.min(cols - 1, Math.floor(tileX)));
    const clampedY = Math.max(0, Math.min(rows - 1, Math.floor(tileY)));
    const worldX = ((clampedX + 0.5) / cols - 0.5) * lastTerrainSize.width;
    const worldZ = ((clampedY + 0.5) / rows - 0.5) * lastTerrainSize.depth;
    const idx = indexFor(world.grid, clampedX, clampedY);
    const worldY = (world.tileElevation[idx] ?? 0) * getTerrainHeightScale(cols, rows);
    const cameraOffset = camera.position.clone().sub(controls.target);
    controls.target.set(worldX, worldY, worldZ);
    camera.position.copy(controls.target.clone().add(cameraOffset));
    controls.update();
    markCameraMotion();
  };

  const setBaseCardOpen = (open: boolean): void => {
    setBaseCardOpenInternal(open);
  };

  const getPerfSnapshot = (): ThreeTestPerfSnapshot => ({
    frameMs: threePerf.frameMs,
    frameLastMs: threePerf.frameLastMs,
    controlsMs: threePerf.controlsMs,
    treeBurnMs: threePerf.treeBurnMs,
    fireFxMs: threePerf.fireFxMs,
    sceneRenderMs: threePerf.sceneRenderMs,
    sceneRenderLastMs: threePerf.sceneRenderLastMs,
    hudMs: threePerf.hudMs,
    uiRenderMs: threePerf.uiRenderMs,
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
    sceneCalls: threePerf.sceneCalls,
    sceneTriangles: threePerf.sceneTriangles,
    sceneLines: threePerf.sceneLines,
    scenePoints: threePerf.scenePoints,
    totalCalls: threePerf.totalCalls,
    memoryGeometries: threePerf.memoryGeometries,
    memoryTextures: threePerf.memoryTextures,
    contextLosses: threePerf.contextLosses,
    contextRestores: threePerf.contextRestores
  });

  const updateCameraForSize = (size: number): void => {
    cancelCameraFlight();
    const distance = Math.max(8, size * 0.6);
    camera.near = 0.1;
    camera.far = Math.max(200, distance * 6);
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
    camera.updateProjectionMatrix();
    controls.update();
    if (lastLightingApplied) {
      syncDirectionalLightRig(lastLightingApplied);
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

  const updateTerrainSurface = (sample: TerrainSample): boolean => {
    if (!terrainMesh || !lastSample || !lastTerrainSize || !sample.fastUpdate) {
      return false;
    }
    if (sample.cols !== lastSample.cols || sample.rows !== lastSample.rows) {
      return false;
    }
    if (sample.elevations.length !== lastSample.elevations.length) {
      return false;
    }
    const palette = buildPalette();
    const grassId = TILE_TYPE_IDS.grass;
    const forestId = TILE_TYPE_IDS.forest;
    const waterId = TILE_TYPE_IDS.water;
    const baseId = TILE_TYPE_IDS.base;
    const houseId = TILE_TYPE_IDS.house;
    const roadId = TILE_TYPE_IDS.road;
    const firebreakId = TILE_TYPE_IDS.firebreak;
    const ashId = TILE_TYPE_IDS.ash;
    const step = getTerrainStep(Math.max(sample.cols, sample.rows), sample.fullResolution ?? false);
    const sampleCols = Math.floor((sample.cols - 1) / step) + 1;
    const sampleRows = Math.floor((sample.rows - 1) / step) + 1;
    const sampleHeights = buildSampleHeightMap(sample, sampleCols, sampleRows, step, waterId);
    const oceanMask = sample.tileTypes ? buildOceanMask(sample.cols, sample.rows, sample.tileTypes, waterId) : null;
    const riverMask = sample.riverMask ?? null;
    const waterLevel = computeWaterLevel(sample, waterId, oceanMask, riverMask);
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
        const tileY = Math.min(sample.rows - 1, row * step);
        const endY = Math.min(sample.rows, tileY + step);
        for (let col = 0; col < sampleCols; col += 1) {
          const tileX = Math.min(sample.cols - 1, col * step);
          const endX = Math.min(sample.cols, tileX + step);
          const idx = row * sampleCols + col;
          if (sampleTypes[idx] !== waterId) {
            continue;
          }
          let isOcean = false;
          let isRiver = false;
          if (oceanMask) {
            for (let y = tileY; y < endY && !isOcean; y += 1) {
              const rowBase = y * sample.cols;
              for (let x = tileX; x < endX; x += 1) {
                const tileIdx = rowBase + x;
                if (riverMask && riverMask[tileIdx]) {
                  isRiver = true;
                  break;
                }
                if (oceanMask[tileIdx]) {
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
    let waterRatio: Float32Array | null = null;
    let oceanRatio: Float32Array | null = null;
    let riverRatio: Float32Array | null = null;
    if (sample.tileTypes) {
      waterRatio = new Float32Array(sampleCols * sampleRows);
      oceanRatio = new Float32Array(sampleCols * sampleRows);
      riverRatio = new Float32Array(sampleCols * sampleRows);
      let offset = 0;
      for (let row = 0; row < sampleRows; row += 1) {
        const tileY = Math.min(sample.rows - 1, row * step);
        const endY = Math.min(sample.rows, tileY + step);
        for (let col = 0; col < sampleCols; col += 1) {
          const tileX = Math.min(sample.cols - 1, col * step);
          const endX = Math.min(sample.cols, tileX + step);
          let waterCount = 0;
          let oceanCount = 0;
          let riverCount = 0;
          let count = 0;
          for (let y = tileY; y < endY; y += 1) {
            const rowBase = y * sample.cols;
            for (let x = tileX; x < endX; x += 1) {
              const idx = rowBase + x;
              count += 1;
              if (sample.tileTypes[idx] !== waterId) {
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
          let localWaterRatio = waterCount * inv;
          let localOceanRatio = oceanCount * inv;
          const localRiverRatio = riverCount * inv;
          if (oceanCount > 0) {
            localOceanRatio = Math.max(localOceanRatio, FAST_OCEAN_SAMPLE_SUPPORT_FLOOR);
            localWaterRatio = Math.max(localWaterRatio, localOceanRatio);
          }
          waterRatio[offset] = Math.min(1, Math.max(0, localWaterRatio));
          oceanRatio[offset] = Math.min(1, Math.max(0, localOceanRatio));
          riverRatio[offset] = Math.min(1, Math.max(0, localRiverRatio));
          offset += 1;
        }
      }
    }
    const heightScale = getTerrainHeightScale(sample.cols, sample.rows);
    const tileTexture = buildTileTexture(
      sample,
      sampleCols,
      sampleRows,
      step,
      palette,
      grassId,
      TILE_TYPE_IDS.scrub,
      TILE_TYPE_IDS.floodplain,
      TILE_TYPE_IDS.beach,
      forestId,
      waterId,
      roadId,
      heightScale,
      sampleHeights,
      sampleTypes,
      waterRatio,
      oceanRatio,
      riverRatio,
      null,
      null,
      sample.debugTypeColors ?? false
    );
    const material = terrainMesh.material;
    let previousMap: THREE.Texture | null = null;
    const applyMap = (mat: THREE.Material) => {
      const textured = mat as THREE.Material & { map?: THREE.Texture | null };
      if (!previousMap && textured.map) {
        previousMap = textured.map;
      }
      textured.map = tileTexture;
      mat.needsUpdate = true;
    };
    if (Array.isArray(material)) {
      material.forEach((mat) => applyMap(mat));
    } else {
      applyMap(material);
    }
    const mapToDispose = previousMap as THREE.Texture | null;
    if (mapToDispose) {
      mapToDispose.dispose();
    }

    const roadMesh = terrainRoadOverlayMesh ?? findRoadOverlayMesh(terrainMesh);
    if (roadMesh) {
      terrainRoadOverlayMesh = roadMesh;
      const nextRoadVersion = getRoadAtlasVersion();
      const roadOverlayVersion = roadMesh.userData?.roadOverlayVersion ?? -1;
      if (nextRoadVersion !== roadOverlayVersion) {
        const roadOverlay = buildRoadOverlayTexture(sample, roadId, baseId, ROAD_SURFACE_WIDTH, ROAD_TEX_SCALE);
        if (roadOverlay) {
          const roadMaterial = roadMesh.material as THREE.Material & { map?: THREE.Texture | null };
          if (roadMaterial.map) {
            roadMaterial.map.dispose();
          }
          roadMaterial.map = roadOverlay;
          roadMaterial.needsUpdate = true;
          roadMesh.userData.roadOverlayVersion = nextRoadVersion;
        }
      }
    }
    return true;
  };


  const setTerrain = (sample: TerrainSample): void => {
    const setTerrainStartedAt = performance.now();
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
      if (updateTerrainSurface(nextSample)) {
        lastSample = nextSample;
        rebuildStructureOverlay(nextSample);
        requestShadowRefresh();
        return;
      }
      lastSample = nextSample;
      if (terrainMesh) {
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
    }
    waterSystem.clear();
      if (nextSample.cols <= 1 || nextSample.rows <= 1 || nextSample.elevations.length === 0) {
        disposeStructureOverlay();
        lastStructureRevision = nextSample.structureRevision ?? -1;
        lastStructureOverlayKey = `${nextSample.cols}x${nextSample.rows}:${nextSample.worldSeed ?? -1}`;
        ground.visible = true;
        return;
      }
      const { mesh, size, water, treeBurn } = buildTerrainMesh(
      nextSample,
      treeAssets,
      houseAssets,
      firestationAsset,
      treeSeasonVisualConfig
      );
    terrainMesh = mesh;
    terrainRoadOverlayMesh = findRoadOverlayMesh(terrainMesh);
    patchTerrainClimateMaterials(terrainMesh.material);
    treeBurnController = treeBurn ?? null;
    scene.add(terrainMesh);
    ground.visible = false;

    const maxSize = Math.max(size.width, size.depth);
    const sizeChanged =
      !lastTerrainSize ||
      Math.abs(lastTerrainSize.width - size.width) > 0.01 ||
      Math.abs(lastTerrainSize.depth - size.depth) > 0.01;
    if (!cameraLockedToTerrain || sizeChanged) {
      updateCameraForSize(maxSize);
      cameraLockedToTerrain = true;
    }
    lastTerrainSize = size;
    if (lastLightingApplied) {
      applyLightingState(lastLightingApplied);
    }

    if (water) {
      waterSystem.rebuild(mesh, water);
    }
    if (lastLightingApplied) {
      applyLightingState(lastLightingApplied);
    }
    rebuildStructureOverlay(nextSample);
    requestShadowRefresh();
    } finally {
      const terrainSetMs = performance.now() - setTerrainStartedAt;
      threePerf.terrainSetLastMs = terrainSetMs;
      threePerf.terrainSetMs = smoothPerf(threePerf.terrainSetMs, terrainSetMs);
      threePerf.terrainSetMaxMs = Math.max(terrainSetMs, threePerf.terrainSetMaxMs * 0.997);
      threePerf.terrainSetCount += 1;
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
  };
  const needTreeAssets = !treeAssets;
  const needHouseAssets = !houseAssets;
  const needFirestationAsset = !firestationAsset;
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
    setSimulationAlpha,
    isCameraInteracting,
    setTerrain,
    setSeasonVisualState,
    setSeason,
    setClimateDryness,
    setPhaseLabel,
    setSeasonLabel,
    setClimateForecast,
    setBaseCardOpen,
    panToTile,
    getPerfSnapshot
  };
};
