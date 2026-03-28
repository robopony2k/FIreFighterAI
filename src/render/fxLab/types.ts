import type { FireFxDebugControls } from "../threeTestFireFx.js";
import type { OceanWaterDebugControls } from "../oceanWaterDebug.js";
import type { TerrainWaterDebugControls } from "../terrainWaterDebug.js";
import type { WaterFxDebugControls } from "../threeTestUnitFx.js";

export type FxLabScenarioId =
  | "fire-line"
  | "fire-patch"
  | "ocean-shoreline"
  | "river-waterfall"
  | "water-precision"
  | "water-suppression"
  | "water-sweep";

export type FxLabOverrides = {
  fire?: Partial<FireFxDebugControls>;
  water?: Partial<WaterFxDebugControls>;
  oceanWater?: Partial<OceanWaterDebugControls>;
  riverWater?: Partial<TerrainWaterDebugControls>;
};

export type FxLabPlacementMode = "none" | "firefighter" | "truck" | "spray-target";

export const FX_LAB_SCENARIO_IDS: readonly FxLabScenarioId[] = [
  "fire-line",
  "fire-patch",
  "ocean-shoreline",
  "river-waterfall",
  "water-precision",
  "water-suppression",
  "water-sweep"
];

export const normalizeFxLabScenarioId = (value: string | null | undefined): FxLabScenarioId => {
  const next = (value ?? "").toLowerCase();
  return FX_LAB_SCENARIO_IDS.find((entry) => entry === next) ?? "fire-line";
};
