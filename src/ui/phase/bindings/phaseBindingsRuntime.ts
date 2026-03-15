import type { RNG, Formation, Point } from "../../../core/types.js";
import type { WorldState } from "../../../core/state.js";
import type { InputState } from "../../../core/inputState.js";
import type { UiState } from "../../../core/uiState.js";
import type { RenderState } from "../../../render/renderState.js";
import { ZOOM_STEP } from "../../../core/config.js";
import { inBounds } from "../../../core/grid.js";
import { screenToWorld, zoomAtPointer } from "../../../render/inputProjection.js";
import { setStatus } from "../../../core/state.js";
import {
  advancePhase,
  beginFireSeason,
  cancelSkipToNextFire,
  closeAnnualReport,
  getActiveTimeSpeedOptions,
  getActiveTimeSpeedValue,
  handleDeployAction,
  handleEscape,
  isSkipToNextFireAvailable,
  requestSkipToNextFire,
  syncActiveTimeSpeedIndex,
  togglePause
} from "../../../sim/index.js";
import {
  assignRosterCrew,
  recruitUnit,
  selectUnit,
  setCrewFormation,
  setDeployMode,
  setTruckCrewMode,
  trainSelectedUnit,
  unassignRosterCrew
} from "../../../sim/units.js";
import { initCharacterSelect } from "../../character-select.js";
import { updateOverlay } from "../../overlay.js";
import type { OverlayRefs } from "../../overlay.js";
import type { PhaseUiApi } from "../index.js";
import { gateInput, isInputAllowed } from "../inputGate.js";
import type { InteractionMode, InputAction } from "../types.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS, DEFAULT_RUN_SEED } from "../../run-config.js";
import type { NewRunConfig } from "../../run-config.js";
import { loadFuelProfileOverrides } from "../../../persistence/fuelProfiles.js";
import { loadLastRunConfig, saveLastRunConfig } from "../../../persistence/lastRunConfig.js";
import { bindCanvasMouseHandlers } from "./canvasMouse.js";
import { DEBUG_CELL_TOGGLE_KEY, DEBUG_IGNITE_TOGGLE_KEY, DEBUG_TYPE_EVENT } from "./debugTools.js";
import { isEditableTarget } from "./keyboard.js";
import { hideStartMenu as hideStartMenuView, showStartMenu as showStartMenuView } from "./startMenu.js";
import { getActionTarget } from "./uiActions.js";
import { listenPhaseUiCommand, type PhaseUiCommand } from "../commandChannel.js";
import type { UiAudioController, UiAudioCue } from "../../../audio/uiAudio.js";

type HudMusicSettings = {
  muted: boolean;
  volume: number;
};

type HudMusicControls = {
  getSettings: () => HudMusicSettings;
  toggleMuted: () => void;
  setVolume: (value: number) => void;
  onChange: (listener: (settings: HudMusicSettings) => void) => () => void;
};

const cloneRunConfig = (config: NewRunConfig): NewRunConfig => ({
  seed: Number.isFinite(config.seed) ? Math.floor(config.seed) : DEFAULT_RUN_SEED,
  mapSize: config.mapSize,
  characterId: config.characterId,
  callsign: config.callsign,
  options: {
    ...DEFAULT_RUN_OPTIONS,
    ...config.options,
    mapGen: { ...DEFAULT_RUN_OPTIONS.mapGen, ...config.options.mapGen },
    fire: { ...DEFAULT_RUN_OPTIONS.fire, ...config.options.fire },
    fuelProfiles: { ...(config.options.fuelProfiles ?? {}) }
  }
});

const resolveRunConfig = (defaults: NewRunConfig, persisted?: NewRunConfig | null): NewRunConfig => {
  if (!persisted) {
    return cloneRunConfig(defaults);
  }
  return {
    seed: persisted.seed,
    mapSize: persisted.mapSize,
    characterId: persisted.characterId,
    callsign: persisted.callsign.trim().length > 0 ? persisted.callsign : defaults.callsign,
    options: {
      ...defaults.options,
      ...persisted.options,
      mapGen: { ...defaults.options.mapGen, ...persisted.options.mapGen },
      fire: { ...defaults.options.fire, ...persisted.options.fire },
      fuelProfiles: { ...(persisted.options.fuelProfiles ?? {}) }
    }
  };
};

const getInteractionMode = (state: WorldState, inputState: InputState): InteractionMode => {
  if (state.deployMode === "clear") {
    return "fuelBreak";
  }
  if (state.deployMode === "firefighter" || state.deployMode === "truck") {
    return "deploy";
  }
  if (inputState.formationStart) {
    return "formation";
  }
  return "default";
};

const getTileFromPointer = (
  state: WorldState,
  renderState: RenderState,
  canvas: HTMLCanvasElement,
  event: MouseEvent
): { x: number; y: number } | null => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const canvasX = (event.clientX - rect.left) * scaleX;
  const canvasY = (event.clientY - rect.top) * scaleY;
  const world = screenToWorld(state, renderState, canvas, canvasX, canvasY);
  const tileX = Math.floor(world.x);
  const tileY = Math.floor(world.y);
  if (!inBounds(state.grid, tileX, tileY)) {
    return null;
  }
  return { x: tileX, y: tileY };
};

export type PhaseUiBindingDeps = {
  phaseUi: PhaseUiApi;
  state: WorldState;
  inputState: InputState;
  uiState: UiState;
  renderState: RenderState;
  rng: RNG;
  canvas: HTMLCanvasElement;
  onNewRun: (config: NewRunConfig) => void | Promise<void>;
  onThreeTest: (config: NewRunConfig) => void | Promise<void>;
  overlayRefs: OverlayRefs;
  showStartMenuOnBind?: boolean;
  startThreeOnConfirm?: boolean;
  onMinimapPan?: (tile: { x: number; y: number }) => void;
  uiAudio?: UiAudioController;
  musicControls?: HudMusicControls;
};

const getWorldFromPointer = (
  state: WorldState,
  renderState: RenderState,
  canvas: HTMLCanvasElement,
  event: MouseEvent
): Point => {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  const canvasX = (event.clientX - rect.left) * scaleX;
  const canvasY = (event.clientY - rect.top) * scaleY;
  return screenToWorld(state, renderState, canvas, canvasX, canvasY);
};

export const bindPhaseUi = ({
  phaseUi,
  state,
  inputState,
  uiState,
  renderState,
  rng,
  canvas,
  onNewRun,
  onThreeTest,
  overlayRefs,
  showStartMenuOnBind = true,
  startThreeOnConfirm = false,
  onMinimapPan,
  uiAudio,
  musicControls
}: PhaseUiBindingDeps): (() => void) => {
  let isSpaceDown = false;
  const disposers: Array<() => void> = [];

  const listen = <K extends keyof DocumentEventMap>(
    target: Document,
    type: K,
    listener: (event: DocumentEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void => {
    target.addEventListener(type, listener as EventListener, options);
    disposers.push(() => target.removeEventListener(type, listener as EventListener, options));
  };
  const listenCanvas = <K extends keyof HTMLElementEventMap>(
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void => {
    canvas.addEventListener(type, listener as EventListener, options);
    disposers.push(() => canvas.removeEventListener(type, listener as EventListener, options));
  };
  const listenElement = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void => {
    target.addEventListener(type, listener as EventListener, options);
    disposers.push(() => target.removeEventListener(type, listener as EventListener, options));
  };
  const listenWindow = <K extends keyof WindowEventMap>(
    type: K,
    listener: (event: WindowEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void => {
    window.addEventListener(type, listener as EventListener, options);
    disposers.push(() => window.removeEventListener(type, listener as EventListener, options));
  };

  const noteInteraction = (): void => {
    inputState.lastInteractionTime = performance.now();
    uiAudio?.unlock();
  };

  let debugIgniteMode = inputState.debugIgniteMode;
  let debugTypeColors = inputState.debugTypeColors;

  const isOverlayLocked = (): boolean => uiState.overlayVisible && uiState.overlayAction === "restart";

  const gate = (action: InputAction, handler: () => void): void => {
    gateInput(state.phase, getInteractionMode(state, inputState), action, handler, (reason) => setStatus(state, reason));
  };

  const toggleDebugIgniteMode = (): void => {
    gate("select", () => {
      debugIgniteMode = !debugIgniteMode;
      inputState.debugIgniteMode = debugIgniteMode;
      setStatus(
        state,
        debugIgniteMode ? "Debug ignite mode enabled. Click to place a fire." : "Debug ignite mode disabled."
      );
      noteInteraction();
    });
  };

  const toggleDebugTypeColors = (): void => {
    gate("select", () => {
      debugTypeColors = !debugTypeColors;
      inputState.debugTypeColors = debugTypeColors;
      state.terrainDirty = true;
      setStatus(state, debugTypeColors ? "Debug type colors enabled." : "Debug type colors disabled.");
      window.dispatchEvent(new CustomEvent(DEBUG_TYPE_EVENT, { detail: { enabled: debugTypeColors } }));
      noteInteraction();
    });
  };

  const toggleDebugCellMode = (): void => {
    gate("select", () => {
      inputState.debugCellEnabled = !inputState.debugCellEnabled;
      if (!inputState.debugCellEnabled) {
        inputState.debugHoverTile = null;
        inputState.debugHoverWorld = null;
      }
      setStatus(state, inputState.debugCellEnabled ? "Debug cell overlay enabled." : "Debug cell overlay disabled.");
      noteInteraction();
    });
  };

  const getRosterTargetFromEvent = (event: Event): HTMLElement | null => {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    for (const entry of path) {
      if (entry instanceof HTMLElement && entry.dataset.rosterId) {
        return entry;
      }
    }
    const target = event.target;
    if (target instanceof Element) {
      return target.closest("[data-roster-id]") as HTMLElement | null;
    }
    if (target instanceof Node) {
      return target.parentElement?.closest("[data-roster-id]") as HTMLElement | null;
    }
    return null;
  };

  const selectRosterFromEvent = (event: Event): void => {
    if (isOverlayLocked()) {
      return;
    }
    const rosterTarget = getRosterTargetFromEvent(event);
    if (!rosterTarget || !phaseUi.controller.root.contains(rosterTarget)) {
      return;
    }
    const rosterId = rosterTarget.dataset.rosterId;
    if (!rosterId) {
      return;
    }
    noteInteraction();
    state.selectedRosterId = Number(rosterId);
  };

  const startMenu = document.getElementById("startMenu") as HTMLDivElement | null;
  const startNewRunButton = document.getElementById("startNewRun") as HTMLButtonElement | null;
  const startMenuThreeTestButton = document.getElementById("startMenuThreeTest") as HTMLButtonElement | null;
  const startThreeTestButton = document.getElementById("startThreeTest") as HTMLButtonElement | null;

  const showStartMenuPanel = (): void => showStartMenuView(startMenu, () => {
    state.paused = true;
  });
  const hideStartMenuPanel = (): void => hideStartMenuView(startMenu);

  const characterRefs = {
    characterScreen: document.getElementById("characterScreen") as HTMLDivElement,
    characterGrid: document.getElementById("characterGrid") as HTMLDivElement,
    characterSummary: document.getElementById("characterSummary") as HTMLParagraphElement,
    characterConfirm: document.getElementById("characterConfirm") as HTMLButtonElement,
    characterPreviewPortrait: document.getElementById("characterPreviewPortrait") as HTMLDivElement,
    characterPreviewImage: document.getElementById("characterPreviewImage") as HTMLImageElement,
    characterPreviewInitials: document.getElementById("characterPreviewInitials") as HTMLSpanElement,
    characterNameInput: document.getElementById("characterNameInput") as HTMLInputElement,
    characterNameRandom: document.getElementById("characterNameRandom") as HTMLButtonElement,
    runSeedInput: document.getElementById("runSeedInput") as HTMLInputElement,
    runMapSizeInputs: Array.from(
      document.querySelectorAll<HTMLInputElement>('#characterScreen input[name="mapSize"]')
    ),
    runUnlimitedMoney: document.getElementById("runUnlimitedMoney") as HTMLInputElement,
    mapGenInputs: Array.from(
      document.querySelectorAll<HTMLInputElement>('#characterScreen input[data-mapgen-key]')
    ),
    fireInputs: Array.from(
      document.querySelectorAll<HTMLInputElement>('#characterScreen input[data-fire-key]')
    ),
    fuelProfileGrid: document.getElementById("fuelProfileGrid") as HTMLDivElement
  };

  const defaultRunConfig: NewRunConfig = {
    seed: DEFAULT_RUN_SEED,
    mapSize: DEFAULT_MAP_SIZE,
    options: {
      ...DEFAULT_RUN_OPTIONS,
      mapGen: { ...DEFAULT_RUN_OPTIONS.mapGen },
      fire: { ...DEFAULT_RUN_OPTIONS.fire },
      fuelProfiles: { ...loadFuelProfileOverrides() }
    },
    characterId: state.campaign.characterId,
    callsign: state.campaign.callsign
  };
  let lastRunConfig: NewRunConfig = resolveRunConfig(defaultRunConfig, loadLastRunConfig());

  const launchSession = async (config: NewRunConfig, openThreeTest = startThreeOnConfirm): Promise<void> => {
    const nextConfig = resolveRunConfig(defaultRunConfig, cloneRunConfig(config));
    lastRunConfig = nextConfig;
    saveLastRunConfig(nextConfig);
    characterRefs.characterScreen.classList.add("hidden");
    hideStartMenuPanel();
    state.paused = false;
    await onNewRun(nextConfig);
    if (openThreeTest) {
      await onThreeTest(nextConfig);
    }
  };

  const characterSelect = initCharacterSelect(characterRefs, state, (config) => {
    void launchSession(config);
  }, lastRunConfig);

  if (startNewRunButton) {
    listenElement(startNewRunButton, "click", () => {
      hideStartMenuPanel();
      characterSelect.open(lastRunConfig);
    });
  }

  const startThreeTest = async (): Promise<void> => {
    const config = characterSelect.getCurrentConfig();
    await launchSession(config, true);
  };

  if (startThreeTestButton) {
    listenElement(startThreeTestButton, "click", () => {
      void startThreeTest();
    });
  }

  if (startMenuThreeTestButton) {
    listenElement(startMenuThreeTestButton, "click", () => {
      void startThreeTest();
    });
  }

  const onCta = (actionId: string): void => {
    if (isOverlayLocked()) {
      return;
    }
    if (actionId === "continue" && state.annualReportOpen) {
      closeAnnualReport(state);
    }
  };
  phaseUi.state.on("cta", onCta);
  disposers.push(() => phaseUi.state.off("cta", onCta));

  listen(
    document,
    "click",
    (event) => {
      selectRosterFromEvent(event);
    },
    true
  );

  listen(document, "keydown", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    if (event.repeat) {
      return;
    }
    if (event.key.toLowerCase() === DEBUG_IGNITE_TOGGLE_KEY && event.ctrlKey && event.shiftKey) {
      toggleDebugIgniteMode();
    }
    if (event.key.toLowerCase() === DEBUG_CELL_TOGGLE_KEY && event.ctrlKey && event.shiftKey) {
      toggleDebugCellMode();
    }
  });

  const applyCrewModeToSelection = (mode: "boarded" | "deployed"): void => {
    const selectedTrucks = state.units.filter((unit) => unit.selected && unit.kind === "truck");
    if (selectedTrucks.length === 0) {
      return;
    }
    selectedTrucks.forEach((truck) => setTruckCrewMode(state, truck.id, mode));
  };

  const applyFormationToSelection = (formation: Formation): void => {
    const selectedTrucks = state.units.filter((unit) => unit.selected && unit.kind === "truck");
    if (selectedTrucks.length === 0) {
      return;
    }
    selectedTrucks.forEach((truck) => setCrewFormation(state, truck.id, formation));
  };

  const getUiActionAudioCue = (action: string): UiAudioCue | null => {
    if (action === "pause" || action === "crew-board" || action === "crew-deploy" || action === "toggle-fuel-break" || action === "backburn") {
      return "toggle";
    }
    if (action === "time-skip-next-fire" || /^time-speed-\d+$/.test(action) || /^formation-(narrow|medium|wide)$/.test(action)) {
      return "toggle";
    }
    if (action === "select-unit" || action === "select-truck" || action === "select-roster" || action === "zoom-in" || action === "zoom-out") {
      return "click";
    }
    if (
      /^deploy-(firefighter|truck)$/.test(action) ||
      /^recruit-(firefighter|truck)$/.test(action) ||
      /^train-(speed|power|range|resilience)$/.test(action) ||
      action === "crew-assign" ||
      action === "crew-unassign"
    ) {
      return "confirm";
    }
    return null;
  };

  const playUiActionAudio = (action: string): void => {
    const cue = getUiActionAudioCue(action);
    if (!cue) {
      return;
    }
    uiAudio?.play(cue);
  };

  const findHoverActionable = (target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof Element)) {
      return null;
    }
    const actionable = target.closest("[data-action], button, [data-roster-id], .phase-truck-row");
    return actionable instanceof HTMLElement ? actionable : null;
  };

  const isHoverActionable = (element: HTMLElement): boolean => {
    if (element.classList.contains("is-hidden") || element.getAttribute("aria-hidden") === "true") {
      return false;
    }
    if (element instanceof HTMLButtonElement && element.disabled) {
      return false;
    }
    return true;
  };

  if (uiAudio) {
    phaseUi.controller.setAudioState(uiAudio.getSettings());
    phaseUi.controller.onAudioMuteToggle(() => {
      noteInteraction();
      uiAudio.play("toggle");
      uiAudio.toggleMuted();
    });
    phaseUi.controller.onAudioVolumeChange((value) => {
      noteInteraction();
      uiAudio.setVolume(value);
    });
    disposers.push(
      uiAudio.onChange((settings) => {
        phaseUi.controller.setAudioState(settings);
      })
    );
  }

  if (musicControls) {
    phaseUi.controller.setMusicState(musicControls.getSettings());
    phaseUi.controller.onMusicMuteToggle(() => {
      noteInteraction();
      uiAudio?.play("toggle");
      musicControls.toggleMuted();
    });
    phaseUi.controller.onMusicVolumeChange((value) => {
      noteInteraction();
      musicControls.setVolume(value);
    });
    disposers.push(
      musicControls.onChange((settings) => {
        phaseUi.controller.setMusicState(settings);
      })
    );
  }

  let lastHoverActionable: HTMLElement | null = null;
  listenElement(phaseUi.controller.root, "pointerover", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    const actionable = findHoverActionable(event.target);
    if (!actionable || !phaseUi.controller.root.contains(actionable) || !isHoverActionable(actionable)) {
      return;
    }
    if (actionable === lastHoverActionable) {
      return;
    }
    lastHoverActionable = actionable;
    uiAudio?.play("hover");
  });
  listenElement(phaseUi.controller.root, "pointerleave", () => {
    lastHoverActionable = null;
  });

  const runUiAction = (action: string, actionTarget?: HTMLElement | null, event?: Event): void => {
    playUiActionAudio(action);
    if (action === "continue") {
      if (state.annualReportOpen) {
        closeAnnualReport(state);
      }
      return;
    }
    const speedMatch = action.match(/^time-speed-(\d+)$/);
    if (speedMatch) {
      const nextIndex = Number(speedMatch[1]);
      const activeOptions = getActiveTimeSpeedOptions(state);
      if (!Number.isNaN(nextIndex) && nextIndex >= 0 && nextIndex < activeOptions.length) {
        gate("timeControl", () => {
          if (state.skipToNextFire) {
            cancelSkipToNextFire(state, "Skip to next fire cancelled.");
          }
          syncActiveTimeSpeedIndex(state, nextIndex);
          setStatus(
            state,
            `${state.simTimeMode === "incident" ? "Incident" : "Strategic"} time ${getActiveTimeSpeedValue(state)}x.`
          );
          phaseUi.sync(state, inputState);
        });
      }
      return;
    }
    if (action === "select-roster") {
      if (event) {
        selectRosterFromEvent(event);
      }
      return;
    }
    if (action === "zoom-in") {
      gate("zoom", () =>
        zoomAtPointer(state, renderState, canvas, renderState.zoom + ZOOM_STEP, canvas.width / 2, canvas.height / 2)
      );
      return;
    }
    if (action === "zoom-out") {
      gate("zoom", () =>
        zoomAtPointer(state, renderState, canvas, renderState.zoom - ZOOM_STEP, canvas.width / 2, canvas.height / 2)
      );
      return;
    }
    if (action === "pause") {
      gate("timeControl", () => {
        if (state.skipToNextFire) {
          cancelSkipToNextFire(state, "Skip to next fire cancelled.");
          if (!state.paused) {
            state.paused = true;
          }
          setStatus(state, "Simulation paused.");
          phaseUi.sync(state, inputState);
          return;
        }
        togglePause(state);
      });
      return;
    }
    if (action === "time-skip-next-fire") {
      gate("timeControl", () => {
        if (!isSkipToNextFireAvailable(state)) {
          if (state.skipToNextFire) {
            setStatus(state, "Already seeking next fire incident.");
          } else if (state.lastActiveFires > 0) {
            setStatus(state, "Cannot skip: active fires already on the map.");
          } else if (state.gameOver) {
            setStatus(state, "Cannot skip after game over.");
          }
          phaseUi.sync(state, inputState);
          return;
        }
        if (requestSkipToNextFire(state)) {
          phaseUi.sync(state, inputState);
        }
      });
      return;
    }
    if (action === "debug-ignite-toggle") {
      toggleDebugIgniteMode();
      return;
    }
    if (action === "debug-type-colors-toggle") {
      toggleDebugTypeColors();
      return;
    }
    if (action === "toggle-fuel-break") {
      gate("clearFuelBreak", () => handleDeployAction(state, "clear"));
      return;
    }
    if (action === "deploy-firefighter") {
      gate("deploy", () => handleDeployAction(state, "firefighter"));
      return;
    }
    if (action === "deploy-truck") {
      gate("deploy", () => handleDeployAction(state, "truck"));
      return;
    }
    if (action === "backburn") {
      const selectedTruck = state.units.find((unit) => unit.kind === "truck" && unit.selected) ?? null;
      if (!selectedTruck) {
        setStatus(state, "Select a truck to issue a backburn.");
        return;
      }
      gate("select", () => {
        debugIgniteMode = !debugIgniteMode;
        inputState.debugIgniteMode = debugIgniteMode;
        setStatus(
          state,
          debugIgniteMode ? "Fuel break (backburn) mode enabled. Click to ignite." : "Fuel break mode disabled."
        );
      });
      return;
    }
    if (action === "select-truck") {
      const id = Number(actionTarget?.dataset.truckId ?? "");
      if (Number.isFinite(id)) {
        const truck = state.units.find((unit) => unit.kind === "truck" && unit.id === id) ?? null;
        if (truck) {
          gate("select", () => {
            selectUnit(state, truck);
            setDeployMode(state, null);
          });
        }
      }
      return;
    }
    if (action === "select-unit") {
      const id = Number(actionTarget?.dataset.unitId ?? "");
      if (Number.isFinite(id)) {
        const unit = state.units.find((entry) => entry.id === id) ?? null;
        if (unit) {
          gate("select", () => {
            selectUnit(state, unit);
            setDeployMode(state, null);
          });
        }
      }
      return;
    }
    if (action === "recruit-firefighter") {
      recruitUnit(state, rng, "firefighter");
      return;
    }
    if (action === "recruit-truck") {
      recruitUnit(state, rng, "truck");
      return;
    }
    if (action === "train-speed") {
      trainSelectedUnit(state, "speed");
      return;
    }
    if (action === "train-power") {
      trainSelectedUnit(state, "power");
      return;
    }
    if (action === "train-range") {
      trainSelectedUnit(state, "range");
      return;
    }
    if (action === "train-resilience") {
      trainSelectedUnit(state, "resilience");
      return;
    }
    if (action === "crew-assign") {
      const selected = state.roster.find((unit) => unit.id === state.selectedRosterId) ?? null;
      if (!selected || selected.kind !== "firefighter") {
        return;
      }
      const select = phaseUi.controller.root.querySelector('[data-role="crew-assign-select"]') as HTMLSelectElement | null;
      if (!select || !select.value) {
        return;
      }
      assignRosterCrew(state, selected.id, Number(select.value));
      return;
    }
    if (action === "crew-unassign") {
      const selected = state.roster.find((unit) => unit.id === state.selectedRosterId) ?? null;
      if (!selected || selected.kind !== "firefighter") {
        return;
      }
      unassignRosterCrew(state, selected.id);
      return;
    }
    if (action === "crew-board") {
      applyCrewModeToSelection("boarded");
      return;
    }
    if (action === "crew-deploy") {
      applyCrewModeToSelection("deployed");
      return;
    }
    const formationMatch = action.match(/^formation-(narrow|medium|wide)$/);
    if (formationMatch) {
      applyFormationToSelection(formationMatch[1] as Formation);
      return;
    }
  };

  listenElement(phaseUi.controller.root, "click", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    const actionTarget = getActionTarget(event.target);
    if (!actionTarget) {
      selectRosterFromEvent(event);
      return;
    }
    const action = actionTarget.dataset.action;
    if (!action) {
      return;
    }
    noteInteraction();
    runUiAction(action, actionTarget, event);
  });

  const onCommand = (command: PhaseUiCommand): void => {
    if (isOverlayLocked()) {
      return;
    }
    if (command.type === "action") {
      noteInteraction();
      let syntheticTarget: HTMLElement | null = null;
      if (command.payload) {
        syntheticTarget = document.createElement("div");
        Object.entries(command.payload).forEach(([key, value]) => {
          syntheticTarget!.dataset[key] = value;
        });
      }
      runUiAction(command.action, syntheticTarget, undefined);
      return;
    }
    if (command.type === "minimap-pan") {
      noteInteraction();
      if (onMinimapPan) {
        onMinimapPan(command.tile);
      } else {
        renderState.cameraCenter = { x: command.tile.x + 0.5, y: command.tile.y + 0.5 };
      }
    }
  };
  disposers.push(listenPhaseUiCommand(onCommand));

  listenElement(overlayRefs.overlayRestart, "click", () => {
    if (uiState.overlayAction === "restart") {
      hideStartMenuPanel();
      characterSelect.open(lastRunConfig);
      return;
    }
    uiState.overlayVisible = false;
  });

  bindCanvasMouseHandlers({
    state,
    inputState,
    renderState,
    rng,
    canvas,
    listenCanvas,
    noteInteraction,
    gate,
    isOverlayLocked,
    getTileFromPointer: (event) => getTileFromPointer(state, renderState, canvas, event),
    getWorldFromPointer: (event) => getWorldFromPointer(state, renderState, canvas, event),
    isDebugIgniteMode: () => debugIgniteMode,
    isPanModifierDown: () => isSpaceDown,
    canZoom: () => isInputAllowed(state.phase, getInteractionMode(state, inputState), "zoom").allowed
  });

  listen(document, "keydown", (event) => {
    if (event.repeat) {
      return;
    }
    if (isEditableTarget(event.target)) {
      return;
    }
    if (isOverlayLocked()) {
      return;
    }
    if (event.key === "Escape") {
      handleEscape(state, inputState);
    }
    if (event.key === " ") {
      isSpaceDown = true;
    }
    if (event.key.length === 1 && /^[0-9]$/.test(event.key)) {
      const slot = event.key === "0" ? 9 : Number(event.key) - 1;
      if (slot >= 0) {
        const trucks = state.units
          .filter((unit) => unit.kind === "truck")
          .sort((a, b) => (a.rosterId ?? a.id) - (b.rosterId ?? b.id))
          .slice(0, 10);
        const target = trucks[slot] ?? null;
        if (target) {
          gate("select", () => {
            selectUnit(state, target);
            setDeployMode(state, null);
          });
          noteInteraction();
          return;
        }
      }
    }
    if (event.key === "+" || event.key === "=") {
      gate("zoom", () =>
        zoomAtPointer(state, renderState, canvas, renderState.zoom + ZOOM_STEP, canvas.width / 2, canvas.height / 2)
      );
    }
    if (event.key === "-" || event.key === "_") {
      gate("zoom", () =>
        zoomAtPointer(state, renderState, canvas, renderState.zoom - ZOOM_STEP, canvas.width / 2, canvas.height / 2)
      );
    }
    if (event.key === "t" || event.key === "T") {
      renderState.renderTrees = !renderState.renderTrees;
      state.terrainDirty = true;
      setStatus(state, `Tree rendering ${renderState.renderTrees ? "on" : "off"}.`);
    }
    if (event.key === "e" || event.key === "E") {
      renderState.renderEffects = !renderState.renderEffects;
      setStatus(state, `Effects rendering ${renderState.renderEffects ? "on" : "off"}.`);
    }
  });

  listen(document, "keyup", (event) => {
    if (event.key === " ") {
      isSpaceDown = false;
    }
  });

  if (showStartMenuOnBind) {
    if (startMenu) {
      showStartMenuPanel();
    } else {
      characterSelect.open(lastRunConfig);
    }
  }
  updateOverlay(overlayRefs, uiState);
  return () => {
    for (let i = disposers.length - 1; i >= 0; i -= 1) {
      disposers[i]();
    }
  };
};








