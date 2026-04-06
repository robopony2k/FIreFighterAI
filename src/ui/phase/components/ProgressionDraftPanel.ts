export type ProgressionDraftOptionData = {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  categoryLabel: string;
  rarity: "standard" | "rare" | "elite";
  stacks: number;
  maxStacks: number;
};

export type ProgressionDraftPanelData = {
  active: boolean;
  title: string;
  summary: string;
  progressText: string;
  progress01: number;
  queuedCount: number;
  options: ProgressionDraftOptionData[];
};

export type ProgressionDraftPanelView = {
  element: HTMLElement;
  update: (data: ProgressionDraftPanelData) => void;
};

const ICON_LABELS: Record<string, string> = {
  academy: "TRN",
  break: "CUT",
  foam: "SUP",
  range: "RNG",
  refill: "REF",
  speed: "SPD",
  tank: "CAP",
  wing: "AIR"
};

const toChipLabel = (icon: string): string => ICON_LABELS[icon] ?? icon.slice(0, 3).toUpperCase();

const toRarityLabel = (rarity: ProgressionDraftOptionData["rarity"]): string => {
  if (rarity === "elite") {
    return "Elite";
  }
  if (rarity === "rare") {
    return "Rare";
  }
  return "Standard";
};

export const createProgressionDraftPanel = (): ProgressionDraftPanelView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-progression-draft is-idle";
  element.dataset.panel = "progressionDraft";

  const shell = document.createElement("section");
  shell.className = "phase-progression-draft-shell";

  const eyebrow = document.createElement("div");
  eyebrow.className = "phase-progression-draft-eyebrow";
  eyebrow.textContent = "Command Upgrade Draft";

  const title = document.createElement("div");
  title.className = "phase-progression-draft-title";
  title.textContent = "Command Upgrade";

  const summary = document.createElement("div");
  summary.className = "phase-progression-draft-summary";

  const progressMeta = document.createElement("div");
  progressMeta.className = "phase-progress-meta";

  const progressBar = document.createElement("div");
  progressBar.className = "phase-progress-bar";
  const progressFill = document.createElement("div");
  progressFill.className = "phase-progress-fill";
  progressBar.appendChild(progressFill);

  const queue = document.createElement("div");
  queue.className = "phase-progress-queue";

  const options = document.createElement("div");
  options.className = "phase-progress-options";

  shell.append(eyebrow, title, summary, progressMeta, progressBar, queue, options);
  element.appendChild(shell);
  let renderedOptionsKey = "";

  const buildOptionsKey = (entries: ProgressionDraftOptionData[]): string =>
    entries
      .map(
        (option) =>
          `${option.id}:${option.name}:${option.description}:${option.icon}:${option.categoryLabel}:${option.rarity}:${option.stacks}:${option.maxStacks}`
      )
      .join("|");

  return {
    element,
    update: (data) => {
      title.textContent = data.title;
      summary.textContent = data.summary;
      progressMeta.textContent = data.progressText;
      progressFill.style.width = `${Math.round(Math.max(0, Math.min(1, data.progress01)) * 100)}%`;
      queue.textContent =
        data.queuedCount > 0 ? `${data.queuedCount} more draft${data.queuedCount === 1 ? "" : "s"} queued after this pick.` : "Choose one upgrade.";
      queue.classList.toggle("is-alert", data.queuedCount > 0);

      const hasActiveDraft = data.active && data.options.length > 0;
      element.classList.toggle("is-idle", !hasActiveDraft);
      if (!hasActiveDraft) {
        if (renderedOptionsKey) {
          options.replaceChildren();
          renderedOptionsKey = "";
        }
        return;
      }

      const nextOptionsKey = buildOptionsKey(data.options);
      if (nextOptionsKey === renderedOptionsKey) {
        return;
      }

      renderedOptionsKey = nextOptionsKey;
      options.replaceChildren();
      data.options.forEach((option) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `phase-progression-option is-${option.rarity}`;
        button.dataset.action = "progression-pick";
        button.dataset.rewardId = option.id;
        button.innerHTML = `
          <span class="phase-progression-option-topline">
            <span class="phase-progression-option-type">${option.categoryLabel}</span>
            <span class="phase-progression-option-rarity">${toRarityLabel(option.rarity)}</span>
          </span>
          <span class="phase-progression-option-head">
            <span class="phase-progression-option-icon">${toChipLabel(option.icon)}</span>
            <span class="phase-progression-option-copy">
              <span class="phase-progression-option-title">${option.name}</span>
              <span class="phase-progression-option-meta">${option.stacks}/${option.maxStacks} owned</span>
            </span>
          </span>
          <span class="phase-progression-option-description">${option.description}</span>
          <span class="phase-progression-option-footer">
            <span class="phase-progression-option-stack">Next stack ${Math.min(option.stacks + 1, option.maxStacks)}/${option.maxStacks}</span>
            <span class="phase-progression-option-prompt">Select</span>
          </span>
        `;
        options.appendChild(button);
      });
    }
  };
};
