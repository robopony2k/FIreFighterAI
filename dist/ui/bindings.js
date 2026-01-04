import { BASE_BUDGET, ZOOM_STEP } from "../core/config.js";
import { inBounds } from "../core/grid.js";
import { zoomAtPointer, screenToWorld } from "../render/iso.js";
import { ISO_TILE_HEIGHT, ISO_TILE_WIDTH } from "../core/config.js";
import { resetStatus, setStatus } from "../core/state.js";
import { beginFireSeason, handleDeployAction, handleEscape, handleUnitDeployment, handleUnitRetask, togglePause } from "../sim/index.js";
import { assignFormationTargets, clearFuelLine, clearUnitSelection, getSelectedUnits, getUnitAt, recruitUnit, selectUnit, setDeployMode, toggleUnitSelection, trainSelectedUnit } from "../sim/units.js";
import { getCharacterBaseBudget } from "../core/characters.js";
import { initCharacterSelect } from "./character-select.js";
function getTileFromPointer(state, canvas, event) {
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
}
export function bindUI(ui, state, rng, canvas, onNewRun) {
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
    const applyCharacterBudget = () => {
        const baseBudget = getCharacterBaseBudget(state.campaign.characterId, BASE_BUDGET);
        state.budget = baseBudget;
        state.pendingBudget = baseBudget;
    };
    const isInputLocked = () => state.phase === "growth" || state.overlayVisible;
    const characterSelect = initCharacterSelect(ui, state, (seed) => {
        if (seed !== null) {
            onNewRun(seed);
            return;
        }
        applyCharacterBudget();
    });
    ui.deployFirefighter.addEventListener("click", () => {
        handleDeployAction(state, "firefighter");
    });
    ui.deployTruck.addEventListener("click", () => {
        handleDeployAction(state, "truck");
    });
    ui.recruitFirefighter.addEventListener("click", () => {
        recruitUnit(state, rng, "firefighter");
    });
    ui.recruitTruck.addEventListener("click", () => {
        recruitUnit(state, rng, "truck");
    });
    ui.trainSpeed.addEventListener("click", () => {
        trainSelectedUnit(state, "speed");
    });
    ui.trainPower.addEventListener("click", () => {
        trainSelectedUnit(state, "power");
    });
    ui.trainRange.addEventListener("click", () => {
        trainSelectedUnit(state, "range");
    });
    ui.trainResilience.addEventListener("click", () => {
        trainSelectedUnit(state, "resilience");
    });
    ui.deployClear.addEventListener("click", () => {
        handleDeployAction(state, "clear");
    });
    ui.beginFireSeason.addEventListener("click", () => {
        beginFireSeason(state, rng);
    });
    ui.newRunBtn.addEventListener("click", () => {
        characterSelect.open(Math.floor(Date.now() % 1000000));
    });
    ui.pauseBtn.addEventListener("click", () => {
        togglePause(state);
        ui.pauseBtn.textContent = state.paused ? "Resume" : "Pause";
    });
    ui.zoomOutBtn.addEventListener("click", () => {
        zoomAtPointer(state, canvas, state.zoom - ZOOM_STEP, canvas.width / 2, canvas.height / 2);
    });
    ui.zoomInBtn.addEventListener("click", () => {
        zoomAtPointer(state, canvas, state.zoom + ZOOM_STEP, canvas.width / 2, canvas.height / 2);
    });
    ui.overlayRestart.addEventListener("click", () => {
        if (state.overlayAction === "restart") {
            characterSelect.open(Math.floor(Date.now() % 1000000));
            return;
        }
        state.overlayVisible = false;
    });
    ui.rosterList.addEventListener("click", (event) => {
        const target = event.target;
        const item = target.closest(".roster-item");
        if (!item || !item.dataset.id) {
            return;
        }
        state.selectedRosterId = Number(item.dataset.id);
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
        if (isInputLocked()) {
            return;
        }
        if (suppressClick) {
            suppressClick = false;
            return;
        }
        if (state.deployMode === "clear") {
            return;
        }
        const tile = getTileFromPointer(state, canvas, event);
        if (!tile) {
            return;
        }
        const clickedUnit = getUnitAt(state, tile.x, tile.y);
        if (clickedUnit) {
            if (event.shiftKey) {
                toggleUnitSelection(state, clickedUnit);
            }
            else {
                selectUnit(state, clickedUnit);
            }
            setDeployMode(state, null);
            return;
        }
        if (state.deployMode) {
            handleUnitDeployment(state, rng, tile.x, tile.y);
            return;
        }
        if (!event.shiftKey) {
            clearUnitSelection(state);
        }
        setStatus(state, "Select a unit or choose a deployment.");
    });
    canvas.addEventListener("mousedown", (event) => {
        if (isInputLocked()) {
            return;
        }
        const canvasPos = getCanvasPos(event);
        if (event.button === 1 || (event.button === 0 && isSpaceDown)) {
            isPanning = true;
            panAnchor = canvasPos;
            panCamera = { x: state.cameraCenter.x, y: state.cameraCenter.y };
            return;
        }
        if (event.button === 2) {
            if (state.phase === "fire" && state.selectedUnitIds.length > 0) {
                const tile = getTileFromPointer(state, canvas, event);
                if (tile) {
                    isFormationDrag = true;
                    rightDragStart = canvasPos;
                    state.formationStart = tile;
                    state.formationEnd = tile;
                }
            }
            return;
        }
        if (state.deployMode === "clear" && state.phase === "maintenance") {
            const tile = getTileFromPointer(state, canvas, event);
            if (!tile) {
                return;
            }
            state.clearLineStart = tile;
            return;
        }
        if (event.button !== 0) {
            return;
        }
        isSelecting = true;
        selectStart = canvasPos;
        selectEnd = canvasPos;
        state.selectionBox = { x1: canvasPos.x, y1: canvasPos.y, x2: canvasPos.x, y2: canvasPos.y };
    });
    canvas.addEventListener("mouseup", (event) => {
        if (isInputLocked()) {
            return;
        }
        const canvasPos = getCanvasPos(event);
        if (event.button === 2) {
            if (isFormationDrag) {
                const tile = getTileFromPointer(state, canvas, event);
                const dragDistance = rightDragStart && event
                    ? Math.hypot(canvasPos.x - rightDragStart.x, canvasPos.y - rightDragStart.y)
                    : 0;
                if (tile && dragDistance < 6) {
                    handleUnitRetask(state, tile.x, tile.y);
                }
                else if (state.formationStart && state.formationEnd) {
                    const selectedUnits = getSelectedUnits(state);
                    assignFormationTargets(state, selectedUnits, state.formationStart, state.formationEnd);
                }
                isFormationDrag = false;
                rightDragStart = null;
                state.formationStart = null;
                state.formationEnd = null;
            }
            else if (state.selectedUnitIds.length > 0) {
                const tile = getTileFromPointer(state, canvas, event);
                if (tile) {
                    handleUnitRetask(state, tile.x, tile.y);
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
        clearFuelLine(state, rng, state.clearLineStart, tile);
        state.clearLineStart = null;
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
        if (isInputLocked()) {
            return;
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
        if (isInputLocked()) {
            return;
        }
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
        if (isInputLocked()) {
            return;
        }
        if (event.key === "Escape") {
            handleEscape(state);
        }
        if (event.key === " ") {
            isSpaceDown = true;
        }
        if (event.key === "+" || event.key === "=") {
            zoomAtPointer(state, canvas, state.zoom + ZOOM_STEP, canvas.width / 2, canvas.height / 2);
        }
        if (event.key === "-" || event.key === "_") {
            zoomAtPointer(state, canvas, state.zoom - ZOOM_STEP, canvas.width / 2, canvas.height / 2);
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
}
