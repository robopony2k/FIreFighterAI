import type { Point, RNG, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import type { EffectsState } from "../../../core/effectsState.js";
import { SUPPRESSION_WETNESS_BLOCK_THRESHOLD } from "../../../core/config.js";
import { indexFor } from "../../../core/grid.js";
import { emitWaterSpray } from "../../../sim/particles.js";
import { markFireBlockActiveByTile } from "../../../sim/fire/activeBlocks.js";
import { THREAT_FIRE_EPS } from "../constants/runtimeConstants.js";
import { clamp } from "../utils/unitMath.js";
import { canUnitSpray, spendUnitWater } from "./commandRuntime.js";
import { getClusterSuppressionScore, getSuppressionThreatClass, getSuppressionThreatScore } from "./threatAssessment.js";
import { setSprayTarget } from "./unitPathing.js";

type SuppressionProfile = {
  radius: number;
  power: number;
  suppressionRadius: number;
  hoseRange: number;
  wetness: number;
};

const getSuppressionProfile = (unit: Unit): SuppressionProfile => {
  let radius = unit.radius;
  let power = unit.power;
  let hoseRange = unit.hoseRange;
  let wetness = 1;

  if (unit.kind === "firefighter") {
    switch (unit.formation) {
      case "narrow":
        radius *= 0.95;
        power *= 1.45;
        hoseRange *= 1.15;
        wetness *= 0.85;
        break;
      case "wide":
        radius *= 1.35;
        power *= 0.9;
        wetness *= 1.25;
        break;
      case "medium":
      default:
        break;
    }
  }

  const suppressionRadius = radius + 0.18;
  return {
    radius,
    power,
    suppressionRadius,
    hoseRange: Math.max(suppressionRadius + 0.5, hoseRange),
    wetness
  };
};

const resolvePreferredAim = (unit: Unit): Point | null =>
  unit.attackTarget ??
  unit.sprayTarget ??
  (unit.target && unit.pathIndex < unit.path.length
    ? {
        x: unit.target.x + 0.5,
        y: unit.target.y + 0.5
      }
    : null);

const resolveSuppressionImpactTarget = (
  state: WorldState,
  unit: Unit,
  profile: SuppressionProfile
): Point | null => {
  const preferredAim = resolvePreferredAim(unit);
  let forwardDirX = 1;
  let forwardDirY = 0;
  if (preferredAim) {
    const aimMag = Math.hypot(preferredAim.x - unit.x, preferredAim.y - unit.y);
    if (aimMag > 0.0001) {
      forwardDirX = (preferredAim.x - unit.x) / aimMag;
      forwardDirY = (preferredAim.y - unit.y) / aimMag;
    }
  }

  const searchMinX = Math.max(0, Math.floor(unit.x - profile.hoseRange));
  const searchMaxX = Math.min(state.grid.cols - 1, Math.ceil(unit.x + profile.hoseRange));
  const searchMinY = Math.max(0, Math.floor(unit.y - profile.hoseRange));
  const searchMaxY = Math.min(state.grid.rows - 1, Math.ceil(unit.y + profile.hoseRange));
  let bestTarget: Point | null = null;
  let bestScore = 0;

  for (let y = searchMinY; y <= searchMaxY; y += 1) {
    for (let x = searchMinX; x <= searchMaxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(unit.x - tileCenterX, unit.y - tileCenterY);
      if (dist > profile.hoseRange) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const threatClass = getSuppressionThreatClass(state, idx);
      if (threatClass === "cold") {
        continue;
      }
      const threatScore = getSuppressionThreatScore(state, x, y);
      if (threatScore <= 0) {
        continue;
      }
      const forwardDot =
        dist > 0.0001 ? ((tileCenterX - unit.x) * forwardDirX + (tileCenterY - unit.y) * forwardDirY) / dist : 1;
      if (preferredAim && forwardDot < -0.05) {
        continue;
      }
      const forwardWeight = preferredAim ? clamp((forwardDot + 0.1) / 1.1, 0, 1) : 1;
      if (forwardWeight <= 0) {
        continue;
      }
      const distanceWeight = clamp(1 - dist / Math.max(0.0001, profile.hoseRange), 0, 1);
      const targetDistance = preferredAim ? Math.hypot(tileCenterX - preferredAim.x, tileCenterY - preferredAim.y) : 0;
      const targetWeight =
        preferredAim ? clamp(1 - targetDistance / Math.max(profile.hoseRange * 0.9, 0.0001), 0, 1) : 1;
      const areaScore = getClusterSuppressionScore(
        state,
        tileCenterX,
        tileCenterY,
        Math.max(1.05, Math.min(2.1, profile.suppressionRadius * 1.15))
      );
      const areaWeight = clamp(areaScore / 4.2, 0, 1);
      const stickyDistance = unit.sprayTarget
        ? Math.hypot(tileCenterX - unit.sprayTarget.x, tileCenterY - unit.sprayTarget.y)
        : 0;
      const stickyWeight = unit.sprayTarget
        ? clamp(1 - stickyDistance / Math.max(profile.hoseRange * 0.5, profile.suppressionRadius * 2, 0.9), 0, 1)
        : 0;
      const threatPriority = threatClass === "burning" ? 1.2 : threatClass === "pending" ? 0.9 : 0.68;
      const combinedWeight =
        (0.28 + forwardWeight * 0.72) *
        (0.3 + distanceWeight * 0.7) *
        (0.42 + areaWeight * 0.58) *
        (0.34 + targetWeight * 0.66) *
        (unit.sprayTarget ? 0.84 + stickyWeight * 0.52 : 1);
      const score = threatScore * threatPriority * combinedWeight;
      if (score > bestScore) {
        bestScore = score;
        bestTarget = { x: tileCenterX, y: tileCenterY };
      }
    }
  }

  const rawImpactTarget = bestTarget;
  if (!rawImpactTarget) {
    return null;
  }

  const refineRadius = Math.max(1.1, Math.min(profile.suppressionRadius * 1.55, profile.hoseRange * 0.42));
  const refineMinX = Math.max(0, Math.floor(rawImpactTarget.x - refineRadius));
  const refineMaxX = Math.min(state.grid.cols - 1, Math.ceil(rawImpactTarget.x + refineRadius));
  const refineMinY = Math.max(0, Math.floor(rawImpactTarget.y - refineRadius));
  const refineMaxY = Math.min(state.grid.rows - 1, Math.ceil(rawImpactTarget.y + refineRadius));
  let refinedWeightTotal = 0;
  let refinedTargetX = 0;
  let refinedTargetY = 0;

  for (let y = refineMinY; y <= refineMaxY; y += 1) {
    for (let x = refineMinX; x <= refineMaxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const distToCenter = Math.hypot(rawImpactTarget.x - tileCenterX, rawImpactTarget.y - tileCenterY);
      if (distToCenter > refineRadius) {
        continue;
      }
      const threatScore = getSuppressionThreatScore(state, x, y);
      if (threatScore <= 0) {
        continue;
      }
      const distanceWeight = clamp(1 - distToCenter / Math.max(0.0001, refineRadius), 0, 1);
      const stickyDistance = unit.sprayTarget
        ? Math.hypot(tileCenterX - unit.sprayTarget.x, tileCenterY - unit.sprayTarget.y)
        : 0;
      const stickyWeight = unit.sprayTarget
        ? clamp(1 - stickyDistance / Math.max(refineRadius * 2.1, 0.9), 0, 1)
        : 0;
      const weight = threatScore * distanceWeight * (unit.sprayTarget ? 0.9 + stickyWeight * 0.24 : 1);
      if (weight <= 0) {
        continue;
      }
      refinedWeightTotal += weight;
      refinedTargetX += tileCenterX * weight;
      refinedTargetY += tileCenterY * weight;
    }
  }

  return refinedWeightTotal > 0.0001
    ? { x: refinedTargetX / refinedWeightTotal, y: refinedTargetY / refinedWeightTotal }
    : rawImpactTarget;
};

const applySuppressionAtTarget = (
  state: WorldState,
  unit: Unit,
  impactTarget: Point,
  profile: SuppressionProfile,
  powerMultiplier: number,
  suppressionTimestamp: number
): void => {
  const impactMinX = Math.max(0, Math.floor(impactTarget.x - profile.suppressionRadius));
  const impactMaxX = Math.min(state.grid.cols - 1, Math.ceil(impactTarget.x + profile.suppressionRadius));
  const impactMinY = Math.max(0, Math.floor(impactTarget.y - profile.suppressionRadius));
  const impactMaxY = Math.min(state.grid.rows - 1, Math.ceil(impactTarget.y + profile.suppressionRadius));
  const radiusSafe = Math.max(0.0001, profile.suppressionRadius);

  for (let y = impactMinY; y <= impactMaxY; y += 1) {
    for (let x = impactMinX; x <= impactMaxX; x += 1) {
      const tileCenterX = x + 0.5;
      const tileCenterY = y + 0.5;
      const dist = Math.hypot(impactTarget.x - tileCenterX, impactTarget.y - tileCenterY);
      if (dist > profile.suppressionRadius) {
        continue;
      }
      const idx = indexFor(state.grid, x, y);
      const tile = state.tiles[idx];
      const proximityWeight = Math.max(0, 1 - dist / radiusSafe);
      const wetnessGain = profile.power * profile.wetness * powerMultiplier * (0.75 + proximityWeight * 0.85);
      state.tileSuppressionWetness[idx] = clamp((state.tileSuppressionWetness[idx] ?? 0) + wetnessGain, 0, 1);
      let heatValue = state.tileHeat[idx];
      if (heatValue > 0) {
        const prevHeatValue = heatValue;
        heatValue = Math.max(0, heatValue - profile.power * 1.55 * powerMultiplier * (0.45 + proximityWeight * 0.55));
        state.tileHeat[idx] = heatValue;
        tile.heat = heatValue;
        state.tileHeatRelease[idx] = Math.max(
          0,
          (state.tileHeatRelease[idx] ?? 0) - profile.power * 0.9 * powerMultiplier * (0.35 + proximityWeight * 0.65)
        );
        if (heatValue < prevHeatValue && idx < state.scoring.lastSuppressedAt.length) {
          state.scoring.lastSuppressedAt[idx] = suppressionTimestamp;
        }
      }
      let fireValue = state.tileFire[idx];
      if (fireValue > 0) {
        const before = fireValue;
        fireValue = Math.max(0, fireValue - profile.power * 1.05 * powerMultiplier * (0.45 + proximityWeight * 0.55));
        state.tileFire[idx] = fireValue;
        tile.fire = fireValue;
        if (fireValue > 0) {
          state.tileBurnAge[idx] = Math.max(0, (state.tileBurnAge[idx] ?? 0) - powerMultiplier * 0.6);
          state.tileHeatRelease[idx] = Math.max(0, (state.tileHeatRelease[idx] ?? 0) * (0.72 + proximityWeight * 0.18));
        }
        if (fireValue < before && idx < state.scoring.lastSuppressedAt.length) {
          state.scoring.lastSuppressedAt[idx] = suppressionTimestamp;
        }
        if (before > 0 && fireValue === 0) {
          heatValue = Math.min(state.tileHeat[idx], tile.ignitionPoint * 0.25);
          state.tileHeat[idx] = heatValue;
          tile.heat = heatValue;
          state.tileBurnAge[idx] = 0;
          state.tileHeatRelease[idx] = 0;
          if (state.tileFuel[idx] > 0) {
            state.containedCount += 1;
          }
        }
      }
      if (heatValue > 0.01 || fireValue > THREAT_FIRE_EPS || state.tileSuppressionWetness[idx] > 0.01) {
        markFireBlockActiveByTile(state, idx);
      }
    }
  }
};

export function prepareExtinguish(state: WorldState, effects: EffectsState, rng: RNG): void {
  effects.waterStreams = [];
  state.units.forEach((unit) => {
    if (unit.kind === "firefighter" && unit.carrierId !== null) {
      setSprayTarget(unit, null);
      return;
    }
    if (!canUnitSpray(state, unit)) {
      setSprayTarget(unit, null);
      return;
    }
    const profile = getSuppressionProfile(unit);
    const impactTarget = resolveSuppressionImpactTarget(state, unit, profile);
    if (!impactTarget) {
      setSprayTarget(unit, null);
      return;
    }
    setSprayTarget(unit, impactTarget);
    emitWaterSpray(state, effects, rng, unit, impactTarget);
  });
}

export function applyExtinguishStep(state: WorldState, delta: number, suppressionScale = 1): void {
  const powerMultiplier = Math.max(0, delta) * Math.max(0, suppressionScale);
  if (powerMultiplier <= 0) {
    return;
  }
  const suppressionTimestamp = state.careerDay;
  state.units.forEach((unit) => {
    if (unit.kind === "firefighter" && unit.carrierId !== null) {
      return;
    }
    if (!unit.sprayTarget) {
      return;
    }
    if (!canUnitSpray(state, unit)) {
      setSprayTarget(unit, null);
      return;
    }
    const profile = getSuppressionProfile(unit);
    applySuppressionAtTarget(state, unit, unit.sprayTarget, profile, powerMultiplier, suppressionTimestamp);
    spendUnitWater(state, unit, delta);
  });
}

export function applyExtinguish(state: WorldState, effects: EffectsState, rng: RNG, delta: number): void {
  prepareExtinguish(state, effects, rng);
  applyExtinguishStep(state, delta);
}
