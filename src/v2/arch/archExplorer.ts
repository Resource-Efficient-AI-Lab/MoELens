/**
 * Faithful port of the Model Architecture explorer from the teammate's index_v2.html prototype
 * (its `boot(DATA)` function). The rendering is deliberately kept imperative and near-verbatim —
 * it fills the static shell that ArchitectureTab.tsx renders (same element IDs as the prototype)
 * — so this file stays diffable against the prototype and the teammate's future data drops in
 * without a rewrite.
 *
 * Adaptations for React hosting, and nothing else:
 *  - wrapped as `bootArchExplorer(DATA)` returning a cleanup function (timers, window listener);
 *  - handlers on PERSISTENT shell elements are assigned via `.onclick =` (idempotent across
 *    re-boots) instead of addEventListener, which would stack when the prompt changes or
 *    StrictMode double-runs the hosting effect;
 *  - the histogram modal (old Domain tab only) and the prompt-select wiring (owned by React)
 *    are dropped.
 *
 * DELIBERATE divergences beyond that, all of which should survive a diff against the prototype
 * (alongside the 1-based display numbering):
 *  - the four per-layer flow blocks are wrapped in a `.layer-stage` / `.layer-card` deck, and the
 *    ‹ › nav tucks the top card to the back of the deck with GSAP. The prototype has a flat row
 *    and no animation at all;
 *  - the All-tokens routing grid is colored ONE HUE PER TOKEN (see tokenColor / tokenRampColor)
 *    rather than the prototype's global blue-for-top-k / peach-for-the-rest, and its activated
 *    experts pop forward on a GSAP tween borrowed from the Domain tab's ExpertGrid (see popCells)
 *    while the rest of the row recedes. The grid stays a flat 1×64 strip either way.
 */
import gsap from 'gsap';
import type { PromptFlow } from './types';
import { sequentialBlue, tokenColorAt, tokenRampColor } from './colorRamps';
import {
  ATTN_STEPS_MHA, ATTN_STEPS_MOA, MASK_LEGEND, TRANSPOSE_NOTE,
  attnMapGrid, attnPanel, attnSubTabBar, beat, buildAttnGridHTML, buildGridHTML,
  buildHeadStripHTML, buildMaskGridHTML, buildStripHTML, diagramGrid, diagramRow, dotPhrase,
  escapeHtml, expertStripWithNumbers, matBlock, opSpan, padGridRows, resultBlock, wDims,
} from './mathDiagram';

/* eslint-disable @typescript-eslint/no-explicit-any */

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}

/** One math-modal stage's rendered content. Built here (string builders, as in the prototype) and
 *  handed to React, which owns whether the modal is open and commits this into the DOM. */
export interface StagePayload {
  /** Plain text for `#math-modal-title`. */
  title: string;
  /** HTML for `#math-modal-header-slot` — only stages with their own sub-tab bar fill it. */
  headerExtra: string;
  /** HTML for `#math-content`. */
  html: string;
}

/** What `onOpenStage` reports. `kind` is the one distinction React has to keep: a `flow` stage is
 *  built once and then left alone (a layer change under it must NOT rebuild it — that is today's
 *  behaviour and `buildFlowStage` nulls `selected` precisely to guarantee it), whereas a `cell`
 *  popup is re-reported by `setLayer` on every layer change and so does rebuild. */
export type OpenStage =
  | { kind: 'flow'; stageKey: string; attnTab: string; payload: StagePayload }
  | { kind: 'cell'; payload: StagePayload };

/** Which sub-tab the Router modal is showing. React owns it (`routerSubTab`); the island needs it
 *  only to decide whether it may size the modal, and receives it as a plain argument rather than
 *  reading React's `data-router-tab` attribute back off the DOM. */
export type RouterTabRegime = 'per-token' | 'all-tokens';

/** Small exposed API so the React modal shell can drive the (otherwise imperative) heatmap: the
 *  shared layer pager calls `setLayer`, and internal layer changes (▶ Step through layers, the
 *  flow ‹ › nav) report back through `onLayerChange` so React's `currentLayer` stays in sync. */
export interface ArchExplorerApi {
  /** Wires the just-committed stage's controls and starts its reveal. React calls this from an
   *  effect keyed on the payload, i.e. once per open, after the HTML is in the DOM. */
  mountStage: () => void;
  /** Kills any live attention reveal. React calls this from that effect's CLEANUP, so a timeline
   *  can never tween nodes the next render is about to replace, and on modal close. */
  killAttnTimeline: () => void;
  /** Hides the shared tooltip. Closing the math modal used to do this imperatively; React's close
   *  handler owns it now and must keep doing it, or a tip left over the modal outlives it. */
  hideTip: () => void;
  /** Highlights the guided tour's current block, or clears it with null. React owns tourOpen /
   *  tourStep; this stays here because it indexes `liveBlockEls()`, the positional list that skips
   *  the deck-swipe clone's blocks, and it also does the `scrollIntoView` that brings the block
   *  into the flow row's scroller. */
  highlightTourBlock: (step: number | null) => void;
  cleanup: () => void;
  setLayer: (layer: number) => void;
  /** Replays the All-tokens grid's activated-expert pop. The Router modal opens on the Per-token
   *  sub-tab, so the grid is behind display:none on arrival and its pop would otherwise have
   *  played unseen — the sub-tab button calls this instead. */
  replayPop: () => void;
  /** Re-fits the Router modal's height to the All-tokens heatmap, AND tells the island which sub-tab
   *  is showing. It is a no-op on 'per-token' (React owns the height there — see
   *  `fitGridModalHeight`), so React may call it on every sub-tab change; the regime it passes is
   *  also what the resize listener and the router-panel click will use until the next call. */
  fitGridHeight: (routerTab: RouterTabRegime) => void;
  /** Replays the All-tokens grid's routing animation. ▶ Replay routing is React-rendered chrome, so
   *  its click lands here rather than on an `onclick` this file assigns to a node it does not own. */
  animateRouting: () => void;
  /** Opens one of the flow row's math stages. The three blocks React renders (Embedding's token
   *  chips aside, which stay delegated on pdfRow) reach the same builders through here, so a
   *  React-owned block and an island-owned one open the modal by exactly one code path. */
  openStage: (stageKey: string) => void;
}

export function bootArchExplorer(
  DATA: PromptFlow,
  opts?: {
    onLayerChange?: (layer: number) => void;
    /** Every internal opener of the math modal (block clicks, token chips, the head ‹ ›, the
     *  routing-grid cell click) routes through here into React state. */
    onOpenStage?: (stage: OpenStage) => void;
  }
): ArchExplorerApi {
  const root = document.querySelector('.moe-root') as HTMLElement;
  const svg = byId<any>('moe-svg') as SVGSVGElement;
  const rowsLayer = byId<any>('rows-layer') as SVGGElement;
  const axisLayer = byId<any>('axis-layer') as SVGGElement;
  const animLayer = byId<any>('routing-anim-layer') as SVGGElement;
  const layerCaption = byId<any>('layer-caption') as SVGTextElement;
  const tooltip = byId('tooltip');
  const playBtn = byId<HTMLButtonElement>('play-btn');
  // `#animate-route-btn` (▶ Replay routing) is deliberately NOT resolved here any more: React owns
  // its click and calls `animateRouting` through the api. See that api member.

  // fresh slate: re-run whenever the prompt changes. The math modal is not closed here any more —
  // React owns it and resets `mathStage` alongside this boot (see ArchitectureTab), which it must,
  // or a stale stage would be left rendering HTML built from the previous prompt's closure.
  rowsLayer.innerHTML = '';
  axisLayer.innerHTML = '';
  byId('moe-grid-backdrop').classList.remove('open');

  // `#prompt-text` and the standalone "Parameter count" panel are React's now (2026-08-02).
  // Both were imperative writes from here: a `textContent` assignment wrapping `DATA.prompt` in
  // STRAIGHT double quotes, and a `renderParamCountPanel` IIFE with one innerHTML branch per
  // architecture. Neither reads per-layer or per-token state — only DATA fields and arithmetic —
  // so both belong to the render that already owns `flow`. The panel builder moved VERBATIM to
  // paramPanel.ts (`buildParamCountPanelHtml`), gated character-for-character against this code on
  // all three models before it was wired up; ArchitectureTab memoises it on `flow`.

  // One hue per token, and never a repeat (see colorRamps.ts). Bound here to `.moe-root` and this
  // prompt's token count, so the ~8 call sites below read exactly as they did when it was a closure.
  function tokenColor(i: number) { return tokenColorAt(root, i, DATA.tokens.length); }

  const tokens = DATA.tokens; // [{index, text}]
  const numTokens = tokens.length;
  const numExperts = DATA.num_experts;

  // ---- layout: one row per token, 64 cells across ----
  const labelW = 110;
  const areaX0 = labelW, areaX1 = 1030;
  const gap = 1;
  const cellW = (areaX1 - areaX0 - (numExperts - 1) * gap) / numExperts;
  const cellH = 24;
  const rowStride = 68;
  const rowY0 = 34;

  function rowTop(ti: number) { return rowY0 + ti * rowStride; }
  function cellX(expIdx: number) { return areaX0 + expIdx * (cellW + gap); }

  // ---- heatmap color ramps ----
  // hexToRgb / rgbToHex / lerpRgb / rgbToHsl / hslToHex and `tokenRampColor` (the one ramp every
  // router-probability view uses) now live in colorRamps.ts, unchanged.

  const NS = 'http://www.w3.org/2000/svg';
  function el(tag: string, attrs: Record<string, string | number>) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, String(attrs[k]));
    return e;
  }

  // ---- row labels (built once) ----
  tokens.forEach((t, ti) => {
    const y = rowTop(ti);
    const g = el('g', { class: 'token-row-label', 'data-token': ti, style: 'cursor:pointer' });
    const dot = el('circle', { cx: 6, cy: y + cellH / 2, r: 4, fill: tokenColor(ti) });
    const label = el('text', { class: 'row-label', x: 16, y: y + cellH / 2 + 4 });
    label.textContent = t.text.trim() || '(space)';
    g.appendChild(dot); g.appendChild(label);
    rowsLayer.appendChild(g);
  });

  // ---- axis ticks under the last row (built once) ----
  const axisY = rowTop(numTokens - 1) + cellH + 44;
  axisLayer.appendChild(el('line', { class: 'axis-line', x1: areaX0, y1: axisY - 8, x2: areaX1, y2: axisY - 8 }));
  for (let e = 0; e < numExperts; e += 8) {
    const x = cellX(e) + cellW / 2;
    const tick = el('text', { class: 'axis-tick', x, y: axisY + 6, 'text-anchor': 'middle' });
    tick.textContent = String(e + 1);
    axisLayer.appendChild(tick);
  }
  const lastTick = el('text', { class: 'axis-tick', x: cellX(numExperts - 1) + cellW / 2, y: axisY + 6, 'text-anchor': 'middle' });
  lastTick.textContent = String(numExperts);
  axisLayer.appendChild(lastTick);
  svg.setAttribute('viewBox', '0 0 1040 ' + (axisY + 20));

  // ---- size the "Expert Selection" modal to fit however many token rows this prompt has ----
  const gridModalEl = svg.closest('.math-modal') as HTMLElement | null;
  /** Which Router sub-tab is showing — the island's MIRROR of React's `routerSubTab`, pushed in
   *  through the `fitGridHeight` api member. Until 2026-08-02 `fitGridModalHeight` read this
   *  straight off the DOM (`gridModalEl.dataset.routerTab`), which made React's `data-router-tab`
   *  attribute a private channel between the two. React still writes that attribute — it is a
   *  state marker the test harness reads — but nothing in here reads it back.
   *
   *  ⚠ Initial value. A fresh boot cannot know React's, and 'per-token' is what `routerSubTab`
   *  holds on a first mount, so the boot-time fit below no-ops exactly as it did before. On a
   *  RE-boot with All-tokens showing this is briefly stale, and that is harmless BY CONSTRUCTION,
   *  not by luck: React's `[routerSubTab, flow]` effect is declared AFTER the boot effect, so on
   *  every prompt/model change it runs immediately after this file is re-entered and pushes the
   *  real regime before anything can be measured. Asserted in exercise-s5.mjs (C9). */
  let routerTab: RouterTabRegime = 'per-token';
  function fitGridModalHeight(tab: RouterTabRegime) {
    if (!gridModalEl) return;
    // This shrink-to-fit sizes the modal around the All-tokens heatmap SVG. On the Per-token
    // sub-tab that measurement means nothing — the fan is a different, taller thing — and a modal
    // fitted to a short heatmap would squeeze it. React owns maxHeight there (92vh), so bail out
    // rather than fight it. The regime arrives as an ARGUMENT now (see `routerTab` above).
    if (tab === 'per-token') return;
    const svgW = svg.getBoundingClientRect().width || 1040;
    const svgH = (axisY + 20) * (svgW / 1040); // rendered SVG height at its current display width
    const header = gridModalEl.querySelector('.math-modal-header');
    const body = gridModalEl.querySelector('.math-modal-body');
    const chromeH = (header ? header.getBoundingClientRect().height : 50) +
      (body ? parseFloat(getComputedStyle(body).paddingTop) + parseFloat(getComputedStyle(body).paddingBottom) : 20);
    let controlsH = 0;
    if (body) {
      ['.layer-bar', '.scale-legend'].forEach((sel) => {
        const el2 = body.querySelector(sel);
        if (el2) controlsH += el2.getBoundingClientRect().height;
      });
    }
    const needed = chromeH + controlsH + svgH + 24;
    gridModalEl.style.maxHeight = Math.min(needed, window.innerHeight * 0.92) + 'px';
  }
  /** ⚠ A STABLE zero-arg wrapper, and that is load-bearing. `fitGridModalHeight` takes an argument
   *  now, so it cannot be the listener itself; and a fresh arrow passed to `removeEventListener`
   *  in `cleanup` would not match the one registered here — `removeEventListener` returns silently
   *  when the reference differs, leaking one live listener per boot with no error anywhere. */
  const onGridResize = () => fitGridModalHeight(routerTab);
  fitGridModalHeight(routerTab);
  window.addEventListener('resize', onGridResize);

  // ---- isolation state ----
  // The token legend that used to sit above the grid (a swatch + label chip per token, each an
  // isolate toggle) was removed 2026-08-01: every row already carries its own hue on its label dot,
  // so the chips restated the colour key, and the row labels are the surviving isolate control.
  let isolated: number | null = null;

  // ---- current layer (the 1–16 pager now lives in the React modal shell; see ArchitectureTab) ----
  let currentLayer = 0;
  // This grid is the FFN router's, full stop. JetMoE's attention (MoA) router used to be a second
  // source behind a toggle in this modal's header — moved 2026-07-30 into the Attention block's own
  // math modal (step 2, "Expert routing"), where it belongs: it is part of attention, not of the
  // MoE block this modal opens from.
  // Base layer switch; composed with buildPdfBlocks after the flow section defines it (the
  // prototype reassigned the function binding — TS forbids that, hence the `let` wrapper).
  let setLayer = (l: number) => {
    currentLayer = l;
    render();
    animateRouting();
    renderMath();
    opts?.onLayerChange?.(l); // keep React's shared pager in sync
  };

  let playTimer: ReturnType<typeof setInterval> | null = null;
  function stopPlay() { if (playTimer) { clearInterval(playTimer); playTimer = null; playBtn.textContent = '▶ Step through layers'; } }
  playBtn.onclick = () => {
    if (playTimer) { stopPlay(); return; }
    playBtn.textContent = '⏸ Stop';
    // 3.5s a layer, not the prototype's 1.4s: each step fires the full routing animation (~1.4s of
    // traveling dots on the All-tokens grid) plus the per-token fan's beats, so the reader needs
    // the rest of the dwell to actually read the layer before it moves on.
    playTimer = setInterval(() => setLayer((currentLayer + 1) % DATA.num_layers), 3500);
  };

  // ---- tooltip ----
  function showTip(html: string, x: number, y: number) {
    tooltip.innerHTML = html;
    tooltip.style.left = (x + 14) + 'px';
    tooltip.style.top = (y + 14) + 'px';
    tooltip.style.opacity = '1';
  }
  function hideTip() { tooltip.style.opacity = '0'; }

  // ---- render cells + top-8 readouts for current layer ----
  const cellsLayer = el('g', { id: 'cells-layer' });
  rowsLayer.appendChild(cellsLayer);
  const readoutLayer = el('g', { id: 'readout-layer' });
  rowsLayer.appendChild(readoutLayer);

  // GSAP owns both the deck swipe and the All-tokens grid pop (both need interruptible
  // transforms), so the global prefers-reduced-motion CSS rule in index.css does NOT cover them —
  // gsap.matchMedia keeps this flag live instead, and reverts itself in cleanup(). Declared up
  // here rather than beside the swipe because render() below runs at boot, before that point.
  let reducedMotion = false;
  const swipeMM = gsap.matchMedia();
  swipeMM.add('(prefers-reduced-motion: reduce)', () => {
    reducedMotion = true;
    return () => { reducedMotion = false; };
  });

  // ---- the All-tokens grid's depth cue, borrowed from the Domain tab's ExpertGrid ----
  // Each row's activated experts pop forward while the rest of the field recedes. Two deliberate
  // departures from ExpertGrid's constants, both forced by the geometry (13.4px-wide cells butted
  // together with a 1px gap, versus that grid's 34px cells with a 4px gap):
  //  - the field recedes by OPACITY ONLY, never by scale. Shrinking a 13.4px cell would open
  //    ~1.3px on each side and break the strip into dashes; the row has to stay a solid band.
  //  - the drop-shadow is scaled to the smaller cell (2px/5px, not 4px/10px), which would
  //    otherwise be 75% of a cell's width and haze across two or three neighbours.
  // The scale itself is ExpertGrid's 1.12 unchanged — being proportional, it reads identically on
  // JetMoE's 114px cells and OLMoE's 13.4px ones.
  const CELL_POP = { scale: 1.12, filter: 'drop-shadow(0 2px 5px rgba(0,0,0,0.4))' };
  const CELL_POP_FROM = { scale: 1, filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))' };

  /** Replays the pop. `fromTo` (not `to`) so it re-fires even on an already-settled grid — the
   *  React sub-tab button calls this on arrival, when nothing has re-rendered. No-ops on
   *  DeepSeek's dense layer 1, where render() leaves the grid empty. */
  function popCells() {
    // The receding field is ONE group per row, not 56 individual cells: they all land on the same
    // opacity, so a group tween is visually identical and spares GSAP ~1,400 per-frame writes.
    const rest = cellsLayer.querySelectorAll('g.cell-rest');
    const tops = cellsLayer.querySelectorAll('g.cell-top');
    if (!tops.length && !rest.length) return;

    if (reducedMotion) {
      gsap.set(tops, { ...CELL_POP, transformOrigin: 'center center' });
      gsap.set(rest, { opacity: 0.55 });
      return;
    }
    // All cells fire together, no stagger — ▶ Replay routing already owns the sequential story
    // (it walks rows 220ms apart), and a second wave here would compete with it.
    gsap.fromTo(tops, CELL_POP_FROM, {
      ...CELL_POP, transformOrigin: 'center center',
      duration: 0.5, ease: 'back.out(2)', overwrite: 'auto',
    });
    gsap.fromTo(rest, { opacity: 1 }, {
      opacity: 0.55, duration: 0.45, ease: 'power2.out', overwrite: 'auto',
    });
  }

  /** Empties BOTH the cells and the per-row readouts — every path that wipes the grid goes through
   *  here, because a live tween writing to detached nodes would otherwise leak past the wipe
   *  (layer change, router swap, prompt re-boot). */
  function clearGrid() {
    gsap.killTweensOf(cellsLayer.querySelectorAll('g.cell-rest, g.cell-top'));
    cellsLayer.innerHTML = '';
    readoutLayer.innerHTML = '';
  }

  /** Row-label click dimming. Applied to the per-row groups rather than by re-rendering,
   *  so isolating a token does not re-fire the pop (it filters the view, it does not change the
   *  reading) and does not fight GSAP's inline opacity on the receded field. */
  function applyIsolate() {
    tokens.forEach((_t, ti) => {
      const dim = isolated !== null && isolated !== ti;
      cellsLayer.querySelector('g.token-cells[data-token="' + ti + '"]')
        ?.setAttribute('opacity', dim ? '0.25' : '1');
      readoutLayer.querySelector('.top8-readout[data-token="' + ti + '"]')
        ?.setAttribute('opacity', dim ? '0.3' : '1');
    });
  }

  function render() {
    const layer = DATA.layers[currentLayer];

    // DeepSeek dense layer (layers[0]): no router, no per-token routing — clear the grid and bail
    // before dereferencing layer.tokens (null here). OLMoE/JetMoE never hit this (tokens always set).
    if (!layer.tokens) {
      layerCaption.textContent = 'Layer ' + (currentLayer + 1) + ' of ' + DATA.num_layers +
        ': dense feed-forward layer, no router, no experts to score';
      clearGrid();
      return;
    }

    layerCaption.textContent = 'Layer ' + (currentLayer + 1) + ' of ' + DATA.num_layers +
      ': router softmax over all ' + DATA.num_experts + ' experts per token; lifted and numbered = top ' + DATA.top_k_experts + ' activated';

    clearGrid();

    tokens.forEach((_t, ti) => {
      const dim = isolated !== null && isolated !== ti;
      const tt = layer.tokens[ti];
      const y = rowTop(ti);
      const topSet = new Set(tt.top_experts);
      // One hue and one normalization for the whole row, so a cell's darkness reads as its share
      // of the router's attention on this token and nothing else (sqrt spreads the long tail).
      const hue = tokenColor(ti);
      const maxP = Math.max(...tt.all_probs, 1e-9);

      // Per-row group: carries the isolate dimming, so nothing has to re-render on a row-label click.
      const rowG = el('g', { class: 'token-cells', 'data-token': ti, opacity: dim ? 0.25 : 1 });
      // The 56 non-activated cells share one group (one GSAP target instead of 56, and identical
      // on screen because they all recede to the same opacity). It is appended FIRST so the
      // activated cells, which scale past their 1px gap, paint over it — SVG has no z-index.
      const restG = el('g', { class: 'cell-rest' });
      rowG.appendChild(restG);

      for (let e = 0; e < numExperts; e++) {
        const p = tt.all_probs[e];
        const isTop = topSet.has(e);
        const rect = el('rect', {
          class: 'expert-cell',
          x: cellX(e), y, width: cellW, height: cellH, rx: cellW > 6 ? 2 : 0,
          fill: tokenRampColor(hue, Math.sqrt(p / maxP)),
          stroke: 'var(--page)', 'stroke-width': 0.5,
        }) as SVGRectElement;
        rect.dataset.token = String(ti); rect.dataset.expert = String(e); rect.dataset.p = String(p); rect.dataset.top = isTop ? '1' : '0';

        if (!isTop) { restG.appendChild(rect); continue; }

        // An activated cell is wrapped with its number so the pop scales both together.
        const wrap = el('g', { class: 'cell-top' });
        wrap.appendChild(rect);
        const label = el('text', {
          class: 'cell-number', x: cellX(e) + cellW / 2, y: y + cellH / 2 + 3,
          'text-anchor': 'middle', 'paint-order': 'stroke',
          stroke: 'rgba(0,0,0,0.55)', 'stroke-width': 2,
          style: 'fill:#fff;',
        });
        label.textContent = String(e + 1);
        wrap.appendChild(label);
        rowG.appendChild(wrap);
      }
      cellsLayer.appendChild(rowG);

      // numeric readout of the real top-8 softmax values, sorted by weight
      const ordered = tt.top_experts.map((e: number, k: number) => ({ e, w: tt.top_weights[k] })).sort((a: any, b: any) => b.w - a.w);
      const parts = ordered.map((o: any, i: number) => (i === 0 ? '<tspan class="hi">' : '') +
        'e' + (o.e + 1) + ' ' + (o.w * 100).toFixed(1) + '%' + (i === 0 ? '</tspan>' : ''));
      const txt = el('text', { class: 'top8-readout', 'data-token': ti, x: areaX0, y: y + cellH + 13, opacity: dim ? 0.3 : 1 });
      txt.innerHTML = parts.join('&nbsp;&nbsp;·&nbsp;&nbsp;');
      readoutLayer.appendChild(txt);
    });

    popCells();
  }

  // ---- animated routing: a line + traveling dot from each visible token to each of its top-8 experts ----
  let routeTimers: ReturnType<typeof setTimeout>[] = [];
  function animateRouting() {
    animLayer.innerHTML = '';
    routeTimers.forEach(clearTimeout);
    routeTimers = [];
    const layer = DATA.layers[currentLayer];
    if (!layer.tokens) return; // DeepSeek dense layer — nothing to route
    const rowGap = 0.22, withinGap = 0.05, dur = 0.55, glowMs = 380;

    tokens.forEach((_t, ti) => {
      if (isolated !== null && isolated !== ti) return;
      const tt = layer.tokens[ti];
      const y = rowTop(ti);
      const startX = 6, startY = y + cellH / 2;
      const ordered = tt.top_experts.map((e: number, k: number) => ({ e, w: tt.top_weights[k] })).sort((a: any, b: any) => b.w - a.w);
      const color = tokenColor(ti);

      ordered.forEach((o: any, k: number) => {
        const endX = cellX(o.e) + cellW / 2, endY = y + cellH / 2;
        const begin = ti * rowGap + k * withinGap;
        const d = 'M ' + startX + ' ' + startY + ' L ' + endX + ' ' + endY;

        const path = el('path', { class: 'route-line', d, stroke: color });
        path.appendChild(el('animate', {
          attributeName: 'opacity', values: '0;0.85;0', keyTimes: '0;0.55;1',
          dur: dur + 's', begin: begin + 's', fill: 'freeze',
        }));
        animLayer.appendChild(path);

        const dot = el('circle', { class: 'route-dot', r: 3.2, fill: color, opacity: 0 });
        dot.appendChild(el('animateMotion', { path: d, dur: dur + 's', begin: begin + 's', fill: 'freeze' }));
        dot.appendChild(el('animate', {
          attributeName: 'opacity', values: '0;1;1;0', keyTimes: '0;0.08;0.85;1',
          dur: dur + 's', begin: begin + 's', fill: 'freeze',
        }));
        animLayer.appendChild(dot);

        const rect = cellsLayer.querySelector('.expert-cell[data-token="' + ti + '"][data-expert="' + o.e + '"]');
        if (rect) {
          routeTimers.push(setTimeout(() => {
            rect.classList.add('route-hit');
            routeTimers.push(setTimeout(() => rect.classList.remove('route-hit'), glowMs));
          }, (begin + dur) * 1000));
        }
      });
    });
  }
  // ▶ Replay routing's click used to be bound here (`animateBtn.onclick`). React renders that
  // button and now calls `animateRouting` through the api instead, so this file no longer reaches
  // into React-rendered modal chrome. The three INTERNAL callers are untouched: a layer change,
  // isolating a token, and opening the Router modal from the MoE block's router panel.

  svg.onmousemove = (ev: MouseEvent) => {
    const r = (ev.target as Element).closest('.expert-cell') as SVGRectElement | null;
    if (!r) { hideTip(); return; }
    const p = +(r.dataset.p || 0);
    showTip('<div class="t-title" style="margin:0">' + (p * 100).toFixed(2) + '%</div><div style="font-size:10px;color:var(--text-muted);margin-top:2px">click for full math</div>', ev.clientX, ev.clientY);
  };
  svg.onmouseleave = hideTip;

  // ---- matrix-math popup: click any cell to see a real, visual diagram of that computation ----
  // The only element of the math modal this file still holds: `wireDataTips` delegates from it,
  // and `wireMathSubTabs` queries within it. React owns the modal's open state, its title, its
  // header slot and the body's HTML — so this must stay MOUNTED at all times (only the `open`
  // class toggles), or this boot-time lookup would resolve against a node React later replaced.
  const mathContent = byId('math-content');
  let selected: { ti: number; e: number } | null = null;

  // ---- the math modals' diagram primitives (mathDiagram.ts) ---------------------------------
  // The builders that paint values used to close over `colorSequentialBlue` and `tokLabel`; they
  // take those as their first argument now, and these one-line wrappers bind them so every call
  // site below is unchanged. `colorSequentialBlue` is passed as a FUNCTION, never as a resolved
  // colour, so its --seq-100/--seq-700 read stays at call time and keeps tracking dark mode.
  function colorSequentialBlue(t: number) { return sequentialBlue(root, t); }
  // Tooltips go in a data-tip="" attribute (shown instantly via the shared #tooltip div — a
  // title="" would add the browser's fixed ~1s hover delay), so the label is quote-escaped and
  // every quotation mark around it in the tip strings (see mathDiagram.ts) is a curly one — a
  // straight " there closes the attribute and truncates the tooltip at the token name.
  function tokLabel(i: number) { return escapeHtml((tokens[i] && tokens[i].text.trim()) || '·').replace(/"/g, '&quot;'); }
  function gridHTML(grid: number[][], cellPx: number) { return buildGridHTML(colorSequentialBlue, grid, cellPx); }
  function attnGridHTML(grid: number[][], cellPx: number) { return buildAttnGridHTML(colorSequentialBlue, tokLabel, grid, cellPx); }
  function maskGridHTML(n: number, cellPx: number) { return buildMaskGridHTML(tokLabel, n, cellPx); }
  function headStripHTML(heads: number[][][], cellPx: number) { return buildHeadStripHTML(colorSequentialBlue, heads, cellPx); }
  function stripHTML(vec: number[], cw: number) { return buildStripHTML(colorSequentialBlue, vec, cw); }


  /** Builds the Router-cell popup for the currently-selected grid cell, or null when there is no
   *  selection (or the layer has no experts to select). Payload only — React commits it. */
  function buildMathCell(): StagePayload | null {
    if (!selected) return null;
    stageSkipReplay = false; // this stage has no attention panels, but never inherit a stale skip
    const { ti, e } = selected;
    const layer = DATA.layers[currentLayer];
    if (!layer.tokens) return null; // DeepSeek dense layer — no selectable experts
    const tt = layer.tokens[ti];
    const p = tt.all_probs[e];
    const topIdx = tt.top_experts.indexOf(e);
    const isTop = topIdx !== -1;
    const weight = isTop ? tt.top_weights[topIdx] : null;

    const H = DATA.hidden_size, I = DATA.intermediate_size, E = DATA.num_experts, K = DATA.top_k_experts;
    const tokenText = tokens[ti].text.trim() || '(space)';

    // headerExtra is '' below: this stage owns no sub-tab bar, and blanking the slot is what keeps
    // a previous stage's bar from outliving its panels.
    const title = '"' + tokenText + '" → expert #' + (e + 1) + ' · layer ' + (currentLayer + 1);

    const hVec = DATA.hidden_vectors[currentLayer][ti]; // real, downsampled
    const routerGrid = DATA.router_matrices[currentLayer]; // real, downsampled

    let html = '';
    html += '<div class="math-head">' +
      '<span class="chip">layer ' + (currentLayer + 1) + ' / ' + DATA.num_layers + '</span>' +
      '<span class="chip">expert #' + (e + 1) + '</span>' +
      '<span class="chip" style="border-color:' + (isTop ? 'var(--seq-500)' : 'var(--border)') + ';color:' +
      (isTop ? 'var(--seq-500)' : 'var(--text-secondary)') + '">' + (isTop ? 'activated' : 'not activated') + '</span>' +
      (isTop ? '<span class="chip" style="border-color:var(--seq-500);color:var(--seq-500);font-weight:750;">router weight: ' + ((weight as number) * 100).toFixed(2) + '%</span>' : '') +
      '</div>';

    // ---- sub-tabs: 1. Router / 2. Expert feed-forward ----
    html += '<div class="sub-tabs" id="math-sub-tabs">' +
      '<button class="sub-tab active" data-mtab="router" type="button">1. Router</button>' +
      '<button class="sub-tab" data-mtab="expert" type="button">2. Expert feed-forward' + (isTop ? '' : ' (skipped)') + '</button>' +
      '</div>';

    // ---- 1. Router diagram: real hidden vector × real W_router = real softmax probs ----
    html += '<div class="math-subtab-panel" id="math-subtab-router">';
    html += '<div class="math-block"><h3>1. Router</h3>';
    html += diagramRow([
      matBlock('hidden state h', '(1, ' + H + ')', stripHTML(hVec, 5)),
      opSpan('·'),
      matBlock('W_router', wDims(E, H), gridHTML(routerGrid, 5)),
      opSpan('='),
      matBlock('D = Softmax Output', '(1, ' + E + ')', expertStripWithNumbers(tokenColor(ti), tt.all_probs, tt.top_experts, 8, 22)),
    ], { nowrap: true });
    // The summation indexes the STORED matrix by (row = expert, col = dim), so it carries no ᵀ —
    // unlike the diagram above it, which is a matmul. See wDims / TRANSPOSE_NOTE.
    html += '<div class="math-eq wrap" style="font-size:9.5px;">∑<sub>d=1</sub><sup>' + H + '</sup> h<sub>d</sub>·W_router[e,d] → logits[e] &nbsp;<span class="op">then softmax →</span>&nbsp; probs[' + (e + 1) + '] = <span class="val">' + (p * 100).toFixed(3) + '%</span> &nbsp;<span class="op">top-' + K + ' →</span> ' +
      (isTop ? '<span class="val">selected, rank ' + (topIdx + 1) + '</span>' : '<span class="op">not selected</span>') + '</div>' +
      // This tab is the modal's default, so the convention has to be stated here too and not only on
      // step 2 — a reader who never opens step 2 still sees a ᵀ in the label above.
      '<p class="math-hint" style="margin:6px 0 0">' + TRANSPOSE_NOTE + '</p></div>';
    html += '</div>';

    // ---- 2. Expert FFN ----
    html += '<div class="math-subtab-panel" id="math-subtab-expert" style="display:none;">';
    if (isTop) {
      const gw = DATA.expert_weights[currentLayer + '_' + e];
      const outVec = DATA.expert_outputs[ti + '_' + currentLayer + '_' + e];
      html += '<div class="math-block"><h3>2. Expert #' + (e + 1) + ' feed-forward (SwiGLU): real weights, runs because it was selected</h3>';
      html += '<p class="math-hint" style="margin:0 0 4px;">Same input <b>h</b> is multiplied by two different weight matrices; the gated product is then projected back down to hidden size ' + H + '. Highlighted boxes are the result of each step. ' + TRANSPOSE_NOTE + '</p>';
      html += diagramGrid([
        [
          matBlock('h', '(1, ' + H + ')', stripHTML(hVec, 7), true),
          opSpan('·', true),
          matBlock('W_gate', wDims(I, H), gridHTML(gw.gate, 10), true),
          opSpan('→ SiLU →', true),
          resultBlock('gate = SiLU(h·W_gateᵀ)', '(1, ' + I + ')', '', true),
        ],
        [
          matBlock('h', '(1, ' + H + ')', stripHTML(hVec, 7), true),
          opSpan('·', true),
          matBlock('W_up', wDims(I, H), gridHTML(gw.up, 10), true),
          opSpan('=', true),
          resultBlock('up = h·W_upᵀ', '(1, ' + I + ')', '', true),
        ],
        [
          matBlock('gate ⊙ up', '(1, ' + I + ')', '', true),
          opSpan('·', true),
          matBlock('W_down', wDims(H, I), gridHTML(gw.down, 10), true),
          opSpan('=', true),
          resultBlock('expert output', '(1, ' + H + ')', stripHTML(outVec, 7), true),
        ],
      ], 5, { big: true });
      html += '<div class="math-eq wrap" style="font-size:11.5px;">contribution = <span class="val">' + ((weight as number) * 100).toFixed(2) +
        // JetMoE is top-2, so K − 1 is 1 — "the other 1 activated experts' outputs" reads as a bug.
        '%</span> <span class="op">×</span> expert output → summed with the other ' +
        (K - 1 === 1 ? 'activated expert’s output' : (K - 1) + ' activated experts’ outputs') +
        (DATA.shared_experts
          ? ', plus the ' + DATA.shared_experts + ' always-on shared experts (added gate-free)'
          : '') + '</div></div>';
    } else {
      html += '<div class="math-block"><h3>2. Expert #' + (e + 1) + ' feed-forward: skipped</h3>' +
        '<p class="math-hint" style="margin:0">Not in this token\'s top-' + K + ', so its feed-forward network is never evaluated for this token. That\'s the actual compute saving from sparse MoE routing.</p></div>';
    }
    html += '</div>';

    // DeepSeek's 2 shared experts run for every token on top of the top-K routed ones, so a bare
    // "only K of E experts run per token" here would contradict both the contribution line above and
    // the Parameter count panel it points the reader at ("6 routed + 2 shared").
    const sparsityPhrase = DATA.shared_experts
      ? 'only ' + K + ' of ' + E + ' routed experts run per token, plus the ' + DATA.shared_experts + ' always-on shared experts'
      : 'only ' + K + ' of ' + E + ' experts run per token';
    html += '<p class="math-hint" style="margin:4px 0 0">Grids above are real weights/activations from this model, downsampled for display. See the "Parameter count" panel near the top of the page for how sparsity (' + sparsityPhrase + ') shapes the model\'s total vs. active parameter count.</p>';

    return { title, headerExtra: '', html };
  }

  /** The Router-cell popup's own "1. Router / 2. Expert feed-forward" pills. Split out of
   *  `buildMathCell` so it can run from `mountStage` after React commits, and assigning `.onclick`
   *  rather than adding a listener (see `mountStage`). */
  function wireMathSubTabs() {
    const mtabBtns = [...mathContent.querySelectorAll('#math-sub-tabs .sub-tab')] as HTMLButtonElement[];
    mtabBtns.forEach((btn) => {
      btn.onclick = () => {
        mtabBtns.forEach((b) => b.classList.toggle('active', b === btn));
        mathContent.querySelectorAll('.math-subtab-panel').forEach((panel) => {
          (panel as HTMLElement).style.display = (panel.id === 'math-subtab-' + btn.dataset.mtab) ? '' : 'none';
        });
      };
    });
  }

  /** Rebuilds the open Router-cell popup against the current layer, if one is open. Called from
   *  `setLayer`, which is what keeps a cell popup live while ▶ Step through layers runs — the
   *  behaviour a flow stage deliberately does NOT have (`openFlowStage` nulls `selected`, so this
   *  early-returns and the flow stage's content stays as it was built). */
  function renderMath() {
    const built = buildMathCell();
    if (!built) return;
    opts?.onOpenStage?.({ kind: 'cell', payload: built });
  }

  svg.onclick = (ev: MouseEvent) => {
    const r = (ev.target as Element).closest('.expert-cell') as SVGRectElement | null;
    if (!r) return;
    selected ={ ti: +(r.dataset.token || 0), e: +(r.dataset.expert || 0) };
    renderMath(); // opens the modal through React — see the onOpenStage callback
  };
  // Closing (✕, backdrop click, Escape) is React state now; the header slot empties with it,
  // because React renders it from the payload and a closed modal has none.

  rowsLayer.onclick = (ev: MouseEvent) => {
    const g = (ev.target as Element).closest('.token-row-label') as SVGGElement | null;
    if (!g) return;
    const i = +(g.dataset.token || 0);
    isolated = isolated === i ? null : i;
    // applyIsolate, not render: isolating a token filters the view, it does not change the
    // reading, so the grid must not re-pop underneath the click.
    applyIsolate();
    animateRouting();
  };

  render();


  // ---- full transformer block walkthrough: horizontal ribbon diagram ----
  const flow = DATA.layer_flow;
  // OLMoE applies RMSNorm to Q and K before the head split; DeepSeek does not (has_qk_norm:
  // false). OLMoE's older trace predates the flag, so fall back to probing for its q_normed tensor.
  const hasQkNorm = flow.has_qk_norm ?? ('q_normed' in (flow.per_layer[0] || {}));
  const qkSplitOp = hasQkNorm ? '→norm→split→' : '→split→';
  // JetMoE's MoA is grouped-query attention: `num_attention_heads` is the model-wide query-head
  // count (32 = the top-2 attention experts × 16 query heads each), but the per-head tensors are
  // stored per attention expert, so anything indexing them must use the per-expert count (16).
  // Both selected experts read the same 16 shared K/V heads — that is the 2:1 grouping. Traces
  // written before the GQA fields existed carry num_attention_heads = 16 here, hence the fallback;
  // OLMoE/DeepSeek are plain MHA and never set num_query_heads_per_expert, so they are unaffected.
  const headsPerExpert = flow.num_query_heads_per_expert ?? flow.num_attention_heads;
  let flowToken = numTokens - 1; // which token a node/ribbon click focuses the popup on
  let flowHead = 0;
  let flowAttnExpert = 0; // JetMoE MoA: which of the focus token's selected attention experts is shown

  const pdfRow = byId('pdf-flow-row');
  const moeGridBackdrop = byId('moe-grid-backdrop');

  // Instant tooltips for data-tip cells (the attention map + mask M grids). Delegated on the two
  // stable containers — the cells themselves are rebuilt on every layer/head/prompt change, so a
  // per-cell listener would be lost on the next innerHTML swap. dataset.tip comes back decoded,
  // so it is re-escaped before it goes into the tooltip's innerHTML.
  const wireDataTips = (container: HTMLElement) => {
    container.addEventListener('mousemove', (ev: MouseEvent) => {
      const el = (ev.target as Element).closest('[data-tip]') as HTMLElement | null;
      if (!el) { hideTip(); return; }
      showTip('<div style="max-width:220px">' + escapeHtml(el.dataset.tip || '') + '</div>', ev.clientX, ev.clientY);
    });
    container.addEventListener('mouseleave', hideTip);
  };
  wireDataTips(pdfRow);
  wireDataTips(mathContent);

  // The live narration tables (narration.ts) are no longer read here at all: the guided tour card
  // is their only consumer and it is React now, so the per-model three-way pick moved there too
  // (`pickNarration`). The old inline per-block narration was removed long before that.
  // The "Transformer Block N" label + layer nav live up in the flow header (centered, level with
  // the Start-tour button); buildPdfBlocks fills it.
  const flowBlockLabelEl = byId('flow-block-label');
  /** The nine flow blocks in document order (0=Embedding … 7=Final RMSNorm, 8=Final Output),
   *  skipping the card
   *  snapshot that exists for ~360ms mid-swipe — its 6 blocks would otherwise shift every index
   *  that block selection and the guided tour depend on. */
  function liveBlockEls() {
    return [...pdfRow.querySelectorAll<HTMLElement>('.pdf-block')].filter((e) => !e.closest('.layer-card-outgoing'));
  }
  function selectBlockByIndex(idx: number) {
    liveBlockEls().forEach((blockEl, i) => blockEl.classList.toggle('selected', i === idx));
  }
  pdfRow.onclick = (ev: MouseEvent) => {
    // Embedding's token chips, DELEGATED here rather than wired per chip (2026-08-02). React owns
    // that block's markup now, so a per-chip `addEventListener` would have to be re-run after every
    // React commit that rewrites it — and the island has no hook for that. Delegation is the only
    // wiring that survives a React content write.
    // It also has to live INSIDE this handler, not beside it: a chip used to `stopPropagation()` so
    // that clicking one opens the embedding stage WITHOUT selecting the Embedding block. A React
    // `onClick` cannot do that — React attaches at the root, an ANCESTOR of pdfRow, so this native
    // listener would already have run and selected the block. Handling both cases in one place
    // keeps the original ordering exactly.
    const chip = (ev.target as Element).closest<HTMLElement>('.pdf-token-chip');
    if (chip) { flowToken = +(chip.dataset.tidx || 0); openFlowStage('embed'); return; }
    const blockEl = (ev.target as Element).closest<HTMLElement>('.pdf-block');
    if (!blockEl) return;
    selectBlockByIndex(liveBlockEls().indexOf(blockEl));
  };
  // Same reasoning for the popover clamp, which was a per-chip `mouseenter`. `mouseover` is the
  // delegable twin (it bubbles) and re-firing it on the chip's own children is harmless:
  // clampTokenPopover derives everything from the chip's untransformed geometry, so repeat calls
  // are idempotent — that is the very property its comment relies on to avoid compounding.
  // Assigned as a PROPERTY, not addEventListener: cleanup() does not unbind pdfRow, so a listener
  // would stack on every re-boot.
  pdfRow.onmouseover = (ev: MouseEvent) => {
    const chip = (ev.target as Element).closest<HTMLElement>('.pdf-token-chip');
    if (chip) clampTokenPopover(chip);
  };

  // ---- guided tour: the card is React (ArchitectureTab owns tourOpen/tourStep and renders the
  // overlay from narration.ts). What stays here is the block HIGHLIGHT, because it indexes
  // `liveBlockEls()` — the positional list that filters out the swipe clone's 6 blocks, which only
  // this file can compute. React drives it through `api.highlightTourBlock`.
  function pdfBlockEls() { return liveBlockEls(); }
  /** Which block index the tour is highlighting, or null for "no tour". A MIRROR of React's state,
   *  written only by `highlightTourBlock`.
   *  It exists so `buildPdfBlocks` can re-apply the highlight after it wipes and rebuilds the row
   *  (its trailing call below) WITHOUT a round trip into React: a callback would land after the
   *  rebuild rather than inside it, so the highlight would blink off for a frame, and it would mean
   *  setting React state from the middle of an imperative rebuild. */
  let tourHighlight: number | null = null;
  function applyTourHighlight() {
    const els = pdfBlockEls();
    els.forEach((tourEl, i) => tourEl.classList.toggle('tour-active', tourHighlight !== null && i === tourHighlight));
    if (tourHighlight !== null && els[tourHighlight]) els[tourHighlight].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  }

  function cssVar(name: string) { return getComputedStyle(root).getPropertyValue(name).trim(); }
  function eq(name: string, dim: string) { return '<span class="cell-name">' + name + '</span><span class="cell-dim">' + dim + '</span>'; }

  /** Flow connector: a straight arrow, drawn at 0.55 opacity by `.pdf-connector` in moe.css.
   *  DIVERGENCE from the prototype's `~` snake — with five blocks inside the card the row is
   *  denser, and a squiggle reads as decoration where a straight arrow reads as direction. Keep
   *  the opacity on the wrapper, not on these strokes, so both paths stay in step.
   *  Stroke is `--text-muted`, NOT the prototype's `--baseline`: at 0.55 the dark theme's
   *  `--baseline` (#383835 on a #1a1a19 surface) fades to nothing. `--text-muted` is the same
   *  grey in both themes, so one opacity works for both. */
  function flowConnector(shrinkable = false) {
    const s = el('svg', { width: 20, height: 54, viewBox: '0 0 20 54' });
    s.appendChild(el('path', { d: 'M 0 27 L 20 27', fill: 'none', stroke: 'var(--text-muted)', 'stroke-width': 2, 'stroke-linecap': 'round' }));
    s.appendChild(el('path', { d: 'M 15 22 L 20 27 L 15 32', fill: 'none', stroke: 'var(--text-muted)', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
    const wrap = document.createElement('div');
    wrap.className = 'pdf-connector' + (shrinkable ? ' shrinkable' : '');
    wrap.appendChild(s);
    return wrap;
  }

  // ---- residual skip arcs + layer loop-back (docs/notes/research/proposed-diagram.html) ----
  // The row was assembled strictly left to right with no return path, so two facts the whole
  // architecture turns on had nowhere to live: a block named "Residual" sitting in a straight pipe
  // cannot show what it is residual TO, and the recurrence was carried only by the header count,
  // the ghosts and the tuck — none of which say WHERE the next layer re-enters.
  // Orthogonal, not bezier: the `~` snake was deliberately dropped for straight arrows in
  // flowConnector above, so a curve here would reintroduce the language that was removed.
  const SKIP_LANE = 18;   // px below the card row where the two skip arcs run
  const LOOP_LANE = 22;   // px below the card where the loop-back runs (see .layer-stage margin)
  const ARC_R = 9;        // corner radius
  const SKIP_INK = 0.40;  // wrapper opacity — visibly subordinate to the 0.55 main flow line
  const LOOP_INK = 0.45;
  const LABEL_INK = 0.85; // lane captions read at this, independent of their arc's ink (laneLabel)
  // .pdf-connector padding-top + the arrow's y inside its 54px viewBox. Measured from the CARD's top
  // (== the flow row's top — the stage and card both start there), not the card row's: the in-card
  // connectors subtract the card's inset back out so all 8 arrows share one line. Fallback only —
  // drawFlowArcs reads the live value off a connector.
  const FLOW_Y = 46 + 27;

  /** Rounded orthogonal polyline through axis-aligned points. */
  function orthoPath(pts: { x: number; y: number }[], r: number) {
    let d = 'M ' + pts[0].x + ' ' + pts[0].y;
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i], a = pts[i - 1], b = pts[i + 1];
      const da = Math.hypot(p.x - a.x, p.y - a.y), db = Math.hypot(b.x - p.x, b.y - p.y);
      const rr = Math.max(0, Math.min(r, da / 2, db / 2));
      const ua = { x: (a.x - p.x) / (da || 1), y: (a.y - p.y) / (da || 1) };
      const ub = { x: (b.x - p.x) / (db || 1), y: (b.y - p.y) / (db || 1) };
      d += ' L ' + (p.x + ua.x * rr) + ' ' + (p.y + ua.y * rr);
      d += ' Q ' + p.x + ' ' + p.y + ' ' + (p.x + ub.x * rr) + ' ' + (p.y + ub.y * rr);
    }
    const z = pts[pts.length - 1];
    return d + ' L ' + z.x + ' ' + z.y;
  }
  /** The flowConnector arrowhead, rotated to point up at a block's bottom edge. */
  function arrowUp(x: number, y: number, w: number) {
    return el('path', {
      d: 'M ' + (x - 4.5) + ' ' + (y + 5.5) + ' L ' + x + ' ' + y + ' L ' + (x + 4.5) + ' ' + (y + 5.5),
      fill: 'none', stroke: 'var(--text-muted)', 'stroke-width': w,
      'stroke-linecap': 'round', 'stroke-linejoin': 'round',
    });
  }
  /** A `--surface-1` chip behind small caption text, so the stroke breaks rather than runs
   *  through the letters. Both the card and the panel are --surface-1, so one fill covers the
   *  in-card skip labels AND the loop caption, which sits outside the card over the panel.
   *  ⚠ `g` must be the LABEL group, never the arc group: group opacity composites the whole
   *  subtree, so a child can only ever reduce it — a divide-out (`LABEL_INK / ink`) inside the
   *  0.40 arc group clamps to 1 and leaves the caption at 0.40. Hence two sibling groups. */
  function laneLabel(g: Element, cx: number, cy: number, text: string, fs: number, weight: number) {
    const w = text.length * (fs * 0.57) + 14, h = fs + 7;
    g.appendChild(el('rect', { x: cx - w / 2, y: cy - h / 2, width: w, height: h, rx: 5, fill: 'var(--surface-1)' }));
    const t = el('text', {
      x: cx, y: cy + fs * 0.35, 'text-anchor': 'middle', fill: 'var(--text-muted)',
      'font-size': fs, 'font-weight': weight, 'font-family': 'inherit',
    });
    t.textContent = text;
    g.appendChild(t);
  }

  /** Redraw closure for the current row, re-run on window resize. Null before the first build. */
  let redrawFlowArcs: (() => void) | null = null;
  const onArcResize = () => { if (redrawFlowArcs) redrawFlowArcs(); };
  window.addEventListener('resize', onArcResize);

  /** Measure the live rects and (re)draw both overlays. MUST run after applyStageLock, which
   *  parks the stage out of flow to take its measurement — every rect is wrong mid-lock. */
  function drawFlowArcs(
    stage: HTMLElement, card: HTMLElement, cardRow: HTMLElement,
    skipSvg: SVGElement, loopSvg: SVGElement,
    ln1El: HTMLElement, add1El: HTMLElement, add2El: HTMLElement, finalNormEl: HTMLElement | null,
  ) {
    const cardBox = card.getBoundingClientRect();
    const stageBox = stage.getBoundingClientRect();
    if (!cardBox.width || !stageBox.width) return; // tab hidden; the stageH seed stands
    const rel = (box: DOMRect, host: DOMRect) => ({
      l: box.left - host.left, r: box.right - host.left, t: box.top - host.top, b: box.bottom - host.top,
    });

    // ---- skip arcs, owned by the card (they swipe away with it — they are one layer's internals)
    const ln1 = rel(ln1El.getBoundingClientRect(), cardBox);
    const add1 = rel(add1El.getBoundingClientRect(), cardBox);
    const add2 = rel(add2El.getBoundingClientRect(), cardBox);
    const row = rel(cardRow.getBoundingClientRect(), cardBox);
    // Publish the card's own inset (top border + padding) so the in-card connectors can subtract it
    // back out of their fixed 46px and draw on the SAME flow line as the row-level ones — see
    // `.layer-card-row .pdf-connector` in moe.css. row.t IS that inset, already measured here after
    // applyStageLock, and writing it cannot invalidate the rect it came from: cardRow's top does not
    // depend on its children's padding.
    // On pdfRow, NOT the card: buildPdfBlocks creates a fresh .layer-card every time, and a build
    // that lands while the arch tab is mounted-but-hidden returns above without measuring — that
    // card would then paint on the 11px CSS fallback. pdfRow persists, so every future card (and the
    // tuck's cloneNode) inherits the last real measurement from its first frame.
    pdfRow.style.setProperty('--card-inset', row.t + 'px');
    // Size the Final RMSNorm off the CARD ROW, not the card: it is a RMSNorm block and must be
    // exactly as tall as the two inside the card (2026-08-02, by request — at the card's height it
    // also swallowed the card's 38px skip lane and 10px top inset and loomed ~50px taller than its
    // own kind). `row` gives both halves at once and reuses the very inset the in-card connectors
    // subtract, so the two can't drift: marginTop = the card's top border + padding, so its top
    // edge lands on the in-card norms' top edge, and the height is the flex line they stretch to.
    // Consequence, not a bug: on DeepSeek this now RESIZES between the dense layer 1 and the MoE
    // layers, because the in-card norms do. A running max would put the overshoot straight back.
    // Written after the reads it depends on. It cannot invalidate the ones still to come either
    // (the connector rect below, measured against the cardBox captured at the top): the final norm
    // is now bounded by cardRow ≤ card ≤ stage + its loop margin, so it can never be the tallest
    // item in .pdf-flow-row and shrinking it moves neither the row nor the card.
    if (finalNormEl) {
      finalNormEl.style.height = (row.b - row.t) + 'px';
      finalNormEl.style.marginTop = row.t + 'px';
    }
    // Read the flow line off a real connector rather than re-deriving it from FLOW_Y, so the arcs
    // cannot drift from the arrows if that 46px ever changes. AFTER the write above: this
    // getBoundingClientRect flushes layout, so it already reflects the new padding.
    const connSvg = cardRow.querySelector('.pdf-connector svg');
    const flowY = connSvg ? rel(connSvg.getBoundingClientRect(), cardBox).t + 27 : FLOW_Y;
    const laneY = row.b + SKIP_LANE;

    skipSvg.innerHTML = '';
    const g = el('g', { opacity: SKIP_INK });
    // Captions live in their own group so they can read ABOVE the arc ink, and appended after so
    // their --surface-1 chips knock the stroke out from under the letters (SVG has no z-index).
    const gl = el('g', { opacity: LABEL_INK });
    skipSvg.appendChild(g);
    skipSvg.appendChild(gl);

    // The card's 12px left padding holds no drawn flow line, so a tap dot there would float in
    // space. Stub the main line in from the card's inner edge at the connectors' own net 0.55
    // (hence the divide-out below, since the wrapper <g> is already at SKIP_INK) and hang the
    // branch off that. Tap x is 6px clear of the block border: sitting ON it, the 1.5px grey
    // stroke vanished into RMSNorm's own 1.5px border.
    const tapX = ln1.l - 6;
    g.appendChild(el('path', {
      d: 'M 1 ' + flowY + ' L ' + ln1.l + ' ' + flowY, fill: 'none',
      stroke: 'var(--text-muted)', 'stroke-width': 2, 'stroke-linecap': 'round',
      opacity: Math.min(1, 0.55 / SKIP_INK),
    }));

    // add1 is both arc 1's destination and arc 2's origin. At a shared centre x their two vertical
    // legs land on the same 1.5px stroke and read as one line doubling back on itself — so split
    // them across the block: arrival left of centre, departure right of it, matching reading
    // order. Clamped to a quarter of the block's own width so the 44px thin block can't have its
    // legs pushed outside its border.
    const add1cx = (add1.l + add1.r) / 2;
    const split = Math.min(7, (add1.r - add1.l) / 4);
    const arcs = [
      // the layer input branches before the pre-attention norm and rejoins at the post-attention add
      { x1: tapX, y1: flowY, x2: add1cx - split, y2: add1.b, label: 'layer input' },
      // that add's own output branches again and rejoins at the post-MoE add
      { x1: add1cx + split, y1: add1.b, x2: (add2.l + add2.r) / 2, y2: add2.b, label: 'after attention' },
    ];
    for (const a of arcs) {
      g.appendChild(el('path', {
        d: orthoPath([{ x: a.x1, y: a.y1 }, { x: a.x1, y: laneY }, { x: a.x2, y: laneY }, { x: a.x2, y: a.y2 + 6 }], ARC_R),
        fill: 'none', stroke: 'var(--text-muted)', 'stroke-width': 1.5, 'stroke-linecap': 'round',
      }));
      g.appendChild(arrowUp(a.x2, a.y2 + 1, 1.5));
      // Tail is a filled dot, not an arrowhead: the stream BRANCHES there, it is not consumed.
      g.appendChild(el('circle', { cx: a.x1, cy: a.y1, r: 2.5, fill: 'var(--text-muted)' }));
      laneLabel(gl, (a.x1 + a.x2) / 2, laneY, a.label, 10.5, 500);
    }

    // ---- loop-back, owned by the STAGE so it does not swipe away with the top card: the loop is
    // the deck's property, not any one layer's. Legs align to the BLOCK centres (final Residual
    // down, first RMSNorm up) and stop at the card's bottom border, so it visibly connects those
    // two specific blocks without ever crossing into the card.
    const cardInStage = rel(cardBox, stageBox);
    const ln1s = rel(ln1El.getBoundingClientRect(), stageBox);
    const add2s = rel(add2El.getBoundingClientRect(), stageBox);
    const loopY = cardInStage.b + LOOP_LANE;
    const lx = (ln1s.l + ln1s.r) / 2, rx = (add2s.l + add2s.r) / 2;
    const last = currentLayer === DATA.num_layers - 1;

    loopSvg.innerHTML = '';
    // On the last layer the loop is genuinely not taken — fade it and say so, rather than drawing
    // a return path the model never follows.
    const loopInk = last ? Math.max(0.15, LOOP_INK - 0.2) : LOOP_INK;
    const lg = el('g', { opacity: loopInk });
    // Same two-group split as the skip arcs. The caption keeps the last layer's fade in proportion
    // rather than staying bright over a receded arc.
    const lgl = el('g', { opacity: LABEL_INK * (loopInk / LOOP_INK) });
    loopSvg.appendChild(lg);
    loopSvg.appendChild(lgl);
    lg.appendChild(el('path', {
      d: orthoPath([{ x: rx, y: cardInStage.b }, { x: rx, y: loopY }, { x: lx, y: loopY }, { x: lx, y: cardInStage.b + 6 }], ARC_R + 2),
      fill: 'none', stroke: 'var(--text-muted)', 'stroke-width': 2, 'stroke-linecap': 'round',
    }));
    lg.appendChild(arrowUp(lx, cardInStage.b + 1, 2));
    lg.appendChild(el('circle', { cx: rx, cy: cardInStage.b, r: 3, fill: 'var(--text-muted)' }));
    laneLabel(lgl, (lx + rx) / 2, loopY, last
      ? 'last layer · exits to Final Output'
      : 'repeats ×' + DATA.num_layers + ' · layer ' + (currentLayer + 2) + ' re-enters here', 11, 600);
  }

  interface PdfBlockOpts {
    title: string; accent: string; bg?: string; html?: string; popover?: string;
    popoverTitle?: string; hoverHint?: string; clickHint?: string; onClick?: (ev: MouseEvent) => void; extraClass?: string;
  }
  function pdfBlock({ title, accent, bg, html, popover, popoverTitle, hoverHint, clickHint, onClick, extraClass }: PdfBlockOpts) {
    const div = document.createElement('div');
    div.className = 'pdf-block' + (extraClass ? ' ' + extraClass : '');
    div.style.setProperty('--block-accent', accent);
    if (bg) div.style.setProperty('--block-bg', bg);
    div.innerHTML = '<h4>' + title + '</h4>' + (html || '') +
      (popover ? '<div class="pdf-hover-hint">' + (hoverHint || 'click to see ' + (popoverTitle || title)) + '</div><div class="pdf-popover"><h5>' + (popoverTitle || title) + '</h5>' + popover + '</div>' : '') +
      (clickHint ? '<div class="pdf-click-hint">' + clickHint + '</div>' : '');
    if (onClick) div.addEventListener('click', (ev) => { if (!(ev.target as Element).closest('.pdf-popover, .pdf-token-popover')) onClick(ev); });
    return div;
  }

  /** Keep a token chip's hover popover inside `.pdf-scroll`'s clip edge (2026-08-01).
   *  Measured at hover, not at build: the flow row shrinks with the viewport, so which chips
   *  overhang and by how much changes with every resize — a build-time offset would go stale.
   *  ⚠ The unshifted left edge is DERIVED from the chip (centre − half the popover's width), never
   *  read back off the popover's own rect. `.pdf-token-popover` transitions `transform` over 0.1s,
   *  so resetting `--pop-shift` to 0 and immediately measuring returns the transition's *starting*
   *  value — i.e. the previous hover's offset — and each hover compounds the last one. Chip
   *  geometry carries no transform, and `width` survives a translate untouched, so this reading is
   *  exact whatever the transition is doing.
   *  The popover is opacity: 0, not display: none, so it has a real width before it is ever shown —
   *  the one case where measuring a hidden element is safe (contrast ExpertGrid's pop, which reads
   *  zero under display: none).
   *  Clamped to `.pdf-scroll`, not the panel: `overflow: clip` cuts at the padding box, and
   *  `.pdf-scroll` has `margin: 0 -12px`, so it reaches 12px wider than the panel's content box. */
  function clampTokenPopover(chip: HTMLElement) {
    const pop = chip.querySelector('.pdf-token-popover') as HTMLElement | null;
    const clipBox = chip.closest('.pdf-scroll') as HTMLElement | null;
    if (!pop || !clipBox) return;
    const c = chip.getBoundingClientRect(), b = clipBox.getBoundingClientRect();
    const w = pop.getBoundingClientRect().width;
    const left = c.left + c.width / 2 - w / 2;
    const PAD = 4;
    // left-bound wins when the popover is wider than the clip box — a cut right edge on a strip
    // that reads left-to-right costs less than a cut label.
    let shift = 0;
    if (left < b.left + PAD) shift = b.left + PAD - left;
    else if (left + w > b.right - PAD) shift = b.right - PAD - (left + w);
    pop.style.setProperty('--pop-shift', shift.toFixed(1) + 'px');
  }

  // ---- the transformer-block deck: stage sizing + the ‹ › swipe ----
  // DELIBERATE DIVERGENCE from the prototype: the six per-layer blocks live inside one card on a
  // fixed-size stage, so stepping layers reads as swiping through a deck of N identical blocks.

  // The card is the same size on every layer within a model EXCEPT DeepSeek, whose layer 1 is a
  // dense FFN (240px .moe-block) while layers 2+ are MoE with a shared lane (440px). Lock the
  // stage to the widest/tallest layer so Embedding / Final Output never shift as you step.
  // Two things this must NOT do: size the stage from the card (the resting card is in flow, so
  // the stage would be measuring its own output), or lock the height with `height` rather than
  // `min-height` (a hard height lets `.pdf-block.thin`'s align-self:stretch overshoot on the
  // shorter dense card). Width IS locked with `width`, not `min-width`, so flex-shrink can still
  // compress the deck on a narrow viewport — a min-width would be an unbreakable floor and would
  // push Final Output past the panel's clip edge instead.
  let stageW = 0, stageH = 0;
  // The card's own box, kept beside the lock so the Final RMSNorm's seed can back the card chrome
  // out of stageH and land on the card ROW's height (see the seed below buildPdfBlocks's row).
  // Not a running max — they are constants of the CSS, identical on every layer and model.
  let cardPadY = 0, cardPadTop = 0;
  function applyStageLock(stage: HTMLElement, card: HTMLElement, cardRow: HTMLElement) {
    // Measure the card's NATURAL size: park the stage out of flow at max-content first, so a
    // narrow viewport can't compress the blocks into the reading and lock a too-small stage that
    // never recovers when the window widens (the running max can only grow, not shrink back).
    // ⚠ minHeight is cleared for the duration of the park (2026-08-02). The stage used to be a
    // FRESH element on every build, so it arrived here unlocked; React renders it once and it now
    // persists across every layer step, prompt and model. `.layer-stage` is a flex row and
    // `.layer-card` is a flex item at the default `align-items: stretch`, so a stale min-height
    // would stretch the card while it is being measured. It does not reach `cardRow` (the card sets
    // `align-items: flex-start`), which is why nothing visibly changed — but measuring a box the
    // previous model locked is a real difference, and this removes it. Re-set below, in the same
    // order, so the style attribute serializes identically.
    stage.style.minHeight = '';
    stage.style.position = 'absolute';
    stage.style.width = 'max-content';
    stage.style.visibility = 'hidden';
    const cs = getComputedStyle(card);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight) +
      parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) +
      parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    cardPadY = padY;
    cardPadTop = parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth);
    stageW = Math.max(stageW, Math.ceil(cardRow.offsetWidth + padX)); // running max — only grows
    stageH = Math.max(stageH, Math.ceil(cardRow.offsetHeight + padY));
    stage.style.position = '';
    stage.style.visibility = '';
    stage.style.width = stageW + 'px';
    stage.style.minHeight = stageH + 'px';
  }

  // Motion "A — Tuck" from docs/notes/deck-animations.html: the top card slides aside just far
  // enough to show there is a deck under it, then settles straight back into the bottom slot.
  // No lift, no tilt.
  const GHOST_X = 10; // per-slot horizontal inset — matches .layer-ghost
  const GHOST_Y = 7;  // per-slot vertical offset
  const REST_SHADOW = '0 2px 10px rgba(0, 0, 0, 0.05)';   // .layer-card at rest
  const LIFTED_SHADOW = '0 6px 18px rgba(0, 0, 0, 0.10)'; // the documented hover-lift rung
  // ⚠ DIVERGENCE from the prototype, which throws 15% of the card width and lets `overflow-x: clip`
  // cut the excursion off at the deck edge (deck-animations.html says so in as many words). The
  // card is exactly as wide as the stage, so any clip cuts ANY throw — and a cut card reads as a
  // broken/cropped block, not as motion. So: no clip on the stage (see .layer-stage in moe.css) and
  // a small FIXED throw that fits in the gap before Final Output. Fixed px also keeps the throw
  // feeling identical on JetMoE's narrow card and DeepSeek's wide one. The ceiling is the flow
  // row's 20px connector gap — measured identical on all three models and down to an 800px
  // viewport, since it is a fixed gap, not a fraction — so 18px clears Final Output everywhere.
  const THROW_PX = 18; // px the card travels sideways

  /** The transform that puts a full-width card exactly where ghost k sits. scaleX about the centre
   *  is exact, because the ghosts are inset equally on both sides. */
  function slot(k: number, w: number) {
    return { scaleX: (w - 2 * GHOST_X * k) / w, y: GHOST_Y * k };
  }

  let swipeTl: gsap.core.Timeline | null = null;
  let swipeStartRaf = 0;

  /** Idempotent: drops any outgoing clone and returns the live card to rest. Safe to call any
   *  time — mid-swipe interruption, timeline completion, or unmount. */
  function endSwipe() {
    if (swipeStartRaf) { cancelAnimationFrame(swipeStartRaf); swipeStartRaf = 0; }
    if (swipeTl) { swipeTl.kill(); swipeTl = null; }
    pdfRow.querySelectorAll('.layer-card-outgoing').forEach((n) => n.remove());
    pdfRow.querySelectorAll<HTMLElement>('.layer-card')
      .forEach((n) => gsap.set(n, { clearProps: 'transform,zIndex,boxShadow' }));
    pdfRow.querySelectorAll<HTMLElement>('.layer-card-row')
      .forEach((n) => gsap.set(n, { clearProps: 'opacity' }));
  }

  /** Deck tuck: snapshot the current card, let setLayer rebuild the row as it always has, then run
   *  the two cards through the slot choreography — forward, the snapshot goes aside and down into
   *  ghost 2 while the fresh card is promoted out of ghost 1; back, the true rewind, the fresh card
   *  is pulled out of the back slot sideways onto the top while the snapshot sinks into ghost 1. */
  function swipeToLayer(next: number) {
    next = Math.max(0, Math.min(DATA.num_layers - 1, next));
    if (next === currentLayer) return;
    const forward = next > currentLayer;
    const prevCard = pdfRow.querySelector<HTMLElement>('.layer-card');
    const clone = prevCard ? (prevCard.cloneNode(true) as HTMLElement) : null;
    const cloneRow = clone ? clone.querySelector<HTMLElement>('.layer-card-row') : null;
    if (clone) {
      clone.style.transform = ''; // drop any in-flight transform/shadow copied off prevCard
      clone.style.boxShadow = '';
      clone.classList.add('layer-card-outgoing');
    }
    if (cloneRow) cloneRow.style.opacity = '';
    endSwipe();
    setLayer(next); // unchanged path — rebuilds the row, syncs React, redraws the heatmap
    const stage = pdfRow.querySelector<HTMLElement>('.layer-stage');
    const card = stage ? stage.querySelector<HTMLElement>('.layer-card') : null;
    const cardRow = card ? card.querySelector<HTMLElement>('.layer-card-row') : null;
    if (!clone || !cloneRow || !stage || !card || !cardRow || reducedMotion) return;

    stage.appendChild(clone);
    const W = card.getBoundingClientRect().width;
    const s1 = slot(1, W), s2 = slot(2, W);
    // Built PAUSED and started two frames later, on purpose. setLayer() above costs ~55ms of
    // synchronous rebuild plus one ~90ms layout/paint frame, and GSAP charges that stall to the
    // timeline's clock: a live timeline is already ~85% through its first 0.20s tween by the time
    // anything paints, so on › the slide-aside never renders and the card just appears thrown.
    // (‹ hid it — the stall landed on the sink-into-ghost-1 beat, which barely moves.) The fromTo
    // start states still render immediately at creation, so the incoming card sits in its ghost
    // slot the whole time and there is no flash of it at rest.
    const tl = gsap.timeline({ paused: true, onComplete: endSwipe });
    if (forward) {
      // outgoing: aside, then down to the back slot
      tl.to(clone, { x: THROW_PX, boxShadow: LIFTED_SHADOW, duration: 0.20, ease: 'power2.out' }, 0)
        .set(clone, { zIndex: 0 }, 0.20)
        .to(clone, { x: 0, y: s2.y, scaleX: s2.scaleX, boxShadow: REST_SHADOW, duration: 0.26, ease: 'power2.inOut' }, 0.20)
        .to(cloneRow, { opacity: 0, duration: 0.18, ease: 'power1.in' }, 0.22)
        // incoming: promoted out of ghost 1
        .fromTo(card, { y: s1.y, scaleX: s1.scaleX }, { y: 0, scaleX: 1, duration: 0.30, ease: 'power3.out' }, 0.12)
        // Fade starts at 0.20 — the same beat the clone drops to z:0 — so the whole 0.2→1 ramp
        // happens in plain view, the way ‹'s does. Any earlier and it is wasted: the clone is
        // opaque at z:5 and only THROW_PX aside, so it covers nearly all of the incoming card until
        // that flip. Starting at 0.14 the card was already ~0.68 faded when the flip exposed it,
        // which read as a hard cut rather than a fade-in.
        .fromTo(cardRow, { opacity: 0.2 }, { opacity: 1, duration: 0.26, ease: 'power2.out' }, 0.20);
    } else {
      // outgoing sinks one slot into ghost 1
      tl.set(clone, { zIndex: 0 }, 0)
        .to(clone, { y: s1.y, scaleX: s1.scaleX, boxShadow: REST_SHADOW, duration: 0.26, ease: 'power2.inOut' }, 0)
        .to(cloneRow, { opacity: 0, duration: 0.18, ease: 'power1.in' }, 0)
        // incoming is pulled out from the back slot, sideways, then onto the top
        .fromTo(card, { y: s2.y, scaleX: s2.scaleX, x: 0 },
          { x: THROW_PX, boxShadow: LIFTED_SHADOW, duration: 0.24, ease: 'power2.out' }, 0.04)
        .to(card, { x: 0, y: 0, scaleX: 1, boxShadow: REST_SHADOW, duration: 0.26, ease: 'power2.inOut' }, 0.24)
        .fromTo(cardRow, { opacity: 0.2 }, { opacity: 1, duration: 0.26, ease: 'power2.out' }, 0.18);
    }
    swipeTl = tl;
    // Two frames: the first rAF still fires inside the frame that paints the rebuilt row, the
    // second is the first genuinely cheap frame — which is where the motion should start counting.
    swipeStartRaf = requestAnimationFrame(() => {
      swipeStartRaf = requestAnimationFrame(() => { swipeStartRaf = 0; tl.play(); });
    });
  }

  /** Rebuild the DECK — the six per-layer blocks, their card, the two ghosts and both overlays —
   *  into the `.layer-stage` React renders for us. It used to build the whole row: Embedding (0),
   *  Final RMSNorm (7) and Final Output (8) moved to React on 2026-08-02 (see flowBlocks.ts), which
   *  is why the wipe below is a targeted `stage.innerHTML` rather than the old `pdfRow.innerHTML`.
   *  Everything else about it is unchanged, deliberately — the stage lock, the Final RMSNorm's
   *  sizing and the arc draw must stay ONE synchronous sequence, in this order, right here.
   *  Kept its name: `buildPdfBlocks` is what CLAUDE.md and every call site below say. */
  function buildPdfBlocks() {
    const stage = pdfRow.querySelector<HTMLElement>('.layer-stage');
    if (!stage) return; // React has not committed the row yet — nothing to build into
    // The old `pdfRow.innerHTML = ''` wiped `.selected` (and `.tour-active`) off all nine blocks on
    // every layer step, head step and MoA-chip click. Blocks 0/7/8 are React's now and PERSIST, so
    // they would silently keep a stale selection. Clear it explicitly to match exactly what the
    // wipe did; `applyTourHighlight()` at the end of this function puts the tour's back.
    liveBlockEls().forEach((b) => b.classList.remove('selected', 'tour-active'));
    const lf = flow.per_layer[currentLayer];
    const H = DATA.hidden_size, nh = headsPerExpert;
    const blue = cssVar('--series-1');
    const yellow = cssVar('--series-3');
    const focusT = numTokens - 1; // the token whose output actually becomes the prediction
    // DeepSeek dense layer 1 (index 0) — no router, no experts. Read before the blocks are built:
    // the pre-MoE RMSNorm names the block it feeds, which is a dense FFN there.
    const denseHere = !DATA.layers[currentLayer].tokens;
    // Keep the in-flow attention heatmap width-bounded so longer prompts don't push the row
    // into horizontal scroll — shrink cells for prompts with more tokens, capped at 20px.
    // Then snap DOWN to a cell size `gridGap` (mathDiagram.ts) can give a device-px-exact pitch,
    // i.e. `cellPx ≡ 2 (mod 4)`. This grid is the one the reader sees WITHOUT opening anything, so
    // it wants the uniform tiles and solid dividers at least as much as the math modals do. Down,
    // never up: `(raw − 2)` caps the new pitch at one px per column above the old one (raw 20 → 18,
    // pitch 20 vs 21; 18 → 18, 20 vs 19; 16 → 14, 16 vs 17; 12 → 10, 12 vs 13), so the worst case in
    // the corpus is +14px on DeepSeek's 15-token prompt. Measured, and it does not move the block:
    // `.moe-combo` here is sized by its "rows = query token, cols = key token · hatched = masked
    // (causal)" caption (330px) with the widest grid at 300px, so the card row's min-content floor
    // (~1009–1025px, see CLAUDE.md) never sees this change. Do NOT relax it to snap upward — 22px
    // cells would put a 14-token grid at 336px and the caption would stop being the binding width.
    const attnCellRaw = Math.max(12, Math.min(20, Math.floor(280 / numTokens)));
    const attnCellPx = Math.max(10, Math.floor((attnCellRaw - 2) / 4) * 4 + 2);

    /** The SIX in-card blocks, in row order: RMSNorm → Attention → Residual → RMSNorm → MoE →
     *  Residual. These are row indices 1…6; blocks 0, 7 and 8 are React's (flowBlocks.ts), which is
     *  why this array is 6 long and every index below is one less than the row position. */
    const blocks: HTMLDivElement[] = [];

    // 2. RMSNorm (thin) — the PRE-attention norm, `layer.input_layernorm`.
    // DELIBERATE DIVERGENCE from the prototype, which folds this into the attention card. It is a
    // real per-layer step: without it the layer→layer loop reads `... Residual → Attention ...`
    // with no norm between, and the row shows one norm per layer where pre-norm transformers have
    // two. Hiding it is also what made the row internally inconsistent — the post-attention norm
    // WAS shown, so one router input (ln2_out) was visible and the other (ln1_out, which on JetMoE
    // feeds the MoA router as well as the attention experts) was not.
    blocks.push(pdfBlock({
      title: 'RMSNorm', accent: yellow, extraClass: 'thin',
      popoverTitle: 'RMSNorm (pre-attention)',
      popover: '<div class="dims">' +
        '<div>' + eq('residual in', '(' + numTokens + ',' + H + ')') + ' <span class="op">÷ RMS ⊙ γ →</span> ' + eq('normalized stream', '(' + numTokens + ',' + H + ')') + '</div>' +
        '<div class="foot-note">y = x / √(mean(x²)+ε) ⊙ γ. A side branch, not an update: attention reads this normalized copy while the residual stream itself is carried through untouched, to be added back one step later.</div></div>' +
        '<div class="grid-wrap">' + gridHTML(lf.ln1_out, 4) + '</div>',
      clickHint: 'click for full RMSNorm math',
      onClick: () => { flowToken = focusT; openFlowStage('ln1'); },
    }));

    // 3. Multihead Attention — compact card shows one head's real attention map at a time;
    // ‹ › steps through heads and stays in sync with flowHead, so the popup opens on the same head.
    if (flow.is_moa && DATA.attention_routing) {
      // JetMoE MoA: attention is a routed block. Show the focus token's top-2 attention experts as
      // selectable chips + the chosen expert's real attention map (per attn-expert, shared K/V).
      const ar = DATA.attention_routing;
      const arTok = ar.layers[currentLayer].tokens[focusT];
      const arOrdered = arTok.top_experts.map((e: number, k: number) => ({ e, w: arTok.top_weights[k] })).sort((a: any, b: any) => b.w - a.w);
      if (!arOrdered.some((o: any) => o.e === flowAttnExpert)) flowAttnExpert = arOrdered[0].e;
      const aef = flow.attn_expert_flow?.[currentLayer + '_' + flowAttnExpert];
      const chips = arOrdered.map((o: any) =>
        '<button class="moa-expert-chip' + (o.e === flowAttnExpert ? ' active' : '') + '" data-aexp="' + o.e + '" type="button">expert ' + (o.e + 1) + ' · ' + (o.w * 100).toFixed(0) + '%</button>').join('');
      blocks.push(pdfBlock({
        // Not "…router (…)" any more: the router is a step INSIDE this block's modal (step 2)
        // rather than a toggle over in the Router modal, so titling the whole block "router" made
        // the one visible part of it stand for all four steps.
        title: 'Attention (MoA) · ' + ar.num_experts + ' experts, top-' + ar.top_k, accent: blue, extraClass: 'moe-combo',
        html:
          '<div class="moe-combo-sec">' +
          '<div class="dims" style="margin-bottom:6px;text-align:center;">router picked ' + ar.top_k + ' of ' + ar.num_experts + ' attention experts for “' + escapeHtml(tokens[focusT].text.trim() || '·') + '”</div>' +
          '<div class="moa-expert-chips">' + chips + '</div>' +
          '<div class="no-cell-anim" style="display:flex;justify-content:center;margin-top:8px;">' + (aef ? attnGridHTML(aef.attn_probs_all_heads[flowHead], attnCellPx) : '') + '</div>' +
          '<div class="pdf-head-nav" style="margin-top:8px;">' +
          '<button id="attn-map-head-prev" type="button">‹</button>' +
          '<span>head ' + (flowHead + 1) + ' / ' + nh + '</span>' +
          '<button id="attn-map-head-next" type="button">›</button>' +
          '</div>' +
          '<div class="dims" style="margin-top:6px;text-align:center;">expert ' + (flowAttnExpert + 1) + ' · rows = query token, cols = key token · hatched = masked (causal)</div>' +
          '</div>',
        // Names the router explicitly: this block's modal is the only way to reach it now that the
        // Router modal's source toggle is gone.
        clickHint: 'click for the expert routing + the MoA attention calculation',
        onClick: (ev) => { const t = ev.target as Element; if (t.tagName !== 'BUTTON' && !t.closest('.moa-expert-chip')) { flowToken = focusT; openFlowStage('attn-only'); } },
      }));
    } else {
    blocks.push(pdfBlock({
      title: 'Multihead Attention + RoPE (' + nh + ' heads)', accent: blue, extraClass: 'moe-combo',
      html:
        '<div class="moe-combo-sec">' +
        '<div class="no-cell-anim" style="display:flex;justify-content:center;">' + attnGridHTML(lf.attn_probs_all_heads[flowHead], attnCellPx) + '</div>' +
        '<div class="pdf-head-nav" style="margin-top:8px;">' +
        '<button id="attn-map-head-prev" type="button">‹</button>' +
        '<span>head ' + (flowHead + 1) + ' / ' + nh + '</span>' +
        '<button id="attn-map-head-next" type="button">›</button>' +
        '</div>' +
        '<div class="dims" style="margin-top:6px;text-align:center;">rows = query token, cols = key token · hatched = masked (causal)</div>' +
        '</div>',
      clickHint: 'click to see Multihead Attention + RoPE calculation',
      onClick: (ev) => { if ((ev.target as Element).tagName !== 'BUTTON') { flowToken = focusT; openFlowStage('attn-only'); } },
    }));
    }

    // 4. Residual (thin) — after attention (h = x + a). Was fused with the norm below into one
    // "Residual + RMSNorm" block until 2026-07-29: the fused block straddled the seam between the
    // attention sub-block and the MoE one, so its own popover had to teach two unrelated operations
    // (an add and a normalization) under one title, and its grid showed only the norm's output —
    // the sum itself, the thing the `+` produces, was never on screen outside the math modal.
    // Split, each block owns one operation, one output grid and one math stage (add1 / ln2).
    // Accent follows the operation, not the position: adds take --text-secondary (matching the
    // post-MoE Residual), norms take yellow (matching the pre-attention RMSNorm).
    blocks.push(pdfBlock({
      title: 'Residual', accent: cssVar('--text-secondary'), extraClass: 'thin',
      popoverTitle: 'Residual (post-attention)',
      popover: '<div class="dims">' +
        '<div>' + eq('residual in', '(' + numTokens + ',' + H + ')') + ' <span class="op">+</span> ' + eq('attn output', '(' + numTokens + ',' + H + ')') + ' <span class="op">=</span> ' + eq('sum', '(' + numTokens + ',' + H + ')') + '</div>' +
        '<div class="foot-note">The skip connection: attention adds onto the stream it read instead of replacing it, which keeps earlier-layer information alive.</div></div>' +
        '<div class="grid-wrap">' + gridHTML(lf.after_attn_residual, 4) + '</div>',
      clickHint: 'click for full residual math',
      onClick: () => { flowToken = focusT; openFlowStage('add1'); },
    }));

    // 5. RMSNorm (thin) — the second per-layer norm, `layer.post_attention_layernorm`. This is the
    // vector the MoE router scores (ln2_out), so it opens the MoE sub-block.
    blocks.push(pdfBlock({
      title: 'RMSNorm', accent: yellow, extraClass: 'thin',
      popoverTitle: 'RMSNorm (pre-MoE)',
      popover: '<div class="dims">' +
        '<div>' + eq('sum', '(' + numTokens + ',' + H + ')') + ' <span class="op">÷ RMS ⊙ γ →</span> ' + eq('normalized stream', '(' + numTokens + ',' + H + ')') + '</div>' +
        '<div class="foot-note">y = x / √(mean(x²)+ε) ⊙ γ, with its own learned γ. Another side branch: this is what the ' + (denseHere ? 'feed-forward block' : 'MoE block and its router') + ' reads, while the residual stream is carried forward untouched.</div></div>' +
        '<div class="grid-wrap">' + gridHTML(lf.ln2_out, 4) + '</div>',
      clickHint: 'click for full RMSNorm math',
      onClick: () => { flowToken = focusT; openFlowStage('ln2'); },
    }));

    // 6. MoE Layer Visualization + Expert Activation, combined into one big block.
    // The outer block itself is inert (no click) — only the two sub-panels are clickable.
    // ROW index, which `selectBlockByIndex` and `liveBlockEls()` speak — hence the +1 over this
    // array's own index: Embedding is row 0 and is not in `blocks` any more.
    const moeLayerBlockIndex = blocks.length + 1;
    if (denseHere) {
      // DeepSeek dense layer — one monolithic feed-forward box, no router / no experts / no lane.
      const denseEntry = DATA.dense_ffn && DATA.dense_ffn[String(currentLayer)];
      const denseI = (denseEntry && denseEntry.intermediate_size) || DATA.intermediate_size;
      blocks.push(pdfBlock({
        title: 'Dense FFN', accent: cssVar('--light-red'), extraClass: 'moe-combo moe-block',
        html:
          '<p class="dims" style="margin:0 0 8px;">This layer is <b>dense</b>, no router. Every token runs through one shared SwiGLU feed-forward network (intermediate size ' + denseI + '). Click below for its full real math.</p>' +
          '<div class="moe-side-by-side">' +
          '<div class="moe-subpanel lightred" id="dense-ffn-panel" style="cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
          '<h5 style="margin:0;">Dense feed-forward</h5>' +
          '</div>' +
          '</div>',
      }));
    } else if (DATA.shared_experts) {
      // DeepSeek MoE layer — router + combined output + an always-on shared-expert lane.
      const S = DATA.shared_experts;
      const sharedCells = Array.from({ length: S }, (_, s) =>
        '<div class="shared-cell" title="Shared expert ' + (s + 1) + ': runs for every token">S' + (s + 1) + '</div>').join('');
      blocks.push(pdfBlock({
        title: 'MoE Layer', accent: cssVar('--light-red'), extraClass: 'moe-combo moe-block',
        html:
          '<p class="dims" style="margin:0 0 8px;">Every token is scored against all ' + DATA.num_experts + ' routed experts; only the top ' + DATA.top_k_experts + ' run, plus ' + S + ' always-on shared experts. Click any panel for its full real math.</p>' +
          '<div class="moe-side-by-side">' +
          '<div class="moe-subpanel lightred" id="moe-router-panel" style="cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
          '<div class="moe-subblock" style="border:none;cursor:pointer;">Router (Expert Selection)<span class="moe-subblock-pop"><b>Router (Expert Selection)</b>Scores this token against all ' + DATA.num_experts + ' routed experts: input (' + numTokens + ',' + H + ') × weights (' + H + ',' + DATA.num_experts + ') → softmax → top-' + DATA.top_k_experts + ' selected. Click to open the full grid: all ' + DATA.num_experts + ' experts × all tokens × all ' + DATA.num_layers + ' layers, with real router percentages for each.</span></div>' +
          '</div>' +
          '<div class="moe-subpanel lightred" id="moe-shared-panel" style="cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;">' +
          '<h5 style="margin:0;">Shared experts</h5>' +
          '<div class="shared-lane">' + sharedCells + '</div>' +
          '<div style="font-size:9px;color:var(--text-muted);text-align:center;line-height:1.3;">always on<br>each token</div>' +
          '</div>' +
          '<div class="moe-subpanel lightred" id="moe-combined-output-panel" style="cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
          '<h5 style="margin:0;">Combined Weighted Output</h5>' +
          '</div>' +
          '</div>',
      }));
    } else {
    blocks.push(pdfBlock({
      title: 'MoE Layer', accent: cssVar('--light-red'), extraClass: 'moe-combo moe-block',
      html:
        '<p class="dims" style="margin:0 0 8px;">Every token is scored against all ' + DATA.num_experts + ' experts; only the top ' + DATA.top_k_experts + ' actually run. Click either panel below for its full real math.</p>' +
        '<div class="moe-side-by-side">' +
        '<div class="moe-subpanel lightred" id="moe-router-panel" style="cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
        '<div class="moe-subblock" style="border:none;cursor:pointer;">Router (Expert Selection)<span class="moe-subblock-pop"><b>Router (Expert Selection)</b>Scores this token against all ' + DATA.num_experts + ' experts: input (' + numTokens + ',' + H + ') × weights (' + H + ',' + DATA.num_experts + ') → softmax → top-' + DATA.top_k_experts + ' selected. Click to open the full grid: all ' + DATA.num_experts + ' experts × all tokens × all ' + DATA.num_layers + ' layers, with real router percentages for each.</span></div>' +
        '</div>' +
        '<div class="moe-subpanel lightred" id="moe-combined-output-panel" style="cursor:pointer;display:flex;align-items:center;justify-content:center;">' +
        '<h5 style="margin:0;">Combined Weighted Output</h5>' +
        '</div>' +
        '</div>',
    }));
    }

    // 7. Residual (thin) — after MoE (out = h + m)
    blocks.push(pdfBlock({
      title: 'Residual', accent: cssVar('--text-secondary'), extraClass: 'thin',
      popoverTitle: 'Residual (post-MoE)',
      popover: '<div class="dims">' +
        '<div>' + eq('post-attn residual', '(' + numTokens + ',' + H + ')') + ' <span class="op">+</span> ' + eq('MoE output', '(' + numTokens + ',' + H + ')') + ' <span class="op">=</span> ' + eq('layer output', '(' + numTokens + ',' + H + ')') + '</div>' +
        '<div class="foot-note">' + (currentLayer === DATA.num_layers - 1
          ? 'Last layer, feeds the final RMSNorm + LM head next.'
          : 'Feeds layer ' + (currentLayer + 2) + '\'s RMSNorm as the new residual.') + '</div></div>' +
        '<div class="grid-wrap">' + gridHTML(lf.layer_output, 4) + '</div>',
      clickHint: 'click for full residual math',
      onClick: () => { flowToken = focusT; openFlowStage('add2'); },
    }));

    // 8. Final RMSNorm and 9. Final Output are React's — see flowBlocks.ts and ArchitectureTab.
    // They are the only blocks that read neither `currentLayer` nor the focus token, which is
    // exactly what lets them memoise on the prompt and sit outside this per-layer rebuild.

    // Embedding (0), Final RMSNorm (7) and Final Output (8) sit directly in the row; the six per-layer blocks
    // (RMSNorm → Attention → Residual → RMSNorm → MoE → Residual) go inside one card, on a stage
    // that also holds two decorative ghost edges — so the row reads "Embedding → [a deck of N
    // identical blocks] → Final Output" and ‹ › swipes between cards. The first RMSNorm belongs
    // INSIDE the card: it is `layer.input_layernorm`, so it fires once per layer like the other
    // five. Hoisting it out in front of the card would read as a one-time normalization after the
    // embedding. The "Transformer Block N of M" label + layer nav stay up in the flow header
    // (filled below), not in the card, so the six repeating blocks line up with Embedding/Final
    // instead of being pushed down by a label.
    // The stage element itself is React's (resolved at the top of this function); its CONTENTS are
    // entirely ours, so the wipe is the same total rebuild the old `pdfRow.innerHTML = ''` gave —
    // ghosts, card, both overlays — and it also drops any outgoing swipe clone, exactly as before.
    // Safe to do here: swipeToLayer snapshots the old card and calls endSwipe() BEFORE setLayer(),
    // and re-appends its clone after this returns.
    stage.innerHTML = '<div class="layer-ghost g2"></div><div class="layer-ghost g1"></div>';
    const card = document.createElement('div');
    card.className = 'layer-card';
    const cardRow = document.createElement('div');
    cardRow.className = 'layer-card-row';
    blocks.forEach((b, i) => {
      if (i > 0) cardRow.appendChild(flowConnector());
      cardRow.appendChild(b);
    });
    card.appendChild(cardRow);
    // Skip-arc overlay goes INSIDE the card, after the row, so the tuck's cloneNode(true) carries
    // a frozen copy of the arcs with the outgoing card.
    const skipSvg = el('svg', { class: 'skip-overlay' }) as unknown as SVGElement;
    card.appendChild(skipSvg);
    stage.appendChild(card);
    // ...and the loop overlay LAST in the stage, which is half of how it paints above ghost g1.
    // See .loop-overlay in moe.css — the z-index alone is not enough.
    const loopSvg = el('svg', { class: 'loop-overlay' }) as unknown as SVGElement;
    stage.appendChild(loopSvg);

    // The row's other six children — blocks 0/7/8 and the three fixed connectors around them —
    // are rendered by React and are already in the document by the time this runs.
    applyStageLock(stage, card, cardRow);
    // Re-queried per build, never cached at boot: React owns this element, so a cached reference
    // would go stale across a remount. Null-tolerant for the same reason.
    const finalNormEl = pdfRow.querySelector<HTMLElement>('.pdf-block.final-norm');
    // See .pdf-block.thin.final-norm in moe.css: it is opted out of the flex line's stretch, so it
    // needs an explicit height and top offset to sit level with the two RMSNorm blocks INSIDE the
    // card. Seeded from the lock here and refined from the card row's real rect in drawFlowArcs
    // below. Both, not either: this is a FLOOR, not the answer (applyStageLock measures at
    // `width: max-content`, where the row wraps less and comes out shorter than it renders in flow
    // — on DeepSeek's MoE layers that is a 32px gap), but it is the only figure available when the
    // arch tab is mounted-but-hidden behind the Domain tab and every getBoundingClientRect() reads
    // 0. stageH covers the whole card, so the card's own chrome comes back off: the in-card norms
    // stretch to the card ROW, which is stageH minus the padding and borders around it.
    // ⚠ Its geometry stays the DECK's, even though React renders the element: React gives it only
    // its class and `--block-accent`, and never a `height`/`marginTop` of its own, so these writes
    // survive every re-render (React's style diff only ever touches keys it knows about).
    if (finalNormEl) {
      finalNormEl.style.height = (stageH - cardPadY) + 'px';
      finalNormEl.style.marginTop = cardPadTop + 'px';
    }
    // After the lock, never before: applyStageLock parks the stage out of flow at max-content to
    // take its measurement, and every rect read mid-lock is the parked one.
    redrawFlowArcs = () => drawFlowArcs(stage, card, cardRow, skipSvg, loopSvg, blocks[0], blocks[2], blocks[5], finalNormEl);
    redrawFlowArcs();

    flowBlockLabelEl.innerHTML =
      '<button class="flow-nav-btn" id="flow-prev" type="button">‹</button>' +
      '<span class="title">Transformer Block ' + (currentLayer + 1) + ' of ' + DATA.num_layers + '</span>' +
      '<button class="flow-nav-btn" id="flow-next" type="button">›</button>';
    const flowPrevBtn = flowBlockLabelEl.querySelector<HTMLButtonElement>('#flow-prev');
    const flowNextBtn = flowBlockLabelEl.querySelector<HTMLButtonElement>('#flow-next');
    if (flowPrevBtn) {
      flowPrevBtn.disabled = currentLayer === 0;
      flowPrevBtn.onclick = () => swipeToLayer(currentLayer - 1);
    }
    if (flowNextBtn) {
      flowNextBtn.disabled = currentLayer === DATA.num_layers - 1;
      flowNextBtn.onclick = () => swipeToLayer(currentLayer + 1);
    }

    // The Embedding block's token chips are wired once, delegated on pdfRow — see its `onclick` /
    // `onmouseover` above. They used to be bound per chip here, which only worked because this
    // function rebuilt them on every call; React owns that block now.

    const combinedOutputPanel = document.getElementById('moe-combined-output-panel');
    if (combinedOutputPanel) {
      combinedOutputPanel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectBlockByIndex(moeLayerBlockIndex);
        openFlowStage('moe-combine-all');
      });
    }
    const routerPanel = document.getElementById('moe-router-panel');
    if (routerPanel) {
      routerPanel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectBlockByIndex(moeLayerBlockIndex);
        moeGridBackdrop.classList.add('open');
        fitGridModalHeight(routerTab);
        animateRouting();
      });
    }
    // DeepSeek: dense-layer FFN math + always-on shared-expert math (both open the shared math modal).
    const denseFfnPanel = document.getElementById('dense-ffn-panel');
    if (denseFfnPanel) {
      denseFfnPanel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectBlockByIndex(moeLayerBlockIndex);
        flowToken = focusT;
        openFlowStage('dense-ffn');
      });
    }
    const sharedPanel = document.getElementById('moe-shared-panel');
    if (sharedPanel) {
      sharedPanel.addEventListener('click', (ev) => {
        ev.stopPropagation();
        selectBlockByIndex(moeLayerBlockIndex);
        flowToken = focusT;
        openFlowStage('shared-experts');
      });
    }

    const attnHeadPrev = document.getElementById('attn-map-head-prev');
    const attnHeadNext = document.getElementById('attn-map-head-next');
    if (attnHeadPrev) attnHeadPrev.addEventListener('click', (ev) => { ev.stopPropagation(); flowHead = (flowHead - 1 + nh) % nh; buildPdfBlocks(); });
    if (attnHeadNext) attnHeadNext.addEventListener('click', (ev) => { ev.stopPropagation(); flowHead = (flowHead + 1) % nh; buildPdfBlocks(); });

    // JetMoE MoA: clicking an attention-expert chip switches which selected expert's map is shown.
    pdfRow.querySelectorAll('.moa-expert-chip').forEach((chip) => {
      chip.addEventListener('click', (ev) => {
        ev.stopPropagation();
        flowAttnExpert = +((chip as HTMLElement).dataset.aexp || 0);
        buildPdfBlocks();
      });
    });

    // Re-apply the tour highlight after the wipe, from the mirror — see `tourHighlight`. Inert
    // when no tour is running, and inert at boot for the same reason it always was.
    if (tourHighlight !== null) applyTourHighlight();
  }

  // Compose the flow rebuild onto every layer change (the prototype reassigned setLayer here).
  const baseSetLayer = setLayer;
  setLayer = (l: number) => { baseSetLayer(l); buildPdfBlocks(); };

  // Prime the stage lock before the first visible build so DeepSeek doesn't resize on its
  // dense→MoE step. buildPdfBlocks reads currentLayer from this closure, so drive that variable
  // directly — NOT setLayer, which would also redraw the heatmap and push the probe layer into
  // React via onLayerChange. buildPdfBlocks itself is side-effect-free here: `tourHighlight` is
  // still null at boot, so its trailing applyTourHighlight() is inert.
  const firstMoeLayer = DATA.layers.findIndex((l: any) => l.tokens);
  [...new Set([currentLayer, firstMoeLayer >= 0 ? firstMoeLayer : currentLayer])].forEach((l) => {
    const saved = currentLayer;
    currentLayer = l;
    buildPdfBlocks();
    currentLayer = saved;
  });
  buildPdfBlocks();

  /** Every close path funnels through here so ▶ Step through layers can't keep cycling layers
   *  (and re-rendering the flow row) behind a dismissed modal. */
  function closeMoeGrid() {
    stopPlay();
    moeGridBackdrop.classList.remove('open');
  }
  moeGridBackdrop.onclick = (ev) => { if (ev.target === moeGridBackdrop) closeMoeGrid(); };
  byId('moe-grid-close').onclick = closeMoeGrid;

  /** ε for the RMSNorm modals. Not in the trace files — it is a published config constant, not a
   *  measurement, so it is keyed off model_id instead of re-running three Colab sweeps for one
   *  scalar. Checked against each model's HF config.json (2026-08-02): DeepSeek-MoE-16B ships
   *  rms_norm_eps 1e-6; JetMoE-8B says 1e-5; OLMoE omits the field, taking the transformers
   *  OlmoeConfig default of 1e-5. */
  const RMS_EPS = /deepseek/i.test(DATA.model_id ?? '') ? '1e−6' : '1e−5';

  /** ALL tokens, matching the flow-block popover this modal opens from — x and the result are the
   *  whole (numTokens, H) block, so the modal is the popover's reading enlarged rather than a
   *  different one (it was a single (1, H) row until 2026-08-02). Same convention as the attention
   *  modal, which is batched over every token. γ is NOT a row of that block — it is a 1-D parameter
   *  of shape (H,), the same vector for every token and every prompt, broadcast down the rows, so it
   *  stays a strip beside two grids and its dim label carries no row count. Cell sizes are chosen so
   *  the strip is exactly one grid row wide: that alignment is what shows the broadcast.
   *  The `→ ÷ RMS → ⊙` operator is a label, not a grid: the per-row RMS is one scalar per token, so
   *  there is nothing to draw, but without it the diagram claimed x ⊙ γ = normalized — false
   *  arithmetic that contradicted the formula line right under it. */
  function rmsBlock(title: string, before: number[][], weight: number[], after: number[][], note?: string) {
    const dims = '(' + before.length + ', ' + DATA.hidden_size + ')';
    // Each drawn cell averages a bucket of channels (2048 → 20 columns on all three models), so a
    // reader must be told cell-by-cell arithmetic cannot reproduce the equation.
    const chansPerCell = Math.round(DATA.hidden_size / before[0].length);
    return '<div class="math-block"><h3>' + title + '</h3>' +
      diagramRow([
        matBlock('x (before)', dims, gridHTML(before, 5)),
        opSpan('→ ÷ RMS → ⊙'),
        matBlock('weight γ', '(' + DATA.hidden_size + ',)', stripHTML(weight, 5)),
        opSpan('='),
        matBlock('normalized stream', dims, gridHTML(after, 5)),
      ]) +
      '<div class="math-eq wrap">y = x / sqrt(mean(x²) + ε) ⊙ γ' + (note ? ' &nbsp;<span class="op">— ' + note + '</span>' : '') + '</div>' +
      '<p class="math-hint" style="margin:8px 0 0">One row per token. Each row is normalized by <b>its own</b> root-mean-square, taken over that row\'s ' + DATA.hidden_size + ' numbers alone, so tokens never mix here. <b>γ</b> is a single learned vector of ' + DATA.hidden_size + ' gains, the same one applied to every row. The grids and the γ strip are downsampled to fit: each cell is an average of ~' + chansPerCell + ' of the ' + DATA.hidden_size + ' channels, not a single number, so the formula holds for the real rows, not cell by cell on what is drawn.</p></div>';
  }

  /** Sub-tab + head-nav wiring, shared by both attention branches (it was duplicated verbatim in
   *  each). Runs from `mountStage`, which React calls from an effect once the modal's HTML has
   *  committed (it was a `setTimeout(…, 0)` at the end of each branch until 2026-08-02).
   *  `#attn-sub-tabs` is queried document-wide because the bar lives in the modal header, outside
   *  `#math-content`. */
  function wireAttnSubTabs() {
    const atabBtns = [...document.querySelectorAll('#attn-sub-tabs .sub-tab')] as HTMLButtonElement[];
    atabBtns.forEach((btn) => {
      btn.onclick = () => {
        atabBtns.forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-selected', String(b === btn)); });
        document.querySelectorAll('#math-content .math-subtab-panel[id^="attn-subtab-"]').forEach((panel) => {
          (panel as HTMLElement).style.display = (panel.id === 'attn-subtab-' + btn.dataset.atab) ? '' : 'none';
        });
        // Nothing re-renders here, only `display` flips — so each step's reveal is driven from this
        // click (and from the modal opening), not from build time. The outgoing step is snapped to
        // its end state first rather than left frozen part-drawn, then the incoming one plays.
        if (attnTl) attnTl.progress(1);
        // Entering a step from another step ALWAYS replays — only the head ‹ ›'s own rebuild opens
        // at rest. `stageSkipReplay` lives as long as the built stage does (so `mountStage` can be
        // re-run by React without burning it), so this is where it has to be dropped: without it,
        // one head ‹ › would leave every later step switch opening at rest too, for as long as the
        // modal stayed open.
        stageSkipReplay = false;
        playAttnStep();
      };
    });
  }
  /** ‹ › head stepper. It lives inside the attention-map step, so it re-opens on 'map' — it must
   *  pass that explicitly, the default is the first step ('proj'). */
  function wireAttnHeadNav() {
    const prevBtn = document.getElementById('pdf-head-prev'), nextBtn = document.getElementById('pdf-head-next');
    const nh = headsPerExpert;
    const step = (d: number) => (ev: Event) => {
      ev.stopPropagation();
      flowHead = (flowHead + d + nh) % nh;
      // Rebuilding re-enters step 3, but this is a comparison control, not a fresh entry: the new
      // head's numbers appear at rest instead of replaying the ~2.6s reveal on every click.
      skipAttnReplayOnce = true;
      openFlowStage('attn-only', 'map');
      buildPdfBlocks();
    };
    if (prevBtn) (prevBtn as HTMLElement).onclick = step(-1);
    if (nextBtn) (nextBtn as HTMLElement).onclick = step(1);
  }

  // ---- The Attention modal's staged reveals ----------------------------------------------------
  /* Every step of this modal reads left to right, but its grids used to arrive at once: `.mm-cell`
   * carries a CSS keyframe whose delay comes from `mmDelay`, which spreads a single grid over ≤260ms
   * and starts every grid on the panel at the same instant. Each step is a GSAP timeline instead —
   * scoped to THESE PANELS ONLY, which ship with `no-cell-anim`, so `mmDelay` and the `.mm-cell`
   * rule are untouched and every other grid in the app behaves exactly as it did.
   *
   * The beats per step, in the order the diagram is read. Rows that share a beat run simultaneously:
   *   1 proj   stream → (·, W) → (=, raw) → [→norm→, normed: OLMoE only] → →split→ → heads → rotate → post-RoPE
   *   2 route  stream row → (·, W_router) → → softmax → → probabilities            (JetMoE only)
   *   3 map    (Q, K) · → (ᵀ/√hd +, mask M) → → softmax → → attention map → its copy in row B →
   *            (·, V) → (=, head output)
   *   4 concat heads → (·, W_o) → [× weight: JetMoE] → [→ combine →: JetMoE] → attention output
   *
   * The offsets below are the BEAT SCHEDULE, not the wall-clock: every step is stretched by
   * `ATTN_STEP_EXTRA` at the end of `playAttnStep`, so what a reader sees is the schedule + 0.70s —
   * then multiplied by `ATTN_STEP_SLOW`, which is 1 everywhere except `concat`.
   * Measured totals (schedule → shipped): proj 2.58 → 3.28, and 3.13 → 3.83 on OLMoE, which alone
   * runs the `normop`/`normed` beats; route 1.38 → 2.08 (JetMoE only); map 3.22 → 3.92; concat
   * 2.20 → 3.92, and 2.66 → 4.54 on JetMoE, which alone runs `cweight`/`ccomb`.
   *
   * Four things this is built around, each of which has bitten this file before:
   * - **The sub-tab bar flips `display`; it does not re-render.** A panel is regularly built while
   *   another step is showing (the head ‹ › rebuilds the whole modal with step 3 active), so the
   *   play is driven from *becoming visible*, never from build time — `playAttnStep` finds whichever
   *   panel is currently displayed rather than being told which one to run.
   * - **Nothing here measures geometry.** Opacity and scale only, so a build under `display:none` is
   *   harmless (same trap as `replayPop`'s `getBBox`, which reads zero while hidden).
   * - **`openFlowStage` replaces `#math-content` wholesale**, so a live timeline would be writing to
   *   detached nodes and a re-open would stack two timelines on one selector. `killAttnTimeline`
   *   runs before every innerHTML swap and in `cleanup()`.
   * - **`.beat-armed` must always come off.** It is what paints the start state cheaply (see moe.css);
   *   a panel that keeps it renders blank. Every exit path below strips it, including reduced motion
   *   and the head-nav skip.
   *
   * Nothing tweened affects layout: cells are fixed-size grid children and operators are
   * `align-self:center` glyphs, so the column alignment `diagramGrid` and `attnMapGrid` exist for
   * cannot be disturbed. */
  let attnTl: gsap.core.Timeline | null = null;
  function killAttnTimeline() { if (attnTl) { attnTl.kill(); attnTl = null; } }
  const BEAT_CELL_FROM = { opacity: 0, scale: 0.4 };
  const BEAT_OP_FROM = { opacity: 0, scale: 0.8 };
  /** Seconds added to EVERY step of this modal, on top of the beat schedule below. See the
   *  `timeScale` at the end of `playAttnStep` for why it is applied there and not to the offsets. */
  const ATTN_STEP_EXTRA = 0.70;
  /** Per-step wall-clock multiplier, applied on top of `ATTN_STEP_EXTRA`. `concat` alone runs 35%
   *  slower (2026-08-01, by request): it is the one step whose beats are a *sweep* rather than a
   *  sequence of distinct operands — 16 head grids inside a single tagged block — so its readability
   *  is set by how fast the eye is dragged left to right, not by how long each element rests. A
   *  multiplier, not a bigger `ATTN_STEP_EXTRA` for this step: the two models' concat totals differ
   *  (JetMoE alone runs `cweight`/`ccomb`), and "35% slower" has to mean the same thing on both. */
  const ATTN_STEP_SLOW: Record<string, number> = { concat: 1.35 };
  /** Classes every attention step panel ships with: GSAP owns its cells, and they start hidden so
   *  the panel's first paint is already frame 0. */
  const ATTN_PANEL_CLS = 'no-cell-anim beat-armed';
  /** Set by the head ‹ › stepper only, and consumed by the very next play. That stepper rebuilds the
   *  whole modal, which would otherwise look like a fresh entry into step 3 and restart its ~3.3s
   *  reveal on every click — friction on the one control built for rapid comparison (2026-08-01, by
   *  request). Everything else about the step still replays: entering it from another step, and any
   *  layer / expert / prompt change. It is cleared where it is consumed so it can never leak into a
   *  later render. */
  let skipAttnReplayOnce = false;
  /** The built stage's own "open at rest" property, set from `skipAttnReplayOnce` by
   *  `buildFlowStage` and read — never cleared — by `playAttnStep`.
   *  ⚠ This indirection is what makes `mountStage` IDEMPOTENT, which it has to be now that React
   *  calls it: StrictMode runs every effect twice in dev, so a flag consumed by the first play
   *  would be gone by the second and the head ‹ › would replay the full ~3.9s reveal after all.
   *  It is cleared by the next build instead, i.e. by the next genuine open. */
  let stageSkipReplay = false;
  /** The visible step panel, or null. Only one is ever displayed. */
  function visibleAttnPanel(): HTMLElement | null {
    const panels = [...document.querySelectorAll('#math-content .math-subtab-panel[id^="attn-subtab-"]')] as HTMLElement[];
    return panels.find((p) => p.style.display !== 'none') || null;
  }
  function playAttnStep() {
    killAttnTimeline();
    const panel = visibleAttnPanel();
    if (!panel) return;
    // Arming is CSS-only, so dropping the class is all it takes to paint a step at rest — which is
    // exactly what the head-nav skip and the reduced-motion path want.
    const unarm = () => panel.classList.remove('beat-armed');
    if (stageSkipReplay) { unarm(); return; }
    // Reduced motion: GSAP is JS, so the global prefers-reduced-motion CSS rule does not cover it
    // (same reason the deck swipe carries its own flag). clearProps as well as unarm, for the case
    // where the setting flipped mid-play and left inline styles frozen part-way with no CSS
    // animation left to rescue them.
    if (reducedMotion) {
      unarm();
      gsap.set(panel.querySelectorAll('[data-beat], [data-beat] .mm-cell'), { clearProps: 'opacity,transform' });
      return;
    }
    const tl = gsap.timeline();
    attnTl = tl;
    /* `gridHTML` emits its cells row-major, so a plain DOM-order stagger IS the row-major sweep
     * (rows the outer loop, columns the inner). `amount` spreads a whole block over a fixed span, so
     * grids of different sizes each finish inside their own beat instead of the widest running long.
     * One tween per tagged block, all at the same timeline position — a single tween across every
     * block's cells would stagger them against each other, which is the opposite of the
     * "simultaneous" most beats want.
     * The one place that DOM order does more work: step 4's concatenated head strip is 16 grids
     * inside ONE tagged block, so a single stagger walks head 1's cells, then head 2's, and the
     * heads land left to right — which is the operation that step is named after (2026-08-01, by
     * request). Same shape gives JetMoE's two expert lanes simultaneously, since they are two
     * separate tagged blocks and therefore two tweens at one position. */
    const grids = (key: string, at: number, amount: number) => {
      let found = false;
      panel.querySelectorAll('[data-beat="' + key + '"]').forEach((b) => {
        const cells = b.querySelectorAll('.mm-cell');
        if (!cells.length) return;
        found = true;
        tl.fromTo(cells, BEAT_CELL_FROM, { opacity: 1, scale: 1, duration: 0.26, ease: 'power2.out', force3D: false, stagger: { amount } }, at);
      });
      return found;
    };
    /* Operators are the tagged element itself. They pop from 0.8, not the cells' 0.4: these glyphs
     * are 17–34px tall, and a scale that reads as a shimmer on a 4px cell reads as a bounce on the
     * 34px multiplication dot. */
    const ops = (key: string, at: number) => {
      const els = panel.querySelectorAll('[data-beat="' + key + '"]');
      if (!els.length) return false;
      tl.fromTo(els, BEAT_OP_FROM, { opacity: 1, scale: 1, duration: 0.3, ease: 'power2.out' }, at);
      return true;
    };
    let t = 0;
    const step = panel.id.slice('attn-subtab-'.length);
    if (step === 'proj') {
      grids('stream', t, 0.45);
      // The streams land before what multiplies them, so the `·` gets read as a sentence rather than
      // as two grids appearing side by side. Still one beat — the offset is 0.14s, not a pause.
      t += 0.14; ops('mul', t); grids('wmat', t, 0.36);
      // Both remaining pairs are OPTIONAL, and each gates the CURSOR on its own presence, not just
      // its tweens — an unconditional `t +=` would leave a trace that lacks the beat staring at a
      // static panel for the half-second the absent beat would have taken.
      //  - raw: pre-2026-08-01 traces have no `q_raw`/`k_raw`/`v_raw` and run `→split→` straight off
      //    the weight matrix (the live fallback the diagram itself falls back to).
      //  - normop/normed: OLMoE alone RMSNorms Q and K at full width before the head split
      //    (`has_qk_norm`), so it gets an extra beat here and everything after it slides.
      if (ops('eq', t + 0.48)) { grids('raw', t + 0.56, 0.42); t += 1.14; }
      if (ops('normop', t)) { grids('normed', t + 0.08, 0.36); t += 0.55; }
      ops('split', t);
      t += 0.14; grids('head', t, 0.32);
      t += 0.46; ops('rope', t);
      t += 0.12; grids('headpost', t, 0.32);
    } else if (step === 'route') {
      // JetMoE's attention router. `W_router` is optional in the trace (added 2026-07-31), and when
      // it is absent the diagram collapses `· W_router → softmax →` into ONE arrow — so the cursor
      // is gated the same way step 1 gates its raw pair, or the fallback would sit on a static
      // panel through a beat it never draws.
      grids('rstream', t, 0.30);
      if (ops('rmul', t + 0.14)) { grids('rw', t + 0.14, 0.36); t += 0.62; } else { t += 0.42; }
      ops('rsoft', t);
      t += 0.20; grids('rprobs', t, 0.30);
    } else if (step === 'map') {
      // Q and K are peers here, both operands of the same `·`, so they arrive together and the
      // operator follows — the same "operands, then the multiply between them" shape as step 1.
      grids('mq', t, 0.30); grids('mk', t, 0.30);
      t += 0.14; ops('mdot1', t);
      t += 0.28; ops('mscale', t); grids('mmask', t + 0.08, 0.34);
      t += 0.52; ops('msoft', t);
      // Row A's result, then row B's copy of it — one matrix drawn twice, revealed in that order
      // (2026-08-02, by request; they shared the `mmap` key and revealed together until then). The
      // 0.66 is EXACTLY row A's stagger (0.40) plus one cell's fade (0.26), so row B starts on the
      // frame row A finishes. That is what preserves the reason they were tied in the first place:
      // the same numbers are never on screen in two different states, which is what would say "two
      // measurements". Sequencing them instead reads as carrying the result down to the mask it was
      // carved by — which is what the shared column under `mask M` is for (see `attnMapGrid`).
      t += 0.16; grids('mmap', t, 0.40);
      t += 0.66; grids('mmap2', t, 0.40);
      t += 0.46; ops('mdot2', t); grids('mv', t + 0.08, 0.28);
      t += 0.38; ops('meq', t); grids('mout', t + 0.08, 0.28);
    } else if (step === 'concat') {
      // 0.90, the longest sweep in the modal: this one block is 16 head grids (960 cells on OLMoE,
      // ×2 lanes on JetMoE) and the sweep is what makes the heads read as landing one after another
      // rather than as one wall of colour. At step 1's 0.45 the 16 heads blur into a single wipe.
      grids('cheads', t, 0.90);
      t += 1.04; ops('cdot', t); grids('cwo', t + 0.08, 0.30);
      // Both JetMoE-only, and both gate the cursor: MHA goes straight from W_o to `=` + output.
      t += 0.48;
      if (ops('cweight', t)) t += 0.26;
      if (ops('ccomb', t)) t += 0.20;
      ops('ceq', t);
      t += 0.08; grids('cout', t, 0.34);
    }
    /* Every step runs `beats + ATTN_STEP_EXTRA` (2026-08-01, by request). Applied as a uniform
     * `timeScale` on the built timeline rather than as edits to the ~30 offsets above, because the
     * per-step totals are model-dependent (step 1 is half a second longer on OLMoE, which alone has
     * the `normop`/`normed` beats; step 4 is longer on JetMoE, which alone has `cweight`/`ccomb`), so
     * no set of literals yields the same addition everywhere. Scaling the whole timeline also keeps
     * every beat's share of the step exactly as designed — the alternative, padding one beat, is the
     * differential retuning the note above deliberately avoided. `d / (d + extra)` makes wall-clock
     * `d + extra`; the guard is for a childless timeline, where `timeScale(0)` would stall with no
     * visible symptom. Slower tweens also mean *less* per-frame work, so the heaviest panel
     * (JetMoE step 4, 2,320 cells) cannot regress from this. */
    const d = tl.duration();
    // `ATTN_STEP_SLOW` rides inside the same single `timeScale` as the extra, never as a second call
    // — `timeScale` is absolute, so a second one would replace the first rather than compound with it.
    if (d > 0) tl.timeScale(d / ((d + ATTN_STEP_EXTRA) * (ATTN_STEP_SLOW[step] ?? 1)));
    // Every tween above is a `fromTo`, which renders its from-state at creation regardless of where
    // it sits on the timeline — so by here each target carries the same values inline that
    // `.beat-armed` was painting from CSS, and the class has done its job. Dropping it now means the
    // final state depends only on the tween, never on a class that would re-hide the panel if
    // anything later cleared the inline styles.
    unarm();
    /* Click-to-finish, on every step. The modal opens on step 1, so every open of the Attention
     * block pays its full ~3.3s (~3.8s on OLMoE); a reader heading elsewhere should not have to sit
     * through it, and the same applies to re-entering any step. The listener dies with the panel at
     * the next innerHTML swap, and the `dataset` guard keeps repeat plays on one panel (clicking its
     * pill twice) from stacking listeners. */
    if (!panel.dataset.beatSkipWired) {
      panel.dataset.beatSkipWired = '1';
      panel.addEventListener('click', () => { if (attnTl) attnTl.progress(1); });
    }
  }

  /** `attnTab` names which step of the Attention modal opens (see ATTN_STEPS_*). Every opener that
   *  means "show me this block" leaves it at 'proj' — the block's first step, so the modal starts
   *  where the block does; the controls that live *inside* a step and re-render the modal (the head
   *  ‹ ›) pass their own step, so a click inside a step doesn't bounce the reader elsewhere.
   *  Ignored by every non-attention stage. */
  function buildFlowStage(stageKey: string, attnTab: string = 'proj'): StagePayload {
    // claim the shared math modal: invalidate any previously-selected Expert Selection
    // grid cell so a later automatic layer-change re-render (renderMath, e.g. from
    // "Step through layers" still running) can't silently overwrite this popup.
    // ⚠ This, and the `flowAttnExpert` reassignment in the MoA branch, are why this builder is NOT
    // pure and must be called once per open from an event handler — never during a React render,
    // where StrictMode's double invocation would run both side effects twice.
    selected = null;
    // Transfer the head ‹ ›'s one-shot flag onto the stage being built (see `stageSkipReplay`).
    stageSkipReplay = skipAttnReplayOnce;
    skipAttnReplayOnce = false;
    const ti = flowToken, li = currentLayer;
    const lf = flow.per_layer[li];
    const tokenText = tokens[ti].text.trim() || '(space)';
    const H = DATA.hidden_size;
    // The layer's residual-stream input: the embedding on layer 1, the previous layer's output after
    // that. Batched — the last per-token consumer (`beforeAll[ti]`) went with the Residual adds.
    const beforeAll = li === 0 ? flow.embed_strip : flow.per_layer[li - 1].layer_output;
    // Shared by every batched stage (RMSNorm, both Residual adds) so one edit can't leave two
    // diagrams disagreeing about the shape they are drawing.
    const allDims = '(' + numTokens + ', ' + H + ')';
    // Rendered into the modal header (level with ✕), not into the body — see attnSubTabBar().
    let title = '', html = '', headerExtra = '';

    if (stageKey === 'embed') {
      title = '"' + tokenText + '" · Token Embedding';
      html = '<div class="math-block"><h3>Embedding lookup</h3>' +
        diagramRow([
          '<div style="display:inline-block;padding:9px 18px;border-radius:8px;border:1.5px solid ' + cssVar('--series-4') + ';color:' + cssVar('--series-4') + ';font-weight:700;font-size:15px;">' + escapeHtml(tokenText) + '</div>',
          opSpan('→ row lookup →', false, true),
          matBlock('embedding vector', '(1, ' + H + ')', stripHTML(flow.embed_strip[ti], 5)),
        ], { align: 'center' }) +
        '<p class="math-hint" style="margin:8px 0 0">No matrix multiply here, just indexing one row out of the (vocab_size, ' + H + ') embedding table. This vector is what enters layer 1.</p></div>';
    } else if (stageKey === 'ln1') {
      // Batched, so the title names the token count rather than a token — nothing here is scoped to
      // flowToken any more (same shape as 'moe-combine-all').
      title = 'RMSNorm (pre-attention) · all ' + numTokens + ' tokens · layer ' + (li + 1);
      html = rmsBlock('RMSNorm', beforeAll, lf.ln1_weight, lf.ln1_out, 'ε = ' + RMS_EPS);
    } else if (stageKey === 'attn-only' && flow.is_moa && DATA.attention_routing) {
      // JetMoE MoA: attention router picked top-2 of 8 attention experts. Show the selected expert's
      // Q·Kᵀ→softmax→×V using its own W_q / W_o and the SHARED W_k / W_v. Same sub-tab / head-nav
      // element ids as the standard modal, so the shared wiring in the setTimeout below drives it too.
      const nh = headsPerExpert, hd = flow.head_dim;
      const ar = DATA.attention_routing;
      const arTok = ar.layers[li].tokens[ti];
      const arOrdered = arTok.top_experts.map((e: number, k: number) => ({ e, w: arTok.top_weights[k] })).sort((a: any, b: any) => b.w - a.w);
      if (!arOrdered.some((o: any) => o.e === flowAttnExpert)) flowAttnExpert = arOrdered[0].e;
      const E = flowAttnExpert;
      const aef = flow.attn_expert_flow?.[li + '_' + E];
      const aew = flow.attn_expert_weights?.[li + '_' + E];
      const selText = arOrdered.map((o: any) => 'expert ' + (o.e + 1) + ' ' + (o.w * 100).toFixed(1) + '%').join('  ·  ');
      // GQA: each selected expert owns `nh` query heads, and all of them read the same shared K/V
      // heads — so the model runs num_query_heads (top_k × nh) query heads over num_kv_heads.
      const gqaNote = flow.is_gqa
        ? ' Each selected expert runs its own <b>' + nh + ' query heads</b> against those same <b>' + flow.num_kv_heads +
          ' shared K/V heads</b>, so per token the model runs ' + flow.num_query_heads + ' query heads over ' +
          flow.num_kv_heads + ' K/V heads.'
        : '';
      title = 'Attention (MoA) · expert ' + (E + 1) + ' · layer ' + (li + 1);
      if (!aef || !aew) {
        html = '<div class="math-block"><h3>Attention expert ' + (E + 1) + '</h3><p class="math-hint" style="margin:0">No per-expert tensors available for this attention expert.</p></div>';
      } else {
        const aTab = ATTN_STEPS_MOA.some((s) => s.key === attnTab) ? attnTab : 'proj';
        headerExtra = attnSubTabBar(ATTN_STEPS_MOA, aTab);
        // The routing sentence used to live here in full; it is step 2's own panel now, so this
        // says only which expert the per-expert steps are following.
        html = '<p class="math-hint" style="margin:0 0 10px">Mixture-of-Attention: the router kept ' + ar.top_k + ' of ' + ar.num_experts + ' attention experts for “<b>' + escapeHtml(tokenText) + '</b>” (' + selText + '; see step 2). Showing <b>expert ' + (E + 1) + '</b>: its <b>W_q</b> and <b>W_o</b> are its own, but <b>W_k</b> and <b>W_v</b> are shared across every attention expert.' + gqaNote + '</p>';
        // Pre-split raw projections, the MoA counterpart of the MHA branch's `Q raw` blocks
        // (2026-07-31). Gated on presence with the bare `→split→` arrow as the LIVE fallback —
        // JetMoE prompt files predating the field still render, same pattern as the MoA router's
        // W_router grid in step 2. All three gate together so a row can never be half-drawn.
        // Q raw is per attention expert (its W_q is); K/V raw are shared, and the labels have to
        // say so or the expert-scoped row would read as if everything on it were shared.
        // Widths come from the model's own head scalars, never H: they are equal on JetMoE
        // (16 kv heads × 128 = 2048 = H) but that is a config coincidence, not an identity.
        const nkvH = flow.num_kv_heads ?? nh;
        const showRawMoa = !!(aef.q_raw && lf.k_raw && lf.v_raw);
        // `beat(...)` tags each cell for the reveal timeline (playAttnStep). On the
        // fallback path there is no `=`/raw pair, so that beat is simply absent and the timeline
        // closes up — the tags name elements, not columns.
        const rawSplit = (label: string, raw: number[][] | undefined, cols: number) =>
          showRawMoa && raw
            ? [beat('eq', opSpan('=')), beat('raw', matBlock(label, '(' + numTokens + ',' + cols + ')', gridHTML(raw, 4))), beat('split', opSpan('→split→'))]
            : [beat('split', opSpan('→split→'))];
        // Column-aligned like the MHA branch's step 1 (2026-08-01, by request): the three rows share
        // one schema — stream · W = raw →split→ head [rotate head] — and V, which takes no RoPE, gets
        // its two trailing columns padded by `padGridRows` instead of centring itself out of line.
        const moaProjGrid = padGridRows([
          [beat('stream', matBlock('normalized stream', '(' + numTokens + ',' + H + ')', gridHTML(lf.ln1_out, 4))), beat('mul', opSpan('·')), beat('wmat', matBlock('W_q (expert ' + (E + 1) + ')', '(' + H + ',' + H + ')', gridHTML(aew.q, 5)))]
            .concat(rawSplit('Q raw (expert ' + (E + 1) + ')', aef.q_raw, nh * hd))
            .concat([beat('head', matBlock('Q head ' + (flowHead + 1) + ' (pre-RoPE)', '(' + numTokens + ',' + hd + ')', gridHTML(aef.q_by_head_prerope[flowHead], 10))), beat('rope', opSpan('rotate (RoPE) →')), beat('headpost', matBlock('Q head ' + (flowHead + 1) + ' (post-RoPE)', '(' + numTokens + ',' + hd + ')', gridHTML(aef.q_by_head[flowHead], 10)))]),
          [beat('stream', matBlock('normalized stream', '(' + numTokens + ',' + H + ')', gridHTML(lf.ln1_out, 4))), beat('mul', opSpan('·')), beat('wmat', matBlock('W_k (shared)', '(' + H + ',' + H + ')', gridHTML(lf.k_weight, 5)))]
            .concat(rawSplit('K raw (shared)', lf.k_raw, nkvH * hd))
            .concat([beat('head', matBlock('K head ' + (flowHead + 1) + ' (pre-RoPE)', '(' + numTokens + ',' + hd + ')', gridHTML(lf.k_by_head_prerope[flowHead], 10))), beat('rope', opSpan('rotate (RoPE) →')), beat('headpost', matBlock('K head ' + (flowHead + 1) + ' (post-RoPE)', '(' + numTokens + ',' + hd + ')', gridHTML(lf.k_by_head[flowHead], 10)))]),
          [beat('stream', matBlock('normalized stream', '(' + numTokens + ',' + H + ')', gridHTML(lf.ln1_out, 4))), beat('mul', opSpan('·')), beat('wmat', matBlock('W_v (shared)', '(' + H + ',' + H + ')', gridHTML(lf.v_weight, 5)))]
            .concat(rawSplit('V raw (shared)', lf.v_raw, nkvH * hd))
            .concat([beat('head', matBlock('V head ' + (flowHead + 1), '(' + numTokens + ',' + hd + ')', gridHTML(lf.v_by_head[flowHead], 10)))]),
        ]);
        html += attnPanel('proj', aTab,
          '<div class="math-block"><h3>1. Project to Q / K / V: expert ' + (E + 1) + '\'s own W_q, shared W_k / W_v, split into ' + nh + ' query heads / ' + nkvH + ' shared K/V heads of ' + hd + ' dims, then RoPE</h3>' +
          diagramGrid(moaProjGrid.rows, moaProjGrid.cols, { colGap: 10, rowGap: 18, center: true }) +
          '<div class="math-eq wrap">' +
          (showRawMoa ? 'Each projection lands at its full width first (that is what “Q raw” / “K raw” / “V raw” are above), and only then is it reshaped into heads of ' + hd + ' dims. ' : '') +
          'Only <b>W_q</b> (and W_o in step 4) belong to expert ' + (E + 1) + '; <b>W_k</b> and <b>W_v</b> are shared by all ' + ar.num_experts + ' attention experts, so K and V are computed once and reused. RoPE rotates Q and K only.</div></div>',
          ATTN_PANEL_CLS);

        // ---- 2. Expert routing — the attention (MoA) router itself. Lived behind a "FFN router /
        // Attention (MoA) router" toggle in the Router modal (which opens from the MoE block) until
        // 2026-07-30; it is attention's own router, so it is a step of the attention block instead.
        // W_router is the real MoA weight matrix (attention_routing.router_matrices, added to the
        // extraction 2026-07-31 — attn_expert_weights carries only q and o). It is OPTIONAL: traces
        // extracted before that field existed fall back to the arrow this step shipped with, so the
        // grid, the operator symbols and the closing sentence all switch together on `arW`.
        // DO NOT substitute the top-level `router_matrices` when it is missing — that is in scope,
        // it renders plausibly, and it is the FFN router's weights.
        const arW = ar.router_matrices?.[li];
        const probList = arTok.all_probs.map((p: number, i: number) => {
          const rank = arOrdered.findIndex((o: any) => o.e === i);
          return '<span style="white-space:nowrap;' + (rank >= 0 ? 'font-weight:750;color:' + cssVar('--series-1') + ';' : 'color:var(--text-secondary);') + '">' +
            'expert ' + (i + 1) + ' <span class="val">' + (p * 100).toFixed(1) + '%</span>' + (rank >= 0 ? ' (rank ' + (rank + 1) + ')' : '') + '</span>';
        }).join('<span class="op" style="margin:0 7px;">·</span>');
        // Display-only, by request (2026-07-30): these were buttons that re-pointed the modal at the
        // other selected expert. They are the router's *result* — the two experts it kept — so they
        // read as a reading, not a control; the live picker is the attention block's own chips out
        // on the flow row (which means closing the modal to switch). Spans, not `<button disabled>`:
        // UA greying would say "temporarily unavailable" about live numbers. No `data-aexp` either,
        // so nothing here looks wired.
        const routeChips = arOrdered.map((o: any) =>
          '<span class="moa-expert-chip static' + (o.e === E ? ' active' : '') + '">expert ' + (o.e + 1) + ' · ' + (o.w * 100).toFixed(1) + '%</span>').join('');
        html += attnPanel('route', aTab,
          '<div class="math-block"><h3>2. Expert routing: one router scores all ' + ar.num_experts + ' attention experts, the top ' + ar.top_k + ' run</h3>' +
          '<p class="math-hint" style="margin:0 0 10px">Before any attention happens, a small router reads the same normalized stream the experts read (<b>ln1_out</b>, one row per token), scores every attention expert against it and softmaxes those scores. The other ' + (ar.num_experts - ar.top_k) + ' experts are never evaluated for this token: no Q projection, no attention map, nothing. That is the compute saving, on the attention side rather than the feed-forward side.</p>' +
          diagramRow([
            beat('rstream', matBlock('normalized stream row for “' + escapeHtml(tokenText) + '”', '(1, ' + H + ')', stripHTML(lf.ln1_out[ti], 7))),
            // Same 7px cell as the stream strip it multiplies, the way the FFN Router modal matches
            // its own operands at 5px. Rows are unbucketed in the data, so the 8 rows here ARE the 8
            // experts; only the 2048 columns are downsampled.
            // Beat tags: with the grid present this is three beats' worth of elements; on the
            // fallback the single combined arrow takes the `rsoft` key, so the sequence still has a
            // beat there and only the `rmul`/`rw` pair goes missing (playAttnStep gates on it).
            ...(arW
              ? [beat('rmul', opSpan('·')),
                 beat('rw', matBlock('W_router', wDims(ar.num_experts, H), gridHTML(arW, 7))),
                 beat('rsoft', opSpan('→ softmax →'))]
              : [beat('rsoft', opSpan(dotPhrase('W_router → softmax →')))]),
            // `colorSequentialBlue` — the SAME ramp as the `stripHTML` stream row two blocks left,
            // and as W_router between them (2026-08-01, by request; it was --series-4 green, chosen
            // to echo the Embedding block's token chip). This strip is the product of those two
            // operands, so it reads as the result of the row rather than a separate measurement in
            // a colour nothing else in the step uses. Passed as the ramp function, not as a base
            // hex: `tokenRampColor(--seq-700)` would land in the blue family but on different
            // endpoints, i.e. visibly not the same blue. Still NOT tokenColor(ti) — the per-token
            // generated hues exist to tell rows of a multi-token grid apart, and there is no such
            // grid in this step.
            beat('rprobs', matBlock('attention-router probabilities', '(1, ' + ar.num_experts + ')', expertStripWithNumbers(colorSequentialBlue, arTok.all_probs, arTok.top_experts, 22, 30, 2))),
          ], { align: 'center' }) +
          // Only with the grid: the diagram draws two horizontal bars side by side, which does not
          // itself show that a ROW of W_router is what pairs with the stream row. The FFN Router
          // modal carries the same summation for the same reason; without it the grid can read as
          // decoration. Pointless next to the fallback arrow, which claims no such structure.
          (arW
            ? '<div class="math-eq wrap" style="font-size:9.5px;">∑<sub>d=1</sub><sup>' + H + '</sup> ln1_out<sub>d</sub>·W_router[e,d] → logits[e] &nbsp;<span class="op">then softmax →</span>&nbsp; probs[e] &nbsp;<span class="op">top-' + ar.top_k + ' →</span> the ' + ar.top_k + ' experts that run</div>'
            : '') +
          '<p class="math-hint" style="margin:8px 0 0">Numbered cells are the ' + ar.top_k + ' the router selected. These are its raw softmax probabilities, shown exactly as the model produces them. The selected ' + ar.top_k + ' are not renormalized, so they do not add up to 100%.' +
          (arW
            ? ' <b>W_router</b> is the router\'s real weight matrix, one row per attention expert: row 1 dotted with the stream row on its left gives expert 1\'s score, row 2 gives expert 2\'s, and so on for all ' + ar.num_experts + '. Its ' + H + ' columns are downsampled to fit, so the shading shows the matrix\'s structure rather than individual weights. ' + TRANSPOSE_NOTE
            : ' The router\'s own weight matrix is not part of this trace, which is why the multiply above is an arrow rather than a grid.') +
          '</p>' +
          '<div class="moa-expert-chips" style="margin:12px 0 0;">' + routeChips + '</div>' +
          '<p class="math-hint" style="margin:5px 0 0;text-align:center;">Both of these run for this token. Steps 1, 3 and 4 follow one at a time (expert ' + (E + 1) + ' here).</p>' +
          // Last in the panel: the strip above is the reading, this is its exact numbers, so it
          // closes the step rather than interrupting the diagram → explanation → chips run.
          // Centered inline, not on `.math-eq` itself — that class is shared with every other math
          // modal, where the equations are left-aligned monospace on purpose. This one is a list of
          // 8 short items under a centered diagram, so it centres with what it describes.
          '<div class="math-eq wrap" style="font-size:10.5px;text-align:center;margin-top:14px;">' + probList + '</div>' +
          '</div>', ATTN_PANEL_CLS);

        html += attnPanel('map', aTab,
          '<div class="math-block"><h3>3. Per-head attention: Q·Kᵀ, softmax, then × V (expert ' + (E + 1) + ')</h3>' +
          '<div class="math-eq">attention map = softmax( (Q · Kᵀ)/√' + hd + ' + M )\nhead output  = attention map · V</div>' +
          '<p class="math-hint" style="margin:8px 0 10px">M is the causal mask, added to the scaled scores <b>before</b> softmax: M[query, key] = 0 where key ≤ query (allowed), and −∞ where key &gt; query (a future token). Softmax then turns every −∞ into exactly 0.</p>' +
          '<div class="pdf-head-nav" style="justify-content:flex-start;margin:0 0 10px;"><button id="pdf-head-prev">‹</button><span>query head ' + (flowHead + 1) + ' / ' + nh + '</span><button id="pdf-head-next">›</button></div>' +
          // ATTN_MAP_ALIGN: one shared middle column, operands centred, operators `noOffset` — see the
          // note on the MHA branch below.
          // Beat tags: row A's map is `mmap`, row B's copy is `mmap2` — same matrix, revealed one
          // after the other (see `playAttnStep`). Everything else matches the MHA branch key for key.
          attnMapGrid(
            [beat('mq', matBlock('Q head (expert ' + (E + 1) + ')', '(' + numTokens + ',' + hd + ')', gridHTML(aef.q_by_head[flowHead], 10))), beat('mdot1', opSpan('·', false, true)),
              beat('mk', matBlock('K head (shared)', '(' + numTokens + ',' + hd + ')', gridHTML(lf.k_by_head[flowHead], 10))), beat('mscale', opSpan('ᵀ/√' + hd + ' +', false, true))],
            beat('mmask', matBlock('mask M', '(' + numTokens + ',' + numTokens + ')', maskGridHTML(numTokens, 22))),
            [beat('msoft', opSpan('→ softmax →', false, true)),
              beat('mmap', matBlock('attention map', '(' + numTokens + ',' + numTokens + ')', attnGridHTML(aef.attn_probs_all_heads[flowHead], 22)))],
            beat('mmap2', matBlock('attention map', '(' + numTokens + ',' + numTokens + ')', attnGridHTML(aef.attn_probs_all_heads[flowHead], 22))),
            [beat('mdot2', opSpan('·', false, true)),
              beat('mv', matBlock('V head (shared)', '(' + numTokens + ',' + hd + ')', gridHTML(lf.v_by_head[flowHead], 10))), beat('meq', opSpan('=', false, true)),
              beat('mout', matBlock('head output', '(' + numTokens + ',' + hd + ')', gridHTML(aef.head_output_by_head[flowHead], 10)))],
          ) +
          '<p class="math-hint" style="margin:8px 0 0">Rows = query token, columns = key token. The other selected attention expert runs its own version of this in parallel.</p>' +
          MASK_LEGEND + '</div>', ATTN_PANEL_CLS);
        // ---- 4. Concatenate & project. Both selected experts get a row (2026-08-01, by request):
        // the output block is labelled "both experts", so showing one expert's lane above it left the
        // other half of that sum off-screen and the reader had to take the combine on faith. One row
        // per entry of `arOrdered` (so it is generic over top_k, not hard-coded to 2), each row
        // `concat · W_o × router weight`, with the combine op and the output vertically centred
        // against the stack — the combine is what the rows share, so it cannot sit on either row.
        // Rows are identical in width (every expert has the same nh heads of the same shape), so the
        // per-row `·` and `W_o` columns line up without a grid.
        // Gated all-or-nothing on every selected expert's tensors being present, with the original
        // single-row layout as the live fallback — same pattern as the MoA router grid's `arW`.
        // Verified present for all 5,904 (layer, token, selected expert) triples across the 12
        // shipped prompt files, so the fallback is a safety net, not a live path.
        const combineLanes = arOrdered.map((o: any) => ({
          o,
          aef: flow.attn_expert_flow?.[li + '_' + o.e],
          aew: flow.attn_expert_weights?.[li + '_' + o.e],
        }));
        const allLanes = combineLanes.every((l: any) => l.aef && l.aew);
        // Beat tags: the two lanes carry the SAME keys, so each beat tweens both at one timeline
        // position and the experts run in parallel (2026-08-01, by request) — while `cheads` is one
        // tagged block per lane holding 16 head grids, so inside a lane the heads land left to right.
        const laneRow = (l: any) => diagramRow([
          // No "· steps 1 & 3" marker on the followed expert's lane (removed by request the same day
          // it was added): the two lanes are the same reading, and singling one out re-introduced the
          // "one of these is the real one" hierarchy the second lane exists to dissolve. The header
          // paragraph already names which expert steps 1 and 3 follow.
          beat('cheads', matBlock('expert ' + (l.o.e + 1) + '’s ' + nh + ' query heads × (' + numTokens + ',' + hd + ') concatenated',
            // 6px, not the 7px the single-lane MHA concat uses: at 7 the lane measures 982px and the
            // wrapper 1198px, so `→ combine →` plus the output block (265px) wrapped onto their own
            // line and the output stopped sitting next to the combine. 6px takes 106px off the strip
            // (16 heads × 7 downsampled columns) and the whole row fits with ~47px to spare.
            '(' + numTokens + ',' + H + ')', headStripHTML(l.aef.head_output_by_head, 6))),
          beat('cdot', opSpan('·')),
          beat('cwo', matBlock('W_o (expert ' + (l.o.e + 1) + ')', '(' + H + ',' + H + ')', gridHTML(l.aew.o, 5))),
          beat('cweight', opSpan('× ' + (l.o.w * 100).toFixed(1) + '%')),
        ]);
        const concatDiagram = allLanes
          // `nowrap` on the wrapper, `min-width:0` on the lane stack: the combine and the output must
          // stay to the RIGHT of the stack at every width — that is the whole point of the layout —
          // so what gives on a narrow viewport is the head strip, which wraps onto a second line
          // inside its own lane (headStripHTML already wraps; min-width:0 is what lets the flex item
          // shrink to it). Letting the wrapper wrap instead drops the output onto its own line below.
          ? '<div style="display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:nowrap;margin:8px 0 12px;">' +
              '<div style="display:flex;flex-direction:column;gap:2px;min-width:0;">' + combineLanes.map(laneRow).join('') + '</div>' +
              // nbsp: this is the one operator whose neighbours can shrink, so a narrow viewport
              // would otherwise break "→ combine →" across three lines.
              beat('ccomb', opSpan('→&nbsp;combine&nbsp;→', false, true)) +
              beat('cout', matBlock('attention output (both experts)', '(' + numTokens + ',' + H + ')', gridHTML(lf.attn_output, 4))) +
            '</div>'
          // Single-lane fallback: no per-lane `× weight` operator, so that beat is simply absent and
          // `playAttnStep` gates its cursor on it.
          : diagramRow([beat('cheads', matBlock('expert ' + (E + 1) + '’s ' + nh + ' query heads × (' + numTokens + ',' + hd + ') concatenated', '(' + numTokens + ',' + H + ')', headStripHTML(aef.head_output_by_head, 7))), beat('cdot', opSpan('·')), beat('cwo', matBlock('W_o (expert ' + (E + 1) + ')', '(' + H + ',' + H + ')', gridHTML(aew.o, 5))), beat('ccomb', opSpan('→ combine →')), beat('cout', matBlock('attention output (both experts)', '(' + numTokens + ',' + H + ')', gridHTML(lf.attn_output, 4)))]);
        html += attnPanel('concat', aTab,
          '<div class="math-block"><h3>4. Concatenate each selected expert’s ' + nh + ' query heads → project with its own W_o → combine by router weight</h3>' +
          concatDiagram +
          '<div class="math-eq wrap">' +
          (allLanes
            // Position-independent wording: the lanes are ordered by router weight, so the expert the
            // other steps follow is not always the top lane — "the second lane is the other one's"
            // would be wrong whenever the chips select the lower-weighted expert.
            ? (ar.top_k === 2 ? 'Both' : 'All ' + ar.top_k) + ' selected experts run the whole of steps 1 and 3 for this token: one lane above each, and steps 1 and 3 follow expert ' + (E + 1) + '. Each projects with its own W_o, is scaled by its router weight (' + selText + '; raw softmax probabilities, so they do not add to 100%), and the ' + ar.top_k + ' scaled outputs are summed into this block’s real attention output.'
            : 'Each selected expert projects with its own W_o; the ' + ar.top_k + ' expert outputs are then combined by their router weights (' + selText + ') into this block’s real attention output (shown above: the combined result of both selected experts, not expert ' + (E + 1) + ' alone).') +
          '</div></div>', ATTN_PANEL_CLS);
      }

      // Step 2's chips used to be wired here (class selector, so a `<span>` swap alone would not
      // have unwired them). They are display-only now — see routeChips above.
      // The wiring + reveal that used to be scheduled here on a setTimeout(0) is now `mountStage`,
      // which React calls from an effect once this HTML has actually committed.
    } else if (stageKey === 'attn-only') {
      title = 'Multihead Attention (' + flow.num_attention_heads + ' heads) · layer ' + (li + 1);
      const rowLabels = tokens.map((t) => t.text.trim() || '·').join(', ');
      const nh = flow.num_attention_heads, hd = flow.head_dim;
      const aTab = ATTN_STEPS_MHA.some((s) => s.key === attnTab) ? attnTab : 'proj';
      headerExtra = attnSubTabBar(ATTN_STEPS_MHA, aTab);
      html = '<p class="math-hint" style="margin:0 0 10px">Batched over all ' + numTokens + ' tokens at once, one row per input word (' + escapeHtml(rowLabels) + ') throughout. Head ' + (flowHead + 1) + ' of ' + nh + ' shown for the per-head steps (use ‹ › next to the attention dot grid to change head).</p>';

      // The projection's input is the pre-attention RMSNorm's output, not the token embeddings —
      // the row has shown that norm as its own block since 2026-07-28, so calling this "embeddings"
      // contradicted the block sitting immediately upstream of the one that opens this modal.
      const NORM_STREAM = 'normalized stream';
      // All three models store the full-width pre-split tensors (2026-07-31); only OLMoE has a step
      // between them and the split. It RMSNorms Q and K at the full (n, H) width BEFORE the head
      // split (has_qk_norm), V untouched, so it alone also ships q_normed/k_normed and gets the
      // three-block `Q raw →norm→ Q normed →split→` chain. DeepSeek/JetMoE are has_qk_norm: false,
      // so their raw block runs straight into `→split→`.
      // The coupling that still holds is one-directional: hasQkNorm REQUIRES the intermediates (the
      // caption below promises a norm the diagram must show), but showRaw without hasQkNorm is the
      // normal DeepSeek/JetMoE case. Hence the `if (normed)` guard inside the showRaw branch —
      // deleting it would print a "→norm→" arrow on a model that does not do one.
      const showRaw = !!(lf.q_raw && lf.k_raw && lf.v_raw);
      // Does the RMSNorm pair of columns exist at all in this diagram? Read from the data, not from
      // `hasQkNorm`, and with `||` so a trace carrying only one of the two never has a real block
      // silently dropped. When it is false nothing prints a `→norm→` on a model that does not norm.
      const normCols = showRaw && !!(lf.q_normed || lf.k_normed);
      const projCells = (name: string, W: number[][], raw: number[][] | undefined, normed: number[][] | undefined, tail: string[]) => {
        // `beat(...)` tags each cell for the reveal timeline (playAttnStep). The tags name
        // elements, not columns, so a row that skips a step (V takes no norm and no RoPE) just has
        // no element in that beat, and a trace without the raw intermediates drops the beat entirely.
        const cells: string[] = [
          beat('stream', matBlock(NORM_STREAM, '(' + numTokens + ',' + H + ')', gridHTML(lf.ln1_out, 4))), beat('mul', opSpan('·')),
          beat('wmat', matBlock('W_' + name.toLowerCase(), '(' + H + ',' + H + ')', gridHTML(W, 5))),
        ];
        if (showRaw && raw) {
          cells.push(beat('eq', opSpan('=')), beat('raw', matBlock(name + ' raw', '(' + numTokens + ',' + H + ')', gridHTML(raw, 4))));
          // A row without a norm (V) does NOT reserve the two norm columns as blanks — it closes up,
          // so its `→split→` follows `V raw` directly and the trailing blanks all land at the end of
          // the row (2026-08-01, by request). Reserving them put a two-column hole between V raw and
          // its split, which reads as a step V is missing rather than a step V never takes. The
          // consequence to expect: V's split/head sit under Q's `→norm→`/`Q normed`, i.e. the columns
          // only line up as far as the operation is genuinely shared.
          if (normCols && normed) {
            cells.push(beat('normop', opSpan('→norm→')), beat('normed', matBlock(name + ' normed', '(' + numTokens + ',' + H + ')', gridHTML(normed, 4))));
          }
          cells.push(beat('split', opSpan('→split→')));
        } else {
          // No intermediates in the trace: fall back to the compact arrow, which still names the
          // norm on a has_qk_norm model. V never takes it.
          cells.push(beat('split', opSpan(name === 'V' ? '→split→' : qkSplitOp)));
        }
        return cells.concat(tail);
      };
      const ropeTail = (name: string, pre: number[][], post: number[][]) => [
        beat('head', matBlock(name + ' head ' + (flowHead + 1) + ' (pre-RoPE)', '(' + numTokens + ',' + hd + ')', gridHTML(pre, 10))),
        beat('rope', opSpan('rotate (RoPE) →')),
        beat('headpost', matBlock(name + ' head ' + (flowHead + 1) + ' (post-RoPE)', '(' + numTokens + ',' + hd + ')', gridHTML(post, 10))),
      ];
      // One grid, not three independent rows (2026-08-01, by request): every row shares the same
      // column schema — stream · W = raw [→norm→ normed] →split→ head [rotate head] — so the three
      // projections read down the columns as one operation applied three times. As three centred
      // `diagramRow`s the V row (which skips the norm and the RoPE columns) was shifted right of the
      // Q/K rows and nothing lined up. Ragged tails are padded by `padGridRows`; the mid-row gaps
      // (V's two norm columns) are explicit blanks inside `projCells`.
      const projGrid = padGridRows([
        projCells('Q', lf.q_weight, lf.q_raw, lf.q_normed, ropeTail('Q', lf.q_by_head_prerope[flowHead], lf.q_by_head[flowHead])),
        projCells('K', lf.k_weight, lf.k_raw, lf.k_normed, ropeTail('K', lf.k_by_head_prerope[flowHead], lf.k_by_head[flowHead])),
        projCells('V', lf.v_weight, lf.v_raw, undefined, [beat('head', matBlock('V head ' + (flowHead + 1), '(' + numTokens + ',' + hd + ')', gridHTML(lf.v_by_head[flowHead], 10)))]),
      ]);
      html += attnPanel('proj', aTab,
        '<div class="math-block"><h3>1. Project to Q / K / V (' + numTokens + ',' + H + '), split into ' + nh + ' heads of ' + hd + ' dims each, then rotate Q/K with RoPE</h3>' +
        // 10px column gap, not the helper's 16: this grid is up to 11 columns wide (the SwiGLU grids
        // it borrows from are 5), and at 16 it overflowed the modal instead of fitting.
        diagramGrid(projGrid.rows, projGrid.cols, { colGap: 10, rowGap: 18, center: true }) +
        '<div class="math-eq wrap">Q/K/V projections land at the full (' + numTokens + ', ' + H + ') hidden width' + (showRaw ? ' (that is what “Q raw” / “K raw” / “V raw” are above)' : '') + '. ' +
        (hasQkNorm ? 'Q and K then get RMSNorm’d at that same full width (V does not), and only after that are all three ' : 'All three are then ') +
        'reshaped to (' + numTokens + ', ' + nh + ', ' + hd + ') so each of the ' + nh + ' heads gets its own ' + hd + '-dim slice: the per-head grids above are head ' + (flowHead + 1) + '\'s real slice, not the full ' + H + ' width. RoPE rotates Q and K only (never V), using this model\'s real rope_theta and each token\'s real position, before the attention scores in step 2 are computed.</div></div>',
        ATTN_PANEL_CLS);

      html += attnPanel('map', aTab,
        '<div class="math-block"><h3>2. Per-head attention: Q·Kᵀ, softmax, then × V</h3>' +
        '<div class="math-eq">attention map = softmax( (Q · Kᵀ)/√' + hd + ' + M )\nhead output  = attention map · V</div>' +
        '<p class="math-hint" style="margin:8px 0 10px">M is the causal mask, added to the scaled scores <b>before</b> softmax: M[query, key] = 0 where key ≤ query (allowed), and −∞ where key &gt; query (a future token). Softmax then turns every −∞ into exactly 0.</p>' +
        '<div class="pdf-head-nav" style="justify-content:flex-start;margin:0 0 10px;"><button id="pdf-head-prev">‹</button><span>head ' + (flowHead + 1) + ' / ' + nh + '</span><button id="pdf-head-next">›</button></div>' +
        // ATTN_MAP_ALIGN: the Attention Map step is the one diagram in these modals that is neither a
        // `diagramRow` nor a `diagramGrid`. Two things pushed it out, on two dates:
        // - **Centred, never bottom-aligned** (2026-08-01, by request). Every other diagram here pairs
        //   operands of similar height, so `diagramRow`'s default `flex-end` looks like a baseline;
        //   here a (tokens,tokens) map sits beside a (tokens,head_dim) slice — on a 9-token prompt the
        //   mask is ~2× the Q head's height — and bottom-aligning hangs the short grids off the tall
        //   one's floor. Centring puts each operand on the same optical axis, which is also how the
        //   product actually pairs up.
        // - **`attnMapGrid`, one shared middle column** (2026-08-02, by request): row B's map sits
        //   directly under `mask M`. See that helper for why only the middle column is shared.
        // The `noOffset` operators (3rd arg `true`) survive both changes and are a SEPARATE fix:
        // `opSpan` hard-codes `align-self:center`, which overrides any container alignment either way,
        // so its default `padding-bottom:16px` parks every operator 8px above the centre. With the
        // operands centred on their grids that is just a visible 8px error, so all five drop it. Both
        // attention branches (MHA + MoA) carry this; nothing else does.
        // Beat tags: same keys as the MoA branch above, so one sequence in `playAttnStep` drives both.
        // The two `attention map` blocks are `mmap` (row A) and `mmap2` (row B) — identical calls on
        // identical data, differing only in the key, so they cannot drift.
        attnMapGrid(
          [beat('mq', matBlock('Q head', '(' + numTokens + ',' + hd + ')', gridHTML(lf.q_by_head[flowHead], 10))), beat('mdot1', opSpan('·', false, true)),
            beat('mk', matBlock('K head', '(' + numTokens + ',' + hd + ')', gridHTML(lf.k_by_head[flowHead], 10))), beat('mscale', opSpan('ᵀ/√' + hd + ' +', false, true))],
          beat('mmask', matBlock('mask M', '(' + numTokens + ',' + numTokens + ')', maskGridHTML(numTokens, 22))),
          [beat('msoft', opSpan('→ softmax →', false, true)),
            beat('mmap', matBlock('attention map', '(' + numTokens + ',' + numTokens + ')', attnGridHTML(lf.attn_probs_all_heads[flowHead], 22)))],
          beat('mmap2', matBlock('attention map', '(' + numTokens + ',' + numTokens + ')', attnGridHTML(lf.attn_probs_all_heads[flowHead], 22))),
          [beat('mdot2', opSpan('·', false, true)),
            beat('mv', matBlock('V head', '(' + numTokens + ',' + hd + ')', gridHTML(lf.v_by_head[flowHead], 10))), beat('meq', opSpan('=', false, true)),
            beat('mout', matBlock('head output', '(' + numTokens + ',' + hd + ')', gridHTML(lf.head_output_by_head[flowHead], 10)))],
        ) +
        '<p class="math-hint" style="margin:8px 0 0">Rows = query token, columns = key token. All ' + nh + ' heads run this independently and in parallel.</p>' +
        MASK_LEGEND + '</div>', ATTN_PANEL_CLS);

      html += attnPanel('concat', aTab,
        '<div class="math-block"><h3>3. Concatenate all ' + nh + ' heads back to (' + numTokens + ',' + H + '), project out</h3>' +
        // Beat tags: `cheads` is one block holding all 16 head grids, so the single stagger over it
        // walks head 1's cells, then head 2's — the heads land left to right, which is the operation
        // this step is named after. MHA has no `cweight`/`ccomb`; both gate the cursor.
        diagramRow([beat('cheads', matBlock(nh + ' heads × (' + numTokens + ',' + hd + ') concatenated', '(' + numTokens + ',' + H + ')', headStripHTML(lf.head_output_by_head, 7))), beat('cdot', opSpan('·')), beat('cwo', matBlock('W_o', '(' + H + ',' + H + ')', gridHTML(lf.o_weight, 5))), beat('ceq', opSpan('=')), beat('cout', matBlock('attention output', '(' + numTokens + ',' + H + ')', gridHTML(lf.attn_output, 4)))]) + '</div>', ATTN_PANEL_CLS);
      // Wiring + reveal moved to `mountStage` (see the MoA branch above).
    } else if (stageKey === 'add1') {
      // Batched over all tokens, matching the flow-block popover and the RMSNorm / attention modals.
      // Unlike RMSNorm there is no broadcast here: both operands are (numTokens, H) and the add is
      // elementwise, so this diagram is the whole operation with nothing left undrawn.
      title = 'Residual Add (post-attention) · all ' + numTokens + ' tokens · layer ' + (li + 1);
      html = '<div class="math-block"><h3>Add attention output back to the residual stream</h3>' +
        diagramRow([matBlock('residual (pre-norm input)', allDims, gridHTML(beforeAll, 5)), opSpan('+'), matBlock('attention output', allDims, gridHTML(lf.attn_output, 5)), opSpan('='), matBlock('sum', allDims, gridHTML(lf.after_attn_residual, 5))]) +
        '<p class="math-hint" style="margin:8px 0 0">One row per token, added position by position: no row affects any other. This is why it\'s called a "residual" connection: the attention block\'s output is added onto its own input rather than replacing it, so information from earlier layers is never fully discarded.</p></div>';
    } else if (stageKey === 'ln2') {
      title = 'RMSNorm (pre-' + (DATA.layers[li].tokens ? 'MoE' : 'FFN') + ') · all ' + numTokens + ' tokens · layer ' + (li + 1);
      html = rmsBlock('RMSNorm', lf.after_attn_residual, lf.ln2_weight, lf.ln2_out, 'ε = ' + RMS_EPS);
    } else if (stageKey === 'moe-combine-all') {
      title = 'Combined Weighted Output · all ' + numTokens + ' tokens · layer ' + (li + 1);
      if (!DATA.layers[li].tokens) {
        // DeepSeek dense layer, no routed experts to combine.
        html = '<div class="math-block"><h3>Dense feed-forward layer</h3>' +
          '<p class="math-hint" style="margin:0">Layer ' + (li + 1) + ' is dense, there is no router and no per-expert weighted sum. Every token runs through one shared feed-forward network. Switch to any later layer to see the MoE combined output.</p></div>';
        // Used to commit to the DOM and return early — the one branch that was a second writer to
        // #math-content. It returns the payload like every other branch now.
        return { title, headerExtra, html };
      }
      html = '<p class="math-hint" style="margin:0 0 10px">For every input token: the router\'s real top-' + DATA.top_k_experts + ' experts and their real softmax weights, then Σ (weight × expert_out), the actual weighted sum that becomes this layer\'s real MoE output for that token.' + (DATA.shared_experts ? ' The ' + DATA.shared_experts + ' always-on shared experts (merged into one feed-forward) are then added in gate-free, shown as “+ shared”.' : '') + '</p>';
      tokens.forEach((t, tIdx) => {
        const ttAll = DATA.layers[li].tokens[tIdx];
        const orderedAll = ttAll.top_experts.map((e: number, k: number) => ({ e, w: ttAll.top_weights[k] })).sort((a: any, b: any) => b.w - a.w);
        const eqText = orderedAll.map((o: any) => 'e' + (o.e + 1) + '×' + (o.w * 100).toFixed(1) + '%').join(' + ') + (DATA.shared_experts ? ' + shared' : '');
        html += '<div style="display:flex;align-items:center;gap:10px;flex-wrap:nowrap;margin:8px 0;padding:9px 12px;' +
          'background:var(--page);border:1px solid var(--border);border-radius:8px;overflow-x:auto;">' +
          '<div style="font-weight:700;font-size:12.5px;flex:0 0 auto;min-width:56px;">"' + escapeHtml(t.text.trim() || '·') + '"</div>' +
          '<div style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--text-secondary);flex:0 0 auto;white-space:nowrap;">' + eqText + '</div>' +
          '<div style="font-size:15px;color:var(--text-muted);flex:0 0 auto;">=</div>' +
          stripHTML(lf.moe_output[tIdx], 5) +
          '<div style="font-size:10px;color:var(--text-muted);flex:0 0 auto;">(1,' + H + ')</div>' +
          '</div>';
      });
    } else if (stageKey === 'dense-ffn') {
      // DeepSeek dense layer 1: one shared SwiGLU feed-forward, no router.
      const d = DATA.dense_ffn && DATA.dense_ffn[String(li)];
      title = '"' + tokenText + '" · Dense feed-forward · layer ' + (li + 1);
      if (!d) {
        html = '<div class="math-block"><h3>Dense FFN</h3><p class="math-hint" style="margin:0">No dense-layer weights available for this layer.</p></div>';
      } else {
        const I2 = d.intermediate_size || DATA.intermediate_size;
        const hVecD = lf.ln2_out[ti];
        const outVecD = d.outputs && d.outputs[String(ti)];
        html = '<div class="math-block"><h3>Dense SwiGLU feed-forward: no router, runs for every token</h3>' +
          '<p class="math-hint" style="margin:0 0 4px;">Layer ' + (li + 1) + ' has no experts. The normalized hidden state <b>h</b> is multiplied by two weight matrices, gated, and projected back down to hidden size ' + H + '. Highlighted boxes are the result of each step. ' + TRANSPOSE_NOTE + '</p>' +
          diagramGrid([
            [matBlock('h', '(1, ' + H + ')', stripHTML(hVecD, 7), true), opSpan('·', true), matBlock('W_gate', wDims(I2, H), gridHTML(d.gate, 10), true), opSpan('→ SiLU →', true), resultBlock('gate = SiLU(h·W_gateᵀ)', '(1, ' + I2 + ')', '', true)],
            [matBlock('h', '(1, ' + H + ')', stripHTML(hVecD, 7), true), opSpan('·', true), matBlock('W_up', wDims(I2, H), gridHTML(d.up, 10), true), opSpan('=', true), resultBlock('up = h·W_upᵀ', '(1, ' + I2 + ')', '', true)],
            [matBlock('gate ⊙ up', '(1, ' + I2 + ')', '', true), opSpan('·', true), matBlock('W_down', wDims(H, I2), gridHTML(d.down, 10), true), opSpan('=', true), resultBlock('dense FFN output', '(1, ' + H + ')', outVecD ? stripHTML(outVecD, 7) : '', true)],
          ], 5, { big: true }) +
          '<div class="math-eq wrap" style="font-size:11.5px;">This output is added straight back to the residual stream, no router weighting, because every token uses this one shared network.</div></div>';
      }
    } else if (stageKey === 'shared-experts') {
      // DeepSeek: the always-on shared experts, stored merged into one feed-forward.
      const S = DATA.shared_experts || 0;
      const sw = DATA.shared_expert_weights && DATA.shared_expert_weights[String(li)];
      title = '"' + tokenText + '" · Shared experts · layer ' + (li + 1);
      if (!sw) {
        html = '<div class="math-block"><h3>Shared experts</h3><p class="math-hint" style="margin:0">No shared-expert weights available for this layer.</p></div>';
      } else {
        const I2 = sw.intermediate_size || DATA.intermediate_size;
        const hVecS = lf.ln2_out[ti];
        const outVecS = DATA.shared_expert_outputs && DATA.shared_expert_outputs[ti + '_' + li];
        html = '<div class="math-block"><h3>' + S + ' shared experts (always on), merged into one feed-forward</h3>' +
          '<p class="math-hint" style="margin:0 0 4px;">Unlike the routed experts, the ' + S + ' shared experts run for <b>every</b> token: the router never chooses them. DeepSeek stacks them into a single SwiGLU feed-forward (intermediate size ' + I2 + ' = ' + S + ' × ' + DATA.intermediate_size + '); the same input <b>h</b> flows through it and the result is added into the layer output gate-free. ' + TRANSPOSE_NOTE + '</p>' +
          diagramGrid([
            [matBlock('h', '(1, ' + H + ')', stripHTML(hVecS, 7), true), opSpan('·', true), matBlock('W_gate', wDims(I2, H), gridHTML(sw.gate, 10), true), opSpan('→ SiLU →', true), resultBlock('gate = SiLU(h·W_gateᵀ)', '(1, ' + I2 + ')', '', true)],
            [matBlock('h', '(1, ' + H + ')', stripHTML(hVecS, 7), true), opSpan('·', true), matBlock('W_up', wDims(I2, H), gridHTML(sw.up, 10), true), opSpan('=', true), resultBlock('up = h·W_upᵀ', '(1, ' + I2 + ')', '', true)],
            [matBlock('gate ⊙ up', '(1, ' + I2 + ')', '', true), opSpan('·', true), matBlock('W_down', wDims(H, I2), gridHTML(sw.down, 10), true), opSpan('=', true), resultBlock('shared output', '(1, ' + H + ')', outVecS ? stripHTML(outVecS, 7) : '', true)],
          ], 5, { big: true }) +
          '<div class="math-eq wrap" style="font-size:11.5px;">contribution = shared output → added directly (gate-free) to the router-weighted sum of the top-' + DATA.top_k_experts + ' routed experts.</div></div>';
      }
    } else if (stageKey === 'moe') {
      const tt = DATA.layers[li].tokens[ti];
      const ordered = tt.top_experts.map((e: number, k: number) => ({ e, w: tt.top_weights[k] })).sort((a: any, b: any) => b.w - a.w);
      title = '"' + tokenText + '" · MoE Layer · layer ' + (li + 1);
      html = '<div class="math-block"><h3>Router selects ' + DATA.top_k_experts + ' of ' + DATA.num_experts + ' experts</h3>' +
        '<div class="math-eq wrap">' + ordered.map((o: any) => 'e' + (o.e + 1) + ' ' + (o.w * 100).toFixed(1) + '%').join(' &nbsp;·&nbsp; ') + '</div>' +
        '<p class="math-hint" style="margin:8px 0 0">Click any cell in the grid further down the page for the full per-expert router + feed-forward arithmetic, same layer, same token.</p></div>';
      html += '<div class="math-block"><h3>Combined MoE output (sum of all activated experts, weighted)</h3>' +
        diagramRow([matBlock('MoE layer output', '(1,' + H + ')', stripHTML(lf.moe_output[ti], 5))]) + '</div>';
    } else if (stageKey === 'add2') {
      title = 'Residual Add (post-' + (DATA.layers[li].tokens ? 'MoE' : 'FFN') + ') · all ' + numTokens + ' tokens · layer ' + (li + 1);
      const feedLabel = DATA.layers[li].tokens ? 'MoE output' : 'FFN output';
      html = '<div class="math-block"><h3>Add ' + feedLabel + ' back to the residual stream</h3>' +
        diagramRow([matBlock('residual (post-attention)', allDims, gridHTML(lf.after_attn_residual, 5)), opSpan('+'), matBlock(feedLabel, allDims, gridHTML(lf.moe_output, 5)), opSpan('='), matBlock('layer output', allDims, gridHTML(lf.layer_output, 5))]) +
        '<p class="math-hint" style="margin:8px 0 0">One row per token, added position by position. This sum is the layer\'s output, and it is what the next layer reads as its residual stream.</p></div>';
    } else if (stageKey === 'output') {
      title = '"' + tokenText + '" · Layer Output · layer ' + (li + 1);
      const isLast = li === DATA.num_layers - 1;
      html = '<div class="math-block"><h3>Output of layer ' + (li + 1) + '</h3>' +
        diagramRow([matBlock('layer output', '(1,' + H + ')', stripHTML(lf.layer_output[ti], 5))]) +
        '<p class="math-hint" style="margin:8px 0 0">' + (isLast
          ? 'This is the last layer: one more final RMSNorm, then × the (' + H + ', vocab_size) LM head matrix, gives the next-token logits shown in the Final Output block (top pick: ' + escapeHtml(DATA.next_token_candidates[0].token.trim()) + ' at ' + (DATA.next_token_candidates[0].prob * 100).toFixed(1) + '%).'
          : 'This becomes the residual input to layer ' + (li + 2) + '\'s RMSNorm, switch layer tabs further down to follow it forward.') + '</p></div>';
    } else if (stageKey === 'final-output') {
      const remaining = DATA.num_layers - 1 - li;
      title = 'Final Output: where these numbers come from';
      html = '<div class="math-block"><h3>' + (remaining > 0
        ? 'Not layer ' + (li + 1) + '\'s output, the real final layer\'s'
        : 'This is the real final layer\'s output') + '</h3>' +
        '<p class="math-hint" style="margin:0">' + (remaining > 0
          ? 'You\'re currently viewing layer ' + (li + 1) + ' of ' + DATA.num_layers + '. There ' +
          (remaining === 1 ? 'is 1 more decoder layer' : 'are ' + remaining + ' more decoder layers') +
          ' (layer ' + (li + 2) + ' through layer ' + DATA.num_layers + ') before the residual stream actually reaches the point where these numbers are computed. This panel always shows the model\'s real layer-' + DATA.num_layers + ' prediction, not layer ' + (li + 1) + '\'s own local output, so you can compare each layer\'s internal state against where the model actually ends up.'
          : 'You\'re on the last decoder layer (' + DATA.num_layers + ' of ' + DATA.num_layers + '), so this is exactly where these numbers are produced: one final RMSNorm on this layer\'s output, then × the (' + H + ', vocab_size) LM head matrix, gives these real next-token logits.') + '</p>' +
        '<div class="dims" style="margin-top:8px">real top pick: <b style="color:var(--text-primary)">' + escapeHtml(DATA.next_token_candidates[0].token.trim()) + '</b> at ' + (DATA.next_token_candidates[0].prob * 100).toFixed(1) + '%</div>' +
        '</div>';
    }

    return { title, headerExtra, html };
  }

  /** Opens a flow stage in the shared math modal. React owns the modal's open state and renders
   *  the payload, so this builds and hands it over rather than writing to the DOM; the wiring and
   *  the staged reveal follow from `mountStage`, once React has committed the HTML. */
  function openFlowStage(stageKey: string, attnTab: string = 'proj') {
    opts?.onOpenStage?.({ kind: 'flow', stageKey, attnTab, payload: buildFlowStage(stageKey, attnTab) });
  }

  /** Run by React from an effect, AFTER the stage's HTML has committed — the replacement for the
   *  two `setTimeout(…, 0)` calls that used to end the attention branches. Safe to call on markup
   *  that carries none of these elements: every wire-up below no-ops when its nodes are absent.
   *  ⚠ The wiring assigns `.onclick` rather than adding listeners (the convention this file's
   *  header describes). React skips the innerHTML write when a re-open produces a byte-identical
   *  string, so the nodes can survive into the next mount and `addEventListener` would stack. */
  function mountStage() {
    wireMathSubTabs();
    wireAttnSubTabs();
    wireAttnHeadNav();
    // Plays whichever step is visible: 'proj' for every opener that means "explain this block",
    // 'map' when the head ‹ › re-opened the modal (which sets the skip flag).
    playAttnStep();
  }

  // ---- cleanup for React hosting: everything boot() registered outside its own DOM subtree ----
  const cleanup = () => {
    window.removeEventListener('resize', onGridResize);
    window.removeEventListener('resize', onArcResize);
    redrawFlowArcs = null;
    stopPlay();
    endSwipe();
    swipeMM.revert();
    routeTimers.forEach(clearTimeout);
    routeTimers = [];
    gsap.killTweensOf(cellsLayer.querySelectorAll('g.cell-rest, g.cell-top'));
    killAttnTimeline();
  };

  return {
    cleanup,
    setLayer: (l: number) => setLayer(l),
    replayPop: () => popCells(),
    fitGridHeight: (tab: RouterTabRegime) => { routerTab = tab; fitGridModalHeight(tab); },
    animateRouting: () => animateRouting(),
    mountStage: () => mountStage(),
    killAttnTimeline: () => killAttnTimeline(),
    hideTip: () => hideTip(),
    highlightTourBlock: (step: number | null) => { tourHighlight = step; applyTourHighlight(); },
    openStage: (stageKey: string) => openFlowStage(stageKey),
  };
}
