import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distImport = (segments) => pathToFileURL(path.join(repoRoot, "dist", ...segments)).href;

const { MAP_SIZE_PRESETS } = await import(distImport(["core", "config.js"]));
const { createDefaultTerrainRecipe, compileTerrainRecipe, cloneTerrainRecipe } = await import(distImport(["mapgen", "terrainProfile.js"]));
const { buildFastTerrainPreview } = await import(distImport(["systems", "terrain", "sim", "fastTerrainPreview.js"]));
const { MAP_EDITOR_TERRAIN_GROUPS } = await import(distImport(["ui", "terrain-schema.js"]));

const archetypes = ["MASSIF", "LONG_SPINE", "TWIN_BAY", "SHELF"];
const modes = ["shape", "relief", "water"];
const seed = 1337;
const sizeId = "massive";
const size = MAP_SIZE_PRESETS[sizeId];
const PERF_BUDGET_MS = 100;
const EXPECTED_HASHES = {
  MASSIF: {
    shape: "5ca8c2ed",
    relief: "78a18b4c",
    water: "fdf1777c"
  },
  LONG_SPINE: {
    shape: "b02fa27f",
    relief: "49ed9b04",
    water: "3e829e44"
  },
  TWIN_BAY: {
    shape: "53130209",
    relief: "cc08d7fc",
    water: "f9d86a6c"
  },
  SHELF: {
    shape: "0231d485",
    relief: "52bca5f5",
    water: "ba217bb4"
  }
};

const EXPECTED_EDITOR_KEYS = {
  scenario: ["recipe.archetype"],
  carving: [
    "recipe.coastComplexity",
    "recipe.landCoverageTarget",
    "advanced.islandCompactness",
    "advanced.embayment",
    "advanced.anisotropy",
    "advanced.asymmetry"
  ],
  relief: [
    "recipe.relief",
    "recipe.ruggedness",
    "advanced.maxHeight",
    "advanced.interiorRise",
    "advanced.ridgeAlignment",
    "advanced.uplandDistribution",
    "advanced.ridgeFrequency"
  ],
  flooding: ["advanced.seaLevelBias", "advanced.coastalShelfWidth"],
  rivers: ["recipe.riverIntensity", "advanced.riverBudget", "advanced.basinStrength"],
  erosion: []
};

const hashArrays = (...arrays) => {
  let hash = 2166136261;
  for (const array of arrays) {
    for (let i = 0; i < array.length; i += 1) {
      const value = array[i] ?? 0;
      const quantized = array instanceof Float32Array ? Math.floor(value * 1_000_000) : value;
      hash ^= quantized & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
      hash ^= (quantized >>> 8) & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
      hash ^= (quantized >>> 16) & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
      hash ^= (quantized >>> 24) & 0xff;
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  }
  return hash.toString(16).padStart(8, "0");
};

const summarizeResult = (archetype, mode, result, elapsedMs) => {
  let land = 0;
  let river = 0;
  let ocean = 0;
  let waterTiles = 0;
  let elevationSum = 0;
  let elevationSqSum = 0;
  for (let i = 0; i < result.elevationMap.length; i += 1) {
    const elevation = result.elevationMap[i] ?? 0;
    elevationSum += elevation;
    elevationSqSum += elevation * elevation;
    if (result.oceanMask[i] > 0) {
      ocean += 1;
    } else {
      land += 1;
    }
    if (result.riverMask[i] > 0) {
      river += 1;
    }
    if (result.tileTypes[i] === 0) {
      waterTiles += 1;
    }
  }
  const total = Math.max(1, result.elevationMap.length);
  const mean = elevationSum / total;
  return {
    archetype,
    mode,
    hash: hashArrays(result.elevationMap, result.oceanMask, result.riverMask),
    landRatio: Number((land / total).toFixed(4)),
    waterTileRatio: Number((waterTiles / total).toFixed(4)),
    riverRatio: Number((river / total).toFixed(4)),
    oceanRatio: Number((ocean / total).toFixed(4)),
    elevationVariance: Number((elevationSqSum / total - mean * mean).toFixed(6)),
    elapsedMs: Number(elapsedMs.toFixed(2)),
    internalElapsedMs: Number(result.timingsMs.total.toFixed(2))
  };
};

const buildPreview = (recipe, mode) => {
  const { settings } = compileTerrainRecipe(recipe);
  const startedAt = performance.now();
  const result = buildFastTerrainPreview({
    seed,
    cols: size,
    rows: size,
    settings,
    mode
  });
  return { result, elapsedMs: performance.now() - startedAt };
};

const summarize = (archetype, mode) => {
  const recipe = createDefaultTerrainRecipe(sizeId, archetype);
  const { result, elapsedMs } = buildPreview(recipe, mode);
  return summarizeResult(archetype, mode, result, elapsedMs);
};

const collectEditorKeys = (stepId) => {
  const groups = MAP_EDITOR_TERRAIN_GROUPS[stepId] ?? [];
  return groups.flatMap((group) => group.fields.map((field) => `${field.scope}.${field.key}`));
};

const assertSameSet = (actual, expected, label) => {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (left.length !== right.length || left.some((value, index) => value !== right[index])) {
    throw new Error(`${label} editor controls mismatch: expected ${right.join(",")}, got ${left.join(",")}`);
  }
};

const assertEditorControlSchema = () => {
  for (const [stepId, expected] of Object.entries(EXPECTED_EDITOR_KEYS)) {
    assertSameSet(collectEditorKeys(stepId), expected, stepId);
  }
  const earlyKeys = ["scenario", "carving", "relief", "flooding", "rivers", "erosion"].flatMap(collectEditorKeys);
  if (earlyKeys.includes("advanced.skipCarving")) {
    throw new Error("Map editor still exposes obsolete advanced.skipCarving in early terrain controls.");
  }
};

const assertEditorRiversAreStaged = () => {
  const source = readFileSync(path.join(repoRoot, "src", "ui", "map-editor.ts"), "utf8");
  if (!/rivers:\s*{[\s\S]*?stopAfterPhase:\s*"hydro:rivers"[\s\S]*?sampleSource:\s*"snapshot"/.test(source)) {
    throw new Error("Map editor Rivers step must target the accurate staged hydro:rivers snapshot.");
  }
  if (/case\s+"rivers":\s*[\r\n\s]*return\s+"rivers"/.test(source)) {
    throw new Error("Map editor Rivers step is still mapped to a fast preview mode.");
  }
};

const assertDryPreviewHasNoWater = (summary) => {
  if (summary.oceanRatio > 0 || summary.riverRatio > 0 || summary.waterTileRatio > 0) {
    throw new Error(`Dry ${summary.mode} preview emitted visible water: ${JSON.stringify(summary)}`);
  }
};

const assertPerimeterElevationZero = (archetype, mode, result) => {
  const { cols, rows, elevationMap } = result;
  for (let x = 0; x < cols; x += 1) {
    const top = elevationMap[x] ?? 0;
    const bottom = elevationMap[(rows - 1) * cols + x] ?? 0;
    if (top !== 0 || bottom !== 0) {
      throw new Error(`${archetype}:${mode} has nonzero north/south perimeter elevation at x=${x}: ${JSON.stringify({ top, bottom })}`);
    }
  }
  for (let y = 0; y < rows; y += 1) {
    const left = elevationMap[y * cols] ?? 0;
    const right = elevationMap[y * cols + cols - 1] ?? 0;
    if (left !== 0 || right !== 0) {
      throw new Error(`${archetype}:${mode} has nonzero east/west perimeter elevation at y=${y}: ${JSON.stringify({ left, right })}`);
    }
  }
};

const withRecipeChange = (recipe, mutate) => {
  const next = cloneTerrainRecipe(recipe);
  next.advancedOverrides = { ...(next.advancedOverrides ?? {}) };
  mutate(next);
  return next;
};

const assertSensitivity = () => {
  const base = createDefaultTerrainRecipe(sizeId, "MASSIF");
  const longSpine = createDefaultTerrainRecipe(sizeId, "LONG_SPINE");
  const shapeBase = summarizeResult("MASSIF", "shape", buildPreview(base, "shape").result, 0);
  const shapeLong = summarizeResult("LONG_SPINE", "shape", buildPreview(longSpine, "shape").result, 0);
  if (shapeBase.hash === shapeLong.hash || Math.abs(shapeBase.elevationVariance - shapeLong.elevationVariance) < 0.0003) {
    throw new Error(`Archetype did not visibly change shape metrics: ${JSON.stringify({ shapeBase, shapeLong })}`);
  }

  const compactShape = summarizeResult(
    "MASSIF",
    "shape",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.coastComplexity = 0.95;
      recipe.landCoverageTarget = 0.78;
      recipe.advancedOverrides.islandCompactness = 0.28;
      recipe.advancedOverrides.embayment = 0.9;
    }), "shape").result,
    0
  );
  if (shapeBase.hash === compactShape.hash) {
    throw new Error(`Shape controls did not move coastline metrics: ${JSON.stringify({ shapeBase, compactShape })}`);
  }
  const highLandDryRelief = summarizeResult(
    "MASSIF",
    "relief",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.landCoverageTarget = 0.78;
    }), "relief").result,
    0
  );
  const reliefBase = summarizeResult("MASSIF", "relief", buildPreview(base, "relief").result, 0);
  if (highLandDryRelief.hash === reliefBase.hash) {
    throw new Error(`Land coverage target did not change dry relief preview: ${JSON.stringify({ reliefBase, highLandDryRelief })}`);
  }

  const lowRelief = summarizeResult(
    "MASSIF",
    "relief",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.relief = 0.18;
      recipe.ruggedness = 0.12;
      recipe.advancedOverrides.maxHeight = 0.12;
    }), "relief").result,
    0
  );
  const highRelief = summarizeResult(
    "MASSIF",
    "relief",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.relief = 0.95;
      recipe.ruggedness = 0.95;
      recipe.advancedOverrides.maxHeight = 0.95;
    }), "relief").result,
    0
  );
  if (lowRelief.hash === highRelief.hash || highRelief.elevationVariance <= lowRelief.elevationVariance * 1.08) {
    throw new Error(`Relief controls did not increase elevation variance: ${JSON.stringify({ lowRelief, highRelief })}`);
  }

  const waterBase = summarizeResult("MASSIF", "water", buildPreview(base, "water").result, 0);
  const highLandWater = summarizeResult(
    "MASSIF",
    "water",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.landCoverageTarget = 0.78;
    }), "water").result,
    0
  );
  if (highLandWater.oceanRatio >= waterBase.oceanRatio - 0.04) {
    throw new Error(`Land coverage target did not reduce ocean ratio: ${JSON.stringify({ waterBase, highLandWater })}`);
  }
  const targetLand = base.landCoverageTarget;
  if (Math.abs((1 - waterBase.oceanRatio) - targetLand) > 0.08) {
    throw new Error(`Water preview missed calibrated land target: ${JSON.stringify({ targetLand, waterBase })}`);
  }

  const biasedWater = summarizeResult(
    "MASSIF",
    "water",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.advancedOverrides.seaLevelBias = 0.86;
    }), "water").result,
    0
  );
  if (biasedWater.oceanRatio <= waterBase.oceanRatio + 0.02) {
    throw new Error(`Sea-level bias did not increase ocean ratio: ${JSON.stringify({ waterBase, biasedWater })}`);
  }

  const highWaterDryShape = summarizeResult(
    "MASSIF",
    "shape",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.advancedOverrides.seaLevelBias = 0.86;
    }), "shape").result,
    0
  );
  if (highWaterDryShape.hash !== shapeBase.hash) {
    throw new Error(`Water level changed dry shape preview: ${JSON.stringify({ shapeBase, highWaterDryShape })}`);
  }

  const highWaterDryRelief = summarizeResult(
    "MASSIF",
    "relief",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.advancedOverrides.seaLevelBias = 0.86;
    }), "relief").result,
    0
  );
  if (highWaterDryRelief.hash !== reliefBase.hash) {
    throw new Error(`Water level changed dry relief preview: ${JSON.stringify({ reliefBase, highWaterDryRelief })}`);
  }
};

assertEditorControlSchema();
assertEditorRiversAreStaged();
for (const archetype of archetypes) {
  for (const mode of modes) {
    assertPerimeterElevationZero(archetype, mode, buildPreview(createDefaultTerrainRecipe(sizeId, archetype), mode).result);
  }
}
const runs = archetypes.flatMap((archetype) => modes.map((mode) => summarize(archetype, mode)));
const slowest = Math.max(...runs.map((run) => run.elapsedMs));

for (const archetype of archetypes) {
  const hashes = new Set(runs.filter((run) => run.archetype === archetype).map((run) => run.hash));
  if (hashes.size !== modes.length) {
    throw new Error(`Fast preview mode hashes are not distinct for ${archetype}: ${JSON.stringify(runs.filter((run) => run.archetype === archetype))}`);
  }
}

for (const run of runs) {
  const expected = EXPECTED_HASHES[run.archetype]?.[run.mode];
  if (run.hash !== expected) {
    throw new Error(`Fast preview hash changed for ${run.archetype}:${run.mode}: expected ${expected}, got ${run.hash}`);
  }
}

if (runs.some((run) => run.riverRatio > 0)) {
  throw new Error(`Fast preview produced river coverage before the staged river phase: ${JSON.stringify(runs)}`);
}

for (const run of runs) {
  if (run.mode === "shape" || run.mode === "relief") {
    assertDryPreviewHasNoWater(run);
  } else if (run.mode === "water" && (run.oceanRatio <= 0 || run.waterTileRatio <= 0)) {
    throw new Error(`Water preview produced no visible ocean coverage: ${JSON.stringify(run)}`);
  }
}

if (slowest > PERF_BUDGET_MS) {
  throw new Error(`Fast preview exceeded ${PERF_BUDGET_MS}ms budget; slowest=${slowest.toFixed(2)}ms`);
}

assertSensitivity();

console.log(JSON.stringify({
  seed,
  sizeId,
  budgetMs: PERF_BUDGET_MS,
  runs
}, null, 2));
