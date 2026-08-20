import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as THREE from "three";

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
const { buildSeasonalSkyState } = await import(
  distImport(["systems", "climate", "rendering", "seasonalSkyState.js"])
);
const { sampleSeasonalCloudProfile } = await import(
  distImport(["systems", "climate", "rendering", "seasonalCloudProfile.js"])
);
const { sampleClimateWindDirection } = await import(
  distImport(["systems", "climate", "sim", "climateWindDirection.js"])
);
const { sampleSeasonalCloudAdvection } = await import(
  distImport(["systems", "climate", "rendering", "seasonalCloudAdvection.js"])
);
const {
  SEASONAL_CLOUD_NOISE,
  SEASONAL_CLOUD_NOISE_CHANNELS,
  sampleSeasonalCloudDensity,
  sampleSeasonalCloudWeather
} = await import(distImport(["systems", "climate", "rendering", "seasonalCloudField.js"]));
const {
  SEASONAL_CLOUD_VOLUME,
  SEASONAL_CLOUD_VOLUME_ATLAS_BORDER,
  SEASONAL_CLOUD_VOLUME_ATLAS_COLUMNS,
  SEASONAL_CLOUD_VOLUME_ATLAS_HEIGHT,
  SEASONAL_CLOUD_VOLUME_ATLAS_STRIDE,
  SEASONAL_CLOUD_VOLUME_ATLAS_WIDTH,
  SEASONAL_CLOUD_VOLUME_CHANNELS,
  sampleSeasonalCloudVolume
} = await import(distImport(["systems", "climate", "rendering", "seasonalCloudVolume.js"]));
const { seasonalSkyFragmentShader } = await import(
  distImport(["systems", "climate", "rendering", "seasonalCloudShader.js"])
);
const { resolveOceanSurfaceContext } = await import(
  distImport(["render", "water", "ocean", "oceanSurfaceContext.js"])
);
const { SeasonalCloudRenderClock } = await import(
  distImport(["systems", "climate", "controllers", "seasonalCloudRenderClock.js"])
);
const seasonalCloudFieldSource = await readFile(
  path.join(repoRoot, "src", "systems", "climate", "rendering", "seasonalCloudField.ts"),
  "utf8"
);
const seasonalSkyDomeSource = await readFile(
  path.join(repoRoot, "src", "systems", "climate", "rendering", "seasonalSkyDome.ts"),
  "utf8"
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
const skyRepeat = buildSeasonalSkyState({
  ...baseInput,
  risk01: 0.35
});
assert.equal(skySlow.cloudTimeDays, skyFast.cloudTimeDays, "time speed alone must not move the cloud clock");
assert.equal(skySlow.cloudNearOffset.x, skyFast.cloudNearOffset.x, "time speed alone must not change near cloud X drift");
assert.equal(skySlow.cloudNearOffset.y, skyFast.cloudNearOffset.y, "time speed alone must not change near cloud Y drift");
assert.equal(skySlow.cloudFarOffset.x, skyFast.cloudFarOffset.x, "time speed alone must not change far cloud X drift");
assert.equal(skySlow.cloudFarOffset.y, skyFast.cloudFarOffset.y, "time speed alone must not change far cloud Y drift");
assert.equal(skySlow.sunOcclusion01, skyRepeat.sunOcclusion01, "same climate input must reproduce sun occlusion");
assert.ok(
  skySlow.sunOcclusion01 >= 0 && skySlow.sunOcclusion01 <= 1,
  "sun occlusion must remain normalized"
);
const clearAutumnSky = buildSeasonalSkyState({
  ...baseInput,
  risk01: 0.35,
  rainIntensity01: 0
});
assert.ok(
  skySlow.cloudCoverage > clearAutumnSky.cloudCoverage,
  "the rain front should increase overall cloud coverage even when the sun lies in a local break"
);

assert.equal(
  SEASONAL_CLOUD_NOISE.data.length,
  SEASONAL_CLOUD_NOISE.size * SEASONAL_CLOUD_NOISE.size * SEASONAL_CLOUD_NOISE_CHANNELS,
  "packed cloud noise must expose every RGBA texel"
);
const weatherProbe = sampleSeasonalCloudWeather(0.27, 0.61, 0);
assert.equal(
  weatherProbe,
  sampleSeasonalCloudWeather(0.27, 0.61, 0),
  "cellular weather footprints must be deterministic"
);
assert.ok(
  Math.abs(weatherProbe - sampleSeasonalCloudWeather(1.27, 0.61, 0)) < 1e-12,
  "the generated weather field must tile without a horizontal seam"
);
const springFootprintThreshold = 0.78;
const footprintRegionOccupancy = [];
let occupiedFootprintSamples = 0;
for (let regionY = 0; regionY < 4; regionY += 1) {
  for (let regionX = 0; regionX < 4; regionX += 1) {
    let regionOccupied = 0;
    for (let localY = 0; localY < 32; localY += 1) {
      for (let localX = 0; localX < 32; localX += 1) {
        const weatherU = (regionX * 32 + localX + 0.5) / SEASONAL_CLOUD_NOISE.size;
        const weatherV = (regionY * 32 + localY + 0.5) / SEASONAL_CLOUD_NOISE.size;
        if (sampleSeasonalCloudWeather(weatherU, weatherV, 0) > springFootprintThreshold) {
          regionOccupied += 1;
        }
      }
    }
    footprintRegionOccupancy.push(regionOccupied / (32 * 32));
    occupiedFootprintSamples += regionOccupied;
  }
}
const footprintOccupancy = occupiedFootprintSamples / (SEASONAL_CLOUD_NOISE.size ** 2);
assert.ok(
  footprintOccupancy > 0.08 && footprintOccupancy < 0.3,
  "fair-weather footprints must remain substantial without speckling the whole sky"
);
assert.ok(
  Math.max(...footprintRegionOccupancy) - Math.min(...footprintRegionOccupancy) > 0.3 &&
    footprintRegionOccupancy.filter((occupancy) => occupancy < 0.03).length >= 2,
  "low-frequency weather systems must create clustered cloud regions and broad clear gaps"
);
const footprintMask = new Uint8Array(SEASONAL_CLOUD_NOISE.size ** 2);
for (let index = 0; index < footprintMask.length; index += 1) {
  footprintMask[index] =
    (SEASONAL_CLOUD_NOISE.data[index * SEASONAL_CLOUD_NOISE_CHANNELS] ?? 0) / 255 > 0.76
      ? 1
      : 0;
}
const visitedFootprint = new Uint8Array(footprintMask.length);
const footprintAreas = [];
for (let start = 0; start < footprintMask.length; start += 1) {
  if (footprintMask[start] === 0 || visitedFootprint[start] !== 0) {
    continue;
  }
  const pending = [start];
  visitedFootprint[start] = 1;
  let area = 0;
  while (pending.length > 0) {
    const index = pending.pop();
    const x = index % SEASONAL_CLOUD_NOISE.size;
    const y = Math.floor(index / SEASONAL_CLOUD_NOISE.size);
    area += 1;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nextX = x + dx;
      const nextY = y + dy;
      if (
        nextX < 0 || nextX >= SEASONAL_CLOUD_NOISE.size ||
        nextY < 0 || nextY >= SEASONAL_CLOUD_NOISE.size
      ) {
        continue;
      }
      const next = nextY * SEASONAL_CLOUD_NOISE.size + nextX;
      if (footprintMask[next] !== 0 && visitedFootprint[next] === 0) {
        visitedFootprint[next] = 1;
        pending.push(next);
      }
    }
  }
  footprintAreas.push(area);
}
footprintAreas.sort((a, b) => a - b);
assert.ok(
  footprintAreas.length >= 5 &&
    footprintAreas.length <= 16 &&
    footprintAreas.at(-1) > footprintAreas[0] * 8,
  "fair-weather footprint islands must vary materially in size instead of repeating one cell scale"
);
assert.match(
  seasonalCloudFieldSource,
  /sampleTileableWorley\(warpedU, warpedV, 4, 0\.17\)[\s\S]*weatherSystem[\s\S]*clusterStrength/,
  "cloud placement must combine fewer cellular seeds with a broad weather-system envelope"
);
assert.equal(
  SEASONAL_CLOUD_VOLUME.data.length,
  SEASONAL_CLOUD_VOLUME.size ** 3 * SEASONAL_CLOUD_VOLUME_CHANNELS,
  "the deterministic cloud volume must expose every packed voxel"
);
assert.equal(
  SEASONAL_CLOUD_VOLUME.atlasData.length,
  SEASONAL_CLOUD_VOLUME_ATLAS_WIDTH *
    SEASONAL_CLOUD_VOLUME_ATLAS_HEIGHT *
    SEASONAL_CLOUD_VOLUME_CHANNELS,
  "the GPU cloud atlas must contain every padded volume slice"
);
assert.equal(
  SEASONAL_CLOUD_VOLUME_ATLAS_BORDER,
  1,
  "one periodic texel must pad each atlas slice for bilinear filtering"
);
const readAtlasChannel = (x, y, channel) =>
  SEASONAL_CLOUD_VOLUME.atlasData[
    (y * SEASONAL_CLOUD_VOLUME_ATLAS_WIDTH + x) * SEASONAL_CLOUD_VOLUME_CHANNELS + channel
  ];
for (let z = 0; z < SEASONAL_CLOUD_VOLUME.size; z += 1) {
  const tileX = z % SEASONAL_CLOUD_VOLUME_ATLAS_COLUMNS;
  const tileY = Math.floor(z / SEASONAL_CLOUD_VOLUME_ATLAS_COLUMNS);
  const tileOriginX = tileX * SEASONAL_CLOUD_VOLUME_ATLAS_STRIDE;
  const tileOriginY = tileY * SEASONAL_CLOUD_VOLUME_ATLAS_STRIDE;
  for (let channel = 0; channel < SEASONAL_CLOUD_VOLUME_CHANNELS; channel += 1) {
    assert.equal(
      readAtlasChannel(tileOriginX, tileOriginY + 1, channel),
      readAtlasChannel(tileOriginX + SEASONAL_CLOUD_VOLUME.size, tileOriginY + 1, channel),
      `slice ${z} left atlas border must repeat its rightmost voxel`
    );
    assert.equal(
      readAtlasChannel(tileOriginX + 1, tileOriginY, channel),
      readAtlasChannel(tileOriginX + 1, tileOriginY + SEASONAL_CLOUD_VOLUME.size, channel),
      `slice ${z} top atlas border must repeat its bottom voxel`
    );
  }
}
assert.match(
  seasonalSkyDomeSource,
  /texture\.wrapS = THREE\.ClampToEdgeWrapping;[\s\S]*texture\.wrapT = THREE\.ClampToEdgeWrapping;[\s\S]*texture\.magFilter = THREE\.LinearFilter;[\s\S]*texture\.minFilter = THREE\.LinearFilter;[\s\S]*texture\.generateMipmaps = false;/,
  "the packed cloud atlas must use clamped non-mipmapped bilinear filtering"
);
assert.match(
  seasonalSkyFragmentShader,
  /sampleCloudVolume\(vec3 position\)[\s\S]*slice0[\s\S]*slice1[\s\S]*mix\(lowSlice, highSlice, sliceMix\)/,
  "the shader must interpolate adjacent volume slices explicitly"
);
assert.doesNotMatch(
  seasonalSkyFragmentShader,
  /height01 \* 1\.08\s*\+\s*rotatedHorizontal\.(?:x|y)/,
  "horizontal travel must not shear the GPU volume Y coordinate"
);
assert.doesNotMatch(
  seasonalCloudFieldSource,
  /height01 \* 1\.08\s*\+\s*rotated[XYZ] \* scale/,
  "horizontal travel must not shear the CPU volume Y coordinate"
);
assert.doesNotMatch(
  seasonalSkyFragmentShader,
  /mix\(uCloudNearScale, uCloudFarScale|mix\(uCloudNearOffset, uCloudFarOffset|height01 \* 0\.17|height01 \* 0\.13/,
  "one cloud body must not bend horizontal sampling coordinates through height"
);
assert.match(
  seasonalSkyFragmentShader,
  /float scale = uCloudNearScale;[\s\S]*vec2 offset = uCloudNearOffset;/,
  "weather and volume sampling must share one coherent horizontal transform"
);
assert.doesNotMatch(
  seasonalCloudFieldSource,
  /lerp\(cloudState\.cloudNearScale, cloudState\.cloudFarScale|lerp\(cloudState\.cloudNearOffset|height01 \* 0\.17|height01 \* 0\.13/,
  "CPU cloud sampling must mirror the coherent horizontal transform"
);
assert.match(
  seasonalSkyFragmentShader,
  /vec3 volumePosition = vec3\([\s\S]*rotatedHorizontal\.x \* scale \* volumeFrequency[\s\S]*height01 \* 1\.08 \+[\s\S]*rotatedHorizontal\.y \* scale \* volumeFrequency/,
  "horizontal X/Z travel and cloud height must retain separate primary volume axes"
);
assert.match(
  seasonalSkyFragmentShader,
  /if \(dir\.y <= 0\.012\)[\s\S]*float rayY = dir\.y;[\s\S]*float rayStart = cloudBase \/ rayY/,
  "accepted horizon rays must intersect the cloud slab at their true elevation"
);
assert.doesNotMatch(
  seasonalSkyFragmentShader,
  /max\(0\.035, dir\.y\)|mix\(0\.32, 0\.68, rayJitter\(\)\)/,
  "horizon rays must not reuse a clamped elevation or a narrow shared sample phase"
);
assert.match(
  seasonalSkyFragmentShader,
  /float rayJitter\(\)[\s\S]*floor\(gl_FragCoord\.xy\)[\s\S]*float jitter = rayJitter\(\);/,
  "the full march-step interval must use stable per-pixel stratification"
);
assert.doesNotMatch(
  seasonalSkyFragmentShader.match(/float rayJitter\(\)[\s\S]*?\n  \}/)?.[0] ?? "",
  /uCloudTimeDays|frame|random|sin\(|dot\(dir/i,
  "ray jitter must remain independent of animation time, frame state, and continuous sky-direction contours"
);
assert.match(
  seasonalCloudFieldSource,
  /const rayStart = cloudBase \/ dirY;[\s\S]*cloudTop \/ dirY/,
  "CPU sun-occlusion rays must mirror the true-elevation slab intersection"
);
const volumeProbe = sampleSeasonalCloudVolume(0.27, 0.43, 0.61, 0);
assert.equal(
  volumeProbe,
  sampleSeasonalCloudVolume(0.27, 0.43, 0.61, 0),
  "true 3D cloud noise must be deterministic"
);
assert.ok(
  Math.abs(volumeProbe - sampleSeasonalCloudVolume(0.27, 0.43, 0.78, 0)) > 0.01,
  "cloud noise must vary through the volume Z axis"
);
assert.ok(
  Math.abs(volumeProbe - sampleSeasonalCloudVolume(1.27, 0.43, 0.61, 0)) < 1e-12,
  "the generated cloud volume must tile without a horizontal seam"
);
const cloudField = {
  cloudCoverage: skySlow.cloudCoverage,
  cloudSoftness01: skySlow.cloudSoftness01,
  cloudDensity01: skySlow.cloudDensity01,
  cloudNearScale: skySlow.cloudNearScale,
  cloudFarScale: skySlow.cloudFarScale,
  cloudNearOffset: skySlow.cloudNearOffset,
  cloudFarOffset: skySlow.cloudFarOffset,
  stormIntensity01: skySlow.stormIntensity01,
  cloudTimeDays: skySlow.cloudTimeDays,
  cloudProfile: skySlow.cloudProfile
};
const cloudProbeDirection = new THREE.Vector3(0.38, 0.72, -0.41).normalize();
const cloudProbeA = sampleSeasonalCloudDensity(cloudProbeDirection, cloudField);
const cloudProbeB = sampleSeasonalCloudDensity(cloudProbeDirection, cloudField);
assert.equal(cloudProbeA, cloudProbeB, "CPU cloud density probes must be deterministic");
assert.ok(cloudProbeA >= 0 && cloudProbeA <= 1, "CPU cloud density must remain normalized");
const distortedFarLayerCloudField = {
  ...cloudField,
  cloudFarScale: cloudField.cloudFarScale * 0.1,
  cloudFarOffset: cloudField.cloudFarOffset.clone().add(new THREE.Vector2(19, -23))
};
for (const direction of [
  cloudProbeDirection,
  new THREE.Vector3(-0.61, 0.48, 0.37).normalize(),
  new THREE.Vector3(0.22, 0.31, 0.79).normalize()
]) {
  assert.equal(
    sampleSeasonalCloudDensity(direction, cloudField),
    sampleSeasonalCloudDensity(direction, distortedFarLayerCloudField),
    "legacy far-layer inputs must not bend a single volumetric cloud through height"
  );
}
const evolvedCloudField = {
  ...cloudField,
  cloudTimeDays: cloudField.cloudTimeDays + 5
};
const evolutionProbeDirections = [];
for (const elevation of [0.25, 0.5, 0.75]) {
  const horizontal = Math.sqrt(1 - elevation * elevation);
  for (let index = 0; index < 16; index += 1) {
    const azimuth = (index / 16) * Math.PI * 2;
    evolutionProbeDirections.push(
      new THREE.Vector3(
        Math.cos(azimuth) * horizontal,
        elevation,
        Math.sin(azimuth) * horizontal
      )
    );
  }
}
const evolutionDelta = evolutionProbeDirections.reduce(
  (total, direction) =>
    total +
    Math.abs(
      sampleSeasonalCloudDensity(direction, cloudField) -
        sampleSeasonalCloudDensity(direction, evolvedCloudField)
    ),
  0
);
assert.ok(
  evolutionDelta > 1e-5,
  "simulation weather time must evolve cloud density even when wind offsets are held fixed"
);

const summerSkyVolume = buildSeasonalSkyState({
  ...baseInput,
  careerDay: 190,
  seasonT01: 190 / 360,
  risk01: 0.35,
  rainIntensity01: 0
});
const springSkyVolume = buildSeasonalSkyState({
  ...baseInput,
  careerDay: 116,
  seasonT01: 116 / 360,
  risk01: 0.35,
  rainIntensity01: 0
});
const winterSkyVolume = buildSeasonalSkyState({
  ...baseInput,
  careerDay: 24,
  seasonT01: 24 / 360,
  risk01: 0.35,
  rainIntensity01: 0
});
const autumnSkyVolume = buildSeasonalSkyState({
  ...baseInput,
  careerDay: 286,
  seasonT01: 286 / 360,
  risk01: 0.35,
  rainIntensity01: 0
});
assert.ok(
  summerSkyVolume.cloudProfile.cumulus01 > springSkyVolume.cloudProfile.cumulus01 &&
    springSkyVolume.cloudProfile.cumulus01 > autumnSkyVolume.cloudProfile.cumulus01 &&
    autumnSkyVolume.cloudProfile.cumulus01 > winterSkyVolume.cloudProfile.cumulus01,
  "seasonal profiles must progress from tall fair cumulus to winter stratocumulus"
);
assert.ok(
  winterSkyVolume.cloudProfile.topHeight - winterSkyVolume.cloudProfile.baseHeight >
    autumnSkyVolume.cloudProfile.topHeight - autumnSkyVolume.cloudProfile.baseHeight,
  "winter clouds must occupy a deeper layer than autumn clouds"
);
assert.ok(
  winterSkyVolume.cloudProfile.baseHeight < autumnSkyVolume.cloudProfile.baseHeight,
  "winter clouds must form below the autumn layer"
);
assert.ok(
  skySlow.cloudCoverage >= 0.75 && skySlow.cloudCoverage <= 0.92,
  "active rain must form a nearly connected but bounded storm front"
);
assert.ok(
  skySlow.cloudProfile.shadowStrength > winterSkyVolume.cloudProfile.shadowStrength,
  "active storms must self-shadow more strongly than fair winter clouds"
);
const springCloudField = {
  cloudCoverage: springSkyVolume.cloudCoverage,
  cloudSoftness01: springSkyVolume.cloudSoftness01,
  cloudDensity01: springSkyVolume.cloudDensity01,
  cloudNearScale: springSkyVolume.cloudNearScale,
  cloudFarScale: springSkyVolume.cloudFarScale,
  cloudNearOffset: springSkyVolume.cloudNearOffset,
  cloudFarOffset: springSkyVolume.cloudFarOffset,
  stormIntensity01: springSkyVolume.stormIntensity01,
  cloudTimeDays: springSkyVolume.cloudTimeDays,
  cloudProfile: springSkyVolume.cloudProfile
};
const summerCloudField = {
  cloudCoverage: summerSkyVolume.cloudCoverage,
  cloudSoftness01: summerSkyVolume.cloudSoftness01,
  cloudDensity01: summerSkyVolume.cloudDensity01,
  cloudNearScale: summerSkyVolume.cloudNearScale,
  cloudFarScale: summerSkyVolume.cloudFarScale,
  cloudNearOffset: summerSkyVolume.cloudNearOffset,
  cloudFarOffset: summerSkyVolume.cloudFarOffset,
  stormIntensity01: summerSkyVolume.stormIntensity01,
  cloudTimeDays: summerSkyVolume.cloudTimeDays,
  cloudProfile: summerSkyVolume.cloudProfile
};
const springVolumeSamples = [];
const summerVolumeSamples = [];
const stormVolumeSamples = [];
for (const elevation of [0.22, 0.42, 0.62, 0.82]) {
  const horizontal = Math.sqrt(1 - elevation * elevation);
  for (let index = 0; index < 32; index += 1) {
    const azimuth = (index / 32) * Math.PI * 2;
    const direction = new THREE.Vector3(
      Math.cos(azimuth) * horizontal,
      elevation,
      Math.sin(azimuth) * horizontal
    );
    springVolumeSamples.push(sampleSeasonalCloudDensity(direction, springCloudField));
    summerVolumeSamples.push(sampleSeasonalCloudDensity(direction, summerCloudField));
    stormVolumeSamples.push(sampleSeasonalCloudDensity(direction, cloudField));
  }
}
const average = (values) => values.reduce((total, value) => total + value, 0) / values.length;
assert.ok(
  Math.max(...summerVolumeSamples) > 0.35,
  "sparse summer clouds must still form locally opaque volumetric bodies"
);
assert.ok(
  summerVolumeSamples.filter((value) => value > 0.1).length < summerVolumeSamples.length * 0.65,
  "summer cloud bodies must remain separated by substantial clear sky"
);
assert.ok(
  springVolumeSamples.filter((value) => value > 0.1).length < springVolumeSamples.length * 0.35,
  "spring must leave broad gaps between its larger cloud bodies"
);
assert.ok(
  Math.max(...springVolumeSamples) > 0.65,
  "reduced spring coverage must retain locally dense fluffy clouds"
);
assert.ok(
  springVolumeSamples.filter((value) => value > 0.1).length >
    summerVolumeSamples.filter((value) => value > 0.1).length,
  "spring should retain more cloud bodies than summer"
);
assert.ok(
  average(stormVolumeSamples) > average(summerVolumeSamples),
  "the rain front must occupy more of the sampled sky volume than fair summer clouds"
);
const summerElevationAverages = [0, 1, 2, 3].map((index) =>
  average(summerVolumeSamples.slice(index * 32, (index + 1) * 32))
);
assert.ok(
  Math.max(...summerElevationAverages) - Math.min(...summerElevationAverages) > 0.025,
  "fair cumulus density must vary materially with elevation instead of forming aligned bands"
);

const skyLater = buildSeasonalSkyState({
  ...baseInput,
  careerDay: baseInput.careerDay + 0.25,
  risk01: 0.35
});
assert.notEqual(skySlow.cloudNearOffset.x, skyLater.cloudNearOffset.x, "career time must advance cloud drift");
assert.notEqual(skySlow.cloudFarOffset.y, skyLater.cloudFarOffset.y, "career time must advance both cloud layers");
assert.ok(
  skySlow.cloudNearOffset.distanceTo(skyLater.cloudNearOffset) < 0.02,
  "a small simulation-time step must move the cloud field continuously"
);
assert.ok(
  skySlow.cloudNearOffset.distanceTo(skyLater.cloudNearOffset) > 0.004,
  "normal-speed simulation time must produce readable cloud travel"
);
const windDirectionAtProbe = sampleClimateWindDirection(
  baseInput.worldSeed,
  (baseInput.careerDay % 360) + 1,
  Math.floor(baseInput.careerDay / 360)
);
const visibleCloudTravel = skySlow.cloudNearOffset.clone().sub(skyLater.cloudNearOffset).normalize();
assert.ok(
  visibleCloudTravel.dot(new THREE.Vector2(windDirectionAtProbe.dx, windDirectionAtProbe.dy)) > 0.98,
  "normal-speed cloud travel must visibly follow the authoritative gameplay wind direction"
);
const earlyCloudAdvection = sampleSeasonalCloudAdvection({
  careerDay: 90,
  weatherSeed: baseInput.worldSeed,
  worldSeed: baseInput.worldSeed,
  driftPerDay: 0.032
});
const lateCloudAdvection = sampleSeasonalCloudAdvection({
  careerDay: 810,
  weatherSeed: baseInput.worldSeed,
  worldSeed: baseInput.worldSeed,
  driftPerDay: 0.032
});
const earlyLayerSeparation = new THREE.Vector2(
  earlyCloudAdvection.farX - earlyCloudAdvection.nearX,
  earlyCloudAdvection.farY - earlyCloudAdvection.nearY
);
const lateLayerSeparation = new THREE.Vector2(
  lateCloudAdvection.farX - lateCloudAdvection.nearX,
  lateCloudAdvection.farY - lateCloudAdvection.nearY
);
assert.ok(
  earlyLayerSeparation.distanceTo(lateLayerSeparation) < 1e-12,
  "cloud-height parallax must remain bounded instead of accumulating into wind-aligned streaks"
);
assert.ok(
  Math.abs(
    (lateCloudAdvection.nearX - earlyCloudAdvection.nearX) -
      (lateCloudAdvection.farX - earlyCloudAdvection.farX)
  ) < 1e-12 &&
    Math.abs(
      (lateCloudAdvection.nearY - earlyCloudAdvection.nearY) -
        (lateCloudAdvection.farY - earlyCloudAdvection.farY)
    ) < 1e-12,
  "the full cloud volume must share one coherent deterministic translation"
);

const snapshotCloudMotion = (state) => ({ ...state });
const renderClock = new SeasonalCloudRenderClock();
const clockStart = snapshotCloudMotion(renderClock.sample(
  baseInput.careerDay,
  1,
  skySlow.weatherSeed,
  baseInput.worldSeed
));
const clockStepStart = snapshotCloudMotion(renderClock.sample(
  baseInput.careerDay + 0.25,
  0,
  skySlow.weatherSeed,
  baseInput.worldSeed
));
assert.deepEqual(clockStepStart, clockStart, "a new fixed simulation step must begin at the previous rendered cloud state");
const clockMidpoint = snapshotCloudMotion(renderClock.sample(
  baseInput.careerDay + 0.25,
  0.5,
  skySlow.weatherSeed,
  baseInput.worldSeed
));
assert.ok(
  clockMidpoint.morphTimeDays > clockStart.morphTimeDays,
  "render interpolation must advance the cloud morph clock between fixed simulation ticks"
);
const clockAfterAlphaReset = snapshotCloudMotion(renderClock.sample(
  baseInput.careerDay + 0.25,
  0,
  skySlow.weatherSeed,
  baseInput.worldSeed
));
assert.deepEqual(
  clockAfterAlphaReset,
  clockMidpoint,
  "an alpha reset without a new simulation sample must not move cloud rendering backward"
);
const clockEnd = snapshotCloudMotion(renderClock.sample(
  baseInput.careerDay + 0.25,
  1,
  skySlow.weatherSeed,
  baseInput.worldSeed
));
assert.ok(
  Math.abs(clockEnd.morphTimeDays - clockStart.morphTimeDays - 0.25) < 1e-9,
  "the interpolated cloud clock must end exactly on the authoritative career day"
);
const interpolatedTravel = new THREE.Vector2(
  clockStart.nearX - clockMidpoint.nearX,
  clockStart.nearY - clockMidpoint.nearY
).normalize();
assert.ok(
  interpolatedTravel.dot(new THREE.Vector2(windDirectionAtProbe.dx, windDirectionAtProbe.dy)) > 0.98,
  "interpolated cloud travel must retain the authoritative downwind direction"
);
const pausedClock = snapshotCloudMotion(renderClock.sample(
  baseInput.careerDay + 0.25,
  1,
  skySlow.weatherSeed,
  baseInput.worldSeed
));
assert.deepEqual(pausedClock, clockEnd, "an unchanged paused career clock must hold cloud motion exactly");
const acceleratedMidpoint = snapshotCloudMotion(renderClock.sample(
  baseInput.careerDay + 5.25,
  0.5,
  skySlow.weatherSeed,
  baseInput.worldSeed
));
assert.ok(
  acceleratedMidpoint.morphTimeDays > clockEnd.morphTimeDays &&
    acceleratedMidpoint.morphTimeDays < clockEnd.morphTimeDays + 5,
  "accelerated simulation gaps must interpolate instead of teleporting the cloud clock"
);
const backwardDay = 12.5;
const backwardSnap = snapshotCloudMotion(renderClock.sample(
  backwardDay,
  0.4,
  skySlow.weatherSeed,
  baseInput.worldSeed
));
const backwardReference = snapshotCloudMotion(new SeasonalCloudRenderClock().sample(
  backwardDay,
  1,
  skySlow.weatherSeed,
  baseInput.worldSeed
));
assert.deepEqual(backwardSnap, backwardReference, "backward career-time changes must snap instead of interpolating stale motion");
const alternateRenderSeed = baseInput.worldSeed + 1;
const seedSnap = snapshotCloudMotion(renderClock.sample(
  backwardDay,
  0.4,
  skySlow.weatherSeed,
  alternateRenderSeed
));
const seedReference = snapshotCloudMotion(new SeasonalCloudRenderClock().sample(
  backwardDay,
  1,
  skySlow.weatherSeed,
  alternateRenderSeed
));
assert.deepEqual(seedSnap, seedReference, "world changes must snap the interpolated cloud clock to the new deterministic track");

const eastwardSky = buildSeasonalSkyState({
  ...baseInput,
  risk01: 0.35,
  windDx: 1,
  windDy: 0
});
const westwardSky = buildSeasonalSkyState({
  ...baseInput,
  risk01: 0.35,
  windDx: -1,
  windDy: 0
});
assert.equal(
  eastwardSky.cloudNearOffset.x,
  westwardSky.cloudNearOffset.x,
  "changing instantaneous wind must not reproject the accumulated cloud X position"
);
assert.equal(
  eastwardSky.cloudNearOffset.y,
  westwardSky.cloudNearOffset.y,
  "changing instantaneous wind must not reproject the accumulated cloud Y position"
);

const alternateSeedSky = buildSeasonalSkyState({
  ...baseInput,
  risk01: 0.35,
  rainSeed: baseInput.rainSeed + 1
});
assert.notEqual(alternateSeedSky.weatherSeed, skySlow.weatherSeed, "sky state must retain the varied weather seed");
assert.equal(
  alternateSeedSky.cloudNearOffset.x,
  skySlow.cloudNearOffset.x,
  "rain-event seed changes must not teleport the underlying cloud field"
);
assert.equal(
  alternateSeedSky.cloudTimeDays,
  skySlow.cloudTimeDays,
  "rain-event seed changes must not jump the internal cloud morph phase"
);
const alternateWorldSky = buildSeasonalSkyState({
  ...baseInput,
  risk01: 0.35,
  worldSeed: baseInput.worldSeed + 1
});
assert.notEqual(
  alternateWorldSky.cloudNearOffset.x,
  skySlow.cloudNearOffset.x,
  "world seed must vary the deterministic cloud track"
);

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
assert.ok(
  luminance(autumn.cloudShadowColor) > luminance(winter.cloudShadowColor),
  "autumn cloud shadows must remain visibly lighter than winter cloud shadows"
);
assert.ok(winter.cloudCoverage01 < 0.7, "default winter cloud cover should be heavy but not fully overcast");
assert.ok(summer.cloudCoverage01 < 0.06, "clear summer sky should retain broad gaps between clouds");
assert.ok(spring.cloudCoverage01 < 0.24, "fair spring sky should remain open between larger clouds");
assert.ok(
  summer.cloudDensity01 > 0.3,
  "the few surviving summer clouds should retain locally substantial density"
);
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
  const profileBefore = sampleSeasonalCloudProfile({
    seasonT01: edge - 0.002,
    stormIntensity01: 0
  });
  const profileAfter = sampleSeasonalCloudProfile({
    seasonT01: edge + 0.002,
    stormIntensity01: 0
  });
  assert.ok(
    Math.abs(profileBefore.baseHeight - profileAfter.baseHeight) < 0.08 &&
      Math.abs(profileBefore.topHeight - profileAfter.topHeight) < 0.08 &&
      Math.abs(profileBefore.cumulus01 - profileAfter.cumulus01) < 0.08,
    `cloud morphology should transition smoothly around season edge ${edge}`
  );
}

console.log("Weather visual regression passed.");
