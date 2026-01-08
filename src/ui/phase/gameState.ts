import { EventBus } from "./eventBus.js";
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
    selection: { kind: "none" },
    interactionMode: "default",
    paused: false,
    alert: null,
    timeSpeedIndex: 0,
    windLabel: null
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

  setTimeSpeedIndex(index: number): void {
    if (this.snapshot.timeSpeedIndex === index) {
      return;
    }
    this.snapshot.timeSpeedIndex = index;
    this.emitChange();
  }

  setWind(label: string | null): void {
    if (this.snapshot.windLabel === label) {
      return;
    }
    this.snapshot.windLabel = label;
    this.emitChange();
  }

  emitCta(actionId: string): void {
    this.bus.emit("cta", actionId);
  }

  private emitChange(): void {
    this.bus.emit("change", this.getSnapshot());
  }
}
