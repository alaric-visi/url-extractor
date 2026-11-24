/**
 * Recent URLs in localStorage. Every call is wrapped: storage can be missing, full, or throw in
 * sandboxed iframes and some private windows, and the tool must keep working without it.
 */
const KEY = 'url-extractor:history';
export const HISTORY_SIZE = 10;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

export function readHistory(): string[] {
  try {
    const raw = storage()?.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list)
      ? list.filter((item): item is string => typeof item === 'string').slice(0, HISTORY_SIZE)
      : [];
  } catch {
    return [];
  }
}

export function saveToHistory(url: string): string[] {
  const next = [url, ...readHistory().filter((item) => item !== url)].slice(0, HISTORY_SIZE);
  try {
    storage()?.setItem(KEY, JSON.stringify(next));
  } catch {
    // Not saved; the in-memory list still works for this visit.
  }
  return next;
}

export function clearHistory(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
