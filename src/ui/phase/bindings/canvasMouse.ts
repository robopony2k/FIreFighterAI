import type { RNG, Unit } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import type { InputState } from "../../../core/inputState.js";
import type { RenderState } from "../../../render/renderState.js";
import type { InputAction } from "../types.js";
import { inBounds } from "../../../core/grid.js";
import { panCameraByPixels, screenToWorld, zoomAtPointer } from "../../../render/inputProjection.js";
import { resetStatus, setStatus } from "../../../core/state.js";
import { handleUnitDeployment, handleUnitRetask } from "../../../sim/index.js";
import {
  assignFormationTargets,
  clearFuelLine,
  clearUnitSelection,
  getSelectedUnits,
  getUnitAt,
  selectUnit,
  setDeployMode,
  toggleUnitSelection
} from "../../../sim/units.js";
import { wheelDeltaToZoomFactor } from "./canvasWheel.js";

type ListenCanvas = <K extends keyof HTMLElementEventMap>(
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions
) => void;

export type BindCanvasMouseDeps = {
  state: WorldState;
  inputState: InputState;
  renderState: RenderState;
  rng: RNG;
  canvas: HTMLCanvasElement;
  listenCanvas: ListenCanvas;
  noteInteraction: () => void;
  gate: (action: InputAction, handler: () => void) => void;
  isOverlayLocked: () => boolean;
  getTileFromPointer: (event: MouseEvent) => { x: number; y: number } | null;
  getWorldFromPointer: (event: MouseEvent) => { x: number; y: number };
  igniteDebugFireAt: (tile: { x: number; y: number }) => void;
  isDebugIgniteMode: () => boolean;
  isPanModifierDown: () => boolean;
  canZoom: () => boolean;
};

export const bindCanvasMouseHandlers = ({
  state,
  inputState,
  renderState,
  rng,
  canvas,
  listenCanvas,
  noteInteraction,
  gate,
  isOverlayLocked,
  getTileFromPointer,
  getWorldFromPointer,
  igniteDebugFireAt,
  isDebugIgniteMode,
  isPanModifierDown,
  canZoom
}: BindCanvasMouseDeps): void => {
  let isPanning = false;
  let isSelecting = false;
  let isFormationDrag = false;
  let suppressClick = false;
  let panAnchor: { x: number; y: number } | null = null;
  let panCamera: { x: number; y: number } | null = null;
  let selectStart: { x: number; y: number } | null = null;
  let selectEnd: { x: number; y: number } | null = null;
  let rightDragStart: { x: number; y: number } | null = null;

  const getCanvasPos = (event: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  };

  listenCanvas("click", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    if (state.deployMode === "clear") {
      return;
    }
    noteInteraction();
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const tile = getTileFromPointer(event as MouseEvent);
    if (!tile) {
      return;
    }
    if (isDebugIgniteMode()) {
      igniteDebugFireAt(tile);
      return;
    }
    const clickedUnit = getUnitAt(state, tile.x, tile.y);
    if (clickedUnit) {
      gate("select", () => {
        let unitToSelect: Unit | null = clickedUnit;
        if (clickedUnit.kind === "firefighter") {
          if (clickedUnit.assignedTruckId) {
            unitToSelect = state.units.find((u) => u.id === clickedUnit.assignedTruckId) ?? null;
            if (unitToSelect) {
              setStatus(state, "Firefighter selected. Controlling assigned truck.");
            }
          } else {
            unitToSelect = null;
            setStatus(state, "This firefighter is not assigned to a truck.");
          }
        }
        if (unitToSelect) {
          if ((event as MouseEvent).shiftKey) {
            toggleUnitSelection(state, unitToSelect);
          } else {
            selectUnit(state, unitToSelect);
          }
        } else if (!(event as MouseEvent).shiftKey) {
          clearUnitSelection(state);
        }
        setDeployMode(state, null);
      });
      return;
    }
    if (state.deployMode) {
      gate("deploy", () => handleUnitDeployment(state, rng, tile.x, tile.y));
      return;
    }
    gate("select", () => {
      if (!(event as MouseEvent).shiftKey) {
        clearUnitSelection(state);
      }
      setStatus(state, "Select a unit or choose a deployment.");
    });
  });

  listenCanvas("mousedown", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    noteInteraction();
    const mouseEvent = event as MouseEvent;
    const canvasPos = getCanvasPos(mouseEvent);
    if (mouseEvent.button === 1 || (mouseEvent.button === 0 && isPanModifierDown())) {
      gate("pan", () => {
        isPanning = true;
        panAnchor = canvasPos;
        panCamera = { x: renderState.cameraCenter.x, y: renderState.cameraCenter.y };
      });
      return;
    }
    if (mouseEvent.button === 2) {
      if (state.selectedUnitIds.length > 0) {
        gate("formation", () => {
          const tile = getTileFromPointer(mouseEvent);
          if (tile) {
            isFormationDrag = true;
            rightDragStart = canvasPos;
            inputState.formationStart = tile;
            inputState.formationEnd = tile;
          }
        });
      }
      return;
    }
    if (state.deployMode === "clear" && state.phase === "maintenance") {
      gate("clearFuelBreak", () => {
        const tile = getTileFromPointer(mouseEvent);
        if (!tile) {
          return;
        }
        inputState.clearLineStart = tile;
      });
      return;
    }
    if (mouseEvent.button !== 0) {
      return;
    }
    gate("select", () => {
      isSelecting = true;
      selectStart = canvasPos;
      selectEnd = canvasPos;
      inputState.selectionBox = { x1: canvasPos.x, y1: canvasPos.y, x2: canvasPos.x, y2: canvasPos.y };
    });
  });

  listenCanvas("mouseup", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    noteInteraction();
    const mouseEvent = event as MouseEvent;
    const canvasPos = getCanvasPos(mouseEvent);
    if (mouseEvent.button === 2) {
      if (isFormationDrag) {
        const tile = getTileFromPointer(mouseEvent);
        const dragDistance =
          rightDragStart && mouseEvent
            ? Math.hypot(canvasPos.x - rightDragStart.x, canvasPos.y - rightDragStart.y)
            : 0;
        if (tile && dragDistance < 6) {
          gate("retask", () => handleUnitRetask(state, tile.x, tile.y));
        } else {
          const start = inputState.formationStart;
          const end = inputState.formationEnd;
          if (start && end) {
            gate("formation", () => {
              const selectedUnits = getSelectedUnits(state);
              assignFormationTargets(state, selectedUnits, start, end);
            });
          }
        }
        isFormationDrag = false;
        rightDragStart = null;
        inputState.formationStart = null;
        inputState.formationEnd = null;
      } else if (state.selectedUnitIds.length > 0) {
        const tile = getTileFromPointer(mouseEvent);
        if (tile) {
          gate("retask", () => handleUnitRetask(state, tile.x, tile.y));
        }
      }
      return;
    }
    if (isPanning) {
      isPanning = false;
      panAnchor = null;
      panCamera = null;
      suppressClick = true;
      return;
    }
    if (isSelecting) {
      if (selectStart && selectEnd) {
        const dx = selectEnd.x - selectStart.x;
        const dy = selectEnd.y - selectStart.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 6) {
          const startWorld = screenToWorld(state, renderState, canvas, selectStart.x, selectStart.y);
          const endWorld = screenToWorld(state, renderState, canvas, selectEnd.x, selectEnd.y);
          const minX = Math.min(startWorld.x, endWorld.x);
          const maxX = Math.max(startWorld.x, endWorld.x);
          const minY = Math.min(startWorld.y, endWorld.y);
          const maxY = Math.max(startWorld.y, endWorld.y);
          if (!mouseEvent.shiftKey) {
            clearUnitSelection(state);
          }
          const newlySelectedTrucks = new Set<number>();
          state.units.forEach((unit) => {
            if (unit.x >= minX && unit.x <= maxX && unit.y >= minY && unit.y <= maxY) {
              if (unit.kind === "truck") {
                newlySelectedTrucks.add(unit.id);
              } else if (unit.kind === "firefighter" && unit.assignedTruckId) {
                newlySelectedTrucks.add(unit.assignedTruckId);
              }
            }
          });
          newlySelectedTrucks.forEach((truckId) => {
            const truck = state.units.find((u) => u.id === truckId);
            if (truck) {
              truck.selected = true;
              if (!state.selectedUnitIds.includes(truck.id)) {
                state.selectedUnitIds.push(truck.id);
              }
            }
          });
          if (state.selectedUnitIds.length > 0) {
            setStatus(state, `${state.selectedUnitIds.length} truck(s) selected. Right-click to move.`);
          } else {
            resetStatus(state);
          }
          suppressClick = true;
        } else if (!mouseEvent.shiftKey) {
          clearUnitSelection(state);
        }
      }
      isSelecting = false;
      selectStart = null;
      selectEnd = null;
      inputState.selectionBox = null;
      return;
    }
    if (!inputState.clearLineStart) {
      return;
    }
    const tile = getTileFromPointer(mouseEvent);
    if (!tile) {
      inputState.clearLineStart = null;
      return;
    }
    gate("clearFuelBreak", () => {
      clearFuelLine(state, rng, inputState.clearLineStart as { x: number; y: number }, tile);
      inputState.clearLineStart = null;
    });
  });

  listenCanvas("mouseleave", () => {
    inputState.clearLineStart = null;
    isPanning = false;
    panAnchor = null;
    panCamera = null;
    isFormationDrag = false;
    rightDragStart = null;
    inputState.formationStart = null;
    inputState.formationEnd = null;
    isSelecting = false;
    selectStart = null;
    selectEnd = null;
    inputState.selectionBox = null;
    inputState.debugHoverTile = null;
    inputState.debugHoverWorld = null;
  });

  listenCanvas("mousemove", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    const mouseEvent = event as MouseEvent;
    if (inputState.debugCellEnabled) {
      const world = getWorldFromPointer(mouseEvent);
      inputState.debugHoverWorld = world;
      const tileX = Math.floor(world.x);
      const tileY = Math.floor(world.y);
      inputState.debugHoverTile = inBounds(state.grid, tileX, tileY) ? { x: tileX, y: tileY } : null;
    } else if (inputState.debugHoverTile || inputState.debugHoverWorld) {
      inputState.debugHoverTile = null;
      inputState.debugHoverWorld = null;
    }
    if (isPanning || isSelecting || isFormationDrag) {
      noteInteraction();
    }
    if (isFormationDrag) {
      const tile = getTileFromPointer(mouseEvent);
      if (tile) {
        inputState.formationEnd = tile;
      }
      return;
    }
    if (isPanning && panAnchor && panCamera) {
      const canvasPos = getCanvasPos(mouseEvent);
      const dx = canvasPos.x - panAnchor.x;
      const dy = canvasPos.y - panAnchor.y;
      renderState.cameraCenter = panCameraByPixels(renderState, panCamera, dx, dy);
      return;
    }
    if (isSelecting && selectStart) {
      const canvasPos = getCanvasPos(mouseEvent);
      selectEnd = canvasPos;
      inputState.selectionBox = {
        x1: selectStart.x,
        y1: selectStart.y,
        x2: canvasPos.x,
        y2: canvasPos.y
      };
      return;
    }
  });

  listenCanvas("contextmenu", (event) => {
    (event as MouseEvent).preventDefault();
  });

  listenCanvas(
    "wheel",
    (event) => {
      if (isOverlayLocked()) {
        return;
      }
      if (!canZoom()) {
        return;
      }
      noteInteraction();
      const wheelEvent = event as WheelEvent;
      wheelEvent.preventDefault();
      const zoomFactor = wheelDeltaToZoomFactor(wheelEvent.deltaY, wheelEvent.deltaMode);
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = (wheelEvent.clientX - rect.left) * scaleX;
      const canvasY = (wheelEvent.clientY - rect.top) * scaleY;
      zoomAtPointer(state, renderState, canvas, renderState.zoom * zoomFactor, canvasX, canvasY);
    },
    { passive: false }
  );
};
