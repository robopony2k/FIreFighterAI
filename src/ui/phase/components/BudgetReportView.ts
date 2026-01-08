export type BudgetReportData = {
  summary: string;
  approval: string;
  losses: string;
};

export type BudgetReportView = {
  element: HTMLElement;
  update: (data: BudgetReportData) => void;
};

export const createBudgetReportView = (): BudgetReportView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-card";
  element.dataset.panel = "budgetReport";

  const title = document.createElement("div");
  title.className = "phase-card-title";
  title.textContent = "Annual Review";

  const summary = document.createElement("div");
  summary.className = "phase-card-summary";

  const metrics = document.createElement("div");
  metrics.className = "phase-list";

  const scrub = document.createElement("input");
  scrub.type = "range";
  scrub.min = "0";
  scrub.max = "100";
  scrub.value = "50";
  scrub.className = "phase-scrubber";

  element.append(title, summary, metrics, scrub);

  return {
    element,
    update: (data) => {
      summary.textContent = data.summary;
      metrics.innerHTML = "";
      const approval = document.createElement("div");
      approval.className = "phase-list-row";
      approval.textContent = `Approval: ${data.approval}`;
      const losses = document.createElement("div");
      losses.className = "phase-list-row";
      losses.textContent = `Losses: ${data.losses}`;
      metrics.append(approval, losses);
    }
  };
};
