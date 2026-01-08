import type { Phase, PrimaryCta } from "../types.js";

export type TopBarData = {
  phase: Phase;
  progress: number;
  alert?: string | null;
  primaryCta?: PrimaryCta;
  windInfo?: string | null;
};

export type TopBarView = {
  element: HTMLElement;
  update: (data: TopBarData) => void;
  onCta: (handler: (actionId: string) => void) => void;
};

const phaseLabels: Record<Phase, string> = {
  growth: "Growth",
  maintenance: "Maintenance",
  fire: "Fire Season",
  budget: "Budget"
};

export const createTopBar = (): TopBarView => {
  const element = document.createElement("header");
  element.className = "phase-panel phase-topbar";
  element.dataset.panel = "topbar";

  const badge = document.createElement("div");
  badge.className = "phase-badge";

  const progress = document.createElement("div");
  progress.className = "phase-progress";
  const progressFill = document.createElement("div");
  progressFill.className = "phase-progress-fill";
  progress.appendChild(progressFill);

  const alert = document.createElement("div");
  alert.className = "phase-alert";

  const wind = document.createElement("div");
  wind.className = "phase-wind is-hidden";

  const cta = document.createElement("button");
  cta.className = "phase-cta";

  element.append(badge, progress, wind, alert, cta);

  let ctaHandler: ((actionId: string) => void) | null = null;
  let currentAction: string | null = null;
  cta.addEventListener("click", () => {
    if (currentAction && ctaHandler) {
      ctaHandler(currentAction);
    }
  });

  return {
    element,
    update: (data) => {
      badge.textContent = phaseLabels[data.phase];
      progressFill.style.width = `${Math.round(data.progress * 100)}%`;
      if (data.alert) {
        alert.textContent = data.alert;
        alert.classList.remove("is-hidden");
      } else {
        alert.textContent = "";
        alert.classList.add("is-hidden");
      }
      if (data.windInfo) {
        wind.textContent = data.windInfo;
        wind.classList.remove("is-hidden");
      } else {
        wind.textContent = "";
        wind.classList.add("is-hidden");
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
    },
    onCta: (handler) => {
      ctaHandler = handler;
    }
  };
};
