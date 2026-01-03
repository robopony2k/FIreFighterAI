export function emitWaterSpray(state, rng, unit, target) {
    const count = unit.kind === "truck" ? 8 : 5;
    const baseSpeed = unit.kind === "truck" ? 8 : 6;
    const spread = unit.kind === "truck" ? 0.55 : 0.7;
    let baseAngle = rng.next() * Math.PI * 2;
    if (target) {
        baseAngle = Math.atan2(target.y - unit.y, target.x - unit.x);
    }
    for (let i = 0; i < count; i += 1) {
        const jitter = (rng.next() - 0.5) * spread;
        const speed = baseSpeed * (0.7 + rng.next() * 0.6);
        state.waterParticles.push({
            x: unit.x,
            y: unit.y,
            vx: Math.cos(baseAngle + jitter) * speed,
            vy: Math.sin(baseAngle + jitter) * speed,
            life: 0.5 + rng.next() * 0.25,
            maxLife: 0.75,
            size: 1.6 + rng.next() * 1.4,
            alpha: 1
        });
    }
}
export function emitSmokeAt(state, rng, x, y) {
    const count = rng.next() < 0.35 ? 2 : 1;
    const baseSpeed = 0.8 + state.wind.strength * 1.2;
    for (let i = 0; i < count; i += 1) {
        const jitter = (rng.next() - 0.5) * 0.6;
        const speed = baseSpeed * (0.6 + rng.next() * 0.8);
        const angle = Math.atan2(state.wind.dy, state.wind.dx) + jitter;
        state.smokeParticles.push({
            x: x + (rng.next() - 0.5) * 0.3,
            y: y + (rng.next() - 0.5) * 0.3,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1.8 + rng.next() * 1.4,
            maxLife: 2.6,
            size: 2.2 + rng.next() * 2.6,
            alpha: 0.8
        });
    }
}
export function stepParticles(state, delta) {
    state.waterParticles = state.waterParticles.filter((particle) => {
        particle.life -= delta;
        if (particle.life <= 0) {
            return false;
        }
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.vx *= 0.96;
        particle.vy *= 0.96;
        particle.alpha = particle.life / particle.maxLife;
        return true;
    });
    state.smokeParticles = state.smokeParticles.filter((particle) => {
        particle.life -= delta;
        if (particle.life <= 0) {
            return false;
        }
        particle.x += particle.vx * delta;
        particle.y += particle.vy * delta;
        particle.vx += state.wind.dx * 0.05 * delta;
        particle.vy += state.wind.dy * 0.05 * delta;
        particle.alpha = particle.life / particle.maxLife;
        return true;
    });
}
