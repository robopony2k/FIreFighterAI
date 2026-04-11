import { COAST_CLASS_BEACH, COAST_CLASS_CLIFF, COAST_CLASS_NONE } from "../../core/state.js";
import { clamp } from "../../core/utils.js";
import type { PipelineStage } from "../pipeline/TerrainPipeline.js";
import { fractalNoise } from "../noise.js";
import { emitStageSnapshot } from "../pipeline/stageDebug.js";
import {
  buildDistanceFromMask,
  buildEdgeConnectedMask,
  buildSlopeMap,
  clampRiverMouthDepthsToSeaLevel,
  classifyCoastDryTileType,
  COAST_BEACH_DRY_HEIGHTS,
  COAST_BEACH_LAND_BAND,
  COAST_BEACH_MAX_RELIEF,
  COAST_BEACH_MAX_SLOPE,
  COAST_BEACH_SCULPT_MAX_HEIGHT_ABOVE_SEA,
  COAST_BEACH_SHELF_BAND,
  COAST_BEACH_WET_DEPTHS,
  COAST_CLIFF_MIN_HEIGHTS,
  COAST_LAND_EASE_BAND,
  COAST_LAND_EASE_MAX_HEIGHTS,
  COAST_LOCAL_SEA_MARGIN,
  COAST_MIN_LAND_ABOVE_SEA,
  computeOceanLevel,
  countEdgeMaskTiles,
  countMaskTiles,
  expandOceanMaskByLocalSeaLevel,
  getCoastBandValue,
  getWorldX,
  getWorldY,
  persistCoastMetadataToState,
  persistSeaLevelMapToState,
  SHORELINE_NOISE_AMPLITUDE,
  SHORELINE_NOISE_SCALE_BROAD_M,
  SHORELINE_NOISE_SCALE_FINE_M,
  SHORELINE_SEA_BAND,
  SHORELINE_SMOOTH_PASSES,
  suppressIsolatedElevationSpikes
} from "../runtime.js";

export const ShorelinePolishStage: PipelineStage = {
  id: "terrain:shoreline",
  weight: 6,
  run: async (ctx) => {
    const { state, settings, elevationMap, seaLevelMap, oceanMask, riverMask } = ctx;
    if (!elevationMap || !seaLevelMap || !oceanMask || !riverMask) {
      throw new Error("Shoreline stage missing hydrology fields.");
    }

    const { cols, rows, totalTiles } = state.grid;
    const baseOceanMask = Uint8Array.from(oceanMask);
    const coastalBand = new Uint8Array(totalTiles);

    for (let y = 0; y < rows; y += 1) {
      const rowBase = y * cols;
      for (let x = 0; x < cols; x += 1) {
        const idx = rowBase + x;
        if (riverMask[idx] > 0) {
          continue;
        }
        const elevation = elevationMap[idx] ?? 0;
        const seaLevel = seaLevelMap[idx] ?? 0;
        if (Math.abs(elevation - seaLevel) > SHORELINE_SEA_BAND) {
          continue;
        }
        const isOcean = baseOceanMask[idx] > 0;
        let touchesTransition = false;
        for (let dy = -2; dy <= 2 && !touchesTransition; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) {
            if (Math.abs(dx) + Math.abs(dy) > 2) {
              continue;
            }
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
              continue;
            }
            const nIdx = ny * cols + nx;
            if (riverMask[nIdx] > 0) {
              continue;
            }
            if ((baseOceanMask[nIdx] > 0) !== isOcean) {
              touchesTransition = true;
              break;
            }
          }
        }
        if (touchesTransition) {
          coastalBand[idx] = 1;
        }
      }
      if (await ctx.yieldIfNeeded()) {
        await ctx.reportStage("Polishing shoreline...", ((y + 1) / rows) * 0.25);
      }
    }

    const oceanCandidate = Uint8Array.from(baseOceanMask);
    for (let y = 0; y < rows; y += 1) {
      const rowBase = y * cols;
      for (let x = 0; x < cols; x += 1) {
        const idx = rowBase + x;
        if (coastalBand[idx] === 0 || riverMask[idx] > 0) {
          continue;
        }
        const worldX = getWorldX(settings, x);
        const worldY = getWorldY(settings, y);
        const fine = fractalNoise(
          worldX / SHORELINE_NOISE_SCALE_FINE_M,
          worldY / SHORELINE_NOISE_SCALE_FINE_M,
          state.seed + 13031
        );
        const broad = fractalNoise(
          worldX / SHORELINE_NOISE_SCALE_BROAD_M,
          worldY / SHORELINE_NOISE_SCALE_BROAD_M,
          state.seed + 13079
        );
        const offset = ((fine * 2 - 1) * 0.65 + (broad * 2 - 1) * 0.35) * SHORELINE_NOISE_AMPLITUDE;
        const seaLevel = seaLevelMap[idx] ?? 0;
        const elevation = elevationMap[idx] ?? 0;
        oceanCandidate[idx] = elevation <= seaLevel + offset ? 1 : 0;
      }
      if (await ctx.yieldIfNeeded()) {
        await ctx.reportStage("Polishing shoreline...", 0.25 + ((y + 1) / rows) * 0.2);
      }
    }

    let source = Uint8Array.from(oceanCandidate);
    let scratch = Uint8Array.from(oceanCandidate);
    for (let pass = 0; pass < SHORELINE_SMOOTH_PASSES; pass += 1) {
      for (let y = 0; y < rows; y += 1) {
        const rowBase = y * cols;
        for (let x = 0; x < cols; x += 1) {
          const idx = rowBase + x;
          if (coastalBand[idx] === 0 || riverMask[idx] > 0) {
            scratch[idx] = source[idx];
            continue;
          }
          let waterNeighbors = 0;
          for (let dy = -1; dy <= 1; dy += 1) {
            for (let dx = -1; dx <= 1; dx += 1) {
              if (dx === 0 && dy === 0) {
                continue;
              }
              const nx = x + dx;
              const ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
                continue;
              }
              if (source[ny * cols + nx] > 0) {
                waterNeighbors += 1;
              }
            }
          }
          if (waterNeighbors >= 5) {
            scratch[idx] = 1;
          } else if (waterNeighbors <= 3) {
            scratch[idx] = 0;
          } else {
            scratch[idx] = source[idx];
          }
        }
        if (await ctx.yieldIfNeeded()) {
          const passProgress = (pass + (y + 1) / rows) / SHORELINE_SMOOTH_PASSES;
          await ctx.reportStage("Polishing shoreline...", 0.45 + passProgress * 0.2);
        }
      }
      const temp = source;
      source = scratch;
      scratch = temp;
    }

    for (let i = 0; i < totalTiles; i += 1) {
      if (riverMask[i] > 0) {
        source[i] = 0;
      }
    }
    let polishedOceanMask = buildEdgeConnectedMask(source, cols, rows);
    if (countEdgeMaskTiles(polishedOceanMask, cols, rows) === 0 || countMaskTiles(polishedOceanMask) === 0) {
      polishedOceanMask = baseOceanMask;
    }

    const slopeMap = buildSlopeMap(state, elevationMap);
    const landMask = new Uint8Array(totalTiles);
    for (let i = 0; i < totalTiles; i += 1) {
      if (!polishedOceanMask[i] && riverMask[i] === 0) {
        landMask[i] = 1;
      }
    }
    const distToOcean = buildDistanceFromMask(polishedOceanMask, cols, rows);
    const distToLand = buildDistanceFromMask(landMask, cols, rows);
    const shorelineBaseElevations = Float32Array.from(elevationMap);
    const shorelineSeaLevelMap = Float32Array.from(seaLevelMap);
    const shorelineSurfaceLevel = computeOceanLevel(shorelineBaseElevations, polishedOceanMask, riverMask);
    if (shorelineSurfaceLevel !== null) {
      for (let i = 0; i < totalTiles; i += 1) {
        if (riverMask[i] > 0) {
          continue;
        }
        if (polishedOceanMask[i] > 0 || ((distToOcean[i] ?? 0) >= 1 && (distToOcean[i] ?? 0) <= COAST_BEACH_LAND_BAND)) {
          shorelineSeaLevelMap[i] = shorelineSurfaceLevel;
        }
      }
    }
    const reliefAt = (x: number, y: number): number => {
      let min = Number.POSITIVE_INFINITY;
      let max = Number.NEGATIVE_INFINITY;
      for (let dy = -1; dy <= 1; dy += 1) {
        const ny = y + dy;
        if (ny < 0 || ny >= rows) {
          continue;
        }
        for (let dx = -1; dx <= 1; dx += 1) {
          const nx = x + dx;
          if (nx < 0 || nx >= cols) {
            continue;
          }
          const value = shorelineBaseElevations[ny * cols + nx] ?? 0;
          min = Math.min(min, value);
          max = Math.max(max, value);
        }
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) {
        return 0;
      }
      return max - min;
    };

    for (let y = 0; y < rows; y += 1) {
      const rowBase = y * cols;
      for (let x = 0; x < cols; x += 1) {
        const idx = rowBase + x;
        const seaLevel = shorelineSeaLevelMap[idx] ?? 0;
        const current = elevationMap[idx] ?? 0;
        const baseCurrent = shorelineBaseElevations[idx] ?? current;
        if (riverMask[idx] > 0) {
          continue;
        }
        if (polishedOceanMask[idx] > 0) {
          const dist = distToLand[idx] ?? 0;
          if (dist >= 1 && dist <= COAST_BEACH_SHELF_BAND) {
            const depth = getCoastBandValue(COAST_BEACH_WET_DEPTHS, dist);
            const nextElevation = clamp(Math.min(current, seaLevel - depth), 0, Math.max(0, seaLevel - 0.001));
            elevationMap[idx] = nextElevation;
            state.tiles[idx].elevation = nextElevation;
          }
          continue;
        }
        const dist = distToOcean[idx];
        if (dist < 1 || dist > COAST_BEACH_LAND_BAND) {
          continue;
        }
        const slope = slopeMap[idx] ?? 0;
        const relief = reliefAt(x, y);
        const beachCandidate =
          slope <= COAST_BEACH_MAX_SLOPE &&
          relief <= COAST_BEACH_MAX_RELIEF &&
          baseCurrent - seaLevel <= COAST_BEACH_SCULPT_MAX_HEIGHT_ABOVE_SEA;
        let nextElevation = current;
        if (beachCandidate) {
          const target = seaLevel + getCoastBandValue(COAST_BEACH_DRY_HEIGHTS, dist);
          nextElevation = clamp(Math.min(current, Math.max(target, seaLevel + COAST_MIN_LAND_ABOVE_SEA)), 0, 1);
        } else {
          const minTarget = seaLevel + getCoastBandValue(COAST_CLIFF_MIN_HEIGHTS, dist);
          nextElevation = clamp(Math.max(current, minTarget), 0, 1);
        }
        if (dist <= COAST_LAND_EASE_BAND) {
          const easedMax = seaLevel + getCoastBandValue(COAST_LAND_EASE_MAX_HEIGHTS, dist);
          nextElevation = Math.min(nextElevation, easedMax);
        }
        elevationMap[idx] = nextElevation;
        state.tiles[idx].elevation = nextElevation;
      }
      if (await ctx.yieldIfNeeded()) {
        await ctx.reportStage("Polishing shoreline...", 0.65 + ((y + 1) / rows) * 0.3);
      }
    }

    polishedOceanMask = expandOceanMaskByLocalSeaLevel(
      elevationMap,
      shorelineSeaLevelMap,
      polishedOceanMask,
      riverMask,
      cols,
      rows,
      COAST_LOCAL_SEA_MARGIN
    );

    for (let i = 0; i < totalTiles; i += 1) {
      if (riverMask[i] > 0 || polishedOceanMask[i] > 0) {
        continue;
      }
      const sea = shorelineSeaLevelMap[i] ?? 0;
      if ((elevationMap[i] ?? 0) <= sea + COAST_LOCAL_SEA_MARGIN) {
        const lifted = sea + COAST_MIN_LAND_ABOVE_SEA;
        elevationMap[i] = lifted;
        state.tiles[i].elevation = lifted;
      }
    }

    const finalLandMask = new Uint8Array(totalTiles);
    for (let i = 0; i < totalTiles; i += 1) {
      if (!polishedOceanMask[i] && riverMask[i] === 0) {
        finalLandMask[i] = 1;
      }
    }
    const finalDistToOcean = buildDistanceFromMask(polishedOceanMask, cols, rows);
    const finalDistToLand = buildDistanceFromMask(finalLandMask, cols, rows);
    persistCoastMetadataToState(
      state,
      polishedOceanMask,
      finalDistToOcean,
      finalDistToLand,
      slopeMap,
      null,
      shorelineSeaLevelMap
    );

    const protectedShoreWater = new Uint8Array(totalTiles);
    for (let i = 0; i < totalTiles; i += 1) {
      protectedShoreWater[i] = polishedOceanMask[i] > 0 || riverMask[i] > 0 ? 1 : 0;
    }
    suppressIsolatedElevationSpikes(elevationMap, cols, rows, protectedShoreWater);
    for (let i = 0; i < totalTiles; i += 1) {
      const resolvedElevation = elevationMap[i] ?? state.tiles[i].elevation;
      state.tiles[i].elevation = resolvedElevation;
      state.tileElevation[i] = resolvedElevation;
    }

    for (let i = 0; i < totalTiles; i += 1) {
      if (riverMask[i] > 0 || polishedOceanMask[i] > 0) {
        state.tiles[i].type = "water";
        continue;
      }
      const coastClass = state.tileCoastClass[i] ?? COAST_CLASS_NONE;
      if (coastClass === COAST_CLASS_BEACH) {
        state.tiles[i].type = "beach";
        continue;
      }
      if (coastClass === COAST_CLASS_CLIFF) {
        const seaLevel = shorelineSeaLevelMap[i] ?? 0;
        state.tiles[i].type = classifyCoastDryTileType(slopeMap[i] ?? 0, state.tiles[i].elevation - seaLevel);
        continue;
      }
      state.tiles[i].type = "grass";
    }
    ctx.seaLevelMap = shorelineSeaLevelMap;
    persistSeaLevelMapToState(state, shorelineSeaLevelMap);
    clampRiverMouthDepthsToSeaLevel(state, polishedOceanMask, riverMask, shorelineSeaLevelMap);
    ctx.oceanMask = polishedOceanMask;
    await ctx.reportStage("Shoreline polished.", 1);
    await emitStageSnapshot(ctx, "terrain:shoreline");
  }
};
