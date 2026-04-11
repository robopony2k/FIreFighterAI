import { DEBUG_TERRAIN } from "../../core/config.js";
import { inBounds, indexFor } from "../../core/grid.js";
import { clamp } from "../../core/utils.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import { clampSeaLevel, resolveSeaLevelBase, smoothstep } from "../runtime.js";

export const ErosionStage: PipelineStage = {
  id: "terrain:erosion",
  weight: 8,
  run: async (ctx) => {
    const { state, settings, cellSizeM, edgeDenomM } = ctx;
    if (!ctx.elevationMap) {
      throw new Error("Erosion stage missing elevation map.");
    }
    const input = ctx.elevationMap;
    const total = input.length;
    const wearMap = ctx.erosionWearMap ?? new Float32Array(total);
    const depositMap = ctx.erosionDepositMap ?? new Float32Array(total);
    const flowXMap = ctx.erosionFlowXMap ?? new Float32Array(total);
    const flowYMap = ctx.erosionFlowYMap ?? new Float32Array(total);
    const tectonicStressMap = ctx.tectonicStressMap ?? new Float32Array(total);
    const tectonicTrendXMap = ctx.tectonicTrendXMap ?? new Float32Array(total);
    const tectonicTrendYMap = ctx.tectonicTrendYMap ?? new Float32Array(total);
    const activeMask = new Uint8Array(total);
    const slopeMin = Math.max(0.0001, settings.erosionSlopeMaskMin);
    const slopeMax = Math.max(slopeMin + 1e-4, settings.erosionSlopeMaskMax);
    const coastFadeStart = Math.max(0.0005, settings.erosionCoastFade);
    const coastFadeEnd = Math.max(coastFadeStart + 0.02, coastFadeStart * 3.2 + 0.02);
    const trackStats = DEBUG_TERRAIN;
    const previousHeights = Float32Array.from(input);
    const refinedHeights = Float32Array.from(input);
    const nextWear = Float32Array.from(wearMap);
    let coverage = 0;
    let absOffsetSum = 0;
    const absOffsets: number[] = [];
    for (let y = 0; y < state.grid.rows; y += 1) {
      for (let x = 0; x < state.grid.cols; x += 1) {
        const idx = indexFor(state.grid, x, y);
        const center = input[idx] ?? 0;
        const left = x > 0 ? (input[idx - 1] ?? center) : center;
        const right = x < state.grid.cols - 1 ? (input[idx + 1] ?? center) : center;
        const up = y > 0 ? (input[idx - state.grid.cols] ?? center) : center;
        const down = y < state.grid.rows - 1 ? (input[idx + state.grid.cols] ?? center) : center;
        const neighborAverage = (left + right + up + down) * 0.25;
        const curvature = neighborAverage - center;
        const gradX = (right - left) * 0.5;
        const gradY = (down - up) * 0.5;
        const slope = Math.hypot(gradX, gradY);
        const slopeMask = smoothstep(slopeMin, slopeMax, slope);
        const edgeDistM = Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y) * cellSizeM;
        const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
        const seaLevel = clampSeaLevel(ctx.seaLevelBase + (1 - edgeFactor) * settings.edgeWaterBias, settings);
        const headroom = center - seaLevel;
        const coastMask = smoothstep(coastFadeStart, coastFadeEnd, headroom);
        const baseWear = clamp(wearMap[idx] ?? 0, 0, 1);
        const baseDeposit = clamp(depositMap[idx] ?? 0, 0, 1);
        const wearMask = smoothstep(0.025, 0.38, baseWear);
        const concavityMask = smoothstep(0.00015, 0.007, curvature);
        const tectonicStress = smoothstep(0.06, 0.7, tectonicStressMap[idx] ?? 0);
        if (
          coastMask > 0.05 &&
          headroom > 0.002 &&
          (
            baseWear > 0.08 ||
            baseDeposit > 0.08 ||
            slopeMask > 0.14 ||
            concavityMask > 0.12 ||
            tectonicStress > 0.18
          )
        ) {
          activeMask[idx] = 1;
        }
      }
      if ((y === state.grid.rows - 1 || (y + 1) % 12 === 0) && (await ctx.yieldIfNeeded())) {
        await ctx.reportStage("Preparing erosion refinement...", (y + 1) / state.grid.rows * 0.35);
      }
    }

    const expandedMask = new Uint8Array(activeMask);
    for (let y = 0; y < state.grid.rows; y += 1) {
      for (let x = 0; x < state.grid.cols; x += 1) {
        const idx = indexFor(state.grid, x, y);
        if (activeMask[idx] === 0) {
          continue;
        }
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const nx = x + dx;
            const ny = y + dy;
            if (!inBounds(state.grid, nx, ny)) {
              continue;
            }
            expandedMask[indexFor(state.grid, nx, ny)] = 1;
          }
        }
      }
    }

    for (let y = 0; y < state.grid.rows; y += 1) {
      for (let x = 0; x < state.grid.cols; x += 1) {
        const idx = indexFor(state.grid, x, y);
        if (expandedMask[idx] === 0) {
          continue;
        }
        const center = input[idx] ?? 0;
        const left = x > 0 ? (input[idx - 1] ?? center) : center;
        const right = x < state.grid.cols - 1 ? (input[idx + 1] ?? center) : center;
        const up = y > 0 ? (input[idx - state.grid.cols] ?? center) : center;
        const down = y < state.grid.rows - 1 ? (input[idx + state.grid.cols] ?? center) : center;
        const neighborAverage = (left + right + up + down) * 0.25;
        const curvature = neighborAverage - center;
        const gradX = (right - left) * 0.5;
        const gradY = (down - up) * 0.5;
        const slope = Math.hypot(gradX, gradY);
        const slopeMask = smoothstep(slopeMin, slopeMax, slope);
        const edgeDistM = Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y) * cellSizeM;
        const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
        const seaLevel = clampSeaLevel(ctx.seaLevelBase + (1 - edgeFactor) * settings.edgeWaterBias, settings);
        const headroom = center - seaLevel;
        const coastMask = smoothstep(coastFadeStart, coastFadeEnd, headroom);
        const wearMask = smoothstep(0.06, 0.46, wearMap[idx] ?? 0);
        const depositMask = smoothstep(0.06, 0.46, depositMap[idx] ?? 0);
        const concavityMask = smoothstep(0.00008, 0.0035, curvature);
        const convexityMask = smoothstep(0.00005, 0.003, -curvature);
        const flatMask = 1 - smoothstep(slopeMin, Math.max(slopeMin * 2.4, slopeMax * 0.8), slope);
        let flowX = flowXMap[idx] ?? 0;
        let flowY = flowYMap[idx] ?? 0;
        if (Math.hypot(flowX, flowY) <= 1e-6 && slope > 1e-6) {
          flowX = -gradX / slope;
          flowY = -gradY / slope;
        }
        const flowLength = Math.hypot(flowX, flowY);
        if (flowLength > 1e-6) {
          flowX /= flowLength;
          flowY /= flowLength;
        }
        let trendX = tectonicTrendXMap[idx] ?? 0;
        let trendY = tectonicTrendYMap[idx] ?? 0;
        const trendLength = Math.hypot(trendX, trendY);
        if (trendLength > 1e-6) {
          trendX /= trendLength;
          trendY /= trendLength;
        }
        const structuralAlign = trendLength > 1e-6 && flowLength > 1e-6 ? Math.abs(flowX * trendX + flowY * trendY) : 0;
        const tectonicStress = smoothstep(0.06, 0.7, tectonicStressMap[idx] ?? 0);
        const channelSharpen =
          -0.0008
          * coastMask
          * wearMask
          * (0.42 + concavityMask * 0.58)
          * (0.34 + slopeMask * 0.66)
          * (0.74 + structuralAlign * 0.14 + tectonicStress * 0.12);
        const depositionalFill =
          clamp(neighborAverage - center, -0.0012, 0.0012)
          * coastMask
          * depositMask
          * flatMask
          * (0.18 + structuralAlign * 0.08);
        const shoulderRelax =
          clamp(neighborAverage - center, -0.001, 0.001)
          * coastMask
          * convexityMask
          * smoothstep(slopeMax * 0.8, Math.max(slopeMax * 2.4, slopeMax + 0.03), slope)
          * (0.08 + depositMask * 0.08 + tectonicStress * 0.06);
        const maxIncision = Math.max(0, headroom - 0.003);
        const adjustment = clamp(
          channelSharpen + depositionalFill + shoulderRelax,
          -Math.min(0.0014, maxIncision),
          0.0008
        );
        refinedHeights[idx] = clamp(center + adjustment, 0, 1);
        nextWear[idx] = clamp(
          Math.max(wearMap[idx] ?? 0, wearMask * 0.92 + concavityMask * 0.08 + Math.abs(adjustment) * 220),
          0,
          1
        );
      }
      if ((y === state.grid.rows - 1 || (y + 1) % 12 === 0) && (await ctx.yieldIfNeeded())) {
        await ctx.reportStage("Applying erosion refinement...", 0.35 + (y + 1) / state.grid.rows * 0.65);
      }
    }

    for (let i = 0; i < input.length; i += 1) {
      input[i] = refinedHeights[i] ?? input[i];
      if (trackStats) {
        const absOffset = Math.abs(input[i] - previousHeights[i]);
        absOffsetSum += absOffset;
        absOffsets.push(absOffset);
        if (absOffset >= 0.001) {
          coverage += 1;
        }
      }
    }

    ctx.erosionWearMap = nextWear;
    if (state.tileErosionWear.length !== nextWear.length) {
      state.tileErosionWear = new Float32Array(nextWear.length);
    }
    state.tileErosionWear.set(nextWear);
    ctx.seaLevelBase = resolveSeaLevelBase(state, settings, input, cellSizeM);
    if (trackStats && absOffsets.length > 0) {
      absOffsets.sort((left, right) => left - right);
      const p95Index = Math.min(absOffsets.length - 1, Math.floor((absOffsets.length - 1) * 0.95));
      const meanAbsOffset = absOffsetSum / Math.max(1, input.length);
      const coverageRatio = coverage / Math.max(1, input.length);
      console.log(
        `[erosiondetail] coverage=${coverageRatio.toFixed(4)} meanAbs=${meanAbsOffset.toFixed(5)} p95=${(absOffsets[p95Index] ?? 0).toFixed(5)}`
      );
    }
    await emitStageSnapshot(ctx, "terrain:erosion");
  }
};
