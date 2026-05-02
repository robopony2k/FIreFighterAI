// @ts-nocheck
import { clamp } from "../core/utils.js";
import { coolCellTemp, DEFAULT_COOLING_PARAMS } from "../core/climate.js";
import {
    SUPPRESSION_WETNESS_BLOCK_THRESHOLD,
    SUPPRESSION_WETNESS_COOLING_BOOST,
    SUPPRESSION_WETNESS_HALF_LIFE_DAYS,
    SUPPRESSION_WETNESS_IGNITION_BONUS,
    SUPPRESSION_WETNESS_SPREAD_REDUCTION
} from "../core/config.js";
import { indexFor } from "../core/grid.js";
import { ensureTileSoA } from "../core/tileCache.js";
import { getFuelProfiles } from "../core/tiles.js";
import { TILE_TYPE_IDS } from "../core/state.js";
import { destroyHouse } from "../core/towns.js";
import { clearVegetationState } from "../core/vegetation.js";
import { advanceHouseDamage } from "../systems/settlements/sim/buildingLifecycle.js";
import { recordTownHouseLoss } from "./towns.js";
import { emitSmokeAt } from "./particles.js";
import type { EffectsState } from "../core/effectsState.js";
import { resetFireBounds } from "./fire/bounds.js";
import { igniteRandomFire } from "./fire/ignite.js";
import { sampleIgnitionFireSeed, sampleIgnitionHeatMultiplier } from "./fire/ignitionTuning.js";
import type { FireWeatherResponse } from "./fire/fireWeather.js";
import { buildFireWorkBlocks, ensureFireBlocks, finalizeFireBlocks, markFireBlockNextByTile } from "./fire/activeBlocks.js";
import { markAttributedFireLossTile, queueScoreFlowEvent } from "./scoring.js";
import { profEnd, profStart } from "./prof.js";
import { applyFireActivityMetrics } from "../systems/fire/sim/fireActivityState.js";
import { getElevationHeatTransferMultiplier, resolveTerrainAdjustedWind } from "../systems/fire/sim/fireTerrainInfluence.js";
import { getRangedHeatTransferScale } from "../systems/fire/sim/fireRangedHeatDiffusion.js";
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
const TYPE_WATER = TILE_TYPE_IDS.water;
const TYPE_ASH = TILE_TYPE_IDS.ash;
const TYPE_FIREBREAK = TILE_TYPE_IDS.firebreak;
const TYPE_BEACH = TILE_TYPE_IDS.beach;
const TYPE_ROCKY = TILE_TYPE_IDS.rocky;
const TYPE_BARE = TILE_TYPE_IDS.bare;
const TYPE_ROAD = TILE_TYPE_IDS.road;

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
const SUPPRESSION_WETNESS_ACTIVE_EPS = 0.01;
const ISOLATED_RESIDUAL_COOLING_BOOST = 0.55;
const WIND_BIAS_COMPONENT_MAX = 0.88;
const FIRE_INTENSITY_REFERENCE_DELTA_SECONDS = 0.05;
let baselineTickCounter = 0;

const getWetnessDecayFactor = (delta) => {
    const halfLife = Math.max(0.0001, SUPPRESSION_WETNESS_HALF_LIFE_DAYS);
    return Math.exp((-Math.LN2 * Math.max(0, delta)) / halfLife);
};

const applyWetnessToIgnitionThreshold = (baseIgnition, wetness, ignitionBoost) => (baseIgnition * (1 + SUPPRESSION_WETNESS_IGNITION_BONUS * wetness)) / Math.max(0.0001, ignitionBoost);

const getInertHeatCap = (tid, fuelValue) => {
    if (fuelValue > 0.02) {
        return Number.POSITIVE_INFINITY;
    }
    if (tid === TYPE_ASH) {
        return 0.18;
    }
    if (tid === TYPE_WATER || tid === TYPE_BEACH) {
        return 0.04;
    }
    return 0.08;
};

const createFxRng = (seed: number) => {
    let state = seed >>> 0;
    return {
        next: () => {
            let t = (state += 0x6d2b79f5);
            t = Math.imul(t ^ (t >>> 15), t | 1);
            t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        }
    };
};

const isIgnitableTile = (tile) =>
    tile.type !== "water" &&
        tile.type !== "beach" &&
        tile.type !== "rocky" &&
        tile.type !== "bare" &&
        tile.type !== "ash" &&
        tile.type !== "firebreak" &&
        tile.type !== "road";

function stepFireBaseline(state, rng, delta, spreadScale, dayFactor, burnoutFactor = 0, weatherResponse: FireWeatherResponse | null = null, climateIgnitionMultiplier = state.climateIgnitionMultiplier || 1) {
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
        state.tileHeatRelease.fill(0);
        state.tileBurnAge.fill(0);
        applyFireActivityMetrics(state, 0);
        return 0;
    }
    ensureTileSoA(state);
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
    const weatherIgnitionRaw = weatherResponse?.ignition ?? 1;
    const weatherIgnition = Math.max(0.01, weatherIgnitionRaw);
    const weatherCooling = Math.max(0.5, weatherResponse?.cooling ?? 1);
    const coolingAmbient = weatherResponse?.effectiveAmbient ?? state.climateTemp;
    const ignitionBoost = Math.max(0.2, climateIgnitionMultiplier * weatherIgnition);
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
            } else {
                currentFire = Math.max(0, prevFire - BASELINE_FIRE_DECAY);
                currentHeat = candidateHeat * BASELINE_HEAT_DECAY;
            }
            if (burnoutFactor > 0 && currentFire > 0) {
                const coolingDt = delta * (0.35 + burnoutFactor * 0.65) * weatherCooling;
                currentHeat = coolCellTemp(currentHeat, coolingAmbient, coolingDt, DEFAULT_COOLING_PARAMS);
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
    } else if (boundsActive) {
        clearHeatInBounds(state, minX, maxX, minY, maxY);
        resetFireBounds(state);
    }
    baselineTickCounter += 1;
    if (BASELINE_FIRE_DEBUG && baselineTickCounter % BASELINE_LOG_INTERVAL === 0) {
        const width = Math.max(0, state.fireMaxX - state.fireMinX + 1);
        const height = Math.max(0, state.fireMaxY - state.fireMinY + 1);
        const boundsArea = width * height;
        console.log(
            `[BASELINE] tick=${baselineTickCounter} burning=${activeFires} newIgnitions=${newIgnitions} boundsArea=${boundsArea}`
        );
    }
    applyFireActivityMetrics(state, activeFires);
    return activeFires;
}
export function stepFire(state, effects: EffectsState, rng, delta, spreadScale, dayFactor, burnoutFactor = 0, weatherResponse: FireWeatherResponse | null = null, climateIgnitionMultiplier = state.climateIgnitionMultiplier || 1) {
    if (BASELINE_FIRE) {
        return stepFireBaseline(state, rng, delta, spreadScale, dayFactor, burnoutFactor, weatherResponse, climateIgnitionMultiplier);
    }
    const tickStart = profStart();
    const fuelProfiles = getFuelProfiles();
    const ashProfile = fuelProfiles.ash;
    ensureFireBlocks(state);
    if (state.tileSoaDirty) {
        ensureTileSoA(state);
    }
    const perf = state.simPerf;
    const fireQuality = perf.fireQuality ?? perf.quality ?? 1;
    const heatEps = Math.max(0.002, perf.diffusionEps || 0.02);
    const fireEps = Math.max(0.001, heatEps * 0.5);
    if (state.fireBlockActiveCount === 0) {
        state.tileHeatRelease.fill(0);
        state.tileBurnAge.fill(0);
        applyFireActivityMetrics(state, 0);
        profEnd("fireTick", tickStart);
        return 0;
    }
    const cols = state.grid.cols;
    const rows = state.grid.rows;
    const heatCap = Math.max(0.01, state.fireSettings.heatCap);
    const weatherIgnitionRaw = weatherResponse?.ignition ?? 1;
    const weatherIgnition = Math.max(0.01, weatherIgnitionRaw);
    const weatherSpread = Math.max(0.15, weatherResponse?.spread ?? 1);
    const weatherSustain = Math.max(0.15, weatherResponse?.sustain ?? 1);
    const weatherCooling = Math.max(0.5, weatherResponse?.cooling ?? 1);
    const winterDamping = weatherIgnitionRaw < 0.12 ? (0.12 - weatherIgnitionRaw) / 0.12 : 0;
    const coolingAmbient = weatherResponse?.effectiveAmbient ?? state.climateTemp;
    const ignitionBoost = Math.max(0.2, climateIgnitionMultiplier * weatherIgnition);
    const fire = state.tileFire;
    const fuel = state.tileFuel;
    const heat = state.tileHeat;
    const burnAge = state.tileBurnAge;
    const heatRelease = state.tileHeatRelease;
    const ignitionPoint = state.tileIgnitionPoint;
    const burnRate = state.tileBurnRate;
    const heatOutput = state.tileHeatOutput;
    const moisture = state.tileMoisture;
    const spreadBoost = state.tileSpreadBoost;
    const heatRetention = state.tileHeatRetention;
    const windbreakFactor = state.tileWindFactor;
    const elevation = state.tileElevation;
    const heatTransferCap = state.tileHeatTransferCap;
    const suppressionWetness = state.tileSuppressionWetness;
    const typeId = state.tileTypeId;
    const igniteBuffer = state.igniteBuffer;
    let igniteCount = 0;
    const fireDelta = delta * spreadScale;
    const diffuseCardinal = Math.max(0, state.fireSettings.diffusionCardinal);
    const diffuseDiagonal = Math.max(0, state.fireSettings.diffusionDiagonal);
    const diffuseSecondary = Math.max(0, state.fireSettings.diffusionSecondary);
    const diffuseMoisture = Math.max(0, state.fireSettings.diffusionMoisture);
    const windDx = state.wind.dx;
    const windDy = state.wind.dy;
    const windStrength = state.wind.strength;
    const terrainWindScratch = { dx: windDx, dy: windDy, strength: windStrength };
    const wetnessDecayFactor = getWetnessDecayFactor(delta);
    const smokeSampleRate = Math.max(1, Math.floor(perf.smokeSampleRate || 1));
    const smokeSeed = (state.fireSeasonDay * 1000) | 0;
    let activeFires = 0;
    let fireMinX = cols;
    let fireMaxX = -1;
    let fireMinY = rows;
    let fireMaxY = -1;
    state.fireBlockNextCount = 0;
    const isIgnitableTypeId = (tid) =>
        tid !== TYPE_WATER &&
            tid !== TYPE_ASH &&
            tid !== TYPE_FIREBREAK &&
            tid !== TYPE_BEACH &&
            tid !== TYPE_ROCKY &&
            tid !== TYPE_BARE &&
            tid !== TYPE_ROAD;
    const hasNeighborFireAt = (x, y) => {
        if (fireQuality === 0) {
            if (x < cols - 1 && fire[y * cols + x + 1] > fireEps)
                return true;
            if (x > 0 && fire[y * cols + x - 1] > fireEps)
                return true;
            if (y < rows - 1 && fire[(y + 1) * cols + x] > fireEps)
                return true;
            if (y > 0 && fire[(y - 1) * cols + x] > fireEps)
                return true;
            return false;
        }
        for (const offset of NEIGHBOR_OFFSETS) {
            const nx = x + offset.dx;
            const ny = y + offset.dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
                continue;
            }
            if (fire[ny * cols + nx] > fireEps) {
                return true;
            }
        }
        return false;
    };
    const getExposureFactorsAt = (x, y) => {
        let ignitableNeighbors = 0;
        let exposedFuelNeighbors = 0;
        let burningNeighbors = 0;
        const offsets = fireQuality === 0 ? CARDINAL_DIRS : NEIGHBOR_OFFSETS;
        for (const offset of offsets) {
            const nx = x + offset.dx;
            const ny = y + offset.dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
                continue;
            }
            const nIdx = ny * cols + nx;
            const nTypeId = typeId[nIdx];
            if (!isIgnitableTypeId(nTypeId) || fuel[nIdx] <= 0.02) {
                continue;
            }
            ignitableNeighbors += 1;
            if (fire[nIdx] > fireEps) {
                burningNeighbors += 1;
            } else {
                exposedFuelNeighbors += 1;
            }
        }
        const neighborCount = Math.max(1, ignitableNeighbors);
        return {
            exposedFuel01: exposedFuelNeighbors / neighborCount,
            support01: burningNeighbors / neighborCount,
            hasExposure: exposedFuelNeighbors > 0
        };
    };
    const addHeat = (idx, value) => {
        if (value <= 0) {
            return;
        }
        const tid = typeId[idx];
        const fuelValue = fuel[idx];
        const inertHeatCap = getInertHeatCap(tid, fuelValue);
        const inertFactor = Number.isFinite(inertHeatCap)
            ? (tid === TYPE_ASH ? 0.08 : 0.03)
            : 1;
        const wetnessValue = Math.max(0, suppressionWetness[idx] || 0);
        const wetnessFactor = Math.max(0, 1 - SUPPRESSION_WETNESS_SPREAD_REDUCTION * wetnessValue);
        let next = heat[idx] + value * wetnessFactor * inertFactor;
        if (Number.isFinite(inertHeatCap)) {
            next = Math.min(next, inertHeatCap);
        }
        if (next > heatCap) {
            next = heatCap;
        }
        heat[idx] = next;
        if (next > heatEps) {
            markFireBlockNextByTile(state, idx);
        }
    };
    const addTerrainHeat = (sourceIdx, targetIdx, value, distanceTiles) => {
        if (value <= 0) {
            return;
        }
        const elevationMultiplier = getElevationHeatTransferMultiplier(
            elevation[sourceIdx],
            elevation[targetIdx],
            distanceTiles,
            state.fireSettings
        );
        addHeat(targetIdx, value * elevationMultiplier);
    };
    const maxRangedDiffusionTiles = Math.max(1, Math.floor(state.fireSettings.rangedDiffusionMaxTiles || 1));
    const addRangedTerrainHeat = (
        sourceIdx,
        sourceX,
        sourceY,
        dx,
        dy,
        distanceTiles,
        localWind,
        heatReleaseValue,
        directionalScale,
        neighborBoost
    ) => {
        const targetX = sourceX + dx * distanceTiles;
        const targetY = sourceY + dy * distanceTiles;
        if (targetX < 0 || targetY < 0 || targetX >= cols || targetY >= rows) {
            return;
        }
        const targetIdx = targetY * cols + targetX;
        if (!isIgnitableTypeId(typeId[targetIdx]) || fuel[targetIdx] <= 0.02 || fire[targetIdx] > fireEps) {
            return;
        }
        const rangedScale = getRangedHeatTransferScale({
            settings: state.fireSettings,
            sourceX,
            sourceY,
            dx,
            dy,
            distanceTiles,
            cols,
            rows,
            windDx: localWind.dx,
            windDy: localWind.dy,
            windStrength: localWind.strength,
            heatRelease: heatReleaseValue,
            weatherSpread,
            targetMoisture: moisture[targetIdx] || 0,
            windbreakFactor
        });
        if (rangedScale <= 0) {
            return;
        }
        addTerrainHeat(sourceIdx, targetIdx, heatReleaseValue * directionalScale * neighborBoost * diffuseSecondary * rangedScale, distanceTiles);
    };
    const hasRangedFireExposureAt = (x, y) => {
        if (fireQuality <= 1 || diffuseSecondary <= 0 || maxRangedDiffusionTiles < 2) {
            return false;
        }
        for (const dir of CARDINAL_DIRS) {
            for (let distance = 2; distance <= maxRangedDiffusionTiles; distance += 1) {
                const sourceX = x - dir.dx * distance;
                const sourceY = y - dir.dy * distance;
                if (sourceX < 0 || sourceY < 0 || sourceX >= cols || sourceY >= rows) {
                    continue;
                }
                const sourceIdx = sourceY * cols + sourceX;
                if (fire[sourceIdx] <= fireEps) {
                    continue;
                }
                const previousRelease = heatRelease[sourceIdx] || fire[sourceIdx] * Math.max(0.1, heatOutput[sourceIdx] || 0);
                const exposureScale = getRangedHeatTransferScale({
                    settings: state.fireSettings,
                    sourceX,
                    sourceY,
                    dx: dir.dx,
                    dy: dir.dy,
                    distanceTiles: distance,
                    cols,
                    rows,
                    windDx,
                    windDy,
                    windStrength,
                    heatRelease: previousRelease,
                    weatherSpread,
                    targetMoisture: moisture[y * cols + x] || 0,
                    windbreakFactor
                });
                if (exposureScale > 0) {
                    return true;
                }
            }
        }
        return false;
    };
    buildFireWorkBlocks(state);
    state.firePerfActiveBlocks = state.fireBlockActiveCount;
    state.firePerfWorkBlocks = state.fireBlockWorkCount;
    const loopStart = profStart();
    for (let b = 0; b < state.fireBlockWorkCount; b += 1) {
        const blockIndex = state.fireBlockWorkList[b];
        const blockX = blockIndex % state.fireBlockCols;
        const blockY = Math.floor(blockIndex / state.fireBlockCols);
        const minX = blockX * state.fireBlockSize;
        const minY = blockY * state.fireBlockSize;
        const maxX = Math.min(cols - 1, minX + state.fireBlockSize - 1);
        const maxY = Math.min(rows - 1, minY + state.fireBlockSize - 1);
        for (let y = minY; y <= maxY; y += 1) {
            let idx = y * cols + minX;
            for (let x = minX; x <= maxX; x += 1, idx += 1) {
                let fireValue = fire[idx];
                let fuelValue = fuel[idx];
                let heatValue = heat[idx];
                let wetnessValue = Math.max(0, suppressionWetness[idx] || 0);
                if (wetnessValue > 0) {
                    wetnessValue *= wetnessDecayFactor;
                    if (wetnessValue < SUPPRESSION_WETNESS_ACTIVE_EPS) {
                        wetnessValue = 0;
                    }
                    suppressionWetness[idx] = wetnessValue;
                }
                const tid = typeId[idx];
                let burnAgeValue = Math.max(0, burnAge[idx] || 0);
                let heatReleaseValue = 0;
                const wetnessBlocked = wetnessValue > SUPPRESSION_WETNESS_BLOCK_THRESHOLD;
                const effectiveIgnitionThreshold = applyWetnessToIgnitionThreshold(ignitionPoint[idx], wetnessValue, ignitionBoost);
                const hasNeighborFire = hasNeighborFireAt(x, y);
                const burning = fireValue > fireEps;
                if (burning) {
                    burnAgeValue += delta;
                    if (smokeSampleRate <= 1 || ((idx + smokeSeed) % smokeSampleRate) === 0) {
                        const smokeRng = createFxRng(state.seed ^ (idx * 73856093) ^ smokeSeed);
                        emitSmokeAt(state, effects, smokeRng, x + 0.5, y + 0.5, fireValue);
                    }
                    const { exposedFuel01, support01, hasExposure } = getExposureFactorsAt(x, y);
                    const wetnessSpreadFactor = Math.max(0, 1 - SUPPRESSION_WETNESS_SPREAD_REDUCTION * wetnessValue);
                    const moistureFactor = fireQuality === 0 ? 1 : Math.max(0, 1 - moisture[idx] * diffuseMoisture);
                    const intensityFloor = 0.25 * clamp(delta / FIRE_INTENSITY_REFERENCE_DELTA_SECONDS, 0, 1);
                    const intensity = Math.max(intensityFloor, fireDelta * (0.45 + spreadScale * 0.12));
                    const dayBoost = 0.65 + dayFactor * 0.4;
                    const spreadMultiplier = fireQuality === 0 ? 1 : Math.max(0, spreadBoost[idx] || 1);
                    const ignition = Math.max(ignitionPoint[idx], 0.0001);
                    const heatRatio = heatValue / (ignition * 1.6);
                    const overheatFactor = Math.max(0, (heatValue - ignition) / ignition);
                    const recordedStartFuel = state.scoring.burnStartFuel[idx] ?? -1;
                    const nominalFuel = Math.max(
                        0.08,
                        recordedStartFuel > 0
                            ? recordedStartFuel
                            : fuelValue + burnRate[idx] * (0.45 + Math.min(1.5, burnAgeValue) * 0.18)
                    );
                    const fuelRemaining01 = clamp(fuelValue / nominalFuel, 0, 1);
                    const freshBurn01 = 1 - clamp((burnAgeValue - 0.2) / Math.max(0.75, 2.6 - burnRate[idx] * 0.9), 0, 1);
                    const releaseDrive = clamp(
                        0.24 +
                            heatRatio * 0.42 +
                            exposedFuel01 * 0.52 +
                            freshBurn01 * 0.34 +
                            fuelRemaining01 * 0.18 -
                            wetnessValue * 0.3,
                        0,
                        1.65
                    );
                    const baseHeat =
                        (0.18 + fireValue * 0.38 + overheatFactor * 0.12) * heatOutput[idx] * wetnessSpreadFactor;
                    heatReleaseValue =
                        baseHeat *
                        releaseDrive *
                        spreadMultiplier *
                        moistureFactor *
                        intensity *
                        dayBoost *
                        weatherSpread *
                        (0.48 + weatherSustain * 0.52);
                    const neighborBoost =
                        0.9 + Math.min(0.8, fireValue * 0.38 + exposedFuel01 * 0.34 + spreadScale * 0.18);
                    heatValue = Math.min(
                        heatCap,
                        heatValue + heatReleaseValue * (0.08 + weatherSustain * 0.14 + exposedFuel01 * 0.08)
                    );
                    heat[idx] = heatValue;
                    if (heatReleaseValue > 0) {
                        const cardinalScale = diffuseCardinal * (1 + spreadScale * 0.12);
                        const diagonalScale = diffuseDiagonal * (1 + spreadScale * 0.08);
                        const localWind = fireQuality > 0
                            ? resolveTerrainAdjustedWind(
                                x,
                                y,
                                idx,
                                cols,
                                rows,
                                elevation,
                                windDx,
                                windDy,
                                windStrength,
                                state.fireSettings,
                                terrainWindScratch
                            )
                            : terrainWindScratch;
                        const wx = fireQuality === 0 ? 0 : clamp(localWind.strength * localWind.dx, -WIND_BIAS_COMPONENT_MAX, WIND_BIAS_COMPONENT_MAX);
                        const wy = fireQuality === 0 ? 0 : clamp(localWind.strength * localWind.dy, -WIND_BIAS_COMPONENT_MAX, WIND_BIAS_COMPONENT_MAX);
                        const wE = Math.max(0, cardinalScale * (1 + wx));
                        const wW = Math.max(0, cardinalScale * (1 - wx));
                        const wS = Math.max(0, cardinalScale * (1 + wy));
                        const wN = Math.max(0, cardinalScale * (1 - wy));
                        const wNE = Math.max(0, diagonalScale * (1 + wx + wy));
                        const wNW = Math.max(0, diagonalScale * (1 - wx + wy));
                        const wSE = Math.max(0, diagonalScale * (1 + wx - wy));
                        const wSW = Math.max(0, diagonalScale * (1 - wx - wy));
                        if (x < cols - 1) {
                            addTerrainHeat(idx, idx + 1, heatReleaseValue * wE * neighborBoost, 1);
                        }
                        if (x > 0) {
                            addTerrainHeat(idx, idx - 1, heatReleaseValue * wW * neighborBoost, 1);
                        }
                        if (y < rows - 1) {
                            addTerrainHeat(idx, idx + cols, heatReleaseValue * wS * neighborBoost, 1);
                        }
                        if (y > 0) {
                            addTerrainHeat(idx, idx - cols, heatReleaseValue * wN * neighborBoost, 1);
                        }
                        if (fireQuality > 0) {
                            if (x < cols - 1 && y < rows - 1) {
                                addTerrainHeat(idx, idx + cols + 1, heatReleaseValue * wSE * neighborBoost, Math.SQRT2);
                            }
                            if (x > 0 && y < rows - 1) {
                                addTerrainHeat(idx, idx + cols - 1, heatReleaseValue * wSW * neighborBoost, Math.SQRT2);
                            }
                            if (x < cols - 1 && y > 0) {
                                addTerrainHeat(idx, idx - cols + 1, heatReleaseValue * wNE * neighborBoost, Math.SQRT2);
                            }
                            if (x > 0 && y > 0) {
                                addTerrainHeat(idx, idx - cols - 1, heatReleaseValue * wNW * neighborBoost, Math.SQRT2);
                            }
                        }
                        if (fireQuality > 1 && diffuseSecondary > 0 && maxRangedDiffusionTiles >= 2) {
                            for (let distance = 2; distance <= maxRangedDiffusionTiles; distance += 1) {
                                addRangedTerrainHeat(idx, x, y, 1, 0, distance, localWind, heatReleaseValue, wE, neighborBoost);
                                addRangedTerrainHeat(idx, x, y, -1, 0, distance, localWind, heatReleaseValue, wW, neighborBoost);
                                addRangedTerrainHeat(idx, x, y, 0, 1, distance, localWind, heatReleaseValue, wS, neighborBoost);
                                addRangedTerrainHeat(idx, x, y, 0, -1, distance, localWind, heatReleaseValue, wN, neighborBoost);
                            }
                        }
                    }
                    let targetFire = clamp(
                        (0.12 +
                            heatRatio * 0.36 +
                            exposedFuel01 * 0.38 +
                            freshBurn01 * 0.22 +
                            fuelRemaining01 * 0.18 -
                            wetnessValue * 0.28) *
                            (0.62 + fuelRemaining01 * 0.42),
                        0,
                        1
                    );
                    targetFire *= 1 - clamp((burnAgeValue - 1.8) / 4.2, 0, 1) * 0.45;
                    if (!hasExposure) {
                        targetFire *= 0.84;
                    }
                    const fireRiseRate =
                        burnRate[idx] * (0.48 + heatRatio * 0.22 + exposedFuel01 * 0.24 + freshBurn01 * 0.16);
                    const fireFallRate =
                        burnRate[idx] *
                        (0.22 + (1 - fuelRemaining01) * 0.7 + (1 - freshBurn01) * 0.22 + (hasExposure ? 0 : 0.16));
                    if (fireValue < targetFire) {
                        fireValue = Math.min(targetFire, fireValue + fireDelta * fireRiseRate);
                    } else {
                        fireValue = Math.max(targetFire, fireValue - fireDelta * fireFallRate);
                    }
                    const climateDecay = Math.max(0, (1 - weatherSustain) * 0.35 + Math.max(0, weatherCooling - 1) * 0.12);
                    if (climateDecay > 0) {
                        fireValue = Math.max(0, fireValue - fireDelta * climateDecay);
                    }
                    const fuelDrain =
                        fireDelta *
                        burnRate[idx] *
                        (0.38 +
                            fireValue * 0.74 +
                            exposedFuel01 * 0.28 +
                            overheatFactor * state.fireSettings.conflagrationFuelBoost * 0.55 +
                            (1 - fuelRemaining01) * 0.12);
                    fuelValue = Math.max(0, fuelValue - fuelDrain);
                } else if (fireValue > 0) {
                    fireValue = Math.max(0, fireValue - fireDelta * 0.5 * Math.max(1, weatherCooling * 0.8));
                    if (fireValue <= fireEps) {
                        fireValue = 0;
                    }
                }
                if (burning && weatherCooling > 1) {
                    const coolingDt = delta * (weatherCooling - 1) * 0.45;
                    if (coolingDt > 0) {
                        if (fireQuality >= 2) {
                            heatValue = coolCellTemp(heatValue, coolingAmbient, coolingDt, DEFAULT_COOLING_PARAMS);
                        } else {
                            heatValue = Math.max(0, heatValue - coolingDt * 0.36);
                        }
                    }
                }
                if (burning && winterDamping > 0) {
                    const winterCoolingDt = delta * (0.65 + winterDamping * 0.9);
                    if (fireQuality >= 2) {
                        heatValue = coolCellTemp(heatValue, coolingAmbient, winterCoolingDt, DEFAULT_COOLING_PARAMS);
                    } else {
                        heatValue = Math.max(0, heatValue - winterCoolingDt * 0.4);
                    }
                    const winterHeatMultiplier = Math.max(0, 1 - delta * (0.55 + winterDamping * 0.65));
                    heatValue *= winterHeatMultiplier;
                }
                if (burnoutFactor > 0 && fireValue > fireEps) {
                    const coolingDt = delta * (0.4 + burnoutFactor * 0.8) * weatherCooling;
                    if (fireQuality >= 2) {
                        heatValue = coolCellTemp(heatValue, coolingAmbient, coolingDt, DEFAULT_COOLING_PARAMS);
                    } else {
                        heatValue = Math.max(0, heatValue - coolingDt * 0.35);
                    }
                    fireValue = Math.max(0, fireValue - fireDelta * (0.12 + burnoutFactor * 0.35) * Math.max(1, weatherCooling * 1.1));
                    if (fireValue <= fireEps) {
                        fireValue = 0;
                    }
                }
                if (wetnessValue > 0 && heatValue > 0) {
                    const wetCoolingDt = delta * SUPPRESSION_WETNESS_COOLING_BOOST * (0.35 + wetnessValue * 0.65) * weatherCooling;
                    if (fireQuality >= 2) {
                        heatValue = coolCellTemp(heatValue, coolingAmbient, wetCoolingDt, DEFAULT_COOLING_PARAMS);
                    } else {
                        heatValue = Math.max(0, heatValue - wetCoolingDt * 0.42);
                    }
                    if (fireValue > fireEps) {
                        fireValue = Math.max(0, fireValue - delta * wetnessValue * 0.22);
                        if (fireValue <= fireEps) {
                            fireValue = 0;
                        }
                    }
                }
                if (!burning && fireValue <= fireEps && heatValue > 0) {
                    const retention = Number.isFinite(heatRetention[idx]) ? heatRetention[idx] : 0.9;
                    const isolatedResidual = !hasNeighborFire && wetnessValue <= SUPPRESSION_WETNESS_ACTIVE_EPS;
                    if (fireQuality >= 2) {
                        const coolingDt = delta *
                            (0.35 +
                                (1 - retention) * 0.35 +
                                wetnessValue * SUPPRESSION_WETNESS_COOLING_BOOST * 0.3 +
                                (isolatedResidual ? ISOLATED_RESIDUAL_COOLING_BOOST : 0)) *
                            weatherCooling;
                        heatValue = coolCellTemp(heatValue, coolingAmbient, coolingDt, DEFAULT_COOLING_PARAMS);
                    } else {
                        heatValue *= Math.max(0, Math.min(1, (0.92 + retention * 0.08) -
                            (weatherCooling - 1) * 0.08 -
                            wetnessValue * 0.08 -
                            (isolatedResidual ? 0.04 : 0)));
                    }
                    if (weatherIgnitionRaw < 0.04) {
                        heatValue = Math.min(heatValue, ignitionPoint[idx] * 0.1);
                    }
                }
                if (burning) {
                    const ignition = Math.max(ignitionPoint[idx], 0.0001);
                    const overheatFactor = Math.max(0, (heatValue - ignition) / ignition);
                    if (winterDamping > 0) {
                        fireValue = Math.max(0, fireValue - delta * (0.55 + winterDamping * 1.1));
                        const winterFireMultiplier = Math.max(0, 1 - delta * (1.1 + winterDamping * 1.35));
                        fireValue *= winterFireMultiplier;
                        if (winterDamping > 0.6 && (fireValue < 0.75 || heatValue < ignition * 2.2)) {
                            fireValue = 0;
                            heatValue = Math.min(heatValue, ignition * 0.2);
                        }
                    }
                    if (weatherIgnitionRaw < 0.04) {
                        fireValue = 0;
                        heatValue = Math.min(heatValue, ignition * 0.15);
                    }
                    if (state.tiles[idx].type === "house" && !state.tiles[idx].houseDestroyed) {
                        advanceHouseDamage(state.tiles[idx], clamp(fireValue * 0.48 + overheatFactor * 0.24, 0, 1));
                    }
                    if (fuelValue <= 0.02 && tid !== TILE_TYPE_IDS.ash) {
                        const tile = state.tiles[idx];
                        if (tile.type === "house" && !tile.houseDestroyed) {
                            const townId = state.tileTownId[idx] ?? -1;
                            if (townId >= 0) {
                                recordTownHouseLoss(state, townId);
                            }
                            if (!destroyHouse(state, idx)) {
                                state.totalPropertyValue = Math.max(0, state.totalPropertyValue - Math.max(0, tile.houseValue));
                                state.totalPopulation = Math.max(0, state.totalPopulation - Math.max(0, tile.houseResidents));
                            }
                            tile.houseDestroyed = true;
                            state.destroyedHouses += 1;
                            state.lostPropertyValue += tile.houseValue;
                            state.lostResidents += tile.houseResidents;
                            state.yearPropertyLost += tile.houseValue;
                            state.yearLivesLost += tile.houseResidents;
                            markAttributedFireLossTile(state, idx);
                            queueScoreFlowEvent(state, "property", 1, undefined, x, y);
                            if (tile.houseResidents > 0) {
                                queueScoreFlowEvent(state, "lives", tile.houseResidents, undefined, x, y);
                            }
                        }
                        if (tile.type === "house") {
                            tile.fuel = 0;
                            clearVegetationState(tile);
                            tile.dominantTreeType = null;
                            tile.treeType = null;
                            tile.heat = Math.min(tile.heat * 0.4, 0.28);
                            state.terrainDirty = true;
                            state.terrainTypeRevision += 1;
                            state.vegetationRevision += 1;
                            tile.spreadBoost = ashProfile.spreadBoost;
                            tile.ignitionPoint = ashProfile.ignition;
                            tile.burnRate = ashProfile.burnRate;
                            tile.heatOutput = ashProfile.heatOutput;
                            tile.heatTransferCap = ashProfile.heatTransferCap;
                            tile.heatRetention = ashProfile.heatRetention;
                            tile.windFactor = ashProfile.windFactor;
                            typeId[idx] = TILE_TYPE_IDS.house;
                            suppressionWetness[idx] = 0;
                            ignitionPoint[idx] = tile.ignitionPoint;
                            burnRate[idx] = tile.burnRate;
                            heatOutput[idx] = tile.heatOutput;
                            state.tileVegetationAge[idx] = 0;
                            state.tileCanopyCover[idx] = 0;
                            state.tileStemDensity[idx] = 0;
                            spreadBoost[idx] = tile.spreadBoost ?? 1;
                            heatRetention[idx] = tile.heatRetention ?? 0.9;
                            windbreakFactor[idx] = tile.windFactor ?? 0;
                            heatTransferCap[idx] = tile.heatTransferCap ?? 0;
                            fireValue = 0;
                            fuelValue = 0;
                            heatValue = tile.heat;
                            burnAgeValue = 0;
                            heatReleaseValue = 0;
                            heat[idx] = heatValue;
                        } else {
                            tile.type = "ash";
                            tile.fuel = 0;
                            tile.ashAge = 0;
                            clearVegetationState(tile);
                            tile.dominantTreeType = null;
                            tile.treeType = null;
                            tile.heat = Math.min(tile.heat * 0.1, 0.18);
                            if (!tile.isBase) {
                                state.burnedTiles += 1;
                                state.yearBurnedTiles += 1;
                            }
                            state.terrainDirty = true;
                            state.terrainTypeRevision += 1;
                            state.vegetationRevision += 1;
                            tile.spreadBoost = ashProfile.spreadBoost;
                            tile.ignitionPoint = ashProfile.ignition;
                            tile.burnRate = ashProfile.burnRate;
                            tile.heatOutput = ashProfile.heatOutput;
                            tile.heatTransferCap = ashProfile.heatTransferCap;
                            tile.heatRetention = ashProfile.heatRetention;
                            tile.windFactor = ashProfile.windFactor;
                            typeId[idx] = TILE_TYPE_IDS.ash;
                            suppressionWetness[idx] = 0;
                            ignitionPoint[idx] = tile.ignitionPoint;
                            burnRate[idx] = tile.burnRate;
                            heatOutput[idx] = tile.heatOutput;
                            state.tileVegetationAge[idx] = 0;
                            state.tileCanopyCover[idx] = 0;
                            state.tileStemDensity[idx] = 0;
                            spreadBoost[idx] = tile.spreadBoost ?? 1;
                            heatRetention[idx] = tile.heatRetention ?? 0.9;
                            windbreakFactor[idx] = tile.windFactor ?? 0;
                            heatTransferCap[idx] = tile.heatTransferCap ?? 0;
                            fireValue = 0;
                            fuelValue = 0;
                            heatValue = tile.heat;
                            burnAgeValue = 0;
                            heatReleaseValue = 0;
                            heat[idx] = heatValue;
                        }
                    }
                }
                if (
                    !burning &&
                    !wetnessBlocked &&
                    fuelValue > 0 &&
                    heatValue >= effectiveIgnitionThreshold &&
                    isIgnitableTypeId(tid) &&
                    (hasNeighborFire || hasRangedFireExposureAt(x, y)) &&
                    weatherIgnition >= 0.12
                ) {
                    igniteBuffer[igniteCount] = idx;
                    igniteCount += 1;
                }
                if (fireValue <= fireEps) {
                    fireValue = 0;
                    burnAgeValue = 0;
                    heatReleaseValue = 0;
                }
                if (fireValue > fireEps) {
                    activeFires += 1;
                    if (x < fireMinX)
                        fireMinX = x;
                    if (x > fireMaxX)
                        fireMaxX = x;
                    if (y < fireMinY)
                        fireMinY = y;
                    if (y > fireMaxY)
                        fireMaxY = y;
                    markFireBlockNextByTile(state, idx);
                } else if (heatValue > heatEps || wetnessValue > SUPPRESSION_WETNESS_ACTIVE_EPS) {
                    markFireBlockNextByTile(state, idx);
                }
                fire[idx] = fireValue;
                fuel[idx] = fuelValue;
                heat[idx] = heatValue;
                burnAge[idx] = burnAgeValue;
                heatRelease[idx] = heatReleaseValue;
                const tile = state.tiles[idx];
                const inertHeatCap = getInertHeatCap(tid, fuelValue);
                if (Number.isFinite(inertHeatCap)) {
                    heat[idx] = Math.min(heat[idx], inertHeatCap);
                }
                tile.fire = fireValue;
                tile.fuel = fuelValue;
                tile.heat = heat[idx];
                if (fireQuality >= 2 && heatTransferCap[idx] > 0 && heatValue > heatTransferCap[idx]) {
                    heat[idx] = heatTransferCap[idx];
                    tile.heat = heatTransferCap[idx];
                }
            }
        }
    }
    profEnd("fireLoop", loopStart);
    const igniteStart = profStart();
    for (let i = 0; i < igniteCount; i += 1) {
        const idx = igniteBuffer[i];
        if (fire[idx] > fireEps || fuel[idx] <= 0) {
            continue;
        }
        if (!isIgnitableTypeId(typeId[idx])) {
            continue;
        }
        const wetnessValue = Math.max(0, suppressionWetness[idx] || 0);
        if (wetnessValue > SUPPRESSION_WETNESS_BLOCK_THRESHOLD) {
            continue;
        }
        if (heat[idx] < applyWetnessToIgnitionThreshold(ignitionPoint[idx], wetnessValue, ignitionBoost)) {
            continue;
        }
        const seeded = sampleIgnitionFireSeed(rng, "spread");
        fire[idx] = seeded;
        const ignitionHeat = ignitionPoint[idx] * sampleIgnitionHeatMultiplier(rng);
        heat[idx] = Math.min(heatCap, Math.max(heat[idx], ignitionHeat));
        burnAge[idx] = 0;
        heatRelease[idx] = Math.max(heatRelease[idx] ?? 0, seeded * Math.max(0.1, heatOutput[idx] ?? 0));
        const tile = state.tiles[idx];
        tile.fire = fire[idx];
        tile.heat = heat[idx];
        markFireBlockNextByTile(state, idx);
        activeFires += 1;
        const x = idx % cols;
        const y = Math.floor(idx / cols);
        if (x < fireMinX)
            fireMinX = x;
        if (x > fireMaxX)
            fireMaxX = x;
        if (y < fireMinY)
            fireMinY = y;
        if (y > fireMaxY)
            fireMaxY = y;
    }
    profEnd("fireIgnite", igniteStart);
    finalizeFireBlocks(state);
    state.firePerfActiveBlocks = state.fireBlockActiveCount;
    let heatBoundsArea = 0;
    let heatMinX = 0;
    let heatMaxX = -1;
    let heatMinY = 0;
    let heatMaxY = -1;
    if (state.fireBlockActiveCount > 0) {
        let minBlockX = state.fireBlockCols;
        let maxBlockX = -1;
        let minBlockY = state.fireBlockRows;
        let maxBlockY = -1;
        for (let i = 0; i < state.fireBlockActiveCount; i += 1) {
            const blockIndex = state.fireBlockActiveList[i];
            const bx = blockIndex % state.fireBlockCols;
            const by = Math.floor(blockIndex / state.fireBlockCols);
            if (bx < minBlockX)
                minBlockX = bx;
            if (bx > maxBlockX)
                maxBlockX = bx;
            if (by < minBlockY)
                minBlockY = by;
            if (by > maxBlockY)
                maxBlockY = by;
        }
        if (maxBlockX >= minBlockX && maxBlockY >= minBlockY) {
            heatMinX = minBlockX * state.fireBlockSize;
            heatMaxX = Math.min(cols - 1, (maxBlockX + 1) * state.fireBlockSize - 1);
            heatMinY = minBlockY * state.fireBlockSize;
            heatMaxY = Math.min(rows - 1, (maxBlockY + 1) * state.fireBlockSize - 1);
            heatBoundsArea = (heatMaxX - heatMinX + 1) * (heatMaxY - heatMinY + 1);
        }
    }
    state.firePerfHeatBoundsArea = heatBoundsArea;
    state.firePerfFireBoundsArea =
        fireMaxX >= fireMinX && fireMaxY >= fireMinY ? (fireMaxX - fireMinX + 1) * (fireMaxY - fireMinY + 1) : 0;
    if (fireMaxX >= fireMinX && fireMaxY >= fireMinY) {
        state.fireBoundsActive = true;
        state.fireMinX = fireMinX;
        state.fireMaxX = fireMaxX;
        state.fireMinY = fireMinY;
        state.fireMaxY = fireMaxY;
    } else if (heatBoundsArea > 0) {
        state.fireBoundsActive = true;
        state.fireMinX = heatMinX;
        state.fireMaxX = heatMaxX;
        state.fireMinY = heatMinY;
        state.fireMaxY = heatMaxY;
    } else {
        resetFireBounds(state);
    }
    applyFireActivityMetrics(state, activeFires);
    profEnd("fireTick", tickStart);
    return activeFires;
}
export { igniteRandomFire };
export { resetFireBounds };
