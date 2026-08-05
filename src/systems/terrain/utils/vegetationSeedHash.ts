const fade = (value: number): number => value * value * value * (value * (value * 6 - 15) + 10);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

export const vegetationHash2D = (x: number, y: number, seed: number): number => {
  let h = Math.imul((Math.trunc(x) ^ 0x9e3779b9) >>> 0, 0x85ebca6b);
  h = Math.imul((h ^ ((Math.trunc(y) + 0x7f4a7c15) >>> 0)) >>> 0, 0xc2b2ae35);
  h ^= Math.imul((seed + 0x165667b1) >>> 0, 0x27d4eb2d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
};

const gradientDot = (gridX: number, gridY: number, x: number, y: number, seed: number): number => {
  const angle = vegetationHash2D(gridX, gridY, seed) * Math.PI * 2;
  return Math.cos(angle) * (x - gridX) + Math.sin(angle) * (y - gridY);
};

export const vegetationGradientNoise = (x: number, y: number, seed: number): number => {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const sx = fade(x - x0);
  const sy = fade(y - y0);
  const a = mix(
    gradientDot(x0, y0, x, y, seed),
    gradientDot(x0 + 1, y0, x, y, seed),
    sx
  );
  const b = mix(
    gradientDot(x0, y0 + 1, x, y, seed),
    gradientDot(x0 + 1, y0 + 1, x, y, seed),
    sx
  );
  return Math.max(0, Math.min(1, mix(a, b, sy) * 0.7071 + 0.5));
};

export const vegetationFbmNoise = (x: number, y: number, seed: number, octaves: number): number => {
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += vegetationGradientNoise(x * frequency, y * frequency, seed + octave * 131) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return weight > 0 ? total / weight : 0.5;
};
