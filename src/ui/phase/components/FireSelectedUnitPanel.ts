import type { Formation } from "../../../core/types.js";
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
    <button class="phase-action" data-action="backburn">Fuel Break</button>
  `;

  const formationActions = document.createElement("div");
  formationActions.className = "phase-action-row";
  formationActions.innerHTML = `
    <div class="phase-action-label">Formation:</div>
    <button class="phase-action" data-action="formation-narrow" data-formation="narrow">Narrow</button>
    <button class="phase-action" data-action="formation-medium" data-formation="medium">Medium</button>
    <button class="phase-action" data-action="formation-wide" data-formation="wide">Wide</button>
  `;

  element.append(title, summary, actions, formationActions);

  const formationButtons = formationActions.querySelectorAll<HTMLButtonElement>("[data-formation]");

  return {
    element,
    update: (data) => {
      let formation: Formation | null = null;
      if (data.selection.kind === "unit") {
        summary.textContent = `Unit ${data.selection.id} - ${data.selection.unitType}`;
        const isTruck = data.selection.unitType === "truck";
        actions.classList.toggle("hidden", !isTruck);
        formationActions.classList.toggle("hidden", !isTruck);
        if (isTruck && data.selection.crewFormation) {
          formation = data.selection.crewFormation;
        }
      } else {
        summary.textContent = "Select a unit to see actions.";
        actions.classList.add("hidden");
        formationActions.classList.add("hidden");
      }

      formationButtons.forEach((button) => {
        button.classList.toggle("is-active", button.dataset.formation === formation);
      });
    }
  };
};
