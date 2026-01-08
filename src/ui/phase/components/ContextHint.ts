import type { InteractionMode, Phase, SelectedEntity } from "../types.js";

export type ContextHintData = {
  phase: Phase;
  selection: SelectedEntity;
  interactionMode: InteractionMode;
  focus: string;
};

export type ContextHintView = {
  element: HTMLElement;
  update: (data: ContextHintData) => void;
};

const selectionHint = (selection: SelectedEntity): string | null => {
  if (selection.kind === "unit") {
    return selection.unitType === "truck"
      ? "Truck selected. Crew actions available."
      : "Firefighter selected. Retask within truck range.";
  }
  return null;
};

export const createContextHint = (): ContextHintView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-hint";
  element.dataset.panel = "contextHint";

  const title = document.createElement("div");
  title.className = "phase-hint-title";
  title.textContent = "Commander Notes";

  const body = document.createElement("div");
  body.className = "phase-hint-body";

  element.append(title, body);

  return {
    element,
    update: (data) => {
      const parts = [data.focus];
      const selection = selectionHint(data.selection);
      if (selection) {
        parts.push(selection);
      }
      if (data.interactionMode === "fuelBreak") {
        parts.push("Fuel break tool active.");
      }
      if (data.interactionMode === "formation") {
        parts.push("Formation line active.");
      }
      body.textContent = parts.join(" ");
    }
  };
};
