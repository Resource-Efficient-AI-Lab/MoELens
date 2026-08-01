import { useMemo } from 'react';
import type { PromptManifestEntry } from './usePromptFlow';
import { CATEGORY_LABELS } from '../../data/categories';
import { ARCH_MODELS, type ArchModelKey } from './models';

interface ArchPromptPickerProps {
  manifest: PromptManifestEntry[] | null;
  modelKey: ArchModelKey;
  promptIndex: number;
  loading: boolean;
  onModelChange: (key: ArchModelKey) => void;
  onPromptChange: (index: number) => void;
}

/** Groups manifest entries by domain, preserving first-seen domain order — feeds the <optgroup>s
 *  below. Only needs prompt text + domain, so it resolves before any prompt's tensors have loaded. */
function groupByDomain(entries: PromptManifestEntry[]): { domain: string; items: { promptText: string; index: number }[] }[] {
  const groups: { domain: string; items: { promptText: string; index: number }[] }[] = [];
  const byDomain = new Map<string, { promptText: string; index: number }[]>();
  entries.forEach((entry, index) => {
    let items = byDomain.get(entry.domain);
    if (!items) {
      items = [];
      byDomain.set(entry.domain, items);
      groups.push({ domain: entry.domain, items });
    }
    items.push({ promptText: entry.prompt, index });
  });
  return groups;
}

/**
 * The Model Architecture tab's Model + Prompt dropdowns. Rendered by MoeApp *above* the top-tab
 * bar (not inside the tab panel) so the reader picks what they're looking at before picking which
 * view of it they want — which is also why the selection state and usePromptFlow live in MoeApp.
 */
export function ArchPromptPicker({
  manifest,
  modelKey,
  promptIndex,
  loading,
  onModelChange,
  onPromptChange,
}: ArchPromptPickerProps) {
  const domainGroups = useMemo(() => (manifest ? groupByDomain(manifest) : []), [manifest]);

  return (
    <div className="prompt-picker">
      <label htmlFor="model-select">Model</label>
      <select
        id="model-select"
        style={{ minWidth: 190 }}
        value={modelKey}
        onChange={(e) => onModelChange(e.target.value as ArchModelKey)}
      >
        {ARCH_MODELS.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
      <label htmlFor="prompt-select">Prompt</label>
      <select
        id="prompt-select"
        value={promptIndex}
        onChange={(e) => onPromptChange(Number(e.target.value))}
      >
        {domainGroups.map(({ domain, items }) => (
          <optgroup key={domain} label={CATEGORY_LABELS[domain] ?? domain}>
            {items.map(({ promptText, index }) => (
              <option key={index} value={index}>
                {promptText}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      {/* Mid-fetch on a same-model prompt switch (split models): the panel below still shows the
          previous prompt while this loads, so surface it here instead of blanking the panel
          (see usePromptFlow.ts). */}
      {loading && <span className="math-hint" style={{ margin: 0 }}>Loading prompt…</span>}
    </div>
  );
}
