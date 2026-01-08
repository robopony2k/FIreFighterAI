export function indexFor(grid, x, y) {
    return y * grid.cols + x;
}
export function inBounds(grid, x, y) {
    return x >= 0 && x < grid.cols && y >= 0 && y < grid.rows;
}
export function buildNeighborOffsets(cols, mode) {
    if (mode === 4) {
        return new Int32Array([1, -1, cols, -cols]);
    }
    return new Int32Array([1, -1, cols, -cols, cols + 1, -(cols + 1), -(cols - 1), cols - 1]);
}
