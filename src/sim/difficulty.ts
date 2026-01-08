export function getClimateDifficulty(year: number): number {
  const baseDifficulty = 1.2;
  if (year <= 1) {
    return baseDifficulty;
  }
  // Ramp up to a max of +0.4 over 20 years
  return baseDifficulty + Math.min(0.4, (year - 1) * 0.02);
}

export function getIgnitionMultiplier(year: number): number {
  return getClimateDifficulty(year);
}

export function getSpreadMultiplier(year: number): number {
  return getClimateDifficulty(year);
}
