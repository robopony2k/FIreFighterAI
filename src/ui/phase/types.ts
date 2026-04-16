import type {
  ApprovalTier,
  ClimateForecast,
  Formation,
  RiskTier,
  ScoreEventLane,
  ScoreEventSeverity,
  ScoreFlowKind,
  SimTimeMode,
  TimeSpeedControlMode
} from "../../core/types.js";
export type Phase = "growth" | "maintenance" | "fire" | "budget";

export type InteractionMode = "default" | "deploy" | "fuelBreak" | "formation" | "inspect";

export type PanelId =
  | "topbar"
  | "bottomControls"
  | "miniMap"
  | "rightDock"
  | "unitTray"
  | "progressionDraft"
  | "maintenanceRoster"
  | "maintenanceCrew"
  | "fuelBreak"
  | "fireDeploy"
  | "fireUnitList"
  | "fireSelectedUnit"
  | "budgetReport";

export type InputAction =
  | "pan"
  | "zoom"
  | "select"
  | "retask"
  | "formation"
  | "deploy"
  | "clearFuelBreak"
  | "timeControl";

export type SelectedEntity =
  | { kind: "none" }
  | {
      kind: "unit";
      id: number;
      unitType: "firefighter" | "truck";
      status?: string;
      crewFormation?: Formation | null;
    };

export type PrimaryCta = {
  label: string;
  actionId: string;
};

export type GameUiSnapshot = {
  phase: Phase;
  phaseProgress: number;
  annualReportOpen: boolean;
  selection: SelectedEntity;
  interactionMode: InteractionMode;
  paused: boolean;
  alert: string | null;
  simTimeMode: SimTimeMode;
  timeSpeedControlMode: TimeSpeedControlMode;
  timeSpeedIndex: number;
  timeSpeedValue: number;
  skipToNextFireActive: boolean;
  canSkipToNextFire: boolean;
  forecast: ClimateForecast | null;
  forecastDay: number;
  forecastStartDay: number;
  forecastYearDays: number;
  forecastMeta: string | null;
  progression: {
    level: number;
    totalAssistedExtinguishes: number;
    currentThreshold: number;
    nextThreshold: number | null;
    progress01: number;
    queuedDraftCount: number;
    hasActiveDraft: boolean;
    ownedRewards: Array<{
      id: string;
      label: string;
      name: string;
      stacks: number;
    }>;
  } | null;
  scoring: {
    score: number;
    difficultyMult: number;
    approvalMult: number;
    streakMult: number;
    riskMult: number;
    totalMult: number;
    noHouseLossDays: number;
    noLifeLossDays: number;
    approvalTier: ApprovalTier;
    riskTier: RiskTier;
    nextApprovalTier: ApprovalTier | null;
    nextApprovalThreshold01: number | null;
    nextTierProgress01: number;
    activeFireCount: number;
    extinguishedCount: number;
    propertyDamageCount: number;
    livesLostCount: number;
    events: Array<{
      id: number;
      lane: ScoreEventLane;
      deltaCount: number;
      deltaPoints: number;
      severity: ScoreEventSeverity;
      remainingSeconds: number;
      detail?: string;
    }>;
    flowEvents: Array<{
      id: number;
      kind: ScoreFlowKind;
      deltaCount: number;
      remainingSeconds: number;
      tileX?: number;
      tileY?: number;
    }>;
  } | null;
};
