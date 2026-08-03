import { useState } from 'react';
import { CATEGORY_LABELS } from '../../data/categories';
import { CATEGORY_PALETTE } from '../../components/ClusterPlot/categoryPalette';
import type { DomainSpecializationData } from '../../data/types';

/**
 * One category's passages behind a numbered pill row. Each category ships five ~400-token
 * passages, so showing them stacked in one scroll box (what this did while there was a single
 * passage per category) would put roughly 150 lines behind a 224px scroller. One passage is
 * visible at a time instead; the pill row is only rendered when there is more than one, so a
 * regenerated-from-older data file still reads correctly.
 *
 * Paragraphs are split on the '\n\n' inside each passage — the notebook joins a passage's four
 * paragraphs with it, and rendering the raw string would collapse them into one block.
 */
function PromptCard({ category, prompts }: { category: string; prompts: string[] }) {
  const [active, setActive] = useState(0);
  const color = CATEGORY_PALETTE[category] ?? 'var(--color-muted)';
  const label = CATEGORY_LABELS[category] ?? category;
  const shown = prompts[Math.min(active, prompts.length - 1)] ?? '';

  return (
    <div className="rounded-md border border-ink/10 bg-paper p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h5 className="font-title text-sm font-semibold" style={{ color }}>
          {label}
        </h5>
        {prompts.length > 1 && (
          <div className="flex gap-1" role="tablist" aria-label={`${label} passages`}>
            {prompts.map((_, i) => (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === active}
                aria-label={`${label} passage ${i + 1}`}
                onClick={() => setActive(i)}
                className={
                  'h-5 w-5 rounded-full border font-label text-[0.65rem] leading-none ' +
                  (i === active
                    ? 'border-transparent text-paper'
                    : 'border-ink/15 text-muted hover:border-ink/35 hover:text-ink')
                }
                style={i === active ? { backgroundColor: color } : undefined}
              >
                {i + 1}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="max-h-72 overflow-y-auto pr-1 font-body text-sm leading-relaxed text-ink/80">
        {shown.split('\n\n').map((para, i) => (
          <p key={i} className={i > 0 ? 'mt-2' : undefined}>
            {para}
          </p>
        ))}
      </div>
    </div>
  );
}

/** Sub-tab 6 — the passages behind each category's numbers. Not filtered by the shared picker. */
export function PromptsSection({ data }: { data: DomainSpecializationData }) {
  const perCategory = data.domains.reduce(
    (n, c) => Math.max(n, data.example_prompts[c]?.length ?? 0),
    0
  );

  return (
    <div>
      <p className="max-w-[62ch] font-body text-base leading-relaxed text-ink">
        The real passages each category&rsquo;s routing statistics were computed from
        {perCategory > 1
          ? ` — ${perCategory} per category, run through the model one after another and counted together.`
          : '.'}
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {data.domains.map((category) => (
          <PromptCard
            key={category}
            category={category}
            prompts={data.example_prompts[category] ?? []}
          />
        ))}
      </div>
    </div>
  );
}
