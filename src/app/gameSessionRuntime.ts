import { BASE_BUDGET, TILE_SIZE, MAP_SCALE, TIME_SPEED_OPTIONS, MAP_SIZE_PRESETS } from "../core/config.js";
import type { MapSizeId } from "../core/config.js";
import { getCharacterBaseBudget } from "../core/characters.js";
import { RNG } from "../core/rng.js";
import { computeChecksum, createInitialState, resetState, setStatus } from "../core/state.js";
import { ensureTileSoA, syncTileSoA } from "../core/tileCache.js";
import { setFuelProfiles } from "../core/tiles.js";
import { TREE_TYPE_IDS } from "../core/types.js";
import { createEffectsState, resetEffectsState } from "../core/effectsState.js";
import { createInputState, resetInputState } from "../core/inputState.js";
import { createUiState, resetUiState } from "../core/uiState.js";
import { createGameEventBus } from "../core/gameEvents.js";
import { CLIMATE_IGNITION_MAX, CLIMATE_IGNITION_MIN, VIRTUAL_CLIMATE_PARAMS } from "../core/climate.js";
import { generateMap, type MapGenDebug, type MapGenDebugSnapshot } from "../mapgen/index.js";
import { resetTerrainCaches } from "../render/terrainCache.js";
import { renderLegacy2dFrame } from "../render/legacy2d/index.js";
import { createThreeTest, type ThreeTestPerfSnapshot } from "../render/threeTest.js";
import {
  getFirestationAssetCache,
  getHouseAssetsCache,
  getTreeAssetsCache,
  loadFirestationAsset,
  loadHouseAssets,
  loadTreeAssets
} from "../render/threeTestAssets.js";
import { asRenderSim, buildRenderTerrainSample } from "../render/simView.js";
import { createRenderState, syncRenderState } from "../render/renderState.js";
import { initPhaseUI } from "../ui/phase/index.js";
import { bindPhaseUi } from "../ui/phase/bindings.js";
import { buildMapGenControls } from "../ui/mapgen-controls.js";
import { getOverlayRefs, updateOverlay } from "../ui/overlay.js";
import { saveLeaderboard } from "../persistence/leaderboard.js";
import { loadFuelProfileOverrides } from "../persistence/fuelProfiles.js";
import { loadLastRunConfig } from "../persistence/lastRunConfig.js";
import { randomizeWind } from "../sim/wind.js";
import { endGame, setGameEventBus, setPhase, stepSim } from "../sim/index.js";
import { initScoringForRun } from "../sim/scoring.js";
import { seedStartingRoster } from "../sim/units.js";
import { PHASES } from "../core/time.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS, DEFAULT_RUN_SEED, normalizeFireSettings } from "../ui/run-config.js";
import type { NewRunConfig } from "../ui/run-config.js";
import type { GameUiSnapshot } from "../ui/phase/types.js";
import { createRenderBackend, resolveRenderBackend, type RenderBackend } from "./renderBackend.js";
import { updatePerfCounter } from "./perfDiagnostics.js";
import { startAppBootLoop } from "./bootLoop.js";
import { createUiAudioController } from "../audio/uiAudio.js";
import { createMusicController } from "../audio/musicController.js";
import { showTitleScreen as mountTitleScreen, type TitleScreenHandle } from "../ui/titleScreen.js";
import { loadMusicAudioSettings, saveMusicAudioSettings } from "../persistence/audioSettings.js";


export type { RenderBackend } from "./renderBackend.js";

// Single switch for removing the startup title layer.
const ENABLE_TITLE_SCREEN = true;

type ElectronBridge = {
  quit?: () => void;
  close?: () => void;
  appQuit?: () => void;
  send?: (channel: string) => void;
  invoke?: (channel: string) => Promise<unknown> | unknown;
};

const callQuitBridge = (bridge: ElectronBridge | null | undefined): boolean => {
  if (!bridge) {
    return false;
  }
  if (typeof bridge.quit === "function") {
    bridge.quit();
    return true;
  }
  if (typeof bridge.appQuit === "function") {
    bridge.appQuit();
    return true;
  }
  if (typeof bridge.close === "function") {
    bridge.close();
    return true;
  }
  if (typeof bridge.send === "function") {
    bridge.send("app:quit");
    return true;
  }
  if (typeof bridge.invoke === "function") {
    void bridge.invoke("app:quit");
    return true;
  }
  return false;
};

export type AppRuntime = {
  boot: () => Promise<void>;
  resetGame: (config: NewRunConfig) => Promise<void>;
  openThreeTest: (config: NewRunConfig) => Promise<void>;
  dispose: () => void;
};

const cloneRunConfig = (config: NewRunConfig): NewRunConfig => ({
  seed: Number.isFinite(config.seed) ? Math.floor(config.seed) : DEFAULT_RUN_SEED,
  mapSize: config.mapSize,
  characterId: config.characterId,
  callsign: config.callsign,
  options: {
    ...DEFAULT_RUN_OPTIONS,
    ...config.options,
    mapGen: { ...DEFAULT_RUN_OPTIONS.mapGen, ...config.options.mapGen },
    fire: { ...DEFAULT_RUN_OPTIONS.fire, ...config.options.fire },
    fuelProfiles: { ...(config.options.fuelProfiles ?? {}) }
  }
});

const resolveRunConfig = (defaults: NewRunConfig, persisted?: NewRunConfig | null): NewRunConfig => {
  if (!persisted) {
    return cloneRunConfig(defaults);
  }
  return {
    seed: persisted.seed,
    mapSize: persisted.mapSize,
    characterId: persisted.characterId,
    callsign: persisted.callsign.trim().length > 0 ? persisted.callsign : defaults.callsign,
    options: {
      ...defaults.options,
      ...persisted.options,
      mapGen: { ...defaults.options.mapGen, ...persisted.options.mapGen },
      fire: { ...defaults.options.fire, ...persisted.options.fire },
      fuelProfiles: { ...(persisted.options.fuelProfiles ?? {}) }
    }
  };
};

export const createAppRuntime = (): AppRuntime => {
  const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
  const ctx = canvas.getContext("2d");
  
  if (!ctx) {
    throw new Error("Canvas not supported");
  }
  
  const baseCanvasWidth = canvas.width;
  const baseCanvasHeight = canvas.height;
  const gridScale = MAP_SCALE;
  const buildGrid = (mapSize: MapSizeId) => {
    const size = MAP_SIZE_PRESETS[mapSize];
    return {
      cols: size,
      rows: size,
      totalTiles: size * size
    };
  };
  let activeMapSize: MapSizeId = DEFAULT_MAP_SIZE;
  const grid = buildGrid(activeMapSize);
  
  const params = new URLSearchParams(window.location.search);
  const selectedRenderBackend: RenderBackend = resolveRenderBackend(params);
  const legacy2dEnabled = selectedRenderBackend === "legacy2d";
  const seedParam = params.get("seed");
  const initialSeed = seedParam && !Number.isNaN(Number(seedParam)) ? Number(seedParam) : Math.floor(Date.now() % 1000000);
  const headless = params.get("headless") === "1";
  const threeTestNoSim = params.get("nosim") === "1";
  const threeTestSeasonal = params.get("seasonal") !== "0";
  const threeTestNoTerrainSync = params.get("noterrain") === "1";
  if (legacy2dEnabled) {
    console.warn("[render] Legacy 2D renderer is deprecated. Prefer 3D mode.");
  }
  const threeTestDprCap = (() => {
    const raw = Number(params.get("dpr"));
    if (!Number.isFinite(raw)) {
      return 1.5;
    }
    return Math.max(0.5, Math.min(4, raw));
  })();
  const frameCapFps = (() => {
    const raw = Number(params.get("fps"));
    if (!Number.isFinite(raw)) {
      return 60;
    }
    return Math.max(30, Math.min(120, raw > 0 ? raw : 60));
  })();
  
  const state = createInitialState(initialSeed, grid);
  const inputState = createInputState();
  const renderState = createRenderState(state.grid);
  const effectsState = createEffectsState();
  const uiState = createUiState();
  const gameEvents = createGameEventBus();
  const rng = new RNG(initialSeed);
  const persistedFuelProfiles = loadFuelProfileOverrides();
  const persistedLastRunConfig = loadLastRunConfig();
  const uiAudio = createUiAudioController();
  const musicController = createMusicController();
  type HudMusicSettings = { muted: boolean; volume: number };
  const clampMusic01 = (value: number): number => Math.max(0, Math.min(1, value));
  const hudMusicListeners = new Set<(settings: HudMusicSettings) => void>();
  const persistedMusicSettings = loadMusicAudioSettings();
  let musicMutedByUser = persistedMusicSettings.muted;
  let musicVolume = clampMusic01(persistedMusicSettings.volume);
  const getHudMusicSettings = (): HudMusicSettings => ({ muted: musicMutedByUser, volume: musicVolume });
  const saveHudMusicSettings = (): void => {
    saveMusicAudioSettings(getHudMusicSettings());
  };
  const notifyHudMusicSettings = (): void => {
    const snapshot = getHudMusicSettings();
    hudMusicListeners.forEach((listener) => listener(snapshot));
  };
  const applyMusicOutputState = (): void => {
    musicController.setVolume(musicVolume);
    musicController.setMuted(document.hidden || musicMutedByUser);
  };
  applyMusicOutputState();
  const musicControls = {
    getSettings: getHudMusicSettings,
    setMuted: (muted: boolean): void => {
      const nextMuted = Boolean(muted);
      if (musicMutedByUser === nextMuted) {
        return;
      }
      musicMutedByUser = nextMuted;
      applyMusicOutputState();
      saveHudMusicSettings();
      notifyHudMusicSettings();
    },
    toggleMuted: (): void => {
      musicControls.setMuted(!musicMutedByUser);
    },
    setVolume: (value: number): void => {
      const nextVolume = clampMusic01(value);
      if (Math.abs(musicVolume - nextVolume) < 0.0001) {
        return;
      }
      musicVolume = nextVolume;
      applyMusicOutputState();
      saveHudMusicSettings();
      notifyHudMusicSettings();
    },
    onChange: (listener: (settings: HudMusicSettings) => void): (() => void) => {
      hudMusicListeners.add(listener);
      listener(getHudMusicSettings());
      return () => {
        hudMusicListeners.delete(listener);
      };
    }
  };
  
  setGameEventBus(gameEvents);
  
  const persistenceState = { scoreSubmitted: false };
  
  gameEvents.on("overlay:show", (payload) => {
    uiState.overlayTitle = payload.title;
    uiState.overlayMessage = payload.message;
    uiState.overlayDetails = payload.details;
    uiState.overlayAction = payload.action;
    uiState.overlayVisible = true;
  });
  
  gameEvents.on("overlay:hide", () => {
    uiState.overlayVisible = false;
  });
  
  gameEvents.on("game:over", (payload) => {
    if (persistenceState.scoreSubmitted) {
      return;
    }
    const callsign = state.campaign.callsign.trim() || "Chief";
    saveLeaderboard({ name: callsign, score: payload.score, seed: payload.seed, date: Date.now() });
    persistenceState.scoreSubmitted = true;
    musicController.setGameOver(payload.victory ? "victory" : "defeat");
  });
  const buildTreeTypeMap = (): Uint8Array => {
    const result = new Uint8Array(state.grid.totalTiles);
    result.fill(255);
    if (!state.tiles || state.tiles.length === 0) {
      return result;
    }
    for (let i = 0; i < state.tiles.length; i += 1) {
      const tile = state.tiles[i];
      if (!tile) {
        continue;
      }
      const treeType = tile.treeType ?? tile.dominantTreeType;
      result[i] = treeType ? TREE_TYPE_IDS[treeType] : 255;
    }
    return result;
  };
  const appRoot = document.getElementById("app") as HTMLDivElement | null;
  const phaseUiRoot = document.getElementById("phaseUI") as HTMLDivElement | null;
  const phaseUi = phaseUiRoot ? initPhaseUI(phaseUiRoot) : null;
  const phaseUiOriginalParent = phaseUiRoot?.parentNode ?? null;
  const phaseUiOriginalNextSibling = phaseUiRoot?.nextSibling ?? null;
  const overlayRefs = getOverlayRefs();
  buildMapGenControls();
  const characterScreen = document.getElementById("characterScreen") as HTMLDivElement;
  const startMenu = document.getElementById("startMenu") as HTMLDivElement | null;
  const startNewRunButton = document.getElementById("startNewRun") as HTMLButtonElement | null;
  const canvasWrap = canvas.parentElement as HTMLElement | null;
  const mapgenOverlay = document.getElementById("mapgenOverlay") as HTMLDivElement | null;
  const mapgenMessage = document.getElementById("mapgenMessage") as HTMLDivElement | null;
  const mapgenProgressBar = document.getElementById("mapgenProgressBar") as HTMLDivElement | null;
  const mapgenPercent = document.getElementById("mapgenPercent") as HTMLDivElement | null;
  const threeTestOverlay = document.getElementById("threeTestOverlay") as HTMLDivElement | null;
  const threeTestPhaseHudMount = document.getElementById("threeTestPhaseHudMount") as HTMLDivElement | null;
  const threeTestCanvas = document.getElementById("threeTestCanvas") as HTMLCanvasElement | null;
  const threeTestEndRunButton = document.getElementById("threeTestEndRun") as HTMLButtonElement | null;
  const isMenuActive = (): boolean =>
    (startMenu ? !startMenu.classList.contains("hidden") : false) || !characterScreen.classList.contains("hidden");
  const syncMusicContext = (): void => {
    if (headless) {
      return;
    }
    applyMusicOutputState();
    musicController.unlock();
    const menuActive = isMenuActive();
    musicController.setMenuActive(menuActive);
    if (!menuActive && !state.gameOver) {
      musicController.setPhase(state.phase);
    }
  };
  const DEBUG_TYPE_EVENT = "debug-type-colors-changed";
  const CLIMATE_SEASONS = ["Winter", "Spring", "Summer", "Autumn"] as const;
  const ENABLE_THREE_TEST_SEASONAL_RECOLOR = threeTestSeasonal;
  type ThreeTestSeasonMode = "auto" | "manual";
  type ActiveRenderMode = "2d" | "3d";
  const THREE_TEST_VISUAL_EPSILON = 0.0005;
  type PerfStat = { last: number; avg: number; max: number; samples: number; updatedAt: number };
  const PERF_OVERLAY_REFRESH_MS = 220;
  const PERF_CONSOLE_INTERVAL_MS = 2000;
  const PERF_EMA_ALPHA = 0.18;
  const MAIN_HITCH_THRESHOLD_MS = 45;
  let resizeObserver: ResizeObserver | null = null;
  let lastCanvasWidth = 0;
  let lastCanvasHeight = 0;
  const resizeCanvasToWrap = (): void => {
    if (!canvasWrap) {
      return;
    }
    const rect = canvasWrap.getBoundingClientRect();
    const nextWidth = Math.max(1, Math.floor(rect.width));
    const nextHeight = Math.max(1, Math.floor(rect.height));
    if (lastCanvasWidth !== nextWidth || lastCanvasHeight !== nextHeight) {
      lastCanvasWidth = nextWidth;
      lastCanvasHeight = nextHeight;
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }
  };
  const watchCanvasSize = (): void => {
    if (!canvasWrap) {
      return;
    }
    resizeCanvasToWrap();
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(() => resizeCanvasToWrap());
      resizeObserver.observe(canvasWrap);
    } else {
      window.addEventListener("resize", resizeCanvasToWrap);
    }
  };
  
  let isGenerating = false;
  const titleScreenEnabled = ENABLE_TITLE_SCREEN && !headless;
  let titleScreenVisible = false;
  let titleScreen: TitleScreenHandle | null = null;
  const showMapgenOverlay = (): void => {
    if (!mapgenOverlay) {
      return;
    }
    mapgenOverlay.classList.remove("hidden");
  };
  const hideMapgenOverlay = (): void => {
    if (!mapgenOverlay) {
      return;
    }
    mapgenOverlay.classList.add("hidden");
  };
  const updateMapgenOverlay = (message: string, progress: number): void => {
    if (!mapgenOverlay || !mapgenMessage || !mapgenProgressBar || !mapgenPercent) {
      return;
    }
    const clamped = Math.min(1, Math.max(0, progress));
    mapgenMessage.textContent = message;
    mapgenProgressBar.style.width = `${Math.round(clamped * 100)}%`;
    mapgenPercent.textContent = `${Math.round(clamped * 100)}%`;
  };
  
  let threeTestController: ReturnType<typeof createThreeTest> | null = null;
  let phaseUiDisposer: (() => void) | null = null;
  let threeTestStepController: {
    waitForStep: () => Promise<void>;
    next: () => void;
    setAuto: (auto: boolean) => void;
    auto: boolean;
  } | null = null;
  let threeTestUiListener: ((snapshot: GameUiSnapshot) => void) | null = null;
  let threeTestSeasonMode: ThreeTestSeasonMode = "auto";
  let threeTestManualSeasonT01 = 0.5;
  let lastThreeTestSeasonT01 = Number.NaN;
  let lastThreeTestRisk01 = Number.NaN;
  let lastThreeTestSeasonMode = "";
  let lastThreeTestUiSeasonT01 = Number.NaN;
  let lastThreeTestUiSeasonMode = "";
  let lastThreeTestTerrainTypeRevision = -1;
  let lastThreeTestStructureRevision = -1;
  let lastThreeTestDebugTypeColors = false;
  let cachedThreeTestTreeTypeMap: Uint8Array | null = null;
  let savedThreeTestSmokeRate: number | null = null;
  let activeRenderMode: ActiveRenderMode = legacy2dEnabled ? "2d" : "3d";
  const perfStats = new Map<string, PerfStat>();
  const perfOverlay = document.createElement("pre");
  let perfOverlayVisible = params.get("perf") === "1";
  const perfConsoleAlways = params.get("perflog") === "1";
  let lastPerfOverlayUpdate = 0;
  let lastPerfConsoleLog = 0;
  type LongTaskStats = { count: number; totalMs: number; maxMs: number; lastMs: number; lastAt: number; lastDetail: string };
  const longTaskStats: LongTaskStats = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0, lastAt: 0, lastDetail: "n/a" };
  
  const setRenderMode = (mode: ActiveRenderMode): void => {
    if (!legacy2dEnabled && mode === "2d") {
      return;
    }
    activeRenderMode = mode;
    const show2d = mode === "2d";
    canvas.classList.toggle("hidden", !show2d);
    phaseUiRoot?.classList.toggle("hidden", !show2d);
    perfStats.clear();
    lastPerfOverlayUpdate = 0;
    lastPerfConsoleLog = 0;
    longTaskStats.count = 0;
    longTaskStats.totalMs = 0;
    longTaskStats.maxMs = 0;
    longTaskStats.lastMs = 0;
    longTaskStats.lastAt = 0;
    longTaskStats.lastDetail = "n/a";
  };
  setRenderMode(activeRenderMode);
  
  const recordPerfSample = (name: string, value: number): void => {
    const now = performance.now();
    const next = updatePerfCounter(perfStats.get(name) ?? null, value, now, PERF_EMA_ALPHA);
    perfStats.set(name, next);
  };
  
  const readPerf = (name: string): PerfStat | null => perfStats.get(name) ?? null;
  const readRecentPerf = (name: string, now: number, maxAgeMs = 3000): PerfStat | null => {
    const stat = perfStats.get(name);
    if (!stat) {
      return null;
    }
    if (now - stat.updatedAt > maxAgeMs) {
      return null;
    }
    return stat;
  };
  const formatMs = (value: number | null | undefined): string =>
    typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(2)}ms` : "n/a";
  const formatNum = (value: number | null | undefined): string =>
    typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "n/a";
  const formatInt = (value: number | null | undefined): string =>
    typeof value === "number" && Number.isFinite(value) ? Math.round(value).toString() : "n/a";
  
  const setPerfOverlayVisible = (visible: boolean): void => {
    perfOverlayVisible = visible;
    perfOverlay.style.display = visible ? "block" : "none";
  };
  
  const applyPerfOverlayStyle = (): void => {
    perfOverlay.id = "perfOverlay";
    perfOverlay.style.position = "fixed";
    perfOverlay.style.right = "12px";
    perfOverlay.style.bottom = "12px";
    perfOverlay.style.margin = "0";
    perfOverlay.style.padding = "10px 12px";
    perfOverlay.style.maxWidth = "460px";
    perfOverlay.style.whiteSpace = "pre";
    perfOverlay.style.pointerEvents = "none";
    perfOverlay.style.zIndex = "80";
    perfOverlay.style.color = "#d7f0dd";
    perfOverlay.style.background = "rgba(9, 13, 17, 0.84)";
    perfOverlay.style.border = "1px solid rgba(123, 175, 141, 0.45)";
    perfOverlay.style.borderRadius = "8px";
    perfOverlay.style.font = "12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    perfOverlay.style.boxShadow = "0 8px 20px rgba(0, 0, 0, 0.35)";
    document.body.appendChild(perfOverlay);
    setPerfOverlayVisible(perfOverlayVisible);
  };
  
  const buildPerfOverlayText = (threePerf: ThreeTestPerfSnapshot | null, now: number): string => {
    const mainFrame = readRecentPerf("main.frame", now);
    const mainRafGap = readRecentPerf("main.rafGap", now);
    const mainHitch = readRecentPerf("main.hitch", now);
    const simFrame = readRecentPerf("sim.frame", now);
    const simStep = readRecentPerf("sim.step", now);
    const simSteps = readRecentPerf("sim.steps", now);
    const draw2d = readRecentPerf("2d.draw", now);
    const ui2d = readRecentPerf("2d.ui", now);
    const overlay2d = readRecentPerf("2d.overlay", now);
    const climate3d = readRecentPerf("3d.climateSync", now);
    const terrain3d = readRecentPerf("3d.terrainSync", now);
    const terrainDeferred3d = readRecentPerf("3d.terrainDeferred", now);
    const lines = [
      `Perf (${activeRenderMode.toUpperCase()})  |  Ctrl+Shift+P toggle`,
      `Flags: seasonal=${threeTestSeasonal ? "1" : "0"} nosim=${threeTestNoSim ? "1" : "0"} noterrain=${threeTestNoTerrainSync ? "1" : "0"} dpr=${threeTestDprCap.toFixed(2)} fps=${frameCapFps > 0 ? frameCapFps.toFixed(0) : "off"}`,
      `Main:  ${formatMs(mainFrame?.avg)} avg  ${formatMs(mainFrame?.last)} last  ${formatMs(mainFrame?.max)} max`,
      `Main gap: ${formatMs(mainRafGap?.avg)} avg  ${formatMs(mainRafGap?.last)} last  hitch ${formatMs(mainHitch?.last)}`,
      `Sim:   ${formatMs(simFrame?.avg)} frame  ${formatMs(simStep?.avg)} step  steps/frame ${formatNum(simSteps?.avg)}`
    ];
    if (activeRenderMode === "2d") {
      lines.push(`2D:    draw ${formatMs(draw2d?.avg)}  ui ${formatMs(ui2d?.avg)}  overlay ${formatMs(overlay2d?.avg)}`);
    } else {
      lines.push(
        `3D sync: climate ${formatMs(climate3d?.avg)}  terrain ${formatMs(terrain3d?.avg)}  deferred ${formatNum(terrainDeferred3d?.avg)}`
      );
      if (threePerf) {
        lines.push(`3D frame: ${formatMs(threePerf.frameMs)}  fps ${formatNum(threePerf.fps)}`);
        lines.push(
          `3D slices: scene ${formatMs(threePerf.sceneRenderMs)}  fx ${formatMs(threePerf.fireFxMs)}  hud ${formatMs(threePerf.hudMs)}`
        );
        lines.push(
          `3D misc: controls ${formatMs(threePerf.controlsMs)}  treeBurn ${formatMs(threePerf.treeBurnMs)}  ui ${formatMs(threePerf.uiRenderMs)}`
        );
        lines.push(
          `3D terrain set: avg ${formatMs(threePerf.terrainSetMs)} last ${formatMs(threePerf.terrainSetLastMs)} max ${formatMs(threePerf.terrainSetMaxMs)} n ${formatInt(threePerf.terrainSetCount)}`
        );
        lines.push(
          `3D gap: avg ${formatMs(threePerf.rafGapMs)}  last ${formatMs(threePerf.rafGapLastMs)}  max ${formatMs(threePerf.rafGapMaxMs)}  hitches ${formatInt(threePerf.hitchCount)}`
        );
        lines.push(
          `3D geo: calls ${formatInt(threePerf.sceneCalls)} tri ${formatInt(threePerf.sceneTriangles)} line ${formatInt(threePerf.sceneLines)} pt ${formatInt(threePerf.scenePoints)}`
        );
        lines.push(
          `3D mem: geom ${formatInt(threePerf.memoryGeometries)} tex ${formatInt(threePerf.memoryTextures)} totalCalls ${formatInt(threePerf.totalCalls)}`
        );
        lines.push(
          `3D ctx: loss ${formatInt(threePerf.contextLosses)} restore ${formatInt(threePerf.contextRestores)}`
        );
      }
    }
    if (longTaskStats.count > 0 && now - longTaskStats.lastAt < 60000) {
      lines.push(
        `LongTask: n ${longTaskStats.count} last ${formatMs(longTaskStats.lastMs)} max ${formatMs(longTaskStats.maxMs)} src ${longTaskStats.lastDetail}`
      );
    }
    return lines.join("\n");
  };
  
  const maybeUpdatePerfDiagnostics = (now: number): void => {
    const threePerf = activeRenderMode === "3d" ? threeTestController?.getPerfSnapshot() ?? null : null;
    if (threePerf) {
      recordPerfSample("3d.frame", threePerf.frameMs);
      recordPerfSample("3d.scene", threePerf.sceneRenderMs);
      recordPerfSample("3d.fx", threePerf.fireFxMs);
      recordPerfSample("3d.hud", threePerf.hudMs);
      recordPerfSample("3d.controls", threePerf.controlsMs);
      recordPerfSample("3d.treeBurn", threePerf.treeBurnMs);
      recordPerfSample("3d.uiRender", threePerf.uiRenderMs);
    }
    if (perfOverlayVisible && now - lastPerfOverlayUpdate >= PERF_OVERLAY_REFRESH_MS) {
      perfOverlay.textContent = buildPerfOverlayText(threePerf, now);
      lastPerfOverlayUpdate = now;
    }
    if ((perfOverlayVisible || perfConsoleAlways) && now - lastPerfConsoleLog >= PERF_CONSOLE_INTERVAL_MS) {
      if (activeRenderMode === "3d") {
        const mainAvg = readRecentPerf("main.frame", now)?.avg ?? 0;
        const simAvg = readRecentPerf("sim.frame", now)?.avg ?? 0;
        const climateAvg = readRecentPerf("3d.climateSync", now)?.avg ?? 0;
        const terrainAvg = readRecentPerf("3d.terrainSync", now)?.avg ?? 0;
        const terrainDeferred = readRecentPerf("3d.terrainDeferred", now)?.avg ?? 0;
        const threeFrame = readRecentPerf("3d.frame", now)?.avg ?? 0;
        const threeScene = readRecentPerf("3d.scene", now)?.avg ?? 0;
        const threeFx = readRecentPerf("3d.fx", now)?.avg ?? 0;
        const threeHud = readRecentPerf("3d.hud", now)?.avg ?? 0;
        const sceneCalls = threePerf?.sceneCalls ?? 0;
        const sceneTriangles = threePerf?.sceneTriangles ?? 0;
        const contextLosses = threePerf?.contextLosses ?? 0;
        const contextRestores = threePerf?.contextRestores ?? 0;
        const mainGap = readRecentPerf("main.rafGap", now)?.avg ?? 0;
        const hitch = readRecentPerf("main.hitch", now)?.last ?? 0;
        const terrainSetLast = threePerf?.terrainSetLastMs ?? 0;
        const terrainSetMax = threePerf?.terrainSetMaxMs ?? 0;
        const terrainSetCount = threePerf?.terrainSetCount ?? 0;
        console.log(
          `[perf] mode=3d main=${mainAvg.toFixed(2)}ms sim=${simAvg.toFixed(2)}ms ` +
            `seasonal=${threeTestSeasonal ? 1 : 0} ` +
            `nosim=${threeTestNoSim ? 1 : 0} ` +
            `noterrain=${threeTestNoTerrainSync ? 1 : 0} ` +
            `gap=${mainGap.toFixed(2)}ms hitch=${hitch.toFixed(2)}ms ` +
            `sync(climate=${climateAvg.toFixed(2)} terrain=${terrainAvg.toFixed(2)} defer=${terrainDeferred.toFixed(2)}) ` +
            `3dFrame=${threeFrame.toFixed(2)}ms scene=${threeScene.toFixed(2)} sceneLast=${(threePerf?.sceneRenderLastMs ?? 0).toFixed(2)} ` +
            `gap3d=${(threePerf?.rafGapLastMs ?? 0).toFixed(2)} terrainSetLast=${terrainSetLast.toFixed(2)} terrainSetMax=${terrainSetMax.toFixed(2)} terrainSetN=${Math.round(terrainSetCount)} ` +
            `fx=${threeFx.toFixed(2)} hud=${threeHud.toFixed(2)} ctxLoss=${Math.round(contextLosses)} ctxRestore=${Math.round(contextRestores)} ` +
            `calls=${Math.round(sceneCalls)} tri=${Math.round(sceneTriangles)}`
        );
      } else {
        const mainAvg = readRecentPerf("main.frame", now)?.avg ?? 0;
        const simAvg = readRecentPerf("sim.frame", now)?.avg ?? 0;
        const drawAvg = readRecentPerf("2d.draw", now)?.avg ?? 0;
        const uiAvg = readRecentPerf("2d.ui", now)?.avg ?? 0;
        const overlayAvg = readRecentPerf("2d.overlay", now)?.avg ?? 0;
        const mainGap = readRecentPerf("main.rafGap", now)?.avg ?? 0;
        const hitch = readRecentPerf("main.hitch", now)?.last ?? 0;
        console.log(
          `[perf] mode=2d main=${mainAvg.toFixed(2)}ms sim=${simAvg.toFixed(2)}ms ` +
            `seasonal=${threeTestSeasonal ? 1 : 0} ` +
            `nosim=${threeTestNoSim ? 1 : 0} ` +
            `noterrain=${threeTestNoTerrainSync ? 1 : 0} ` +
            `gap=${mainGap.toFixed(2)}ms hitch=${hitch.toFixed(2)}ms ` +
            `draw=${drawAvg.toFixed(2)}ms ui=${uiAvg.toFixed(2)}ms overlay=${overlayAvg.toFixed(2)}ms`
        );
      }
      lastPerfConsoleLog = now;
    }
  };
  
  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
  
  const getSeasonLabelFromT01 = (seasonT01: number): string => {
    const wrapped = ((seasonT01 % 1) + 1) % 1;
    const index = Math.min(3, Math.floor(wrapped * 4));
    return CLIMATE_SEASONS[index] ?? "Season";
  };
  
  const getClimateSeasonT01 = (): number => {
    const yearDays = Math.max(1, Math.floor(VIRTUAL_CLIMATE_PARAMS.seasonLen));
    const dayInYear = ((state.careerDay % yearDays) + yearDays) % yearDays;
    return clamp01(dayInYear / yearDays);
  };
  
  const getClimateRisk01 = (): number => {
    const ignitionRange = Math.max(0.0001, CLIMATE_IGNITION_MAX - CLIMATE_IGNITION_MIN);
    const ignitionNorm = clamp01((state.climateIgnitionMultiplier - CLIMATE_IGNITION_MIN) / ignitionRange);
    const spreadNorm = clamp01((state.climateSpreadMultiplier - 0.6) / 1.4);
    return clamp01(0.55 * ignitionNorm + 0.45 * spreadNorm);
  };

  const updateThreeTestSeasonUi = (seasonT01: number, mode: ThreeTestSeasonMode): number => {
    const clamped = clamp01(seasonT01);
    const label = getSeasonLabelFromT01(clamped);
    if (ENABLE_THREE_TEST_SEASONAL_RECOLOR) {
      threeTestController?.setSeasonLabel(`Season: ${label} (${mode.toUpperCase()})`);
    } else {
      threeTestController?.setSeasonLabel("Seasonal visuals disabled");
    }
    return clamped;
  };
  
  const getThreeTestTreeTypeMap = (forceRefresh = false): Uint8Array => {
    const needsBuild =
      forceRefresh ||
      !cachedThreeTestTreeTypeMap ||
      cachedThreeTestTreeTypeMap.length !== state.grid.totalTiles;
    if (needsBuild) {
      cachedThreeTestTreeTypeMap = buildTreeTypeMap();
    }
    return cachedThreeTestTreeTypeMap!;
  };
  
  const buildThreeTestSample = (fastUpdate = false) => {
    const sample = buildRenderTerrainSample(
      state,
      getThreeTestTreeTypeMap(!fastUpdate),
      inputState.debugTypeColors,
      true,
      fastUpdate,
      true
    );
    // Climate tinting is shader-driven in 3D; avoid terrain texture rebuild pressure from moisture deltas.
    sample.tileMoisture = undefined;
    sample.climateDryness = undefined;
    return sample;
  };
  
  const THREE_TEST_TERRAIN_COOLDOWN_MS = 600;
  const THREE_TEST_TERRAIN_COOLDOWN_ACTIVE_FIRE_MS = 90;
  let lastThreeTestTerrainSync = 0;
  const hasActiveFireTerrainPressure = (): boolean =>
    state.phase === "fire" || state.lastActiveFires > 0 || state.fireBoundsActive;
  
  const syncThreeTestTerrain = (
    force = false,
    reason: "terrain" | "debug" | "initial" | "climate" = "terrain"
  ): void => {
    const startedAt = performance.now();
    try {
      if (!threeTestController) {
        return;
      }
      if (reason === "climate") {
        console.warn("[threeTest] climate-only visual update attempted terrain rebuild; request ignored.");
        return;
      }
      const nextTypeRevision = state.terrainTypeRevision;
      const nextStructureRevision = state.structureRevision;
      const debugChanged = lastThreeTestDebugTypeColors !== inputState.debugTypeColors;
      const structuresChanged = nextStructureRevision !== lastThreeTestStructureRevision;
      if (!force && !debugChanged && !structuresChanged && nextTypeRevision === lastThreeTestTerrainTypeRevision) {
        state.terrainDirty = false;
        return;
      }
      const now = performance.now();
      const cooldownMs =
        hasActiveFireTerrainPressure()
          ? THREE_TEST_TERRAIN_COOLDOWN_ACTIVE_FIRE_MS
          : THREE_TEST_TERRAIN_COOLDOWN_MS;
      if (!force && !structuresChanged && now - lastThreeTestTerrainSync < cooldownMs) {
        return;
      }
      lastThreeTestTerrainSync = now;
      ensureTileSoA(state);
      threeTestController.setTerrain(buildThreeTestSample(!force));
      lastThreeTestTerrainTypeRevision = nextTypeRevision;
      lastThreeTestStructureRevision = nextStructureRevision;
      lastThreeTestDebugTypeColors = inputState.debugTypeColors;
      state.terrainDirty = false;
    } finally {
      recordPerfSample("3d.terrainSync", performance.now() - startedAt);
    }
  };
  
  const syncThreeTestClimateVisuals = (): void => {
    const startedAt = performance.now();
    try {
      if (!threeTestController) {
        return;
      }
      const autoSeasonT01 = getClimateSeasonT01();
      const seasonT01 = threeTestSeasonMode === "manual" ? threeTestManualSeasonT01 : autoSeasonT01;
      const uiSeasonChanged =
        !Number.isFinite(lastThreeTestUiSeasonT01) ||
        Math.abs(seasonT01 - lastThreeTestUiSeasonT01) >= THREE_TEST_VISUAL_EPSILON ||
        lastThreeTestUiSeasonMode !== threeTestSeasonMode;
      if (uiSeasonChanged) {
        updateThreeTestSeasonUi(seasonT01, threeTestSeasonMode);
        lastThreeTestUiSeasonT01 = seasonT01;
        lastThreeTestUiSeasonMode = threeTestSeasonMode;
      }
      if (!ENABLE_THREE_TEST_SEASONAL_RECOLOR) {
        return;
      }
      const risk01 = getClimateRisk01();
      const seasonChanged = !Number.isFinite(lastThreeTestSeasonT01) || Math.abs(seasonT01 - lastThreeTestSeasonT01) >= THREE_TEST_VISUAL_EPSILON;
      const riskChanged = !Number.isFinite(lastThreeTestRisk01) || Math.abs(risk01 - lastThreeTestRisk01) >= THREE_TEST_VISUAL_EPSILON;
      const modeChanged = lastThreeTestSeasonMode !== threeTestSeasonMode;
      if (seasonChanged || riskChanged || modeChanged) {
        threeTestController.setSeasonVisualState({
          seasonT01,
          risk01,
          mode: threeTestSeasonMode,
          manualSeasonT01: threeTestManualSeasonT01
        });
        lastThreeTestSeasonT01 = seasonT01;
        lastThreeTestRisk01 = risk01;
        lastThreeTestSeasonMode = threeTestSeasonMode;
      }
    } finally {
      recordPerfSample("3d.climateSync", performance.now() - startedAt);
    }
  };
  
  const handleThreeResize = (): void => {
    threeTestController?.resize();
  };

  const mountPhaseUiIntoThreeTest = (): void => {
    if (!phaseUiRoot || !threeTestPhaseHudMount) {
      return;
    }
    phaseUiRoot.classList.remove("hidden");
    phaseUiRoot.classList.add("phase-ui-root--three-test");
    if (phaseUiRoot.parentNode !== threeTestPhaseHudMount) {
      threeTestPhaseHudMount.appendChild(phaseUiRoot);
    }
  };

  const restorePhaseUiMount = (): void => {
    if (!phaseUiRoot || !phaseUiOriginalParent) {
      return;
    }
    phaseUiRoot.classList.remove("phase-ui-root--three-test");
    if (phaseUiRoot.parentNode === phaseUiOriginalParent) {
      return;
    }
    if (phaseUiOriginalNextSibling && phaseUiOriginalNextSibling.parentNode === phaseUiOriginalParent) {
      phaseUiOriginalParent.insertBefore(phaseUiRoot, phaseUiOriginalNextSibling);
      return;
    }
    phaseUiOriginalParent.appendChild(phaseUiRoot);
  };
  
  const setThreeTestVisible = (visible: boolean): void => {
    if (!threeTestOverlay) {
      return;
    }
    setRenderMode(visible ? "3d" : "2d");
    if (visible) {
      mountPhaseUiIntoThreeTest();
    } else {
      restorePhaseUiMount();
    }
    threeTestOverlay.classList.toggle("hidden", !visible);
    threeTestOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
  };
  
  const prepareTerrainPreview = async (config: NewRunConfig, debug?: MapGenDebug): Promise<void> => {
    if (isGenerating) {
      return;
    }
    isGenerating = true;
    const { seed, mapSize } = config;
    try {
      if (activeMapSize !== mapSize) {
        activeMapSize = mapSize;
        state.grid = buildGrid(mapSize);
        syncRenderState(renderState, state.grid);
      }
      resetTerrainCaches();
      resetState(state, seed);
      rng.setState(seed);
      state.paused = true;
      setFuelProfiles(config.options.fuelProfiles);
      showMapgenOverlay();
      updateMapgenOverlay("Building terrain preview...", 0);
      await generateMap(
        state,
        rng,
        (message, progress) => updateMapgenOverlay(message, progress),
        config.options.mapGen,
        debug
      );
    } finally {
      hideMapgenOverlay();
      isGenerating = false;
      state.paused = true;
    }
  };
  
  const preloadThreeTestAssets = async (): Promise<void> => {
    if (getTreeAssetsCache() && getHouseAssetsCache() && getFirestationAssetCache()) {
      return;
    }
    const startedAt = performance.now();
    showMapgenOverlay();
    updateMapgenOverlay("Loading 3D assets...", 0);
    const tasks: Array<{ label: string; run: () => Promise<unknown> }> = [
      { label: "trees", run: () => loadTreeAssets() },
      { label: "houses", run: () => loadHouseAssets() },
      { label: "firestation", run: () => loadFirestationAsset() }
    ];
    let completed = 0;
    const updateProgress = (label: string): void => {
      completed += 1;
      const progress = completed / tasks.length;
      updateMapgenOverlay(`Loading 3D assets (${label})...`, progress);
    };
    try {
      await Promise.all(
        tasks.map(async (task) => {
          try {
            await task.run();
          } catch (error) {
            console.warn(`[threeTest] Failed to preload ${task.label} asset(s).`, error);
          } finally {
            updateProgress(task.label);
          }
        })
      );
    } finally {
      hideMapgenOverlay();
      recordPerfSample("3d.assetPreload", performance.now() - startedAt);
    }
  };
  
  const openThreeTest = async (config: NewRunConfig): Promise<void> => {
    if (!threeTestOverlay || !threeTestCanvas) {
      return;
    }
    console.info(
      `[threeTest] opening 3D mode with flags seasonal=${ENABLE_THREE_TEST_SEASONAL_RECOLOR ? 1 : 0} ` +
        `nosim=${threeTestNoSim ? 1 : 0} noterrain=${threeTestNoTerrainSync ? 1 : 0} dpr=${threeTestDprCap.toFixed(2)} fps=${frameCapFps > 0 ? frameCapFps.toFixed(0) : "off"}`
    );
    await preloadThreeTestAssets();
    if (savedThreeTestSmokeRate === null) {
      savedThreeTestSmokeRate = state.simPerf.smokeRate;
    }
    state.simPerf.smokeRate = 0;
    effectsState.smokeParticles.length = 0;
    effectsState.waterParticles.length = 0;
    if (!threeTestController) {
      threeTestController = createThreeTest(
        threeTestCanvas,
        asRenderSim(state),
        inputState,
        effectsState,
        uiAudio,
        musicControls
      );
    }
    if (threeTestController) {
      threeTestController.setBaseCardOpen(false);
    }
    if (threeTestController) {
      threeTestController.setClimateForecast(null, 0, 0, 0, null);
    }
    threeTestSeasonMode = "auto";
    threeTestManualSeasonT01 = getClimateSeasonT01();
    lastThreeTestSeasonT01 = Number.NaN;
    lastThreeTestRisk01 = Number.NaN;
    lastThreeTestSeasonMode = "";
    lastThreeTestUiSeasonT01 = Number.NaN;
    lastThreeTestUiSeasonMode = "";
    lastThreeTestTerrainTypeRevision = -1;
    lastThreeTestStructureRevision = -1;
    lastThreeTestDebugTypeColors = inputState.debugTypeColors;
    cachedThreeTestTreeTypeMap = null;
    updateThreeTestSeasonUi(threeTestManualSeasonT01, threeTestSeasonMode);
    if (!threeTestStepController) {
      let auto = true;
      let resolver: (() => void) | null = null;
      threeTestStepController = {
        get auto() {
          return auto;
        },
        waitForStep: async () => {
          if (auto) {
            return;
          }
          await new Promise<void>((resolve) => {
            resolver = resolve;
          });
        },
        next: () => {
          if (resolver) {
            const resolve = resolver;
            resolver = null;
            resolve();
          }
        },
        setAuto: (value: boolean) => {
          auto = value;
          if (auto) {
            if (resolver) {
              const resolve = resolver;
              resolver = null;
              resolve();
            }
          }
        }
      };
    }
    threeTestStepController.setAuto(true);
    const previewDuringMapgen = state.tiles.length === 0;
    setThreeTestVisible(true);
    handleThreeResize();
    window.addEventListener("resize", handleThreeResize);
    if (previewDuringMapgen) {
      threeTestController.start();
    }
    if (state.tiles.length === 0) {
      const debug: MapGenDebug = {
        onPhase: async (snapshot: MapGenDebugSnapshot) => {
          if (!threeTestController) {
            return;
          }
          threeTestController.setPhaseLabel(`Phase: ${snapshot.phase}`);
          threeTestController.setTerrain({
            cols: state.grid.cols,
            rows: state.grid.rows,
            elevations: snapshot.elevations,
            tileTypes: snapshot.tileTypes,
            treeTypes: buildTreeTypeMap(),
            riverMask: snapshot.riverMask,
            debugTypeColors: inputState.debugTypeColors,
            treesEnabled:
              snapshot.phase === "biome:spread" ||
              snapshot.phase === "biome:classify" ||
              snapshot.phase === "reconcile:postSettlement" ||
              snapshot.phase === "map:finalize",
            worldSeed: state.seed
          });
        },
        waitForStep: () => threeTestStepController?.waitForStep() ?? Promise.resolve()
      };
      await prepareTerrainPreview(config, debug);
      syncTileSoA(state);
    }
    syncThreeTestTerrain(true, "initial");
    if (ENABLE_THREE_TEST_SEASONAL_RECOLOR) {
      syncThreeTestClimateVisuals();
    } else {
      updateThreeTestSeasonUi(threeTestManualSeasonT01, threeTestSeasonMode);
    }
    threeTestController.prime();
    if (!previewDuringMapgen) {
      threeTestController.start();
    }
  };
  
  const closeThreeTest = (force = false): void => {
    if (!legacy2dEnabled && !force) {
      return;
    }
    if (!threeTestOverlay) {
      return;
    }
    if (savedThreeTestSmokeRate !== null) {
      state.simPerf.smokeRate = savedThreeTestSmokeRate;
      savedThreeTestSmokeRate = null;
    }
    setThreeTestVisible(false);
    threeTestController?.stop();
    window.removeEventListener("resize", handleThreeResize);
    threeTestStepController?.setAuto(true);
    if (phaseUi && threeTestUiListener) {
      phaseUi.state.off("change", threeTestUiListener);
      threeTestUiListener = null;
    }
  };

  const returnToStartMenu = (): void => {
    closeThreeTest(true);
    uiState.overlayVisible = false;
    uiState.overlayAction = "dismiss";
    updateOverlay(overlayRefs, uiState);
    characterScreen.classList.add("hidden");
    startMenu?.classList.remove("hidden");
    state.paused = true;
    setStatus(state, "Run ended. Ready to start a new run.");
    syncMusicContext();
  };

  const destroyTitleScreen = (): void => {
    titleScreen?.destroy();
    titleScreen = null;
    titleScreenVisible = false;
  };

  const requestQuit = (): void => {
    const electronWindow = window as Window & {
      electronAPI?: ElectronBridge;
      ipcRenderer?: ElectronBridge;
      require?: (name: string) => unknown;
    };
    if (callQuitBridge(electronWindow.electronAPI)) {
      return;
    }
    if (callQuitBridge(electronWindow.ipcRenderer)) {
      return;
    }
    if (typeof electronWindow.require === "function") {
      try {
        const electronModule = electronWindow.require("electron") as { ipcRenderer?: ElectronBridge } | undefined;
        if (callQuitBridge(electronModule?.ipcRenderer)) {
          return;
        }
      } catch {
        // Ignore require failures in browser mode.
      }
    }
    if (!window.confirm("Quit EMBERWATCH and close this window?")) {
      return;
    }
    window.close();
  };

  const showTitleScreen = (): void => {
    if (!titleScreenEnabled || titleScreen) {
      return;
    }
    const mount = appRoot ?? document.body;
    titleScreenVisible = true;
    titleScreen = mountTitleScreen({
      mount,
      audioControls: {
        sfx: uiAudio,
        music: {
          getSettings: musicControls.getSettings,
          setMuted: musicControls.setMuted,
          setVolume: musicControls.setVolume,
          onChange: musicControls.onChange
        }
      },
      onNewGame: () => {
        destroyTitleScreen();
        if (phaseUi && startNewRunButton) {
          startNewRunButton.click();
          return;
        }
        startMenu?.classList.remove("hidden");
        state.paused = true;
        syncMusicContext();
      },
      onQuit: () => requestQuit()
    });
    state.paused = true;
    syncMusicContext();
  };
  
  const refreshThreeTestDebug = (): void => {
    if (!threeTestOverlay || threeTestOverlay.classList.contains("hidden")) {
      return;
    }
    if (!threeTestController) {
      return;
    }
    syncThreeTestTerrain(true, "debug");
  };
  
  const resetGame = async (config: NewRunConfig) => {
    if (isGenerating) {
      return;
    }
    isGenerating = true;
    const { seed, mapSize, characterId, callsign } = config;
    try {
      resetInputState(inputState);
      resetEffectsState(effectsState);
      resetUiState(uiState);
      persistenceState.scoreSubmitted = false;
      musicController.clearGameOver();
      if (activeMapSize !== mapSize) {
        activeMapSize = mapSize;
        state.grid = buildGrid(mapSize);
        syncRenderState(renderState, state.grid);
      }
      resetTerrainCaches();
      resetState(state, seed);
      state.fireSettings = normalizeFireSettings(config.options.fire);
      setFuelProfiles(config.options.fuelProfiles);
      state.campaign.characterId = characterId;
      state.campaign.callsign = callsign;
      const baseBudget = getCharacterBaseBudget(state.campaign.characterId, BASE_BUDGET);
      state.budget = baseBudget;
      state.pendingBudget = baseBudget;
      randomizeWind(state, rng);
      rng.setState(seed);
      state.paused = true;
      showMapgenOverlay();
      updateMapgenOverlay("Reticulating splines...", 0);
      await generateMap(state, rng, (message, progress) => {
        updateMapgenOverlay(message, progress);
      }, config.options.mapGen);
      state.paused = false;
    } finally {
      hideMapgenOverlay();
      isGenerating = false;
    }
    seedStartingRoster(state, rng);
    initScoringForRun(state);
    renderState.cameraCenter = { x: state.basePoint.x + 0.5, y: state.basePoint.y + 0.5 };
    const maintenanceIndex = PHASES.findIndex((phase) => phase.id === "maintenance");
    state.phaseIndex = maintenanceIndex >= 0 ? maintenanceIndex : 1;
    setPhase(state, rng, "maintenance");
    syncMusicContext();
    phaseUi?.sync(state, inputState);
    updateOverlay(overlayRefs, uiState);
  };
  
  const defaultRunConfig: NewRunConfig = {
    seed: initialSeed,
    mapSize: activeMapSize,
    options: {
      ...DEFAULT_RUN_OPTIONS,
      mapGen: { ...DEFAULT_RUN_OPTIONS.mapGen },
      fire: { ...DEFAULT_RUN_OPTIONS.fire },
      fuelProfiles: { ...persistedFuelProfiles }
    },
    characterId: state.campaign.characterId,
    callsign: state.campaign.callsign
  };
  const initialRunConfig: NewRunConfig = resolveRunConfig(defaultRunConfig, persistedLastRunConfig);

  const renderBackend = createRenderBackend(selectedRenderBackend, {
    renderLegacy2d: (alpha: number) => {
      const stats = renderLegacy2dFrame({
        state,
        inputState,
        uiState,
        effectsState,
        renderState,
        canvas,
        ctx,
        overlayRefs,
        phaseUi,
        alpha
      });
      recordPerfSample("2d.ui", stats.uiMs);
      recordPerfSample("2d.overlay", stats.overlayMs);
      recordPerfSample("2d.draw", stats.drawMs);
    }
  });
  
  if (threeTestEndRunButton) {
    threeTestEndRunButton.addEventListener("click", () => {
      endGame(state, false, "Run ended from 3D test.");
      returnToStartMenu();
    });
  }
  if (threeTestOverlay) {
    threeTestOverlay.addEventListener("click", (event) => {
      if (event.target === threeTestOverlay) {
        closeThreeTest();
      }
    });
  }
  window.addEventListener(DEBUG_TYPE_EVENT, () => refreshThreeTestDebug());
  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey || !event.shiftKey || event.key.toLowerCase() !== "p") {
      return;
    }
    event.preventDefault();
    setPerfOverlayVisible(!perfOverlayVisible);
  });
  
  applyPerfOverlayStyle();
  if (typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
    const longTaskObserver = new PerformanceObserver((list) => {
      const entries = list.getEntries();
      for (let i = 0; i < entries.length; i += 1) {
        const entry = entries[i];
        const duration = Math.max(0, entry.duration || 0);
        if (duration <= 0) {
          continue;
        }
        longTaskStats.count += 1;
        longTaskStats.totalMs += duration;
        longTaskStats.maxMs = Math.max(longTaskStats.maxMs, duration);
        longTaskStats.lastMs = duration;
        longTaskStats.lastAt = performance.now();
        const longTaskEntry = entry as PerformanceEntry & {
          attribution?: Array<{
            name?: string;
            containerType?: string;
            containerSrc?: string;
            scriptURL?: string;
          }>;
        };
        const attribution = longTaskEntry.attribution?.[0];
        const detail =
          attribution?.scriptURL ||
          attribution?.containerType ||
          attribution?.name ||
          (entry.name && entry.name.length > 0 ? entry.name : "unknown");
        longTaskStats.lastDetail = (detail || "unknown").slice(0, 72);
      }
    });
    longTaskObserver.observe({ entryTypes: ["longtask"] });
  }
  watchCanvasSize();
  
  const boot = async () => {
    if (titleScreenEnabled) {
      if (phaseUi) {
        phaseUiDisposer?.();
        phaseUiDisposer = bindPhaseUi({
          phaseUi,
          state,
          inputState,
          uiState,
          renderState,
          rng,
          canvas,
          onNewRun: resetGame,
          onThreeTest: openThreeTest,
          overlayRefs,
          showStartMenuOnBind: false,
          startThreeOnConfirm: !legacy2dEnabled,
          onMinimapPan: (tile) => {
            if (threeTestController) {
              threeTestController.panToTile(tile.x, tile.y);
              return;
            }
            renderState.cameraCenter = { x: tile.x + 0.5, y: tile.y + 0.5 };
          },
          uiAudio,
          musicControls
        });
      }
      startMenu?.classList.add("hidden");
      characterScreen.classList.add("hidden");
      state.paused = true;
      syncMusicContext();
      showTitleScreen();
    } else {
      await resetGame(initialRunConfig);
      if (!headless && phaseUi) {
        phaseUiDisposer?.();
        phaseUiDisposer = bindPhaseUi({
          phaseUi,
          state,
          inputState,
          uiState,
          renderState,
          rng,
          canvas,
          onNewRun: resetGame,
          onThreeTest: openThreeTest,
          overlayRefs,
          showStartMenuOnBind: true,
          startThreeOnConfirm: !legacy2dEnabled,
          onMinimapPan: (tile) => {
            if (threeTestController) {
              threeTestController.panToTile(tile.x, tile.y);
              return;
            }
            renderState.cameraCenter = { x: tile.x + 0.5, y: tile.y + 0.5 };
          },
          uiAudio,
          musicControls
        });
      }
    }
  
    const baseStep = 0.25;
  
    if (headless) {
      const ticks = 10000;
      const step = baseStep;
      for (let i = 0; i < ticks; i += 1) {
        stepSim(state, effectsState, rng, step);
        phaseUi?.sync(state, inputState);
      }
      console.log(`checksum:${computeChecksum(state)}`);
      return;
    }
  
    startAppBootLoop({
      baseStep,
      mainHitchThresholdMs: MAIN_HITCH_THRESHOLD_MS,
      frameCapFps,
      timeSpeedOptions: TIME_SPEED_OPTIONS,
      isGenerating: () => isGenerating,
      isTitleScreenVisible: () => titleScreenVisible,
      isCharacterScreenVisible: () => !characterScreen.classList.contains("hidden"),
      isStartMenuVisible: () => (startMenu ? !startMenu.classList.contains("hidden") : false),
      isDocumentHidden: () => document.hidden,
      isThreeTestVisible: () => activeRenderMode === "3d" && !!threeTestController,
      getTimeSpeedIndex: () => state.timeSpeedIndex,
      isThreeTestNoSim: threeTestNoSim,
      isPausedOrGameOver: () => state.paused || state.gameOver,
      stepSimulation: (simStep: number) => {
        const simStartedAt = performance.now();
        stepSim(state, effectsState, rng, simStep);
        return performance.now() - simStartedAt;
      },
      onThreeTestFrame: (alpha: number) => {
        const uiStartedAt = performance.now();
        phaseUi?.sync(state, inputState);
        recordPerfSample("3d.phaseUi", performance.now() - uiStartedAt);
        const controller = threeTestController;
        controller?.setSimulationAlpha(alpha);
        if (state.gameOver) {
          closeThreeTest();
        }
        if (ENABLE_THREE_TEST_SEASONAL_RECOLOR) {
          syncThreeTestClimateVisuals();
        }
        if (controller && state.terrainDirty) {
          const activeFireTerrainPressure = hasActiveFireTerrainPressure();
          if (threeTestNoTerrainSync) {
            state.terrainDirty = false;
            recordPerfSample("3d.terrainDeferred", 0);
          } else if (controller.isCameraInteracting() && !activeFireTerrainPressure) {
            recordPerfSample("3d.terrainDeferred", 1);
          } else {
            syncThreeTestTerrain();
            recordPerfSample("3d.terrainDeferred", 0);
          }
        }
      },
      render2dFrame: (alpha: number) => {
        renderBackend.frame(alpha);
      },
      recordPerfSample,
      maybeUpdatePerfDiagnostics: (now: number) => {
        syncMusicContext();
        maybeUpdatePerfDiagnostics(now);
      }
    });
  };
  

  const dispose = (): void => {
    destroyTitleScreen();
    closeThreeTest(true);
    renderBackend.dispose();
    phaseUiDisposer?.();
    phaseUiDisposer = null;
    musicController.dispose();
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  };

  return {
    boot,
    resetGame,
    openThreeTest,
    dispose
  };
};






