import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distImport = (segments) => pathToFileURL(path.join(repoRoot, "dist", ...segments)).href;

const { createInitialState, resetState } = await import(distImport(["core", "state.js"]));
const { RNG } = await import(distImport(["core", "rng.js"]));
const { MAP_SIZE_PRESETS } = await import(distImport(["core", "config.js"]));
const { generateMap } = await import(distImport(["mapgen", "index.js"]));
const { createDefaultTerrainRecipe, compileTerrainRecipe } = await import(distImport(["mapgen", "terrainProfile.js"]));
const { analyzeRoadSurfaceMetrics } = await import(distImport(["mapgen", "roads.js"]));

const archetypes = ["MASSIF", "LONG_SPINE", "TWIN_BAY", "SHELF"];
const arg = (name, fallback) => {
  const match = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!match) {
    return fallback;
  }
  return match.slice(name.length + 3);
};

const sizeId = arg("size", "colossal");
const sampleCount = Math.max(1, Number(arg("samples", "4")) || 4);
const baseSeed = Math.floor(Number(arg("seed", "1337")) || 1337);
const size = MAP_SIZE_PRESETS[sizeId];

if (!size) {
  throw new Error(`Unknown size '${sizeId}'.`);
}

const buildGrid = () => ({ cols: size, rows: size, totalTiles: size * size });

const analyzeLandAndCoast = (state) => {
  let land = 0;
  let water = 0;
  let coastEdges = 0;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = y * state.grid.cols + x;
      const type = state.tiles[idx]?.type;
      if (type === "water") {
        water += 1;
      } else {
        land += 1;
      }
      if (type === "water") {
        continue;
      }
      const neighbors = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1]
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= state.grid.cols || ny >= state.grid.rows) {
          coastEdges += 1;
          continue;
        }
        const nIdx = ny * state.grid.cols + nx;
        if (state.tiles[nIdx]?.type === "water") {
          coastEdges += 1;
        }
      }
    }
  }
  return {
    landRatio: Number((land / Math.max(1, state.grid.totalTiles)).toFixed(4)),
    waterRatio: Number((water / Math.max(1, state.grid.totalTiles)).toFixed(4)),
    coastComplexity: Number((coastEdges / Math.max(1, land)).toFixed(4))
  };
};

const analyzeRelief = (state) => {
  let sumElevation = 0;
  let maxElevation = 0;
  let maxSlope = 0;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = y * state.grid.cols + x;
      const elevation = state.tiles[idx]?.elevation ?? 0;
      sumElevation += elevation;
      maxElevation = Math.max(maxElevation, elevation);
      const neighbors = [];
      if (x > 0) {
        neighbors.push(state.tiles[idx - 1]?.elevation ?? elevation);
      }
      if (x < state.grid.cols - 1) {
        neighbors.push(state.tiles[idx + 1]?.elevation ?? elevation);
      }
      if (y > 0) {
        neighbors.push(state.tiles[idx - state.grid.cols]?.elevation ?? elevation);
      }
      if (y < state.grid.rows - 1) {
        neighbors.push(state.tiles[idx + state.grid.cols]?.elevation ?? elevation);
      }
      neighbors.forEach((neighbor) => {
        maxSlope = Math.max(maxSlope, Math.abs(elevation - neighbor));
      });
    }
  }
  return {
    meanElevation: Number((sumElevation / Math.max(1, state.grid.totalTiles)).toFixed(4)),
    maxElevation: Number(maxElevation.toFixed(4)),
    maxSlope: Number(maxSlope.toFixed(4))
  };
};

const analyzeRivers = (state) => {
  let riverTiles = 0;
  for (let i = 0; i < state.tileRiverMask.length; i += 1) {
    if (state.tileRiverMask[i] > 0) {
      riverTiles += 1;
    }
  }
  return {
    riverCoverage: Number((riverTiles / Math.max(1, state.grid.totalTiles)).toFixed(4)),
    riverTiles
  };
};

const analyzeSettlements = (state) => {
  let bridgeTiles = 0;
  for (let i = 0; i < state.tileRoadBridge.length; i += 1) {
    if (state.tileRoadBridge[i] > 0) {
      bridgeTiles += 1;
    }
  }
  return {
    townCount: state.towns.length,
    houseCount: state.totalHouses,
    bridgeTiles
  };
};

const analyzeErosionDelta = (before, after) => {
  if (!before || !after || before.length !== after.length) {
    return {
      erosionCoverage: 0,
      erosionMeanAbsOffset: 0,
      erosionP95AbsOffset: 0
    };
  }
  let coverage = 0;
  let absOffsetSum = 0;
  const absOffsets = new Array(before.length);
  for (let i = 0; i < before.length; i += 1) {
    const absOffset = Math.abs((after[i] ?? 0) - (before[i] ?? 0));
    absOffsets[i] = absOffset;
    absOffsetSum += absOffset;
    if (absOffset >= 0.001) {
      coverage += 1;
    }
  }
  absOffsets.sort((left, right) => left - right);
  const p95Index = Math.min(absOffsets.length - 1, Math.floor((absOffsets.length - 1) * 0.95));
  return {
    erosionCoverage: Number((coverage / Math.max(1, before.length)).toFixed(4)),
    erosionMeanAbsOffset: Number((absOffsetSum / Math.max(1, before.length)).toFixed(5)),
    erosionP95AbsOffset: Number((absOffsets[p95Index] ?? 0).toFixed(5))
  };
};

const runs = [];
const rng = new RNG(baseSeed);

for (const archetype of archetypes) {
  for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
    const seed = baseSeed + sampleIndex * 97 + archetypes.indexOf(archetype) * 997;
    const world = createInitialState(seed, buildGrid());
    resetState(world, seed);
    rng.setState(seed);
    const recipe = createDefaultTerrainRecipe(sizeId, archetype);
    recipe.mapSize = sizeId;
    let elevationBeforeErosion = null;
    let elevationAfterErosion = null;
    await generateMap(world, rng, undefined, recipe, {
      onPhase: async (snapshot) => {
        if (snapshot.phase === "terrain:elevation") {
          elevationBeforeErosion = snapshot.elevations;
        } else if (snapshot.phase === "terrain:erosion") {
          elevationAfterErosion = snapshot.elevations;
        }
      }
    });
    const roadMetrics = analyzeRoadSurfaceMetrics(world);
    runs.push({
      archetype,
      seed,
      recipe: compileTerrainRecipe(recipe).recipe,
      ...analyzeLandAndCoast(world),
      ...analyzeRelief(world),
      ...analyzeErosionDelta(elevationBeforeErosion, elevationAfterErosion),
      ...analyzeRivers(world),
      ...analyzeSettlements(world),
      roadMetrics: {
        maxRoadGrade: Number(roadMetrics.maxRoadGrade.toFixed(4)),
        maxRoadCrossfall: Number(roadMetrics.maxRoadCrossfall.toFixed(4)),
        maxRoadGradeChange: Number(roadMetrics.maxRoadGradeChange.toFixed(4)),
        wallEdgeCount: roadMetrics.wallEdgeCount
      }
    });
  }
}

console.log(JSON.stringify({
  generatedAt: new Date().toISOString(),
  sizeId,
  sampleCount,
  runs
}, null, 2));
