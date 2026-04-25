import { TILE_TYPE_IDS } from "../../../core/state.js";
import {
  CLUSTER_EDGE_KERNEL_CAP,
  CLUSTER_FULL_BLEND_TILES,
  CLUSTER_INTERIOR_KERNEL_CAP,
  FIRE_EMITTER_SLOT_VISIBLE_CUTOFF,
  FIRE_FRONT_VISUAL_MIN,
  FIRE_VISUAL_TUNING,
  FLAME_VISUAL_RELEASE_SECONDS,
  IGNITION_RAMP_ACCELERATION,
  IGNITION_RAMP_SECONDS_BASE,
  IGNITION_RAMP_SECONDS_MIN,
  TREE_BURN_CARRY_FUEL_MIN,
  TREE_BURN_CARRY_PROGRESS_MIN,
  TREE_BURN_FLAME_VISUAL_MIN
} from "../constants/fireRenderConstants.js";
import {
  clearTileEmitterSlots,
  updateGroundTileEmitterSlots,
  updateLocalTileEmitterSlots,
  updateObjectTileEmitterSlots
} from "./fireRenderAnalysisState.js";
import { clamp, hash1, smoothApproach, smoothstep } from "./fireRenderMath.js";
import type { FireRenderAnalysisState } from "./fireRenderPlanningTypes.js";
import type { FireFxTerrainSize, FireFxTreeBurnController, FireFxTreeFlameProfile, FireFxWorldState } from "./fireFxTypes.js";
import type { FireFieldView } from "./fireRenderSnapshot.js";
import { getNeighbourFireBias } from "./fireRenderSnapshot.js";

export type MeasureActiveFireTilesInput = {
  world: FireFxWorldState;
  fireView: FireFieldView;
  treeBurn: FireFxTreeBurnController | null;
  cols: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  simFireEps: number;
};

export const measureActiveFireTiles = (
  input: MeasureActiveFireTilesInput
): { activeFlameTileCount: number; visualActiveWeight: number } => {
  const { world, fireView, treeBurn, cols, minX, maxX, minY, maxY, simFireEps } = input;
  let activeFlameTileCount = 0;
  let visualActiveWeight = 0;
  for (let y = minY; y <= maxY; y += 1) {
    const rowBase = y * cols;
    for (let x = minX; x <= maxX; x += 1) {
      const idx = rowBase + x;
      const fire = fireView.getFireByIndex(idx);
      const heatRelease = fireView.getHeatReleaseByIndex(idx);
      if (fire > simFireEps) {
        activeFlameTileCount += 1;
        visualActiveWeight += clamp(
          smoothstep(simFireEps * 0.5, 0.45, fire) +
            smoothstep(0.01, 0.24, heatRelease) * 0.42 +
            fire * 0.16 +
            fireView.getHeat01ByIndex(idx) * 0.1,
          0,
          1.2
        );
        continue;
      }
      const heat = fireView.getHeat01ByIndex(idx);
      if (heat <= 0.08) {
        continue;
      }
      const fuel = fireView.getFuelByIndex(idx);
      const isAshTile = (world.tileTypeId[idx] ?? -1) === TILE_TYPE_IDS.ash;
      if (fuel <= TREE_BURN_CARRY_FUEL_MIN || isAshTile) {
        continue;
      }
      const flameProfile: FireFxTreeFlameProfile | null = treeBurn?.getTileFlameProfile(idx) ?? null;
      if (!flameProfile) {
        continue;
      }
      const treeBurnVisual = treeBurn?.getTileBurnVisual(idx) ?? 0;
      const burnProgress = treeBurn?.getTileBurnProgress(idx) ?? 0;
      if (treeBurnVisual > TREE_BURN_FLAME_VISUAL_MIN && burnProgress > TREE_BURN_CARRY_PROGRESS_MIN) {
        activeFlameTileCount += 1;
        visualActiveWeight += clamp(treeBurnVisual * 0.72 + heat * 0.18, 0, 0.95);
      }
    }
  }
  return { activeFlameTileCount, visualActiveWeight };
};

export type PlanFireTileVisualsInput = {
  state: FireRenderAnalysisState;
  world: FireFxWorldState;
  fireView: FireFieldView;
  treeBurn: FireFxTreeBurnController | null;
  terrainSize: FireFxTerrainSize;
  cols: number;
  rows: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  sampleStep: number;
  simFireEps: number;
  flamePresenceEps: number;
  deltaSeconds: number;
  smokeDeltaSeconds: number;
  tileSpan: number;
  flameDensityScale: number;
  groundDensityScale: number;
  sliceComplexityScale: number;
  flameBudgetScale: number;
  frontPassActive: boolean;
  frontFieldReadScale: number;
};

export const planFireTileVisuals = (input: PlanFireTileVisualsInput): { visibleFlameTiles: number } => {
  const {
    state,
    world,
    fireView,
    treeBurn,
    terrainSize,
    cols,
    rows,
    minX,
    maxX,
    minY,
    maxY,
    sampleStep,
    simFireEps,
    flamePresenceEps,
    deltaSeconds,
    smokeDeltaSeconds,
    tileSpan,
    flameDensityScale,
    groundDensityScale,
    sliceComplexityScale,
    flameBudgetScale,
    frontPassActive,
    frontFieldReadScale
  } = input;
  let visibleFlameTiles = 0;
  for (let y = minY; y <= maxY; y += sampleStep) {
    const rowBase = y * cols;
    for (let x = minX; x <= maxX; x += sampleStep) {
      const idx = rowBase + x;
      const fire = fireView.getFireByIndex(idx);
      const heat = fireView.getHeat01ByIndex(idx);
      const heatRelease = fireView.getHeatReleaseByIndex(idx);
      const simBurnAge = fireView.getBurnAgeByIndex(idx);
      const fuel = fireView.getFuelByIndex(idx);
      const typeId = world.tileTypeId[idx] ?? -1;
      const isAshTile = typeId === TILE_TYPE_IDS.ash;
      const flameProfile: FireFxTreeFlameProfile | null = treeBurn?.getTileFlameProfile(idx) ?? null;
      const burnProgress = treeBurn?.getTileBurnProgress(idx) ?? 0;
      const isStructureTile = typeId === TILE_TYPE_IDS.house || typeId === TILE_TYPE_IDS.base;
      const hasActiveFire = fire > simFireEps;
      const heatRelease01 = smoothstep(0.01, 0.24, heatRelease);
      const treeBurnVisual = treeBurn?.getTileBurnVisual(idx) ?? 0;
      const hasCarryFuel = fuel > TREE_BURN_CARRY_FUEL_MIN && !isAshTile;
      const hasTreeCarryFlame =
        !hasActiveFire &&
        hasCarryFuel &&
        flameProfile !== null &&
        treeBurnVisual > TREE_BURN_FLAME_VISUAL_MIN &&
        burnProgress > TREE_BURN_CARRY_PROGRESS_MIN &&
        heat > 0.08;
      const neighbourFire = getNeighbourFireBias(fireView, cols, rows, x, y);
      const flameVisual = hasActiveFire ? Math.max(fire, treeBurnVisual * 0.95) : hasTreeCarryFlame ? treeBurnVisual * 0.72 : 0;
      const suppressAshResidualFlame = isAshTile && !hasActiveFire;
      const hasRenderableFlame = !suppressAshResidualFlame && (hasActiveFire || hasTreeCarryFlame);
      if (hasRenderableFlame) {
        visibleFlameTiles += 1;
      }
      const targetFlameBase = hasActiveFire
        ? clamp(flameVisual * 0.42 + heatRelease01 * 0.52 + heat * 0.18 + treeBurnVisual * 0.08, 0, 1)
        : hasTreeCarryFlame
          ? clamp(flameVisual * 0.8 + heat * 0.24, 0, 1)
          : 0;
      const previousFlame = state.tileFlameVisual[idx] ?? 0;
      let ignitionAgeSeconds = state.tileIgnitionAgeSeconds[idx] ?? 0;
      const sustainIgnitionAge =
        !suppressAshResidualFlame && (hasActiveFire || hasTreeCarryFlame || fire > simFireEps * 0.35 || previousFlame > 0.04);
      if (sustainIgnitionAge) {
        ignitionAgeSeconds = Math.min(8, ignitionAgeSeconds + deltaSeconds);
      } else {
        ignitionAgeSeconds = Math.max(0, ignitionAgeSeconds - deltaSeconds * 6);
      }
      if (hasActiveFire) {
        ignitionAgeSeconds = Math.max(ignitionAgeSeconds, Math.min(8, simBurnAge));
      }
      const radiantDrive = clamp(heat * 0.62 + neighbourFire * 0.88, 0, 1.2);
      const rampSecondsEffective = clamp(
        IGNITION_RAMP_SECONDS_BASE * (1 - radiantDrive * IGNITION_RAMP_ACCELERATION),
        IGNITION_RAMP_SECONDS_MIN,
        IGNITION_RAMP_SECONDS_BASE
      );
      const ignitionRamp01 = hasActiveFire ? smoothstep(0, rampSecondsEffective, ignitionAgeSeconds) : hasTreeCarryFlame ? 1 : 0;
      const targetFlame = hasActiveFire
        ? clamp(targetFlameBase * (0.1 + 0.9 * ignitionRamp01), 0, 1)
        : clamp(targetFlameBase, 0, 1);
      const smoothedFlame = suppressAshResidualFlame
        ? 0
        : hasRenderableFlame
          ? smoothApproach(previousFlame, targetFlame, 9.4, Math.max(7.6, 1 / Math.max(0.001, FLAME_VISUAL_RELEASE_SECONDS)), deltaSeconds)
          : smoothApproach(previousFlame, 0, 0, Math.max(8.2, 1 / Math.max(0.001, FLAME_VISUAL_RELEASE_SECONDS)), deltaSeconds);
      if (suppressAshResidualFlame || !hasRenderableFlame) {
        ignitionAgeSeconds = 0;
        clearTileEmitterSlots(state.tileLocalFlameSlotActivation, idx, FIRE_VISUAL_TUNING.tongueSpawnMax);
        clearTileEmitterSlots(state.tileGroundFlameSlotActivation, idx, FIRE_VISUAL_TUNING.groundFlameSpawnMax);
        clearTileEmitterSlots(state.tileObjectFlameSlotActivation, idx, 2);
      }
      state.tileIgnitionAgeSeconds[idx] = ignitionAgeSeconds;
      state.tileFlameVisual[idx] = smoothedFlame;
      const targetSmoke = hasActiveFire || hasTreeCarryFlame
        ? clamp(Math.max(targetFlameBase * 0.72, heatRelease01 * 0.92, heat * 0.78, treeBurnVisual * 0.8), 0, 1.2)
        : 0;
      const smoothedSmoke = hasActiveFire || hasTreeCarryFlame
        ? smoothApproach(state.tileSmokeVisual[idx] ?? 0, targetSmoke, 10.0, 6.6, smokeDeltaSeconds)
        : smoothApproach(state.tileSmokeVisual[idx] ?? 0, 0, 0, 9.4, smokeDeltaSeconds);
      state.tileSmokeVisual[idx] = smoothedSmoke;

      const tileCluster = state.tileClusterId[idx] >= 0 ? state.fireClusters[state.tileClusterId[idx]] ?? null : null;
      const tileRole = tileCluster ? (state.tileClusterRole[idx] as 0 | 1 | 2) : 0;
      const clusterBlend = tileCluster
        ? clamp((tileCluster.tileCount - 3) / Math.max(1, CLUSTER_FULL_BLEND_TILES - 3), 0, 1)
        : 0;
      const frontPerimeter01 = state.tileFrontPerimeter01[idx] ?? 0;
      const frontArrival01 = state.tileFrontArrival01[idx] ?? 0;
      const frontAdvance01 = state.tileFrontAdvance01[idx] ?? 0;
      const frontSteerStrength = clamp(frontArrival01 * (0.48 + frontAdvance01 * 0.52) + frontPerimeter01 * 0.34, 0, 1.25);
      if (tileCluster) {
        const tileCenterX = ((x + 0.5) / cols - 0.5) * terrainSize.width;
        const tileCenterZ = ((y + 0.5) / rows - 0.5) * terrainSize.depth;
        const distNorm = Math.hypot(tileCenterX - tileCluster.centroidX, tileCenterZ - tileCluster.centroidZ) /
          Math.max(tileSpan * 0.75, tileCluster.radius * 1.05);
        const plumeInfluence = 1 - smoothstep(0.38, 1.08, distNorm);
        state.tileSmokeOcclusion01[idx] = clamp(
          smoothedSmoke * (0.48 + clusterBlend * 0.25) + plumeInfluence * clusterBlend * (0.24 + tileCluster.intensity * 0.26),
          0,
          1
        );
      } else {
        state.tileSmokeOcclusion01[idx] = clamp(smoothedSmoke * 0.16, 0, 1);
      }

      const flameIntensity = clamp(smoothedFlame, 0, 1);
      const tongueDrive = clamp(
        (
          flameIntensity * 0.9 +
          heat * 0.38 +
          (neighbourFire - flameIntensity) * FIRE_VISUAL_TUNING.clusterStrength * 0.7 +
          (0.5 + 0.5 * Math.sin((hash1(idx * 0.173 + 5.17) * Math.PI * 2) + hash1(idx * 0.173 + 5.17))) * 0.24 -
          0.1
        ) * clamp(0.28 + ignitionRamp01 * 0.72, 0.28, 1),
        0,
        1.2
      );
      let flameletTargetCount =
        (FIRE_VISUAL_TUNING.tongueSpawnMin +
          (FIRE_VISUAL_TUNING.tongueSpawnMax - FIRE_VISUAL_TUNING.tongueSpawnMin) * clamp(tongueDrive, 0, 1)) *
        flameDensityScale *
        sliceComplexityScale;
      if (tileRole === 2) {
        flameletTargetCount = Math.min(flameletTargetCount, flameBudgetScale < 0.62 ? 1 : CLUSTER_INTERIOR_KERNEL_CAP);
      } else if (tileRole === 1) {
        flameletTargetCount = Math.min(flameletTargetCount, CLUSTER_EDGE_KERNEL_CAP);
      }
      flameletTargetCount = Math.max(0, Math.min(FIRE_VISUAL_TUNING.tongueSpawnMax, flameletTargetCount));
      if (flameletTargetCount > state.renderContinuityState.smoothedPerTileFlameCap + 0.001) {
        state.renderContinuityState.budgetClampedDrops += flameletTargetCount - state.renderContinuityState.smoothedPerTileFlameCap;
      }
      flameletTargetCount = Math.min(flameletTargetCount, state.renderContinuityState.smoothedPerTileFlameCap);
      const frontRead01 = frontPassActive ? clamp(frontArrival01 * 0.96 + frontPerimeter01 * 0.52, 0, 1.25) * frontFieldReadScale : 0;
      const preserveLocalDetail =
        flameProfile !== null
          ? 0.34
          : isStructureTile
            ? 0.28
            : frontPassActive
              ? 0.18
              : hasActiveFire
                ? 0.58
                : 0.22;
      const localDetailScale = clamp(
        preserveLocalDetail +
          frontRead01 * (flameProfile !== null ? 0.22 : isStructureTile ? 0.16 : 0.08) +
          frontArrival01 * ((flameProfile !== null || isStructureTile) ? -0.1 : -0.22) +
          (tileRole === 1 ? 0.08 : 0),
        Math.max(0.06, preserveLocalDetail * ((flameProfile !== null || isStructureTile) ? 0.72 : 0.38)),
        (flameProfile !== null || isStructureTile) ? 0.62 : frontPassActive ? 0.28 : 0.74
      );
      flameletTargetCount *= localDetailScale;
      if (frontPassActive && tileRole === 2 && Math.min(1.35, frontPerimeter01 * (hasActiveFire ? 0.92 : 0.28) + frontArrival01 * 1.16) < FIRE_FRONT_VISUAL_MIN && flameProfile === null) {
        flameletTargetCount = 0;
      }
      const sustainInteriorFlame =
        hasActiveFire && flameProfile === null && fire > 0.16 && heat > 0.2 && smoothedFlame > Math.max(flamePresenceEps * 1.1, 0.08);
      if (sustainInteriorFlame) {
        flameletTargetCount = Math.max(flameletTargetCount, 0.36);
      }
      updateLocalTileEmitterSlots(state, idx, flameletTargetCount, deltaSeconds);

      const groundFlameDrive = hasActiveFire
        ? clamp(
            (
              Math.max(smoothedFlame, heat * 0.5) * 0.78 +
              heat * 0.5 +
              (neighbourFire - flameIntensity) * FIRE_VISUAL_TUNING.clusterStrength * 0.45 +
              0.15 * (0.5 + 0.5 * Math.sin(hash1(idx * 0.173 + 5.17) * Math.PI * 2)) -
              0.1
            ) * clamp(0.28 + ignitionRamp01 * 0.72, 0.28, 1),
            0,
            1.2
          )
        : 0;
      let groundFlameTargetCount =
        (FIRE_VISUAL_TUNING.groundFlameSpawnMin +
          (FIRE_VISUAL_TUNING.groundFlameSpawnMax - FIRE_VISUAL_TUNING.groundFlameSpawnMin) * clamp(groundFlameDrive, 0, 1)) *
        groundDensityScale;
      const groundDetailScale = clamp(
        (frontPassActive ? 0.06 : 0.26) +
          (1 - clamp(frontRead01 + frontArrival01 * 0.32, 0, 1)) * 0.42 +
          (flameProfile !== null ? 0.08 : 0),
        0.04,
        frontPassActive ? 0.52 : 0.82
      );
      groundFlameTargetCount *= groundDetailScale;
      if (groundFlameTargetCount > state.renderContinuityState.smoothedPerTileGroundCap + 0.001) {
        state.renderContinuityState.budgetClampedDrops += groundFlameTargetCount - state.renderContinuityState.smoothedPerTileGroundCap;
      }
      groundFlameTargetCount = Math.min(groundFlameTargetCount, state.renderContinuityState.smoothedPerTileGroundCap);
      const sustainGroundFlame =
        hasActiveFire && fire > 0.22 && heat > 0.24 && smoothedFlame > Math.max(flamePresenceEps * 1.1, 0.1);
      if (sustainGroundFlame) {
        groundFlameTargetCount = Math.max(groundFlameTargetCount, 0.34);
      }
      updateGroundTileEmitterSlots(state, idx, groundFlameTargetCount, deltaSeconds);

      const hasObjectAnchorFlame = flameProfile !== null || isStructureTile;
      const objectFrontSuppression = hasObjectAnchorFlame
        ? clamp(frontArrival01 * (0.26 + (1 - frontAdvance01) * 0.34), 0, 0.58)
        : 0;
      const objectFlameDrive = clamp(
        smoothedFlame * (hasActiveFire ? clamp(0.22 + ignitionRamp01 * 0.78, 0.22, 1) : 1) * (1 - objectFrontSuppression),
        0,
        1
      );
      let objectFlameTargetCount = 0;
      if (hasObjectAnchorFlame) {
        objectFlameTargetCount = Math.min(
          2,
          (flameProfile !== null ? 0.5 + objectFlameDrive * 1.15 : 0.42 + objectFlameDrive * 0.92) * sliceComplexityScale
        );
      }
      updateObjectTileEmitterSlots(state, idx, objectFlameTargetCount, deltaSeconds);
    }
  }
  return { visibleFlameTiles };
};
