export const getRequiredWebGLContext = (
  canvas: HTMLCanvasElement,
  consumerLabel: string
): WebGLRenderingContext | WebGL2RenderingContext => {
  const contextAttributes: WebGLContextAttributes & {
    powerPreference?: WebGLPowerPreference;
  } = {
    alpha: false,
    antialias: true,
    powerPreference: "default"
  };
  const context = (
    canvas.getContext("webgl2", contextAttributes)
    ?? canvas.getContext("webgl", contextAttributes)
    ?? canvas.getContext("experimental-webgl", contextAttributes)
  ) as WebGLRenderingContext | WebGL2RenderingContext | null;
  if (!context) {
    throw new Error(
      `WebGL is unavailable in this environment. ${consumerLabel} requires hardware acceleration.`
    );
  }
  return context;
};

export const describeWebGLError = (error: unknown): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message.trim()
    : "WebGL is unavailable in this environment.";
