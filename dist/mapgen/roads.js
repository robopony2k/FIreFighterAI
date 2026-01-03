import { inBounds, indexFor } from "../core/grid.js";
import { applyFuel } from "../core/tiles.js";
export function setRoadAt(state, rng, x, y) {
    if (!inBounds(state.grid, x, y)) {
        return;
    }
    const tile = state.tiles[indexFor(state.grid, x, y)];
    if (tile.type === "water" || tile.type === "house" || tile.type === "base") {
        return;
    }
    tile.type = "road";
    tile.canopy = 0;
    tile.ashAge = 0;
    applyFuel(tile, tile.moisture, rng);
}
export function canRoadTraverse(state, x, y, start, end) {
    if (!inBounds(state.grid, x, y)) {
        return false;
    }
    if ((x === start.x && y === start.y) || (x === end.x && y === end.y)) {
        return state.tiles[indexFor(state.grid, x, y)].type !== "water";
    }
    const type = state.tiles[indexFor(state.grid, x, y)].type;
    return type !== "water" && type !== "house";
}
export function findRoadPath(state, start, end) {
    if (!inBounds(state.grid, start.x, start.y) || !inBounds(state.grid, end.x, end.y)) {
        return [];
    }
    if (state.tiles[indexFor(state.grid, start.x, start.y)].type === "water" || state.tiles[indexFor(state.grid, end.x, end.y)].type === "water") {
        return [];
    }
    const startIdx = indexFor(state.grid, start.x, start.y);
    const endIdx = indexFor(state.grid, end.x, end.y);
    if (startIdx === endIdx) {
        return [start];
    }
    const prev = new Int32Array(state.grid.totalTiles);
    prev.fill(-1);
    const queueX = new Int16Array(state.grid.totalTiles);
    const queueY = new Int16Array(state.grid.totalTiles);
    let head = 0;
    let tail = 0;
    queueX[tail] = start.x;
    queueY[tail] = start.y;
    tail += 1;
    prev[startIdx] = startIdx;
    while (head < tail) {
        const x = queueX[head];
        const y = queueY[head];
        head += 1;
        if (x === end.x && y === end.y) {
            break;
        }
        const neighbors = [
            { x: x + 1, y },
            { x: x - 1, y },
            { x, y: y + 1 },
            { x, y: y - 1 }
        ];
        for (const next of neighbors) {
            if (!canRoadTraverse(state, next.x, next.y, start, end)) {
                continue;
            }
            const idx = indexFor(state.grid, next.x, next.y);
            if (prev[idx] !== -1) {
                continue;
            }
            prev[idx] = indexFor(state.grid, x, y);
            queueX[tail] = next.x;
            queueY[tail] = next.y;
            tail += 1;
        }
    }
    if (prev[endIdx] === -1) {
        return [];
    }
    const path = [];
    let current = endIdx;
    while (current !== startIdx) {
        const px = current % state.grid.cols;
        const py = Math.floor(current / state.grid.cols);
        path.push({ x: px, y: py });
        current = prev[current];
    }
    path.push(start);
    path.reverse();
    return path;
}
export function carveRoad(state, rng, start, end) {
    const path = findRoadPath(state, start, end);
    if (path.length === 0) {
        return false;
    }
    path.forEach((point) => setRoadAt(state, rng, point.x, point.y));
    return true;
}
export function collectRoadTiles(state) {
    const roads = [];
    for (let y = 0; y < state.grid.rows; y += 1) {
        for (let x = 0; x < state.grid.cols; x += 1) {
            const type = state.tiles[indexFor(state.grid, x, y)].type;
            if (type === "road" || type === "base") {
                roads.push({ x, y });
            }
        }
    }
    return roads;
}
export function findNearestRoadTile(state, origin) {
    let best = state.basePoint;
    let bestDist = Math.abs(origin.x - state.basePoint.x) + Math.abs(origin.y - state.basePoint.y);
    for (let y = 0; y < state.grid.rows; y += 1) {
        for (let x = 0; x < state.grid.cols; x += 1) {
            const type = state.tiles[indexFor(state.grid, x, y)].type;
            if (type !== "road" && type !== "base") {
                continue;
            }
            const dist = Math.abs(origin.x - x) + Math.abs(origin.y - y);
            if (dist < bestDist) {
                bestDist = dist;
                best = { x, y };
            }
        }
    }
    return best;
}
