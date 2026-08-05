/**
 * The standalone "Parameter count" panel — model-level facts, the same regardless of which cell
 * you click — as a pure builder.
 *
 * It lived inside `archExplorer.ts` as an IIFE (`renderParamCountPanel`) writing
 * `byId('param-count-panel').innerHTML` at boot, until 2026-08-02. Nothing about it is per-layer or
 * per-token: all three branches read only `DATA.hidden_size`, `intermediate_size`, `num_experts`,
 * `top_k_experts`, `shared_experts`, `num_layers` and `layer_flow.attn_num_experts` /
 * `attn_top_k`, plus arithmetic. That is why React can memoise it on `flow` alone, and why — unlike
 * `flowBlocks.ts` — it needs no `root`: there is not a single `cssVar` / `getComputedStyle` read in
 * here, so it has no theme dependency and nothing to go stale in dark mode.
 *
 * ⚠ Transcribed VERBATIM from the three branches, including the two identically-behaving local
 * formatters, which the original spelled `fmtN` (JetMoE + DeepSeek) and `fmt` (OLMoE). They are
 * kept as two names on purpose: this file's job is to produce byte-identical output, and unifying
 * them is the kind of tidy-up that invites an accidental format change. Their output is compared
 * character-for-character against the old builder on all three models before this is wired up.
 *
 * Two DELIBERATE divergences from that transcription since (2026-08-03), both copy-only:
 *  - JetMoE's footer computes its active-parameter count instead of stating a flat `~2B`;
 *  - OLMoE's "all N layers" line says what it sums (routed FFN experts) so it stops reading as a
 *    second, contradictory model total next to the footer's ~6.9B.
 */
import type { PromptFlow } from './types';

export function buildParamCountPanelHtml(DATA: PromptFlow): string {
  const fmtN = (n: number) => n.toLocaleString('en-US');
  // --- JetMoE: sparse on both sides (routed attention + routed FFN), 8B total / ~2B active ---
  if (DATA.layer_flow.is_moa) {
    const H = DATA.hidden_size, I = DATA.intermediate_size, E = DATA.num_experts, K = DATA.top_k_experts;
    const aE = DATA.layer_flow.attn_num_experts ?? E, aK = DATA.layer_flow.attn_top_k ?? K;
    const perExpert = 3 * H * I;
    const perAttnExpert = 2 * H * H; // each attention expert owns its own W_q + W_o
    const sharedKV = 2 * H * H; // W_k + W_v are shared across all attention experts
    const perLayer = E * perExpert + aE * perAttnExpert + sharedKV;
    const allLayers = DATA.num_layers * perLayer;
    // Active per token: the top-k experts on BOTH sides, plus the shared W_kv (it is not routed, so
    // every token pays for it). Computed rather than hardcoded, exactly like `allLayers` above — the
    // footer used to say a flat `~2B` next to a computed total, which would have drifted the moment
    // any of these scalars changed. Lands at 2.26B, i.e. `2.3B` at one decimal.
    const perLayerActive = K * perExpert + aK * perAttnExpert + sharedKV;
    const allLayersActive = DATA.num_layers * perLayerActive;
    return '<h2 style="font-size:14px;font-weight:650;margin:0 0 10px;">Parameter count</h2>' +
      '<div class="math-eq">params/FFN expert <span class="op">=</span> 3 <span class="op">×</span> (' + H + ' <span class="op">×</span> ' + I + ') <span class="op">=</span> <span class="val">' + fmtN(perExpert) + '</span>\n' +
      'params/attn expert <span class="op">=</span> 2 <span class="op">×</span> (' + H + ' <span class="op">×</span> ' + H + ') <span class="op">=</span> <span class="val">' + fmtN(perAttnExpert) + '</span> <span class="op">(its own W_q + W_o)</span>\n' +
      'params/layer  <span class="op">=</span> ' + E + ' <span class="op">×</span> ' + fmtN(perExpert) + ' <span class="op">+</span> ' + aE + ' <span class="op">×</span> ' + fmtN(perAttnExpert) + ' <span class="op">+</span> shared W_kv <span class="op">=</span> <span class="val">' + fmtN(perLayer) + '</span>\n' +
      'all ' + DATA.num_layers + ' layers  <span class="op">=</span> <span class="val">≈ ' + (allLayers / 1e9).toFixed(2) + 'B params</span>, but only ' + aK + '/' + aE + ' attention experts and ' + K + '/' + E + ' FFN experts run per token</div>' +
      '<footer class="note">JetMoE is sparse on <b>both</b> sides: only ' + aK + ' of ' + aE + ' attention experts and ' + K + ' of ' + E + ' feed-forward experts are actually multiplied for any given token, the rest sit idle in memory. That two-way sparsity is why JetMoE-8B has ~' + (allLayers / 1e9).toFixed(1) + 'B total parameters but only ~' + (allLayersActive / 1e9).toFixed(1) + 'B "active" per token.</footer>';
  }
  // --- DeepSeek: 64 routed (top-6) + 2 always-on shared + a dense layer 1, 16.4B / ~2.8B active ---
  if (DATA.shared_experts) {
    const H = DATA.hidden_size, I = DATA.intermediate_size, E = DATA.num_experts, K = DATA.top_k_experts;
    const S = DATA.shared_experts;
    const perExpert = 3 * H * I;
    const perLayer = (E + S) * perExpert;
    return '<h2 style="font-size:14px;font-weight:650;margin:0 0 10px;">Parameter count</h2>' +
      '<div class="math-eq">params/routed expert <span class="op">=</span> 3 <span class="op">×</span> (' + H + ' <span class="op">×</span> ' + I + ') <span class="op">=</span> <span class="val">' + fmtN(perExpert) + '</span>\n' +
      'params/MoE layer  <span class="op">=</span> (' + E + ' routed + ' + S + ' shared) <span class="op">×</span> ' + fmtN(perExpert) + ' <span class="op">=</span> <span class="val">' + fmtN(perLayer) + '</span>\n' +
      'all ' + DATA.num_layers + ' layers (' + (DATA.num_layers - 1) + ' MoE + 1 dense)  <span class="op">=</span> <span class="val">≈ 16.4B params</span>, but only ' + K + ' routed + ' + S + ' shared experts run per token</div>' +
      // Trimmed to hold ONE wrapped line at the panel's width (2026-08-04, by request). The dense
      // layer 1 sentence went with it — the equation line above already says `(27 MoE + 1 dense)`.
      '<footer class="note">Only ' + (K + S) + ' of ' + (E + S) + ' experts run per token (top-' + K + ' routed + ' + S + ' shared), so DeepSeek-MoE-16B is ~16.4B params but only ~2.8B "active".</footer>';
  }
  const H0 = DATA.hidden_size, I0 = DATA.intermediate_size, E0 = DATA.num_experts, K0 = DATA.top_k_experts;
  const perExpert = 3 * H0 * I0;
  const perLayer = E0 * perExpert;
  const allLayers = DATA.num_layers * perLayer;
  const fmt = (n: number) => n.toLocaleString('en-US');
  return '<h2 style="font-size:14px;font-weight:650;margin:0 0 10px;">Parameter count</h2>' +
    '<div class="math-eq">params/expert <span class="op">=</span> 3 <span class="op">×</span> (' + H0 + ' <span class="op">×</span> ' + I0 + ') <span class="op">=</span> <span class="val">' + fmt(perExpert) + '</span>\n' +
    'params/layer  <span class="op">=</span> ' + E0 + ' experts <span class="op">×</span> ' + fmt(perExpert) + ' <span class="op">=</span> <span class="val">' + fmt(perLayer) + '</span>\n' +
    // The sum is over routed FFN experts ONLY, so it must not be read as the model total: it lands
    // at 6.44B while the footer (correctly) says ~6.9B, and an unqualified "all 16 layers = 6.44B"
    // read as two different totals for the same model. Attention + embedding params are not in DATA,
    // so the honest fix is to label what this number actually counts rather than to compute 6.9B.
    // The "excludes attention + embedding parameters" second line was dropped 2026-08-04, by
    // request — `of routed FFN experts` on this line already says what is being summed, and the
    // note restated it. `.math-eq` is `white-space: pre; overflow-x: auto`, so this must stay one
    // line: at 715px intrinsic it is the widest line here and keeps the scroll onset near 849px.
    'all ' + DATA.num_layers + ' layers of routed FFN experts  <span class="op">=</span> <span class="val">≈ ' + (allLayers / 1e9).toFixed(2) + 'B params</span>, but only ' + K0 + '/' + E0 + ' experts run per token per layer</div>' +
    '<footer class="note">Only ' + K0 + ' of ' + E0 + ' experts\' weights are actually multiplied for any given token while the rest sit idle in memory. That sparsity is why OLMoE has ~6.9B total parameters but only ~1.3B "active" per token.</footer>';
}
