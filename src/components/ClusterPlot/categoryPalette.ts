/**
 * Six-hue qualitative palette scoped to the Act 2 views (ClusterPlot, Histogram, ExpertGrid
 * tiles) that need up to six simultaneously-toggled categories to stay visually distinct — a
 * documented, deliberate exception to DESIGN.md's Rarity Rule (see the "Scoped exception" note
 * there). `code`/`math`/`creative_writing`/`conversational` reuse the prior taxonomy's hues;
 * `biomedical`/`legal` are new, slotted into the remaining gaps.
 *
 * Colors were reassigned 2026-07-26 (requested swap, `conversational` untouched): `code` took a
 * new royal-blue hue (CSS `royalblue` #4169E1), and the other four rotated — `legal`→`math`,
 * `math`→`biomedical`, `biomedical`→`creative_writing`, `code`(old red)→`legal`. Note `code`'s
 * new hue (266°) sits only ~8° from the reserved violet-counterpoint hue (258°, see DESIGN.md) —
 * left as requested since this palette only ever appears in the Domain Specialization tab,
 * never alongside the amber/violet comparison encoding, and the two differ enough in
 * lightness/chroma (0.56/0.19 vs violet's 0.40/0.16) not to be mistaken for it there.
 *
 * `biomedical` (orange) and `legal` (yellow) sit close to the reserved amber-signal hue (57°) by
 * necessity — orange and yellow are its neighbors on the wheel — but are pushed to a brighter
 * lightness/higher chroma than the muted amber-signal token so they read as distinct category
 * swatches rather than "selected" state. Chroma is pushed near each hue's gamut edge and
 * lightness tuned per hue so the six categories are vividly distinct at dot size — the priority
 * here is telling points apart by color, not equal visual weight.
 */
export const CATEGORY_HUES: Record<string, number> = {
  code: 266, // royal blue
  math: 95, // yellow
  biomedical: 152, // green
  legal: 25, // red
  creative_writing: 50, // orange
  conversational: 300, // purple
};

export const CATEGORY_PALETTE: Record<string, string> = {
  code: 'oklch(0.56 0.19 266)',
  math: 'oklch(0.80 0.17 95)',
  biomedical: 'oklch(0.62 0.17 152)',
  legal: 'oklch(0.58 0.21 25)',
  creative_writing: 'oklch(0.70 0.19 50)',
  conversational: 'oklch(0.50 0.21 300)',
};
