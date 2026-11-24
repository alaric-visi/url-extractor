# Security policy

The part of this project that needs the most care is the fetch function (`netlify/lib/page-proxy.ts`), because it makes requests on behalf of visitors.

## Reporting a problem

Please report vulnerabilities privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Don't open a public issue for a security problem.

Include the URL or request that shows the problem and what you expected to happen.

## In scope

- Ways to make the function reach private, loopback, link-local or reserved addresses (SSRF), including through redirects, DNS tricks or unusual URL forms.
- Ways to read responses from another website in a browser, or to use the function as a general-purpose proxy beyond its documented limits.
- Script injection through extracted URLs or link text shown in the interface.

## Out of scope

- The function being callable by scripts at the documented rate limit. That is expected; the rate limit is the control.
- Sites that block or rate-limit the function.
