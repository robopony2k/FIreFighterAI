import type { WorldState } from "../../../core/state.js";
import type { HudState } from "../hudState.js";
import type { Rect, WidgetSlot, WidgetType } from "../hudLayout.js";
import type { HudWidget } from "./hudWidget.js";

export class DebugWidget implements HudWidget {
  public readonly type: WidgetType = "debug";
  private slot: WidgetSlot;

  constructor(slot: WidgetSlot) {
    this.slot = slot;
  }

  render(ctx: CanvasRenderingContext2D, rect: Rect, world: WorldState, ui: HudState): void {
    const padding = 8;
    const theme = ui.theme;
    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();
    ctx.fillStyle = theme.debugPanelBackground;
    ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    ctx.strokeStyle = theme.debugPanelBorder;
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
    ctx.fillStyle = theme.debugPanelText;
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
