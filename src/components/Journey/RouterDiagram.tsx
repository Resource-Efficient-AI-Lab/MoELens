import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { computeRouterDiagramLayout, edgePath } from '../../utils/d3-helpers';

const VIEWBOX_WIDTH = 640;
/** 400, not the 640×460 the strip used: the Router modal is height-bound (the fan takes the space
 *  the chips/header/caption leave and scales into it), so every viewBox row costs rendered scale.
 *  352px of grid height still leaves 50px per row against a 36px selected node. */
const VIEWBOX_HEIGHT = 400;

/** Node radii and label sizes are tuned together — the labels sit inside the circles, so bumping
 *  one without the other either clips the text or floats it in empty space. At the modal's typical
 *  ~1.0 scale these render at roughly their px values. */
const IDLE_RADIUS = 11.5;
const SELECTED_RADIUS = 18;
const IDLE_FONT = 10.5;
const SELECTED_FONT = 11.5;

interface RouterDiagramProps {
  /** Top-k expert ids for the currently selected token, router-weight order. */
  expertIds: number[];
  /** Parallel array of routing weights, same order as expertIds. */
  scores: number[];
  /** Narrative beat: 0 intro, 1 token arrives, 2 scores computed, 3 top-k fire, 4 weights shown. */
  stage: 0 | 1 | 2 | 3 | 4;
  tokenLabel: string;
  /**
   * When true and stage ≥ 4, a looping halo radiates from the highest-weight expert (expert_ids[0])
   * to mark it as the layer's lead. The Journey passes `false` under reduced motion so no infinite
   * animation runs.
   */
  pulseTopExpert?: boolean;
  /** Total experts in this router's grid. Defaults to OLMoE's 64 (8×8); JetMoE passes 8 for both
   *  its FFN and attention routers so the fan resizes to an 8-node grid. */
  expertCount?: number;
}

/** Grid shape for a given expert count: OLMoE 64 → 8×8, JetMoE 8 → 4×2, else near-square.
 *  (`gridRows` is the count along x, `gridCols` the count along y — see computeRouterDiagramLayout.)
 *  JetMoE was 2×4, i.e. two tall columns: the frame is much wider than it is tall, so the axis with
 *  the single gap has to be the horizontal one or that gap stretches across the whole diagram. */
function gridForCount(n: number): { gridRows: number; gridCols: number } {
  if (n === 64) return { gridRows: 8, gridCols: 8 };
  if (n === 8) return { gridRows: 4, gridCols: 2 };
  const gridCols = Math.ceil(Math.sqrt(n));
  return { gridRows: Math.ceil(n / gridCols), gridCols };
}

interface HoverState {
  id: number;
  x: number;
  y: number;
}

/**
 * The single-layer router fan: one router node feeding 64 experts, top-8 lit amber. Reused by
 * the Journey stage (moved here from GuidedTour/). Wrapped in React.memo because the Journey
 * re-renders on every milestone-key change while the diagram's props (expertIds/scores for the
 * current layer+token) usually don't change — memo skips the SVG re-render unless they do.
 */
function RouterDiagramImpl({
  expertIds,
  scores,
  stage,
  tokenLabel,
  pulseTopExpert = false,
  expertCount = 64,
}: RouterDiagramProps) {
  const [hover, setHover] = useState<HoverState | null>(null);
  // The SVG's rendered CSS box. Everything that has to leave the viewBox coordinate system —
  // the composited halo below and the hover tooltip — maps through it, so it is measured once per
  // resize rather than per mouse move (getBoundingClientRect on every mousemove forces layout).
  const svgRef = useRef<SVGSVGElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setBox((prev) => (prev.w === r.width && prev.h === r.height ? prev : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(
    () =>
      computeRouterDiagramLayout({
        width: VIEWBOX_WIDTH,
        height: VIEWBOX_HEIGHT,
        expertIdleRadius: IDLE_RADIUS,
        expertSelectedRadius: SELECTED_RADIUS,
        ...gridForCount(expertCount),
      }),
    [expertCount]
  );

  const scoreById = useMemo(() => {
    const map = new Map<number, number>();
    expertIds.forEach((id, i) => map.set(id, scores[i]));
    return map;
  }, [expertIds, scores]);

  const selectedSet = useMemo(() => new Set(expertIds), [expertIds]);

  const edgesVisible = stage >= 2;
  const topEightActive = stage >= 3;
  const weightsVisible = stage >= 4;

  // Lead expert (highest router weight) whose halo pulses once weights are shown.
  const topExpertNode =
    pulseTopExpert && weightsVisible && expertIds.length > 0
      ? layout.experts[expertIds[0]]
      : undefined;
  const tokenAtRouter = stage >= 1;
  const routerActive = stage >= 2;
  const tokenPillOpacity = stage <= 1 ? 1 : 0;
  // Token pill travels left-to-right onto the router, mirroring the router's 9 o'clock position.
  const tokenPillX = tokenAtRouter ? layout.router.x : layout.router.x - 110;

  // viewBox → CSS px inside the wrapper. The SVG's box no longer keeps the viewBox aspect (the
  // Router modal sizes it to the height it has left), so preserveAspectRatio="xMidYMid meet"
  // letterboxes the content and both the scale and the centring offset have to be applied.
  const fit = Math.min(box.w / VIEWBOX_WIDTH, box.h / VIEWBOX_HEIGHT);
  const toPx = (x: number, y: number) => ({
    left: (box.w - VIEWBOX_WIDTH * fit) / 2 + x * fit,
    top: (box.h - VIEWBOX_HEIGHT * fit) / 2 + y * fit,
  });

  return (
    <div className="relative">
      {/* Lead-expert halo. An HTML element, not the <circle> it used to be, and drawn *under* the
          SVG so it still radiates from beneath the node. Chrome does not composite animated SVG
          content — an infinite transform/opacity loop on a <circle> repaints the whole SVG every
          frame, which on the 64-expert models cost a measured 27.9ms median frame under 6× CPU
          throttle (JetMoE's 8-node fan: 20.9ms). As a positioned div with will-change it gets its
          own layer and the same loop costs nothing: 6.9ms, identical to no halo at all.
          `will-change` on the SVG circle was measured and does NOT help — don't try it again. */}
      {topExpertNode && box.w > 0 && (
        <div
          className="expert-pulse-dot"
          style={{
            left: toPx(topExpertNode.x, topExpertNode.y).left - layout.expertSelectedRadius * fit,
            top: toPx(topExpertNode.x, topExpertNode.y).top - layout.expertSelectedRadius * fit,
            width: layout.expertSelectedRadius * 2 * fit,
            height: layout.expertSelectedRadius * 2 * fit,
          }}
        />
      )}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
        className="relative z-[1] w-full"
        role="img"
        aria-label={`Router diagram: token ${tokenLabel.trim()} routed to ${
          stage >= 3 ? `${expertIds.length} of ${expertCount} experts` : `${expertCount} candidate experts`
        }`}
        onMouseLeave={() => setHover(null)}
      >
        {/* Idle edges: all 64, drawn faint so sparsity reads as "most stayed off," not "most don't exist." */}
        <g>
          {layout.experts.map((expert) => (
            <path
              key={`edge-idle-${expert.id}`}
              d={edgePath(layout.router, expert)}
              fill="none"
              stroke="var(--color-ink)"
              strokeWidth={1}
              style={{
                opacity: edgesVisible ? 0.08 : 0,
                transition: 'opacity 500ms var(--ease-out-expo)',
              }}
            />
          ))}
        </g>

        {/* Active edges: the top 8, drawn on top in amber. */}
        <g>
          {layout.experts
            .filter((expert) => selectedSet.has(expert.id))
            .map((expert) => (
              <path
                key={`edge-active-${expert.id}`}
                d={edgePath(layout.router, expert)}
                fill="none"
                stroke="var(--light-red, var(--color-amber-signal))"
                strokeWidth={2}
                style={{
                  opacity: topEightActive ? 1 : 0,
                  transition: 'opacity 500ms var(--ease-out-expo)',
                }}
              />
            ))}
        </g>

        {/* Expert nodes, 8x8 grid. */}
        <g>
          {layout.experts.map((expert) => {
            const isSelected = topEightActive && selectedSet.has(expert.id);
            const radius = isSelected ? layout.expertSelectedRadius : layout.expertIdleRadius;
            const score = scoreById.get(expert.id);
            const label =
              isSelected && weightsVisible && score !== undefined
                ? score.toFixed(2)
                : String(expert.id + 1).padStart(2, '0');

            return (
              <g key={`expert-${expert.id}`}>
                {/* Invisible wider hit target, so the idle (smaller) nodes are still easy to hover. */}
                <circle
                  cx={expert.x}
                  cy={expert.y}
                  r={IDLE_RADIUS + 3}
                  fill="transparent"
                  onMouseMove={() => {
                    // Same letterbox mapping as the halo (see toPx) — without the offset the
                    // tooltip drifts sideways by up to ~80px at the outer columns.
                    const p = toPx(expert.x, expert.y);
                    setHover({ id: expert.id, x: p.left, y: p.top });
                  }}
                />
                <circle
                  cx={expert.x}
                  cy={expert.y}
                  r={radius}
                  fill={isSelected ? 'var(--light-red, var(--color-amber-signal))' : 'var(--color-surface)'}
                  stroke={isSelected ? 'none' : 'var(--color-ink)'}
                  strokeOpacity={isSelected ? 0 : 0.12}
                  style={{
                    transition:
                      'r 450ms var(--ease-out-expo), fill 450ms var(--ease-out-expo), stroke-opacity 450ms var(--ease-out-expo)',
                    pointerEvents: 'none',
                  }}
                />
                <text
                  x={expert.x}
                  y={expert.y}
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontFamily="var(--font-label)"
                  fontSize={isSelected && weightsVisible ? SELECTED_FONT : IDLE_FONT}
                  fill={isSelected ? 'var(--color-paper)' : 'var(--color-muted)'}
                  style={{ transition: 'fill 450ms var(--ease-out-expo)', pointerEvents: 'none' }}
                >
                  {label}
                </text>
              </g>
            );
          })}
        </g>

        {/* Router node — drawn before the token pill so the pill (wider than the router) reads as
            landing in front of it, rather than peeking out from behind. */}
        <circle
          cx={layout.router.x}
          cy={layout.router.y}
          r={layout.routerRadius}
          fill={routerActive ? 'var(--light-red, var(--color-amber-signal))' : 'var(--color-surface)'}
          stroke="var(--color-ink)"
          strokeOpacity={routerActive ? 0 : 0.25}
          strokeWidth={1.5}
          style={{ transition: 'fill 500ms var(--ease-out-expo), stroke-opacity 500ms var(--ease-out-expo)' }}
        />
        <text
          x={layout.router.x}
          y={layout.router.y}
          textAnchor="middle"
          dominantBaseline="central"
          fontFamily="var(--font-body)"
          fontWeight={600}
          fontSize={12.5}
          fill={routerActive ? 'var(--color-paper)' : 'var(--color-ink)'}
          style={{ transition: 'fill 500ms var(--ease-out-expo)', pointerEvents: 'none' }}
        >
          Router
        </text>

        {/* Token pill: travels from left of the router onto it, then fades as it's absorbed. */}
        <g style={{ opacity: tokenPillOpacity, transition: 'opacity 400ms var(--ease-out-expo)' }}>
          <rect
            x={tokenPillX - 46}
            y={layout.router.y - 14}
            width={92}
            height={28}
            rx={14}
            fill="var(--color-ink)"
            style={{ transition: 'x 550ms var(--ease-out-expo)' }}
          />
          <text
            x={tokenPillX}
            y={layout.router.y}
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="var(--font-label)"
            fontSize={12}
            fill="var(--color-paper)"
            style={{ transition: 'x 550ms var(--ease-out-expo)', pointerEvents: 'none' }}
          >
            {tokenLabel.trim()}
          </text>
        </g>
      </svg>

      {hover && (
        <div
          className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-paper p-3 shadow-overlay-float"
          style={{ left: hover.x, top: hover.y - 10 }}
          role="tooltip"
        >
          <p className="font-label text-xs text-ink">Expert {String(hover.id + 1).padStart(2, '0')}</p>
          <p className="mt-0.5 font-body text-sm text-ink">
            {topEightActive && selectedSet.has(hover.id)
              ? `Selected · weight ${scoreById.get(hover.id)?.toFixed(2) ?? 'n/a'}`
              : 'Not selected this pass'}
          </p>
        </div>
      )}
    </div>
  );
}

export const RouterDiagram = memo(RouterDiagramImpl);
