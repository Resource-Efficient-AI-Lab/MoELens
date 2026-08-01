import { useEffect, useMemo, useRef, useState } from 'react';
import { RouterDiagram } from '../../components/Journey/RouterDiagram';
import { usePrefersReducedMotion } from '../../utils/usePrefersReducedMotion';
import type { PromptFlow } from './types';

type Stage = 0 | 1 | 2 | 3 | 4;

/** Beat offsets (ms from the trigger) — identical to the parked JourneyStage timing.
 *  Index i drives stage i+1: 1 token arrives, 2 scores computed, 3 top-8 fire, 4 weights shown. */
const BEAT_OFFSETS = [120, 370, 770, 1170];

/** Spell out small counts so the caption reads naturally ("the other seven" / "the other five"),
 *  matching the original OLMoE copy while staying correct for DeepSeek (top-6) and JetMoE (top-2). */
const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
function numberWord(n: number): string {
  return NUMBER_WORDS[n] ?? String(n);
}

/** Fixed green (same swatch as the Embedding block's token chips) for the token-chip row below. */
function chipColor(): string {
  const root = document.querySelector('.moe-root');
  if (!root) return '#888';
  return getComputedStyle(root).getPropertyValue('--series-4').trim() || '#888';
}

interface PerTokenRoutingProps {
  flow: PromptFlow;
  /** 0-based layer, the modal's shared React-owned `currentLayer`. */
  currentLayer: number;
  /** Hands the beat-replay trigger up to the modal, which renders ▶ Replay routing in the shared
   *  layer row so it sits exactly where the All-tokens tab's replay button does. `null` means there
   *  is nothing to replay (reduced motion, or a dense layer with no fan). */
  onReplayReady?: (replay: (() => void) | null) => void;
}

/**
 * The "Per-token routing" sub-tab of the Router modal: a token-chip row picks which token to
 * follow, and the parked `RouterDiagram` fan shows that token being routed to its top-8 experts
 * for the shared current layer. Changing token replays the full 1→4 beat sequence; changing layer
 * snaps straight to the settled stage 4; ▶ Replay re-runs the beats on demand. Under reduced
 * motion everything pins to stage 4 with no halo.
 */
export function PerTokenRouting({ flow, currentLayer, onReplayReady }: PerTokenRoutingProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [followTokenIdx, setFollowTokenIdx] = useState(0);
  const [stage, setStage] = useState<Stage>(reducedMotion ? 4 : 0);
  const [replayNonce, setReplayNonce] = useState(0);

  // The FFN router, on every model. JetMoE's attention (MoA) router used to be selectable here via
  // a `source` prop; it moved to the Attention block's math modal (step 2) on 2026-07-30.
  const expertCount = flow.num_experts;
  const routingLayers = flow.layers;

  // Replay the beats whenever the followed token changes (mount counts as the first token change)
  // or the ▶ Replay button is pressed. Layer changes are handled separately (they only snap).
  useEffect(() => {
    if (reducedMotion) {
      setStage(4);
      return;
    }
    setStage(0);
    const timers = BEAT_OFFSETS.map((ms, i) => setTimeout(() => setStage((i + 1) as Stage), ms));
    return () => timers.forEach(clearTimeout);
  }, [followTokenIdx, replayNonce, reducedMotion]);

  // Layer change → snap instantly to the fully-lit stage 4 (no beats). Skipped on mount so it
  // doesn't clobber the first token's beat sequence started by the effect above.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    setStage(4);
  }, [currentLayer]);

  // DeepSeek's dense layer carries `tokens: null` — read null-safely so the hooks below still run
  // unconditionally (the dense early-return comes after every hook).
  const layerTokens = routingLayers[currentLayer]?.tokens ?? null;
  const tok = layerTokens ? layerTokens[followTokenIdx] : null;
  // top_experts / top_weights aren't pre-sorted by weight (the heatmap sorts them for its readout),
  // so order them here — RouterDiagram treats expertIds[0] as the lead expert (halo + caption).
  const { expertIds, scores, topExpertId, topScore } = useMemo(() => {
    if (!tok) return { expertIds: [], scores: [], topExpertId: 0, topScore: 0 };
    const pairs = tok.top_experts
      .map((e, k) => ({ e, w: tok.top_weights[k] }))
      .sort((a, b) => b.w - a.w);
    return {
      expertIds: pairs.map((p) => p.e),
      scores: pairs.map((p) => p.w),
      topExpertId: pairs[0]?.e ?? 0,
      topScore: pairs[0]?.w ?? 0,
    };
  }, [tok]);

  // Publish (or retract) the replay trigger for the modal's shared layer row. Declared above the
  // dense early-return so it stays an unconditional hook.
  const canReplay = !reducedMotion && !!layerTokens;
  useEffect(() => {
    onReplayReady?.(canReplay ? () => setReplayNonce((n) => n + 1) : null);
    return () => onReplayReady?.(null);
  }, [onReplayReady, canReplay]);

  if (!layerTokens) {
    return (
      <div className="ptr-dense-note">
        <p className="ptr-header">Layer {currentLayer + 1} of {flow.num_layers} · dense layer</p>
        <p className="ptr-caption-body">
          This is a dense feed-forward layer, every token runs through one shared network, so there
          is no router and no per-token expert selection to follow. Pick any later layer to watch
          routing.
        </p>
      </div>
    );
  }

  const tokenLabel = flow.tokens[followTokenIdx].text;
  const followLabel = tokenLabel.trim() || '(space)';

  return (
    <div className="ptr-root">
      <div className="ptr-chip-row">
        {flow.tokens.map((t, i) => (
          <button
            key={i}
            type="button"
            className={`ptr-chip${i === followTokenIdx ? ' active' : ''}`}
            style={{ ['--chip-color' as string]: chipColor() }}
            onClick={() => setFollowTokenIdx(i)}
          >
            {t.text.trim() || '(space)'}
          </button>
        ))}
      </div>

      <p className="ptr-header">
        Layer {currentLayer + 1} of {flow.num_layers} · following “{followLabel}”
      </p>

      <div className="ptr-fan">
        <RouterDiagram
          expertIds={expertIds}
          scores={scores}
          stage={stage}
          tokenLabel={tokenLabel}
          pulseTopExpert={!reducedMotion}
          expertCount={expertCount}
        />
      </div>

      <div className="ptr-caption">
        <div className="ptr-eyebrow">LAYER {currentLayer + 1} · ROUTING</div>
        <h4 className="ptr-caption-title">Each active expert gets a weight</h4>
        <p className="ptr-caption-body">
          Expert {topExpertId + 1} matches best, at weight {topScore.toFixed(2)}.{' '}
          {expertIds.length > 1
            ? `The other ${numberWord(expertIds.length - 1)} still ${expertIds.length - 1 === 1 ? 'contributes' : 'contribute'}, just less. Combined, their outputs become this token’s result for the layer.`
            : 'It is the only expert selected for this token. Its output becomes this token’s result for the layer.'}
        </p>
      </div>
    </div>
  );
}
