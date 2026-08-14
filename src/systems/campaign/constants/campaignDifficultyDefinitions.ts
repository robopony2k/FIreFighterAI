import {
  DEFAULT_CAMPAIGN_DIFFICULTY_ID,
  type CampaignDifficultyId
} from "../../../core/campaign.js";

export interface CampaignDifficultyDefinition {
  id: CampaignDifficultyId;
  label: string;
  budgetMultiplier: number;
  startingTeamModifier: number;
  portraitFlameScale: number;
}

export const CAMPAIGN_DIFFICULTIES: readonly CampaignDifficultyDefinition[] = [
  {
    id: "ember",
    label: "Ember",
    budgetMultiplier: 1.25,
    startingTeamModifier: 2,
    portraitFlameScale: 0.55
  },
  {
    id: "blaze",
    label: "Blaze",
    budgetMultiplier: 1,
    startingTeamModifier: 1,
    portraitFlameScale: 0.8
  },
  {
    id: "firestorm",
    label: "Firestorm",
    budgetMultiplier: 0.85,
    startingTeamModifier: 0,
    portraitFlameScale: 1.05
  },
  {
    id: "inferno",
    label: "Inferno",
    budgetMultiplier: 0.7,
    startingTeamModifier: -1,
    portraitFlameScale: 1.3
  }
];

const CAMPAIGN_DIFFICULTY_IDS = new Set<CampaignDifficultyId>(
  CAMPAIGN_DIFFICULTIES.map((difficulty) => difficulty.id)
);

export const isCampaignDifficultyId = (value: unknown): value is CampaignDifficultyId =>
  typeof value === "string" && CAMPAIGN_DIFFICULTY_IDS.has(value as CampaignDifficultyId);

export const getCampaignDifficultyDefinition = (
  id: CampaignDifficultyId
): CampaignDifficultyDefinition =>
  CAMPAIGN_DIFFICULTIES.find((difficulty) => difficulty.id === id) ??
  CAMPAIGN_DIFFICULTIES.find((difficulty) => difficulty.id === DEFAULT_CAMPAIGN_DIFFICULTY_ID)!;
