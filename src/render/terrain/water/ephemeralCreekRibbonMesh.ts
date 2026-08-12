import {
  buildChannelRibbonTopology,
  sampleChannelReceiverSegment
} from "./channelRibbonCenterline.js";

export type EphemeralCreekRibbonMeshInput = {
  cols: number;
  rows: number;
  width: number;
  depth: number;
  heightScale: number;
  elevations: ArrayLike<number>;
  channelClass: Uint8Array;
  channelWidth: Float32Array;
  channelDownstream: Int32Array;
  lakeMask?: Uint16Array;
  sampleTerrainWorldYAtEdge?: (edgeX: number, edgeY: number) => number;
};

export type EphemeralCreekRibbonMeshData = {
  positions: Float32Array;
  edgeFactor: Float32Array;
  opacityFactor: Float32Array;
  indices: Uint32Array;
  branchCount: number;
  internalSharedSectionCount: number;
};

const EPHEMERAL_CLASS = 1;
export const EPHEMERAL_CREEK_TERRAIN_LIFT_WORLD = 0.003;
const MIN_VISIBLE_WIDTH_CELLS = 0.025;
const PERMANENT_TRANSITION_FADE_START = 0.62;

export const EPHEMERAL_CREEK_SEASON_WETNESS = {
  winter: 1,
  spring: 0.9,
  summer: 0.05,
  autumn: 0.25
} as const;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp01((value - edge0) / Math.max(1e-6, edge1 - edge0));
  return t * t * (3 - 2 * t);
};

export const resolveEphemeralCreekWetness = (seasonT01: number): number => {
  const t = ((seasonT01 % 1) + 1) % 1;
  const spring = smoothstep(0.18, 0.28, t) * (1 - smoothstep(0.42, 0.52, t));
  const summer = smoothstep(0.42, 0.52, t) * (1 - smoothstep(0.66, 0.76, t));
  const autumn = smoothstep(0.62, 0.7, t) * (1 - smoothstep(0.9, 0.98, t));
  const winter = clamp01(1 - smoothstep(0.08, 0.18, t) + smoothstep(0.88, 0.96, t));
  const weightSum = Math.max(1e-6, winter + spring + summer + autumn);
  return (
    winter * EPHEMERAL_CREEK_SEASON_WETNESS.winter +
    spring * EPHEMERAL_CREEK_SEASON_WETNESS.spring +
    summer * EPHEMERAL_CREEK_SEASON_WETNESS.summer +
    autumn * EPHEMERAL_CREEK_SEASON_WETNESS.autumn
  ) / weightSum;
};

type BranchSample = {
  edgeX: number;
  edgeY: number;
  widthCells: number;
  opacity: number;
};

export const buildEphemeralCreekRibbonMesh = (
  input: EphemeralCreekRibbonMeshInput
): EphemeralCreekRibbonMeshData | undefined => {
  const total = input.cols * input.rows;
  if (
    input.elevations.length !== total ||
    input.channelClass.length !== total ||
    input.channelWidth.length !== total ||
    input.channelDownstream.length !== total ||
    (input.lakeMask && input.lakeMask.length !== total)
  ) {
    return undefined;
  }

  const cellWidth = input.width / Math.max(1, input.cols);
  const cellDepth = input.depth / Math.max(1, input.rows);
  const cellScale = Math.sqrt(cellWidth * cellDepth);
  const topology = buildChannelRibbonTopology(input);
  const ephemeralUpstreamCount = new Uint16Array(total);
  const validEdge = new Uint8Array(total);
  for (let source = 0; source < total; source += 1) {
    if ((input.channelClass[source] ?? 0) !== EPHEMERAL_CLASS) continue;
    const target = input.channelDownstream[source] ?? -1;
    const targetIsLake = target >= 0 && target < total && (input.lakeMask?.[target] ?? 0) > 0;
    if (target < 0 || target >= total || ((input.channelClass[target] ?? 0) === 0 && !targetIsLake)) continue;
    validEdge[source] = 1;
    if ((input.channelClass[target] ?? 0) === EPHEMERAL_CLASS) ephemeralUpstreamCount[target] += 1;
  }

  const positions: number[] = [];
  const edgeFactor: number[] = [];
  const opacityFactor: number[] = [];
  const indices: number[] = [];
  const visitedEdge = new Uint8Array(total);
  let branchCount = 0;
  let internalSharedSectionCount = 0;

  const worldX = (edgeX: number): number => (edgeX / input.cols - 0.5) * input.width;
  const worldZ = (edgeY: number): number => (edgeY / input.rows - 0.5) * input.depth;
  const sampleHeight = (edgeX: number, edgeY: number): number => {
    const sampled = input.sampleTerrainWorldYAtEdge?.(edgeX, edgeY);
    if (Number.isFinite(sampled)) return sampled! + EPHEMERAL_CREEK_TERRAIN_LIFT_WORLD;
    const cellX = Math.max(0, Math.min(input.cols - 1, edgeX - 0.5));
    const cellY = Math.max(0, Math.min(input.rows - 1, edgeY - 0.5));
    const x0 = Math.floor(cellX);
    const y0 = Math.floor(cellY);
    const x1 = Math.min(input.cols - 1, x0 + 1);
    const y1 = Math.min(input.rows - 1, y0 + 1);
    const tx = cellX - x0;
    const ty = cellY - y0;
    const top = (input.elevations[y0 * input.cols + x0] ?? 0) * (1 - tx) +
      (input.elevations[y0 * input.cols + x1] ?? 0) * tx;
    const bottom = (input.elevations[y1 * input.cols + x0] ?? 0) * (1 - tx) +
      (input.elevations[y1 * input.cols + x1] ?? 0) * tx;
    return (top * (1 - ty) + bottom * ty) * input.heightScale + EPHEMERAL_CREEK_TERRAIN_LIFT_WORLD;
  };

  const addBranch = (start: number): void => {
    const samples: BranchSample[] = [];
    let source = start;
    let firstEdge = true;
    for (let guard = 0; guard < total && validEdge[source] > 0 && visitedEdge[source] === 0; guard += 1) {
      visitedEdge[source] = 1;
      const target = input.channelDownstream[source] ?? -1;
      const targetClass = input.channelClass[target] ?? 0;
      const targetIsPermanent = targetClass >= 2 || (input.lakeMask?.[target] ?? 0) > 0;
      const sourceWidth = Math.max(MIN_VISIBLE_WIDTH_CELLS, input.channelWidth[source] ?? 0);
      const targetWidth = targetClass === EPHEMERAL_CLASS
        ? Math.max(MIN_VISIBLE_WIDTH_CELLS, input.channelWidth[target] ?? 0)
        : Math.max(sourceWidth, 0.45);
      const edgePoints = sampleChannelReceiverSegment({
        ...input,
        topology,
        source,
        elevations: input.elevations
      });
      for (let pointIndex = firstEdge ? 0 : 1; pointIndex < edgePoints.length; pointIndex += 1) {
        const point = edgePoints[pointIndex];
        const isHead = firstEdge && ephemeralUpstreamCount[source] === 0;
        const widthScale = isHead ? smoothstep(0, 0.7, point.t) : 1;
        const opacity = targetIsPermanent
          ? 1 - smoothstep(PERMANENT_TRANSITION_FADE_START, 1, point.t)
          : 1;
        samples.push({
          edgeX: point.x,
          edgeY: point.y,
          widthCells: (sourceWidth + (targetWidth - sourceWidth) * point.t) * widthScale,
          opacity
        });
      }
      firstEdge = false;
      if (targetClass !== EPHEMERAL_CLASS || ephemeralUpstreamCount[target] !== 1 || validEdge[target] === 0) break;
      source = target;
    }
    if (samples.length < 2) return;
    branchCount += 1;
    internalSharedSectionCount += Math.max(0, samples.length - 2);
    const sectionVertices: Array<readonly [number, number, number]> = [];
    for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
      const sample = samples[sampleIndex];
      const previous = samples[Math.max(0, sampleIndex - 1)];
      const next = samples[Math.min(samples.length - 1, sampleIndex + 1)];
      const tangentX = worldX(next.edgeX) - worldX(previous.edgeX);
      const tangentZ = worldZ(next.edgeY) - worldZ(previous.edgeY);
      const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
      const normalX = -tangentZ / tangentLength;
      const normalZ = tangentX / tangentLength;
      const halfWidth = sample.widthCells * cellScale * 0.5;
      const cx = worldX(sample.edgeX);
      const cy = sampleHeight(sample.edgeX, sample.edgeY);
      const cz = worldZ(sample.edgeY);
      const base = positions.length / 3;
      positions.push(
        cx + normalX * halfWidth, cy, cz + normalZ * halfWidth,
        cx, cy, cz,
        cx - normalX * halfWidth, cy, cz - normalZ * halfWidth
      );
      edgeFactor.push(1, 0, 1);
      opacityFactor.push(sample.opacity, sample.opacity, sample.opacity);
      sectionVertices.push([base, base + 1, base + 2]);
    }
    for (let section = 0; section + 1 < sectionVertices.length; section += 1) {
      const [leftA, centerA, rightA] = sectionVertices[section];
      const [leftB, centerB, rightB] = sectionVertices[section + 1];
      indices.push(
        leftA, centerA, centerB,
        leftA, centerB, leftB,
        centerA, rightA, rightB,
        centerA, rightB, centerB
      );
    }
  };

  for (let source = 0; source < total; source += 1) {
    if (validEdge[source] === 0 || visitedEdge[source] > 0 || ephemeralUpstreamCount[source] === 1) continue;
    addBranch(source);
  }
  for (let source = 0; source < total; source += 1) {
    if (validEdge[source] > 0 && visitedEdge[source] === 0) addBranch(source);
  }

  return indices.length > 0
    ? {
        positions: new Float32Array(positions),
        edgeFactor: new Float32Array(edgeFactor),
        opacityFactor: new Float32Array(opacityFactor),
        indices: new Uint32Array(indices),
        branchCount,
        internalSharedSectionCount
      }
    : undefined;
};
