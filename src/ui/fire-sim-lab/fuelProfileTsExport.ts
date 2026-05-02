import { FUEL_PROFILES } from "../../core/config.js";
import type { FuelProfile, TileType } from "../../core/types.js";

const TILE_TYPES = Object.keys(FUEL_PROFILES) as TileType[];
const PROFILE_FIELDS: Array<keyof FuelProfile> = [
  "baseFuel",
  "ignition",
  "burnRate",
  "heatOutput",
  "spreadBoost",
  "heatTransferCap",
  "heatRetention",
  "windFactor"
];

const formatNumber = (value: number): string =>
  `${Number(value.toFixed(4))}`;

export const buildFuelProfileDefaultsSource = (profiles: Record<TileType, FuelProfile>): string => {
  const lines = [
    "import type { FuelProfile, TileType } from \"../core/types.js\";",
    "",
    "export const TILE_FUEL_PROFILES: Record<TileType, FuelProfile> = {"
  ];
  TILE_TYPES.forEach((type, typeIndex) => {
    lines.push(`  ${type}: {`);
    PROFILE_FIELDS.forEach((field, fieldIndex) => {
      const suffix = fieldIndex === PROFILE_FIELDS.length - 1 ? "" : ",";
      lines.push(`    ${field}: ${formatNumber(profiles[type][field])}${suffix}`);
    });
    lines.push(`  }${typeIndex === TILE_TYPES.length - 1 ? "" : ","}`);
  });
  lines.push("};", "");
  return lines.join("\n");
};
