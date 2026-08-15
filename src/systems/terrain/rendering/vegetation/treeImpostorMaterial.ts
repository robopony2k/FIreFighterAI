import * as THREE from "three";
import type { TreeImpostorAtlas, TreeSeasonVisualConfig } from "./treeRenderTypes.js";
import {
  TREE_SCRUB_DECIDUOUS_STRENGTH,
  treeSeasonPhenologyShader
} from "./treeSeasonPhenology.js";

const vertexShader = /* glsl */ `
  attribute float aFrameBase;
  attribute float aTreeRotation;
  attribute float aTreeType;
  attribute float aSeasonPhaseOffset;
  attribute float aLeafDropBias;
  attribute float aAutumnHueBias;
  uniform float uAtlasGrid;
  uniform float uAtlasSize;
  uniform float uSeasonT01;
  varying vec2 vAtlasUv;
  varying vec3 vInstanceTint;
  varying float vTreeType;
  varying float vSeasonT;
  varying float vLeafDropBias;
  varying float vAutumnHueBias;
  #include <fog_pars_vertex>

  void main() {
    vec3 center = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    vec3 toCamera = normalize(cameraPosition - center);
    float viewAngle = atan(toCamera.x, toCamera.z) - aTreeRotation;
    float wrapped = mod(viewAngle + 6.28318530718 + 0.78539816339, 6.28318530718);
    float viewIndex = floor(wrapped / 1.57079632679);
    float frame = aFrameBase + clamp(viewIndex, 0.0, 3.0);
    float frameCol = mod(frame, uAtlasGrid);
    float frameRow = floor(frame / uAtlasGrid);
    float cellPixels = uAtlasSize / uAtlasGrid;
    vec2 insetUv = (uv * (cellPixels - 1.0) + 0.5) / cellPixels;
    vAtlasUv = (insetUv + vec2(frameCol, frameRow)) / uAtlasGrid;

    float widthScale = length(instanceMatrix[0].xyz);
    float heightScale = length(instanceMatrix[1].xyz);
    vec4 mvPosition = viewMatrix * vec4(center, 1.0);
    mvPosition.xy += position.xy * vec2(widthScale, heightScale);
    gl_Position = projectionMatrix * mvPosition;
    vInstanceTint = instanceColor;
    vTreeType = aTreeType;
    vSeasonT = fract(uSeasonT01 + aSeasonPhaseOffset);
    vLeafDropBias = aLeafDropBias;
    vAutumnHueBias = aAutumnHueBias;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uColorAtlas;
  uniform sampler2D uRoleAtlas;
  uniform float uRisk01;
  varying vec2 vAtlasUv;
  varying vec3 vInstanceTint;
  varying float vTreeType;
  varying float vSeasonT;
  varying float vLeafDropBias;
  varying float vAutumnHueBias;
  #include <fog_pars_fragment>
  ${treeSeasonPhenologyShader}

  void main() {
    vec4 atlasColor = texture2D(uColorAtlas, vAtlasUv);
    vec3 roles = texture2D(uRoleAtlas, vAtlasUv).rgb;
    float trunkCoverage = roles.r;
    float leafCoverage = roles.g;
    float mixedCoverage = roles.b;
    float seasonT = fract(vSeasonT);
    float risk = clamp(uRisk01, 0.0, 1.0);
    float autumn = smoothstep(0.62, 0.70, seasonT) * (1.0 - smoothstep(0.90, 0.98, seasonT));
    float winter = clamp(1.0 - smoothstep(0.08, 0.18, seasonT) + smoothstep(0.88, 0.96, seasonT), 0.0, 1.0);
    float spring = smoothstep(0.18, 0.28, seasonT) * (1.0 - smoothstep(0.42, 0.52, seasonT));
    float deciduous = vTreeType < 0.5 ? 0.0 : (vTreeType > 4.5 ? ${TREE_SCRUB_DECIDUOUS_STRENGTH.toFixed(2)} : 1.0);
    float leafCycle = treeSeasonLeafCycle(seasonT, vLeafDropBias);
    float leafPresence = treeSeasonLeafPresence(seasonT, vLeafDropBias, deciduous);
    float roleCoverage = max(trunkCoverage, max(leafCoverage * leafPresence, mixedCoverage * mix(1.0, 0.35, (1.0 - leafCycle) * deciduous)));
    float alpha = atlasColor.a * roleCoverage;
    if (alpha < 0.42) discard;

    vec3 color = atlasColor.rgb * vInstanceTint;
    color = mix(color, vec3(0.77, 0.64, 0.40), risk * 0.24);
    vec3 autumnTint = mix(vec3(0.90, 0.68, 0.31), vec3(0.73, 0.39, 0.22), clamp(0.5 + vAutumnHueBias * 0.5, 0.0, 1.0));
    color = mix(color, autumnTint, autumn * 0.30 * max(leafCoverage, mixedCoverage));
    float luma = dot(color, vec3(0.299, 0.587, 0.114));
    color = mix(color, vec3(luma * 0.95, luma * 0.97, luma * 1.01), winter * 0.36);
    color *= 1.0 + spring * 0.06;
    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export const createTreeImpostorMaterial = (
  atlas: TreeImpostorAtlas,
  seasonVisual?: TreeSeasonVisualConfig
): THREE.ShaderMaterial => {
  const fogUniforms = THREE.UniformsUtils.clone(THREE.UniformsLib.fog);
  const material = new THREE.ShaderMaterial({
    name: "tree-impostor-material",
    uniforms: {
      ...fogUniforms,
      uColorAtlas: { value: atlas.colorTexture },
      uRoleAtlas: { value: atlas.roleTexture },
      uAtlasGrid: { value: atlas.gridSize },
      uAtlasSize: { value: atlas.atlasSize },
      uRisk01: seasonVisual?.uniforms.uRisk01 ?? { value: 0 },
      uSeasonT01: seasonVisual?.uniforms.uSeasonT01 ?? { value: 0 }
    },
    vertexShader,
    fragmentShader,
    side: THREE.DoubleSide,
    transparent: false,
    depthTest: true,
    depthWrite: true,
    fog: true,
    toneMapped: true
  });
  material.alphaToCoverage = true;
  material.userData.treeImpostorMaterial = true;
  return material;
};
