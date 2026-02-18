export type RenderBackend = "3d" | "legacy2d";

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

export const createRenderBackend = (mode: RenderBackend, deps: CreateRenderBackendDeps): RuntimeRenderBackend => {
  return {
    mode,
    frame: (alpha: number) => {
      if (mode === "legacy2d") {
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
