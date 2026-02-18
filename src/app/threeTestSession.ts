export type ThreeTestSessionState = {
  active: boolean;
};

export const createThreeTestSessionState = (): ThreeTestSessionState => ({
  active: false
});
