import { DOMAIN_MODELS, type DomainModelKey } from './models';

interface DomainModelPickerProps {
  modelKey: DomainModelKey;
  onModelChange: (key: DomainModelKey) => void;
}

/**
 * The Domain Specialization tab's Model dropdown. Rendered by MoeApp *above* the top-tab bar (not
 * inside the tab panel), mirroring ArchPromptPicker: the reader picks what they're looking at
 * before picking which view of it they want.
 *
 * The prototype's "Expert specialization by domain" `<h2>` sat beside the dropdown here and was
 * removed 2026-08-02 by request — a deliberate divergence from `index_v2.html` (line 554), so keep
 * it out when diffing. The tab bar's own "Domain Specialization" label already names the panel,
 * and the sub-tab bar directly below names the view.
 */
export function DomainModelPicker({ modelKey, onModelChange }: DomainModelPickerProps) {
  return (
    <div className="prompt-picker">
      <label htmlFor="domain-model-select">Model</label>
      <select
        id="domain-model-select"
        style={{ minWidth: 190 }}
        value={modelKey}
        onChange={(e) => onModelChange(e.target.value as DomainModelKey)}
      >
        {DOMAIN_MODELS.map((m) => (
          <option key={m.key} value={m.key}>
            {m.label}
          </option>
        ))}
      </select>
    </div>
  );
}
