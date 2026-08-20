import type { IgnitionSourceDefinition } from "../../types/ignitionTypes.js";
import { getRoadCandidateCount, selectRoadsideCandidate } from "./ignitionCandidateCaches.js";

const BASE_RATE_PER_DAY = 0.034;

const definition: IgnitionSourceDefinition = {
  id: "roadside-human",
  canGenerate: ({ state }) => getRoadCandidateCount(state) > 0,
  getNextOpportunityDay: (state, afterDay, _serial, rng) => {
    const exposure = Math.sqrt(Math.max(1, getRoadCandidateCount(state)) / 160);
    const careerActivity = 1 + Math.min(1, Math.max(0, state.year - 1) * 0.07);
    const rate = BASE_RATE_PER_DAY * Math.max(0, state.fireSettings.ignitionOpportunityRateScale) *
      Math.max(0.45, Math.min(2.2, exposure)) * careerActivity;
    return rate > 0 ? afterDay - Math.log(Math.max(1e-9, 1 - rng.next())) / rate : Number.POSITIVE_INFINITY;
  },
  selectCandidate: ({ state }, rng) => selectRoadsideCandidate(state, rng),
  sampleAttemptStrength: ({ state, weather }, rng) =>
    0.3 + rng.next() * 0.3 + Math.max(0, weather.effectiveAmbient - 25) * 0.004 + Math.min(0.22, (state.year - 1) * 0.018)
};

export const roadsideIgnitionSource: IgnitionSourceDefinition = Object.freeze(definition);
