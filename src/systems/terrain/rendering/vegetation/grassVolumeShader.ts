import {
  GRASS_VOLUME_MAX_INTEGRATION_STEP,
  grassVolumeMarchingShader
} from "./grassVolumeMarchingShader.js";
import { grassSeasonShader } from "./grassSeasonShader.js";

export const GRASS_VOLUME_MARCH_STEPS = 96;
export const GRASS_VOLUME_MID_MARCH_STEPS = 64;
export const GRASS_VOLUME_DISTANT_MARCH_STEPS = 40;
export const GRASS_VOLUME_AGE_CYCLE_SECONDS = 30;
export const GRASS_VOLUME_WIND_BEND_SCALE = 0.34;
export const GRASS_VOLUME_CLUMP_DETAIL_MIN_PIXELS = 2;
export const GRASS_VOLUME_FINE_DETAIL_MIN_PIXELS = 8;
export const GRASS_VOLUME_MAX_LENGTH = 0.6;

export type GrassVolumeDebugView = "final" | "grass-mask" | "canopy-height" | "march-work" | "sample-spacing";
export type GrassVolumeVariant = "volume-clumps" | "pcg-sdf";

export type GrassVolumeControls = {
  enabled: boolean;
  variant: GrassVolumeVariant;
  autoAge: boolean;
  dryness: number;
  grassLength: number;
  density: number;
  windResponse: number;
  windSpeed: number;
  debugView: GrassVolumeDebugView;
};

export const DEFAULT_GRASS_VOLUME_CONTROLS: Readonly<GrassVolumeControls> = {
  enabled: true,
  variant: "volume-clumps",
  autoAge: false,
  dryness: 0.28,
  grassLength: 0.20,
  density: 0.82,
  windResponse: 0.65,
  windSpeed: 1,
  debugView: "final"
};

const DEBUG_VIEWS: readonly GrassVolumeDebugView[] = [
  "final",
  "grass-mask",
  "canopy-height",
  "march-work",
  "sample-spacing"
];
const GRASS_VARIANTS: readonly GrassVolumeVariant[] = ["volume-clumps", "pcg-sdf"];

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export const normalizeGrassVolumeControls = (
  controls: Partial<GrassVolumeControls> = {}
): GrassVolumeControls => ({
  enabled: typeof controls.enabled === "boolean" ? controls.enabled : DEFAULT_GRASS_VOLUME_CONTROLS.enabled,
  variant: GRASS_VARIANTS.includes(controls.variant as GrassVolumeVariant)
    ? controls.variant as GrassVolumeVariant
    : DEFAULT_GRASS_VOLUME_CONTROLS.variant,
  autoAge: typeof controls.autoAge === "boolean" ? controls.autoAge : DEFAULT_GRASS_VOLUME_CONTROLS.autoAge,
  dryness: clamp(Number.isFinite(controls.dryness) ? controls.dryness as number : DEFAULT_GRASS_VOLUME_CONTROLS.dryness, 0, 1),
  grassLength: clamp(Number.isFinite(controls.grassLength) ? controls.grassLength as number : DEFAULT_GRASS_VOLUME_CONTROLS.grassLength, 0.08, GRASS_VOLUME_MAX_LENGTH),
  density: clamp(Number.isFinite(controls.density) ? controls.density as number : DEFAULT_GRASS_VOLUME_CONTROLS.density, 0, 1),
  windResponse: clamp(Number.isFinite(controls.windResponse) ? controls.windResponse as number : DEFAULT_GRASS_VOLUME_CONTROLS.windResponse, 0, 1),
  windSpeed: clamp(Number.isFinite(controls.windSpeed) ? controls.windSpeed as number : DEFAULT_GRASS_VOLUME_CONTROLS.windSpeed, 0, 2),
  debugView: DEBUG_VIEWS.includes(controls.debugView as GrassVolumeDebugView)
    ? controls.debugView as GrassVolumeDebugView
    : DEFAULT_GRASS_VOLUME_CONTROLS.debugView
});

export const resolveGrassVolumeDryness = (controls: GrassVolumeControls, timeSeconds: number): number => {
  if (!controls.autoAge) return controls.dryness;
  const cycle = ((timeSeconds / GRASS_VOLUME_AGE_CYCLE_SECONDS) % 1 + 1) % 1;
  return cycle * cycle * (3 - 2 * cycle);
};

export const grassVolumeDebugViewToUniform = (view: GrassVolumeDebugView): number => DEBUG_VIEWS.indexOf(view);

export const grassVolumeVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/*
 * Adapted from the user-authored ShaderToy grass study:
 * https://www.shadertoy.com/view/7cyGzd
 * The FX Lab version replaces synthetic terrain and the fixed camera with the
 * showcase terrain field, gameplay camera, scene depth, wind, and key light.
 */
export const grassVolumeFragmentShader = `
  precision highp float;

  #define GRASS_MARCH_STEPS ${GRASS_VOLUME_MARCH_STEPS}

  uniform sampler2D uSceneDepth;
  uniform sampler2D uTerrainField;
  uniform sampler2D uGameplayGrassField;
  uniform sampler2D uWindField;
  uniform sampler2D uVariationField;
  uniform vec2 uFieldSize;
  uniform vec2 uWorldSize;
  uniform vec2 uHeightRange;
  uniform float uFieldCellWorldSize;
  uniform float uProjectionScale;
  uniform float uWindVectorRange;
  uniform vec3 uCameraPosition;
  uniform mat4 uInverseViewProjection;
  uniform vec3 uSunDirection;
  uniform float uDryness;
  uniform float uGrassLength;
  uniform float uDensity;
  uniform float uWindResponse;
  uniform float uSeasonT01;
  uniform float uClimateDryness;
  uniform float uUseGameplayProperties;
  uniform float uDebugView;
  varying vec2 vUv;

  float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  vec2 worldToUv(vec2 worldXZ) {
    return worldXZ / uWorldSize + 0.5;
  }

  float decodeHeight(vec4 packed) {
    float highByte = packed.r * 255.0;
    float lowByte = packed.g * 255.0;
    float normalized = (highByte * 256.0 + lowByte) / 65535.0;
    return mix(uHeightRange.x, uHeightRange.y, normalized);
  }

  vec4 sampleFieldCell(vec2 cell) {
    vec2 safeCell = clamp(cell, vec2(0.0), uFieldSize - 1.0);
    return texture2D(uTerrainField, (safeCell + 0.5) / uFieldSize);
  }

  float sampleTerrainHeight(vec2 uv) {
    vec2 grid = clamp(uv, vec2(0.0), vec2(1.0)) * (uFieldSize - 1.0);
    return decodeHeight(texture2D(uTerrainField, (grid + 0.5) / uFieldSize));
  }

  float sampleGrassMask(vec2 uv) {
    vec2 cell = floor(clamp(uv, vec2(0.0), vec2(0.999999)) * uFieldSize);
    return step(0.5, sampleFieldCell(cell).b);
  }

  float sampleGrassCoverage(vec2 uv) {
    vec2 safeUv = clamp(uv, vec2(0.0), vec2(0.999999));
    vec2 cell = floor(safeUv * uFieldSize);
    float hardOwnership = step(0.5, sampleFieldCell(cell).b);
    if (hardOwnership < 0.5) return 0.0;
    float filteredOwnership = texture2D(uTerrainField, safeUv).b;
    return smoothstep(0.50, 0.96, filteredOwnership);
  }

  float sampleGrassDistanceCells(vec2 uv) {
    vec2 cell = floor(clamp(uv, vec2(0.0), vec2(0.999999)) * uFieldSize);
    return floor(sampleFieldCell(cell).a * 255.0 + 0.5);
  }

  ${grassVolumeMarchingShader}
  ${grassSeasonShader}

  vec4 windField(vec2 worldXZ) {
    vec4 encoded = texture2D(uWindField, worldToUv(worldXZ));
    float response = clamp(uWindResponse, 0.0, 1.0);
    return vec4(
      (encoded.xy * 2.0 - 1.0) * uWindVectorRange * response,
      encoded.zw * response
    );
  }

  vec4 grassProperties(vec2 worldXZ) {
    vec4 variation = texture2D(uVariationField, worldToUv(worldXZ));
    if (uUseGameplayProperties > 0.5) {
      vec2 gameplayGrid = clamp(worldToUv(worldXZ), vec2(0.0), vec2(1.0)) * (uFieldSize - 1.0);
      vec4 gameplay = texture2D(uGameplayGrassField, (gameplayGrid + 0.5) / uFieldSize);
      float fuelLoad = clamp(gameplay.r, 0.0, 1.0);
      float seasonalFuelLoad = fuelLoad * campaignGrassSeasonGrowth(uSeasonT01);
      float fuelLength = mix(0.08, ${GRASS_VOLUME_MAX_LENGTH.toFixed(2)}, seasonalFuelLoad);
      float density = clamp(
        uDensity * mix(0.72, 1.08, variation.a) * smoothstep(0.0, 0.16, fuelLoad),
        0.0,
        1.0
      );
      return vec4(fuelLength, campaignGrassDryness(gameplay.g), density, 1.0);
    }
    float fuelVariation = variation.r - 0.5;
    float localFuel = variation.g - 0.5;
    float fuelLength = clamp(
      uGrassLength + fuelVariation * 0.34 + localFuel * 0.12,
      0.08,
      ${GRASS_VOLUME_MAX_LENGTH.toFixed(2)}
    );
    float drynessVariation = variation.b - 0.5;
    float dryness = clamp(uDryness + drynessVariation * 0.24, 0.0, 1.0);
    float densityField = variation.a;
    float density = clamp(uDensity * mix(0.56, 1.08, densityField) + fuelLength * 0.08, 0.0, 1.0);
    return vec4(fuelLength, dryness, density, 1.0);
  }

  vec3 grassColour(float dryness, float verticalPosition, float variation) {
    vec3 greenBase = vec3(0.025, 0.105, 0.018);
    vec3 greenTip = vec3(0.170, 0.430, 0.055);
    vec3 curingBase = vec3(0.185, 0.150, 0.025);
    vec3 curingTip = vec3(0.625, 0.500, 0.090);
    vec3 dryBase = vec3(0.255, 0.125, 0.025);
    vec3 dryTip = vec3(0.920, 0.735, 0.285);
    float heightVariation = clamp(verticalPosition * 0.82 + variation * 0.18, 0.0, 1.0);
    vec3 healthy = mix(greenBase, greenTip, heightVariation);
    vec3 curing = mix(curingBase, curingTip, heightVariation);
    vec3 dryGrass = mix(dryBase, dryTip, heightVariation);
    vec3 colour = mix(healthy, curing, smoothstep(0.18, 0.58, dryness));
    colour = mix(colour, dryGrass, smoothstep(0.55, 0.92, dryness));
    float dryTipHighlight = dryness * smoothstep(0.45, 1.0, verticalPosition);
    colour += vec3(0.16, 0.105, 0.025) * dryTipHighlight;
    colour *= mix(1.0, 0.78, dryness * (1.0 - verticalPosition));
    return colour;
  }

  float bladeStructure(
    vec2 worldXZ,
    vec2 windDirection,
    float verticalPosition,
    float distanceFromCamera,
    float projectedGrassPixels
  ) {
    float detailFade = 1.0 - smoothstep(7.0, 24.0, distanceFromCamera);
    float projectedDetail = smoothstep(3.0, 14.0, projectedGrassPixels);
    float detailStrength = detailFade * projectedDetail;
    if (detailStrength < 0.001) return 0.72;
    vec2 tangent = vec2(-windDirection.y, windDirection.x);
    vec2 bladeCoordinates = vec2(dot(worldXZ, tangent), dot(worldXZ, windDirection));
    float scale = mix(2.2, 4.6, detailFade);
    vec2 cellCoordinates = bladeCoordinates * vec2(scale, scale * 0.72);
    vec2 cell = floor(cellCoordinates);
    vec2 local = fract(cellCoordinates) - 0.5;
    local.x -= (hash21(cell + 8.3) - 0.5) * 0.58;
    float width = mix(0.22, 0.085, detailFade) * mix(1.0, 0.52, verticalPosition);
    float blade = 1.0 - smoothstep(width, width + 0.10, abs(local.x));
    float bladeExists = step(0.32, hash21(cell + 19.7));
    float structuredDensity = mix(0.52, 1.16, blade) * mix(0.88, 1.0, bladeExists);
    return mix(0.72, structuredDensity, detailStrength * 0.72);
  }

  vec3 debugHeat(float value) {
    return clamp(vec3(value * 1.8, 1.0 - abs(value * 2.0 - 1.0), 1.3 - value * 1.6), 0.0, 1.0);
  }

  void main() {
    float sceneDepth = texture2D(uSceneDepth, vUv).x;
    if (sceneDepth >= 0.999999) {
      gl_FragColor = vec4(0.0);
      return;
    }
    vec3 farWorld = reconstructWorld(vUv, 1.0);
    vec3 rayDirection = normalize(farWorld - uCameraPosition);
    vec3 sceneWorld = reconstructWorld(vUv, min(sceneDepth, 0.999999));
    float sceneDistance = sceneDepth < 0.999999
      ? max(0.0, dot(sceneWorld - uCameraPosition, rayDirection))
      : 100000.0;

    vec2 referenceXZ = sceneWorld.xz;
    vec2 referenceUv = worldToUv(referenceXZ);
    float referenceTerrainHeight = sampleTerrainHeight(referenceUv);
    bool sceneMatchesTerrain =
      abs(sceneWorld.y - referenceTerrainHeight) <= terrainDepthTolerance();
    float referenceMask = sceneMatchesTerrain ? sampleGrassMask(referenceUv) : 0.0;

    if (uDebugView > 0.5 && uDebugView < 2.5) {
      if (uDebugView < 1.5) {
        gl_FragColor = vec4(vec3(referenceMask), 1.0);
        return;
      }
      vec4 props = grassProperties(referenceXZ);
      vec4 wind = windField(referenceXZ);
      float edgeCoverage = referenceMask * sampleGrassCoverage(referenceUv);
      float canopy = mix(0.08, 1.15, props.x)
        * mix(0.42, 1.0, props.z)
        * mix(1.0, 0.96, wind.z)
        * edgeCoverage;
      gl_FragColor = vec4(debugHeat(canopy / 1.15) * referenceMask, 1.0);
      return;
    }

    if (!sceneMatchesTerrain || referenceMask < 0.5) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float referenceEdgeCoverage = sampleGrassCoverage(referenceUv);
    if (referenceEdgeCoverage <= 0.001) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float nearDistance;
    float farDistance;
    bool hitWorld = intersectBox(
      uCameraPosition,
      rayDirection,
      vec3(-uWorldSize.x * 0.5, uHeightRange.x - 0.05, -uWorldSize.y * 0.5),
      vec3(uWorldSize.x * 0.5, uHeightRange.y + 1.2, uWorldSize.y * 0.5),
      nearDistance,
      farDistance
    );
    if (!hitWorld) {
      gl_FragColor = vec4(0.0);
      return;
    }
    nearDistance = max(nearDistance, 0.0);
    farDistance = min(farDistance, sceneDistance);
    if (farDistance <= nearDistance) {
      gl_FragColor = vec4(0.0);
      return;
    }

    vec4 rayProps = grassProperties(referenceXZ);
    vec4 rayWind = windField(referenceXZ);
    vec2 terrainGradient = sampleTerrainGradient(referenceUv);
    float fuelLength = rayProps.x;
    float dryness = rayProps.y;
    float density = rayProps.z;
    float grassHeight = mix(0.08, 1.15, fuelLength)
      * mix(0.42, 1.0, density)
      * mix(1.0, 0.96, rayWind.z);
    float anchoredGrassHeight = grassHeight * referenceEdgeCoverage;
    vec2 windVector = rayWind.xy;
    vec2 windDirection = normalize(windVector + vec2(0.0001));
    float sunFacing = clamp(
      0.52 + dot(windDirection, normalize(uSunDirection.xz + vec2(0.0001))) * 0.22,
      0.25,
      0.90
    );
    float lodDistance = max(sceneDistance, 0.1);
    float maximumProjectedGrassHeight = anchoredGrassHeight * uProjectionScale / lodDistance;
    if (maximumProjectedGrassHeight < 1.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    float stepCeiling = maximumProjectedGrassHeight > 24.0
      ? float(GRASS_MARCH_STEPS)
      : (maximumProjectedGrassHeight > 7.0
        ? ${GRASS_VOLUME_MID_MARCH_STEPS.toFixed(1)}
        : ${GRASS_VOLUME_DISTANT_MARCH_STEPS.toFixed(1)});
    float closingRate = terrainClosingRate(rayDirection, terrainGradient);
    float marchSpan = terrainAnchoredMarchSpan(anchoredGrassHeight, closingRate);
    nearDistance = max(nearDistance, farDistance - marchSpan);
    if (farDistance <= nearDistance) {
      gl_FragColor = vec4(0.0);
      return;
    }
    float targetStepCount = adaptiveMarchStepCount(farDistance - nearDistance, stepCeiling);
    float stepLength = (farDistance - nearDistance) / targetStepCount;
    float integrationLength = min(stepLength, ${GRASS_VOLUME_MAX_INTEGRATION_STEP.toFixed(3)});

    if (uDebugView > 3.5) {
      float spacingRatio = stepLength / ${GRASS_VOLUME_MAX_INTEGRATION_STEP.toFixed(3)};
      gl_FragColor = vec4(debugHeat(min(spacingRatio, 1.0)), 1.0);
      return;
    }

    float marchDistance = nearDistance + stepLength * 0.5;
    vec3 accumulatedColour = vec3(0.0);
    float accumulatedAlpha = 0.0;
    float executedSteps = 0.0;
    for (int stepIndex = 0; stepIndex < GRASS_MARCH_STEPS; stepIndex++) {
      if (marchDistance >= farDistance) break;
      executedSteps += 1.0;
      float sampleDistance = marchDistance;
      vec3 worldPosition = uCameraPosition + rayDirection * sampleDistance;
      vec2 fieldUv = worldToUv(worldPosition.xz);
      float edgeCoverage = sampleGrassCoverage(fieldUv);
      if (edgeCoverage <= 0.001) {
        float emptyCells = max(0.0, sampleGrassDistanceCells(fieldUv) - 1.5);
        float lateralRaySpeed = max(length(rayDirection.xz), 0.05);
        float emptyWorldDistance = emptyCells * uFieldCellWorldSize / lateralRaySpeed;
        marchDistance += max(stepLength, emptyWorldDistance);
        continue;
      }
      marchDistance += stepLength;
      float terrainHeight = sampleTerrainHeight(fieldUv);
      float localGrassHeight = grassHeight * edgeCoverage;
      if (worldPosition.y <= terrainHeight || worldPosition.y >= terrainHeight + localGrassHeight) continue;
      float projectedGrassPixels = localGrassHeight * uProjectionScale / max(sampleDistance, 0.1);
      float projectedFade = smoothstep(0.75, 2.0, projectedGrassPixels);
      if (projectedFade <= 0.0) continue;
      float verticalPosition = clamp((worldPosition.y - terrainHeight) / max(localGrassHeight, 0.001), 0.0, 1.0);
      vec2 bentPosition = worldPosition.xz
        - windVector * verticalPosition * verticalPosition * fuelLength * ${GRASS_VOLUME_WIND_BEND_SCALE.toFixed(2)};
      float clumpNoise = 0.56;
      if (projectedGrassPixels > ${GRASS_VOLUME_CLUMP_DETAIL_MIN_PIXELS.toFixed(1)}) {
        float rawClumpNoise = hash21(floor(bentPosition * 2.15));
        clumpNoise = mix(0.56, rawClumpNoise, smoothstep(2.0, 9.0, projectedGrassPixels));
      }
      float fineNoise = 0.50;
      if (projectedGrassPixels > ${GRASS_VOLUME_FINE_DETAIL_MIN_PIXELS.toFixed(1)}) {
        float rawFineNoise = hash21(floor(bentPosition * 7.5) + floor(verticalPosition * 8.0));
        fineNoise = mix(0.50, rawFineNoise, smoothstep(8.0, 20.0, projectedGrassPixels));
      }
      float verticalDensity = smoothstep(0.0, 0.12, verticalPosition) * (1.0 - smoothstep(0.72, 1.0, verticalPosition));
      float bladeDensity = bladeStructure(
        bentPosition,
        windDirection,
        verticalPosition,
        sampleDistance,
        projectedGrassPixels
      );
      float localDensity = density * edgeCoverage * projectedFade * verticalDensity * mix(0.45, 1.25, clumpNoise);
      localDensity *= mix(0.58, 1.18, fineNoise) * mix(0.55, 1.0, fuelLength) * bladeDensity * mix(0.97, 1.06, rayWind.z);
      float sampleAlpha = 1.0 - exp(-localDensity * integrationLength * 3.6);
      vec3 sampleColour = grassColour(dryness, verticalPosition, clumpNoise * 0.62 + fineNoise * 0.38);
      sampleColour *= sunFacing * mix(0.74, 1.28, verticalPosition) * mix(0.97, 1.05, rayWind.z);
      float contribution = (1.0 - accumulatedAlpha) * sampleAlpha;
      accumulatedColour += sampleColour * contribution;
      accumulatedAlpha += contribution;
      if (accumulatedAlpha > 0.985) break;
    }

    if (uDebugView > 2.5) {
      float hasGrassWork = step(0.5, executedSteps);
      float work = executedSteps / max(stepCeiling, 1.0);
      gl_FragColor = vec4(debugHeat(work) * hasGrassWork, hasGrassWork);
      return;
    }
    gl_FragColor = vec4(max(accumulatedColour, vec3(0.0)), accumulatedAlpha);
  }
`;
