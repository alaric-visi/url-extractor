import { describe, expect, it } from 'vitest';
import {
  applyFilters,
  DEFAULT_FILTERS,
  dedupe,
  exportFilename,
  groupByHost,
  summarise,
  toCsv,
  toJson,
  toMarkdown,
  toText,
  type ExtractedUrl,
  type FilterState,
} from '../../src/core';

const item = (url: string, extra: Partial<ExtractedUrl> = {}): ExtractedUrl => ({
  url,
  raw: url,
  scope: 'internal',
  kind: 'page',
  source: { tag: 'a', attr: 'href' },
  count: 1,
  ...extra,
});

const urls: ExtractedUrl[] = [
  item('https://www.example.com/docs/', { text: 'Docs' }),
  item('https://www.example.com/docs'),
  item('https://shop.example.com/', { scope: 'subdomain', text: 'Shop' }),
  item('https://www.example.com/logo.png', { kind: 'image' }),
  item('https://partner.org/', { scope: 'external', text: 'Partner' }),
  item('https://www.example.com/docs/'),
];

const filters = (patch: Partial<FilterState>): FilterState => ({ ...DEFAULT_FILTERS, ...patch });
const urlsOf = (state: Partial<FilterState>) => applyFilters(urls, filters(state)).items.map((i) => i.url);

describe('dedupe', () => {
  it('sums counts and keeps the first text', () => {
    const unique = dedupe(urls);
    expect(unique).toHaveLength(5);
    expect(unique[0]).toMatchObject({ url: 'https://www.example.com/docs/', count: 2, text: 'Docs' });
  });

  it('merges trailing slashes only when asked (row 9)', () => {
    expect(dedupe(urls, true)[0]?.count).toBe(3);
  });

  it('does not change the input', () => {
    dedupe(urls);
    expect(urls[0]?.count).toBe(1);
  });
});

describe('applyFilters', () => {
  it('shows every occurrence when unique is off', () => {
    expect(urlsOf({ unique: false })).toHaveLength(6);
  });

  it('matches address or text, case-insensitively', () => {
    expect(urlsOf({ text: 'PARTNER' })).toEqual(['https://partner.org/']);
    expect(urlsOf({ text: 'shop' })).toEqual(['https://shop.example.com/']);
  });

  it('excludes matches', () => {
    expect(urlsOf({ exclude: 'example.com' })).toEqual(['https://partner.org/']);
  });

  it('supports regular expressions and reports bad ones without filtering', () => {
    expect(urlsOf({ text: '\\.png$', regex: true })).toEqual(['https://www.example.com/logo.png']);
    const outcome = applyFilters(urls, filters({ text: '(', regex: true }));
    expect(outcome.error).toMatch(/Invalid regular expression/);
    expect(outcome.items).toHaveLength(5);
  });

  it('filters by kind, scope and domain', () => {
    expect(urlsOf({ kinds: ['image'] })).toEqual(['https://www.example.com/logo.png']);
    expect(urlsOf({ scopes: ['subdomain', 'external'] })).toEqual([
      'https://shop.example.com/',
      'https://partner.org/',
    ]);
    expect(urlsOf({ domain: 'shop.example.com' })).toEqual(['https://shop.example.com/']);
  });

  it('sorts stably in both directions', () => {
    expect(urlsOf({ sort: { key: 'url', dir: 'asc' } })[0]).toBe('https://partner.org/');
    expect(urlsOf({ sort: { key: 'url', dir: 'desc' } })[0]).toBe('https://www.example.com/logo.png');
    expect(urlsOf({ sort: { key: 'count', dir: 'desc' } })[0]).toBe('https://www.example.com/docs/');
    expect(urlsOf({ sort: { key: 'scope', dir: 'asc' } }).slice(-1)).toEqual(['https://shop.example.com/']);
  });
});

describe('groupByHost and summarise', () => {
  it('groups by host alphabetically', () => {
    expect(groupByHost(dedupe(urls)).map((g) => [g.host, g.items.length])).toEqual([
      ['partner.org', 1],
      ['shop.example.com', 1],
      ['www.example.com', 3],
    ]);
  });

  it('counts distinct URLs by scope and kind', () => {
    const summary = summarise(urls);
    expect(summary).toMatchObject({ total: 6, unique: 5 });
    expect(summary.byScope).toEqual({ internal: 3, subdomain: 1, external: 1 });
    expect(summary.byKind.image).toBe(1);
    expect(summary.byKind.page).toBe(4);
  });
});

describe('export', () => {
  const rows = [
    item('https://x.com/a', { text: 'Says "hi", then leaves', rel: ['nofollow'], newTab: true, count: 2 }),
    item('https://x.com/b|c', { text: '=HYPERLINK("http://evil")' }),
  ];

  it('writes CSV with quoting and formula protection', () => {
    const lines = toCsv(rows).trimEnd().split('\r\n');
    expect(lines[0]).toBe('url,kind,scope,source,text,rel,new_tab,count');
    expect(lines[1]).toBe('https://x.com/a,page,internal,a href,"Says ""hi"", then leaves",nofollow,yes,2');
    expect(lines[2]).toContain(`"'=HYPERLINK(""http://evil"")"`);
  });

  it('writes Markdown with escaped pipes', () => {
    expect(toMarkdown(rows)).toContain('| https://x.com/b\\|c | page | internal |');
  });

  it('writes JSON and plain text', () => {
    expect(JSON.parse(toJson(rows))).toHaveLength(2);
    expect(toText(rows)).toBe('https://x.com/a\nhttps://x.com/b|c\n');
    expect(toText([])).toBe('');
  });

  it('names files after the host', () => {
    expect(exportFilename('https://www.example.com/page', 'csv')).toBe('www.example.com-urls.csv');
    expect(exportFilename('https://www.example.com/page', 'markdown')).toBe('www.example.com-urls.md');
  });
});
