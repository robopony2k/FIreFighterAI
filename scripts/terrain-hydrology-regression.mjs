import assert from "node:assert/strict";

import { buildDepressionLakeField } from "../dist/systems/terrain/sim/depressionLakeField.js";
import { buildFlowAccumulationRiverNetwork } from "../dist/systems/terrain/sim/flowAccumulationRiverNetwork.js";

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
assert.equal(dry.riverMask.reduce((sum, value) => sum + value, 0), 0);
assert.ok(wet.riverMask.reduce((sum, value) => sum + value, 0) > 0);
for (let index = 0; index < cols; index += 1) {
  if (wet.riverMask[index] === 0) continue;
  assert.ok(Math.abs((wet.riverSurface[index] ?? 0) - elevations[index]) <= 0.00023);
  assert.ok((wet.riverSurface[index] ?? 0) - (wet.riverBed[index] ?? 0) <= 0.002);
}

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
assert.equal(lakes.lakes.length, 1);
assert.equal(lakes.lakes[0].tiles.length, 3);

console.log("Simple terrain hydrology smoke passed.");
