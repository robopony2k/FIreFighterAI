import { DEFAULT_MAP_GEN_SETTINGS } from "../mapgen/settings.js";
import type { MapGenSettings } from "../mapgen/settings.js";

type MapGenSlider = {
  key: keyof MapGenSettings;
  label: string;
  min: number;
  max: number;
  step: number;
  format?: "int" | "fixed2";
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
        min: 0.6,
        max: 3,
        step: 0.05,
        inputId: "runElevationScale",
        outputId: "runElevationScaleValue"
      },
      {
        key: "elevationExponent",
        label: "Height curve",
        min: 0.8,
        max: 2.4,
        step: 0.05,
        inputId: "runElevationExponent",
        outputId: "runElevationExponentValue"
      },
      {
        key: "mountainScale",
        label: "Mountain scale",
        min: 0.7,
        max: 2.2,
        step: 0.05,
        inputId: "runMountainScale",
        outputId: "runMountainScaleValue"
      },
      {
        key: "ridgeStrength",
        label: "Ridge sharpness",
        min: 0,
        max: 0.35,
        step: 0.01,
        inputId: "runRidgeStrength",
        outputId: "runRidgeStrengthValue"
      },
      {
        key: "valleyDepth",
        label: "Valley depth",
        min: 0.6,
        max: 2.6,
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
        min: 10,
        max: 32,
        step: 1,
        format: "int",
        inputId: "runForestMacroScale",
        outputId: "runForestMacroScaleValue"
      },
      {
        key: "forestDetailScale",
        label: "Forest detail scale",
        min: 4,
        max: 16,
        step: 1,
        format: "int",
        inputId: "runForestDetailScale",
        outputId: "runForestDetailScaleValue"
      },
      {
        key: "forestThreshold",
        label: "Forest density",
        min: 0.5,
        max: 0.8,
        step: 0.01,
        inputId: "runForestThreshold",
        outputId: "runForestThresholdValue"
      },
      {
        key: "highlandForestElevation",
        label: "Highland forest elevation",
        min: 0.6,
        max: 0.9,
        step: 0.01,
        inputId: "runHighlandForestElevation",
        outputId: "runHighlandForestElevationValue"
      },
      {
        key: "meadowScale",
        label: "Meadow scale",
        min: 10,
        max: 40,
        step: 1,
        format: "int",
        inputId: "runMeadowScale",
        outputId: "runMeadowScaleValue"
      },
      {
        key: "meadowThreshold",
        label: "Meadow threshold",
        min: 0.4,
        max: 0.8,
        step: 0.01,
        inputId: "runMeadowThreshold",
        outputId: "runMeadowThresholdValue"
      },
      {
        key: "meadowStrength",
        label: "Meadow strength",
        min: 0,
        max: 1,
        step: 0.01,
        inputId: "runMeadowStrength",
        outputId: "runMeadowStrengthValue"
      },
      {
        key: "grassCanopyBase",
        label: "Grass canopy base",
        min: 0,
        max: 0.2,
        step: 0.01,
        inputId: "runGrassCanopyBase",
        outputId: "runGrassCanopyBaseValue"
      },
      {
        key: "grassCanopyRange",
        label: "Grass canopy range",
        min: 0,
        max: 0.4,
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
        key: "baseWaterThreshold",
        label: "Base water threshold",
        min: 0.08,
        max: 0.22,
        step: 0.01,
        inputId: "runBaseWaterThreshold",
        outputId: "runBaseWaterThresholdValue"
      },
      {
        key: "edgeWaterBias",
        label: "Coast water bias",
        min: 0,
        max: 0.25,
        step: 0.01,
        inputId: "runEdgeWaterBias",
        outputId: "runEdgeWaterBiasValue"
      },
      {
        key: "riverWaterBias",
        label: "River water bias",
        min: 0,
        max: 0.3,
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

      const row = document.createElement("div");
      row.className = "run-slider-row";

      const input = document.createElement("input");
      input.id = slider.inputId;
      input.type = "range";
      input.min = slider.min.toString();
      input.max = slider.max.toString();
      input.step = slider.step.toString();
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
