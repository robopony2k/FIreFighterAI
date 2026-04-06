import { COMMAND_LEVEL_THRESHOLDS, getCommandLevelThreshold } from "../../config/progression/levelThresholds.js";
import { resolveProgressionModifiers } from "./modifiers.js";
import { buildProgressionDraftOptions } from "./draft.js";
import type { WorldState } from "../../core/state.js";
import type { ProgressionDraft } from "./types.js";

export const getProgressionLevelForExtinguishTotal = (totalAssistedExtinguishes: number): number => {
  const total = Math.max(0, Math.floor(totalAssistedExtinguishes));
  let level = 0;
  while (level < COMMAND_LEVEL_THRESHOLDS.length && total >= COMMAND_LEVEL_THRESHOLDS[level]!) {
    level += 1;
  }
  return level;
};

export const getProgressionLevelFloor = (level: number): number => {
  if (!Number.isFinite(level) || level <= 0) {
    return 0;
  }
  return COMMAND_LEVEL_THRESHOLDS[Math.max(0, Math.floor(level) - 1)] ?? COMMAND_LEVEL_THRESHOLDS[COMMAND_LEVEL_THRESHOLDS.length - 1] ?? 0;
};

export const getProgressionNextLevelThreshold = (level: number): number | null => getCommandLevelThreshold(level + 1);

export const getProgressionProgress01 = (level: number, totalAssistedExtinguishes: number): number => {
  const floor = getProgressionLevelFloor(level);
  const ceiling = getProgressionNextLevelThreshold(level);
  if (ceiling === null) {
    return 1;
  }
  const range = Math.max(1, ceiling - floor);
  return Math.max(0, Math.min(1, (totalAssistedExtinguishes - floor) / range));
};

const createProgressionDraft = (state: WorldState, ordinal: number, level: number): ProgressionDraft | null => {
  const options = buildProgressionDraftOptions(state.seed, ordinal, state.progression.rewardStacks);
  if (options.length === 0) {
    return null;
  }
  return {
    ordinal,
    level,
    options,
    openedAtExtinguishTotal: state.progression.totalAssistedExtinguishes
  };
};

const activateQueuedDraft = (state: WorldState): void => {
  while (state.progression.queuedDraftOrdinals.length > 0) {
    const ordinal = state.progression.queuedDraftOrdinals.shift();
    if (!ordinal) {
      continue;
    }
    const nextDraft = createProgressionDraft(state, ordinal, ordinal);
    if (nextDraft) {
      state.progression.activeDraft = nextDraft;
      return;
    }
  }
  state.progression.activeDraft = null;
};

export const registerAssistedExtinguishProgress = (state: WorldState, assistedExtinguishCount: number): void => {
  const delta = Math.max(0, Math.floor(assistedExtinguishCount));
  if (delta <= 0) {
    return;
  }

  const progression = state.progression;
  progression.totalAssistedExtinguishes += delta;
  const nextLevel = getProgressionLevelForExtinguishTotal(progression.totalAssistedExtinguishes);
  const previousLevel = progression.level;
  progression.level = nextLevel;

  for (let level = previousLevel + 1; level <= nextLevel; level += 1) {
    const ordinal = progression.nextDraftOrdinal++;
    if (progression.activeDraft || progression.queuedDraftOrdinals.length > 0) {
      progression.queuedDraftOrdinals.push(ordinal);
      continue;
    }
    const draft = createProgressionDraft(state, ordinal, level);
    if (draft) {
      progression.activeDraft = draft;
    }
  }

  progression.revision += 1;
};

export const selectProgressionReward = (state: WorldState, rewardId: string): boolean => {
  const activeDraft = state.progression.activeDraft;
  if (!activeDraft || !activeDraft.options.includes(rewardId)) {
    return false;
  }

  state.progression.rewardStacks[rewardId] = Math.max(0, Math.floor(state.progression.rewardStacks[rewardId] ?? 0)) + 1;
  state.progression.resolved = resolveProgressionModifiers(state.progression.rewardStacks);
  state.progression.activeDraft = null;
  state.progression.revision += 1;
  return true;
};

export const openNextProgressionDraft = (state: WorldState): boolean => {
  if (state.progression.activeDraft) {
    return true;
  }
  if (state.progression.queuedDraftOrdinals.length <= 0) {
    return false;
  }
  activateQueuedDraft(state);
  if (!state.progression.activeDraft) {
    return false;
  }
  state.progression.revision += 1;
  return true;
};
