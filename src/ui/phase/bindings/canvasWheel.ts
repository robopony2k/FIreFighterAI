export const wheelDeltaToZoomFactor = (deltaY: number, deltaMode: number): number => {
  const modeScale = deltaMode === 1 ? 22 : deltaMode === 2 ? 60 : 1;
  const scaledDelta = deltaY * modeScale;
  const clamped = Math.max(-160, Math.min(160, scaledDelta));
  return Math.exp(-clamped * 0.002);
};
