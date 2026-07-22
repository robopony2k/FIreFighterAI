import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { MAP_SIZE_PRESETS } from "../dist/core/config.js";
import { RNG } from "../dist/core/rng.js";
import { createInitialState, TILE_TYPE_IDS } from "../dist/core/state.js";
import { generateMap } from "../dist/mapgen/index.js";
import { computeWaterLevel } from "../dist/render/threeTestTerrain.js";
import { decodeTerrainSeedCode } from "../dist/ui/terrainSeedCode.js";

const SHARE_CODE = "MAP6-115-22002R2S1W1M152B0R1G1W2R2C1X1N1J141K0Y1M1A1E181Q0K1K12161C";
const STAMPED_PROFILE = [0.024, 0.01, -0.003, -0.006];
const PROFILE_EPSILON = 0.0002;
const PROBES = [
  { name: "E1", x: 237, y: 127, dx: 1, dy: 0 },
  { name: "S2", x: 127, y: 232, dx: 0, dy: 1 },
  { name: "W3", x: 17, y: 127, dx: -1, dy: 0 },
  { name: "N4", x: 127, y: 45, dx: 0, dy: -1 }
];

const decoded = decodeTerrainSeedCode(SHARE_CODE);
assert.ok(decoded, "shoreline authority share code must decode");
const size = MAP_SIZE_PRESETS[decoded.mapSize];
assert.ok(size, `shoreline authority map size '${decoded.mapSize}' must exist`);

const grid = { cols: size, rows: size, totalTiles: size * size };
const state = createInitialState(decoded.seed, grid);
const snapshots = new Map();
const timings = new Map();
const events = [];
const startedAt = performance.now();

await generateMap(state, new RNG(decoded.seed), undefined, decoded.terrain, {
  stopAfterPhase: "hydro:rivers",
  onPhase: (snapshot) => snapshots.set(snapshot.phase, snapshot),
  onStageTiming: (timing) => timings.set(timing.phase, timing.durationMs),
  onDiagnosticEvent: (event) => events.push(event)
});

const water = snapshots.get("hydro:solve");
const coast = snapshots.get("terrain:shoreline");
const rivers = snapshots.get("hydro:rivers");
assert.ok(water && coast && rivers, "Water, Coast metadata, and Rivers snapshots must be emitted");

assert.deepEqual(coast.seaLevel, water.seaLevel, "Coast metadata must preserve Water sea level");
assert.deepEqual(coast.oceanMask, water.oceanMask, "Coast metadata must preserve Water ocean membership");
assert.deepEqual(coast.elevations, water.elevations, "Coast metadata must preserve Water elevations");
assert.deepEqual(rivers.seaLevel, water.seaLevel, "Rivers must preserve Water sea level");
assert.deepEqual(rivers.oceanMask, water.oceanMask, "Rivers must preserve Water ocean membership");

const renderedOceanLevel = computeWaterLevel(
  {
    cols: grid.cols,
    rows: grid.rows,
    elevations: water.elevations,
    tileTypes: water.tileTypes,
    oceanMask: water.oceanMask,
    riverMask: water.riverMask,
    seaLevel: water.seaLevel
  },
  TILE_TYPE_IDS.water,
  water.oceanMask,
  water.riverMask
);
assert.ok(renderedOceanLevel !== null, "Water snapshot must resolve an ocean render level");
assert.ok(
  Math.abs(renderedOceanLevel - water.seaLevel[0]) <= Number.EPSILON,
  "the rendered ocean level must equal Water's authoritative sea level"
);

for (let i = 0; i < grid.totalTiles; i += 1) {
  const coastIsOcean = (coast.oceanMask?.[i] ?? 0) > 0;
  assert.equal(
    coast.tileTypes[i] === TILE_TYPE_IDS.water,
    coastIsOcean,
    `Coast tile ${i} water type must match the authoritative ocean mask`
  );
  if (coastIsOcean && !(water.riverMask?.[i] ?? 0)) {
    assert.ok(
      water.elevations[i] < renderedOceanLevel,
      `Water ocean floor ${i} must remain below the rendered ocean surface`
    );
  }

  if (rivers.tileTypes[i] !== TILE_TYPE_IDS.water) {
    continue;
  }
  const claimedByWaterNetwork =
    (rivers.oceanMask?.[i] ?? 0) > 0 ||
    (rivers.riverMask?.[i] ?? 0) > 0 ||
    (rivers.lakeMask?.[i] ?? 0) > 0;
  assert.ok(claimedByWaterNetwork, `Rivers tile ${i} cannot become water outside the static water network`);
}

const oceanOverflowEvents = events.filter(
  (event) => event.kind === "hydrology:overflow" && event.reachedOcean && event.terminalReached
);
assert.ok(oceanOverflowEvents.length > 0, "deterministic shoreline case must include an ocean-bound lake overflow");
for (const event of oceanOverflowEvents) {
  assert.ok(event.tiles.length > 0, `lake ${event.lakeId} ocean-bound overflow must expose a visible river path`);
  const terminalRiverIndex = event.tiles[event.tiles.length - 1];
  const x = terminalRiverIndex % grid.cols;
  const y = Math.floor(terminalRiverIndex / grid.cols);
  const neighbors = [
    x > 0 ? terminalRiverIndex - 1 : -1,
    x < grid.cols - 1 ? terminalRiverIndex + 1 : -1,
    y > 0 ? terminalRiverIndex - grid.cols : -1,
    y < grid.rows - 1 ? terminalRiverIndex + grid.cols : -1
  ];
  assert.ok(
    neighbors.some((idx) => idx >= 0 && (water.oceanMask?.[idx] ?? 0) > 0),
    `lake ${event.lakeId} ocean-bound overflow must terminate against the Water-stage ocean mask`
  );
}

for (const probe of PROBES) {
  const profile = [-1, 0, 1, 2].map((offset) => {
    const x = probe.x + probe.dx * offset;
    const y = probe.y + probe.dy * offset;
    const idx = y * grid.cols + x;
    return (coast.elevations[idx] ?? 0) - (coast.seaLevel?.[idx] ?? 0);
  });
  const matchesStampedProfile = profile.every(
    (value, index) => Math.abs(value - STAMPED_PROFILE[index]) <= PROFILE_EPSILON
  );
  assert.equal(matchesStampedProfile, false, `${probe.name} must retain its generated coast profile instead of the fixed ramp`);
}

const coastDurationMs = timings.get("terrain:shoreline") ?? Number.POSITIVE_INFINITY;
const comparisonDurationMs = Math.max(timings.get("hydro:solve") ?? 0, timings.get("hydro:rivers") ?? 0, 1);
assert.ok(
  coastDurationMs <= comparisonDurationMs * 2,
  `Coast metadata stage must not dominate Water/Rivers (${coastDurationMs.toFixed(2)}ms vs ${comparisonDurationMs.toFixed(2)}ms)`
);

console.log(JSON.stringify({
  shareCode: SHARE_CODE,
  seed: decoded.seed,
  size: decoded.mapSize,
  totalMs: Math.round(performance.now() - startedAt),
  stageMs: {
    water: Number((timings.get("hydro:solve") ?? 0).toFixed(2)),
    coastMetadata: Number(coastDurationMs.toFixed(2)),
    rivers: Number((timings.get("hydro:rivers") ?? 0).toFixed(2))
  },
  oceanOverflowRoutes: oceanOverflowEvents.length
}, null, 2));
