import { HEIGHT_SCALE, HEIGHT_WATER_DROP, ISO_TILE_HEIGHT, ISO_TILE_WIDTH, ZOOM_MAX, ZOOM_MIN } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { inBounds, indexFor } from "../core/grid.js";
export function isoProject(wx, wy, height) {
    return {
        x: (wx - wy) * (ISO_TILE_WIDTH * 0.5),
        y: (wx + wy) * (ISO_TILE_HEIGHT * 0.5) - height
    };
}
export function getTileHeight(tile) {
    return tile.elevation * HEIGHT_SCALE - (tile.type === "water" ? HEIGHT_WATER_DROP : 0);
}
export function getHeightAt(state, wx, wy) {
    const x = Math.floor(wx);
    const y = Math.floor(wy);
    if (!inBounds(state.grid, x, y)) {
        return 0;
    }
    return getTileHeight(state.tiles[indexFor(state.grid, x, y)]);
}
export function getViewTransform(state, canvas) {
    const scale = state.zoom;
    const centerHeight = getHeightAt(state, state.cameraCenter.x, state.cameraCenter.y);
    const center = isoProject(state.cameraCenter.x, state.cameraCenter.y, centerHeight);
    const offsetX = canvas.width / 2 - center.x * scale;
    const offsetY = canvas.height / 2 - center.y * scale;
    return { scale, offsetX, offsetY };
}
export function screenToWorld(state, canvas, screenX, screenY) {
    const view = getViewTransform(state, canvas);
    const worldX = (screenX - view.offsetX) / view.scale;
    const worldY = (screenY - view.offsetY) / view.scale;
    const isoX = worldX / (ISO_TILE_WIDTH * 0.5);
    let isoY = worldY / (ISO_TILE_HEIGHT * 0.5);
    let wx = (isoY + isoX) / 2;
    let wy = (isoY - isoX) / 2;
    for (let i = 0; i < 2; i += 1) {
        const height = getHeightAt(state, wx, wy);
        isoY = (worldY + height) / (ISO_TILE_HEIGHT * 0.5);
        const nextWx = (isoY + isoX) / 2;
        const nextWy = (isoY - isoX) / 2;
        if (Math.floor(nextWx) === Math.floor(wx) && Math.floor(nextWy) === Math.floor(wy)) {
            wx = nextWx;
            wy = nextWy;
            break;
        }
        wx = nextWx;
        wy = nextWy;
    }
    return { x: wx, y: wy };
}
export function zoomAtPointer(state, canvas, targetZoom, screenX, screenY) {
    const nextZoom = clamp(targetZoom, ZOOM_MIN, ZOOM_MAX);
    const before = screenToWorld(state, canvas, screenX, screenY);
    const prevZoom = state.zoom;
    state.zoom = nextZoom;
    const ratio = prevZoom / state.zoom;
    state.cameraCenter = {
        x: before.x + (state.cameraCenter.x - before.x) * ratio,
        y: before.y + (state.cameraCenter.y - before.y) * ratio
    };
}
export function setZoom(state, next) {
    state.zoom = clamp(next, ZOOM_MIN, ZOOM_MAX);
}
