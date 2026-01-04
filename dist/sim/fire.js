import { FIRE_IGNITION_CHANCE_PER_DAY, FIRE_JUMP_BASE_CHANCE, FIRE_JUMP_DOT_THRESHOLD, FIRE_JUMP_HEAT_BOOST, FIRE_JUMP_WIND_THRESHOLD, FIRE_DAY_FACTOR_MAX, NEIGHBOR_DIRS } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { inBounds, indexFor } from "../core/grid.js";
import { emitSmokeAt } from "./particles.js";
import { clearHeatInBounds } from "./heat.js";
const FIRE_BOUNDS_PADDING = 6;
function markFireBounds(state, x, y) {
    if (!state.fireBoundsActive) {
        state.fireBoundsActive = true;
        state.fireMinX = x;
        state.fireMaxX = x;
        state.fireMinY = y;
        state.fireMaxY = y;
        return;
    }
    state.fireMinX = Math.min(state.fireMinX, x);
    state.fireMaxX = Math.max(state.fireMaxX, x);
    state.fireMinY = Math.min(state.fireMinY, y);
    state.fireMaxY = Math.max(state.fireMaxY, y);
}
export function resetFireBounds(state) {
    state.fireBoundsActive = false;
    state.fireMinX = 0;
    state.fireMaxX = 0;
    state.fireMinY = 0;
    state.fireMaxY = 0;
}
export function igniteRandomFire(state, rng, dayDelta, intensity) {
    const ignitionChance = FIRE_IGNITION_CHANCE_PER_DAY * dayDelta * intensity;
    if (rng.next() >= ignitionChance) {
        return;
    }
    let attempts = 0;
    while (attempts < 80) {
        attempts += 1;
        const x = Math.floor(rng.next() * state.grid.cols);
        const y = Math.floor(rng.next() * state.grid.rows);
        const tile = state.tiles[indexFor(state.grid, x, y)];
        if (tile.fire > 0 || tile.fuel <= 0) {
            continue;
        }
        if (tile.type === "water" ||
            tile.type === "base" ||
            tile.type === "ash" ||
            tile.type === "firebreak" ||
            tile.type === "road") {
            continue;
        }
        tile.fire = 0.35 + rng.next() * 0.25;
        tile.heat = Math.max(tile.heat, tile.ignitionPoint * 1.3);
        markFireBounds(state, x, y);
        break;
    }
}
export function stepFire(state, rng, delta, spreadScale, dayFactor) {
    const igniteList = [];
    let activeFires = 0;
    const cols = state.grid.cols;
    const rows = state.grid.rows;
    const boundsActive = state.fireBoundsActive;
    const minX = boundsActive ? clamp(state.fireMinX - FIRE_BOUNDS_PADDING, 0, cols - 1) : 0;
    const maxX = boundsActive ? clamp(state.fireMaxX + FIRE_BOUNDS_PADDING, 0, cols - 1) : cols - 1;
    const minY = boundsActive ? clamp(state.fireMinY - FIRE_BOUNDS_PADDING, 0, rows - 1) : 0;
    const maxY = boundsActive ? clamp(state.fireMaxY + FIRE_BOUNDS_PADDING, 0, rows - 1) : rows - 1;
    if (!boundsActive && state.lastActiveFires === 0) {
        return 0;
    }
    let nextMinX = cols;
    let nextMaxX = -1;
    let nextMinY = rows;
    let nextMaxY = -1;
    const fireDelta = delta * spreadScale;
    const emberChance = fireDelta * 0.1;
    const hotFactor = clamp((dayFactor - 1) / (FIRE_DAY_FACTOR_MAX - 1), 0, 1);
    const windFactor = clamp((state.wind.strength - FIRE_JUMP_WIND_THRESHOLD) / (1 - FIRE_JUMP_WIND_THRESHOLD), 0, 1);
    const jumpChance = fireDelta * FIRE_JUMP_BASE_CHANCE * hotFactor * windFactor;
    for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
            const idx = indexFor(state.grid, x, y);
            const tile = state.tiles[idx];
            if (tile.fire > 0) {
                activeFires += 1;
                if (x < nextMinX) {
                    nextMinX = x;
                }
                if (x > nextMaxX) {
                    nextMaxX = x;
                }
                if (y < nextMinY) {
                    nextMinY = y;
                }
                if (y > nextMaxY) {
                    nextMaxY = y;
                }
                if (rng.next() < fireDelta * 0.8) {
                    emitSmokeAt(state, rng, x + 0.5, y + 0.5);
                }
                if (tile.fuel > 0) {
                    const heatRatio = tile.heat / (tile.ignitionPoint * 1.6);
                    const growth = fireDelta * tile.burnRate * (heatRatio - 0.45);
                    tile.fire = clamp(tile.fire + growth, 0, 1);
                    tile.fuel = Math.max(0, tile.fuel - fireDelta * tile.burnRate * (0.6 + tile.fire * 0.9));
                }
                if (tile.fuel <= 0.02 && tile.type !== "ash") {
                    if (tile.type === "house" && !tile.houseDestroyed) {
                        tile.houseDestroyed = true;
                        state.destroyedHouses += 1;
                        state.lostPropertyValue += tile.houseValue;
                        state.lostResidents += tile.houseResidents;
                        state.yearPropertyLost += tile.houseValue;
                        state.yearLivesLost += tile.houseResidents;
                    }
                    tile.fire = 0;
                    tile.type = "ash";
                    tile.fuel = 0;
                    tile.ashAge = 0;
                    tile.heat *= 0.4;
                    if (!tile.isBase) {
                        state.burnedTiles += 1;
                        state.yearBurnedTiles += 1;
                    }
                    state.terrainDirty = true;
                    continue;
                }
                if (rng.next() < emberChance * state.wind.strength) {
                    let best = null;
                    let bestDot = -Infinity;
                    for (const dir of NEIGHBOR_DIRS) {
                        const nx = x + dir.x;
                        const ny = y + dir.y;
                        if (!inBounds(state.grid, nx, ny)) {
                            continue;
                        }
                        const dot = dir.x * state.wind.dx + dir.y * state.wind.dy;
                        if (dot > bestDot) {
                            bestDot = dot;
                            best = { x: nx, y: ny };
                        }
                    }
                    if (best) {
                        const neighbor = state.tiles[indexFor(state.grid, best.x, best.y)];
                        if (neighbor.fire === 0 && neighbor.fuel > 0) {
                            neighbor.heat = Math.min(5, neighbor.heat + 0.25 + state.wind.strength * 0.25);
                        }
                    }
                }
                if (jumpChance > 0) {
                    for (const dir of NEIGHBOR_DIRS) {
                        const nx = x + dir.x;
                        const ny = y + dir.y;
                        if (!inBounds(state.grid, nx, ny)) {
                            continue;
                        }
                        const barrier = state.tiles[indexFor(state.grid, nx, ny)];
                        if (barrier.type !== "road" && barrier.type !== "firebreak") {
                            continue;
                        }
                        const dot = dir.x * state.wind.dx + dir.y * state.wind.dy;
                        if (dot <= FIRE_JUMP_DOT_THRESHOLD) {
                            continue;
                        }
                        const tx = nx + dir.x;
                        const ty = ny + dir.y;
                        if (!inBounds(state.grid, tx, ty)) {
                            continue;
                        }
                        const target = state.tiles[indexFor(state.grid, tx, ty)];
                        if (target.fire > 0 || target.fuel <= 0) {
                            continue;
                        }
                        if (rng.next() < jumpChance * dot) {
                            target.heat = Math.min(5, target.heat + FIRE_JUMP_HEAT_BOOST + state.wind.strength * 0.25 + hotFactor * 0.2);
                        }
                    }
                }
            }
            else if (tile.fuel > 0 && tile.heat >= tile.ignitionPoint) {
                igniteList.push({ x, y });
            }
        }
    }
    igniteList.forEach((point) => {
        const tile = state.tiles[indexFor(state.grid, point.x, point.y)];
        if (tile.fire === 0 && tile.fuel > 0) {
            tile.fire = 0.2 + rng.next() * 0.25;
            activeFires += 1;
            if (point.x < nextMinX) {
                nextMinX = point.x;
            }
            if (point.x > nextMaxX) {
                nextMaxX = point.x;
            }
            if (point.y < nextMinY) {
                nextMinY = point.y;
            }
            if (point.y > nextMaxY) {
                nextMaxY = point.y;
            }
        }
    });
    if (activeFires > 0) {
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
