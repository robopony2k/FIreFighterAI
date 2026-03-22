import {
  DEFAULT_MAP_GEN_SETTINGS,
  DEFAULT_ROAD_GEN_SETTINGS,
  type MapGenSettings
} from "../mapgen/settings.js";

export type NumericMapGenKey = {
  [K in keyof MapGenSettings]: MapGenSettings[K] extends number ? K : never;
}[keyof MapGenSettings];

export type MapGenValueFormat = "int" | "fixed2" | "percent";

export type MapGenSlider = {
  key: NumericMapGenKey;
  slug: string;
  label: string;
  tooltip: string;
  min: number;
  max: number;
  step: number;
  format?: MapGenValueFormat;
};

export type MapGenGroupId = "elevation" | "forest" | "water";

export type MapGenGroup = {
  id: MapGenGroupId;
  title: string;
  sliders: MapGenSlider[];
};

export const MAPGEN_GROUPS: readonly MapGenGroup[] = [
  {
    id: "elevation",
    title: "Elevation & Relief",
    sliders: [
      {
        key: "elevationScale",
        slug: "elevationScale",
        label: "Height intensity",
        tooltip: "Overall terrain height multiplier. Higher values make taller terrain (too high can clip peaks).",
        min: 0.6,
        max: 2.2,
        step: 0.05
      },
      {
        key: "elevationExponent",
        slug: "elevationExponent",
        label: "Height curve",
        tooltip: "Curve applied to elevation noise. Higher values flatten lowlands and sharpen peaks.",
        min: 0.6,
        max: 2.4,
        step: 0.05
      },
      {
        key: "mountainScale",
        slug: "mountainScale",
        label: "Mountain scale",
        tooltip: "Controls the size of mountain features. Higher values create broader ranges.",
        min: 0.6,
        max: 2.4,
        step: 0.05
      },
      {
        key: "ridgeStrength",
        slug: "ridgeStrength",
        label: "Ridge sharpness",
        tooltip: "Adds sharp ridges and crags. Higher values make terrain more rugged.",
        min: 0,
        max: 0.35,
        step: 0.01
      },
      {
        key: "valleyDepth",
        slug: "valleyDepth",
        label: "Valley depth",
        tooltip: "Depth of carved valleys and river channels. Higher values deepen low areas.",
        min: 0.4,
        max: 3,
        step: 0.05
      }
    ]
  },
  {
    id: "forest",
    title: "Forests & Meadows",
    sliders: [
      {
        key: "forestMacroScale",
        slug: "forestMacroScale",
        label: "Forest patch size",
        tooltip: "Size of large forest regions. Higher values create bigger patches.",
        min: 6,
        max: 60,
        step: 1,
        format: "int"
      },
      {
        key: "forestDetailScale",
        slug: "forestDetailScale",
        label: "Forest detail scale",
        tooltip: "Fine-grain forest variation within patches. Higher values increase detail size.",
        min: 2,
        max: 24,
        step: 1,
        format: "int"
      },
      {
        key: "forestThreshold",
        slug: "forestThreshold",
        label: "Forest density",
        tooltip: "Threshold for forest placement. Higher values mean fewer forests.",
        min: 0.35,
        max: 0.9,
        step: 0.01
      },
      {
        key: "highlandForestElevation",
        slug: "highlandForestElevation",
        label: "Highland forest elevation",
        tooltip: "Upper elevation cutoff for forests. Higher values allow forests at higher altitudes.",
        min: 0.5,
        max: 0.95,
        step: 0.01
      },
      {
        key: "meadowScale",
        slug: "meadowScale",
        label: "Meadow scale",
        tooltip: "Size of meadow features. Higher values create larger meadows.",
        min: 6,
        max: 64,
        step: 1,
        format: "int"
      },
      {
        key: "meadowThreshold",
        slug: "meadowThreshold",
        label: "Meadow threshold",
        tooltip: "Threshold for meadow placement. Higher values mean fewer meadows.",
        min: 0.3,
        max: 0.9,
        step: 0.01
      },
      {
        key: "meadowStrength",
        slug: "meadowStrength",
        label: "Meadow strength",
        tooltip: "How strongly meadows reduce grass/forest canopy. Higher values make meadows more open.",
        min: 0,
        max: 1,
        step: 0.01
      },
      {
        key: "grassCanopyBase",
        slug: "grassCanopyBase",
        label: "Grass canopy base",
        tooltip: "Baseline grass canopy coverage. Higher values make grass thicker everywhere.",
        min: 0,
        max: 0.35,
        step: 0.01
      },
      {
        key: "grassCanopyRange",
        slug: "grassCanopyRange",
        label: "Grass canopy range",
        tooltip: "Variation range for grass canopy. Higher values increase patchiness.",
        min: 0,
        max: 0.6,
        step: 0.01
      }
    ]
  },
  {
    id: "water",
    title: "Water & Rivers",
    sliders: [
      {
        key: "waterCoverage",
        slug: "waterCoverage",
        label: "Water coverage",
        tooltip: "Target share of water tiles. Sea level is raised until this percentage is reached.",
        min: 0.1,
        max: 0.75,
        step: 0.01,
        format: "percent"
      },
      {
        key: "edgeWaterBias",
        slug: "edgeWaterBias",
        label: "Coast water bias",
        tooltip: "How strongly water is favored near edges when setting sea level. Higher values enlarge coastlines.",
        min: 0,
        max: 0.4,
        step: 0.01
      },
      {
        key: "riverCount",
        slug: "riverCount",
        label: "River count (0 = auto)",
        tooltip: "Number of rivers to carve. Set to 0 to keep automatic river counts by map size.",
        min: 0,
        max: 12,
        step: 1,
        format: "int"
      },
      {
        key: "riverWaterBias",
        slug: "riverWaterBias",
        label: "River carve strength",
        tooltip: "Controls river channel width/depth and lake size. Higher values make rivers wider and lakes larger.",
        min: 0,
        max: 0.6,
        step: 0.01
      }
    ]
  }
];

export const formatMapGenValue = (value: number, format?: MapGenValueFormat): string => {
  if (format === "int") {
    return Math.round(value).toString();
  }
  if (format === "percent") {
    return `${Math.round(value * 100)}%`;
  }
  return value.toFixed(2);
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const cloneEditableMapGenSettings = (settings?: Partial<MapGenSettings>): MapGenSettings => {
  const next: MapGenSettings = {
    ...DEFAULT_MAP_GEN_SETTINGS,
    road: { ...DEFAULT_ROAD_GEN_SETTINGS }
  };
  if (!settings) {
    return next;
  }
  for (const group of MAPGEN_GROUPS) {
    for (const slider of group.sliders) {
      const candidate = settings[slider.key];
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        next[slider.key] = candidate;
      }
    }
  }
  return next;
};

export const sanitizeEditableMapGenSettings = (value: unknown): MapGenSettings => {
  if (!isRecord(value)) {
    return cloneEditableMapGenSettings();
  }
  const next: Partial<MapGenSettings> = {};
  for (const group of MAPGEN_GROUPS) {
    for (const slider of group.sliders) {
      const parsed = toFiniteNumber(value[slider.key]);
      if (parsed !== null) {
        next[slider.key] = parsed;
      }
    }
  }
  return cloneEditableMapGenSettings(next);
};

export const mapGenSettingsEqual = (a: MapGenSettings, b: MapGenSettings): boolean => {
  for (const group of MAPGEN_GROUPS) {
    for (const slider of group.sliders) {
      if (Math.abs(a[slider.key] - b[slider.key]) > 1e-6) {
        return false;
      }
    }
  }
  return true;
};

