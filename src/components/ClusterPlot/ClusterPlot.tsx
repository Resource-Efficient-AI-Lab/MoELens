import { useMemo, useRef, useState } from 'react';
import gsap from 'gsap';
import { useGSAP } from '@gsap/react';
import type { UmapData, UmapPoint } from '../../data/types';
import { CATEGORY_LABELS } from '../../data/categories';
import { CATEGORY_PALETTE } from './categoryPalette';

gsap.registerPlugin(useGSAP);

const VIEW_W = 640;
const VIEW_H = 440;
const PAD = 20;

const IDLE_OPACITY = 0.35;
const ACTIVE_OPACITY = 0.9;

interface ClusterPlotProps {
  umap: UmapData;
  activeCategories: Set<string>;
}

interface Placed extends UmapPoint {
  px: number;
  py: number;
}

interface HoverState {
  point: Placed;
  x: number;
  y: number;
}

/**
 * Every (layer, expert) pair projected to 2D by activation-profile similarity — 1024 for OLMoE,
 * 192 for JetMoE, 1728 for DeepSeek (whose layer 0 is dense, so it contributes no points).
 * Nothing here assumes a count or a contiguous layer range; the layout scales to whatever
 * `umap.points` holds.
 * The reader opens on a single category and can progressively toggle in more (up to all
 * six), each drawn in its own qualitative palette color (see categoryPalette.ts — a
 * documented exception to DESIGN.md's Rarity Rule). All points always render; toggled-out
 * categories sit dimmed in idle grey rather than disappearing, so the reader can see the
 * shape of the whole model while the active clusters read as the visual foreground.
 */
export function ClusterPlot({ umap, activeCategories }: ClusterPlotProps) {
  const [hover, setHover] = useState<HoverState | null>(null);

  // Layout over ALL points, keyed only on `umap` — so toggling a category never
  // rescales or reflows the plot.
  const placedAll = useMemo<Placed[]>(() => {
    const xs = umap.points.map((p) => p.x);
    const ys = umap.points.map((p) => p.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const sx = (VIEW_W - 2 * PAD) / (maxX - minX || 1);
    const sy = (VIEW_H - 2 * PAD) / (maxY - minY || 1);

    return umap.points.map((p) => ({
      ...p,
      px: PAD + (p.x - minX) * sx,
      // Flip Y so larger values sit higher, as a scatter plot conventionally reads.
      py: VIEW_H - PAD - (p.y - minY) * sy,
    }));
  }, [umap]);

  // All points always render — toggling a category recolors its dots rather than hiding
  // the others. Sorted idle-first so active (toggled-in) dots draw on top of the grey field,
  // then by category for a deterministic, stable order within each group.
  const visible = useMemo(
    () =>
      [...placedAll].sort((a, b) => {
        const aActive = activeCategories.has(a.dominant_category) ? 1 : 0;
        const bActive = activeCategories.has(b.dominant_category) ? 1 : 0;
        if (aActive !== bActive) return aActive - bActive;
        return a.dominant_category.localeCompare(b.dominant_category);
      }),
    [placedAll, activeCategories]
  );

  const activeLabels = Array.from(activeCategories)
    .map((c) => CATEGORY_LABELS[c] ?? c)
    .join(', ');

  // Every dot is actually two stacked circles (see render below): a constant grey base and a
  // category-colored overlay whose opacity is the only thing that ever animates. Toggling a
  // category tweens its overlay's opacity 0 <-> ACTIVE_OPACITY, crossfading over the grey base.
  // This is deliberate: GSAP's color parser only understands hex/rgb/hsl, not the oklch()
  // strings CATEGORY_PALETTE uses, so tweening `fill` directly can't interpolate and just
  // snaps — a plain opacity tween sidesteps that entirely. Already-settled categories are
  // untouched. Stable string key so useGSAP re-runs on any change to the active set (Sets
  // aren't valid deps).
  const svgRef = useRef<SVGSVGElement | null>(null);
  const prevCats = useRef<Set<string>>(new Set(activeCategories));
  const activeKey = Array.from(activeCategories).sort().join(',');

  useGSAP(
    () => {
      const root = svgRef.current;
      if (!root) return;
      const added = Array.from(activeCategories).filter((c) => !prevCats.current.has(c));
      const removed = Array.from(prevCats.current).filter((c) => !activeCategories.has(c));
      prevCats.current = new Set(activeCategories);
      if (added.length === 0 && removed.length === 0) return;

      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const duration = reduce ? 0 : 0.4;

      added.forEach((c) => {
        const overlays = Array.from(
          root.querySelectorAll<SVGCircleElement>(`g[data-cat="${c}"] circle[data-role="overlay"]`)
        );
        if (overlays.length === 0) return;
        gsap.fromTo(
          overlays,
          { opacity: 0 },
          {
            opacity: ACTIVE_OPACITY,
            duration,
            ease: 'power2.out',
            stagger: reduce ? 0 : { each: 0.004, from: 'random' },
          }
        );
      });

      removed.forEach((c) => {
        const overlays = Array.from(
          root.querySelectorAll<SVGCircleElement>(`g[data-cat="${c}"] circle[data-role="overlay"]`)
        );
        if (overlays.length === 0) return;
        gsap.to(overlays, {
          opacity: 0,
          duration,
          ease: 'power2.out',
        });
      });
    },
    { dependencies: [activeKey], scope: svgRef }
  );

  return (
    <div>
      <div className="relative mt-4 rounded-md border border-ink/10 bg-paper p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          className="w-full"
          role="img"
          aria-label={`UMAP scatter of ${umap.points.length} experts; showing ${activeLabels}`}
          onMouseLeave={() => setHover(null)}
        >
          {visible.map((p) => {
            const isActive = activeCategories.has(p.dominant_category);
            return (
              <g key={`${p.layer_id}-${p.expert_id}`} data-cat={p.dominant_category}>
                {/* Invisible wider hit target so small dots are hoverable. */}
                <circle
                  cx={p.px}
                  cy={p.py}
                  r={7}
                  fill="transparent"
                  onMouseMove={(e) => {
                    const rect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                    setHover({
                      point: p,
                      x: (p.px / VIEW_W) * rect.width,
                      y: (p.py / VIEW_H) * rect.height,
                    });
                  }}
                />
                {/* Constant grey base — always present, never animated. */}
                <circle
                  cx={p.px}
                  cy={p.py}
                  r={4.4}
                  fill="var(--color-muted)"
                  opacity={IDLE_OPACITY}
                  stroke="var(--color-paper)"
                  strokeWidth={1}
                  style={{ pointerEvents: 'none' }}
                />
                {/* Category-colored overlay — only its opacity ever animates (toggle in/out). */}
                <circle
                  data-role="overlay"
                  cx={p.px}
                  cy={p.py}
                  r={4.4}
                  fill={CATEGORY_PALETTE[p.dominant_category] ?? 'var(--color-muted)'}
                  opacity={isActive ? ACTIVE_OPACITY : 0}
                  stroke="var(--color-paper)"
                  strokeWidth={1}
                  style={{ pointerEvents: 'none' }}
                />
              </g>
            );
          })}
        </svg>

        {hover && (
          <div
            className="pointer-events-none absolute z-20 w-60 -translate-x-1/2 -translate-y-full rounded-md bg-paper p-3 shadow-overlay-float"
            style={{ left: hover.x, top: hover.y - 10 }}
            role="tooltip"
          >
            <p className="font-label text-xs text-ink">
              Layer {hover.point.layer_id + 1} · Expert{' '}
              {String(hover.point.expert_id + 1).padStart(2, '0')}
            </p>
            <p className="mt-0.5 font-body text-sm text-ink">
              Leans <span className="font-semibold">{hover.point.dominant_category.replace(/_/g, ' ')}</span>
            </p>
            {hover.point.top_tokens.length > 0 && (
              <div className="mt-2">
                <p className="font-label text-[0.65rem] uppercase tracking-wide text-muted">
                  Strongest tokens
                </p>
                <div className="mt-1 flex flex-wrap gap-1">
                  {hover.point.top_tokens.slice(0, 3).map((t, i) => (
                    <span
                      key={i}
                      className="rounded-sm bg-surface px-1.5 py-0.5 font-label text-xs text-ink"
                    >
                      {t.token.trim() || '␣'}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
