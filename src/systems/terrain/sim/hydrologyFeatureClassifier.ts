import type { MapGenSettings } from "../../../mapgen/settings.js";
import type {
  StaticHydrologyFeatureClass,
  StaticHydrologyFeatureCounts,
  StaticHydrologyLake,
  StaticHydrologyWaterfall
} from "../types/staticHydrologyTypes.js";
import type { LakeOverflowRiverPath } from "./lakeOverflowRiverRouting.js";

export const HYDROLOGY_FEATURE_CLASS_CODE: Record<StaticHydrologyFeatureClass, number> = {
  none: 0,
  "sheet-flow": 1,
  channel: 2,
  river: 3,
  lake: 4,
  "lake-outlet": 5,
  "waterfall-lip": 6,
  "waterfall-runout": 7,
  "river-mouth": 8,
  "failed-overflow": 9
};

export const HYDROLOGY_FEATURE_CLASS_BY_CODE: StaticHydrologyFeatureClass[] = [
  "none",
  "sheet-flow",
  "channel",
  "river",
  "lake",
  "lake-outlet",
  "waterfall-lip",
  "waterfall-runout",
  "river-mouth",
  "failed-overflow"
];

const FEATURE_PRIORITY: Record<StaticHydrologyFeatureClass, number> = {
  none: 0,
  "sheet-flow": 1,
  channel: 2,
  river: 3,
  lake: 4,
  "lake-outlet": 5,
  "river-mouth": 6,
  "waterfall-runout": 7,
  "waterfall-lip": 8,
  "failed-overflow": 9
};

export type HydrologyFeatureClassification = {
  featureClass: Uint8Array;
  featureCounts: StaticHydrologyFeatureCounts;
  routes: LakeOverflowRiverPath[];
  waterfallCandidates: StaticHydrologyWaterfall[];
  terminalRoutes: number;
  failedRoutes: number;
};

export type HydrologyFeatureClassifierInput = {
  cols: number;
  rows: number;
  elevationMap: ArrayLike<number>;
  oceanMask: Uint8Array;
  lakeMask: Uint16Array;
  lakes: readonly StaticHydrologyLake[];
  routes: readonly LakeOverflowRiverPath[];
  flow: Float32Array;
  settings: MapGenSettings;
};

export const createEmptyHydrologyFeatureCounts = (): StaticHydrologyFeatureCounts => ({
  none: 0,
  "sheet-flow": 0,
  channel: 0,
  river: 0,
  lake: 0,
  "lake-outlet": 0,
  "waterfall-lip": 0,
  "waterfall-runout": 0,
  "river-mouth": 0,
  "failed-overflow": 0
});

export const featureForCode = (code: number): StaticHydrologyFeatureClass =>
  HYDROLOGY_FEATURE_CLASS_BY_CODE[code] ?? "none";

const setFeature = (classes: Uint8Array, idx: number, feature: StaticHydrologyFeatureClass): void => {
  if (idx < 0 || idx >= classes.length) {
    return;
  }
  const current = featureForCode(classes[idx] ?? 0);
  if (FEATURE_PRIORITY[feature] >= FEATURE_PRIORITY[current]) {
    classes[idx] = HYDROLOGY_FEATURE_CLASS_CODE[feature];
  }
};

export const countHydrologyFeatures = (classes: Uint8Array): StaticHydrologyFeatureCounts => {
  const counts = createEmptyHydrologyFeatureCounts();
  for (let i = 0; i < classes.length; i += 1) {
    counts[featureForCode(classes[i] ?? 0)] += 1;
  }
  return counts;
};

const classifyFlow = (flow: number, settings: MapGenSettings): StaticHydrologyFeatureClass => {
  if (flow >= Math.max(0.62, settings.waterfallMinFlow * 1.55)) {
    return "river";
  }
  if (flow >= Math.max(0.32, settings.waterfallMinFlow * 0.82)) {
    return "channel";
  }
  if (flow >= 0.1) {
    return "sheet-flow";
  }
  return "none";
};

const sourceForRouteStep = (
  route: LakeOverflowRiverPath,
  lake: StaticHydrologyLake,
  pathIndex: number
): number => pathIndex === 0 ? lake.outletIndex : route.tiles[pathIndex - 1] ?? -1;

const sourceSurfaceForRouteStep = (
  route: LakeOverflowRiverPath,
  lake: StaticHydrologyLake,
  pathIndex: number,
  elevationMap: ArrayLike<number>
): number => {
  if (pathIndex === 0) {
    return lake.surfaceLevel;
  }
  const sourceIndex = route.tiles[pathIndex - 1] ?? -1;
  return sourceIndex >= 0 ? elevationMap[sourceIndex] ?? lake.surfaceLevel : lake.surfaceLevel;
};

export const classifyHydrologyFeatures = (
  input: HydrologyFeatureClassifierInput
): HydrologyFeatureClassification => {
  const { cols, rows, elevationMap, oceanMask, lakeMask, lakes, routes, flow, settings } = input;
  const total = cols * rows;
  const featureClass = new Uint8Array(total);
  const waterfallCandidates: StaticHydrologyWaterfall[] = [];
  const lakeById = new Map<number, StaticHydrologyLake>(lakes.map((lake) => [lake.id, lake]));

  for (let idx = 0; idx < total; idx += 1) {
    if (oceanMask[idx] > 0) {
      continue;
    }
    if (lakeMask[idx] > 0) {
      setFeature(featureClass, idx, "lake");
      continue;
    }
    setFeature(featureClass, idx, classifyFlow(flow[idx] ?? 0, settings));
  }

  for (const lake of lakes) {
    if (lake.outletIndex >= 0) {
      setFeature(featureClass, lake.outletIndex, "lake-outlet");
    }
  }

  let terminalRoutes = 0;
  let failedRoutes = 0;
  const outletWaterfallMinDrop = Math.max(0.01, settings.waterfallMinDrop * 0.5);
  for (const route of routes) {
    const lake = lakeById.get(route.lakeId);
    if (!lake) {
      continue;
    }
    if (!route.terminalReached) {
      failedRoutes += 1;
      for (const idx of route.tiles) {
        setFeature(featureClass, idx, "failed-overflow");
      }
      continue;
    }
    terminalRoutes += 1;
    for (let pathIndex = 0; pathIndex < route.tiles.length; pathIndex += 1) {
      const idx = route.tiles[pathIndex] ?? -1;
      if (idx < 0 || oceanMask[idx] > 0 || lakeMask[idx] > 0) {
        continue;
      }
      const sourceIndex = sourceForRouteStep(route, lake, pathIndex);
      const sourceSurface = sourceSurfaceForRouteStep(route, lake, pathIndex, elevationMap);
      const targetSurface = elevationMap[idx] ?? sourceSurface;
      const localDrop = Math.max(0, sourceSurface - targetSurface);
      const routeFeature = flow[idx] >= Math.max(0.38, settings.waterfallMinFlow * 0.85)
        ? "river"
        : "channel";
      setFeature(featureClass, idx, routeFeature);
      const isOutletStep = pathIndex === 0;
      const waterfallMinDrop = isOutletStep ? outletWaterfallMinDrop : settings.waterfallMinDrop;
      if (sourceIndex >= 0 && localDrop >= waterfallMinDrop) {
        waterfallCandidates.push({
          sourceIndex,
          targetIndex: idx,
          drop: localDrop,
          flowScore: Math.max(lake.runoffScore, flow[sourceIndex] ?? 0, flow[idx] ?? 0),
          lakeId: isOutletStep ? lake.id : 0
        });
      }
    }
    const finalTile = route.tiles[route.tiles.length - 1] ?? -1;
    if (finalTile >= 0 && (route.reachedOcean || route.reachedLakeId > 0 || route.reachedExistingRiver)) {
      setFeature(featureClass, finalTile, "river-mouth");
    }
  }

  return {
    featureClass,
    featureCounts: countHydrologyFeatures(featureClass),
    routes: [...routes],
    waterfallCandidates,
    terminalRoutes,
    failedRoutes
  };
};
