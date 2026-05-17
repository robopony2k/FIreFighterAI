export type BootLoopDeps = {
  isBlocked: () => boolean;
  tick: (deltaSeconds: number) => void;
  render: (alpha: number) => void;
  onFrameDone?: (frameMs: number, now: number) => void;
};

export const createBootLoop = (deps: BootLoopDeps) => {
  let lastTick = 0;
  let accumulator = 0;

  const frame = (now: number): void => {
    const frameStart = performance.now();
    if (!lastTick) {
      lastTick = now;
    }
    if (deps.isBlocked()) {
      lastTick = now;
      accumulator = 0;
      deps.onFrameDone?.(performance.now() - frameStart, now);
      requestAnimationFrame(frame);
      return;
    }
    const delta = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;
    accumulator += delta;
    while (accumulator >= 0.25) {
      deps.tick(0.25);
      accumulator -= 0.25;
    }
    const alpha = Math.min(1, Math.max(0, accumulator / 0.25));
    deps.render(alpha);
    deps.onFrameDone?.(performance.now() - frameStart, now);
    requestAnimationFrame(frame);
  };

  return {
    start: () => requestAnimationFrame(frame)
  };
};

export type AppBootLoopDeps = {
  baseStep: number;
  mainHitchThresholdMs: number;
  getFrameCapFps: () => number;
  getTimeSpeedValue: () => number;
  getMaxSimulationStep?: () => number | null;
  isGenerating: () => boolean;
  isTitleScreenVisible?: () => boolean;
  isCharacterScreenVisible: () => boolean;
  isStartMenuVisible: () => boolean;
  isDocumentHidden: () => boolean;
  isThreeTestVisible: () => boolean;
  isIncidentMode: () => boolean;
  isThreeTestNoSim: () => boolean;
  isSimulationEffectivelyPaused: () => boolean;
  stepSimulation: (simStep: number) => number;
  onThreeTestFrame: (alpha: number) => void;
  renderFrame: (alpha: number) => void;
  recordPerfSample: (name: string, value: number) => void;
  maybeUpdatePerfDiagnostics: (now: number) => void;
};

export const startAppBootLoop = (deps: AppBootLoopDeps): void => {
  let lastTick = 0;
  let accumulator = 0;
  let lastMainRafAt = 0;
  let lastMainStepAt = 0;
  const frameCapToleranceMs = 0.75;

  const frame = (now: number): void => {
    const frameStartedAt = performance.now();
    const frameCapFps = deps.getFrameCapFps();
    const mainFrameMinMs = frameCapFps > 0 ? 1000 / frameCapFps : 0;
    if (lastMainRafAt > 0) {
      const rafGapMs = Math.max(0, now - lastMainRafAt);
      deps.recordPerfSample("main.rafGap", rafGapMs);
      if (rafGapMs >= deps.mainHitchThresholdMs) {
        deps.recordPerfSample("main.hitch", rafGapMs);
      }
    }
    lastMainRafAt = now;
    if (!lastTick) {
      lastTick = now;
    }
    if (mainFrameMinMs > 0 && lastMainStepAt > 0 && now - lastMainStepAt + frameCapToleranceMs < mainFrameMinMs) {
      requestAnimationFrame(frame);
      return;
    }
    lastMainStepAt = now;

    const threeTestVisible = deps.isThreeTestVisible();
    if (
      deps.isGenerating() ||
      deps.isTitleScreenVisible?.() ||
      deps.isCharacterScreenVisible() ||
      deps.isStartMenuVisible() ||
      deps.isDocumentHidden()
    ) {
      lastTick = now;
      accumulator = 0;
      deps.recordPerfSample("main.frame", performance.now() - frameStartedAt);
      deps.maybeUpdatePerfDiagnostics(now);
      requestAnimationFrame(frame);
      return;
    }

    const delta = Math.min(0.25, (now - lastTick) / 1000);
    lastTick = now;
    accumulator += delta;
    const incidentMode = deps.isIncidentMode();
    if (incidentMode) {
      accumulator = Math.min(accumulator, deps.baseStep);
    }
    const timeSpeedValue = deps.getTimeSpeedValue();
    const requestedSimStep = deps.baseStep * timeSpeedValue;
    const maxSimulationStep = deps.getMaxSimulationStep?.() ?? null;
    const simStep =
      maxSimulationStep !== null && Number.isFinite(maxSimulationStep) && maxSimulationStep > 0
        ? Math.min(requestedSimStep, maxSimulationStep)
        : requestedSimStep;
    const maxStepsPerFrame = incidentMode ? 1 : threeTestVisible ? 1 : 8;
    let simStepsThisFrame = 0;
    let simFrameMs = 0;
    const skipSimThisFrame = threeTestVisible && deps.isThreeTestNoSim();
    const simPaused = deps.isSimulationEffectivelyPaused();
    if (skipSimThisFrame || simPaused) {
      accumulator = 0;
    } else {
      while (accumulator >= deps.baseStep && simStepsThisFrame < maxStepsPerFrame) {
        simFrameMs += deps.stepSimulation(simStep);
        accumulator -= deps.baseStep;
        simStepsThisFrame += 1;
      }
    }
    deps.recordPerfSample("sim.frame", simFrameMs);
    deps.recordPerfSample("sim.steps", simStepsThisFrame);
    if (simStepsThisFrame > 0) {
      deps.recordPerfSample("sim.step", simFrameMs / simStepsThisFrame);
    }
    if (incidentMode) {
      accumulator = Math.min(accumulator, deps.baseStep);
    } else if (simStepsThisFrame >= maxStepsPerFrame && accumulator >= deps.baseStep) {
      accumulator = Math.min(accumulator, deps.baseStep);
    }

    const alpha = simPaused ? 1 : Math.min(1, Math.max(0, accumulator / deps.baseStep));
    if (threeTestVisible) {
      deps.onThreeTestFrame(alpha);
    } else {
      deps.renderFrame(alpha);
    }
    deps.recordPerfSample("main.frame", performance.now() - frameStartedAt);
    deps.maybeUpdatePerfDiagnostics(now);
    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
};
