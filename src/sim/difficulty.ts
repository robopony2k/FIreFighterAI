export function getClimateDifficulty(year: number): number {
  if (year <= 1) {
    return 1;
  }
  return 1 + Math.min(0.6, (year - 1) * 0.03);
}

export function getIgnitionMultiplier(year: number): number {
  return getClimateDifficulty(year);
}

export function getSpreadMultiplier(year: number): number {
  return getClimateDifficulty(year);
}
