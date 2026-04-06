const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));

export type OceanWaterDebugControls = {
  showOcean: boolean;
  enableOrganicEdge: boolean;
  enableShorePulses: boolean;
  enableTroughClamp: boolean;
  enableSwashMotion: boolean;
  enableSwashSheet: boolean;
  enableShoreWaveModulation: boolean;
  shoreSwashStart: number;
  shoreSwashEnd: number;
  shoreShoalEnd: number;
  organicEdgeInset: number;
  swashPushMax: number;
  swashPushFeather: number;
  swashCoverageMin: number;
  swashCoverageFadeEnd: number;
  shoreWaveAmpMinScale: number;
  shoreWaveLengthMinScale: number;
  waveAmpScale: number;
  waveLengthScale: number;
  shoreFoamScale: number;
};

export const DEFAULT_OCEAN_WATER_DEBUG_CONTROLS: OceanWaterDebugControls = {
  showOcean: true,
  enableOrganicEdge: true,
  enableShorePulses: true,
  enableTroughClamp: true,
  enableSwashMotion: true,
  enableSwashSheet: true,
  enableShoreWaveModulation: true,
  shoreSwashStart: 0,
  shoreSwashEnd: 0.364,
  shoreShoalEnd: 0.46,
  organicEdgeInset: 0.22,
  swashPushMax: 0.28,
  swashPushFeather: 0.042,
  swashCoverageMin: 0.98,
  swashCoverageFadeEnd: 1,
  shoreWaveAmpMinScale: 1,
  shoreWaveLengthMinScale: 0.2,
  waveAmpScale: 0.95,
  waveLengthScale: 0.8,
  shoreFoamScale: 1.91
};

export const normalizeOceanWaterDebugControls = (
  controls: Partial<OceanWaterDebugControls> | undefined
): OceanWaterDebugControls => {
  const shoreSwashStart = clamp(
    controls?.shoreSwashStart ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.shoreSwashStart,
    0,
    0.12
  );
  const shoreSwashEnd = clamp(
    controls?.shoreSwashEnd ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.shoreSwashEnd,
    shoreSwashStart + 0.01,
    0.45
  );
  const shoreShoalEnd = clamp(
    controls?.shoreShoalEnd ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.shoreShoalEnd,
    shoreSwashEnd + 0.01,
    0.8
  );
  const swashCoverageMin = clamp(
    controls?.swashCoverageMin ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.swashCoverageMin,
    0,
    1
  );
  const swashCoverageFadeEnd = clamp(
    controls?.swashCoverageFadeEnd ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.swashCoverageFadeEnd,
    swashCoverageMin,
    1
  );
  return {
    showOcean: controls?.showOcean ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.showOcean,
    enableOrganicEdge: controls?.enableOrganicEdge ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.enableOrganicEdge,
    enableShorePulses: controls?.enableShorePulses ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.enableShorePulses,
    enableTroughClamp: controls?.enableTroughClamp ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.enableTroughClamp,
    enableSwashMotion: controls?.enableSwashMotion ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.enableSwashMotion,
    enableSwashSheet: controls?.enableSwashSheet ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.enableSwashSheet,
    enableShoreWaveModulation:
      controls?.enableShoreWaveModulation ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.enableShoreWaveModulation,
    shoreSwashStart,
    shoreSwashEnd,
    shoreShoalEnd,
    organicEdgeInset: clamp(
      controls?.organicEdgeInset ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.organicEdgeInset,
      0,
      0.22
    ),
    swashPushMax: clamp(
      controls?.swashPushMax ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.swashPushMax,
      0,
      0.28
    ),
    swashPushFeather: clamp(
      controls?.swashPushFeather ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.swashPushFeather,
      0.01,
      0.2
    ),
    swashCoverageMin,
    swashCoverageFadeEnd,
    shoreWaveAmpMinScale: clamp(
      controls?.shoreWaveAmpMinScale ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.shoreWaveAmpMinScale,
      0.05,
      1
    ),
    shoreWaveLengthMinScale: clamp(
      controls?.shoreWaveLengthMinScale ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.shoreWaveLengthMinScale,
      0.2,
      1
    ),
    waveAmpScale: clamp(
      controls?.waveAmpScale ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.waveAmpScale,
      0,
      2.5
    ),
    waveLengthScale: clamp(
      controls?.waveLengthScale ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.waveLengthScale,
      0.5,
      2
    ),
    shoreFoamScale: clamp(
      controls?.shoreFoamScale ?? DEFAULT_OCEAN_WATER_DEBUG_CONTROLS.shoreFoamScale,
      0,
      2.5
    )
  };
};
