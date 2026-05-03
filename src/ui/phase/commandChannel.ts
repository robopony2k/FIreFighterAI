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
      type: "status";
      message: string;
    }
  | {
      type: "minimap-pan";
      tile: PhaseUiTilePoint;
    }
  | {
      type: "map-primary";
      tile: PhaseUiTilePoint;
      shiftKey?: boolean;
      altKey?: boolean;
    }
  | {
      type: "map-clear-fuel-break";
      tile: PhaseUiTilePoint;
    }
  | {
      type: "map-retask";
      tile: PhaseUiTilePoint;
    }
  | {
      type: "map-formation";
      start: PhaseUiTilePoint;
      end: PhaseUiTilePoint;
    }
  | {
      type: "town-alert";
      townId: number;
      direction: "raise" | "lower";
    }
  | {
      type: "town-evac-select";
      townId: number;
    }
  | {
      type: "town-evac-cancel";
      townId: number;
    }
  | {
      type: "town-evac-issue";
      townId: number;
    }
  | {
      type: "town-evac-return";
      townId: number;
    }
  | {
      type: "town-evac-destination";
      townId: number;
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
