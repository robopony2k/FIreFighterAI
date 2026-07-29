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
  uniform float uStormIntensity;
  uniform float uCloudSoftness;
  uniform float uCloudDensity;

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
    float storm01 = clamp(uStormIntensity, 0.0, 1.0);
    float height01 = clamp((worldPosition.y - cloudBase) / max(0.0001, cloudTop - cloudBase), 0.0, 1.0);
    float layerMix = smoothstep(0.18, 0.86, height01);
    float scale = mix(uCloudNearScale, uCloudFarScale, layerMix);
    vec2 offset = mix(uCloudNearOffset, uCloudFarOffset, layerMix);
    offset += vec2(height01 * 0.17, -height01 * 0.13);
    vec2 rotatedHorizontal = vec2(
      worldPosition.x * 0.8 + worldPosition.z * 0.6,
      -worldPosition.x * 0.6 + worldPosition.z * 0.8
    );
    vec2 weatherUv = rotatedHorizontal * scale * 0.032 + offset * 0.44;
    vec4 weatherPacked = samplePackedCloudNoise(weatherUv);
    float morphPhase = uCloudTimeDays * 0.0015;
    vec2 morph = vec2(
      sin(morphPhase + worldPosition.y * 0.7),
      cos(morphPhase * 0.83 - worldPosition.y * 0.6)
    ) * 0.11;
    vec3 volumePosition = vec3(
      rotatedHorizontal.x * scale * 0.105 + offset.x * 0.82 + morph.x,
      height01 * 0.72 +
        uCloudTimeDays * 0.0012 +
        offset.x * 0.11 -
        offset.y * 0.07,
      rotatedHorizontal.y * scale * 0.105 + offset.y * 0.82 + morph.y
    );
    vec4 volumePacked = sampleCloudVolume(volumePosition);
    float volumeDetail = volumePacked.b;
    float erosionDetail = volumePacked.a;

    float coverage = clamp(uCloudCoverage + storm01 * 0.16, 0.0, 1.0);
    float coverageThreshold = 0.795 - 0.3 * pow(coverage, 1.5);
    float footprintShape = weatherPacked.r * 0.78 + weatherPacked.g * 0.22;
    float footprint = smoothstep(
      coverageThreshold - 0.035,
      coverageThreshold + 0.075,
      footprintShape
    );
    float localBase01 = (volumeDetail - 0.5) * 0.025;
    float crown = 1.0 - abs(height01 * 2.0 - 1.0);
    float verticalProfile =
      smoothstep(localBase01, localBase01 + 0.07, height01) *
      (1.0 - smoothstep(mix(0.68, 0.78, storm01), 1.0, height01));
    float volumeShape =
      volumePacked.r * 0.56 +
      volumePacked.g * 0.34 +
      volumeDetail * 0.1 +
      crown * mix(0.18, 0.1, storm01);
    float bodyThreshold = mix(0.63, 0.51, storm01);
    float bodySoftness = mix(0.055, 0.095, clamp(uCloudSoftness, 0.0, 1.0));
    float body = smoothstep(
      bodyThreshold - bodySoftness,
      bodyThreshold + bodySoftness,
      volumeShape
    );
    float edgeErosion =
      max(0.0, erosionDetail - mix(0.46, 0.62, storm01)) *
      (1.0 - volumePacked.r * 0.55);
    float density = max(
      0.0,
      footprint * body * verticalProfile -
        edgeErosion *
          footprint *
          mix(0.32, 0.1, storm01) *
          (1.0 - body * 0.45)
    );
    float localDensityScale =
      mix(0.9, 1.3, clamp(uCloudDensity, 0.0, 1.0)) *
      mix(1.22, 1.0, coverage) *
      mix(1.0, 1.3, storm01);
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
    float storm01 = clamp(uStormIntensity, 0.0, 1.0);
    float cloudBase = mix(1.82, 1.22, storm01);
    float cloudTop = mix(3.82, 2.72, storm01);
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
        vec3 lightProbeNear =
          worldPosition + sunDir * mix(0.28, 0.38, storm01);
        vec3 lightProbeFar =
          worldPosition + sunDir * mix(0.72, 0.94, storm01);
        float lightDensityNear =
          sampleCloudDensity(lightProbeNear, cloudBase, cloudTop);
        float lightDensityFar =
          sampleCloudDensity(lightProbeFar, cloudBase, cloudTop);
        float lightOpticalDepth =
          lightDensityNear * 0.52 + lightDensityFar * 0.78;
        float selfShadow =
          exp(-lightOpticalDepth * mix(2.6, 4.2, storm01));
        float densityGradient =
          clamp((density - lightDensityNear) * 3.2 + 0.42, 0.0, 1.0);
        float sunFacing = smoothstep(-0.12, 0.98, dot(dir, sunDir));
        float heightFill = mix(0.16, 0.58, height01);
        float directLight =
          selfShadow *
          mix(0.26, 0.78, densityGradient) *
          (1.0 - storm01 * 0.22);
        float lighting = clamp(heightFill + directLight, 0.0, 1.0);
        vec3 sliceColor = mix(uCloudFarColor, uCloudNearColor, lighting);
        float silverLining =
          pow(sunFacing, 6.0) *
          selfShadow *
          (1.0 - density) *
          mix(0.28, 0.1, storm01);
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
