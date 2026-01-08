export function getClimateDifficulty(year) {
    const baseDifficulty = 1.2;
    if (year <= 1) {
        return baseDifficulty;
    }
    // Ramp up to a max of +0.4 over 20 years
    return baseDifficulty + Math.min(0.4, (year - 1) * 0.02);
}
export function getIgnitionMultiplier(year) {
    return getClimateDifficulty(year);
}
export function getSpreadMultiplier(year) {
    return getClimateDifficulty(year);
}
