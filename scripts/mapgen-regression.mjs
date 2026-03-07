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
const quickSizes = ["medium", "massive"];
const fullMode = process.argv.includes("--full");
const sizes = fullMode ? allSizes : quickSizes;
const seeds = fullMode ? [1337] : [1337, 2, 4, 9001];

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
  const oceanMask = buildOceanMask(state);
  let riverCells = 0;
  let diagOnlyLinks = 0;
  let isolatedCells = 0;
  let orthConnectedCells = 0;
  let riverComponentCount = 0;
  let detachedRiverComponents = 0;
  let detachedRiverCells = 0;
  const hasRiver = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && riverMask[y * cols + x] > 0;
  for (let i = 0; i < totalTiles; i += 1) {
    if (!(riverMask[i] > 0)) {
      continue;
    }
    riverCells += 1;
    const x = i % cols;
    const y = Math.floor(i / cols);
    const orthCount =
      (hasRiver(x - 1, y) ? 1 : 0) +
      (hasRiver(x + 1, y) ? 1 : 0) +
      (hasRiver(x, y - 1) ? 1 : 0) +
      (hasRiver(x, y + 1) ? 1 : 0);
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
    if (visited[i] > 0 || riverMask[i] === 0) {
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
    while (head < tail) {
      const idx = queue[head];
      head += 1;
      size += 1;
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
        if (riverMask[nIdx] > 0) {
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
    if (!touchesEdge && !touchesOcean) {
      detachedRiverComponents += 1;
      detachedRiverCells += size;
    }
  }
  return {
    riverDiagOnlyLinks: diagOnlyLinks,
    riverIsolatedCells: isolatedCells,
    riverOrthConnectivityRatio: Number((riverCells > 0 ? orthConnectedCells / riverCells : 1).toFixed(4)),
    riverComponentCount,
    detachedRiverComponents,
    detachedRiverCells
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

const analyzeCoastalClassification = (state) => {
  const { cols, rows, totalTiles } = state.grid;
  const oceanMask = buildOceanMask(state);
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
  const riverMetrics = analyzeRiverConnectivity(state);
  const roadMetrics = analyzeRoadEdgeQuality(state);
  const coastMetrics = analyzeCoastalClassification(state);
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
    ...patchMetrics,
    ...riverMetrics,
    ...roadMetrics,
    ...coastMetrics
  };
};

const runAll = async () => {
  const results = [];
  for (const sizeId of sizes) {
    for (const seed of seeds) {
      const metrics = await runCase(sizeId, seed);
      results.push(metrics);
      console.log(
        `[mapgen] size=${metrics.sizeId} seed=${metrics.seed} ms=${metrics.durationMs.toFixed(2)} biome=${metrics.biomeSpreadClassifyMs.toFixed(2)}ms water=${metrics.waterPct.toFixed(2)}% forest=${metrics.forestPct.toFixed(2)}% patches=${metrics.forestPatchCount} meanPatch=${metrics.forestPatchMean} p95Patch=${metrics.forestPatchP95} houses=${metrics.houseCount} roads=${metrics.roadCount} rivers=${metrics.riverCount} roadIgnoredDiag=${metrics.ignoredDiagonalCount} roadUnmatched=${metrics.unmatchedPatternCount} riverDiagOnly=${metrics.riverDiagOnlyLinks} riverIso=${metrics.riverIsolatedCells} riverOrthRatio=${metrics.riverOrthConnectivityRatio.toFixed(4)} riverComps=${metrics.riverComponentCount} riverDetachedComps=${metrics.detachedRiverComponents} riverDetachedCells=${metrics.detachedRiverCells} coastNatural=${metrics.coastalNaturalCount} coastBeach=${metrics.coastalBeachCount} coastRocky=${metrics.coastalRockyCount} coastOther=${metrics.coastalOtherCount}`
      );
    }
  }
  return results;
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
    if (result.coastalNaturalCount > 0 && result.coastalOtherCount !== 0) {
      failures += 1;
      console.error(
        `[mapgen] coastline classification drift for ${key}: coastalOther=${result.coastalOtherCount} of natural=${result.coastalNaturalCount}`
      );
    }
    if (hasBaseline) {
      const expected = index.get(key);
      if (!expected) {
        console.warn(`[mapgen] no baseline entry for ${key}`);
      } else {
        const drift = Math.abs(result.waterPct - expected.waterPct);
        if (drift > 8) {
          failures += 1;
          console.error(`[mapgen] water drift too high for ${key}: ${drift.toFixed(2)}%`);
        }
      }
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
