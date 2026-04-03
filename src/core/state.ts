import type {
  CommandUnit,
  ClimateForecast,
  ClimateTimeline,
  DeployMode,
  FireAlertIncident,
  FireSimWork,
  FireSettings,
  Grid,
  Point,
  ScoringState,
  SelectionScope,
  SimTimeMode,
  SkipToNextFireState,
  Town,
  SeasonPhase,
  Tile,
  Unit,
  Particle,
  Wind,
  TileType,
  RosterUnit
} from "./types.js";
import type { CampaignState } from "./campaign.js";

import { BASE_BUDGET, DEFAULT_FIRE_SETTINGS, DEFAULT_INCIDENT_TIME_SPEED_INDEX } from "./config.js";
import { createCampaignState } from "./campaign.js";
import { DEFAULT_CLIMATE_PARAMS, DEFAULT_MOISTURE_PARAMS } from "./climate.js";
import { buildNeighborOffsets } from "./grid.js";



// simPerf controls fast/approx modes in fire + heat simulation.

export type SimPerfConfig = {

  quality: 0 | 1 | 2;

  fireQuality: 0 | 1 | 2;

  smokeRate: number;

  smokeSampleRate: number;

  emberRateScale: number;

  jumpRateScale: number;

  useSnapshot: boolean;

  neighbourMode: 4 | 8;

  diffusionEps: number;

  blockSize: number;

  growthBlocksPerTick: number;

  pathEpsilon: number;

  pathMaxExpansions: number;

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

export const COAST_CLASS_NONE = 0;
export const COAST_CLASS_BEACH = 1;
export const COAST_CLASS_CLIFF = 2;
export const COAST_CLASS_SHELF_WATER = 3;

export type CoastClassId =
  | typeof COAST_CLASS_NONE
  | typeof COAST_CLASS_BEACH
  | typeof COAST_CLASS_CLIFF
  | typeof COAST_CLASS_SHELF_WATER;



export interface WorldState {

  grid: Grid;

  tiles: Tile[];

  units: Unit[];

  heatBuffer: Float32Array;

  tileFire: Float32Array;

  tileFuel: Float32Array;

  tileHeat: Float32Array;
  tileSuppressionWetness: Float32Array;
  tileIgniteAt: Float32Array;

  tileIgnitionPoint: Float32Array;

  tileBurnRate: Float32Array;

  tileHeatOutput: Float32Array;

  tileElevation: Float32Array;
  tileMoisture: Float32Array;
  tileVegetationAge: Float32Array;
  tileCanopyCover: Float32Array;
  tileStemDensity: Uint8Array;
  tileSpreadBoost: Float32Array;
  tileHeatRetention: Float32Array;
  tileWindFactor: Float32Array;
  tileHeatTransferCap: Float32Array;
  tileTypeId: Uint8Array;
  tileRiverMask: Uint8Array;
  tileOceanMask: Uint8Array;
  tileSeaLevel: Float32Array;
  tileCoastDistance: Uint16Array;
  tileCoastClass: Uint8Array;
  tileRoadBridge: Uint8Array;
  tileRoadEdges: Uint8Array;
  tileRoadWallEdges: Uint8Array;
  tileRiverBed: Float32Array;
  tileRiverSurface: Float32Array;
  tileRiverStepStrength: Float32Array;
  structureMask: Uint8Array;
  tileTownId: Int16Array;
  tileStructure: Uint8Array;
  igniteMask: Uint8Array;
  tileSoaDirty: boolean;
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
  terrainTypeRevision: number;
  vegetationRevision: number;
  structureRevision: number;

  basePoint: Point;
  towns: Town[];
  townGrowthAppliedYear: number;
  townAlertDayAccumulator: number;

  seed: number;
  fireSettings: FireSettings;
  budget: number;

  burnedTiles: number;

  containedCount: number;

  totalLandTiles: number;

  lastActiveFires: number;
  latestFireAlert: FireAlertIncident | null;
  nextFireAlertId: number;
  skipToNextFire: SkipToNextFireState | null;

  paused: boolean;

  gameOver: boolean;

  wind: Wind;

  windTimer: number;

  deployMode: DeployMode | null;

  selectedUnitIds: number[];
  selectedCommandUnitIds: number[];
  selectedTruckIds: number[];
  selectionScope: SelectionScope;
  focusedCommandUnitId: number | null;
  commandUnits: CommandUnit[];
  nextCommandUnitId: number;
  commandUnitsRevision: number;

  simTimeMode: SimTimeMode;
  timeSpeedIndex: number;
  strategicTimeSpeedIndex: number;
  incidentTimeSpeedIndex: number;

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
  scoring: ScoringState;

  pendingBudget: number;
  annualReportOpen: boolean;

  totalPropertyValue: number;

  totalPopulation: number;

  lostPropertyValue: number;

  lostResidents: number;

  yearPropertyLost: number;

  yearLivesLost: number;

  totalHouses: number;
  settlementRequestedHouses: number;
  settlementPlacedHouses: number;
  settlementPadReliefMax: number;
  settlementPadReliefMean: number;

  destroyedHouses: number;

  statusMessage: string;

  finalScore: number;

  campaign: CampaignState;

  fireSnapshot: Float32Array;
  roster: RosterUnit[];
  selectedRosterId: number | null;
  nextRosterId: number;
  nextUnitId: number;
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

  fireBlockSize: number;
  fireBlockCols: number;
  fireBlockRows: number;
  fireBlockCount: number;
  fireBlockFlags: Uint8Array;
  fireBlockActiveList: Int32Array;
  fireBlockWorkList: Int32Array;
  fireBlockNextList: Int32Array;
  fireBlockActiveCount: number;
  fireBlockWorkCount: number;
  fireBlockNextCount: number;
  tileBlockIndex: Int32Array;
  heatStamp: Uint32Array;
  heatStampId: number;
  fireScheduledCount: number;
  firePerfActiveBlocks: number;
  firePerfWorkBlocks: number;
  firePerfFireBoundsArea: number;
  firePerfHeatBoundsArea: number;
  firePerfSubsteps: number;
  firePerfSimulatedDays: number;
  growthBlockCursor: number;
  pathPrev: Int32Array;
  pathGScore: Float32Array;
  pathVisitStamp: Uint32Array;
  pathClosedStamp: Uint32Array;
  pathStamp: number;
  pathOpenIdx: Int32Array;
  pathOpenF: Float32Array;
  pathOpenSize: number;
  pathNodesExpanded: number;
  pathMaxOpenSize: number;
  pathLastNodesExpanded: number;
}


const DEFAULT_WIND: Wind = { name: "N", dx: 0, dy: -1, strength: 0.5 };



const createNumberArray = (size: number, fill = 0): number[] => Array.from({ length: size }, () => fill);

const createInitialScoringState = (grid: Grid): ScoringState => ({
  grossPoints: 0,
  lossPenalties: 0,
  score: 0,
  difficultyMult: 1,
  approvalMult: 1,
  streakMult: 1,
  riskMult: 1,
  totalMult: 1,
  approvalTier: "B",
  riskTier: "low",
  approval01: 0.7,
  nextApprovalTier: "A",
  nextApprovalThreshold01: 0.75,
  nextTierProgress01: 0,
  noHouseLossDays: 0,
  noLifeLossDays: 0,
  dayAccumulator: 0,
  hadHouseLossToday: false,
  hadLifeLossToday: false,
  seasonExtinguishedCount: 0,
  seasonExtinguishPoints: 0,
  seasonPropertyDamageCount: 0,
  seasonPropertyDamagePenalties: 0,
  seasonDestroyedHouseCount: 0,
  seasonCriticalAssetLossCount: 0,
  seasonHouseLossPenalties: 0,
  seasonCriticalAssetLossPenalties: 0,
  seasonLivesLostCount: 0,
  seasonCivilianLivesLost: 0,
  seasonFirefighterLivesLost: 0,
  seasonLifeLossPenalties: 0,
  seasonCivilianLifeLossPenalties: 0,
  seasonFirefighterLifeLossPenalties: 0,
  seasonMultipliedPositivePoints: 0,
  seasonStartScore: 0,
  seasonFinalScore: 0,
  seasonApprovalMultIntegral: 0,
  seasonRiskMultIntegral: 0,
  seasonSampleSeconds: 0,
  seasonSummary: null,
  events: [],
  flowEvents: [],
  nextEventId: 1,
  nextFlowEventId: 1,
  previousDestroyedHouses: 0,
  previousLostResidents: 0,
  previousLostFirefighters: 0,
  previousTownHousesLost: new Int32Array(0),
  burnStartFuel: new Float32Array(grid.totalTiles).fill(-1),
  lastSuppressedAt: new Float32Array(grid.totalTiles).fill(Number.NEGATIVE_INFINITY),
  pendingFlowEvents: [],
  attributedFireLossTiles: new Set<number>(),
  prevFireBoundsActive: false,
  prevFireMinX: 0,
  prevFireMaxX: 0,
  prevFireMinY: 0,
  prevFireMaxY: 0
});



export function createInitialState(seed: number, grid: Grid): WorldState {
  const blockSize = 16;
  const blockCols = Math.max(1, Math.ceil(grid.cols / blockSize));
  const blockRows = Math.max(1, Math.ceil(grid.rows / blockSize));
  const blockCount = blockCols * blockRows;
  const tileBlockIndex = new Int32Array(grid.totalTiles);
  for (let i = 0; i < grid.totalTiles; i += 1) {
    const x = i % grid.cols;
    const y = Math.floor(i / grid.cols);
    const bx = Math.floor(x / blockSize);
    const by = Math.floor(y / blockSize);
    tileBlockIndex[i] = by * blockCols + bx;
  }

  return {

    grid,

    tiles: [],

    units: [],

    heatBuffer: new Float32Array(grid.totalTiles),
    tileFire: new Float32Array(grid.totalTiles),
    tileFuel: new Float32Array(grid.totalTiles),
    tileHeat: new Float32Array(grid.totalTiles),
    tileSuppressionWetness: new Float32Array(grid.totalTiles),
    tileIgniteAt: new Float32Array(grid.totalTiles).fill(Number.POSITIVE_INFINITY),
    tileIgnitionPoint: new Float32Array(grid.totalTiles),
    tileBurnRate: new Float32Array(grid.totalTiles),
    tileHeatOutput: new Float32Array(grid.totalTiles),
    baselineFireScratch: new Float32Array(grid.totalTiles),
    baselineHeatScratch: new Float32Array(grid.totalTiles),
    baselineNextHeat: new Float32Array(grid.totalTiles),
    tileElevation: new Float32Array(grid.totalTiles),
    tileMoisture: new Float32Array(grid.totalTiles),
    tileVegetationAge: new Float32Array(grid.totalTiles),
    tileCanopyCover: new Float32Array(grid.totalTiles),
    tileStemDensity: new Uint8Array(grid.totalTiles),
    tileSpreadBoost: new Float32Array(grid.totalTiles),
    tileHeatRetention: new Float32Array(grid.totalTiles),
    tileWindFactor: new Float32Array(grid.totalTiles),
    tileHeatTransferCap: new Float32Array(grid.totalTiles),
    tileTypeId: new Uint8Array(grid.totalTiles),
    tileRiverMask: new Uint8Array(grid.totalTiles),
    tileOceanMask: new Uint8Array(grid.totalTiles),
    tileSeaLevel: new Float32Array(grid.totalTiles),
    tileCoastDistance: new Uint16Array(grid.totalTiles),
    tileCoastClass: new Uint8Array(grid.totalTiles),
    tileRoadBridge: new Uint8Array(grid.totalTiles),
    tileRoadEdges: new Uint8Array(grid.totalTiles),
    tileRoadWallEdges: new Uint8Array(grid.totalTiles),
    tileRiverBed: new Float32Array(grid.totalTiles).fill(Number.NaN),
    tileRiverSurface: new Float32Array(grid.totalTiles).fill(Number.NaN),
    tileRiverStepStrength: new Float32Array(grid.totalTiles),
    structureMask: new Uint8Array(grid.totalTiles),
    tileTownId: new Int16Array(grid.totalTiles).fill(-1),
    tileStructure: new Uint8Array(grid.totalTiles),

    tileSoaDirty: true,

    neighborOffsets4: buildNeighborOffsets(grid.cols, 4),

    neighborOffsets8: buildNeighborOffsets(grid.cols, 8),

    igniteBuffer: new Int32Array(grid.totalTiles),

    igniteMask: new Uint8Array(grid.totalTiles),

    igniteCount: 0,

    simPerf: {

      quality: 2,

      fireQuality: 2,

      smokeRate: 1,

      smokeSampleRate: 4,

      emberRateScale: 1,

      jumpRateScale: 1,

      useSnapshot: true,

      neighbourMode: 8,

      diffusionEps: 0.02,

      blockSize,

      growthBlocksPerTick: 32,

      pathEpsilon: 1.2,

      pathMaxExpansions: 0

    },

    colorNoiseMap: createNumberArray(grid.totalTiles, 0.5),

    valleyMap: createNumberArray(grid.totalTiles, 0),

    terrainDirty: true,
    terrainTypeRevision: 0,
    vegetationRevision: 0,
    structureRevision: 0,

    basePoint: { x: 0, y: 0 },
    towns: [],
    townGrowthAppliedYear: -1,
    townAlertDayAccumulator: 0,

    seed,
    fireSettings: { ...DEFAULT_FIRE_SETTINGS },
    budget: BASE_BUDGET,

    burnedTiles: 0,

    containedCount: 0,

    totalLandTiles: 1,

    lastActiveFires: 0,
    latestFireAlert: null,
    nextFireAlertId: 1,
    skipToNextFire: null,

    paused: false,

    gameOver: false,

    wind: { ...DEFAULT_WIND },

    windTimer: 0,

    deployMode: null,

    selectedUnitIds: [],
    selectedCommandUnitIds: [],
    selectedTruckIds: [],
    selectionScope: "commandUnit",
    focusedCommandUnitId: null,
    commandUnits: [],
    nextCommandUnitId: 1,
    commandUnitsRevision: 0,

    simTimeMode: "strategic",
    timeSpeedIndex: 1,
    strategicTimeSpeedIndex: 1,
    incidentTimeSpeedIndex: DEFAULT_INCIDENT_TIME_SPEED_INDEX,

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
    scoring: createInitialScoringState(grid),

    pendingBudget: BASE_BUDGET,
    annualReportOpen: false,

    totalPropertyValue: 0,

    totalPopulation: 0,

    lostPropertyValue: 0,

    lostResidents: 0,

    yearPropertyLost: 0,

    yearLivesLost: 0,

    totalHouses: 0,
    settlementRequestedHouses: 0,
    settlementPlacedHouses: 0,
    settlementPadReliefMax: 0,
    settlementPadReliefMean: 0,

    destroyedHouses: 0,

    statusMessage: "Ready.",

    finalScore: 0,

    campaign: createCampaignState(),

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
    roster: [],

    selectedRosterId: null,

    nextRosterId: 1,

    nextUnitId: 1,
    fireBlockSize: blockSize,
    fireBlockCols: blockCols,
    fireBlockRows: blockRows,
    fireBlockCount: blockCount,
    fireBlockFlags: new Uint8Array(blockCount),
    fireBlockActiveList: new Int32Array(blockCount),
    fireBlockWorkList: new Int32Array(blockCount),
    fireBlockNextList: new Int32Array(blockCount),
    fireBlockActiveCount: 0,
    fireBlockWorkCount: 0,
    fireBlockNextCount: 0,
    tileBlockIndex,
    heatStamp: new Uint32Array(grid.totalTiles),
    heatStampId: 0,
    fireScheduledCount: 0,
    firePerfActiveBlocks: 0,
    firePerfWorkBlocks: 0,
    firePerfFireBoundsArea: 0,
    firePerfHeatBoundsArea: 0,
    firePerfSubsteps: 0,
    firePerfSimulatedDays: 0,
    growthBlockCursor: 0,
    pathPrev: new Int32Array(grid.totalTiles),
    pathGScore: new Float32Array(grid.totalTiles),
    pathVisitStamp: new Uint32Array(grid.totalTiles),
    pathClosedStamp: new Uint32Array(grid.totalTiles),
    pathStamp: 0,
    pathOpenIdx: new Int32Array(grid.totalTiles),
    pathOpenF: new Float32Array(grid.totalTiles),
    pathOpenSize: 0,
    pathNodesExpanded: 0,
    pathMaxOpenSize: 0,
    pathLastNodesExpanded: 0

  };

}



export function syncTileSoA(state: WorldState): void {

  const total = state.grid.totalTiles;

  if (
    state.tileFire.length !== total ||
    !state.tileSuppressionWetness ||
    state.tileSuppressionWetness.length !== total ||
    state.tileVegetationAge.length !== total ||
    state.tileCanopyCover.length !== total ||
    state.tileStemDensity.length !== total ||
    !state.tileOceanMask ||
    state.tileOceanMask.length !== total ||
    !state.tileSeaLevel ||
    state.tileSeaLevel.length !== total ||
    !state.tileCoastDistance ||
    state.tileCoastDistance.length !== total ||
    !state.tileCoastClass ||
    state.tileCoastClass.length !== total ||
    state.tileRoadBridge.length !== total ||
    state.tileRoadEdges.length !== total ||
    state.tileRoadWallEdges.length !== total ||
    state.tileTownId.length !== total ||
    state.tileStructure.length !== total
  ) {

    state.tileFire = new Float32Array(total);

    state.tileFuel = new Float32Array(total);

    state.tileHeat = new Float32Array(total);
    state.tileSuppressionWetness = new Float32Array(total);
    state.tileIgniteAt = new Float32Array(total).fill(Number.POSITIVE_INFINITY);

    state.tileIgnitionPoint = new Float32Array(total);
    state.tileBurnRate = new Float32Array(total);
    state.tileHeatOutput = new Float32Array(total);
    state.tileElevation = new Float32Array(total);
    state.tileMoisture = new Float32Array(total);
    state.tileVegetationAge = new Float32Array(total);
    state.tileCanopyCover = new Float32Array(total);
    state.tileStemDensity = new Uint8Array(total);
    state.tileSpreadBoost = new Float32Array(total);
    state.tileHeatRetention = new Float32Array(total);
    state.tileWindFactor = new Float32Array(total);
    state.tileHeatTransferCap = new Float32Array(total);
    state.tileTypeId = new Uint8Array(total);
    state.tileRiverMask = new Uint8Array(total);
    state.tileOceanMask = new Uint8Array(total);
    state.tileSeaLevel = new Float32Array(total);
    state.tileCoastDistance = new Uint16Array(total);
    state.tileCoastClass = new Uint8Array(total);
    state.tileRoadBridge = new Uint8Array(total);
    state.tileRoadEdges = new Uint8Array(total);
    state.tileRoadWallEdges = new Uint8Array(total);
    state.tileRiverBed = new Float32Array(total).fill(Number.NaN);
    state.tileRiverSurface = new Float32Array(total).fill(Number.NaN);
    state.tileRiverStepStrength = new Float32Array(total);
    state.structureMask = new Uint8Array(total);
    state.tileTownId = new Int16Array(total).fill(-1);
    state.tileStructure = new Uint8Array(total);
    state.heatBuffer = new Float32Array(total);
    state.fireSnapshot = new Float32Array(total);
    state.igniteBuffer = new Int32Array(total);
    state.igniteMask = new Uint8Array(total);
    state.baselineFireScratch = new Float32Array(total);
    state.baselineHeatScratch = new Float32Array(total);
    state.baselineNextHeat = new Float32Array(total);
    state.scoring.burnStartFuel = new Float32Array(total).fill(-1);
    state.scoring.lastSuppressedAt = new Float32Array(total).fill(Number.NEGATIVE_INFINITY);
    state.neighborOffsets4 = buildNeighborOffsets(state.grid.cols, 4);

    state.neighborOffsets8 = buildNeighborOffsets(state.grid.cols, 8);

    const blockSize = Math.max(4, Math.floor(state.simPerf.blockSize || 16));
    const blockCols = Math.max(1, Math.ceil(state.grid.cols / blockSize));
    const blockRows = Math.max(1, Math.ceil(state.grid.rows / blockSize));
    state.fireBlockSize = blockSize;
    state.fireBlockCols = blockCols;
    state.fireBlockRows = blockRows;
    state.fireBlockCount = blockCols * blockRows;
    state.fireBlockFlags = new Uint8Array(state.fireBlockCount);
    state.fireBlockActiveList = new Int32Array(state.fireBlockCount);
    state.fireBlockWorkList = new Int32Array(state.fireBlockCount);
    state.fireBlockNextList = new Int32Array(state.fireBlockCount);
    state.fireBlockActiveCount = 0;
    state.fireBlockWorkCount = 0;
    state.fireBlockNextCount = 0;
    state.tileBlockIndex = new Int32Array(total);
    state.heatStamp = new Uint32Array(total);
    state.heatStampId = 0;
    state.pathPrev = new Int32Array(total);
    state.pathGScore = new Float32Array(total);
    state.pathVisitStamp = new Uint32Array(total);
    state.pathClosedStamp = new Uint32Array(total);
    state.pathStamp = 0;
    state.pathOpenIdx = new Int32Array(total);
    state.pathOpenF = new Float32Array(total);
    state.pathOpenSize = 0;

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
  const moisture = state.tileMoisture;
  const vegetationAge = state.tileVegetationAge;
  const canopyCover = state.tileCanopyCover;
  const stemDensity = state.tileStemDensity;
  const spreadBoost = state.tileSpreadBoost;
  const heatRetention = state.tileHeatRetention;
  const windFactor = state.tileWindFactor;
  const heatTransferCap = state.tileHeatTransferCap;



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
    vegetationAge[i] = tile.vegetationAgeYears ?? 0;
    canopyCover[i] = tile.canopyCover ?? tile.canopy ?? 0;
    stemDensity[i] = Math.max(0, Math.round(tile.stemDensity ?? 0));
    spreadBoost[i] = tile.spreadBoost ?? 1;
    heatRetention[i] = tile.heatRetention ?? 0.9;
    windFactor[i] = tile.windFactor ?? 0;
    heatTransferCap[i] = tile.heatTransferCap ?? 0;

  }

  const blockSize = Math.max(4, Math.floor(state.simPerf.blockSize || 16));
  const blockCols = Math.max(1, Math.ceil(state.grid.cols / blockSize));
  const blockRows = Math.max(1, Math.ceil(state.grid.rows / blockSize));
  if (state.tileBlockIndex.length !== total || state.fireBlockSize !== blockSize) {
    state.fireBlockSize = blockSize;
    state.fireBlockCols = blockCols;
    state.fireBlockRows = blockRows;
    state.fireBlockCount = blockCols * blockRows;
    state.fireBlockFlags = new Uint8Array(state.fireBlockCount);
    state.fireBlockActiveList = new Int32Array(state.fireBlockCount);
    state.fireBlockWorkList = new Int32Array(state.fireBlockCount);
    state.fireBlockNextList = new Int32Array(state.fireBlockCount);
    state.fireBlockActiveCount = 0;
    state.fireBlockWorkCount = 0;
    state.fireBlockNextCount = 0;
    state.tileBlockIndex = new Int32Array(total);
  }
  for (let i = 0; i < total; i += 1) {
    const x = i % state.grid.cols;
    const y = Math.floor(i / state.grid.cols);
    const bx = Math.floor(x / state.fireBlockSize);
    const by = Math.floor(y / state.fireBlockSize);
    state.tileBlockIndex[i] = by * state.fireBlockCols + bx;
  }

  if (state.scoring.burnStartFuel.length !== total) {
    state.scoring.burnStartFuel = new Float32Array(total).fill(-1);
  }
  if (state.scoring.lastSuppressedAt.length !== total) {
    state.scoring.lastSuppressedAt = new Float32Array(total).fill(Number.NEGATIVE_INFINITY);
  }



  state.tileSoaDirty = false;
}

export function syncTileSoAIndex(state: WorldState, idx: number): void {
  const tile = state.tiles[idx];
  if (!tile) {
    return;
  }
  state.tileFire[idx] = tile.fire;
  state.tileFuel[idx] = tile.fuel;
  state.tileHeat[idx] = tile.heat;
  state.tileIgnitionPoint[idx] = tile.ignitionPoint;
  state.tileBurnRate[idx] = tile.burnRate;
  state.tileHeatOutput[idx] = tile.heatOutput;
  state.tileElevation[idx] = tile.elevation;
  state.tileTypeId[idx] = TILE_TYPE_IDS[tile.type];
  state.tileMoisture[idx] = tile.moisture;
  state.tileVegetationAge[idx] = tile.vegetationAgeYears ?? 0;
  state.tileCanopyCover[idx] = tile.canopyCover ?? tile.canopy ?? 0;
  state.tileStemDensity[idx] = Math.max(0, Math.round(tile.stemDensity ?? 0));
  state.tileSpreadBoost[idx] = tile.spreadBoost ?? 1;
  state.tileHeatRetention[idx] = tile.heatRetention ?? 0.9;
  state.tileWindFactor[idx] = tile.windFactor ?? 0;
  state.tileHeatTransferCap[idx] = tile.heatTransferCap ?? 0;
}



export function resetState(state: WorldState, seed: number): void {
  const grid = state.grid;

  Object.assign(state, createInitialState(seed, grid));
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



