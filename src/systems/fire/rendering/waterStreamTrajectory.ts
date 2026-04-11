import * as THREE from "three";
import type { WaterSprayMode } from "../../../core/types.js";
import type { TerrainRenderSurface } from "../../../render/threeTestTerrain.js";

const DEG_TO_RAD = Math.PI / 180;
const MIN_TRACE_SAMPLES = 14;
const MAX_TRACE_SAMPLES = 88;
const ARC_LENGTH_SAMPLES = 18;
const BINARY_SEARCH_STEPS = 6;

type WaterTrajectoryProfile = {
  preferredAngleDeg: number;
  minAngleDeg: number;
  maxAngleDeg: number;
  maxSpeedTilesPerSecond: number;
  gravityTilesPerSecondSq: number;
  clearanceTiles: number;
};

const WATER_TRAJECTORY_PROFILES: Record<WaterSprayMode, WaterTrajectoryProfile> = {
  precision: {
    preferredAngleDeg: 16,
    minAngleDeg: 8,
    maxAngleDeg: 54,
    maxSpeedTilesPerSecond: 10.6,
    gravityTilesPerSecondSq: 14.2,
    clearanceTiles: 0.055
  },
  balanced: {
    preferredAngleDeg: 22,
    minAngleDeg: 10,
    maxAngleDeg: 58,
    maxSpeedTilesPerSecond: 9.2,
    gravityTilesPerSecondSq: 11.2,
    clearanceTiles: 0.065
  },
  suppression: {
    preferredAngleDeg: 29,
    minAngleDeg: 12,
    maxAngleDeg: 62,
    maxSpeedTilesPerSecond: 7.8,
    gravityTilesPerSecondSq: 8.6,
    clearanceTiles: 0.08
  }
};

export type WaterStreamTrajectory = {
  sourceX: number;
  sourceY: number;
  sourceZ: number;
  desiredTargetX: number;
  desiredTargetY: number;
  desiredTargetZ: number;
  impactX: number;
  impactY: number;
  impactZ: number;
  horizontalDirectionX: number;
  horizontalDirectionZ: number;
  horizontalDistance: number;
  flightTime: number;
  launchVelocityY: number;
  gravity: number;
  arcLength: number;
  blocked: boolean;
  launchDirectionX: number;
  launchDirectionY: number;
  launchDirectionZ: number;
  impactDirectionX: number;
  impactDirectionY: number;
  impactDirectionZ: number;
};

type TraceCandidate = {
  impactDistance: number;
  flightTime: number;
  horizontalSpeed: number;
  launchVelocityY: number;
  gravity: number;
  blocked: boolean;
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

const sampleObstructionHeightAtWorld = (
  surface: TerrainRenderSurface,
  worldX: number,
  worldZ: number
): number => {
  const tileX = ((worldX / Math.max(0.0001, surface.size.width)) + 0.5) * surface.cols;
  const tileY = ((worldZ / Math.max(0.0001, surface.size.depth)) + 0.5) * surface.rows;
  if (surface.obstructionHeightAtTileCoordWorld) {
    return surface.obstructionHeightAtTileCoordWorld(tileX, tileY);
  }
  return surface.heightAtTileCoord(tileX, tileY) * surface.heightScale;
};

const buildAngleSweep = (preferredDeg: number, minDeg: number, maxDeg: number): number[] => {
  const ordered: number[] = [preferredDeg];
  for (let deg = preferredDeg + 2; deg <= maxDeg; deg += 2) {
    ordered.push(deg);
  }
  for (let deg = preferredDeg - 2; deg >= minDeg; deg -= 2) {
    ordered.push(deg);
  }
  return ordered.map((deg) => deg * DEG_TO_RAD);
};

const solveLaunchSpeed = (
  horizontalDistance: number,
  deltaY: number,
  launchAngle: number,
  gravity: number
): number | null => {
  const cos = Math.cos(launchAngle);
  const cosSq = cos * cos;
  const denom = 2 * cosSq * (horizontalDistance * Math.tan(launchAngle) - deltaY);
  if (denom <= 0.000001) {
    return null;
  }
  const speedSq = (gravity * horizontalDistance * horizontalDistance) / denom;
  if (!Number.isFinite(speedSq) || speedSq <= 0.000001) {
    return null;
  }
  return Math.sqrt(speedSq);
};

const sampleArcHeight = (
  sourceY: number,
  launchVelocityY: number,
  gravity: number,
  flightTime: number,
  along01: number
): number => {
  const t = clamp(along01, 0, 1) * Math.max(0.0001, flightTime);
  return sourceY + launchVelocityY * t - 0.5 * gravity * t * t;
};

const sampleArcVelocity = (
  horizontalDirectionX: number,
  horizontalDirectionZ: number,
  horizontalSpeed: number,
  launchVelocityY: number,
  gravity: number,
  flightTime: number,
  along01: number,
  target: THREE.Vector3
): THREE.Vector3 => {
  const t = clamp(along01, 0, 1) * Math.max(0.0001, flightTime);
  target.set(
    horizontalDirectionX * horizontalSpeed,
    launchVelocityY - gravity * t,
    horizontalDirectionZ * horizontalSpeed
  );
  if (target.lengthSq() <= 0.000001) {
    target.set(horizontalDirectionX, 0, horizontalDirectionZ);
  } else {
    target.normalize();
  }
  return target;
};

const estimateArcLength = (
  sourceX: number,
  sourceY: number,
  sourceZ: number,
  horizontalDirectionX: number,
  horizontalDirectionZ: number,
  horizontalDistance: number,
  launchVelocityY: number,
  gravity: number,
  flightTime: number
): number => {
  let total = 0;
  let prevX = sourceX;
  let prevY = sourceY;
  let prevZ = sourceZ;
  for (let i = 1; i <= ARC_LENGTH_SAMPLES; i += 1) {
    const along01 = i / ARC_LENGTH_SAMPLES;
    const distance = horizontalDistance * along01;
    const nextX = sourceX + horizontalDirectionX * distance;
    const nextY = sampleArcHeight(sourceY, launchVelocityY, gravity, flightTime, along01);
    const nextZ = sourceZ + horizontalDirectionZ * distance;
    total += Math.hypot(nextX - prevX, nextY - prevY, nextZ - prevZ);
    prevX = nextX;
    prevY = nextY;
    prevZ = nextZ;
  }
  return total;
};

const traceToTarget = (
  surface: TerrainRenderSurface,
  source: THREE.Vector3,
  horizontalDirectionX: number,
  horizontalDirectionZ: number,
  horizontalDistance: number,
  horizontalSpeed: number,
  launchVelocityY: number,
  gravity: number,
  clearanceMargin: number
): TraceCandidate => {
  const flightTime = horizontalDistance / Math.max(0.0001, horizontalSpeed);
  const worldPerTileX = surface.size.width / Math.max(1, surface.cols);
  const worldPerTileZ = surface.size.depth / Math.max(1, surface.rows);
  const worldPerTile = Math.max(0.0001, (worldPerTileX + worldPerTileZ) * 0.5);
  const sourceSkipDistance = Math.max(worldPerTile * 0.18, 0.12);
  const sampleCount = clamp(
    Math.ceil(horizontalDistance / Math.max(worldPerTile * 0.18, 0.04)),
    MIN_TRACE_SAMPLES,
    MAX_TRACE_SAMPLES
  );
  let previousDistance = 0;
  for (let i = 1; i < sampleCount; i += 1) {
    const along01 = i / sampleCount;
    const distance = horizontalDistance * along01;
    if (distance <= sourceSkipDistance) {
      previousDistance = distance;
      continue;
    }
    const worldX = source.x + horizontalDirectionX * distance;
    const worldZ = source.z + horizontalDirectionZ * distance;
    const streamY = sampleArcHeight(source.y, launchVelocityY, gravity, flightTime, along01);
    const obstructionY = sampleObstructionHeightAtWorld(surface, worldX, worldZ) + clearanceMargin;
    if (streamY <= obstructionY) {
      let lo = previousDistance;
      let hi = distance;
      for (let step = 0; step < BINARY_SEARCH_STEPS; step += 1) {
        const mid = (lo + hi) * 0.5;
        const midAlong01 = mid / Math.max(0.0001, horizontalDistance);
        const midX = source.x + horizontalDirectionX * mid;
        const midZ = source.z + horizontalDirectionZ * mid;
        const midY = sampleArcHeight(source.y, launchVelocityY, gravity, flightTime, midAlong01);
        const midObstructionY = sampleObstructionHeightAtWorld(surface, midX, midZ) + clearanceMargin;
        if (midY <= midObstructionY) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      const impactDistance = clamp(hi, sourceSkipDistance, horizontalDistance);
      return {
        impactDistance,
        flightTime: flightTime * (impactDistance / Math.max(0.0001, horizontalDistance)),
        horizontalSpeed,
        launchVelocityY,
        gravity,
        blocked: true
      };
    }
    previousDistance = distance;
  }
  return {
    impactDistance: horizontalDistance,
    flightTime,
    horizontalSpeed,
    launchVelocityY,
    gravity,
    blocked: false
  };
};

const buildDirectFallback = (
  source: THREE.Vector3,
  desiredTarget: THREE.Vector3
): WaterStreamTrajectory => {
  const direction = new THREE.Vector3().copy(desiredTarget).sub(source);
  const directLength = direction.length();
  if (direction.lengthSq() <= 0.000001) {
    direction.set(0, -0.04, 1);
  }
  direction.normalize();
  const horizontalDistance = Math.hypot(desiredTarget.x - source.x, desiredTarget.z - source.z);
  return {
    sourceX: source.x,
    sourceY: source.y,
    sourceZ: source.z,
    desiredTargetX: desiredTarget.x,
    desiredTargetY: desiredTarget.y,
    desiredTargetZ: desiredTarget.z,
    impactX: desiredTarget.x,
    impactY: desiredTarget.y,
    impactZ: desiredTarget.z,
    horizontalDirectionX: horizontalDistance > 0.0001 ? (desiredTarget.x - source.x) / horizontalDistance : direction.x,
    horizontalDirectionZ: horizontalDistance > 0.0001 ? (desiredTarget.z - source.z) / horizontalDistance : direction.z,
    horizontalDistance,
    flightTime: Math.max(0.0001, horizontalDistance / 6),
    launchVelocityY: direction.y * 6,
    gravity: 0,
    arcLength: directLength,
    blocked: false,
    launchDirectionX: direction.x,
    launchDirectionY: direction.y,
    launchDirectionZ: direction.z,
    impactDirectionX: direction.x,
    impactDirectionY: direction.y,
    impactDirectionZ: direction.z
  };
};

export const resolveWaterStreamTrajectory = (
  surface: TerrainRenderSurface,
  source: THREE.Vector3,
  desiredTarget: THREE.Vector3,
  mode: WaterSprayMode
): WaterStreamTrajectory => {
  const horizontalDeltaX = desiredTarget.x - source.x;
  const horizontalDeltaZ = desiredTarget.z - source.z;
  const horizontalDistance = Math.hypot(horizontalDeltaX, horizontalDeltaZ);
  if (horizontalDistance <= 0.0001) {
    return buildDirectFallback(source, desiredTarget);
  }

  const horizontalDirectionX = horizontalDeltaX / horizontalDistance;
  const horizontalDirectionZ = horizontalDeltaZ / horizontalDistance;
  const worldPerTileX = surface.size.width / Math.max(1, surface.cols);
  const worldPerTileZ = surface.size.depth / Math.max(1, surface.rows);
  const worldPerTile = Math.max(0.0001, (worldPerTileX + worldPerTileZ) * 0.5);
  const profile = WATER_TRAJECTORY_PROFILES[mode];
  const gravity = profile.gravityTilesPerSecondSq * worldPerTile;
  const maxSpeed = profile.maxSpeedTilesPerSecond * worldPerTile;
  const clearanceMargin = profile.clearanceTiles * worldPerTile;
  const deltaY = desiredTarget.y - source.y;
  const angles = buildAngleSweep(profile.preferredAngleDeg, profile.minAngleDeg, profile.maxAngleDeg);
  let bestBlocked: TraceCandidate | null = null;

  for (let i = 0; i < angles.length; i += 1) {
    const angle = angles[i]!;
    const launchSpeed = solveLaunchSpeed(horizontalDistance, deltaY, angle, gravity);
    if (!launchSpeed || launchSpeed > maxSpeed) {
      continue;
    }
    const launchVelocityY = launchSpeed * Math.sin(angle);
    const horizontalSpeed = launchSpeed * Math.cos(angle);
    if (horizontalSpeed <= 0.0001) {
      continue;
    }
    const trace = traceToTarget(
      surface,
      source,
      horizontalDirectionX,
      horizontalDirectionZ,
      horizontalDistance,
      horizontalSpeed,
      launchVelocityY,
      gravity,
      clearanceMargin
    );
    if (!trace.blocked) {
      const launchDirection = new THREE.Vector3(horizontalDirectionX * horizontalSpeed, launchVelocityY, horizontalDirectionZ * horizontalSpeed).normalize();
      const impactDirection = sampleArcVelocity(
        horizontalDirectionX,
        horizontalDirectionZ,
        horizontalSpeed,
        launchVelocityY,
        gravity,
        trace.flightTime,
        1,
        new THREE.Vector3()
      );
      return {
        sourceX: source.x,
        sourceY: source.y,
        sourceZ: source.z,
        desiredTargetX: desiredTarget.x,
        desiredTargetY: desiredTarget.y,
        desiredTargetZ: desiredTarget.z,
        impactX: desiredTarget.x,
        impactY: desiredTarget.y,
        impactZ: desiredTarget.z,
        horizontalDirectionX,
        horizontalDirectionZ,
        horizontalDistance,
        flightTime: trace.flightTime,
        launchVelocityY,
        gravity,
        arcLength: estimateArcLength(
          source.x,
          source.y,
          source.z,
          horizontalDirectionX,
          horizontalDirectionZ,
          horizontalDistance,
          launchVelocityY,
          gravity,
          trace.flightTime
        ),
        blocked: false,
        launchDirectionX: launchDirection.x,
        launchDirectionY: launchDirection.y,
        launchDirectionZ: launchDirection.z,
        impactDirectionX: impactDirection.x,
        impactDirectionY: impactDirection.y,
        impactDirectionZ: impactDirection.z
      };
    }
    if (!bestBlocked || trace.impactDistance > bestBlocked.impactDistance) {
      bestBlocked = trace;
    }
  }

  if (!bestBlocked) {
    return buildDirectFallback(source, desiredTarget);
  }

  const blockedHorizontalSpeed = bestBlocked.horizontalSpeed;
  const impactX = source.x + horizontalDirectionX * bestBlocked.impactDistance;
  const impactY = sampleArcHeight(
    source.y,
    bestBlocked.launchVelocityY,
    bestBlocked.gravity,
    bestBlocked.flightTime,
    1
  );
  const impactZ = source.z + horizontalDirectionZ * bestBlocked.impactDistance;
  const blockedLaunchDirection = new THREE.Vector3(
    horizontalDirectionX * blockedHorizontalSpeed,
    bestBlocked.launchVelocityY,
    horizontalDirectionZ * blockedHorizontalSpeed
  ).normalize();
  const blockedImpactDirection = sampleArcVelocity(
    horizontalDirectionX,
    horizontalDirectionZ,
    blockedHorizontalSpeed,
    bestBlocked.launchVelocityY,
    bestBlocked.gravity,
    bestBlocked.flightTime,
    1,
    new THREE.Vector3()
  );
  return {
    sourceX: source.x,
    sourceY: source.y,
    sourceZ: source.z,
    desiredTargetX: desiredTarget.x,
    desiredTargetY: desiredTarget.y,
    desiredTargetZ: desiredTarget.z,
    impactX,
    impactY,
    impactZ,
    horizontalDirectionX,
    horizontalDirectionZ,
    horizontalDistance: bestBlocked.impactDistance,
    flightTime: bestBlocked.flightTime,
    launchVelocityY: bestBlocked.launchVelocityY,
    gravity: bestBlocked.gravity,
    arcLength: estimateArcLength(
      source.x,
      source.y,
      source.z,
      horizontalDirectionX,
      horizontalDirectionZ,
      bestBlocked.impactDistance,
      bestBlocked.launchVelocityY,
      bestBlocked.gravity,
      bestBlocked.flightTime
    ),
    blocked: true,
    launchDirectionX: blockedLaunchDirection.x,
    launchDirectionY: blockedLaunchDirection.y,
    launchDirectionZ: blockedLaunchDirection.z,
    impactDirectionX: blockedImpactDirection.x,
    impactDirectionY: blockedImpactDirection.y,
    impactDirectionZ: blockedImpactDirection.z
  };
};

export const sampleWaterStreamTrajectoryPoint = (
  trajectory: WaterStreamTrajectory,
  along01: number,
  target: THREE.Vector3
): THREE.Vector3 => {
  const clampedAlong = clamp(along01, 0, 1);
  const distance = trajectory.horizontalDistance * clampedAlong;
  return target.set(
    trajectory.sourceX + trajectory.horizontalDirectionX * distance,
    sampleArcHeight(
      trajectory.sourceY,
      trajectory.launchVelocityY,
      trajectory.gravity,
      trajectory.flightTime,
      clampedAlong
    ),
    trajectory.sourceZ + trajectory.horizontalDirectionZ * distance
  );
};

export const sampleWaterStreamTrajectoryTangent = (
  trajectory: WaterStreamTrajectory,
  along01: number,
  target: THREE.Vector3
): THREE.Vector3 => {
  const horizontalSpeed = trajectory.horizontalDistance / Math.max(0.0001, trajectory.flightTime);
  return sampleArcVelocity(
    trajectory.horizontalDirectionX,
    trajectory.horizontalDirectionZ,
    horizontalSpeed,
    trajectory.launchVelocityY,
    trajectory.gravity,
    trajectory.flightTime,
    along01,
    target
  );
};
