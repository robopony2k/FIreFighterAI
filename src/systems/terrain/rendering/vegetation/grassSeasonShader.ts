export const GRASS_WINTER_GROWTH = 0.55;
export const GRASS_SPRING_GROWTH = 0.86;
export const GRASS_SUMMER_GROWTH = 1.0;
export const GRASS_AUTUMN_GROWTH = 0.78;
export const GRASS_CLIMATE_DRYNESS_WEIGHT = 0.72;

const wrap01 = (value: number): number => ((value % 1) + 1) % 1;

export const resolveCampaignGrassSeasonGrowth = (seasonT01: number): number => {
  const phase = wrap01(Number.isFinite(seasonT01) ? seasonT01 : 0) * 4;
  if (phase < 1) return GRASS_WINTER_GROWTH + (GRASS_SPRING_GROWTH - GRASS_WINTER_GROWTH) * phase;
  if (phase < 2) return GRASS_SPRING_GROWTH + (GRASS_SUMMER_GROWTH - GRASS_SPRING_GROWTH) * (phase - 1);
  if (phase < 3) return GRASS_SUMMER_GROWTH + (GRASS_AUTUMN_GROWTH - GRASS_SUMMER_GROWTH) * (phase - 2);
  return GRASS_AUTUMN_GROWTH + (GRASS_WINTER_GROWTH - GRASS_AUTUMN_GROWTH) * (phase - 3);
};

export const resolveCampaignGrassDryness = (localDryness: number, climateDryness: number): number => {
  const local = Math.max(0, Math.min(1, Number.isFinite(localDryness) ? localDryness : 0.5));
  const climate = Math.max(0, Math.min(1, Number.isFinite(climateDryness) ? climateDryness : 0.5));
  return local * (1 - GRASS_CLIMATE_DRYNESS_WEIGHT) + climate * GRASS_CLIMATE_DRYNESS_WEIGHT;
};

export const grassSeasonShader = `
  float campaignGrassSeasonGrowth(float seasonT01) {
    float phase = fract(seasonT01) * 4.0;
    if (phase < 1.0) return mix(${GRASS_WINTER_GROWTH.toFixed(2)}, ${GRASS_SPRING_GROWTH.toFixed(2)}, phase);
    if (phase < 2.0) return mix(${GRASS_SPRING_GROWTH.toFixed(2)}, ${GRASS_SUMMER_GROWTH.toFixed(2)}, phase - 1.0);
    if (phase < 3.0) return mix(${GRASS_SUMMER_GROWTH.toFixed(2)}, ${GRASS_AUTUMN_GROWTH.toFixed(2)}, phase - 2.0);
    return mix(${GRASS_AUTUMN_GROWTH.toFixed(2)}, ${GRASS_WINTER_GROWTH.toFixed(2)}, phase - 3.0);
  }

  float campaignGrassDryness(float localDryness) {
    return clamp(mix(localDryness, uClimateDryness, ${GRASS_CLIMATE_DRYNESS_WEIGHT.toFixed(2)}), 0.0, 1.0);
  }
`;
