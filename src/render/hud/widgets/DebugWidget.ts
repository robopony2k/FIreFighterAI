import type { WorldState } from "../../../core/state.js";
import type { HudState } from "../hudState.js";
import type { Rect, WidgetSlot, WidgetType } from "../hudLayout.js";
import { WidgetType as WidgetKind } from "../hudLayout.js";
import type { HudWidget } from "./hudWidget.js";

export class DebugWidget implements HudWidget {
  public readonly type: WidgetType = WidgetKind.Debug;
  private slot: WidgetSlot;

  constructor(slot: WidgetSlot) {
    this.slot = slot;
  }

  render(ctx: CanvasRenderingContext2D, rect: Rect, world: WorldState, ui: HudState): void {
    const padding = 8;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.fillStyle = "rgba(12, 14, 18, 0.6)";
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.fillStyle = "#f2f2f2";
    ctx.font = "600 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const lines = [
      `FPS: ${Math.round(ui.fps)}`,
      `Phase: ${world.phase}`,
      `Units: ${world.units.length}`,
      `Fires: ${world.lastActiveFires}`,
      `Burned: ${world.burnedTiles}`,
      `Wind: ${world.wind?.name ?? "?"} ${Math.round((world.wind?.strength ?? 0) * 10)}`
    ];
    let y = rect.y + padding;
    lines.forEach((line) => {
      ctx.fillText(line, rect.x + padding, y);
      y += 16;
    });
    ctx.restore();
  }
}
