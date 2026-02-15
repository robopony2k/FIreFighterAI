import type { RNG, Unit, Formation, Point } from "../../core/types.js";
import type { WorldState } from "../../core/state.js";
import type { InputState } from "../../core/inputState.js";
import type { UiState } from "../../core/uiState.js";
import type { RenderState } from "../../render/renderState.js";
import { TIME_SPEED_OPTIONS, ZOOM_STEP } from "../../core/config.js";
import { inBounds, indexFor } from "../../core/grid.js";
import { panCameraByPixels, screenToWorld, zoomAtPointer } from "../../render/inputProjection.js";
import { resetStatus, setStatus } from "../../core/state.js";
import {
  advancePhase,
  beginFireSeason,
  handleDeployAction,
  handleEscape,
  handleUnitDeployment,
  handleUnitRetask,
  togglePause
} from "../../sim/index.js";
import {
  assignFormationTargets,
  assignRosterCrew,
  clearFuelLine,
  clearUnitSelection,
  getSelectedUnits,
  getUnitAt,
  recruitUnit,
  selectUnit,
  setCrewFormation,
  setDeployMode,
  setTruckCrewMode,
  toggleUnitSelection,
  trainSelectedUnit,
  unassignRosterCrew
} from "../../sim/units.js";
import { initCharacterSelect } from "../character-select.js";
import { updateOverlay } from "../overlay.js";
import type { OverlayRefs } from "../overlay.js";
import type { PhaseUiApi } from "./index.js";
import { gateInput, isInputAllowed } from "./inputGate.js";
import type { InteractionMode, InputAction } from "./types.js";
import { ensureTileSoA } from "../../core/tileCache.js";
import { markFireBounds } from "../../sim/fire/bounds.js";
import { ensureFireBlocks, markFireBlockActiveByTile } from "../../sim/fire/activeBlocks.js";
import { DEFAULT_MAP_SIZE, DEFAULT_RUN_OPTIONS, DEFAULT_RUN_SEED } from "../run-config.js";
import type { NewRunConfig } from "../run-config.js";

const DEBUG_IGNITE_SIM_KICK_SECONDS = 0.12;

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

const DEBUG_IGNITE_TOGGLE_KEY = "i";
const DEBUG_CELL_TOGGLE_KEY = "d";
const DEBUG_TYPE_EVENT = "debug-type-colors-changed";

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

export const bindPhaseUi = (
  phaseUi: PhaseUiApi,
  state: WorldState,
  inputState: InputState,
  uiState: UiState,
  renderState: RenderState,
  rng: RNG,
  canvas: HTMLCanvasElement,
  onNewRun: (config: NewRunConfig) => void | Promise<void>,
  onThreeTest: (config: NewRunConfig) => void | Promise<void>,
  overlayRefs: OverlayRefs
): void => {
  let isPanning = false;
  let isSelecting = false;
  let isFormationDrag = false;
  let suppressClick = false;
  let isSpaceDown = false;
  let panAnchor: { x: number; y: number } | null = null;
  let panCamera: { x: number; y: number } | null = null;
  let selectStart: { x: number; y: number } | null = null;
  let selectEnd: { x: number; y: number } | null = null;
  let rightDragStart: { x: number; y: number } | null = null;

  const noteInteraction = (): void => {
    inputState.lastInteractionTime = performance.now();
  };

  let debugIgniteMode = inputState.debugIgniteMode;
  const debugToggleButton = phaseUi.controller.root.querySelector<HTMLButtonElement>(
    '[data-action="debug-ignite-toggle"]'
  );
  let debugTypeColors = inputState.debugTypeColors;
  const debugTypeButton = phaseUi.controller.root.querySelector<HTMLButtonElement>(
    '[data-action="debug-type-colors-toggle"]'
  );
  const refreshDebugToggle = (): void => {
    if (debugToggleButton) {
      debugToggleButton.classList.toggle("is-active", debugIgniteMode);
    }
  };
  const refreshDebugTypeToggle = (): void => {
    if (debugTypeButton) {
      debugTypeButton.classList.toggle("is-active", debugTypeColors);
    }
  };
  refreshDebugToggle();
  refreshDebugTypeToggle();

  const igniteDebugFireAt = (tile: { x: number; y: number }): void => {
    const idx = indexFor(state.grid, tile.x, tile.y);
    const target = state.tiles[idx];
    if (target.fuel <= 0) {
      setStatus(state, "Cannot ignite: no fuel.");
      return;
    }
    if (state.tileSoaDirty) {
      ensureTileSoA(state);
    }
    ensureFireBlocks(state);
    const newFire = Math.min(1, 0.65 + rng.next() * 0.3);
      target.fire = newFire;
      target.heat = Math.max(target.heat, target.ignitionPoint * 1.4);
      state.tileFire[idx] = target.fire;
      state.tileHeat[idx] = target.heat;
      if (state.tileIgniteAt[idx] < Number.POSITIVE_INFINITY) {
        state.tileIgniteAt[idx] = Number.POSITIVE_INFINITY;
        state.fireScheduledCount = Math.max(0, state.fireScheduledCount - 1);
      }
      markFireBlockActiveByTile(state, idx);
      markFireBounds(state, tile.x, tile.y);
      state.lastActiveFires = Math.max(state.lastActiveFires, 1);
      state.fireSimAccumulator = Math.max(state.fireSimAccumulator, DEBUG_IGNITE_SIM_KICK_SECONDS);
      setStatus(state, `Debug ignition at ${tile.x}, ${tile.y}`);
    };

  const isOverlayLocked = (): boolean => uiState.overlayVisible && uiState.overlayAction === "restart";

  const gate = (action: InputAction, handler: () => void): void => {
    gateInput(state.phase, getInteractionMode(state, inputState), action, handler, (reason) => setStatus(state, reason));
  };

  const toggleDebugIgniteMode = (): void => {
    gate("select", () => {
      debugIgniteMode = !debugIgniteMode;
      inputState.debugIgniteMode = debugIgniteMode;
      refreshDebugToggle();
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
      refreshDebugTypeToggle();
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

  const showStartMenu = (): void => {
    if (!startMenu) {
      return;
    }
    startMenu.classList.remove("hidden");
    state.paused = true;
  };

  const hideStartMenu = (): void => {
    if (!startMenu) {
      return;
    }
    startMenu.classList.add("hidden");
  };

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

  let lastRunConfig: NewRunConfig = {
    seed: DEFAULT_RUN_SEED,
    mapSize: DEFAULT_MAP_SIZE,
    options: {
      ...DEFAULT_RUN_OPTIONS,
      mapGen: { ...DEFAULT_RUN_OPTIONS.mapGen },
      fire: { ...DEFAULT_RUN_OPTIONS.fire },
      fuelProfiles: { ...DEFAULT_RUN_OPTIONS.fuelProfiles }
    },
    characterId: state.campaign.characterId,
    callsign: state.campaign.callsign
  };

  const characterSelect = initCharacterSelect(characterRefs, state, (config) => {
    lastRunConfig = config;
    onNewRun(config);
  });

  if (startNewRunButton) {
    startNewRunButton.addEventListener("click", () => {
      hideStartMenu();
      characterSelect.open(lastRunConfig);
    });
  }

  const startThreeTest = async (): Promise<void> => {
    const config = characterSelect.getCurrentConfig();
    lastRunConfig = config;
    characterRefs.characterScreen.classList.add("hidden");
    hideStartMenu();
    state.paused = false;
    await onNewRun(config);
    await onThreeTest(config);
  };

  if (startThreeTestButton) {
    startThreeTestButton.addEventListener("click", () => {
      void startThreeTest();
    });
  }

  if (startMenuThreeTestButton) {
    startMenuThreeTestButton.addEventListener("click", () => {
      void startThreeTest();
    });
  }

  phaseUi.state.on("cta", (actionId) => {
    if (isOverlayLocked()) {
      return;
    }
    if (actionId === "continue" && state.phase === "budget") {
      advancePhase(state, rng);
    }
  });

  document.addEventListener(
    "click",
    (event) => {
      selectRosterFromEvent(event);
    },
    true
  );

  document.addEventListener("keydown", (event) => {
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

  phaseUi.controller.root.addEventListener("click", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    const target = event.target;
    let elementTarget: Element | null = null;
    if (target instanceof Element) {
      elementTarget = target;
    } else if (target instanceof Node) {
      elementTarget = target.parentElement;
    }
    if (!elementTarget) {
      return;
    }
    const actionTarget = elementTarget.closest("[data-action]") as HTMLElement | null;
      if (actionTarget) {
        const action = actionTarget.dataset.action;
        if (!action) {
          return;
        }
        const speedMatch = action.match(/^time-speed-(\d+)$/);
        if (speedMatch) {
          const nextIndex = Number(speedMatch[1]);
          if (!Number.isNaN(nextIndex) && nextIndex >= 0 && nextIndex < TIME_SPEED_OPTIONS.length) {
            gate("timeControl", () => {
              state.timeSpeedIndex = nextIndex;
              setStatus(state, `Time speed ${TIME_SPEED_OPTIONS[nextIndex]}x.`);
              phaseUi.sync(state, inputState);
            });
          }
          return;
        }
        noteInteraction();
        if (action === "select-roster") {
          selectRosterFromEvent(event);
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
        gate("timeControl", () => togglePause(state));
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
          refreshDebugToggle();
          setStatus(
            state,
            debugIgniteMode ? "Fuel break (backburn) mode enabled. Click to ignite." : "Fuel break mode disabled."
          );
        });
        noteInteraction();
        return;
      }
      if (action === "focus-base") {
        phaseUi.state.toggleBaseOpsOpen();
        noteInteraction();
        return;
      }
      if (action === "select-truck") {
        const id = Number(actionTarget.dataset.truckId ?? "");
        if (Number.isFinite(id)) {
          const truck = state.units.find((unit) => unit.kind === "truck" && unit.id === id) ?? null;
          if (truck) {
            gate("select", () => {
              selectUnit(state, truck);
              setDeployMode(state, null);
            });
            noteInteraction();
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
        const selectedTruck = state.units.find((unit) => unit.selected && unit.kind === "truck") ?? null;
        if (selectedTruck) {
          setTruckCrewMode(state, selectedTruck.id, "boarded");
        }
        return;
      }
      if (action === "crew-deploy") {
        const selectedTruck = state.units.find((unit) => unit.selected && unit.kind === "truck") ?? null;
        if (selectedTruck) {
          setTruckCrewMode(state, selectedTruck.id, "deployed");
        }
        return;
      }
      const formationMatch = action.match(/^formation-(narrow|medium|wide)$/);
      if (formationMatch) {
        const formation = formationMatch[1] as Formation;
        const selectedTruck = state.units.find((unit) => unit.selected && unit.kind === "truck") ?? null;
        if (selectedTruck) {
          setCrewFormation(state, selectedTruck.id, formation);
        }
        return;
      }
      return;
    }

    selectRosterFromEvent(event);
  });

  overlayRefs.overlayRestart.addEventListener("click", () => {
    if (uiState.overlayAction === "restart") {
      hideStartMenu();
      characterSelect.open(lastRunConfig);
      return;
    }
    uiState.overlayVisible = false;
  });

  const getCanvasPos = (event: MouseEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY
    };
  };

  canvas.addEventListener("click", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    if (state.deployMode === "clear") {
      return;
    }
    noteInteraction();
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    const tile = getTileFromPointer(state, renderState, canvas, event);
    if (!tile) {
      return;
    }
    if (debugIgniteMode) {
      igniteDebugFireAt(tile);
      return;
    }
    const clickedUnit = getUnitAt(state, tile.x, tile.y);
    if (clickedUnit) {
      gate("select", () => {
        let unitToSelect: Unit | null = clickedUnit;
        if (clickedUnit.kind === "firefighter") {
          if (clickedUnit.assignedTruckId) {
            unitToSelect = state.units.find((u) => u.id === clickedUnit.assignedTruckId) ?? null;
            if (unitToSelect) {
              setStatus(state, "Firefighter selected. Controlling assigned truck.");
            }
          } else {
            unitToSelect = null;
            setStatus(state, "This firefighter is not assigned to a truck.");
          }
        }

        if (unitToSelect) {
          if (event.shiftKey) {
            toggleUnitSelection(state, unitToSelect);
          } else {
            selectUnit(state, unitToSelect);
          }
        } else if (!event.shiftKey) {
          clearUnitSelection(state);
        }
        setDeployMode(state, null);
      });
      return;
    }
    if (state.deployMode) {
      gate("deploy", () => handleUnitDeployment(state, rng, tile.x, tile.y));
      return;
    }
    gate("select", () => {
      if (!event.shiftKey) {
        clearUnitSelection(state);
      }
      setStatus(state, "Select a unit or choose a deployment.");
    });
  });

  canvas.addEventListener("mousedown", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    noteInteraction();
    const canvasPos = getCanvasPos(event);
    if (event.button === 1 || (event.button === 0 && isSpaceDown)) {
      gate("pan", () => {
        isPanning = true;
        panAnchor = canvasPos;
        panCamera = { x: renderState.cameraCenter.x, y: renderState.cameraCenter.y };
      });
      return;
    }
    if (event.button === 2) {
      if (state.selectedUnitIds.length > 0) {
        gate("formation", () => {
          const tile = getTileFromPointer(state, renderState, canvas, event);
          if (tile) {
            isFormationDrag = true;
            rightDragStart = canvasPos;
            inputState.formationStart = tile;
            inputState.formationEnd = tile;
          }
        });
      }
      return;
    }
    if (state.deployMode === "clear" && state.phase === "maintenance") {
      gate("clearFuelBreak", () => {
        const tile = getTileFromPointer(state, renderState, canvas, event);
        if (!tile) {
          return;
        }
        inputState.clearLineStart = tile;
      });
      return;
    }
    if (event.button !== 0) {
      return;
    }
    gate("select", () => {
      isSelecting = true;
      selectStart = canvasPos;
      selectEnd = canvasPos;
      inputState.selectionBox = { x1: canvasPos.x, y1: canvasPos.y, x2: canvasPos.x, y2: canvasPos.y };
    });
  });

  canvas.addEventListener("mouseup", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    noteInteraction();
    const canvasPos = getCanvasPos(event);
    if (event.button === 2) {
      if (isFormationDrag) {
        const tile = getTileFromPointer(state, renderState, canvas, event);
        const dragDistance =
          rightDragStart && event
            ? Math.hypot(canvasPos.x - rightDragStart.x, canvasPos.y - rightDragStart.y)
            : 0;
        if (tile && dragDistance < 6) {
          gate("retask", () => handleUnitRetask(state, tile.x, tile.y));
        } else {
          const start = inputState.formationStart;
          const end = inputState.formationEnd;
          if (start && end) {
            gate("formation", () => {
              const selectedUnits = getSelectedUnits(state);
              assignFormationTargets(state, selectedUnits, start, end);
            });
          }
        }
        isFormationDrag = false;
        rightDragStart = null;
        inputState.formationStart = null;
        inputState.formationEnd = null;
      } else if (state.selectedUnitIds.length > 0) {
        const tile = getTileFromPointer(state, renderState, canvas, event);
        if (tile) {
          gate("retask", () => handleUnitRetask(state, tile.x, tile.y));
        }
      }
      return;
    }
    if (isPanning) {
      isPanning = false;
      panAnchor = null;
      panCamera = null;
      suppressClick = true;
      return;
    }
    if (isSelecting) {
      if (selectStart && selectEnd) {
        const dx = selectEnd.x - selectStart.x;
        const dy = selectEnd.y - selectStart.y;
        const dist = Math.hypot(dx, dy);
        if (dist > 6) {
      const startWorld = screenToWorld(state, renderState, canvas, selectStart.x, selectStart.y);
      const endWorld = screenToWorld(state, renderState, canvas, selectEnd.x, selectEnd.y);
          const minX = Math.min(startWorld.x, endWorld.x);
          const maxX = Math.max(startWorld.x, endWorld.x);
          const minY = Math.min(startWorld.y, endWorld.y);
          const maxY = Math.max(startWorld.y, endWorld.y);
          if (!event.shiftKey) {
            clearUnitSelection(state);
          }
          const newlySelectedTrucks = new Set<number>();
          state.units.forEach((unit) => {
            if (unit.x >= minX && unit.x <= maxX && unit.y >= minY && unit.y <= maxY) {
              if (unit.kind === "truck") {
                newlySelectedTrucks.add(unit.id);
              } else if (unit.kind === "firefighter" && unit.assignedTruckId) {
                newlySelectedTrucks.add(unit.assignedTruckId);
              }
            }
          });

          newlySelectedTrucks.forEach((truckId) => {
            const truck = state.units.find((u) => u.id === truckId);
            if (truck) {
              truck.selected = true;
              if (!state.selectedUnitIds.includes(truck.id)) {
                state.selectedUnitIds.push(truck.id);
              }
            }
          });

          if (state.selectedUnitIds.length > 0) {
            setStatus(state, `${state.selectedUnitIds.length} truck(s) selected. Right-click to move.`);
          } else {
            resetStatus(state);
          }
          suppressClick = true;
        } else if (!event.shiftKey) {
          clearUnitSelection(state);
        }
      }
      isSelecting = false;
      selectStart = null;
      selectEnd = null;
      inputState.selectionBox = null;
      return;
    }
    if (!inputState.clearLineStart) {
      return;
    }
    const tile = getTileFromPointer(state, renderState, canvas, event);
    if (!tile) {
      inputState.clearLineStart = null;
      return;
    }
    gate("clearFuelBreak", () => {
      clearFuelLine(state, rng, inputState.clearLineStart as { x: number; y: number }, tile);
      inputState.clearLineStart = null;
    });
  });

  canvas.addEventListener("mouseleave", () => {
    inputState.clearLineStart = null;
    isPanning = false;
    panAnchor = null;
    panCamera = null;
    isFormationDrag = false;
    rightDragStart = null;
    inputState.formationStart = null;
    inputState.formationEnd = null;
    isSelecting = false;
    selectStart = null;
    selectEnd = null;
    inputState.selectionBox = null;
    inputState.debugHoverTile = null;
    inputState.debugHoverWorld = null;
  });

  canvas.addEventListener("mousemove", (event) => {
    if (isOverlayLocked()) {
      return;
    }
    if (inputState.debugCellEnabled) {
      const world = getWorldFromPointer(state, renderState, canvas, event);
      inputState.debugHoverWorld = world;
      const tileX = Math.floor(world.x);
      const tileY = Math.floor(world.y);
      inputState.debugHoverTile = inBounds(state.grid, tileX, tileY) ? { x: tileX, y: tileY } : null;
    } else if (inputState.debugHoverTile || inputState.debugHoverWorld) {
      inputState.debugHoverTile = null;
      inputState.debugHoverWorld = null;
    }
    if (isPanning || isSelecting || isFormationDrag) {
      noteInteraction();
    }
    if (isFormationDrag) {
      const tile = getTileFromPointer(state, renderState, canvas, event);
      if (tile) {
        inputState.formationEnd = tile;
      }
      return;
    }
    if (isPanning && panAnchor && panCamera) {
      const canvasPos = getCanvasPos(event);
      const dx = canvasPos.x - panAnchor.x;
      const dy = canvasPos.y - panAnchor.y;
      renderState.cameraCenter = panCameraByPixels(renderState, panCamera, dx, dy);
      return;
    }
    if (isSelecting && selectStart) {
      const canvasPos = getCanvasPos(event);
      selectEnd = canvasPos;
      inputState.selectionBox = {
        x1: selectStart.x,
        y1: selectStart.y,
        x2: canvasPos.x,
        y2: canvasPos.y
      };
      return;
    }
  });

  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });

  canvas.addEventListener(
    "wheel",
    (event) => {
      if (isOverlayLocked()) {
        return;
      }
      if (!isInputAllowed(state.phase, getInteractionMode(state, inputState), "zoom").allowed) {
        return;
      }
      noteInteraction();
      event.preventDefault();
      const modeScale = event.deltaMode === 1 ? 22 : event.deltaMode === 2 ? 60 : 1;
      const scaledDelta = event.deltaY * modeScale;
      const clamped = Math.max(-160, Math.min(160, scaledDelta));
      const zoomFactor = Math.exp(-clamped * 0.002);
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const canvasX = (event.clientX - rect.left) * scaleX;
      const canvasY = (event.clientY - rect.top) * scaleY;
      zoomAtPointer(state, renderState, canvas, renderState.zoom * zoomFactor, canvasX, canvasY);
    },
    { passive: false }
  );

  document.addEventListener("keydown", (event) => {
    if (event.repeat) {
      return;
    }
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
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

  document.addEventListener("keyup", (event) => {
    if (event.key === " ") {
      isSpaceDown = false;
    }
  });

  if (startMenu) {
    showStartMenu();
  } else {
    characterSelect.open(lastRunConfig);
  }
  updateOverlay(overlayRefs, uiState);
};
