import { TILE_SIZE } from "./core/config.js";
import { RNG } from "./core/rng.js";
import { computeChecksum, createInitialState, resetState } from "./core/state.js";
import { generateMap } from "./mapgen/index.js";
import { draw } from "./render/draw.js";
import { getUIRefs } from "./ui/dom.js";
import { bindUI } from "./ui/bindings.js";
import { updateHud } from "./ui/hud.js";
import { saveLeaderboard } from "./persistence/leaderboard.js";
import { randomizeWind } from "./sim/wind.js";
import { setPhase, stepSim } from "./sim/index.js";
const canvas = document.getElementById("gameCanvas");
const ctx = canvas.getContext("2d");
if (!ctx) {
    throw new Error("Canvas not supported");
}
const gridCols = Math.floor(canvas.width / TILE_SIZE);
const gridRows = Math.floor(canvas.height / TILE_SIZE);
const grid = {
    cols: gridCols,
    rows: gridRows,
    totalTiles: gridCols * gridRows
};
const params = new URLSearchParams(window.location.search);
const seedParam = params.get("seed");
const initialSeed = seedParam && !Number.isNaN(Number(seedParam)) ? Number(seedParam) : Math.floor(Date.now() % 1000000);
const headless = params.get("headless") === "1";
const ui = getUIRefs();
const state = createInitialState(initialSeed, grid);
const rng = new RNG(Date.now());
const resetGame = (seed) => {
    resetState(state, seed);
    randomizeWind(state, rng);
    rng.setState(seed);
    generateMap(state, rng);
    state.cameraCenter = { x: state.basePoint.x + 0.5, y: state.basePoint.y + 0.5 };
    setPhase(state, rng, "growth");
    state.leaderboardDirty = true;
};
resetGame(initialSeed);
if (!headless) {
    bindUI(ui, state, rng, canvas, resetGame);
}
const persistScoreIfNeeded = () => {
    if (!state.gameOver || state.scoreSubmitted) {
        return;
    }
    const callsign = ui.callsignInput.value.trim() || "Chief";
    saveLeaderboard({ name: callsign, score: state.finalScore, seed: state.seed, date: Date.now() });
    state.scoreSubmitted = true;
    state.leaderboardDirty = true;
};
if (headless) {
    const ticks = 10000;
    const step = 0.1;
    for (let i = 0; i < ticks; i += 1) {
        stepSim(state, rng, step);
    }
    console.log(`checksum:${computeChecksum(state)}`);
}
else {
    let lastTick = 0;
    let accumulator = 0;
    const step = 0.1;
    const frame = (now) => {
        if (!lastTick) {
            lastTick = now;
        }
        const delta = Math.min(0.25, (now - lastTick) / 1000);
        lastTick = now;
        accumulator += delta;
        while (accumulator >= step) {
            stepSim(state, rng, step);
            accumulator -= step;
        }
        persistScoreIfNeeded();
        updateHud(ui, state);
        draw(state, canvas, ctx);
        requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
}
