import type { WorldState } from "../../../core/state.js";
import { placeHouse } from "../../../core/towns.js";
import type { Point } from "../../../core/types.js";
import { clamp } from "../../../core/utils.js";
import { SETTLEMENT_GROWTH_PLAN_YEARS } from "../constants/settlementConstants.js";
import type {
  SettlementGrowthPlan,
  SettlementGrowthRoadSegment,
  SettlementGrowthTerrainEdit,
  SettlementRoadAdapter,
  SettlementRoadOptions
} from "../types/settlementTypes.js";
import {
  buildIntratownDiagnosticRouteId,
  buildIntratownDiagnosticRouteLabel,
  getRoadDiagnosticNowMs
} from "../utils/settlementRoadDiagnostics.js";
import type { RoadPathDiagnosticRouteReason } from "../../roads/types/roadPathDebugTypes.js";
import {
  assignDesiredGrowthDeltas,
  createEmptySettlementGrowthPlan,
  createGrowthDiagnosticRoadAdapter,
  emitIntratownGrowthDiagnostics,
  rebuildGrowthContext,
  reserveTownExpansionLot,
  updateTownEnvelope
} from "./townGrowth.js";

const clonePoint = <T extends Point>(point: T): T => ({ ...point });

const cloneRoadOptions = (options?: SettlementRoadOptions): SettlementRoadOptions | undefined =>
  options
    ? { ...options, searchBounds: options.searchBounds ? { ...options.searchBounds } : undefined }
    : undefined;

const cloneGrowthRoadSegment = (segment: SettlementGrowthRoadSegment): SettlementGrowthRoadSegment => ({
  start: clonePoint(segment.start),
  end: clonePoint(segment.end),
  options: cloneRoadOptions(segment.options),
  path: segment.path?.map(clonePoint),
  bridgeTileIndices: segment.bridgeTileIndices ? [...segment.bridgeTileIndices] : undefined
});

const cloneGrowthTerrainEdit = (edit: SettlementGrowthTerrainEdit): SettlementGrowthTerrainEdit => ({
  index: Math.max(0, Math.trunc(edit.index)),
  elevation: clamp(edit.elevation, 0, 1)
});

const getGrowthRoadSegmentKey = (segment: SettlementGrowthRoadSegment): string => {
  if (segment.path && segment.path.length > 0) {
    return segment.path.map((point) => `${point.x},${point.y}`).join(";");
  }
  return `${segment.start.x},${segment.start.y}>${segment.end.x},${segment.end.y}`;
};

const appendUniqueRoadSegments = (
  target: SettlementGrowthRoadSegment[],
  knownKeys: Set<string>,
  segments: readonly SettlementGrowthRoadSegment[]
): void => {
  for (const segment of segments) {
    const key = getGrowthRoadSegmentKey(segment);
    if (knownKeys.has(key)) continue;
    knownKeys.add(key);
    target.push(cloneGrowthRoadSegment(segment));
  }
};

const clonePlanningState = (state: WorldState): WorldState =>
  ({
    ...state,
    tiles: state.tiles.map((tile) => ({ ...tile })),
    towns: state.towns.map((town) => ({
      ...town,
      growthFrontiers: town.growthFrontiers.map((frontier) => ({ ...frontier })),
      selectedEvacuationPoint: town.selectedEvacuationPoint ? { ...town.selectedEvacuationPoint } : undefined
    })),
    buildingLots: state.buildingLots.map((lot) => ({ ...lot })),
    tileFire: new Float32Array(state.tileFire),
    tileFuel: new Float32Array(state.tileFuel),
    tileHeat: new Float32Array(state.tileHeat),
    tileBurnAge: new Float32Array(state.tileBurnAge),
    tileHeatRelease: new Float32Array(state.tileHeatRelease),
    tileIgnitionPoint: new Float32Array(state.tileIgnitionPoint),
    tileBurnRate: new Float32Array(state.tileBurnRate),
    tileHeatOutput: new Float32Array(state.tileHeatOutput),
    tileElevation: new Float32Array(state.tileElevation),
    tileMoisture: new Float32Array(state.tileMoisture),
    tileVegetationAge: new Float32Array(state.tileVegetationAge),
    tileCanopyCover: new Float32Array(state.tileCanopyCover),
    tileStemDensity: new Uint8Array(state.tileStemDensity),
    tileSpreadBoost: new Float32Array(state.tileSpreadBoost),
    tileHeatRetention: new Float32Array(state.tileHeatRetention),
    tileWindFactor: new Float32Array(state.tileWindFactor),
    tileHeatTransferCap: new Float32Array(state.tileHeatTransferCap),
    tileRoadBridge: new Uint8Array(state.tileRoadBridge),
    tileRoadEdges: new Uint8Array(state.tileRoadEdges),
    tileRoadWallEdges: new Uint8Array(state.tileRoadWallEdges),
    structureMask: new Uint8Array(state.structureMask),
    tileTownId: new Int16Array(state.tileTownId),
    tileStructure: new Uint8Array(state.tileStructure),
    tileTypeId: new Uint8Array(state.tileTypeId),
    plannedTownGrowth: createEmptySettlementGrowthPlan(state.towns.length)
  }) as WorldState;

const createRecordingRoadAdapter = (
  roadAdapter: SettlementRoadAdapter,
  segments: SettlementGrowthRoadSegment[]
): SettlementRoadAdapter => ({
  ...roadAdapter,
  carveRoad: (nextState, start, end, options = {}) => {
    const detailed = roadAdapter.carveRoadDetailed?.(nextState, start, end, options);
    const carved = detailed ? detailed.carved : roadAdapter.carveRoad(nextState, start, end, options);
    if (carved) {
      segments.push({
        start: clonePoint(start),
        end: clonePoint(end),
        options: cloneRoadOptions(options),
        path: detailed?.path.map(clonePoint),
        bridgeTileIndices: detailed ? [...detailed.bridgeTileIndices] : undefined
      });
    }
    return carved;
  },
  carveRoadSequence: roadAdapter.carveRoadSequence
    ? (nextState, roadSegments) => {
        if (roadAdapter.carveRoadDetailed) {
          for (const segment of roadSegments) {
            const detailed = roadAdapter.carveRoadDetailed(nextState, segment.start, segment.end, segment.options);
            if (!detailed.carved) return false;
            segments.push({
              start: clonePoint(segment.start),
              end: clonePoint(segment.end),
              options: cloneRoadOptions(segment.options),
              path: detailed.path.map(clonePoint),
              bridgeTileIndices: [...detailed.bridgeTileIndices]
            });
          }
          return true;
        }
        const carved = roadAdapter.carveRoadSequence!(nextState, roadSegments);
        if (carved) {
          for (const segment of roadSegments) {
            segments.push({
              start: clonePoint(segment.start),
              end: clonePoint(segment.end),
              options: cloneRoadOptions(segment.options)
            });
          }
        }
        return carved;
      }
    : undefined
});

export const createPrecomputedSettlementGrowthPlan = (
  state: WorldState,
  roadAdapter: SettlementRoadAdapter,
  plannedYears = SETTLEMENT_GROWTH_PLAN_YEARS
): SettlementGrowthPlan => {
  const safeYears = Math.max(0, Math.floor(plannedYears));
  const plan = createEmptySettlementGrowthPlan(state.towns.length, safeYears);
  if (state.towns.length === 0 || safeYears === 0) return plan;

  let planningState = clonePlanningState(state);
  const prerequisiteRoadsByTown = new Map<number, SettlementGrowthRoadSegment[]>();
  const prerequisiteRoadKeysByTown = new Map<number, Set<string>>();
  const exhaustedTownIds = new Set<number>();
  let sequence = 0;
  const baseEffectiveYear = Math.max(
    0,
    ...planningState.towns.map((town) => Math.max(0, Math.floor(town.simulatedGrowthYears ?? 0)))
  );
  for (let yearOffset = 0; yearOffset < safeYears; yearOffset += 1) {
    const effectiveYear = baseEffectiveYear + yearOffset;
    assignDesiredGrowthDeltas(planningState, effectiveYear, "mapgen");
    for (let townIndex = 0; townIndex < planningState.towns.length; townIndex += 1) {
      let town = planningState.towns[townIndex]!;
      if (exhaustedTownIds.has(town.id)) continue;
      const prerequisiteRoads = prerequisiteRoadsByTown.get(town.id) ?? [];
      const prerequisiteRoadKeys = prerequisiteRoadKeysByTown.get(town.id) ?? new Set<string>();
      prerequisiteRoadsByTown.set(town.id, prerequisiteRoads);
      prerequisiteRoadKeysByTown.set(town.id, prerequisiteRoadKeys);
      const desiredDelta = Math.max(0, Math.trunc(town.desiredHouseDelta ?? 0));
      const routeReason: RoadPathDiagnosticRouteReason = "future-growth-house-access";
      const routeId = buildIntratownDiagnosticRouteId(town.id, effectiveYear, routeReason);
      const routeLabel = `${buildIntratownDiagnosticRouteLabel(town, effectiveYear)} future-growth`;
      const routeStartedAt = getRoadDiagnosticNowMs();
      let connectedForTown = 0;
      for (let item = 0; item < desiredDelta; item += 1) {
        const diagnostics = {
          diagnosticRouteGroup: "futureGrowthPrecompute" as const,
          diagnosticRouteId: routeId,
          diagnosticRouteLabel: routeLabel,
          diagnosticRouteReason: routeReason
        };
        let targetState = planningState;
        let targetTown = town;
        let roadSegments: SettlementGrowthRoadSegment[] = [];
        let reservation = reserveTownExpansionLot(
          targetState,
          targetTown,
          rebuildGrowthContext(targetState),
          roadAdapter,
          effectiveYear,
          { ...diagnostics, mutateTerrain: false, roadGrowthPolicy: "none" }
        );
        if (!reservation) {
          targetState = clonePlanningState(planningState);
          targetTown = targetState.towns[townIndex]!;
          roadSegments = [];
          const recordingAdapter = createGrowthDiagnosticRoadAdapter(
            createRecordingRoadAdapter(roadAdapter, roadSegments),
            diagnostics
          );
          reservation = reserveTownExpansionLot(
            targetState,
            targetTown,
            rebuildGrowthContext(targetState),
            recordingAdapter,
            effectiveYear,
            { ...diagnostics, mutateTerrain: true, roadGrowthPolicy: "singleExtension" }
          );
          if (!reservation) {
            exhaustedTownIds.add(town.id);
            break;
          }
        }
        const tile = targetState.tiles[reservation.anchorIndex];
        if (!tile) {
          exhaustedTownIds.add(town.id);
          break;
        }
        targetState.structureMask[reservation.anchorIndex] = 0;
        tile.houseValue = reservation.houseValue;
        tile.houseResidents = reservation.houseResidents;
        if (!placeHouse(targetState, reservation.anchorIndex, targetTown.id, effectiveYear, reservation.styleSeed)) {
          exhaustedTownIds.add(town.id);
          break;
        }
        planningState = targetState;
        town = targetTown;
        appendUniqueRoadSegments(prerequisiteRoads, prerequisiteRoadKeys, roadSegments);
        updateTownEnvelope(planningState, targetTown);
        plan.entries.push({
          townId: targetTown.id,
          anchorIndex: reservation.anchorIndex,
          styleSeed: reservation.styleSeed,
          houseValue: reservation.houseValue,
          houseResidents: reservation.houseResidents,
          roadSegments: prerequisiteRoads.map(cloneGrowthRoadSegment),
          terrainEdits: reservation.terrainEdits.map(cloneGrowthTerrainEdit),
          plannedYear: effectiveYear,
          sequence,
          status: "pending"
        });
        connectedForTown += 1;
        sequence += 1;
      }
      emitIntratownGrowthDiagnostics(
        roadAdapter,
        town,
        routeId,
        routeLabel,
        "futureGrowthPrecompute",
        desiredDelta,
        connectedForTown,
        routeStartedAt,
        effectiveYear
      );
    }
  }
  return plan;
};
