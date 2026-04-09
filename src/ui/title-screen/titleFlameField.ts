const K1 = 0.366025404;
const K2 = 0.211324865;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const fract = (value: number): number => value - Math.floor(value);

const hashX = (x: number, y: number): number => -1 + 2 * fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
const hashY = (x: number, y: number): number => -1 + 2 * fract(Math.sin(x * 269.5 + y * 183.3) * 43758.5453123);

const simplexNoise = (x: number, y: number): number => {
  const skew = (x + y) * K1;
  const ix = Math.floor(x + skew);
  const iy = Math.floor(y + skew);
  const unskew = (ix + iy) * K2;

  const ax = x - ix + unskew;
  const ay = y - iy + unskew;
  const ox = ax > ay ? 1 : 0;
  const oy = ax > ay ? 0 : 1;
  const bx = ax - ox + K2;
  const by = ay - oy + K2;
  const cx = ax - 1 + 2 * K2;
  const cy = ay - 1 + 2 * K2;

  const ha = Math.max(0.5 - (ax * ax + ay * ay), 0);
  const hb = Math.max(0.5 - (bx * bx + by * by), 0);
  const hc = Math.max(0.5 - (cx * cx + cy * cy), 0);

  const na = Math.pow(ha, 4) * (ax * hashX(ix, iy) + ay * hashY(ix, iy));
  const nb = Math.pow(hb, 4) * (bx * hashX(ix + ox, iy + oy) + by * hashY(ix + ox, iy + oy));
  const nc = Math.pow(hc, 4) * (cx * hashX(ix + 1, iy + 1) + cy * hashY(ix + 1, iy + 1));
  return 70 * (na + nb + nc);
};

const fbm = (x: number, y: number): number => {
  let fx = x;
  let fy = y;
  let value = 0;
  let amplitude = 0.5;
  for (let i = 0; i < 3; i += 1) {
    value += amplitude * simplexNoise(fx, fy);
    const nextX = 1.6 * fx + 1.2 * fy;
    const nextY = -1.2 * fx + 1.6 * fy;
    fx = nextX;
    fy = nextY;
    amplitude *= 0.5;
  }
  return 0.5 + 0.5 * value;
};

export type TitleFlameFieldRenderParams = {
  fireImageData: ImageData;
  emitterPixels: Uint8Array;
  glyphCount: number;
  glyphCenters: Float32Array;
  glyphHalfWidths: Float32Array;
  timeSeconds: number;
  wind: number;
};

export const renderTitleFlameField = ({
  fireImageData,
  emitterPixels,
  glyphCount,
  glyphCenters,
  glyphHalfWidths,
  timeSeconds,
  wind
}: TitleFlameFieldRenderParams): void => {
  const { data, width, height } = fireImageData;
  const xScale = width > 1 ? 1 / (width - 1) : 0;
  const yScale = height > 1 ? 1 / (height - 1) : 0;
  const activeGlyphCount = Math.max(1, glyphCount);

  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    const uvY = 1 - y * yScale;
    const qy = uvY * 1.56 - 0.31;
    const rowHeat = Math.max(0, 1.62 - Math.pow(2.05 * uvY, 3.5));
    const rowAlpha = Math.max(0, 1 - Math.pow(uvY, 2.2));
    const windShear = wind * uvY * uvY * 0.14;

    for (let x = 0; x < width; x += 1) {
      const idx = row + x;
      const pixelIndex = idx * 4;
      const uvX = x * xScale;
      let glyphIndex = 0;
      let minDist = Number.POSITIVE_INFINITY;
      for (let i = 0; i < activeGlyphCount; i += 1) {
        const center = glyphCenters[i] ?? 0.5;
        const dist = Math.abs(uvX - center);
        if (dist < minDist) {
          minDist = dist;
          glyphIndex = i;
        }
      }
      const glyphCenter = glyphCenters[glyphIndex] ?? 0.5;
      const glyphHalfWidth = Math.max(glyphHalfWidths[glyphIndex] ?? 0.01, 0.001);
      const strength = glyphIndex + 1;
      const bandWarp = Math.sin(uvY * 6.4 + glyphCenter * 31 + timeSeconds * 1.18) * 0.09 * glyphHalfWidth * uvY;
      const qx = ((uvX - glyphCenter) + bandWarp + windShear * glyphHalfWidth * 6.4) / Math.max(glyphHalfWidth * 4.2, 0.001);
      const fieldX = qx * (0.78 + uvY * 0.06);
      const fieldY = qy;
      const bandTime = Math.max(3, 1.25 * strength) * timeSeconds;
      const n = fbm(strength * fieldX, strength * fieldY - bandTime);
      const flameRadius = Math.hypot(fieldX * (1.18 + qy * 0.96), fieldY * 0.58);
      const c = clamp(1 - 14 * Math.pow(Math.max(0, flameRadius - n * Math.max(0, qy + 0.38)), 1.12), 0, 1);
      const emitterBoost = 0.88 + (emitterPixels[idx] / 255) * 0.78;
      const c1 = clamp(n * c * rowHeat * emitterBoost, 0, 1);
      const c1Cubed = c1 * c1 * c1;
      const c1Pow6 = c1Cubed * c1Cubed;
      const hotCore = Math.pow(c1, 2.6) * Math.max(0, 1 - uvY * 2.4);

      data[pixelIndex] = Math.round(clamp(1.5 * c1 + hotCore * 0.18, 0, 1) * 255);
      data[pixelIndex + 1] = Math.round(clamp(1.5 * c1Cubed + hotCore * 0.12, 0, 1) * 255);
      data[pixelIndex + 2] = Math.round(clamp(c1Pow6 + hotCore * 0.04, 0, 1) * 255);

      const alpha = clamp(c * rowAlpha * (0.52 + c1 * 0.96), 0, 1);
      data[pixelIndex + 3] = Math.round(alpha * 255);
    }
  }
};
