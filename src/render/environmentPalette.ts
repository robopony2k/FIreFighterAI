import type { RGB } from "./color.js";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const smoothstep = (edge0: number, edge1: number, x: number): number => {
  if (edge0 === edge1) {
    return x < edge0 ? 0 : 1;
  }
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const mixRgb = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t
});

const rgb = (r: number, g: number, b: number): RGB => ({ r, g, b });

const rgbaString = (color: RGB, alpha: number): string =>
  `rgba(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)}, ${alpha.toFixed(3)})`;

const rgbString = (color: RGB): string =>
  `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;

const blendSeason = (
  winter: RGB,
  spring: RGB,
  summer: RGB,
  autumn: RGB,
  weights: { winter: number; spring: number; summer: number; autumn: number }
): RGB => {
  const weightSum = Math.max(0.0001, weights.winter + weights.spring + weights.summer + weights.autumn);
  const wn = weights.winter / weightSum;
  const sp = weights.spring / weightSum;
  const su = weights.summer / weightSum;
  const au = weights.autumn / weightSum;
  return {
    r: winter.r * wn + spring.r * sp + summer.r * su + autumn.r * au,
    g: winter.g * wn + spring.g * sp + summer.g * su + autumn.g * au,
    b: winter.b * wn + spring.b * sp + summer.b * su + autumn.b * au
  };
};

const getSeasonWeights = (seasonT01: number): { winter: number; spring: number; summer: number; autumn: number } => {
  const t = ((seasonT01 % 1) + 1) % 1;
  const spring = smoothstep(0.18, 0.28, t) * (1 - smoothstep(0.42, 0.52, t));
  const summer = smoothstep(0.42, 0.52, t) * (1 - smoothstep(0.66, 0.76, t));
  const autumn = smoothstep(0.62, 0.7, t) * (1 - smoothstep(0.9, 0.98, t));
  const winterA = 1 - smoothstep(0.08, 0.18, t);
  const winterB = smoothstep(0.88, 0.96, t);
  const winter = clamp(winterA + winterB, 0, 1);
  return { winter, spring, summer, autumn };
};

export const computeFireLoad01 = (lastActiveFires: number, totalTiles: number): number => {
  const activeFires = Math.max(0, lastActiveFires);
  const activeDensity = activeFires / Math.max(1, totalTiles);
  const densityLoad01 = clamp((activeDensity - 0.0005) / 0.025, 0, 1);
  // Absolute-fire scaling keeps severe visual response reachable on larger maps:
  // ~8 fires starts the ramp, ~20 fires reaches full load.
  const absoluteLoad01 = smoothstep(8, 20, activeFires);
  return clamp(Math.max(densityLoad01, absoluteLoad01), 0, 1);
};

export type EnvironmentPaletteInput = {
  seasonT01: number;
  risk01: number;
  fireLoad01: number;
};

export type WaterEnvironmentPalette = {
  skyTop: RGB;
  skyHorizon: RGB;
  sun: RGB;
  oceanShallow: RGB;
  oceanDeep: RGB;
  riverShallow: RGB;
  riverDeep: RGB;
};

export type EnvironmentPalette = {
  atmosphere: {
    skyTop: RGB;
    skyHorizon: RGB;
    fogColor: RGB;
    fogDensityScale: number;
    hemisphereSky: RGB;
    hemisphereGround: RGB;
    keyLight: RGB;
    fillLight: RGB;
  };
  water: WaterEnvironmentPalette;
  hud: {
    dom: {
      overlayBackground: string;
      cardBackground: string;
      cardBorder: string;
      cardHeaderBackground: string;
      textPrimary: string;
      textMuted: string;
      buttonBackground: string;
      buttonHoverBackground: string;
      buttonBorder: string;
      buttonDisabledBackground: string;
      buttonDisabledBorder: string;
      accent: string;
      riskLowBackground: string;
      riskLowBorder: string;
      riskLowText: string;
      riskModerateBackground: string;
      riskModerateBorder: string;
      riskModerateText: string;
      riskHighBackground: string;
      riskHighBorder: string;
      riskHighText: string;
      riskExtremeBackground: string;
      riskExtremeBorder: string;
      riskExtremeText: string;
      infoBackground: string;
      infoBorder: string;
      infoText: string;
      chartBackground: string;
      chartBorder: string;
      minimapBackground: string;
      unitCardBackground: string;
      unitCardBorder: string;
    };
    canvas: {
      topBarBackground: string;
      topBarBorder: string;
      textPrimary: string;
      textMuted: string;
      speedButtonBackground: string;
      speedButtonBorder: string;
      slotCardBackground: string;
      slotCardBorder: string;
      slotHeaderBackground: string;
      slotHeaderBorder: string;
      slotHeaderText: string;
      toastInfoBackground: string;
      toastWarningBackground: string;
      toastErrorBackground: string;
      toastBorder: string;
      toastText: string;
      debugPanelBackground: string;
      debugPanelBorder: string;
      debugPanelText: string;
      chartCardBackground: string;
      chartCardBorder: string;
      chartBackground: string;
      chartBorder: string;
      chartBandColors: [string, string, string, string];
      chartSeasonColors: [string, string, string, string];
      chartLineCool: string;
      chartLineWarm: string;
      chartLineHot: string;
      chartGrid: string;
      chartLabel: string;
      minimapPanelBackground: string;
      minimapModeBackground: string;
      minimapModeBorder: string;
      minimapModeText: string;
      minimapBorder: string;
      minimapViewportStroke: string;
      minimapViewportFill: string;
      thermalLow: RGB;
      thermalMid: RGB;
      thermalHigh: RGB;
    };
  };
  signals: {
    winter01: number;
    spring01: number;
    summer01: number;
    autumn01: number;
    smoke01: number;
    denseSmoke01: number;
    fireGlow01: number;
    severeFire01: number;
    heavySmoke01: number;
    orangeGate01: number;
    orangeGlow01: number;
    risk01: number;
    fireLoad01: number;
  };
};

export const buildEnvironmentPalette = (input: EnvironmentPaletteInput): EnvironmentPalette => {
  const intensity = 0.65;
  const risk01 = clamp(input.risk01, 0, 1);
  const fireLoad01 = clamp(input.fireLoad01, 0, 1);
  const smoke01 = clamp(0.55 * risk01 + 0.45 * fireLoad01, 0, 1);
  const denseSmoke01 = smoothstep(0.52, 0.95, smoke01);
  const fireGlow01 = smoothstep(0.52, 1, clamp(0.72 * fireLoad01 + 0.28 * smoke01, 0, 1));
  const severeFire01 = smoothstep(0.58, 0.95, fireLoad01);
  const heavySmoke01 = smoothstep(0.48, 0.9, smoke01);
  const orangeGate01 = severeFire01 * heavySmoke01;
  // Use continuous scaling so high risk/smoke always contributes, while severe fire/smoke still adds extra lift.
  const orangeScale01 = clamp(0.46 * risk01 + 0.36 * smoke01 + 0.34 * fireLoad01, 0, 1);
  const orangeScaleBoost01 = smoothstep(0.22, 0.92, orangeScale01);
  const orangeGlow01 = clamp(0.12 * fireGlow01 + 0.76 * orangeScaleBoost01 + 0.2 * orangeGate01, 0, 1);
  const season = getSeasonWeights(input.seasonT01);

  const seasonSkyTop = blendSeason(
    rgb(46, 58, 78),
    rgb(68, 96, 123),
    rgb(92, 126, 148),
    rgb(80, 88, 102),
    season
  );
  const seasonSkyHorizon = blendSeason(
    rgb(100, 114, 128),
    rgb(118, 128, 136),
    rgb(135, 138, 136),
    rgb(132, 118, 106),
    season
  );
  const smokeSkyTop = rgb(70, 64, 58);
  const smokeSkyHorizon = rgb(129, 112, 90);
  const denseSkyTop = rgb(26, 26, 28);
  const denseSkyHorizon = rgb(73, 63, 52);
  const glowSkyTop = rgb(82, 60, 47);
  const glowSkyHorizon = rgb(192, 114, 58);
  const skyTopSmokeBlend = clamp((smoke01 * 0.78 + risk01 * 0.2) * intensity, 0, 1);
  const skyHorizonSmokeBlend = clamp((smoke01 * 0.9 + risk01 * 0.2) * intensity, 0, 1);
  const skyTopBase = mixRgb(seasonSkyTop, smokeSkyTop, skyTopSmokeBlend);
  const skyHorizonBase = mixRgb(seasonSkyHorizon, smokeSkyHorizon, skyHorizonSmokeBlend);
  const skyTopDense = mixRgb(skyTopBase, denseSkyTop, denseSmoke01 * 0.9);
  const skyHorizonDense = mixRgb(skyHorizonBase, denseSkyHorizon, denseSmoke01 * 0.68);
  const skyTopGlow = mixRgb(skyTopDense, glowSkyTop, fireGlow01 * 0.24);
  const skyHorizonGlow = mixRgb(skyHorizonDense, glowSkyHorizon, fireGlow01 * 0.62);
  const skyTop = mixRgb(skyTopGlow, rgb(95, 57, 36), orangeGlow01 * 0.34);
  const skyHorizon = mixRgb(skyHorizonGlow, rgb(226, 122, 52), orangeGlow01 * 0.78);

  const fogBase = mixRgb(
    skyHorizon,
    rgb(128, 92, 62),
    clamp(smoke01 * 0.68 + risk01 * 0.1 + fireGlow01 * 0.45, 0, 1)
  );
  const fogColor = mixRgb(fogBase, rgb(72, 63, 56), denseSmoke01 * 0.42);
  const fogDensityScale = clamp(
    0.92 +
      intensity *
        (0.3 * season.summer +
          0.42 * risk01 +
          0.78 * smoke01 +
          0.28 * denseSmoke01 -
          0.2 * season.spring -
          0.14 * season.winter),
    0.82,
    2.05
  );

  const hemisphereSky = mixRgb(skyTop, rgb(116, 104, 94), clamp(smoke01 * 0.22 + denseSmoke01 * 0.16, 0, 1));
  const seasonGround = blendSeason(
    rgb(82, 86, 92),
    rgb(86, 98, 90),
    rgb(99, 104, 90),
    rgb(106, 92, 78),
    season
  );
  const hemisphereGround = mixRgb(
    seasonGround,
    rgb(74, 66, 58),
    clamp((smoke01 * 0.58 + risk01 * 0.12 + denseSmoke01 * 0.22) * intensity, 0, 1)
  );
  const seasonKey = blendSeason(
    rgb(238, 228, 214),
    rgb(246, 228, 198),
    rgb(255, 228, 188),
    rgb(245, 215, 176),
    season
  );
  const keyLightSmoke = mixRgb(
    seasonKey,
    rgb(172, 136, 104),
    clamp(smoke01 * 0.68 + risk01 * 0.12 + denseSmoke01 * 0.24, 0, 1)
  );
  const keyLightWarm = mixRgb(keyLightSmoke, rgb(238, 149, 74), fireGlow01 * 0.42);
  const keyLight = mixRgb(keyLightWarm, rgb(255, 146, 62), orangeGlow01 * 0.55);
  const seasonFill = blendSeason(
    rgb(122, 140, 160),
    rgb(106, 142, 170),
    rgb(96, 136, 162),
    rgb(112, 126, 142),
    season
  );
  const fillLightBase = mixRgb(
    seasonFill,
    rgb(108, 100, 92),
    clamp((smoke01 * 0.56 + risk01 * 0.1 + denseSmoke01 * 0.16) * intensity, 0, 1)
  );
  const fillLight = mixRgb(fillLightBase, rgb(148, 106, 78), orangeGlow01 * 0.22);

  const seasonOceanShallow = blendSeason(
    rgb(86, 118, 146),
    rgb(70, 128, 166),
    rgb(78, 136, 164),
    rgb(92, 118, 136),
    season
  );
  const seasonOceanDeep = blendSeason(
    rgb(48, 76, 106),
    rgb(32, 88, 124),
    rgb(35, 92, 118),
    rgb(58, 72, 86),
    season
  );
  const seasonRiverShallow = blendSeason(
    rgb(93, 131, 162),
    rgb(76, 142, 178),
    rgb(92, 150, 174),
    rgb(104, 130, 147),
    season
  );
  const seasonRiverDeep = blendSeason(
    rgb(53, 88, 118),
    rgb(41, 106, 138),
    rgb(48, 112, 136),
    rgb(67, 83, 98),
    season
  );
  const smokeOceanShallow = rgb(82, 90, 84);
  const smokeOceanDeep = rgb(38, 44, 48);
  const runoffTintShallow = rgb(112, 101, 86);
  const runoffTintDeep = rgb(58, 53, 46);
  const smokeRiverShallow = rgb(114, 103, 88);
  const smokeRiverDeep = rgb(54, 58, 62);
  const oceanShallowSmoke = mixRgb(
    seasonOceanShallow,
    smokeOceanShallow,
    clamp((smoke01 * 0.52 + risk01 * 0.12 + denseSmoke01 * 0.2) * intensity, 0, 1)
  );
  const oceanShallow = mixRgb(oceanShallowSmoke, runoffTintShallow, fireGlow01 * 0.34);
  const oceanDeepSmoke = mixRgb(
    seasonOceanDeep,
    smokeOceanDeep,
    clamp((smoke01 * 0.72 + risk01 * 0.12 + denseSmoke01 * 0.2) * intensity, 0, 1)
  );
  const oceanDeep = mixRgb(oceanDeepSmoke, runoffTintDeep, fireGlow01 * 0.24);
  const riverShallowSmoke = mixRgb(
    seasonRiverShallow,
    smokeRiverShallow,
    clamp((smoke01 * 0.44 + risk01 * 0.08 + denseSmoke01 * 0.22) * intensity, 0, 1)
  );
  const riverShallow = mixRgb(riverShallowSmoke, rgb(122, 108, 89), fireGlow01 * 0.38);
  const riverDeepSmoke = mixRgb(
    seasonRiverDeep,
    smokeRiverDeep,
    clamp((smoke01 * 0.62 + risk01 * 0.08 + denseSmoke01 * 0.26) * intensity, 0, 1)
  );
  const riverDeep = mixRgb(riverDeepSmoke, rgb(68, 58, 48), fireGlow01 * 0.26);
  const seasonSun = blendSeason(
    rgb(244, 235, 214),
    rgb(255, 234, 201),
    rgb(255, 228, 188),
    rgb(244, 216, 180),
    season
  );
  const sunSmoked = mixRgb(seasonSun, rgb(198, 166, 132), clamp(smoke01 * 0.4 + denseSmoke01 * 0.24, 0, 1));
  const sunGlow = mixRgb(sunSmoked, rgb(247, 131, 56), fireGlow01 * 0.82);
  const sun = mixRgb(sunGlow, rgb(255, 118, 38), orangeGlow01 * 0.9);

  const panelBase = mixRgb(
    blendSeason(
      rgb(23, 25, 30),
      rgb(24, 28, 33),
      rgb(27, 26, 22),
      rgb(31, 25, 20),
      season
    ),
    rgb(36, 33, 30),
    clamp((smoke01 * 0.42 + denseSmoke01 * 0.2) * intensity, 0, 1)
  );
  const panelBorder = mixRgb(
    blendSeason(rgb(255, 221, 171), rgb(236, 213, 182), rgb(229, 208, 176), rgb(246, 199, 143), season),
    rgb(192, 173, 148),
    clamp(smoke01 * 0.48 * intensity, 0, 1)
  );
  const panelHeader = mixRgb(panelBase, panelBorder, 0.12);
  const buttonBase = mixRgb(panelHeader, rgb(60, 48, 36), 0.48);
  const buttonHover = mixRgb(buttonBase, rgb(84, 62, 44), 0.36);
  const accent = mixRgb(
    rgb(240, 179, 59),
    rgb(209, 74, 44),
    clamp(0.3 + risk01 * 0.45 + smoke01 * 0.2 + fireGlow01 * 0.12, 0, 1)
  );
  const textPrimary = mixRgb(
    blendSeason(rgb(240, 244, 250), rgb(240, 246, 238), rgb(252, 242, 222), rgb(252, 234, 209), season),
    rgb(224, 211, 193),
    clamp(smoke01 * 0.3 + denseSmoke01 * 0.08, 0, 1)
  );
  const textMuted = mixRgb(textPrimary, panelBorder, 0.48);

  const riskLowBase = mixRgb(rgb(43, 104, 140), rgb(59, 129, 166), season.spring * 0.25 + season.winter * 0.2);
  const riskModerateBase = mixRgb(rgb(90, 143, 78), rgb(124, 165, 92), season.spring * 0.35);
  const riskHighBase = mixRgb(rgb(240, 179, 59), rgb(231, 149, 65), season.summer * 0.25 + season.autumn * 0.2);
  const riskExtremeBase = mixRgb(rgb(209, 74, 44), rgb(182, 68, 56), season.autumn * 0.35 + smoke01 * 0.2);

  const dom = {
    overlayBackground:
      `radial-gradient(circle at 16% 18%, ${rgbaString(accent, 0.16)} 0%, transparent 58%), ` +
      `radial-gradient(circle at 84% 82%, ${rgbaString(fillLight, 0.12)} 0%, transparent 62%), ` +
      `linear-gradient(160deg, ${rgbaString(mixRgb(panelBase, rgb(6, 8, 11), 0.62), 0.92)} 0%, ` +
      `${rgbaString(mixRgb(panelBase, rgb(10, 11, 14), 0.52), 0.94)} 55%, ` +
      `${rgbaString(mixRgb(panelBase, rgb(26, 20, 16), 0.42), 0.9)} 100%)`,
    cardBackground: rgbaString(panelBase, 0.95),
    cardBorder: rgbaString(panelBorder, 0.28),
    cardHeaderBackground: rgbaString(panelHeader, 0.92),
    textPrimary: rgbString(textPrimary),
    textMuted: rgbaString(textMuted, 0.82),
    buttonBackground: rgbaString(buttonBase, 0.96),
    buttonHoverBackground: rgbaString(buttonHover, 0.98),
    buttonBorder: rgbaString(panelBorder, 0.3),
    buttonDisabledBackground: rgbaString(mixRgb(panelBase, rgb(24, 22, 22), 0.66), 0.92),
    buttonDisabledBorder: rgbaString(mixRgb(panelBorder, panelBase, 0.6), 0.2),
    buttonText: rgbString(textPrimary),
    accent: rgbString(accent),
    riskLowBackground: rgbaString(riskLowBase, 0.3),
    riskLowBorder: rgbaString(mixRgb(riskLowBase, rgb(180, 223, 255), 0.42), 0.58),
    riskLowText: rgbString(mixRgb(riskLowBase, rgb(222, 242, 255), 0.74)),
    riskModerateBackground: rgbaString(riskModerateBase, 0.28),
    riskModerateBorder: rgbaString(mixRgb(riskModerateBase, rgb(212, 239, 184), 0.42), 0.58),
    riskModerateText: rgbString(mixRgb(riskModerateBase, rgb(232, 247, 214), 0.74)),
    riskHighBackground: rgbaString(riskHighBase, 0.3),
    riskHighBorder: rgbaString(mixRgb(riskHighBase, rgb(255, 226, 165), 0.44), 0.62),
    riskHighText: rgbString(mixRgb(riskHighBase, rgb(255, 243, 213), 0.74)),
    riskExtremeBackground: rgbaString(riskExtremeBase, 0.34),
    riskExtremeBorder: rgbaString(mixRgb(riskExtremeBase, rgb(255, 191, 174), 0.44), 0.62),
    riskExtremeText: rgbString(mixRgb(riskExtremeBase, rgb(255, 225, 215), 0.72)),
    infoBackground: rgbaString(mixRgb(fillLight, panelBase, 0.58), 0.35),
    infoBorder: rgbaString(mixRgb(fillLight, rgb(165, 199, 229), 0.5), 0.46),
    infoText: rgbString(mixRgb(fillLight, rgb(219, 235, 248), 0.66)),
    chartBackground: rgbaString(mixRgb(panelBase, rgb(10, 11, 10), 0.5), 0.92),
    chartBorder: rgbaString(panelBorder, 0.28),
    minimapBackground: rgbaString(mixRgb(fillLight, panelBase, 0.7), 0.9),
    unitCardBackground: rgbaString(panelBase, 0.92),
    unitCardBorder: rgbaString(panelBorder, 0.25)
  };

  const canvas = {
    topBarBackground: rgbaString(mixRgb(panelBase, rgb(8, 10, 14), 0.48), 0.78),
    topBarBorder: rgbaString(panelBorder, 0.24),
    textPrimary: dom.textPrimary,
    textMuted: dom.textMuted,
    speedButtonBackground: rgbaString(mixRgb(fillLight, panelBase, 0.68), 0.9),
    speedButtonBorder: rgbaString(panelBorder, 0.28),
    slotCardBackground: rgbaString(mixRgb(textPrimary, rgb(255, 255, 255), 0.8), 0.9),
    slotCardBorder: rgbaString(mixRgb(panelBase, rgb(30, 30, 30), 0.52), 0.2),
    slotHeaderBackground: rgbaString(mixRgb(fillLight, rgb(8, 10, 14), 0.82), 0.1),
    slotHeaderBorder: rgbaString(mixRgb(panelBase, rgb(27, 27, 27), 0.45), 0.2),
    slotHeaderText: rgbaString(mixRgb(panelBase, rgb(27, 27, 27), 0.22), 0.82),
    toastInfoBackground: rgbaString(mixRgb(fillLight, rgb(40, 48, 60), 0.4), 0.92),
    toastWarningBackground: rgbaString(mixRgb(accent, rgb(191, 129, 36), 0.38), 0.92),
    toastErrorBackground: rgbaString(mixRgb(accent, rgb(176, 63, 46), 0.52), 0.92),
    toastBorder: rgbaString(panelBorder, 0.26),
    toastText: dom.textPrimary,
    debugPanelBackground: rgbaString(mixRgb(panelBase, rgb(0, 0, 0), 0.54), 0.78),
    debugPanelBorder: rgbaString(panelBorder, 0.26),
    debugPanelText: rgbString(mixRgb(textPrimary, rgb(230, 230, 230), 0.4)),
    chartCardBackground: rgbaString(mixRgb(textPrimary, rgb(255, 255, 255), 0.84), 0.92),
    chartCardBorder: rgbaString(mixRgb(panelBase, rgb(27, 27, 27), 0.5), 0.12),
    chartBackground: rgbaString(mixRgb(panelBase, rgb(27, 27, 27), 0.72), 0.06),
    chartBorder: rgbaString(mixRgb(panelBase, rgb(27, 27, 27), 0.46), 0.12),
    chartBandColors: [
      rgbaString(riskLowBase, 0.24),
      rgbaString(riskModerateBase, 0.22),
      rgbaString(riskHighBase, 0.28),
      rgbaString(riskExtremeBase, 0.3)
    ] as [string, string, string, string],
    chartSeasonColors: [
      rgbaString(mixRgb(riskLowBase, fillLight, 0.32), 0.12),
      rgbaString(mixRgb(riskModerateBase, fillLight, 0.25), 0.12),
      rgbaString(mixRgb(riskHighBase, accent, 0.22), 0.14),
      rgbaString(mixRgb(riskExtremeBase, accent, 0.18), 0.12)
    ] as [string, string, string, string],
    chartLineCool: rgbString(mixRgb(riskLowBase, rgb(43, 104, 140), 0.5)),
    chartLineWarm: rgbString(mixRgb(riskHighBase, rgb(240, 179, 59), 0.6)),
    chartLineHot: rgbString(mixRgb(riskExtremeBase, rgb(209, 74, 44), 0.6)),
    chartGrid: rgbaString(mixRgb(panelBase, rgb(27, 27, 27), 0.42), 0.26),
    chartLabel: rgbaString(mixRgb(panelBase, rgb(27, 27, 27), 0.24), 0.74),
    minimapPanelBackground: rgbaString(mixRgb(fillLight, rgb(10, 12, 16), 0.88), 0.08),
    minimapModeBackground: rgbaString(mixRgb(panelBase, rgb(8, 10, 14), 0.48), 0.76),
    minimapModeBorder: rgbaString(panelBorder, 0.26),
    minimapModeText: dom.textPrimary,
    minimapBorder: rgbaString(mixRgb(panelBase, rgb(27, 27, 27), 0.4), 0.35),
    minimapViewportStroke: rgbaString(mixRgb(fillLight, rgb(90, 205, 255), 0.38), 0.9),
    minimapViewportFill: rgbaString(mixRgb(fillLight, rgb(90, 205, 255), 0.26), 0.45),
    thermalLow: mixRgb(rgb(20, 20, 22), rgb(26, 30, 34), smoke01 * 0.35 + denseSmoke01 * 0.12),
    thermalMid: mixRgb(rgb(192, 70, 40), rgb(205, 96, 56), season.summer * 0.3 + smoke01 * 0.2 + fireGlow01 * 0.12),
    thermalHigh: mixRgb(rgb(242, 201, 76), rgb(238, 182, 95), smoke01 * 0.2 + season.autumn * 0.25 + fireGlow01 * 0.1)
  };

  return {
    atmosphere: {
      skyTop,
      skyHorizon,
      fogColor,
      fogDensityScale,
      hemisphereSky,
      hemisphereGround,
      keyLight,
      fillLight
    },
    water: {
      skyTop,
      skyHorizon,
      sun,
      oceanShallow,
      oceanDeep,
      riverShallow,
      riverDeep
    },
    hud: {
      dom,
      canvas
    },
    signals: {
      winter01: season.winter,
      spring01: season.spring,
      summer01: season.summer,
      autumn01: season.autumn,
      smoke01,
      denseSmoke01,
      fireGlow01,
      severeFire01,
      heavySmoke01,
      orangeGate01,
      orangeGlow01,
      risk01,
      fireLoad01
    }
  };
};
