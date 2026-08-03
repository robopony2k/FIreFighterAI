import {
  MDXYZX_QUALITY_PROFILES,
  MDXYZX_WAVE_MEAN,
  mdXyzxWaveCoreShader
} from "./mdXyzxWaveCoreShader.js";

export const MDXYZX_MACRO_DOMAIN_SCALE = 0.22;
export const MDXYZX_MACRO_AMPLITUDE_SCALE = 1.8;
export const MDXYZX_MACRO_BLEND_FOOTPRINT_START = 0.28;
export const MDXYZX_MACRO_BLEND_FOOTPRINT_END = 1.35;
export const MDXYZX_MAX_FAR_NORMAL_CALM = 0.28;

const profileValue = (
  key: keyof (typeof MDXYZX_QUALITY_PROFILES)["fast"]
): readonly [number, number, number] => [
  MDXYZX_QUALITY_PROFILES.fast[key],
  MDXYZX_QUALITY_PROFILES.balanced[key],
  MDXYZX_QUALITY_PROFILES.high[key]
];

const raymarchWaveIterations = profileValue("raymarchWaveIterations");
const normalWaveIterations = profileValue("normalWaveIterations");
const maxRaymarchSteps = profileValue("maxRaymarchSteps");
const macroNormalIterations = [5, 6, 7] as const;

// Production adapter for the visually approved MdXyzX construction. The
// carrier supplies only a camera ray and coverage; the visible surface hit
// and its normal are reconstructed per fragment.
export const mdXyzxProductionRaymarchShader = `
  ${mdXyzxWaveCoreShader}

  struct MdXyzxOceanHit {
    vec3 position;
    vec3 normal;
    float height;
    float distance;
    float stepCount;
    float converged;
    float waveIterations;
    float normalIterations;
    float macroIterations;
    float macroBlend;
    float normalCalm;
  };

  float mdXyzxQualityValue(float fastValue, float balancedValue, float highValue) {
    return u_quality < 0.5
      ? fastValue
      : (u_quality < 1.5 ? balancedValue : highValue);
  }

  float mdXyzxFootprintIterationLimit(float pixelFootprint) {
    // The 1.18 frequency progression is part of the original construction.
    // Stop before a phase cycle approaches one pixel instead of trying to
    // hide already-aliased waves in lighting.
    float safeFootprint = max(pixelFootprint, 0.0001);
    return floor(log(2.2 / safeFootprint) / log(1.18)) + 1.0;
  }

  int mdXyzxFilteredIterations(float qualityLimit, float pixelFootprint, float minimumCount) {
    float footprintLimit = mdXyzxFootprintIterationLimit(pixelFootprint);
    return int(clamp(floor(footprintLimit), minimumCount, qualityLimit));
  }

  vec3 mdXyzxCalculateMacroNormal(
    vec2 worldPosition,
    float worldEpsilon,
    float waterDepth,
    int waveIterations,
    vec2 windDirection,
    float windEnergy
  ) {
    float domainScale = ${MDXYZX_MACRO_DOMAIN_SCALE.toFixed(2)};
    float macroDepth = waterDepth * ${MDXYZX_MACRO_AMPLITUDE_SCALE.toFixed(1)};
    vec2 macroPosition = worldPosition * domainScale;
    vec2 macroOffsetX = vec2(worldEpsilon * domainScale, 0.0);
    vec2 macroOffsetZ = vec2(0.0, worldEpsilon * domainScale);
    float centerHeight = mdXyzxGetProductionWaves(
      macroPosition,
      waveIterations,
      windDirection,
      windEnergy
    ) * macroDepth;
    float xHeight = mdXyzxGetProductionWaves(
      macroPosition - macroOffsetX,
      waveIterations,
      windDirection,
      windEnergy
    ) * macroDepth;
    float zHeight = mdXyzxGetProductionWaves(
      macroPosition + macroOffsetZ,
      waveIterations,
      windDirection,
      windEnergy
    ) * macroDepth;
    // The vertical component stays in world units, so the broader domain
    // naturally produces gentler slopes instead of oversized far waves.
    return normalize(vec3(
      xHeight - centerHeight,
      worldEpsilon,
      centerHeight - zHeight
    ));
  }

  MdXyzxOceanHit mdXyzxTraceProductionOcean(
    vec3 carrierWorldPosition,
    float waterLevel,
    float waterDepth,
    float pixelFootprint
  ) {
    MdXyzxOceanHit hit;
    hit.position = carrierWorldPosition;
    hit.normal = vec3(0.0, 1.0, 0.0);
    hit.height = 0.5;
    hit.distance = length(cameraPosition - carrierWorldPosition);
    hit.stepCount = 0.0;
    hit.converged = 0.0;
    hit.waveIterations = 0.0;
    hit.normalIterations = 0.0;
    hit.macroIterations = 0.0;
    hit.macroBlend = 0.0;
    hit.normalCalm = 0.0;

    float rayWaveLimit = mdXyzxQualityValue(
      ${raymarchWaveIterations[0].toFixed(1)},
      ${raymarchWaveIterations[1].toFixed(1)},
      ${raymarchWaveIterations[2].toFixed(1)}
    );
    float normalWaveLimit = mdXyzxQualityValue(
      ${normalWaveIterations[0].toFixed(1)},
      ${normalWaveIterations[1].toFixed(1)},
      ${normalWaveIterations[2].toFixed(1)}
    );
    float stepLimit = mdXyzxQualityValue(
      ${maxRaymarchSteps[0].toFixed(1)},
      ${maxRaymarchSteps[1].toFixed(1)},
      ${maxRaymarchSteps[2].toFixed(1)}
    );
    float macroWaveLimit = mdXyzxQualityValue(
      ${macroNormalIterations[0].toFixed(1)},
      ${macroNormalIterations[1].toFixed(1)},
      ${macroNormalIterations[2].toFixed(1)}
    );
    int rayIterations = mdXyzxFilteredIterations(rayWaveLimit, pixelFootprint, 5.0);
    int normalIterations = mdXyzxFilteredIterations(normalWaveLimit, pixelFootprint, 8.0);
    int macroIterations = mdXyzxFilteredIterations(
      macroWaveLimit,
      pixelFootprint * ${MDXYZX_MACRO_DOMAIN_SCALE.toFixed(2)},
      4.0
    );
    hit.waveIterations = float(rayIterations);
    hit.normalIterations = float(normalIterations);
    hit.macroIterations = float(macroIterations);
    float windDirectionLength = length(u_waveDirection);
    vec2 windDirection = windDirectionLength > 0.0001
      ? u_waveDirection / windDirectionLength
      : vec2(0.0, 1.0);
    float windEnergy = clamp(u_oceanContext.x, 0.0, 1.0);

    vec3 cameraRay = normalize(carrierWorldPosition - cameraPosition);
    float waterTop = waterLevel + (1.0 - ${MDXYZX_WAVE_MEAN.toFixed(3)}) * waterDepth;
    float waterBottom = waterTop - waterDepth;
    float upperDistance = mdXyzxIntersectWaterPlane(cameraPosition, cameraRay, waterTop);
    float lowerDistance = mdXyzxIntersectWaterPlane(cameraPosition, cameraRay, waterBottom);
    if (upperDistance <= 0.0 || lowerDistance <= upperDistance) {
      return hit;
    }

    vec3 upperPlaneHit = cameraPosition + cameraRay * upperDistance;
    vec3 lowerPlaneHit = cameraPosition + cameraRay * lowerDistance;
    float raymarchConverged;
    float hitDistance = mdXyzxRaymarchProductionWater(
      cameraPosition,
      upperPlaneHit,
      lowerPlaneHit,
      waterTop,
      waterDepth,
      rayIterations,
      stepLimit,
      windDirection,
      windEnergy,
      hit.stepCount,
      raymarchConverged
    );
    if (raymarchConverged < 0.5) {
      return hit;
    }

    hit.position = cameraPosition + cameraRay * hitDistance;
    hit.distance = hitDistance;
    hit.height = clamp((hit.position.y - waterBottom) / max(waterDepth, 0.0001), 0.0, 1.0);
    hit.macroBlend = smoothstep(
      ${MDXYZX_MACRO_BLEND_FOOTPRINT_START.toFixed(2)},
      ${MDXYZX_MACRO_BLEND_FOOTPRINT_END.toFixed(2)},
      pixelFootprint
    );
    vec3 detailNormal = vec3(0.0, 1.0, 0.0);
    if (hit.macroBlend < 0.999) {
      float normalEpsilon = max(0.01, pixelFootprint * 0.08);
      detailNormal = mdXyzxCalculateProductionNormal(
        hit.position.xz,
        normalEpsilon,
        waterDepth,
        normalIterations,
        windDirection,
        windEnergy
      );
    }
    vec3 macroNormal = detailNormal;
    if (hit.macroBlend > 0.001) {
      float macroEpsilon = max(0.04, pixelFootprint * 0.18);
      macroNormal = mdXyzxCalculateMacroNormal(
        hit.position.xz,
        macroEpsilon,
        waterDepth,
        macroIterations,
        windDirection,
        windEnergy
      );
    }
    hit.normal = normalize(mix(detailNormal, macroNormal, hit.macroBlend));

    // Frequency selection and normal flattening are intentionally separate.
    // Even at the largest footprints at least 72% of the broad slope remains.
    hit.normalCalm =
      smoothstep(1.35, 5.5, pixelFootprint) *
      ${MDXYZX_MAX_FAR_NORMAL_CALM.toFixed(2)};
    hit.normal = normalize(mix(hit.normal, vec3(0.0, 1.0, 0.0), hit.normalCalm));
    hit.converged = 1.0;
    return hit;
  }
`;
