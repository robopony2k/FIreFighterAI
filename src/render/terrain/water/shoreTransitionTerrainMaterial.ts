import * as THREE from "three";

export type ShoreTransitionTerrainMaterialOptions = {
  shoreTransitionMap: THREE.Texture | null | undefined;
};

const PROGRAM_KEY_SUFFIX = "|shoreTransitionTerrain:v1";

const isMeshStandardMaterial = (
  material: THREE.Material
): material is THREE.MeshStandardMaterial & { userData: Record<string, unknown> } => {
  return material instanceof THREE.MeshStandardMaterial;
};

const patchMaterial = (
  material: THREE.MeshStandardMaterial & { userData: Record<string, unknown> },
  shoreTransitionMap: THREE.Texture
): void => {
  const existingUniform = material.userData.shoreTransitionTerrainUniform as
    | { value: THREE.Texture }
    | undefined;
  if (existingUniform) {
    existingUniform.value = shoreTransitionMap;
    return;
  }

  const uniformRef = { value: shoreTransitionMap };
  const priorOnBeforeCompile = material.onBeforeCompile;
  const priorCacheKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;

  material.onBeforeCompile = (shader, renderer) => {
    if (priorOnBeforeCompile) {
      priorOnBeforeCompile(shader, renderer);
    }

    shader.uniforms.u_shoreTransitionMap = uniformRef;

    shader.vertexShader =
      "varying vec3 vShoreTransitionWorldNormal;\n" +
      shader.vertexShader.replace(
        "#include <beginnormal_vertex>",
        [
          "#include <beginnormal_vertex>",
          "vShoreTransitionWorldNormal = normalize(mat3(modelMatrix) * objectNormal);"
        ].join("\n")
      );

    shader.fragmentShader =
      [
        "varying vec3 vShoreTransitionWorldNormal;",
        "uniform sampler2D u_shoreTransitionMap;",
        "vec3 applyShoreTransitionWetness(vec3 color, float landwardFade, float topFacingMask) {",
        "  float wetness = clamp(landwardFade * topFacingMask, 0.0, 1.0);",
        "  if (wetness <= 0.0001) {",
        "    return color;",
        "  }",
        "  float luma = dot(color, vec3(0.299, 0.587, 0.114));",
        "  vec3 desaturated = mix(color, vec3(luma), 0.18);",
        "  vec3 coolShift = desaturated * vec3(0.94, 0.965, 1.02);",
        "  vec3 wetColor = mix(desaturated, coolShift, 0.34);",
        "  wetColor *= vec3(0.885, 0.905, 0.955);",
        "  float wetMix = wetness * 0.18;",
        "  return mix(color, wetColor, wetMix);",
        "}"
      ].join("\n") +
      "\n" +
      shader.fragmentShader;

    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <map_fragment>",
      [
        "#include <map_fragment>",
        "#ifdef USE_MAP",
        "  vec4 shoreTransitionSample = texture2D(u_shoreTransitionMap, vMapUv);",
        "  float shoreLandwardFade = shoreTransitionSample.g;",
        "  float shoreTopFacingMask = smoothstep(0.82, 0.93, clamp(vShoreTransitionWorldNormal.y, 0.0, 1.0));",
        "  diffuseColor.rgb = applyShoreTransitionWetness(diffuseColor.rgb, shoreLandwardFade, shoreTopFacingMask);",
        "#endif"
      ].join("\n")
    );
  };

  material.customProgramCacheKey = () => {
    const base = priorCacheKey ? priorCacheKey() : "";
    return `${base}${PROGRAM_KEY_SUFFIX}`;
  };

  material.userData.shoreTransitionTerrainUniform = uniformRef;
  material.needsUpdate = true;
};

export const applyShoreTransitionTerrainMaterial = (
  material: THREE.Material | THREE.Material[],
  opts: ShoreTransitionTerrainMaterialOptions
): THREE.Material | THREE.Material[] => {
  if (!opts.shoreTransitionMap) {
    return material;
  }

  if (Array.isArray(material)) {
    material.forEach((entry) => {
      if (isMeshStandardMaterial(entry)) {
        patchMaterial(entry, opts.shoreTransitionMap as THREE.Texture);
      }
    });
    return material;
  }

  if (isMeshStandardMaterial(material)) {
    patchMaterial(material, opts.shoreTransitionMap as THREE.Texture);
  }
  return material;
};
