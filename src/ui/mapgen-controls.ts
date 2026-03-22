import { DEFAULT_MAP_GEN_SETTINGS } from "../mapgen/settings.js";
import {
  MAPGEN_GROUPS,
  formatMapGenValue,
  type MapGenGroup
} from "./mapgen-schema.js";

type BuildMapGenControlsOptions = {
  container?: HTMLElement | null;
  containerId?: string;
  groups?: readonly MapGenGroup[];
  idPrefix?: string;
};

const resolveContainer = (options: BuildMapGenControlsOptions): HTMLElement | null => {
  if (options.container) {
    return options.container;
  }
  const containerId = options.containerId ?? "mapGenControls";
  return document.getElementById(containerId);
};

const buildElementId = (prefix: string, slug: string, suffix: "input" | "value"): string =>
  `${prefix}${slug}${suffix === "input" ? "Input" : "Value"}`;

export const buildMapGenControls = (options: BuildMapGenControlsOptions = {}): void => {
  const container = resolveContainer(options);
  if (!container) {
    return;
  }
  const groups = options.groups ?? MAPGEN_GROUPS;
  const idPrefix = options.idPrefix ?? "run";

  container.innerHTML = "";
  groups.forEach((group) => {
    const card = document.createElement("div");
    card.className = "run-settings-card";
    card.dataset.mapgenGroup = group.id;

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
      input.id = buildElementId(idPrefix, slider.slug, "input");
      input.type = "range";
      input.min = slider.min.toString();
      input.max = slider.max.toString();
      input.step = slider.step.toString();
      input.title = slider.tooltip;
      const defaultValue = DEFAULT_MAP_GEN_SETTINGS[slider.key];
      input.value = `${defaultValue}`;
      input.setAttribute("data-mapgen-key", slider.key);
      input.setAttribute("data-mapgen-group", group.id);
      input.setAttribute("data-output", buildElementId(idPrefix, slider.slug, "value"));
      if (slider.format) {
        input.setAttribute("data-format", slider.format);
      }

      const output = document.createElement("output");
      output.id = buildElementId(idPrefix, slider.slug, "value");
      output.className = "run-slider-value";
      output.setAttribute("for", input.id);
      output.textContent = formatMapGenValue(defaultValue, slider.format);

      row.append(input, output);
      label.appendChild(row);
      card.appendChild(label);
    });

    container.appendChild(card);
  });
};

