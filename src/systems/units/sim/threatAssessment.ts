import type { Point } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import { TILE_TYPE_IDS } from "../../../core/state.js";
import { inBounds, indexFor } from "../../../core/grid.js";
import {
  FIRE_FOCUS_CLUSTER_RADIUS,
  THREAT_ASSET_RADIUS,
  THREAT_FIRE_EPS,
  THREAT_HOLDOVER_HEAT_EPS,
  THREAT_HOLDOVER_WETNESS_EPS,
  THREAT_NEIGHBOR_DIRS
} from "../constants/runtimeConstants.js";
import { clamp } from "../utils/unitMath.js";

export type SuppressionThreatClass = "burning" | "pending" | "holdover" | "cold";

const isSuppressionIgnitableTypeId = (tid: number): boolean =>
  tid !== TILE_TYPE_IDS.water &&
  tid !== TILE_TYPE_IDS.ash &&
  tid !== TILE_TYPE_IDS.firebreak &&
  tid !== TILE_TYPE_IDS.beach &&
  tid !== TILE_TYPE_IDS.rocky &&
  tid !== TILE_TYPE_IDS.bare &&
  tid !== TILE_TYPE_IDS.road;

export const getSuppressionThreatClass = (state: WorldState, idx: number): SuppressionThreatClass => {
  const fireValue = state.tileFire[idx] ?? 0;
  const heatValue = state.tileHeat[idx] ?? 0;
  const wetnessValue = state.tileSuppressionWetness[idx] ?? 0;
  const scheduled = state.tileIgniteAt[idx] < Number.POSITIVE_INFINITY;
  const ignitionPoint = Math.max(0.0001, state.tileIgnitionPoint[idx] ?? 0.0001);

  if (fireValue > THREAT_FIRE_EPS) {
    return "burning";
  }
  if (scheduled || heatValue >= ignitionPoint * 0.78) {
    return "pending";
  }
  if (
    heatValue >= Math.max(THREAT_HOLDOVER_HEAT_EPS, ignitionPoint * 0.45) ||
    (wetnessValue > THREAT_HOLDOVER_WETNESS_EPS && heatValue > 0.04)
  ) {
    return "holdover";
  }
  return "cold";
};

const getNearbyAssetWeight = (state: WorldState, x: number, y: number): number => {
  let weight = 1;
  for (let dy = -THREAT_ASSET_RADIUS; dy <= THREAT_ASSET_RADIUS; dy += 1) {
    for (let dx = -THREAT_ASSET_RADIUS; dx <= THREAT_ASSET_RADIUS; dx += 1) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inBounds(state.grid, nx, ny)) {
        continue;
      }
      const tid = state.tileTypeId[indexFor(state.grid, nx, ny)] ?? -1;
      if (tid === TILE_TYPE_IDS.base) {
        weight = Math.max(weight, 1.85);
      } else if (tid === TILE_TYPE_IDS.house) {
        weight = Math.max(weight, 1.5);
      }
    }
  }
  return weight;
};

export const getSuppressionThreatScore = (state: WorldState, x: number, y: number): number => {
  const idx = indexFor(state.grid, x, y);
  const threatClass = getSuppressionThreatClass(state, idx);
  if (threatClass === "cold") {
    return 0;
  }

  const fireValue = state.tileFire[idx] ?? 0;
  const heatValue = state.tileHeat[idx] ?? 0;
  const wetnessValue = state.tileSuppressionWetness[idx] ?? 0;
  const scheduled = state.tileIgniteAt[idx] < Number.POSITIVE_INFINITY;
  let burningNeighbors = 0;
  let exposedNeighbors = 0;
  let supportiveNeighbors = 0;

  for (const offset of THREAT_NEIGHBOR_DIRS) {
    const nx = x + offset.dx;
    const ny = y + offset.dy;
    if (!inBounds(state.grid, nx, ny)) {
      continue;
    }
    const nidx = indexFor(state.grid, nx, ny);
    const neighborFire = state.tileFire[nidx] ?? 0;
    const neighborFuel = state.tileFuel[nidx] ?? 0;
    const neighborTypeId = state.tileTypeId[nidx] ?? -1;
    const neighborThreat = getSuppressionThreatClass(state, nidx);
    if (neighborFire > THREAT_FIRE_EPS) {
      burningNeighbors += 1;
      supportiveNeighbors += 1;
    } else if (neighborThreat === "pending" || neighborThreat === "holdover") {
      supportiveNeighbors += 1;
    }
    if (neighborFuel > 0 && isSuppressionIgnitableTypeId(neighborTypeId) && neighborFire <= THREAT_FIRE_EPS) {
      exposedNeighbors += 1;
    }
  }

  const classWeight =
    threatClass === "burning"
      ? 1.3 + fireValue * 1.15
      : threatClass === "pending"
        ? 0.95 + heatValue * 0.82 + (scheduled ? 0.18 : 0)
        : 0.6 + heatValue * 0.45 + wetnessValue * 0.28;
  const assetWeight = getNearbyAssetWeight(state, x, y);
  const flankWeight =
    threatClass === "burning" || threatClass === "pending"
      ? clamp(0.75 + exposedNeighbors * 0.2 - Math.max(0, burningNeighbors - 4) * 0.1, 0.55, 1.8)
      : clamp(0.85 + supportiveNeighbors * 0.08 + exposedNeighbors * 0.06, 0.7, 1.4);
  const continuityWeight = clamp(0.8 + supportiveNeighbors * 0.08, 0.8, 1.5);
  return classWeight * assetWeight * flankWeight * continuityWeight;
};

export const getClusterSuppressionScore = (state: WorldState, centerX: number, centerY: number, radius: number): number => {
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(centerY + radius));
  let total = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(centerX - tileCenterX, centerY - tileCenterY);
      if (dist > radius) {
        continue;
      }
      const threatScore = getSuppressionThreatScore(state, x, y);
      if (threatScore <= 0) {
        continue;
      }
      const falloff = clamp(1 - dist / Math.max(0.0001, radius), 0, 1);
      total += threatScore * (0.28 + falloff * 0.72);
    }
  }
  return total;
};

const refineSuppressionFocus = (state: WorldState, origin: Point, radius: number): Point => {
  const minX = Math.max(0, Math.floor(origin.x - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(origin.x + radius));
  const minY = Math.max(0, Math.floor(origin.y - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(origin.y + radius));
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(origin.x - tileCenterX, origin.y - tileCenterY);
      if (dist > radius) {
        continue;
      }
      const threatScore = getSuppressionThreatScore(state, x, y);
      if (threatScore <= 0) {
        continue;
      }
      const falloff = clamp(1 - dist / Math.max(0.0001, radius), 0, 1);
      const weight = threatScore * (0.35 + falloff * 0.65);
      if (weight <= 0) {
        continue;
      }
      totalWeight += weight;
      weightedX += tileCenterX * weight;
      weightedY += tileCenterY * weight;
    }
  }
  if (totalWeight <= 0.0001) {
    return origin;
  }
  return { x: weightedX / totalWeight, y: weightedY / totalWeight };
};

export const findFireTargetNear = (
  state: WorldState,
  center: Point,
  radius: number,
  preferredFocus: Point | null = null
): Point | null => {
  let best: Point | null = null;
  let bestScore = 0;
  const minX = Math.max(0, Math.floor(center.x - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(center.x + radius));
  const minY = Math.max(0, Math.floor(center.y - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(center.y + radius));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(center.x - tileCenterX, center.y - tileCenterY);
      if (dist > radius) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const fireValue = state.tileFire[idx];
      const heatValue = state.tileHeat[idx];
      if (fireValue <= 0 && heatValue <= 0.05) {
        continue;
      }
      const clusterScore = getClusterSuppressionScore(state, tileCenterX, tileCenterY, FIRE_FOCUS_CLUSTER_RADIUS);
      if (clusterScore <= 0.08) {
        continue;
      }
      const distanceWeight = clamp(1 - dist / Math.max(0.0001, radius), 0, 1);
      const preferredDistance = preferredFocus ? Math.hypot(tileCenterX - preferredFocus.x, tileCenterY - preferredFocus.y) : 0;
      const preferredWeight = preferredFocus
        ? clamp(1 - preferredDistance / Math.max(FIRE_FOCUS_CLUSTER_RADIUS * 2.5, radius * 0.4, 1), 0, 1)
        : 0;
      const score = clusterScore * (0.34 + distanceWeight * 0.66) * (preferredFocus ? 0.86 + preferredWeight * 0.44 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = { x: tileCenterX, y: tileCenterY };
      }
    }
  }
  return best && bestScore > 0.18 ? refineSuppressionFocus(state, best, FIRE_FOCUS_CLUSTER_RADIUS) : null;
};
