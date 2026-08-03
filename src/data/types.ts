/**
 * Shapes matching each model's `*domain_specialization.json` and `*domain_specialization_umap.json`
 * (see v2/domain/models.ts for the three paths). JSON field names (domain_rate, activation_rate,
 * etc.) are kept as-is — that's just what the notebook calls them — but the taxonomy concept they
 * key by is always called "category" in code, prop names, and UI copy (see rewiring-frontend.md).
 *
 * Nothing here assumes a layer, expert or top-k count: OLMoE is 16 × 64 top-8, JetMoE 24 × 8
 * top-2, DeepSeek 28 × 64 top-6. Components read those off the data.
 */
interface TopSpecialist {
  layer: number;
  expert: number;
  activation_rate: number;
}

export interface DomainSpecializationData {
  domains: string[];
  num_layers: number;
  num_experts: number;
  top_k_experts: number;
  token_counts: Record<string, number>;
  example_prompts: Record<string, string[]>;
  /** [category][layer][expert] — fraction of that category's tokens with this expert in top-k. */
  activation_rate: Record<string, number[][]>;
  /** [category][layer][expert] — mean router softmax prob (selected or not). */
  avg_prob: Record<string, number[][]>;
  /** [category][layer][expert] — log2(rate / mean rate across the six categories) for this same
   *  cell, lightly smoothed. Verified against all three shipped files rather than assumed: the
   *  baseline is the six-category mean, NOT `top_k / num_experts`, so the ceiling is log2(6) ≈
   *  2.585 for every model (a category can at most be 6× a mean it is one of) and the value is
   *  comparable across models. DomainCellModal renders 2^score as "N× the 6-category average". */
  specialization_score: Record<string, number[][]>;
  /** [category][layer] — mean activation_rate of that category's own top-k experts. k is the
   *  model's own (8 / 6 / 2), so this compares categories within a model, never across models. */
  domain_rate: Record<string, number[]>;
  /** [category] — flat decoded token strings for that category's passage. */
  domain_tokens: Record<string, string[]>;
  /** [category][layer][expert] — array of [token_idx, routing_score] pairs, in passage order.
   *  TRUNCATED: with five ~400-token passages per category this field alone would be tens of
   *  megabytes, so the notebook ships only the 40 highest-scoring pairs per cell (re-sorted back
   *  into passage order). Never read `.length` as "how many tokens routed here" — that is
   *  expert_token_count. */
  expert_token_idx: Record<string, [number, number][][][]>;
  /** [category][layer][expert] — the untruncated number of tokens that routed to this cell, i.e.
   *  what expert_token_idx[...].length would have been before the cap. Optional: data files
   *  generated before the five-passage change have no such key, and consumers fall back to the
   *  array length, which was exact for those files. */
  expert_token_count?: Record<string, number[][]>;
  /** [category] — top 12 {layer, expert, activation_rate}, ranked by raw activation_rate. */
  top_specialists: Record<string, TopSpecialist[]>;
  /** DeepSeek only: layer indices that are plain dense FFNs, whose per-expert rows are therefore
   *  all zeros. Trusted as declared rather than derived from all-zero rows — deriving would
   *  silently relabel an extraction bug as "dense, nothing to see here". Absent = none. */
  dense_layers?: number[];
  /** DeepSeek only: how many shared experts the model has (2). They fire on 100% of every
   *  category's tokens, so the notebook excludes them from every array above; this records the
   *  omission. Surfaced only in DomainRateChart's caption. */
  shared_experts?: number;
}

export interface UmapTopToken {
  token: string;
  score: number;
  category: string;
}

export interface UmapPoint {
  layer_id: number;
  expert_id: number;
  x: number;
  y: number;
  dominant_category: string;
  top_tokens: UmapTopToken[];
}

export interface UmapData {
  domains: string[];
  num_layers: number;
  num_experts: number;
  points: UmapPoint[];
}
