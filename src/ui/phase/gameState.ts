import { EventBus } from "../../core/eventBus.js";
import type { GameUiSnapshot, InteractionMode, Phase, SelectedEntity } from "./types.js";
import { clamp } from "../../core/utils.js";

type GameStateEvents = {
  change: GameUiSnapshot;
  cta: string;
};

export class GameState {
  private bus = new EventBus<GameStateEvents>();
  private snapshot: GameUiSnapshot = {
    phase: "growth",
    phaseProgress: 0,
    annualReportOpen: false,
    selection: { kind: "none" },
    interactionMode: "default",
    paused: false,
    alert: null,
    simTimeMode: "strategic",
    timeSpeedControlMode: "buttons",
    timeSpeedIndex: 1,
    timeSpeedValue: 1,
    skipToNextFireActive: false,
    canSkipToNextFire: false,
    forecast: null,
    forecastDay: 0,
    forecastStartDay: 0,
    forecastYearDays: 360,
    forecastMeta: null,
    progression: null,
    scoring: null
  };

  on<K extends keyof GameStateEvents>(event: K, listener: (payload: GameStateEvents[K]) => void): void {
    this.bus.on(event, listener);
  }

  off<K extends keyof GameStateEvents>(event: K, listener: (payload: GameStateEvents[K]) => void): void {
    this.bus.off(event, listener);
  }

  getSnapshot(): GameUiSnapshot {
    return { ...this.snapshot };
  }

  setPhase(phase: Phase): void {
    if (this.snapshot.phase === phase) {
      return;
    }
    this.snapshot.phase = phase;
    this.emitChange();
  }

  setPhaseProgress(progress: number): void {
    const clamped = clamp(progress, 0, 1);
    if (this.snapshot.phaseProgress === clamped) {
      return;
    }
    this.snapshot.phaseProgress = clamped;
    this.emitChange();
  }

  setAnnualReportOpen(open: boolean): void {
    if (this.snapshot.annualReportOpen === open) {
      return;
    }
    this.snapshot.annualReportOpen = open;
    this.emitChange();
  }

  setSelection(selection: SelectedEntity): void {
    const current = this.snapshot.selection;
    if (current.kind === selection.kind && current.kind === "unit" && selection.kind === "unit" && current.id === selection.id) {
      return;
    }
    if (current.kind === selection.kind && current.kind === "none") {
      return;
    }
    this.snapshot.selection = selection;
    this.emitChange();
  }

  setInteractionMode(mode: InteractionMode): void {
    if (this.snapshot.interactionMode === mode) {
      return;
    }
    this.snapshot.interactionMode = mode;
    this.emitChange();
  }

  setPaused(paused: boolean): void {
    if (this.snapshot.paused === paused) {
      return;
    }
    this.snapshot.paused = paused;
    this.emitChange();
  }

  setAlert(message: string | null): void {
    if (this.snapshot.alert === message) {
      return;
    }
    this.snapshot.alert = message;
    this.emitChange();
  }

  setSimTimeMode(mode: GameUiSnapshot["simTimeMode"]): void {
    if (this.snapshot.simTimeMode === mode) {
      return;
    }
    this.snapshot.simTimeMode = mode;
    this.emitChange();
  }

  setTimeSpeedControlMode(mode: GameUiSnapshot["timeSpeedControlMode"]): void {
    if (this.snapshot.timeSpeedControlMode === mode) {
      return;
    }
    this.snapshot.timeSpeedControlMode = mode;
    this.emitChange();
  }

  setTimeSpeedIndex(index: number): void {
    if (this.snapshot.timeSpeedIndex === index) {
      return;
    }
    this.snapshot.timeSpeedIndex = index;
    this.emitChange();
  }

  setTimeSpeedValue(value: number): void {
    if (this.snapshot.timeSpeedValue === value) {
      return;
    }
    this.snapshot.timeSpeedValue = value;
    this.emitChange();
  }

  setSkipToNextFireState(active: boolean, available: boolean): void {
    if (this.snapshot.skipToNextFireActive === active && this.snapshot.canSkipToNextFire === available) {
      return;
    }
    this.snapshot.skipToNextFireActive = active;
    this.snapshot.canSkipToNextFire = available;
    this.emitChange();
  }

  setForecast(
    forecast: GameUiSnapshot["forecast"],
    day: number,
    startDay: number,
    yearDays: number,
    meta: string | null
  ): void {
    if (
      this.snapshot.forecast === forecast &&
      this.snapshot.forecastDay === day &&
      this.snapshot.forecastStartDay === startDay &&
      this.snapshot.forecastYearDays === yearDays &&
      this.snapshot.forecastMeta === meta
    ) {
      return;
    }
    this.snapshot.forecast = forecast;
    this.snapshot.forecastDay = day;
    this.snapshot.forecastStartDay = startDay;
    this.snapshot.forecastYearDays = yearDays;
    this.snapshot.forecastMeta = meta;
    this.emitChange();
  }

  setProgression(progression: GameUiSnapshot["progression"]): void {
    if (this.snapshot.progression === progression) {
      return;
    }
    this.snapshot.progression = progression;
    this.emitChange();
  }

  setScoring(scoring: GameUiSnapshot["scoring"]): void {
    if (this.snapshot.scoring === scoring) {
      return;
    }
    this.snapshot.scoring = scoring;
    this.emitChange();
  }

  emitCta(actionId: string): void {
    this.bus.emit("cta", actionId);
  }

  private emitChange(): void {
    this.bus.emit("change", this.getSnapshot());
  }
}
