export const TERRAIN_GENERATION_LIMITS = Object.freeze({
  landCoverageTarget: Object.freeze({
    min: 0.5,
    max: 0.7
  }),
  maxHeight: Object.freeze({
    min: 0.4,
    max: 1
  }),
  sliders: Object.freeze({
    relief: Object.freeze({
      min: 0.75,
      max: 1
    }),
    maxHeight: Object.freeze({
      min: 0.5,
      max: 1
    }),
    ruggedness: Object.freeze({
      min: 0.75,
      max: 1
    })
  })
} as const);
