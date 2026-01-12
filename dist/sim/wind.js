import { CAREER_YEARS, WIND_DIRS } from "../core/config.js";
import { DEFAULT_CLIMATE_PARAMS, DEFAULT_MOISTURE_PARAMS, VIRTUAL_CLIMATE_PARAMS, u01 } from "../core/climate.js";
import { clamp } from "../core/utils.js";
import { hash2D } from "../mapgen/noise.js";
const getNearestWindDir = (dx, dy) => {
    let best = WIND_DIRS[0];
    let bestDot = -Infinity;
    for (const dir of WIND_DIRS) {
        const dot = dir.dx * dx + dir.dy * dy;
        if (dot > bestDot) {
            bestDot = dot;
            best = dir;
        }
    }
    return best;
};
const getClimateWind = (state) => {
    const baseIndex = Math.floor(u01(state.seed, 9011) * WIND_DIRS.length);
    const baseDir = WIND_DIRS[baseIndex];
    const baseAngle = Math.atan2(baseDir.dy, baseDir.dx);
    const yearDays = Math.max(1, Math.floor(VIRTUAL_CLIMATE_PARAMS.seasonLen));
    const dayPhase = (state.climateDay / yearDays) * Math.PI * 2;
    const seasonalOffset = (u01(state.seed, 9029) * Math.PI * 2) - Math.PI;
    const seasonalDrift = Math.sin(dayPhase + seasonalOffset) * (0.35 + u01(state.seed, 9037) * 0.25);
    const driftBucket = Math.floor(state.climateDay / 12);
    const driftNoise = (hash2D(driftBucket, state.climateYear, state.seed + 731) * 2 - 1) * 0.25;
    const angle = baseAngle + seasonalDrift + driftNoise;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const moistureDenom = Math.max(0.0001, DEFAULT_MOISTURE_PARAMS.Mmax - DEFAULT_MOISTURE_PARAMS.Mmin);
    const moistureNorm = clamp((state.climateMoisture - DEFAULT_MOISTURE_PARAMS.Mmin) / moistureDenom, 0, 1);
    const dryness = 1 - moistureNorm;
    const tempSpan = Math.max(1, DEFAULT_CLIMATE_PARAMS.tAmp * 1.6);
    const tempNorm = clamp((state.climateTemp - DEFAULT_CLIMATE_PARAMS.tMid) / tempSpan, -1, 1);
    const yearTrend = clamp(state.climateYear / Math.max(1, CAREER_YEARS - 1), 0, 1);
    const gust = (hash2D(Math.floor(state.climateDay / 4), state.climateYear, state.seed + 977) * 2 - 1) * 0.08;
    const strengthBase = 0.28 + dryness * 0.32 + Math.max(0, tempNorm) * 0.18;
    const strengthTrend = yearTrend * 0.22;
    const strength = clamp(strengthBase + strengthTrend + gust, 0.2, 0.95);
    const nearest = getNearestWindDir(dx, dy);
    return {
        name: nearest.name,
        dx,
        dy,
        strength
    };
};
export function randomizeWind(state, rng) {
    const next = getClimateWind(state);
    state.wind = { ...next };
    state.windTimer = 0;
}
export function stepWind(state, delta, rng) {
    const target = getClimateWind(state);
    const blend = 1 - Math.exp(-Math.max(0, delta) / 3);
    const nextDx = state.wind.dx + (target.dx - state.wind.dx) * blend;
    const nextDy = state.wind.dy + (target.dy - state.wind.dy) * blend;
    const len = Math.hypot(nextDx, nextDy) || 1;
    state.wind = {
        name: target.name,
        dx: nextDx / len,
        dy: nextDy / len,
        strength: state.wind.strength + (target.strength - state.wind.strength) * blend
    };
}
