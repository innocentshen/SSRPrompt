export type DiffOp = { type: 'equal' | 'insert' | 'delete'; value: string };

function isCjk(text: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/.test(text);
}

export function segmentText(text: string): string[] {
  const granularity = (isCjk(text) ? 'grapheme' : 'word') as 'grapheme' | 'word';

  // Intl.Segmenter is available in modern browsers; fall back to grapheme-ish split.
  type IntlSegment = { segment: string };
  type IntlSegmenter = { segment: (input: string) => Iterable<IntlSegment> };
  type IntlSegmenterConstructor = new (
    locales?: string | string[],
    options?: { granularity: 'grapheme' | 'word' }
  ) => IntlSegmenter;
  const Segmenter = (Intl as unknown as { Segmenter?: IntlSegmenterConstructor }).Segmenter;
  if (typeof Segmenter === 'function') {
    const segmenter = new Segmenter(undefined, { granularity });
    const parts: string[] = [];
    for (const part of segmenter.segment(text)) {
      parts.push(part.segment);
    }
    return parts;
  }

  return Array.from(text);
}

// Myers diff over token arrays.
export function diffTokens(oldTokens: readonly string[], newTokens: readonly string[]): DiffOp[] {
  const a = oldTokens;
  const b = newTokens;
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;

  const v = new Array<number>(2 * max + 1).fill(0);
  const trace: Array<number[]> = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      const kIndex = k + offset;
      const down = k === -d || (k !== d && v[kIndex - 1] < v[kIndex + 1]);
      let x = down ? v[kIndex + 1] : v[kIndex - 1] + 1;
      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[kIndex] = x;

      if (x >= n && y >= m) {
        return backtrack(trace, a, b, offset);
      }
    }
  }

  return backtrack(trace, a, b, offset);
}

function backtrack(trace: Array<number[]>, a: readonly string[], b: readonly string[], offset: number): DiffOp[] {
  let x = a.length;
  let y = b.length;
  const out: DiffOp[] = [];

  for (let d = trace.length - 1; d >= 0; d--) {
    const v = trace[d];
    const k = x - y;
    const kIndex = k + offset;

    const down = k === -d || (k !== d && v[kIndex - 1] < v[kIndex + 1]);
    const prevK = down ? k + 1 : k - 1;
    const prevKIndex = prevK + offset;
    const prevX = v[prevKIndex];
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      out.push({ type: 'equal', value: a[x - 1] });
      x--;
      y--;
    }

    if (d === 0) break;

    if (x === prevX) {
      out.push({ type: 'insert', value: b[y - 1] });
      y--;
    } else {
      out.push({ type: 'delete', value: a[x - 1] });
      x--;
    }
  }

  out.reverse();

  // Merge adjacent ops of same type for simpler rendering.
  const merged: DiffOp[] = [];
  for (const op of out) {
    const last = merged[merged.length - 1];
    if (last && last.type === op.type) {
      last.value += op.value;
      continue;
    }
    merged.push({ ...op });
  }
  return merged;
}

export function diffText(oldText: string, newText: string): DiffOp[] {
  if (oldText === newText) return [{ type: 'equal', value: newText }];
  return diffTokens(segmentText(oldText), segmentText(newText));
}

export function hasDiff(ops: readonly DiffOp[]): boolean {
  return ops.some((op) => op.type !== 'equal');
}
