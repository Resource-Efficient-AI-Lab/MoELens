import { useEffect, useMemo, useState } from 'react';
import type { ArchPromptsFile, PromptFlow } from './types';
import { archModel, type ArchModelKey } from './models';

export interface PromptManifestEntry {
  prompt: string;
  domain: string;
}

interface UsePromptFlowResult {
  /** Prompt text + domain for all 12 prompts — populates the dropdown. Resolves fast (a single
   *  small manifest fetch for split models; a side-effect of the one-shot whole-file fetch for
   *  OLMoE) without waiting on any prompt's full tensors. */
  manifest: PromptManifestEntry[] | null;
  /** The currently-selected prompt's full tensor data, or null while it's still loading. */
  flow: PromptFlow | null;
  loading: boolean;
  error: Error | null;
}

/**
 * Loads one model's Model-Architecture explorer data for the given prompt index.
 *
 * OLMoE ships as a single file (small enough to fetch whole, as before — no behavior change).
 * JetMoE/DeepSeek ship split (`ArchModel.splitDir`): a tiny `manifest.json` for the dropdown, plus
 * one `prompt-{i}.json` per prompt, so switching models/prompts only ever fetches the one prompt
 * actually being viewed instead of all twelve's tensors up front (their rich data is 30-85MB
 * total — see docs/notes/last-conversation-handoff.md for why).
 */
export function usePromptFlow(modelKey: ArchModelKey, promptIndex: number): UsePromptFlowResult {
  const model = archModel(modelKey);
  const base = `${import.meta.env.BASE_URL}data/`;

  const [wholeFile, setWholeFile] = useState<ArchPromptsFile | null>(null);
  const [splitManifest, setSplitManifest] = useState<PromptManifestEntry[] | null>(null);
  const [splitFlow, setSplitFlow] = useState<PromptFlow | null>(null);
  const [manifestLoading, setManifestLoading] = useState(true);
  const [promptLoading, setPromptLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  // ---- manifest (dropdown contents) — refetched only when the model changes ----
  useEffect(() => {
    let cancelled = false;
    setError(null);
    setManifestLoading(true);
    setWholeFile(null);
    setSplitManifest(null);

    const url = model.dataPath ? base + model.dataPath : `${base}${model.splitDir}/manifest.json`;
    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch prompt manifest: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (cancelled) return;
        if (model.dataPath) setWholeFile(json as ArchPromptsFile);
        else setSplitManifest((json as { prompts: PromptManifestEntry[] }).prompts);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setManifestLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey]);

  // Reset the active prompt's data on a MODEL change only — a full context switch, matching
  // OLMoE's existing behavior of blanking while the new model's data loads (wholeFile above does
  // the same). Deliberately separate from the promptIndex-keyed effect below, so a same-model
  // prompt switch does NOT clear this — see that effect's comment.
  useEffect(() => {
    setSplitFlow(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey]);

  // ---- active prompt's full tensor data — split models only; whole-file models already have
  // everything from the manifest fetch above, so this is a no-op for OLMoE. ----
  useEffect(() => {
    if (model.dataPath) {
      setPromptLoading(false);
      return;
    }
    let cancelled = false;
    setPromptLoading(true);
    setError(null);
    // Deliberately NOT clearing splitFlow here: on a same-model prompt switch, keep showing the
    // previous prompt's view (stale-while-revalidate) until the new one arrives, instead of
    // blanking the whole panel — that blank flash was the "blinking" reported for JetMoE/DeepSeek
    // (OLMoE never blanks on a prompt switch since it has no per-prompt fetch to wait on).

    fetch(`${base}${model.splitDir}/prompt-${promptIndex}.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to fetch prompt data: ${res.status}`);
        return res.json() as Promise<PromptFlow>;
      })
      .then((json) => {
        if (!cancelled) setSplitFlow(json);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setPromptLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelKey, promptIndex]);

  const manifest = useMemo(() => {
    if (model.dataPath) return wholeFile ? wholeFile.prompts.map((p) => ({ prompt: p.prompt, domain: p.domain })) : null;
    return splitManifest;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.dataPath, wholeFile, splitManifest]);

  const flow = useMemo(() => {
    if (model.dataPath) return wholeFile ? (wholeFile.prompts[promptIndex] ?? null) : null;
    return splitFlow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.dataPath, wholeFile, promptIndex, splitFlow]);

  return { manifest, flow, loading: manifestLoading || promptLoading, error };
}
