import type { WorldState } from "../../../core/state.js";
import type { RNG } from "../../../core/types.js";
import type { FireWeatherResponse } from "../sim/fireWeather.js";
import type { ConvectiveStormSample } from "../../climate/types/convectiveStormTypes.js";

export type IgnitionSourceId = string;

export type IgnitionFailureReason =
  | "source-unavailable"
  | "no-candidate"
  | "already-burning"
  | "no-fuel"
  | "non-ignitable"
  | "suppression-blocked"
  | "chance";

export interface IgnitionSourceClock {
  nextOpportunityDay: number;
  serial: number;
}

export interface IgnitionScheduleState {
  seed: number;
  rateScale: number;
  clocks: Record<string, IgnitionSourceClock>;
}

export interface IgnitionContext {
  state: WorldState;
  day: number;
  weather: FireWeatherResponse;
  storm: ConvectiveStormSample | null;
}

export interface IgnitionCandidate {
  idx: number;
  x: number;
  y: number;
  weight: number;
}

export interface IgnitionOpportunity {
  sourceId: IgnitionSourceId;
  serial: number;
  eventDay: number;
  tileIndex: number | null;
  strength: number;
}

export interface IgnitionAttemptResult extends IgnitionOpportunity {
  probability: number;
  succeeded: boolean;
  failureReason: IgnitionFailureReason | null;
}

export interface IgnitionSourceTelemetry {
  opportunities: number;
  candidates: number;
  successes: number;
  failures: Partial<Record<IgnitionFailureReason, number>>;
}

export interface IgnitionTelemetrySnapshot {
  seed: number;
  rateScale: number;
  enabled: boolean;
  opportunities: number;
  candidates: number;
  successes: number;
  disabledSkipped: number;
  bySource: Record<string, IgnitionSourceTelemetry>;
  recentAttempts: IgnitionAttemptResult[];
}

export interface IgnitionSourceDefinition {
  readonly id: IgnitionSourceId;
  canGenerate(context: IgnitionContext): boolean;
  getNextOpportunityDay(state: WorldState, afterDay: number, serial: number, intervalRng: RNG): number;
  selectCandidate(context: IgnitionContext, candidateRng: RNG): IgnitionCandidate | null;
  sampleAttemptStrength(context: IgnitionContext, strengthRng: RNG): number;
}
