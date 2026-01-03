type TileType = "water" | "grass" | "forest" | "ash" | "road" | "base" | "house" | "firebreak";

type UnitKind = "firefighter" | "truck";
type SeasonPhase = "growth" | "maintenance" | "fire" | "budget";
type DeployMode = UnitKind | "clear";

interface Point {
  x: number;
  y: number;
}

interface Tile {
  type: TileType;
  fuel: number;
  fire: number;
  isBase: boolean;
  elevation: number;
  heat: number;
  ignitionPoint: number;
  burnRate: number;
  heatOutput: number;
  moisture: number;
  canopy: number;
  houseValue: number;
  houseResidents: number;
  houseDestroyed: boolean;
}

interface Unit {
  id: number;
  kind: UnitKind;
  x: number;
  y: number;
  target: Point | null;
  path: Point[];
  pathIndex: number;
  speed: number;
  radius: number;
  power: number;
  selected: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  alpha: number;
}

interface Wind {
  name: string;
  dx: number;
  dy: number;
  strength: number;
}

interface LeaderboardEntry {
  name: string;
  score: number;
  seed: number;
  date: number;
}

interface FuelProfile {
  baseFuel: number;
  ignition: number;
  burnRate: number;
  heatOutput: number;
}

class RNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
}

const canvas = document.getElementById("gameCanvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");

if (!ctx) {
  throw new Error("Canvas not supported");
}

const ui = {
  seedValue: document.getElementById("seedValue") as HTMLSpanElement,
  budgetValue: document.getElementById("budgetValue") as HTMLSpanElement,
  approvalValue: document.getElementById("approvalValue") as HTMLSpanElement,
  yearValue: document.getElementById("yearValue") as HTMLSpanElement,
  phaseValue: document.getElementById("phaseValue") as HTMLSpanElement,
  firesValue: document.getElementById("firesValue") as HTMLSpanElement,
  propertyLossValue: document.getElementById("propertyLossValue") as HTMLSpanElement,
  livesLossValue: document.getElementById("livesLossValue") as HTMLSpanElement,
  scoreValue: document.getElementById("scoreValue") as HTMLSpanElement,
  windValue: document.getElementById("windValue") as HTMLSpanElement,
  statusText: document.getElementById("statusText") as HTMLDivElement,
  deployFirefighter: document.getElementById("deployFirefighter") as HTMLButtonElement,
  deployTruck: document.getElementById("deployTruck") as HTMLButtonElement,
  deployClear: document.getElementById("deployClear") as HTMLButtonElement,
  newRunBtn: document.getElementById("newRunBtn") as HTMLButtonElement,
  pauseBtn: document.getElementById("pauseBtn") as HTMLButtonElement,
  zoomOutBtn: document.getElementById("zoomOutBtn") as HTMLButtonElement,
  zoomInBtn: document.getElementById("zoomInBtn") as HTMLButtonElement,
  overlay: document.getElementById("overlay") as HTMLDivElement,
  overlayTitle: document.getElementById("overlayTitle") as HTMLHeadingElement,
  overlayMessage: document.getElementById("overlayMessage") as HTMLParagraphElement,
  overlayRestart: document.getElementById("overlayRestart") as HTMLButtonElement,
  callsignInput: document.getElementById("callsignInput") as HTMLInputElement,
  leaderboardList: document.getElementById("leaderboardList") as HTMLOListElement,
  beginFireSeason: document.getElementById("beginFireSeason") as HTMLButtonElement
};

const TILE_SIZE = 10;
const GRID_COLS = Math.floor(canvas.width / TILE_SIZE);
const GRID_ROWS = Math.floor(canvas.height / TILE_SIZE);
const TOTAL_TILES = GRID_COLS * GRID_ROWS;
const ZOOM_MIN = 0.7;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.1;
const ISO_TILE_WIDTH = TILE_SIZE * 2;
const ISO_TILE_HEIGHT = TILE_SIZE;
const HEIGHT_SCALE = TILE_SIZE * 5;
const HEIGHT_WATER_DROP = TILE_SIZE * 0.7;
const CAREER_YEARS = 20;
const DAYS_PER_SECOND = 4;
const GROWTH_SPEED_MULTIPLIER = 3;
const FIREBREAK_COST_PER_TILE = 45;
const BASE_BUDGET = 320;
const APPROVAL_MIN = 0.2;
const FIRE_IGNITION_CHANCE_PER_DAY = 0.08;

const PHASES: { id: SeasonPhase; label: string; duration: number }[] = [
  { id: "growth", label: "Growth", duration: 120 },
  { id: "maintenance", label: "Maintenance", duration: 30 },
  { id: "fire", label: "Fire Season", duration: 90 },
  { id: "budget", label: "Budget", duration: 15 }
];

const FIRE_COLORS = ["#d34b2a", "#f09a3e", "#f2c94c"];

const TILE_COLORS: Record<TileType, string> = {
  water: "#2a6f97",
  grass: "#5a8f4e",
  forest: "#2f5d31",
  ash: "#4a4a4a",
  road: "#bdb49c",
  base: "#a12f1d",
  house: "#c08a5a",
  firebreak: "#d6c6a6"
};

const ELEVATION_TINT_LOW = { r: 74, g: 102, b: 93 };
const ELEVATION_TINT_HIGH = { r: 201, g: 174, b: 129 };
const DRY_TINT = { r: 166, g: 152, b: 111 };
const WET_TINT = { r: 55, g: 98, b: 72 };
const CONTOUR_STEP = 0.08;
const CONTOUR_BAND = 0.012;
const LIGHT_DIR = { x: 0.6, y: -0.8 };

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
}

const TILE_COLOR_RGB: Record<TileType, { r: number; g: number; b: number }> = {
  water: hexToRgb(TILE_COLORS.water),
  grass: hexToRgb(TILE_COLORS.grass),
  forest: hexToRgb(TILE_COLORS.forest),
  ash: hexToRgb(TILE_COLORS.ash),
  road: hexToRgb(TILE_COLORS.road),
  base: hexToRgb(TILE_COLORS.base),
  house: hexToRgb(TILE_COLORS.house),
  firebreak: hexToRgb(TILE_COLORS.firebreak)
};

function mixRgb(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }, t: number) {
  return {
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  };
}

function rgbString(color: { r: number; g: number; b: number }): string {
  return `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
}

function scaleRgb(color: { r: number; g: number; b: number }, factor: number): { r: number; g: number; b: number } {
  return {
    r: clamp(color.r * factor, 0, 255),
    g: clamp(color.g * factor, 0, 255),
    b: clamp(color.b * factor, 0, 255)
  };
}

function shadeTileColor(tile: Tile, x: number, y: number): { r: number; g: number; b: number } {
  const base =
    tile.type === "grass" || tile.type === "forest"
      ? mixRgb(TILE_COLOR_RGB.grass, TILE_COLOR_RGB.forest, clamp(tile.canopy, 0, 1))
      : TILE_COLOR_RGB[tile.type];
  const elev = tile.elevation;
  const left = inBounds(x - 1, y) ? tiles[indexFor(x - 1, y)].elevation : elev;
  const right = inBounds(x + 1, y) ? tiles[indexFor(x + 1, y)].elevation : elev;
  const up = inBounds(x, y - 1) ? tiles[indexFor(x, y - 1)].elevation : elev;
  const down = inBounds(x, y + 1) ? tiles[indexFor(x, y + 1)].elevation : elev;
  const dx = right - left;
  const dy = down - up;
  const slope = dx * LIGHT_DIR.x + dy * LIGHT_DIR.y;
  const avg = (left + right + up + down) * 0.25;
  const relief = clamp((elev - avg) * 1.6, -0.22, 0.22);
  const heightBoost = 0.88 + elev * 0.28;
  const shade = clamp(heightBoost * (0.92 + slope * 1.6) * (1 + relief), 0.55, 1.22);
  const tintAmount = tile.type === "water" ? 0.05 : 0.12 + elev * 0.25;
  const tint = {
    r: ELEVATION_TINT_LOW.r + (ELEVATION_TINT_HIGH.r - ELEVATION_TINT_LOW.r) * elev,
    g: ELEVATION_TINT_LOW.g + (ELEVATION_TINT_HIGH.g - ELEVATION_TINT_LOW.g) * elev,
    b: ELEVATION_TINT_LOW.b + (ELEVATION_TINT_HIGH.b - ELEVATION_TINT_LOW.b) * elev
  };

  let mixed = mixRgb(base, tint, tintAmount);
  if (tile.type === "grass" || tile.type === "forest") {
    const moistureTint = mixRgb(DRY_TINT, WET_TINT, clamp(tile.moisture, 0, 1));
    const moistureAmount = 0.12 + tile.moisture * 0.18;
    mixed = mixRgb(mixed, moistureTint, moistureAmount);
  }
  const noise = colorNoiseMap[indexFor(x, y)];
  const noiseShift = (noise - 0.5) * 0.12;
  const noiseShade = 1 + noiseShift;

  return {
    r: clamp(mixed.r * shade * noiseShade, 0, 255),
    g: clamp(mixed.g * shade * noiseShade, 0, 255),
    b: clamp(mixed.b * shade * noiseShade, 0, 255)
  };
}

const UNIT_CONFIG: Record<UnitKind, { cost: number; speed: number; radius: number; power: number; color: string }> = {
  firefighter: { cost: 50, speed: 4.2, radius: 1.1, power: 0.5, color: "#f0b33b" },
  truck: { cost: 120, speed: 2.8, radius: 2.2, power: 0.75, color: "#c0462c" }
};

const WATER_PARTICLE_COLOR = "#7ad4ff";

const FUEL_PROFILES: Record<TileType, FuelProfile> = {
  water: { baseFuel: 0, ignition: 9, burnRate: 0, heatOutput: 0 },
  grass: { baseFuel: 0.75, ignition: 0.28, burnRate: 0.32, heatOutput: 1.0 },
  forest: { baseFuel: 1.35, ignition: 0.42, burnRate: 0.24, heatOutput: 1.35 },
  road: { baseFuel: 0.12, ignition: 0.75, burnRate: 0.08, heatOutput: 0.2 },
  base: { baseFuel: 1.1, ignition: 0.38, burnRate: 0.3, heatOutput: 1.15 },
  house: { baseFuel: 1.2, ignition: 0.32, burnRate: 0.28, heatOutput: 1.4 },
  firebreak: { baseFuel: 0.05, ignition: 0.9, burnRate: 0.06, heatOutput: 0.15 },
  ash: { baseFuel: 0, ignition: 9, burnRate: 0, heatOutput: 0 }
};

const NEIGHBOR_DIRS: Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 }
];

const WIND_DIRS: Wind[] = [
  { name: "N", dx: 0, dy: -1, strength: 0.7 },
  { name: "NE", dx: 1, dy: -1, strength: 0.7 },
  { name: "E", dx: 1, dy: 0, strength: 0.7 },
  { name: "SE", dx: 1, dy: 1, strength: 0.7 },
  { name: "S", dx: 0, dy: 1, strength: 0.7 },
  { name: "SW", dx: -1, dy: 1, strength: 0.7 },
  { name: "W", dx: -1, dy: 0, strength: 0.7 },
  { name: "NW", dx: -1, dy: -1, strength: 0.7 }
];

let tiles: Tile[] = [];
let units: Unit[] = [];
let waterParticles: Particle[] = [];
let smokeParticles: Particle[] = [];
let heatBuffer = new Float32Array(TOTAL_TILES);
let colorNoiseMap = new Float32Array(TOTAL_TILES);
let rng = new RNG(Date.now());
let basePoint: Point = { x: 0, y: 0 };
let seed = 0;
let budget = 300;
let burnedTiles = 0;
let containedCount = 0;
let totalLandTiles = 1;
let lastTick = 0;
let accumulator = 0;
let paused = false;
let gameOver = false;
let wind: Wind = { name: "N", dx: 0, dy: -1, strength: 0.5 };
let windTimer = 0;
let deployMode: DeployMode | null = null;
let selectedUnitId: number | null = null;
let zoom = 1;
let cameraCenter: Point = { x: 0, y: 0 };
let year = 1;
let phaseIndex = 0;
let phase: SeasonPhase = "growth";
let phaseDay = 0;
let careerScore = 0;
let approval = 0.7;
let pendingBudget = 300;
let totalPropertyValue = 0;
let totalPopulation = 0;
let lostPropertyValue = 0;
let lostResidents = 0;
let yearPropertyLost = 0;
let yearLivesLost = 0;
let totalHouses = 0;
let destroyedHouses = 0;
let clearLineStart: Point | null = null;

const LEADERBOARD_KEY = "fireline.leaderboard";

function setStatus(message: string): void {
  ui.statusText.textContent = message;
}

function resetStatus(): void {
  setStatus("Ready.");
}

function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function indexFor(x: number, y: number): number {
  return y * GRID_COLS + x;
}

function inBounds(x: number, y: number): boolean {
  return x >= 0 && x < GRID_COLS && y >= 0 && y < GRID_ROWS;
}

function isoProject(wx: number, wy: number, height: number): Point {
  return {
    x: (wx - wy) * (ISO_TILE_WIDTH * 0.5),
    y: (wx + wy) * (ISO_TILE_HEIGHT * 0.5) - height
  };
}

function getTileHeight(tile: Tile): number {
  return tile.elevation * HEIGHT_SCALE - (tile.type === "water" ? HEIGHT_WATER_DROP : 0);
}

function getHeightAt(wx: number, wy: number): number {
  const x = Math.floor(wx);
  const y = Math.floor(wy);
  if (!inBounds(x, y)) {
    return 0;
  }
  return getTileHeight(tiles[indexFor(x, y)]);
}

function screenToWorld(screenX: number, screenY: number): Point {
  const view = getViewTransform();
  const worldX = (screenX - view.offsetX) / view.scale;
  const worldY = (screenY - view.offsetY) / view.scale;
  const isoX = worldX / (ISO_TILE_WIDTH * 0.5);
  const isoY = worldY / (ISO_TILE_HEIGHT * 0.5);
  return {
    x: (isoY + isoX) / 2,
    y: (isoY - isoX) / 2
  };
}

function zoomAtPointer(targetZoom: number, screenX: number, screenY: number): void {
  const nextZoom = clamp(targetZoom, ZOOM_MIN, ZOOM_MAX);
  const before = screenToWorld(screenX, screenY);
  const prevZoom = zoom;
  zoom = nextZoom;
  const ratio = prevZoom / zoom;
  cameraCenter = {
    x: before.x + (cameraCenter.x - before.x) * ratio,
    y: before.y + (cameraCenter.y - before.y) * ratio
  };
}

function setZoom(next: number): void {
  zoom = clamp(next, ZOOM_MIN, ZOOM_MAX);
}

function getViewTransform(): { scale: number; offsetX: number; offsetY: number } {
  const scale = zoom;
  const centerHeight = getHeightAt(cameraCenter.x, cameraCenter.y);
  const center = isoProject(cameraCenter.x, cameraCenter.y, centerHeight);
  const offsetX = canvas.width / 2 - center.x * scale;
  const offsetY = canvas.height / 2 - center.y * scale;
  return { scale, offsetX, offsetY };
}

function hash2D(x: number, y: number, seedValue: number): number {
  let h = x * 374761393 + y * 668265263 + seedValue * 1447;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

function fractalNoise(x: number, y: number, seedValue: number): number {
  const n1 = hash2D(x, y, seedValue);
  const n2 = hash2D(Math.floor(x / 3), Math.floor(y / 3), seedValue + 101);
  const n3 = hash2D(Math.floor(x / 7), Math.floor(y / 7), seedValue + 271);
  return n1 * 0.6 + n2 * 0.3 + n3 * 0.1;
}

function buildElevationMap(seedValue: number): Float32Array {
  const elevationMap = new Float32Array(TOTAL_TILES);
  const temp = new Float32Array(TOTAL_TILES);
  const centerFactor = Math.min(GRID_COLS, GRID_ROWS) / 2;

  const landCenters = Array.from({ length: 3 }, () => ({
    x: rng.next() * GRID_COLS,
    y: rng.next() * GRID_ROWS,
    radius: (Math.min(GRID_COLS, GRID_ROWS) * (0.45 + rng.next() * 0.25)) / 2,
    height: 0.28 + rng.next() * 0.28
  }));

  const basinCenters = Array.from({ length: 3 }, () => ({
    x: rng.next() * GRID_COLS,
    y: rng.next() * GRID_ROWS,
    radius: (Math.min(GRID_COLS, GRID_ROWS) * (0.28 + rng.next() * 0.2)) / 2,
    depth: 0.22 + rng.next() * 0.25
  }));

  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const edgeDist = Math.min(x, y, GRID_COLS - 1 - x, GRID_ROWS - 1 - y);
      const edgeFactor = clamp(edgeDist / centerFactor, 0, 1);
      const warpA = fractalNoise(x / 11, y / 11, seedValue + 33);
      const warpB = fractalNoise(x / 11, y / 11, seedValue + 67);
      const warpX = (warpA - 0.5) * 4;
      const warpY = (warpB - 0.5) * 4;
      const nx = x + warpX;
      const ny = y + warpY;
      const macro = fractalNoise(nx / 42, ny / 42, seedValue + 991);
      const mid = fractalNoise(nx / 22, ny / 22, seedValue + 517);
      const detail = fractalNoise(nx / 10, ny / 10, seedValue + 151);
      const ridgeNoise = fractalNoise(nx / 24, ny / 24, seedValue + 703);
      const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
      let elevation = macro * 0.7 + mid * 0.18 + detail * 0.06 + ridge * 0.06;
      elevation += edgeFactor * 0.06;
      let landBoost = 0;
      for (const land of landCenters) {
        const dx = (x - land.x) / land.radius;
        const dy = (y - land.y) / land.radius;
        const d = Math.hypot(dx, dy);
        if (d < 1) {
          landBoost = Math.max(landBoost, (1 - d) * (1 - d) * land.height);
        }
      }
      elevation += landBoost;
      let basinDrop = 0;
      for (const basin of basinCenters) {
        const dx = (x - basin.x) / basin.radius;
        const dy = (y - basin.y) / basin.radius;
        const d = Math.hypot(dx, dy);
        if (d < 1) {
          basinDrop = Math.max(basinDrop, (1 - d) * basin.depth);
        }
      }
      elevation = clamp(elevation - basinDrop, 0, 1);
      elevationMap[indexFor(x, y)] = clamp(elevation, 0, 1);
    }
  }

  for (let pass = 0; pass < 4; pass += 1) {
    for (let y = 0; y < GRID_ROWS; y += 1) {
      for (let x = 0; x < GRID_COLS; x += 1) {
        const idx = indexFor(x, y);
        let neighborSum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nx = x + dx;
            const ny = y + dy;
            if (!inBounds(nx, ny)) {
              continue;
            }
            neighborSum += elevationMap[indexFor(nx, ny)];
            count += 1;
          }
        }
        const avg = count > 0 ? neighborSum / count : elevationMap[idx];
        temp[idx] = clamp(elevationMap[idx] * 0.42 + avg * 0.58, 0, 1);
      }
    }
    elevationMap.set(temp);
  }

  for (let i = 0; i < elevationMap.length; i += 1) {
    const value = elevationMap[i];
    elevationMap[i] = clamp(value * value * (0.65 + value * 0.6), 0, 1);
  }

  return elevationMap;
}

function buildMoistureMap(): Float32Array {
  const moisture = new Float32Array(TOTAL_TILES);
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      let waterCount = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) {
            continue;
          }
          if (tiles[indexFor(nx, ny)].type === "water") {
            waterCount += 1;
          }
        }
      }
      const idx = indexFor(x, y);
      const waterFactor = clamp(waterCount / 12, 0, 1);
      const elevationFactor = 1 - tiles[idx].elevation;
      moisture[idx] = clamp(waterFactor * 0.7 + elevationFactor * 0.3, 0, 1);
    }
  }
  return moisture;
}

function smoothWater(inputTiles: Tile[]): Tile[] {
  const output = inputTiles.map((tile) => ({ ...tile }));
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      let waterCount = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(nx, ny)) {
            waterCount += 1;
            continue;
          }
          if (inputTiles[indexFor(nx, ny)].type === "water") {
            waterCount += 1;
          }
        }
      }
      const idx = indexFor(x, y);
      if (waterCount >= 5) {
        output[idx].type = "water";
      } else if (waterCount <= 2) {
        if (output[idx].type === "water") {
          output[idx].type = "grass";
        }
      }
    }
  }
  return output;
}

function applyFuel(tile: Tile, moisture: number): void {
  const profile = FUEL_PROFILES[tile.type];
  const variance = tile.type === "forest" || tile.type === "grass" ? (rng.next() - 0.5) * 0.35 : 0;
  const fuel = Math.max(0, profile.baseFuel * (1 + variance) * (1 - moisture * 0.6));
  tile.fuel = fuel;
  tile.fire = 0;
  tile.heat = 0;
  tile.ignitionPoint = clamp(profile.ignition + moisture * 0.35 + (tile.type === "forest" ? 0.08 : 0), 0.2, 1.4);
  tile.burnRate = profile.burnRate * (0.7 + (1 - moisture) * 0.8);
  tile.heatOutput = profile.heatOutput * (0.85 + fuel * 0.25);
}

function formatCurrency(value: number): string {
  return `$${Math.max(0, Math.floor(value)).toLocaleString()}`;
}

function getPhaseInfo(): { id: SeasonPhase; label: string; duration: number } {
  return PHASES[phaseIndex];
}

function formatPhaseStatus(): string {
  const current = getPhaseInfo();
  if (phase === "maintenance") {
    return `${current.label} (Budget)`;
  }
  const day = clamp(Math.ceil(phaseDay + 0.0001), 1, current.duration);
  return `${current.label} ${day}/${current.duration}`;
}

function updatePhaseControls(): void {
  const fireActive = phase === "fire";
  const maintenanceActive = phase === "maintenance";
  ui.deployFirefighter.disabled = !fireActive;
  ui.deployTruck.disabled = !fireActive;
  ui.deployClear.disabled = !maintenanceActive;
  ui.beginFireSeason.disabled = !maintenanceActive;
  if (!fireActive && (deployMode === "firefighter" || deployMode === "truck")) {
    setDeployMode(null);
  }
  if (!maintenanceActive && deployMode === "clear") {
    setDeployMode(null);
  }
  if (!fireActive) {
    selectUnit(null);
  }
}

function extinguishAllFires(): void {
  tiles.forEach((tile) => {
    tile.fire = 0;
    tile.heat = 0;
  });
  smokeParticles = [];
  waterParticles = [];
}

function applyGrowth(dayDelta: number): void {
  const regrowChance = dayDelta * 0.015;
  const firebreakRecovery = dayDelta * 0.01;
  const fuelGrowth = dayDelta * 0.02;
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const idx = indexFor(x, y);
      const tile = tiles[idx];
      if (tile.type === "ash" && !tile.houseDestroyed) {
        if (rng.next() < regrowChance * (0.4 + tile.moisture)) {
          tile.type = "grass";
          tile.canopy = 0.2 + tile.moisture * 0.3;
          applyFuel(tile, tile.moisture);
          burnedTiles = Math.max(0, burnedTiles - 1);
        }
        continue;
      }
      if (tile.type === "firebreak") {
        if (!tile.houseDestroyed && rng.next() < firebreakRecovery * (0.3 + tile.moisture)) {
          tile.type = "grass";
          tile.canopy = 0.15 + tile.moisture * 0.2;
          applyFuel(tile, tile.moisture);
        }
        continue;
      }
      if (tile.type === "grass" || tile.type === "forest") {
        const profile = FUEL_PROFILES[tile.type];
        const maxFuel = profile.baseFuel * 1.15;
        tile.fuel = clamp(tile.fuel + fuelGrowth * (0.4 + tile.moisture), 0, maxFuel);
        tile.canopy = clamp(tile.canopy + dayDelta * 0.01 * (tile.type === "forest" ? 1.1 : 0.6), 0, 1);
      }
    }
  }
}

function igniteRandomFire(dayDelta: number): void {
  const ignitionChance = FIRE_IGNITION_CHANCE_PER_DAY * dayDelta;
  if (rng.next() >= ignitionChance) {
    return;
  }
  let attempts = 0;
  while (attempts < 80) {
    attempts += 1;
    const x = Math.floor(rng.next() * GRID_COLS);
    const y = Math.floor(rng.next() * GRID_ROWS);
    const tile = tiles[indexFor(x, y)];
    if (tile.fire > 0 || tile.fuel <= 0) {
      continue;
    }
    if (tile.type === "water" || tile.type === "base" || tile.type === "ash" || tile.type === "firebreak") {
      continue;
    }
    tile.fire = 0.35 + rng.next() * 0.25;
    tile.heat = Math.max(tile.heat, tile.ignitionPoint * 1.3);
    break;
  }
}

function calculateBudgetOutcome(): void {
  const propertyLossRatio = totalPropertyValue > 0 ? yearPropertyLost / totalPropertyValue : 0;
  const lifeLossRatio = totalPopulation > 0 ? yearLivesLost / totalPopulation : 0;
  const landLossRatio = totalLandTiles > 0 ? burnedTiles / totalLandTiles : 0;
  const responseScore = clamp(1 - (propertyLossRatio * 0.7 + lifeLossRatio * 1.3 + landLossRatio * 0.4), 0, 1);
  const containmentBonus = clamp(containedCount / 60, 0, 0.2);
  const rating = clamp(responseScore + containmentBonus, 0, 1);
  const previousApproval = approval;
  approval = clamp(approval * 0.65 + rating * 0.35, 0, 1);
  const carryOver = Math.floor(budget * 0.2);
  pendingBudget = Math.max(0, Math.floor(BASE_BUDGET * (0.7 + approval * 0.8 + rating * 0.5) + carryOver));
  careerScore += Math.floor(rating * 900 + (1 - propertyLossRatio) * 400 + (1 - lifeLossRatio) * 600);
  setStatus(
    `Budget review: approval ${Math.round(previousApproval * 100)}% -> ${Math.round(approval * 100)}%, next budget ${formatCurrency(
      pendingBudget
    )}.`
  );
  if (approval < APPROVAL_MIN) {
    endGame(false, "Public approval collapses. Command reassigned.");
  }
}

function startNewYear(): void {
  budget = pendingBudget;
  yearPropertyLost = 0;
  yearLivesLost = 0;
  containedCount = 0;
  units = [];
  selectUnit(null);
  setDeployMode(null);
}

function setPhase(next: SeasonPhase): void {
  phase = next;
  updatePhaseControls();
  if (phase === "growth") {
    startNewYear();
    setStatus(`Year ${year} begins. Growth fuels the region.`);
    return;
  }
  if (phase === "maintenance") {
    setStatus("Maintenance season: spend budget to cut firebreaks.");
    return;
  }
  if (phase === "fire") {
    randomizeWind();
    pickInitialFires();
    setStatus("Fire season begins. Stay ahead of the line.");
    return;
  }
  extinguishAllFires();
  calculateBudgetOutcome();
}

function advancePhase(): void {
  const current = getPhaseInfo().id;
  if (current === "fire") {
    extinguishAllFires();
    units = [];
  }
  if (current === "budget") {
    year += 1;
    if (year > CAREER_YEARS) {
      endGame(true, "Twenty years in command. The region endures.");
      return;
    }
  }
  phaseIndex = (phaseIndex + 1) % PHASES.length;
  setPhase(PHASES[phaseIndex].id);
}

function beginFireSeason(): void {
  if (phase !== "maintenance") {
    return;
  }
  const fireIndex = PHASES.findIndex((entry) => entry.id === "fire");
  if (fireIndex < 0) {
    return;
  }
  phaseIndex = fireIndex;
  phaseDay = 0;
  setPhase("fire");
}

function advanceCalendar(dayDelta: number): void {
  phaseDay += dayDelta;
  while (!gameOver) {
    const current = getPhaseInfo();
    if (phaseDay < current.duration) {
      break;
    }
    phaseDay -= current.duration;
    advancePhase();
  }
}

function carveRoad(start: Point, end: Point): void {
  let x = start.x;
  let y = start.y;
  while (x !== end.x || y !== end.y) {
    const idx = indexFor(x, y);
    if (tiles[idx].type !== "house" && tiles[idx].type !== "base") {
      tiles[idx].type = "road";
    }
    if (x !== end.x && y !== end.y) {
      if (rng.next() < 0.5) {
        x += Math.sign(end.x - x);
      } else {
        y += Math.sign(end.y - y);
      }
    } else if (x !== end.x) {
      x += Math.sign(end.x - x);
    } else if (y !== end.y) {
      y += Math.sign(end.y - y);
    }
  }
  const endIdx = indexFor(end.x, end.y);
  if (tiles[endIdx].type !== "house" && tiles[endIdx].type !== "base") {
    tiles[endIdx].type = "road";
  }
}

function isBuildable(x: number, y: number): boolean {
  if (!inBounds(x, y)) {
    return false;
  }
  const type = tiles[indexFor(x, y)].type;
  return type === "grass" || type === "forest";
}

function placeHouseAt(x: number, y: number, value: number, residents: number): boolean {
  if (!isBuildable(x, y)) {
    return false;
  }
  const tile = tiles[indexFor(x, y)];
  tile.type = "house";
  tile.canopy = 0;
  tile.houseValue = value;
  tile.houseResidents = residents;
  tile.houseDestroyed = false;
  totalPropertyValue += value;
  totalPopulation += residents;
  totalHouses += 1;
  return true;
}

function isAdjacentToRoad(x: number, y: number): boolean {
  const neighbors = [
    { x: x + 1, y },
    { x: x - 1, y },
    { x, y: y + 1 },
    { x, y: y - 1 }
  ];
  return neighbors.some((point) => {
    if (!inBounds(point.x, point.y)) {
      return false;
    }
    const type = tiles[indexFor(point.x, point.y)].type;
    return type === "road" || type === "base";
  });
}

function findNearestRoadTile(origin: Point): Point {
  let best = basePoint;
  let bestDist = Math.abs(origin.x - basePoint.x) + Math.abs(origin.y - basePoint.y);
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const type = tiles[indexFor(x, y)].type;
      if (type !== "road" && type !== "base") {
        continue;
      }
      const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
      if (dist < bestDist) {
        bestDist = dist;
        best = { x, y };
      }
    }
  }
  return best;
}

function populateCommunities(): void {
  totalPropertyValue = 0;
  totalPopulation = 0;
  totalHouses = 0;
  destroyedHouses = 0;

  const villageCenters: Point[] = [];
  const villageCount = 4 + Math.floor(rng.next() * 3);
  let attempts = 0;
  while (villageCenters.length < villageCount && attempts < 4000) {
    attempts += 1;
    const x = Math.floor(rng.next() * GRID_COLS);
    const y = Math.floor(rng.next() * GRID_ROWS);
    if (!isBuildable(x, y)) {
      continue;
    }
    if (Math.hypot(x - basePoint.x, y - basePoint.y) < 10) {
      continue;
    }
    if (villageCenters.some((center) => Math.hypot(x - center.x, y - center.y) < 18)) {
      continue;
    }
    villageCenters.push({ x, y });
  }

  villageCenters.forEach((center) => {
    const clusterSize = 10 + Math.floor(rng.next() * 9);
    let placed = 0;
    let tries = 0;
    while (placed < clusterSize && tries < clusterSize * 20) {
      tries += 1;
      const angle = rng.next() * Math.PI * 2;
      const radius = 2 + rng.next() * 5;
      const x = Math.round(center.x + Math.cos(angle) * radius + (rng.next() - 0.5) * 2);
      const y = Math.round(center.y + Math.sin(angle) * radius + (rng.next() - 0.5) * 2);
      const value = 140 + Math.floor(rng.next() * 260);
      const residents = 2 + Math.floor(rng.next() * 4);
      if (placeHouseAt(x, y, value, residents)) {
        placed += 1;
      }
    }
  });

  const isolatedTarget = 12 + Math.floor(rng.next() * 10);
  let isolatedPlaced = 0;
  let isolatedAttempts = 0;
  while (isolatedPlaced < isolatedTarget && isolatedAttempts < isolatedTarget * 40) {
    isolatedAttempts += 1;
    const x = Math.floor(rng.next() * GRID_COLS);
    const y = Math.floor(rng.next() * GRID_ROWS);
    if (!isBuildable(x, y)) {
      continue;
    }
    if (villageCenters.some((center) => Math.hypot(x - center.x, y - center.y) < 10)) {
      continue;
    }
    const value = 90 + Math.floor(rng.next() * 180);
    const residents = 1 + Math.floor(rng.next() * 3);
    if (placeHouseAt(x, y, value, residents)) {
      isolatedPlaced += 1;
    }
  }

  villageCenters.forEach((center) => carveRoad(basePoint, center));
  for (let i = 1; i < villageCenters.length; i += 1) {
    carveRoad(villageCenters[i - 1], villageCenters[i]);
  }

  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const idx = indexFor(x, y);
      if (tiles[idx].type !== "house") {
        continue;
      }
      if (!isAdjacentToRoad(x, y)) {
        const target = findNearestRoadTile({ x, y });
        carveRoad({ x, y }, target);
      }
    }
  }
}

function generateMap(newSeed: number): void {
  seed = newSeed;
  rng = new RNG(seed);
  tiles = [];

  const elevationMap = buildElevationMap(seed);
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const edgeDist = Math.min(x, y, GRID_COLS - 1 - x, GRID_ROWS - 1 - y);
      const edgeFactor = clamp(edgeDist / (Math.min(GRID_COLS, GRID_ROWS) / 2), 0, 1);
      const elevation = elevationMap[indexFor(x, y)];
      const micro = fractalNoise(x / 4, y / 4, seed + 211);
      const waterThreshold = clamp(0.16 + (1 - edgeFactor) * 0.1 - (micro - 0.5) * 0.05, 0.1, 0.28);
      const isWater = elevation < waterThreshold;
      const type: TileType = isWater ? "water" : micro > 0.62 || elevation > 0.7 ? "forest" : "grass";
      const canopy = isWater ? 0 : clamp(type === "forest" ? 0.55 + micro * 0.55 : 0.15 + micro * 0.45, 0, 1);
      tiles.push({
        type,
        fuel: 0,
        fire: 0,
        isBase: false,
        elevation,
        heat: 0,
        ignitionPoint: 0,
        burnRate: 0,
        heatOutput: 0,
        moisture: 0,
        canopy,
        houseValue: 0,
        houseResidents: 0,
        houseDestroyed: false
      });
    }
  }

  tiles = smoothWater(tiles);
  tiles = smoothWater(tiles);
  tiles = smoothWater(tiles);
  tiles.forEach((tile) => {
    if (tile.type === "water") {
      tile.elevation = Math.min(tile.elevation, 0.22 + rng.next() * 0.04);
      tile.canopy = 0;
    }
  });

  basePoint = { x: Math.floor(GRID_COLS / 2), y: Math.floor(GRID_ROWS / 2) };

  const roadTargets: Point[] = [
    { x: 0, y: Math.floor(rng.next() * GRID_ROWS) },
    { x: GRID_COLS - 1, y: Math.floor(rng.next() * GRID_ROWS) },
    { x: Math.floor(rng.next() * GRID_COLS), y: 0 },
    { x: Math.floor(rng.next() * GRID_COLS), y: GRID_ROWS - 1 }
  ];

  roadTargets.forEach((target) => carveRoad(basePoint, target));

  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const nx = basePoint.x + x;
      const ny = basePoint.y + y;
      if (inBounds(nx, ny) && Math.hypot(x, y) <= 2.2) {
        const idx = indexFor(nx, ny);
        tiles[idx].type = "base";
        tiles[idx].isBase = true;
      }
    }
  }

  populateCommunities();

  totalLandTiles = 0;
  const moistureMap = buildMoistureMap();
  tiles.forEach((tile, index) => {
    tile.moisture = moistureMap[index];
    applyFuel(tile, moistureMap[index]);
    if (tile.type !== "water" && !tile.isBase) {
      totalLandTiles += 1;
    }
  });

  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const idx = indexFor(x, y);
      const low = fractalNoise(x / 14, y / 14, seed + 801);
      const broad = fractalNoise(x / 38, y / 38, seed + 1001);
      colorNoiseMap[idx] = clamp(low * 0.65 + broad * 0.35, 0, 1);
    }
  }

  burnedTiles = 0;
  containedCount = 0;
}

function pickInitialFires(): void {
  let attempts = 0;
  let placed = 0;
  while (placed < 3 && attempts < 300) {
    attempts += 1;
    const x = Math.floor(rng.next() * GRID_COLS);
    const y = Math.floor(rng.next() * GRID_ROWS);
    const idx = indexFor(x, y);
    const tile = tiles[idx];
    if (tile.type === "forest" || tile.type === "grass") {
      const dist = Math.hypot(x - basePoint.x, y - basePoint.y);
      if (dist > 8 && tile.fire === 0) {
        tile.fire = 0.5 + rng.next() * 0.2;
        tile.heat = Math.max(tile.heat, tile.ignitionPoint * 1.4);
        placed += 1;
      }
    }
  }
}

function randomizeWind(): void {
  const base = WIND_DIRS[Math.floor(rng.next() * WIND_DIRS.length)];
  wind = {
    name: base.name,
    dx: base.dx,
    dy: base.dy,
    strength: 0.4 + rng.next() * 0.6
  };
  windTimer = 6 + rng.next() * 8;
}

function updateWind(delta: number): void {
  windTimer -= delta;
  if (windTimer <= 0) {
    randomizeWind();
  }
}

function isPassable(x: number, y: number): boolean {
  if (!inBounds(x, y)) {
    return false;
  }
  const type = tiles[indexFor(x, y)].type;
  return type !== "water";
}

function findPath(start: Point, goal: Point): Point[] {
  if (!inBounds(goal.x, goal.y) || !isPassable(goal.x, goal.y)) {
    return [];
  }
  const startIdx = indexFor(start.x, start.y);
  const goalIdx = indexFor(goal.x, goal.y);
  if (startIdx === goalIdx) {
    return [];
  }

  const prev = new Int32Array(TOTAL_TILES);
  prev.fill(-1);
  const queueX = new Int16Array(TOTAL_TILES);
  const queueY = new Int16Array(TOTAL_TILES);
  let head = 0;
  let tail = 0;

  queueX[tail] = start.x;
  queueY[tail] = start.y;
  tail += 1;
  prev[startIdx] = startIdx;

  while (head < tail) {
    const x = queueX[head];
    const y = queueY[head];
    head += 1;
    if (x === goal.x && y === goal.y) {
      break;
    }
    const neighbors: Point[] = [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 }
    ];
    for (const next of neighbors) {
      if (!inBounds(next.x, next.y) || !isPassable(next.x, next.y)) {
        continue;
      }
      const idx = indexFor(next.x, next.y);
      if (prev[idx] !== -1) {
        continue;
      }
      prev[idx] = indexFor(x, y);
      queueX[tail] = next.x;
      queueY[tail] = next.y;
      tail += 1;
    }
  }

  if (prev[goalIdx] === -1) {
    return [];
  }

  const path: Point[] = [];
  let current = goalIdx;
  while (current !== startIdx) {
    const px = current % GRID_COLS;
    const py = Math.floor(current / GRID_COLS);
    path.push({ x: px, y: py });
    current = prev[current];
  }
  path.reverse();
  return path;
}

function emitWaterSpray(unit: Unit, target: Point | null): void {
  const count = unit.kind === "truck" ? 8 : 5;
  const baseSpeed = unit.kind === "truck" ? 8 : 6;
  const spread = unit.kind === "truck" ? 0.55 : 0.7;
  let baseAngle = rng.next() * Math.PI * 2;
  if (target) {
    baseAngle = Math.atan2(target.y - unit.y, target.x - unit.x);
  }

  for (let i = 0; i < count; i += 1) {
    const jitter = (rng.next() - 0.5) * spread;
    const speed = baseSpeed * (0.7 + rng.next() * 0.6);
    waterParticles.push({
      x: unit.x,
      y: unit.y,
      vx: Math.cos(baseAngle + jitter) * speed,
      vy: Math.sin(baseAngle + jitter) * speed,
      life: 0.5 + rng.next() * 0.25,
      maxLife: 0.75,
      size: 1.6 + rng.next() * 1.4,
      alpha: 1
    });
  }
}

function emitSmokeAt(x: number, y: number): void {
  const count = rng.next() < 0.35 ? 2 : 1;
  const baseSpeed = 0.8 + wind.strength * 1.2;
  for (let i = 0; i < count; i += 1) {
    const jitter = (rng.next() - 0.5) * 0.6;
    const speed = baseSpeed * (0.6 + rng.next() * 0.8);
    const angle = Math.atan2(wind.dy, wind.dx) + jitter;
    smokeParticles.push({
      x: x + (rng.next() - 0.5) * 0.3,
      y: y + (rng.next() - 0.5) * 0.3,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 1.8 + rng.next() * 1.4,
      maxLife: 2.6,
      size: 2.2 + rng.next() * 2.6,
      alpha: 0.8
    });
  }
}

function updateParticles(delta: number): void {
  waterParticles = waterParticles.filter((particle) => {
    particle.life -= delta;
    if (particle.life <= 0) {
      return false;
    }
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.vx *= 0.96;
    particle.vy *= 0.96;
    particle.alpha = particle.life / particle.maxLife;
    return true;
  });

  smokeParticles = smokeParticles.filter((particle) => {
    particle.life -= delta;
    if (particle.life <= 0) {
      return false;
    }
    particle.x += particle.vx * delta;
    particle.y += particle.vy * delta;
    particle.vx += wind.dx * 0.05 * delta;
    particle.vy += wind.dy * 0.05 * delta;
    particle.alpha = particle.life / particle.maxLife;
    return true;
  });
}

function updateHeat(delta: number): void {
  heatBuffer.fill(0);
  const diffusion = clamp(delta * 0.65, 0.08, 0.45);
  const cooling = clamp(1 - delta * 0.22, 0.75, 0.98);

  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const idx = indexFor(x, y);
      const tile = tiles[idx];
      let heat = tile.heat;
      const baseHeat = tile.fire * tile.heatOutput;
      heat = heat * cooling + baseHeat * delta * 3.2;
      if (heat < 0.005) {
        heat = 0;
      }

      const share = heat * diffusion;
      heatBuffer[idx] += heat - share;

      if (share <= 0) {
        continue;
      }

      let weightSum = 0;
      for (const dir of NEIGHBOR_DIRS) {
        const nx = x + dir.x;
        const ny = y + dir.y;
        if (!inBounds(nx, ny)) {
          continue;
        }
        const nIdx = indexFor(nx, ny);
        const slope = tiles[nIdx].elevation - tile.elevation;
        const slopeWeight = slope >= 0 ? 1 + slope * 1.4 : 1 + slope * 0.6;
        const dot = dir.x * wind.dx + dir.y * wind.dy;
        const windWeight = 1 + dot * wind.strength * 0.35;
        const weight = clamp(slopeWeight * windWeight, 0.2, 2.4);
        weightSum += weight;
      }

      if (weightSum <= 0) {
        continue;
      }

      for (const dir of NEIGHBOR_DIRS) {
        const nx = x + dir.x;
        const ny = y + dir.y;
        if (!inBounds(nx, ny)) {
          continue;
        }
        const nIdx = indexFor(nx, ny);
        const slope = tiles[nIdx].elevation - tile.elevation;
        const slopeWeight = slope >= 0 ? 1 + slope * 1.4 : 1 + slope * 0.6;
        const dot = dir.x * wind.dx + dir.y * wind.dy;
        const windWeight = 1 + dot * wind.strength * 0.35;
        const weight = clamp(slopeWeight * windWeight, 0.2, 2.4);
        heatBuffer[nIdx] += (share * weight) / weightSum;
      }
    }
  }

  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i];
    const retention = tile.type === "water" ? 0.4 : tile.type === "ash" ? 0.55 : 1;
    tile.heat = Math.min(5, heatBuffer[i] * retention);
  }
}

function setDeployMode(mode: DeployMode | null): void {
  deployMode = mode;
  ui.deployFirefighter.classList.toggle("active", mode === "firefighter");
  ui.deployTruck.classList.toggle("active", mode === "truck");
  ui.deployClear.classList.toggle("active", mode === "clear");
  if (mode === "firefighter" || mode === "truck") {
    setStatus(`Deploy ${mode === "firefighter" ? "firefighter" : "truck"} units.`);
  } else if (mode === "clear") {
    setStatus(`Clear fuel breaks for ${formatCurrency(FIREBREAK_COST_PER_TILE)} per tile.`);
  } else {
    resetStatus();
  }
}

function selectUnit(unit: Unit | null): void {
  units.forEach((current) => {
    current.selected = unit ? current.id === unit.id : false;
  });
  selectedUnitId = unit ? unit.id : null;
  if (unit) {
    setStatus(`Unit ${unit.kind} selected. Click a tile to retask.`);
  } else {
    resetStatus();
  }
}

function createUnit(kind: UnitKind): Unit {
  const config = UNIT_CONFIG[kind];
  const unit: Unit = {
    id: Date.now() + Math.floor(rng.next() * 10000),
    kind,
    x: basePoint.x + 0.5,
    y: basePoint.y + 0.5,
    target: null,
    path: [],
    pathIndex: 0,
    speed: config.speed,
    radius: config.radius,
    power: config.power,
    selected: false
  };
  return unit;
}

function setUnitTarget(unit: Unit, tileX: number, tileY: number): void {
  if (!inBounds(tileX, tileY) || !isPassable(tileX, tileY)) {
    setStatus("That location is blocked.");
    return;
  }
  unit.target = { x: tileX, y: tileY };
  unit.path = findPath({ x: Math.floor(unit.x), y: Math.floor(unit.y) }, unit.target);
  unit.pathIndex = 0;
  setStatus(`${unit.kind} routing to ${tileX}, ${tileY}.`);
}

function deployUnit(kind: UnitKind, tileX: number, tileY: number): void {
  if (phase !== "fire") {
    setStatus("Units deploy during fire season only.");
    return;
  }
  const config = UNIT_CONFIG[kind];
  if (budget < config.cost) {
    setStatus("Insufficient budget.");
    return;
  }
  const unit = createUnit(kind);
  units.push(unit);
  budget -= config.cost;
  setUnitTarget(unit, tileX, tileY);
}

function clearFuelAt(tileX: number, tileY: number, showStatus = true): boolean {
  if (phase !== "maintenance") {
    if (showStatus) {
      setStatus("Fuel breaks can only be cut during maintenance.");
    }
    return false;
  }
  if (!inBounds(tileX, tileY)) {
    return false;
  }
  const tile = tiles[indexFor(tileX, tileY)];
  if (tile.type === "water" || tile.type === "base" || tile.type === "house" || tile.type === "road") {
    if (showStatus) {
      setStatus("That location cannot be cleared.");
    }
    return false;
  }
  if (tile.type === "firebreak") {
    if (showStatus) {
      setStatus("Fuel break already established.");
    }
    return false;
  }
  if (budget < FIREBREAK_COST_PER_TILE) {
    if (showStatus) {
      setStatus("Insufficient budget.");
    }
    return false;
  }
  if (tile.type === "ash") {
    burnedTiles = Math.max(0, burnedTiles - 1);
  }
  tile.type = "firebreak";
  tile.canopy = 0;
  applyFuel(tile, tile.moisture);
  budget -= FIREBREAK_COST_PER_TILE;
  if (showStatus) {
    setStatus("Fuel break established.");
  }
  return true;
}

function clearFuelLine(start: Point, end: Point): void {
  if (phase !== "maintenance") {
    setStatus("Fuel breaks can only be cut during maintenance.");
    return;
  }
  if (budget < FIREBREAK_COST_PER_TILE) {
    setStatus("Insufficient budget.");
    return;
  }
  let x0 = start.x;
  let y0 = start.y;
  const x1 = end.x;
  const y1 = end.y;
  const dx = Math.abs(x1 - x0);
  const dy = Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx - dy;
  let cleared = 0;
  let spent = 0;

  while (true) {
    if (budget < FIREBREAK_COST_PER_TILE) {
      break;
    }
    if (clearFuelAt(x0, y0, false)) {
      cleared += 1;
      spent += FIREBREAK_COST_PER_TILE;
    }
    if (x0 === x1 && y0 === y1) {
      break;
    }
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x0 += sx;
    }
    if (e2 < dx) {
      err += dx;
      y0 += sy;
    }
  }

  if (cleared > 0) {
    setStatus(`Fuel break carved across ${cleared} tiles for ${formatCurrency(spent)}.`);
  } else {
    setStatus("No valid tiles to clear along that line.");
  }
}

function getUnitAt(tileX: number, tileY: number): Unit | null {
  const clickX = tileX + 0.5;
  const clickY = tileY + 0.5;
  for (const unit of units) {
    const dist = Math.hypot(unit.x - clickX, unit.y - clickY);
    if (dist < 0.6) {
      return unit;
    }
  }
  return null;
}

function handleCanvasClick(event: MouseEvent): void {
  if (deployMode === "clear") {
    return;
  }
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const canvasX = (event.clientX - rect.left) * scaleX;
  const canvasY = (event.clientY - rect.top) * scaleY;
  const world = screenToWorld(canvasX, canvasY);
  const tileX = Math.floor(world.x);
  const tileY = Math.floor(world.y);

  if (!inBounds(tileX, tileY)) {
    return;
  }

  const clickedUnit = getUnitAt(tileX, tileY);
  if (clickedUnit) {
    selectUnit(clickedUnit);
    setDeployMode(null);
    return;
  }

  if (deployMode && selectedUnitId === null) {
    deployUnit(deployMode, tileX, tileY);
    return;
  }

  if (selectedUnitId !== null) {
    const unit = units.find((current) => current.id === selectedUnitId) || null;
    if (unit) {
      setUnitTarget(unit, tileX, tileY);
      return;
    }
  }

  setStatus("Select a unit or choose a deployment.");
}

function getTileFromPointer(event: MouseEvent): Point | null {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const canvasX = (event.clientX - rect.left) * scaleX;
  const canvasY = (event.clientY - rect.top) * scaleY;
  const world = screenToWorld(canvasX, canvasY);
  const tileX = Math.floor(world.x);
  const tileY = Math.floor(world.y);
  if (!inBounds(tileX, tileY)) {
    return null;
  }
  return { x: tileX, y: tileY };
}

function handleClearStart(event: MouseEvent): void {
  if (deployMode !== "clear" || phase !== "maintenance") {
    return;
  }
  if (event.button !== 0) {
    return;
  }
  const tile = getTileFromPointer(event);
  if (!tile) {
    return;
  }
  clearLineStart = tile;
}

function handleClearEnd(event: MouseEvent): void {
  if (!clearLineStart) {
    return;
  }
  const tile = getTileFromPointer(event);
  if (!tile) {
    clearLineStart = null;
    return;
  }
  clearFuelLine(clearLineStart, tile);
  clearLineStart = null;
}

function updateUnits(delta: number): void {
  units.forEach((unit) => {
    if (unit.pathIndex < unit.path.length) {
      const next = unit.path[unit.pathIndex];
      const targetX = next.x + 0.5;
      const targetY = next.y + 0.5;
      const dx = targetX - unit.x;
      const dy = targetY - unit.y;
      const dist = Math.hypot(dx, dy);
      const step = unit.speed * delta;
      if (dist <= step || dist < 0.01) {
        unit.x = targetX;
        unit.y = targetY;
        unit.pathIndex += 1;
      } else {
        unit.x += (dx / dist) * step;
        unit.y += (dy / dist) * step;
      }
    }
  });
}

function applyExtinguish(delta: number): void {
  const powerMultiplier = delta;
  units.forEach((unit) => {
    const radius = unit.radius;
    const minX = Math.max(0, Math.floor(unit.x - radius));
    const maxX = Math.min(GRID_COLS - 1, Math.ceil(unit.x + radius));
    const minY = Math.max(0, Math.floor(unit.y - radius));
    const maxY = Math.min(GRID_ROWS - 1, Math.ceil(unit.y + radius));
    let closestFire: Point | null = null;
    let closestDist = Number.POSITIVE_INFINITY;
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const dist = Math.hypot(unit.x - (x + 0.5), unit.y - (y + 0.5));
        if (dist <= radius) {
          const tile = tiles[indexFor(x, y)];
          if (tile.heat > 0) {
            tile.heat = Math.max(0, tile.heat - unit.power * 1.1 * powerMultiplier);
          }
          if (tile.fire > 0) {
            const before = tile.fire;
            tile.fire = Math.max(0, tile.fire - unit.power * powerMultiplier);
            if (before > 0 && tile.fire === 0 && tile.fuel > 0) {
              containedCount += 1;
            }
            if (dist < closestDist) {
              closestDist = dist;
              closestFire = { x: x + 0.5, y: y + 0.5 };
            }
          }
        }
      }
    }
    if (closestFire) {
      emitWaterSpray(unit, closestFire);
    }
  });
}

function updateFire(delta: number): number {
  const igniteList: Point[] = [];
  let activeFires = 0;
  const emberChance = delta * 0.1;
  for (let y = 0; y < GRID_ROWS; y += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const idx = indexFor(x, y);
      const tile = tiles[idx];
      if (tile.fire > 0) {
        activeFires += 1;
        if (rng.next() < delta * 0.8) {
          emitSmokeAt(x + 0.5, y + 0.5);
        }
        if (tile.fuel > 0) {
          const heatRatio = tile.heat / (tile.ignitionPoint * 1.6);
          const growth = delta * tile.burnRate * (heatRatio - 0.45);
          tile.fire = clamp(tile.fire + growth, 0, 1);
          tile.fuel = Math.max(0, tile.fuel - delta * tile.burnRate * (0.6 + tile.fire * 0.9));
        }
        if (tile.fuel <= 0.02 && tile.type !== "ash") {
          if (tile.type === "house" && !tile.houseDestroyed) {
            tile.houseDestroyed = true;
            destroyedHouses += 1;
            lostPropertyValue += tile.houseValue;
            lostResidents += tile.houseResidents;
            yearPropertyLost += tile.houseValue;
            yearLivesLost += tile.houseResidents;
          }
          tile.fire = 0;
          tile.type = "ash";
          tile.fuel = 0;
          tile.heat *= 0.4;
          if (!tile.isBase) {
            burnedTiles += 1;
          }
          continue;
        }

        if (rng.next() < emberChance * wind.strength) {
          let best: Point | null = null;
          let bestDot = -Infinity;
          for (const dir of NEIGHBOR_DIRS) {
            const nx = x + dir.x;
            const ny = y + dir.y;
            if (!inBounds(nx, ny)) {
              continue;
            }
            const dot = dir.x * wind.dx + dir.y * wind.dy;
            if (dot > bestDot) {
              bestDot = dot;
              best = { x: nx, y: ny };
            }
          }
          if (best) {
            const neighbor = tiles[indexFor(best.x, best.y)];
            if (neighbor.fire === 0 && neighbor.fuel > 0) {
              neighbor.heat = Math.min(5, neighbor.heat + 0.25 + wind.strength * 0.25);
            }
          }
        }
      } else if (tile.fuel > 0 && tile.heat >= tile.ignitionPoint) {
        igniteList.push({ x, y });
      }
    }
  }

  igniteList.forEach((point) => {
    const tile = tiles[indexFor(point.x, point.y)];
    if (tile.fire === 0 && tile.fuel > 0) {
      tile.fire = 0.2 + rng.next() * 0.25;
    }
  });

  return activeFires;
}

function getBaseTile(): Tile {
  return tiles[indexFor(basePoint.x, basePoint.y)];
}

function checkFailureConditions(): void {
  if (gameOver) {
    return;
  }
  const baseTile = getBaseTile();
  if (baseTile.fire > 0 || baseTile.type === "ash") {
    endGame(false, "The command base is lost.");
    return;
  }
  const propertyLossRatio = totalPropertyValue > 0 ? lostPropertyValue / totalPropertyValue : 0;
  const landLossRatio = totalLandTiles > 0 ? burnedTiles / totalLandTiles : 0;
  if ((totalHouses > 0 && destroyedHouses >= totalHouses) || propertyLossRatio > 0.75 || landLossRatio > 0.85) {
    endGame(false, "The region is devastated beyond recovery.");
  }
}

function updateStats(activeFires: number): void {
  ui.budgetValue.textContent = formatCurrency(budget);
  ui.approvalValue.textContent = `${Math.round(approval * 100)}%`;
  ui.yearValue.textContent = `${year} / ${CAREER_YEARS}`;
  ui.phaseValue.textContent = formatPhaseStatus();
  ui.firesValue.textContent = activeFires.toString();
  ui.scoreValue.textContent = careerScore.toLocaleString();
  ui.windValue.textContent = phase === "fire" ? `${wind.name} ${Math.round(wind.strength * 10)}` : "Calm";
  ui.propertyLossValue.textContent = formatCurrency(lostPropertyValue);
  ui.livesLossValue.textContent = lostResidents.toLocaleString();
}

function renderLeaderboard(): void {
  const entries = loadLeaderboard();
  ui.leaderboardList.innerHTML = "";
  entries.forEach((entry) => {
    const item = document.createElement("li");
    item.textContent = `${entry.name} - ${entry.score}`;
    ui.leaderboardList.appendChild(item);
  });
}

function loadLeaderboard(): LeaderboardEntry[] {
  const raw = localStorage.getItem(LEADERBOARD_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as LeaderboardEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLeaderboard(entry: LeaderboardEntry): void {
  const entries = loadLeaderboard();
  entries.push(entry);
  entries.sort((a, b) => b.score - a.score);
  const trimmed = entries.slice(0, 8);
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(trimmed));
}

function endGame(victory: boolean, reason?: string): void {
  gameOver = true;
  paused = true;
  const approvalBonus = Math.floor(approval * 500);
  const budgetBonus = Math.floor(budget * 0.5);
  const score = Math.max(0, Math.floor(careerScore + approvalBonus + budgetBonus));

  ui.overlay.classList.remove("hidden");
  ui.overlayTitle.textContent = victory ? "Career Complete" : "Command Relieved";
  const baseMessage =
    reason || (victory ? "Your twenty-year career leaves the region resilient." : "The region is overwhelmed.");
  ui.overlayMessage.textContent = `${baseMessage} Final score: ${score}.`;

  const callsign = ui.callsignInput.value.trim() || "Chief";
  saveLeaderboard({ name: callsign, score, seed, date: Date.now() });
  renderLeaderboard();
}

function resetGame(newSeed: number): void {
  ui.overlay.classList.add("hidden");
  setDeployMode(null);
  selectUnit(null);
  units = [];
  waterParticles = [];
  smokeParticles = [];
  heatBuffer.fill(0);
  colorNoiseMap.fill(0.5);
  budget = BASE_BUDGET;
  pendingBudget = BASE_BUDGET;
  burnedTiles = 0;
  containedCount = 0;
  year = 1;
  phaseIndex = 0;
  phaseDay = 0;
  phase = "growth";
  approval = 0.7;
  careerScore = 0;
  lostPropertyValue = 0;
  lostResidents = 0;
  yearPropertyLost = 0;
  yearLivesLost = 0;
  clearLineStart = null;
  paused = false;
  gameOver = false;
  randomizeWind();

  generateMap(newSeed);
  cameraCenter = { x: basePoint.x + 0.5, y: basePoint.y + 0.5 };
  ui.seedValue.textContent = seed.toString();
  setPhase("growth");
  renderLeaderboard();
}

function update(delta: number): void {
  if (paused || gameOver) {
    return;
  }

  const dayDelta = delta * DAYS_PER_SECOND;
  const calendarDelta = phase === "growth" ? dayDelta * GROWTH_SPEED_MULTIPLIER : dayDelta;
  if (phase !== "maintenance") {
    advanceCalendar(calendarDelta);
  }
  if (gameOver) {
    updateStats(0);
    return;
  }

  if (phase === "growth") {
    applyGrowth(calendarDelta);
  }

  let activeFires = 0;
  if (phase === "fire") {
    updateWind(delta);
    igniteRandomFire(dayDelta);
    updateUnits(delta);
    applyExtinguish(delta);
    updateHeat(delta);
    activeFires = updateFire(delta);
  }

  updateParticles(delta);
  checkFailureConditions();
  updateStats(activeFires);
}

function tileSeed(x: number, y: number, offset: number): number {
  return hash2D(x + offset * 31, y + offset * 57, seed + offset * 131);
}

function drawTreeAt(
  context: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  baseHeight: number,
  size: number,
  canopyColor: string
): void {
  const base = isoProject(wx, wy, baseHeight);
  const trunkTop = isoProject(wx, wy, baseHeight + size * 0.55);
  const top = isoProject(wx, wy, baseHeight + size * 1.6);

  context.fillStyle = "rgba(73, 54, 38, 0.85)";
  context.beginPath();
  context.moveTo(base.x - size * 0.08, base.y);
  context.lineTo(base.x + size * 0.08, base.y);
  context.lineTo(trunkTop.x + size * 0.08, trunkTop.y);
  context.lineTo(trunkTop.x - size * 0.08, trunkTop.y);
  context.closePath();
  context.fill();

  context.fillStyle = canopyColor;
  context.beginPath();
  context.moveTo(top.x, top.y);
  context.lineTo(base.x + size * 0.36, base.y - size * 0.18);
  context.lineTo(base.x - size * 0.36, base.y - size * 0.18);
  context.closePath();
  context.fill();
}

function drawTreesOnTile(
  context: CanvasRenderingContext2D,
  tile: Tile,
  x: number,
  y: number,
  height: number
): void {
  if (tile.type !== "grass" && tile.type !== "forest") {
    return;
  }
  const canopy = clamp(tile.canopy, 0, 1);
  if (tile.type === "grass" && canopy < 0.25) {
    return;
  }
  const density = tile.type === "forest" ? 0.55 + canopy * 0.35 : canopy * 0.4;
  if (tileSeed(x, y, 1) > density) {
    return;
  }
  const baseColor = tile.type === "forest" ? TILE_COLOR_RGB.forest : TILE_COLOR_RGB.grass;
  const count =
    tile.type === "forest"
      ? 2 + Math.floor(tileSeed(x, y, 2) * (1 + canopy * 2))
      : tileSeed(x, y, 3) > 0.45
        ? 1
        : 0;
  const baseSize = TILE_SIZE * (tile.type === "forest" ? 0.9 : 0.65);

  for (let i = 0; i < count; i += 1) {
    const jitterX = (tileSeed(x, y, 10 + i) - 0.5) * 0.45;
    const jitterY = (tileSeed(x, y, 20 + i) - 0.5) * 0.45;
    const shade = 0.78 + tileSeed(x, y, 30 + i) * 0.35;
    const size = baseSize * (0.85 + canopy * 0.4 + tileSeed(x, y, 40 + i) * 0.2);
    const canopyColor = rgbString(scaleRgb(baseColor, shade));
    drawTreeAt(context, x + 0.5 + jitterX, y + 0.5 + jitterY, height + TILE_SIZE * 0.05, size, canopyColor);
  }
}

function draw(): void {
  if (!ctx) {
    return;
  }
  const view = getViewTransform();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);

  for (let sum = 0; sum <= GRID_COLS + GRID_ROWS - 2; sum += 1) {
    for (let x = 0; x < GRID_COLS; x += 1) {
      const y = sum - x;
      if (y < 0 || y >= GRID_ROWS) {
        continue;
      }
      const tile = tiles[indexFor(x, y)];
      const height = getTileHeight(tile);
      const top = shadeTileColor(tile, x, y);
      const east = scaleRgb(top, 0.82);
      const south = scaleRgb(top, 0.68);
      const p0 = isoProject(x, y, height);
      const p1 = isoProject(x + 1, y, height);
      const p2 = isoProject(x + 1, y + 1, height);
      const p3 = isoProject(x, y + 1, height);

      const eastNeighborHeight = inBounds(x + 1, y) ? getTileHeight(tiles[indexFor(x + 1, y)]) : 0;
      if (eastNeighborHeight < height - 0.1) {
        const low1 = isoProject(x + 1, y, eastNeighborHeight);
        const low2 = isoProject(x + 1, y + 1, eastNeighborHeight);
        ctx.fillStyle = rgbString(east);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(low2.x, low2.y);
        ctx.lineTo(low1.x, low1.y);
        ctx.closePath();
        ctx.fill();
      }

      const southNeighborHeight = inBounds(x, y + 1) ? getTileHeight(tiles[indexFor(x, y + 1)]) : 0;
      if (southNeighborHeight < height - 0.1) {
        const low1 = isoProject(x, y + 1, southNeighborHeight);
        const low2 = isoProject(x + 1, y + 1, southNeighborHeight);
        ctx.fillStyle = rgbString(south);
        ctx.beginPath();
        ctx.moveTo(p3.x, p3.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.lineTo(low2.x, low2.y);
        ctx.lineTo(low1.x, low1.y);
        ctx.closePath();
        ctx.fill();
      }

      ctx.fillStyle = rgbString(top);
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      ctx.lineTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.lineTo(p3.x, p3.y);
      ctx.closePath();
      ctx.fill();

      drawTreesOnTile(ctx, tile, x, y, height);

      if (tile.type === "house") {
        const roof = isoProject(x + 0.5, y + 0.5, height + TILE_SIZE * 0.35);
        ctx.fillStyle = TILE_COLORS.house;
        ctx.beginPath();
        ctx.moveTo(roof.x, roof.y - TILE_SIZE * 0.28);
        ctx.lineTo(roof.x + TILE_SIZE * 0.32, roof.y);
        ctx.lineTo(roof.x, roof.y + TILE_SIZE * 0.28);
        ctx.lineTo(roof.x - TILE_SIZE * 0.32, roof.y);
        ctx.closePath();
        ctx.fill();
      }

      if (tile.fire > 0) {
        const intensity = clamp(tile.fire, 0.2, 1);
        const colorIndex = Math.min(FIRE_COLORS.length - 1, Math.floor(intensity * FIRE_COLORS.length));
        const center = isoProject(x + 0.5, y + 0.5, height + TILE_SIZE * 0.4);
        ctx.fillStyle = FIRE_COLORS[colorIndex];
        ctx.globalAlpha = 0.6 + intensity * 0.3;
        ctx.beginPath();
        ctx.arc(center.x, center.y, TILE_SIZE * (0.3 + intensity * 0.35), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  units.forEach((unit) => {
    const baseHeight = getHeightAt(unit.x, unit.y);
    const ground = isoProject(unit.x, unit.y, baseHeight);
    const head = isoProject(unit.x, unit.y, baseHeight + TILE_SIZE * 1.2);
    ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
    ctx.beginPath();
    ctx.ellipse(ground.x, ground.y + TILE_SIZE * 0.2, TILE_SIZE * 0.35, TILE_SIZE * 0.2, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = UNIT_CONFIG[unit.kind].color;
    ctx.beginPath();
    ctx.arc(head.x, head.y, TILE_SIZE * 0.32, 0, Math.PI * 2);
    ctx.fill();
    if (unit.selected) {
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });

  smokeParticles.forEach((particle) => {
    const baseHeight = getHeightAt(particle.x, particle.y);
    const rise = (1 - particle.alpha) * TILE_SIZE * 5;
    const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 2 + rise);
    const alpha = clamp(particle.alpha * 0.6, 0, 0.6);
    ctx.fillStyle = `rgba(70, 70, 70, ${alpha})`;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, particle.size * 0.5, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.fillStyle = WATER_PARTICLE_COLOR;
  waterParticles.forEach((particle) => {
    const baseHeight = getHeightAt(particle.x, particle.y);
    const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 0.5);
    ctx.globalAlpha = clamp(particle.alpha, 0, 1);
    ctx.fillRect(pos.x - particle.size / 2, pos.y - particle.size / 2, particle.size, particle.size);
  });
  ctx.globalAlpha = 1;
}

function frame(now: number): void {
  if (!lastTick) {
    lastTick = now;
  }
  const delta = Math.min(0.25, (now - lastTick) / 1000);
  lastTick = now;
  accumulator += delta;
  const step = 0.1;
  while (accumulator >= step) {
    update(step);
    accumulator -= step;
  }
  draw();
  requestAnimationFrame(frame);
}

ui.deployFirefighter.addEventListener("click", () => {
  setDeployMode(deployMode === "firefighter" ? null : "firefighter");
  selectUnit(null);
});

ui.deployTruck.addEventListener("click", () => {
  setDeployMode(deployMode === "truck" ? null : "truck");
  selectUnit(null);
});

ui.deployClear.addEventListener("click", () => {
  setDeployMode(deployMode === "clear" ? null : "clear");
  selectUnit(null);
});

ui.beginFireSeason.addEventListener("click", () => {
  beginFireSeason();
});

ui.newRunBtn.addEventListener("click", () => {
  resetGame(Math.floor(Date.now() % 1000000));
});

ui.pauseBtn.addEventListener("click", () => {
  paused = !paused;
  ui.pauseBtn.textContent = paused ? "Resume" : "Pause";
  if (paused) {
    setStatus("Simulation paused.");
  } else {
    resetStatus();
  }
});

ui.zoomOutBtn.addEventListener("click", () => {
  zoomAtPointer(zoom - ZOOM_STEP, canvas.width / 2, canvas.height / 2);
});

ui.zoomInBtn.addEventListener("click", () => {
  zoomAtPointer(zoom + ZOOM_STEP, canvas.width / 2, canvas.height / 2);
});

ui.overlayRestart.addEventListener("click", () => {
  resetGame(Math.floor(Date.now() % 1000000));
});

canvas.addEventListener("click", handleCanvasClick);
canvas.addEventListener("mousedown", handleClearStart);
canvas.addEventListener("mouseup", handleClearEnd);
canvas.addEventListener("mouseleave", () => {
  clearLineStart = null;
});
canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    const direction = Math.sign(event.deltaY);
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    zoomAtPointer(zoom - direction * ZOOM_STEP, canvasX, canvasY);
  },
  { passive: false }
);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    selectUnit(null);
    setDeployMode(null);
  }
  if (event.key === "+" || event.key === "=") {
    zoomAtPointer(zoom + ZOOM_STEP, canvas.width / 2, canvas.height / 2);
  }
  if (event.key === "-" || event.key === "_") {
    zoomAtPointer(zoom - ZOOM_STEP, canvas.width / 2, canvas.height / 2);
  }
});

resetGame(Math.floor(Date.now() % 1000000));
requestAnimationFrame(frame);
