import { setStatus } from "../../core/state.js";
import type { WorldState } from "../../core/state.js";
import type { InputState } from "../../core/inputState.js";
import type { AreaTarget, CommandIntent, CommandType, LineTarget, Point, RNG, Unit } from "../../core/types.js";
import { handleUnitDeployment } from "../index.js";
import { igniteDebugFireAt } from "../fire/debugIgnite.js";
import { selectTownEvacuationDestination } from "../../systems/evacuation/controllers/evacuationController.js";
import {
  applyCommandIntentToSelection,
  assignFormationTargets,
  clearFuelLine,
  clearUnitSelection,
  getSelectedUnits,
  getUnitAt,
  selectTruck,
  selectUnit,
  setDeployMode,
  toggleUnitSelection
} from "../units.js";

export type MapTile = { x: number; y: number };
export type MapInputAction = "select" | "deploy" | "retask" | "formation" | "clearFuelBreak";
export type MapActionGate = (action: MapInputAction, handler: () => void) => void;

type ExecuteGate = {
  gate?: MapActionGate;
};

const runAction = ({ gate }: ExecuteGate, action: MapInputAction, handler: () => void): void => {
  if (gate) {
    gate(action, handler);
    return;
  }
  handler();
};

type ResolveControllableUnitResult = {
  unit: Unit | null;
  handled: boolean;
};

const resolveControllableUnit = (state: WorldState, clickedUnit: Unit): ResolveControllableUnitResult => {
  if (clickedUnit.kind !== "firefighter") {
    return { unit: clickedUnit, handled: false };
  }
  if (clickedUnit.assignedTruckId) {
    const assignedTruck = state.units.find((unit) => unit.id === clickedUnit.assignedTruckId) ?? null;
    if (assignedTruck) {
      setStatus(state, "Firefighter selected. Controlling assigned truck.");
      return { unit: assignedTruck, handled: false };
    }
  }
  setStatus(state, "This firefighter is not assigned to a truck.");
  return { unit: null, handled: true };
};

export type HandleMapPrimaryTileClickParams = {
  state: WorldState;
  inputState: InputState;
  rng: RNG;
  tile: MapTile;
  shiftKey?: boolean;
  altKey?: boolean;
  debugIgniteMode?: boolean;
  gate?: MapActionGate;
};

const isNearFire = (state: WorldState, tile: MapTile, radius: number): boolean => {
  for (let y = Math.max(0, tile.y - radius); y <= Math.min(state.grid.rows - 1, tile.y + radius); y += 1) {
    for (let x = Math.max(0, tile.x - radius); x <= Math.min(state.grid.cols - 1, tile.x + radius); x += 1) {
      const idx = y * state.grid.cols + x;
      if ((state.tileFire[idx] ?? 0) > 0.05) {
        return true;
      }
    }
  }
  return false;
};

const resolveContextCommandType = (state: WorldState, tile: MapTile): CommandType => {
  const idx = tile.y * state.grid.cols + tile.x;
  const fire = state.tileFire[idx] ?? 0;
  const heat = state.tileHeat[idx] ?? 0;
  const fuel = state.tileFuel[idx] ?? 0;
  if (fire > 0.45 || heat > 0.5) {
    return "suppress";
  }
  if (fire > 0.05 || heat > 0.12) {
    return "suppress";
  }
  if (fuel > 0.2 && isNearFire(state, tile, 3)) {
    return "contain";
  }
  return "move";
};

const makePointIntent = (
  state: WorldState,
  inputState: InputState,
  tile: MapTile,
  commandType?: CommandType
): CommandIntent => {
  const resolvedType = commandType ?? inputState.commandMode ?? resolveContextCommandType(state, tile);
  return {
    type: resolvedType,
    target: {
      kind: "point",
      point: { x: tile.x, y: tile.y }
    },
    formation: "loose",
    behaviourMode:
      inputState.commandMode === null && resolvedType === "suppress" && (state.tileFire[tile.y * state.grid.cols + tile.x] ?? 0) > 0.45
        ? "aggressive"
        : inputState.behaviourMode
  };
};

const makeLineIntent = (
  state: WorldState,
  inputState: InputState,
  start: MapTile,
  end: MapTile
): CommandIntent => {
  const target: LineTarget = {
    kind: "line",
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y }
  };
  return {
    type: inputState.commandMode ?? "contain",
    target,
    formation: "line",
    behaviourMode: inputState.behaviourMode
  };
};

const makeAreaIntent = (
  state: WorldState,
  inputState: InputState,
  start: MapTile,
  end: MapTile
): CommandIntent => {
  const target: AreaTarget = {
    kind: "area",
    start: { x: start.x, y: start.y },
    end: { x: end.x, y: end.y }
  };
  return {
    type: inputState.commandMode ?? "backburn",
    target,
    formation: "area",
    behaviourMode: inputState.behaviourMode
  };
};

export const handleMapPrimaryTileClick = ({
  state,
  inputState,
  rng,
  tile,
  shiftKey = false,
  altKey = false,
  debugIgniteMode = inputState.debugIgniteMode,
  gate
}: HandleMapPrimaryTileClickParams): boolean => {
  if (state.deployMode === "clear") {
    return false;
  }
  if (debugIgniteMode) {
    igniteDebugFireAt(state, tile.x, tile.y, { random: () => rng.next() });
    return true;
  }
  if (inputState.evacuationDestinationTownId !== null) {
    runAction({ gate }, "select", () => {
      if (selectTownEvacuationDestination(state, inputState.evacuationDestinationTownId!, tile)) {
        inputState.evacuationDestinationTownId = null;
      }
    });
    return true;
  }
  const clickedUnit = getUnitAt(state, tile.x, tile.y);
  if (clickedUnit) {
    runAction({ gate }, "select", () => {
      const resolved = resolveControllableUnit(state, clickedUnit);
      if (resolved.handled) {
        if (!shiftKey) {
          clearUnitSelection(state);
        }
        setDeployMode(state, null);
        return;
      }
      if (resolved.unit) {
        if (altKey && resolved.unit.kind === "truck") {
          if (shiftKey) {
            selectTruck(state, resolved.unit, { toggle: true });
          } else {
            selectTruck(state, resolved.unit);
          }
        } else if (shiftKey) {
          toggleUnitSelection(state, resolved.unit);
        } else {
          selectUnit(state, resolved.unit);
        }
      } else if (!shiftKey) {
        clearUnitSelection(state);
      }
      setDeployMode(state, null);
    });
    return true;
  }
  if (state.deployMode) {
    runAction({ gate }, "deploy", () => handleUnitDeployment(state, rng, tile.x, tile.y));
    return true;
  }
  runAction({ gate }, "select", () => {
    if (!shiftKey) {
      clearUnitSelection(state);
    }
    setStatus(state, "Select a unit or choose a deployment.");
  });
  return true;
};

export type HandleMapRetaskTileCommandParams = {
  state: WorldState;
  inputState: InputState;
  tile: MapTile;
  gate?: MapActionGate;
};

export const handleMapRetaskTileCommand = ({ state, inputState, tile, gate }: HandleMapRetaskTileCommandParams): boolean => {
  if (state.selectedUnitIds.length === 0) {
    return false;
  }
  runAction({ gate }, "retask", () => {
    applyCommandIntentToSelection(state, makePointIntent(state, inputState, tile));
  });
  return true;
};

export type HandleMapFormationDragCommandParams = {
  state: WorldState;
  start: MapTile;
  end: MapTile;
  gate?: MapActionGate;
};

export const handleMapFormationDragCommand = ({
  state,
  inputState,
  start,
  end,
  gate
}: HandleMapFormationDragCommandParams & { inputState: InputState }): boolean => {
  if (state.selectedUnitIds.length === 0) {
    return false;
  }
  const selectedUnits = getSelectedUnits(state);
  if (selectedUnits.length === 0) {
    return false;
  }
  runAction({ gate }, "formation", () => {
    const dx = Math.abs(end.x - start.x);
    const dy = Math.abs(end.y - start.y);
    if (dx >= 2 && dy >= 2) {
      applyCommandIntentToSelection(state, makeAreaIntent(state, inputState, start, end));
      return;
    }
    if (inputState.commandMode === "move" && state.selectionScope === "truck") {
      assignFormationTargets(state, selectedUnits, start, end);
      return;
    }
    applyCommandIntentToSelection(state, makeLineIntent(state, inputState, start, end));
  });
  return true;
};

export const beginClearFuelBreakLine = (state: WorldState, inputState: InputState, tile: MapTile): boolean => {
  if (state.deployMode !== "clear" || state.phase !== "maintenance") {
    inputState.clearLineStart = null;
    return false;
  }
  inputState.clearLineStart = { x: tile.x, y: tile.y };
  setStatus(state, `Fuel break start set at ${tile.x}, ${tile.y}. Select an end tile.`);
  return true;
};

export type CompleteClearFuelBreakLineParams = {
  state: WorldState;
  inputState: InputState;
  rng: RNG;
  tile: MapTile;
  gate?: MapActionGate;
};

export const completeClearFuelBreakLine = ({
  state,
  inputState,
  rng,
  tile,
  gate
}: CompleteClearFuelBreakLineParams): boolean => {
  const start = inputState.clearLineStart as Point | null;
  if (!start) {
    return false;
  }
  runAction({ gate }, "clearFuelBreak", () => {
    clearFuelLine(state, rng, start, tile);
    inputState.clearLineStart = null;
  });
  return true;
};

export type HandleClearFuelBreakTileClickParams = {
  state: WorldState;
  inputState: InputState;
  rng: RNG;
  tile: MapTile;
  gate?: MapActionGate;
};

export const handleClearFuelBreakTileClick = ({
  state,
  inputState,
  rng,
  tile,
  gate
}: HandleClearFuelBreakTileClickParams): boolean => {
  if (state.deployMode !== "clear" || state.phase !== "maintenance") {
    inputState.clearLineStart = null;
    return false;
  }
  if (!inputState.clearLineStart) {
    return beginClearFuelBreakLine(state, inputState, tile);
  }
  return completeClearFuelBreakLine({ state, inputState, rng, tile, gate });
};
