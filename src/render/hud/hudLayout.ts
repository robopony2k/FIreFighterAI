import { getCanvasHudSlotWidgetIds, type CanvasHudWidgetId } from "../../ui/runtime/widgets/registry.js";

export type Rect = { x: number; y: number; width: number; height: number };

export type HudViewport = { width: number; height: number };

export type WidgetType = CanvasHudWidgetId | "debug";

export enum WidgetSlot {
  A = "A",
  B = "B"
}

const canvasHudWidgetIds = getCanvasHudSlotWidgetIds();

export const WIDGET_TYPES: WidgetType[] = [...canvasHudWidgetIds, "debug"];

export const DEFAULT_WIDGET_ASSIGNMENTS: Record<WidgetSlot, WidgetType> = {
  [WidgetSlot.A]: canvasHudWidgetIds[0] ?? "climate",
  [WidgetSlot.B]: canvasHudWidgetIds[1] ?? canvasHudWidgetIds[0] ?? "minimap"
};

export const HUD_LAYOUT = {
  margin: 16,
  topBarHeight: 44,
  slotGap: 14,
  slotHeaderHeight: 26,
  slotPadding: 10,
  rightColumnMin: 260,
  rightColumnMax: 360,
  slotMinHeight: 160,
  toastWidthMin: 240,
  toastWidthMax: 420,
  toastGap: 6,
  toastPadding: 8
} as const;

export const HUD_PLANE_Y = 0;

export type HudLayout = {
  viewport: HudViewport;
  topBar: Rect;
  widgetSlots: Record<WidgetSlot, Rect>;
  toastArea: Rect;
  slotHeaderHeight: number;
  slotPadding: number;
};

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

export const buildHudLayout = (viewport: HudViewport): HudLayout => {
  const width = Math.max(1, Math.floor(viewport.width));
  const height = Math.max(1, Math.floor(viewport.height));
  const margin = HUD_LAYOUT.margin;
  const topBar: Rect = {
    x: margin,
    y: margin,
    width: Math.max(0, width - margin * 2),
    height: HUD_LAYOUT.topBarHeight
  };
  const rightWidth = clamp(width * 0.28, HUD_LAYOUT.rightColumnMin, HUD_LAYOUT.rightColumnMax);
  const slotsTop = topBar.y + topBar.height + margin;
  const availableHeight = Math.max(0, height - slotsTop - margin - HUD_LAYOUT.slotGap);
  const maxSlotHeight = Math.max(HUD_LAYOUT.slotMinHeight, Math.floor(availableHeight / 2));
  const slotSize = Math.max(HUD_LAYOUT.slotMinHeight, Math.floor(Math.min(rightWidth, maxSlotHeight)));
  const slotX = width - margin - slotSize;
  const slotA: Rect = { x: slotX, y: slotsTop, width: slotSize, height: slotSize };
  const slotB: Rect = {
    x: slotX,
    y: slotA.y + slotSize + HUD_LAYOUT.slotGap,
    width: slotSize,
    height: slotSize
  };
  const toastWidth = clamp(width * 0.42, HUD_LAYOUT.toastWidthMin, HUD_LAYOUT.toastWidthMax);
  const toastArea: Rect = {
    x: Math.max(margin, width * 0.5 - toastWidth * 0.5),
    y: topBar.y + topBar.height + 8,
    width: toastWidth,
    height: Math.max(0, height - (topBar.y + topBar.height + margin))
  };
  return {
    viewport: { width, height },
    topBar,
    widgetSlots: {
      [WidgetSlot.A]: slotA,
      [WidgetSlot.B]: slotB
    },
    toastArea,
    slotHeaderHeight: HUD_LAYOUT.slotHeaderHeight,
    slotPadding: HUD_LAYOUT.slotPadding
  };
};
