import assert from "node:assert/strict";

import { DEFAULT_CAMPAIGN_DIFFICULTY_ID } from "../dist/core/campaign.js";
import { BASE_BUDGET } from "../dist/core/config.js";
import { getCharacterDefinition } from "../dist/core/characters.js";
import {
  CAMPAIGN_DIFFICULTIES,
  getCampaignDifficultyDefinition,
  isCampaignDifficultyId
} from "../dist/systems/campaign/constants/campaignDifficultyDefinitions.js";
import {
  MIN_STARTING_RESPONSE_TEAM_COUNT,
  resolveCampaignStartingResources,
  resolveDifficultyStartingBudget,
  resolveStartingResponseTeamCount
} from "../dist/systems/campaign/sim/campaignStartingResources.js";
import { loadLastRunConfig, saveLastRunConfig } from "../dist/persistence/lastRunConfig.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS } from "../dist/ui/run-config.js";
import { renderTitleFlameField } from "../dist/ui/title-screen/titleFlameField.js";

const expectedDifficulties = [
  {
    id: "ember",
    label: "Ember",
    budgetMultiplier: 1.25,
    startingTeamModifier: 2,
    portraitFlameScale: 0.55,
    budget: 400,
    teams: 4
  },
  {
    id: "blaze",
    label: "Blaze",
    budgetMultiplier: 1,
    startingTeamModifier: 1,
    portraitFlameScale: 0.8,
    budget: 320,
    teams: 3
  },
  {
    id: "firestorm",
    label: "Firestorm",
    budgetMultiplier: 0.85,
    startingTeamModifier: 0,
    portraitFlameScale: 1.05,
    budget: 272,
    teams: 2
  },
  {
    id: "inferno",
    label: "Inferno",
    budgetMultiplier: 0.7,
    startingTeamModifier: -1,
    portraitFlameScale: 1.3,
    budget: 224,
    teams: 1
  }
];

assert.equal(DEFAULT_CAMPAIGN_DIFFICULTY_ID, "blaze", "Blaze should be the campaign difficulty fallback");
assert.deepEqual(
  CAMPAIGN_DIFFICULTIES.map(({ id, label, budgetMultiplier, startingTeamModifier, portraitFlameScale }) => ({
    id,
    label,
    budgetMultiplier,
    startingTeamModifier,
    portraitFlameScale
  })),
  expectedDifficulties.map(({ budget, teams, ...definition }) => definition),
  "difficulty definitions should remain ordered and data-driven"
);
assert.equal(
  CAMPAIGN_DIFFICULTIES.every(
    (difficulty, index) => index === 0 || difficulty.portraitFlameScale > CAMPAIGN_DIFFICULTIES[index - 1].portraitFlameScale
  ),
  true,
  "portrait flame scale should increase with campaign difficulty"
);

const measureVisibleFlamePixels = (flameScale) => {
  const width = 96;
  const height = 96;
  const fireImageData = {
    data: new Uint8ClampedArray(width * height * 4),
    width,
    height
  };
  const emitterPixels = new Uint8Array(width * height);
  emitterPixels.fill(255);
  const glyphCenters = new Float32Array(16);
  glyphCenters.set([0.24, 0.5, 0.76]);
  const glyphHalfWidths = new Float32Array(16);
  glyphHalfWidths.set([0.14, 0.18, 0.14]);
  renderTitleFlameField({
    fireImageData,
    emitterPixels,
    glyphCount: 3,
    glyphCenters,
    glyphHalfWidths,
    timeSeconds: 1.234,
    wind: 0.2,
    flameScale
  });
  let visiblePixels = 0;
  for (let index = 3; index < fireImageData.data.length; index += 4) {
    if (fireImageData.data[index] >= 64) {
      visiblePixels += 1;
    }
  }
  return visiblePixels;
};

const visibleFlameAreas = CAMPAIGN_DIFFICULTIES.map((difficulty) =>
  measureVisibleFlamePixels(difficulty.portraitFlameScale)
);
assert.equal(
  visibleFlameAreas.every((area, index) => index === 0 || area > visibleFlameAreas[index - 1]),
  true,
  "difficulty scale should grow the rendered flame bodies rather than the portrait canvas"
);

expectedDifficulties.forEach((expected) => {
  assert.equal(isCampaignDifficultyId(expected.id), true, `${expected.id} should be a valid difficulty id`);
  assert.equal(getCampaignDifficultyDefinition(expected.id).label, expected.label, "difficulty lookup should preserve labels");
  assert.equal(resolveDifficultyStartingBudget(BASE_BUDGET, expected.id), expected.budget, `${expected.label} should resolve its pre-Chief budget`);
  assert.equal(resolveStartingResponseTeamCount(expected.id), expected.teams, `${expected.label} should resolve its response-team count`);
  const resources = resolveCampaignStartingResources(BASE_BUDGET, expected.id, "chief");
  assert.equal(resources.difficultyBudget, expected.budget, "resource resolution should expose the difficulty-derived budget");
  assert.equal(resources.startingBudget, expected.budget, "the neutral Chief should not change the difficulty-derived budget");
  assert.equal(resources.responseTeamCount, expected.teams, "resource resolution should use the same team-count policy");
});

assert.equal(isCampaignDifficultyId("wildfire"), false, "unknown difficulty ids should be rejected");
assert.equal(
  resolveStartingResponseTeamCount("inferno", 0),
  MIN_STARTING_RESPONSE_TEAM_COUNT,
  "response-team count should never fall below the valid campaign minimum"
);
const orderedChiefBudget = resolveCampaignStartingResources(3, "ember", "logistics");
assert.equal(orderedChiefBudget.difficultyBudget, 3, "difficulty budget rounding should happen before Chief modifiers");
assert.equal(orderedChiefBudget.startingBudget, 3, "the existing Chief helper should receive the rounded difficulty budget");
assert.equal(
  getCharacterDefinition("logistics").modifiers.budgetMultiplier,
  1.12,
  "campaign difficulty must not alter existing Chief modifiers"
);

const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, String(value)),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
  key: (index) => [...storage.keys()][index] ?? null,
  get length() {
    return storage.size;
  }
};

const createRunConfig = (difficultyId) => ({
  seed: 1337,
  mapSize: DEFAULT_MAP_SIZE,
  characterId: "chief",
  chiefGender: "male",
  callsign: "Difficulty Test",
  difficultyId,
  options: {
    ...DEFAULT_RUN_OPTIONS,
    terrain: { ...DEFAULT_RUN_OPTIONS.terrain },
    fire: { ...DEFAULT_RUN_OPTIONS.fire },
    fuelProfiles: {}
  }
});

saveLastRunConfig(createRunConfig("inferno"));
assert.equal(loadLastRunConfig()?.difficultyId, "inferno", "last-run persistence should remember the selected difficulty");

const { difficultyId: omittedDifficulty, ...legacyConfig } = createRunConfig("ember");
void omittedDifficulty;
localStorage.setItem("fireline.lastRunConfig", JSON.stringify(legacyConfig));
assert.equal(loadLastRunConfig()?.difficultyId, "blaze", "legacy configurations should migrate to Blaze");

localStorage.setItem("fireline.lastRunConfig", JSON.stringify({ ...createRunConfig("ember"), difficultyId: "invalid" }));
assert.equal(loadLastRunConfig()?.difficultyId, "blaze", "invalid persisted difficulties should sanitize to Blaze");

console.log("campaign difficulty regression passed");
