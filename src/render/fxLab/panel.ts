import { FX_LAB_FIRE_CONTROLS, FX_LAB_WATER_CONTROLS } from "./controls.js";
import { FX_LAB_SCENARIOS } from "./scenarios.js";
import type { FxLabController } from "./controller.js";
import type { WaterSprayMode } from "../../core/types.js";
import type { FireFxDebugControls } from "../threeTestFireFx.js";
import type { WaterFxDebugControls } from "../threeTestUnitFx.js";
import type { FxLabPlacementMode, FxLabScenarioId } from "./types.js";

type ControlBinding = {
  apply: (value: string | number | boolean) => void;
};

export type FxLabPanelHandle = {
  destroy: () => void;
  sync: () => void;
};

const formatValue = (value: number, step: number): string => {
  if (step >= 1) {
    return `${Math.round(value)}`;
  }
  if (step >= 0.1) {
    return value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  }
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
};

export const createFxLabPanel = (mount: HTMLElement, controller: FxLabController): FxLabPanelHandle => {
  const root = document.createElement("div");
  root.className = "fx-lab-shell";
  const panel = document.createElement("aside");
  panel.className = "fx-lab-panel";
  root.appendChild(panel);
  mount.appendChild(root);

  const header = document.createElement("div");
  header.className = "fx-lab-panel-header";
  const badge = document.createElement("div");
  badge.className = "fx-lab-panel-badge";
  badge.textContent = "Dev Tool";
  const title = document.createElement("h2");
  title.textContent = "FX Lab";
  const intro = document.createElement("p");
  intro.textContent = "Live-tune fire and water rendering against scripted deterministic scenes.";
  header.append(badge, title, intro);
  panel.appendChild(header);

  const scenarioSection = document.createElement("section");
  scenarioSection.className = "fx-lab-section";
  const scenarioTitle = document.createElement("h3");
  scenarioTitle.textContent = "Scenario";
  const scenarioSelect = document.createElement("select");
  scenarioSelect.className = "fx-lab-select";
  FX_LAB_SCENARIOS.forEach((scenario) => {
    const option = document.createElement("option");
    option.value = scenario.id;
    option.textContent = scenario.label;
    scenarioSelect.appendChild(option);
  });
  const scenarioDescription = document.createElement("p");
  scenarioDescription.className = "fx-lab-section-note";
  scenarioSection.append(scenarioTitle, scenarioSelect, scenarioDescription);
  panel.appendChild(scenarioSection);

  const playbackSection = document.createElement("section");
  playbackSection.className = "fx-lab-section";
  const playbackTitle = document.createElement("h3");
  playbackTitle.textContent = "Playback";
  const playbackRow = document.createElement("div");
  playbackRow.className = "fx-lab-inline-actions";
  const playPauseButton = document.createElement("button");
  playPauseButton.type = "button";
  const restartButton = document.createElement("button");
  restartButton.type = "button";
  restartButton.textContent = "Restart";
  const stepButton = document.createElement("button");
  stepButton.type = "button";
  stepButton.textContent = "Step";
  playbackRow.append(playPauseButton, restartButton, stepButton);
  const timeScaleLabel = document.createElement("label");
  timeScaleLabel.className = "fx-lab-inline-field";
  const timeScaleText = document.createElement("span");
  timeScaleText.textContent = "Time Scale";
  const timeScaleSelect = document.createElement("select");
  timeScaleSelect.className = "fx-lab-select";
  [0.25, 0.5, 1, 1.5, 2, 3].forEach((value) => {
    const option = document.createElement("option");
    option.value = `${value}`;
    option.textContent = `${value}x`;
    timeScaleSelect.appendChild(option);
  });
  timeScaleLabel.append(timeScaleText, timeScaleSelect);
  playbackSection.append(playbackTitle, playbackRow, timeScaleLabel);
  panel.appendChild(playbackSection);

  const placementSection = document.createElement("section");
  placementSection.className = "fx-lab-section";
  const placementTitle = document.createElement("h3");
  placementTitle.textContent = "Unit Placement";
  const placementActions = document.createElement("div");
  placementActions.className = "fx-lab-inline-actions";
  const placeFirefighterButton = document.createElement("button");
  placeFirefighterButton.type = "button";
  placeFirefighterButton.textContent = "Place Firefighter";
  const placeTruckButton = document.createElement("button");
  placeTruckButton.type = "button";
  placeTruckButton.textContent = "Place Truck";
  const clearPlacementButton = document.createElement("button");
  clearPlacementButton.type = "button";
  clearPlacementButton.textContent = "Clear Placement";
  placementActions.append(placeFirefighterButton, placeTruckButton, clearPlacementButton);
  const placementNote = document.createElement("p");
  placementNote.className = "fx-lab-section-note";
  placementSection.append(placementTitle, placementActions, placementNote);
  panel.appendChild(placementSection);

  const spraySection = document.createElement("section");
  spraySection.className = "fx-lab-section";
  const sprayTitle = document.createElement("h3");
  sprayTitle.textContent = "Manual Spray";
  const sprayActions = document.createElement("div");
  sprayActions.className = "fx-lab-inline-actions";
  const sprayToggleButton = document.createElement("button");
  sprayToggleButton.type = "button";
  sprayToggleButton.textContent = "Force Spray";
  const placeSprayTargetButton = document.createElement("button");
  placeSprayTargetButton.type = "button";
  placeSprayTargetButton.textContent = "Place Spray Target";
  const clearSprayTargetButton = document.createElement("button");
  clearSprayTargetButton.type = "button";
  clearSprayTargetButton.textContent = "Clear Spray Target";
  sprayActions.append(sprayToggleButton, placeSprayTargetButton, clearSprayTargetButton);
  const sprayModeLabel = document.createElement("label");
  sprayModeLabel.className = "fx-lab-inline-field";
  const sprayModeText = document.createElement("span");
  sprayModeText.textContent = "Spray Mode";
  const sprayModeSelect = document.createElement("select");
  sprayModeSelect.className = "fx-lab-select";
  ([
    { value: "precision", label: "Precision" },
    { value: "balanced", label: "Balanced" },
    { value: "suppression", label: "Suppression" }
  ] as const).forEach((option) => {
    const entry = document.createElement("option");
    entry.value = option.value;
    entry.textContent = option.label;
    sprayModeSelect.appendChild(entry);
  });
  sprayModeLabel.append(sprayModeText, sprayModeSelect);
  const sprayNote = document.createElement("p");
  sprayNote.className = "fx-lab-section-note";
  spraySection.append(sprayTitle, sprayActions, sprayModeLabel, sprayNote);
  panel.appendChild(spraySection);

  const waterSection = document.createElement("section");
  waterSection.className = "fx-lab-section";
  const waterTitle = document.createElement("h3");
  waterTitle.textContent = "Water Controls";
  const waterControlsRoot = document.createElement("div");
  waterControlsRoot.className = "fx-lab-controls";
  const waterResetButton = document.createElement("button");
  waterResetButton.type = "button";
  waterResetButton.textContent = "Reset Water";
  waterResetButton.className = "fx-lab-section-button";
  waterSection.append(waterTitle, waterControlsRoot, waterResetButton);
  panel.appendChild(waterSection);

  const fireSection = document.createElement("section");
  fireSection.className = "fx-lab-section";
  const fireTitle = document.createElement("h3");
  fireTitle.textContent = "Fire Controls";
  const fireControlsRoot = document.createElement("div");
  fireControlsRoot.className = "fx-lab-controls";
  const fireResetButton = document.createElement("button");
  fireResetButton.type = "button";
  fireResetButton.textContent = "Reset Fire";
  fireResetButton.className = "fx-lab-section-button";
  fireSection.append(fireTitle, fireControlsRoot, fireResetButton);
  panel.appendChild(fireSection);

  const exportSection = document.createElement("section");
  exportSection.className = "fx-lab-section";
  const exportTitle = document.createElement("h3");
  exportTitle.textContent = "Override Payload";
  const exportActions = document.createElement("div");
  exportActions.className = "fx-lab-inline-actions";
  const resetAllButton = document.createElement("button");
  resetAllButton.type = "button";
  resetAllButton.textContent = "Reset All";
  const copyButton = document.createElement("button");
  copyButton.type = "button";
  copyButton.textContent = "Copy Override Payload";
  exportActions.append(resetAllButton, copyButton);
  const exportStatus = document.createElement("p");
  exportStatus.className = "fx-lab-section-note";
  exportStatus.textContent = "Only non-default keys are exported.";
  const payloadPreview = document.createElement("textarea");
  payloadPreview.className = "fx-lab-payload";
  payloadPreview.readOnly = true;
  exportSection.append(exportTitle, exportActions, exportStatus, payloadPreview);
  panel.appendChild(exportSection);

  const fireBindings = new Map<keyof FireFxDebugControls & string, ControlBinding>();
  const waterBindings = new Map<keyof WaterFxDebugControls & string, ControlBinding>();

  const createRangeRow = <K extends string>(
    container: HTMLElement,
    label: string,
    description: string,
    min: number,
    max: number,
    step: number,
    onChange: (value: number) => void
  ): ControlBinding => {
    const row = document.createElement("div");
    row.className = "fx-lab-control";
    const heading = document.createElement("div");
    heading.className = "fx-lab-control-heading";
    const titleText = document.createElement("span");
    titleText.textContent = label;
    const valueText = document.createElement("strong");
    heading.append(titleText, valueText);
    const desc = document.createElement("p");
    desc.className = "fx-lab-control-description";
    desc.textContent = description;
    const range = document.createElement("input");
    range.type = "range";
    range.min = `${min}`;
    range.max = `${max}`;
    range.step = `${step}`;
    range.className = "fx-lab-range";
    const number = document.createElement("input");
    number.type = "number";
    number.min = `${min}`;
    number.max = `${max}`;
    number.step = `${step}`;
    number.className = "fx-lab-number";
    const inputs = document.createElement("div");
    inputs.className = "fx-lab-control-inputs";
    inputs.append(range, number);
    const commit = (raw: number): void => {
      const value = Math.max(min, Math.min(max, raw));
      range.value = `${value}`;
      number.value = `${value}`;
      valueText.textContent = formatValue(value, step);
      onChange(value);
    };
    range.addEventListener("input", () => {
      commit(Number(range.value));
    });
    number.addEventListener("input", () => {
      if (!Number.isFinite(Number(number.value))) {
        return;
      }
      commit(Number(number.value));
    });
    row.append(heading, desc, inputs);
    container.appendChild(row);
    return {
      apply: (value) => {
        const next = Number(value);
        range.value = `${next}`;
        number.value = `${next}`;
        valueText.textContent = formatValue(next, step);
      }
    };
  };

  const createBooleanRow = (container: HTMLElement, label: string, description: string, onChange: (value: boolean) => void): ControlBinding => {
    const row = document.createElement("div");
    row.className = "fx-lab-control";
    const heading = document.createElement("div");
    heading.className = "fx-lab-control-heading";
    const titleText = document.createElement("span");
    titleText.textContent = label;
    const valueText = document.createElement("strong");
    heading.append(titleText, valueText);
    const desc = document.createElement("p");
    desc.className = "fx-lab-control-description";
    desc.textContent = description;
    const wrap = document.createElement("label");
    wrap.className = "fx-lab-toggle";
    const input = document.createElement("input");
    input.type = "checkbox";
    const text = document.createElement("span");
    text.textContent = "Enabled";
    wrap.append(input, text);
    input.addEventListener("change", () => {
      valueText.textContent = input.checked ? "On" : "Off";
      onChange(input.checked);
    });
    row.append(heading, desc, wrap);
    container.appendChild(row);
    return {
      apply: (value) => {
        const checked = Boolean(value);
        input.checked = checked;
        valueText.textContent = checked ? "On" : "Off";
      }
    };
  };

  const createEnumRow = <V extends string>(
    container: HTMLElement,
    label: string,
    description: string,
    options: ReadonlyArray<{ value: V; label: string }>,
    onChange: (value: V) => void
  ): ControlBinding => {
    const row = document.createElement("div");
    row.className = "fx-lab-control";
    const heading = document.createElement("div");
    heading.className = "fx-lab-control-heading";
    const titleText = document.createElement("span");
    titleText.textContent = label;
    const valueText = document.createElement("strong");
    heading.append(titleText, valueText);
    const desc = document.createElement("p");
    desc.className = "fx-lab-control-description";
    desc.textContent = description;
    const select = document.createElement("select");
    select.className = "fx-lab-select";
    options.forEach((option) => {
      const entry = document.createElement("option");
      entry.value = option.value;
      entry.textContent = option.label;
      select.appendChild(entry);
    });
    select.addEventListener("change", () => {
      const next = options.find((option) => option.value === select.value)?.value;
      if (!next) {
        return;
      }
      valueText.textContent = options.find((option) => option.value === next)?.label ?? next;
      onChange(next);
    });
    row.append(heading, desc, select);
    container.appendChild(row);
    return {
      apply: (value) => {
        const next = `${value}`;
        select.value = next;
        valueText.textContent = options.find((option) => option.value === next)?.label ?? next;
      }
    };
  };

  FX_LAB_FIRE_CONTROLS.forEach((definition) => {
    const key = definition.key;
    let binding: ControlBinding;
    if (definition.kind === "range") {
      binding = createRangeRow(
        fireControlsRoot,
        definition.label,
        definition.description,
        definition.min,
        definition.max,
        definition.step,
        (value) => {
          controller.setFireDebugControls({ [key]: value } as Partial<FireFxDebugControls>);
          sync();
        }
      );
    } else if (definition.kind === "boolean") {
      binding = createBooleanRow(fireControlsRoot, definition.label, definition.description, (value) => {
        controller.setFireDebugControls({ [key]: value } as Partial<FireFxDebugControls>);
        sync();
      });
    } else {
      binding = createEnumRow(fireControlsRoot, definition.label, definition.description, definition.options, (value) => {
        controller.setFireDebugControls({ [key]: value } as Partial<FireFxDebugControls>);
        sync();
      });
    }
    fireBindings.set(key, binding);
  });

  FX_LAB_WATER_CONTROLS.forEach((definition) => {
    const key = definition.key;
    let binding: ControlBinding;
    if (definition.kind === "range") {
      binding = createRangeRow(
        waterControlsRoot,
        definition.label,
        definition.description,
        definition.min,
        definition.max,
        definition.step,
        (value) => {
          controller.setWaterDebugControls({ [key]: value } as Partial<WaterFxDebugControls>);
          sync();
        }
      );
    } else {
      binding = createBooleanRow(waterControlsRoot, definition.label, definition.description, (value) => {
        controller.setWaterDebugControls({ [key]: value } as Partial<WaterFxDebugControls>);
        sync();
      });
    }
    waterBindings.set(key, binding);
  });

  const sync = (): void => {
    const currentScenario = controller.getScenario();
    const placementMode = controller.getPlacementMode();
    const manualSprayEnabled = controller.isManualSprayEnabled();
    const waterDebug = controller.getWaterDebugSnapshot();
    scenarioSelect.value = currentScenario;
    scenarioDescription.textContent =
      FX_LAB_SCENARIOS.find((scenario) => scenario.id === currentScenario)?.description ?? "";
    playPauseButton.textContent = controller.isPaused() ? "Play" : "Pause";
    const timeScale = controller.getTimeScale();
    const hasExactTimeScaleOption = Array.from(timeScaleSelect.options).some((option) => Number(option.value) === timeScale);
    if (!hasExactTimeScaleOption) {
      const option = document.createElement("option");
      option.value = `${timeScale}`;
      option.textContent = `${formatValue(timeScale, 0.01)}x`;
      timeScaleSelect.appendChild(option);
    }
    timeScaleSelect.value = `${timeScale}`;
    placeFirefighterButton.setAttribute("aria-pressed", `${placementMode === "firefighter"}`);
    placeTruckButton.setAttribute("aria-pressed", `${placementMode === "truck"}`);
    clearPlacementButton.setAttribute("aria-pressed", "false");
    placementNote.textContent =
      placementMode === "firefighter"
        ? "Click the terrain to move the firefighter. Camera orbit is paused until you leave placement mode."
        : placementMode === "truck"
          ? "Click the terrain to move the truck. Camera orbit is paused until you leave placement mode."
          : "Click a placement button, then click the terrain to override unit position. Scenario switch and restart clear overrides.";
    sprayToggleButton.setAttribute("aria-pressed", `${manualSprayEnabled}`);
    placeSprayTargetButton.setAttribute("aria-pressed", `${placementMode === "spray-target"}`);
    clearSprayTargetButton.setAttribute("aria-pressed", "false");
    sprayModeSelect.value = controller.getManualSprayMode();
    sprayNote.textContent = manualSprayEnabled
      ? `Preview active. Streams ${waterDebug.streamCount}, body ${waterDebug.streamBodyCount}, core ${waterDebug.jetCoreCount}, mist ${waterDebug.mistShellCount}, impact ${waterDebug.impactCount}, breakup ${waterDebug.breakupCount}.${controller.hasManualSprayTarget() ? " Using placed spray target." : " Using auto target."}`
      : controller.hasManualSprayTarget()
        ? "A spray target is placed. Enable Force Spray to render water toward it."
        : "Enable Force Spray to test hose FX without gameplay logic, or place a spray target on the terrain.";
    const fireControls = controller.getFireDebugControls();
    FX_LAB_FIRE_CONTROLS.forEach((definition) => {
      fireBindings.get(definition.key)?.apply(fireControls[definition.key]);
    });
    const waterControls = controller.getWaterDebugControls();
    FX_LAB_WATER_CONTROLS.forEach((definition) => {
      waterBindings.get(definition.key)?.apply(waterControls[definition.key]);
    });
    payloadPreview.value = controller.getOverridePayloadText();
  };

  scenarioSelect.addEventListener("change", () => {
    controller.setScenario(scenarioSelect.value as FxLabScenarioId);
    sync();
  });
  playPauseButton.addEventListener("click", () => {
    controller.setPaused(!controller.isPaused());
    sync();
  });
  restartButton.addEventListener("click", () => {
    controller.restart();
    sync();
  });
  stepButton.addEventListener("click", () => {
    controller.step();
    sync();
  });
  timeScaleSelect.addEventListener("change", () => {
    controller.setTimeScale(Number(timeScaleSelect.value));
    sync();
  });
  const togglePlacementMode = (mode: FxLabPlacementMode): void => {
    controller.setPlacementMode(controller.getPlacementMode() === mode ? "none" : mode);
    sync();
  };
  placeFirefighterButton.addEventListener("click", () => {
    togglePlacementMode("firefighter");
  });
  placeTruckButton.addEventListener("click", () => {
    togglePlacementMode("truck");
  });
  clearPlacementButton.addEventListener("click", () => {
    controller.setPlacementMode("none");
    controller.clearPlacementOverrides();
    sync();
  });
  sprayToggleButton.addEventListener("click", () => {
    controller.setManualSprayEnabled(!controller.isManualSprayEnabled());
    sync();
  });
  placeSprayTargetButton.addEventListener("click", () => {
    togglePlacementMode("spray-target");
  });
  clearSprayTargetButton.addEventListener("click", () => {
    controller.setPlacementMode("none");
    controller.clearManualSprayTarget();
    sync();
  });
  sprayModeSelect.addEventListener("change", () => {
    controller.setManualSprayMode(sprayModeSelect.value as WaterSprayMode);
    sync();
  });
  fireResetButton.addEventListener("click", () => {
    controller.resetFireDebugControls();
    sync();
  });
  waterResetButton.addEventListener("click", () => {
    controller.resetWaterDebugControls();
    sync();
  });
  resetAllButton.addEventListener("click", () => {
    controller.resetAllDebugControls();
    sync();
  });
  copyButton.addEventListener("click", async () => {
    payloadPreview.value = controller.getOverridePayloadText();
    try {
      await navigator.clipboard.writeText(payloadPreview.value);
      exportStatus.textContent = "Override payload copied to clipboard.";
    } catch {
      exportStatus.textContent = "Clipboard write failed. Payload is still shown below.";
    }
  });

  sync();

  return {
    destroy: () => {
      root.remove();
    },
    sync
  };
};
