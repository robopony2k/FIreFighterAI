export type PortraitFlameDynamics = Readonly<{
  flameHeight: number;
  emitterCount: number;
  heat: number;
  opacity: number;
  turbulence: number;
  motionRate: number;
  gust: number;
  glowStrength: number;
  wallBlend: number;
  sparkRate: number;
  sparkSpeed: number;
  sparkLifetime: number;
}>;

export const DEFAULT_PORTRAIT_FLAME_FEROCITY = 0.5;

const PORTRAIT_FLAME_PROFILES: readonly Readonly<{
  ferocity: number;
  dynamics: PortraitFlameDynamics;
}>[] = [
  {
    ferocity: 0,
    dynamics: {
      flameHeight: 0.25,
      emitterCount: 0,
      heat: 0.5,
      opacity: 0,
      turbulence: 0.45,
      motionRate: 0.5,
      gust: 0.35,
      glowStrength: 0.16,
      wallBlend: 0,
      sparkRate: 18,
      sparkSpeed: 0.7,
      sparkLifetime: 1.25
    }
  },
  {
    ferocity: 0.5,
    dynamics: {
      flameHeight: 0.5,
      emitterCount: 4,
      heat: 0.72,
      opacity: 0.75,
      turbulence: 0.8,
      motionRate: 0.85,
      gust: 0.75,
      glowStrength: 0.28,
      wallBlend: 0.28,
      sparkRate: 22,
      sparkSpeed: 0.9,
      sparkLifetime: 1.25
    }
  },
  {
    ferocity: 0.75,
    dynamics: {
      flameHeight: 0.75,
      emitterCount: 6,
      heat: 0.88,
      opacity: 0.9,
      turbulence: 1.1,
      motionRate: 1.15,
      gust: 1.2,
      glowStrength: 0.44,
      wallBlend: 0.62,
      sparkRate: 32,
      sparkSpeed: 1.15,
      sparkLifetime: 1.35
    }
  },
  {
    ferocity: 1,
    dynamics: {
      flameHeight: 1,
      emitterCount: 8,
      heat: 1,
      opacity: 1,
      turbulence: 1.35,
      motionRate: 1.5,
      gust: 1.65,
      glowStrength: 0.62,
      wallBlend: 1,
      sparkRate: 46,
      sparkSpeed: 1.45,
      sparkLifetime: 1.45
    }
  }
];

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));
const lerp = (from: number, to: number, amount: number): number => from + (to - from) * amount;

export const normalizePortraitFlameFerocity = (ferocity: number): number =>
  Number.isFinite(ferocity) ? clamp01(ferocity) : DEFAULT_PORTRAIT_FLAME_FEROCITY;

const interpolateDynamics = (
  from: PortraitFlameDynamics,
  to: PortraitFlameDynamics,
  amount: number
): PortraitFlameDynamics => ({
  flameHeight: lerp(from.flameHeight, to.flameHeight, amount),
  emitterCount: Math.round(lerp(from.emitterCount, to.emitterCount, amount)),
  heat: lerp(from.heat, to.heat, amount),
  opacity: lerp(from.opacity, to.opacity, amount),
  turbulence: lerp(from.turbulence, to.turbulence, amount),
  motionRate: lerp(from.motionRate, to.motionRate, amount),
  gust: lerp(from.gust, to.gust, amount),
  glowStrength: lerp(from.glowStrength, to.glowStrength, amount),
  wallBlend: lerp(from.wallBlend, to.wallBlend, amount),
  sparkRate: lerp(from.sparkRate, to.sparkRate, amount),
  sparkSpeed: lerp(from.sparkSpeed, to.sparkSpeed, amount),
  sparkLifetime: lerp(from.sparkLifetime, to.sparkLifetime, amount)
});

export const resolvePortraitFlameDynamics = (ferocity: number): PortraitFlameDynamics => {
  const normalized = normalizePortraitFlameFerocity(ferocity);
  for (let index = 1; index < PORTRAIT_FLAME_PROFILES.length; index += 1) {
    const upper = PORTRAIT_FLAME_PROFILES[index]!;
    if (normalized > upper.ferocity) {
      continue;
    }
    const lower = PORTRAIT_FLAME_PROFILES[index - 1]!;
    const span = upper.ferocity - lower.ferocity;
    return interpolateDynamics(lower.dynamics, upper.dynamics, (normalized - lower.ferocity) / span);
  }
  return { ...PORTRAIT_FLAME_PROFILES[PORTRAIT_FLAME_PROFILES.length - 1]!.dynamics };
};
