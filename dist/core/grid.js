export function indexFor(grid, x, y) {
    return y * grid.cols + x;
}
export function inBounds(grid, x, y) {
    return x >= 0 && x < grid.cols && y >= 0 && y < grid.rows;
}
