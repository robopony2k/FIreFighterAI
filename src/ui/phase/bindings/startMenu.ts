export const showStartMenu = (startMenu: HTMLDivElement | null, onShow?: () => void): void => {
  if (!startMenu) {
    return;
  }
  startMenu.classList.remove("hidden");
  onShow?.();
};

export const hideStartMenu = (startMenu: HTMLDivElement | null): void => {
  if (!startMenu) {
    return;
  }
  startMenu.classList.add("hidden");
};
