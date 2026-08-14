import type { GameNotificationPayload } from "../../core/gameEvents.js";
import { getNotificationDefinition } from "./notificationRegistry.js";

export type NotificationLifecycle = "visible" | "exiting";

export type ActiveNotification = {
  payload: GameNotificationPayload;
  remainingMs: number;
  exitRemainingMs: number;
  lifecycle: NotificationLifecycle;
};

export type NotificationCenterSnapshot = readonly ActiveNotification[];

export type NotificationCenter = {
  publish: (payload: GameNotificationPayload) => boolean;
  dismiss: (dedupeKey: string) => void;
  focus: (dedupeKey: string) => void;
  setInteractionPaused: (dedupeKey: string, paused: boolean) => void;
  setDocumentHidden: (hidden: boolean) => void;
  step: (elapsedMs: number) => void;
  clear: () => void;
  subscribe: (listener: (snapshot: NotificationCenterSnapshot) => void) => () => void;
  snapshot: () => NotificationCenterSnapshot;
};

export type NotificationCenterOptions = {
  isEnabled: (payload: GameNotificationPayload) => boolean;
  onFocus?: (payload: GameNotificationPayload) => void;
  maxVisible?: number;
  exitDurationMs?: number;
};

const cloneEntry = (entry: ActiveNotification): ActiveNotification => ({
  ...entry,
  payload: {
    ...entry.payload,
    focusTarget: entry.payload.focusTarget ? { ...entry.payload.focusTarget } : undefined
  }
});

export const createNotificationCenter = (options: NotificationCenterOptions): NotificationCenter => {
  const maxVisible = Math.max(1, Math.floor(options.maxVisible ?? 3));
  const exitDurationMs = Math.max(0, options.exitDurationMs ?? 220);
  const entries: ActiveNotification[] = [];
  const seenKeys = new Set<string>();
  const interactionPausedKeys = new Set<string>();
  const listeners = new Set<(snapshot: NotificationCenterSnapshot) => void>();
  let documentHidden = false;

  const snapshot = (): NotificationCenterSnapshot => entries.map(cloneEntry);
  const notify = (): void => {
    const next = snapshot();
    listeners.forEach((listener) => listener(next));
  };

  return {
    publish: (payload) => {
      const existing = entries.find((entry) => entry.payload.dedupeKey === payload.dedupeKey);
      if (existing) {
        existing.payload = { ...payload };
        notify();
        return false;
      }
      if (seenKeys.has(payload.dedupeKey)) return false;
      seenKeys.add(payload.dedupeKey);
      if (!options.isEnabled(payload)) return false;
      const ttlMs = getNotificationDefinition(payload.type)?.ttlMs ?? 6000;
      entries.push({ payload: { ...payload }, remainingMs: ttlMs, exitRemainingMs: exitDurationMs, lifecycle: "visible" });
      while (entries.length > maxVisible) {
        interactionPausedKeys.delete(entries[0]!.payload.dedupeKey);
        entries.shift();
      }
      notify();
      return true;
    },
    dismiss: (dedupeKey) => {
      const entry = entries.find((candidate) => candidate.payload.dedupeKey === dedupeKey);
      if (!entry || entry.lifecycle === "exiting") return;
      entry.lifecycle = "exiting";
      entry.exitRemainingMs = exitDurationMs;
      interactionPausedKeys.delete(dedupeKey);
      notify();
    },
    focus: (dedupeKey) => {
      const entry = entries.find((candidate) => candidate.payload.dedupeKey === dedupeKey);
      if (entry?.payload.focusTarget) options.onFocus?.(entry.payload);
    },
    setInteractionPaused: (dedupeKey, paused) => {
      if (paused) interactionPausedKeys.add(dedupeKey);
      else interactionPausedKeys.delete(dedupeKey);
    },
    setDocumentHidden: (hidden) => {
      documentHidden = hidden;
    },
    step: (elapsedMs) => {
      const delta = Math.max(0, Number.isFinite(elapsedMs) ? elapsedMs : 0);
      if (delta <= 0 || documentHidden) return;
      let changed = false;
      for (const entry of entries) {
        if (entry.lifecycle === "visible") {
          if (!interactionPausedKeys.has(entry.payload.dedupeKey)) {
            entry.remainingMs -= delta;
            if (entry.remainingMs <= 0) {
              entry.lifecycle = "exiting";
              entry.exitRemainingMs = exitDurationMs;
              changed = true;
            }
          }
        } else {
          entry.exitRemainingMs -= delta;
        }
      }
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index]!;
        if (entry.lifecycle === "exiting" && entry.exitRemainingMs <= 0) {
          interactionPausedKeys.delete(entry.payload.dedupeKey);
          entries.splice(index, 1);
          changed = true;
        }
      }
      if (changed) notify();
    },
    clear: () => {
      entries.length = 0;
      seenKeys.clear();
      interactionPausedKeys.clear();
      notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    snapshot
  };
};
