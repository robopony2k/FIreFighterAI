import type { WorldState } from "../../../core/state.js";
import type { Town } from "../../../core/types.js";
import { getTownFacilityDefinition } from "./facilityRegistry.js";
import type { TownFacilityDescriptor, TownFacilityTabId } from "./types.js";

export type FacilityPanelElements = {
  root: HTMLDivElement;
  icon: HTMLSpanElement;
  title: HTMLSpanElement;
  status: HTMLDivElement;
  warning: HTMLDivElement;
  content: HTMLDivElement;
  closeButton: HTMLButtonElement;
};

export const createFacilityPanel = (): FacilityPanelElements => {
  const root = document.createElement("div");
  root.className = "three-test-facility-panel hidden";
  const header = document.createElement("div");
  header.className = "three-test-facility-panel-header";
  const titleLine = document.createElement("div");
  titleLine.className = "three-test-facility-title-line";
  const icon = document.createElement("span");
  icon.className = "three-test-town-facility-icon";
  const title = document.createElement("span");
  title.className = "three-test-facility-title";
  titleLine.append(icon, title);
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "three-test-town-card-close";
  closeButton.textContent = "x";
  closeButton.title = "Close facility";
  closeButton.setAttribute("aria-label", "Close facility panel");
  header.append(titleLine, closeButton);
  const status = document.createElement("div");
  status.className = "three-test-facility-status";
  const warning = document.createElement("div");
  warning.className = "three-test-facility-warning hidden";
  const content = document.createElement("div");
  content.className = "three-test-facility-content";
  root.append(header, status, warning, content);
  return { root, icon, title, status, warning, content, closeButton };
};

export const renderFacilityPanel = (
  elements: FacilityPanelElements,
  world: WorldState,
  town: Town,
  facility: TownFacilityDescriptor,
  activeTabId: TownFacilityTabId,
  dispatchAction: (action: string, payload?: Record<string, string>) => void,
  onTabChange: (tabId: TownFacilityTabId) => void
): void => {
  const definition = getTownFacilityDefinition(facility);
  elements.root.classList.remove("hidden");
  elements.icon.textContent = facility.icon;
  elements.title.textContent = facility.name;
  elements.status.textContent = facility.summary;
  elements.warning.textContent = facility.warning ?? "";
  elements.warning.classList.toggle("hidden", !facility.warning);
  if (!definition) {
    elements.content.replaceChildren();
    return;
  }
  definition.renderContent(elements.content, {
    world,
    town,
    facility,
    activeTabId,
    dispatchAction,
    onTabChange
  });
};
