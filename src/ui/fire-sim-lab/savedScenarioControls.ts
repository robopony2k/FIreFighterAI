import type { FireSimLabSession } from "../../systems/fire/sim/fireSimLabSession.js";
import {
  createFireSimLabSavedScenarioId,
  deleteFireSimLabSavedScenario,
  loadFireSimLabSavedScenarios,
  upsertFireSimLabSavedScenario,
  type FireSimLabSavedScenario
} from "./scenarioStorage.js";

export type FireSimLabSavedScenarioControls = {
  element: HTMLElement;
  refresh: () => void;
};

export type FireSimLabSavedScenarioControlOptions = {
  session: FireSimLabSession;
  onLoad: () => void;
  onChange: () => void;
};

const formatScenarioOption = (scenario: FireSimLabSavedScenario): string => {
  const date = new Date(scenario.updatedAt);
  const savedAt = Number.isFinite(date.getTime()) ? date.toLocaleString() : scenario.updatedAt;
  return `${scenario.name} - ${scenario.snapshot.grid.cols}x${scenario.snapshot.grid.rows} - ${savedAt}`;
};

export const createFireSimLabSavedScenarioControls = ({
  session,
  onLoad,
  onChange
}: FireSimLabSavedScenarioControlOptions): FireSimLabSavedScenarioControls => {
  let scenarios = loadFireSimLabSavedScenarios();
  let selectedScenarioId = "";

  const root = document.createElement("div");
  root.className = "fire-sim-lab-saved-scenarios";

  const subhead = document.createElement("div");
  subhead.className = "fire-sim-lab-subhead";
  const label = document.createElement("span");
  label.textContent = "Saved Scenarios";
  subhead.appendChild(label);

  const select = document.createElement("select");
  select.className = "fire-sim-lab-select";
  select.title = "Load a locally saved SIM Lab terrain/fire test scenario.";

  const nameInput = document.createElement("input");
  nameInput.className = "fire-sim-lab-text-input";
  nameInput.type = "text";
  nameInput.maxLength = 48;
  nameInput.placeholder = "Scenario name";
  nameInput.title = "Name used when saving the current painted grid, environment, fuel profiles, and fire state.";

  const actions = document.createElement("div");
  actions.className = "fire-sim-lab-actions";
  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.textContent = "Save";
  const loadButton = document.createElement("button");
  loadButton.type = "button";
  loadButton.textContent = "Load";
  const deleteButton = document.createElement("button");
  deleteButton.type = "button";
  deleteButton.textContent = "Delete";
  actions.append(saveButton, loadButton, deleteButton);

  const status = document.createElement("div");
  status.className = "fire-sim-lab-status";
  status.textContent = "Save captures terrain, environment, heat, and active fire. Fuel drafts stay live.";
  root.append(subhead, select, nameInput, actions, status);

  const findSelectedScenario = (): FireSimLabSavedScenario | null =>
    scenarios.find((scenario) => scenario.id === selectedScenarioId) ?? null;

  const syncButtons = (): void => {
    const hasSelection = !!findSelectedScenario();
    loadButton.disabled = !hasSelection;
    deleteButton.disabled = !hasSelection;
  };

  const refresh = (): void => {
    scenarios = loadFireSimLabSavedScenarios();
    const currentSelection = selectedScenarioId;
    select.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = scenarios.length > 0 ? "Select saved scenario" : "No saved scenarios yet";
    placeholder.disabled = scenarios.length === 0;
    select.appendChild(placeholder);
    scenarios.forEach((scenario) => {
      const option = document.createElement("option");
      option.value = scenario.id;
      option.textContent = formatScenarioOption(scenario);
      select.appendChild(option);
    });
    selectedScenarioId = scenarios.some((scenario) => scenario.id === currentSelection) ? currentSelection : "";
    select.value = selectedScenarioId;
    syncButtons();
  };

  select.addEventListener("change", () => {
    selectedScenarioId = select.value;
    const selected = findSelectedScenario();
    if (selected) {
      nameInput.value = selected.name;
      status.textContent = `Selected "${selected.name}".`;
    }
    syncButtons();
  });

  saveButton.addEventListener("click", () => {
    const name = nameInput.value.trim();
    if (!name) {
      status.textContent = "Enter a scenario name before saving.";
      return;
    }
    const now = new Date().toISOString();
    const selected = findSelectedScenario();
    const saved: FireSimLabSavedScenario = {
      id: selected?.id ?? createFireSimLabSavedScenarioId(),
      name,
      createdAt: selected?.createdAt ?? now,
      updatedAt: now,
      snapshot: session.getScenarioSnapshot()
    };
    scenarios = upsertFireSimLabSavedScenario(saved);
    selectedScenarioId = saved.id;
    refresh();
    select.value = selectedScenarioId;
    status.textContent = `Saved "${name}".`;
    onChange();
  });

  loadButton.addEventListener("click", () => {
    const selected = findSelectedScenario();
    if (!selected) {
      status.textContent = "Select a saved scenario to load.";
      return;
    }
    const result = session.loadScenarioSnapshot(selected.snapshot);
    if (!result.ok) {
      status.textContent = result.message;
      return;
    }
    nameInput.value = selected.name;
    status.textContent = `Loaded "${selected.name}".`;
    onLoad();
    onChange();
  });

  deleteButton.addEventListener("click", () => {
    const selected = findSelectedScenario();
    if (!selected) {
      status.textContent = "Select a saved scenario to delete.";
      return;
    }
    scenarios = deleteFireSimLabSavedScenario(selected.id);
    selectedScenarioId = "";
    refresh();
    status.textContent = `Deleted "${selected.name}".`;
    onChange();
  });

  refresh();

  return {
    element: root,
    refresh
  };
};
