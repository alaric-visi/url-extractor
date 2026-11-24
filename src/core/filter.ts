import { hostOf } from './classify';
import { dedupeKey } from './normalize';
import { URL_KINDS, URL_SCOPES, type ExtractedUrl, type UrlKind, type UrlScope } from './types';

export type SortKey = 'url' | 'kind' | 'scope' | 'source' | 'text' | 'count';
export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: SortKey;
  dir: SortDirection;
}

export interface FilterState {
  /** Keep URLs whose address or text matches. */
  text: string;
  /** Drop URLs whose address or text matches. */
  exclude: string;
  /** Treat `text` and `exclude` as regular expressions. */
  regex: boolean;
  /** Empty means every kind. */
  kinds: UrlKind[];
  /** Empty means every scope. */
  scopes: UrlScope[];
  /** Only URLs on this host. */
  domain: string | null;
  /** One row per URL, with a count. */
  unique: boolean;
  /** Treat `/docs` and `/docs/` as the same URL when `unique` is on. */
  ignoreTrailingSlash: boolean;
  /** Null keeps page order. */
  sort: SortState | null;
}

export const DEFAULT_FILTERS: FilterState = {
  text: '',
  exclude: '',
  regex: false,
  kinds: [],
  scopes: [],
  domain: null,
  unique: true,
  ignoreTrailingSlash: false,
  sort: null,
};

/** One entry per URL, keeping the first occurrence's details and summing counts. */
export function dedupe(urls: readonly ExtractedUrl[], ignoreTrailingSlash = false): ExtractedUrl[] {
  const byKey = new Map<string, ExtractedUrl>();
  for (const item of urls) {
    const key = dedupeKey(item.url, ignoreTrailingSlash);
    const existing = byKey.get(key);
    if (existing) {
      existing.count += item.count;
      if (!existing.text && item.text) existing.text = item.text;
    } else {
      byKey.set(key, { ...item });
    }
  }
  return [...byKey.values()];
}

type Matcher = (value: string) => boolean;

function buildMatcher(pattern: string, regex: boolean): { match?: Matcher; error?: string } {
  const trimmed = pattern.trim();
  if (!trimmed) return {};
  if (regex) {
    try {
      const re = new RegExp(trimmed, 'i');
      return { match: (value) => re.test(value) };
    } catch (error) {
      return { error: `Invalid regular expression: ${(error as Error).message}` };
    }
  }
  const needle = trimmed.toLowerCase();
  return { match: (value) => value.toLowerCase().includes(needle) };
}

/** A row matches when its address or its text does. */
const matchesItem = (match: Matcher, item: ExtractedUrl) =>
  match(item.url) || (item.text ? match(item.text) : false);

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function compare(a: ExtractedUrl, b: ExtractedUrl, key: SortKey): number {
  switch (key) {
    case 'count':
      return a.count - b.count;
    case 'source':
      return collator.compare(`${a.source.tag} ${a.source.attr}`, `${b.source.tag} ${b.source.attr}`);
    case 'text':
      return collator.compare(a.text ?? '', b.text ?? '');
    default:
      return collator.compare(a[key], b[key]);
  }
}

/** Stable sort: ties keep page order. */
export function sortUrls(items: readonly ExtractedUrl[], sort: SortState): ExtractedUrl[] {
  const factor = sort.dir === 'asc' ? 1 : -1;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => compare(a.item, b.item, sort.key) * factor || a.index - b.index)
    .map(({ item }) => item);
}

export interface FilterOutcome {
  items: ExtractedUrl[];
  /** Set when a regular expression doesn't compile; that filter is skipped. */
  error?: string;
}

export function applyFilters(urls: readonly ExtractedUrl[], state: FilterState): FilterOutcome {
  let items = state.unique ? dedupe(urls, state.ignoreTrailingSlash) : [...urls];

  const include = buildMatcher(state.text, state.regex);
  const exclude = buildMatcher(state.exclude, state.regex);
  const error = include.error ?? exclude.error;
  if (include.match) items = items.filter((item) => matchesItem(include.match!, item));
  if (exclude.match) items = items.filter((item) => !matchesItem(exclude.match!, item));

  if (state.kinds.length) items = items.filter((item) => state.kinds.includes(item.kind));
  if (state.scopes.length) items = items.filter((item) => state.scopes.includes(item.scope));
  if (state.domain !== null) items = items.filter((item) => hostOf(item.url) === state.domain);
  if (state.sort) items = sortUrls(items, state.sort);

  return error ? { items, error } : { items };
}

export interface HostGroup {
  host: string;
  items: ExtractedUrl[];
}

/** Groups rows by host, alphabetically; rows keep their order inside each group. */
export function groupByHost(items: readonly ExtractedUrl[]): HostGroup[] {
  const groups = new Map<string, ExtractedUrl[]>();
  for (const item of items) {
    const host = hostOf(item.url);
    const list = groups.get(host);
    if (list) list.push(item);
    else groups.set(host, [item]);
  }
  return [...groups.entries()]
    .map(([host, list]) => ({ host, items: list }))
    .sort((a, b) => collator.compare(a.host, b.host));
}

export interface Summary {
  /** Every occurrence. */
  total: number;
  /** Distinct URLs. */
  unique: number;
  /** Distinct URLs by scope. */
  byScope: Record<UrlScope, number>;
  /** Distinct URLs by kind. */
  byKind: Record<UrlKind, number>;
}

export function summarise(urls: readonly ExtractedUrl[], ignoreTrailingSlash = false): Summary {
  const unique = dedupe(urls, ignoreTrailingSlash);
  const byScope = Object.fromEntries(URL_SCOPES.map((scope) => [scope, 0])) as Record<UrlScope, number>;
  const byKind = Object.fromEntries(URL_KINDS.map((kind) => [kind, 0])) as Record<UrlKind, number>;
  for (const item of unique) {
    byScope[item.scope] += 1;
    byKind[item.kind] += 1;
  }
  return { total: urls.length, unique: unique.length, byScope, byKind };
}
