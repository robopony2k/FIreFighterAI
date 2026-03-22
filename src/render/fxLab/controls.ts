import {
  DEFAULT_FIRE_FX_DEBUG_CONTROLS,
  normalizeFireFxDebugControls,
  type FireFxDebugControls,
  type FireFxFallbackMode,
  type SparkMode
} from "../threeTestFireFx.js";
import {
  DEFAULT_WATER_FX_DEBUG_CONTROLS,
  normalizeWaterFxDebugControls,
  type WaterFxDebugControls
} from "../threeTestUnitFx.js";
import {
  DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS,
  normalizeTerrainWaterDebugControls,
  type TerrainWaterDebugControls
} from "../terrainWaterDebug.js";
import type { FxLabOverrides } from "./types.js";

type FxLabControlSection = "Fire" | "Hose" | "River" | "Waterfall";

type FxLabControlBase<K extends string> = {
  key: K;
  section: FxLabControlSection;
  label: string;
  description: string;
};

type FxLabRangeControl<K extends string> = FxLabControlBase<K> & {
  kind: "range";
  min: number;
  max: number;
  step: number;
};

type FxLabBooleanControl<K extends string> = FxLabControlBase<K> & {
  kind: "boolean";
};

type FxLabEnumControl<K extends string, V extends string> = FxLabControlBase<K> & {
  kind: "enum";
  options: ReadonlyArray<{ value: V; label: string }>;
};

export type FxLabFireControlDefinition =
  | FxLabRangeControl<keyof FireFxDebugControls & string>
  | FxLabBooleanControl<keyof FireFxDebugControls & string>
  | FxLabEnumControl<keyof FireFxDebugControls & string, FireFxFallbackMode | SparkMode>;

export type FxLabWaterControlDefinition =
  | FxLabRangeControl<keyof WaterFxDebugControls & string>
  | FxLabBooleanControl<keyof WaterFxDebugControls & string>
  | FxLabEnumControl<keyof WaterFxDebugControls & string, never>;

export type FxLabTerrainWaterControlDefinition =
  | FxLabRangeControl<keyof TerrainWaterDebugControls & string>
  | FxLabBooleanControl<keyof TerrainWaterDebugControls & string>
  | FxLabEnumControl<keyof TerrainWaterDebugControls & string, never>;

export const FX_LAB_FIRE_CONTROLS: ReadonlyArray<FxLabFireControlDefinition> = [
  {
    key: "wallBlend",
    section: "Fire",
    kind: "range",
    label: "Wall Blend",
    description: "Blend weight for wall-style fire ribbons.",
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: "heroVolumetricShare",
    section: "Fire",
    kind: "range",
    label: "Hero Volume",
    description: "Share of hero cross-slice fire rendering.",
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: "budgetScale",
    section: "Fire",
    kind: "range",
    label: "FX Budget",
    description: "Global fire FX density budget.",
    min: 0.4,
    max: 1.25,
    step: 0.01
  },
  {
    key: "fallbackMode",
    section: "Fire",
    kind: "enum",
    label: "Fallback",
    description: "Fallback strategy under load.",
    options: [
      { value: "aggressive", label: "Aggressive" },
      { value: "gentle", label: "Gentle" },
      { value: "off", label: "Off" }
    ]
  },
  {
    key: "sparkMode",
    section: "Fire",
    kind: "enum",
    label: "Spark Mode",
    description: "Tip streaks versus free embers.",
    options: [
      { value: "tip", label: "Tip" },
      { value: "mixed", label: "Mixed" },
      { value: "embers", label: "Embers" }
    ]
  },
  {
    key: "sparkDebug",
    section: "Fire",
    kind: "boolean",
    label: "Spark Debug",
    description: "Swap to debug spark presentation."
  },
  {
    key: "flameIntensityBoost",
    section: "Fire",
    kind: "range",
    label: "Flame Boost",
    description: "Scale flame height and width bias.",
    min: 0.5,
    max: 2,
    step: 0.01
  },
  {
    key: "groundGlowBoost",
    section: "Fire",
    kind: "range",
    label: "Glow Boost",
    description: "Scale ground glow size and count.",
    min: 0.5,
    max: 2,
    step: 0.01
  },
  {
    key: "emberBoost",
    section: "Fire",
    kind: "range",
    label: "Ember Boost",
    description: "Scale ember ejection and brightness.",
    min: 0.5,
    max: 2,
    step: 0.01
  },
  {
    key: "smokeDensityScale",
    section: "Fire",
    kind: "range",
    label: "Smoke Density",
    description: "Scale smoke spawn and render density.",
    min: 0.35,
    max: 2.5,
    step: 0.01
  }
];

export const FX_LAB_WATER_CONTROLS: ReadonlyArray<FxLabWaterControlDefinition> = [
  {
    key: "streamBodyWidthScale",
    section: "Hose",
    kind: "range",
    label: "Body Width",
    description: "Scale the primary shared stream body width.",
    min: 0.5,
    max: 2.5,
    step: 0.01
  },
  {
    key: "streamBodyOpacityScale",
    section: "Hose",
    kind: "range",
    label: "Body Opacity",
    description: "Scale the primary shared stream body opacity.",
    min: 0.25,
    max: 2.5,
    step: 0.01
  },
  {
    key: "showStreamBody",
    section: "Hose",
    kind: "boolean",
    label: "Show Body",
    description: "Toggle the primary stream body pass."
  },
  {
    key: "showJetCore",
    section: "Hose",
    kind: "boolean",
    label: "Show Core",
    description: "Toggle the smaller inner hose core."
  },
  {
    key: "showMistShell",
    section: "Hose",
    kind: "boolean",
    label: "Show Mist",
    description: "Toggle the secondary mist shell."
  },
  {
    key: "showBreakup",
    section: "Hose",
    kind: "boolean",
    label: "Show Breakup",
    description: "Toggle breakup particles near the target."
  },
  {
    key: "showImpact",
    section: "Hose",
    kind: "boolean",
    label: "Show Impact",
    description: "Toggle the terminal splash/impact pass."
  },
  {
    key: "coreRadiusScale",
    section: "Hose",
    kind: "range",
    label: "Core Radius",
    description: "Scale jet core radius.",
    min: 0.35,
    max: 2.5,
    step: 0.01
  },
  {
    key: "mistRadiusScale",
    section: "Hose",
    kind: "range",
    label: "Mist Radius",
    description: "Scale mist shell width.",
    min: 0.35,
    max: 2.5,
    step: 0.01
  },
  {
    key: "impactRadiusScale",
    section: "Hose",
    kind: "range",
    label: "Impact Radius",
    description: "Scale splash/impact size.",
    min: 0.35,
    max: 2.5,
    step: 0.01
  },
  {
    key: "breakupAlphaScale",
    section: "Hose",
    kind: "range",
    label: "Breakup Alpha",
    description: "Scale breakup particle opacity.",
    min: 0.2,
    max: 3,
    step: 0.01
  },
  {
    key: "breakupSizeScale",
    section: "Hose",
    kind: "range",
    label: "Breakup Size",
    description: "Scale breakup particle size.",
    min: 0.35,
    max: 2.5,
    step: 0.01
  },
  {
    key: "pulseRateScale",
    section: "Hose",
    kind: "range",
    label: "Pulse Rate",
    description: "Scale breakup pulse frequency.",
    min: 0.25,
    max: 3,
    step: 0.01
  },
  {
    key: "precisionVolumeScale",
    section: "Hose",
    kind: "range",
    label: "Precision Volume",
    description: "Scale precision-mode stream volume.",
    min: 0.25,
    max: 2,
    step: 0.01
  },
  {
    key: "balancedVolumeScale",
    section: "Hose",
    kind: "range",
    label: "Balanced Volume",
    description: "Scale balanced-mode stream volume.",
    min: 0.25,
    max: 2,
    step: 0.01
  },
  {
    key: "suppressionVolumeScale",
    section: "Hose",
    kind: "range",
    label: "Suppression Volume",
    description: "Scale suppression-mode stream volume.",
    min: 0.25,
    max: 2,
    step: 0.01
  },
  {
    key: "precisionResponseScale",
    section: "Hose",
    kind: "range",
    label: "Precision Response",
    description: "Scale precision-mode render response.",
    min: 0.25,
    max: 2,
    step: 0.01
  },
  {
    key: "balancedResponseScale",
    section: "Hose",
    kind: "range",
    label: "Balanced Response",
    description: "Scale balanced-mode render response.",
    min: 0.25,
    max: 2,
    step: 0.01
  },
  {
    key: "suppressionResponseScale",
    section: "Hose",
    kind: "range",
    label: "Suppression Response",
    description: "Scale suppression-mode render response.",
    min: 0.25,
    max: 2,
    step: 0.01
  }
];

export const FX_LAB_TERRAIN_WATER_CONTROLS: ReadonlyArray<FxLabTerrainWaterControlDefinition> = [
  {
    key: "showRiver",
    section: "River",
    kind: "boolean",
    label: "Show River",
    description: "Toggle the river surface mesh."
  },
  {
    key: "riverFlowSpeedScale",
    section: "River",
    kind: "range",
    label: "Flow Speed",
    description: "Scale river flow animation speed.",
    min: 0.25,
    max: 2.5,
    step: 0.01
  },
  {
    key: "riverNormalStrengthScale",
    section: "River",
    kind: "range",
    label: "Surface Normals",
    description: "Scale river normal-map strength.",
    min: 0.25,
    max: 2.5,
    step: 0.01
  },
  {
    key: "riverFoamScale",
    section: "River",
    kind: "range",
    label: "River Foam",
    description: "Scale rapid and edge foam intensity.",
    min: 0,
    max: 2.5,
    step: 0.01
  },
  {
    key: "riverSpecularScale",
    section: "River",
    kind: "range",
    label: "River Specular",
    description: "Scale river highlight intensity.",
    min: 0,
    max: 2.5,
    step: 0.01
  },
  {
    key: "showWaterfalls",
    section: "Waterfall",
    kind: "boolean",
    label: "Show Falls",
    description: "Toggle the waterfall mesh."
  },
  {
    key: "waterfallWidthScale",
    section: "Waterfall",
    kind: "range",
    label: "Fall Width",
    description: "Scale waterfall sheet width.",
    min: 0.5,
    max: 2,
    step: 0.01
  },
  {
    key: "waterfallOpacityScale",
    section: "Waterfall",
    kind: "range",
    label: "Fall Opacity",
    description: "Scale waterfall body opacity.",
    min: 0.2,
    max: 2,
    step: 0.01
  },
  {
    key: "waterfallFoamScale",
    section: "Waterfall",
    kind: "range",
    label: "Fall Foam",
    description: "Scale waterfall lip and plunge foam.",
    min: 0,
    max: 2.5,
    step: 0.01
  },
  {
    key: "waterfallMistScale",
    section: "Waterfall",
    kind: "range",
    label: "Fall Mist",
    description: "Scale waterfall mist density.",
    min: 0,
    max: 2.5,
    step: 0.01
  },
  {
    key: "waterfallSpeedScale",
    section: "Waterfall",
    kind: "range",
    label: "Fall Speed",
    description: "Scale waterfall animation speed.",
    min: 0.25,
    max: 2.5,
    step: 0.01
  }
];

const hasOwnDiff = <T extends Record<string, string | number | boolean>>(
  current: T,
  defaults: T
): Partial<T> | undefined => {
  const diff: Partial<T> = {};
  (Object.keys(defaults) as Array<keyof T>).forEach((key) => {
    if (current[key] !== defaults[key]) {
      diff[key] = current[key];
    }
  });
  return Object.keys(diff).length > 0 ? diff : undefined;
};

export const buildFxLabOverrides = (
  fireControls: FireFxDebugControls,
  waterControls: WaterFxDebugControls,
  terrainWaterControls: TerrainWaterDebugControls
): FxLabOverrides => ({
  fire: hasOwnDiff(fireControls, DEFAULT_FIRE_FX_DEBUG_CONTROLS),
  water: hasOwnDiff(waterControls, DEFAULT_WATER_FX_DEBUG_CONTROLS),
  riverWater: hasOwnDiff(terrainWaterControls, DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS)
});

export const formatFxLabOverrides = (
  fireControls: FireFxDebugControls,
  waterControls: WaterFxDebugControls,
  terrainWaterControls: TerrainWaterDebugControls
): string => JSON.stringify(buildFxLabOverrides(fireControls, waterControls, terrainWaterControls), null, 2);

export const cloneDefaultFireFxDebugControls = (): FireFxDebugControls =>
  normalizeFireFxDebugControls(DEFAULT_FIRE_FX_DEBUG_CONTROLS);

export const cloneDefaultWaterFxDebugControls = (): WaterFxDebugControls =>
  normalizeWaterFxDebugControls(DEFAULT_WATER_FX_DEBUG_CONTROLS);

export const cloneDefaultTerrainWaterDebugControls = (): TerrainWaterDebugControls =>
  normalizeTerrainWaterDebugControls(DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS);
