import type { WorldState } from "../core/state.js";

export type OverlayRefs = {
  overlay: HTMLDivElement;
  overlayTitle: HTMLHeadingElement;
  overlayMessage: HTMLParagraphElement;
  overlayDetails: HTMLUListElement;
  overlayRestart: HTMLButtonElement;
};

let dismissTimeout: number | null = null;
let lastOverlayToken = "";

export const getOverlayRefs = (): OverlayRefs => ({
  overlay: document.getElementById("overlay") as HTMLDivElement,
  overlayTitle: document.getElementById("overlayTitle") as HTMLHeadingElement,
  overlayMessage: document.getElementById("overlayMessage") as HTMLParagraphElement,
  overlayDetails: document.getElementById("overlayDetails") as HTMLUListElement,
  overlayRestart: document.getElementById("overlayRestart") as HTMLButtonElement
});

export const updateOverlay = (refs: OverlayRefs, state: WorldState): void => {
  refs.overlay.classList.toggle("hidden", !state.overlayVisible);
  refs.overlay.classList.toggle("is-blocking", state.overlayAction === "restart");
  refs.overlayTitle.textContent = state.overlayTitle;
  refs.overlayMessage.textContent = state.overlayMessage;
  refs.overlayDetails.innerHTML = "";
  if (state.overlayDetails.length > 0) {
    state.overlayDetails.forEach((entry) => {
      const item = document.createElement("li");
      item.textContent = entry;
      refs.overlayDetails.appendChild(item);
    });
    refs.overlayDetails.classList.remove("hidden");
  } else {
    refs.overlayDetails.classList.add("hidden");
  }
  refs.overlayRestart.textContent = state.overlayAction === "restart" ? "Play Again" : "OK";

  if (state.overlayVisible && state.overlayAction === "dismiss") {
    const token = `${state.overlayTitle}|${state.overlayMessage}|${state.overlayDetails.join("|")}`;
    if (token !== lastOverlayToken) {
      lastOverlayToken = token;
      if (dismissTimeout !== null) {
        window.clearTimeout(dismissTimeout);
      }
      dismissTimeout = window.setTimeout(() => {
        state.overlayVisible = false;
      }, 5000);
    }
  } else {
    lastOverlayToken = "";
    if (dismissTimeout !== null) {
      window.clearTimeout(dismissTimeout);
      dismissTimeout = null;
    }
  }
};
