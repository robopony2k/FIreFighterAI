export type WebGlGpuTimerLabel = "world" | "shadowRefresh" | "post" | "ui";

export type WebGlGpuTimerSnapshot = Record<WebGlGpuTimerLabel, number | null>;

type TimerQueryExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

type PendingQuery = {
  label: WebGlGpuTimerLabel;
  query: WebGLQuery;
};

const createEmptySnapshot = (): WebGlGpuTimerSnapshot => ({
  world: null,
  shadowRefresh: null,
  post: null,
  ui: null
});

export class WebGlGpuTimer {
  private readonly gl: WebGL2RenderingContext | null;
  private readonly extension: TimerQueryExtension | null;
  private readonly pending: PendingQuery[] = [];
  private readonly snapshot = createEmptySnapshot();
  private active: PendingQuery | null = null;

  public constructor(context: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = "beginQuery" in context ? context as WebGL2RenderingContext : null;
    this.extension = this.gl
      ? this.gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerQueryExtension | null
      : null;
  }

  public begin(label: WebGlGpuTimerLabel): boolean {
    this.poll();
    if (!this.gl || !this.extension || this.active || this.pending.length >= 8) {
      return false;
    }
    const query = this.gl.createQuery();
    if (!query) {
      return false;
    }
    this.active = { label, query };
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    return true;
  }

  public end(): void {
    if (!this.gl || !this.extension || !this.active) {
      return;
    }
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.pending.push(this.active);
    this.active = null;
  }

  public poll(): void {
    if (!this.gl || !this.extension || this.pending.length === 0) {
      return;
    }
    const disjoint = Boolean(this.gl.getParameter(this.extension.GPU_DISJOINT_EXT));
    for (let index = 0; index < this.pending.length;) {
      const entry = this.pending[index]!;
      const available = Boolean(this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT_AVAILABLE));
      if (!available) {
        index += 1;
        continue;
      }
      if (!disjoint) {
        const elapsedNs = Number(this.gl.getQueryParameter(entry.query, this.gl.QUERY_RESULT));
        this.snapshot[entry.label] = Number.isFinite(elapsedNs) ? elapsedNs / 1_000_000 : null;
      }
      this.gl.deleteQuery(entry.query);
      this.pending.splice(index, 1);
    }
  }

  public getSnapshot(): WebGlGpuTimerSnapshot {
    this.poll();
    return { ...this.snapshot };
  }

  public dispose(): void {
    if (!this.gl) {
      return;
    }
    if (this.active) {
      this.gl.endQuery(this.extension!.TIME_ELAPSED_EXT);
      this.gl.deleteQuery(this.active.query);
      this.active = null;
    }
    this.pending.forEach(({ query }) => this.gl!.deleteQuery(query));
    this.pending.length = 0;
  }
}
