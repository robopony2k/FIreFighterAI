import { TILE_TYPE_IDS } from "../../../core/state.js";
import { computeFireAudioIntensity } from "../../../render/threeTestWorldAudioMath.js";
import {
  CLUSTER_BED_MAX_PER_CLUSTER,
  CLUSTER_FULL_BLEND_TILES,
  CLUSTER_MIN_TILES,
  CLUSTER_PLUME_MAX_PER_CLUSTER,
  INTERIOR_NEIGHBOR_MIN,
  TREE_BURN_CARRY_FUEL_MIN,
  TREE_BURN_CARRY_PROGRESS_MIN,
  TREE_BURN_FLAME_VISUAL_MIN
} from "../constants/fireRenderConstants.js";
import { allocFireCluster, releaseFireClusters } from "./fireRenderAnalysisState.js";
import { clamp } from "./fireRenderMath.js";
import type {
  FireClusterBudgetState,
  FireRenderAnalysisState
} from "./fireRenderPlanningTypes.js";
import type {
  FireAudioClusterSnapshot,
  FireFxTerrainSize,
  FireFxTreeBurnController,
  FireFxWorldState,
  FireFxTreeFlameProfile,
  ResolvedFireAnchor
} from "./fireFxTypes.js";
import type { FireFieldView } from "./fireRenderSnapshot.js";

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

export type BuildOrReuseFireClustersInput = {
  state: FireRenderAnalysisState;
  frameTimeMs: number;
  world: FireFxWorldState;
  fireView: FireFieldView;
  cols: number;
  rows: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  sampleStep: number;
  simFireEps: number;
  windX: number;
  windZ: number;
  treeBurn: FireFxTreeBurnController | null;
  terrainSize: FireFxTerrainSize;
  resolveGroundAnchor: (tileIdx: number) => ResolvedFireAnchor;
  activeFlameTileCount: number;
  clusterUpdateMs: number;
};

export const buildOrReuseFireClusters = (
  input: BuildOrReuseFireClustersInput
): { clusterCount: number; clusteredTiles: number } => {
  const {
    state,
    frameTimeMs,
    world,
    fireView,
    cols,
    rows,
    minX,
    maxX,
    minY,
    maxY,
    sampleStep,
    simFireEps,
    windX,
    windZ,
    treeBurn,
    terrainSize,
    resolveGroundAnchor,
    activeFlameTileCount,
    clusterUpdateMs
  } = input;
  const boundsChanged =
    sampleStep !== state.lastClusterSampleStep ||
    minX !== state.lastClusterMinX ||
    maxX !== state.lastClusterMaxX ||
    minY !== state.lastClusterMinY ||
    maxY !== state.lastClusterMaxY;
  const activeCountChanged =
    Math.abs(activeFlameTileCount - state.lastClusterActiveTileCount) / Math.max(1, state.lastClusterActiveTileCount) > 0.15;
  const shouldRebuildClusters =
    frameTimeMs - state.lastClusterRebuildMs >= clusterUpdateMs || activeCountChanged || boundsChanged;

  if (!shouldRebuildClusters) {
    return {
      clusterCount: state.fireClusters.length,
      clusteredTiles: state.fireClusters.reduce((sum, cluster) => sum + cluster.tileCount, 0)
    };
  }

  state.tileActiveFlag.fill(0);
  state.tileClusterId.fill(-1);
  state.tileClusterRole.fill(0);
  state.tileSmokeOcclusion01.fill(0);
  releaseFireClusters(state);

  let queueHead = 0;
  let queueTail = 0;

  for (let y = minY; y <= maxY; y += sampleStep) {
    for (let x = minX; x <= maxX; x += sampleStep) {
      const idx = y * cols + x;
      const fire = fireView.getFireByIndex(idx);
      const heat = fireView.getHeat01ByIndex(idx);
      const fuel = fireView.getFuelByIndex(idx);
      const isAshTile = (world.tileTypeId[idx] ?? -1) === TILE_TYPE_IDS.ash;
      const flameProfile: FireFxTreeFlameProfile | null = treeBurn?.getTileFlameProfile(idx) ?? null;
      const burnProgress = treeBurn?.getTileBurnProgress(idx) ?? 0;
      const treeBurnVisual = treeBurn?.getTileBurnVisual(idx) ?? 0;
      const hasCarryFuel = fuel > TREE_BURN_CARRY_FUEL_MIN && !isAshTile;
      const hasTreeCarryFlame =
        hasCarryFuel &&
        flameProfile !== null &&
        treeBurnVisual > TREE_BURN_FLAME_VISUAL_MIN &&
        burnProgress > TREE_BURN_CARRY_PROGRESS_MIN &&
        heat > 0.08;
      if (fire > simFireEps || hasTreeCarryFlame) {
        state.tileActiveFlag[idx] = 1;
      }
    }
  }

  let clusterId = 0;
  let clusteredTiles = 0;
  for (let y = minY; y <= maxY; y += 1) {
    const rowBase = y * cols;
    for (let x = minX; x <= maxX; x += 1) {
      const idx = rowBase + x;
      if (state.tileActiveFlag[idx] === 0 || state.tileClusterId[idx] >= 0) {
        continue;
      }
      const cluster = allocFireCluster(state);
      cluster.id = clusterId;
      cluster.minX = x;
      cluster.maxX = x;
      cluster.minY = y;
      cluster.maxY = y;
      cluster.sourceIdx = idx;
      cluster.anchorSource = "terrainSurface";
      let weightedX = 0;
      let weightedZ = 0;
      let weightedY = 0;
      let weightSum = 0;
      let weightMax = 0;
      let heatSum01 = 0;
      let fuelSum01 = 0;
      const anchorSourceWeights = [0, 0, 0, 0];
      queueHead = 0;
      queueTail = 0;
      state.clusterQueue[queueTail++] = idx;
      state.tileClusterId[idx] = clusterId;
      while (queueHead < queueTail) {
        const current = state.clusterQueue[queueHead++]!;
        const cx = current % cols;
        const cy = Math.floor(current / cols);
        cluster.tiles.push(current);
        cluster.tileCount += 1;
        if (cx < cluster.minX) {
          cluster.minX = cx;
        }
        if (cx > cluster.maxX) {
          cluster.maxX = cx;
        }
        if (cy < cluster.minY) {
          cluster.minY = cy;
        }
        if (cy > cluster.maxY) {
          cluster.maxY = cy;
        }
        const fire = fireView.getFireByIndex(current);
        const heat = fireView.getHeat01ByIndex(current);
        const fuel = fireView.getFuelByIndex(current);
        const treeBurnVisual = treeBurn?.getTileBurnVisual(current) ?? 0;
        const w = clamp(Math.max(fire, heat * 0.5, treeBurnVisual * 0.75), 0.01, 1.4);
        heatSum01 += heat;
        fuelSum01 += fuel;
        const groundAnchor = resolveGroundAnchor(current);
        weightedX += groundAnchor.position.x * w;
        weightedZ += groundAnchor.position.z * w;
        weightedY += groundAnchor.position.y * w;
        weightSum += w;
        accumulateAnchorSourceWeight(anchorSourceWeights, groundAnchor.source, w);
        if (w > weightMax) {
          weightMax = w;
          cluster.sourceIdx = current;
        }
        for (let oy = -sampleStep; oy <= sampleStep; oy += sampleStep) {
          for (let ox = -sampleStep; ox <= sampleStep; ox += sampleStep) {
            if (ox === 0 && oy === 0) {
              continue;
            }
            const nx = cx + ox;
            const ny = cy + oy;
            if (nx < minX || nx > maxX || ny < minY || ny > maxY) {
              continue;
            }
            const nIdx = ny * cols + nx;
            if (state.tileActiveFlag[nIdx] === 0 || state.tileClusterId[nIdx] >= 0) {
              continue;
            }
            state.tileClusterId[nIdx] = clusterId;
            state.clusterQueue[queueTail++] = nIdx;
          }
        }
      }
      if (cluster.tileCount < CLUSTER_MIN_TILES) {
        for (let i = 0; i < cluster.tiles.length; i += 1) {
          const tid = cluster.tiles[i]!;
          state.tileClusterId[tid] = -1;
          state.tileClusterRole[tid] = 0;
        }
        cluster.tiles.length = 0;
        state.fireClusterPool.push(cluster);
        continue;
      }
      cluster.centroidX = weightedX / Math.max(0.0001, weightSum);
      cluster.centroidZ = weightedZ / Math.max(0.0001, weightSum);
      cluster.baseY = weightedY / Math.max(0.0001, weightSum);
      cluster.anchorSource = pickDominantAnchorSource(anchorSourceWeights);
      const avgWeight = weightSum / Math.max(1, cluster.tileCount);
      cluster.intensity = clamp(avgWeight * 0.7 + weightMax * 0.3, 0, 1.25);
      cluster.heatSum01 = heatSum01;
      cluster.heatMean01 = heatSum01 / Math.max(1, cluster.tileCount);
      cluster.fuelMean01 = fuelSum01 / Math.max(1, cluster.tileCount);
      cluster.intensity01 = computeFireAudioIntensity(cluster.heatMean01, cluster.fuelMean01);
      let radius = 0;
      let edgeTiles = 0;
      let interiorTiles = 0;
      let covXX = 0;
      let covXZ = 0;
      let covZZ = 0;
      for (let i = 0; i < cluster.tiles.length; i += 1) {
        const tid = cluster.tiles[i]!;
        const tx = tid % cols;
        const ty = Math.floor(tid / cols);
        const tileAnchor = resolveGroundAnchor(tid);
        const wx = tileAnchor.position.x;
        const wz = tileAnchor.position.z;
        const dx = wx - cluster.centroidX;
        const dz = wz - cluster.centroidZ;
        covXX += dx * dx;
        covXZ += dx * dz;
        covZZ += dz * dz;
        radius = Math.max(radius, Math.hypot(wx - cluster.centroidX, wz - cluster.centroidZ));
        let neighborCount = 0;
        for (let oy = -sampleStep; oy <= sampleStep; oy += sampleStep) {
          for (let ox = -sampleStep; ox <= sampleStep; ox += sampleStep) {
            if (ox === 0 && oy === 0) {
              continue;
            }
            const nx = tx + ox;
            const ny = ty + oy;
            if (nx < minX || nx > maxX || ny < minY || ny > maxY) {
              continue;
            }
            const nIdx = ny * cols + nx;
            if (state.tileClusterId[nIdx] === clusterId) {
              neighborCount += 1;
            }
          }
        }
        if (neighborCount >= INTERIOR_NEIGHBOR_MIN) {
          state.tileClusterRole[tid] = 2;
          interiorTiles += 1;
        } else {
          state.tileClusterRole[tid] = 1;
          edgeTiles += 1;
        }
      }
      let spanAxisX = 1;
      let spanAxisZ = 0;
      const covTrace = covXX + covZZ;
      if (covTrace > 0.0001) {
        const angle = 0.5 * Math.atan2(2 * covXZ, covXX - covZZ);
        spanAxisX = Math.cos(angle);
        spanAxisZ = Math.sin(angle);
      }
      const windLen = Math.hypot(windX, windZ);
      if (windLen > 0.0001) {
        const crossWindAxisX = -windZ / windLen;
        const crossWindAxisZ = windX / windLen;
        if (spanAxisX * crossWindAxisX + spanAxisZ * crossWindAxisZ < 0) {
          spanAxisX *= -1;
          spanAxisZ *= -1;
        }
        const crossWindBlend = cluster.tileCount >= CLUSTER_FULL_BLEND_TILES ? 0.45 : 0.22;
        spanAxisX += (crossWindAxisX - spanAxisX) * crossWindBlend;
        spanAxisZ += (crossWindAxisZ - spanAxisZ) * crossWindBlend;
        const spanLen = Math.hypot(spanAxisX, spanAxisZ) || 1;
        spanAxisX /= spanLen;
        spanAxisZ /= spanLen;
      }
      let depthAxisX = -spanAxisZ;
      let depthAxisZ = spanAxisX;
      if (windLen > 0.0001) {
        const windNormX = windX / windLen;
        const windNormZ = windZ / windLen;
        if (depthAxisX * windNormX + depthAxisZ * windNormZ < 0) {
          depthAxisX *= -1;
          depthAxisZ *= -1;
        }
      }
      cluster.spanAxisX = spanAxisX;
      cluster.spanAxisZ = spanAxisZ;
      cluster.depthAxisX = depthAxisX;
      cluster.depthAxisZ = depthAxisZ;
      cluster.radius = Math.max(radius, Math.min(terrainSize.width / cols, terrainSize.depth / rows) * 0.8);
      cluster.edgeTiles = edgeTiles;
      cluster.interiorTiles = interiorTiles;
      state.fireClusters.push(cluster);
      clusteredTiles += cluster.tileCount;
      clusterId += 1;
    }
  }

  state.lastClusterRebuildMs = frameTimeMs;
  state.lastClusterActiveTileCount = activeFlameTileCount;
  state.lastClusterSampleStep = sampleStep;
  state.lastClusterMinX = minX;
  state.lastClusterMaxX = maxX;
  state.lastClusterMinY = minY;
  state.lastClusterMaxY = maxY;

  return { clusterCount: state.fireClusters.length, clusteredTiles };
};

export const computeClusterBudgets = (
  state: FireRenderAnalysisState,
  flameBudgetScale: number,
  activeFlameTileCount: number,
  clusteredTiles: number,
  availableFlameInstances: number
): FireClusterBudgetState => {
  const clusterCoverage = clusteredTiles / Math.max(1, activeFlameTileCount);
  const flameCapacity = Math.max(96, availableFlameInstances);
  const reserveBed = Math.max(0, Math.round(flameCapacity * clusterCoverage * 0.14 * flameBudgetScale));
  const reservePlume = Math.max(0, Math.round(flameCapacity * clusterCoverage * 0.08 * flameBudgetScale));
  const reserveTileJets = clamp(
    flameCapacity - reserveBed - reservePlume,
    Math.max(80, Math.round(flameCapacity * 0.3)),
    flameCapacity
  );
  let weightSum = 0;
  for (let i = 0; i < state.fireClusters.length; i += 1) {
    const cluster = state.fireClusters[i]!;
    weightSum += cluster.tileCount * (0.65 + cluster.intensity * 0.35);
  }
  for (let i = 0; i < state.fireClusters.length; i += 1) {
    const cluster = state.fireClusters[i]!;
    const clusterWeight = cluster.tileCount * (0.65 + cluster.intensity * 0.35);
    const normW = weightSum > 0 ? clusterWeight / weightSum : 1 / Math.max(1, state.fireClusters.length);
    cluster.bedBudget = reserveBed > 0 ? clamp(Math.round(reserveBed * normW), 2, CLUSTER_BED_MAX_PER_CLUSTER) : 0;
    let plumeAnchors = reservePlume > 0 ? (cluster.tileCount > 25 ? 3 : cluster.tileCount > 10 ? 2 : 1) : 0;
    if (flameBudgetScale < 0.72) {
      plumeAnchors = Math.min(plumeAnchors, 2);
    }
    if (flameBudgetScale < 0.5) {
      plumeAnchors = 1;
    }
    if (cluster.intensity < 0.24) {
      plumeAnchors = Math.min(plumeAnchors, 1);
    }
    cluster.plumeBudget = clamp(plumeAnchors, 0, CLUSTER_PLUME_MAX_PER_CLUSTER);
  }
  return { clusteredTiles, clusterCoverage, reserveBed, reservePlume, reserveTileJets };
};

export const updateClusterFrontFields = (state: FireRenderAnalysisState): void => {
  for (let i = 0; i < state.fireClusters.length; i += 1) {
    const cluster = state.fireClusters[i]!;
    let perimeterSum = 0;
    let arrivalMax = 0;
    let weightSum = 0;
    for (let tileIndex = 0; tileIndex < cluster.tiles.length; tileIndex += 1) {
      const tid = cluster.tiles[tileIndex]!;
      const roleWeight = state.tileClusterRole[tid] === 1 ? 1 : state.tileClusterRole[tid] === 2 ? 0.5 : 0.72;
      perimeterSum += (state.tileFrontPerimeter01[tid] ?? 0) * roleWeight;
      arrivalMax = Math.max(arrivalMax, state.tileFrontArrival01[tid] ?? 0);
      weightSum += roleWeight;
    }
    cluster.frontPerimeter01 = weightSum > 0 ? perimeterSum / weightSum : 0;
    cluster.frontArrival01 = arrivalMax;
  }
};

export const syncAudioClusterSnapshots = (
  state: FireRenderAnalysisState,
  target: FireAudioClusterSnapshot[]
): FireAudioClusterSnapshot[] => {
  target.length = state.fireClusters.length;
  for (let i = 0; i < state.fireClusters.length; i += 1) {
    const cluster = state.fireClusters[i]!;
    const snapshot =
      target[i] ??
      ({
        id: cluster.id,
        x: cluster.centroidX,
        y: cluster.baseY,
        z: cluster.centroidZ,
        radius: cluster.radius,
        tileCount: cluster.tileCount,
        heatMean01: cluster.heatMean01,
        heatSum01: cluster.heatSum01,
        fuelMean01: cluster.fuelMean01,
        intensity01: cluster.intensity01
      } satisfies FireAudioClusterSnapshot);
    snapshot.id = cluster.id;
    snapshot.x = cluster.centroidX;
    snapshot.y = cluster.baseY;
    snapshot.z = cluster.centroidZ;
    snapshot.radius = cluster.radius;
    snapshot.tileCount = cluster.tileCount;
    snapshot.heatMean01 = cluster.heatMean01;
    snapshot.heatSum01 = cluster.heatSum01;
    snapshot.fuelMean01 = cluster.fuelMean01;
    snapshot.intensity01 = cluster.intensity01;
    target[i] = snapshot;
  }
  return target;
};
