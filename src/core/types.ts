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
export enum TreeType {
  // Tall evergreen, colder and drier slopes.
  Pine = "pine",
  // Broad canopy, richer lowlands.
  Oak = "oak",
  // Mixed hardwood, balanced climates.
  Maple = "maple",
  // Light pioneer, early regrowth.
  Birch = "birch",
  // Moist ground specialist.
  Elm = "elm",
  // Low, hardy brush.
  Scrub = "scrub"
}

export const TREE_TYPE_ORDER: TreeType[] = [
  TreeType.Pine,
  TreeType.Oak,
  TreeType.Maple,
  TreeType.Birch,
  TreeType.Elm,
  TreeType.Scrub
];

export const TREE_TYPE_IDS: Record<TreeType, number> = TREE_TYPE_ORDER.reduce(
  (acc, type, index) => {
    acc[type] = index;
    return acc;
  },
  {} as Record<TreeType, number>
);

export const TREE_ID_TO_TYPE: TreeType[] = TREE_TYPE_ORDER;




export type UnitKind = "firefighter" | "truck";

export type UnitSkill = "speed" | "power" | "range" | "resilience";

export type RosterStatus = "available" | "deployed" | "lost";

export type SeasonPhase = "growth" | "maintenance" | "fire" | "budget";
export type SimTimeMode = "strategic" | "incident";
export type TimeSpeedControlMode = "buttons" | "slider";

export type DeployMode = UnitKind | "clear";

export type Formation = "narrow" | "medium" | "wide";
export type WaterSprayMode = "precision" | "balanced" | "suppression";
export type CommandType = "move" | "suppress" | "contain" | "backburn";
export type BehaviourMode = "aggressive" | "balanced" | "defensive";
export type CommandFormation = "loose" | "line" | "area";
export type SelectionScope = "commandUnit" | "truck";

export type FireSimPhase = "snapshot" | "heat-clear" | "heat-pass1" | "heat-pass2" | "fire" | "ignite";



export interface Point {

  x: number;



  y: number;

}

export type LineTarget = {
  kind: "line";
  start: Point;
  end: Point;
};

export type AreaTarget = {
  kind: "area";
  start: Point;
  end: Point;
};

export type CommandTarget =
  | {
      kind: "point";
      point: Point;
    }
  | LineTarget
  | AreaTarget;

export interface CommandIntent {
  type: CommandType;
  target: CommandTarget;
  formation: CommandFormation;
  behaviourMode: BehaviourMode;
}

export type CommandUnitStatus = "suppressing" | "moving" | "holding" | "retreating";

export type CommandUnitAlert =
  | "empty"
  | "critical"
  | "low"
  | "warning"
  | "crew_low"
  | "danger";

export interface CommandUnit {
  id: number;
  name: string;
  truckIds: number[];
  currentIntent: CommandIntent | null;
  status: CommandUnitStatus;
  revision: number;
}

export type BuildingClass = "residential_low" | "residential_mid" | "residential_high";

export type TownIndustryProfile = "coastal" | "farming" | "mining" | "general";

export type TownStreetArchetype = "ribbon" | "main_street" | "crossroads" | "contour";

export interface TownGrowthFrontier extends Point {
  dx: number;
  dy: number;
  active: boolean;
  branchType: "primary" | "secondary";
}

export interface Town extends Point {
  id: number;
  name: string;
  cx: number;
  cy: number;
  radius: number;
  industryProfile: TownIndustryProfile;
  streetArchetype: TownStreetArchetype;
  growthFrontiers: TownGrowthFrontier[];
  growthSeedYear: number;
  simulatedGrowthYears: number;
  houseCount: number;
  housesLost: number;
  alertPosture: number;
  alertCooldownDays: number;
  nonApprovingHouseCount: number;
  approval: number;
  evacState: "none" | "in_progress" | "complete";
  evacProgress: number;
  lastPostureChangeDay?: number;
  desiredHouseDelta?: number;
  lastSeasonHouseDelta?: number;
  growthPressure: number;
  recoveryPressure: number;
  buildStartCooldownDays: number;
  activeBuildCap: number;
  buildStartSerial: number;
}

export interface FireAlertIncident {
  id: number;
  tileX: number;
  tileY: number;
  townId: number;
  year: number;
  careerDay: number;
  phaseDay: number;
}

export interface SkipToNextFireState {
  active: boolean;
  previousPaused: boolean;
  previousTimeSpeedIndex: number;
  previousTimeSpeedSliderValue: number;
  startedCareerDay: number;
}



export interface Grid {

  cols: number;

  rows: number;

  totalTiles: number;

}



export interface Tile {

  type: TileType;
  buildingClass?: BuildingClass | null;

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

  vegetationAgeYears: number;
  canopy: number;
  canopyCover: number;
  stemDensity: number;
  dominantTreeType: TreeType | null;
  treeType: TreeType | null;

  houseValue: number;

  houseResidents: number;

  houseDestroyed: boolean;

  houseConstructionYear?: number;
  houseDestroyedAtDay?: number;
  houseTownId?: number;
  houseStyleSeed?: number;

  houseDamage01?: number;

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

  hoseRange: number;

  power: number;

  selected: boolean;

  carrierId: number | null;

  passengerIds: number[];

  assignedTruckId: number | null;

  commandUnitId: number | null;

    crewIds: number[];

    crewMode: "boarded" | "deployed";

  formation: Formation;

  behaviourMode: BehaviourMode;

  attackTarget: Point | null;

  sprayTarget: Point | null;

  truckOverrideIntent: CommandIntent | null;

  water: number;

  waterCapacity: number;

  waterRefillRate: number;

  lastBackburnAt: number;

  currentStatus: CommandUnitStatus;

  currentAlerts: CommandUnitAlert[];

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

  sprayMode?: WaterSprayMode;
  sprayVolume?: number;
  spraySeed?: number;
  sprayPulseHz?: number;
  spraySpread?: number;
  spraySourceId?: number;

}

export interface WaterStreamFx {
  sourceUnitId: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  mode: WaterSprayMode;
  volume: number;
  intensity: number;
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

export type ApprovalTier = "S" | "A" | "B" | "C" | "D";

export type RiskTier = "low" | "moderate" | "high" | "extreme";

export type ScoreEventSeverity = "positive" | "negative" | "info";

export type ScoreEventLane = "extinguished" | "property" | "lives" | "info";

export type ScoreFlowKind = "gain" | "extinguished" | "property" | "lives" | "decay";

export type ScoreEvent = {
  id: number;
  lane: ScoreEventLane;
  deltaCount: number;
  deltaPoints: number;
  severity: ScoreEventSeverity;
  remainingSeconds: number;
  detail?: string;
};

export type ScoreFlowEvent = {
  id: number;
  kind: ScoreFlowKind;
  deltaCount: number;
  remainingSeconds: number;
  tileX?: number;
  tileY?: number;
};

export type ScoringSeasonSummary = {
  extinguishedCount: number;
  extinguishPoints: number;
  propertyDamageCount: number;
  propertyDamagePenalties: number;
  destroyedHouseCount: number;
  criticalAssetLossCount: number;
  houseLossPenalties: number;
  criticalAssetLossPenalties: number;
  livesLostCount: number;
  civilianLivesLost: number;
  firefighterLivesLost: number;
  lifeLossPenalties: number;
  civilianLifeLossPenalties: number;
  firefighterLifeLossPenalties: number;
  positiveBasePoints: number;
  multipliedPositivePoints: number;
  seasonStartScore: number;
  seasonFinalScore: number;
  seasonDeltaScore: number;
  averageApprovalMult: number;
  averageRiskMult: number;
  finalDifficultyMult: number;
  finalApprovalMult: number;
  finalStreakMult: number;
  finalRiskMult: number;
  finalTotalMult: number;
  finalApprovalTier: ApprovalTier;
  finalRiskTier: RiskTier;
  finalNoHouseLossDays: number;
  finalNoLifeLossDays: number;
};

export type ScoringState = {
  grossPoints: number;
  lossPenalties: number;
  score: number;
  difficultyMult: number;
  approvalMult: number;
  streakMult: number;
  riskMult: number;
  totalMult: number;
  approvalTier: ApprovalTier;
  riskTier: RiskTier;
  approval01: number;
  nextApprovalTier: ApprovalTier | null;
  nextApprovalThreshold01: number | null;
  nextTierProgress01: number;
  noHouseLossDays: number;
  noLifeLossDays: number;
  dayAccumulator: number;
  hadHouseLossToday: boolean;
  hadLifeLossToday: boolean;
  seasonExtinguishedCount: number;
  seasonExtinguishPoints: number;
  seasonPropertyDamageCount: number;
  seasonPropertyDamagePenalties: number;
  seasonDestroyedHouseCount: number;
  seasonCriticalAssetLossCount: number;
  seasonHouseLossPenalties: number;
  seasonCriticalAssetLossPenalties: number;
  seasonLivesLostCount: number;
  seasonCivilianLivesLost: number;
  seasonFirefighterLivesLost: number;
  seasonLifeLossPenalties: number;
  seasonCivilianLifeLossPenalties: number;
  seasonFirefighterLifeLossPenalties: number;
  seasonMultipliedPositivePoints: number;
  seasonStartScore: number;
  seasonFinalScore: number;
  seasonApprovalMultIntegral: number;
  seasonRiskMultIntegral: number;
  seasonSampleSeconds: number;
  seasonSummary: ScoringSeasonSummary | null;
  events: ScoreEvent[];
  flowEvents: ScoreFlowEvent[];
  nextEventId: number;
  nextFlowEventId: number;
  previousDestroyedHouses: number;
  previousLostResidents: number;
  previousLostFirefighters: number;
  previousTownHousesLost: Int32Array;
  burnStartFuel: Float32Array;
  lastSuppressedAt: Float32Array;
  pendingFlowEvents: Array<Omit<ScoreFlowEvent, "id">>;
  attributedFireLossTiles: Set<number>;
  prevFireBoundsActive: boolean;
  prevFireMinX: number;
  prevFireMaxX: number;
  prevFireMinY: number;
  prevFireMaxY: number;
};

export interface RNG {
  next(): number;

}

