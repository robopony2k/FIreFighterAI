import type { TileType } from "../../core/types.js";
import { createFireSimLabSession } from "../../systems/fire/sim/fireSimLabSession.js";
import {
  FIRE_SIM_LAB_INCIDENT_TICK_SECONDS,
  FIRE_SIM_LAB_TERRAIN_TYPES,
  normalizeFireSimLabScenarioId,
  type FireSimLabScenarioId,
  type FireSimLabTool
} from "../../systems/fire/types/fireSimLabTypes.js";
import { loadFireSimLabFuelProfileDrafts } from "./fuelProfileDrafts.js";
import { createFireSimLabGridView } from "./gridView.js";
import { createFireSimLabPanel } from "./panel.js";

export type FireSimLabController = {
  start: () => void;
  stop: () => void;
  resize: () => void;
  dispose: () => void;
};

export const createFireSimLabController = (
  mount: HTMLElement,
  initialScenarioId: FireSimLabScenarioId = "mixed-fuels"
): FireSimLabController => {
  const session = createFireSimLabSession(
    normalizeFireSimLabScenarioId(initialScenarioId),
    loadFireSimLabFuelProfileDrafts()
  );
  const root = document.createElement("div");
  root.className = "fire-sim-lab-shell";
  mount.appendChild(root);

  let paused = false;
  let tool: FireSimLabTool = "paint";
  let brushType: TileType = FIRE_SIM_LAB_TERRAIN_TYPES[0] ?? "grass";
  let brushSize = 1;
  let rafId = 0;
  let running = false;
  let disposed = false;
  let lastFrameMs: number | null = null;
  let syncAccumulatorMs = 0;

  const applyCellAction = (tile: { x: number; y: number }): void => {
    if (tool === "ignite") {
      session.igniteTile(tile.x, tile.y, brushSize);
    } else if (tool === "cool") {
      session.coolTile(tile.x, tile.y, brushSize);
    } else if (tool === "firefighter") {
      session.toggleFirefighter(tile.x, tile.y);
    } else {
      session.paintTile(tile.x, tile.y, brushType, brushSize);
    }
    gridView.render();
    panel.sync();
  };

  const gridView = createFireSimLabGridView({
    session,
    getTool: () => tool,
    getBrushType: () => brushType,
    getBrushRadius: () => brushSize,
    onCellAction: applyCellAction,
    onHover: (tile) => {
      panel.setHoverTile(tile);
      gridView.render();
    }
  });
  root.appendChild(gridView.element);

  const panel = createFireSimLabPanel({
    session,
    getPaused: () => paused,
    setPaused: (nextPaused) => {
      paused = nextPaused;
    },
    getTool: () => tool,
    setTool: (nextTool) => {
      tool = nextTool;
    },
    getBrushType: () => brushType,
    setBrushType: (nextType) => {
      brushType = nextType;
    },
    getBrushRadius: () => brushSize,
    setBrushRadius: (nextRadius) => {
      brushSize = Math.max(1, Math.min(4, Math.floor(nextRadius)));
    },
    onStep: () => {
      session.step(FIRE_SIM_LAB_INCIDENT_TICK_SECONDS);
      gridView.render();
    },
    onChange: () => {
      gridView.render();
    }
  });
  root.appendChild(panel.element);

  const resize = (): void => {
    gridView.resize();
    gridView.render();
  };

  const renderFrame = (now: number): void => {
    if (disposed) {
      return;
    }
    if (running) {
      rafId = window.requestAnimationFrame(renderFrame);
    }
    const deltaMs = lastFrameMs === null ? 16.6667 : Math.min(80, Math.max(1, now - lastFrameMs));
    lastFrameMs = now;
    if (!paused) {
      session.step(deltaMs * 0.001);
    }
    gridView.render();
    syncAccumulatorMs += deltaMs;
    if (syncAccumulatorMs >= 120) {
      syncAccumulatorMs = 0;
      panel.sync();
    }
  };

  resize();
  panel.sync();

  return {
    start: () => {
      if (running || disposed) {
        return;
      }
      running = true;
      lastFrameMs = null;
      rafId = window.requestAnimationFrame(renderFrame);
    },
    stop: () => {
      running = false;
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
    },
    resize,
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (rafId !== 0) {
        window.cancelAnimationFrame(rafId);
        rafId = 0;
      }
      gridView.destroy();
      panel.destroy();
      root.remove();
    }
  };
};
