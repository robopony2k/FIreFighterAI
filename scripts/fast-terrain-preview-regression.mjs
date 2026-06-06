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

const archetypes = ["MASSIF", "LONG_SPINE", "TWIN_BAY", "SHELF", "NONE"];
const modes = ["height", "relief", "water"];
const seed = 1337;
const sizeId = "massive";
const size = MAP_SIZE_PRESETS[sizeId];
const PERF_BUDGET_MS = 220;
const EXPECTED_HASHES = {
  MASSIF: {
    height: "07dceed5",
    relief: "c2eec41e",
    water: "00dfb5ae"
  },
  LONG_SPINE: {
    height: "d75d040d",
    relief: "3e4bc9a6",
    water: "459104b6"
  },
  TWIN_BAY: {
    height: "be61a997",
    relief: "7245c2c7",
    water: "70962b66"
  },
  SHELF: {
    height: "7ae300bb",
    relief: "2de2d2f0",
    water: "01959ff1"
  },
  NONE: {
    height: "0b21f3a4",
    relief: "b5f05691",
    water: "757150d1"
  }
};

const EXPECTED_EDITOR_KEYS = {
  scenario: ["recipe.archetype", "advanced.noiseFrequency"],
  carving: [
    "recipe.relief",
    "recipe.ruggedness",
    "advanced.maxHeight",
    "advanced.uplandDistribution"
  ],
  relief: [
    "advanced.ridgeAlignment",
    "advanced.ridgeFrequency"
  ],
  flooding: [
    "recipe.landCoverageTarget",
    "recipe.coastComplexity",
    "advanced.seaLevelBias",
    "advanced.embayment",
    "advanced.islandCompactness",
    "advanced.interiorRise",
    "advanced.anisotropy",
    "advanced.asymmetry",
    "advanced.coastalShelfWidth"
  ],
  rivers: ["recipe.riverIntensity", "advanced.basinStrength"],
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

const assertWaterPreviewDistanceShaping = (archetype, result) => {
  const { cols, rows, oceanMask } = result;
  let border = 0;
  let borderLand = 0;
  let center = 0;
  let centerWater = 0;
  const borderWidth = Math.max(4, Math.round(Math.min(cols, rows) * 0.08));
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const edgeBand = x < borderWidth || y < borderWidth || x >= cols - borderWidth || y >= rows - borderWidth;
      const nx = cols <= 1 ? 0 : x / (cols - 1) * 2 - 1;
      const ny = rows <= 1 ? 0 : y / (rows - 1) * 2 - 1;
      const centerCore = Math.hypot(nx, ny) < 0.45;
      if (edgeBand) {
        border += 1;
        if (oceanMask[idx] === 0) {
          borderLand += 1;
        }
      }
      if (centerCore) {
        center += 1;
        if (oceanMask[idx] > 0) {
          centerWater += 1;
        }
      }
    }
  }
  const borderLandRatio = borderLand / Math.max(1, border);
  const centerWaterRatio = centerWater / Math.max(1, center);
  if (borderLandRatio > 0.12 || centerWaterRatio > 0.02) {
    throw new Error(
      `${archetype}:water distance shaping failed: ${JSON.stringify({ borderLandRatio, centerWaterRatio, borderLand, border, centerWater, center })}`
    );
  }
};

const assertWaterPreviewHasNoisyContour = (archetype, result) => {
  const { cols, rows, oceanMask } = result;
  const centerX = (cols - 1) / 2;
  const centerY = (rows - 1) / 2;
  const maxRadius = Math.hypot(centerX, centerY);
  const radii = [];
  for (let sample = 0; sample < 48; sample += 1) {
    const angle = sample / 48 * Math.PI * 2;
    let boundaryRadius = 1;
    for (let step = 2; step <= 128; step += 1) {
      const radius = step / 128 * maxRadius;
      const x = Math.round(centerX + Math.cos(angle) * radius);
      const y = Math.round(centerY + Math.sin(angle) * radius);
      if (x < 0 || y < 0 || x >= cols || y >= rows) {
        break;
      }
      if (oceanMask[y * cols + x] > 0) {
        boundaryRadius = radius / maxRadius;
        break;
      }
    }
    radii.push(boundaryRadius);
  }
  const mean = radii.reduce((sum, radius) => sum + radius, 0) / Math.max(1, radii.length);
  const variance = radii.reduce((sum, radius) => sum + (radius - mean) ** 2, 0) / Math.max(1, radii.length);
  const stdev = Math.sqrt(variance);
  if (stdev < 0.025) {
    throw new Error(`Water preview contour is too uniform for ${archetype}: ${JSON.stringify({ stdev, min: Math.min(...radii), max: Math.max(...radii) })}`);
  }
};

const assertNeutralSurfaceDoesNotCreateCentralSpine = () => {
  const recipe = createDefaultTerrainRecipe(sizeId, "NONE");
  const height = buildPreview(recipe, "height").result.elevationMap;
  const relief = buildPreview(recipe, "relief").result.elevationMap;
  const stripeRadius = Math.max(3, Math.round(size * 0.04));
  let totalLift = 0;
  let totalCount = 0;
  let verticalLift = 0;
  let verticalCount = 0;
  let horizontalLift = 0;
  let horizontalCount = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const idx = y * size + x;
      const lift = Math.max(0, (relief[idx] ?? 0) - (height[idx] ?? 0));
      totalLift += lift;
      totalCount += 1;
      if (Math.abs(x - (size - 1) / 2) <= stripeRadius) {
        verticalLift += lift;
        verticalCount += 1;
      }
      if (Math.abs(y - (size - 1) / 2) <= stripeRadius) {
        horizontalLift += lift;
        horizontalCount += 1;
      }
    }
  }
  const averageLift = totalLift / Math.max(1, totalCount);
  const verticalRatio = verticalLift / Math.max(1, verticalCount) / Math.max(0.0001, averageLift);
  const horizontalRatio = horizontalLift / Math.max(1, horizontalCount) / Math.max(0.0001, averageLift);
  if (verticalRatio > 2.2 || horizontalRatio > 2.2) {
    throw new Error(`Neutral surface preview created a dominant central spine: ${JSON.stringify({ verticalRatio, horizontalRatio, averageLift })}`);
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
  const heightBase = summarizeResult("MASSIF", "height", buildPreview(base, "height").result, 0);
  const heightLong = summarizeResult("LONG_SPINE", "height", buildPreview(longSpine, "height").result, 0);
  if (heightBase.hash === heightLong.hash || Math.abs(heightBase.elevationVariance - heightLong.elevationVariance) < 0.0003) {
    throw new Error(`Archetype did not visibly change height metrics: ${JSON.stringify({ heightBase, heightLong })}`);
  }

  const compactWater = summarizeResult(
    "MASSIF",
    "water",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.coastComplexity = 0.95;
      recipe.landCoverageTarget = 0.78;
      recipe.advancedOverrides.islandCompactness = 0.28;
      recipe.advancedOverrides.embayment = 0.9;
    }), "water").result,
    0
  );
  const waterBase = summarizeResult("MASSIF", "water", buildPreview(base, "water").result, 0);
  if (waterBase.hash === compactWater.hash) {
    throw new Error(`Water shaping controls did not move coastline metrics: ${JSON.stringify({ waterBase, compactWater })}`);
  }
  const highLandDryHeight = summarizeResult(
    "MASSIF",
    "height",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.landCoverageTarget = 0.78;
    }), "height").result,
    0
  );
  if (highLandDryHeight.hash !== heightBase.hash) {
    throw new Error(`Land coverage target changed dry height preview: ${JSON.stringify({ heightBase, highLandDryHeight })}`);
  }
  const reliefBase = summarizeResult("MASSIF", "relief", buildPreview(base, "relief").result, 0);

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
      recipe.advancedOverrides.maxHeight = 1.5;
    }), "relief").result,
    0
  );
  if (lowRelief.hash === highRelief.hash || highRelief.elevationVariance <= lowRelief.elevationVariance * 1.08) {
    throw new Error(`Relief controls did not increase elevation variance: ${JSON.stringify({ lowRelief, highRelief })}`);
  }

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
  if (biasedWater.oceanRatio <= waterBase.oceanRatio + 0.01) {
    throw new Error(`Sea-level bias did not increase ocean ratio: ${JSON.stringify({ waterBase, biasedWater })}`);
  }

  const highWaterDryHeight = summarizeResult(
    "MASSIF",
    "height",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.advancedOverrides.seaLevelBias = 0.86;
    }), "height").result,
    0
  );
  if (highWaterDryHeight.hash !== heightBase.hash) {
    throw new Error(`Water level changed dry height preview: ${JSON.stringify({ heightBase, highWaterDryHeight })}`);
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
assertNeutralSurfaceDoesNotCreateCentralSpine();
for (const archetype of archetypes) {
  const waterPreview = buildPreview(createDefaultTerrainRecipe(sizeId, archetype), "water").result;
  assertWaterPreviewDistanceShaping(archetype, waterPreview);
  assertWaterPreviewHasNoisyContour(archetype, waterPreview);
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
  if (run.mode === "height" || run.mode === "relief") {
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
