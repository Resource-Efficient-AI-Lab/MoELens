/**
 * The three flow-row blocks that sit OUTSIDE the transformer-block card — Embedding (index 0),
 * Final RMSNorm (7) and Final Output (8) — as pure content builders.
 *
 * They were built inside `archExplorer.ts`'s `buildPdfBlocks` until 2026-08-02, when React took
 * over the row scaffold. They are the only three blocks that can move, and the reason is that
 * NONE of them reads per-layer or per-focus state: no `currentLayer`, and no
 * `focusT`/`flowToken`/`flowHead`/`flowAttnExpert` either (verified against every branch of the old
 * builder). Their markup therefore changes only when the prompt or model changes, which is exactly
 * what lets React memoise them on `flow` alone. The six in-card blocks stay imperative — they are
 * rebuilt on every layer step and the deck island owns them.
 *
 * ⚠ These run during React's RENDER, not from an effect, so that the row's outer blocks are already
 * populated when the deck island measures them (`drawFlowArcs` reads the Final RMSNorm's rect).
 * That means `root` must already be in the document: it is, because ArchitectureTab's first render
 * returns the loading placeholder while `flow` is null, so `.moe-root` is mounted a commit before
 * any of this is called. A missed root would be loud, not silent — the accents come from CSS custom
 * properties read here, so every block would lose its colour.
 */
import { buildStripHTML, escapeHtml } from './mathDiagram';
import { sequentialBlue } from './colorRamps';
import type { PromptFlow } from './types';

/** One block's rendered pieces. `html` is the block's inner markup; `accent` becomes the
 *  `--block-accent` custom property, exactly as `pdfBlock()` set it. */
export interface FlowBlockContent {
  title: string;
  accent: string;
  extraClass: string;
  html: string;
  /** Hover popover, if the block has one (Final RMSNorm does). */
  popoverTitle?: string;
  popover?: string;
  hoverHint?: string;
  clickHint?: string;
}

export interface OuterFlowBlocks {
  embed: FlowBlockContent;
  finalNorm: FlowBlockContent;
  finalOutput: FlowBlockContent;
}

/** Verbatim from archExplorer, where both still live for the in-card blocks. */
const cssVar = (root: HTMLElement, name: string) => getComputedStyle(root).getPropertyValue(name).trim();
const eq = (name: string, dim: string) =>
  '<span class="cell-name">' + name + '</span><span class="cell-dim">' + dim + '</span>';

export function buildOuterFlowBlocks(DATA: PromptFlow, root: HTMLElement): OuterFlowBlocks {
  const flow = DATA.layer_flow;
  const tokens = DATA.tokens;
  const numTokens = tokens.length;
  const H = DATA.hidden_size;
  const green = cssVar(root, '--series-4');
  const yellow = cssVar(root, '--series-3');
  const violet = cssVar(root, '--series-5');
  const stripHTML = (vec: number[], cw: number) => buildStripHTML((t) => sequentialBlue(root, t), vec, cw);

  // 1. Embedding Layer — per-token chips, hover each for its real embedding vector
  const tokenChips = tokens.map((t, i) => {
    const c = green;
    return '<span class="pdf-token-chip" data-tidx="' + i + '" style="border-color:' + c + ';color:' + c + '">' + escapeHtml(t.text.trim() || '·') +
      '<span class="pdf-token-popover"><div class="dims" style="color:var(--text-primary);font-weight:650">' +
      escapeHtml(t.text.trim() || '(space)') + ': embedding (1,' + H + ')</div>' +
      '<div class="grid-wrap">' + stripHTML(flow.embed_strip[i], 4) + '</div></span></span>';
  }).join('');

  // 9. Final output token layer — REAL DATA, thin: just "token — pct%", no bars
  const cands = DATA.next_token_candidates.slice(0, 6);
  const ntRows = cands.map((c, i) =>
    '<div class="pdf-nt-row"' + (i === 0 ? ' style="font-weight:750"' : '') + '><span class="tok' + (i === 0 ? ' top' : '') + '">' + escapeHtml(c.token.trim() || '·') + '</span>' +
    '<span class="pct">' + (c.prob * 100).toFixed(1) + '%</span></div>'
  ).join('');

  return {
    embed: {
      title: 'Embedding', accent: green, extraClass: 'narrow embed-narrow',
      html: '<div class="dims">' + eq('Tokens → Emb', '(' + numTokens + ', ' + H + ')') + '</div>' +
        '<div style="margin:4px 0 2px">' + tokenChips + '</div>',
    },
    // 8. Final RMSNorm (thin) — `model.norm`, the one norm that is NOT part of any transformer
    // block: it runs once on the last layer's output, before the LM head. It therefore sits
    // OUTSIDE the card, between the stage and Final Output.
    // The proposal gated it to the last layer (it is only reached there). Shown on every layer
    // instead, by request — so the "not per-layer" fact has to be carried by its popover, which
    // opens by saying it is not part of this layer, and by its tour-card title. Its own <h4> is
    // the bare "RMSNorm" (matching the two in-card norms) as of 2026-07-31, by request: sitting
    // outside the card, after the loop-back, is what marks it as the odd one out.
    finalNorm: {
      title: 'RMSNorm', accent: yellow, extraClass: 'thin final-norm',
      html: '',
      popoverTitle: 'Final RMSNorm (once, after the last block)',
      popover: '<div class="dims">' +
        '<div>' + eq('layer ' + DATA.num_layers + ' output', '(' + numTokens + ',' + H + ')') + ' <span class="op">÷ RMS ⊙ γ →</span> ' + eq('normalized stream', '(' + numTokens + ',' + H + ')') + '</div>' +
        '<div class="foot-note">Not part of this transformer block. The same RMSNorm rule, applied <b>once</b> after the last of the ' + DATA.num_layers + ' blocks and before the LM head projection, so the loop below runs ' + DATA.num_layers + ' times and only then reaches this step.</div></div>',
      hoverHint: 'click to see where the final numbers come from',
      clickHint: 'click to see where the final numbers come from',
    },
    finalOutput: {
      title: 'Final Output', accent: violet, extraClass: 'narrow out-narrow',
      html: '<div class="dims" style="margin-bottom:5px">softmax %,&nbsp;layer&nbsp;' + DATA.num_layers + '</div>' + ntRows,
      // No clickHint (2026-08-01, by request). The block still opens the final-output math stage;
      // the Final RMSNorm immediately upstream carries the same hint and opens the same stage, so
      // the affordance is not lost — the hint was just printing twice, side by side.
    },
  };
}

/** The exact inner markup `pdfBlock()` produced, so a React-rendered block is byte-identical to an
 *  imperative one. Verified character-for-character in the live page (both the one-custom-property
 *  and the two-custom-property cases) before any of this was written. */
export function flowBlockInnerHtml(b: FlowBlockContent): string {
  return '<h4>' + b.title + '</h4>' + (b.html || '') +
    (b.popover ? '<div class="pdf-hover-hint">' + (b.hoverHint || 'click to see ' + (b.popoverTitle || b.title)) + '</div><div class="pdf-popover"><h5>' + (b.popoverTitle || b.title) + '</h5>' + b.popover + '</div>' : '') +
    (b.clickHint ? '<div class="pdf-click-hint">' + b.clickHint + '</div>' : '');
}
