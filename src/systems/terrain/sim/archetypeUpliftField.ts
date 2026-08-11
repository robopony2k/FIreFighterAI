import { fbmNoise, hash2D } from "../../../mapgen/noise.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";

const TAU = Math.PI * 2;

export type ArchetypeUpliftPlan = {
  archetype: MapGenSettings["terrainArchetype"];
  seed: number;
  cos: number;
  sin: number;
  centerX: number;
  centerY: number;
  curvePhase: number;
  asymmetry: number;
  anisotropy: number;
};

export type ArchetypeUpliftSample = {
  uplift: number;
  basinPreference: number;
};

export type ShapedArchetypeUpliftSample = {
  uplift: number;
  basinPreference: number;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) return value < edge0 ? 0 : 1;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const gaussian = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): number => {
  const dx = (x - cx) / Math.max(0.001, rx);
  const dy = (y - cy) / Math.max(0.001, ry);
  return Math.exp(-(dx * dx + dy * dy));
};

export const buildArchetypeUpliftPlan = (
  seed: number,
  settings: MapGenSettings
): ArchetypeUpliftPlan => {
  const archetypeSeed = seed + Math.round(settings.ridgeAlignment * 10_000) + 53_111;
  const angle = hash2D(211, 223, archetypeSeed) * TAU;
  return {
    archetype: settings.terrainArchetype,
    seed: archetypeSeed,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    centerX: (hash2D(227, 229, archetypeSeed) - 0.5) * mix(0.02, 0.2, settings.asymmetry),
    centerY: (hash2D(233, 239, archetypeSeed) - 0.5) * mix(0.02, 0.2, settings.asymmetry),
    curvePhase: hash2D(241, 251, archetypeSeed) * TAU,
    asymmetry: clamp01(settings.asymmetry),
    anisotropy: clamp01(settings.anisotropy)
  };
};

export const shapeArchetypeUpliftSample = (
  sample: ArchetypeUpliftSample,
  settings: MapGenSettings
): ShapedArchetypeUpliftSample => {
  const maxHeightPressure = clamp01(settings.maxHeight / 1.5);
  const upliftPressure = clamp01(
    settings.relief * 0.58
    + settings.uplandDistribution * 0.22
    + maxHeightPressure * 0.2
  );
  const upliftScale = mix(0.58, 1, upliftPressure);
  const upliftExponent = mix(1.28, 0.72, settings.uplandDistribution);
  const archetypeBasinScale = settings.terrainArchetype === "TWIN_BAY" ? 0.8 : 1;
  const basinScale = mix(0.45, 1, settings.basinStrength) * archetypeBasinScale;
  return {
    uplift: Math.pow(clamp01(sample.uplift), upliftExponent) * upliftScale,
    basinPreference: clamp01(clamp01(sample.basinPreference) * basinScale)
  };
};

export const sampleArchetypeUplift = (
  plan: ArchetypeUpliftPlan,
  nx: number,
  ny: number
): ArchetypeUpliftSample => {
  if (plan.archetype === "NONE") return { uplift: 0, basinPreference: 0 };

  const px = nx * 2 - 1 - plan.centerX;
  const py = ny * 2 - 1 - plan.centerY;
  const along = px * plan.cos + py * plan.sin;
  const across = -px * plan.sin + py * plan.cos;
  const broadNoise = fbmNoise((px + 1.7) * 1.65, (py - 0.8) * 1.65, plan.seed + 401, 2);
  const irregularity = mix(0.88, 1.12, broadNoise);

  if (plan.archetype === "LONG_SPINE") {
    const curve = Math.sin(along * TAU * 0.34 + plan.curvePhase) * mix(0.035, 0.11, plan.asymmetry);
    const width = mix(0.42, 0.28, plan.anisotropy) * irregularity;
    const cross = Math.exp(-((across - curve) * (across - curve)) / Math.max(0.001, width * width));
    const taper = smoothstep(1.08, 0.64, Math.abs(along));
    const shoulderA = gaussian(along, across, -0.36, 0.2, 0.34, 0.42);
    const shoulderB = gaussian(along, across, 0.38, -0.18, 0.36, 0.4);
    return {
      uplift: clamp01(cross * taper * 0.86 + Math.max(shoulderA, shoulderB) * 0.22),
      basinPreference: clamp01(Math.max(
        gaussian(along, across, -0.34, 0.48, 0.28, 0.22),
        gaussian(along, across, 0.36, -0.44, 0.3, 0.24)
      ))
    };
  }

  if (plan.archetype === "MASSIF") {
    const radial = Math.hypot(px / irregularity, py * irregularity);
    const core = Math.pow(clamp01(1 - radial / 0.82), 1.35);
    const theta = Math.atan2(py, px);
    const broadLobes = (Math.cos(theta * 3 + plan.curvePhase) * 0.5 + 0.5)
      * smoothstep(0.12, 0.38, radial)
      * smoothstep(0.92, 0.46, radial);
    return {
      uplift: clamp01(core * 0.88 + broadLobes * 0.24),
      basinPreference: clamp01(
        gaussian(px, py, 0.38, 0.18, 0.29, 0.24)
        + gaussian(px, py, -0.34, -0.24, 0.27, 0.22)
      )
    };
  }

  if (plan.archetype === "TWIN_BAY") {
    const lobeA = gaussian(along, across, -0.42, 0.2, 0.46, 0.36);
    const lobeB = gaussian(along, across, 0.42, -0.2, 0.46, 0.36);
    const bridge = gaussian(along, across, 0, 0, 0.72, 0.3) * 0.22;
    return {
      uplift: clamp01(Math.max(lobeA, lobeB) * 0.84 + bridge),
      basinPreference: clamp01(gaussian(along, across, 0, 0, 0.31, 0.2))
    };
  }

  const shelfRise = gaussian(along, across, -0.2, 0.08, 0.9, 0.62);
  const tilt = clamp01(0.5 + across * 0.35);
  return {
    uplift: clamp01(shelfRise * mix(0.32, 0.5, tilt)),
    basinPreference: clamp01(gaussian(along, across, 0.24, -0.12, 0.42, 0.3) * 0.45)
  };
};
