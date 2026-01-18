import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS, DEFAULT_RUN_SEED } from "../ui/run-config.js";
import { MAP_SIZE_PRESETS } from "../core/config.js";
import { CHARACTERS } from "../core/characters.js";
import { sanitizeMapGenSettings } from "../mapgen/settings.js";
const RUN_CONFIG_KEY = "fireline:run-config:v1";
const isValidMapSize = (value) => {
    if (typeof value !== "string") {
        return false;
    }
    return Object.prototype.hasOwnProperty.call(MAP_SIZE_PRESETS, value);
};
const isValidCharacterId = (value) => typeof value === "string" && CHARACTERS.some((character) => character.id === value);
const toNumber = (value) => {
    if (typeof value !== "number" || Number.isNaN(value)) {
        return null;
    }
    return value;
};
export const loadRunConfig = (fallback) => {
    if (typeof localStorage === "undefined") {
        return fallback;
    }
    try {
        const raw = localStorage.getItem(RUN_CONFIG_KEY);
        if (!raw) {
            return fallback;
        }
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object") {
            return fallback;
        }
        const seed = toNumber(parsed.seed);
        const mapSize = isValidMapSize(parsed.mapSize) ? parsed.mapSize : fallback.mapSize;
        const characterId = isValidCharacterId(parsed.characterId) ? parsed.characterId : fallback.characterId;
        const callsign = typeof parsed.callsign === "string" ? parsed.callsign : fallback.callsign;
        const options = {
            ...DEFAULT_RUN_OPTIONS,
            ...(parsed.options ?? {}),
            mapGen: sanitizeMapGenSettings(parsed.options?.mapGen ?? DEFAULT_RUN_OPTIONS.mapGen)
        };
        return {
            seed: seed === null ? fallback.seed : Math.floor(seed),
            mapSize,
            characterId,
            callsign,
            options
        };
    }
    catch (error) {
        console.warn("Failed to load run config", error);
        return fallback;
    }
};
export const saveRunConfig = (config) => {
    if (typeof localStorage === "undefined") {
        return;
    }
    const payload = {
        seed: Number.isFinite(config.seed) ? Math.floor(config.seed) : DEFAULT_RUN_SEED,
        mapSize: config.mapSize ?? DEFAULT_MAP_SIZE,
        characterId: config.characterId,
        callsign: config.callsign,
        options: {
            ...DEFAULT_RUN_OPTIONS,
            ...config.options,
            mapGen: sanitizeMapGenSettings(config.options?.mapGen ?? DEFAULT_RUN_OPTIONS.mapGen)
        }
    };
    try {
        localStorage.setItem(RUN_CONFIG_KEY, JSON.stringify(payload));
    }
    catch (error) {
        console.warn("Failed to save run config", error);
    }
};
