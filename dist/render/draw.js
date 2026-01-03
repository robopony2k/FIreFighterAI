import { FIRE_COLORS, LIGHT_DIR, TILE_COLORS, TILE_COLOR_RGB, TILE_SIZE, UNIT_CONFIG, WATER_PARTICLE_COLOR, WET_TINT, DRY_TINT, ELEVATION_TINT_HIGH, ELEVATION_TINT_LOW } from "../core/config.js";
import { clamp } from "../core/utils.js";
import { inBounds, indexFor } from "../core/grid.js";
import { hash2D } from "../mapgen/noise.js";
import { getHeightAt, getTileHeight, getViewTransform, isoProject } from "./iso.js";
const rgbString = (color) => `rgb(${Math.round(color.r)}, ${Math.round(color.g)}, ${Math.round(color.b)})`;
const mixRgb = (a, b, t) => ({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
});
const scaleRgb = (color, factor) => ({
    r: clamp(color.r * factor, 0, 255),
    g: clamp(color.g * factor, 0, 255),
    b: clamp(color.b * factor, 0, 255)
});
const shadeTileColor = (state, tile, x, y) => {
    const base = tile.type === "grass" || tile.type === "forest"
        ? mixRgb(TILE_COLOR_RGB.grass, TILE_COLOR_RGB.forest, clamp(tile.canopy, 0, 1))
        : TILE_COLOR_RGB[tile.type];
    const elev = tile.elevation;
    const left = inBounds(state.grid, x - 1, y) ? state.tiles[indexFor(state.grid, x - 1, y)].elevation : elev;
    const right = inBounds(state.grid, x + 1, y) ? state.tiles[indexFor(state.grid, x + 1, y)].elevation : elev;
    const up = inBounds(state.grid, x, y - 1) ? state.tiles[indexFor(state.grid, x, y - 1)].elevation : elev;
    const down = inBounds(state.grid, x, y + 1) ? state.tiles[indexFor(state.grid, x, y + 1)].elevation : elev;
    const dx = right - left;
    const dy = down - up;
    const slope = dx * LIGHT_DIR.x + dy * LIGHT_DIR.y;
    const avg = (left + right + up + down) * 0.25;
    const relief = clamp((elev - avg) * 1.6, -0.22, 0.22);
    const heightBoost = 0.88 + elev * 0.28;
    const shade = clamp(heightBoost * (0.92 + slope * 1.6) * (1 + relief), 0.55, 1.22);
    const tintAmount = tile.type === "water" ? 0.05 : 0.12 + elev * 0.25;
    const tint = {
        r: ELEVATION_TINT_LOW.r + (ELEVATION_TINT_HIGH.r - ELEVATION_TINT_LOW.r) * elev,
        g: ELEVATION_TINT_LOW.g + (ELEVATION_TINT_HIGH.g - ELEVATION_TINT_LOW.g) * elev,
        b: ELEVATION_TINT_LOW.b + (ELEVATION_TINT_HIGH.b - ELEVATION_TINT_LOW.b) * elev
    };
    let mixed = mixRgb(base, tint, tintAmount);
    if (tile.type === "grass" || tile.type === "forest") {
        const moistureTint = mixRgb(DRY_TINT, WET_TINT, clamp(tile.moisture, 0, 1));
        const moistureAmount = 0.12 + tile.moisture * 0.18;
        mixed = mixRgb(mixed, moistureTint, moistureAmount);
    }
    const noise = state.colorNoiseMap[indexFor(state.grid, x, y)];
    const noiseShift = (noise - 0.5) * 0.12;
    const noiseShade = 1 + noiseShift;
    return {
        r: clamp(mixed.r * shade * noiseShade, 0, 255),
        g: clamp(mixed.g * shade * noiseShade, 0, 255),
        b: clamp(mixed.b * shade * noiseShade, 0, 255)
    };
};
const tileSeed = (state, x, y, offset) => hash2D(x + offset * 31, y + offset * 57, state.seed + offset * 131);
const drawTreeAt = (context, wx, wy, baseHeight, size, canopyColor) => {
    const base = isoProject(wx, wy, baseHeight);
    const trunkTop = isoProject(wx, wy, baseHeight + size * 0.55);
    const top = isoProject(wx, wy, baseHeight + size * 1.6);
    context.fillStyle = "rgba(73, 54, 38, 0.85)";
    context.beginPath();
    context.moveTo(base.x - size * 0.08, base.y);
    context.lineTo(base.x + size * 0.08, base.y);
    context.lineTo(trunkTop.x + size * 0.08, trunkTop.y);
    context.lineTo(trunkTop.x - size * 0.08, trunkTop.y);
    context.closePath();
    context.fill();
    context.fillStyle = canopyColor;
    context.beginPath();
    context.moveTo(top.x, top.y);
    context.lineTo(base.x + size * 0.36, base.y - size * 0.18);
    context.lineTo(base.x - size * 0.36, base.y - size * 0.18);
    context.closePath();
    context.fill();
};
const drawTreesOnTile = (state, context, tile, x, y, height) => {
    if (tile.type !== "grass" && tile.type !== "forest") {
        return;
    }
    const canopy = clamp(tile.canopy, 0, 1);
    if (tile.type === "grass" && canopy < 0.25) {
        return;
    }
    const density = tile.type === "forest" ? 0.55 + canopy * 0.35 : canopy * 0.4;
    if (tileSeed(state, x, y, 1) > density) {
        return;
    }
    const baseColor = tile.type === "forest" ? TILE_COLOR_RGB.forest : TILE_COLOR_RGB.grass;
    const count = tile.type === "forest"
        ? 2 + Math.floor(tileSeed(state, x, y, 2) * (1 + canopy * 2))
        : tileSeed(state, x, y, 3) > 0.45
            ? 1
            : 0;
    const baseSize = TILE_SIZE * (tile.type === "forest" ? 0.9 : 0.65);
    for (let i = 0; i < count; i += 1) {
        const jitterX = (tileSeed(state, x, y, 10 + i) - 0.5) * 0.45;
        const jitterY = (tileSeed(state, x, y, 20 + i) - 0.5) * 0.45;
        const shade = 0.78 + tileSeed(state, x, y, 30 + i) * 0.35;
        const size = baseSize * (0.85 + canopy * 0.4 + tileSeed(state, x, y, 40 + i) * 0.2);
        const canopyColor = rgbString(scaleRgb(baseColor, shade));
        drawTreeAt(context, x + 0.5 + jitterX, y + 0.5 + jitterY, height + TILE_SIZE * 0.05, size, canopyColor);
    }
};
export function draw(state, canvas, ctx) {
    const view = getViewTransform(state, canvas);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(view.scale, 0, 0, view.scale, view.offsetX, view.offsetY);
    for (let sum = 0; sum <= state.grid.cols + state.grid.rows - 2; sum += 1) {
        for (let x = 0; x < state.grid.cols; x += 1) {
            const y = sum - x;
            if (y < 0 || y >= state.grid.rows) {
                continue;
            }
            const tile = state.tiles[indexFor(state.grid, x, y)];
            const height = getTileHeight(tile);
            const top = shadeTileColor(state, tile, x, y);
            const east = scaleRgb(top, 0.82);
            const south = scaleRgb(top, 0.68);
            const p0 = isoProject(x, y, height);
            const p1 = isoProject(x + 1, y, height);
            const p2 = isoProject(x + 1, y + 1, height);
            const p3 = isoProject(x, y + 1, height);
            const eastNeighborHeight = inBounds(state.grid, x + 1, y)
                ? getTileHeight(state.tiles[indexFor(state.grid, x + 1, y)])
                : 0;
            if (eastNeighborHeight < height - 0.1) {
                const low1 = isoProject(x + 1, y, eastNeighborHeight);
                const low2 = isoProject(x + 1, y + 1, eastNeighborHeight);
                ctx.fillStyle = rgbString(east);
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.lineTo(low2.x, low2.y);
                ctx.lineTo(low1.x, low1.y);
                ctx.closePath();
                ctx.fill();
            }
            const southNeighborHeight = inBounds(state.grid, x, y + 1)
                ? getTileHeight(state.tiles[indexFor(state.grid, x, y + 1)])
                : 0;
            if (southNeighborHeight < height - 0.1) {
                const low1 = isoProject(x, y + 1, southNeighborHeight);
                const low2 = isoProject(x + 1, y + 1, southNeighborHeight);
                ctx.fillStyle = rgbString(south);
                ctx.beginPath();
                ctx.moveTo(p3.x, p3.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.lineTo(low2.x, low2.y);
                ctx.lineTo(low1.x, low1.y);
                ctx.closePath();
                ctx.fill();
            }
            ctx.fillStyle = rgbString(top);
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(p1.x, p1.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.lineTo(p3.x, p3.y);
            ctx.closePath();
            ctx.fill();
            drawTreesOnTile(state, ctx, tile, x, y, height);
            if (tile.type === "house") {
                const roof = isoProject(x + 0.5, y + 0.5, height + TILE_SIZE * 0.35);
                ctx.fillStyle = TILE_COLORS.house;
                ctx.beginPath();
                ctx.moveTo(roof.x, roof.y - TILE_SIZE * 0.28);
                ctx.lineTo(roof.x + TILE_SIZE * 0.32, roof.y);
                ctx.lineTo(roof.x, roof.y + TILE_SIZE * 0.28);
                ctx.lineTo(roof.x - TILE_SIZE * 0.32, roof.y);
                ctx.closePath();
                ctx.fill();
            }
            if (tile.fire > 0) {
                const intensity = clamp(tile.fire, 0.2, 1);
                const colorIndex = Math.min(FIRE_COLORS.length - 1, Math.floor(intensity * FIRE_COLORS.length));
                const center = isoProject(x + 0.5, y + 0.5, height + TILE_SIZE * 0.4);
                ctx.fillStyle = FIRE_COLORS[colorIndex];
                ctx.globalAlpha = 0.6 + intensity * 0.3;
                ctx.beginPath();
                ctx.arc(center.x, center.y, TILE_SIZE * (0.3 + intensity * 0.35), 0, Math.PI * 2);
                ctx.fill();
                ctx.globalAlpha = 1;
            }
        }
    }
    state.units.forEach((unit) => {
        const baseHeight = getHeightAt(state, unit.x, unit.y);
        const ground = isoProject(unit.x, unit.y, baseHeight);
        const head = isoProject(unit.x, unit.y, baseHeight + TILE_SIZE * 1.2);
        ctx.fillStyle = "rgba(0, 0, 0, 0.25)";
        ctx.beginPath();
        ctx.ellipse(ground.x, ground.y + TILE_SIZE * 0.2, TILE_SIZE * 0.35, TILE_SIZE * 0.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = UNIT_CONFIG[unit.kind].color;
        ctx.beginPath();
        ctx.arc(head.x, head.y, TILE_SIZE * 0.32, 0, Math.PI * 2);
        ctx.fill();
        if (unit.selected) {
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    });
    state.smokeParticles.forEach((particle) => {
        const baseHeight = getHeightAt(state, particle.x, particle.y);
        const rise = (1 - particle.alpha) * TILE_SIZE * 5;
        const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 2 + rise);
        const alpha = clamp(particle.alpha * 0.6, 0, 0.6);
        ctx.fillStyle = `rgba(70, 70, 70, ${alpha})`;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, particle.size * 0.5, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.fillStyle = WATER_PARTICLE_COLOR;
    state.waterParticles.forEach((particle) => {
        const baseHeight = getHeightAt(state, particle.x, particle.y);
        const pos = isoProject(particle.x, particle.y, baseHeight + TILE_SIZE * 0.5);
        ctx.globalAlpha = clamp(particle.alpha, 0, 1);
        ctx.fillRect(pos.x - particle.size / 2, pos.y - particle.size / 2, particle.size, particle.size);
    });
    ctx.globalAlpha = 1;
}
