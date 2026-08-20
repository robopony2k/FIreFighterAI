import { clamp } from "../../../../core/climate.js";
import { findNextConvectiveStorm } from "../../../climate/sim/convectiveStorms.js";
import type { IgnitionCandidate, IgnitionSourceDefinition } from "../../types/ignitionTypes.js";
import { isDynamicIgnitionCandidate } from "./ignitionEligibility.js";

const selectStrike = (context: Parameters<IgnitionSourceDefinition["selectCandidate"]>[0], rng: Parameters<IgnitionSourceDefinition["selectCandidate"]>[1]): IgnitionCandidate | null => {
  const { state, storm } = context;
  if (!storm) return null;
  const centerX = storm.centerX * (state.grid.cols - 1);
  const centerY = storm.centerY * (state.grid.rows - 1);
  const radiusX = Math.max(2, storm.radiusX * state.grid.cols);
  const radiusY = Math.max(2, storm.radiusY * state.grid.rows);
  const cos = Math.cos(storm.angle);
  const sin = Math.sin(storm.angle);
  for (let attempt = 0; attempt < 28; attempt += 1) {
    const radial = Math.sqrt(rng.next());
    const theta = rng.next() * Math.PI * 2;
    const localX = Math.cos(theta) * radial * radiusX;
    const localY = Math.sin(theta) * radial * radiusY;
    const x = Math.round(centerX + localX * cos - localY * sin);
    const y = Math.round(centerY + localX * sin + localY * cos);
    if (x < 0 || x >= state.grid.cols || y < 0 || y >= state.grid.rows) continue;
    const idx = y * state.grid.cols + x;
    if (!isDynamicIgnitionCandidate(state, idx)) continue;
    const lowFrequencyVariation = 0.8 + 0.4 * Math.sin((x * 0.071 + y * 0.047 + state.seed) * 1.7);
    if (rng.next() <= clamp((1 - radial * 0.65) * lowFrequencyVariation, 0.15, 1)) {
      return { idx, x, y, weight: (1 - radial) * storm.activeIntensity };
    }
  }
  return null;
};

const definition: IgnitionSourceDefinition = {
  id: "lightning",
  canGenerate: ({ storm, weather }) => Boolean(storm && storm.activeIntensity >= 0.18 && weather.climateTemp >= 23),
  getNextOpportunityDay: (state, afterDay, _serial, rng) => {
    if (state.fireSettings.ignitionOpportunityRateScale <= 0) return Number.POSITIVE_INFINITY;
    let cursor = afterDay + 0.0001;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const storm = findNextConvectiveStorm(state, cursor);
      if (!storm) return afterDay + 360;
      const withinStorm = Math.max(cursor, storm.startDay);
      const rate = (1.5 + storm.electricalIntensity * 2.5) * state.fireSettings.ignitionOpportunityRateScale;
      const proposed = withinStorm - Math.log(Math.max(1e-9, 1 - rng.next())) / rate;
      if (proposed <= storm.endDay) return proposed;
      cursor = storm.endDay + 0.0001;
    }
    return afterDay + 360;
  },
  selectCandidate: selectStrike,
  sampleAttemptStrength: ({ storm, weather }, rng) =>
    clamp(0.42 + (storm?.activeIntensity ?? 0) * 0.38 + weather.climateRisk * 0.12 + rng.next() * 0.16, 0, 1)
};

export const lightningIgnitionSource: IgnitionSourceDefinition = Object.freeze(definition);
