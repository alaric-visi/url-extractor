import { getScope, kindFromExtension } from './classify';
import { finaliseUrl, resolveUrl } from './normalize';
import { cssUrls, refreshUrl, SOURCE_RULES, type KindRule, type SourceRule } from './sources';
import { parseSrcset } from './srcset';
import {
  DEFAULT_EXTRACT_OPTIONS,
  type ExtractedUrl,
  type ExtractOptions,
  type ExtractResult,
  type UrlSource,
} from './types';

/** What relative URLs resolve against: `<base href>` (itself resolved against the page) or the page URL. */
export function documentBase(doc: Document, pageUrl: string): string {
  const href = doc.querySelector('base[href]')?.getAttribute('href');
  if (href) {
    try {
      const base = new URL(href.trim(), pageUrl);
      if (base.protocol === 'http:' || base.protocol === 'https:') return base.href;
    } catch {
      // An unparseable <base> is ignored, as browsers do.
    }
  }
  return pageUrl;
}

const MAX_TEXT = 200;

function cleanText(value: string | null | undefined): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** Link text, rel and target for the element a URL came from. */
function describe(element: Element): Pick<ExtractedUrl, 'text' | 'rel' | 'newTab'> {
  const tag = element.tagName.toLowerCase();
  const out: Pick<ExtractedUrl, 'text' | 'rel' | 'newTab'> = {};

  if (tag === 'a' || tag === 'area') {
    out.text =
      cleanText(element.getAttribute('aria-label')) ??
      cleanText(element.textContent) ??
      cleanText(element.querySelector('img[alt]')?.getAttribute('alt')) ??
      cleanText(element.getAttribute('title')) ??
      cleanText(element.getAttribute('alt'));
  } else if (tag === 'img' || tag === 'input') {
    out.text = cleanText(element.getAttribute('alt'));
  } else if (tag === 'iframe') {
    out.text = cleanText(element.getAttribute('title'));
  }

  if (tag === 'a' || tag === 'area') {
    const rel = (element.getAttribute('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    if (rel.length) out.rel = rel;
  }
  if (
    (tag === 'a' || tag === 'area' || tag === 'form') &&
    element.getAttribute('target')?.toLowerCase() === '_blank'
  ) {
    out.newTab = true;
  }
  if (!out.text) delete out.text;
  return out;
}

function readRule(rule: SourceRule, element: Element): { attr: string; values: string[] } {
  let attr = rule.attr;
  let value = element.getAttribute(attr);
  if (value === null && rule.fallbackAttr) {
    attr = rule.fallbackAttr;
    value = element.getAttribute(attr);
  }
  if (value === null) return { attr, values: [] };

  switch (rule.parse) {
    case 'srcset':
      return { attr, values: parseSrcset(value) };
    case 'refresh': {
      const url = refreshUrl(value);
      return { attr, values: url ? [url] : [] };
    }
    case 'style':
      return { attr, values: cssUrls(value).map((found) => found.value) };
    default:
      return { attr, values: [value] };
  }
}

/** Absolute URLs in inline script text. JSON-escaped slashes are unescaped and trailing punctuation trimmed. */
export function scriptUrls(text: string): string[] {
  const unescaped = text.replace(/\\\//g, '/');
  const found: string[] = [];
  for (const match of unescaped.matchAll(/https?:\/\/[^\s"'`<>\\{}|^[\]]+/gi)) {
    const url = match[0].replace(/[.,;:!?)]+$/, '');
    if (url.length > 'https://'.length) found.push(url);
  }
  return found;
}

/** Every string in a JSON-LD block that looks like a URL, with the key it sat under. */
function jsonLdUrls(text: string): Array<{ key: string; value: string }> {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const found: Array<{ key: string; value: string }> = [];
  const walk = (node: unknown, key: string) => {
    if (typeof node === 'string') {
      if (/^(https?:)?\/\//i.test(node.trim())) found.push({ key, value: node });
    } else if (Array.isArray(node)) {
      for (const item of node) walk(item, key);
    } else if (node && typeof node === 'object') {
      for (const [childKey, value] of Object.entries(node)) {
        // "@context" names the vocabulary (https://schema.org), not something on the page.
        if (childKey !== '@context') walk(value, childKey);
      }
    }
  };
  walk(data, 'json');
  return found;
}

/**
 * Finds every URL in a parsed HTML document.
 *
 * @param doc     A Document, e.g. from `new DOMParser().parseFromString(html, 'text/html')`.
 * @param pageUrl The page's final URL after redirects. Scope is judged against it.
 */
export function extractUrls(
  doc: Document,
  pageUrl: string,
  options: Partial<ExtractOptions> = {},
): ExtractResult {
  const opts: ExtractOptions = { ...DEFAULT_EXTRACT_OPTIONS, ...options };
  const page = new URL(pageUrl);
  const baseUrl = documentBase(doc, page.href);
  const urls: ExtractedUrl[] = [];
  let strippedParams = 0;

  const add = (raw: string, source: UrlSource, kindRule: KindRule, element: Element) => {
    const resolved = resolveUrl(raw, baseUrl);
    if (!resolved) return;

    const kind =
      resolved.protocol === 'mailto:'
        ? 'email'
        : resolved.protocol === 'tel:'
          ? 'phone'
          : typeof kindRule === 'function'
            ? kindRule(element, resolved)
            : kindRule;
    const scope = getScope(resolved, page);
    const { href, stripped } = finaliseUrl(resolved, opts);
    strippedParams += stripped;
    urls.push({ url: href, raw: raw.trim(), scope, kind, source, count: 1, ...describe(element) });
  };

  // Let the selector engine find each rule's elements, then walk the document once so results
  // come out in page order.
  const rulesByElement = new Map<Element, SourceRule[]>();
  for (const rule of SOURCE_RULES) {
    for (const element of doc.querySelectorAll(rule.selector)) {
      if (rule.when && !rule.when(element)) continue;
      const list = rulesByElement.get(element);
      if (list) list.push(rule);
      else rulesByElement.set(element, [rule]);
    }
  }

  const byExtensionOr =
    (fallback: ExtractedUrl['kind']): KindRule =>
    (_el, url) =>
      kindFromExtension(url) ?? fallback;

  for (const element of doc.querySelectorAll('*')) {
    const tag = element.tagName.toLowerCase();

    if (tag === 'style') {
      for (const { value, via } of cssUrls(element.textContent ?? '')) {
        add(
          value,
          { tag: 'style', attr: via },
          via === '@import' ? 'stylesheet' : byExtensionOr('image'),
          element,
        );
      }
    } else if (tag === 'script' && !element.hasAttribute('src')) {
      const type = (element.getAttribute('type') ?? '').trim().toLowerCase();
      if (type === 'application/ld+json') {
        if (opts.jsonLd) {
          for (const { key, value } of jsonLdUrls(element.textContent ?? '')) {
            add(value, { tag: 'script[ld+json]', attr: key }, byExtensionOr('page'), element);
          }
        }
      } else if (opts.deepScan) {
        for (const value of scriptUrls(element.textContent ?? '')) {
          add(value, { tag: 'script', attr: 'text' }, byExtensionOr('other'), element);
        }
      }
    }

    for (const rule of rulesByElement.get(element) ?? []) {
      const label = typeof rule.tag === 'function' ? rule.tag(element) : (rule.tag ?? tag);
      const { attr, values } = readRule(rule, element);
      for (const value of values) add(value, { tag: label, attr }, rule.kind, element);
    }
  }

  return { pageUrl: page.href, baseUrl, urls, strippedParams };
}

/** Parses HTML with the browser's DOMParser (nothing is loaded or run) and extracts its URLs. */
export function extractFromHtml(
  html: string,
  pageUrl: string,
  options: Partial<ExtractOptions> = {},
): ExtractResult {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return extractUrls(doc, pageUrl, options);
}
