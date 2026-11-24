# Changelog

All notable changes to this project are listed here. Versions follow [Semantic Versioning](https://semver.org/).

## 1.0.0 (unreleased)

First release of the rebuilt tool.

### Added

- `<UrlExtractor>` React component with a standalone app, a library build and TypeScript types.
- Same-origin Netlify Function (`/api/fetch-page`) with SSRF protection, size and time limits, and a per-IP rate limit. Successful fetches are cached on Netlify's CDN for 5 minutes (`CDN_CACHE_SECONDS`; `0` turns it off).
- Kind and scope for every URL, the element and attribute it came from, link text, `rel` and `target="_blank"`.
- New sources: `<picture>` sources, video posters, tracks, image maps, SVG `<use>`, Twitter cards, meta refresh, `<style>` `@import`, JSON-LD, `cite`, and an opt-in deep scan of inline scripts.
- Filters: exclude, regular expressions, kind and scope chips, one domain, grouping by domain, sortable columns.
- Copy and download (CSV, JSON, Markdown, text) of the rows shown.
- Shareable `?url=` links, recent-URL suggestions, light and dark themes, `--ue-*` theming variables.
- Unit, component, proxy and end-to-end tests, with axe accessibility checks, run in GitHub Actions.

### Changed

- Pages are fetched by the site's own function instead of three public CORS proxies.
- Relative URLs resolve against the page and `<base href>`, not the site root.
- `srcset` keeps every candidate; trailing slashes are kept as written; `mailto:` and `tel:` links are kept.
- Tracking-parameter removal matches exact names, so `reference` and `sourceId` survive and no `utm_` parameter is skipped.
- `www.` and other subdomains of the page's site count as "subdomain", not "external".
- Copy and export act on the filtered rows.

### Removed

- The Remove Duplicates button (use Unique URLs only), the `alert()` dialog, the full-page loading overlay and the iframe height messaging.
