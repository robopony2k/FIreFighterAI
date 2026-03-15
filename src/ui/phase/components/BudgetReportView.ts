export type BudgetReportTone = "positive" | "negative" | "neutral";
export type BudgetReportRailId = "extinguished" | "property" | "lives";

export type BudgetReportPill = {
  id: string;
  label: string;
  value: string;
  tone?: BudgetReportTone;
};

export type BudgetReportRail = {
  id: BudgetReportRailId;
  label: string;
  count: number;
  formula: string;
  points: number;
  tone: BudgetReportTone;
};

export type BudgetReportDetail = {
  id: string;
  label: string;
  count: number;
  points: number;
  detail?: string;
  tone?: BudgetReportTone;
};

export type BudgetReportStageTotal = {
  id: string;
  label: string;
  value: number;
  detail: string;
  format: "signed_points" | "points";
  tone?: BudgetReportTone;
};

export type BudgetReportData = {
  summary: string;
  multiplierPills: BudgetReportPill[];
  rails: BudgetReportRail[];
  propertyDetails: BudgetReportDetail[];
  lifeDetails: BudgetReportDetail[];
  stageTotals: BudgetReportStageTotal[];
  continueLabel: string;
};

export type BudgetReportView = {
  element: HTMLElement;
  update: (data: BudgetReportData) => void;
};

const SVG_NS = "http://www.w3.org/2000/svg";

const formatPoints = (value: number): string => `${Math.round(value).toLocaleString()} pts`;
const formatSignedPoints = (value: number): string => `${value >= 0 ? "+" : "-"}${Math.round(Math.abs(value)).toLocaleString()}`;
const formatCount = (value: number): string => Math.max(0, Math.round(value)).toLocaleString();

const formatStageValue = (entry: BudgetReportStageTotal, value: number): string =>
  entry.format === "signed_points" ? formatSignedPoints(value) : formatPoints(value);

const createRailIcon = (lane: BudgetReportRailId): SVGSVGElement => {
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

const buildBundles = (count: number): Array<{ magnitude: number; digit: number; label: string }> => {
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

const renderBundles = (container: HTMLElement, count: number): void => {
  container.innerHTML = "";
  for (const bundle of buildBundles(count)) {
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
    for (let i = 0; i < bundle.digit; i += 1) {
      const chip = document.createElement("span");
      chip.className = "phase-score-chip is-settled";
      chip.dataset.units = unitsBucket;
      group.appendChild(chip);
    }
    container.appendChild(group);
  }
};

export const createBudgetReportView = (): BudgetReportView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-card phase-budget-report";
  element.dataset.panel = "budgetReport";

  const title = document.createElement("div");
  title.className = "phase-card-title";
  title.textContent = "Annual Ledger";

  const summary = document.createElement("div");
  summary.className = "phase-card-summary";

  const sectionsRoot = document.createElement("div");
  sectionsRoot.className = "phase-ledger-report";

  const dock = document.createElement("div");
  dock.className = "phase-budget-dock";

  const balanceStrip = document.createElement("div");
  balanceStrip.className = "phase-budget-balance";
  const balanceLabel = document.createElement("div");
  balanceLabel.className = "phase-budget-balance-label";
  balanceLabel.textContent = "CARRY OUT";
  const balanceValue = document.createElement("div");
  balanceValue.className = "phase-budget-balance-value phase-budget-odometer is-spinning";
  const balanceMeta = document.createElement("div");
  balanceMeta.className = "phase-budget-balance-meta";
  balanceStrip.append(balanceLabel, balanceValue, balanceMeta);

  const footer = document.createElement("div");
  footer.className = "phase-budget-footer";
  const continueButton = document.createElement("button");
  continueButton.className = "phase-action";
  continueButton.type = "button";
  continueButton.dataset.action = "continue";
  continueButton.textContent = "Continue";
  footer.appendChild(continueButton);

  dock.append(balanceStrip, footer);
  element.append(title, summary, sectionsRoot, dock);

  let animationFrame = 0;
  let lastSignature = "";

  type NumericAnimation = {
    node: HTMLElement;
    from: number;
    to: number;
    delayMs: number;
    durationMs: number;
    formatter: (value: number) => string;
  };

  type RevealAnimation = {
    node: HTMLElement;
    delayMs: number;
  };

  const stageLookup = (data: BudgetReportData): Map<string, BudgetReportStageTotal> =>
    new Map(data.stageTotals.map((entry) => [entry.id, entry]));

  const createStageHeader = (label: string, detail?: string): HTMLElement => {
    const header = document.createElement("div");
    header.className = "phase-ledger-stage-header";
    const titleNode = document.createElement("div");
    titleNode.className = "phase-list-header phase-budget-section-title";
    titleNode.textContent = label;
    header.appendChild(titleNode);
    if (detail) {
      const detailNode = document.createElement("div");
      detailNode.className = "phase-budget-detail";
      detailNode.textContent = detail;
      header.appendChild(detailNode);
    }
    return header;
  };

  const createStageTotal = (
    entry: BudgetReportStageTotal,
    delayMs: number,
    numericAnimations: NumericAnimation[]
  ): HTMLElement => {
    const total = document.createElement("div");
    total.className = "phase-ledger-total";
    if (entry.tone) {
      total.classList.add(`is-${entry.tone}`);
    }
    const label = document.createElement("div");
    label.className = "phase-ledger-total-label";
    label.textContent = entry.label;
    const value = document.createElement("div");
    value.className = "phase-ledger-total-value phase-budget-odometer is-spinning";
    value.textContent = formatStageValue(entry, 0);
    const detail = document.createElement("div");
    detail.className = "phase-budget-detail";
    detail.textContent = entry.detail;
    total.append(label, value, detail);
    numericAnimations.push({
      node: value,
      from: 0,
      to: entry.value,
      delayMs,
      durationMs: 760,
      formatter: (animated) => formatStageValue(entry, animated)
    });
    return total;
  };

  const createRailStage = (
    rail: BudgetReportRail,
    details: BudgetReportDetail[],
    total: BudgetReportStageTotal | null,
    delayMs: number,
    revealAnimations: RevealAnimation[],
    numericAnimations: NumericAnimation[]
  ): HTMLElement => {
    const stage = document.createElement("section");
    stage.className = `phase-ledger-stage is-${rail.id}`;
    revealAnimations.push({ node: stage, delayMs });

    const header = document.createElement("div");
    header.className = "phase-ledger-rail-head";
    const titleWrap = document.createElement("div");
    titleWrap.className = "phase-score-rail-meta";
    titleWrap.append(createRailIcon(rail.id));
    const titleLabel = document.createElement("span");
    titleLabel.className = "phase-score-rail-label";
    titleLabel.textContent = rail.label;
    titleWrap.appendChild(titleLabel);
    const count = document.createElement("span");
    count.className = "phase-score-rail-count";
    count.textContent = "0";
    header.append(titleWrap, count);

    const track = document.createElement("div");
    track.className = "phase-score-track is-report";
    const settled = document.createElement("div");
    settled.className = "phase-score-track-settled";
    renderBundles(settled, rail.count);
    track.appendChild(settled);

    const stats = document.createElement("div");
    stats.className = "phase-ledger-rail-stats";
    const formula = document.createElement("div");
    formula.className = "phase-budget-detail";
    formula.textContent = rail.formula;
    const points = document.createElement("div");
    points.className = `phase-ledger-rail-points phase-budget-odometer is-spinning is-${rail.tone}`;
    points.textContent = formatSignedPoints(0);
    stats.append(formula, points);

    const detailList = document.createElement("div");
    detailList.className = "phase-ledger-detail-list";
    for (const detailEntry of details) {
      const row = document.createElement("div");
      row.className = "phase-ledger-detail-row";
      if (detailEntry.tone) {
        row.classList.add(`is-${detailEntry.tone}`);
      }
      const left = document.createElement("div");
      left.className = "phase-budget-label-wrap";
      const label = document.createElement("span");
      label.className = "phase-list-label";
      label.textContent = detailEntry.label;
      left.appendChild(label);
      if (detailEntry.detail) {
        const detailText = document.createElement("span");
        detailText.className = "phase-budget-detail";
        detailText.textContent = detailEntry.detail;
        left.appendChild(detailText);
      }
      const right = document.createElement("div");
      right.className = "phase-ledger-detail-values";
      const countValue = document.createElement("span");
      countValue.className = "phase-ledger-detail-count phase-budget-odometer is-spinning";
      countValue.textContent = "0";
      const pointsValue = document.createElement("span");
      pointsValue.className = "phase-ledger-detail-points phase-budget-odometer is-spinning";
      pointsValue.textContent = formatSignedPoints(0);
      right.append(countValue, pointsValue);
      row.append(left, right);
      detailList.appendChild(row);

      numericAnimations.push({
        node: countValue,
        from: 0,
        to: detailEntry.count,
        delayMs: delayMs + 180,
        durationMs: 680,
        formatter: formatCount
      });
      numericAnimations.push({
        node: pointsValue,
        from: 0,
        to: detailEntry.points,
        delayMs: delayMs + 180,
        durationMs: 680,
        formatter: formatSignedPoints
      });
    }

    stage.append(header, track, stats);
    if (details.length > 0) {
      stage.appendChild(detailList);
    }
    if (total) {
      stage.appendChild(createStageTotal(total, delayMs + 220, numericAnimations));
    }

    numericAnimations.push({
      node: count,
      from: 0,
      to: rail.count,
      delayMs,
      durationMs: 720,
      formatter: formatCount
    });
    numericAnimations.push({
      node: points,
      from: 0,
      to: rail.points,
      delayMs,
      durationMs: 720,
      formatter: formatSignedPoints
    });

    return stage;
  };

  const renderReport = (data: BudgetReportData): { numericAnimations: NumericAnimation[]; revealAnimations: RevealAnimation[] } => {
    sectionsRoot.innerHTML = "";
    const numericAnimations: NumericAnimation[] = [];
    const revealAnimations: RevealAnimation[] = [];
    const totals = stageLookup(data);
    const extinguishRail = data.rails.find((rail) => rail.id === "extinguished") ?? null;
    const propertyRail = data.rails.find((rail) => rail.id === "property") ?? null;
    const livesRail = data.rails.find((rail) => rail.id === "lives") ?? null;

    let delayMs = 0;
    if (extinguishRail) {
      sectionsRoot.appendChild(
        createRailStage(extinguishRail, [], totals.get("positive-base") ?? null, delayMs, revealAnimations, numericAnimations)
      );
      delayMs += 230;
    }

    const multiplierStage = document.createElement("section");
    multiplierStage.className = "phase-ledger-stage is-multiplier";
    revealAnimations.push({ node: multiplierStage, delayMs });
    multiplierStage.appendChild(createStageHeader("Multiplier Ledger", "Command modifiers applied to extinguish gains."));
    const pillRow = document.createElement("div");
    pillRow.className = "phase-score-ledger-pills is-report";
    data.multiplierPills.forEach((pill) => {
      const pillNode = document.createElement("span");
      pillNode.className = "phase-score-pill";
      if (pill.tone) {
        pillNode.classList.add(`is-${pill.tone}`);
      }
      pillNode.textContent = `${pill.label} ${pill.value}`;
      pillRow.appendChild(pillNode);
    });
    multiplierStage.appendChild(pillRow);
    const multipliedPositive = totals.get("multiplied-positive");
    if (multipliedPositive) {
      multiplierStage.appendChild(createStageTotal(multipliedPositive, delayMs + 150, numericAnimations));
    }
    sectionsRoot.appendChild(multiplierStage);
    delayMs += 230;

    if (propertyRail) {
      sectionsRoot.appendChild(
        createRailStage(propertyRail, data.propertyDetails, totals.get("property-loss") ?? null, delayMs, revealAnimations, numericAnimations)
      );
      delayMs += 230;
    }

    if (livesRail) {
      sectionsRoot.appendChild(
        createRailStage(livesRail, data.lifeDetails, totals.get("life-loss") ?? null, delayMs, revealAnimations, numericAnimations)
      );
      delayMs += 230;
    }

    const annualStage = totals.get("annual-score");
    if (annualStage) {
      const section = document.createElement("section");
      section.className = "phase-ledger-stage is-annual";
      revealAnimations.push({ node: section, delayMs });
      section.appendChild(createStageHeader("Annual Score", "Multiplied gains minus property and life losses."));
      section.appendChild(createStageTotal(annualStage, delayMs + 140, numericAnimations));
      sectionsRoot.appendChild(section);
      delayMs += 230;
    }

    const carryIn = totals.get("carry-in");
    const carryOut = totals.get("carry-out");
    if (carryIn && carryOut) {
      const section = document.createElement("section");
      section.className = "phase-ledger-stage is-carry";
      revealAnimations.push({ node: section, delayMs });
      section.appendChild(createStageHeader("Carry Forward", "Previous total plus this year's annual score."));
      const carryGrid = document.createElement("div");
      carryGrid.className = "phase-ledger-carry-grid";
      carryGrid.append(
        createStageTotal(carryIn, delayMs + 120, numericAnimations),
        createStageTotal(carryOut, delayMs + 240, numericAnimations)
      );
      section.appendChild(carryGrid);
      sectionsRoot.appendChild(section);
    }

    return { numericAnimations, revealAnimations };
  };

  const playReveal = (
    data: BudgetReportData,
    numericAnimations: NumericAnimation[],
    revealAnimations: RevealAnimation[]
  ): void => {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }

    const totals = stageLookup(data);
    const carryIn = totals.get("carry-in")?.value ?? 0;
    const carryOut = totals.get("carry-out")?.value ?? 0;
    const annualScore = totals.get("annual-score")?.value ?? 0;
    const carryInText = formatPoints(carryIn);
    balanceValue.textContent = formatPoints(0);
    balanceMeta.textContent = `${carryInText} carry in | ${formatSignedPoints(annualScore)} annual result`;
    balanceValue.classList.add("is-spinning");

    const start = performance.now();
    const maxDuration = Math.max(
      1,
      ...numericAnimations.map((entry) => entry.delayMs + entry.durationMs),
      ...revealAnimations.map((entry) => entry.delayMs + 240)
    );

    const tick = (now: number): void => {
      const elapsed = now - start;
      let animating = false;

      revealAnimations.forEach((entry) => {
        if (elapsed >= entry.delayMs) {
          entry.node.classList.add("is-revealed");
        }
      });

      numericAnimations.forEach((entry) => {
        const localElapsed = elapsed - entry.delayMs;
        if (localElapsed <= 0) {
          entry.node.textContent = entry.formatter(entry.from);
          animating = true;
          return;
        }
        const progress = Math.max(0, Math.min(1, localElapsed / entry.durationMs));
        const eased = 1 - (1 - progress) ** 3;
        const current = entry.from + (entry.to - entry.from) * eased;
        entry.node.textContent = entry.formatter(current);
        entry.node.classList.toggle("is-spinning", progress < 1);
        if (progress < 1) {
          animating = true;
        }
      });

      const carryProgress = Math.max(0, Math.min(1, elapsed / Math.max(520, maxDuration)));
      const easedCarry = 1 - (1 - carryProgress) ** 3;
      const currentCarry = carryOut * easedCarry;
      balanceValue.textContent = formatPoints(currentCarry);
      balanceValue.classList.toggle("is-spinning", carryProgress < 1);
      balanceStrip.classList.toggle("is-positive", annualScore >= 0);
      balanceStrip.classList.toggle("is-negative", annualScore < 0);

      if (animating || elapsed < maxDuration) {
        animationFrame = window.requestAnimationFrame(tick);
      } else {
        balanceValue.textContent = formatPoints(carryOut);
        balanceMeta.textContent = `${carryInText} carry in | ${formatSignedPoints(annualScore)} annual result`;
        balanceValue.classList.remove("is-spinning");
        animationFrame = 0;
      }
    };

    animationFrame = window.requestAnimationFrame(tick);
  };

  return {
    element,
    update: (data) => {
      summary.textContent = data.summary;
      continueButton.textContent = data.continueLabel;
      const signature = JSON.stringify(data);
      if (signature === lastSignature) {
        return;
      }
      lastSignature = signature;
      const { numericAnimations, revealAnimations } = renderReport(data);
      sectionsRoot.scrollTop = 0;
      playReveal(data, numericAnimations, revealAnimations);
    }
  };
};
