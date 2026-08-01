import { CATEGORY_LABELS } from '../../data/categories';
import { CATEGORY_PALETTE } from '../../components/ClusterPlot/categoryPalette';
import type { DomainSpecializationData } from '../../data/types';

/** Sub-tab 6 — the passage behind each category's numbers. Not filtered by the shared picker. */
export function PromptsSection({ data }: { data: DomainSpecializationData }) {
  return (
    <div>
      <p className="max-w-[62ch] font-body text-base leading-relaxed text-ink">
        The real passage each category's routing statistics were computed from.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.domains.map((category) => {
          const color = CATEGORY_PALETTE[category] ?? 'var(--color-muted)';
          const label = CATEGORY_LABELS[category] ?? category;
          return (
            <div key={category} className="rounded-md border border-ink/10 bg-paper p-3">
              <h5 className="mb-1.5 font-title text-sm font-semibold" style={{ color }}>
                {label}
              </h5>
              <div className="max-h-56 overflow-y-auto pr-1 font-body text-sm leading-relaxed text-ink/80">
                {data.example_prompts[category].map((p, i) => (
                  <p key={i} className={i > 0 ? 'mt-2' : undefined}>
                    {p}
                  </p>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
