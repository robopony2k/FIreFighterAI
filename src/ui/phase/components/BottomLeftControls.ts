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
  const pauseRow = document.createElement("div");
  pauseRow.className = "phase-control-row";
  pauseRow.innerHTML = `<button data-action="pause">Pause</button>`;
  const speedRow = document.createElement("div");
  speedRow.className = "phase-control-row phase-time-speed-row";
  speedRow.innerHTML = `
    <button data-action="time-speed-0" data-speed-index="0">1x</button>
    <button data-action="time-speed-1" data-speed-index="1">2x</button>
    <button data-action="time-speed-2" data-speed-index="2">3x</button>
    <button data-action="time-speed-3" data-speed-index="3">Max</button>
  `;
  timeGroup.append(titleRow, pauseRow, speedRow);

  const debugRow = document.createElement("div");
  debugRow.className = "phase-control-row phase-debug-row";
  debugRow.innerHTML = `<button data-action="debug-ignite-toggle">Debug Ignite</button>`;

  const status = document.createElement("div");
  status.className = "phase-control-status";

  element.append(timeGroup, status, debugRow);

  const pauseButton = pauseRow.querySelector('[data-action="pause"]') as HTMLButtonElement;
  const speedButtons = Array.from(speedRow.querySelectorAll<HTMLButtonElement>("button"));

  return {
    element,
    update: (data) => {
      timeGroup.classList.toggle("is-hidden", !data.showTimeControls);
      speedRow.classList.toggle("is-hidden", !data.showSpeedControl);
      speedButtons.forEach((button) => {
        const index = Number(button.dataset.speedIndex ?? 0);
        button.classList.toggle("is-active", data.timeSpeedIndex === index);
      });
      pauseButton.textContent = data.paused ? "Resume" : "Pause";
      status.textContent = data.status ?? "";
    }
  };
};
