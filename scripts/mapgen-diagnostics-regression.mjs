import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distImport = (segments) => pathToFileURL(path.join(repoRoot, "dist", ...segments)).href;

const { RNG } = await import(distImport(["core", "rng.js"]));
const { createInitialState } = await import(distImport(["core", "state.js"]));
const { generateMap, isMapGenCancelledError } = await import(distImport(["mapgen", "index.js"]));
const { createDefaultTerrainRecipe } = await import(distImport(["mapgen", "terrainProfile.js"]));

const seed = 424242;
const grid = { cols: 64, rows: 64, totalTiles: 64 * 64 };
const terrain = createDefaultTerrainRecipe("medium");

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

const runMap = async (debug) => {
  const state = createInitialState(seed, grid);
  await generateMap(state, new RNG(seed), undefined, terrain, debug);
  return {
    state,
    hash: hashArrays(
      state.tileElevation,
      state.tileTypeId,
      state.tileRiverMask,
      state.tileLakeMask,
      state.tileRoadEdges,
      state.tileRoadBridge
    )
  };
};

const baseline = await runMap(undefined);
const events = [];
const diagnostic = await runMap({
  onPhase: () => {},
  onDiagnosticEvent: (event) => {
    events.push(event);
  }
});

if (baseline.hash !== diagnostic.hash) {
  throw new Error(`Diagnostics changed generated map hash: ${baseline.hash} !== ${diagnostic.hash}`);
}

const hydrologyCandidates = events.filter((event) => event.kind === "hydrology:candidate").length;
const hydrologyResolved = events.filter((event) => event.kind === "hydrology:lake" || event.kind === "hydrology:reject").length;
const roadAttempts = events.filter((event) => event.kind === "road:attempt").length;
const roadResults = events.filter((event) => event.kind === "road:result").length;
const roadCarves = events.filter((event) => event.kind === "road:carve").length;

if (hydrologyCandidates <= 0 || hydrologyResolved <= 0) {
  throw new Error(`Expected hydrology diagnostics, got candidates=${hydrologyCandidates} resolved=${hydrologyResolved}`);
}
if (roadAttempts <= 0 || roadResults <= 0) {
  throw new Error(`Expected road diagnostics, got attempts=${roadAttempts} results=${roadResults}`);
}
if (roadCarves <= 0) {
  throw new Error(`Expected committed road diagnostics, got carves=${roadCarves}`);
}

let cancelSeen = false;
try {
  await runMap({
    onPhase: () => {},
    onDiagnosticEvent: () => {},
    shouldCancel: () => true
  });
} catch (error) {
  cancelSeen = isMapGenCancelledError(error);
}
if (!cancelSeen) {
  throw new Error("Expected typed mapgen cancellation error.");
}

console.log(
  `[mapgen-diagnostics] hash=${baseline.hash} hydrology=${hydrologyCandidates}/${hydrologyResolved} roads=${roadResults}/${roadAttempts} carves=${roadCarves} cancel=ok`
);
