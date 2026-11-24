/** Everything the fetch endpoint reports about a page, apart from its HTML. */
export interface PageInfo {
  requestedUrl: string;
  finalUrl: string;
  status: number;
  statusText: string;
  contentType: string;
  redirects: Array<{ url: string; status: number }>;
  truncated: boolean;
  bytes: number;
}

export interface FetchedPage extends PageInfo {
  html: string;
}

export type FetchErrorCode =
  | 'invalid_url'
  | 'blocked_address'
  | 'too_many_redirects'
  | 'timeout'
  | 'unsupported_content'
  | 'upstream_error'
  | 'forbidden'
  | 'method_not_allowed'
  | 'rate_limited'
  | 'no_endpoint'
  | 'network'
  | 'cancelled';

export class FetchPageError extends Error {
  constructor(
    readonly code: FetchErrorCode | (string & {}),
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'FetchPageError';
  }
}

export const DEFAULT_ENDPOINT = '/api/fetch-page';

export interface FetchPageOptions {
  /** Same-origin endpoint that returns the page as JSON. Default `/api/fetch-page`. */
  endpoint?: string;
  signal?: AbortSignal;
  /** Client-side limit; a little above the function's own 15 s deadline. */
  timeoutMs?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Asks the fetch endpoint for a page. Throws FetchPageError with a code and a message for people. */
export async function fetchPage(url: string, options: FetchPageOptions = {}): Promise<FetchedPage> {
  const { endpoint = DEFAULT_ENDPOINT, signal, timeoutMs = 20_000 } = options;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const forwardAbort = () => controller.abort();
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', forwardAbort, { once: true });

  const requestUrl = `${endpoint}${endpoint.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`;

  try {
    const res = await fetch(requestUrl, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (res.status === 429) {
      throw new FetchPageError('rate_limited', 'Too many requests. Wait a minute, then try again.', 429);
    }

    let body: unknown;
    try {
      body = await res.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new FetchPageError(
        'no_endpoint',
        `The fetch endpoint (${endpoint}) didn't answer with JSON. Check that the Netlify Function is deployed, or run the app with netlify dev.`,
        res.status,
      );
    }
    if (!isRecord(body)) {
      throw new FetchPageError(
        'no_endpoint',
        'The fetch endpoint answered in an unexpected format.',
        res.status,
      );
    }
    if (!res.ok || body.ok !== true) {
      const error = isRecord(body.error) ? body.error : {};
      const message =
        (typeof error.message === 'string' && error.message) ||
        (typeof body.message === 'string' && body.message) ||
        `The fetch failed (HTTP ${res.status}).`;
      throw new FetchPageError(
        typeof error.code === 'string' ? error.code : 'upstream_error',
        message,
        res.status,
      );
    }
    if (typeof body.html !== 'string' || typeof body.finalUrl !== 'string') {
      throw new FetchPageError(
        'no_endpoint',
        'The fetch endpoint answered in an unexpected format.',
        res.status,
      );
    }

    return {
      requestedUrl: typeof body.requestedUrl === 'string' ? body.requestedUrl : url,
      finalUrl: body.finalUrl,
      status: typeof body.status === 'number' ? body.status : 200,
      statusText: typeof body.statusText === 'string' ? body.statusText : '',
      contentType: typeof body.contentType === 'string' ? body.contentType : '',
      redirects: Array.isArray(body.redirects) ? (body.redirects as PageInfo['redirects']) : [],
      truncated: body.truncated === true,
      bytes: typeof body.bytes === 'number' ? body.bytes : body.html.length,
      html: body.html,
    };
  } catch (error) {
    if (error instanceof FetchPageError) throw error;
    if (controller.signal.aborted) {
      throw timedOut
        ? new FetchPageError('timeout', `No answer after ${Math.round(timeoutMs / 1000)} seconds. Try again.`)
        : new FetchPageError('cancelled', 'Cancelled.');
    }
    throw new FetchPageError(
      'network',
      "Couldn't reach the fetch endpoint. Check your connection and try again.",
    );
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forwardAbort);
  }
}
