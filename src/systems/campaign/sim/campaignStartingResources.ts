import { getCharacterBaseBudget, type CharacterId } from "../../../core/characters.js";
import type { CampaignDifficultyId } from "../../../core/campaign.js";
import { getCampaignDifficultyDefinition } from "../constants/campaignDifficultyDefinitions.js";

export const BASE_STARTING_RESPONSE_TEAM_COUNT = 2;
export const MIN_STARTING_RESPONSE_TEAM_COUNT = 1;

export interface CampaignStartingResources {
  difficultyBudget: number;
  startingBudget: number;
  responseTeamCount: number;
}

export const resolveDifficultyStartingBudget = (
  baseBudget: number,
  difficultyId: CampaignDifficultyId
): number => {
  const difficulty = getCampaignDifficultyDefinition(difficultyId);
  return Math.max(0, Math.floor(baseBudget * difficulty.budgetMultiplier));
};

export const resolveStartingResponseTeamCount = (
  difficultyId: CampaignDifficultyId,
  baseTeamCount = BASE_STARTING_RESPONSE_TEAM_COUNT
): number => {
  const difficulty = getCampaignDifficultyDefinition(difficultyId);
  return Math.max(
    MIN_STARTING_RESPONSE_TEAM_COUNT,
    Math.floor(baseTeamCount) + difficulty.startingTeamModifier
  );
};

export const resolveCampaignStartingResources = (
  baseBudget: number,
  difficultyId: CampaignDifficultyId,
  characterId: CharacterId
): CampaignStartingResources => {
  const difficultyBudget = resolveDifficultyStartingBudget(baseBudget, difficultyId);
  return {
    difficultyBudget,
    startingBudget: getCharacterBaseBudget(characterId, difficultyBudget),
    responseTeamCount: resolveStartingResponseTeamCount(difficultyId)
  };
};
