/*
 * Wave construction adapted from "Very fast procedural ocean" by afl_ext
 * (2017-2024), https://www.shadertoy.com/view/MdXyzX
 *
 * MIT License
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

export const MDXYZX_WAVE_MEAN = 0.465;
export const MDXYZX_RAYMARCH_WAVE_ITERATIONS = 12;
export const MDXYZX_NORMAL_WAVE_ITERATIONS = 36;
export const MDXYZX_MAX_RAYMARCH_STEPS = 96;

export type MdXyzxQualityProfile = Readonly<{
  raymarchWaveIterations: number;
  normalWaveIterations: number;
  maxRaymarchSteps: number;
}>;

export const MDXYZX_QUALITY_PROFILES: Readonly<{
  fast: MdXyzxQualityProfile;
  balanced: MdXyzxQualityProfile;
  high: MdXyzxQualityProfile;
}> = {
  fast: { raymarchWaveIterations: 8, normalWaveIterations: 18, maxRaymarchSteps: 48 },
  balanced: { raymarchWaveIterations: 10, normalWaveIterations: 27, maxRaymarchSteps: 72 },
  high: {
    raymarchWaveIterations: MDXYZX_RAYMARCH_WAVE_ITERATIONS,
    normalWaveIterations: MDXYZX_NORMAL_WAVE_ITERATIONS,
    maxRaymarchSteps: MDXYZX_MAX_RAYMARCH_STEPS
  }
} as const;

// Shared MdXyzX construction. Callers choose only iteration ceilings, water
// scale, and plane placement; the dragged wave sequence itself is unchanged.
export const mdXyzxWaveCoreShader = `
  const float MDXYZX_DRAG_MULT = 0.38;
  const float MDXYZX_WAVE_MEAN = ${MDXYZX_WAVE_MEAN.toFixed(3)};
  const int MDXYZX_RAYMARCH_WAVE_ITERATIONS = ${MDXYZX_RAYMARCH_WAVE_ITERATIONS};
  const int MDXYZX_NORMAL_WAVE_ITERATIONS = ${MDXYZX_NORMAL_WAVE_ITERATIONS};
  const int MDXYZX_MAX_WAVE_ITERATIONS = ${MDXYZX_NORMAL_WAVE_ITERATIONS};
  const int MDXYZX_MAX_RAYMARCH_STEPS = ${MDXYZX_MAX_RAYMARCH_STEPS};

  vec2 mdXyzxWavedx(vec2 position, vec2 direction, float frequency, float timeshift) {
    float x = dot(direction, position) * frequency + timeshift;
    float wave = exp(sin(x) - 1.0);
    float derivative = wave * cos(x);
    return vec2(wave, -derivative);
  }

  float mdXyzxGetWaves(vec2 position, int iterationCount) {
    float wavePhaseShift = length(position) * 0.1;
    float iterationSeed = 0.0;
    float frequency = 1.0;
    float timeMultiplier = 2.0;
    float weight = 1.0;
    float valueSum = 0.0;
    float weightSum = 0.0;

    for (int i = 0; i < MDXYZX_MAX_WAVE_ITERATIONS; i++) {
      if (i >= iterationCount) {
        break;
      }
      vec2 direction = vec2(sin(iterationSeed), cos(iterationSeed));
      vec2 wave = mdXyzxWavedx(
        position,
        direction,
        frequency,
        u_time * timeMultiplier + wavePhaseShift
      );
      position += direction * wave.y * weight * MDXYZX_DRAG_MULT;
      valueSum += wave.x * weight;
      weightSum += weight;
      weight = mix(weight, 0.0, 0.2);
      frequency *= 1.18;
      timeMultiplier *= 1.07;
      iterationSeed += 1232.399963;
    }

    return valueSum / max(weightSum, 0.0001);
  }

  float mdXyzxWaterHeight(
    vec2 position,
    float waterTop,
    float waterDepth,
    int waveIterations
  ) {
    return waterTop + mdXyzxGetWaves(position, waveIterations) * waterDepth - waterDepth;
  }

  float mdXyzxIntersectWaterPlane(vec3 rayOrigin, vec3 rayDirection, float planeHeight) {
    if (abs(rayDirection.y) < 0.00001) {
      return 1000000.0;
    }
    return (planeHeight - rayOrigin.y) / rayDirection.y;
  }

  float mdXyzxRaymarchWater(
    vec3 cameraPosition,
    vec3 upperPlaneHit,
    vec3 lowerPlaneHit,
    float waterTop,
    float waterDepth,
    int waveIterations,
    float maxRaymarchSteps,
    out float stepCount,
    out float converged
  ) {
    vec3 position = upperPlaneHit;
    vec3 rayDirection = normalize(lowerPlaneHit - upperPlaneHit);
    float segmentLength = distance(upperPlaneHit, lowerPlaneHit);
    stepCount = 0.0;
    converged = 0.0;

    for (int i = 0; i < MDXYZX_MAX_RAYMARCH_STEPS; i++) {
      if (float(i) >= maxRaymarchSteps) {
        break;
      }
      float height = mdXyzxWaterHeight(
        position.xz,
        waterTop,
        waterDepth,
        waveIterations
      );
      stepCount = float(i + 1);
      if (height + 0.01 > position.y) {
        converged = 1.0;
        return distance(position, cameraPosition);
      }
      position += rayDirection * max(0.002, position.y - height);
      if (distance(position, upperPlaneHit) > segmentLength + waterDepth) {
        break;
      }
    }

    return distance(lowerPlaneHit, cameraPosition);
  }

  vec3 mdXyzxCalculateNormal(
    vec2 position,
    float epsilon,
    float waterDepth,
    int waveIterations
  ) {
    float centerHeight = mdXyzxGetWaves(position, waveIterations) * waterDepth;
    float xHeight = mdXyzxGetWaves(position - vec2(epsilon, 0.0), waveIterations) * waterDepth;
    float zHeight = mdXyzxGetWaves(position + vec2(0.0, epsilon), waveIterations) * waterDepth;
    return normalize(vec3(xHeight - centerHeight, epsilon, centerHeight - zHeight));
  }
`;
