import type { WorldState } from "../../../core/state.js";
import { clamp } from "../../../core/utils.js";
import { indexFor } from "../../../core/grid.js";
import { markFireBlockActiveByTile } from "../../../sim/fire/activeBlocks.js";
import { markFireBounds } from "../../../sim/fire/bounds.js";
import {
  FIRE_SIM_LAB_FIREFIGHTER_COOLING_RADIUS,
  FIRE_SIM_LAB_FIREFIGHTER_HOSE_RANGE,
  FIRE_SIM_LAB_FIREFIGHTER_POWER,
  type FireSimLabFirefighter
} from "../types/fireSimLabTypes.js";

const SUPPRESSION_WETNESS_ACTIVE_EPS = 0.01;
const FIRE_EPS = 0.001;
const HEAT_THREAT_EPS = 0.04;
const DEFENSIVE_PREWET_SCALE = 1.6;
const DEFENSIVE_WETNESS_FLOOR = 0.68;
const HOSE_SUPPRESSION_SCALE = 2.8;

const markCoolingCellActive = (state: WorldState, x: number, y: number, idx: number): void => {
  markFireBounds(state, x, y);
  markFireBlockActiveByTile(state, idx);
};

export const markFirefighterCoolingAreaActive = (
  state: WorldState,
  firefighter: FireSimLabFirefighter
): void => {
  const radius = FIRE_SIM_LAB_FIREFIGHTER_COOLING_RADIUS;
  const centerX = firefighter.x + 0.5;
  const centerY = firefighter.y + 0.5;
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(centerY + radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dist = Math.hypot(centerX - (x + 0.5), centerY - (y + 0.5));
      if (dist <= radius) {
        markCoolingCellActive(state, x, y, indexFor(state.grid, x, y));
      }
    }
  }
};

const resolveFirefighterImpactTarget = (
  state: WorldState,
  firefighter: FireSimLabFirefighter
): { x: number; y: number } | null => {
  const centerX = firefighter.x + 0.5;
  const centerY = firefighter.y + 0.5;
  const hoseRange = FIRE_SIM_LAB_FIREFIGHTER_HOSE_RANGE;
  const minX = Math.max(0, Math.floor(centerX - hoseRange));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(centerX + hoseRange));
  const minY = Math.max(0, Math.floor(centerY - hoseRange));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(centerY + hoseRange));
  const heatCap = Math.max(0.01, state.fireSettings.heatCap);
  let bestScore = 0;
  let bestTarget: { x: number; y: number } | null = null;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(centerX - tileCenterX, centerY - tileCenterY);
      if (dist > hoseRange) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      const fireValue = state.tileFire[idx] ?? tile.fire;
      const heatValue = state.tileHeat[idx] ?? tile.heat;
      const fuelValue = state.tileFuel[idx] ?? tile.fuel;
      const heat01 = Math.max(0, Math.min(1, heatValue / heatCap));
      const ignitionPressure = fuelValue > 0.01 && heatValue >= tile.ignitionPoint * 0.65 ? 0.55 : 0;
      const threat = fireValue * 3.4 + heat01 * 1.15 + ignitionPressure;
      if (fireValue <= FIRE_EPS && heat01 <= HEAT_THREAT_EPS && ignitionPressure <= 0) {
        continue;
      }
      const distanceWeight = 0.35 + Math.max(0, 1 - dist / Math.max(0.0001, hoseRange)) * 0.65;
      const score = threat * distanceWeight;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = { x: tileCenterX, y: tileCenterY };
      }
    }
  }

  return bestTarget;
};

const applySuppressionAtTarget = (
  state: WorldState,
  target: { x: number; y: number },
  powerMultiplier: number,
  wetnessFloor = 0
): void => {
  const radius = FIRE_SIM_LAB_FIREFIGHTER_COOLING_RADIUS;
  const radiusSafe = Math.max(0.0001, radius);
  const minX = Math.max(0, Math.floor(target.x - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(target.x + radius));
  const minY = Math.max(0, Math.floor(target.y - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(target.y + radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(target.x - tileCenterX, target.y - tileCenterY);
      if (dist > radius) {
        continue;
      }

      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      const proximityWeight = Math.max(0, 1 - dist / radiusSafe);
      const wetnessGain = FIRE_SIM_LAB_FIREFIGHTER_POWER * powerMultiplier * (0.75 + proximityWeight * 0.85);
      const maintainedWetness = wetnessFloor > 0 ? wetnessFloor * (0.55 + proximityWeight * 0.45) : 0;
      state.tileSuppressionWetness[idx] = clamp(
        Math.max(maintainedWetness, (state.tileSuppressionWetness[idx] ?? 0) + wetnessGain),
        0,
        1
      );

      let heatValue = state.tileHeat[idx] ?? tile.heat;
      if (heatValue > 0) {
        heatValue = Math.max(
          0,
          heatValue - FIRE_SIM_LAB_FIREFIGHTER_POWER * 1.55 * powerMultiplier * (0.45 + proximityWeight * 0.55)
        );
        if (wetnessFloor > 0) {
          heatValue = Math.min(heatValue, tile.ignitionPoint * (0.35 + (1 - proximityWeight) * 0.3));
        }
        state.tileHeat[idx] = heatValue;
        tile.heat = heatValue;
        state.tileHeatRelease[idx] = Math.max(
          0,
          (state.tileHeatRelease[idx] ?? 0) -
            FIRE_SIM_LAB_FIREFIGHTER_POWER * 0.9 * powerMultiplier * (0.35 + proximityWeight * 0.65)
        );
      }

      let fireValue = state.tileFire[idx] ?? tile.fire;
      if (fireValue > 0) {
        fireValue = Math.max(
          0,
          fireValue - FIRE_SIM_LAB_FIREFIGHTER_POWER * 1.05 * powerMultiplier * (0.45 + proximityWeight * 0.55)
        );
        state.tileFire[idx] = fireValue;
        tile.fire = fireValue;
        if (fireValue > 0) {
          state.tileBurnAge[idx] = Math.max(0, (state.tileBurnAge[idx] ?? 0) - powerMultiplier * 0.6);
          state.tileHeatRelease[idx] = Math.max(0, (state.tileHeatRelease[idx] ?? 0) * (0.72 + proximityWeight * 0.18));
        } else {
          heatValue = Math.min(state.tileHeat[idx] ?? tile.heat, tile.ignitionPoint * 0.25);
          state.tileHeat[idx] = heatValue;
          tile.heat = heatValue;
          state.tileBurnAge[idx] = 0;
          state.tileHeatRelease[idx] = 0;
        }
      }

      if (heatValue > 0.01 || fireValue > FIRE_EPS || state.tileSuppressionWetness[idx] > SUPPRESSION_WETNESS_ACTIVE_EPS) {
        markCoolingCellActive(state, x, y, idx);
      }
    }
  }
};

const applyDefensiveHoseField = (
  state: WorldState,
  firefighter: FireSimLabFirefighter,
  powerMultiplier: number
): void => {
  const centerX = firefighter.x + 0.5;
  const centerY = firefighter.y + 0.5;
  const radius = FIRE_SIM_LAB_FIREFIGHTER_HOSE_RANGE;
  const radiusSafe = Math.max(0.0001, radius);
  const minX = Math.max(0, Math.floor(centerX - radius));
  const maxX = Math.min(state.grid.cols - 1, Math.ceil(centerX + radius));
  const minY = Math.max(0, Math.floor(centerY - radius));
  const maxY = Math.min(state.grid.rows - 1, Math.ceil(centerY + radius));

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(centerX - tileCenterX, centerY - tileCenterY);
      if (dist > radius) {
        continue;
      }

      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      const proximityWeight = Math.max(0, 1 - dist / radiusSafe);
      const maintainedWetness = DEFENSIVE_WETNESS_FLOOR * (0.42 + proximityWeight * 0.58);
      state.tileSuppressionWetness[idx] = clamp(
        Math.max(maintainedWetness, state.tileSuppressionWetness[idx] ?? 0),
        0,
        1
      );

      let heatValue = state.tileHeat[idx] ?? tile.heat;
      if (heatValue > 0) {
        heatValue = Math.max(
          0,
          heatValue - FIRE_SIM_LAB_FIREFIGHTER_POWER * 1.15 * powerMultiplier * (0.25 + proximityWeight * 0.75)
        );
        heatValue = Math.min(heatValue, tile.ignitionPoint * (0.28 + (1 - proximityWeight) * 0.42));
        state.tileHeat[idx] = heatValue;
        tile.heat = heatValue;
      }

      let fireValue = state.tileFire[idx] ?? tile.fire;
      if (fireValue > 0) {
        fireValue = Math.max(
          0,
          fireValue - FIRE_SIM_LAB_FIREFIGHTER_POWER * 0.9 * powerMultiplier * (0.2 + proximityWeight * 0.8)
        );
        state.tileFire[idx] = fireValue;
        tile.fire = fireValue;
        if (fireValue <= FIRE_EPS) {
          state.tileBurnAge[idx] = 0;
          state.tileHeatRelease[idx] = 0;
        }
      }

      if (heatValue > 0.01 || fireValue > FIRE_EPS || state.tileSuppressionWetness[idx] > SUPPRESSION_WETNESS_ACTIVE_EPS) {
        markCoolingCellActive(state, x, y, idx);
      }
    }
  }
};

export const applyFirefighterCooling = (
  state: WorldState,
  firefighters: readonly FireSimLabFirefighter[],
  deltaSeconds: number
): void => {
  const powerMultiplier = Math.max(0, deltaSeconds);
  if (powerMultiplier <= 0 || firefighters.length <= 0) {
    return;
  }

  firefighters.forEach((firefighter) => {
    applyDefensiveHoseField(state, firefighter, powerMultiplier * DEFENSIVE_PREWET_SCALE);
    const impactTarget = resolveFirefighterImpactTarget(state, firefighter);
    if (impactTarget) {
      applySuppressionAtTarget(state, impactTarget, powerMultiplier * HOSE_SUPPRESSION_SCALE);
    } else {
      markFirefighterCoolingAreaActive(state, firefighter);
    }
  });
};

export const applyFirefighterPlacementPrewet = (
  state: WorldState,
  firefighters: readonly FireSimLabFirefighter[],
  deltaSeconds: number
): void => {
  const powerMultiplier = Math.max(0, deltaSeconds);
  if (powerMultiplier <= 0) {
    return;
  }

  firefighters.forEach((firefighter) => {
    applyDefensiveHoseField(state, firefighter, powerMultiplier);
  });
};
