/**
 * Netlify Function: same-origin page fetcher for the URL Extractor.
 * GET /api/fetch-page?url=<target>  ->  JSON (see netlify/lib/page-proxy.ts for the contract).
 */
import type { Config } from '@netlify/functions';
import { handleProxyRequest } from '../lib/page-proxy';

export default (req: Request) => handleProxyRequest(req);

export const config: Config = {
  path: '/api/fetch-page',
  method: 'GET',
  // 60 fetches a minute per visitor. Netlify answers 429 above that; enforcement can lag by up to 10 s.
  rateLimit: { windowLimit: 60, windowSize: 60, aggregateBy: ['ip', 'domain'] },
};
