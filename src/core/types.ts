export type TileType =
  | "water"
  | "beach"
  | "floodplain"
  | "grass"
  | "scrub"
  | "forest"
  | "rocky"
  | "bare"
  | "ash"
  | "road"
  | "base"
  | "house"
  | "firebreak";

export type UnitKind = "firefighter" | "truck";
export type UnitSkill = "speed" | "power" | "range" | "resilience";
export type RosterStatus = "available" | "deployed" | "lost";

export type SeasonPhase = "growth" | "maintenance" | "fire" | "budget";

export type DeployMode = UnitKind | "clear";

export type Formation = "narrow" | "medium" | "wide";

export type FireSimPhase = "snapshot" | "heat-clear" | "heat-pass1" | "heat-pass2" | "fire" | "ignite";



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
  spreadBoost: number;
  heatTransferCap: number;
  heatRetention: number;
  windFactor: number;
  moisture: number;
  waterDist: number;
  canopy: number;
  houseValue: number;
  houseResidents: number;
  houseDestroyed: boolean;
  ashAge: number;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  rosterId: number | null;
  autonomous: boolean;
  x: number;
  y: number;
  prevX: number;
  prevY: number;
  target: Point | null;
  path: Point[];
  pathIndex: number;
  speed: number;
  radius: number;
  power: number;
  selected: boolean;
  carrierId: number | null;
  passengerIds: number[];
  assignedTruckId: number | null;
    crewIds: number[];

    crewMode: "boarded" | "deployed";

    formation: Formation;

  }

  

  export interface UnitTraining {

  

    speed: number;

  

    power: number;

  

    range: number;

  

    resilience: number;

  

  }

  

  

  

  export interface RosterUnit {

  

    id: number;
  kind: UnitKind;
  name: string;
  training: UnitTraining;
    status: RosterStatus;

    assignedTruckId: number | null;

    crewIds: number[];

    formation: Formation;

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

export interface FireSimWork {
  phase: FireSimPhase;
  useSnapshot: boolean;
  neighborMode: 4 | 8;
  quality: 0 | 1 | 2;
  boundsActive: boolean;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  snapshotMinX: number;
  snapshotMaxX: number;
  snapshotMinY: number;
  snapshotMaxY: number;
  heatMinX: number;
  heatMaxX: number;
  heatMinY: number;
  heatMaxY: number;
  hasHeatBounds: boolean;
  currentY: number;
  fireDelta: number;
  hotFactor: number;
  heatDelta: number;
  diffusion: number;
  cooling: number;
  advectX: number;
  advectY: number;
  advectFraction: number;
  igniteBuffer: Int32Array;
  igniteCount: number;
  heatWeights: Float32Array;
  heatWeightScale: number;
  heatActiveMinX: number;
  heatActiveMaxX: number;
  heatActiveMinY: number;
  heatActiveMaxY: number;
  heatResidue: boolean;
  smokeAccumulator: number;
  activeFires: number;
  nextMinX: number;
  nextMaxX: number;
  nextMinY: number;
  nextMaxY: number;
}

export interface FireSettings {
  ignitionChancePerDay: number;
  simSpeed: number;
  simTickSeconds: number;
  renderSmoothSeconds: number;
  seasonTaperDays: number;
  seasonMinIntensity: number;
  dayFactorMin: number;
  dayFactorMax: number;
  diffusionCardinal: number;
  diffusionDiagonal: number;
  diffusionSecondary: number;
  diffusionMoisture: number;
  heatCap: number;
  conflagrationHeatBoost: number;
  conflagrationFuelBoost: number;
  boundsPadding: number;
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
  spreadBoost: number;
  heatTransferCap: number;
  heatRetention: number;
  windFactor: number;
}

export type ClimateForecast = {
  days: number;
  temps: number[];
  risk: number[];
};

export type ClimateTimeline = {
  daysPerYear: number;
  totalDays: number;
  risk: Float32Array;
};

export interface RNG {
  next(): number;
}
