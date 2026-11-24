# URL Extractor

Find every link, image, script, stylesheet and other URL on a web page, then filter, sort, copy or download them.

It is a React component plus a small, hardened Netlify Function that fetches pages for it, so no third-party CORS proxy sees what you check.

[![Deploy to Netlify](https://www.netlify.com/img/deploy/button.svg)](https://app.netlify.com/start/deploy?repository=https://github.com/YOUR-USERNAME/url-extractor)

> Replace `YOUR-USERNAME` in the button link once the repository is public. Netlify's button only works for public GitHub or GitLab repositories.

## What it does

- **Reads URLs from everywhere they hide:** links and image maps; images, `srcset`, `<picture>` sources and lazy-load `data-*` attributes; video, audio, tracks and posters; iframes; scripts, stylesheets, icons and preloads; forms and `formaction`; Open Graph and Twitter meta tags; meta refresh; inline `style` and `<style>` blocks (`url()` and `@import`); SVG `<use>`; `cite`; JSON-LD structured data; and, optionally, absolute URLs inside inline scripts.
- **Resolves them correctly:** against the page's final URL after redirects, honouring `<base href>`.
- **Labels each one:** its kind (page, image, script, CSS, font, media, document, frame, form, email, phone, other), its scope (internal, subdomain or external, using the Public Suffix List so `www.example.co.uk` and `shop.example.co.uk` count as one site), the element and attribute it came from, link text, `rel` values and `target="_blank"`.
- **Cleans them, if you want:** strips tracking parameters (`utm_*`, `fbclid`, `gclid` and similar) and `#fragments`; keeps trailing slashes as written.
- **Filters and sorts:** text and exclude filters (plain or regex), kind and scope chips, one domain, unique URLs with counts, sortable columns, grouping by domain.
- **Exports what you see:** copy, or download as CSV, JSON, Markdown or plain text.
- **Shares results:** the standalone app puts `?url=` in the address bar and fetches it on load.
- **Accessible:** labelled controls, live status messages, keyboard-friendly, checked with axe in light and dark themes.

## Quick start

Requires Node 20 or later (Netlify builds with Node 22).

```bash
npm install
npx netlify-cli dev      # the app and the fetch function together on http://localhost:8888
```

`npm run dev` serves the interface alone on port 5173. Fetches fail there because the function isn't running; use `netlify dev` for the full app.

| Script              | What it does                                                     |
| ------------------- | ---------------------------------------------------------------- |
| `npm run dev`       | Vite dev server for the interface only                           |
| `npm run build`     | Builds the app (`dist/`) and the component library (`dist/lib/`) |
| `npm run build:app` | Builds the app only; this is what Netlify runs                   |
| `npm run check`     | Type check, lint and formatting check                            |
| `npm test`          | Unit, component and proxy tests (Vitest)                         |
| `npm run test:e2e`  | End-to-end and accessibility tests (Playwright + axe)            |

## How it works

```
Browser                                Netlify (same origin)                    Target site
<UrlExtractor>  -- GET /api/fetch-page?url=... -->  rate limit -> fetch-page function  -- GET -->  page
      ^                                                         |
      '------------- JSON: html, finalUrl, status ---------------'
DOMParser + core: extract, normalise, classify (nothing in the page is loaded or run)
```

The function only fetches. Extraction runs in the browser, in plain TypeScript (`src/core`) that has no React in it, so the same code works on pasted HTML, in scripts and in tests.

## The fetch endpoint

`GET /api/fetch-page?url=<target>` (add `&ua=googlebot` to fetch with Googlebot's user agent).

| Case                                              | Status                | Body                                                                                                               |
| ------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Page fetched (any upstream status, including 404) | 200                   | `{ ok: true, requestedUrl, finalUrl, status, statusText, redirects[], contentType, truncated, html, timing, ... }` |
| Bad or blocked input                              | 400 / 403             | `{ ok: false, error: { code, message } }` with `invalid_url`, `blocked_address` or `forbidden`                     |
| Upstream trouble                                  | 415 / 502 / 504 / 508 | `unsupported_content`, `upstream_error`, `timeout` or `too_many_redirects`                                         |
| Too many requests                                 | 429                   | Sent by Netlify's rate limiter, not the function                                                                   |

### Security model

The function lives in `netlify/lib/page-proxy.ts`:

- http and https only, on ports 80 and 443, with no credentials in the URL;
- private, loopback, link-local (including cloud metadata at `169.254.169.254`) and reserved addresses are refused at connect time through a custom DNS lookup, which also defeats DNS rebinding;
- every redirect is checked again, up to 5;
- text content types only, a 4 MB cap on the decompressed body, and a 15-second deadline;
- cross-site browser requests are refused (`Sec-Fetch-Site`) and no CORS headers are sent, so other websites can't use it from a browser;
- Netlify rate-limits it to 60 requests a minute per IP (`netlify/functions/fetch-page.mts`).

Scripts can still call the endpoint directly, so the rate limit is what stops scripted use. See [SECURITY.md](SECURITY.md) to report a problem.

### Configuration

| Environment variable | Default | Effect                                                                                                 |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------ |
| `CDN_CACHE_SECONDS`  | `300`   | How long Netlify's CDN caches a successful fetch, keyed on `url` and `ua` only. `0` turns caching off. |

Because of the cache, a page edited in the last 5 minutes can still show its old links. Cached answers are served without running the function, so the cross-site check doesn't run for them, but they carry no CORS headers either, so other websites still can't read them from a browser. Errors are never cached.

The rate limit is set in code, in the function's `config`. Netlify's Free and Personal plans allow two code-based rate-limit rules per project.

### Limits

- Links that only appear after JavaScript runs are not included; the page is parsed, not rendered.
- Pages over 4 MB are cut off at 4 MB, and the interface says so.
- Some sites block requests from servers or show a challenge page instead of content.

## Use the component in another project

### 1. Add the fetch endpoint

Copy `netlify/lib/page-proxy.ts` and `netlify/functions/fetch-page.mts` into your project's `netlify/` folder. If your site already has an endpoint with the same contract, point `apiEndpoint` at it instead.

### 2. Add the component

Either copy the source (`src/core`, `src/services`, `src/hooks`, `src/components` and `src/index.ts`) into your project and run `npm install tldts`, or install the package and import its stylesheet:

```tsx
import { UrlExtractor } from 'url-extractor';
import 'url-extractor/style.css'; // only needed when installing the package

export function LinkTool() {
  return <UrlExtractor apiEndpoint="/api/fetch-page" />;
}
```

React 18 or later is a peer dependency.

### Astro

With `@astrojs/react` installed, render it client-side only, because it uses `DOMParser` and `localStorage`:

```astro
---
import { UrlExtractor } from '../lib/url-extractor'; // or 'url-extractor'
---
<UrlExtractor client:only="react" apiEndpoint="/api/fetch-page" theme="auto" />
```

### Props

| Prop          | Type                          | Default           | Purpose                                                 |
| ------------- | ----------------------------- | ----------------- | ------------------------------------------------------- |
| `apiEndpoint` | `string`                      | `/api/fetch-page` | Same-origin endpoint that fetches pages                 |
| `initialUrl`  | `string`                      | `''`              | Prefill the URL box                                     |
| `autoFetch`   | `boolean`                     | `false`           | Fetch `initialUrl` on mount                             |
| `theme`       | `'auto' \| 'light' \| 'dark'` | `'auto'`          | `auto` follows the visitor's setting                    |
| `history`     | `boolean`                     | `true`            | Remember the last 10 URLs and offer them as suggestions |
| `onResult`    | `(result, page) => void`      |                   | Called after each extraction, including option changes  |
| `onError`     | `({ code, message }) => void` |                   | Called when a fetch fails or the input is rejected      |
| `className`   | `string`                      |                   | Extra class on the root element                         |

### Theming

Set any of these custom properties on the component or an ancestor. Each falls back to a light or dark default.

```css
.tools {
  --ue-bg: #ffffff;
  --ue-surface: #f5f6f8;
  --ue-fg: #111827;
  --ue-muted: #4b5563;
  --ue-border: #cfd4dc;
  --ue-accent: #1d4ed8;
  --ue-accent-fg: #ffffff;
  --ue-danger: #b91c1c;
  --ue-warning: #8a4b08;
  --ue-radius: 8px;
  --ue-font: system-ui, sans-serif;
  --ue-mono: ui-monospace, monospace;
}
```

### Using the core without React

```ts
import { extractFromHtml, applyFilters, DEFAULT_FILTERS, toCsv } from 'url-extractor';

const { urls } = extractFromHtml(html, 'https://www.example.com/page', { deepScan: false });
const { items } = applyFilters(urls, { ...DEFAULT_FILTERS, scopes: ['external'] });
console.log(toCsv(items));
```

`extractFromHtml` needs a `DOMParser`: a browser, jsdom or similar.

## Project structure

```
netlify/functions/fetch-page.mts   function config: path, method, rate limit
netlify/lib/page-proxy.ts          the guarded fetcher
src/core/                          extraction, normalising, classifying, filtering, export (no React)
src/services/                      fetch endpoint client, storage, clipboard and downloads
src/hooks/                         useExtractor, useFilteredUrls
src/components/                    UrlExtractor and its parts, plus the CSS module
src/main.tsx                       the standalone app
tests/                             core, component, proxy and end-to-end tests, plus HTML fixtures
```

## Testing

```bash
npm test                              # Vitest: core, component and proxy tests
npx playwright install chromium       # once
npm run test:e2e                      # builds the app and runs Playwright with axe
```

The end-to-end tests mock the fetch endpoint, so they need no network access. GitHub Actions runs all of these on every push and pull request.

## Licence

[MIT](LICENSE)
