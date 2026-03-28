import * as THREE from "three";

/*
 * Safe to delete; only referenced from src/render/threeTestTerrain.ts.
 */

export type GrassDetailFxOptions = {
  enabled: boolean;
  tileWorldSize: number;
  seed?: number;
  sampleTypes?: Uint8Array;
  sampleCols?: number;
  sampleRows?: number;
  grassTypeId?: number;
  originX?: number;
  originZ?: number;
};

const PROGRAM_KEY_SUFFIX = "|grassDetailFx:v1";

const isMeshStandardMaterial = (
  material: THREE.Material
): material is THREE.MeshStandardMaterial & { userData: Record<string, unknown> } => {
  return material instanceof THREE.MeshStandardMaterial;
};

const isValidOptions = (opts: GrassDetailFxOptions): boolean => {
  if (!opts.enabled || !Number.isFinite(opts.tileWorldSize) || opts.tileWorldSize <= 0) {
    return false;
  }
  if (!opts.sampleTypes || !Number.isFinite(opts.sampleCols) || !Number.isFinite(opts.sampleRows)) {
    return false;
  }
  if (!Number.isFinite(opts.grassTypeId)) {
    return false;
  }
  const cols = Math.floor(opts.sampleCols as number);
  const rows = Math.floor(opts.sampleRows as number);
  if (cols <= 0 || rows <= 0) {
    return false;
  }
  if (opts.sampleTypes.length < cols * rows) {
    return false;
  }
  return true;
};

const buildGrassMaskTexture = (
  sampleTypes: Uint8Array,
  sampleCols: number,
  sampleRows: number,
  grassTypeId: number
): THREE.DataTexture => {
  const total = sampleCols * sampleRows;
  const data = new Uint8Array(total * 4);
  for (let i = 0; i < total; i += 1) {
    const on = sampleTypes[i] === grassTypeId ? 255 : 0;
    const base = i * 4;
    data[base] = on;
    data[base + 1] = on;
    data[base + 2] = on;
    data[base + 3] = 255;
  }
  const flipped = new Uint8Array(data.length);
  const rowStride = sampleCols * 4;
  for (let y = 0; y < sampleRows; y += 1) {
    const src = y * rowStride;
    const dst = (sampleRows - 1 - y) * rowStride;
    flipped.set(data.subarray(src, src + rowStride), dst);
  }
  const texture = new THREE.DataTexture(flipped, sampleCols, sampleRows, THREE.RGBAFormat);
  texture.needsUpdate = true;
  texture.colorSpace = THREE.LinearSRGBColorSpace;
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.flipY = false;
  texture.generateMipmaps = false;
  return texture;
};

const patchMaterial = (
  material: THREE.MeshStandardMaterial & { userData: Record<string, unknown> },
  opts: Required<Pick<GrassDetailFxOptions, "tileWorldSize" | "seed" | "originX" | "originZ">> & {
    sampleTypes: Uint8Array;
    sampleCols: number;
    sampleRows: number;
    grassTypeId: number;
  }
): void => {
  if (material.userData.grassDetailFxApplied) {
    return;
  }

  const maskTexture = buildGrassMaskTexture(opts.sampleTypes, opts.sampleCols, opts.sampleRows, opts.grassTypeId);
  const priorOnBeforeCompile = material.onBeforeCompile;
  const priorCacheKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;

  material.onBeforeCompile = (shader, renderer) => {
    if (priorOnBeforeCompile) {
      priorOnBeforeCompile(shader, renderer);
    }

    shader.uniforms.uGrassMask = { value: maskTexture };
    shader.uniforms.uGrassTileWorldSize = { value: opts.tileWorldSize };
    shader.uniforms.uGrassSeed = { value: opts.seed };
    shader.uniforms.uGrassOrigin = { value: new THREE.Vector2(opts.originX, opts.originZ) };
    shader.uniforms.uGrassMaskSize = { value: new THREE.Vector2(opts.sampleCols, opts.sampleRows) };

    shader.vertexShader =
      "varying vec3 vGrassWorldPos;\n" +
      shader.vertexShader.replace(
        "#include <begin_vertex>",
        ["#include <begin_vertex>", "vGrassWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;"].join("\n")
      );

    shader.fragmentShader =
      [
        "varying vec3 vGrassWorldPos;",
        "uniform sampler2D uGrassMask;",
        "uniform float uGrassTileWorldSize;",
        "uniform float uGrassSeed;",
        "uniform vec2 uGrassOrigin;",
        "uniform vec2 uGrassMaskSize;",
        "float grassHash12(vec2 p) {",
        "  vec3 p3 = fract(vec3(p.xyx) * 0.1031);",
        "  p3 += dot(p3, p3.yzx + 33.33);",
        "  return fract((p3.x + p3.y) * p3.z);",
        "}",
        "vec3 applyGrassDetailFxColor(vec3 color, float grassMask, vec2 worldXZ) {",
        "  if (grassMask <= 0.001) {",
        "    return color;",
        "  }",
        "  grassMask = step(0.5, grassMask);",
        "  vec2 tileCoordF = (worldXZ - uGrassOrigin) / max(0.0001, uGrassTileWorldSize);",
        "  vec2 tileId = floor(tileCoordF);",
        "  vec2 cellUv = fract(tileCoordF);",
        "  float tileJitter = grassHash12(tileId + vec2(17.0, 53.0) + uGrassSeed * 0.071);",
        "  float edgeDist = min(min(cellUv.x, 1.0 - cellUv.x), min(cellUv.y, 1.0 - cellUv.y));",
        "  float edgeWidth = mix(0.12, 0.21, grassHash12(tileId + vec2(5.0, 9.0) + uGrassSeed * 0.19));",
        "  float edgeMask = 1.0 - smoothstep(0.0, edgeWidth, edgeDist);",
        "  vec2 tuftCell = floor(tileCoordF * 6.1 + vec2(tileJitter * 3.0));",
        "  float tuftRaw = grassHash12(tuftCell + vec2(3.0, 11.0) + uGrassSeed * 0.11);",
        "  float tuftBand = floor(tuftRaw * 4.0) / 3.0;",
        "  float tuftValue = mix(-0.045, 0.085, tuftBand);",
        "  float hueJitter = (tileJitter - 0.5) * 2.0;",
        "  vec3 paletteJitter = vec3(1.0 + hueJitter * 0.017, 1.0 + hueJitter * 0.022, 1.0 - hueJitter * 0.012);",
        "  float edgeDarken = edgeMask * mix(0.055, 0.11, tileJitter);",
        "  vec3 detailed = color * paletteJitter;",
        "  detailed *= (1.0 + tuftValue);",
        "  detailed *= (1.0 - edgeDarken);",
        "  return mix(color, detailed, grassMask * 0.92);",
        "}"
      ].join("\n") + "\n" + shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <dithering_fragment>",
      [
        "#ifdef USE_MAP",
        "  float grassMask = texture2D(uGrassMask, vMapUv).r;",
        "  gl_FragColor.rgb = applyGrassDetailFxColor(gl_FragColor.rgb, grassMask, vGrassWorldPos.xz);",
        "#endif",
        "#include <dithering_fragment>"
      ].join("\n")
    );
  };

  material.customProgramCacheKey = () => {
    const base = priorCacheKey ? priorCacheKey() : "";
    return `${base}${PROGRAM_KEY_SUFFIX}`;
  };

  const onDispose = (): void => {
    maskTexture.dispose();
    material.removeEventListener("dispose", onDispose);
  };
  material.addEventListener("dispose", onDispose);
  material.userData.grassDetailFxApplied = true;
  material.needsUpdate = true;
};

export const applyGrassDetailFx = (
  material: THREE.Material | THREE.Material[],
  opts: GrassDetailFxOptions
): THREE.Material | THREE.Material[] => {
  if (!isValidOptions(opts)) {
    return material;
  }

  const resolved = {
    tileWorldSize: opts.tileWorldSize,
    seed: Number.isFinite(opts.seed) ? (opts.seed as number) : 0,
    originX: Number.isFinite(opts.originX) ? (opts.originX as number) : 0,
    originZ: Number.isFinite(opts.originZ) ? (opts.originZ as number) : 0,
    sampleTypes: opts.sampleTypes as Uint8Array,
    sampleCols: Math.floor(opts.sampleCols as number),
    sampleRows: Math.floor(opts.sampleRows as number),
    grassTypeId: Math.floor(opts.grassTypeId as number)
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
