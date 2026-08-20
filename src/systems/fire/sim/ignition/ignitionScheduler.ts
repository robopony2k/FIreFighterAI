import type { WorldState } from "../../../../core/state.js";
import { sampleConvectiveStorm } from "../../../climate/sim/convectiveStorms.js";
import type {
  IgnitionAttemptResult,
  IgnitionContext,
  IgnitionScheduleState,
  IgnitionSourceDefinition,
  IgnitionSourceId,
  IgnitionSourceTelemetry,
  IgnitionTelemetrySnapshot
} from "../../types/ignitionTypes.js";
import { sampleFireWeatherResponse } from "../fireWeather.js";
import { createIgnitionRng } from "./deterministicIgnitionRng.js";
import { calculateIgnitionSuccessProbability, commitExternalIgnition } from "./externalIgnition.js";
import { IGNITION_SOURCE_REGISTRY } from "./ignitionSourceRegistry.js";

const MAX_OPPORTUNITIES_PER_STEP = 128;
const MAX_RECENT_ATTEMPTS = 64;
const latestResults = new WeakMap<WorldState, IgnitionAttemptResult[]>();
const telemetryByState = new WeakMap<WorldState, IgnitionTelemetrySnapshot>();
const loggedDisabledYears = new WeakMap<WorldState, Set<number>>();
const loggedRunSignature = new WeakMap<WorldState, string>();
const sourceIds = IGNITION_SOURCE_REGISTRY.map((source) => source.id);

const sourceById = new Map<IgnitionSourceId, IgnitionSourceDefinition>(
  IGNITION_SOURCE_REGISTRY.map((source) => [source.id, source])
);

const scheduleNext = (state: WorldState, source: IgnitionSourceDefinition, afterDay: number, serial: number): number =>
  source.getNextOpportunityDay(state, afterDay, serial, createIgnitionRng(state.seed, source.id, serial, "interval"));

export const resetIgnitionSchedule = (state: WorldState, fromDay = state.careerDay): IgnitionScheduleState => {
  const clocks = Object.fromEntries(sourceIds.map((sourceId) => {
    const source = sourceById.get(sourceId);
    if (!source) throw new Error(`Missing ignition source definition: ${sourceId}`);
    return [sourceId, { serial: 0, nextOpportunityDay: scheduleNext(state, source, fromDay, 0) }];
  })) as IgnitionScheduleState["clocks"];
  state.ignitionSchedule = {
    seed: state.seed,
    rateScale: state.fireSettings.ignitionOpportunityRateScale,
    clocks
  };
  latestResults.set(state, []);
  telemetryByState.set(state, {
    seed: state.seed,
    rateScale: state.fireSettings.ignitionOpportunityRateScale,
    enabled: true,
    opportunities: 0,
    candidates: 0,
    successes: 0,
    disabledSkipped: 0,
    bySource: {},
    recentAttempts: []
  });
  loggedDisabledYears.set(state, new Set());
  return state.ignitionSchedule;
};

const ensureSchedule = (state: WorldState): IgnitionScheduleState => {
  const schedule = state.ignitionSchedule;
  if (
    !schedule ||
    schedule.seed !== state.seed ||
    schedule.rateScale !== state.fireSettings.ignitionOpportunityRateScale
  ) {
    return resetIgnitionSchedule(state);
  }
  return schedule;
};

export const getNextIgnitionOpportunityDay = (state: WorldState): number => {
  const schedule = ensureSchedule(state);
  return Math.min(...sourceIds.map((sourceId) => schedule.clocks[sourceId].nextOpportunityDay));
};

const makeUnavailableResult = (
  sourceId: IgnitionSourceId,
  serial: number,
  eventDay: number,
  failureReason: IgnitionAttemptResult["failureReason"]
): IgnitionAttemptResult => ({
  sourceId,
  serial,
  eventDay,
  tileIndex: null,
  strength: 0,
  probability: 0,
  succeeded: false,
  failureReason
});

const isBrowserRuntime = (): boolean => typeof window !== "undefined";

const recordAttemptTelemetry = (state: WorldState, result: IgnitionAttemptResult): void => {
  const telemetry = telemetryByState.get(state);
  if (!telemetry) return;
  const source: IgnitionSourceTelemetry = telemetry.bySource[result.sourceId] ?? {
    opportunities: 0,
    candidates: 0,
    successes: 0,
    failures: {}
  };
  source.opportunities += 1;
  telemetry.opportunities += 1;
  if (result.tileIndex !== null) {
    source.candidates += 1;
    telemetry.candidates += 1;
  }
  if (result.succeeded) {
    source.successes += 1;
    telemetry.successes += 1;
  } else if (result.failureReason) {
    source.failures[result.failureReason] = (source.failures[result.failureReason] ?? 0) + 1;
  }
  telemetry.bySource[result.sourceId] = source;
  telemetry.recentAttempts.push(result);
  if (telemetry.recentAttempts.length > MAX_RECENT_ATTEMPTS) telemetry.recentAttempts.shift();
  if (!isBrowserRuntime()) return;
  const detail =
    `[ignition] source=${result.sourceId} serial=${result.serial} day=${result.eventDay.toFixed(3)} ` +
    `tile=${result.tileIndex ?? "none"} strength=${result.strength.toFixed(3)} probability=${result.probability.toFixed(3)} ` +
    `outcome=${result.succeeded ? "success" : result.failureReason}`;
  if (result.succeeded) console.info(detail);
  else console.debug(detail);
};

export const stepIgnitionSources = (
  state: WorldState,
  throughDay: number,
  enabled: boolean
): { successfulIgnitions: number; results: IgnitionAttemptResult[] } => {
  const schedule = ensureSchedule(state);
  const telemetry = telemetryByState.get(state)!;
  telemetry.enabled = enabled;
  if (isBrowserRuntime()) {
    const signature = `${state.seed}:${state.fireSettings.ignitionOpportunityRateScale}:${enabled ? 1 : 0}`;
    if (loggedRunSignature.get(state) !== signature) {
      loggedRunSignature.set(state, signature);
      const message =
        `[ignition] scheduler seed=${state.seed} enabled=${enabled ? 1 : 0} ` +
        `rateScale=${state.fireSettings.ignitionOpportunityRateScale.toFixed(3)} ` +
        `nextDay=${getNextIgnitionOpportunityDay(state).toFixed(3)}`;
      if (enabled && state.fireSettings.ignitionOpportunityRateScale <= 0) {
        console.warn(`${message}; no campaign ignition opportunities can be scheduled.`);
      } else {
        console.info(message);
      }
    }
  }
  const results: IgnitionAttemptResult[] = [];
  let successfulIgnitions = 0;
  for (let processed = 0; processed < MAX_OPPORTUNITIES_PER_STEP; processed += 1) {
    const dueSourceId = [...sourceIds]
      .sort((a, b) => {
        const dayDifference = schedule.clocks[a].nextOpportunityDay - schedule.clocks[b].nextOpportunityDay;
        return dayDifference || a.localeCompare(b);
      })
      .find((sourceId) => schedule.clocks[sourceId].nextOpportunityDay <= throughDay);
    if (!dueSourceId) break;
    const source = sourceById.get(dueSourceId)!;
    const clock = schedule.clocks[dueSourceId];
    const eventDay = clock.nextOpportunityDay;
    const serial = clock.serial;
    if (enabled) {
      const weather = sampleFireWeatherResponse(state, eventDay);
      const context: IgnitionContext = {
        state,
        day: eventDay,
        weather,
        storm: sampleConvectiveStorm(state, eventDay)
      };
      if (!source.canGenerate(context)) {
        results.push(makeUnavailableResult(dueSourceId, serial, eventDay, "source-unavailable"));
      } else {
        const candidate = source.selectCandidate(context, createIgnitionRng(state.seed, dueSourceId, serial, "candidate"));
        if (!candidate) {
          results.push(makeUnavailableResult(dueSourceId, serial, eventDay, "no-candidate"));
        } else {
          const strength = source.sampleAttemptStrength(
            context,
            createIgnitionRng(state.seed, dueSourceId, serial, "strength")
          );
          const resolution = calculateIgnitionSuccessProbability(state, candidate.idx, strength, weather);
          const succeeded = resolution.failureReason === null &&
            createIgnitionRng(state.seed, dueSourceId, serial, "success").next() < resolution.probability;
          if (succeeded) {
            commitExternalIgnition(state, candidate.idx, strength);
            successfulIgnitions += 1;
          }
          results.push({
            sourceId: dueSourceId,
            serial,
            eventDay,
            tileIndex: candidate.idx,
            strength,
            probability: resolution.probability,
            succeeded,
            failureReason: resolution.failureReason ?? (succeeded ? null : "chance")
          });
        }
      }
    } else {
      telemetry.disabledSkipped += 1;
      if (isBrowserRuntime()) {
        const year = Math.floor(eventDay / 360) + 1;
        const loggedYears = loggedDisabledYears.get(state)!;
        if (!loggedYears.has(year)) {
          loggedYears.add(year);
          console.warn(
            `[ignition] campaign opportunities are disabled; source clocks continue advancing ` +
            `(seed=${state.seed} year=${year} rateScale=${state.fireSettings.ignitionOpportunityRateScale.toFixed(3)}).`
          );
        }
      }
    }
    clock.serial += 1;
    clock.nextOpportunityDay = scheduleNext(state, source, eventDay, clock.serial);
  }
  results.forEach((result) => recordAttemptTelemetry(state, result));
  latestResults.set(state, results);
  return { successfulIgnitions, results };
};

export const getLatestIgnitionAttemptResults = (state: WorldState): readonly IgnitionAttemptResult[] =>
  latestResults.get(state) ?? [];

export const getIgnitionTelemetrySnapshot = (state: WorldState): IgnitionTelemetrySnapshot => {
  ensureSchedule(state);
  const telemetry = telemetryByState.get(state)!;
  return {
    ...telemetry,
    bySource: Object.fromEntries(Object.entries(telemetry.bySource).map(([sourceId, source]) => [sourceId, {
      ...source,
      failures: { ...source.failures }
    }])),
    recentAttempts: telemetry.recentAttempts.map((attempt) => ({ ...attempt }))
  };
};

export const formatIgnitionTelemetrySummary = (state: WorldState): string => {
  const telemetry = getIgnitionTelemetrySnapshot(state);
  const sources = Object.entries(telemetry.bySource)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sourceId, source]) => {
      const failures = Object.entries(source.failures)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([reason, count]) => `${reason}:${count}`)
        .join(",");
      return `${sourceId}=opp:${source.opportunities}/candidate:${source.candidates}/success:${source.successes}/fail:${failures || "none"}`;
    })
    .join(" ");
  return `[ignition-summary] seed=${telemetry.seed} enabled=${telemetry.enabled ? 1 : 0} ` +
    `rateScale=${telemetry.rateScale.toFixed(3)} opportunities=${telemetry.opportunities} ` +
    `candidates=${telemetry.candidates} successes=${telemetry.successes} disabledSkipped=${telemetry.disabledSkipped} ` +
    `${sources || "sources=none"}`;
};
