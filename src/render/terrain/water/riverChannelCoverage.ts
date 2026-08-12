export type RiverChannelCoverageField = {
  data: Uint8Array;
  width: number;
  height: number;
};

export type RiverChannelCoverageInput = {
  cols: number;
  rows: number;
  riverMask: Uint8Array;
  riverChannelWidth: Float32Array;
  lakeMask?: Uint16Array;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

export const buildRiverChannelCoverageField = (
  input: RiverChannelCoverageInput
): RiverChannelCoverageField => {
  const total = input.cols * input.rows;
  if (input.riverMask.length !== total || input.riverChannelWidth.length !== total) {
    throw new Error("River channel coverage inputs must match the terrain grid.");
  }
  const scale = 2;
  const width = input.cols * scale + 1;
  const height = input.rows * scale + 1;
  const data = new Uint8Array(width * height);
  const isValid = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < input.cols && y < input.rows;
  const riverSignedDistance = (px: number, py: number, x: number, y: number): number => {
    const index = y * input.cols + x;
    if (input.riverMask[index] === 0) return Number.NEGATIVE_INFINITY;
    const radius = Math.max(0, input.riverChannelWidth[index] ?? 0) * 0.5;
    if (radius <= 0) return Number.NEGATIVE_INFINITY;
    return radius - Math.hypot(px - (x + 0.5), py - (y + 0.5));
  };
  const linkSignedDistance = (
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number
  ): number => {
    if (!isValid(ax, ay) || !isValid(bx, by)) return Number.NEGATIVE_INFINITY;
    const aIndex = ay * input.cols + ax;
    const bIndex = by * input.cols + bx;
    if (input.riverMask[aIndex] === 0 || input.riverMask[bIndex] === 0) return Number.NEGATIVE_INFINITY;
    const aWidth = Math.max(0, input.riverChannelWidth[aIndex] ?? 0);
    const bWidth = Math.max(0, input.riverChannelWidth[bIndex] ?? 0);
    if (aWidth <= 0 && bWidth <= 0) return Number.NEGATIVE_INFINITY;
    const startX = ax + 0.5;
    const startY = ay + 0.5;
    const deltaX = bx - ax;
    const deltaY = by - ay;
    const lengthSq = deltaX * deltaX + deltaY * deltaY;
    const t = lengthSq > 0
      ? clamp(((px - startX) * deltaX + (py - startY) * deltaY) / lengthSq, 0, 1)
      : 0;
    const radius = (aWidth + (bWidth - aWidth) * t) * 0.5;
    return radius - Math.hypot(px - (startX + deltaX * t), py - (startY + deltaY * t));
  };
  const lakeSignedDistance = (px: number, py: number, x: number, y: number): number => {
    const index = y * input.cols + x;
    if ((input.lakeMask?.[index] ?? 0) === 0) return Number.NEGATIVE_INFINITY;
    const outsideX = Math.max(x - px, 0, px - (x + 1));
    const outsideY = Math.max(y - py, 0, py - (y + 1));
    if (outsideX > 0 || outsideY > 0) return -Math.hypot(outsideX, outsideY);
    return Math.min(px - x, x + 1 - px, py - y, y + 1 - py);
  };

  for (let sampleY = 0; sampleY < height; sampleY += 1) {
    const py = sampleY / scale;
    for (let sampleX = 0; sampleX < width; sampleX += 1) {
      const px = sampleX / scale;
      const originX = Math.floor(px);
      const originY = Math.floor(py);
      let signedDistance = Number.NEGATIVE_INFINITY;
      for (let y = originY - 1; y <= originY + 1; y += 1) {
        for (let x = originX - 1; x <= originX + 1; x += 1) {
          if (!isValid(x, y)) continue;
          signedDistance = Math.max(signedDistance, lakeSignedDistance(px, py, x, y));
          signedDistance = Math.max(signedDistance, riverSignedDistance(px, py, x, y));
          signedDistance = Math.max(signedDistance, linkSignedDistance(px, py, x, y, x + 1, y));
          signedDistance = Math.max(signedDistance, linkSignedDistance(px, py, x, y, x, y + 1));
        }
      }
      const coverage = Number.isFinite(signedDistance) ? smoothstep(-0.16, 0.16, signedDistance) : 0;
      data[sampleY * width + sampleX] = Math.round(coverage * 255);
    }
  }
  return { data, width, height };
};
