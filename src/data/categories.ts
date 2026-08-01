/**
 * Human-readable names for the six pre-computed input categories. Keyed by the `domain` field
 * in moe_routing_trace.json / domain_specialization.json — imported by the Architecture tab's
 * prompt optgroups and every Domain Specialization sub-tab.
 */
export const CATEGORY_LABELS: Record<string, string> = {
  code: 'Code',
  math: 'Math',
  biomedical: 'Biomedical',
  legal: 'Legal',
  creative_writing: 'Creative writing',
  conversational: 'Conversational',
};

/** The six real categories, in the data's own order. */
export const CATEGORIES = [
  'code',
  'math',
  'biomedical',
  'legal',
  'creative_writing',
  'conversational',
];
