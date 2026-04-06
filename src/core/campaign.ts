import type { CharacterId } from "./characters.js";
import type { SeasonId } from "./seasons.js";

export interface CampaignState {
  characterId: CharacterId;
  callsign: string;
  seasonId: SeasonId;
  seasonIndex: number;
  seasonDay: number;
  climateDifficulty: number;
  populationGrowthStep: number;
}

export function createCampaignState(): CampaignState {
  return {
    characterId: "chief",
    callsign: "",
    seasonId: "spring",
    seasonIndex: 0,
    seasonDay: 0,
    climateDifficulty: 1,
    populationGrowthStep: 0
  };
}
