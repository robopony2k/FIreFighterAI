import type { FireSettings, SeasonPhase } from "./types.js";
import { FIRE_SEASON_MIN_INTENSITY, FIRE_SEASON_TAPER_DAYS, FIRE_SIM_SPEED } from "./config.js";
import { clamp } from "./utils.js";

export const PHASES: { id: SeasonPhase; label: string; duration: number }[] = [
  { id: "maintenance", label: "Maintenance", duration: 90 },
  { id: "growth", label: "Growth", duration: 90 },
  { id: "fire", label: "Fire Season", duration: 90 },
  { id: "budget", label: "Budget", duration: 90 }
];

export const FIRE_SEASON_DURATION = PHASES.find((phase) => phase.id === "fire")?.duration ?? 90;
export const GROWTH_PHASE_DURATION = PHASES.find((phase) => phase.id === "growth")?.duration ?? 120;
export const ASH_REGROW_DELAY = GROWTH_PHASE_DURATION + 1;

export function formatTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function getPhaseInfo(phaseIndex: number): { id: SeasonPhase; label: string; duration: number } {
  return PHASES[phaseIndex];
}

export function formatPhaseStatus(phase: SeasonPhase, phaseIndex: number, phaseDay: number): string {
  const current = getPhaseInfo(phaseIndex);
  if (phase === "maintenance") {
    return `${current.label} (Budget)`;
  }
  const day = clamp(Math.ceil(phaseDay + 0.0001), 1, current.duration);
  return `${current.label} ${day}/${current.duration}`;
}

export function getFireSeasonIntensity(dayValue: number, settings?: FireSettings): number {
  const taperDays = settings?.seasonTaperDays ?? FIRE_SEASON_TAPER_DAYS;
  const minIntensity = settings?.seasonMinIntensity ?? FIRE_SEASON_MIN_INTENSITY;
  if (dayValue <= FIRE_SEASON_DURATION) {
    return 1;
  }
  if (taperDays <= 0) {
    return clamp(minIntensity, 0, 1);
  }
  const over = dayValue - FIRE_SEASON_DURATION;
  const tapered = 1 - over / taperDays;
  return clamp(tapered, minIntensity, 1);
}

export function getFireSpreadScale(dayValue: number, settings?: FireSettings): number {
  const season = getFireSeasonIntensity(dayValue, settings);
  const simSpeed = settings?.simSpeed ?? FIRE_SIM_SPEED;
  return simSpeed * (0.55 + season * 0.45);
}

