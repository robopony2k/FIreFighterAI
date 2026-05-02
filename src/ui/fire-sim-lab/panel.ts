import type { TileType } from "../../core/types.js";
import {
  FIRE_SIM_LAB_PROFILE_FIELDS,
  FIRE_SIM_LAB_SCENARIOS,
  FIRE_SIM_LAB_SPEED_OPTIONS,
  FIRE_SIM_LAB_TERRAIN_TYPES,
  type FireSimLabEnvironment,
  type FireSimLabProfileField,
  type FireSimLabScenarioId,
  type FireSimLabStats,
  type FireSimLabTool
} from "../../systems/fire/types/fireSimLabTypes.js";
import type { FireSimLabSession } from "../../systems/fire/sim/fireSimLabSession.js";
import type { FireSimLabGridPointer } from "./gridView.js";
import {
  FUEL_PROFILE_FIELD_DEFINITIONS,
  buildFuelInputTooltip,
  buildFuelTypeTooltip,
  formatFuelTileTypeLabel
} from "../fuelProfileHelp.js";
import {
  clearAllFireSimLabFuelProfileDrafts,
  clearFireSimLabFuelProfileDraft,
  saveFireSimLabFuelProfileDraft
} from "./fuelProfileDrafts.js";
import { buildFuelProfileDefaultsSource } from "./fuelProfileTsExport.js";
import { createFireSimLabLegend } from "./legendView.js";
import {
  FIRE_SIM_LAB_ENVIRONMENT_FIELDS,
  FIRE_SIM_LAB_SPEED_HELP_TEXT,
  createFireSimLabRangeRow,
  createFireSimLabSection,
  formatFireSimLabSpeedOption,
  formatTileType,
  type RangeBinding
} from "./panelControls.js";
import { createFireSimLabSavedScenarioControls } from "./savedScenarioControls.js";

export type FireSimLabPanelOptions = {
  session: FireSimLabSession;
  getPaused: () => boolean;
  setPaused: (paused: boolean) => void;
  getTool: () => FireSimLabTool;
  setTool: (tool: FireSimLabTool) => void;
  getBrushType: () => TileType;
  setBrushType: (type: TileType) => void;
  getBrushRadius: () => number;
  setBrushRadius: (radius: number) => void;
  onStep: () => void;
  onChange: () => void;
};

export type FireSimLabPanelHandle = {
  element: HTMLElement;
  setHoverTile: (tile: FireSimLabGridPointer | null) => void;
  sync: () => void;
  destroy: () => void;
};

export const createFireSimLabPanel = ({
  session,
  getPaused,
  setPaused,
  getTool,
  setTool,
  getBrushType,
  setBrushType,
  getBrushRadius,
  setBrushRadius,
  onStep,
  onChange
}: FireSimLabPanelOptions): FireSimLabPanelHandle => {
  const element = document.createElement("aside");
  element.className = "fire-sim-lab-panel";
  let hoverTile: FireSimLabGridPointer | null = null;

  const copyTextToClipboard = async (text: string): Promise<boolean> => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch {
      // Fall through to the textarea copy path.
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  };

  const header = document.createElement("div");
  header.className = "fire-sim-lab-header";
  const badge = document.createElement("div");
  badge.className = "fire-sim-lab-badge";
  badge.textContent = "Dev Tool";
  const title = document.createElement("h2");
  title.textContent = "SIM Lab";
  header.append(badge, title);
  element.appendChild(header);

  const scenarioSection = createFireSimLabSection("Scenario");
  const scenarioSelect = document.createElement("select");
  scenarioSelect.className = "fire-sim-lab-select";
  FIRE_SIM_LAB_SCENARIOS.forEach((scenario) => {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = scenario.label;
    scenarioSelect.appendChild(option);
  });
  const playbackRow = document.createElement("div");
  playbackRow.className = "fire-sim-lab-actions";
  const playButton = document.createElement("button");
  playButton.type = "button";
  const stepButton = document.createElement("button");
  stepButton.type = "button";
  stepButton.textContent = "Step";
  const restartButton = document.createElement("button");
  restartButton.type = "button";
  restartButton.textContent = "Restart";
  playbackRow.append(playButton, stepButton, restartButton);
  const savedScenarioControls = createFireSimLabSavedScenarioControls({
    session,
    onLoad: () => {
      sync();
    },
    onChange
  });
  scenarioSection.append(scenarioSelect, playbackRow, savedScenarioControls.element);
  element.appendChild(scenarioSection);

  const toolsSection = createFireSimLabSection("Grid Tools");
  const toolRow = document.createElement("div");
  toolRow.className = "fire-sim-lab-actions";
  const toolButtons = new Map<FireSimLabTool, HTMLButtonElement>();
  ([
    ["paint", "Paint"],
    ["ignite", "Ignite"],
    ["cool", "Cool"],
    ["firefighter", "Firefighter"]
  ] as const).forEach(([tool, label]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    if (tool === "firefighter") {
      button.title = "Paint a stationary firefighter marker. It pre-wets its default radius and auto-sprays nearby hot or burning cells within hose range.";
    }
    button.addEventListener("click", () => {
      setTool(tool);
      sync();
      onChange();
    });
    toolButtons.set(tool, button);
    toolRow.appendChild(button);
  });
  const terrainSelect = document.createElement("select");
  terrainSelect.className = "fire-sim-lab-select";
  FIRE_SIM_LAB_TERRAIN_TYPES.forEach((type) => {
    const option = document.createElement("option");
    option.value = type;
    option.textContent = formatTileType(type);
    terrainSelect.appendChild(option);
  });
  const brushRow = createFireSimLabRangeRow("Brush", 1, 4, 1, (value) => {
    setBrushRadius(value);
    onChange();
  }, "Square brush size in cells. 1 paints one cell, 2 paints a 2x2 square, 3 paints 3x3, and 4 paints 4x4.");
  const hoverStatus = document.createElement("div");
  hoverStatus.className = "fire-sim-lab-status";
  toolsSection.append(toolRow, terrainSelect, brushRow.row, hoverStatus);
  element.appendChild(toolsSection);

  const legendSection = createFireSimLabSection("Legend");
  legendSection.appendChild(createFireSimLabLegend());
  element.appendChild(legendSection);

  const environmentSection = createFireSimLabSection("Environment");
  const environmentBindings = new Map<keyof FireSimLabEnvironment, RangeBinding>();
  FIRE_SIM_LAB_ENVIRONMENT_FIELDS.forEach((field) => {
    const binding = createFireSimLabRangeRow(field.label, field.min, field.max, field.step, (value) => {
      session.setEnvironment({ [field.key]: value });
      sync();
      onChange();
    }, field.helpText);
    environmentBindings.set(field.key, binding);
    environmentSection.appendChild(binding.row);
  });
  const speedRow = document.createElement("div");
  speedRow.className = "fire-sim-lab-speed-row";
  speedRow.title = FIRE_SIM_LAB_SPEED_HELP_TEXT;
  const speedHeading = document.createElement("span");
  speedHeading.className = "fire-sim-lab-range-heading";
  const speedLabel = document.createElement("span");
  speedLabel.textContent = "Sim Speed";
  const speedValue = document.createElement("strong");
  speedHeading.append(speedLabel, speedValue);
  const speedOptions = document.createElement("div");
  speedOptions.className = "fire-sim-lab-speed-options";
  const speedButtons = new Map<number, HTMLButtonElement>();
  FIRE_SIM_LAB_SPEED_OPTIONS.forEach((speed) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = formatFireSimLabSpeedOption(speed);
    button.title = FIRE_SIM_LAB_SPEED_HELP_TEXT;
    button.addEventListener("click", () => {
      session.setEnvironment({ simSpeed: speed });
      sync();
      onChange();
    });
    speedButtons.set(speed, button);
    speedOptions.appendChild(button);
  });
  speedRow.append(speedHeading, speedOptions);
  environmentSection.appendChild(speedRow);
  element.appendChild(environmentSection);

  const fuelSection = createFireSimLabSection("Fuel Profile");
  const fuelHeader = document.createElement("div");
  fuelHeader.className = "fire-sim-lab-subhead";
  const fuelTitle = document.createElement("span");
  const fuelActions = document.createElement("div");
  fuelActions.className = "fire-sim-lab-actions";
  const resetFuelButton = document.createElement("button");
  resetFuelButton.type = "button";
  resetFuelButton.textContent = "Reset Type";
  const copyDefaultsButton = document.createElement("button");
  copyDefaultsButton.type = "button";
  copyDefaultsButton.textContent = "Copy TS Defaults";
  copyDefaultsButton.title = "Copy a complete src/config/fuelProfiles.ts file from the current SIM Lab profiles.";
  fuelActions.append(resetFuelButton, copyDefaultsButton);
  fuelHeader.append(fuelTitle, fuelActions);
  const profileBindings = new Map<FireSimLabProfileField, RangeBinding>();
  fuelSection.appendChild(fuelHeader);
  FIRE_SIM_LAB_PROFILE_FIELDS.forEach((field) => {
    const label = FUEL_PROFILE_FIELD_DEFINITIONS.find((entry) => entry.key === field.key)?.label ?? field.label;
    const binding = createFireSimLabRangeRow(label, field.min, field.max, field.step, (value) => {
      const profileType = getBrushType();
      session.setFuelProfileValue(profileType, field.key, value);
      saveFireSimLabFuelProfileDraft(profileType, session.getFuelProfile(profileType));
      sync();
      onChange();
    });
    profileBindings.set(field.key, binding);
    fuelSection.appendChild(binding.row);
  });
  const fuelStatus = document.createElement("div");
  fuelStatus.className = "fire-sim-lab-status";
  fuelStatus.textContent = "Slider edits apply live and auto-save as local SIM Lab drafts.";
  fuelSection.appendChild(fuelStatus);
  element.appendChild(fuelSection);

  const statsSection = createFireSimLabSection("Readout");
  const statsGrid = document.createElement("div");
  statsGrid.className = "fire-sim-lab-stats";
  const statsEntries = new Map<keyof FireSimLabStats, HTMLElement>();
  const addStat = (key: keyof FireSimLabStats, label: string): void => {
    const item = document.createElement("div");
    item.className = "fire-sim-lab-stat";
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    const valueEl = document.createElement("strong");
    item.append(labelEl, valueEl);
    statsGrid.appendChild(item);
    statsEntries.set(key, valueEl);
  };
  addStat("elapsedDays", "Days");
  addStat("activeTiles", "Active");
  addStat("burnedTiles", "Burned");
  addStat("burningArea", "Area");
  addStat("maxFire", "Fire");
  addStat("maxHeat", "Heat");
  addStat("downwindReach", "Reach");
  statsSection.appendChild(statsGrid);
  element.appendChild(statsSection);

  const exportSection = createFireSimLabSection("Export");
  const exportActions = document.createElement("div");
  exportActions.className = "fire-sim-lab-actions";
  const resetAllButton = document.createElement("button");
  resetAllButton.type = "button";
  resetAllButton.textContent = "Reset All";
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy JSON";
  exportActions.append(resetAllButton, copyButton);
  const exportStatus = document.createElement("div");
  exportStatus.className = "fire-sim-lab-status";
  exportStatus.textContent = "JSON export captures the current profile set.";
  exportSection.append(exportActions, exportStatus);
  element.appendChild(exportSection);

  const sync = (): void => {
    scenarioSelect.value = session.getScenario();
    playButton.textContent = getPaused() ? "Play" : "Pause";
    toolButtons.forEach((button, tool) => {
      button.setAttribute("aria-pressed", `${getTool() === tool}`);
    });
    terrainSelect.disabled = getTool() !== "paint";
    terrainSelect.value = getBrushType();
    brushRow.apply(getBrushRadius());
    const environment = session.getEnvironment();
    FIRE_SIM_LAB_ENVIRONMENT_FIELDS.forEach((field) => {
      environmentBindings.get(field.key)?.apply(Number(environment[field.key]));
    });
    speedValue.textContent = formatFireSimLabSpeedOption(environment.simSpeed);
    speedButtons.forEach((button, speed) => {
      button.setAttribute("aria-pressed", `${Math.abs(environment.simSpeed - speed) < 0.000001}`);
    });
    const profileType = getBrushType();
    const profile = session.getFuelProfile(profileType);
    const heatCap = session.state.fireSettings.heatCap;
    fuelTitle.textContent = formatFuelTileTypeLabel(profileType);
    fuelTitle.title = buildFuelTypeTooltip(profileType, profile, heatCap);
    FIRE_SIM_LAB_PROFILE_FIELDS.forEach((field) => {
      const binding = profileBindings.get(field.key);
      binding?.apply(profile[field.key]);
      binding?.setHelpText(buildFuelInputTooltip(profileType, field.key, profile, heatCap));
    });
    const stats = session.getStats();
    statsEntries.get("elapsedDays")!.textContent = stats.elapsedDays.toFixed(1);
    statsEntries.get("activeTiles")!.textContent = `${stats.activeTiles}`;
    statsEntries.get("burnedTiles")!.textContent = `${stats.burnedTiles}`;
    statsEntries.get("burningArea")!.textContent = `${stats.burningArea}`;
    statsEntries.get("maxFire")!.textContent = stats.maxFire.toFixed(2);
    statsEntries.get("maxHeat")!.textContent = stats.maxHeat.toFixed(2);
    statsEntries.get("downwindReach")!.textContent = stats.downwindReach.toFixed(1);
    hoverStatus.textContent = hoverTile
      ? `${hoverTile.x}, ${hoverTile.y} / ${session.state.tiles[hoverTile.y * session.state.grid.cols + hoverTile.x].type}`
      : "No cell selected";
    if (getTool() === "firefighter") {
      hoverStatus.textContent = `${session.getFirefighters().length} firefighter marker${session.getFirefighters().length === 1 ? "" : "s"}`;
    }
  };

  scenarioSelect.addEventListener("change", () => {
    session.setScenario(scenarioSelect.value as FireSimLabScenarioId);
    sync();
    onChange();
  });
  playButton.addEventListener("click", () => {
    setPaused(!getPaused());
    sync();
    onChange();
  });
  stepButton.addEventListener("click", () => {
    onStep();
    sync();
    onChange();
  });
  restartButton.addEventListener("click", () => {
    session.resetScenario();
    sync();
    onChange();
  });
  terrainSelect.addEventListener("change", () => {
    setBrushType(terrainSelect.value as TileType);
    sync();
    onChange();
  });
  resetFuelButton.addEventListener("click", () => {
    const profileType = getBrushType();
    clearFireSimLabFuelProfileDraft(profileType);
    session.resetFuelProfile(profileType);
    sync();
    fuelStatus.textContent = `Reset ${formatFuelTileTypeLabel(profileType)} draft to committed defaults.`;
    onChange();
  });
  copyDefaultsButton.addEventListener("click", async () => {
    copyDefaultsButton.disabled = true;
    const source = buildFuelProfileDefaultsSource(session.getFuelProfiles());
    const copied = await copyTextToClipboard(source);
    fuelStatus.textContent = copied
      ? "Copied complete src/config/fuelProfiles.ts defaults."
      : "Clipboard copy failed. Copy JSON still works as a fallback.";
    copyDefaultsButton.disabled = false;
  });
  resetAllButton.addEventListener("click", () => {
    clearAllFireSimLabFuelProfileDrafts();
    session.resetAllFuelProfiles();
    sync();
    exportStatus.textContent = "Cleared all SIM Lab fuel profile drafts.";
    onChange();
  });
  copyButton.addEventListener("click", async () => {
    const text = session.getProfileExportText();
    if (await copyTextToClipboard(text)) {
      exportStatus.textContent = "Profiles copied.";
    } else {
      exportStatus.textContent = "Clipboard copy failed.";
    }
  });

  sync();

  return {
    element,
    setHoverTile: (tile) => {
      hoverTile = tile;
      sync();
    },
    sync,
    destroy: () => {
      element.remove();
    }
  };
};
