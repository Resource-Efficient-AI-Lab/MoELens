/**
 * The three MoE models the Domain Specialization tab can display — the same three as the Model
 * Architecture tab (labels come from arch/models.ts so they never drift), but keyed to the
 * domain-side data files instead of the routing traces.
 *
 * All three now ship both files, so every model gets all five sub-tabs. Both files come from the
 * same pre-computation: 30 long passages, five per category, run through
 * `colab/extract_domain_specialization{,_jetmoe,_deepseek}.ipynb` and concatenated into one token
 * stream per category. The corpus is byte-identical across the three notebooks, so the passages a
 * reader sees under "Prompts" are the same whichever model is selected.
 *
 * Deliberately NOT used here: each model's `<model>_routing_trace_umap.json`, which projects the
 * same per-(layer, expert) profiles but measured over the 12 short architecture prompts (~20
 * tokens per category rather than ~400). JetMoE and DeepSeek's Experts UMAP used to read those,
 * back when they had no passage run — which left one sub-tab describing a different experiment
 * from the ones beside it. Now every view in this tab reports one measurement.
 *
 * Two per-model asymmetries the components read out of the data rather than hard-coding:
 * DeepSeek's layer 0 is a dense FFN (`dense_layers: [0]`, all-zero expert rows — see
 * `firstMoeLayer` in utils/domainStats.ts), and `domain_rate` averages each model's own top-k
 * (8 / 6 / 2), so it compares categories within a model, not models against each other.
 */
import { archModel, type ArchModelKey } from '../arch/models';

export type DomainModelKey = ArchModelKey;

interface DomainModel {
  key: DomainModelKey;
  label: string;
  /** Path under `${BASE_URL}data/` to the aggregate per-category statistics. */
  specPath: string;
  /** Path under `${BASE_URL}data/` to the Experts UMAP sub-tab's projection of the same run. */
  umapPath: string;
}

export const DOMAIN_MODELS: DomainModel[] = [
  {
    key: 'olmoe',
    label: archModel('olmoe').label,
    specPath: 'OLMoE/domain_specialization.json',
    umapPath: 'OLMoE/domain_specialization_umap.json',
  },
  {
    key: 'jetmoe',
    label: archModel('jetmoe').label,
    specPath: 'JETMoe/jetmoe_domain_specialization.json',
    umapPath: 'JETMoe/jetmoe_domain_specialization_umap.json',
  },
  {
    key: 'deepseek',
    label: archModel('deepseek').label,
    specPath: 'DeepSeek/deepseek_domain_specialization.json',
    umapPath: 'DeepSeek/deepseek_domain_specialization_umap.json',
  },
];

export const DEFAULT_DOMAIN_MODEL_KEY: DomainModelKey = 'olmoe';

export function domainModel(key: DomainModelKey): DomainModel {
  return DOMAIN_MODELS.find((m) => m.key === key) ?? DOMAIN_MODELS[0];
}
