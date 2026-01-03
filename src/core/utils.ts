export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function formatCurrency(value: number): string {
  return `$${Math.max(0, Math.floor(value)).toLocaleString()}`;
}
