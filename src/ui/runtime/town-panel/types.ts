import type { WorldState } from "../../../core/state.js";
import type { Town } from "../../../core/types.js";

export type TownFacilityType = "hq";
export type TownFacilityTabId = "squads" | "recruit" | "training";

export type TownFacilityDescriptor = {
  id: string;
  type: TownFacilityType;
  townId: number;
  name: string;
  icon: string;
  summary: string;
  warning: string | null;
};

export type TownFacilityRenderContext = {
  world: WorldState;
  town: Town;
  facility: TownFacilityDescriptor;
  activeTabId: TownFacilityTabId;
  dispatchAction: (action: string, payload?: Record<string, string>) => void;
  onTabChange: (tabId: TownFacilityTabId) => void;
};

export type TownFacilityDefinition = {
  type: TownFacilityType;
  collect: (world: WorldState, town: Town) => TownFacilityDescriptor | null;
  renderContent: (root: HTMLElement, context: TownFacilityRenderContext) => void;
};

export type SelectedTownFacility = {
  townId: number;
  facilityId: string;
};
