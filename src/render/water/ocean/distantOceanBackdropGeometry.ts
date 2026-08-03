export const DISTANT_OCEAN_EXTENSION_SCALE = 10.5;
export const DISTANT_OCEAN_EXTENSION_MIN = 1400;
export const DISTANT_OCEAN_EDGE_OVERLAP_STEPS = 1;
export const DISTANT_OCEAN_SEGMENT_WORLD_SIZE = 220;

export type DistantOceanBackdropEdge = "north" | "south" | "west" | "east";

export type DistantOceanBackdropStrip = {
  edge: DistantOceanBackdropEdge;
  width: number;
  depth: number;
  x: number;
  z: number;
  segmentsX: number;
  segmentsY: number;
};

export type DistantOceanBackdropLayout = {
  strips: DistantOceanBackdropStrip[];
  triangleCount: number;
};

export type DistantOceanBackdropLayoutOptions = {
  width: number;
  depth: number;
  sampleCols: number;
  sampleRows: number;
  extensionScale?: number;
  minimumExtension?: number;
  overlapSteps?: number;
  segmentWorldSize?: number;
};

const segmentCountForLength = (length: number, segmentWorldSize: number, minimum = 1): number =>
  Math.max(minimum, Math.ceil(Math.max(0, length) / segmentWorldSize));

/**
 * Builds the coarse geometry policy for the ocean beyond the authored terrain.
 *
 * The backdrop spans thousands of world units, so matching the one-tile terrain
 * tessellation would submit tens of millions of visually redundant triangles.
 */
export const buildDistantOceanBackdropLayout = (
  options: DistantOceanBackdropLayoutOptions
): DistantOceanBackdropLayout => {
  const width = Math.max(1, options.width);
  const depth = Math.max(1, options.depth);
  const sampleCols = Math.max(2, Math.floor(options.sampleCols));
  const sampleRows = Math.max(2, Math.floor(options.sampleRows));
  const extensionScale = Math.max(0, options.extensionScale ?? DISTANT_OCEAN_EXTENSION_SCALE);
  const minimumExtension = Math.max(0, options.minimumExtension ?? DISTANT_OCEAN_EXTENSION_MIN);
  const overlapSteps = Math.max(0, Math.floor(options.overlapSteps ?? DISTANT_OCEAN_EDGE_OVERLAP_STEPS));
  const segmentWorldSize = Math.max(1, options.segmentWorldSize ?? DISTANT_OCEAN_SEGMENT_WORLD_SIZE);
  const extension = Math.max(minimumExtension, Math.max(width, depth) * extensionScale);
  const oceanStepX = width / (sampleCols - 1);
  const oceanStepZ = depth / (sampleRows - 1);
  const extensionStepsX = Math.max(1, Math.ceil(extension / oceanStepX));
  const extensionStepsZ = Math.max(1, Math.ceil(extension / oceanStepZ));
  const alignedExtensionX = extensionStepsX * oceanStepX;
  const alignedExtensionZ = extensionStepsZ * oceanStepZ;
  const overlapX = oceanStepX * overlapSteps;
  const overlapZ = oceanStepZ * overlapSteps;
  const halfWidth = width * 0.5;
  const halfDepth = depth * 0.5;
  const fullWidth = width + alignedExtensionX * 2 + overlapX * 2;
  const stripDepth = alignedExtensionZ + overlapZ;
  const stripWidth = alignedExtensionX + overlapX;
  const sideDepth = depth + overlapZ * 2;
  const horizontalSegmentsX = segmentCountForLength(fullWidth, segmentWorldSize);
  const horizontalSegmentsY = segmentCountForLength(stripDepth, segmentWorldSize, 2);
  const verticalSegmentsX = segmentCountForLength(stripWidth, segmentWorldSize, 2);
  const verticalSegmentsY = segmentCountForLength(sideDepth, segmentWorldSize);
  const strips: DistantOceanBackdropStrip[] = [
    {
      edge: "north",
      width: fullWidth,
      depth: stripDepth,
      x: 0,
      z: -(halfDepth + (alignedExtensionZ - overlapZ) * 0.5),
      segmentsX: horizontalSegmentsX,
      segmentsY: horizontalSegmentsY
    },
    {
      edge: "south",
      width: fullWidth,
      depth: stripDepth,
      x: 0,
      z: halfDepth + (alignedExtensionZ - overlapZ) * 0.5,
      segmentsX: horizontalSegmentsX,
      segmentsY: horizontalSegmentsY
    },
    {
      edge: "east",
      width: stripWidth,
      depth: sideDepth,
      x: halfWidth + (alignedExtensionX - overlapX) * 0.5,
      z: 0,
      segmentsX: verticalSegmentsX,
      segmentsY: verticalSegmentsY
    },
    {
      edge: "west",
      width: stripWidth,
      depth: sideDepth,
      x: -(halfWidth + (alignedExtensionX - overlapX) * 0.5),
      z: 0,
      segmentsX: verticalSegmentsX,
      segmentsY: verticalSegmentsY
    }
  ];

  return {
    strips,
    triangleCount: strips.reduce((sum, strip) => sum + strip.segmentsX * strip.segmentsY * 2, 0)
  };
};
