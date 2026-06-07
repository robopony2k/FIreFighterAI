export const yieldToNextFrame = () =>
  new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });

export class MapGenCancelledError extends Error {
  constructor(message = "Map generation cancelled.") {
    super(message);
    this.name = "MapGenCancelledError";
  }
}

export const isMapGenCancelledError = (error: unknown): error is MapGenCancelledError =>
  error instanceof MapGenCancelledError;

const createYield = (maxIterations = 32) => {
  let lastYield = typeof performance !== "undefined" ? performance.now() : Date.now();
  let iterations = 0;
  return async (): Promise<boolean> => {
    iterations += 1;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (now - lastYield < 12 && iterations < maxIterations) {
      return false;
    }
    iterations = 0;
    lastYield = now;
    await yieldToNextFrame();
    return true;
  };
};

export const createYieldController = (maxIterations = 32): (() => Promise<boolean>) => createYield(maxIterations);
