export const DEFAULT_CLIMATE_PARAMS = {
    seasonLen: 90,
    peakDay: 60,
    tMid: 30,
    tAmp: 8,
    warmingPerYear: 0.03,
    noiseAmp: 1.5,
    heatwavesPerYear: 3
};
export const VIRTUAL_CLIMATE_PARAMS = {
    ...DEFAULT_CLIMATE_PARAMS,
    seasonLen: 360,
    peakDay: 240
};
export const DEFAULT_MOISTURE_PARAMS = {
    Mmin: 0.05,
    Mmax: 0.35,
    Tdry0: 18,
    Tdry1: 38,
    k0: 0.04,
    k1: 0.06
};
export const DEFAULT_COOLING_PARAMS = {
    base: 0.15,
    alpha: 0.015,
    Tref: 25,
    kMinFactor: 0.3,
    kMaxFactor: 1.2
};
export const CLIMATE_IGNITION_MIN = 1.0;
export const CLIMATE_IGNITION_MAX = 1.9;
export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export function hash32(x) {
    let h = x | 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return h >>> 0;
}
export function u01(seed, salt) {
    const mix = seed ^ Math.imul(salt | 0, 0x9e3779b9);
    const h = hash32(mix);
    return h / 4294967296;
}
export function peakCurve(day, peakDay, seasonLen) {
    const dist = Math.abs(day - peakDay);
    const half = seasonLen * 0.5;
    const base = clamp(1 - dist / half, 0, 1);
    return base * base;
}
export function ambientTemp(day, year, worldSeed, params) {
    const dayClamped = clamp(day, 1, params.seasonLen);
    const curve = peakCurve(dayClamped, params.peakDay, params.seasonLen);
    const seasonal = (curve - 0.5) * 2;
    const warming = params.warmingPerYear * Math.max(0, year);
    let temp = params.tMid + params.tAmp * seasonal + warming;
    const noiseSalt = (year * 131 + dayClamped * 37) | 0;
    const noise = (u01(worldSeed, noiseSalt) * 2 - 1) * params.noiseAmp;
    temp += noise;
    for (let i = 0; i < params.heatwavesPerYear; i += 1) {
        const saltBase = (year * 1000 + i * 31) | 0;
        const start = 1 + Math.floor(u01(worldSeed, saltBase) * params.seasonLen);
        const duration = 3 + Math.floor(u01(worldSeed, saltBase + 11) * 5);
        const intensity = 2 + Math.floor(u01(worldSeed, saltBase + 23) * 7);
        if (dayClamped >= start && dayClamped < start + duration) {
            temp += intensity;
        }
    }
    return temp;
}
export function moistureStep(M, T, params) {
    const denom = Math.max(0.001, params.Tdry1 - params.Tdry0);
    const dryness = clamp((T - params.Tdry0) / denom, 0, 1);
    const target = params.Mmax - (params.Mmax - params.Mmin) * dryness;
    const k = params.k0 + (params.k1 - params.k0) * dryness;
    return clamp(M + (target - M) * k, params.Mmin, params.Mmax);
}
export function coolCellTemp(Tcell, Tenv, dtSeconds, params) {
    const kScale = clamp(1 - params.alpha * (Tenv - params.Tref), params.kMinFactor, params.kMaxFactor);
    const k = params.base * kScale;
    const step = clamp(k * dtSeconds, 0, 1);
    return Tcell + (0 - Tcell) * step;
}
export function buildClimateForecast(worldSeed, year, params, moisture) {
    const days = params.seasonLen;
    const temps = new Array(days);
    const risk = new Array(days);
    const denom = Math.max(0.0001, moisture.Mmax - moisture.Mmin);
    let M = moisture.Mmax;
    for (let day = 1; day <= days; day += 1) {
        const T = ambientTemp(day, year, worldSeed, params);
        M = moistureStep(M, T, moisture);
        const moistureNorm = clamp((M - moisture.Mmin) / denom, 0, 1);
        const ignitionMultiplier = CLIMATE_IGNITION_MAX + (CLIMATE_IGNITION_MIN - CLIMATE_IGNITION_MAX) * moistureNorm;
        const dryness = 1 - moistureNorm;
        const spreadMultiplier = 0.6 + dryness * 1.4;
        const ignitionNorm = clamp((ignitionMultiplier - CLIMATE_IGNITION_MIN) / (CLIMATE_IGNITION_MAX - CLIMATE_IGNITION_MIN), 0, 1);
        const spreadNorm = clamp((spreadMultiplier - 0.6) / 1.4, 0, 1);
        risk[day - 1] = clamp(0.55 * ignitionNorm + 0.45 * spreadNorm, 0, 1);
        temps[day - 1] = T;
    }
    return { days, temps, risk };
}
export function buildClimateTimeline(worldSeed, years, params, moisture) {
    const daysPerYear = Math.max(1, Math.floor(params.seasonLen));
    const totalDays = Math.max(0, years) * daysPerYear;
    const risk = new Float32Array(totalDays);
    const denom = Math.max(0.0001, moisture.Mmax - moisture.Mmin);
    let M = moisture.Mmax;
    for (let dayIndex = 0; dayIndex < totalDays; dayIndex += 1) {
        const yearIndex = Math.floor(dayIndex / daysPerYear);
        const dayOfYear = (dayIndex % daysPerYear) + 1;
        const T = ambientTemp(dayOfYear, yearIndex, worldSeed, params);
        M = moistureStep(M, T, moisture);
        const moistureNorm = clamp((M - moisture.Mmin) / denom, 0, 1);
        const ignitionMultiplier = CLIMATE_IGNITION_MAX + (CLIMATE_IGNITION_MIN - CLIMATE_IGNITION_MAX) * moistureNorm;
        const dryness = 1 - moistureNorm;
        const spreadMultiplier = 0.6 + dryness * 1.4;
        const ignitionNorm = clamp((ignitionMultiplier - CLIMATE_IGNITION_MIN) / (CLIMATE_IGNITION_MAX - CLIMATE_IGNITION_MIN), 0, 1);
        const spreadNorm = clamp((spreadMultiplier - 0.6) / 1.4, 0, 1);
        risk[dayIndex] = clamp(0.55 * ignitionNorm + 0.45 * spreadNorm, 0, 1);
    }
    return { daysPerYear, totalDays, risk };
}
const DEBUG_CLIMATE = false;
export function debugClimateChecks(worldSeed, params, moisture) {
    if (!DEBUG_CLIMATE) {
        return;
    }
    const t1 = ambientTemp(60, 0, worldSeed, params);
    const t2 = ambientTemp(60, 0, worldSeed, params);
    const t3 = ambientTemp(60, 0, worldSeed + 1, params);
    const peak = ambientTemp(60, 0, worldSeed, params);
    const early = ambientTemp(10, 0, worldSeed, params);
    const late = ambientTemp(85, 0, worldSeed, params);
    let M = moisture.Mmax;
    for (let d = 1; d <= params.seasonLen; d += 1) {
        const T = ambientTemp(d, 10, worldSeed, params);
        M = moistureStep(M, T, moisture);
    }
    console.log(`[CLIMATE] deterministic=${Math.abs(t1 - t2) < 1e-6} diffSeed=${Math.abs(t1 - t3) > 1e-6} peak=${peak.toFixed(2)} early=${early.toFixed(2)} late=${late.toFixed(2)} M=${M.toFixed(3)}`);
}
