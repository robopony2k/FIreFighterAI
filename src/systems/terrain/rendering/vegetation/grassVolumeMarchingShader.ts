export const GRASS_VOLUME_MAX_INTEGRATION_STEP = 0.065;
export const GRASS_VOLUME_MIN_SHELL_SAMPLES = 4;
export const GRASS_VOLUME_MIN_TERRAIN_DEPTH_TOLERANCE = 0.02;
export const GRASS_VOLUME_TERRAIN_DEPTH_TOLERANCE_CELLS = 0.08;
export const GRASS_VOLUME_MIN_TERRAIN_CLOSING_RATE = 0.05;
export const GRASS_VOLUME_MARCH_SPAN_PADDING = 1.15;
export const GRASS_VOLUME_MARCH_SPAN_PADDING_CELLS = 0.05;
export const GRASS_VOLUME_MAX_MARCH_SPAN_CELLS = 4;

export const grassVolumeMarchingShader = `
  vec3 reconstructWorld(vec2 uv, float depth) {
    vec4 world = uInverseViewProjection * vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    return world.xyz / max(abs(world.w), 0.00001);
  }

  bool intersectBox(vec3 ro, vec3 rd, vec3 boxMin, vec3 boxMax, out float nearT, out float farT) {
    vec3 safeDirection = vec3(
      abs(rd.x) < 0.00001 ? (rd.x < 0.0 ? -0.00001 : 0.00001) : rd.x,
      abs(rd.y) < 0.00001 ? (rd.y < 0.0 ? -0.00001 : 0.00001) : rd.y,
      abs(rd.z) < 0.00001 ? (rd.z < 0.0 ? -0.00001 : 0.00001) : rd.z
    );
    vec3 inverseDirection = 1.0 / safeDirection;
    vec3 t0 = (boxMin - ro) * inverseDirection;
    vec3 t1 = (boxMax - ro) * inverseDirection;
    vec3 minimumT = min(t0, t1);
    vec3 maximumT = max(t0, t1);
    nearT = max(max(minimumT.x, minimumT.y), minimumT.z);
    farT = min(min(maximumT.x, maximumT.y), maximumT.z);
    return farT >= max(nearT, 0.0);
  }

  float terrainDepthTolerance() {
    return max(
      ${GRASS_VOLUME_MIN_TERRAIN_DEPTH_TOLERANCE.toFixed(2)},
      uFieldCellWorldSize * ${GRASS_VOLUME_TERRAIN_DEPTH_TOLERANCE_CELLS.toFixed(2)}
    );
  }

  vec2 sampleTerrainGradient(vec2 uv) {
    vec2 uvStep = 1.0 / max(uFieldSize - 1.0, vec2(1.0));
    vec2 worldStep = uWorldSize / max(uFieldSize - 1.0, vec2(1.0));
    float heightLeft = sampleTerrainHeight(uv - vec2(uvStep.x, 0.0));
    float heightRight = sampleTerrainHeight(uv + vec2(uvStep.x, 0.0));
    float heightDown = sampleTerrainHeight(uv - vec2(0.0, uvStep.y));
    float heightUp = sampleTerrainHeight(uv + vec2(0.0, uvStep.y));
    return vec2(
      (heightRight - heightLeft) / max(worldStep.x * 2.0, 0.0001),
      (heightUp - heightDown) / max(worldStep.y * 2.0, 0.0001)
    );
  }

  float terrainClosingRate(vec3 rayDirection, vec2 terrainGradient) {
    float closingRate = dot(terrainGradient, rayDirection.xz) - rayDirection.y;
    return max(closingRate, ${GRASS_VOLUME_MIN_TERRAIN_CLOSING_RATE.toFixed(2)});
  }

  float terrainAnchoredMarchSpan(float canopyHeight, float closingRate) {
    float canopyPathLength = canopyHeight / max(closingRate, ${GRASS_VOLUME_MIN_TERRAIN_CLOSING_RATE.toFixed(2)});
    float paddedSpan =
      canopyPathLength * ${GRASS_VOLUME_MARCH_SPAN_PADDING.toFixed(2)}
      + uFieldCellWorldSize * ${GRASS_VOLUME_MARCH_SPAN_PADDING_CELLS.toFixed(2)};
    return min(paddedSpan, uFieldCellWorldSize * ${GRASS_VOLUME_MAX_MARCH_SPAN_CELLS.toFixed(1)});
  }

  float adaptiveMarchStepCount(float marchSpan, float stepCeiling) {
    float requiredSteps = ceil(marchSpan / ${GRASS_VOLUME_MAX_INTEGRATION_STEP.toFixed(3)});
    return clamp(
      requiredSteps,
      ${GRASS_VOLUME_MIN_SHELL_SAMPLES.toFixed(1)},
      stepCeiling
    );
  }
`;
