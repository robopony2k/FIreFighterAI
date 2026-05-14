import { inBounds, indexFor } from "../../../core/grid.js";
import type { WorldState } from "../../../core/state.js";
import type { Point, TileType } from "../../../core/types.js";

type BaseSiteCandidate = Point & {
  distanceFromCenter: number;
  elevation: number;
  localRelief: number;
  waterDistance: number;
  vegetationScore: number;
  score: number;
};

const BASE_DRY_BUFFER = 4;
const LOCAL_RELIEF_RADIUS = 4;
const VEGETATION_RADIUS = 6;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const isVegetatedType = (type: TileType): boolean =>
  type === "forest" || type === "grass" || type === "scrub" || type === "floodplain";

const isBaseFootprintDry = (state: WorldState, x: number, y: number, buffer: number): boolean => {
  if (!inBounds(state.grid, x, y)) {
    return false;
  }
  const center = state.tiles[indexFor(state.grid, x, y)];
  if (!center || center.type === "water") {
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
      const tile = state.tiles[indexFor(state.grid, nx, ny)];
      if (!tile || tile.type === "water") {
        return false;
      }
    }
  }
  return true;
};

const computeLocalRelief = (state: WorldState, x: number, y: number, radius: number): number => {
  const center = state.tiles[indexFor(state.grid, x, y)]?.elevation ?? 0;
  let maxDelta = 0;
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0 || Math.hypot(dx, dy) > radius) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const tile = state.tiles[indexFor(state.grid, nx, ny)];
      if (!tile || tile.type === "water") {
        continue;
      }
      maxDelta = Math.max(maxDelta, Math.abs(center - tile.elevation));
    }
  }
  return maxDelta;
};

const computeVegetationScore = (state: WorldState, x: number, y: number): number => {
  let vegetated = 0;
  let usable = 0;
  for (let dy = -VEGETATION_RADIUS; dy <= VEGETATION_RADIUS; dy += 1) {
    for (let dx = -VEGETATION_RADIUS; dx <= VEGETATION_RADIUS; dx += 1) {
      if (Math.hypot(dx, dy) > VEGETATION_RADIUS) {
        continue;
      }
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const tile = state.tiles[indexFor(state.grid, nx, ny)];
      if (!tile || tile.type === "water" || tile.type === "road" || tile.type === "base" || tile.type === "house") {
        continue;
      }
      usable += 1;
      if (isVegetatedType(tile.type)) {
        vegetated += 1;
      }
    }
  }
  return usable <= 0 ? 0 : vegetated / usable;
};

const scoreCandidate = (
  state: WorldState,
  x: number,
  y: number,
  center: Point,
  maxPreferredRadius: number
): BaseSiteCandidate | null => {
  if (!isBaseFootprintDry(state, x, y, BASE_DRY_BUFFER)) {
    return null;
  }

  const tile = state.tiles[indexFor(state.grid, x, y)];
  if (!tile) {
    return null;
  }

  const distanceFromCenter = Math.hypot(x - center.x, y - center.y);
  const elevation = tile.elevation;
  const localRelief = computeLocalRelief(state, x, y, LOCAL_RELIEF_RADIUS);
  const waterDistance = Math.floor(tile.waterDist ?? 99);
  const vegetationScore = computeVegetationScore(state, x, y);
  const centerScore = 1 - clamp01(distanceFromCenter / Math.max(1, maxPreferredRadius));
  const reliefScore = 1 - clamp01(localRelief / 0.055);
  const elevationScore = 1 - clamp01(Math.abs(elevation - 0.46) / 0.24);
  const highlandPenalty = clamp01((elevation - 0.58) / 0.16);
  const barrenPenalty = 1 - vegetationScore;
  const shorelinePenalty = 1 - clamp01((waterDistance - 3) / 8);
  const roadableScore = reliefScore * (1 - highlandPenalty * 0.8);

  const score =
    centerScore * 1.15
    + roadableScore * 1.75
    + elevationScore * 1.1
    + vegetationScore * 1.15
    - shorelinePenalty * 0.35
    - highlandPenalty * 1.25
    - barrenPenalty * 0.65;

  return {
    x,
    y,
    distanceFromCenter,
    elevation,
    localRelief,
    waterDistance,
    vegetationScore,
    score
  };
};

const findFallbackDrySite = (state: WorldState, center: Point): Point => {
  let best: Point = center;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let y = 0; y < state.grid.rows; y += 1) {
    for (let x = 0; x < state.grid.cols; x += 1) {
      const tile = state.tiles[indexFor(state.grid, x, y)];
      if (!tile || tile.type === "water") {
        continue;
      }
      const distance = Math.hypot(x - center.x, y - center.y);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x, y };
      }
    }
  }
  return best;
};

const isAcceptableForPass = (candidate: BaseSiteCandidate, pass: number): boolean => {
  if (pass === 0) {
    return candidate.localRelief <= 0.045 && candidate.elevation <= 0.62 && candidate.vegetationScore >= 0.28;
  }
  if (pass === 1) {
    return candidate.localRelief <= 0.05 && candidate.elevation <= 0.66 && candidate.vegetationScore >= 0.12;
  }
  if (pass === 2) {
    return candidate.localRelief <= 0.055 && candidate.elevation <= 0.68 && candidate.vegetationScore >= 0.1;
  }
  return true;
};

export const selectBaseSite = (state: WorldState): Point => {
  const center = { x: Math.floor(state.grid.cols / 2), y: Math.floor(state.grid.rows / 2) };
  const minDim = Math.max(1, Math.min(state.grid.cols, state.grid.rows));
  const passRadii = [0.18, 0.28, 0.34, 0.48].map((ratio) => Math.max(BASE_DRY_BUFFER + 1, minDim * ratio));

  for (let pass = 0; pass < passRadii.length; pass += 1) {
    const radius = passRadii[pass]!;
    let best: BaseSiteCandidate | null = null;
    let bestAcceptable: BaseSiteCandidate | null = null;
    const minX = Math.max(BASE_DRY_BUFFER, Math.floor(center.x - radius));
    const maxX = Math.min(state.grid.cols - BASE_DRY_BUFFER - 1, Math.ceil(center.x + radius));
    const minY = Math.max(BASE_DRY_BUFFER, Math.floor(center.y - radius));
    const maxY = Math.min(state.grid.rows - BASE_DRY_BUFFER - 1, Math.ceil(center.y + radius));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        if (Math.hypot(x - center.x, y - center.y) > radius) {
          continue;
        }
        const candidate = scoreCandidate(state, x, y, center, radius);
        if (!candidate) {
          continue;
        }
        if (
          !best ||
          candidate.score > best.score ||
          Math.abs(candidate.score - best.score) <= 1e-7 && candidate.distanceFromCenter < best.distanceFromCenter
        ) {
          best = candidate;
        }
        if (
          isAcceptableForPass(candidate, pass) &&
          (
            !bestAcceptable ||
            candidate.score > bestAcceptable.score ||
            Math.abs(candidate.score - bestAcceptable.score) <= 1e-7 && candidate.distanceFromCenter < bestAcceptable.distanceFromCenter
          )
        ) {
          bestAcceptable = candidate;
        }
      }
    }
    const selected = bestAcceptable ?? (pass > 2 ? best : null);
    if (selected) {
      return { x: selected.x, y: selected.y };
    }
  }

  return findFallbackDrySite(state, center);
};
