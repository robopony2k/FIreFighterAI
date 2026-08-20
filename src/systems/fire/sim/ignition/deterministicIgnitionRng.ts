import { RNG } from "../../../../core/rng.js";
import type { IgnitionSourceId } from "../../types/ignitionTypes.js";

const CHANNEL_SALTS = {
  interval: 0x494e5456,
  candidate: 0x43414e44,
  strength: 0x5354524e,
  success: 0x53554343
} as const;

export type IgnitionRandomChannel = keyof typeof CHANNEL_SALTS;

const mix32 = (value: number): number => {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
};

const hashSourceId = (sourceId: IgnitionSourceId): number => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < sourceId.length; index += 1) {
    hash ^= sourceId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

export const deriveIgnitionSeed = (
  worldSeed: number,
  sourceId: IgnitionSourceId,
  serial: number,
  channel: IgnitionRandomChannel
): number => mix32(worldSeed ^ hashSourceId(sourceId) ^ Math.imul(serial + 1, 0x9e3779b1) ^ CHANNEL_SALTS[channel]);

export const createIgnitionRng = (
  worldSeed: number,
  sourceId: IgnitionSourceId,
  serial: number,
  channel: IgnitionRandomChannel
): RNG => new RNG(deriveIgnitionSeed(worldSeed, sourceId, serial, channel));
