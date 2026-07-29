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
assert.equal(createRandomTerrainSeed(() => 0), 0);
assert.equal(createRandomTerrainSeed(() => 1), 0xffff_ffff);

console.log("Terrain randomizer regression passed.");
