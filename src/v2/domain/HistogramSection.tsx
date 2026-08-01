import { useMemo, useState } from 'react';
import { CATEGORY_LABELS } from '../../data/categories';
import { CATEGORY_PALETTE } from '../../components/ClusterPlot/categoryPalette';
import type { DomainSpecializationData } from '../../data/types';

/** Card gap, as a number rather than a `gap-4` class: `fitHistogramCards` solves a layout that
 *  includes it, and a Tailwind class it cannot read is a constant waiting to drift. */
export const CARD_GAP = 16;

/** Below this a 64-bar chart is a smear, so a box too short to fit is left to scroll instead. */
const MIN_CARD_W = 240;

const CHART_PAD_X = 8; // padL + padR, in viewBox units
const CHART_H = 98; // chart + the x-axis tick row and its title

// Both the viewBox width and the card's max width scale with the expert count, which is what
// keeps an 8-expert router from looking like a different chart. A fixed 640-unit viewBox gave
// JetMoE 78-unit bars in a 64-unit-tall chart — wider than they were tall — and capping only
// the card's width shrank the whole SVG instead, since it scales uniformly.
//
// So the viewBox gets *wider per expert* when there are few of them (24 units vs 10), and the
// px cap is a fixed multiple of that. The multiple is what a 64-expert chart already resolves
// to in this container (~2.2 px per unit), so every model lands at the same ~230px chart
// height with uniform scaling — no preserveAspectRatio tricks, which would shear the axis
// labels. JetMoE's card is simply narrower; 64-expert charts are unaffected, since their cap
// lands past any real container width.
//
// Module scope, not locals inside the chart: the fit below has to reason about the same geometry,
// and two copies of this arithmetic is one edit away from a layout solved for a chart that is not
// the one on screen.
function chartUnitsWide(numExperts: number): number {
  return numExperts * (numExperts <= 16 ? 24 : 10) + CHART_PAD_X;
}
function chartMaxWidth(numExperts: number): number {
  return Math.round(chartUnitsWide(numExperts) * 2.2);
}

/** The chart SVG's own height : width ratio — the card's height follows from its width through
 *  this, which is what lets the fit below solve for a width. */
function chartAspect(numExperts: number): number {
  return CHART_H / chartUnitsWide(numExperts);
}

/**
 * The widest cards that let `count` charts fit inside `availW × availH` without scrolling, and the
 * column count that gets there — the histogram twin of `fitExpertGridTiles`, same tie-breaks.
 *
 * `chrome` (everything in a card that is not the SVG: title row, hover readout, padding, border)
 * and `inset` (the card's horizontal padding + border) are **measured by the caller and passed in**,
 * never derived here. They are the parts that do not scale with the chart, so a literal for either
 * would silently under-subtract at a larger root font size and hand the scrollbar back — the exact
 * failure this function exists to prevent.
 */
export function fitHistogramCards(
  count: number,
  numExperts: number,
  chrome: number,
  inset: number,
  availW: number,
  availH: number
): { cardWidth: number; columns: number } {
  const natural = chartMaxWidth(numExperts);
  const aspect = chartAspect(numExperts);

  let best = { cardWidth: 0, columns: 1, rows: Infinity };
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols);
    const byWidth = (availW - (cols - 1) * CARD_GAP) / cols;
    const byHeight = ((availH - (rows - 1) * CARD_GAP) / rows - chrome) / aspect + inset;
    const cardWidth = Math.min(natural, byWidth, byHeight);
    // A sub-pixel win is not a win — it would hand the layout to a taller stack for nothing.
    const wins =
      cardWidth > best.cardWidth + 0.5 || (cardWidth > best.cardWidth - 0.5 && rows < best.rows);
    if (wins) best = { cardWidth, columns: cols, rows };
  }
  return { columns: best.columns, cardWidth: Math.max(Math.floor(best.cardWidth), MIN_CARD_W) };
}

interface HistogramSectionProps {
  data: DomainSpecializationData;
  activeCategories: Set<string>;
  layer: number;
  onBarClick: (category: string, expert: number) => void;
  /** Set by AllCategoriesModal, which writes its own one-liner in the dialog header. */
  hideHint?: boolean;
  /** Fit-to-box override from `fitHistogramCards`. Absent in the tab, where the page scrolls and
   *  a chart wants its natural width; set by AllCategoriesModal, which has a fixed box to fill. */
  fit?: { cardWidth: number; columns: number };
}

/**
 * Sub-tab 3 ("Experts activation rates per layer"), Histogram view — one bar chart per toggled category at
 * the shared layer (one bar per expert), ported from the prototype's buildHistCharts. Bars are
 * clickable (opens DomainCellModal); its sibling ExpertGridSection draws the same numbers as heat
 * tiles and is hover-only.
 */
export function HistogramSection({
  data,
  activeCategories,
  layer,
  onBarClick,
  hideHint = false,
  fit,
}: HistogramSectionProps) {
  const categories = useMemo(
    () => data.domains.filter((c) => activeCategories.has(c)),
    [data, activeCategories]
  );

  return (
    <div>
      {!hideHint && (
        <p className="math-hint" style={{ margin: '0 0 8px' }}>
          Every one of the {data.num_experts} experts' activation rate at layer {layer + 1}, for
          each toggled category. Click a bar for the exact numbers behind it.
        </p>
      )}

      {/* Wrapping row, not a column: a 64-expert chart fills the width and lands one per row
          exactly as before, while JetMoE's narrow cards flow side by side instead of stacking
          into a tall ribbon of mostly-empty rows. */}
      <div
        className={`flex flex-wrap items-start${hideHint ? '' : ' mt-4'}${fit ? ' mx-auto' : ''}`}
        style={{
          gap: CARD_GAP,
          // Cap the row so it breaks after exactly `columns` — see ExpertGridSection for why the
          // wrap point has to be forced rather than left to the natural width.
          ...(fit
            ? { maxWidth: fit.columns * fit.cardWidth + (fit.columns - 1) * CARD_GAP }
            : null),
        }}
      >
        {categories.map((category) => (
          <HistogramChart
            key={category}
            category={category}
            rates={data.activation_rate[category][layer]}
            onBarClick={(expert) => onBarClick(category, expert)}
            cardWidth={fit?.cardWidth}
          />
        ))}
      </div>
    </div>
  );
}

interface HistogramChartProps {
  category: string;
  rates: number[];
  onBarClick?: (expert: number) => void;
  /** Overrides the natural width cap when the caller is fitting cards into a fixed box. */
  cardWidth?: number;
}

function HistogramChart({ category, rates, onBarClick, cardWidth }: HistogramChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const color = CATEGORY_PALETTE[category] ?? 'var(--color-muted)';
  const label = CATEGORY_LABELS[category] ?? category;

  const n = rates.length;
  const padL = 4;
  const padR = 4;
  const padT = 4;
  const gap = 0.6;
  const chartH = 64;
  const axisY = padT + chartH;
  const H = CHART_H;

  const W = chartUnitsWide(n);
  // The fit-to-box width when this is the all-categories window, the natural cap otherwise.
  const maxWidth = cardWidth ?? chartMaxWidth(n);

  const barW = (W - padL - padR) / n - gap;
  const barX = (e: number) => padL + e * (barW + gap);
  const barH = (rate: number) => Math.max(rate * chartH, 1);

  // Every expert gets a tick when there are few; 64 would be an unreadable smear, so those step
  // by 8. Labels are 1-based ("Expert No." reads as a count, not an array index).
  const tickStep = n <= 16 ? 1 : 8;
  const ticks = Array.from({ length: n }, (_, e) => e).filter((e) => e % tickStep === 0);

  // width:100% alongside the cap, not the cap alone: as a flex item the card would otherwise
  // shrink to its content and take the SVG's `w-full` down with it.

  return (
    <div
      data-hist-card
      className="rounded-md border border-ink/10 bg-paper p-2.5"
      style={{ width: '100%', maxWidth }}
    >
      <div className="mb-1.5 flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: color }} />
        <span className="font-body text-sm font-semibold text-ink">{label}</span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-label={`${label}: ${n}-expert activation rate histogram`}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 50, 100].map((pct) => (
          <line
            key={pct}
            x1={padL}
            x2={W - padR}
            y1={padT + chartH - (pct / 100) * chartH}
            y2={padT + chartH - (pct / 100) * chartH}
            stroke="var(--color-surface)"
            strokeWidth={1}
          />
        ))}
        {rates.map((rate, e) => (
          <rect
            key={e}
            x={barX(e)}
            y={padT + chartH - barH(rate)}
            width={barW}
            height={barH(rate)}
            fill={color}
            opacity={0.15 + rate * 0.85}
            style={onBarClick ? { cursor: 'pointer' } : undefined}
            onMouseMove={() => setHover(e)}
            onClick={() => onBarClick?.(e)}
          />
        ))}

        <line
          x1={padL}
          x2={W - padR}
          y1={axisY}
          y2={axisY}
          stroke="var(--color-ink)"
          strokeOpacity={0.25}
          strokeWidth={0.5}
        />
        {ticks.map((e) => (
          <text
            key={e}
            x={barX(e) + barW / 2}
            y={axisY + 9}
            textAnchor="middle"
            className="font-label"
            fontSize={7}
            fill="var(--color-muted)"
          >
            {e + 1}
          </text>
        ))}
        <text
          x={padL + (W - padL - padR) / 2}
          y={H - 4}
          textAnchor="middle"
          className="font-label"
          fontSize={7.5}
          fill="var(--color-muted)"
        >
          Expert No.
        </text>
      </svg>
      {/* `truncate` (nowrap + ellipsis) is load-bearing under the fit, not cosmetic: the hover
          string is ~386px wide, so a fitted card narrower than that would wrap it to a second line
          on hover — six cards each growing a line is enough to hand back the scrollbar the fit just
          removed, at the exact moment the reader is using the chart. Reserving the second line
          instead would cost that height on every card at every size. */}
      <p className="mt-1 truncate font-label text-xs text-muted">
        {hover !== null
          ? `expert #${hover + 1} · ${(rates[hover] * 100).toFixed(1)}%${onBarClick ? ' · click for details' : ''}`
          : `${n} experts, layer activation rate`}
      </p>
    </div>
  );
}
