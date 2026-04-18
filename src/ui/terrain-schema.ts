import type {
  TerrainAdvancedOverrides,
  TerrainArchetypeId,
  TerrainRecipe
} from "../mapgen/terrainProfile.js";
import { cloneTerrainRecipe, createDefaultTerrainRecipe } from "../mapgen/terrainProfile.js";

export type TerrainControlFormat = "percent" | "int";

export type TerrainSliderKey =
  | "relief"
  | "ruggedness"
  | "coastComplexity"
  | "waterLevel"
  | "riverIntensity"
  | "vegetationDensity"
  | "townDensity"
  | "bridgeAllowance";

export type TerrainSelectKey = "archetype";

export type TerrainAdvancedNumericKey = Exclude<keyof TerrainAdvancedOverrides, "skipCarving">;

export type TerrainToggleKey = Extract<keyof TerrainAdvancedOverrides, "skipCarving">;

export type TerrainControlField =
  | {
      type: "slider";
      scope: "recipe" | "advanced";
      key: TerrainSliderKey | TerrainAdvancedNumericKey;
      slug: string;
      label: string;
      tooltip: string;
      min: number;
      max: number;
      step: number;
      format?: TerrainControlFormat;
    }
  | {
      type: "select";
      scope: "recipe";
      key: TerrainSelectKey;
      slug: string;
      label: string;
      tooltip: string;
      options: Array<{ value: string; label: string }>;
    }
  | {
      type: "checkbox";
      scope: "advanced";
      key: TerrainToggleKey;
      slug: string;
      label: string;
      tooltip: string;
    };

export type TerrainControlGroup = {
  id: string;
  title: string;
  fields: readonly TerrainControlField[];
  advanced?: boolean;
};

const selectField = (
  key: TerrainSelectKey,
  slug: string,
  label: string,
  tooltip: string,
  options: Array<{ value: string; label: string }>
): TerrainControlField => ({
  type: "select",
  scope: "recipe",
  key,
  slug,
  label,
  tooltip,
  options
});

const sliderField = (
  scope: "recipe" | "advanced",
  key: TerrainSliderKey | TerrainAdvancedNumericKey,
  slug: string,
  label: string,
  tooltip: string,
  options: Partial<Pick<Extract<TerrainControlField, { type: "slider" }>, "min" | "max" | "step" | "format">> = {}
): TerrainControlField => ({
  type: "slider",
  scope,
  key,
  slug,
  label,
  tooltip,
  min: options.min ?? 0,
  max: options.max ?? 1,
  step: options.step ?? 0.01,
  format: options.format ?? "percent"
});

const checkboxField = (
  key: TerrainToggleKey,
  slug: string,
  label: string,
  tooltip: string
): TerrainControlField => ({
  type: "checkbox",
  scope: "advanced",
  key,
  slug,
  label,
  tooltip
});

export const TERRAIN_ARCHETYPE_OPTIONS: Array<{ value: TerrainArchetypeId; label: string }> = [
  { value: "MASSIF", label: "Massif" },
  { value: "LONG_SPINE", label: "Long Spine" },
  { value: "TWIN_BAY", label: "Twin Bay" },
  { value: "SHELF", label: "Shelf" }
];

export const TERRAIN_RUN_GROUPS: readonly TerrainControlGroup[] = [
  {
    id: "terrain-shape",
    title: "Island Shape",
    fields: [
      selectField("archetype", "archetype", "Archetype", "Primary island layout and relief style.", TERRAIN_ARCHETYPE_OPTIONS),
      sliderField("recipe", "relief", "relief", "Relief", "How much the terrain rises and falls across the island."),
      sliderField(
        "advanced",
        "maxHeight",
        "maxHeight",
        "Max height",
        "How high the tallest mountains are allowed to climb before peak compression kicks in."
      ),
      sliderField("recipe", "ruggedness", "ruggedness", "Ruggedness", "How broken, ridged, and difficult the terrain becomes.")
    ]
  },
  {
    id: "terrain-shape-advanced",
    title: "Shape Overrides",
    advanced: true,
    fields: [
      sliderField("advanced", "embayment", "embayment", "Embayment", "How strongly the coastline opens into coves, bays, and inlets."),
      sliderField("advanced", "anisotropy", "anisotropy", "Anisotropy", "How strongly the island is stretched into a directional landform."),
      sliderField("advanced", "asymmetry", "asymmetry", "Asymmetry", "How much the island mass shifts away from a balanced center."),
      sliderField(
        "advanced",
        "ridgeAlignment",
        "ridgeAlignment",
        "Ridge alignment",
        "How strongly uplands align into coherent ridge corridors instead of scattered lumps."
      ),
      sliderField(
        "advanced",
        "uplandDistribution",
        "uplandDistribution",
        "Upland distribution",
        "Whether high ground concentrates into one core or spreads across multiple upland shoulders."
      )
    ]
  },
  {
    id: "terrain-water",
    title: "Coast + Water",
    fields: [
      sliderField("recipe", "coastComplexity", "coastComplexity", "Coast complexity", "How irregular and cut-up the shoreline becomes."),
      sliderField("recipe", "waterLevel", "waterLevel", "Water level", "How much of the relief ends up flooded into ocean and straits."),
      sliderField("recipe", "riverIntensity", "riverIntensity", "River intensity", "River presence, carve strength, and drainage emphasis."),
      checkboxField("skipCarving", "skipCarving", "Skip terrain carving", "Bypass the coarse pre-river carving pass and keep the relief stage untouched.")
    ]
  },
  {
    id: "terrain-play",
    title: "Towns + Vegetation",
    fields: [
      sliderField("recipe", "vegetationDensity", "vegetationDensity", "Vegetation density", "How green, forested, and fuel-rich the island becomes."),
      sliderField("recipe", "townDensity", "townDensity", "Town density", "How many settlements are requested for the scenario."),
      sliderField("recipe", "bridgeAllowance", "bridgeAllowance", "Bridge allowance", "How aggressively roads are allowed to bridge water gaps.")
    ]
  }
];

export const MAP_EDITOR_TERRAIN_GROUPS = {
  scenario: [
    {
      id: "scenario-shape",
      title: "World Plan",
      fields: [
        selectField("archetype", "archetype", "Archetype", "Primary island layout and relief style.", TERRAIN_ARCHETYPE_OPTIONS)
      ]
    },
    {
      id: "scenario-shape-advanced",
      title: "Shape Overrides",
      advanced: true,
      fields: [
        sliderField("advanced", "embayment", "embayment", "Embayment", "How strongly the coastline opens into coves, bays, and inlets."),
        sliderField("advanced", "anisotropy", "anisotropy", "Anisotropy", "How strongly the island is stretched into a directional landform."),
        sliderField("advanced", "asymmetry", "asymmetry", "Asymmetry", "How much the island mass shifts away from a balanced center."),
        sliderField(
          "advanced",
          "ridgeAlignment",
          "ridgeAlignment",
          "Ridge alignment",
          "How strongly uplands align into coherent ridge corridors instead of scattered lumps."
        ),
        sliderField(
          "advanced",
          "uplandDistribution",
          "uplandDistribution",
          "Upland distribution",
          "Whether high ground concentrates into one core or spreads across multiple upland shoulders."
        )
      ]
    }
  ],
  relief: [
    {
      id: "relief-simple",
      title: "Relief",
      fields: [
        sliderField("recipe", "relief", "relief", "Relief", "How much the terrain rises and falls across the island."),
        sliderField(
          "advanced",
          "maxHeight",
          "maxHeight",
          "Max height",
          "How high the tallest mountains are allowed to climb before peak compression kicks in."
        )
      ]
    },
    {
      id: "relief-advanced",
      title: "Relief Overrides",
      advanced: true,
      fields: [
        sliderField("advanced", "interiorRise", "interiorRise", "Interior rise", "How strongly the island rises toward its interior."),
        sliderField(
          "advanced",
          "islandCompactness",
          "islandCompactness",
          "Island compactness",
          "Whether the landmass stays cohesive or breaks into separated lobes."
        ),
        sliderField("advanced", "ridgeFrequency", "ridgeFrequency", "Ridge frequency", "How frequently major ridges repeat across the map.")
      ]
    }
  ],
  carving: [
    {
      id: "carving-simple",
      title: "Carving",
      fields: [
        sliderField("recipe", "ruggedness", "ruggedness", "Ruggedness", "How broken, ridged, and difficult the terrain becomes."),
        checkboxField("skipCarving", "skipCarving", "Skip terrain carving", "Bypass the coarse pre-river carving pass and keep the relief stage untouched.")
      ]
    },
    {
      id: "carving-advanced",
      title: "Carving Overrides",
      advanced: true,
      fields: [
        sliderField("advanced", "basinStrength", "basinStrength", "Basin strength", "How much lowland carving and interior basins are emphasized.")
      ]
    }
  ],
  erosion: [
    {
      id: "erosion-simple",
      title: "Erosion Drivers",
      fields: [
        sliderField("recipe", "relief", "relief", "Relief", "How much the terrain rises and falls across the island."),
        sliderField("recipe", "ruggedness", "ruggedness", "Ruggedness", "How broken, ridged, and difficult the terrain becomes."),
        sliderField("recipe", "riverIntensity", "riverIntensity", "River intensity", "River presence, carve strength, and drainage emphasis."),
        sliderField("recipe", "waterLevel", "waterLevel", "Water level", "How much of the relief ends up flooded into ocean and straits.")
      ]
    }
  ],
  flooding: [
    {
      id: "flooding-simple",
      title: "Flooding",
      fields: [
        sliderField("recipe", "coastComplexity", "coastComplexity", "Coast complexity", "How irregular and cut-up the shoreline becomes."),
        sliderField("recipe", "waterLevel", "waterLevel", "Water level", "How much of the relief ends up flooded into ocean and straits.")
      ]
    },
    {
      id: "flooding-advanced",
      title: "Flooding Overrides",
      advanced: true,
      fields: [
        sliderField(
          "advanced",
          "coastalShelfWidth",
          "coastalShelfWidth",
          "Coastal shelf width",
          "How wide the coastal shallows and shelves stay before deeper water."
        )
      ]
    }
  ],
  rivers: [
    {
      id: "river-simple",
      title: "Rivers",
      fields: [
        sliderField("recipe", "riverIntensity", "riverIntensity", "River intensity", "River presence, carve strength, and drainage emphasis.")
      ]
    },
    {
      id: "river-advanced",
      title: "River Overrides",
      advanced: true,
      fields: [
        sliderField("advanced", "riverBudget", "riverBudget", "River budget", "How many meaningful river systems the map attempts to sustain.")
      ]
    }
  ],
  settlements: [
    {
      id: "settlements-simple",
      title: "Settlements",
      fields: [
        sliderField("recipe", "townDensity", "townDensity", "Town density", "How many settlements are requested for the scenario."),
        sliderField("recipe", "bridgeAllowance", "bridgeAllowance", "Bridge allowance", "How aggressively roads are allowed to bridge water gaps.")
      ]
    },
    {
      id: "settlements-advanced",
      title: "Town + Road Overrides",
      advanced: true,
      fields: [
        sliderField(
          "advanced",
          "settlementSpacing",
          "settlementSpacing",
          "Settlement spacing",
          "How much space the planner tries to preserve between towns."
        ),
        sliderField(
          "advanced",
          "settlementPreGrowthYears",
          "settlementPreGrowthYears",
          "Pre-growth years",
          "How many yearly settlement-growth steps map generation simulates before the campaign begins.",
          { min: 0, max: 40, step: 1, format: "int" }
        ),
        sliderField("advanced", "roadStrictness", "roadStrictness", "Road strictness", "How slope-limited and conservative road routing remains.")
      ]
    }
  ],
  vegetation: [
    {
      id: "vegetation-simple",
      title: "Vegetation",
      fields: [
        sliderField("recipe", "vegetationDensity", "vegetationDensity", "Vegetation density", "How green, forested, and fuel-rich the island becomes.")
      ]
    },
    {
      id: "vegetation-advanced",
      title: "Vegetation Overrides",
      advanced: true,
      fields: [
        sliderField(
          "advanced",
          "forestPatchiness",
          "forestPatchiness",
          "Forest patchiness",
          "How broken up the forest canopy is instead of forming broad continuous blocks."
        )
      ]
    }
  ]
} as const;

export const formatTerrainControlValue = (value: number, format?: TerrainControlFormat): string => {
  if (format === "int") {
    return `${Math.round(value)}`;
  }
  if (format === "percent") {
    return `${Math.round(value * 100)}%`;
  }
  return value.toFixed(2);
};

export const createRecipeForMapSize = (mapSize: TerrainRecipe["mapSize"]): TerrainRecipe =>
  createDefaultTerrainRecipe(mapSize);

export type TerrainControlInput = HTMLInputElement | HTMLSelectElement;

export type TerrainControlElements = {
  inputs: TerrainControlInput[];
  outputs: Map<HTMLInputElement, HTMLElement>;
};

export const collectTerrainControlElements = (root: ParentNode): TerrainControlElements => {
  const inputs = Array.from(root.querySelectorAll<TerrainControlInput>("[data-terrain-scope][data-terrain-key]"));
  const outputs = new Map<HTMLInputElement, HTMLElement>();
  inputs.forEach((input) => {
    if (!(input instanceof HTMLInputElement)) {
      return;
    }
    const outputId = input.dataset.output;
    if (!outputId) {
      return;
    }
    const output = document.getElementById(outputId);
    if (output) {
      outputs.set(input, output);
    }
  });
  return { inputs, outputs };
};

export const syncTerrainControlOutputs = (elements: TerrainControlElements): void => {
  elements.outputs.forEach((output, input) => {
    const numericValue = Number(input.value);
    output.textContent = Number.isFinite(numericValue)
      ? formatTerrainControlValue(numericValue, input.dataset.format as TerrainControlFormat | undefined)
      : input.value;
  });
};

export const applyTerrainRecipeToControls = (
  recipeInput: TerrainRecipe,
  elements: TerrainControlElements
): void => {
  const recipe = cloneTerrainRecipe(recipeInput);
  const advanced = recipe.advancedOverrides ?? {};
  elements.inputs.forEach((input) => {
    const scope = input.dataset.terrainScope;
    const key = input.dataset.terrainKey;
    if (!scope || !key) {
      return;
    }
    let value: string | number | boolean | undefined;
    if (scope === "recipe") {
      value = recipe[key as keyof TerrainRecipe] as string | number | undefined;
    } else if (scope === "advanced") {
      value = advanced[key as keyof TerrainAdvancedOverrides];
    }
    if (value === undefined || value === null) {
      return;
    }
    if (input instanceof HTMLInputElement && input.type === "checkbox") {
      input.checked = Boolean(value);
      return;
    }
    input.value = typeof value === "number" ? `${value}` : `${value}`;
  });
  syncTerrainControlOutputs(elements);
};

export const readTerrainRecipeFromControls = (
  elements: TerrainControlElements,
  fallbackRecipe?: TerrainRecipe
): TerrainRecipe => {
  const recipe = cloneTerrainRecipe(fallbackRecipe ?? createDefaultTerrainRecipe());
  const advanced = { ...(recipe.advancedOverrides ?? {}) };
  elements.inputs.forEach((input) => {
    const scope = input.dataset.terrainScope;
    const key = input.dataset.terrainKey;
    if (!scope || !key) {
      return;
    }
    if (scope === "recipe" && key === "archetype") {
      (recipe as Record<string, unknown>)[key] = input.value;
      return;
    }
    if (input instanceof HTMLInputElement && input.type === "checkbox") {
      if (scope === "advanced") {
        (advanced as TerrainAdvancedOverrides)[key as TerrainToggleKey] = input.checked;
      }
      return;
    }
    const numericValue = Number(input.value);
    if (!Number.isFinite(numericValue)) {
      return;
    }
    if (scope === "recipe") {
      (recipe as Record<string, unknown>)[key] = numericValue;
    } else {
      (advanced as TerrainAdvancedOverrides)[key as TerrainAdvancedNumericKey] = numericValue;
    }
  });
  recipe.advancedOverrides = advanced;
  return cloneTerrainRecipe(recipe);
};
