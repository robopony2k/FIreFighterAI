export const COMMAND_LEVEL_THRESHOLDS = [25, 60, 110, 175, 255, 350, 460, 585, 725, 880] as const;

export const getCommandLevelThreshold = (level: number): number | null => {
  if (!Number.isFinite(level) || level < 1) {
    return null;
  }
  return COMMAND_LEVEL_THRESHOLDS[level - 1] ?? null;
};

