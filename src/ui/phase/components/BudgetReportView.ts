export type BudgetReportTone = "positive" | "negative" | "neutral";

export type BudgetReportRow = {
  id: string;
  label: string;
  value: number;
  format: "signed_points" | "points" | "multiplier" | "count";
  units?: string;
  detail?: string;
  tone?: BudgetReportTone;
};

export type BudgetReportSection = {
  title: string;
  rows: BudgetReportRow[];
};

export type BudgetReportData = {
  summary: string;
  sections: BudgetReportSection[];
  continueLabel: string;
};

export type BudgetReportView = {
  element: HTMLElement;
  update: (data: BudgetReportData) => void;
};

export const createBudgetReportView = (): BudgetReportView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-card phase-budget-report";
  element.dataset.panel = "budgetReport";

  const title = document.createElement("div");
  title.className = "phase-card-title";
  title.textContent = "Annual Review";

  const summary = document.createElement("div");
  summary.className = "phase-card-summary";

  const sectionsRoot = document.createElement("div");
  sectionsRoot.className = "phase-budget-sections";

  const dock = document.createElement("div");
  dock.className = "phase-budget-dock";

  const balanceStrip = document.createElement("div");
  balanceStrip.className = "phase-budget-balance";
  const balanceLabel = document.createElement("div");
  balanceLabel.className = "phase-budget-balance-label";
  balanceLabel.textContent = "BALANCE";
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
  const pointFormatRow: BudgetReportRow = {
    id: "running-points",
    label: "Running",
    value: 0,
    format: "points",
    units: "pts"
  };
  const signedFormatRow: BudgetReportRow = {
    id: "running-signed",
    label: "Running",
    value: 0,
    format: "signed_points"
  };

  const formatRowValue = (row: BudgetReportRow, value: number): string => {
    if (row.format === "multiplier") {
      return `${value.toFixed(2)}x`;
    }
    if (row.format === "count") {
      const rounded = Math.round(value).toLocaleString();
      return row.units ? `${rounded} ${row.units}` : rounded;
    }
    if (row.format === "signed_points") {
      const rounded = Math.round(Math.abs(value)).toLocaleString();
      return `${value >= 0 ? "+" : "-"}${rounded}`;
    }
    const rounded = Math.round(value).toLocaleString();
    return row.units ? `${rounded} ${row.units}` : rounded;
  };

  const easeOutCubic = (value: number): number => 1 - (1 - value) ** 3;
  const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
  const getRowStartValue = (row: BudgetReportRow): number => (row.format === "multiplier" ? 1 : 0);
  const slugifySectionTitle = (value: string): string =>
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");

  type RowAnimation = {
    row: BudgetReportRow;
    valueNode: HTMLElement;
    rowNode: HTMLElement;
    delayMs: number;
    startValue: number;
  };

  const renderSections = (data: BudgetReportData): RowAnimation[] => {
    sectionsRoot.innerHTML = "";
    const animations: RowAnimation[] = [];
    const rowStaggerMs = 340;
    const sectionPauseMs = 460;
    const expenseCrashPauseMs = 620;
    let sectionStartDelayMs = 0;
    data.sections.forEach((section) => {
      const sectionNode = document.createElement("section");
      sectionNode.className = "phase-budget-section";
      sectionNode.dataset.section = slugifySectionTitle(section.title);
      if (section.rows.length <= 1) {
        sectionNode.classList.add("is-compact");
      }
      const sectionTitle = document.createElement("div");
      sectionTitle.className = "phase-list-header phase-budget-section-title";
      sectionTitle.textContent = section.title;
      const sectionList = document.createElement("div");
      sectionList.className = "phase-list phase-budget-list phase-budget-table";
      const isExpenseSection = section.title.trim().toLowerCase() === "expenses";
      if (isExpenseSection) {
        sectionStartDelayMs += expenseCrashPauseMs;
      }

      section.rows.forEach((row, rowIndex) => {
        const rowNode = document.createElement("div");
        rowNode.className = "phase-list-row phase-budget-row";
        rowNode.dataset.rowId = row.id;
        if (row.tone === "positive") {
          rowNode.classList.add("is-positive");
        } else if (row.tone === "negative") {
          rowNode.classList.add("is-negative");
        }
        const labelWrap = document.createElement("div");
        labelWrap.className = "phase-budget-label-wrap";
        const label = document.createElement("span");
        label.className = "phase-list-label";
        label.textContent = row.label;
        labelWrap.appendChild(label);
        if (row.detail) {
          const detail = document.createElement("span");
          detail.className = "phase-budget-detail";
          detail.textContent = row.detail;
          labelWrap.appendChild(detail);
        }
        const valueNode = document.createElement("span");
        valueNode.className = "phase-list-value phase-budget-odometer is-spinning";
        const startValue = getRowStartValue(row);
        valueNode.textContent = formatRowValue(row, startValue);
        rowNode.append(labelWrap, valueNode);
        sectionList.appendChild(rowNode);
        animations.push({
          row,
          valueNode,
          rowNode,
          delayMs: sectionStartDelayMs + rowIndex * rowStaggerMs,
          startValue
        });
      });

      sectionNode.append(sectionTitle, sectionList);
      sectionsRoot.appendChild(sectionNode);
      sectionStartDelayMs += section.rows.length * rowStaggerMs + sectionPauseMs;
    });
    return animations;
  };

  const playReveal = (rows: RowAnimation[]): void => {
    if (animationFrame) {
      window.cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    }
    const rowLookup = new Map<string, number>();
    rows.forEach((entry) => {
      rowLookup.set(entry.row.id, entry.row.value);
    });
    const openingCarry = rowLookup.get("annual-prev") ?? 0;
    const finalAnnual = rowLookup.get("annual-balance") ?? 0;
    const finalCarry = rowLookup.get("annual-current") ?? openingCarry + finalAnnual;
    const liveValues = new Map<string, number>();
    rows.forEach((entry) => {
      liveValues.set(entry.row.id, entry.startValue);
    });

    const readValue = (id: string, fallback = 0): number => {
      const value = liveValues.get(id);
      return Number.isFinite(value) ? (value as number) : fallback;
    };

    const updateBalanceVisual = (isAnimating: boolean): void => {
      const baseRunning = readValue("burnout-points") + readValue("squirt-bonus") + readValue("other-positive");
      const multiplierFinal = rowLookup.get("mult-total") ?? 1;
      const multiplierRunningRaw = readValue("mult-total", 1);
      const multiplierProgress =
        Math.abs(multiplierFinal - 1) < 0.0001 ? 1 : clamp01((multiplierRunningRaw - 1) / (multiplierFinal - 1));
      const multiplierRunning = 1 + (multiplierFinal - 1) * multiplierProgress;
      const expensesRunning =
        readValue("expense-house") +
        readValue("expense-civilian") +
        readValue("expense-firefighter") +
        readValue("expense-assets");
      const annualRunning = baseRunning * multiplierRunning + expensesRunning;
      const carryRunning = openingCarry + annualRunning;

      balanceValue.textContent = formatRowValue(signedFormatRow, annualRunning);
      balanceMeta.textContent = `${formatRowValue(pointFormatRow, carryRunning)} carry total | Prev ${formatRowValue(
        pointFormatRow,
        openingCarry
      )} -> Current ${formatRowValue(pointFormatRow, finalCarry)}`;
      balanceValue.classList.toggle("is-spinning", isAnimating);
      balanceStrip.classList.toggle("is-positive", annualRunning >= 0);
      balanceStrip.classList.toggle("is-negative", annualRunning < 0);
    };

    updateBalanceVisual(true);

    const startTime = performance.now();
    const rowDurationMs = 1350;
    const tick = (now: number): void => {
      let hasActiveAnimation = false;
      rows.forEach((entry) => {
        const elapsed = now - startTime - entry.delayMs;
        if (elapsed <= 0) {
          entry.rowNode.classList.remove("is-revealed");
          liveValues.set(entry.row.id, entry.startValue);
          return;
        }
        const progress = clamp01(elapsed / rowDurationMs);
        const eased = easeOutCubic(progress);
        const animatedValue = entry.startValue + (entry.row.value - entry.startValue) * eased;
        liveValues.set(entry.row.id, animatedValue);
        entry.rowNode.classList.add("is-revealed");
        entry.valueNode.textContent = formatRowValue(entry.row, animatedValue);
        if (progress < 1) {
          hasActiveAnimation = true;
          entry.valueNode.classList.add("is-spinning");
        } else {
          entry.valueNode.classList.remove("is-spinning");
          entry.valueNode.textContent = formatRowValue(entry.row, entry.row.value);
        }
      });
      updateBalanceVisual(hasActiveAnimation);
      if (hasActiveAnimation) {
        animationFrame = window.requestAnimationFrame(tick);
      } else {
        balanceValue.textContent = formatRowValue(signedFormatRow, finalAnnual);
        balanceMeta.textContent = `${formatRowValue(pointFormatRow, finalCarry)} carry total | Prev ${formatRowValue(
          pointFormatRow,
          openingCarry
        )} -> Current ${formatRowValue(pointFormatRow, finalCarry)}`;
        balanceStrip.classList.toggle("is-positive", finalAnnual >= 0);
        balanceStrip.classList.toggle("is-negative", finalAnnual < 0);
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
      const rows = renderSections(data);
      sectionsRoot.scrollTop = 0;
      playReveal(rows);
    }
  };
};
