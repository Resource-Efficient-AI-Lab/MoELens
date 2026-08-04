/**
 * The math modals' diagram primitives, lifted out of `archExplorer.ts` unchanged. They are HTML
 * STRING builders, exactly as in the prototype — deliberately not JSX, so the modal bodies stay
 * one `innerHTML` assignment and `playAttnStep` can keep addressing ~2,300 `.mm-cell`s by query
 * rather than reconciling them.
 *
 * The five builders that paint values (`buildGridHTML`, `buildAttnGridHTML`, `buildMaskGridHTML`,
 * `buildStripHTML`, `buildHeadStripHTML`) used to close over `colorSequentialBlue` and `tokLabel`.
 * They now take those as their first argument; `archExplorer.ts` keeps a one-line wrapper per
 * builder under the original name so its call sites are unchanged. Passing the FUNCTION (never a
 * resolved colour) is what keeps the theme read at call time — see colorRamps.ts.
 */
import { hexToRgb, tokenRampColor } from './colorRamps';

/** Paints one normalized magnitude in [0,1]. `sequentialBlue` bound to `.moe-root`, at every site
 *  but the "D = Softmax Output" strip's. */
export type Ramp = (t: number) => string;
/** Renders token `i`'s text for a tooltip attribute: HTML-escaped AND quote-escaped. */
export type TokLabel = (i: number) => string;

// Token text (e.g. the BOS token, literally the string "<s>") and next-token candidates are
// real model output spliced into innerHTML-bound strings below — escape so a literal "<s>" (or
// a code-domain token containing "<"/">"/"&") can't be parsed as markup. Only needed at sites
// that build `html`/`innerHTML`; sites that assign via `.textContent` (e.g. mathTitle) are
// already safe and must NOT be escaped there, or the entities would show up literally.
export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function mmDelay(idx: number, total: number) { return Math.min(idx * (260 / Math.max(total, 1)), 260).toFixed(0); }

// The math modal's "D = Softmax Output" strip: the same 64 router probabilities the All-tokens
// grid draws for this token, so it is drawn the same way — the clicked token's own hue, one
// normalization across all experts, top-k numbered. Clicking a grid cell should open a bigger
// version of the row you clicked, not a differently-coloured second opinion of it.
// `gapPx` exists because the separator has to survive fractional device pixel ratios (Windows at
// 125% display scaling = DPR 1.25, the common case). Cells + gap form a pitch, and the pitch is
// what Chrome snaps: 22 + 1 = 23 → 28.75 device px at 1.25, so boundaries drift fractionally, the
// cells paint 26/27/28px wide, and the 1px dividers antialias into the fill they sit between
// (measured on the then-green strip: 180,199,179 and 113,159,113 instead of the intended
// 227,227,226 — the same blend happens whatever the fill). Two identically
// coloured neighbours then merge and the pair reads as one double-width cell — which is exactly
// how the attention router's 14.9%/14.8% pair looked. 22 + 2 = 24 → 30 device px at 1.25 and 36 at
// 1.5, both integers, and all seven dividers come back solid. Don't retune 22 or 2 independently.
//  `hue` takes a ramp function as well as a hex: the attention router's strip passes
//  `colorSequentialBlue` so it is painted by the SAME ramp as the `stripHTML` stream row it is
//  computed from, rather than a blue-ish approximation of it (see that call site).
export function expertStripWithNumbers(hue: string | Ramp, allProbs: number[], topExperts: number[], cw?: number, ch?: number, gapPx?: number) {
  const ramp = typeof hue === 'function' ? hue : (t: number) => tokenRampColor(hue, t);
  const w = cw || 13;
  const h = ch || 22;
  // 1 by default: the D = Softmax Output strip is 64 cells at 8px, where a 2px gap would be a
  // fifth of the pitch and would stop reading as the enlarged copy of an All-tokens grid row.
  const gap = gapPx || 1;
  const fontSz = Math.max(7, Math.round(w * 0.85));
  const topSet = new Set(topExperts);
  const maxP = Math.max(...allProbs, 1e-9);
  let html = '<div style="display:inline-flex;gap:' + gap + 'px;background:var(--border);border:1px solid var(--border);border-radius:5px;overflow:hidden;">';
  for (let i = 0; i < allProbs.length; i++) {
    const p = allProbs[i];
    const isTop = topSet.has(i);
    const fill = ramp(Math.sqrt(p / maxP));
    // Ink from the cell's own luminance, not a hard-coded white. `colorSequentialBlue` INVERTS in
    // dark mode (--seq-100/--seq-700 swap ends), so the highest-probability cell — the one that
    // always carries a number — is a pale blue there, and white-on-pale is the worst contrast in
    // the strip. tokenRampColor's fills stay dark at high t, so the other call site keeps white.
    const [fr, fg, fb] = hexToRgb(fill);
    const dark = (0.2126 * fr + 0.7152 * fg + 0.0722 * fb) < 150;
    const ink = dark ? '#fff' : '#141414';
    const inkShadow = dark ? '0 0 2px rgba(0,0,0,0.65)' : '0 0 2px rgba(255,255,255,0.65)';
    html += '<div class="mm-cell" style="position:relative;width:' + w + 'px;height:' + h + 'px;background:' + fill + ';animation-delay:' + mmDelay(i, allProbs.length) + 'ms;">' +
      (isTop ? '<span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:' + fontSz + 'px;font-weight:800;color:' + ink + ';text-shadow:' + inkShadow + ';">' + (i + 1) + '</span>' : '') +
      '</div>';
  }
  html += '</div>';
  return html;
}

// ---- cell pitch and fractional device pixel ratios -----------------------------------------
/** The gap between grid cells, derived from `cellPx` rather than fixed at 1 — same failure the long
 *  note above `expertStripWithNumbers` describes for the strip, and the same cure. Cell + gap is a
 *  PITCH, and the pitch is what the compositor snaps. Every cell in these grids is declared at an
 *  identical `cellPx`, but at a 1px gap the 22px grids came out at pitch 23 → 28.75 device px on
 *  Windows at 125% display scaling (DPR 1.25, the common case) and the 10px grids at pitch 11 →
 *  13.75. Neither is an integer, so the fraction accumulates across the row and Chrome paints
 *  29/29/29/28 device px in a repeating pattern. Two visible symptoms, both reported on the
 *  Attention `map` step (mask M, both attention maps, V head, head output): one cell in four reads
 *  visibly fatter than its neighbours, and the 1.25-device-px dividers antialias into the fill they
 *  separate, so two near-equal neighbours merge and the pair reads as one double-width tile.
 *
 *  A pitch is device-px-exact at BOTH common fractional ratios (1.25 and 1.5) exactly when it is a
 *  multiple of 4. Only the gap moves, never `cellPx`: `buildMaskGridHTML` sizes its "0" glyph off
 *  `cellPx * 0.42`, so reaching pitch 24 by growing the cell would move the digits as well as the
 *  dividers. That bounds the gap to 1 or 2, which covers `cellPx % 4` of 3 (7 → 8) and 2 (22 → 24,
 *  10 → 12, 6 → 8). The remaining cases, 4 and 5, would need a 4px or 3px gap — more gap than cell —
 *  so they keep 1 and keep today's behaviour; they are the dense weight-matrix textures where no
 *  single cell is legible as a tile in the first place, which is why the drift never read as a
 *  defect there. Never special-case one builder's gap: `attnMapGrid`'s shared middle column stays
 *  aligned cell-for-cell only while the mask grid and the attention map grid share a pitch. */
function gridGap(cellPx: number) { return (cellPx + 2) % 4 === 0 ? 2 : 1; }
/** Largest cell whose n-row grid (pitch = cell + gap 2, plus the 2px border) stays under
 *  budgetPx, capped at maxCell. Candidates are ONLY the sizes whose pitch is a multiple of 4 —
 *  the device-pixel invariant `gridGap` documents above — so the picker can never emit a size
 *  that reintroduces the fractional-pitch drift. Floor 6: below that a cell stops reading as a
 *  tile at all (the 4/5px texture grids are deliberately not sized through this). */
export function fitCellPx(n: number, budgetPx: number, maxCell: number): number {
  for (const c of [22, 18, 14, 10]) {
    if (c <= maxCell && n * (c + 2) + 2 <= budgetPx) return c;
  }
  return 6;
}
export function buildGridHTML(ramp: Ramp, grid: number[][], cellPx: number) {
  const cols = grid[0].length;
  const total = grid.length * cols;
  let maxAbs = 1e-9;
  grid.forEach((row) => row.forEach((v) => { if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v); }));
  let html = '<div style="display:inline-grid;grid-template-columns:repeat(' + cols + ',' + cellPx + 'px);gap:' + gridGap(cellPx) + 'px;background:var(--border);border:1px solid var(--border);border-radius:5px;overflow:hidden;">';
  let idx = 0;
  grid.forEach((row) => row.forEach((v) => {
    html += '<div class="mm-cell" style="width:' + cellPx + 'px;height:' + cellPx + 'px;background:' + ramp(Math.sqrt(Math.abs(v) / maxAbs)) + ';animation-delay:' + mmDelay(idx++, total) + 'ms;"></div>';
  }));
  html += '</div>';
  return html;
}
// ---- causal-mask rendering ----------------------------------------------------------------
// gridHTML paints a value ramp and nothing else, so an attention map's upper triangle reads as
// "a very pale blue", i.e. as a genuinely tiny probability. It is not tiny: every upper-triangular
// cell of attn_probs_all_heads is EXACTLY 0 in all three models (verified over every layer of
// OLMoE's 12 prompts and prompts 0/5/11 of DeepSeek/JetMoE — max |value| = 0), because the causal
// mask adds −∞ to those scores before the softmax. Hatching them says "structurally excluded"
// where the ramp said "small", and the hover tells the two apart.
// Two traps here, both silent: the stripes are drawn from --text-muted, not --border (on the light
// theme --border is a 10% black wash that disappears into the base at these cell sizes), and the
// base is --page, NOT --surface-2 — .moe-root does not define --surface-2, so a var() on it makes
// the whole background declaration invalid and the cell renders transparent with no hatch at all.
const HATCH_BG = 'repeating-linear-gradient(45deg, transparent 0 2.5px, color-mix(in srgb, var(--text-muted) 60%, transparent) 2.5px 4px), var(--page)';
// Same ramp as gridHTML, but key > query is hatched instead of coloured.
// Tooltips go in a data-tip="" attribute (shown instantly via the shared #tooltip div — a
// title="" would add the browser's fixed ~1s hover delay), so the label is quote-escaped (see
// `tokLabel` in archExplorer.ts) and every quotation mark around it in the tip strings below is a
// curly one — a straight " there closes the attribute and truncates the tooltip at the token name.
export function buildAttnGridHTML(ramp: Ramp, tokLabel: TokLabel, grid: number[][], cellPx: number) {
  const cols = grid[0].length;
  const total = grid.length * cols;
  let maxAbs = 1e-9;
  grid.forEach((row) => row.forEach((v) => { if (Math.abs(v) > maxAbs) maxAbs = Math.abs(v); }));
  let html = '<div style="display:inline-grid;grid-template-columns:repeat(' + cols + ',' + cellPx + 'px);gap:' + gridGap(cellPx) + 'px;background:var(--border);border:1px solid var(--border);border-radius:5px;overflow:hidden;">';
  let idx = 0;
  grid.forEach((row, r) => row.forEach((v, c) => {
    const masked = c > r;
    const bg = masked ? HATCH_BG : ramp(Math.sqrt(Math.abs(v) / maxAbs));
    const tip = masked
      ? 'masked (causal): M = −∞ before softmax, so this weight is exactly 0'
      : 'query “' + tokLabel(r) + '” → key “' + tokLabel(c) + '”: ' + (v * 100).toFixed(2) + '%';
    html += '<div class="mm-cell" data-tip="' + tip + '" style="width:' + cellPx + 'px;height:' + cellPx + 'px;background:' + bg + ';animation-delay:' + mmDelay(idx++, total) + 'ms;"></div>';
  }));
  html += '</div>';
  return html;
}
// The mask M itself: 0 where the key is at or before the query, −∞ above the diagonal. Built from
// the token count, not read from data — M is a fixed structural matrix, not a measurement.
export function buildMaskGridHTML(tokLabel: TokLabel, n: number, cellPx: number) {
  let html = '<div style="display:inline-grid;grid-template-columns:repeat(' + n + ',' + cellPx + 'px);gap:' + gridGap(cellPx) + 'px;background:var(--border);border:1px solid var(--border);border-radius:5px;overflow:hidden;">';
  let idx = 0;
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const masked = c > r;
      const tip = masked
        ? 'M = −∞: key “' + tokLabel(c) + '” comes after query “' + tokLabel(r) + '”, so softmax sends this to exactly 0'
        : 'M = 0: key “' + tokLabel(c) + '” is at or before query “' + tokLabel(r) + '”, so the score passes through unchanged';
      html += '<div class="mm-cell" data-tip="' + tip + '" style="display:flex;align-items:center;justify-content:center;' +
        'width:' + cellPx + 'px;height:' + cellPx + 'px;font-size:' + Math.max(7, Math.round(cellPx * 0.42)) + 'px;' +
        'color:var(--text-muted);background:' + (masked ? HATCH_BG : 'var(--surface-1)') + ';animation-delay:' + mmDelay(idx++, n * n) + 'ms;">' +
        (masked ? '' : '0') + '</div>';
    }
  }
  html += '</div>';
  return html;
}
/** The map step's single closing line (2026-08-03, by request — was two stacked lines, a
 *  `.math-hint` sentence plus a separate MASK_LEGEND `.math-note`): the per-branch prose, then the
 *  hatch swatch and a condensed legend, all on one flex line. `flex-wrap` lets it fold on narrow
 *  modals instead of overflowing; the legend dropped "unhatched cells in the mask are 0" (the mask
 *  prints its 0 glyphs) and folds the two hover targets into one clause. */
export const mapFootnote = (prose: string) =>
  '<p class="math-hint" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:6px 0 0;">' +
  '<span>' + prose + '</span>' +
  '<span style="display:inline-block;width:15px;height:15px;border:1px solid var(--border);border-radius:3px;background:' + HATCH_BG + ';flex:0 0 auto;"></span>' +
  '<span>hatched = masked (causal, M = −∞); hover a cell for its exact value.</span></p>';
// 16 per-head slices side by side: what "concatenate the heads" actually produces. Each head keeps
// its own ramp normalization (as everywhere else in this modal), so a quiet head stays legible.
export function buildHeadStripHTML(ramp: Ramp, heads: number[][][], cellPx: number) {
  return '<div style="display:flex;gap:3px;align-items:flex-end;flex-wrap:wrap;justify-content:center;max-width:100%;">' +
    heads.map((h) => buildGridHTML(ramp, h, cellPx)).join('') + '</div>';
}
export function buildStripHTML(ramp: Ramp, vec: number[], cw: number) {
  let maxAbs = 1e-9;
  vec.forEach((v) => { const a = Math.abs(v); if (a > maxAbs) maxAbs = a; });
  let html = '<div style="display:inline-flex;gap:1px;background:var(--border);border:1px solid var(--border);border-radius:5px;overflow:hidden;">';
  vec.forEach((v, idx) => {
    const fill = ramp(Math.sqrt(Math.abs(v) / maxAbs));
    html += '<div class="mm-cell" style="width:' + cw + 'px;height:20px;background:' + fill + ';animation-delay:' + mmDelay(idx, vec.length) + 'ms;"></div>';
  });
  html += '</div>';
  return html;
}
export function matBlock(title: string, dimLabel: string, inner: string, big?: boolean) {
  const titleSz = big ? '14px' : '11px', dimSz = big ? '12px' : '10px';
  return '<div style="text-align:center;">' +
    '<div style="font-size:' + titleSz + ';color:var(--text-secondary);margin-bottom:' + (big ? '7px' : '5px') + ';">' + title + '</div>' +
    inner +
    '<div style="font-size:' + dimSz + ';color:var(--text-muted);margin-top:' + (big ? '7px' : '5px') + ';font-variant-numeric:tabular-nums;">' + dimLabel + '</div>' +
    '</div>';
}
export function resultBlock(title: string, dimLabel: string, inner: string, big?: boolean) {
  const titleSz = big ? '14px' : '11px', dimSz = big ? '12px' : '10px', pad = big ? '12px 16px' : '8px 12px';
  return '<div style="text-align:center;background:color-mix(in srgb, var(--seq-500) 8%, var(--surface-1));border:1.5px solid var(--seq-500);border-radius:10px;padding:' + pad + ';">' +
    '<div style="font-size:' + titleSz + ';font-weight:750;color:var(--seq-500);margin-bottom:' + (big ? '7px' : '5px') + ';">' + title + '</div>' +
    inner +
    '<div style="font-size:' + dimSz + ';color:var(--text-muted);margin-top:' + (big ? '7px' : '5px') + ';font-variant-numeric:tabular-nums;">' + dimLabel + '</div>' +
    '</div>';
}
/** The multiplication dot is the one operator that does not survive the operator body size: `·` is
 *  roughly 0.12em of ink, so at 17px it paints a ~2px speck and a pair of operands reads as two
 *  grids sitting side by side rather than as a product. Every other operator here is a word
 *  (`→ softmax →`) or a full-height glyph (`=`, `+`, `×`), so only this one needs the bump — and it
 *  is applied BY SYMBOL inside `opSpan`, never per call site, so no diagram in these modals can be
 *  left with the small dot. `line-height:1` comes with it: `align-self:center` would still centre a
 *  taller line box, but in the `flex-end` rows (`diagramRow`'s default) a taller operator raises the
 *  row's own height and lifts every operand off the bottom edge they align to. */
const DOT_PX = 34, DOT_PX_BIG = 44;
/** Same enlargement for a `·` that opens a longer operator phrase, where `opSpan` cannot scale the
 *  string without blowing up the words beside it. The phrase becomes an inline-flex row so
 *  `align-items:center` aligns the two from their real line boxes: left inline, a 2× middot rides
 *  ~6px HIGH of the text's optical centre (it sits at its own font-size's x-height, not the
 *  phrase's), and the obvious `vertical-align:middle` overcorrects it down onto the baseline —
 *  measured both. Any hand-tuned `vertical-align:-0.NNem` that splits the difference is a font-metric
 *  constant and would be wrong on a different stack, so it is not used. */
export function dotPhrase(rest: string, big?: boolean) {
  return '<span style="display:inline-flex;align-items:center;gap:4px;">' +
    '<span style="font-size:' + (big ? DOT_PX_BIG : DOT_PX) + 'px;line-height:1;">·</span>' +
    '<span>' + rest + '</span></span>';
}
export function opSpan(sym: string, big?: boolean, noOffset?: boolean) {
  const isDot = sym === '·';
  const size = big ? (isDot ? DOT_PX_BIG : 22) : (isDot ? DOT_PX : 17);
  return '<div style="font-size:' + size + 'px;' + (isDot ? 'line-height:1;' : '') +
    'color:var(--text-muted);align-self:center;' + (noOffset ? '' : 'padding-bottom:' + (big ? '20px' : '16px') + ';') + '">' + sym + '</div>';
}

/** Every weight grid in these modals is drawn in PyTorch's stored `(out, in)` layout — that is the
 *  shape the extraction downsampled (`gate_w = fused[:ffn, :]` is `[5632, 2048]`, `router.layer.weight`
 *  is `[num_experts, hidden]`) and it is what `nn.Linear` holds — while the multiply drawn beside it
 *  contracts over `in`, i.e. runs `F.linear(h, W)` = `h · Wᵀ`. So a stored weight's dim label reads
 *  `(out,in)ᵀ = (in,out)` and the result equations carry `Wᵀ`.
 *  DELIBERATE DIVERGENCE from `index_v2.html`, which labels these `(out, in)` and writes a plain
 *  `h·W_gate` — a dimensionally invalid product `(1,2048)·(5632,2048)`. See CLAUDE.md.
 *  ⚠ The `∑_d h_d·W_router[e,d]` summations (the Router modal's step 1, and the MoA router step) are
 *  NOT part of this and must stay un-transposed: they index the STORED tensor by (row = expert,
 *  col = dim), which is already correct. A find-replace that adds ᵀ there breaks them.
 *  ⚠ Also not part of this: the attention `W_q`/`W_k`/`W_v`/`W_o` labels, which are hard-coded
 *  `(H, H)` and genuinely square on all three models (JetMoE's `nq × hd` = 16 × 128 = 2048 = H), and
 *  the RMSNorm `weight γ` row, which is elementwise (`⊙`, Hadamard), not a matmul. */
export function wDims(out: number, inn: number) { return '(' + out + ',' + inn + ')ᵀ = (' + inn + ',' + out + ')'; }
export const TRANSPOSE_NOTE = 'Weights are shown in PyTorch’s stored <b>(out, in)</b> shape and used transposed in the multiply, the same convention as <b>nn.Linear</b>.';
/** `data-diagram` on both containers below is what `playStageReveal` walks (archExplorer.ts): its
 *  DIRECT CHILDREN are the beats, in DOM order, which is reading order at both call sites.
 *  `diagramRow` needs no `data-cols` — every child is its own beat. See `stagedRoot`. */
export function diagramRow(blocks: string[], opts?: { nowrap?: boolean; align?: 'flex-end' | 'center' }) {
  const nowrap = opts && opts.nowrap;
  const align = (opts && opts.align) || 'flex-end';
  const style = nowrap
    ? 'display:flex;align-items:' + align + ';gap:8px;flex-wrap:nowrap;overflow-x:auto;justify-content:flex-start;margin:8px 0 12px;'
    : 'display:flex;align-items:' + align + ';gap:8px;flex-wrap:wrap;justify-content:center;margin:8px 0 12px;';
  return '<div data-diagram style="' + style + '">' + blocks.join('') + '</div>';
}
// A multi-row diagram where every row shares the same N columns, so operands/operators/results
// line up vertically row-to-row instead of each row independently centering its own content.
export function diagramGrid(rows: string[][], cols: number, opts?: { big?: boolean; colGap?: number; rowGap?: number; center?: boolean }) {
  const big = opts && opts.big;
  const colGap = opts && opts.colGap != null ? opts.colGap : (big ? 22 : 16);
  const rowGap = opts && opts.rowGap != null ? opts.rowGap : (big ? 28 : 20);
  const ml = opts && opts.center ? 'auto' : '0';
  // `data-cols` is what makes `playStageReveal` group this grid BY COLUMN rather than child by
  // child: children land row-major below, so child i sits in column i % cols, and one column is one
  // beat. That is the same grouping the Attention `proj` step gets by hand — its Q/K/V rows share
  // the `stream`/`mul`/`wmat` beat keys — so a 3×5 SwiGLU grid reads as 5 steps, not 15.
  let html = '<div data-diagram data-cols="' + cols + '" style="margin-left:' + ml + ';margin-right:auto;width:fit-content;max-width:100%;' +
    'display:grid;grid-template-columns:repeat(' + cols + ',auto);align-items:end;' +
    'column-gap:' + colGap + 'px;row-gap:' + rowGap + 'px;padding:6px 0 10px;">';
  rows.forEach((row) => { html += row.join(''); });
  html += '</div>';
  return html;
}
/** A cell that holds a column open without drawing anything — a grid places children in order, so
 *  a row that skips a step (V takes no RMSNorm and no RoPE) needs a real element there or every
 *  later cell in that row slides one column left and the alignment the grid exists for is lost. */
export const GRID_BLANK = '<div></div>';
/** Pads ragged rows to the longest one so `diagramGrid` gets a rectangle. Returns the column count
 *  with it, so no call site has to keep a hand-counted `cols` in sync with its own rows. */
export function padGridRows(rows: string[][]) {
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  return { cols, rows: rows.map((r) => r.concat(Array(cols - r.length).fill(GRID_BLANK))) };
}
/** The Attention Map step's two rows, on a shared middle column (2026-08-02, by request). Row B's
 *  `attention map` IS row A's result, drawn at the same 22px cell over the same (tokens, tokens)
 *  footprint as `mask M` — so parking it directly UNDER the mask lines the two hatched upper
 *  triangles up cell-for-cell and shows the mask carving the map. Two `diagramRow`s cannot do
 *  that: each one centres its own content, so row B landed wherever its own midpoint fell (~65px
 *  left of the mask on a 9-token prompt).
 *  Deliberately NOT `diagramGrid`: giving every operand its own column would size row A's trailing
 *  `attention map` column and row B's `V head` column together, floating an 80px grid in a ~260px
 *  track. Only the middle column needs to be shared, so the flanking groups stay single cells and
 *  keep the flex spacing they have today — row B still reads `· V = out` at its own gaps.
 *  Three details that are load-bearing:
 *  - `flex:0 0 auto` on the grid. It is a flex item of the scroll wrapper, so it would otherwise
 *    inherit `flex-shrink:1` and the `auto` tracks would compress toward min-content instead of
 *    overflowing — which is the only thing the wrapper exists to catch.
 *  - `row-gap:12px` + the wrapper's `margin:8px 0 12px` reproduce the old spacing exactly: the two
 *    rows each carried `margin:8px 0 12px` and adjacent siblings collapse to max(12, 8) = 12.
 *  - A grid column cannot wrap, so row A loses `diagramRow`'s `flex-wrap`. `safe center` centres
 *    the diagram while it fits and falls back to start-alignment rather than clipping its left
 *    edge (same pattern as `.pdf-flow-row`), and the scroll lives HERE, not on `.math-modal` —
 *    that element is `overflow-x:auto` too, and scrolling it drags the header and the step
 *    sub-tab bar off screen. Widest case in the corpus is JetMoE's 17-token prompt. */
export function attnMapGrid(leadA: string[], midA: string, tailA: string[], midB: string, tailB: string[]) {
  const cell = (items: string[]) => '<div style="display:flex;align-items:center;gap:8px;">' + items.join('') + '</div>';
  return '<div style="max-width:100%;overflow-x:auto;display:flex;justify-content:safe center;margin:8px 0 12px;">' +
    '<div style="flex:0 0 auto;display:grid;grid-template-columns:auto auto auto;' +
    'align-items:center;column-gap:8px;row-gap:12px;">' +
    cell(leadA) + midA + cell(tailA) +
    GRID_BLANK + midB + cell(tailB) +
    '</div></div>';
}
/** Tags one diagram cell with the beat it belongs to in the Attention step-1 reveal (see
 *  `playAttnStep`). `matBlock`/`opSpan` each return a single outer `<div …>`, so the attribute
 *  goes in by injecting it after that first tag rather than by growing their signatures — both are
 *  shared by every math modal in this file and animate nowhere else, so the tag stays entirely
 *  inside the two `proj` panels that use it. */
export function beat(key: string, html: string) { return html.replace('<div', '<div data-beat="' + key + '"'); }

/** The Attention modal's steps. Standard MHA has three; JetMoE's MoA has a fourth, `route`, in
 *  second position — its attention block really does route before it attends, and that router is
 *  part of attention, not of the MoE block (it lived behind a toggle in the Router modal until
 *  2026-07-30). Keys are semantic, never positional: "Attention Map" is step 2 on one model and
 *  step 3 on the other, so `data-atab="2"` / `#attn-subtab-2` could not name the same panel on
 *  both — the numbers a reader sees are printed from the array index instead. */
export const ATTN_STEPS_MHA = [
  { key: 'proj', label: 'Project to Q/K/V' },
  { key: 'map', label: 'Attention Map' },
  { key: 'concat', label: 'Concatenate &amp; project' },
];
export const ATTN_STEPS_MOA = [
  { key: 'proj', label: 'Project to Q/K/V' },
  { key: 'route', label: 'Expert routing' },
  { key: 'map', label: 'Attention Map' },
  { key: 'concat', label: 'Concatenate &amp; project' },
];
/** Title row for the Attention modal: bold name + its step pills on one line. Goes into
 *  #math-modal-header-slot, NOT into #math-content — it names and navigates the whole modal, so
 *  it belongs in the header level with ✕, exactly like the Router modal's (ArchitectureTab.tsx).
 *  The click wiring in archExplorer.ts queries `#attn-sub-tabs` document-wide, which is what lets
 *  the buttons live outside the body they drive. Shared by both attention branches (standard MHA
 *  and JetMoE's MoA) so the two cannot drift; the MoA branch says plain "Attention" too — which
 *  expert and which layer are already in the hint paragraph right below it.
 *  `active` defaults to 'proj' at every call site that opens the modal fresh: clicking the block
 *  means "explain this block", so it opens on the block's first step. */
export function attnSubTabBar(steps: { key: string; label: string }[], active: string) {
  return '<div class="math-subtab-bar"><h3>Attention</h3>' +
    '<div class="sub-tabs" id="attn-sub-tabs" role="tablist">' +
    steps.map((s, i) => '<button class="sub-tab' + (s.key === active ? ' active' : '') + '" data-atab="' + s.key +
      '" type="button" role="tab" aria-selected="' + (s.key === active) + '">' + (i + 1) + '. ' + s.label + '</button>').join('') +
    '</div></div>';
}
/** Header title for a stage that has NO sub-tabs (the two RMSNorms, the two Residual adds, the
 *  Final RMSNorm and Final Output). Same slot, same wrapper and therefore the same bold 15px h3 as
 *  `attnSubTabBar`'s "Attention", so every named modal is named in one place and one style rather
 *  than each stage inventing its own heading. `#math-modal-title` stays display:none — this bar is
 *  still the only place a math modal carries a visible name.
 *  No sub-tabs inside it, and nothing wires it: `wireAttnSubTabs` queries `#attn-sub-tabs` and
 *  `wireMathSubTabs` queries inside `#math-content`, so a bare bar is inert on both paths. */
export function stageTitleBar(label: string) {
  return '<div class="math-subtab-bar"><h3>' + label + '</h3></div>';
}
/** One step's panel. Only the active one is visible; the rest ship collapsed, exactly as before —
 *  the sub-tab click handler flips `display` on these same ids.
 *  `cls` exists for the `ATTN_PANEL_CLS` these panels all pass (`no-cell-anim beat-armed`): their
 *  cells are driven by GSAP (`playAttnStep`), and the shared `.mm-cell` keyframe would otherwise
 *  fight the tween — a CSS animation with `both` fill outranks inline styles for the properties it
 *  animates. Scoping it to these panels leaves every other grid in the app (the Router modal, the
 *  RMSNorm blocks) on the original CSS reveal. */
export function attnPanel(key: string, active: string, inner: string, cls?: string) {
  return '<div class="math-subtab-panel' + (cls ? ' ' + cls : '') + '" id="attn-subtab-' + key + '"' +
    (key === active ? '' : ' style="display:none;"') + '>' + inner + '</div>';
}

/** Every NON-attention math stage's reveal root — the counterpart of `ATTN_PANEL_CLS`, and the
 *  three classes do the same three jobs here:
 *  - `mm-staged` scopes the arming rules in moe.css to these roots. It has to be there: an
 *    unscoped `[data-diagram] > *` rule would also arm `attnMapGrid`'s wrapper cells on the
 *    Attention `map` step, whose tweens address the `matBlock`s INSIDE those wrappers — the
 *    wrappers would never unhide and the step would render blank.
 *  - `no-cell-anim` opts these cells out of the shared `mm-appear` keyframe, exactly as it does for
 *    the attention panels. It is what lets `mmDelay` and `.mm-cell` stay untouched: the inline
 *    `animation-delay` every cell still carries simply goes inert.
 *  - `beat-armed` paints frame 0 from CSS, so the panel's first paint is already the start state.
 *    ⚠ `playStageReveal` MUST strip it on every exit path or the stage renders blank.
 *  It must ship INSIDE the HTML string, never be added later: `mountStage` runs from a `useEffect`
 *  (i.e. after paint), so a class applied there would flash the finished diagram first.
 *  `armed` is false for a build that already knows its reveal will be skipped — today only the
 *  Router popup's automatic rebuild under ▶ Step through layers. Arming is a property of the HTML
 *  and `mountStage` unarms only after paint, so a skipped stage that still shipped `beat-armed`
 *  would paint one frame at opacity 0 on every 3.5s tick: a blink, and a visible one. The other two
 *  classes stay either way — the cells must not fall back to `mm-appear`, and the arming rules must
 *  stay scoped to `.mm-staged` roots. */
export function stagedCls(armed = true) { return 'mm-staged no-cell-anim' + (armed ? ' beat-armed' : ''); }
export function stagedRoot(inner: string, armed = true) { return '<div class="' + stagedCls(armed) + '">' + inner + '</div>'; }
