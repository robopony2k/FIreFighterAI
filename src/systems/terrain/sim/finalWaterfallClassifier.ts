import type { MapGenSettings } from "../../../mapgen/settings.js";
import type {
  StaticHydrologyLake,
  StaticHydrologyWaterfall,
  StaticHydrologyWaterfallRejectReason
} from "../types/staticHydrologyTypes.js";
import {
  HYDROLOGY_FEATURE_CLASS_CODE,
  countHydrologyFeatures
} from "./hydrologyFeatureClassifier.js";
import type { LakeOverflowRiverPath } from "./lakeOverflowRiverRouting.js";

const LAKE_OUTLET_MIN_DROP_SCALE = 0.5;
const LAKE_OUTLET_MIN_DROP_FLOOR = 0.01;

type FinalWaterfallCandidate = {
  waterfall: StaticHydrologyWaterfall;
  routeIndex: number;
  order: number;
};

export type FinalWaterfallDecision = {
  waterfall: StaticHydrologyWaterfall;
  accepted: boolean;
  reason?: StaticHydrologyWaterfallRejectReason;
};

export type FinalWaterfallClassification = {
  waterfalls: StaticHydrologyWaterfall[];
  featureClass: Uint8Array;
  featureCounts: ReturnType<typeof countHydrologyFeatures>;
  decisions: FinalWaterfallDecision[];
};

export type FinalWaterfallClassifierInput = {
  cols: number;
  rows: number;
  routes: readonly LakeOverflowRiverPath[];
  lakes: readonly StaticHydrologyLake[];
  riverMask: Uint8Array;
  oceanMask: Uint8Array;
  lakeMask: Uint16Array;
  lakeOutletMask: Uint8Array;
  riverSurface: Float32Array;
  lakeSurface: Float32Array;
  flow: Float32Array;
  oceanDistance: Uint16Array;
  baseFeatureClass: Uint8Array;
  settings: MapGenSettings;
};

const areAdjacent = (a: number, b: number, cols: number): boolean => {
  if (a < 0 || b < 0) {
    return false;
  }
  const ax = a % cols;
  const ay = Math.floor(a / cols);
  const bx = b % cols;
  const by = Math.floor(b / cols);
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by)) === 1;
};

const surfaceAt = (
  idx: number,
  riverMask: Uint8Array,
  lakeMask: Uint16Array,
  riverSurface: Float32Array,
  lakeSurface: Float32Array
): number => {
  if (idx < 0 || idx >= riverMask.length) {
    return Number.NaN;
  }
  if (lakeMask[idx] > 0 && Number.isFinite(lakeSurface[idx])) {
    return lakeSurface[idx] as number;
  }
  if (riverMask[idx] > 0 && Number.isFinite(riverSurface[idx])) {
    return riverSurface[idx] as number;
  }
  return Number.NaN;
};

const candidateForEdge = (
  sourceIndex: number,
  targetIndex: number,
  lakeId: number,
  routeIndex: number,
  order: number,
  input: FinalWaterfallClassifierInput
): FinalWaterfallCandidate | null => {
  if (!areAdjacent(sourceIndex, targetIndex, input.cols)) {
    return null;
  }
  if (input.oceanMask[sourceIndex] > 0 || input.oceanMask[targetIndex] > 0) {
    return null;
  }
  const sourceSurface = surfaceAt(
    sourceIndex,
    input.riverMask,
    input.lakeMask,
    input.riverSurface,
    input.lakeSurface
  );
  const targetSurface = surfaceAt(
    targetIndex,
    input.riverMask,
    input.lakeMask,
    input.riverSurface,
    input.lakeSurface
  );
  if (!Number.isFinite(sourceSurface) || !Number.isFinite(targetSurface)) {
    return null;
  }
  const drop = Math.max(0, sourceSurface - targetSurface);
  const lake = lakeId > 0 ? input.lakes.find((entry) => entry.id === lakeId) : undefined;
  return {
    waterfall: {
      sourceIndex,
      targetIndex,
      drop,
      flowScore: Math.max(lake?.runoffScore ?? 0, input.flow[sourceIndex] ?? 0, input.flow[targetIndex] ?? 0),
      lakeId
    },
    routeIndex,
    order
  };
};

const collectCandidates = (input: FinalWaterfallClassifierInput): FinalWaterfallCandidate[] => {
  const lakeById = new Map<number, StaticHydrologyLake>(input.lakes.map((lake) => [lake.id, lake]));
  const candidates: FinalWaterfallCandidate[] = [];
  const seenEdges = new Set<string>();
  const addEdge = (source: number, target: number, lakeId: number, routeIndex: number, order: number): void => {
    const key = `${source}>${target}`;
    if (seenEdges.has(key)) {
      return;
    }
    const candidate = candidateForEdge(source, target, lakeId, routeIndex, order, input);
    if (!candidate) {
      return;
    }
    seenEdges.add(key);
    candidates.push(candidate);
  };

  input.routes.forEach((route, routeIndex) => {
    const lake = lakeById.get(route.lakeId);
    let previous = -1;
    let order = 0;
    if (
      lake &&
      lake.outletIndex >= 0 &&
      lake.outletTargetIndex >= 0 &&
      input.lakeOutletMask[lake.outletIndex] > 0
    ) {
      addEdge(lake.outletIndex, lake.outletTargetIndex, lake.id, routeIndex, order);
      previous = lake.outletTargetIndex;
      order += 1;
    }
    for (const idx of route.tiles) {
      if (idx < 0 || input.riverMask[idx] === 0 || input.lakeMask[idx] > 0 || input.oceanMask[idx] > 0) {
        continue;
      }
      if (idx === previous) {
        continue;
      }
      if (previous >= 0 && areAdjacent(previous, idx, input.cols)) {
        addEdge(previous, idx, 0, routeIndex, order);
        order += 1;
      }
      previous = idx;
    }
  });
  return candidates.sort((a, b) => a.routeIndex - b.routeIndex || a.order - b.order || a.waterfall.sourceIndex - b.waterfall.sourceIndex);
};

const spacingAccepts = (
  waterfall: StaticHydrologyWaterfall,
  accepted: readonly StaticHydrologyWaterfall[],
  cols: number,
  spacing: number
): boolean => {
  const x = waterfall.sourceIndex % cols;
  const y = Math.floor(waterfall.sourceIndex / cols);
  return accepted.every((other) => {
    const ox = other.sourceIndex % cols;
    const oy = Math.floor(other.sourceIndex / cols);
    return Math.hypot(x - ox, y - oy) >= spacing;
  });
};

export const classifyFinalWaterfalls = (
  input: FinalWaterfallClassifierInput
): FinalWaterfallClassification => {
  const featureClass = new Uint8Array(input.baseFeatureClass);
  const candidates = collectCandidates(input);
  const waterfalls: StaticHydrologyWaterfall[] = [];
  const decisions: FinalWaterfallDecision[] = [];
  const acceptedByRoute = new Map<number, number>();

  for (const candidate of candidates) {
    const waterfall = candidate.waterfall;
    const minDrop = waterfall.lakeId > 0
      ? Math.max(LAKE_OUTLET_MIN_DROP_FLOOR, input.settings.waterfallMinDrop * LAKE_OUTLET_MIN_DROP_SCALE)
      : input.settings.waterfallMinDrop;
    let reason: StaticHydrologyWaterfallRejectReason | undefined;
    if (waterfall.drop < minDrop) {
      reason = "drop-small";
    } else if (waterfall.flowScore < input.settings.waterfallMinFlow) {
      reason = "flow-small";
    } else if ((input.oceanDistance[waterfall.targetIndex] ?? 0) < input.settings.waterfallAvoidCoastTiles) {
      reason = "coast-proximity";
    } else if (!input.settings.waterfallAllowLakeOutlet && waterfall.lakeId > 0) {
      reason = "drop-small";
    } else if (!spacingAccepts(waterfall, waterfalls, input.cols, input.settings.waterfallMinSpacingTiles)) {
      reason = "spacing";
    } else if ((acceptedByRoute.get(candidate.routeIndex) ?? 0) >= input.settings.waterfallMaxPerRiver) {
      reason = "max-count";
    }
    if (reason) {
      decisions.push({ waterfall, accepted: false, reason });
      continue;
    }
    waterfalls.push(waterfall);
    acceptedByRoute.set(candidate.routeIndex, (acceptedByRoute.get(candidate.routeIndex) ?? 0) + 1);
    featureClass[waterfall.sourceIndex] = HYDROLOGY_FEATURE_CLASS_CODE["waterfall-lip"];
    featureClass[waterfall.targetIndex] = HYDROLOGY_FEATURE_CLASS_CODE["waterfall-runout"];
    decisions.push({ waterfall, accepted: true });
  }

  return {
    waterfalls,
    featureClass,
    featureCounts: countHydrologyFeatures(featureClass),
    decisions
  };
};
