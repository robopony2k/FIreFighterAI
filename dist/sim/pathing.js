import { inBounds, indexFor } from "../core/grid.js";
export function isPassable(state, x, y) {
    if (!inBounds(state.grid, x, y)) {
        return false;
    }
    const type = state.tiles[indexFor(state.grid, x, y)].type;
    return type !== "water";
}
export function findPath(state, start, goal) {
    if (!inBounds(state.grid, goal.x, goal.y) || !isPassable(state, goal.x, goal.y)) {
        return [];
    }
    const startIdx = indexFor(state.grid, start.x, start.y);
    const goalIdx = indexFor(state.grid, goal.x, goal.y);
    if (startIdx === goalIdx) {
        return [];
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
        if (x === goal.x && y === goal.y) {
            break;
        }
        const neighbors = [
            { x: x + 1, y },
            { x: x - 1, y },
            { x, y: y + 1 },
            { x, y: y - 1 }
        ];
        for (const next of neighbors) {
            if (!inBounds(state.grid, next.x, next.y) || !isPassable(state, next.x, next.y)) {
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
    if (prev[goalIdx] === -1) {
        return [];
    }
    const path = [];
    let current = goalIdx;
    while (current !== startIdx) {
        const px = current % state.grid.cols;
        const py = Math.floor(current / state.grid.cols);
        path.push({ x: px, y: py });
        current = prev[current];
    }
    path.reverse();
    return path;
}
