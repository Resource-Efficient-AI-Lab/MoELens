/**
 * The three MoE models the Architecture tab can display. Each maps to one rich routing-trace file
 * under public/data/ (all sharing the OLMoE schema + optional per-architecture extras — see
 * types.ts). OLMoE is first and the default; the dropdown in ArchitectureTab renders this list.
 */
interface ArchModel {
  /** Stable key used for state + the model <select> value. */
  key: ArchModelKey;
  /** Short label shown in the dropdown. */
  label: string;
  /** Whole-file models (OLMoE): path under `${BASE_URL}data/` to the single rich routing-trace
   *  JSON — small enough to fetch entirely up front. */
  dataPath?: string;
  /** Split models (JetMoE/DeepSeek): directory under `${BASE_URL}data/` containing a tiny
   *  `manifest.json` (prompt text + domain, for the dropdown) plus one `prompt-{i}.json` per
   *  prompt (full tensors). Their rich data is 30-85MB across all 12 prompts — too slow to fetch
   *  eagerly and, for JetMoE, over GitHub's 100MB file limit — so only the selected prompt's file
   *  is fetched (see usePromptFlow.ts and scripts/round-trace-data.cjs --split). */
  splitDir?: string;
}

export type ArchModelKey = 'olmoe' | 'jetmoe' | 'deepseek';

export const ARCH_MODELS: ArchModel[] = [
  { key: 'olmoe', label: 'OLMoE-1B-7B', dataPath: 'OLMoE/moe_routing_trace.json' },
  { key: 'jetmoe', label: 'JetMoE-8B', splitDir: 'JETMoe/jetmoe_routing_trace' },
  { key: 'deepseek', label: 'DeepSeek-MoE-16B', splitDir: 'DeepSeek/deepseek_routing_trace' },
];

export const DEFAULT_MODEL_KEY: ArchModelKey = 'olmoe';

export function archModel(key: ArchModelKey): ArchModel {
  return ARCH_MODELS.find((m) => m.key === key) ?? ARCH_MODELS[0];
}
