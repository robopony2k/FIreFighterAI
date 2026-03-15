import type { SeasonPhase } from "./types.js";

export type SeasonId = "spring" | "summer" | "autumn" | "winter";

export interface SeasonDefinition {
  id: SeasonId;
  label: string;
  phases: SeasonPhase[];
  notes: string;
}

export const SEASONS: SeasonDefinition[] = [
  {
    id: "spring",
    label: "Spring",
    phases: ["growth"],
    notes: "Vegetation rebounds and resources are assigned."
  },
  {
    id: "summer",
    label: "Summer",
    phases: ["fire"],
    notes: "Primary wildfire response season."
  },
  {
    id: "autumn",
    label: "Autumn",
    phases: ["budget"],
    notes: "Late-season containment and mop-up before winter review."
  },
  {
    id: "winter",
    label: "Winter",
    phases: ["maintenance"],
    notes: "Budget spend on preparedness and mitigation."
  }
];

export function getSeasonDefinition(id: SeasonId): SeasonDefinition {
  return SEASONS.find((entry) => entry.id === id) ?? SEASONS[0];
}
