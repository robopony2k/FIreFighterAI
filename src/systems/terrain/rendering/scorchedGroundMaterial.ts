import * as THREE from "three";

export type ScorchedGroundMaskTextureOptions = {
  sampleTypes: Uint8Array;
  sampleCols: number;
  sampleRows: number;
  cols?: number;
  rows?: number;
  step?: number;
  tileFire?: Float32Array;
  fireThreshold?: number;
  ashTypeId: number;
  protectedTypeIds?: readonly number[];
};

export type ScorchedGroundMaterialOptions = {
  maskTexture: THREE.Texture | null | undefined;
  enabled?: boolean;
  seed?: number;
  tileWorldSize?: number;
  originX?: number;
  originZ?: number;
  sampleCols?: number;
  sampleRows?: number;
};

const PROGRAM_KEY_SUFFIX = "|scorchedGround:v2";

const isMeshStandardMaterial = (
  material: THREE.Material
): material is THREE.MeshStandardMaterial & { userData: Record<string, unknown> } => {
  return material instanceof THREE.MeshStandardMaterial;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const DEFAULT_FIRE_FRONT_THRESHOLD = 0.04;

const createMaskTexture = (data: Uint8Array, sampleCols: number, sampleRows: number): THREE.DataTexture => {
  const flipped = new Uint8Array(data.length);
  const rowStride = sampleCols * 4;
  for (let y = 0; y < sampleRows; y += 1) {
    const src = y * rowStride;
    const dst = (sampleRows - 1 - y) * rowStride;
    flipped.set(data.subarray(src, src + rowStride), dst);
  }
  const texture = new THREE.DataTexture(flipped, sampleCols, sampleRows, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  return texture;
};

export const buildScorchedGroundMaskTexture = (
  options: ScorchedGroundMaskTextureOptions
): THREE.DataTexture | null => {
  const sampleCols = Math.floor(options.sampleCols);
  const sampleRows = Math.floor(options.sampleRows);
  if (sampleCols <= 0 || sampleRows <= 0 || options.sampleTypes.length < sampleCols * sampleRows) {
    return null;
  }

  const protectedTypes = new Set(options.protectedTypeIds ?? []);
  const cols = Math.max(0, Math.floor(options.cols ?? 0));
  const rows = Math.max(0, Math.floor(options.rows ?? 0));
  const step = Math.max(1, Math.floor(options.step ?? 1));
  const tileFire = options.tileFire;
  const fireThreshold = clamp(options.fireThreshold ?? DEFAULT_FIRE_FRONT_THRESHOLD, 0, 1);
  const data = new Uint8Array(sampleCols * sampleRows * 4);
  let hasPaintSource = false;
  const isAshAt = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= sampleCols || y >= sampleRows) {
      return false;
    }
    return options.sampleTypes[y * sampleCols + x] === options.ashTypeId;
  };
  const activeFireAt = (x: number, y: number): number => {
    if (!tileFire || cols <= 0 || rows <= 0 || x < 0 || y < 0 || x >= sampleCols || y >= sampleRows) {
      return 0;
    }
    const startX = Math.min(cols - 1, x * step);
    const startY = Math.min(rows - 1, y * step);
    const endX = Math.min(cols, startX + step);
    const endY = Math.min(rows, startY + step);
    let fire = 0;
    for (let tileY = startY; tileY < endY; tileY += 1) {
      const rowBase = tileY * cols;
      for (let tileX = startX; tileX < endX; tileX += 1) {
        fire = Math.max(fire, tileFire[rowBase + tileX] ?? 0);
      }
    }
    return clamp(fire, 0, 1);
  };
  const isProtectedAt = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= sampleCols || y >= sampleRows) {
      return false;
    }
    const typeId = options.sampleTypes[y * sampleCols + x] ?? -1;
    return typeId !== options.ashTypeId && protectedTypes.has(typeId);
  };
  const isFrontAt = (x: number, y: number): boolean => {
    if (isProtectedAt(x, y)) {
      return false;
    }
    return isAshAt(x, y) || activeFireAt(x, y) >= fireThreshold;
  };

  for (let y = 0; y < sampleRows; y += 1) {
    for (let x = 0; x < sampleCols; x += 1) {
      const idx = y * sampleCols + x;
      const typeId = options.sampleTypes[idx] ?? -1;
      const isAsh = typeId === options.ashTypeId;
      const protectedTerrain = !isAsh && protectedTypes.has(typeId);
      const activeFire = protectedTerrain ? 0 : activeFireAt(x, y);
      const isFront = !protectedTerrain && (isAsh || activeFire >= fireThreshold);
      hasPaintSource ||= isFront;
      let frontNeighborCount = 0;
      let weightedFrontNeighbors = 0;
      let totalWeight = 0;

      for (let oy = -1; oy <= 1; oy += 1) {
        for (let ox = -1; ox <= 1; ox += 1) {
          if (ox === 0 && oy === 0) {
            continue;
          }
          const diagonal = ox !== 0 && oy !== 0;
          const weight = diagonal ? 0.7 : 1;
          totalWeight += weight;
          if (isFrontAt(x + ox, y + oy)) {
            frontNeighborCount += 1;
            weightedFrontNeighbors += weight;
          }
        }
      }

      const neighborCoverage = isAsh && frontNeighborCount === 8
        ? 1
        : clamp(weightedFrontNeighbors / Math.max(0.001, totalWeight), 0, 1);
      const out = idx * 4;
      data[out] = isAsh ? 255 : 0;
      data[out + 1] = Math.round(neighborCoverage * 255);
      data[out + 2] = protectedTerrain ? 255 : 0;
      data[out + 3] = Math.round(activeFire * 255);
    }
  }

  if (!hasPaintSource) {
    return null;
  }

  return createMaskTexture(data, sampleCols, sampleRows);
};

const patchMaterial = (
  material: THREE.MeshStandardMaterial & { userData: Record<string, unknown> },
  opts: Required<
    Pick<ScorchedGroundMaterialOptions, "enabled" | "seed" | "tileWorldSize" | "originX" | "originZ" | "sampleCols" | "sampleRows">
  > & { maskTexture: THREE.Texture }
): void => {
  const existingMaskUniform = material.userData.scorchedGroundMaskUniform as { value: THREE.Texture } | undefined;
  const existingEnabledUniform = material.userData.scorchedGroundEnabledUniform as { value: number } | undefined;
  const existingSeedUniform = material.userData.scorchedGroundSeedUniform as { value: number } | undefined;
  const existingTileSizeUniform = material.userData.scorchedGroundTileSizeUniform as { value: number } | undefined;
  const existingOriginUniform = material.userData.scorchedGroundOriginUniform as { value: THREE.Vector2 } | undefined;
  const existingMaskSizeUniform = material.userData.scorchedGroundMaskSizeUniform as { value: THREE.Vector2 } | undefined;
  if (
    existingMaskUniform &&
    existingEnabledUniform &&
    existingSeedUniform &&
    existingTileSizeUniform &&
    existingOriginUniform &&
    existingMaskSizeUniform
  ) {
    if (existingMaskUniform.value !== opts.maskTexture) {
      existingMaskUniform.value.dispose();
      existingMaskUniform.value = opts.maskTexture;
    }
    existingEnabledUniform.value = opts.enabled ? 1 : 0;
    existingSeedUniform.value = opts.seed;
    existingTileSizeUniform.value = opts.tileWorldSize;
    existingOriginUniform.value.set(opts.originX, opts.originZ);
    existingMaskSizeUniform.value.set(opts.sampleCols, opts.sampleRows);
    return;
  }

  const maskUniform = { value: opts.maskTexture };
  const enabledUniform = { value: opts.enabled ? 1 : 0 };
  const seedUniform = { value: opts.seed };
  const tileSizeUniform = { value: opts.tileWorldSize };
  const originUniform = { value: new THREE.Vector2(opts.originX, opts.originZ) };
  const maskSizeUniform = { value: new THREE.Vector2(opts.sampleCols, opts.sampleRows) };
  const priorOnBeforeCompile = material.onBeforeCompile;
  const priorCacheKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;

  material.onBeforeCompile = (shader, renderer) => {
    if (priorOnBeforeCompile) {
      priorOnBeforeCompile(shader, renderer);
    }

    shader.uniforms.uScorchedGroundMask = maskUniform;
    shader.uniforms.uScorchedGroundEnabled = enabledUniform;
    shader.uniforms.uScorchedGroundSeed = seedUniform;
    shader.uniforms.uScorchedGroundTileWorldSize = tileSizeUniform;
    shader.uniforms.uScorchedGroundOrigin = originUniform;
    shader.uniforms.uScorchedGroundMaskSize = maskSizeUniform;

    shader.vertexShader =
      "varying vec3 vScorchedGroundWorldPos;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        ["#include <begin_vertex>", "vScorchedGroundWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;"].join("\n")
      );

    shader.fragmentShader =
      [
        "varying vec3 vScorchedGroundWorldPos;",
        "uniform sampler2D uScorchedGroundMask;",
        "uniform float uScorchedGroundEnabled;",
        "uniform float uScorchedGroundSeed;",
        "uniform float uScorchedGroundTileWorldSize;",
        "uniform vec2 uScorchedGroundOrigin;",
        "uniform vec2 uScorchedGroundMaskSize;",
        "float scorchedGroundHash(vec2 p) {",
        "  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uScorchedGroundSeed * 0.00037);",
        "  p3 += dot(p3, p3.yzx + 33.33);",
        "  return fract((p3.x + p3.y) * p3.z);",
        "}",
        "float scorchedGroundNoise(vec2 p) {",
        "  vec2 i = floor(p);",
        "  vec2 f = fract(p);",
        "  vec2 u = f * f * (3.0 - 2.0 * f);",
        "  float a = scorchedGroundHash(i);",
        "  float b = scorchedGroundHash(i + vec2(1.0, 0.0));",
        "  float c = scorchedGroundHash(i + vec2(0.0, 1.0));",
        "  float d = scorchedGroundHash(i + vec2(1.0, 1.0));",
        "  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);",
        "}",
        "float scorchedGroundFbm(vec2 p) {",
        "  float value = 0.0;",
        "  float amp = 0.5;",
        "  value += scorchedGroundNoise(p) * amp;",
        "  p = p * 2.03 + vec2(17.1, 9.2);",
        "  amp *= 0.5;",
        "  value += scorchedGroundNoise(p) * amp;",
        "  p = p * 2.07 + vec2(3.7, 21.4);",
        "  amp *= 0.5;",
        "  value += scorchedGroundNoise(p) * amp;",
        "  return value;",
        "}",
        "float scorchedGroundEdge(float distanceToEdge, float width) {",
        "  return 1.0 - smoothstep(0.0, width, distanceToEdge);",
        "}",
        "float scorchedGroundFront(vec4 sampleValue) {",
        "  return max(step(0.5, sampleValue.r), step(0.02, sampleValue.a));",
        "}",
        "vec3 applyScorchedGroundColor(vec3 color, vec4 maskSample, vec2 uv, vec3 worldPos) {",
        "  if (uScorchedGroundEnabled < 0.5) {",
        "    return color;",
        "  }",
        "  float isAsh = step(0.5, maskSample.r);",
        "  float activeFire = clamp(maskSample.a, 0.0, 1.0);",
        "  float front = max(isAsh, step(0.02, activeFire));",
        "  float neighborCoverage = clamp(maskSample.g, 0.0, 1.0);",
        "  float protectedTerrain = step(0.5, maskSample.b);",
        "  if (protectedTerrain > 0.5) {",
        "    return color;",
        "  }",
        "  vec2 texel = 1.0 / max(uScorchedGroundMaskSize, vec2(1.0));",
        "  vec4 leftSample = texture2D(uScorchedGroundMask, uv - vec2(texel.x, 0.0));",
        "  vec4 rightSample = texture2D(uScorchedGroundMask, uv + vec2(texel.x, 0.0));",
        "  vec4 downSample = texture2D(uScorchedGroundMask, uv - vec2(0.0, texel.y));",
        "  vec4 upSample = texture2D(uScorchedGroundMask, uv + vec2(0.0, texel.y));",
        "  vec4 downLeftSample = texture2D(uScorchedGroundMask, uv - texel);",
        "  vec4 upLeftSample = texture2D(uScorchedGroundMask, uv + vec2(-texel.x, texel.y));",
        "  vec4 downRightSample = texture2D(uScorchedGroundMask, uv + vec2(texel.x, -texel.y));",
        "  vec4 upRightSample = texture2D(uScorchedGroundMask, uv + texel);",
        "  float leftFront = scorchedGroundFront(leftSample);",
        "  float rightFront = scorchedGroundFront(rightSample);",
        "  float downFront = scorchedGroundFront(downSample);",
        "  float upFront = scorchedGroundFront(upSample);",
        "  float downLeftFront = scorchedGroundFront(downLeftSample);",
        "  float upLeftFront = scorchedGroundFront(upLeftSample);",
        "  float downRightFront = scorchedGroundFront(downRightSample);",
        "  float upRightFront = scorchedGroundFront(upRightSample);",
        "  float leftAsh = step(0.5, leftSample.r);",
        "  float rightAsh = step(0.5, rightSample.r);",
        "  float downAsh = step(0.5, downSample.r);",
        "  float upAsh = step(0.5, upSample.r);",
        "  float downLeftAsh = step(0.5, downLeftSample.r);",
        "  float upLeftAsh = step(0.5, upLeftSample.r);",
        "  float downRightAsh = step(0.5, downRightSample.r);",
        "  float upRightAsh = step(0.5, upRightSample.r);",
        "  vec2 tileCoord = (worldPos.xz - uScorchedGroundOrigin) / max(0.0001, uScorchedGroundTileWorldSize);",
        "  vec2 tileId = floor(tileCoord);",
        "  vec2 cellUv = fract(tileCoord);",
        "  vec2 subCoord = cellUv * 4.0;",
        "  vec2 subId = floor(subCoord);",
        "  vec2 subUv = fract(subCoord);",
        "  float broad = scorchedGroundFbm(worldPos.xz * 0.16 + vec2(uScorchedGroundSeed * 0.011, 4.7));",
        "  float fine = scorchedGroundNoise(tileId * 2.17 + subId * 8.31 + vec2(13.7, uScorchedGroundSeed * 0.019));",
        "  float subHash = scorchedGroundHash(tileId * 17.13 + subId * 5.71);",
        "  float triHash = scorchedGroundHash(tileId * 41.03 + subId * 11.11 + vec2(3.0, 19.0));",
        "  float exposedLeft = (1.0 - leftFront) * scorchedGroundEdge(cellUv.x, 0.62);",
        "  float exposedRight = (1.0 - rightFront) * scorchedGroundEdge(1.0 - cellUv.x, 0.62);",
        "  float exposedDown = (1.0 - downFront) * scorchedGroundEdge(cellUv.y, 0.62);",
        "  float exposedUp = (1.0 - upFront) * scorchedGroundEdge(1.0 - cellUv.y, 0.62);",
        "  float cornerExposure = max(max((1.0 - downLeftFront) * (1.0 - cellUv.x) * cellUv.y, (1.0 - upLeftFront) * (1.0 - cellUv.x) * (1.0 - cellUv.y)), max((1.0 - downRightFront) * cellUv.x * cellUv.y, (1.0 - upRightFront) * cellUv.x * (1.0 - cellUv.y)));",
        "  float exposure = clamp(max(max(exposedLeft, exposedRight), max(exposedDown, exposedUp)) + cornerExposure * 0.36, 0.0, 1.0);",
        "  float adjacentFront = max(max(leftFront, rightFront), max(upFront, downFront));",
        "  if (front < 0.5) {",
        "    float sootEdge = max(max(leftFront * scorchedGroundEdge(cellUv.x, 0.22), rightFront * scorchedGroundEdge(1.0 - cellUv.x, 0.22)), max(downFront * scorchedGroundEdge(cellUv.y, 0.22), upFront * scorchedGroundEdge(1.0 - cellUv.y, 0.22)));",
        "    float sootChunk = step(subHash, 0.46 + fine * 0.18);",
        "    float sootMask = clamp(adjacentFront * sootEdge * sootChunk * 0.22, 0.0, 0.22);",
        "    vec3 sootColor = mix(color * vec3(0.72, 0.68, 0.58), vec3(0.065, 0.058, 0.048), 0.34 + broad * 0.18);",
        "    return mix(color, sootColor, sootMask);",
        "  }",
        "  float interiorAsh = isAsh * leftAsh * rightAsh * downAsh * upAsh * downLeftAsh * upLeftAsh * downRightAsh * upRightAsh;",
        "  float coverageTarget = mix(0.34, 0.82, neighborCoverage);",
        "  coverageTarget += isAsh * 0.1 + smoothstep(0.02, 0.85, activeFire) * 0.12;",
        "  coverageTarget += (broad - 0.5) * 0.1 + (fine - 0.5) * 0.12;",
        "  coverageTarget -= exposure * mix(0.5, 0.28, neighborCoverage);",
        "  coverageTarget = clamp(coverageTarget, 0.08, 0.96);",
        "  float chunkPaint = step(subHash, coverageTarget);",
        "  float nearThreshold = 1.0 - smoothstep(0.06, 0.2, abs(subHash - coverageTarget));",
        "  float diagA = step(subUv.x + subUv.y, 1.0);",
        "  float diagB = step(1.0, subUv.x + subUv.y);",
        "  float triPaint = mix(diagA, diagB, step(0.5, triHash));",
        "  float paint = mix(chunkPaint, triPaint, nearThreshold * (1.0 - interiorAsh) * 0.72);",
        "  paint = max(paint, interiorAsh);",
        "  vec3 ashTone = mix(vec3(0.04, 0.04, 0.038), vec3(0.24, 0.235, 0.215), broad * 0.62 + fine * 0.2);",
        "  vec3 charTone = mix(vec3(0.06, 0.045, 0.032), vec3(0.19, 0.075, 0.035), smoothstep(0.02, 0.9, activeFire) * 0.45 + fine * 0.12);",
        "  vec3 paintColor = mix(charTone, ashTone, clamp(isAsh * 0.78 + neighborCoverage * 0.18, 0.0, 1.0));",
        "  float paintStrength = mix(0.86, 0.98, isAsh);",
        "  paintStrength = mix(paintStrength, 0.82, smoothstep(0.02, 0.9, activeFire) * (1.0 - isAsh));",
        "  return mix(color, paintColor, paint * paintStrength);",
        "}"
      ].join("\n") + "\n" + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      [
        "#include <color_fragment>",
        "#ifdef USE_MAP",
        "  vec4 scorchedGroundMask = texture2D(uScorchedGroundMask, vMapUv);",
        "  diffuseColor.rgb = applyScorchedGroundColor(diffuseColor.rgb, scorchedGroundMask, vMapUv, vScorchedGroundWorldPos);",
        "#endif"
      ].join("\n")
    );
  };

  material.customProgramCacheKey = () => {
    const base = priorCacheKey ? priorCacheKey() : "";
    return `${base}${PROGRAM_KEY_SUFFIX}`;
  };

  const onDispose = (): void => {
    maskUniform.value.dispose();
    material.removeEventListener("dispose", onDispose);
  };
  material.addEventListener("dispose", onDispose);
  material.userData.scorchedGroundMaskUniform = maskUniform;
  material.userData.scorchedGroundEnabledUniform = enabledUniform;
  material.userData.scorchedGroundSeedUniform = seedUniform;
  material.userData.scorchedGroundTileSizeUniform = tileSizeUniform;
  material.userData.scorchedGroundOriginUniform = originUniform;
  material.userData.scorchedGroundMaskSizeUniform = maskSizeUniform;
  material.needsUpdate = true;
};

const disableExistingMaterial = (material: THREE.Material | THREE.Material[]): boolean => {
  let disabled = false;
  const disableOne = (entry: THREE.Material): void => {
    if (!isMeshStandardMaterial(entry)) {
      return;
    }
    const enabledUniform = entry.userData.scorchedGroundEnabledUniform as { value: number } | undefined;
    if (enabledUniform) {
      enabledUniform.value = 0;
      disabled = true;
    }
  };
  if (Array.isArray(material)) {
    material.forEach(disableOne);
  } else {
    disableOne(material);
  }
  return disabled;
};

export const applyScorchedGroundMaterial = (
  material: THREE.Material | THREE.Material[],
  opts: ScorchedGroundMaterialOptions
): THREE.Material | THREE.Material[] => {
  const enabled = opts.enabled !== false;
  if (!enabled || !opts.maskTexture) {
    disableExistingMaterial(material);
    return material;
  }
  const sampleCols = Math.floor(opts.sampleCols ?? 0);
  const sampleRows = Math.floor(opts.sampleRows ?? 0);
  const tileWorldSize = opts.tileWorldSize ?? 0;
  if (sampleCols <= 0 || sampleRows <= 0 || !Number.isFinite(tileWorldSize) || tileWorldSize <= 0) {
    disableExistingMaterial(material);
    return material;
  }

  const resolved = {
    maskTexture: opts.maskTexture,
    enabled,
    seed: Number.isFinite(opts.seed) ? (opts.seed as number) : 0,
    tileWorldSize,
    originX: Number.isFinite(opts.originX) ? (opts.originX as number) : 0,
    originZ: Number.isFinite(opts.originZ) ? (opts.originZ as number) : 0,
    sampleCols,
    sampleRows
  };

  if (Array.isArray(material)) {
    material.forEach((entry) => {
      if (isMeshStandardMaterial(entry)) {
        patchMaterial(entry, resolved);
      }
    });
    return material;
  }

  if (isMeshStandardMaterial(material)) {
    patchMaterial(material, resolved);
  }
  return material;
};
