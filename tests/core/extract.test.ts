import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractFromHtml, type ExtractOptions } from '../../src/core';

// Audit rows from the plan are noted beside the tests that cover them.
const PAGE = 'https://www.example.com/blog/post/';
const html = readFileSync(join(process.cwd(), 'tests/fixtures/kitchen-sink.html'), 'utf8');

function extract(options: Partial<ExtractOptions> = {}) {
  const result = extractFromHtml(html, PAGE, options);
  const find = (url: string) => result.urls.find((item) => item.url === url);
  const all = (url: string) => result.urls.filter((item) => item.url === url);
  return { result, find, all };
}

describe('extractUrls: resolving (rows 4 and 6)', () => {
  it('resolves relative links against the page, not the site root', () => {
    const { find } = extract();
    expect(find('https://www.example.com/blog/post/related/')).toMatchObject({
      kind: 'page',
      scope: 'internal',
      text: 'Related post',
      source: { tag: 'a', attr: 'href' },
    });
    expect(find('https://www.example.com/blog/other-post/')).toBeDefined();
    expect(find('https://www.example.com/blog/post/images/photo.jpg')).toMatchObject({
      kind: 'image',
      text: 'A photo',
    });
  });

  it('honours <base href>', () => {
    const result = extractFromHtml(
      '<base href="https://cdn.example.org/assets/"><a href="x.html">X</a>',
      'https://www.example.com/page',
    );
    expect(result.baseUrl).toBe('https://cdn.example.org/assets/');
    expect(result.urls[0]?.url).toBe('https://cdn.example.org/assets/x.html');
    expect(result.urls[0]?.scope).toBe('external');
  });

  it('judges scope against the final URL, treating www and other subdomains as one site', () => {
    const { find } = extract();
    expect(find('https://example.com/apex')?.scope).toBe('subdomain');
    expect(find('https://shop.example.com/')?.scope).toBe('subdomain');
    expect(find('https://cdn.example.com/og.png')?.scope).toBe('subdomain');
    expect(find('https://partner.org/')?.scope).toBe('external');
  });

  it('returns results in page order', () => {
    const { result } = extract();
    const index = (url: string) => result.urls.findIndex((item) => item.url === url);
    expect(index('https://www.example.com/assets/site.css')).toBeLessThan(
      index('https://www.example.com/blog/post/related/'),
    );
  });
});

describe('extractUrls: srcset (row 7)', () => {
  it('keeps every candidate, including URLs that contain commas', () => {
    const { result } = extract();
    const fromSrcset = result.urls.filter((item) => item.source.attr === 'srcset').map((item) => item.url);
    expect(fromSrcset).toEqual([
      'https://www.example.com/blog/post/images/photo-1x.jpg',
      'https://www.example.com/blog/post/images/photo,2x.jpg',
      'https://www.example.com/blog/post/images/photo-3x.jpg',
      'https://www.example.com/img/hero.avif',
    ]);
  });
});

describe('extractUrls: tracking parameters (row 8)', () => {
  it('strips utm_* and click IDs but keeps look-alike parameters', () => {
    const { result, find } = extract();
    expect(find('https://www.example.com/page?reference=7&sourceId=9&id=1')).toBeDefined();
    expect(result.strippedParams).toBe(2);
  });

  it('can leave URLs untouched', () => {
    const { result, find } = extract({ stripTracking: false });
    expect(
      find('https://www.example.com/page?utm_source=x&utm_medium=y&reference=7&sourceId=9&id=1'),
    ).toBeDefined();
    expect(result.strippedParams).toBe(0);
  });
});

describe('extractUrls: slashes, fragments and bad values (rows 9 and 10)', () => {
  it('keeps /docs and /docs/ apart', () => {
    const { find } = extract();
    expect(find('https://www.example.com/docs/')).toBeDefined();
    expect(find('https://www.example.com/docs')).toBeDefined();
  });

  it('drops fragments by default, and keeps them on request', () => {
    expect(extract().find('https://www.example.com/about')).toBeDefined();
    expect(extract({ keepFragments: true }).find('https://www.example.com/about#team')).toBeDefined();
  });

  it('skips same-page anchors, script URLs in any case, and values that do not parse', () => {
    const { result } = extract();
    const raws = result.urls.map((item) => item.raw);
    expect(raws).not.toContain('#comments');
    expect(raws).not.toContain('JavaScript:void(0)');
    expect(raws).not.toContain('http://[bad');
  });

  it('keeps mailto: and tel: links as email and phone', () => {
    const { find } = extract();
    expect(find('mailto:hello@example.com')).toMatchObject({ kind: 'email', scope: 'internal' });
    expect(find('tel:+441234567890')).toMatchObject({ kind: 'phone' });
  });
});

describe('extractUrls: kinds (row 11)', () => {
  it.each([
    ['https://www.example.com/assets/site.css', 'stylesheet', 'link[stylesheet]'],
    ['https://www.example.com/favicon.ico', 'image', 'link[icon]'],
    ['https://www.example.com/fonts/inter.woff2', 'font', 'link[preload]'],
    ['https://fonts.gstatic.com/', 'other', 'link[preconnect]'],
    ['https://www.googletagmanager.com/gtm.js?id=GTM-XXXX', 'script', 'script'],
    ['https://www.example.com/files/report.pdf', 'document', 'a'],
    ['https://www.example.com/img/hero.avif', 'image', 'source'],
    ['https://www.example.com/media/clip.mp4', 'media', 'video'],
    ['https://www.example.com/media/poster.jpg', 'image', 'video'],
    ['https://www.example.com/media/captions.vtt', 'media', 'track'],
    ['https://www.example.com/media/song.mp3', 'media', 'source'],
    ['https://www.youtube.com/embed/abc', 'frame', 'iframe'],
    ['https://www.example.com/search', 'form', 'form'],
    ['https://www.example.com/search/advanced', 'form', 'button'],
  ])('%s is %s from <%s>', (url, kind, tag) => {
    expect(extract().find(url)).toMatchObject({ kind, source: { tag } });
  });
});

describe('extractUrls: deep scan (row 13)', () => {
  it('is off by default', () => {
    expect(extract().find('https://api.example.com/v1/')).toBeUndefined();
  });

  it('finds absolute URLs in inline scripts, unescaping \\/ and labelling the source', () => {
    const { find } = extract({ deepScan: true });
    expect(find('https://api.example.com/v1/')).toMatchObject({ source: { tag: 'script', attr: 'text' } });
    expect(find('https://cdn.example.com/app.js')).toMatchObject({ kind: 'script' });
  });
});

describe('extractUrls: more sources and details (row 14)', () => {
  it.each([
    ['https://www.example.com/map-target', 'page', 'area', 'href'],
    ['https://www.example.com/sprite.svg', 'image', 'use', 'href'],
    ['https://cdn.example.com/og.png', 'image', 'meta[og:image]', 'content'],
    ['https://www.example.com/twitter-card.jpg', 'image', 'meta[twitter:image]', 'content'],
    ['https://www.example.com/blog/', 'page', 'meta[refresh]', 'content'],
    ['https://www.example.com/assets/print.css', 'stylesheet', 'style', '@import'],
    ['https://www.example.com/images/bg.webp', 'image', 'style', 'url()'],
    ['https://www.example.com/fonts/brand.woff2', 'font', 'style', 'url()'],
    ['https://www.example.com/images/banner.png', 'image', 'div', 'style'],
    ['https://www.example.com/lazy-link', 'page', 'div', 'data-href'],
    ['https://source.example.net/quote', 'page', 'blockquote', 'cite'],
    ['https://www.example.com/pixel.gif', 'image', 'img', 'src'],
  ])('%s (%s from %s %s)', (url, kind, tag, attr) => {
    expect(extract().find(url)).toMatchObject({ kind, source: { tag, attr } });
  });

  it('reads JSON-LD URLs with their keys, but not @context', () => {
    const { find } = extract();
    expect(find('https://www.example.com/images/hero.jpg')).toMatchObject({
      kind: 'image',
      source: { tag: 'script[ld+json]', attr: 'image' },
    });
    expect(find('https://www.example.com/logo.png')?.source.attr).toBe('url');
    expect(find('https://twitter.com/example')?.source.attr).toBe('sameAs');
    expect(find('https://schema.org/')).toBeUndefined();
    expect(extract({ jsonLd: false }).find('https://twitter.com/example')).toBeUndefined();
  });

  it('ignores meta tags that do not hold URLs', () => {
    const { result } = extract();
    expect(result.urls.some((item) => item.url.includes('not-a-link'))).toBe(false);
  });

  it('records rel and target', () => {
    expect(extract().find('https://partner.org/')).toMatchObject({
      rel: ['nofollow', 'sponsored'],
      newTab: true,
      text: 'Partner',
    });
  });

  it('lists repeats separately, each with a count of 1', () => {
    const repeats = extract().all('https://www.example.com/blog/post/related/');
    expect(repeats).toHaveLength(2);
    expect(repeats.every((item) => item.count === 1)).toBe(true);
  });
});
