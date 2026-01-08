export type RosterEntryData = {
  id: number;
  name: string;
  kind: "firefighter" | "truck";
  status: "available" | "deployed" | "lost";
  assignment: string;
  training: { speed: number; power: number; range: number; resilience: number };
};

export type MaintenanceRosterPanelData = {
  totalFirefighters: number;
  availableFirefighters: number;
  totalTrucks: number;
  availableTrucks: number;
  roster: RosterEntryData[];
  selectedId: number | null;
  recruitFirefighterCost: string;
  recruitTruckCost: string;
  trainingCost: string;
  canTrain: boolean;
};

export type MaintenanceRosterPanelView = {
  element: HTMLElement;
  update: (data: MaintenanceRosterPanelData) => void;
};

export const createMaintenanceRosterPanel = (): MaintenanceRosterPanelView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-card";
  element.dataset.panel = "maintenanceRoster";

  const title = document.createElement("div");
  title.className = "phase-card-title";
  title.textContent = "Roster";

  const summary = document.createElement("div");
  summary.className = "phase-card-summary";

  const actionRow = document.createElement("div");
  actionRow.className = "phase-action-grid";
  actionRow.innerHTML = `
    <button class="phase-action" data-action="recruit-firefighter">Recruit Firefighter</button>
    <button class="phase-action" data-action="recruit-truck">Recruit Truck</button>
  `;

  const list = document.createElement("div");
  list.className = "phase-roster-list";

  const training = document.createElement("div");
  training.className = "phase-action-grid";
  const trainSpeed = document.createElement("button");
  trainSpeed.className = "phase-action";
  trainSpeed.dataset.action = "train-speed";
  const trainPower = document.createElement("button");
  trainPower.className = "phase-action";
  trainPower.dataset.action = "train-power";
  const trainRange = document.createElement("button");
  trainRange.className = "phase-action";
  trainRange.dataset.action = "train-range";
  const trainResilience = document.createElement("button");
  trainResilience.className = "phase-action";
  trainResilience.dataset.action = "train-resilience";
  training.append(trainSpeed, trainPower, trainRange, trainResilience);

  element.append(title, summary, actionRow, list, training);

  return {
    element,
    update: (data) => {
      summary.textContent = `Firefighters ${data.availableFirefighters}/${data.totalFirefighters} - Trucks ${data.availableTrucks}/${data.totalTrucks}`;

      const recruitButtons = actionRow.querySelectorAll("button");
      if (recruitButtons.length >= 2) {
        recruitButtons[0].textContent = `Recruit Firefighter ${data.recruitFirefighterCost}`;
        recruitButtons[1].textContent = `Recruit Truck ${data.recruitTruckCost}`;
      }

      list.innerHTML = "";
      data.roster.forEach((entry) => {
        const row = document.createElement("button");
        row.type = "button";
        row.className = "phase-roster-item";
        row.dataset.action = "select-roster";
        row.dataset.rosterId = entry.id.toString();
        row.classList.toggle("is-selected", entry.id === data.selectedId);
        row.classList.toggle("is-lost", entry.status === "lost");
        const statusLabel = entry.status === "lost" ? "Lost" : entry.status === "deployed" ? "Deployed" : "Available";
        row.innerHTML = `
          <div class="phase-roster-title">${entry.name}</div>
          <div class="phase-roster-meta">${entry.kind} - ${statusLabel}</div>
          <div class="phase-roster-meta">${entry.assignment}</div>
          <div class="phase-roster-meta">Spd ${entry.training.speed} - Pow ${entry.training.power} - Rng ${entry.training.range} - Res ${entry.training.resilience}</div>
        `;
        list.appendChild(row);
      });

      training.classList.toggle("hidden", !data.canTrain);
      trainSpeed.textContent = `Train Speed ${data.trainingCost}`;
      trainPower.textContent = `Train Power ${data.trainingCost}`;
      trainRange.textContent = `Train Range ${data.trainingCost}`;
      trainResilience.textContent = `Train Resilience ${data.trainingCost}`;
    }
  };
};
