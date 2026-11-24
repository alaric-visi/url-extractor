// @vitest-environment node
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  fetchPage,
  handleProxyRequest,
  isPublicAddress,
  ProxyError,
  successHeaders,
  validateTarget,
} from '../../netlify/lib/page-proxy';

let server: http.Server;
let origin = '';
let port = '';

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const { pathname } = new URL(req.url ?? '/', 'http://local');
    switch (pathname) {
      case '/page':
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end('<html><body><a href="/a">A</a></body></html>');
        return;
      case '/redirect':
        res.writeHead(301, { location: '/page' });
        res.end();
        return;
      case '/to-metadata':
        res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' });
        res.end();
        return;
      case '/to-private':
        res.writeHead(302, { location: 'http://10.0.0.1/' });
        res.end();
        return;
      case '/loop':
        res.writeHead(302, { location: '/loop' });
        res.end();
        return;
      case '/pdf':
        res.writeHead(200, { 'content-type': 'application/pdf' });
        res.end('%PDF-1.4');
        return;
      case '/big':
        res.writeHead(200, { 'content-type': 'text/html' });
        res.end('x'.repeat(50_000));
        return;
      case '/gzip':
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
        res.end(zlib.gzipSync('<p>compressed</p>'));
        return;
      default:
        res.writeHead(404, { 'content-type': 'text/html' });
        res.end('<h1>Not found</h1>');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = String((server.address() as AddressInfo).port);
  origin = `http://127.0.0.1:${port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

/** Production policy plus the local test server, and nothing else private. */
const localPolicy = () => ({
  isAddressAllowed: (ip: string) => ip === '127.0.0.1' || isPublicAddress(ip),
  allowedPorts: ['', '80', '443', port],
});

function errorCode(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return error instanceof ProxyError ? error.code : 'not-a-proxy-error';
  }
  return undefined;
}

async function rejectionCode(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof ProxyError ? error.code : 'not-a-proxy-error';
  }
  return undefined;
}

describe('isPublicAddress', () => {
  it.each([
    ['127.0.0.1', false],
    ['10.1.2.3', false],
    ['172.16.0.1', false],
    ['192.168.1.1', false],
    ['169.254.169.254', false],
    ['100.64.0.1', false],
    ['::1', false],
    ['fe80::1', false],
    ['fd00::1', false],
    ['::ffff:127.0.0.1', false],
    ['::ffff:7f00:1', false],
    ['8.8.8.8', true],
    ['1.1.1.1', true],
    ['2606:4700:4700::1111', true],
  ])('%s -> %s', (ip, expected) => {
    expect(isPublicAddress(ip)).toBe(expected);
  });
});

describe('validateTarget', () => {
  it.each([
    'http://127.0.0.1/',
    'http://[::1]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://[::ffff:127.0.0.1]/',
    'http://localhost/',
    'http://intranet/',
    'http://printer.local/',
  ])('blocks %s', (url) => {
    expect(errorCode(() => validateTarget(url))).toBe('blocked_address');
  });

  it.each(['ftp://example.com/', 'http://user:pass@example.com/', 'http://example.com:8080/', 'not a url'])(
    'rejects %s as invalid',
    (url) => {
      expect(errorCode(() => validateTarget(url))).toBe('invalid_url');
    },
  );

  it('accepts a public https URL', () => {
    expect(validateTarget('https://example.com/path').href).toBe('https://example.com/path');
  });
});

describe('fetchPage', () => {
  it('returns the page once, as html', async () => {
    const page = await fetchPage(`${origin}/page`, localPolicy());
    expect(page.status).toBe(200);
    expect(page.finalUrl).toBe(`${origin}/page`);
    expect(page.html).toContain('<a href="/a">');
    expect('body' in page).toBe(false);
  });

  it('follows redirects and reports the final URL', async () => {
    const page = await fetchPage(`${origin}/redirect`, localPolicy());
    expect(page.finalUrl).toBe(`${origin}/page`);
    expect(page.redirects).toEqual([{ url: `${origin}/redirect`, status: 301 }]);
  });

  it('refuses a redirect to the cloud metadata address', async () => {
    expect(await rejectionCode(fetchPage(`${origin}/to-metadata`, localPolicy()))).toBe('blocked_address');
  });

  it('refuses a redirect to a private network', async () => {
    expect(await rejectionCode(fetchPage(`${origin}/to-private`, localPolicy()))).toBe('blocked_address');
  });

  it('stops redirect loops', async () => {
    expect(await rejectionCode(fetchPage(`${origin}/loop`, localPolicy()))).toBe('too_many_redirects');
  });

  it('refuses non-text content such as PDFs', async () => {
    expect(await rejectionCode(fetchPage(`${origin}/pdf`, localPolicy()))).toBe('unsupported_content');
  });

  it('truncates bodies over the size cap', async () => {
    const page = await fetchPage(`${origin}/big`, { ...localPolicy(), maxBytes: 1000 });
    expect(page.truncated).toBe(true);
    expect(page.html).toHaveLength(1000);
  });

  it('decompresses gzip responses', async () => {
    const page = await fetchPage(`${origin}/gzip`, localPolicy());
    expect(page.html).toBe('<p>compressed</p>');
  });

  it('returns upstream 404 pages rather than failing', async () => {
    const page = await fetchPage(`${origin}/missing`, localPolicy());
    expect(page.status).toBe(404);
    expect(page.html).toContain('Not found');
  });
});

describe('handleProxyRequest', () => {
  const endpoint = (target: string) => `http://localhost/api/fetch-page?url=${encodeURIComponent(target)}`;

  it('only allows GET', async () => {
    const res = await handleProxyRequest(new Request(endpoint('https://example.com/'), { method: 'POST' }));
    expect(res.status).toBe(405);
  });

  it('refuses cross-site browser requests', async () => {
    const req = new Request(endpoint('https://example.com/'), {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    const res = await handleProxyRequest(req);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('forbidden');
  });

  it('needs a url parameter', async () => {
    const res = await handleProxyRequest(new Request('http://localhost/api/fetch-page'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('invalid_url');
  });

  it('refuses private targets with the production policy', async () => {
    const res = await handleProxyRequest(new Request(endpoint('http://127.0.0.1/')));
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe('blocked_address');
  });

  it('returns JSON with html and no CORS headers', async () => {
    const req = new Request(endpoint(`${origin}/page`), { headers: { 'sec-fetch-site': 'same-origin' } });
    const res = await handleProxyRequest(req, localPolicy());
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.html).toContain('<a href="/a">');
    expect(body).not.toHaveProperty('body');
  });
});

describe('successHeaders', () => {
  it('caches at the CDN for 5 minutes by default, keyed on url and ua', () => {
    const headers = successHeaders({});
    expect(headers['Netlify-CDN-Cache-Control']).toBe('public, max-age=300');
    expect(headers['Netlify-Vary']).toBe('query=url|ua');
    expect(headers['Cache-Control']).toBe('public, max-age=0, must-revalidate');
  });

  it('uses CDN_CACHE_SECONDS when set', () => {
    expect(successHeaders({ CDN_CACHE_SECONDS: '120' })['Netlify-CDN-Cache-Control']).toBe(
      'public, max-age=120',
    );
  });

  it.each(['0', 'soon', '-5'])('turns caching off for CDN_CACHE_SECONDS=%j', (value) => {
    const headers = successHeaders({ CDN_CACHE_SECONDS: value });
    expect(headers['Cache-Control']).toBe('no-store');
    expect(headers['Netlify-CDN-Cache-Control']).toBeUndefined();
    expect(headers['Netlify-Vary']).toBeUndefined();
  });
});

describe('error responses', () => {
  it('are never cached', async () => {
    const res = await handleProxyRequest(new Request('http://localhost/api/fetch-page'));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('netlify-cdn-cache-control')).toBeNull();
  });
});
