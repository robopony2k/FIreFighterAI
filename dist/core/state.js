import { BASE_BUDGET, DEFAULT_FIRE_SETTINGS } from "./config.js";
import { createCampaignState } from "./campaign.js";
import { DEFAULT_CLIMATE_PARAMS, DEFAULT_MOISTURE_PARAMS } from "./climate.js";
import { buildNeighborOffsets } from "./grid.js";
export const TILE_TYPE_IDS = {
    water: 0,
    grass: 1,
    forest: 2,
    ash: 3,
    road: 4,
    base: 5,
    house: 6,
    firebreak: 7
};
export const TILE_ID_TO_TYPE = [
    "water",
    "grass",
    "forest",
    "ash",
    "road",
    "base",
    "house",
    "firebreak"
];
const DEFAULT_WIND = { name: "N", dx: 0, dy: -1, strength: 0.5 };
const createNumberArray = (size, fill = 0) => Array.from({ length: size }, () => fill);
export function createInitialState(seed, grid) {
    return {
        grid,
        tiles: [],
        units: [],
        waterParticles: [],
        smokeParticles: [],
        heatBuffer: new Float32Array(grid.totalTiles),
        tileFire: new Float32Array(grid.totalTiles),
        tileFuel: new Float32Array(grid.totalTiles),
        tileHeat: new Float32Array(grid.totalTiles),
        tileIgniteAt: new Float32Array(grid.totalTiles).fill(Number.POSITIVE_INFINITY),
        tileIgnitionPoint: new Float32Array(grid.totalTiles),
        tileBurnRate: new Float32Array(grid.totalTiles),
        tileHeatOutput: new Float32Array(grid.totalTiles),
        baselineFireScratch: new Float32Array(grid.totalTiles),
        baselineHeatScratch: new Float32Array(grid.totalTiles),
        baselineNextHeat: new Float32Array(grid.totalTiles),
        tileElevation: new Float32Array(grid.totalTiles),
        tileTypeId: new Uint8Array(grid.totalTiles),
        tileSoaDirty: true,
        tileSoaPhase: null,
        neighborOffsets4: buildNeighborOffsets(grid.cols, 4),
        neighborOffsets8: buildNeighborOffsets(grid.cols, 8),
        igniteBuffer: new Int32Array(grid.totalTiles),
        igniteMask: new Uint8Array(grid.totalTiles),
        igniteCount: 0,
        simPerf: {
            quality: 1,
            smokeRate: 1,
            emberRateScale: 1,
            useSnapshot: true,
            neighbourMode: 8
        },
        colorNoiseMap: createNumberArray(grid.totalTiles, 0.5),
        valleyMap: createNumberArray(grid.totalTiles, 0),
        terrainDirty: true,
        basePoint: { x: 0, y: 0 },
        seed,
        fireSettings: { ...DEFAULT_FIRE_SETTINGS },
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
        selectedUnitIds: [],
        zoom: 1,
        cameraCenter: { x: 0, y: 0 },
        timeSpeedIndex: 0,
        year: 1,
        phaseIndex: 0,
        phase: "growth",
        phaseDay: 0,
        fireSeasonDay: 0,
        fireSimAccumulator: 0,
        fireWork: null,
        fireBoundsActive: false,
        fireMinX: 0,
        fireMaxX: 0,
        fireMinY: 0,
        fireMaxY: 0,
        yearBurnedTiles: 0,
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
        formationStart: null,
        formationEnd: null,
        statusMessage: "Ready.",
        overlayVisible: false,
        overlayTitle: "Fireline",
        overlayMessage: "",
        overlayDetails: [],
        overlayAction: "dismiss",
        finalScore: 0,
        scoreSubmitted: false,
        leaderboardDirty: true,
        campaign: createCampaignState(),
        renderTrees: true,
        renderEffects: true,
        debugIgniteMode: false,
        debugCellEnabled: true,
        debugHoverTile: null,
        debugHoverWorld: null,
        climateDay: 0,
        climateYear: 0,
        climateTemp: DEFAULT_CLIMATE_PARAMS.tMid,
        climateMoisture: DEFAULT_MOISTURE_PARAMS.Mmax,
        climateIgnitionMultiplier: 1,
        climateSpreadMultiplier: 1,
        climateTimeline: null,
        climateTimelineSeed: -1,
        climateForecast: null,
        climateForecastStart: -1,
        climateForecastDay: 0,
        careerDay: 0,
        fireSnapshot: new Float32Array(grid.totalTiles),
        renderFireSmooth: new Float32Array(grid.totalTiles),
        growthView: null,
        selectionBox: null,
        lastInteractionTime: 0,
        lastRenderTime: 0,
        roster: [],
        selectedRosterId: null,
        nextRosterId: 1
    };
}
export function syncTileSoA(state) {
    const total = state.grid.totalTiles;
    if (state.tileFire.length !== total) {
        state.tileFire = new Float32Array(total);
        state.tileFuel = new Float32Array(total);
        state.tileHeat = new Float32Array(total);
        state.tileIgniteAt = new Float32Array(total).fill(Number.POSITIVE_INFINITY);
        state.tileIgnitionPoint = new Float32Array(total);
        state.tileBurnRate = new Float32Array(total);
        state.tileHeatOutput = new Float32Array(total);
        state.tileElevation = new Float32Array(total);
        state.tileTypeId = new Uint8Array(total);
        state.heatBuffer = new Float32Array(total);
        state.fireSnapshot = new Float32Array(total);
        state.renderFireSmooth = new Float32Array(total);
        state.igniteBuffer = new Int32Array(total);
        state.igniteMask = new Uint8Array(total);
        state.baselineFireScratch = new Float32Array(total);
        state.baselineHeatScratch = new Float32Array(total);
        state.baselineNextHeat = new Float32Array(total);
        state.neighborOffsets4 = buildNeighborOffsets(state.grid.cols, 4);
        state.neighborOffsets8 = buildNeighborOffsets(state.grid.cols, 8);
    }
    const tiles = state.tiles;
    const fire = state.tileFire;
    const fuel = state.tileFuel;
    const heat = state.tileHeat;
    const ignition = state.tileIgnitionPoint;
    const burnRate = state.tileBurnRate;
    const heatOutput = state.tileHeatOutput;
    const elevation = state.tileElevation;
    const typeId = state.tileTypeId;
    for (let i = 0; i < tiles.length; i += 1) {
        const tile = tiles[i];
        fire[i] = tile.fire;
        fuel[i] = tile.fuel;
        heat[i] = tile.heat;
        ignition[i] = tile.ignitionPoint;
        burnRate[i] = tile.burnRate;
        heatOutput[i] = tile.heatOutput;
        elevation[i] = tile.elevation;
        typeId[i] = TILE_TYPE_IDS[tile.type];
    }
    state.tileSoaDirty = false;
    state.tileSoaPhase = state.phase;
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
