import { textToSpeech, setVolume } from './mi/mina';
import type { AuthedAccount } from './mi/types';

const DEFAULT_CHUNK_LIMIT = 200;
const CHUNK_DELAY_MS = 200;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function chunkText(text: string, limit: number = DEFAULT_CHUNK_LIMIT): string[] {
  if (text.length <= limit) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= limit) {
      chunks.push(remaining);
      break;
    }

    let splitAt = -1;
    const minSplit = Math.floor(limit * 0.5);

    const newlineIdx = remaining.lastIndexOf('\n', limit);
    if (newlineIdx >= minSplit) {
      splitAt = newlineIdx + 1;
    }

    if (splitAt === -1) {
      const punctuation = ['。', '！', '？', '；', '.', '!', '?', ';', '，', ','];
      for (const p of punctuation) {
        const idx = remaining.lastIndexOf(p, limit);
        if (idx >= minSplit) {
          splitAt = idx + 1;
          break;
        }
      }
    }

    if (splitAt === -1) {
      splitAt = limit;
    }

    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt);
  }

  return chunks;
}

export async function speak(
  account: AuthedAccount,
  deviceId: string,
  text: string,
  options?: { chunkLimit?: number; volume?: number },
): Promise<void> {
  if (options?.volume) {
    await setVolume(account, deviceId, options.volume);
  }

  const chunks = chunkText(text, options?.chunkLimit ?? DEFAULT_CHUNK_LIMIT);
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) await sleep(CHUNK_DELAY_MS);
    await textToSpeech(account, deviceId, chunks[i]);
  }
}
