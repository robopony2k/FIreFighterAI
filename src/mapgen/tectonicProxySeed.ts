import { clamp } from "../core/utils.js";
import { hash2D } from "./noise.js";
import type { MapGenSettings } from "./settings.js";

const TAU = Math.PI * 2;

type TectonicProxySettings = Pick<
  MapGenSettings,
  | "relief"
  | "ruggedness"
  | "coastComplexity"
  | "riverIntensity"
  | "basinStrength"
  | "coastalShelfWidth"
  | "anisotropy"
  | "ridgeAlignment"
  | "islandCompactness"
  | "embayment"
  | "interiorRise"
  | "waterLevel"
>;

type Plate = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  uplift: number;
  continent: number;
};

export type TectonicProxySeedInput = {
  seed: number;
  cols: number;
  rows: number;
  settings: TectonicProxySettings;
};

export type TectonicProxySeedResult = {
  baseElevation: Float32Array;
  landShape: Float32Array;
  basinBias: Float32Array;
  tectonicStress: Float32Array;
  tectonicTrendX: Float32Array;
  tectonicTrendY: Float32Array;
};

const mix = (a: number, b: number, t: number): number => a + (b - a) * clamp(t, 0, 1);

const smoothstep = (edge0: number, edge1: number, value: number): number => {
  if (Math.abs(edge1 - edge0) < 1e-6) {
    return value < edge0 ? 0 : 1;
  }
  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
};

const normalize = (x: number, y: number): { x: number; y: number } => {
  const length = Math.hypot(x, y);
  if (length <= 1e-6) {
    return { x: 0, y: 0 };
  }
  return { x: x / length, y: y / length };
};

const valueNoise = (x: number, y: number, seed: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const tx = x - x0;
  const ty = y - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const v00 = hash2D(x0, y0, seed);
  const v10 = hash2D(x1, y0, seed);
  const v01 = hash2D(x0, y1, seed);
  const v11 = hash2D(x1, y1, seed);
  const v0 = v00 + (v10 - v00) * sx;
  const v1 = v01 + (v11 - v01) * sx;
  return v0 + (v1 - v0) * sy;
};

const fbm = (x: number, y: number, seed: number, octaves = 3): number => {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += valueNoise(x * frequency, y * frequency, seed + octave * 97) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return weight > 0 ? sum / weight : 0;
};

const sampleOrientedRidgeNoise = (
  nx: number,
  ny: number,
  dirX: number,
  dirY: number,
  seed: number,
  frequency: number,
  anisotropy: number
): number => {
  const normalX = -dirY;
  const normalY = dirX;
  const along = (nx * dirX + ny * dirY) * frequency;
  const across = (nx * normalX + ny * normalY) * frequency * mix(0.55, 0.18, anisotropy);
  const ridgeA = 1 - Math.abs(fbm(along + 17.3, across - 9.1, seed + 401, 3) * 2 - 1);
  const ridgeB = 1 - Math.abs(fbm(along * 1.9 - 5.4, across * 0.75 + 13.7, seed + 607, 2) * 2 - 1);
  return clamp(ridgeA * 0.68 + ridgeB * 0.32, 0, 1);
};

const createPlates = (input: TectonicProxySeedInput): Plate[] => {
  const { seed, settings } = input;
  const relief = clamp(settings.relief, 0, 1);
  const ruggedness = clamp(settings.ruggedness, 0, 1);
  const coastComplexity = clamp(settings.coastComplexity, 0, 1);
  const anisotropy = clamp(settings.anisotropy, 0, 1);
  const interiorRise = clamp(settings.interiorRise, 0, 1);
  const plateCount = Math.max(6, Math.min(9, Math.round(mix(6, 9, coastComplexity * 0.55 + ruggedness * 0.45))));
  const compressionAngle = hash2D(11, 7, seed + 73) * TAU;
  const compressionX = Math.cos(compressionAngle);
  const compressionY = Math.sin(compressionAngle);
  const plates: Plate[] = [];
  for (let index = 0; index < plateCount; index += 1) {
    const phase = index / plateCount;
    const angle = phase * TAU + (hash2D(index, 1, seed + 101) - 0.5) * mix(0.35, 0.92, coastComplexity);
    const radius = mix(0.18, 0.84, hash2D(index, 2, seed + 103));
    const x = 0.5 + Math.cos(angle) * radius * mix(0.24, 0.43, 1 - anisotropy * 0.55);
    const y = 0.5 + Math.sin(angle) * radius * mix(0.24, 0.43, 1 - anisotropy * 0.25);
    const side = Math.sign((x - 0.5) * compressionX + (y - 0.5) * compressionY) || 1;
    const toCenter = normalize(0.5 - x, 0.5 - y);
    const alignedMotion = normalize(-compressionX * side, -compressionY * side);
    const motionMix = mix(0.35, 0.7, relief * 0.6 + ruggedness * 0.4);
    const spin = (hash2D(index, 3, seed + 107) - 0.5) * Math.PI * mix(0.28, 1.2, coastComplexity);
    const blendedX = alignedMotion.x * motionMix + toCenter.x * (1 - motionMix);
    const blendedY = alignedMotion.y * motionMix + toCenter.y * (1 - motionMix);
    const rotatedX = blendedX * Math.cos(spin) - blendedY * Math.sin(spin);
    const rotatedY = blendedX * Math.sin(spin) + blendedY * Math.cos(spin);
    const velocity = normalize(rotatedX, rotatedY);
    plates.push({
      x,
      y,
      vx: velocity.x,
      vy: velocity.y,
      uplift: mix(-0.14, 0.32, hash2D(index, 4, seed + 109)) + relief * 0.14 - settings.waterLevel * 0.06,
      continent: mix(0.26, 0.9, hash2D(index, 5, seed + 113)) * mix(0.72, 1.18, interiorRise)
    });
  }
  return plates;
};

export const buildTectonicProxySeed = (input: TectonicProxySeedInput): TectonicProxySeedResult => {
  const { seed, cols, rows, settings } = input;
  const relief = clamp(settings.relief, 0, 1);
  const ruggedness = clamp(settings.ruggedness, 0, 1);
  const coastComplexity = clamp(settings.coastComplexity, 0, 1);
  const riverIntensity = clamp(settings.riverIntensity, 0, 1);
  const basinStrength = clamp(settings.basinStrength, 0, 1);
  const anisotropy = clamp(settings.anisotropy, 0, 1);
  const ridgeAlignment = clamp(settings.ridgeAlignment, 0, 1);
  const islandCompactness = clamp(settings.islandCompactness, 0, 1);
  const embayment = clamp(settings.embayment, 0, 1);
  const interiorRise = clamp(settings.interiorRise, 0, 1);
  const plates = createPlates(input);
  const total = cols * rows;
  const baseElevation = new Float32Array(total);
  const landShape = new Float32Array(total);
  const basinBias = new Float32Array(total);
  const tectonicStress = new Float32Array(total);
  const tectonicTrendX = new Float32Array(total);
  const tectonicTrendY = new Float32Array(total);
  let minElevation = Number.POSITIVE_INFINITY;
  let maxElevation = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < rows; y += 1) {
    const ny = rows <= 1 ? 0.5 : y / (rows - 1);
    const py = ny * 2 - 1;
    for (let x = 0; x < cols; x += 1) {
      const nx = cols <= 1 ? 0.5 : x / (cols - 1);
      const px = nx * 2 - 1;
      let nearest = -1;
      let second = -1;
      let nearestDist = Number.POSITIVE_INFINITY;
      let secondDist = Number.POSITIVE_INFINITY;
      for (let index = 0; index < plates.length; index += 1) {
        const plate = plates[index]!;
        const dx = nx - plate.x;
        const dy = ny - plate.y;
        const distance = dx * dx + dy * dy;
        if (distance < nearestDist) {
          second = nearest;
          secondDist = nearestDist;
          nearest = index;
          nearestDist = distance;
        } else if (distance < secondDist) {
          second = index;
          secondDist = distance;
        }
      }

      const plateA = plates[Math.max(0, nearest)]!;
      const plateB = plates[Math.max(0, second)]!;
      const distanceA = Math.sqrt(nearestDist);
      const distanceB = Math.sqrt(secondDist);
      const boundaryGap = Math.max(0, distanceB - distanceA);
      const boundaryCore = 1 - smoothstep(0.018, 0.16, boundaryGap);
      const boundaryShoulder = smoothstep(0.025, 0.14, boundaryGap) * (1 - smoothstep(0.14, 0.32, boundaryGap));
      const boundaryVector = normalize(plateB.x - plateA.x, plateB.y - plateA.y);
      const tangentX = -boundaryVector.y;
      const tangentY = boundaryVector.x;
      const relativeX = plateA.vx - plateB.vx;
      const relativeY = plateA.vy - plateB.vy;
      const convergence = Math.max(0, relativeX * boundaryVector.x + relativeY * boundaryVector.y);
      const divergence = Math.max(0, -(relativeX * boundaryVector.x + relativeY * boundaryVector.y));
      const transform = Math.abs(relativeX * tangentX + relativeY * tangentY);
      const boundaryStress = clamp(
        boundaryCore * (convergence * 0.78 + divergence * 0.6 + transform * 0.46),
        0,
        1
      );

      const radial = Math.hypot(px * mix(1.05, 0.82, anisotropy), py * mix(1.05, 0.92, anisotropy));
      const islandMask = Math.pow(
        clamp(1 - radial / mix(1.18, 0.94, islandCompactness), 0, 1),
        mix(1.25, 2.35, islandCompactness)
      );
      const continentalMass =
        clamp(plateA.continent * (0.65 + islandMask * 0.45) + interiorRise * 0.18, 0, 1.2)
        * (0.58 + islandMask * 0.42);
      const beltDir = normalize(
        tangentX * mix(0.72, 1, ridgeAlignment) + plateA.vx * 0.18,
        tangentY * mix(0.72, 1, ridgeAlignment) + plateA.vy * 0.18
      );
      const ridgeNoise = sampleOrientedRidgeNoise(nx, ny, beltDir.x, beltDir.y, seed + nearest * 31 + second * 17, mix(5.5, 10.5, relief), anisotropy);
      const shearNoise = sampleOrientedRidgeNoise(nx + 0.23, ny - 0.17, tangentX, tangentY, seed + 1301 + nearest * 43, mix(7, 13, ruggedness), anisotropy);
      const macroNoise = fbm(nx * 3.4, ny * 3.4, seed + 701, 3) * 2 - 1;
      const detailNoise = fbm(nx * 9.6, ny * 9.6, seed + 907, 2) * 2 - 1;

      const collisionUplift =
        boundaryCore
        * convergence
        * mix(0.12, 0.28, relief)
        * (0.7 + ridgeNoise * 0.5)
        * (0.84 + plateA.uplift * 0.4);
      const foldShoulders =
        boundaryShoulder
        * convergence
        * mix(0.04, 0.1, relief * 0.6 + ruggedness * 0.4)
        * (0.6 + ridgeNoise * 0.4);
      const riftCut =
        boundaryCore
        * divergence
        * mix(0.07, 0.18, basinStrength * 0.65 + embayment * 0.35)
        * (0.72 + (1 - ridgeNoise) * 0.28);
      const shearScarps =
        boundaryCore
        * transform
        * mix(0.03, 0.08, ruggedness)
        * (shearNoise * 2 - 1);
      const forelandBasin =
        boundaryShoulder
        * (convergence * 0.72 + divergence * 0.36)
        * mix(0.05, 0.15, basinStrength)
        * (0.72 + (1 - ridgeNoise) * 0.28);
      const interiorBasin =
        (1 - boundaryCore)
        * (1 - clamp(plateA.continent, 0, 1))
        * islandMask
        * mix(0.03, 0.1, basinStrength)
        * (0.62 + (1 - macroNoise * 0.5 - 0.25));
      const structuralLow = clamp(riftCut * 0.9 + forelandBasin + interiorBasin, 0, 1);
      const uplandBackbone =
        continentalMass * mix(0.11, 0.23, interiorRise)
        + foldShoulders
        + clamp(plateA.uplift, -0.1, 0.28) * 0.16;
      const ridgeField =
        ridgeNoise * (0.035 + relief * 0.045 + ruggedness * 0.03)
        + (detailNoise * 0.5 + 0.5) * 0.02;
      const shelfCut = (1 - islandMask) * mix(0.08, 0.18, settings.coastalShelfWidth);
      const rawElevation =
        uplandBackbone
        + collisionUplift * 0.92
        + shearScarps * 0.72
        + ridgeField * 0.82
        + macroNoise * mix(0.02, 0.055, coastComplexity)
        - structuralLow * mix(0.15, 0.23, basinStrength * 0.7 + riverIntensity * 0.3)
        - shelfCut;

      const idx = y * cols + x;
      baseElevation[idx] = rawElevation;
      landShape[idx] = clamp(
        continentalMass * 0.98
        + collisionUplift * 0.36
        - riftCut * 0.22
        - shelfCut * 0.48
        + islandMask * 0.28
        + interiorRise * 0.06,
        0.03,
        1.03
      ) - 0.03;
      landShape[idx] = clamp(
        landShape[idx] + 0.03,
        0,
        1
      );
      basinBias[idx] = clamp(structuralLow * 0.86 + (1 - clamp(plateA.continent, 0, 1)) * islandMask * 0.16, 0, 1);
      tectonicStress[idx] = clamp(boundaryStress * 0.84 + collisionUplift * 0.4 + Math.abs(shearScarps) * 0.22, 0, 1);
      tectonicTrendX[idx] = beltDir.x;
      tectonicTrendY[idx] = beltDir.y;
      minElevation = Math.min(minElevation, rawElevation);
      maxElevation = Math.max(maxElevation, rawElevation);
    }
  }

  const range = Math.max(1e-6, maxElevation - minElevation);
  for (let i = 0; i < total; i += 1) {
    const normalized = clamp((baseElevation[i] - minElevation) / range, 0, 1);
    const shaped = Math.pow(normalized, mix(1.12, 0.9, relief));
    const compressed = mix(0.07, 0.76, smoothstep(0.04, 0.94, shaped));
    baseElevation[i] = clamp(
      compressed
      * mix(0.78, 0.94, relief)
      * mix(0.88, 1.02, 1 - settings.waterLevel),
      0,
      1
    );
  }

  return {
    baseElevation,
    landShape,
    basinBias,
    tectonicStress,
    tectonicTrendX,
    tectonicTrendY
  };
};
