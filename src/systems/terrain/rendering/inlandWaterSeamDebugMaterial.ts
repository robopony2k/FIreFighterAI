import * as THREE from "three";

export const INLAND_WATER_SEAM_DEBUG_MODES = [
  "normal",
  "ownership",
  "waterNoFx",
  "skirtOnly",
  "waterOnly"
] as const;

export type InlandWaterSeamDebugMode = typeof INLAND_WATER_SEAM_DEBUG_MODES[number];

const PROGRAM_KEY_SUFFIX = "|inlandWaterSeamOwnership:v1";

export const getInlandWaterSeamDebugModeValue = (mode: InlandWaterSeamDebugMode): number => {
  switch (mode) {
    case "ownership": return 1;
    case "waterNoFx": return 2;
    case "skirtOnly": return 3;
    case "waterOnly": return 4;
    default: return 0;
  }
};

export const applyInlandWaterSeamDebugMaterial = (
  material: THREE.MeshStandardMaterial,
  mode: InlandWaterSeamDebugMode = "normal"
): void => {
  const existing = material.userData.inlandWaterSeamDebugUniform as { value: number } | undefined;
  if (existing) {
    existing.value = getInlandWaterSeamDebugModeValue(mode);
    return;
  }
  const uniform = { value: getInlandWaterSeamDebugModeValue(mode) };
  const priorOnBeforeCompile = material.onBeforeCompile;
  const priorCacheKey = material.customProgramCacheKey ? material.customProgramCacheKey.bind(material) : null;
  material.onBeforeCompile = (shader, renderer) => {
    priorOnBeforeCompile(shader, renderer);
    shader.uniforms.u_inlandWaterSeamDebugMode = uniform;
    shader.vertexShader = [
      "attribute float inlandWaterOwner;",
      "varying float vInlandWaterOwner;",
      shader.vertexShader
    ].join("\n").replace(
      "#include <begin_vertex>",
      ["#include <begin_vertex>", "vInlandWaterOwner = inlandWaterOwner;"].join("\n")
    );
    shader.fragmentShader = [
      "uniform float u_inlandWaterSeamDebugMode;",
      "varying float vInlandWaterOwner;",
      shader.fragmentShader
    ].join("\n").replace(
      "#include <opaque_fragment>",
      [
        "if (u_inlandWaterSeamDebugMode > 3.5) { discard; }",
        "if (u_inlandWaterSeamDebugMode > 2.5) {",
        "  if (vInlandWaterOwner < 0.5) { discard; }",
        "  outgoingLight = vec3(1.0, 0.12, 0.78);",
        "  diffuseColor.a = 1.0;",
        "} else if (u_inlandWaterSeamDebugMode > 0.5 && u_inlandWaterSeamDebugMode < 1.5) {",
        "  outgoingLight = vInlandWaterOwner > 0.5 ? vec3(1.0, 0.12, 0.78) : vec3(0.14, 0.92, 0.28);",
        "  diffuseColor.a = 1.0;",
        "}",
        "#include <opaque_fragment>"
      ].join("\n")
    );
  };
  material.customProgramCacheKey = () => `${priorCacheKey ? priorCacheKey() : ""}${PROGRAM_KEY_SUFFIX}`;
  material.userData.inlandWaterSeamDebugUniform = uniform;
  material.needsUpdate = true;
};

export const setInlandWaterSeamDebugMaterialMode = (
  material: THREE.Material | THREE.Material[],
  mode: InlandWaterSeamDebugMode
): void => {
  for (const entry of Array.isArray(material) ? material : [material]) {
    const uniform = entry.userData.inlandWaterSeamDebugUniform as { value: number } | undefined;
    if (uniform) uniform.value = getInlandWaterSeamDebugModeValue(mode);
  }
};
