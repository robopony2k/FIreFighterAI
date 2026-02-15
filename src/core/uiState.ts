export interface UiState {
  overlayVisible: boolean;
  overlayTitle: string;
  overlayMessage: string;
  overlayDetails: string[];
  overlayAction: "restart" | "dismiss";
}

export const createUiState = (): UiState => ({
  overlayVisible: false,
  overlayTitle: "Fireline",
  overlayMessage: "",
  overlayDetails: [],
  overlayAction: "dismiss"
});

export const resetUiState = (state: UiState): void => {
  state.overlayVisible = false;
  state.overlayTitle = "Fireline";
  state.overlayMessage = "";
  state.overlayDetails = [];
  state.overlayAction = "dismiss";
};
