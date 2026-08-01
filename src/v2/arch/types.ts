/**
 * Shape of one entry in a model's routing-trace data: OLMoE's whole-file
 * public/data/OLMoE/moe_routing_trace.json, or one prompt-{i}.json from JetMoE's and DeepSeek's
 * split directories (see v2/arch/models.ts for the three paths). Extracted 1:1 from the
 * prototype's embedded ALL_PROMPTS blob, so the real-data pipeline output drops in unchanged.
 * Inner tensors are typed loosely; archExplorer.ts consumes them exactly as the prototype did.
 */
interface PromptFlowLayerToken {
  top_experts: number[];
  top_weights: number[];
  all_probs: number[];
}

/**
 * One entry in a per-layer list. OLMoE/DeepSeek-MoE layers carry `tokens`; DeepSeek's dense layer 1
 * ships `tokens: null` and `is_dense: true` instead. Consumers branch on `tokens` being absent
 * (`!layer.tokens` in archExplorer.ts), never on the flag, so the OLMoE code path — which never
 * sees a dense layer — keeps treating `tokens` as non-null. `is_dense` stays as the data's own
 * declarative marker of what that layer is.
 */
interface PromptFlowLayer {
  layer: number;
  tokens: PromptFlowLayerToken[];
  /** DeepSeek only: this is the dense FFN layer (layer 1) — no router, no experts. */
  is_dense?: boolean;
  /** DeepSeek only: the 2 always-on shared experts run on this (MoE) layer. */
  shared_experts_active?: boolean;
}

export interface PromptFlow {
  prompt: string;
  /** Category this prompt belongs to (see src/data/categories.ts) — groups the prompt <select>. */
  domain: string;
  num_layers: number;
  num_experts: number;
  top_k_experts: number;
  hidden_size: number;
  intermediate_size: number;
  tokens: { index: number; text: string }[];
  layers: PromptFlowLayer[];
  next_token_candidates: { token: string; prob: number }[];
  /** Real downsampled tensors for the math modals, keyed as the prototype keyed them. */
  router_matrices: number[][][];
  hidden_vectors: number[][][];
  expert_weights: Record<string, { gate: number[][]; up: number[][]; down: number[][] }>;
  expert_outputs: Record<string, number[]>;

  // ---- Architecture extras (all optional — OLMoE omits every one of these) ----
  /** JetMoE only: the parallel attention router (MoA) — 8 attention experts, top-2 per token,
   *  same token-level shape as `layers` but scoring attention experts instead of FFN experts. */
  attention_routing?: {
    num_experts: number;
    top_k: number;
    layers: { layer: number; tokens: PromptFlowLayerToken[] }[];
    /** The MoA router's own weight matrix, one downsampled grid per layer, `[layer][expert][col]`.
     *  Optional: trace files extracted before 2026-07-31 lack it and fall back to an arrow in the
     *  Attention modal's routing step. Rows are NOT bucketed — row e is expert e, so the grid lines
     *  up with the probability strip beside it. Do not substitute the top-level `router_matrices`
     *  here: those are the FFN router's weights. */
    router_matrices?: number[][][];
    /** `[rows, cols]` of each `router_matrices` grid; rows === num_experts. */
    grid?: number[];
  };
  /** DeepSeek only: number of always-on shared experts (2). */
  shared_experts?: number;
  /** DeepSeek only: indices of dense (non-MoE) layers — [0] for layer 1. */
  dense_layer_indices?: number[];
  /** DeepSeek only: the 2 shared experts merged into one SwiGLU feed-forward, keyed by layer
   *  ("1".."27"). `intermediate_size` is the merged width (2 × the routed intermediate_size). */
  shared_expert_weights?: Record<string, { gate: number[][]; up: number[][]; down: number[][]; intermediate_size?: number }>;
  /** DeepSeek only: merged shared-expert output vector per "{token}_{layer}". */
  shared_expert_outputs?: Record<string, number[]>;
  /** DeepSeek only: the dense-layer FFN, keyed by layer ("0") → { gate, up, down, intermediate_size
   *  (10944), outputs: { "{token}": vec } }. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dense_ffn?: any;

  layer_flow: {
    /** Model-wide query-head count. MHA models (OLMoE/DeepSeek): the head count, full stop.
     *  JetMoE: 32 = `attn_top_k` (2) selected attention experts × `num_query_heads_per_expert`
     *  (16), all reading the same 16 shared K/V heads. Never index per-head tensors with this —
     *  use `num_query_heads_per_expert` (per-expert Q tensors) or `num_kv_heads` (shared K/V). */
    num_attention_heads: number;
    head_dim: number;
    embed_strip: number[][];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    per_layer: any[];

    // ---- JetMoE MoA extras (optional) ----
    /** True when attention is a routed block (JetMoE). */
    is_moa?: boolean;
    attn_num_experts?: number;
    attn_top_k?: number;
    has_qk_norm?: boolean;
    /** JetMoE only: attention is grouped-query — 32 query heads over 16 shared K/V heads. Absent
     *  on traces extracted before these fields existed (they carried num_attention_heads = 16,
     *  the per-expert count), so every read falls back to `num_attention_heads`. */
    is_gqa?: boolean;
    /** Same value as `num_attention_heads` (32), named for what it is. */
    num_query_heads?: number;
    /** 16 — the length of every per-expert `q_by_head` / `head_output_by_head` /
     *  `attn_probs_all_heads` array in `attn_expert_flow`. */
    num_query_heads_per_expert?: number;
    /** 16 — the length of the shared `per_layer[i].k_by_head` / `v_by_head` arrays. */
    num_kv_heads?: number;
    /** Per-attention-expert projection weights, keyed "{layer}_{expert}" → { q, o }.
     *  W_k / W_v are shared and live in `per_layer[i].k_weight` / `v_weight`. */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attn_expert_weights?: Record<string, any>;
    /** Per-attention-expert per-head tensors for the MoA math modal, keyed "{layer}_{expert}". */
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    attn_expert_flow?: Record<string, any>;
  };
}

export interface ArchPromptsFile {
  prompts: PromptFlow[];
}
