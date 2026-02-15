import type { WorldState } from "../core/state.js";
import { TILE_TYPE_IDS } from "../core/state.js";
import { ensureTileSoA } from "../core/tileCache.js";

const TYPE_WATER = TILE_TYPE_IDS.water;
const TYPE_ASH = TILE_TYPE_IDS.ash;

export function clearHeatInBounds(state: WorldState, minX: number, maxX: number, minY: number, maxY: number): void {
  ensureTileSoA(state);
  const cols = state.grid.cols;
  const tiles = state.tiles;
  const heat = state.tileHeat;
  for (let y = minY; y <= maxY; y += 1) {
    let idx = y * cols + minX;
    for (let x = minX; x <= maxX; x += 1, idx += 1) {
      heat[idx] = 0;
      tiles[idx].heat = 0;
    }
  }
}

export function stepHeat(
  state: WorldState,
  delta: number,
  spreadScale: number,
  bounds?: { minX: number; maxX: number; minY: number; maxY: number }
): void {
  if (!bounds) {
    return;
  }
  ensureTileSoA(state);
  const minX = bounds.minX;
  const maxX = bounds.maxX;
  const minY = bounds.minY;
  const maxY = bounds.maxY;
  const cols = state.grid.cols;
  const tiles = state.tiles;
  const fire = state.tileFire;
  const heat = state.tileHeat;
  const heatCap = Math.max(0.01, state.fireSettings.heatCap);
  const heatOutput = state.tileHeatOutput;
  const elevation = state.tileElevation;
  const typeId = state.tileTypeId;
  const heatBuffer = state.heatBuffer;
  const offsets4 = state.neighborOffsets4;
  const offsets8 = state.neighborOffsets8;
  for (let y = minY; y <= maxY; y += 1) {
    let idx = y * cols + minX;
    for (let x = minX; x <= maxX; x += 1, idx += 1) {
      heatBuffer[idx] = 0;
    }
  }
  const heatDelta = delta * spreadScale;
  let diffusion = delta * (0.6 + spreadScale * 0.05);
  if (diffusion < 0.08) {
    diffusion = 0.08;
  } else if (diffusion > 0.45) {
    diffusion = 0.45;
  }
  let cooling = 1 - heatDelta * 0.2;
  if (cooling < 0.7) {
    cooling = 0.7;
  } else if (cooling > 0.98) {
    cooling = 0.98;
  }
  const windBias = 0.35 + spreadScale * 0.12;
  const perf = state.simPerf;
  const quality = perf.quality;
  const neighborMode = quality === 0 ? 4 : perf.neighbourMode;
  const baseCard = neighborMode === 4 ? 0.25 : 0.16;
  const baseDiag = neighborMode === 4 ? 0 : 0.08;
  const windScale = state.wind.strength * windBias;

  // Single-pass diffusion approximation; enable slope only at quality 2.
  const heatWeights = new Float32Array(8);
  heatWeights[0] = baseCard + windScale * state.wind.dx;
  heatWeights[1] = baseCard - windScale * state.wind.dx;
  heatWeights[2] = baseCard + windScale * state.wind.dy;
  heatWeights[3] = baseCard - windScale * state.wind.dy;
  heatWeights[4] = baseDiag + windScale * (state.wind.dx + state.wind.dy);
  heatWeights[5] = baseDiag - windScale * (state.wind.dx + state.wind.dy);
  heatWeights[6] = baseDiag + windScale * (state.wind.dx - state.wind.dy);
  heatWeights[7] = baseDiag - windScale * (state.wind.dx - state.wind.dy);
  for (let i = 0; i < 8; i += 1) {
    if (heatWeights[i] < 0) {
      heatWeights[i] = 0;
    }
  }
  let weightSum = heatWeights[0] + heatWeights[1] + heatWeights[2] + heatWeights[3];
  if (neighborMode === 8) {
    weightSum += heatWeights[4] + heatWeights[5] + heatWeights[6] + heatWeights[7];
  }
  const weightScale = weightSum > 0 ? 1 / weightSum : 0;

  for (let y = minY; y <= maxY; y += 1) {
    let idx = y * cols + minX;
    for (let x = minX; x <= maxX; x += 1, idx += 1) {
      let heatValue = heat[idx];
      const baseHeat = fire[idx] * heatOutput[idx];
      heatValue = heatValue * cooling + baseHeat * heatDelta * 3.2;
      if (heatValue < 0.005) {
        heatValue = 0;
      }

      const share = heatValue * diffusion;
      heatBuffer[idx] += heatValue - share;

      if (share <= 0) {
        continue;
      }

      if (neighborMode === 4) {
        if (quality === 2) {
          const dist = share * weightScale;
          const elev = elevation[idx];
          if (x < maxX) {
            const nIdx = idx + 1;
            let weight = heatWeights[0];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
          if (x > minX) {
            const nIdx = idx - 1;
            let weight = heatWeights[1];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
          if (y < maxY) {
            const nIdx = idx + cols;
            let weight = heatWeights[2];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
          if (y > minY) {
            const nIdx = idx - cols;
            let weight = heatWeights[3];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
        } else {
          const dist = share * weightScale;
          if (x < maxX) {
            heatBuffer[idx + 1] += dist * heatWeights[0];
          }
          if (x > minX) {
            heatBuffer[idx - 1] += dist * heatWeights[1];
          }
          if (y < maxY) {
            heatBuffer[idx + cols] += dist * heatWeights[2];
          }
          if (y > minY) {
            heatBuffer[idx - cols] += dist * heatWeights[3];
          }
        }
      } else {
        if (quality === 2) {
          const dist = share * weightScale;
          const elev = elevation[idx];
          if (x < maxX) {
            const nIdx = idx + offsets4[0];
            let weight = heatWeights[0];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
          if (x > minX) {
            const nIdx = idx + offsets4[1];
            let weight = heatWeights[1];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
          if (y < maxY) {
            const nIdx = idx + offsets4[2];
            let weight = heatWeights[2];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
          if (y > minY) {
            const nIdx = idx + offsets4[3];
            let weight = heatWeights[3];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
          if (x < maxX && y < maxY) {
            const nIdx = idx + offsets8[4];
            let weight = heatWeights[4];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
          if (x > minX && y > minY) {
            const nIdx = idx + offsets8[5];
            let weight = heatWeights[5];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
          if (x < maxX && y > minY) {
            const nIdx = idx + offsets8[6];
            let weight = heatWeights[6];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
          if (x > minX && y < maxY) {
            const nIdx = idx + offsets8[7];
            let weight = heatWeights[7];
            const slope = elevation[nIdx] - elev;
            let slopeWeight = slope >= 0 ? 1 + slope * 1.1 : 1 + slope * 0.5;
            if (slopeWeight < 0.4) {
              slopeWeight = 0.4;
            } else if (slopeWeight > 2.2) {
              slopeWeight = 2.2;
            }
            heatBuffer[nIdx] += dist * weight * slopeWeight;
          }
        } else {
          const dist = share * weightScale;
          if (x < maxX) {
            heatBuffer[idx + offsets8[0]] += dist * heatWeights[0];
          }
          if (x > minX) {
            heatBuffer[idx + offsets8[1]] += dist * heatWeights[1];
          }
          if (y < maxY) {
            heatBuffer[idx + offsets8[2]] += dist * heatWeights[2];
          }
          if (y > minY) {
            heatBuffer[idx + offsets8[3]] += dist * heatWeights[3];
          }
          if (x < maxX && y < maxY) {
            heatBuffer[idx + offsets8[4]] += dist * heatWeights[4];
          }
          if (x > minX && y > minY) {
            heatBuffer[idx + offsets8[5]] += dist * heatWeights[5];
          }
          if (x < maxX && y > minY) {
            heatBuffer[idx + offsets8[6]] += dist * heatWeights[6];
          }
          if (x > minX && y < maxY) {
            heatBuffer[idx + offsets8[7]] += dist * heatWeights[7];
          }
        }
      }
    }
  }

  for (let y = minY; y <= maxY; y += 1) {
    let idx = y * cols + minX;
    for (let x = minX; x <= maxX; x += 1, idx += 1) {
      const tile = tiles[idx];
      const fallbackRetention = typeId[idx] === TYPE_WATER ? 0.4 : typeId[idx] === TYPE_ASH ? 0.55 : 1;
      const retention = typeof tile.heatRetention === "number" ? tile.heatRetention : fallbackRetention;
      let newHeat = heatBuffer[idx] * retention;
      const transferCapBase = typeof tile.heatTransferCap === "number" ? tile.heatTransferCap : heatCap;
      let transferCap = Math.min(heatCap, Math.max(0, transferCapBase));
      if (transferCap > 0) {
        transferCap = Math.max(transferCap, tile.ignitionPoint * 1.05);
      } else {
        transferCap = 0;
      }
      if (transferCap === 0) {
        newHeat = 0;
      } else if (newHeat > transferCap) {
        newHeat = transferCap;
      }
      heat[idx] = newHeat;
      tile.heat = newHeat;
    }
  }
}

