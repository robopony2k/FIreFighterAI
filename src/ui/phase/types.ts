import type { ApprovalTier, ClimateForecast, Formation, RiskTier, ScoreEventSeverity } from "../../core/types.js";
export type Phase = "growth" | "maintenance" | "fire" | "budget";

export type InteractionMode = "default" | "deploy" | "fuelBreak" | "formation" | "inspect";

export type PanelId =
  | "topbar"
  | "bottomControls"
  | "miniMap"
  | "rightDock"
  | "unitTray"
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
  selection: SelectedEntity;
  interactionMode: InteractionMode;
  paused: boolean;
  alert: string | null;
  timeSpeedIndex: number;
  skipToNextFireActive: boolean;
  canSkipToNextFire: boolean;
  forecast: ClimateForecast | null;
  forecastDay: number;
  forecastStartDay: number;
  forecastYearDays: number;
  forecastMeta: string | null;
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
    events: Array<{
      id: number;
      message: string;
      severity: ScoreEventSeverity;
      remainingSeconds: number;
    }>;
  } | null;
};
