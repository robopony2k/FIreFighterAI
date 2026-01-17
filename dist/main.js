import { BASE_BUDGET, MAP_SCALE, TIME_SPEED_OPTIONS, MAP_SIZE_PRESETS } from "./core/config.js";
import { getCharacterBaseBudget } from "./core/characters.js";
import { RNG } from "./core/rng.js";
import { computeChecksum, createInitialState, resetState } from "./core/state.js";
import { generateMap } from "./mapgen/index.js";
import { draw } from "./render/draw.js";
import { initPhaseUI } from "./ui/phase/index.js";
import { bindPhaseUi } from "./ui/phase/bindings.js";
import { getOverlayRefs, updateOverlay } from "./ui/overlay.js";
import { saveLeaderboard } from "./persistence/leaderboard.js";
import { randomizeWind } from "./sim/wind.js";
import { setPhase, stepSim } from "./sim/index.js";
import { seedStartingRoster } from "./sim/units.js";
import { PHASES } from "./core/time.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS } from "./ui/run-config.js";
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
if (!ctx) {
    throw new Error("Canvas not supported");
}
const baseCanvasWidth = canvas.width;
const baseCanvasHeight = canvas.height;
const gridScale = MAP_SCALE;
const buildGrid = (mapSize) => {
    const size = MAP_SIZE_PRESETS[mapSize];
    return {
        cols: size,
        rows: size,
        totalTiles: size * size
    };
};
let activeMapSize = DEFAULT_MAP_SIZE;
const grid = buildGrid(activeMapSize);
const params = new URLSearchParams(window.location.search);
const seedParam = params.get("seed");
const initialSeed = seedParam && !Number.isNaN(Number(seedParam)) ? Number(seedParam) : Math.floor(Date.now() % 1000000);
const headless = params.get("headless") === "1";
const state = createInitialState(initialSeed, grid);
const rng = new RNG(Date.now());
const phaseUiRoot = document.getElementById("phaseUI");
const phaseUi = phaseUiRoot ? initPhaseUI(phaseUiRoot) : null;
const overlayRefs = getOverlayRefs();
const characterScreen = document.getElementById("characterScreen");
const startMenu = document.getElementById("startMenu");
const canvasWrap = canvas.parentElement;
let resizeObserver = null;
let lastCanvasWidth = 0;
let lastCanvasHeight = 0;
const resizeCanvasToWrap = () => {
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
const watchCanvasSize = () => {
    if (!canvasWrap) {
        return;
    }
    resizeCanvasToWrap();
    if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => resizeCanvasToWrap());
        resizeObserver.observe(canvasWrap);
    }
    else {
        window.addEventListener("resize", resizeCanvasToWrap);
    }
};
const resetGame = (config) => {
    const { seed, mapSize, characterId, callsign } = config;
    if (activeMapSize !== mapSize) {
        activeMapSize = mapSize;
        state.grid = buildGrid(mapSize);
    }
    resetState(state, seed);
    state.campaign.characterId = characterId;
    state.campaign.callsign = callsign;
    const baseBudget = getCharacterBaseBudget(state.campaign.characterId, BASE_BUDGET);
    state.budget = baseBudget;
    state.pendingBudget = baseBudget;
    randomizeWind(state, rng);
    rng.setState(seed);
    generateMap(state, rng);
    seedStartingRoster(state, rng);
    state.cameraCenter = { x: state.basePoint.x + 0.5, y: state.basePoint.y + 0.5 };
    const maintenanceIndex = PHASES.findIndex((phase) => phase.id === "maintenance");
    state.phaseIndex = maintenanceIndex >= 0 ? maintenanceIndex : 1;
    setPhase(state, rng, "maintenance");
    state.leaderboardDirty = true;
    phaseUi?.sync(state);
    updateOverlay(overlayRefs, state);
};
const initialRunConfig = {
    seed: initialSeed,
    mapSize: activeMapSize,
    options: { ...DEFAULT_RUN_OPTIONS },
    characterId: state.campaign.characterId,
    callsign: state.campaign.callsign
};
watchCanvasSize();
resetGame(initialRunConfig);
if (!headless) {
    if (phaseUi) {
        bindPhaseUi(phaseUi, state, rng, canvas, resetGame, overlayRefs);
    }
}
const persistScoreIfNeeded = () => {
    if (!state.gameOver || state.scoreSubmitted) {
        return;
    }
    const callsign = state.campaign.callsign.trim() || "Chief";
    saveLeaderboard({ name: callsign, score: state.finalScore, seed: state.seed, date: Date.now() });
    state.scoreSubmitted = true;
    state.leaderboardDirty = true;
};
if (headless) {
    const ticks = 10000;
    const step = 0.1;
    for (let i = 0; i < ticks; i += 1) {
        stepSim(state, rng, step);
        phaseUi?.sync(state);
    }
    console.log(`checksum:${computeChecksum(state)}`);
}
else {
    let lastTick = 0;
    let accumulator = 0;
    const baseStep = 0.1;
    const frame = (now) => {
        if (!lastTick) {
            lastTick = now;
        }
        const startMenuVisible = startMenu ? !startMenu.classList.contains("hidden") : false;
        if (!characterScreen.classList.contains("hidden") || startMenuVisible || document.hidden) {
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
}
