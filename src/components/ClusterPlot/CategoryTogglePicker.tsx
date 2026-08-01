import { useCallback, useState } from 'react';
import { CATEGORY_LABELS } from '../../data/categories';
import { CATEGORY_PALETTE } from './categoryPalette';

/**
 * Multi-select category state for the Experts UMAP sub-tab. Unlike the exclusive
 * pair-picker the Compare panel uses, this lets the reader progressively add up to all
 * six categories to the scatter at once.
 *
 * `syncTo` is the global header category: whenever it changes, the active set collapses
 * back to just that one category (the header stays authoritative). That reset happens
 * during render — via the "adjust state during render" pattern rather than useEffect —
 * so the selection is corrected before paint, avoiding a one-frame flash of the stale
 * set on a 1024-dot scatter.
 *
 * `resetKey` is an optional second reset trigger, back to `initialActive`: the Experts UMAP
 * picker lives in MoeApp (so it survives that tab's unmount and its own sub-tab's unmount) and
 * passes the domain model key, which is the one event that should clear its selection. Callers
 * that own their state below a `key={…}` boundary don't need it — remounting already resets them.
 * `syncTo` wins when both change in one render, matching the precedence from before this existed.
 */
export function useCategoryMultiSelect(syncTo: string, initialActive?: string[], resetKey?: string) {
  const [active, setActive] = useState<Set<string>>(() => new Set(initialActive ?? [syncTo]));
  const [syncedFrom, setSyncedFrom] = useState(syncTo);
  const [resetFrom, setResetFrom] = useState(resetKey);

  // Adjust-state-during-render: collapse to the new global category before paint.
  if (syncTo !== syncedFrom) {
    setSyncedFrom(syncTo);
    setActive(new Set([syncTo]));
  } else if (resetKey !== resetFrom) {
    setResetFrom(resetKey);
    setActive(new Set(initialActive ?? [syncTo]));
  }

  const toggle = useCallback((category: string) => {
    setActive((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        // Never drop below one active category.
        if (next.size === 1) return prev;
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  }, []);

  return { active, toggle };
}

interface CategoryTogglePickerProps {
  categories: string[];
  active: Set<string>;
  onToggle: (category: string) => void;
}

/**
 * One pill per category — multi-toggle (aria-pressed) rather than exclusive-radio. An
 * active pill's background is its palette color, so these pills double as the plot's
 * legend. The sole remaining active pill is disabled (toggling it off is a no-op) but
 * stays fully colored — it reads as "already on," not "unavailable."
 */
export function CategoryTogglePicker({ categories, active, onToggle }: CategoryTogglePickerProps) {
  const soleActive = active.size === 1;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {categories.map((category) => {
        const isActive = active.has(category);
        const isSole = isActive && soleActive;
        return (
          <button
            key={category}
            type="button"
            onClick={() => onToggle(category)}
            disabled={isSole}
            aria-pressed={isActive}
            className={`rounded-full px-2.5 py-1 font-body text-xs font-medium transition-colors duration-150 ${
              isSole ? 'cursor-default' : ''
            } ${isActive ? '' : 'bg-surface text-muted hover:text-ink'}`}
            style={
              isActive
                ? { backgroundColor: CATEGORY_PALETTE[category], color: 'var(--color-paper)' }
                : undefined
            }
          >
            {CATEGORY_LABELS[category] ?? category}
          </button>
        );
      })}
    </div>
  );
}
