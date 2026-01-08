
import { clamp } from "../core/utils.js";
import { FIRE_COLORS } from "../core/config.js";

/** An RGB color object. */
export type RGB = { r: number; g: number; b: number };

/** Converts an RGB object to an `rgb(r, g, b)` string. */
export const rgbString = (color: RGB): string =>
  `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;

/**
 * Mixes two RGB colors.
 * @returns A new RGB object.
 */
export const mixRgb = (a: RGB, b: RGB, t: number): RGB => ({
  r: a.r + (b.r - a.r) * t,
  g: a.g + (b.g - a.g) * t,
  b: a.b + (b.b - a.b) * t,
});

/**
 * Mixes two RGB colors, mutating the `out` object to avoid allocations.
 */
export const mixRgbTo = (out: RGB, a: RGB, b: RGB, t: number): void => {
  out.r = a.r + (b.r - a.r) * t;
  out.g = a.g + (b.g - a.g) * t;
  out.b = a.b + (b.b - a.b) * t;
};

/**
 * Scales an RGB color by a factor.
 * @returns A new RGB object.
 */
export const scaleRgb = (color: RGB, factor: number): RGB => ({
  r: clamp(color.r * factor, 0, 255),
  g: clamp(color.g * factor, 0, 255),
  b: clamp(color.b * factor, 0, 255),
});

/** Converts a hex color string to an RGB object. */
export const hexToRgb = (hex: string): RGB => {
  const clean = hex.replace("#", "");
  const value = parseInt(clean, 16);
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 };
};

/** A list of RGB colors for fire rendering, converted from hex. */
export const FIRE_COLORS_RGB = FIRE_COLORS.map(hexToRgb);

/** Standard smoothstep function. */
export const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * Lightens a color by mixing it with white.
 * @returns A new RGB object.
 */
export const lighten = (color: RGB, amount: number): RGB =>
  mixRgb(color, { r: 255, g: 255, b: 255 }, clamp(amount, 0, 1));

/**
 * Darkens a color by mixing it with black.
 * @returns A new RGB object.
 */
export const darken = (color: RGB, amount: number): RGB =>
  mixRgb(color, { r: 0, g: 0, b: 0 }, clamp(amount, 0, 1));
