const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export type TerrainWaterDebugControls = {
  showRiver: boolean;
  riverFlowSpeedScale: number;
  riverNormalStrengthScale: number;
  riverFoamScale: number;
  riverSpecularScale: number;
  showWaterfalls: boolean;
  waterfallWidthScale: number;
  waterfallOpacityScale: number;
  waterfallFoamScale: number;
  waterfallMistScale: number;
  waterfallSpeedScale: number;
};

export const DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS: TerrainWaterDebugControls = {
  showRiver: true,
  riverFlowSpeedScale: 1,
  riverNormalStrengthScale: 1,
  riverFoamScale: 1,
  riverSpecularScale: 1,
  showWaterfalls: true,
  waterfallWidthScale: 1,
  waterfallOpacityScale: 1,
  waterfallFoamScale: 1,
  waterfallMistScale: 1,
  waterfallSpeedScale: 1
};

export const normalizeTerrainWaterDebugControls = (
  controls: Partial<TerrainWaterDebugControls> | undefined
): TerrainWaterDebugControls => ({
  showRiver: controls?.showRiver ?? DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS.showRiver,
  riverFlowSpeedScale: clamp(
    controls?.riverFlowSpeedScale ?? DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS.riverFlowSpeedScale,
    0.25,
    2.5
  ),
  riverNormalStrengthScale: clamp(
    controls?.riverNormalStrengthScale ?? DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS.riverNormalStrengthScale,
    0.25,
    2.5
  ),
  riverFoamScale: clamp(
    controls?.riverFoamScale ?? DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS.riverFoamScale,
    0,
    2.5
  ),
  riverSpecularScale: clamp(
    controls?.riverSpecularScale ?? DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS.riverSpecularScale,
    0,
    2.5
  ),
  showWaterfalls: controls?.showWaterfalls ?? DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS.showWaterfalls,
  waterfallWidthScale: clamp(
    controls?.waterfallWidthScale ?? DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS.waterfallWidthScale,
    0.5,
    2
  ),
  waterfallOpacityScale: clamp(
    controls?.waterfallOpacityScale ?? DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS.waterfallOpacityScale,
    0.2,
    2
  ),
  waterfallFoamScale: clamp(
    controls?.waterfallFoamScale ?? DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS.waterfallFoamScale,
    0,
    2.5
  ),
  waterfallMistScale: clamp(
    controls?.waterfallMistScale ?? DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS.waterfallMistScale,
    0,
    2.5
  ),
  waterfallSpeedScale: clamp(
    controls?.waterfallSpeedScale ?? DEFAULT_TERRAIN_WATER_DEBUG_CONTROLS.waterfallSpeedScale,
    0.25,
    2.5
  )
});
