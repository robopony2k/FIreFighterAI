export type ChannelRibbonTopologyInput = {
  cols: number;
  rows: number;
  channelClass: Uint8Array;
  channelDownstream: Int32Array;
};

export type ChannelRibbonTopology = {
  upstreamCount: Uint16Array;
  uniqueUpstream: Int32Array;
};

export type ChannelRibbonPoint = {
  x: number;
  y: number;
  t: number;
};

export type ChannelReceiverSegmentInput = ChannelRibbonTopologyInput & {
  topology: ChannelRibbonTopology;
  source: number;
  elevations?: ArrayLike<number>;
  subdivisions?: number;
};

export const CHANNEL_RIBBON_SEGMENT_SUBDIVISIONS = 4;
export const CHANNEL_RIBBON_TANGENT_SCALE = 0.34;
export const CHANNEL_RIBBON_THALWEG_SAMPLE_OFFSET_CELLS = 0.24;
export const CHANNEL_RIBBON_THALWEG_MAX_OFFSET_CELLS = 0.14;
export const CHANNEL_RIBBON_THALWEG_ELEVATION_SCALE = 8;

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const centerOf = (index: number, cols: number): { x: number; y: number } => ({
  x: index % cols + 0.5,
  y: Math.floor(index / cols) + 0.5
});

const normalize = (x: number, y: number): { x: number; y: number } => {
  const length = Math.hypot(x, y);
  return length > 1e-8 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
};

export const buildChannelRibbonTopology = (
  input: ChannelRibbonTopologyInput
): ChannelRibbonTopology => {
  const total = input.cols * input.rows;
  const upstreamCount = new Uint16Array(total);
  const uniqueUpstream = new Int32Array(total).fill(-1);
  if (input.channelClass.length !== total || input.channelDownstream.length !== total) {
    return { upstreamCount, uniqueUpstream };
  }
  for (let source = 0; source < total; source += 1) {
    if ((input.channelClass[source] ?? 0) === 0) continue;
    const target = input.channelDownstream[source] ?? -1;
    if (target < 0 || target >= total || (input.channelClass[target] ?? 0) === 0) continue;
    upstreamCount[target] += 1;
    uniqueUpstream[target] = upstreamCount[target] === 1 ? source : -1;
  }
  return { upstreamCount, uniqueUpstream };
};

export const resolveChannelNodeTangent = (
  input: ChannelRibbonTopologyInput,
  topology: ChannelRibbonTopology,
  index: number
): { x: number; y: number } => {
  const center = centerOf(index, input.cols);
  const upstream = topology.uniqueUpstream[index] ?? -1;
  const downstream = input.channelDownstream[index] ?? -1;
  const validUpstream = upstream >= 0 && upstream < input.channelClass.length;
  const validDownstream = downstream >= 0 && downstream < input.channelClass.length;
  if (validUpstream && validDownstream) {
    const before = centerOf(upstream, input.cols);
    const after = centerOf(downstream, input.cols);
    return normalize(after.x - before.x, after.y - before.y);
  }
  if (validDownstream) {
    const after = centerOf(downstream, input.cols);
    return normalize(after.x - center.x, after.y - center.y);
  }
  if (validUpstream) {
    const before = centerOf(upstream, input.cols);
    return normalize(center.x - before.x, center.y - before.y);
  }
  return { x: 1, y: 0 };
};

const sampleElevation = (
  elevations: ArrayLike<number>,
  cols: number,
  rows: number,
  edgeX: number,
  edgeY: number
): number => {
  const cellX = clamp(edgeX - 0.5, 0, cols - 1);
  const cellY = clamp(edgeY - 0.5, 0, rows - 1);
  const x0 = Math.floor(cellX);
  const y0 = Math.floor(cellY);
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const tx = cellX - x0;
  const ty = cellY - y0;
  const top = (elevations[y0 * cols + x0] ?? 0) * (1 - tx) +
    (elevations[y0 * cols + x1] ?? 0) * tx;
  const bottom = (elevations[y1 * cols + x0] ?? 0) * (1 - tx) +
    (elevations[y1 * cols + x1] ?? 0) * tx;
  return top * (1 - ty) + bottom * ty;
};

export const sampleChannelReceiverSegment = (
  input: ChannelReceiverSegmentInput
): ChannelRibbonPoint[] => {
  const total = input.cols * input.rows;
  const target = input.channelDownstream[input.source] ?? -1;
  if (input.source < 0 || input.source >= total || target < 0 || target >= total) return [];
  const sourceCenter = centerOf(input.source, input.cols);
  const targetCenter = centerOf(target, input.cols);
  const dx = targetCenter.x - sourceCenter.x;
  const dy = targetCenter.y - sourceCenter.y;
  const length = Math.hypot(dx, dy);
  if (length <= 1e-8) return [];
  const sourceTangent = resolveChannelNodeTangent(input, input.topology, input.source);
  const targetTangent = resolveChannelNodeTangent(input, input.topology, target);
  const tangentMagnitude = length * CHANNEL_RIBBON_TANGENT_SCALE;
  const subdivisions = Math.max(1, Math.floor(input.subdivisions ?? CHANNEL_RIBBON_SEGMENT_SUBDIVISIONS));
  const points: ChannelRibbonPoint[] = [];
  for (let step = 0; step <= subdivisions; step += 1) {
    const t = step / subdivisions;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    let x = h00 * sourceCenter.x + h10 * sourceTangent.x * tangentMagnitude +
      h01 * targetCenter.x + h11 * targetTangent.x * tangentMagnitude;
    let y = h00 * sourceCenter.y + h10 * sourceTangent.y * tangentMagnitude +
      h01 * targetCenter.y + h11 * targetTangent.y * tangentMagnitude;
    if (input.elevations && step > 0 && step < subdivisions) {
      const dh00 = 6 * t2 - 6 * t;
      const dh10 = 3 * t2 - 4 * t + 1;
      const dh01 = -dh00;
      const dh11 = 3 * t2 - 2 * t;
      const tangent = normalize(
        dh00 * sourceCenter.x + dh10 * sourceTangent.x * tangentMagnitude +
          dh01 * targetCenter.x + dh11 * targetTangent.x * tangentMagnitude,
        dh00 * sourceCenter.y + dh10 * sourceTangent.y * tangentMagnitude +
          dh01 * targetCenter.y + dh11 * targetTangent.y * tangentMagnitude
      );
      const normalX = -tangent.y;
      const normalY = tangent.x;
      const sampleOffset = CHANNEL_RIBBON_THALWEG_SAMPLE_OFFSET_CELLS;
      const leftHeight = sampleElevation(
        input.elevations,
        input.cols,
        input.rows,
        x + normalX * sampleOffset,
        y + normalY * sampleOffset
      );
      const rightHeight = sampleElevation(
        input.elevations,
        input.cols,
        input.rows,
        x - normalX * sampleOffset,
        y - normalY * sampleOffset
      );
      const endpointFade = Math.sin(Math.PI * t) ** 2;
      const thalwegOffset = clamp(
        (rightHeight - leftHeight) * CHANNEL_RIBBON_THALWEG_ELEVATION_SCALE,
        -CHANNEL_RIBBON_THALWEG_MAX_OFFSET_CELLS,
        CHANNEL_RIBBON_THALWEG_MAX_OFFSET_CELLS
      ) * endpointFade;
      x += normalX * thalwegOffset;
      y += normalY * thalwegOffset;
    }
    points.push({ x, y, t });
  }
  return points;
};
