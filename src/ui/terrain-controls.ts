import { createDefaultTerrainRecipe } from "../mapgen/terrainProfile.js";
import {
  formatTerrainControlValue,
  type TerrainControlField,
  type TerrainControlGroup
} from "./terrain-schema.js";

type BuildTerrainControlsOptions = {
  container?: HTMLElement | null;
  containerId?: string;
  groups: readonly TerrainControlGroup[];
  idPrefix: string;
};

const resolveContainer = (options: BuildTerrainControlsOptions): HTMLElement | null => {
  if (options.container) {
    return options.container;
  }
  return options.containerId ? document.getElementById(options.containerId) : null;
};

const buildElementId = (prefix: string, slug: string, suffix: "input" | "value"): string =>
  `${prefix}${slug}${suffix === "input" ? "Input" : "Value"}`;

const buildSliderField = (
  field: Extract<TerrainControlField, { type: "slider" }>,
  idPrefix: string,
  recipeDefaults: ReturnType<typeof createDefaultTerrainRecipe>
): HTMLElement => {
  const label = document.createElement("label");
  label.className = "run-slider";
  label.appendChild(document.createTextNode(field.label));
  label.title = field.tooltip;

  const row = document.createElement("div");
  row.className = "run-slider-row";

  const input = document.createElement("input");
  input.id = buildElementId(idPrefix, field.slug, "input");
  input.type = "range";
  input.min = `${field.min}`;
  input.max = `${field.max}`;
  input.step = `${field.step}`;
  input.title = field.tooltip;
  input.dataset.terrainScope = field.scope;
  input.dataset.terrainKey = field.key;
  input.dataset.output = buildElementId(idPrefix, field.slug, "value");
  if (field.format) {
    input.dataset.format = field.format;
  }
  const defaultValue =
    field.scope === "recipe"
      ? recipeDefaults[field.key as keyof typeof recipeDefaults]
      : recipeDefaults.advancedOverrides?.[field.key as keyof NonNullable<typeof recipeDefaults.advancedOverrides>];
  input.value = `${typeof defaultValue === "number" ? defaultValue : 0}`;

  const output = document.createElement("output");
  output.id = buildElementId(idPrefix, field.slug, "value");
  output.className = "run-slider-value";
  output.setAttribute("for", input.id);
  output.textContent = formatTerrainControlValue(Number(input.value), field.format);

  row.append(input, output);
  label.appendChild(row);
  return label;
};

const buildSelectField = (field: Extract<TerrainControlField, { type: "select" }>, idPrefix: string): HTMLElement => {
  const label = document.createElement("label");
  label.className = "run-input";
  label.appendChild(document.createTextNode(field.label));
  label.title = field.tooltip;

  const select = document.createElement("select");
  select.id = buildElementId(idPrefix, field.slug, "input");
  select.dataset.terrainScope = field.scope;
  select.dataset.terrainKey = field.key;
  select.title = field.tooltip;
  field.options.forEach((optionDef) => {
    const option = document.createElement("option");
    option.value = optionDef.value;
    option.textContent = optionDef.label;
    select.appendChild(option);
  });
  label.appendChild(select);
  return label;
};

const buildCheckboxField = (
  field: Extract<TerrainControlField, { type: "checkbox" }>,
  idPrefix: string,
  recipeDefaults: ReturnType<typeof createDefaultTerrainRecipe>
): HTMLElement => {
  const label = document.createElement("label");
  label.className = "run-toggle";
  label.title = field.tooltip;

  const row = document.createElement("span");
  row.className = "run-toggle-row";

  const input = document.createElement("input");
  input.id = buildElementId(idPrefix, field.slug, "input");
  input.type = "checkbox";
  input.dataset.terrainScope = field.scope;
  input.dataset.terrainKey = field.key;
  input.title = field.tooltip;
  const defaultValue = recipeDefaults.advancedOverrides?.[field.key as keyof NonNullable<typeof recipeDefaults.advancedOverrides>];
  input.checked = Boolean(defaultValue);

  const copy = document.createElement("span");
  copy.className = "run-toggle-copy";
  copy.textContent = field.label;

  row.append(input, copy);
  label.append(row);
  return label;
};

export const buildTerrainControls = (options: BuildTerrainControlsOptions): void => {
  const container = resolveContainer(options);
  if (!container) {
    return;
  }
  const defaults = createDefaultTerrainRecipe();
  container.innerHTML = "";
  options.groups.forEach((group) => {
    if (group.fields.length === 0) {
      return;
    }
    const card = document.createElement("div");
    card.className = "run-settings-card";
    if (group.advanced) {
      card.dataset.terrainAdvanced = "true";
    }

    const title = document.createElement("div");
    title.className = "run-settings-title";
    title.textContent = group.title;
    card.appendChild(title);

    group.fields.forEach((field) => {
      card.appendChild(
        field.type === "slider"
          ? buildSliderField(field, options.idPrefix, defaults)
          : field.type === "select"
            ? buildSelectField(field, options.idPrefix)
            : buildCheckboxField(field, options.idPrefix, defaults)
      );
    });

    container.appendChild(card);
  });
};
