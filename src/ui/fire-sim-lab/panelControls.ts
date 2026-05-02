import type { TileType } from "../../core/types.js";
import type { FireSimLabEnvironment } from "../../systems/fire/types/fireSimLabTypes.js";

export type FireSimLabEnvironmentRangeKey = Exclude<keyof FireSimLabEnvironment, "simSpeed">;

export type RangeBinding = {
  apply: (value: number) => void;
  setHelpText: (helpText: string) => void;
};

export const FIRE_SIM_LAB_ENVIRONMENT_FIELDS: Array<{
  key: FireSimLabEnvironmentRangeKey;
  label: string;
  min: number;
  max: number;
  step: number;
  helpText: string;
}> = [
  {
    key: "windDirectionDeg",
    label: "Wind Dir",
    min: 0,
    max: 359,
    step: 1,
    helpText: "Direction heat is pushed toward on the grid. 0 moves north/up, 90 moves east/right, 180 moves south/down."
  },
  {
    key: "windStrength",
    label: "Wind",
    min: 0,
    max: 1.5,
    step: 0.01,
    helpText: "Directional spread pressure. 0 is calm, around 0.5 is moderate, and values above 1 strongly favor downwind runs."
  },
  {
    key: "temperatureC",
    label: "Temp C",
    min: 0,
    max: 50,
    step: 0.5,
    helpText: "Ambient temperature used by the live fire response. Hotter values raise ignition and spread pressure and reduce cooling."
  },
  {
    key: "moisture",
    label: "Moisture",
    min: 0,
    max: 1,
    step: 0.01,
    helpText: "Tile wetness applied to fuel profiles. 0 is dry and fast to ignite; 1 is saturated and strongly dampens fuel and burn rate."
  },
  {
    key: "climateRisk",
    label: "Risk",
    min: 0,
    max: 1,
    step: 0.01,
    helpText: "Overall climate severity. Low values add burnout/cooling pressure; high values make ignition, spread, and sustain more reliable."
  }
];

export const FIRE_SIM_LAB_SPEED_HELP_TEXT =
  "Incident-time multiplier. SIM Lab uses the game's slow incident-speed presets, adds 0.5x and 1x for lab checks, and is capped at 1x.";

export const formatFireSimLabSpeedOption = (value: number): string =>
  `${value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}x`;

export const formatTileType = (type: TileType): string =>
  type
    .split("-")
    .join(" ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const formatNumber = (value: number, step = 0.01): string => {
  if (step >= 1) {
    return `${Math.round(value)}`;
  }
  if (step >= 0.1) {
    return value.toFixed(1).replace(/\.0$/, "");
  }
  return value.toFixed(2);
};

export const createFireSimLabSection = (titleText: string): HTMLElement => {
  const section = document.createElement("section");
  section.className = "fire-sim-lab-section";
  const title = document.createElement("h3");
  title.textContent = titleText;
  section.appendChild(title);
  return section;
};

export const createFireSimLabRangeRow = (
  labelText: string,
  min: number,
  max: number,
  step: number,
  onChange: (value: number) => void,
  helpText = ""
): RangeBinding & { row: HTMLLabelElement } => {
  const row = document.createElement("label");
  row.className = "fire-sim-lab-range-row";
  const heading = document.createElement("span");
  heading.className = "fire-sim-lab-range-heading";
  const label = document.createElement("span");
  label.textContent = labelText;
  const valueText = document.createElement("strong");
  heading.append(label, valueText);
  const inputs = document.createElement("span");
  inputs.className = "fire-sim-lab-range-inputs";
  const range = document.createElement("input");
  range.type = "range";
  range.min = `${min}`;
  range.max = `${max}`;
  range.step = `${step}`;
  const number = document.createElement("input");
  number.type = "number";
  number.min = `${min}`;
  number.max = `${max}`;
  number.step = `${step}`;
  inputs.append(range, number);
  row.append(heading, inputs);

  const setHelpText = (nextHelpText: string): void => {
    const targets: HTMLElement[] = [row, heading, label, valueText, range, number];
    targets.forEach((target) => {
      if (nextHelpText) {
        target.title = nextHelpText;
      } else {
        target.removeAttribute("title");
      }
    });
  };

  const commit = (raw: number): void => {
    const value = Math.max(min, Math.min(max, raw));
    range.value = `${value}`;
    number.value = `${value}`;
    valueText.textContent = formatNumber(value, step);
    onChange(value);
  };
  range.addEventListener("input", () => commit(Number(range.value)));
  number.addEventListener("input", () => {
    const value = Number(number.value);
    if (Number.isFinite(value)) {
      commit(value);
    }
  });
  setHelpText(helpText);

  return {
    row,
    apply: (value: number) => {
      range.value = `${value}`;
      number.value = `${value}`;
      valueText.textContent = formatNumber(value, step);
    },
    setHelpText
  };
};
