import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createEffectsState, type EffectsState } from "../../core/effectsState.js";
import {
  createInitialState,
  TILE_TYPE_IDS,
  type WorldState
} from "../../core/state.js";
import { type Formation, type Grid, type Unit, type WaterSprayMode } from "../../core/types.js";
import {
  createSeasonalRainOverlayPass,
  resolveSeasonalRainScreenWind
} from "../../systems/climate/rendering/seasonalRainOverlayPass.js";
import { sampleSeasonalWeatherVisualState } from "../../systems/climate/rendering/seasonalWeatherVisualState.js";
import { createConstructionFxRuntime } from "../../systems/settlements/rendering/constructionFxRuntime.js";
import { buildLightingDirectorState } from "../lightingDirector.js";
import { createSeasonalSkyDome } from "../seasonalSky.js";
import { buildRenderTerrainSample } from "../simView.js";
import { buildTerrainMesh, prepareTerrainRenderSurface, type TerrainRenderSurface, type TerrainSample } from "../threeTestTerrain.js";
import { ThreeTestWaterSystem } from "../threeTestWater.js";
import { resolveOceanSurfaceContext } from "../water/ocean/oceanSurfaceContext.js";
import {
  createThreeTestFireFx,
  normalizeFireFxDebugControls,
  type FireFxDebugSnapshot,
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
import {
  getHouseAssetsCache,
  getTreeAssetsCache,
  loadHouseAssets,
  loadTreeAssets,
  type HouseAssets,
  type TreeAssets
} from "../threeTestAssets.js";
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
import {
  applyFxLabTerrainStamp,
  createFxLabShowcaseMap,
  FX_LAB_SHOWCASE_SEA_LEVEL,
  FX_LAB_SHOWCASE_SIZE,
  replaceFxLabEditableMap,
  type FxLabShowcaseMapState,
  type FxLabTerrainStamp
} from "./showcaseMap.js";
import { createFxLabMapPreset, formatFxLabMapPreset, parseFxLabMapPreset, type FxLabMapPreset } from "./showcaseMapPreset.js";

const FX_LAB_GRID_SIZE = FX_LAB_SHOWCASE_SIZE;
const FX_LAB_SEED = 18032026;
const DEFAULT_STEP_SECONDS = 1 / 30;
const FX_LAB_OCEAN_SEA_LEVEL = FX_LAB_SHOWCASE_SEA_LEVEL;
const FX_LAB_RAIN_SCENARIO_ID: FxLabScenarioId = "rain-overlay";
const FX_LAB_RAIN_SEED = 26092026;
const FX_LAB_RAIN_INTENSITY = 1;
const FX_LAB_RAIN_CAREER_DAY = 286;
const FX_LAB_RIVER_SHALLOW = { r: 63, g: 134, b: 191 };
const FX_LAB_RIVER_DEEP = { r: 26, g: 77, b: 121 };
const FX_LAB_WEATHER_CYCLE_DAYS_PER_SECOND = 18;
const FX_LAB_WEATHER_MODE_CAREER_DAY: Record<FxLabWeatherMode, number> = {
  rainEvent: FX_LAB_RAIN_CAREER_DAY,
  yearCycle: FX_LAB_RAIN_CAREER_DAY,
  winter: 24,
  spring: 116,
  summer: 190,
  autumn: 286
};

export type FxLabWeatherMode = "rainEvent" | "yearCycle" | "winter" | "spring" | "summer" | "autumn";

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const fract = (value: number): number => value - Math.floor(value);
type FxLabSceneState = {
  world: WorldState;
  effects: EffectsState;
  sample: TerrainSample;
  truck: Unit;
  firefighter: Unit;
  baseFuel: Float32Array;
  showcaseMap: FxLabShowcaseMapState;
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
  setWeatherMode: (mode: FxLabWeatherMode) => void;
  getWeatherMode: () => FxLabWeatherMode;
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
  getFireDebugSnapshot: () => FireFxDebugSnapshot;
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
  setTerrainStamp: (stamp: FxLabTerrainStamp | null) => void;
  getTerrainStamp: () => FxLabTerrainStamp | null;
  setTerrainStampRadius: (radius: 2 | 4 | 7) => void;
  getTerrainStampRadius: () => 2 | 4 | 7;
  getTerrainEditStatus: () => string;
  resetShowcaseMap: () => void;
  exportShowcaseMap: () => string;
  importShowcaseMap: (text: string) => void;
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
  crewAction: null,
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
  const showcaseMap = createFxLabShowcaseMap(world);
  const { treeTypes, baseFuel } = showcaseMap;
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
    lakeMask: world.tileLakeMask,
    lakeSurface: world.tileLakeSurface,
    lakeOutletMask: world.tileLakeOutletMask,
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
    baseFuel,
    showcaseMap
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

const configureFxLabRainTarget = (target: THREE.WebGLRenderTarget): THREE.WebGLRenderTarget => {
  target.texture.minFilter = THREE.LinearFilter;
  target.texture.magFilter = THREE.LinearFilter;
  target.texture.generateMipmaps = false;
  target.texture.name = "fx-lab-rain-scene";
  return target;
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
  const rainOverlayPass = createSeasonalRainOverlayPass();

  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog(0x1e2430, 22, 86);
  const seasonalSky = createSeasonalSkyDome();
  scene.add(seasonalSky.mesh);
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
  const canonicalMapPreset: FxLabMapPreset = createFxLabMapPreset(sceneState.world, sceneState.showcaseMap);
  let currentScenarioId = normalizeFxLabScenarioId(initialScenarioId);
  let fireDebugControls = cloneDefaultFireFxDebugControls();
  let waterDebugControls = cloneDefaultWaterFxDebugControls();
  let oceanWaterDebugControls = cloneDefaultOceanWaterDebugControls();
  let terrainWaterDebugControls = cloneDefaultTerrainWaterDebugControls();
  let terrainMesh: THREE.Mesh | null = null;
  let terrainSize: { width: number; depth: number } | null = null;
  let terrainSurface: TerrainRenderSurface | null = null;
  let lastTerrainStructureRevision = -1;
  let houseAssets: HouseAssets | null = getHouseAssetsCache();
  let treeAssets: TreeAssets | null = getTreeAssetsCache();
  let rainSceneTarget: THREE.WebGLRenderTarget | null = null;
  let rainSceneTargetFailed = false;
  const rainTargetSize = new THREE.Vector2(1, 1);
  let disposed = false;
  let running = false;
  let rafId = 0;
  let paused = false;
  let timeScale = 1;
  let weatherMode: FxLabWeatherMode = "rainEvent";
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
  let terrainStamp: FxLabTerrainStamp | null = null;
  let terrainStampRadius: 2 | 4 | 7 = 4;
  let terrainStrokeActive = false;
  let terrainEditStatus = "Choose a stamp, then drag over editable land.";
  let lastTerrainStampTile = -1;

  const fireFx: ThreeTestFireFx = createThreeTestFireFx(scene, camera, fireDebugControls);
  const constructionFx = createConstructionFxRuntime(scene, camera, null);
  constructionFx.setRunning(true);
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

  const disposeRainSceneTarget = (): void => {
    if (!rainSceneTarget) {
      return;
    }
    rainSceneTarget.dispose();
    rainSceneTarget = null;
  };

  const ensureRainSceneTarget = (): THREE.WebGLRenderTarget | null => {
    if (rainSceneTargetFailed) {
      return null;
    }
    renderer.getDrawingBufferSize(rainTargetSize);
    const targetWidth = Math.max(1, Math.floor(rainTargetSize.x));
    const targetHeight = Math.max(1, Math.floor(rainTargetSize.y));
    if (rainSceneTarget && rainSceneTarget.width === targetWidth && rainSceneTarget.height === targetHeight) {
      return rainSceneTarget;
    }
    disposeRainSceneTarget();
    try {
      rainSceneTarget = configureFxLabRainTarget(
        new THREE.WebGLRenderTarget(targetWidth, targetHeight, {
          depthBuffer: true,
          stencilBuffer: false
        })
      );
      return rainSceneTarget;
    } catch (error) {
      rainSceneTargetFailed = true;
      console.warn("[fxLab] Rain overlay target allocation failed; rendering scene without rain overlay.", error);
      return null;
    }
  };

  const normalizeWeatherMode = (mode: FxLabWeatherMode): FxLabWeatherMode =>
    mode === "yearCycle" || mode === "winter" || mode === "spring" || mode === "summer" || mode === "autumn"
      ? mode
      : "rainEvent";

  const getFxLabWeatherCareerDay = (): number => {
    if (weatherMode === "yearCycle") {
      return FX_LAB_RAIN_CAREER_DAY + labTimeMs * 0.001 * FX_LAB_WEATHER_CYCLE_DAYS_PER_SECOND;
    }
    return FX_LAB_WEATHER_MODE_CAREER_DAY[weatherMode] ?? FX_LAB_RAIN_CAREER_DAY;
  };

  const getFxLabWeatherSeasonT01 = (): number => {
    const dayOfYear = ((getFxLabWeatherCareerDay() % 360) + 360) % 360;
    return dayOfYear / 360;
  };

  const getFxLabWeatherRainIntensity = (): number =>
    weatherMode === "rainEvent" ? FX_LAB_RAIN_INTENSITY : 0;

  const syncWeatherRenderer = (): void => {
    const rainIntensity = getFxLabWeatherRainIntensity();
    const rainActive = currentScenarioId === FX_LAB_RAIN_SCENARIO_ID && rainIntensity > 0.001;
    const careerDay = getFxLabWeatherCareerDay();
    const seasonT01 = getFxLabWeatherSeasonT01();
    const lighting = buildLightingDirectorState({
      seasonT01,
      risk01: rainActive ? 0.22 : 0.44,
      careerDay,
      windDx: sceneState.world.wind.dx,
      windDy: sceneState.world.wind.dy,
      windStrength: sceneState.world.wind.strength,
      rainIntensity01: rainActive ? rainIntensity : 0,
      rainSeed: FX_LAB_RAIN_SEED,
      worldSeed: FX_LAB_SEED,
      timeSpeedValue: paused ? 0 : timeScale
    });
    seasonalSky.setState(lighting);
    seasonalSky.syncToCamera(camera);
    hemisphere.color.setRGB(
      lighting.skyTopColor.r / 255,
      lighting.skyTopColor.g / 255,
      lighting.skyTopColor.b / 255,
      THREE.SRGBColorSpace
    );
    hemisphere.intensity = lighting.ambientIntensity + 0.28;
    keyLight.color.setRGB(
      lighting.sunColor.r / 255,
      lighting.sunColor.g / 255,
      lighting.sunColor.b / 255,
      THREE.SRGBColorSpace
    );
    keyLight.intensity = lighting.sunIntensity;
    keyLight.position.copy(controls.target).addScaledVector(lighting.sunDirection, 42);
    keyLight.target.position.copy(controls.target);
    keyLight.target.updateMatrixWorld();
    waterSystem.setPalette({
      skyTop: lighting.skyTopColor,
      skyHorizon: {
        r: lighting.skyHorizonColor.r + (lighting.skyTopColor.r - lighting.skyHorizonColor.r) * 0.32,
        g: lighting.skyHorizonColor.g + (lighting.skyTopColor.g - lighting.skyHorizonColor.g) * 0.32,
        b: lighting.skyHorizonColor.b + (lighting.skyTopColor.b - lighting.skyHorizonColor.b) * 0.32
      },
      sun: lighting.waterSunColor,
      oceanShallow: lighting.oceanShallowColor,
      oceanDeep: lighting.oceanDeepColor,
      riverShallow: FX_LAB_RIVER_SHALLOW,
      riverDeep: FX_LAB_RIVER_DEEP
    });
    waterSystem.setOceanSurfaceContext(resolveOceanSurfaceContext({
      windDx: sceneState.world.wind.dx,
      windDy: sceneState.world.wind.dy,
      windStrength01: sceneState.world.wind.strength,
      rainIntensity01: rainActive ? rainIntensity : 0
    }));
  };

  const renderSceneWithOptionalRain = (): void => {
    syncWeatherRenderer();
    if (currentScenarioId !== FX_LAB_RAIN_SCENARIO_ID) {
      renderer.render(scene, camera);
      return;
    }
    const rainIntensity = getFxLabWeatherRainIntensity();
    const screenWind = resolveSeasonalRainScreenWind(camera, sceneState.world.wind);
    const weatherVisual = sampleSeasonalWeatherVisualState({
      careerDay: getFxLabWeatherCareerDay(),
      seasonT01: getFxLabWeatherSeasonT01(),
      rainIntensity01: rainIntensity,
      rainSeed: FX_LAB_RAIN_SEED,
      worldSeed: FX_LAB_SEED,
      windDx: sceneState.world.wind.dx,
      windDy: sceneState.world.wind.dy,
      windStrength: sceneState.world.wind.strength
    });
    rainOverlayPass.setState({
      enabled: rainIntensity > 0.001,
      intensity01: rainIntensity,
      visualIntensity01: rainIntensity,
      seed: FX_LAB_RAIN_SEED,
      timeSeconds: weatherVisual.rainTimeSeconds,
      windScreenX: screenWind.x,
      windScreenY: screenWind.y,
      windStrength01: screenWind.strength01
    });
    const target = ensureRainSceneTarget();
    if (!target || !rainOverlayPass.isActive()) {
      renderer.render(scene, camera);
      return;
    }
    const previousTarget = renderer.getRenderTarget();
    try {
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      rainOverlayPass.render(renderer, target.texture, previousTarget);
    } finally {
      renderer.setRenderTarget(previousTarget);
    }
  };

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
      const cameraX = focusWorldX - distance * 0.3;
      const cameraZ = focusWorldZ + distance * 0.56;
      const seaLevelWorld = FX_LAB_OCEAN_SEA_LEVEL * (terrainSurface?.heightScale ?? 1);
      const cameraGroundWorld = terrainSurface?.heightAtRenderedWorldPosition(cameraX, cameraZ) ?? 0;
      const cameraY = Math.max(
        seaLevelWorld + distance * 0.36,
        cameraGroundWorld + distance * 0.2
      );
      camera.position.set(cameraX, cameraY, cameraZ);
      controls.target.set(focusWorldX, seaLevelWorld + 0.35, focusWorldZ - distance * 0.04);
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
    if (currentScenarioId === "house-lifecycle") {
      const focusTileX = 18.0;
      const focusTileY = 30.0;
      const focusWorldX = (focusTileX / FX_LAB_GRID_SIZE - 0.5) * terrainSize.width;
      const focusWorldZ = (focusTileY / FX_LAB_GRID_SIZE - 0.5) * terrainSize.depth;
      const distance = Math.max(8, Math.max(terrainSize.width, terrainSize.depth) * 0.16);
      camera.position.set(focusWorldX - distance * 0.34, Math.max(5, distance * 0.34), focusWorldZ + distance * 0.72);
      controls.target.set(focusWorldX, 0.95, focusWorldZ);
      controls.minDistance = Math.max(4, distance * 0.34);
      controls.maxDistance = Math.max(28, distance * 2.4);
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
    const result = buildTerrainMesh(terrainSurface, treeAssets, houseAssets, null);
    terrainMesh = result.mesh;
    terrainSize = result.size;
    scene.add(terrainMesh);
    if (result.water) {
      waterSystem.rebuild(terrainMesh, result.water);
    }
    waterSystem.setLightDirectionFromKeyLight();
    fitCameraToTerrain();
    lastTerrainStructureRevision = sceneState.world.structureRevision;
  };

  const refreshTerrainSampleFromWorld = (): void => {
    const treeTypes = sceneState.sample.treeTypes ?? new Uint8Array(sceneState.world.grid.totalTiles);
    sceneState.sample = buildRenderTerrainSample(
      sceneState.world,
      treeTypes,
      sceneState.sample.debugTypeColors ?? false,
      sceneState.sample.treesEnabled ?? true,
      false,
      false,
      sceneState.sample.heightScaleMultiplier ?? 1
    );
    sceneState.sample.dynamicStructures = false;
  };

  const finishTerrainStroke = (): void => {
    if (!terrainStrokeActive) return;
    terrainStrokeActive = false;
    lastTerrainStampTile = -1;
    refreshTerrainSampleFromWorld();
    rebuildTerrain();
    renderOnce();
  };

  const stampTerrainAt = (tile: { x: number; y: number }): void => {
    if (!terrainStamp) return;
    const tileIndex = Math.floor(tile.y) * sceneState.world.grid.cols + Math.floor(tile.x);
    if (tileIndex === lastTerrainStampTile) return;
    lastTerrainStampTile = tileIndex;
    const result = applyFxLabTerrainStamp(
      sceneState.world,
      sceneState.showcaseMap,
      terrainStamp,
      tile.x,
      tile.y,
      terrainStampRadius
    );
    terrainEditStatus = result.protected > 0
      ? `Changed ${result.changed} tiles; ${result.protected} protected tiles were skipped.`
      : `Changed ${result.changed} tiles.`;
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

  const hydrateHouseAssets = (): void => {
    if (houseAssets) {
      return;
    }
    void loadHouseAssets()
      .then((assets) => {
        if (disposed) {
          return;
        }
        houseAssets = assets;
        rebuildTerrain();
      })
      .catch((error) => {
        console.warn("[fxLab] Failed to load house assets for lifecycle preview.", error);
      });
  };

  const resetDynamicState = (): void => {
    sceneState.world.tileFire.fill(0);
    sceneState.world.tileHeat.fill(0);
    sceneState.world.tileBurnAge.fill(0);
    sceneState.world.tileHeatRelease.fill(0);
    sceneState.world.tileSuppressionWetness.fill(0);
    sceneState.world.tileFuel.set(sceneState.baseFuel);
    sceneState.world.lastActiveFires = 0;
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
    if (mode !== "none") terrainStamp = null;
    placementMode = mode;
    controls.enabled = mode === "none" && terrainStamp === null;
    canvas.style.cursor = mode === "none" && terrainStamp === null ? "" : "crosshair";
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
        sceneState.world.tileHeatRelease[idx] = Math.max(sceneState.world.tileHeatRelease[idx] ?? 0, fire * 0.22);
        sceneState.world.tileBurnAge[idx] = Math.min(sceneState.world.tileBurnAge[idx] ?? 0, 0.08);
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
        sceneState.world.tileHeatRelease[idx] = Math.max(sceneState.world.tileHeatRelease[idx] ?? 0, fire * 0.24);
        sceneState.world.tileBurnAge[idx] = Math.min(sceneState.world.tileBurnAge[idx] ?? 0, 0.12);
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
        const bandWidth = Math.max(0.0001, outerRadius - innerRadius);
        const centerDist = innerRadius + bandWidth * 0.5;
        const distFromCenter = Math.abs(dist - centerDist) / Math.max(0.0001, bandWidth * 0.5);
        const shoulder = Math.pow(1 - clamp(distFromCenter, 0, 1), 0.8);
        const fire = 0.14 * shoulder;
        sceneState.world.tileFire[idx] = Math.max(sceneState.world.tileFire[idx] ?? 0, fire);
        sceneState.world.tileHeat[idx] = Math.max(
          sceneState.world.tileHeat[idx] ?? 0,
          sceneState.world.fireSettings.heatCap * (0.05 + shoulder * 0.12)
        );
        sceneState.world.tileHeatRelease[idx] = Math.max(sceneState.world.tileHeatRelease[idx] ?? 0, fire * 0.18);
        sceneState.world.tileBurnAge[idx] = Math.max(sceneState.world.tileBurnAge[idx] ?? 0, 0.35 + shoulder * 0.25);
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
      const heatRelease = sceneState.world.tileHeatRelease[idx] ?? 0;
      const weight = Math.max(fire, heat * 0.12, heatRelease * 0.18);
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
    let hasBounds = false;
    let minX = cols;
    let maxX = -1;
    let minY = rows;
    let maxY = -1;
    for (let idx = 0; idx < totalTiles; idx += 1) {
      const fire = sceneState.world.tileFire[idx] ?? 0;
      const heat = sceneState.world.tileHeat[idx] ?? 0;
      const heatRelease = sceneState.world.tileHeatRelease[idx] ?? 0;
      if (fire > 0.02) {
        activeCount += 1;
      }
      if (fire <= 0.001 && heat <= 0.04 && heatRelease <= 0.01) {
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
    if ((placementMode === "none" && terrainStamp === null) || event.button !== 0) {
      return;
    }
    const tile = pickTerrainTile(event.clientX, event.clientY);
    if (!tile) {
      return;
    }
    event.preventDefault();
    if (terrainStamp) {
      terrainStrokeActive = true;
      canvas.setPointerCapture(event.pointerId);
      stampTerrainAt(tile);
    } else if (placementMode === "truck") {
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

  const handleCanvasPointerMove = (event: PointerEvent): void => {
    if (!terrainStrokeActive || !terrainStamp) return;
    const tile = pickTerrainTile(event.clientX, event.clientY);
    if (tile) stampTerrainAt(tile);
  };

  const handleCanvasPointerUp = (event: PointerEvent): void => {
    if (!terrainStrokeActive) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    finishTerrainStroke();
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
    const fireAnimationRate = paused ? 0 : timeScale;
    controls.update();
    waterSystem.setLightDirectionFromKeyLight();
    waterSystem.update(now, frameDeltaMs * 0.001, 1000 / Math.max(1, frameDeltaMs), lastSceneRenderMs);
    applyScenarioFrame();
    if (sceneState.world.structureRevision !== lastTerrainStructureRevision) {
      refreshTerrainSampleFromWorld();
      rebuildTerrain();
    }
    fireFx.update(
      now,
      sceneState.world,
      sceneState.sample,
      terrainSize,
      terrainSurface,
      null,
      null,
      60,
      lastSceneRenderMs,
      fireAnimationRate
    );
    constructionFx.update(now, frameDeltaMs * 0.001, sceneState.sample, terrainSurface, fireAnimationRate);
    unitsLayer.update(sceneState.world, terrainSurface, 1);
    unitFxLayer.update(sceneState.world, sceneState.effects, terrainSurface, 1, now);
    updateSprayTargetMarker(now);
    const renderStartedAt = performance.now();
    renderSceneWithOptionalRain();
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
    rainOverlayPass.resize(width, height);
    disposeRainSceneTarget();
  };

  rebuildTerrain();
  hydrateTreeAssets();
  hydrateHouseAssets();
  resize();
  renderOnce();
  canvas.addEventListener("pointerdown", handleCanvasPointerDown);
  canvas.addEventListener("pointermove", handleCanvasPointerMove);
  canvas.addEventListener("pointerup", handleCanvasPointerUp);
  canvas.addEventListener("pointercancel", handleCanvasPointerUp);

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
      canvas.removeEventListener("pointermove", handleCanvasPointerMove);
      canvas.removeEventListener("pointerup", handleCanvasPointerUp);
      canvas.removeEventListener("pointercancel", handleCanvasPointerUp);
      setPlacementMode("none");
      controls.dispose();
      fireFx.dispose();
      constructionFx.dispose();
      unitFxLayer.dispose();
      unitsLayer.dispose();
      waterSystem.dispose();
      rainOverlayPass.dispose();
      scene.remove(seasonalSky.mesh);
      seasonalSky.dispose();
      disposeRainSceneTarget();
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
      if (currentScenarioId !== FX_LAB_RAIN_SCENARIO_ID) {
        disposeRainSceneTarget();
      }
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
    setWeatherMode: (mode: FxLabWeatherMode) => {
      weatherMode = normalizeWeatherMode(mode);
      renderOnce();
    },
    getWeatherMode: () => weatherMode,
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
    getFireDebugSnapshot: () => fireFx.getDebugSnapshot(),
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
    setTerrainStamp: (stamp: FxLabTerrainStamp | null) => {
      finishTerrainStroke();
      terrainStamp = stamp;
      if (stamp) placementMode = "none";
      controls.enabled = stamp === null && placementMode === "none";
      canvas.style.cursor = controls.enabled ? "" : "crosshair";
      terrainEditStatus = stamp ? `${stamp} stamp selected.` : "Terrain stamping off.";
    },
    getTerrainStamp: () => terrainStamp,
    setTerrainStampRadius: (radius: 2 | 4 | 7) => {
      terrainStampRadius = radius;
    },
    getTerrainStampRadius: () => terrainStampRadius,
    getTerrainEditStatus: () => terrainEditStatus,
    resetShowcaseMap: () => {
      finishTerrainStroke();
      sceneState.showcaseMap = createFxLabShowcaseMap(sceneState.world);
      sceneState.baseFuel = sceneState.showcaseMap.baseFuel;
      sceneState.world.tileFuel.set(sceneState.baseFuel);
      refreshTerrainSampleFromWorld();
      rebuildTerrain();
      terrainEditStatus = "Canonical showcase map restored.";
      renderOnce();
    },
    exportShowcaseMap: () => formatFxLabMapPreset(createFxLabMapPreset(sceneState.world, sceneState.showcaseMap)),
    importShowcaseMap: (text: string) => {
      finishTerrainStroke();
      let preset: FxLabMapPreset;
      try {
        preset = parseFxLabMapPreset(text, canonicalMapPreset, sceneState.showcaseMap.protectedMask);
      } catch (error) {
        terrainEditStatus = error instanceof Error ? error.message : "Map import failed.";
        throw error;
      }
      replaceFxLabEditableMap(sceneState.world, sceneState.showcaseMap, preset.elevations, preset.tileTypes, preset.treeTypes);
      sceneState.baseFuel = sceneState.showcaseMap.baseFuel;
      refreshTerrainSampleFromWorld();
      rebuildTerrain();
      terrainEditStatus = "Showcase map preset imported.";
      renderOnce();
    },
    getOverridePayload: () => buildFxLabOverrides(fireDebugControls, waterDebugControls, terrainWaterDebugControls, oceanWaterDebugControls),
    getOverridePayloadText: () => formatFxLabOverrides(fireDebugControls, waterDebugControls, terrainWaterDebugControls, oceanWaterDebugControls)
  };
};
