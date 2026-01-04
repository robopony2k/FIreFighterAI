import type { CharacterId } from "./characters.js";
import type { SeasonId } from "./seasons.js";
import type { UpgradeId } from "../progression/upgrades.js";

export interface CampaignState {
  characterId: CharacterId;
  callsign: string;
  seasonId: SeasonId;
  seasonIndex: number;
  seasonDay: number;
  unlockedUpgrades: UpgradeId[];
  pendingUpgrades: UpgradeId[];
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
    unlockedUpgrades: [],
    pendingUpgrades: [],
    climateDifficulty: 1,
    populationGrowthStep: 0
  };
}
