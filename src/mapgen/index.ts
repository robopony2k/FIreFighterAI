import type { RNG, Point, Tile, TileType } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { clamp } from "../core/utils.js";
import { inBounds, indexFor } from "../core/grid.js";
import { applyFuel } from "../core/tiles.js";
import { NEIGHBOR_DIRS } from "../core/config.js";
import { fractalNoise } from "./noise.js";
import { populateCommunities } from "./communities.js";
import { DEFAULT_MAP_GEN_SETTINGS, type MapGenSettings } from "./settings.js";

export type MapGenReporter = (message: string, progress: number) => void | Promise<void>;

const nextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });

const createYield = (maxIterations = 32) => {
  let lastYield = typeof performance !== "undefined" ? performance.now() : Date.now();
  let iterations = 0;
  return async (): Promise<boolean> => {
    iterations += 1;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastYield < 12 && iterations < maxIterations) {
      return false;
    }
    iterations = 0;
    lastYield = now;
    await nextFrame();
    return true;
  };
};

const WARP_WAVELENGTH_M = 1000;
const WARP_MAG_M = 80;
const MACRO_WAVELENGTH_M = 9000;
const MID_WAVELENGTH_M = 3500;
const DETAIL_WAVELENGTH_M = 1200;
const RIDGE_WAVELENGTH_M = 4200;
const BAND_SCALE_BASE_M = 2000;
const BAND_SCALE_RANGE_M = 2000;

const getWorldX = (settings: MapGenSettings, x: number): number => settings.worldOffsetXM + x * settings.cellSizeM;
const getWorldY = (settings: MapGenSettings, y: number): number => settings.worldOffsetYM + y * settings.cellSizeM;

type TileClassificationInput = {
  elevation: number;
  slope: number;
  waterDistM: number;
  valley: number;
  moisture: number;
  forestNoise: number;
  seaLevel: number;
  forestThreshold: number;
};

function classifyTile(input: TileClassificationInput): TileType {
  const { elevation, slope, waterDistM, valley, moisture, forestNoise, seaLevel, forestThreshold } = input;
  if (elevation < seaLevel) {
    return "water";
  }
  if (waterDistM <= 30 && slope < 0.15) {
    return "beach";
  }
  const isFloodplain = valley > 0.08 && slope < 0.12 && elevation < seaLevel + 0.15;
  if (isFloodplain) {
    return "floodplain";
  }
  if (slope > 0.45 && elevation > seaLevel + 0.25) {
    return "rocky";
  }
  if (elevation > seaLevel + 0.35 && moisture < 0.25 && slope <= 0.45) {
    return "bare";
  }
  if (moisture > 0.45 && slope < 0.35 && forestNoise > forestThreshold && !isFloodplain) {
    return "forest";
  }
  if (moisture > 0.3) {
    return "scrub";
  }
  return "grass";
}

function softenPeaks(value: number, cap: number, softness: number): number {
  if (value <= cap) {
    return value;
  }
  const excess = value - cap;
  return cap + (1 - cap) * (1 - Math.exp(-excess * softness));
}

function pickRiverSource(state: WorldState, rng: RNG, elevationMap: number[]): Point | null {
  let best: Point | null = null;
  let bestElev = 0;
  for (let i = 0; i < 120; i += 1) {
    const x = 4 + Math.floor(rng.next() * (state.grid.cols - 8));
    const y = 4 + Math.floor(rng.next() * (state.grid.rows - 8));
    const elev = elevationMap[indexFor(state.grid, x, y)];
    if (elev > bestElev) {
      bestElev = elev;
      best = { x, y };
    }
  }
  if (best && bestElev > 0.45) {
    return best;
  }
  return null;
}

function carveRiverValleys(
  state: WorldState,
  rng: RNG,
  elevationMap: number[],
  riverMask: Uint8Array,
  valleyDepth: number
): void {
  state.valleyMap = Array.from({ length: state.grid.totalTiles }, () => 0);
  const riverCount = 3 + Math.floor(rng.next() * 3);
  const maxSteps = state.grid.cols + state.grid.rows;
  for (let r = 0; r < riverCount; r += 1) {
    const source = pickRiverSource(state, rng, elevationMap);
    if (!source) {
      continue;
    }
    const isWet = rng.next() < 0.55;
    const depthBase = (isWet ? 0.22 + rng.next() * 0.08 : 0.1 + rng.next() * 0.06) * valleyDepth;
    const widthBase = isWet ? 3 : 2;
    let current = source;
    let dir: Point | null = null;
    const visited = new Uint8Array(state.grid.totalTiles);
    const riverMarks: number[] = [];
    let reachedEdge = false;
    for (let step = 0; step < maxSteps; step += 1) {
      const idx = indexFor(state.grid, current.x, current.y);
      if (visited[idx]) {
        break;
      }
      visited[idx] = 1;
      const width = widthBase + (rng.next() < 0.25 ? 1 : 0);
      for (let dy = -width; dy <= width; dy += 1) {
        for (let dx = -width; dx <= width; dx += 1) {
          const nx = current.x + dx;
          const ny = current.y + dy;
          if (!inBounds(state.grid, nx, ny)) {
            continue;
          }
          const dist = Math.hypot(dx, dy);
          if (dist > width + 0.1) {
            continue;
          }
          const falloff = 1 - dist / (width + 0.5);
          const depth = depthBase * falloff;
          const nIdx = indexFor(state.grid, nx, ny);
          elevationMap[nIdx] = clamp(elevationMap[nIdx] - depth, 0, 1);
          state.valleyMap[nIdx] = Math.max(state.valleyMap[nIdx], depth);
          riverMarks.push(nIdx);
        }
      }

      let next: Point | null = null;
      let bestScore = Number.POSITIVE_INFINITY;
      for (const dirStep of NEIGHBOR_DIRS) {
        const nx = current.x + dirStep.x;
        const ny = current.y + dirStep.y;
        if (!inBounds(state.grid, nx, ny)) {
          continue;
        }
        const nIdx = indexFor(state.grid, nx, ny);
        if (visited[nIdx]) {
          continue;
        }
        const currentElev = elevationMap[idx];
        const nextElev = elevationMap[nIdx];
        const slope = nextElev - currentElev;
        let score = nextElev + rng.next() * 0.03;
        if (slope > 0) {
          score += slope * 1.8;
        }
        if (dir) {
          const dot = dir.x * dirStep.x + dir.y * dirStep.y;
          if (dot < 0) {
            score += 0.08;
          } else if (dot === 0) {
            score += 0.03;
          }
        }
        if (score < bestScore) {
          bestScore = score;
          next = { x: nx, y: ny };
        }
      }
      if (!next) {
        break;
      }
      dir = { x: next.x - current.x, y: next.y - current.y };
      current = next;
      if (
        current.x <= 1 ||
        current.y <= 1 ||
        current.x >= state.grid.cols - 2 ||
        current.y >= state.grid.rows - 2
      ) {
        reachedEdge = true;
        break;
      }
    }
    if (reachedEdge) {
      for (const idx of riverMarks) {
        riverMask[idx] = 1;
      }
    }
  }
}

async function buildElevationMap(
  state: WorldState,
  rng: RNG,
  settings: MapGenSettings,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>
): Promise<{ elevationMap: number[]; riverMask: Uint8Array }> {
  const maxDim = Math.max(state.grid.cols, state.grid.rows);
  const elevationBlock = maxDim >= 1024 ? 8 : maxDim >= 512 ? 4 : 2;
  if (elevationBlock > 1) {
    return buildElevationMapCoarse(state, rng, elevationBlock, settings, report, yieldIfNeeded);
  }
  const elevationMap = Array.from({ length: state.grid.totalTiles }, () => 0);
  const temp = Array.from({ length: state.grid.totalTiles }, () => 0);
  const riverMask = new Uint8Array(state.grid.totalTiles);
  const cellSizeM = Math.max(0.1, settings.cellSizeM);
  const worldOffsetXM = settings.worldOffsetXM;
  const worldOffsetYM = settings.worldOffsetYM;
  const worldWidthM = state.grid.cols * cellSizeM;
  const worldHeightM = state.grid.rows * cellSizeM;
  const minDimM = Math.min(worldWidthM, worldHeightM);
  const elevationScale = clamp(settings.elevationScale, 0.6, 3);
  const elevationExponent = clamp(settings.elevationExponent, 0.6, 2.6);
  const mountainScale = clamp(settings.mountainScale, 0.6, 2.6);
  const ridgeStrength = clamp(settings.ridgeStrength, 0, 0.35);
  const valleyDepth = clamp(settings.valleyDepth, 0.4, 3);
  const centerFactorM = minDimM / 2;
  const warpScaleM = WARP_WAVELENGTH_M * mountainScale;
  const macroScaleM = MACRO_WAVELENGTH_M * mountainScale;
  const midScaleM = MID_WAVELENGTH_M * mountainScale;
  const detailScaleM = DETAIL_WAVELENGTH_M * mountainScale;
  const ridgeScaleM = RIDGE_WAVELENGTH_M * mountainScale;
  const bandAngle = rng.next() * Math.PI;
  const bandDir = { x: Math.cos(bandAngle), y: Math.sin(bandAngle) };
  const bandScaleM = (BAND_SCALE_BASE_M + rng.next() * BAND_SCALE_RANGE_M) * mountainScale;
  const bandPhase = rng.next() * Math.PI * 2;
  const bandStrength = 0.18 + rng.next() * 0.1;

  const landCenters = Array.from({ length: 3 }, () => ({
    x: worldOffsetXM + rng.next() * worldWidthM,
    y: worldOffsetYM + rng.next() * worldHeightM,
    radius: (minDimM * (0.45 + rng.next() * 0.25)) / 2,
    height: 0.28 + rng.next() * 0.28
  }));

  const basinCenters = Array.from({ length: 2 + Math.floor(rng.next() * 2) }, () => ({
    x: worldOffsetXM + rng.next() * worldWidthM,
    y: worldOffsetYM + rng.next() * worldHeightM,
    radius: (minDimM * (0.22 + rng.next() * 0.18)) / 2,
    depth: (0.12 + rng.next() * 0.18) * valleyDepth
  }));
  const macroWeight = 0.7;
  const midWeight = 0.18;
  const detailWeight = 0.06;
  const weightSum = macroWeight + midWeight + detailWeight + ridgeStrength;

  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const edgeDistM =
        Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y) * cellSizeM;
      const edgeFactor = clamp(edgeDistM / centerFactorM, 0, 1);
      const worldX = worldOffsetXM + x * cellSizeM;
      const worldY = worldOffsetYM + y * cellSizeM;
      const warpA = fractalNoise(worldX / warpScaleM, worldY / warpScaleM, state.seed + 33);
      const warpB = fractalNoise(worldX / warpScaleM, worldY / warpScaleM, state.seed + 67);
      const warpX = (warpA - 0.5) * WARP_MAG_M;
      const warpY = (warpB - 0.5) * WARP_MAG_M;
      const worldNX = worldX + warpX;
      const worldNY = worldY + warpY;
      const macro = fractalNoise(worldNX / macroScaleM, worldNY / macroScaleM, state.seed + 991);
      const mid = fractalNoise(worldNX / midScaleM, worldNY / midScaleM, state.seed + 517);
      const detail = fractalNoise(worldNX / detailScaleM, worldNY / detailScaleM, state.seed + 151);
      const ridgeNoise = fractalNoise(worldNX / ridgeScaleM, worldNY / ridgeScaleM, state.seed + 703);
      const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
      const bandCoord = (worldX * bandDir.x + worldY * bandDir.y) / bandScaleM;
      const band = (Math.sin(bandCoord + bandPhase) + 1) * 0.5;
      const bandBoost = (band - 0.5) * bandStrength;
      let elevation = (macro * macroWeight + mid * midWeight + detail * detailWeight + ridge * ridgeStrength) / weightSum;
      elevation += edgeFactor * 0.06;
      elevation = elevation * (0.75 + band * 0.5) + bandBoost;
      let landBoost = 0;
      for (const land of landCenters) {
        const dx = (worldX - land.x) / land.radius;
        const dy = (worldY - land.y) / land.radius;
        const d = Math.hypot(dx, dy);
        if (d < 1) {
          landBoost = Math.max(landBoost, (1 - d) * (1 - d) * land.height);
        }
      }
      elevation += landBoost;
      let basinDrop = 0;
      for (const basin of basinCenters) {
        const dx = (worldX - basin.x) / basin.radius;
        const dy = (worldY - basin.y) / basin.radius;
        const d = Math.hypot(dx, dy);
        if (d < 1) {
          basinDrop = Math.max(basinDrop, (1 - d) * basin.depth);
        }
      }
      elevation = clamp(elevation - basinDrop, 0, 1);
      elevationMap[indexFor(state.grid, x, y)] = clamp(elevation, 0, 1);
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Reticulating splines...", (y + 1) / state.grid.rows * 0.55);
      }
    }
  }

  for (let pass = 0; pass < 4; pass += 1) {
    for (let y = 0; y < state.grid.rows; y += 1) {
      for (let x = 0; x < state.grid.cols; x += 1) {
        const idx = indexFor(state.grid, x, y);
        let neighborSum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nx = x + dx;
            const ny = y + dy;
            if (!inBounds(state.grid, nx, ny)) {
              continue;
            }
            neighborSum += elevationMap[indexFor(state.grid, nx, ny)];
            count += 1;
          }
        }
        const avg = count > 0 ? neighborSum / count : elevationMap[idx];
        temp[idx] = clamp(elevationMap[idx] * 0.42 + avg * 0.58, 0, 1);
      }
      if (yieldIfNeeded && report) {
        if (await yieldIfNeeded()) {
          const passProgress = (pass + (y + 1) / state.grid.rows) / 4;
          await report("Smoothing terrain...", 0.55 + passProgress * 0.25);
        }
      }
    }
    for (let i = 0; i < elevationMap.length; i += 1) {
      elevationMap[i] = temp[i];
    }
  }

  if (report) {
    await report("Carving rivers...", 0.8);
  }
  carveRiverValleys(state, rng, elevationMap, riverMask, valleyDepth);

  for (let i = 0; i < elevationMap.length; i += 1) {
    const value = elevationMap[i];
    const shaped = Math.pow(value, elevationExponent) * (0.55 + value * 0.9);
    const scaled = shaped * elevationScale;
    const softened = softenPeaks(scaled, 0.88, 2.3);
    elevationMap[i] = clamp(softened, 0, 1);
    if (yieldIfNeeded && report && i % state.grid.cols === state.grid.cols - 1) {
      if (await yieldIfNeeded()) {
        const row = Math.floor(i / state.grid.cols);
        await report("Softening peaks...", 0.9 + (row + 1) / state.grid.rows * 0.1);
      }
    }
  }

  return { elevationMap, riverMask };
}

const assertDeterministicElevation = async (
  state: WorldState,
  rng: RNG & { getState: () => number; setState: (state: number) => void },
  settings: MapGenSettings,
  samples = 64
): Promise<void> => {
  const rngState = rng.getState();
  const first = await buildElevationMap(state, rng, settings);
  rng.setState(rngState);
  const second = await buildElevationMap(state, rng, settings);
  const limit = Math.min(samples, first.elevationMap.length, second.elevationMap.length);
  for (let i = 0; i < limit; i += 1) {
    if (first.elevationMap[i] !== second.elevationMap[i]) {
      throw new Error(`Elevation determinism check failed at ${i}.`);
    }
  }
};

async function buildElevationMapCoarse(
  state: WorldState,
  rng: RNG,
  blockSize: number,
  settings: MapGenSettings,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>
): Promise<{ elevationMap: number[]; riverMask: Uint8Array }> {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const coarseCols = Math.ceil(cols / blockSize);
  const coarseRows = Math.ceil(rows / blockSize);
  const coarseTotal = coarseCols * coarseRows;
  const coarseElevation = Array.from({ length: coarseTotal }, () => 0);
  const coarseTemp = Array.from({ length: coarseTotal }, () => 0);
  const coarseRiverMask = new Uint8Array(coarseTotal);
  const cellSizeM = Math.max(0.1, settings.cellSizeM);
  const worldOffsetXM = settings.worldOffsetXM;
  const worldOffsetYM = settings.worldOffsetYM;
  const worldWidthM = cols * cellSizeM;
  const worldHeightM = rows * cellSizeM;
  const minDimM = Math.min(worldWidthM, worldHeightM);
  const elevationScale = clamp(settings.elevationScale, 0.6, 3);
  const elevationExponent = clamp(settings.elevationExponent, 0.6, 2.6);
  const mountainScale = clamp(settings.mountainScale, 0.6, 2.6);
  const ridgeStrength = clamp(settings.ridgeStrength, 0, 0.35);
  const valleyDepth = clamp(settings.valleyDepth, 0.4, 3);
  const centerFactorM = minDimM / 2;
  const warpScaleM = WARP_WAVELENGTH_M * mountainScale;
  const macroScaleM = MACRO_WAVELENGTH_M * mountainScale;
  const midScaleM = MID_WAVELENGTH_M * mountainScale;
  const detailScaleM = DETAIL_WAVELENGTH_M * mountainScale;
  const ridgeScaleM = RIDGE_WAVELENGTH_M * mountainScale;
  const bandAngle = rng.next() * Math.PI;
  const bandDir = { x: Math.cos(bandAngle), y: Math.sin(bandAngle) };
  const bandScaleM = (BAND_SCALE_BASE_M + rng.next() * BAND_SCALE_RANGE_M) * mountainScale;
  const bandPhase = rng.next() * Math.PI * 2;
  const bandStrength = 0.18 + rng.next() * 0.1;

  const landCenters = Array.from({ length: 3 }, () => ({
    x: worldOffsetXM + rng.next() * worldWidthM,
    y: worldOffsetYM + rng.next() * worldHeightM,
    radius: (minDimM * (0.45 + rng.next() * 0.25)) / 2,
    height: 0.28 + rng.next() * 0.28
  }));

  const basinCenters = Array.from({ length: 2 + Math.floor(rng.next() * 2) }, () => ({
    x: worldOffsetXM + rng.next() * worldWidthM,
    y: worldOffsetYM + rng.next() * worldHeightM,
    radius: (minDimM * (0.22 + rng.next() * 0.18)) / 2,
    depth: (0.12 + rng.next() * 0.18) * valleyDepth
  }));

  const macroWeight = 0.7;
  const midWeight = 0.18;
  const detailWeight = 0.06;
  const weightSum = macroWeight + midWeight + detailWeight + ridgeStrength;
  const peakWeight = 0.65;
  const sampleOffsets = [
    { x: 0.25, y: 0.25 },
    { x: 0.75, y: 0.25 },
    { x: 0.25, y: 0.75 },
    { x: 0.75, y: 0.75 },
    { x: 0.5, y: 0.5 }
  ];
  const sampleElevationAt = (sampleX: number, sampleY: number): number => {
    const edgeDistM = Math.min(sampleX, sampleY, cols - 1 - sampleX, rows - 1 - sampleY) * cellSizeM;
    const edgeFactor = clamp(edgeDistM / centerFactorM, 0, 1);
    const worldX = worldOffsetXM + sampleX * cellSizeM;
    const worldY = worldOffsetYM + sampleY * cellSizeM;
    const warpA = fractalNoise(worldX / warpScaleM, worldY / warpScaleM, state.seed + 33);
    const warpB = fractalNoise(worldX / warpScaleM, worldY / warpScaleM, state.seed + 67);
    const warpX = (warpA - 0.5) * WARP_MAG_M;
    const warpY = (warpB - 0.5) * WARP_MAG_M;
    const worldNX = worldX + warpX;
    const worldNY = worldY + warpY;
    const macro = fractalNoise(worldNX / macroScaleM, worldNY / macroScaleM, state.seed + 991);
    const mid = fractalNoise(worldNX / midScaleM, worldNY / midScaleM, state.seed + 517);
    const detail = fractalNoise(worldNX / detailScaleM, worldNY / detailScaleM, state.seed + 151);
    const ridgeNoise = fractalNoise(worldNX / ridgeScaleM, worldNY / ridgeScaleM, state.seed + 703);
    const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
    const bandCoord = (worldX * bandDir.x + worldY * bandDir.y) / bandScaleM;
    const band = (Math.sin(bandCoord + bandPhase) + 1) * 0.5;
    const bandBoost = (band - 0.5) * bandStrength;
    let elevation =
      (macro * macroWeight + mid * midWeight + detail * detailWeight + ridge * ridgeStrength) / weightSum;
    elevation += edgeFactor * 0.06;
    elevation = elevation * (0.75 + band * 0.5) + bandBoost;
    let landBoost = 0;
    for (const land of landCenters) {
      const dx = (worldX - land.x) / land.radius;
      const dy = (worldY - land.y) / land.radius;
      const d = Math.hypot(dx, dy);
      if (d < 1) {
        landBoost = Math.max(landBoost, (1 - d) * (1 - d) * land.height);
      }
    }
    elevation += landBoost;
    let basinDrop = 0;
    for (const basin of basinCenters) {
      const dx = (worldX - basin.x) / basin.radius;
      const dy = (worldY - basin.y) / basin.radius;
      const d = Math.hypot(dx, dy);
      if (d < 1) {
        basinDrop = Math.max(basinDrop, (1 - d) * basin.depth);
      }
    }
    elevation = clamp(elevation - basinDrop, 0, 1);
    return elevation;
  };

  for (let cy = 0; cy < coarseRows; cy += 1) {
    const startY = cy * blockSize;
    const height = Math.min(blockSize, rows - startY);
    for (let cx = 0; cx < coarseCols; cx += 1) {
      const startX = cx * blockSize;
      const width = Math.min(blockSize, cols - startX);
      let sum = 0;
      let count = 0;
      let maxValue = 0;
      for (const offset of sampleOffsets) {
        const sampleX = Math.min(cols - 1, startX + width * offset.x);
        const sampleY = Math.min(rows - 1, startY + height * offset.y);
        const elevation = sampleElevationAt(sampleX, sampleY);
        sum += elevation;
        count += 1;
        if (elevation > maxValue) {
          maxValue = elevation;
        }
      }
      const avg = count > 0 ? sum / count : 0;
      const blended = avg * (1 - peakWeight) + maxValue * peakWeight;
      coarseElevation[cy * coarseCols + cx] = clamp(blended, 0, 1);
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Reticulating splines...", (cy + 1) / coarseRows * 0.55);
      }
    }
  }

  const smoothPasses = blockSize >= 4 ? 2 : 3;
  for (let pass = 0; pass < smoothPasses; pass += 1) {
    for (let cy = 0; cy < coarseRows; cy += 1) {
      for (let cx = 0; cx < coarseCols; cx += 1) {
        const idx = cy * coarseCols + cx;
        let neighborSum = 0;
        let count = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= coarseCols || ny >= coarseRows) {
              continue;
            }
            neighborSum += coarseElevation[ny * coarseCols + nx];
            count += 1;
          }
        }
        const avg = count > 0 ? neighborSum / count : coarseElevation[idx];
        coarseTemp[idx] = clamp(coarseElevation[idx] * 0.42 + avg * 0.58, 0, 1);
      }
      if (yieldIfNeeded && report) {
        if (await yieldIfNeeded()) {
          const passProgress = (pass + (cy + 1) / coarseRows) / smoothPasses;
          await report("Smoothing terrain...", 0.55 + passProgress * 0.25);
        }
      }
    }
    for (let i = 0; i < coarseElevation.length; i += 1) {
      coarseElevation[i] = coarseTemp[i];
    }
  }

  if (report) {
    await report("Carving rivers...", 0.8);
  }
  const coarseState = {
    grid: { cols: coarseCols, rows: coarseRows, totalTiles: coarseTotal },
    valleyMap: Array.from({ length: coarseTotal }, () => 0),
    seed: state.seed
  } as WorldState;
  carveRiverValleys(coarseState, rng, coarseElevation, coarseRiverMask, valleyDepth);

  for (let i = 0; i < coarseElevation.length; i += 1) {
    const value = coarseElevation[i];
    const shaped = Math.pow(value, elevationExponent) * (0.55 + value * 0.9);
    const scaled = shaped * elevationScale;
    const softened = softenPeaks(scaled, 0.88, 2.3);
    coarseElevation[i] = clamp(softened, 0, 1);
    if (yieldIfNeeded && report && i % coarseCols === coarseCols - 1) {
      if (await yieldIfNeeded()) {
        const row = Math.floor(i / coarseCols);
        await report("Softening peaks...", 0.9 + (row + 1) / coarseRows * 0.1);
      }
    }
  }

  const elevationMap = Array.from({ length: state.grid.totalTiles }, () => 0);
  const riverMask = new Uint8Array(state.grid.totalTiles);
  state.valleyMap = Array.from({ length: state.grid.totalTiles }, () => 0);
  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    const cy = Math.floor(y / blockSize);
    const coarseRowBase = cy * coarseCols;
    for (let x = 0; x < cols; x += 1) {
      const cx = Math.floor(x / blockSize);
      const coarseIdx = coarseRowBase + cx;
      const idx = rowBase + x;
      elevationMap[idx] = coarseElevation[coarseIdx];
      state.valleyMap[idx] = coarseState.valleyMap[coarseIdx] ?? 0;
      if (coarseRiverMask[coarseIdx]) {
        riverMask[idx] = 1;
      }
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Reticulating splines...", 0.55 + (y + 1) / rows * 0.05);
      }
    }
  }

  return { elevationMap, riverMask };
}

async function buildMoistureMap(
  state: WorldState,
  maxWaterDistance: number,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>
): Promise<number[]> {
  const moisture = Array.from({ length: state.grid.totalTiles }, () => 0);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      let waterCount = 0;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(state.grid, nx, ny)) {
            continue;
          }
          if (state.tiles[indexFor(state.grid, nx, ny)].type === "water") {
            waterCount += 1;
          }
        }
      }
      const idx = indexFor(state.grid, x, y);
      const waterFactor = clamp(waterCount / 12, 0, 1);
      const tile = state.tiles[idx];
      const elevationFactor = 1 - tile.elevation;
      const waterDistFactor = clamp(1 - tile.waterDist / maxWaterDistance, 0, 1);
      const distBoost = Math.sqrt(waterDistFactor);
      const valleyBoost = clamp(state.valleyMap[idx] / 0.12, 0, 1);
      moisture[idx] = clamp(
        waterFactor * 0.3 + distBoost * 0.35 + elevationFactor * 0.25 + valleyBoost * 0.1,
        0,
        1
      );
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Mapping moisture...", (y + 1) / state.grid.rows);
      }
    }
  }
  return moisture;
}

async function smoothWater(
  state: WorldState,
  inputTiles: Tile[],
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>
): Promise<Tile[]> {
  const total = inputTiles.length;
  const inputTypes = new Array<TileType>(total);
  for (let i = 0; i < total; i += 1) {
    inputTypes[i] = inputTiles[i].type;
  }
  const outputTypes = inputTypes.slice();
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      let waterCount = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) {
            continue;
          }
          const nx = x + dx;
          const ny = y + dy;
          if (!inBounds(state.grid, nx, ny)) {
            waterCount += 1;
            continue;
          }
          if (inputTypes[indexFor(state.grid, nx, ny)] === "water") {
            waterCount += 1;
          }
        }
      }
      const idx = indexFor(state.grid, x, y);
      if (waterCount >= 5) {
        outputTypes[idx] = "water";
      } else if (waterCount <= 2 && inputTypes[idx] === "water") {
        outputTypes[idx] = "grass";
      }
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Softening shoreline...", (y + 1) / state.grid.rows);
      }
    }
  }
  for (let i = 0; i < total; i += 1) {
    inputTiles[i].type = outputTypes[i];
  }
  return inputTiles;
}

async function computeWaterDistances(
  state: WorldState,
  maxDistance: number,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>
): Promise<void> {
  const maxDim = Math.max(state.grid.cols, state.grid.rows);
  if (maxDim >= 1024) {
    const total = state.grid.totalTiles;
    for (let i = 0; i < total; i += 1) {
      const tile = state.tiles[i];
      tile.waterDist = tile.type === "water" ? 0 : maxDistance;
    }
    if (report) {
      await report("Charting shoreline distance...", 1);
    }
    return;
  }
  const coarseFactor = maxDim >= 768 ? 4 : 1;
  if (coarseFactor > 1) {
    await computeWaterDistancesCoarse(state, maxDistance, coarseFactor, report, yieldIfNeeded);
    return;
  }
  const total = state.grid.totalTiles;
  const dist = new Int16Array(total);
  dist.fill(-1);
  const queue = new Int32Array(total);
  let head = 0;
  let tail = 0;
  for (let i = 0; i < total; i += 1) {
    if (state.tiles[i].type === "water") {
      dist[i] = 0;
      queue[tail] = i;
      tail += 1;
    }
  }

  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];

  const reportStride = Math.max(1024, state.grid.cols);
  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const currentDist = dist[idx];
    if (currentDist >= maxDistance) {
      continue;
    }
    const x = idx % state.grid.cols;
    const y = Math.floor(idx / state.grid.cols);
    for (const dir of dirs) {
      const nx = x + dir.x;
      const ny = y + dir.y;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const nIdx = indexFor(state.grid, nx, ny);
      if (dist[nIdx] !== -1) {
        continue;
      }
      dist[nIdx] = currentDist + 1;
      queue[tail] = nIdx;
      tail += 1;
    }
    if (yieldIfNeeded && report && head % reportStride === 0) {
      if (await yieldIfNeeded()) {
        await report("Charting shoreline distance...", Math.min(1, head / total));
      }
    }
  }

  for (let i = 0; i < total; i += 1) {
    state.tiles[i].waterDist = dist[i] === -1 ? maxDistance : Math.min(dist[i], maxDistance);
  }
}

async function computeWaterDistancesCoarse(
  state: WorldState,
  maxDistance: number,
  factor: number,
  report?: MapGenReporter,
  yieldIfNeeded?: () => Promise<boolean>
): Promise<void> {
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const coarseCols = Math.ceil(cols / factor);
  const coarseRows = Math.ceil(rows / factor);
  const coarseTotal = coarseCols * coarseRows;
  const dist = new Int16Array(coarseTotal);
  dist.fill(-1);
  const queue = new Int32Array(coarseTotal);
  let head = 0;
  let tail = 0;
  const maxCoarseDistance = Math.max(1, Math.ceil(maxDistance / factor));

  for (let cy = 0; cy < coarseRows; cy += 1) {
    const startY = cy * factor;
    const endY = Math.min(rows, startY + factor);
    for (let cx = 0; cx < coarseCols; cx += 1) {
      const startX = cx * factor;
      const endX = Math.min(cols, startX + factor);
      let hasWater = false;
      for (let y = startY; y < endY && !hasWater; y += 1) {
        const rowBase = y * cols;
        for (let x = startX; x < endX; x += 1) {
          if (state.tiles[rowBase + x].type === "water") {
            hasWater = true;
            break;
          }
        }
      }
      if (hasWater) {
        const idx = cy * coarseCols + cx;
        dist[idx] = 0;
        queue[tail] = idx;
        tail += 1;
      }
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Charting shoreline distance...", Math.min(1, (cy + 1) / coarseRows));
      }
    }
  }

  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 }
  ];
  const reportStride = Math.max(256, coarseCols * 2);

  while (head < tail) {
    const idx = queue[head];
    head += 1;
    const currentDist = dist[idx];
    if (currentDist >= maxCoarseDistance) {
      continue;
    }
    const x = idx % coarseCols;
    const y = Math.floor(idx / coarseCols);
    for (const dir of dirs) {
      const nx = x + dir.x;
      const ny = y + dir.y;
      if (nx < 0 || ny < 0 || nx >= coarseCols || ny >= coarseRows) {
        continue;
      }
      const nIdx = ny * coarseCols + nx;
      if (dist[nIdx] !== -1) {
        continue;
      }
      dist[nIdx] = currentDist + 1;
      queue[tail] = nIdx;
      tail += 1;
    }
    if (yieldIfNeeded && report && head % reportStride === 0) {
      if (await yieldIfNeeded()) {
        await report("Charting shoreline distance...", Math.min(1, head / coarseTotal));
      }
    }
  }

  for (let y = 0; y < rows; y += 1) {
    const rowBase = y * cols;
    const cy = Math.floor(y / factor);
    const coarseRowBase = cy * coarseCols;
    for (let x = 0; x < cols; x += 1) {
      const tile = state.tiles[rowBase + x];
      const cx = Math.floor(x / factor);
      const coarseDist = dist[coarseRowBase + cx];
      let waterDist = coarseDist === -1 ? maxDistance : Math.min(maxDistance, coarseDist * factor);
      if (tile.type === "water") {
        waterDist = 0;
      }
      tile.waterDist = waterDist;
    }
    if (yieldIfNeeded && report) {
      if (await yieldIfNeeded()) {
        await report("Charting shoreline distance...", Math.min(1, (y + 1) / rows));
      }
    }
  }
}

function isBaseCandidate(state: WorldState, x: number, y: number, buffer: number): boolean {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  if (state.tiles[indexFor(state.grid, x, y)].type === "water") {
    return false;
  }
  for (let dy = -buffer; dy <= buffer; dy += 1) {
    for (let dx = -buffer; dx <= buffer; dx += 1) {
      if (Math.hypot(dx, dy) > buffer) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        return false;
      }
      if (state.tiles[indexFor(state.grid, nx, ny)].type === "water") {
        return false;
      }
    }
  }
  return true;
}

function findBasePoint(state: WorldState): Point {
  const center = { x: Math.floor(state.grid.cols / 2), y: Math.floor(state.grid.rows / 2) };
  const buffer = 4;
  if (isBaseCandidate(state, center.x, center.y, buffer)) {
    return center;
  }
  const maxRadius = Math.max(state.grid.cols, state.grid.rows);
  for (let radius = 1; radius < maxRadius; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.abs(dx) !== radius && Math.abs(dy) !== radius) {
          continue;
        }
        const x = center.x + dx;
        const y = center.y + dy;
        if (isBaseCandidate(state, x, y, buffer)) {
          return { x, y };
        }
      }
    }
  }
  return center;
}

function flattenSettlementGround(state: WorldState): void {
  const tiles = state.tiles;
  const cols = state.grid.cols;
  const rows = state.grid.rows;
  const total = state.grid.totalTiles;
  const visited = new Uint8Array(total);
  const flattened = new Uint8Array(total);
  const softenSum = new Float32Array(total);
  const softenCount = new Uint8Array(total);
  const queue = new Int32Array(total);
  const component: number[] = [];
  const radius = 2;

  for (let i = 0; i < total; i += 1) {
    if (visited[i]) {
      continue;
    }
    const type = tiles[i].type;
    if (type !== "house" && type !== "base") {
      continue;
    }
    let head = 0;
    let tail = 0;
    queue[tail] = i;
    tail += 1;
    visited[i] = 1;
    component.length = 0;
    let sum = 0;

    while (head < tail) {
      const idx = queue[head];
      head += 1;
      component.push(idx);
      sum += tiles[idx].elevation;
      const x = idx % cols;
      const y = Math.floor(idx / cols);
      if (x > 0) {
        const nIdx = idx - 1;
        if (!visited[nIdx]) {
          const nType = tiles[nIdx].type;
          if (nType === "house" || nType === "base") {
            visited[nIdx] = 1;
            queue[tail] = nIdx;
            tail += 1;
          }
        }
      }
      if (x < cols - 1) {
        const nIdx = idx + 1;
        if (!visited[nIdx]) {
          const nType = tiles[nIdx].type;
          if (nType === "house" || nType === "base") {
            visited[nIdx] = 1;
            queue[tail] = nIdx;
            tail += 1;
          }
        }
      }
      if (y > 0) {
        const nIdx = idx - cols;
        if (!visited[nIdx]) {
          const nType = tiles[nIdx].type;
          if (nType === "house" || nType === "base") {
            visited[nIdx] = 1;
            queue[tail] = nIdx;
            tail += 1;
          }
        }
      }
      if (y < rows - 1) {
        const nIdx = idx + cols;
        if (!visited[nIdx]) {
          const nType = tiles[nIdx].type;
          if (nType === "house" || nType === "base") {
            visited[nIdx] = 1;
            queue[tail] = nIdx;
            tail += 1;
          }
        }
      }
    }

    if (component.length === 0) {
      continue;
    }
    const target = clamp(sum / component.length, 0, 1);
    component.forEach((idx) => {
      tiles[idx].elevation = target;
      flattened[idx] = 1;
    });

    component.forEach((idx) => {
      const cx = idx % cols;
      const cy = Math.floor(idx / cols);
      for (let dy = -radius; dy <= radius; dy += 1) {
        const ny = cy + dy;
        if (ny < 0 || ny >= rows) {
          continue;
        }
        const maxDx = radius - Math.abs(dy);
        const rowBase = ny * cols;
        for (let dx = -maxDx; dx <= maxDx; dx += 1) {
          const nx = cx + dx;
          if (nx < 0 || nx >= cols) {
            continue;
          }
          const nIdx = rowBase + nx;
          if (tiles[nIdx].type === "road") {
            tiles[nIdx].elevation = target;
            flattened[nIdx] = 1;
          }
        }
      }
    });
  }

  for (let i = 0; i < total; i += 1) {
    if (!flattened[i]) {
      continue;
    }
    const x = i % cols;
    const y = Math.floor(i / cols);
    const target = tiles[i].elevation;
    if (x > 0) {
      const nIdx = i - 1;
      const nType = tiles[nIdx].type;
      if (!flattened[nIdx] && nType !== "water" && nType !== "road" && nType !== "house" && nType !== "base") {
        softenSum[nIdx] += target;
        softenCount[nIdx] += 1;
      }
    }
    if (x < cols - 1) {
      const nIdx = i + 1;
      const nType = tiles[nIdx].type;
      if (!flattened[nIdx] && nType !== "water" && nType !== "road" && nType !== "house" && nType !== "base") {
        softenSum[nIdx] += target;
        softenCount[nIdx] += 1;
      }
    }
    if (y > 0) {
      const nIdx = i - cols;
      const nType = tiles[nIdx].type;
      if (!flattened[nIdx] && nType !== "water" && nType !== "road" && nType !== "house" && nType !== "base") {
        softenSum[nIdx] += target;
        softenCount[nIdx] += 1;
      }
    }
    if (y < rows - 1) {
      const nIdx = i + cols;
      const nType = tiles[nIdx].type;
      if (!flattened[nIdx] && nType !== "water" && nType !== "road" && nType !== "house" && nType !== "base") {
        softenSum[nIdx] += target;
        softenCount[nIdx] += 1;
      }
    }
  }

  for (let i = 0; i < total; i += 1) {
    const count = softenCount[i];
    if (count === 0) {
      continue;
    }
    const type = tiles[i].type;
    if (type === "water" || type === "road" || type === "house" || type === "base") {
      continue;
    }
    const avg = softenSum[i] / count;
    tiles[i].elevation = clamp(tiles[i].elevation * 0.6 + avg * 0.4, 0, 1);
  }
}

export async function generateMap(
  state: WorldState,
  rng: RNG,
  report?: MapGenReporter,
  settings?: MapGenSettings
): Promise<void> {
  const yieldIfNeeded = createYield();
  const mapSettings = { ...DEFAULT_MAP_GEN_SETTINGS, ...(settings ?? {}) };
  const cellSizeM = Math.max(0.1, mapSettings.cellSizeM);
  const worldOffsetXM = mapSettings.worldOffsetXM;
  const worldOffsetYM = mapSettings.worldOffsetYM;
  const microScaleM = Math.max(1, mapSettings.microScaleM);
  const forestMacroScaleM = Math.max(1, mapSettings.forestMacroScale * cellSizeM);
  const forestDetailScaleM = Math.max(1, mapSettings.forestDetailScale * cellSizeM);
  const meadowScaleM = Math.max(1, mapSettings.meadowScale * cellSizeM);
  const minDimM = Math.min(state.grid.cols, state.grid.rows) * cellSizeM;
  const edgeDenomM = minDimM / 2;
  const maxDim = Math.max(state.grid.cols, state.grid.rows);
  const biomeBlock = maxDim >= 1024 ? 8 : maxDim >= 512 ? 4 : 2;
  state.tiles = new Array(state.grid.totalTiles);
  if (report) {
    await report("Reticulating splines...", 0);
  }

  type BiomeSample = {
    micro: number;
    forestNoise: number;
    meadowMask: number;
  };

  const { elevationMap, riverMask } = await buildElevationMap(state, rng, mapSettings, report ? async (message, progress) => {
    await report(message, progress * 0.6);
  } : undefined, yieldIfNeeded);

  const slopeMap = new Float32Array(state.grid.totalTiles);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const e = elevationMap[idx];
      let maxDiff = 0;
      if (y > 0) {
        maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx - state.grid.cols]));
      }
      if (y < state.grid.rows - 1) {
        maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx + state.grid.cols]));
      }
      if (x > 0) {
        maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx - 1]));
      }
      if (x < state.grid.cols - 1) {
        maxDiff = Math.max(maxDiff, Math.abs(e - elevationMap[idx + 1]));
      }
      slopeMap[idx] = clamp(maxDiff, 0, 1);
    }
  }

  const blockCols = Math.ceil(state.grid.cols / biomeBlock);
  const blockRows = Math.ceil(state.grid.rows / biomeBlock);
  let biomeSamples: BiomeSample[] | null = null;
  if (biomeBlock > 1) {
    biomeSamples = new Array(blockCols * blockRows);
    for (let by = 0; by < blockRows; by += 1) {
      const sampleY = (by + 0.5) * biomeBlock;
      for (let bx = 0; bx < blockCols; bx += 1) {
        const sampleX = (bx + 0.5) * biomeBlock;
        const worldX = worldOffsetXM + sampleX * cellSizeM;
        const worldY = worldOffsetYM + sampleY * cellSizeM;
        const micro = fractalNoise(worldX / microScaleM, worldY / microScaleM, state.seed + 211);
        const forestMacro = fractalNoise(
          worldX / forestMacroScaleM,
          worldY / forestMacroScaleM,
          state.seed + 415
        );
        const forestDetail = fractalNoise(
          worldX / forestDetailScaleM,
          worldY / forestDetailScaleM,
          state.seed + 619
        );
        const forestNoise = forestMacro * 0.75 + forestDetail * 0.25;
        const meadowNoise = fractalNoise(
          worldX / meadowScaleM,
          worldY / meadowScaleM,
          state.seed + 933
        );
        const meadowMask = clamp(
          (meadowNoise - mapSettings.meadowThreshold) / (1 - mapSettings.meadowThreshold),
          0,
          1
        );
        biomeSamples[by * blockCols + bx] = {
          micro,
          forestNoise,
          meadowMask
        };
      }
      if (report && (await yieldIfNeeded())) {
        await report("Seeding biomes...", 0.6 + (by + 1) / blockRows * 0.02);
      }
    }
  }

  const totalTiles = state.grid.totalTiles;
  const microMap = new Float32Array(totalTiles);
  const forestNoiseMap = new Float32Array(totalTiles);
  const meadowMaskMap = new Float32Array(totalTiles);
  const seaLevelMap = new Float32Array(totalTiles);

  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const edgeDistM =
        Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y) * cellSizeM;
      const edgeFactor = clamp(edgeDistM / edgeDenomM, 0, 1);
      const idx = indexFor(state.grid, x, y);
      const elevation = elevationMap[idx];
      const valley = state.valleyMap[idx];
      let micro = 0.5;
      let forestNoise = 0.5;
      let meadowMask = 0;
      if (biomeBlock > 1 && biomeSamples) {
        const bx = Math.floor(x / biomeBlock);
        const by = Math.floor(y / biomeBlock);
        const sample = biomeSamples[by * blockCols + bx];
        micro = sample.micro;
        forestNoise = sample.forestNoise;
        meadowMask = sample.meadowMask;
      } else {
        const worldX = worldOffsetXM + x * cellSizeM;
        const worldY = worldOffsetYM + y * cellSizeM;
        micro = fractalNoise(worldX / microScaleM, worldY / microScaleM, state.seed + 211);
        const forestMacro = fractalNoise(
          worldX / forestMacroScaleM,
          worldY / forestMacroScaleM,
          state.seed + 415
        );
        const forestDetail = fractalNoise(
          worldX / forestDetailScaleM,
          worldY / forestDetailScaleM,
          state.seed + 619
        );
        forestNoise = forestMacro * 0.75 + forestDetail * 0.25;
        const meadowNoise = fractalNoise(worldX / meadowScaleM, worldY / meadowScaleM, state.seed + 933);
        meadowMask = clamp(
          (meadowNoise - mapSettings.meadowThreshold) / (1 - mapSettings.meadowThreshold),
          0,
          1
        );
      }
      microMap[idx] = micro;
      forestNoiseMap[idx] = forestNoise;
      meadowMaskMap[idx] = meadowMask;

      const riverFlag = riverMask[idx] > 0;
      const riverBias = riverFlag ? mapSettings.riverWaterBias + valley * 0.08 : 0;
      const seaLevel = clamp(
        mapSettings.baseWaterThreshold + (1 - edgeFactor) * mapSettings.edgeWaterBias + riverBias,
        0.08,
        0.34
      );
      seaLevelMap[idx] = seaLevel;

      const type: TileType = elevation < seaLevel ? "water" : "grass";
      state.tiles[idx] = {
        type,
        fuel: 0,
        fire: 0,
        isBase: false,
        elevation,
        heat: 0,
        ignitionPoint: 0,
        burnRate: 0,
        heatOutput: 0,
        spreadBoost: 0,
        heatTransferCap: 0,
        heatRetention: 1,
        windFactor: 0,
        moisture: 0,
        waterDist: 0,
        canopy: 0,
        houseValue: 0,
        houseResidents: 0,
        houseDestroyed: false,
        ashAge: 0
      };
    }
    if (report && (await yieldIfNeeded())) {
      await report("Seeding biomes...", 0.6 + (y + 1) / state.grid.rows * 0.12);
    }
  }

  const waterDistanceCap = 30;
  if (report) {
    await report("Charting shoreline distance...", 0.72);
  }
  await computeWaterDistances(
    state,
    waterDistanceCap,
    report
      ? async (message, progress) => {
          await report(message, 0.72 + progress * 0.08);
        }
      : undefined,
    yieldIfNeeded
  );

  const moistureMap = await buildMoistureMap(
    state,
    waterDistanceCap,
    report
      ? async (message, progress) => {
          await report(message, 0.8 + progress * 0.08);
        }
      : undefined,
    yieldIfNeeded
  );

  for (let i = 0; i < state.tiles.length; i += 1) {
    const tile = state.tiles[i];
    const elevation = tile.elevation;
    const valley = state.valleyMap[i];
    const slope = slopeMap[i];
    const seaLevel = seaLevelMap[i];
    const moisture = moistureMap[i];
    const forestNoise = forestNoiseMap[i];
    const waterDistM = tile.waterDist * cellSizeM;
    const nextType = classifyTile({
      elevation,
      slope,
      waterDistM,
      valley,
      moisture,
      forestNoise,
      seaLevel,
      forestThreshold: mapSettings.forestThreshold
    });
    tile.type = nextType;
    tile.moisture = moisture;

    if (nextType === "water") {
      tile.elevation = Math.min(tile.elevation, 0.22 + rng.next() * 0.04);
      tile.canopy = 0;
    } else if (nextType === "forest" || nextType === "grass" || nextType === "scrub" || nextType === "floodplain") {
      const micro = microMap[i];
      const meadowMask = meadowMaskMap[i];
      const grassCanopyBase =
        (mapSettings.grassCanopyBase + micro * mapSettings.grassCanopyRange) *
        (1 - meadowMask * mapSettings.meadowStrength);
      const valleyDry = valley > 0.1 && elevation < 0.6;
      const canopyBase = nextType === "forest" ? 0.55 + micro * 0.55 : grassCanopyBase - (valleyDry ? 0.08 : 0);
      tile.canopy = clamp(canopyBase, 0, 1);
    } else {
      tile.canopy = 0;
    }

    if (yieldIfNeeded && report && i % state.grid.cols === state.grid.cols - 1) {
      if (await yieldIfNeeded()) {
        const row = Math.floor(i / state.grid.cols);
        await report("Classifying terrain...", 0.88 + (row + 1) / state.grid.rows * 0.05);
      }
    }
  }

  if (report) {
    await report("Placing communities...", 0.93);
  }
  state.basePoint = findBasePoint(state);

  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const nx = state.basePoint.x + x;
      const ny = state.basePoint.y + y;
      if (inBounds(state.grid, nx, ny) && Math.hypot(x, y) <= 2.2) {
        const idx = indexFor(state.grid, nx, ny);
        state.tiles[idx].type = "base";
        state.tiles[idx].isBase = true;
      }
    }
  }

  populateCommunities(state, rng);
  flattenSettlementGround(state);

  state.totalLandTiles = 0;
  state.tiles.forEach((tile) => {
    applyFuel(tile, tile.moisture, rng);
    if (tile.type !== "water" && !tile.isBase) {
      state.totalLandTiles += 1;
    }
  });

  state.colorNoiseMap = Array.from({ length: state.grid.totalTiles }, () => 0.5);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const worldX = getWorldX(mapSettings, x);
      const worldY = getWorldY(mapSettings, y);
      const low = fractalNoise(worldX / (14 * cellSizeM), worldY / (14 * cellSizeM), state.seed + 801);
      const broad = fractalNoise(worldX / (38 * cellSizeM), worldY / (38 * cellSizeM), state.seed + 1001);
      state.colorNoiseMap[idx] = clamp(low * 0.65 + broad * 0.35, 0, 1);
    }
    if (report && (await yieldIfNeeded())) {
      await report("Coloring terrain...", 0.97 + (y + 1) / state.grid.rows * 0.03);
    }
  }

  state.burnedTiles = 0;
  state.containedCount = 0;
  state.terrainDirty = true;
  if (report) {
    await report("Finalizing map...", 1);
  }
}

