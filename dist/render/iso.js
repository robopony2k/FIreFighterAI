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
    if (!tile) {
        return 0;
    }
    return tile.elevation * HEIGHT_SCALE - (tile.type === "water" ? HEIGHT_WATER_DROP : 0);
}
const sampleVertexHeight = (state, vx, vy) => {
    let sum = 0;
    let count = 0;
    const add = (tx, ty) => {
        if (!inBounds(state.grid, tx, ty)) {
            return;
        }
        sum += getTileHeight(state.tiles[indexFor(state.grid, tx, ty)]);
        count += 1;
    };
    add(vx - 1, vy - 1);
    add(vx, vy - 1);
    add(vx - 1, vy);
    add(vx, vy);
    return count > 0 ? sum / count : 0;
};
export function getHeightAt(state, wx, wy) {
    if (state.tiles.length === 0) {
        return 0;
    }
    const { cols, rows } = state.grid;
    if (wx < 0 || wy < 0 || wx > cols || wy > rows) {
        return 0;
    }
    const x0 = Math.min(cols - 1, Math.floor(wx));
    const y0 = Math.min(rows - 1, Math.floor(wy));
    const fx = clamp(wx - x0, 0, 1);
    const fy = clamp(wy - y0, 0, 1);
    const h00 = sampleVertexHeight(state, x0, y0);
    const h10 = sampleVertexHeight(state, x0 + 1, y0);
    const h01 = sampleVertexHeight(state, x0, y0 + 1);
    const h11 = sampleVertexHeight(state, x0 + 1, y0 + 1);
    const hx0 = h00 + (h10 - h00) * fx;
    const hx1 = h01 + (h11 - h01) * fx;
    return hx0 + (hx1 - hx0) * fy;
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
