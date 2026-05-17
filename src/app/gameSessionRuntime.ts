import { BASE_BUDGET, MAP_SIZE_PRESETS } from "../core/config.js";
import type { MapSizeId } from "../core/config.js";
import { DEFAULT_CHIEF_GENDER, getCharacterBaseBudget } from "../core/characters.js";
import { RNG } from "../core/rng.js";
import { computeChecksum, createInitialState, resetState, setStatus, TILE_TYPE_IDS } from "../core/state.js";
import { ensureTileSoA, syncTileSoA } from "../core/tileCache.js";
import { setFuelProfiles } from "../core/tiles.js";
import { TREE_TYPE_IDS } from "../core/types.js";
import { createEffectsState, resetEffectsState } from "../core/effectsState.js";
import { createInputState, resetInputState } from "../core/inputState.js";
import { createUiState, resetUiState } from "../core/uiState.js";
import { createGameEventBus, type GameOverPayload } from "../core/gameEvents.js";
import { CLIMATE_IGNITION_MAX, CLIMATE_IGNITION_MIN, VIRTUAL_CLIMATE_PARAMS } from "../core/climate.js";
import { generateMap, type MapGenDebug, type MapGenDebugSnapshot } from "../mapgen/index.js";
import { createThreeTest, type ThreeTestPerfSnapshot } from "../render/threeTest.js";
import { preloadThreeTestWorldAudioAssets } from "../render/threeTestWorldAudio.js";
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
import { getMapEditorRefs, initMapEditor, type MapEditorHandle } from "../ui/map-editor.js";
import { getOverlayRefs, updateOverlay } from "../ui/overlay.js";
import { createEndRunScreen, type EndRunScreenHandle } from "../ui/end-run/endRunScreen.js";
import { saveLeaderboard } from "../persistence/leaderboard.js";
import { loadFuelProfileOverrides } from "../persistence/fuelProfiles.js";
import { loadLastRunConfig } from "../persistence/lastRunConfig.js";
import { randomizeWind } from "../sim/wind.js";
import {
  endGame,
  getActiveTimeSpeedValue,
  getStrategicFireSimulationStepCap,
  isSimulationEffectivelyPaused,
  setGameEventBus,
  setPhase,
  stepSim
} from "../sim/index.js";
import { initScoringForRun } from "../sim/scoring.js";
import { seedStartingRoster } from "../sim/units.js";
import { PHASES } from "../core/time.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS, DEFAULT_RUN_SEED, normalizeFireSettings } from "../ui/run-config.js";
import type { NewRunConfig } from "../ui/run-config.js";
import { cloneTerrainRecipe, getTerrainHeightScaleMultiplier } from "../mapgen/terrainProfile.js";
import type { GameUiSnapshot } from "../ui/phase/types.js";
import { updatePerfCounter } from "./perfDiagnostics.js";
import { startAppBootLoop } from "./bootLoop.js";
import {
  shouldRebuildThreeTestTreeTypeMap,
  shouldSyncThreeTestTerrain,
  type ThreeTestTerrainRevisionState
} from "./threeTestTerrainSync.js";
import { createUiAudioController } from "../audio/uiAudio.js";
import { createMusicController } from "../audio/musicController.js";
import { showTitleScreen as mountTitleScreen, type TitleScreenHandle } from "../ui/titleScreen.js";
import {
  loadMusicAudioSettings,
  loadWorldAudioSettings,
  saveMusicAudioSettings,
  saveWorldAudioSettings
} from "../persistence/audioSettings.js";
import {
  getRuntimeSettings,
  resetRuntimeSettings,
  setRuntimeSetting,
  updateRuntimeSettings,
  subscribeRuntimeSettings
} from "../persistence/runtimeSettings.js";
import { createFxLabController, type FxLabController } from "../render/fxLab/controller.js";
import { createFxLabPanel, type FxLabPanelHandle } from "../render/fxLab/panel.js";
import { normalizeFxLabScenarioId, type FxLabScenarioId } from "../render/fxLab/types.js";
import { createFireSimLabController, type FireSimLabController } from "../ui/fire-sim-lab/controller.js";
import { normalizeFireSimLabScenarioId, type FireSimLabScenarioId } from "../systems/fire/types/fireSimLabTypes.js";
import { describeWebGLError } from "../render/webglContext.js";

// Single switch for removing the startup title layer.
const ENABLE_TITLE_SCREEN = true;

type HudAudioChannelSettings = {
  muted: boolean;
  volume: number;
};

type HudAudioChannelControls = {
  getSettings: () => HudAudioChannelSettings;
  setMuted: (muted: boolean) => void;
  toggleMuted: () => void;
  setVolume: (value: number) => void;
  onChange: (listener: (settings: HudAudioChannelSettings) => void) => () => void;
};

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
  openFxLab: (scenarioId?: FxLabScenarioId) => Promise<void>;
  openFireSimLab: (scenarioId?: FireSimLabScenarioId) => Promise<void>;
  dispose: () => void;
};

const cloneRunConfig = (config: NewRunConfig): NewRunConfig => ({
  seed: Number.isFinite(config.seed) ? Math.floor(config.seed) : DEFAULT_RUN_SEED,
  mapSize: config.mapSize,
  characterId: config.characterId,
  chiefGender: config.chiefGender ?? DEFAULT_CHIEF_GENDER,
  callsign: config.callsign,
  options: {
    ...DEFAULT_RUN_OPTIONS,
    ...config.options,
    terrain: cloneTerrainRecipe(config.options.terrain ?? DEFAULT_RUN_OPTIONS.terrain),
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
    chiefGender: persisted.chiefGender ?? defaults.chiefGender,
    callsign: persisted.callsign.trim().length > 0 ? persisted.callsign : defaults.callsign,
    options: {
      ...defaults.options,
      ...persisted.options,
      terrain: cloneTerrainRecipe(persisted.options.terrain ?? defaults.options.terrain),
      fire: { ...defaults.options.fire, ...persisted.options.fire },
      fuelProfiles: { ...(persisted.options.fuelProfiles ?? {}) }
    }
  };
};

export const createAppRuntime = (): AppRuntime => {
  const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
  const buildGrid = (mapSize: MapSizeId) => {
    const size = MAP_SIZE_PRESETS[mapSize];
    return {
      cols: size,
      rows: size,
      totalTiles: size * size
    };
  };
  let activeMapSize: MapSizeId = DEFAULT_MAP_SIZE;
  let activeTerrainSource = cloneTerrainRecipe(DEFAULT_RUN_OPTIONS.terrain);
  const grid = buildGrid(activeMapSize);
  
  const params = new URLSearchParams(window.location.search);
  const initialLabParam = (params.get("lab") ?? "").toLowerCase();
  const initialFxLabEnabled = initialLabParam === "fx";
  const initialFireSimLabEnabled = initialLabParam === "sim";
  const initialFxLabScene = normalizeFxLabScenarioId(params.get("scene"));
  const initialFireSimLabScene = normalizeFireSimLabScenarioId(params.get("scene"));
  let runtimeSettings = getRuntimeSettings();
  const isHeadless = (): boolean => runtimeSettings.headless;
  const isThreeTestNoSimEnabled = (): boolean => runtimeSettings.nosim;
  const isThreeTestSeasonalEnabled = (): boolean => runtimeSettings.seasonal;
  const isThreeTestTerrainSyncDisabled = (): boolean => runtimeSettings.noterrain;
  const isThreeTestTreeRenderingEnabled = (): boolean => runtimeSettings.trees;
  const isThreeTestDetailedStructuresEnabled = (): boolean => runtimeSettings.detailedstructures;
  const getThreeTestDprCap = (): number => runtimeSettings.dpr;
  const getFrameCapFps = (): number => runtimeSettings.fps;
  const isPerfConsoleAlways = (): boolean => runtimeSettings.perflog;
  const seedParam = params.get("seed");
  const initialSeed = seedParam && !Number.isNaN(Number(seedParam)) ? Number(seedParam) : Math.floor(Date.now() % 1000000);
  
  const state = createInitialState(initialSeed, grid);
  const syncTimeSpeedControlMode = (): void => {
    state.timeSpeedControlMode = runtimeSettings.timespeedui;
  };
  syncTimeSpeedControlMode();
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
  const clampChannel01 = (value: number): number => Math.max(0, Math.min(1, value));
  const createHudAudioChannelControls = (
    initialSettings: HudAudioChannelSettings,
    persist: (settings: HudAudioChannelSettings) => void,
    onApply?: (settings: HudAudioChannelSettings) => void
  ): HudAudioChannelControls => {
    const listeners = new Set<(settings: HudAudioChannelSettings) => void>();
    let mutedByUser = Boolean(initialSettings.muted);
    let volume = clampChannel01(initialSettings.volume);
    const getSettings = (): HudAudioChannelSettings => ({ muted: mutedByUser, volume });
    const notify = (): void => {
      const snapshot = getSettings();
      listeners.forEach((listener) => listener(snapshot));
    };
    const apply = (): void => {
      onApply?.(getSettings());
    };
    const controls: HudAudioChannelControls = {
      getSettings,
      setMuted: (muted: boolean): void => {
        const nextMuted = Boolean(muted);
        if (mutedByUser === nextMuted) {
          return;
        }
        mutedByUser = nextMuted;
        apply();
        persist(getSettings());
        notify();
      },
      toggleMuted: (): void => {
        controls.setMuted(!mutedByUser);
      },
      setVolume: (value: number): void => {
        const nextVolume = clampChannel01(value);
        if (Math.abs(volume - nextVolume) < 0.0001) {
          return;
        }
        volume = nextVolume;
        apply();
        persist(getSettings());
        notify();
      },
      onChange: (listener: (settings: HudAudioChannelSettings) => void): (() => void) => {
        listeners.add(listener);
        listener(getSettings());
        return () => {
          listeners.delete(listener);
        };
      }
    };
    apply();
    return controls;
  };
  const musicControls = createHudAudioChannelControls(loadMusicAudioSettings(), saveMusicAudioSettings, (settings) => {
    musicController.setVolume(settings.volume);
    musicController.setMuted(document.hidden || settings.muted);
  });
  const worldAudioControls = createHudAudioChannelControls(loadWorldAudioSettings(), saveWorldAudioSettings);
  const applyMusicOutputState = (): void => {
    const settings = musicControls.getSettings();
    musicController.setVolume(settings.volume);
    musicController.setMuted(document.hidden || settings.muted);
  };
  
  setGameEventBus(gameEvents);
  
  const persistenceState = { scoreSubmitted: false };
  let endRunScreen: EndRunScreenHandle | null = null;
  
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
    showEndRunScreen(payload);
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
  const characterScreen = document.getElementById("characterScreen") as HTMLDivElement;
  const mapEditorScreen = document.getElementById("mapEditorScreen") as HTMLDivElement;
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
  const threeTestMainMenuButton = document.getElementById("threeTestMainMenu") as HTMLButtonElement | null;
  const threeTestRunMainMenuButton = document.createElement("button");
  threeTestRunMainMenuButton.type = "button";
  threeTestRunMainMenuButton.className = "phase-progression-run-action";
  threeTestRunMainMenuButton.textContent = "Main Menu";
  const isMenuActive = (): boolean =>
    (startMenu ? !startMenu.classList.contains("hidden") : false) ||
    !characterScreen.classList.contains("hidden") ||
    !mapEditorScreen.classList.contains("hidden");
  const syncMusicContext = (): void => {
    if (isHeadless()) {
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
  const isThreeTestSeasonalRecolorEnabled = (): boolean => runtimeSettings.seasonal;
  type ThreeTestSeasonMode = "auto" | "manual";
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
  const titleScreenEnabled = ENABLE_TITLE_SCREEN && !isHeadless() && !initialFxLabEnabled && !initialFireSimLabEnabled;
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
  let fxLabController: FxLabController | null = null;
  let fxLabPanel: FxLabPanelHandle | null = null;
  let fireSimLabController: FireSimLabController | null = null;
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
  let lastThreeTestVegetationRevision = -1;
  let lastThreeTestStructureRevision = -1;
  let lastThreeTestDebugTypeColors = false;
  let lastThreeTestGeometryTypeSnapshot: Uint8Array | null = null;
  let cachedThreeTestTreeTypeMap: Uint8Array | null = null;
  let cachedThreeTestTreeTypeTerrainRevision = -1;
  let cachedThreeTestTreeTypeVegetationRevision = -1;
  let savedThreeTestSmokeRate: number | null = null;
  let activeThreeOverlayMode: "run" | "fx-lab" | "sim-lab" | null = null;
  const perfStats = new Map<string, PerfStat>();
  const perfOverlay = document.createElement("div");
  const perfOverlayText = document.createElement("pre");
  const perfOverlayControls = document.createElement("div");
  const perfOverlayControlsTitle = document.createElement("div");
  type PerfOverlayCheckbox = {
    row: HTMLLabelElement;
    input: HTMLInputElement;
  };
  const createPerfOverlayCheckbox = (label: string, shortcut: string): PerfOverlayCheckbox => {
    const row = document.createElement("label");
    row.style.display = "flex";
    row.style.alignItems = "center";
    row.style.gap = "8px";
    row.style.cursor = "pointer";
    row.style.userSelect = "none";
    row.style.pointerEvents = "auto";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.style.margin = "0";
    input.style.accentColor = "#7baf8d";
    const text = document.createElement("span");
    text.textContent = `${label} (${shortcut})`;
    row.append(input, text);
    return { row, input };
  };
  const perfOverlayFogToggle = createPerfOverlayCheckbox("Fog", "F8");
  const perfOverlayWaterfallToggle = createPerfOverlayCheckbox("Waterfall X-Ray", "F9");
  let perfOverlayVisible = runtimeSettings.perf;
  let lastPerfOverlayUpdate = 0;
  let lastPerfConsoleLog = 0;
  type LongTaskStats = { count: number; totalMs: number; maxMs: number; lastMs: number; lastAt: number; lastDetail: string };
  const longTaskStats: LongTaskStats = { count: 0, totalMs: 0, maxMs: 0, lastMs: 0, lastAt: 0, lastDetail: "n/a" };
  
  const resetPerfDiagnostics = (): void => {
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

  const formatRendererUnavailableStatus = (featureLabel: string, error: unknown): string =>
    `${featureLabel} unavailable: ${describeWebGLError(error)} Return to the main menu and try again after checking WebGL support.`;

  canvas.classList.add("hidden");
  phaseUiRoot?.classList.add("hidden");
  resetPerfDiagnostics();
  
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
  const canUsePerfOverlayRunToggles = (): boolean =>
    activeThreeOverlayMode === "run" &&
    !!threeTestController &&
    !!threeTestOverlay &&
    !threeTestOverlay.classList.contains("hidden");
  const syncPerfOverlayControls = (): void => {
    const canToggle = canUsePerfOverlayRunToggles();
    perfOverlayControls.style.display = canToggle ? "flex" : "none";
    perfOverlayFogToggle.input.disabled = !canToggle;
    perfOverlayWaterfallToggle.input.disabled = !canToggle;
    if (!canToggle || !threeTestController) {
      perfOverlayFogToggle.input.checked = false;
      perfOverlayWaterfallToggle.input.checked = false;
      return;
    }
    perfOverlayFogToggle.input.checked = threeTestController.getEnvironmentFogEnabled();
    perfOverlayWaterfallToggle.input.checked =
      threeTestController.getTerrainWaterDebugControls().waterfallDebugHighlight;
  };
  const setRunFogEnabled = (enabled: boolean): void => {
    if (!canUsePerfOverlayRunToggles() || !threeTestController) {
      syncPerfOverlayControls();
      return;
    }
    threeTestController.setEnvironmentFogEnabled(enabled);
    setStatus(state, enabled ? "Environment fog enabled. Press F8 to disable." : "Environment fog disabled.");
    syncPerfOverlayControls();
  };
  const setRunWaterfallHighlightEnabled = (enabled: boolean): void => {
    if (!canUsePerfOverlayRunToggles() || !threeTestController) {
      syncPerfOverlayControls();
      return;
    }
    const controls = threeTestController.getTerrainWaterDebugControls();
    threeTestController.setTerrainWaterDebugControls({
      showWaterfalls: enabled ? true : controls.showWaterfalls,
      waterfallDebugHighlight: enabled
    });
    setStatus(
      state,
      enabled
        ? "Waterfall x-ray highlight enabled. Press F9 to disable."
        : "Waterfall x-ray highlight disabled."
    );
    syncPerfOverlayControls();
  };
  
  const setPerfOverlayVisible = (visible: boolean): void => {
    perfOverlayVisible = visible;
    perfOverlay.style.display = visible ? "flex" : "none";
    if (visible) {
      syncPerfOverlayControls();
    }
  };
  
  const applyPerfOverlayStyle = (): void => {
    perfOverlay.id = "perfOverlay";
    perfOverlay.style.position = "fixed";
    perfOverlay.style.right = "12px";
    perfOverlay.style.bottom = "12px";
    perfOverlay.style.margin = "0";
    perfOverlay.style.padding = "10px 12px";
    perfOverlay.style.maxWidth = "460px";
    perfOverlay.style.display = "flex";
    perfOverlay.style.flexDirection = "column";
    perfOverlay.style.gap = "8px";
    perfOverlay.style.pointerEvents = "auto";
    perfOverlay.style.zIndex = "80";
    perfOverlay.style.color = "#d7f0dd";
    perfOverlay.style.background = "rgba(9, 13, 17, 0.84)";
    perfOverlay.style.border = "1px solid rgba(123, 175, 141, 0.45)";
    perfOverlay.style.borderRadius = "8px";
    perfOverlay.style.font = "12px/1.35 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    perfOverlay.style.boxShadow = "0 8px 20px rgba(0, 0, 0, 0.35)";
    perfOverlay.addEventListener("pointerdown", (event) => event.stopPropagation());
    perfOverlay.addEventListener("click", (event) => event.stopPropagation());
    perfOverlayText.style.margin = "0";
    perfOverlayText.style.whiteSpace = "pre";
    perfOverlayText.style.pointerEvents = "none";
    perfOverlayText.style.color = "inherit";
    perfOverlayText.style.font = "inherit";
    perfOverlayControls.style.display = "none";
    perfOverlayControls.style.flexDirection = "column";
    perfOverlayControls.style.gap = "6px";
    perfOverlayControls.style.paddingTop = "8px";
    perfOverlayControls.style.borderTop = "1px solid rgba(123, 175, 141, 0.28)";
    perfOverlayControls.style.pointerEvents = "auto";
    perfOverlayControlsTitle.textContent = "Run Toggles";
    perfOverlayControlsTitle.style.fontWeight = "600";
    perfOverlayControlsTitle.style.color = "#b8d8c2";
    perfOverlayFogToggle.input.addEventListener("change", () => {
      setRunFogEnabled(perfOverlayFogToggle.input.checked);
    });
    perfOverlayWaterfallToggle.input.addEventListener("change", () => {
      setRunWaterfallHighlightEnabled(perfOverlayWaterfallToggle.input.checked);
    });
    perfOverlayControls.append(
      perfOverlayControlsTitle,
      perfOverlayFogToggle.row,
      perfOverlayWaterfallToggle.row
    );
    perfOverlay.append(perfOverlayText, perfOverlayControls);
    document.body.appendChild(perfOverlay);
    setPerfOverlayVisible(perfOverlayVisible);
  };
  
  const unsubscribeRuntimeSettings = subscribeRuntimeSettings((nextSettings) => {
    const previousTimeSpeedUi = runtimeSettings.timespeedui;
    runtimeSettings = nextSettings;
    syncTimeSpeedControlMode();
    setPerfOverlayVisible(runtimeSettings.perf);
    if (previousTimeSpeedUi !== runtimeSettings.timespeedui) {
      phaseUi?.sync(state, inputState);
    }
  });
  
  const buildPerfOverlayText = (threePerf: ThreeTestPerfSnapshot | null, now: number): string => {
    const mainFrame = readRecentPerf("main.frame", now);
    const mainRafGap = readRecentPerf("main.rafGap", now);
    const mainHitch = readRecentPerf("main.hitch", now);
    const simFrame = readRecentPerf("sim.frame", now);
    const simStep = readRecentPerf("sim.step", now);
    const simSteps = readRecentPerf("sim.steps", now);
    const climate3d = readRecentPerf("3d.climateSync", now);
    const terrain3d = readRecentPerf("3d.terrainSync", now);
    const terrainDeferred3d = readRecentPerf("3d.terrainDeferred", now);
    const terrainSampleBuild3d = readRecentPerf("3d.terrainSampleBuild", now);
    const terrainSyncSkipped3d = readRecentPerf("3d.terrainSyncSkipped", now);
    const terrainVisualBatched3d = readRecentPerf("3d.terrainVisualBatched", now);
    const lines = [
      `Perf (3D)  |  Ctrl+Shift+P toggle`,
      `Flags: seasonal=${isThreeTestSeasonalEnabled() ? "1" : "0"} nosim=${isThreeTestNoSimEnabled() ? "1" : "0"} noterrain=${isThreeTestTerrainSyncDisabled() ? "1" : "0"} trees=${isThreeTestTreeRenderingEnabled() ? "1" : "0"} detailStruct=${isThreeTestDetailedStructuresEnabled() ? "1" : "0"} dpr=${getThreeTestDprCap().toFixed(2)} fps=${getFrameCapFps() > 0 ? getFrameCapFps().toFixed(0) : "off"}`,
      `Main:  ${formatMs(mainFrame?.avg)} avg  ${formatMs(mainFrame?.last)} last  ${formatMs(mainFrame?.max)} max`,
      `Main gap: ${formatMs(mainRafGap?.avg)} avg  ${formatMs(mainRafGap?.last)} last  hitch ${formatMs(mainHitch?.last)}`,
      `Sim:   ${formatMs(simFrame?.avg)} frame  ${formatMs(simStep?.avg)} step  steps/frame ${formatNum(simSteps?.avg)}`
    ];
    lines.push(
      `3D sync: climate ${formatMs(climate3d?.avg)}  terrain ${formatMs(terrain3d?.avg)}  deferred ${formatNum(terrainDeferred3d?.avg)}`
    );
    if (threePerf) {
        lines.push(`3D frame: ${formatMs(threePerf.frameMs)}  fps ${formatNum(threePerf.fps)}`);
        lines.push(
          `3D slices: scene ${formatMs(threePerf.sceneRenderMs)}  post ${formatMs(threePerf.postMs)}  dof ${formatMs(threePerf.dofMs)}`
        );
        lines.push(
          `3D misc: fx ${formatMs(threePerf.fireFxMs)}  controls ${formatMs(threePerf.controlsMs)}  hud ${formatMs(threePerf.hudMs)}  ui ${formatMs(threePerf.uiRenderMs)}`
        );
        if (threePerf.fireFxDebug) {
          lines.push(
            `3D fire: snap ${formatMs(threePerf.fireFxDebug.timingsMs.snapshot)} ana ${formatMs(threePerf.fireFxDebug.timingsMs.analysis)} flame ${formatMs(threePerf.fireFxDebug.timingsMs.flameWrite)} smoke ${formatMs(threePerf.fireFxDebug.timingsMs.smoke)} up ${formatMs(threePerf.fireFxDebug.timingsMs.upload)}`
          );
          lines.push(
            `3D fire ana: act ${formatMs(threePerf.fireFxDebug.timingsMs.analysisActiveTiles)} cl ${formatMs(threePerf.fireFxDebug.timingsMs.analysisClusters)} front ${formatMs(threePerf.fireFxDebug.timingsMs.analysisFronts)} plan ${formatMs(threePerf.fireFxDebug.timingsMs.analysisTilePlan)}`
          );
          lines.push(
            `3D fire write: front ${formatMs(threePerf.fireFxDebug.timingsMs.flameFront)} cl ${formatMs(threePerf.fireFxDebug.timingsMs.flameCluster)} tile ${formatMs(threePerf.fireFxDebug.timingsMs.flameTiles)}`
          );
          lines.push(
            `3D fire dbg: inst ${formatInt(threePerf.fireFxDebug.counts.fireInstances)} smoke ${formatInt(threePerf.fireFxDebug.counts.smokeParticles)} cluster ${formatInt(threePerf.fireFxDebug.counts.clusters)}/${formatInt(threePerf.fireFxDebug.counts.clusteredTiles)} front ${formatInt(threePerf.fireFxDebug.counts.frontSegments)} step ${formatInt(threePerf.fireFxDebug.counts.sampleStep)} stride ${formatInt(threePerf.fireFxDebug.counts.smokeRenderStride)} cap ${formatInt(threePerf.fireFxDebug.counts.smokeRenderCap)}`
          );
          lines.push(
            `3D fire vis: tiles ${formatInt(threePerf.fireFxDebug.counts.visibleTiles)}/${formatInt(threePerf.fireFxDebug.counts.candidateTiles)} culled ${formatInt(threePerf.fireFxDebug.counts.culledTiles)} corr ${formatInt(threePerf.fireFxDebug.counts.frontCorridorsEmitted)}/${formatInt(threePerf.fireFxDebug.counts.frontCorridorsTested)} cull ${formatInt(threePerf.fireFxDebug.counts.frontCorridorsCulled)} inst ${formatInt(threePerf.fireFxDebug.counts.instancesCulledByVisibility)} smoke ${formatInt(threePerf.fireFxDebug.counts.smokeParticlesCulledByVisibility)}`
          );
          lines.push(
            `3D fire mode: ${threePerf.fireFxDebug.modes.emergencyOverload ? "emergency" : threePerf.fireFxDebug.modes.overloaded ? "overload" : "normal"} spark ${threePerf.fireFxDebug.modes.showSparks ? "on" : "off"} smoke ${threePerf.fireFxDebug.modes.showSmoke ? "on" : "off"} front ${threePerf.fireFxDebug.modes.showFrontPass ? "on" : "off"} raw ${formatInt(threePerf.fireFxDebug.counts.rawFallbackAnchorTiles)} churn ${formatInt(threePerf.fireFxDebug.continuity.localSlotChurn)}/${formatInt(threePerf.fireFxDebug.continuity.objectSlotChurn)}/${formatInt(threePerf.fireFxDebug.continuity.frontSlotChurn)}`
          );
        }
        lines.push(
          `3D terrain set: avg ${formatMs(threePerf.terrainSetMs)} last ${formatMs(threePerf.terrainSetLastMs)} max ${formatMs(threePerf.terrainSetMaxMs)} n ${formatInt(threePerf.terrainSetCount)} reuse/full ${formatInt(threePerf.terrainSetFastReuseCount)}/${formatInt(threePerf.terrainSetFullRebuildCount)}`
        );
        lines.push(
          `3D terrain sync: sample ${formatMs(terrainSampleBuild3d?.avg)} skip ${formatNum(terrainSyncSkipped3d?.avg)}(${formatInt(threeTestTerrainSyncSkippedCount)}) visualBatch ${formatNum(terrainVisualBatched3d?.avg)}(${formatInt(threeTestTerrainVisualBatchedCount)})`
        );
        lines.push(
          `3D gap: avg ${formatMs(threePerf.rafGapMs)}  last ${formatMs(threePerf.rafGapLastMs)}  max ${formatMs(threePerf.rafGapMaxMs)}  hitches ${formatInt(threePerf.hitchCount)}`
        );
        lines.push(
          `3D geo: calls ${formatInt(threePerf.sceneCalls)} tri ${formatInt(threePerf.sceneTriangles)} line ${formatInt(threePerf.sceneLines)} pt ${formatInt(threePerf.scenePoints)}`
        );
        lines.push(
          `3D falls: inst ${formatInt(threePerf.waterfallCount)} cand ${formatInt(threePerf.waterfallCandidateCount)} cluster ${formatInt(threePerf.waterfallClusterCount)} emit ${formatInt(threePerf.waterfallEmittedCount)} wallQ ${formatInt(threePerf.waterfallWallQuadCount)} tri ${formatInt(threePerf.waterfallWallTriangleCount)}`
        );
        lines.push(
          `3D fall dbg: rejVert ${formatInt(threePerf.waterfallRejectedVerticalCount)} rejRun ${formatInt(threePerf.waterfallRejectedLongRunCount)} anchor ${formatNum(threePerf.waterfallAnchorErrorMean)}/${formatNum(threePerf.waterfallAnchorErrorMax)} gap ${formatNum(threePerf.waterfallWallTopGapMean)}/${formatNum(threePerf.waterfallWallTopGapMax)}`
        );
        lines.push(`3D fall span: q/f ${threePerf.waterfallWallQuadBreakdown}`);
        lines.push(`3D env: fog ${threePerf.environmentFogEnabled ? "on" : "off"}  F8 toggle`);
        lines.push(`3D fall viz: ${threePerf.waterfallDebugHighlightEnabled ? "xray on" : "xray off"}  F9 toggle`);
        lines.push(
          `3D mem: geom ${formatInt(threePerf.memoryGeometries)} tex ${formatInt(threePerf.memoryTextures)} totalCalls ${formatInt(threePerf.totalCalls)}`
        );
        lines.push(
          `3D ctx: loss ${formatInt(threePerf.contextLosses)} restore ${formatInt(threePerf.contextRestores)}`
        );
    }
    if (longTaskStats.count > 0 && now - longTaskStats.lastAt < 60000) {
      lines.push(
        `LongTask: n ${longTaskStats.count} last ${formatMs(longTaskStats.lastMs)} max ${formatMs(longTaskStats.maxMs)} src ${longTaskStats.lastDetail}`
      );
    }
    return lines.join("\n");
  };
  
  const maybeUpdatePerfDiagnostics = (now: number): void => {
    const threePerf = threeTestController?.getPerfSnapshot() ?? null;
    if (threePerf) {
      recordPerfSample("3d.frame", threePerf.frameMs);
      recordPerfSample("3d.scene", threePerf.sceneRenderMs);
      recordPerfSample("3d.post", threePerf.postMs);
      recordPerfSample("3d.dof", threePerf.dofMs);
      recordPerfSample("3d.fx", threePerf.fireFxMs);
      recordPerfSample("3d.hud", threePerf.hudMs);
      recordPerfSample("3d.controls", threePerf.controlsMs);
      recordPerfSample("3d.treeBurn", threePerf.treeBurnMs);
      recordPerfSample("3d.uiRender", threePerf.uiRenderMs);
    }
    if (perfOverlayVisible && now - lastPerfOverlayUpdate >= PERF_OVERLAY_REFRESH_MS) {
      perfOverlayText.textContent = buildPerfOverlayText(threePerf, now);
      syncPerfOverlayControls();
      lastPerfOverlayUpdate = now;
    }
    const perfConsoleAlways = isPerfConsoleAlways();
    if ((perfOverlayVisible || perfConsoleAlways) && now - lastPerfConsoleLog >= PERF_CONSOLE_INTERVAL_MS) {
      if (threePerf) {
        const mainAvg = readRecentPerf("main.frame", now)?.avg ?? 0;
        const simAvg = readRecentPerf("sim.frame", now)?.avg ?? 0;
        const climateAvg = readRecentPerf("3d.climateSync", now)?.avg ?? 0;
        const terrainAvg = readRecentPerf("3d.terrainSync", now)?.avg ?? 0;
        const terrainDeferred = readRecentPerf("3d.terrainDeferred", now)?.avg ?? 0;
        const terrainSampleBuild = readRecentPerf("3d.terrainSampleBuild", now)?.avg ?? 0;
        const terrainSkipped = readRecentPerf("3d.terrainSyncSkipped", now)?.avg ?? 0;
        const terrainVisualBatched = readRecentPerf("3d.terrainVisualBatched", now)?.avg ?? 0;
        const threeFrame = readRecentPerf("3d.frame", now)?.avg ?? 0;
        const threeScene = readRecentPerf("3d.scene", now)?.avg ?? 0;
        const threePost = readRecentPerf("3d.post", now)?.avg ?? 0;
        const threeDof = readRecentPerf("3d.dof", now)?.avg ?? 0;
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
            `seasonal=${isThreeTestSeasonalEnabled() ? 1 : 0} ` +
            `nosim=${isThreeTestNoSimEnabled() ? 1 : 0} ` +
            `noterrain=${isThreeTestTerrainSyncDisabled() ? 1 : 0} ` +
            `trees=${isThreeTestTreeRenderingEnabled() ? 1 : 0} ` +
            `detailStruct=${isThreeTestDetailedStructuresEnabled() ? 1 : 0} ` +
            `gap=${mainGap.toFixed(2)}ms hitch=${hitch.toFixed(2)}ms ` +
            `sync(climate=${climateAvg.toFixed(2)} terrain=${terrainAvg.toFixed(2)} defer=${terrainDeferred.toFixed(2)}) ` +
            `3dFrame=${threeFrame.toFixed(2)}ms scene=${threeScene.toFixed(2)} post=${threePost.toFixed(2)} dof=${threeDof.toFixed(2)} sceneLast=${(threePerf?.sceneRenderLastMs ?? 0).toFixed(2)} ` +
            `gap3d=${(threePerf?.rafGapLastMs ?? 0).toFixed(2)} terrainSetLast=${terrainSetLast.toFixed(2)} terrainSetMax=${terrainSetMax.toFixed(2)} terrainSetN=${Math.round(terrainSetCount)} ` +
            `terrainSample=${terrainSampleBuild.toFixed(2)} terrainSkip=${terrainSkipped.toFixed(2)}(${Math.round(threeTestTerrainSyncSkippedCount)}) terrainBatch=${terrainVisualBatched.toFixed(2)}(${Math.round(threeTestTerrainVisualBatchedCount)}) terrainReuseFull=${Math.round(threePerf?.terrainSetFastReuseCount ?? 0)}/${Math.round(threePerf?.terrainSetFullRebuildCount ?? 0)} ` +
            `fx=${threeFx.toFixed(2)} hud=${threeHud.toFixed(2)} ctxLoss=${Math.round(contextLosses)} ctxRestore=${Math.round(contextRestores)} ` +
            `calls=${Math.round(sceneCalls)} tri=${Math.round(sceneTriangles)}`
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
    if (isThreeTestSeasonalRecolorEnabled()) {
      threeTestController?.setSeasonLabel(`Season: ${label} (${mode.toUpperCase()})`);
    } else {
      threeTestController?.setSeasonLabel("Seasonal visuals disabled");
    }
    return clamped;
  };
  
  const getThreeTestTreeTypeMap = (forceRefresh = false): Uint8Array => {
    const needsBuild = shouldRebuildThreeTestTreeTypeMap(
      {
        cachedLength: cachedThreeTestTreeTypeMap?.length ?? 0,
        totalTiles: state.grid.totalTiles,
        cachedTerrainTypeRevision: cachedThreeTestTreeTypeTerrainRevision,
        cachedVegetationRevision: cachedThreeTestTreeTypeVegetationRevision
      },
      {
        terrainTypeRevision: state.terrainTypeRevision,
        vegetationRevision: state.vegetationRevision
      },
      forceRefresh || !cachedThreeTestTreeTypeMap
    );
    if (needsBuild) {
      cachedThreeTestTreeTypeMap = buildTreeTypeMap();
      cachedThreeTestTreeTypeTerrainRevision = state.terrainTypeRevision;
      cachedThreeTestTreeTypeVegetationRevision = state.vegetationRevision;
    }
    return cachedThreeTestTreeTypeMap!;
  };
  
  const buildThreeTestSample = (fastUpdate = false) => {
    const startedAt = performance.now();
    try {
      const terrainHeightScaleMultiplier = getTerrainHeightScaleMultiplier(activeTerrainSource, activeMapSize);
      const sample = buildRenderTerrainSample(
        state,
        getThreeTestTreeTypeMap(!fastUpdate),
        inputState.debugTypeColors,
        isThreeTestTreeRenderingEnabled(),
        fastUpdate,
        true,
        terrainHeightScaleMultiplier
      );
      // Climate tinting is shader-driven in 3D; avoid terrain texture rebuild pressure from moisture deltas.
      sample.tileMoisture = undefined;
      sample.climateDryness = undefined;
      return sample;
    } finally {
      recordPerfSample("3d.terrainSampleBuild", performance.now() - startedAt);
    }
  };

  const THREE_TEST_TERRAIN_COOLDOWN_MS = 600;
  const THREE_TEST_TERRAIN_FIRE_VISUAL_COOLDOWN_MS = 750;
  const THREE_TEST_GEOMETRY_TERRAIN_TYPES = new Set<number>([
    TILE_TYPE_IDS.road,
    TILE_TYPE_IDS.water,
    TILE_TYPE_IDS.base,
    TILE_TYPE_IDS.house
  ]);
  const isGeometryRelevantTerrainType = (typeId: number): boolean => THREE_TEST_GEOMETRY_TERRAIN_TYPES.has(typeId);
  const hasGeometryRelevantTerrainTypeChange = (previous: Uint8Array | null, next: Uint8Array): boolean => {
    if (!previous || previous.length !== next.length) {
      return true;
    }
    for (let i = 0; i < next.length; i += 1) {
      const prevType = previous[i] ?? -1;
      const nextType = next[i] ?? -1;
      if (prevType === nextType) {
        continue;
      }
      if (isGeometryRelevantTerrainType(prevType) || isGeometryRelevantTerrainType(nextType)) {
        return true;
      }
    }
    return false;
  };
  let lastThreeTestTerrainSync = 0;
  let threeTestTerrainSyncSkippedCount = 0;
  let threeTestTerrainVisualBatchedCount = 0;
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
      const nextVegetationRevision = state.vegetationRevision;
      const nextStructureRevision = state.structureRevision;
      const nextRevisionState: ThreeTestTerrainRevisionState = {
        terrainTypeRevision: nextTypeRevision,
        vegetationRevision: nextVegetationRevision,
        structureRevision: nextStructureRevision,
        debugTypeColors: inputState.debugTypeColors
      };
      const prevRevisionState: ThreeTestTerrainRevisionState = {
        terrainTypeRevision: lastThreeTestTerrainTypeRevision,
        vegetationRevision: lastThreeTestVegetationRevision,
        structureRevision: lastThreeTestStructureRevision,
        debugTypeColors: lastThreeTestDebugTypeColors
      };
      const debugChanged = lastThreeTestDebugTypeColors !== inputState.debugTypeColors;
      const terrainTypesChanged = nextTypeRevision !== lastThreeTestTerrainTypeRevision;
      const vegetationChanged = nextVegetationRevision !== lastThreeTestVegetationRevision;
      const structuresChanged = nextStructureRevision !== lastThreeTestStructureRevision;
      if (!shouldSyncThreeTestTerrain(prevRevisionState, nextRevisionState, force)) {
        state.terrainDirty = false;
        return;
      }
      const now = performance.now();
      const activeFireTerrainPressure = hasActiveFireTerrainPressure();
      const geometryTerrainChanged =
        terrainTypesChanged && hasGeometryRelevantTerrainTypeChange(lastThreeTestGeometryTypeSnapshot, state.tileTypeId);
      const visualTerrainChanged = terrainTypesChanged && !geometryTerrainChanged;
      const vegetationOnlyChanged = vegetationChanged && !terrainTypesChanged;
      const fireVisualTerrainChanged = activeFireTerrainPressure && (visualTerrainChanged || vegetationOnlyChanged);
      const immediateTerrainSync = force || debugChanged || structuresChanged || geometryTerrainChanged;
      const cooldownMs = fireVisualTerrainChanged
        ? THREE_TEST_TERRAIN_FIRE_VISUAL_COOLDOWN_MS
        : THREE_TEST_TERRAIN_COOLDOWN_MS;
      if (!immediateTerrainSync && now - lastThreeTestTerrainSync < cooldownMs) {
        threeTestTerrainSyncSkippedCount += 1;
        recordPerfSample("3d.terrainSyncSkipped", 1);
        if (fireVisualTerrainChanged) {
          threeTestTerrainVisualBatchedCount += 1;
          recordPerfSample("3d.terrainVisualBatched", 1);
        }
        return;
      }
      recordPerfSample("3d.terrainSyncSkipped", 0);
      recordPerfSample("3d.terrainVisualBatched", fireVisualTerrainChanged ? 1 : 0);
      lastThreeTestTerrainSync = now;
      ensureTileSoA(state);
      threeTestController.setTerrain(buildThreeTestSample(!force));
      lastThreeTestGeometryTypeSnapshot = state.tileTypeId.slice();
      lastThreeTestTerrainTypeRevision = nextTypeRevision;
      lastThreeTestVegetationRevision = nextVegetationRevision;
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
      if (!isThreeTestSeasonalRecolorEnabled()) {
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
    fxLabController?.resize();
    fireSimLabController?.resize();
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

  const clearThreeOverlayHudMount = (): void => {
    if (!threeTestPhaseHudMount) {
      return;
    }
    Array.from(threeTestPhaseHudMount.children).forEach((child) => {
      if (child === phaseUiRoot) {
        return;
      }
      child.remove();
    });
  };

  const setThreeOverlayVisible = (visible: boolean, mountPhaseUi = false): void => {
    if (!threeTestOverlay) {
      return;
    }
    if (visible && mountPhaseUi) {
      clearThreeOverlayHudMount();
      mountPhaseUiIntoThreeTest();
    } else {
      restorePhaseUiMount();
      clearThreeOverlayHudMount();
      phaseUiRoot?.classList.add("hidden");
    }
    threeTestOverlay.classList.toggle("hidden", !visible);
    threeTestOverlay.setAttribute("aria-hidden", visible ? "false" : "true");
    resetPerfDiagnostics();
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
      activeTerrainSource = cloneTerrainRecipe(config.options.terrain);
      resetState(state, seed);
      syncTimeSpeedControlMode();
      rng.setState(seed);
      state.paused = true;
      setFuelProfiles(config.options.fuelProfiles);
      showMapgenOverlay();
      updateMapgenOverlay("Building terrain preview...", 0);
      await generateMap(
        state,
        rng,
        (message, progress) => updateMapgenOverlay(message, progress),
        config.options.terrain,
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
      { label: "firestation", run: () => loadFirestationAsset() },
      { label: "world-audio", run: () => preloadThreeTestWorldAudioAssets() }
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

  const configureThreeOverlayMode = (mode: "run" | "fx-lab" | "sim-lab" | null): void => {
    activeThreeOverlayMode = mode;
    phaseUi?.controller.attachProgressionActions(mode === "run" ? threeTestRunMainMenuButton : null);
    if (threeTestEndRunButton) {
      threeTestEndRunButton.textContent = mode === "fx-lab" || mode === "sim-lab" ? "Close Lab" : "End Run";
    }
    if (threeTestMainMenuButton) {
      threeTestMainMenuButton.textContent = "Main Menu";
    }
    threeTestOverlay?.classList.toggle("three-test-overlay--run", mode === "run");
    threeTestOverlay?.classList.toggle("three-test-overlay--fx-lab", mode === "fx-lab");
    threeTestOverlay?.classList.toggle("three-test-overlay--sim-lab", mode === "sim-lab");
  };

  const handleThreeRendererUnavailable = (featureLabel: string, error: unknown): void => {
    setThreeOverlayVisible(false);
    configureThreeOverlayMode(null);
    setStatus(state, formatRendererUnavailableStatus(featureLabel, error));
    state.paused = true;
    syncMusicContext();
  };

  const closeFxLab = (): void => {
    if (activeThreeOverlayMode !== "fx-lab" && !fxLabController && !fxLabPanel) {
      return;
    }
    fxLabPanel?.destroy();
    fxLabPanel = null;
    fxLabController?.stop();
    fxLabController?.dispose();
    fxLabController = null;
    setThreeOverlayVisible(false);
    window.removeEventListener("resize", handleThreeResize);
    configureThreeOverlayMode(null);
    state.paused = true;
    syncMusicContext();
  };

  const closeFireSimLab = (): void => {
    if (activeThreeOverlayMode !== "sim-lab" && !fireSimLabController) {
      return;
    }
    fireSimLabController?.stop();
    fireSimLabController?.dispose();
    fireSimLabController = null;
    setThreeOverlayVisible(false);
    window.removeEventListener("resize", handleThreeResize);
    configureThreeOverlayMode(null);
    state.paused = true;
    syncMusicContext();
  };

  const openFxLab = async (scenarioId: FxLabScenarioId = initialFxLabScene): Promise<void> => {
    if (!threeTestOverlay || !threeTestCanvas || !threeTestPhaseHudMount) {
      return;
    }
    mapEditor?.close();
    closeThreeTest(true);
    fxLabPanel?.destroy();
    fxLabPanel = null;
    fxLabController?.stop();
    fxLabController?.dispose();
    fxLabController = null;
    configureThreeOverlayMode("fx-lab");
    try {
      setThreeOverlayVisible(true, false);
      fxLabController = createFxLabController(threeTestCanvas, scenarioId);
    } catch (error) {
      handleThreeRendererUnavailable("FX Lab", error);
      if (state.tiles.length === 0) {
        if (titleScreenEnabled) {
          showTitleScreen();
        } else {
          showFallbackMenu();
        }
      }
      return;
    }
    fxLabPanel = createFxLabPanel(threeTestPhaseHudMount, fxLabController);
    handleThreeResize();
    window.addEventListener("resize", handleThreeResize);
    fxLabController.start();
    state.paused = true;
    syncMusicContext();
  };

  const openFireSimLab = async (scenarioId: FireSimLabScenarioId = initialFireSimLabScene): Promise<void> => {
    if (!threeTestOverlay || !threeTestPhaseHudMount) {
      return;
    }
    mapEditor?.close();
    closeThreeTest(true);
    fxLabPanel?.destroy();
    fxLabPanel = null;
    fxLabController?.stop();
    fxLabController?.dispose();
    fxLabController = null;
    fireSimLabController?.stop();
    fireSimLabController?.dispose();
    fireSimLabController = null;
    configureThreeOverlayMode("sim-lab");
    try {
      setThreeOverlayVisible(true, false);
      fireSimLabController = createFireSimLabController(threeTestPhaseHudMount, scenarioId);
    } catch (error) {
      setThreeOverlayVisible(false);
      configureThreeOverlayMode(null);
      setStatus(state, `SIM Lab unavailable: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }
    handleThreeResize();
    window.addEventListener("resize", handleThreeResize);
    fireSimLabController.start();
    state.paused = true;
    syncMusicContext();
  };
  
  const openThreeTest = async (config: NewRunConfig): Promise<void> => {
    if (!threeTestOverlay || !threeTestCanvas) {
      return;
    }
    closeFxLab();
    closeFireSimLab();
    console.info(
      `[threeTest] opening 3D mode with flags seasonal=${isThreeTestSeasonalRecolorEnabled() ? 1 : 0} ` +
        `nosim=${isThreeTestNoSimEnabled() ? 1 : 0} noterrain=${isThreeTestTerrainSyncDisabled() ? 1 : 0} trees=${isThreeTestTreeRenderingEnabled() ? 1 : 0} detailStruct=${isThreeTestDetailedStructuresEnabled() ? 1 : 0} dpr=${getThreeTestDprCap().toFixed(2)} fps=${getFrameCapFps() > 0 ? getFrameCapFps().toFixed(0) : "off"}`
    );
    await preloadThreeTestAssets();
    if (savedThreeTestSmokeRate === null) {
      savedThreeTestSmokeRate = state.simPerf.smokeRate;
    }
    state.simPerf.smokeRate = 0;
    effectsState.smokeParticles.length = 0;
    effectsState.waterParticles.length = 0;
    if (!threeTestController) {
      try {
        threeTestController = createThreeTest(
          threeTestCanvas,
          asRenderSim(state),
          inputState,
          effectsState,
          uiAudio,
          musicControls,
          worldAudioControls
        );
      } catch (error) {
        if (savedThreeTestSmokeRate !== null) {
          state.simPerf.smokeRate = savedThreeTestSmokeRate;
          savedThreeTestSmokeRate = null;
        }
        handleThreeRendererUnavailable("3D mode", error);
        if (titleScreenEnabled) {
          showTitleScreen();
        } else {
          showFallbackMenu();
        }
        return;
      }
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
    lastThreeTestVegetationRevision = -1;
    lastThreeTestStructureRevision = -1;
    lastThreeTestDebugTypeColors = inputState.debugTypeColors;
    lastThreeTestGeometryTypeSnapshot = null;
    threeTestTerrainSyncSkippedCount = 0;
    threeTestTerrainVisualBatchedCount = 0;
    cachedThreeTestTreeTypeMap = null;
    cachedThreeTestTreeTypeTerrainRevision = -1;
    cachedThreeTestTreeTypeVegetationRevision = -1;
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
    configureThreeOverlayMode("run");
    setThreeOverlayVisible(true, true);
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
            oceanMask: snapshot.oceanMask,
            seaLevel: snapshot.seaLevel,
            coastDistance: snapshot.coastDistance,
            coastClass: snapshot.coastClass,
            debugTypeColors: inputState.debugTypeColors,
            fullResolution: true,
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
    if (isThreeTestSeasonalRecolorEnabled()) {
      syncThreeTestClimateVisuals();
    } else {
      updateThreeTestSeasonUi(threeTestManualSeasonT01, threeTestSeasonMode);
    }
    threeTestController.captureFireSnapshot(asRenderSim(state));
    threeTestController.prime();
    if (!previewDuringMapgen) {
      threeTestController.start();
    }
  };
  
  const closeThreeTest = (force = false): void => {
    if (activeThreeOverlayMode === "fx-lab") {
      if (force) {
        closeFxLab();
      }
      return;
    }
    if (activeThreeOverlayMode === "sim-lab") {
      if (force) {
        closeFireSimLab();
      }
      return;
    }
    if (!force && activeThreeOverlayMode !== "run") {
      return;
    }
    if (!threeTestOverlay) {
      return;
    }
    if (savedThreeTestSmokeRate !== null) {
      state.simPerf.smokeRate = savedThreeTestSmokeRate;
      savedThreeTestSmokeRate = null;
    }
    setThreeOverlayVisible(false);
    threeTestController?.stop();
    window.removeEventListener("resize", handleThreeResize);
    threeTestStepController?.setAuto(true);
    if (phaseUi && threeTestUiListener) {
      phaseUi.state.off("change", threeTestUiListener);
      threeTestUiListener = null;
    }
    configureThreeOverlayMode(null);
  };

  const returnToStartMenu = (): void => {
    const closingLab = activeThreeOverlayMode === "fx-lab" || activeThreeOverlayMode === "sim-lab";
    endRunScreen?.hide();
    closeThreeTest(true);
    uiState.overlayVisible = false;
    uiState.overlayAction = "dismiss";
    updateOverlay(overlayRefs, uiState);
    characterScreen.classList.add("hidden");
    startMenu?.classList.remove("hidden");
    state.paused = true;
    setStatus(state, closingLab ? "Lab closed. Ready to start a new run." : "Run ended. Ready to start a new run.");
    syncMusicContext();
  };

  const returnToMainMenu = (): void => {
    const closingLab = activeThreeOverlayMode === "fx-lab" || activeThreeOverlayMode === "sim-lab";
    endRunScreen?.hide();
    closeThreeTest(true);
    uiState.overlayVisible = false;
    uiState.overlayAction = "dismiss";
    updateOverlay(overlayRefs, uiState);
    characterScreen.classList.add("hidden");
    state.paused = true;
    if (titleScreenEnabled) {
      startMenu?.classList.add("hidden");
      showTitleScreen();
      setStatus(state, closingLab ? "Lab closed. Returned to the title screen." : "Run ended. Returned to the title screen.");
    } else {
      startMenu?.classList.remove("hidden");
      setStatus(state, closingLab ? "Lab closed. Ready to start a new run." : "Run ended. Ready to start a new run.");
    }
    syncMusicContext();
  };

  const openNewRunFromEndRunScreen = (): void => {
    endRunScreen?.hide();
    closeThreeTest(true);
    uiState.overlayVisible = false;
    uiState.overlayAction = "dismiss";
    updateOverlay(overlayRefs, uiState);
    if (phaseUi && startNewRunButton) {
      startNewRunButton.click();
      return;
    }
    showFallbackMenu();
  };

  endRunScreen = threeTestOverlay
    ? createEndRunScreen({
        mount: threeTestOverlay,
        onNewRun: openNewRunFromEndRunScreen,
        onMainMenu: returnToMainMenu
      })
    : null;

  function showEndRunScreen(payload: GameOverPayload): void {
    uiState.overlayVisible = false;
    uiState.overlayAction = "dismiss";
    updateOverlay(overlayRefs, uiState);
    state.paused = true;
    if (threeTestOverlay?.classList.contains("hidden") && threeTestController) {
      setThreeOverlayVisible(true, true);
    }
    endRunScreen?.show({
      victory: payload.victory,
      reason: payload.reason,
      score: payload.score,
      seed: payload.seed,
      year: state.year,
      callsign: state.campaign.callsign.trim() || "Chief"
    });
    syncMusicContext();
  }

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
    endRunScreen?.hide();
    mapEditor?.close();
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
        },
        world: {
          getSettings: worldAudioControls.getSettings,
          setMuted: worldAudioControls.setMuted,
          setVolume: worldAudioControls.setVolume,
          onChange: worldAudioControls.onChange
        }
      },
      runtimeSettings: {
        getSettings: getRuntimeSettings,
        setSetting: setRuntimeSetting,
        updateSettings: updateRuntimeSettings,
        reset: resetRuntimeSettings,
        onChange: subscribeRuntimeSettings
      },
      onNewGame: () => {
        destroyTitleScreen();
        if (phaseUi && startNewRunButton) {
          startNewRunButton.click();
          return;
        }
        showFallbackMenu();
      },
      onMapEditor: () => {
        openMapEditor();
      },
      onFxLab: () => {
        destroyTitleScreen();
        mapEditor?.close();
        startMenu?.classList.add("hidden");
        characterScreen.classList.add("hidden");
        void openFxLab();
      },
      onSimLab: () => {
        destroyTitleScreen();
        mapEditor?.close();
        startMenu?.classList.add("hidden");
        characterScreen.classList.add("hidden");
        void openFireSimLab();
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
    endRunScreen?.hide();
    mapEditor?.close();
    isGenerating = true;
    const { seed, mapSize, characterId, chiefGender, callsign } = config;
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
      activeTerrainSource = cloneTerrainRecipe(config.options.terrain);
      resetState(state, seed);
      syncTimeSpeedControlMode();
      state.fireSettings = normalizeFireSettings(config.options.fire);
      setFuelProfiles(config.options.fuelProfiles);
      state.campaign.characterId = characterId;
      state.campaign.chiefGender = chiefGender;
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
      }, config.options.terrain);
      syncTileSoA(state);
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
      terrain: cloneTerrainRecipe(DEFAULT_RUN_OPTIONS.terrain),
      fire: { ...DEFAULT_RUN_OPTIONS.fire },
      fuelProfiles: { ...persistedFuelProfiles }
    },
    characterId: state.campaign.characterId,
    chiefGender: state.campaign.chiefGender,
    callsign: state.campaign.callsign
  };
  const initialRunConfig: NewRunConfig = resolveRunConfig(defaultRunConfig, persistedLastRunConfig);
  activeTerrainSource = cloneTerrainRecipe(initialRunConfig.options.terrain);
  let mapEditor: MapEditorHandle | null = null;
  const ensureMapEditor = (): MapEditorHandle => {
    if (mapEditor) {
      return mapEditor;
    }
    mapEditor = initMapEditor(getMapEditorRefs(), {
      onBackToMenu: () => {
        if (titleScreenEnabled) {
          showTitleScreen();
          return;
        }
        showFallbackMenu();
      }
    });
    return mapEditor;
  };
  const getLatestRunConfig = (): NewRunConfig => resolveRunConfig(defaultRunConfig, loadLastRunConfig());
  const showFallbackMenu = (): void => {
    startMenu?.classList.remove("hidden");
    characterScreen.classList.add("hidden");
    mapEditor?.close();
    state.paused = true;
    syncMusicContext();
  };
  const openMapEditor = (): void => {
    destroyTitleScreen();
    startMenu?.classList.add("hidden");
    characterScreen.classList.add("hidden");
    ensureMapEditor().open(getLatestRunConfig());
    state.paused = true;
    syncMusicContext();
  };

  if (threeTestEndRunButton) {
    threeTestEndRunButton.addEventListener("click", () => {
      if (activeThreeOverlayMode === "fx-lab" || activeThreeOverlayMode === "sim-lab") {
        returnToStartMenu();
        return;
      }
      endGame(state, false, "Run ended from 3D test.");
    });
  }
  threeTestRunMainMenuButton.addEventListener("click", () => {
    if (activeThreeOverlayMode !== "run") {
      return;
    }
    endGame(state, false, "Run ended from 3D test.");
    returnToMainMenu();
  });
  if (threeTestMainMenuButton) {
    threeTestMainMenuButton.addEventListener("click", () => {
      if (activeThreeOverlayMode === "fx-lab" || activeThreeOverlayMode === "sim-lab") {
        returnToMainMenu();
        return;
      }
      endGame(state, false, "Run ended from 3D test.");
      returnToMainMenu();
    });
  }
  if (threeTestOverlay) {
    threeTestOverlay.addEventListener("click", (event) => {
      if (event.target === threeTestOverlay) {
        if (activeThreeOverlayMode === "fx-lab") {
          closeFxLab();
          return;
        }
        if (activeThreeOverlayMode === "sim-lab") {
          closeFireSimLab();
          return;
        }
      }
    });
  }
  window.addEventListener(DEBUG_TYPE_EVENT, () => refreshThreeTestDebug());
  document.addEventListener("keydown", (event) => {
    const key = event.key.toLowerCase();
    if (event.ctrlKey && event.shiftKey && key === "p") {
      event.preventDefault();
      setRuntimeSetting("perf", !perfOverlayVisible);
      return;
    }
    if (key !== "f9" || event.ctrlKey || event.shiftKey || event.altKey || event.metaKey) {
      return;
    }
    if (!canUsePerfOverlayRunToggles() || !threeTestController) {
      return;
    }
    event.preventDefault();
    const nextHighlight = !threeTestController.getTerrainWaterDebugControls().waterfallDebugHighlight;
    setRunWaterfallHighlightEnabled(nextHighlight);
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
          onMapEditor: openMapEditor,
          onFxLab: () => openFxLab(),
          onSimLab: () => openFireSimLab(),
          overlayRefs,
          showStartMenuOnBind: false,
          startThreeOnConfirm: true,
          onMinimapPan: (tile) => {
            if (threeTestController) {
              threeTestController.panToTile(tile.x, tile.y);
              return;
            }
            renderState.cameraCenter = { x: tile.x + 0.5, y: tile.y + 0.5 };
          },
          uiAudio,
          musicControls,
          worldAudioControls
        });
      }
      startMenu?.classList.add("hidden");
      characterScreen.classList.add("hidden");
      mapEditorScreen.classList.add("hidden");
      state.paused = true;
      syncMusicContext();
      showTitleScreen();
    } else {
      if (!initialFxLabEnabled && !initialFireSimLabEnabled) {
        await resetGame(initialRunConfig);
      }
      if (!isHeadless() && phaseUi) {
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
          onMapEditor: openMapEditor,
          onFxLab: () => openFxLab(),
          onSimLab: () => openFireSimLab(),
          overlayRefs,
          showStartMenuOnBind: !initialFxLabEnabled && !initialFireSimLabEnabled,
          startThreeOnConfirm: true,
          onMinimapPan: (tile) => {
            if (threeTestController) {
              threeTestController.panToTile(tile.x, tile.y);
              return;
            }
            renderState.cameraCenter = { x: tile.x + 0.5, y: tile.y + 0.5 };
          },
          uiAudio,
          musicControls,
          worldAudioControls
        });
      }
      if (initialFxLabEnabled) {
        startMenu?.classList.add("hidden");
        characterScreen.classList.add("hidden");
        mapEditorScreen.classList.add("hidden");
        state.paused = true;
        syncMusicContext();
      }
    }
  
    const baseStep = 0.25;
  
    if (isHeadless()) {
      const ticks = 10000;
      const step = baseStep;
      for (let i = 0; i < ticks; i += 1) {
        stepSim(state, effectsState, rng, step);
        phaseUi?.sync(state, inputState);
      }
      console.log(`checksum:${computeChecksum(state)}`);
      return;
    }

    if (initialFxLabEnabled) {
      await openFxLab(initialFxLabScene);
    } else if (initialFireSimLabEnabled) {
      await openFireSimLab(initialFireSimLabScene);
    }
  
    startAppBootLoop({
      baseStep,
      mainHitchThresholdMs: MAIN_HITCH_THRESHOLD_MS,
      getFrameCapFps,
      getTimeSpeedValue: () => getActiveTimeSpeedValue(state),
      getMaxSimulationStep: () => getStrategicFireSimulationStepCap(state),
      isGenerating: () => isGenerating,
      isTitleScreenVisible: () => titleScreenVisible,
      isCharacterScreenVisible: () => !characterScreen.classList.contains("hidden"),
      isStartMenuVisible: () => (startMenu ? !startMenu.classList.contains("hidden") : false),
      isDocumentHidden: () => document.hidden,
      isThreeTestVisible: () =>
        !!threeTestController && !!threeTestOverlay && !threeTestOverlay.classList.contains("hidden"),
      isIncidentMode: () => state.simTimeMode === "incident",
      isThreeTestNoSim: isThreeTestNoSimEnabled,
      isSimulationEffectivelyPaused: () => isSimulationEffectivelyPaused(state),
      stepSimulation: (simStep: number) => {
        const simStartedAt = performance.now();
        stepSim(state, effectsState, rng, simStep);
        threeTestController?.captureFireSnapshot(asRenderSim(state));
        return performance.now() - simStartedAt;
      },
      onThreeTestFrame: (alpha: number) => {
        const uiStartedAt = performance.now();
        phaseUi?.sync(state, inputState);
        recordPerfSample("3d.phaseUi", performance.now() - uiStartedAt);
        const controller = threeTestController;
        controller?.setSimulationAlpha(alpha);
        if (isThreeTestSeasonalRecolorEnabled()) {
          syncThreeTestClimateVisuals();
        }
        if (controller && state.terrainDirty) {
          const activeFireTerrainPressure = hasActiveFireTerrainPressure();
          if (isThreeTestTerrainSyncDisabled()) {
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
      renderFrame: () => {},
      recordPerfSample,
      maybeUpdatePerfDiagnostics: (now: number) => {
        syncMusicContext();
        maybeUpdatePerfDiagnostics(now);
      }
    });
  };
  

  const dispose = (): void => {
    destroyTitleScreen();
    mapEditor?.destroy();
    mapEditor = null;
    closeThreeTest(true);
    closeFxLab();
    closeFireSimLab();
    endRunScreen?.destroy();
    endRunScreen = null;
    phaseUiDisposer?.();
    phaseUiDisposer = null;
    unsubscribeRuntimeSettings();
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
    openFxLab,
    openFireSimLab,
    dispose
  };
};






