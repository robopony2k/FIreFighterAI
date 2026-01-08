import type { RNG, Point, Tile, TileType } from "../core/types.js";
import type { WorldState } from "../core/state.js";
import { clamp } from "../core/utils.js";
import { inBounds, indexFor } from "../core/grid.js";
import { applyFuel } from "../core/tiles.js";
import { NEIGHBOR_DIRS } from "../core/config.js";
import { fractalNoise } from "./noise.js";
import { populateCommunities } from "./communities.js";

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

function carveRiverValleys(state: WorldState, rng: RNG, elevationMap: number[]): void {
  state.valleyMap = Array.from({ length: state.grid.totalTiles }, () => 0);
  const riverCount = 3 + Math.floor(rng.next() * 3);
  const maxSteps = state.grid.cols + state.grid.rows;
  for (let r = 0; r < riverCount; r += 1) {
    const source = pickRiverSource(state, rng, elevationMap);
    if (!source) {
      continue;
    }
    const isWet = rng.next() < 0.55;
    const depthBase = isWet ? 0.22 + rng.next() * 0.08 : 0.1 + rng.next() * 0.06;
    const widthBase = isWet ? 3 : 2;
    let current = source;
    let dir: Point | null = null;
    const visited = new Uint8Array(state.grid.totalTiles);
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
        break;
      }
      if (elevationMap[indexFor(state.grid, current.x, current.y)] < 0.12 && rng.next() < 0.35) {
        break;
      }
    }
  }
}

function buildElevationMap(state: WorldState, rng: RNG): number[] {
  const elevationMap = Array.from({ length: state.grid.totalTiles }, () => 0);
  const temp = Array.from({ length: state.grid.totalTiles }, () => 0);
  const centerFactor = Math.min(state.grid.cols, state.grid.rows) / 2;
  const bandAngle = rng.next() * Math.PI;
  const bandDir = { x: Math.cos(bandAngle), y: Math.sin(bandAngle) };
  const bandScale = 16 + rng.next() * 14;
  const bandPhase = rng.next() * Math.PI * 2;
  const bandStrength = 0.18 + rng.next() * 0.1;

  const landCenters = Array.from({ length: 3 }, () => ({
    x: rng.next() * state.grid.cols,
    y: rng.next() * state.grid.rows,
    radius: (Math.min(state.grid.cols, state.grid.rows) * (0.45 + rng.next() * 0.25)) / 2,
    height: 0.28 + rng.next() * 0.28
  }));

  const basinCenters = Array.from({ length: 3 }, () => ({
    x: rng.next() * state.grid.cols,
    y: rng.next() * state.grid.rows,
    radius: (Math.min(state.grid.cols, state.grid.rows) * (0.28 + rng.next() * 0.2)) / 2,
    depth: 0.22 + rng.next() * 0.25
  }));

  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const edgeDist = Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y);
      const edgeFactor = clamp(edgeDist / centerFactor, 0, 1);
      const warpA = fractalNoise(x / 11, y / 11, state.seed + 33);
      const warpB = fractalNoise(x / 11, y / 11, state.seed + 67);
      const warpX = (warpA - 0.5) * 4;
      const warpY = (warpB - 0.5) * 4;
      const nx = x + warpX;
      const ny = y + warpY;
      const macro = fractalNoise(nx / 42, ny / 42, state.seed + 991);
      const mid = fractalNoise(nx / 22, ny / 22, state.seed + 517);
      const detail = fractalNoise(nx / 10, ny / 10, state.seed + 151);
      const ridgeNoise = fractalNoise(nx / 24, ny / 24, state.seed + 703);
      const ridge = 1 - Math.abs(ridgeNoise * 2 - 1);
      const bandCoord = (x * bandDir.x + y * bandDir.y) / bandScale;
      const band = (Math.sin(bandCoord + bandPhase) + 1) * 0.5;
      const bandBoost = (band - 0.5) * bandStrength;
      let elevation = macro * 0.7 + mid * 0.18 + detail * 0.06 + ridge * 0.06;
      elevation += edgeFactor * 0.06;
      elevation = elevation * (0.75 + band * 0.5) + bandBoost;
      let landBoost = 0;
      for (const land of landCenters) {
        const dx = (x - land.x) / land.radius;
        const dy = (y - land.y) / land.radius;
        const d = Math.hypot(dx, dy);
        if (d < 1) {
          landBoost = Math.max(landBoost, (1 - d) * (1 - d) * land.height);
        }
      }
      elevation += landBoost;
      let basinDrop = 0;
      for (const basin of basinCenters) {
        const dx = (x - basin.x) / basin.radius;
        const dy = (y - basin.y) / basin.radius;
        const d = Math.hypot(dx, dy);
        if (d < 1) {
          basinDrop = Math.max(basinDrop, (1 - d) * basin.depth);
        }
      }
      elevation = clamp(elevation - basinDrop, 0, 1);
      elevationMap[indexFor(state.grid, x, y)] = clamp(elevation, 0, 1);
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
    }
    for (let i = 0; i < elevationMap.length; i += 1) {
      elevationMap[i] = temp[i];
    }
  }

  carveRiverValleys(state, rng, elevationMap);

  for (let i = 0; i < elevationMap.length; i += 1) {
    const value = elevationMap[i];
    const shaped = Math.pow(value, 1.35) * (0.55 + value * 0.9);
    const softened = softenPeaks(shaped, 0.88, 2.3);
    elevationMap[i] = clamp(softened, 0, 1);
  }

  return elevationMap;
}

function buildMoistureMap(state: WorldState): number[] {
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
      const elevationFactor = 1 - state.tiles[idx].elevation;
      moisture[idx] = clamp(waterFactor * 0.7 + elevationFactor * 0.3, 0, 1);
    }
  }
  return moisture;
}

function smoothWater(state: WorldState, inputTiles: Tile[]): Tile[] {
  const output = inputTiles.map((tile) => ({ ...tile }));
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
          if (inputTiles[indexFor(state.grid, nx, ny)].type === "water") {
            waterCount += 1;
          }
        }
      }
      const idx = indexFor(state.grid, x, y);
      if (waterCount >= 5) {
        output[idx].type = "water";
      } else if (waterCount <= 2) {
        if (output[idx].type === "water") {
          output[idx].type = "grass";
        }
      }
    }
  }
  return output;
}

function computeWaterDistances(state: WorldState, maxDistance: number): void {
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
  }

  for (let i = 0; i < total; i += 1) {
    state.tiles[i].waterDist = dist[i] === -1 ? maxDistance : Math.min(dist[i], maxDistance);
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

export function generateMap(state: WorldState, rng: RNG): void {
  state.tiles = [];

  const elevationMap = buildElevationMap(state, rng);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const edgeDist = Math.min(x, y, state.grid.cols - 1 - x, state.grid.rows - 1 - y);
      const edgeFactor = clamp(edgeDist / (Math.min(state.grid.cols, state.grid.rows) / 2), 0, 1);
      const elevation = elevationMap[indexFor(state.grid, x, y)];
      const valley = state.valleyMap[indexFor(state.grid, x, y)];
      const micro = fractalNoise(x / 4, y / 4, state.seed + 211);
      const baseWaterThreshold = clamp(0.16 + (1 - edgeFactor) * 0.1 - (micro - 0.5) * 0.05, 0.1, 0.28);
      const riverBias = clamp(valley * 1.8, 0, 0.12);
      const waterThreshold = clamp(baseWaterThreshold + riverBias, 0.1, 0.32);
      const isWater = elevation < waterThreshold;
      const valleyDry = valley > 0.08 && elevation < 0.55;
      const isForest = !valleyDry && (micro > 0.62 || elevation > 0.72);
      const type: TileType = isWater ? "water" : isForest ? "forest" : "grass";
      const canopyBase = isForest ? 0.55 + micro * 0.55 : 0.12 + micro * 0.35 - (valleyDry ? 0.08 : 0);
      const canopy = isWater ? 0 : clamp(canopyBase, 0, 1);
      state.tiles.push({
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
        canopy,
        houseValue: 0,
        houseResidents: 0,
        houseDestroyed: false,
        ashAge: 0
      });
    }
  }

  state.tiles = smoothWater(state, state.tiles);
  state.tiles = smoothWater(state, state.tiles);
  state.tiles = smoothWater(state, state.tiles);
  state.tiles.forEach((tile) => {
    if (tile.type === "water") {
      tile.elevation = Math.min(tile.elevation, 0.22 + rng.next() * 0.04);
      tile.canopy = 0;
    }
  });
  computeWaterDistances(state, 30);

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

  state.totalLandTiles = 0;
  const moistureMap = buildMoistureMap(state);
  state.tiles.forEach((tile, index) => {
    tile.moisture = moistureMap[index];
    applyFuel(tile, moistureMap[index], rng);
    if (tile.type !== "water" && !tile.isBase) {
      state.totalLandTiles += 1;
    }
  });

  state.colorNoiseMap = Array.from({ length: state.grid.totalTiles }, () => 0.5);
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const idx = indexFor(state.grid, x, y);
      const low = fractalNoise(x / 14, y / 14, state.seed + 801);
      const broad = fractalNoise(x / 38, y / 38, state.seed + 1001);
      state.colorNoiseMap[idx] = clamp(low * 0.65 + broad * 0.35, 0, 1);
    }
  }

  state.burnedTiles = 0;
  state.containedCount = 0;
  state.terrainDirty = true;
}

