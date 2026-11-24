import { hostOf } from './classify';
import type { ExtractedUrl } from './types';

export type ExportFormat = 'csv' | 'json' | 'markdown' | 'txt';

export const EXPORT_FORMATS: Record<ExportFormat, { label: string; mime: string; extension: string }> = {
  csv: { label: 'CSV', mime: 'text/csv;charset=utf-8', extension: 'csv' },
  json: { label: 'JSON', mime: 'application/json;charset=utf-8', extension: 'json' },
  markdown: { label: 'Markdown', mime: 'text/markdown;charset=utf-8', extension: 'md' },
  txt: { label: 'Text', mime: 'text/plain;charset=utf-8', extension: 'txt' },
};

/** Quotes a CSV cell and defuses values a spreadsheet would run as a formula. */
function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(items: readonly ExtractedUrl[]): string {
  const rows = [
    ['url', 'kind', 'scope', 'source', 'text', 'rel', 'new_tab', 'count'],
    ...items.map((item) => [
      item.url,
      item.kind,
      item.scope,
      `${item.source.tag} ${item.source.attr}`,
      item.text ?? '',
      (item.rel ?? []).join(' '),
      item.newTab ? 'yes' : '',
      String(item.count),
    ]),
  ];
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function toJson(items: readonly ExtractedUrl[]): string {
  return `${JSON.stringify(items, null, 2)}\n`;
}

function markdownCell(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s*\r?\n\s*/g, ' ');
}

export function toMarkdown(items: readonly ExtractedUrl[]): string {
  const lines = ['| URL | Kind | Scope | Text |', '| --- | --- | --- | --- |'];
  for (const item of items) {
    lines.push(
      `| ${markdownCell(item.url)} | ${item.kind} | ${item.scope} | ${markdownCell(item.text ?? '')} |`,
    );
  }
  return `${lines.join('\n')}\n`;
}

export function toText(items: readonly ExtractedUrl[]): string {
  return items.map((item) => item.url).join('\n') + (items.length ? '\n' : '');
}

export function formatUrls(items: readonly ExtractedUrl[], format: ExportFormat): string {
  switch (format) {
    case 'csv':
      return toCsv(items);
    case 'json':
      return toJson(items);
    case 'markdown':
      return toMarkdown(items);
    default:
      return toText(items);
  }
}

/** e.g. `www.example.com-urls.csv` */
export function exportFilename(pageUrl: string, format: ExportFormat): string {
  const host = hostOf(pageUrl).replace(/[^a-z0-9.-]/gi, '') || 'page';
  return `${host}-urls.${EXPORT_FORMATS[format].extension}`;
}
