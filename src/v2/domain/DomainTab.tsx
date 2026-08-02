import { useState } from 'react';
import { useDomainSpecialization } from '../../data/useDomainSpecialization';
import { useDomainUmap } from '../../data/useDomainUmap';
import { CATEGORIES } from '../../data/categories';
import {
  useCategoryMultiSelect,
  CategoryTogglePicker,
} from '../../components/ClusterPlot/CategoryTogglePicker';
import { ClusterPlot } from '../../components/ClusterPlot/ClusterPlot';
import { DomainCellModal, type DomainCell } from './DomainCellModal';
import { AllCategoriesModal } from './AllCategoriesModal';
import { DomainRateChart } from './DomainRateChart';
import { HistogramSection } from './HistogramSection';
import { ExpertGridSection } from './ExpertGridSection';
import { TopExpertsSection } from './TopExpertsSection';
import { PromptsSection } from './PromptsSection';
import { LayerSlider } from './LayerSlider';
import { firstMoeLayer } from '../../utils/domainStats';
import { type DomainModelKey } from './models';
import type { DomainSpecializationData } from '../../data/types';

type SubTab = 'map' | 'rate' | 'histogram' | 'specialists' | 'prompts';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'map', label: 'Experts UMAP' },
  { id: 'rate', label: 'Avg. Activation rate per layer' },
  { id: 'histogram', label: 'Experts activation rates per layer' },
  { id: 'specialists', label: 'Top experts per category' },
  { id: 'prompts', label: 'Prompts' },
];

/** The two ways sub-tab 3 can draw one category's per-expert activation rates at one layer.
 *  Both read the identical `activation_rate[category][layer]` row, so this is purely a choice
 *  of mark: heat tiles in expert order, or bars. `grid` used to be a sub-tab of its own,
 *  mislabelled "UMAP Expert Grid" (it has never contained a UMAP — that's sub-tab 1). */
type ViewMode = 'grid' | 'histogram';

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'grid', label: 'Heatmap grid' },
  { id: 'histogram', label: 'Histogram' },
];

// The shared picker's pill list (sub-tabs 2-3): the six real categories. Sub-tab 1's own
// picker uses CATEGORIES directly.
const SHARED_PICKER_CATEGORIES = CATEGORIES;

interface DomainTabProps {
  syncCategory: string;
  /** Lifted to MoeApp because this tab unmounts on every top-tab switch (see MoeApp.tsx), and
   *  because its dropdown is rendered there — above the top-tab bar (see DomainModelPicker). */
  modelKey: DomainModelKey;
  /** The Experts UMAP sub-tab's own picker, lifted to MoeApp for the same unmount reason: it must
   *  survive both a sub-tab switch (its section unmounts) and a top-tab switch (this whole tab
   *  does), and reset only on a model switch. */
  umapActive: Set<string>;
  onUmapToggle: (category: string) => void;
}

/**
 * The "Domain Specialization" tab: five sub-tabs over one model's domain data — Experts UMAP,
 * Avg. Layers Activation Rates, Experts activation rates per layer, Top experts per category,
 * and Prompts.
 * Sub-tabs 2-3 share one category picker; sub-tab 3 also owns the layer slider and a
 * heat-grid/histogram view toggle; sub-tab 1 keeps its own independent picker; sub-tabs 4-5
 * aren't filtered at all.
 *
 * The Model dropdown (mirroring the Model Architecture tab's) sits above the top-tab bar and is
 * rendered by MoeApp — see DomainModelPicker. All three models ship the same two files from the same six-passage run, so every model gets
 * every sub-tab — see models.ts. Layer/expert/top-k counts differ per model (16×64 top-8,
 * 24×8 top-2, 28×64 top-6) and are read out of the data, never assumed.
 *
 * The whole tab unmounts when the user switches to Model Architecture, so every sub-tab's
 * entrance animation replays on re-open, and the shared picker re-syncs fresh to the Architecture
 * tab's currently-selected prompt's category every time. The Experts UMAP picker is the one
 * exception — it lives in MoeApp and survives that unmount (see `umapActive`).
 */
export function DomainTab({
  syncCategory,
  modelKey,
  umapActive,
  onUmapToggle,
}: DomainTabProps) {
  const { data, loading, error } = useDomainSpecialization(modelKey);
  const [subTab, setSubTab] = useState<SubTab>('map');
  // Lives here rather than in DomainTabBody because the switch it drives is rendered up in the
  // sub-tab bar row (right-aligned), not in the body's control row. Consequence: like `subTab`,
  // it now survives a model switch instead of being reset by the body's `key={modelKey}`.
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  // Same reason as viewMode: the button that opens it sits in this row. The body renders the
  // window itself, since the layer it draws lives down there.
  const [allOpen, setAllOpen] = useState(false);

  return (
    <div className="panel" style={{ paddingLeft: 10, paddingRight: 10 }}>
      {/* The sub-tab bar and the view switch share one row: the switch is pinned to the right
          corner so the pills keep their landmark position on the left. It wraps to its own
          right-aligned line when the pills run out of room.
          `min-h-8` on the pill list, not just on the switch: the switch is 32px and the pills 30px,
          so without it this row would be 2px taller on the one sub-tab that has a switch, and every
          control below it would sit 2px lower there than on the other four. Every control row in
          this tab is pinned to the same 32px band for that reason. */}
      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2"
        style={{ margin: '4px 0 6px' }}
      >
        <div className="sub-tabs min-h-8 items-center" style={{ margin: 0 }}>
          {SUB_TABS.map((t) => (
            <button
              key={t.id}
              className={`sub-tab${subTab === t.id ? ' active' : ''}`}
              type="button"
              onClick={() => {
                setSubTab(t.id);
                // The window belongs to this sub-tab; leaving it dismisses the window rather
                // than parking it to spring back open on return.
                setAllOpen(false);
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* One button, not a pill pair: a second row of .sub-tab pills directly under the
            sub-tab bar would read as more navigation. The visible labels are decorative to
            assistive tech (aria-label wins over content), so it announces as one switch
            rather than as the string "Heatmap grid Histogram". It's named for the state it
            turns on, since a switch has to have an off side and "off" has to mean the
            default view. See `.view-switch` in moe.css.
            Its "Open all categories in one window" partner is NOT stacked under it here — that
            column was 55px tall and pushed this whole row (and every row below it) down on this
            one sub-tab. The link rides the control row instead, right-aligned, which lands it
            directly under the switch anyway. */}
        {subTab === 'histogram' && (
          <button
            type="button"
            role="switch"
            aria-checked={viewMode === 'histogram'}
            aria-label="Histogram view"
            className="view-switch domain-view-toggle ml-auto"
            data-side={viewMode === 'histogram' ? '1' : '0'}
            onClick={() => setViewMode((v) => (v === 'grid' ? 'histogram' : 'grid'))}
          >
            <span className="view-switch-thumb" aria-hidden="true" />
            {VIEW_MODES.map((v) => (
              <span
                key={v.id}
                className={`view-switch-label${viewMode === v.id ? ' active' : ''}`}
              >
                {v.label}
              </span>
            ))}
          </button>
        )}
      </div>

      {loading || error || !data ? (
        <p className="math-hint" style={{ margin: 0 }}>
          {loading
            ? 'Loading domain specialization data…'
            : `Failed to load domain specialization data${error ? `: ${error.message}` : '.'}`}
        </p>
      ) : (
        <DomainTabBody
          key={modelKey}
          data={data}
          modelKey={modelKey}
          syncCategory={syncCategory}
          subTab={subTab}
          viewMode={viewMode}
          umapActive={umapActive}
          onUmapToggle={onUmapToggle}
          allOpen={allOpen}
          onOpenAll={() => setAllOpen(true)}
          onCloseAll={() => setAllOpen(false)}
        />
      )}
    </div>
  );
}

function DomainTabBody({
  data,
  modelKey,
  syncCategory,
  subTab,
  viewMode,
  umapActive,
  onUmapToggle,
  allOpen,
  onOpenAll,
  onCloseAll,
}: {
  data: DomainSpecializationData;
  modelKey: DomainModelKey;
  syncCategory: string;
  subTab: SubTab;
  /** Owned by DomainTab, because the switch that sets it lives in the sub-tab bar row. */
  viewMode: ViewMode;
  /** Owned by MoeApp — it has to outlive this tab's unmount. See DomainTabProps. */
  umapActive: Set<string>;
  onUmapToggle: (category: string) => void;
  /** Likewise: "Open all categories in one window" is opened from this tab's control row. */
  allOpen: boolean;
  onOpenAll: () => void;
  onCloseAll: () => void;
}) {
  // Starts with every category on for these two sub-tabs (unlike the UMAP sub-tab's own picker,
  // which starts synced to just one) — still collapses to the synced category if the reader picks
  // a different prompt back in the Architecture tab.
  const shared = useCategoryMultiSelect(syncCategory, SHARED_PICKER_CATEGORIES);
  // Opens on the last layer, which is never dense — the floor only matters once the reader drags.
  const [layer, setLayer] = useState(data.num_layers - 1);
  const [cell, setCell] = useState<DomainCell | null>(null);
  const minLayer = firstMoeLayer(data);

  const showsSharedPicker = subTab === 'rate' || subTab === 'histogram';

  return (
    <div>
      {showsSharedPicker &&
        (subTab === 'histogram' ? (
          // Pills, slider and the "open all" link on one 32px band — the same band the other
          // sub-tabs' picker rows sit on, so nothing below it shifts when the reader lands here.
          // Every item is `items-center` on that band; the slider's dense-layer footnote is out
          // of flow (see LayerSlider) so DeepSeek doesn't grow the row either.
          <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2">
            {/* `min-h-8`, not `h-8`: the pills wrap to a second line on narrow viewports and a
                fixed height would clip them. */}
            <div className="flex min-h-8 items-center">
              <CategoryTogglePicker
                categories={SHARED_PICKER_CATEGORIES}
                active={shared.active}
                onToggle={shared.toggle}
              />
            </div>
            <LayerSlider
              layer={layer}
              numLayers={data.num_layers}
              minLayer={minLayer}
              onChange={setLayer}
            />
            {/* Deliberately not a third pill: it opens a window, it doesn't change what the row
                below shows, so it is typed as a quiet link-weight action. `ml-auto` parks it in
                the right corner, directly under the view switch it belongs to. */}
            <button type="button" className="open-all-link ml-auto" onClick={onOpenAll}>
              <span aria-hidden="true">⤢</span> Open all categories in one window
            </button>
          </div>
        ) : (
          <div className="mb-4 flex min-h-8 items-center">
            <CategoryTogglePicker
              categories={SHARED_PICKER_CATEGORIES}
              active={shared.active}
              onToggle={shared.toggle}
            />
          </div>
        ))}

      {subTab === 'map' && (
        <ExpertsUmapSection
          modelKey={modelKey}
          active={umapActive}
          onToggle={onUmapToggle}
        />
      )}

      {subTab === 'rate' && <DomainRateChart data={data} activeCategories={shared.active} />}

      {/* Conditional render, never a CSS hide: ExpertGrid's GSAP pop measures real SVG geometry
          and would read zero under display:none. It also means the pop replays on every flip
          back, which is the point of having the two views one click apart. */}
      {subTab === 'histogram' &&
        (viewMode === 'grid' ? (
          <ExpertGridSection data={data} activeCategories={shared.active} layer={layer} />
        ) : (
          <HistogramSection
            data={data}
            activeCategories={shared.active}
            layer={layer}
            onBarClick={(category, expert) => setCell({ category, layer, expert })}
          />
        ))}

      {subTab === 'specialists' && (
        <TopExpertsSection
          data={data}
          onSelect={(category, selectedLayer, expert) => {
            setLayer(selectedLayer);
            setCell({ category, layer: selectedLayer, expert });
          }}
        />
      )}

      {subTab === 'prompts' && <PromptsSection data={data} />}

      {subTab === 'histogram' && allOpen && (
        <AllCategoriesModal
          data={data}
          layer={layer}
          minLayer={minLayer}
          onLayerChange={setLayer}
          viewMode={viewMode}
          onBarClick={(category, expert) => setCell({ category, layer, expert })}
          suppressEscape={cell !== null}
          onClose={onCloseAll}
        />
      )}

      {cell && <DomainCellModal data={data} cell={cell} onClose={() => setCell(null)} />}
    </div>
  );
}

/** Sub-tab 1 ("Experts UMAP") — the UMAP finale: all (layer, expert) points, colored by dominant
 *  category. Keeps its own independent picker, untouched by the shared one above — but that
 *  picker's state is held by MoeApp, which outlives both this section's unmount on every sub-tab
 *  switch and the whole tab's on every top-tab switch. Reads the same six-passage run as the other
 *  four sub-tabs, so the whole tab describes one measurement. */
function ExpertsUmapSection({
  modelKey,
  active,
  onToggle,
}: {
  modelKey: DomainModelKey;
  active: Set<string>;
  onToggle: (category: string) => void;
}) {
  const { data: umap, loading } = useDomainUmap(modelKey);

  const pairCount = umap ? umap.points.length.toLocaleString() : null;

  return (
    <div>
      {/* Picker first, directly under the sub-tab bar, so it lands in the same place as the shared
          picker on sub-tabs 2-3 — the control row is a fixed landmark across the tab, and only the
          copy below it changes. */}
      <div className="mb-4 flex min-h-8 items-center">
        <CategoryTogglePicker categories={CATEGORIES} active={active} onToggle={onToggle} />
      </div>

      <p className="math-hint" style={{ margin: '0 0 8px' }}>
        {pairCount ? `All ${pairCount}` : 'All'} (layer, expert) pairs projected to 2D by
        activation-profile similarity, so experts that fire on the same kinds of tokens sit near each
        other. Toggle categories in to see how their clusters relate; hover a dot for its strongest
        tokens.
      </p>

      <div className="mx-auto mt-4 max-w-2xl">
        {umap ? (
          <ClusterPlot umap={umap} activeCategories={active} />
        ) : (
          // Fixed-size placeholder matching ClusterPlot's 640:440 plot so the lazy load doesn't
          // reflow the panel when the data arrives.
          <div className="aspect-[640/440] w-full rounded-md border border-ink/10 bg-surface">
            <div className="flex h-full items-center justify-center">
              <p className="math-hint">
                {loading ? 'Loading the experts UMAP…' : 'Experts-UMAP data unavailable.'}
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
