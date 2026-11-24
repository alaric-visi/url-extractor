import { describe, expect, it } from 'vitest';
import {
  dedupeKey,
  InputError,
  normalizeInput,
  resolveUrl,
  stripTrackingParams,
} from '../../src/core/normalize';
import { parseSrcset } from '../../src/core/srcset';

describe('normalizeInput (row 5)', () => {
  it.each([
    ['httpbin.org', 'https://httpbin.org/'],
    ['example.com/page?q=1', 'https://example.com/page?q=1'],
    ['http://example.com', 'http://example.com/'],
    ['  https://Example.COM/A  ', 'https://example.com/A'],
    ['//example.com/x', 'https://example.com/x'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeInput(input)).toBe(expected);
  });

  it.each(['', '   ', 'ftp://example.com', 'localhost', 'javascript:alert(1)', 'mailto:a@b.com', 'http://'])(
    'rejects %j',
    (input) => {
      expect(() => normalizeInput(input)).toThrow(InputError);
    },
  );
});

describe('resolveUrl', () => {
  const base = 'https://www.example.com/a/b/';

  it.each([
    '#top',
    'JAVASCRIPT:alert(1)',
    'data:image/png;base64,AAAA',
    'blob:https://x/1',
    'ftp://example.com/file',
    '',
  ])('skips %j', (raw) => {
    expect(resolveUrl(raw, base)).toBeNull();
  });

  it('resolves relative paths and trims whitespace', () => {
    expect(resolveUrl('  ../c  ', base)?.href).toBe('https://www.example.com/a/c');
  });

  it('keeps mailto: and tel:', () => {
    expect(resolveUrl('mailto:hi@example.com', base)?.protocol).toBe('mailto:');
    expect(resolveUrl('tel:+44123', base)?.protocol).toBe('tel:');
  });
});

describe('stripTrackingParams (row 8)', () => {
  const strip = (href: string) => {
    const url = new URL(href);
    const removed = stripTrackingParams(url);
    return { href: url.href, removed };
  };

  it('removes every utm_ parameter, not every other one', () => {
    expect(strip('https://x.com/?utm_source=a&utm_medium=b&utm_campaign=c&id=1')).toEqual({
      href: 'https://x.com/?id=1',
      removed: 3,
    });
  });

  it('leaves look-alikes alone', () => {
    expect(strip('https://x.com/?reference=1&sourceId=2&refresh=3')).toEqual({
      href: 'https://x.com/?reference=1&sourceId=2&refresh=3',
      removed: 0,
    });
  });

  it('matches click IDs case-insensitively and counts repeats', () => {
    expect(strip('https://x.com/p?UTM_Campaign=x&fbclid=y&gclid=z&utm_source=a&utm_source=b')).toEqual({
      href: 'https://x.com/p',
      removed: 5,
    });
  });
});

describe('dedupeKey (row 9)', () => {
  it('only merges trailing slashes when asked', () => {
    expect(dedupeKey('https://x.com/docs/', false)).toBe('https://x.com/docs/');
    expect(dedupeKey('https://x.com/docs/', true)).toBe('https://x.com/docs');
    expect(dedupeKey('https://x.com/', true)).toBe('https://x.com/');
  });
});

describe('parseSrcset (row 7)', () => {
  it.each([
    ['a.jpg 1x, b.jpg 2x, c.jpg 3x', ['a.jpg', 'b.jpg', 'c.jpg']],
    ['a.jpg 100w, b.jpg 200w', ['a.jpg', 'b.jpg']],
    ['img,with,commas.jpg 1x, other.jpg 2x', ['img,with,commas.jpg', 'other.jpg']],
    ['  a.jpg ,b.jpg  ', ['a.jpg', 'b.jpg']],
    ['a.jpg, b.jpg', ['a.jpg', 'b.jpg']],
    ['data:image/png;base64,AAA= 1x, real.png 2x', ['data:image/png;base64,AAA=', 'real.png']],
    ['', []],
  ])('%j', (input, expected) => {
    expect(parseSrcset(input)).toEqual(expected);
  });
});
