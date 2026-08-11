export type TerrainMorphologyInput = {
  cols: number;
  rows: number;
  elevations: ArrayLike<number>;
  heightScale: number;
  erosionWear?: ArrayLike<number> | null;
  erosionDeposit?: ArrayLike<number> | null;
};

export type TerrainMorphologyFields = {
  slopeAngle: Float32Array;
  localRelief: Float32Array;
  curvature: Float32Array;
  rockExposure: Float32Array;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const sampleHeight = (values: ArrayLike<number>, cols: number, rows: number, x: number, y: number): number => {
  const sx = Math.max(0, Math.min(cols - 1, x));
  const sy = Math.max(0, Math.min(rows - 1, y));
  return values[sy * cols + sx] ?? 0;
};

export const buildTerrainMorphologyFields = (input: TerrainMorphologyInput): TerrainMorphologyFields => {
  const { cols, rows, elevations, heightScale } = input;
  const total = cols * rows;
  const slopeAngle = new Float32Array(total);
  const localRelief = new Float32Array(total);
  const curvature = new Float32Array(total);
  const rockExposure = new Float32Array(total);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const center = sampleHeight(elevations, cols, rows, x, y);
      const left = sampleHeight(elevations, cols, rows, x - 1, y);
      const right = sampleHeight(elevations, cols, rows, x + 1, y);
      const up = sampleHeight(elevations, cols, rows, x, y - 1);
      const down = sampleHeight(elevations, cols, rows, x, y + 1);
      const gradient = Math.hypot((right - left) * 0.5, (down - up) * 0.5);
      const angle = Math.atan(gradient * heightScale) * 180 / Math.PI;
      const curve = (left + right + up + down) * 0.25 - center;
      let minimum = center;
      let maximum = center;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const value = sampleHeight(elevations, cols, rows, x + dx, y + dy);
          minimum = Math.min(minimum, value);
          maximum = Math.max(maximum, value);
        }
      }
      const relief = maximum - minimum;
      const steepness = smoothstep(18, 55, angle);
      const reliefScore = smoothstep(0.015, 0.12, relief);
      const convexity = smoothstep(0.001, 0.025, -curve);
      const concavity = smoothstep(0.001, 0.025, curve);
      const wear = clamp01(input.erosionWear?.[idx] ?? 0);
      const deposited = clamp01(input.erosionDeposit?.[idx] ?? 0);
      slopeAngle[idx] = angle;
      localRelief[idx] = relief;
      curvature[idx] = curve;
      rockExposure[idx] = clamp01(
        steepness * 0.54 + reliefScore * 0.18 + convexity * 0.14 + wear * 0.24
        - deposited * 0.34 - concavity * 0.08
      );
    }
  }
  return { slopeAngle, localRelief, curvature, rockExposure };
};
