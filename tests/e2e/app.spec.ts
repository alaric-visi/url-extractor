import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const kitchenSink = readFileSync(join(process.cwd(), 'tests/fixtures/kitchen-sink.html'), 'utf8');
const PAGE_URL = 'https://www.example.com/blog/post/';

/** Answers /api/fetch-page the way the Netlify Function would, with the given HTML. */
async function mockEndpoint(page: Page, html: string) {
  await page.route('**/api/fetch-page?**', (route) =>
    route.fulfill({
      json: {
        ok: true,
        requestedUrl: PAGE_URL,
        finalUrl: PAGE_URL,
        status: 200,
        statusText: 'OK',
        contentType: 'text/html; charset=utf-8',
        redirects: [],
        truncated: false,
        bytes: html.length,
        html,
      },
    }),
  );
}

async function extract(page: Page) {
  await page.getByLabel('Page URL').fill('www.example.com/blog/post/');
  await page.getByRole('button', { name: 'Extract URLs' }).click();
  await expect(page.getByRole('status')).toContainText('unique) on www.example.com');
}

for (const colorScheme of ['light', 'dark'] as const) {
  test(`extracts URLs with no accessibility violations (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await mockEndpoint(page, kitchenSink);
    await page.goto('/');

    const before = await new AxeBuilder({ page }).analyze();
    expect(before.violations.map((v) => v.id)).toEqual([]);

    await extract(page);
    await page.getByText('Extraction options').click();
    const after = await new AxeBuilder({ page }).analyze();
    expect(after.violations.map((v) => ({ id: v.id, targets: v.nodes.map((n) => n.target) }))).toEqual([]);
  });
}

test('makes results shareable with ?url=', async ({ page }) => {
  await mockEndpoint(page, kitchenSink);
  await page.goto('/');
  await extract(page);
  await expect(page).toHaveURL(/\?url=https%3A%2F%2Fwww\.example\.com%2Fblog%2Fpost%2F$/);

  await page.reload();
  await expect(page.getByRole('status')).toContainText('unique) on www.example.com');
});

test('filters a 5,000-URL page and pages through the rows', async ({ page }) => {
  const links = Array.from({ length: 5000 }, (_, i) => `<a href="/item/${i}">Item ${i}</a>`).join('\n');
  await mockEndpoint(page, `<html><body>${links}</body></html>`);
  await page.goto('/');
  await extract(page);

  const rows = page.getByRole('table').locator('tbody tr');
  await expect(rows).toHaveCount(500);
  await page.getByRole('button', { name: /Show 500 more/ }).click();
  await expect(rows).toHaveCount(1000);

  const started = Date.now();
  await page.getByLabel('Filter', { exact: true }).fill('item/4999');
  await expect(rows).toHaveCount(1);
  expect(Date.now() - started).toBeLessThan(2000);
});
