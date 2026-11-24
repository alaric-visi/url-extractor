import type { ReactNode } from 'react';
import { hostOf } from '../core/classify';
import { groupByHost, type SortKey, type SortState } from '../core/filter';
import type { ExtractedUrl } from '../core/types';
import { COLUMN_LABELS, KIND_LABELS, plural, SCOPE_LABELS } from './labels';
import styles from './UrlExtractor.module.css';

interface Props {
  items: ExtractedUrl[];
  /** Rows to render; the rest wait behind "Show more". */
  limit: number;
  pageSize: number;
  onShowMore: () => void;
  unique: boolean;
  groupByDomain: boolean;
  sort: SortState | null;
  onSort: (key: SortKey) => void;
  onCopy: (url: string) => void;
  onDomain: (host: string) => void;
}

const ARIA_SORT = { asc: 'ascending', desc: 'descending' } as const;

export function ResultsTable({
  items,
  limit,
  pageSize,
  onShowMore,
  unique,
  groupByDomain,
  sort,
  onSort,
  onCopy,
  onDomain,
}: Props) {
  const columns: SortKey[] = unique
    ? ['url', 'kind', 'scope', 'source', 'text', 'count']
    : ['url', 'kind', 'scope', 'source', 'text'];
  const columnCount = columns.length + 1;
  const hidden = Math.max(0, items.length - limit);

  const row = (item: ExtractedUrl, index: number) => {
    const web = item.url.startsWith('http');
    const host = hostOf(item.url);
    return (
      <tr key={`${index}:${item.url}`}>
        <td className={styles.urlCell}>
          <a
            href={item.url}
            target={web ? '_blank' : undefined}
            rel={web ? 'noopener noreferrer' : undefined}
          >
            {item.url}
          </a>
          {(item.rel?.length || item.newTab) && (
            <span className={styles.meta}>
              {item.rel?.length ? `rel="${item.rel.join(' ')}"` : ''}
              {item.rel?.length && item.newTab ? ' · ' : ''}
              {item.newTab ? 'opens in new tab' : ''}
            </span>
          )}
        </td>
        <td>
          <span className={styles.badge}>{KIND_LABELS[item.kind]}</span>
        </td>
        <td>{SCOPE_LABELS[item.scope]}</td>
        <td className={styles.source}>
          <code>{item.source.tag}</code> {item.source.attr}
        </td>
        <td className={styles.text}>{item.text}</td>
        {unique && <td className={styles.num}>{item.count.toLocaleString()}</td>}
        <td>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.smallButton}
              onClick={() => onCopy(item.url)}
              aria-label={`Copy ${item.url}`}
            >
              Copy
            </button>
            {host && (
              <button
                type="button"
                className={styles.smallButton}
                onClick={() => onDomain(host)}
                aria-label={`Only domain ${host}`}
              >
                Only domain
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  };

  let body: ReactNode;
  if (groupByDomain) {
    let remaining = limit;
    body = groupByHost(items).map((group) => {
      if (remaining <= 0) return null;
      const shown = group.items.slice(0, remaining);
      remaining -= shown.length;
      return (
        <tbody key={group.host || 'none'}>
          <tr className={styles.groupRow}>
            <th scope="rowgroup" colSpan={columnCount}>
              {group.host || 'Phone numbers'}{' '}
              <span className={styles.chipCount}>{plural(group.items.length, 'URL')}</span>
            </th>
          </tr>
          {shown.map(row)}
        </tbody>
      );
    });
  } else {
    body = <tbody>{items.slice(0, limit).map(row)}</tbody>;
  }

  return (
    <>
      <div className={styles.tableWrap} role="region" aria-label="Extracted URLs" tabIndex={0}>
        <table className={styles.table}>
          <caption className={styles.visuallyHidden}>
            Extracted URLs
            {sort ? `, sorted by ${COLUMN_LABELS[sort.key]} ${ARIA_SORT[sort.dir]}` : ', in page order'}
          </caption>
          <thead>
            <tr>
              {columns.map((key) => (
                <th key={key} scope="col" aria-sort={sort?.key === key ? ARIA_SORT[sort.dir] : undefined}>
                  <button type="button" className={styles.sortButton} onClick={() => onSort(key)}>
                    {COLUMN_LABELS[key]}
                    <span aria-hidden="true" className={styles.sortMark}>
                      {sort?.key === key ? (sort.dir === 'asc' ? '▲' : '▼') : ''}
                    </span>
                  </button>
                </th>
              ))}
              <th scope="col">
                <span className={styles.visuallyHidden}>Actions</span>
              </th>
            </tr>
          </thead>
          {body}
        </table>
      </div>
      {hidden > 0 && (
        <button type="button" className={`${styles.button} ${styles.more}`} onClick={onShowMore}>
          Show {Math.min(pageSize, hidden).toLocaleString()} more ({hidden.toLocaleString()} not shown)
        </button>
      )}
    </>
  );
}
