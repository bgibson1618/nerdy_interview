import { useEffect, useRef, useState } from 'react';
import { config } from '../config';

export interface PollingState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  /** Manually re-run the fetch (used by ErrorState retry, PRD R9). */
  refetch: () => void;
}

/**
 * Runs `fetcher` on mount and then every config.pollIntervalMs (30000 ms)
 * (PRD R4).
 */
export function usePolling<T>(fetcher: () => Promise<T>, deps: unknown[]): PollingState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const run = () => {
    setLoading(true);
    fetcherRef
      .current()
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((e: Error) => setError(e))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    run();
    const id = setInterval(run, config.pollIntervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, refetch: run };
}

