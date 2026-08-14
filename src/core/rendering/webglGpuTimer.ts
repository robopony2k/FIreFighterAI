export type WebGlGpuTimerLabel = "world" | "shadowRefresh" | "post" | "ui";

export type WebGlGpuTimerSample = {
  valueMs: number;
  sequence: number;
  recordedAtMs: number;
  tag: string;
};

export type WebGlGpuTimerSnapshot = Record<WebGlGpuTimerLabel, number | null> & {
  supported: boolean;
  samples: Record<WebGlGpuTimerLabel, WebGlGpuTimerSample | null>;
};

type TimerQueryExtension = {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
};

type PendingQuery = {
  label: WebGlGpuTimerLabel;
  query: WebGLQuery;
  sequence: number;
  tag: string;
};

const createEmptySamples = (): Record<WebGlGpuTimerLabel, WebGlGpuTimerSample | null> => ({
  world: null,
  shadowRefresh: null,
  post: null,
  ui: null
});

const createEmptySnapshot = (supported = false): WebGlGpuTimerSnapshot => ({
  world: null,
  shadowRefresh: null,
  post: null,
  ui: null,
  supported,
  samples: createEmptySamples()
});

export class WebGlGpuTimer {
  private readonly gl: WebGL2RenderingContext | null;
  private readonly extension: TimerQueryExtension | null;
  private readonly pending: PendingQuery[] = [];
  private readonly snapshot: WebGlGpuTimerSnapshot;
  private active: PendingQuery | null = null;
  private sequence = 0;

  public constructor(context: WebGLRenderingContext | WebGL2RenderingContext) {
    this.gl = "beginQuery" in context ? context as WebGL2RenderingContext : null;
    this.extension = this.gl
      ? this.gl.getExtension("EXT_disjoint_timer_query_webgl2") as TimerQueryExtension | null
      : null;
    this.snapshot = createEmptySnapshot(Boolean(this.gl && this.extension));
  }

  public begin(label: WebGlGpuTimerLabel, tag = "runtime"): boolean {
    this.poll();
    if (!this.gl || !this.extension || this.active || this.pending.length >= 8) {
      return false;
    }
    const query = this.gl.createQuery();
    if (!query) {
      return false;
    }
    this.sequence += 1;
    this.active = { label, query, sequence: this.sequence, tag };
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
        const valueMs = Number.isFinite(elapsedNs) ? elapsedNs / 1_000_000 : null;
        this.snapshot[entry.label] = valueMs;
        this.snapshot.samples[entry.label] = valueMs === null
          ? null
          : {
              valueMs,
              sequence: entry.sequence,
              recordedAtMs: performance.now(),
              tag: entry.tag
            };
      }
      this.gl.deleteQuery(entry.query);
      this.pending.splice(index, 1);
    }
  }

  public getSnapshot(): WebGlGpuTimerSnapshot {
    this.poll();
    return { ...this.snapshot, samples: { ...this.snapshot.samples } };
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
