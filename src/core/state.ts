import type { DeployMode, Grid, Point, SeasonPhase, Tile, Unit, Particle, Wind, TileType, RosterUnit } from "./types.js";
import type { CampaignState } from "./campaign.js";
import { BASE_BUDGET } from "./config.js";
import { createCampaignState } from "./campaign.js";

export interface WorldState {
  grid: Grid;
  tiles: Tile[];
  units: Unit[];
  waterParticles: Particle[];
  smokeParticles: Particle[];
  heatBuffer: number[];
  colorNoiseMap: number[];
  valleyMap: number[];
  terrainDirty: boolean;
  basePoint: Point;
  seed: number;
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
  year: number;
  phaseIndex: number;
  phase: SeasonPhase;
  phaseDay: number;
  fireSeasonDay: number;
  fireSimAccumulator: number;
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
  growthView: { zoom: number; camera: Point } | null;
  selectionBox: { x1: number; y1: number; x2: number; y2: number } | null;
  roster: RosterUnit[];
  selectedRosterId: number | null;
  nextRosterId: number;
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
    heatBuffer: createNumberArray(grid.totalTiles, 0),
    colorNoiseMap: createNumberArray(grid.totalTiles, 0.5),
    valleyMap: createNumberArray(grid.totalTiles, 0),
    terrainDirty: true,
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
    selectedUnitIds: [],
    zoom: 1,
    cameraCenter: { x: 0, y: 0 },
    year: 1,
    phaseIndex: 0,
    phase: "growth",
    phaseDay: 0,
    fireSeasonDay: 0,
    fireSimAccumulator: 0,
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
    fireSnapshot: new Float32Array(grid.totalTiles),
    growthView: null,
    selectionBox: null,
    roster: [],
    selectedRosterId: null,
    nextRosterId: 1
  };
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

