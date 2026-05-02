import { FUEL_PROFILES } from "../core/config.js";
import type { FuelProfile, TileType } from "../core/types.js";

export type FuelProfileFieldDefinition = {
  key: keyof FuelProfile;
  label: string;
  step: string;
};

export const FUEL_PROFILE_FIELD_DEFINITIONS: readonly FuelProfileFieldDefinition[] = [
  { key: "baseFuel", label: "Base fuel", step: "0.01" },
  { key: "ignition", label: "Ignition point", step: "0.01" },
  { key: "burnRate", label: "Burn rate", step: "0.01" },
  { key: "heatOutput", label: "Heat output", step: "0.01" },
  { key: "spreadBoost", label: "Spread boost", step: "0.01" },
  { key: "heatTransferCap", label: "Heat transfer cap", step: "0.01" },
  { key: "heatRetention", label: "Heat retention", step: "0.01" },
  { key: "windFactor", label: "Windbreak", step: "0.01" }
];

export const formatFuelTileTypeLabel = (type: TileType): string => type.charAt(0).toUpperCase() + type.slice(1);

export const getFuelFieldLabel = (key: keyof FuelProfile): string =>
  FUEL_PROFILE_FIELD_DEFINITIONS.find((field) => field.key === key)?.label ?? key;

export const buildFuelFieldTooltip = (key: keyof FuelProfile, heatCap: number): string => {
  switch (key) {
    case "baseFuel":
      return [
        "Starting combustible mass before moisture and vegetation-age scaling are applied.",
        "Final fuel is roughly baseFuel * vegetation multiplier * (1 - moisture * 0.6).",
        "Tune this for burn duration more than ignition difficulty.",
        "0 disables sustained burning; ~0.2-0.5 is light fuel; ~0.8+ is heavy fuel."
      ].join("\n");
    case "ignition":
      return [
        "Heat threshold required to ignite the tile.",
        "Final ignition is clamp(profile + moisture * 0.35, 0.2, 1.4).",
        "Lower values ignite easily; higher values need stronger pre-heating.",
        "Values that end up above 1.4 are effectively capped."
      ].join("\n");
    case "burnRate":
      return [
        "Scales both fire growth and fuel drain once the tile is burning.",
        "Final burn rate is profile * (0.7 + (1 - moisture) * 0.8), so dry tiles burn a bit over 2x faster than saturated ones.",
        "Higher values create faster flare-ups; lower values create longer smoldering burns."
      ].join("\n");
    case "heatOutput":
      return [
        "Controls how much heat a burning tile generates for itself and neighboring tiles.",
        "Final heat output is profile * (0.85 + fuel * 0.25), so heavier-fuel tiles burn hotter.",
        "Raise this when you want a tile to push stronger heat into the fire front."
      ].join("\n");
    case "spreadBoost":
      return [
        "Multiplier on outgoing spread heat while the tile is actively burning.",
        "1.0 is neutral. 0 means the tile can burn, but contributes almost no active spread.",
        "Best tuned alongside heat output; high spread boost with low heat output still spreads weakly."
      ].join("\n");
    case "heatTransferCap":
      return [
        "Maximum stored heat the tile can hold after diffusion.",
        `The effective cap is limited by the current global fire heat cap (${heatCap.toFixed(2)}).`,
        "If this is non-zero but below the tile's ignition point, the sim still lifts the effective cap to at least ignitionPoint * 1.05.",
        "0 makes the tile dump stored heat immediately."
      ].join("\n");
    case "heatRetention":
      return [
        "Fraction of buffered heat kept each update, and a major driver of how long hotspots linger after flames die.",
        "~0.4-0.6 cools quickly; ~0.85+ keeps stubborn embers alive.",
        "Values above 1 can amplify heat and usually create unstable behavior."
      ].join("\n");
    case "windFactor":
      return [
        "How strongly this terrain blocks wind passing through it for ranged heat diffusion.",
        "0 is open terrain with no meaningful wind blocking. 1 is a strong windbreak.",
        "Roads and firebreaks should normally stay at 0 unless they represent a sheltered or built-up barrier."
      ].join("\n");
    default:
      return "";
  }
};

export const collectFuelProfileRelationshipNotes = (profile: FuelProfile, heatCap: number): string[] => {
  const notes: string[] = [];
  if (profile.baseFuel <= 0) {
    notes.push("Base fuel is 0, so this tile type will not sustain fire regardless of the other values.");
  } else if (profile.baseFuel < profile.burnRate) {
    notes.push("Base fuel is lower than burn rate; expect brief flare-ups that consume fuel very quickly.");
  } else if (profile.baseFuel > 0.8 && profile.burnRate < 0.2) {
    notes.push("High fuel with low burn rate creates long, stubborn burns that can smolder for a while.");
  }

  if (profile.heatOutput < profile.ignition) {
    notes.push("Heat output is below ignition point; same-type spread may need neighbor stacking, dry conditions, or wind support.");
  } else if (profile.baseFuel > 0 && profile.heatOutput > profile.baseFuel * 2.2 && profile.burnRate >= 0.6) {
    notes.push("Heat output is high relative to fuel; expect hot but relatively short-lived flare-ups.");
  }

  if (profile.spreadBoost <= 0 && profile.baseFuel > 0) {
    notes.push("Spread boost is 0: the tile can burn if ignited, but contributes almost no active spread.");
  } else if (profile.spreadBoost > 1 && profile.heatOutput > 1) {
    notes.push("High spread boost plus high heat output creates an aggressive heat front.");
  }

  if (profile.heatTransferCap > heatCap) {
    notes.push(
      `Heat transfer cap is above the current global fire heat cap (${heatCap.toFixed(2)}), so the extra headroom is unused unless you raise the global cap.`
    );
  } else if (profile.heatTransferCap > 0 && profile.heatTransferCap < profile.ignition) {
    notes.push("Heat transfer cap is below ignition point; the sim will still lift the effective cap to at least ignitionPoint * 1.05.");
  }

  if (profile.heatRetention > 1) {
    notes.push("Heat retention above 1 can amplify stored heat and usually produces unstable or non-physical behavior.");
  } else if (profile.heatRetention > 0.85 && profile.heatTransferCap >= heatCap * 0.8 && profile.baseFuel > 0) {
    notes.push("High heat retention plus high heat transfer cap creates stubborn hotspots and repeat ignitions.");
  }

  if (profile.windFactor > 0.75) {
    notes.push("High windbreak values strongly reduce ranged downwind heat passing through this terrain.");
  }
  return notes;
};

export const buildFuelInputTooltip = (
  type: TileType,
  key: keyof FuelProfile,
  profile: FuelProfile,
  heatCap: number
): string => {
  const currentValue = profile[key];
  const defaultValue = FUEL_PROFILES[type][key];
  const relationshipNotes = collectFuelProfileRelationshipNotes(profile, heatCap);
  const lines = [
    `${formatFuelTileTypeLabel(type)} - ${getFuelFieldLabel(key)}`,
    `Current ${currentValue.toFixed(2)} | Default ${defaultValue.toFixed(2)}`,
    "",
    buildFuelFieldTooltip(key, heatCap)
  ];
  if (relationshipNotes.length > 0) {
    lines.push("", "Current profile notes:");
    relationshipNotes.forEach((note) => lines.push(`- ${note}`));
  }
  return lines.join("\n");
};

export const buildFuelTypeTooltip = (type: TileType, profile: FuelProfile, heatCap: number): string => {
  const notes = collectFuelProfileRelationshipNotes(profile, heatCap);
  const lines = [
    `${formatFuelTileTypeLabel(type)} defaults`,
    "These values are copied into each tile of this type, then moisture and vegetation age adjust the live sim values."
  ];
  if (notes.length > 0) {
    lines.push("", "Current profile notes:");
    notes.forEach((note) => lines.push(`- ${note}`));
  }
  return lines.join("\n");
};
