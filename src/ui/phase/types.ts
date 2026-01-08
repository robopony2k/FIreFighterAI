export type Phase = "growth" | "maintenance" | "fire" | "budget";

export type InteractionMode = "default" | "deploy" | "fuelBreak" | "formation" | "inspect";

export type PanelId =
  | "topbar"
  | "contextHint"
  | "bottomControls"
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
  | { kind: "unit"; id: number; unitType: "firefighter" | "truck"; status?: string };

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
  windLabel: string | null;
};
