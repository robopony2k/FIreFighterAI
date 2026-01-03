import { ZOOM_STEP } from "../core/config.js";
import { inBounds } from "../core/grid.js";
import { zoomAtPointer, screenToWorld } from "../render/iso.js";
import { setStatus } from "../core/state.js";
import { beginFireSeason, handleDeployAction, handleEscape, handleUnitDeployment, handleUnitRetask, togglePause } from "../sim/index.js";
import { clearFuelLine, getUnitAt, selectUnit, setDeployMode } from "../sim/units.js";
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
    ui.deployFirefighter.addEventListener("click", () => {
        handleDeployAction(state, "firefighter");
    });
    ui.deployTruck.addEventListener("click", () => {
        handleDeployAction(state, "truck");
    });
    ui.deployClear.addEventListener("click", () => {
        handleDeployAction(state, "clear");
    });
    ui.beginFireSeason.addEventListener("click", () => {
        beginFireSeason(state, rng);
    });
    ui.newRunBtn.addEventListener("click", () => {
        onNewRun(Math.floor(Date.now() % 1000000));
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
        onNewRun(Math.floor(Date.now() % 1000000));
    });
    canvas.addEventListener("click", (event) => {
        if (state.deployMode === "clear") {
            return;
        }
        const tile = getTileFromPointer(state, canvas, event);
        if (!tile) {
            return;
        }
        const clickedUnit = getUnitAt(state, tile.x, tile.y);
        if (clickedUnit) {
            selectUnit(state, clickedUnit);
            setDeployMode(state, null);
            return;
        }
        if (state.deployMode && state.selectedUnitId === null) {
            handleUnitDeployment(state, rng, tile.x, tile.y);
            return;
        }
        if (state.selectedUnitId !== null) {
            handleUnitRetask(state, tile.x, tile.y);
            return;
        }
        setStatus(state, "Select a unit or choose a deployment.");
    });
    canvas.addEventListener("mousedown", (event) => {
        if (state.deployMode !== "clear" || state.phase !== "maintenance") {
            return;
        }
        if (event.button !== 0) {
            return;
        }
        const tile = getTileFromPointer(state, canvas, event);
        if (!tile) {
            return;
        }
        state.clearLineStart = tile;
    });
    canvas.addEventListener("mouseup", (event) => {
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
    });
    canvas.addEventListener("wheel", (event) => {
        event.preventDefault();
        const direction = Math.sign(event.deltaY);
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const canvasX = (event.clientX - rect.left) * scaleX;
        const canvasY = (event.clientY - rect.top) * scaleY;
        zoomAtPointer(state, canvas, state.zoom - direction * ZOOM_STEP, canvasX, canvasY);
    }, { passive: false });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            handleEscape(state);
        }
        if (event.key === "+" || event.key === "=") {
            zoomAtPointer(state, canvas, state.zoom + ZOOM_STEP, canvas.width / 2, canvas.height / 2);
        }
        if (event.key === "-" || event.key === "_") {
            zoomAtPointer(state, canvas, state.zoom - ZOOM_STEP, canvas.width / 2, canvas.height / 2);
        }
    });
}
