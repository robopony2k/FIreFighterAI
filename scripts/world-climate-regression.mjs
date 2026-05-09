import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distImport = (segments) => pathToFileURL(path.join(repoRoot, "dist", ...segments)).href;

const { generateWorldClimateSeed } = await import(
  distImport(["systems", "climate", "sim", "worldClimateSeed.js"])
);
const { buildWindDrivenMoistureMap } = await import(
  distImport(["systems", "terrain", "sim", "windDrivenMoisture.js"])
);
const { applyFuel } = await import(distImport(["core", "tiles.js"]));
const { RNG } = await import(distImport(["core", "rng.js"]));

const createTile = (type, elevation) => ({
  type,
  fuel: 0,
  fire: 0,
  isBase: false,
  elevation,
  heat: 0,
  ignitionPoint: 0,
  burnRate: 0,
  heatOutput: 0,
  spreadBoost: 0,
  heatTransferCap: 0,
  heatRetention: 1,
  windFactor: 0,
  moisture: 0,
  waterDist: 0,
  vegetationAgeYears: 0,
  canopy: 0,
  canopyCover: 0,
  stemDensity: 0,
  dominantTreeType: null,
  treeType: null,
  houseValue: 0,
  houseResidents: 0,
  houseDestroyed: false,
  ashAge: 0
});

const hashFloatArray = (array) => {
  let hash = 2166136261;
  for (let i = 0; i < array.length; i += 1) {
    const quantized = Math.floor((array[i] ?? 0) * 1_000_000);
    hash ^= quantized & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (quantized >>> 8) & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (quantized >>> 16) & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (quantized >>> 24) & 0xff;
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

const buildRidgeCase = () => {
  const cols = 24;
  const rows = 12;
  const tiles = new Array(cols * rows);
  const distToWater = new Uint16Array(cols * rows);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const ridge = x === 9 ? 0.82 : x === 10 ? 0.68 : 0.32;
      tiles[idx] = createTile(x === 0 ? "water" : "grass", ridge);
      distToWater[idx] = x;
    }
  }
  return { cols, rows, tiles, distToWater };
};

const meanBand = (field, cols, rows, x) => {
  let sum = 0;
  let count = 0;
  for (let y = 3; y < rows - 3; y += 1) {
    sum += field[y * cols + x] ?? 0;
    count += 1;
  }
  return sum / Math.max(1, count);
};

const seedA = generateWorldClimateSeed(1337);
const seedB = generateWorldClimateSeed(1337);
assert.deepEqual(seedA, seedB, "same seed should produce identical world climate seed");

const angles = [1337, 1338, 9001, 42].map((seed) =>
  Number(generateWorldClimateSeed(seed).prevailingWindAngleRad.toFixed(6))
);
assert.ok(new Set(angles).size > 1, "different seeds should vary prevailing wind direction");

const ridgeCase = buildRidgeCase();
const climate = {
  prevailingWindAngleRad: 0,
  prevailingWindStrength: 0.78,
  prevailingWindVariability: 0.22,
  rainfallBias: 0,
  aridityBias: 0
};
const moistureA = await buildWindDrivenMoistureMap({
  seed: 2026,
  ...ridgeCase,
  maxWaterDistance: 40,
  climate
});
const moistureB = await buildWindDrivenMoistureMap({
  seed: 2026,
  ...buildRidgeCase(),
  maxWaterDistance: 40,
  climate
});

assert.equal(hashFloatArray(moistureA), hashFloatArray(moistureB), "same seed should produce same moisture field");
assert.ok(
  meanBand(moistureA, ridgeCase.cols, ridgeCase.rows, 8) > meanBand(moistureA, ridgeCase.cols, ridgeCase.rows, 13),
  "windward ridge side should be wetter than leeward side"
);

for (let i = 0; i < moistureA.length; i += 1) {
  assert.ok(moistureA[i] >= 0 && moistureA[i] <= 1, `moisture out of range at ${i}: ${moistureA[i]}`);
}
for (let y = 0; y < ridgeCase.rows; y += 1) {
  const idx = y * ridgeCase.cols;
  assert.equal(moistureA[idx], 1, `water tile moisture should remain 1 at ${idx}`);
  const tile = ridgeCase.tiles[idx];
  tile.moisture = moistureA[idx];
  applyFuel(tile, tile.moisture, new RNG(2026));
  assert.equal(tile.fuel, 0, `water tile should remain non-fueled at ${idx}`);
}

console.log(
  JSON.stringify(
    {
      seed: 1337,
      climateSeed: seedA,
      moistureHash: hashFloatArray(moistureA),
      windwardMean: Number(meanBand(moistureA, ridgeCase.cols, ridgeCase.rows, 8).toFixed(4)),
      leewardMean: Number(meanBand(moistureA, ridgeCase.cols, ridgeCase.rows, 13).toFixed(4))
    },
    null,
    2
  )
);
