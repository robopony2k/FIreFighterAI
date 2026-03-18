import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createEffectsState, type EffectsState } from "../../core/effectsState.js";
import { createInitialState, TILE_TYPE_IDS, type WorldState } from "../../core/state.js";
import { TREE_TYPE_IDS, TreeType, type Formation, type Grid, type Unit, type WaterSprayMode } from "../../core/types.js";
import { buildTerrainMesh, getTerrainHeightScale, type TerrainSample } from "../threeTestTerrain.js";
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
import {
  buildFxLabOverrides,
  cloneDefaultFireFxDebugControls,
  cloneDefaultWaterFxDebugControls,
  formatFxLabOverrides
} from "./controls.js";
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

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const fract = (value: number): number => value - Math.floor(value);

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
  crewIds: kind === "truck" ? [2] : [],
  crewMode: kind === "truck" ? "deployed" : "deployed",
  formation,
  attackTarget: null,
  sprayTarget: null
});

const applyTerrainLayout = (world: WorldState): { treeTypes: Uint8Array; baseFuel: Float32Array } => {
  const cols = world.grid.cols;
  const rows = world.grid.rows;
  const total = world.grid.totalTiles;
  const treeTypes = new Uint8Array(total);
  const baseFuel = new Float32Array(total);
  let landTiles = 0;
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
      landTiles += tileType === TILE_TYPE_IDS.road || tileType === TILE_TYPE_IDS.base ? 0 : 1;
    }
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

  const sceneState = createSceneState();
  let currentScenarioId = normalizeFxLabScenarioId(initialScenarioId);
  let fireDebugControls = cloneDefaultFireFxDebugControls();
  let waterDebugControls = cloneDefaultWaterFxDebugControls();
  let terrainMesh: THREE.Mesh | null = null;
  let terrainSize: { width: number; depth: number } | null = null;
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

  const fitCameraToTerrain = (): void => {
    if (!terrainSize) {
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
    if (terrainMesh) {
      scene.remove(terrainMesh);
      disposeTerrainMesh(terrainMesh);
      terrainMesh = null;
    }
    const result = buildTerrainMesh(sceneState.sample, treeAssets, null, null);
    terrainMesh = result.mesh;
    terrainSize = result.size;
    scene.add(terrainMesh);
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
    if (!showMarker || !terrainSize) {
      sprayTargetMarker.visible = false;
      return;
    }
    const target = getActiveManualSprayTarget();
    const { cols, rows } = sceneState.world.grid;
    const heightScale = getTerrainHeightScale(cols, rows);
    const worldX = (target.x / Math.max(1, cols) - 0.5) * terrainSize.width;
    const worldZ = (target.y / Math.max(1, rows) - 0.5) * terrainSize.depth;
    const worldY = sceneState.sample.elevations.length > 0
      ? sceneState.sample.elevations[
          Math.max(0, Math.min(sceneState.sample.elevations.length - 1, Math.floor(target.y - 0.5) * cols + Math.floor(target.x - 0.5)))
        ] * heightScale + 0.06
      : 0.06;
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
    applyScenarioFrame();
    fireFx.update(now, sceneState.world, sceneState.sample, terrainSize, null, 60, lastSceneRenderMs);
    unitsLayer.update(sceneState.world, sceneState.sample, terrainSize, 1);
    unitFxLayer.update(sceneState.world, sceneState.effects, sceneState.sample, terrainSize, 1, now);
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
      scene.remove(sprayTargetMarker);
      sprayTargetMarker.geometry.dispose();
      (sprayTargetMarker.material as THREE.Material).dispose();
      if (terrainMesh) {
        scene.remove(terrainMesh);
        disposeTerrainMesh(terrainMesh);
        terrainMesh = null;
      }
      renderer.dispose();
    },
    setScenario: (scenarioId: FxLabScenarioId) => {
      currentScenarioId = normalizeFxLabScenarioId(scenarioId);
      setPlacementMode("none");
      manualTruckPlacement = null;
      manualFirefighterPlacement = null;
      labTimeMs = 0;
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
    resetAllDebugControls: () => {
      fireDebugControls = cloneDefaultFireFxDebugControls();
      waterDebugControls = cloneDefaultWaterFxDebugControls();
      fireFx.setDebugControls(fireDebugControls);
      unitFxLayer.setDebugControls(waterDebugControls);
      renderOnce();
    },
    getOverridePayload: () => buildFxLabOverrides(fireDebugControls, waterDebugControls),
    getOverridePayloadText: () => formatFxLabOverrides(fireDebugControls, waterDebugControls)
  };
};
