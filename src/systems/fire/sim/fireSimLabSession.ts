import { createEffectsState, resetEffectsState, type EffectsState } from "../../../core/effectsState.js";
import { DEFAULT_FIRE_SETTINGS, FUEL_PROFILES, INCIDENT_FIRE_PACING_SCALE } from "../../../core/config.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import { RNG } from "../../../core/rng.js";
import { createInitialState, TILE_TYPE_IDS, type WorldState } from "../../../core/state.js";
import { syncTileSoA, syncTileSoAIndex } from "../../../core/tileCache.js";
import { clamp } from "../../../core/utils.js";
import type { FuelProfile, TileType } from "../../../core/types.js";
import { clearFireBlocks, markFireBlockActiveByTile } from "../../../sim/fire/activeBlocks.js";
import { markFireBounds, resetFireBounds } from "../../../sim/fire/bounds.js";
import { stepFire } from "../../../sim/fire.js";
import {
  DEFAULT_FIRE_SIM_LAB_ENVIRONMENT,
  FIRE_SIM_LAB_GRID,
  FIRE_SIM_LAB_INCIDENT_TICK_SECONDS,
  normalizeFireSimLabSpeed,
  normalizeFireSimLabScenarioId,
  type FireSimLabEnvironment,
  type FireSimLabFirefighter,
  type FireSimLabProfileField,
  type FireSimLabScenarioId,
  type FireSimLabScenarioSnapshot,
  type FireSimLabStats
} from "../types/fireSimLabTypes.js";
import { applyFireActivityMetrics } from "./fireActivityState.js";
import {
  applyFirefighterCooling,
  applyFirefighterPlacementPrewet,
  markFirefighterCoolingAreaActive
} from "./fireSimLabFirefighters.js";
import {
  applyProfileToTile,
  cloneFuelProfile,
  createFuelProfiles,
  createLabTile,
  getScenarioDefaultType,
  shouldResetFuelOnProfileApply
} from "./fireSimLabScenario.js";
import { createFireSimLabWeather, getWindFromFireSimLabEnvironment } from "./fireSimLabWeather.js";

const LAB_SEED = 25042026;
const FIRE_EPS = 0.001;
const MAX_FIRE_SUBSTEP_SECONDS = 0.05;

const normalizeEnvironment = (environment: FireSimLabEnvironment): FireSimLabEnvironment => ({
  ...environment,
  simSpeed: normalizeFireSimLabSpeed(environment.simSpeed)
});

export type FireSimLabSession = {
  readonly state: WorldState;
  readonly effects: EffectsState;
  getScenario: () => FireSimLabScenarioId;
  setScenario: (scenarioId: FireSimLabScenarioId) => void;
  resetScenario: () => void;
  getEnvironment: () => FireSimLabEnvironment;
  setEnvironment: (patch: Partial<FireSimLabEnvironment>) => void;
  getFuelProfile: (type: TileType) => FuelProfile;
  getFuelProfiles: () => Record<TileType, FuelProfile>;
  setFuelProfile: (type: TileType, profile: FuelProfile) => void;
  setFuelProfileValue: (type: TileType, field: FireSimLabProfileField, value: number) => void;
  resetFuelProfile: (type: TileType) => void;
  resetAllFuelProfiles: () => void;
  paintTile: (x: number, y: number, type: TileType, brushSize: number) => void;
  igniteTile: (x: number, y: number, brushSize: number) => void;
  coolTile: (x: number, y: number, brushSize: number) => void;
  toggleFirefighter: (x: number, y: number) => void;
  getFirefighters: () => readonly FireSimLabFirefighter[];
  step: (seconds: number) => void;
  getStats: () => FireSimLabStats;
  getProfileExportText: () => string;
  getScenarioSnapshot: () => FireSimLabScenarioSnapshot;
  loadScenarioSnapshot: (snapshot: FireSimLabScenarioSnapshot) => { ok: boolean; message: string };
};

export const createFireSimLabSession = (
  initialScenarioId: FireSimLabScenarioId = "mixed-fuels",
  initialProfiles: Partial<Record<TileType, FuelProfile>> = {}
): FireSimLabSession => {
  const grid = {
    cols: FIRE_SIM_LAB_GRID.cols,
    rows: FIRE_SIM_LAB_GRID.rows,
    totalTiles: FIRE_SIM_LAB_GRID.cols * FIRE_SIM_LAB_GRID.rows
  };
  const state = createInitialState(LAB_SEED, grid);
  const effects = createEffectsState();
  const rng = new RNG(LAB_SEED);
  let scenarioId = normalizeFireSimLabScenarioId(initialScenarioId);
  let environment: FireSimLabEnvironment = normalizeEnvironment({ ...DEFAULT_FIRE_SIM_LAB_ENVIRONMENT });
  let profiles = createFuelProfiles(initialProfiles);
  let firefighters: FireSimLabFirefighter[] = [];
  let elapsedDays = 0;
  let incidentTickAccumulator = 0;
  let ignitionOrigin: { x: number; y: number } | null = null;

  state.fireSettings = {
    ...DEFAULT_FIRE_SETTINGS,
    simSpeed: 1.2,
    boundsPadding: 5
  };
  state.simPerf.blockSize = 8;
  state.simPerf.fireQuality = 2;
  state.simPerf.smokeSampleRate = 8;

  const syncTile = (idx: number): void => {
    syncTileSoAIndex(state, idx);
    state.tileTypeId[idx] = TILE_TYPE_IDS[state.tiles[idx].type];
    state.structureMask[idx] = state.tiles[idx].type === "house" ? 1 : 0;
  };

  const setTileType = (x: number, y: number, type: TileType): void => {
    const idx = indexFor(grid, x, y);
    const tile = createLabTile(type);
    applyProfileToTile(tile, profiles[type], environment.moisture, true);
    state.tiles[idx] = tile;
    syncTile(idx);
    state.tileBurnAge[idx] = 0;
    state.tileHeatRelease[idx] = 0;
    state.tileSuppressionWetness[idx] = 0;
  };

  const markActive = (x: number, y: number): void => {
    const idx = indexFor(grid, x, y);
    markFireBounds(state, x, y);
    markFireBlockActiveByTile(state, idx);
  };

  const getBrushSquareStart = (center: number, brushSize: number): number =>
    center - Math.floor((Math.max(1, Math.floor(brushSize)) - 1) * 0.5);

  const applyBrushSquare = (
    centerX: number,
    centerY: number,
    brushSize: number,
    apply: (x: number, y: number, idx: number) => void
  ): void => {
    const size = Math.max(1, Math.floor(brushSize));
    const startX = getBrushSquareStart(centerX, size);
    const startY = getBrushSquareStart(centerY, size);
    for (let y = startY; y < startY + size; y += 1) {
      for (let x = startX; x < startX + size; x += 1) {
        if (!inBounds(grid, x, y)) {
          continue;
        }
        apply(x, y, indexFor(grid, x, y));
      }
    }
  };

  const igniteTile = (x: number, y: number, brushSize: number): void => {
    applyBrushSquare(x, y, brushSize, (tileX, tileY, idx) => {
      const tile = state.tiles[idx];
      if (!tile || tile.fuel <= 0.01 || tile.type === "water" || tile.type === "road" || tile.type === "firebreak") {
        return;
      }
      tile.fire = Math.max(tile.fire, 0.42);
      tile.heat = Math.max(tile.heat, tile.ignitionPoint * 1.75);
      state.tileFire[idx] = tile.fire;
      state.tileHeat[idx] = tile.heat;
      markActive(tileX, tileY);
      ignitionOrigin = { x: tileX, y: tileY };
    });
    state.lastActiveFires = Math.max(1, state.lastActiveFires);
    applyFireActivityMetrics(state, state.lastActiveFires);
  };

  const resetScenario = (): void => {
    clearFireBlocks(state);
    resetFireBounds(state);
    resetEffectsState(effects);
    state.tiles = Array.from({ length: grid.totalTiles }, (_, idx) => {
      const x = idx % grid.cols;
      const y = Math.floor(idx / grid.cols);
      const type = getScenarioDefaultType(scenarioId, x, y);
      const tile = createLabTile(type);
      applyProfileToTile(tile, profiles[type], environment.moisture, true);
      return tile;
    });
    state.tileFire.fill(0);
    state.tileFuel.fill(0);
    state.tileHeat.fill(0);
    state.tileBurnAge.fill(0);
    state.tileHeatRelease.fill(0);
    state.tileSuppressionWetness.fill(0);
    state.tileTypeId.fill(0);
    state.structureMask.fill(0);
    syncTileSoA(state);
    elapsedDays = 0;
    incidentTickAccumulator = 0;
    state.lastActiveFires = 0;
    applyFireActivityMetrics(state, 0);
    firefighters = [];
    ignitionOrigin = null;
    const startX = scenarioId === "wind-break" ? 8 : 9;
    const startY = scenarioId === "fuel-strips" ? Math.floor(grid.rows * 0.5) : Math.floor(grid.rows * 0.54);
    igniteTile(startX, startY, 1);
  };

  const updateMatchingTiles = (type: TileType, resetFuel: boolean): void => {
    for (let idx = 0; idx < state.tiles.length; idx += 1) {
      const tile = state.tiles[idx];
      if (!tile || tile.type !== type) {
        continue;
      }
      applyProfileToTile(tile, profiles[type], environment.moisture, resetFuel && shouldResetFuelOnProfileApply(tile));
      syncTile(idx);
    }
  };

  const paintTile = (x: number, y: number, type: TileType, brushSize: number): void => {
    applyBrushSquare(x, y, brushSize, (tileX, tileY) => {
      setTileType(tileX, tileY, type);
    });
    clearFireBlocks(state);
    resetFireBounds(state);
    for (let idx = 0; idx < state.tiles.length; idx += 1) {
      const tile = state.tiles[idx];
      if (tile.fire > FIRE_EPS || tile.heat > 0.02) {
        markActive(idx % grid.cols, Math.floor(idx / grid.cols));
      }
    }
  };

  const coolTile = (x: number, y: number, brushSize: number): void => {
    applyBrushSquare(x, y, brushSize, (tileX, tileY, idx) => {
      const tile = state.tiles[idx];
      tile.fire = 0;
      tile.heat = 0;
      state.tileFire[idx] = 0;
      state.tileHeat[idx] = 0;
      state.tileBurnAge[idx] = 0;
      state.tileHeatRelease[idx] = 0;
      markActive(tileX, tileY);
    });
  };

  const sanitizeFirefighters = (nextFirefighters: readonly FireSimLabFirefighter[]): FireSimLabFirefighter[] => {
    const seen = new Set<string>();
    const sanitized: FireSimLabFirefighter[] = [];
    nextFirefighters.forEach((firefighter) => {
      const x = Math.floor(firefighter.x);
      const y = Math.floor(firefighter.y);
      if (!inBounds(grid, x, y)) {
        return;
      }
      const key = `${x}:${y}`;
      if (seen.has(key)) {
        return;
      }
      seen.add(key);
      sanitized.push({ x, y });
    });
    return sanitized;
  };

  const toggleFirefighter = (x: number, y: number): void => {
    if (!inBounds(grid, x, y)) {
      return;
    }
    const existingIndex = firefighters.findIndex((firefighter) => firefighter.x === x && firefighter.y === y);
    if (existingIndex >= 0) {
      firefighters = firefighters.filter((_, index) => index !== existingIndex);
      return;
    }
    const firefighter = { x, y };
    firefighters = [...firefighters, firefighter];
    applyFirefighterPlacementPrewet(state, [firefighter], FIRE_SIM_LAB_INCIDENT_TICK_SECONDS);
    markFirefighterCoolingAreaActive(state, firefighter);
  };

  const advanceIncidentTick = (incidentTickSeconds: number): void => {
    let remainingSeconds = Math.max(0, incidentTickSeconds);
    if (remainingSeconds <= 0) {
      return;
    }
    state.wind = getWindFromFireSimLabEnvironment(environment);
    const weather = createFireSimLabWeather(environment);
    state.climateTemp = weather.climateTemp;
    state.climateMoisture = weather.climateMoisture;
    state.climateIgnitionMultiplier = weather.climateIgnitionMultiplier;
    state.climateSpreadMultiplier = weather.climateSpreadMultiplier;
    const burnoutFactor = weather.climateRisk < 0.25 ? clamp(1 - weather.climateRisk / 0.25, 0, 1) : 0;
    while (remainingSeconds > 0.0001) {
      const deltaSeconds = Math.min(MAX_FIRE_SUBSTEP_SECONDS, remainingSeconds);
      const halfDeltaSeconds = deltaSeconds * 0.5;
      applyFirefighterCooling(state, firefighters, halfDeltaSeconds);
      const active = stepFire(
        state,
        effects,
        rng,
        deltaSeconds * INCIDENT_FIRE_PACING_SCALE,
        state.fireSettings.simSpeed,
        1,
        burnoutFactor,
        weather,
        weather.climateIgnitionMultiplier
      );
      applyFirefighterCooling(state, firefighters, halfDeltaSeconds);
      state.lastActiveFires = active;
      elapsedDays += deltaSeconds;
      remainingSeconds -= deltaSeconds;
    }
    if (effects.smokeParticles.length > 800) {
      effects.smokeParticles.splice(0, effects.smokeParticles.length - 800);
    }
  };

  const step = (seconds: number): void => {
    const realSeconds = Math.max(0, seconds);
    if (realSeconds <= 0) {
      return;
    }
    incidentTickAccumulator = Math.min(
      FIRE_SIM_LAB_INCIDENT_TICK_SECONDS,
      incidentTickAccumulator + realSeconds
    );
    if (incidentTickAccumulator < FIRE_SIM_LAB_INCIDENT_TICK_SECONDS) {
      return;
    }
    incidentTickAccumulator = 0;
    advanceIncidentTick(FIRE_SIM_LAB_INCIDENT_TICK_SECONDS * Math.max(0, environment.simSpeed));
  };

  const getStats = (): FireSimLabStats => {
    const wind = getWindFromFireSimLabEnvironment(environment);
    const origin = ignitionOrigin ?? { x: 0, y: Math.floor(grid.rows * 0.5) };
    let burnedTiles = 0;
    let activeTiles = 0;
    let maxFire = 0;
    let maxHeat = 0;
    let downwindReach = 0;
    for (let idx = 0; idx < state.tiles.length; idx += 1) {
      const tile = state.tiles[idx];
      const fire = state.tileFire[idx] ?? tile.fire;
      const heat = state.tileHeat[idx] ?? tile.heat;
      maxFire = Math.max(maxFire, fire);
      maxHeat = Math.max(maxHeat, heat);
      if (fire > FIRE_EPS) {
        activeTiles += 1;
      }
      if (tile.type === "ash" || state.tileBurnAge[idx] > 0 || tile.fuel <= 0.01 && FUEL_PROFILES[tile.type].baseFuel > 0) {
        burnedTiles += 1;
        const x = idx % grid.cols;
        const y = Math.floor(idx / grid.cols);
        downwindReach = Math.max(downwindReach, (x - origin.x) * wind.dx + (y - origin.y) * wind.dy);
      }
    }
    const burningArea = state.fireBoundsActive
      ? Math.max(0, state.fireMaxX - state.fireMinX + 1) * Math.max(0, state.fireMaxY - state.fireMinY + 1)
      : 0;
    return {
      elapsedDays,
      activeTiles,
      burnedTiles,
      burningArea,
      maxFire,
      maxHeat,
      downwindReach
    };
  };

  const getProfileExportText = (): string =>
    JSON.stringify(
      Object.fromEntries(
        (Object.keys(profiles) as TileType[]).map((type) => [type, profiles[type]])
      ),
      null,
      2
    );

  const cloneProfiles = (): Record<TileType, FuelProfile> =>
    (Object.keys(profiles) as TileType[]).reduce(
      (copy, type) => {
        copy[type] = cloneFuelProfile(profiles[type]);
        return copy;
      },
      {} as Record<TileType, FuelProfile>
    );

  const getScenarioSnapshot = (): FireSimLabScenarioSnapshot => ({
    version: 1,
    sourceScenarioId: scenarioId,
    grid: {
      cols: grid.cols,
      rows: grid.rows
    },
    environment: { ...environment },
    profiles: cloneProfiles(),
    tiles: state.tiles.map((tile, idx) => ({
      type: tile.type,
      fuel: state.tileFuel[idx] ?? tile.fuel,
      fire: state.tileFire[idx] ?? tile.fire,
      heat: state.tileHeat[idx] ?? tile.heat,
      burnAge: state.tileBurnAge[idx] ?? 0,
      heatRelease: state.tileHeatRelease[idx] ?? 0,
      suppressionWetness: state.tileSuppressionWetness[idx] ?? 0,
      ashAge: tile.ashAge ?? 0,
      houseDestroyed: tile.houseDestroyed
    })),
    firefighters: firefighters.map((firefighter) => ({ ...firefighter })),
    elapsedDays,
    ignitionOrigin: ignitionOrigin ? { ...ignitionOrigin } : null
  });

  const loadScenarioSnapshot = (snapshot: FireSimLabScenarioSnapshot): { ok: boolean; message: string } => {
    if (snapshot.grid.cols !== grid.cols || snapshot.grid.rows !== grid.rows || snapshot.tiles.length !== grid.totalTiles) {
      return {
        ok: false,
        message: `Saved scenario grid ${snapshot.grid.cols}x${snapshot.grid.rows} does not match this lab grid ${grid.cols}x${grid.rows}.`
      };
    }
    scenarioId = normalizeFireSimLabScenarioId(snapshot.sourceScenarioId);
    environment = normalizeEnvironment({ ...snapshot.environment });
    firefighters = sanitizeFirefighters(snapshot.firefighters ?? []);
    clearFireBlocks(state);
    resetFireBounds(state);
    resetEffectsState(effects);
    state.tileFire.fill(0);
    state.tileFuel.fill(0);
    state.tileHeat.fill(0);
    state.tileBurnAge.fill(0);
    state.tileHeatRelease.fill(0);
    state.tileSuppressionWetness.fill(0);
    state.tiles = snapshot.tiles.map((saved) => {
      const tile = createLabTile(saved.type);
      applyProfileToTile(tile, profiles[saved.type], environment.moisture, true);
      const shouldPreserveSavedFuel = saved.fire > FIRE_EPS || saved.heat > 0.02 || saved.burnAge > 0;
      if (shouldPreserveSavedFuel) {
        tile.fuel = Math.max(0, saved.fuel);
      }
      tile.fire = clamp(saved.fire, 0, 1);
      tile.heat = clamp(saved.heat, 0, state.fireSettings.heatCap);
      tile.ashAge = Math.max(0, saved.ashAge);
      tile.houseDestroyed = saved.houseDestroyed;
      return tile;
    });
    syncTileSoA(state);
    let activeFires = 0;
    for (let idx = 0; idx < snapshot.tiles.length; idx += 1) {
      const saved = snapshot.tiles[idx]!;
      state.tileBurnAge[idx] = Math.max(0, saved.burnAge);
      state.tileHeatRelease[idx] = Math.max(0, saved.heatRelease);
      state.tileSuppressionWetness[idx] = Math.max(0, saved.suppressionWetness);
      const fire = state.tileFire[idx] ?? 0;
      const heat = state.tileHeat[idx] ?? 0;
      if (fire > FIRE_EPS) {
        activeFires += 1;
      }
      if (fire > FIRE_EPS || heat > 0.02 || state.tileSuppressionWetness[idx] > 0.01) {
        markActive(idx % grid.cols, Math.floor(idx / grid.cols));
      }
    }
    elapsedDays = Math.max(0, snapshot.elapsedDays);
    ignitionOrigin = snapshot.ignitionOrigin ? { ...snapshot.ignitionOrigin } : null;
    state.lastActiveFires = activeFires;
    state.wind = getWindFromFireSimLabEnvironment(environment);
    firefighters.forEach((firefighter) => markFirefighterCoolingAreaActive(state, firefighter));
    applyFireActivityMetrics(state, activeFires);
    return {
      ok: true,
      message: "Scenario loaded."
    };
  };

  resetScenario();

  return {
    state,
    effects,
    getScenario: () => scenarioId,
    setScenario: (nextScenarioId) => {
      scenarioId = normalizeFireSimLabScenarioId(nextScenarioId);
      resetScenario();
    },
    resetScenario,
    getEnvironment: () => ({ ...environment }),
    setEnvironment: (patch) => {
      environment = normalizeEnvironment({ ...environment, ...patch });
      state.wind = getWindFromFireSimLabEnvironment(environment);
      for (const type of Object.keys(profiles) as TileType[]) {
        updateMatchingTiles(type, false);
      }
    },
    getFuelProfile: (type) => cloneFuelProfile(profiles[type]),
    getFuelProfiles: () => cloneProfiles(),
    setFuelProfile: (type, profile) => {
      profiles[type] = cloneFuelProfile(profile);
      updateMatchingTiles(type, true);
    },
    setFuelProfileValue: (type, field, value) => {
      profiles[type] = {
        ...profiles[type],
        [field]: value
      };
      updateMatchingTiles(type, true);
    },
    resetFuelProfile: (type) => {
      profiles[type] = cloneFuelProfile(FUEL_PROFILES[type]);
      updateMatchingTiles(type, true);
    },
    resetAllFuelProfiles: () => {
      profiles = createFuelProfiles();
      resetScenario();
    },
    paintTile,
    igniteTile,
    coolTile,
    toggleFirefighter,
    getFirefighters: () => firefighters.map((firefighter) => ({ ...firefighter })),
    step,
    getStats,
    getProfileExportText,
    getScenarioSnapshot,
    loadScenarioSnapshot
  };
};
