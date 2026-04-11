import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { getRuntimeSettings } from "../persistence/runtimeSettings.js";
import {
  getFirestationAssetCache,
  getHouseAssetsCache,
  getTreeAssetsCache,
  loadFirestationAsset,
  loadHouseAssets,
  loadTreeAssets
} from "./threeTestAssets.js";
import { createSeasonalSkyDome } from "./seasonalSky.js";
import {
  buildTerrainMesh,
  prepareTerrainRenderSurface,
  type TerrainBridgeDebug,
  type TerrainBridgeSpanDebug,
  type TerrainRenderSurface,
  type TerrainSample
} from "./threeTestTerrain.js";
import { ThreeTestWaterSystem } from "./threeTestWater.js";
import { getRequiredWebGLContext } from "./webglContext.js";
export type TerrainPreviewAssetProgress = {
  label: string;
  completed: number;
  total: number;
  progress: number;
};

export type TerrainPreviewSetTerrainOptions = {
  recenter?: boolean;
};

export type TerrainPreviewBridgeSelection = {
  selectedSpan: TerrainBridgeSpanDebug | null;
  bridgeDebug: TerrainBridgeDebug | null;
};

export type TerrainPreviewHoverTile = {
  tileX: number;
  tileY: number;
};

export type TerrainPreviewController = {
  prepareAssets: (onProgress?: (progress: TerrainPreviewAssetProgress) => void) => Promise<void>;
  start: () => void;
  stop: () => void;
  resize: () => void;
  setTerrain: (sample: TerrainSample, options?: TerrainPreviewSetTerrainOptions) => void;
  setBridgeSelectionListener: (listener: ((selection: TerrainPreviewBridgeSelection) => void) | null) => void;
  setHoverTileListener: (listener: ((hover: TerrainPreviewHoverTile | null) => void) | null) => void;
  resetView: () => void;
  dispose: () => void;
};

const SKY_TOP_COLOR = 0x38506e;
const SKY_HORIZON_COLOR = 0x5d4835;
const FOG_COLOR = 0x4d5a68;
const WATER_FOG_NEAR = 10_000;
const WATER_FOG_FAR = 20_000;
const DEFAULT_CAMERA_DIRECTION = new THREE.Vector3(0.65, 0.55, 0.65).normalize();
const CAMERA_FIT_PADDING = 1.12;

type TerrainPreviewFrame = {
  center: THREE.Vector3;
  radius: number;
  size: THREE.Vector3;
  baseY: number;
};

const disposeMaterial = (material: THREE.Material): void => {
  const textured = material as THREE.Material & {
    map?: THREE.Texture | null;
    alphaMap?: THREE.Texture | null;
    normalMap?: THREE.Texture | null;
    roughnessMap?: THREE.Texture | null;
    metalnessMap?: THREE.Texture | null;
    emissiveMap?: THREE.Texture | null;
    aoMap?: THREE.Texture | null;
    displacementMap?: THREE.Texture | null;
  };
  textured.map?.dispose();
  textured.alphaMap?.dispose();
  textured.normalMap?.dispose();
  textured.roughnessMap?.dispose();
  textured.metalnessMap?.dispose();
  textured.emissiveMap?.dispose();
  textured.aoMap?.dispose();
  textured.displacementMap?.dispose();
  material.dispose();
};

const disposeTerrainMesh = (mesh: THREE.Mesh | null, scene: THREE.Scene): void => {
  if (!mesh) {
    return;
  }
  scene.remove(mesh);
  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) {
      return;
    }
    if (child.geometry) {
      child.geometry.dispose();
    }
    if (Array.isArray(child.material)) {
      child.material.forEach((material) => disposeMaterial(material));
    } else {
      disposeMaterial(child.material);
    }
  });
};

export const createTerrainPreviewController = (canvas: HTMLCanvasElement): TerrainPreviewController => {
  const runtimeSettings = getRuntimeSettings();
  const context = getRequiredWebGLContext(canvas, "The 3D terrain preview");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    antialias: true,
    alpha: false,
    powerPreference: "default"
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Math.max(1, Math.min(2, runtimeSettings.dpr))));
  renderer.setClearColor(0x121822, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.fog = null;

  const seasonalSky = createSeasonalSkyDome();
  scene.add(seasonalSky.mesh);

  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
  camera.position.set(14, 12, 14);
  camera.lookAt(0, 0, 0);

  const hemisphere = new THREE.HemisphereLight(0x8ca9c7, 0x6b5644, 0.96);
  scene.add(hemisphere);
  const ambient = new THREE.AmbientLight(0xfff7ec, 0.38);
  scene.add(ambient);

  const keyLight = new THREE.DirectionalLight(0xffe8c8, 1.28);
  keyLight.position.set(5.5, 7, 3.5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.width = 2048;
  keyLight.shadow.mapSize.height = 2048;
  keyLight.shadow.bias = -0.00035;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);
  scene.add(keyLight.target);

  const fillLight = new THREE.DirectionalLight(0x9bbbe0, 0.62);
  fillLight.position.set(-4.5, 3.6, -3.5);
  scene.add(fillLight);
  scene.add(fillLight.target);

  const rimLight = new THREE.DirectionalLight(0xc3d9ef, 0.24);
  rimLight.position.set(-2.5, 6, 5.5);
  scene.add(rimLight);
  scene.add(rimLight.target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = true;
  controls.enableZoom = true;
  controls.minDistance = 3;
  controls.maxDistance = 120;
  controls.target.set(0, 0, 0);

  const waterSystem = new ThreeTestWaterSystem({
    scene,
    renderer,
    keyLight,
    skyTopColor: SKY_TOP_COLOR,
    skyHorizonColor: SKY_HORIZON_COLOR,
    fogColor: FOG_COLOR,
    fogNear: WATER_FOG_NEAR,
    fogFar: WATER_FOG_FAR,
    preferredQuality: runtimeSettings.waterq
  });
  waterSystem.setLightDirectionFromKeyLight();

  let terrainMesh: THREE.Mesh | null = null;
  let terrainSurface: TerrainRenderSurface | null = null;
  let lastTerrainFrame: TerrainPreviewFrame | null = null;
  let bridgeDebug: TerrainBridgeDebug | null = null;
  let selectedBridgeSpan: TerrainBridgeSpanDebug | null = null;
  let bridgeSelectionListener: ((selection: TerrainPreviewBridgeSelection) => void) | null = null;
  let hoverTileListener: ((hover: TerrainPreviewHoverTile | null) => void) | null = null;
  let lastHoverTileKey = "";
  let running = false;
  let rafId = 0;
  let lastFrameTime = performance.now();
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  const emitBridgeSelection = (): void => {
    bridgeSelectionListener?.({
      selectedSpan: selectedBridgeSpan,
      bridgeDebug
    });
  };

  const setBridgeSelection = (selection: TerrainBridgeSpanDebug | null): void => {
    selectedBridgeSpan = selection;
    emitBridgeSelection();
  };

  const emitHoverTile = (hover: TerrainPreviewHoverTile | null): void => {
    const nextKey = hover ? `${hover.tileX},${hover.tileY}` : "";
    if (nextKey === lastHoverTileKey) {
      return;
    }
    lastHoverTileKey = nextKey;
    hoverTileListener?.(hover);
  };

  const resolveHoverTileFromWorldPoint = (worldX: number, worldZ: number): TerrainPreviewHoverTile | null => {
    if (!terrainSurface || terrainSurface.width === 0 || terrainSurface.depth === 0) {
      return null;
    }
    const tileX = Math.max(0, Math.min(terrainSurface.cols - 1, Math.floor((worldX / terrainSurface.width + 0.5) * terrainSurface.cols)));
    const tileY = Math.max(0, Math.min(terrainSurface.rows - 1, Math.floor((worldZ / terrainSurface.depth + 0.5) * terrainSurface.rows)));
    if (tileX < 0 || tileY < 0 || tileX >= terrainSurface.cols || tileY >= terrainSurface.rows) {
      return null;
    }
    return { tileX, tileY };
  };

  const resolveBridgeSpanDebug = (object: THREE.Object3D | null): TerrainBridgeSpanDebug | null => {
    let current: THREE.Object3D | null = object;
    while (current) {
      const debug = current.userData.bridgeSpanDebug as TerrainBridgeSpanDebug | undefined;
      if (debug) {
        return debug;
      }
      current = current.parent;
    }
    return null;
  };

  const pickBridgeSpan = (clientX: number, clientY: number): TerrainBridgeSpanDebug | null => {
    if (!terrainMesh) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      return null;
    }
    pointerNdc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -(((clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(terrainMesh, true);
    for (let i = 0; i < hits.length; i += 1) {
      const debug = resolveBridgeSpanDebug(hits[i]?.object ?? null);
      if (debug) {
        return debug;
      }
    }
    return null;
  };

  const handleCanvasClick = (event: MouseEvent): void => {
    setBridgeSelection(pickBridgeSpan(event.clientX, event.clientY));
  };
  canvas.addEventListener("click", handleCanvasClick);

  const handleCanvasPointerMove = (event: MouseEvent): void => {
    if (!terrainMesh) {
      emitHoverTile(null);
      return;
    }
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
      emitHoverTile(null);
      return;
    }
    pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointerNdc.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(terrainMesh, false);
    const hit = hits[0];
    if (!hit) {
      emitHoverTile(null);
      return;
    }
    emitHoverTile(resolveHoverTileFromWorldPoint(hit.point.x, hit.point.z));
  };
  const handleCanvasPointerLeave = (): void => {
    emitHoverTile(null);
  };
  canvas.addEventListener("mousemove", handleCanvasPointerMove);
  canvas.addEventListener("mouseleave", handleCanvasPointerLeave);

  const syncCameraForTerrain = (frame: TerrainPreviewFrame): void => {
    const verticalFov = THREE.MathUtils.degToRad(camera.fov);
    const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * Math.max(0.001, camera.aspect));
    const fitFov = Math.max(0.1, Math.min(verticalFov, horizontalFov));
    const radius = Math.max(2, frame.radius);
    const distance = Math.max(radius / Math.sin(fitFov / 2), radius * 1.35) * CAMERA_FIT_PADDING;
    const target = new THREE.Vector3(
      frame.center.x,
      THREE.MathUtils.lerp(frame.baseY, frame.center.y, 0.3),
      frame.center.z
    );
    const lightTarget = new THREE.Vector3(
      frame.center.x,
      THREE.MathUtils.lerp(frame.baseY, frame.center.y, 0.08),
      frame.center.z
    );
    const position = target.clone().addScaledVector(DEFAULT_CAMERA_DIRECTION, distance);
    position.y += Math.max(0, frame.size.y * 0.18);

    camera.near = Math.max(0.1, distance - radius * 3.2);
    camera.far = Math.max(400, distance + radius * 10);
    camera.position.copy(position);
    controls.minDistance = Math.max(3, radius * 0.45);
    controls.maxDistance = Math.max(120, distance * 4.5);
    controls.target.copy(target);
    keyLight.target.position.copy(lightTarget);
    fillLight.target.position.copy(lightTarget);
    rimLight.target.position.copy(lightTarget);
    keyLight.target.updateMatrixWorld();
    fillLight.target.updateMatrixWorld();
    rimLight.target.updateMatrixWorld();
    waterSystem.setLightDirectionFromKeyLight();
    camera.updateProjectionMatrix();
    controls.update();
    seasonalSky.syncToCamera(camera);
  };

  const renderFrame = (time: number): void => {
    if (!running) {
      return;
    }
    rafId = window.requestAnimationFrame(renderFrame);
    const dtSeconds = Math.max(0.001, (time - lastFrameTime) / 1000);
    lastFrameTime = time;
    controls.update();
    seasonalSky.syncToCamera(camera);
    waterSystem.update(time, dtSeconds, 60, 0);
    renderer.render(scene, camera);
  };

  const resize = (): void => {
    const bounds = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(bounds.width));
    const height = Math.max(1, Math.floor(bounds.height));
    if (width <= 1 || height <= 1) {
      return;
    }
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    seasonalSky.syncToCamera(camera);
  };

  const prepareAssets = async (
    onProgress?: (progress: TerrainPreviewAssetProgress) => void
  ): Promise<void> => {
    const tasks: Array<{ label: string; run: () => Promise<unknown> }> = [];
    if (!getTreeAssetsCache()) {
      tasks.push({ label: "trees", run: () => loadTreeAssets() });
    }
    if (!getHouseAssetsCache()) {
      tasks.push({ label: "houses", run: () => loadHouseAssets() });
    }
    if (!getFirestationAssetCache()) {
      tasks.push({ label: "firestation", run: () => loadFirestationAsset() });
    }
    if (tasks.length === 0) {
      onProgress?.({ label: "ready", completed: 1, total: 1, progress: 1 });
      return;
    }
    let completed = 0;
    const total = tasks.length;
    onProgress?.({ label: "starting", completed: 0, total, progress: 0 });
    await Promise.all(
      tasks.map(async (task) => {
        try {
          await task.run();
        } catch (error) {
          console.warn(`[terrainPreview] Failed to preload ${task.label} assets.`, error);
        }
        completed += 1;
        onProgress?.({
          label: task.label,
          completed,
          total,
          progress: total > 0 ? completed / total : 1
        });
      })
    );
  };

  const setTerrain = (sample: TerrainSample, options: TerrainPreviewSetTerrainOptions = {}): void => {
    const hadTerrain = lastTerrainFrame !== null;
    disposeTerrainMesh(terrainMesh, scene);
    terrainMesh = null;
    waterSystem.clear();
    bridgeDebug = null;
    selectedBridgeSpan = null;
    terrainSurface = null;
    emitHoverTile(null);
    emitBridgeSelection();
    if (sample.cols <= 1 || sample.rows <= 1 || sample.elevations.length === 0) {
      lastTerrainFrame = null;
      return;
    }
    const surface = prepareTerrainRenderSurface(sample);
    terrainSurface = surface;
    const { mesh, size, water } = buildTerrainMesh(
      surface,
      getTreeAssetsCache(),
      getHouseAssetsCache(),
      getFirestationAssetCache()
    );
    bridgeDebug = (mesh.userData.bridgeDebug as TerrainBridgeDebug | undefined) ?? null;
    emitBridgeSelection();
    terrainMesh = mesh;
    scene.add(mesh);
    const terrainBounds = new THREE.Box3().setFromObject(mesh);
    const terrainSphere = terrainBounds.getBoundingSphere(new THREE.Sphere());
    const terrainSize = terrainBounds.getSize(new THREE.Vector3());
    lastTerrainFrame = {
      center: terrainSphere.center.clone(),
      radius: Math.max(terrainSphere.radius, size.width * 0.5, size.depth * 0.5),
      size: terrainSize,
      baseY: terrainBounds.min.y
    };
    if (water) {
      waterSystem.rebuild(mesh, water);
      const riverVisible = !sample.debugRenderOptions?.disableRiverWater;
      const currentWaterDebug = waterSystem.getDebugControls();
      waterSystem.setDebugControls({
        ...currentWaterDebug,
        showRiver: riverVisible,
        showWaterfalls: riverVisible
      });
      waterSystem.setLightDirectionFromKeyLight();
    } else {
      const currentWaterDebug = waterSystem.getDebugControls();
      waterSystem.setDebugControls({
        ...currentWaterDebug,
        showRiver: true,
        showWaterfalls: true
      });
    }
    if (options.recenter || !hadTerrain) {
      syncCameraForTerrain(lastTerrainFrame);
    }
  };

  const start = (): void => {
    if (running) {
      return;
    }
    running = true;
    lastFrameTime = performance.now();
    resize();
    rafId = window.requestAnimationFrame(renderFrame);
  };

  const stop = (): void => {
    running = false;
    if (rafId !== 0) {
      window.cancelAnimationFrame(rafId);
      rafId = 0;
    }
  };

  const resetView = (): void => {
    if (!lastTerrainFrame) {
      return;
    }
    syncCameraForTerrain(lastTerrainFrame);
  };

  const setBridgeSelectionListener = (
    listener: ((selection: TerrainPreviewBridgeSelection) => void) | null
  ): void => {
    bridgeSelectionListener = listener;
    emitBridgeSelection();
  };

  const setHoverTileListener = (
    listener: ((hover: TerrainPreviewHoverTile | null) => void) | null
  ): void => {
    hoverTileListener = listener;
    if (!hoverTileListener) {
      return;
    }
    if (!lastHoverTileKey) {
      hoverTileListener(null);
      return;
    }
    const [tileX, tileY] = lastHoverTileKey.split(",").map((value) => Number.parseInt(value, 10));
    hoverTileListener(Number.isFinite(tileX) && Number.isFinite(tileY) ? { tileX, tileY } : null);
  };

  const dispose = (): void => {
    stop();
    canvas.removeEventListener("click", handleCanvasClick);
    canvas.removeEventListener("mousemove", handleCanvasPointerMove);
    canvas.removeEventListener("mouseleave", handleCanvasPointerLeave);
    disposeTerrainMesh(terrainMesh, scene);
    terrainMesh = null;
    terrainSurface = null;
    waterSystem.dispose();
    controls.dispose();
    scene.remove(seasonalSky.mesh);
    seasonalSky.dispose();
    renderer.dispose();
  };

  return {
    prepareAssets,
    start,
    stop,
    resize,
    setTerrain,
    setBridgeSelectionListener,
    setHoverTileListener,
    resetView,
    dispose
  };
};
