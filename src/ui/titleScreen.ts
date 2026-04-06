import { loadLeaderboard } from "../persistence/leaderboard.js";
import {
  RUNTIME_SETTING_DEFINITIONS,
  type RuntimeSettingKey,
  type RuntimeSettings
} from "../persistence/runtimeSettings.js";
import { renderTitleFlameField } from "./title-screen/titleFlameField.js";
import { createTitleFlameProgram, type TitleFlameProgram } from "./title-screen/titleFlameProgram.js";

type TitleMenuAction = "new-game" | "map-editor" | "fx-lab" | "settings" | "high-score" | "credits" | "quit";

type TitleMenuOption = {
  id: TitleMenuAction;
  label: string;
};

type EmberParticle = {
  x: number;
  y: number;
  px: number;
  py: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  brightness: number;
};

type TrackedGlyphSpan = {
  glyph: string;
  index: number;
  x: number;
  width: number;
  leftX: number;
  rightX: number;
  centerX: number;
};

type TitleLayout = {
  width: number;
  height: number;
  fontSize: number;
  letterSpacing: number;
  centerX: number;
  centerY: number;
  outline: number;
  font: string;
  spans: TrackedGlyphSpan[];
};

type FlameEmitterAnchor = {
  index: number;
  centerX: number;
  leftX: number;
  rightX: number;
  halfWidth: number;
  baseY: number;
  strength: number;
  seed: number;
};

export type TitleAudioChannelSettings = {
  muted: boolean;
  volume: number;
};

export type TitleAudioChannelControls = {
  getSettings: () => TitleAudioChannelSettings;
  setMuted: (muted: boolean) => void;
  setVolume: (volume: number) => void;
  onChange: (listener: (settings: TitleAudioChannelSettings) => void) => () => void;
};

export type TitleAudioControls = {
  sfx: TitleAudioChannelControls;
  music: TitleAudioChannelControls;
  world: TitleAudioChannelControls;
};

export type TitleRuntimeSettingsControls = {
  getSettings: () => RuntimeSettings;
  setSetting: (key: RuntimeSettingKey, value: RuntimeSettings[RuntimeSettingKey]) => void;
  updateSettings: (settings: Partial<RuntimeSettings>) => void;
  reset: () => void;
  onChange: (listener: (settings: RuntimeSettings) => void) => () => void;
};

export type TitleScreenDeps = {
  mount?: HTMLElement;
  onNewGame: () => void;
  onMapEditor: () => void;
  onFxLab: () => void;
  onQuit: () => void;
  audioControls?: TitleAudioControls;
  runtimeSettings?: TitleRuntimeSettingsControls;
};

export type TitleScreenHandle = {
  destroy: () => void;
  isVisible: () => boolean;
};

const TITLE_WORD = "EMBERWATCH";
const TITLE_SUBTITLE = "Fireline Command";
const TITLE_FONT_WEIGHT = 800;
const TITLE_FONT_FAMILY = '"Impact", "Arial Black", "Franklin Gothic Heavy", "Segoe UI", sans-serif';
const TITLE_MENU_OPTIONS: readonly TitleMenuOption[] = [
  { id: "new-game", label: "New Game" },
  { id: "map-editor", label: "Map Editor" },
  { id: "fx-lab", label: "FX Lab" },
  { id: "settings", label: "Settings" },
  { id: "high-score", label: "High Score" },
  { id: "credits", label: "Credits" },
  { id: "quit", label: "Quit" }
];
const TITLE_MAX_FLAME_GLYPHS = 16;
const TITLE_ACTIVE_FLAME_GLYPHS = Math.min(TITLE_WORD.length, TITLE_MAX_FLAME_GLYPHS);

const FIRE_WIDTH = 400;
const FIRE_HEIGHT = 260;
const FIRE_LEVELS = 48;
const FIRE_UPDATE_MS = 34;
const EMITTER_REBUILD_MS = 64;
const TITLE_FLAME_MOTION_TIME_SCALE = 0.44;
const INTRO_EMBER_DELAY_MS = 0;
const INTRO_FLAME_DELAY_MS = 420;
const INTRO_SILHOUETTE_DELAY_MS = 1360;
const INTRO_OUTLINE_DELAY_MS = 2140;
const INTRO_EMBER_FADE_MS = 760;
const INTRO_FLAME_FADE_MS = 1800;
const INTRO_SILHOUETTE_FADE_MS = 900;
const INTRO_OUTLINE_FADE_MS = 1200;

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const hash01 = (n: number): number => {
  let x = n | 0;
  x = (x ^ 61) ^ (x >>> 16);
  x = x + (x << 3);
  x = x ^ (x >>> 4);
  x = Math.imul(x, 0x27d4eb2d);
  x = x ^ (x >>> 15);
  return (x >>> 0) / 4294967295;
};

const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

type SettingsTabId = "sound" | "graphics" | "debug";
type SettingsTabSpec = {
  id: SettingsTabId;
  label: string;
  panel: HTMLElement;
};

type RuntimeSettingsSectionSpec = {
  title: string;
  keys: ReadonlyArray<RuntimeSettingKey>;
};

type GraphicsQualityPresetId = "auto" | "performance" | "balanced" | "quality";
type GraphicsQualityPreset = {
  id: GraphicsQualityPresetId;
  label: string;
  description: string;
  settings: Pick<RuntimeSettings, "autodpr" | "dpr" | "mindpr" | "waterq" | "shadowres">;
};

const GRAPHICS_QUALITY_CUSTOM_ID = "custom";
const GRAPHICS_QUALITY_PRESETS: ReadonlyArray<GraphicsQualityPreset> = [
  {
    id: "auto",
    label: "Auto",
    description: "Uses adaptive scaling to hold frame rate without exposing raw render-scale values.",
    settings: {
      autodpr: true,
      dpr: 1.5,
      mindpr: 1,
      waterq: "balanced",
      shadowres: 2048
    }
  },
  {
    id: "performance",
    label: "Performance",
    description: "Prioritizes smoother frame time on slower GPUs and higher-resolution displays.",
    settings: {
      autodpr: false,
      dpr: 1,
      mindpr: 0.75,
      waterq: "fast",
      shadowres: 1024
    }
  },
  {
    id: "balanced",
    label: "Balanced",
    description: "Keeps image quality solid while leaving adaptive headroom for heavier scenes.",
    settings: {
      autodpr: true,
      dpr: 1.25,
      mindpr: 0.9,
      waterq: "balanced",
      shadowres: 2048
    }
  },
  {
    id: "quality",
    label: "Quality",
    description: "Sharper rendering, heavier shadows, and higher water quality at a higher GPU cost.",
    settings: {
      autodpr: false,
      dpr: 2,
      mindpr: 1,
      waterq: "high",
      shadowres: 4096
    }
  }
];

const GRAPHICS_SETTINGS_SECTIONS: ReadonlyArray<RuntimeSettingsSectionSpec> = [
  {
    title: "Overview",
    keys: ["render", "fps", "seasonal", "cinematic"]
  },
  {
    title: "Depth of Field",
    keys: ["dof", "doffocus", "dofrange", "dofaperture", "dofradius", "dofscale", "dofnear"]
  }
];

const DEBUG_SETTINGS_SECTIONS: ReadonlyArray<RuntimeSettingsSectionSpec> = [
  {
    title: "Diagnostics",
    keys: ["perf", "perflog", "simprof"]
  },
  {
    title: "Advanced Rendering",
    keys: ["hud", "nohud", "autodpr", "dpr", "mindpr", "waterq", "shadowres", "nofx", "fxbudget", "fxfallback", "firewall", "firevol"]
  },
  {
    title: "3D Debug",
    keys: ["nosim", "noterrain", "rivercam", "rivercamlock", "sparkdebug", "headless"]
  }
];

const buildSettingsPanel = (
  body: HTMLElement,
  audioControls: TitleAudioControls | undefined,
  runtimeSettings: TitleRuntimeSettingsControls | undefined,
  registerDispose: (dispose: () => void) => void
): void => {
  if (!audioControls && !runtimeSettings) {
    const note = document.createElement("p");
    note.className = "title-screen-panel-note";
    note.textContent = "Settings are unavailable in this build.";
    body.appendChild(note);
    return;
  }

  const createSection = (titleText: string): HTMLElement => {
    const section = document.createElement("section");
    section.className = "title-screen-settings-section";
    const title = document.createElement("h3");
    title.className = "title-screen-settings-section-title";
    title.textContent = titleText;
    section.appendChild(title);
    return section;
  };

  const createChannelControls = (label: string, controls: TitleAudioChannelControls, sliderId: string, muteId: string): HTMLDivElement => {
    const row = document.createElement("div");
    row.className = "title-screen-setting";

    const title = document.createElement("span");
    title.textContent = label;

    const muteWrap = document.createElement("label");
    muteWrap.className = "title-screen-setting-inline";
    muteWrap.htmlFor = muteId;
    const muteInput = document.createElement("input");
    muteInput.id = muteId;
    muteInput.type = "checkbox";
    const muteText = document.createElement("span");
    muteText.textContent = "Mute";
    muteWrap.append(muteInput, muteText);

    const volumeWrap = document.createElement("label");
    volumeWrap.className = "title-screen-setting-inline";
    volumeWrap.htmlFor = sliderId;
    const volumeText = document.createElement("span");
    volumeText.textContent = "Volume";
    const slider = document.createElement("input");
    slider.id = sliderId;
    slider.type = "range";
    slider.min = "0";
    slider.max = "1";
    slider.step = "0.01";
    const value = document.createElement("span");
    value.className = "title-screen-setting-value";
    volumeWrap.append(volumeText, slider, value);

    const apply = (settingsSnapshot: TitleAudioChannelSettings): void => {
      const volume = clamp(settingsSnapshot.volume, 0, 1);
      muteInput.checked = settingsSnapshot.muted;
      slider.value = volume.toFixed(2);
      slider.disabled = settingsSnapshot.muted;
      value.textContent = `${Math.round(volume * 100)}%`;
    };

    apply(controls.getSettings());
    registerDispose(controls.onChange(apply));

    muteInput.addEventListener("change", () => {
      controls.setMuted(muteInput.checked);
    });
    slider.addEventListener("input", () => {
      const next = Number(slider.value);
      if (!Number.isFinite(next)) {
        return;
      }
      controls.setVolume(next);
    });

    row.append(title, muteWrap, volumeWrap);
    return row;
  };

  const tabs: SettingsTabSpec[] = [];

  if (audioControls) {
    const panel = document.createElement("div");
    panel.className = "title-screen-settings-tab-panel";

    const audioSection = createSection("Audio");
    const settings = document.createElement("div");
    settings.className = "title-screen-settings";
    settings.append(
      createChannelControls("Music", audioControls.music, "title-settings-music-volume", "title-settings-music-mute"),
      createChannelControls("Sound FX", audioControls.sfx, "title-settings-sfx-volume", "title-settings-sfx-mute"),
      createChannelControls("World", audioControls.world, "title-settings-world-volume", "title-settings-world-mute")
    );
    const note = document.createElement("p");
    note.className = "title-screen-panel-note";
    note.textContent = "These audio settings are shared with in-game controls.";
    audioSection.append(settings, note);
    panel.appendChild(audioSection);
    tabs.push({ id: "sound", label: "Sound", panel });
  }

  if (runtimeSettings) {
    const definitionByKey = new Map(
      RUNTIME_SETTING_DEFINITIONS.map((definition) => [definition.key, definition] as const)
    );
    const rows = new Map<RuntimeSettingKey, HTMLDivElement>();
    const dofDetailKeys: ReadonlyArray<RuntimeSettingKey> = ["doffocus", "dofrange", "dofaperture", "dofradius", "dofscale", "dofnear"];

    let qualitySelect: HTMLSelectElement | null = null;
    let qualityDescription: HTMLParagraphElement | null = null;

    const getDefinition = (key: RuntimeSettingKey) => definitionByKey.get(key);

    const createBooleanRow = (key: RuntimeSettingKey, label: string, description: string): HTMLDivElement => {
      const row = document.createElement("div");
      row.className = "title-screen-setting";
      const title = document.createElement("span");
      title.textContent = label;
      const desc = document.createElement("p");
      desc.className = "title-screen-setting-description";
      desc.textContent = description;

      const wrap = document.createElement("label");
      wrap.className = "title-screen-setting-inline";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.addEventListener("change", () => {
        runtimeSettings.setSetting(key, input.checked as RuntimeSettings[RuntimeSettingKey]);
      });
      const stateLabel = document.createElement("span");
      stateLabel.textContent = "Enabled";
      wrap.append(input, stateLabel);
      row.append(title, desc, wrap);
      rows.set(key, row);
      return row;
    };

    const createNumberRow = (
      key: RuntimeSettingKey,
      label: string,
      description: string,
      min?: number,
      max?: number,
      step?: number,
      optional = false
    ): HTMLDivElement => {
      const row = document.createElement("div");
      row.className = "title-screen-setting";
      const title = document.createElement("span");
      title.textContent = label;
      const desc = document.createElement("p");
      desc.className = "title-screen-setting-description";
      desc.textContent = description;

      const wrap = document.createElement("label");
      wrap.className = "title-screen-setting-inline";
      const valueText = document.createElement("span");
      valueText.textContent = optional ? "Value (blank = auto)" : "Value";
      const input = document.createElement("input");
      input.className = "title-screen-setting-number";
      input.type = "number";
      if (min !== undefined) {
        input.min = `${min}`;
      }
      if (max !== undefined) {
        input.max = `${max}`;
      }
      if (step !== undefined) {
        input.step = `${step}`;
      }
      input.addEventListener("change", () => {
        if (optional && input.value.trim().length === 0) {
          runtimeSettings.setSetting(key, null as RuntimeSettings[RuntimeSettingKey]);
          return;
        }
        const next = Number(input.value);
        if (!Number.isFinite(next)) {
          return;
        }
        runtimeSettings.setSetting(key, next as RuntimeSettings[RuntimeSettingKey]);
      });
      wrap.append(valueText, input);
      row.append(title, desc, wrap);
      rows.set(key, row);
      return row;
    };

    const createEnumRow = (
      key: RuntimeSettingKey,
      label: string,
      description: string,
      options: ReadonlyArray<{ value: RuntimeSettings[RuntimeSettingKey]; label: string }>
    ): HTMLDivElement => {
      const row = document.createElement("div");
      row.className = "title-screen-setting";
      const title = document.createElement("span");
      title.textContent = label;
      const desc = document.createElement("p");
      desc.className = "title-screen-setting-description";
      desc.textContent = description;

      const wrap = document.createElement("label");
      wrap.className = "title-screen-setting-inline";
      const valueText = document.createElement("span");
      valueText.textContent = "Mode";
      const select = document.createElement("select");
      select.className = "title-screen-setting-select";
      options.forEach((option) => {
        const entry = document.createElement("option");
        entry.value = `${option.value}`;
        entry.textContent = option.label;
        select.appendChild(entry);
      });
      select.addEventListener("change", () => {
        const selected = options.find((option) => `${option.value}` === select.value);
        if (!selected) {
          return;
        }
        runtimeSettings.setSetting(key, selected.value);
      });
      wrap.append(valueText, select);
      row.append(title, desc, wrap);
      rows.set(key, row);
      return row;
    };

    const buildRowForKey = (key: RuntimeSettingKey): HTMLDivElement | null => {
      const definition = getDefinition(key);
      if (!definition) {
        return null;
      }
      if (definition.kind === "boolean") {
        return createBooleanRow(definition.key, definition.label, definition.description);
      }
      if (definition.kind === "enum") {
        return createEnumRow(definition.key, definition.label, definition.description, definition.options);
      }
      return createNumberRow(
        definition.key,
        definition.label,
        definition.description,
        definition.min,
        definition.max,
        definition.step,
        definition.kind === "optionalNumber"
      );
    };

    const createRuntimeSections = (sections: ReadonlyArray<RuntimeSettingsSectionSpec>): HTMLElement => {
      const root = document.createElement("div");
      root.className = "title-screen-runtime-settings";
      sections.forEach((sectionSpec) => {
        const section = createSection(sectionSpec.title);
        const sectionBody = document.createElement("div");
        sectionBody.className = "title-screen-settings";
        sectionSpec.keys.forEach((key) => {
          const row = buildRowForKey(key);
          if (row) {
            sectionBody.appendChild(row);
          }
        });
        section.appendChild(sectionBody);
        root.appendChild(section);
      });
      return root;
    };

    const resolveGraphicsQualityPreset = (settingsSnapshot: RuntimeSettings): GraphicsQualityPresetId | typeof GRAPHICS_QUALITY_CUSTOM_ID => {
      const match = GRAPHICS_QUALITY_PRESETS.find((preset) => {
        const presetSettings = preset.settings;
        return (
          settingsSnapshot.autodpr === presetSettings.autodpr &&
          settingsSnapshot.dpr === presetSettings.dpr &&
          settingsSnapshot.mindpr === presetSettings.mindpr &&
          settingsSnapshot.waterq === presetSettings.waterq &&
          settingsSnapshot.shadowres === presetSettings.shadowres
        );
      });
      return match?.id ?? GRAPHICS_QUALITY_CUSTOM_ID;
    };

    const createGraphicsQualityRow = (): HTMLDivElement => {
      const row = document.createElement("div");
      row.className = "title-screen-setting title-screen-setting--feature";
      const title = document.createElement("span");
      title.textContent = "Graphics Quality";
      const desc = document.createElement("p");
      desc.className = "title-screen-setting-description";
      desc.textContent = "Choose a preset instead of tuning render scale directly. Raw render-scale controls remain under Debug.";

      const wrap = document.createElement("label");
      wrap.className = "title-screen-setting-inline";
      const valueText = document.createElement("span");
      valueText.textContent = "Preset";
      qualitySelect = document.createElement("select");
      qualitySelect.className = "title-screen-setting-select";
      GRAPHICS_QUALITY_PRESETS.forEach((preset) => {
        const entry = document.createElement("option");
        entry.value = preset.id;
        entry.textContent = preset.label;
        qualitySelect?.appendChild(entry);
      });
      const customEntry = document.createElement("option");
      customEntry.value = GRAPHICS_QUALITY_CUSTOM_ID;
      customEntry.textContent = "Custom";
      qualitySelect.appendChild(customEntry);
      qualitySelect.addEventListener("change", () => {
        const nextPreset = GRAPHICS_QUALITY_PRESETS.find((preset) => preset.id === qualitySelect?.value);
        if (!nextPreset) {
          return;
        }
        runtimeSettings.updateSettings(nextPreset.settings);
      });
      wrap.append(valueText, qualitySelect);

      qualityDescription = document.createElement("p");
      qualityDescription.className = "title-screen-setting-detail";
      row.append(title, desc, wrap, qualityDescription);
      return row;
    };

    const createGraphicsPanel = (): HTMLElement => {
      const panel = document.createElement("div");
      panel.className = "title-screen-settings-tab-panel";

      const qualitySection = createSection("Quality");
      const qualityBody = document.createElement("div");
      qualityBody.className = "title-screen-settings";
      qualityBody.appendChild(createGraphicsQualityRow());
      qualitySection.appendChild(qualityBody);

      const graphicsNote = document.createElement("p");
      graphicsNote.className = "title-screen-panel-note";
      graphicsNote.textContent = "Graphics presets update resolution scaling, water quality, and shadow resolution together.";

      panel.append(qualitySection, graphicsNote, createRuntimeSections(GRAPHICS_SETTINGS_SECTIONS));
      return panel;
    };

    const createDebugPanel = (): HTMLElement => {
      const panel = document.createElement("div");
      panel.className = "title-screen-settings-tab-panel";
      const note = document.createElement("p");
      note.className = "title-screen-panel-note";
      note.textContent = "Lower-level renderer and diagnostics controls. Most players can leave these alone.";
      panel.append(note, createRuntimeSections(DEBUG_SETTINGS_SECTIONS));
      return panel;
    };

    const applyRuntimeSettings = (settingsSnapshot: RuntimeSettings): void => {
      RUNTIME_SETTING_DEFINITIONS.forEach((definition) => {
        const row = rows.get(definition.key);
        if (!row) {
          return;
        }
        if (definition.kind === "boolean") {
          const input = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
          if (input) {
            input.checked = Boolean(settingsSnapshot[definition.key]);
          }
          return;
        }
        if (definition.kind === "enum") {
          const select = row.querySelector<HTMLSelectElement>("select");
          if (select) {
            select.value = `${settingsSnapshot[definition.key]}`;
          }
          return;
        }
        const input = row.querySelector<HTMLInputElement>('input[type="number"]');
        if (!input) {
          return;
        }
        const value = settingsSnapshot[definition.key];
        input.value = value === null || value === undefined ? "" : `${value}`;
      });

      const qualityPreset = resolveGraphicsQualityPreset(settingsSnapshot);
      if (qualitySelect) {
        qualitySelect.value = qualityPreset;
      }
      if (qualityDescription) {
        if (qualityPreset === GRAPHICS_QUALITY_CUSTOM_ID) {
          qualityDescription.textContent = "Using a custom mix of render scale, water quality, and shadow settings.";
        } else {
          qualityDescription.textContent =
            GRAPHICS_QUALITY_PRESETS.find((preset) => preset.id === qualityPreset)?.description ?? "";
        }
      }

      dofDetailKeys.forEach((key) => {
        const row = rows.get(key);
        if (!row) {
          return;
        }
        const disabled = !settingsSnapshot.dof;
        row.classList.toggle("title-screen-setting--disabled", disabled);
        row.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((input) => {
          input.disabled = disabled;
        });
      });
    };

    const graphicsPanel = createGraphicsPanel();
    const debugPanel = createDebugPanel();
    applyRuntimeSettings(runtimeSettings.getSettings());
    registerDispose(runtimeSettings.onChange(applyRuntimeSettings));

    tabs.push({ id: "graphics", label: "Graphics", panel: graphicsPanel });
    tabs.push({ id: "debug", label: "Debug", panel: debugPanel });
  }

  const shell = document.createElement("div");
  shell.className = "title-screen-settings-shell";
  const tabList = document.createElement("div");
  tabList.className = "title-screen-settings-tabs";
  tabList.setAttribute("role", "tablist");
  const panelRoot = document.createElement("div");
  panelRoot.className = "title-screen-settings-panels";
  const tabButtons = new Map<SettingsTabId, HTMLButtonElement>();

  const setActiveTab = (tabId: SettingsTabId): void => {
    tabs.forEach((tab) => {
      const active = tab.id === tabId;
      tab.panel.classList.toggle("hidden", !active);
      tab.panel.setAttribute("aria-hidden", active ? "false" : "true");
      const button = tabButtons.get(tab.id);
      if (button) {
        button.classList.toggle("title-screen-settings-tab--active", active);
        button.setAttribute("aria-selected", active ? "true" : "false");
      }
    });
  };

  tabs.forEach((tab) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "title-screen-settings-tab";
    button.textContent = tab.label;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", "false");
    button.addEventListener("click", () => setActiveTab(tab.id));
    tabButtons.set(tab.id, button);
    tabList.appendChild(button);
    panelRoot.appendChild(tab.panel);
  });

  if (tabs.length > 1) {
    shell.append(tabList, panelRoot);
  } else if (tabs[0]) {
    shell.appendChild(tabs[0].panel);
  }

  if (runtimeSettings) {
    const actions = document.createElement("div");
    actions.className = "title-screen-setting-actions";
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "title-screen-setting-reset";
    resetButton.textContent = "Reset Runtime Settings";
    resetButton.addEventListener("click", () => {
      runtimeSettings.reset();
    });
    actions.appendChild(resetButton);

    const note = document.createElement("p");
    note.className = "title-screen-panel-note";
    note.textContent =
      "Runtime settings are saved automatically. URL parameters still work as overrides and are imported into saved settings.";

    shell.append(actions, note);
  }

  body.appendChild(shell);
  if (tabs[0]) {
    setActiveTab(tabs[0].id);
  }
};

const buildHighScorePanel = (body: HTMLElement): void => {
  const entries = loadLeaderboard();
  if (entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "title-screen-panel-note";
    empty.textContent = "No scores yet.";
    body.appendChild(empty);
    return;
  }
  const list = document.createElement("ol");
  list.className = "title-screen-score-list";
  entries.slice(0, 8).forEach((entry) => {
    const row = document.createElement("li");
    const date = Number.isFinite(entry.date) ? new Date(entry.date).toLocaleDateString() : "Unknown date";
    row.textContent = `${entry.name}  |  ${Math.round(entry.score)} pts  |  Seed ${entry.seed}  |  ${date}`;
    list.appendChild(row);
  });
  body.appendChild(list);
};

const buildCreditsPanel = (body: HTMLElement): void => {
  const credits = document.createElement("div");
  credits.className = "title-screen-credits";
  credits.innerHTML = `
    <p><strong>EMBERWATCH</strong> is a command-scale wildfire prototype.</p>
    <p>Design & Direction: Fireline Team</p>
    <p>Simulation Systems: Core Runtime Group</p>
    <p>Rendering & Tools: Engine + Three.js Pipeline</p>
    <p>Audio Direction: Incident Ops Audio Lab</p>
    <p>Special Thanks: Community playtest crews and responders.</p>
    <p>This panel is intentionally minimal and can be replaced with production credits later.</p>
  `;
  body.appendChild(credits);
};

export const showTitleScreen = (deps: TitleScreenDeps): TitleScreenHandle => {
  const mount = deps.mount ?? document.body;
  const root = document.createElement("section");
  root.className = "title-screen title-screen--intro-sequence";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", "EMBERWATCH title screen");
  root.tabIndex = -1;

  const shell = document.createElement("div");
  shell.className = "title-screen-shell";

  const titleCanvas = document.createElement("canvas");
  titleCanvas.className = "title-screen-logo";
  titleCanvas.setAttribute("aria-label", TITLE_WORD);
  titleCanvas.setAttribute("role", "img");

  const subtitle = document.createElement("p");
  subtitle.className = "title-screen-subtitle";
  subtitle.textContent = TITLE_SUBTITLE;

  const menu = document.createElement("nav");
  menu.className = "title-screen-menu";
  menu.setAttribute("aria-label", "Main menu");

  const panelBackdrop = document.createElement("div");
  panelBackdrop.className = "title-screen-panel-backdrop hidden";

  const panel = document.createElement("div");
  panel.className = "title-screen-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-label", "Title screen panel");

  const panelTitle = document.createElement("h2");
  panelTitle.className = "title-screen-panel-title";

  const panelBody = document.createElement("div");
  panelBody.className = "title-screen-panel-body";

  const panelBack = document.createElement("button");
  panelBack.type = "button";
  panelBack.className = "title-screen-panel-back";
  panelBack.textContent = "Back";

  panel.append(panelTitle, panelBody, panelBack);
  panelBackdrop.appendChild(panel);
  shell.append(titleCanvas, subtitle, menu);
  root.append(shell, panelBackdrop);
  mount.appendChild(root);

  const titleCtx = titleCanvas.getContext("2d");
  if (!titleCtx) {
    throw new Error("Title screen canvas not supported.");
  }
  let fireCanvas = document.createElement("canvas");
  fireCanvas.width = FIRE_WIDTH;
  fireCanvas.height = FIRE_HEIGHT;
  let fireProgram: TitleFlameProgram | null = null;
  let fireCtx: CanvasRenderingContext2D | null = null;
  let fireImageData: ImageData | null = null;
  try {
    fireProgram = createTitleFlameProgram(fireCanvas);
  } catch {
    fireCanvas = document.createElement("canvas");
    fireCanvas.width = FIRE_WIDTH;
    fireCanvas.height = FIRE_HEIGHT;
    fireCtx = fireCanvas.getContext("2d");
    if (!fireCtx) {
      throw new Error("Offscreen fire canvas not supported.");
    }
    fireImageData = fireCtx.createImageData(FIRE_WIDTH, FIRE_HEIGHT);
  }
  const glyphMaskCanvas = document.createElement("canvas");
  const glyphMaskCtx = glyphMaskCanvas.getContext("2d");
  if (!glyphMaskCtx) {
    throw new Error("Glyph mask canvas not supported.");
  }
  const strokeMaskCanvas = document.createElement("canvas");
  const strokeMaskCtx = strokeMaskCanvas.getContext("2d");
  if (!strokeMaskCtx) {
    throw new Error("Stroke mask canvas not supported.");
  }
  const glowMaskCanvas = document.createElement("canvas");
  const glowMaskCtx = glowMaskCanvas.getContext("2d");
  if (!glowMaskCtx) {
    throw new Error("Glow mask canvas not supported.");
  }
  const glowFireCanvas = document.createElement("canvas");
  const glowFireCtx = glowFireCanvas.getContext("2d");
  if (!glowFireCtx) {
    throw new Error("Glow fire canvas not supported.");
  }
  const coreFireCanvas = document.createElement("canvas");
  const coreFireCtx = coreFireCanvas.getContext("2d");
  if (!coreFireCtx) {
    throw new Error("Core fire canvas not supported.");
  }
  const emitterCanvas = document.createElement("canvas");
  emitterCanvas.width = FIRE_WIDTH;
  emitterCanvas.height = FIRE_HEIGHT;
  const emitterCtx = emitterCanvas.getContext("2d");
  if (!emitterCtx) {
    throw new Error("Emitter canvas not supported.");
  }
  const firePixelCount = FIRE_WIDTH * FIRE_HEIGHT;
  const cpuFirePixels = new Float32Array(firePixelCount);
  const emitterPixels = new Uint8Array(firePixelCount);

  let visible = true;
  let selectedIndex = 0;
  let rafId = 0;
  let fireAccumulatorMs = 0;
  let emitterAccumulatorMs = 0;
  let lastFrameNow = performance.now();
  let emitterPhase = Math.random() * 1000;
  let flameMotionSeconds = Math.random() * 8;
  let windCurrent = 0;
  let windTarget = (Math.random() * 2 - 1) * 1.2;
  let emitterTextureDirty = true;
  let activeFlameGlyphCount = TITLE_ACTIVE_FLAME_GLYPHS;
  const flameGlyphCenters = new Float32Array(TITLE_MAX_FLAME_GLYPHS);
  const flameGlyphHalfWidths = new Float32Array(TITLE_MAX_FLAME_GLYPHS);
  const emitterAnchors: FlameEmitterAnchor[] = [];
  const emberParticles: EmberParticle[] = [];
  const MAX_EMBER_PARTICLES = 280;
  const introStartMs = performance.now();
  const introReveal = (delayMs: number, durationMs: number): number => {
    const t = clamp((performance.now() - introStartMs - delayMs) / Math.max(1, durationMs), 0, 1);
    return t * t * (3 - 2 * t);
  };
  const panelDisposers: Array<() => void> = [];

  const clearPanelDisposers = (): void => {
    while (panelDisposers.length > 0) {
      const dispose = panelDisposers.pop();
      if (!dispose) {
        continue;
      }
      try {
        dispose();
      } catch {
        // Ignore panel dispose failures.
      }
    }
  };

  const hidePanel = (): void => {
    panelBackdrop.classList.add("hidden");
    clearPanelDisposers();
    panelBody.innerHTML = "";
    root.classList.remove("title-screen--panel-open");
    setSelectedIndex(selectedIndex, true);
  };

  const showPanel = (action: Exclude<TitleMenuAction, "new-game" | "map-editor" | "fx-lab" | "quit">): void => {
    clearPanelDisposers();
    panelBody.innerHTML = "";
    if (action === "settings") {
      panelTitle.textContent = "Settings";
      buildSettingsPanel(panelBody, deps.audioControls, deps.runtimeSettings, (dispose) => {
        panelDisposers.push(dispose);
      });
    } else if (action === "high-score") {
      panelTitle.textContent = "High Score";
      buildHighScorePanel(panelBody);
    } else {
      panelTitle.textContent = "Credits";
      buildCreditsPanel(panelBody);
    }
    panelBackdrop.classList.remove("hidden");
    root.classList.add("title-screen--panel-open");
    panelBack.focus();
  };

  const menuButtons: HTMLButtonElement[] = TITLE_MENU_OPTIONS.map((option, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "title-screen-menu-item";
    button.textContent = option.label;
    button.dataset.action = option.id;
    button.addEventListener("mouseenter", () => setSelectedIndex(index, false));
    button.addEventListener("focus", () => setSelectedIndex(index, false));
    button.addEventListener("click", () => activate(option.id));
    menu.appendChild(button);
    return button;
  });

  const setSelectedIndex = (next: number, shouldFocus: boolean): void => {
    selectedIndex = (next + menuButtons.length) % menuButtons.length;
    menuButtons.forEach((button, index) => {
      const selected = index === selectedIndex;
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-current", selected ? "true" : "false");
    });
    if (shouldFocus) {
      menuButtons[selectedIndex]?.focus();
    }
  };

  const activate = (action: TitleMenuAction): void => {
    if (action === "new-game") {
      deps.onNewGame();
      return;
    }
    if (action === "map-editor") {
      deps.onMapEditor();
      return;
    }
    if (action === "fx-lab") {
      deps.onFxLab();
      return;
    }
    if (action === "quit") {
      deps.onQuit();
      return;
    }
    showPanel(action);
  };

  const measureTrackedTextLayout = (
    ctx: CanvasRenderingContext2D,
    text: string,
    spacingPx: number
  ): { width: number; advances: number[] } => {
    const advances = new Array<number>(text.length);
    let previousPrefixWidth = 0;
    for (let i = 0; i < text.length; i += 1) {
      const prefixWidth = ctx.measureText(text.slice(0, i + 1)).width;
      advances[i] = Math.max(0, prefixWidth - previousPrefixWidth);
      previousPrefixWidth = prefixWidth;
    }
    const width = previousPrefixWidth + spacingPx * Math.max(0, text.length - 1);
    return { width, advances };
  };

  const getTrackedGlyphSpans = (
    ctx: CanvasRenderingContext2D,
    text: string,
    centerX: number,
    spacingPx: number
  ): TrackedGlyphSpan[] => {
    const layout = measureTrackedTextLayout(ctx, text, spacingPx);
    let x = centerX - layout.width * 0.5;
    const spans: TrackedGlyphSpan[] = [];
    for (let i = 0; i < text.length; i += 1) {
      const glyph = text[i] ?? "";
      const width = Math.max(0, layout.advances[i] ?? ctx.measureText(glyph).width);
      spans.push({
        glyph,
        index: i,
        x,
        width,
        leftX: x,
        rightX: x + width,
        centerX: x + width * 0.5
      });
      x += width + (i < text.length - 1 ? spacingPx : 0);
    }
    return spans;
  };

  const buildTitleLayout = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number
  ): TitleLayout => {
    const fontSize = Math.min(height * 0.54, width / 7.8);
    const letterSpacing = Math.max(1.6, fontSize * 0.05);
    const centerX = width * 0.5;
    const centerY = height * 0.72;
    const outline = Math.max(1, Math.round(fontSize * 0.052));
    const font = `${TITLE_FONT_WEIGHT} ${fontSize}px ${TITLE_FONT_FAMILY}`;
    ctx.font = font;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    return {
      width,
      height,
      fontSize,
      letterSpacing,
      centerX,
      centerY,
      outline,
      font,
      spans: getTrackedGlyphSpans(ctx, TITLE_WORD, centerX, letterSpacing)
    };
  };

  const buildFlameEmitterAnchors = (layout: TitleLayout): FlameEmitterAnchor[] =>
    layout.spans.slice(0, TITLE_MAX_FLAME_GLYPHS).map((span) => {
      const halfWidth = Math.max(span.width * 0.58, layout.fontSize * 0.16);
      return {
        index: span.index,
        centerX: span.centerX,
        leftX: span.leftX,
        rightX: span.rightX,
        halfWidth,
        baseY: layout.centerY + layout.fontSize * 0.18,
        strength: clamp(span.width / Math.max(1, layout.fontSize), 0.72, 1.24),
        seed: hash01(span.index * 137 + 17)
      };
    });

  const strokeGlyphSpans = (
    ctx: CanvasRenderingContext2D,
    spans: readonly TrackedGlyphSpan[],
    y: number
  ): void => {
    const previousTextAlign = ctx.textAlign;
    ctx.textAlign = "left";
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i];
      ctx.strokeText(span.glyph, span.x, y);
    }
    ctx.textAlign = previousTextAlign;
  };

  const fillGlyphSpans = (
    ctx: CanvasRenderingContext2D,
    spans: readonly TrackedGlyphSpan[],
    y: number
  ): void => {
    const previousTextAlign = ctx.textAlign;
    ctx.textAlign = "left";
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i];
      ctx.fillText(span.glyph, span.x, y);
    }
    ctx.textAlign = previousTextAlign;
  };

  const rebuildEmitter = (): void => {
    const layout = buildTitleLayout(emitterCtx, FIRE_WIDTH, FIRE_HEIGHT);
    emitterCtx.clearRect(0, 0, FIRE_WIDTH, FIRE_HEIGHT);
    flameGlyphCenters.fill(0);
    flameGlyphHalfWidths.fill(0);
    emitterAnchors.length = 0;
    const anchors = buildFlameEmitterAnchors(layout).slice(0, TITLE_ACTIVE_FLAME_GLYPHS);
    activeFlameGlyphCount = anchors.length;

    emitterCtx.save();
    emitterCtx.filter = `blur(${Math.max(1, layout.outline * 0.22)}px)`;
    for (let i = 0; i < anchors.length; i += 1) {
      const anchor = anchors[i] as FlameEmitterAnchor;
      emitterAnchors.push(anchor);
      flameGlyphCenters[i] = anchor.centerX / FIRE_WIDTH;
      flameGlyphHalfWidths[i] = Math.max(anchor.halfWidth / FIRE_WIDTH, 0.01);

      const emitterHalfWidth = anchor.halfWidth * (1.12 + anchor.strength * 0.08);
      const topHalfWidth = Math.max(emitterHalfWidth * 0.32, layout.fontSize * 0.05);
      const stemHeight = layout.fontSize * (1.02 + anchor.strength * 0.22);
      const topY = anchor.baseY - stemHeight;
      const bottomY = anchor.baseY + layout.fontSize * 0.05;
      const gradient = emitterCtx.createLinearGradient(anchor.centerX, bottomY, anchor.centerX, topY);
      gradient.addColorStop(0, "rgba(255, 255, 255, 1)");
      gradient.addColorStop(0.28, "rgba(255, 255, 255, 0.98)");
      gradient.addColorStop(0.7, "rgba(255, 255, 255, 0.58)");
      gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      emitterCtx.fillStyle = gradient;
      emitterCtx.beginPath();
      emitterCtx.moveTo(anchor.centerX - emitterHalfWidth, bottomY);
      emitterCtx.quadraticCurveTo(
        anchor.centerX - emitterHalfWidth * 0.94,
        anchor.baseY - stemHeight * 0.34,
        anchor.centerX - topHalfWidth,
        topY
      );
      emitterCtx.lineTo(anchor.centerX + topHalfWidth, topY);
      emitterCtx.quadraticCurveTo(
        anchor.centerX + emitterHalfWidth * 0.94,
        anchor.baseY - stemHeight * 0.34,
        anchor.centerX + emitterHalfWidth,
        bottomY
      );
      emitterCtx.quadraticCurveTo(anchor.centerX + emitterHalfWidth * 0.42, bottomY + stemHeight * 0.14, anchor.centerX, bottomY + stemHeight * 0.18);
      emitterCtx.quadraticCurveTo(anchor.centerX - emitterHalfWidth * 0.42, bottomY + stemHeight * 0.14, anchor.centerX - emitterHalfWidth, bottomY);
      emitterCtx.closePath();
      emitterCtx.fill();

      emitterCtx.fillStyle = "rgba(255, 255, 255, 0.88)";
      emitterCtx.beginPath();
      emitterCtx.ellipse(
        anchor.centerX,
        bottomY,
        emitterHalfWidth * 0.94,
        Math.max(1.5, layout.fontSize * 0.08),
        0,
        0,
        Math.PI * 2
      );
      emitterCtx.fill();
    }
    emitterCtx.restore();

    const emitterData = emitterCtx.getImageData(0, 0, FIRE_WIDTH, FIRE_HEIGHT).data;
    for (let i = 0; i < firePixelCount; i += 1) {
      emitterPixels[i] = emitterData[i * 4 + 3] ?? 0;
    }
    emitterTextureDirty = true;
  };

  const spawnEmber = (x: number, y: number, upward = true, intensity = 1): void => {
    if (emberParticles.length >= MAX_EMBER_PARTICLES) {
      emberParticles.splice(0, Math.max(1, emberParticles.length - MAX_EMBER_PARTICLES + 1));
    }
    const vxBase = (Math.random() * 2 - 1) * (40 + intensity * 45) + windCurrent * 36;
    const vyBase = upward
      ? -(120 + Math.random() * 190 + intensity * 70)
      : 20 + Math.random() * 55 + intensity * 18;
    emberParticles.push({
      x,
      y,
      px: x,
      py: y,
      vx: vxBase,
      vy: vyBase,
      age: 0,
      life: 0.55 + Math.random() * 1.15,
      size: 0.9 + Math.random() * 1.5 + intensity * 0.4,
      brightness: 0.55 + Math.random() * 0.7
    });
  };

  const updateEmbers = (deltaMs: number, width: number, height: number): void => {
    const dt = Math.max(0, deltaMs) / 1000;
    const gravity = 86;
    for (let i = emberParticles.length - 1; i >= 0; i -= 1) {
      const ember = emberParticles[i];
      ember.age += dt;
      if (ember.age >= ember.life) {
        emberParticles.splice(i, 1);
        continue;
      }
      ember.px = ember.x;
      ember.py = ember.y;
      ember.vx += (windCurrent * 30 + (Math.random() * 2 - 1) * 22) * dt;
      ember.vy += gravity * dt;
      ember.vx *= 0.992;
      ember.vy *= 0.996;
      ember.x += ember.vx * dt;
      ember.y += ember.vy * dt;
      if (ember.x < -40 || ember.x > width + 40 || ember.y < -80 || ember.y > height + 90) {
        emberParticles.splice(i, 1);
      }
    }
  };

  const drawEmbers = (ctx: CanvasRenderingContext2D): void => {
    if (emberParticles.length === 0) {
      return;
    }
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < emberParticles.length; i += 1) {
      const ember = emberParticles[i];
      const t = 1 - ember.age / ember.life;
      if (t <= 0) {
        continue;
      }
      const alpha = t * t * ember.brightness;
      const emberGreen = Math.round(120 + 95 * t);
      const emberBlue = Math.round(26 + 30 * t);
      if ((ember.x - ember.px) * (ember.x - ember.px) + (ember.y - ember.py) * (ember.y - ember.py) > 0.25) {
        ctx.strokeStyle = `rgba(255, ${emberGreen}, ${emberBlue}, ${alpha * 0.55})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(ember.px, ember.py);
        ctx.lineTo(ember.x, ember.y);
        ctx.stroke();
      }
      ctx.fillStyle = `rgba(255, ${emberGreen}, ${emberBlue}, ${alpha})`;
      const size = Math.max(0.8, ember.size * (0.65 + 0.55 * t));
      ctx.fillRect(ember.x, ember.y, size, size);
      if (size > 1.4 && alpha > 0.16) {
        ctx.fillStyle = `rgba(255, 240, 184, ${alpha * 0.52})`;
        ctx.fillRect(ember.x + size * 0.26, ember.y + size * 0.26, 1, 1);
      }
    }
    ctx.restore();
  };

  const stepFire = (): void => {
    emitterPhase += 0.018;
    if (Math.random() < 0.1) {
      windTarget = (Math.random() * 2 - 1) * (0.8 + Math.random() * 1.6);
    }
    windCurrent += (windTarget - windCurrent) * 0.06;
    spawnTitleSparks();
  };

  const renderFireBuffer = (): void => {
    if (fireProgram) {
      if (emitterTextureDirty) {
        fireProgram.uploadEmitterMask(emitterPixels, FIRE_WIDTH, FIRE_HEIGHT);
        emitterTextureDirty = false;
      }
      fireProgram.render(
        flameMotionSeconds * TITLE_FLAME_MOTION_TIME_SCALE,
        windCurrent,
        activeFlameGlyphCount,
        flameGlyphCenters,
        flameGlyphHalfWidths
      );
      return;
    }
    if (!fireCtx || !fireImageData) {
      return;
    }
    renderTitleFlameField({
      fireImageData,
      firePixels: cpuFirePixels,
      emitterPixels,
      glyphCount: activeFlameGlyphCount,
      glyphCenters: flameGlyphCenters,
      glyphHalfWidths: flameGlyphHalfWidths,
      levels: FIRE_LEVELS,
      timeSeconds: flameMotionSeconds * TITLE_FLAME_MOTION_TIME_SCALE,
      wind: windCurrent
    });
    fireCtx.putImageData(fireImageData, 0, 0);
  };

  const resizeCanvas = (): void => {
    const rect = titleCanvas.getBoundingClientRect();
    const dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    const targetWidth = Math.max(1, Math.round(rect.width * dpr));
    const targetHeight = Math.max(1, Math.round(rect.height * dpr));
    if (titleCanvas.width !== targetWidth || titleCanvas.height !== targetHeight) {
      titleCanvas.width = targetWidth;
      titleCanvas.height = targetHeight;
      glyphMaskCanvas.width = targetWidth;
      glyphMaskCanvas.height = targetHeight;
      strokeMaskCanvas.width = targetWidth;
      strokeMaskCanvas.height = targetHeight;
      glowMaskCanvas.width = targetWidth;
      glowMaskCanvas.height = targetHeight;
      glowFireCanvas.width = targetWidth;
      glowFireCanvas.height = targetHeight;
      coreFireCanvas.width = targetWidth;
      coreFireCanvas.height = targetHeight;
    }
  };

  const spawnTitleSparks = (): void => {
    if (emitterAnchors.length === 0 || titleCanvas.width < 2 || titleCanvas.height < 2) {
      return;
    }
    const sx = titleCanvas.width / FIRE_WIDTH;
    const sy = titleCanvas.height / FIRE_HEIGHT;
    const attempts = emberParticles.length < MAX_EMBER_PARTICLES * 0.55 ? 2 : 1;
    for (let i = 0; i < attempts; i += 1) {
      const anchor = emitterAnchors[Math.floor(Math.random() * emitterAnchors.length)];
      if (!anchor) {
        continue;
      }
      const sparkChance = 0.012 + anchor.strength * 0.018;
      if (Math.random() > sparkChance) {
        continue;
      }
      const jitterX = (Math.random() * 2 - 1) * Math.max(2, anchor.halfWidth * sx * 0.52);
      const jitterY = (Math.random() * 2 - 1) * Math.max(2, sy * 2.2);
      const intensity = clamp(0.44 + anchor.strength * 0.42 + anchor.seed * 0.18, 0.34, 1.1);
      spawnEmber(anchor.centerX * sx + jitterX, anchor.baseY * sy + jitterY, true, intensity);
    }
  };

  const drawTitle = (): void => {
    const width = titleCanvas.width;
    const height = titleCanvas.height;
    if (width < 2 || height < 2) {
      return;
    }
    const layout = buildTitleLayout(strokeMaskCtx, width, height);

    glyphMaskCtx.clearRect(0, 0, width, height);
    glyphMaskCtx.save();
    glyphMaskCtx.font = layout.font;
    glyphMaskCtx.textAlign = "left";
    glyphMaskCtx.textBaseline = "middle";
    glyphMaskCtx.fillStyle = "rgba(255, 255, 255, 1)";
    fillGlyphSpans(glyphMaskCtx, layout.spans, layout.centerY);
    glyphMaskCtx.restore();

    strokeMaskCtx.clearRect(0, 0, width, height);
    strokeMaskCtx.save();
    strokeMaskCtx.font = layout.font;
    strokeMaskCtx.textAlign = "left";
    strokeMaskCtx.textBaseline = "middle";
    strokeMaskCtx.lineJoin = "round";
    strokeMaskCtx.lineCap = "round";
    strokeMaskCtx.strokeStyle = "rgba(255, 255, 255, 0.94)";
    strokeMaskCtx.lineWidth = Math.max(0.75, layout.outline * 0.34);
    strokeGlyphSpans(strokeMaskCtx, layout.spans, layout.centerY);
    strokeMaskCtx.strokeStyle = "rgba(255, 255, 255, 0.42)";
    strokeMaskCtx.lineWidth = Math.max(0.4, layout.outline * 0.16);
    strokeGlyphSpans(strokeMaskCtx, layout.spans, layout.centerY);
    strokeMaskCtx.restore();

    glowMaskCtx.clearRect(0, 0, width, height);
    glowMaskCtx.save();
    glowMaskCtx.globalAlpha = 0.24;
    glowMaskCtx.filter = `blur(${Math.max(2, Math.round(layout.outline * 0.42))}px)`;
    glowMaskCtx.drawImage(glyphMaskCanvas, 0, 0);
    glowMaskCtx.globalAlpha = 0.36;
    glowMaskCtx.filter = `blur(${Math.max(1, Math.round(layout.outline * 0.18))}px)`;
    glowMaskCtx.drawImage(strokeMaskCanvas, 0, 0);
    glowMaskCtx.restore();

    glowFireCtx.clearRect(0, 0, width, height);
    glowFireCtx.drawImage(fireCanvas, 0, 0, width, height);
    glowFireCtx.globalCompositeOperation = "destination-in";
    glowFireCtx.drawImage(glowMaskCanvas, 0, 0);
    glowFireCtx.globalCompositeOperation = "source-over";

    coreFireCtx.clearRect(0, 0, width, height);
    coreFireCtx.drawImage(fireCanvas, 0, 0, width, height);
    coreFireCtx.globalCompositeOperation = "destination-in";
    coreFireCtx.drawImage(glyphMaskCanvas, 0, 0);
    coreFireCtx.globalCompositeOperation = "source-over";

    titleCtx.clearRect(0, 0, width, height);
    const emberReveal = introReveal(INTRO_EMBER_DELAY_MS, INTRO_EMBER_FADE_MS);
    const flameReveal = introReveal(INTRO_FLAME_DELAY_MS, INTRO_FLAME_FADE_MS);
    const outlineReveal = introReveal(INTRO_OUTLINE_DELAY_MS, INTRO_OUTLINE_FADE_MS);

    titleCtx.save();
    titleCtx.globalCompositeOperation = "lighter";
    titleCtx.globalAlpha = 0.18 * flameReveal;
    titleCtx.filter = `blur(${Math.max(3, Math.round(layout.outline * 0.72))}px)`;
    titleCtx.drawImage(glowFireCanvas, 0, 0);
    titleCtx.restore();

    titleCtx.save();
    titleCtx.globalCompositeOperation = "lighter";
    titleCtx.globalAlpha = 1.0 * flameReveal;
    titleCtx.drawImage(coreFireCanvas, 0, 0);
    titleCtx.restore();

    titleCtx.save();
    titleCtx.globalCompositeOperation = "destination-out";
    titleCtx.globalAlpha = 0.72 * flameReveal;
    titleCtx.font = layout.font;
    titleCtx.textAlign = "left";
    titleCtx.textBaseline = "middle";
    titleCtx.lineJoin = "round";
    titleCtx.lineCap = "round";
    titleCtx.lineWidth = Math.max(0.55, layout.outline * 0.24);
    strokeGlyphSpans(titleCtx, layout.spans, layout.centerY);
    titleCtx.restore();

    titleCtx.save();
    titleCtx.globalCompositeOperation = "screen";
    titleCtx.font = layout.font;
    titleCtx.textAlign = "left";
    titleCtx.textBaseline = "middle";
    titleCtx.lineJoin = "round";
    titleCtx.lineCap = "round";
    titleCtx.strokeStyle = `rgba(245, 244, 240, ${0.14 * outlineReveal})`;
    titleCtx.lineWidth = Math.max(0.12, layout.outline * 0.018);
    strokeGlyphSpans(titleCtx, layout.spans, layout.centerY);
    titleCtx.restore();

    if (emberReveal > 0.001) {
      titleCtx.save();
      titleCtx.globalAlpha = emberReveal;
      drawEmbers(titleCtx);
      titleCtx.restore();
    }

    // Fade the lower edge so the underglow blends into the background
    // before the canvas boundary clip.
    titleCtx.save();
    titleCtx.globalCompositeOperation = "destination-out";
    const fadeHeight = Math.max(24, Math.round(layout.fontSize * 0.26 + layout.outline * 2));
    const fadeStart = Math.max(0, height - fadeHeight);
    const bottomFade = titleCtx.createLinearGradient(0, fadeStart, 0, height);
    bottomFade.addColorStop(0, "rgba(0, 0, 0, 0)");
    bottomFade.addColorStop(1, "rgba(0, 0, 0, 1)");
    titleCtx.fillStyle = bottomFade;
    titleCtx.fillRect(0, fadeStart, width, height - fadeStart);
    titleCtx.restore();
  };

  const tick = (now: number): void => {
    if (!visible) {
      return;
    }
    const deltaMs = Math.min(120, Math.max(0, now - lastFrameNow));
    lastFrameNow = now;
    flameMotionSeconds += deltaMs / 1000;
    fireAccumulatorMs += deltaMs;
    emitterAccumulatorMs += deltaMs;
    let fireDirty = false;
    while (emitterAccumulatorMs >= EMITTER_REBUILD_MS) {
      rebuildEmitter();
      emitterAccumulatorMs -= EMITTER_REBUILD_MS;
      fireDirty = true;
    }
    while (fireAccumulatorMs >= FIRE_UPDATE_MS) {
      stepFire();
      fireAccumulatorMs -= FIRE_UPDATE_MS;
      fireDirty = true;
    }
    updateEmbers(deltaMs, titleCanvas.width, titleCanvas.height);
    if (fireProgram || fireDirty) {
      renderFireBuffer();
    }
    drawTitle();
    rafId = window.requestAnimationFrame(tick);
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!visible) {
      return;
    }
    const panelOpen = !panelBackdrop.classList.contains("hidden");
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (panelOpen) {
        hidePanel();
      }
      return;
    }
    if (panelOpen) {
      if (event.target instanceof Node && panel.contains(event.target)) {
        return;
      }
      event.stopPropagation();
      return;
    }
    if (isEditableTarget(event.target)) {
      event.stopPropagation();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      event.stopPropagation();
      setSelectedIndex(selectedIndex - 1, true);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      event.stopPropagation();
      setSelectedIndex(selectedIndex + 1, true);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      const option = TITLE_MENU_OPTIONS[selectedIndex];
      if (option) {
        activate(option.id);
      }
      return;
    }
    event.stopPropagation();
  };

  panelBack.addEventListener("click", () => hidePanel());
  panelBackdrop.addEventListener("click", (event) => {
    if (event.target === panelBackdrop) {
      hidePanel();
    }
  });
  const stopPanelKeydown = (event: KeyboardEvent): void => {
    event.stopPropagation();
  };
  panel.addEventListener("keydown", stopPanelKeydown);

  const onResize = (): void => resizeCanvas();
  window.addEventListener("resize", onResize);
  document.addEventListener("keydown", onKeyDown, true);
  setSelectedIndex(0, false);
  resizeCanvas();
  rebuildEmitter();
  for (let i = 0; i < 16; i += 1) {
    stepFire();
  }
  renderFireBuffer();
  drawTitle();
  root.focus();
  window.requestAnimationFrame(() => {
    if (!visible) {
      return;
    }
    root.classList.add("title-screen--intro-visible");
  });
  rafId = window.requestAnimationFrame(tick);

  return {
    destroy: () => {
      if (!visible) {
        return;
      }
      visible = false;
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKeyDown, true);
      panel.removeEventListener("keydown", stopPanelKeydown);
      clearPanelDisposers();
      fireProgram?.destroy();
      root.remove();
    },
    isVisible: () => visible
  };
};
