export type RuntimeSettings = {
  render: "3d" | "2d";
  timespeedui: "buttons" | "slider";
  randomFireIgnition: boolean;
  annualReportEnabled: boolean;
  headless: boolean;
  nosim: boolean;
  seasonal: boolean;
  noterrain: boolean;
  dpr: number;
  fps: number;
  perf: boolean;
  perflog: boolean;
  simprof: boolean;
  hud: "dom" | "canvas";
  nohud: boolean;
  nofx: boolean;
  autodpr: boolean;
  mindpr: number;
  waterq: "fast" | "balanced" | "high";
  rivercam: "" | "top" | "under" | "oblique";
  rivercamlock: boolean;
  firewall: number;
  firevol: number;
  fxbudget: number;
  fxfallback: "aggressive" | "gentle" | "off";
  sparkdebug: boolean;
  sparkmode: "tip" | "mixed" | "embers";
  shadowres: number;
  cinematic: boolean;
  dof: boolean;
  doffocus: number | null;
  dofrange: number;
  dofaperture: number;
  dofradius: number;
  dofscale: number;
  dofnear: boolean;
};

export type RuntimeSettingKey = keyof RuntimeSettings;
export type RuntimeSettingSection =
  | "General"
  | "Diagnostics"
  | "3D Renderer"
  | "3D FX"
  | "Depth of Field";

type RuntimeSettingOption<T> = {
  value: T;
  label: string;
};

type RuntimeSettingDefinitionBase<K extends RuntimeSettingKey> = {
  key: K;
  section: RuntimeSettingSection;
  label: string;
  description: string;
};

type RuntimeBooleanSettingDefinition<K extends RuntimeSettingKey> = RuntimeSettingDefinitionBase<K> & {
  kind: "boolean";
  defaultValue: RuntimeSettings[K];
  queryStyle: "1-true" | "0-false";
};

type RuntimeNumberSettingDefinition<K extends RuntimeSettingKey> = RuntimeSettingDefinitionBase<K> & {
  kind: "number" | "optionalNumber";
  defaultValue: RuntimeSettings[K];
  min?: number;
  max?: number;
  step?: number;
};

type RuntimeEnumSettingDefinition<K extends RuntimeSettingKey> = RuntimeSettingDefinitionBase<K> & {
  kind: "enum";
  defaultValue: RuntimeSettings[K];
  options: ReadonlyArray<RuntimeSettingOption<RuntimeSettings[K]>>;
};

export type RuntimeSettingDefinition<K extends RuntimeSettingKey = RuntimeSettingKey> =
  | RuntimeBooleanSettingDefinition<K>
  | RuntimeNumberSettingDefinition<K>
  | RuntimeEnumSettingDefinition<K>;

const STORAGE_KEY = "fireline.runtimeSettings";

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const DEFAULT_RUNTIME_SETTINGS: RuntimeSettings = {
  render: "3d",
  timespeedui: "buttons",
  randomFireIgnition: true,
  annualReportEnabled: true,
  headless: false,
  nosim: false,
  seasonal: true,
  noterrain: false,
  dpr: 1.5,
  fps: 60,
  perf: false,
  perflog: false,
  simprof: false,
  hud: "dom",
  nohud: false,
  nofx: false,
  autodpr: true,
  mindpr: 1,
  waterq: "balanced",
  rivercam: "",
  rivercamlock: false,
  firewall: 0.62,
  firevol: 0.55,
  fxbudget: 1,
  fxfallback: "aggressive",
  sparkdebug: false,
  sparkmode: "tip",
  shadowres: 2048,
  cinematic: true,
  dof: false,
  doffocus: null,
  dofrange: 28,
  dofaperture: 0.82,
  dofradius: 8,
  dofscale: 0.5,
  dofnear: false
};

export const RUNTIME_SETTING_DEFINITIONS: ReadonlyArray<RuntimeSettingDefinition> = [
  {
    key: "render",
    section: "General",
    kind: "enum",
    label: "Renderer",
    description: "Default renderer when launching from the menu.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.render,
    options: [
      { value: "3d", label: "3D" },
      { value: "2d", label: "Legacy 2D" }
    ]
  },
  {
    key: "timespeedui",
    section: "General",
    kind: "enum",
    label: "Time Speed UI",
    description: "Choose between preset buttons and the experimental time-speed slider.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.timespeedui,
    options: [
      { value: "buttons", label: "Buttons" },
      { value: "slider", label: "Slider" }
    ]
  },
  {
    key: "randomFireIgnition",
    section: "General",
    kind: "boolean",
    label: "Random Fire Ignition",
    description: "Allow random fire starts during fire season simulation.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.randomFireIgnition,
    queryStyle: "0-false"
  },
  {
    key: "annualReportEnabled",
    section: "General",
    kind: "boolean",
    label: "Annual Report",
    description: "Pause for the annual ledger at the winter rollover.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.annualReportEnabled,
    queryStyle: "0-false"
  },
  {
    key: "headless",
    section: "General",
    kind: "boolean",
    label: "Headless Mode",
    description: "Disables the interactive UI on next reload. Use with care.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.headless,
    queryStyle: "1-true"
  },
  {
    key: "dpr",
    section: "General",
    kind: "number",
    label: "DPR Cap",
    description: "Upper cap for device pixel ratio scaling.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.dpr,
    min: 0.5,
    max: 4,
    step: 0.1
  },
  {
    key: "fps",
    section: "General",
    kind: "number",
    label: "Frame Cap",
    description: "Main loop frame cap used by the app boot loop.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.fps,
    min: 30,
    max: 120,
    step: 1
  },
  {
    key: "perf",
    section: "Diagnostics",
    kind: "boolean",
    label: "Perf Overlay",
    description: "Show the performance overlay by default.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.perf,
    queryStyle: "1-true"
  },
  {
    key: "perflog",
    section: "Diagnostics",
    kind: "boolean",
    label: "Perf Console Log",
    description: "Emit periodic performance logs to the console.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.perflog,
    queryStyle: "1-true"
  },
  {
    key: "simprof",
    section: "Diagnostics",
    kind: "boolean",
    label: "Simulation Profiling",
    description: "Enable simulation-side profiling logs.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.simprof,
    queryStyle: "1-true"
  },
  {
    key: "nosim",
    section: "3D Renderer",
    kind: "boolean",
    label: "Skip Simulation in 3D",
    description: "Pause simulation stepping while the 3D view is active.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.nosim,
    queryStyle: "1-true"
  },
  {
    key: "seasonal",
    section: "3D Renderer",
    kind: "boolean",
    label: "Seasonal Recolor",
    description: "Enable seasonal terrain and lighting recolor.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.seasonal,
    queryStyle: "0-false"
  },
  {
    key: "noterrain",
    section: "3D Renderer",
    kind: "boolean",
    label: "Skip Terrain Sync",
    description: "Disable terrain sync updates in the 3D preview.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.noterrain,
    queryStyle: "1-true"
  },
  {
    key: "hud",
    section: "3D Renderer",
    kind: "enum",
    label: "HUD Mode",
    description: "Select the HUD source used by the 3D renderer.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.hud,
    options: [
      { value: "dom", label: "DOM" },
      { value: "canvas", label: "Canvas" }
    ]
  },
  {
    key: "nohud",
    section: "3D Renderer",
    kind: "boolean",
    label: "Disable 3D HUD",
    description: "Force the 3D HUD off regardless of HUD mode.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.nohud,
    queryStyle: "1-true"
  },
  {
    key: "nofx",
    section: "3D FX",
    kind: "boolean",
    label: "Disable FX",
    description: "Disable fire, particles, and other expensive 3D effects.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.nofx,
    queryStyle: "1-true"
  },
  {
    key: "autodpr",
    section: "3D Renderer",
    kind: "boolean",
    label: "Adaptive DPR",
    description: "Allow the 3D renderer to scale DPR based on scene cost.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.autodpr,
    queryStyle: "0-false"
  },
  {
    key: "mindpr",
    section: "3D Renderer",
    kind: "number",
    label: "Minimum DPR",
    description: "Lower bound for adaptive DPR.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.mindpr,
    min: 0.5,
    max: 4,
    step: 0.1
  },
  {
    key: "waterq",
    section: "3D Renderer",
    kind: "enum",
    label: "Water Quality",
    description: "Water simulation/rendering quality profile.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.waterq,
    options: [
      { value: "fast", label: "Fast" },
      { value: "balanced", label: "Balanced" },
      { value: "high", label: "High" }
    ]
  },
  {
    key: "rivercam",
    section: "3D Renderer",
    kind: "enum",
    label: "River Camera",
    description: "Preset camera mode for river debugging.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.rivercam,
    options: [
      { value: "", label: "Default" },
      { value: "top", label: "Top" },
      { value: "under", label: "Under" },
      { value: "oblique", label: "Oblique" }
    ]
  },
  {
    key: "rivercamlock",
    section: "3D Renderer",
    kind: "boolean",
    label: "Lock River Camera",
    description: "Disable camera controls when a river camera preset is active.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.rivercamlock,
    queryStyle: "1-true"
  },
  {
    key: "shadowres",
    section: "3D Renderer",
    kind: "number",
    label: "Shadow Map Size",
    description: "Requested shadow map resolution. Rounded to a power of two in renderer setup.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.shadowres,
    min: 512,
    max: 4096,
    step: 256
  },
  {
    key: "cinematic",
    section: "3D FX",
    kind: "boolean",
    label: "Cinematic Grade",
    description: "Enable the fullscreen cinematic grade pass.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.cinematic,
    queryStyle: "0-false"
  },
  {
    key: "firewall",
    section: "3D FX",
    kind: "number",
    label: "Fire Wall Blend",
    description: "Blend weight for wall-style fire rendering.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.firewall,
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: "firevol",
    section: "3D FX",
    kind: "number",
    label: "Hero Volumetric Share",
    description: "Share of hero fire volume rendering.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.firevol,
    min: 0,
    max: 1,
    step: 0.01
  },
  {
    key: "fxbudget",
    section: "3D FX",
    kind: "number",
    label: "FX Budget Scale",
    description: "Global FX budget multiplier.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.fxbudget,
    min: 0.4,
    max: 1.25,
    step: 0.01
  },
  {
    key: "fxfallback",
    section: "3D FX",
    kind: "enum",
    label: "FX Fallback",
    description: "Fallback strategy for overloaded fire FX.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.fxfallback,
    options: [
      { value: "aggressive", label: "Aggressive" },
      { value: "gentle", label: "Gentle" },
      { value: "off", label: "Off" }
    ]
  },
  {
    key: "sparkdebug",
    section: "3D FX",
    kind: "boolean",
    label: "Spark Debug",
    description: "Enable spark debugging visuals.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.sparkdebug,
    queryStyle: "1-true"
  },
  {
    key: "sparkmode",
    section: "3D FX",
    kind: "enum",
    label: "Spark Mode",
    description: "Spark emission style.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.sparkmode,
    options: [
      { value: "tip", label: "Tip" },
      { value: "mixed", label: "Mixed" },
      { value: "embers", label: "Embers" }
    ]
  },
  {
    key: "dof",
    section: "Depth of Field",
    kind: "boolean",
    label: "Enable DOF",
    description: "Enable the post-process depth of field pass.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.dof,
    queryStyle: "1-true"
  },
  {
    key: "doffocus",
    section: "Depth of Field",
    kind: "optionalNumber",
    label: "Manual Focus Distance",
    description: "Leave empty to focus on the orbit target.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.doffocus,
    min: 0.1,
    max: 500,
    step: 0.1
  },
  {
    key: "dofrange",
    section: "Depth of Field",
    kind: "number",
    label: "Focus Range",
    description: "Depth range around the focus plane that stays sharp.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.dofrange,
    min: 4,
    max: 120,
    step: 0.5
  },
  {
    key: "dofaperture",
    section: "Depth of Field",
    kind: "number",
    label: "Aperture",
    description: "Scales CoC intensity for the DOF pass.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.dofaperture,
    min: 0,
    max: 1.5,
    step: 0.01
  },
  {
    key: "dofradius",
    section: "Depth of Field",
    kind: "number",
    label: "Max Blur Radius",
    description: "Maximum blur radius in pixels for the DOF blur pass.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.dofradius,
    min: 1,
    max: 18,
    step: 0.5
  },
  {
    key: "dofscale",
    section: "Depth of Field",
    kind: "number",
    label: "Blur Buffer Scale",
    description: "Resolution scale for the blur buffers.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.dofscale,
    min: 0.25,
    max: 0.5,
    step: 0.05
  },
  {
    key: "dofnear",
    section: "Depth of Field",
    kind: "boolean",
    label: "Near Blur",
    description: "Enable near-field blur in addition to far blur.",
    defaultValue: DEFAULT_RUNTIME_SETTINGS.dofnear,
    queryStyle: "1-true"
  }
] as const;

export const RUNTIME_SETTING_SECTION_ORDER: ReadonlyArray<RuntimeSettingSection> = [
  "General",
  "Diagnostics",
  "3D Renderer",
  "3D FX",
  "Depth of Field"
];

const definitionMap = new Map<RuntimeSettingKey, RuntimeSettingDefinition>(
  RUNTIME_SETTING_DEFINITIONS.map((definition) => [definition.key, definition])
);

const sanitizeSetting = <K extends RuntimeSettingKey>(
  definition: RuntimeSettingDefinition<K>,
  value: unknown
): RuntimeSettings[K] => {
  if (definition.kind === "boolean") {
    if (typeof value === "boolean") {
      return value as RuntimeSettings[K];
    }
    if (typeof value === "string") {
      if (value === "1" || value.toLowerCase() === "true") {
        return true as RuntimeSettings[K];
      }
      if (value === "0" || value.toLowerCase() === "false") {
        return false as RuntimeSettings[K];
      }
    }
    return definition.defaultValue as RuntimeSettings[K];
  }

  if (definition.kind === "enum") {
    if (typeof value !== "string") {
      return definition.defaultValue as RuntimeSettings[K];
    }
    const match = definition.options.find((option) => option.value === value);
    return (match?.value ?? definition.defaultValue) as RuntimeSettings[K];
  }

  if (definition.kind === "optionalNumber") {
    if (value === null || value === undefined || value === "") {
      return null as RuntimeSettings[K];
    }
    const parsed = toFiniteNumber(value);
    if (parsed === null) {
      return definition.defaultValue as RuntimeSettings[K];
    }
    const min = definition.min ?? Number.NEGATIVE_INFINITY;
    const max = definition.max ?? Number.POSITIVE_INFINITY;
    return clamp(parsed, min, max) as RuntimeSettings[K];
  }

  const parsed = toFiniteNumber(value);
  if (parsed === null) {
    return definition.defaultValue as RuntimeSettings[K];
  }
  const min = definition.min ?? Number.NEGATIVE_INFINITY;
  const max = definition.max ?? Number.POSITIVE_INFINITY;
  return clamp(parsed, min, max) as RuntimeSettings[K];
};

const sanitizeRuntimeSettings = (value: unknown): RuntimeSettings => {
  const source = isRecord(value) ? value : {};
  const sanitized = { ...DEFAULT_RUNTIME_SETTINGS };
  RUNTIME_SETTING_DEFINITIONS.forEach((definition) => {
    sanitized[definition.key] = sanitizeSetting(
      definition as RuntimeSettingDefinition<RuntimeSettingKey>,
      source[definition.key]
    ) as never;
  });
  return sanitized;
};

const loadPersistedRuntimeSettings = (): RuntimeSettings => {
  if (typeof localStorage === "undefined") {
    return { ...DEFAULT_RUNTIME_SETTINGS };
  }
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    return { ...DEFAULT_RUNTIME_SETTINGS };
  }
  try {
    return sanitizeRuntimeSettings(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULT_RUNTIME_SETTINGS };
  }
};

const savePersistedRuntimeSettings = (settings: RuntimeSettings): void => {
  if (typeof localStorage === "undefined") {
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
};

const getQueryOverride = <K extends RuntimeSettingKey>(
  definition: RuntimeSettingDefinition<K>,
  params: URLSearchParams
): RuntimeSettings[K] | undefined => {
  const raw = params.get(definition.key);
  if (raw === null) {
    return undefined;
  }
  if (definition.kind === "boolean") {
    return (definition.queryStyle === "0-false" ? raw !== "0" : raw === "1") as RuntimeSettings[K];
  }
  return sanitizeSetting(definition, raw);
};

const loadQueryRuntimeOverrides = (): Partial<RuntimeSettings> => {
  if (typeof window === "undefined") {
    return {};
  }
  const params = new URLSearchParams(window.location.search);
  const overrides: Partial<RuntimeSettings> = {};
  RUNTIME_SETTING_DEFINITIONS.forEach((definition) => {
    const next = getQueryOverride(definition as RuntimeSettingDefinition<RuntimeSettingKey>, params);
    if (next !== undefined) {
      overrides[definition.key] = next as never;
    }
  });
  return overrides;
};

const hasOwnValue = (value: Partial<RuntimeSettings>): boolean => Object.keys(value).length > 0;

let currentRuntimeSettings: RuntimeSettings = (() => {
  const persisted = loadPersistedRuntimeSettings();
  const queryOverrides = loadQueryRuntimeOverrides();
  const merged = sanitizeRuntimeSettings({
    ...DEFAULT_RUNTIME_SETTINGS,
    ...persisted,
    ...queryOverrides
  });
  if (hasOwnValue(queryOverrides)) {
    savePersistedRuntimeSettings(merged);
  }
  return merged;
})();

const listeners = new Set<(settings: RuntimeSettings) => void>();

const notify = (): void => {
  const snapshot = { ...currentRuntimeSettings };
  listeners.forEach((listener) => listener(snapshot));
};

export const getRuntimeSettings = (): RuntimeSettings => ({ ...currentRuntimeSettings });

export const setRuntimeSetting = <K extends RuntimeSettingKey>(key: K, value: RuntimeSettings[K]): void => {
  const definition = definitionMap.get(key) as RuntimeSettingDefinition<K> | undefined;
  if (!definition) {
    return;
  }
  const nextValue = sanitizeSetting(definition, value);
  if (Object.is(currentRuntimeSettings[key], nextValue)) {
    return;
  }
  currentRuntimeSettings = {
    ...currentRuntimeSettings,
    [key]: nextValue
  };
  savePersistedRuntimeSettings(currentRuntimeSettings);
  notify();
};

export const updateRuntimeSettings = (settings: Partial<RuntimeSettings>): void => {
  let nextSettings = currentRuntimeSettings;
  let changed = false;
  (Object.keys(settings) as RuntimeSettingKey[]).forEach((key) => {
    const definition = definitionMap.get(key);
    if (!definition) {
      return;
    }
    const nextValue = sanitizeSetting(definition as RuntimeSettingDefinition<RuntimeSettingKey>, settings[key]);
    if (Object.is(nextSettings[key], nextValue)) {
      return;
    }
    nextSettings = {
      ...nextSettings,
      [key]: nextValue
    };
    changed = true;
  });
  if (!changed) {
    return;
  }
  currentRuntimeSettings = nextSettings;
  savePersistedRuntimeSettings(currentRuntimeSettings);
  notify();
};

export const resetRuntimeSettings = (): void => {
  currentRuntimeSettings = { ...DEFAULT_RUNTIME_SETTINGS };
  savePersistedRuntimeSettings(currentRuntimeSettings);
  notify();
};

export const subscribeRuntimeSettings = (listener: (settings: RuntimeSettings) => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
