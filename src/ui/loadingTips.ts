export type MapPrepLoadingScene = {
  tip: string;
  graphicKey: string;
};

export type MapPrepAssetTaskStatus = {
  label: string;
  state: "waiting" | "running" | "complete" | "failed";
  completed: number;
  total: number;
  failedUnits: number;
  activeItem: string | null;
  startedAtMs: number | null;
  endedAtMs: number | null;
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

const formatAssetTask = (task: MapPrepAssetTaskStatus, nowMs: number): string => {
  const unitProgress = task.total > 1 ? ` ${task.completed}/${task.total}` : "";
  const activeItem = task.activeItem ? ` [${task.activeItem}]` : "";
  const elapsed = task.startedAtMs === null
    ? ""
    : ` ${formatElapsedSeconds((task.endedAtMs ?? nowMs) - task.startedAtMs)}`;
  const failures = task.failedUnits > 0 ? ` !${task.failedUnits}` : "";
  return `${task.label}${unitProgress}${activeItem}${elapsed}${failures}`;
};

export const getMapPrepAssetLoadingProgress = (tasks: readonly MapPrepAssetTaskStatus[]): number => {
  const total = tasks.reduce((sum, task) => sum + Math.max(1, task.total), 0);
  const completed = tasks.reduce(
    (sum, task) => sum + (task.state === "complete" || task.state === "failed"
      ? Math.max(1, task.total)
      : Math.max(0, Math.min(task.total, task.completed))),
    0
  );
  return total > 0 ? completed / total : 1;
};

export const getMapPrepAssetLoadingMessage = (
  tasks: readonly MapPrepAssetTaskStatus[],
  nowMs: number
): string => {
  const active = tasks.filter((task) => task.state === "running" || task.state === "waiting");
  const complete = tasks.filter((task) => task.state === "complete");
  const failed = tasks.filter((task) => task.state === "failed");
  const totalUnits = tasks.reduce((sum, task) => sum + Math.max(1, task.total), 0);
  const completedUnits = Math.round(getMapPrepAssetLoadingProgress(tasks) * totalUnits);
  const parts = [
    active.length > 0
      ? `active ${active.map((task) => formatAssetTask(task, nowMs)).join(", ")}`
      : "active none"
  ];
  if (complete.length > 0) {
    parts.push(`done ${complete.map((task) => task.label).join(", ")}`);
  }
  if (failed.length > 0) {
    parts.push(`failed ${failed.map((task) => task.label).join(", ")}`);
  }
  return `Loading 3D assets: ${parts.join(" | ")} | ${completedUnits}/${totalUnits} assets`;
};

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
  if (normalized.includes("morphology")) {
    return "Recomputing final slope, curvature, erosion, and exposed-rock fields after settlement grading.";
  }
  if (normalized.includes("vegetation suitability")) {
    return "Caching the generated suitability and site-quality fields used by vegetation growth.";
  }
  if (normalized.includes("initial vegetation")) {
    return "Seeding vegetation ages, canopy structure, and forest-edge distances across the generated terrain.";
  }
  if (normalized.includes("forest composition")) {
    return "Grouping connected forest stands and assigning their deterministic tree composition.";
  }
  if (normalized.includes("pre-growth")) {
    return "Advancing the configured vegetation years one at a time; the state line shows the active year.";
  }
  if (normalized.includes("fuel")) {
    return "Initializing tile fuel, campaign vegetation capacity, and final land totals.";
  }
  if (normalized.includes("color variation")) {
    return "Generating seeded low- and broad-frequency terrain color noise; the state line shows completed rows.";
  }
  if (normalized.includes("publishing final") || normalized.includes("diagnostic")) {
    return "Publishing authoritative map arrays and capturing the optional final diagnostic snapshot.";
  }
  if (normalized.includes("a*") || normalized.includes("road")) {
    return "Testing recursive A* route attempts, switchback retries, bridge allowances, and final connectivity repairs.";
  }
  if (normalized.includes("settlement")) {
    return "Scoring firebase and town sites against slope, relief, water access, and roadability.";
  }
  if (normalized.includes("preparing 3d world")) {
    if (normalized.includes("priming")) {
      return "Compiling renderer work and submitting the first frame; the console startup profile records this separately from terrain construction.";
    }
    if (normalized.includes("terrain surface") || normalized.includes("cutout")) {
      return "This synchronous stage now records terrain assembly, inland-water clipping, seam conformance, skirt geometry, normals, vegetation, structures, and water separately.";
    }
    return "Asset transfer is complete. The main thread is now initializing renderer resources and preparing the generated world for its first frame.";
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
    return "Assets occupy 75-90% of startup progress. Parsing and geometry prep use the main thread; renderer and terrain construction follow as separately measured stages.";
  }
  return "Preparing a deterministic campaign map from the selected seed and terrain settings.";
};

export const getMapPrepStateLine = (message: string, progress: number, elapsedMs: number): string =>
  `mapgen ${Math.round(Math.max(0, Math.min(1, progress)) * 100)}% | ${formatElapsedSeconds(elapsedMs)} | ${message} | ${getMapPrepLoadingDetail(message)}`;
