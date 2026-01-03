import { BASE_BUDGET } from "./config.js";
const DEFAULT_WIND = { name: "N", dx: 0, dy: -1, strength: 0.5 };
const createNumberArray = (size, fill = 0) => Array.from({ length: size }, () => fill);
export function createInitialState(seed, grid) {
    return {
        grid,
        tiles: [],
        units: [],
        waterParticles: [],
        smokeParticles: [],
        heatBuffer: createNumberArray(grid.totalTiles, 0),
        colorNoiseMap: createNumberArray(grid.totalTiles, 0.5),
        valleyMap: createNumberArray(grid.totalTiles, 0),
        basePoint: { x: 0, y: 0 },
        seed,
        budget: BASE_BUDGET,
        burnedTiles: 0,
        containedCount: 0,
        totalLandTiles: 1,
        lastActiveFires: 0,
        paused: false,
        gameOver: false,
        wind: { ...DEFAULT_WIND },
        windTimer: 0,
        deployMode: null,
        selectedUnitId: null,
        zoom: 1,
        cameraCenter: { x: 0, y: 0 },
        year: 1,
        phaseIndex: 0,
        phase: "growth",
        phaseDay: 0,
        fireSeasonDay: 0,
        careerScore: 0,
        approval: 0.7,
        pendingBudget: BASE_BUDGET,
        totalPropertyValue: 0,
        totalPopulation: 0,
        lostPropertyValue: 0,
        lostResidents: 0,
        yearPropertyLost: 0,
        yearLivesLost: 0,
        totalHouses: 0,
        destroyedHouses: 0,
        clearLineStart: null,
        statusMessage: "Ready.",
        overlayVisible: false,
        overlayTitle: "Fireline",
        overlayMessage: "",
        finalScore: 0,
        scoreSubmitted: false,
        leaderboardDirty: true
    };
}
export function resetState(state, seed) {
    const zoom = state.zoom;
    const grid = state.grid;
    Object.assign(state, createInitialState(seed, grid));
    state.zoom = zoom;
}
export function setStatus(state, message) {
    state.statusMessage = message;
}
export function resetStatus(state) {
    setStatus(state, "Ready.");
}
export function computeChecksum(state) {
    const typeWeights = {
        water: 1,
        grass: 2,
        forest: 3,
        ash: 4,
        road: 5,
        base: 6,
        house: 7,
        firebreak: 8
    };
    let tileHash = 0;
    for (const tile of state.tiles) {
        const weight = typeWeights[tile.type];
        tileHash = (tileHash + weight + Math.floor(tile.fire * 10) + Math.floor(tile.fuel * 10)) % 1000000007;
    }
    const parts = [
        state.seed,
        state.year,
        state.phaseIndex,
        Math.floor(state.phaseDay * 100),
        Math.floor(state.fireSeasonDay * 100),
        Math.floor(state.budget),
        state.burnedTiles,
        state.containedCount,
        state.totalHouses,
        state.destroyedHouses,
        Math.floor(state.careerScore),
        Math.floor(state.approval * 1000),
        state.units.length,
        tileHash
    ];
    return parts.join("|");
}
