import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const distImport = (segments) => pathToFileURL(path.join(repoRoot, "dist", ...segments)).href;

const { sampleSeasonalWeatherVisualState } = await import(
  distImport(["systems", "climate", "rendering", "seasonalWeatherVisualState.js"])
);
const { sampleSeasonalAtmosphereVisualState } = await import(
  distImport(["systems", "climate", "rendering", "seasonalAtmosphereVisualState.js"])
);
const { buildSeasonalSkyState } = await import(distImport(["render", "seasonalSky.js"]));
const { resolveOceanSurfaceContext } = await import(
  distImport(["render", "water", "ocean", "oceanSurfaceContext.js"])
);

const baseInput = {
  careerDay: 286.5,
  seasonT01: 286.5 / 360,
  rainIntensity01: 0.8,
  rainSeed: 12345,
  worldSeed: 2026,
  windDx: 0.74,
  windDy: -0.31,
  windStrength: 0.68
};

const visualA = sampleSeasonalWeatherVisualState(baseInput);
const visualB = sampleSeasonalWeatherVisualState(baseInput);
assert.deepEqual(visualA, visualB, "same career day and seed should produce stable weather visual time");

const visualLater = sampleSeasonalWeatherVisualState({
  ...baseInput,
  careerDay: baseInput.careerDay + 0.25
});
assert.notEqual(visualA.cloudTimeDays, visualLater.cloudTimeDays, "cloud phase should advance with career day");
assert.notEqual(visualA.rainTimeSeconds, visualLater.rainTimeSeconds, "rain phase should advance with career day");

const visualDifferentRainSeed = sampleSeasonalWeatherVisualState({
  ...baseInput,
  rainSeed: baseInput.rainSeed + 1
});
assert.notEqual(visualA.weatherSeed, visualDifferentRainSeed.weatherSeed, "rain event seed should vary weather noise seed");
assert.notEqual(visualA.rainTimeSeconds, visualDifferentRainSeed.rainTimeSeconds, "rain event seed should vary rain phase");

const calmOcean = resolveOceanSurfaceContext({ windDx: 0, windDy: 0, windStrength01: 0, rainIntensity01: 0 });
const windyOcean = resolveOceanSurfaceContext({ windDx: 3, windDy: 4, windStrength01: 0.75, rainIntensity01: 0 });
const rainyOcean = resolveOceanSurfaceContext({ windDx: 3, windDy: 4, windStrength01: 0.75, rainIntensity01: 0.8 });
assert.ok(Math.abs(Math.hypot(calmOcean.windDirX, calmOcean.windDirY) - 1) < 1e-12, "calm ocean fallback wind must be normalized");
assert.ok(Math.abs(windyOcean.windDirX - 0.6) < 1e-12 && Math.abs(windyOcean.windDirY - 0.8) < 1e-12, "ocean wind direction must be normalized");
assert.ok(windyOcean.waveEnergy01 > calmOcean.waveEnergy01, "wind must increase ocean wave energy");
assert.ok(windyOcean.foamEnergy01 > calmOcean.foamEnergy01, "wind must increase ocean foam energy");
assert.ok(windyOcean.shallowClarity01 < calmOcean.shallowClarity01, "wind must reduce shallow clarity");
assert.ok(rainyOcean.waveEnergy01 > windyOcean.waveEnergy01, "active rain must increase wave energy");
assert.ok(rainyOcean.foamEnergy01 > windyOcean.foamEnergy01, "active rain must increase foam energy");
assert.ok(rainyOcean.shallowClarity01 < windyOcean.shallowClarity01, "active rain must reduce shallow clarity");
assert.deepEqual(
  resolveOceanSurfaceContext({ windDx: 0.2, windDy: -0.8, windStrength01: 0.4, rainIntensity01: 0, seasonT01: 0.1 }),
  resolveOceanSurfaceContext({ windDx: 0.2, windDy: -0.8, windStrength01: 0.4, rainIntensity01: 0, seasonT01: 0.8 }),
  "season alone must not change ocean wave context"
);

const skySlow = buildSeasonalSkyState({
  ...baseInput,
  risk01: 0.35,
  timeSpeedValue: 1
});
const skyFast = buildSeasonalSkyState({
  ...baseInput,
  risk01: 0.35,
  timeSpeedValue: 20
});
assert.equal(skySlow.cloudTimeDays, skyFast.cloudTimeDays, "time speed alone must not move the cloud clock");
assert.equal(skySlow.cloudNearOffset.x, skyFast.cloudNearOffset.x, "time speed alone must not change near cloud X drift");
assert.equal(skySlow.cloudNearOffset.y, skyFast.cloudNearOffset.y, "time speed alone must not change near cloud Y drift");
assert.equal(skySlow.cloudFarOffset.x, skyFast.cloudFarOffset.x, "time speed alone must not change far cloud X drift");
assert.equal(skySlow.cloudFarOffset.y, skyFast.cloudFarOffset.y, "time speed alone must not change far cloud Y drift");

assert.ok(visualA.stormIntensity01 > visualA.wetSeason01 * 0.3, "active rain should lift storm intensity");
assert.ok(skySlow.stormIntensity01 > 0.5, "rainy autumn sky should report a stormy state");

const luminance = (color) => color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
const blueBias = (color) => color.b - (color.r + color.g) * 0.5;
const colorDistance = (a, b) => Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b);
const fairAtmosphere = (seasonT01) =>
  sampleSeasonalAtmosphereVisualState({
    seasonT01,
    risk01: 0.42,
    rainIntensity01: 0,
    wetSeason01: sampleSeasonalWeatherVisualState({ careerDay: seasonT01 * 360, seasonT01 }).wetSeason01,
    stormIntensity01: sampleSeasonalWeatherVisualState({ careerDay: seasonT01 * 360, seasonT01 }).stormIntensity01
  });

const winter = fairAtmosphere(24 / 360);
const spring = fairAtmosphere(116 / 360);
const summer = fairAtmosphere(190 / 360);
const autumn = fairAtmosphere(286 / 360);
const storm = sampleSeasonalAtmosphereVisualState({
  seasonT01: 286 / 360,
  risk01: 0.22,
  rainIntensity01: 1,
  wetSeason01: 0.32,
  stormIntensity01: 0.95
});
const summerHighRisk = sampleSeasonalAtmosphereVisualState({
  seasonT01: 190 / 360,
  risk01: 1,
  rainIntensity01: 0,
  wetSeason01: 0,
  stormIntensity01: 0
});
const summerLowRisk = sampleSeasonalAtmosphereVisualState({
  seasonT01: 190 / 360,
  risk01: 0,
  rainIntensity01: 0,
  wetSeason01: 0,
  stormIntensity01: 0
});
const rainDominant = sampleSeasonalAtmosphereVisualState({
  seasonT01: 286 / 360,
  rainIntensity01: 0.82,
  stormIntensity01: 0.15
});
const stormDominant = sampleSeasonalAtmosphereVisualState({
  seasonT01: 286 / 360,
  rainIntensity01: 0.24,
  stormIntensity01: 0.68
});
const forcedClearOcean = sampleSeasonalAtmosphereVisualState({
  seasonT01: 190 / 360,
  wetSeason01: 0,
  stormIntensity01: 0,
  rainIntensity01: 0
});
const forcedCloudyOcean = sampleSeasonalAtmosphereVisualState({
  seasonT01: 190 / 360,
  wetSeason01: 0,
  stormIntensity01: 0.72,
  rainIntensity01: 0
});

assert.ok(summer.cloudCoverage01 < spring.cloudCoverage01, "summer should be less cloudy than spring");
assert.ok(spring.cloudCoverage01 < autumn.cloudCoverage01, "spring should be less cloudy than autumn");
assert.ok(autumn.cloudCoverage01 < winter.cloudCoverage01, "autumn should be less cloudy than winter");
assert.ok(winter.cloudCoverage01 < 0.7, "default winter cloud cover should be heavy but not fully overcast");
assert.ok(summer.cloudDensity01 < 0.18, "clear summer sky should have low baseline cloud density");
assert.equal(summerHighRisk.cloudCoverage01, summerLowRisk.cloudCoverage01, "fire risk must not alter cloud coverage");
assert.ok(storm.cloudCoverage01 > autumn.cloudCoverage01, "rain should clearly increase autumn cloud coverage");
assert.ok(storm.stormMood01 > autumn.stormMood01 + 0.4, "rain should clearly lift storm mood");
assert.equal(rainDominant.stormMood01, 0.82, "storm mood should use rain as the maximum driver");
assert.equal(stormDominant.stormMood01, 0.68, "storm mood should use storm intensity as the maximum driver");
assert.ok(blueBias(summer.skyTopColor) > blueBias(winter.skyTopColor), "summer sky should be bluer than winter");
assert.ok(luminance(summer.oceanShallowColor) > luminance(storm.oceanShallowColor), "storm ocean should be darker than summer ocean");
assert.ok(blueBias(summer.oceanShallowColor) > blueBias(storm.oceanShallowColor), "storm ocean should be less saturated blue than summer ocean");
assert.ok(
  luminance(forcedClearOcean.oceanShallowColor) > luminance(forcedCloudyOcean.oceanShallowColor),
  "ocean should darken as actual cloud cover increases"
);

for (const edge of [0.18, 0.28, 0.42, 0.52, 0.62, 0.7, 0.88, 0.96]) {
  const before = fairAtmosphere(edge - 0.002);
  const after = fairAtmosphere(edge + 0.002);
  assert.ok(
    Math.abs(before.cloudCoverage01 - after.cloudCoverage01) < 0.08,
    `cloud coverage should transition smoothly around season edge ${edge}`
  );
  assert.ok(
    colorDistance(before.skyTopColor, after.skyTopColor) < 34,
    `sky color should transition smoothly around season edge ${edge}`
  );
  assert.ok(
    colorDistance(before.oceanShallowColor, after.oceanShallowColor) < 34,
    `ocean color should transition smoothly around season edge ${edge}`
  );
}

console.log("Weather visual regression passed.");
