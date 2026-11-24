import { kindFromExtension, linkKind } from './classify';
import type { UrlKind } from './types';

export type KindRule = UrlKind | ((element: Element, url: URL) => UrlKind);

export interface SourceRule {
  /** CSS selector the element must match. */
  selector: string;
  /** Attribute to read. */
  attr: string;
  /** Attribute to read when `attr` is missing, e.g. `xlink:href` on SVG. */
  fallbackAttr?: string;
  /** Extra condition the element must meet. */
  when?: (element: Element) => boolean;
  /** Label for `source.tag`. Defaults to the lower-case tag name. */
  tag?: string | ((element: Element) => string);
  /** How to read the value: a srcset list, a meta refresh, or CSS `url()`s. Default: the value as-is. */
  parse?: 'srcset' | 'refresh' | 'style';
  kind: KindRule;
}

const byExtension =
  (fallback: UrlKind): KindRule =>
  (_element, url) =>
    kindFromExtension(url) ?? fallback;

/** `<source>` means media inside `<video>`/`<audio>` and images inside `<picture>`. */
const sourceElementKind: KindRule = (element, url) => {
  const parent = element.parentElement?.tagName.toLowerCase();
  if (parent === 'video' || parent === 'audio') return 'media';
  if (parent === 'picture') return 'image';
  return kindFromExtension(url) ?? 'other';
};

const META_KINDS: Record<string, UrlKind> = {
  'og:image': 'image',
  'og:image:url': 'image',
  'og:image:secure_url': 'image',
  'twitter:image': 'image',
  'twitter:image:src': 'image',
  'msapplication-tileimage': 'image',
  thumbnail: 'image',
  image: 'image',
  logo: 'image',
  'og:url': 'page',
  'twitter:url': 'page',
  url: 'page',
  'og:video': 'media',
  'og:video:url': 'media',
  'og:video:secure_url': 'media',
  'og:audio': 'media',
  'og:audio:url': 'media',
  'twitter:player': 'media',
};

export function metaName(element: Element): string {
  return (
    element.getAttribute('property') ??
    element.getAttribute('name') ??
    element.getAttribute('itemprop') ??
    ''
  ).toLowerCase();
}

const metaKind = (element: Element): UrlKind | undefined => META_KINDS[metaName(element)];

/**
 * Every element and attribute the extractor reads. Rules run in this order for each element, and
 * elements are visited in document order, so results come out in the order they appear in the page.
 */
export const SOURCE_RULES: readonly SourceRule[] = [
  { selector: 'a[href], area[href]', attr: 'href', kind: byExtension('page') },
  {
    selector: 'link[href]',
    attr: 'href',
    kind: linkKind,
    tag: (el) => {
      const rel = el.getAttribute('rel')?.trim().toLowerCase().replace(/\s+/g, ' ');
      return rel ? `link[${rel}]` : 'link';
    },
  },
  { selector: 'link[imagesrcset]', attr: 'imagesrcset', parse: 'srcset', kind: 'image' },
  { selector: 'img[src], input[type="image"][src]', attr: 'src', kind: 'image' },
  { selector: 'img[srcset]', attr: 'srcset', parse: 'srcset', kind: 'image' },
  { selector: 'img[data-src]', attr: 'data-src', kind: 'image' },
  { selector: 'img[data-srcset], source[data-srcset]', attr: 'data-srcset', parse: 'srcset', kind: 'image' },
  { selector: 'source[srcset]', attr: 'srcset', parse: 'srcset', kind: sourceElementKind },
  { selector: 'source[src]', attr: 'src', kind: sourceElementKind },
  { selector: 'video[src], audio[src], track[src]', attr: 'src', kind: 'media' },
  { selector: 'video[poster]', attr: 'poster', kind: 'image' },
  { selector: 'iframe[src], frame[src]', attr: 'src', kind: 'frame' },
  { selector: 'iframe[data-src]', attr: 'data-src', kind: 'frame' },
  { selector: 'script[src]', attr: 'src', kind: 'script' },
  { selector: 'embed[src]', attr: 'src', kind: byExtension('other') },
  { selector: 'object[data]', attr: 'data', kind: byExtension('other') },
  { selector: 'form[action]', attr: 'action', kind: 'form' },
  { selector: 'button[formaction], input[formaction]', attr: 'formaction', kind: 'form' },
  { selector: 'blockquote[cite], q[cite], del[cite], ins[cite]', attr: 'cite', kind: 'page' },
  { selector: 'svg image, svg use', attr: 'href', fallbackAttr: 'xlink:href', kind: byExtension('image') },
  {
    selector: 'meta[content]',
    attr: 'content',
    when: (el) => metaKind(el) !== undefined,
    kind: (el) => metaKind(el) ?? 'other',
    tag: (el) => `meta[${metaName(el)}]`,
  },
  {
    selector: 'meta[http-equiv][content]',
    attr: 'content',
    when: (el) => el.getAttribute('http-equiv')?.toLowerCase() === 'refresh',
    parse: 'refresh',
    kind: byExtension('page'),
    tag: 'meta[refresh]',
  },
  { selector: '[style*="url("]', attr: 'style', parse: 'style', kind: byExtension('image') },
  { selector: '[data-src]:not(img):not(iframe)', attr: 'data-src', kind: byExtension('other') },
  { selector: '[data-href]', attr: 'data-href', kind: byExtension('page') },
  { selector: '[data-url]', attr: 'data-url', kind: byExtension('page') },
  { selector: '[data-bg]', attr: 'data-bg', kind: byExtension('image') },
  { selector: '[data-background]', attr: 'data-background', kind: byExtension('image') },
];

const CSS_URL = /url\(\s*(['"]?)(.*?)\1\s*\)/gi;
const CSS_IMPORT = /@import\s+(['"])(.*?)\1/gi;

/** URLs inside CSS: every `url(...)` plus `@import "..."` strings. */
export function cssUrls(css: string): Array<{ value: string; via: 'url()' | '@import' }> {
  const found: Array<{ value: string; via: 'url()' | '@import' }> = [];
  for (const match of css.matchAll(CSS_URL)) {
    if (match[2]) found.push({ value: match[2], via: 'url()' });
  }
  for (const match of css.matchAll(CSS_IMPORT)) {
    if (match[2]) found.push({ value: match[2], via: '@import' });
  }
  return found;
}

/** The URL in a meta refresh value such as `5; url=https://example.com/`. */
export function refreshUrl(content: string): string | undefined {
  const match = /url\s*=\s*(['"]?)(.+?)\1\s*$/i.exec(content.trim());
  return match?.[2]?.trim() || undefined;
}
