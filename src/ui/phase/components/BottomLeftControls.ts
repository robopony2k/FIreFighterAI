export type BottomControlsData = {
  showTimeControls: boolean;
  showSpeedControl: boolean;
  paused: boolean;
  timeSpeedIndex: number;
  status?: string;
};

export type BottomControlsView = {
  element: HTMLElement;
  update: (data: BottomControlsData) => void;
};

export const createBottomLeftControls = (): BottomControlsView => {
  const element = document.createElement("div");
  element.className = "phase-panel phase-bottom-controls";
  element.dataset.panel = "bottomControls";

  const timeGroup = document.createElement("div");
  timeGroup.className = "phase-control-group phase-time-group";
  const titleRow = document.createElement("div");
  titleRow.className = "phase-control-title";
  titleRow.textContent = "Time";
  const speedRow = document.createElement("div");
  speedRow.className = "phase-control-row phase-time-speed-row";
  speedRow.innerHTML = `
    <button data-action="pause" aria-label="Pause" title="Pause">||</button>
    <button data-action="time-speed-0" data-speed-index="0" aria-label="Speed 1x" title="Speed 1x">&gt;</button>
    <button data-action="time-speed-1" data-speed-index="1" aria-label="Speed 2x" title="Speed 2x">&gt;&gt;</button>
    <button data-action="time-speed-2" data-speed-index="2" aria-label="Speed 3x" title="Speed 3x">&gt;&gt;&gt;</button>
    <button data-action="time-speed-3" data-speed-index="3" aria-label="Speed Max" title="Speed Max">&gt;&gt;&gt;&gt;</button>
  `;
  timeGroup.append(titleRow, speedRow);

  const debugRow = document.createElement("div");
  debugRow.className = "phase-control-row phase-control-row-single phase-debug-row";
  debugRow.innerHTML = `<button data-action="debug-ignite-toggle">Debug Ignite</button>`;

  const status = document.createElement("div");
  status.className = "phase-control-status";

  element.append(timeGroup, status, debugRow);

  const pauseButton = speedRow.querySelector('[data-action="pause"]') as HTMLButtonElement;
  const speedButtons = Array.from(speedRow.querySelectorAll<HTMLButtonElement>("[data-speed-index]"));

  return {
    element,
    update: (data) => {
      timeGroup.classList.toggle("is-hidden", !data.showTimeControls);
      speedRow.classList.toggle("is-hidden", !data.showSpeedControl);
      speedButtons.forEach((button) => {
        const index = Number(button.dataset.speedIndex ?? 0);
        button.classList.toggle("is-active", data.timeSpeedIndex === index);
      });
      const pauseLabel = data.paused ? "Resume" : "Pause";
      pauseButton.textContent = data.paused ? ">" : "||";
      pauseButton.setAttribute("aria-label", pauseLabel);
      pauseButton.setAttribute("title", pauseLabel);
      status.textContent = data.status ?? "";
    }
  };
};
