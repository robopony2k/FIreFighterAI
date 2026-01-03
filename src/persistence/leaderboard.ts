import type { LeaderboardEntry } from "../core/types.js";
import { LEADERBOARD_KEY } from "../core/config.js";

export function loadLeaderboard(): LeaderboardEntry[] {
  const raw = localStorage.getItem(LEADERBOARD_KEY);
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as LeaderboardEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveLeaderboard(entry: LeaderboardEntry): void {
  const entries = loadLeaderboard();
  entries.push(entry);
  entries.sort((a, b) => b.score - a.score);
  const trimmed = entries.slice(0, 8);
  localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(trimmed));
}

