import { DEFAULT_MAP_GEN_SETTINGS } from "../mapgen/settings.js";
import type { MapGenSettings } from "../mapgen/settings.js";

type MapGenSlider = {
  key: keyof MapGenSettings;
  label: string;
  tooltip: string;
  min: number;
  max: number;
  step: number;
  format?: "int" | "fixed2" | "percent";
  inputId: string;
  outputId: string;
};

type MapGenGroup = {
  title: string;
  sliders: MapGenSlider[];
};

const MAPGEN_GROUPS: MapGenGroup[] = [
  {
    title: "Elevation & Relief",
    sliders: [
      {
        key: "elevationScale",
        label: "Height intensity",
        tooltip: "Overall terrain height multiplier. Higher values make taller terrain (too high can clip peaks).",
        min: 0.6,
        max: 2.2,
        step: 0.05,
        inputId: "runElevationScale",
        outputId: "runElevationScaleValue"
      },
      {
        key: "elevationExponent",
        label: "Height curve",
        tooltip: "Curve applied to elevation noise. Higher values flatten lowlands and sharpen peaks.",
        min: 0.6,
        max: 2.4,
        step: 0.05,
        inputId: "runElevationExponent",
        outputId: "runElevationExponentValue"
      },
      {
        key: "mountainScale",
        label: "Mountain scale",
        tooltip: "Controls the size of mountain features. Higher values create broader ranges.",
        min: 0.6,
        max: 2.4,
        step: 0.05,
        inputId: "runMountainScale",
        outputId: "runMountainScaleValue"
      },
      {
        key: "ridgeStrength",
        label: "Ridge sharpness",
        tooltip: "Adds sharp ridges and crags. Higher values make terrain more rugged.",
        min: 0,
        max: 0.35,
        step: 0.01,
        inputId: "runRidgeStrength",
        outputId: "runRidgeStrengthValue"
      },
      {
        key: "valleyDepth",
        label: "Valley depth",
        tooltip: "Depth of carved valleys and river channels. Higher values deepen low areas.",
        min: 0.4,
        max: 3.0,
        step: 0.05,
        inputId: "runValleyDepth",
        outputId: "runValleyDepthValue"
      }
    ]
  },
  {
    title: "Forests & Meadows",
    sliders: [
      {
        key: "forestMacroScale",
        label: "Forest patch size",
        tooltip: "Size of large forest regions. Higher values create bigger patches.",
        min: 6,
        max: 60,
        step: 1,
        format: "int",
        inputId: "runForestMacroScale",
        outputId: "runForestMacroScaleValue"
      },
      {
        key: "forestDetailScale",
        label: "Forest detail scale",
        tooltip: "Fine-grain forest variation within patches. Higher values increase detail size.",
        min: 2,
        max: 24,
        step: 1,
        format: "int",
        inputId: "runForestDetailScale",
        outputId: "runForestDetailScaleValue"
      },
      {
        key: "forestThreshold",
        label: "Forest density",
        tooltip: "Threshold for forest placement. Higher values mean fewer forests.",
        min: 0.35,
        max: 0.9,
        step: 0.01,
        inputId: "runForestThreshold",
        outputId: "runForestThresholdValue"
      },
      {
        key: "highlandForestElevation",
        label: "Highland forest elevation",
        tooltip: "Upper elevation cutoff for forests. Higher values allow forests at higher altitudes.",
        min: 0.5,
        max: 0.95,
        step: 0.01,
        inputId: "runHighlandForestElevation",
        outputId: "runHighlandForestElevationValue"
      },
      {
        key: "meadowScale",
        label: "Meadow scale",
        tooltip: "Size of meadow features. Higher values create larger meadows.",
        min: 6,
        max: 64,
        step: 1,
        format: "int",
        inputId: "runMeadowScale",
        outputId: "runMeadowScaleValue"
      },
      {
        key: "meadowThreshold",
        label: "Meadow threshold",
        tooltip: "Threshold for meadow placement. Higher values mean fewer meadows.",
        min: 0.3,
        max: 0.9,
        step: 0.01,
        inputId: "runMeadowThreshold",
        outputId: "runMeadowThresholdValue"
      },
      {
        key: "meadowStrength",
        label: "Meadow strength",
        tooltip: "How strongly meadows reduce grass/forest canopy. Higher values make meadows more open.",
        min: 0,
        max: 1,
        step: 0.01,
        inputId: "runMeadowStrength",
        outputId: "runMeadowStrengthValue"
      },
      {
        key: "grassCanopyBase",
        label: "Grass canopy base",
        tooltip: "Baseline grass canopy coverage. Higher values make grass thicker everywhere.",
        min: 0,
        max: 0.35,
        step: 0.01,
        inputId: "runGrassCanopyBase",
        outputId: "runGrassCanopyBaseValue"
      },
      {
        key: "grassCanopyRange",
        label: "Grass canopy range",
        tooltip: "Variation range for grass canopy. Higher values increase patchiness.",
        min: 0,
        max: 0.6,
        step: 0.01,
        inputId: "runGrassCanopyRange",
        outputId: "runGrassCanopyRangeValue"
      }
    ]
  },
  {
    title: "Water & Rivers",
    sliders: [
      {
        key: "waterCoverage",
        label: "Water coverage",
        tooltip: "Target share of water tiles. Sea level is raised until this percentage is reached.",
        min: 0.1,
        max: 0.75,
        step: 0.01,
        format: "percent",
        inputId: "runWaterCoverage",
        outputId: "runWaterCoverageValue"
      },
      {
        key: "edgeWaterBias",
        label: "Coast water bias",
        tooltip: "How strongly water is favored near edges when setting sea level. Higher values enlarge coastlines.",
        min: 0,
        max: 0.4,
        step: 0.01,
        inputId: "runEdgeWaterBias",
        outputId: "runEdgeWaterBiasValue"
      },
      {
        key: "riverCount",
        label: "River count (0 = auto)",
        tooltip: "Number of rivers to carve. Set to 0 to keep automatic river counts by map size.",
        min: 0,
        max: 12,
        step: 1,
        format: "int",
        inputId: "runRiverCount",
        outputId: "runRiverCountValue"
      },
      {
        key: "riverWaterBias",
        label: "River carve strength",
        tooltip: "Controls river channel width/depth and lake size. Higher values make rivers wider and lakes larger.",
        min: 0,
        max: 0.6,
        step: 0.01,
        inputId: "runRiverWaterBias",
        outputId: "runRiverWaterBiasValue"
      }
    ]
  }
];

const formatValue = (value: number, format?: MapGenSlider["format"]): string => {
  if (format === "int") {
    return Math.round(value).toString();
  }
  if (format === "percent") {
    return `${Math.round(value * 100)}%`;
  }
  return value.toFixed(2);
};

export const buildMapGenControls = (): void => {
  const container = document.getElementById("mapGenControls");
  if (!container) {
    return;
  }
  container.innerHTML = "";
  MAPGEN_GROUPS.forEach((group) => {
    const card = document.createElement("div");
    card.className = "run-settings-card";

    const title = document.createElement("div");
    title.className = "run-settings-title";
    title.textContent = group.title;
    card.appendChild(title);

    group.sliders.forEach((slider) => {
      const label = document.createElement("label");
      label.className = "run-slider";
      label.appendChild(document.createTextNode(slider.label));
      label.title = slider.tooltip;

      const row = document.createElement("div");
      row.className = "run-slider-row";

      const input = document.createElement("input");
      input.id = slider.inputId;
      input.type = "range";
      input.min = slider.min.toString();
      input.max = slider.max.toString();
      input.step = slider.step.toString();
      input.title = slider.tooltip;
      const defaultValue = DEFAULT_MAP_GEN_SETTINGS[slider.key];
      input.value = `${defaultValue}`;
      input.setAttribute("data-mapgen-key", slider.key);
      input.setAttribute("data-output", slider.outputId);
      if (slider.format) {
        input.setAttribute("data-format", slider.format);
      }

      const output = document.createElement("output");
      output.id = slider.outputId;
      output.className = "run-slider-value";
      output.setAttribute("for", slider.inputId);
      output.textContent = formatValue(defaultValue, slider.format);

      row.appendChild(input);
      row.appendChild(output);
      label.appendChild(row);
      card.appendChild(label);
    });

    container.appendChild(card);
  });
};
