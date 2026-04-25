import type { RNG } from "../../core/types.js";

export type IgnitionSource = "spread" | "random";

const IGNITION_FIRE_SEED_RANGES: Record<IgnitionSource, { min: number; max: number }> = {
  spread: { min: 0.08, max: 0.18 },
  random: { min: 0.1, max: 0.2 }
};

const IGNITION_HEAT_MULTIPLIER_RANGE = { min: 1.0, max: 1.05 } as const;

export const sampleIgnitionFireSeed = (rng: RNG, source: IgnitionSource): number => {
  const range = IGNITION_FIRE_SEED_RANGES[source];
  return range.min + rng.next() * (range.max - range.min);
};

export const sampleIgnitionHeatMultiplier = (rng: RNG): number =>
  IGNITION_HEAT_MULTIPLIER_RANGE.min +
  rng.next() * (IGNITION_HEAT_MULTIPLIER_RANGE.max - IGNITION_HEAT_MULTIPLIER_RANGE.min);
