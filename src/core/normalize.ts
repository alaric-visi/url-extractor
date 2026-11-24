import type { ExtractOptions } from './types';

export class InputError extends Error {
  readonly code = 'invalid_url';
}

const HAS_SCHEME = /^[a-z][a-z\d+.-]*:\/\//i;

/**
 * Turns what someone typed into an absolute http(s) URL.
 * Adds https:// only when no scheme is present, so `httpbin.org` works and `ftp://x` is refused.
 */
export function normalizeInput(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new InputError('Enter a URL to fetch.');

  const candidate = HAS_SCHEME.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, '')}`;
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new InputError("That doesn't look like a URL. Try something like example.com/page.");
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new InputError('Only http and https URLs can be fetched.');
  }
  if (url.username || url.password) {
    throw new InputError("URLs with a username or password can't be fetched.");
  }
  if (!url.hostname.includes('.') && !url.hostname.includes(':')) {
    throw new InputError('Enter a full domain, such as example.com.');
  }
  return url.href;
}

/** Schemes that never point at a fetchable resource. Matched case-insensitively. */
const SKIPPED_SCHEMES =
  /^\s*(javascript|vbscript|data|blob|about|file|chrome|chrome-extension|moz-extension|view-source):/i;
const KEPT_PROTOCOLS = new Set(['http:', 'https:', 'mailto:', 'tel:']);

/**
 * Resolves a value from the page against the document base.
 * Returns null for same-page fragments, skipped schemes and anything that doesn't parse.
 */
export function resolveUrl(raw: string, base: string): URL | null {
  const value = raw.trim();
  if (!value || value.startsWith('#') || SKIPPED_SCHEMES.test(value)) return null;
  try {
    const url = new URL(value, base);
    return KEPT_PROTOCOLS.has(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

const TRACKING_PARAMS = new Set([
  'fbclid',
  'gclid',
  'gclsrc',
  'dclid',
  'gbraid',
  'wbraid',
  'msclkid',
  'yclid',
  'twclid',
  'ttclid',
  'igshid',
  'li_fat_id',
  'mc_cid',
  'mc_eid',
  '_ga',
  '_gl',
  '_hsenc',
  '_hsmi',
  'mkt_tok',
]);

export function isTrackingParam(key: string): boolean {
  const lower = key.toLowerCase();
  return lower.startsWith('utm_') || TRACKING_PARAMS.has(lower);
}

/** Removes tracking parameters in place and returns how many were removed. */
export function stripTrackingParams(url: URL): number {
  // Collect first, then delete: deleting while iterating skips the next entry.
  const entries = [...url.searchParams.keys()];
  const tracking = entries.filter(isTrackingParam);
  if (tracking.length === 0) return 0;
  for (const key of new Set(tracking)) url.searchParams.delete(key);
  return tracking.length;
}

/** Applies the extraction options to a resolved URL. Trailing slashes and other params are left as written. */
export function finaliseUrl(
  url: URL,
  options: Pick<ExtractOptions, 'stripTracking' | 'keepFragments'>,
): { href: string; stripped: number } {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { href: url.href, stripped: 0 };
  if (!options.keepFragments) url.hash = '';
  const stripped = options.stripTracking ? stripTrackingParams(url) : 0;
  return { href: url.href, stripped };
}

/** The key two URLs must share to count as one. `/docs/` and `/docs` only merge when asked. */
export function dedupeKey(url: string, ignoreTrailingSlash: boolean): string {
  if (!ignoreTrailingSlash) return url;
  try {
    const parsed = new URL(url);
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    }
    return parsed.href;
  } catch {
    return url;
  }
}
