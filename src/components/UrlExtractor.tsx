import { useCallback, useEffect, useState } from 'react';
import { hostOf } from '../core/classify';
import { exportFilename, EXPORT_FORMATS, formatUrls, type ExportFormat } from '../core/export';
import { DEFAULT_FILTERS, type FilterState, type SortKey } from '../core/filter';
import {
  DEFAULT_EXTRACT_OPTIONS,
  type ExtractedUrl,
  type ExtractOptions,
  type ExtractResult,
} from '../core/types';
import { useExtractor, type ExtractorError } from '../hooks/useExtractor';
import { useFilteredUrls } from '../hooks/useFilteredUrls';
import { copyText, downloadText } from '../services/browser';
import { DEFAULT_ENDPOINT, type PageInfo } from '../services/fetch-page';
import { readHistory, saveToHistory } from '../services/storage';
import { Filters } from './Filters';
import { plural } from './labels';
import { ResultsTable } from './ResultsTable';
import { Summary } from './Summary';
import { UrlInput } from './UrlInput';
import styles from './UrlExtractor.module.css';

export interface UrlExtractorProps {
  /** Same-origin endpoint that fetches pages. Default `/api/fetch-page`. */
  apiEndpoint?: string;
  /** Prefill the URL box. */
  initialUrl?: string;
  /** Fetch `initialUrl` as soon as the component mounts. */
  autoFetch?: boolean;
  /** `auto` follows the visitor's light or dark setting. */
  theme?: 'auto' | 'light' | 'dark';
  /** Remember the last 10 URLs in localStorage and offer them as suggestions. */
  history?: boolean;
  /** Called after each extraction, including re-runs when options change. */
  onResult?: (result: ExtractResult, page: PageInfo) => void;
  onError?: (error: ExtractorError) => void;
  /** Extra class on the root element, for layout. */
  className?: string;
}

const PAGE_SIZE = 500;
const EXPORTS = Object.keys(EXPORT_FORMATS) as ExportFormat[];

export function UrlExtractor({
  apiEndpoint = DEFAULT_ENDPOINT,
  initialUrl = '',
  autoFetch = false,
  theme = 'auto',
  history = true,
  onResult,
  onError,
  className,
}: UrlExtractorProps) {
  const [input, setInput] = useState(initialUrl);
  const [options, setOptions] = useState<ExtractOptions>(DEFAULT_EXTRACT_OPTIONS);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [groupByDomain, setGroupByDomain] = useState(false);
  const [recent, setRecent] = useState<string[]>(() => (history ? readHistory() : []));
  const [notice, setNotice] = useState('');

  const handleResult = useCallback(
    (result: ExtractResult, page: PageInfo) => {
      if (history) setRecent(saveToHistory(page.requestedUrl));
      onResult?.(result, page);
    },
    [history, onResult],
  );

  const extractor = useExtractor({ endpoint: apiEndpoint, options, onResult: handleResult, onError });
  const { run, cancel, status, target, page, result, error } = extractor;
  const { items, error: filterError, summary } = useFilteredUrls(result?.urls, filters);

  // Rows shown so far. Resets whenever the filtered list changes.
  const [paging, setPaging] = useState<{ list: ExtractedUrl[]; limit: number }>({
    list: items,
    limit: PAGE_SIZE,
  });
  const limit = paging.list === items ? paging.limit : PAGE_SIZE;

  useEffect(() => {
    if (autoFetch && initialUrl) void run(initialUrl);
  }, [autoFetch, initialUrl, run]);

  const submit = () => {
    setNotice('');
    void run(input);
  };

  const sortBy = (key: SortKey) =>
    setFilters((current) => {
      // First click sorts (counts largest first), second reverses, third returns to page order.
      const first = key === 'count' ? 'desc' : 'asc';
      const { sort } = current;
      if (!sort || sort.key !== key) return { ...current, sort: { key, dir: first } };
      if (sort.dir === first) return { ...current, sort: { key, dir: first === 'asc' ? 'desc' : 'asc' } };
      return { ...current, sort: null };
    });

  const copy = async (urls: string[]) => {
    const ok = await copyText(urls.join('\n'));
    setNotice(
      ok ? `Copied ${plural(urls.length, 'URL')}.` : "Couldn't copy: the browser blocked clipboard access.",
    );
  };

  const download = (format: ExportFormat) => {
    if (!result) return;
    const { label, mime } = EXPORT_FORMATS[format];
    downloadText(formatUrls(items, format), exportFilename(result.pageUrl, format), mime);
    setNotice(`Downloaded ${plural(items.length, 'URL')} as ${label}.`);
  };

  let statusText = '';
  if (status === 'loading') statusText = `Fetching ${hostOf(target ?? '') || 'the page'}…`;
  else if (status === 'cancelled') statusText = 'Cancelled.';
  else if (status === 'success' && summary && page) {
    statusText =
      notice ||
      `Found ${plural(summary.total, 'URL')} (${summary.unique.toLocaleString()} unique) on ${hostOf(page.finalUrl)}.`;
  }

  const rootClass = [styles.root, className].filter(Boolean).join(' ');

  return (
    <div className={rootClass} data-theme={theme}>
      <UrlInput
        value={input}
        onChange={setInput}
        onSubmit={submit}
        onCancel={cancel}
        loading={status === 'loading'}
        recent={recent}
        options={options}
        onOptionsChange={(patch) => setOptions((current) => ({ ...current, ...patch }))}
      />

      <p className={styles.status} role="status">
        {statusText}
      </p>
      {status === 'error' && error && (
        <div className={styles.alert} role="alert">
          {error.message}
        </div>
      )}

      {status === 'success' && result && page && summary && (
        <>
          <Summary summary={summary} page={page} strippedParams={result.strippedParams} />
          <Filters
            filters={filters}
            onChange={(patch) => setFilters((current) => ({ ...current, ...patch }))}
            onReset={() => setFilters((current) => ({ ...DEFAULT_FILTERS, sort: current.sort }))}
            summary={summary}
            groupByDomain={groupByDomain}
            onGroupByDomainChange={setGroupByDomain}
            error={filterError}
          />

          <div className={styles.toolbar} role="group" aria-label="Copy and download">
            <span className={styles.count}>
              Showing {items.length.toLocaleString()} of{' '}
              {plural(filters.unique ? summary.unique : summary.total, 'URL')}
            </span>
            <button
              type="button"
              className={`${styles.button} ${styles.primary}`}
              disabled={items.length === 0}
              onClick={() => void copy(items.map((item) => item.url))}
            >
              Copy {items.length.toLocaleString()} shown
            </button>
            <span className={styles.label} aria-hidden="true">
              Download
            </span>
            {EXPORTS.map((format) => (
              <button
                key={format}
                type="button"
                className={styles.button}
                disabled={items.length === 0}
                onClick={() => download(format)}
                aria-label={`Download ${EXPORT_FORMATS[format].label}`}
              >
                {EXPORT_FORMATS[format].label}
              </button>
            ))}
          </div>

          {items.length > 0 ? (
            <ResultsTable
              items={items}
              limit={limit}
              pageSize={PAGE_SIZE}
              onShowMore={() => setPaging({ list: items, limit: limit + PAGE_SIZE })}
              unique={filters.unique}
              groupByDomain={groupByDomain}
              sort={filters.sort}
              onSort={sortBy}
              onCopy={(url) => void copy([url])}
              onDomain={(host) => setFilters((current) => ({ ...current, domain: host }))}
            />
          ) : (
            <p className={styles.empty}>No URLs match these filters.</p>
          )}
        </>
      )}
    </div>
  );
}
