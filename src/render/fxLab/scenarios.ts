import type { EffectsState } from "../../core/effectsState.js";
import { TILE_TYPE_IDS, type WorldState } from "../../core/state.js";
import { markTileSoADirty } from "../../core/tileCache.js";
import type { Formation, Tile, Unit, WaterSprayMode } from "../../core/types.js";
import { getFractionalSimulationYear } from "../../systems/settlements/sim/buildingLifecycle.js";
import type { FxLabScenarioId } from "./types.js";

export type FxLabScenarioDefinition = {
  id: FxLabScenarioId;
  label: string;
  description: string;
};

export type FxLabScenarioFrameContext = {
  world: WorldState;
  effects: EffectsState;
  truck: Unit;
  firefighter: Unit;
  timeSeconds: number;
  cols: number;
  rows: number;
  setWind: (dx: number, dy: number, strength: number, name: string) => void;
  placeTruck: (x: number, y: number, formation?: Formation) => void;
  placeFirefighter: (x: number, y: number) => void;
  addFireDisk: (cx: number, cy: number, radius: number, intensity: number, heatScale?: number) => void;
  addFireLine: (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    thickness: number,
    intensity: number,
    heatScale?: number
  ) => void;
  addScheduledRing: (cx: number, cy: number, innerRadius: number, outerRadius: number) => void;
  emitWaterStream: (options: {
    sourceUnitId: number;
    targetX: number;
    targetY: number;
    mode: WaterSprayMode;
    volume: number;
    intensity: number;
    particleCount?: number;
    sweepJitter?: number;
  }) => void;
};

export const FX_LAB_SCENARIOS: ReadonlyArray<FxLabScenarioDefinition> = [
  {
    id: "fire-line",
    label: "Fire Line",
    description: "A diagonal advancing line with active flame fronts and a scheduled shoulder."
  },
  {
    id: "fire-patch",
    label: "Fire Patch",
    description: "A dense core fire with a ring of pending ignition for smoke and glow tuning."
  },
  {
    id: "ocean-shoreline",
    label: "Ocean Shoreline",
    description: "A shoreline-focused calibration view using the live in-game ocean and beach system."
  },
  {
    id: "river-waterfall",
    label: "River Waterfall",
    description: "A narrow stepped river corridor with engine-like 2-3 tile widths, a clear drop, and a plunge pool for waterfall tuning."
  },
  {
    id: "house-lifecycle",
    label: "House Lifecycle",
    description: "Procedural house previews showing frame, roofed, and charred-remains states from the same generator."
  },
  {
    id: "water-precision",
    label: "Water Precision",
    description: "A narrow precision stream against a small target fire."
  },
  {
    id: "water-suppression",
    label: "Water Suppression",
    description: "A heavy suppression stream hitting a larger fire patch."
  },
  {
    id: "water-sweep",
    label: "Water Sweep",
    description: "A moving stream target sweeping across a static fire line for breakup and impact tuning."
  }
];

const pulse = (timeSeconds: number, hz: number, min = 0.84, max = 1.16): number => {
  const t = Math.sin(timeSeconds * hz * Math.PI * 2) * 0.5 + 0.5;
  return min + (max - min) * t;
};

type HousePreviewStage = "frame" | "roofed" | "charred_remains";

type HousePreviewSpec = {
  tileX: number;
  tileY: number;
  stage: HousePreviewStage;
  constructionYearOffset: number;
};

type HousePreviewSnapshotEntry = {
  idx: number;
  tile: Tile;
  tileTypeId: number;
  stage?: HousePreviewStage;
};

const HOUSE_PREVIEW_TARGETS: readonly HousePreviewSpec[] = [
  { tileX: 12, tileY: 30, stage: "frame", constructionYearOffset: 0.06 },
  { tileX: 18, tileY: 30, stage: "roofed", constructionYearOffset: 0.24 },
  { tileX: 24, tileY: 30, stage: "charred_remains", constructionYearOffset: 0.24 }
] as const;
const HOUSE_PREVIEW_PAD = {
  minTileX: 7,
  maxTileX: 29,
  minTileY: 24,
  maxTileY: 36,
  elevation: 0.24
} as const;

let houseLifecyclePreviewSnapshot: HousePreviewSnapshotEntry[] | null = null;

const isHousePreviewableTile = (tileType: string): boolean =>
  tileType === "grass";

const snapshotHousePreviewTile = (world: WorldState, idx: number): HousePreviewSnapshotEntry | null => {
  if (!houseLifecyclePreviewSnapshot) {
    return null;
  }
  const existing = houseLifecyclePreviewSnapshot.find((entry) => entry.idx === idx);
  if (existing) {
    return existing;
  }
  const tile = world.tiles[idx];
  if (!tile) {
    return null;
  }
  const entry: HousePreviewSnapshotEntry = {
    idx,
    tile: { ...tile },
    tileTypeId: world.tileTypeId[idx] ?? TILE_TYPE_IDS.grass
  };
  houseLifecyclePreviewSnapshot.push(entry);
  return entry;
};

const findHousePreviewTile = (world: WorldState, targetX: number, targetY: number, reserved: Set<number>): number | null => {
  const cols = world.grid.cols;
  const rows = world.grid.rows;
  const maxRadius = Math.max(cols, rows);
  for (let radius = 0; radius <= maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) {
          continue;
        }
        const x = targetX + dx;
        const y = targetY + dy;
        if (x < 0 || y < 0 || x >= cols || y >= rows) {
          continue;
        }
        const idx = y * cols + x;
        if (reserved.has(idx)) {
          continue;
        }
        const tile = world.tiles[idx];
        if (!tile || !isHousePreviewableTile(tile.type)) {
          continue;
        }
        reserved.add(idx);
        return idx;
      }
    }
  }
  return null;
};

const stampHousePreview = (
  world: WorldState,
  idx: number,
  stage: HousePreviewStage,
  constructionYearOffset: number
): void => {
  const tile = world.tiles[idx];
  if (!tile) {
    return;
  }
  const currentYear = getFractionalSimulationYear(world.careerDay);
  tile.type = "house";
  tile.isBase = false;
  tile.buildingClass = "residential_low";
  tile.houseValue = 160;
  tile.houseResidents = 2;
  tile.ashAge = 0;
  tile.fuel = Math.max(0.01, tile.fuel);
  tile.fire = 0;
  tile.heat = 0;
  tile.houseDamage01 = stage === "charred_remains" ? 1 : 0;
  tile.houseDestroyed = stage === "charred_remains";
  tile.houseConstructionYear = currentYear - constructionYearOffset;
  tile.dominantTreeType = null;
  tile.treeType = null;
  tile.canopy = 0;
  tile.canopyCover = 0;
  tile.stemDensity = 0;
  tile.vegetationAgeYears = 0;
  world.tileTypeId[idx] = TILE_TYPE_IDS.house;
};

const stampHousePreviewPad = (world: WorldState): void => {
  for (let tileY = HOUSE_PREVIEW_PAD.minTileY; tileY <= HOUSE_PREVIEW_PAD.maxTileY; tileY += 1) {
    for (let tileX = HOUSE_PREVIEW_PAD.minTileX; tileX <= HOUSE_PREVIEW_PAD.maxTileX; tileX += 1) {
      const idx = tileY * world.grid.cols + tileX;
      const tile = world.tiles[idx];
      if (!tile) {
        continue;
      }
      snapshotHousePreviewTile(world, idx);
      tile.elevation = HOUSE_PREVIEW_PAD.elevation;
      if (tile.type !== "base" && tile.type !== "road" && tile.type !== "water") {
        tile.type = "grass";
      }
    }
  }
};

const applyHouseLifecyclePreview = (world: WorldState): void => {
  if (houseLifecyclePreviewSnapshot !== null) {
    return;
  }
  const reserved = new Set<number>();
  houseLifecyclePreviewSnapshot = [];
  stampHousePreviewPad(world);
  for (const target of HOUSE_PREVIEW_TARGETS) {
    const x = Math.max(0, Math.min(world.grid.cols - 1, target.tileX));
    const y = Math.max(0, Math.min(world.grid.rows - 1, target.tileY));
    const idx = findHousePreviewTile(world, x, y, reserved);
    if (idx === null) {
      continue;
    }
    const snapshot = snapshotHousePreviewTile(world, idx);
    if (snapshot) {
      snapshot.stage = target.stage;
    }
    stampHousePreview(world, idx, target.stage, target.constructionYearOffset);
  }
  world.structureRevision += 1;
  world.terrainTypeRevision += 1;
  world.terrainDirty = true;
  markTileSoADirty(world);
};

const restoreHouseLifecyclePreview = (world: WorldState): void => {
  if (houseLifecyclePreviewSnapshot === null) {
    return;
  }
  houseLifecyclePreviewSnapshot.forEach((entry) => {
    Object.assign(world.tiles[entry.idx], entry.tile);
    world.tileTypeId[entry.idx] = entry.tileTypeId;
  });
  houseLifecyclePreviewSnapshot = null;
  world.structureRevision += 1;
  world.terrainTypeRevision += 1;
  world.terrainDirty = true;
  markTileSoADirty(world);
};

export const applyFxLabScenarioFrame = (scenarioId: FxLabScenarioId, ctx: FxLabScenarioFrameContext): void => {
  const { timeSeconds } = ctx;
  if (scenarioId === "house-lifecycle") {
    applyHouseLifecyclePreview(ctx.world);
    return;
  }
  restoreHouseLifecyclePreview(ctx.world);
  if (scenarioId === "fire-line") {
    const linePulse = pulse(timeSeconds, 0.2, 0.86, 1.14);
    ctx.setWind(0.92, -0.24, 0.7, "NE");
    ctx.placeTruck(17.5, 45.5, "medium");
    ctx.placeFirefighter(19.2, 46.3);
    ctx.addFireLine(18, 18, 52, 38, 3.1, 0.82 * linePulse, 3.8);
    ctx.addFireLine(16, 20, 50, 40, 1.6, 0.46 * pulse(timeSeconds + 0.7, 0.26, 0.82, 1.18), 3.1);
    ctx.addFireDisk(44, 33, 5.4, 0.72 * pulse(timeSeconds, 0.33, 0.82, 1.14), 4.4);
    ctx.addScheduledRing(48, 34, 5.8, 8.8);
    return;
  }
  if (scenarioId === "fire-patch") {
    const patchPulse = pulse(timeSeconds, 0.24, 0.9, 1.16);
    ctx.setWind(0.35, -0.94, 0.82, "N");
    ctx.placeTruck(15.5, 43.5, "wide");
    ctx.placeFirefighter(17.1, 44.2);
    ctx.addFireDisk(40, 31, 8.2, 0.88 * patchPulse, 4.8);
    ctx.addFireDisk(38, 29, 5.1, 0.64 * pulse(timeSeconds + 1.2, 0.38, 0.86, 1.18), 4.1);
    ctx.addScheduledRing(40, 31, 8.8, 12.4);
    return;
  }
  if (scenarioId === "ocean-shoreline") {
    ctx.setWind(0.58, -0.81, 0.34, "NE");
    ctx.placeTruck(27.5, 52.5, "medium");
    ctx.placeFirefighter(29.2, 50.7);
    return;
  }
  if (scenarioId === "river-waterfall") {
    ctx.setWind(0.18, -0.98, 0.22, "N");
    ctx.placeTruck(38.8, 44.6, "medium");
    ctx.placeFirefighter(41.2, 42.7);
    ctx.addFireDisk(49.6, 28.8, 2.4, 0.28 * pulse(timeSeconds, 0.2, 0.92, 1.08), 2.6);
    return;
  }
  if (scenarioId === "water-precision") {
    const targetX = 44 + Math.sin(timeSeconds * 0.55) * 1.6;
    const targetY = 34 + Math.cos(timeSeconds * 0.4) * 1.2;
    ctx.setWind(0.44, -0.88, 0.38, "NNE");
    ctx.placeTruck(35.1, 38.2, "narrow");
    ctx.placeFirefighter(36.9, 36.9);
    ctx.addFireDisk(targetX, targetY, 3.2, 0.52 * pulse(timeSeconds, 0.3, 0.84, 1.12), 3.5);
    ctx.emitWaterStream({
      sourceUnitId: ctx.firefighter.id,
      targetX,
      targetY,
      mode: "precision",
      volume: 0.96,
      intensity: 1,
      particleCount: 120,
      sweepJitter: 0.12
    });
    return;
  }
  if (scenarioId === "water-suppression") {
    ctx.setWind(0.82, -0.28, 0.56, "ENE");
    ctx.placeTruck(35.3, 38.7, "wide");
    ctx.placeFirefighter(37.1, 37.3);
    ctx.addFireDisk(45, 34, 5.8, 0.76 * pulse(timeSeconds, 0.24, 0.88, 1.14), 4.2);
    ctx.addScheduledRing(45, 34, 6.4, 8.6);
    ctx.emitWaterStream({
      sourceUnitId: ctx.firefighter.id,
      targetX: 44.5,
      targetY: 34.5,
      mode: "suppression",
      volume: 0.72,
      intensity: 1,
      particleCount: 190,
      sweepJitter: 0.28
    });
    return;
  }
  const sweepTargetX = 42 + Math.sin(timeSeconds * 0.95) * 8.5;
  const sweepTargetY = 32 + Math.cos(timeSeconds * 0.45) * 3.1;
  ctx.setWind(0.68, -0.54, 0.48, "NE");
  ctx.placeTruck(36.3, 37.1, "medium");
  ctx.placeFirefighter(38.1, 35.8);
  ctx.addFireLine(35, 28, 51, 35, 2.2, 0.58 * pulse(timeSeconds, 0.26, 0.88, 1.1), 3.6);
  ctx.addFireDisk(43.5, 32.2, 4.2, 0.46 * pulse(timeSeconds + 0.4, 0.34, 0.86, 1.16), 3.2);
  ctx.emitWaterStream({
    sourceUnitId: ctx.firefighter.id,
    targetX: sweepTargetX,
    targetY: sweepTargetY,
    mode: "balanced",
    volume: 0.78,
    intensity: 1,
    particleCount: 150,
    sweepJitter: 0.24
  });
};
