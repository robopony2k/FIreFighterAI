export const GRASS_PCG_MARCH_STEPS = 64;

export const grassPcgBladeVertexShader = `
  out vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/*
 * Alternate FX Lab grass renderer adapted from the user-supplied PCG-hashed
 * implicit grass study. The original 800-step synthetic scene is bounded to
 * the real terrain field, scene depth, gameplay wind, and a 64-step ceiling.
 */
export const grassPcgBladeFragmentShader = `
  precision highp float;
  precision highp int;

  #define PCG_GRASS_MARCH_STEPS ${GRASS_PCG_MARCH_STEPS}

  uniform sampler2D uSceneDepth;
  uniform sampler2D uTerrainField;
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
  uniform float uDebugView;
  in vec2 vUv;
  out vec4 outColour;

  uint pcg_hash(uint x) {
    x = x * 747796405u + 2891336453u;
    x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
    x = (x >> 22u) ^ x;
    return x;
  }

  float hash21(vec2 p) {
    uvec2 q = uvec2(ivec2(floor(p)));
    uint n = q.x * 1664525u + q.y * 1013904223u;
    return float(pcg_hash(n)) * (1.0 / 4294967295.0);
  }

  float hash31(vec3 p) {
    uvec3 q = uvec3(ivec3(floor(p)));
    uint n = q.x * 1664525u + q.y * 1013904223u + q.z * 69069u;
    return float(pcg_hash(n)) * (1.0 / 4294967295.0);
  }

  float valueNoise(vec2 p) {
    vec2 point = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash21(point);
    float b = hash21(point + vec2(1.0, 0.0));
    float c = hash21(point + vec2(0.0, 1.0));
    float d = hash21(point + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  vec2 worldToUv(vec2 worldXZ) {
    return worldXZ / uWorldSize + 0.5;
  }

  float decodeHeight(vec4 packed) {
    float highByte = floor(packed.r * 255.0 + 0.5);
    float lowByte = floor(packed.g * 255.0 + 0.5);
    float normalized = (highByte * 256.0 + lowByte) / 65535.0;
    return mix(uHeightRange.x, uHeightRange.y, normalized);
  }

  vec4 sampleFieldCell(vec2 cell) {
    vec2 safeCell = clamp(cell, vec2(0.0), uFieldSize - 1.0);
    return texture(uTerrainField, (safeCell + 0.5) / uFieldSize);
  }

  float sampleTerrainHeight(vec2 uv) {
    vec2 grid = clamp(uv, vec2(0.0), vec2(1.0)) * (uFieldSize - 1.0);
    vec2 cell = floor(grid);
    vec2 f = fract(grid);
    float h00 = decodeHeight(sampleFieldCell(cell));
    float h10 = decodeHeight(sampleFieldCell(cell + vec2(1.0, 0.0)));
    float h01 = decodeHeight(sampleFieldCell(cell + vec2(0.0, 1.0)));
    float h11 = decodeHeight(sampleFieldCell(cell + vec2(1.0, 1.0)));
    return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
  }

  float sampleGrassMask(vec2 uv) {
    vec2 cell = floor(clamp(uv, vec2(0.0), vec2(0.999999)) * uFieldSize);
    return step(0.5, sampleFieldCell(cell).b);
  }

  float sampleGrassDistanceCells(vec2 uv) {
    vec2 cell = floor(clamp(uv, vec2(0.0), vec2(0.999999)) * uFieldSize);
    return floor(sampleFieldCell(cell).a * 255.0 + 0.5);
  }

  vec4 sampleWind(vec2 worldXZ) {
    vec4 encoded = texture(uWindField, worldToUv(worldXZ));
    float response = clamp(uWindResponse, 0.0, 1.0);
    return vec4(
      (encoded.xy * 2.0 - 1.0) * uWindVectorRange * response,
      encoded.zw * response
    );
  }

  vec4 sampleProperties(vec2 worldXZ) {
    vec4 variation = texture(uVariationField, worldToUv(worldXZ));
    float fuelLength = clamp(
      uGrassLength + (variation.r - 0.5) * 0.34 + (variation.g - 0.5) * 0.12,
      0.08,
      0.25
    );
    float dryness = clamp(uDryness + (variation.b - 0.5) * 0.24, 0.0, 1.0);
    float density = clamp(uDensity * mix(0.56, 1.08, variation.a) + fuelLength * 0.08, 0.0, 1.0);
    return vec4(fuelLength, dryness, density, 1.0);
  }

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

  void evaluateBlade(
    vec2 cell,
    vec2 bentXZ,
    float localHeight,
    float canopyHeight,
    float frequency,
    float density,
    inout float closestDistance,
    inout float closestSeed,
    inout vec2 closestOffset
  ) {
    float seed = hash21(cell);
    if (seed > 0.14 + density * 0.84) return;
    vec2 jitter = vec2(fract(seed * 17.17), fract(seed * 41.73)) - 0.5;
    vec2 centre = (cell + 0.5 + jitter * 0.42) / frequency;
    vec2 offset = bentXZ - centre;
    float radius = mix(0.004, 0.009, density) * mix(0.82, 1.18, fract(seed * 29.31));
    float bladeHeight = canopyHeight * mix(0.52, 1.00, fract(seed * 53.17));
    float horizontalDistance = length(offset) - radius;
    float verticalDistance = max(-localHeight, localHeight - bladeHeight);
    float distanceToBlade = max(horizontalDistance, verticalDistance);
    if (distanceToBlade >= closestDistance) return;
    closestDistance = distanceToBlade;
    closestSeed = seed;
    closestOffset = offset;
  }

  float mapGrass(
    vec3 p,
    vec4 properties,
    vec4 wind,
    inout float terrainHeight,
    inout float canopyHeight,
    inout float bladeSeed,
    inout vec2 bladeOffset
  ) {
    vec2 fieldUv = worldToUv(p.xz);
    float mapDistance = 0.04;
    terrainHeight = 0.0;
    canopyHeight = 0.0;
    bladeSeed = 0.5;
    bladeOffset = vec2(0.0);
    if (sampleGrassMask(fieldUv) < 0.5) {
      float emptyCells = max(0.0, sampleGrassDistanceCells(fieldUv) - 1.25);
      mapDistance = max(0.08, emptyCells * uFieldCellWorldSize * 0.55);
    } else {
      terrainHeight = sampleTerrainHeight(fieldUv);
      canopyHeight = mix(0.025, 0.36, properties.x)
        * mix(0.58, 1.0, properties.z)
        * mix(1.0, 0.97, wind.z);
      float localHeight = p.y - terrainHeight;
      if (localHeight > canopyHeight) {
        // The canopy boundary is an entry guide, not a hittable horizontal surface.
        mapDistance = max(0.012, (localHeight - canopyHeight) * 0.72);
      } else if (localHeight < 0.0) {
        mapDistance = max(0.012, -localHeight);
      } else {
        float verticalPosition = clamp(localHeight / max(canopyHeight, 0.001), 0.0, 1.0);
        vec2 bentXZ = p.xz - wind.xy * verticalPosition * verticalPosition * canopyHeight * 0.28;
        float frequency = mix(7.0, 10.0, properties.z);
        vec2 gridPosition = bentXZ * frequency;
        vec2 baseCell = floor(gridPosition);
        vec2 side = mix(vec2(-1.0), vec2(1.0), step(vec2(0.5), fract(gridPosition)));
        float closestDistance = 1000.0;
        evaluateBlade(baseCell, bentXZ, localHeight, canopyHeight, frequency, properties.z, closestDistance, bladeSeed, bladeOffset);
        evaluateBlade(baseCell + vec2(side.x, 0.0), bentXZ, localHeight, canopyHeight, frequency, properties.z, closestDistance, bladeSeed, bladeOffset);
        evaluateBlade(baseCell + vec2(0.0, side.y), bentXZ, localHeight, canopyHeight, frequency, properties.z, closestDistance, bladeSeed, bladeOffset);
        evaluateBlade(baseCell + side, bentXZ, localHeight, canopyHeight, frequency, properties.z, closestDistance, bladeSeed, bladeOffset);
        mapDistance = closestDistance;
      }
    }
    return mapDistance;
  }

  vec3 grassColour(float dryness, float verticalPosition, float variation) {
    vec3 green = mix(vec3(0.025, 0.105, 0.018), vec3(0.170, 0.430, 0.055), verticalPosition);
    vec3 ochre = mix(vec3(0.185, 0.150, 0.025), vec3(0.625, 0.500, 0.090), verticalPosition);
    vec3 straw = mix(vec3(0.255, 0.125, 0.025), vec3(0.920, 0.735, 0.285), verticalPosition);
    vec3 colour = mix(green, ochre, smoothstep(0.18, 0.58, dryness));
    colour = mix(colour, straw, smoothstep(0.55, 0.92, dryness));
    colour *= mix(0.84, 1.12, variation);
    return colour;
  }

  vec3 debugHeat(float value) {
    return clamp(vec3(value * 1.8, 1.0 - abs(value * 2.0 - 1.0), 1.3 - value * 1.6), 0.0, 1.0);
  }

  void main() {
    float sceneDepth = texture(uSceneDepth, vUv).x;
    if (sceneDepth >= 0.999999) {
      outColour = vec4(0.0);
      return;
    }
    vec3 farWorld = reconstructWorld(vUv, 1.0);
    vec3 rayDirection = normalize(farWorld - uCameraPosition);
    vec3 sceneWorld = reconstructWorld(vUv, min(sceneDepth, 0.999999));
    float sceneDistance = sceneDepth < 0.999999
      ? max(0.0, dot(sceneWorld - uCameraPosition, rayDirection))
      : 100000.0;

    if (uDebugView > 0.5 && uDebugView < 2.5 && sceneDepth < 0.999999) {
      vec2 diagnosticUv = worldToUv(sceneWorld.xz);
      float mask = sampleGrassMask(diagnosticUv);
      if (uDebugView < 1.5) {
        outColour = vec4(vec3(mask), 1.0);
        return;
      }
      vec4 properties = sampleProperties(sceneWorld.xz);
      vec4 wind = sampleWind(sceneWorld.xz);
      float canopy = mix(0.025, 0.36, properties.x) * mix(0.58, 1.0, properties.z) * mix(1.0, 0.97, wind.z);
      outColour = vec4(debugHeat(canopy / 0.36) * mask, 1.0);
      return;
    }

    float nearDistance = 0.0;
    float farDistance = 0.0;
    if (!intersectBox(
      uCameraPosition,
      rayDirection,
      vec3(-uWorldSize.x * 0.5, uHeightRange.x - 0.05, -uWorldSize.y * 0.5),
      vec3(uWorldSize.x * 0.5, uHeightRange.y + 0.42, uWorldSize.y * 0.5),
      nearDistance,
      farDistance
    )) {
      outColour = vec4(0.0);
      return;
    }
    nearDistance = max(nearDistance, 0.0);
    farDistance = min(farDistance, sceneDistance);
    if (farDistance <= nearDistance) {
      outColour = vec4(0.0);
      return;
    }

    float lodDistance = sceneDepth < 0.999999 ? sceneDistance : max(nearDistance, 0.1);
    float maximumProjectedHeight = 0.36 * uProjectionScale / max(lodDistance, 0.1);
    if (maximumProjectedHeight < 0.7) {
      outColour = vec4(0.0);
      return;
    }

    float marchDistance = nearDistance;
    float marchedSteps = 0.0;
    bool hit = false;
    vec3 hitPosition = vec3(0.0);
    float hitTerrain = 0.0;
    float hitCanopy = 0.1;
    float hitSeed = 0.5;
    vec2 hitOffset = vec2(0.0);
    vec2 referenceXZ = sceneDepth < 0.999999
      ? sceneWorld.xz
      : (uCameraPosition + rayDirection * farDistance).xz;
    vec4 rayProperties = sampleProperties(referenceXZ);
    vec4 rayWind = sampleWind(referenceXZ);
    for (int stepIndex = 0; stepIndex < PCG_GRASS_MARCH_STEPS; stepIndex++) {
      if (marchDistance >= farDistance) break;
      marchedSteps = float(stepIndex + 1);
      vec3 p = uCameraPosition + rayDirection * marchDistance;
      float terrainHeight = 0.0;
      float canopyHeight = 0.0;
      float bladeSeed = 0.5;
      vec2 bladeOffset = vec2(0.0);
      float distanceToGrass = mapGrass(
        p,
        rayProperties,
        rayWind,
        terrainHeight,
        canopyHeight,
        bladeSeed,
        bladeOffset
      );
      if (distanceToGrass < 0.0025) {
        hit = true;
        hitPosition = p;
        hitTerrain = terrainHeight;
        hitCanopy = canopyHeight;
        hitSeed = bladeSeed;
        hitOffset = bladeOffset;
        break;
      }
      marchDistance += clamp(distanceToGrass * 0.58, 0.003, 0.65);
    }

    if (uDebugView > 3.5) {
      outColour = vec4(0.0);
      return;
    }
    if (uDebugView > 2.5) {
      outColour = vec4(debugHeat(marchedSteps / float(PCG_GRASS_MARCH_STEPS)), 1.0);
      return;
    }
    if (!hit) {
      outColour = vec4(0.0);
      return;
    }

    float verticalPosition = clamp((hitPosition.y - hitTerrain) / max(hitCanopy, 0.001), 0.0, 1.0);
    float projectedHeight = hitCanopy * uProjectionScale / max(marchDistance, 0.1);
    float distanceFade = smoothstep(0.7, 2.2, projectedHeight);
    float cellVariation = fract(hitSeed * 73.19 + hash31(hitPosition * vec3(36.0, 8.0, 36.0)) * 0.35);
    float broadVariation = valueNoise(hitPosition.xz / 7.0);
    vec2 radial = normalize(hitOffset + vec2(0.0001));
    vec3 normal = normalize(vec3(radial.x, 0.24, radial.y));
    float lighting = 0.42 + max(dot(normal, normalize(uSunDirection)), 0.0) * 0.58;
    vec3 colour = grassColour(rayProperties.y, verticalPosition, cellVariation * 0.72 + broadVariation * 0.28);
    colour *= lighting * mix(0.86, 1.10, verticalPosition) * mix(0.98, 1.04, rayWind.z);
    float alpha = mix(0.76, 0.96, rayProperties.z) * distanceFade;
    outColour = vec4(max(colour, vec3(0.0)) * alpha, alpha);
  }
`;
