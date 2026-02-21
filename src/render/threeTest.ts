import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TILE_SIZE, TOWN_ALERT_MAX_POSTURE } from "../core/config.js";
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
  raiseTownAlertPosture,
  startTownEvacuation
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
const THREE_TEST_FRAME_CAP_FPS = !Number.isFinite(THREE_TEST_FPS_PARAM)
  ? 60
  : THREE_TEST_FPS_PARAM <= 0
    ? 0
    : Math.max(15, Math.min(240, THREE_TEST_FPS_PARAM));
const THREE_TEST_FRAME_MIN_MS = THREE_TEST_FRAME_CAP_FPS > 0 ? 1000 / THREE_TEST_FRAME_CAP_FPS : 0;
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

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const wrap01 = (value: number): number => {
  const wrapped = value % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};

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
  let lastCameraMotionAt = 0;
  const markCameraMotion = (): void => {
    lastCameraMotionAt = performance.now();
  };
  controls.addEventListener("start", markCameraMotion);
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
  const townCard = document.createElement("section");
  townCard.className = "three-test-town-card hidden";
  const townCardTitle = document.createElement("h3");
  townCardTitle.className = "three-test-town-card-title";
  const townCardThreat = document.createElement("div");
  townCardThreat.className = "three-test-town-card-row";
  const townCardPosture = document.createElement("div");
  townCardPosture.className = "three-test-town-card-row";
  const townCardApproval = document.createElement("div");
  townCardApproval.className = "three-test-town-card-row";
  const townCardDisapproval = document.createElement("div");
  townCardDisapproval.className = "three-test-town-card-row";
  const townCardEvac = document.createElement("div");
  townCardEvac.className = "three-test-town-card-row";
  const townCardActions = document.createElement("div");
  townCardActions.className = "three-test-town-card-actions";
  const townRaiseButton = document.createElement("button");
  townRaiseButton.type = "button";
  townRaiseButton.textContent = "Raise alert";
  const townLowerButton = document.createElement("button");
  townLowerButton.type = "button";
  townLowerButton.textContent = "Lower alert";
  const townEvacButton = document.createElement("button");
  townEvacButton.type = "button";
  townEvacButton.textContent = "Evacuate";
  townCardActions.append(townRaiseButton, townLowerButton, townEvacButton);
  townCard.append(
    townCardTitle,
    townCardThreat,
    townCardPosture,
    townCardApproval,
    townCardDisapproval,
    townCardEvac,
    townCardActions
  );
  townOverlayRoot.appendChild(townCard);
  canvas.parentElement?.appendChild(townOverlayRoot);

  type TownLabelElements = {
    button: HTMLButtonElement;
    dot: HTMLSpanElement;
    name: HTMLSpanElement;
    meta: HTMLDivElement;
  };
  const townLabelElements = new Map<number, TownLabelElements>();
  const townScreenPoints = new Map<number, { x: number; y: number }>();
  let selectedTownId: number | null = null;
  let lastTownMetricsUpdateAt = -Infinity;

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

  const updateTownCard = (): void => {
    if (selectedTownId === null) {
      townCard.classList.add("hidden");
      return;
    }
    const town = getTownById(selectedTownId);
    if (!town) {
      selectedTownId = null;
      townCard.classList.add("hidden");
      return;
    }
    const threatLevel = getTownThreatLevel(world, town);
    const threatLabel = getTownThreatLabel(threatLevel);
    const posture = Math.max(0, Math.min(TOWN_ALERT_MAX_POSTURE, Math.trunc(town.alertPosture ?? 0)));
    const postureLabel = getTownPostureLabel(posture);
    const cooldown = Math.max(0, town.alertCooldownDays ?? 0);
    const houses = Math.max(0, Math.floor(town.houseCount ?? 0));
    const nonApproving = Math.max(0, Math.min(houses, Math.round(town.nonApprovingHouseCount ?? 0)));
    const approvalPct = Math.round(Math.max(0, Math.min(1, town.approval ?? 1)) * 100);
    townCard.classList.remove("hidden");
    townCard.dataset.threat = threatLevel;
    townCardTitle.textContent = town.name;
    townCardThreat.textContent = `Threat: ${threatLabel}`;
    townCardPosture.textContent =
      cooldown > 0 ? `Posture: ${postureLabel} | Cooldown: ${cooldown.toFixed(1)}d` : `Posture: ${postureLabel}`;
    townCardApproval.textContent = `Approval: ${approvalPct}%`;
    townCardDisapproval.textContent = `Disapproving households: ${nonApproving} / ${houses}`;
    if (town.evacState === "in_progress") {
      townCardEvac.textContent = `Evacuation: in progress (${Math.round((town.evacProgress ?? 0) * 100)}%)`;
    } else if (town.evacState === "complete") {
      townCardEvac.textContent = "Evacuation: complete";
    } else {
      townCardEvac.textContent = "Evacuation: none";
    }
    townRaiseButton.disabled = posture >= TOWN_ALERT_MAX_POSTURE || cooldown > 0;
    townLowerButton.disabled = posture <= 0 || cooldown > 0;
    townEvacButton.disabled = posture !== TOWN_ALERT_MAX_POSTURE || town.evacState !== "none";

    const anchor = townScreenPoints.get(town.id);
    const viewportWidth = Math.max(1, hudState.viewport.width);
    const viewportHeight = Math.max(1, hudState.viewport.height);
    const cardWidth = 260;
    const cardHeight = 190;
    const offsetX = 14;
    const offsetY = -10;
    const baseX = (anchor?.x ?? viewportWidth * 0.5) + offsetX;
    const baseY = (anchor?.y ?? viewportHeight * 0.35) + offsetY;
    const x = Math.max(8, Math.min(viewportWidth - cardWidth - 8, baseX));
    const y = Math.max(8, Math.min(viewportHeight - cardHeight - 8, baseY));
    townCard.style.transform = `translate(${x}px, ${y}px)`;
  };

  const toggleTownCard = (townId: number): void => {
    selectedTownId = selectedTownId === townId ? null : townId;
    updateTownCard();
  };

  const removeTownLabel = (townId: number): void => {
    const entry = townLabelElements.get(townId);
    if (!entry) {
      return;
    }
    entry.button.remove();
    townLabelElements.delete(townId);
    townScreenPoints.delete(townId);
  };

  const ensureTownLabels = (): void => {
    const liveIds = new Set<number>();
    for (const town of world.towns) {
      const townId = town.id;
      liveIds.add(townId);
      if (townLabelElements.has(townId)) {
        continue;
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "three-test-town-nameplate";
      const compact = document.createElement("div");
      compact.className = "three-test-town-nameplate-main";
      const dot = document.createElement("span");
      dot.className = "three-test-town-dot is-low";
      const name = document.createElement("span");
      name.className = "three-test-town-name";
      const meta = document.createElement("div");
      meta.className = "three-test-town-nameplate-meta";
      compact.append(dot, name);
      button.append(compact, meta);
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        toggleTownCard(townId);
      });
      townOverlayRoot.appendChild(button);
      townLabelElements.set(townId, { button, dot, name, meta });
    }
    const staleIds = Array.from(townLabelElements.keys());
    for (const townId of staleIds) {
      if (!liveIds.has(townId)) {
        removeTownLabel(townId);
      }
    }
    if (selectedTownId !== null && !liveIds.has(selectedTownId)) {
      selectedTownId = null;
      updateTownCard();
    }
  };

  const updateTownMetrics = (): void => {
    for (const town of world.towns) {
      const entry = townLabelElements.get(town.id);
      if (!entry) {
        continue;
      }
      const postureClass = getThreatClass(town);
      entry.dot.className = `three-test-town-dot ${postureClass}`;
      entry.name.textContent = town.name;
      const houses = Math.max(0, Math.floor(town.houseCount ?? 0));
      const burning = getTownBurningHouseCount(world, town.id);
      const lost = 0;
      const approvalPct = Math.round(Math.max(0, Math.min(1, town.approval ?? 1)) * 100);
      entry.meta.textContent = `Houses: ${houses} | Burning: ${burning} | Lost: ${lost} | Approval: ${approvalPct}%`;
      entry.button.classList.toggle("is-selected", selectedTownId === town.id);
    }
  };

  const updateTownOverlay = (time: number): void => {
    if (!lastSample || !lastTerrainSize || world.towns.length === 0) {
      townOverlayRoot.classList.add("hidden");
      townScreenPoints.clear();
      if (selectedTownId !== null) {
        selectedTownId = null;
        updateTownCard();
      }
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
    const viewportWidth = Math.max(1, hudState.viewport.width);
    const viewportHeight = Math.max(1, hudState.viewport.height);
    const scratch = new THREE.Vector3();
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
      scratch.set(worldX, groundY + labelLift, worldZ);
      scratch.project(camera);
      const isVisible = scratch.z > -1 && scratch.z < 1 && scratch.x >= -1.1 && scratch.x <= 1.1 && scratch.y >= -1.2 && scratch.y <= 1.2;
      if (!isVisible) {
        entry.button.classList.add("hidden");
        townScreenPoints.delete(town.id);
        continue;
      }
      const screenX = (scratch.x * 0.5 + 0.5) * viewportWidth;
      const screenY = (-scratch.y * 0.5 + 0.5) * viewportHeight;
      townScreenPoints.set(town.id, { x: screenX, y: screenY });
      entry.button.classList.remove("hidden");
      entry.button.style.transform = `translate(-50%, -100%) translate(${screenX}px, ${screenY}px)`;
    }
    updateTownCard();
  };

  townRaiseButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedTownId === null) {
      return;
    }
    if (raiseTownAlertPosture(world, selectedTownId)) {
      inputState.lastInteractionTime = performance.now();
    }
    updateTownMetrics();
    updateTownCard();
  });
  townLowerButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedTownId === null) {
      return;
    }
    if (lowerTownAlertPosture(world, selectedTownId)) {
      inputState.lastInteractionTime = performance.now();
    }
    updateTownMetrics();
    updateTownCard();
  });
  townEvacButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (selectedTownId === null) {
      return;
    }
    if (startTownEvacuation(world, selectedTownId)) {
      inputState.lastInteractionTime = performance.now();
    }
    updateTownMetrics();
    updateTownCard();
  });

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
    window.removeEventListener("blur", handleWindowBlur);
    canvas.removeEventListener("contextmenu", handleCanvasContextMenu);
    canvas.removeEventListener("mousemove", handleCanvasMouseMove);
    canvas.removeEventListener("mouseleave", handleCanvasMouseLeave);
    canvas.removeEventListener("webglcontextlost", handleContextLost as EventListener, false);
    canvas.removeEventListener("webglcontextrestored", handleContextRestored as EventListener, false);
    controls.removeEventListener("start", markCameraMotion);
    controls.removeEventListener("change", markCameraMotion);
    controls.removeEventListener("end", markCameraMotion);
    clearDebugHover();
    cancelFormationDrag();
    disposeStructureOverlay();
    lastStructureOverlayKey = "";
    lastStructureRevision = -1;
    townLabelElements.clear();
    townScreenPoints.clear();
    selectedTownId = null;
    townOverlayRoot.remove();
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
    getPerfSnapshot
  };
};
