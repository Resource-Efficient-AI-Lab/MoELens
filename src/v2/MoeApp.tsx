import { useState } from 'react';
import './moe.css';
import { useCategoryMultiSelect } from '../components/ClusterPlot/CategoryTogglePicker';
import { CATEGORIES } from '../data/categories';
import { ArchitectureTab } from './arch/ArchitectureTab';
import { ArchPromptPicker } from './arch/ArchPromptPicker';
import { usePromptFlow } from './arch/usePromptFlow';
import { DEFAULT_MODEL_KEY, type ArchModelKey } from './arch/models';
import { DomainTab } from './domain/DomainTab';
import { DomainModelPicker } from './domain/DomainModelPicker';
import { DEFAULT_DOMAIN_MODEL_KEY, type DomainModelKey } from './domain/models';

type TopTab = 'explorer' | 'domain';

/**
 * The v2 shell — a React recreation of the teammate's index_v2.html prototype: title header +
 * two mutually-exclusive top tabs. Model Architecture stays mounted but hidden on switch (its
 * imperative explorer keeps layer/tour state, like the prototype); Domain Specialization
 * unmounts so its entrance animations replay on every open.
 */
export function MoeApp() {
  const [tab, setTab] = useState<TopTab>('explorer');
  // The Architecture tab's currently-selected prompt's category — the Domain Specialization
  // tab's shared picker (sub-tabs 2-4) reads this once on mount as its default-selected
  // category. One-way sync only; Domain Specialization never writes back.
  const [archCategory, setArchCategory] = useState('code');
  // The Domain Specialization tab's model, lifted here because that tab unmounts on every
  // top-tab switch — otherwise the user's model choice would reset to OLMoE on every visit.
  // Deliberately independent of the Architecture tab's own model dropdown: the two tabs read
  // different data files and the reader may well want to compare across them.
  const [domainModelKey, setDomainModelKey] = useState<DomainModelKey>(DEFAULT_DOMAIN_MODEL_KEY);
  // The Experts UMAP sub-tab's own category picker (independent of that tab's shared picker).
  // Lifted all the way up here for the same reason as the model key: its section unmounts on every
  // sub-tab switch and the whole tab unmounts on every top-tab switch, either of which would throw
  // the reader's selection away. `domainModelKey` as the reset key makes a model switch — and only
  // a model switch — reset it back to all six categories.
  // Starts with every category on, like the Domain tab's shared picker: the whole map is the
  // reading, and the pills subtract from it rather than build it up. `syncTo` is a constant
  // (never the header category) so nothing collapses the set back to one behind the reader.
  const umapPicker = useCategoryMultiSelect('code', CATEGORIES, domainModelKey);
  // The Architecture tab's model + prompt selection lives here because its dropdowns sit *above*
  // the top-tab bar (you pick what you're looking at, then which view of it). The tab itself just
  // consumes the resulting flow.
  const [archModelKey, setArchModelKey] = useState<ArchModelKey>(DEFAULT_MODEL_KEY);
  const [promptIndex, setPromptIndex] = useState(0);
  const { manifest, flow, loading, error } = usePromptFlow(archModelKey, promptIndex);

  return (
    <div className="moe-root">
      <div className="moe-wrap">
        <header className="full-bleed">
          <h1 className="app-title">
            <span className="app-title-mark">MoE-Lens</span>{' '}
            <span className="app-title-desc">A Mixture-of-Experts Visualizer</span>
          </h1>
        </header>

        {tab === 'explorer' && (
          <ArchPromptPicker
            manifest={manifest}
            modelKey={archModelKey}
            promptIndex={promptIndex}
            loading={loading}
            onModelChange={setArchModelKey}
            onPromptChange={setPromptIndex}
          />
        )}

        {tab === 'domain' && (
          <DomainModelPicker modelKey={domainModelKey} onModelChange={setDomainModelKey} />
        )}

        <div className="top-tabs">
          <button
            className={`top-tab${tab === 'explorer' ? ' active' : ''}`}
            type="button"
            onClick={() => setTab('explorer')}
          >
            Model Architecture
          </button>
          <button
            className={`top-tab${tab === 'domain' ? ' active' : ''}`}
            type="button"
            onClick={() => setTab('domain')}
          >
            Domain Specialization Analysis
          </button>
        </div>

        <ArchitectureTab
          visible={tab === 'explorer'}
          flow={flow}
          promptIndex={promptIndex}
          error={error}
          onDomainChange={setArchCategory}
        />
        {tab === 'domain' && (
          <DomainTab
            syncCategory={archCategory}
            modelKey={domainModelKey}
            umapActive={umapPicker.active}
            onUmapToggle={umapPicker.toggle}
          />
        )}
      </div>
    </div>
  );
}
