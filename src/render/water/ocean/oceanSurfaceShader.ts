import * as THREE from "three";

export type OceanUniforms = {
  u_time: { value: number };
  u_mask: { value: THREE.Texture };
  u_supportMap: { value: THREE.Texture };
  u_domainMap: { value: THREE.Texture };
  u_shoreSdf: { value: THREE.Texture };
  u_shoreTransitionMap: { value: THREE.Texture };
  u_color: { value: THREE.Color };
  u_deepColor: { value: THREE.Color };
  u_opacity: { value: number };
  u_waveScale: { value: number };
  u_normalMap1: { value: THREE.Texture };
  u_normalMap2: { value: THREE.Texture };
  u_scroll1: { value: THREE.Vector2 };
  u_scroll2: { value: THREE.Vector2 };
  u_normalScale: { value: number };
  u_normalStrength: { value: number };
  u_shininess: { value: number };
  u_lightDir: { value: THREE.Vector3 };
  u_specular: { value: number };
  u_skyTopColor: { value: THREE.Color };
  u_skyHorizonColor: { value: THREE.Color };
  u_sunColor: { value: THREE.Color };
  u_fogColor: { value: THREE.Color };
  u_fogNear: { value: number };
  u_fogFar: { value: number };
  u_waveAmp: { value: number };
  u_waveFreq: { value: THREE.Vector2 };
  u_waveVariance: { value: number };
  u_cellGrid: { value: THREE.Vector2 };
  u_worldStep: { value: THREE.Vector2 };
  u_uvStep: { value: THREE.Vector2 };
  u_tideAmp: { value: number };
  u_tideFreq: { value: number };
  u_quality: { value: number };
  u_shoreParamsA: { value: THREE.Vector4 };
  u_shoreParamsB: { value: THREE.Vector4 };
  u_shoreFeatureMix: { value: THREE.Vector4 };
  u_shoreTuning: { value: THREE.Vector4 };
  u_shoreWaveShape: { value: THREE.Vector4 };
};

const shaderNoiseFns = `
  float hash21(vec2 p) {
    vec2 q = fract(p * vec2(123.34, 456.21));
    q += dot(q, q + 45.32);
    return fract(q.x * q.y);
  }

  float valueNoise21(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    vec2 smoothF = f * f * (3.0 - 2.0 * f);
    float a = hash21(cell);
    float b = hash21(cell + vec2(1.0, 0.0));
    float c = hash21(cell + vec2(0.0, 1.0));
    float d = hash21(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, smoothF.x), mix(c, d, smoothF.x), smoothF.y);
  }
`;

const shaderShoreFns = `
  vec2 sampleShoreGradient(vec2 uvCoord) {
    vec2 stepX = vec2(u_uvStep.x, 0.0);
    vec2 stepY = vec2(0.0, u_uvStep.y);
    float sdfPosX = texture2D(u_shoreSdf, uvCoord + stepX).r * 2.0 - 1.0;
    float sdfNegX = texture2D(u_shoreSdf, uvCoord - stepX).r * 2.0 - 1.0;
    float sdfPosY = texture2D(u_shoreSdf, uvCoord + stepY).r * 2.0 - 1.0;
    float sdfNegY = texture2D(u_shoreSdf, uvCoord - stepY).r * 2.0 - 1.0;
    vec2 grad = vec2(sdfPosX - sdfNegX, sdfPosY - sdfNegY);
    float gradLen = length(grad);
    if (gradLen < 1e-4) {
      return vec2(0.93, 0.37);
    }
    return grad / gradLen;
  }

  float computeOrganicShoreInset(vec2 worldXZ, float positiveSdf) {
    float surfBand = 1.0 - smoothstep(u_shoreParamsA.y, u_shoreParamsA.z, positiveSdf);
    float edgePresence = smoothstep(u_shoreParamsA.x * 0.25, u_shoreParamsA.z, positiveSdf);
    float edgeNoiseA = valueNoise21(worldXZ * vec2(0.082, 0.069) + vec2(17.3, 9.1));
    float edgeNoiseB = valueNoise21(worldXZ * vec2(0.163, 0.141) + vec2(-4.7, 13.6));
    float edgeNoise = smoothstep(0.18, 0.86, edgeNoiseA * 0.68 + edgeNoiseB * 0.32);
    return mix(0.34, 1.0, edgeNoise) * u_shoreParamsA.w * edgePresence * surfBand * u_shoreFeatureMix.x;
  }

  float computeShorePulse(vec2 worldXZ, vec2 uvCoord, float shorelineSdf) {
    vec2 noiseUv = worldXZ * vec2(0.013, 0.011);
    float cellNoiseA = valueNoise21(noiseUv + vec2(0.17, 0.61));
    float cellNoiseB = valueNoise21(noiseUv * 1.13 + vec2(2.91, 1.37));
    float cellNoiseC = valueNoise21(noiseUv * 0.72 + vec2(4.73, 0.29));
    float lenVarianceA = mix(0.09, 0.2, clamp(u_waveVariance, 0.0, 1.0));
    float lenVarianceB = mix(0.12, 0.24, clamp(u_waveVariance, 0.0, 1.0));
    float shoreWaveBlend = smoothstep(u_shoreParamsA.x, u_shoreParamsA.z, shorelineSdf);
    float localWaveLengthScale = mix(
      1.0,
      mix(u_shoreWaveShape.y, 1.0, shoreWaveBlend),
      u_shoreWaveShape.z
    );
    float wave1Len =
      mix(u_waveFreq.x * (1.0 - lenVarianceA), u_waveFreq.x * (1.0 + lenVarianceA), cellNoiseA) *
      u_shoreTuning.z *
      localWaveLengthScale;
    float wave2Len =
      mix(u_waveFreq.y * (1.0 - lenVarianceB), u_waveFreq.y * (1.0 + lenVarianceB), cellNoiseB) *
      u_shoreTuning.z *
      localWaveLengthScale;
    vec2 shoreOut = sampleShoreGradient(uvCoord);
    vec2 shoreIn = -shoreOut;
    vec2 shoreAlong = vec2(-shoreIn.y, shoreIn.x);
    float shorePhaseA =
      dot(worldXZ, normalize(shoreIn + shoreAlong * 0.26)) *
        (6.28318530718 / max(4.2, wave1Len * 0.42)) -
      u_time * mix(2.8, 3.6, cellNoiseA) +
      cellNoiseB * 6.28318530718;
    float shorePhaseB =
      dot(worldXZ, normalize(shoreIn - shoreAlong * 0.31)) *
        (6.28318530718 / max(5.6, wave2Len * 0.36)) -
      u_time * mix(3.2, 4.1, cellNoiseC) +
      1.7;
    float shorePulseA = max(0.0, sin(shorePhaseA));
    float shorePulseB = max(0.0, sin(shorePhaseB));
    shorePulseA *= shorePulseA;
    shorePulseB *= shorePulseB;
    float pulseMix = smoothstep(0.12, 0.92, shorePulseA * 0.62 + shorePulseB * 0.38);
    float surfBand = 1.0 - smoothstep(u_shoreParamsA.x * 0.4, u_shoreParamsA.z, shorelineSdf);
    return pulseMix * surfBand * u_shoreFeatureMix.y;
  }
`;

const shaderWaveFns = `
  const float PI = 3.14159265359;
  const float DRAG_MULT = 0.38;
  const float WAVE_MEAN = 0.465;
  const int MAX_WAVE_ITERATIONS = 14;

  vec2 wavedx(vec2 position, vec2 direction, float frequency, float timeshift) {
    float x = dot(direction, position) * frequency + timeshift;
    float wave = exp(sin(x) - 1.0);
    float dx = wave * cos(x);
    return vec2(wave, -dx);
  }

  float getWaveIterationCount(float quality) {
    if (quality < 0.5) {
      return 8.0;
    }
    if (quality < 1.5) {
      return 11.0;
    }
    return 14.0;
  }

  vec3 sampleWaveState(vec2 position, float wavelength, float timeScale, float iterations) {
    float wavePhaseShift = length(position) * 0.08;
    float iter = 0.0;
    float frequency = 6.28318530718 / max(1.0, wavelength);
    float timeMultiplier = timeScale;
    float weight = 1.0;
    float sumOfValues = 0.0;
    float sumOfWeights = 0.0;
    vec2 drag = vec2(0.0);
    for (int i = 0; i < MAX_WAVE_ITERATIONS; i++) {
      if (float(i) >= iterations) {
        break;
      }
      vec2 dir = vec2(sin(iter), cos(iter));
      vec2 res = wavedx(position, dir, frequency, u_time * timeMultiplier + wavePhaseShift);
      drag += dir * res.y * weight;
      position += dir * res.y * weight * DRAG_MULT;
      sumOfValues += res.x * weight;
      sumOfWeights += weight;
      weight = mix(weight, 0.0, 0.2);
      frequency *= 1.18;
      timeMultiplier *= 1.07;
      iter += 1232.399963;
    }
    float centeredWave = sumOfWeights > 0.0 ? sumOfValues / sumOfWeights - WAVE_MEAN : 0.0;
    return vec3(drag * DRAG_MULT, centeredWave);
  }

  vec3 computeAnimatedWave(
    vec2 worldXZ,
    vec2 uvCoord,
    float ocean,
    float coverage,
    float surfAtten,
    float shorelineSdf
  ) {
    float shoreWaveBlend = smoothstep(u_shoreParamsA.x, u_shoreParamsA.z, shorelineSdf);
    float localWaveAmpScale = mix(
      1.0,
      mix(u_shoreWaveShape.x, 1.0, shoreWaveBlend),
      u_shoreWaveShape.z
    );
    float localWaveLengthScale = mix(
      1.0,
      mix(u_shoreWaveShape.y, 1.0, shoreWaveBlend),
      u_shoreWaveShape.z
    );
    float shorePresence = smoothstep(-u_shoreParamsB.y, u_shoreParamsA.y, shorelineSdf);
    float swashWeight = 1.0 - smoothstep(u_shoreParamsA.x, u_shoreParamsA.y, shorelineSdf);
    float shoalWeight =
      smoothstep(u_shoreParamsA.x, u_shoreParamsA.y, shorelineSdf) *
      (1.0 - smoothstep(u_shoreParamsA.y, u_shoreParamsA.z, shorelineSdf));
    float coastWeight = max(swashWeight, shoalWeight);
    float coverageStrength = mix(
      1.0,
      smoothstep(u_shoreParamsB.z, u_shoreParamsB.w, coverage),
      1.0 - shoreWaveBlend
    );
    float openWater = clamp(max(ocean, coverage) * 1.2, 0.0, 1.0);
    float attenuation = clamp(surfAtten, 0.0, 1.0) * (1.0 - shoreWaveBlend);
    vec2 noiseUv = worldXZ * vec2(0.013, 0.011);
    float cellNoiseA = valueNoise21(noiseUv + vec2(0.17, 0.61));
    float cellNoiseB = valueNoise21(noiseUv * 1.13 + vec2(2.91, 1.37));
    float cellNoiseC = valueNoise21(noiseUv * 0.72 + vec2(4.73, 0.29));
    float lenVarianceA = mix(0.09, 0.2, clamp(u_waveVariance, 0.0, 1.0));
    float lenVarianceB = mix(0.12, 0.24, clamp(u_waveVariance, 0.0, 1.0));
    float baseWavelength =
      mix(u_waveFreq.x * (1.0 - lenVarianceA), u_waveFreq.x * (1.0 + lenVarianceA), cellNoiseA) *
      u_shoreTuning.z *
      localWaveLengthScale;
    float detailWavelength =
      mix(u_waveFreq.y * (1.0 - lenVarianceB), u_waveFreq.y * (1.0 + lenVarianceB), cellNoiseB) *
      u_shoreTuning.z *
      localWaveLengthScale;
    float chopWavelength =
      mix(u_waveFreq.x * 0.34, u_waveFreq.y * 0.58, cellNoiseC) *
      u_shoreTuning.z *
      localWaveLengthScale;
    float iterations = getWaveIterationCount(u_quality);
    vec3 broad = sampleWaveState(worldXZ, baseWavelength, 1.0, iterations);
    vec3 detail = sampleWaveState(worldXZ.yx * vec2(-0.86, 1.12) + vec2(19.0, -13.0), detailWavelength, 1.18, max(4.0, iterations - 2.0));
    vec3 chop = sampleWaveState(worldXZ * vec2(1.37, -1.19) + vec2(-31.0, 11.0), chopWavelength, 1.34, max(3.0, iterations - 4.0));
    float waveAmp =
      0.34 *
      u_waveAmp *
      u_shoreTuning.y *
      localWaveAmpScale *
      coverageStrength *
      mix(0.32, 1.0, shorePresence) *
      mix(0.55, 1.0, openWater);
    waveAmp *= 1.0 - attenuation * mix(0.62, 0.28, shoreWaveBlend);
    float shorePulse = computeShorePulse(worldXZ, uvCoord, shorelineSdf);
    float waveHeight = (broad.z * 0.68 + detail.z * 0.22 + chop.z * 0.10) * waveAmp;
    waveHeight += shorePulse * waveAmp * (0.12 + 0.38 * coastWeight);
    float troughFloor = -waveAmp * mix(1.0, 0.2, coastWeight);
    waveHeight = mix(waveHeight, max(waveHeight, troughFloor), u_shoreFeatureMix.z);
    float tide =
      sin(u_time * u_tideFreq + dot(worldXZ, vec2(0.012, -0.01))) *
      u_tideAmp *
      0.12 *
      mix(0.18, 1.0, shorePresence) *
      max(openWater, coverage);
    vec2 drag = (broad.xy * 0.64 + detail.xy * 0.24 + chop.xy * 0.12) * waveAmp * 0.58;
    drag *= mix(1.0, 0.42, attenuation);
    return vec3(drag.x, waveHeight + tide, drag.y);
  }
`;

const shaderAtmosphereFns = `
  vec3 getSunDirection() {
    return normalize(u_lightDir);
  }

  vec3 extraCheapAtmosphere(vec3 raydir, vec3 sundir) {
    float rayY = clamp(raydir.y, -0.22, 1.0);
    float horizonBoost = 1.0 / max(rayY + 0.16, 0.08);
    float sunBoost = 1.0 / max(sundir.y * 11.0 + 1.0, 0.35);
    float raySun = pow(abs(dot(sundir, raydir)), 2.0);
    float sunFocus = pow(max(0.0, dot(sundir, raydir)), 8.0);
    float skyT = clamp(raydir.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 gradient = mix(u_skyHorizonColor, u_skyTopColor, skyT);
    vec3 sky = gradient * horizonBoost * (0.2 + raySun * 0.22);
    sky += u_sunColor * sunFocus * horizonBoost * sunBoost * 0.18;
    return sky * (1.0 + pow(1.0 - clamp(raydir.y, 0.0, 1.0), 3.0));
  }

  vec3 getAtmosphere(vec3 dir) {
    return extraCheapAtmosphere(normalize(dir), getSunDirection()) * 0.48;
  }

  float getSun(vec3 dir) {
    return pow(max(0.0, dot(normalize(dir), getSunDirection())), 720.0) * 14.0;
  }
`;

export const createOceanSurfaceMaterial = (uniforms: OceanUniforms): THREE.ShaderMaterial => {
  return new THREE.ShaderMaterial({
    uniforms: uniforms as never,
    transparent: true,
    depthWrite: true,
    depthTest: true,
    side: THREE.FrontSide,
    vertexShader: `
      precision highp float;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vGeomNormal;
      varying float vDisp;
      varying float vSdf;
      varying float vOcean;
      varying float vCoverage;
      varying float vSurfAtten;
      varying float vShorelineSdf;

      uniform float u_time;
      uniform sampler2D u_domainMap;
      uniform sampler2D u_shoreSdf;
      uniform float u_waveAmp;
      uniform vec2 u_waveFreq;
      uniform float u_waveVariance;
      uniform vec2 u_cellGrid;
      uniform vec2 u_worldStep;
      uniform vec2 u_uvStep;
      uniform float u_tideAmp;
      uniform float u_tideFreq;
      uniform float u_quality;
      uniform vec4 u_shoreParamsA;
      uniform vec4 u_shoreParamsB;
      uniform vec4 u_shoreFeatureMix;
      uniform vec4 u_shoreTuning;
      uniform vec4 u_shoreWaveShape;

      ${shaderNoiseFns}
      ${shaderShoreFns}
      ${shaderWaveFns}

      vec3 computeSurfacePosition(
        vec3 p,
        vec2 uvCoord,
        out float ocean,
        out float coverage,
        out float sdf,
        out float surfAtten,
        out float shorelineSdf
      ) {
        vec2 worldXZ = (modelMatrix * vec4(p, 1.0)).xz;
        vec4 domain = texture2D(u_domainMap, uvCoord);
        ocean = domain.r;
        coverage = domain.b;
        surfAtten = domain.a;
        sdf = texture2D(u_shoreSdf, uvCoord).r * 2.0 - 1.0;
        float positiveSdf = max(0.0, sdf);
        shorelineSdf = max(0.0, positiveSdf - computeOrganicShoreInset(worldXZ, positiveSdf));
        vec3 animated = computeAnimatedWave(worldXZ, uvCoord, ocean, coverage, surfAtten, shorelineSdf);
        return p + animated;
      }

      void main() {
        vUv = uv;

        float ocean;
        float coverage;
        float sdf;
        float surfAtten;
        float shorelineSdf;
        vec3 displaced = computeSurfacePosition(position, vUv, ocean, coverage, sdf, surfAtten, shorelineSdf);

        float oceanX;
        float coverageX;
        float sdfX;
        float surfAttenX;
        float shorelineSdfX;
        vec3 displacedX = computeSurfacePosition(
          position + vec3(u_worldStep.x, 0.0, 0.0),
          vUv + vec2(u_uvStep.x, 0.0),
          oceanX,
          coverageX,
          sdfX,
          surfAttenX,
          shorelineSdfX
        );

        float oceanZ;
        float coverageZ;
        float sdfZ;
        float surfAttenZ;
        float shorelineSdfZ;
        vec3 displacedZ = computeSurfacePosition(
          position + vec3(0.0, 0.0, u_worldStep.y),
          vUv + vec2(0.0, u_uvStep.y),
          oceanZ,
          coverageZ,
          sdfZ,
          surfAttenZ,
          shorelineSdfZ
        );

        vec3 tangentX = displacedX - displaced;
        vec3 tangentZ = displacedZ - displaced;
        vec3 geomNormalLocal = cross(tangentZ, tangentX);
        if (length(geomNormalLocal) < 1e-4) {
          geomNormalLocal = vec3(0.0, 1.0, 0.0);
        }
        geomNormalLocal = normalize(geomNormalLocal);

        vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
        vWorldPos = worldPos.xyz;
        vGeomNormal = normalize(mat3(modelMatrix) * geomNormalLocal);
        vDisp = displaced.y - position.y;
        vSdf = sdf;
        vOcean = ocean;
        vCoverage = coverage;
        vSurfAtten = surfAtten;
        vShorelineSdf = shorelineSdf;
        gl_Position = projectionMatrix * viewMatrix * worldPos;
      }
    `,
    fragmentShader: `
      precision highp float;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vGeomNormal;
      varying float vDisp;
      varying float vSdf;
      varying float vOcean;
      varying float vCoverage;
      varying float vSurfAtten;
      varying float vShorelineSdf;

      uniform sampler2D u_mask;
      uniform sampler2D u_supportMap;
      uniform sampler2D u_domainMap;
      uniform sampler2D u_shoreSdf;
      uniform sampler2D u_shoreTransitionMap;
      uniform vec3 u_color;
      uniform vec3 u_deepColor;
      uniform float u_opacity;
      uniform float u_time;
      uniform float u_waveScale;
      uniform float u_waveVariance;
      uniform float u_normalScale;
      uniform float u_normalStrength;
      uniform vec2 u_uvStep;
      uniform float u_shininess;
      uniform vec3 u_lightDir;
      uniform float u_specular;
      uniform vec3 u_skyTopColor;
      uniform vec3 u_skyHorizonColor;
      uniform vec3 u_sunColor;
      uniform vec3 u_fogColor;
      uniform float u_fogNear;
      uniform float u_fogFar;
      uniform sampler2D u_normalMap1;
      uniform sampler2D u_normalMap2;
      uniform vec2 u_scroll1;
      uniform vec2 u_scroll2;
      uniform vec2 u_waveFreq;
      uniform float u_quality;
      uniform vec4 u_shoreParamsA;
      uniform vec4 u_shoreParamsB;
      uniform vec4 u_shoreFeatureMix;
      uniform vec4 u_shoreTuning;
      uniform vec4 u_shoreWaveShape;

      ${shaderNoiseFns}
      ${shaderShoreFns}
      ${shaderAtmosphereFns}

      void main() {
        float support = texture2D(u_supportMap, vUv).r;
        float mask = texture2D(u_mask, vUv).a;
        float shorelineSdf = max(0.0, vShorelineSdf);
        vec4 domain = texture2D(u_domainMap, vUv);
        vec4 shoreTransition = texture2D(u_shoreTransitionMap, vUv);
        float domainWater = max(vCoverage, domain.b);
        float shoreTerrainHeight = domain.g * 10.0;
        float transitionWaterSide = shoreTransition.r;
        float transitionLandSide = shoreTransition.g;
        float transitionOverlap = shoreTransition.b * (1.0 - smoothstep(0.10, 0.45, shoreTerrainHeight));
        float landwardCoastMask = transitionLandSide * transitionOverlap;
        float seawardCoastMask = transitionWaterSide;
        float staticCoastMask = max(seawardCoastMask, landwardCoastMask);
        float shoreWaveBlend = smoothstep(u_shoreParamsA.x, u_shoreParamsA.z, shorelineSdf);
        float localWaveAmpScale = mix(
          1.0,
          mix(u_shoreWaveShape.x, 1.0, shoreWaveBlend),
          u_shoreWaveShape.z
        );
        float localWaveLengthScale = mix(
          1.0,
          mix(u_shoreWaveShape.y, 1.0, shoreWaveBlend),
          u_shoreWaveShape.z
        );
        float shoreWaveMod = (1.0 - shoreWaveBlend) * u_shoreWaveShape.z;
        float shoreWaveSuppression = max(0.0, 1.0 - localWaveAmpScale) * shoreWaveMod;
        float shoreWaveCompression = max(0.0, 1.0 - localWaveLengthScale) * shoreWaveMod;
        float shorePresence = smoothstep(-u_shoreParamsB.y, u_shoreParamsA.y, shorelineSdf);
        float shoalBlend = smoothstep(u_shoreParamsA.y, u_shoreParamsA.z, shorelineSdf);
        float swashWeight = 1.0 - smoothstep(u_shoreParamsA.x, u_shoreParamsA.y, shorelineSdf);
        float shoalWeight =
          smoothstep(u_shoreParamsA.x, u_shoreParamsA.y, shorelineSdf) *
          (1.0 - smoothstep(u_shoreParamsA.y, u_shoreParamsA.z, shorelineSdf));
        float surfWeight = max(swashWeight, shoalWeight);
        float swashCoverage = smoothstep(u_shoreParamsB.z, u_shoreParamsB.w, max(domainWater, seawardCoastMask * 0.45));
        float coverageStrength = mix(
          1.0,
          swashCoverage,
          clamp(swashWeight * 0.92 + shoreWaveSuppression * 0.24, 0.0, 1.0)
        );
        float shoreImpact = shoalWeight * 0.76 + swashWeight;
        float shoreLappingA = sin(u_time * 1.55 + dot(vWorldPos.xz, vec2(0.48, 0.29)));
        float shoreLappingB = sin(u_time * 2.2 - dot(vWorldPos.xz, vec2(0.31, -0.57)));
        float shoreLapping = smoothstep(0.14, 0.96, shoreLappingA * 0.28 + shoreLappingB * 0.22 + 0.5);
        float breakerCrest =
          smoothstep(0.008, 0.05, max(0.0, vDisp)) *
          mix(0.45, 1.0, clamp(shoreImpact + shorePresence * 0.22, 0.0, 1.0));
        float shorePulse = max(breakerCrest, shoreLapping * (0.12 + swashWeight * 0.1)) * staticCoastMask;
        float swashBand = 1.0 - smoothstep(0.0, u_shoreParamsA.y + u_shoreParamsB.y, shorelineSdf);
        float shoreMotionMask = max(
          seawardCoastMask * mix(0.4, 1.0, surfWeight),
          landwardCoastMask * swashBand * mix(0.62, 1.0, shoreLapping)
        );
        float coastalMask = max(staticCoastMask, shoreMotionMask);
        float swashAdvance =
          (0.012 + 0.026 * breakerCrest + 0.014 * shoreLapping) *
          u_shoreParamsB.x *
          clamp(
            0.12 + swashWeight * 0.46 + shoalWeight * 0.18 + clamp(vSurfAtten, 0.0, 1.0) * 0.06,
            0.0,
            1.0
          ) *
          shoreMotionMask *
          u_shoreFeatureMix.w;
        float shorelineAdvance = swashAdvance;
        float shoreRenderSdf = shorelineSdf - shorelineAdvance;
        float renderShoreClip = smoothstep(-u_shoreParamsB.y, u_shoreParamsA.y, shoreRenderSdf);
        renderShoreClip *= max(
          coastalMask,
          smoothstep(u_shoreParamsA.x, u_shoreParamsA.z, shorelineSdf)
        );
        float effectiveCoverage = max(
          max(domainWater, seawardCoastMask * 0.24),
          domainWater * swashCoverage
        );
        float swashCoverBand = max(
          swashWeight + shoalWeight * 0.28,
          max(seawardCoastMask * 0.42, landwardCoastMask * 0.74)
        );
        float swashSheet = landwardCoastMask * (0.04 + 0.12 * shoreLapping + 0.08 * breakerCrest) * u_shoreTuning.x;
        float shorelineCover = clamp((0.12 + shorelineAdvance * 1.8) * shoreMotionMask, 0.0, 1.0);
        float coverage = max(max(effectiveCoverage, swashSheet * 1.02), shorelineCover);
        if (
          (support < 0.5 && landwardCoastMask < 0.02 && swashSheet < 0.02 && vSdf <= 0.0) ||
          renderShoreClip < 0.004 ||
          ((swashWeight > 1e-3 || landwardCoastMask > 1e-3) && coverage < max(0.012, u_shoreParamsB.z * 0.08)) ||
          coverage < 0.01
        ) {
          discard;
        }

        float shoreFade = smoothstep(-u_shoreParamsB.y * 0.4, u_shoreParamsA.z, shoreRenderSdf);
        float shorelineFilm = shorelineCover * mix(0.08, 0.18, min(1.0, shoreImpact + breakerCrest * 0.22));
        float alpha =
          u_opacity *
          max(
            max(
              renderShoreClip *
                max(
                  mask * mix(0.54, 1.0, shoreFade),
                  max(domainWater, seawardCoastMask * 0.42) * mix(0.48, 1.0, shoalBlend)
                ),
              shorelineFilm
            ),
            swashSheet * mix(0.38, 0.56, shoreImpact)
          );
        alpha *= max(max(coverageStrength, swashSheet * 1.12), shorelineCover);
        alpha *= 1.0 - seawardCoastMask * 0.08;
        if (alpha < 0.01) {
          discard;
        }

        vec3 geomN = normalize(vGeomNormal);
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float viewDist = length(cameraPosition - vWorldPos);
        float farT = smoothstep(70.0, 240.0, viewDist);
        vec2 worldUv = vWorldPos.xz * u_waveScale;
        vec2 uv1 = worldUv * 3.2 + u_scroll1 * (u_time * 0.92);
        vec2 uv2 = worldUv * 5.0 + u_scroll2 * (u_time * 1.16);
        vec2 uvFar1 = worldUv * 0.7 + u_scroll1 * (u_time * 0.36);
        vec2 uvFar2 = worldUv * 0.92 + u_scroll2 * (u_time * 0.44);
        vec2 nearXY =
          texture2D(u_normalMap1, uv1).xy * 2.0 - 1.0 +
          (texture2D(u_normalMap2, uv2).xy * 2.0 - 1.0) * 0.55;
        vec2 farXY =
          texture2D(u_normalMap1, uvFar1).xy * 2.0 - 1.0 +
          (texture2D(u_normalMap2, uvFar2).xy * 2.0 - 1.0) * 0.35;
        vec2 nXY = mix(nearXY, farXY, farT * 0.82);
        float grazing = 1.0 - clamp(abs(viewDir.y), 0.0, 1.0);
        float normalScale =
          u_normalScale *
          (0.95 + 0.22 * grazing) *
          (1.0 + 0.18 * max(vOcean, coverage));
        vec3 normalMapN = normalize(vec3(
          nXY.x * normalScale * u_normalStrength,
          1.0,
          nXY.y * normalScale * u_normalStrength
        ));
        vec3 n = normalize(mix(geomN, normalMapN, clamp(0.22 + 0.14 * max(vOcean, coverage), 0.2, 0.4)));

        vec3 lightDir = normalize(u_lightDir);
        float diffuse = max(dot(n, lightDir), 0.0);
        vec3 halfDir = normalize(lightDir + viewDir);
        float specBase = pow(max(dot(n, halfDir), 0.0), max(1.0, u_shininess));
        float fresnel = 0.04 + 0.96 * pow(1.0 - max(dot(viewDir, n), 0.0), 5.0);

        vec3 reflectDir = normalize(reflect(-viewDir, n));
        reflectDir.y = abs(reflectDir.y);
        vec3 reflection = getAtmosphere(reflectDir) + u_sunColor * getSun(reflectDir);

        float shoreTransitionTint = clamp(seawardCoastMask * 0.92 + landwardCoastMask * 0.14, 0.0, 1.0);
        float shoreDepth = clamp(pow(max(shoreRenderSdf, 0.0), 0.62) * 1.8, 0.0, 1.0);
        float depthMix = clamp(shoreDepth * (0.55 + 0.45 * vOcean), 0.0, 1.0);
        depthMix = mix(depthMix, depthMix * 0.28, shoreTransitionTint);
        vec3 shoreWaterTint = mix(u_color * vec3(1.1, 1.08, 0.98), vec3(0.46, 0.62, 0.60), 0.18);
        vec3 waterColor = mix(u_color, u_deepColor, depthMix);
        waterColor = mix(waterColor, shoreWaterTint, shoreTransitionTint * 0.72);
        float subsurface = max(dot(-lightDir, n) * 0.5 + 0.5, 0.0);
        vec3 scattering =
          waterColor * (0.16 + 0.22 * subsurface) +
          waterColor * (0.08 + 0.18 * (1.0 - n.y)) * (0.3 + 0.7 * vOcean);

        float crestFoam = smoothstep(0.03, 0.16, max(0.0, vDisp)) * (0.3 + 0.7 * (1.0 - geomN.y));
        float foamWidth = mix(0.06, 0.13, clamp(vSurfAtten * 0.85 + shoreImpact * 0.4, 0.0, 1.0));
        float foamBand = 1.0 - smoothstep(-u_shoreParamsB.y * 0.18, foamWidth, shoreRenderSdf);
        float shoreFoam =
          foamBand *
          (0.025 + shoreLapping * 0.04 + breakerCrest * 0.08) *
          (0.84 + shoreImpact * 0.1) *
          max(seawardCoastMask * 0.72, landwardCoastMask * 0.52);
        float foam = (shoreFoam + crestFoam * mix(0.04, 0.12, shoreImpact)) * u_shoreTuning.w;
        vec3 foamColor = mix(vec3(0.96, 0.98, 1.0), u_sunColor, 0.08);
        vec3 litWater = mix(scattering, foamColor, clamp(foam, 0.0, 1.0) * mix(0.12, 0.28, shoreImpact));

        float skyFill = 0.08 + 0.08 * grazing;
        float glitter =
          pow(max(dot(reflectDir, lightDir), 0.0), mix(240.0, 120.0, grazing)) *
          (0.08 + 0.42 * vOcean);
        float specular = specBase * u_specular * (0.18 + 0.82 * fresnel);
        vec3 color =
          litWater * (0.82 + diffuse * 0.18) +
          getAtmosphere(vec3(0.0, max(viewDir.y, 0.0) + 0.001, 1.0)) * skyFill +
          reflection * fresnel +
          u_sunColor * (glitter + specular);

        color *= 1.45;
        float fogFactor = pow(
          smoothstep(u_fogNear * 1.3, u_fogFar * 1.9, viewDist),
          1.35
        ) * 0.38;
        color = mix(color, u_fogColor, fogFactor);
        alpha = clamp(mix(alpha, 1.0, fogFactor * 0.08), 0.0, 1.0);
        gl_FragColor = vec4(color, alpha);
      }
    `
  });
};
