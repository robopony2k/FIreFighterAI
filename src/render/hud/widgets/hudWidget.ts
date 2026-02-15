import type { WorldState } from "../../../core/state.js";
import type { HudState } from "../hudState.js";
import type { Rect, WidgetType } from "../hudLayout.js";

export type HudInput = {
  type: "click";
  x: number;
  y: number;
};

export interface HudWidget {
  type: WidgetType;
  render: (ctx: CanvasRenderingContext2D, rect: Rect, world: WorldState, ui: HudState) => void;
  handleInput?: (input: HudInput, rect: Rect, world: WorldState, ui: HudState) => void;
}
