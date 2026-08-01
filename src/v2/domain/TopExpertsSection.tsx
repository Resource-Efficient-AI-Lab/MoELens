import { CATEGORY_LABELS } from '../../data/categories';
import { CATEGORY_PALETTE } from '../../components/ClusterPlot/categoryPalette';
import type { DomainSpecializationData } from '../../data/types';

interface TopExpertsSectionProps {
  data: DomainSpecializationData;
  /** Jumps the shared layer there and opens DomainCellModal for the exact numbers. */
  onSelect: (category: string, layer: number, expert: number) => void;
}

/**
 * Sub-tab 5 — each category's top 8 (layer, expert) pairs by raw activation_rate, ranked
 * directly (no baseline comparison). Not filtered by the shared picker — all six always show.
 */
export function TopExpertsSection({ data, onSelect }: TopExpertsSectionProps) {
  return (
    <div>
      <p className="math-hint" style={{ margin: '0 0 8px' }}>
        Each category's most-specialized experts, ranked by how often its own tokens route there,
        with no baseline comparison. Click a row to jump the shared layer there and see the exact
        numbers.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.domains.map((category) => {
          const color = CATEGORY_PALETTE[category] ?? 'var(--color-muted)';
          const label = CATEGORY_LABELS[category] ?? category;
          return (
            <div key={category} className="rounded-md border p-3.5" style={{ borderColor: color }}>
              <h4 className="mb-2 font-title text-sm font-semibold" style={{ color }}>
                {label}
              </h4>
              <div>
                {data.top_specialists[category].slice(0, 8).map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => onSelect(category, s.layer, s.expert)}
                    className="flex w-full items-baseline justify-between border-t border-ink/10 py-1.5 font-label text-xs first:border-t-0 hover:bg-surface"
                  >
                    <span className="text-muted">
                      layer {s.layer + 1} · e{s.expert + 1}
                    </span>
                    <span className="font-semibold" style={{ color }}>
                      {(s.activation_rate * 100).toFixed(1)}%
                    </span>
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
