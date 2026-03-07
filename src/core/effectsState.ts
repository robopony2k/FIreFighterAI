import type { Particle, WaterStreamFx } from "./types.js";

export interface EffectsState {
  waterParticles: Particle[];
  waterStreams: WaterStreamFx[];
  smokeParticles: Particle[];
}

export const createEffectsState = (): EffectsState => ({
  waterParticles: [],
  waterStreams: [],
  smokeParticles: []
});

export const resetEffectsState = (state: EffectsState): void => {
  state.waterParticles = [];
  state.waterStreams = [];
  state.smokeParticles = [];
};
