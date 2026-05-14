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
const { HOUSE_VARIANTS } = await import(distImport(["core", "buildingFootprints.js"]));
const { FOREST_AGE_CAP_YEARS, getVegetationMaturity01 } = await import(distImport(["core", "vegetation.js"]));
const { generateMap } = await import(distImport(["mapgen", "index.js"]));
const { createDefaultTerrainRecipe } = await import(distImport(["mapgen", "terrainProfile.js"]));
const { analyzeRoadSurfaceMetrics } = await import(distImport(["mapgen", "roads.js"]));

const allSizes = ["medium", "massive", "colossal", "gigantic", "titanic"];
const quickSizes = ["medium", "massive"];
const fullMode = process.argv.includes("--full");
const sizes = fullMode ? allSizes : quickSizes;
const seeds = fullMode ? [1337] : [1337, 2, 4, 9001];
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

const analyzeIslandShape = (state, targetLandRatio) => {
  const { cols, rows, totalTiles } = state.grid;
  const oceanMask = buildOceanMask(state);
  let oceanCount = 0;
  let borderCount = 0;
  let borderOceanCount = 0;
  for (let y = 0; y < rows; y += 1) {
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
  return {
    islandTargetLandRatio: Number(targetLandRatio.toFixed(4)),
    islandLandRatio: Number(landRatio.toFixed(4)),
    islandOceanRatio: Number((oceanCount / Math.max(1, totalTiles)).toFixed(4)),
    islandBorderOceanRatio: Number((borderOceanCount / Math.max(1, borderCount)).toFixed(4)),
    islandMainLandComponentRatio: Number((largestLandComponent / Math.max(1, landCount)).toFixed(4))
  };
};

const analyzeBaseSite = (state) => {
  const { cols, rows } = state.grid;
  const center = { x: Math.floor(cols / 2), y: Math.floor(rows / 2) };
  const base = state.basePoint ?? center;
  const baseIdx = base.y * cols + base.x;
  const baseTile = state.tiles[baseIdx];
  const baseElevation = baseTile?.elevation ?? 0;
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
      if (distance <= reliefRadius) {
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
    if (meaningful && aspect > COMPACT_TOWN_ASPECT_LIMIT) {
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

const runCase = async (sizeId, seed) => {
  const grid = createGrid(sizeId);
  const state = createInitialState(seed, grid);
  const rng = new RNG(seed);
  resetState(state, seed);
  rng.setState(seed);

  const phaseTimingsMs = {};
  const emittedPhases = [];
  let lastAt = performance.now();
  const started = lastAt;
  await generateMap(state, rng, undefined, undefined, {
    onPhase: async (snapshot) => {
      emittedPhases.push(snapshot.phase);
      assertSnapshotShape(snapshot, grid.totalTiles, `${sizeId}:${seed}`);
      const now = performance.now();
      phaseTimingsMs[snapshot.phase] = Number((now - lastAt).toFixed(2));
      lastAt = now;
    }
  });
  assertPhaseOrder(emittedPhases, EXPECTED_DEBUG_PHASE_ORDER, `${sizeId}:${seed}`);
  const durationMs = performance.now() - started;

  let water = 0;
  let forest = 0;
  let houses = 0;
  let roads = 0;
  let river = 0;
  let forestAgeSum = 0;
  const forestMaturities = [];
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
  const roadSurfaceMetrics = analyzeRoadSurfaceMetrics(state);
  const coastMetrics = analyzeCoastalClassification(state);
  const islandMetrics = analyzeIslandShape(state, createDefaultTerrainRecipe(sizeId).landCoverageTarget);
  const baseMetrics = analyzeBaseSite(state);
  const townMorphologies = analyzeTownMorphologies(state);
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
    houseCount: houses,
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
    ...roadMetrics,
    ...roadSurfaceMetrics,
    ...coastMetrics,
    ...islandMetrics,
    ...baseMetrics
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

const runAll = async () => {
  const results = [];
  for (const sizeId of sizes) {
    for (const seed of seeds) {
      const metrics = await runCase(sizeId, seed);
      results.push(metrics);
      console.log(
        `[mapgen] size=${metrics.sizeId} seed=${metrics.seed} ms=${metrics.durationMs.toFixed(2)} biome=${metrics.biomeSpreadClassifyMs.toFixed(2)}ms water=${metrics.waterPct.toFixed(2)}% forest=${metrics.forestPct.toFixed(2)}% forestAgeMean=${metrics.forestAgeMean.toFixed(2)} forestMaturityP95=${metrics.forestMaturityP95.toFixed(3)} patches=${metrics.forestPatchCount} meanPatch=${metrics.forestPatchMean} p95Patch=${metrics.forestPatchP95} houses=${metrics.houseCount} placed=${metrics.placedHouseCount}/${metrics.requestedHouseCount} compactEval=${metrics.compactTownEvalCount} compactViolations=${metrics.compactTownViolationCount} compactMaxAspect=${metrics.compactTownMaxAspect.toFixed(2)} base=(${metrics.baseX},${metrics.baseY}) baseElev=${metrics.baseElevation.toFixed(4)} baseRelief=${metrics.baseLocalRelief.toFixed(4)} baseCenter=${metrics.baseCenterDistanceRatio.toFixed(4)} baseVeg=${metrics.baseNearbyVegetationRatio.toFixed(4)} padReliefMax=${metrics.settlementPadReliefMax.toFixed(4)} padReliefMean=${metrics.settlementPadReliefMean.toFixed(4)} roads=${metrics.roadCount} rivers=${metrics.riverCount} roadIgnoredDiag=${metrics.ignoredDiagonalCount} roadUnmatched=${metrics.unmatchedPatternCount} roadGrade=${metrics.maxRoadGrade.toFixed(3)} roadCrossfall=${metrics.maxRoadCrossfall.toFixed(3)} roadGradeChange=${metrics.maxRoadGradeChange.toFixed(3)} roadWalls=${metrics.wallEdgeCount} riverDiagOnly=${metrics.riverDiagOnlyLinks} riverIso=${metrics.riverIsolatedCells} riverOrthRatio=${metrics.riverOrthConnectivityRatio.toFixed(4)} riverComps=${metrics.riverComponentCount} riverDetachedComps=${metrics.detachedRiverComponents} riverDetachedCells=${metrics.detachedRiverCells} coastNatural=${metrics.coastalNaturalCount} coastBeach=${metrics.coastalBeachCount} coastRocky=${metrics.coastalRockyCount} coastOther=${metrics.coastalOtherCount}`
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
    if (result.baseElevation > 0.74) {
      failures += 1;
      console.error(`[mapgen] base placed too high for ${key}: ${result.baseElevation.toFixed(4)}`);
    }
    if (result.baseLocalRelief > 0.06) {
      failures += 1;
      console.error(`[mapgen] base local relief too high for ${key}: ${result.baseLocalRelief.toFixed(4)}`);
    }
    if (result.baseCenterDistanceRatio > 0.34) {
      failures += 1;
      console.error(`[mapgen] base too far from center for ${key}: ${result.baseCenterDistanceRatio.toFixed(4)}`);
    }
    if (result.baseExactCenter && (result.baseElevation > 0.66 || result.baseLocalRelief > 0.035)) {
      failures += 1;
      console.error(
        `[mapgen] base fell back to unsuitable exact center for ${key}: elevation=${result.baseElevation.toFixed(4)} relief=${result.baseLocalRelief.toFixed(4)}`
      );
    }
    if (result.baseNearbyVegetationRatio < 0.1) {
      failures += 1;
      console.error(`[mapgen] base has too little nearby vegetated terrain for ${key}: ${result.baseNearbyVegetationRatio.toFixed(4)}`);
    }
    if (FOREST_AGE_CAP_YEARS > 5 && result.forestMaturityP95 >= 0.95) {
      failures += 1;
      console.error(`[mapgen] forest maturity p95 too high for ${key}: ${result.forestMaturityP95.toFixed(3)}`);
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

validateHouseParcels();
await runDebugSmokes();
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
