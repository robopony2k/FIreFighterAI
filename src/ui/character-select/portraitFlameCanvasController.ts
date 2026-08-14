import { renderPortraitFlameField } from "./portraitFlameField.js";
import {
  createPortraitFlameProgram,
  type PortraitFlameProgram
} from "./portraitFlameProgram.js";
import {
  DEFAULT_PORTRAIT_FLAME_FEROCITY,
  resolvePortraitFlameDynamics
} from "./portraitFlameDynamics.js";

const GPU_BUFFER_SIZE = 256;
const CPU_BUFFER_SIZE = 96;
const GPU_FIRE_UPDATE_MS = 34;
const CPU_FIRE_UPDATE_MS = 120;
const TITLE_FLAME_MOTION_TIME_SCALE = 0.44;
const MAX_PORTRAIT_SPARKS = 96;
const AVERAGE_SPARK_LIFETIME_FACTOR = 1.45;
const PORTRAIT_FLAME_BACKGROUND = "#050607";

type PortraitFlameSpark = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  lifeSeconds: number;
  maxLifeSeconds: number;
};

export type PortraitFlameCanvasController = {
  setFerocity: (ferocity: number) => void;
  destroy: () => void;
};

export const createPortraitFlameCanvasController = (
  targetCanvas: HTMLCanvasElement
): PortraitFlameCanvasController => {
  const targetCtx = targetCanvas.getContext("2d");
  if (!targetCtx) {
    throw new Error("Portrait flame canvas is unavailable.");
  }

  let bufferSize = GPU_BUFFER_SIZE;
  let renderCanvas = document.createElement("canvas");
  renderCanvas.width = bufferSize;
  renderCanvas.height = bufferSize;
  let fireProgram: PortraitFlameProgram | null = null;
  let cpuCtx: CanvasRenderingContext2D | null = null;
  let fireImageData: ImageData | null = null;

  try {
    fireProgram = createPortraitFlameProgram(renderCanvas);
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

  let destroyed = false;
  let rafId = 0;
  let lastFrameNow = 0;
  let fireAccumulatorMs = 0;
  let motionSeconds = Math.random() * 8;
  let windCurrent = 0;
  let dynamics = resolvePortraitFlameDynamics(DEFAULT_PORTRAIT_FLAME_FEROCITY);
  let windTarget = (Math.random() * 2 - 1) * 1.2 * dynamics.gust;
  let sparkAccumulator = 0;
  const sparks: PortraitFlameSpark[] = [];
  const fireStepMs = fireProgram ? GPU_FIRE_UPDATE_MS : CPU_FIRE_UPDATE_MS;

  const stepFire = (): void => {
    if (Math.random() < 0.1) {
      windTarget = (Math.random() * 2 - 1) * (0.8 + Math.random() * 1.6) * dynamics.gust;
    }
    windCurrent += (windTarget - windCurrent) * 0.06;
  };

  const renderFireBuffer = (): void => {
    const flameTime = motionSeconds * TITLE_FLAME_MOTION_TIME_SCALE;
    if (fireProgram) {
      fireProgram.render(flameTime, windCurrent, dynamics);
    } else if (cpuCtx && fireImageData) {
      renderPortraitFlameField({
        imageData: fireImageData,
        timeSeconds: flameTime,
        wind: windCurrent,
        dynamics
      });
      cpuCtx.putImageData(fireImageData, 0, 0);
    }
  };

  const spawnSpark = (prewarm = false): void => {
    if (sparks.length >= MAX_PORTRAIT_SPARKS) {
      sparks.shift();
    }
    const maxLifeSeconds = (0.9 + Math.random() * 1.1) * dynamics.sparkLifetime;
    const canvasScale = targetCanvas.width / GPU_BUFFER_SIZE;
    const vx = ((Math.random() * 2 - 1) * 18 + windCurrent * 10) * canvasScale;
    const vy = -(60 + Math.random() * 55) * dynamics.sparkSpeed * canvasScale;
    const elapsedSeconds = prewarm ? Math.random() * maxLifeSeconds * 0.82 : 0;
    sparks.push({
      x: targetCanvas.width * (0.04 + Math.random() * 0.92) + vx * elapsedSeconds,
      y: targetCanvas.height * (0.86 + Math.random() * 0.12) + vy * elapsedSeconds,
      vx,
      vy,
      size: (0.9 + Math.random() * 1.8) * canvasScale,
      lifeSeconds: maxLifeSeconds - elapsedSeconds,
      maxLifeSeconds
    });
  };

  const prewarmSparks = (): void => {
    const targetPopulation = Math.min(
      MAX_PORTRAIT_SPARKS,
      Math.round(dynamics.sparkRate * dynamics.sparkLifetime * AVERAGE_SPARK_LIFETIME_FACTOR)
    );
    for (let index = 0; index < targetPopulation; index += 1) {
      spawnSpark(true);
    }
  };

  const updateSparks = (deltaSeconds: number): void => {
    sparkAccumulator += dynamics.sparkRate * deltaSeconds;
    const spawnCount = Math.min(8, Math.floor(sparkAccumulator));
    sparkAccumulator -= spawnCount;
    for (let index = 0; index < spawnCount; index += 1) {
      spawnSpark();
    }
    for (let index = sparks.length - 1; index >= 0; index -= 1) {
      const spark = sparks[index]!;
      spark.lifeSeconds -= deltaSeconds;
      if (spark.lifeSeconds <= 0 || spark.y + spark.size < 0) {
        sparks.splice(index, 1);
        continue;
      }
      spark.vx += windCurrent * 7 * (targetCanvas.width / GPU_BUFFER_SIZE) * deltaSeconds;
      spark.x += spark.vx * deltaSeconds;
      spark.y += spark.vy * deltaSeconds;
    }
  };

  const drawFrame = (): void => {
    targetCtx.globalCompositeOperation = "source-over";
    targetCtx.globalAlpha = 1;
    targetCtx.fillStyle = PORTRAIT_FLAME_BACKGROUND;
    targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    if (dynamics.glowStrength > 0) {
      const glow = targetCtx.createRadialGradient(
        targetCanvas.width * 0.5,
        targetCanvas.height * 1.04,
        0,
        targetCanvas.width * 0.5,
        targetCanvas.height * 1.04,
        targetCanvas.width * 0.72
      );
      glow.addColorStop(0, `rgba(255, 91, 18, ${dynamics.glowStrength * 0.9})`);
      glow.addColorStop(0.42, `rgba(187, 39, 8, ${dynamics.glowStrength * 0.48})`);
      glow.addColorStop(1, "rgba(40, 7, 2, 0)");
      targetCtx.fillStyle = glow;
      targetCtx.fillRect(0, 0, targetCanvas.width, targetCanvas.height);
    }
    targetCtx.drawImage(renderCanvas, 0, 0, targetCanvas.width, targetCanvas.height);
    for (const spark of sparks) {
      const lifeRatio = Math.max(0, spark.lifeSeconds / spark.maxLifeSeconds);
      const alpha = Math.min(1, lifeRatio * 1.8);
      const green = Math.round(105 + dynamics.heat * 105 + lifeRatio * 35);
      const blue = Math.round(12 + dynamics.heat * 45);
      targetCtx.fillStyle = `rgba(255, ${green}, ${blue}, ${alpha})`;
      targetCtx.fillRect(spark.x, spark.y, spark.size, spark.size * 1.7);
      if (spark.size > 1.5 && lifeRatio > 0.34) {
        targetCtx.fillStyle = `rgba(255, 244, 190, ${alpha * 0.68})`;
        targetCtx.fillRect(spark.x + spark.size * 0.2, spark.y, Math.max(0.8, spark.size * 0.28), spark.size);
      }
    }
  };

  const tick = (now: number): void => {
    if (destroyed) {
      return;
    }
    const deltaMs = Math.min(120, Math.max(0, now - lastFrameNow));
    lastFrameNow = now;
    if (!document.hidden && targetCanvas.offsetParent !== null) {
      const deltaSeconds = deltaMs / 1000;
      motionSeconds += deltaSeconds * dynamics.motionRate;
      fireAccumulatorMs += deltaMs;
      let fireDirty = false;
      while (fireAccumulatorMs >= fireStepMs) {
        stepFire();
        fireAccumulatorMs -= fireStepMs;
        fireDirty = true;
      }
      if (fireProgram || fireDirty) {
        renderFireBuffer();
      }
      updateSparks(deltaSeconds);
      drawFrame();
    }
    rafId = window.requestAnimationFrame(tick);
  };

  prewarmSparks();
  renderFireBuffer();
  drawFrame();
  rafId = window.requestAnimationFrame(tick);

  return {
    setFerocity: (ferocity: number): void => {
      dynamics = resolvePortraitFlameDynamics(ferocity);
      sparks.length = 0;
      sparkAccumulator = 0;
      windCurrent = 0;
      windTarget = (Math.random() * 2 - 1) * 1.2 * dynamics.gust;
      prewarmSparks();
      renderFireBuffer();
      drawFrame();
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
