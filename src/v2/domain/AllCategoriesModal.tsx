import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExpertGridSection, fitExpertGridTiles, TILE_CAPTION_H } from './ExpertGridSection';
import { fitHistogramCards, HistogramSection } from './HistogramSection';
import { LayerSlider } from './LayerSlider';
import type { DomainSpecializationData } from '../../data/types';

interface AllCategoriesModalProps {
  data: DomainSpecializationData;
  layer: number;
  /** First layer that routes between experts, same floor the sub-tab's slider clamps to. */
  minLayer: number;
  /** Writes straight back to the tab's shared layer state, so closing the window leaves the
   *  sub-tab on whatever layer the reader walked to in here rather than snapping back. */
  onLayerChange: (layer: number) => void;
  /** Which of the two views of `activation_rate[category][layer]` to draw — the same choice the
   *  sub-tab's `.view-switch` makes, mirrored rather than re-offered, so the window always shows
   *  what the reader was already looking at. */
  viewMode: 'grid' | 'histogram';
  onBarClick: (category: string, expert: number) => void;
  /** True while DomainCellModal is stacked on top of this one (a histogram bar was clicked).
   *  Escape then belongs to that modal alone — both listen on `document`, so without this one
   *  keypress would dismiss the pair. */
  suppressEscape: boolean;
  onClose: () => void;
}

/**
 * "Open all categories in one window" — the whole six-category set at the shared layer, drawn in
 * whichever view the sub-tab is currently in, ignoring the category pills.
 *
 * The pills exist to line up two or three categories side by side at readable size; this is the
 * other question ("what does the layer look like across every category at once?") and it wants the
 * full viewport rather than the panel's column. Both views are rendered by the very same section
 * components the tab uses, so the marks can't drift apart — only their surrounding copy differs,
 * which is why those two take `hideHint` (the tab's hint talks about toggling pills that aren't
 * here).
 */
export function AllCategoriesModal({
  data,
  layer,
  minLayer,
  onLayerChange,
  viewMode,
  onBarClick,
  suppressEscape,
  onClose,
}: AllCategoriesModalProps) {
  useEffect(() => {
    if (suppressEscape) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose, suppressEscape]);

  // Every category, in the data's own order — not `shared.active`. That is the whole point of the
  // window, so it is built here rather than threaded down from the tab's picker state.
  const allCategories = new Set(data.domains);

  // Both views size themselves to the body rather than taking their natural width, so all six
  // categories are on screen at once — the reason to open this window is to compare them, and a
  // layer whose bottom half is a scroll away compares nothing. Measured, not guessed at from `vh`:
  // the body is what the marks actually live in, and its height already nets off the header.
  const bodyRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number } | null>(null);
  // The parts of the layout that do NOT scale with the marks, read off the first render rather
  // than written down as literals: a grid's figcaption, and a histogram card's title row + hover
  // readout + padding (`chrome`) and horizontal padding + border (`inset`). Every one of them
  // grows with the reader's root font size, and a stale literal under-subtracts — which hands back
  // the scrollbar this whole effect exists to remove. They are width-independent, so measuring
  // them once off the natural layout stays valid after the fit resizes everything.
  const [chrome, setChrome] = useState<{ caption: number; card: number; inset: number } | null>(
    null
  );

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    // Content box, so the body's own padding is already excluded. The first read is synchronous —
    // a ResizeObserver's initial callback can land after the browser has painted, which would show
    // the natural-size layout for a frame before it snapped to the fit.
    const read = (w: number, h: number) => setBox((b) => (b?.w === w && b?.h === h ? b : { w, h }));
    const cs = getComputedStyle(el);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    read(el.clientWidth - padX, el.clientHeight - padY);

    const cap = el.querySelector('figcaption');
    const card = el.querySelector<HTMLElement>('[data-hist-card]');
    const cardSvg = card?.querySelector('svg');
    setChrome({
      caption: cap
        ? cap.getBoundingClientRect().height + parseFloat(getComputedStyle(cap).marginBottom)
        : TILE_CAPTION_H,
      card: card && cardSvg
        ? card.getBoundingClientRect().height - cardSvg.getBoundingClientRect().height
        : 0,
      inset: card && cardSvg
        ? card.getBoundingClientRect().width - cardSvg.getBoundingClientRect().width
        : 0,
    });

    const ro = new ResizeObserver(([entry]) => {
      const r = entry.contentRect;
      read(r.width, r.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [viewMode]);

  const ready = box && chrome;
  const gridFit =
    viewMode === 'grid' && ready
      ? fitExpertGridTiles(
          data.domains.length,
          data.num_experts,
          box.w,
          box.h,
          chrome.caption
        )
      : undefined;
  const histFit =
    viewMode === 'histogram' && ready
      ? fitHistogramCards(
          data.domains.length,
          data.num_experts,
          chrome.card,
          chrome.inset,
          box.w,
          box.h
        )
      : undefined;

  return (
    // z-40, one step under DomainCellModal's z-50: a histogram bar in here still opens the
    // exact-numbers modal, and it has to land on top of this one.
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/40 p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`All categories, layer ${layer + 1}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* `h-screen`, not the `max-h-[92vh]` this carried before: `.moe-root` sets `min-height:
          100vh`, and a min beats a max, so this dialog has always been exactly the viewport's
          height — the class now says so instead of stating a cap the cascade throws away. It
          matters beyond tidiness: the grid view sizes its tiles from the body's measured height,
          and a dialog that sized to its content would make that measurement chase itself. */}
      <div className="moe-root flex h-screen w-full max-w-[1400px] flex-col overflow-hidden rounded-md bg-paper shadow-overlay-float">
        <div className="flex items-start justify-between gap-3 border-b border-ink/10 px-5 py-3">
          <div className="min-w-0 flex-1">
            {/* The layer readout moved out of the title and into the slider beside it, rather
                than being kept in both: two live "20 / 28"s on one line read as two different
                numbers that happen to agree. The title keeps its landmark position and the
                slider sits exactly where that readout was. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <h3 className="font-title text-base font-semibold text-ink">
                All {data.domains.length} categories
              </h3>
              <LayerSlider
                layer={layer}
                numLayers={data.num_layers}
                minLayer={minLayer}
                id="all-categories-layer-slider"
                onChange={onLayerChange}
              />
            </div>
            <p className="mt-0.5 font-body text-xs text-muted">
              {viewMode === 'grid'
                ? `Each grid is one category's ${data.num_experts} experts at this layer; rings mark its ${data.top_k_experts} most-used. Hover a cell for its tokens.`
                : `Each chart is one category's ${data.num_experts} experts at this layer. Click a bar for the exact numbers behind it.`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-sm p-1 font-body text-sm text-muted hover:bg-surface hover:text-ink"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* The body scrolls, not the dialog: the header (and its layer readout) has to stay put
            while the reader walks down six 64-expert charts. It stays scrollable in grid view too,
            as the escape hatch for a window too short to fit the tiles above their readable floor. */}
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {viewMode === 'grid' ? (
            <ExpertGridSection
              data={data}
              activeCategories={allCategories}
              layer={layer}
              hideHint
              fit={gridFit}
            />
          ) : (
            <HistogramSection
              data={data}
              activeCategories={allCategories}
              layer={layer}
              onBarClick={onBarClick}
              hideHint
              fit={histFit}
            />
          )}
        </div>
      </div>
    </div>
  );
}
