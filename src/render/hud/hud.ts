import type { WorldState } from "../../core/state.js";
import type { InputState } from "../../core/inputState.js";
import { indexFor } from "../../core/grid.js";
import { DEFAULT_MOISTURE_PARAMS } from "../../core/climate.js";
import { TIME_SPEED_OPTIONS } from "../../core/config.js";
import { buildHudLayout, WidgetSlot, WidgetType, type Rect } from "./hudLayout.js";
import type { HudState } from "./hudState.js";
import { addToast, cycleWidget, stepToasts, toggleCompact } from "./hudState.js";
import type { HudInput, HudWidget } from "./widgets/hudWidget.js";
import { ClimateChartWidget } from "./widgets/ClimateChartWidget.js";
import { MinimapWidget } from "./widgets/MinimapWidget.js";
import { DebugWidget } from "./widgets/DebugWidget.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const formatNumber = (value: number, digits = 3): string => (Number.isFinite(value) ? value.toFixed(digits) : "inf");
const formatOptional = (value: number | undefined | null, digits = 3): string =>
  typeof value === "number" ? value.toFixed(digits) : "n/a";

const drawRoundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) => {
  const r = Math.min(radius, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

const widgetCache = new Map<string, HudWidget>();

const getWidget = (slot: WidgetSlot, type: WidgetType): HudWidget => {
  const key = `${slot}:${type}`;
  const existing = widgetCache.get(key);
  if (existing) {
    return existing;
  }
  let widget: HudWidget;
  switch (type) {
    case WidgetType.Minimap:
      widget = new MinimapWidget(slot);
      break;
    case WidgetType.Debug:
      widget = new DebugWidget(slot);
      break;
    case WidgetType.ClimateChart:
    default:
      widget = new ClimateChartWidget(slot);
      break;
  }
  widgetCache.set(key, widget);
  return widget;
};

const widgetLabel = (type: WidgetType, compact: boolean): string => {
  const name =
    type === WidgetType.ClimateChart ? "Climate" : type === WidgetType.Minimap ? "Minimap" : "Debug";
  return compact ? `${name} (Compact)` : name;
};

const layoutSlotRects = (slotRect: Rect, headerHeight: number, padding: number) => {
  const headerRect: Rect = { x: slotRect.x, y: slotRect.y, width: slotRect.width, height: headerHeight };
  const contentRect: Rect = {
    x: slotRect.x + padding,
    y: slotRect.y + headerHeight + padding,
    width: Math.max(0, slotRect.width - padding * 2),
    height: Math.max(0, slotRect.height - headerHeight - padding * 2)
  };
  return { headerRect, contentRect };
};

const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  words.forEach((word) => {
    const test = current ? `${current} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || current.length === 0) {
      current = test;
    } else {
      lines.push(current);
      current = word;
    }
  });
  if (current) {
    lines.push(current);
  }
  return lines.length > 0 ? lines : [text];
};

const SPEED_BUTTON_WIDTH = 124;
const SPEED_BUTTON_HEIGHT = 24;
const SPEED_BUTTON_SIDE = 22;

const getSpeedButtonRect = (rect: Rect): Rect => ({
  x: rect.x + rect.width - 12 - SPEED_BUTTON_WIDTH,
  y: rect.y + (rect.height - SPEED_BUTTON_HEIGHT) * 0.5,
  width: SPEED_BUTTON_WIDTH,
  height: SPEED_BUTTON_HEIGHT
});

const renderTopBar = (ctx: CanvasRenderingContext2D, world: WorldState, ui: HudState, rect: Rect): void => {
  const theme = ui.theme;
  const padding = 12;
  drawRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 10);
  ctx.fillStyle = theme.topBarBackground;
  ctx.fill();
  ctx.strokeStyle = theme.topBarBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  const tempValue = Number.isFinite(world.climateTemp) ? `${Math.round(world.climateTemp)}C` : "--";
  const moistureDenom = Math.max(0.0001, DEFAULT_MOISTURE_PARAMS.Mmax - DEFAULT_MOISTURE_PARAMS.Mmin);
  const moistureNorm = clamp((world.climateMoisture - DEFAULT_MOISTURE_PARAMS.Mmin) / moistureDenom, 0, 1);
  const dryness = Math.round((1 - moistureNorm) * 100);
  const windStrength = Math.round((world.wind?.strength ?? 0) * 10);
  const windLabel = windStrength > 0 ? `${world.wind?.name ?? "?"} ${windStrength}` : "Calm";
  const leftText = `TEMP ${tempValue} | WIND ${windLabel} | DRY ${dryness}%`;

  const day = Math.max(1, Math.ceil(world.phaseDay + 0.0001));
  const year = world.year;
  const phaseText = ui.phaseLabelOverride
    ? ui.phaseLabelOverride.toUpperCase()
    : `PHASE: ${String(world.phase).toUpperCase()}`;
  const centerText = `${phaseText} | DAY ${day} | YEAR ${year}`;

  const approval = Number.isFinite(world.approval) ? `${Math.round(clamp(world.approval, 0, 1) * 100)}%` : "--";
  const totalHouses = Number.isFinite(world.totalHouses) ? Math.max(0, Math.floor(world.totalHouses)) : 0;
  const destroyedHouses = Number.isFinite(world.destroyedHouses) ? Math.max(0, Math.floor(world.destroyedHouses)) : 0;
  const liveHouses = Math.max(0, totalHouses - destroyedHouses);
  const speedIndex = Math.min(Math.max(world.timeSpeedIndex ?? 0, 0), TIME_SPEED_OPTIONS.length - 1);
  const speed = TIME_SPEED_OPTIONS[speedIndex] ?? 1;
  const rightText = `APPROVAL ${approval} | HOUSES ${liveHouses}`;

  ctx.fillStyle = theme.textPrimary;
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";

  ctx.textAlign = "left";
  ctx.fillText(leftText, rect.x + padding, rect.y + rect.height / 2);
  ctx.textAlign = "center";
  ctx.fillText(centerText, rect.x + rect.width / 2, rect.y + rect.height / 2);
  const speedRect = getSpeedButtonRect(rect);
  ctx.fillStyle = theme.speedButtonBackground;
  drawRoundedRect(ctx, speedRect.x, speedRect.y, speedRect.width, speedRect.height, 8);
  ctx.fill();
  ctx.strokeStyle = theme.speedButtonBorder;
  ctx.stroke();
  ctx.fillStyle = theme.textPrimary;
  ctx.textAlign = "center";
  ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("-", speedRect.x + SPEED_BUTTON_SIDE * 0.5, speedRect.y + speedRect.height / 2);
  ctx.fillText("+", speedRect.x + speedRect.width - SPEED_BUTTON_SIDE * 0.5, speedRect.y + speedRect.height / 2);
  ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`SPEED ${speed}x`, speedRect.x + speedRect.width / 2, speedRect.y + speedRect.height / 2);
  ctx.textAlign = "right";
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(rightText, speedRect.x - 12, rect.y + rect.height / 2);
};

const renderToasts = (ctx: CanvasRenderingContext2D, ui: HudState, area: Rect): void => {
  if (ui.toasts.length === 0) {
    return;
  }
  const theme = ui.theme;
  ctx.save();
  const toastWidth = area.width;
  const padding = 10;
  const lineHeight = 14;
  let y = area.y;
  ctx.font = "600 12px ui-sans-serif, system-ui, sans-serif";
  ui.toasts.forEach((toast) => {
    const lines = wrapText(ctx, toast.message, toastWidth - padding * 2);
    const height = Math.max(24, lines.length * lineHeight + padding * 2);
    if (y + height > area.y + area.height) {
      return;
    }
    const bg =
      toast.severity === "error"
        ? theme.toastErrorBackground
        : toast.severity === "warning"
          ? theme.toastWarningBackground
          : theme.toastInfoBackground;
    ctx.fillStyle = bg;
    ctx.strokeStyle = theme.toastBorder;
    drawRoundedRect(ctx, area.x, y, toastWidth, height, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = theme.toastText;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    let lineY = y + padding;
    lines.forEach((line) => {
      ctx.fillText(line, area.x + padding, lineY);
      lineY += lineHeight;
    });
    y += height + 6;
  });
  ctx.restore();
};

const autoToasts = (world: WorldState, ui: HudState): void => {
  const phase = String(world.phase);
  if (ui.lastPhase && ui.lastPhase !== phase) {
    addToast(ui, `Phase change: ${ui.lastPhase.toUpperCase()} -> ${phase.toUpperCase()}`, "info", 3200);
  }
  ui.lastPhase = phase;
  const windName = world.wind?.name ?? "";
  if (ui.lastWindName && ui.lastWindName !== windName) {
    addToast(ui, `Wind shift: ${ui.lastWindName} -> ${windName}`, "warning", 3200);
  }
  ui.lastWindName = windName;
};

const renderDebugCellOverlay = (
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  ui: HudState,
  inputState: InputState,
  width: number,
  height: number
): void => {
  if (!inputState.debugCellEnabled || !inputState.debugHoverTile) {
    return;
  }
  const tileX = Math.floor(inputState.debugHoverTile.x);
  const tileY = Math.floor(inputState.debugHoverTile.y);
  if (tileX < 0 || tileY < 0 || tileX >= world.grid.cols || tileY >= world.grid.rows) {
    return;
  }
  const idx = indexFor(world.grid, tileX, tileY);
  const tile = world.tiles[idx];
  if (!tile) {
    return;
  }
  const cachedFire = world.tileFire[idx];
  const cachedHeat = world.tileHeat[idx];
  const cachedFuel = world.tileFuel[idx];
  const cachedIgniteAt = world.tileIgniteAt[idx];
  const cachedIgnition = world.tileIgnitionPoint[idx];
  const cachedBurnRate = world.tileBurnRate[idx];
  const cachedHeatOutput = world.tileHeatOutput[idx];
  const inBounds =
    world.fireBoundsActive &&
    tileX >= world.fireMinX &&
    tileX <= world.fireMaxX &&
    tileY >= world.fireMinY &&
    tileY <= world.fireMaxY;
  const hoverWorld = inputState.debugHoverWorld;
  const lines = [
    `cell ${tileX},${tileY}`,
    `type=${tile.type} id=${world.tileTypeId[idx] ?? "n/a"} base=${tile.isBase ? "1" : "0"}`,
    `phase=${world.phase} paused=${world.paused ? "1" : "0"} fireDay=${formatNumber(world.fireSeasonDay, 2)}`,
    `simAcc=${formatNumber(world.fireSimAccumulator, 2)} active=${world.lastActiveFires}`,
    `fire=${formatNumber(tile.fire)} heat=${formatNumber(tile.heat)} fuel=${formatNumber(tile.fuel)}`,
    `ignite=${formatNumber(tile.ignitionPoint)} burn=${formatNumber(tile.burnRate)} heatOut=${formatNumber(tile.heatOutput)}`,
    `spread=${formatOptional(tile.spreadBoost)} cap=${formatOptional(tile.heatTransferCap)} retain=${formatOptional(tile.heatRetention)}`,
    `wind=${formatOptional(tile.windFactor)} moist=${formatNumber(tile.moisture)} canopy=${formatNumber(tile.canopy)}`,
    `ashAge=${formatNumber(tile.ashAge, 2)} elev=${formatNumber(tile.elevation)} height=n/a`,
    `cache fire=${formatNumber(cachedFire)} heat=${formatNumber(cachedHeat)} fuel=${formatNumber(cachedFuel)}`,
    `cache ignite=${formatNumber(cachedIgnition)} burn=${formatNumber(cachedBurnRate)} heatOut=${formatNumber(cachedHeatOutput)}`,
    `igniteAt=${formatNumber(cachedIgniteAt, 3)} smooth=n/a`,
    `bounds active=${world.fireBoundsActive ? "1" : "0"} in=${inBounds ? "1" : "0"}`,
    hoverWorld ? `world ${formatNumber(hoverWorld.x, 2)},${formatNumber(hoverWorld.y, 2)}` : "world n/a"
  ];
  const padding = 8;
  const lineHeight = 14;
  ctx.save();
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  let maxWidth = 0;
  lines.forEach((line) => {
    const measured = ctx.measureText(line).width;
    if (measured > maxWidth) {
      maxWidth = measured;
    }
  });
  const boxWidth = Math.min(Math.max(0, width - padding * 2), maxWidth + padding * 2);
  if (boxWidth <= 0) {
    ctx.restore();
    return;
  }
  const boxHeight = lines.length * lineHeight + padding * 2;
  const boxX = padding;
  const boxY = Math.max(padding, height - boxHeight - padding);
  ctx.fillStyle = ui.theme.debugPanelBackground;
  ctx.fillRect(boxX, boxY, boxWidth, boxHeight);
  ctx.strokeStyle = ui.theme.debugPanelBorder;
  ctx.strokeRect(boxX, boxY, boxWidth, boxHeight);
  ctx.fillStyle = ui.theme.debugPanelText;
  lines.forEach((line, i) => {
    ctx.fillText(line, boxX + padding, boxY + padding + i * lineHeight);
  });
  ctx.restore();
};

export const renderHud = (
  ctx: CanvasRenderingContext2D,
  world: WorldState,
  ui: HudState,
  inputState: InputState,
  dt: number
): void => {
  const width = ui.viewport.width;
  const height = ui.viewport.height;
  if (width <= 0 || height <= 0) {
    return;
  }
  ctx.clearRect(0, 0, width, height);
  if (dt > 0) {
    const next = 1 / dt;
    ui.fps = ui.fps > 0 ? ui.fps * 0.9 + next * 0.1 : next;
  }
  stepToasts(ui, dt);
  autoToasts(world, ui);

  const layout = buildHudLayout({ width, height });
  renderTopBar(ctx, world, ui, layout.topBar);

  const slots = [WidgetSlot.A, WidgetSlot.B];
  slots.forEach((slot) => {
    const slotRect = layout.widgetSlots[slot];
    const { headerRect, contentRect } = layoutSlotRects(slotRect, layout.slotHeaderHeight, layout.slotPadding);
    const slotState = ui.slots[slot];
    const label = widgetLabel(slotState.widget, slotState.compact);

    ctx.fillStyle = ui.theme.slotCardBackground;
    ctx.strokeStyle = ui.theme.slotCardBorder;
    drawRoundedRect(ctx, slotRect.x, slotRect.y, slotRect.width, slotRect.height, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ui.theme.slotHeaderBackground;
    ctx.fillRect(headerRect.x, headerRect.y, headerRect.width, headerRect.height);
    ctx.strokeStyle = ui.theme.slotHeaderBorder;
    ctx.strokeRect(headerRect.x + 0.5, headerRect.y + 0.5, headerRect.width - 1, headerRect.height - 1);

    ctx.fillStyle = ui.theme.slotHeaderText;
    ctx.font = "700 11px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(`WIDGET SLOT ${slot}`, headerRect.x + 10, headerRect.y + headerRect.height / 2);

    ctx.textAlign = "right";
    ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(label.toUpperCase(), headerRect.x + headerRect.width - 10, headerRect.y + headerRect.height / 2);

    if (contentRect.width > 0 && contentRect.height > 0) {
      const widget = getWidget(slot, slotState.widget);
      widget.render(ctx, contentRect, world, ui);
    }
  });

  renderDebugCellOverlay(ctx, world, ui, inputState, width, height);
  renderToasts(ctx, ui, layout.toastArea);
};

export const handleHudKey = (event: KeyboardEvent, ui: HudState): boolean => {
  const key = event.key;
  if (key !== "F7" && key !== "F8") {
    return false;
  }
  event.preventDefault();
  const slot = key === "F7" ? WidgetSlot.A : WidgetSlot.B;
  if (event.shiftKey) {
    toggleCompact(ui, slot);
  } else {
    cycleWidget(ui, slot);
  }
  return true;
};

export const handleHudClick = (
  x: number,
  y: number,
  world: WorldState,
  ui: HudState
): boolean => {
  const layout = buildHudLayout({ width: ui.viewport.width, height: ui.viewport.height });
  const speedRect = getSpeedButtonRect(layout.topBar);
  if (x >= speedRect.x && x <= speedRect.x + speedRect.width && y >= speedRect.y && y <= speedRect.y + speedRect.height) {
    const len = TIME_SPEED_OPTIONS.length;
    const current = Math.min(Math.max(world.timeSpeedIndex ?? 0, 0), len - 1);
    let next = current;
    if (x < speedRect.x + SPEED_BUTTON_SIDE) {
      next = (current - 1 + len) % len;
    } else if (x > speedRect.x + speedRect.width - SPEED_BUTTON_SIDE) {
      next = (current + 1) % len;
    } else {
      next = (current + 1) % len;
    }
    world.timeSpeedIndex = next;
    addToast(ui, `Time speed ${TIME_SPEED_OPTIONS[next]}x.`, "info", 2200);
    return true;
  }
  const slots = [WidgetSlot.A, WidgetSlot.B];
  for (const slot of slots) {
    const slotRect = layout.widgetSlots[slot];
    if (x >= slotRect.x && x <= slotRect.x + slotRect.width && y >= slotRect.y && y <= slotRect.y + slotRect.height) {
      const { contentRect } = layoutSlotRects(slotRect, layout.slotHeaderHeight, layout.slotPadding);
      const widget = getWidget(slot, ui.slots[slot].widget);
      if (widget.handleInput) {
        const input: HudInput = { type: "click", x, y };
        widget.handleInput(input, contentRect, world, ui);
        return true;
      }
      return false;
    }
  }
  return false;
};
