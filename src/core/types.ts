export type TileType = "water" | "grass" | "forest" | "ash" | "road" | "base" | "house" | "firebreak";

export type UnitKind = "firefighter" | "truck";
export type SeasonPhase = "growth" | "maintenance" | "fire" | "budget";
export type DeployMode = UnitKind | "clear";

export interface Point {
  x: number;
  y: number;
}

export interface Grid {
  cols: number;
  rows: number;
  totalTiles: number;
}

export interface Tile {
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
  ashAge: number;
}

export interface Unit {
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

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  alpha: number;
}

export interface Wind {
  name: string;
  dx: number;
  dy: number;
  strength: number;
}

export interface LeaderboardEntry {
  name: string;
  score: number;
  seed: number;
  date: number;
}

export interface FuelProfile {
  baseFuel: number;
  ignition: number;
  burnRate: number;
  heatOutput: number;
}

export interface RNG {
  next(): number;
}
