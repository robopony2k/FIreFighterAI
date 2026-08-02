import { SEASONAL_CLOUD_MARCH_STEPS } from "./seasonalCloudField.js";
import {
  SEASONAL_CLOUD_VOLUME_ATLAS_BORDER,
  SEASONAL_CLOUD_VOLUME_ATLAS_COLUMNS,
  SEASONAL_CLOUD_VOLUME_ATLAS_HEIGHT,
  SEASONAL_CLOUD_VOLUME_ATLAS_STRIDE,
  SEASONAL_CLOUD_VOLUME_ATLAS_WIDTH,
  SEASONAL_CLOUD_VOLUME_SIZE
} from "./seasonalCloudVolume.js";

export const seasonalSkyVertexShader = `
  varying vec3 vSkyDir;

  void main() {
    vSkyDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const seasonalSkyFragmentShader = `
  uniform sampler2D uCloudNoiseTex;
  uniform sampler2D uCloudVolumeTex;
  uniform vec3 uSkyTopColor;
  uniform vec3 uSkyHorizonColor;
  uniform vec3 uSunColor;
  uniform vec3 uCloudNearColor;
  uniform vec3 uCloudFarColor;
  uniform vec3 uSunDirection;
  uniform vec2 uCloudNearOffset;
  uniform vec2 uCloudFarOffset;
  uniform float uCloudNearScale;
  uniform float uCloudFarScale;
  uniform float uCloudCoverage;
  uniform float uOvercastStrength;
  uniform float uSunVisibility;
  uniform float uHazeStrength;
  uniform float uCloudTimeDays;
  uniform float uCloudSoftness;
  uniform float uCloudDensity;
  uniform float uCloudBaseHeight;
  uniform float uCloudTopHeight;
  uniform float uCloudCumulus;
  uniform float uCloudFootprintScale;
  uniform float uCloudVolumeScale;
  uniform float uCloudErosion;
  uniform float uCloudShadowStrength;
  uniform float uCloudFootprintThresholdBias;

  varying vec3 vSkyDir;

  vec4 samplePackedCloudNoise(vec2 uv) {
    return texture2D(uCloudNoiseTex, fract(uv));
  }

  vec2 cloudVolumeAtlasUv(vec2 xy, float sliceIndex) {
    float wrappedSlice = mod(sliceIndex, ${SEASONAL_CLOUD_VOLUME_SIZE}.0);
    vec2 tile = vec2(
      mod(wrappedSlice, ${SEASONAL_CLOUD_VOLUME_ATLAS_COLUMNS}.0),
      floor(wrappedSlice / ${SEASONAL_CLOUD_VOLUME_ATLAS_COLUMNS}.0)
    );
    vec2 atlasPixel =
      tile * ${SEASONAL_CLOUD_VOLUME_ATLAS_STRIDE}.0 +
      vec2(${SEASONAL_CLOUD_VOLUME_ATLAS_BORDER + 0.5}) +
      fract(xy) * ${SEASONAL_CLOUD_VOLUME_SIZE}.0;
    return atlasPixel / vec2(
      ${SEASONAL_CLOUD_VOLUME_ATLAS_WIDTH}.0,
      ${SEASONAL_CLOUD_VOLUME_ATLAS_HEIGHT}.0
    );
  }

  vec4 sampleCloudVolume(vec3 position) {
    float z = fract(position.z) * ${SEASONAL_CLOUD_VOLUME_SIZE}.0;
    float slice0 = floor(z);
    float slice1 = mod(slice0 + 1.0, ${SEASONAL_CLOUD_VOLUME_SIZE}.0);
    float sliceMix = fract(z);
    vec4 lowSlice = texture2D(
      uCloudVolumeTex,
      cloudVolumeAtlasUv(position.xy, slice0)
    );
    vec4 highSlice = texture2D(
      uCloudVolumeTex,
      cloudVolumeAtlasUv(position.xy, slice1)
    );
    return mix(lowSlice, highSlice, sliceMix);
  }

  float sampleCloudDensity(vec3 worldPosition, float cloudBase, float cloudTop) {
    float height01 = clamp((worldPosition.y - cloudBase) / max(0.0001, cloudTop - cloudBase), 0.0, 1.0);
    float layerMix = smoothstep(0.18, 0.86, height01);
    float scale = mix(uCloudNearScale, uCloudFarScale, layerMix);
    vec2 offset = mix(uCloudNearOffset, uCloudFarOffset, layerMix);
    offset += vec2((height01 - 0.5) * 0.09, -(height01 - 0.5) * 0.07);
    vec2 rotatedHorizontal = vec2(
      worldPosition.x * 0.8 + worldPosition.z * 0.6,
      -worldPosition.x * 0.6 + worldPosition.z * 0.8
    );
    vec2 weatherUv =
      rotatedHorizontal * scale * 0.021 * uCloudFootprintScale +
      offset * 0.36;
    vec4 weatherPacked = samplePackedCloudNoise(weatherUv);
    float coverage = clamp(uCloudCoverage, 0.0, 1.0);
    float coverageThreshold =
      0.85 -
      0.3 * smoothstep(0.0, 0.8, coverage) +
      uCloudFootprintThresholdBias;
    float middleBulge = sin(height01 * 3.14159265);
    float cumulusContraction =
      uCloudCumulus *
      (max(0.0, height01 - 0.16) * 0.16 - middleBulge * 0.035);
    float stratiformContraction =
      (1.0 - uCloudCumulus) * max(0.0, height01 - 0.72) * 0.075;
    float growthLift =
      uCloudCumulus * (weatherPacked.g - 0.5) * height01 * 0.11;
    float heightAdjustedFootprint =
      weatherPacked.r - cumulusContraction - stratiformContraction + growthLift;
    float footprint = smoothstep(
      coverageThreshold - 0.045,
      coverageThreshold + 0.065,
      heightAdjustedFootprint
    );
    if (footprint <= 0.001) {
      return 0.0;
    }

    vec2 weatherWarp = weatherPacked.ba - 0.5;
    float morphPhase = uCloudTimeDays * 0.035;
    vec2 morph = vec2(
      sin(morphPhase + weatherWarp.y * 4.1),
      cos(morphPhase * 0.83 - weatherWarp.x * 3.7)
    ) * 0.045;
    float volumeFrequency = 0.15 * uCloudVolumeScale;
    vec3 volumePosition = vec3(
      rotatedHorizontal.x * scale * volumeFrequency +
        height01 * 0.17 +
        offset.x * 0.74 +
        weatherWarp.x * 0.28 +
        morph.x,
      height01 * 1.08 +
        rotatedHorizontal.y * scale * 0.028 +
        weatherWarp.y * 0.16 +
        offset.x * 0.08 -
        offset.y * 0.05,
      rotatedHorizontal.y * scale * volumeFrequency -
        height01 * 0.13 +
        offset.y * 0.74 +
        weatherWarp.y * 0.28 +
        morph.y
    );
    vec4 volumePacked = sampleCloudVolume(volumePosition);
    float baseRamp = smoothstep(
      0.0,
      mix(0.09, 0.055, uCloudCumulus),
      height01
    );
    float stratiformTop =
      1.0 - smoothstep(0.72 + weatherPacked.g * 0.08, 1.0, height01);
    float cumulusTop =
      1.0 - smoothstep(0.68 + weatherPacked.g * 0.2, 1.0, height01);
    float verticalProfile =
      baseRamp * mix(stratiformTop, cumulusTop, uCloudCumulus);
    float volumeShape =
      volumePacked.r * 0.62 +
      volumePacked.g * 0.38 +
      middleBulge * mix(0.08, 0.17, uCloudCumulus);
    float bodyThreshold = mix(0.5, 0.56, uCloudCumulus);
    float bodySoftness = mix(0.045, 0.085, clamp(uCloudSoftness, 0.0, 1.0));
    float body = smoothstep(
      bodyThreshold - bodySoftness,
      bodyThreshold + bodySoftness,
      volumeShape
    );
    float edgeExposure = 1.0 - smoothstep(0.18, 0.78, body);
    float edgeErosion =
      (1.0 - (volumePacked.b * 0.68 + volumePacked.a * 0.32)) *
      edgeExposure *
      uCloudErosion *
      mix(0.18, 0.34, uCloudCumulus);
    float density =
      max(0.0, footprint * verticalProfile * (body - edgeErosion));
    float localDensityScale =
      mix(1.02, 1.46, clamp(uCloudDensity, 0.0, 1.0)) *
      mix(1.28, 1.0, coverage) *
      mix(1.12, 1.0, uCloudCumulus);
    return clamp(density * localDensityScale, 0.0, 1.0);
  }

  float rayJitter(vec3 dir) {
    return fract(sin(dot(dir, vec3(71.43, 193.17, 37.11))) * 43758.5453);
  }

  vec4 raymarchSeasonalClouds(vec3 dir, float horizonMask) {
    if (dir.y <= 0.012) {
      return vec4(0.0);
    }
    vec3 sunDir = normalize(uSunDirection);
    float cloudBase = uCloudBaseHeight;
    float cloudTop = uCloudTopHeight;
    float rayY = max(0.035, dir.y);
    float rayStart = cloudBase / rayY;
    float rayEnd = min(cloudTop / rayY, rayStart + mix(8.0, 22.0, horizonMask));
    float stepLength = (rayEnd - rayStart) / float(${SEASONAL_CLOUD_MARCH_STEPS});
    float jitter = mix(0.32, 0.68, rayJitter(dir));
    float transmittance = 1.0;
    vec3 accumulatedColor = vec3(0.0);

    for (int i = 0; i < ${SEASONAL_CLOUD_MARCH_STEPS}; i++) {
      float stepT = (float(i) + jitter) / float(${SEASONAL_CLOUD_MARCH_STEPS});
      float rayDistance = mix(rayStart, rayEnd, stepT);
      vec3 worldPosition = dir * rayDistance;
      float height01 = clamp((worldPosition.y - cloudBase) / (cloudTop - cloudBase), 0.0, 1.0);
      float density = sampleCloudDensity(worldPosition, cloudBase, cloudTop);
      float sliceAlpha = 1.0 - exp(-density * stepLength * 1.35);

      if (sliceAlpha > 0.002) {
        vec3 lightProbe =
          worldPosition + sunDir * mix(0.46, 0.82, uCloudShadowStrength);
        float lightDensity =
          sampleCloudDensity(lightProbe, cloudBase, cloudTop);
        float lightOpticalDepth = density * 0.32 + lightDensity * 0.86;
        float selfShadow =
          exp(-lightOpticalDepth * mix(2.5, 4.8, uCloudShadowStrength));
        float densityGradient =
          clamp((density - lightDensity) * 3.2 + 0.42, 0.0, 1.0);
        float sunFacing = smoothstep(-0.12, 0.98, dot(dir, sunDir));
        float heightFill =
          mix(0.1, 0.58, height01) *
          mix(1.0, 0.68, uCloudShadowStrength);
        float directLight =
          selfShadow *
          mix(0.26, 0.78, densityGradient) *
          mix(1.0, 0.7, uCloudShadowStrength);
        float lighting = clamp(heightFill + directLight, 0.0, 1.0);
        vec3 sliceColor = mix(uCloudFarColor, uCloudNearColor, lighting);
        float silverLining =
          pow(sunFacing, 6.0) *
          selfShadow *
          (1.0 - density) *
          mix(0.28, 0.08, uCloudShadowStrength);
        sliceColor = mix(sliceColor, uSunColor, silverLining);
        float contribution = transmittance * sliceAlpha;
        accumulatedColor += sliceColor * contribution;
        transmittance *= 1.0 - sliceAlpha;
      }

      if (transmittance < 0.04) {
        break;
      }
    }

    return vec4(accumulatedColor, clamp(1.0 - transmittance, 0.0, 0.98));
  }

  void main() {
    vec3 dir = normalize(vSkyDir);
    float skyT = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 baseSky = mix(uSkyHorizonColor, uSkyTopColor, pow(skyT, 0.6));
    float horizonMask = smoothstep(0.18, 1.0, 1.0 - clamp(dir.y, -0.3, 1.0));
    float sunDot = max(dot(dir, normalize(uSunDirection)), 0.0);
    float glow = pow(sunDot, mix(12.0, 6.0, uOvercastStrength));
    float disc = smoothstep(0.9945, 0.9989, sunDot);
    vec3 sunColor = uSunColor * uSunVisibility;
    vec3 skyWithSun = baseSky + sunColor * (glow * 0.48 + disc * 1.35);
    vec4 cloudVolume = raymarchSeasonalClouds(dir, horizonMask);
    vec3 color = skyWithSun * (1.0 - cloudVolume.a) + cloudVolume.rgb;
    color += sunColor * glow * (1.0 - cloudVolume.a * 0.82) * (0.14 + (1.0 - uOvercastStrength) * 0.2);
    float haze = smoothstep(-0.14, 0.12, dir.y) * uHazeStrength;
    color = mix(color, mix(uSkyHorizonColor, uCloudFarColor, cloudVolume.a * 0.16), haze * 0.72);
    gl_FragColor = vec4(max(color, vec3(0.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
