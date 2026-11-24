import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractFromHtml } from '../core/extract';
import { normalizeInput } from '../core/normalize';
import type { ExtractOptions, ExtractResult } from '../core/types';
import { fetchPage, FetchPageError, type FetchedPage, type PageInfo } from '../services/fetch-page';

export type ExtractorStatus = 'idle' | 'loading' | 'success' | 'error' | 'cancelled';

export interface ExtractorError {
  code: string;
  message: string;
}

interface State {
  status: ExtractorStatus;
  /** The normalised URL being fetched or last fetched. */
  target?: string;
  page?: FetchedPage;
  error?: ExtractorError;
}

export interface UseExtractorOptions {
  endpoint: string;
  options: ExtractOptions;
  onResult?: (result: ExtractResult, page: PageInfo) => void;
  onError?: (error: ExtractorError) => void;
}

/**
 * Fetches a page through the endpoint and extracts its URLs. Extraction re-runs from the fetched HTML
 * when the options change, without fetching again.
 */
export function useExtractor({ endpoint, options, onResult, onError }: UseExtractorOptions) {
  const [state, setState] = useState<State>({ status: 'idle' });
  const controllerRef = useRef<AbortController | null>(null);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onResultRef.current = onResult;
    onErrorRef.current = onError;
  });

  const fail = useCallback((error: ExtractorError, target?: string) => {
    setState({ status: 'error', target, error });
    onErrorRef.current?.(error);
  }, []);

  const run = useCallback(
    async (input: string) => {
      let target: string;
      try {
        target = normalizeInput(input);
      } catch (error) {
        fail({ code: 'invalid_url', message: (error as Error).message });
        return;
      }

      controllerRef.current?.abort();
      const controller = new AbortController();
      controllerRef.current = controller;
      setState({ status: 'loading', target });

      try {
        const page = await fetchPage(target, { endpoint, signal: controller.signal });
        if (controllerRef.current !== controller) return;
        setState({ status: 'success', target, page });
      } catch (error) {
        if (controllerRef.current !== controller) return; // A newer request took over.
        if (error instanceof FetchPageError && error.code === 'cancelled') {
          setState({ status: 'cancelled', target });
          return;
        }
        fail(
          error instanceof FetchPageError
            ? { code: error.code, message: error.message }
            : { code: 'unknown', message: 'Something went wrong. Try again.' },
          target,
        );
      }
    },
    [endpoint, fail],
  );

  const cancel = useCallback(() => controllerRef.current?.abort(), []);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const page = state.page;
  const result = useMemo(
    () => (page ? extractFromHtml(page.html, page.finalUrl, options) : undefined),
    [page, options],
  );

  useEffect(() => {
    if (result && page) onResultRef.current?.(result, page);
  }, [result, page]);

  return { ...state, result, run, cancel };
}
