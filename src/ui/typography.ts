export type UiFontWeight = 400 | 500 | 600 | 700;

export const UI_FONT_STACK = '"Barlow", system-ui, sans-serif';
export const MONO_FONT_STACK = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
export const EMOJI_FONT_STACK =
  '"Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", "Barlow", system-ui, sans-serif';

export const canvasUiFont = (weight: UiFontWeight, sizePx: number): string =>
  `${weight} ${sizePx}px ${UI_FONT_STACK}`;

export const canvasMonoFont = (weight: UiFontWeight, sizePx: number): string =>
  `${weight} ${sizePx}px ${MONO_FONT_STACK}`;

export const canvasEmojiFont = (sizePx: number): string => `${sizePx}px ${EMOJI_FONT_STACK}`;
