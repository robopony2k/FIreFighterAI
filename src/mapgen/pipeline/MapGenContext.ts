import type { RNG } from "../../core/types.js";
import type { WorldState } from "../../core/state.js";
import type { MapGenDebug, MapGenDebugPhase, MapGenReporter } from "../mapgenTypes.js";
import type { MapGenSettings } from "../settings.js";
import { DEFAULT_MAP_GEN_SETTINGS, DEFAULT_ROAD_GEN_SETTINGS } from "../settings.js";
import { mapSizeIdFromDimensions, resolveTerrainProfile, type ResolvedTerrainProfile, type TerrainRecipe } from "../terrainProfile.js";
import { DirtyRegionTracker } from "./DirtyRegionTracker.js";
import type { SettlementPlacementResult } from "../communities.js";

export type SettlementStageData = {
  typeBefore: Uint8Array;
  elevationBefore: Float32Array;
};

export class MapGenContext {
  readonly state: WorldState;
  readonly rng: RNG;
  readonly profile: ResolvedTerrainProfile;
  readonly settings: MapGenSettings;
  report?: MapGenReporter;
  debug?: MapGenDebug;
  readonly yieldIfNeeded: () => Promise<boolean>;
  readonly dirtyRegions: DirtyRegionTracker;

  readonly cellSizeM: number;
  readonly worldOffsetXM: number;
  readonly worldOffsetYM: number;
  readonly microScaleM: number;
  readonly forestMacroScaleM: number;
  readonly forestDetailScaleM: number;
  readonly meadowScaleM: number;
  readonly edgeDenomM: number;
  readonly biomeBlock: number;

  elevationMap: number[] | null = null;
  riverMask: Uint8Array | null = null;
  seaLevelBase = 0;
  erosionWearMap: Float32Array | null = null;
  erosionDepositMap: Float32Array | null = null;
  erosionHardnessMap: Float32Array | null = null;
  erosionFlowXMap: Float32Array | null = null;
  erosionFlowYMap: Float32Array | null = null;
  tectonicStressMap: Float32Array | null = null;
  tectonicTrendXMap: Float32Array | null = null;
  tectonicTrendYMap: Float32Array | null = null;
  slopeMap: Float32Array | null = null;
  microMap: Float32Array | null = null;
  forestNoiseMap: Float32Array | null = null;
  meadowMaskMap: Float32Array | null = null;
  seaLevelMap: Float32Array | null = null;
  oceanMask: Uint8Array | null = null;
  waterDistMap: Uint16Array | null = null;
  moistureMap: Float32Array | null = null;
  biomeSuitabilityMap: Float32Array | null = null;
  elevationStressMap: Float32Array | null = null;
  slopeStressMap: Float32Array | null = null;
  treeSuitabilityMap: Float32Array | null = null;
  treeProbabilityMap: Float32Array | null = null;
  treeDensityMap: Float32Array | null = null;
  forestMask: Uint8Array | null = null;
  settlementSnapshot: SettlementStageData | null = null;
  settlementPlan: SettlementPlacementResult | null = null;

  private stage: MapGenDebugPhase = "terrain:elevation";
  private stageReport: ((message: string, localProgress: number) => Promise<void>) | null = null;

  constructor(
    state: WorldState,
    rng: RNG,
    report: MapGenReporter | undefined,
    terrain: MapGenSettings | TerrainRecipe | ResolvedTerrainProfile | undefined,
    debug: MapGenDebug | undefined,
    yieldIfNeeded: () => Promise<boolean>
  ) {
    this.state = state;
    this.rng = rng;
    this.report = report;
    this.profile = resolveTerrainProfile(terrain, mapSizeIdFromDimensions(state.grid.cols));
    this.settings = {
      ...DEFAULT_MAP_GEN_SETTINGS,
      ...this.profile.settings,
      road: {
        ...DEFAULT_ROAD_GEN_SETTINGS,
        ...(this.profile.settings.road ?? {})
      }
    };
    this.debug = debug;
    this.yieldIfNeeded = yieldIfNeeded;
    this.dirtyRegions = new DirtyRegionTracker(state.grid.cols, state.grid.rows);

    this.cellSizeM = Math.max(0.1, this.settings.cellSizeM);
    this.worldOffsetXM = this.settings.worldOffsetXM;
    this.worldOffsetYM = this.settings.worldOffsetYM;
    this.microScaleM = Math.max(1, this.settings.microScaleM);
    this.forestMacroScaleM = Math.max(1, this.settings.forestMacroScale * this.cellSizeM);
    this.forestDetailScaleM = Math.max(1, this.settings.forestDetailScale * this.cellSizeM);
    this.meadowScaleM = Math.max(1, this.settings.meadowScale * this.cellSizeM);
    const minDimM = Math.min(state.grid.cols, state.grid.rows) * this.cellSizeM;
    this.edgeDenomM = minDimM / 2;
    const maxDim = Math.max(state.grid.cols, state.grid.rows);
    this.biomeBlock = maxDim >= 1024 ? 8 : maxDim >= 512 ? 4 : 2;
  }

  setRunOptions(report: MapGenReporter | undefined, debug: MapGenDebug | undefined): void {
    this.report = report;
    this.debug = debug;
  }

  setStageReporter(phase: MapGenDebugPhase, fn: (message: string, localProgress: number) => Promise<void>): void {
    this.stage = phase;
    this.stageReport = fn;
  }

  async reportStage(message: string, localProgress: number): Promise<void> {
    if (!this.stageReport) {
      return;
    }
    await this.stageReport(message, localProgress);
  }

  get currentPhase(): MapGenDebugPhase {
    return this.stage;
  }
}
