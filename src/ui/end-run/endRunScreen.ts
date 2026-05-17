export type EndRunScreenData = {
  victory: boolean;
  reason?: string;
  score: number;
  seed: number;
  year: number;
  callsign: string;
};

export type EndRunScreenHandle = {
  show: (data: EndRunScreenData) => void;
  hide: () => void;
  destroy: () => void;
};

export type CreateEndRunScreenOptions = {
  mount: HTMLElement;
  onNewRun: () => void;
  onMainMenu: () => void;
};

const formatScore = (score: number): string => score.toLocaleString("en-US");

export const createEndRunScreen = ({
  mount,
  onNewRun,
  onMainMenu
}: CreateEndRunScreenOptions): EndRunScreenHandle => {
  const root = document.createElement("div");
  root.className = "end-run-screen hidden";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "endRunTitle");

  const panel = document.createElement("section");
  panel.className = "end-run-panel";

  const eyebrow = document.createElement("div");
  eyebrow.className = "end-run-eyebrow";
  eyebrow.textContent = "Run Complete";

  const title = document.createElement("h2");
  title.id = "endRunTitle";

  const message = document.createElement("p");
  message.className = "end-run-message";

  const score = document.createElement("div");
  score.className = "end-run-score";
  const scoreLabel = document.createElement("span");
  scoreLabel.textContent = "Final Score";
  const scoreValue = document.createElement("strong");
  score.append(scoreLabel, scoreValue);

  const meta = document.createElement("dl");
  meta.className = "end-run-meta";

  const actions = document.createElement("div");
  actions.className = "end-run-actions";
  const newRun = document.createElement("button");
  newRun.type = "button";
  newRun.className = "end-run-primary";
  newRun.textContent = "New Run";
  const mainMenu = document.createElement("button");
  mainMenu.type = "button";
  mainMenu.textContent = "Main Menu";
  actions.append(newRun, mainMenu);

  panel.append(eyebrow, title, message, score, meta, actions);
  root.appendChild(panel);
  mount.appendChild(root);

  const setMeta = (entries: Array<[string, string]>): void => {
    meta.replaceChildren();
    entries.forEach(([label, value]) => {
      const term = document.createElement("dt");
      term.textContent = label;
      const detail = document.createElement("dd");
      detail.textContent = value;
      meta.append(term, detail);
    });
  };

  newRun.addEventListener("click", onNewRun);
  mainMenu.addEventListener("click", onMainMenu);

  return {
    show: (data) => {
      root.classList.toggle("end-run-screen--victory", data.victory);
      root.classList.toggle("end-run-screen--defeat", !data.victory);
      title.textContent = data.victory ? "Career Complete" : "Command Relieved";
      message.textContent =
        data.reason ??
        (data.victory ? "The region ends the campaign resilient." : "The region is overwhelmed.");
      scoreValue.textContent = formatScore(data.score);
      setMeta([
        ["Chief", data.callsign],
        ["Year", data.year.toString()],
        ["Seed", data.seed.toString()]
      ]);
      root.classList.remove("hidden");
      newRun.focus();
    },
    hide: () => {
      root.classList.add("hidden");
    },
    destroy: () => {
      root.remove();
    }
  };
};
