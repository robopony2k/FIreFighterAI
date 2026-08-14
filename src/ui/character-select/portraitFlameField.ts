import type { PortraitFlameDynamics } from "./portraitFlameDynamics.js";

const K1 = 0.366025404;
const K2 = 0.211324865;
const MAX_EMITTERS = 8;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const fract = (value: number): number => value - Math.floor(value);
const smoothstep = (edge0: number, edge1: number, value: number): number => {
  const amount = clamp((value - edge0) / Math.max(0.0001, edge1 - edge0), 0, 1);
  return amount * amount * (3 - 2 * amount);
};

const hashX = (x: number, y: number): number =>
  -1 + 2 * fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
const hashY = (x: number, y: number): number =>
  -1 + 2 * fract(Math.sin(x * 269.5 + y * 183.3) * 43758.5453123);

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
  for (let octave = 0; octave < 4; octave += 1) {
    value += amplitude * simplexNoise(fx, fy);
    const nextX = 1.6 * fx + 1.2 * fy;
    const nextY = -1.2 * fx + 1.6 * fy;
    fx = nextX;
    fy = nextY;
    amplitude *= 0.5;
  }
  return 0.5 + 0.5 * value;
};

export type PortraitFlameFieldRenderParams = {
  imageData: ImageData;
  timeSeconds: number;
  wind: number;
  dynamics: PortraitFlameDynamics;
};

export const renderPortraitFlameField = ({
  imageData,
  timeSeconds,
  wind,
  dynamics
}: PortraitFlameFieldRenderParams): void => {
  const { data, width, height } = imageData;
  const xScale = width > 1 ? 1 / (width - 1) : 0;
  const yScale = height > 1 ? 1 / (height - 1) : 0;
  const emitterCount = Math.min(MAX_EMITTERS, Math.max(0, Math.round(dynamics.emitterCount)));
  const flameHeight = clamp(dynamics.flameHeight, 0.05, 1);
  const emitterSpacing = emitterCount > 0 ? 1 / emitterCount : 1;

  for (let y = 0; y < height; y += 1) {
    const uvY = 1 - y * yScale;
    const localY = uvY / flameHeight;
    const rowOffset = y * width;
    for (let x = 0; x < width; x += 1) {
      const pixelOffset = (rowOffset + x) * 4;
      if (localY > 1) {
        data[pixelOffset] = 0;
        data[pixelOffset + 1] = 0;
        data[pixelOffset + 2] = 0;
        data[pixelOffset + 3] = 0;
        continue;
      }

      const uvX = x * xScale;
      let combinedHeat = 0;
      let combinedShape = 0;
      for (let emitterIndex = 0; emitterIndex < emitterCount; emitterIndex += 1) {
        const emitterCenter = (emitterIndex + 0.5) * emitterSpacing;
        const phase = emitterIndex * 7.31;
        const warp = Math.sin(localY * 6.2 + phase + timeSeconds * 1.18)
          * 0.085 * dynamics.turbulence * localY;
        const windShear = wind * localY * localY * 0.055;
        const fieldX = (uvX - emitterCenter) / (emitterSpacing * 1.8) + warp + windShear;
        const fieldY = localY - 0.2;
        const noise = fbm(
          fieldX * (1.05 + emitterIndex * 0.025) + phase * 0.11,
          fieldY * 1.42 - timeSeconds * (2.6 + emitterIndex * 0.09)
        );
        const radius = Math.hypot(fieldX * (1.2 + fieldY * 0.62), fieldY * 0.68);
        const shape = clamp(
          1 - 9 * Math.pow(Math.max(0, radius - noise * Math.max(0, fieldY + 0.34)), 1.15),
          0,
          1
        );
        const heightFade = 1 - smoothstep(0.78, 1, localY);
        const heatEnvelope = 1.35 - Math.pow(localY, 2.6);
        const heat = clamp(noise * shape * heatEnvelope * heightFade, 0, 1);
        combinedHeat = 1 - (1 - combinedHeat) * (1 - heat);
        combinedShape = 1 - (1 - combinedShape) * (1 - shape * heightFade);
      }

      const wallWarp = Math.sin(localY * 5.1 + timeSeconds * 1.05)
        * 0.1 * dynamics.turbulence * localY;
      const wallNoise = fbm(
        (uvX - 0.5) * 2.15 + wallWarp + wind * localY * localY * 0.075,
        localY * 1.5 - timeSeconds * 2.1
      );
      const wallTop = 0.62 + wallNoise * 0.52;
      const wallShape = 1 - smoothstep(wallTop - 0.12, wallTop + 0.08, localY);
      const wallHeat = clamp(
        (0.42 + wallNoise * 0.95) * wallShape * (1.25 - localY * 0.35),
        0,
        1
      );
      const unionHeat = 1 - (1 - combinedHeat) * (1 - wallHeat);
      const unionShape = 1 - (1 - combinedShape) * (1 - wallShape);
      combinedHeat += (unionHeat - combinedHeat) * dynamics.wallBlend;
      combinedShape += (unionShape - combinedShape) * dynamics.wallBlend;

      const c1 = clamp(combinedHeat * dynamics.heat, 0, 1);
      const c1Squared = c1 * c1;
      const c1Cubed = c1Squared * c1;
      data[pixelOffset] = Math.round(clamp(1.5 * c1, 0, 1) * 255);
      data[pixelOffset + 1] = Math.round(clamp(1.5 * c1Cubed, 0, 1) * 255);
      data[pixelOffset + 2] = Math.round(clamp(c1Cubed * c1Cubed, 0, 1) * 255);
      const heatAlpha = smoothstep(0.01, 0.2, c1);
      const alpha = clamp(combinedShape * heatAlpha * (0.16 + c1 * 1.08) * dynamics.opacity, 0, 1);
      data[pixelOffset + 3] = Math.round(alpha * 255);
    }
  }
};
