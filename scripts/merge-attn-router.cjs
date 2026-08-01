#!/usr/bin/env node
/**
 * Merges the MoA attention-router weight matrices into JetMoE trace data that was extracted before
 * the field existed.
 *
 * The router weight is a model parameter, so it is identical for every prompt — which is why the
 * standalone cell in colab/extract_routing_trace_jetmoe.ipynb can emit it in ~30 KB without a single
 * forward pass, instead of re-running the 12-prompt sweep for a ~100 MB re-download. The sweep emits
 * the same numbers inline, so a full re-run needs no merge at all; this script exists only for the
 * cheap path.
 *
 * Writes `attention_routing.router_matrices` (one [attn_num_experts, cols] grid per layer) and
 * `attention_routing.grid`. Idempotent — re-running overwrites with identical values.
 *
 * Usage:
 *   node scripts/merge-attn-router.cjs <attn-router.json> <public/data/JETMoe/jetmoe_routing_trace>
 *   node scripts/merge-attn-router.cjs <attn-router.json> <raw-data/jetmoe_routing_trace.json>
 *
 * The first form patches every prompt-N.json in a split directory (what the app actually fetches);
 * the second patches a monolithic {prompts:[...]} trace file.
 */
const fs = require('fs');
const path = require('path');

// Deliberately duplicated from round-trace-data.cjs rather than imported: the two scripts serve the
// two paths into this field (full re-run → --split rounds it there; cheap dump → this script rounds
// it here) and must agree. roundSig is idempotent at the same sigfigs, so a file that took the full
// path and is later re-merged is unchanged. These weights are read only by gridHTML's colour ramp.
const SIGFIGS = 3;

function roundSig(x, sig) {
  if (typeof x !== 'number' || x === 0 || !isFinite(x)) return x;
  const power = sig - Math.ceil(Math.log10(Math.abs(x)));
  const magnitude = Math.pow(10, power);
  return Math.round(x * magnitude) / magnitude;
}
const roundNested = (x, sig) => (Array.isArray(x) ? x.map((v) => roundNested(v, sig)) : roundSig(x, sig));

function loadSource(file) {
  const src = JSON.parse(fs.readFileSync(file, 'utf8'));
  const m = src.router_matrices;
  if (!Array.isArray(m) || !Array.isArray(m[0]) || !Array.isArray(m[0][0])) {
    throw new Error(`${file}: expected router_matrices as [layer][expert][col]`);
  }
  const rows = m[0].length;
  if (src.attn_num_experts && rows !== src.attn_num_experts) {
    throw new Error(`${file}: ${rows} rows per grid but attn_num_experts=${src.attn_num_experts} — rows must be unbucketed (row e = expert e)`);
  }
  return { matrices: roundNested(m, SIGFIGS), numLayers: m.length, rows, grid: src.grid || [rows, m[0][0].length] };
}

// Returns true if the prompt was changed. Throws when the trace's own shape disagrees with the
// weights being merged — a silent mismatch here would draw a grid whose rows are not its experts.
function patchPrompt(p, src, label) {
  const ar = p.attention_routing;
  if (!ar) throw new Error(`${label}: no attention_routing (is this a JetMoE trace?)`);
  if (ar.layers && ar.layers.length !== src.numLayers) {
    throw new Error(`${label}: trace has ${ar.layers.length} layers, weights have ${src.numLayers}`);
  }
  if (ar.num_experts !== src.rows) {
    throw new Error(`${label}: trace has ${ar.num_experts} attention experts, weight grids have ${src.rows} rows`);
  }
  ar.router_matrices = src.matrices;
  ar.grid = src.grid;
  return true;
}

function main() {
  const [srcFile, target] = process.argv.slice(2);
  if (!srcFile || !target) {
    console.error('Usage: node scripts/merge-attn-router.cjs <attn-router.json> <splitDir | trace.json>');
    process.exit(1);
  }
  const src = loadSource(srcFile);
  console.log(`${srcFile}: ${src.numLayers} layers × ${src.rows} experts × ${src.grid[1]} column buckets`);

  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    const files = fs.readdirSync(target).filter((f) => /^prompt-\d+\.json$/.test(f));
    if (!files.length) throw new Error(`${target}: no prompt-N.json files found`);
    let bytes = 0;
    for (const f of files) {
      const full = path.join(target, f);
      const p = JSON.parse(fs.readFileSync(full, 'utf8'));
      patchPrompt(p, src, f);
      const json = JSON.stringify(p);
      bytes += json.length;
      fs.writeFileSync(full, json);
    }
    console.log(`patched ${files.length} prompt files in ${target} (${(bytes / 1e6).toFixed(2)} MB total)`);
  } else {
    const data = JSON.parse(fs.readFileSync(target, 'utf8'));
    if (!Array.isArray(data.prompts)) throw new Error(`${target}: expected {prompts: [...]}`);
    data.prompts.forEach((p, i) => patchPrompt(p, src, `prompt ${i}`));
    fs.writeFileSync(target, JSON.stringify(data));
    console.log(`patched ${data.prompts.length} prompts in ${target}`);
  }
}

main();
