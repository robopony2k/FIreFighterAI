import type { NotificationCenter, NotificationCenterSnapshot } from "./notificationCenter.js";

export type NotificationToastHost = {
  element: HTMLDivElement;
  destroy: () => void;
};

export type NotificationToastHostOptions = {
  resolveSafeBottomPx?: (notificationRect: DOMRectReadOnly) => number;
};

export const mountNotificationToastHost = (
  mount: HTMLElement,
  center: NotificationCenter,
  options: NotificationToastHostOptions = {}
): NotificationToastHost => {
  const element = document.createElement("div");
  element.className = "notification-toast-host";
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-relevant", "additions text");
  mount.appendChild(element);

  const render = (snapshot: NotificationCenterSnapshot): void => {
    element.replaceChildren();
    snapshot.forEach((entry) => {
      const toast = document.createElement("article");
      toast.className = `notification-toast is-${entry.lifecycle}`;
      toast.dataset.category = entry.payload.category;
      toast.dataset.severity = entry.payload.severity;
      toast.dataset.type = entry.payload.type;
      toast.setAttribute("role", entry.payload.severity === "critical" ? "alert" : "status");

      const marker = document.createElement("span");
      marker.className = "notification-toast-marker";
      marker.setAttribute("aria-hidden", "true");
      const copy = document.createElement("div");
      copy.className = "notification-toast-copy";
      const title = document.createElement("div");
      title.className = "notification-toast-title";
      title.textContent = entry.payload.title;
      const details = document.createElement("div");
      details.className = "notification-toast-details";
      details.textContent = entry.payload.details;
      copy.append(title, details);

      const actions = document.createElement("div");
      actions.className = "notification-toast-actions";
      if (entry.payload.focusTarget) {
        const focus = document.createElement("button");
        focus.type = "button";
        focus.className = "notification-toast-action notification-toast-focus";
        focus.textContent = "👁";
        focus.title = "Focus notification location";
        focus.setAttribute("aria-label", "Focus notification location");
        focus.addEventListener("click", () => center.focus(entry.payload.dedupeKey));
        actions.appendChild(focus);
      }
      const dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "notification-toast-action notification-toast-dismiss";
      dismiss.textContent = "x";
      dismiss.title = "Dismiss notification";
      dismiss.setAttribute("aria-label", "Dismiss notification");
      dismiss.addEventListener("click", () => center.dismiss(entry.payload.dedupeKey));
      actions.appendChild(dismiss);

      const setPaused = (paused: boolean): void => center.setInteractionPaused(entry.payload.dedupeKey, paused);
      toast.addEventListener("pointerenter", () => setPaused(true));
      toast.addEventListener("pointerleave", () => setPaused(false));
      toast.addEventListener("focusin", () => setPaused(true));
      toast.addEventListener("focusout", (event) => {
        if (!(event.relatedTarget instanceof Node) || !toast.contains(event.relatedTarget)) setPaused(false);
      });
      toast.append(marker, copy, actions);
      element.appendChild(toast);
    });
  };

  const unsubscribe = center.subscribe(render);
  const onVisibilityChange = (): void => center.setDocumentHidden(document.hidden);
  document.addEventListener("visibilitychange", onVisibilityChange);
  onVisibilityChange();
  let previousTime = performance.now();
  let raf = 0;
  const frame = (time: number): void => {
    center.step(time - previousTime);
    previousTime = time;
    const safeBottom = Math.max(18, options.resolveSafeBottomPx?.(element.getBoundingClientRect()) ?? 18);
    element.style.setProperty("--notification-safe-bottom", `${Math.round(safeBottom)}px`);
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    element,
    destroy: () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      element.remove();
    }
  };
};
