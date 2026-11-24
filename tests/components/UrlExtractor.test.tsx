import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UrlExtractor } from '../../src/components/UrlExtractor';

const HTML = `
  <a href="/about">About</a>
  <a href="https://partner.org/" rel="nofollow">Partner</a>
  <img src="/logo.png" alt="Logo">
  <a href="/about">About again</a>
  <a href="/p?utm_source=x&amp;id=1">Promo</a>
`;

const okBody = {
  ok: true,
  requestedUrl: 'https://example.com/',
  finalUrl: 'https://www.example.com/',
  status: 200,
  statusText: 'OK',
  contentType: 'text/html',
  redirects: [{ url: 'https://example.com/', status: 301 }],
  truncated: false,
  bytes: HTML.length,
  html: HTML,
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse(okBody));
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
});

async function extract(user: ReturnType<typeof userEvent.setup>, url = 'example.com') {
  await user.type(screen.getByLabelText('Page URL'), url);
  await user.click(screen.getByRole('button', { name: 'Extract URLs' }));
}

const status = () => screen.getByRole('status');
const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('<UrlExtractor>', () => {
  it('fetches through the endpoint and lists unique URLs with counts', async () => {
    const user = userEvent.setup();
    render(<UrlExtractor />);
    await extract(user);

    await waitFor(() => expect(status()).toHaveTextContent('Found 5 URLs (4 unique) on www.example.com.'));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/fetch-page?url=https%3A%2F%2Fexample.com%2F',
      expect.objectContaining({ credentials: 'same-origin' }),
    );
    expect(screen.getByRole('link', { name: 'https://www.example.com/about' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://www.example.com/p?id=1' })).toBeInTheDocument();
    const aboutRow = screen.getByRole('link', { name: 'https://www.example.com/about' }).closest('tr')!;
    expect(within(aboutRow).getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1 redirect', { exact: false })).toBeInTheDocument();
  });

  it('uses a custom endpoint', async () => {
    const user = userEvent.setup();
    render(<UrlExtractor apiEndpoint="/tools/fetch?key=1" />);
    await extract(user);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/tools/fetch?key=1&url=https%3A%2F%2Fexample.com%2F');
  });

  it('filters, then copies only what is shown', async () => {
    const user = userEvent.setup();
    render(<UrlExtractor />);
    await extract(user);
    await screen.findByRole('table');

    await user.type(screen.getByLabelText('Filter'), 'partner');
    await waitFor(() => expect(rows()).toHaveLength(1));
    await user.click(screen.getByRole('button', { name: 'Copy 1 shown' }));

    await waitFor(() => expect(status()).toHaveTextContent('Copied 1 URL.'));
    expect(await navigator.clipboard.readText()).toBe('https://partner.org/');
  });

  it('filters by kind chip', async () => {
    const user = userEvent.setup();
    render(<UrlExtractor />);
    await extract(user);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: /^Image/ }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByRole('link', { name: 'https://www.example.com/logo.png' })).toBeInTheDocument();
  });

  it('sorts by column, then reverses', async () => {
    const user = userEvent.setup();
    render(<UrlExtractor />);
    await extract(user);
    await screen.findByRole('table');

    const header = () => screen.getByRole('columnheader', { name: /^URL/ });
    await user.click(screen.getByRole('button', { name: /^URL/ }));
    expect(header()).toHaveAttribute('aria-sort', 'ascending');
    expect(within(rows()[0]!).getByRole('link')).toHaveTextContent('https://partner.org/');
    await user.click(screen.getByRole('button', { name: /^URL/ }));
    expect(header()).toHaveAttribute('aria-sort', 'descending');
  });

  it('re-extracts when options change, without fetching again', async () => {
    const user = userEvent.setup();
    render(<UrlExtractor />);
    await extract(user);
    await screen.findByRole('link', { name: 'https://www.example.com/p?id=1' });

    await user.click(screen.getByText('Extraction options'));
    await user.click(screen.getByLabelText(/Strip tracking parameters/));

    expect(
      await screen.findByRole('link', { name: 'https://www.example.com/p?utm_source=x&id=1' }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('downloads the shown rows as CSV', async () => {
    const createObjectURL = vi.fn(() => 'blob:test');
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const user = userEvent.setup();
    render(<UrlExtractor />);
    await extract(user);
    await screen.findByRole('table');

    await user.click(screen.getByRole('button', { name: 'Download CSV' }));
    expect(createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
    expect(click).toHaveBeenCalled();
    expect(status()).toHaveTextContent('Downloaded 4 URLs as CSV.');
  });

  it('shows the server’s message when a fetch is refused', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          ok: false,
          error: { code: 'blocked_address', message: 'That address points to a private network.' },
        },
        403,
      ),
    );
    const onError = vi.fn();
    const user = userEvent.setup();
    render(<UrlExtractor onError={onError} />);
    await extract(user, 'intranet.example.com');

    expect(await screen.findByRole('alert')).toHaveTextContent('That address points to a private network.');
    expect(onError).toHaveBeenCalledWith({
      code: 'blocked_address',
      message: 'That address points to a private network.',
    });
  });

  it('explains rate limiting', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, 429));
    const user = userEvent.setup();
    render(<UrlExtractor />);
    await extract(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many requests');
  });

  it('explains a missing endpoint', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    } as unknown as Response);
    const user = userEvent.setup();
    render(<UrlExtractor />);
    await extract(user);
    expect(await screen.findByRole('alert')).toHaveTextContent("didn't answer with JSON");
  });

  it('rejects input it cannot fetch, without calling the endpoint', async () => {
    const user = userEvent.setup();
    render(<UrlExtractor />);
    await extract(user, 'ftp://example.com');
    expect(await screen.findByRole('alert')).toHaveTextContent('Only http and https URLs can be fetched.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('can cancel a fetch', async () => {
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    );
    const user = userEvent.setup();
    render(<UrlExtractor />);
    await extract(user);
    await waitFor(() => expect(status()).toHaveTextContent('Fetching example.com…'));

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(status()).toHaveTextContent('Cancelled.'));
    expect(screen.getByRole('button', { name: 'Extract URLs' })).toBeInTheDocument();
  });

  it('fetches on mount with autoFetch and reports results', async () => {
    const onResult = vi.fn();
    render(<UrlExtractor initialUrl="https://example.com/" autoFetch onResult={onResult} />);
    await waitFor(() => expect(onResult).toHaveBeenCalled());
    expect(onResult.mock.calls[0]?.[0].urls).toHaveLength(5);
    expect(screen.getByLabelText('Page URL')).toHaveValue('https://example.com/');
  });

  it('remembers recent URLs', async () => {
    const user = userEvent.setup();
    render(<UrlExtractor />);
    await extract(user);
    await screen.findByRole('table');
    expect(JSON.parse(localStorage.getItem('url-extractor:history') ?? '[]')).toEqual([
      'https://example.com/',
    ]);
  });

  it('applies the theme prop', () => {
    const { container } = render(<UrlExtractor theme="dark" className="mine" />);
    expect(container.firstElementChild).toHaveAttribute('data-theme', 'dark');
    expect(container.firstElementChild).toHaveClass('mine');
  });
});
