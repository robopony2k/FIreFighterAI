export function getClimateDifficulty(year) {
    if (year <= 1) {
        return 1;
    }
    return 1 + Math.min(0.6, (year - 1) * 0.03);
}
export function getIgnitionMultiplier(year) {
    return getClimateDifficulty(year);
}
export function getSpreadMultiplier(year) {
    return getClimateDifficulty(year);
}
