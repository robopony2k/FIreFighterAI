import * as THREE from "three";

export type MountainRockMaterialOptions = {
  maskTexture: THREE.Texture | null | undefined;
  detailTexture: THREE.Texture | null | undefined;
  seed?: number;
};

export const MOUNTAIN_ROCK_VERTEX_RELIEF_SCALE = 0;

const PROGRAM_KEY_SUFFIX = "|mountainRock:v5";

const isMeshStandardMaterial = (
  material: THREE.Material
): material is THREE.MeshStandardMaterial & { userData: Record<string, unknown> } => {
  return material instanceof THREE.MeshStandardMaterial;
};

const patchMaterial = (
  material: THREE.MeshStandardMaterial & { userData: Record<string, unknown> },
  maskTexture: THREE.Texture,
  detailTexture: THREE.Texture,
  seed: number
): void => {
  const existingMaskUniform = material.userData.mountainRockMaskUniform as { value: THREE.Texture } | undefined;
  const existingDetailUniform = material.userData.mountainRockDetailUniform as { value: THREE.Texture } | undefined;
  const existingSeedUniform = material.userData.mountainRockSeedUniform as { value: number } | undefined;
  if (existingMaskUniform && existingDetailUniform && existingSeedUniform) {
    existingMaskUniform.value = maskTexture;
    existingDetailUniform.value = detailTexture;
    existingSeedUniform.value = seed;
    return;
  }

  const maskUniform = { value: maskTexture };
  const detailUniform = { value: detailTexture };
  const seedUniform = { value: seed };
  const priorOnBeforeCompile = material.onBeforeCompile;
  const priorCacheKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;

  material.onBeforeCompile = (shader, renderer) => {
    if (priorOnBeforeCompile) {
      priorOnBeforeCompile(shader, renderer);
    }

    shader.uniforms.uMountainRockMask = maskUniform;
    shader.uniforms.uMountainRockDetail = detailUniform;
    shader.uniforms.uMountainRockSeed = seedUniform;

    shader.vertexShader =
      [
        "varying vec3 vMountainRockWorldPos;",
        "varying vec3 vMountainRockWorldNormal;",
        "uniform sampler2D uMountainRockMask;",
        "uniform sampler2D uMountainRockDetail;",
        "uniform float uMountainRockSeed;",
        "float mountainRockVertexHash(vec2 p) {",
        "  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uMountainRockSeed * 0.00031);",
        "  p3 += dot(p3, p3.yzx + 33.33);",
        "  return fract((p3.x + p3.y) * p3.z);",
        "}",
        "float mountainRockVertexNoise(vec2 p) {",
        "  vec2 i = floor(p);",
        "  vec2 f = fract(p);",
        "  vec2 u = f * f * (3.0 - 2.0 * f);",
        "  float a = mountainRockVertexHash(i);",
        "  float b = mountainRockVertexHash(i + vec2(1.0, 0.0));",
        "  float c = mountainRockVertexHash(i + vec2(0.0, 1.0));",
        "  float d = mountainRockVertexHash(i + vec2(1.0, 1.0));",
        "  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);",
        "}",
        "float mountainRockVertexLuma(vec4 texel) {",
        "  return dot(texel.rgb, vec3(0.299, 0.587, 0.114));",
        "}",
        "float mountainRockVertexLine(float phase, float width, float softness) {",
        "  float distToLine = abs(fract(phase) - 0.5);",
        "  return 1.0 - smoothstep(width, width + softness, distToLine);",
        "}",
        "float mountainRockVertexRelief(vec2 uv, vec3 objectPos, vec4 maskSample) {",
        "  float rock = clamp(maskSample.r, 0.0, 1.0);",
        "  float ridge = clamp(maskSample.g, 0.0, 1.0);",
        "  float gully = clamp(maskSample.b, 0.0, 1.0);",
        "  float highland = clamp(maskSample.a, 0.0, 1.0);",
        "  vec2 seedOffset = vec2(uMountainRockSeed * 0.0017, uMountainRockSeed * 0.0023);",
        "  vec2 broadUv = uv * 18.0 + seedOffset;",
        "  vec2 detailUv = uv * 126.0 + vec2(objectPos.y * 0.026, -objectPos.y * 0.017) + seedOffset.yx;",
        "  float broadTex = mountainRockVertexLuma(texture2D(uMountainRockDetail, broadUv));",
        "  float detailTex = mountainRockVertexLuma(texture2D(uMountainRockDetail, detailUv));",
        "  float broadNoise = mountainRockVertexNoise(uv * 28.0 + seedOffset * 7.0);",
        "  float sharpNoise = mountainRockVertexNoise(uv * 164.0 + seedOffset * 13.0);",
        "  vec2 strataDir = normalize(vec2(0.82, 0.57));",
        "  float strata = mountainRockVertexLine(dot(uv * 118.0, strataDir) + objectPos.y * 0.3 + broadTex * 0.55, 0.075, 0.17);",
        "  float crevice = smoothstep(0.48, 0.82, (1.0 - detailTex) * 0.66 + (1.0 - broadTex) * 0.22 + broadNoise * 0.14 + sharpNoise * 0.18);",
        "  float chipped = smoothstep(0.52, 0.86, detailTex * 0.72 + sharpNoise * 0.38 + broadNoise * 0.12);",
        "  float gate = clamp(rock * 0.92 + ridge * 0.44 + gully * 0.36, 0.0, 1.0);",
        "  float relief = (broadTex - 0.5) * 0.28 + (detailTex - 0.5) * 0.25 + (sharpNoise - 0.5) * 0.1;",
        "  relief += chipped * 0.18 + ridge * 0.2;",
        "  relief -= crevice * 0.32 + strata * (0.12 + highland * 0.11) + gully * 0.17;",
        "  return relief * gate * 1.05;",
        "}"
      ].join("\n") +
      "\n" +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <beginnormal_vertex>",
      [
        "#include <beginnormal_vertex>",
        "vMountainRockWorldNormal = normalize(mat3(modelMatrix) * objectNormal);"
      ].join("\n")
    );
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      [
        "#include <begin_vertex>",
        "vMountainRockWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;"
      ].join("\n")
    );

    shader.fragmentShader =
      [
        "varying vec3 vMountainRockWorldPos;",
        "varying vec3 vMountainRockWorldNormal;",
        "uniform sampler2D uMountainRockMask;",
        "uniform sampler2D uMountainRockDetail;",
        "uniform float uMountainRockSeed;",
        "float mountainRockHash(vec2 p) {",
        "  vec3 p3 = fract(vec3(p.xyx) * 0.1031 + uMountainRockSeed * 0.00031);",
        "  p3 += dot(p3, p3.yzx + 33.33);",
        "  return fract((p3.x + p3.y) * p3.z);",
        "}",
        "float mountainRockNoise(vec2 p) {",
        "  vec2 i = floor(p);",
        "  vec2 f = fract(p);",
        "  vec2 u = f * f * (3.0 - 2.0 * f);",
        "  float a = mountainRockHash(i);",
        "  float b = mountainRockHash(i + vec2(1.0, 0.0));",
        "  float c = mountainRockHash(i + vec2(0.0, 1.0));",
        "  float d = mountainRockHash(i + vec2(1.0, 1.0));",
        "  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);",
        "}",
        "float mountainRockFbm(vec2 p) {",
        "  float value = 0.0;",
        "  float amp = 0.5;",
        "  value += mountainRockNoise(p) * amp;",
        "  p = p * 2.03 + vec2(17.1, 9.2);",
        "  amp *= 0.5;",
        "  value += mountainRockNoise(p) * amp;",
        "  p = p * 2.07 + vec2(3.7, 21.4);",
        "  amp *= 0.5;",
        "  value += mountainRockNoise(p) * amp;",
        "  return value;",
        "}",
        "float mountainRockLine(float phase, float width, float softness) {",
        "  float distToLine = abs(fract(phase) - 0.5);",
        "  return 1.0 - smoothstep(width, width + softness, distToLine);",
        "}",
        "vec4 sampleMountainRockDetail(vec2 p, float scale, vec2 offset) {",
        "  return texture2D(uMountainRockDetail, p * scale + offset);",
        "}",
        "float mountainRockDetailLuma(vec4 texel) {",
        "  return dot(texel.rgb, vec3(0.299, 0.587, 0.114));",
        "}",
        "float sampleMountainRockHeight(vec2 p, float scale, vec2 offset) {",
        "  return mountainRockDetailLuma(sampleMountainRockDetail(p, scale, offset));",
        "}",
        "vec3 applyMountainRockColor(vec3 color, vec4 maskSample, vec3 worldPos, vec3 worldNormal) {",
        "  float rock = clamp(maskSample.r, 0.0, 1.0);",
        "  float ridge = clamp(maskSample.g, 0.0, 1.0);",
        "  float gully = clamp(maskSample.b, 0.0, 1.0);",
        "  float highland = clamp(maskSample.a, 0.0, 1.0);",
        "  vec3 faceNormal = normalize(cross(dFdx(worldPos), dFdy(worldPos)));",
        "  float faceSteep = 1.0 - smoothstep(0.54, 0.92, abs(faceNormal.y));",
        "  float smoothSteep = 1.0 - smoothstep(0.7, 0.96, clamp(worldNormal.y, 0.0, 1.0));",
        "  float steepFacing = max(smoothSteep, faceSteep * 0.95);",
        "  float localRock = clamp(max(rock, faceSteep * (0.18 + highland * 0.28) + ridge * 0.2 + gully * 0.22), 0.0, 1.0);",
        "  if (max(max(localRock, ridge), gully) <= 0.01) {",
        "    return color;",
        "  }",
        "  vec2 p = worldPos.xz;",
        "  vec2 strataDir = normalize(vec2(0.82, 0.57));",
        "  vec2 crackDir = normalize(vec2(-0.38, 0.93));",
        "  vec2 detailUv = p * 0.046 + vec2(worldPos.y * 0.018, -worldPos.y * 0.011);",
        "  vec2 detailOffset = vec2(uMountainRockSeed * 0.0017, 0.13);",
        "  float texA = sampleMountainRockHeight(detailUv, 1.0, detailOffset);",
        "  float texB = sampleMountainRockHeight(detailUv.yx, 4.25, vec2(0.37, uMountainRockSeed * 0.0023));",
        "  float texC = sampleMountainRockHeight(detailUv + vec2(worldPos.y * 0.021), 12.0, vec2(0.11, 0.73));",
        "  float texRight = sampleMountainRockHeight(detailUv + vec2(0.004, 0.0), 1.0, detailOffset);",
        "  float texUp = sampleMountainRockHeight(detailUv + vec2(0.0, 0.004), 1.0, detailOffset);",
        "  float texRelief = clamp((texA - texRight) * 1.08 + (texA - texUp) * 0.82 + (texB - texC) * 0.28, -0.58, 0.58);",
        "  float broad = mountainRockFbm(p * 0.045 + vec2(uMountainRockSeed * 0.013, 5.1));",
        "  float fine = mountainRockFbm(p * 0.16 + vec2(11.7, uMountainRockSeed * 0.017));",
        "  float textureLuma = clamp(texA * 0.56 + texB * 0.28 + texC * 0.16, 0.0, 1.0);",
        "  float textureCrevice = clamp((1.0 - texA) * 0.58 + (1.0 - texB) * 0.34 + smoothstep(0.12, 0.34, 1.0 - texC) * 0.22, 0.0, 1.0);",
        "  float textureGrain = clamp(abs(texB - 0.5) * 1.95 + abs(texC - texB) * 1.55, 0.0, 1.0);",
        "  float textureMineral = clamp(textureLuma * 0.82 + broad * 0.18, 0.0, 1.0);",
        "  float textureChips = smoothstep(0.54, 0.82, max(texA, max(texB, texC))) * (0.38 + textureGrain * 0.72);",
        "  float strataPhase = dot(p, strataDir) * 0.055 + worldPos.y * 0.28 + broad * 0.45 + textureMineral * 0.34;",
        "  float strata = mountainRockLine(strataPhase, 0.12, 0.24) * (0.1 + textureCrevice * 0.16);",
        "  float secondaryPhase = dot(p, crackDir) * 0.13 + worldPos.y * 0.18 + fine * 0.42 + textureCrevice * 0.95;",
        "  float fractureGate = smoothstep(0.5, 0.78, textureCrevice + mountainRockNoise(p * 0.08 + vec2(37.0, 19.0)) * 0.22);",
        "  float fractures = mountainRockLine(secondaryPhase, 0.038, 0.08) * fractureGate * 0.72;",
        "  float flecks = smoothstep(0.56, 0.84, textureChips + mountainRockNoise(p * 0.42 + vec2(4.0, 29.0)) * 0.18);",
        "  float texturePatch = smoothstep(0.34, 0.78, textureCrevice * 0.42 + textureGrain * 0.3 + broad * 0.28);",
        "  float patchGate = clamp(localRock * (0.34 + steepFacing * 0.54 + highland * 0.08) + ridge * 0.28 + gully * 0.26, 0.0, 1.0);",
        "  float exposed = clamp(patchGate * mix(0.42, 1.0, texturePatch), 0.0, 1.0);",
        "  float structure = clamp(strata * 0.1 + fractures * 0.24 + textureCrevice * 0.48 + textureGrain * 0.28 + flecks * 0.18, 0.0, 1.0);",
        "  vec3 lowRock = vec3(0.34, 0.31, 0.26);",
        "  vec3 highRock = vec3(0.67, 0.61, 0.49);",
        "  vec3 warmPlane = vec3(0.68, 0.55, 0.34);",
        "  vec3 gullyRock = vec3(0.24, 0.23, 0.2);",
        "  vec3 ridgeRock = vec3(0.76, 0.7, 0.58);",
        "  vec3 rockBase = mix(lowRock, highRock, clamp(0.18 + textureMineral * 0.56 + broad * 0.08 + ridge * 0.18, 0.0, 1.0));",
        "  rockBase = mix(rockBase, warmPlane, clamp(0.18 + (1.0 - steepFacing) * 0.18 + highland * 0.08, 0.0, 0.34));",
        "  rockBase = mix(rockBase, gullyRock, gully * 0.28);",
        "  rockBase = mix(rockBase, ridgeRock, ridge * 0.18);",
        "  vec3 rockColor = rockBase;",
        "  rockColor *= 0.84 + textureLuma * 0.34;",
        "  rockColor *= 1.0 + texRelief * mix(0.34, 0.72, steepFacing) * exposed;",
        "  rockColor *= 1.0 - strata * mix(0.025, 0.06, highland);",
        "  rockColor *= 1.0 - fractures * mix(0.09, 0.19, steepFacing);",
        "  rockColor *= 1.0 - textureCrevice * mix(0.045, 0.15, steepFacing);",
        "  rockColor *= 1.0 - gully * 0.18;",
        "  rockColor += vec3(0.12, 0.1, 0.07) * ridge;",
        "  rockColor += vec3(0.15, 0.13, 0.095) * flecks * (0.14 + ridge * 0.58) * exposed;",
        "  rockColor = mix(rockColor, rockColor * (0.9 + fine * 0.18), 0.24);",
        "  vec3 warmGround = color * vec3(1.08, 1.02, 0.88);",
        "  warmGround = mix(warmGround, vec3(0.58, 0.47, 0.27), highland * (1.0 - localRock) * 0.16);",
        "  warmGround *= 1.0 - gully * 0.06;",
        "  warmGround *= 1.0 + ridge * 0.025;",
        "  float rockMix = clamp(exposed * (0.52 + steepFacing * 0.34 + ridge * 0.2 + gully * 0.18), 0.0, 0.9);",
        "  rockMix = clamp(rockMix + structure * exposed * 0.12, 0.0, 0.94);",
        "  vec3 blended = mix(warmGround, rockColor, rockMix);",
        "  blended *= 1.0 - gully * 0.07;",
        "  blended *= 1.0 + ridge * 0.04;",
        "  return max(blended, vec3(0.0));",
        "}",
        "float mountainRockReliefHeight(vec3 worldPos) {",
        "  vec2 p = worldPos.xz;",
        "  vec2 detailUv = p * 0.056 + vec2(worldPos.y * 0.02, -worldPos.y * 0.012);",
        "  vec2 seedOffset = vec2(uMountainRockSeed * 0.0017, uMountainRockSeed * 0.0023);",
        "  float macro = sampleMountainRockHeight(detailUv, 0.72, seedOffset);",
        "  float grain = sampleMountainRockHeight(detailUv.yx, 5.4, seedOffset.yx + vec2(0.41, 0.19));",
        "  float chips = sampleMountainRockHeight(detailUv + vec2(worldPos.y * 0.014), 14.0, vec2(0.11, 0.73));",
        "  vec2 strataDir = normalize(vec2(0.82, 0.57));",
        "  float broad = mountainRockFbm(p * 0.052 + seedOffset * 9.0);",
        "  float splinters = mountainRockFbm(p * 0.34 + seedOffset.yx * 17.0 + vec2(worldPos.y * 0.018));",
        "  float strata = mountainRockLine(dot(p, strataDir) * 0.084 + worldPos.y * 0.36 + macro * 0.38 + broad * 0.35, 0.075, 0.17);",
        "  float cracks = smoothstep(0.54, 0.86, (1.0 - grain) * 0.56 + (1.0 - chips) * 0.34 + strata * 0.26 + splinters * 0.18);",
        "  return macro * 0.26 + grain * 0.3 + chips * 0.27 + broad * 0.12 + splinters * 0.15 - cracks * 0.3 - strata * 0.22;",
        "}",
        "void applyMountainRockBump(vec4 maskSample, vec3 worldPos, inout vec3 normalView) {",
        "  float rock = clamp(maskSample.r, 0.0, 1.0);",
        "  float ridge = clamp(maskSample.g, 0.0, 1.0);",
        "  float gully = clamp(maskSample.b, 0.0, 1.0);",
        "  float gate = clamp(rock * 0.82 + ridge * 0.28 + gully * 0.32, 0.0, 1.0);",
        "  if (gate <= 0.01) {",
        "    return;",
        "  }",
        "  vec3 dpdx = dFdx(worldPos);",
        "  vec3 dpdy = dFdy(worldPos);",
        "  vec3 faceNormal = normalize(cross(dpdx, dpdy));",
        "  vec3 tangent = normalize(dpdx + vec3(0.0001, 0.0, 0.0));",
        "  vec3 bitangent = normalize(cross(faceNormal, tangent));",
        "  float pixelScale = clamp(length(dpdx) + length(dpdy), 0.08, 3.2);",
        "  float sampleStep = mix(0.1, 0.26, clamp(pixelScale * 0.32, 0.0, 1.0));",
        "  float h0 = mountainRockReliefHeight(worldPos);",
        "  float hx = mountainRockReliefHeight(worldPos + tangent * sampleStep);",
        "  float hy = mountainRockReliefHeight(worldPos + bitangent * sampleStep);",
        "  float bumpScale = mix(0.95, 2.15, gate);",
        "  vec3 bumpedWorld = normalize(faceNormal - tangent * (hx - h0) * bumpScale - bitangent * (hy - h0) * bumpScale);",
        "  vec3 bumpedView = normalize((viewMatrix * vec4(bumpedWorld, 0.0)).xyz);",
        "  normalView = normalize(mix(normalView, bumpedView, clamp(gate * 0.72, 0.0, 0.86)));",
        "}",
        "float mountainRockRoughnessDelta(vec4 maskSample, vec3 worldPos) {",
        "  float rock = clamp(maskSample.r, 0.0, 1.0);",
        "  if (rock <= 0.01) {",
        "    return 0.0;",
        "  }",
        "  vec2 detailUv = worldPos.xz * 0.018 + vec2(worldPos.y * 0.017, -worldPos.y * 0.009);",
        "  vec4 organic = sampleMountainRockDetail(detailUv, 3.5, vec2(0.29, uMountainRockSeed * 0.0023));",
        "  float n = clamp(organic.g * 0.55 + organic.b * 0.35 + mountainRockNoise(worldPos.xz * 0.32 + vec2(9.0, uMountainRockSeed * 0.021)) * 0.25, 0.0, 1.0);",
        "  return rock * mix(0.055, 0.17, n) - maskSample.g * rock * 0.035;",
        "}"
      ].join("\n") +
      "\n" +
      shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      [
        "#include <color_fragment>",
        "#ifdef USE_MAP",
        "  vec4 mountainRockMask = texture2D(uMountainRockMask, vMapUv);",
        "  diffuseColor.rgb = applyMountainRockColor(diffuseColor.rgb, mountainRockMask, vMountainRockWorldPos, normalize(vMountainRockWorldNormal));",
        "#endif"
      ].join("\n")
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      [
        "#include <normal_fragment_maps>",
        "#ifdef USE_MAP",
        "  vec4 mountainRockNormalMask = texture2D(uMountainRockMask, vMapUv);",
        "  applyMountainRockBump(mountainRockNormalMask, vMountainRockWorldPos, normal);",
        "#endif"
      ].join("\n")
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <roughnessmap_fragment>",
      [
        "#include <roughnessmap_fragment>",
        "#ifdef USE_MAP",
        "  vec4 mountainRockRoughnessMask = texture2D(uMountainRockMask, vMapUv);",
        "  roughnessFactor = clamp(roughnessFactor + mountainRockRoughnessDelta(mountainRockRoughnessMask, vMountainRockWorldPos), 0.0, 1.0);",
        "#endif"
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
  material.userData.mountainRockMaskUniform = maskUniform;
  material.userData.mountainRockDetailUniform = detailUniform;
  material.userData.mountainRockSeedUniform = seedUniform;
  material.needsUpdate = true;
};

export const applyMountainRockMaterial = (
  material: THREE.Material | THREE.Material[],
  opts: MountainRockMaterialOptions
): THREE.Material | THREE.Material[] => {
  if (!opts.maskTexture) {
    return material;
  }
  if (!opts.detailTexture) {
    return material;
  }
  const seed = Number.isFinite(opts.seed) ? (opts.seed as number) : 0;

  if (Array.isArray(material)) {
    material.forEach((entry) => {
      if (isMeshStandardMaterial(entry)) {
        patchMaterial(entry, opts.maskTexture as THREE.Texture, opts.detailTexture as THREE.Texture, seed);
      }
    });
    return material;
  }

  if (isMeshStandardMaterial(material)) {
    patchMaterial(material, opts.maskTexture, opts.detailTexture, seed);
  }
  return material;
};
