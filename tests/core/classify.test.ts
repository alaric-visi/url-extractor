import { describe, expect, it } from 'vitest';
import { getScope, hostOf, kindFromExtension } from '../../src/core/classify';

describe('getScope (row 12)', () => {
  const scope = (url: string, page: string) => getScope(new URL(url), new URL(page));

  it.each([
    ['https://www.example.com/a', 'https://www.example.com/', 'internal'],
    ['https://example.com/a', 'https://www.example.com/', 'subdomain'],
    ['https://shop.example.co.uk/', 'https://www.example.co.uk/', 'subdomain'],
    ['https://other.co.uk/', 'https://www.example.co.uk/', 'external'],
    ['https://example.org/', 'https://www.example.com/', 'external'],
    ['http://10.0.0.2/', 'http://10.0.0.1/', 'external'],
    ['http://10.0.0.1/x', 'http://10.0.0.1/', 'internal'],
    ['mailto:team@example.com', 'https://www.example.com/', 'internal'],
    ['mailto:someone@gmail.com', 'https://www.example.com/', 'external'],
    ['tel:+44123', 'https://www.example.com/', 'internal'],
  ])('%s on %s is %s', (url, page, expected) => {
    expect(scope(url, page)).toBe(expected);
  });
});

describe('kindFromExtension', () => {
  it.each([
    ['https://x.com/a.JPG', 'image'],
    ['https://x.com/a.css?v=2', 'stylesheet'],
    ['https://x.com/a.mjs', 'script'],
    ['https://x.com/a.woff2', 'font'],
    ['https://x.com/a.mp4', 'media'],
    ['https://x.com/a.pdf', 'document'],
    ['https://x.com/page', undefined],
  ])('%s -> %s', (url, expected) => {
    expect(kindFromExtension(new URL(url))).toBe(expected);
  });
});

describe('hostOf', () => {
  it('reads hostnames and email domains', () => {
    expect(hostOf('https://WWW.Example.com/a')).toBe('www.example.com');
    expect(hostOf('mailto:Team@Example.com?subject=hi')).toBe('example.com');
    expect(hostOf('tel:+44123')).toBe('');
    expect(hostOf('not a url')).toBe('');
  });
});
