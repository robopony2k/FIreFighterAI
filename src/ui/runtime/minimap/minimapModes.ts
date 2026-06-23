import type { ProgressionState } from "../../../systems/progression/types.js";
import type { ProgressionCapabilityId } from "../../../systems/progression/types/techTree.js";
import { hasProgressionCapability } from "../../../systems/progression/sim/techTree.js";

export const MINIMAP_MODES = ["terrain", "topographic", "moisture", "thermal"] as const;
export type MinimapMode = (typeof MINIMAP_MODES)[number];

export const MINIMAP_MODE_CAPABILITIES: Record<MinimapMode, ProgressionCapabilityId> = {
  terrain: "minimap.mode.terrain",
  topographic: "minimap.mode.topographic",
  moisture: "minimap.mode.moisture",
  thermal: "minimap.mode.thermal"
};

export const MINIMAP_MODE_LABELS: Record<MinimapMode, string> = {
  terrain: "Terrain",
  topographic: "Topographic",
  moisture: "Moisture",
  thermal: "Heat"
};

export const getMinimapModeLabel = (mode: MinimapMode): string => MINIMAP_MODE_LABELS[mode] ?? mode;

export const getAvailableMinimapModes = (progression: ProgressionState): MinimapMode[] =>
  MINIMAP_MODES.filter((mode) => hasProgressionCapability(progression, MINIMAP_MODE_CAPABILITIES[mode]));

export const resolveAvailableMinimapMode = (progression: ProgressionState, preferred: MinimapMode): MinimapMode => {
  const availableModes = getAvailableMinimapModes(progression);
  return availableModes.includes(preferred) ? preferred : (availableModes[0] ?? "terrain");
};
