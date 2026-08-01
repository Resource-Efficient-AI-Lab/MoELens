import { DOMAIN_MODELS, type DomainModelKey } from './models';

interface DomainModelPickerProps {
  modelKey: DomainModelKey;
  onModelChange: (key: DomainModelKey) => void;
}

/**
 * The Domain Specialization tab's Model dropdown, plus the tab's title beside it. Rendered by
 * MoeApp *above* the top-tab bar (not inside the tab panel), mirroring ArchPromptPicker: the
 * reader picks what they're looking at before picking which view of it they want.
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
      <h2 style={{ fontSize: 15, fontWeight: 700, margin: 0 }}>Expert specialization by domain</h2>
    </div>
  );
}
