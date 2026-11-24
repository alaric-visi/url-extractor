import { useId } from 'react';
import type { FilterState, Summary } from '../core/filter';
import { URL_KINDS, URL_SCOPES, type UrlKind, type UrlScope } from '../core/types';
import { KIND_LABELS, SCOPE_LABELS } from './labels';
import styles from './UrlExtractor.module.css';

interface Props {
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  onReset: () => void;
  summary: Summary;
  groupByDomain: boolean;
  onGroupByDomainChange: (value: boolean) => void;
  error?: string;
}

function toggle<T>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

export function Filters({
  filters,
  onChange,
  onReset,
  summary,
  groupByDomain,
  onGroupByDomainChange,
  error,
}: Props) {
  const id = useId();
  const kinds = URL_KINDS.filter((kind) => summary.byKind[kind] > 0);
  const scopes = URL_SCOPES.filter((scope) => summary.byScope[scope] > 0);

  return (
    <section className={styles.filters} aria-label="Filters">
      <div className={styles.filterRow}>
        <div className={styles.field}>
          <label htmlFor={`${id}-text`} className={styles.label}>
            Filter
          </label>
          <input
            id={`${id}-text`}
            className={styles.input}
            type="search"
            placeholder="Domain, path or link text"
            value={filters.text}
            onChange={(event) => onChange({ text: event.target.value })}
            aria-describedby={`${id}-error`}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-exclude`} className={styles.label}>
            Exclude
          </label>
          <input
            id={`${id}-exclude`}
            className={styles.input}
            type="search"
            placeholder="e.g. facebook.com"
            value={filters.exclude}
            onChange={(event) => onChange({ exclude: event.target.value })}
            aria-describedby={`${id}-error`}
          />
        </div>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={filters.regex}
            onChange={(event) => onChange({ regex: event.target.checked })}
          />
          Regular expressions
        </label>
      </div>
      <p id={`${id}-error`} className={styles.fieldError} aria-live="polite">
        {error}
      </p>

      <fieldset className={styles.chipGroup}>
        <legend className={styles.label}>Kind</legend>
        <div className={styles.chips}>
          {kinds.map((kind: UrlKind) => (
            <button
              key={kind}
              type="button"
              className={styles.chip}
              aria-pressed={filters.kinds.includes(kind)}
              onClick={() => onChange({ kinds: toggle(filters.kinds, kind) })}
            >
              {KIND_LABELS[kind]}{' '}
              <span className={styles.chipCount}>{summary.byKind[kind].toLocaleString()}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className={styles.chipGroup}>
        <legend className={styles.label}>Scope</legend>
        <div className={styles.chips}>
          {scopes.map((scope: UrlScope) => (
            <button
              key={scope}
              type="button"
              className={styles.chip}
              aria-pressed={filters.scopes.includes(scope)}
              onClick={() => onChange({ scopes: toggle(filters.scopes, scope) })}
            >
              {SCOPE_LABELS[scope]}{' '}
              <span className={styles.chipCount}>{summary.byScope[scope].toLocaleString()}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className={styles.filterRow}>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={filters.unique}
            onChange={(event) => onChange({ unique: event.target.checked })}
          />
          Unique URLs only
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={filters.ignoreTrailingSlash}
            onChange={(event) => onChange({ ignoreTrailingSlash: event.target.checked })}
          />
          Treat /page and /page/ as the same
        </label>
        <label className={styles.check}>
          <input
            type="checkbox"
            checked={groupByDomain}
            onChange={(event) => onGroupByDomainChange(event.target.checked)}
          />
          Group by domain
        </label>
        {filters.domain !== null && (
          <span className={styles.activeDomain}>
            Domain: {filters.domain || 'phone numbers'}
            <button type="button" className={styles.linkButton} onClick={() => onChange({ domain: null })}>
              Clear<span className={styles.visuallyHidden}> domain filter</span>
            </button>
          </span>
        )}
        <button type="button" className={styles.linkButton} onClick={onReset}>
          Reset filters
        </button>
      </div>
    </section>
  );
}
