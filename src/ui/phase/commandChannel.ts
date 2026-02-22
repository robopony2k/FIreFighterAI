export const PHASE_UI_COMMAND_EVENT = "phase-ui-command";

export type PhaseUiTilePoint = {
  x: number;
  y: number;
};

export type PhaseUiCommand =
  | {
      type: "action";
      action: string;
      payload?: Record<string, string>;
    }
  | {
      type: "minimap-pan";
      tile: PhaseUiTilePoint;
    };

export const dispatchPhaseUiCommand = (command: PhaseUiCommand): void => {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(PHASE_UI_COMMAND_EVENT, { detail: command }));
};

export const listenPhaseUiCommand = (handler: (command: PhaseUiCommand) => void): (() => void) => {
  if (typeof window === "undefined") {
    return () => {};
  }
  const listener = (event: Event): void => {
    const customEvent = event as CustomEvent<PhaseUiCommand | undefined>;
    if (!customEvent.detail) {
      return;
    }
    handler(customEvent.detail);
  };
  window.addEventListener(PHASE_UI_COMMAND_EVENT, listener as EventListener);
  return () => {
    window.removeEventListener(PHASE_UI_COMMAND_EVENT, listener as EventListener);
  };
};
