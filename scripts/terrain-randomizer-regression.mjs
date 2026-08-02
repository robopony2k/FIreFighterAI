import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "..");
const distImport = (segments) => pathToFileURL(path.join(repoRoot, "dist", ...segments)).href;

const { createRandomTerrainRecipe, createRandomTerrainSeed } =
  await import(distImport(["ui", "terrainRandomizer.js"]));
const { TERRAIN_RUN_GROUPS } = await import(distImport(["ui", "terrain-schema.js"]));
const { decodeTerrainSeedCode, encodeTerrainSeedCode } =
  await import(distImport(["ui", "terrainSeedCode.js"]));
const { cloneTerrainRecipe, compileTerrainRecipe, createDefaultTerrainRecipe } =
  await import(distImport(["mapgen", "terrainProfile.js"]));
const { buildNoiseLandmassCore } =
  await import(distImport(["systems", "terrain", "sim", "noiseLandmass.js"]));
const { getEffectiveLandCoverageTarget, TERRAIN_GENERATION_LIMITS } =
  await import(distImport(["systems", "terrain", "constants", "terrainGenerationLimits.js"]));

const createSequence = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
};

const first = createRandomTerrainRecipe("gigantic", createSequence(0x51eed));
const replay = createRandomTerrainRecipe("gigantic", createSequence(0x51eed));
assert.deepEqual(first, replay, "Injected randomness should make terrain randomization reproducible.");
assert.equal(first.mapSize, "gigantic", "Slider randomization must preserve the selected map size.");

const fields = TERRAIN_RUN_GROUPS.flatMap((group) => group.fields);
for (const field of fields) {
  if (field.type === "select") {
    assert.ok(
      field.options.some((option) => option.value === first[field.key]),
      `${field.key} should use a valid selector option.`
    );
    continue;
  }
  const source = field.scope === "recipe" ? first : first.advancedOverrides;
  const value = source?.[field.key];
  if (field.type === "checkbox") {
    assert.equal(typeof value, "boolean", `${field.key} should be randomized as a boolean.`);
    continue;
  }
  assert.equal(typeof value, "number", `${field.key} should be randomized as a number.`);
  assert.ok(value >= field.min && value <= field.max, `${field.key} should stay inside its UI range.`);
  const stepOffset = Math.round((value - field.min) / field.step);
  const quantized = field.min + stepOffset * field.step;
  assert.ok(Math.abs(value - quantized) < 1e-9, `${field.key} should stay aligned to its UI step.`);
}

const shareCodeSeed = 424242;
const shareCode = encodeTerrainSeedCode({
  seed: shareCodeSeed,
  mapSize: first.mapSize,
  terrain: first
});
const decodedShareCode = decodeTerrainSeedCode(shareCode);
assert.ok(decodedShareCode, "The randomized terrain should produce a valid share code.");
assert.equal(decodedShareCode.seed, shareCodeSeed, "The share code should preserve the separate seed.");
assert.equal(decodedShareCode.mapSize, first.mapSize, "The share code should preserve map size.");
for (const field of fields) {
  const originalSource = field.scope === "recipe" ? first : first.advancedOverrides;
  const decodedSource = field.scope === "recipe" ? decodedShareCode.terrain : decodedShareCode.terrain.advancedOverrides;
  assert.equal(
    decodedSource?.[field.key],
    originalSource?.[field.key],
    `The share code should preserve ${field.key}.`
  );
}

const minimum = createRandomTerrainRecipe("medium", () => 0);
const maximum = createRandomTerrainRecipe("medium", () => 1);
assert.equal(minimum.mapSize, "medium");
assert.equal(maximum.mapSize, "medium");
assert.equal(
  minimum.relief,
  TERRAIN_GENERATION_LIMITS.sliders.relief.min,
  "The randomized relief minimum should use the locked bound."
);
assert.equal(
  maximum.relief,
  TERRAIN_GENERATION_LIMITS.sliders.relief.max,
  "The randomized relief maximum should use the locked bound."
);
assert.equal(
  minimum.ruggedness,
  TERRAIN_GENERATION_LIMITS.sliders.ruggedness.min,
  "The randomized ruggedness minimum should use the locked bound."
);
assert.equal(
  maximum.ruggedness,
  TERRAIN_GENERATION_LIMITS.sliders.ruggedness.max,
  "The randomized ruggedness maximum should use the locked bound."
);
assert.equal(
  minimum.landCoverageTarget,
  TERRAIN_GENERATION_LIMITS.landCoverageTarget.min,
  "The randomized land-mass minimum should use the gameplay-safe bound."
);
assert.equal(
  maximum.landCoverageTarget,
  TERRAIN_GENERATION_LIMITS.landCoverageTarget.max,
  "The randomized land-mass maximum should use the gameplay-safe bound."
);
assert.equal(
  minimum.advancedOverrides?.maxHeight,
  TERRAIN_GENERATION_LIMITS.sliders.maxHeight.min,
  "The randomized max-height minimum should use the gameplay-safe bound."
);
assert.equal(
  maximum.advancedOverrides?.maxHeight,
  TERRAIN_GENERATION_LIMITS.sliders.maxHeight.max,
  "The randomized max-height maximum should use the gameplay-safe bound."
);
assert.equal(createRandomTerrainSeed(() => 0), 0);
assert.equal(createRandomTerrainSeed(() => 1), 0xffff_ffff);

const extremeLegacyRecipe = createDefaultTerrainRecipe("colossal", "MASSIF");
extremeLegacyRecipe.landCoverageTarget = 0.99;
extremeLegacyRecipe.advancedOverrides = {
  ...extremeLegacyRecipe.advancedOverrides,
  maxHeight: 1.5,
  islandCompactness: 0
};
const normalizedLegacyRecipe = cloneTerrainRecipe(extremeLegacyRecipe);
assert.equal(
  normalizedLegacyRecipe.landCoverageTarget,
  TERRAIN_GENERATION_LIMITS.landCoverageTarget.max,
  "Legacy land coverage should normalize to the safe maximum."
);
assert.equal(
  normalizedLegacyRecipe.advancedOverrides?.maxHeight,
  TERRAIN_GENERATION_LIMITS.maxHeight.max,
  "Legacy max height should normalize to the safe maximum."
);
assert.equal(
  normalizedLegacyRecipe.advancedOverrides?.islandCompactness,
  TERRAIN_GENERATION_LIMITS.islandCompactness.min,
  "Legacy border-water falloff should normalize to the safe minimum."
);

const encodedSafeParts = encodeTerrainSeedCode({
  seed: 987654,
  mapSize: "colossal",
  terrain: createDefaultTerrainRecipe("colossal", "MASSIF")
}).split("-");
const legacyBody = encodedSafeParts[2]?.split("") ?? [];
legacyBody.splice(10, 2, ...Math.round(0.99 * 100).toString(36).toUpperCase().padStart(2, "0"));
legacyBody.splice(22, 2, ...Math.round(1.5 * 100).toString(36).toUpperCase().padStart(2, "0"));
legacyBody.splice(34, 2, "0", "0");
const decodedLegacyCode = decodeTerrainSeedCode(`${encodedSafeParts[0]}-${encodedSafeParts[1]}-${legacyBody.join("")}`);
assert.ok(decodedLegacyCode, "Legacy share codes with formerly valid extremes should remain readable.");
assert.equal(decodedLegacyCode.terrain.landCoverageTarget, TERRAIN_GENERATION_LIMITS.landCoverageTarget.max);
assert.equal(decodedLegacyCode.terrain.advancedOverrides?.maxHeight, TERRAIN_GENERATION_LIMITS.maxHeight.max);
assert.equal(
  decodedLegacyCode.terrain.advancedOverrides?.islandCompactness,
  TERRAIN_GENERATION_LIMITS.islandCompactness.min
);

const TERRAIN_ARCHETYPES = ["MASSIF", "LONG_SPINE", "TWIN_BAY", "SHELF", "NONE"];
const BOUNDARY_SIZES = [64, 128, 256];
const BORDER_HUGGING_LIMIT_BY_SIZE = new Map([
  [64, 0.4],
  [128, 0.25],
  [256, 0.18]
]);

const createBoundaryRecipe = (size, archetype, mode) => {
  const recipe = createDefaultTerrainRecipe(
    size === 64 ? "medium" : size === 128 ? "massive" : "colossal",
    archetype
  );
  if (mode === "low") {
    recipe.landCoverageTarget = TERRAIN_GENERATION_LIMITS.landCoverageTarget.min;
    recipe.relief = 0;
    recipe.ruggedness = 0;
    recipe.advancedOverrides = {
      ...recipe.advancedOverrides,
      maxHeight: TERRAIN_GENERATION_LIMITS.maxHeight.min,
      islandCompactness: TERRAIN_GENERATION_LIMITS.islandCompactness.min,
      basinStrength: 1,
      seaLevelBias: 1
    };
  } else {
    recipe.landCoverageTarget = TERRAIN_GENERATION_LIMITS.landCoverageTarget.max;
    recipe.coastComplexity = 1;
    recipe.advancedOverrides = {
      ...recipe.advancedOverrides,
      islandCompactness: TERRAIN_GENERATION_LIMITS.islandCompactness.min,
      asymmetry: 1,
      anisotropy: 1,
      embayment: 0,
      seaLevelBias: 0
    };
  }
  return recipe;
};

const analyzeBoundaryResult = (result, settings, size) => {
  const dryElevations = [];
  const coastalInsets = [];
  let landCount = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1) {
        assert.equal(result.oceanMask[index], 1, `The ${size}-tile outer border must remain ocean.`);
      }
      if (result.oceanMask[index] > 0) {
        continue;
      }
      landCount += 1;
      dryElevations.push(
        ((result.elevationFloatMap[index] ?? 0) - (result.seaLevelMap[index] ?? 0))
        * settings.heightScaleMultiplier
      );
      const touchesOcean =
        (x > 0 && result.oceanMask[index - 1] > 0)
        || (x < size - 1 && result.oceanMask[index + 1] > 0)
        || (y > 0 && result.oceanMask[index - size] > 0)
        || (y < size - 1 && result.oceanMask[index + size] > 0);
      if (touchesOcean) {
        coastalInsets.push(Math.min(x, y, size - 1 - x, size - 1 - y));
      }
    }
  }
  dryElevations.sort((left, right) => left - right);
  const percentile = (value) =>
    dryElevations[Math.min(dryElevations.length - 1, Math.floor((dryElevations.length - 1) * value))] ?? 0;
  const outerBand = Math.max(2, Math.round(size * 0.02));
  return {
    landCoverage: landCount / (size * size),
    borderHuggingRatio:
      coastalInsets.filter((inset) => inset <= outerBand).length
      / Math.max(1, coastalInsets.length),
    dryElevationSpread: percentile(0.95) - percentile(0.05)
  };
};

const buildBoundaryFixture = (size, archetype, mode) => {
  const recipe = createBoundaryRecipe(size, archetype, mode);
  const { settings } = compileTerrainRecipe(recipe);
  const seed = 1337 + TERRAIN_ARCHETYPES.indexOf(archetype) * 997;
  const result = buildNoiseLandmassCore({
    seed,
    cols: size,
    rows: size,
    settings,
    includeRivers: false,
    previewMode: "water"
  });
  return {
    recipe,
    settings,
    result,
    metrics: analyzeBoundaryResult(result, settings, size)
  };
};

for (const size of BOUNDARY_SIZES) {
  for (const archetype of TERRAIN_ARCHETYPES) {
    for (const mode of ["low", "edge"]) {
      const fixture = buildBoundaryFixture(size, archetype, mode);
      const effectiveTarget = getEffectiveLandCoverageTarget(
        fixture.recipe.landCoverageTarget,
        fixture.recipe.advancedOverrides?.seaLevelBias ?? 0.5
      );
      assert.ok(
        Math.abs(fixture.metrics.landCoverage - effectiveTarget) <= 0.02,
        `${size}/${archetype}/${mode} land coverage should stay within 0.02 of ${effectiveTarget}.`
      );
      assert.ok(
        fixture.metrics.borderHuggingRatio <= (BORDER_HUGGING_LIMIT_BY_SIZE.get(size) ?? 0),
        `${size}/${archetype}/${mode} coastline should not crowd the world boundary: `
        + `${fixture.metrics.borderHuggingRatio.toFixed(4)}.`
      );
      assert.ok(
        fixture.metrics.dryElevationSpread >= 0.04,
        `${size}/${archetype}/${mode} dry terrain should retain visible elevation spread.`
      );
    }
  }
}

const deterministicFirst = buildBoundaryFixture(64, "MASSIF", "edge").result;
const deterministicReplay = buildBoundaryFixture(64, "MASSIF", "edge").result;
assert.deepEqual(
  deterministicReplay.elevationFloatMap,
  deterministicFirst.elevationFloatMap,
  "Safe terrain-envelope calibration should remain deterministic."
);
assert.deepEqual(deterministicReplay.oceanMask, deterministicFirst.oceanMask);

console.log("Terrain randomizer regression passed.");
