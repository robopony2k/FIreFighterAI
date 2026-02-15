import type { Point } from "./types.js";

export type SelectionBox = { x1: number; y1: number; x2: number; y2: number };

export interface InputState {
  clearLineStart: Point | null;
  formationStart: Point | null;
  formationEnd: Point | null;
  selectionBox: SelectionBox | null;
  debugIgniteMode: boolean;
  debugCellEnabled: boolean;
  debugTypeColors: boolean;
  debugHoverTile: Point | null;
  debugHoverWorld: Point | null;
  lastInteractionTime: number;
}

export const createInputState = (): InputState => ({
  clearLineStart: null,
  formationStart: null,
  formationEnd: null,
  selectionBox: null,
  debugIgniteMode: false,
  debugCellEnabled: false,
  debugTypeColors: false,
  debugHoverTile: null,
  debugHoverWorld: null,
  lastInteractionTime: 0
});

export const resetInputState = (state: InputState): void => {
  state.clearLineStart = null;
  state.formationStart = null;
  state.formationEnd = null;
  state.selectionBox = null;
  state.debugIgniteMode = false;
  state.debugCellEnabled = false;
  state.debugTypeColors = false;
  state.debugHoverTile = null;
  state.debugHoverWorld = null;
  state.lastInteractionTime = 0;
};
