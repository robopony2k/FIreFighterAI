import { clamp } from "../../../core/utils.js";
import { VEGETATION_DISTRIBUTION_TUNING } from "../constants/vegetationDistributionTuning.js";

export type VegetationTerrainFieldInput = {
  cols: number;
  rows: number;
  cellSizeM?: number;
  elevations: ArrayLike<number>;
  baseMoisture: ArrayLike<number>;
  waterDistance: ArrayLike<number>;
  coastDistance?: ArrayLike<number> | null;
  valley?: ArrayLike<number> | null;
  runoff?: ArrayLike<number> | null;
  oceanMask?: ArrayLike<number> | null;
  riverMask?: ArrayLike<number> | null;
  lakeMask?: ArrayLike<number> | null;
  prevailingWindDx: number;
  prevailingWindDy: number;
  prevailingWindStrength: number;
  refineMoisture?: boolean;
};

export type VegetationTerrainFields = {
  moisture: Float32Array;
  windExposure: Float32Array;
  leeShelter: Float32Array;
  curvature: Float32Array;
  drainage: Float32Array;
  coastExposure: Float32Array;
};

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const t = clamp((value - edge0) / Math.max(1e-6, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const directionalStep = (dx: number, dy: number): { x: number; y: number } => {
  const x = dx > 0.414 ? 1 : dx < -0.414 ? -1 : 0;
  const y = dy > 0.414 ? 1 : dy < -0.414 ? -1 : 0;
  if (x !== 0 || y !== 0) {
    return { x, y };
  }
  return Math.abs(dx) >= Math.abs(dy)
    ? { x: dx >= 0 ? 1 : -1, y: 0 }
    : { x: 0, y: dy >= 0 ? 1 : -1 };
};

const isWaterAt = (input: VegetationTerrainFieldInput, idx: number): boolean =>
  (input.oceanMask?.[idx] ?? 0) > 0 ||
  (input.riverMask?.[idx] ?? 0) > 0 ||
  (input.lakeMask?.[idx] ?? 0) > 0;

export const buildVegetationTerrainFields = (
  input: VegetationTerrainFieldInput
): VegetationTerrainFields => {
  const { cols, rows } = input;
  const total = cols * rows;
  const moisture = Float32Array.from({ length: total }, (_, idx) => clamp(input.baseMoisture[idx] ?? 0, 0, 1));
  const windExposure = new Float32Array(total);
  const leeShelter = new Float32Array(total);
  const curvature = new Float32Array(total);
  const drainage = new Float32Array(total);
  const coastExposure = new Float32Array(total);
  const propagatedShelter = new Float32Array(total);
  const windLength = Math.hypot(input.prevailingWindDx, input.prevailingWindDy) || 1;
  const windX = input.prevailingWindDx / windLength;
  const windY = input.prevailingWindDy / windLength;
  const windStrength = clamp(input.prevailingWindStrength, 0, 1);
  const step = directionalStep(windX, windY);
  const windFaceRadiusTiles = Math.max(
    2,
    Math.round(VEGETATION_DISTRIBUTION_TUNING.windFaceScaleM / Math.max(1, input.cellSizeM ?? 10))
  );
  const nearFaceRadiusTiles = Math.max(1, Math.round(windFaceRadiusTiles * 0.5));
  const elevationAt = (x: number, y: number, fallback: number): number => {
    const sx = Math.round(x);
    const sy = Math.round(y);
    if (sx < 0 || sy < 0 || sx >= cols || sy >= rows) return fallback;
    return input.elevations[sy * cols + sx] ?? fallback;
  };

  let runoffMax = 0;
  for (let i = 0; i < total; i += 1) {
    runoffMax = Math.max(runoffMax, input.runoff?.[i] ?? 0);
  }
  const runoffDenom = Math.log1p(Math.max(1e-6, runoffMax));

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const idx = y * cols + x;
      const center = input.elevations[idx] ?? 0;
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          sum += input.elevations[ny * cols + nx] ?? center;
          count += 1;
        }
      }
      const relativeHeight = count > 0 ? center - sum / count : 0;
      curvature[idx] = clamp(
        relativeHeight / VEGETATION_DISTRIBUTION_TUNING.curvatureNormalization,
        -1,
        1
      );
      const coastDistance = input.coastDistance?.[idx] ?? VEGETATION_DISTRIBUTION_TUNING.coastFadeTiles;
      coastExposure[idx] = isWaterAt(input, idx)
        ? 0
        : clamp(Math.exp(-coastDistance / VEGETATION_DISTRIBUTION_TUNING.coastFadeTiles), 0, 1);
      const runoff = input.runoff?.[idx] ?? 0;
      const runoff01 = runoffDenom > 0 ? clamp(Math.log1p(Math.max(0, runoff)) / runoffDenom, 0, 1) : 0;
      const valley = clamp(input.valley?.[idx] ?? 0, 0, 1);
      const nearWater = clamp(1 - (input.waterDistance[idx] ?? 24) / 18, 0, 1);
      drainage[idx] = clamp(runoff01 * 0.48 + valley * 0.34 + nearWater * 0.18, 0, 1);
    }
  }

  const xStart = step.x >= 0 ? 0 : cols - 1;
  const xEnd = step.x >= 0 ? cols : -1;
  const xStep = step.x >= 0 ? 1 : -1;
  const yStart = step.y >= 0 ? 0 : rows - 1;
  const yEnd = step.y >= 0 ? rows : -1;
  const yStep = step.y >= 0 ? 1 : -1;
  for (let y = yStart; y !== yEnd; y += yStep) {
    for (let x = xStart; x !== xEnd; x += xStep) {
      const idx = y * cols + x;
      if (isWaterAt(input, idx)) {
        moisture[idx] = 1;
        continue;
      }
      const center = input.elevations[idx] ?? 0;
      const ux = x - step.x;
      const uy = y - step.y;
      const hasUpwind = ux >= 0 && uy >= 0 && ux < cols && uy < rows;
      const upwindIdx = hasUpwind ? uy * cols + ux : idx;
      const upwindElevation = input.elevations[upwindIdx] ?? center;
      const riseIntoWind = Math.max(0, center - upwindElevation);
      const upwindBarrier = Math.max(0, upwindElevation - center);
      const nearUpwindElevation = elevationAt(
        x - windX * nearFaceRadiusTiles,
        y - windY * nearFaceRadiusTiles,
        center
      );
      const farUpwindElevation = elevationAt(
        x - windX * windFaceRadiusTiles,
        y - windY * windFaceRadiusTiles,
        center
      );
      const broadUpwindElevation = nearUpwindElevation * 0.38 + farUpwindElevation * 0.62;
      const broadExposure = smoothstep(0.012, 0.18, Math.max(0, center - broadUpwindElevation));
      const broadShelter = smoothstep(0.012, 0.16, Math.max(0, broadUpwindElevation - center));
      const ridge = Math.max(0, curvature[idx] ?? 0);
      const gully = Math.max(0, -(curvature[idx] ?? 0));
      const localExposure = smoothstep(0.003, 0.055, riseIntoWind);
      const localShelter = smoothstep(0.002, 0.05, upwindBarrier);
      const broadBlend = VEGETATION_DISTRIBUTION_TUNING.windFaceBroadBlend;
      windExposure[idx] = clamp(
        windStrength *
          (broadExposure * broadBlend +
            localExposure * 0.16 +
            ridge * 0.07 +
            coastExposure[idx] * 0.02),
        0,
        1
      );
      const inheritedShelter = hasUpwind ? (propagatedShelter[upwindIdx] ?? 0) * 0.88 : 0;
      propagatedShelter[idx] = clamp(Math.max(inheritedShelter, localShelter) + gully * 0.12, 0, 1);
      leeShelter[idx] = clamp(
        windStrength *
          (broadShelter * broadBlend + propagatedShelter[idx] * 0.15 + gully * 0.1),
        0,
        1
      );

      if (input.refineMoisture !== false) {
        moisture[idx] = clamp(
          moisture[idx] -
            windExposure[idx] * VEGETATION_DISTRIBUTION_TUNING.exposureDrying -
            coastExposure[idx] * VEGETATION_DISTRIBUTION_TUNING.coastDrying +
            leeShelter[idx] * VEGETATION_DISTRIBUTION_TUNING.shelterRetention +
            (gully * 0.45 + drainage[idx] * 0.55) * VEGETATION_DISTRIBUTION_TUNING.gullyDrainageRetention,
          0,
          1
        );
      }
    }
  }

  return { moisture, windExposure, leeShelter, curvature, drainage, coastExposure };
};
