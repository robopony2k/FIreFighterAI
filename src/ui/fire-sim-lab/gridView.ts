import { TILE_COLORS, UNIT_CONFIG } from "../../core/config.js";
import type { TileType } from "../../core/types.js";
import type { FireSimLabSession } from "../../systems/fire/sim/fireSimLabSession.js";
import {
  FIRE_SIM_LAB_FIREFIGHTER_COOLING_RADIUS,
  FIRE_SIM_LAB_FIREFIGHTER_HOSE_RANGE,
  FIRE_SIM_LAB_FIREFIGHTER_SYMBOL,
  type FireSimLabTool
} from "../../systems/fire/types/fireSimLabTypes.js";
import { getFireSimLabCellSymbol, type FireSimLabCellSymbolState } from "./cellSymbols.js";

export type FireSimLabGridPointer = {
  x: number;
  y: number;
};

export type FireSimLabGridViewOptions = {
  session: FireSimLabSession;
  getTool: () => FireSimLabTool;
  getBrushType: () => TileType;
  getBrushRadius: () => number;
  onCellAction: (tile: FireSimLabGridPointer) => void;
  onHover: (tile: FireSimLabGridPointer | null) => void;
};

export type FireSimLabGridView = {
  element: HTMLDivElement;
  resize: () => void;
  render: () => void;
  destroy: () => void;
};

type GridLayout = {
  cellSize: number;
  offsetX: number;
  offsetY: number;
  width: number;
  height: number;
};

type SymbolDraw = {
  symbol: string;
  state: FireSimLabCellSymbolState;
  x: number;
  y: number;
};

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255
  };
};

const getTileColor = (type: TileType): string => TILE_COLORS[type] ?? "#64748b";

const getLayout = (canvas: HTMLCanvasElement, cols: number, rows: number): GridLayout => {
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const cellSize = Math.max(2, Math.floor(Math.min(width / cols, height / rows)));
  const gridWidth = cellSize * cols;
  const gridHeight = cellSize * rows;
  return {
    cellSize,
    width: gridWidth,
    height: gridHeight,
    offsetX: Math.floor((width - gridWidth) * 0.5),
    offsetY: Math.floor((height - gridHeight) * 0.5)
  };
};

const getBrushSquareStart = (center: number, brushSize: number): number =>
  center - Math.floor((Math.max(1, Math.floor(brushSize)) - 1) * 0.5);

export const createFireSimLabGridView = ({
  session,
  getTool,
  getBrushType,
  getBrushRadius,
  onCellAction,
  onHover
}: FireSimLabGridViewOptions): FireSimLabGridView => {
  const element = document.createElement("div");
  element.className = "fire-sim-lab-grid-shell";
  const canvas = document.createElement("canvas");
  canvas.className = "fire-sim-lab-grid";
  element.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("SIM Lab canvas is unavailable.");
  }

  let hoverTile: FireSimLabGridPointer | null = null;
  let drawing = false;
  let lastActionKey = "";

  const resize = (): void => {
    const rect = element.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const tileFromPointer = (event: PointerEvent): FireSimLabGridPointer | null => {
    const rect = canvas.getBoundingClientRect();
    const layout = getLayout(canvas, session.state.grid.cols, session.state.grid.rows);
    const x = event.clientX - rect.left - layout.offsetX;
    const y = event.clientY - rect.top - layout.offsetY;
    if (x < 0 || y < 0 || x >= layout.width || y >= layout.height) {
      return null;
    }
    return {
      x: Math.max(0, Math.min(session.state.grid.cols - 1, Math.floor(x / layout.cellSize))),
      y: Math.max(0, Math.min(session.state.grid.rows - 1, Math.floor(y / layout.cellSize)))
    };
  };

  const applyPointerAction = (event: PointerEvent): void => {
    const tile = tileFromPointer(event);
    if (!tile) {
      return;
    }
    const key = `${tile.x}:${tile.y}`;
    if (key === lastActionKey) {
      return;
    }
    lastActionKey = key;
    onCellAction(tile);
  };

  const drawWindArrow = (width: number): void => {
    const wind = session.state.wind;
    const strength = Math.max(0, Math.min(1.5, wind.strength));
    const startX = 26;
    const startY = 28;
    const length = 24 + strength * 24;
    const dx = wind.dx * length;
    const dy = wind.dy * length;
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(219, 234, 248, 0.88)";
    ctx.fillStyle = "rgba(219, 234, 248, 0.88)";
    ctx.beginPath();
    ctx.moveTo(startX, startY);
    ctx.lineTo(startX + dx, startY + dy);
    ctx.stroke();
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(startX + dx, startY + dy);
    ctx.lineTo(startX + dx - Math.cos(angle - 0.55) * 10, startY + dy - Math.sin(angle - 0.55) * 10);
    ctx.lineTo(startX + dx - Math.cos(angle + 0.55) * 10, startY + dy - Math.sin(angle + 0.55) * 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(12, 18, 24, 0.72)";
    ctx.fillRect(12, 54, Math.min(96, width - 24), 22);
    ctx.fillStyle = "rgba(231, 244, 255, 0.9)";
    ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(`Wind ${Math.round(strength * 100)}%`, 20, 69);
    ctx.restore();
  };

  const drawBrushPreview = (layout: GridLayout): void => {
    if (!hoverTile) {
      return;
    }
    if (getTool() === "firefighter") {
      const centerX = layout.offsetX + (hoverTile.x + 0.5) * layout.cellSize;
      const centerY = layout.offsetY + (hoverTile.y + 0.5) * layout.cellSize;
      const radiusPx = FIRE_SIM_LAB_FIREFIGHTER_COOLING_RADIUS * layout.cellSize;
      const hoseRangePx = FIRE_SIM_LAB_FIREFIGHTER_HOSE_RANGE * layout.cellSize;
      ctx.save();
      ctx.strokeStyle = "rgba(240, 179, 59, 0.95)";
      ctx.lineWidth = 2;
      ctx.fillStyle = "rgba(240, 179, 59, 0.14)";
      ctx.beginPath();
      ctx.arc(centerX, centerY, radiusPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = "rgba(240, 179, 59, 0.36)";
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(centerX, centerY, hoseRangePx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }
    const brushSize = Math.max(1, Math.floor(getBrushRadius()));
    const brushColor = getTileColor(getBrushType());
    const rgb = hexToRgb(brushColor);
    ctx.save();
    ctx.strokeStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.95)`;
    ctx.lineWidth = 2;
    ctx.fillStyle = `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 0.16)`;
    const size = layout.cellSize;
    const x = layout.offsetX + getBrushSquareStart(hoverTile.x, brushSize) * size;
    const y = layout.offsetY + getBrushSquareStart(hoverTile.y, brushSize) * size;
    const d = brushSize * size;
    ctx.fillRect(x, y, d, d);
    ctx.strokeRect(x + 1, y + 1, Math.max(0, d - 2), Math.max(0, d - 2));
    ctx.restore();
  };

  const drawFirefighters = (layout: GridLayout): void => {
    const firefighters = session.getFirefighters();
    if (firefighters.length <= 0) {
      return;
    }
    const radiusPx = FIRE_SIM_LAB_FIREFIGHTER_COOLING_RADIUS * layout.cellSize;
    const hoseRangePx = FIRE_SIM_LAB_FIREFIGHTER_HOSE_RANGE * layout.cellSize;
    const iconSize = Math.max(8, Math.min(16, Math.floor(layout.cellSize * 1.05)));
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${iconSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", ui-sans-serif, system-ui, sans-serif`;
    firefighters.forEach((firefighter) => {
      const x = layout.offsetX + (firefighter.x + 0.5) * layout.cellSize;
      const y = layout.offsetY + (firefighter.y + 0.5) * layout.cellSize;
      ctx.strokeStyle = "rgba(240, 179, 59, 0.22)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.arc(x, y, hoseRangePx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = "rgba(240, 179, 59, 0.74)";
      ctx.lineWidth = 1.5;
      ctx.fillStyle = "rgba(240, 179, 59, 0.09)";
      ctx.beginPath();
      ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = UNIT_CONFIG.firefighter.color;
      ctx.shadowColor = "rgba(0, 0, 0, 0.65)";
      ctx.shadowBlur = 3;
      ctx.fillText(FIRE_SIM_LAB_FIREFIGHTER_SYMBOL, x, y);
    });
    ctx.restore();
  };

  const drawCellSymbols = (symbols: readonly SymbolDraw[], cellSize: number): void => {
    if (symbols.length <= 0 || cellSize < 7) {
      return;
    }
    const fontSize = Math.max(7, Math.min(15, Math.floor(cellSize * 0.82)));
    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", ui-sans-serif, system-ui, sans-serif`;
    symbols.forEach((entry) => {
      if (entry.state === "fire") {
        ctx.shadowColor = "rgba(255, 203, 91, 0.72)";
        ctx.shadowBlur = 5;
        ctx.fillStyle = "#fff7ed";
      } else if (entry.state === "igniting") {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#ffe08a";
      } else if (entry.state === "hot") {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#fbbf24";
      } else if (entry.state === "cooling") {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#f8fafc";
      } else {
        ctx.shadowBlur = 0;
        ctx.fillStyle = "#d1d5db";
      }
      ctx.fillText(entry.symbol, entry.x, entry.y);
    });
    ctx.restore();
  };

  const render = (): void => {
    const width = canvas.clientWidth || canvas.width;
    const height = canvas.clientHeight || canvas.height;
    const { cols, rows } = session.state.grid;
    const layout = getLayout(canvas, cols, rows);
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#10151a";
    ctx.fillRect(0, 0, width, height);
    const symbols: SymbolDraw[] = [];

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const idx = y * cols + x;
        const tile = session.state.tiles[idx];
        const px = layout.offsetX + x * layout.cellSize;
        const py = layout.offsetY + y * layout.cellSize;
        ctx.fillStyle = getTileColor(tile.type);
        ctx.fillRect(px, py, layout.cellSize, layout.cellSize);
        const wetness01 = Math.max(0, Math.min(1, session.state.tileSuppressionWetness[idx] ?? 0));
        const heat01 = Math.max(0, Math.min(1, (session.state.tileHeat[idx] ?? 0) / session.state.fireSettings.heatCap));
        const fire01 = Math.max(0, Math.min(1, session.state.tileFire[idx] ?? 0));
        if (wetness01 > 0.02) {
          ctx.fillStyle = `rgba(56, 189, 248, ${0.1 + wetness01 * 0.28})`;
          ctx.fillRect(px, py, layout.cellSize, layout.cellSize);
        }
        if (heat01 > 0.02) {
          ctx.fillStyle = `rgba(251, 146, 60, ${0.1 + heat01 * 0.45})`;
          ctx.fillRect(px, py, layout.cellSize, layout.cellSize);
        }
        if (fire01 > 0.01) {
          ctx.fillStyle = `rgba(248, 250, 252, ${Math.min(0.42, fire01 * 0.32)})`;
          ctx.fillRect(px + layout.cellSize * 0.28, py + layout.cellSize * 0.18, layout.cellSize * 0.44, layout.cellSize * 0.64);
          ctx.fillStyle = `rgba(220, 38, 38, ${0.34 + fire01 * 0.48})`;
          ctx.fillRect(px, py, layout.cellSize, layout.cellSize);
        }
        const cellSymbol = getFireSimLabCellSymbol(tile.type, fire01, heat01, session.state.tileFuel[idx] ?? tile.fuel);
        if (cellSymbol) {
          symbols.push({
            symbol: cellSymbol.symbol,
            state: cellSymbol.state,
            x: px + layout.cellSize * 0.5,
            y: py + layout.cellSize * 0.54
          });
        }
      }
    }

    ctx.strokeStyle = "rgba(255, 255, 255, 0.05)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= cols; x += 4) {
      const px = layout.offsetX + x * layout.cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, layout.offsetY);
      ctx.lineTo(px, layout.offsetY + layout.height);
      ctx.stroke();
    }
    for (let y = 0; y <= rows; y += 4) {
      const py = layout.offsetY + y * layout.cellSize + 0.5;
      ctx.beginPath();
      ctx.moveTo(layout.offsetX, py);
      ctx.lineTo(layout.offsetX + layout.width, py);
      ctx.stroke();
    }
    drawCellSymbols(symbols, layout.cellSize);
    drawFirefighters(layout);
    drawBrushPreview(layout);
    drawWindArrow(width);
  };

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) {
      return;
    }
    drawing = true;
    lastActionKey = "";
    canvas.setPointerCapture(event.pointerId);
    applyPointerAction(event);
  });
  canvas.addEventListener("pointermove", (event) => {
    hoverTile = tileFromPointer(event);
    onHover(hoverTile);
    if (drawing) {
      applyPointerAction(event);
    }
  });
  canvas.addEventListener("pointerup", (event) => {
    drawing = false;
    lastActionKey = "";
    if (canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  });
  canvas.addEventListener("pointerleave", () => {
    hoverTile = null;
    onHover(null);
    drawing = false;
    lastActionKey = "";
  });

  return {
    element,
    resize,
    render,
    destroy: () => {
      element.remove();
    }
  };
};
