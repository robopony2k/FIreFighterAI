import type {
  ClimateForecast,
  ClimateTimeline,
  DeployMode,
  FireSimWork,
  FireSettings,
  Grid,
  Point,
  SeasonPhase,
  Tile,
  Unit,
  Particle,
  Wind,
  TileType,
  RosterUnit
} from "./types.js";
import type { CampaignState } from "./campaign.js";

import { BASE_BUDGET, DEFAULT_FIRE_SETTINGS } from "./config.js";
import { createCampaignState } from "./campaign.js";
import { DEFAULT_CLIMATE_PARAMS, DEFAULT_MOISTURE_PARAMS } from "./climate.js";
import { buildNeighborOffsets } from "./grid.js";



// simPerf controls fast/approx modes in fire + heat simulation.

export type SimPerfConfig = {

  quality: 0 | 1 | 2;

  smokeRate: number;

  emberRateScale: number;

  useSnapshot: boolean;

  neighbourMode: 4 | 8;

};



export const TILE_TYPE_IDS: Record<TileType, number> = {
  water: 0,
  grass: 1,
  forest: 2,
  ash: 3,
  road: 4,
  base: 5,
  house: 6,
  firebreak: 7,
  beach: 8,
  floodplain: 9,
  scrub: 10,
  rocky: 11,
  bare: 12
};



export const TILE_ID_TO_TYPE: TileType[] = [
  "water",
  "grass",
  "forest",
  "ash",
  "road",
  "base",
  "house",
  "firebreak",
  "beach",
  "floodplain",
  "scrub",
  "rocky",
  "bare"
];



export interface WorldState {

  grid: Grid;

  tiles: Tile[];

  units: Unit[];

  waterParticles: Particle[];

  smokeParticles: Particle[];

  heatBuffer: Float32Array;

  tileFire: Float32Array;

  tileFuel: Float32Array;

  tileHeat: Float32Array;
  tileIgniteAt: Float32Array;

  tileIgnitionPoint: Float32Array;

  tileBurnRate: Float32Array;

  tileHeatOutput: Float32Array;

  tileElevation: Float32Array;
  tileMoisture: Float32Array;
  tileTypeId: Uint8Array;
  tileWaterDist: Uint16Array;
  tileRiverMask: Uint8Array;
  structureMask: Uint8Array;
  igniteMask: Uint8Array;
  tileSoaDirty: boolean;
  tileSoaPhase: SeasonPhase | null;
  neighborOffsets4: Int32Array;
  neighborOffsets8: Int32Array;
  igniteBuffer: Int32Array;
  baselineFireScratch: Float32Array;
  baselineHeatScratch: Float32Array;
  baselineNextHeat: Float32Array;
  igniteCount: number;

  simPerf: SimPerfConfig;

  colorNoiseMap: number[];

  valleyMap: number[];

  terrainDirty: boolean;

  basePoint: Point;

  seed: number;
  fireSettings: FireSettings;
  budget: number;

  burnedTiles: number;

  containedCount: number;

  totalLandTiles: number;

  lastActiveFires: number;

  paused: boolean;

  gameOver: boolean;

  wind: Wind;

  windTimer: number;

  deployMode: DeployMode | null;

  selectedUnitIds: number[];

  zoom: number;

  cameraCenter: Point;

  timeSpeedIndex: number;

  year: number;

  phaseIndex: number;

  phase: SeasonPhase;

  phaseDay: number;

  fireSeasonDay: number;

  fireSimAccumulator: number;

  fireWork: FireSimWork | null;

  fireBoundsActive: boolean;

  fireMinX: number;

  fireMaxX: number;

  fireMinY: number;

  fireMaxY: number;

  yearBurnedTiles: number;

  careerScore: number;

  approval: number;

  pendingBudget: number;

  totalPropertyValue: number;

  totalPopulation: number;

  lostPropertyValue: number;

  lostResidents: number;

  yearPropertyLost: number;

  yearLivesLost: number;

  totalHouses: number;

  destroyedHouses: number;

  clearLineStart: Point | null;

  formationStart: Point | null;

  formationEnd: Point | null;

  statusMessage: string;

  overlayVisible: boolean;

  overlayTitle: string;

  overlayMessage: string;

  overlayDetails: string[];

  overlayAction: "restart" | "dismiss";

  finalScore: number;

  scoreSubmitted: boolean;

  leaderboardDirty: boolean;

  campaign: CampaignState;

  renderTrees: boolean;
  renderEffects: boolean;
  fireSnapshot: Float32Array;
  renderFireSmooth: Float32Array;
  growthView: { zoom: number; camera: Point } | null;
  selectionBox: { x1: number; y1: number; x2: number; y2: number } | null;
  lastInteractionTime: number;
  lastRenderTime: number;
  roster: RosterUnit[];
  selectedRosterId: number | null;
  nextRosterId: number;
  debugIgniteMode: boolean;
  debugCellEnabled: boolean;
  debugTypeColors: boolean;
  debugHoverTile: Point | null;
  debugHoverWorld: Point | null;
  climateDay: number;
  climateYear: number;
  climateTemp: number;
  climateMoisture: number;
  climateIgnitionMultiplier: number;
  climateSpreadMultiplier: number;
  climateTimeline: ClimateTimeline | null;
  climateTimelineSeed: number;
  climateForecast: ClimateForecast | null;
  climateForecastStart: number;
  climateForecastDay: number;
  careerDay: number;
}


const DEFAULT_WIND: Wind = { name: "N", dx: 0, dy: -1, strength: 0.5 };



const createNumberArray = (size: number, fill = 0): number[] => Array.from({ length: size }, () => fill);



export function createInitialState(seed: number, grid: Grid): WorldState {

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
    tileMoisture: new Float32Array(grid.totalTiles),
    tileTypeId: new Uint8Array(grid.totalTiles),
    tileWaterDist: new Uint16Array(grid.totalTiles),
    tileRiverMask: new Uint8Array(grid.totalTiles),
    structureMask: new Uint8Array(grid.totalTiles),

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
    debugTypeColors: false,
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



export function syncTileSoA(state: WorldState): void {

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
    state.tileMoisture = new Float32Array(total);
    state.tileTypeId = new Uint8Array(total);
    state.tileWaterDist = new Uint16Array(total);
    state.tileRiverMask = new Uint8Array(total);
    state.structureMask = new Uint8Array(total);
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
  const moisture = state.tileMoisture;

  const typeId = state.tileTypeId;
  const waterDist = state.tileWaterDist;



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
    moisture[i] = tile.moisture;
    waterDist[i] = tile.waterDist;

  }



  state.tileSoaDirty = false;

  state.tileSoaPhase = state.phase;

}



export function resetState(state: WorldState, seed: number): void {

  const zoom = state.zoom;

  const grid = state.grid;

  Object.assign(state, createInitialState(seed, grid));

  state.zoom = zoom;

}



export function setStatus(state: WorldState, message: string): void {

  state.statusMessage = message;

}



export function resetStatus(state: WorldState): void {

  setStatus(state, "Ready.");

}



export function computeChecksum(state: WorldState): string {

  const typeWeights: Record<TileType, number> = {
    water: 1,
    grass: 2,
    forest: 3,
    ash: 4,
    road: 5,
    base: 6,
    house: 7,
    firebreak: 8,
    beach: 9,
    floodplain: 10,
    scrub: 11,
    rocky: 12,
    bare: 13
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



