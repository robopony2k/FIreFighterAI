export type FuelScorchColorOptions = {
  baseFuel: number;
  localMoisture: number;
  fuelNow: number;
  liveFire: number;
  liveHeat: number;
  isForest: boolean;
  ashColor: readonly number[];
};

const SCORCH_WARM_TINT: [number, number, number] = [0.34, 0.25, 0.16];
const SCORCH_CHAR_TINT: [number, number, number] = [0.19, 0.18, 0.17];

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const mixTriplet = (a: readonly number[], b: readonly number[], t: number): [number, number, number] => {
  const clampedT = clamp(t, 0, 1);
  return [
    a[0] * (1 - clampedT) + b[0] * clampedT,
    a[1] * (1 - clampedT) + b[1] * clampedT,
    a[2] * (1 - clampedT) + b[2] * clampedT
  ];
};

export const applyFuelScorchColor = (
  color: readonly number[],
  options: FuelScorchColorOptions
): [number, number, number] => {
  if (options.baseFuel <= 0) {
    return [color[0], color[1], color[2]];
  }
  const expectedFuel = Math.max(0.01, options.baseFuel * (1 - options.localMoisture * 0.6));
  const fuelNow = clamp(options.fuelNow, 0, expectedFuel);
  const fuelDepletion = clamp(1 - fuelNow / expectedFuel, 0, 1);
  if (fuelDepletion <= 0.015 && options.liveFire <= 0.01 && options.liveHeat <= 0.03) {
    return [color[0], color[1], color[2]];
  }

  const activeEnergy = clamp(
    smoothstep(0.03, 0.18, options.liveFire) * 0.8 + smoothstep(0.08, 0.34, options.liveHeat) * 0.35,
    0,
    1
  );
  const earlyScorch = smoothstep(0.08, 0.55, fuelDepletion);
  const charScorch = smoothstep(0.36, 0.9, fuelDepletion);
  const ashScorch = smoothstep(0.2, 0.96, fuelDepletion);
  const warmMix = clamp(
    earlyScorch * (options.isForest ? 0.34 : 0.28) +
      activeEnergy * smoothstep(0.04, 0.42, fuelDepletion) * 0.12,
    0,
    0.48
  );
  const charMix = clamp(charScorch * (options.isForest ? 0.42 : 0.36), 0, 0.52);
  const ashMix = clamp(ashScorch * (options.isForest ? 0.68 : 0.6), 0, 0.74);

  return mixTriplet(
    mixTriplet(
      mixTriplet(color, SCORCH_WARM_TINT, warmMix),
      SCORCH_CHAR_TINT,
      charMix
    ),
    options.ashColor,
    ashMix
  );
};
