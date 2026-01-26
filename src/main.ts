import { BASE_BUDGET, TILE_SIZE, MAP_SCALE, TIME_SPEED_OPTIONS, MAP_SIZE_PRESETS } from "./core/config.js";
import type { MapSizeId } from "./core/config.js";
import { getCharacterBaseBudget } from "./core/characters.js";
import { RNG } from "./core/rng.js";
import { computeChecksum, createInitialState, resetState, syncTileSoA } from "./core/state.js";
import { TREE_TYPE_IDS } from "./core/types.js";
import { generateMap, type MapGenDebug, type MapGenDebugSnapshot } from "./mapgen/index.js";
import { draw } from "./render/draw.js";
import { resetTerrainCaches } from "./render/terrainCache.js";
import { createThreeTest } from "./render/threeTest.js";
import { initPhaseUI } from "./ui/phase/index.js";
import { bindPhaseUi } from "./ui/phase/bindings.js";
import { buildMapGenControls } from "./ui/mapgen-controls.js";
import { getOverlayRefs, updateOverlay } from "./ui/overlay.js";
import { saveLeaderboard } from "./persistence/leaderboard.js";
import { randomizeWind } from "./sim/wind.js";
import { setPhase, stepSim } from "./sim/index.js";
import { seedStartingRoster } from "./sim/units.js";
import { PHASES } from "./core/time.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS, normalizeFireSettings } from "./ui/run-config.js";
import type { NewRunConfig } from "./ui/run-config.js";

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
const seedParam = params.get("seed");
const initialSeed = seedParam && !Number.isNaN(Number(seedParam)) ? Number(seedParam) : Math.floor(Date.now() % 1000000);
const headless = params.get("headless") === "1";

const state = createInitialState(initialSeed, grid);
const rng = new RNG(Date.now());
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
const phaseUiRoot = document.getElementById("phaseUI") as HTMLDivElement | null;
const phaseUi = phaseUiRoot ? initPhaseUI(phaseUiRoot) : null;
const overlayRefs = getOverlayRefs();
buildMapGenControls();
const characterScreen = document.getElementById("characterScreen") as HTMLDivElement;
const startMenu = document.getElementById("startMenu") as HTMLDivElement | null;
const canvasWrap = canvas.parentElement as HTMLElement | null;
const mapgenOverlay = document.getElementById("mapgenOverlay") as HTMLDivElement | null;
const mapgenMessage = document.getElementById("mapgenMessage") as HTMLDivElement | null;
const mapgenProgressBar = document.getElementById("mapgenProgressBar") as HTMLDivElement | null;
const mapgenPercent = document.getElementById("mapgenPercent") as HTMLDivElement | null;
const threeTestOverlay = document.getElementById("threeTestOverlay") as HTMLDivElement | null;
const threeTestCanvas = document.getElementById("threeTestCanvas") as HTMLCanvasElement | null;
const threeTestCloseButton = document.getElementById("threeTestClose") as HTMLButtonElement | null;
const threeTestStepButton = document.getElementById("threeTestStep") as HTMLButtonElement | null;
const threeTestAutoToggle = document.getElementById("threeTestAuto") as HTMLInputElement | null;
const threeTestPhaseLabel = document.getElementById("threeTestPhase") as HTMLSpanElement | null;
const threeTestSeason = document.getElementById("threeTestSeason") as HTMLInputElement | null;
const threeTestSeasonLabel = document.getElementById("threeTestSeasonLabel") as HTMLSpanElement | null;
const DEBUG_TYPE_EVENT = "debug-type-colors-changed";
const THREE_TEST_SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;
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
let threeTestStepController: {
  waitForStep: () => Promise<void>;
  next: () => void;
  setAuto: (auto: boolean) => void;
  auto: boolean;
} | null = null;

const updateThreeTestStepUi = (): void => {
  if (!threeTestStepButton || !threeTestStepController) {
    return;
  }
  threeTestStepButton.disabled = threeTestStepController.auto;
};

const updateThreeTestSeasonUi = (value?: number): number => {
  const raw = value ?? (threeTestSeason ? Number(threeTestSeason.value) : 1);
  const clamped = Math.max(0, Math.min(THREE_TEST_SEASONS.length - 1, Math.round(raw)));
  if (threeTestSeason) {
    threeTestSeason.value = String(clamped);
  }
  if (threeTestSeasonLabel) {
    threeTestSeasonLabel.textContent = THREE_TEST_SEASONS[clamped] ?? "Summer";
  }
  return clamped;
};

if (threeTestStepButton) {
  threeTestStepButton.addEventListener("click", () => {
    threeTestStepController?.next();
  });
}

if (threeTestAutoToggle) {
  threeTestAutoToggle.addEventListener("change", () => {
    threeTestStepController?.setAuto(threeTestAutoToggle.checked);
    updateThreeTestStepUi();
  });
}
if (threeTestSeason) {
  threeTestSeason.addEventListener("input", () => {
    const index = updateThreeTestSeasonUi();
    threeTestController?.setSeason(index);
  });
}
const handleThreeResize = (): void => {
  threeTestController?.resize();
};

const setThreeTestVisible = (visible: boolean): void => {
  if (!threeTestOverlay) {
    return;
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
    }
    resetTerrainCaches();
    resetState(state, seed);
    rng.setState(seed);
    state.paused = true;
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

const openThreeTest = async (config: NewRunConfig): Promise<void> => {
  if (!threeTestOverlay || !threeTestCanvas) {
    return;
  }
  if (!threeTestController) {
    threeTestController = createThreeTest(threeTestCanvas);
  }
  if (threeTestController) {
    threeTestController.setSeason(updateThreeTestSeasonUi());
  }
  if (!threeTestStepController) {
    let auto = threeTestAutoToggle ? threeTestAutoToggle.checked : true;
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
  if (threeTestAutoToggle) {
    threeTestStepController.setAuto(threeTestAutoToggle.checked);
  }
  updateThreeTestStepUi();
  setThreeTestVisible(true);
  threeTestController.start();
  handleThreeResize();
  window.addEventListener("resize", handleThreeResize);
  const debug: MapGenDebug = {
    onPhase: async (snapshot: MapGenDebugSnapshot) => {
      if (threeTestPhaseLabel) {
        threeTestPhaseLabel.textContent = snapshot.phase;
      }
      if (!threeTestController) {
        return;
      }
      threeTestController.setTerrain({
        cols: state.grid.cols,
        rows: state.grid.rows,
        elevations: snapshot.elevations,
        tileTypes: snapshot.tileTypes,
        treeTypes: buildTreeTypeMap(),
        riverMask: snapshot.riverMask,
        debugTypeColors: state.debugTypeColors,
        treesEnabled: snapshot.phase === "tiles:classified"
      });
    },
    waitForStep: () => threeTestStepController?.waitForStep() ?? Promise.resolve()
  };
  await prepareTerrainPreview(config, debug);
  syncTileSoA(state);
  threeTestController.setTerrain({
    cols: state.grid.cols,
    rows: state.grid.rows,
    elevations: state.tileElevation,
    tileTypes: state.tileTypeId,
    treeTypes: buildTreeTypeMap(),
    riverMask: state.tileRiverMask,
    debugTypeColors: state.debugTypeColors,
    treesEnabled: true
  });
};

const closeThreeTest = (): void => {
  if (!threeTestOverlay) {
    return;
  }
  setThreeTestVisible(false);
  threeTestController?.stop();
  window.removeEventListener("resize", handleThreeResize);
  threeTestStepController?.setAuto(true);
  updateThreeTestStepUi();
};

const refreshThreeTestDebug = (): void => {
  if (!threeTestOverlay || threeTestOverlay.classList.contains("hidden")) {
    return;
  }
  if (!threeTestController) {
    return;
  }
  syncTileSoA(state);
  threeTestController.setTerrain({
    cols: state.grid.cols,
    rows: state.grid.rows,
    elevations: state.tileElevation,
    tileTypes: state.tileTypeId,
    treeTypes: buildTreeTypeMap(),
    riverMask: state.tileRiverMask,
    debugTypeColors: state.debugTypeColors,
    treesEnabled: true
  });
};

const resetGame = async (config: NewRunConfig) => {
  if (isGenerating) {
    return;
  }
  isGenerating = true;
  const { seed, mapSize, characterId, callsign } = config;
  try {
    if (activeMapSize !== mapSize) {
      activeMapSize = mapSize;
      state.grid = buildGrid(mapSize);
    }
    resetTerrainCaches();
    resetState(state, seed);
    state.fireSettings = normalizeFireSettings(config.options.fire);
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
  state.cameraCenter = { x: state.basePoint.x + 0.5, y: state.basePoint.y + 0.5 };
  const maintenanceIndex = PHASES.findIndex((phase) => phase.id === "maintenance");
  state.phaseIndex = maintenanceIndex >= 0 ? maintenanceIndex : 1;
  setPhase(state, rng, "maintenance");
  state.leaderboardDirty = true;
  phaseUi?.sync(state);
  updateOverlay(overlayRefs, state);
};

const initialRunConfig: NewRunConfig = {
  seed: initialSeed,
  mapSize: activeMapSize,
  options: {
    ...DEFAULT_RUN_OPTIONS,
    mapGen: { ...DEFAULT_RUN_OPTIONS.mapGen },
    fire: { ...DEFAULT_RUN_OPTIONS.fire }
  },
  characterId: state.campaign.characterId,
  callsign: state.campaign.callsign
};

if (threeTestCloseButton) {
  threeTestCloseButton.addEventListener("click", () => closeThreeTest());
}
if (threeTestOverlay) {
  threeTestOverlay.addEventListener("click", (event) => {
    if (event.target === threeTestOverlay) {
      closeThreeTest();
    }
  });
}
window.addEventListener(DEBUG_TYPE_EVENT, () => refreshThreeTestDebug());

watchCanvasSize();

const persistScoreIfNeeded = () => {
  if (!state.gameOver || state.scoreSubmitted) {
    return;
  }
  const callsign = state.campaign.callsign.trim() || "Chief";
  saveLeaderboard({ name: callsign, score: state.finalScore, seed: state.seed, date: Date.now() });
  state.scoreSubmitted = true;
  state.leaderboardDirty = true;
};

const boot = async () => {
  await resetGame(initialRunConfig);

  if (!headless) {
    if (phaseUi) {
      bindPhaseUi(phaseUi, state, rng, canvas, resetGame, openThreeTest, overlayRefs);
    }
  }

  if (headless) {
    const ticks = 10000;
    const step = 0.1;
    for (let i = 0; i < ticks; i += 1) {
      stepSim(state, rng, step);
      phaseUi?.sync(state);
    }
    console.log(`checksum:${computeChecksum(state)}`);
    return;
  }

  let lastTick = 0;
  let accumulator = 0;
  const baseStep = 0.1;

  const frame = (now: number) => {
    if (!lastTick) {
      lastTick = now;
    }
    const startMenuVisible = startMenu ? !startMenu.classList.contains("hidden") : false;
    if (isGenerating || !characterScreen.classList.contains("hidden") || startMenuVisible || document.hidden) {
      lastTick = now;
      accumulator = 0;
      requestAnimationFrame(frame);
      return;
    }
    const delta = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;
    accumulator += delta;
    const speedIndex = Math.min(Math.max(state.timeSpeedIndex, 0), TIME_SPEED_OPTIONS.length - 1);
    const simStep = baseStep * (TIME_SPEED_OPTIONS[speedIndex] ?? 1);
    while (accumulator >= baseStep) {
      stepSim(state, rng, simStep);
      accumulator -= baseStep;
    }
    const alpha = state.paused || state.gameOver ? 1 : Math.min(1, Math.max(0, accumulator / baseStep));
    persistScoreIfNeeded();
    phaseUi?.sync(state);
    updateOverlay(overlayRefs, state);
    draw(state, canvas, ctx, alpha);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
};

void boot();
