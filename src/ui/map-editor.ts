import { MAP_SIZE_PRESETS, type MapSizeId } from "../core/config.js";
import { RNG } from "../core/rng.js";
import { createInitialState, resetState, type WorldState } from "../core/state.js";
import { TREE_TYPE_IDS } from "../core/types.js";
import { syncTileSoA } from "../core/tileCache.js";
import { generateMap, type MapGenDebug, type MapGenDebugPhase, type MapGenDebugSnapshot } from "../mapgen/index.js";
import {
  cloneTerrainRecipe,
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
import { createTerrainPreviewController } from "../render/terrainPreview.js";
import { resetTerrainCaches } from "../render/terrainCache.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_SEED, type NewRunConfig } from "./run-config.js";
import { buildTerrainControls } from "./terrain-controls.js";
import {
  coerceTerrainSeedNumber,
  decodeTerrainSeedCode,
  encodeTerrainSeedCode
} from "./terrainSeedCode.js";
import {
  applyTerrainRecipeToControls,
  collectTerrainControlElements,
  MAP_EDITOR_TERRAIN_GROUPS,
  readTerrainRecipeFromControls,
  syncTerrainControlOutputs
} from "./terrain-schema.js";

type MapEditorStepId = "scenario" | "relief" | "carving" | "flooding" | "rivers" | "settlements" | "vegetation" | "final";

type MapEditorRefs = {
  screen: HTMLDivElement;
  previewCanvas: HTMLCanvasElement;
  previewOverlay: HTMLDivElement;
  previewMessage: HTMLDivElement;
  previewProgressBar: HTMLDivElement;
  previewMeta: HTMLDivElement;
  previewResetView: HTMLButtonElement;
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
  legacyNotice: HTMLDivElement;
  backToMenu: HTMLButtonElement;
  mapSizeInputs: HTMLInputElement[];
  stepButtons: HTMLButtonElement[];
  stepPanels: HTMLElement[];
  scenarioControls: HTMLDivElement;
  reliefControls: HTMLDivElement;
  carvingControls: HTMLDivElement;
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

const PREVIEW_DEBOUNCE_MS = 450;
const MAP_EDITOR_PHASE_ORDER: MapGenDebugPhase[] = [
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
  sampleSource: "snapshot" | "state";
  treesEnabled: boolean;
};

const MAP_EDITOR_PREVIEW_BY_STEP: Record<MapEditorStepId, StepPreviewConfig> = {
  scenario: {
    label: "Relief",
    stopAfterPhase: "terrain:relief",
    sampleSource: "snapshot",
    treesEnabled: false
  },
  relief: {
    label: "Relief",
    stopAfterPhase: "terrain:relief",
    sampleSource: "snapshot",
    treesEnabled: false
  },
  carving: {
    label: "Terrain Carving",
    stopAfterPhase: "terrain:carving",
    sampleSource: "snapshot",
    treesEnabled: false
  },
  flooding: {
    label: "Flooded Coastline",
    stopAfterPhase: "hydro:solve",
    sampleSource: "state",
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
    false,
    heightScaleMultiplier
  );
};

type SnapshotPreviewSample = ReturnType<typeof buildSnapshotSample>;
type WorldPreviewSample = ReturnType<typeof buildWorldPreviewSample>;
type PreviewRenderableSample = SnapshotPreviewSample | WorldPreviewSample;

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
    riverMask: cloneUint8Array(snapshotSample.riverMask)
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
  legacyNotice: document.getElementById("mapEditorLegacyNotice") as HTMLDivElement,
  backToMenu: document.getElementById("mapEditorBackToMenu") as HTMLButtonElement,
  mapSizeInputs: Array.from(document.querySelectorAll<HTMLInputElement>('#mapEditorScreen input[name="mapEditorMapSize"]')),
  stepButtons: Array.from(document.querySelectorAll<HTMLButtonElement>("#mapEditorScreen .map-editor-step")),
  stepPanels: Array.from(document.querySelectorAll<HTMLElement>("#mapEditorScreen .map-editor-step-panel")),
  scenarioControls: document.getElementById("mapEditorScenarioControls") as HTMLDivElement,
  reliefControls: document.getElementById("mapEditorReliefControls") as HTMLDivElement,
  carvingControls: document.getElementById("mapEditorCarvingControls") as HTMLDivElement,
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

  const preview = createTerrainPreviewController(refs.previewCanvas);
  const terrainControlElements = collectTerrainControlElements(refs.screen);
  refs.legacyNotice.textContent = "Older saved map scenarios used the legacy slider model and are not loaded in this editor.";
  refs.legacyNotice.classList.toggle("hidden", !hasLegacyMapScenarios());

  let visible = false;
  let activeStep: MapEditorStepId = "scenario";
  let selectedScenarioId: string | null = null;
  let scenarios: MapScenario[] = [];
  let previewWorld: WorldState | null = null;
  let previewWorldMapSize: MapSizeId | null = null;
  const previewRng = new RNG(DEFAULT_RUN_SEED);
  let previewPending = false;
  let previewRunning = false;
  let previewRecenterPending = false;
  let previewDebounceHandle = 0;
  let previewSessionToken = 0;
  let previewBuildToken = 0;
  let previewCacheKey: string | null = null;
  let previewCachedSamples: Partial<Record<MapEditorStepId, PreviewRenderableSample>> = {};
  let previewWarmRunning = false;
  let previewWarmCacheKey: string | null = null;
  let previewWarmToken = 0;
  let assetsReadyForSession = false;
  let advancedMode = false;

  const getActivePreviewConfig = (): StepPreviewConfig => MAP_EDITOR_PREVIEW_BY_STEP[activeStep];

  const syncAdvancedVisibility = (): void => {
    advancedMode = refs.advancedToggle.checked;
    refs.screen.querySelectorAll<HTMLElement>("[data-terrain-advanced='true']").forEach((element) => {
      element.classList.toggle("hidden", !advancedMode);
    });
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
    syncCurrentScenarioLabel();
    const draft = collectDraft();
    const cacheKey = syncPreviewCacheDraft(draft);
    if (tryRenderCachedActiveStep()) {
      void warmPreviewCache(draft);
      return;
    }
    if (previewRunning) {
      requestPreviewBuild(false, true);
      return;
    }
    if (previewWarmRunning && previewWarmCacheKey === cacheKey) {
      showPreviewOverlay(`Refining ${getActivePreviewConfig().label.toLowerCase()} preview...`, 0);
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
    const explicitTownLayout = pickRandom(
      rng,
      ["coastal_ring", "bridge_chain", "inland_valley", "hub_spokes"] as const
    );
    const base = createDefaultTerrainRecipe(mapSize, archetype);
    const advanced = base.advancedOverrides ?? {};
    return cloneTerrainRecipe({
      ...base,
      townLayout: rng.next() < 0.68 ? "auto" : explicitTownLayout,
      relief: jitterValue(rng, base.relief, archetype === "SHELF" ? 0.1 : 0.16),
      ruggedness: jitterValue(rng, base.ruggedness, archetype === "SHELF" ? 0.08 : 0.16),
      coastComplexity: jitterValue(rng, base.coastComplexity, archetype === "TWIN_BAY" ? 0.16 : 0.12),
      waterLevel: jitterValue(rng, base.waterLevel, 0.12),
      riverIntensity: jitterValue(rng, base.riverIntensity, 0.14),
      vegetationDensity: jitterValue(rng, base.vegetationDensity, 0.18),
      townDensity: jitterValue(rng, base.townDensity, 0.16),
      bridgeAllowance: jitterValue(rng, base.bridgeAllowance, 0.14),
      advancedOverrides: {
        ...advanced,
        interiorRise: jitterValue(rng, advanced.interiorRise ?? 0.5, archetype === "SHELF" ? 0.1 : 0.14),
        maxHeight: jitterValue(rng, advanced.maxHeight ?? 0.5, archetype === "SHELF" ? 0.08 : 0.12),
        islandCompactness: jitterValue(rng, advanced.islandCompactness ?? 0.5, 0.12),
        ridgeFrequency: jitterValue(rng, advanced.ridgeFrequency ?? 0.5, archetype === "LONG_SPINE" ? 0.1 : 0.14),
        basinStrength: jitterValue(rng, advanced.basinStrength ?? 0.5, 0.12),
        coastalShelfWidth: jitterValue(rng, advanced.coastalShelfWidth ?? 0.5, archetype === "SHELF" ? 0.14 : 0.1),
        skipCarving: rng.next() < 0.18,
        riverBudget: jitterValue(rng, advanced.riverBudget ?? 0.5, 0.14),
        settlementSpacing: jitterValue(rng, advanced.settlementSpacing ?? 0.5, 0.12),
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
      previewWarmToken += 1;
    }
    return cacheKey;
  };

  const resetPreviewCache = (): void => {
    previewCacheKey = null;
    previewCachedSamples = {};
    previewWarmToken += 1;
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
  };

  const cacheEquivalentPreviewSample = (
    cacheKey: string,
    stepId: MapEditorStepId,
    sample: PreviewRenderableSample
  ): void => {
    if (stepId === "scenario" || stepId === "relief") {
      cachePreviewSample(cacheKey, "scenario", sample);
      cachePreviewSample(cacheKey, "relief", sample);
      return;
    }
    cachePreviewSample(cacheKey, stepId, sample);
  };

  const renderCachedStep = (
    draft: TerrainDraft,
    stepId: MapEditorStepId,
    recenter: boolean
  ): boolean => {
    const cacheKey = buildPreviewCacheKey(draft);
    if (previewCacheKey !== cacheKey) {
      return false;
    }
    const sample = previewCachedSamples[stepId];
    if (!sample) {
      return false;
    }
    preview.setTerrain(sample, { recenter });
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

  const maybeRenderCachedActiveStep = (cacheKey: string, stepId: MapEditorStepId): void => {
    if (!visible || previewRunning || previewCacheKey !== cacheKey) {
      return;
    }
    if (
      activeStep !== stepId
      && !(activeStep === "scenario" && stepId === "relief")
    ) {
      return;
    }
    const draft = collectDraft();
    if (buildPreviewCacheKey(draft) !== cacheKey) {
      return;
    }
    tryRenderCachedActiveStep();
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

  const describePreviewState = (draft: TerrainDraft): string => {
    const match = findMatchingScenario(draft);
    const sourceLabel = match ? `linked to "${match.name}"` : "custom draft";
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

  const ensurePreviewWorld = (mapSize: MapSizeId, seed: number): WorldState => {
    if (!previewWorld || previewWorldMapSize !== mapSize) {
      previewWorld = createInitialState(seed, buildGrid(mapSize));
      previewWorldMapSize = mapSize;
      return previewWorld;
    }
    resetState(previewWorld, seed);
    return previewWorld;
  };

  const warmPreviewCache = async (draft: TerrainDraft): Promise<void> => {
    if (!visible || !assetsReadyForSession || previewRunning || previewWarmRunning) {
      return;
    }
    const cacheKey = syncPreviewCacheDraft(draft);
    const terrainHeightScaleMultiplier = getTerrainHeightScaleMultiplier(draft.terrain, draft.mapSize);
    if (previewCachedSamples.final && previewCacheKey === cacheKey) {
      return;
    }

    previewWarmRunning = true;
    previewWarmCacheKey = cacheKey;
    const sessionToken = previewSessionToken;
    const warmToken = previewWarmToken;
    const warmWorld = createInitialState(draft.seed, buildGrid(draft.mapSize));
    const warmRng = new RNG(draft.seed);

    try {
      const debug: MapGenDebug = {
        onPhase: async (snapshot) => {
          if (!visible || sessionToken !== previewSessionToken || warmToken !== previewWarmToken || previewCacheKey !== cacheKey) {
            return;
          }
          switch (snapshot.phase) {
            case "terrain:relief": {
              const sample = buildSnapshotSample(
                snapshot,
                warmWorld.grid,
                warmWorld.seed,
                terrainHeightScaleMultiplier,
                false
              );
              cacheEquivalentPreviewSample(cacheKey, "relief", sample);
              maybeRenderCachedActiveStep(cacheKey, "relief");
              break;
            }
            case "terrain:carving": {
              cacheEquivalentPreviewSample(
                cacheKey,
                "carving",
                buildSnapshotSample(snapshot, warmWorld.grid, warmWorld.seed, terrainHeightScaleMultiplier, false)
              );
              maybeRenderCachedActiveStep(cacheKey, "carving");
              break;
            }
            case "hydro:solve": {
              cacheEquivalentPreviewSample(
                cacheKey,
                "flooding",
                buildWorldPreviewSample(warmWorld, false, terrainHeightScaleMultiplier)
              );
              maybeRenderCachedActiveStep(cacheKey, "flooding");
              break;
            }
            case "hydro:rivers": {
              cacheEquivalentPreviewSample(
                cacheKey,
                "rivers",
                buildSnapshotSample(snapshot, warmWorld.grid, warmWorld.seed, terrainHeightScaleMultiplier, false)
              );
              maybeRenderCachedActiveStep(cacheKey, "rivers");
              break;
            }
            case "roads:connect": {
              cacheEquivalentPreviewSample(
                cacheKey,
                "settlements",
                buildWorldPreviewSample(warmWorld, false, terrainHeightScaleMultiplier)
              );
              maybeRenderCachedActiveStep(cacheKey, "settlements");
              break;
            }
            case "reconcile:postSettlement": {
              cacheEquivalentPreviewSample(
                cacheKey,
                "vegetation",
                buildWorldPreviewSample(warmWorld, true, terrainHeightScaleMultiplier)
              );
              maybeRenderCachedActiveStep(cacheKey, "vegetation");
              break;
            }
            case "map:finalize": {
              cacheEquivalentPreviewSample(
                cacheKey,
                "final",
                buildWorldPreviewSample(warmWorld, true, terrainHeightScaleMultiplier)
              );
              maybeRenderCachedActiveStep(cacheKey, "final");
              break;
            }
            default:
              break;
          }
        }
      };

      await generateMap(warmWorld, warmRng, undefined, draft.terrain, debug);

      if (!visible || sessionToken !== previewSessionToken || warmToken !== previewWarmToken || previewCacheKey !== cacheKey) {
        return;
      }

      if (!previewCachedSamples.final) {
        cacheEquivalentPreviewSample(
          cacheKey,
          "final",
          buildWorldPreviewSample(warmWorld, true, terrainHeightScaleMultiplier)
        );
        maybeRenderCachedActiveStep(cacheKey, "final");
      }
    } catch {
      if (
        visible &&
        sessionToken === previewSessionToken &&
        warmToken === previewWarmToken &&
        previewCacheKey === cacheKey &&
        !previewCachedSamples[activeStep]
      ) {
        requestPreviewBuild(previewRecenterPending, true);
      }
    } finally {
      previewWarmRunning = false;
      previewWarmCacheKey = null;
    }
  };

  const runPreviewBuild = async (): Promise<void> => {
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
    const targetPhaseRank = getPhaseRank(previewConfig.stopAfterPhase);
    const recenter = previewRecenterPending;
    previewRecenterPending = false;
    let appliedStageCamera = false;
    let latestSnapshot: MapGenDebugSnapshot | null = null;
    let latestSnapshotRank = -1;

    try {
      showPreviewOverlay(`Generating ${previewConfig.label.toLowerCase()} preview...`, 0);
      const world = ensurePreviewWorld(draft.mapSize, draft.seed);
      resetTerrainCaches();
      previewRng.setState(draft.seed);
      const debug: MapGenDebug = {
        stopAfterPhase: previewConfig.stopAfterPhase,
        onPhase: async (snapshot) => {
          if (!visible || sessionToken !== previewSessionToken || buildToken !== previewBuildToken) {
            return;
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
      await generateMap(
        world,
        previewRng,
        (message, progress) => {
          if (!visible || sessionToken !== previewSessionToken || buildToken !== previewBuildToken) {
            return;
          }
          showPreviewOverlay(message, progress);
        },
        draft.terrain,
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
        cacheEquivalentPreviewSample(cacheKey, activeStep, sample);
        preview.setTerrain(sample, { recenter: recenter && !appliedStageCamera });
      } else {
        const sample = buildWorldPreviewSample(world, previewConfig.treesEnabled, terrainHeightScaleMultiplier);
        cacheEquivalentPreviewSample(cacheKey, activeStep, sample);
        preview.setTerrain(sample, { recenter: recenter && !appliedStageCamera });
      }
      hidePreviewOverlay();
      syncCurrentScenarioLabel();
      void warmPreviewCache(draft);
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
    syncPreviewCacheDraft(collectDraft());
    previewPending = true;
    previewRecenterPending = previewRecenterPending || recenter;
    if (!visible || !assetsReadyForSession) {
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
    refs.previewMeta.textContent = "Loading preview assets...";
    showPreviewOverlay("Loading preview assets...", 0);
    void preview.prepareAssets((progress) => {
      if (!visible || sessionToken !== previewSessionToken) {
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
      syncTerrainControlOutputs(terrainControlElements);
      syncSeedField();
      requestPreviewBuild(false);
      syncCurrentScenarioLabel();
    };
    input.addEventListener(input instanceof HTMLSelectElement ? "change" : "input", sync);
  });
  refs.advancedToggle.addEventListener("change", syncAdvancedVisibility);
  syncTerrainControlOutputs(terrainControlElements);
  syncAdvancedVisibility();
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
