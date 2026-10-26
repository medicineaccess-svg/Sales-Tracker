import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { filtersFromParams, filtersToParams, type SalesFilters } from '@/lib/filters';

/** Filter state stored in the URL query string. */
export function useFilters() {
  const [params, setParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(params), [params]);

  const setFilters = useCallback(
    (next: SalesFilters) => setParams(filtersToParams(next, params), { replace: true }),
    [params, setParams],
  );
  const update = useCallback(
    (patch: Partial<SalesFilters>) => {
      const merged = { ...filters, ...patch };
      for (const k of Object.keys(merged) as (keyof SalesFilters)[]) {
        if (merged[k] === '' || merged[k] === undefined) delete merged[k];
      }
      setFilters(merged);
    },
    [filters, setFilters],
  );
  const reset = useCallback(() => setFilters({}), [setFilters]);

  return { filters, setFilters, update, reset };
}

export function useDebounce<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}
