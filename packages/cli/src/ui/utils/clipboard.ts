import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';

const execFileAsync = promisify(execFile);

// ── Types ────────────────────────────────────────────────────────────────────

export type ClipboardResult =
  | { type: 'image'; filePath: string }
  | { type: 'files'; filePaths: string[] }
  | { type: 'none' };

// ── Windows ──────────────────────────────────────────────────────────────────

async function readClipboardWin32(): Promise<ClipboardResult> {
  const tmpPath = join(tmpdir(), `sbot-clip-${Date.now()}.png`);

  // Try image first
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-Command',
      `$img = Get-Clipboard -Format Image; if ($img) { $img.Save('${tmpPath.replace(/'/g, "''")}'); Write-Output 'OK' } else { Write-Output 'NONE' }`,
    ]);
    if (stdout.trim() === 'OK' && existsSync(tmpPath)) {
      return { type: 'image', filePath: tmpPath };
    }
  } catch { /* ignore */ }

  // Try files
  try {
    const { stdout } = await execFileAsync('powershell', [
      '-NoProfile', '-Command',
      `$f = Get-Clipboard -Format FileDropList; if ($f) { $f | ForEach-Object { $_.FullName } }`,
    ]);
    const paths = stdout.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    if (paths.length > 0) {
      return { type: 'files', filePaths: paths };
    }
  } catch { /* ignore */ }

  return { type: 'none' };
}

// ── macOS ────────────────────────────────────────────────────────────────────

async function readClipboardDarwin(): Promise<ClipboardResult> {
  // Check clipboard content types
  let info = '';
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', 'clipboard info']);
    info = stdout;
  } catch {
    return { type: 'none' };
  }

  // Try image (PNG preferred, fall back to TIFF)
  if (info.includes('«class PNGf»')) {
    try {
      const tmpPath = join(tmpdir(), `sbot-clip-${Date.now()}.png`);
      await execFileAsync('osascript', ['-e', [
        'set imgData to the clipboard as «class PNGf»',
        `set filePath to POSIX file "${tmpPath}"`,
        'set fileRef to open for access filePath with write permission',
        'write imgData to fileRef',
        'close access fileRef',
      ].join('\n')]);
      if (existsSync(tmpPath)) {
        return { type: 'image', filePath: tmpPath };
      }
    } catch { /* ignore */ }
  }

  // Try file references
  if (info.includes('«class furl»')) {
    try {
      const { stdout } = await execFileAsync('osascript', ['-e', [
        'set fileList to the clipboard as «class furl»',
        'POSIX path of fileList',
      ].join('\n')]);
      const paths = stdout.trim().split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (paths.length > 0) {
        return { type: 'files', filePaths: paths };
      }
    } catch { /* ignore */ }
  }

  return { type: 'none' };
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function readClipboard(): Promise<ClipboardResult> {
  switch (process.platform) {
    case 'win32':  return readClipboardWin32();
    case 'darwin': return readClipboardDarwin();
    default:       return { type: 'none' };
  }
}
