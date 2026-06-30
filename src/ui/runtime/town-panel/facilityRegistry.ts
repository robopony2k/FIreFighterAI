import type { WorldState } from "../../../core/state.js";
import type { Town } from "../../../core/types.js";
import { ensureDefaultSquads, isHeadquartersTown } from "../../../systems/units/index.js";
import { buildHqFacilityDescriptor, renderHqFacilityContent } from "./hqFacilityContent.js";
import type { TownFacilityDefinition, TownFacilityDescriptor } from "./types.js";

export const TOWN_FACILITY_DEFINITIONS: readonly TownFacilityDefinition[] = [
  {
    type: "hq",
    collect: (world: WorldState, town: Town): TownFacilityDescriptor | null => {
      if (!isHeadquartersTown(world, town.id)) {
        return null;
      }
      ensureDefaultSquads(world);
      return buildHqFacilityDescriptor(world, town.id);
    },
    renderContent: renderHqFacilityContent
  }
];

export const collectTownFacilities = (world: WorldState, town: Town): TownFacilityDescriptor[] =>
  TOWN_FACILITY_DEFINITIONS.flatMap((definition) => {
    const facility = definition.collect(world, town);
    return facility ? [facility] : [];
  });

export const getTownFacilityDefinition = (facility: TownFacilityDescriptor): TownFacilityDefinition | null =>
  TOWN_FACILITY_DEFINITIONS.find((definition) => definition.type === facility.type) ?? null;
