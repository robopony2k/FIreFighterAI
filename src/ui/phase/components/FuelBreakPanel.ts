export type FuelBreakPanelData = {
  active: boolean;
  costPerTile: string;
  toolLabel: string;
};

export type FuelBreakPanelView = {
  element: HTMLElement;
  update: (data: FuelBreakPanelData) => void;
};

export const createFuelBreakPanel = (): FuelBreakPanelView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-card";
  element.dataset.panel = "fuelBreak";

  const title = document.createElement("div");
  title.className = "phase-card-title";
  title.textContent = "Fuel Breaks";

  const toggle = document.createElement("button");
  toggle.className = "phase-action";
  toggle.dataset.action = "toggle-fuel-break";

  const info = document.createElement("div");
  info.className = "phase-card-summary";

  element.append(title, toggle, info);

  return {
    element,
    update: (data) => {
      toggle.textContent = data.active ? "Fuel Break Mode On" : "Fuel Break Mode Off";
      toggle.classList.toggle("is-active", data.active);
      info.textContent = `${data.toolLabel} - Cost ${data.costPerTile} per tile`;
    }
  };
};
