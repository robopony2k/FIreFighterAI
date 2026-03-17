import { getRuntimeSettings, subscribeRuntimeSettings } from "../persistence/runtimeSettings.js";

type Stat = {
  count: number;
  total: number;
  max: number;
};

let enableSimProf = getRuntimeSettings().simprof;
if (typeof window !== "undefined") {
  subscribeRuntimeSettings((settings) => {
    enableSimProf = settings.simprof;
  });
}
const stats = new Map<string, Stat>();
const REPORT_INTERVAL_MS = 2000;
let lastReport = 0;

export const profStart = (): number => (enableSimProf ? performance.now() : 0);

export const profEnd = (name: string, start: number): void => {
  if (!enableSimProf) {
    return;
  }
  const dt = performance.now() - start;
  const stat = stats.get(name);
  if (!stat) {
    stats.set(name, { count: 1, total: dt, max: dt });
    return;
  }
  stat.count += 1;
  stat.total += dt;
  if (dt > stat.max) {
    stat.max = dt;
  }
};

export const maybeReport = (state: {
  firePerfActiveBlocks: number;
  firePerfWorkBlocks: number;
  firePerfFireBoundsArea: number;
  firePerfHeatBoundsArea: number;
  pathNodesExpanded: number;
  pathMaxOpenSize: number;
  pathLastNodesExpanded: number;
}): void => {
  if (!enableSimProf) {
    return;
  }
  const now = performance.now();
  if (now - lastReport < REPORT_INTERVAL_MS) {
    return;
  }
  lastReport = now;
  const parts: string[] = [];
  stats.forEach((stat, name) => {
    const avg = stat.count > 0 ? stat.total / stat.count : 0;
    parts.push(`${name}: avg=${avg.toFixed(2)}ms max=${stat.max.toFixed(2)}ms n=${stat.count}`);
    stat.count = 0;
    stat.total = 0;
    stat.max = 0;
  });
  parts.push(
    `fire blocks: active=${state.firePerfActiveBlocks} work=${state.firePerfWorkBlocks} fireArea=${state.firePerfFireBoundsArea} heatArea=${state.firePerfHeatBoundsArea}`
  );
  parts.push(
    `pathing: nodes avg=${state.pathNodesExpanded} last=${state.pathLastNodesExpanded} maxOpen=${state.pathMaxOpenSize}`
  );
  console.log(parts.join(" | "));
};
