import { useId } from 'react';
import type { ExtractOptions } from '../core/types';
import styles from './UrlExtractor.module.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  loading: boolean;
  recent: string[];
  options: ExtractOptions;
  onOptionsChange: (patch: Partial<ExtractOptions>) => void;
}

const OPTION_LABELS: Array<[keyof ExtractOptions, string]> = [
  ['stripTracking', 'Strip tracking parameters (utm_*, fbclid, gclid and similar)'],
  ['keepFragments', 'Keep #fragments'],
  ['jsonLd', 'Include URLs from JSON-LD structured data'],
  ['deepScan', 'Deep scan: absolute URLs inside inline scripts (noisy)'],
];

export function UrlInput({
  value,
  onChange,
  onSubmit,
  onCancel,
  loading,
  recent,
  options,
  onOptionsChange,
}: Props) {
  const id = useId();

  return (
    <form
      className={styles.form}
      aria-label="Fetch a page"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor={`${id}-url`} className={styles.label}>
        Page URL
      </label>
      <div className={styles.inputRow}>
        <input
          id={`${id}-url`}
          className={styles.input}
          type="text"
          inputMode="url"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          placeholder="https://example.com/page"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          list={recent.length ? `${id}-recent` : undefined}
          aria-describedby={`${id}-hint`}
        />
        {recent.length > 0 && (
          <datalist id={`${id}-recent`}>
            {recent.map((url) => (
              <option key={url} value={url} />
            ))}
          </datalist>
        )}
        {loading ? (
          <button type="button" className={styles.button} onClick={onCancel}>
            Cancel
          </button>
        ) : (
          <button type="submit" className={`${styles.button} ${styles.primary}`}>
            Extract URLs
          </button>
        )}
      </div>
      <p id={`${id}-hint`} className={styles.hint}>
        Pages are fetched by this site&apos;s server and not stored. Links that only appear after JavaScript
        runs aren&apos;t included.
      </p>
      <details className={styles.details}>
        <summary>Extraction options</summary>
        <div className={styles.checks}>
          {OPTION_LABELS.map(([key, label]) => (
            <label key={key} className={styles.check}>
              <input
                type="checkbox"
                checked={options[key]}
                onChange={(event) => onOptionsChange({ [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
        </div>
      </details>
    </form>
  );
}
