export function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
export function formatCurrency(value) {
    return `$${Math.max(0, Math.floor(value)).toLocaleString()}`;
}
