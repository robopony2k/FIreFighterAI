export const getCommandLevelThreshold = (level: number): number | null => {
  if (!Number.isFinite(level) || level < 1) {
    return null;
  }
  const resolvedLevel = Math.floor(level);
  return (15 * resolvedLevel * resolvedLevel + 25 * resolvedLevel + 10) / 2;
};
