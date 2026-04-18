import type { WorldState } from "../../../core/state.js";
import type { HudState } from "../hudState.js";
import type { Rect, WidgetType, WidgetSlot } from "../hudLayout.js";
import type { HudWidget } from "./hudWidget.js";
import { getRuntimeWidgetTitle } from "../../../ui/runtime/widgets/registry.js";
import {
  RISK_BANDS,
  RISK_THRESHOLDS,
  buildRiskPaths,
  computeForecastMarkerX,
  computeSeasonLayout,
  computeYearLayout
} from "../../../ui/phase/forecastLayout.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const withAlpha = (color: string, alpha: number): string => {
  if (color.startsWith("rgba(")) {
    const parts = color.slice(5, -1).split(",");
    if (parts.length >= 3) {
      return `rgba(${parts[0]?.trim() ?? "0"}, ${parts[1]?.trim() ?? "0"}, ${parts[2]?.trim() ?? "0"}, ${alpha})`;
    }
  }
  if (color.startsWith("rgb(")) {
    const parts = color.slice(4, -1).split(",");
    if (parts.length >= 3) {
      return `rgba(${parts[0]?.trim() ?? "0"}, ${parts[1]?.trim() ?? "0"}, ${parts[2]?.trim() ?? "0"}, ${alpha})`;
    }
  }
  return color;
};

const drawRoundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number) => {
  const r = Math.min(radius, w * 0.5, h * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

export class ClimateChartWidget implements HudWidget {
  public readonly type: WidgetType = "climate";
  private slot: WidgetSlot;

  constructor(slot: WidgetSlot) {
    this.slot = slot;
  }

  render(ctx: CanvasRenderingContext2D, rect: Rect, world: WorldState, ui: HudState): void {
    const theme = ui.theme;
    const compact = ui.slots[this.slot].compact;
    const forecast = ui.forecastOverride?.forecast ?? world.climateForecast ?? null;
    const forecastDay = ui.forecastOverride?.forecastDay ?? (world.climateForecastDay ?? 0);
    const forecastStartDay = ui.forecastOverride?.forecastStartDay ?? Math.max(0, world.climateForecastStart ?? 0);
    const forecastYearDays = ui.forecastOverride?.forecastYearDays ?? (world.climateTimeline?.daysPerYear ?? 360);

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.clip();

    const padding = clamp(Math.round(Math.min(rect.width, rect.height) * 0.06), 6, 14);
    const titleHeight = compact ? 16 : 20;
    const titleFont = clamp(Math.round(rect.height * 0.08), 10, 14);
    const labelFont = clamp(Math.round(rect.height * 0.055), 8, 11);
    const tinyFont = clamp(Math.round(rect.height * 0.045), 7, 10);
    const chartX = rect.x + padding;
    const chartY = rect.y + padding + titleHeight;
    const chartWidth = Math.max(40, rect.width - padding * 2);
    const chartHeight = Math.max(40, rect.height - padding * 2 - titleHeight);
    const chartPadding = clamp(Math.round(Math.min(chartWidth, chartHeight) * 0.08), 8, compact ? 10 : 14);
    const innerHeight = Math.max(1, chartHeight - chartPadding * 2);
    const innerWidth = Math.max(1, chartWidth - chartPadding * 2);
    const axisY = chartY + chartHeight - chartPadding;
    const innerTop = chartY + chartPadding;

    const bandColors = theme.chartBandColors;
    const seasonColors = theme.chartSeasonColors;
    const lineCool = theme.chartLineCool;
    const lineWarm = theme.chartLineWarm;
    const lineHot = theme.chartLineHot;

    ctx.fillStyle = theme.chartCardBackground;
    ctx.strokeStyle = theme.chartCardBorder;
    drawRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 10);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = theme.slotHeaderText;
    ctx.font = `600 ${titleFont}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(getRuntimeWidgetTitle("climate"), rect.x + padding, rect.y + padding - 1);

    if (!forecast || forecast.risk.length === 0) {
      ctx.fillStyle = theme.chartLabel;
      ctx.font = `500 ${labelFont}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("No forecast data", rect.x + rect.width / 2, rect.y + rect.height / 2);
      ctx.restore();
      return;
    }

    ctx.fillStyle = theme.chartBackground;
    ctx.strokeStyle = theme.chartBorder;
    drawRoundedRect(ctx, chartX, chartY, chartWidth, chartHeight, 8);
    ctx.fill();
    ctx.stroke();

    const riskBandHeight = innerHeight / RISK_BANDS.length;
    for (let i = 0; i < RISK_BANDS.length; i += 1) {
      const y = axisY - riskBandHeight * (i + 1);
      ctx.fillStyle = bandColors[i] ?? bandColors[0];
      ctx.fillRect(chartX + chartPadding, y, innerWidth, riskBandHeight);
    }

    const seasonLayout = computeSeasonLayout(forecastStartDay, forecastYearDays, forecast.days, {
      width: chartWidth,
      height: chartHeight,
      padding: chartPadding
    });
    seasonLayout.bands.forEach((band) => {
      const color = seasonColors[band.seasonIndex] ?? seasonColors[0];
      ctx.fillStyle = color;
      ctx.fillRect(chartX + band.x, innerTop, band.width, innerHeight);
    });

    ctx.strokeStyle = theme.chartGrid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 4]);
    RISK_THRESHOLDS.forEach((value) => {
      const y = axisY - value * innerHeight;
      ctx.beginPath();
      ctx.moveTo(chartX + chartPadding, y);
      ctx.lineTo(chartX + chartPadding + innerWidth, y);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    const yearLayout = computeYearLayout(forecastStartDay, forecastYearDays, forecast.days, {
      width: chartWidth,
      height: chartHeight,
      padding: chartPadding
    });
    ctx.strokeStyle = theme.chartGrid;
    ctx.lineWidth = 1;
    ctx.setLineDash([2, 3]);
    yearLayout.markers.forEach((x) => {
      const px = chartX + x;
      ctx.beginPath();
      ctx.moveTo(px, innerTop);
      ctx.lineTo(px, axisY);
      ctx.stroke();
    });

    ctx.strokeStyle = theme.chartGrid;
    ctx.setLineDash([1, 4]);
    seasonLayout.markers.forEach((x) => {
      const px = chartX + x;
      ctx.beginPath();
      ctx.moveTo(px, innerTop);
      ctx.lineTo(px, axisY);
      ctx.stroke();
    });
    ctx.setLineDash([]);

    const riskLayout = buildRiskPaths(forecast.risk, { width: chartWidth, height: chartHeight, padding: chartPadding });
    if (riskLayout.points.length > 0) {
      const areaGradient = ctx.createLinearGradient(0, axisY, 0, innerTop);
      areaGradient.addColorStop(0, withAlpha(lineCool, 0.45));
      areaGradient.addColorStop(0.6, withAlpha(lineWarm, 0.45));
      areaGradient.addColorStop(1, withAlpha(lineHot, 0.45));
      ctx.fillStyle = areaGradient;
      ctx.beginPath();
      riskLayout.points.forEach((point, index) => {
        const x = chartX + point.x;
        const y = chartY + point.y;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      const last = riskLayout.points[riskLayout.points.length - 1];
      const first = riskLayout.points[0];
      ctx.lineTo(chartX + last.x, axisY);
      ctx.lineTo(chartX + first.x, axisY);
      ctx.closePath();
      ctx.fill();

      const lineGradient = ctx.createLinearGradient(chartX, 0, chartX + chartWidth, 0);
      lineGradient.addColorStop(0, lineCool);
      lineGradient.addColorStop(0.55, lineWarm);
      lineGradient.addColorStop(1, lineHot);
      ctx.strokeStyle = lineGradient;
      ctx.lineWidth = 2;
      ctx.beginPath();
      riskLayout.points.forEach((point, index) => {
        const x = chartX + point.x;
        const y = chartY + point.y;
        if (index === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }
      });
      ctx.stroke();
    }

    ctx.strokeStyle = lineHot;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([3, 3]);
    const markerX = chartX + computeForecastMarkerX(forecastDay, forecast.days, {
      width: chartWidth,
      height: chartHeight,
      padding: chartPadding
    });
    ctx.beginPath();
    ctx.moveTo(markerX, innerTop);
    ctx.lineTo(markerX, axisY + 4);
    ctx.stroke();
    ctx.setLineDash([]);

    if (chartHeight >= (compact ? 60 : 80)) {
      const labels = ["Low", "Moderate", "High", "Extreme"];
      const maxLabels = compact ? 2 : labels.length;
      const step = Math.ceil(labels.length / maxLabels);
      ctx.fillStyle = theme.chartLabel;
      ctx.font = `${tinyFont}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      labels.forEach((label, index) => {
        if (index % step !== 0) {
          return;
        }
        const bandCenter = (index + 0.5) / labels.length;
        const y = axisY - bandCenter * innerHeight + 3;
        ctx.fillText(label, chartX + chartPadding + 2, y);
      });
    }

    const showSeasonLabels = !compact && chartWidth >= 160 && chartHeight >= 90;
    if (showSeasonLabels) {
      const maxLabels = Math.max(1, Math.floor(chartWidth / 70));
      const step = Math.ceil(seasonLayout.labels.length / maxLabels);
      ctx.font = `${labelFont}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = theme.chartLabel;
      ctx.textBaseline = "top";
      ctx.textAlign = "center";
      const seasonLabelY = chartY + chartHeight + 6;
      seasonLayout.labels.forEach((label, index) => {
        if (index % step !== 0) {
          return;
        }
        const x = chartX + (label.leftPercent / 100) * chartWidth;
        ctx.fillText(label.label.toUpperCase(), x, seasonLabelY);
      });
    }

    const showYearLabels = !compact && chartWidth >= 200;
    if (showYearLabels) {
      const maxLabels = Math.max(1, Math.floor(chartWidth / 90));
      const step = Math.ceil(yearLayout.labels.length / maxLabels);
      ctx.font = `${tinyFont}px ui-sans-serif, system-ui, sans-serif`;
      ctx.fillStyle = theme.chartLabel;
      ctx.textBaseline = "top";
      ctx.textAlign = "center";
      const yearLabelY = chartY + chartHeight + 20;
      yearLayout.labels.forEach((label, index) => {
        if (index % step !== 0) {
          return;
        }
        const x = chartX + (label.leftPercent / 100) * chartWidth;
        ctx.fillText(label.text, x, yearLabelY);
      });
    }

    ctx.restore();
  }
}
