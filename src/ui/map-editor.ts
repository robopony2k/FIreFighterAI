import { MAP_SIZE_PRESETS, type MapSizeId } from "../core/config.js";
import { RNG } from "../core/rng.js";
import {
  COAST_CLASS_BEACH,
  COAST_CLASS_CLIFF,
  COAST_CLASS_NONE,
  COAST_CLASS_SHELF_WATER,
  createInitialState,
  TILE_ID_TO_TYPE,
  TILE_TYPE_IDS,
  type WorldState
} from "../core/state.js";
import { getTerrainHeightScale } from "../core/terrainScale.js";
import { TREE_TYPE_IDS } from "../core/types.js";
import { syncTileSoA } from "../core/tileCache.js";
import {
  createMapGenSession,
  type MapGenDebug,
  type MapGenDebugPhase,
  type MapGenDebugSnapshot,
  type MapGenSession
} from "../mapgen/index.js";
import {
  cloneTerrainRecipe,
  compileTerrainRecipe,
  createDefaultTerrainRecipe,
  getTerrainHeightScaleMultiplier,
  terrainRecipeEqual,
  type TerrainRecipe
} from "../mapgen/terrainProfile.js";
import {
  createMapScenarioId,
  deleteMapScenario,
  hasLegacyMapScenarios,
  loadMapScenarios,
  upsertMapScenario,
  type MapScenario
} from "../persistence/mapScenarios.js";
import { buildRenderTerrainSample } from "../render/simView.js";
import { buildFastTerrainPreview, type FastTerrainPreviewMode } from "../systems/terrain/sim/fastTerrainPreview.js";
import {
  createTerrainPreviewController,
  type TerrainPreviewHoverTile,
  type TerrainPreviewBridgeSelection,
  type TerrainPreviewController
} from "../render/terrainPreview.js";
import {
  prepareTerrainRenderSurface,
  type TerrainHeightAnomaly,
  type TerrainHeightProvenance,
  type TerrainRenderDebugOptions
} from "../render/threeTestTerrain.js";
import { resetTerrainCaches } from "../render/terrainCache.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_SEED, type NewRunConfig } from "./run-config.js";
import { buildTerrainControls } from "./terrain-controls.js";
import {
  coerceTerrainSeedNumber,
  decodeTerrainSeedCode,
  encodeTerrainSeedCode
} from "./terrainSeedCode.js";
import {
  applyTerrainArchetypeDefaultsToControls,
  applyTerrainRecipeToControls,
  collectTerrainControlElements,
  MAP_EDITOR_TERRAIN_GROUPS,
  readTerrainRecipeFromControls,
  syncTerrainControlOutputs
} from "./terrain-schema.js";

type MapEditorStepId =
  | "scenario"
  | "relief"
  | "carving"
  | "erosion"
  | "flooding"
  | "rivers"
  | "settlements"
  | "vegetation"
  | "final";

type MapEditorRefs = {
  screen: HTMLDivElement;
  previewCanvas: HTMLCanvasElement;
  previewOverlay: HTMLDivElement;
  previewMessage: HTMLDivElement;
  previewProgressBar: HTMLDivElement;
  previewMeta: HTMLDivElement;
  previewResetView: HTMLButtonElement;
  bridgeDebugPanel: HTMLDivElement;
  bridgeDebugMeta: HTMLDivElement;
  bridgeDebugOutput: HTMLPreElement;
  bridgeDebugCopy: HTMLButtonElement;
  coastDebugPanel: HTMLDivElement;
  coastDebugMeta: HTMLDivElement;
  coastDebugOutput: HTMLPreElement;
  coastDebugCopy: HTMLButtonElement;
  scenarioList: HTMLSelectElement;
  scenarioLoad: HTMLButtonElement;
  scenarioEntryStatus: HTMLDivElement;
  scenarioNameInput: HTMLInputElement;
  scenarioStatus: HTMLDivElement;
  scenarioSeedInput: HTMLInputElement;
  scenarioSeedImport: HTMLButtonElement;
  scenarioSeedRandom: HTMLButtonElement;
  scenarioSaveNew: HTMLButtonElement;
  scenarioOverwrite: HTMLButtonElement;
  scenarioDelete: HTMLButtonElement;
  scenarioResetDefaults: HTMLButtonElement;
  finalShareCodeInput: HTMLInputElement;
  copyShareCodeButton: HTMLButtonElement;
  shareCodeStatus: HTMLDivElement;
  advancedToggle: HTMLInputElement;
  erosionCompareToggle: HTMLInputElement;
  legacyNotice: HTMLDivElement;
  backToMenu: HTMLButtonElement;
  mapSizeInputs: HTMLInputElement[];
  stepButtons: HTMLButtonElement[];
  stepPanels: HTMLElement[];
  scenarioControls: HTMLDivElement;
  reliefControls: HTMLDivElement;
  carvingControls: HTMLDivElement;
  erosionControls: HTMLDivElement;
  floodingControls: HTMLDivElement;
  riverControls: HTMLDivElement;
  settlementControls: HTMLDivElement;
  vegetationControls: HTMLDivElement;
};

type MapEditorDeps = {
  onBackToMenu: () => void;
};

type TerrainDraft = {
  name: string;
  seed: number;
  mapSize: MapSizeId;
  terrain: NewRunConfig["options"]["terrain"];
};

export type MapEditorHandle = {
  open: (config: NewRunConfig) => void;
  close: () => void;
  isVisible: () => boolean;
  destroy: () => void;
};

const PREVIEW_DEBOUNCE_MS = 200;

const createUnavailableTerrainPreviewController = (): TerrainPreviewController => ({
  prepareAssets: async () => {},
  start: () => {},
  stop: () => {},
  resize: () => {},
  setTerrain: () => {},
  setBridgeSelectionListener: () => {},
  setHoverTileListener: () => {},
  resetView: () => {},
  dispose: () => {}
});

const formatPreviewUnavailableMessage = (reason: string | null): string =>
  reason
    ? `3D preview unavailable: ${reason}`
    : "3D preview unavailable in this environment.";

const MAP_EDITOR_PHASE_ORDER: MapGenDebugPhase[] = [
  "terrain:fastPreview",
  "terrain:relief",
  "terrain:carving",
  "terrain:flooding",
  "terrain:elevation",
  "terrain:erosion",
  "hydro:solve",
  "terrain:shoreline",
  "hydro:rivers",
  "biome:fields",
  "biome:spread",
  "biome:classify",
  "settlement:place",
  "roads:connect",
  "reconcile:postSettlement",
  "map:finalize"
];
const MAP_EDITOR_PHASE_RANK = new Map<MapGenDebugPhase, number>(
  MAP_EDITOR_PHASE_ORDER.map((phase, index): [MapGenDebugPhase, number] => [phase, index])
);

type StepPreviewConfig = {
  label: string;
  stopAfterPhase: MapGenDebugPhase;
  sampleSource: "snapshot" | "state" | "fast";
  treesEnabled: boolean;
};

type MapEditorRenderDebugState = {
  terrainHeightMode: "final" | "raw";
  terrainSurfaceShadingMode: "refined" | "legacyFaceted";
  riverWaterOff: boolean;
  riverCutoutOff: boolean;
  bridgesOff: boolean;
};

const DEFAULT_MAP_EDITOR_RENDER_DEBUG_STATE: MapEditorRenderDebugState = {
  terrainHeightMode: "final",
  terrainSurfaceShadingMode: "refined",
  riverWaterOff: false,
  riverCutoutOff: false,
  bridgesOff: false
};

const MAP_EDITOR_PREVIEW_BY_STEP: Record<MapEditorStepId, StepPreviewConfig> = {
  scenario: {
    label: "Scenario",
    stopAfterPhase: "terrain:fastPreview",
    sampleSource: "fast",
    treesEnabled: false
  },
  relief: {
    label: "Relief",
    stopAfterPhase: "terrain:fastPreview",
    sampleSource: "fast",
    treesEnabled: false
  },
  carving: {
    label: "Shape",
    stopAfterPhase: "terrain:fastPreview",
    sampleSource: "fast",
    treesEnabled: false
  },
  erosion: {
    label: "Erosion Detail",
    stopAfterPhase: "terrain:erosion",
    sampleSource: "snapshot",
    treesEnabled: false
  },
  flooding: {
    label: "Water",
    stopAfterPhase: "terrain:fastPreview",
    sampleSource: "fast",
    treesEnabled: false
  },
  rivers: {
    label: "River Channels",
    stopAfterPhase: "hydro:rivers",
    sampleSource: "snapshot",
    treesEnabled: false
  },
  settlements: {
    label: "Settlement Network",
    stopAfterPhase: "roads:connect",
    sampleSource: "state",
    treesEnabled: false
  },
  vegetation: {
    label: "Vegetation Layer",
    stopAfterPhase: "reconcile:postSettlement",
    sampleSource: "state",
    treesEnabled: true
  },
  final: {
    label: "Final Terrain",
    stopAfterPhase: "map:finalize",
    sampleSource: "state",
    treesEnabled: true
  }
};

const buildGrid = (mapSize: MapSizeId) => {
  const size = MAP_SIZE_PRESETS[mapSize];
  return {
    cols: size,
    rows: size,
    totalTiles: size * size
  };
};

const buildTreeTypeMap = (state: WorldState): Uint8Array => {
  const result = new Uint8Array(state.grid.totalTiles);
  result.fill(255);
  if (!state.tiles || state.tiles.length === 0) {
    return result;
  }
  for (let i = 0; i < state.tiles.length; i += 1) {
    const tile = state.tiles[i];
    if (!tile) {
      continue;
    }
    const treeType = tile.treeType ?? tile.dominantTreeType;
    result[i] = treeType ? TREE_TYPE_IDS[treeType] : 255;
  }
  return result;
};

const buildSnapshotSample = (
  snapshot: MapGenDebugSnapshot,
  grid: { cols: number; rows: number },
  worldSeed: number,
  heightScaleMultiplier: number,
  treesEnabled = false
) => ({
  cols: grid.cols,
  rows: grid.rows,
  elevations: snapshot.elevations,
  heightScaleMultiplier,
  tileTypes: snapshot.tileTypes,
  riverMask: snapshot.riverMask,
  oceanMask: snapshot.oceanMask,
  seaLevel: snapshot.seaLevel,
  coastDistance: snapshot.coastDistance,
  coastClass: snapshot.coastClass,
  fullResolution: true,
  treesEnabled,
  worldSeed
});

const buildWorldPreviewSample = (
  state: WorldState,
  treesEnabled: boolean,
  heightScaleMultiplier: number
) => {
  syncTileSoA(state);
  return buildRenderTerrainSample(
    state,
    buildTreeTypeMap(state),
    false,
    treesEnabled,
    false,
    true,
    heightScaleMultiplier
  );
};

const getFastPreviewMode = (stepId: MapEditorStepId): FastTerrainPreviewMode | null => {
  switch (stepId) {
    case "scenario":
    case "carving":
      return "shape";
    case "relief":
      return "relief";
    case "flooding":
      return "water";
    default:
      return null;
  }
};

const buildFastPreviewSample = (
  draft: TerrainDraft,
  stepId: MapEditorStepId,
  heightScaleMultiplier: number
) => {
  const mode = getFastPreviewMode(stepId);
  if (!mode) {
    return null;
  }
  const grid = buildGrid(draft.mapSize);
  const { settings } = compileTerrainRecipe(draft.terrain);
  const result = buildFastTerrainPreview({
    seed: draft.seed,
    cols: grid.cols,
    rows: grid.rows,
    settings,
    mode
  });
  return {
    cols: result.cols,
    rows: result.rows,
    elevations: result.elevationMap,
    heightScaleMultiplier,
    tileTypes: result.tileTypes,
    riverMask: result.riverMask,
    oceanMask: result.oceanMask,
    seaLevel: result.seaLevelMap,
    coastDistance: result.coastDistance,
    coastClass: result.coastClass,
    fullResolution: false,
    treesEnabled: false,
    worldSeed: draft.seed,
    fastUpdate: true,
    fastPreviewTimingsMs: result.timingsMs
  };
};

type SnapshotPreviewSample = ReturnType<typeof buildSnapshotSample>;
type WorldPreviewSample = ReturnType<typeof buildWorldPreviewSample>;
type FastPreviewSample = NonNullable<ReturnType<typeof buildFastPreviewSample>>;
type PreviewRenderableSample = SnapshotPreviewSample | WorldPreviewSample | FastPreviewSample;
type DebugPreviewRenderableSample = PreviewRenderableSample & { debugRenderOptions?: TerrainRenderDebugOptions };
type CoastlineProbe = {
  label: string;
  x: number;
  y: number;
  dx: number;
  dy: number;
  angle: number;
};

const MAP_EDITOR_STEP_SEQUENCE: readonly MapEditorStepId[] = [
  "scenario",
  "carving",
  "relief",
  "flooding",
  "rivers",
  "erosion",
  "settlements",
  "vegetation",
  "final"
] as const;
const MAP_EDITOR_EROSION_COMPARE_PREVIEW: StepPreviewConfig = {
  label: "Pre-Erosion Baseline",
  stopAfterPhase: "terrain:elevation",
  sampleSource: "snapshot",
  treesEnabled: false
};
const COASTLINE_DEBUG_PROBE_COUNT = 4;
const COASTLINE_DEBUG_TRANSECT_OFFSETS = [-1, 0, 1, 2] as const;
const CARDINAL_DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 }
] as const;

const buildTerrainRenderDebugOptions = (
  state: MapEditorRenderDebugState,
  logHeightAnomalies = true
): TerrainRenderDebugOptions => ({
  enableHeightProvenance: true,
  logHeightAnomalies,
  anomalyLogLimit: 6,
  terrainHeightMode: state.terrainHeightMode,
  terrainSurfaceShadingMode: state.terrainSurfaceShadingMode,
  disableRiverWater: state.riverWaterOff,
  disableRiverCutout: state.riverCutoutOff,
  disableBridges: state.bridgesOff
});

const applyTerrainRenderDebugOptions = (
  sample: PreviewRenderableSample,
  state: MapEditorRenderDebugState,
  logHeightAnomalies = true
): DebugPreviewRenderableSample => ({
  ...sample,
  debugRenderOptions: buildTerrainRenderDebugOptions(state, logHeightAnomalies)
});

const inSampleBounds = (sample: PreviewRenderableSample, x: number, y: number): boolean =>
  x >= 0 && y >= 0 && x < sample.cols && y < sample.rows;

const sampleIndexFor = (sample: PreviewRenderableSample, x: number, y: number): number => y * sample.cols + x;

const angularDistance = (left: number, right: number): number => {
  const raw = Math.abs(left - right) % (Math.PI * 2);
  return raw > Math.PI ? Math.PI * 2 - raw : raw;
};

const getCompassLabel = (angle: number): string => {
  const directions = ["E", "SE", "S", "SW", "W", "NW", "N", "NE"];
  const normalized = (angle + Math.PI * 2) % (Math.PI * 2);
  const bucket = Math.round(normalized / (Math.PI / 4)) % directions.length;
  return directions[bucket] ?? "coast";
};

const formatCoastClassLabel = (coastClass: number | undefined): string => {
  switch (coastClass ?? COAST_CLASS_NONE) {
    case COAST_CLASS_BEACH:
      return "beach";
    case COAST_CLASS_CLIFF:
      return "cliff";
    case COAST_CLASS_SHELF_WATER:
      return "shelf";
    case COAST_CLASS_NONE:
    default:
      return "-";
  }
};

const formatTileTypeLabel = (typeId: number | undefined): string =>
  typeId === undefined ? "n/a" : TILE_ID_TO_TYPE[typeId] ?? `id${typeId}`;

const findCoastlineProbeReferenceSample = (
  samples: Partial<Record<MapEditorStepId, PreviewRenderableSample>>
): { stepId: MapEditorStepId; sample: PreviewRenderableSample } | null => {
  const preferredSteps: readonly MapEditorStepId[] = ["flooding", "rivers", "settlements", "vegetation", "final"];
  for (let i = 0; i < preferredSteps.length; i += 1) {
    const stepId = preferredSteps[i]!;
    const sample = samples[stepId];
    if (sample?.tileTypes && sample.tileTypes.length === sample.cols * sample.rows) {
      return { stepId, sample };
    }
  }
  for (let i = 0; i < MAP_EDITOR_STEP_SEQUENCE.length; i += 1) {
    const stepId = MAP_EDITOR_STEP_SEQUENCE[i]!;
    const sample = samples[stepId];
    if (sample?.tileTypes && sample.tileTypes.length === sample.cols * sample.rows) {
      return { stepId, sample };
    }
  }
  return null;
};

const collectCoastlineProbes = (sample: PreviewRenderableSample, desiredCount = COASTLINE_DEBUG_PROBE_COUNT): CoastlineProbe[] => {
  if (!sample.tileTypes || sample.tileTypes.length !== sample.cols * sample.rows) {
    return [];
  }
  const centerX = (sample.cols - 1) * 0.5;
  const centerY = (sample.rows - 1) * 0.5;
  const minDim = Math.min(sample.cols, sample.rows);
  const maxEdgeDist = Math.max(10, Math.floor(minDim * 0.32));
  const minProbeSpacing = Math.max(12, Math.floor(minDim * 0.16));
  const oceanMask = sample.oceanMask;
  const riverMask = sample.riverMask;
  let hasOceanMask = false;
  if (oceanMask) {
    for (let i = 0; i < oceanMask.length; i += 1) {
      if ((oceanMask[i] ?? 0) > 0) {
        hasOceanMask = true;
        break;
      }
    }
  }

  const candidates: Array<CoastlineProbe & { edgeDist: number; score: number }> = [];
  for (let y = 1; y < sample.rows - 1; y += 1) {
    for (let x = 1; x < sample.cols - 1; x += 1) {
      const idx = sampleIndexFor(sample, x, y);
      const typeId = sample.tileTypes[idx];
      if (typeId === TILE_TYPE_IDS.water || (riverMask?.[idx] ?? 0) > 0) {
        continue;
      }
      const edgeDist = Math.min(x, y, sample.cols - 1 - x, sample.rows - 1 - y);
      if (edgeDist > maxEdgeDist) {
        continue;
      }

      let bestDir: { dx: number; dy: number } | null = null;
      let bestNeighborEdgeDist = Number.POSITIVE_INFINITY;
      let bestNeighborOcean = 0;
      for (let dirIndex = 0; dirIndex < CARDINAL_DIRS.length; dirIndex += 1) {
        const dir = CARDINAL_DIRS[dirIndex]!;
        const nx = x + dir.dx;
        const ny = y + dir.dy;
        const nIdx = sampleIndexFor(sample, nx, ny);
        const neighborTypeId = sample.tileTypes[nIdx];
        const neighborOcean = oceanMask?.[nIdx] ?? 0;
        const neighborRiver = riverMask?.[nIdx] ?? 0;
        const neighborIsWater = neighborTypeId === TILE_TYPE_IDS.water;
        const neighborIsOcean = neighborOcean > 0;
        if (hasOceanMask) {
          if (!neighborIsOcean) {
            continue;
          }
        } else if (!neighborIsWater || neighborRiver > 0) {
          continue;
        }
        const neighborEdgeDist = Math.min(nx, ny, sample.cols - 1 - nx, sample.rows - 1 - ny);
        if (
          !bestDir ||
          neighborOcean > bestNeighborOcean ||
          (neighborOcean === bestNeighborOcean && neighborEdgeDist < bestNeighborEdgeDist)
        ) {
          bestDir = dir;
          bestNeighborEdgeDist = neighborEdgeDist;
          bestNeighborOcean = neighborOcean;
        }
      }

      if (!bestDir) {
        continue;
      }

      const angle = Math.atan2(y - centerY, x - centerX);
      const coastScore = (bestNeighborOcean > 0 ? 3 : 0) + (maxEdgeDist - edgeDist) / Math.max(1, maxEdgeDist);
      candidates.push({
        label: getCompassLabel(angle),
        x,
        y,
        dx: bestDir.dx,
        dy: bestDir.dy,
        angle,
        edgeDist,
        score: coastScore
      });
    }
  }

  if (candidates.length === 0) {
    return [];
  }

  const targets = Array.from({ length: desiredCount }, (_, index) => (index / desiredCount) * Math.PI * 2);
  const selected: CoastlineProbe[] = [];
  const used = new Set<number>();

  targets.forEach((targetAngle) => {
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;
    for (let i = 0; i < candidates.length; i += 1) {
      if (used.has(i)) {
        continue;
      }
      const candidate = candidates[i]!;
      if (selected.some((probe) => Math.hypot(probe.x - candidate.x, probe.y - candidate.y) < minProbeSpacing)) {
        continue;
      }
      const score =
        angularDistance((candidate.angle + Math.PI * 2) % (Math.PI * 2), targetAngle)
        + candidate.edgeDist / Math.max(1, maxEdgeDist) * 0.35
        - candidate.score * 0.08;
      if (score < bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex >= 0) {
      used.add(bestIndex);
      selected.push(candidates[bestIndex]!);
    }
  });

  const rankedFallback = [...candidates].sort((left, right) => {
    if (left.edgeDist !== right.edgeDist) {
      return left.edgeDist - right.edgeDist;
    }
    return right.score - left.score;
  });
  for (let i = 0; i < rankedFallback.length && selected.length < desiredCount; i += 1) {
    const candidate = rankedFallback[i]!;
    if (selected.some((probe) => Math.hypot(probe.x - candidate.x, probe.y - candidate.y) < minProbeSpacing)) {
      continue;
    }
    selected.push(candidate);
  }

  return selected.map((probe, index) => ({
    ...probe,
    label: `${probe.label}${index + 1}`
  }));
};

const formatCoastlineProbePoint = (
  sample: PreviewRenderableSample,
  probe: CoastlineProbe,
  offset: number
): string => {
  const x = probe.x + probe.dx * offset;
  const y = probe.y + probe.dy * offset;
  if (!inSampleBounds(sample, x, y)) {
    return `${offset >= 0 ? "+" : ""}${offset}@oob`;
  }
  const idx = sampleIndexFor(sample, x, y);
  const elevation = sample.elevations[idx] ?? 0;
  const seaLevel = sample.seaLevel?.[idx];
  const heightScale = getTerrainHeightScale(sample.cols, sample.rows, sample.heightScaleMultiplier ?? 1);
  const deltaSea = Number.isFinite(seaLevel) ? elevation - (seaLevel ?? 0) : Number.NaN;
  return [
    `${offset >= 0 ? "+" : ""}${offset}@${x},${y}`,
    formatTileTypeLabel(sample.tileTypes?.[idx]),
    `e=${elevation.toFixed(4)}`,
    `y=${(elevation * heightScale).toFixed(2)}`,
    `ds=${Number.isFinite(deltaSea) ? `${deltaSea >= 0 ? "+" : ""}${deltaSea.toFixed(4)}` : "n/a"}`,
    `oc=${sample.oceanMask?.[idx] ?? 0}`,
    `rv=${sample.riverMask?.[idx] ?? 0}`,
    `cc=${formatCoastClassLabel(sample.coastClass?.[idx])}`,
    `cd=${sample.coastDistance?.[idx] ?? 0}`
  ].join(" ");
};

const formatVertexContributors = (provenance: TerrainHeightProvenance): string =>
  provenance.vertices
    .map((vertex) => {
      const contributorCoords = vertex.contributors.map((contributor) => `${contributor.x},${contributor.y}`).join(" ");
      return [
        `${vertex.label}@${vertex.sampleX},${vertex.sampleY}`,
        `raw=${vertex.rawHeight.toFixed(4)}`,
        `final=${vertex.finalHeight.toFixed(4)}`,
        `shown=${vertex.displayedHeight.toFixed(4)}`,
        `type=${formatTileTypeLabel(vertex.sampleTypeId ?? undefined)}`,
        `wr=${vertex.waterRatio.toFixed(2)}`,
        `or=${vertex.oceanRatio.toFixed(2)}`,
        `rr=${vertex.riverRatio.toFixed(2)}`,
        `ws=${vertex.waterSupport}`,
        `cc=${formatCoastClassLabel(vertex.coastClass)}`,
        `cd=${vertex.coastDistance}`,
        `waterCells=${vertex.contributorWaterCount}`,
        `contribMax=${vertex.maxContributorElevation.toFixed(4)}`,
        `cells=${contributorCoords || "n/a"}`
      ].join(" ");
    })
    .join("\n");

const formatNeighborhoodCells = (provenance: TerrainHeightProvenance): string =>
  provenance.neighborhood
    .map((cell) =>
      [
        `${cell.x},${cell.y}`,
        formatTileTypeLabel(cell.typeId ?? undefined),
        `e=${cell.elevation.toFixed(4)}`,
        `rv=${cell.riverMask}`,
        `oc=${cell.oceanMask}`
      ].join(" ")
    )
    .join(" | ");

const formatHeightAnomaly = (anomaly: TerrainHeightAnomaly): string =>
  [
    `${anomaly.stage}`,
    `tile=${anomaly.tileX},${anomaly.tileY}`,
    `sample=${anomaly.sampleX},${anomaly.sampleY}`,
    `delta=${anomaly.delta.toFixed(4)}`,
    `value=${anomaly.value.toFixed(4)}`,
    `base=${anomaly.baseline.toFixed(4)}`,
    `type=${formatTileTypeLabel(anomaly.sampleTypeId ?? undefined)}`,
    `ws=${anomaly.waterSupport}`,
    `rr=${anomaly.riverRatio.toFixed(2)}`,
    `or=${anomaly.oceanRatio.toFixed(2)}`
  ].join(" ");

const buildHeightProvenanceReport = (
  sample: PreviewRenderableSample | null,
  activeStep: MapEditorStepId,
  hoveredTile: TerrainPreviewHoverTile | null,
  renderDebugState: MapEditorRenderDebugState
): { meta: string; text: string } => {
  const modeLabel =
    renderDebugState.terrainHeightMode === "raw" ? "terrain_raw_vertices" : "terrain_final_vertices";
  const toggleLine = [
    `renderMode=${modeLabel}`,
    `terrain_surface_shading=${renderDebugState.terrainSurfaceShadingMode}`,
    `river_water_off=${renderDebugState.riverWaterOff ? 1 : 0}`,
    `river_cutout_off=${renderDebugState.riverCutoutOff ? 1 : 0}`,
    `bridges_off=${renderDebugState.bridgesOff ? 1 : 0}`
  ].join(" ");
  if (!sample) {
    return {
      meta: "Height provenance unavailable until the active preview step is cached.",
      text: ["heightProvenance=unavailable", toggleLine].join("\n")
    };
  }
  if (!hoveredTile) {
    return {
      meta: "Hover a tile in the 3D preview to capture height provenance.",
      text: ["heightProvenance=hover tile required", toggleLine, `activeStep=${activeStep}`].join("\n")
    };
  }
  const debugSurface = prepareTerrainRenderSurface(applyTerrainRenderDebugOptions(sample, renderDebugState, false));
  const provenance = debugSurface.getHeightProvenance?.(hoveredTile.tileX, hoveredTile.tileY) ?? null;
  if (!provenance) {
    return {
      meta: `No provenance data available for ${hoveredTile.tileX},${hoveredTile.tileY}.`,
      text: ["heightProvenance=missing", toggleLine, `hover=${hoveredTile.tileX},${hoveredTile.tileY}`].join("\n")
    };
  }
  const anomalies = debugSurface.debugHeightAnomalies ?? [];
  const lines = [
    `heightProvenance=${provenance.tileX},${provenance.tileY}`,
    toggleLine,
    `authoritative=${provenance.authoritativeElevation.toFixed(4)} rawCenter=${provenance.rawCenterHeight.toFixed(4)} finalCenter=${provenance.finalCenterHeight.toFixed(4)} shownCenter=${provenance.displayedCenterHeight.toFixed(4)}`,
    `tileFlags rv=${provenance.riverMask} oc=${provenance.oceanMask} sea=${Number.isFinite(provenance.seaLevel) ? provenance.seaLevel!.toFixed(4) : "n/a"}`,
    `interp sx=${provenance.interpolation.sampleCoordX.toFixed(3)} sy=${provenance.interpolation.sampleCoordY.toFixed(3)} tx=${provenance.interpolation.tx.toFixed(3)} ty=${provenance.interpolation.ty.toFixed(3)} raw=${provenance.interpolation.rawHeight.toFixed(4)} final=${provenance.interpolation.finalHeight.toFixed(4)} shown=${provenance.interpolation.displayedHeight.toFixed(4)}`,
    `neighborhood ${formatNeighborhoodCells(provenance)}`,
    formatVertexContributors(provenance),
    anomalies.length > 0
      ? `anomalies ${anomalies.map((anomaly) => formatHeightAnomaly(anomaly)).join(" | ")}`
      : "anomalies none"
  ];
  return {
    meta: `Height provenance for hovered tile ${provenance.tileX},${provenance.tileY} on ${MAP_EDITOR_PREVIEW_BY_STEP[activeStep].label}.`,
    text: lines.join("\n")
  };
};

const buildCoastlineDebugReport = (
  samples: Partial<Record<MapEditorStepId, PreviewRenderableSample>>,
  activeStep: MapEditorStepId,
  shareCode: string
): { meta: string; text: string; copyEnabled: boolean } => {
  const cachedSteps = MAP_EDITOR_STEP_SEQUENCE.filter((stepId) => Boolean(samples[stepId]));
  const reference = findCoastlineProbeReferenceSample(samples);
  if (!reference) {
    return {
      meta: "Coastline probes will appear after a coastline-bearing preview step is cached.",
      text: "No coastline probes available yet.",
      copyEnabled: false
    };
  }

  const probes = collectCoastlineProbes(reference.sample);
  if (probes.length === 0) {
    return {
      meta: `No outer coastline probes found in ${MAP_EDITOR_PREVIEW_BY_STEP[reference.stepId].label}.`,
      text: [
        `shareCode=${shareCode || "n/a"}`,
        `activeStep=${activeStep}`,
        `probeSource=${reference.stepId}`,
        `cachedSteps=${cachedSteps.join(",") || "none"}`,
        "note=No coastline probes matched the outer ocean edge filter."
      ].join("\n"),
      copyEnabled: false
    };
  }

  const lines = [
    `shareCode=${shareCode || "n/a"}`,
    `activeStep=${activeStep} (${MAP_EDITOR_PREVIEW_BY_STEP[activeStep].label})`,
    `probeSource=${reference.stepId} (${MAP_EDITOR_PREVIEW_BY_STEP[reference.stepId].label})`,
    `cachedSteps=${cachedSteps.join(",")}`,
    "note=Offsets -1/0/+1/+2 follow the outward coast normal toward open water."
  ];

  probes.forEach((probe) => {
    lines.push("");
    lines.push(`probe=${probe.label} coast=${probe.x},${probe.y} dir=${probe.dx},${probe.dy}`);
    cachedSteps.forEach((stepId) => {
      const sample = samples[stepId];
      if (!sample) {
        return;
      }
      lines.push(
        `${stepId.padEnd(10)} ${COASTLINE_DEBUG_TRANSECT_OFFSETS.map((offset) => formatCoastlineProbePoint(sample, probe, offset)).join(" | ")}`
      );
    });
  });

  return {
    meta: `${probes.length} coastline probe${probes.length === 1 ? "" : "s"} sampled from ${MAP_EDITOR_PREVIEW_BY_STEP[reference.stepId].label} and compared across ${cachedSteps.length} cached step${cachedSteps.length === 1 ? "" : "s"}.`,
    text: lines.join("\n"),
    copyEnabled: true
  };
};

const cloneFloat32Array = (values: Float32Array | undefined): Float32Array | undefined =>
  values ? Float32Array.from(values) : undefined;

const cloneUint8Array = (values: Uint8Array | undefined): Uint8Array | undefined =>
  values ? Uint8Array.from(values) : undefined;

const clonePreviewSample = (sample: PreviewRenderableSample): PreviewRenderableSample => {
  if ("treeTypes" in sample || "tileFire" in sample || "roadEdges" in sample || "towns" in sample) {
    const worldSample = sample as WorldPreviewSample;
    return {
      ...worldSample,
      elevations: Float32Array.from(worldSample.elevations),
      tileTypes: cloneUint8Array(worldSample.tileTypes),
      treeTypes: cloneUint8Array(worldSample.treeTypes),
      tileFire: cloneFloat32Array(worldSample.tileFire),
      tileHeat: cloneFloat32Array(worldSample.tileHeat),
      tileFuel: cloneFloat32Array(worldSample.tileFuel),
      tileMoisture: cloneFloat32Array(worldSample.tileMoisture),
      tileVegetationAge: cloneFloat32Array(worldSample.tileVegetationAge),
      tileCanopyCover: cloneFloat32Array(worldSample.tileCanopyCover),
      tileStemDensity: cloneUint8Array(worldSample.tileStemDensity),
      riverMask: cloneUint8Array(worldSample.riverMask),
      oceanMask: cloneUint8Array(worldSample.oceanMask),
      seaLevel: cloneFloat32Array(worldSample.seaLevel),
      coastDistance: worldSample.coastDistance ? Uint16Array.from(worldSample.coastDistance) : undefined,
      coastClass: cloneUint8Array(worldSample.coastClass),
      roadBridgeMask: cloneUint8Array(worldSample.roadBridgeMask),
      roadEdges: cloneUint8Array(worldSample.roadEdges),
      roadWallEdges: cloneUint8Array(worldSample.roadWallEdges),
      riverBed: cloneFloat32Array(worldSample.riverBed),
      riverSurface: cloneFloat32Array(worldSample.riverSurface),
      riverStepStrength: cloneFloat32Array(worldSample.riverStepStrength),
      towns: worldSample.towns?.map((town) => ({ ...town }))
    };
  }
  const snapshotSample = sample as SnapshotPreviewSample;
  return {
    ...snapshotSample,
    elevations: Float32Array.from(snapshotSample.elevations),
    tileTypes: cloneUint8Array(snapshotSample.tileTypes),
    riverMask: cloneUint8Array(snapshotSample.riverMask),
    oceanMask: cloneUint8Array(snapshotSample.oceanMask),
    seaLevel: cloneFloat32Array(snapshotSample.seaLevel),
    coastDistance: snapshotSample.coastDistance ? Uint16Array.from(snapshotSample.coastDistance) : undefined,
    coastClass: cloneUint8Array(snapshotSample.coastClass)
  };
};

const getPhaseRank = (phase: MapGenDebugPhase): number => MAP_EDITOR_PHASE_RANK.get(phase) ?? Number.MAX_SAFE_INTEGER;

const compareScenarioName = (a: string, b: string): boolean =>
  a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;

const setElementHidden = (element: HTMLElement, hidden: boolean): void => {
  element.classList.toggle("hidden", hidden);
};

export const getMapEditorRefs = (): MapEditorRefs => ({
  screen: document.getElementById("mapEditorScreen") as HTMLDivElement,
  previewCanvas: document.getElementById("mapEditorPreviewCanvas") as HTMLCanvasElement,
  previewOverlay: document.getElementById("mapEditorPreviewOverlay") as HTMLDivElement,
  previewMessage: document.getElementById("mapEditorPreviewMessage") as HTMLDivElement,
  previewProgressBar: document.getElementById("mapEditorPreviewProgressBar") as HTMLDivElement,
  previewMeta: document.getElementById("mapEditorPreviewMeta") as HTMLDivElement,
  previewResetView: document.getElementById("mapEditorResetView") as HTMLButtonElement,
  bridgeDebugPanel: document.getElementById("mapEditorBridgeDebugPanel") as HTMLDivElement,
  bridgeDebugMeta: document.getElementById("mapEditorBridgeDebugMeta") as HTMLDivElement,
  bridgeDebugOutput: document.getElementById("mapEditorBridgeDebugOutput") as HTMLPreElement,
  bridgeDebugCopy: document.getElementById("mapEditorBridgeDebugCopy") as HTMLButtonElement,
  coastDebugPanel: document.getElementById("mapEditorCoastDebugPanel") as HTMLDivElement,
  coastDebugMeta: document.getElementById("mapEditorCoastDebugMeta") as HTMLDivElement,
  coastDebugOutput: document.getElementById("mapEditorCoastDebugOutput") as HTMLPreElement,
  coastDebugCopy: document.getElementById("mapEditorCoastDebugCopy") as HTMLButtonElement,
  scenarioList: document.getElementById("mapEditorScenarioList") as HTMLSelectElement,
  scenarioLoad: document.getElementById("mapEditorScenarioLoad") as HTMLButtonElement,
  scenarioEntryStatus: document.getElementById("mapEditorScenarioEntryStatus") as HTMLDivElement,
  scenarioNameInput: document.getElementById("mapEditorScenarioName") as HTMLInputElement,
  scenarioStatus: document.getElementById("mapEditorScenarioStatus") as HTMLDivElement,
  scenarioSeedInput: document.getElementById("mapEditorSeedInput") as HTMLInputElement,
  scenarioSeedImport: document.getElementById("mapEditorSeedImport") as HTMLButtonElement,
  scenarioSeedRandom: document.getElementById("mapEditorSeedRandom") as HTMLButtonElement,
  scenarioSaveNew: document.getElementById("mapEditorSaveNew") as HTMLButtonElement,
  scenarioOverwrite: document.getElementById("mapEditorOverwrite") as HTMLButtonElement,
  scenarioDelete: document.getElementById("mapEditorDelete") as HTMLButtonElement,
  scenarioResetDefaults: document.getElementById("mapEditorResetDefaults") as HTMLButtonElement,
  finalShareCodeInput: document.getElementById("mapEditorFinalShareCode") as HTMLInputElement,
  copyShareCodeButton: document.getElementById("mapEditorCopyShareCode") as HTMLButtonElement,
  shareCodeStatus: document.getElementById("mapEditorShareCodeStatus") as HTMLDivElement,
  advancedToggle: document.getElementById("mapEditorAdvancedToggle") as HTMLInputElement,
  erosionCompareToggle: document.getElementById("mapEditorErosionCompareToggle") as HTMLInputElement,
  legacyNotice: document.getElementById("mapEditorLegacyNotice") as HTMLDivElement,
  backToMenu: document.getElementById("mapEditorBackToMenu") as HTMLButtonElement,
  mapSizeInputs: Array.from(document.querySelectorAll<HTMLInputElement>('#mapEditorScreen input[name="mapEditorMapSize"]')),
  stepButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("#mapEditorScreen .map-editor-step")),
  stepPanels: Array.from(document.querySelectorAll<HTMLElement>("#mapEditorScreen .map-editor-step-panel")),
  scenarioControls: document.getElementById("mapEditorScenarioControls") as HTMLDivElement,
  reliefControls: document.getElementById("mapEditorReliefControls") as HTMLDivElement,
  carvingControls: document.getElementById("mapEditorCarvingControls") as HTMLDivElement,
  erosionControls: document.getElementById("mapEditorErosionControls") as HTMLDivElement,
  floodingControls: document.getElementById("mapEditorFloodingControls") as HTMLDivElement,
  riverControls: document.getElementById("mapEditorRiverControls") as HTMLDivElement,
  settlementControls: document.getElementById("mapEditorSettlementControls") as HTMLDivElement,
  vegetationControls: document.getElementById("mapEditorVegetationControls") as HTMLDivElement,
});

export const initMapEditor = (refs: MapEditorRefs, deps: MapEditorDeps): MapEditorHandle => {
  buildTerrainControls({
    container: refs.scenarioControls,
    idPrefix: "mapEditorScenario",
    groups: MAP_EDITOR_TERRAIN_GROUPS.scenario
  });
  buildTerrainControls({
    container: refs.reliefControls,
    idPrefix: "mapEditorRelief",
    groups: MAP_EDITOR_TERRAIN_GROUPS.relief
  });
  buildTerrainControls({
    container: refs.carvingControls,
    idPrefix: "mapEditorCarving",
    groups: MAP_EDITOR_TERRAIN_GROUPS.carving
  });
  buildTerrainControls({
    container: refs.erosionControls,
    idPrefix: "mapEditorErosion",
    groups: MAP_EDITOR_TERRAIN_GROUPS.erosion
  });
  buildTerrainControls({
    container: refs.floodingControls,
    idPrefix: "mapEditorFlooding",
    groups: MAP_EDITOR_TERRAIN_GROUPS.flooding
  });
  buildTerrainControls({
    container: refs.riverControls,
    idPrefix: "mapEditorRivers",
    groups: MAP_EDITOR_TERRAIN_GROUPS.rivers
  });
  buildTerrainControls({
    container: refs.settlementControls,
    idPrefix: "mapEditorSettlements",
    groups: MAP_EDITOR_TERRAIN_GROUPS.settlements
  });
  buildTerrainControls({
    container: refs.vegetationControls,
    idPrefix: "mapEditorVegetation",
    groups: MAP_EDITOR_TERRAIN_GROUPS.vegetation
  });
  let previewUnavailableReason: string | null = null;
  let preview: TerrainPreviewController;
  try {
    preview = createTerrainPreviewController(refs.previewCanvas);
  } catch (error) {
    previewUnavailableReason = error instanceof Error ? error.message : "Failed to start the 3D terrain preview.";
    preview = createUnavailableTerrainPreviewController();
  }
  const renderDebugControlsRoot = document.createElement("fieldset");
  renderDebugControlsRoot.className = "map-editor-debug-toggles";
  const renderDebugLegend = document.createElement("legend");
  renderDebugLegend.textContent = "Render Isolation";
  renderDebugControlsRoot.appendChild(renderDebugLegend);

  const createRenderDebugRadio = (
    value: "final" | "raw",
    labelText: string,
    checked: boolean
  ): HTMLInputElement => {
    const label = document.createElement("label");
    label.style.display = "inline-flex";
    label.style.alignItems = "center";
    label.style.gap = "0.35rem";
    label.style.marginRight = "0.75rem";
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "mapEditorRenderHeightMode";
    input.value = value;
    input.checked = checked;
    label.append(input, document.createTextNode(labelText));
    renderDebugControlsRoot.appendChild(label);
    return input;
  };

  const createRenderDebugCheckbox = (labelText: string): HTMLInputElement => {
    const label = document.createElement("label");
    label.style.display = "inline-flex";
    label.style.alignItems = "center";
    label.style.gap = "0.35rem";
    label.style.marginRight = "0.75rem";
    const input = document.createElement("input");
    input.type = "checkbox";
    label.append(input, document.createTextNode(labelText));
    renderDebugControlsRoot.appendChild(label);
    return input;
  };

  const terrainFinalVerticesToggle = createRenderDebugRadio("final", "terrain_final_vertices", true);
  const terrainRawVerticesToggle = createRenderDebugRadio("raw", "terrain_raw_vertices", false);
  const legacyFacetedShadingToggle = createRenderDebugCheckbox("terrain_legacy_faceted");
  const riverWaterOffToggle = createRenderDebugCheckbox("river_water_off");
  const riverCutoutOffToggle = createRenderDebugCheckbox("river_cutout_off");
  const bridgesOffToggle = createRenderDebugCheckbox("bridges_off");
  refs.coastDebugOutput.parentElement?.insertBefore(renderDebugControlsRoot, refs.coastDebugOutput);
  const terrainControlElements = collectTerrainControlElements(refs.screen);
  refs.legacyNotice.textContent = "Older saved map scenarios used the legacy slider model and are not loaded in this editor.";
  refs.legacyNotice.classList.toggle("hidden", !hasLegacyMapScenarios());

  let visible = false;
  let activeStep: MapEditorStepId = "scenario";
  let selectedScenarioId: string | null = null;
  let scenarios: MapScenario[] = [];
  let previewPipelineSession: MapGenSession | null = null;
  let previewPipelineSessionCacheKey: string | null = null;
  let previewPending = false;
  let previewRunning = false;
  let previewRecenterPending = false;
  let previewDebounceHandle = 0;
  let previewSessionToken = 0;
  let previewBuildToken = 0;
  let previewCacheKey: string | null = null;
  let previewCachedSamples: Partial<Record<MapEditorStepId, PreviewRenderableSample>> = {};
  let previewErosionBaselineSample: PreviewRenderableSample | null = null;
  let assetsReadyForSession = false;
  let advancedMode = false;
  let previewHoveredTile: TerrainPreviewHoverTile | null = null;
  let previewRenderDebugState: MapEditorRenderDebugState = { ...DEFAULT_MAP_EDITOR_RENDER_DEBUG_STATE };

  const isPreviewAvailable = (): boolean => previewUnavailableReason === null;
  refs.previewResetView.disabled = !isPreviewAvailable();

  const isErosionCompareEnabled = (): boolean => activeStep === "erosion" && refs.erosionCompareToggle.checked;

  const getActivePreviewConfig = (): StepPreviewConfig =>
    isErosionCompareEnabled() ? MAP_EDITOR_EROSION_COMPARE_PREVIEW : MAP_EDITOR_PREVIEW_BY_STEP[activeStep];

  const syncAdvancedVisibility = (): void => {
    advancedMode = refs.advancedToggle.checked;
    refs.screen.querySelectorAll<HTMLElement>("[data-terrain-advanced='true']").forEach((element) => {
      element.classList.toggle("hidden", !advancedMode);
    });
  };

  const syncErosionCompareToggleAvailability = (): void => {
    refs.erosionCompareToggle.disabled = activeStep !== "erosion";
  };

  const setActiveStep = (stepId: MapEditorStepId): void => {
    activeStep = stepId;
    refs.stepButtons.forEach((button) => {
      const active = button.dataset.step === stepId;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    refs.stepPanels.forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.stepPanel === stepId);
    });
    syncErosionCompareToggleAvailability();
    syncCurrentScenarioLabel();
    updateCoastlineDebugPanel();
    const draft = collectDraft();
    const cacheKey = syncPreviewCacheDraft(draft);
    void cacheKey;
    if (getFastPreviewMode(stepId) !== null && renderFastPreviewForDraft(draft, stepId, previewRecenterPending)) {
      previewRecenterPending = false;
      return;
    }
    if (tryRenderCachedActiveStep()) {
      return;
    }
    if (previewRunning) {
      requestPreviewBuild(false, true);
      return;
    }
    requestPreviewBuild(false, true);
  };

  const getSelectedMapSize = (): MapSizeId => {
    const selected = refs.mapSizeInputs.find((input) => input.checked);
    return (selected?.value as MapSizeId) ?? DEFAULT_MAP_SIZE;
  };

  const setSelectedMapSize = (mapSize: MapSizeId): void => {
    let matched = false;
    refs.mapSizeInputs.forEach((input) => {
      const isMatch = input.value === mapSize;
      input.checked = isMatch;
      matched = matched || isMatch;
    });
    if (!matched && refs.mapSizeInputs[0]) {
      refs.mapSizeInputs[0].checked = true;
    }
  };

  const getTerrainRecipe = (): TerrainRecipe =>
    cloneTerrainRecipe({
      ...readTerrainRecipeFromControls(terrainControlElements, createDefaultTerrainRecipe(getSelectedMapSize())),
      mapSize: getSelectedMapSize()
    });

  const applyTerrainRecipe = (terrain: TerrainRecipe): void => {
    applyTerrainRecipeToControls(
      cloneTerrainRecipe({
        ...terrain,
        mapSize: terrain.mapSize ?? getSelectedMapSize()
      }),
      terrainControlElements
    );
  };

  const readSeedNumber = (): number =>
    decodeTerrainSeedCode(refs.scenarioSeedInput.value)?.seed
    ?? coerceTerrainSeedNumber(refs.scenarioSeedInput.value, DEFAULT_RUN_SEED);

  const syncShareCodeOutput = (shareCode: string): void => {
    refs.scenarioSeedInput.value = shareCode;
    refs.finalShareCodeInput.value = shareCode;
    updateCoastlineDebugPanel();
  };

  const syncSeedField = (seedNumber = readSeedNumber()): void => {
    const shareCode = encodeTerrainSeedCode({
      seed: seedNumber,
      mapSize: getSelectedMapSize(),
      terrain: getTerrainRecipe(),
      name: refs.scenarioNameInput.value.trim().slice(0, 40)
    });
    syncShareCodeOutput(shareCode);
  };

  const applySeedFieldIfEncoded = (): boolean => {
    const decoded = decodeTerrainSeedCode(refs.scenarioSeedInput.value);
    if (!decoded) {
      return false;
    }
    setSelectedMapSize(decoded.mapSize);
    applyTerrainRecipe(decoded.terrain);
    refs.scenarioNameInput.value = decoded.name ?? "";
    syncShareCodeOutput(encodeTerrainSeedCode({
      ...decoded,
      name: decoded.name ?? ""
    }));
    updateScenarioButtons();
    return true;
  };

  const setScenarioEntryStatus = (message: string): void => {
    refs.scenarioEntryStatus.textContent = message;
  };

  const setShareCodeStatus = (message: string): void => {
    refs.shareCodeStatus.textContent = message;
  };

  const syncScenarioLoadButton = (): void => {
    refs.scenarioLoad.disabled = refs.scenarioList.value.length === 0;
  };

  const pickRandom = <T,>(rng: RNG, values: readonly T[]): T =>
    values[Math.min(values.length - 1, Math.floor(rng.next() * values.length))] ?? values[0]!;

  const jitterValue = (rng: RNG, base: number, radius: number): number =>
    clamp(base + (rng.next() * 2 - 1) * radius, 0, 1);

  const buildRandomTerrainRecipe = (mapSize: MapSizeId, seed: number): TerrainRecipe => {
    const rng = new RNG(seed ^ 0x7f4a7c15);
    const archetype = pickRandom(rng, ["MASSIF", "LONG_SPINE", "TWIN_BAY", "SHELF"] as const);
    const base = createDefaultTerrainRecipe(mapSize, archetype);
    const advanced = base.advancedOverrides ?? {};
    return cloneTerrainRecipe({
      ...base,
      relief: jitterValue(rng, base.relief, archetype === "SHELF" ? 0.1 : 0.16),
      ruggedness: jitterValue(rng, base.ruggedness, archetype === "SHELF" ? 0.08 : 0.16),
      coastComplexity: jitterValue(rng, base.coastComplexity, archetype === "TWIN_BAY" ? 0.16 : 0.12),
      landCoverageTarget: jitterValue(rng, base.landCoverageTarget, 0.1),
      waterLevel: base.waterLevel,
      riverIntensity: jitterValue(rng, base.riverIntensity, 0.14),
      vegetationDensity: jitterValue(rng, base.vegetationDensity, 0.18),
      townDensity: jitterValue(rng, base.townDensity, 0.16),
      bridgeAllowance: jitterValue(rng, base.bridgeAllowance, 0.14),
      advancedOverrides: {
        ...advanced,
        interiorRise: jitterValue(rng, advanced.interiorRise ?? 0.5, archetype === "SHELF" ? 0.1 : 0.14),
        maxHeight: jitterValue(rng, advanced.maxHeight ?? 0.5, archetype === "SHELF" ? 0.08 : 0.12),
        embayment: jitterValue(rng, advanced.embayment ?? 0.5, archetype === "TWIN_BAY" ? 0.14 : 0.1),
        anisotropy: jitterValue(rng, advanced.anisotropy ?? 0.5, archetype === "LONG_SPINE" ? 0.14 : 0.1),
        asymmetry: jitterValue(rng, advanced.asymmetry ?? 0.5, 0.12),
        ridgeAlignment: jitterValue(rng, advanced.ridgeAlignment ?? 0.5, archetype === "LONG_SPINE" ? 0.12 : 0.1),
        uplandDistribution: jitterValue(rng, advanced.uplandDistribution ?? 0.5, 0.12),
        islandCompactness: jitterValue(rng, advanced.islandCompactness ?? 0.5, 0.12),
        ridgeFrequency: jitterValue(rng, advanced.ridgeFrequency ?? 0.5, archetype === "LONG_SPINE" ? 0.1 : 0.14),
        basinStrength: jitterValue(rng, advanced.basinStrength ?? 0.5, 0.12),
        coastalShelfWidth: jitterValue(rng, advanced.coastalShelfWidth ?? 0.5, archetype === "SHELF" ? 0.14 : 0.1),
        seaLevelBias: jitterValue(rng, advanced.seaLevelBias ?? 0.5, 0.04),
        skipCarving: false,
        riverBudget: jitterValue(rng, advanced.riverBudget ?? 0.5, 0.14),
        settlementSpacing: jitterValue(rng, advanced.settlementSpacing ?? 0.5, 0.12),
        settlementPreGrowthYears: Math.max(0, Math.min(40, Math.round((advanced.settlementPreGrowthYears ?? 20) + (rng.next() * 16 - 8)))),
        roadStrictness: jitterValue(rng, advanced.roadStrictness ?? 0.5, 0.12),
        forestPatchiness: jitterValue(rng, advanced.forestPatchiness ?? 0.5, 0.16)
      }
    });
  };

  const startFreshDraft = (draft: TerrainDraft, entryMessage: string, saveMessage: string): void => {
    applyDraft(draft, null);
    setScenarioEntryStatus(entryMessage);
    setScenarioStatus(saveMessage);
    setShareCodeStatus("Copy the share code or save this terrain as a named scenario.");
    requestPreviewBuild(true, true);
  };

  const collectDraft = (): TerrainDraft => ({
    name: refs.scenarioNameInput.value.trim().slice(0, 40),
    seed: readSeedNumber(),
    mapSize: getSelectedMapSize(),
    terrain: getTerrainRecipe()
  });

  const buildPreviewCacheKey = (draft: TerrainDraft): string =>
    JSON.stringify({
      seed: draft.seed,
      mapSize: draft.mapSize,
      terrain: draft.terrain
    });

  const syncPreviewCacheDraft = (draft: TerrainDraft): string => {
    const cacheKey = buildPreviewCacheKey(draft);
    if (previewCacheKey !== cacheKey) {
      previewCacheKey = cacheKey;
      previewCachedSamples = {};
      previewErosionBaselineSample = null;
      previewPipelineSession = null;
      previewPipelineSessionCacheKey = null;
      updateCoastlineDebugPanel();
    }
    return cacheKey;
  };

  const resetPreviewCache = (): void => {
    previewCacheKey = null;
    previewCachedSamples = {};
    previewErosionBaselineSample = null;
    previewPipelineSession = null;
    previewPipelineSessionCacheKey = null;
    updateCoastlineDebugPanel();
  };

  const cachePreviewSample = (
    cacheKey: string,
    stepId: MapEditorStepId,
    sample: PreviewRenderableSample
  ): void => {
    if (previewCacheKey !== cacheKey) {
      return;
    }
    previewCachedSamples[stepId] = clonePreviewSample(sample);
    updateCoastlineDebugPanel();
  };

  const cacheErosionBaselineSample = (
    cacheKey: string,
    sample: PreviewRenderableSample
  ): void => {
    if (previewCacheKey !== cacheKey) {
      return;
    }
    previewErosionBaselineSample = clonePreviewSample(sample);
    updateCoastlineDebugPanel();
  };

  const cacheEquivalentPreviewSample = (
    cacheKey: string,
    stepId: MapEditorStepId,
    sample: PreviewRenderableSample
  ): void => {
    if (stepId === "scenario" || stepId === "carving") {
      cachePreviewSample(cacheKey, "scenario", sample);
      cachePreviewSample(cacheKey, "carving", sample);
      return;
    }
    cachePreviewSample(cacheKey, stepId, sample);
  };

  const renderCachedStep = (
    draft: TerrainDraft,
    stepId: MapEditorStepId,
    recenter: boolean
  ): boolean => {
    if (!isPreviewAvailable()) {
      return false;
    }
    const cacheKey = buildPreviewCacheKey(draft);
    if (previewCacheKey !== cacheKey) {
      return false;
    }
    const sample =
      stepId === "erosion" && refs.erosionCompareToggle.checked
        ? previewErosionBaselineSample
        : previewCachedSamples[stepId];
    if (!sample) {
      return false;
    }
    preview.setTerrain(applyTerrainRenderDebugOptions(sample, previewRenderDebugState), { recenter });
    hidePreviewOverlay();
    syncCurrentScenarioLabel();
    return true;
  };

  const tryRenderCachedActiveStep = (): boolean => {
    const draft = collectDraft();
    const recenter = previewRecenterPending;
    if (!renderCachedStep(draft, activeStep, recenter)) {
      return false;
    }
    previewRecenterPending = false;
    return true;
  };

  const getActiveCachedPreviewSample = (): PreviewRenderableSample | null =>
    activeStep === "erosion" && refs.erosionCompareToggle.checked
      ? previewErosionBaselineSample
      : previewCachedSamples[activeStep] ?? null;

  const renderFastPreviewForDraft = (
    draft: TerrainDraft,
    stepId: MapEditorStepId,
    recenter: boolean
  ): boolean => {
    if (!isPreviewAvailable() || !visible || getFastPreviewMode(stepId) === null) {
      return false;
    }
    const cacheKey = syncPreviewCacheDraft(draft);
    const terrainHeightScaleMultiplier = getTerrainHeightScaleMultiplier(draft.terrain, draft.mapSize);
    const sample = buildFastPreviewSample(draft, stepId, terrainHeightScaleMultiplier);
    if (!sample) {
      return false;
    }
    cacheEquivalentPreviewSample(cacheKey, stepId, sample);
    if (activeStep === stepId || (activeStep === "scenario" && stepId === "carving")) {
      preview.setTerrain(applyTerrainRenderDebugOptions(sample, previewRenderDebugState, false), { recenter });
      hidePreviewOverlay();
      syncCurrentScenarioLabel();
    }
    return true;
  };

  const findScenarioById = (scenarioId: string | null): MapScenario | null => {
    if (!scenarioId) {
      return null;
    }
    return scenarios.find((scenario) => scenario.id === scenarioId) ?? null;
  };

  const findMatchingScenario = (draft: TerrainDraft): MapScenario | null =>
    scenarios.find(
      (scenario) =>
        scenario.seed === draft.seed &&
        scenario.mapSize === draft.mapSize &&
        terrainRecipeEqual(scenario.terrain, draft.terrain)
    ) ?? null;

  const updateScenarioButtons = (): void => {
    const name = refs.scenarioNameInput.value.trim();
    refs.scenarioSaveNew.disabled = name.length === 0;
    refs.scenarioOverwrite.disabled = !selectedScenarioId;
    refs.scenarioDelete.disabled = !selectedScenarioId;
  };

  const setScenarioStatus = (message: string): void => {
    refs.scenarioStatus.textContent = message;
  };

  let bridgeDebugClipboardText = "No bridge selected.";
  let coastDebugClipboardText = "No coastline probes available yet.";

  const formatBridgeTile = (tile: { x: number; y: number }): string => `(${tile.x}, ${tile.y})`;

  const updateBridgeDebugPanel = (selection: TerrainPreviewBridgeSelection): void => {
    if (!isPreviewAvailable()) {
      refs.bridgeDebugMeta.textContent = "3D preview unavailable. Bridge inspection is disabled.";
      refs.bridgeDebugOutput.textContent = formatPreviewUnavailableMessage(previewUnavailableReason);
      refs.bridgeDebugCopy.disabled = true;
      bridgeDebugClipboardText = refs.bridgeDebugOutput.textContent;
      return;
    }
    const shareCode = refs.finalShareCodeInput.value || refs.scenarioSeedInput.value;
    const summary = selection.bridgeDebug;
    if (!summary) {
      refs.bridgeDebugMeta.textContent = "Click a rendered bridge in the preview to inspect it.";
      refs.bridgeDebugOutput.textContent = "No bridge selected.";
      refs.bridgeDebugCopy.disabled = true;
      bridgeDebugClipboardText = "No bridge selected.";
      return;
    }
    if (!selection.selectedSpan) {
      refs.bridgeDebugMeta.textContent =
        summary.renderedSpanCount > 0
          ? `${summary.renderedSpanCount} rendered bridge span${summary.renderedSpanCount === 1 ? "" : "s"}, ${summary.orphanComponentCount} orphan component${summary.orphanComponentCount === 1 ? "" : "s"}. Click a rendered bridge in the preview to inspect it.`
          : `No rendered bridge spans. Orphan bridge components: ${summary.orphanComponentCount}.`;
      refs.bridgeDebugOutput.textContent = [
        `shareCode=${shareCode}`,
        `previewStep=${getActivePreviewConfig().label}`,
        `renderedBridgeSpans=${summary.renderedSpanCount}`,
        `orphanBridgeComponents=${summary.orphanComponentCount}`,
        summary.orphanComponentCount > 0 ? "note=Some bridge mask components do not have a valid two-sided rendered span." : "note=Click a rendered bridge to inspect it."
      ].join("\n");
      refs.bridgeDebugCopy.disabled = true;
      bridgeDebugClipboardText = refs.bridgeDebugOutput.textContent;
      return;
    }

    const span = selection.selectedSpan;
    refs.bridgeDebugMeta.textContent = `Bridge ${span.spanIndex + 1} of ${Math.max(1, summary.renderedSpanCount)} selected.`;
    refs.bridgeDebugOutput.textContent = [
      `shareCode=${shareCode}`,
      `previewStep=${getActivePreviewConfig().label}`,
      `bridgeSpan=${span.spanIndex + 1}/${Math.max(1, summary.renderedSpanCount)}`,
      `componentIndex=${span.componentIndex}`,
      `routeMode=${span.routeMode}`,
      `componentTiles=${span.componentTileCount}`,
      `connectors=${span.connectorCount}`,
      `bridgePathTiles=${span.bridgePath.length}`,
      `componentBounds=${span.componentBounds.minX},${span.componentBounds.minY} -> ${span.componentBounds.maxX},${span.componentBounds.maxY}`,
      `startRoad=${formatBridgeTile(span.startRoad)}`,
      `endRoad=${formatBridgeTile(span.endRoad)}`,
      `startAnchor=edge(${span.startAnchor.edgeX.toFixed(2)}, ${span.startAnchor.edgeY.toFixed(2)}) terrain=${span.startAnchor.terrainY.toFixed(3)} deck=${span.startAnchor.baseY.toFixed(3)}`,
      `endAnchor=edge(${span.endAnchor.edgeX.toFixed(2)}, ${span.endAnchor.edgeY.toFixed(2)}) terrain=${span.endAnchor.terrainY.toFixed(3)} deck=${span.endAnchor.baseY.toFixed(3)}`,
      `spanLength=${span.worldSpanLength.toFixed(3)}`,
      `deckY=${span.minDeckY.toFixed(3)}..${span.maxDeckY.toFixed(3)}`,
      `terrainClearanceMin=${span.minTerrainClearance.toFixed(3)}`,
      `waterClearanceMin=${span.minWaterClearance === null ? "n/a" : span.minWaterClearance.toFixed(3)}`,
      `bridgeTiles=${span.bridgePath.map(formatBridgeTile).join(" ")}`
    ].join("\n");
    refs.bridgeDebugCopy.disabled = false;
    bridgeDebugClipboardText = refs.bridgeDebugOutput.textContent;
  };

  const updateCoastlineDebugPanel = (): void => {
    if (!isPreviewAvailable()) {
      refs.coastDebugMeta.textContent = "3D preview unavailable. Coastline probe preview data is disabled.";
      refs.coastDebugOutput.textContent = formatPreviewUnavailableMessage(previewUnavailableReason);
      refs.coastDebugCopy.disabled = true;
      coastDebugClipboardText = refs.coastDebugOutput.textContent;
      return;
    }
    const shareCode = refs.finalShareCodeInput.value || refs.scenarioSeedInput.value;
    const samplesForReport =
      activeStep === "erosion" && refs.erosionCompareToggle.checked && previewErosionBaselineSample
        ? { ...previewCachedSamples, erosion: previewErosionBaselineSample }
        : previewCachedSamples;
    const report = buildCoastlineDebugReport(samplesForReport, activeStep, shareCode);
    const heightReport = buildHeightProvenanceReport(
      getActiveCachedPreviewSample(),
      activeStep,
      previewHoveredTile,
      previewRenderDebugState
    );
    refs.coastDebugMeta.textContent = `${report.meta} ${heightReport.meta}`;
    refs.coastDebugOutput.textContent = `${report.text}\n\n${heightReport.text}`;
    refs.coastDebugCopy.disabled = !report.copyEnabled && previewHoveredTile === null;
    coastDebugClipboardText = refs.coastDebugOutput.textContent;
  };

  preview.setBridgeSelectionListener((selection) => {
    updateBridgeDebugPanel(selection);
  });
  preview.setHoverTileListener((hover) => {
    previewHoveredTile = hover;
    updateCoastlineDebugPanel();
  });
  updateCoastlineDebugPanel();

  const syncPreviewRenderDebugState = (): void => {
    previewRenderDebugState = {
      terrainHeightMode: terrainRawVerticesToggle.checked ? "raw" : "final",
      terrainSurfaceShadingMode: legacyFacetedShadingToggle.checked ? "legacyFaceted" : "refined",
      riverWaterOff: riverWaterOffToggle.checked,
      riverCutoutOff: riverCutoutOffToggle.checked,
      bridgesOff: bridgesOffToggle.checked
    };
    updateCoastlineDebugPanel();
    if (!visible) {
      return;
    }
    if (tryRenderCachedActiveStep()) {
      return;
    }
    requestPreviewBuild(false, false);
  };
  [
    terrainFinalVerticesToggle,
    terrainRawVerticesToggle,
    legacyFacetedShadingToggle,
    riverWaterOffToggle,
    riverCutoutOffToggle,
    bridgesOffToggle
  ].forEach((input) => {
    input.addEventListener("change", syncPreviewRenderDebugState);
  });

  const describePreviewState = (draft: TerrainDraft): string => {
    if (!isPreviewAvailable()) {
      return "3D preview unavailable";
    }
    const match = findMatchingScenario(draft);
    const sourceLabel = match ? `linked to "${match.name}"` : "custom draft";
    const activeSample = getActiveCachedPreviewSample() as PreviewRenderableSample & {
      fastPreviewTimingsMs?: { total: number };
    } | null;
    const fastMode = getFastPreviewMode(activeStep);
    if (fastMode && activeSample?.fastPreviewTimingsMs) {
      return `Fast preview: ${fastMode} - ${Math.round(activeSample.fastPreviewTimingsMs.total)}ms - ${sourceLabel}`;
    }
    return `Preview layer: ${getActivePreviewConfig().label} - ${sourceLabel}`;
  };

  const refreshScenarioList = (): void => {
    scenarios = loadMapScenarios();
    const selectedValue = selectedScenarioId ?? "";
    refs.scenarioList.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = scenarios.length > 0 ? "Select a saved scenario to load" : "No saved scenarios yet";
    placeholder.disabled = scenarios.length === 0;
    refs.scenarioList.appendChild(placeholder);
    scenarios.forEach((scenario) => {
      const option = document.createElement("option");
      option.value = scenario.id;
      option.textContent = `${scenario.name} · ${scenario.mapSize} · seed ${scenario.seed}`;
      refs.scenarioList.appendChild(option);
    });
    if (selectedValue && scenarios.some((scenario) => scenario.id === selectedValue)) {
      refs.scenarioList.value = selectedValue;
    } else {
      refs.scenarioList.value = "";
    }
    syncScenarioLoadButton();
    updateScenarioButtons();
  };

  const syncCurrentScenarioLabelLegacy = (): void => {
    const draft = collectDraft();
    refs.previewMeta.textContent = describePreviewState(draft);
    return;
    const match = findMatchingScenario(draft) ?? { name: "custom draft" };
    refs.previewMeta.textContent = match
      ? `Preview ready · linked to "${match.name}"`
      : "Preview ready · custom draft";
  };

  const syncCurrentScenarioLabel = (): void => {
    const draft = collectDraft();
    refs.previewMeta.textContent = describePreviewState(draft);
  };

  const showPreviewOverlay = (message: string, progress: number, mode: "loading" | "error" = "loading"): void => {
    refs.previewOverlay.dataset.state = mode;
    refs.previewMessage.textContent = message;
    refs.previewProgressBar.style.width = `${Math.round(clamp(progress, 0, 1) * 100)}%`;
    setElementHidden(refs.previewOverlay, false);
  };

  const hidePreviewOverlay = (): void => {
    setElementHidden(refs.previewOverlay, true);
  };

  const showPreviewUnavailableState = (): void => {
    showPreviewOverlay(formatPreviewUnavailableMessage(previewUnavailableReason), 1, "error");
    refs.previewMeta.textContent = "3D preview unavailable";
    updateBridgeDebugPanel({ selectedSpan: null, bridgeDebug: null });
    updateCoastlineDebugPanel();
  };

  const ensurePreviewPipelineSession = (draft: TerrainDraft, cacheKey: string): MapGenSession => {
    if (!previewPipelineSession || previewPipelineSessionCacheKey !== cacheKey) {
      const state = createInitialState(draft.seed, buildGrid(draft.mapSize));
      previewPipelineSession = createMapGenSession(state, new RNG(draft.seed), draft.terrain);
      previewPipelineSessionCacheKey = cacheKey;
    }
    return previewPipelineSession;
  };

  const runPreviewBuild = async (): Promise<void> => {
    if (!isPreviewAvailable()) {
      previewPending = false;
      previewRecenterPending = false;
      if (visible) {
        showPreviewUnavailableState();
      }
      return;
    }
    if (!visible || !assetsReadyForSession || previewRunning || !previewPending) {
      return;
    }
    previewRunning = true;
    previewPending = false;
    if (previewDebounceHandle) {
      window.clearTimeout(previewDebounceHandle);
      previewDebounceHandle = 0;
    }
    const sessionToken = previewSessionToken;
    const buildToken = ++previewBuildToken;
    const draft = collectDraft();
    const cacheKey = syncPreviewCacheDraft(draft);
    const terrainHeightScaleMultiplier = getTerrainHeightScaleMultiplier(draft.terrain, draft.mapSize);
    const previewConfig = getActivePreviewConfig();
    const recenter = previewRecenterPending;
    previewRecenterPending = false;
    let appliedStageCamera = false;
    let latestSnapshot: MapGenDebugSnapshot | null = null;
    let latestSnapshotRank = -1;

    try {
      showPreviewOverlay(`Generating ${previewConfig.label.toLowerCase()} preview...`, 0);
      if (previewConfig.sampleSource === "fast") {
        if (!renderFastPreviewForDraft(draft, activeStep, recenter)) {
          throw new Error("Fast preview unavailable.");
        }
        return;
      }
      const targetPhaseRank = getPhaseRank(previewConfig.stopAfterPhase);
      const session = ensurePreviewPipelineSession(draft, cacheKey);
      const world = session.state;
      resetTerrainCaches();
      const debug: MapGenDebug = {
        stopAfterPhase: previewConfig.stopAfterPhase,
        onPhase: async (snapshot) => {
          if (!visible || sessionToken !== previewSessionToken || buildToken !== previewBuildToken) {
            return;
          }
          switch (snapshot.phase) {
            case "terrain:carving": {
              cacheEquivalentPreviewSample(
                cacheKey,
                "carving",
                buildSnapshotSample(snapshot, world.grid, world.seed, terrainHeightScaleMultiplier, false)
              );
              break;
            }
            case "terrain:elevation": {
              cacheErosionBaselineSample(
                cacheKey,
                buildSnapshotSample(snapshot, world.grid, world.seed, terrainHeightScaleMultiplier, false)
              );
              break;
            }
            case "terrain:erosion": {
              cacheEquivalentPreviewSample(
                cacheKey,
                "erosion",
                buildSnapshotSample(snapshot, world.grid, world.seed, terrainHeightScaleMultiplier, false)
              );
              break;
            }
            case "roads:connect": {
              cacheEquivalentPreviewSample(
                cacheKey,
                "settlements",
                buildWorldPreviewSample(world, false, terrainHeightScaleMultiplier)
              );
              break;
            }
            case "reconcile:postSettlement": {
              cacheEquivalentPreviewSample(
                cacheKey,
                "vegetation",
                buildWorldPreviewSample(world, true, terrainHeightScaleMultiplier)
              );
              break;
            }
            case "map:finalize": {
              cacheEquivalentPreviewSample(
                cacheKey,
                "final",
                buildWorldPreviewSample(world, true, terrainHeightScaleMultiplier)
              );
              break;
            }
            default:
              break;
          }
          const snapshotRank = getPhaseRank(snapshot.phase);
          if (snapshotRank > targetPhaseRank) {
            return;
          }
          if (snapshotRank >= latestSnapshotRank) {
            latestSnapshot = snapshot;
            latestSnapshotRank = snapshotRank;
          } else {
            return;
          }
          if (previewConfig.sampleSource !== "snapshot" || snapshot.phase !== previewConfig.stopAfterPhase) {
            return;
          }
          preview.setTerrain(
            buildSnapshotSample(snapshot, world.grid, world.seed, terrainHeightScaleMultiplier, false),
            { recenter: recenter && !appliedStageCamera }
          );
          appliedStageCamera = appliedStageCamera || recenter;
        }
      };
      await session.advanceTo(
        previewConfig.stopAfterPhase,
        (message, progress) => {
          if (!visible || sessionToken !== previewSessionToken || buildToken !== previewBuildToken) {
            return;
          }
          showPreviewOverlay(message, progress);
        },
        debug
      );
      if (!visible || sessionToken !== previewSessionToken || buildToken !== previewBuildToken) {
        return;
      }
      if (previewConfig.sampleSource === "snapshot") {
        if (!latestSnapshot) {
          throw new Error("Preview snapshot unavailable.");
        }
        const sample = buildSnapshotSample(
          latestSnapshot,
          world.grid,
          world.seed,
          terrainHeightScaleMultiplier,
          previewConfig.treesEnabled
        );
        if (activeStep === "erosion" && refs.erosionCompareToggle.checked) {
          cacheErosionBaselineSample(cacheKey, sample);
        } else {
          cacheEquivalentPreviewSample(cacheKey, activeStep, sample);
        }
        preview.setTerrain(sample, { recenter: recenter && !appliedStageCamera });
      } else {
        const sample = buildWorldPreviewSample(world, previewConfig.treesEnabled, terrainHeightScaleMultiplier);
        cacheEquivalentPreviewSample(cacheKey, activeStep, sample);
        preview.setTerrain(sample, { recenter: recenter && !appliedStageCamera });
      }
      hidePreviewOverlay();
      syncCurrentScenarioLabel();
    } catch (error) {
      if (!visible || sessionToken !== previewSessionToken || buildToken !== previewBuildToken) {
        return;
      }
      const message = error instanceof Error ? error.message : "Preview generation failed.";
      showPreviewOverlay(message, 1, "error");
      refs.previewMeta.textContent = "Preview failed";
    } finally {
      previewRunning = false;
      if (visible && assetsReadyForSession && previewPending) {
        void runPreviewBuild();
      }
    }
  };

  const requestPreviewBuild = (recenter = false, immediate = false): void => {
    const draft = collectDraft();
    syncPreviewCacheDraft(draft);
    if (!isPreviewAvailable()) {
      previewPending = false;
      previewRecenterPending = false;
      if (visible) {
        showPreviewUnavailableState();
      }
      return;
    }
    previewPending = true;
    previewRecenterPending = previewRecenterPending || recenter;
    if (!visible) {
      return;
    }
    if (getFastPreviewMode(activeStep) !== null && renderFastPreviewForDraft(draft, activeStep, previewRecenterPending)) {
      previewPending = false;
      previewRecenterPending = false;
      if (previewRunning) {
        previewBuildToken += 1;
      }
      return;
    }
    if (!assetsReadyForSession) {
      return;
    }
    if (previewRunning) {
      previewBuildToken += 1;
      return;
    }
    if (previewDebounceHandle) {
      window.clearTimeout(previewDebounceHandle);
      previewDebounceHandle = 0;
    }
    if (immediate) {
      void runPreviewBuild();
      return;
    }
    previewDebounceHandle = window.setTimeout(() => {
      previewDebounceHandle = 0;
      void runPreviewBuild();
    }, PREVIEW_DEBOUNCE_MS);
  };

  const applyDraft = (draft: TerrainDraft, scenarioId: string | null): void => {
    selectedScenarioId = scenarioId;
    refs.scenarioNameInput.value = draft.name;
    setSelectedMapSize(draft.mapSize);
    applyTerrainRecipe(draft.terrain);
    syncSeedField(draft.seed);
    syncPreviewCacheDraft(draft);
    refreshScenarioList();
    updateScenarioButtons();
    syncCurrentScenarioLabel();
  };

  const applyScenario = (scenario: MapScenario): void => {
    applyDraft(
      {
        name: scenario.name,
        seed: scenario.seed,
        mapSize: scenario.mapSize,
        terrain: cloneTerrainRecipe(scenario.terrain)
      },
      scenario.id
    );
    setScenarioEntryStatus(`Loaded "${scenario.name}".`);
    setScenarioStatus(`Loaded "${scenario.name}".`);
    setShareCodeStatus("Copy the share code or save this terrain as a named scenario.");
    requestPreviewBuild(true, true);
  };

  const open = (config: NewRunConfig): void => {
    previewSessionToken += 1;
    const sessionToken = previewSessionToken;
    visible = true;
    assetsReadyForSession = false;
    updateBridgeDebugPanel({ selectedSpan: null, bridgeDebug: null });
    resetPreviewCache();
    refs.screen.classList.remove("hidden");
    setActiveStep(activeStep);
    preview.start();
    preview.resize();
    refreshScenarioList();
    const initialDraft: TerrainDraft = {
      name: "",
      seed: config.seed,
      mapSize: config.mapSize,
      terrain: cloneTerrainRecipe(config.options.terrain)
    };
    const matching = findMatchingScenario(initialDraft);
    if (matching) {
      applyScenario(matching);
    } else {
      applyDraft(initialDraft, null);
      setScenarioEntryStatus("Loaded current terrain draft.");
      setScenarioStatus("Loaded current terrain draft.");
      setShareCodeStatus("Copy the share code or save this terrain as a named scenario.");
    }
    setActiveStep("scenario");
    if (!isPreviewAvailable()) {
      showPreviewUnavailableState();
      return;
    }
    const hasInitialFastPreview = getFastPreviewMode(activeStep) !== null && getActiveCachedPreviewSample() !== null;
    if (!hasInitialFastPreview) {
      refs.previewMeta.textContent = "Loading preview assets...";
      showPreviewOverlay("Loading preview assets...", 0);
    }
    void preview.prepareAssets((progress) => {
      if (!visible || sessionToken !== previewSessionToken) {
        return;
      }
      if (getFastPreviewMode(activeStep) !== null && getActiveCachedPreviewSample() !== null) {
        return;
      }
      showPreviewOverlay(`Loading preview assets (${progress.label})...`, progress.progress);
    }).then(() => {
      if (!visible || sessionToken !== previewSessionToken) {
        return;
      }
      assetsReadyForSession = true;
      requestPreviewBuild(true, true);
    });
  };

  const close = (): void => {
    visible = false;
    previewSessionToken += 1;
    assetsReadyForSession = false;
    updateBridgeDebugPanel({ selectedSpan: null, bridgeDebug: null });
    resetPreviewCache();
    if (previewDebounceHandle) {
      window.clearTimeout(previewDebounceHandle);
      previewDebounceHandle = 0;
    }
    previewPending = false;
    previewRecenterPending = false;
    preview.stop();
    refs.screen.classList.add("hidden");
    hidePreviewOverlay();
  };

  const onResize = (): void => {
    if (!visible) {
      return;
    }
    preview.resize();
  };
  window.addEventListener("resize", onResize);

  refs.stepButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const step = button.dataset.step as MapEditorStepId | undefined;
      if (!step) {
        return;
      }
      setActiveStep(step);
    });
  });

  refs.previewResetView.addEventListener("click", () => {
    preview.resetView();
  });

  refs.scenarioSeedInput.addEventListener("input", () => {
    applySeedFieldIfEncoded();
    requestPreviewBuild(false);
    syncCurrentScenarioLabel();
    setShareCodeStatus("Copy the share code or save this terrain as a named scenario.");
  });
  refs.scenarioSeedInput.addEventListener("blur", () => {
    if (!applySeedFieldIfEncoded()) {
      syncSeedField(readSeedNumber());
    }
    syncCurrentScenarioLabel();
  });
  refs.scenarioSeedImport.addEventListener("click", () => {
    const decoded = decodeTerrainSeedCode(refs.scenarioSeedInput.value);
    if (!decoded) {
      setScenarioEntryStatus("Enter a valid share code before importing.");
      return;
    }
    startFreshDraft(
      {
        name: decoded.name ?? "",
        seed: decoded.seed,
        mapSize: decoded.mapSize,
        terrain: cloneTerrainRecipe(decoded.terrain)
      },
      "Imported share code into a new draft.",
      "Imported share code into a new draft."
    );
  });
  refs.scenarioSeedRandom.addEventListener("click", () => {
    const seed = Math.floor(Math.random() * 1_000_000_000);
    const mapSize = getSelectedMapSize();
    startFreshDraft(
      {
        name: "",
        seed,
        mapSize,
        terrain: buildRandomTerrainRecipe(mapSize, seed)
      },
      "Generated a randomized draft from a fresh seed.",
      "Generated a randomized terrain draft."
    );
    syncCurrentScenarioLabel();
  });
  refs.mapSizeInputs.forEach((input) => {
    input.addEventListener("change", () => {
      syncSeedField();
      requestPreviewBuild(true, true);
      syncCurrentScenarioLabel();
    });
  });
  terrainControlElements.inputs.forEach((input) => {
    const sync = (): void => {
      if (input instanceof HTMLSelectElement && input.dataset.terrainScope === "recipe" && input.dataset.terrainKey === "archetype") {
        applyTerrainArchetypeDefaultsToControls(input.value as TerrainRecipe["archetype"], getSelectedMapSize(), terrainControlElements);
      }
      syncTerrainControlOutputs(terrainControlElements);
      syncSeedField();
      requestPreviewBuild(false);
      syncCurrentScenarioLabel();
    };
    input.addEventListener(input instanceof HTMLSelectElement ? "change" : "input", sync);
  });
  refs.advancedToggle.addEventListener("change", syncAdvancedVisibility);
  refs.erosionCompareToggle.addEventListener("change", () => {
    syncCurrentScenarioLabel();
    updateCoastlineDebugPanel();
    if (activeStep !== "erosion") {
      return;
    }
    if (tryRenderCachedActiveStep()) {
      return;
    }
    requestPreviewBuild(false, true);
  });
  syncTerrainControlOutputs(terrainControlElements);
  syncAdvancedVisibility();
  syncErosionCompareToggleAvailability();
  refs.scenarioNameInput.addEventListener("input", () => {
    syncSeedField();
    updateScenarioButtons();
    setShareCodeStatus("Share code updated with the current scenario name.");
  });
  refs.scenarioList.addEventListener("change", () => {
    syncScenarioLoadButton();
    const scenario = findScenarioById(refs.scenarioList.value);
    setScenarioEntryStatus(
      scenario ? `Selected "${scenario.name}". Click Load Scenario to apply it.` : "Import a share code, load a saved scenario, or start a new draft."
    );
  });
  refs.scenarioLoad.addEventListener("click", () => {
    const scenario = findScenarioById(refs.scenarioList.value);
    if (!scenario) {
      setScenarioEntryStatus("Select a saved scenario to load.");
      return;
    }
    applyScenario(scenario);
  });

  refs.scenarioSaveNew.addEventListener("click", () => {
    const draft = collectDraft();
    if (draft.name.length === 0) {
      setScenarioStatus("Enter a scenario name before saving.");
      return;
    }
    const duplicate = scenarios.find((scenario) => compareScenarioName(scenario.name, draft.name));
    if (duplicate) {
      setScenarioStatus(`"${draft.name}" already exists. Use Overwrite or choose another name.`);
      return;
    }
    const now = new Date().toISOString();
    const scenario: MapScenario = {
      id: createMapScenarioId(),
      name: draft.name,
      seed: draft.seed,
      mapSize: draft.mapSize,
      terrain: cloneTerrainRecipe(draft.terrain),
      createdAt: now,
      updatedAt: now
    };
    upsertMapScenario(scenario);
    selectedScenarioId = scenario.id;
    refreshScenarioList();
    syncCurrentScenarioLabel();
    setScenarioEntryStatus(`Saved "${scenario.name}" and linked it to the current draft.`);
    setScenarioStatus(`Saved "${scenario.name}".`);
  });

  refs.scenarioOverwrite.addEventListener("click", () => {
    const selected = findScenarioById(selectedScenarioId);
    if (!selected) {
      setScenarioStatus("Select a saved scenario to overwrite.");
      return;
    }
    const draft = collectDraft();
    if (draft.name.length === 0) {
      setScenarioStatus("Enter a scenario name before overwriting.");
      return;
    }
    const duplicate = scenarios.find(
      (scenario) => scenario.id !== selected.id && compareScenarioName(scenario.name, draft.name)
    );
    if (duplicate) {
      setScenarioStatus(`"${draft.name}" already exists. Choose another name before overwriting.`);
      return;
    }
    const scenario: MapScenario = {
      ...selected,
      name: draft.name,
      seed: draft.seed,
      mapSize: draft.mapSize,
      terrain: cloneTerrainRecipe(draft.terrain),
      updatedAt: new Date().toISOString()
    };
    upsertMapScenario(scenario);
    selectedScenarioId = scenario.id;
    refreshScenarioList();
    syncCurrentScenarioLabel();
    setScenarioEntryStatus(`Overwrote "${scenario.name}".`);
    setScenarioStatus(`Overwrote "${scenario.name}".`);
  });

  refs.scenarioDelete.addEventListener("click", () => {
    const selected = findScenarioById(selectedScenarioId);
    if (!selected) {
      setScenarioStatus("Select a saved scenario to delete.");
      return;
    }
    if (!window.confirm(`Delete the scenario "${selected.name}"?`)) {
      return;
    }
    deleteMapScenario(selected.id);
    selectedScenarioId = null;
    refreshScenarioList();
    syncCurrentScenarioLabel();
    refs.scenarioNameInput.value = "";
    updateScenarioButtons();
    syncSeedField();
    setScenarioEntryStatus(`Deleted "${selected.name}". Start a new draft, import a share code, or load another scenario.`);
    setScenarioStatus(`Deleted "${selected.name}".`);
  });

  refs.scenarioResetDefaults.addEventListener("click", () => {
    startFreshDraft(
      {
        name: "",
        seed: DEFAULT_RUN_SEED,
        mapSize: getSelectedMapSize(),
        terrain: createDefaultTerrainRecipe(getSelectedMapSize())
      },
      "Started a new terrain draft.",
      "Started a new terrain draft."
    );
  });

  refs.copyShareCodeButton.addEventListener("click", async () => {
    const shareCode = refs.finalShareCodeInput.value.trim();
    if (shareCode.length === 0) {
      setShareCodeStatus("Share code unavailable for copying.");
      return;
    }
    try {
      await navigator.clipboard.writeText(shareCode);
      setShareCodeStatus("Copied share code to the clipboard.");
    } catch {
      refs.finalShareCodeInput.focus();
      refs.finalShareCodeInput.select();
      setShareCodeStatus("Clipboard access failed. The share code has been selected for manual copy.");
    }
  });

  refs.bridgeDebugCopy.addEventListener("click", async () => {
    if (refs.bridgeDebugCopy.disabled || bridgeDebugClipboardText.trim().length === 0) {
      return;
    }
    try {
      await navigator.clipboard.writeText(bridgeDebugClipboardText);
      refs.bridgeDebugMeta.textContent = "Copied bridge debug to the clipboard.";
    } catch {
      refs.bridgeDebugOutput.focus();
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(refs.bridgeDebugOutput);
        selection.addRange(range);
      }
      refs.bridgeDebugMeta.textContent = "Clipboard access failed. Bridge debug has been selected for manual copy.";
    }
  });

  refs.coastDebugCopy.addEventListener("click", async () => {
    if (refs.coastDebugCopy.disabled || coastDebugClipboardText.trim().length === 0) {
      return;
    }
    try {
      await navigator.clipboard.writeText(coastDebugClipboardText);
      refs.coastDebugMeta.textContent = "Copied coastline probe debug to the clipboard.";
    } catch {
      refs.coastDebugOutput.focus();
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        const range = document.createRange();
        range.selectNodeContents(refs.coastDebugOutput);
        selection.addRange(range);
      }
      refs.coastDebugMeta.textContent = "Clipboard access failed. Coastline probe debug has been selected for manual copy.";
    }
  });

  refs.backToMenu.addEventListener("click", () => {
    close();
    deps.onBackToMenu();
  });

  return {
    open,
    close,
    isVisible: () => visible,
    destroy: () => {
      close();
      window.removeEventListener("resize", onResize);
      preview.dispose();
    }
  };
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
