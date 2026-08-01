import { useCallback, useEffect, useRef, useState } from 'react';
import { bootArchExplorer, type ArchExplorerApi } from './archExplorer';
import { PerTokenRouting } from './PerTokenRouting';
import type { PromptFlow } from './types';

type RouterSubTab = 'per-token' | 'all-tokens';

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

  useEffect(() => {
    if (!flow) return;
    const api = bootArchExplorer(flow, { onLayerChange: setCurrentLayer });
    archApiRef.current = api;
    setCurrentLayer(0); // a re-boot (prompt change) resets the explorer to layer 1
    return () => {
      api.cleanup();
      archApiRef.current = null;
    };
  }, [flow]);

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
  useEffect(() => {
    if (routerSubTab === 'all-tokens') {
      archApiRef.current?.replayPop();
      archApiRef.current?.fitGridHeight();
    }
  }, [routerSubTab, flow]);

  // Escape closes whichever modal is open (document-level in the prototype's bootstrap).
  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        document.getElementById('math-backdrop')?.classList.remove('open');
        document.getElementById('moe-grid-backdrop')?.classList.remove('open');
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

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
          For the selected prompt <code className="inline" id="prompt-text"></code>, every token
          is scored against {scopeCopy}. Each
          row below is one token's full router softmax across all {flow.num_experts} experts.
        </p>
        <div className="panel">
          <div className="flow-header">
            {/* "‹ Transformer Block N ›" label — centered, level with Start tour; filled by archExplorer. */}
            <div id="flow-block-label" className="flow-block-label"></div>
            <button className="play-btn" id="start-tour-btn" type="button">▶ Start tour</button>
          </div>

          <div className="pdf-scroll">
            <div className="pdf-flow-row" id="pdf-flow-row"></div>
          </div>
        </div>

        <div className="tour-overlay" id="tour-overlay">
          <div className="tour-card">
            <div className="tour-step-label" id="tour-step-label"></div>
            <h3 id="tour-title"></h3>
            <p id="tour-text"></p>
            <div className="tour-controls">
              <button className="play-btn" id="tour-exit-btn" type="button">Exit tour</button>
              <div style={{ flex: '1 1 auto' }}></div>
              <button className="play-btn" id="tour-back-btn" type="button">‹ Back</button>
              <button className="play-btn" id="tour-next-btn" type="button">Next ›</button>
            </div>
          </div>
        </div>

        <div className="panel" id="param-count-panel"></div>
      </div>

      <div className="tooltip" id="tooltip"></div>

      <div className="math-modal-backdrop" id="math-backdrop">
        <div className="math-modal">
          <div className="math-modal-header">
            <h3 id="math-modal-title">Matrix arithmetic</h3>
            {/* Header slot filled imperatively by openFlowStage (archExplorer.ts) for stages that
                own sub-tabs — today the Attention modal's "Attention" label + its three step pills.
                They name and navigate the whole modal, so they belong to its chrome, level with ✕,
                exactly like the Router modal's header. Cleared on every other stage and by
                renderMath, so a stale bar can never outlive the content that put it there. */}
            <div id="math-modal-header-slot"></div>
            <button className="math-modal-close" id="math-modal-close">✕</button>
          </div>
          <div className="math-modal-body" id="math-content"></div>
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
          // property and archExplorer's fitGridModalHeight shrink-wraps the heatmap. `data-router-tab`
          // is what tells that function which regime it is in.
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
                per-token tab: archExplorer.ts resolves #animate-route-btn once at boot and byId()
                throws on a missing node. */}
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
                  so the button never moves. The All-tokens one keeps its imperative id and is only
                  CSS-hidden (archExplorer.ts resolves #animate-route-btn once at boot and byId()
                  throws on a missing node); the Per-token one is plain React and unmounts. */}
              <button
                className="play-btn"
                id="animate-route-btn"
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
              <div className="legend" id="token-legend" style={{ margin: '8px 0 6px' }}></div>
              {/* One item only: each row now carries its own token's hue, so there is no single
                  colour to swatch and no activated/not pair to explain — the pop does that. */}
              <div className="scale-legend" style={{ margin: '0 0 6px' }}>
                <span className="item">
                  <span className="sw active"></span>darker = higher router %, across all{' '}
                  {flow.num_experts} experts; each row is coloured by its own token
                </span>
              </div>
              <p
                className="math-hint"
                id="moe-grid-narration"
                style={{ margin: '0 0 8px', fontWeight: 600, color: 'var(--text-primary)' }}
              ></p>
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
