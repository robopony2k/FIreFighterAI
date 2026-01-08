import { BASE_BUDGET, ISO_TILE_HEIGHT, ISO_TILE_WIDTH, TIME_SPEED_OPTIONS, ZOOM_STEP } from "../../core/config.js";
import { inBounds, indexFor } from "../../core/grid.js";
import { zoomAtPointer, screenToWorld } from "../../render/iso.js";
import { resetStatus, setStatus } from "../../core/state.js";
import { advancePhase, beginFireSeason, handleDeployAction, handleEscape, handleUnitDeployment, handleUnitRetask, togglePause } from "../../sim/index.js";
import { assignFormationTargets, assignRosterCrew, clearFuelLine, clearUnitSelection, getSelectedUnits, getUnitAt, recruitUnit, selectUnit, setDeployMode, setTruckCrewMode, toggleUnitSelection, trainSelectedUnit, unassignRosterCrew } from "../../sim/units.js";
import { getCharacterBaseBudget } from "../../core/characters.js";
import { initCharacterSelect } from "../character-select.js";
import { updateOverlay } from "../overlay.js";
import { gateInput, isInputAllowed } from "./inputGate.js";
import { markFireBounds } from "../../sim/fire/bounds.js";
const getInteractionMode = (state) => {
    if (state.deployMode === "clear") {
        return "fuelBreak";
    }
    if (state.deployMode === "firefighter" || state.deployMode === "truck") {
        return "deploy";
    }
    if (state.formationStart) {
        return "formation";
    }
    return "default";
};
const getTileFromPointer = (state, canvas, event) => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const canvasX = (event.clientX - rect.left) * scaleX;
    const canvasY = (event.clientY - rect.top) * scaleY;
    const world = screenToWorld(state, canvas, canvasX, canvasY);
    const tileX = Math.floor(world.x);
    const tileY = Math.floor(world.y);
    if (!inBounds(state.grid, tileX, tileY)) {
        return null;
    }
    return { x: tileX, y: tileY };
};
const DEBUG_IGNITE_TOGGLE_KEY = "i";
export const bindPhaseUi = (phaseUi, state, rng, canvas, onNewRun, overlayRefs) => {
    let isPanning = false;
    let isSelecting = false;
    let isFormationDrag = false;
    let suppressClick = false;
    let isSpaceDown = false;
    let panAnchor = null;
    let panCamera = null;
    let selectStart = null;
    let selectEnd = null;
    let rightDragStart = null;
    const noteInteraction = () => {
        state.lastInteractionTime = performance.now();
    };
    let debugIgniteMode = state.debugIgniteMode;
    const debugToggleButton = phaseUi.controller.root.querySelector('[data-action="debug-ignite-toggle"]');
    const refreshDebugToggle = () => {
        if (debugToggleButton) {
            debugToggleButton.classList.toggle("is-active", debugIgniteMode);
        }
    };
    refreshDebugToggle();
    const igniteDebugFireAt = (tile) => {
        const idx = indexFor(state.grid, tile.x, tile.y);
        const target = state.tiles[idx];
        if (target.fuel <= 0) {
            setStatus(state, "Cannot ignite: no fuel.");
            return;
        }
        const newFire = Math.min(1, 0.65 + rng.next() * 0.3);
        target.fire = newFire;
        target.heat = Math.max(target.heat, target.ignitionPoint * 1.4);
        state.tileFire[idx] = target.fire;
        state.tileHeat[idx] = target.heat;
        markFireBounds(state, tile.x, tile.y);
        state.lastActiveFires = Math.max(state.lastActiveFires, 1);
        setStatus(state, `Debug ignition at ${tile.x}, ${tile.y}`);
    };
    const applyCharacterBudget = () => {
        const baseBudget = getCharacterBaseBudget(state.campaign.characterId, BASE_BUDGET);
        state.budget = baseBudget;
        state.pendingBudget = baseBudget;
    };
    const isOverlayLocked = () => state.overlayVisible;
    const gate = (action, handler) => {
        gateInput(state.phase, getInteractionMode(state), action, handler, (reason) => setStatus(state, reason));
    };
    const toggleDebugIgniteMode = () => {
        gate("select", () => {
            debugIgniteMode = !debugIgniteMode;
            state.debugIgniteMode = debugIgniteMode;
            refreshDebugToggle();
            setStatus(state, debugIgniteMode ? "Debug ignite mode enabled. Click to place a fire." : "Debug ignite mode disabled.");
            noteInteraction();
        });
    };
    const getRosterTargetFromEvent = (event) => {
        const path = typeof event.composedPath === "function" ? event.composedPath() : [];
        for (const entry of path) {
            if (entry instanceof HTMLElement && entry.dataset.rosterId) {
                return entry;
            }
        }
        const target = event.target;
        if (target instanceof Element) {
            return target.closest("[data-roster-id]");
        }
        if (target instanceof Node) {
            return target.parentElement?.closest("[data-roster-id]");
        }
        return null;
    };
    const selectRosterFromEvent = (event) => {
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
    const characterRefs = {
        characterScreen: document.getElementById("characterScreen"),
        characterGrid: document.getElementById("characterGrid"),
        characterSummary: document.getElementById("characterSummary"),
        characterConfirm: document.getElementById("characterConfirm"),
        characterPreviewPortrait: document.getElementById("characterPreviewPortrait"),
        characterPreviewImage: document.getElementById("characterPreviewImage"),
        characterPreviewInitials: document.getElementById("characterPreviewInitials"),
        characterNameInput: document.getElementById("characterNameInput"),
        characterNameRandom: document.getElementById("characterNameRandom")
    };
    const characterSelect = initCharacterSelect(characterRefs, state, (seed) => {
        if (seed !== null) {
            onNewRun(seed);
            return;
        }
        applyCharacterBudget();
    });
    phaseUi.state.on("cta", (actionId) => {
        if (isOverlayLocked()) {
            return;
        }
        if (actionId === "begin-fire") {
            beginFireSeason(state, rng);
        }
        if (actionId === "continue" && state.phase === "budget") {
            advancePhase(state, rng);
        }
    });
    document.addEventListener("click", (event) => {
        selectRosterFromEvent(event);
    }, true);
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
    });
    phaseUi.controller.root.addEventListener("click", (event) => {
        if (isOverlayLocked()) {
            return;
        }
        const target = event.target;
        let elementTarget = null;
        if (target instanceof Element) {
            elementTarget = target;
        }
        else if (target instanceof Node) {
            elementTarget = target.parentElement;
        }
        if (!elementTarget) {
            return;
        }
        const actionTarget = elementTarget.closest("[data-action]");
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
                        phaseUi.sync(state);
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
                gate("zoom", () => zoomAtPointer(state, canvas, state.zoom + ZOOM_STEP, canvas.width / 2, canvas.height / 2));
                return;
            }
            if (action === "zoom-out") {
                gate("zoom", () => zoomAtPointer(state, canvas, state.zoom - ZOOM_STEP, canvas.width / 2, canvas.height / 2));
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
                const select = phaseUi.controller.root.querySelector('[data-role="crew-assign-select"]');
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
            return;
        }
        selectRosterFromEvent(event);
    });
    overlayRefs.overlayRestart.addEventListener("click", () => {
        if (state.overlayAction === "restart") {
            characterSelect.open(Math.floor(Date.now() % 1000000));
            return;
        }
        state.overlayVisible = false;
    });
    const getCanvasPos = (event) => {
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
        const tile = getTileFromPointer(state, canvas, event);
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
                if (event.shiftKey) {
                    toggleUnitSelection(state, clickedUnit);
                }
                else {
                    selectUnit(state, clickedUnit);
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
                panCamera = { x: state.cameraCenter.x, y: state.cameraCenter.y };
            });
            return;
        }
        if (event.button === 2) {
            if (state.selectedUnitIds.length > 0) {
                gate("formation", () => {
                    const tile = getTileFromPointer(state, canvas, event);
                    if (tile) {
                        isFormationDrag = true;
                        rightDragStart = canvasPos;
                        state.formationStart = tile;
                        state.formationEnd = tile;
                    }
                });
            }
            return;
        }
        if (state.deployMode === "clear" && state.phase === "maintenance") {
            gate("clearFuelBreak", () => {
                const tile = getTileFromPointer(state, canvas, event);
                if (!tile) {
                    return;
                }
                state.clearLineStart = tile;
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
            state.selectionBox = { x1: canvasPos.x, y1: canvasPos.y, x2: canvasPos.x, y2: canvasPos.y };
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
                const tile = getTileFromPointer(state, canvas, event);
                const dragDistance = rightDragStart && event
                    ? Math.hypot(canvasPos.x - rightDragStart.x, canvasPos.y - rightDragStart.y)
                    : 0;
                if (tile && dragDistance < 6) {
                    gate("retask", () => handleUnitRetask(state, tile.x, tile.y));
                }
                else {
                    const start = state.formationStart;
                    const end = state.formationEnd;
                    if (start && end) {
                        gate("formation", () => {
                            const selectedUnits = getSelectedUnits(state);
                            assignFormationTargets(state, selectedUnits, start, end);
                        });
                    }
                }
                isFormationDrag = false;
                rightDragStart = null;
                state.formationStart = null;
                state.formationEnd = null;
            }
            else if (state.selectedUnitIds.length > 0) {
                const tile = getTileFromPointer(state, canvas, event);
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
                    const startWorld = screenToWorld(state, canvas, selectStart.x, selectStart.y);
                    const endWorld = screenToWorld(state, canvas, selectEnd.x, selectEnd.y);
                    const minX = Math.min(startWorld.x, endWorld.x);
                    const maxX = Math.max(startWorld.x, endWorld.x);
                    const minY = Math.min(startWorld.y, endWorld.y);
                    const maxY = Math.max(startWorld.y, endWorld.y);
                    if (!event.shiftKey) {
                        clearUnitSelection(state);
                    }
                    state.units.forEach((unit) => {
                        if (unit.x >= minX && unit.x <= maxX && unit.y >= minY && unit.y <= maxY) {
                            unit.selected = true;
                            if (!state.selectedUnitIds.includes(unit.id)) {
                                state.selectedUnitIds.push(unit.id);
                            }
                        }
                    });
                    if (state.selectedUnitIds.length > 0) {
                        setStatus(state, `${state.selectedUnitIds.length} unit(s) selected. Right-click to move.`);
                    }
                    else {
                        resetStatus(state);
                    }
                    suppressClick = true;
                }
                else if (!event.shiftKey) {
                    clearUnitSelection(state);
                }
            }
            isSelecting = false;
            selectStart = null;
            selectEnd = null;
            state.selectionBox = null;
            return;
        }
        if (!state.clearLineStart) {
            return;
        }
        const tile = getTileFromPointer(state, canvas, event);
        if (!tile) {
            state.clearLineStart = null;
            return;
        }
        gate("clearFuelBreak", () => {
            clearFuelLine(state, rng, state.clearLineStart, tile);
            state.clearLineStart = null;
        });
    });
    canvas.addEventListener("mouseleave", () => {
        state.clearLineStart = null;
        isPanning = false;
        panAnchor = null;
        panCamera = null;
        isFormationDrag = false;
        rightDragStart = null;
        state.formationStart = null;
        state.formationEnd = null;
        isSelecting = false;
        selectStart = null;
        selectEnd = null;
        state.selectionBox = null;
    });
    canvas.addEventListener("mousemove", (event) => {
        if (isOverlayLocked()) {
            return;
        }
        if (isPanning || isSelecting || isFormationDrag) {
            noteInteraction();
        }
        if (isFormationDrag) {
            const tile = getTileFromPointer(state, canvas, event);
            if (tile) {
                state.formationEnd = tile;
            }
            return;
        }
        if (isPanning && panAnchor && panCamera) {
            const canvasPos = getCanvasPos(event);
            const dx = canvasPos.x - panAnchor.x;
            const dy = canvasPos.y - panAnchor.y;
            const worldDx = dx / state.zoom;
            const worldDy = dy / state.zoom;
            state.cameraCenter = {
                x: panCamera.x - (worldDy / ISO_TILE_HEIGHT + worldDx / ISO_TILE_WIDTH),
                y: panCamera.y - (worldDy / ISO_TILE_HEIGHT - worldDx / ISO_TILE_WIDTH)
            };
            return;
        }
        if (isSelecting && selectStart) {
            const canvasPos = getCanvasPos(event);
            selectEnd = canvasPos;
            state.selectionBox = {
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
    canvas.addEventListener("wheel", (event) => {
        if (isOverlayLocked()) {
            return;
        }
        if (!isInputAllowed(state.phase, getInteractionMode(state), "zoom").allowed) {
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
        zoomAtPointer(state, canvas, state.zoom * zoomFactor, canvasX, canvasY);
    }, { passive: false });
    document.addEventListener("keydown", (event) => {
        if (event.repeat) {
            return;
        }
        const target = event.target;
        if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
            return;
        }
        if (isOverlayLocked()) {
            return;
        }
        if (event.key === "Escape") {
            handleEscape(state);
        }
        if (event.key === " ") {
            isSpaceDown = true;
        }
        if (event.key === "+" || event.key === "=") {
            gate("zoom", () => zoomAtPointer(state, canvas, state.zoom + ZOOM_STEP, canvas.width / 2, canvas.height / 2));
        }
        if (event.key === "-" || event.key === "_") {
            gate("zoom", () => zoomAtPointer(state, canvas, state.zoom - ZOOM_STEP, canvas.width / 2, canvas.height / 2));
        }
        if (event.key === "t" || event.key === "T") {
            state.renderTrees = !state.renderTrees;
            state.terrainDirty = true;
            setStatus(state, `Tree rendering ${state.renderTrees ? "on" : "off"}.`);
        }
        if (event.key === "e" || event.key === "E") {
            state.renderEffects = !state.renderEffects;
            setStatus(state, `Effects rendering ${state.renderEffects ? "on" : "off"}.`);
        }
    });
    document.addEventListener("keyup", (event) => {
        if (event.key === " ") {
            isSpaceDown = false;
        }
    });
    characterSelect.open(null);
    updateOverlay(overlayRefs, state);
};
