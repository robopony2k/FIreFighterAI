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
import {
  DEFAULT_PORTRAIT_FLAME_FEROCITY,
  normalizePortraitFlameFerocity,
  resolvePortraitFlameDynamics
} from "../dist/ui/character-select/portraitFlameDynamics.js";
import { renderPortraitFlameField } from "../dist/ui/character-select/portraitFlameField.js";

const expectedDifficulties = [
  {
    id: "ember",
    label: "Ember",
    budgetMultiplier: 1.25,
    startingTeamModifier: 2,
    portraitFlameFerocity: 0,
    flameDynamics: {
      flameHeight: 0.25,
      emitterCount: 0,
      heat: 0.5,
      opacity: 0,
      turbulence: 0.45,
      motionRate: 0.5,
      gust: 0.35,
      glowStrength: 0.16,
      wallBlend: 0,
      sparkRate: 18,
      sparkSpeed: 0.7,
      sparkLifetime: 1.25
    },
    budget: 400,
    teams: 4
  },
  {
    id: "blaze",
    label: "Blaze",
    budgetMultiplier: 1,
    startingTeamModifier: 1,
    portraitFlameFerocity: 0.5,
    flameDynamics: {
      flameHeight: 0.5,
      emitterCount: 4,
      heat: 0.72,
      opacity: 0.75,
      turbulence: 0.8,
      motionRate: 0.85,
      gust: 0.75,
      glowStrength: 0.28,
      wallBlend: 0.28,
      sparkRate: 22,
      sparkSpeed: 0.9,
      sparkLifetime: 1.25
    },
    budget: 320,
    teams: 3
  },
  {
    id: "firestorm",
    label: "Firestorm",
    budgetMultiplier: 0.85,
    startingTeamModifier: 0,
    portraitFlameFerocity: 0.75,
    flameDynamics: {
      flameHeight: 0.75,
      emitterCount: 6,
      heat: 0.88,
      opacity: 0.9,
      turbulence: 1.1,
      motionRate: 1.15,
      gust: 1.2,
      glowStrength: 0.44,
      wallBlend: 0.62,
      sparkRate: 32,
      sparkSpeed: 1.15,
      sparkLifetime: 1.35
    },
    budget: 272,
    teams: 2
  },
  {
    id: "inferno",
    label: "Inferno",
    budgetMultiplier: 0.7,
    startingTeamModifier: -1,
    portraitFlameFerocity: 1,
    flameDynamics: {
      flameHeight: 1,
      emitterCount: 8,
      heat: 1,
      opacity: 1,
      turbulence: 1.35,
      motionRate: 1.5,
      gust: 1.65,
      glowStrength: 0.62,
      wallBlend: 1,
      sparkRate: 46,
      sparkSpeed: 1.45,
      sparkLifetime: 1.45
    },
    budget: 224,
    teams: 1
  }
];

assert.equal(DEFAULT_CAMPAIGN_DIFFICULTY_ID, "blaze", "Blaze should be the campaign difficulty fallback");
assert.deepEqual(
  CAMPAIGN_DIFFICULTIES.map(({ id, label, budgetMultiplier, startingTeamModifier, portraitFlameFerocity }) => ({
    id,
    label,
    budgetMultiplier,
    startingTeamModifier,
    portraitFlameFerocity
  })),
  expectedDifficulties.map(({ budget, teams, flameDynamics, ...definition }) => definition),
  "difficulty definitions should remain ordered and data-driven"
);
assert.equal(
  CAMPAIGN_DIFFICULTIES.every(
    (difficulty, index) =>
      index === 0 || difficulty.portraitFlameFerocity > CAMPAIGN_DIFFICULTIES[index - 1].portraitFlameFerocity
  ),
  true,
  "portrait flame ferocity should increase with campaign difficulty"
);
assert.equal(DEFAULT_PORTRAIT_FLAME_FEROCITY, 0.5, "invalid portrait ferocity should fall back to Blaze");
assert.equal(normalizePortraitFlameFerocity(Number.NaN), 0.5, "non-finite portrait ferocity should use Blaze");
assert.equal(normalizePortraitFlameFerocity(-1), 0, "portrait ferocity should clamp at Ember");
assert.equal(normalizePortraitFlameFerocity(2), 1, "portrait ferocity should clamp at Inferno");
expectedDifficulties.forEach((expected) => {
  assert.deepEqual(
    resolvePortraitFlameDynamics(expected.portraitFlameFerocity),
    expected.flameDynamics,
    `${expected.label} should resolve the intended portrait flame dynamics`
  );
});
const expectedSteadySparkPopulations = expectedDifficulties.map(({ flameDynamics }) =>
  Math.min(96, Math.round(flameDynamics.sparkRate * flameDynamics.sparkLifetime * 1.45))
);
assert.equal(
  expectedSteadySparkPopulations[0] >= 30,
  true,
  "Ember should maintain a clearly visible spark population despite having no flame emitters"
);
assert.equal(
  expectedSteadySparkPopulations.every(
    (population, index) => index === 0 || population > expectedSteadySparkPopulations[index - 1]
  ),
  true,
  "steady spark population should increase through Inferno"
);

const flameWidth = 96;
const flameHeight = 96;
const renderCpuFlameFrame = (dynamics, timeSeconds) => {
  const fireImageData = {
    data: new Uint8ClampedArray(flameWidth * flameHeight * 4),
    width: flameWidth,
    height: flameHeight
  };
  renderPortraitFlameField({
    imageData: fireImageData,
    timeSeconds,
    wind: 0.2,
    dynamics
  });
  assert.equal(fireImageData.width, flameWidth, "ferocity must not change the flame field width");
  assert.equal(fireImageData.height, flameHeight, "ferocity must not change the flame field height");
  return fireImageData;
};

const measureCpuFlameFrame = (frame) => {
  let colorEnergy = 0;
  let alphaEnergy = 0;
  let firstVisibleRow = frame.height;
  for (let index = 0; index < frame.data.length; index += 4) {
    colorEnergy += frame.data[index] + frame.data[index + 1] + frame.data[index + 2];
    alphaEnergy += frame.data[index + 3];
    if (frame.data[index + 3] > 4) {
      firstVisibleRow = Math.min(firstVisibleRow, Math.floor(index / 4 / frame.width));
    }
  }
  return { colorEnergy, alphaEnergy, visibleHeight: frame.height - firstVisibleRow };
};

const measureFrameDifference = (first, second) => {
  let difference = 0;
  for (let index = 0; index < first.data.length; index += 1) {
    difference += Math.abs(first.data[index] - second.data[index]);
  }
  return difference;
};

const measureVisibleColumnCoverage = (frame) => {
  let visibleColumns = 0;
  for (let x = 0; x < frame.width; x += 1) {
    let visible = false;
    for (let y = Math.floor(frame.height * 0.5); y < frame.height; y += 1) {
      if (frame.data[(y * frame.width + x) * 4 + 3] > 4) {
        visible = true;
        break;
      }
    }
    visibleColumns += visible ? 1 : 0;
  }
  return visibleColumns / frame.width;
};

const cpuFlameMetrics = expectedDifficulties.map((expected) => {
  const first = renderCpuFlameFrame(expected.flameDynamics, 1.234);
  const second = renderCpuFlameFrame(
    expected.flameDynamics,
    1.234 + 0.08 * expected.flameDynamics.motionRate
  );
  return {
    ...measureCpuFlameFrame(first),
    frameActivity: measureFrameDifference(first, second),
    visibleColumnCoverage: measureVisibleColumnCoverage(first)
  };
});
for (const metric of ["colorEnergy", "alphaEnergy", "frameActivity"]) {
  assert.equal(
    cpuFlameMetrics.every((entry, index) => index === 0 || entry[metric] > cpuFlameMetrics[index - 1][metric]),
    true,
    `${metric} should increase from Ember through Inferno without resizing the flame field`
  );
}
cpuFlameMetrics.forEach((metrics, index) => {
  if (index === 0) {
    assert.equal(metrics.visibleHeight, 0, "Ember should use sparks and glow without a procedural flame field");
    assert.equal(metrics.visibleColumnCoverage, 0, "Ember should have no hidden flame emitters");
    return;
  }
  const targetHeight = flameHeight * expectedDifficulties[index].flameDynamics.flameHeight;
  assert.equal(
    metrics.visibleHeight >= targetHeight * 0.85 && metrics.visibleHeight <= targetHeight + 1,
    true,
    `${expectedDifficulties[index].label} flames should occupy their configured frame-height band`
  );
});
assert.equal(
  cpuFlameMetrics[3].visibleColumnCoverage >= 0.9,
  true,
  "Inferno should form a continuous wall across the lower portrait instead of discrete jets"
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
