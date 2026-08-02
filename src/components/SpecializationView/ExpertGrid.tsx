import { useLayoutEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import type { SampleToken } from '../../utils/domainStats';
import { usePrefersReducedMotion } from '../../utils/usePrefersReducedMotion';
import { heatColor, heatTextColor } from './heatColor';

const CELL = 34;
const GAP = 4;

/** Tooltip box width. A number rather than a `w-56` class because the clamp below has to measure
 *  with exactly the width that renders — `w-56` is 14rem, only 224px at a 16px root, so a reader
 *  with a larger default font size would get a clamp silently tens of px off. */
const TOOLTIP_W = 224;
/** Breathing room left between the tooltip and whatever edge would otherwise cut it. */
const TOOLTIP_PAD = 8;
/** Gap between the tooltip and the cell it points at, above or below. */
const TOOLTIP_GAP = 8;

/**
 * Bounds the tooltip has to stay inside: the viewport, narrowed by every ancestor that clips. Every
 * edge is real here — loose in the panel nothing clips, so the viewport is the only edge (a leftmost
 * cell's tooltip is centred on a cell ~17px in and hangs 90px past x=0); inside AllCategoriesModal
 * two ancestors clip, the scrolling body and the dialog panel, and a `window.innerWidth` clamp would
 * do nothing at all.
 */
function clipBounds(el: Element | null): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  let left = 0;
  let top = 0;
  // `clientWidth`/`clientHeight`, never `window.innerWidth`/`innerHeight` — the latter count the
  // scrollbar gutters, the one strip of the viewport that cannot show a tooltip.
  let right = document.documentElement.clientWidth;
  let bottom = document.documentElement.clientHeight;
  // Per spec a `visible` axis computes to `auto`/`clip` when the other axis is not, so either being
  // non-visible means the element clips on both — hence one test, narrowing both axes.
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
      const r = node.getBoundingClientRect();
      // Content is cut at the padding box minus any scrollbar, which is what clientLeft/clientTop
      // and clientWidth/clientHeight measure; the border-box rect would be a few px too generous on
      // exactly the containers that scroll. The `||` fallbacks keep a non-HTML ancestor from
      // poisoning a bound with NaN.
      const insetX = node.clientLeft || 0;
      const insetY = node.clientTop || 0;
      left = Math.max(left, r.left + insetX);
      right = Math.min(right, r.left + insetX + (node.clientWidth || r.width));
      top = Math.max(top, r.top + insetY);
      bottom = Math.min(bottom, r.top + insetY + (node.clientHeight || r.height));
    }
  }
  return { left, right, top, bottom };
}

/** Squarest grid that holds `n` experts — 8×8 for OLMoE/DeepSeek's 64. Narrow expert counts
 *  (JetMoE routes over 8) cap at 4 columns, so 8 experts read as a compact 4×2 block rather
 *  than a single 8-wide strip or a stubby 3×3. */
function gridShape(n: number): { cols: number; rows: number } {
  const cols = n <= 16 ? Math.min(4, n) : Math.ceil(Math.sqrt(n));
  return { cols, rows: Math.ceil(n / cols) };
}

/** Natural on-screen width of an `n`-expert grid, viewBox padding included — the size the grid
 *  refuses to grow past. Callers lay tiles out at this width so a low-expert model's grids sit
 *  next to each other instead of being spread across equal-width columns sized for 64. */
export function expertGridWidth(n: number): number {
  const { cols } = gridShape(n);
  return cols * CELL + (cols - 1) * GAP + 2;
}

/** The companion height, so a caller packing tiles into a fixed box can derive the aspect ratio.
 *  Square for the 64-expert models, 2:1 for JetMoE's 4×2 — hence "derive", never assume 1. */
export function expertGridHeight(n: number): number {
  const { rows } = gridShape(n);
  return rows * CELL + (rows - 1) * GAP + 2;
}

// The depth cue: each layer's top-k experts pop forward, the rest recede (8 of 64 for OLMoE,
// 6 of 64 for DeepSeek, 2 of 8 for JetMoE). Off-shadow is a zero-value drop-shadow (not `none`)
// so GSAP interpolates the filter cleanly in both directions.
const POP = { scale: 1.12, opacity: 1, filter: 'drop-shadow(0 4px 10px rgba(0,0,0,0.45))' };
const RECEDE = { scale: 0.9, opacity: 1, filter: 'drop-shadow(0 0 0 rgba(0,0,0,0))' };

interface HoverState {
  expert: number;
  x: number;
  /** Top of the hovered cell, relative to the grid wrapper — where the tooltip's bottom edge sits
   *  when it hangs above. */
  y: number;
  /** ...and the cell's bottom, for the flipped placement. Stored rather than re-derived so the two
   *  edges can't drift apart if the SVG's scale changes between the move and the layout pass. */
  yBottom: number;
}

interface ExpertGridProps {
  categoryLabel: string;
  hue: number;
  /** One activation frequency per expert for this category at the selected layer. */
  freqs: Float64Array;
  /** The category's top-k experts at this layer — ringed as a non-color cue. */
  topSet: Set<number>;
  /** Lazily resolves the sample tokens shown in a cell's tooltip. */
  sampleTokensFor: (expert: number) => SampleToken[];
}

/**
 * One category's experts at one layer, as a sequential heatmap (8×8 for a 64-expert model).
 * Colour encodes how often the category routed to each expert; a ring marks
 * the top-k. Comparing two of these side by side is the whole payoff: the
 * ringed sets barely overlap.
 */
export function ExpertGrid({
  categoryLabel,
  hue,
  freqs,
  topSet,
  sampleTokensFor,
}: ExpertGridProps) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const reducedMotion = usePrefersReducedMotion();
  const svgRef = useRef<SVGSVGElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  /** Vertical placement, decided after the tooltip has been laid out — its height depends on how
   *  many sample-token chips the expert has, so it can't be known in the pointer handler. `null`
   *  means "not measured yet"; the first paint of a hover uses the default `above`. */
  const [tipTop, setTipTop] = useState<number | null>(null);

  const numExperts = freqs.length;
  const { cols, rows } = gridShape(numExperts);
  const width = cols * CELL + (cols - 1) * GAP;
  const height = rows * CELL + (rows - 1) * GAP;

  const topList = Array.from(topSet).sort((a, b) => a - b);
  const topKey = topList.join(',');
  const summary = `${categoryLabel}: ${cols}×${rows} expert grid, top experts ${topList
    .map((e) => e + 1)
    .join(', ')}`;

  const hoverFreq = hover ? freqs[hover.expert] : 0;
  const hoverTokens = hover ? sampleTokensFor(hover.expert) : [];

  // Vertical placement, the companion to the horizontal clamp in the pointer handler. The tooltip
  // hangs above its cell by default, which the top row of grids inside AllCategoriesModal cuts in
  // half against the scrolling body's edge — so measure it and flip below when there is more room
  // there. It has to happen here rather than in `onMouseMove` because the height depends on how
  // many sample-token chips the expert has.
  //
  // Two rules keep this from oscillating. Only `height` is read off the tooltip's own rect — never
  // its top, which reflects the placement being decided and would flip-flop forever; the cell's
  // edges come from the SVG's rect plus the offsets stored at hover time. And `useLayoutEffect`, so
  // the unmeasured first render is never painted (it is hidden rather than placed, so there is one
  // coordinate convention here, not a pre- and post-measurement pair).
  useLayoutEffect(() => {
    const tip = tipRef.current;
    const svg = svgRef.current;
    if (!hover || !tip || !svg) {
      setTipTop(null);
      return;
    }
    const h = tip.getBoundingClientRect().height;
    const svgTop = svg.getBoundingClientRect().top;
    const { top: clipTop, bottom: clipBottom } = clipBounds(svg);
    const cellTop = svgTop + hover.y;
    const cellBottom = svgTop + hover.yBottom;
    const spaceAbove = cellTop - TOOLTIP_GAP - (clipTop + TOOLTIP_PAD);
    const spaceBelow = clipBottom - TOOLTIP_PAD - (cellBottom + TOOLTIP_GAP);
    // Flip only when above genuinely fails *and* below is the better of the two, so a bottom-row
    // cell in a short window stays where the reader expects it.
    const below = h > spaceAbove && spaceBelow > spaceAbove;
    const want = below ? cellBottom + TOOLTIP_GAP : cellTop - TOOLTIP_GAP - h;
    // Neither side fits: degrade to fully visible rather than cut off.
    const min = clipTop + TOOLTIP_PAD;
    const max = clipBottom - TOOLTIP_PAD - h;
    setTipTop((max < min ? min : Math.min(Math.max(want, min), max)) - svgTop);
  }, [hover]);

  // Pop the top-k forward and recede the rest. They all fire together (no stagger); a springy
  // back.out(2) gives the snappy, physical "pop." Re-runs when the top set changes (slider drag).
  useGSAP(
    () => {
      const root = svgRef.current;
      if (!root) return;
      const tops = root.querySelectorAll('g[data-top="true"]');
      const rest = root.querySelectorAll('g[data-top="false"]');

      if (reducedMotion) {
        gsap.set(tops, { ...POP, transformOrigin: 'center center' });
        gsap.set(rest, { ...RECEDE, transformOrigin: 'center center' });
        return;
      }

      gsap.to(tops, {
        ...POP,
        transformOrigin: 'center center',
        duration: 0.5,
        ease: 'back.out(2)',
        overwrite: 'auto',
      });
      gsap.to(rest, {
        ...RECEDE,
        transformOrigin: 'center center',
        duration: 0.45,
        ease: 'power2.out',
        overwrite: 'auto',
      });
    },
    { scope: svgRef, dependencies: [topKey, reducedMotion] }
  );

  // Descriptors for every cell; draw the non-top ones first so the popped top cells (and their
  // drop-shadows) paint on top of their neighbours rather than being clipped by later cells.
  const cells = Array.from({ length: numExperts }, (_, id) => {
    const col = id % cols;
    const row = Math.floor(id / cols);
    return {
      id,
      x: col * (CELL + GAP),
      y: row * (CELL + GAP),
      freq: freqs[id] ?? 0,
      isTop: topSet.has(id),
    };
  });
  const drawOrder = [...cells].sort((a, b) => Number(a.isTop) - Number(b.isTop));

  return (
    <div className="relative">
      <svg
        ref={svgRef}
        viewBox={`-1 -1 ${width + 2} ${height + 2}`}
        // Shrink to fit a narrow column, but never grow past the natural cell size: a
        // low-expert model (JetMoE routes over 8) would otherwise stretch its 4×2 block
        // across the whole column and render cells twice the size of a 64-expert grid.
        style={{ maxWidth: width + 2 }}
        className="w-full overflow-visible"
        role="img"
        aria-label={summary}
        onMouseLeave={() => setHover(null)}
      >
        {drawOrder.map(({ id, x, y, freq, isTop }) => {
          const isHovered = hover?.expert === id;
          return (
            <g key={id} data-top={isTop ? 'true' : 'false'}>
              <rect
                x={x}
                y={y}
                width={CELL}
                height={CELL}
                rx={6}
                fill={heatColor(freq, hue)}
                stroke="var(--color-ink)"
                strokeOpacity={isHovered ? 0.9 : isTop ? 0.5 : 0.06}
                strokeWidth={isTop || isHovered ? 1.5 : 1}
                // No pointer cursor: cells are hover-only, and a pointer would promise the
                // click-for-details modal that the Histogram view's bars have and these don't.
                style={{ transition: 'stroke-opacity 150ms var(--ease-out-expo)' }}
                onMouseMove={(e) => {
                  // The tooltip is anchored to the cell, not the pointer, so re-running this on
                  // every move of the same cell only costs a re-render of all 64 cells.
                  if (isHovered) return;
                  const svg = e.currentTarget.ownerSVGElement!;
                  const rect = svg.getBoundingClientRect();
                  const localX = ((x + CELL / 2 + 1) / (width + 2)) * rect.width;
                  // Clamp the centre against the clip box, then carry the correction back into
                  // `left`. It has to ride in `left` and not a second transform: the tooltip's
                  // centring and lift are one `transform`, so a shift alongside it would fight.
                  const { left, right } = clipBounds(svg);
                  const half = TOOLTIP_W / 2;
                  const min = left + TOOLTIP_PAD + half;
                  const max = right - TOOLTIP_PAD - half;
                  const centre = rect.left + localX;
                  const clamped =
                    // Bound narrower than the tooltip: centre in it rather than invert.
                    max < min ? (min + max) / 2 : Math.min(Math.max(centre, min), max);
                  setHover({
                    expert: id,
                    x: localX + (clamped - centre),
                    y: (y / (height + 2)) * rect.height,
                    yBottom: ((y + CELL) / (height + 2)) * rect.height,
                  });
                }}
              />
              <text
                x={x + CELL / 2}
                y={y + CELL / 2}
                textAnchor="middle"
                dominantBaseline="central"
                className="font-label"
                fontSize={12}
                fill={heatTextColor(freq)}
                fillOpacity={0.6}
                pointerEvents="none"
              >
                {String(id + 1).padStart(2, '0')}
              </text>
            </g>
          );
        })}
      </svg>

      {hover && (
        <div
          ref={tipRef}
          className="pointer-events-none absolute z-20 -translate-x-1/2 rounded-md bg-paper p-3 shadow-overlay-float"
          style={{
            left: hover.x,
            top: tipTop ?? 0,
            width: TOOLTIP_W,
            // Laid out (so it can be measured) but never painted at an unplaced position — the
            // layout effect above resolves `tipTop` before the browser paints this render.
            // `visibility`, never `display: none` and never withholding the element until
            // `tipTop` resolves: a hidden-but-laid-out box still reports its real height, and
            // that measurement is the whole basis of the placement. Either "simplification"
            // measures zero and puts every tooltip a tooltip's height out of place. (Same trap
            // as `replayPop`'s `getBBox` reading zero under `display: none`.)
            visibility: tipTop === null ? 'hidden' : undefined,
          }}
          role="tooltip"
        >
          <p className="font-label text-xs text-ink">
            Expert {String(hover.expert + 1).padStart(2, '0')}
            {topSet.has(hover.expert) && (
              <span className="ml-1.5 text-muted">· top {topSet.size}</span>
            )}
          </p>
          <p className="mt-0.5 font-body text-sm text-ink">
            {(hoverFreq * 100).toFixed(0)}% of {categoryLabel} tokens
          </p>
          {hoverTokens.length > 0 ? (
            <div className="mt-2">
              <p className="font-label text-[0.65rem] uppercase tracking-wide text-muted">
                Strongest tokens
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                {hoverTokens.map((t, i) => (
                  <span
                    key={i}
                    className="rounded-sm bg-surface px-1.5 py-0.5 font-label text-xs text-ink"
                  >
                    {t.token.trim() || '␣'}
                  </span>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-2 font-body text-xs text-muted">
              Not routed to by {categoryLabel} at this layer.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
