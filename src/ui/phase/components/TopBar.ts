import type { Phase, PrimaryCta } from "../types.js";
import type { ClimateForecast, ScoreFlowKind } from "../../../core/types.js";
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
    activeFireCount: number;
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
    flowEvents: Array<{
      id: number;
      kind: ScoreFlowKind;
      deltaCount: number;
      remainingSeconds: number;
      tileX?: number;
      tileY?: number;
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
  budget: "Autumn Ops"
};

const SVG_NS = "http://www.w3.org/2000/svg";
const { width: CHART_WIDTH, height: CHART_HEIGHT, padding: CHART_PADDING } = FORECAST_CHART;
const SCORE_EVENT_LIFETIME_SECONDS: Record<NonNullable<TopBarData["scoring"]>["events"][number]["severity"], number> = {
  positive: 0.8,
  negative: 1.05,
  info: 0.8
};
const FLOW_EVENT_LIFETIME_SECONDS: Record<ScoreFlowKind, number> = {
  gain: 0.78,
  extinguished: 0.82,
  property: 1.05,
  lives: 1.05,
  decay: 0.68
};
const ACTIVE_QUEUE_MOVE_SECONDS: Record<"incoming" | "outgoing", number> = {
  incoming: 0.22,
  outgoing: 0.16
};
const MIN_DIRECT_BEAD_THRESHOLD = 18;
const LEDGER_CHIP_WIDTH_PX = 8;
const LEDGER_BUNDLE_GAP_PX = 3;
const ACTIVE_QUEUE_SLOT_PX = LEDGER_CHIP_WIDTH_PX + LEDGER_BUNDLE_GAP_PX;
const LEDGER_TRACK_CONTENT_INSET_PX = 8;
const LEDGER_PIPE_GUTTER_PX = 16;
type LedgerRailId = "active" | "extinguished" | "property" | "lives";
const LEDGER_RAILS = [
  { lane: "extinguished", label: "Extinguished" },
  { lane: "active", label: "Active Fires" },
  { lane: "property", label: "Property Damage" },
  { lane: "lives", label: "Lives Lost" }
] as const;

const getFlowTargetLane = (kind: ScoreFlowKind): Exclude<LedgerRailId, "active"> | null => {
  if (kind === "extinguished") {
    return "extinguished";
  }
  if (kind === "property") {
    return "property";
  }
  if (kind === "lives") {
    return "lives";
  }
  return null;
};

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

const restartTransientClass = (element: HTMLElement, className: string): void => {
  element.classList.remove(className);
  void element.offsetWidth;
  element.classList.add(className);
};

const createRailIcon = (lane: LedgerRailId): SVGSVGElement => {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.classList.add("phase-score-rail-icon");
  svg.setAttribute("viewBox", "0 0 16 16");
  if (lane === "active") {
    const flame = document.createElementNS(SVG_NS, "path");
    flame.setAttribute(
      "d",
      "M8.2 1.5C9.3 3.1 9 4.3 8.1 5.4C9.7 5.1 11.3 6.4 11.3 8.3C11.3 10.8 9.8 13.3 8 14.5C5.9 13.3 4.5 11 4.5 8.6C4.5 6.6 5.9 5.3 7 4.2C7.9 3.3 8.4 2.6 8.2 1.5Z"
    );
    flame.setAttribute("fill", "currentColor");
    const core = document.createElementNS(SVG_NS, "path");
    core.setAttribute("d", "M8 6.2C8.8 7 9.2 7.8 9.2 8.9C9.2 10.3 8.4 11.6 8 12.1C7.1 11.4 6.7 10.3 6.7 9.3C6.7 8.1 7.3 7 8 6.2Z");
    core.setAttribute("fill", "rgba(22, 16, 12, 0.38)");
    svg.append(flame, core);
    return svg;
  }
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

const buildLedgerBundles = (count: number): Array<{ magnitude: number; digit: number }> => {
  const bundles: Array<{ magnitude: number; digit: number }> = [];
  let remaining = Math.max(0, Math.floor(count));
  let magnitude = 1;
  while (remaining > 0) {
    const digit = remaining % 10;
    if (digit > 0) {
      bundles.push({
        magnitude,
        digit
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

const syncLedgerBundleGroup = (
  group: HTMLElement,
  magnitude: number,
  chipCount: number,
  className: string
): void => {
  const unitsBucket = getBundleUnitsBucket(magnitude);
  const previousUnitsBucket = group.dataset.units ?? "";
  const previousChipCount = group.childElementCount;
  group.className = "phase-score-bundle";
  group.dataset.units = unitsBucket;
  group.dataset.magnitude = magnitude.toString();
  while (group.childElementCount > chipCount) {
    group.lastElementChild?.remove();
  }
  while (group.childElementCount < chipCount) {
    const chip = document.createElement("span");
    group.appendChild(chip);
  }
  Array.from(group.children).forEach((node) => {
    const chip = node as HTMLElement;
    chip.className = `phase-score-chip ${className}`;
    chip.dataset.units = unitsBucket;
  });
  if (magnitude > 1 && (previousUnitsBucket !== unitsBucket || previousChipCount !== chipCount)) {
    restartTransientClass(group, "is-combining");
  }
};

const syncLedgerBundles = (
  container: HTMLElement,
  count: number,
  className: string,
  clipDigits = 9,
  reverseOrder = false
): void => {
  const bundles = buildLedgerBundles(count);
  const orderedBundles = reverseOrder ? [...bundles].reverse() : bundles;
  const existing = new Map<number, HTMLElement>();
  Array.from(container.children).forEach((node) => {
    const element = node as HTMLElement;
    const magnitude = Number(element.dataset.magnitude ?? Number.NaN);
    if (Number.isFinite(magnitude)) {
      existing.set(magnitude, element);
    }
  });
  orderedBundles.forEach((bundle, index) => {
    const magnitude = bundle.magnitude;
    const digit = Math.min(bundle.digit, clipDigits);
    let group = existing.get(magnitude) ?? null;
    if (!group) {
      group = document.createElement("div");
    }
    syncLedgerBundleGroup(group, magnitude, digit, className);
    const anchor = container.children[index] ?? null;
    if (anchor !== group) {
      container.insertBefore(group, anchor);
    }
    existing.delete(magnitude);
  });
  existing.forEach((group) => group.remove());
};

const getTrackContentBounds = (
  track: HTMLElement,
  overlayRect: DOMRect
): { left: number; right: number; width: number; centerY: number } => {
  const rect = track.getBoundingClientRect();
  const left = rect.left - overlayRect.left + LEDGER_TRACK_CONTENT_INSET_PX;
  const right = rect.right - overlayRect.left - LEDGER_TRACK_CONTENT_INSET_PX;
  return {
    left,
    right,
    width: Math.max(0, right - left),
    centerY: rect.top - overlayRect.top + rect.height * 0.5
  };
};

const getTrackPortAnchor = (track: HTMLElement, overlayRect: DOMRect): { x: number; y: number } => {
  const bounds = getTrackContentBounds(track, overlayRect);
  return {
    x: bounds.right - LEDGER_CHIP_WIDTH_PX * 0.5,
    y: bounds.centerY
  };
};

const getTrackTailAnchor = (
  track: HTMLElement,
  settled: HTMLElement,
  overlayRect: DOMRect,
  slotOffset = 0
): { x: number; y: number } => {
  const bounds = getTrackContentBounds(track, overlayRect);
  const settledWidth = Math.max(0, Math.min(bounds.width, getRenderedContentWidth(settled)));
  const baseLeft = settledWidth > 0 ? settledWidth + LEDGER_BUNDLE_GAP_PX : 0;
  const left = Math.max(0, Math.min(bounds.width - LEDGER_CHIP_WIDTH_PX, baseLeft + slotOffset * ACTIVE_QUEUE_SLOT_PX));
  return {
    x: bounds.left + left + LEDGER_CHIP_WIDTH_PX * 0.5,
    y: bounds.centerY
  };
};

const getRenderedContentWidth = (container: HTMLElement): number => {
  if (container.childElementCount <= 0) {
    return 0;
  }
  const containerRect = container.getBoundingClientRect();
  let maxRight = 0;
  Array.from(container.children).forEach((node) => {
    const rect = (node as HTMLElement).getBoundingClientRect();
    maxRight = Math.max(maxRight, rect.right - containerRect.left);
  });
  return maxRight;
};

const getDirectBeadCapacity = (container: HTMLElement): number => {
  const width = container.clientWidth;
  if (width <= 0) {
    return MIN_DIRECT_BEAD_THRESHOLD;
  }
  return Math.max(
    MIN_DIRECT_BEAD_THRESHOLD,
    Math.floor((width + LEDGER_BUNDLE_GAP_PX) / (LEDGER_CHIP_WIDTH_PX + LEDGER_BUNDLE_GAP_PX))
  );
};

const syncSingleBundle = (
  container: HTMLElement,
  magnitude: number,
  chipCount: number,
  className: string
): void => {
  let group = (container.firstElementChild as HTMLElement | null) ?? null;
  if (!group) {
    group = document.createElement("div");
    container.appendChild(group);
  }
  syncLedgerBundleGroup(group, magnitude, chipCount, className);
  while (container.childElementCount > 1) {
    container.lastElementChild?.remove();
  }
};

const syncSettledRailBundles = (container: HTMLElement, count: number, reverseOrder = false): void => {
  if (count <= getDirectBeadCapacity(container)) {
    if (count <= 0) {
      container.replaceChildren();
      return;
    }
    syncSingleBundle(container, 1, count, "is-settled");
    return;
  }
  syncLedgerBundles(container, count, "is-settled", 9, reverseOrder);
};

const captureBundleRects = (container: HTMLElement): Map<number, DOMRect> => {
  const rects = new Map<number, DOMRect>();
  Array.from(container.children).forEach((node) => {
    const element = node as HTMLElement;
    const magnitude = Number(element.dataset.magnitude ?? Number.NaN);
    if (Number.isFinite(magnitude)) {
      rects.set(magnitude, element.getBoundingClientRect());
    }
  });
  return rects;
};

const animateBundleLayout = (container: HTMLElement, previousRects: Map<number, DOMRect>, nextCount: number): void => {
  const previousCount = Math.max(0, Math.floor(Number(container.dataset.renderedCount ?? "0")));
  const nextRects = captureBundleRects(container);
  const removedRects = Array.from(previousRects.entries())
    .filter(([magnitude]) => !nextRects.has(magnitude))
    .map(([, rect]) => rect)
    .sort((left, right) => left.left - right.left);
  const rightmostRemovedRect = removedRects.length > 0 ? removedRects[removedRects.length - 1] : null;

  Array.from(container.children).forEach((node) => {
    const element = node as HTMLElement;
    const magnitude = Number(element.dataset.magnitude ?? Number.NaN);
    if (!Number.isFinite(magnitude)) {
      return;
    }
    const nextRect = nextRects.get(magnitude);
    if (!nextRect) {
      return;
    }
    const previousRect =
      previousRects.get(magnitude) ?? (previousCount < nextCount && magnitude > 1 ? rightmostRemovedRect : null);
    if (!previousRect) {
      return;
    }
    const dx = previousRect.left - nextRect.left;
    const dy = previousRect.top - nextRect.top;
    const scaleX = previousRect.width / Math.max(1, nextRect.width);
    const scaleY = previousRect.height / Math.max(1, nextRect.height);
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5 && Math.abs(scaleX - 1) < 0.02 && Math.abs(scaleY - 1) < 0.02) {
      return;
    }
    element.getAnimations().forEach((animation) => animation.cancel());
    element.animate(
      [
        {
          transform: `translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${scaleX.toFixed(3)}, ${scaleY.toFixed(3)})`,
          opacity: previousRects.has(magnitude) ? 1 : 0.88
        },
        {
          transform: "translate(0px, 0px) scale(1, 1)",
          opacity: 1
        }
      ],
      {
        duration: 320,
        easing: "cubic-bezier(0.16, 0.82, 0.2, 1)",
        fill: "both"
      }
    );
  });
  container.dataset.renderedCount = String(nextCount);
};

const syncAccumulatedRailBundles = (container: HTMLElement, count: number): void => {
  const previousRects = captureBundleRects(container);
  if (count <= 0) {
    container.replaceChildren();
    container.dataset.renderedCount = "0";
    return;
  }
  syncLedgerBundles(container, count, "is-settled");
  animateBundleLayout(container, previousRects, count);
};

const clearManagedNodes = (nodeMap: Map<number, HTMLElement>): void => {
  nodeMap.forEach((node) => node.remove());
  nodeMap.clear();
};

type ActiveQueueDirection = "incoming" | "outgoing";

type ActiveQueueToken = {
  id: number;
  direction: ActiveQueueDirection;
  progress01: number;
};

type PipeTransferKind = "extinguished" | "property" | "lives";

type PipeRoutePoint = {
  x: number;
  y: number;
};

type PipeTransferToken = {
  id: number;
  kind: PipeTransferKind;
  progress01: number;
  route: PipeRoutePoint[];
};

type LedgerRailRefs = {
  rail: HTMLElement;
  track: HTMLElement;
  settled: HTMLElement;
  incoming: HTMLElement;
  fading: HTMLElement;
  count: HTMLElement;
};

const isPipeTransferKind = (kind: ScoreFlowKind): kind is PipeTransferKind =>
  kind === "extinguished" || kind === "property" || kind === "lives";

const getFlowProgress01 = (event: NonNullable<TopBarData["scoring"]>["flowEvents"][number]): number => {
  const lifetime = FLOW_EVENT_LIFETIME_SECONDS[event.kind] ?? 1.1;
  return Math.max(0, Math.min(1, 1 - event.remainingSeconds / lifetime));
};

const advanceActiveQueueTokens = (tokens: ActiveQueueToken[], deltaMs: number): ActiveQueueToken[] => {
  if (tokens.length === 0 || deltaMs <= 0) {
    return tokens;
  }
  const stepMs = Math.max(0, Math.min(deltaMs, 80));
  const next: ActiveQueueToken[] = [];
  for (const token of tokens) {
    const durationMs = ACTIVE_QUEUE_MOVE_SECONDS[token.direction] * 1000;
    const progress01 = token.progress01 + (durationMs > 0 ? stepMs / durationMs : 1);
    if (progress01 < 1) {
      next.push({
        ...token,
        progress01
      });
    }
  }
  return next;
};

const reverseActiveQueueTokens = (
  tokens: ActiveQueueToken[],
  fromDirection: ActiveQueueDirection,
  toDirection: ActiveQueueDirection,
  count: number
): number => {
  let remaining = count;
  for (let index = tokens.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const token = tokens[index];
    if (token.direction !== fromDirection) {
      continue;
    }
    tokens.splice(index, 1);
    tokens.push({
      ...token,
      direction: toDirection,
      progress01: Math.max(0, Math.min(0.999, 1 - token.progress01))
    });
    remaining -= 1;
  }
  return remaining;
};

const applyActiveQueueDelta = (
  tokens: ActiveQueueToken[],
  nextTokenId: { current: number },
  direction: ActiveQueueDirection,
  count: number,
  progress01: number
): void => {
  const desiredCount = Math.max(0, Math.floor(count));
  if (desiredCount <= 0) {
    return;
  }
  const oppositeDirection = direction === "incoming" ? "outgoing" : "incoming";
  let remaining = reverseActiveQueueTokens(tokens, oppositeDirection, direction, desiredCount);
  while (remaining > 0) {
    tokens.push({
      id: nextTokenId.current,
      direction,
      progress01: Math.max(0, Math.min(0.999, progress01))
    });
    nextTokenId.current += 1;
    remaining -= 1;
  }
};

const getPipeTrunkX = (activeRefs: LedgerRailRefs, overlayRect: DOMRect): number => {
  const port = getTrackPortAnchor(activeRefs.track, overlayRect);
  const countRect = activeRefs.count.getBoundingClientRect();
  const preferred = countRect.left - overlayRect.left - LEDGER_PIPE_GUTTER_PX;
  return Math.max(port.x + 10, preferred);
};

const buildPipeRoute = (
  sourceTrack: HTMLElement,
  targetTrack: HTMLElement,
  overlayRect: DOMRect,
  trunkX: number,
  yOffsetPx = 0
): PipeRoutePoint[] => {
  const start = getTrackPortAnchor(sourceTrack, overlayRect);
  const end = getTrackPortAnchor(targetTrack, overlayRect);
  const startY = start.y + yOffsetPx;
  const endY = end.y + yOffsetPx;
  return [
    { x: start.x, y: startY },
    { x: trunkX, y: startY },
    { x: trunkX, y: endY },
    { x: end.x, y: endY }
  ];
};

const buildPipeTransferRoute = (
  sourceRefs: LedgerRailRefs,
  targetRefs: LedgerRailRefs,
  overlayRect: DOMRect,
  trunkX: number,
  sourceTailOffset: number,
  targetTailOffset: number,
  yOffsetPx = 0
): PipeRoutePoint[] => {
  const sourceTail = getTrackTailAnchor(sourceRefs.track, sourceRefs.settled, overlayRect, sourceTailOffset);
  const sourcePort = getTrackPortAnchor(sourceRefs.track, overlayRect);
  const targetPort = getTrackPortAnchor(targetRefs.track, overlayRect);
  const targetTail = getTrackTailAnchor(targetRefs.track, targetRefs.settled, overlayRect, targetTailOffset);
  const sourceY = sourceTail.y + yOffsetPx;
  const targetY = targetTail.y + yOffsetPx;
  return [
    { x: sourceTail.x, y: sourceY },
    { x: sourcePort.x, y: sourceY },
    { x: trunkX, y: sourceY },
    { x: trunkX, y: targetY },
    { x: targetPort.x, y: targetY },
    { x: targetTail.x, y: targetY }
  ];
};

const buildPipePathD = (route: PipeRoutePoint[]): string => {
  if (route.length === 0) {
    return "";
  }
  return route.map((point, index) => `${index === 0 ? "M" : "L"}${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ");
};

const syncLedgerPipePaths = (
  svg: SVGSVGElement,
  pathMap: Map<Exclude<LedgerRailId, "active">, SVGPathElement>,
  railMap: Map<LedgerRailId, LedgerRailRefs>
): void => {
  const overlayRect = svg.getBoundingClientRect();
  const activeRefs = railMap.get("active");
  if (!activeRefs || overlayRect.width <= 0 || overlayRect.height <= 0) {
    pathMap.forEach((path) => path.setAttribute("d", ""));
    return;
  }
  const trunkX = getPipeTrunkX(activeRefs, overlayRect);
  (["extinguished", "property", "lives"] as const).forEach((lane) => {
    const targetRefs = railMap.get(lane);
    const path = pathMap.get(lane);
    if (!targetRefs || !path) {
      return;
    }
    path.setAttribute("d", buildPipePathD(buildPipeRoute(activeRefs.track, targetRefs.track, overlayRect, trunkX)));
  });
};

const getPolylinePosition = (route: PipeRoutePoint[], progress01: number): PipeRoutePoint => {
  if (route.length === 0) {
    return { x: 0, y: 0 };
  }
  if (route.length === 1) {
    return route[0];
  }
  const clampedProgress = Math.max(0, Math.min(1, progress01));
  const segments = route.slice(1).map((point, index) => {
    const from = route[index];
    const dx = point.x - from.x;
    const dy = point.y - from.y;
    return {
      from,
      to: point,
      length: Math.hypot(dx, dy)
    };
  });
  const totalLength = segments.reduce((sum, segment) => sum + segment.length, 0);
  if (totalLength <= 0) {
    return route[route.length - 1];
  }
  let remaining = totalLength * clampedProgress;
  for (const segment of segments) {
    if (segment.length <= 0) {
      continue;
    }
    if (remaining <= segment.length) {
      const ratio = remaining / segment.length;
      return {
        x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
        y: segment.from.y + (segment.to.y - segment.from.y) * ratio
      };
    }
    remaining -= segment.length;
  }
  return route[route.length - 1];
};

const advancePipeTransferTokens = (tokens: PipeTransferToken[], deltaMs: number): PipeTransferToken[] => {
  if (tokens.length === 0 || deltaMs <= 0) {
    return tokens;
  }
  const stepMs = Math.max(0, Math.min(deltaMs, 80));
  const next: PipeTransferToken[] = [];
  for (const token of tokens) {
    const durationMs = (FLOW_EVENT_LIFETIME_SECONDS[token.kind] ?? 1.1) * 1000;
    const progress01 = token.progress01 + (durationMs > 0 ? stepMs / durationMs : 1);
    if (progress01 < 1) {
      next.push({
        ...token,
        progress01
      });
    }
  }
  return next;
};

const getPendingPipeTransferCounts = (
  tokens: PipeTransferToken[]
): Record<Exclude<LedgerRailId, "active">, number> => {
  const counts = {
    extinguished: 0,
    property: 0,
    lives: 0
  };
  for (const token of tokens) {
    const lane = getFlowTargetLane(token.kind);
    if (lane) {
      counts[lane] += 1;
    }
  }
  return counts;
};

const spawnPipeTransferTokens = (
  tokens: PipeTransferToken[],
  nextTokenId: { current: number },
  event: NonNullable<TopBarData["scoring"]>["flowEvents"][number],
  activeRefs: LedgerRailRefs,
  targetRefs: LedgerRailRefs,
  overlayRect: DOMRect,
  trunkX: number,
  pendingTargetCount: number
): void => {
  if (!isPipeTransferKind(event.kind)) {
    return;
  }
  const count = Math.max(0, Math.floor(event.deltaCount));
  if (count <= 0) {
    return;
  }
  for (let index = 0; index < count; index += 1) {
    const offset = (index - (count - 1) * 0.5) * 3;
    const sourceTailOffset = event.kind === "lives" ? 0 : index;
    tokens.push({
      id: nextTokenId.current,
      kind: event.kind,
      progress01: 0,
      route: buildPipeTransferRoute(
        activeRefs,
        targetRefs,
        overlayRect,
        trunkX,
        sourceTailOffset,
        pendingTargetCount + index,
        offset
      )
    });
    nextTokenId.current += 1;
  }
};

const syncActiveQueueLayer = (
  container: HTMLElement,
  settled: HTMLElement,
  tokens: ActiveQueueToken[],
  direction: ActiveQueueDirection,
  nodeMap: Map<number, HTMLElement>
): void => {
  const relevantTokens = tokens
    .filter((token) => token.direction === direction)
    .sort((left, right) => right.id - left.id);
  if (relevantTokens.length === 0 || container.clientWidth <= 0) {
    clearManagedNodes(nodeMap);
    return;
  }
  const activeIds = new Set<number>();
  const containerWidth = container.clientWidth;
  const settledWidth = getRenderedContentWidth(settled);
  const tailX = Math.max(0, Math.min(containerWidth - LEDGER_CHIP_WIDTH_PX, settledWidth + LEDGER_BUNDLE_GAP_PX));

  relevantTokens.forEach((token, index) => {
    activeIds.add(token.id);
    let wrapper = nodeMap.get(token.id) ?? null;
    if (!wrapper) {
      wrapper = document.createElement("div");
      nodeMap.set(token.id, wrapper);
    }
    wrapper.className = `phase-score-active-queue is-${direction}`;
    syncSingleBundle(
      wrapper,
      1,
      1,
      direction === "incoming" ? "is-queue-in is-active" : "is-queue-out"
    );

    let left = tailX;
    if (direction === "incoming") {
      const targetX = Math.max(0, Math.min(containerWidth - LEDGER_CHIP_WIDTH_PX, tailX + index * ACTIVE_QUEUE_SLOT_PX));
      const startX = Math.max(
        targetX,
        containerWidth - LEDGER_CHIP_WIDTH_PX - ACTIVE_QUEUE_SLOT_PX * (relevantTokens.length - index - 1)
      );
      left = targetX + (1 - token.progress01) * (startX - targetX);
      wrapper.style.opacity = `${(0.36 + token.progress01 * 0.64).toFixed(3)}`;
    } else {
      const startX = Math.max(0, Math.min(containerWidth - LEDGER_CHIP_WIDTH_PX, tailX + index * ACTIVE_QUEUE_SLOT_PX));
      const endX = Math.max(startX, containerWidth - LEDGER_CHIP_WIDTH_PX - ACTIVE_QUEUE_SLOT_PX * (relevantTokens.length - index - 1));
      left = startX + token.progress01 * (endX - startX);
      wrapper.style.opacity = `${(0.84 - token.progress01 * 0.56).toFixed(3)}`;
    }

    wrapper.style.left = `${left.toFixed(1)}px`;
    wrapper.style.top = "50%";
    wrapper.style.setProperty("--queue-progress", token.progress01.toFixed(3));
    const anchor = container.children[index] ?? null;
    if (anchor !== wrapper) {
      container.insertBefore(wrapper, anchor);
    }
  });

  Array.from(nodeMap.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      nodeMap.get(id)?.remove();
      nodeMap.delete(id);
    }
  });
};

const syncPipeTransferTokens = (
  overlay: HTMLElement,
  tokens: PipeTransferToken[],
  nodeMap: Map<number, HTMLElement>
): void => {
  if (overlay.getBoundingClientRect().width <= 0 || overlay.getBoundingClientRect().height <= 0) {
    clearManagedNodes(nodeMap);
    return;
  }
  const activeIds = new Set<number>();
  tokens.forEach((token, index) => {
    activeIds.add(token.id);
    let wrapper = nodeMap.get(token.id) ?? null;
    if (!wrapper) {
      wrapper = document.createElement("div");
      nodeMap.set(token.id, wrapper);
    }
    wrapper.className = `phase-score-transfer is-${token.kind}`;
    const current = getPolylinePosition(token.route, token.progress01);
    const currentX = current.x;
    const currentY = current.y;
    wrapper.style.left = `${currentX.toFixed(1)}px`;
    wrapper.style.top = `${currentY.toFixed(1)}px`;
    wrapper.style.setProperty("--transfer-progress", token.progress01.toFixed(3));
    wrapper.style.opacity = `${(0.24 + Math.sin(token.progress01 * Math.PI) * 0.72).toFixed(3)}`;
    syncSingleBundle(wrapper, 1, 1, "is-settled");
    const anchor = overlay.children[index] ?? null;
    if (anchor !== wrapper) {
      overlay.insertBefore(wrapper, anchor);
    }
  });
  Array.from(nodeMap.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      nodeMap.get(id)?.remove();
      nodeMap.delete(id);
    }
  });
};

type EventClock = {
  remainingSeconds: number;
  seenAtMs: number;
};

const syncEventClock = <T extends { id: number; remainingSeconds: number }>(
  clock: Map<number, EventClock>,
  events: T[],
  now: number
): void => {
  const activeIds = new Set<number>();
  for (const event of events) {
    activeIds.add(event.id);
    const tracked = clock.get(event.id);
    if (!tracked || Math.abs(tracked.remainingSeconds - event.remainingSeconds) > 0.0005) {
      clock.set(event.id, {
        remainingSeconds: event.remainingSeconds,
        seenAtMs: now
      });
    }
  }
  for (const id of Array.from(clock.keys())) {
    if (!activeIds.has(id)) {
      clock.delete(id);
    }
  }
};

const getAnimatedRemainingSeconds = (
  clock: Map<number, EventClock>,
  event: { id: number; remainingSeconds: number },
  now: number
): number => {
  const tracked = clock.get(event.id);
  if (!tracked) {
    return event.remainingSeconds;
  }
  return Math.max(0, tracked.remainingSeconds - (now - tracked.seenAtMs) / 1000);
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

  const ledgerBody = document.createElement("div");
  ledgerBody.className = "phase-score-ledger-body";
  const ledgerRails = document.createElement("div");
  ledgerRails.className = "phase-score-ledger-rails";
  const ledgerPipes = document.createElementNS(SVG_NS, "svg");
  ledgerPipes.classList.add("phase-score-ledger-pipes");
  ledgerPipes.setAttribute("aria-hidden", "true");
  const ledgerPipePathMap = new Map<Exclude<LedgerRailId, "active">, SVGPathElement>();
  (["extinguished", "property", "lives"] as const).forEach((lane) => {
    const path = document.createElementNS(SVG_NS, "path");
    path.classList.add("phase-score-pipe", `is-${lane}`);
    ledgerPipes.appendChild(path);
    ledgerPipePathMap.set(lane, path);
  });
  const ledgerTransfers = document.createElement("div");
  ledgerTransfers.className = "phase-score-ledger-transfers";
  const ledgerPipeTransfers = document.createElement("div");
  ledgerPipeTransfers.className = "phase-score-ledger-transfer-layer";
  ledgerTransfers.append(ledgerPipeTransfers);
  const ledgerRailMap = new Map<LedgerRailId, LedgerRailRefs>();
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
    track.className = `phase-score-track is-${config.lane}`;
    const settled = document.createElement("div");
    settled.className = "phase-score-track-settled";
    const incoming = document.createElement("div");
    incoming.className = "phase-score-track-incoming";
    const fading = document.createElement("div");
    fading.className = "phase-score-track-fading";
    track.append(settled, fading, incoming);

    const count = document.createElement("span");
    count.className = "phase-score-rail-count";
    rail.append(meta, track, count);
    ledgerRails.appendChild(rail);
    ledgerRailMap.set(config.lane, { rail, track, settled, incoming, fading, count });
  }
  ledgerBody.append(ledgerRails, ledgerPipes, ledgerTransfers);
  ledgerBoard.append(ledgerHeader, ledgerBody);
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
  const scoreEventClock = new Map<number, EventClock>();
  const flowEventClock = new Map<number, EventClock>();
  const activeIncomingQueueMap = new Map<number, HTMLElement>();
  const activeOutgoingQueueMap = new Map<number, HTMLElement>();
  const pipeTransferWrapperMap = new Map<number, HTMLElement>();
  const nextActiveQueueTokenId = { current: 1 };
  const nextPipeTransferTokenId = { current: 1 };
  let activeQueueTokens: ActiveQueueToken[] = [];
  let pipeTransferTokens: PipeTransferToken[] = [];
  let lastProcessedVisualFlowId = 0;
  let lastActiveQueueUpdateMs: number | null = null;
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

  const renderLedgerBoard = (data: NonNullable<TopBarData["scoring"]>, now: number): void => {
    const countsByLane = {
      extinguished: Math.max(0, Math.floor(data.extinguishedCount)),
      property: Math.max(0, Math.floor(data.propertyDamageCount)),
      lives: Math.max(0, Math.floor(data.livesLostCount))
    };
    const scoreLaneEvents = new Map<Exclude<LedgerRailId, "active">, Array<NonNullable<TopBarData["scoring"]>["events"][number]>>([
      ["extinguished", []],
      ["property", []],
      ["lives", []]
    ]);
    for (const event of data.events) {
      if (event.lane === "info") {
        continue;
      }
      const laneEvents = scoreLaneEvents.get(event.lane);
      if (laneEvents) {
        laneEvents.push(event);
      }
    }

    const flowEvents = data.flowEvents;
    const activeFireCount = Math.max(0, Math.floor(data.activeFireCount));
    const activeRefs = ledgerRailMap.get("active") ?? null;
    const overlayRect = ledgerPipeTransfers.getBoundingClientRect();
    const trunkX = activeRefs && overlayRect.width > 0 && overlayRect.height > 0 ? getPipeTrunkX(activeRefs, overlayRect) : 16;

    if (lastActiveQueueUpdateMs !== null) {
      activeQueueTokens = advanceActiveQueueTokens(activeQueueTokens, now - lastActiveQueueUpdateMs);
      pipeTransferTokens = advancePipeTransferTokens(pipeTransferTokens, now - lastActiveQueueUpdateMs);
    }
    lastActiveQueueUpdateMs = now;

    for (const event of flowEvents) {
      if (event.id <= lastProcessedVisualFlowId) {
        continue;
      }
      if (event.kind === "gain") {
        applyActiveQueueDelta(activeQueueTokens, nextActiveQueueTokenId, "incoming", event.deltaCount, getFlowProgress01(event));
      } else if (event.kind === "decay") {
        applyActiveQueueDelta(activeQueueTokens, nextActiveQueueTokenId, "outgoing", event.deltaCount, getFlowProgress01(event));
      } else if (isPipeTransferKind(event.kind) && activeRefs && overlayRect.width > 0 && overlayRect.height > 0) {
        const targetLane = getFlowTargetLane(event.kind);
        const targetRefs = targetLane ? ledgerRailMap.get(targetLane) ?? null : null;
        if (targetRefs) {
          const pendingPipeTransferCounts = getPendingPipeTransferCounts(pipeTransferTokens);
          spawnPipeTransferTokens(
            pipeTransferTokens,
            nextPipeTransferTokenId,
            event,
            activeRefs,
            targetRefs,
            overlayRect,
            trunkX,
            targetLane ? pendingPipeTransferCounts[targetLane] : 0
          );
        }
      }
      lastProcessedVisualFlowId = Math.max(lastProcessedVisualFlowId, event.id);
    }

    const queuedIncomingCount = activeQueueTokens.reduce(
      (sum, token) => sum + (token.direction === "incoming" ? 1 : 0),
      0
    );
    const pendingPipeTransferCounts = getPendingPipeTransferCounts(pipeTransferTokens);

    for (const { lane } of LEDGER_RAILS) {
      const refs = ledgerRailMap.get(lane);
      if (!refs) {
        continue;
      }
      if (lane !== "active" && refs.fading.childElementCount > 0) {
        refs.fading.replaceChildren();
      }

      if (lane === "active") {
        refs.count.textContent = activeFireCount.toLocaleString();
        syncSettledRailBundles(refs.settled, Math.max(0, activeFireCount - queuedIncomingCount));
        refs.rail.classList.toggle(
          "is-hot",
          flowEvents.some((event) => event.kind === "property" || event.kind === "lives")
        );
        syncActiveQueueLayer(refs.incoming, refs.settled, activeQueueTokens, "incoming", activeIncomingQueueMap);
        syncActiveQueueLayer(refs.fading, refs.settled, activeQueueTokens, "outgoing", activeOutgoingQueueMap);
        continue;
      }

      const laneEvents = scoreLaneEvents.get(lane) ?? [];
      refs.count.textContent = countsByLane[lane].toLocaleString();
      syncAccumulatedRailBundles(refs.settled, Math.max(0, countsByLane[lane] - pendingPipeTransferCounts[lane]));
      refs.rail.classList.toggle(
        "is-hot",
        laneEvents.some((event) => event.severity === "negative" && event.remainingSeconds > 0)
      );
      refs.incoming.replaceChildren();
      refs.fading.replaceChildren();
    }
    syncLedgerPipePaths(ledgerPipes, ledgerPipePathMap, ledgerRailMap);
    syncPipeTransferTokens(ledgerPipeTransfers, pipeTransferTokens, pipeTransferWrapperMap);
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
        const now = performance.now();
        syncEventClock(scoreEventClock, data.scoring.events, now);
        syncEventClock(flowEventClock, data.scoring.flowEvents, now);
        const animatedScoring = {
          ...data.scoring,
          events: data.scoring.events
            .map((event) => ({
              ...event,
              remainingSeconds: getAnimatedRemainingSeconds(scoreEventClock, event, now)
            }))
            .filter((event) => event.remainingSeconds > 0),
          flowEvents: data.scoring.flowEvents
            .map((event) => ({
              ...event,
              remainingSeconds: getAnimatedRemainingSeconds(flowEventClock, event, now)
            }))
            .filter((event) => event.remainingSeconds > 0)
        };
        scoreStrip.classList.remove("is-hidden");
        applyMultiplierLabels(animatedScoring, isThreeTest);
        if (isThreeTest) {
          scoreCounter.classList.add("is-hidden");
          scoreCounter.textContent = "";
          legacyScoreContent.classList.add("is-hidden");
          ledgerBoard.classList.remove("is-hidden");
          scoreEvents.classList.add("is-hidden");
          scoreEvents.innerHTML = "";
          renderLedgerBoard(animatedScoring, now);
        } else {
          activeQueueTokens = [];
          pipeTransferTokens = [];
          lastProcessedVisualFlowId = 0;
          lastActiveQueueUpdateMs = null;
          nextActiveQueueTokenId.current = 1;
          nextPipeTransferTokenId.current = 1;
          clearManagedNodes(activeIncomingQueueMap);
          clearManagedNodes(activeOutgoingQueueMap);
          clearManagedNodes(pipeTransferWrapperMap);
          scoreCounter.classList.remove("is-hidden");
          scoreCounter.textContent = `Score ${Math.round(animatedScoring.score).toLocaleString()}`;
          legacyScoreContent.classList.remove("is-hidden");
          ledgerBoard.classList.add("is-hidden");
          scoreNumber.textContent = Math.round(animatedScoring.score).toLocaleString();
          streakLabel.textContent = `No-loss streaks: Houses ${animatedScoring.noHouseLossDays}d | Lives ${animatedScoring.noLifeLossDays}d`;
          if (animatedScoring.nextApprovalTier && animatedScoring.nextApprovalThreshold01 !== null) {
            approvalMeta.textContent = `Approval Tier ${animatedScoring.approvalTier} -> ${animatedScoring.nextApprovalTier} at ${Math.round(
              animatedScoring.nextApprovalThreshold01 * 100
            )}% (Risk ${animatedScoring.riskTier})`;
          } else {
            approvalMeta.textContent = `Approval Tier ${animatedScoring.approvalTier} (max) | Risk ${animatedScoring.riskTier}`;
          }
          approvalProgressFill.style.width = `${Math.round(
            Math.max(0, Math.min(1, animatedScoring.nextTierProgress01)) * 100
          )}%`;

          scoreEvents.innerHTML = "";
          if (animatedScoring.events.length > 0) {
            scoreEvents.classList.remove("is-hidden");
            for (let i = animatedScoring.events.length - 1; i >= 0; i -= 1) {
              const event = animatedScoring.events[i];
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
        scoreEventClock.clear();
        flowEventClock.clear();
        activeQueueTokens = [];
        pipeTransferTokens = [];
        lastProcessedVisualFlowId = 0;
        lastActiveQueueUpdateMs = null;
        nextActiveQueueTokenId.current = 1;
        nextPipeTransferTokenId.current = 1;
        clearManagedNodes(activeIncomingQueueMap);
        clearManagedNodes(activeOutgoingQueueMap);
        clearManagedNodes(pipeTransferWrapperMap);
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
