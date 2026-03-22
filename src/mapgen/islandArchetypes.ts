export type IslandArchetypeId = "MASSIF" | "LONG_SPINE" | "TWIN_BAY" | "SHELF";

export type PreferredTownLayoutId = "coastal_ring" | "bridge_chain" | "inland_valley" | "hub_spokes";

export type IslandBaseMaskFamily = "radial_gradient" | "stretched_ellipse" | "twin_bay" | "plateau_shelf";

export type IslandUpliftProfile = "central_peak" | "spine_ridge" | "bay_shield" | "shelf_plateau";

export type IslandArchetypeDefinition = {
  baseMaskFamily: IslandBaseMaskFamily;
  lowFreqAmplitude: number;
  midFreqAmplitude: number;
  highFreqAmplitude: number;
  upliftProfile: IslandUpliftProfile;
  coastlineDistortionCap: number;
  preferredTownLayout: PreferredTownLayoutId;
};

export const ISLAND_ARCHETYPE_IDS: readonly IslandArchetypeId[] = ["MASSIF", "LONG_SPINE", "TWIN_BAY", "SHELF"];

export const ISLAND_ARCHETYPE_DEFINITIONS: Record<IslandArchetypeId, IslandArchetypeDefinition> = {
  MASSIF: {
    baseMaskFamily: "radial_gradient",
    lowFreqAmplitude: 0.24,
    midFreqAmplitude: 0.14,
    highFreqAmplitude: 0.06,
    upliftProfile: "central_peak",
    coastlineDistortionCap: 0.36,
    preferredTownLayout: "coastal_ring"
  },
  LONG_SPINE: {
    baseMaskFamily: "stretched_ellipse",
    lowFreqAmplitude: 0.18,
    midFreqAmplitude: 0.22,
    highFreqAmplitude: 0.08,
    upliftProfile: "spine_ridge",
    coastlineDistortionCap: 0.48,
    preferredTownLayout: "inland_valley"
  },
  TWIN_BAY: {
    baseMaskFamily: "twin_bay",
    lowFreqAmplitude: 0.2,
    midFreqAmplitude: 0.16,
    highFreqAmplitude: 0.07,
    upliftProfile: "bay_shield",
    coastlineDistortionCap: 0.44,
    preferredTownLayout: "coastal_ring"
  },
  SHELF: {
    baseMaskFamily: "plateau_shelf",
    lowFreqAmplitude: 0.16,
    midFreqAmplitude: 0.08,
    highFreqAmplitude: 0.03,
    upliftProfile: "shelf_plateau",
    coastlineDistortionCap: 0.22,
    preferredTownLayout: "hub_spokes"
  }
};
