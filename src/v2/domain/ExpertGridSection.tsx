import { useMemo } from 'react';
import { CATEGORY_LABELS } from '../../data/categories';
import { CATEGORY_HUES, CATEGORY_PALETTE } from '../../components/ClusterPlot/categoryPalette';
import {
  ExpertGrid,
  expertGridHeight,
  expertGridWidth,
} from '../../components/SpecializationView/ExpertGrid';
import { topKExperts, tokensForExpert } from '../../utils/domainStats';
import type { DomainSpecializationData } from '../../data/types';

/** Tile gaps, as numbers rather than `gap-x-12 gap-y-6` classes: `fitExpertGridTiles` has to solve
 *  a layout that includes them, and a Tailwind class it can't read is a constant waiting to drift. */
export const TILE_GAP = { x: 48, y: 24 };

/** Fallback height for a figcaption above each grid — the 24px line box of its `text-base` row plus
 *  `mb-2`. Callers measure the real one and pass it in; this covers the render before the first
 *  measurement. A caption does not scale with its tile, so the fit subtracts it per row, and a
 *  reader whose root font is larger than 16px would silently get the scrollbar back if this literal
 *  were the only source of truth. */
export const TILE_CAPTION_H = 32;

/** Below this the cells stop being readable, so a box too small to fit is left to scroll rather
 *  than served an unreadable block. AllCategoriesModal keeps its body scrollable for exactly that
 *  case; every ordinary viewport lands well above the floor. */
const MIN_TILE_W = 120;

/**
 * The widest tiles that let `count` grids fit inside `availW × availH` with no scrolling, and the
 * column count that gets there. Every column count is tried because the winner is not fixed: 3
 * columns is height-bound on a laptop, but JetMoE's 2:1 tiles and a short window move the answer.
 *
 * Ties are common and decide the shape on their own, so they break twice. Fewest rows first: once
 * tiles hit their natural cap, extra columns cost nothing and vertical compactness is the whole
 * point of this window (JetMoE's small tiles otherwise stack 2×3 where 3×2 fits at the same size).
 * Then fewest columns, which keeps the familiar 3×2 block instead of a ragged 4 + 2.
 */
export function fitExpertGridTiles(
  count: number,
  numExperts: number,
  availW: number,
  availH: number,
  captionH = TILE_CAPTION_H
): { tileWidth: number; columns: number } {
  const natural = expertGridWidth(numExperts);
  const aspect = expertGridHeight(numExperts) / natural;

  let best = { tileWidth: 0, columns: 1, rows: Infinity };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const byWidth = (availW - (cols - 1) * TILE_GAP.x) / cols;
    const byHeight = (availH - (rows - 1) * TILE_GAP.y - rows * captionH) / rows / aspect;
    const tileWidth = Math.min(natural, byWidth, byHeight);
    // A sub-pixel win is not a win — it would hand the layout to a taller stack for nothing.
    const wins =
      tileWidth > best.tileWidth + 0.5 || (tileWidth > best.tileWidth - 0.5 && rows < best.rows);
    if (wins) best = { tileWidth, columns: cols, rows };
  }
  // Floored so the row cap below is an integer: a fractional total is one rounding error away from
  // wrapping a column early, which is the exact ragged layout the cap exists to prevent.
  return { columns: best.columns, tileWidth: Math.max(Math.floor(best.tileWidth), MIN_TILE_W) };
}

interface ExpertGridSectionProps {
  data: DomainSpecializationData;
  activeCategories: Set<string>;
  layer: number;
  /** Set by AllCategoriesModal, which writes its own one-liner: this one talks about toggling
   *  category pills, and there are none in that window. */
  hideHint?: boolean;
  /** Fit-to-box override from `fitExpertGridTiles`. Absent in the tab, where the page scrolls and
   *  tiles want their natural size; set by AllCategoriesModal, which has a fixed box to fill. */
  fit?: { tileWidth: number; columns: number };
}

/**
 * Sub-tab 3 ("Experts activation rates per layer"), Heatmap grid view and its default — one ExpertGrid tile
 * per toggled category (up to 6) at the shared layer, generalized from the old Compare section's
 * fixed A/B pair. Was a sub-tab of its own until 2026-07-28, mislabelled "UMAP Expert Grid"
 * (the UMAP is sub-tab 1). Cells are hover-only, unlike the Histogram view's clickable bars.
 */
export function ExpertGridSection({
  data,
  activeCategories,
  layer,
  hideHint = false,
  fit,
}: ExpertGridSectionProps) {
  const categories = useMemo(
    () => data.domains.filter((c) => activeCategories.has(c)),
    [data, activeCategories]
  );
  const tileWidth = fit?.tileWidth ?? expertGridWidth(data.num_experts);

  return (
    <div>
      {!hideHint && (
        <p className="math-hint" style={{ margin: '0 0 8px' }}>
          Each grid is one category's {data.num_experts} experts at layer {layer + 1}. Color shows
          how often that category's tokens routed to each expert, rings mark its{' '}
          {data.top_k_experts} most-used.
        </p>
      )}

      {/* Flex-wrap, not a 3-column grid: equal-width columns are sized for a 64-expert model, so
          JetMoE's narrow 8-expert grids would sit marooned in the middle of an empty third. Tiles
          take their natural width and pack left, which also puts them side by side for comparison. */}
      <div
        className={`flex flex-wrap${hideHint ? '' : ' mt-5'}${fit ? ' mx-auto' : ''}`}
        style={{
          columnGap: TILE_GAP.x,
          rowGap: TILE_GAP.y,
          // Cap the row so it breaks after exactly `columns`: fitted tiles are narrow enough that
          // free wrapping would pull a fourth into the first row and leave a ragged 4 + 2.
          ...(fit
            ? { maxWidth: fit.columns * fit.tileWidth + (fit.columns - 1) * TILE_GAP.x }
            : null),
        }}
      >
        {categories.map((category) => {
          const rates = data.activation_rate[category][layer];
          const freqs = Float64Array.from(rates);
          const topSet = new Set(topKExperts(rates, data.top_k_experts));
          const label = CATEGORY_LABELS[category] ?? category;

          return (
            <figure key={category} className="max-w-full" style={{ width: tileWidth }}>
              <figcaption className="mb-2 flex items-center gap-2">
                <span
                  className="inline-block h-3 w-3 rounded-sm"
                  style={{ backgroundColor: CATEGORY_PALETTE[category] }}
                  aria-hidden="true"
                />
                <span className="font-title text-base font-semibold text-ink">{label}</span>
              </figcaption>
              <ExpertGrid
                categoryLabel={label}
                hue={CATEGORY_HUES[category] ?? 0}
                freqs={freqs}
                topSet={topSet}
                sampleTokensFor={(expert) => tokensForExpert(data, category, layer, expert)}
              />
            </figure>
          );
        })}
      </div>
    </div>
  );
}
