import type { WorldState } from "../../core/state.js";
import type { InputState } from "../../core/inputState.js";
import type { UiState } from "../../core/uiState.js";
import type { EffectsState } from "../../core/effectsState.js";
import type { RenderState } from "../renderState.js";
import { draw } from "../draw.js";
import { updateOverlay } from "../../ui/overlay.js";
import type { PhaseUiApi } from "../../ui/phase/index.js";
import type { OverlayRefs } from "../../ui/overlay.js";

export type Legacy2dFrameDeps = {
  state: WorldState;
  inputState: InputState;
  uiState: UiState;
  effectsState: EffectsState;
  renderState: RenderState;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  overlayRefs: OverlayRefs;
  phaseUi: PhaseUiApi | null;
  alpha: number;
};

export type Legacy2dFrameStats = {
  uiMs: number;
  overlayMs: number;
  drawMs: number;
};

/**
 * @deprecated Legacy 2D render path. Prefer the 3D backend.
 */
export const renderLegacy2dFrame = ({
  state,
  inputState,
  uiState,
  effectsState,
  renderState,
  canvas,
  ctx,
  overlayRefs,
  phaseUi,
  alpha
}: Legacy2dFrameDeps): Legacy2dFrameStats => {
  const uiStart = performance.now();
  phaseUi?.sync(state, inputState);
  const uiMs = performance.now() - uiStart;
  const overlayStart = performance.now();
  updateOverlay(overlayRefs, uiState);
  const overlayMs = performance.now() - overlayStart;
  const drawStart = performance.now();
  draw(state, renderState, inputState, effectsState, canvas, ctx, alpha);
  const drawMs = performance.now() - drawStart;
  return { uiMs, overlayMs, drawMs };
};
