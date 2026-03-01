import { loadLeaderboard } from "../persistence/leaderboard.js";

type TitleMenuAction = "new-game" | "settings" | "high-score" | "credits" | "quit";

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

type FlameEmitterPoint = {
  idx: number;
  x: number;
  y: number;
  strength: number;
  seed: number;
  topBias: number;
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
};

export type TitleScreenDeps = {
  mount?: HTMLElement;
  onNewGame: () => void;
  onQuit: () => void;
  audioControls?: TitleAudioControls;
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
  { id: "settings", label: "Settings" },
  { id: "high-score", label: "High Score" },
  { id: "credits", label: "Credits" },
  { id: "quit", label: "Quit" }
];

const FIRE_WIDTH = 400;
const FIRE_HEIGHT = 260;
const FIRE_LEVELS = 48;
const FIRE_UPDATE_MS = 34;
const EMITTER_REBUILD_MS = 64;
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

const buildFirePalette = (): Uint8ClampedArray => {
  const palette = new Uint8ClampedArray(FIRE_LEVELS * 4);
  const stops = [
    { t: 0, color: [0, 0, 0, 0] as const },
    { t: 0.14, color: [58, 6, 0, 255] as const },
    { t: 0.32, color: [138, 24, 2, 255] as const },
    { t: 0.56, color: [218, 66, 8, 255] as const },
    { t: 0.78, color: [252, 138, 26, 255] as const },
    { t: 0.92, color: [255, 202, 82, 255] as const },
    { t: 1, color: [255, 244, 186, 255] as const }
  ];
  for (let i = 0; i < FIRE_LEVELS; i += 1) {
    const t = i / (FIRE_LEVELS - 1);
    let a = stops[0];
    let b = stops[stops.length - 1];
    for (let j = 1; j < stops.length; j += 1) {
      if (t <= stops[j].t) {
        a = stops[j - 1];
        b = stops[j];
        break;
      }
    }
    const range = Math.max(1e-6, b.t - a.t);
    const local = clamp((t - a.t) / range, 0, 1);
    const base = i * 4;
    palette[base] = Math.round(a.color[0] + (b.color[0] - a.color[0]) * local);
    palette[base + 1] = Math.round(a.color[1] + (b.color[1] - a.color[1]) * local);
    palette[base + 2] = Math.round(a.color[2] + (b.color[2] - a.color[2]) * local);
    palette[base + 3] = Math.round(a.color[3] + (b.color[3] - a.color[3]) * local);
  }
  return palette;
};

const FIRE_PALETTE = buildFirePalette();

const buildSettingsPanel = (
  body: HTMLElement,
  audioControls: TitleAudioControls | undefined,
  registerDispose: (dispose: () => void) => void
): void => {
  if (!audioControls) {
    const note = document.createElement("p");
    note.className = "title-screen-panel-note";
    note.textContent = "Audio controls are unavailable in this build.";
    body.appendChild(note);
    return;
  }

  const settings = document.createElement("div");
  settings.className = "title-screen-settings";

  const createChannelControls = (
    label: string,
    controls: TitleAudioChannelControls,
    sliderId: string,
    muteId: string
  ): HTMLDivElement => {
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

  settings.append(
    createChannelControls("Music", audioControls.music, "title-settings-music-volume", "title-settings-music-mute"),
    createChannelControls("Sound FX", audioControls.sfx, "title-settings-sfx-volume", "title-settings-sfx-mute")
  );

  const note = document.createElement("p");
  note.className = "title-screen-panel-note";
  note.textContent = "These audio settings are shared with in-game controls.";
  body.append(settings, note);
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
  const fireCanvas = document.createElement("canvas");
  fireCanvas.width = FIRE_WIDTH;
  fireCanvas.height = FIRE_HEIGHT;
  const fireCtx = fireCanvas.getContext("2d");
  if (!fireCtx) {
    throw new Error("Offscreen fire canvas not supported.");
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
  const jetCanvas = document.createElement("canvas");
  const jetCtx = jetCanvas.getContext("2d");
  if (!jetCtx) {
    throw new Error("Jet canvas not supported.");
  }
  const emitterCanvas = document.createElement("canvas");
  emitterCanvas.width = FIRE_WIDTH;
  emitterCanvas.height = FIRE_HEIGHT;
  const emitterCtx = emitterCanvas.getContext("2d");
  if (!emitterCtx) {
    throw new Error("Emitter canvas not supported.");
  }
  const firePixelCount = FIRE_WIDTH * FIRE_HEIGHT;
  const firePixels = new Float32Array(firePixelCount);
  const emitterPixels = new Uint8Array(firePixelCount);
  const noiseField = new Float32Array(firePixelCount);
  for (let i = 0; i < noiseField.length; i += 1) {
    noiseField[i] = Math.random();
  }
  const columnPulse = new Float32Array(FIRE_WIDTH);
  const columnTarget = new Float32Array(FIRE_WIDTH);
  for (let x = 0; x < FIRE_WIDTH; x += 1) {
    const seed = 0.78 + Math.random() * 0.42;
    columnPulse[x] = seed;
    columnTarget[x] = seed;
  }
  const fireImageData = fireCtx.createImageData(FIRE_WIDTH, FIRE_HEIGHT);

  let visible = true;
  let selectedIndex = 0;
  let rafId = 0;
  let fireAccumulatorMs = 0;
  let emitterAccumulatorMs = 0;
  let lastFrameNow = performance.now();
  let noiseOffset = 0;
  let emitterPhase = Math.random() * 1000;
  let windCurrent = 0;
  let windTarget = (Math.random() * 2 - 1) * 1.2;
  const glyphSeedA = new Float32Array(TITLE_WORD.length);
  const glyphSeedB = new Float32Array(TITLE_WORD.length);
  for (let i = 0; i < TITLE_WORD.length; i += 1) {
    glyphSeedA[i] = Math.random();
    glyphSeedB[i] = Math.random();
  }
  const emitterPoints: FlameEmitterPoint[] = [];
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

  const showPanel = (action: Exclude<TitleMenuAction, "new-game" | "quit">): void => {
    clearPanelDisposers();
    panelBody.innerHTML = "";
    if (action === "settings") {
      panelTitle.textContent = "Settings";
      buildSettingsPanel(panelBody, deps.audioControls, (dispose) => {
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
  ): Array<{ glyph: string; index: number; x: number; width: number; centerX: number }> => {
    const layout = measureTrackedTextLayout(ctx, text, spacingPx);
    let x = centerX - layout.width * 0.5;
    const spans: Array<{ glyph: string; index: number; x: number; width: number; centerX: number }> = [];
    for (let i = 0; i < text.length; i += 1) {
      const glyph = text[i] ?? "";
      const width = Math.max(0, layout.advances[i] ?? ctx.measureText(glyph).width);
      spans.push({
        glyph,
        index: i,
        x,
        width,
        centerX: x + width * 0.5
      });
      x += width + (i < text.length - 1 ? spacingPx : 0);
    }
    return spans;
  };

  const strokeSpacedText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    centerX: number,
    y: number,
    spacingPx: number
  ): void => {
    const spans = getTrackedGlyphSpans(ctx, text, centerX, spacingPx);
    const previousTextAlign = ctx.textAlign;
    ctx.textAlign = "left";
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i];
      ctx.strokeText(span.glyph, span.x, y);
    }
    ctx.textAlign = previousTextAlign;
  };

  const fillSpacedText = (
    ctx: CanvasRenderingContext2D,
    text: string,
    centerX: number,
    y: number,
    spacingPx: number
  ): void => {
    const spans = getTrackedGlyphSpans(ctx, text, centerX, spacingPx);
    const previousTextAlign = ctx.textAlign;
    ctx.textAlign = "left";
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i];
      ctx.fillText(span.glyph, span.x, y);
    }
    ctx.textAlign = previousTextAlign;
  };

  const rebuildEmitter = (): void => {
    const fontSize = Math.min(FIRE_HEIGHT * 0.56, FIRE_WIDTH / 7.8);
    const letterSpacing = Math.max(1.2, fontSize * 0.045);
    const centerX = FIRE_WIDTH * 0.5;
    const centerY = FIRE_HEIGHT * 0.72;
    const strokeWidth = Math.max(1.6, fontSize * 0.072);
    const jitterX = Math.sin(emitterPhase * 0.63) * 0.25;
    const jitterY = Math.cos(emitterPhase * 0.47) * 0.18;

    emitterCtx.clearRect(0, 0, FIRE_WIDTH, FIRE_HEIGHT);
    emitterCtx.font = `${TITLE_FONT_WEIGHT} ${fontSize}px ${TITLE_FONT_FAMILY}`;
    emitterCtx.textAlign = "left";
    emitterCtx.textBaseline = "middle";
    emitterCtx.lineJoin = "round";
    emitterCtx.lineCap = "round";
    const spans = getTrackedGlyphSpans(emitterCtx, TITLE_WORD, centerX, letterSpacing);

    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i];
      const seedA = glyphSeedA[span.index] ?? 0.5;
      const seedB = glyphSeedB[span.index] ?? 0.5;
      const phase = emitterPhase * (1.08 + seedA * 1.04) + seedB * 11.7;
      const localJx = jitterX * (0.26 + seedA * 0.36) + Math.sin(phase) * (0.16 + strokeWidth * 0.14);
      const localJy = jitterY * (0.26 + seedB * 0.36) + Math.cos(phase * 1.27) * (0.14 + strokeWidth * 0.12);

      emitterCtx.strokeStyle = "rgba(255, 255, 255, 0.96)";
      emitterCtx.lineWidth = strokeWidth * (0.76 + 0.36 * (0.5 + 0.5 * Math.sin(phase * 1.63)));
      emitterCtx.strokeText(span.glyph, span.x + localJx, centerY + localJy);

      emitterCtx.strokeStyle = "rgba(255, 255, 255, 0.64)";
      emitterCtx.lineWidth = strokeWidth * (0.48 + 0.3 * (0.5 + 0.5 * Math.cos(phase * 1.33)));
      emitterCtx.strokeText(span.glyph, span.x - localJx * 0.52, centerY - localJy * 0.52);
    }

    const emitterData = emitterCtx.getImageData(0, 0, FIRE_WIDTH, FIRE_HEIGHT).data;
    for (let y = 0; y < FIRE_HEIGHT; y += 1) {
      const row = y * FIRE_WIDTH;
      for (let x = 0; x < FIRE_WIDTH; x += 1) {
        const idx = row + x;
        const alpha = emitterData[idx * 4 + 3] / 255;
        if (alpha <= 0.001) {
          emitterPixels[idx] = 0;
          continue;
        }
        const noisy = noiseField[(idx + noiseOffset) % firePixelCount];
        const rough = 0.72 + noisy * 0.5;
        emitterPixels[idx] = clamp(Math.round(alpha * rough * 255), 0, 255);
      }
    }

    emitterPoints.length = 0;
    const verticalScale = Math.max(18, fontSize * 0.65);
    for (let y = 1; y < FIRE_HEIGHT - 1; y += 1) {
      const row = y * FIRE_WIDTH;
      for (let x = 1; x < FIRE_WIDTH - 1; x += 1) {
        const idx = row + x;
        const value = emitterPixels[idx];
        if (value < 152) {
          continue;
        }
        const up = emitterPixels[idx - FIRE_WIDTH];
        const down = emitterPixels[idx + FIRE_WIDTH];
        const left = emitterPixels[idx - 1];
        const right = emitterPixels[idx + 1];
        const minNeighbor = Math.min(up, down, left, right);
        if (minNeighbor > value * 0.88) {
          continue;
        }
        const edgeStrength = clamp((value - minNeighbor) / 255, 0, 1);
        if (edgeStrength < 0.08) {
          continue;
        }
        const sampleGate = hash01(idx * 13 + 17);
        if (sampleGate > 0.22 + edgeStrength * 0.26) {
          continue;
        }
        emitterPoints.push({
          idx,
          x,
          y,
          strength: edgeStrength,
          seed: hash01(idx * 31 + 7) * Math.PI * 2,
          topBias: clamp((centerY - y) / verticalScale, -1, 1)
        });
      }
    }

    if (emitterPoints.length > 420) {
      const stride = Math.ceil(emitterPoints.length / 420);
      let write = 0;
      for (let read = 0; read < emitterPoints.length; read += stride) {
        emitterPoints[write] = emitterPoints[read] as FlameEmitterPoint;
        write += 1;
      }
      emitterPoints.length = write;
    }
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
    noiseOffset = (noiseOffset + 23) % firePixelCount;
    emitterPhase += 0.018;
    if (Math.random() < 0.1) {
      windTarget = (Math.random() * 2 - 1) * (0.8 + Math.random() * 1.6);
    }
    windCurrent += (windTarget - windCurrent) * 0.06;
    const windGust =
      windCurrent + Math.sin(emitterPhase * 0.93) * 0.35 + Math.sin(emitterPhase * 2.37 + 0.7) * 0.18;

    const noiseRefreshCount = Math.max(32, Math.floor(firePixelCount / 30));
    for (let i = 0; i < noiseRefreshCount; i += 1) {
      const idx = (noiseOffset + i * 53) % firePixelCount;
      noiseField[idx] = noiseField[idx] * 0.86 + Math.random() * 0.14;
    }

    for (let x = 0; x < FIRE_WIDTH; x += 1) {
      if (Math.random() < 0.26) {
        const sourceNoise = noiseField[(x * 17 + noiseOffset) % firePixelCount];
        columnTarget[x] = 0.74 + sourceNoise * 0.68;
      }
      columnPulse[x] += (columnTarget[x] - columnPulse[x]) * 0.09;
    }

    for (let i = 0; i < firePixelCount; i += 1) {
      const emitter = emitterPixels[i] / 255;
      if (emitter > 0) {
        const x = i % FIRE_WIDTH;
        const boost = 0.74 + columnPulse[x] * 0.28;
        const flicker = 0.7 + noiseField[(i + noiseOffset * 3) % firePixelCount] * 0.5;
        const pulse = 0.76 + 0.24 * Math.sin(x * 0.17 + emitterPhase * 1.35);
        const shimmer = 0.86 + 0.28 * Math.sin(i * 0.031 + emitterPhase * 3.2);
        const spark = Math.random() < 0.014 ? 5 + Math.random() * 11 : 0;
        const targetHeat = (FIRE_LEVELS - 1) * emitter * boost * flicker * pulse * shimmer + spark;
        firePixels[i] += (targetHeat - firePixels[i]) * 0.22;
      } else {
        firePixels[i] = Math.max(0, firePixels[i] - 0.19);
      }
      firePixels[i] *= 0.995;
    }

    for (let y = 1; y < FIRE_HEIGHT; y += 1) {
      const row = y * FIRE_WIDTH;
      const aboveRow = row - FIRE_WIDTH;
      const topExposure = 1 - y / (FIRE_HEIGHT - 1);
      for (let x = 0; x < FIRE_WIDTH; x += 1) {
        const source = row + x;
        const value = firePixels[source];
        if (value <= 0.02) {
          continue;
        }
        const n = noiseField[(source + noiseOffset) % firePixelCount];
        const decay = (0.09 + n * 0.36) * (1 + topExposure * 0.42) * (0.82 + Math.random() * 0.35);
        const driftRoll = n * 0.6 + Math.random() * 0.4;
        const drift = driftRoll < 0.32 ? -1 : driftRoll > 0.68 ? 1 : 0;
        const windDrift = windGust * (0.35 + topExposure * 1.05);
        const destX = clamp(Math.round(x + drift + windDrift), 0, FIRE_WIDTH - 1);
        const cooled = Math.max(0, value - decay);
        const dest = aboveRow + destX;
        if (cooled > firePixels[dest]) {
          firePixels[dest] = cooled;
        }
        if (y > 1) {
          const twoUpRow = aboveRow - FIRE_WIDTH;
          const lifted = cooled * (0.52 + topExposure * 0.18);
          const twoUpX = clamp(Math.round(destX + windDrift * 0.35), 0, FIRE_WIDTH - 1);
          const twoUp = twoUpRow + twoUpX;
          if (lifted > firePixels[twoUp]) {
            firePixels[twoUp] = lifted;
          }
        }
      }
    }

    // Weak downward branch to create chaotic trailing licks below the outline.
    for (let y = 0; y < FIRE_HEIGHT - 1; y += 1) {
      const row = y * FIRE_WIDTH;
      const belowRow = row + FIRE_WIDTH;
      const depth = y / (FIRE_HEIGHT - 1);
      for (let x = 0; x < FIRE_WIDTH; x += 1) {
        const source = row + x;
        const value = firePixels[source];
        if (value <= FIRE_LEVELS * 0.18) {
          continue;
        }
        if (Math.random() > (0.13 + (1 - depth) * 0.17)) {
          continue;
        }
        const n = noiseField[(source * 3 + noiseOffset) % firePixelCount];
        const drift = n < 0.38 ? -1 : n > 0.62 ? 1 : 0;
        const downWind = windGust * (0.18 + depth * 0.32);
        const destX = clamp(Math.round(x + drift + downWind), 0, FIRE_WIDTH - 1);
        const lick = value * (0.22 + Math.random() * 0.23);
        const dest = belowRow + destX;
        if (lick > firePixels[dest]) {
          firePixels[dest] = lick;
        }
      }
    }
  };

  const renderFireBuffer = (): void => {
    const data = fireImageData.data;
    for (let i = 0; i < firePixelCount; i += 1) {
      const level = clamp(Math.floor(firePixels[i]), 0, FIRE_LEVELS - 1);
      const paletteIndex = level * 4;
      const pixelIndex = i * 4;
      data[pixelIndex] = FIRE_PALETTE[paletteIndex];
      data[pixelIndex + 1] = FIRE_PALETTE[paletteIndex + 1];
      data[pixelIndex + 2] = FIRE_PALETTE[paletteIndex + 2];
      const alphaGain = Math.pow(level / (FIRE_LEVELS - 1), 0.62);
      data[pixelIndex + 3] = clamp(Math.round(FIRE_PALETTE[paletteIndex + 3] * alphaGain * 1.18), 0, 255);
    }
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
      strokeMaskCanvas.width = targetWidth;
      strokeMaskCanvas.height = targetHeight;
      glowMaskCanvas.width = targetWidth;
      glowMaskCanvas.height = targetHeight;
      glowFireCanvas.width = targetWidth;
      glowFireCanvas.height = targetHeight;
      coreFireCanvas.width = targetWidth;
      coreFireCanvas.height = targetHeight;
      jetCanvas.width = targetWidth;
      jetCanvas.height = targetHeight;
    }
  };

  const drawFlameJets = (
    width: number,
    height: number,
    centerY: number,
    fontSize: number,
    outline: number
  ): void => {
    jetCtx.save();
    jetCtx.globalCompositeOperation = "destination-out";
    jetCtx.fillStyle = "rgba(0, 0, 0, 0.24)";
    jetCtx.fillRect(0, 0, width, height);
    jetCtx.restore();
    if (emitterPoints.length === 0) {
      return;
    }

    const sx = width / FIRE_WIDTH;
    const sy = height / FIRE_HEIGHT;
    const topEdgeY = centerY - fontSize * 0.58;
    const bottomEdgeY = centerY + fontSize * 0.48;

    jetCtx.save();
    jetCtx.globalCompositeOperation = "lighter";
    for (let i = 0; i < emitterPoints.length; i += 1) {
      const point = emitterPoints[i] as FlameEmitterPoint;
      const heat = clamp(firePixels[point.idx] / (FIRE_LEVELS - 1), 0, 1);
      if (heat < 0.16) {
        continue;
      }
      const px = point.x * sx;
      const py = point.y * sy;
      const localNoise = noiseField[(point.idx + noiseOffset * 11) % firePixelCount];
      const phase = emitterPhase * (0.44 + localNoise * 0.34) + point.seed * 4.7;
      const activity = 0.5 + 0.5 * Math.sin(phase * 0.72 + point.seed * 1.9);
      const minActivity = clamp(0.24 - heat * 0.12 - point.strength * 0.1, 0.05, 0.34);
      const activityLevel = clamp((activity - minActivity) / Math.max(1e-5, 1 - minActivity), 0, 1);
      if (activityLevel <= 0.04) {
        continue;
      }
      const flicker = 0.5 + 0.5 * Math.sin(phase * 0.88);
      const ripple = 0.5 + 0.5 * Math.sin(phase * 1.26 + point.seed * 2.7);
      const intensity = clamp(
        heat * (0.62 + flicker * 0.74) * (0.68 + ripple * 0.58) * (0.58 + point.strength * 0.82) * (0.4 + activityLevel),
        0,
        1.85
      );
      if (intensity < 0.12) {
        continue;
      }

      const nearTop = Math.abs(py - topEdgeY) < fontSize * 0.2;
      const nearBottom = Math.abs(py - bottomEdgeY) < fontSize * 0.24;
      const tierSeed = point.seed / (Math.PI * 2);
      const phaseSeedA = 0.5 + 0.5 * Math.sin(point.seed * 1.93 + 1.37);
      const phaseSeedB = 0.5 + 0.5 * Math.sin(point.seed * 2.71 + 4.91);

      let maxPhaseDuration = 0.95;
      let riseHeightFactor = 0.72;
      let startSizeFactor = 0.86;
      let alphaFactor = 0.88;
      let tierIsLarge = false;
      let tierIsSmall = false;

      if (tierSeed < 0.24) {
        tierIsLarge = true;
        maxPhaseDuration = 1.08 + phaseSeedA * 0.58;
        riseHeightFactor = 0.88 + phaseSeedB * 0.24;
        startSizeFactor = 1.06 + phaseSeedA * 0.22;
        alphaFactor = 1.0;
      } else if (tierSeed > 0.62) {
        tierIsSmall = true;
        maxPhaseDuration = 0.56 + phaseSeedA * 0.28;
        riseHeightFactor = 0.34 + phaseSeedB * 0.18;
        startSizeFactor = 0.58 + phaseSeedA * 0.22;
        alphaFactor = 0.72;
      }

      const phaseRate = ((0.72 + localNoise * 0.26) / maxPhaseDuration) * 0.05;
      const lifePhase = (emitterPhase * phaseRate + phaseSeedB) % 1;
      const riseT = Math.pow(lifePhase, 2.2);
      const upwardBias = clamp(0.7 + point.topBias * 0.62 + (nearTop ? 0.08 : 0), 0.2, 1.18);
      const spreadX = (tierSeed - 0.5) * (outline * 0.88 + fontSize * 0.014);
      const spreadY = (phaseSeedA - 0.5) * (outline * 0.34 + fontSize * 0.006);
      const spawnX = px + spreadX;
      const spawnY = py + spreadY;
      const riseHeight =
        (outline * 5.3 + fontSize * 0.22) *
        (0.56 + intensity * 0.96) *
        riseHeightFactor *
        (0.66 + upwardBias * 0.54) *
        1.3;
      const curlAmp = (outline * 1.55 + fontSize * 0.02) * (1 - riseT);
      const curl = Math.sin(lifePhase * 17.2 + tierSeed * Math.PI * 2) * curlAmp;
      const windFlicker = 0.74 + 0.26 * Math.sin(emitterPhase * 0.86 + phaseSeedA * Math.PI * 2);
      const windScale =
        (outline * 1.32 + fontSize * 0.016) * (0.34 + intensity * 0.78) * windFlicker * (0.6 + activityLevel * 0.4);
      const windOffsetX = windCurrent * windScale * riseT;
      const flameletX = spawnX + curl + windOffsetX;
      const flameletY = spawnY - riseT * riseHeight;

      const startSize = (outline * 1.9 + fontSize * 0.042) * (0.58 + intensity * 1.1) * startSizeFactor;
      const heightDecay = Math.pow(1 - lifePhase, 1.02);
      const widthDecay = Math.pow(1 - lifePhase, 2.2);
      const flameHeight = startSize * heightDecay;
      const flameWidth = Math.max(1.1, startSize * (0.62 + point.strength * 0.36) * widthDecay);
      if (flameHeight < 1.1) {
        continue;
      }

      const alphaT = Math.pow(Math.sin(Math.PI * lifePhase), 1.45);
      const alpha = alphaT * (0.58 + 0.42 * intensity) * alphaFactor * (0.74 + activityLevel * 0.26);
      const phaseColor = clamp(lifePhase, 0, 1);
      let red = 255;
      let green = 205;
      let blue = 120;
      if (phaseColor < 0.25) {
        const t = phaseColor / 0.25;
        green = Math.round(210 + (165 - 210) * t);
        blue = Math.round(140 + (60 - 140) * t);
      } else if (phaseColor < 0.6) {
        const t = (phaseColor - 0.25) / 0.35;
        green = Math.round(165 + (95 - 165) * t);
        blue = Math.round(60 + (20 - 60) * t);
      } else {
        const t = (phaseColor - 0.6) / 0.4;
        red = Math.round(235 + (195 - 235) * t);
        green = Math.round(95 + (35 - 95) * t);
        blue = Math.round(20 + (10 - 20) * t);
      }

      const tilt = clamp(windCurrent * 0.55, -0.72, 0.72) * (0.35 + 0.65 * riseT);
      jetCtx.globalAlpha = alpha;
      jetCtx.fillStyle = `rgb(${red}, ${green}, ${blue})`;
      jetCtx.beginPath();
      jetCtx.ellipse(flameletX, flameletY, flameWidth, flameHeight, tilt, 0, Math.PI * 2);
      jetCtx.fill();

      if (!tierIsSmall && lifePhase < 0.72) {
        jetCtx.globalAlpha = alpha * (tierIsLarge ? 0.52 : 0.42);
        jetCtx.beginPath();
        jetCtx.ellipse(
          flameletX,
          flameletY - flameHeight * 0.36,
          flameWidth * 0.84,
          flameHeight * 0.9,
          tilt,
          0,
          Math.PI * 2
        );
        jetCtx.fill();
      }

      jetCtx.globalAlpha = clamp(alpha * 0.55, 0.1, 0.44);
      jetCtx.fillStyle = `rgba(255, 242, ${Math.round(172 + 56 * heat)}, 1)`;
      jetCtx.beginPath();
      jetCtx.arc(spawnX, spawnY, Math.max(1, flameWidth * 0.52), 0, Math.PI * 2);
      jetCtx.fill();

      if (Math.random() < 0.009 + intensity * 0.03) {
        spawnEmber(flameletX + windOffsetX * 0.14, flameletY - flameHeight * 0.26, true, intensity);
      } else if (nearBottom && Math.random() < 0.001 + intensity * 0.005) {
        spawnEmber(spawnX, spawnY + flameHeight * 0.2, false, intensity * 0.76);
      }
    }
    jetCtx.restore();
  };

  const drawTitle = (): void => {
    const width = titleCanvas.width;
    const height = titleCanvas.height;
    if (width < 2 || height < 2) {
      return;
    }
    const fontSize = Math.min(height * 0.54, width / 7.8);
    const letterSpacing = Math.max(1.6, fontSize * 0.05);
    const centerX = width * 0.5;
    const centerY = height * 0.72;
    const outline = Math.max(2, Math.round(fontSize * 0.074));
    const font = `${TITLE_FONT_WEIGHT} ${fontSize}px ${TITLE_FONT_FAMILY}`;

    strokeMaskCtx.font = font;
    strokeMaskCtx.textAlign = "left";
    strokeMaskCtx.textBaseline = "middle";
    const spans = getTrackedGlyphSpans(strokeMaskCtx, TITLE_WORD, centerX, letterSpacing);

    strokeMaskCtx.clearRect(0, 0, width, height);
    strokeMaskCtx.save();
    strokeMaskCtx.font = font;
    strokeMaskCtx.textAlign = "left";
    strokeMaskCtx.textBaseline = "middle";
    strokeMaskCtx.lineJoin = "round";
    strokeMaskCtx.lineCap = "round";
    for (let i = 0; i < spans.length; i += 1) {
      const span = spans[i];
      const seedA = glyphSeedA[span.index] ?? 0.5;
      const seedB = glyphSeedB[span.index] ?? 0.5;
      const phase = emitterPhase * (1.2 + seedA * 0.92) + seedB * 13.7;
      const offsetX = Math.sin(phase) * (0.8 + outline * 0.5);
      const offsetY = Math.cos(phase * 1.23) * (0.6 + outline * 0.42);
      const widthA = outline * (0.76 + 0.34 * (0.5 + 0.5 * Math.sin(phase * 1.81)));
      const widthB = outline * (0.52 + 0.28 * (0.5 + 0.5 * Math.cos(phase * 1.37)));

      strokeMaskCtx.strokeStyle = "rgba(255, 255, 255, 0.98)";
      strokeMaskCtx.lineWidth = widthA;
      strokeMaskCtx.strokeText(span.glyph, span.x + offsetX, centerY + offsetY);

      strokeMaskCtx.strokeStyle = "rgba(255, 255, 255, 0.72)";
      strokeMaskCtx.lineWidth = widthB;
      strokeMaskCtx.strokeText(span.glyph, span.x - offsetX * 0.54, centerY - offsetY * 0.54);
    }
    strokeMaskCtx.restore();

    glowMaskCtx.clearRect(0, 0, width, height);
    glowMaskCtx.save();
    glowMaskCtx.globalAlpha = 0.86;
    glowMaskCtx.filter = `blur(${Math.max(5, Math.round(outline * 1.05))}px)`;
    glowMaskCtx.drawImage(strokeMaskCanvas, 0, -Math.max(2, Math.round(outline * 0.6)));
    glowMaskCtx.restore();
    glowMaskCtx.save();
    glowMaskCtx.globalAlpha = 0.74;
    glowMaskCtx.filter = `blur(${Math.max(3, Math.round(outline * 0.62))}px)`;
    glowMaskCtx.drawImage(strokeMaskCanvas, 0, 0);
    glowMaskCtx.restore();
    glowMaskCtx.save();
    glowMaskCtx.globalAlpha = 0.58;
    glowMaskCtx.filter = `blur(${Math.max(4, Math.round(outline * 0.95))}px)`;
    glowMaskCtx.drawImage(strokeMaskCanvas, 0, Math.max(2, Math.round(outline * 0.55)));
    glowMaskCtx.restore();
    glowMaskCtx.save();
    glowMaskCtx.globalAlpha = 0.56;
    glowMaskCtx.filter = `blur(${Math.max(10, Math.round(outline * 2.9))}px)`;
    glowMaskCtx.drawImage(strokeMaskCanvas, 0, -Math.max(12, Math.round(outline * 4.6)));
    glowMaskCtx.restore();
    glowMaskCtx.save();
    glowMaskCtx.globalAlpha = 0.38;
    glowMaskCtx.filter = `blur(${Math.max(14, Math.round(outline * 4.2))}px)`;
    glowMaskCtx.drawImage(strokeMaskCanvas, 0, -Math.max(18, Math.round(outline * 6.6)));
    glowMaskCtx.restore();
    glowMaskCtx.save();
    glowMaskCtx.globalAlpha = 0.22;
    glowMaskCtx.filter = `blur(${Math.max(18, Math.round(outline * 5.2))}px)`;
    glowMaskCtx.drawImage(strokeMaskCanvas, 0, -Math.max(24, Math.round(outline * 8.8)));
    glowMaskCtx.restore();
    glowMaskCtx.save();
    glowMaskCtx.globalAlpha = 0.24;
    glowMaskCtx.filter = `blur(${Math.max(16, Math.round(outline * 3.9))}px)`;
    glowMaskCtx.drawImage(
      strokeMaskCanvas,
      0,
      0,
      width,
      height,
      0,
      -Math.max(26, Math.round(outline * 9.8)),
      width,
      Math.round(height * 1.62)
    );
    glowMaskCtx.restore();

    glowFireCtx.clearRect(0, 0, width, height);
    glowFireCtx.drawImage(fireCanvas, 0, 0, width, height);
    glowFireCtx.globalCompositeOperation = "destination-in";
    glowFireCtx.drawImage(glowMaskCanvas, 0, 0);
    glowFireCtx.globalCompositeOperation = "source-over";

    coreFireCtx.clearRect(0, 0, width, height);
    coreFireCtx.drawImage(fireCanvas, 0, 0, width, height);
    coreFireCtx.globalCompositeOperation = "destination-in";
    coreFireCtx.drawImage(strokeMaskCanvas, 0, 0);
    coreFireCtx.globalCompositeOperation = "source-over";

    drawFlameJets(width, height, centerY, fontSize, outline);

    titleCtx.clearRect(0, 0, width, height);
    const emberReveal = introReveal(INTRO_EMBER_DELAY_MS, INTRO_EMBER_FADE_MS);
    const flameReveal = introReveal(INTRO_FLAME_DELAY_MS, INTRO_FLAME_FADE_MS);
    const silhouetteReveal = introReveal(INTRO_SILHOUETTE_DELAY_MS, INTRO_SILHOUETTE_FADE_MS);
    const outlineReveal = introReveal(INTRO_OUTLINE_DELAY_MS, INTRO_OUTLINE_FADE_MS);
    const windVisualShift = windCurrent * Math.max(2.1, outline * 0.62);
    const plumeLift = Math.max(18, Math.round(outline * 4.4));
    const plumeDrop = Math.max(3, Math.round(outline * 0.85));

    titleCtx.save();
    titleCtx.globalCompositeOperation = "lighter";
    titleCtx.globalAlpha = 0.3 * flameReveal;
    titleCtx.filter = `blur(${Math.max(16, Math.round(outline * 3.6))}px)`;
    titleCtx.drawImage(glowFireCanvas, windVisualShift * 0.34, -plumeLift * 1.6, width, Math.round(height * 1.58));
    titleCtx.restore();

    titleCtx.save();
    titleCtx.globalCompositeOperation = "lighter";
    titleCtx.globalAlpha = 0.44 * flameReveal;
    titleCtx.filter = `blur(${Math.max(9, Math.round(outline * 1.95))}px)`;
    titleCtx.drawImage(glowFireCanvas, windVisualShift * 0.24, -plumeLift * 0.9, width, Math.round(height * 1.28));
    titleCtx.drawImage(glowFireCanvas, windVisualShift * 0.18, plumeDrop * 0.35, width, Math.round(height * 1.02));
    titleCtx.restore();

    titleCtx.save();
    titleCtx.globalCompositeOperation = "lighter";
    titleCtx.globalAlpha = 0.84 * flameReveal;
    titleCtx.drawImage(coreFireCanvas, windVisualShift * 0.1, -Math.max(1, Math.round(outline * 0.2)), width, height);
    titleCtx.drawImage(coreFireCanvas, windVisualShift * 0.06, plumeDrop * 0.26, width, Math.round(height * 0.98));
    titleCtx.restore();

    titleCtx.save();
    titleCtx.globalCompositeOperation = "lighter";
    titleCtx.globalAlpha = 0.6 * flameReveal;
    titleCtx.filter = `blur(${Math.max(6, Math.round(outline * 1.24))}px)`;
    titleCtx.drawImage(jetCanvas, windVisualShift * 0.18, -Math.max(2, Math.round(outline * 0.44)));
    titleCtx.drawImage(jetCanvas, windVisualShift * 0.08, Math.max(4, Math.round(outline * 0.74)));
    titleCtx.restore();

    titleCtx.save();
    titleCtx.globalCompositeOperation = "lighter";
    titleCtx.globalAlpha = 0.97 * flameReveal;
    titleCtx.drawImage(jetCanvas, 0, 0);
    titleCtx.drawImage(jetCanvas, windVisualShift * 0.08, Math.max(2, Math.round(outline * 0.35)));
    titleCtx.restore();

    if (silhouetteReveal > 0.001) {
      titleCtx.save();
      titleCtx.globalCompositeOperation = "destination-out";
      titleCtx.font = font;
      titleCtx.textAlign = "center";
      titleCtx.textBaseline = "middle";
      titleCtx.fillStyle = `rgba(0, 0, 0, ${silhouetteReveal})`;
      fillSpacedText(titleCtx, TITLE_WORD, centerX, centerY, letterSpacing);
      titleCtx.restore();

      titleCtx.save();
      titleCtx.globalCompositeOperation = "source-over";
      titleCtx.font = font;
      titleCtx.textAlign = "center";
      titleCtx.textBaseline = "middle";
      const interiorFillAlpha = 0.95 * silhouetteReveal;
      titleCtx.fillStyle = `rgba(18, 18, 22, ${interiorFillAlpha})`;
      fillSpacedText(titleCtx, TITLE_WORD, centerX, centerY, letterSpacing);
      titleCtx.restore();
    }

    titleCtx.save();
    titleCtx.globalCompositeOperation = "screen";
    titleCtx.font = font;
    titleCtx.textAlign = "center";
    titleCtx.textBaseline = "middle";
    titleCtx.lineJoin = "round";
    titleCtx.lineCap = "round";
    titleCtx.strokeStyle = `rgba(255, 238, 204, ${0.72 * outlineReveal})`;
    titleCtx.lineWidth = Math.max(0.65, outline * 0.14);
    strokeSpacedText(titleCtx, TITLE_WORD, centerX, centerY, letterSpacing);
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
    const fadeHeight = Math.max(24, Math.round(fontSize * 0.26 + outline * 2));
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
    fireAccumulatorMs += deltaMs;
    emitterAccumulatorMs += deltaMs;
    while (emitterAccumulatorMs >= EMITTER_REBUILD_MS) {
      rebuildEmitter();
      emitterAccumulatorMs -= EMITTER_REBUILD_MS;
    }
    while (fireAccumulatorMs >= FIRE_UPDATE_MS) {
      stepFire();
      fireAccumulatorMs -= FIRE_UPDATE_MS;
    }
    updateEmbers(deltaMs, titleCanvas.width, titleCanvas.height);
    renderFireBuffer();
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
      root.remove();
    },
    isVisible: () => visible
  };
};
