import type { ClimateForecast } from "../../core/types.js";
import type { HudCameraSnapshot } from "./minimapViewport.js";
import { DEFAULT_WIDGET_ASSIGNMENTS, WidgetSlot, WidgetType, WIDGET_TYPES } from "./hudLayout.js";

export type ToastSeverity = "info" | "warning" | "error";

export type HudToast = {
  id: number;
  message: string;
  severity: ToastSeverity;
  remainingMs: number;
  createdAt: number;
};

export const MINIMAP_MODES = ["terrain", "elevation", "thermal"] as const;
export type MinimapMode = (typeof MINIMAP_MODES)[number];

export type HudSlotState = {
  widget: WidgetType;
  compact: boolean;
  minimapMode: MinimapMode;
};

export type HudForecastOverride = {
  forecast: ClimateForecast | null;
  forecastDay: number;
  forecastStartDay: number;
  forecastYearDays: number;
  forecastMeta: string | null;
};

export type HudViewportState = {
  width: number;
  height: number;
  scale: number;
};

export type HudState = {
  slots: Record<WidgetSlot, HudSlotState>;
  toasts: HudToast[];
  nextToastId: number;
  fps: number;
  lastPhase: string | null;
  lastWindName: string | null;
  phaseLabelOverride: string | null;
  seasonLabelOverride: string | null;
  forecastOverride: HudForecastOverride | null;
  viewport: HudViewportState;
  camera: HudCameraSnapshot | null;
};

export const createHudState = (): HudState => ({
  slots: {
    [WidgetSlot.A]: {
      widget: DEFAULT_WIDGET_ASSIGNMENTS[WidgetSlot.A],
      compact: false,
      minimapMode: "terrain"
    },
    [WidgetSlot.B]: {
      widget: DEFAULT_WIDGET_ASSIGNMENTS[WidgetSlot.B],
      compact: false,
      minimapMode: "terrain"
    }
  },
  toasts: [],
  nextToastId: 1,
  fps: 0,
  lastPhase: null,
  lastWindName: null,
  phaseLabelOverride: null,
  seasonLabelOverride: null,
  forecastOverride: null,
  viewport: { width: 1, height: 1, scale: 1 },
  camera: null
});

export const setHudViewport = (state: HudState, width: number, height: number, scale = 1): void => {
  state.viewport.width = Math.max(1, Math.floor(width));
  state.viewport.height = Math.max(1, Math.floor(height));
  state.viewport.scale = Math.max(1, scale);
};

export const cycleWidget = (state: HudState, slot: WidgetSlot): void => {
  const current = state.slots[slot].widget;
  const index = WIDGET_TYPES.indexOf(current);
  const next = WIDGET_TYPES[(index + 1) % WIDGET_TYPES.length] ?? WIDGET_TYPES[0];
  state.slots[slot].widget = next;
};

export const toggleCompact = (state: HudState, slot: WidgetSlot): void => {
  state.slots[slot].compact = !state.slots[slot].compact;
};

export const cycleMinimapMode = (state: HudState, slot: WidgetSlot): void => {
  const current = state.slots[slot].minimapMode;
  const index = MINIMAP_MODES.indexOf(current);
  const next = MINIMAP_MODES[(index + 1) % MINIMAP_MODES.length] ?? MINIMAP_MODES[0];
  state.slots[slot].minimapMode = next;
};

export const addToast = (
  state: HudState,
  message: string,
  severity: ToastSeverity = "info",
  ttlMs = 3200
): void => {
  const trimmed = message.trim();
  if (!trimmed) {
    return;
  }
  const now = Date.now();
  state.toasts.unshift({
    id: state.nextToastId++,
    message: trimmed,
    severity,
    remainingMs: ttlMs,
    createdAt: now
  });
  if (state.toasts.length > 6) {
    state.toasts.length = 6;
  }
};

export const stepToasts = (state: HudState, dtSeconds: number): void => {
  if (state.toasts.length === 0) {
    return;
  }
  const dtMs = Math.max(0, dtSeconds * 1000);
  state.toasts.forEach((toast) => {
    toast.remainingMs -= dtMs;
  });
  state.toasts = state.toasts.filter((toast) => toast.remainingMs > 0);
};
