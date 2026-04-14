import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolve, extname, basename } from 'node:path';
import type { ContentPart, Attachment } from '../../api/sbotClient.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PendingAttachment {
  filePath: string;
  name: string;
  isImage: boolean;
}

// ── Constants ────────────────────────────────────────────────────────────────

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg']);

const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.yaml', '.yml', '.xml', '.csv', '.log',
  '.ts', '.tsx', '.js', '.jsx', '.py', '.html', '.css', '.scss',
  '.sh', '.bat', '.toml', '.ini', '.cfg', '.env', '.sql', '.rs',
  '.go', '.java', '.kt', '.c', '.cpp', '.h', '.hpp', '.cs',
]);

const MIME_MAP: Record<string, string> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

// ── Helpers ──────────────────────────────────────────────────────────────────

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTS.has(extname(filePath).toLowerCase());
}

function getMimeType(filePath: string): string {
  return MIME_MAP[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function isTextFile(filePath: string): boolean {
  return TEXT_EXTS.has(extname(filePath).toLowerCase());
}

// ── Validate ─────────────────────────────────────────────────────────────────

/**
 * Validate and resolve a file path string.
 * Strips surrounding quotes, trims whitespace.
 * Returns resolved absolute path if file exists, null otherwise.
 */
export function validateFilePath(input: string): string | null {
  let cleaned = input.trim();
  // Strip surrounding single or double quotes
  if ((cleaned.startsWith('"') && cleaned.endsWith('"')) ||
      (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
    cleaned = cleaned.slice(1, -1);
  }
  if (!cleaned) return null;
  const resolved = resolve(cleaned);
  try {
    const stat = statSync(resolved);
    if (!stat.isFile()) return null;
    if (stat.size > MAX_FILE_SIZE) return null;
    return resolved;
  } catch {
    return null;
  }
}

// ── Prepare ──────────────────────────────────────────────────────────────────

export interface PreparedMessage {
  parts: ContentPart[];
  attachments: Attachment[];
}

/**
 * Build the server-compatible { parts, attachments } payload from
 * user text and pending file attachments.
 */
export function prepareMessage(text: string, pending: PendingAttachment[]): PreparedMessage {
  const parts: ContentPart[] = [];
  const attachments: Attachment[] = [];

  // Text part
  if (text) {
    parts.push({ type: 'text', text });
  }

  for (const att of pending) {
    const buf = readFileSync(att.filePath);

    if (att.isImage) {
      const mime = getMimeType(att.filePath);
      const dataUrl = `data:${mime};base64,$
      {buf.toString('base64')}`;
      parts.push({ type: 'image', dataUrl });
    } else if (isTextFile(att.filePath)) {
      attachments.push({ name: att.name, content: buf.toString('utf-8') });
    } else {
      const dataUrl = `data:application/octet-stream;base64,${buf.toString('base64')}`;
      attachments.push({ name: att.name, dataUrl });
    }
  }

  return { parts, attachments };
}
