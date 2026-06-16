export const MINIMAP_MODES = ["terrain", "topographic", "moisture", "thermal"] as const;
export type MinimapMode = (typeof MINIMAP_MODES)[number];

export const MINIMAP_MODE_LABELS: Record<MinimapMode, string> = {
  terrain: "Terrain",
  topographic: "Topographic",
  moisture: "Moisture",
  thermal: "Heat"
};

export const getMinimapModeLabel = (mode: MinimapMode): string => MINIMAP_MODE_LABELS[mode] ?? mode;
