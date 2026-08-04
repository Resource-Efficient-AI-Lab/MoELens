import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import {
  bootArchExplorer,
  type ArchExplorerApi, type OpenStage, type RouterTabRegime, type StagePayload,
} from './archExplorer';
import { PerTokenRouting } from './PerTokenRouting';
import { buildOuterFlowBlocks, flowBlockInnerHtml, type FlowBlockContent } from './flowBlocks';
import { DENSE_FFN_TEXT, pickNarration } from './narration';
import { buildParamCountPanelHtml } from './paramPanel';
import type { PromptFlow } from './types';

/** The same union archExplorer takes as its height-regime argument — aliased rather than restated
 *  so the two can never drift into disagreeing about the sub-tab names. */
type RouterSubTab = RouterTabRegime;

/** The flow row's connector arrow, as the exact string `flowConnector()` used to build with
 *  `createElementNS` + `setAttribute`. Deliberately NOT written as JSX: `innerHTML` parsing sets
 *  attributes in source order, which is precisely `setAttribute` order, so this is byte-identical
 *  to what the island produced — and the five connectors INSIDE the card still come from
 *  `flowConnector()`, so the two must not be allowed to drift apart in serialization.
 *  Module-level constants, so their object identity is permanently stable: a fresh `{ __html }`
 *  literal per render makes React re-write the DOM every time this component renders for any
 *  reason (the H13 failure mode that blanked the attention panel in Section 2). */
const CONNECTOR_HTML = {
  __html:
    '<svg width="20" height="54" viewBox="0 0 20 54">' +
    '<path d="M 0 27 L 20 27" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round"></path>' +
    '<path d="M 15 22 L 20 27 L 15 32" fill="none" stroke="var(--text-muted)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>' +
    '</svg>',
};

function FlowConnector({ shrinkable }: { shrinkable?: boolean }) {
  return (
    <div
      className={'pdf-connector' + (shrinkable ? ' shrinkable' : '')}
      dangerouslySetInnerHTML={CONNECTOR_HTML}
    />
  );
}

/** One of the three outer flow blocks. `className` before `style` so the attribute order matches
 *  `pdfBlock()`'s `div.className = …` then `div.style.setProperty('--block-accent', …)`.
 *  ⚠ The Final RMSNorm ALSO carries a `height` / `marginTop` the deck writes imperatively after its
 *  stage lock. That survives because React's style diff only ever touches keys present in the prop
 *  — `--block-accent` here — and never rewrites the whole attribute. */
function FlowBlock({ content, html, onClick }: {
  content: FlowBlockContent;
  html: { __html: string };
  onClick?: (ev: MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      className={'pdf-block ' + content.extraClass}
      style={{ '--block-accent': content.accent } as CSSProperties}
      // The same guard `pdfBlock()` wrapped every onClick in: a click inside an open token popover
      // is a read, not a request to open the math modal. (The block-level `.pdf-popover` this also
      // used to name was removed on 2026-08-03; the chip popover is the only one left.)
      onClick={onClick && ((ev) => {
        if (!(ev.target as Element).closest('.pdf-token-popover')) onClick(ev);
      })}
      dangerouslySetInnerHTML={html}
    />
  );
}

/** One open stage of the math modal. `seq` gives every open a fresh identity, which is what the
 *  wire-and-play effect keys on: two consecutive opens of the same block produce an identical
 *  `payload.html`, and without it the effect would not re-run. */
interface MathStage {
  seq: number;
  kind: OpenStage['kind'];
  payload: StagePayload;
}

interface ArchitectureTabProps {
  visible: boolean;
  /** The selected prompt's data, and its index — both owned by MoeApp, which renders the Model +
   *  Prompt dropdowns above the top-tab bar. Null while the first prompt is still loading. */
  flow: PromptFlow | null;
  promptIndex: number;
  error: Error | null;
  /** Reports the currently-selected prompt's category, for the Domain Specialization tab's
   *  one-way cross-tab sync (its shared picker defaults to this category on mount). */
  onDomainChange?: (domain: string) => void;
}

/**
 * The "Model Architecture" tab — the static shell of the prototype's explorer (same element IDs
 * and classes as index_v2.html), filled imperatively by archExplorer.ts. React owns only the
 * boot/cleanup lifecycle; everything inside the panel is the ported prototype code rendering into
 * these containers.
 *
 * The tab is hidden with display:none (never unmounted) when the user switches to Domain
 * Specialization, so the explorer's state — current layer, isolated token, open tour — survives
 * a round trip, exactly like the prototype's tab switching.
 */
export function ArchitectureTab({ visible, flow, promptIndex, error, onDomainChange }: ArchitectureTabProps) {
  // Router modal state — React owns the shared current layer (single source of truth for both the
  // Per-token routing fan and, via the exposed setLayer, the imperative All-tokens heatmap).
  const [currentLayer, setCurrentLayer] = useState(0);
  const [routerSubTab, setRouterSubTab] = useState<RouterSubTab>('per-token');
  const archApiRef = useRef<ArchExplorerApi | null>(null);
  // The Per-token tab's beat replay, published upward so ▶ Replay routing can live in the shared
  // layer row next to its All-tokens twin. Null = nothing to replay (reduced motion / dense layer).
  // Wrapped in the updater form: a bare setState(fn) would be read as a state updater.
  const [perTokenReplay, setPerTokenReplay] = useState<(() => void) | null>(null);
  const registerPerTokenReplay = useCallback(
    (replay: (() => void) | null) => setPerTokenReplay(() => replay),
    [],
  );

  // ---- guided tour: React owns whether it is running and which step ----
  const [tourOpen, setTourOpen] = useState(false);
  const [tourStep, setTourStep] = useState(0);

  // ---- the shared math modal: React owns whether it is open and which stage is showing ----
  // The stage's CONTENT is still built by archExplorer's string builders; React only commits it.
  const [mathStage, setMathStage] = useState<MathStage | null>(null);
  const stageSeq = useRef(0);

  /** Every internal opener (block clicks, token chips, the head ‹ ›, a routing-grid cell) lands
   *  here. The build already happened inside archExplorer's event handler — deliberately, since
   *  it mutates `selected`/`flowAttnExpert` and so must never run during a React render. */
  const handleOpenStage = useCallback((stage: OpenStage) => {
    // Kill BEFORE the state update, not only in the effect's cleanup: React mutates the DOM
    // before it runs cleanups, so a timeline killed only there would spend one commit tweening
    // nodes React had already replaced. This is the same instant the old code killed it at —
    // immediately before the innerHTML swap.
    archApiRef.current?.killAttnTimeline();
    stageSeq.current += 1;
    setMathStage({ seq: stageSeq.current, kind: stage.kind, payload: stage.payload });
  }, []);

  const closeMathModal = useCallback(() => {
    archApiRef.current?.killAttnTimeline();
    archApiRef.current?.hideTip();
    setMathStage(null);
  }, []);

  useEffect(() => {
    if (!flow) return;
    const api = bootArchExplorer(flow, {
      onLayerChange: setCurrentLayer,
      onOpenStage: handleOpenStage,
    });
    archApiRef.current = api;
    setCurrentLayer(0); // a re-boot (prompt change) resets the explorer to layer 1
    // …and closes the modal. archExplorer used to strip the backdrop's `open` class here; now that
    // React owns it, a stale stage would otherwise keep rendering HTML built from the PREVIOUS
    // prompt's closure, and its wiring would drive a dead explorer (audit M10).
    setMathStage(null);
    // Same reasoning for the guided tour. The old code did NOT reset it — it left the overlay
    // visible over a freshly-booted explorer whose tour state was back at "closed", so Next
    // advanced a card that highlighted nothing. Closing it is the sane reset, and a visible
    // behaviour change: switching prompt or model now dismisses an open tour.
    setTourOpen(false);
    setTourStep(0);
    return () => {
      api.cleanup();
      archApiRef.current = null;
    };
  }, [flow, handleOpenStage]);

  // Wire the stage's controls and start its reveal, once the HTML above has committed.
  // ⚠ `mathStage` is the ONLY dependency, and that is load-bearing. ▶ Step through layers
  // re-renders this component every 3.5s through `onLayerChange`; a flow stage is deliberately
  // built once and left alone (archExplorer nulls `selected` to guarantee it), so re-running here
  // on a layer change would restart the ~3.9s reveal mid-read. A cell popup does rebuild on a
  // layer change, but by way of a fresh `onOpenStage` — which changes `mathStage` and re-runs this
  // effect for the right reason.
  // useEffect, not useLayoutEffect: the chrome and the armed (invisible) panel are meant to paint
  // first — `.beat-armed` exists so that first paint is already frame 0 — and building the
  // timeline on the heaviest panel costs ~235ms, which useLayoutEffect would spend blocking paint.
  useEffect(() => {
    if (!mathStage) return;
    const api = archApiRef.current;
    api?.mountStage();
    return () => api?.killAttnTimeline();
  }, [mathStage]);

  /** ⚠ These two must be MEMOISED, and it is not an optimisation.
   *  React decides whether to re-write `dangerouslySetInnerHTML` by comparing the prop's OBJECT
   *  IDENTITY, not the string inside it, so a fresh `{ __html }` literal per render re-writes the
   *  body every time this component renders for any other reason. ▶ Step through layers renders it
   *  every 3.5s via `onLayerChange`, and each of those re-writes restored the panel's
   *  `beat-armed` class (it is part of the built HTML) while the effect above — correctly keyed on
   *  `mathStage`, which had not changed — did not re-run to strip it. The result was a permanently
   *  blank attention panel with no console error: exactly the H7 failure mode.
   *  Measured before the fix: two writes of 413,228 chars over two layer ticks, all 2,010 cells
   *  left at opacity 0. After: zero writes, GSAP's finished inline styles intact. */
  const bodyHtml = useMemo(() => ({ __html: mathStage ? mathStage.payload.html : '' }), [mathStage]);
  const headerHtml = useMemo(() => ({ __html: mathStage ? mathStage.payload.headerExtra : '' }), [mathStage]);

  // Drive the imperative block highlight.
  // ⚠ Deliberately NOT keyed on `currentLayer` OR on `flow`.
  //  - currentLayer: a layer change rebuilds the flow row, and buildPdfBlocks re-applies the
  //    highlight itself from its own mirror of this index — re-running here would fire a second
  //    scrollIntoView per layer step.
  //  - flow: on a re-boot this effect would run while `tourOpen`/`tourStep` still held the OLD
  //    tour's values (the boot effect only *queues* the reset), so it would highlight a block on
  //    the freshly-built row and start a smooth scrollIntoView that no later render can cancel.
  //    Measured before dropping it: ~120ms of a stale highlight on every prompt/model switch made
  //    during a tour. Dropping `flow` is safe because a fresh boot's `tourHighlight` mirror already
  //    starts at null, and the queued `setTourOpen(false)` re-runs this effect anyway.
  useEffect(() => {
    archApiRef.current?.highlightTourBlock(tourOpen ? tourStep : null);
  }, [tourOpen, tourStep]);

  /** The row's three outer blocks (Embedding, Final RMSNorm, Final Output), built during RENDER so
   *  they are already populated when the boot effect below measures the row — the stage lock, the
   *  Final RMSNorm's sizing and the arc draw have to stay one synchronous sequence inside the deck.
   *  `.moe-root` is mounted by then: MoeApp renders it, and this component returns the loading
   *  placeholder while `flow` is null, so there is always a commit before the first non-null flow.
   *  ⚠ Memoised on `flow` alone, which means the accents (read from `--series-3/4/5` through
   *  getComputedStyle) are fixed at the theme in force when the prompt loaded. That is exact today
   *  because nothing in the app switches theme — `:root[data-theme]` is only ever set from outside
   *  the page. If an in-app theme toggle is ever added, this dep list is the thing to revisit. */
  const outer = useMemo(() => {
    if (!flow) return null;
    const root = document.querySelector<HTMLElement>('.moe-root');
    if (!root) {
      // Not loud on its own: the accents would simply come out empty and the blocks would fall back
      // to the CSS default colour, which is subtle enough to ship by accident.
      console.error('[arch] .moe-root is not mounted; flow blocks would render with no accent');
      return null;
    }
    return buildOuterFlowBlocks(flow, root);
  }, [flow]);
  // One memo per block, all keyed on `outer` — see the note on `bodyHtml` above for why identity,
  // not string equality, is what matters here.
  const embedHtml = useMemo(() => ({ __html: outer ? flowBlockInnerHtml(outer.embed) : '' }), [outer]);
  const finalNormHtml = useMemo(() => ({ __html: outer ? flowBlockInnerHtml(outer.finalNorm) : '' }), [outer]);
  const finalOutputHtml = useMemo(() => ({ __html: outer ? flowBlockInnerHtml(outer.finalOutput) : '' }), [outer]);
  // Two keys onto ONE stage: same body, different header title, so each block's modal is named
  // after the block that was clicked (see the 'final-output' branch in buildFlowStage).
  const openFinalOutput = useCallback(() => archApiRef.current?.openStage('final-output'), []);
  const openFinalNorm = useCallback(() => archApiRef.current?.openStage('final-norm'), []);

  /** The standalone "Parameter count" panel. Model-level facts only — every branch reads just
   *  `DATA` fields and arithmetic, with no per-layer, per-token or `getComputedStyle` input — so it
   *  memoises on `flow` alone and, unlike the flow blocks above, has no theme dependency to go
   *  stale in dark mode.
   *  ⚠ MEMOISED for the same reason as `bodyHtml` and the three block memos: React compares the
   *  `dangerouslySetInnerHTML` prop by OBJECT IDENTITY, so a fresh literal per render would re-write
   *  this panel on every render for any reason — including ▶ Step through layers' 3.5s tick. That is
   *  invisible to a DOM dump (the string is identical), which is why probe4-param-panel.mjs exists. */
  const paramPanelHtml = useMemo(
    () => ({ __html: flow ? buildParamCountPanelHtml(flow) : '' }),
    [flow],
  );

  /** ▶ Replay routing on the All-tokens sub-tab. Was an `onclick` archExplorer assigned to this
   *  React-rendered button at boot; the island no longer resolves the node at all. */
  const replayAllTokensRouting = useCallback(() => archApiRef.current?.animateRouting(), []);

  useEffect(() => {
    if (!flow) return;
    onDomainChange?.(flow.domain);
    // onDomainChange intentionally omitted — MoeApp passes a stable setter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  // The Router modal opens on the Per-token sub-tab, so the All-tokens grid is behind display:none
  // on arrival and its activated-expert pop would have settled unseen. Replay it when the sub-tab
  // becomes visible — in an effect, not the click handler, because the pop's transform-origin is
  // measured from the SVG bounding box, which reads zero while the container is still hidden.
  // The same effect re-fits the modal height to the heatmap: React's 92vh (below) is what the
  // Per-token fan scales into, but the heatmap wants its own shrink-to-fit, and `fitGridModalHeight`
  // deliberately no-ops while the Per-token tab is showing.
  // ⚠ `fitGridHeight` is now called on BOTH sub-tabs, because it also carries the regime into the
  // island (which used to read it off `data-router-tab`); on 'per-token' it only records that and
  // returns. `replayPop` stays inside the guard — replaying while the grid is behind display:none
  // measures a zero bounding box, which is the whole reason this lives in an effect.
  // ⚠ This effect is declared AFTER the boot effect above, so on a prompt/model change React runs
  // the boot first and this immediately after, which is what re-fits a modal left on All-tokens.
  useEffect(() => {
    if (routerSubTab === 'all-tokens') archApiRef.current?.replayPop();
    archApiRef.current?.fitGridHeight(routerSubTab);
  }, [routerSubTab, flow]);

  // Escape closes whichever modal is open (document-level in the prototype's bootstrap). The math
  // half is React state now; the Router modal stays an imperative class toggle for the moment.
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        closeMathModal();
        document.getElementById('moe-grid-backdrop')?.classList.remove('open');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [closeMathModal]);

  // Only block the whole panel on a true first-load (or a failure before anything ever loaded).
  // Once a prompt has loaded once, keep showing it — including while a same-model prompt switch
  // is still fetching (split models only; OLMoE never re-fetches on prompt switch) — instead of
  // blanking the panel on every switch, which read as the whole page "blinking".
  if (!flow) {
    return (
      <div style={{ display: visible ? undefined : 'none' }}>
        <div className="panel">
          <p className="math-hint" style={{ margin: 0 }}>
            {error ? `Failed to load prompt data: ${error.message}` : 'Loading prompt data…'}
          </p>
        </div>
      </div>
    );
  }

  // ---- the tour card's copy, for THIS model and THIS layer ----
  const narration = pickNarration(!!flow.layer_flow.is_moa, flow.shared_experts);
  // Step 6 (index 5) is the MoE block, but DeepSeek's layer 1 renders a "Dense FFN" block instead,
  // so the card has to name the block it is actually highlighting. This reads `currentLayer` on
  // every render, which is what makes it LIVE: stepping layers with the tour open at step 6 flips
  // the title and body between Dense FFN and MoE, because onLayerChange re-renders this component.
  const denseHere = !flow.layers[currentLayer]?.tokens;
  const tourCard = tourStep === 5 && denseHere
    ? { title: `Dense FFN (layer ${currentLayer + 1})`, text: DENSE_FFN_TEXT }
    : narration[tourStep];

  // One sentence per architecture: DeepSeek routes at every layer but its dense one and always
  // runs its shared experts; JetMoE routes attention as well as the FFN; OLMoE is the plain case.
  const scopeCopy = flow.dense_layer_indices?.length
    ? `all ${flow.num_experts} routed experts at ${flow.num_layers - flow.dense_layer_indices.length} of`
      + ` its ${flow.num_layers} layers (layer ${flow.dense_layer_indices[0] + 1} is a dense`
      + ` feed-forward layer with no router), and ${flow.shared_experts} shared experts run on`
      + ` every token regardless`
    : flow.attention_routing
      ? `all ${flow.num_experts} feed-forward experts at each of ${flow.num_layers} layers, and`
        + ` against ${flow.attention_routing.num_experts} attention experts by a second router`
      : `all ${flow.num_experts} experts at each of ${flow.num_layers} layers`;

  return (
    <div style={{ display: visible ? undefined : 'none' }}>
      <div>
        <p className="sub">
          {/* ⚠ STRAIGHT double quotes (U+0022), exactly as the imperative
              `textContent = '"' + DATA.prompt + '"'` wrote them. A curly-quote "improvement" here
              is a one-character regression no screenshot would catch — exercise-s5.mjs asserts the
              char codes. */}
          For the selected prompt <code className="inline" id="prompt-text">{`"${flow.prompt}"`}</code>, every token
          is scored against {scopeCopy}. Each
          row below is one token's full router softmax across all {flow.num_experts} experts.
        </p>
        <div className="panel">
          <div className="flow-header">
            {/* "‹ Transformer Block N ›" label — centered, level with Start tour; filled by archExplorer. */}
            <div id="flow-block-label" className="flow-block-label"></div>
            <button
              className="play-btn"
              id="start-tour-btn"
              type="button"
              onClick={() => { setTourStep(0); setTourOpen(true); }}
            >
              ▶ Start tour
            </button>
          </div>

          {/* The flow row. React renders the three blocks that do NOT depend on the current layer
              — Embedding (0), Final RMSNorm (7), Final Output (8) — plus the three fixed row-level
              connectors; the empty `.layer-stage` is the deck island's, filled by archExplorer's
              buildPdfBlocks (ghosts, card, its six blocks and both overlays) and never touched by
              React, which is given no children for it.
              The middle connector is NOT shrinkable: that 20px gap is what the tuck's
              THROW_PX = 18 travels into. The other two give way instead, which is what pays for the
              Final RMSNorm's 64px (see `.layer-card-row .pdf-connector` in moe.css). */}
          <div className="pdf-scroll">
            <div className="pdf-flow-row" id="pdf-flow-row">
              {outer && (
                <>
                  {/* No onClick: only its token chips are interactive, and those are delegated on
                      pdfRow by archExplorer so that clicking one does NOT select the block. */}
                  <FlowBlock content={outer.embed} html={embedHtml} />
                  <FlowConnector shrinkable />
                  <div className="layer-stage" />
                  <FlowConnector />
                  <FlowBlock content={outer.finalNorm} html={finalNormHtml} onClick={openFinalNorm} />
                  <FlowConnector shrinkable />
                  <FlowBlock content={outer.finalOutput} html={finalOutputHtml} onClick={openFinalOutput} />
                </>
              )}
            </div>
          </div>
        </div>

        <div className={`tour-overlay${tourOpen ? ' open' : ''}`} id="tour-overlay">
          <div className="tour-card">
            <div className="tour-step-label" id="tour-step-label">
              Step {tourStep + 1} of {narration.length}
            </div>
            <h3 id="tour-title">{tourCard.title}</h3>
            <p id="tour-text">{tourCard.text}</p>
            <div className="tour-controls">
              <button className="play-btn" id="tour-exit-btn" type="button" onClick={() => setTourOpen(false)}>
                Exit tour
              </button>
              <div style={{ flex: '1 1 auto' }}></div>
              <button
                className="play-btn"
                id="tour-back-btn"
                type="button"
                disabled={tourStep === 0}
                onClick={() => setTourStep((s) => Math.max(0, s - 1))}
              >
                ‹ Back
              </button>
              <button
                className="play-btn"
                id="tour-next-btn"
                type="button"
                onClick={() => {
                  if (tourStep < narration.length - 1) setTourStep((s) => s + 1);
                  else setTourOpen(false);
                }}
              >
                {tourStep === narration.length - 1 ? 'Finish' : 'Next ›'}
              </button>
            </div>
          </div>
        </div>

        {/* Model-level parameter arithmetic, one branch per architecture — see paramPanel.ts. */}
        <div className="panel" id="param-count-panel" dangerouslySetInnerHTML={paramPanelHtml} />
      </div>

      <div className="tooltip" id="tooltip"></div>

      {/* The shared math modal. Always MOUNTED, never conditionally rendered — archExplorer
          resolves #math-content once at boot (it delegates the data-tip tooltips from it and
          queries the Router-cell sub-tabs inside it), and a remount would leave that reference
          pointing at a discarded node. Only the `open` class and the contents change. */}
      <div
        className={`math-modal-backdrop${mathStage ? ' open' : ''}`}
        id="math-backdrop"
        style={{ alignItems: 'center' }}
        onClick={(ev) => { if (ev.target === ev.currentTarget) closeMathModal(); }}
      >
        {/* Height-capped like the Router modal below (92vh, flex column, pinned header, scrolling
            body): the tall Attention steps used to push the whole modal — pills included — off
            screen and hand the scroll to the backdrop. Content is also sized to fit (adaptive
            cellPx via fitCellPx), so the body scrollbar is the short-window fallback, not the
            normal reading. */}
        <div className="math-modal" style={{ maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}>
          <div className="math-modal-header" style={{ flex: '0 0 auto' }}>
            <h3 id="math-modal-title">{mathStage ? mathStage.payload.title : 'Matrix arithmetic'}</h3>
            {/* Header slot: where a stage is NAMED, level with ✕, exactly like the Router modal's
                header — the Attention modal's "Attention" label + its step pills (attnSubTabBar),
                or a plain bold title for the stages that have no sub-tabs (stageTitleBar: both
                RMSNorms, both Residual adds, Final RMSNorm, Final Output). Stages that supply ''
                stay unnamed, and that '' is also what stops a stale bar outliving its panels. */}
            <div id="math-modal-header-slot" dangerouslySetInnerHTML={headerHtml} />
            <button className="math-modal-close" id="math-modal-close" onClick={closeMathModal}>✕</button>
          </div>
          {/* Stage content stays string-built (see archExplorer's StagePayload): the attention
              reveal addresses up to ~2,320 .mm-cells by query, and componentising them would add
              reconciliation to the heaviest panel in the app for no visible gain. */}
          <div
            className="math-modal-body"
            id="math-content"
            style={{ overflowY: 'auto', flex: '1 1 auto', minHeight: 0 }}
            dangerouslySetInnerHTML={bodyHtml}
          />
        </div>
      </div>

      <div
        className="math-modal-backdrop"
        id="moe-grid-backdrop"
        style={{ zIndex: 90, alignItems: 'center' }}
      >
        <div
          className="math-modal"
          // Two owners of maxHeight, one at a time: on Per-token React pins it to 92vh so the fan
          // gets the whole box (it scales into whatever it is given); on All-tokens React drops the
          // property and archExplorer's fitGridModalHeight shrink-wraps the heatmap.
          // `data-router-tab` used to be the CHANNEL that told that function which regime it was in
          // — it read the attribute back off this node. It no longer does (2026-08-02): the regime
          // is pushed in as an argument through `fitGridHeight` in the effect above. The attribute
          // stays as a plain state marker, which is what the S5 dump and exercise scripts address;
          // nothing in src/ reads it.
          data-router-tab={routerSubTab}
          style={{
            maxWidth: 1152,
            width: '78vw',
            maxHeight: routerSubTab === 'per-token' ? '92vh' : undefined,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Sub-tabs live IN the header, right of the title — they switch what the whole modal
              shows, so they belong to its chrome, not to the body's controls. `marginRight:auto`
              (not the header's default space-between) keeps them tucked against "Router" while the
              close button stays pinned right. */}
          <div className="math-modal-header" style={{ flex: '0 0 auto', gap: 14 }}>
            <h3 style={{ whiteSpace: 'nowrap' }}>Router</h3>
            <div className="sub-tabs" role="tablist" style={{ margin: 0, marginRight: 'auto' }}>
              <button
                className={`sub-tab${routerSubTab === 'per-token' ? ' active' : ''}`}
                type="button"
                role="tab"
                aria-selected={routerSubTab === 'per-token'}
                onClick={() => setRouterSubTab('per-token')}
              >
                Single token routing
              </button>
              <button
                className={`sub-tab${routerSubTab === 'all-tokens' ? ' active' : ''}`}
                type="button"
                role="tab"
                aria-selected={routerSubTab === 'all-tokens'}
                onClick={() => setRouterSubTab('all-tokens')}
              >
                All tokens routing
              </button>
            </div>
            {/* ▶ Step through layers lives in the header, left of ✕: it drives the shared layer
                pager, which both sub-tabs read, so it is modal chrome rather than a grid control —
                and stays visible on both of them.
                `marginLeft: 0` cancels .play-btn's margin-left:auto — the sub-tabs' marginRight:auto
                already claims the slack, and two autos would split it and float this mid-header. */}
            <button className="play-btn" id="play-btn" style={{ marginLeft: 0 }}>
              ▶ Step through layers
            </button>
            <button className="math-modal-close" id="moe-grid-close">✕</button>
          </div>
          <div
            className="math-modal-body"
            style={{
              overflowY: 'auto',
              flex: '1 1 auto',
              paddingTop: 10,
              // Column layout so the Per-token tab can claim the leftover height and scale its fan
              // into it, instead of overflowing and handing the body a scrollbar. The All-tokens
              // heatmap keeps flex:0 0 auto below, so it still scrolls when it is genuinely tall.
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
            }}
          >
            {/* This modal is the FFN router's, on every model. JetMoE's attention (MoA) router used
                to sit behind a "FFN router / Attention (MoA) router" toggle here — moved 2026-07-30
                into the Attention block's own math modal (step 2, "Expert routing"): it routes
                attention experts, so it belongs to the attention block, not to the MoE block this
                modal opens from. */}

            {/* Shared layer pager — React owns currentLayer; visible on both sub-tabs. Drives the
                imperative heatmap through the exposed setLayer hook.
                ▶ Replay routing (the old ⚡ Animate routing, renamed to match the per-token tab's
                button) rides this same row — `.play-btn`'s margin-left:auto pins it to the right
                edge, level with the layer numbers. It is CSS-hidden rather than unmounted on the
                per-token tab, so this modal's chrome is byte-identical on both — see the button
                itself for why that is now the reason rather than byId(). */}
            <div className="layer-bar" style={{ marginBottom: 6, flex: '0 0 auto' }}>
              <span className="label">Layer</span>
              <div className="layer-tabs">
                {Array.from({ length: flow.num_layers }, (_, l) => (
                  <button
                    key={l}
                    type="button"
                    className={`layer-tab${l === currentLayer ? ' active' : ''}`}
                    onClick={() => archApiRef.current?.setLayer(l)}
                  >
                    {l + 1}
                  </button>
                ))}
              </div>
              {/* One ▶ Replay routing slot, two owners — whichever sub-tab is showing supplies it,
                  so the button never moves. Both are plain React buttons now: the All-tokens one's
                  click used to be an `onclick` archExplorer assigned at boot, and calls the exposed
                  `animateRouting` instead as of 2026-08-02.
                  It is still only CSS-hidden rather than unmounted, and the reason changed with it:
                  not because byId() would throw (nothing resolves it any more), but so that the
                  Router modal's chrome is byte-identical on both sub-tabs — a button that appeared
                  and disappeared would be a DOM change this conversion is not allowed to make. The
                  id is retained as the handle the test harness addresses. */}
              <button
                className="play-btn"
                id="animate-route-btn"
                // ⚠ No `type="button"`: it would serialize as a new attribute and this button's
                // outerHTML is one of the things the S5 dump holds byte-identical.
                onClick={replayAllTokensRouting}
                style={{ display: routerSubTab === 'all-tokens' ? undefined : 'none' }}
              >
                ▶ Replay routing
              </button>
              {routerSubTab === 'per-token' && (
                <button
                  className="play-btn"
                  type="button"
                  onClick={() => perTokenReplay?.()}
                  disabled={!perTokenReplay}
                >
                  ▶ Replay routing
                </button>
              )}
            </div>

            {/* Per-token routing tab — remounts per prompt so a new prompt resets to its first
                token and replays the beats. */}
            <div
              style={
                routerSubTab === 'per-token'
                  ? { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 }
                  : { display: 'none' }
              }
            >
              <PerTokenRouting
                key={promptIndex}
                flow={flow}
                currentLayer={currentLayer}
                onReplayReady={registerPerTokenReplay}
              />
            </div>

            {/* All tokens tab — the existing imperative heatmap shell, untouched (same element IDs
                archExplorer.ts fills). Kept mounted so its state survives sub-tab switches. */}
            <div
              style={{
                display: routerSubTab === 'all-tokens' ? undefined : 'none',
                flex: '0 0 auto',
              }}
            >
              {/* One item only: each row now carries its own token's hue, so there is no single
                  colour to swatch and no activated/not pair to explain — the pop does that. */}
              <div className="scale-legend" style={{ margin: '0 0 6px' }}>
                <span className="item">
                  <span className="sw active"></span>darker = higher router %, across all{' '}
                  {flow.num_experts} experts; each row is coloured by its own token
                </span>
              </div>
              <svg
                className="moe-svg"
                id="moe-svg"
                viewBox="0 0 1040 460"
                xmlns="http://www.w3.org/2000/svg"
              >
                <text className="layer-caption" id="layer-caption" x="0" y="16"></text>
                <g id="rows-layer"></g>
                <g id="axis-layer"></g>
                <g id="routing-anim-layer"></g>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
