import { useEffect, useState } from 'react';
import type { DomainSpecializationData } from './types';
import { domainModel, type DomainModelKey } from '../v2/domain/models';

interface UseDomainSpecializationResult {
  data: DomainSpecializationData | null;
  loading: boolean;
  error: Error | null;
}

/** What the last completed fetch produced, tagged with the path it came from. Tagging (rather
 *  than clearing state in the effect) is what keeps a model switch from rendering one frame of
 *  the previous model's numbers — or, worse, one frame of "failed to load" — before the effect
 *  runs, since effects only fire after paint. */
interface Loaded {
  path?: string;
  data: DomainSpecializationData | null;
  error: Error | null;
}

export function useDomainSpecialization(modelKey: DomainModelKey): UseDomainSpecializationResult {
  const specPath = domainModel(modelKey).specPath;
  const [loaded, setLoaded] = useState<Loaded>({ data: null, error: null });

  useEffect(() => {
    let cancelled = false;

    fetch(`${import.meta.env.BASE_URL}data/${specPath}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch domain specialization data: ${res.status}`);
        }
        return res.json() as Promise<DomainSpecializationData>;
      })
      .then((json) => {
        if (!cancelled) setLoaded({ path: specPath, data: json, error: null });
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLoaded({
            path: specPath,
            data: null,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [specPath]);

  const fresh = loaded.path === specPath;
  const data = fresh ? loaded.data : null;
  const error = fresh ? loaded.error : null;

  return { data, loading: !data && !error, error };
}
