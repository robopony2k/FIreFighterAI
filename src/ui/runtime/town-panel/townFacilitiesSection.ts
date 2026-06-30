import type { TownFacilityDescriptor } from "./types.js";

export type TownFacilitiesSectionElements = {
  root: HTMLDivElement;
  list: HTMLDivElement;
  lastRenderKey: string;
};

export const createTownFacilitiesSection = (): TownFacilitiesSectionElements => {
  const root = document.createElement("div");
  root.className = "three-test-town-facilities-section";
  const title = document.createElement("div");
  title.className = "three-test-town-facilities-title";
  title.textContent = "Facilities";
  const list = document.createElement("div");
  list.className = "three-test-town-facilities-list";
  root.append(title, list);
  return { root, list, lastRenderKey: "" };
};

const getFacilitiesRenderKey = (
  facilities: readonly TownFacilityDescriptor[],
  selectedFacilityId: string | null
): string =>
  JSON.stringify({
    selectedFacilityId,
    facilities: facilities.map((facility) => ({
      id: facility.id,
      type: facility.type,
      name: facility.name,
      icon: facility.icon,
      summary: facility.summary,
      warning: facility.warning
    }))
  });

export const renderTownFacilitiesSection = (
  elements: TownFacilitiesSectionElements,
  facilities: readonly TownFacilityDescriptor[],
  selectedFacilityId: string | null,
  onOpenFacility: (facility: TownFacilityDescriptor) => void
): void => {
  const renderKey = getFacilitiesRenderKey(facilities, selectedFacilityId);
  if (elements.lastRenderKey === renderKey) {
    return;
  }
  elements.lastRenderKey = renderKey;
  elements.list.replaceChildren();
  if (facilities.length === 0) {
    const empty = document.createElement("div");
    empty.className = "three-test-town-facilities-empty";
    empty.textContent = "No facilities";
    elements.list.appendChild(empty);
    return;
  }
  facilities.forEach((facility) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "three-test-town-facility-card";
    button.classList.toggle("is-selected", selectedFacilityId === facility.id);
    button.title = facility.warning ? `${facility.name}: ${facility.warning}` : facility.name;
    const icon = document.createElement("span");
    icon.className = "three-test-town-facility-icon";
    icon.textContent = facility.icon;
    const text = document.createElement("span");
    text.className = "three-test-town-facility-text";
    const name = document.createElement("span");
    name.className = "three-test-town-facility-name";
    name.textContent = facility.name;
    const summary = document.createElement("span");
    summary.className = "three-test-town-facility-summary";
    summary.textContent = facility.summary;
    text.append(name, summary);
    button.append(icon, text);
    if (facility.warning) {
      const warning = document.createElement("span");
      warning.className = "three-test-town-facility-warning";
      warning.textContent = "!";
      button.appendChild(warning);
    }
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onOpenFacility(facility);
    });
    elements.list.appendChild(button);
  });
};
