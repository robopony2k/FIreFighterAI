export type FireUnitGroup = {
  label: string;
  units: Array<{ name: string; status: string }>;
};

export type FireUnitListData = {
  groups: FireUnitGroup[];
};

export type FireUnitListView = {
  element: HTMLElement;
  update: (data: FireUnitListData) => void;
};

export const createFireUnitListPanel = (): FireUnitListView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-card";
  element.dataset.panel = "fireUnitList";

  const title = document.createElement("div");
  title.className = "phase-card-title";
  title.textContent = "Active Units";

  const list = document.createElement("div");
  list.className = "phase-list";

  element.append(title, list);

  return {
    element,
    update: (data) => {
      list.innerHTML = "";
      data.groups.forEach((group) => {
        const header = document.createElement("div");
        header.className = "phase-list-header";
        header.textContent = group.label;
        list.appendChild(header);
        if (group.units.length === 0) {
          const empty = document.createElement("div");
          empty.className = "phase-list-row phase-list-muted";
          empty.textContent = "None";
          list.appendChild(empty);
          return;
        }
        group.units.forEach((unit) => {
          const row = document.createElement("div");
          row.className = "phase-list-row";
          row.textContent = `${unit.name} - ${unit.status}`;
          list.appendChild(row);
        });
      });
    }
  };
};
