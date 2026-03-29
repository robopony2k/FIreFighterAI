export type FireAudioClusterCandidate = {
  id: number;
  x: number;
  z: number;
  tileCount: number;
  intensity01: number;
};

export type FireAudioEmitterMemory = {
  slotIndex: number;
  x: number;
  z: number;
  tileCount: number;
};

export type HeightOcclusionSample = {
  terrainY: number;
  lineY: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const clamp01 = (value: number): number => clamp(value, 0, 1);

export const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const computeFireAudioIntensity = (heatMean01: number, fuelMean01: number): number =>
  clamp01(heatMean01 * fuelMean01);

export const computeWindLoudnessGain = (
  cameraToEmitterDir: { x: number; z: number },
  windDir: { x: number; z: number },
  windStrength: number
): number => {
  const cameraDirLen = Math.hypot(cameraToEmitterDir.x, cameraToEmitterDir.z);
  const windLen = Math.hypot(windDir.x, windDir.z);
  if (cameraDirLen <= 1e-5 || windLen <= 1e-5 || windStrength <= 1e-5) {
    return 1;
  }
  const dot =
    (cameraToEmitterDir.x / cameraDirLen) * (windDir.x / windLen) +
    (cameraToEmitterDir.z / cameraDirLen) * (windDir.z / windLen);
  const downwind = clamp01(((-dot + 1) * 0.5));
  const strength01 = clamp01(windStrength);
  return 0.85 + (1.2 - 0.85) * downwind * strength01;
};

export const computeTerrainOcclusion01 = (
  samples: readonly HeightOcclusionSample[],
  clearance: number
): number => {
  if (samples.length <= 0 || clearance <= 1e-5) {
    return 0;
  }
  let occlusion = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = samples[i]!;
    const overlap = sample.terrainY - sample.lineY;
    if (overlap <= 0) {
      continue;
    }
    occlusion += clamp01(overlap / clearance);
  }
  return clamp01(occlusion / samples.length);
};

const computeFireClusterPriority = (
  cluster: FireAudioClusterCandidate,
  cameraX: number,
  cameraZ: number,
  hearingDistance: number,
  maxTileCount: number
): number => {
  const distance = Math.hypot(cluster.x - cameraX, cluster.z - cameraZ);
  const distanceScore = 1 - smoothstep(0, Math.max(1e-4, hearingDistance), distance);
  const sizeScore = clamp01(cluster.tileCount / Math.max(1, maxTileCount));
  return distanceScore * 0.65 + sizeScore * 0.25 + clamp01(cluster.intensity01) * 0.1;
};

export const selectPrioritizedFireAudioClusters = (
  clusters: readonly FireAudioClusterCandidate[],
  cameraX: number,
  cameraZ: number,
  hearingDistance: number,
  maxEmitters: number
): FireAudioClusterCandidate[] => {
  if (clusters.length <= 0 || maxEmitters <= 0) {
    return [];
  }
  const maxTileCount = clusters.reduce((best, cluster) => Math.max(best, cluster.tileCount), 1);
  return [...clusters]
    .sort(
      (a, b) =>
        computeFireClusterPriority(b, cameraX, cameraZ, hearingDistance, maxTileCount) -
        computeFireClusterPriority(a, cameraX, cameraZ, hearingDistance, maxTileCount)
    )
    .slice(0, maxEmitters);
};

const computeContinuityScore = (
  slot: FireAudioEmitterMemory,
  cluster: FireAudioClusterCandidate,
  continuityDistance: number
): number => {
  const distance = Math.hypot(cluster.x - slot.x, cluster.z - slot.z);
  const distanceScore = 1 - clamp01(distance / Math.max(1e-4, continuityDistance));
  const sizeSimilarity =
    1 -
    Math.abs(cluster.tileCount - slot.tileCount) /
      Math.max(1, cluster.tileCount, slot.tileCount);
  return distanceScore * 0.75 + clamp01(sizeSimilarity) * 0.25;
};

export const assignFireAudioEmitterSlots = (
  slots: readonly FireAudioEmitterMemory[],
  prioritizedClusters: readonly FireAudioClusterCandidate[],
  maxSlots: number,
  continuityDistance: number
): Array<FireAudioClusterCandidate | null> => {
  const result = Array.from({ length: Math.max(0, maxSlots) }, () => null as FireAudioClusterCandidate | null);
  if (prioritizedClusters.length <= 0 || maxSlots <= 0) {
    return result;
  }
  const remainingClusters = [...prioritizedClusters];
  const sortedSlots = [...slots].sort((a, b) => a.slotIndex - b.slotIndex);
  for (let i = 0; i < sortedSlots.length; i += 1) {
    const slot = sortedSlots[i]!;
    let bestIndex = -1;
    let bestScore = 0.2;
    for (let clusterIndex = 0; clusterIndex < remainingClusters.length; clusterIndex += 1) {
      const candidate = remainingClusters[clusterIndex]!;
      const score = computeContinuityScore(slot, candidate, continuityDistance);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = clusterIndex;
      }
    }
    if (bestIndex < 0 || slot.slotIndex < 0 || slot.slotIndex >= result.length) {
      continue;
    }
    result[slot.slotIndex] = remainingClusters.splice(bestIndex, 1)[0] ?? null;
  }
  for (let clusterIndex = 0; clusterIndex < remainingClusters.length; clusterIndex += 1) {
    const candidate = remainingClusters[clusterIndex]!;
    const slotIndex = result.findIndex((entry) => entry === null);
    if (slotIndex < 0) {
      break;
    }
    result[slotIndex] = candidate;
  }
  return result;
};
