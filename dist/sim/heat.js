import { NEIGHBOR_DIRS } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { inBounds, indexFor } from "../core/grid.js";
export function stepHeat(state, delta, spreadScale) {
    state.heatBuffer.fill(0);
    const heatDelta = delta * spreadScale;
    const diffusion = clamp(delta * (0.6 + spreadScale * 0.05), 0.08, 0.45);
    const cooling = clamp(1 - heatDelta * 0.2, 0.7, 0.98);
    const windBias = 0.35 + spreadScale * 0.12;
    for (let y = 0; y < state.grid.rows; y += 1) {
        for (let x = 0; x < state.grid.cols; x += 1) {
            const idx = indexFor(state.grid, x, y);
            const tile = state.tiles[idx];
            let heat = tile.heat;
            const baseHeat = tile.fire * tile.heatOutput;
            heat = heat * cooling + baseHeat * heatDelta * 3.2;
            if (heat < 0.005) {
                heat = 0;
            }
            const share = heat * diffusion;
            state.heatBuffer[idx] += heat - share;
            if (share <= 0) {
                continue;
            }
            let weightSum = 0;
            for (const dir of NEIGHBOR_DIRS) {
                const nx = x + dir.x;
                const ny = y + dir.y;
                if (!inBounds(state.grid, nx, ny)) {
                    continue;
                }
                const nIdx = indexFor(state.grid, nx, ny);
                const slope = state.tiles[nIdx].elevation - tile.elevation;
                const slopeWeight = slope >= 0 ? 1 + slope * 1.4 : 1 + slope * 0.6;
                const dot = dir.x * state.wind.dx + dir.y * state.wind.dy;
                const windWeight = 1 + dot * state.wind.strength * windBias;
                const weight = clamp(slopeWeight * windWeight, 0.2, 2.4);
                weightSum += weight;
            }
            if (weightSum <= 0) {
                continue;
            }
            for (const dir of NEIGHBOR_DIRS) {
                const nx = x + dir.x;
                const ny = y + dir.y;
                if (!inBounds(state.grid, nx, ny)) {
                    continue;
                }
                const nIdx = indexFor(state.grid, nx, ny);
                const slope = state.tiles[nIdx].elevation - tile.elevation;
                const slopeWeight = slope >= 0 ? 1 + slope * 1.4 : 1 + slope * 0.6;
                const dot = dir.x * state.wind.dx + dir.y * state.wind.dy;
                const windWeight = 1 + dot * state.wind.strength * windBias;
                const weight = clamp(slopeWeight * windWeight, 0.2, 2.4);
                state.heatBuffer[nIdx] += (share * weight) / weightSum;
            }
        }
    }
    for (let i = 0; i < state.tiles.length; i += 1) {
        const tile = state.tiles[i];
        const retention = tile.type === "water" ? 0.4 : tile.type === "ash" ? 0.55 : 1;
        tile.heat = Math.min(5, state.heatBuffer[i] * retention);
    }
}
