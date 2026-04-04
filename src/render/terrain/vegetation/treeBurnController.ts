import * as THREE from "three";
import type { WorldState } from "../../../core/state.js";
import { TreeType } from "../../../core/types.js";

const TREE_BURN_UPDATE_INTERVAL_MS = 120;
export const TREE_BURN_FUEL_EPS = 0.02;
const TREE_BURN_FIRE_BOUNDS_PADDING = 2;
const TREE_BURN_VISIBLE_EPS = 0.004;
const TREE_BURN_PROGRESS_PER_SECOND = 0.12;
const TREE_BURN_RECOVERY_PER_SECOND = 0.08;
const TREE_BURN_ASH_CATCHUP_PER_SECOND = 1.85;
const TREE_BURN_POST_FIRE_TAIL_MS = 8000;
const TREE_BURN_ACTIVE_FIRE_EPS = 0.015;
const TREE_BURN_ACTIVE_HEAT_EPS = 0.12;
const TREE_BURN_CARRY_HEAT_EPS = 0.08;
const TREE_BURN_VISUAL_EPS = 0.06;
const TREE_BURN_FUEL_GAUGE_START = 0.16;
const TREE_BURN_FUEL_GAUGE_END = 0.95;
const TREE_BURN_EMBER_TAIL_START = 0.58;
const TREE_BURN_EMBER_TAIL_END = 0.98;
const TREE_BURN_COMPLETE_TARGET = 1.12;
export const TREE_BURN_LEAF_PIVOT_HEIGHT_FACTOR = 0.72;
export const TREE_BURN_MIXED_PIVOT_HEIGHT_FACTOR = 0.46;
export const TREE_BURN_TRUNK_PIVOT_HEIGHT_FACTOR = 0.06;
export const TREE_LEAF_DROP_BIAS_MAX = 0.22;

export type TreeSeasonVisualConfig = {
  enabled: boolean;
  uniforms: {
    uRisk01: { value: number };
    uSeasonT01: { value: number };
    uWorldSeed: { value: number };
  };
  phaseShiftMax: number;
  rateJitter: number;
  autumnHueJitter: number;
};

export type TreeBurnMeshRole = "leaf" | "trunk" | "mixed";

export type TreeBurnMeshState = {
  mesh: THREE.InstancedMesh;
  role: TreeBurnMeshRole;
  baseMatrix: THREE.Matrix4;
  tileIndices: Uint32Array;
  tileX: Uint16Array;
  tileY: Uint16Array;
  baseX: Float32Array;
  baseY: Float32Array;
  baseZ: Float32Array;
  baseRotation: Float32Array;
  baseScale: Float32Array;
  scalePivotY: Float32Array;
  fuelReference: Float32Array;
  burnProgress: Float32Array;
  burnQ: Uint8Array;
  visibilityQ: Uint8Array;
  cropTopAttr: THREE.InstancedBufferAttribute | null;
  cropMinY: number;
  cropMaxY: number;
};

export type TreeFlameProfile = {
  x: number;
  y: number;
  z: number;
  crownHeight: number;
  crownRadius: number;
  trunkHeight: number;
  treeCount: number;
};

export type TreeBurnController = {
  update: (timeMs: number, world: WorldState) => void;
  getTileBurnVisual: (tileIndex: number) => number;
  getTileBurnProgress: (tileIndex: number) => number;
  getTileAnchor: (tileIndex: number) => { x: number; y: number; z: number } | null;
  getTileFlameProfile: (tileIndex: number) => TreeFlameProfile | null;
  getVisualBounds: () => { minX: number; maxX: number; minY: number; maxY: number } | null;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const getTreeBurnRole = (material: THREE.Material | THREE.Material[]): TreeBurnMeshRole => {
  const materials = Array.isArray(material) ? material : [material];
  let leafCount = 0;
  materials.forEach((mat) => {
    if ((mat as THREE.Material & { userData?: Record<string, unknown> }).userData?.treeLeafHint === true) {
      leafCount += 1;
    }
  });
  if (leafCount <= 0) {
    // Low-poly imports often ship as a single combined material with no leaf naming hints.
    // Treat those as mixed so they fully collapse instead of relying on trunk-only top cropping.
    return materials.length <= 1 ? "mixed" : "trunk";
  }
  if (leafCount >= materials.length) {
    return "leaf";
  }
  return "mixed";
};

export const applyTrunkTopCropShader = (material: THREE.Material | THREE.Material[]): void => {
  const materials = Array.isArray(material) ? material : [material];
  materials.forEach((mat) => {
    const standard = mat as THREE.MeshStandardMaterial & { userData?: Record<string, unknown> };
    if (!(standard instanceof THREE.MeshStandardMaterial)) {
      return;
    }
    if (!standard.userData) {
      standard.userData = {};
    }
    if (standard.userData.treeTrunkTopCropPatched) {
      return;
    }
    const priorOnBeforeCompile = standard.onBeforeCompile;
    standard.onBeforeCompile = (shader, renderer) => {
      if (priorOnBeforeCompile) {
        priorOnBeforeCompile(shader, renderer);
      }
      shader.vertexShader =
        `attribute float aCropTop;\n` +
        `varying float vCropTop;\n` +
        `varying float vCropLocalY;\n` +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>\n` + `vCropTop = aCropTop;\n` + `vCropLocalY = transformed.y;`
      );
      shader.fragmentShader =
        `varying float vCropTop;\n` + `varying float vCropLocalY;\n` + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "void main() {",
        `void main() {\n` + `  if (vCropLocalY > vCropTop) discard;`
      );
    };
    standard.userData.treeTrunkTopCropPatched = true;
    standard.needsUpdate = true;
  });
};

const getDeciduousStrength = (treeType: TreeType): number => {
  if (treeType === TreeType.Pine) {
    return 0;
  }
  if (treeType === TreeType.Scrub) {
    return 0.45;
  }
  return 1;
};

export const applyTreeSeasonShader = (
  material: THREE.Material | THREE.Material[],
  seasonVisual: TreeSeasonVisualConfig | null,
  treeType: TreeType
): void => {
  if (!seasonVisual || !seasonVisual.enabled) {
    return;
  }
  const materials = Array.isArray(material) ? material : [material];
  const deciduousStrength = getDeciduousStrength(treeType);
  materials.forEach((mat) => {
    const standard = mat as THREE.MeshStandardMaterial & { userData?: Record<string, unknown> };
    if (!(standard instanceof THREE.MeshStandardMaterial)) {
      return;
    }
    if (!standard.userData) {
      standard.userData = {};
    }
    if (standard.userData.treeSeasonPatched) {
      return;
    }
    const isLeafMaterial = standard.userData.treeLeafHint === true;
    if (isLeafMaterial && deciduousStrength > 0.01) {
      standard.transparent = true;
    }
    const priorOnBeforeCompile = standard.onBeforeCompile;
    standard.onBeforeCompile = (shader, renderer) => {
      if (priorOnBeforeCompile) {
        priorOnBeforeCompile(shader, renderer);
      }
      shader.uniforms.uRisk01 = seasonVisual.uniforms.uRisk01;
      shader.uniforms.uSeasonT01 = seasonVisual.uniforms.uSeasonT01;
      shader.vertexShader =
        `attribute float aSeasonPhaseOffset;\n` +
        `attribute float aSeasonRateJitter;\n` +
        `attribute float aLeafDropBias;\n` +
        `attribute float aAutumnHueBias;\n` +
        `varying float vTreeSeasonT;\n` +
        `varying float vLeafDropBias;\n` +
        `varying float vAutumnHueBias;\n` +
        `uniform float uSeasonT01;\n` +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <begin_vertex>",
        [
          "#include <begin_vertex>",
          "vTreeSeasonT = fract(uSeasonT01 * (1.0 + aSeasonRateJitter) + aSeasonPhaseOffset);",
          "vLeafDropBias = aLeafDropBias;",
          "vAutumnHueBias = aAutumnHueBias;"
        ].join("\n")
      );
      shader.fragmentShader =
        `uniform float uRisk01;\n` +
        `varying float vTreeSeasonT;\n` +
        `varying float vLeafDropBias;\n` +
        `varying float vAutumnHueBias;\n` +
        shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <color_fragment>",
        [
          "#include <color_fragment>",
          "float seasonT = fract(vTreeSeasonT);",
          "float risk = clamp(uRisk01, 0.0, 1.0);",
          "float autumn = smoothstep(0.62, 0.70, seasonT) * (1.0 - smoothstep(0.90, 0.98, seasonT));",
          "float winterA = 1.0 - smoothstep(0.08, 0.18, seasonT);",
          "float winterB = smoothstep(0.88, 0.96, seasonT);",
          "float winter = clamp(winterA + winterB, 0.0, 1.0);",
          "float spring = smoothstep(0.18, 0.28, seasonT) * (1.0 - smoothstep(0.42, 0.52, seasonT));",
          "vec3 riskTint = vec3(0.77, 0.64, 0.40);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, riskTint, risk * 0.24);",
          "vec3 autumnGold = vec3(0.90, 0.68, 0.31);",
          "vec3 autumnRust = vec3(0.73, 0.39, 0.22);",
          "vec3 autumnTint = mix(autumnGold, autumnRust, clamp(0.5 + vAutumnHueBias * 0.5, 0.0, 1.0));",
          "diffuseColor.rgb = mix(diffuseColor.rgb, autumnTint, autumn * 0.30);",
          "float luma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));",
          "vec3 winterTint = vec3(luma * 0.95, luma * 0.97, luma * 1.01);",
          "diffuseColor.rgb = mix(diffuseColor.rgb, winterTint, winter * 0.36);",
          "diffuseColor.rgb *= 1.0 + spring * 0.06;"
        ].join("\n")
      );
      if (isLeafMaterial && deciduousStrength > 0.01) {
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <dithering_fragment>",
          [
            "float dropStart = 0.72 + vLeafDropBias * 0.12;",
            "float dropEnd = 0.98 + vLeafDropBias * 0.12;",
            "float leafDrop = smoothstep(dropStart, dropEnd, seasonT);",
            `float leafPresence = clamp(1.0 - leafDrop * ${deciduousStrength.toFixed(4)}, 0.06, 1.0);`,
            "diffuseColor.a *= leafPresence;",
            "#include <dithering_fragment>"
          ].join("\n")
        );
      }
    };
    standard.userData.treeSeasonPatched = true;
    standard.needsUpdate = true;
  });
};

export const createTreeBurnController = (
  meshStates: TreeBurnMeshState[],
  ashId: number,
  tileProfiles: Map<number, TreeFlameProfile>
): TreeBurnController => {
  const dummy = new THREE.Object3D();
  const tempMatrix = new THREE.Matrix4();
  const tempColor = new THREE.Color(1, 1, 1);
  const whiteTint = new THREE.Color(1, 1, 1);
  const leafScorchTint = new THREE.Color(1.08, 0.79, 0.45);
  const leafCharTint = new THREE.Color(0.2, 0.19, 0.18);
  const trunkScorchTint = new THREE.Color(1.02, 0.66, 0.43);
  const trunkCharTint = new THREE.Color(0.26, 0.24, 0.22);
  let lastUpdateMs = 0;
  let postFireTailUntilMs = 0;
  let tileVisual = new Map<number, number>();
  let tileProgress = new Map<number, number>();
  let visualBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;

  const applyState = (state: TreeBurnMeshState, index: number, burn: number): boolean => {
    let scorch = 0;
    let char = 0;
    let visibility = 1;
    if (state.role === "leaf") {
      scorch = smoothstep(0.12, 0.55, burn);
      char = smoothstep(0.45, 0.82, burn);
      visibility = 1 - smoothstep(0.54, 0.88, burn);
      tempColor.copy(whiteTint).lerp(leafScorchTint, scorch).lerp(leafCharTint, char);
    } else if (state.role === "trunk") {
      // Delay trunk disappearance so flame visibility leads structural collapse.
      scorch = smoothstep(0.45, 0.82, burn);
      char = smoothstep(0.68, 0.96, burn);
      visibility = 1 - smoothstep(0.78, 1.04, burn);
      tempColor.copy(whiteTint).lerp(trunkScorchTint, scorch).lerp(trunkCharTint, char);
    } else {
      scorch = smoothstep(0.2, 0.72, burn);
      char = smoothstep(0.7, 1.02, burn);
      visibility = 1 - smoothstep(0.82, 1.08, burn);
      tempColor.copy(whiteTint).lerp(leafScorchTint, scorch).lerp(trunkCharTint, char);
    }
    visibility = clamp(visibility, 0, 1);
    const burnQ = Math.round(clamp(burn, 0, 1.2) * (255 / 1.2));
    const visibilityQ = Math.round(visibility * 255);
    if (state.burnQ[index] === burnQ && state.visibilityQ[index] === visibilityQ) {
      return false;
    }
    state.burnQ[index] = burnQ;
    state.visibilityQ[index] = visibilityQ;
    const scaleFactor = visibility <= TREE_BURN_VISIBLE_EPS ? 0 : visibility;
    const baseScale = state.baseScale[index];
    let posY = state.baseY[index] + (1 - scaleFactor) * state.scalePivotY[index];
    let scaleX = baseScale * scaleFactor;
    let scaleY = baseScale * scaleFactor;
    let scaleZ = baseScale * scaleFactor;
    if (state.role === "trunk") {
      // Trunks use top-down clipping instead of geometric squashing.
      posY = state.baseY[index];
      scaleX = baseScale;
      scaleY = baseScale;
      scaleZ = baseScale;
      if (state.cropTopAttr) {
        const cropSpan = Math.max(0, state.cropMaxY - state.cropMinY);
        const cropTop = state.cropMinY + cropSpan * scaleFactor - 1e-4;
        state.cropTopAttr.setX(index, cropTop);
      }
    }
    dummy.position.set(state.baseX[index], posY, state.baseZ[index]);
    dummy.rotation.set(0, state.baseRotation[index], 0);
    dummy.scale.set(scaleX, scaleY, scaleZ);
    dummy.updateMatrix();
    tempMatrix.copy(dummy.matrix).multiply(state.baseMatrix);
    state.mesh.setMatrixAt(index, tempMatrix);
    state.mesh.setColorAt(index, tempColor);
    return true;
  };

  return {
    update: (timeMs: number, world: WorldState) => {
      if (timeMs - lastUpdateMs < TREE_BURN_UPDATE_INTERVAL_MS) {
        return;
      }
      const elapsedMs = lastUpdateMs > 0 ? timeMs - lastUpdateMs : TREE_BURN_UPDATE_INTERVAL_MS;
      const dt = Math.max(0.001, elapsedMs / 1000);
      lastUpdateMs = timeMs;
      const hasActiveFire = (world.lastActiveFires ?? 0) > 0;
      const useFireBounds = hasActiveFire && world.fireBoundsActive;
      if (hasActiveFire) {
        postFireTailUntilMs = timeMs + TREE_BURN_POST_FIRE_TAIL_MS;
      }
      if (!hasActiveFire && timeMs > postFireTailUntilMs) {
        return;
      }
      const fire = world.tileFire;
      const fuel = world.tileFuel;
      const heat = world.tileHeat;
      const typeIds = world.tileTypeId;
      const heatCap = Math.max(0.01, world.fireSettings.heatCap);
      const minX = useFireBounds ? world.fireMinX - TREE_BURN_FIRE_BOUNDS_PADDING : 0;
      const maxX = useFireBounds ? world.fireMaxX + TREE_BURN_FIRE_BOUNDS_PADDING : -1;
      const minY = useFireBounds ? world.fireMinY - TREE_BURN_FIRE_BOUNDS_PADDING : 0;
      const maxY = useFireBounds ? world.fireMaxY + TREE_BURN_FIRE_BOUNDS_PADDING : -1;
      const nextTileVisual = tileVisual;
      const nextTileProgress = tileProgress;
      nextTileVisual.clear();
      nextTileProgress.clear();
      let nextBounds: { minX: number; maxX: number; minY: number; maxY: number } | null = null;
      meshStates.forEach((state) => {
        let changed = false;
        let minChanged = Number.POSITIVE_INFINITY;
        let maxChanged = -1;
        for (let i = 0; i < state.tileIndices.length; i += 1) {
          const tileIndex = state.tileIndices[i];
          const tileX = state.tileX[i];
          const tileY = state.tileY[i];
          const nearActiveFire =
            useFireBounds && tileX >= minX && tileX <= maxX && tileY >= minY && tileY <= maxY;
          const hasPriorTransition = state.burnQ[i] > 0 || state.visibilityQ[i] < 255;
          if (!nearActiveFire && !hasPriorTransition) {
            continue;
          }
          const isAsh = (typeIds[tileIndex] ?? -1) === ashId;
          const fireNow = clamp(fire[tileIndex] ?? 0, 0, 1);
          const heatNow = clamp((heat[tileIndex] ?? 0) / heatCap, 0, 1);
          const fuelNow = Math.max(0, fuel[tileIndex] ?? 0);
          if (!nearActiveFire && !isAsh && fireNow <= 0 && fuelNow > TREE_BURN_FUEL_EPS && !hasPriorTransition) {
            continue;
          }
          if (fuelNow > state.fuelReference[i] * 1.08) {
            state.fuelReference[i] = fuelNow;
          }
          const fuelRef = Math.max(TREE_BURN_FUEL_EPS, state.fuelReference[i]);
          const fuelRatio = clamp(fuelNow / fuelRef, 0, 1.2);
          const depletion = clamp(1 - fuelRatio, 0, 1);
          let targetBurn = clamp(1 - fuelRatio, 0, 1.15);
          const currentBurn = state.burnProgress[i] ?? 0;
          const carryHeatActive =
            !isAsh &&
            fireNow <= TREE_BURN_ACTIVE_FIRE_EPS &&
            heatNow > TREE_BURN_CARRY_HEAT_EPS &&
            fuelNow > TREE_BURN_FUEL_EPS &&
            currentBurn > 0.06;
          // Treat carry heat as active while fuel remains so tree collapse tracks the visible carry-flame phase.
          const burningNow =
            fireNow > TREE_BURN_ACTIVE_FIRE_EPS ||
            carryHeatActive ||
            (!isAsh && heatNow > TREE_BURN_ACTIVE_HEAT_EPS && depletion > 0.06);
          if (burningNow) {
            const flameDrivenBurn = clamp(fireNow * 0.74 + heatNow * 0.24, 0, 1.05);
            const fuelDrivenBurn = smoothstep(TREE_BURN_FUEL_GAUGE_START, TREE_BURN_FUEL_GAUGE_END, depletion) * 0.82;
            targetBurn = Math.max(targetBurn, flameDrivenBurn, fuelDrivenBurn);
            if (!isAsh) {
              // Keep some lag so structure does not vanish before the tile is nearly exhausted.
              const flameCap = flameDrivenBurn + 0.26 + depletion * 0.58;
              targetBurn = Math.min(targetBurn, flameCap);
            }
            if (isAsh) {
              targetBurn = Math.max(targetBurn, TREE_BURN_COMPLETE_TARGET);
            }
          } else if (isAsh) {
            // Once converted to ash, quickly finish the structural collapse.
            targetBurn = Math.max(targetBurn, TREE_BURN_COMPLETE_TARGET);
          } else {
            // Let late-stage fuel depletion keep advancing burn even if flame intensity just dipped.
            const emberTailBurn = smoothstep(TREE_BURN_EMBER_TAIL_START, TREE_BURN_EMBER_TAIL_END, depletion) * 0.8;
            targetBurn = Math.max(Math.min(currentBurn, targetBurn), emberTailBurn);
          }
          let nextBurn = currentBurn;
          let riseRate = TREE_BURN_PROGRESS_PER_SECOND;
          if (burningNow) {
            riseRate *= 1 + fireNow * 0.9 + heatNow * 0.35 + depletion * 0.7;
          } else if (!isAsh && depletion > TREE_BURN_EMBER_TAIL_START) {
            riseRate *= 1 + (depletion - TREE_BURN_EMBER_TAIL_START) * 0.7;
          }
          if (isAsh) {
            riseRate = Math.max(riseRate, TREE_BURN_ASH_CATCHUP_PER_SECOND);
          }
          if (targetBurn > currentBurn) {
            nextBurn = Math.min(targetBurn, currentBurn + dt * riseRate);
          } else if (targetBurn < currentBurn) {
            nextBurn = Math.max(targetBurn, currentBurn - dt * TREE_BURN_RECOVERY_PER_SECOND);
          }
          state.burnProgress[i] = nextBurn;
          if (applyState(state, i, nextBurn)) {
            changed = true;
            if (i < minChanged) {
              minChanged = i;
            }
            if (i > maxChanged) {
              maxChanged = i;
            }
          }
          const prevBurn = nextTileProgress.get(tileIndex) ?? 0;
          if (nextBurn > prevBurn) {
            nextTileProgress.set(tileIndex, nextBurn);
          }
          let burnVisual = Math.max(fireNow, heatNow * 0.55);
          if (burningNow && nextBurn > 0.08) {
            burnVisual = Math.max(burnVisual, 0.16 + nextBurn * 0.45);
          } else if (!burningNow) {
            burnVisual *= 0.45;
          }
          const prevVisual = nextTileVisual.get(tileIndex) ?? 0;
          if (burnVisual > prevVisual) {
            nextTileVisual.set(tileIndex, burnVisual);
          }
          if (burnVisual > TREE_BURN_VISUAL_EPS) {
            if (!nextBounds) {
              nextBounds = { minX: tileX, maxX: tileX, minY: tileY, maxY: tileY };
            } else {
              if (tileX < nextBounds.minX) nextBounds.minX = tileX;
              if (tileX > nextBounds.maxX) nextBounds.maxX = tileX;
              if (tileY < nextBounds.minY) nextBounds.minY = tileY;
              if (tileY > nextBounds.maxY) nextBounds.maxY = tileY;
            }
          }
        }
        if (changed && maxChanged >= minChanged) {
          const instanceCount = maxChanged - minChanged + 1;
          const matrixAttr = state.mesh.instanceMatrix;
          matrixAttr.clearUpdateRanges();
          matrixAttr.addUpdateRange(minChanged * 16, instanceCount * 16);
          matrixAttr.needsUpdate = true;
          if (state.mesh.instanceColor) {
            const colorAttr = state.mesh.instanceColor;
            colorAttr.setUsage(THREE.DynamicDrawUsage);
            colorAttr.clearUpdateRanges();
            colorAttr.addUpdateRange(minChanged * 3, instanceCount * 3);
            colorAttr.needsUpdate = true;
          }
          if (state.cropTopAttr) {
            state.cropTopAttr.clearUpdateRanges();
            state.cropTopAttr.addUpdateRange(minChanged, instanceCount);
            state.cropTopAttr.needsUpdate = true;
          }
        }
      });
      visualBounds = nextBounds;
    },
    getTileBurnVisual: (tileIndex: number): number => {
      return tileVisual.get(tileIndex) ?? 0;
    },
    getTileBurnProgress: (tileIndex: number): number => {
      return tileProgress.get(tileIndex) ?? 0;
    },
    getTileAnchor: (tileIndex: number): { x: number; y: number; z: number } | null => {
      const profile = tileProfiles.get(tileIndex);
      return profile ? { x: profile.x, y: profile.y, z: profile.z } : null;
    },
    getTileFlameProfile: (tileIndex: number): TreeFlameProfile | null => {
      return tileProfiles.get(tileIndex) ?? null;
    },
    getVisualBounds: (): { minX: number; maxX: number; minY: number; maxY: number } | null => {
      return visualBounds;
    }
  };
};
