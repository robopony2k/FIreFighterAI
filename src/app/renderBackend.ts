export type RenderBackend = "3d" | "legacy2d";
type RenderBackendSource = RenderBackend | (() => RenderBackend);

export type RuntimeRenderBackend = {
  mode: RenderBackend;
  frame: (alpha: number) => void;
  resize: () => void;
  dispose: () => void;
};

export type CreateRenderBackendDeps = {
  renderLegacy2d: (alpha: number) => void;
  render3d?: () => void;
  onResize?: () => void;
  onDispose?: () => void;
};

export const resolveRenderBackend = (params: URLSearchParams): RenderBackend => {
  const render = (params.get("render") ?? "").toLowerCase();
  return render === "2d" ? "legacy2d" : "3d";
};

export const createRenderBackend = (mode: RenderBackendSource, deps: CreateRenderBackendDeps): RuntimeRenderBackend => {
  const resolveMode = (): RenderBackend => (typeof mode === "function" ? mode() : mode);
  return {
    get mode() {
      return resolveMode();
    },
    frame: (alpha: number) => {
      if (resolveMode() === "legacy2d") {
        deps.renderLegacy2d(alpha);
        return;
      }
      deps.render3d?.();
    },
    resize: () => {
      deps.onResize?.();
    },
    dispose: () => {
      deps.onDispose?.();
    }
  };
};
