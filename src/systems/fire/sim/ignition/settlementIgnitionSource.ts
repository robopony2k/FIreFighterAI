import type { IgnitionSourceDefinition } from "../../types/ignitionTypes.js";
import { selectSettlementCandidate } from "./ignitionCandidateCaches.js";

const BASE_RATE_PER_DAY = 0.026;

const definition: IgnitionSourceDefinition = {
  id: "settlement-activity",
  canGenerate: ({ state }) => state.towns.length > 0,
  getNextOpportunityDay: (state, afterDay, _serial, rng) => {
    const activity = Math.max(0.55, Math.min(2.1, Math.sqrt(Math.max(1, state.totalHouses || state.towns.length * 8) / 80)));
    const careerActivity = 1 + Math.min(1.2, Math.max(0, state.year - 1) * 0.08);
    const rate = BASE_RATE_PER_DAY * Math.max(0, state.fireSettings.ignitionOpportunityRateScale) * activity * careerActivity;
    return rate > 0 ? afterDay - Math.log(Math.max(1e-9, 1 - rng.next())) / rate : Number.POSITIVE_INFINITY;
  },
  selectCandidate: ({ state }, rng) => selectSettlementCandidate(state, rng),
  sampleAttemptStrength: ({ state, weather }, rng) =>
    0.38 + rng.next() * 0.34 + Math.max(0, weather.effectiveAmbient - 24) * 0.004 + Math.min(0.2, (state.year - 1) * 0.016)
};

export const settlementIgnitionSource: IgnitionSourceDefinition = Object.freeze(definition);
