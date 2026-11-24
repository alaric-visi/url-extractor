/** Where a URL points, relative to the page it was found on. */
export type UrlScope = 'internal' | 'subdomain' | 'external';

/** What a URL is, judged first by the element that referenced it, then by its file extension. */
export type UrlKind =
  | 'page'
  | 'image'
  | 'script'
  | 'stylesheet'
  | 'font'
  | 'media'
  | 'document'
  | 'frame'
  | 'form'
  | 'email'
  | 'phone'
  | 'other';

export const URL_SCOPES: readonly UrlScope[] = ['internal', 'subdomain', 'external'];

export const URL_KINDS: readonly UrlKind[] = [
  'page',
  'image',
  'script',
  'stylesheet',
  'font',
  'media',
  'document',
  'frame',
  'form',
  'email',
  'phone',
  'other',
];

/** The element and attribute a URL was read from, e.g. `a` / `href` or `meta[og:image]` / `content`. */
export interface UrlSource {
  tag: string;
  attr: string;
}

export interface ExtractedUrl {
  /** Normalised absolute URL. */
  url: string;
  /** The value as written in the page. */
  raw: string;
  scope: UrlScope;
  kind: UrlKind;
  source: UrlSource;
  /** Link text, aria-label, alt or title, when the element has one. */
  text?: string;
  /** Lower-cased `rel` tokens, e.g. nofollow, sponsored, ugc, noopener. */
  rel?: string[];
  /** `target="_blank"` on the link or form. */
  newTab?: boolean;
  /** Occurrences. 1 per raw match; summed by `dedupe`. */
  count: number;
}

export interface ExtractOptions {
  /** Remove utm_* and click-ID parameters such as fbclid and gclid. */
  stripTracking: boolean;
  /** Keep `#fragment`s. Off by default so `/page` and `/page#top` count as one URL. */
  keepFragments: boolean;
  /** Read URLs from JSON-LD structured data. */
  jsonLd: boolean;
  /** Scan inline `<script>` text for absolute URLs. Noisy, so off by default. */
  deepScan: boolean;
}

export const DEFAULT_EXTRACT_OPTIONS: ExtractOptions = {
  stripTracking: true,
  keepFragments: false,
  jsonLd: true,
  deepScan: false,
};

export interface ExtractResult {
  /** The page the URLs were found on (after redirects). Scope is judged against this. */
  pageUrl: string;
  /** What relative URLs were resolved against: `<base href>` if the page has one, else pageUrl. */
  baseUrl: string;
  /** Every match in document order, one entry per occurrence. */
  urls: ExtractedUrl[];
  /** Tracking parameters removed across all URLs. */
  strippedParams: number;
}
