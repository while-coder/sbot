/**
 * Find a safe split point in streaming Markdown content.
 * Rules:
 *  1. Never split inside a fenced code block (``` ... ```)
 *  2. Prefer paragraph boundary (\n\n)
 *  3. Fall back to line boundary (\n)
 *  4. If no safe point found, return -1 (don't split)
 */

const SPLIT_THRESHOLD = 2000;

export function shouldSplit(text: string): boolean {
  return text.length > SPLIT_THRESHOLD;
}

export function findSafeSplitPoint(text: string): number {
  if (text.length <= SPLIT_THRESHOLD) return -1;

  // Count open code fences to determine if we're inside a code block
  let inCodeBlock = false;
  let lastSafeParaBreak = -1;
  let lastSafeLineBreak = -1;

  let i = 0;
  while (i < text.length) {
    // Detect fenced code blocks (``` or ~~~)
    if (
      (text[i] === '`' && text[i + 1] === '`' && text[i + 2] === '`') ||
      (text[i] === '~' && text[i + 1] === '~' && text[i + 2] === '~')
    ) {
      inCodeBlock = !inCodeBlock;
      i += 3;
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }

    if (!inCodeBlock && i >= SPLIT_THRESHOLD) {
      if (text[i] === '\n' && text[i + 1] === '\n') {
        lastSafeParaBreak = i + 2;
      }
      if (text[i] === '\n') {
        lastSafeLineBreak = i + 1;
      }
    }

    i++;
  }

  if (inCodeBlock) return -1;
  if (lastSafeParaBreak > 0) return lastSafeParaBreak;
  if (lastSafeLineBreak > 0) return lastSafeLineBreak;
  return -1;
}
