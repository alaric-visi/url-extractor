import { useDeferredValue, useMemo } from 'react';
import { applyFilters, summarise, type FilterOutcome, type FilterState } from '../core/filter';
import type { ExtractedUrl } from '../core/types';

/**
 * Applies the filters to the extracted URLs. The text boxes go through useDeferredValue, so typing
 * stays responsive on pages with thousands of URLs.
 */
export function useFilteredUrls(urls: ExtractedUrl[] | undefined, filters: FilterState) {
  const text = useDeferredValue(filters.text);
  const exclude = useDeferredValue(filters.exclude);
  const { regex, kinds, scopes, domain, unique, ignoreTrailingSlash, sort } = filters;

  const outcome: FilterOutcome = useMemo(
    () =>
      urls
        ? applyFilters(urls, {
            text,
            exclude,
            regex,
            kinds,
            scopes,
            domain,
            unique,
            ignoreTrailingSlash,
            sort,
          })
        : { items: [] },
    [urls, text, exclude, regex, kinds, scopes, domain, unique, ignoreTrailingSlash, sort],
  );

  const summary = useMemo(
    () => (urls ? summarise(urls, ignoreTrailingSlash) : undefined),
    [urls, ignoreTrailingSlash],
  );

  return {
    ...outcome,
    summary,
    /** True while the list still reflects older filter text. */
    pending: text !== filters.text || exclude !== filters.exclude,
  };
}
