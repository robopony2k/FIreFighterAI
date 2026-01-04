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
  overlayDetails: HTMLUListElement;
  overlayRestart: HTMLButtonElement;
  rosterFirefighterCount: HTMLSpanElement;
  rosterTruckCount: HTMLSpanElement;
  rosterList: HTMLDivElement;
  recruitFirefighter: HTMLButtonElement;
  recruitTruck: HTMLButtonElement;
  trainSpeed: HTMLButtonElement;
  trainPower: HTMLButtonElement;
  trainRange: HTMLButtonElement;
  trainResilience: HTMLButtonElement;
  callsignInput: HTMLInputElement;
  leaderboardList: HTMLOListElement;
  beginFireSeason: HTMLButtonElement;
  characterScreen: HTMLDivElement;
  characterGrid: HTMLDivElement;
  characterSummary: HTMLParagraphElement;
  characterConfirm: HTMLButtonElement;
  characterPreviewPortrait: HTMLDivElement;
  characterPreviewImage: HTMLImageElement;
  characterPreviewInitials: HTMLSpanElement;
  characterNameInput: HTMLInputElement;
  characterNameRandom: HTMLButtonElement;
  chiefPortrait: HTMLDivElement;
  chiefPortraitImage: HTMLImageElement;
  chiefPortraitInitials: HTMLSpanElement;
  chiefName: HTMLDivElement;
  chiefTitle: HTMLDivElement;
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
    overlayDetails: document.getElementById("overlayDetails") as HTMLUListElement,
    overlayRestart: document.getElementById("overlayRestart") as HTMLButtonElement,
    rosterFirefighterCount: document.getElementById("rosterFirefighterCount") as HTMLSpanElement,
    rosterTruckCount: document.getElementById("rosterTruckCount") as HTMLSpanElement,
    rosterList: document.getElementById("rosterList") as HTMLDivElement,
    recruitFirefighter: document.getElementById("recruitFirefighter") as HTMLButtonElement,
    recruitTruck: document.getElementById("recruitTruck") as HTMLButtonElement,
    trainSpeed: document.getElementById("trainSpeed") as HTMLButtonElement,
    trainPower: document.getElementById("trainPower") as HTMLButtonElement,
    trainRange: document.getElementById("trainRange") as HTMLButtonElement,
    trainResilience: document.getElementById("trainResilience") as HTMLButtonElement,
    callsignInput: document.getElementById("callsignInput") as HTMLInputElement,
    leaderboardList: document.getElementById("leaderboardList") as HTMLOListElement,
    beginFireSeason: document.getElementById("beginFireSeason") as HTMLButtonElement,
    characterScreen: document.getElementById("characterScreen") as HTMLDivElement,
    characterGrid: document.getElementById("characterGrid") as HTMLDivElement,
    characterSummary: document.getElementById("characterSummary") as HTMLParagraphElement,
    characterConfirm: document.getElementById("characterConfirm") as HTMLButtonElement,
    characterPreviewPortrait: document.getElementById("characterPreviewPortrait") as HTMLDivElement,
    characterPreviewImage: document.getElementById("characterPreviewImage") as HTMLImageElement,
    characterPreviewInitials: document.getElementById("characterPreviewInitials") as HTMLSpanElement,
    characterNameInput: document.getElementById("characterNameInput") as HTMLInputElement,
    characterNameRandom: document.getElementById("characterNameRandom") as HTMLButtonElement,
    chiefPortrait: document.getElementById("chiefPortrait") as HTMLDivElement,
    chiefPortraitImage: document.getElementById("chiefPortraitImage") as HTMLImageElement,
    chiefPortraitInitials: document.getElementById("chiefPortraitInitials") as HTMLSpanElement,
    chiefName: document.getElementById("chiefName") as HTMLDivElement,
    chiefTitle: document.getElementById("chiefTitle") as HTMLDivElement
  };
}
