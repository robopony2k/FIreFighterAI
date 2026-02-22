import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TILE_SIZE, TIME_SPEED_OPTIONS, TOWN_ALERT_MAX_POSTURE } from "../core/config.js";
import type { EffectsState } from "../core/effectsState.js";
import type { InputState } from "../core/inputState.js";
import { indexFor } from "../core/grid.js";
import { TILE_ID_TO_TYPE, TILE_TYPE_IDS } from "../core/state.js";
import type { ClimateForecast, Town } from "../core/types.js";
import type { RenderSim } from "./simView.js";
import { createHudState, setHudViewport } from "./hud/hudState.js";
import { handleHudClick, handleHudKey, renderHud } from "./hud/hud.js";
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
import { createThreeTestFireFx } from "./threeTestFireFx.js";
import { createThreeTestUnitFxLayer } from "./threeTestUnitFx.js";
import { ThreeTestWaterSystem, type WaterQualityProfile } from "./threeTestWater.js";
import { createThreeTestUnitsLayer } from "./threeTestUnits.js";
import { CardStateModel } from "../ui/cards/cardState.js";
import { dispatchPhaseUiCommand } from "../ui/phase/commandChannel.js";

export type SeasonVisualState = {
  seasonT01: number;
  risk01: number;
  mode: "auto" | "manual";
  manualSeasonT01?: number;
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

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const wrap01 = (value: number): number => {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};
const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const createThreeTest = (
  canvas: HTMLCanvasElement,
  world: RenderSim,
  inputState: InputState,
  effectsState: EffectsState | null = null
): ThreeTestController => {
  threeTestInitCount += 1;
  if (threeTestInitCount > 1) {
    console.warn("[threeTest] HUD initialized more than once; previous instance will be torn down.");
  }
  if (activeThreeTestCleanup) {
    activeThreeTestCleanup();
    activeThreeTestCleanup = null;
  }
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
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = false;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.autoClear = false;
  setRoadOverlayMaxSize(renderer.capabilities.maxTextureSize || 4096);

  const scene = new THREE.Scene();
  const uiScene = new THREE.Scene();
  const horizonColor = 0xffdab9;
  const zenithColor = 0x87ceeb;
  const gradientCanvas = document.createElement("canvas");
  gradientCanvas.width = 2;
  gradientCanvas.height = 256;
  const context = gradientCanvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 0, gradientCanvas.height);
  gradient.addColorStop(0, new THREE.Color(zenithColor).getStyle());
  gradient.addColorStop(0.45, new THREE.Color(zenithColor).getStyle());
  gradient.addColorStop(0.55, new THREE.Color(horizonColor).getStyle());
  gradient.addColorStop(1, new THREE.Color(horizonColor).getStyle());
  context.fillStyle = gradient;
  context.fillRect(0, 0, gradientCanvas.width, gradientCanvas.height);
  const texture = new THREE.CanvasTexture(gradientCanvas);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  scene.background = texture;

  // Fog disabled: removed because it caused whiteout/edge artefacts.

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  camera.position.set(2.6, 2.2, 3.4);
  camera.lookAt(0, 0, 0);
  const uiCamera = new THREE.OrthographicCamera(0, 1, 1, 0, -10, 10);
  uiCamera.position.set(0, 0, 5);

  const hemisphere = new THREE.HemisphereLight(zenithColor, 0x4d433b, 0.65);
  scene.add(hemisphere);
  const ambient = new THREE.AmbientLight(0xffffff, 0.25);
  scene.add(ambient);
  const keyLight = new THREE.DirectionalLight(0xffe6c2, 0.95);
  keyLight.position.set(4, 5, 2);
  keyLight.castShadow = false;
  keyLight.shadow.mapSize.width = 1024;
  keyLight.shadow.mapSize.height = 1024;
  keyLight.shadow.bias = -0.00035;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x88a9c9, 0.35);
  fillLight.position.set(-4, 2.5, -2);
  scene.add(fillLight);

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
    fallbackMode: THREE_TEST_FX_FALLBACK
  });
  const unitsLayer = createThreeTestUnitsLayer(scene);
  const unitFxLayer = createThreeTestUnitFxLayer(scene);

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
    collapsedButton: HTMLButtonElement;
    panel: HTMLDivElement;
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

  const createDockCard = (id: string, title: string, icon: string): DockCardElements => {
    dockCardState.register(id);
    const root = document.createElement("div");
    root.className = "three-test-dock-card";
    root.dataset.cardId = id;
    const collapsedButton = document.createElement("button");
    collapsedButton.type = "button";
    collapsedButton.className = "three-test-dock-card-collapsed";
    collapsedButton.innerHTML = `<span class="three-test-dock-card-icon">${icon}</span><span>${title}</span>`;
    const panel = document.createElement("div");
    panel.className = "three-test-dock-card-panel";
    const header = document.createElement("div");
    header.className = "three-test-dock-card-header";
    const headerTitle = document.createElement("div");
    headerTitle.className = "three-test-dock-card-title";
    headerTitle.textContent = title;
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
    headerActions.append(pinButton, closeButton);
    header.append(headerTitle, headerActions);
    const summary = document.createElement("div");
    summary.className = "three-test-dock-card-summary";
    const details = document.createElement("div");
    details.className = "three-test-dock-card-details";
    panel.append(header, summary, details);
    root.append(collapsedButton, panel);
    rightDockRoot.appendChild(root);

    const applyState = (): void => {
      const snapshot = dockCardState.get(id);
      root.dataset.state = snapshot.visual;
      root.classList.toggle("is-expanded", snapshot.visual === "expanded");
      root.classList.toggle("is-peek", snapshot.visual === "peek");
      root.classList.toggle("is-pinned", snapshot.pinned);
      root.classList.toggle("is-focused", snapshot.focused);
      applyPinButtonState(pinButton, snapshot.pinned);
      const anyFocused = dockCardState.snapshots().some((entry) => entry.focused && entry.visual !== "collapsed");
      root.classList.toggle("is-dimmed", anyFocused && !snapshot.focused && snapshot.visual === "collapsed");
    };

    root.addEventListener("mouseenter", () => {
      dockCardState.hoverEnter(id);
      applyDockCardStates();
    });
    root.addEventListener("mouseleave", () => {
      dockCardState.hoverLeave(id);
      applyDockCardStates();
    });
    collapsedButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const snapshot = dockCardState.get(id);
      if (snapshot.visual === "expanded" && !snapshot.pinned) {
        dockCardState.collapse(id);
      } else {
        dockCardState.clickExpand(id);
      }
      applyDockCardStates();
    });
    pinButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dockCardState.togglePin(id);
      applyDockCardStates();
    });
    closeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dockCardState.setPinned(id, false);
      dockCardState.collapse(id);
      applyDockCardStates();
    });
    const card: DockCardElements = {
      id,
      root,
      collapsedButton,
      panel,
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
  const climateDock = createDockCard(climateCardId, "Climate", "CL");
  const minimapDock = createDockCard(minimapCardId, "Minimap", "MP");
  const timeDock = createDockCard(timeCardId, "Time", "TM");

  const climateChartCanvas = document.createElement("canvas");
  climateChartCanvas.className = "three-test-climate-chart";
  const climatePeekCanvas = document.createElement("canvas");
  climatePeekCanvas.className = "three-test-climate-chart is-peek";
  const climateKpis = document.createElement("div");
  climateKpis.className = "three-test-dock-kpis";
  climateDock.summary.append(climateKpis, climatePeekCanvas);
  const climateMetricButton = document.createElement("button");
  climateMetricButton.type = "button";
  climateMetricButton.className = "three-test-dock-card-button";
  climateMetricButton.textContent = "View: Risk";
  let climateMetricMode: "risk" | "temp" = "risk";
  climateMetricButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (world.phase === "fire") {
      return;
    }
    climateMetricMode = climateMetricMode === "risk" ? "temp" : "risk";
  });
  climateDock.details.append(climateChartCanvas, climateMetricButton);

  const minimapCanvas = document.createElement("canvas");
  minimapCanvas.className = "three-test-minimap-canvas";
  const minimapPeekCanvas = document.createElement("canvas");
  minimapPeekCanvas.className = "three-test-minimap-canvas is-peek";
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
  minimapDock.summary.append(minimapPeekCanvas);
  minimapDock.details.append(minimapCanvas, minimapLayersWrap);

  minimapCanvas.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
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
    { index: 0, label: "0.5x" },
    { index: 1, label: "1x" },
    { index: 2, label: "2x" },
    { index: Math.max(0, TIME_SPEED_OPTIONS.length - 1), label: "MAX" }
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
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatchPhaseUiCommand({ type: "action", action: `time-speed-${preset.index}` });
    });
    timeControls.appendChild(button);
    speedButtons.push({ index: preset.index, button });
  });
  timeDock.summary.append(timeSummary);
  timeDock.details.append(timeControls);

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
    mode: "risk" | "temp"
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
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = Math.max(0.0001, max - min);
    ctx.strokeStyle = mode === "risk" ? "rgba(209, 74, 44, 0.95)" : "rgba(43, 104, 140, 0.95)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    values.forEach((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * (width - 1);
      const y = (1 - (value - min) / span) * (height - 1);
      if (index === 0) {
        ctx.moveTo(x, y);
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    const clampedMarker = Math.max(0, Math.min(values.length - 1, markerIndex));
    const markerX = (clampedMarker / Math.max(1, values.length - 1)) * (width - 1);
    ctx.strokeStyle = "rgba(240, 179, 59, 0.95)";
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(markerX, 0);
    ctx.lineTo(markerX, height);
    ctx.stroke();
    ctx.setLineDash([]);
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

  const getClimateTempSeries = (): number[] => {
    if (world.climateForecast && world.climateForecast.temps.length > 0) {
      return world.climateForecast.temps.slice();
    }
    return [world.climateTemp ?? 20];
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
    const tempSeries = getClimateTempSeries();
    const riskNow = riskSeries[Math.min(markerIndex, riskSeries.length - 1)] ?? 0;
    const windSpeed = Math.round(Math.max(0, world.wind.strength) * 10);
    climateKpis.innerHTML = "";
    const kpiYearDay = document.createElement("div");
    kpiYearDay.textContent = `Year/Day ${world.year}/${Math.max(1, Math.floor(world.phaseDay) + 1)}`;
    const kpiRisk = document.createElement("div");
    kpiRisk.textContent = `Risk ${(riskNow * 100).toFixed(0)}%`;
    const kpiWind = document.createElement("div");
    kpiWind.textContent = `Wind ${world.wind.name} ${windSpeed}`;
    climateKpis.append(kpiYearDay, kpiRisk, kpiWind);
    climateMetricButton.disabled = world.phase === "fire";
    climateMetricButton.textContent = `View: ${climateMetricMode === "risk" ? "Risk" : "Temp"}${world.phase === "fire" ? " (Read-only)" : ""}`;
    const climateSeries = climateMetricMode === "risk" ? riskSeries : tempSeries;
    drawClimateSparkline(climatePeekCanvas, climateSeries, markerIndex, climateMetricMode);
    if (dockCardState.get(climateCardId).visual === "expanded") {
      drawClimateSparkline(climateChartCanvas, climateSeries, markerIndex, climateMetricMode);
    }

    minimapDock.summary.title = "Click expanded minimap to pan camera";
    if (time - lastMinimapRasterAt >= MINIMAP_REDRAW_INTERVAL_MS) {
      const minimapState = dockCardState.get(minimapCardId).visual;
      if (minimapState === "peek" || minimapState === "expanded") {
        drawMinimapCanvas(minimapPeekCanvas);
      }
      if (minimapState === "expanded") {
        drawMinimapCanvas(minimapCanvas);
      }
      lastMinimapRasterAt = time;
    }

    const activeSpeedIndex = Math.max(0, Math.min(TIME_SPEED_OPTIONS.length - 1, world.timeSpeedIndex ?? 0));
    const speedValue = TIME_SPEED_OPTIONS[activeSpeedIndex] ?? 1;
    const speedLabel = Number.isInteger(speedValue) ? speedValue.toFixed(0) : speedValue.toFixed(1);
    timeSummary.innerHTML = "";
    const timeLine = document.createElement("div");
    timeLine.textContent = world.paused ? "State Paused" : "State Running";
    const speedLine = document.createElement("div");
    speedLine.textContent = `Speed ${speedLabel}x`;
    const phaseLine = document.createElement("div");
    phaseLine.textContent = `Phase ${world.phase}`;
    timeSummary.append(timeLine, speedLine, phaseLine);
    pauseButton.textContent = world.paused ? "Resume" : "Pause";
    pauseButton.title = world.paused ? "Resume simulation" : "Pause simulation";
    pauseButton.setAttribute("aria-label", world.paused ? "Resume simulation" : "Pause simulation");
    speedButtons.forEach(({ index, button }) => {
      button.classList.toggle("is-active", index === activeSpeedIndex);
      button.title = `Set speed to ${button.textContent}`;
      button.setAttribute("aria-label", `Set speed to ${button.textContent}`);
    });
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
      const formation = unit.kind === "truck" ? unit.formation : "n/a";
      card.metrics.textContent = `Move ${getUnitMoveStatus(unit)} | Crew ${crewMode} | Form ${formation}`;
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
        addAction("Formation Narrow", "formation-narrow");
        addAction("Formation Medium", "formation-medium");
        addAction("Formation Wide", "formation-wide");
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
      addShared("Narrow", "formation-narrow");
      addShared("Medium", "formation-medium");
      addShared("Wide", "formation-wide");
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
    card.raiseButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
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
      inputState.lastInteractionTime = performance.now();
    });
    card.upgradeButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      inputState.lastInteractionTime = performance.now();
    });
    card.pinButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
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
    const snapshot = worldCardState.get(baseCardId);
    const nextOpen = snapshot.visual !== "expanded";
    setBaseCardOpenInternal(nextOpen);
  });
  baseCardElements.root.addEventListener("mouseenter", () => {
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
    inputState.lastInteractionTime = performance.now();
    focusCameraOnBase();
  });
  baseCardElements.closeButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
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

  const handleTownOverlayPointerDown = (event: PointerEvent): void => {
    const target = event.target;
    if (!(target instanceof Node)) {
      return;
    }
    if (dockOverlayRoot.contains(target) || unitTrayRoot.contains(target)) {
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
  const treeSeasonVisualConfig: TreeSeasonVisualConfig = {
    enabled: ENABLE_THREE_TEST_SEASONAL_RECOLOR,
    uniforms: terrainClimateUniforms,
    phaseShiftMax: TREE_PHASE_SHIFT_MAX,
    rateJitter: TREE_RATE_JITTER,
    autumnHueJitter: AUTUMN_HUE_JITTER
  };

  let raf = 0;
  let running = false;
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
    const structureOverlayKey = `${sample.cols}x${sample.rows}:${sample.worldSeed ?? -1}`;
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

    const houseIndices: number[] = [];
    let baseMinX = cols;
    let baseMaxX = -1;
    let baseMinY = rows;
    let baseMaxY = -1;
    let baseElevationSum = 0;
    let baseCount = 0;
    for (let idx = 0; idx < tileTypes.length; idx += 1) {
      const type = tileTypes[idx];
      if (type === houseId) {
        houseIndices.push(idx);
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
      baseElevationSum += elevations[idx] ?? 0;
      baseCount += 1;
    }

    const group = new THREE.Group();
    group.name = "dynamic-structures";

    if (houseIndices.length > 0) {
      const houseGeometry = new THREE.BoxGeometry(1, 1, 1);
      const houseMaterial = new THREE.MeshStandardMaterial({ color: 0xc19a66, roughness: 0.82, metalness: 0.06 });
      const houseMesh = new THREE.InstancedMesh(houseGeometry, houseMaterial, houseIndices.length);
      houseMesh.castShadow = true;
      houseMesh.receiveShadow = true;
      const dummy = new THREE.Object3D();
      for (let i = 0; i < houseIndices.length; i += 1) {
        const idx = houseIndices[i];
        const tileX = idx % cols;
        const tileY = Math.floor(idx / cols);
        const elevation = elevations[idx] ?? 0;
        const seed = Math.imul(idx + 1, 1103515245) >>> 0;
        const rotation = ((seed >>> 16) & 3) * (Math.PI * 0.5);
        dummy.position.set(toWorldX(tileX), elevation * heightScale + 0.31, toWorldZ(tileY));
        dummy.rotation.set(0, rotation, 0);
        dummy.scale.set(0.84, 0.62, 0.84);
        dummy.updateMatrix();
        houseMesh.setMatrixAt(i, dummy.matrix);
      }
      houseMesh.instanceMatrix.needsUpdate = true;
      group.add(houseMesh);
    }

    if (baseCount > 0) {
      const baseGeometry = new THREE.BoxGeometry(1, 1, 1);
      const baseMaterial = new THREE.MeshStandardMaterial({ color: 0xa0a7ad, roughness: 0.74, metalness: 0.12 });
      const baseMesh = new THREE.Mesh(baseGeometry, baseMaterial);
      baseMesh.castShadow = true;
      baseMesh.receiveShadow = true;
      const centerTileX = (baseMinX + baseMaxX) * 0.5;
      const centerTileY = (baseMinY + baseMaxY) * 0.5;
      const baseElev = baseElevationSum / Math.max(1, baseCount);
      baseMesh.scale.set(Math.max(1, baseMaxX - baseMinX + 1), 0.66, Math.max(1, baseMaxY - baseMinY + 1));
      baseMesh.position.set(
        ((centerTileX + 0.5) / cols - 0.5) * width,
        baseElev * heightScale + baseMesh.scale.y * 0.5,
        ((centerTileY + 0.5) / rows - 0.5) * depth
      );
      group.add(baseMesh);
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
    uiScene.remove(hudSprite);
    hudTexture.dispose();
    hudMaterial.dispose();
    fireFx.dispose();
    unitsLayer.dispose();
    unitFxLayer.dispose();
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
    }
    threePerf.fireFxMs = smoothPerf(threePerf.fireFxMs, performance.now() - fireFxStart);
    unitsLayer.update(world, lastSample, lastTerrainSize);
    unitFxLayer.update(world, effectsState, lastSample, lastTerrainSize);
    updateTownOverlay(time);
    updateDockOverlay(time);
    updateUnitTrayOverlay(time);
    refreshRoadOverlayIfNeeded();
    const sceneRenderStart = performance.now();
    renderer.clear();
    renderer.render(scene, camera);
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
    renderer.clear();
    renderer.render(scene, camera);
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
    // Fog disabled: keep camera frustum and lighting adjustments only.
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
    keyLight.position.set(distance * 0.45, distance * 0.85, distance * 0.35);
    waterSystem.setLightDirectionFromKeyLight();
    const shadowCam = keyLight.shadow.camera as THREE.OrthographicCamera;
    const shadowExtent = Math.max(10, size * 0.7);
    shadowCam.left = -shadowExtent;
    shadowCam.right = shadowExtent;
    shadowCam.top = shadowExtent;
    shadowCam.bottom = -shadowExtent;
    shadowCam.near = 0.1;
    shadowCam.far = Math.max(200, distance * 5);
    shadowCam.updateProjectionMatrix();
    camera.updateProjectionMatrix();
    controls.update();
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
        return;
      }
      lastSample = nextSample;
      if (terrainMesh) {
      scene.remove(terrainMesh);
      terrainMesh.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) {
          return;
        }
        if (!(child as THREE.Mesh).userData?.roadOverlay) {
          return;
        }
        const material = (child as THREE.Mesh).material;
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
      terrainMesh.geometry.dispose();
      if (Array.isArray(terrainMesh.material)) {
        terrainMesh.material.forEach((material) => {
          const textured = material as THREE.Material & { map?: THREE.Texture | null };
          if (textured.map) {
            textured.map.dispose();
          }
          material.dispose();
        });
      } else {
        const textured = terrainMesh.material as THREE.Material & { map?: THREE.Texture | null };
        if (textured.map) {
          textured.map.dispose();
        }
        terrainMesh.material.dispose();
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

    if (water) {
      waterSystem.rebuild(mesh, water);
    }
    rebuildStructureOverlay(nextSample);
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
