import type { Particle } from "./types.js";

export interface EffectsState {
  waterParticles: Particle[];
  smokeParticles: Particle[];
}

export const createEffectsState = (): EffectsState => ({
  waterParticles: [],
  smokeParticles: []
});

export const resetEffectsState = (state: EffectsState): void => {
  state.waterParticles = [];
  state.smokeParticles = [];
};
