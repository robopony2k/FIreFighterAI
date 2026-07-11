import { performance } from "node:perf_hooks";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const baselinePath = path.join(repoRoot, "docs", "mapgen-regression-baseline.json");
const writeBaseline = process.argv.includes("--write-baseline");

const distImport = (segments) => pathToFileURL(path.join(repoRoot, "dist", ...segments)).href;

const { COAST_CLASS_CLIFF, createInitialState, resetState } = await import(distImport(["core", "state.js"]));
const { RNG } = await import(distImport(["core", "rng.js"]));
const { MAP_SIZE_PRESETS } = await import(distImport(["core", "config.js"]));
const { HOUSE_VARIANTS } = await import(distImport(["core", "buildingFootprints.js"]));
const { getHouseFootprintBounds, pickHouseFootprint } = await import(distImport(["core", "houseFootprints.js"]));
const { findBestRoadReferenceForPlot, pickHouseRotationFromRoadMask } = await import(distImport(["core", "roadAlignment.js"]));
const { FOREST_AGE_CAP_YEARS, getVegetationMaturity01 } = await import(distImport(["core", "vegetation.js"]));
const { generateMap } = await import(distImport(["mapgen", "index.js"]));
const { compileTerrainRecipe, createDefaultTerrainRecipe } = await import(distImport(["mapgen", "terrainProfile.js"]));
const {
  analyzeRoadSurfaceMetrics,
  carveRoad,
  carveRoadToTarget,
  connectRoadPoints,
  getRoadGenerationStats,
  pruneRoadConnectorArtifacts,
  resetRoadGenerationStats,
  setRoadPathDebugHooks
} = await import(distImport(["mapgen", "roads.js"]));
const { computeRenderedSlopeAngleDeg } = await import(distImport(["shared", "terrainSlope.js"]));

const allSizes = ["medium", "massive", "colossal", "gigantic", "titanic"];
const quickSizes = ["medium", "massive"];
const fullMode = process.argv.includes("--full");
const syntheticRoadsOnly = process.argv.includes("--synthetic-roads-only");
const argValue = (prefix) => process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
const sizeFilter = argValue("--size=");
const seedFilter = argValue("--seed=");
const sizes = sizeFilter ? [sizeFilter] : fullMode ? allSizes : quickSizes;
const seeds = seedFilter ? [Number(seedFilter)] : fullMode ? [1337] : [1337, 2, 4, 9001];

const buildRegressionTile = (type = "grass", overrides = {}) => ({
  type,
  fuel: type === "road" ? 0 : 0.55,
  fire: 0,
  isBase: false,
  elevation: 0.22,
  heat: 0,
  ignitionPoint: 0.8,
  burnRate: 0.7,
  heatOutput: 1,
  spreadBoost: 1,
  heatTransferCap: 5,
  heatRetention: type === "road" ? 0.55 : 0.95,
  windFactor: type === "road" ? 0 : 0.35,
  moisture: 0.58,
  waterDist: 10,
  vegetationAgeYears: 1,
  canopy: 0,
  canopyCover: 0,
  stemDensity: 0,
  dominantTreeType: null,
  treeType: null,
  houseValue: 0,
  houseResidents: 0,
  houseDestroyed: false,
  ashAge: 0,
  ...overrides
});

const EXPECTED_STAGE_PHASE_ORDER = [
  "terrain:elevation",
  "terrain:erosion",
  "hydro:solve",
  "terrain:shoreline",
  "hydro:rivers",
  "biome:fields",
  "biome:spread",
  "biome:classify",
  "settlement:place",
  "roads:connect",
  "reconcile:postSettlement",
  "map:finalize"
];
const EXPECTED_DEBUG_PHASE_ORDER = [
  "terrain:relief",
  "terrain:carving",
  "terrain:flooding",
  "terrain:elevation",
  ...EXPECTED_STAGE_PHASE_ORDER
];
const DEBUG_SMOKE_CASES = [
  { sizeId: "medium", seed: 1337, stopAfterPhase: "terrain:elevation" },
  { sizeId: "medium", seed: 1337, stopAfterPhase: "biome:spread" },
  { sizeId: "medium", seed: 1337, stopAfterPhase: "reconcile:postSettlement" }
];
const MIN_READABLE_LAKE_OUTLET_TILES = 4;
const MAX_SOURCE_LAKE_ADJACENT_OUTLET_TILES = 2;
const OUTLET_DIRECT_DESCENT_MARGIN = 0.008;

const createGrid = (sizeId) => {
  const dim = MAP_SIZE_PRESETS[sizeId];
  if (!Number.isFinite(dim)) {
    throw new Error(`Unknown map size '${sizeId}'.`);
  }
  return { cols: dim, rows: dim, totalTiles: dim * dim };
};

const validateHouseParcels = () => {
  const invalid = HOUSE_VARIANTS.filter((variant) => variant.parcelX < 1.25 || variant.parcelZ < 1);
  if (invalid.length > 0) {
    const detail = invalid
      .map((variant) => `${variant.source}:${variant.parcelX.toFixed(3)}x${variant.parcelZ.toFixed(3)}`)
      .join(", ");
    throw new Error(`[mapgen] invalid house parcel sizing: ${detail}`);
  }
};

const assertPhaseOrder = (actual, expected, label) => {
  if (actual.length !== expected.length) {
    throw new Error(
      `[mapgen] ${label} phase count mismatch: expected ${expected.length}, got ${actual.length} (${actual.join(" -> ")})`
    );
  }
  for (let i = 0; i < expected.length; i += 1) {
    if (actual[i] !== expected[i]) {
      throw new Error(
        `[mapgen] ${label} phase order mismatch at index ${i}: expected ${expected[i]}, got ${actual[i]} (${actual.join(" -> ")})`
      );
    }
  }
};

const assertSnapshotShape = (snapshot, totalTiles, label) => {
  if (!(snapshot.elevations instanceof Float32Array) || snapshot.elevations.length !== totalTiles) {
    throw new Error(`[mapgen] ${label} invalid elevations payload for ${snapshot.phase}`);
  }
  if (!(snapshot.tileTypes instanceof Uint8Array) || snapshot.tileTypes.length !== totalTiles) {
    throw new Error(`[mapgen] ${label} invalid tileTypes payload for ${snapshot.phase}`);
  }
  if (snapshot.riverMask && (!(snapshot.riverMask instanceof Uint8Array) || snapshot.riverMask.length !== totalTiles)) {
    throw new Error(`[mapgen] ${label} invalid riverMask payload for ${snapshot.phase}`);
  }
  if (snapshot.oceanMask && (!(snapshot.oceanMask instanceof Uint8Array) || snapshot.oceanMask.length !== totalTiles)) {
    throw new Error(`[mapgen] ${label} invalid oceanMask payload for ${snapshot.phase}`);
  }
  if (snapshot.lakeMask && (!(snapshot.lakeMask instanceof Uint16Array) || snapshot.lakeMask.length !== totalTiles)) {
    throw new Error(`[mapgen] ${label} invalid lakeMask payload for ${snapshot.phase}`);
  }
  if (snapshot.lakeSurface && (!(snapshot.lakeSurface instanceof Float32Array) || snapshot.lakeSurface.length !== totalTiles)) {
    throw new Error(`[mapgen] ${label} invalid lakeSurface payload for ${snapshot.phase}`);
  }
  if (
    snapshot.waterfallTarget &&
    (!(snapshot.waterfallTarget instanceof Int32Array) || snapshot.waterfallTarget.length !== totalTiles)
  ) {
    throw new Error(`[mapgen] ${label} invalid waterfallTarget payload for ${snapshot.phase}`);
  }
  if (snapshot.seaLevel && (!(snapshot.seaLevel instanceof Float32Array) || snapshot.seaLevel.length !== totalTiles)) {
    throw new Error(`[mapgen] ${label} invalid seaLevel payload for ${snapshot.phase}`);
  }
  if (
    snapshot.coastDistance &&
    (!(snapshot.coastDistance instanceof Uint16Array) || snapshot.coastDistance.length !== totalTiles)
  ) {
    throw new Error(`[mapgen] ${label} invalid coastDistance payload for ${snapshot.phase}`);
  }
  if (snapshot.coastClass && (!(snapshot.coastClass instanceof Uint8Array) || snapshot.coastClass.length !== totalTiles)) {
    throw new Error(`[mapgen] ${label} invalid coastClass payload for ${snapshot.phase}`);
  }
  for (const field of ["rawMoisture", "elevationStress", "slopeStress", "treeSuitability", "treeProbability", "rainfall", "runoff", "waterfallDrop"]) {
    const value = snapshot[field];
    if (value && (!(value instanceof Float32Array) || value.length !== totalTiles)) {
      throw new Error(`[mapgen] ${label} invalid ${field} payload for ${snapshot.phase}`);
    }
  }
  for (const field of ["lakeOutletMask", "riverLakeEntryMask", "riverLakeExitMask", "waterfallSourceMask", "hydrologyFeatureClass"]) {
    const value = snapshot[field];
    if (value && (!(value instanceof Uint8Array) || value.length !== totalTiles)) {
      throw new Error(`[mapgen] ${label} invalid ${field} payload for ${snapshot.phase}`);
    }
  }
};

const getExpectedStagePrefix = (stopAfterPhase) => {
  const stopIndex = EXPECTED_STAGE_PHASE_ORDER.indexOf(stopAfterPhase);
  if (stopIndex < 0) {
    throw new Error(`[mapgen] unknown stage phase: ${stopAfterPhase}`);
  }
  return EXPECTED_STAGE_PHASE_ORDER.slice(0, stopIndex + 1);
};

const getExpectedDebugPrefix = (stopAfterPhase) => [
  "terrain:relief",
  "terrain:carving",
  "terrain:flooding",
  "terrain:elevation",
  ...getExpectedStagePrefix(stopAfterPhase)
];

const analyzeForestPatches = (state) => {
  const { cols, rows, totalTiles } = state.grid;
  const visited = new Uint8Array(totalTiles);
  const queue = new Int32Array(totalTiles);
  const sizes = [];
  for (let i = 0; i < totalTiles; i += 1) {
    if (visited[i] > 0 || state.tiles[i]?.type !== "forest") {
      continue;
    }
    let head = 0;
    let tail = 0;
    queue[tail] = i;
    tail += 1;
    visited[i] = 1;
    let area = 0;
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      area += 1;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      if (x > 0) {
        const n = idx - 1;
        if (visited[n] === 0 && state.tiles[n]?.type === "forest") {
          visited[n] = 1;
          queue[tail] = n;
          tail += 1;
        }
      }
      if (x < cols - 1) {
        const n = idx + 1;
        if (visited[n] === 0 && state.tiles[n]?.type === "forest") {
          visited[n] = 1;
          queue[tail] = n;
          tail += 1;
        }
      }
      if (y > 0) {
        const n = idx - cols;
        if (visited[n] === 0 && state.tiles[n]?.type === "forest") {
          visited[n] = 1;
          queue[tail] = n;
          tail += 1;
        }
      }
      if (y < rows - 1) {
        const n = idx + cols;
        if (visited[n] === 0 && state.tiles[n]?.type === "forest") {
          visited[n] = 1;
          queue[tail] = n;
          tail += 1;
        }
      }
    }
    sizes.push(area);
  }
  if (sizes.length === 0) {
    return { forestPatchCount: 0, forestPatchMean: 0, forestPatchP95: 0 };
  }
  sizes.sort((a, b) => a - b);
  const mean = sizes.reduce((sum, value) => sum + value, 0) / sizes.length;
  const p95Index = Math.min(sizes.length - 1, Math.floor((sizes.length - 1) * 0.95));
  return {
    forestPatchCount: sizes.length,
    forestPatchMean: Number(mean.toFixed(2)),
    forestPatchP95: sizes[p95Index]
  };
};

const buildOceanMask = (state) => {
  const { cols, rows, totalTiles } = state.grid;
  const riverMask = state.tileRiverMask;
  const oceanMask = new Uint8Array(totalTiles);
  const queue = new Int32Array(totalTiles);
  let head = 0;
  let tail = 0;
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return;
    }
    const idx = y * cols + x;
    if (oceanMask[idx] > 0) {
      return;
    }
    if (state.tiles[idx]?.type !== "water") {
      return;
    }
    if (riverMask[idx] > 0) {
      return;
    }
    oceanMask[idx] = 1;
    queue[tail] = idx;
    tail += 1;
  };

  for (let x = 0; x < cols; x += 1) {
    push(x, 0);
    push(x, rows - 1);
  }
  for (let y = 1; y < rows - 1; y += 1) {
    push(0, y);
    push(cols - 1, y);
  }

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const neighbors = [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1]
    ];
    for (let i = 0; i < neighbors.length; i += 1) {
      const [nx, ny] = neighbors[i];
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = ny * cols + nx;
      if (oceanMask[nIdx] > 0) {
        continue;
      }
      if (state.tiles[nIdx]?.type !== "water" || riverMask[nIdx] > 0) {
        continue;
      }
      oceanMask[nIdx] = 1;
      queue[tail] = nIdx;
      tail += 1;
    }
  }

  return oceanMask;
};

const analyzeRiverConnectivity = (state) => {
  const { cols, rows, totalTiles } = state.grid;
  const riverMask = state.tileRiverMask;
  const lakeMask = state.tileLakeMask ?? new Uint16Array(totalTiles);
  const oceanMask = buildOceanMask(state);
  let riverCells = 0;
  let diagOnlyLinks = 0;
  let isolatedCells = 0;
  let orthConnectedCells = 0;
  let riverComponentCount = 0;
  let detachedRiverComponents = 0;
  let detachedRiverCells = 0;
  const riverHashParts = [];
  const hasRiver = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && riverMask[y * cols + x] > 0;
  const hasHydrologyPath = (x, y) =>
    x >= 0 && y >= 0 && x < cols && y < rows && (riverMask[y * cols + x] > 0 || lakeMask[y * cols + x] > 0);
  for (let i = 0; i < totalTiles; i += 1) {
    if (!(riverMask[i] > 0)) {
      continue;
    }
    riverCells += 1;
    riverHashParts.push((i * 131 + 17) >>> 0);
    const x = i % cols;
    const y = Math.floor(i / cols);
    const orthCount =
      (hasHydrologyPath(x - 1, y) ? 1 : 0) +
      (hasHydrologyPath(x + 1, y) ? 1 : 0) +
      (hasHydrologyPath(x, y - 1) ? 1 : 0) +
      (hasHydrologyPath(x, y + 1) ? 1 : 0);
    const diagCount =
      (hasRiver(x - 1, y - 1) ? 1 : 0) +
      (hasRiver(x + 1, y - 1) ? 1 : 0) +
      (hasRiver(x - 1, y + 1) ? 1 : 0) +
      (hasRiver(x + 1, y + 1) ? 1 : 0);
    if (orthCount > 0) {
      orthConnectedCells += 1;
    } else if (diagCount > 0) {
      diagOnlyLinks += 1;
    } else {
      isolatedCells += 1;
    }
  }
  const visited = new Uint8Array(totalTiles);
  const queue = new Int32Array(totalTiles);
  for (let i = 0; i < totalTiles; i += 1) {
    if (visited[i] > 0 || (riverMask[i] === 0 && lakeMask[i] === 0)) {
      continue;
    }
    riverComponentCount += 1;
    let head = 0;
    let tail = 0;
    queue[tail] = i;
    tail += 1;
    visited[i] = 1;
    let size = 0;
    let touchesEdge = false;
    let touchesOcean = false;
    let hasRiverCell = false;
    let hasLakeCell = false;
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      size += 1;
      if (riverMask[idx] > 0) {
        hasRiverCell = true;
      }
      if (lakeMask[idx] > 0) {
        hasLakeCell = true;
      }
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
        touchesEdge = true;
      }
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ];
      for (let n = 0; n < neighbors.length; n += 1) {
        const [nx, ny] = neighbors[n];
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          continue;
        }
        const nIdx = ny * cols + nx;
        if (riverMask[nIdx] > 0 || lakeMask[nIdx] > 0) {
          if (visited[nIdx] === 0) {
            visited[nIdx] = 1;
            queue[tail] = nIdx;
            tail += 1;
          }
          continue;
        }
        if (oceanMask[nIdx] > 0) {
          touchesOcean = true;
        }
      }
    }
    if (hasRiverCell && !hasLakeCell && !touchesEdge && !touchesOcean) {
      detachedRiverComponents += 1;
      detachedRiverCells += size;
    }
  }
  return {
    riverTopologyHash: riverHashParts.reduce((hash, value) => Math.imul(hash ^ value, 16777619) >>> 0, 2166136261),
    riverDiagOnlyLinks: diagOnlyLinks,
    riverIsolatedCells: isolatedCells,
    riverOrthConnectivityRatio: Number((riverCells > 0 ? orthConnectedCells / riverCells : 1).toFixed(4)),
    riverComponentCount,
    detachedRiverComponents,
    detachedRiverCells
  };
};

const analyzeStaticHydrology = (state) => {
  const { cols, rows, totalTiles } = state.grid;
  const lakeMask = state.tileLakeMask ?? new Uint16Array(totalTiles);
  const oceanMask = state.tileOceanMask ?? new Uint8Array(totalTiles);
  const riverMask = state.tileRiverMask ?? new Uint8Array(totalTiles);
  let lakeTiles = 0;
  let lakeOutletCount = 0;
  let lakeOutletAdjacentRiverCount = 0;
  let lakeOutletReadableCount = 0;
  let lakeOutletConnectionFailures = 0;
  let lakeOutletShortRiverFailures = 0;
  let lakeOutletShorelineLapFailures = 0;
  let lakeOutletLateralStartFailures = 0;
  let lakeInvariantFailures = 0;
  let lakeBedFailures = 0;
  let lakeSurfaceConsistencyFailures = 0;
  let lakeOutletSurfaceFailures = 0;
  let lakeOceanAdjacent = 0;
  let waterfallCount = 0;
  let invalidWaterfalls = 0;
  const lakeIds = new Set();
  const lakeSurfaceById = new Map();
  const visited = new Uint8Array(totalTiles);
  const queue = new Int32Array(totalTiles);
  let lakeComponentCount = 0;
  const lakeHashParts = [];
  const waterfallHashParts = [];
  const idxAt = (x, y) => y * cols + x;
  const countAdjacentLakeTiles = (idx, lakeId) => {
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    let count = 0;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      if ((lakeMask[idxAt(nx, ny)] ?? 0) === lakeId) {
        count += 1;
      }
    }
    return count;
  };
  const traceOutletRiver = (outletIdx, lakeId) => {
    const outletX = outletIdx % cols;
    const outletY = Math.floor(outletIdx / cols);
    const visitedRiver = new Uint8Array(totalTiles);
    let head = 0;
    let tail = 0;
    let riverLength = 0;
    let touchesOcean = false;
    let touchesOtherLake = false;
    let directTerminal = false;
    let sourceLakeAdjacentRiverCells = 0;
    const firstRiverTiles = [];

    for (const [nx, ny] of [[outletX - 1, outletY], [outletX + 1, outletY], [outletX, outletY - 1], [outletX, outletY + 1]]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = idxAt(nx, ny);
      const neighborLakeId = lakeMask[nIdx] ?? 0;
      if (oceanMask[nIdx] > 0 || (neighborLakeId > 0 && neighborLakeId !== lakeId)) {
        directTerminal = true;
      }
      if (lakeMask[nIdx] !== lakeId && riverMask[nIdx] > 0 && visitedRiver[nIdx] === 0) {
        visitedRiver[nIdx] = 1;
        queue[tail] = nIdx;
        tail += 1;
        firstRiverTiles.push(nIdx);
      }
    }

    while (head < tail) {
      const idx = queue[head];
      head += 1;
      riverLength += 1;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      if (countAdjacentLakeTiles(idx, lakeId) > 0) {
        sourceLakeAdjacentRiverCells += 1;
      }
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          continue;
        }
        const nIdx = idxAt(nx, ny);
        const neighborLakeId = lakeMask[nIdx] ?? 0;
        if (oceanMask[nIdx] > 0) {
          touchesOcean = true;
          continue;
        }
        if (neighborLakeId > 0 && neighborLakeId !== lakeId) {
          touchesOtherLake = true;
          continue;
        }
        if (riverMask[nIdx] === 0 || lakeMask[nIdx] === lakeId || visitedRiver[nIdx] > 0) {
          continue;
        }
        visitedRiver[nIdx] = 1;
        queue[tail] = nIdx;
        tail += 1;
      }
    }

    return {
      riverLength,
      directTerminal,
      touchesOcean,
      touchesOtherLake,
      sourceLakeAdjacentRiverCells,
      firstRiverTiles,
      readable: directTerminal || riverLength >= MIN_READABLE_LAKE_OUTLET_TILES
    };
  };
  const hasLateralOutletStart = (outletIdx, lakeId, firstRiverTiles) => {
    if (firstRiverTiles.length === 0) {
      return false;
    }
    const outletSurface = state.tileLakeSurface?.[outletIdx] ?? state.tiles[outletIdx]?.elevation ?? Number.NaN;
    if (!Number.isFinite(outletSurface)) {
      return false;
    }
    const x = outletIdx % cols;
    const y = Math.floor(outletIdx / cols);
    let bestAvailableDrop = 0;
    for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const nIdx = idxAt(nx, ny);
      if ((lakeMask[nIdx] ?? 0) === lakeId || oceanMask[nIdx] > 0) {
        continue;
      }
      const elevation = state.tiles[nIdx]?.elevation ?? state.tileElevation?.[nIdx] ?? outletSurface;
      bestAvailableDrop = Math.max(bestAvailableDrop, outletSurface - elevation);
    }
    let chosenDrop = 0;
    for (const riverIdx of firstRiverTiles) {
      const riverSurface = state.tileRiverSurface?.[riverIdx] ?? state.tiles[riverIdx]?.elevation ?? outletSurface;
      chosenDrop = Math.max(chosenDrop, outletSurface - riverSurface);
    }
    return bestAvailableDrop > OUTLET_DIRECT_DESCENT_MARGIN && chosenDrop + OUTLET_DIRECT_DESCENT_MARGIN < bestAvailableDrop;
  };
  for (let idx = 0; idx < totalTiles; idx += 1) {
    const lakeId = lakeMask[idx] ?? 0;
    if (lakeId > 0) {
      lakeTiles += 1;
      lakeIds.add(lakeId);
      lakeHashParts.push((idx * 131 + lakeId * 17) >>> 0);
      const tile = state.tiles[idx];
      if (!tile || tile.type !== "water" || tile.fuel !== 0 || tile.moisture !== 1 || tile.waterDist !== 0) {
        lakeInvariantFailures += 1;
      }
      const lakeSurface = state.tileLakeSurface?.[idx] ?? Number.NaN;
      if (tile && Number.isFinite(lakeSurface) && tile.elevation > lakeSurface - 0.001) {
        lakeBedFailures += 1;
      }
      if (!Number.isFinite(lakeSurface)) {
        lakeSurfaceConsistencyFailures += 1;
      } else if (!lakeSurfaceById.has(lakeId)) {
        lakeSurfaceById.set(lakeId, lakeSurface);
      } else if (Math.abs(lakeSurfaceById.get(lakeId) - lakeSurface) > 0.0005) {
        lakeSurfaceConsistencyFailures += 1;
      }
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          continue;
        }
        if (oceanMask[idxAt(nx, ny)] > 0) {
          lakeOceanAdjacent += 1;
          break;
        }
      }
    }
    if (state.tileLakeOutletMask?.[idx] > 0) {
      lakeOutletCount += 1;
      const lakeId = lakeMask[idx] ?? 0;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      const outletTrace = traceOutletRiver(idx, lakeId);
      if (outletTrace.riverLength > 0) {
        lakeOutletAdjacentRiverCount += 1;
      }
      if (outletTrace.readable) {
        lakeOutletReadableCount += 1;
      } else {
        lakeOutletShortRiverFailures += 1;
      }
      if (outletTrace.sourceLakeAdjacentRiverCells > MAX_SOURCE_LAKE_ADJACENT_OUTLET_TILES) {
        lakeOutletShorelineLapFailures += 1;
      }
      if (hasLateralOutletStart(idx, lakeId, outletTrace.firstRiverTiles)) {
        lakeOutletLateralStartFailures += 1;
      }
      const connected = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          return false;
        }
        const nIdx = idxAt(nx, ny);
        return lakeMask[nIdx] !== lakeId && riverMask[nIdx] > 0;
      });
      if (!connected) {
        lakeOutletConnectionFailures += 1;
      } else {
        const lakeSurface = state.tileLakeSurface?.[idx] ?? Number.NaN;
        const hasDownstreamSurface = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]].some(([nx, ny]) => {
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
            return false;
          }
          const nIdx = idxAt(nx, ny);
          const riverSurface = state.tileRiverSurface?.[nIdx] ?? Number.NaN;
          return lakeMask[nIdx] !== lakeId && riverMask[nIdx] > 0 && Number.isFinite(riverSurface) && riverSurface <= lakeSurface + 0.001;
        });
        if (!Number.isFinite(lakeSurface) || !hasDownstreamSurface) {
          lakeOutletSurfaceFailures += 1;
        }
      }
    }
    if (state.tileWaterfallSourceMask?.[idx] > 0) {
      waterfallCount += 1;
      const target = state.tileWaterfallTarget?.[idx] ?? -1;
      const drop = state.tileWaterfallDrop?.[idx] ?? 0;
      waterfallHashParts.push((idx * 131 + target * 17 + Math.round(drop * 10_000)) >>> 0);
      if (
        target < 0 ||
        target >= totalTiles ||
        drop <= 0 ||
        oceanMask[idx] > 0 ||
        lakeMask[target] > 0 ||
        riverMask[target] === 0 ||
        (riverMask[idx] === 0 && lakeMask[idx] === 0)
      ) {
        invalidWaterfalls += 1;
      }
    }
  }
  for (let i = 0; i < totalTiles; i += 1) {
    if (visited[i] > 0 || lakeMask[i] === 0) {
      continue;
    }
    lakeComponentCount += 1;
    let head = 0;
    let tail = 0;
    queue[tail] = i;
    tail += 1;
    visited[i] = 1;
    const lakeId = lakeMask[i];
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      for (const [nx, ny] of [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]]) {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          continue;
        }
        const nIdx = idxAt(nx, ny);
        if (visited[nIdx] === 0 && lakeMask[nIdx] === lakeId) {
          visited[nIdx] = 1;
          queue[tail] = nIdx;
          tail += 1;
        }
      }
    }
  }
  const lakeHash = lakeHashParts.reduce((hash, value) => Math.imul(hash ^ value, 16777619) >>> 0, 2166136261);
  const waterfallHash = waterfallHashParts.reduce(
    (hash, value) => Math.imul(hash ^ value, 16777619) >>> 0,
    2166136261
  );
  return {
    lakeTiles,
    lakeCount: lakeIds.size,
    lakeComponentCount,
    lakeOutletCount,
    lakeOutletAdjacentRiverCount,
    lakeOutletReadableCount,
    lakeOutletConnectionFailures,
    lakeOutletShortRiverFailures,
    lakeOutletShorelineLapFailures,
    lakeOutletLateralStartFailures,
    lakeInvariantFailures,
    lakeBedFailures,
    lakeSurfaceConsistencyFailures,
    lakeOutletSurfaceFailures,
    lakeOceanAdjacent,
    waterfallCount,
    invalidWaterfalls,
    lakeHash,
    waterfallHash
  };
};

const analyzeHydrologyDiagnostics = (events, state) => {
  const riverMask = state.tileRiverMask ?? new Uint8Array(state.grid.totalTiles);
  const lakeMask = state.tileLakeMask ?? new Uint16Array(state.grid.totalTiles);
  const oceanMask = state.tileOceanMask ?? new Uint8Array(state.grid.totalTiles);
  let hydrologyOverflowRoutes = 0;
  let hydrologyOverflowTerminalRoutes = 0;
  let hydrologyOverflowFailedRoutes = 0;
  let hydrologyFailedOverflowCarvedTiles = 0;
  let hydrologyWaterfallRejected = 0;
  let hydrologyClassifiedRoutes = 0;
  let hydrologyClassifiedFailedRoutes = 0;
  let hydrologyClassifiedWaterfallCandidates = 0;
  let hydrologyClassifiedWaterfallLipTiles = 0;
  let hydrologyClassifiedWaterfallRunoutTiles = 0;
  let hydrologyClassifiedFailedOverflowTiles = 0;
  const hydrologyWaterfallRejectReasons = {};

  for (const event of events) {
    if (event.kind === "hydrology:overflow") {
      hydrologyOverflowRoutes += 1;
      if (event.terminalReached) {
        hydrologyOverflowTerminalRoutes += 1;
      } else {
        hydrologyOverflowFailedRoutes += 1;
        for (const idx of event.tiles ?? []) {
          if ((riverMask[idx] ?? 0) > 0 && (lakeMask[idx] ?? 0) === 0 && (oceanMask[idx] ?? 0) === 0) {
            hydrologyFailedOverflowCarvedTiles += 1;
          }
        }
      }
    }
    if (event.kind === "hydrology:waterfall" && !event.accepted) {
      hydrologyWaterfallRejected += 1;
      const reason = event.reason ?? "unknown";
      hydrologyWaterfallRejectReasons[reason] = (hydrologyWaterfallRejectReasons[reason] ?? 0) + 1;
    }
    if (event.kind === "hydrology:classification") {
      hydrologyClassifiedRoutes += event.terminalRoutes + event.failedRoutes;
      hydrologyClassifiedFailedRoutes += event.failedRoutes;
      hydrologyClassifiedWaterfallCandidates += event.waterfallCandidates;
      hydrologyClassifiedWaterfallLipTiles += event.counts?.["waterfall-lip"] ?? 0;
      hydrologyClassifiedWaterfallRunoutTiles += event.counts?.["waterfall-runout"] ?? 0;
      hydrologyClassifiedFailedOverflowTiles += event.counts?.["failed-overflow"] ?? 0;
    }
  }

  return {
    hydrologyOverflowRoutes,
    hydrologyOverflowTerminalRoutes,
    hydrologyOverflowFailedRoutes,
    hydrologyFailedOverflowCarvedTiles,
    hydrologyWaterfallRejected,
    hydrologyClassifiedRoutes,
    hydrologyClassifiedFailedRoutes,
    hydrologyClassifiedWaterfallCandidates,
    hydrologyClassifiedWaterfallLipTiles,
    hydrologyClassifiedWaterfallRunoutTiles,
    hydrologyClassifiedFailedOverflowTiles,
    hydrologyWaterfallRejectReasons
  };
};

const ROAD_EDGE_N = 1 << 0;
const ROAD_EDGE_E = 1 << 1;
const ROAD_EDGE_S = 1 << 2;
const ROAD_EDGE_W = 1 << 3;
const ROAD_EDGE_NE = 1 << 4;
const ROAD_EDGE_NW = 1 << 5;
const ROAD_EDGE_SE = 1 << 6;
const ROAD_EDGE_SW = 1 << 7;
const ROAD_EDGE_DIRS = [
  { dx: 0, dy: -1, bit: ROAD_EDGE_N },
  { dx: 1, dy: 0, bit: ROAD_EDGE_E },
  { dx: 0, dy: 1, bit: ROAD_EDGE_S },
  { dx: -1, dy: 0, bit: ROAD_EDGE_W },
  { dx: 1, dy: -1, bit: ROAD_EDGE_NE },
  { dx: -1, dy: -1, bit: ROAD_EDGE_NW },
  { dx: 1, dy: 1, bit: ROAD_EDGE_SE },
  { dx: -1, dy: 1, bit: ROAD_EDGE_SW }
];
const COMPACT_TOWN_MORPH_MIN_HOUSES = 4;
const COMPACT_TOWN_MORPH_MIN_ROADS = 10;
const COMPACT_TOWN_ASPECT_LIMIT = 2.85;

const analyzeRoadEdgeQuality = (state) => {
  const { cols, rows, totalTiles } = state.grid;
  const roadEdges = state.tileRoadEdges;
  const roadBridge = state.tileRoadBridge;
  const hasRoadEdges = !!roadEdges && roadEdges.length === totalTiles;
  const isRoadLike = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return false;
    }
    const idx = y * cols + x;
    const tile = state.tiles[idx];
    if (!tile) {
      return false;
    }
    return tile.type === "road" || tile.type === "base" || (roadBridge?.[idx] ?? 0) > 0;
  };
  const getMask = (x, y) => {
    if (!isRoadLike(x, y)) {
      return 0;
    }
    const idx = y * cols + x;
    if (hasRoadEdges) {
      let mask = roadEdges[idx] ?? 0;
      let sanitized = 0;
      for (const dir of ROAD_EDGE_DIRS) {
        if ((mask & dir.bit) === 0) {
          continue;
        }
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        if (!isRoadLike(nx, ny)) {
          continue;
        }
        sanitized |= dir.bit;
      }
      if (sanitized !== 0) {
        return sanitized;
      }
    }
    let mask = 0;
    if (isRoadLike(x, y - 1)) {
      mask |= ROAD_EDGE_N;
    }
    if (isRoadLike(x + 1, y)) {
      mask |= ROAD_EDGE_E;
    }
    if (isRoadLike(x, y + 1)) {
      mask |= ROAD_EDGE_S;
    }
    if (isRoadLike(x - 1, y)) {
      mask |= ROAD_EDGE_W;
    }
    if (isRoadLike(x + 1, y - 1)) {
      mask |= ROAD_EDGE_NE;
    }
    if (isRoadLike(x - 1, y - 1)) {
      mask |= ROAD_EDGE_NW;
    }
    if (isRoadLike(x + 1, y + 1)) {
      mask |= ROAD_EDGE_SE;
    }
    if (isRoadLike(x - 1, y + 1)) {
      mask |= ROAD_EDGE_SW;
    }
    return mask;
  };

  let roadCount = 0;
  let ignoredDiagonalCount = 0;
  let unmatchedPatternCount = 0;
  const degreeHistogram = new Map();
  const classifyPattern = (orth, diag, orthMask) => {
    if (orth === 0 && diag === 0) {
      return "isolated";
    }
    if (orth === 0) {
      return diag === 1 ? "endcap_diagonal" : "diag_only";
    }
    if (diag === 0) {
      if (orth === 1) {
        return "endcap_cardinal";
      }
      if (orth === 2) {
        const oppositeNS = (orthMask & (ROAD_EDGE_N | ROAD_EDGE_S)) === (ROAD_EDGE_N | ROAD_EDGE_S);
        const oppositeEW = (orthMask & (ROAD_EDGE_E | ROAD_EDGE_W)) === (ROAD_EDGE_E | ROAD_EDGE_W);
        return oppositeNS || oppositeEW ? "straight" : "corner";
      }
      if (orth === 3) {
        return "tee";
      }
      return "cross";
    }
    if (orth === 1) {
      return "o1d";
    }
    if (orth === 2 && diag === 1) {
      return "o2d1";
    }
    if (orth === 2 && diag >= 2) {
      return "o2d2plus";
    }
    if (orth === 3 && diag === 1) {
      return "o3d1";
    }
    if (orth >= 3 && diag >= 2) {
      return "hub_dense";
    }
    return "mixed_dense";
  };

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      if (!isRoadLike(x, y)) {
        continue;
      }
      roadCount += 1;
      const mask = getMask(x, y);
      const orthCount =
        ((mask & ROAD_EDGE_N) > 0 ? 1 : 0) +
        ((mask & ROAD_EDGE_E) > 0 ? 1 : 0) +
        ((mask & ROAD_EDGE_S) > 0 ? 1 : 0) +
        ((mask & ROAD_EDGE_W) > 0 ? 1 : 0);
      const diagCount =
        ((mask & ROAD_EDGE_NE) > 0 ? 1 : 0) +
        ((mask & ROAD_EDGE_NW) > 0 ? 1 : 0) +
        ((mask & ROAD_EDGE_SE) > 0 ? 1 : 0) +
        ((mask & ROAD_EDGE_SW) > 0 ? 1 : 0);
      const degree = orthCount + diagCount;
      degreeHistogram.set(degree, (degreeHistogram.get(degree) ?? 0) + 1);
      const family = classifyPattern(orthCount, diagCount, mask & (ROAD_EDGE_N | ROAD_EDGE_E | ROAD_EDGE_S | ROAD_EDGE_W));
      if (family === "mixed_unknown") {
        unmatchedPatternCount += 1;
      }
      const mixedHandled =
        family === "o1d" ||
        family === "o2d1" ||
        family === "o2d2plus" ||
        family === "o3d1" ||
        family === "hub_dense" ||
        family === "mixed_dense";
      if (orthCount >= 2 && diagCount > 0 && !mixedHandled) {
        ignoredDiagonalCount += 1;
      }
    }
  }

  const nodeDegreeHistogram = {};
  for (const [degree, count] of degreeHistogram.entries()) {
    nodeDegreeHistogram[String(degree)] = count;
  }

  return {
    roadCount,
    ignoredDiagonalCount,
    unmatchedPatternCount,
    nodeDegreeHistogram
  };
};

const getAuthoritativeOceanMask = (state) =>
  state.tileOceanMask && state.tileOceanMask.length === state.grid.totalTiles
    ? state.tileOceanMask
    : buildOceanMask(state);

const analyzeCoastalClassification = (state) => {
  const { cols, rows, totalTiles } = state.grid;
  const oceanMask = getAuthoritativeOceanMask(state);
  let coastalNaturalCount = 0;
  let coastalBeachCount = 0;
  let coastalRockyCount = 0;
  let coastalOtherCount = 0;
  const isNaturalLand = (type) =>
    type !== "water" && type !== "road" && type !== "base" && type !== "house";

  for (let i = 0; i < totalTiles; i += 1) {
    const tile = state.tiles[i];
    if (!tile || !isNaturalLand(tile.type)) {
      continue;
    }
    const x = i % cols;
    const y = Math.floor(i / cols);
    let touchesOcean = false;
    if (x > 0 && oceanMask[i - 1] > 0) {
      touchesOcean = true;
    } else if (x < cols - 1 && oceanMask[i + 1] > 0) {
      touchesOcean = true;
    } else if (y > 0 && oceanMask[i - cols] > 0) {
      touchesOcean = true;
    } else if (y < rows - 1 && oceanMask[i + cols] > 0) {
      touchesOcean = true;
    }
    if (!touchesOcean) {
      continue;
    }
    coastalNaturalCount += 1;
    if (tile.type === "beach") {
      coastalBeachCount += 1;
    } else if (tile.type === "rocky") {
      coastalRockyCount += 1;
    } else {
      coastalOtherCount += 1;
    }
  }

  return {
    coastalNaturalCount,
    coastalBeachCount,
    coastalRockyCount,
    coastalOtherCount
  };
};

const analyzeGeneratedCoastProfile = (state) => {
  const { cols, rows, totalTiles } = state.grid;
  const oceanMask = getAuthoritativeOceanMask(state);
  const coastSlopes = [];
  const boundaryDrops = [];
  let coastProfileCount = 0;
  let forcedCliffCount = 0;
  let cliffCount = 0;
  const sampleRelief = (idx) => {
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const center = state.tiles[idx]?.elevation ?? 0;
    let min = center;
    let max = center;
    let slope = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      const ny = y + dy;
      if (ny < 0 || ny >= rows) {
        continue;
      }
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        if (nx < 0 || nx >= cols) {
          continue;
        }
        const nIdx = ny * cols + nx;
        const elevation = state.tiles[nIdx]?.elevation ?? center;
        min = Math.min(min, elevation);
        max = Math.max(max, elevation);
        if (nIdx !== idx && oceanMask[nIdx] === 0) {
          slope = Math.max(slope, Math.abs(center - elevation));
        }
      }
    }
    return { relief: max - min, slope };
  };
  for (let i = 0; i < totalTiles; i += 1) {
    const tile = state.tiles[i];
    if (!tile || tile.type === "water" || tile.type === "road" || tile.type === "base" || tile.type === "house") {
      continue;
    }
    const coastDistance = state.tileCoastDistance?.[i] ?? 0;
    if (coastDistance <= 0 || coastDistance > 6) {
      continue;
    }
    const { relief, slope } = sampleRelief(i);
    coastSlopes.push(slope);
    coastProfileCount += 1;
    const seaLevel = state.tileSeaLevel?.[i] ?? 0;
    const heightAboveSea = tile.elevation - seaLevel;
    const coastClass = state.tileCoastClass?.[i] ?? 0;
    if (coastClass === COAST_CLASS_CLIFF) {
      cliffCount += 1;
      if (slope < 0.4 && relief < 0.22 && heightAboveSea < 0.19) {
        forcedCliffCount += 1;
      }
    }
    const x = i % cols;
    const y = Math.floor(i / cols);
    const neighbors = [
      x > 0 ? i - 1 : -1,
      x < cols - 1 ? i + 1 : -1,
      y > 0 ? i - cols : -1,
      y < rows - 1 ? i + cols : -1
    ];
    for (const nIdx of neighbors) {
      if (nIdx < 0 || oceanMask[nIdx] === 0) {
        continue;
      }
      boundaryDrops.push(tile.elevation - (state.tiles[nIdx]?.elevation ?? tile.elevation));
    }
  }
  coastSlopes.sort((a, b) => a - b);
  const coastSlopeMean = coastSlopes.reduce((sum, value) => sum + value, 0) / Math.max(1, coastSlopes.length);
  const coastSlopeP95 = coastSlopes.length > 0
    ? coastSlopes[Math.min(coastSlopes.length - 1, Math.floor((coastSlopes.length - 1) * 0.95))]
    : 0;
  const boundaryDropMean = boundaryDrops.reduce((sum, value) => sum + value, 0) / Math.max(1, boundaryDrops.length);
  const boundaryDropMax = Math.max(0, ...boundaryDrops);
  return {
    coastProfileCount,
    coastSlopeMean: Number(coastSlopeMean.toFixed(4)),
    coastSlopeP95: Number((coastSlopeP95 ?? 0).toFixed(4)),
    coastBoundaryDropMean: Number(boundaryDropMean.toFixed(4)),
    coastBoundaryDropMax: Number(boundaryDropMax.toFixed(4)),
    coastCliffRatio: Number((cliffCount / Math.max(1, coastProfileCount)).toFixed(4)),
    coastForcedCliffRatio: Number((forcedCliffCount / Math.max(1, cliffCount)).toFixed(4))
  };
};

const analyzeIslandShape = (state, targetLandRatio) => {
  const { cols, rows, totalTiles } = state.grid;
  const oceanMask = getAuthoritativeOceanMask(state);
  let oceanCount = 0;
  let borderCount = 0;
  let borderOceanCount = 0;
  const coastalInsets = [];
  const boundaryTraces = {
    left: [],
    right: [],
    top: [],
    bottom: []
  };
  for (let y = 0; y < rows; y += 1) {
    let leftTrace = -1;
    let rightTrace = -1;
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      if (oceanMask[idx] > 0) {
        oceanCount += 1;
      }
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
        borderCount += 1;
        if (oceanMask[idx] > 0) {
          borderOceanCount += 1;
        }
      }
      if (oceanMask[idx] === 0) {
        const touchesOcean =
          (x > 0 && oceanMask[idx - 1] > 0) ||
          (x < cols - 1 && oceanMask[idx + 1] > 0) ||
          (y > 0 && oceanMask[idx - cols] > 0) ||
          (y < rows - 1 && oceanMask[idx + cols] > 0);
        if (touchesOcean) {
          coastalInsets.push(Math.min(x, y, cols - 1 - x, rows - 1 - y));
        }
        if (leftTrace < 0) {
          leftTrace = x;
        }
        rightTrace = cols - 1 - x;
      }
    }
    if (leftTrace >= 0) {
      boundaryTraces.left.push(leftTrace);
    }
    if (rightTrace >= 0) {
      boundaryTraces.right.push(rightTrace);
    }
  }
  for (let x = 0; x < cols; x += 1) {
    let topTrace = -1;
    let bottomTrace = -1;
    for (let y = 0; y < rows; y += 1) {
      const idx = y * cols + x;
      if (oceanMask[idx] > 0) {
        continue;
      }
      if (topTrace < 0) {
        topTrace = y;
      }
      bottomTrace = rows - 1 - y;
    }
    if (topTrace >= 0) {
      boundaryTraces.top.push(topTrace);
    }
    if (bottomTrace >= 0) {
      boundaryTraces.bottom.push(bottomTrace);
    }
  }

  const visited = new Uint8Array(totalTiles);
  const queue = new Int32Array(totalTiles);
  let largestLandComponent = 0;
  let landCount = 0;
  for (let i = 0; i < totalTiles; i += 1) {
    if (oceanMask[i] === 0) {
      landCount += 1;
    }
    if (visited[i] > 0 || oceanMask[i] > 0) {
      continue;
    }
    let head = 0;
    let tail = 0;
    visited[i] = 1;
    queue[tail] = i;
    tail += 1;
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      const tryPush = (next) => {
        if (next < 0 || next >= totalTiles || visited[next] > 0 || oceanMask[next] > 0) {
          return;
        }
        visited[next] = 1;
        queue[tail] = next;
        tail += 1;
      };
      if (x > 0) {
        tryPush(idx - 1);
      }
      if (x < cols - 1) {
        tryPush(idx + 1);
      }
      if (y > 0) {
        tryPush(idx - cols);
      }
      if (y < rows - 1) {
        tryPush(idx + cols);
      }
    }
    largestLandComponent = Math.max(largestLandComponent, tail);
  }

  const landRatio = landCount / Math.max(1, totalTiles);
  const insetMean = coastalInsets.length > 0
    ? coastalInsets.reduce((sum, value) => sum + value, 0) / coastalInsets.length
    : 0;
  const insetVariance = coastalInsets.length > 0
    ? coastalInsets.reduce((sum, value) => sum + (value - insetMean) ** 2, 0) / coastalInsets.length
    : 0;
  const insetHistogram = new Map();
  for (const inset of coastalInsets) {
    insetHistogram.set(inset, (insetHistogram.get(inset) ?? 0) + 1);
  }
  const traceStats = Object.entries(boundaryTraces).map(([side, values]) => {
    const mean = values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const variance = values.length > 0
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
      : 0;
    let maxRun = 0;
    for (let start = 0; start < values.length; start += 1) {
      let min = values[start] ?? 0;
      let max = min;
      for (let end = start; end < values.length; end += 1) {
        const value = values[end] ?? min;
        min = Math.min(min, value);
        max = Math.max(max, value);
        if (max - min > 2) {
          break;
        }
        maxRun = Math.max(maxRun, end - start + 1);
      }
    }
    return {
      side,
      coverage: values.length / Math.max(1, side === "left" || side === "right" ? rows : cols),
      stdDev: Math.sqrt(variance),
      maxRunRatio: maxRun / Math.max(1, values.length)
    };
  }).filter((stat) => stat.coverage >= 0.3);
  const maxSideWallRunRatio = Math.max(0, ...traceStats.map((stat) => stat.maxRunRatio));
  const minSideWallStdDev = traceStats.length > 0
    ? Math.min(...traceStats.map((stat) => stat.stdDev))
    : 0;
  const dominantInsetCount = Math.max(0, ...insetHistogram.values());
  const borderHuggingCount = coastalInsets.filter((inset) => inset <= 2).length;
  return {
    islandTargetLandRatio: Number(targetLandRatio.toFixed(4)),
    islandLandRatio: Number(landRatio.toFixed(4)),
    islandOceanRatio: Number((oceanCount / Math.max(1, totalTiles)).toFixed(4)),
    islandBorderOceanRatio: Number((borderOceanCount / Math.max(1, borderCount)).toFixed(4)),
    islandMainLandComponentRatio: Number((largestLandComponent / Math.max(1, landCount)).toFixed(4)),
    coastalEdgeInsetMean: Number(insetMean.toFixed(2)),
    coastalEdgeInsetStdDev: Number(Math.sqrt(insetVariance).toFixed(2)),
    coastalDominantInsetRatio: Number((dominantInsetCount / Math.max(1, coastalInsets.length)).toFixed(4)),
    coastalBorderHuggingRatio: Number((borderHuggingCount / Math.max(1, coastalInsets.length)).toFixed(4)),
    coastalSideWallRunRatio: Number(maxSideWallRunRatio.toFixed(4)),
    coastalSideWallMinStdDev: Number(minSideWallStdDev.toFixed(2))
  };
};

const analyzeBaseSite = (state) => {
  const { cols, rows } = state.grid;
  const center = { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
  const base = state.basePoint ?? center;
  const baseIdx = base.y * cols + base.x;
  const baseTile = state.tiles[baseIdx];
  const baseElevation = baseTile?.elevation ?? 0;
  const isRoadLike = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return false;
    }
    const idx = y * cols + x;
    const type = state.tiles[idx]?.type;
    return type === "road" || type === "base" || (state.tileRoadBridge?.[idx] ?? 0) > 0;
  };
  const touchesRoadInfrastructure = (x, y) => {
    for (let oy = -2; oy <= 2; oy += 1) {
      for (let ox = -2; ox <= 2; ox += 1) {
        if (Math.hypot(ox, oy) <= 2.01 && isRoadLike(x + ox, y + oy)) {
          return true;
        }
      }
    }
    return false;
  };
  let localRelief = 0;
  let vegetationTiles = 0;
  let usableTiles = 0;
  const reliefRadius = 4;
  const vegetationRadius = 8;
  for (let dy = -vegetationRadius; dy <= vegetationRadius; dy += 1) {
    for (let dx = -vegetationRadius; dx <= vegetationRadius; dx += 1) {
      const nx = base.x + dx;
      const ny = base.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        continue;
      }
      const distance = Math.hypot(dx, dy);
      const tile = state.tiles[ny * cols + nx];
      if (!tile || tile.type === "water") {
        continue;
      }
      if (
        distance <= reliefRadius &&
        tile.type !== "road" &&
        tile.type !== "base" &&
        tile.type !== "house" &&
        (state.tileRoadBridge?.[ny * cols + nx] ?? 0) === 0 &&
        !touchesRoadInfrastructure(nx, ny)
      ) {
        localRelief = Math.max(localRelief, Math.abs(baseElevation - tile.elevation));
      }
      if (distance <= vegetationRadius && tile.type !== "road" && tile.type !== "base" && tile.type !== "house") {
        usableTiles += 1;
        if (tile.type === "forest" || tile.type === "grass" || tile.type === "scrub" || tile.type === "floodplain") {
          vegetationTiles += 1;
        }
      }
    }
  }
  const centerDistance = Math.hypot(base.x - center.x, base.y - center.y);
  const minDim = Math.max(1, Math.min(cols, rows));
  return {
    baseX: base.x,
    baseY: base.y,
    baseElevation: Number(baseElevation.toFixed(4)),
    baseLocalRelief: Number(localRelief.toFixed(4)),
    baseWaterDistance: Math.floor(baseTile?.waterDist ?? 99),
    baseCenterDistance: Number(centerDistance.toFixed(2)),
    baseCenterDistanceRatio: Number((centerDistance / minDim).toFixed(4)),
    baseExactCenter: base.x === center.x && base.y === center.y,
    baseNearbyVegetationRatio: Number((vegetationTiles / Math.max(1, usableTiles)).toFixed(4))
  };
};

const analyzeTownMorphologies = (state) => {
  const { cols, rows } = state.grid;
  const isRoadLike = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return false;
    }
    const idx = y * cols + x;
    const tile = state.tiles[idx];
    return !!tile && (tile.type === "road" || tile.type === "base" || (state.tileRoadBridge[idx] ?? 0) > 0);
  };
  const getRoadDegree = (x, y) => {
    const idx = y * cols + x;
    let mask = state.tileRoadEdges[idx] ?? 0;
    if (mask === 0) {
      for (const dir of ROAD_EDGE_DIRS) {
        if (isRoadLike(x + dir.dx, y + dir.dy)) {
          mask |= dir.bit;
        }
      }
    }
    let degree = 0;
    for (let bit = mask; bit !== 0; bit &= bit - 1) {
      degree += 1;
    }
    return degree;
  };
  return state.towns.map((town) => {
    const housePoints = [];
    const frontierPoints = (town.growthFrontiers ?? []).filter((frontier) => frontier.active);
    let minX = town.x;
    let maxX = town.x;
    let minY = town.y;
    let maxY = town.y;
    for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
      if (state.tileTownId[idx] !== town.id || state.tiles[idx]?.type !== "house") {
        continue;
      }
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      housePoints.push({ x, y });
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    for (const frontier of frontierPoints) {
      minX = Math.min(minX, frontier.x);
      maxX = Math.max(maxX, frontier.x);
      minY = Math.min(minY, frontier.y);
      maxY = Math.max(maxY, frontier.y);
    }
    const shapePoints = [...housePoints, ...frontierPoints];
    const centerPoint =
      shapePoints.length > 0
        ? {
            x: shapePoints.reduce((sum, point) => sum + point.x, 0) / shapePoints.length,
            y: shapePoints.reduce((sum, point) => sum + point.y, 0) / shapePoints.length
          }
        : { x: town.cx ?? town.x, y: town.cy ?? town.y };
    const localCenterRadius = Math.max(4, Math.min(9, Math.max(maxX - minX + 1, maxY - minY + 1) * 0.5 + 2));
    minX = Math.max(0, minX - 2);
    maxX = Math.min(cols - 1, maxX + 2);
    minY = Math.max(0, minY - 2);
    maxY = Math.min(rows - 1, maxY + 2);
    const localRoads = [];
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (!isRoadLike(x, y)) {
          continue;
        }
        const nearHouse = housePoints.some((point) => Math.abs(point.x - x) + Math.abs(point.y - y) <= 5);
        const nearFrontier = frontierPoints.some((frontier) => Math.abs(frontier.x - x) + Math.abs(frontier.y - y) <= 3);
        const nearCenter = Math.hypot(x - centerPoint.x, y - centerPoint.y) <= localCenterRadius;
        if (nearHouse || nearFrontier || nearCenter) {
          localRoads.push({ x, y });
        }
      }
    }
    const footprint = [{ x: town.x, y: town.y }, ...housePoints, ...localRoads];
    let shapeMinX = town.x;
    let shapeMaxX = town.x;
    let shapeMinY = town.y;
    let shapeMaxY = town.y;
    for (const point of footprint) {
      shapeMinX = Math.min(shapeMinX, point.x);
      shapeMaxX = Math.max(shapeMaxX, point.x);
      shapeMinY = Math.min(shapeMinY, point.y);
      shapeMaxY = Math.max(shapeMaxY, point.y);
    }
    const width = shapeMaxX - shapeMinX + 1;
    const height = shapeMaxY - shapeMinY + 1;
    const aspect = Number((Math.max(width, height) / Math.max(1, Math.min(width, height))).toFixed(2));
    const roadNode3PlusCount = localRoads.filter((point) => getRoadDegree(point.x, point.y) >= 3).length;
    const meaningful =
      town.streetArchetype !== "ribbon" &&
      (town.houseCount >= COMPACT_TOWN_MORPH_MIN_HOUSES || localRoads.length >= COMPACT_TOWN_MORPH_MIN_ROADS);
    const violations = [];
    if (meaningful && town.streetArchetype === "crossroads" && roadNode3PlusCount < 1) {
      violations.push("missing_intersection");
    }
    if (meaningful && town.streetArchetype === "crossroads" && aspect > COMPACT_TOWN_ASPECT_LIMIT) {
      violations.push("overelongated");
    }
    return {
      id: town.id,
      archetype: town.streetArchetype,
      profile: town.industryProfile,
      houseCount: town.houseCount,
      roadTileCount: localRoads.length,
      roadNode3PlusCount,
      aspect,
      meaningful,
      violations
    };
  });
};

const analyzeTownRoadConnectivity = (state) => {
  const { cols, rows, totalTiles } = state.grid;
  const roadEdges = state.tileRoadEdges;
  const roadBridge = state.tileRoadBridge;
  const isRoadLike = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return false;
    }
    const idx = y * cols + x;
    const tile = state.tiles[idx];
    return !!tile && (tile.type === "road" || tile.type === "base" || (roadBridge?.[idx] ?? 0) > 0);
  };
  const nearestRoadAnchor = (point, radius) => {
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let y = Math.max(0, point.y - radius); y <= Math.min(rows - 1, point.y + radius); y += 1) {
      for (let x = Math.max(0, point.x - radius); x <= Math.min(cols - 1, point.x + radius); x += 1) {
        if (!isRoadLike(x, y)) {
          continue;
        }
        const dist = Math.abs(point.x - x) + Math.abs(point.y - y);
        if (dist < bestDist) {
          bestDist = dist;
          best = { x, y };
        }
      }
    }
    return best;
  };

  const components = new Int32Array(totalTiles);
  components.fill(-1);
  const queue = new Int32Array(totalTiles);
  let componentId = 0;
  for (let i = 0; i < totalTiles; i += 1) {
    if (components[i] >= 0) {
      continue;
    }
    const x = i % cols;
    const y = Math.floor(i / cols);
    if (!isRoadLike(x, y)) {
      continue;
    }
    let head = 0;
    let tail = 0;
    components[i] = componentId;
    queue[tail] = i;
    tail += 1;
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      const cx = idx % cols;
      const cy = Math.floor(idx / cols);
      const mask = roadEdges?.[idx] ?? 0;
      for (const dir of ROAD_EDGE_DIRS) {
        if ((mask & dir.bit) === 0) {
          continue;
        }
        const nx = cx + dir.dx;
        const ny = cy + dir.dy;
        if (!isRoadLike(nx, ny)) {
          continue;
        }
        const nIdx = ny * cols + nx;
        if (components[nIdx] >= 0) {
          continue;
        }
        components[nIdx] = componentId;
        queue[tail] = nIdx;
        tail += 1;
      }
    }
    componentId += 1;
  }

  const baseAnchor = isRoadLike(state.basePoint.x, state.basePoint.y)
    ? state.basePoint
    : nearestRoadAnchor(state.basePoint, 6);
  const baseComponent = baseAnchor ? components[baseAnchor.y * cols + baseAnchor.x] : -1;
  let townRoadMissingCount = 0;
  let townRoadDisconnectedCount = 0;
  const townComponents = new Set();
  for (const town of state.towns) {
    const anchor = nearestRoadAnchor({ x: town.x, y: town.y }, 10);
    if (!anchor) {
      townRoadMissingCount += 1;
      townRoadDisconnectedCount += 1;
      townComponents.add(-1);
      continue;
    }
    const component = components[anchor.y * cols + anchor.x] ?? -1;
    townComponents.add(component);
    if (component < 0 || component !== baseComponent) {
      townRoadDisconnectedCount += 1;
    }
  }

  return {
    roadComponentCount: componentId,
    townRoadComponentCount: townComponents.size,
    townRoadMissingCount,
    townRoadDisconnectedCount,
    baseRoadComponent: baseComponent
  };
};

const computeInternalBoundsAngleDeg = (state, bounds) => {
  const { cols, rows } = state.grid;
  let maxSlope = 0;
  let angleSum = 0;
  let count = 0;
  for (let y = bounds.minY; y <= bounds.maxY; y += 1) {
    if (y < 0 || y >= rows) {
      continue;
    }
    for (let x = bounds.minX; x <= bounds.maxX; x += 1) {
      if (x < 0 || x >= cols) {
        continue;
      }
      const idx = y * cols + x;
      const center = state.tiles[idx]?.elevation ?? 0;
      let slope = 0;
      if (x > bounds.minX && x > 0) {
        slope = Math.max(slope, Math.abs(center - (state.tiles[idx - 1]?.elevation ?? center)));
      }
      if (x < bounds.maxX && x < cols - 1) {
        slope = Math.max(slope, Math.abs(center - (state.tiles[idx + 1]?.elevation ?? center)));
      }
      if (y > bounds.minY && y > 0) {
        slope = Math.max(slope, Math.abs(center - (state.tiles[idx - cols]?.elevation ?? center)));
      }
      if (y < bounds.maxY && y < rows - 1) {
        slope = Math.max(slope, Math.abs(center - (state.tiles[idx + cols]?.elevation ?? center)));
      }
      maxSlope = Math.max(maxSlope, slope);
      angleSum += computeRenderedSlopeAngleDeg(slope, cols, rows, 1);
      count += 1;
    }
  }
  return {
    maxAngle: computeRenderedSlopeAngleDeg(maxSlope, cols, rows, 1),
    meanAngle: count > 0 ? angleSum / count : 0
  };
};

const computeTileAngleDeg = (state, x, y) => {
  const { cols, rows } = state.grid;
  const idx = y * cols + x;
  const center = state.tiles[idx]?.elevation ?? 0;
  let slope = 0;
  if (x > 0) {
    slope = Math.max(slope, Math.abs(center - (state.tiles[idx - 1]?.elevation ?? center)));
  }
  if (x < cols - 1) {
    slope = Math.max(slope, Math.abs(center - (state.tiles[idx + 1]?.elevation ?? center)));
  }
  if (y > 0) {
    slope = Math.max(slope, Math.abs(center - (state.tiles[idx - cols]?.elevation ?? center)));
  }
  if (y < rows - 1) {
    slope = Math.max(slope, Math.abs(center - (state.tiles[idx + cols]?.elevation ?? center)));
  }
  return computeRenderedSlopeAngleDeg(slope, cols, rows, 1);
};

const analyzeSettlementAngles = (state) => {
  const { cols, rows } = state.grid;
  const townSeedAngles = state.towns.map((town) => computeTileAngleDeg(state, Math.round(town.x), Math.round(town.y)));
  const isRoadLike = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) {
      return false;
    }
    const idx = y * cols + x;
    const tile = state.tiles[idx];
    return !!tile && (tile.type === "road" || tile.type === "base" || (state.tileRoadBridge?.[idx] ?? 0) > 0);
  };
  const getRoadMask = (x, y) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows || !isRoadLike(x, y)) {
      return 0;
    }
    return state.tileRoadEdges?.[y * cols + x] ?? 0;
  };
  let houseFootprintMaxAngle = 0;
  let houseFootprintAngleSum = 0;
  let houseFootprintCount = 0;
  let highAngleHouseFootprintCount = 0;
  for (let idx = 0; idx < state.tiles.length; idx += 1) {
    const tile = state.tiles[idx];
    if (!tile || tile.type !== "house") {
      continue;
    }
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    const seed = Number.isFinite(tile.houseStyleSeed) ? Math.trunc(tile.houseStyleSeed) : idx;
    const reference = findBestRoadReferenceForPlot(x, y, isRoadLike, getRoadMask);
    const rotation = pickHouseRotationFromRoadMask(reference?.roadMask ?? 0, seed);
    const footprint = pickHouseFootprint(seed);
    const angle = computeInternalBoundsAngleDeg(state, getHouseFootprintBounds(x, y, rotation, footprint, "asset"));
    houseFootprintMaxAngle = Math.max(houseFootprintMaxAngle, angle.maxAngle);
    houseFootprintAngleSum += angle.meanAngle;
    houseFootprintCount += 1;
    if (angle.maxAngle > 18) {
      highAngleHouseFootprintCount += 1;
    }
  }
  return {
    settlementTownSeedMaxAngle: Number(Math.max(0, ...townSeedAngles).toFixed(2)),
    settlementTownSeedMeanAngle: Number((townSeedAngles.reduce((sum, value) => sum + value, 0) / Math.max(1, townSeedAngles.length)).toFixed(2)),
    houseFootprintMaxAngle: Number(houseFootprintMaxAngle.toFixed(2)),
    houseFootprintMeanAngle: Number((houseFootprintAngleSum / Math.max(1, houseFootprintCount)).toFixed(2)),
    highAngleHouseFootprintCount
  };
};

const runCase = async (sizeId, seed) => {
  const grid = createGrid(sizeId);
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed);
  resetState(state, seed);
  resetRoadGenerationStats();
  rng.setState(seed);

  const phaseTimingsMs = {};
  const emittedPhases = [];
  const diagnosticEvents = [];
  let lastAt = performance.now();
  const started = lastAt;
  await generateMap(state, rng, undefined, undefined, {
    onPhase: async (snapshot) => {
      emittedPhases.push(snapshot.phase);
      assertSnapshotShape(snapshot, grid.totalTiles, `${sizeId}:${seed}`);
      const now = performance.now();
      phaseTimingsMs[snapshot.phase] = Number((now - lastAt).toFixed(2));
      lastAt = now;
    },
    onDiagnosticEvent: (event) => {
      if (event.kind.startsWith("hydrology:")) {
        diagnosticEvents.push(event);
      }
    }
  });
  assert.equal(state.waterTowers.length, state.towns.length, `${sizeId}:${seed} should generate one water tower per town`);
  for (const town of state.towns) {
    const tower = state.waterTowers.find((candidate) => candidate.townId === town.id);
    assert.ok(tower, `${sizeId}:${seed} town ${town.id} should own a water tower`);
    const towerIndex = tower.y * state.grid.cols + tower.x;
    assert.equal(state.structureMask[towerIndex], 1, `${sizeId}:${seed} tower should retain its structure reservation`);
    assert.notEqual(state.tiles[towerIndex]?.type, "road", `${sizeId}:${seed} tower should not be overwritten by a road`);
    if (town.id !== 0) {
      assert.deepEqual({ x: tower.x, y: tower.y }, { x: town.x, y: town.y }, `${sizeId}:${seed} non-HQ tower should occupy its town seed`);
    } else {
      assert.notDeepEqual({ x: tower.x, y: tower.y }, state.basePoint, `${sizeId}:${seed} HQ tower should not overlap the firebase`);
    }
  }
  assertPhaseOrder(emittedPhases, EXPECTED_DEBUG_PHASE_ORDER, `${sizeId}:${seed}`);
  const durationMs = performance.now() - started;

  let water = 0;
  let forest = 0;
  let houses = 0;
  let roads = 0;
  let river = 0;
  let forestAgeSum = 0;
  const forestMaturities = [];
  const forestSpecies = new Set();
  let forestTreeTypeHash = 2166136261;
  let elevationMin = Number.POSITIVE_INFINITY;
  let elevationMax = Number.NEGATIVE_INFINITY;
  let elevationSum = 0;
  for (let i = 0; i < state.tiles.length; i += 1) {
    const tile = state.tiles[i];
    if (!tile) {
      continue;
    }
    elevationMin = Math.min(elevationMin, tile.elevation);
    elevationMax = Math.max(elevationMax, tile.elevation);
    elevationSum += tile.elevation;
    if (tile.type === "water") {
      water += 1;
    } else if (tile.type === "forest") {
      forest += 1;
      forestAgeSum += tile.vegetationAgeYears ?? 0;
      forestMaturities.push(getVegetationMaturity01(tile.type, tile.vegetationAgeYears ?? 0));
      if (tile.treeType) {
        forestSpecies.add(tile.treeType);
        for (let c = 0; c < tile.treeType.length; c += 1) {
          forestTreeTypeHash ^= tile.treeType.charCodeAt(c);
          forestTreeTypeHash = Math.imul(forestTreeTypeHash, 16777619) >>> 0;
        }
      }
    } else if (tile.type === "house") {
      houses += 1;
    } else if (tile.type === "road") {
      roads += 1;
    }
    if (state.tileRiverMask[i] > 0) {
      river += 1;
    }
  }
  const total = Math.max(1, state.tiles.length);
  const patchMetrics = analyzeForestPatches(state);
  const riverMetrics = analyzeRiverConnectivity(state);
  const staticHydrologyMetrics = analyzeStaticHydrology(state);
  const hydrologyDiagnosticMetrics = analyzeHydrologyDiagnostics(diagnosticEvents, state);
  const roadMetrics = analyzeRoadEdgeQuality(state);
  const roadSurfaceMetrics = analyzeRoadSurfaceMetrics(state);
  const roadGenerationStats = getRoadGenerationStats();
  const coastMetrics = analyzeCoastalClassification(state);
  const coastProfileMetrics = analyzeGeneratedCoastProfile(state);
  const islandMetrics = analyzeIslandShape(state, createDefaultTerrainRecipe(sizeId).landCoverageTarget);
  const baseMetrics = analyzeBaseSite(state);
  const settlementAngleMetrics = analyzeSettlementAngles(state);
  const townMorphologies = analyzeTownMorphologies(state);
  const townRoadConnectivity = analyzeTownRoadConnectivity(state);
  const compactTownViolations = townMorphologies
    .filter((town) => town.meaningful && town.violations.length > 0)
    .map((town) => ({
      id: town.id,
      archetype: town.archetype,
      violations: town.violations
    }));
  forestMaturities.sort((a, b) => a - b);
  const forestMaturityP95 =
    forestMaturities.length > 0
      ? forestMaturities[Math.min(forestMaturities.length - 1, Math.floor((forestMaturities.length - 1) * 0.95))]
      : 0;
  const biomeSpreadMs = phaseTimingsMs["biome:spread"] ?? 0;
  const biomeClassifyMs = phaseTimingsMs["biome:classify"] ?? 0;
  return {
    sizeId,
    seed,
    durationMs: Number(durationMs.toFixed(2)),
    elevationMin: Number(elevationMin.toFixed(4)),
    elevationMax: Number(elevationMax.toFixed(4)),
    elevationMean: Number((elevationSum / total).toFixed(4)),
    waterPct: Number(((water / total) * 100).toFixed(2)),
    forestPct: Number(((forest / total) * 100).toFixed(2)),
    forestAgeMean: Number((forestAgeSum / Math.max(1, forest)).toFixed(2)),
    forestMaturityP95: Number(forestMaturityP95.toFixed(3)),
    forestSpeciesCount: forestSpecies.size,
    forestTreeTypeHash,
    houseCount: houses,
    townCount: state.towns?.length ?? 0,
    requestedHouseCount: state.settlementRequestedHouses ?? houses,
    placedHouseCount: state.settlementPlacedHouses ?? houses,
    settlementPadReliefMax: Number((state.settlementPadReliefMax ?? 0).toFixed(4)),
    settlementPadReliefMean: Number((state.settlementPadReliefMean ?? 0).toFixed(4)),
    roadCount: roads,
    riverCount: river,
    phaseTimingsMs,
    biomeSpreadClassifyMs: Number((biomeSpreadMs + biomeClassifyMs).toFixed(2)),
    compactTownEvalCount: townMorphologies.filter((town) => town.meaningful).length,
    compactTownViolationCount: compactTownViolations.length,
    compactTownMaxAspect: Number(
      Math.max(1, ...townMorphologies.filter((town) => town.meaningful).map((town) => town.aspect)).toFixed(2)
    ),
    townMorphologies,
    compactTownViolations,
    ...patchMetrics,
    ...riverMetrics,
    ...staticHydrologyMetrics,
    ...hydrologyDiagnosticMetrics,
    ...roadMetrics,
    ...roadSurfaceMetrics,
    routedRoadMaxAngle: Number(roadGenerationStats.maxRealizedAngleDeg.toFixed(2)),
    routedRoadMeanAngle: Number(roadGenerationStats.meanRealizedAngleDeg.toFixed(2)),
    routedHighAngleStepCount: roadGenerationStats.highAngleStepCount,
    mountainPassFallbackCount: roadGenerationStats.mountainPassFallbackCount,
    switchbackTurnCount: roadGenerationStats.switchbackTurnCount,
    switchbackRouteAttempts: roadGenerationStats.switchbackRouteAttempts,
    switchbackRouteCount: roadGenerationStats.switchbackRouteCount,
    hairpinGradeDiscountCount: roadGenerationStats.hairpinGradeDiscountCount,
    connectorArtifactPrunedEdgeCount: roadGenerationStats.connectorArtifactPrunedEdgeCount,
    searchBudgetAbortCount: roadGenerationStats.searchBudgetAbortCount,
    connectorCacheSkipCount: roadGenerationStats.connectorCacheSkipCount,
    routedLongStraightSteepSegmentCount: roadGenerationStats.longStraightSteepSegmentCount,
    roadGradingDelta: Number(roadSurfaceMetrics.maxRoadGradingDelta.toFixed(4)),
    roadLongStraightSteepSegmentCount: roadSurfaceMetrics.longStraightSteepSegmentCount,
    generatedJunctionCount: roadGenerationStats.generatedJunctionCount,
    ...coastMetrics,
    ...coastProfileMetrics,
    ...islandMetrics,
    ...baseMetrics,
    ...settlementAngleMetrics,
    ...townRoadConnectivity
  };
};

const runDebugSmokeCase = async ({ sizeId, seed, stopAfterPhase }) => {
  const grid = createGrid(sizeId);
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed);
  resetState(state, seed);
  rng.setState(seed);

  const emittedPhases = [];
  const timedPhases = [];
  let waitForStepCalls = 0;
  await generateMap(state, rng, undefined, undefined, {
    stopAfterPhase,
    onPhase: async (snapshot) => {
      emittedPhases.push(snapshot.phase);
      assertSnapshotShape(snapshot, grid.totalTiles, `debug:${sizeId}:${seed}:${stopAfterPhase}`);
    },
    onStageTiming: async (timing) => {
      timedPhases.push(timing.phase);
      if (!Number.isFinite(timing.durationMs) || timing.durationMs < 0) {
        throw new Error(
          `[mapgen] invalid stage timing for ${sizeId}:${seed}:${stopAfterPhase}: ${timing.phase}=${timing.durationMs}`
        );
      }
    },
    waitForStep: async () => {
      waitForStepCalls += 1;
    }
  });

  const expectedSnapshotPhases = getExpectedDebugPrefix(stopAfterPhase);
  const expectedTimedPhases = getExpectedStagePrefix(stopAfterPhase);
  assertPhaseOrder(emittedPhases, expectedSnapshotPhases, `debug:${sizeId}:${seed}:${stopAfterPhase}:snapshots`);
  assertPhaseOrder(timedPhases, expectedTimedPhases, `debug:${sizeId}:${seed}:${stopAfterPhase}:timings`);
  if (waitForStepCalls !== expectedSnapshotPhases.length) {
    throw new Error(
      `[mapgen] waitForStep count mismatch for ${sizeId}:${seed}:${stopAfterPhase}: expected ${expectedSnapshotPhases.length}, got ${waitForStepCalls}`
    );
  }
};

const runSyntheticRoadAngleCases = () => {
  const grid = { cols: 44, rows: 28, totalTiles: 44 * 28 };
  const state = createInitialState(424242, grid);
  resetState(state, 424242);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, idx) => {
    const x = idx % grid.cols;
    const y = Math.floor(idx / grid.cols);
    let elevation = 0.22 + Math.abs(y - 14) * 0.0008;
    if (x >= 19 && x <= 22) {
      elevation = y >= 4 && y <= 6 ? 0.235 : 0.52;
    }
    if (state.tileElevation.length === grid.totalTiles) {
      state.tileElevation[idx] = elevation;
    }
    return buildRegressionTile("grass", { elevation });
  });
  resetRoadGenerationStats();
  const carved = carveRoad(
    state,
    new RNG(424242),
    { x: 5, y: 14 },
    { x: 38, y: 14 },
    {
      bridgePolicy: "never",
      preferredAngleDeg: 12,
      softAngleDeg: 18,
      avoidAngleDeg: 28,
      fallbackAngleDeg: 40,
      anglePenaltyWeight: 0.8,
      straightClimbPenaltyWeight: 1,
      contourTurnReliefWeight: 1.1,
      gradeLimitStart: 0.1,
      gradeLimitRelaxStep: 0.015,
      gradeLimitMax: 0.2,
      crossfallLimitStart: 0.08,
      crossfallLimitRelaxStep: 0.015,
      crossfallLimitMax: 0.18,
      gradeChangeLimitStart: 0.08,
      gradeChangeLimitRelaxStep: 0.015,
      gradeChangeLimitMax: 0.18
    }
  );
  const metrics = analyzeRoadSurfaceMetrics(state);
  const usedSteepWall = state.tiles.some((tile, idx) => {
    const x = idx % grid.cols;
    const y = Math.floor(idx / grid.cols);
    return tile.type === "road" && x >= 19 && x <= 22 && !(y >= 4 && y <= 6);
  });
  return {
    carved,
    usedSteepWall,
    maxRoadAngleDeg: metrics.maxRoadAngleDeg,
    highAngleRoadStepCount: metrics.highAngleRoadStepCount,
    stats: getRoadGenerationStats()
  };
};

const collectRoadPoints = (state) => {
  const points = [];
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tiles[idx]?.type === "road") {
      points.push({ x: idx % state.grid.cols, y: Math.floor(idx / state.grid.cols) });
    }
  }
  return points;
};

const collectRoadPathFromEdges = (state, start, end) => {
  const cols = state.grid.cols;
  const startIdx = start.y * cols + start.x;
  const endIdx = end.y * cols + end.x;
  const previous = new Int32Array(state.grid.totalTiles);
  previous.fill(-1);
  const queue = [startIdx];
  previous[startIdx] = startIdx;
  for (let head = 0; head < queue.length; head += 1) {
    const idx = queue[head];
    if (idx === endIdx) {
      break;
    }
    const mask = state.tileRoadEdges[idx] ?? 0;
    const x = idx % cols;
    const y = Math.floor(idx / cols);
    for (const dir of ROAD_EDGE_DIRS) {
      if ((mask & dir.bit) === 0) {
        continue;
      }
      const nx = x + dir.dx;
      const ny = y + dir.dy;
      if (nx < 0 || nx >= cols || ny < 0 || ny >= state.grid.rows) {
        continue;
      }
      const nextIdx = ny * cols + nx;
      if (previous[nextIdx] >= 0) {
        continue;
      }
      previous[nextIdx] = idx;
      queue.push(nextIdx);
    }
  }
  if (previous[endIdx] < 0) {
    return [];
  }
  const path = [];
  let current = endIdx;
  while (current !== startIdx) {
    path.push({ x: current % cols, y: Math.floor(current / cols) });
    current = previous[current];
  }
  path.push(start);
  path.reverse();
  return path;
};

const runSyntheticSwitchbackCase = () => {
  const grid = { cols: 54, rows: 36, totalTiles: 54 * 36 };
  const state = createInitialState(515151, grid);
  resetState(state, 515151);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, idx) => {
    const x = idx % grid.cols;
    const y = Math.floor(idx / grid.cols);
    const elevation = 0.12 + x * 0.012 + Math.abs(y - 18) * 0.0004;
    if (state.tileElevation.length === grid.totalTiles) {
      state.tileElevation[idx] = elevation;
    }
    return buildRegressionTile("grass", { elevation });
  });
  resetRoadGenerationStats();
  const carved = carveRoad(
    state,
    new RNG(515151),
    { x: 5, y: 18 },
    { x: 45, y: 18 },
    {
      bridgePolicy: "never",
      pathMode: "switchback",
      allowMountainPassFallback: false,
      searchBounds: { minX: 0, maxX: grid.cols - 1, minY: 8, maxY: 28 },
      preferredAngleDeg: 8,
      softAngleDeg: 10,
      avoidAngleDeg: 36,
      fallbackAngleDeg: 52,
      anglePenaltyWeight: 0.95,
      straightClimbPenaltyWeight: 2.8,
      contourTurnReliefWeight: 2.4,
      turnPenalty: 0.02,
      diagonalPenalty: 0.02,
      gradeLimitStart: 0.1,
      gradeLimitRelaxStep: 0.015,
      gradeLimitMax: 0.24,
      crossfallLimitStart: 0.08,
      crossfallLimitRelaxStep: 0.016,
      crossfallLimitMax: 0.22,
      gradeChangeLimitStart: 0.08,
      gradeChangeLimitRelaxStep: 0.016,
      gradeChangeLimitMax: 0.22
    }
  );
  const points = collectRoadPoints(state);
  const yValues = points.map((point) => point.y);
  const lateralSpan = yValues.length > 0 ? Math.max(...yValues) - Math.min(...yValues) : 0;
  return {
    carved,
    lateralSpan,
    stats: getRoadGenerationStats()
  };
};

const runSyntheticStraightSteepNoDiscountCase = () => {
  const grid = { cols: 36, rows: 11, totalTiles: 36 * 11 };
  const state = createInitialState(525252, grid);
  resetState(state, 525252);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, idx) => {
    const x = idx % grid.cols;
    const elevation = 0.12 + x * 0.012;
    if (state.tileElevation.length === grid.totalTiles) {
      state.tileElevation[idx] = elevation;
    }
    return buildRegressionTile("grass", { elevation });
  });
  resetRoadGenerationStats();
  const carved = carveRoad(
    state,
    new RNG(525252),
    { x: 3, y: 5 },
    { x: 31, y: 5 },
    {
      bridgePolicy: "never",
      pathMode: "switchback",
      allowMountainPassFallback: false,
      searchBounds: { minX: 0, maxX: grid.cols - 1, minY: 5, maxY: 5 },
      preferredAngleDeg: 8,
      softAngleDeg: 10,
      avoidAngleDeg: 36,
      fallbackAngleDeg: 52,
      anglePenaltyWeight: 0.95,
      straightClimbPenaltyWeight: 2.8,
      contourTurnReliefWeight: 2.4,
      turnPenalty: 0.01,
      diagonalPenalty: 0.02,
      gradeLimitStart: 0.1,
      gradeLimitRelaxStep: 0.015,
      gradeLimitMax: 0.24,
      crossfallLimitStart: 0.08,
      crossfallLimitRelaxStep: 0.016,
      crossfallLimitMax: 0.22,
      gradeChangeLimitStart: 0.08,
      gradeChangeLimitRelaxStep: 0.016,
      gradeChangeLimitMax: 0.22
    }
  );
  return {
    carved,
    stats: getRoadGenerationStats()
  };
};

const runSyntheticRoadArtifactCleanupCase = () => {
  const grid = { cols: 12, rows: 12, totalTiles: 12 * 12 };
  const state = createInitialState(535353, grid);
  resetState(state, 535353);
  state.tiles = Array.from({ length: grid.totalTiles }, () => buildRegressionTile("grass", { elevation: 0.22 }));
  const roadPoints = [
    { x: 3, y: 5 },
    { x: 4, y: 5 },
    { x: 5, y: 5 },
    { x: 6, y: 5 },
    { x: 4, y: 6 },
    { x: 5, y: 6 }
  ];
  for (const point of roadPoints) {
    state.tiles[point.y * grid.cols + point.x] = buildRegressionTile("road", { elevation: 0.22 });
  }
  resetRoadGenerationStats();
  connectRoadPoints(state, 3, 5, 4, 5);
  connectRoadPoints(state, 4, 5, 5, 5);
  connectRoadPoints(state, 5, 5, 6, 5);
  connectRoadPoints(state, 4, 5, 4, 6);
  connectRoadPoints(state, 4, 6, 5, 6);
  connectRoadPoints(state, 5, 6, 5, 5);
  connectRoadPoints(state, 4, 5, 5, 6);
  const pruned = pruneRoadConnectorArtifacts(state);
  return {
    pruned,
    stats: getRoadGenerationStats(),
    stillConnected: (state.tileRoadEdges[5 * grid.cols + 4] ?? 0) > 0 && (state.tileRoadEdges[6 * grid.cols + 5] ?? 0) > 0
  };
};

const runSyntheticMountainPassCase = () => {
  const grid = { cols: 36, rows: 24, totalTiles: 36 * 24 };
  const state = createInitialState(616161, grid);
  resetState(state, 616161);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, idx) => {
    const x = idx % grid.cols;
    const elevation = x < 17 ? 0.22 : x > 18 ? 0.28 : 0.25;
    if (state.tileElevation.length === grid.totalTiles) {
      state.tileElevation[idx] = elevation;
    }
    return buildRegressionTile("grass", { elevation });
  });
  resetRoadGenerationStats();
  const carved = carveRoad(
    state,
    new RNG(616161),
    { x: 6, y: 12 },
    { x: 30, y: 12 },
    {
      bridgePolicy: "never",
      pathMode: "mountainPass",
      allowMountainPassFallback: true,
      preferredAngleDeg: 8,
      softAngleDeg: 12,
      avoidAngleDeg: 32,
      fallbackAngleDeg: 72,
      anglePenaltyWeight: 2.2,
      straightClimbPenaltyWeight: 3.2,
      contourTurnReliefWeight: 1.7,
      gradeLimitStart: 0.2,
      gradeLimitRelaxStep: 0.04,
      gradeLimitMax: 0.68,
      crossfallLimitStart: 0.2,
      crossfallLimitRelaxStep: 0.04,
      crossfallLimitMax: 0.52,
      gradeChangeLimitStart: 0.2,
      gradeChangeLimitRelaxStep: 0.04,
      gradeChangeLimitMax: 0.52
    }
  );
  return {
    carved,
    stats: getRoadGenerationStats()
  };
};

const runSyntheticRoadStreamerNearJoinCase = () => {
  const grid = { cols: 42, rows: 20, totalTiles: 42 * 20 };
  const state = createInitialState(717171, grid);
  resetState(state, 717171);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, idx) => {
    const x = idx % grid.cols;
    const y = Math.floor(idx / grid.cols);
    const elevation = 0.22 + Math.abs(y - 10) * 0.0005 + Math.abs(x - 21) * 0.0002;
    if (state.tileElevation.length === grid.totalTiles) {
      state.tileElevation[idx] = elevation;
    }
    return buildRegressionTile("grass", { elevation });
  });
  resetRoadGenerationStats();
  const carved = carveRoad(
    state,
    new RNG(717171),
    { x: 4, y: 10 },
    { x: 37, y: 10 },
    {
      bridgePolicy: "never",
      useBidirectionalStreamer: true,
      searchBounds: { minX: 0, maxX: grid.cols - 1, minY: 6, maxY: 14 },
      maxSearchNodeVisits: 900,
      gradeLimitStart: 0.08,
      gradeLimitRelaxStep: 0.01,
      gradeLimitMax: 0.14,
      crossfallLimitStart: 0.06,
      crossfallLimitRelaxStep: 0.01,
      crossfallLimitMax: 0.12,
      gradeChangeLimitStart: 0.06,
      gradeChangeLimitRelaxStep: 0.01,
      gradeChangeLimitMax: 0.12
    }
  );
  return {
    carved,
    stats: getRoadGenerationStats()
  };
};

const runSyntheticRoadStreamerDestinationSeedCase = () => {
  const grid = { cols: 34, rows: 18, totalTiles: 34 * 18 };
  const state = createInitialState(727272, grid);
  resetState(state, 727272);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, idx) => {
    if (state.tileElevation.length === grid.totalTiles) {
      state.tileElevation[idx] = 0.22;
    }
    return buildRegressionTile("grass", { elevation: 0.22 });
  });
  const roadPoints = [
    { x: 27, y: 8 },
    { x: 28, y: 8 },
    { x: 29, y: 8 }
  ];
  for (const point of roadPoints) {
    state.tiles[point.y * grid.cols + point.x] = buildRegressionTile("road", { elevation: 0.22 });
  }
  connectRoadPoints(state, 27, 8, 28, 8);
  connectRoadPoints(state, 28, 8, 29, 8);
  resetRoadGenerationStats();
  const carved = carveRoad(
    state,
    new RNG(727272),
    { x: 4, y: 8 },
    { x: 29, y: 8 },
    {
      bridgePolicy: "never",
      useBidirectionalStreamer: true,
      searchBounds: { minX: 0, maxX: grid.cols - 1, minY: 4, maxY: 12 },
      maxSearchNodeVisits: 700
    }
  );
  return {
    carved,
    connectedToNetwork: (state.tileRoadEdges[8 * grid.cols + 27] ?? 0) > 0,
    stats: getRoadGenerationStats()
  };
};

const runSyntheticRoadStreamerBudgetCase = () => {
  const grid = { cols: 30, rows: 18, totalTiles: 30 * 18 };
  const state = createInitialState(737373, grid);
  resetState(state, 737373);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, idx) => {
    if (state.tileElevation.length === grid.totalTiles) {
      state.tileElevation[idx] = 0.22;
    }
    return buildRegressionTile("grass", { elevation: 0.22 });
  });
  resetRoadGenerationStats();
  const carved = carveRoad(
    state,
    new RNG(737373),
    { x: 2, y: 9 },
    { x: 27, y: 9 },
    {
      bridgePolicy: "never",
      useBidirectionalStreamer: true,
      searchBounds: { minX: 0, maxX: grid.cols - 1, minY: 0, maxY: grid.rows - 1 },
      maxSearchNodeVisits: 1
    }
  );
  return {
    carved,
    stats: getRoadGenerationStats()
  };
};

const createFlatSyntheticRoadState = (seed, cols, rows, elevation = 0.22) => {
  const grid = { cols, rows, totalTiles: cols * rows };
  const state = createInitialState(seed, grid);
  resetState(state, seed);
  state.tiles = Array.from({ length: grid.totalTiles }, (_, idx) => {
    if (state.tileElevation.length === grid.totalTiles) {
      state.tileElevation[idx] = elevation;
    }
    return buildRegressionTile("grass", { elevation });
  });
  return state;
};

const setSyntheticTile = (state, x, y, type, elevation = 0.22) => {
  const idx = y * state.grid.cols + x;
  state.tiles[idx] = buildRegressionTile(type, { elevation });
  if (state.tileElevation.length === state.grid.totalTiles) {
    state.tileElevation[idx] = elevation;
  }
};

const withRoadDiagnostics = (fn) => {
  const events = [];
  setRoadPathDebugHooks({
    emit: (event) => {
      events.push(event);
    }
  });
  try {
    return { value: fn(), events };
  } finally {
    setRoadPathDebugHooks(null);
  }
};

const latestDijkstraResult = (events) => {
  const results = events.filter((event) => event.kind === "road:result" && event.planner === "dijkstra");
  return results[results.length - 1] ?? null;
};

const runSyntheticDijkstraDestinationChoiceCase = () => {
  const state = createFlatSyntheticRoadState(747474, 34, 20);
  for (let x = 8; x <= 22; x += 1) {
    for (let y = 2; y <= 8; y += 1) {
      setSyntheticTile(state, x, y, "grass", 0.72);
    }
  }
  setSyntheticTile(state, 25, 4, "road", 0.72);
  setSyntheticTile(state, 26, 14, "road", 0.22);
  resetRoadGenerationStats();
  const { value: selected, events } = withRoadDiagnostics(() =>
    carveRoadToTarget(
      state,
      new RNG(747474),
      { x: 2, y: 4 },
      (x, y) => (x === 25 && y === 4) || (x === 26 && y === 14),
      {
        bridgePolicy: "never",
        searchBounds: { minX: 0, maxX: state.grid.cols - 1, minY: 0, maxY: state.grid.rows - 1 },
        preferredAngleDeg: 8,
        softAngleDeg: 12,
        avoidAngleDeg: 18,
        fallbackAngleDeg: 28,
        gradeLimitStart: 0.08,
        gradeLimitRelaxStep: 0.01,
        gradeLimitMax: 0.12,
        crossfallLimitStart: 0.06,
        crossfallLimitRelaxStep: 0.01,
        crossfallLimitMax: 0.1,
        gradeChangeLimitStart: 0.06,
        gradeChangeLimitRelaxStep: 0.01,
        gradeChangeLimitMax: 0.1,
        allowMountainPassFallback: false
      }
    )
  );
  return {
    selected,
    result: latestDijkstraResult(events),
    stats: getRoadGenerationStats()
  };
};

const runSyntheticDijkstraBudgetCase = () => {
  const state = createFlatSyntheticRoadState(757575, 30, 10);
  resetRoadGenerationStats();
  const { value: carved, events } = withRoadDiagnostics(() =>
    carveRoad(
      state,
      new RNG(757575),
      { x: 1, y: 5 },
      { x: 28, y: 5 },
      {
        bridgePolicy: "never",
        maxSearchNodeVisits: 1,
        allowMountainPassFallback: false
      }
    )
  );
  return {
    carved,
    result: latestDijkstraResult(events),
    stats: getRoadGenerationStats()
  };
};

const runSyntheticDijkstraNoRouteCase = () => {
  const state = createFlatSyntheticRoadState(767676, 14, 9);
  const blocked = [
    [8, 3],
    [9, 3],
    [10, 3],
    [8, 4],
    [10, 4],
    [8, 5],
    [9, 5],
    [10, 5]
  ];
  for (const [x, y] of blocked) {
    setSyntheticTile(state, x, y, "water", 0.18);
  }
  resetRoadGenerationStats();
  const { value: carved, events } = withRoadDiagnostics(() =>
    carveRoad(
      state,
      new RNG(767676),
      { x: 2, y: 4 },
      { x: 9, y: 4 },
      {
        bridgePolicy: "never",
        allowMountainPassFallback: false
      }
    )
  );
  return {
    carved,
    result: latestDijkstraResult(events)
  };
};

const runSyntheticDijkstraExistingRoadPreferenceCase = (seed = 777777) => {
  const state = createFlatSyntheticRoadState(seed, 32, 13);
  for (let x = 5; x <= 25; x += 1) {
    setSyntheticTile(state, x, 6, "road", 0.22);
    if (x > 5) {
      connectRoadPoints(state, x - 1, 6, x, 6);
    }
  }
  resetRoadGenerationStats();
  const { value: carved, events } = withRoadDiagnostics(() =>
    carveRoad(
      state,
      new RNG(seed),
      { x: 2, y: 6 },
      { x: 29, y: 6 },
      {
        bridgePolicy: "never",
        turnPenalty: 0.35,
        diagonalPenalty: 0.4,
        allowMountainPassFallback: false
      }
    )
  );
  const result = latestDijkstraResult(events);
  const path = collectRoadPathFromEdges(state, { x: 2, y: 6 }, { x: 29, y: 6 });
  const existingRoadSteps = path.filter((point) => point.y === 6 && point.x >= 5 && point.x <= 25).length;
  const pathSignature = path.map((point) => `${point.x},${point.y}`).join("|");
  return {
    carved,
    result,
    existingRoadSteps,
    pathSignature
  };
};

const runSyntheticDijkstraCases = () => {
  const destinationChoice = runSyntheticDijkstraDestinationChoiceCase();
  if (
    !destinationChoice.selected ||
    destinationChoice.selected.x !== 26 ||
    destinationChoice.selected.y !== 14 ||
    destinationChoice.result?.selectedDestinationSeed?.x !== 26 ||
    destinationChoice.result?.selectedDestinationSeed?.y !== 14 ||
    destinationChoice.result?.totalRouteCost === undefined
  ) {
    throw new Error(
      `[mapgen] synthetic Dijkstra destination case failed: selected=${JSON.stringify(destinationChoice.selected)} diagnostic=${JSON.stringify(destinationChoice.result?.selectedDestinationSeed)} cost=${destinationChoice.result?.totalRouteCost}`
    );
  }

  const budget = runSyntheticDijkstraBudgetCase();
  if (!budget.result || budget.carved || budget.result.failureReason !== "budget-aborted" || budget.stats.searchBudgetAbortCount < 1) {
    throw new Error(
      `[mapgen] synthetic Dijkstra budget case failed: carved=${budget.carved} reason=${budget.result?.failureReason} budget=${budget.stats.searchBudgetAbortCount}`
    );
  }

  const noRoute = runSyntheticDijkstraNoRouteCase();
  if (!noRoute.result || noRoute.carved || noRoute.result.failureReason !== "no-route") {
    throw new Error(
      `[mapgen] synthetic Dijkstra no-route case failed: carved=${noRoute.carved} reason=${noRoute.result?.failureReason}`
    );
  }

  const existingRoad = runSyntheticDijkstraExistingRoadPreferenceCase();
  const repeatExistingRoad = runSyntheticDijkstraExistingRoadPreferenceCase();
  if (
    !existingRoad.carved ||
    existingRoad.existingRoadSteps < 18 ||
    existingRoad.pathSignature !== repeatExistingRoad.pathSignature
  ) {
    throw new Error(
      `[mapgen] synthetic Dijkstra existing-road case failed: carved=${existingRoad.carved} existingSteps=${existingRoad.existingRoadSteps} deterministic=${existingRoad.pathSignature === repeatExistingRoad.pathSignature}`
    );
  }

  return {
    selected: destinationChoice.selected,
    totalRouteCost: destinationChoice.result.totalRouteCost,
    existingRoadSteps: existingRoad.existingRoadSteps,
    budgetAborts: budget.stats.searchBudgetAbortCount
  };
};

const runAll = async () => {
  const results = [];
  const syntheticDijkstra = runSyntheticDijkstraCases();
  const syntheticRoads = runSyntheticRoadAngleCases();
  if (!syntheticRoads.carved || syntheticRoads.usedSteepWall) {
    throw new Error(
      `[mapgen] synthetic road angle case failed: carved=${syntheticRoads.carved} steepWall=${syntheticRoads.usedSteepWall} maxAngle=${syntheticRoads.maxRoadAngleDeg.toFixed(2)}`
    );
  }
  const syntheticSwitchbacks = runSyntheticSwitchbackCase();
  if (
    !syntheticSwitchbacks.carved ||
    syntheticSwitchbacks.lateralSpan < 4 ||
    syntheticSwitchbacks.stats.switchbackRouteCount < 1 ||
    syntheticSwitchbacks.stats.switchbackTurnCount < 2 ||
    syntheticSwitchbacks.stats.switchbackTurnCount > 16
  ) {
    throw new Error(
      `[mapgen] synthetic switchback case failed: carved=${syntheticSwitchbacks.carved} lateral=${syntheticSwitchbacks.lateralSpan} routes=${syntheticSwitchbacks.stats.switchbackRouteCount} turns=${syntheticSwitchbacks.stats.switchbackTurnCount} hairpins=${syntheticSwitchbacks.stats.hairpinGradeDiscountCount} straightSteep=${syntheticSwitchbacks.stats.longStraightSteepSegmentCount}`
    );
  }
  const syntheticStraightSteep = runSyntheticStraightSteepNoDiscountCase();
  if (!syntheticStraightSteep.carved || syntheticStraightSteep.stats.hairpinGradeDiscountCount !== 0) {
    throw new Error(
      `[mapgen] synthetic straight-steep case failed: carved=${syntheticStraightSteep.carved} hairpins=${syntheticStraightSteep.stats.hairpinGradeDiscountCount}`
    );
  }
  const syntheticRoadCleanup = runSyntheticRoadArtifactCleanupCase();
  if (
    syntheticRoadCleanup.pruned < 1 ||
    syntheticRoadCleanup.stats.connectorArtifactPrunedEdgeCount !== syntheticRoadCleanup.pruned ||
    !syntheticRoadCleanup.stillConnected
  ) {
    throw new Error(
      `[mapgen] synthetic road cleanup case failed: pruned=${syntheticRoadCleanup.pruned} stats=${syntheticRoadCleanup.stats.connectorArtifactPrunedEdgeCount} connected=${syntheticRoadCleanup.stillConnected}`
    );
  }
  const syntheticMountainPass = runSyntheticMountainPassCase();
  if (!syntheticMountainPass.carved || syntheticMountainPass.stats.mountainPassFallbackCount < 1) {
    throw new Error(
      `[mapgen] synthetic mountain-pass case failed: carved=${syntheticMountainPass.carved} passes=${syntheticMountainPass.stats.mountainPassFallbackCount}`
    );
  }
  const syntheticStreamerNearJoin = runSyntheticRoadStreamerNearJoinCase();
  if (!syntheticStreamerNearJoin.carved || syntheticStreamerNearJoin.stats.pathsFound < 1) {
    throw new Error(
      `[mapgen] synthetic streamer near-join case failed: carved=${syntheticStreamerNearJoin.carved} paths=${syntheticStreamerNearJoin.stats.pathsFound}/${syntheticStreamerNearJoin.stats.pathsAttempted}`
    );
  }
  const syntheticStreamerDestinationSeeds = runSyntheticRoadStreamerDestinationSeedCase();
  if (!syntheticStreamerDestinationSeeds.carved || !syntheticStreamerDestinationSeeds.connectedToNetwork) {
    throw new Error(
      `[mapgen] synthetic streamer destination-seed case failed: carved=${syntheticStreamerDestinationSeeds.carved} connected=${syntheticStreamerDestinationSeeds.connectedToNetwork}`
    );
  }
  const syntheticStreamerBudget = runSyntheticRoadStreamerBudgetCase();
  if (syntheticStreamerBudget.carved || syntheticStreamerBudget.stats.searchBudgetAbortCount < 1) {
    throw new Error(
      `[mapgen] synthetic streamer budget case failed: carved=${syntheticStreamerBudget.carved} budget=${syntheticStreamerBudget.stats.searchBudgetAbortCount}`
    );
  }
  for (const sizeId of sizes) {
    for (const seed of seeds) {
      const metrics = await runCase(sizeId, seed);
      results.push(metrics);
      console.log(
        `[mapgen] size=${metrics.sizeId} seed=${metrics.seed} ms=${metrics.durationMs.toFixed(2)} biome=${metrics.biomeSpreadClassifyMs.toFixed(2)}ms water=${metrics.waterPct.toFixed(2)}% forest=${metrics.forestPct.toFixed(2)}% forestAgeMean=${metrics.forestAgeMean.toFixed(2)} forestMaturityP95=${metrics.forestMaturityP95.toFixed(3)} patches=${metrics.forestPatchCount} meanPatch=${metrics.forestPatchMean} p95Patch=${metrics.forestPatchP95} houses=${metrics.houseCount} placed=${metrics.placedHouseCount}/${metrics.requestedHouseCount} compactEval=${metrics.compactTownEvalCount} compactViolations=${metrics.compactTownViolationCount} compactMaxAspect=${metrics.compactTownMaxAspect.toFixed(2)} base=(${metrics.baseX},${metrics.baseY}) baseElev=${metrics.baseElevation.toFixed(4)} baseRelief=${metrics.baseLocalRelief.toFixed(4)} baseCenter=${metrics.baseCenterDistanceRatio.toFixed(4)} baseVeg=${metrics.baseNearbyVegetationRatio.toFixed(4)} townAngle=${metrics.settlementTownSeedMaxAngle.toFixed(2)}/${metrics.settlementTownSeedMeanAngle.toFixed(2)} houseAngle=${metrics.houseFootprintMaxAngle.toFixed(2)}/${metrics.houseFootprintMeanAngle.toFixed(2)} highHouseAngle=${metrics.highAngleHouseFootprintCount} padReliefMax=${metrics.settlementPadReliefMax.toFixed(4)} padReliefMean=${metrics.settlementPadReliefMean.toFixed(4)} roads=${metrics.roadCount} roadComps=${metrics.roadComponentCount} townRoadComps=${metrics.townRoadComponentCount} townRoadMissing=${metrics.townRoadMissingCount} townRoadDisconnected=${metrics.townRoadDisconnectedCount} rivers=${metrics.riverCount} lakes=${metrics.lakeCount}/${metrics.lakeTiles} lakeOut=${metrics.lakeOutletCount} lakeOutAdj=${metrics.lakeOutletAdjacentRiverCount} lakeOutRead=${metrics.lakeOutletReadableCount} lakeOutMiss=${metrics.lakeOutletConnectionFailures} lakeOutShort=${metrics.lakeOutletShortRiverFailures} lakeOutLap=${metrics.lakeOutletShorelineLapFailures} lakeOutLat=${metrics.lakeOutletLateralStartFailures} overflow=${metrics.hydrologyOverflowTerminalRoutes}/${metrics.hydrologyOverflowRoutes} overflowFail=${metrics.hydrologyOverflowFailedRoutes} overflowCarved=${metrics.hydrologyFailedOverflowCarvedTiles} classRoutes=${metrics.hydrologyClassifiedRoutes} classFalls=${metrics.hydrologyClassifiedWaterfallCandidates}/${metrics.hydrologyClassifiedWaterfallLipTiles}/${metrics.hydrologyClassifiedWaterfallRunoutTiles} classFailed=${metrics.hydrologyClassifiedFailedOverflowTiles} falls=${metrics.waterfallCount} fallReject=${metrics.hydrologyWaterfallRejected} roadIgnoredDiag=${metrics.ignoredDiagonalCount} roadUnmatched=${metrics.unmatchedPatternCount} roadGrade=${metrics.maxRoadGrade.toFixed(3)} roadCrossfall=${metrics.maxRoadCrossfall.toFixed(3)} roadGradeChange=${metrics.maxRoadGradeChange.toFixed(3)} roadAngle=${metrics.maxRoadAngleDeg.toFixed(2)}/${metrics.meanRoadAngleDeg.toFixed(2)} highRoadAngle=${metrics.highAngleRoadStepCount} straightSteep=${metrics.roadLongStraightSteepSegmentCount} gradingDelta=${metrics.roadGradingDelta.toFixed(3)} routedAngle=${metrics.routedRoadMaxAngle.toFixed(2)}/${metrics.routedRoadMeanAngle.toFixed(2)} routedHighAngle=${metrics.routedHighAngleStepCount} routedStraightSteep=${metrics.routedLongStraightSteepSegmentCount} passes=${metrics.mountainPassFallbackCount} junctions=${metrics.generatedJunctionCount} switchbacks=${metrics.switchbackTurnCount} hairpins=${metrics.hairpinGradeDiscountCount} cleanup=${metrics.connectorArtifactPrunedEdgeCount} switchbackRoutes=${metrics.switchbackRouteCount}/${metrics.switchbackRouteAttempts} budgetAbort=${metrics.searchBudgetAbortCount} cacheSkip=${metrics.connectorCacheSkipCount} roadWalls=${metrics.wallEdgeCount} riverDiagOnly=${metrics.riverDiagOnlyLinks} riverIso=${metrics.riverIsolatedCells} riverOrthRatio=${metrics.riverOrthConnectivityRatio.toFixed(4)} riverComps=${metrics.riverComponentCount} riverDetachedComps=${metrics.detachedRiverComponents} riverDetachedCells=${metrics.detachedRiverCells} coastNatural=${metrics.coastalNaturalCount} coastBeach=${metrics.coastalBeachCount} coastRocky=${metrics.coastalRockyCount} coastOther=${metrics.coastalOtherCount} coastSlope=${metrics.coastSlopeMean.toFixed(4)}/${metrics.coastSlopeP95.toFixed(4)} coastDrop=${metrics.coastBoundaryDropMean.toFixed(4)}/${metrics.coastBoundaryDropMax.toFixed(4)} coastCliff=${metrics.coastCliffRatio.toFixed(3)} forcedCliff=${metrics.coastForcedCliffRatio.toFixed(3)} coastInsetStd=${metrics.coastalEdgeInsetStdDev.toFixed(2)} coastInsetDominant=${metrics.coastalDominantInsetRatio.toFixed(3)} coastSideRun=${metrics.coastalSideWallRunRatio.toFixed(3)} coastSideStd=${metrics.coastalSideWallMinStdDev.toFixed(2)}`
      );
    }
  }
  return results;
};

const runDebugSmokes = async () => {
  for (const smokeCase of DEBUG_SMOKE_CASES) {
    await runDebugSmokeCase(smokeCase);
    console.log(
      `[mapgen] debug-smoke size=${smokeCase.sizeId} seed=${smokeCase.seed} stop=${smokeCase.stopAfterPhase}`
    );
  }
};

const runNoLakeSmoke = async () => {
  const sizeId = "medium";
  const seed = 1337;
  const grid = createGrid(sizeId);
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed);
  resetState(state, seed);
  rng.setState(seed);
  await generateMap(state, rng, undefined, { lakeChance: 0, maxLakeCount: 0 });
  const metrics = analyzeStaticHydrology(state);
  let riverCount = 0;
  for (let i = 0; i < state.grid.totalTiles; i += 1) {
    if (state.tileRiverMask[i] > 0) {
      riverCount += 1;
    }
  }
  if (metrics.lakeTiles !== 0 || riverCount !== 0) {
    throw new Error(`[mapgen] no-lake smoke failed: lakes=${metrics.lakeTiles} rivers=${riverCount}`);
  }
  console.log(`[mapgen] no-lake smoke seed=${seed} rivers=${riverCount}`);
};

const runRiverControlCompatibilitySmoke = async () => {
  const sizeId = "medium";
  const seed = 1337;
  const baseRecipe = createDefaultTerrainRecipe(sizeId, "MASSIF");
  const runOnce = async (terrain) => {
    const grid = createGrid(sizeId);
    const state = createInitialState(seed, grid);
    const rng = new RNG(seed);
    resetState(state, seed);
    rng.setState(seed);
    await generateMap(state, rng, undefined, terrain);
    return {
      ...analyzeRiverConnectivity(state),
      ...analyzeStaticHydrology(state),
      riverCount: state.tileRiverMask.reduce((sum, value) => sum + (value > 0 ? 1 : 0), 0)
    };
  };
  const baseline = await runOnce(baseRecipe);
  const riverCountOverride = await runOnce({
    ...compileTerrainRecipe(baseRecipe).settings,
    riverCount: 12
  });
  const riverBudgetOverride = await runOnce({
    ...baseRecipe,
    advancedOverrides: {
      ...(baseRecipe.advancedOverrides ?? {}),
      riverBudget: 1
    }
  });
  for (const [label, result] of [
    ["riverCount", riverCountOverride],
    ["riverBudget", riverBudgetOverride]
  ]) {
    if (
      result.riverCount !== baseline.riverCount ||
      result.riverTopologyHash !== baseline.riverTopologyHash ||
      result.lakeHash !== baseline.lakeHash
    ) {
      throw new Error(
        `[mapgen] ${label} compatibility failed: rivers=${baseline.riverCount}/${result.riverCount} riverHash=${baseline.riverTopologyHash}/${result.riverTopologyHash} lakeHash=${baseline.lakeHash}/${result.lakeHash}`
      );
    }
  }
  console.log(`[mapgen] river controls ignored seed=${seed} rivers=${baseline.riverCount}`);
};

const runDeterministicHydrologySmoke = async () => {
  const sizeId = "medium";
  const seed = 1337;
  const runOnce = async (archetype = "MASSIF") => {
    const grid = createGrid(sizeId);
    const state = createInitialState(seed, grid);
    const rng = new RNG(seed);
    resetState(state, seed);
    rng.setState(seed);
    await generateMap(state, rng, undefined, createDefaultTerrainRecipe(sizeId, archetype));
    return analyzeStaticHydrology(state);
  };
  const first = await runOnce("MASSIF");
  const second = await runOnce("MASSIF");
  const fields = ["lakeTiles", "lakeCount", "lakeOutletCount", "waterfallCount", "lakeHash", "waterfallHash"];
  for (const field of fields) {
    if (first[field] !== second[field]) {
      throw new Error(`[mapgen] hydrology determinism failed for ${field}: ${first[field]} !== ${second[field]}`);
    }
  }
  const longSpine = await runOnce("LONG_SPINE");
  const twinBay = await runOnce("TWIN_BAY");
  const archetypeLakeResults = [
    ["MASSIF", first],
    ["LONG_SPINE", longSpine],
    ["TWIN_BAY", twinBay]
  ];
  const missingLakes = archetypeLakeResults.filter(([, metrics]) => metrics.lakeCount <= 0 || metrics.lakeOutletCount <= 0);
  if (missingLakes.length > 0) {
    throw new Error(
      `[mapgen] archetype watershed lake smoke failed: ${missingLakes
        .map(([label, metrics]) => `${label}=${metrics.lakeCount}/${metrics.lakeTiles}/out${metrics.lakeOutletCount}`)
        .join(" ")}`
    );
  }
  console.log(
    `[mapgen] deterministic hydrology smoke seed=${seed} lakeHash=${first.lakeHash} waterfallHash=${first.waterfallHash} archetypeLakes=${archetypeLakeResults
      .map(([label, metrics]) => `${label}:${metrics.lakeCount}/${metrics.lakeTiles}/out${metrics.lakeOutletCount}`)
      .join(",")}`
  );
};

const compareAgainstBaseline = async (results) => {
  let baselineRaw = null;
  let hasBaseline = true;
  try {
    baselineRaw = await readFile(baselinePath, "utf8");
  } catch {
    console.warn("[mapgen] baseline file missing; skipping water-drift comparison.");
    hasBaseline = false;
  }
  const baseline = hasBaseline && baselineRaw ? JSON.parse(baselineRaw) : { entries: [] };
  const entries = baseline?.entries ?? [];
  const index = new Map(entries.map((entry) => [`${entry.sizeId}:${entry.seed}`, entry]));
  let failures = 0;
  for (const result of results) {
    const key = `${result.sizeId}:${result.seed}`;
    if (result.riverDiagOnlyLinks !== 0) {
      failures += 1;
      console.error(`[mapgen] diagonal-only river links present for ${key}: ${result.riverDiagOnlyLinks}`);
    }
    if (result.riverIsolatedCells !== 0) {
      failures += 1;
      console.error(`[mapgen] isolated river cells present for ${key}: ${result.riverIsolatedCells}`);
    }
    if (result.riverOrthConnectivityRatio < 0.995) {
      failures += 1;
      console.error(
        `[mapgen] orthogonal river connectivity too low for ${key}: ${result.riverOrthConnectivityRatio.toFixed(4)}`
      );
    }
    if (result.detachedRiverComponents !== 0) {
      failures += 1;
      console.error(`[mapgen] detached river components present for ${key}: ${result.detachedRiverComponents}`);
    }
    if (result.lakeInvariantFailures !== 0) {
      failures += 1;
      console.error(`[mapgen] lake water invariants failed for ${key}: ${result.lakeInvariantFailures}`);
    }
    if (result.lakeBedFailures !== 0) {
      failures += 1;
      console.error(`[mapgen] lake beds not below surface for ${key}: ${result.lakeBedFailures}`);
    }
    if (result.lakeSurfaceConsistencyFailures !== 0) {
      failures += 1;
      console.error(`[mapgen] lake surfaces are not constant per basin for ${key}: ${result.lakeSurfaceConsistencyFailures}`);
    }
    if (result.lakeOceanAdjacent !== 0) {
      failures += 1;
      console.error(`[mapgen] inland lake touches ocean for ${key}: ${result.lakeOceanAdjacent}`);
    }
    if (result.invalidWaterfalls !== 0) {
      failures += 1;
      console.error(`[mapgen] invalid static waterfalls for ${key}: ${result.invalidWaterfalls}`);
    }
    if (result.hydrologyFailedOverflowCarvedTiles !== 0) {
      failures += 1;
      console.error(
        `[mapgen] failed overflow routes carved river tiles for ${key}: ${result.hydrologyFailedOverflowCarvedTiles}`
      );
    }
    if (result.lakeComponentCount !== result.lakeCount) {
      failures += 1;
      console.error(
        `[mapgen] lake components do not match lake ids for ${key}: components=${result.lakeComponentCount} ids=${result.lakeCount}`
      );
    }
    if (result.lakeCount > 0 && result.lakeOutletCount === 0 && result.hydrologyOverflowFailedRoutes === 0) {
      failures += 1;
      console.error(`[mapgen] lakes generated without outlets for ${key}`);
    }
    if (result.lakeOutletConnectionFailures !== 0) {
      failures += 1;
      console.error(`[mapgen] lake outlets missing adjacent river connectors for ${key}: ${result.lakeOutletConnectionFailures}`);
    }
    if (result.lakeOutletSurfaceFailures !== 0) {
      failures += 1;
      console.error(`[mapgen] lake outlet river surfaces do not descend from spill surface for ${key}: ${result.lakeOutletSurfaceFailures}`);
    }
    if (result.lakeOutletShortRiverFailures !== 0) {
      failures += 1;
      console.error(
        `[mapgen] lake outlets have too-short visible river continuations for ${key}: ${result.lakeOutletShortRiverFailures}`
      );
    }
    if (result.lakeOutletShorelineLapFailures !== 0) {
      failures += 1;
      console.error(
        `[mapgen] lake outlets trace the source lake shoreline for ${key}: ${result.lakeOutletShorelineLapFailures}`
      );
    }
    if (result.lakeOutletLateralStartFailures !== 0) {
      failures += 1;
      console.error(
        `[mapgen] lake outlets start laterally despite available direct descent for ${key}: ${result.lakeOutletLateralStartFailures}`
      );
    }
    if (result.sizeId === "medium" && result.seed === 1337 && result.lakeTiles < 16) {
      failures += 1;
      console.error(`[mapgen] target hydrology seed produced too few inland lake tiles for ${key}: ${result.lakeTiles}`);
    }
    const ignoredDiagonalRatio = result.roadCount > 0 ? result.ignoredDiagonalCount / result.roadCount : 0;
    if (ignoredDiagonalRatio > 0.05) {
      failures += 1;
      console.error(
        `[mapgen] ignored road diagonal ratio too high for ${key}: ${(ignoredDiagonalRatio * 100).toFixed(2)}%`
      );
    }
    if (result.unmatchedPatternCount !== 0) {
      failures += 1;
      console.error(`[mapgen] unmatched road patterns present for ${key}: ${result.unmatchedPatternCount}`);
    }
    const maxSwitchbackRouteAttempts = Math.max(64, (result.townCount ?? 0) * 22);
    if (result.switchbackRouteAttempts > maxSwitchbackRouteAttempts) {
      failures += 1;
      console.error(
        `[mapgen] switchback route attempts too high for ${key}: ${result.switchbackRouteAttempts}/${maxSwitchbackRouteAttempts}`
      );
    }
    const allowedHighAngleRoadSteps = Math.max(
      4,
      result.mountainPassFallbackCount * 10,
      result.switchbackRouteCount * 2,
      result.switchbackTurnCount
    );
    if (result.highAngleRoadStepCount > allowedHighAngleRoadSteps || result.maxRoadAngleDeg > 62) {
      failures += 1;
      console.error(
        `[mapgen] road angle too high for ${key}: max=${result.maxRoadAngleDeg.toFixed(2)} high=${result.highAngleRoadStepCount} passes=${result.mountainPassFallbackCount}`
      );
    }
    if (result.routedHighAngleStepCount > Math.max(6, result.mountainPassFallbackCount * 12)) {
      failures += 1;
      console.error(
        `[mapgen] routed road angle fallback too frequent for ${key}: routedHigh=${result.routedHighAngleStepCount} passes=${result.mountainPassFallbackCount}`
      );
    }
    if (result.routedHighAngleStepCount > 0 && result.mountainPassFallbackCount === 0 && result.switchbackRouteCount === 0) {
      failures += 1;
      console.error(`[mapgen] high-angle routed roads without switchback or pass accounting for ${key}`);
    }
    if (result.roadLongStraightSteepSegmentCount > Math.max(8, result.mountainPassFallbackCount * 8)) {
      failures += 1;
      console.error(
        `[mapgen] too many long straight steep road segments for ${key}: ${result.roadLongStraightSteepSegmentCount}`
      );
    }
    if (result.roadGradingDelta > 0.142) {
      failures += 1;
      console.error(`[mapgen] road grading delta too high for ${key}: ${result.roadGradingDelta.toFixed(4)}`);
    }
    if (result.baseRoadComponent < 0) {
      failures += 1;
      console.error(`[mapgen] base has no edge-connected road component for ${key}`);
    }
    if (result.townRoadMissingCount !== 0) {
      failures += 1;
      console.error(`[mapgen] towns missing nearby road anchors for ${key}: ${result.townRoadMissingCount}`);
    }
    if (result.townRoadDisconnectedCount !== 0) {
      failures += 1;
      console.error(`[mapgen] towns disconnected from base road component for ${key}: ${result.townRoadDisconnectedCount}`);
    }
    if (result.townRoadComponentCount > 1) {
      failures += 1;
      console.error(`[mapgen] town road anchors span multiple components for ${key}: ${result.townRoadComponentCount}`);
    }
    if (result.coastalNaturalCount > 0 && result.coastalOtherCount !== 0) {
      failures += 1;
      console.error(
        `[mapgen] coastline classification drift for ${key}: coastalOther=${result.coastalOtherCount} of natural=${result.coastalNaturalCount}`
      );
    }
    if (result.coastProfileCount >= 40 && result.coastForcedCliffRatio > 0.08) {
      failures += 1;
      console.error(
        `[mapgen] forced cliff ratio too high for ${key}: ${result.coastForcedCliffRatio.toFixed(4)}`
      );
    }
    if (result.coastProfileCount >= 40 && result.coastCliffRatio > 0.36) {
      failures += 1;
      console.error(`[mapgen] continuous cliff coastline too high for ${key}: ${result.coastCliffRatio.toFixed(4)}`);
    }
    if (result.coastProfileCount >= 40 && (result.coastBoundaryDropMean > 0.09 || result.coastBoundaryDropMax > 0.45)) {
      failures += 1;
      console.error(
        `[mapgen] generated coast boundary drop too steep for ${key}: mean=${result.coastBoundaryDropMean.toFixed(4)} max=${result.coastBoundaryDropMax.toFixed(4)}`
      );
    }
    if (result.coastProfileCount >= 40 && result.coastSlopeP95 > 0.34) {
      failures += 1;
      console.error(`[mapgen] generated coast slope p95 too high for ${key}: ${result.coastSlopeP95.toFixed(4)}`);
    }
    if (result.islandBorderOceanRatio < 0.96) {
      failures += 1;
      console.error(
        `[mapgen] border ocean coverage too low for ${key}: ${result.islandBorderOceanRatio.toFixed(4)}`
      );
    }
    if (result.islandMainLandComponentRatio < 0.9) {
      failures += 1;
      console.error(
        `[mapgen] main land component too fragmented for ${key}: ${result.islandMainLandComponentRatio.toFixed(4)}`
      );
    }
    if (
      result.coastalNaturalCount >= 40 &&
      result.coastalEdgeInsetStdDev < 1.35 &&
      result.coastalDominantInsetRatio > 0.32
    ) {
      failures += 1;
      console.error(
        `[mapgen] coastline inset too uniform for ${key}: std=${result.coastalEdgeInsetStdDev.toFixed(2)} dominant=${result.coastalDominantInsetRatio.toFixed(4)}`
      );
    }
    if (result.coastalNaturalCount >= 40 && result.coastalBorderHuggingRatio > 0.35) {
      failures += 1;
      console.error(
        `[mapgen] coastline hugs map border too often for ${key}: ${result.coastalBorderHuggingRatio.toFixed(4)}`
      );
    }
    if (
      result.coastalNaturalCount >= 40 &&
      (
        result.coastalSideWallRunRatio > 0.55 ||
        (result.coastalSideWallRunRatio > 0.35 && result.coastalSideWallMinStdDev > 0 && result.coastalSideWallMinStdDev < 2.5)
      )
    ) {
      failures += 1;
      console.error(
        `[mapgen] coastline side boundary has a long straight run for ${key}: ${result.coastalSideWallRunRatio.toFixed(4)}`
      );
    }
    if (
      result.coastalNaturalCount >= 40 &&
      result.coastalSideWallMinStdDev > 0 &&
      result.coastalSideWallMinStdDev < 1.8
    ) {
      failures += 1;
      console.error(
        `[mapgen] coastline side boundary variance too low for ${key}: ${result.coastalSideWallMinStdDev.toFixed(2)}`
      );
    }
    const landTargetDrift = Math.abs(result.islandLandRatio - result.islandTargetLandRatio);
    if (landTargetDrift > 0.12) {
      failures += 1;
      console.error(
        `[mapgen] calibrated land ratio drift too high for ${key}: target=${result.islandTargetLandRatio.toFixed(4)} actual=${result.islandLandRatio.toFixed(4)}`
      );
    }
    if (result.settlementPadReliefMax > 0.015) {
      failures += 1;
      console.error(
        `[mapgen] settlement pad relief too high for ${key}: ${result.settlementPadReliefMax.toFixed(4)}`
      );
    }
    if (result.houseFootprintMaxAngle > 18.5 || result.highAngleHouseFootprintCount > 0) {
      failures += 1;
      console.error(
        `[mapgen] settlement house footprint angle too high for ${key}: max=${result.houseFootprintMaxAngle.toFixed(2)} high=${result.highAngleHouseFootprintCount}`
      );
    }
    if (result.settlementTownSeedMaxAngle > 40) {
      failures += 1;
      console.error(
        `[mapgen] settlement seed angle too high for ${key}: ${result.settlementTownSeedMaxAngle.toFixed(2)}`
      );
    }
    if (result.baseElevation > 0.84) {
      failures += 1;
      console.error(`[mapgen] base placed too high for ${key}: ${result.baseElevation.toFixed(4)}`);
    }
    if (result.baseLocalRelief > 0.12) {
      failures += 1;
      console.error(`[mapgen] base local relief too high for ${key}: ${result.baseLocalRelief.toFixed(4)}`);
    }
    if (result.baseCenterDistanceRatio > 0.48) {
      failures += 1;
      console.error(`[mapgen] base too far from center for ${key}: ${result.baseCenterDistanceRatio.toFixed(4)}`);
    }
    if (result.baseExactCenter && (result.baseElevation > 0.66 || result.baseLocalRelief > 0.035)) {
      failures += 1;
      console.error(
        `[mapgen] base fell back to unsuitable exact center for ${key}: elevation=${result.baseElevation.toFixed(4)} relief=${result.baseLocalRelief.toFixed(4)}`
      );
    }
    if (result.baseNearbyVegetationRatio < 0.05) {
      failures += 1;
      console.error(`[mapgen] base has too little nearby vegetated terrain for ${key}: ${result.baseNearbyVegetationRatio.toFixed(4)}`);
    }
    if (FOREST_AGE_CAP_YEARS > 5 && result.forestMaturityP95 >= 0.95) {
      failures += 1;
      console.error(`[mapgen] forest maturity p95 too high for ${key}: ${result.forestMaturityP95.toFixed(3)}`);
    }
    if (result.forestPct > 2 && result.forestSpeciesCount < 2) {
      failures += 1;
      console.error(`[mapgen] forest tree species diversity too low for ${key}: ${result.forestSpeciesCount}`);
    }
    if (result.compactTownViolationCount > 0) {
      failures += 1;
      console.error(`[mapgen] compact town morphology regressions for ${key}: ${JSON.stringify(result.compactTownViolations)}`);
    }
    if (hasBaseline) {
      const expected = index.get(key);
      if (!expected) {
        console.warn(`[mapgen] no baseline entry for ${key}`);
      } else {
        const drift = Math.abs(result.waterPct - expected.waterPct);
        if (drift > 12) {
          failures += 1;
          console.error(`[mapgen] water drift too high for ${key}: ${drift.toFixed(2)}%`);
        }
      }
    }
  }
  const lakeHitRate = results.filter((result) => result.lakeCount > 0).length / Math.max(1, results.length);
  if (lakeHitRate < 0.5) {
    failures += 1;
    console.error(`[mapgen] default terrain lake hit rate too low: ${lakeHitRate.toFixed(2)}`);
  }
  if (failures > 0) {
    throw new Error(`[mapgen] regression check failed (${failures} case(s)).`);
  }
};

validateHouseParcels();
if (syntheticRoadsOnly) {
  const syntheticDijkstra = runSyntheticDijkstraCases();
  const syntheticRoads = runSyntheticRoadAngleCases();
  if (!syntheticRoads.carved || syntheticRoads.usedSteepWall) {
    throw new Error(
      `[mapgen] synthetic road angle case failed: carved=${syntheticRoads.carved} steepWall=${syntheticRoads.usedSteepWall} maxAngle=${syntheticRoads.maxRoadAngleDeg.toFixed(2)}`
    );
  }
  const syntheticSwitchbacks = runSyntheticSwitchbackCase();
  if (
    !syntheticSwitchbacks.carved ||
    syntheticSwitchbacks.lateralSpan < 4 ||
    syntheticSwitchbacks.stats.switchbackRouteCount < 1 ||
    syntheticSwitchbacks.stats.switchbackTurnCount < 2 ||
    syntheticSwitchbacks.stats.switchbackTurnCount > 16
  ) {
    throw new Error(
      `[mapgen] synthetic switchback case failed: carved=${syntheticSwitchbacks.carved} lateral=${syntheticSwitchbacks.lateralSpan} routes=${syntheticSwitchbacks.stats.switchbackRouteCount} turns=${syntheticSwitchbacks.stats.switchbackTurnCount} hairpins=${syntheticSwitchbacks.stats.hairpinGradeDiscountCount} straightSteep=${syntheticSwitchbacks.stats.longStraightSteepSegmentCount}`
    );
  }
  const syntheticStraightSteep = runSyntheticStraightSteepNoDiscountCase();
  if (!syntheticStraightSteep.carved || syntheticStraightSteep.stats.hairpinGradeDiscountCount !== 0) {
    throw new Error(
      `[mapgen] synthetic straight-steep case failed: carved=${syntheticStraightSteep.carved} hairpins=${syntheticStraightSteep.stats.hairpinGradeDiscountCount}`
    );
  }
  const syntheticRoadCleanup = runSyntheticRoadArtifactCleanupCase();
  if (
    syntheticRoadCleanup.pruned < 1 ||
    syntheticRoadCleanup.stats.connectorArtifactPrunedEdgeCount !== syntheticRoadCleanup.pruned ||
    !syntheticRoadCleanup.stillConnected
  ) {
    throw new Error(
      `[mapgen] synthetic road cleanup case failed: pruned=${syntheticRoadCleanup.pruned} stats=${syntheticRoadCleanup.stats.connectorArtifactPrunedEdgeCount} connected=${syntheticRoadCleanup.stillConnected}`
    );
  }
  const syntheticMountainPass = runSyntheticMountainPassCase();
  if (!syntheticMountainPass.carved || syntheticMountainPass.stats.mountainPassFallbackCount < 1) {
    throw new Error(
      `[mapgen] synthetic mountain-pass case failed: carved=${syntheticMountainPass.carved} passes=${syntheticMountainPass.stats.mountainPassFallbackCount}`
    );
  }
  const syntheticStreamerNearJoin = runSyntheticRoadStreamerNearJoinCase();
  if (!syntheticStreamerNearJoin.carved || syntheticStreamerNearJoin.stats.pathsFound < 1) {
    throw new Error(
      `[mapgen] synthetic streamer near-join case failed: carved=${syntheticStreamerNearJoin.carved} paths=${syntheticStreamerNearJoin.stats.pathsFound}/${syntheticStreamerNearJoin.stats.pathsAttempted}`
    );
  }
  const syntheticStreamerDestinationSeeds = runSyntheticRoadStreamerDestinationSeedCase();
  if (!syntheticStreamerDestinationSeeds.carved || !syntheticStreamerDestinationSeeds.connectedToNetwork) {
    throw new Error(
      `[mapgen] synthetic streamer destination-seed case failed: carved=${syntheticStreamerDestinationSeeds.carved} connected=${syntheticStreamerDestinationSeeds.connectedToNetwork}`
    );
  }
  const syntheticStreamerBudget = runSyntheticRoadStreamerBudgetCase();
  if (syntheticStreamerBudget.carved || syntheticStreamerBudget.stats.searchBudgetAbortCount < 1) {
    throw new Error(
      `[mapgen] synthetic streamer budget case failed: carved=${syntheticStreamerBudget.carved} budget=${syntheticStreamerBudget.stats.searchBudgetAbortCount}`
    );
  }
  console.log(
    `[mapgen] synthetic roads ok dijkstraSelected=(${syntheticDijkstra.selected.x},${syntheticDijkstra.selected.y}) dijkstraExisting=${syntheticDijkstra.existingRoadSteps} dijkstraBudget=${syntheticDijkstra.budgetAborts} switchbacks=${syntheticSwitchbacks.stats.switchbackTurnCount} hairpins=${syntheticSwitchbacks.stats.hairpinGradeDiscountCount} cleanup=${syntheticRoadCleanup.pruned} lateral=${syntheticSwitchbacks.lateralSpan} passes=${syntheticMountainPass.stats.mountainPassFallbackCount} streamerBudget=${syntheticStreamerBudget.stats.searchBudgetAbortCount}`
  );
  process.exit(0);
}
await runDebugSmokes();
await runNoLakeSmoke();
await runRiverControlCompatibilitySmoke();
await runDeterministicHydrologySmoke();
const results = await runAll();
if (writeBaseline) {
  const payload = {
    generatedAt: new Date().toISOString(),
    entries: results
  };
  await writeFile(baselinePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  console.log(`[mapgen] baseline written: ${baselinePath}`);
} else {
  await compareAgainstBaseline(results);
}
