import { useState, useEffect } from "react";
import { directus } from "@/lib/directus";
import { readItems } from "@directus/sdk";

interface UseDirectusOptions<T> {
  collection: string;
  params?: Record<string, unknown>;
  enabled?: boolean;
}

interface UseDirectusReturn<T> {
  data: T[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useDirectus<T = Record<string, unknown>>({
  collection,
  params = {},
  enabled = true,
}: UseDirectusOptions<T>): UseDirectusReturn<T> {
  const [data, setData] = useState<T[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [trigger, setTrigger] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (directus.request(readItems(collection, params)) as Promise<T[]>)
      .then((items) => {
        if (!cancelled) setData(items);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || "Failed to fetch data");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [collection, enabled, trigger]);

  const refetch = () => setTrigger((t) => t + 1);

  return { data, isLoading, error, refetch };
}
