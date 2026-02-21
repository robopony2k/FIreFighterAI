export type FireDeployPanelData = {
  trucks: Array<{
    id: number;
    name: string;
    crewCount: number;
    crewCapacity: number;
    crewMode: "boarded" | "deployed";
    hotkey: string;
    selected: boolean;
  }>;
  baseOpsOpen?: boolean;
  deployableFirefighters: number;
  availableTrucks: number;
  activeMode: "firefighter" | "truck" | null;
};

export type FireDeployPanelView = {
  element: HTMLElement;
  update: (data: FireDeployPanelData) => void;
};

export const createFireDeployPanel = (): FireDeployPanelView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-card phase-truck-dock";
  element.dataset.panel = "fireDeploy";

  const header = document.createElement("div");
  header.className = "phase-truck-header";

  const title = document.createElement("div");
  title.className = "phase-card-title";
  title.textContent = "Trucks";

  const baseButton = document.createElement("button");
  baseButton.className = "phase-base-action";
  baseButton.dataset.action = "focus-base";
  baseButton.textContent = "Base Ops";

  const hint = document.createElement("div");
  hint.className = "phase-card-summary";
  hint.textContent = "Hotkeys 1-0 select trucks.";

  const list = document.createElement("div");
  list.className = "phase-list phase-truck-list";

  const actions = document.createElement("div");
  actions.className = "phase-action-grid";

  const deployFirefighter = document.createElement("button");
  deployFirefighter.className = "phase-action";
  deployFirefighter.dataset.action = "deploy-firefighter";

  const deployTruck = document.createElement("button");
  deployTruck.className = "phase-action";
  deployTruck.dataset.action = "deploy-truck";

  const threeTestHint = document.createElement("div");
  threeTestHint.className = "phase-card-summary phase-three-test-hud-note";
  threeTestHint.textContent =
    "3D controls: left-click terrain to deploy/select/ignite, right-click to retask selected trucks.";

  actions.append(deployTruck, deployFirefighter);

  header.append(title, baseButton);
  element.append(header, hint, list, actions, threeTestHint);

  return {
    element,
    update: (data) => {
      const baseOpsOpen = data.baseOpsOpen ?? false;
      baseButton.classList.toggle("is-active", baseOpsOpen);
      baseButton.textContent = baseOpsOpen ? "Base Ops On" : "Base Ops";
      list.innerHTML = "";
      if (data.trucks.length === 0) {
        const empty = document.createElement("div");
        empty.className = "phase-list-row phase-list-muted";
        empty.textContent = "No active trucks.";
        list.appendChild(empty);
      } else {
        data.trucks.forEach((truck) => {
          const row = document.createElement("div");
          row.className = "phase-truck-row";
          row.dataset.action = "select-truck";
          row.dataset.truckId = truck.id.toString();
          row.classList.toggle("is-selected", truck.selected);
          const crewLabel = `Crew ${truck.crewCount}/${truck.crewCapacity} - ${truck.crewMode}`;
          row.innerHTML = `
            <div class="phase-truck-key">${truck.hotkey}</div>
            <div class="phase-truck-name">${truck.name}</div>
            <div class="phase-truck-meta">${crewLabel}</div>
          `;
          list.appendChild(row);
        });
      }
      deployFirefighter.textContent = `Deploy Crew (${data.deployableFirefighters})`;
      deployTruck.textContent = `Deploy Truck (${data.availableTrucks})`;
      deployFirefighter.disabled = data.deployableFirefighters <= 0;
      deployTruck.disabled = data.availableTrucks <= 0;
      deployFirefighter.classList.toggle("is-active", data.activeMode === "firefighter");
      deployTruck.classList.toggle("is-active", data.activeMode === "truck");
    }
  };
};
