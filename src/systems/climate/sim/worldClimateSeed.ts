import { u01 } from "../../../core/climate.js";
import type { WorldClimateSeed } from "../types/worldClimateSeed.js";

const TAU = Math.PI * 2;

const signedRange = (seed: number, salt: number, magnitude: number): number =>
  (u01(seed, salt) * 2 - 1) * magnitude;

export const generateWorldClimateSeed = (worldSeed: number): WorldClimateSeed => {
  const angle = u01(worldSeed, 15101) * TAU;
  const strength = 0.34 + u01(worldSeed, 15117) * 0.46;
  const variability = 0.16 + u01(worldSeed, 15131) * 0.34;

  return {
    prevailingWindAngleRad: angle,
    prevailingWindStrength: strength,
    prevailingWindVariability: variability,
    rainfallBias: signedRange(worldSeed, 15149, 0.12),
    aridityBias: signedRange(worldSeed, 15161, 0.1)
  };
};

export const getPrevailingWindVector = (
  climateSeed: WorldClimateSeed
): { dx: number; dy: number; strength: number } => ({
  dx: Math.cos(climateSeed.prevailingWindAngleRad),
  dy: Math.sin(climateSeed.prevailingWindAngleRad),
  strength: climateSeed.prevailingWindStrength
});
