import {
  MDXYZX_MAX_RAYMARCH_STEPS,
  MDXYZX_NORMAL_WAVE_ITERATIONS,
  MDXYZX_RAYMARCH_WAVE_ITERATIONS,
  mdXyzxWaveCoreShader
} from "./mdXyzxWaveCoreShader.js";

export {
  MDXYZX_MAX_RAYMARCH_STEPS,
  MDXYZX_NORMAL_WAVE_ITERATIONS,
  MDXYZX_RAYMARCH_WAVE_ITERATIONS
} from "./mdXyzxWaveCoreShader.js";

export type MdXyzxReferenceMode = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

export const MDXYZX_REFERENCE_MODES: ReadonlyArray<Readonly<{
  value: MdXyzxReferenceMode;
  label: string;
}>> = [
  { value: 0, label: "Current Game Ocean" },
  { value: 1, label: "Direct MdXyzX Reference" },
  { value: 2, label: "Split: Reference / Game" },
  { value: 3, label: "Procedural Height" },
  { value: 4, label: "Raymarched Hit Distance" },
  { value: 5, label: "Raymarch Iteration Count" },
  { value: 6, label: "Calculated Normal" },
  { value: 7, label: "Fresnel Contribution" }
] as const;

export const normalizeMdXyzxReferenceMode = (value: number): MdXyzxReferenceMode =>
  Math.max(0, Math.min(7, Math.round(value))) as MdXyzxReferenceMode;

// Isolated visual oracle for the shared MdXyzX core. Keeping this full-screen
// path independent lets FX Lab compare production changes against the approved
// reference architecture without involving campaign coverage or coast masks.
export const mdXyzxReferenceFragmentShader = `
  precision highp float;

  varying vec2 vScreenUv;

  uniform sampler2D u_gameTexture;
  uniform float u_time;
  uniform float u_mode;
  uniform float u_waterLevel;
  uniform float u_waterDepth;
  uniform vec3 u_cameraPosition;
  uniform vec3 u_sunDirection;
  uniform mat4 u_projectionInverse;
  uniform mat4 u_cameraWorldMatrix;

  ${mdXyzxWaveCoreShader}

  vec3 mdXyzxAtmosphere(vec3 rayDirection) {
    vec3 sunDirection = normalize(u_sunDirection);
    sunDirection.y = max(sunDirection.y, -0.07);
    float horizonGain = 1.0 / (rayDirection.y + 0.1);
    float sunHeightGain = 1.0 / (sunDirection.y * 11.0 + 1.0);
    float raySun = pow(abs(dot(sunDirection, rayDirection)), 2.0);
    float sunFocus = pow(max(0.0, dot(sunDirection, rayDirection)), 8.0);
    vec3 sunColor = sunFocus * horizonGain * 0.2 * vec3(1.0, 0.5, 0.0);
    vec3 blueSky =
      vec3(0.5, 0.7, 1.0) *
      (1.0 + sunHeightGain * 0.5) *
      horizonGain *
      (0.5 + raySun * 0.2);
    return (blueSky + sunColor) * 0.5;
  }

  float mdXyzxSun(vec3 rayDirection) {
    return pow(max(0.0, dot(rayDirection, normalize(u_sunDirection))), 528.0) * 110.0;
  }

  vec3 mdXyzxAcesTonemap(vec3 color) {
    vec3 numerator = color * (2.51 * color + 0.03);
    vec3 denominator = color * (2.43 * color + 0.59) + 0.14;
    return clamp(numerator / denominator, 0.0, 1.0);
  }

  vec3 mdXyzxCameraRay(vec2 screenUv) {
    vec2 ndc = screenUv * 2.0 - 1.0;
    vec4 viewPosition = u_projectionInverse * vec4(ndc, 1.0, 1.0);
    vec3 viewDirection = normalize(viewPosition.xyz / max(0.0001, abs(viewPosition.w)));
    return normalize((u_cameraWorldMatrix * vec4(viewDirection, 0.0)).xyz);
  }

  vec3 mdXyzxDebugHeat(float value) {
    return clamp(vec3(value * 1.8, 1.0 - abs(value * 2.0 - 1.0), 1.3 - value * 1.6), 0.0, 1.0);
  }

  vec3 mdXyzxRenderReference(vec2 screenUv) {
    vec3 rayDirection = mdXyzxCameraRay(screenUv);
    if (rayDirection.y >= -0.00001) {
      return u_mode >= 3.0 ? vec3(0.0) : mdXyzxAtmosphere(rayDirection) + mdXyzxSun(rayDirection);
    }

    float upperDistance = mdXyzxIntersectWaterPlane(u_cameraPosition, rayDirection, u_waterLevel);
    float lowerDistance = mdXyzxIntersectWaterPlane(
      u_cameraPosition,
      rayDirection,
      u_waterLevel - u_waterDepth
    );
    if (upperDistance <= 0.0 || lowerDistance <= upperDistance) {
      return u_mode >= 3.0 ? vec3(0.0) : mdXyzxAtmosphere(rayDirection);
    }

    vec3 upperPlaneHit = u_cameraPosition + rayDirection * upperDistance;
    vec3 lowerPlaneHit = u_cameraPosition + rayDirection * lowerDistance;
    float raymarchSteps;
    float raymarchConverged;
    float hitDistance = mdXyzxRaymarchWater(
      u_cameraPosition,
      upperPlaneHit,
      lowerPlaneHit,
      u_waterLevel,
      u_waterDepth,
      MDXYZX_RAYMARCH_WAVE_ITERATIONS,
      float(MDXYZX_MAX_RAYMARCH_STEPS),
      raymarchSteps,
      raymarchConverged
    );
    vec3 waterHitPosition = u_cameraPosition + rayDirection * hitDistance;
    float normalEpsilon = 0.01;
    vec3 waterNormal = mdXyzxCalculateNormal(
      waterHitPosition.xz,
      normalEpsilon,
      u_waterDepth,
      MDXYZX_NORMAL_WAVE_ITERATIONS
    );
    float distanceSmoothing = min(1.0, sqrt(max(0.0, hitDistance) * 0.01) * 1.1);
    waterNormal = normalize(mix(waterNormal, vec3(0.0, 1.0, 0.0), distanceSmoothing));
    float fresnel = 0.04 + 0.96 * pow(1.0 - max(0.0, dot(-rayDirection, waterNormal)), 5.0);

    if (u_mode > 2.5 && u_mode < 3.5) {
      return vec3(mdXyzxGetWaves(waterHitPosition.xz, MDXYZX_RAYMARCH_WAVE_ITERATIONS));
    }
    if (u_mode < 4.5 && u_mode > 3.5) {
      return mdXyzxDebugHeat(1.0 - exp(-hitDistance * 0.025));
    }
    if (u_mode < 5.5 && u_mode > 4.5) {
      return mdXyzxDebugHeat(raymarchSteps / float(MDXYZX_MAX_RAYMARCH_STEPS));
    }
    if (u_mode < 6.5 && u_mode > 5.5) {
      return waterNormal * 0.5 + 0.5;
    }
    if (u_mode > 6.5) {
      return vec3(fresnel);
    }

    vec3 reflectionDirection = normalize(reflect(rayDirection, waterNormal));
    reflectionDirection.y = abs(reflectionDirection.y);
    vec3 reflection = mdXyzxAtmosphere(reflectionDirection) +
      vec3(1.0, 0.92, 0.78) * mdXyzxSun(reflectionDirection);
    float relativeHeight = clamp(
      (waterHitPosition.y - (u_waterLevel - u_waterDepth)) / max(0.001, u_waterDepth),
      0.0,
      1.0
    );
    vec3 scattering = vec3(0.0293, 0.0698, 0.1717) * (0.2 + relativeHeight * 0.8);
    return reflection * fresnel + scattering * (1.0 - fresnel);
  }

  void main() {
    vec2 referenceUv = u_mode > 1.5 && u_mode < 2.5
      ? vec2(vScreenUv.x * 2.0, vScreenUv.y)
      : vScreenUv;
    vec3 color;
    if (u_mode > 1.5 && u_mode < 2.5 && vScreenUv.x >= 0.5) {
      vec2 gameUv = vec2((vScreenUv.x - 0.5) * 2.0, vScreenUv.y);
      color = texture2D(u_gameTexture, gameUv).rgb;
    } else {
      vec3 referenceColor = mdXyzxRenderReference(referenceUv);
      color = u_mode > 2.5 ? clamp(referenceColor, 0.0, 1.0) : mdXyzxAcesTonemap(referenceColor);
    }
    if (u_mode > 1.5 && u_mode < 2.5 && abs(vScreenUv.x - 0.5) < 0.0015) {
      color = vec3(1.0);
    }
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;

export const mdXyzxReferenceVertexShader = `
  precision highp float;
  varying vec2 vScreenUv;

  void main() {
    vScreenUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;
