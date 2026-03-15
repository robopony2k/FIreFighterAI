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
    extinguishedCount: number;
    propertyDamageCount: number;
    livesLostCount: number;
    events: Array<{
      id: number;
      lane: "extinguished" | "property" | "lives" | "info";
      deltaCount: number;
      deltaPoints: number;
      severity: "positive" | "negative" | "info";
      remainingSeconds: number;
      detail?: string;
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
  positive: 1.1,
  negative: 1.6,
  info: 1.1
};
const LEDGER_RAILS = [
  { lane: "extinguished", label: "Extinguished" },
  { lane: "property", label: "Property Damage" },
  { lane: "lives", label: "Lives Lost" }
] as const;

const formatSignedPoints = (value: number): string => `${value >= 0 ? "+" : "-"}${Math.round(Math.abs(value)).toLocaleString()}`;

const formatScoreEvent = (
  event: NonNullable<TopBarData["scoring"]>["events"][number]
): { label: string; value: string | null } => {
  if (event.lane === "info") {
    return { label: event.detail ?? "Multiplier update", value: null };
  }
  const laneLabel =
    event.lane === "extinguished" ? "Extinguished" : event.lane === "property" ? "Property Damage" : "Lives Lost";
  const countLabel = `${event.deltaCount.toLocaleString()} ${event.deltaCount === 1 ? "count" : "counts"}`;
  return {
    label: event.detail ? `${laneLabel} | ${event.detail}` : `${laneLabel} | ${countLabel}`,
    value: formatSignedPoints(event.deltaPoints)
  };
};

const triggerPulse = (element: HTMLElement): void => {
  element.classList.remove("is-pulsing");
  void element.offsetWidth;
  element.classList.add("is-pulsing");
};

const createRailIcon = (lane: (typeof LEDGER_RAILS)[number]["lane"]): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("phase-score-rail-icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  if (lane === "extinguished") {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", "8");
    circle.setAttribute("cy", "8");
    circle.setAttribute("r", "5");
    circle.setAttribute("fill", "currentColor");
    const slash = document.createElementNS(SVG_NS, "path");
    slash.setAttribute("d", "M4 9.75L7 12.5L12 4.25");
    slash.setAttribute("fill", "none");
    slash.setAttribute("stroke", "rgba(15, 15, 15, 0.82)");
    slash.setAttribute("stroke-width", "1.6");
    slash.setAttribute("stroke-linecap", "round");
    slash.setAttribute("stroke-linejoin", "round");
    svg.append(circle, slash);
    return svg;
  }
  if (lane === "property") {
    const body = document.createElementNS(SVG_NS, "path");
    body.setAttribute("d", "M3 13V7.75L8 4.25L13 7.75V13H10V9H6V13Z");
    body.setAttribute("fill", "currentColor");
    svg.appendChild(body);
    return svg;
  }
  const head = document.createElementNS(SVG_NS, "circle");
  head.setAttribute("cx", "8");
  head.setAttribute("cy", "5");
  head.setAttribute("r", "2.5");
  head.setAttribute("fill", "currentColor");
  const torso = document.createElementNS(SVG_NS, "path");
  torso.setAttribute("d", "M4 13C4 10.8 5.8 9 8 9C10.2 9 12 10.8 12 13");
  torso.setAttribute("fill", "none");
  torso.setAttribute("stroke", "currentColor");
  torso.setAttribute("stroke-width", "1.8");
  torso.setAttribute("stroke-linecap", "round");
  svg.append(head, torso);
  return svg;
};

const buildLedgerBundles = (count: number): Array<{ magnitude: number; digit: number; label: string }> => {
  const bundles: Array<{ magnitude: number; digit: number; label: string }> = [];
  let remaining = Math.max(0, Math.floor(count));
  let magnitude = 1;
  while (remaining > 0) {
    const digit = remaining % 10;
    if (digit > 0) {
      bundles.push({
        magnitude,
        digit,
        label: magnitude === 1 ? "" : `x${magnitude.toLocaleString()}`
      });
    }
    remaining = Math.floor(remaining / 10);
    magnitude *= 10;
  }
  return bundles.reverse();
};

const getBundleUnitsBucket = (magnitude: number): string => {
  if (magnitude >= 1000) {
    return "1000";
  }
  if (magnitude >= 100) {
    return "100";
  }
  if (magnitude >= 10) {
    return "10";
  }
  return "1";
};

const renderLedgerBundles = (
  container: HTMLElement,
  count: number,
  className: string,
  clipDigits = 9
): void => {
  container.innerHTML = "";
  const bundles = buildLedgerBundles(count);
  for (const bundle of bundles) {
    const group = document.createElement("div");
    group.className = "phase-score-bundle";
    const unitsBucket = getBundleUnitsBucket(bundle.magnitude);
    group.dataset.units = unitsBucket;
    if (bundle.label) {
      const badge = document.createElement("span");
      badge.className = "phase-score-bundle-label";
      badge.textContent = bundle.label;
      badge.dataset.units = unitsBucket;
      group.appendChild(badge);
    }
    const digit = Math.min(bundle.digit, clipDigits);
    for (let i = 0; i < digit; i += 1) {
      const chip = document.createElement("span");
      chip.className = `phase-score-chip ${className}`;
      chip.dataset.units = unitsBucket;
      group.appendChild(chip);
    }
    container.appendChild(group);
  }
};

const layoutIncomingLedgerGroups = (settled: HTMLElement, incoming: HTMLElement): void => {
  const trackWidth = incoming.clientWidth;
  if (trackWidth <= 0) {
    return;
  }
  const settledWidth = settled.scrollWidth;
  const wrappers = Array.from(incoming.children) as HTMLElement[];
  let occupiedWidth = settledWidth;
  wrappers.forEach((wrapper, index) => {
    const wrapperWidth = wrapper.offsetWidth;
    const remainingWidth = Math.max(0, trackWidth - occupiedWidth - wrapperWidth);
    wrapper.style.setProperty("--incoming-travel", `${remainingWidth}px`);
    wrapper.style.setProperty("--incoming-stagger", `${Math.min(index * 10, 36)}px`);
    occupiedWidth += wrapperWidth + 6;
  });
};

const syncThreeTestTopClearance = (element: HTMLElement, scoreStrip: HTMLElement): void => {
  const overlayRoot = element.closest(".three-test-overlay") as HTMLElement | null;
  if (!overlayRoot) {
    return;
  }
  if (scoreStrip.classList.contains("is-hidden")) {
    overlayRoot.style.setProperty("--three-test-top-clearance", "12px");
    return;
  }
  const stripHeight = scoreStrip.offsetHeight;
  const clearance = Math.max(12, Math.ceil(stripHeight + 24));
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
  const legacyScoreContent = document.createElement("div");
  legacyScoreContent.className = "phase-score-legacy";
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
  legacyScoreContent.append(scoreValue, multiplierRow, streakLabel, approvalMeta, approvalProgress);

  const ledgerBoard = document.createElement("div");
  ledgerBoard.className = "phase-score-ledger is-hidden";
  const ledgerHeader = document.createElement("div");
  ledgerHeader.className = "phase-score-ledger-header";
  const ledgerPills = document.createElement("div");
  ledgerPills.className = "phase-score-ledger-pills";
  const ledgerDifficultyPill = document.createElement("span");
  ledgerDifficultyPill.className = "phase-score-pill";
  const ledgerApprovalPill = document.createElement("span");
  ledgerApprovalPill.className = "phase-score-pill";
  const ledgerStreakPill = document.createElement("span");
  ledgerStreakPill.className = "phase-score-pill";
  const ledgerRiskPill = document.createElement("span");
  ledgerRiskPill.className = "phase-score-pill";
  ledgerPills.append(ledgerDifficultyPill, ledgerApprovalPill, ledgerStreakPill, ledgerRiskPill);
  ledgerHeader.appendChild(ledgerPills);

  const ledgerRails = document.createElement("div");
  ledgerRails.className = "phase-score-ledger-rails";
  const ledgerRailMap = new Map<
    (typeof LEDGER_RAILS)[number]["lane"],
    {
      rail: HTMLElement;
      settled: HTMLElement;
      incoming: HTMLElement;
      count: HTMLElement;
    }
  >();
  for (const config of LEDGER_RAILS) {
    const rail = document.createElement("div");
    rail.className = `phase-score-rail is-${config.lane}`;
    const meta = document.createElement("div");
    meta.className = "phase-score-rail-meta";
    meta.append(createRailIcon(config.lane));
    const label = document.createElement("span");
    label.className = "phase-score-rail-label";
    label.textContent = config.label;
    meta.appendChild(label);

    const track = document.createElement("div");
    track.className = "phase-score-track";
    const settled = document.createElement("div");
    settled.className = "phase-score-track-settled";
    const incoming = document.createElement("div");
    incoming.className = "phase-score-track-incoming";
    track.append(settled, incoming);

    const count = document.createElement("span");
    count.className = "phase-score-rail-count";
    rail.append(meta, track, count);
    ledgerRails.appendChild(rail);
    ledgerRailMap.set(config.lane, { rail, settled, incoming, count });
  }
  ledgerBoard.append(ledgerHeader, ledgerRails);
  scoreStrip.append(legacyScoreContent, ledgerBoard);

  const scoreEvents = document.createElement("div");
  scoreEvents.className = "phase-score-events is-hidden";

  const content = document.createElement("div");
  content.className = "phase-topbar-content";
  content.append(badge, scoreCounter, alert, cta);

  element.append(content, scoreStrip, scoreEvents, forecast);

  let ctaHandler: ((actionId: string) => void) | null = null;
  let currentAction: string | null = null;
  let previousApprovalSignature = "";
  let previousRiskSignature = "";
  cta.addEventListener("click", () => {
    if (currentAction && ctaHandler) {
      ctaHandler(currentAction);
    }
  });

  const applyMultiplierLabels = (data: NonNullable<TopBarData["scoring"]>, isThreeTest: boolean): void => {
    difficultyPill.textContent = isThreeTest
      ? `DIFF x${data.difficultyMult.toFixed(2)}`
      : `Difficulty ${data.difficultyMult.toFixed(2)}x`;
    approvalPill.textContent = isThreeTest
      ? `APP ${data.approvalTier} x${data.approvalMult.toFixed(2)}`
      : `Approval ${data.approvalMult.toFixed(2)}x`;
    streakPill.textContent = isThreeTest
      ? `STREAK x${data.streakMult.toFixed(2)}`
      : `Streak ${data.streakMult.toFixed(2)}x`;
    riskPill.textContent = isThreeTest
      ? `RISK x${data.riskMult.toFixed(2)}`
      : `Risk ${data.riskMult.toFixed(2)}x`;
    totalPill.textContent = `Total ${data.totalMult.toFixed(2)}x`;

    ledgerDifficultyPill.textContent = `DIFF x${data.difficultyMult.toFixed(2)}`;
    ledgerApprovalPill.textContent = `APP ${data.approvalTier} x${data.approvalMult.toFixed(2)}`;
    ledgerStreakPill.textContent = `STREAK x${data.streakMult.toFixed(2)}`;
    ledgerRiskPill.textContent = `RISK x${data.riskMult.toFixed(2)}`;

    const approvalSignature = `${data.approvalTier}:${data.approvalMult.toFixed(2)}`;
    const riskSignature = `${data.riskTier}:${data.riskMult.toFixed(2)}`;
    if (previousApprovalSignature && previousApprovalSignature !== approvalSignature) {
      triggerPulse(ledgerApprovalPill);
    }
    if (previousRiskSignature && previousRiskSignature !== riskSignature) {
      triggerPulse(ledgerRiskPill);
    }
    previousApprovalSignature = approvalSignature;
    previousRiskSignature = riskSignature;
  };

  const renderLedgerBoard = (data: NonNullable<TopBarData["scoring"]>): void => {
    const countsByLane = {
      extinguished: Math.max(0, Math.floor(data.extinguishedCount)),
      property: Math.max(0, Math.floor(data.propertyDamageCount)),
      lives: Math.max(0, Math.floor(data.livesLostCount))
    };
    const activeEvents = new Map<
      (typeof LEDGER_RAILS)[number]["lane"],
      Array<NonNullable<TopBarData["scoring"]>["events"][number]>
    >();
    LEDGER_RAILS.forEach(({ lane }) => activeEvents.set(lane, []));
    for (const event of data.events) {
      if (event.lane === "info") {
        continue;
      }
      const laneEvents = activeEvents.get(event.lane);
      if (laneEvents) {
        laneEvents.push(event);
      }
    }

    for (const { lane } of LEDGER_RAILS) {
      const refs = ledgerRailMap.get(lane);
      if (!refs) {
        continue;
      }
      const laneEvents = activeEvents.get(lane) ?? [];
      const pendingCount = laneEvents.reduce((sum, event) => sum + Math.max(0, Math.floor(event.deltaCount)), 0);
      const settledCount = Math.max(0, countsByLane[lane] - pendingCount);
      refs.count.textContent = countsByLane[lane].toLocaleString();
      renderLedgerBundles(refs.settled, settledCount, "is-settled");
      refs.incoming.innerHTML = "";
      refs.rail.classList.toggle(
        "is-hot",
        laneEvents.some((event) => event.severity === "negative" && event.remainingSeconds > 0)
      );

      laneEvents.forEach((event) => {
        const wrapper = document.createElement("div");
        wrapper.className = `phase-score-incoming-group is-${event.severity}`;
        const lifetime = SCORE_EVENT_LIFETIME_SECONDS[event.severity] ?? 1.1;
        const progress = Math.max(0, Math.min(1, 1 - event.remainingSeconds / lifetime));
        wrapper.style.setProperty("--incoming-progress", progress.toFixed(3));
        renderLedgerBundles(wrapper, Math.max(0, Math.floor(event.deltaCount)), "is-incoming", 9);
        refs.incoming.appendChild(wrapper);
      });
      layoutIncomingLedgerGroups(refs.settled, refs.incoming);
    }
  };

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
        scoreStrip.classList.remove("is-hidden");
        applyMultiplierLabels(data.scoring, isThreeTest);
        if (isThreeTest) {
          scoreCounter.classList.add("is-hidden");
          scoreCounter.textContent = "";
          legacyScoreContent.classList.add("is-hidden");
          ledgerBoard.classList.remove("is-hidden");
          scoreEvents.classList.add("is-hidden");
          scoreEvents.innerHTML = "";
          renderLedgerBoard(data.scoring);
        } else {
          scoreCounter.classList.remove("is-hidden");
          scoreCounter.textContent = `Score ${Math.round(data.scoring.score).toLocaleString()}`;
          legacyScoreContent.classList.remove("is-hidden");
          ledgerBoard.classList.add("is-hidden");
          scoreNumber.textContent = Math.round(data.scoring.score).toLocaleString();
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
              const parsed = formatScoreEvent(event);
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
              const eventLifetime = SCORE_EVENT_LIFETIME_SECONDS[event.severity] ?? 1.1;
              const fade = Math.max(
                event.severity === "negative" ? 0.4 : 0.25,
                Math.min(1, event.remainingSeconds / eventLifetime)
              );
              row.style.opacity = fade.toFixed(2);
              scoreEvents.appendChild(row);
            }
          } else {
            scoreEvents.classList.add("is-hidden");
          }
        }
      } else {
        scoreCounter.classList.add("is-hidden");
        scoreStrip.classList.add("is-hidden");
        scoreEvents.classList.add("is-hidden");
        scoreEvents.innerHTML = "";
        scoreNumber.textContent = "";
        legacyScoreContent.classList.add("is-hidden");
        ledgerBoard.classList.add("is-hidden");
      }
      syncThreeTestTopClearance(element, scoreStrip);
    },
    onCta: (handler) => {
      ctaHandler = handler;
    }
  };
};
