import { performance } from "node:perf_hooks";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const baselinePath = path.join(repoRoot, "docs", "mapgen-regression-baseline.json");
const writeBaseline = process.argv.includes("--write-baseline");

const distImport = (segments) => pathToFileURL(path.join(repoRoot, "dist", ...segments)).href;

const { createInitialState, resetState } = await import(distImport(["core", "state.js"]));
const { RNG } = await import(distImport(["core", "rng.js"]));
const { MAP_SIZE_PRESETS } = await import(distImport(["core", "config.js"]));
const { generateMap } = await import(distImport(["mapgen", "index.js"]));

const allSizes = ["medium", "massive", "colossal", "gigantic", "titanic"];
const quickSizes = ["medium", "massive", "colossal"];
const sizes = process.argv.includes("--full") ? allSizes : quickSizes;
const seeds = [1337];

const createGrid = (sizeId) => {
  const dim = MAP_SIZE_PRESETS[sizeId];
  if (!Number.isFinite(dim)) {
    throw new Error(`Unknown map size '${sizeId}'.`);
  }
  return { cols: dim, rows: dim, totalTiles: dim * dim };
};

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

const runCase = async (sizeId, seed) => {
  const grid = createGrid(sizeId);
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed);
  resetState(state, seed);
  rng.setState(seed);

  const phaseTimingsMs = {};
  let lastAt = performance.now();
  const started = lastAt;
  await generateMap(state, rng, undefined, undefined, {
    onPhase: async (snapshot) => {
      const now = performance.now();
      phaseTimingsMs[snapshot.phase] = Number((now - lastAt).toFixed(2));
      lastAt = now;
    }
  });
  const durationMs = performance.now() - started;

  let water = 0;
  let forest = 0;
  let houses = 0;
  let roads = 0;
  let river = 0;
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
    houseCount: houses,
    roadCount: roads,
    riverCount: river,
    phaseTimingsMs,
    biomeSpreadClassifyMs: Number((biomeSpreadMs + biomeClassifyMs).toFixed(2)),
    ...patchMetrics
  };
};

const runAll = async () => {
  const results = [];
  for (const sizeId of sizes) {
    for (const seed of seeds) {
      const metrics = await runCase(sizeId, seed);
      results.push(metrics);
      console.log(
        `[mapgen] size=${metrics.sizeId} seed=${metrics.seed} ms=${metrics.durationMs.toFixed(2)} biome=${metrics.biomeSpreadClassifyMs.toFixed(2)}ms water=${metrics.waterPct.toFixed(2)}% forest=${metrics.forestPct.toFixed(2)}% patches=${metrics.forestPatchCount} meanPatch=${metrics.forestPatchMean} p95Patch=${metrics.forestPatchP95} houses=${metrics.houseCount} roads=${metrics.roadCount} rivers=${metrics.riverCount}`
      );
    }
  }
  return results;
};

const compareAgainstBaseline = async (results) => {
  let baselineRaw = null;
  try {
    baselineRaw = await readFile(baselinePath, "utf8");
  } catch {
    console.warn("[mapgen] baseline file missing; skipping comparison.");
    return;
  }
  const baseline = JSON.parse(baselineRaw);
  const entries = baseline?.entries ?? [];
  const index = new Map(entries.map((entry) => [`${entry.sizeId}:${entry.seed}`, entry]));
  let failures = 0;
  for (const result of results) {
    const key = `${result.sizeId}:${result.seed}`;
    const expected = index.get(key);
    if (!expected) {
      console.warn(`[mapgen] no baseline entry for ${key}`);
      continue;
    }
    const drift = Math.abs(result.waterPct - expected.waterPct);
    if (drift > 8) {
      failures += 1;
      console.error(`[mapgen] water drift too high for ${key}: ${drift.toFixed(2)}%`);
    }
  }
  if (failures > 0) {
    throw new Error(`[mapgen] regression check failed (${failures} case(s)).`);
  }
};

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
