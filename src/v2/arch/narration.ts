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

export const RMSNORM_TEXT = 'Before attention runs, the residual stream is normalized: each token’s vector is divided by the root-mean-square of its own values, then rescaled by a learned gain γ, which keeps the numbers in a stable range no matter how many layers have already added into the stream. This is a side branch, not an update: attention reads this normalized copy while the residual stream itself is carried forward untouched, so it can be added back one step later.';
// The post-attention pair, split into two blocks (was one fused "Residual + RMSNorm"): the add
// closes the attention sub-block, the norm opens the MoE one. The add's wording is identical in
// all three models; only the norm names the block it feeds.
export const RESIDUAL_ADD_TEXT = 'Attention’s output is added back onto its own input, the untouched copy of the residual stream from one step earlier. This is the "residual" (or skip) connection: attention contributes to the stream rather than replacing it, so information from earlier layers is never discarded.';
// The 8th block, outside the card: `model.norm`. One entry per model only because the layer
// count differs. Split out of the old Final Output narration, which used to carry "one more
// RMSNorm and a projection through the LM head" — that first half is now its own block.
export const finalNormText = (n: number) =>
  'This one is not part of any transformer block. After the loop has run all ' + n + ' times, the residual stream is normalized once more by the same RMSNorm rule, with its own learned gain γ. Only this final normalized state is handed to the LM head, which is why it sits outside the block on the right of the deck rather than inside it.';
export const preMoeNormText = (nextBlock: string) =>
  'The stream is normalized a second time, by the same RMSNorm rule as before attention (divide by the root-mean-square of the token’s own values, rescale by a learned gain γ) but with its own learned γ. This normalized copy is what the ' + nextBlock + ' reads, including its router, while the residual stream itself is once again carried forward untouched, ready to be added back after the ' + nextBlock + ' runs.';

export const OLMOE_NARRATION: NarrationStep[] = [
  { title: 'Embedding', text: 'Each token is converted into a 2048-dimensional vector by a single row lookup in the embedding table, no matrix multiply yet.' },
  { title: 'RMSNorm', text: RMSNORM_TEXT },
  { title: 'Multihead Attention + RoPE', text: 'The normalized stream is projected into Q, K, and V across 16 heads of 128 dimensions each. RoPE rotates Q and K by each token’s position before the attention scores (Q·Kᵀ, causal-masked, softmaxed) are computed and used to weight V.' },
  { title: 'Residual (post-attention)', text: RESIDUAL_ADD_TEXT },
  { title: 'RMSNorm (pre-MoE)', text: preMoeNormText('MoE block') },
  { title: 'MoE Layer', text: 'This layer has 64 independent "expert" feed-forward networks, but only 8 of them run for any given token. First, a small router (a single (2048 → 64) weight matrix) takes this token’s normalized hidden state and produces one logit per expert, then softmaxes those 64 logits into a probability distribution: how strongly the router “prefers” each expert for this specific token. The 8 highest-probability experts are selected; the other 56 are skipped entirely (not just zeroed out, never multiplied at all, which is what makes MoE cheap to run despite being huge to store). Each of the 8 selected experts is a full SwiGLU feed-forward block with its own weights (gate = SiLU(h·W_gate), up = h·W_up, output = (gate ⊙ up)·W_down). The layer’s final output is a weighted sum of those 8 experts’ outputs, using the router’s own real probabilities as the weights, so an expert the router was more confident about contributes more to the result.' },
  { title: 'Residual', text: 'The MoE block’s output is added back onto the residual stream, producing this layer’s final output, which becomes the next layer’s input.' },
  { title: 'Final RMSNorm', text: finalNormText(16) },
  { title: 'Final Output', text: 'The normalized final state is projected through the vocabulary-sized LM head, and a softmax over those logits gives the model’s real next-token probabilities.' },
];
// DeepSeek-MoE-16B: 28 layers, 64 routed experts (top-6) + 2 always-on shared experts, and
// layer 1 is a single dense feed-forward layer (no router).
// Tour step 6's text on DeepSeek's one dense layer. The MoE narration below describes the 64
// routed + 2 shared experts that layer does not have, so the card would otherwise contradict the
// "Dense FFN" block it is highlighting (the title already swaps in renderTourStep).
export const DENSE_FFN_TEXT = 'Layer 1 has no router and no experts, just one dense feed-forward network that every token passes through. Every layer after this one splits into 64 routed experts plus 2 shared.';
export const DEEPSEEK_NARRATION: NarrationStep[] = [
  { title: 'Embedding', text: 'Each token is converted into a 2048-dimensional vector by a single row lookup in the embedding table, no matrix multiply yet.' },
  { title: 'RMSNorm', text: RMSNORM_TEXT },
  { title: 'Multihead Attention + RoPE', text: 'The normalized stream is projected into Q, K, and V across 16 heads of 128 dimensions each. RoPE rotates Q and K by each token’s position before the attention scores (Q·Kᵀ, causal-masked, softmaxed) are computed and used to weight V.' },
  { title: 'Residual (post-attention)', text: RESIDUAL_ADD_TEXT },
  { title: 'RMSNorm (pre-MoE)', text: preMoeNormText('feed-forward block') },
  { title: 'MoE Layer', text: 'DeepSeek splits each feed-forward block into 64 small routed "experts" plus 2 always-on shared experts. For every token, a router scores all 64 routed experts and keeps the top 6; those 6 run alongside the 2 shared experts (which every token always uses), and their outputs are summed.' },
  { title: 'Residual', text: 'The feed-forward block’s output is added back onto the residual stream, producing this layer’s final output, which becomes the next layer’s input.' },
  { title: 'Final RMSNorm', text: finalNormText(28) },
  { title: 'Final Output', text: 'The normalized final state is projected through the vocabulary-sized LM head, and a softmax over those logits gives the model’s real next-token probabilities.' },
];
// JetMoE-8B: 24 layers, sparse on both sides — attention is a routed block (Mixture-of-Attention:
// 8 attention experts, top-2) and the feed-forward is 8 experts, top-2.
export const JETMOE_NARRATION: NarrationStep[] = [
  { title: 'Embedding', text: 'Each token is converted into a 2048-dimensional vector by a single row lookup in the embedding table, no matrix multiply yet.' },
  { title: 'RMSNorm', text: RMSNORM_TEXT + ' On JetMoE this normalized copy is doing double duty: it is both what the attention experts read and the exact vector the attention (MoA) router scores its 8 experts against.' },
  { title: 'Attention (MoA)', text: 'JetMoE makes attention sparse too. Instead of one attention block, there are 8 "attention experts"; a router scores them per token and keeps the top 2. Click this block and open step 2, "Expert routing", to see that decision for every token. Each selected expert has its own Q and output projections but shares the same K and V, then runs the usual Q·Kᵀ → softmax → ×V, and the 2 selected experts’ outputs are combined by their router weights. Each expert brings 16 query heads of 128 dims, and both read the same 16 shared key/value heads: 32 query heads over 16 K/V heads, which is grouped-query attention (2 query heads per K/V head).' },
  { title: 'Residual (post-attention)', text: RESIDUAL_ADD_TEXT },
  { title: 'RMSNorm (pre-MoE)', text: preMoeNormText('feed-forward block') },
  { title: 'MoE Layer', text: 'This layer has 8 independent "expert" feed-forward networks, but only 2 of them run for any given token. A small router scores this token’s normalized hidden state against all 8 experts, softmaxes those into a probability distribution, and selects the top 2; the other 6 are skipped entirely. Each selected expert is a full SwiGLU feed-forward block, and the layer’s output is a weighted sum of the 2 experts’ outputs using the router’s own probabilities as the weights.' },
  { title: 'Residual', text: 'The feed-forward block’s output is added back onto the residual stream, producing this layer’s final output, which becomes the next layer’s input.' },
  { title: 'Final RMSNorm', text: finalNormText(24) },
  { title: 'Final Output', text: 'The normalized final state is projected through the vocabulary-sized LM head, and a softmax over those logits gives the model’s real next-token probabilities.' },
];
