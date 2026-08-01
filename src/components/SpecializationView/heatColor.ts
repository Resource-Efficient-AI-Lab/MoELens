/**
 * Single-hue sequential ramps for the specialization grids. Only lightness and
 * chroma move along the ramp; the hue is fixed (each caller supplies it), so
 * every grid is a textbook single-hue sequential scale (never a rainbow). An
 * unused expert lands near-white, a fully-specialized one at the canonical
 * signal color.
 */

/** Frequency mapped to full saturation. Max observed is ~0.86; 0.9 lets the
 *  strongest experts reach the signal color while keeping the scale fixed
 *  across layers, so deeper layers visibly saturate as specialization sharpens. */
const HEAT_DOMAIN_MAX = 0.9;

function ramp(freq: number): { l: number; c: number } {
  const t = Math.max(0, Math.min(1, freq / HEAT_DOMAIN_MAX));
  return { l: 0.97 - 0.42 * t, c: 0.02 + 0.13 * t };
}

export function heatColor(freq: number, hue: number): string {
  const { l, c } = ramp(freq);
  return `oklch(${l.toFixed(4)} ${c.toFixed(4)} ${hue})`;
}

/** Ink on the pale end, paper on the saturated end — keeps any overlaid label legible. */
export function heatTextColor(freq: number): string {
  return ramp(freq).l < 0.62 ? 'var(--color-paper)' : 'var(--color-ink)';
}
