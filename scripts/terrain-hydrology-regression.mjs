import assert from "node:assert/strict";

import { buildDepressionLakeField } from "../dist/systems/terrain/sim/depressionLakeField.js";
import { buildAnchoredDrainageChannelNetwork } from "../dist/systems/terrain/sim/anchoredDrainageChannelNetwork.js";
import { buildFlowAccumulationRiverNetwork } from "../dist/systems/terrain/sim/flowAccumulationRiverNetwork.js";
import {
  RIVER_CHANNEL_CLASS,
  RIVER_CHANNEL_MAX_WIDTH_CELLS,
  buildRiverChannelHierarchy
} from "../dist/mapgen/riverChannelHierarchy.js";

const hierarchyThresholds = { tributary: 0.2, stream: 0.5, river: 0.8 };
const hierarchyMask = new Uint8Array([1, 1, 1, 1, 1, 1, 0]);
const hierarchyStrength = [0.1, 0.2, 0.49, 0.5, 0.8, 1, 0.9];
const hierarchy = buildRiverChannelHierarchy(hierarchyMask, hierarchyStrength, hierarchyThresholds);
assert.deepEqual(
  Array.from(hierarchy.channelClass),
  [
    RIVER_CHANNEL_CLASS.none,
    RIVER_CHANNEL_CLASS.ephemeralCreek,
    RIVER_CHANNEL_CLASS.ephemeralCreek,
    RIVER_CHANNEL_CLASS.stream,
    RIVER_CHANNEL_CLASS.river,
    RIVER_CHANNEL_CLASS.river,
    RIVER_CHANNEL_CLASS.none
  ],
  "channel classes follow accumulation thresholds only on accepted flow nodes"
);
assert.equal(hierarchy.channelWidth[0], 0);
assert.equal(hierarchy.channelWidth[6], 0, "non-channel drainage never receives visual width");
for (let index = 2; index <= 5; index += 1) {
  assert.ok(hierarchy.channelWidth[index] >= hierarchy.channelWidth[index - 1], "channel width never narrows downstream");
}
assert.ok(Math.abs(hierarchy.channelWidth[5] - RIVER_CHANNEL_MAX_WIDTH_CELLS) < 1e-6);
const hierarchyRepeat = buildRiverChannelHierarchy(hierarchyMask, hierarchyStrength, hierarchyThresholds);
assert.deepEqual(hierarchyRepeat.channelClass, hierarchy.channelClass, "channel classes are deterministic");
assert.deepEqual(hierarchyRepeat.channelWidth, hierarchy.channelWidth, "channel widths are deterministic");

const anchoredReceiver = new Int32Array([1, 2, 6, 4, 5, 6, 10, 8, 9, -1, -1, 12, 6, -1]);
const anchoredFlow = new Float32Array([
  0.42, 0.5, 0.58, 0.41, 0.49, 0.57, 0.82, 0.43, 0.52, 1, 1, 0.45, 0.55, 0
]);
const anchoredOcean = new Uint8Array(anchoredReceiver.length);
anchoredOcean[9] = 1;
anchoredOcean[10] = 1;
const anchoredInput = {
  receiver: anchoredReceiver,
  flowAccumulation: anchoredFlow,
  oceanMask: anchoredOcean,
  tributaryThreshold: 0.4,
  trunkThreshold: 0.7,
  minimumTerminalBranchCells: 3
};
const anchored = buildAnchoredDrainageChannelNetwork(anchoredInput);
assert.deepEqual(
  Array.from(anchored.channelNodeMask),
  [1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0],
  "three-cell Y branches converge into a trunk while coastal drains and short terminal twigs are rejected"
);
for (const index of [0, 1, 2, 3, 4, 5]) {
  let cursor = index;
  const seen = new Set();
  while (cursor >= 0 && anchored.channelNodeMask[cursor] > 0) {
    assert.ok(!seen.has(cursor), "accepted downstream links are loop-free");
    seen.add(cursor);
    cursor = anchored.channelDownstream[cursor];
  }
  assert.equal(cursor, 10, "every retained tributary reaches the established coastal trunk mouth");
}
const anchoredRepeat = buildAnchoredDrainageChannelNetwork(anchoredInput);
assert.deepEqual(anchoredRepeat.channelNodeMask, anchored.channelNodeMask, "anchored selection is deterministic");
assert.deepEqual(anchoredRepeat.channelDownstream, anchored.channelDownstream, "downstream publication is deterministic");

const cols = 12;
const elevations = Float32Array.from({ length: cols }, (_, index) => 0.48 - index * 0.018);
const oceanMask = new Uint8Array(cols);
oceanMask[cols - 1] = 1;
const receiver = new Int32Array(cols).fill(-1);
const accumulation = new Float32Array(cols);
for (let index = 0; index < cols - 1; index += 1) {
  receiver[index] = index + 1;
  accumulation[index] = (index + 1) / cols;
}

const buildRivers = (intensity) => buildFlowAccumulationRiverNetwork({
  cols,
  rows: 1,
  elevations,
  oceanMask,
  seaLevelMap: new Float32Array(cols).fill(0.2),
  receiver,
  flowAccumulation: accumulation,
  riverIntensity: intensity,
  riverBudget: intensity,
  minLakeDepth: 0.003
});

const dry = buildRivers(0);
const wet = buildRivers(1);
const authoritativeBeforeHierarchy = {
  elevations: Float32Array.from(elevations),
  receiver: Int32Array.from(receiver),
  riverMask: Uint8Array.from(wet.riverMask),
  riverSurface: Float32Array.from(wet.riverSurface),
  riverBed: Float32Array.from(wet.riverBed),
  channelStrength: Float32Array.from(wet.channelStrength)
};
buildRiverChannelHierarchy(
  wet.channelNodeMask,
  accumulation,
  { tributary: wet.tributaryThreshold, stream: wet.streamThreshold, river: wet.riverThreshold }
);
assert.deepEqual(elevations, authoritativeBeforeHierarchy.elevations, "hierarchy leaves elevation unchanged");
assert.deepEqual(receiver, authoritativeBeforeHierarchy.receiver, "hierarchy leaves drainage routing unchanged");
assert.deepEqual(wet.riverMask, authoritativeBeforeHierarchy.riverMask, "hierarchy leaves the river mask unchanged");
assert.deepEqual(wet.riverSurface, authoritativeBeforeHierarchy.riverSurface, "hierarchy leaves river surfaces unchanged");
assert.deepEqual(wet.riverBed, authoritativeBeforeHierarchy.riverBed, "hierarchy leaves river beds unchanged");
assert.deepEqual(
  wet.channelStrength,
  authoritativeBeforeHierarchy.channelStrength,
  "hierarchy leaves accumulation-derived channel strength unchanged"
);
assert.equal(dry.riverMask.reduce((sum, value) => sum + value, 0), 0);
assert.ok(wet.riverMask.reduce((sum, value) => sum + value, 0) > 0);
for (let index = 0; index < cols; index += 1) {
  if (wet.riverMask[index] === 0) continue;
  assert.ok(Math.abs((wet.riverSurface[index] ?? 0) - elevations[index]) <= 0.00023);
  assert.ok((wet.riverSurface[index] ?? 0) - (wet.riverBed[index] ?? 0) <= 0.002);
}

const diagonalRivers = buildFlowAccumulationRiverNetwork({
  cols: 2,
  rows: 2,
  elevations: new Float32Array([0.5, 0.48, 0.47, 0.45]),
  oceanMask: new Uint8Array(4),
  seaLevelMap: new Float32Array(4).fill(0.2),
  receiver: new Int32Array([3, -1, -1, -1]),
  flowAccumulation: new Float32Array([1, 0, 0, 0]),
  riverIntensity: 1,
  riverBudget: 1,
  minLakeDepth: 0.003
});
const connectorIndex = diagonalRivers.riverMask[1] > 0 ? 1 : 2;
assert.equal(diagonalRivers.riverMask[connectorIndex], 1, "diagonal drainage receives an orthogonal connector");
assert.equal(
  diagonalRivers.channelStrength[connectorIndex],
  diagonalRivers.channelStrength[0],
  "diagonal connector inherits the source channel strength"
);
assert.equal(
  diagonalRivers.channelNodeMask[connectorIndex],
  0,
  "orthogonal raster connectors remain gameplay water but are excluded from direct flow ribbons"
);

const lakeDepth = new Float32Array(25);
const lakeFill = new Float32Array(25).fill(0.4);
const lakeElevation = new Float32Array(25).fill(0.4);
for (const index of [11, 12, 13]) {
  lakeDepth[index] = 0.004;
  lakeElevation[index] = 0.396;
}
const lakes = buildDepressionLakeField({
  cols: 5,
  rows: 5,
  elevations: lakeElevation,
  filledElevation: lakeFill,
  depressionDepth: lakeDepth,
  flowAccumulation: new Float32Array(25).fill(0.5),
  oceanMask: new Uint8Array(25),
  riverIntensity: 1,
  basinStrength: 1,
  minLakeDepth: 0.003,
  minLakeAreaTiles: 1,
  maxLakeAreaTiles: 20,
  maxLakeCount: 2
});
const lakeMaskBeforeHierarchy = Uint16Array.from(lakes.lakeMask);
const lakeSurfaceBeforeHierarchy = Float32Array.from(lakes.lakeSurface);
buildRiverChannelHierarchy(
  wet.channelNodeMask,
  accumulation,
  { tributary: wet.tributaryThreshold, stream: wet.streamThreshold, river: wet.riverThreshold }
);
assert.deepEqual(lakes.lakeMask, lakeMaskBeforeHierarchy, "hierarchy leaves lake footprints unchanged");
assert.deepEqual(lakes.lakeSurface, lakeSurfaceBeforeHierarchy, "hierarchy leaves lake surfaces unchanged");
assert.equal(lakes.lakes.length, 1);
assert.equal(lakes.lakes[0].tiles.length, 3);

console.log("Simple terrain hydrology smoke passed.");
