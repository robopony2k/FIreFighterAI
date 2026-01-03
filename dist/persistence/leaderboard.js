import { LEADERBOARD_KEY } from "../core/config.js";
export function loadLeaderboard() {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    if (!raw) {
        return [];
    }
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    }
    catch {
        return [];
    }
}
export function saveLeaderboard(entry) {
    const entries = loadLeaderboard();
    entries.push(entry);
    entries.sort((a, b) => b.score - a.score);
    const trimmed = entries.slice(0, 8);
    localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(trimmed));
}
