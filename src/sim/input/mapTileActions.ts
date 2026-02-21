import { setStatus } from "../../core/state.js";
import type { WorldState } from "../../core/state.js";
import type { InputState } from "../../core/inputState.js";
import type { Point, RNG, Unit } from "../../core/types.js";
import { handleUnitDeployment, handleUnitRetask } from "../index.js";
import { igniteDebugFireAt } from "../fire/debugIgnite.js";
import {
  assignFormationTargets,
  clearFuelLine,
  clearUnitSelection,
  getSelectedUnits,
  getUnitAt,
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
  debugIgniteMode?: boolean;
  gate?: MapActionGate;
};

export const handleMapPrimaryTileClick = ({
  state,
  inputState,
  rng,
  tile,
  shiftKey = false,
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
        if (shiftKey) {
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
  tile: MapTile;
  gate?: MapActionGate;
};

export const handleMapRetaskTileCommand = ({ state, tile, gate }: HandleMapRetaskTileCommandParams): boolean => {
  if (state.selectedUnitIds.length === 0) {
    return false;
  }
  runAction({ gate }, "retask", () => handleUnitRetask(state, tile.x, tile.y));
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
  start,
  end,
  gate
}: HandleMapFormationDragCommandParams): boolean => {
  if (state.selectedUnitIds.length === 0) {
    return false;
  }
  const selectedUnits = getSelectedUnits(state);
  if (selectedUnits.length === 0) {
    return false;
  }
  runAction({ gate }, "formation", () => {
    assignFormationTargets(state, selectedUnits, start, end);
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
