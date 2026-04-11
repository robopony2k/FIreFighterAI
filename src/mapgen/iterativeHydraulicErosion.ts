import { clamp } from "../core/utils.js";
import type { MapGenSettings } from "./settings.js";

const TAU = Math.PI * 2;
const DIAGONAL_COST = Math.SQRT2;

type Neighbor = {
  dx: number;
  dy: number;
  cost: number;
};

const NEIGHBORS: readonly Neighbor[] = [
  { dx: -1, dy: 0, cost: 1 },
  { dx: 1, dy: 0, cost: 1 },
  { dx: 0, dy: -1, cost: 1 },
  { dx: 0, dy: 1, cost: 1 },
  { dx: -1, dy: -1, cost: DIAGONAL_COST },
  { dx: 1, dy: -1, cost: DIAGONAL_COST },
  { dx: -1, dy: 1, cost: DIAGONAL_COST },
  { dx: 1, dy: 1, cost: DIAGONAL_COST }
];

type ErosionSettings = Pick<
  MapGenSettings,
  "relief" | "ruggedness" | "riverIntensity" | "basinStrength" | "coastalShelfWidth"
>;

export type IterativeHydraulicErosionLevel = {
  cols: number;
  rows: number;
  height: ArrayLike<number>;
  landShape: ArrayLike<number>;
  basinSignal?: ArrayLike<number>;
  tectonicStress?: ArrayLike<number>;
  tectonicTrendX?: ArrayLike<number>;
  tectonicTrendY?: ArrayLike<number>;
  bootstrapWear?: ArrayLike<number>;
  bootstrapDeposit?: ArrayLike<number>;
  bootstrapFlowX?: ArrayLike<number>;
  bootstrapFlowY?: ArrayLike<number>;
  iterations: number;
  sparseMask?: Uint8Array | null;
  cellSizeM: number;
  worldOffsetXM: number;
  worldOffsetYM: number;
};

export type IterativeHydraulicErosionInput = {
  seed: number;
  settings: ErosionSettings;
  level: IterativeHydraulicErosionLevel;
  yieldIfNeeded?: () => Promise<boolean>;
  reportProgress?: (progress: number) => void | Promise<void>;
};

export type IterativeHydraulicErosionResult = {
  height: Float32Array;
  wear: Float32Array;
  deposit: Float32Array;
  flowX: Float32Array;
  flowY: Float32Array;
  hardness: Float32Array;
};

const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp(t, 0, 1);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const normalize = (x: number, y: number): { x: number; y: number } => {
  const length = Math.hypot(x, y);
  if (length <= 1e-6) {
    return { x: 0, y: 0 };
  }
  return { x: x / length, y: y / length };
};

const buildActiveIndices = (mask: Uint8Array): Uint32Array => {
  let count = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] > 0) {
      count += 1;
    }
  }
  const indices = new Uint32Array(count);
  let offset = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] > 0) {
      indices[offset] = i;
      offset += 1;
    }
  }
  return indices;
};

const sampleHardness = (
  height: number,
  hardnessOffset: number,
  layeredPhase: number,
  crossBand: number,
  terraceFrequency: number
): number => {
  const a = (height - hardnessOffset) * terraceFrequency;
  const layered = mix(
    mix(
      Math.sin(a) * 0.5 + 0.5,
      Math.sin(a * 1.618 + layeredPhase) * 0.5 + 0.5,
      0.5
    ),
    Math.sin(a * 6.18) * 0.5 + 0.5,
    0.2
  );
  return clamp(mix(layered, crossBand, 0.18), 0, 1);
};

export const runIterativeHydraulicErosion = async (
  input: IterativeHydraulicErosionInput
): Promise<IterativeHydraulicErosionResult> => {
  const { seed, settings, level, yieldIfNeeded, reportProgress } = input;
  const {
    cols,
    rows,
    height,
    landShape,
    basinSignal,
    tectonicStress,
    tectonicTrendX,
    tectonicTrendY,
    bootstrapWear,
    bootstrapDeposit,
    bootstrapFlowX,
    bootstrapFlowY,
    iterations,
    sparseMask,
    cellSizeM,
    worldOffsetXM,
    worldOffsetYM
  } = level;
  const total = cols * rows;
  const activeIndices = sparseMask ? buildActiveIndices(sparseMask) : null;

  const ruggedness = clamp(settings.ruggedness, 0, 1);
  const relief = clamp(settings.relief, 0, 1);
  const riverIntensity = clamp(settings.riverIntensity, 0, 1);
  const basinStrength = clamp(settings.basinStrength, 0, 1);
  const coastalShelfWidth = clamp(settings.coastalShelfWidth, 0, 1);
  const refinementBoost = sparseMask ? mix(1.2, 1.6, ruggedness * 0.5 + riverIntensity * 0.5) : 1;

  const flowRate = mix(0.28, 0.46, riverIntensity * 0.65 + ruggedness * 0.35);
  const evaporation = mix(0.08, 0.03, riverIntensity);
  const drainage = mix(0.05, 0.014, basinStrength * 0.45 + riverIntensity * 0.55);
  const baseRain = mix(0.012, 0.03, riverIntensity * 0.6 + basinStrength * 0.4) * refinementBoost;
  const maxWater = mix(1.15, 1.85, riverIntensity * 0.55 + basinStrength * 0.45);
  const waterAsHeight = mix(0.015, 0.08, ruggedness);
  const maxWaterSpeed = mix(1.8, 3.6, ruggedness * 0.65 + relief * 0.35);
  const slopeToSpeed = 1 / mix(0.017, 0.006, ruggedness * 0.7 + relief * 0.3);
  const sedimentToHeight = mix(0.01, 0.018, relief * 0.55 + ruggedness * 0.45) * mix(1, 1.28, refinementBoost - 1);
  const pickupRate = mix(0.05, 0.16, relief * 0.45 + ruggedness * 0.55) * mix(1, 1.22, refinementBoost - 1);
  const depositionRate = mix(0.52, 0.72, basinStrength * 0.45 + riverIntensity * 0.55);
  const capacityScale = mix(0.12, 0.34, relief * 0.5 + riverIntensity * 0.5) * mix(1, 1.18, refinementBoost - 1);
  const terraceHardness = mix(2.8, 5.8, ruggedness * 0.7 + relief * 0.3);
  const terraceFrequency = TAU * mix(7.2, 12.5, ruggedness * 0.7 + relief * 0.3);
  const uScale = 1 / Math.max(cellSizeM, cols * cellSizeM);
  const vScale = 1 / Math.max(cellSizeM, rows * cellSizeM);
  const seedShiftA = ((seed % 977) + 1) * 0.00071;
  const seedShiftB = ((seed % 587) + 1) * 0.00111;
  const crossBandScaleX = mix(2.4, 5.4, ruggedness);
  const crossBandScaleY = mix(1.8, 3.8, relief);

  let currentHeight = Float32Array.from(height);
  let nextHeight = new Float32Array(total);
  let currentWater = new Float32Array(total);
  let nextWater = new Float32Array(total);
  let currentSediment = new Float32Array(total);
  let nextSediment = new Float32Array(total);
  const wearAcc = new Float32Array(total);
  const depositAcc = new Float32Array(total);
  const hardness = new Float32Array(total);
  const flowX = new Float32Array(total);
  const flowY = new Float32Array(total);
  const receiver = new Int32Array(total).fill(-1);
  const receiverDrop = new Float32Array(total);
  const receiverSpeed = new Float32Array(total);
  const donorCount = new Uint16Array(total);
  const shapeField = new Float32Array(total);
  const basinField = new Float32Array(total);
  const tectonicStressField = new Float32Array(total);
  const tectonicTrendXField = new Float32Array(total);
  const tectonicTrendYField = new Float32Array(total);
  const bootstrapWearField = new Float32Array(total);
  const bootstrapDepositField = new Float32Array(total);
  const hardnessOffsetField = new Float32Array(total);
  const layeredPhaseField = new Float32Array(total);
  const crossBandField = new Float32Array(total);
  const structuralFlowBias = new Float32Array(total);

  for (let i = 0; i < total; i += 1) {
    const shape = clamp(landShape[i] ?? 0, 0, 1);
    const basin = clamp(basinSignal?.[i] ?? 0, 0, 1);
    const stress = clamp(tectonicStress?.[i] ?? 0, 0, 1);
    const bootstrapWearValue = clamp(bootstrapWear?.[i] ?? 0, 0, 1);
    const bootstrapDepositValue = clamp(bootstrapDeposit?.[i] ?? 0, 0, 1);
    const x = i % cols;
    const y = Math.floor(i / cols);
    const worldX = worldOffsetXM + x * cellSizeM;
    const worldY = worldOffsetYM + y * cellSizeM;
    const u = worldX * uScale;
    const v = worldY * vScale;
    const hardnessOffset =
      -0.2 * Math.sin(TAU * (u + seedShiftA))
      + 0.2 * Math.sin(TAU * (v - seedShiftB));
    const layeredPhase = (u * 4 + v * 2 + seedShiftA * 9) * TAU;
    const crossBand = Math.sin((u * crossBandScaleX + v * crossBandScaleY + seedShiftB * 17) * TAU) * 0.5 + 0.5;
    const normalizedTrend = normalize(tectonicTrendX?.[i] ?? 0, tectonicTrendY?.[i] ?? 0);
    shapeField[i] = shape;
    basinField[i] = basin;
    tectonicStressField[i] = stress;
    tectonicTrendXField[i] = normalizedTrend.x;
    tectonicTrendYField[i] = normalizedTrend.y;
    bootstrapWearField[i] = bootstrapWearValue;
    bootstrapDepositField[i] = bootstrapDepositValue;
    hardnessOffsetField[i] = hardnessOffset;
    layeredPhaseField[i] = layeredPhase;
    crossBandField[i] = crossBand;
    hardness[i] = sampleHardness(currentHeight[i] ?? 0, hardnessOffset, layeredPhase, crossBand, terraceFrequency);
    currentWater[i] =
      shape <= 0.04
        ? 0
        : clamp(
            baseRain * (
              0.6
              + basin * 0.4
              + stress * 0.26
              + bootstrapWearValue * mix(0.5, 0.82, refinementBoost - 1)
              + ruggedness * 0.12
            ),
            0,
            maxWater
          );
    currentSediment[i] = bootstrapDepositValue * mix(0.05, 0.11, refinementBoost - 1);
    wearAcc[i] = bootstrapWearValue * mix(0.45, 0.64, refinementBoost - 1);
    depositAcc[i] = bootstrapDepositValue * mix(0.45, 0.6, refinementBoost - 1);
    flowX[i] = bootstrapFlowX?.[i] ?? 0;
    flowY[i] = bootstrapFlowY?.[i] ?? 0;
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    nextHeight.set(currentHeight);
    nextWater.set(currentWater);
    nextSediment.set(currentSediment);
    donorCount.fill(0);

    const visitCount = activeIndices ? activeIndices.length : total;
    for (let visit = 0; visit < visitCount; visit += 1) {
      const idx = activeIndices ? activeIndices[visit]! : visit;
      const shape = shapeField[idx] ?? 0;
      if (shape <= 0.04) {
        currentWater[idx] = 0;
        currentSediment[idx] = 0;
        receiver[idx] = -1;
        receiverDrop[idx] = 0;
        receiverSpeed[idx] = 0;
        flowX[idx] = 0;
        flowY[idx] = 0;
        continue;
      }

      const x = idx % cols;
      const y = Math.floor(idx / cols);
      const surface = currentHeight[idx] + currentWater[idx] * waterAsHeight;
      const stress = tectonicStressField[idx] ?? 0;
      const trendX = tectonicTrendXField[idx] ?? 0;
      const trendY = tectonicTrendYField[idx] ?? 0;
      let bestReceiver = -1;
      let bestScore = 0;
      let bestDrop = 0;
      let bestFlowX = 0;
      let bestFlowY = 0;
      for (let i = 0; i < NEIGHBORS.length; i += 1) {
        const neighbor = NEIGHBORS[i]!;
        const nx = x + neighbor.dx;
        const ny = y + neighbor.dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
          continue;
        }
        const nIdx = ny * cols + nx;
        const neighborShape = shapeField[nIdx] ?? 0;
        if (neighborShape <= 0.02) {
          continue;
        }
        const neighborSurface = currentHeight[nIdx] + currentWater[nIdx] * waterAsHeight;
        const drop = (surface - neighborSurface) / neighbor.cost;
        const alignment = Math.max(0, (neighbor.dx / neighbor.cost) * trendX + (neighbor.dy / neighbor.cost) * trendY);
        const score = drop + alignment * (stress * 0.022 + basinField[idx] * 0.016);
        if (score <= bestScore) {
          continue;
        }
        bestReceiver = nIdx;
        bestScore = score;
        bestDrop = drop;
        bestFlowX = neighbor.dx / neighbor.cost;
        bestFlowY = neighbor.dy / neighbor.cost;
      }

      receiver[idx] = bestReceiver;
      receiverDrop[idx] = bestDrop;
      const speed = clamp(bestDrop * slopeToSpeed, 0, maxWaterSpeed);
      receiverSpeed[idx] = speed;
      flowX[idx] = bestReceiver >= 0 ? bestFlowX : 0;
      flowY[idx] = bestReceiver >= 0 ? bestFlowY : 0;
      structuralFlowBias[idx] =
        bestReceiver >= 0
          ? Math.max(0, bestFlowX * trendX + bestFlowY * trendY)
          : 0;

      const basin = basinField[idx] ?? 0;
      const bootstrapWearValue = bootstrapWearField[idx] ?? 0;
      const coastAttenuation = smoothstep(0.14, 0.5, shape) * mix(1, 0.84, coastalShelfWidth);
      const rain =
        baseRain
        * (0.72 + basin * 0.42 + stress * 0.24 + bootstrapWearValue * 0.32 + ruggedness * 0.1)
        * coastAttenuation;
      const availableWater = clamp(currentWater[idx] + rain, 0, maxWater);
      const availableSediment = currentSediment[idx];

      nextWater[idx] = Math.max(0, nextWater[idx] - currentWater[idx]);
      nextSediment[idx] = Math.max(0, nextSediment[idx] - currentSediment[idx]);

      const speedNorm = maxWaterSpeed > 1e-6 ? speed / maxWaterSpeed : 0;
      const transportFraction = bestReceiver >= 0
        ? clamp(flowRate * (0.35 + speedNorm * 0.65), 0, 0.92)
        : 0;
      const movedWater = availableWater * transportFraction;
      const keptWater = availableWater - movedWater;
      const movedSediment = availableWater > 1e-6 ? availableSediment * (movedWater / availableWater) : 0;
      const keptSediment = availableSediment - movedSediment;

      nextWater[idx] += keptWater;
      nextSediment[idx] += keptSediment;
      if (bestReceiver >= 0 && (!sparseMask || sparseMask[bestReceiver] > 0)) {
        nextWater[bestReceiver] += movedWater;
        nextSediment[bestReceiver] += movedSediment;
        donorCount[bestReceiver] = Math.min(0xffff, donorCount[bestReceiver] + 1);
      } else {
        nextWater[idx] += movedWater;
        nextSediment[idx] += movedSediment;
      }
    }

    for (let visit = 0; visit < visitCount; visit += 1) {
      const idx = activeIndices ? activeIndices[visit]! : visit;
      const shape = shapeField[idx] ?? 0;
      if (shape <= 0.04) {
        nextHeight[idx] = currentHeight[idx];
        nextWater[idx] = 0;
        nextSediment[idx] = 0;
        continue;
      }

      let water = clamp(nextWater[idx] * (1 - evaporation), 0, maxWater);
      const slope = receiverDrop[idx];
      const speed = receiver[idx] >= 0 ? clamp(receiverSpeed[idx], 0, maxWaterSpeed) : 0;
      const speedNorm = maxWaterSpeed > 1e-6 ? speed / maxWaterSpeed : 0;
      if (speed <= 0.02) {
        const stagnationRetention = smoothstep(
          0.16,
          0.82,
          (basinField[idx] ?? 0) * 0.58
          + (bootstrapDepositField[idx] ?? 0) * 0.16
          + (tectonicStressField[idx] ?? 0) * 0.1
        );
        water = Math.max(
          0,
          water
          - drainage
            * mix(1, 0.82, basinStrength)
            * mix(1, 0.32, stagnationRetention)
        );
      }
      nextWater[idx] = water;

      const localHardness = sampleHardness(
        nextHeight[idx],
        hardnessOffsetField[idx] ?? 0,
        layeredPhaseField[idx] ?? 0,
        crossBandField[idx] ?? 0,
        terraceFrequency
      );
      const stress = tectonicStressField[idx] ?? 0;
      const hardenedValue = clamp(localHardness * (1 + stress * 0.18) + stress * 0.08, 0, 1);
      hardness[idx] = hardenedValue;
      const hardnessAttenuation = Math.pow(2, -terraceHardness * hardenedValue);
      const basin = basinField[idx] ?? 0;
      const convergence = smoothstep(0, 3, donorCount[idx]);
      const coastAttenuation = smoothstep(0.14, 0.5, shape) * mix(1, 0.84, coastalShelfWidth);
      const alignedFlow = structuralFlowBias[idx] ?? 0;
      const pondingPotential = smoothstep(
        0.16,
        0.84,
        basin * 0.52
        + convergence * 0.2
        + bootstrapDepositField[idx] * 0.18
        + (1 - speedNorm) * 0.06
        + stress * 0.12
      );

      let sediment = Math.max(0, nextSediment[idx]);
      const capacity =
        water
        * (0.12 + speed * capacityScale)
        * (0.34 + speedNorm * 0.66)
        * (0.8 + convergence * 0.35)
        * (0.9 + alignedFlow * 0.16 + stress * 0.12)
        * coastAttenuation;

      if (sediment > capacity) {
        const excess = sediment - capacity;
        const deposit =
          excess
          * depositionRate
          * (0.64 + (1 - speedNorm) * 0.24 + convergence * 0.12 + pondingPotential * 0.12);
        sediment -= deposit;
        nextHeight[idx] = clamp(nextHeight[idx] + deposit * sedimentToHeight, 0, 1);
        depositAcc[idx] += deposit;
      } else {
        const deficit = capacity - sediment;
        const slopeFactor = smoothstep(0.0005, 0.02, slope);
        const pickup =
          Math.min(
            deficit * pickupRate,
            nextHeight[idx] / Math.max(sedimentToHeight, 1e-6)
          )
          * (0.42 + slopeFactor * 0.58)
          * hardnessAttenuation
          * (1 - pondingPotential * 0.18)
          * (0.74 + basin * 0.14 + convergence * 0.08 + alignedFlow * 0.04 + stress * 0.08)
          * coastAttenuation;
        sediment += pickup;
        nextHeight[idx] = clamp(nextHeight[idx] - pickup * sedimentToHeight, 0, 1);
        wearAcc[idx] += pickup * (0.7 + convergence * 0.2 + alignedFlow * 0.06 + stress * 0.08);
      }
      nextSediment[idx] = Math.max(0, sediment);

      if (yieldIfNeeded && visit > 0 && visit % Math.max(2048, cols * 12) === 0) {
        if (await yieldIfNeeded()) {
          const iterProgress = (iteration + visit / Math.max(1, visitCount)) / Math.max(1, iterations);
          await reportProgress?.(iterProgress);
        }
      }
    }

    const swapHeight = currentHeight;
    currentHeight = nextHeight;
    nextHeight = swapHeight;

    const swapWater = currentWater;
    currentWater = nextWater;
    nextWater = swapWater;

    const swapSediment = currentSediment;
    currentSediment = nextSediment;
    nextSediment = swapSediment;

    if (yieldIfNeeded && (await yieldIfNeeded())) {
      await reportProgress?.((iteration + 1) / Math.max(1, iterations));
    }
  }

  let maxWear = 0;
  let maxDeposit = 0;
  for (let i = 0; i < total; i += 1) {
    maxWear = Math.max(maxWear, wearAcc[i]);
    maxDeposit = Math.max(maxDeposit, depositAcc[i]);
  }
  const invWear = maxWear > 1e-6 ? 1 / maxWear : 0;
  const invDeposit = maxDeposit > 1e-6 ? 1 / maxDeposit : 0;
  const wear = new Float32Array(total);
  const deposit = new Float32Array(total);
  for (let i = 0; i < total; i += 1) {
    const bootstrapWearValue = bootstrapWearField[i] ?? 0;
    const bootstrapDepositValue = bootstrapDepositField[i] ?? 0;
    wear[i] = clamp(
      Math.pow(wearAcc[i] * invWear, 0.72) * mix(0.86, 0.98, refinementBoost - 1) + bootstrapWearValue * 0.24,
      0,
      1
    );
    deposit[i] = clamp(
      Math.pow(depositAcc[i] * invDeposit, 0.78) * mix(0.88, 1, refinementBoost - 1) + bootstrapDepositValue * 0.18,
      0,
      1
    );
  }

  return {
    height: currentHeight,
    wear,
    deposit,
    flowX,
    flowY,
    hardness
  };
};
