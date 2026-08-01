interface LayerSliderProps {
  layer: number;
  numLayers: number;
  /** First layer that routes between experts — 1 for DeepSeek, whose layer 0 is a dense FFN.
   *  Below this the per-expert arrays are all zeros and every view would show fabricated
   *  structure, so the slider simply can't reach them. */
  minLayer?: number;
  onChange: (layer: number) => void;
}

/**
 * The layer control for the "Experts activation rates per layer" sub-tab. It sits outside that sub-tab's
 * heat-grid/histogram toggle so flipping the view compares the same layer rather than resetting
 * it, and it holds its layer for the Top-experts sub-tab to jump to.
 */
export function LayerSlider({ layer, numLayers, minLayer = 0, onChange }: LayerSliderProps) {
  return (
    // Track and footnote sit side by side on one 32px band, so this control is exactly as tall as
    // the category pills next to it on every model — stacking the footnote underneath used to make
    // DeepSeek and JetMoE (which have a dense first layer to explain) push the whole control row,
    // and everything below it, down. It stays in flow rather than being absolutely positioned:
    // out of flow it would print over the sub-tab's hint paragraph or the "open all" link.
    <div className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1">
      {/* One 32px row — label, track, readout — so the control occupies exactly the height of the
          category pills and the view switch it shares a row with (both are 32px; see
          `.view-switch-label` in moe.css). Stacking the label above the track made this the one
          control in the row that overhung the band. `w-80` is a definite width on purpose: as a
          flex item inside a flex item, a percentage one resolves circularly. */}
      <div className="flex h-8 w-80 max-w-full items-center gap-2">
        <label htmlFor="domain-layer-slider" className="font-label text-xs text-muted">
          Layer
        </label>
        <input
          id="domain-layer-slider"
          type="range"
          min={minLayer}
          max={numLayers - 1}
          value={layer}
          onChange={(e) => onChange(Number(e.target.value))}
          className="min-w-0 flex-1"
          style={{ accentColor: 'var(--color-amber-signal)' }}
        />
        <span className="font-label whitespace-nowrap text-xs text-ink">
          {layer + 1} <span className="text-muted">/ {numLayers}</span>
        </span>
      </div>
      {minLayer > 0 && (
        // One line, no wrapping: it rides the same band as the track, so a second line would put
        // the height back. The old trailing "(no experts to route)." was dropped when this moved
        // beside the track — the row it now shares with the pills and the "open all" link has no
        // 130px to spare, and "dense" carries the point on its own.
        <p className="whitespace-nowrap font-label text-[0.65rem] text-muted" title="Dense layers route every token through one shared FFN, so there are no per-expert rates to show.">
          {minLayer > 1 ? `Layers 1–${minLayer} are dense FFNs` : 'Layer 1 is a dense FFN'}
        </p>
      )}
    </div>
  );
}
