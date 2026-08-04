/**
 * Live narration copy for the Model Architecture flow row, lifted out of `archExplorer.ts`
 * unchanged: one sentence per flow block, shown by the guided tour card above the row. Index
 * matches the block push order in `buildPdfBlocks` (0 = Embedding … 7 = Final RMSNorm,
 * 8 = Final Output), and the tour indexes blocks POSITIONALLY — all three arrays are 9 long and a
 * missing entry silently shifts every step.
 *
 * Pure data. The two per-model parameters the copy used to read off the closure (the layer count,
 * and the name of the block the pre-MoE norm feeds) are arguments to `finalNormText` /
 * `preMoeNormText` instead.
 */

export interface NarrationStep {
  title: string;
  text: string;
}

/** The three-way per-model pick, moved out of `archExplorer.ts` when the guided tour became React
 *  (2026-08-02) — the tour card is the only reader of these tables, so the selection belongs with
 *  whoever renders it. Order matters: JetMoE also has no `shared_experts`, so `is_moa` is tested
 *  first. */
export function pickNarration(isMoa: boolean, sharedExperts?: number): NarrationStep[] {
  if (isMoa) return JETMOE_NARRATION;
  if (sharedExperts) return DEEPSEEK_NARRATION;
  return OLMOE_NARRATION;
}

export const RMSNORM_TEXT = 'Each token’s vector is divided by the root-mean-square of its own values, then rescaled by a learned gain γ. Attention reads this normalized copy; the residual stream itself is carried forward untouched.';
// The post-attention pair, split into two blocks (was one fused "Residual + RMSNorm"): the add
// closes the attention sub-block, the norm opens the MoE one. The add's wording is identical in
// all three models; only the norm names the block it feeds.
export const RESIDUAL_ADD_TEXT = 'Attention’s output is added back onto its own input. The residual connection lets attention contribute to the stream rather than replace it, so earlier layers’ signal is preserved.';
// The 8th block, outside the card: `model.norm`. One entry per model only because the layer
// count differs. Split out of the old Final Output narration, which used to carry "one more
// RMSNorm and a projection through the LM head" — that first half is now its own block.
export const finalNormText = (n: number) =>
  'After all ' + n + ' layers, the stream is normalized once more under the same rule, with its own learned γ. Only this final state reaches the LM head, so the block sits outside the layer loop.';
export const preMoeNormText = (nextBlock: string) =>
  'A second RMSNorm, same rule but its own learned γ. The ' + nextBlock + ' and its router read this normalized copy; the stream is again carried forward untouched for the next add.';

export const OLMOE_NARRATION: NarrationStep[] = [
  { title: 'Embedding', text: 'Each token becomes a 2048-dimensional vector by a single row lookup in the embedding table. No matrix multiply yet.' },
  { title: 'RMSNorm', text: RMSNORM_TEXT },
  { title: 'Multihead Attention + RoPE', text: 'The normalized stream is projected into Q, K and V across 16 heads of 128 dimensions. RoPE rotates Q and K by token position; causal-masked softmax over Q·Kᵀ/√hd then weights V.' },
  { title: 'Residual (post-attention)', text: RESIDUAL_ADD_TEXT },
  { title: 'RMSNorm (pre-MoE)', text: preMoeNormText('MoE block') },
  { title: 'MoE Layer', text: 'A (2048 → 64) router emits one logit per expert, softmaxes them, and selects the top 8; the other 56 never run. Each selected expert is a SwiGLU feed-forward block, and the layer output is their router-weighted sum.' },
  { title: 'Residual', text: 'The MoE output is added back onto the residual stream, giving this layer’s output and the next layer’s input.' },
  { title: 'Final RMSNorm', text: finalNormText(16) },
  { title: 'Final Output', text: 'The normalized final state is projected through the vocabulary-sized LM head; a softmax over those logits gives the next-token distribution.' },
];
// DeepSeek-MoE-16B: 28 layers, 64 routed experts (top-6) + 2 always-on shared experts, and
// layer 1 is a single dense feed-forward layer (no router).
// Tour step 6's text on DeepSeek's one dense layer. The MoE narration below describes the 64
// routed + 2 shared experts that layer does not have, so the card would otherwise contradict the
// "Dense FFN" block it is highlighting (the title already swaps in renderTourStep).
export const DENSE_FFN_TEXT = 'Layer 1 has no router and no experts, just one dense feed-forward network every token passes through. Every later layer splits into 64 routed experts plus 2 shared.';
export const DEEPSEEK_NARRATION: NarrationStep[] = [
  { title: 'Embedding', text: 'Each token becomes a 2048-dimensional vector by a single row lookup in the embedding table. No matrix multiply yet.' },
  { title: 'RMSNorm', text: RMSNORM_TEXT },
  { title: 'Multihead Attention + RoPE', text: 'The normalized stream is projected into Q, K and V across 16 heads of 128 dimensions. RoPE rotates Q and K by token position; causal-masked softmax over Q·Kᵀ/√hd then weights V.' },
  { title: 'Residual (post-attention)', text: RESIDUAL_ADD_TEXT },
  { title: 'RMSNorm (pre-MoE)', text: preMoeNormText('feed-forward block') },
  { title: 'MoE Layer', text: 'Each feed-forward block splits into 64 fine-grained routed experts plus 2 always-on shared experts. The router keeps the top 6 routed experts per token; those run alongside the shared pair and the outputs are summed.' },
  { title: 'Residual', text: 'The feed-forward output is added back onto the residual stream, giving this layer’s output and the next layer’s input.' },
  { title: 'Final RMSNorm', text: finalNormText(28) },
  { title: 'Final Output', text: 'The normalized final state is projected through the vocabulary-sized LM head; a softmax over those logits gives the next-token distribution.' },
];
// JetMoE-8B: 24 layers, sparse on both sides — attention is a routed block (Mixture-of-Attention:
// 8 attention experts, top-2) and the feed-forward is 8 experts, top-2.
export const JETMOE_NARRATION: NarrationStep[] = [
  { title: 'Embedding', text: 'Each token becomes a 2048-dimensional vector by a single row lookup in the embedding table. No matrix multiply yet.' },
  { title: 'RMSNorm', text: RMSNORM_TEXT + ' Here it also feeds the attention (MoA) router.' },
  { title: 'Attention (MoA)', text: 'Attention is sparse too: 8 attention experts, top-2 per token. Each has its own Q and output projections but shares K and V: 2 experts × 16 query heads over 16 shared K/V heads, i.e. grouped-query attention.' },
  { title: 'Residual (post-attention)', text: RESIDUAL_ADD_TEXT },
  { title: 'RMSNorm (pre-MoE)', text: preMoeNormText('feed-forward block') },
  { title: 'MoE Layer', text: 'The router scores this token against all 8 experts, softmaxes the logits, and selects the top 2; the other 6 never run. The layer output is the router-weighted sum of the 2 selected SwiGLU experts.' },
  { title: 'Residual', text: 'The feed-forward output is added back onto the residual stream, giving this layer’s output and the next layer’s input.' },
  { title: 'Final RMSNorm', text: finalNormText(24) },
  { title: 'Final Output', text: 'The normalized final state is projected through the vocabulary-sized LM head; a softmax over those logits gives the next-token distribution.' },
];
