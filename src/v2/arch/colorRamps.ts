/**
 * Colour maths for the Model Architecture explorer, lifted out of `archExplorer.ts` unchanged.
 *
 * Everything here is pure: the two functions that need a live theme (`tokenColorAt`,
 * `sequentialBlue`) take the `.moe-root` element and read their CSS custom properties through
 * `getComputedStyle` ON EVERY CALL, exactly as they did as closures. That call-time read is what
 * makes both track light/dark mode — resolving the hex once and caching it would render
 * identically in light mode and silently freeze the dark one.
 *
 * `archExplorer.ts` keeps one-line wrappers over the two so its ~140 call sites stay unchanged.
 */

// ---- heatmap color ramps: light->dark within each of the two color families ----
export function hexToRgb(h: string) { h = h.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; }
export function rgbToHex(rgb: number[]) { return '#' + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join(''); }
export function lerpRgb(a: number[], b: number[], t: number) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
// hex <-> HSL, used only by tokenColor: it keeps --series-1's saturation and lightness and
// rotates only the hue, so a generated token color sits in the same tonal family as the palette.
export function rgbToHsl([r, g, b]: number[]): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const l = (max + min) / 2;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === R) h = 60 * (((G - B) / d) % 6);
  else if (max === G) h = 60 * ((B - R) / d + 2);
  else h = 60 * ((R - G) / d + 4);
  return [(h + 360) % 360, s, l];
}
export function hslToHex(h: number, s: number, l: number) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const seg = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ][seg];
  return rgbToHex([(r + m) * 255, (g + m) * 255, (b + m) * 255]);
}

const WHITE = [255, 255, 255], BLACK = [0, 0, 0];

// One hue per token, and never a repeat: the palette only defines six --series-* vars, so any
// prompt longer than six tokens used to wrap (token 7 wore token 1's blue). Hues are generated
// instead — evenly spaced around the wheel, anchored on --series-1 so the first token keeps the
// palette's blue — while saturation and lightness are lifted from --series-1 itself, which is
// theme-defined, so the generated set tracks light/dark mode without a second table.
// Returns hex, not oklch: the heatmap ramp below runs on hexToRgb/lerpRgb.
// Every token-colored mark (row-label dot, routing dot, and the row's own heatmap ramp) reads
// through here, so they can never drift apart.
export function tokenColorAt(root: HTMLElement, i: number, numTokens: number) {
  const base = getComputedStyle(root).getPropertyValue('--series-1').trim() || '#2a78d6';
  const [h0, s, l] = rgbToHsl(hexToRgb(base));
  const n = Math.max(numTokens, 1);
  return hslToHex((h0 + (i * 360) / n) % 360, s, l);
}

// The one ramp every router-probability view uses: a sequential scale per token, in that token's
// own hue. Pale at ~0 router probability, saturated at the token's maximum, and normalized ONCE
// across all experts. The prototype instead ran two ramps (blue for the top-k, peach for the
// rest) each normalized within its own group — dropped along with them, because separate
// normalizations let a 1.5% expert render as dark as a 17% one. One normalization means darkness
// states one honest thing, and the top-k land darkest because they *are* the highest
// probabilities. Used by the All-tokens grid and by the math modal's "D = Softmax Output" strip,
// which is the same 64 numbers for one token and so must not look like a different measurement.
export function tokenRampColor(baseHex: string, t: number) {
  const base = hexToRgb(baseHex);
  const light = lerpRgb(base, WHITE, 0.88);
  const dark = lerpRgb(base, BLACK, 0.30);
  return rgbToHex(lerpRgb(light, dark, Math.max(0, Math.min(1, t))));
}

/** The blue ramp every weight/activation grid in the math modals is painted with. INVERTS in dark
 *  mode, because --seq-100/--seq-700 swap ends there. */
export function sequentialBlue(root: HTMLElement, t: number) {
  const cs = getComputedStyle(root);
  const light = hexToRgb(cs.getPropertyValue('--seq-100').trim());
  const dark = hexToRgb(cs.getPropertyValue('--seq-700').trim());
  return rgbToHex(lerpRgb(light, dark, Math.max(0, Math.min(1, t))));
}
