import { RUNTIME_SETTING_DEFINITIONS } from "../../../persistence/runtimeSettings.js";
import type { SimulationSettingsWidgetModel } from "./models.js";
import type {
  AudioChannelId,
  RuntimePhaseActionSpec,
  RuntimeSurfaceId,
  RuntimeWidgetActionSpec,
  RuntimeWidgetContainerId,
  RuntimeWidgetId,
  RuntimeWidgetPlacement,
  RuntimeWidgetSpec
} from "./types.js";

export const PHASE_DOM_SETTINGS_WIDGET_CONTAINER = "phaseDom:settingsWidget";
export const PHASE_DOM_TOPBAR_CLIMATE_CONTAINER = "phaseDom:topBarClimate";
export const PHASE_DOM_PANEL_STACK_CONTAINER = "phaseDom:panelStack";

export const THREE_DOCK_CLIMATE_CARD_CONTAINER = "threeDock:climateCard";
export const THREE_DOCK_MINIMAP_CARD_CONTAINER = "threeDock:minimapCard";
export const THREE_DOCK_SETTINGS_CARD_CONTAINER = "threeDock:settingsCard";

export const CANVAS_HUD_TOPBAR_CONTAINER = "canvasHud:topBar";
export const CANVAS_HUD_SLOT_CONTAINER = "canvasHud:widgetSlots";

export const TIME_CONTROL_ACTIONS = {
  pause: { kind: "phaseAction", action: "pause" } as const,
  skipToNextFire: { kind: "phaseAction", action: "time-skip-next-fire" } as const,
  sliderSet: { kind: "phaseAction", action: "time-speed-slider-set" } as const,
  sliderStep: { kind: "phaseAction", action: "time-speed-step" } as const
};

export const getTimeSpeedAction = (index: number): RuntimePhaseActionSpec => ({
  kind: "phaseAction",
  action: `time-speed-${index}`
});

export type AudioControlChannelSpec = {
  id: AudioChannelId;
  label: string;
  defaultVolume: number;
  muteBinding: RuntimeWidgetActionSpec;
  volumeBinding: RuntimeWidgetActionSpec;
  mutedTitle: string;
  unmutedTitle: string;
  mutedAriaLabel: string;
  unmutedAriaLabel: string;
};

export const AUDIO_CONTROL_CHANNELS: readonly AudioControlChannelSpec[] = [
  {
    id: "sfx",
    label: "SFX",
    defaultVolume: 0.65,
    muteBinding: { kind: "audioChannel", channel: "sfx", operation: "mute" },
    volumeBinding: { kind: "audioChannel", channel: "sfx", operation: "volume" },
    mutedTitle: "Unmute UI SFX",
    unmutedTitle: "Mute UI SFX",
    mutedAriaLabel: "Unmute UI sound effects",
    unmutedAriaLabel: "Mute UI sound effects"
  },
  {
    id: "world",
    label: "World",
    defaultVolume: 0.55,
    muteBinding: { kind: "audioChannel", channel: "world", operation: "mute" },
    volumeBinding: { kind: "audioChannel", channel: "world", operation: "volume" },
    mutedTitle: "Unmute world audio",
    unmutedTitle: "Mute world audio",
    mutedAriaLabel: "Unmute world audio",
    unmutedAriaLabel: "Mute world audio"
  },
  {
    id: "music",
    label: "Music",
    defaultVolume: 0.35,
    muteBinding: { kind: "audioChannel", channel: "music", operation: "mute" },
    volumeBinding: { kind: "audioChannel", channel: "music", operation: "volume" },
    mutedTitle: "Unmute music",
    unmutedTitle: "Mute music",
    mutedAriaLabel: "Unmute music",
    unmutedAriaLabel: "Mute music"
  }
] as const;

type SimulationToggleSettingKey = keyof SimulationSettingsWidgetModel;

export type SimulationToggleSpec = {
  setting: SimulationToggleSettingKey;
  title: string;
  description: string;
  action: RuntimeWidgetActionSpec;
};

const runtimeSettingDefinitionsByKey = new Map(RUNTIME_SETTING_DEFINITIONS.map((definition) => [definition.key, definition] as const));

const getRuntimeSettingCopy = (setting: SimulationToggleSettingKey): { title: string; description: string } => {
  const definition = runtimeSettingDefinitionsByKey.get(setting);
  return {
    title: definition?.label ?? setting,
    description: definition?.description ?? ""
  };
};

const randomFireCopy = getRuntimeSettingCopy("randomFireIgnition");
const annualReportCopy = getRuntimeSettingCopy("annualReportEnabled");

export const SIMULATION_TOGGLE_SPECS: readonly SimulationToggleSpec[] = [
  {
    setting: "randomFireIgnition",
    title: randomFireCopy.title,
    description: randomFireCopy.description,
    action: { kind: "runtimeSetting", setting: "randomFireIgnition" }
  },
  {
    setting: "annualReportEnabled",
    title: annualReportCopy.title,
    description: annualReportCopy.description,
    action: { kind: "runtimeSetting", setting: "annualReportEnabled" }
  }
] as const;

const runtimeWidgetPlacements = <T extends readonly RuntimeWidgetPlacement[]>(placements: T): T => placements;

export const RUNTIME_WIDGET_SPECS: readonly RuntimeWidgetSpec[] = [
  {
    id: "timeControls",
    title: "Time Controls",
    shortTitle: "Time",
    description: "Strategic and incident time controls for the live session.",
    surfaceTitles: {
      phaseDom: "Time Controls",
      threeDock: "TIME",
      canvasHud: "Time"
    },
    placements: runtimeWidgetPlacements([
      {
        surface: "phaseDom",
        container: PHASE_DOM_SETTINGS_WIDGET_CONTAINER,
        region: "group",
        order: 10,
        visibleByDefault: true
      },
      {
        surface: "threeDock",
        container: THREE_DOCK_SETTINGS_CARD_CONTAINER,
        region: "summary",
        order: 10,
        visibleByDefault: true
      },
      {
        surface: "threeDock",
        container: THREE_DOCK_SETTINGS_CARD_CONTAINER,
        region: "details",
        order: 10,
        visibleByDefault: true
      },
      {
        surface: "canvasHud",
        container: CANVAS_HUD_TOPBAR_CONTAINER,
        region: "inline",
        order: 10,
        visibleByDefault: true
      }
    ]),
    actions: [
      TIME_CONTROL_ACTIONS.pause,
      TIME_CONTROL_ACTIONS.skipToNextFire,
      TIME_CONTROL_ACTIONS.sliderSet,
      TIME_CONTROL_ACTIONS.sliderStep
    ]
  },
  {
    id: "audioControls",
    title: "Audio Controls",
    shortTitle: "Audio",
    description: "Volume and mute controls for UI, world, and music channels.",
    surfaceTitles: {
      phaseDom: "Audio",
      threeDock: "AUDIO"
    },
    placements: runtimeWidgetPlacements([
      {
        surface: "phaseDom",
        container: PHASE_DOM_SETTINGS_WIDGET_CONTAINER,
        region: "group",
        order: 20,
        visibleByDefault: true
      },
      {
        surface: "threeDock",
        container: THREE_DOCK_SETTINGS_CARD_CONTAINER,
        region: "details",
        order: 20,
        visibleByDefault: true
      }
    ]),
    actions: AUDIO_CONTROL_CHANNELS.flatMap((channel) => [channel.muteBinding, channel.volumeBinding])
  },
  {
    id: "simulationSettings",
    title: "Simulation Settings",
    shortTitle: "Simulation",
    description: "Runtime testing toggles that can suppress random ignitions or the annual report.",
    surfaceTitles: {
      phaseDom: "Testing",
      threeDock: "TESTING"
    },
    placements: runtimeWidgetPlacements([
      {
        surface: "phaseDom",
        container: PHASE_DOM_SETTINGS_WIDGET_CONTAINER,
        region: "group",
        order: 30,
        visibleByDefault: true
      },
      {
        surface: "threeDock",
        container: THREE_DOCK_SETTINGS_CARD_CONTAINER,
        region: "details",
        order: 30,
        visibleByDefault: true
      }
    ]),
    actions: SIMULATION_TOGGLE_SPECS.map((toggle) => toggle.action)
  },
  {
    id: "climate",
    title: "Climate Forecast",
    shortTitle: "Climate",
    description: "Forecast and risk outlook widget used by every runtime surface.",
    surfaceTitles: {
      phaseDom: "Forecast",
      threeDock: "FIRE RISK",
      canvasHud: "Climate"
    },
    placements: runtimeWidgetPlacements([
      {
        surface: "phaseDom",
        container: PHASE_DOM_TOPBAR_CLIMATE_CONTAINER,
        region: "panel",
        order: 10,
        visibleByDefault: true
      },
      {
        surface: "threeDock",
        container: THREE_DOCK_CLIMATE_CARD_CONTAINER,
        region: "summary",
        order: 10,
        visibleByDefault: true
      },
      {
        surface: "canvasHud",
        container: CANVAS_HUD_SLOT_CONTAINER,
        region: "slot",
        order: 10,
        visibleByDefault: true
      }
    ]),
    actions: []
  },
  {
    id: "minimap",
    title: "Map",
    shortTitle: "Minimap",
    description: "Runtime minimap surface for panning and map-state inspection.",
    surfaceTitles: {
      phaseDom: "Map",
      threeDock: "MINIMAP",
      canvasHud: "Minimap"
    },
    placements: runtimeWidgetPlacements([
      {
        surface: "phaseDom",
        container: PHASE_DOM_PANEL_STACK_CONTAINER,
        region: "panel",
        order: 10,
        visibleByDefault: true
      },
      {
        surface: "threeDock",
        container: THREE_DOCK_MINIMAP_CARD_CONTAINER,
        region: "summary",
        order: 10,
        visibleByDefault: true
      },
      {
        surface: "threeDock",
        container: THREE_DOCK_MINIMAP_CARD_CONTAINER,
        region: "details",
        order: 10,
        visibleByDefault: true
      },
      {
        surface: "canvasHud",
        container: CANVAS_HUD_SLOT_CONTAINER,
        region: "slot",
        order: 20,
        visibleByDefault: true
      }
    ]),
    actions: []
  }
] as const;

const runtimeWidgetSpecsById = new Map(RUNTIME_WIDGET_SPECS.map((spec) => [spec.id, spec] as const));

export type CanvasHudWidgetId = Extract<RuntimeWidgetId, "climate" | "minimap">;

export const getRuntimeWidgetSpec = (widgetId: RuntimeWidgetId): RuntimeWidgetSpec => {
  const spec = runtimeWidgetSpecsById.get(widgetId);
  if (!spec) {
    throw new Error(`Unknown runtime widget: ${widgetId}`);
  }
  return spec;
};

export const getRuntimeWidgetTitle = (widgetId: RuntimeWidgetId, surface?: RuntimeSurfaceId): string => {
  const spec = getRuntimeWidgetSpec(widgetId);
  return (surface ? spec.surfaceTitles?.[surface] : undefined) ?? spec.title;
};

export const getRuntimeWidgetPlacement = (
  widgetId: RuntimeWidgetId,
  surface: RuntimeSurfaceId,
  container?: RuntimeWidgetContainerId
): RuntimeWidgetPlacement | null => {
  const spec = getRuntimeWidgetSpec(widgetId);
  return getRuntimeWidgetPlacements(widgetId, surface, container)[0] ?? null;
};

export const getRuntimeWidgetPlacements = (
  widgetId: RuntimeWidgetId,
  surface: RuntimeSurfaceId,
  container?: RuntimeWidgetContainerId
): RuntimeWidgetPlacement[] => {
  const spec = getRuntimeWidgetSpec(widgetId);
  return spec.placements.filter(
    (placement) => placement.surface === surface && (container === undefined || placement.container === container)
  );
};

export const getRuntimeWidgetsForSurface = (surface: RuntimeSurfaceId): RuntimeWidgetSpec[] =>
  RUNTIME_WIDGET_SPECS.filter((spec) => spec.placements.some((placement) => placement.surface === surface)).sort((left, right) => {
    const leftOrder = Math.min(
      ...getRuntimeWidgetPlacements(left.id, surface).map((placement) => placement.order),
      Number.MAX_SAFE_INTEGER
    );
    const rightOrder = Math.min(
      ...getRuntimeWidgetPlacements(right.id, surface).map((placement) => placement.order),
      Number.MAX_SAFE_INTEGER
    );
    return leftOrder - rightOrder;
  });

export const getRuntimeWidgetsForContainer = (
  surface: RuntimeSurfaceId,
  container: RuntimeWidgetContainerId,
  region?: string
): RuntimeWidgetSpec[] =>
  getRuntimeWidgetsForSurface(surface).filter((spec) => {
    const placements = getRuntimeWidgetPlacements(spec.id, surface, container);
    return placements.some((placement) => region === undefined || placement.region === region);
  });

export const getCanvasHudSlotWidgetIds = (): CanvasHudWidgetId[] =>
  getRuntimeWidgetsForContainer("canvasHud", CANVAS_HUD_SLOT_CONTAINER, "slot").map((spec) => spec.id as CanvasHudWidgetId);
