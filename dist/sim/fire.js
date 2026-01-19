// @ts-nocheck
import { clamp } from "../core/utils.js";
import { coolCellTemp, DEFAULT_COOLING_PARAMS } from "../core/climate.js";
import { indexFor } from "../core/grid.js";
import { syncTileSoA } from "../core/state.js";
import { emitSmokeAt } from "./particles.js";
import { clearHeatInBounds } from "./heat.js";
import { resetFireBounds } from "./fire/bounds.js";
import { igniteRandomFire } from "./fire/ignite.js";
import { burnTile } from "./fire/burn.js";
const CARDINAL_DIRS = [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 }
];
const DIAGONAL_DIRS = [
    { dx: 1, dy: 1 },
    { dx: -1, dy: 1 },
    { dx: 1, dy: -1 },
    { dx: -1, dy: -1 }
];
const NEIGHBOR_OFFSETS = [...CARDINAL_DIRS, ...DIAGONAL_DIRS];
export const BASELINE_FIRE = false;
const BASELINE_DEBUG_LOG = false;
const BASELINE_LOG_INTERVAL = 50;
const BASELINE_DIFFUSE_K = 0.15;
const BASELINE_FIRE_MAX = 1;
const BASELINE_FIRE_GAIN = 0.35;
const BASELINE_BURN_RATE = 0.12;
const BASELINE_HEAT_FROM_FIRE = 0.65;
const BASELINE_FIRE_DECAY = 0.05;
const BASELINE_HEAT_DECAY = 0.9;
const BASELINE_IGNITION_HEAT = 0.9;
const BASELINE_BASE_IGNITE = 0.45;
const BASELINE_FIRE_SEED = 0.35;
const BASELINE_FIRE_EPS = 0.04;
const BASELINE_HEAT_EPS = 0.08;
let baselineTickCounter = 0;
const isIgnitableTile = (tile) => tile.type !== "water" && tile.type !== "ash" && tile.type !== "firebreak" && tile.type !== "road";
function stepFireBaseline(state, rng, delta, spreadScale, dayFactor, burnoutFactor = 0) {
    const cols = state.grid.cols;
    const rows = state.grid.rows;
    const boundsActive = state.fireBoundsActive;
    const boundsPadding = Math.max(0, Math.round(state.fireSettings.boundsPadding));
    const heatCap = Math.max(0.01, state.fireSettings.heatCap);
    const minX = boundsActive ? clamp(state.fireMinX - boundsPadding, 0, cols - 1) : 0;
    const maxX = boundsActive ? clamp(state.fireMaxX + boundsPadding, 0, cols - 1) : cols - 1;
    const minY = boundsActive ? clamp(state.fireMinY - boundsPadding, 0, rows - 1) : 0;
    const maxY = boundsActive ? clamp(state.fireMaxY + boundsPadding, 0, rows - 1) : rows - 1;
    if (!boundsActive && state.lastActiveFires === 0) {
        return 0;
    }
    syncTileSoA(state);
    const fire = state.tileFire;
    const heat = state.tileHeat;
    const fuel = state.tileFuel;
    const fireScratch = state.baselineFireScratch;
    const heatScratch = state.baselineHeatScratch;
    const nextHeat = state.baselineNextHeat;
    fireScratch.set(fire);
    heatScratch.set(heat);
    const diffMinX = Math.max(0, minX - 1);
    const diffMaxX = Math.min(cols - 1, maxX + 1);
    const diffMinY = Math.max(0, minY - 1);
    const diffMaxY = Math.min(rows - 1, maxY + 1);
    for (let y = diffMinY; y <= diffMaxY; y += 1) {
        const rowBase = y * cols;
        for (let x = diffMinX; x <= diffMaxX; x += 1) {
            const idx = rowBase + x;
            let neighborSum = 0;
            let neighborCount = 0;
            if (x > 0) {
                neighborSum += heatScratch[idx - 1];
                neighborCount += 1;
            }
            if (x < cols - 1) {
                neighborSum += heatScratch[idx + 1];
                neighborCount += 1;
            }
            if (y > 0) {
                neighborSum += heatScratch[idx - cols];
                neighborCount += 1;
            }
            if (y < rows - 1) {
                neighborSum += heatScratch[idx + cols];
                neighborCount += 1;
            }
            const avg = neighborCount > 0 ? neighborSum / neighborCount : heatScratch[idx];
            let diffused = heatScratch[idx] * (1 - BASELINE_DIFFUSE_K) + BASELINE_DIFFUSE_K * avg;
            if (diffused < 0) {
                diffused = 0;
            }
            if (diffused > heatCap) {
                diffused = heatCap;
            }
            nextHeat[idx] = diffused;
        }
    }
    const tiles = state.tiles;
    const ignitionBoost = Math.max(0.2, state.climateIgnitionMultiplier || 1);
    const igniteMask = state.igniteMask;
    for (let y = diffMinY; y <= diffMaxY; y += 1) {
        const rowBase = y * cols;
        for (let x = diffMinX; x <= diffMaxX; x += 1) {
            const idx = rowBase + x;
            const prevFire = fireScratch[idx];
            const candidateHeat = nextHeat[idx];
            const tileFuel = fuel[idx];
            let currentFire = prevFire;
            let currentHeat = candidateHeat;
            if (prevFire > 0 && tileFuel > 0) {
                currentFire = Math.min(BASELINE_FIRE_MAX, prevFire + BASELINE_FIRE_GAIN * candidateHeat);
                const burned = BASELINE_BURN_RATE * currentFire;
                fuel[idx] = Math.max(0, tileFuel - burned);
                currentHeat = Math.min(heatCap, candidateHeat + BASELINE_HEAT_FROM_FIRE * currentFire);
            }
            else {
                currentFire = Math.max(0, prevFire - BASELINE_FIRE_DECAY);
                currentHeat = candidateHeat * BASELINE_HEAT_DECAY;
            }
            if (burnoutFactor > 0 && currentFire > 0) {
                const coolingDt = delta * (0.35 + burnoutFactor * 0.65);
                currentHeat = coolCellTemp(currentHeat, state.climateTemp, coolingDt, DEFAULT_COOLING_PARAMS);
                currentFire = Math.max(0, currentFire - delta * (0.12 + burnoutFactor * 0.25));
            }
            fire[idx] = currentFire;
            heat[idx] = currentHeat;
            const tile = tiles[idx];
            tile.fire = currentFire;
            tile.heat = currentHeat;
            tile.fuel = fuel[idx];
            igniteMask[idx] = 0;
            if (fuel[idx] > 0 && currentFire <= BASELINE_FIRE_EPS && currentHeat >= BASELINE_IGNITION_HEAT / ignitionBoost && isIgnitableTile(tile)) {
                const igniteChance = clamp(BASELINE_BASE_IGNITE * ignitionBoost * (currentHeat / heatCap), 0, 1);
                if (rng.next() < igniteChance) {
                    igniteMask[idx] = 1;
                }
            }
        }
    }
    let newIgnitions = 0;
    for (let y = diffMinY; y <= diffMaxY; y += 1) {
        const rowBase = y * cols;
        for (let x = diffMinX; x <= diffMaxX; x += 1) {
            const idx = rowBase + x;
            if (igniteMask[idx] === 1) {
                const seededFire = Math.min(BASELINE_FIRE_MAX, BASELINE_FIRE_SEED);
                fire[idx] = seededFire;
                tiles[idx].fire = seededFire;
                const boostedHeat = Math.min(heatCap, heat[idx] + BASELINE_HEAT_FROM_FIRE * seededFire);
                heat[idx] = boostedHeat;
                tiles[idx].heat = boostedHeat;
                igniteMask[idx] = 0;
                newIgnitions += 1;
            }
        }
    }
    let nextMinX = cols;
    let nextMaxX = -1;
    let nextMinY = rows;
    let nextMaxY = -1;
    let activeFires = 0;
    for (let y = diffMinY; y <= diffMaxY; y += 1) {
        const rowBase = y * cols;
        for (let x = diffMinX; x <= diffMaxX; x += 1) {
            const idx = rowBase + x;
            const fireValue = fire[idx];
            const heatValue = heat[idx];
            if (fireValue > BASELINE_FIRE_EPS || heatValue > BASELINE_HEAT_EPS) {
                nextMinX = Math.min(nextMinX, x);
                nextMaxX = Math.max(nextMaxX, x);
                nextMinY = Math.min(nextMinY, y);
                nextMaxY = Math.max(nextMaxY, y);
            }
            if (fireValue > BASELINE_FIRE_EPS) {
                activeFires += 1;
            }
        }
    }
    if (nextMaxX >= nextMinX && nextMaxY >= nextMinY) {
        const expandedMinX = Math.max(0, nextMinX - 1);
        const expandedMaxX = Math.min(cols - 1, nextMaxX + 1);
        const expandedMinY = Math.max(0, nextMinY - 1);
        const expandedMaxY = Math.min(rows - 1, nextMaxY + 1);
        state.fireBoundsActive = true;
        state.fireMinX = expandedMinX;
        state.fireMaxX = expandedMaxX;
        state.fireMinY = expandedMinY;
        state.fireMaxY = expandedMaxY;
    }
    else if (boundsActive) {
        clearHeatInBounds(state, minX, maxX, minY, maxY);
        resetFireBounds(state);
    }
    baselineTickCounter += 1;
    if (BASELINE_FIRE_DEBUG && baselineTickCounter % BASELINE_LOG_INTERVAL === 0) {
        const width = Math.max(0, state.fireMaxX - state.fireMinX + 1);
        const height = Math.max(0, state.fireMaxY - state.fireMinY + 1);
        const boundsArea = width * height;
        console.log(`[BASELINE] tick=${baselineTickCounter} burning=${activeFires} newIgnitions=${newIgnitions} boundsArea=${boundsArea}`);
    }
    return activeFires;
}
function applyHeatDiffusion(state, minX, maxX, minY, maxY, fireDelta, spreadScale, dayFactor) {
    const cols = state.grid.cols;
    const heatCap = Math.max(0.01, state.fireSettings.heatCap);
    const diffuseCardinal = Math.max(0, state.fireSettings.diffusionCardinal);
    const diffuseDiagonal = Math.max(0, state.fireSettings.diffusionDiagonal);
    const diffuseSecondary = Math.max(0, state.fireSettings.diffusionSecondary);
    const diffuseMoisture = Math.max(0, state.fireSettings.diffusionMoisture);
    const windMagnitude = Math.hypot(state.wind.dx, state.wind.dy);
    for (let y = minY; y <= maxY; y += 1) {
        let baseIdx = y * cols;
        for (let x = minX; x <= maxX; x += 1, baseIdx += 1) {
            const tile = state.tiles[baseIdx];
            if (tile.fire <= 0) {
                continue;
            }
            const baseHeat = (0.25 + tile.fire * 0.45) * tile.heatOutput;
            const moistureFactor = Math.max(0, 1 - tile.moisture * diffuseMoisture);
            const intensity = Math.max(0.25, fireDelta * (0.45 + spreadScale * 0.12));
            const dayBoost = 0.65 + dayFactor * 0.4;
            const spreadMultiplier = Math.max(0, tile.spreadBoost ?? 1);
            const primary = baseHeat * spreadMultiplier * moistureFactor * intensity * dayBoost;
            tile.heat = Math.min(heatCap, tile.heat + primary * 0.45);
            if (primary <= 0) {
                continue;
            }
            const cardinalScale = diffuseCardinal * (1 + spreadScale * 0.12);
            const diagonalScale = diffuseDiagonal * (1 + spreadScale * 0.08);
            const windPull = Math.max(0, tile.windFactor ?? 0);
            const getWindFactor = (dx, dy) => {
                if (windPull <= 0 || windMagnitude === 0) {
                    return 1;
                }
                const dirLen = Math.hypot(dx, dy);
                if (dirLen === 0) {
                    return 1;
                }
                const dot = (dx * state.wind.dx + dy * state.wind.dy) / (windMagnitude * dirLen);
                const alignment = Math.max(-1, Math.min(1, dot));
                if (alignment >= 0) {
                    const weight = alignment * alignment * state.wind.strength * windPull;
                    return 1 + weight;
                }
                const opposing = -alignment;
                const penalty = opposing * opposing * state.wind.strength * windPull * 1.35;
                return Math.max(0.05, 1 - penalty);
            };
            const addHeat = (ix, iy, scale, dir, isSecondary = false) => {
                if (ix < 0 ||
                    ix >= state.grid.cols ||
                    iy < 0 ||
                    iy >= state.grid.rows ||
                    ix < minX ||
                    ix > maxX ||
                    iy < minY ||
                    iy > maxY) {
                    return;
                }
                if (isSecondary && dir) {
                    const midIdx = indexFor(state.grid, ix - dir.dx, iy - dir.dy);
                    const midTile = state.tiles[midIdx];
                    if (midTile.fire <= 0) {
                        return;
                    }
                }
                const tidx = indexFor(state.grid, ix, iy);
                const target = state.tiles[tidx];
                const neighborBoost = 1 + Math.min(0.6, tile.fire * 0.45 + spreadScale * 0.25);
                const windFactor = dir ? getWindFactor(dir.dx, dir.dy) : 1;
                const contribution = primary * scale * neighborBoost * windFactor;
                const transferCapBase = typeof target.heatTransferCap === "number" ? target.heatTransferCap : heatCap;
                let transferCap = Math.min(heatCap, Math.max(0, transferCapBase));
                if (transferCap > 0) {
                    transferCap = Math.max(transferCap, target.ignitionPoint * 1.05);
                }
                const available = transferCap - target.heat;
                if (available <= 0) {
                    return;
                }
                const cappedContribution = Math.min(contribution, available);
                if (cappedContribution <= 0) {
                    return;
                }
                target.heat = Math.min(transferCap, target.heat + cappedContribution);
            };
            for (const dir of CARDINAL_DIRS) {
                addHeat(x + dir.dx, y + dir.dy, cardinalScale, dir);
                addHeat(x + dir.dx * 2, y + dir.dy * 2, cardinalScale * diffuseSecondary, dir, true);
            }
            for (const dir of DIAGONAL_DIRS) {
                addHeat(x + dir.dx, y + dir.dy, diagonalScale, dir);
                addHeat(x + dir.dx * 2, y + dir.dy * 2, diagonalScale * diffuseSecondary, dir, true);
            }
        }
    }
}
export function stepFire(state, rng, delta, spreadScale, dayFactor, burnoutFactor = 0) {
    if (BASELINE_FIRE) {
        return stepFireBaseline(state, rng, delta, spreadScale, dayFactor, burnoutFactor);
    }
    const cols = state.grid.cols;
    const rows = state.grid.rows;
    const ignitionBoost = Math.max(0.2, state.climateIgnitionMultiplier || 1);
    const boundsActive = state.fireBoundsActive;
    const boundsPadding = Math.max(0, Math.round(state.fireSettings.boundsPadding));
    const minX = boundsActive ? clamp(state.fireMinX - boundsPadding, 0, cols - 1) : 0;
    const maxX = boundsActive ? clamp(state.fireMaxX + boundsPadding, 0, cols - 1) : cols - 1;
    const minY = boundsActive ? clamp(state.fireMinY - boundsPadding, 0, rows - 1) : 0;
    const maxY = boundsActive ? clamp(state.fireMaxY + boundsPadding, 0, rows - 1) : rows - 1;
    if (!boundsActive && state.lastActiveFires === 0) {
        // A check to see if any ignitions are scheduled could be added here,
        // but it would require a full scan. The logic below prevents the bounds
        // from being incorrectly deactivated, which solves the issue.
        return 0;
    }
    const currentTime = state.fireSeasonDay;
    const tileIgniteAt = state.tileIgniteAt;
    // --- Phase 1: Apply scheduled ignitions ---
    // Ignite any tiles whose scheduled time is up.
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const idx = indexFor(state.grid, x, y);
            if (tileIgniteAt[idx] <= currentTime) {
                const tile = state.tiles[idx];
                if (tile.fire === 0 && tile.fuel > 0 && isIgnitableTile(tile)) {
                    tile.fire = 0.2 + rng.next() * 0.25;
                }
                // Whether it ignited or not, clear the schedule
                tileIgniteAt[idx] = Number.POSITIVE_INFINITY;
            }
        }
    }
    // --- Phase 2: Spread heat from burning tiles ---
    const fireDelta = delta * spreadScale;
    applyHeatDiffusion(state, minX, maxX, minY, maxY, fireDelta, spreadScale, dayFactor);
    // --- Phase 3: Process tiles ---
    // Burn existing fires and schedule new ignitions for tiles that get hot enough.
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const idx = indexFor(state.grid, x, y);
            const tile = state.tiles[idx];
            const wasBurning = tile.fire > 0;
            if (wasBurning) {
                emitSmokeAt(state, rng, x + 0.5, y + 0.5, tile.fire);
                if (tile.fuel > 0) {
                    // burnTile returns true if the fire was extinguished
                    burnTile(state, tile, fireDelta);
                }
                else { // No fuel, fire should decay
                    tile.fire = Math.max(0, tile.fire - fireDelta * 0.5); // Simple decay
                    if (tile.fire <= 0.01) {
                        tile.fire = 0; // Truly extinguished
                    }
                }
            }
            if (burnoutFactor > 0 && tile.fire > 0) {
                const coolingDt = delta * (0.4 + burnoutFactor * 0.8);
                tile.heat = coolCellTemp(tile.heat, state.climateTemp, coolingDt, DEFAULT_COOLING_PARAMS);
                tile.fire = Math.max(0, tile.fire - fireDelta * (0.12 + burnoutFactor * 0.35));
                if (tile.fire <= 0.01) {
                    tile.fire = 0;
                }
            }
            if (!wasBurning && tile.fire <= 0 && tile.heat > 0) {
                const retention = typeof tile.heatRetention === "number" ? tile.heatRetention : 0.9;
                const coolingDt = delta * (0.35 + (1 - retention) * 0.35);
                tile.heat = coolCellTemp(tile.heat, state.climateTemp, coolingDt, DEFAULT_COOLING_PARAMS);
                if (tile.heat < tile.ignitionPoint) {
                    tileIgniteAt[idx] = Number.POSITIVE_INFINITY;
                }
            }
            if (!wasBurning &&
                tile.fuel > 0 &&
                tile.heat >= tile.ignitionPoint / ignitionBoost &&
                isIgnitableTile(tile)) {
                if (tileIgniteAt[idx] < Number.POSITIVE_INFINITY) {
                    continue; // Already scheduled
                }
                let hasNeighborFire = false;
                for (const offset of NEIGHBOR_OFFSETS) {
                    const nx = x + offset.dx;
                    const ny = y + offset.dy;
                    if (nx < minX || nx > maxX || ny < minY || ny > maxY) {
                        continue;
                    }
                    if (state.tiles[indexFor(state.grid, nx, ny)].fire > 0) {
                        hasNeighborFire = true;
                        break;
                    }
                }
                if (!hasNeighborFire) {
                    continue;
                }
                const hazard = (tile.heat - tile.ignitionPoint / ignitionBoost) * 0.55 * ignitionBoost;
                if (hazard <= 0) {
                    continue;
                }
                const U = 1.0 - rng.next();
                const delay = -Math.log(U) / hazard;
                tileIgniteAt[idx] = currentTime + delay;
            }
        }
    }
    // --- Phase 4: Recalculate bounds and count active fires ---
    // This is the critical fix. We check for *any* activity (current or scheduled)
    // before deactivating the fire simulation bounds.
    let activeFires = 0;
    let hasFutureActivity = false;
    let nextMinX = cols;
    let nextMaxX = -1;
    let nextMinY = rows;
    let nextMaxY = -1;
    // Iterate over the current active area to find the bounds of all activity.
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const idx = indexFor(state.grid, x, y);
            const isBurning = state.tiles[idx].fire > 0;
            const isScheduled = tileIgniteAt[idx] < Number.POSITIVE_INFINITY;
            if (isBurning || isScheduled) {
                hasFutureActivity = true;
                if (x < nextMinX)
                    nextMinX = x;
                if (x > nextMaxX)
                    nextMaxX = x;
                if (y < nextMinY)
                    nextMinY = y;
                if (y > nextMaxY)
                    nextMaxY = y;
                if (isBurning) {
                    activeFires += 1;
                }
            }
        }
    }
    if (hasFutureActivity) {
        state.fireBoundsActive = true;
        state.fireMinX = nextMinX;
        state.fireMaxX = nextMaxX;
        state.fireMinY = nextMinY;
        state.fireMaxY = nextMaxY;
    }
    else if (boundsActive) {
        clearHeatInBounds(state, minX, maxX, minY, maxY);
        resetFireBounds(state);
    }
    return activeFires;
}
export { igniteRandomFire };
export { resetFireBounds };
