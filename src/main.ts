import { BASE_BUDGET, TILE_SIZE } from "./core/config.js";
import { getCharacterBaseBudget } from "./core/characters.js";
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
import { seedStartingRoster } from "./sim/units.js";
import { PHASES } from "./core/time.js";

const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
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

const resetGame = (seed: number) => {
  resetState(state, seed);
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
};

resetGame(initialSeed);

if (!headless) {
  bindUI(ui, state, rng, canvas, resetGame);
}

const persistScoreIfNeeded = () => {
  if (!state.gameOver || state.scoreSubmitted) {
    return;
  }
  const callsign = state.campaign.callsign.trim() || ui.callsignInput.value.trim() || "Chief";
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
} else {
  let lastTick = 0;
  let accumulator = 0;
  let lastHudUpdate = 0;
  const hudIntervalMs = 150;
  const step = 0.1;

  const frame = (now: number) => {
    if (!lastTick) {
      lastTick = now;
    }
    if (!ui.characterScreen.classList.contains("hidden") || document.hidden) {
      lastTick = now;
      accumulator = 0;
      requestAnimationFrame(frame);
      return;
    }
    const delta = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;
    accumulator += delta;
    while (accumulator >= step) {
      stepSim(state, rng, step);
      accumulator -= step;
    }
    persistScoreIfNeeded();
    if (now - lastHudUpdate >= hudIntervalMs) {
      updateHud(ui, state);
      lastHudUpdate = now;
    }
    draw(state, canvas, ctx);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}
