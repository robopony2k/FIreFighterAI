export type RoadDiagnosticRouteGroup =
  | "unknown"
  | "intertown"
  | "connectivityRepair"
  | "localSettlement"
  | "initialSettlementBootstrap"
  | "futureGrowthPrecompute";

export type RoadDiagnosticTuning = {
  enableSwitchbackConnectors: boolean;
  enableMountainPassFallbacks: boolean;
  enableWaypointConnectors: boolean;
  enableBridgeFirstRetries: boolean;
  enableIntertownConnections: boolean;
  enableConnectivityRepairPass: boolean;
  enableConnectorCleanup: boolean;
  searchBudgetMultiplier: number;
  gradeToleranceMultiplier: number;
  maxGradeRelaxationPasses: number | null;
  intertownConnectionPasses: number | null;
  intertownEdgeLimit: number | null;
  intertownDetourMultiplier: number | null;
  futureGrowthPlanYearsOverride: number | null;
};

export const DEFAULT_ROAD_DIAGNOSTIC_TUNING: RoadDiagnosticTuning = {
  enableSwitchbackConnectors: true,
  enableMountainPassFallbacks: true,
  enableWaypointConnectors: true,
  enableBridgeFirstRetries: true,
  enableIntertownConnections: true,
  enableConnectivityRepairPass: true,
  enableConnectorCleanup: true,
  searchBudgetMultiplier: 1,
  gradeToleranceMultiplier: 1,
  maxGradeRelaxationPasses: null,
  intertownConnectionPasses: null,
  intertownEdgeLimit: null,
  intertownDetourMultiplier: null,
  futureGrowthPlanYearsOverride: null
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const finiteNumberOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const booleanOrDefault = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const wholeNumberOrNull = (value: unknown, min: number, max: number): number | null => {
  const parsed = finiteNumberOrNull(value);
  if (parsed === null || parsed < 0) {
    return null;
  }
  return Math.round(clamp(parsed, min, max));
};

export const resolveRoadDiagnosticTuning = (
  value?: Partial<RoadDiagnosticTuning> | null
): RoadDiagnosticTuning => ({
  enableSwitchbackConnectors: booleanOrDefault(
    value?.enableSwitchbackConnectors,
    DEFAULT_ROAD_DIAGNOSTIC_TUNING.enableSwitchbackConnectors
  ),
  enableMountainPassFallbacks: booleanOrDefault(
    value?.enableMountainPassFallbacks,
    DEFAULT_ROAD_DIAGNOSTIC_TUNING.enableMountainPassFallbacks
  ),
  enableWaypointConnectors: booleanOrDefault(
    value?.enableWaypointConnectors,
    DEFAULT_ROAD_DIAGNOSTIC_TUNING.enableWaypointConnectors
  ),
  enableBridgeFirstRetries: booleanOrDefault(
    value?.enableBridgeFirstRetries,
    DEFAULT_ROAD_DIAGNOSTIC_TUNING.enableBridgeFirstRetries
  ),
  enableIntertownConnections: booleanOrDefault(
    value?.enableIntertownConnections,
    DEFAULT_ROAD_DIAGNOSTIC_TUNING.enableIntertownConnections
  ),
  enableConnectivityRepairPass: booleanOrDefault(
    value?.enableConnectivityRepairPass,
    DEFAULT_ROAD_DIAGNOSTIC_TUNING.enableConnectivityRepairPass
  ),
  enableConnectorCleanup: booleanOrDefault(
    value?.enableConnectorCleanup,
    DEFAULT_ROAD_DIAGNOSTIC_TUNING.enableConnectorCleanup
  ),
  searchBudgetMultiplier: clamp(
    finiteNumberOrNull(value?.searchBudgetMultiplier) ?? DEFAULT_ROAD_DIAGNOSTIC_TUNING.searchBudgetMultiplier,
    0.1,
    4
  ),
  gradeToleranceMultiplier: clamp(
    finiteNumberOrNull(value?.gradeToleranceMultiplier) ?? DEFAULT_ROAD_DIAGNOSTIC_TUNING.gradeToleranceMultiplier,
    0.25,
    4
  ),
  maxGradeRelaxationPasses: wholeNumberOrNull(value?.maxGradeRelaxationPasses, 1, 64),
  intertownConnectionPasses: wholeNumberOrNull(value?.intertownConnectionPasses, 0, 2),
  intertownEdgeLimit: wholeNumberOrNull(value?.intertownEdgeLimit, 1, 32),
  intertownDetourMultiplier: finiteNumberOrNull(value?.intertownDetourMultiplier) !== null &&
    (finiteNumberOrNull(value?.intertownDetourMultiplier) ?? 0) > 0
      ? clamp(finiteNumberOrNull(value?.intertownDetourMultiplier) ?? 0, 1, 8)
      : null,
  futureGrowthPlanYearsOverride: wholeNumberOrNull(value?.futureGrowthPlanYearsOverride, 0, 20)
});

export const roadDiagnosticTuningToCacheKey = (tuning: RoadDiagnosticTuning): string =>
  [
    Number(tuning.enableSwitchbackConnectors),
    Number(tuning.enableMountainPassFallbacks),
    Number(tuning.enableWaypointConnectors),
    Number(tuning.enableBridgeFirstRetries),
    Number(tuning.enableIntertownConnections),
    Number(tuning.enableConnectivityRepairPass),
    Number(tuning.enableConnectorCleanup),
    tuning.searchBudgetMultiplier.toFixed(2),
    tuning.gradeToleranceMultiplier.toFixed(2),
    tuning.maxGradeRelaxationPasses ?? "default",
    tuning.intertownConnectionPasses ?? "default",
    tuning.intertownEdgeLimit ?? "default",
    tuning.intertownDetourMultiplier?.toFixed(2) ?? "default",
    tuning.futureGrowthPlanYearsOverride ?? "default"
  ].join(":");

export const describeRoadDiagnosticTuning = (tuning: RoadDiagnosticTuning): string => {
  const disabled: string[] = [];
  if (!tuning.enableSwitchbackConnectors) disabled.push("switchbacks off");
  if (!tuning.enableMountainPassFallbacks) disabled.push("mountain-pass off");
  if (!tuning.enableWaypointConnectors) disabled.push("waypoints off");
  if (!tuning.enableBridgeFirstRetries) disabled.push("bridge-first off");
  if (!tuning.enableIntertownConnections) disabled.push("intertown off");
  if (!tuning.enableConnectivityRepairPass) disabled.push("repair off");
  if (!tuning.enableConnectorCleanup) disabled.push("cleanup off");
  const tuned: string[] = [];
  if (Math.abs(tuning.searchBudgetMultiplier - 1) > 1e-6) {
    tuned.push(`budget x${tuning.searchBudgetMultiplier.toFixed(2)}`);
  }
  if (Math.abs(tuning.gradeToleranceMultiplier - 1) > 1e-6) {
    tuned.push(`grade x${tuning.gradeToleranceMultiplier.toFixed(2)}`);
  }
  if (tuning.maxGradeRelaxationPasses !== null) {
    tuned.push(`relax <=${tuning.maxGradeRelaxationPasses}`);
  }
  if (tuning.intertownConnectionPasses !== null) {
    tuned.push(`intertown passes ${tuning.intertownConnectionPasses}`);
  }
  if (tuning.intertownEdgeLimit !== null) {
    tuned.push(`intertown edges <=${tuning.intertownEdgeLimit}`);
  }
  if (tuning.intertownDetourMultiplier !== null) {
    tuned.push(`intertown detour x${tuning.intertownDetourMultiplier.toFixed(2)}`);
  }
  if (tuning.futureGrowthPlanYearsOverride !== null) {
    tuned.push(`future-growth ${tuning.futureGrowthPlanYearsOverride}y`);
  }
  const parts = [...disabled, ...tuned];
  return parts.length > 0 ? parts.join(", ") : "default road behavior";
};
