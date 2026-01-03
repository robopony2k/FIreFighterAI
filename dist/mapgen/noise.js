export function hash2D(x, y, seedValue) {
    let h = x * 374761393 + y * 668265263 + seedValue * 1447;
    h = (h ^ (h >>> 13)) >>> 0;
    h = Math.imul(h, 1274126177);
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 4294967296;
}
export function fractalNoise(x, y, seedValue) {
    const n1 = hash2D(x, y, seedValue);
    const n2 = hash2D(Math.floor(x / 3), Math.floor(y / 3), seedValue + 101);
    const n3 = hash2D(Math.floor(x / 7), Math.floor(y / 7), seedValue + 271);
    return n1 * 0.6 + n2 * 0.3 + n3 * 0.1;
}
