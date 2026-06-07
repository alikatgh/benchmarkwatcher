// Shared number formatting for change values, so the UI never shows raw
// floating-point noise (e.g. "+0.09699999999999998"). Mirrors the web app,
// which rounds change values for display.

function round(value: number | string | null | undefined, decimals: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return parseFloat(n.toFixed(decimals));
}

/** Absolute change, rounded to <=4 decimals with trailing zeros dropped. */
export function formatChange(value: number | string | null | undefined): string {
  return String(round(value, 4));
}

/** Percent change, rounded to 2 decimals with trailing zeros dropped. */
export function formatPercent(value: number | string | null | undefined): string {
  return String(round(value, 2));
}
