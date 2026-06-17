import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distImport = (segments) => pathToFileURL(path.join(repoRoot, "dist", ...segments)).href;

const args = new Map();
for (const arg of process.argv.slice(2)) {
  if (!arg.startsWith("--")) {
    continue;
  }
  const eq = arg.indexOf("=");
  if (eq >= 0) {
    args.set(arg.slice(2, eq), arg.slice(eq + 1));
  } else {
    args.set(arg.slice(2), "true");
  }
}

const shareCode = args.get("share-code") ?? "";
const baselinePath = path.resolve(repoRoot, args.get("baseline") ?? "docs/road-sharecode-regression-baseline.json");
const writeBaseline = args.get("write-baseline") === "true";

if (shareCode.length === 0) {
  throw new Error("Missing --share-code=<code>.");
}

const { RNG } = await import(distImport(["core", "rng.js"]));
const { createInitialState } = await import(distImport(["core", "state.js"]));
const { MAP_SIZE_PRESETS } = await import(distImport(["core", "config.js"]));
const { STRUCTURE_HOUSE } = await import(distImport(["core", "towns.js"]));
const { generateMap } = await import(distImport(["mapgen", "index.js"]));
const { collectConnectedRoadNeighbors } = await import(distImport(["mapgen", "roads.js"]));
const { decodeTerrainSeedCode } = await import(distImport(["ui", "terrainSeedCode.js"]));
const { DEFAULT_ROAD_DIAGNOSTIC_TUNING } = await import(distImport(["systems", "roads", "types", "roadDiagnosticTuning.js"]));

const decoded = decodeTerrainSeedCode(shareCode);
if (!decoded) {
  throw new Error("Invalid share code.");
}

const size = MAP_SIZE_PRESETS[decoded.mapSize];
if (!size) {
  throw new Error(`Unknown map size '${decoded.mapSize}'.`);
}

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

const collectHouses = (state) => {
  const houses = [];
  for (let idx = 0; idx < state.grid.totalTiles; idx += 1) {
    if (state.tileStructure[idx] !== STRUCTURE_HOUSE || state.tiles[idx]?.type !== "house") {
      continue;
    }
    const townId = state.tileTownId[idx] ?? -1;
    houses.push({
      id: `town:${townId}:house:${idx}`,
      townId,
      anchorIndex: idx,
      x: idx % state.grid.cols,
      y: Math.floor(idx / state.grid.cols)
    });
  }
  houses.sort((left, right) => left.townId - right.townId || left.anchorIndex - right.anchorIndex);
  return houses;
};

const isRoadLike = (state, x, y) => {
  if (x < 0 || y < 0 || x >= state.grid.cols || y >= state.grid.rows) {
    return false;
  }
  const idx = y * state.grid.cols + x;
  return state.tiles[idx]?.type === "road" || (state.tileRoadEdges[idx] ?? 0) > 0 || (state.tileRoadBridge[idx] ?? 0) > 0;
};

const findTownRoadAnchor = (state, town) => {
  let best = null;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let radius = 2; radius <= 14; radius += 2) {
    for (let y = town.y - radius; y <= town.y + radius; y += 1) {
      for (let x = town.x - radius; x <= town.x + radius; x += 1) {
        if (!isRoadLike(state, x, y)) {
          continue;
        }
        const dist = Math.abs(town.x - x) + Math.abs(town.y - y);
        if (dist < bestDist) {
          bestDist = dist;
          best = { x, y };
        }
      }
    }
    if (best) {
      return best;
    }
  }
  return best;
};

const collectReachableRoads = (state, start) => {
  const visited = new Uint8Array(state.grid.totalTiles);
  const queue = [start.y * state.grid.cols + start.x];
  visited[queue[0]] = 1;
  for (let head = 0; head < queue.length; head += 1) {
    const idx = queue[head];
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    const neighbors = collectConnectedRoadNeighbors(state, x, y);
    for (const neighbor of neighbors) {
      if (!isRoadLike(state, neighbor.x, neighbor.y)) {
        continue;
      }
      const nIdx = neighbor.y * state.grid.cols + neighbor.x;
      if (visited[nIdx] > 0) {
        continue;
      }
      visited[nIdx] = 1;
      queue.push(nIdx);
    }
  }
  return visited;
};

const summarizeNamedTownConnectivity = (state) => {
  const anchors = state.towns.map((town) => ({
    townId: town.id,
    town: town.name,
    anchor: findTownRoadAnchor(state, town)
  }));
  if (anchors.length <= 1) {
    return { allNamedTownsConnected: true, disconnectedTowns: [], anchors };
  }
  const first = anchors.find((entry) => entry.anchor);
  if (!first?.anchor) {
    return {
      allNamedTownsConnected: false,
      disconnectedTowns: anchors.map((entry) => entry.town),
      anchors
    };
  }
  const reachable = collectReachableRoads(state, first.anchor);
  const disconnectedTowns = anchors
    .filter((entry) => !entry.anchor || reachable[entry.anchor.y * state.grid.cols + entry.anchor.x] === 0)
    .map((entry) => entry.town);
  return {
    allNamedTownsConnected: disconnectedTowns.length === 0,
    disconnectedTowns,
    anchors
  };
};

const collectUnconnectedHouses = (state, houses) =>
  houses.filter((house) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) {
        if (Math.abs(dx) + Math.abs(dy) > 2 || (dx === 0 && dy === 0)) {
          continue;
        }
        if (isRoadLike(state, house.x + dx, house.y + dy)) {
          return false;
        }
      }
    }
    return true;
  });

const summarizeGroupedRoads = (events) => ({
  planned: events
    .filter((event) => event.kind === "road:planned")
    .map((event) => ({
      id: event.diagnosticRouteId,
      label: event.diagnosticRouteLabel,
      type: event.routeType,
      group: event.routeGroup,
      reason: event.reason,
      townA: event.townA?.name ?? null,
      townB: event.townB?.name ?? null,
      town: event.town?.name ?? null,
      houseId: event.houseId ?? null,
      searchBudget: event.searchBudget
    })),
  completed: events
    .filter((event) => event.kind === "road:completed")
    .map((event) => ({
      id: event.diagnosticRouteId,
      label: event.diagnosticRouteLabel,
      type: event.routeType,
      group: event.routeGroup,
      reason: event.reason,
      attempts: event.attempts,
      pathLength: event.pathLength,
      searchBudget: event.searchBudget
    })),
  failed: events
    .filter((event) => event.kind === "road:failed")
    .map((event) => ({
      id: event.diagnosticRouteId,
      label: event.diagnosticRouteLabel,
      type: event.routeType,
      group: event.routeGroup,
      reason: event.reason,
      attempts: event.attempts,
      searchBudget: event.searchBudget,
      failureReason: event.failureReason
    })),
  duplicateRetries: events
    .filter((event) => event.kind === "road:duplicate-retry")
    .map((event) => ({
      id: event.diagnosticRouteId,
      label: event.diagnosticRouteLabel,
      type: event.routeType,
      group: event.routeGroup,
      reason: event.reason,
      attempts: event.attempts
    })),
  intratown: events
    .filter((event) => event.kind === "road:intratown-summary")
    .map((event) => ({
      id: event.diagnosticRouteId,
      townId: event.town.id,
      town: event.town.name,
      group: event.routeGroup,
      housesNeedingAccess: event.housesNeedingAccess,
      attempts: event.attempts,
      housesConnected: event.housesConnected,
      housesFailed: event.housesFailed,
      townRoutingBudget: event.townRoutingBudget
    })),
  failedHouses: events
    .filter((event) => event.kind === "road:failed-house")
    .map((event) => ({
      id: event.houseId,
      townId: event.town.id,
      town: event.town.name,
      group: event.routeGroup,
      anchorIndex: event.anchorIndex,
      failureReason: event.failureReason,
      attempts: event.attempts
    }))
});

const diffById = (baselineItems, currentItems, key = "id") => {
  const before = new Map(baselineItems.map((item) => [item[key], item]));
  const after = new Map(currentItems.map((item) => [item[key], item]));
  const added = [...after.keys()].filter((id) => !before.has(id)).sort();
  const removed = [...before.keys()].filter((id) => !after.has(id)).sort();
  const changed = [];
  for (const [id, current] of after.entries()) {
    const previous = before.get(id);
    if (!previous) {
      continue;
    }
    if (JSON.stringify(previous) !== JSON.stringify(current)) {
      changed.push(id);
    }
  }
  changed.sort();
  return { added, removed, changed };
};

const events = [];
const timings = [];
const grid = { cols: size, rows: size, totalTiles: size * size };
const state = createInitialState(decoded.seed, grid);
const startedAt = performance.now();
await generateMap(state, new RNG(decoded.seed), undefined, decoded.terrain, {
  onPhase: () => {},
  onStageTiming: (timing) => timings.push(timing),
  roadTuning: DEFAULT_ROAD_DIAGNOSTIC_TUNING,
  onDiagnosticEvent: (event) => events.push(event)
});
const durationMs = Math.max(0, performance.now() - startedAt);
const groupedRoads = summarizeGroupedRoads(events);
const lowLevelResults = events.filter((event) => event.kind === "road:result");
const houses = collectHouses(state);
const unconnectedHouses = collectUnconnectedHouses(state, houses);
const namedTownConnectivity = summarizeNamedTownConnectivity(state);
const townsWithUnconnectedHouses = [...new Set(unconnectedHouses.map((house) => house.townId))]
  .map((townId) => {
    const town = state.towns.find((candidate) => candidate.id === townId);
    return {
      townId,
      town: town?.name ?? `Town ${townId}`,
      houses: unconnectedHouses.filter((house) => house.townId === townId).map((house) => house.id)
    };
  })
  .sort((left, right) => left.townId - right.townId);

const report = {
  shareCode,
  seed: decoded.seed,
  mapSize: decoded.mapSize,
  hash: hashArrays(
    state.tileElevation,
    state.tileTypeId,
    state.tileRiverMask,
    state.tileLakeMask,
    state.tileRoadEdges,
    state.tileRoadBridge
  ),
  durationMs: Math.round(durationMs),
  roadStageMs: Math.round(timings.find((timing) => timing.phase === "roads:connect")?.durationMs ?? 0),
  routingSettings: decoded.terrain.advancedOverrides ?? {},
  towns: state.towns.map((town) => ({
    id: town.id,
    name: town.name,
    x: town.x,
    y: town.y,
    houseCount: town.houseCount,
    archetype: town.streetArchetype
  })),
  houses,
  unconnectedHouses,
  namedTownConnectivity,
  townsWithUnconnectedHouses,
  lowLevel: {
    attempts: events.filter((event) => event.kind === "road:attempt").length,
    results: lowLevelResults.length,
    found: lowLevelResults.filter((event) => event.found).length,
    failed: lowLevelResults.filter((event) => !event.found).length,
    budgetAborted: lowLevelResults.filter((event) => event.budgetAborted).length,
    carves: events.filter((event) => event.kind === "road:carve").length
  },
  groupedRoads
};

if (!namedTownConnectivity.allNamedTownsConnected) {
  throw new Error(`Named towns are not connected: ${namedTownConnectivity.disconnectedTowns.join(", ")}`);
}

if (writeBaseline) {
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`[road-sharecode] wrote baseline ${path.relative(repoRoot, baselinePath)} hash=${report.hash}`);
  process.exit(0);
}

let baseline = null;
if (fs.existsSync(baselinePath)) {
  baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
}

if (!baseline) {
  console.log(`[road-sharecode] no baseline at ${path.relative(repoRoot, baselinePath)} hash=${report.hash}`);
  console.log(JSON.stringify({
    towns: report.towns.length,
    houses: report.houses.length,
    intertownCompleted: groupedRoads.completed.filter((event) => event.type === "intertown").length,
    intertownFailed: groupedRoads.failed.filter((event) => event.type === "intertown").length,
    allNamedTownsConnected: namedTownConnectivity.allNamedTownsConnected,
    disconnectedTowns: namedTownConnectivity.disconnectedTowns,
    townsWithUnconnectedHouses: townsWithUnconnectedHouses.length,
    attempts: report.lowLevel.attempts,
    routingMs: report.roadStageMs
  }, null, 2));
  process.exit(0);
}

const diffs = {
  towns: diffById(baseline.towns ?? [], report.towns),
  houses: diffById(baseline.houses ?? [], report.houses),
  planned: diffById(baseline.groupedRoads?.planned ?? [], groupedRoads.planned),
  completed: diffById(baseline.groupedRoads?.completed ?? [], groupedRoads.completed),
  failed: diffById(baseline.groupedRoads?.failed ?? [], groupedRoads.failed),
  failedHouses: diffById(baseline.groupedRoads?.failedHouses ?? [], groupedRoads.failedHouses)
};

const changed =
  report.hash !== baseline.hash ||
  Object.values(diffs).some((diff) => diff.added.length > 0 || diff.removed.length > 0 || diff.changed.length > 0);

console.log(
  `[road-sharecode] hash=${report.hash}${baseline.hash ? ` baseline=${baseline.hash}` : ""} roads=${report.lowLevel.found}/${report.lowLevel.results} attempts=${report.lowLevel.attempts} routingMs=${report.roadStageMs}`
);
console.log(JSON.stringify({
  townPairOutcomes: {
    succeeded: groupedRoads.completed.filter((event) => event.type === "intertown").map((event) => event.label),
    failed: groupedRoads.failed.filter((event) => event.type === "intertown").map((event) => `${event.label}:${event.failureReason}`)
  },
  namedTownConnectivity: {
    allNamedTownsConnected: namedTownConnectivity.allNamedTownsConnected,
    disconnectedTowns: namedTownConnectivity.disconnectedTowns
  },
  townsWithUnconnectedHouses: townsWithUnconnectedHouses.map((entry) => `${entry.town}:${entry.houses.length}`),
  diffs
}, null, 2));

if (changed) {
  throw new Error("Road share-code regression changed from baseline.");
}
