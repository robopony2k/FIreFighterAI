import type { Grid, Point } from "../core/types.js";

export interface RenderState {
  renderFireSmooth: Float32Array;
  lastRenderTime: number;
  fireAnimationTimeMs: number;
  zoom: number;
  cameraCenter: Point;
  renderTrees: boolean;
  renderEffects: boolean;
}

export const createRenderState = (grid: Grid): RenderState => ({
  renderFireSmooth: new Float32Array(grid.totalTiles),
  lastRenderTime: 0,
  fireAnimationTimeMs: 0,
  zoom: 1,
  cameraCenter: { x: 0, y: 0 },
  renderTrees: true,
  renderEffects: true
});

export const syncRenderState = (state: RenderState, grid: Grid): void => {
  if (state.renderFireSmooth.length !== grid.totalTiles) {
    state.renderFireSmooth = new Float32Array(grid.totalTiles);
  }
};
