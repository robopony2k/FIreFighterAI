import type { RuntimeSettingKey } from "../../../persistence/runtimeSettings.js";

export type RuntimeSurfaceId = "phaseDom" | "threeDock" | "canvasHud";

export type RuntimeWidgetId = "timeControls" | "audioControls" | "simulationSettings" | "climate" | "minimap";

export type RuntimeWidgetContainerId = string;
export type RuntimeWidgetRegionId = string;

export type AudioChannelId = "sfx" | "world" | "music";

export type RuntimeWidgetActionSpec =
  | {
      kind: "phaseAction";
      action: string;
      payload?: Record<string, string>;
    }
  | {
      kind: "runtimeSetting";
      setting: RuntimeSettingKey;
    }
  | {
      kind: "audioChannel";
      channel: AudioChannelId;
      operation: "mute" | "volume";
    };

export type RuntimePhaseActionSpec = Extract<RuntimeWidgetActionSpec, { kind: "phaseAction" }>;

export type RuntimeWidgetPlacement = {
  surface: RuntimeSurfaceId;
  container: RuntimeWidgetContainerId;
  region: RuntimeWidgetRegionId;
  order: number;
  visibleByDefault: boolean;
};

export type RuntimeWidgetSpec = {
  id: RuntimeWidgetId;
  title: string;
  shortTitle: string;
  description: string;
  surfaceTitles?: Partial<Record<RuntimeSurfaceId, string>>;
  placements: readonly RuntimeWidgetPlacement[];
  actions: readonly RuntimeWidgetActionSpec[];
};
