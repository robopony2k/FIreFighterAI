export type IntertownRoadPassState = {
  completedTownPairKeys: Set<string>;
};

export const createIntertownTownPairKey = (leftTownId: number, rightTownId: number): string =>
  leftTownId < rightTownId ? `${leftTownId}:${rightTownId}` : `${rightTownId}:${leftTownId}`;

export const createIntertownRoadPassState = (): IntertownRoadPassState => ({
  completedTownPairKeys: new Set<string>()
});

export const isIntertownTownPairComplete = (
  state: IntertownRoadPassState,
  leftTownId: number,
  rightTownId: number
): boolean => state.completedTownPairKeys.has(createIntertownTownPairKey(leftTownId, rightTownId));

export const markIntertownTownPairComplete = (
  state: IntertownRoadPassState,
  leftTownId: number,
  rightTownId: number
): void => {
  state.completedTownPairKeys.add(createIntertownTownPairKey(leftTownId, rightTownId));
};
