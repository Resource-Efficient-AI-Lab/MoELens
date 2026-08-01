#!/usr/bin/env node
/**
 * Post-process pass for public/data/{JETMoe,DeepSeek}/*_routing_trace.json.
 *
 * Rounds every tensor field whose ONLY consumer in src/v2/arch/archExplorer.ts is a color-heatmap
 * renderer (gridHTML / stripHTML — cell fill = sqrt(|v|/max)) to N significant figures. Fields
 * rendered as literal text (all_probs, top_weights, next_token_candidates[].prob) are left at full
 * precision — rounding those would corrupt the router percentages the product teaches.
 *
 * q_raw/k_raw/v_raw used to be DELETED here ("verified unread anywhere in src/") — true only
 * because archExplorer's `showRaw` branch could never fire on these two models. As of 2026-07-31
 * the pre-split grid is shown on all three models, so they are rounded like every other grid
 * tensor instead. Cost measured on DeepSeek: ~130KB on a 2.98MB prompt file (~4%).
 *
 * Uses significant figures, not fixed decimal places: several of these tensors (expert_weights
 * gate/up/down) are ~1e-5 in magnitude, so a fixed-decimal round (e.g. toFixed(3)) would collapse
 * an entire weight grid to zero and erase all its color variation. Sig-fig rounding scales with
 * each number's own magnitude instead.
 *
 * Usage:
 *   node scripts/round-trace-data.js --measure <file.json>        # report savings, don't write
 *   node scripts/round-trace-data.js <in.json> <out.json> [sigfigs=3]
 */
const fs = require('fs');

const SIGFIGS_DEFAULT = 3;

function roundSig(x, sig) {
  if (typeof x !== 'number' || x === 0 || !isFinite(x)) return x;
  const d = Math.ceil(Math.log10(Math.abs(x)));
  const power = sig - d;
  const magnitude = Math.pow(10, power);
  return Math.round(x * magnitude) / magnitude;
}

// Recursively rounds every numeric leaf in an arbitrarily-nested array of numbers.
function roundNested(x, sig) {
  if (Array.isArray(x)) return x.map((v) => roundNested(v, sig));
  return roundSig(x, sig);
}

function roundIfPresent(obj, key, sig) {
  if (obj && obj[key] !== undefined && obj[key] !== null) obj[key] = roundNested(obj[key], sig);
}

// Fields on layer_flow.per_layer[i] that are ONLY ever read through gridHTML/stripHTML in
// archExplorer.ts (color math) — safe to round. q_raw/k_raw/v_raw are the attention math modal's
// step-1 "Q raw / K raw / V raw" blocks (JetMoE ships k_raw/v_raw here; its q_raw is per attention
// expert, rounded in the attn_expert_flow block below).
const PER_LAYER_ROUND_FIELDS = [
  'ln1_weight', 'ln1_out', 'q_weight', 'k_weight', 'v_weight', 'o_weight',
  'q_raw', 'k_raw', 'v_raw',
  'k_by_head', 'v_by_head', 'k_by_head_prerope', 'q_by_head', 'q_by_head_prerope',
  'attn_output', 'attn_probs_all_heads', 'head_output_by_head', 'after_attn_residual',
  'ln2_weight', 'ln2_out', 'moe_output', 'layer_output',
];

function processPrompt(p, sig) {
  // ---- top-level tensors (color-only consumers) ----
  roundIfPresent(p, 'router_matrices', sig);
  // JetMoE MoA router weights (attention_routing.layers[] holds the percentages and is left alone).
  if (p.attention_routing) roundIfPresent(p.attention_routing, 'router_matrices', sig);
  roundIfPresent(p, 'hidden_vectors', sig);
  if (p.expert_weights) {
    for (const k of Object.keys(p.expert_weights)) {
      const ew = p.expert_weights[k];
      roundIfPresent(ew, 'gate', sig);
      roundIfPresent(ew, 'up', sig);
      roundIfPresent(ew, 'down', sig);
    }
  }
  if (p.expert_outputs) {
    for (const k of Object.keys(p.expert_outputs)) p.expert_outputs[k] = roundNested(p.expert_outputs[k], sig);
  }
  // DeepSeek shared experts + dense FFN
  if (p.shared_expert_weights) {
    for (const k of Object.keys(p.shared_expert_weights)) {
      const sw = p.shared_expert_weights[k];
      roundIfPresent(sw, 'gate', sig);
      roundIfPresent(sw, 'up', sig);
      roundIfPresent(sw, 'down', sig);
    }
  }
  if (p.shared_expert_outputs) {
    for (const k of Object.keys(p.shared_expert_outputs)) p.shared_expert_outputs[k] = roundNested(p.shared_expert_outputs[k], sig);
  }
  if (p.dense_ffn) {
    for (const k of Object.keys(p.dense_ffn)) {
      const d = p.dense_ffn[k];
      roundIfPresent(d, 'gate', sig);
      roundIfPresent(d, 'up', sig);
      roundIfPresent(d, 'down', sig);
      if (d.outputs) {
        for (const tk of Object.keys(d.outputs)) d.outputs[tk] = roundNested(d.outputs[tk], sig);
      }
    }
  }

  // ---- layer_flow ----
  const lf = p.layer_flow;
  if (lf) {
    roundIfPresent(lf, 'embed_strip', sig);
    if (lf.per_layer) {
      for (const pl of lf.per_layer) {
        for (const f of PER_LAYER_ROUND_FIELDS) roundIfPresent(pl, f, sig);
      }
    }
    // JetMoE MoA extras
    if (lf.attn_expert_weights) {
      for (const k of Object.keys(lf.attn_expert_weights)) {
        const aew = lf.attn_expert_weights[k];
        roundIfPresent(aew, 'q', sig);
        roundIfPresent(aew, 'o', sig);
      }
    }
    if (lf.attn_expert_flow) {
      for (const k of Object.keys(lf.attn_expert_flow)) {
        const aef = lf.attn_expert_flow[k];
        roundIfPresent(aef, 'attn_probs_all_heads', sig);
        // JetMoE's Q is per attention expert (its W_q is), so its pre-split Q raw lives here, not
        // on per_layer next to the shared k_raw/v_raw.
        roundIfPresent(aef, 'q_raw', sig);
        roundIfPresent(aef, 'q_by_head', sig);
        roundIfPresent(aef, 'q_by_head_prerope', sig);
        roundIfPresent(aef, 'head_output_by_head', sig);
      }
    }
  }

  // NOTE: deliberately untouched — displayed as literal text/percentages in the UI:
  //   p.layers[].tokens[].{all_probs,top_weights,top_experts}
  //   p.attention_routing.layers[].tokens[].{all_probs,top_weights,top_experts}
  //   p.next_token_candidates[].prob
  return p;
}

function main() {
  const args = process.argv.slice(2);
  if (args[0] === '--measure') {
    const file = args[1];
    const sig = Number(args[2]) || SIGFIGS_DEFAULT;
    const before = fs.readFileSync(file, 'utf8');
    const beforeLen = before.length;
    const data = JSON.parse(before);
    data.prompts = data.prompts.map((p) => processPrompt(p, sig));
    const after = JSON.stringify(data);
    console.log(file);
    console.log('  sigfigs:', sig);
    console.log('  before:', (beforeLen / 1e6).toFixed(2), 'MB');
    console.log('  after: ', (after.length / 1e6).toFixed(2), 'MB');
    console.log('  reduction:', (100 * (1 - after.length / beforeLen)).toFixed(1) + '%');
    return;
  }

  // --split: rounds + writes a manifest.json (prompt text + domain, for the dropdown) plus one
  // prompt-{i}.json per prompt (full tensors) into outDir — the eager/lazy split described in
  // docs/notes/last-conversation-handoff.md. Only the currently-selected prompt's file is fetched
  // at runtime (see usePromptFlow.ts), instead of all 12 prompts' tensors up front.
  if (args[0] === '--split') {
    const inFile = args[1];
    const outDir = args[2];
    const sig = Number(args[3]) || SIGFIGS_DEFAULT;
    const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
    fs.mkdirSync(outDir, { recursive: true });
    const manifest = { prompts: data.prompts.map((p) => ({ prompt: p.prompt, domain: p.domain })) };
    fs.writeFileSync(`${outDir}/manifest.json`, JSON.stringify(manifest));
    let totalPromptBytes = 0;
    data.prompts.forEach((p, i) => {
      const rounded = processPrompt(p, sig);
      const json = JSON.stringify(rounded);
      totalPromptBytes += json.length;
      fs.writeFileSync(`${outDir}/prompt-${i}.json`, json);
    });
    console.log('wrote', outDir);
    console.log('  manifest.json:', (fs.statSync(`${outDir}/manifest.json`).size / 1e3).toFixed(1), 'KB');
    console.log('  prompt files:', data.prompts.length, '— avg', (totalPromptBytes / data.prompts.length / 1e6).toFixed(2), 'MB, total', (totalPromptBytes / 1e6).toFixed(2), 'MB');
    return;
  }

  const [inFile, outFile, sigArg] = args;
  if (!inFile || !outFile) {
    console.error('Usage: node scripts/round-trace-data.cjs <in.json> <out.json> [sigfigs=3]');
    console.error('   or: node scripts/round-trace-data.cjs --measure <file.json> [sigfigs=3]');
    console.error('   or: node scripts/round-trace-data.cjs --split <in.json> <outDir> [sigfigs=3]');
    process.exit(1);
  }
  const sig = Number(sigArg) || SIGFIGS_DEFAULT;
  const data = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  data.prompts = data.prompts.map((p) => processPrompt(p, sig));
  fs.writeFileSync(outFile, JSON.stringify(data));
  console.log('wrote', outFile);
}

main();
