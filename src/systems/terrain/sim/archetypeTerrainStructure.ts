import { ISLAND_ARCHETYPE_DEFINITIONS } from "../../../mapgen/islandArchetypes.js";
import { fbmNoise, hash2D } from "../../../mapgen/noise.js";
import type { MapGenSettings } from "../../../mapgen/settings.js";

const TAU = Math.PI * 2;

type ArchetypeId = MapGenSettings["terrainArchetype"];

export type ArchetypeTerrainStructureSample = {
  primaryRidge: number;
  secondaryRidge: number;
  saddle: number;
  valleyCorridor: number;
  basinPocket: number;
  basinRim: number;
  spillNotch: number;
  riverSourcePreference: number;
  lakePocketPreference: number;
};

type BasinPocketPlan = {
  centerX: number;
  centerY: number;
  radiusX: number;
  radiusY: number;
  angle: number;
  spillAngle: number;
  strength: number;
};

export type ArchetypeTerrainStructurePlan = {
  archetype: ArchetypeId;
  seed: number;
  angle: number;
  cos: number;
  sin: number;
  ridgeOffset: number;
  ridgeCurvePhase: number;
  radialCenterX: number;
  radialCenterY: number;
  basinPockets: BasinPocketPlan[];
  tuning: typeof ISLAND_ARCHETYPE_DEFINITIONS[ArchetypeId]["watershedStructure"];
};

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const clamp01 = (value: number): number => clamp(value, 0, 1);
const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const angleDelta = (a: number, b: number): number => {
  let delta = (a - b) % TAU;
  if (delta > Math.PI) {
    delta -= TAU;
  } else if (delta < -Math.PI) {
    delta += TAU;
  }
  return delta;
};

const lineRidge = (along: number, across: number, width: number, length: number, curve: number): number => {
  const curvedAcross = across - curve;
  const cross = Math.exp(-(curvedAcross * curvedAcross) / Math.max(0.0001, width * width));
  return cross * smoothstep(length, length * 0.56, Math.abs(along));
};

const gaussian = (x: number, y: number, cx: number, cy: number, rx: number, ry: number): number => {
  const dx = (x - cx) / Math.max(0.0001, rx);
  const dy = (y - cy) / Math.max(0.0001, ry);
  return Math.exp(-(dx * dx + dy * dy));
};

const rotateLocal = (
  x: number,
  y: number,
  centerX: number,
  centerY: number,
  angle: number
): { x: number; y: number } => {
  const dx = x - centerX;
  const dy = y - centerY;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return {
    x: dx * cos + dy * sin,
    y: -dx * sin + dy * cos
  };
};

const createBasinPocket = (
  archetypeSeed: number,
  index: number,
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  angle: number,
  spillAngle: number,
  strength: number
): BasinPocketPlan => ({
  centerX: centerX + (hash2D(index, 101, archetypeSeed) - 0.5) * 0.08,
  centerY: centerY + (hash2D(index, 103, archetypeSeed) - 0.5) * 0.08,
  radiusX: radiusX * mix(0.86, 1.14, hash2D(index, 107, archetypeSeed)),
  radiusY: radiusY * mix(0.86, 1.14, hash2D(index, 109, archetypeSeed)),
  angle: angle + (hash2D(index, 113, archetypeSeed) - 0.5) * 0.38,
  spillAngle: spillAngle + (hash2D(index, 127, archetypeSeed) - 0.5) * 0.34,
  strength: strength * mix(0.84, 1.16, hash2D(index, 131, archetypeSeed))
});

const buildBasinPockets = (
  archetype: ArchetypeId,
  archetypeSeed: number,
  angle: number,
  settings: MapGenSettings
): BasinPocketPlan[] => {
  if (archetype === "NONE") {
    return [];
  }
  const basinStrength = clamp01(settings.basinStrength);
  const embayment = clamp01(settings.embayment);
  const anisotropy = clamp01(settings.anisotropy);
  const pockets: BasinPocketPlan[] = [];
  if (archetype === "LONG_SPINE") {
    const side = hash2D(3, 5, archetypeSeed) < 0.5 ? -1 : 1;
    pockets.push(
      createBasinPocket(archetypeSeed, 0, -0.34, side * 0.34, 0.22, 0.16, angle, angle + side * Math.PI * 0.55, 0.9),
      createBasinPocket(archetypeSeed, 1, 0.34, -side * 0.3, 0.24, 0.17, angle + 0.2, angle - side * Math.PI * 0.55, 0.78)
    );
  } else if (archetype === "TWIN_BAY") {
    pockets.push(
      createBasinPocket(archetypeSeed, 0, -0.18, 0.18, 0.26, 0.18, angle + 0.35, angle - Math.PI * 0.52, 0.86),
      createBasinPocket(archetypeSeed, 1, 0.22, -0.16, 0.25, 0.18, angle - 0.28, angle + Math.PI * 0.48, 0.82)
    );
    if (embayment > 0.68) {
      pockets.push(createBasinPocket(archetypeSeed, 2, 0.02, 0.02, 0.2, 0.15, angle, angle + Math.PI, 0.62));
    }
  } else if (archetype === "MASSIF") {
    const coreOffset = mix(0.02, 0.14, clamp01(settings.asymmetry));
    const coreAngle = angle + hash2D(7, 11, archetypeSeed) * TAU;
    pockets.push(
      createBasinPocket(
        archetypeSeed,
        0,
        Math.cos(coreAngle) * coreOffset,
        Math.sin(coreAngle) * coreOffset,
        0.2,
        0.16,
        angle + Math.PI * 0.2,
        coreAngle + Math.PI * 0.85,
        0.72
      )
    );
    const foothillCount = basinStrength > 0.5 ? 3 : 2;
    for (let index = 0; index < foothillCount; index += 1) {
      const theta = angle + (index / foothillCount) * TAU + (hash2D(index, 17, archetypeSeed) - 0.5) * 0.56;
      const radius = mix(0.4, 0.58, hash2D(index, 19, archetypeSeed));
      pockets.push(
        createBasinPocket(
          archetypeSeed,
          index + 1,
          Math.cos(theta) * radius,
          Math.sin(theta) * radius,
          mix(0.18, 0.25, basinStrength),
          mix(0.13, 0.2, 1 - anisotropy * 0.35),
          theta + Math.PI * 0.5,
          theta,
          mix(0.68, 0.94, basinStrength)
        )
      );
    }
  } else if (archetype === "SHELF") {
    pockets.push(createBasinPocket(archetypeSeed, 0, -0.18, 0.18, 0.28, 0.18, angle, angle + Math.PI * 0.7, 0.42));
  }
  return pockets;
};

export const buildArchetypeStructurePlan = (
  seed: number,
  settings: MapGenSettings
): ArchetypeTerrainStructurePlan => {
  const archetype = settings.terrainArchetype;
  const definition = ISLAND_ARCHETYPE_DEFINITIONS[archetype];
  const archetypeSeed = seed + Math.round(definition.ridgeAlignment * 10_000) + Math.round(definition.embayment * 20_000);
  const angle = hash2D(211, 223, archetypeSeed) * TAU;
  return {
    archetype,
    seed: archetypeSeed,
    angle,
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    ridgeOffset: (hash2D(227, 229, archetypeSeed) - 0.5) * mix(0.02, 0.24, settings.asymmetry),
    ridgeCurvePhase: hash2D(233, 239, archetypeSeed) * TAU,
    radialCenterX: (hash2D(241, 251, archetypeSeed) - 0.5) * mix(0.03, 0.18, settings.asymmetry),
    radialCenterY: (hash2D(257, 263, archetypeSeed) - 0.5) * mix(0.03, 0.18, settings.asymmetry),
    basinPockets: buildBasinPockets(archetype, archetypeSeed, angle, settings),
    tuning: definition.watershedStructure
  };
};

const sampleBasinPocket = (
  pocket: BasinPocketPlan,
  px: number,
  py: number,
  seed: number
): Pick<ArchetypeTerrainStructureSample, "basinPocket" | "basinRim" | "spillNotch" | "valleyCorridor" | "lakePocketPreference"> => {
  const local = rotateLocal(px, py, pocket.centerX, pocket.centerY, pocket.angle);
  const rx = Math.max(0.001, pocket.radiusX);
  const ry = Math.max(0.001, pocket.radiusY);
  const normalized = Math.hypot(local.x / rx, local.y / ry);
  const theta = Math.atan2(py - pocket.centerY, px - pocket.centerX);
  const notch = Math.exp(-(angleDelta(theta, pocket.spillAngle) ** 2) / 0.09);
  const irregularity = mix(0.82, 1.16, fbmNoise((px + 2.3) * 2.6, (py - 1.7) * 2.6, seed + 331, 2));
  const pocketField = Math.exp(-(normalized * normalized) * mix(1.18, 1.55, irregularity)) * pocket.strength;
  const ringCenter = mix(0.92, 1.08, irregularity);
  const ringWidth = mix(0.14, 0.24, irregularity);
  const rimField = Math.exp(-((normalized - ringCenter) ** 2) / Math.max(0.0001, ringWidth * ringWidth)) * pocket.strength;
  const spillField = rimField * notch;
  const dirX = Math.cos(pocket.spillAngle);
  const dirY = Math.sin(pocket.spillAngle);
  const dx = px - pocket.centerX;
  const dy = py - pocket.centerY;
  const projection = dx * dirX + dy * dirY;
  const perpendicular = Math.abs(-dx * dirY + dy * dirX);
  const corridor = Math.exp(-(perpendicular * perpendicular) / 0.018)
    * smoothstep(0.02, Math.max(rx, ry) * 0.9, projection)
    * smoothstep(Math.max(rx, ry) * 2.8, Math.max(rx, ry) * 0.9, projection)
    * pocket.strength;
  return {
    basinPocket: clamp01(pocketField),
    basinRim: clamp01(rimField * (1 - notch * 0.78)),
    spillNotch: clamp01(spillField),
    valleyCorridor: clamp01(corridor + spillField * 0.45),
    lakePocketPreference: clamp01(pocketField * (1 - notch * 0.35))
  };
};

export const sampleArchetypeStructure = (
  plan: ArchetypeTerrainStructurePlan,
  nx: number,
  ny: number
): ArchetypeTerrainStructureSample => {
  const px = nx * 2 - 1;
  const py = ny * 2 - 1;
  const along = px * plan.cos + py * plan.sin;
  const across = -px * plan.sin + py * plan.cos - plan.ridgeOffset;
  const curve = Math.sin(along * TAU * 0.42 + plan.ridgeCurvePhase) * 0.08;
  const warpedAcross = across - curve;
  const radialDx = px - plan.radialCenterX;
  const radialDy = py - plan.radialCenterY;
  const radial = Math.hypot(radialDx, radialDy);
  const theta = Math.atan2(radialDy, radialDx);
  const terrainNoise = fbmNoise((px + 1.6) * 3.2, (py - 0.9) * 3.2, plan.seed + 401, 2);
  const irregular = mix(0.86, 1.18, terrainNoise);

  let primaryRidge = 0;
  let secondaryRidge = 0;
  let saddle = 0;
  let valleyCorridor = 0;
  let riverSourcePreference = 0;

  if (plan.archetype === "LONG_SPINE") {
    primaryRidge = lineRidge(along, warpedAcross, 0.08 * irregular, 0.98, 0);
    secondaryRidge = Math.max(
      lineRidge(along, warpedAcross - 0.32, 0.1, 0.84, 0),
      lineRidge(along, warpedAcross + 0.32, 0.1, 0.84, 0)
    );
    valleyCorridor = Math.max(
      lineRidge(along, warpedAcross - 0.22, 0.12, 0.92, 0),
      lineRidge(along, warpedAcross + 0.24, 0.12, 0.92, 0)
    );
    riverSourcePreference = primaryRidge * 0.78 + secondaryRidge * 0.28;
  } else if (plan.archetype === "TWIN_BAY") {
    const bayWrapA = gaussian(along, across, -0.42, 0.22, 0.34, 0.22);
    const bayWrapB = gaussian(along, across, 0.42, -0.22, 0.34, 0.22);
    const inlandShoulder = lineRidge(along, warpedAcross, 0.24, 0.82, Math.sin(along * 3.6 + plan.ridgeCurvePhase) * 0.08);
    primaryRidge = Math.max(bayWrapA, bayWrapB) * 0.82;
    secondaryRidge = Math.max(inlandShoulder, Math.min(bayWrapA, bayWrapB) * 1.25);
    saddle = gaussian(along, across, 0.02, 0, 0.42, 0.22);
    valleyCorridor = Math.max(
      lineRidge(along, across, 0.18, 0.78, 0),
      saddle * 0.7
    );
    riverSourcePreference = primaryRidge * 0.5 + secondaryRidge * 0.38;
  } else if (plan.archetype === "MASSIF") {
    const spoke = Math.max(0, Math.cos((theta - plan.angle) * 5 + plan.ridgeCurvePhase));
    const radialBand = smoothstep(0.12, 0.42, radial) * smoothstep(0.96, 0.48, radial);
    primaryRidge = Math.pow(clamp01(1 - radial / 0.58), 1.35) * 0.55 + spoke * radialBand * 0.58;
    secondaryRidge = Math.max(0, Math.cos((theta - plan.angle) * 3 - plan.ridgeCurvePhase)) * radialBand * 0.48;
    valleyCorridor = Math.max(0, -Math.cos((theta - plan.angle) * 5 + plan.ridgeCurvePhase)) * radialBand * 0.64;
    riverSourcePreference = smoothstep(0.18, 0.62, radial) * Math.max(primaryRidge, secondaryRidge);
  } else if (plan.archetype === "SHELF") {
    primaryRidge = lineRidge(along, warpedAcross, 0.18, 0.68, 0) * 0.28;
    secondaryRidge = lineRidge(along, warpedAcross - 0.28, 0.16, 0.62, 0) * 0.18;
    valleyCorridor = lineRidge(along, warpedAcross + 0.24, 0.18, 0.68, 0) * 0.36;
    riverSourcePreference = primaryRidge * 0.35;
  }

  let basinPocket = 0;
  let basinRim = 0;
  let spillNotch = 0;
  let lakePocketPreference = 0;
  for (let index = 0; index < plan.basinPockets.length; index += 1) {
    const sampled = sampleBasinPocket(plan.basinPockets[index]!, px, py, plan.seed + index * 53);
    basinPocket = Math.max(basinPocket, sampled.basinPocket);
    basinRim = Math.max(basinRim, sampled.basinRim);
    spillNotch = Math.max(spillNotch, sampled.spillNotch);
    valleyCorridor = Math.max(valleyCorridor, sampled.valleyCorridor);
    lakePocketPreference = Math.max(lakePocketPreference, sampled.lakePocketPreference);
  }

  return {
    primaryRidge: clamp01(primaryRidge * plan.tuning.primaryRidge),
    secondaryRidge: clamp01(secondaryRidge * plan.tuning.secondaryRidge),
    saddle: clamp01(saddle),
    valleyCorridor: clamp01(valleyCorridor * plan.tuning.valleyCorridor),
    basinPocket: clamp01(basinPocket * plan.tuning.basinPocket),
    basinRim: clamp01(basinRim * plan.tuning.basinRim),
    spillNotch: clamp01(spillNotch * plan.tuning.spillNotch),
    riverSourcePreference: clamp01(riverSourcePreference * plan.tuning.riverSource),
    lakePocketPreference: clamp01(lakePocketPreference * plan.tuning.lakePocket)
  };
};
