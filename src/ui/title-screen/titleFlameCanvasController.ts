import { renderTitleFlameField } from "./titleFlameField.js";
import { createTitleFlameProgram, type TitleFlameProgram } from "./titleFlameProgram.js";

const GPU_BUFFER_SIZE = 256;
const CPU_BUFFER_SIZE = 96;
const GPU_FRAME_MS = 34;
const CPU_FRAME_MS = 100;
const TITLE_FLAME_MOTION_TIME_SCALE = 0.44;
const MAX_FLAME_GLYPHS = 16;

export type TitleFlameCanvasController = {
  setFlameScale: (scale: number) => void;
  destroy: () => void;
};

const buildEmitterPixels = (size: number): Uint8Array => {
  const pixels = new Uint8Array(size * size);
  for (let y = 0; y < size; y += 1) {
    const distanceFromBottom = size - 1 - y;
    const vertical = Math.max(0, 1 - distanceFromBottom / Math.max(1, size * 0.34));
    if (vertical <= 0) {
      continue;
    }
    for (let x = 0; x < size; x += 1) {
      const horizontal = Math.max(0, 1 - Math.abs(x / Math.max(1, size - 1) - 0.5) * 1.7);
      pixels[y * size + x] = Math.round(255 * vertical * horizontal);
    }
  }
  return pixels;
};

export const createTitleFlameCanvasController = (
  targetCanvas: HTMLCanvasElement
): TitleFlameCanvasController => {
  const targetCtx = targetCanvas.getContext("2d");
  if (!targetCtx) {
    throw new Error("Portrait flame canvas is unavailable.");
  }

  let bufferSize = GPU_BUFFER_SIZE;
  let renderCanvas = document.createElement("canvas");
  renderCanvas.width = bufferSize;
  renderCanvas.height = bufferSize;
  let fireProgram: TitleFlameProgram | null = null;
  let cpuCtx: CanvasRenderingContext2D | null = null;
  let fireImageData: ImageData | null = null;

  try {
    fireProgram = createTitleFlameProgram(renderCanvas);
  } catch {
    bufferSize = CPU_BUFFER_SIZE;
    renderCanvas = document.createElement("canvas");
    renderCanvas.width = bufferSize;
    renderCanvas.height = bufferSize;
    cpuCtx = renderCanvas.getContext("2d");
    if (!cpuCtx) {
      throw new Error("Portrait flame CPU fallback is unavailable.");
    }
    fireImageData = cpuCtx.createImageData(bufferSize, bufferSize);
  }

  targetCanvas.width = bufferSize;
  targetCanvas.height = bufferSize;
  const emitterPixels = buildEmitterPixels(bufferSize);
  fireProgram?.uploadEmitterMask(emitterPixels, bufferSize, bufferSize);

  const glyphCenters = new Float32Array(MAX_FLAME_GLYPHS);
  const glyphHalfWidths = new Float32Array(MAX_FLAME_GLYPHS);
  glyphCenters[0] = 0.24;
  glyphCenters[1] = 0.5;
  glyphCenters[2] = 0.76;
  glyphHalfWidths[0] = 0.14;
  glyphHalfWidths[1] = 0.18;
  glyphHalfWidths[2] = 0.14;

  let destroyed = false;
  let rafId = 0;
  let lastRenderedAt = 0;
  let motionSeconds = Math.random() * 8;
  let windCurrent = 0;
  let windTarget = (Math.random() * 2 - 1) * 1.2;
  let flameScale = 1;
  const frameInterval = fireProgram ? GPU_FRAME_MS : CPU_FRAME_MS;

  const render = (): void => {
    const flameTime = motionSeconds * TITLE_FLAME_MOTION_TIME_SCALE;
    if (fireProgram) {
      fireProgram.render(flameTime, windCurrent, 3, glyphCenters, glyphHalfWidths, flameScale);
    } else if (cpuCtx && fireImageData) {
      renderTitleFlameField({
        fireImageData,
        emitterPixels,
        glyphCount: 3,
        glyphCenters,
        glyphHalfWidths,
        timeSeconds: flameTime,
        wind: windCurrent,
        flameScale
      });
      cpuCtx.putImageData(fireImageData, 0, 0);
    }
    targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    targetCtx.drawImage(renderCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
  };

  const tick = (now: number): void => {
    if (destroyed) {
      return;
    }
    const deltaMs = Math.min(120, Math.max(0, now - lastRenderedAt));
    if (!document.hidden && targetCanvas.offsetParent !== null && now - lastRenderedAt >= frameInterval) {
      motionSeconds += deltaMs / 1000;
      if (Math.random() < 0.08) {
        windTarget = (Math.random() * 2 - 1) * 1.6;
      }
      windCurrent += (windTarget - windCurrent) * 0.06;
      render();
      lastRenderedAt = now;
    }
    rafId = window.requestAnimationFrame(tick);
  };

  render();
  rafId = window.requestAnimationFrame(tick);

  return {
    setFlameScale: (scale: number): void => {
      flameScale = Math.max(0.1, scale);
      render();
    },
    destroy: (): void => {
      if (destroyed) {
        return;
      }
      destroyed = true;
      window.cancelAnimationFrame(rafId);
      fireProgram?.destroy();
      targetCtx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    }
  };
};
