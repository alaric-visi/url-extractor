import type { SortKey } from '../core/filter';
import type { UrlKind, UrlScope } from '../core/types';

export const KIND_LABELS: Record<UrlKind, string> = {
  page: 'Page',
  image: 'Image',
  script: 'Script',
  stylesheet: 'CSS',
  font: 'Font',
  media: 'Media',
  document: 'Document',
  frame: 'Frame',
  form: 'Form',
  email: 'Email',
  phone: 'Phone',
  other: 'Other',
};

export const SCOPE_LABELS: Record<UrlScope, string> = {
  internal: 'Internal',
  subdomain: 'Subdomain',
  external: 'External',
};

export const COLUMN_LABELS: Record<SortKey, string> = {
  url: 'URL',
  kind: 'Kind',
  scope: 'Scope',
  source: 'Found in',
  text: 'Text',
  count: 'Count',
};

export const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString()} ${n === 1 ? one : many}`;
