import { getDomain } from 'tldts';
import type { UrlKind, UrlScope } from './types';

/** The host a URL belongs to: the hostname, the domain of a mailto: address, or '' for tel:. */
export function hostOf(url: string | URL): string {
  try {
    const parsed = typeof url === 'string' ? new URL(url) : url;
    if (parsed.protocol === 'mailto:') {
      const address = decodeURIComponent(parsed.pathname).split(',')[0] ?? '';
      return (address.split('@')[1] ?? '').toLowerCase();
    }
    if (parsed.protocol === 'tel:') return '';
    return parsed.hostname.toLowerCase();
  } catch {
    return '';
  }
}

/** Registrable domain, e.g. `blog.example.co.uk` -> `example.co.uk`. Null for IPs and single labels. */
function siteOf(host: string): string | null {
  return host ? getDomain(host) : null;
}

/**
 * internal: same hostname as the page. subdomain: same registrable domain (www.example.com vs
 * example.com, or shop.example.com). external: anything else. Email addresses on the page's own
 * domain and phone numbers count as internal.
 */
export function getScope(url: URL, page: URL): UrlScope {
  const pageHost = page.hostname.toLowerCase();
  if (url.protocol === 'tel:') return 'internal';
  if (url.protocol === 'mailto:') {
    const domain = hostOf(url);
    if (!domain) return 'external';
    const site = siteOf(domain);
    return domain === pageHost || (site !== null && site === siteOf(pageHost)) ? 'internal' : 'external';
  }

  const host = url.hostname.toLowerCase();
  if (host === pageHost) return 'internal';
  const site = siteOf(host);
  return site !== null && site === siteOf(pageHost) ? 'subdomain' : 'external';
}

const EXTENSION_KINDS: Array<[RegExp, UrlKind]> = [
  [/\.(avif|bmp|gif|heic|ico|jpe?g|jxl|png|svg|tiff?|webp)$/, 'image'],
  [/\.css$/, 'stylesheet'],
  [/\.(c|m)?js$/, 'script'],
  [/\.(eot|otf|ttf|woff2?)$/, 'font'],
  [/\.(aac|flac|m3u8|m4a|m4v|mov|mp3|mp4|mpd|oga|ogg|ogv|vtt|wav|webm)$/, 'media'],
  [/\.(7z|csv|docx?|epub|gz|odp|ods|odt|pdf|pptx?|rar|rtf|tar|txt|xlsx?|zip)$/, 'document'],
];

/** Kind implied by the path's file extension, if any. */
export function kindFromExtension(url: URL): UrlKind | undefined {
  const path = url.pathname.toLowerCase();
  for (const [pattern, kind] of EXTENSION_KINDS) {
    if (pattern.test(path)) return kind;
  }
  return undefined;
}

const PRELOAD_AS: Record<string, UrlKind> = {
  style: 'stylesheet',
  script: 'script',
  font: 'font',
  image: 'image',
  audio: 'media',
  video: 'media',
  track: 'media',
  document: 'page',
};

/** Kind for a `<link>` from its rel and as attributes. */
export function linkKind(element: Element, url: URL): UrlKind {
  const rel = (element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const as = (element.getAttribute('as') ?? '').toLowerCase();

  if (rel.includes('stylesheet')) return 'stylesheet';
  if (rel.some((r) => r === 'icon' || r.startsWith('apple-touch-icon') || r === 'mask-icon')) return 'image';
  if (rel.includes('modulepreload')) return 'script';
  if (rel.includes('preload') || rel.includes('prefetch')) {
    return PRELOAD_AS[as] ?? kindFromExtension(url) ?? 'other';
  }
  if (
    rel.some((r) => ['canonical', 'alternate', 'next', 'prev', 'amphtml', 'shortlink', 'author'].includes(r))
  ) {
    return kindFromExtension(url) ?? 'page';
  }
  return kindFromExtension(url) ?? 'other';
}
