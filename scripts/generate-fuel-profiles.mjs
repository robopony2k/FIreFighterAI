import fs from "fs";
import path from "path";
import yaml from "yaml";

const inputPath = path.resolve("config/tile-profiles.yml");
const outputPath = path.resolve("src/core/generated/fuelProfiles.ts");
const tileTypes = [
  "water",
  "beach",
  "floodplain",
  "grass",
  "scrub",
  "forest",
  "rocky",
  "bare",
  "road",
  "base",
  "house",
  "firebreak",
  "ash"
];

const raw = fs.readFileSync(inputPath, "utf8");
const parsed = yaml.parse(raw);
const lines = [
  "// Generated from config/tile-profiles.yml. Do not edit directly.",
  "import type { FuelProfile, TileType } from \"../types.js\";",
  "",
  "export const TILE_FUEL_PROFILES: Record<TileType, FuelProfile> = {"
];

tileTypes.forEach((type) => {
  const entry = parsed[type];
  if (!entry) {
    throw new Error(`Missing definition for ${type} in ${inputPath}`);
  }
  const spreadBoost = entry.spreadBoost ?? 1;
  const heatTransferCap = entry.heatTransferCap ?? 5;
  const heatRetention = entry.heatRetention ?? 1;
  const windFactor = entry.windFactor ?? 0.6;
  lines.push(
    `  ${type}: {`,
    `    baseFuel: ${entry.baseFuel},`,
    `    ignition: ${entry.ignition},`,
    `    burnRate: ${entry.burnRate},`,
    `    heatOutput: ${entry.heatOutput},`,
    `    spreadBoost: ${spreadBoost},`,
    `    heatTransferCap: ${heatTransferCap},`,
    `    heatRetention: ${heatRetention},`,
    `    windFactor: ${windFactor}`,
    `  },`
  );
});
lines.push("};");
lines.push("");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join("\n"));
console.log(`Generated ${outputPath}`);
