import assert from "node:assert/strict";

import {
  assignFireAudioEmitterSlots,
  computeFireDistanceGain,
  computeFireAudioIntensity,
  computeTerrainOcclusion01,
  computeWindLoudnessGain,
  selectPrioritizedFireAudioClusters
} from "../dist/render/threeTestWorldAudioMath.js";

const approxEqual = (actual, expected, epsilon = 1e-6) => {
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `Expected ${actual} to be within ${epsilon} of ${expected}`
  );
};

const intensity = computeFireAudioIntensity(0.8, 0.5);
approxEqual(intensity, 0.4);
approxEqual(computeFireAudioIntensity(1.2, 0.9), 1);

const closeFireGain = computeFireDistanceGain(0, 4, 68);
const nearFireGain = computeFireDistanceGain(4, 4, 68);
const farFireGain = computeFireDistanceGain(24, 4, 68);
assert.ok(closeFireGain > nearFireGain, "Point-blank fire should sound louder than merely nearby fire.");
assert.ok(nearFireGain > farFireGain, "Nearby fire should sound louder than distant fire.");

const prioritized = selectPrioritizedFireAudioClusters(
  [
    { id: 1, x: 4, z: 0, tileCount: 8, intensity01: 0.45 },
    { id: 2, x: 18, z: 0, tileCount: 14, intensity01: 0.9 },
    { id: 3, x: 12, z: 0, tileCount: 2, intensity01: 0.25 }
  ],
  0,
  0,
  40,
  2
);
assert.deepEqual(
  prioritized.map((entry) => entry.id),
  [1, 2],
  "Priority should favor the balanced nearby cluster before trimming to max emitters."
);

const assignments = assignFireAudioEmitterSlots(
  [
    { slotIndex: 0, x: 0, z: 0, tileCount: 12 },
    { slotIndex: 1, x: 24, z: 0, tileCount: 6 }
  ],
  [
    { id: 20, x: 23, z: 1, tileCount: 7, intensity01: 0.6 },
    { id: 10, x: 1, z: -1, tileCount: 11, intensity01: 0.7 }
  ],
  2,
  12
);
assert.deepEqual(
  assignments.map((entry) => entry?.id ?? null),
  [10, 20],
  "Emitter continuity should keep clusters matched to the closest prior slot even when input order changes."
);

const downwindGain = computeWindLoudnessGain({ x: -1, z: 0 }, { x: 1, z: 0 }, 1);
const upwindGain = computeWindLoudnessGain({ x: 1, z: 0 }, { x: 1, z: 0 }, 1);
assert.ok(downwindGain > upwindGain, "Downwind camera positions should sound louder than upwind ones.");

const occluded = computeTerrainOcclusion01(
  [
    { terrainY: 3, lineY: 1 },
    { terrainY: 2, lineY: 1.25 },
    { terrainY: 0.5, lineY: 1.5 }
  ],
  1
);
const clear = computeTerrainOcclusion01(
  [
    { terrainY: 0.25, lineY: 1 },
    { terrainY: 0.5, lineY: 1.2 }
  ],
  1
);
assert.ok(occluded > 0.5, "Terrain above the sight line should register strong occlusion.");
approxEqual(clear, 0);

console.log("[world-audio:regression] Passed.");
