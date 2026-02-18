export const getActionTarget = (eventTarget: EventTarget | null): HTMLElement | null => {
  if (eventTarget instanceof Element) {
    return eventTarget.closest("[data-action]") as HTMLElement | null;
  }
  if (eventTarget instanceof Node) {
    return eventTarget.parentElement?.closest("[data-action]") as HTMLElement | null;
  }
  return null;
};
