export function hash2D(x: number, y: number, seedValue: number): number {
  let h = x * 374761393 + y * 668265263 + seedValue * 1447;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177);
  h = (h ^ (h >>> 16)) >>> 0;
  return h / 4294967296;
}

export function fractalNoise(x: number, y: number, seedValue: number): number {
  const n1 = hash2D(x, y, seedValue);
  const n2 = hash2D(Math.floor(x / 3), Math.floor(y / 3), seedValue + 101);
  const n3 = hash2D(Math.floor(x / 7), Math.floor(y / 7), seedValue + 271);
  return n1 * 0.6 + n2 * 0.3 + n3 * 0.1;
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

const gradientDot = (gridX: number, gridY: number, x: number, y: number, seedValue: number): number => {
  const angle = hash2D(gridX, gridY, seedValue) * Math.PI * 2;
  return Math.cos(angle) * (x - gridX) + Math.sin(angle) * (y - gridY);
};

export function gradientNoise(x: number, y: number, seedValue: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const sx = fade(x - x0);
  const sy = fade(y - y0);
  const n0 = gradientDot(x0, y0, x, y, seedValue);
  const n1 = gradientDot(x1, y0, x, y, seedValue);
  const ix0 = lerp(n0, n1, sx);
  const n2 = gradientDot(x0, y1, x, y, seedValue);
  const n3 = gradientDot(x1, y1, x, y, seedValue);
  const ix1 = lerp(n2, n3, sx);
  return Math.max(0, Math.min(1, lerp(ix0, ix1, sy) * 0.7071 + 0.5));
}

export function fbmNoise(x: number, y: number, seedValue: number, octaves: number): number {
  let amplitude = 0.5;
  let frequency = 1;
  let sum = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    sum += gradientNoise(x * frequency, y * frequency, seedValue + octave * 131) * amplitude;
    weight += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return weight > 0 ? sum / weight : 0;
}

export function ridgedFbmNoise(x: number, y: number, seedValue: number, octaves: number): number {
  let amplitude = 0.58;
  let frequency = 1;
  let sum = 0;
  let weight = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    const n = gradientNoise(x * frequency, y * frequency, seedValue + octave * 173);
    sum += (1 - Math.abs(n * 2 - 1)) * amplitude;
    weight += amplitude;
    amplitude *= 0.52;
    frequency *= 1.9;
  }
  return weight > 0 ? sum / weight : 0;
}
