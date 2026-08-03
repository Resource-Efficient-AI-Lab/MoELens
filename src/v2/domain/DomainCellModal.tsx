import { useEffect } from 'react';
import { CATEGORY_LABELS } from '../../data/categories';
import { CATEGORY_PALETTE } from '../../components/ClusterPlot/categoryPalette';
import type { DomainSpecializationData } from '../../data/types';

export interface DomainCell {
  category: string;
  layer: number;
  expert: number;
}

interface DomainCellModalProps {
  data: DomainSpecializationData;
  cell: DomainCell;
  onClose: () => void;
}

/**
 * The click-for-exact-numbers modal, mirroring the prototype's openDomainCell — real count/total,
 * normalized rate, avg_prob, plus specialization_score as a "N× the 6-category average" phrase.
 * Triggered from a Histogram bar or a Top-experts specialist row.
 *
 * The prototype's `layer divergence vs. baseline` line was removed 2026-07-31 by request: it is a
 * per-(category, layer) number, identical for every expert in the modal's layer, so it read as a
 * property of this cell when it is not one. `layer_divergence` is still in the JSON data, but the
 * type field and every consumer are gone (2026-08-01 dead-code cleanup).
 */
export function DomainCellModal({ data, cell, onClose }: DomainCellModalProps) {
  const { category, layer, expert } = cell;
  const label = CATEGORY_LABELS[category] ?? category;
  const color = CATEGORY_PALETTE[category] ?? 'var(--color-muted)';

  useEffect(() => {
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const total = data.token_counts[category];
  const rate = data.activation_rate[category][layer][expert];
  const count = Math.round(rate * total);
  const normalized = (rate / data.top_k_experts) * 100;
  const avgProb = data.avg_prob[category][layer][expert] * 100;
  const specScore = data.specialization_score[category][layer][expert];
  const fold = Math.pow(2, specScore);

  const pairs = data.expert_token_idx[category]?.[layer]?.[expert] ?? [];
  const tokens = data.domain_tokens[category] ?? [];
  // expert_token_idx is already capped in the notebook (40 highest-scoring pairs per cell), so
  // its length is not the number of tokens that routed here — expert_token_count is. Older data
  // files ship no such key and their arrays are untruncated, hence the fallback. `cap` stays as
  // this component's own display guard; against capped data it never binds.
  const routed = data.expert_token_count?.[category]?.[layer]?.[expert] ?? pairs.length;
  const cap = 60;
  const chips = pairs.slice(0, cap).map(([idx]) => tokens[idx]);
  const overflow = Math.max(0, routed - chips.length);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`${label} to expert ${expert + 1}, layer ${layer + 1} detail`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[80vh] w-full max-w-md overflow-y-auto rounded-md bg-paper p-5 shadow-overlay-float">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-title text-base font-semibold text-ink">
            &ldquo;{label}&rdquo; → expert #{expert + 1} · layer {layer + 1}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-sm p-1 font-body text-sm text-muted hover:bg-surface hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span
            className="rounded-full border px-2.5 py-1 font-label text-xs font-semibold"
            style={{ borderColor: color, color }}
          >
            {label}
          </span>
          <span className="rounded-full border border-ink/10 px-2.5 py-1 font-label text-xs text-muted">
            layer {layer + 1} / {data.num_layers}
          </span>
          <span className="rounded-full border border-ink/10 px-2.5 py-1 font-label text-xs text-muted">
            expert #{expert + 1}
          </span>
        </div>

        <div className="mt-4 space-y-1.5 font-body text-sm leading-relaxed text-ink">
          <p>
            {label} chose expert #{expert + 1} for <span className="font-label font-semibold">{count}</span> of{' '}
            <span className="font-label font-semibold">{total}</span> tokens.
          </p>
          <p>
            domain rate = {count} ÷ {total} ={' '}
            <span className="font-label font-semibold">{(rate * 100).toFixed(2)}%</span>
          </p>
          <p>
            normalized (÷ top-{data.top_k_experts}, sums to 100% across all {data.num_experts}) ={' '}
            <span className="font-label font-semibold">{normalized.toFixed(2)}%</span>
          </p>
          <p>
            avg softmax probability (selected or not) ={' '}
            <span className="font-label font-semibold">{avgProb.toFixed(2)}%</span>
          </p>
        </div>

        <div className="mt-3 rounded-sm bg-surface p-3 font-body text-sm leading-relaxed text-ink">
          Specialization score: this expert fires <span className="font-semibold">{fold.toFixed(2)}×</span> the
          6-category average for (layer {layer + 1}, expert #{expert + 1}).
        </div>

        <div className="mt-4">
          <p className="font-label text-[0.65rem] uppercase tracking-wide text-muted">
            Real tokens routed here ({routed})
          </p>
          {chips.length > 0 ? (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {chips.map((t, i) => (
                <span key={i} className="rounded-sm bg-surface px-1.5 py-0.5 font-label text-xs text-ink">
                  {t.trim() || '␣'}
                </span>
              ))}
              {overflow > 0 && (
                <span className="px-1.5 py-0.5 font-label text-xs text-muted">+{overflow} more</span>
              )}
            </div>
          ) : (
            <p className="mt-1.5 font-body text-xs text-muted">
              None: no token in the {label} passages selected this expert at this layer.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
