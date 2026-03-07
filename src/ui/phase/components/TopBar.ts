import type { Phase, PrimaryCta } from "../types.js";
import type { ClimateForecast } from "../../../core/types.js";
import {
  FORECAST_CHART,
  RISK_BANDS,
  RISK_THRESHOLDS,
  SEASON_CLASSES,
  buildRiskPaths,
  computeForecastMarkerX,
  computeSeasonLayout,
  computeYearLayout
} from "../forecastLayout.js";

export type TopBarData = {
  phase: Phase;
  alert?: string | null;
  primaryCta?: PrimaryCta;
  forecast: ClimateForecast | null;
  forecastDay: number;
  forecastStartDay: number;
  forecastYearDays: number;
  forecastMeta: string | null;
  scoring: {
    score: number;
    difficultyMult: number;
    approvalMult: number;
    streakMult: number;
    riskMult: number;
    totalMult: number;
    noHouseLossDays: number;
    noLifeLossDays: number;
    approvalTier: "S" | "A" | "B" | "C" | "D";
    riskTier: "low" | "moderate" | "high" | "extreme";
    nextApprovalTier: "S" | "A" | "B" | "C" | "D" | null;
    nextApprovalThreshold01: number | null;
    nextTierProgress01: number;
    events: Array<{
      id: number;
      message: string;
      severity: "positive" | "negative" | "info";
      remainingSeconds: number;
    }>;
  } | null;
};

export type TopBarView = {
  element: HTMLElement;
  update: (data: TopBarData) => void;
  onCta: (handler: (actionId: string) => void) => void;
  attachControls: (controls: HTMLElement) => void;
};

const phaseLabels: Record<Phase, string> = {
  growth: "Growth",
  maintenance: "Maintenance",
  fire: "Fire Season",
  budget: "Budget"
};

const SVG_NS = "http://www.w3.org/2000/svg";
const { width: CHART_WIDTH, height: CHART_HEIGHT, padding: CHART_PADDING } = FORECAST_CHART;
const SCORE_EVENT_LIFETIME_SECONDS: Record<NonNullable<TopBarData["scoring"]>["events"][number]["severity"], number> = {
  positive: 8,
  negative: 16,
  info: 8
};

const parseScoreEventMessage = (message: string): { label: string; value: string | null } => {
  const trimmed = message.trim();
  const match = trimmed.match(/^([+-]\d[\d,]*)(?:\s+)(.+)$/);
  if (!match) {
    return { label: trimmed, value: null };
  }
  return {
    label: match[2].trim(),
    value: match[1]
  };
};

const syncThreeTestTopClearance = (element: HTMLElement, scoreStrip: HTMLElement, scoreEvents: HTMLElement): void => {
  const overlayRoot = element.closest(".three-test-overlay") as HTMLElement | null;
  if (!overlayRoot) {
    return;
  }
  if (scoreStrip.classList.contains("is-hidden")) {
    overlayRoot.style.setProperty("--three-test-top-clearance", "12px");
    return;
  }
  const stripHeight = scoreStrip.offsetHeight;
  const trayHeight = scoreEvents.classList.contains("is-hidden") ? 0 : scoreEvents.offsetHeight;
  const clearance = Math.max(12, Math.ceil(stripHeight + trayHeight + 22));
  overlayRoot.style.setProperty("--three-test-top-clearance", `${clearance}px`);
};

export const createTopBar = (): TopBarView => {
  const element = document.createElement("header");
  element.className = "phase-panel phase-topbar";
  element.dataset.panel = "topbar";

  const badge = document.createElement("div");
  badge.className = "phase-badge";

  const forecast = document.createElement("div");
  forecast.className = "phase-forecast";
  const forecastChart = document.createElement("div");
  forecastChart.className = "phase-forecast-chart";
  const forecastScale = document.createElement("div");
  forecastScale.className = "phase-forecast-scale";
  const forecastSeasonScale = document.createElement("div");
  forecastSeasonScale.className = "phase-forecast-season-scale";
  const forecastMeta = document.createElement("div");
  forecastMeta.className = "phase-forecast-meta";
  const forecastControls = document.createElement("div");
  forecastControls.className = "phase-forecast-controls";
  const forecastSvg = document.createElementNS(SVG_NS, "svg");
  forecastSvg.classList.add("phase-forecast-svg");
  forecastSvg.setAttribute("viewBox", `0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`);
  forecastSvg.setAttribute("preserveAspectRatio", "none");

  const defs = document.createElementNS(SVG_NS, "defs");
  const gradient = document.createElementNS(SVG_NS, "linearGradient");
  gradient.id = "phase-forecast-gradient";
  gradient.setAttribute("x1", "0");
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("x2", "1");
  gradient.setAttribute("y2", "0");
  const stopCool = document.createElementNS(SVG_NS, "stop");
  stopCool.setAttribute("offset", "0%");
  stopCool.classList.add("phase-forecast-stop", "is-cool");
  const stopWarm = document.createElementNS(SVG_NS, "stop");
  stopWarm.setAttribute("offset", "55%");
  stopWarm.classList.add("phase-forecast-stop", "is-warm");
  const stopHot = document.createElementNS(SVG_NS, "stop");
  stopHot.setAttribute("offset", "100%");
  stopHot.classList.add("phase-forecast-stop", "is-hot");
  gradient.append(stopCool, stopWarm, stopHot);
  defs.appendChild(gradient);

  const riskGradient = document.createElementNS(SVG_NS, "linearGradient");
  riskGradient.id = "phase-forecast-risk-gradient";
  riskGradient.setAttribute("x1", "0");
  riskGradient.setAttribute("y1", "1");
  riskGradient.setAttribute("x2", "0");
  riskGradient.setAttribute("y2", "0");
  const riskStopLow = document.createElementNS(SVG_NS, "stop");
  riskStopLow.setAttribute("offset", "0%");
  riskStopLow.classList.add("phase-forecast-stop", "is-cool");
  const riskStopWarm = document.createElementNS(SVG_NS, "stop");
  riskStopWarm.setAttribute("offset", "60%");
  riskStopWarm.classList.add("phase-forecast-stop", "is-warm");
  const riskStopHot = document.createElementNS(SVG_NS, "stop");
  riskStopHot.setAttribute("offset", "100%");
  riskStopHot.classList.add("phase-forecast-stop", "is-hot");
  riskGradient.append(riskStopLow, riskStopWarm, riskStopHot);
  defs.appendChild(riskGradient);

  const riskBands = document.createElementNS(SVG_NS, "g");
  riskBands.classList.add("phase-forecast-bands");
  const seasonBands = document.createElementNS(SVG_NS, "g");
  seasonBands.classList.add("phase-forecast-seasons");
  const bandHeight = (CHART_HEIGHT - CHART_PADDING * 2) / RISK_BANDS.length;
  for (let i = 0; i < RISK_BANDS.length; i += 1) {
    const rect = document.createElementNS(SVG_NS, "rect");
    rect.classList.add("phase-forecast-band", `is-${RISK_BANDS[i]}`);
    rect.setAttribute("x", CHART_PADDING.toString());
    rect.setAttribute("width", (CHART_WIDTH - CHART_PADDING * 2).toString());
    rect.setAttribute("height", bandHeight.toFixed(2));
    rect.setAttribute("y", (CHART_HEIGHT - CHART_PADDING - bandHeight * (i + 1)).toFixed(2));
    riskBands.appendChild(rect);
  }

  const axisLine = document.createElementNS(SVG_NS, "line");
  axisLine.classList.add("phase-forecast-axis");
  axisLine.setAttribute("x1", CHART_PADDING.toString());
  axisLine.setAttribute("x2", (CHART_WIDTH - CHART_PADDING).toString());
  axisLine.setAttribute("y1", (CHART_HEIGHT - CHART_PADDING).toString());
  axisLine.setAttribute("y2", (CHART_HEIGHT - CHART_PADDING).toString());

  const areaPath = document.createElementNS(SVG_NS, "path");
  areaPath.classList.add("phase-forecast-area");
  areaPath.setAttribute("fill", "url(#phase-forecast-risk-gradient)");

  const linePath = document.createElementNS(SVG_NS, "path");
  linePath.classList.add("phase-forecast-line");
  linePath.setAttribute("stroke", "url(#phase-forecast-gradient)");

  const seasonMarkers = document.createElementNS(SVG_NS, "g");
  seasonMarkers.classList.add("phase-forecast-season-lines");

  const riskAxis = document.createElementNS(SVG_NS, "g");
  riskAxis.classList.add("phase-forecast-axis-group");

  const yearMarkers = document.createElementNS(SVG_NS, "g");
  yearMarkers.classList.add("phase-forecast-years");

  const markerLine = document.createElementNS(SVG_NS, "line");
  markerLine.classList.add("phase-forecast-marker");
  markerLine.setAttribute("y1", CHART_PADDING.toString());
  markerLine.setAttribute("y2", (CHART_HEIGHT - CHART_PADDING + 4).toString());

  forecastSvg.append(defs, seasonBands, riskBands, axisLine, areaPath, seasonMarkers, yearMarkers, linePath, riskAxis, markerLine);
  forecastChart.appendChild(forecastSvg);
  forecast.append(forecastChart, forecastSeasonScale, forecastScale, forecastMeta, forecastControls);

  const alert = document.createElement("div");
  alert.className = "phase-alert";

  const cta = document.createElement("button");
  cta.className = "phase-cta";

  const scoreCounter = document.createElement("div");
  scoreCounter.className = "phase-score-counter is-hidden";

  const scoreStrip = document.createElement("div");
  scoreStrip.className = "phase-score-strip is-hidden";
  const scoreValue = document.createElement("div");
  scoreValue.className = "phase-score-value";
  const scoreLabel = document.createElement("span");
  scoreLabel.className = "phase-score-label";
  scoreLabel.textContent = "Score";
  const scoreNumber = document.createElement("span");
  scoreNumber.className = "phase-score-number";
  scoreValue.append(scoreLabel, scoreNumber);
  const multiplierRow = document.createElement("div");
  multiplierRow.className = "phase-score-multipliers";
  const difficultyPill = document.createElement("span");
  difficultyPill.className = "phase-score-pill";
  const approvalPill = document.createElement("span");
  approvalPill.className = "phase-score-pill";
  const streakPill = document.createElement("span");
  streakPill.className = "phase-score-pill";
  const riskPill = document.createElement("span");
  riskPill.className = "phase-score-pill";
  const totalPill = document.createElement("span");
  totalPill.className = "phase-score-pill is-total";
  multiplierRow.append(difficultyPill, approvalPill, streakPill, riskPill, totalPill);

  const streakLabel = document.createElement("div");
  streakLabel.className = "phase-score-streak";
  const approvalMeta = document.createElement("div");
  approvalMeta.className = "phase-score-approval-meta";
  const approvalProgress = document.createElement("div");
  approvalProgress.className = "phase-score-progress";
  const approvalProgressFill = document.createElement("div");
  approvalProgressFill.className = "phase-score-progress-fill";
  approvalProgress.appendChild(approvalProgressFill);
  scoreStrip.append(scoreValue, multiplierRow, streakLabel, approvalMeta, approvalProgress);

  const scoreEvents = document.createElement("div");
  scoreEvents.className = "phase-score-events is-hidden";

  const content = document.createElement("div");
  content.className = "phase-topbar-content";
  content.append(badge, scoreCounter, alert, cta);

  element.append(content, scoreStrip, scoreEvents, forecast);

  let ctaHandler: ((actionId: string) => void) | null = null;
  let currentAction: string | null = null;
  cta.addEventListener("click", () => {
    if (currentAction && ctaHandler) {
      ctaHandler(currentAction);
    }
  });

  const updateYearMarkers = (startDay: number, yearDays: number, windowDays: number): void => {
    while (yearMarkers.firstChild) {
      yearMarkers.removeChild(yearMarkers.firstChild);
    }
    while (forecastScale.firstChild) {
      forecastScale.removeChild(forecastScale.firstChild);
    }
    const layout = computeYearLayout(startDay, yearDays, windowDays, FORECAST_CHART);
    layout.markers.forEach((x) => {
      const line = document.createElementNS(SVG_NS, "line");
      line.classList.add("phase-forecast-year-line");
      line.setAttribute("x1", x.toFixed(2));
      line.setAttribute("x2", x.toFixed(2));
      line.setAttribute("y1", CHART_PADDING.toString());
      line.setAttribute("y2", (CHART_HEIGHT - CHART_PADDING).toString());
      yearMarkers.append(line);
    });
    layout.labels.forEach((labelData) => {
      const label = document.createElement("div");
      label.classList.add("phase-forecast-year-label");
      label.style.left = `${labelData.leftPercent.toFixed(2)}%`;
      label.textContent = labelData.text;
      forecastScale.appendChild(label);
    });
  };

  const updateSeasonMarkers = (startDay: number, yearDays: number, windowDays: number): void => {
    while (seasonBands.firstChild) {
      seasonBands.removeChild(seasonBands.firstChild);
    }
    while (seasonMarkers.firstChild) {
      seasonMarkers.removeChild(seasonMarkers.firstChild);
    }
    while (forecastSeasonScale.firstChild) {
      forecastSeasonScale.removeChild(forecastSeasonScale.firstChild);
    }
    const layout = computeSeasonLayout(startDay, yearDays, windowDays, FORECAST_CHART);
    const height = CHART_HEIGHT - CHART_PADDING * 2;
    layout.bands.forEach((band) => {
      const rect = document.createElementNS(SVG_NS, "rect");
      rect.classList.add("phase-forecast-season", `is-${SEASON_CLASSES[band.seasonIndex]}`);
      rect.setAttribute("x", band.x.toFixed(2));
      rect.setAttribute("y", CHART_PADDING.toString());
      rect.setAttribute("width", band.width.toFixed(2));
      rect.setAttribute("height", height.toFixed(2));
      seasonBands.appendChild(rect);
    });
    layout.labels.forEach((labelData) => {
      const label = document.createElement("div");
      label.classList.add("phase-forecast-season-label");
      label.style.left = `${labelData.leftPercent.toFixed(2)}%`;
      label.textContent = labelData.label;
      forecastSeasonScale.appendChild(label);
    });
    layout.markers.forEach((x) => {
      const line = document.createElementNS(SVG_NS, "line");
      line.classList.add("phase-forecast-season-line");
      line.setAttribute("x1", x.toFixed(2));
      line.setAttribute("x2", x.toFixed(2));
      line.setAttribute("y1", CHART_PADDING.toString());
      line.setAttribute("y2", (CHART_HEIGHT - CHART_PADDING).toString());
      seasonMarkers.appendChild(line);
    });
  };

  const updateRiskAxis = (): void => {
    while (riskAxis.firstChild) {
      riskAxis.removeChild(riskAxis.firstChild);
    }
    const width = CHART_WIDTH - CHART_PADDING * 2;
    const height = CHART_HEIGHT - CHART_PADDING * 2;
    const axisY = CHART_HEIGHT - CHART_PADDING;
    RISK_THRESHOLDS.forEach((value) => {
      const y = axisY - value * height;
      const line = document.createElementNS(SVG_NS, "line");
      line.classList.add("phase-forecast-yline");
      line.setAttribute("x1", CHART_PADDING.toString());
      line.setAttribute("x2", (CHART_PADDING + width).toString());
      line.setAttribute("y1", y.toFixed(2));
      line.setAttribute("y2", y.toFixed(2));
      riskAxis.appendChild(line);
    });
    const labels = ["Low", "Moderate", "High", "Extreme"];
    labels.forEach((labelText, index) => {
      const bandCenter = (index + 0.5) / labels.length;
      const y = axisY - bandCenter * height + 3;
      const text = document.createElementNS(SVG_NS, "text");
      text.classList.add("phase-forecast-ylabel");
      text.setAttribute("x", (CHART_PADDING + 2).toString());
      text.setAttribute("y", y.toFixed(2));
      text.textContent = labelText;
      riskAxis.appendChild(text);
    });
  };
  updateRiskAxis();

  return {
    element,
    attachControls: (controls) => {
      while (forecastControls.firstChild) {
        forecastControls.removeChild(forecastControls.firstChild);
      }
      forecastControls.appendChild(controls);
    },
    update: (data) => {
      const isThreeTest = element.closest(".phase-ui-root--three-test") !== null;
      badge.textContent = phaseLabels[data.phase];
      if (data.forecast && data.forecast.risk.length > 0) {
        forecast.classList.remove("is-hidden");
        const { line, area } = buildRiskPaths(data.forecast.risk, FORECAST_CHART);
        linePath.setAttribute("d", line);
        areaPath.setAttribute("d", area);
        const markerX = computeForecastMarkerX(data.forecastDay, data.forecast.days, FORECAST_CHART);
        const markerXValue = markerX.toFixed(2);
        markerLine.setAttribute("x1", markerXValue);
        markerLine.setAttribute("x2", markerXValue);
        updateSeasonMarkers(data.forecastStartDay, data.forecastYearDays, data.forecast.days);
        updateYearMarkers(data.forecastStartDay, data.forecastYearDays, data.forecast.days);
        forecastMeta.textContent = data.forecastMeta ?? "";
      } else {
        forecast.classList.add("is-hidden");
        linePath.setAttribute("d", "");
        areaPath.setAttribute("d", "");
        forecastMeta.textContent = "";
        updateSeasonMarkers(0, 0, 0);
        updateYearMarkers(0, 0, 0);
      }
      if (data.alert) {
        alert.textContent = data.alert;
        alert.classList.remove("is-hidden");
      } else {
        alert.textContent = "";
        alert.classList.add("is-hidden");
      }
      if (data.primaryCta) {
        cta.textContent = data.primaryCta.label;
        cta.classList.remove("is-hidden");
        currentAction = data.primaryCta.actionId;
      } else {
        cta.textContent = "";
        cta.classList.add("is-hidden");
        currentAction = null;
      }
      if (data.scoring) {
        scoreCounter.classList.remove("is-hidden");
        scoreCounter.textContent = `Score ${Math.round(data.scoring.score).toLocaleString()}`;
        scoreStrip.classList.remove("is-hidden");
        scoreNumber.textContent = Math.round(data.scoring.score).toLocaleString();
        difficultyPill.textContent = isThreeTest
          ? `Diff x${data.scoring.difficultyMult.toFixed(2)}`
          : `Difficulty ${data.scoring.difficultyMult.toFixed(2)}x`;
        approvalPill.textContent = isThreeTest
          ? `Approval ${data.scoring.approvalTier} x${data.scoring.approvalMult.toFixed(2)}`
          : `Approval ${data.scoring.approvalMult.toFixed(2)}x`;
        streakPill.textContent = isThreeTest
          ? `Streak x${data.scoring.streakMult.toFixed(2)}`
          : `Streak ${data.scoring.streakMult.toFixed(2)}x`;
        riskPill.textContent = isThreeTest
          ? `Risk x${data.scoring.riskMult.toFixed(2)}`
          : `Risk ${data.scoring.riskMult.toFixed(2)}x`;
        totalPill.textContent = `Total ${data.scoring.totalMult.toFixed(2)}x`;
        streakLabel.textContent = `No-loss streaks: Houses ${data.scoring.noHouseLossDays}d | Lives ${data.scoring.noLifeLossDays}d`;
        if (data.scoring.nextApprovalTier && data.scoring.nextApprovalThreshold01 !== null) {
          approvalMeta.textContent = `Approval Tier ${data.scoring.approvalTier} -> ${data.scoring.nextApprovalTier} at ${Math.round(
            data.scoring.nextApprovalThreshold01 * 100
          )}% (Risk ${data.scoring.riskTier})`;
        } else {
          approvalMeta.textContent = `Approval Tier ${data.scoring.approvalTier} (max) | Risk ${data.scoring.riskTier}`;
        }
        approvalProgressFill.style.width = `${Math.round(
          Math.max(0, Math.min(1, data.scoring.nextTierProgress01)) * 100
        )}%`;

        scoreEvents.innerHTML = "";
        if (data.scoring.events.length > 0) {
          scoreEvents.classList.remove("is-hidden");
          for (let i = data.scoring.events.length - 1; i >= 0; i -= 1) {
            const event = data.scoring.events[i];
            const row = document.createElement("div");
            row.className = `phase-score-event is-${event.severity}`;
            const parsed = parseScoreEventMessage(event.message);
            const labelText = document.createElement("span");
            labelText.className = "phase-score-event-label";
            labelText.textContent = parsed.label;
            row.appendChild(labelText);
            if (parsed.value) {
              const valueText = document.createElement("span");
              valueText.className = "phase-score-event-value";
              valueText.textContent = parsed.value;
              row.appendChild(valueText);
            }
            const eventLifetime = SCORE_EVENT_LIFETIME_SECONDS[event.severity] ?? 8;
            const fade = Math.max(event.severity === "negative" ? 0.4 : 0.25, Math.min(1, event.remainingSeconds / eventLifetime));
            row.style.opacity = fade.toFixed(2);
            scoreEvents.appendChild(row);
          }
        } else {
          scoreEvents.classList.add("is-hidden");
        }
      } else {
        scoreCounter.classList.add("is-hidden");
        scoreStrip.classList.add("is-hidden");
        scoreEvents.classList.add("is-hidden");
        scoreEvents.innerHTML = "";
        scoreNumber.textContent = "";
      }
      syncThreeTestTopClearance(element, scoreStrip, scoreEvents);
    },
    onCta: (handler) => {
      ctaHandler = handler;
    }
  };
};
