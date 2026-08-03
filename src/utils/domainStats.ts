import type { DomainSpecializationData } from '../data/types';

export interface SampleToken {
  token: string;
}

/**
 * The first layer that actually routes between experts — 0 for OLMoE and JetMoE, 1 for DeepSeek,
 * whose layer 0 is a plain dense FFN with all-zero expert rows.
 *
 * Valid as a floor (rather than a set to skip) because dense layers are always a prefix: DeepSeek
 * is configured `first_k_dense_replace=1`. Every view that indexes by layer clamps to this, so a
 * reader can't land on a layer where `topKExperts` would rank 64 zeros and ring the first k as
 * "most-used".
 */
export function firstMoeLayer(data: DomainSpecializationData): number {
  const dense = data.dense_layers;
  return dense && dense.length > 0 ? Math.max(...dense) + 1 : 0;
}

/** Indices of the `k` highest values in `rates`, descending. */
export function topKExperts(rates: number[], k = 8): number[] {
  return rates
    .map((rate, expert) => ({ rate, expert }))
    .sort((a, b) => b.rate - a.rate)
    .slice(0, k)
    .map((e) => e.expert);
}

/**
 * The tokens that most strongly routed to (layer, expert) for a category — reads
 * expert_token_idx (indexed by token_idx into domain_tokens, NOT pre-sorted by score despite the
 * data's field name) and sorts by routing score descending.
 *
 * Unaffected by the notebook's per-cell cap: what ships is the 40 highest-scoring pairs, so the
 * top 3 by score are the same 3 they would be against the untruncated list.
 */
export function tokensForExpert(
  data: DomainSpecializationData,
  category: string,
  layer: number,
  expert: number,
  k = 3
): SampleToken[] {
  const pairs = data.expert_token_idx[category]?.[layer]?.[expert];
  if (!pairs) return [];
  const tokens = data.domain_tokens[category];

  const sorted = [...pairs].sort((a, b) => b[1] - a[1]);
  const seen = new Set<string>();
  const result: SampleToken[] = [];
  for (const [tokenIdx] of sorted) {
    const token = tokens[tokenIdx];
    const key = token.trim() || token;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({ token });
    if (result.length >= k) break;
  }
  return result;
}
