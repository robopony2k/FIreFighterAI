import { WATER_TOWER_DRY_REFILL_RATE, WATER_TOWER_RAIN_REFILL_RATE } from "../../../systems/settlements/constants/waterTowerConstants.js";
import { getWaterTowerForTown } from "../../../systems/settlements/sim/waterTowerInfrastructure.js";
import type { TownFacilityDescriptor, TownFacilityRenderContext } from "./types.js";

export const getWaterTowerFacilityId = (townId: number): string => `water-tower:${townId}`;

export const buildWaterTowerFacilityDescriptor = (world: TownFacilityRenderContext["world"], townId: number): TownFacilityDescriptor | null => {
  const tower = getWaterTowerForTown(world, townId);
  if (!tower) {
    return null;
  }
  const ratio = tower.capacity > 0 ? tower.water / tower.capacity : 0;
  return {
    id: getWaterTowerFacilityId(townId),
    type: "waterTower",
    townId,
    name: "Water Tower",
    icon: "H2O",
    summary: `${Math.round(ratio * 100)}% stored - refill radius ${tower.serviceRadius.toFixed(1)}`,
    warning: tower.water <= 0.01 ? "Reservoir empty" : null
  };
};

const getWaterTowerContentRenderKey = (context: TownFacilityRenderContext): string => {
  const tower = getWaterTowerForTown(context.world, context.town.id);
  return JSON.stringify({
    rain: context.world.seasonalRain?.active ? Math.round((context.world.seasonalRain.intensity01 ?? 0) * 100) : 0,
    tower: tower
      ? {
          id: tower.id,
          active: tower.active,
          water: Math.round(tower.water * 10),
          capacity: tower.capacity,
          serviceRadius: tower.serviceRadius
        }
      : null
  });
};

export const renderWaterTowerFacilityContent = (root: HTMLElement, context: TownFacilityRenderContext): void => {
  const renderKey = getWaterTowerContentRenderKey(context);
  if (root.dataset.waterTowerRenderKey === renderKey && root.childElementCount > 0) {
    return;
  }
  root.dataset.waterTowerRenderKey = renderKey;
  root.replaceChildren();

  const tower = getWaterTowerForTown(context.world, context.town.id);
  const stats = document.createElement("div");
  stats.className = "three-test-hq-recruit-summary";
  if (!tower) {
    stats.append(Object.assign(document.createElement("span"), { textContent: "No tower built" }));
    root.appendChild(stats);
    return;
  }

  const ratio = tower.capacity > 0 ? tower.water / tower.capacity : 0;
  const rainIntensity = context.world.seasonalRain?.active ? Math.max(0, Math.min(1, context.world.seasonalRain.intensity01)) : 0;
  const refillRate = WATER_TOWER_DRY_REFILL_RATE + WATER_TOWER_RAIN_REFILL_RATE * rainIntensity;
  stats.append(
    Object.assign(document.createElement("span"), { textContent: `${Math.round(ratio * 100)}% stored` }),
    Object.assign(document.createElement("span"), { textContent: `${tower.water.toFixed(0)}/${tower.capacity.toFixed(0)} water` }),
    Object.assign(document.createElement("span"), { textContent: `Radius ${tower.serviceRadius.toFixed(1)}` }),
    Object.assign(document.createElement("span"), { textContent: `Refill +${refillRate.toFixed(1)}/d` })
  );

  const hint = document.createElement("div");
  hint.className = "three-test-hq-empty";
  hint.textContent = "Nearby stopped trucks draw from this reservoir before using rivers or lakes.";
  root.append(stats, hint);
};
