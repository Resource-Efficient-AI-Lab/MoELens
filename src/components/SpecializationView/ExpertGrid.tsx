import { useRef, useState } from 'react';
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

/**
 * Horizontal bounds the tooltip has to stay inside: the viewport, narrowed by every ancestor that
 * clips. Both bounds are real here — loose in the panel nothing clips, so the viewport is the only
 * edge (a leftmost cell's tooltip is centred on a cell ~17px in and hangs 90px past x=0); inside
 * AllCategoriesModal the scrolling body clips at its own padding box, where a `window.innerWidth`
 * clamp would do nothing at all.
 */
function clipBounds(el: Element | null): { left: number; right: number } {
  let left = 0;
  // `clientWidth`, never `window.innerWidth` — the latter counts the vertical scrollbar's gutter,
  // which is the one strip of the viewport that cannot show a tooltip.
  let right = document.documentElement.clientWidth;
  // Per spec a `visible` axis computes to `auto`/`clip` when the other axis is not, so testing
  // overflow-x alone also catches the modal's `overflow-y: auto` body.
  for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
    if (getComputedStyle(node).overflowX !== 'visible') {
      const r = node.getBoundingClientRect();
      // Content is cut at the padding box minus any scrollbar, which is what clientLeft/clientWidth
      // measure; the border-box rect would be a few px too generous on exactly the containers that
      // scroll. The `||` fallbacks keep a non-HTML ancestor from poisoning the bound with NaN.
      const inset = node.clientLeft || 0;
      left = Math.max(left, r.left + inset);
      right = Math.min(right, r.left + inset + (node.clientWidth || r.width));
    }
  }
  return { left, right };
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
  y: number;
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
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full rounded-md bg-paper p-3 shadow-overlay-float"
          style={{ left: hover.x, top: hover.y - 8, width: TOOLTIP_W }}
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
