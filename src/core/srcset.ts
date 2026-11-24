const isSpace = (c: string | undefined) => c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';

/**
 * Returns every candidate URL in a `srcset` or `imagesrcset` value, following the HTML spec's parsing
 * rules: a URL runs to the next whitespace (so it may contain commas), and descriptors run to the next
 * comma outside parentheses.
 */
export function parseSrcset(input: string): string[] {
  const urls: string[] = [];
  const length = input.length;
  let pos = 0;

  while (pos < length) {
    while (pos < length && (isSpace(input[pos]) || input[pos] === ',')) pos++;
    if (pos >= length) break;

    const start = pos;
    while (pos < length && !isSpace(input[pos])) pos++;
    let url = input.slice(start, pos);

    if (url.endsWith(',')) {
      // "a.jpg, b.jpg 2x": a candidate with no descriptors.
      url = url.replace(/,+$/, '');
    } else {
      let inParens = false;
      while (pos < length) {
        const c = input[pos];
        pos++;
        if (c === '(') inParens = true;
        else if (c === ')') inParens = false;
        else if (c === ',' && !inParens) break;
      }
    }
    if (url) urls.push(url);
  }
  return urls;
}
