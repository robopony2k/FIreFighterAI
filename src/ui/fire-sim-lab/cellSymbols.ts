import type { TileType } from "../../core/types.js";
import { FIRE_SIM_LAB_FIREFIGHTER_SYMBOL } from "../../systems/fire/types/fireSimLabTypes.js";

export type FireSimLabCellSymbolState = "fire" | "igniting" | "hot" | "cooling" | "spent" | "firefighter";

export type FireSimLabCellSymbol = {
  symbol: string;
  state: FireSimLabCellSymbolState;
};

export type FireSimLabLegendItem = FireSimLabCellSymbol & {
  label: string;
  detail: string;
};

export const FIRE_SIM_LAB_LEGEND_ITEMS: readonly FireSimLabLegendItem[] = [
  {
    symbol: "\u{1F525}",
    state: "fire",
    label: "Burning",
    detail: "Active flame with strong heat output."
  },
  {
    symbol: "\u25B2",
    state: "igniting",
    label: "Igniting",
    detail: "Fresh flame or a weak fire front."
  },
  {
    symbol: "\u2668",
    state: "hot",
    label: "Hot",
    detail: "Stored heat can still ignite neighbors."
  },
  {
    symbol: "\u00B7",
    state: "cooling",
    label: "Cooling",
    detail: "Residual heat is fading."
  },
  {
    symbol: "\u2591",
    state: "spent",
    label: "Spent",
    detail: "Fuel is gone or the tile is ash."
  },
  {
    symbol: FIRE_SIM_LAB_FIREFIGHTER_SYMBOL,
    state: "firefighter",
    label: "Firefighter",
    detail: "Painted suppression marker using default firefighter radius, hose range, and power."
  }
];

const SPENT_FUEL_TYPES = new Set<TileType>(["grass", "scrub", "forest", "floodplain", "house"]);

export const getFireSimLabCellSymbol = (
  type: TileType,
  fire01: number,
  heat01: number,
  fuel: number
): FireSimLabCellSymbol | null => {
  if (fire01 > 0.18) {
    return FIRE_SIM_LAB_LEGEND_ITEMS[0]!;
  }
  if (fire01 > 0.01) {
    return FIRE_SIM_LAB_LEGEND_ITEMS[1]!;
  }
  if (heat01 > 0.22) {
    return FIRE_SIM_LAB_LEGEND_ITEMS[2]!;
  }
  if (heat01 > 0.045) {
    return FIRE_SIM_LAB_LEGEND_ITEMS[3]!;
  }
  if (type === "ash" || (fuel <= 0.01 && SPENT_FUEL_TYPES.has(type))) {
    return FIRE_SIM_LAB_LEGEND_ITEMS[4]!;
  }
  return null;
};
