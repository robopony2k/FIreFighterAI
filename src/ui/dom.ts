export interface UIRefs {
  seedValue: HTMLSpanElement;
  budgetValue: HTMLSpanElement;
  approvalValue: HTMLSpanElement;
  yearValue: HTMLSpanElement;
  phaseValue: HTMLSpanElement;
  firesValue: HTMLSpanElement;
  propertyLossValue: HTMLSpanElement;
  livesLossValue: HTMLSpanElement;
  scoreValue: HTMLSpanElement;
  windValue: HTMLSpanElement;
  statusText: HTMLDivElement;
  deployFirefighter: HTMLButtonElement;
  deployTruck: HTMLButtonElement;
  deployClear: HTMLButtonElement;
  newRunBtn: HTMLButtonElement;
  pauseBtn: HTMLButtonElement;
  zoomOutBtn: HTMLButtonElement;
  zoomInBtn: HTMLButtonElement;
  overlay: HTMLDivElement;
  overlayTitle: HTMLHeadingElement;
  overlayMessage: HTMLParagraphElement;
  overlayRestart: HTMLButtonElement;
  callsignInput: HTMLInputElement;
  leaderboardList: HTMLOListElement;
  beginFireSeason: HTMLButtonElement;
}

export function getUIRefs(): UIRefs {
  return {
    seedValue: document.getElementById("seedValue") as HTMLSpanElement,
    budgetValue: document.getElementById("budgetValue") as HTMLSpanElement,
    approvalValue: document.getElementById("approvalValue") as HTMLSpanElement,
    yearValue: document.getElementById("yearValue") as HTMLSpanElement,
    phaseValue: document.getElementById("phaseValue") as HTMLSpanElement,
    firesValue: document.getElementById("firesValue") as HTMLSpanElement,
    propertyLossValue: document.getElementById("propertyLossValue") as HTMLSpanElement,
    livesLossValue: document.getElementById("livesLossValue") as HTMLSpanElement,
    scoreValue: document.getElementById("scoreValue") as HTMLSpanElement,
    windValue: document.getElementById("windValue") as HTMLSpanElement,
    statusText: document.getElementById("statusText") as HTMLDivElement,
    deployFirefighter: document.getElementById("deployFirefighter") as HTMLButtonElement,
    deployTruck: document.getElementById("deployTruck") as HTMLButtonElement,
    deployClear: document.getElementById("deployClear") as HTMLButtonElement,
    newRunBtn: document.getElementById("newRunBtn") as HTMLButtonElement,
    pauseBtn: document.getElementById("pauseBtn") as HTMLButtonElement,
    zoomOutBtn: document.getElementById("zoomOutBtn") as HTMLButtonElement,
    zoomInBtn: document.getElementById("zoomInBtn") as HTMLButtonElement,
    overlay: document.getElementById("overlay") as HTMLDivElement,
    overlayTitle: document.getElementById("overlayTitle") as HTMLHeadingElement,
    overlayMessage: document.getElementById("overlayMessage") as HTMLParagraphElement,
    overlayRestart: document.getElementById("overlayRestart") as HTMLButtonElement,
    callsignInput: document.getElementById("callsignInput") as HTMLInputElement,
    leaderboardList: document.getElementById("leaderboardList") as HTMLOListElement,
    beginFireSeason: document.getElementById("beginFireSeason") as HTMLButtonElement
  };
}
