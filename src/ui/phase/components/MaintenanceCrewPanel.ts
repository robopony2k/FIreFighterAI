export type CrewPanelData = {
  summary: string;
  hint: string;
  selectionLabel: string;
  trucks: Array<{ id: number; name: string; crewCount: number; capacity: number; disabled: boolean }>;
  selectedTruckId: number | null;
  selectedRosterId: number | null;
  selectEnabled: boolean;
  assignEnabled: boolean;
  unassignEnabled: boolean;
  showAssignControls: boolean;
  crewList: string[];
};

export type MaintenanceCrewPanelView = {
  element: HTMLElement;
  update: (data: CrewPanelData) => void;
};

export const createMaintenanceCrewPanel = (): MaintenanceCrewPanelView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-card";
  element.dataset.panel = "maintenanceCrew";

  const title = document.createElement("div");
  title.className = "phase-card-title";
  title.textContent = "Crew Planning";

  const summary = document.createElement("div");
  summary.className = "phase-card-summary";

  const hint = document.createElement("div");
  hint.className = "phase-card-summary";

  const list = document.createElement("div");
  list.className = "phase-list";

  const selection = document.createElement("div");
  selection.className = "phase-crew-selection";

  const selectionLabel = document.createElement("div");
  selectionLabel.className = "phase-crew-label";

  const selectWrap = document.createElement("label");
  selectWrap.className = "phase-crew-select";
  selectWrap.textContent = "Assign to truck";

  const select = document.createElement("select");
  select.dataset.role = "crew-assign-select";
  selectWrap.appendChild(select);

  const actions = document.createElement("div");
  actions.className = "phase-action-row";
  const assign = document.createElement("button");
  assign.className = "phase-action";
  assign.dataset.action = "crew-assign";
  assign.textContent = "Assign";
  const unassign = document.createElement("button");
  unassign.className = "phase-action";
  unassign.dataset.action = "crew-unassign";
  unassign.textContent = "Unassign";
  actions.append(assign, unassign);

  const crewList = document.createElement("div");
  crewList.className = "phase-list";

  selection.append(selectionLabel, selectWrap, actions, crewList);

  element.append(title, summary, list, hint, selection);

  let pendingSelection: string | null = null;
  let lastRosterId: number | null = null;
  let lastAssignEnabled = false;
  let lastUnassignEnabled = false;
  let lastSelectEnabled = false;
  let lastShowAssignControls = false;

  const syncActionState = (): void => {
    select.disabled = !lastSelectEnabled;
    actions.classList.toggle("hidden", !lastShowAssignControls);
    assign.disabled = !lastAssignEnabled || !select.value;
    unassign.disabled = !lastUnassignEnabled;
  };

  select.addEventListener("change", () => {
    pendingSelection = select.value || null;
    syncActionState();
  });

  return {
    element,
    update: (data) => {
      summary.textContent = data.summary;
      list.innerHTML = "";
      data.trucks.forEach((truck) => {
        const row = document.createElement("div");
        row.className = "phase-list-row";
        row.textContent = `${truck.name} - ${truck.crewCount}/${truck.capacity}`;
        list.appendChild(row);
      });
      hint.textContent = data.hint;
      selectionLabel.textContent = data.selectionLabel;
      select.innerHTML = "";
      const defaultOption = document.createElement("option");
      defaultOption.value = "";
      defaultOption.textContent = data.trucks.length > 0 ? "Choose a truck" : "No trucks available";
      select.appendChild(defaultOption);
      const truckIds = new Set<string>();
      data.trucks.forEach((truck) => {
        truckIds.add(truck.id.toString());
        const option = document.createElement("option");
        option.value = truck.id.toString();
        option.textContent = `${truck.name} (${truck.crewCount}/${truck.capacity})`;
        option.disabled = truck.disabled;
        select.appendChild(option);
      });
      if (data.selectedRosterId !== lastRosterId) {
        pendingSelection = null;
        lastRosterId = data.selectedRosterId;
      }
      const explicitSelection = data.selectedTruckId !== null ? data.selectedTruckId.toString() : null;
      if (explicitSelection && truckIds.has(explicitSelection)) {
        pendingSelection = explicitSelection;
      }
      const resolvedSelection = pendingSelection && truckIds.has(pendingSelection) ? pendingSelection : "";
      if (!resolvedSelection) {
        pendingSelection = null;
      }
      select.value = resolvedSelection;
      lastAssignEnabled = data.assignEnabled;
      lastUnassignEnabled = data.unassignEnabled;
      lastSelectEnabled = data.selectEnabled;
      lastShowAssignControls = data.showAssignControls;
      syncActionState();
      crewList.innerHTML = "";
      if (data.crewList.length === 0) {
        const empty = document.createElement("div");
        empty.className = "phase-list-row phase-list-muted";
        empty.textContent = "No crew assigned.";
        crewList.appendChild(empty);
      } else {
        data.crewList.forEach((name) => {
          const item = document.createElement("div");
          item.className = "phase-list-row";
          item.textContent = name;
          crewList.appendChild(item);
        });
      }
    }
  };
};
