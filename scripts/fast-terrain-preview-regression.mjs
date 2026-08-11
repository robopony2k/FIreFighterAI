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
const { getSquareBumpDistance01, shapeIslandBoundary } = await import(distImport(["systems", "terrain", "sim", "islandBoundaryShaping.js"]));
const { MAP_EDITOR_TERRAIN_GROUPS, TERRAIN_RUN_GROUPS } = await import(distImport(["ui", "terrain-schema.js"]));

const archetypes = ["MASSIF", "LONG_SPINE", "TWIN_BAY", "SHELF", "NONE"];
const modes = ["uplift", "surface", "water"];
const seed = 1337;
const sizeId = "massive";
const size = MAP_SIZE_PRESETS[sizeId];
const PERF_BUDGET_MS = 220;
const EXPECTED_HASHES = {
  MASSIF: {
    uplift: "185e981a",
    surface: "b0783d05",
    water: "bbafa905"
  },
  LONG_SPINE: {
    uplift: "c3090444",
    surface: "b864da11",
    water: "3cad7c21"
  },
  TWIN_BAY: {
    uplift: "c752e6e9",
    surface: "c9f34ce7",
    water: "74aa9f46"
  },
  SHELF: {
    uplift: "cbad132f",
    surface: "3c77c955",
    water: "6dbaaac4"
  },
  NONE: {
    uplift: "8e7ec47d",
    surface: "896730cc",
    water: "bbb11c4c"
  }
};

const EXPECTED_EDITOR_KEYS = {
  scenario: ["advanced.noiseFrequency"],
  uplift: [
    "recipe.archetype",
    "recipe.relief",
    "advanced.maxHeight",
    "advanced.uplandDistribution",
    "advanced.ridgeAlignment",
    "advanced.basinStrength"
  ],
  surface: [
    "recipe.ruggedness",
    "advanced.ridgeFrequency"
  ],
  flooding: [
    "recipe.landCoverageTarget",
    "recipe.coastComplexity",
    "advanced.embayment",
    "advanced.anisotropy",
    "advanced.asymmetry",
    "advanced.coastalShelfWidth"
  ],
  rivers: [],
  settlements: [
    "recipe.townDensity",
    "recipe.bridgeAllowance",
    "advanced.settlementSpacing",
    "advanced.skipRoadNetworkRouting",
    "advanced.roadMaxGrade",
    "advanced.roadStrictness"
  ],
  vegetation: [
    "recipe.vegetationDensity",
    "advanced.forestPatchiness",
    "advanced.vegetationPreGrowthYears"
  ],
  erosion: ["recipe.riverIntensity"]
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
  const allEditorKeys = Object.keys(MAP_EDITOR_TERRAIN_GROUPS).flatMap(collectEditorKeys);
  const duplicates = allEditorKeys.filter((key, index) => allEditorKeys.indexOf(key) !== index);
  if (duplicates.length > 0) {
    throw new Error(`Map editor controls must have unique ownership: ${[...new Set(duplicates)].join(",")}`);
  }
  const earlyKeys = ["scenario", "uplift", "surface", "flooding", "erosion", "rivers"].flatMap(collectEditorKeys);
  const obsoleteKeys = ["recipe.waterLevel", "advanced.skipCarving", "advanced.interiorRise", "advanced.islandCompactness", "advanced.seaLevelBias"];
  const leakedEarlyKeys = obsoleteKeys.filter((key) => earlyKeys.includes(key));
  if (leakedEarlyKeys.length > 0) throw new Error(`Map editor still exposes obsolete terrain controls: ${leakedEarlyKeys.join(",")}`);
  const runKeys = TERRAIN_RUN_GROUPS.flatMap((group) => group.fields.map((field) => `${field.scope}.${field.key}`));
  const leakedRunKeys = obsoleteKeys.filter((key) => runKeys.includes(key));
  if (leakedRunKeys.length > 0) throw new Error(`New-run terrain controls still expose obsolete terrain controls: ${leakedRunKeys.join(",")}`);
};

const assertEditorUpliftSequence = () => {
  const source = readFileSync(path.join(repoRoot, "src", "ui", "map-editor.ts"), "utf8");
  const previewSource = readFileSync(path.join(repoRoot, "src", "render", "terrainPreview.ts"), "utf8");
  const fastPreviewSource = readFileSync(path.join(repoRoot, "src", "systems", "terrain", "sim", "fastTerrainPreview.ts"), "utf8");
  const markup = readFileSync(path.join(repoRoot, "index.html"), "utf8");
  if (!/MAP_EDITOR_STEP_SEQUENCE[\s\S]*?"scenario"[\s\S]*?"uplift"[\s\S]*?"surface"[\s\S]*?"flooding"[\s\S]*?"erosion"[\s\S]*?"rivers"/.test(source)) {
    throw new Error("Map editor terrain steps are not ordered Scenario -> Uplift -> Surface -> Sea Level -> Erosion -> Rivers/Lakes.");
  }
  if (/data-step(?:-panel)?="(?:carving|relief)"/.test(markup) || /\| "(?:carving|relief)"/.test(source)) {
    throw new Error("Map editor still exposes retired carving/relief step identifiers.");
  }
  if (!/data-step="uplift"[\s\S]*?>Uplift</.test(markup) || !/data-step="surface"[\s\S]*?>Surface</.test(markup)) {
    throw new Error("Map editor markup is missing Uplift or Surface step labels.");
  }
  if (!markup.includes("Archetype field") || !markup.includes("Basin tendency") || !markup.includes("Coastline tint is context only")) {
    throw new Error("Map editor Uplift preview is missing its field legend or coastline-context explanation.");
  }
  if (!previewSource.includes("UPLIFT_CAMERA_DIRECTION") || !previewSource.includes('viewPreset?: "default" | "uplift"')) {
    throw new Error("Map editor Uplift preview is missing its near-overhead camera preset.");
  }
  if (!fastPreviewSource.includes("buildUpliftPresentation")) {
    throw new Error("Map editor Uplift preview is still rendering the composite terrain elevation directly.");
  }
};

const fieldRange = (field) => {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < field.length; i += 1) {
    min = Math.min(min, field[i] ?? 0);
    max = Math.max(max, field[i] ?? 0);
  }
  return max - min;
};

const fieldCorrelation = (left, right) => {
  let leftMean = 0;
  let rightMean = 0;
  for (let i = 0; i < left.length; i += 1) {
    leftMean += left[i] ?? 0;
    rightMean += right[i] ?? 0;
  }
  leftMean /= Math.max(1, left.length);
  rightMean /= Math.max(1, right.length);
  let covariance = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let i = 0; i < left.length; i += 1) {
    const leftDelta = (left[i] ?? 0) - leftMean;
    const rightDelta = (right[i] ?? 0) - rightMean;
    covariance += leftDelta * rightDelta;
    leftVariance += leftDelta * leftDelta;
    rightVariance += rightDelta * rightDelta;
  }
  return covariance / Math.max(1e-9, Math.sqrt(leftVariance * rightVariance));
};

const interiorFieldCorrelation = (left, right, cols, rows) => {
  const leftInterior = [];
  const rightInterior = [];
  for (let y = 0; y < rows; y += 1) {
    const py = y / Math.max(1, rows - 1) * 2 - 1;
    for (let x = 0; x < cols; x += 1) {
      const px = x / Math.max(1, cols - 1) * 2 - 1;
      const distance = 1 - (1 - px * px) * (1 - py * py);
      if (distance >= 0.48) continue;
      const idx = y * cols + x;
      leftInterior.push(left[idx] ?? 0);
      rightInterior.push(right[idx] ?? 0);
    }
  }
  return fieldCorrelation(leftInterior, rightInterior);
};

const interiorGradientCorrelation = (left, right, cols, rows) => {
  const leftGradients = [];
  const rightGradients = [];
  for (let y = 0; y < rows - 1; y += 1) {
    const py = y / Math.max(1, rows - 1) * 2 - 1;
    for (let x = 0; x < cols - 1; x += 1) {
      const px = x / Math.max(1, cols - 1) * 2 - 1;
      if (getSquareBumpDistance01(px, py) >= 0.72) continue;
      const index = y * cols + x;
      leftGradients.push((left[index + 1] ?? 0) - (left[index] ?? 0));
      rightGradients.push((right[index + 1] ?? 0) - (right[index] ?? 0));
      leftGradients.push((left[index + cols] ?? 0) - (left[index] ?? 0));
      rightGradients.push((right[index + cols] ?? 0) - (right[index] ?? 0));
    }
  }
  return fieldCorrelation(leftGradients, rightGradients);
};

const assertScenarioNoiseIsArchetypeIndependent = () => {
  const baseRecipe = createDefaultTerrainRecipe(sizeId, "MASSIF");
  const { settings: baseSettings } = compileTerrainRecipe(baseRecipe);
  let expectedHash = null;
  for (const archetype of archetypes) {
    const result = buildFastTerrainPreview({
      seed,
      cols: size,
      rows: size,
      settings: { ...baseSettings, terrainArchetype: archetype },
      mode: "noise"
    });
    const hash = hashArrays(result.debugScalarField);
    expectedHash ??= hash;
    if (hash !== expectedHash) {
      throw new Error(`Scenario noise changed when only the archetype changed: ${JSON.stringify({ archetype, expectedHash, hash })}`);
    }
  }
};

const assertSurfaceDeformsScenarioTowardUplift = () => {
  for (const archetype of archetypes.filter((value) => value !== "NONE")) {
    const recipe = createDefaultTerrainRecipe(sizeId, archetype);
    const { settings } = compileTerrainRecipe(recipe);
    const noise = buildPreview(recipe, "noise").result;
    const uplift = buildPreview(recipe, "uplift").result;
    const surface = buildPreview(recipe, "surface").result;
    const neutralSurface = buildFastTerrainPreview({
      seed,
      cols: size,
      rows: size,
      settings: { ...settings, terrainArchetype: "NONE" },
      mode: "surface"
    });
    const deformation = Float32Array.from(
      surface.elevationMap,
      (value, index) => value - (neutralSurface.elevationMap[index] ?? 0)
    );
    const upliftSignal = Float32Array.from(
      uplift.archetypeUpliftMap,
      (value, index) => value - (uplift.archetypeBasinMap[index] ?? 0) * 0.3
    );
    const upliftCorrelation = interiorFieldCorrelation(
      deformation,
      upliftSignal,
      surface.cols,
      surface.rows
    );
    const noiseCorrelation = interiorGradientCorrelation(
      surface.elevationMap,
      noise.debugScalarField,
      surface.cols,
      surface.rows
    );
    const deformationRange = fieldRange(deformation);
    if (!Number.isFinite(upliftCorrelation) || deformationRange < 0.025 || deformationRange > 0.24 || noiseCorrelation < 0.18) {
      throw new Error(`${archetype}: Surface must retain bounded archetype deformation while remaining noise-led: ${JSON.stringify({ upliftCorrelation, deformationRange, noiseCorrelation })}`);
    }
  }

  const capturedLongSpine = withRecipeChange(createDefaultTerrainRecipe(sizeId, "LONG_SPINE"), (recipe) => {
    recipe.relief = 1;
    recipe.ruggedness = 0.75;
    recipe.advancedOverrides.maxHeight = 1.5;
    recipe.advancedOverrides.uplandDistribution = 0;
    recipe.advancedOverrides.ridgeAlignment = 1;
    recipe.advancedOverrides.basinStrength = 1;
    recipe.advancedOverrides.ridgeFrequency = 0.82;
  });
  const capturedUplift = buildPreview(capturedLongSpine, "uplift").result;
  const capturedSurface = buildPreview(capturedLongSpine, "surface").result;
  const capturedSettings = compileTerrainRecipe(capturedLongSpine).settings;
  const capturedNeutral = buildFastTerrainPreview({
    seed,
    cols: size,
    rows: size,
    settings: { ...capturedSettings, terrainArchetype: "NONE" },
    mode: "surface"
  });
  const capturedDeformation = Float32Array.from(
    capturedSurface.elevationMap,
    (value, index) => value - (capturedNeutral.elevationMap[index] ?? 0)
  );
  const capturedSignal = Float32Array.from(
    capturedUplift.archetypeUpliftMap,
    (value, index) => value - (capturedUplift.archetypeBasinMap[index] ?? 0) * 0.3
  );
  const capturedCorrelation = interiorFieldCorrelation(
    capturedDeformation,
    capturedSignal,
    capturedSurface.cols,
    capturedSurface.rows
  );
  if (capturedCorrelation < 0.28) {
    throw new Error(`Captured extreme Long Spine controls lost their broad shape at Surface: ${capturedCorrelation}`);
  }
};

const assertSurfaceUsesNoiseLedBoundaryShaping = () => {
  const flatProfile = [0, 0.25, 0.5, 0.75, 0.9].map((x) =>
    shapeIslandBoundary(0.5, x, 0, 0, 0.5).macroHeight
  );
  for (let index = 1; index < flatProfile.length; index += 1) {
    if ((flatProfile[index] ?? 0) >= (flatProfile[index - 1] ?? 0)) {
      throw new Error(`Square-bump conversion did not decline continuously: ${JSON.stringify(flatProfile)}`);
    }
  }
  const profileDrops = flatProfile.slice(1).map((value, index) => (flatProfile[index] ?? 0) - value);
  if ((profileDrops.at(-1) ?? 0) <= (profileDrops[0] ?? 0)) {
    throw new Error(`Square-bump conversion did not accelerate toward the edge: ${JSON.stringify({ flatProfile, profileDrops })}`);
  }
  if (getSquareBumpDistance01(0, 0) !== 0 || getSquareBumpDistance01(1, 0.37) !== 1) {
    throw new Error("Square-bump distance lost its exact centre or perimeter contract.");
  }
  const centerCalm = shapeIslandBoundary(0.5, 0, 0, 1, 1);
  const centerNeutral = shapeIslandBoundary(0.5, 0, 0, 0, 1);
  const edgeCalm = shapeIslandBoundary(0.5, 1, 0.3, -1, 1);
  const edgeNeutral = shapeIslandBoundary(0.5, 1, 0.3, 0, 1);
  if (centerCalm.perturbedDistance01 !== centerNeutral.perturbedDistance01 || edgeCalm.perturbedDistance01 !== edgeNeutral.perturbedDistance01) {
    throw new Error("Coast perturbation must vanish at the centre and exact perimeter.");
  }

  const recipe = createDefaultTerrainRecipe(sizeId, "NONE");
  const surface = buildPreview(recipe, "surface").result;
  const water = buildPreview(recipe, "water").result;
  let surfaceBorder = 0;
  let surfaceInterior = 0;
  let maxSurfaceWaterDelta = 0;
  let borderCount = 0;
  let interiorCount = 0;
  const profileBands = Array.from({ length: 4 }, () => ({ elevation: 0, count: 0, step: 0, stepCount: 0 }));
  for (let y = 0; y < surface.rows; y += 1) {
    for (let x = 0; x < surface.cols; x += 1) {
      const px = x / Math.max(1, surface.cols - 1) * 2 - 1;
      const py = y / Math.max(1, surface.rows - 1) * 2 - 1;
      const distance = 1 - (1 - px * px) * (1 - py * py);
      const idx = y * surface.cols + x;
      if (distance > 0.96) {
        surfaceBorder += surface.elevationMap[idx] ?? 0;
        borderCount += 1;
      } else if (distance < 0.3) {
        surfaceInterior += surface.elevationMap[idx] ?? 0;
        interiorCount += 1;
      }
      const band = distance < 0.3 ? 0 : distance < 0.6 ? 1 : distance < 0.75 ? 2 : distance < 0.9 ? 3 : -1;
      if (band >= 0) {
        const entry = profileBands[band];
        entry.elevation += surface.elevationMap[idx] ?? 0;
        entry.count += 1;
        if (x + 1 < surface.cols) {
          entry.step += Math.abs((surface.elevationMap[idx] ?? 0) - (surface.elevationMap[idx + 1] ?? 0));
          entry.stepCount += 1;
        }
        if (y + 1 < surface.rows) {
          entry.step += Math.abs((surface.elevationMap[idx] ?? 0) - (surface.elevationMap[idx + surface.cols] ?? 0));
          entry.stepCount += 1;
        }
      }
      maxSurfaceWaterDelta = Math.max(
        maxSurfaceWaterDelta,
        Math.abs((surface.elevationMap[idx] ?? 0) - (water.elevationMap[idx] ?? 0))
      );
    }
  }
  surfaceBorder /= Math.max(1, borderCount);
  surfaceInterior /= Math.max(1, interiorCount);
  if (surfaceBorder > surfaceInterior - 0.25 || maxSurfaceWaterDelta > 1e-7) {
    throw new Error(`Surface must apply the accelerating edge bias before Water classifies the unchanged elevation: ${JSON.stringify({ surfaceBorder, surfaceInterior, maxSurfaceWaterDelta })}`);
  }
  const bandMeans = profileBands.map((entry) => entry.elevation / Math.max(1, entry.count));
  if (!(bandMeans[0] > bandMeans[1] && bandMeans[1] > bandMeans[2] && bandMeans[2] > bandMeans[3])) {
    throw new Error(`Surface profile retained a late plateau instead of a continuous decline: ${JSON.stringify(bandMeans)}`);
  }
  const middleStep = profileBands[2].step / Math.max(1, profileBands[2].stepCount);
  const outerStep = profileBands[3].step / Math.max(1, profileBands[3].stepCount);
  if (outerStep > middleStep * 3) {
    throw new Error(`Surface retained a compressed coastal slope spike: ${JSON.stringify({ middleStep, outerStep })}`);
  }
  const source = readFileSync(path.join(repoRoot, "src", "systems", "terrain", "sim", "noiseLandmass.ts"), "utf8");
  if (!source.includes("shapeIslandBoundary") || /falloffStart|acceleratedInfluence|edgeInfluence \* edgeInfluence/.test(source)) {
    throw new Error("Surface is not using the shared continuous square-bump boundary conversion.");
  }
};

const assertIsolatedUpliftPreview = () => {
  for (const archetype of archetypes) {
    const recipe = createDefaultTerrainRecipe(sizeId, archetype);
    const result = buildPreview(recipe, "uplift").result;
    const replay = buildPreview(recipe, "uplift").result;
    for (const [label, field] of [
      ["uplift", result.archetypeUpliftMap],
      ["basin", result.archetypeBasinMap],
      ["coastline", result.coastlineEnvelopeMap],
      ["scalar", result.debugScalarField]
    ]) {
      if (!(field instanceof Float32Array) || field.length !== result.elevationMap.length) {
        throw new Error(`${archetype}: isolated Uplift preview is missing its ${label} field.`);
      }
    }
    if (hashArrays(result.elevationMap, result.debugScalarField) !== hashArrays(replay.elevationMap, replay.debugScalarField)) {
      throw new Error(`${archetype}: isolated Uplift preview is not deterministic.`);
    }
    if (archetype === "NONE") {
      if (fieldRange(result.elevationMap) > 0.013 || fieldRange(result.archetypeUpliftMap) > 0 || fieldRange(result.archetypeBasinMap) > 0) {
        throw new Error(`NONE Uplift preview must remain essentially flat and field-neutral.`);
      }
      if (fieldRange(result.debugScalarField) < 0.05) {
        throw new Error("NONE Uplift preview lost its subdued coastline-envelope context.");
      }
      continue;
    }
    const morphologySignal = Float32Array.from(
      result.archetypeUpliftMap,
      (uplift, index) => uplift - (result.archetypeBasinMap[index] ?? 0) * 0.3
    );
    const correlation = fieldCorrelation(result.elevationMap, morphologySignal);
    if (correlation < 0.9 || fieldRange(result.elevationMap) < 0.08 || fieldRange(result.debugScalarField) < 0.1) {
      throw new Error(`${archetype}: Uplift presentation does not clearly follow its isolated field: ${JSON.stringify({ correlation, elevationRange: fieldRange(result.elevationMap), scalarRange: fieldRange(result.debugScalarField) })}`);
    }
  }
};

const assertEditorErosionPreview = () => {
  const source = readFileSync(path.join(repoRoot, "src", "ui", "map-editor.ts"), "utf8");
  if (!/erosion:\s*{[\s\S]*?stopAfterPhase:\s*"terrain:erosion"[\s\S]*?sampleSource:\s*"snapshot"/.test(source)) {
    throw new Error("Map editor Erosion step must target the deterministic terrain:erosion snapshot.");
  }
  if (!/MAP_EDITOR_EROSION_COMPARE_PREVIEW[\s\S]*?stopAfterPhase:\s*"terrain:elevation"/.test(source)) {
    throw new Error("Map editor erosion comparison must retain the terrain:elevation baseline.");
  }
  for (const field of ["archetypeUplift", "flowAccumulation", "erosionWear", "erosionDeposit", "rockExposure"]) {
    if (!source.includes(`value: "${field}"`)) {
      throw new Error(`Map editor terrain overlay is missing ${field}.`);
    }
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

const assertEditorBiomesBeforeSettlements = () => {
  const source = readFileSync(path.join(repoRoot, "src", "ui", "map-editor.ts"), "utf8");
  if (!/biomes:\s*{[\s\S]*?stopAfterPhase:\s*"biome:classify"[\s\S]*?sampleSource:\s*"snapshot"/.test(source)) {
    throw new Error("Map editor Biomes step must target the staged biome:classify snapshot.");
  }
  if (!/MAP_EDITOR_STEP_SEQUENCE[\s\S]*?"rivers"[\s\S]*?"biomes"[\s\S]*?"settlements"/.test(source)) {
    throw new Error("Map editor Biomes step must sit between Rivers/Lakes and Settlements.");
  }
  if (!/"settlements"[\s\S]*?stopAfterPhase:\s*"roads:connect"/.test(source)) {
    throw new Error("Map editor Settlements step must remain the road network step after Biomes.");
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
  const minimumStdev = archetype === "SHELF" ? 0.014 : archetype === "NONE" ? 0.018 : 0.02;
  if (stdev < minimumStdev) {
    throw new Error(`Water preview contour is too uniform for ${archetype}: ${JSON.stringify({ stdev, min: Math.min(...radii), max: Math.max(...radii) })}`);
  }
};

const assertArchetypesMoveCoastlinePlan = () => {
  const neutral = buildPreview(createDefaultTerrainRecipe(sizeId, "NONE"), "water").result;
  for (const archetype of archetypes.filter((value) => value !== "NONE")) {
    const result = buildPreview(createDefaultTerrainRecipe(sizeId, archetype), "water").result;
    let changed = 0;
    for (let index = 0; index < result.oceanMask.length; index += 1) {
      if (result.oceanMask[index] !== neutral.oceanMask[index]) changed += 1;
    }
    const changedRatio = changed / Math.max(1, result.oceanMask.length);
    if (changedRatio < 0.035 || changedRatio > 0.18) {
      throw new Error(`${archetype}: named archetype coastline authority is outside the bounded visible range: ${changedRatio}`);
    }
  }
};

const assertNeutralSurfaceDoesNotCreateCentralSpine = () => {
  const recipe = createDefaultTerrainRecipe(sizeId, "NONE");
  const uplift = buildPreview(recipe, "uplift").result.elevationMap;
  const surface = buildPreview(recipe, "surface").result.elevationMap;
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
      const lift = Math.max(0, (surface[idx] ?? 0) - (uplift[idx] ?? 0));
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
  const upliftBase = summarizeResult("MASSIF", "uplift", buildPreview(base, "uplift").result, 0);
  const upliftLong = summarizeResult("LONG_SPINE", "uplift", buildPreview(longSpine, "uplift").result, 0);
  if (upliftBase.hash === upliftLong.hash || Math.abs(upliftBase.elevationVariance - upliftLong.elevationVariance) < 0.0003) {
    throw new Error(`Archetype did not visibly change uplift metrics: ${JSON.stringify({ upliftBase, upliftLong })}`);
  }
  const lowUplift = summarizeResult(
    "MASSIF",
    "uplift",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.relief = 0.18;
      recipe.advancedOverrides.maxHeight = 0.4;
      recipe.advancedOverrides.uplandDistribution = 0.2;
    }), "uplift").result,
    0
  );
  const highUplift = summarizeResult(
    "MASSIF",
    "uplift",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.relief = 0.95;
      recipe.advancedOverrides.maxHeight = 1.5;
      recipe.advancedOverrides.uplandDistribution = 0.88;
    }), "uplift").result,
    0
  );
  if (lowUplift.hash === highUplift.hash || highUplift.elevationVariance <= lowUplift.elevationVariance * 1.12) {
    throw new Error(`Uplift controls did not strengthen or broaden the isolated field: ${JSON.stringify({ lowUplift, highUplift })}`);
  }

  const shapedWater = summarizeResult(
    "MASSIF",
    "water",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.coastComplexity = 0.95;
      recipe.landCoverageTarget = 0.78;
      recipe.advancedOverrides.embayment = 0.9;
    }), "water").result,
    0
  );
  const waterBase = summarizeResult("MASSIF", "water", buildPreview(base, "water").result, 0);
  if (waterBase.hash === shapedWater.hash) {
    throw new Error(`Water shaping controls did not move coastline metrics: ${JSON.stringify({ waterBase, shapedWater })}`);
  }
  const highLandDryUplift = summarizeResult(
    "MASSIF",
    "uplift",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.landCoverageTarget = 0.78;
    }), "uplift").result,
    0
  );
  if (highLandDryUplift.hash !== upliftBase.hash) {
    throw new Error(`Land coverage target changed dry uplift preview: ${JSON.stringify({ upliftBase, highLandDryUplift })}`);
  }
  const lowRelief = summarizeResult(
    "MASSIF",
    "surface",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.relief = 0.18;
      recipe.ruggedness = 0.12;
      recipe.advancedOverrides.maxHeight = 0.12;
    }), "surface").result,
    0
  );
  const highRelief = summarizeResult(
    "MASSIF",
    "surface",
    buildPreview(withRecipeChange(base, (recipe) => {
      recipe.relief = 0.95;
      recipe.ruggedness = 0.95;
      recipe.advancedOverrides.maxHeight = 1.5;
    }), "surface").result,
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

};

assertEditorControlSchema();
assertEditorUpliftSequence();
assertScenarioNoiseIsArchetypeIndependent();
assertIsolatedUpliftPreview();
assertSurfaceDeformsScenarioTowardUplift();
assertSurfaceUsesNoiseLedBoundaryShaping();
assertEditorErosionPreview();
assertEditorRiversAreStaged();
assertEditorBiomesBeforeSettlements();
assertNeutralSurfaceDoesNotCreateCentralSpine();
assertArchetypesMoveCoastlinePlan();
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

const hashMismatches = runs
  .map((run) => ({
    archetype: run.archetype,
    mode: run.mode,
    expected: EXPECTED_HASHES[run.archetype]?.[run.mode],
    actual: run.hash
  }))
  .filter((entry) => entry.actual !== entry.expected);
if (hashMismatches.length > 0) {
  throw new Error(`Fast preview hashes changed: ${JSON.stringify(hashMismatches)}`);
}

if (runs.some((run) => run.riverRatio > 0)) {
  throw new Error(`Fast preview produced river coverage before the staged river phase: ${JSON.stringify(runs)}`);
}

for (const run of runs) {
  if (run.mode === "uplift" || run.mode === "surface") {
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
