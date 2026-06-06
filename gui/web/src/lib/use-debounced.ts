import { useEffect, useState } from "react";

/**
 * Returns a debounced copy of `value` that only updates after `ms`
 * milliseconds have elapsed since the last change. Cancels the pending
 * update if the component unmounts or if `value` changes again before
 * the delay elapses.
 *
 * Extracted from JobSearchBar's inline implementation so CatalogRegisterForm
 * and any future consumers can share the same hook rather than reinlining it.
 */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
