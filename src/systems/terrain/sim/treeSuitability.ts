import { clamp } from "../../../core/utils.js";
import { fbmNoise, hash2D } from "../../../mapgen/noise.js";

export type TreeSuitabilityInput = {
  seed: number;
  x: number;
  y: number;
  worldX: number;
  worldY: number;
  cellSizeM: number;
  elevation: number;
  slope: number;
  moisture: number;
  valley: number;
  seaLevel: number;
  waterDist: number;
  highlandForestElevation: number;
  vegetationDensity: number;
  forestPatchiness: number;
  isWater?: boolean;
};

export type TreeSuitabilityResult = {
  moistureFactor: number;
  elevationStress: number;
  slopeStress: number;
  waterInfluence: number;
  localBiomeNoise: number;
  treeSuitability: number;
  treeProbability: number;
  treeDensity: number;
};

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const transitionWeight = (value: number): number => 1 - Math.abs(clamp(value, 0, 1) * 2 - 1);

export const computeTreeSuitability = (input: TreeSuitabilityInput): TreeSuitabilityResult => {
  if (input.isWater) {
    return {
      moistureFactor: 0,
      elevationStress: 1,
      slopeStress: 1,
      waterInfluence: 0,
      localBiomeNoise: 0.5,
      treeSuitability: 0,
      treeProbability: 0,
      treeDensity: 0
    };
  }

  const cellSizeM = Math.max(0.1, input.cellSizeM);
  const vegetationDensity = clamp(input.vegetationDensity, 0, 1);
  const patchiness = clamp(input.forestPatchiness, 0, 1);
  const elevation = clamp(input.elevation, 0, 1);
  const slope = clamp(input.slope, 0, 1);
  const moisture = clamp(input.moisture, 0, 1);
  const waterDistM = Math.max(0, input.waterDist) * cellSizeM;
  const headroom = Math.max(0, elevation - input.seaLevel);

  const waterInfluence =
    smoothstep(320, 24, waterDistM) * 0.62 +
    smoothstep(90, 0, waterDistM) * 0.2 +
    smoothstep(0.035, 0.22, input.valley) * smoothstep(0.24, 0.02, slope) * 0.18;
  const effectiveMoisture = clamp(moisture + waterInfluence * 0.24, 0, 1);
  const moistureFactor = smoothstep(0.18, 0.68, effectiveMoisture);

  const highlandStart = Math.max(input.seaLevel + 0.16, input.highlandForestElevation - 0.18);
  const highlandEnd = Math.min(0.98, input.highlandForestElevation + 0.2);
  const elevationStress = clamp(
    smoothstep(highlandStart, highlandEnd, elevation) * 0.72 +
      smoothstep(0.42, 0.78, headroom) * 0.28,
    0,
    1
  );
  const slopeStress = smoothstep(0.16, 0.5, slope);

  const macroScaleM = 620 + patchiness * 460;
  const patchScaleM = 210 + patchiness * 220;
  const macroNoise = fbmNoise(input.worldX / macroScaleM, input.worldY / macroScaleM, input.seed + 19_031, 3);
  const patchNoise = fbmNoise(input.worldX / patchScaleM, input.worldY / patchScaleM, input.seed + 19_607, 2);

  const stressFactor = clamp((1 - elevationStress * 0.82) * (1 - slopeStress * 0.76), 0, 1);
  const wetBase = clamp(
    moistureFactor * 0.72 +
      waterInfluence * 0.18 +
      smoothstep(0.04, 0.28, input.valley) * 0.06 +
      vegetationDensity * 0.1,
    0,
    1
  );
  const baseSuitability = clamp(wetBase * stressFactor, 0, 1);
  const transition = transitionWeight(baseSuitability);
  const noiseShift =
    (macroNoise - 0.5) * (0.2 + patchiness * 0.2) +
    (patchNoise - 0.5) * transition * (0.12 + patchiness * 0.18);
  const localBiomeNoise = clamp(macroNoise * 0.7 + patchNoise * 0.3, 0, 1);
  const treeSuitability = clamp(baseSuitability + noiseShift, 0, 1);
  const densityBias = 0.86 + vegetationDensity * 0.34;
  const treeProbability = clamp(
    smoothstep(0.24, 0.76, treeSuitability) * densityBias * (0.9 + transition * patchiness * 0.16),
    0,
    1
  );
  const localPlacementJitter = 0.84 + hash2D(input.x, input.y, input.seed + 20_113) * 0.22;
  const treeDensity = clamp(treeProbability * (0.38 + treeSuitability * 0.72) * localPlacementJitter, 0, 1);

  return {
    moistureFactor,
    elevationStress,
    slopeStress,
    waterInfluence: clamp(waterInfluence, 0, 1),
    localBiomeNoise,
    treeSuitability,
    treeProbability,
    treeDensity
  };
};
