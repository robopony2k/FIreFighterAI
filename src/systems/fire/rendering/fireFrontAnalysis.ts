import { TILE_TYPE_IDS } from "../../../core/state.js";
import {
  ENABLE_FLAME_FRONT_PASS,
  FIRE_FRONT_BUDGET_FALL_RATE,
  FIRE_FRONT_BUDGET_RISE_RATE,
  FIRE_FRONT_MAX_INSTANCES,
  FIRE_FRONT_MIN_INSTANCES,
  FIRE_FRONT_PASS_MIN_WEIGHT,
  FIRE_FRONT_VISUAL_MIN
} from "../constants/fireRenderConstants.js";
import { clamp, smoothApproach, smoothstep } from "./fireRenderMath.js";
import type {
  DirectedFrontEdgeState,
  FireRenderAnalysisState,
  FrontCorridor,
  FrontDirection,
  FrontEdgeOrientation
} from "./fireRenderPlanningTypes.js";
import type {
  FireFxTreeBurnController,
  FireFxTreeFlameProfile,
  FireFxWorldState,
  ResolvedFireAnchor
} from "./fireFxTypes.js";
import type { FireFieldView } from "./fireRenderSnapshot.js";

const FRONT_DIRECTION_DATA: ReadonlyArray<{
  dx: number;
  dy: number;
  normalX: number;
  normalZ: number;
  tangentX: number;
  tangentZ: number;
  orientation: FrontEdgeOrientation;
}> = [
  { dx: -1, dy: 0, normalX: -1, normalZ: 0, tangentX: 0, tangentZ: 1, orientation: "vertical" },
  { dx: 1, dy: 0, normalX: 1, normalZ: 0, tangentX: 0, tangentZ: 1, orientation: "vertical" },
  { dx: 0, dy: -1, normalX: 0, normalZ: -1, tangentX: 1, tangentZ: 0, orientation: "horizontal" },
  { dx: 0, dy: 1, normalX: 0, normalZ: 1, tangentX: 1, tangentZ: 0, orientation: "horizontal" }
] as const;

const getFrontEdgeKey = (sourceTileIdx: number, dir: FrontDirection): number => sourceTileIdx * 4 + dir;

const getAnchorSourceWeightSlot = (source: ResolvedFireAnchor["source"]): number => {
  switch (source) {
    case "tree":
      return 0;
    case "structure":
      return 1;
    case "terrainSurface":
      return 2;
    case "rawFallback":
    default:
      return 3;
  }
};

const accumulateAnchorSourceWeight = (
  weights: number[],
  source: ResolvedFireAnchor["source"],
  weight: number
): void => {
  weights[getAnchorSourceWeightSlot(source)] += weight;
};

const pickDominantAnchorSource = (weights: number[]): ResolvedFireAnchor["source"] => {
  let bestIndex = 0;
  let bestWeight = weights[0] ?? 0;
  for (let i = 1; i < 4; i += 1) {
    const weight = weights[i] ?? 0;
    if (weight > bestWeight) {
      bestWeight = weight;
      bestIndex = i;
    }
  }
  switch (bestIndex) {
    case 0:
      return "tree";
    case 1:
      return "structure";
    case 2:
      return "terrainSurface";
    case 3:
    default:
      return "rawFallback";
  }
};

export type AnalyzeFireFrontsInput = {
  state: FireRenderAnalysisState;
  world: FireFxWorldState;
  fireView: FireFieldView;
  treeBurn: FireFxTreeBurnController | null;
  cols: number;
  rows: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  simFireEps: number;
  deltaSeconds: number;
  windNormX: number;
  windNormZ: number;
  windDirLen: number;
  activeFlameTileCount: number;
  visualActiveWeight: number;
  flameDensityScale: number;
  frontPassEnabled: boolean;
  resolveGroundAnchor: (tileIdx: number) => ResolvedFireAnchor;
};

export type FireFrontAnalysisResult = {
  frontFrameId: number;
  frontPassActive: boolean;
  frontSegmentBudget: number;
  frontFieldReadScale: number;
  frontCorridors: FrontCorridor[];
  visualFrontWeight: number;
};

export const analyzeFireFronts = (input: AnalyzeFireFrontsInput): FireFrontAnalysisResult => {
  const {
    state,
    world,
    fireView,
    treeBurn,
    cols,
    rows,
    minX,
    maxX,
    minY,
    maxY,
    simFireEps,
    deltaSeconds,
    windNormX,
    windNormZ,
    windDirLen,
    activeFlameTileCount,
    visualActiveWeight,
    flameDensityScale,
    frontPassEnabled,
    resolveGroundAnchor
  } = input;

  const getFrontTileVisualDrive = (tileIdx: number): number => {
    const fire = fireView.getFireByIndex(tileIdx);
    const heat = fireView.getHeat01ByIndex(tileIdx);
    const heatRelease = fireView.getHeatReleaseByIndex(tileIdx);
    const burnAge = fireView.getBurnAgeByIndex(tileIdx);
    const flameVisual = state.tileFlameVisual[tileIdx] ?? 0;
    const treeBurnVisual = treeBurn?.getTileBurnVisual(tileIdx) ?? 0;
    const fuel = fireView.getFuelByIndex(tileIdx);
    const isAshTile = (world.tileTypeId[tileIdx] ?? -1) === TILE_TYPE_IDS.ash;
    const flameProfile: FireFxTreeFlameProfile | null = treeBurn?.getTileFlameProfile(tileIdx) ?? null;
    const burnProgress = treeBurn?.getTileBurnProgress(tileIdx) ?? 0;
    const hasTreeCarryFlame =
      !isAshTile &&
      fuel > 0.03 &&
      flameProfile !== null &&
      treeBurnVisual > 0.08 &&
      burnProgress > 0.08 &&
      heat > 0.08;
    if (fire <= simFireEps && !hasTreeCarryFlame) {
      return 0;
    }
    const treeCarryVisual =
      !isAshTile && fuel > 0.03 ? treeBurnVisual * (0.54 + smoothstep(0.08, 0.72, heat) * 0.34) : 0;
    const freshIgnitionVisual =
      smoothstep(Math.max(simFireEps * 0.25, 0.02), 0.22, fire) * (1 - smoothstep(0.8, 4.2, burnAge));
    const heatReleaseVisual = smoothstep(0.01, 0.24, heatRelease);
    return Math.min(
      1.35,
      Math.max(
        fire * 0.82 + heat * 0.18 + heatReleaseVisual * 0.44 + flameVisual * 0.12,
        flameVisual * 0.88 + heatReleaseVisual * 0.42 + heat * 0.16,
        treeCarryVisual + heat * 0.16,
        freshIgnitionVisual * 0.24 + heatReleaseVisual * 0.36 + heat * 0.08
      )
    );
  };

  const getFrontTileIgnitionSignal = (tileIdx: number): number => {
    const fire = fireView.getFireByIndex(tileIdx);
    const heat = fireView.getHeat01ByIndex(tileIdx);
    const heatRelease = fireView.getHeatReleaseByIndex(tileIdx);
    const burnAge = fireView.getBurnAgeByIndex(tileIdx);
    const flameVisual = state.tileFlameVisual[tileIdx] ?? 0;
    const wetness = fireView.getWetnessByIndex(tileIdx);
    const freshIgnition01 =
      smoothstep(Math.max(simFireEps * 0.18, 0.02), 0.2, fire) * (1 - smoothstep(0.7, 4.2, burnAge));
    return Math.min(
      1.2,
      Math.max(
        0,
        heat * (0.56 - wetness * 0.18) +
          smoothstep(0.01, 0.22, heatRelease) * 0.38 +
          flameVisual * 0.24 +
          freshIgnition01 * 0.58
      )
    );
  };

  state.tileFrontPerimeter01.fill(0);
  state.tileFrontArrival01.fill(0);
  state.tileFrontAdvance01.fill(0);
  state.tileFrontDirX.fill(0);
  state.tileFrontDirZ.fill(0);

  const activeFrontStates: DirectedFrontEdgeState[] = [];
  let visualFrontWeight = 0;
  const frontFrameId = frontPassEnabled ? (state.frontUpdateSerial += 1) : state.frontUpdateSerial;

  if (frontPassEnabled) {
    for (let y = minY; y <= maxY; y += 1) {
      const rowBase = y * cols;
      for (let x = minX; x <= maxX; x += 1) {
        const sourceIdx = rowBase + x;
        const sourceDriveTarget = getFrontTileVisualDrive(sourceIdx);
        if (sourceDriveTarget <= 0.06) {
          continue;
        }
        for (let dir = 0; dir < FRONT_DIRECTION_DATA.length; dir += 1) {
          const direction = FRONT_DIRECTION_DATA[dir]!;
          const destX = x + direction.dx;
          const destY = y + direction.dy;
          if (destX < minX || destX > maxX || destY < minY || destY > maxY) {
            continue;
          }
          const destIdx = destY * cols + destX;
          const destFuel = fireView.getFuelByIndex(destIdx);
          const destTypeId = world.tileTypeId[destIdx] ?? -1;
          if (destFuel <= 0.01 || destTypeId === TILE_TYPE_IDS.ash) {
            continue;
          }
          const destFire = fireView.getFireByIndex(destIdx);
          const destHeat = fireView.getHeat01ByIndex(destIdx);
          const destBurnAge = fireView.getBurnAgeByIndex(destIdx);
          const destFlameVisual = state.tileFlameVisual[destIdx] ?? 0;
          const destIgnitionTarget = getFrontTileIgnitionSignal(destIdx);
          const windPush =
            windDirLen > 0.0001 ? Math.max(0, direction.normalX * windNormX + direction.normalZ * windNormZ) : 0;
          const neighbourCarry = Math.min(1.3, destFire * 0.76 + destHeat * 0.38 + destFlameVisual * 0.72);
          const spreadGradient = sourceDriveTarget - neighbourCarry * 0.72 + windPush * 0.16;
          const destFreshFire01 =
            smoothstep(Math.max(simFireEps * 0.16, 0.02), 0.24, destFire) * (1 - smoothstep(0.7, 4.8, destBurnAge));
          const destBurnMature01 = Math.min(
            1.15,
            Math.max(
              0,
              smoothstep(Math.max(simFireEps * 0.25, 0.04), 0.42, destFire) * 0.64 +
                smoothstep(0.08, 0.54, destFlameVisual) * 0.42 +
                smoothstep(1.2, 3.8, destBurnAge) * 0.34
            )
          );
          const shouldExplainSpread =
            destIgnitionTarget > 0.05 ||
            destFreshFire01 > 0.04 ||
            (destFire <= simFireEps * 0.6 && spreadGradient > 0.04);
          if (!shouldExplainSpread || (destBurnMature01 > 0.92 && spreadGradient < 0.14)) {
            continue;
          }
          const sourceAnchor = resolveGroundAnchor(sourceIdx);
          const destAnchor = resolveGroundAnchor(destIdx);
          const stateKey = getFrontEdgeKey(sourceIdx, dir as FrontDirection);
          let frontState = state.frontEdgeStates.get(stateKey);
          if (!frontState) {
            frontState = {
              key: stateKey,
              sourceTileIdx: sourceIdx,
              destTileIdx: destIdx,
              sourceTileX: x,
              sourceTileY: y,
              destTileX: destX,
              destTileY: destY,
              dir: dir as FrontDirection,
              normalX: direction.normalX,
              normalZ: direction.normalZ,
              tangentX: direction.tangentX,
              tangentZ: direction.tangentZ,
              orientation: direction.orientation,
              fixedCoord: 0,
              alongCoord: 0,
              edgeCenterX: 0,
              edgeCenterY: 0,
              edgeCenterZ: 0,
              normalY: 1,
              dominantSource: "terrainSurface",
              presence01: 0,
              advance01: 0,
              sourceDrive01: 0,
              destIgnition01: 0,
              passed01: 0,
              lastActiveFrame: frontFrameId
            };
            state.frontEdgeStates.set(stateKey, frontState);
          }
          frontState.sourceTileIdx = sourceIdx;
          frontState.destTileIdx = destIdx;
          frontState.sourceTileX = x;
          frontState.sourceTileY = y;
          frontState.destTileX = destX;
          frontState.destTileY = destY;
          frontState.fixedCoord =
            direction.orientation === "horizontal"
              ? direction.normalZ < 0
                ? y
                : y + 1
              : direction.normalX < 0
                ? x
                : x + 1;
          frontState.alongCoord = direction.orientation === "horizontal" ? x : y;
          frontState.edgeCenterX = (sourceAnchor.position.x + destAnchor.position.x) * 0.5;
          frontState.edgeCenterY = (sourceAnchor.position.y + destAnchor.position.y) * 0.5;
          frontState.edgeCenterZ = (sourceAnchor.position.z + destAnchor.position.z) * 0.5;
          frontState.normalX = direction.normalX;
          frontState.normalZ = direction.normalZ;
          frontState.normalY = Math.min(1, Math.max(0.2, (sourceAnchor.normal.y + destAnchor.normal.y) * 0.5));
          frontState.tangentX = direction.tangentX;
          frontState.tangentZ = direction.tangentZ;
          const sourceWeights = [0, 0, 0, 0];
          accumulateAnchorSourceWeight(sourceWeights, sourceAnchor.source, 1);
          accumulateAnchorSourceWeight(sourceWeights, destAnchor.source, 1);
          frontState.dominantSource = pickDominantAnchorSource(sourceWeights);
          const passedTarget = Math.min(
            1,
            Math.max(0, destBurnMature01 * smoothstep(0.12, 0.62, destIgnitionTarget + destFreshFire01 * 0.38))
          );
          const presenceTarget = Math.min(
            1.25,
            Math.max(
              0,
              sourceDriveTarget * 0.68 +
                destIgnitionTarget * 0.32 +
                Math.max(0, spreadGradient) * 0.42 +
                windPush * 0.18 -
                passedTarget * 0.7
            )
          );
          const advanceTarget = Math.min(
            1,
            Math.max(
              0,
              destIgnitionTarget * 0.16 +
                destFreshFire01 * 0.8 +
                smoothstep(0.03, 0.68, Math.max(0, spreadGradient)) * 0.12 +
                windPush * 0.08 -
                passedTarget * 0.28
            )
          );
          frontState.sourceDrive01 = smoothApproach(frontState.sourceDrive01, sourceDriveTarget, 8.8, 8.4, deltaSeconds);
          frontState.destIgnition01 = smoothApproach(frontState.destIgnition01, destIgnitionTarget, 6.8, 7.6, deltaSeconds);
          frontState.passed01 = smoothApproach(frontState.passed01, passedTarget, 5.6, 8.6, deltaSeconds);
          frontState.presence01 = smoothApproach(frontState.presence01, presenceTarget, 10.6, 7.2, deltaSeconds);
          frontState.advance01 = smoothApproach(frontState.advance01, advanceTarget, 7.2, 8.8, deltaSeconds);
          frontState.lastActiveFrame = frontFrameId;
          if (frontState.presence01 <= FIRE_FRONT_VISUAL_MIN * 0.35 || frontState.passed01 >= 0.98) {
            continue;
          }
          activeFrontStates.push(frontState);
          const outgoingWeight = Math.min(
            1.35,
            Math.max(0, frontState.presence01 * (0.54 + frontState.sourceDrive01 * 0.46) * (1 - frontState.passed01 * 0.3))
          );
          const incomingWeight = Math.min(
            1.35,
            Math.max(0, frontState.presence01 * (0.3 + frontState.advance01 * 0.7) * (1 - frontState.passed01 * 0.48))
          );
          state.tileFrontPerimeter01[sourceIdx] = Math.max(state.tileFrontPerimeter01[sourceIdx] ?? 0, outgoingWeight);
          state.tileFrontArrival01[destIdx] = Math.max(state.tileFrontArrival01[destIdx] ?? 0, incomingWeight);
          state.tileFrontAdvance01[destIdx] = Math.max(state.tileFrontAdvance01[destIdx] ?? 0, frontState.advance01);
          state.tileFrontDirX[destIdx] += direction.normalX * incomingWeight;
          state.tileFrontDirZ[destIdx] += direction.normalZ * incomingWeight;
          visualFrontWeight += smoothstep(FIRE_FRONT_VISUAL_MIN * 0.4, 0.82, frontState.presence01) * (0.45 + frontState.advance01 * 0.55);
        }
      }
    }
    for (const [stateKey, frontState] of state.frontEdgeStates) {
      if (frontState.lastActiveFrame === frontFrameId) {
        continue;
      }
      frontState.presence01 = smoothApproach(frontState.presence01, 0, 0, 9.8, deltaSeconds);
      frontState.advance01 = smoothApproach(frontState.advance01, 0, 0, 10.8, deltaSeconds);
      frontState.sourceDrive01 = smoothApproach(frontState.sourceDrive01, 0, 0, 9.4, deltaSeconds);
      frontState.destIgnition01 = smoothApproach(frontState.destIgnition01, 0, 0, 9.2, deltaSeconds);
      frontState.passed01 = smoothApproach(frontState.passed01, 0, 0, 10.4, deltaSeconds);
      if (
        frontState.presence01 <= 0.02 &&
        frontState.advance01 <= 0.02 &&
        frontState.sourceDrive01 <= 0.02 &&
        frontState.destIgnition01 <= 0.02 &&
        frontState.passed01 <= 0.02
      ) {
        state.frontEdgeStates.delete(stateKey);
      }
    }
  }

  const frontBudgetFloor = visualFrontWeight >= 4 ? Math.min(FIRE_FRONT_MIN_INSTANCES, Math.round(visualFrontWeight * 2.2)) : 0;
  const frontPassActive =
    frontPassEnabled &&
    activeFrontStates.length >= 2 &&
    visualFrontWeight >= FIRE_FRONT_PASS_MIN_WEIGHT * 0.55 &&
    activeFlameTileCount >= 2;
  const frontSegmentBudgetTarget = frontPassActive
    ? clamp(
        Math.round(
          Math.min(FIRE_FRONT_MAX_INSTANCES, visualFrontWeight * 2.8 + activeFrontStates.length * 0.95 + visualActiveWeight * 0.14) *
            clamp(flameDensityScale, 0.28, 1.05)
        ),
        frontBudgetFloor,
        FIRE_FRONT_MAX_INSTANCES
      )
    : 0;
  state.renderContinuityState.smoothedFrontSegmentBudget = smoothApproach(
    state.renderContinuityState.smoothedFrontSegmentBudget,
    frontSegmentBudgetTarget,
    FIRE_FRONT_BUDGET_RISE_RATE,
    FIRE_FRONT_BUDGET_FALL_RATE,
    deltaSeconds
  );
  const frontSegmentBudget = frontPassActive
    ? clamp(Math.round(state.renderContinuityState.smoothedFrontSegmentBudget), frontBudgetFloor, FIRE_FRONT_MAX_INSTANCES)
    : 0;
  const frontFieldReadScale = frontPassActive ? smoothstep(FIRE_FRONT_PASS_MIN_WEIGHT * 0.55, 14, visualFrontWeight) : 0;

  const stitchFrontCorridors = (): FrontCorridor[] => {
    const groups = new Map<number, DirectedFrontEdgeState[]>();
    for (let i = 0; i < activeFrontStates.length; i += 1) {
      const frontState = activeFrontStates[i]!;
      const groupKey = frontState.fixedCoord * 8 + frontState.dir;
      let group = groups.get(groupKey);
      if (!group) {
        group = [];
        groups.set(groupKey, group);
      }
      group.push(frontState);
    }
    const corridors: FrontCorridor[] = [];
    for (const group of groups.values()) {
      group.sort((a, b) => a.alongCoord - b.alongCoord);
      let start = 0;
      while (start < group.length) {
        let end = start;
        while (end + 1 < group.length && group[end + 1]!.alongCoord === group[end]!.alongCoord + 1) {
          end += 1;
        }
        const states = group.slice(start, end + 1);
        const sourceWeights = [0, 0, 0, 0];
        let presenceSum = 0;
        let advanceSum = 0;
        let sourceDriveSum = 0;
        let destIgnitionSum = 0;
        let passedSum = 0;
        for (let i = 0; i < states.length; i += 1) {
          const corridorState = states[i]!;
          presenceSum += corridorState.presence01;
          advanceSum += corridorState.advance01;
          sourceDriveSum += corridorState.sourceDrive01;
          destIgnitionSum += corridorState.destIgnition01;
          passedSum += corridorState.passed01;
          accumulateAnchorSourceWeight(sourceWeights, corridorState.dominantSource, corridorState.presence01);
        }
        const first = states[0]!;
        const last = states[states.length - 1]!;
        corridors.push({
          dir: first.dir,
          orientation: first.orientation,
          fixedCoord: first.fixedCoord,
          startCoord: first.alongCoord,
          endCoord: last.alongCoord,
          states,
          dominantSource: pickDominantAnchorSource(sourceWeights),
          presence01: presenceSum / Math.max(1, states.length),
          advance01: advanceSum / Math.max(1, states.length),
          sourceDrive01: sourceDriveSum / Math.max(1, states.length),
          destIgnition01: destIgnitionSum / Math.max(1, states.length),
          passed01: passedSum / Math.max(1, states.length)
        });
        start = end + 1;
      }
    }
    return corridors;
  };

  return {
    frontFrameId,
    frontPassActive,
    frontSegmentBudget,
    frontFieldReadScale,
    frontCorridors: frontPassActive && ENABLE_FLAME_FRONT_PASS ? stitchFrontCorridors() : [],
    visualFrontWeight
  };
};
