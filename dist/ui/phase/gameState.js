import { EventBus } from "./eventBus.js";
import { clamp } from "../../core/utils.js";
export class GameState {
    constructor() {
        this.bus = new EventBus();
        this.snapshot = {
            phase: "growth",
            phaseProgress: 0,
            selection: { kind: "none" },
            interactionMode: "default",
            paused: false,
            alert: null,
            timeSpeedIndex: 0,
            windLabel: null
        };
    }
    on(event, listener) {
        this.bus.on(event, listener);
    }
    off(event, listener) {
        this.bus.off(event, listener);
    }
    getSnapshot() {
        return { ...this.snapshot };
    }
    setPhase(phase) {
        if (this.snapshot.phase === phase) {
            return;
        }
        this.snapshot.phase = phase;
        this.emitChange();
    }
    setPhaseProgress(progress) {
        const clamped = clamp(progress, 0, 1);
        if (this.snapshot.phaseProgress === clamped) {
            return;
        }
        this.snapshot.phaseProgress = clamped;
        this.emitChange();
    }
    setSelection(selection) {
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
    setInteractionMode(mode) {
        if (this.snapshot.interactionMode === mode) {
            return;
        }
        this.snapshot.interactionMode = mode;
        this.emitChange();
    }
    setPaused(paused) {
        if (this.snapshot.paused === paused) {
            return;
        }
        this.snapshot.paused = paused;
        this.emitChange();
    }
    setAlert(message) {
        if (this.snapshot.alert === message) {
            return;
        }
        this.snapshot.alert = message;
        this.emitChange();
    }
    setTimeSpeedIndex(index) {
        if (this.snapshot.timeSpeedIndex === index) {
            return;
        }
        this.snapshot.timeSpeedIndex = index;
        this.emitChange();
    }
    setWind(label) {
        if (this.snapshot.windLabel === label) {
            return;
        }
        this.snapshot.windLabel = label;
        this.emitChange();
    }
    emitCta(actionId) {
        this.bus.emit("cta", actionId);
    }
    emitChange() {
        this.bus.emit("change", this.getSnapshot());
    }
}
