import type { SelectedEntity } from "../types.js";

export type FireSelectedUnitData = {
  selection: SelectedEntity;
};

export type FireSelectedUnitView = {
  element: HTMLElement;
  update: (data: FireSelectedUnitData) => void;
};

export const createFireSelectedUnitPanel = (): FireSelectedUnitView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-card";
  element.dataset.panel = "fireSelectedUnit";

  const title = document.createElement("div");
  title.className = "phase-card-title";
  title.textContent = "Selected Unit";

  const summary = document.createElement("div");
  summary.className = "phase-card-summary";

  const actions = document.createElement("div");
  actions.className = "phase-action-row";
  actions.innerHTML = `
    <button class="phase-action" data-action="crew-board">Board Crew</button>
    <button class="phase-action" data-action="crew-deploy">Deploy Crew</button>
  `;

  element.append(title, summary, actions);

  return {
    element,
    update: (data) => {
      if (data.selection.kind === "unit") {
        summary.textContent = `Unit ${data.selection.id} - ${data.selection.unitType}`;
        actions.classList.toggle("hidden", data.selection.unitType !== "truck");
      } else {
        summary.textContent = "Select a unit to see actions.";
        actions.classList.add("hidden");
      }
    }
  };
};
