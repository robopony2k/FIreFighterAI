import { DEFAULT_CHIEF_GENDER, type CharacterId, type ChiefGender } from "./characters.js";
import type { SeasonId } from "./seasons.js";

export type CampaignDifficultyId = "ember" | "blaze" | "firestorm" | "inferno";

export const DEFAULT_CAMPAIGN_DIFFICULTY_ID: CampaignDifficultyId = "blaze";

export interface CampaignState {
  characterId: CharacterId;
  chiefGender: ChiefGender;
  callsign: string;
  difficultyId: CampaignDifficultyId;
  seasonId: SeasonId;
  seasonIndex: number;
  seasonDay: number;
  climateDifficulty: number;
  populationGrowthStep: number;
}

export function createCampaignState(): CampaignState {
  return {
    characterId: "chief",
    chiefGender: DEFAULT_CHIEF_GENDER,
    callsign: "",
    difficultyId: DEFAULT_CAMPAIGN_DIFFICULTY_ID,
    seasonId: "spring",
    seasonIndex: 0,
    seasonDay: 0,
    climateDifficulty: 1,
    populationGrowthStep: 0
  };
}
