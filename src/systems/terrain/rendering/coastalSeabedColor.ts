import { COAST_CLASS_SHELF_WATER } from "../../../core/state.js";

export type TerrainColorTriplet = readonly number[];

export type CoastalSeabedColorInput = {
  coastClass: number;
  coastDistance: number;
  beachColor: TerrainColorTriplet;
  rockyColor: TerrainColorTriplet;
  waterColor: TerrainColorTriplet;
};

export const SUBMERGED_SHELF_DISTANCE_MAX = 6;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

const mixColor = (
  a: TerrainColorTriplet,
  b: TerrainColorTriplet,
  amount: number
): [number, number, number] => {
  const t = clamp01(amount);
  return [
    (a[0] ?? 0) * (1 - t) + (b[0] ?? 0) * t,
    (a[1] ?? 0) * (1 - t) + (b[1] ?? 0) * t,
    (a[2] ?? 0) * (1 - t) + (b[2] ?? 0) * t
  ];
};

export const resolveCoastalSeabedColor = ({
  coastClass,
  coastDistance,
  beachColor,
  rockyColor,
  waterColor
}: CoastalSeabedColorInput): [number, number, number] => {
  const deepSeabed = mixColor(rockyColor, waterColor, 0.68);
  if (coastClass !== COAST_CLASS_SHELF_WATER) {
    return deepSeabed;
  }

  const innerShelf = mixColor(mixColor(beachColor, waterColor, 0.32), rockyColor, 0.08);
  const outerShelf = mixColor(mixColor(beachColor, rockyColor, 0.36), waterColor, 0.5);
  const shelfT = clamp01((Math.max(1, coastDistance) - 1) / Math.max(1, SUBMERGED_SHELF_DISTANCE_MAX - 1));
  return mixColor(innerShelf, outerShelf, shelfT);
};
