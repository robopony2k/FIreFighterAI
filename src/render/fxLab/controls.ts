import {
  DEFAULT_FIRE_FX_DEBUG_CONTROLS,
  normalizeFireFxDebugControls,
  type FireFxDebugControls,
  type FireAnchorDebugMode,
  type FireFxFallbackMode
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
import {
  DEFAULT_OCEAN_WATER_DEBUG_CONTROLS,
  normalizeOceanWaterDebugControls,
  type OceanWaterDebugControls
} from "../oceanWaterDebug.js";
import type { FxLabOverrides } from "./types.js";

type FxLabControlSection = "Fire" | "Hose" | "Ocean" | "Shoreline" | "River" | "Waterfall";

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
  | FxLabEnumControl<keyof FireFxDebugControls & string, FireAnchorDebugMode | FireFxFallbackMode>;

export type FxLabWaterControlDefinition =
  | FxLabRangeControl<keyof WaterFxDebugControls & string>
  | FxLabBooleanControl<keyof WaterFxDebugControls & string>
  | FxLabEnumControl<keyof WaterFxDebugControls & string, never>;

export type FxLabTerrainWaterControlDefinition =
  | FxLabRangeControl<keyof TerrainWaterDebugControls & string>
  | FxLabBooleanControl<keyof TerrainWaterDebugControls & string>
  | FxLabEnumControl<keyof TerrainWaterDebugControls & string, never>;

export type FxLabOceanWaterControlDefinition =
  | FxLabRangeControl<keyof OceanWaterDebugControls & string>
  | FxLabBooleanControl<keyof OceanWaterDebugControls & string>
  | FxLabEnumControl<keyof OceanWaterDebugControls & string, never>;

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
    key: "anchorDebugMode",
    section: "Fire",
    kind: "enum",
    label: "Anchor Debug",
    description: "Tint anchors by source or log raw-fallback usage.",
    options: [
      { value: "off", label: "Off" },
      { value: "tint", label: "Tint" },
      { value: "logRawFallbacks", label: "Log Fallbacks" }
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
    description: "Toggle the waterfall wall material."
  },
  {
    key: "waterfallDebugHighlight",
    section: "Waterfall",
    kind: "boolean",
    label: "Highlight Falls",
    description: "Render waterfalls in high-contrast x-ray colors for validation."
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

export const FX_LAB_OCEAN_WATER_CONTROLS: ReadonlyArray<FxLabOceanWaterControlDefinition> = [
  {
    key: "showOcean",
    section: "Ocean",
    kind: "boolean",
    label: "Show Ocean",
    description: "Toggle the live ocean surface and its backdrop."
  },
  {
    key: "waveAmpScale",
    section: "Ocean",
    kind: "range",
    label: "Wave Amp",
    description: "Scale the ocean displacement amplitude without changing the underlying shoreline system.",
    min: 0,
    max: 2.5,
    step: 0.01
  },
  {
    key: "waveLengthScale",
    section: "Ocean",
    kind: "range",
    label: "Wave Length",
    description: "Scale ocean wavelength so you can tune how quickly crests read near shore.",
    min: 0.5,
    max: 2,
    step: 0.01
  },
  {
    key: "shoreFoamScale",
    section: "Ocean",
    kind: "range",
    label: "Shore Foam",
    description: "Scale shoreline foam intensity on the live ocean shader.",
    min: 0,
    max: 2.5,
    step: 0.01
  },
  {
    key: "enableOrganicEdge",
    section: "Shoreline",
    kind: "boolean",
    label: "Organic Edge",
    description: "Toggle the noisy shoreline inset used to break up the coast edge."
  },
  {
    key: "enableShorePulses",
    section: "Shoreline",
    kind: "boolean",
    label: "Shore Pulses",
    description: "Toggle the shore-facing pulse train that drives lapping and swash timing."
  },
  {
    key: "enableTroughClamp",
    section: "Shoreline",
    kind: "boolean",
    label: "Trough Clamp",
    description: "Prevent near-shore troughs from dropping too far below the beach."
  },
  {
    key: "enableSwashMotion",
    section: "Shoreline",
    kind: "boolean",
    label: "Swash Motion",
    description: "Toggle animated run-up so the visible shoreline advances and retreats with the waves."
  },
  {
    key: "enableSwashSheet",
    section: "Shoreline",
    kind: "boolean",
    label: "Swash Sheet",
    description: "Toggle the thin water-film coverage that hides dry beach patches between wave run-up and open water."
  },
  {
    key: "enableShoreWaveModulation",
    section: "Shoreline",
    kind: "boolean",
    label: "Wave Mod",
    description: "Moderate wave amplitude and wavelength as waves enter the shoreline band."
  },
  {
    key: "shoreSwashStart",
    section: "Shoreline",
    kind: "range",
    label: "Swash Start",
    description: "Distance where shoreline fade-in begins.",
    min: 0,
    max: 0.12,
    step: 0.001
  },
  {
    key: "shoreSwashEnd",
    section: "Shoreline",
    kind: "range",
    label: "Swash End",
    description: "Distance where the swash band becomes full-strength water.",
    min: 0.01,
    max: 0.45,
    step: 0.001
  },
  {
    key: "shoreShoalEnd",
    section: "Shoreline",
    kind: "range",
    label: "Shoal End",
    description: "Outer distance where shoreline-specific shaping blends fully back to open ocean.",
    min: 0.05,
    max: 0.8,
    step: 0.001
  },
  {
    key: "organicEdgeInset",
    section: "Shoreline",
    kind: "range",
    label: "Edge Inset",
    description: "Max inland retreat from the noisy shoreline inset.",
    min: 0,
    max: 0.22,
    step: 0.001
  },
  {
    key: "swashPushMax",
    section: "Shoreline",
    kind: "range",
    label: "Swash Reach",
    description: "Maximum extra inland run-up driven by the crest pulse.",
    min: 0,
    max: 0.28,
    step: 0.001
  },
  {
    key: "swashPushFeather",
    section: "Shoreline",
    kind: "range",
    label: "Swash Feather",
    description: "Feather width for the moving shoreline sheet.",
    min: 0.01,
    max: 0.2,
    step: 0.001
  },
  {
    key: "swashCoverageMin",
    section: "Shoreline",
    kind: "range",
    label: "Coverage Min",
    description: "Minimum shoreline coverage before the swash band starts to fade out.",
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: "swashCoverageFadeEnd",
    section: "Shoreline",
    kind: "range",
    label: "Coverage Fade",
    description: "Coverage level where the shoreline fade-out completes.",
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: "shoreWaveAmpMinScale",
    section: "Shoreline",
    kind: "range",
    label: "Shore Amp Min",
    description: "Minimum local amplitude scale at the shoreline before blending back to open-ocean waves.",
    min: 0.05,
    max: 1,
    step: 0.01
  },
  {
    key: "shoreWaveLengthMinScale",
    section: "Shoreline",
    kind: "range",
    label: "Shore Length Min",
    description: "Minimum local wavelength scale at the shoreline before blending back to open-ocean waves.",
    min: 0.2,
    max: 1,
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
  terrainWaterControls: TerrainWaterDebugControls,
  oceanWaterControls: OceanWaterDebugControls
): FxLabOverrides => ({
  fire: hasOwnDiff(fireControls, DEFAULT_FIRE_FX_DEBUG_CONTROLS),
  water: hasOwnDiff(waterControls, DEFAULT_WATER_FX_DEBUG_CONTROLS),
  oceanWater: hasOwnDiff(oceanWaterControls, DEFAULT_OCEAN_WATER_DEBUG_CONTROLS),
  riverWater: hasOwnDiff(terrainWaterControls, DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS)
});

export const formatFxLabOverrides = (
  fireControls: FireFxDebugControls,
  waterControls: WaterFxDebugControls,
  terrainWaterControls: TerrainWaterDebugControls,
  oceanWaterControls: OceanWaterDebugControls
): string => JSON.stringify(buildFxLabOverrides(fireControls, waterControls, terrainWaterControls, oceanWaterControls), null, 2);

export const cloneDefaultFireFxDebugControls = (): FireFxDebugControls =>
  normalizeFireFxDebugControls(DEFAULT_FIRE_FX_DEBUG_CONTROLS);

export const cloneDefaultWaterFxDebugControls = (): WaterFxDebugControls =>
  normalizeWaterFxDebugControls(DEFAULT_WATER_FX_DEBUG_CONTROLS);

export const cloneDefaultTerrainWaterDebugControls = (): TerrainWaterDebugControls =>
  normalizeTerrainWaterDebugControls(DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS);

export const cloneDefaultOceanWaterDebugControls = (): OceanWaterDebugControls =>
  normalizeOceanWaterDebugControls(DEFAULT_OCEAN_WATER_DEBUG_CONTROLS);
