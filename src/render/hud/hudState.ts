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

export const MINIMAP_MODES = ["terrain", "elevation", "moisture", "thermal"] as const;
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

export type HudTheme = {
  topBarBackground: string;
  topBarBorder: string;
  textPrimary: string;
  textMuted: string;
  speedButtonBackground: string;
  speedButtonBorder: string;
  slotCardBackground: string;
  slotCardBorder: string;
  slotHeaderBackground: string;
  slotHeaderBorder: string;
  slotHeaderText: string;
  toastInfoBackground: string;
  toastWarningBackground: string;
  toastErrorBackground: string;
  toastBorder: string;
  toastText: string;
  debugPanelBackground: string;
  debugPanelBorder: string;
  debugPanelText: string;
  chartCardBackground: string;
  chartCardBorder: string;
  chartBackground: string;
  chartBorder: string;
  chartBandColors: [string, string, string, string];
  chartSeasonColors: [string, string, string, string];
  chartLineCool: string;
  chartLineWarm: string;
  chartLineHot: string;
  chartGrid: string;
  chartLabel: string;
  minimapPanelBackground: string;
  minimapModeBackground: string;
  minimapModeBorder: string;
  minimapModeText: string;
  minimapBorder: string;
  minimapViewportStroke: string;
  minimapViewportFill: string;
  thermalLow: { r: number; g: number; b: number };
  thermalMid: { r: number; g: number; b: number };
  thermalHigh: { r: number; g: number; b: number };
};

export const DEFAULT_HUD_THEME: HudTheme = {
  topBarBackground: "rgba(8, 10, 14, 0.78)",
  topBarBorder: "rgba(255, 255, 255, 0.18)",
  textPrimary: "#f2f2f2",
  textMuted: "rgba(27, 27, 27, 0.8)",
  speedButtonBackground: "rgba(30, 36, 48, 0.9)",
  speedButtonBorder: "rgba(255, 255, 255, 0.22)",
  slotCardBackground: "rgba(255, 255, 255, 0.92)",
  slotCardBorder: "rgba(27, 27, 27, 0.18)",
  slotHeaderBackground: "rgba(8, 10, 14, 0.08)",
  slotHeaderBorder: "rgba(27, 27, 27, 0.2)",
  slotHeaderText: "rgba(27, 27, 27, 0.8)",
  toastInfoBackground: "rgba(40, 48, 60, 0.92)",
  toastWarningBackground: "rgba(191, 129, 36, 0.92)",
  toastErrorBackground: "rgba(176, 63, 46, 0.92)",
  toastBorder: "rgba(255, 255, 255, 0.18)",
  toastText: "#f2f2f2",
  debugPanelBackground: "rgba(0, 0, 0, 0.75)",
  debugPanelBorder: "rgba(255, 255, 255, 0.2)",
  debugPanelText: "#e8e8e8",
  chartCardBackground: "rgba(255, 255, 255, 0.92)",
  chartCardBorder: "rgba(27, 27, 27, 0.12)",
  chartBackground: "rgba(27, 27, 27, 0.05)",
  chartBorder: "rgba(27, 27, 27, 0.12)",
  chartBandColors: [
    "rgba(43, 104, 140, 0.25)",
    "rgba(90, 143, 78, 0.22)",
    "rgba(240, 179, 59, 0.28)",
    "rgba(209, 74, 44, 0.3)"
  ],
  chartSeasonColors: [
    "rgba(43, 104, 140, 0.12)",
    "rgba(90, 143, 78, 0.12)",
    "rgba(240, 179, 59, 0.14)",
    "rgba(209, 74, 44, 0.12)"
  ],
  chartLineCool: "#2b688c",
  chartLineWarm: "#f0b33b",
  chartLineHot: "#d14a2c",
  chartGrid: "rgba(27, 27, 27, 0.2)",
  chartLabel: "rgba(27, 27, 27, 0.7)",
  minimapPanelBackground: "rgba(10, 12, 16, 0.06)",
  minimapModeBackground: "rgba(8, 10, 14, 0.75)",
  minimapModeBorder: "rgba(255, 255, 255, 0.15)",
  minimapModeText: "#f2f2f2",
  minimapBorder: "rgba(27, 27, 27, 0.35)",
  minimapViewportStroke: "rgba(80, 160, 220, 0.85)",
  minimapViewportFill: "rgba(80, 160, 220, 0.45)",
  thermalLow: { r: 20, g: 20, b: 22 },
  thermalMid: { r: 192, g: 70, b: 40 },
  thermalHigh: { r: 242, g: 201, b: 76 }
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
  theme: HudTheme;
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
  camera: null,
  theme: {
    ...DEFAULT_HUD_THEME,
    chartBandColors: [...DEFAULT_HUD_THEME.chartBandColors] as [string, string, string, string],
    chartSeasonColors: [...DEFAULT_HUD_THEME.chartSeasonColors] as [string, string, string, string],
    thermalLow: { ...DEFAULT_HUD_THEME.thermalLow },
    thermalMid: { ...DEFAULT_HUD_THEME.thermalMid },
    thermalHigh: { ...DEFAULT_HUD_THEME.thermalHigh }
  }
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
