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
const { DEFAULT_ROAD_DIAGNOSTIC_TUNING } = await import(distImport(["systems", "roads", "types", "roadDiagnosticTuning.js"]));

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
const defaultTunedEvents = [];
const defaultTunedDiagnostic = await runMap({
  onPhase: () => {},
  roadTuning: DEFAULT_ROAD_DIAGNOSTIC_TUNING,
  onDiagnosticEvent: (event) => {
    defaultTunedEvents.push(event);
  }
});
const constrainedRoadEvents = [];
await runMap({
  onPhase: () => {},
  roadTuning: {
    ...DEFAULT_ROAD_DIAGNOSTIC_TUNING,
    enableSwitchbackConnectors: false,
    enableMountainPassFallbacks: false,
    enableBridgeFirstRetries: false,
    maxGradeRelaxationPasses: 1
  },
  onDiagnosticEvent: (event) => {
    constrainedRoadEvents.push(event);
  }
});
const isolatedIntertownEvents = [];
await runMap({
  onPhase: () => {},
  roadTuning: {
    ...DEFAULT_ROAD_DIAGNOSTIC_TUNING,
    settlementPreGrowthYearsOverride: 0,
    futureGrowthPlanYearsOverride: 0,
    enableConnectivityRepairPass: false,
    intertownConnectionPasses: 1,
    intertownEdgeLimit: 1
  },
  onDiagnosticEvent: (event) => {
    isolatedIntertownEvents.push(event);
  }
});

if (baseline.hash !== diagnostic.hash) {
  throw new Error(`Diagnostics changed generated map hash: ${baseline.hash} !== ${diagnostic.hash}`);
}
if (baseline.hash !== defaultTunedDiagnostic.hash) {
  throw new Error(`Default road tuning changed generated map hash: ${baseline.hash} !== ${defaultTunedDiagnostic.hash}`);
}

const hydrologyCandidates = events.filter((event) => event.kind === "hydrology:candidate").length;
const hydrologyResolved = events.filter((event) => event.kind === "hydrology:lake" || event.kind === "hydrology:reject").length;
const roadAttempts = events.filter((event) => event.kind === "road:attempt").length;
const roadResults = events.filter((event) => event.kind === "road:result").length;
const roadCarves = events.filter((event) => event.kind === "road:carve").length;
const roadPlanned = events.filter((event) => event.kind === "road:planned").length;
const roadCompleted = events.filter((event) => event.kind === "road:completed").length;
const intratownSummaries = events.filter((event) => event.kind === "road:intratown-summary").length;

if (hydrologyCandidates <= 0 || hydrologyResolved <= 0) {
  throw new Error(`Expected hydrology diagnostics, got candidates=${hydrologyCandidates} resolved=${hydrologyResolved}`);
}
if (roadAttempts <= 0 || roadResults <= 0) {
  throw new Error(`Expected road diagnostics, got attempts=${roadAttempts} results=${roadResults}`);
}
if (roadCarves <= 0) {
  throw new Error(`Expected committed road diagnostics, got carves=${roadCarves}`);
}
if (roadPlanned <= 0 || roadCompleted <= 0) {
  throw new Error(`Expected grouped road diagnostics, got planned=${roadPlanned} completed=${roadCompleted}`);
}
if (intratownSummaries <= 0) {
  throw new Error(`Expected intratown road summaries, got ${intratownSummaries}.`);
}
if (defaultTunedEvents.filter((event) => event.kind === "road:attempt").length <= 0) {
  throw new Error("Expected default tuned diagnostics to emit road attempts.");
}
const constrainedRoadAttempts = constrainedRoadEvents.filter((event) => event.kind === "road:attempt");
if (constrainedRoadAttempts.length <= 0) {
  throw new Error("Expected constrained road tuning diagnostics to emit road attempts.");
}
const constrainedBridgeAttempts = constrainedRoadAttempts.filter((event) => event.allowBridge);
const constrainedFallbackModes = constrainedRoadAttempts.filter((event) => event.mode === "switchback" || event.mode === "mountainPass");
if (constrainedBridgeAttempts.length > 0 || constrainedFallbackModes.length > 0) {
  throw new Error(
    `Expected constrained road tuning to suppress bridge/switchback/mountain attempts, got bridge=${constrainedBridgeAttempts.length} fallback=${constrainedFallbackModes.length}`
  );
}
const defaultUnknownRoadResults = defaultTunedEvents.filter((event) => event.kind === "road:result" && event.routeGroup === "unknown");
if (defaultUnknownRoadResults.length > 0) {
  throw new Error(`Expected no unknown road result route groups under default diagnostics, got ${defaultUnknownRoadResults.length}.`);
}
const isolatedRoadAttempts = isolatedIntertownEvents.filter((event) => event.kind === "road:attempt");
const isolatedRoadResults = isolatedIntertownEvents.filter((event) => event.kind === "road:result");
const isolatedFutureGrowthAttempts = isolatedRoadAttempts.filter((event) => event.routeGroup === "futureGrowthPrecompute");
const isolatedRepairAttempts = isolatedRoadAttempts.filter((event) => event.routeGroup === "connectivityRepair");
const isolatedUnknownResults = isolatedRoadResults.filter((event) => event.routeGroup === "unknown");
if (isolatedRoadAttempts.length <= 0) {
  throw new Error("Expected isolated intertown diagnostics to emit road attempts.");
}
if (isolatedFutureGrowthAttempts.length > 0) {
  throw new Error(`Expected future growth years override 0 to suppress future growth road attempts, got ${isolatedFutureGrowthAttempts.length}.`);
}
if (isolatedRepairAttempts.length > 0) {
  throw new Error(`Expected repair-pass-off diagnostics to suppress connectivity repair attempts, got ${isolatedRepairAttempts.length}.`);
}
if (isolatedUnknownResults.length > 0) {
  throw new Error(`Expected no unknown road result route groups in isolated diagnostics, got ${isolatedUnknownResults.length}.`);
}
const visibleRoadCarves = isolatedIntertownEvents.filter(
  (event) => event.kind === "road:carve" && event.routeGroup !== "futureGrowthPrecompute"
);
const hiddenFutureGrowthCarves = isolatedIntertownEvents.filter(
  (event) => event.kind === "road:carve" && event.routeGroup === "futureGrowthPrecompute"
);
if (hiddenFutureGrowthCarves.length > 0) {
  throw new Error(`Expected headline-visible committed road count to exclude future growth precompute carves, got hidden=${hiddenFutureGrowthCarves.length} visible=${visibleRoadCarves.length}.`);
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
  `[mapgen-diagnostics] hash=${baseline.hash} hydrology=${hydrologyCandidates}/${hydrologyResolved} roads=${roadResults}/${roadAttempts} planned=${roadPlanned} completed=${roadCompleted} intratown=${intratownSummaries} carves=${roadCarves} cancel=ok`
);
