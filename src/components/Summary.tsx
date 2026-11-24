import type { Summary as SummaryData } from '../core/filter';
import type { PageInfo } from '../services/fetch-page';
import { plural } from './labels';
import styles from './UrlExtractor.module.css';

interface Props {
  summary: SummaryData;
  page: PageInfo;
  strippedParams: number;
}

export function Summary({ summary, page, strippedParams }: Props) {
  const tiles: Array<[string, number]> = [
    ['Unique URLs', summary.unique],
    ['Found in total', summary.total],
    ['Internal', summary.byScope.internal],
    ['Subdomain', summary.byScope.subdomain],
    ['External', summary.byScope.external],
    ['Tracking params removed', strippedParams],
  ];

  return (
    <section className={styles.summary} aria-label="Summary">
      <dl className={styles.stats}>
        {tiles.map(([label, value]) => (
          <div key={label} className={styles.tile}>
            <dt>{label}</dt>
            <dd>{value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
      <p className={styles.pageInfo}>
        Fetched{' '}
        <a href={page.finalUrl} target="_blank" rel="noopener noreferrer">
          {page.finalUrl}
        </a>{' '}
        · HTTP {page.status}
        {page.redirects.length > 0 && <> · {plural(page.redirects.length, 'redirect')}</>}
      </p>
      {page.status >= 400 && (
        <p className={styles.warning}>
          The page answered {page.status} {page.statusText}. These URLs come from that response.
        </p>
      )}
      {page.truncated && (
        <p className={styles.warning}>
          The page was larger than the fetch limit, so only the first part was read. Links near the end may be
          missing.
        </p>
      )}
    </section>
  );
}
