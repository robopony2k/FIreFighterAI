export type MapPrepLoadingScene = {
  tip: string;
  graphicKey: string;
};

const MAP_PREP_SCENES: MapPrepLoadingScene[] = [
  {
    tip: "Watch the wind before committing crews; a flank can become the head of the fire quickly.",
    graphicKey: "wind"
  },
  {
    tip: "Roads are lifelines for response and evacuation, so terrain can make some regions slower to defend.",
    graphicKey: "roads"
  },
  {
    tip: "Cooler, wetter windows are the best time to invest in prevention before fire weather returns.",
    graphicKey: "weather"
  },
  {
    tip: "Forests carry more fuel as they mature, but moisture and terrain still decide how fast fire moves.",
    graphicKey: "forest"
  }
];

const TIP_CYCLE_MS = 10_000;

const formatElapsedSeconds = (elapsedMs: number): string => `${Math.max(0, Math.floor(elapsedMs / 1000))}s`;

export const getMapPrepLoadingScene = (elapsedMs: number): MapPrepLoadingScene => {
  const index = Math.floor(Math.max(0, elapsedMs) / TIP_CYCLE_MS) % MAP_PREP_SCENES.length;
  return MAP_PREP_SCENES[index] ?? MAP_PREP_SCENES[0]!;
};

export const getMapPrepLoadingTip = (progress: number): string => {
  const clamped = Math.max(0, Math.min(0.999, progress));
  const index = Math.floor(clamped * MAP_PREP_SCENES.length);
  return MAP_PREP_SCENES[index]?.tip ?? MAP_PREP_SCENES[0]!.tip;
};

export const getMapPrepLoadingDetail = (message: string): string => {
  const normalized = message.toLowerCase();
  if (normalized.includes("a*") || normalized.includes("road")) {
    return "Testing recursive A* route attempts, switchback retries, bridge allowances, and final connectivity repairs.";
  }
  if (normalized.includes("settlement")) {
    return "Scoring firebase and town sites against slope, relief, water access, and roadability.";
  }
  if (normalized.includes("classifying")) {
    return "Assigning terrain, canopy, water, and biome classes from the generated elevation and moisture fields.";
  }
  if (normalized.includes("shoreline") || normalized.includes("river") || normalized.includes("hydro")) {
    return "Resolving connected water, rivers, lakes, waterfalls, and coastal terrain polish.";
  }
  if (normalized.includes("erosion") || normalized.includes("terrain") || normalized.includes("spline")) {
    return "Building the seeded landform, elevation relief, drainage support, and terrain masks.";
  }
  if (normalized.includes("3d assets")) {
    return "Preparing visual assets for the generated world.";
  }
  return "Preparing a deterministic campaign map from the selected seed and terrain settings.";
};

export const getMapPrepStateLine = (message: string, progress: number, elapsedMs: number): string =>
  `mapgen ${Math.round(Math.max(0, Math.min(1, progress)) * 100)}% | ${formatElapsedSeconds(elapsedMs)} | ${message} | ${getMapPrepLoadingDetail(message)}`;
