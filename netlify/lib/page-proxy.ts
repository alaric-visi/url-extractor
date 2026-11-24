/**
 * Server-side page fetcher for the URL Extractor (runs in a Netlify Function, Node 18+).
 *
 * Adapted from the fetcher behind /api/fetch-page on mikehiggins.me.uk. Changes from that copy:
 *  - the page text is returned once, as `html` (no duplicate `body`), so larger pages fit in the
 *    6 MB response limit;
 *  - successful fetches are cached on Netlify's CDN for 5 minutes (CDN_CACHE_SECONDS changes it;
 *    0 turns it off).
 *
 * Security model
 *  - SSRF: only http/https on ports 80/443; every hostname is resolved and checked against private,
 *    loopback, link-local and reserved ranges *at connect time* (custom DNS lookup), so DNS rebinding
 *    can't slip a private address in after validation. Every redirect hop is re-validated.
 *  - Abuse as an open proxy: GET only, text content types only, decompressed size cap, overall
 *    deadline, no CORS headers (so other websites can't read responses from a browser), cross-site
 *    browser requests rejected, and a Netlify rate limit on the function itself.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';
import type { Readable } from 'node:stream';

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

export type UserAgentChoice = 'browser' | 'googlebot';

export interface ProxyRedirect {
    url: string;
    status: number;
}

/** JSON body returned for a successful fetch (any upstream status, including 404). */
export interface ProxyPage {
    ok: boolean;
    requestedUrl: string;
    finalUrl: string;
    status: number;
    statusText: string;
    contentType: string;
    charset: string;
    redirects: ProxyRedirect[];
    headers: Record<string, string>;
    bytes: number;
    transferBytes: number;
    truncated: boolean;
    fetchedAs: UserAgentChoice;
    elapsedMs: number;
    timing: { ttfbMs: number; totalMs: number };
    html: string;
}

export type ProxyErrorCode =
    | 'invalid_url'
    | 'blocked_address'
    | 'too_many_redirects'
    | 'timeout'
    | 'unsupported_content'
    | 'upstream_error'
    | 'method_not_allowed'
    | 'forbidden';

export interface ProxyErrorBody {
    ok: false;
    error: { code: ProxyErrorCode; message: string };
    message: string;
}

export class ProxyError extends Error {
    constructor(
        readonly code: ProxyErrorCode,
        message: string,
        readonly httpStatus: number
    ) {
        super(message);
        this.name = 'ProxyError';
    }
}

export interface FetchPageOptions {
    userAgent?: UserAgentChoice;
    /** Overall budget for the request including redirects. Keep below the function's own limit. */
    timeoutMs?: number;
    maxRedirects?: number;
    /** Cap on the *decompressed* body, which also defuses compression bombs. */
    maxBytes?: number;
    /** Address policy. Tests can relax it; production always uses isPublicAddress. */
    isAddressAllowed?: (ip: string) => boolean;
    /** Allowed ports ('' means the scheme default). Tests can add a local port. */
    allowedPorts?: string[];
}

type TargetPolicy = Pick<Required<FetchPageOptions>, 'isAddressAllowed' | 'allowedPorts'>;
const DEFAULT_POLICY: TargetPolicy = { isAddressAllowed: isPublicAddress, allowedPorts: ['', '80', '443'] };

/* ------------------------------------------------------------------ */
/* Address policy                                                      */
/* ------------------------------------------------------------------ */

const BLOCKED_RANGES = new net.BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8], // "this" network
    ['10.0.0.0', 8], // private
    ['100.64.0.0', 10], // carrier-grade NAT
    ['127.0.0.0', 8], // loopback (incl. the Lambda runtime API)
    ['169.254.0.0', 16], // link-local, cloud metadata
    ['172.16.0.0', 12], // private
    ['192.0.0.0', 24], // IETF protocol assignments
    ['192.0.2.0', 24], // documentation
    ['192.88.99.0', 24], // 6to4 relay
    ['192.168.0.0', 16], // private
    ['198.18.0.0', 15], // benchmarking
    ['198.51.100.0', 24], // documentation
    ['203.0.113.0', 24], // documentation
    ['224.0.0.0', 4], // multicast
    ['240.0.0.0', 4], // reserved, broadcast
] as const) {
    BLOCKED_RANGES.addSubnet(address, prefix, 'ipv4');
}
for (const [address, prefix] of [
    ['::', 128], // unspecified
    ['::1', 128], // loopback
    ['64:ff9b::', 96], // NAT64 (can embed private IPv4)
    ['100::', 64], // discard
    ['2001::', 32], // Teredo
    ['2001:db8::', 32], // documentation
    ['2002::', 16], // 6to4 (can embed private IPv4)
    ['fc00::', 7], // unique local
    ['fe80::', 10], // link-local
    ['ff00::', 8], // multicast
] as const) {
    BLOCKED_RANGES.addSubnet(address, prefix, 'ipv6');
}

/** "::ffff:7f00:1" / "::ffff:127.0.0.1" → "127.0.0.1"; anything else → undefined. */
function mappedIPv4(ip: string): string | undefined {
    const m = /^::ffff:(.+)$/i.exec(ip);
    if (!m) return undefined;
    if (net.isIPv4(m[1])) return m[1];
    const hex = /^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(m[1]);
    if (!hex) return undefined;
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
}

export function isPublicAddress(ip: string): boolean {
    const bare = ip.replace(/^\[|\]$/g, '');
    const v4 = net.isIPv4(bare) ? bare : mappedIPv4(bare);
    if (v4) return !BLOCKED_RANGES.check(v4, 'ipv4');
    if (net.isIPv6(bare)) return !BLOCKED_RANGES.check(bare, 'ipv6');
    return false; // not an IP address at all
}

/** Validates a URL before any network activity. Throws ProxyError. */
export function validateTarget(raw: string, policy: TargetPolicy = DEFAULT_POLICY): URL {
    let url: URL;
    try {
        url = new URL(raw);
    } catch {
        throw new ProxyError('invalid_url', "That isn't a valid URL.", 400);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ProxyError('invalid_url', 'Only http and https URLs can be fetched.', 400);
    }
    if (url.username || url.password) {
        throw new ProxyError('invalid_url', "URLs with embedded credentials aren't allowed.", 400);
    }
    if (!policy.allowedPorts.includes(url.port)) {
        throw new ProxyError('invalid_url', 'Only the standard web ports (80 and 443) are allowed.', 400);
    }
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (net.isIP(host)) {
        // Node skips DNS lookup for IP literals, so they must be checked here.
        if (!policy.isAddressAllowed(host)) throw blockedError();
    } else if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || !host.includes('.')) {
        throw blockedError();
    }
    return url;
}

function blockedError(): ProxyError {
    return new ProxyError('blocked_address', 'That address points to a private or reserved network and is blocked.', 403);
}

/** DNS lookup that refuses to connect to disallowed addresses (checked at connect time). */
export function guardedLookup(isAddressAllowed: (ip: string) => boolean = isPublicAddress): net.LookupFunction {
    return (hostname, options, callback) => {
        dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
            if (error) return callback(error, '', 0);
            const list = addresses as unknown as dns.LookupAddress[];
            if (!list.length || list.some((a) => !isAddressAllowed(a.address))) {
                return callback(blockedError() as unknown as NodeJS.ErrnoException, '', 0);
            }
            if (options.all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
            callback(null, list[0].address, list[0].family);
        });
    };
}

/* ------------------------------------------------------------------ */
/* Fetching                                                            */
/* ------------------------------------------------------------------ */

export const USER_AGENTS: Record<UserAgentChoice, string> = {
    browser: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36',
    googlebot:
        'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
};

const TEXT_CONTENT = /^(text\/|application\/(xhtml\+xml|xml|javascript|x-javascript|ecmascript|json|ld\+json)\b)/i;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

const PASSED_HEADERS = [
    'content-type',
    'content-encoding',
    'content-language',
    'content-length',
    'cache-control',
    'last-modified',
    'etag',
    'x-robots-tag',
    'link',
    'strict-transport-security',
    'server',
    'vary',
    'age',
];

function pickHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
    const out: Record<string, string> = {};
    for (const key of PASSED_HEADERS) {
        const val = headers[key];
        if (val !== undefined) {
            out[key] = Array.isArray(val) ? val.join(', ') : String(val);
        }
    }
    return out;
}

interface RawResponse {
    status: number;
    statusText: string;
    headers: http.IncomingHttpHeaders;
    body: Buffer;
    transferBytes: number;
    ttfbMs: number;
    truncated: boolean;
}

function requestOnce(url: URL, options: Required<FetchPageOptions>, signal: AbortSignal): Promise<RawResponse> {
    return new Promise((resolve, reject) => {
        const started = Date.now();
        const lib = url.protocol === 'https:' ? https : http;
        const req = lib.request(url, {
            method: 'GET',
            agent: false,
            signal,
            lookup: guardedLookup(options.isAddressAllowed),
            headers: {
                'User-Agent': USER_AGENTS[options.userAgent],
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept-Encoding': 'gzip, deflate, br',
            },
        });

        req.on('error', (error) => reject(error));
        req.on('response', (res) => {
            const ttfbMs = Date.now() - started;
            const status = res.statusCode ?? 0;
            const statusText = res.statusMessage ?? (http.STATUS_CODES[status] || '');
            let transferBytes = 0;
            res.on('data', (chunk: Buffer) => {
                transferBytes += chunk.length;
            });

            if (REDIRECT_STATUSES.has(status) && res.headers.location) {
                res.resume();
                return resolve({ status, statusText, headers: res.headers, body: Buffer.alloc(0), transferBytes: 0, ttfbMs, truncated: false });
            }
            const contentType = String(res.headers['content-type'] ?? '');
            if (contentType && !TEXT_CONTENT.test(contentType)) {
                res.destroy();
                return reject(new ProxyError('unsupported_content', `The URL returned ${contentType.split(';')[0]}, not a web page.`, 415));
            }

            let stream: Readable = res;
            const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
            if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
            else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
            else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());

            const chunks: Buffer[] = [];
            let size = 0;
            let truncated = false;
            stream.on('data', (chunk: Buffer) => {
                if (truncated) return;
                const room = options.maxBytes - size;
                if (chunk.length > room) {
                    chunks.push(chunk.subarray(0, room));
                    size += room;
                    truncated = true;
                    res.destroy();
                    finish();
                    return;
                }
                chunks.push(chunk);
                size += chunk.length;
            });
            let done = false;
            const finish = () => {
                if (done) return;
                done = true;
                resolve({ status, statusText, headers: res.headers, body: Buffer.concat(chunks), transferBytes, ttfbMs, truncated });
            };
            stream.on('end', finish);
            stream.on('error', (error) => (truncated ? finish() : reject(error)));
        });
        req.end();
    });
}

/** Decodes using the declared charset, then <meta charset>, then a BOM, defaulting to UTF-8. */
export function decodeBody(body: Buffer, contentType: string): { text: string; charset: string } {
    let charset = /charset=["']?([\w.:-]+)/i.exec(contentType)?.[1];
    if (body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) charset = 'utf-8';
    else if (body[0] === 0xff && body[1] === 0xfe) charset = 'utf-16le';
    else if (body[0] === 0xfe && body[1] === 0xff) charset = 'utf-16be';
    if (!charset) {
        const head = body.subarray(0, 4096).toString('latin1');
        charset =
            /<meta[^>]+charset\s*=\s*["']?([\w.:-]+)/i.exec(head)?.[1] ??
            /<meta[^>]+content\s*=\s*["'][^"']*charset=([\w.:-]+)/i.exec(head)?.[1];
    }
    let decoder: TextDecoder;
    try {
        decoder = new TextDecoder(charset ?? 'utf-8');
    } catch {
        decoder = new TextDecoder('utf-8');
        charset = 'utf-8';
    }
    return { text: decoder.decode(body), charset: (charset ?? 'utf-8').toLowerCase() };
}

export async function fetchPage(rawUrl: string, opts: FetchPageOptions = {}): Promise<ProxyPage> {
    const options: Required<FetchPageOptions> = {
        userAgent: opts.userAgent ?? 'browser',
        timeoutMs: opts.timeoutMs ?? 15_000,
        maxRedirects: opts.maxRedirects ?? 5,
        maxBytes: opts.maxBytes ?? 4 * 1024 * 1024,
        isAddressAllowed: opts.isAddressAllowed ?? DEFAULT_POLICY.isAddressAllowed,
        allowedPorts: opts.allowedPorts ?? DEFAULT_POLICY.allowedPorts,
    };
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    const redirects: ProxyRedirect[] = [];

    try {
        let url = validateTarget(rawUrl, options);
        for (;;) {
            let res: RawResponse;
            try {
                res = await requestOnce(url, options, controller.signal);
            } catch (error) {
                if (error instanceof ProxyError) throw error;
                if (controller.signal.aborted) {
                    throw new ProxyError('timeout', `The site didn't respond within ${Math.round(options.timeoutMs / 1000)} seconds.`, 504);
                }
                const code = (error as NodeJS.ErrnoException).code;
                const reason =
                    code === 'ENOTFOUND' ? "the domain doesn't exist"
                    : code === 'ECONNREFUSED' ? 'the connection was refused'
                    : code === 'ECONNRESET' ? 'the connection was reset'
                    : code?.startsWith('ERR_TLS') || code?.includes('CERT') ? 'its TLS certificate is invalid'
                    : (error as Error).message;
                throw new ProxyError('upstream_error', `Couldn't reach the site: ${reason}.`, 502);
            }

            if (REDIRECT_STATUSES.has(res.status) && res.headers.location) {
                redirects.push({ url: url.href, status: res.status });
                if (redirects.length > options.maxRedirects) {
                    throw new ProxyError('too_many_redirects', `Stopped after ${options.maxRedirects} redirects.`, 508);
                }
                url = validateTarget(new URL(res.headers.location, url).href, options);
                continue;
            }

            const contentType = String(res.headers['content-type'] ?? '');
            const { text, charset } = decodeBody(res.body, contentType);
            return {
                ok: true,
                requestedUrl: rawUrl,
                finalUrl: url.href,
                status: res.status,
                statusText: res.statusText,
                contentType,
                charset,
                redirects,
                headers: pickHeaders(res.headers),
                bytes: res.body.length,
                transferBytes: res.transferBytes,
                truncated: res.truncated,
                fetchedAs: options.userAgent,
                elapsedMs: Date.now() - started,
                timing: { ttfbMs: res.ttfbMs, totalMs: Date.now() - started },
                html: text,
            };
        }
    } finally {
        clearTimeout(timer);
    }
}

/* ------------------------------------------------------------------ */
/* HTTP handler                                                        */
/* ------------------------------------------------------------------ */

// Netlify's buffered response limit is 6 MB; leave headroom for JSON escaping.
const MAX_RESPONSE_BYTES = 5.5 * 1024 * 1024;

/** How long Netlify's CDN keeps a successful fetch, unless CDN_CACHE_SECONDS says otherwise. */
export const DEFAULT_CDN_CACHE_SECONDS = 300;

/**
 * Headers for a successful fetch. Netlify's CDN caches it for CDN_CACHE_SECONDS (default 300; 0 or an
 * invalid value turns caching off), so repeat fetches of the same page skip the function. Browsers always
 * revalidate. The cache key is only the `url` and `ua` parameters, so other query parameters on the
 * request don't split it. Errors are never cached.
 * `netlify dev` doesn't emulate the CDN cache; check the Cache-Status header on a deployed URL.
 */
export function successHeaders(env: Record<string, string | undefined> = process.env): Record<string, string> {
    const headers: Record<string, string> = {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
    };
    const configured = env.CDN_CACHE_SECONDS?.trim();
    const seconds = configured ? Math.floor(Number(configured)) : DEFAULT_CDN_CACHE_SECONDS;
    if (Number.isFinite(seconds) && seconds > 0) {
        headers['Cache-Control'] = 'public, max-age=0, must-revalidate';
        headers['Netlify-CDN-Cache-Control'] = `public, max-age=${seconds}`;
        headers['Netlify-Vary'] = 'query=url|ua';
    }
    return headers;
}

function json(body: unknown, status: number): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        },
    });
}

function errorResponse(code: ProxyErrorCode, message: string, status: number): Response {
    const body: ProxyErrorBody = { ok: false, error: { code, message }, message };
    return json(body, status);
}

/** GET ?url=<target>&ua=browser|googlebot  →  ProxyPage JSON, or ProxyErrorBody JSON. */
export async function handleProxyRequest(
    req: Request,
    opts: Pick<FetchPageOptions, 'isAddressAllowed' | 'allowedPorts' | 'timeoutMs' | 'maxBytes'> = {}
): Promise<Response> {
    if (req.method !== 'GET') return errorResponse('method_not_allowed', 'Use GET.', 405);

    // Browsers label cross-site requests; reject them so other websites can't drive this proxy.
    const site = req.headers.get('sec-fetch-site');
    if (site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') {
        return errorResponse('forbidden', 'Cross-site requests are not allowed.', 403);
    }

    const params = new URL(req.url).searchParams;
    const target = params.get('url');
    if (!target) return errorResponse('invalid_url', 'Add a ?url= parameter.', 400);
    const userAgent: UserAgentChoice = params.get('ua') === 'googlebot' ? 'googlebot' : 'browser';

    try {
        const page = await fetchPage(target, { ...opts, userAgent });
        let body = JSON.stringify(page);
        if (Buffer.byteLength(body) > MAX_RESPONSE_BYTES) {
            // Rare: heavy escaping pushed the JSON over the platform limit. Trim the page further.
            const ratio = MAX_RESPONSE_BYTES / Buffer.byteLength(body);
            const trimmed = page.html.slice(0, Math.floor(page.html.length * ratio * 0.95));
            body = JSON.stringify({ ...page, html: trimmed, truncated: true });
        }
        return new Response(body, { status: 200, headers: successHeaders() });
    } catch (error) {
        if (error instanceof ProxyError) return errorResponse(error.code, error.message, error.httpStatus);
        return errorResponse('upstream_error', 'The fetch failed unexpectedly.', 502);
    }
}
