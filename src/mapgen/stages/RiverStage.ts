import { clearVegetationState } from "../../core/vegetation.js";
import { getTerrainHeightScale } from "../../core/terrainScale.js";
import { buildDepressionLakeField } from "../../systems/terrain/sim/depressionLakeField.js";
import { buildFlowAccumulationRiverNetwork } from "../../systems/terrain/sim/flowAccumulationRiverNetwork.js";
import { HYDROLOGY_FEATURE_CLASS_CODE } from "../../systems/terrain/sim/hydrologyFeatureClassifier.js";
import { buildTerrainMorphologyFields } from "../../systems/terrain/sim/terrainMorphology.js";
import type { StaticHydrologyFeatureCounts } from "../../systems/terrain/types/staticHydrologyTypes.js";
import { buildRiverChannelHierarchy } from "../riverChannelHierarchy.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";

const emptyFeatureCounts = (): StaticHydrologyFeatureCounts => ({
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

export const RiverStage: PipelineStage = {
  id: "hydro:rivers",
  weight: 10,
  run: async (ctx) => {
    const {
      state,
      settings,
      elevationMap,
      seaLevelMap,
      oceanMask,
      riverMask,
      drainageReceiverMap,
      flowAccumulationMap,
      depressionFillMap,
      depressionDepthMap
    } = ctx;
    if (
      !elevationMap ||
      !seaLevelMap ||
      !oceanMask ||
      !riverMask ||
      !drainageReceiverMap ||
      !flowAccumulationMap ||
      !depressionFillMap ||
      !depressionDepthMap
    ) {
      throw new Error("River stage missing terrain, shoreline, or erosion drainage fields.");
    }

    const total = state.grid.totalTiles;
    riverMask.fill(0);
    state.tileRiverMask = new Uint8Array(total);
    state.tileRiverBed = new Float32Array(total).fill(Number.NaN);
    state.tileRiverSurface = new Float32Array(total).fill(Number.NaN);
    state.tileRiverStepStrength = new Float32Array(total);
    state.tileRiverChannelClass = new Uint8Array(total);
    state.tileRiverChannelWidth = new Float32Array(total);
    state.tileRiverChannelDownstream = new Int32Array(total).fill(-1);
    state.tileLakeMask = new Uint16Array(total);
    state.tileLakeSurface = new Float32Array(total).fill(Number.NaN);
    state.tileLakeOutletMask = new Uint8Array(total);
    state.tileWaterfallSourceMask = new Uint8Array(total);
    state.tileWaterfallTarget = new Int32Array(total).fill(-1);
    state.tileWaterfallDrop = new Float32Array(total);
    state.valleyMap = Array.from({ length: total }, () => 0);

    const lakes = buildDepressionLakeField({
      cols: state.grid.cols,
      rows: state.grid.rows,
      elevations: elevationMap,
      filledElevation: depressionFillMap,
      depressionDepth: depressionDepthMap,
      flowAccumulation: flowAccumulationMap,
      oceanMask,
      riverIntensity: settings.riverIntensity,
      basinStrength: settings.basinStrength,
      minLakeDepth: settings.minLakeDepth,
      minLakeAreaTiles: settings.minLakeAreaTiles,
      maxLakeAreaTiles: settings.maxLakeAreaTiles,
      maxLakeCount: settings.maxLakeCount
    });
    const rivers = buildFlowAccumulationRiverNetwork({
      cols: state.grid.cols,
      rows: state.grid.rows,
      elevations: elevationMap,
      oceanMask,
      seaLevelMap,
      receiver: drainageReceiverMap,
      flowAccumulation: flowAccumulationMap,
      lakeMask: lakes.lakeMask,
      riverIntensity: settings.riverIntensity,
      riverBudget: settings.riverBudget,
      minLakeDepth: settings.minLakeDepth
    });

    const featureClass = new Uint8Array(total);
    const featureCounts = emptyFeatureCounts();
    for (let i = 0; i < total; i += 1) {
      if (oceanMask[i] > 0) continue;
      const lakeId = lakes.lakeMask[i] ?? 0;
      if (lakeId > 0) {
        const surface = lakes.lakeSurface[i] ?? elevationMap[i] ?? 0;
        const bed = Math.min(elevationMap[i] ?? surface, surface - Math.max(0.00045, settings.minLakeDepth * 0.35));
        elevationMap[i] = Math.max(0, bed);
        state.tileLakeMask[i] = lakeId;
        state.tileLakeSurface[i] = surface;
        featureClass[i] = HYDROLOGY_FEATURE_CLASS_CODE.lake;
        featureCounts.lake += 1;
      } else if (rivers.riverMask[i] > 0) {
        const surface = rivers.riverSurface[i] ?? elevationMap[i] ?? 0;
        const bed = rivers.riverBed[i] ?? surface - 0.00045;
        riverMask[i] = 1;
        state.tileRiverMask[i] = 1;
        state.tileRiverSurface[i] = surface;
        state.tileRiverBed[i] = bed;
        state.tileRiverStepStrength[i] = rivers.channelStrength[i] ?? 0;
        state.valleyMap[i] = rivers.valleyDepth[i] ?? 0;
        elevationMap[i] = Math.min(elevationMap[i] ?? bed, bed);
        featureClass[i] = HYDROLOGY_FEATURE_CLASS_CODE.river;
        featureCounts.river += 1;
      } else {
        featureCounts.none += 1;
        continue;
      }

      const tile = state.tiles[i];
      tile.type = "water";
      tile.elevation = elevationMap[i] ?? tile.elevation;
      tile.moisture = 1;
      tile.waterDist = 0;
      tile.fuel = 0;
      tile.fire = 0;
      tile.heat = 0;
      tile.isBase = false;
      clearVegetationState(tile);
      tile.dominantTreeType = null;
      tile.treeType = null;
      state.tileElevation[i] = tile.elevation;
      state.tileMoisture[i] = 1;
      state.tileFuel[i] = 0;
      state.tileFire[i] = 0;
    }

    const channelHierarchy = buildRiverChannelHierarchy(
      rivers.channelNodeMask,
      flowAccumulationMap,
      {
        tributary: rivers.tributaryThreshold,
        stream: rivers.streamThreshold,
        river: rivers.riverThreshold
      }
    );
    state.tileRiverChannelClass = channelHierarchy.channelClass;
    state.tileRiverChannelWidth = channelHierarchy.channelWidth;
    state.tileRiverChannelDownstream = rivers.channelDownstream;
    ctx.riverChannelClassMap = channelHierarchy.channelClass;
    ctx.riverChannelWidthMap = channelHierarchy.channelWidth;
    ctx.riverChannelDownstreamMap = rivers.channelDownstream;

    ctx.lakeMask = state.tileLakeMask;
    ctx.lakeSurfaceMap = state.tileLakeSurface;
    ctx.lakeOutletMask = state.tileLakeOutletMask;
    ctx.rainfallMap = Float32Array.from(flowAccumulationMap);
    ctx.runoffMap = Float32Array.from(flowAccumulationMap);
    ctx.riverLakeEntryMask = new Uint8Array(total);
    ctx.riverLakeExitMask = new Uint8Array(total);
    ctx.waterfallSourceMask = state.tileWaterfallSourceMask;
    ctx.waterfallTargetMap = state.tileWaterfallTarget;
    ctx.waterfallDropMap = state.tileWaterfallDrop;
    ctx.hydrologyFeatureClass = featureClass;
    ctx.hydrologyFeatureCounts = featureCounts;
    ctx.staticHydrologyLakes = lakes.lakes;
    ctx.staticHydrologyWaterfalls = [];
    ctx.staticHydrologyRejectedLakeCandidates = {};
    ctx.staticHydrologyRejectedWaterfallCandidates = 0;

    const morphology = buildTerrainMorphologyFields({
      cols: state.grid.cols,
      rows: state.grid.rows,
      elevations: elevationMap,
      heightScale: getTerrainHeightScale(state.grid.cols, state.grid.rows, settings.heightScaleMultiplier),
      erosionWear: ctx.erosionWearMap,
      erosionDeposit: ctx.erosionDepositMap
    });
    ctx.rockExposureMap = morphology.rockExposure;
    ctx.terrainCurvatureMap = morphology.curvature;
    if (state.tileRockExposure.length !== morphology.rockExposure.length) {
      state.tileRockExposure = new Float32Array(morphology.rockExposure.length);
    }
    state.tileRockExposure.set(morphology.rockExposure);
    for (let i = 0; i < total; i += 1) {
      const resolvedElevation = elevationMap[i] ?? state.tiles[i].elevation;
      state.tiles[i].elevation = resolvedElevation;
      state.tileElevation[i] = resolvedElevation;
    }
    state.tileRiverMask = riverMask;
    await ctx.reportStage("Resolving accumulation rivers and depression lakes...", 1);
    await emitStageSnapshot(ctx, "hydro:rivers");
  }
};
