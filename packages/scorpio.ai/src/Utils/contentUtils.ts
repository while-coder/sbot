import type { MessageContent } from "../Saver/IAgentSaverService";

/** Extract a plain-text representation from MessageContent. */
export function contentToString(content: MessageContent): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .filter(c => c.type === 'text' && c.text)
        .map(c => c.text!)
        .join('\n');
}

/** Check if MessageContent is empty. */
export function isEmptyContent(content: MessageContent): boolean {
    if (!content) return true;
    if (typeof content === 'string') return !content.trim();
    return content.length === 0;
}

/** Detect image MIME type from magic bytes. */
function detectImageMimeType(buffer: Buffer): string {
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return 'image/jpeg';
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return 'image/png';
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) return 'image/gif';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46 &&
        buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) return 'image/webp';
    return 'image/png'; // fallback
}

/** Convert a local file to a base64 data URL. */
export async function readImageAsDataUrl(filePath: string): Promise<string> {
    const { readFile } = await import('fs/promises');
    const buffer = await readFile(filePath);
    return `data:${detectImageMimeType(buffer)};base64,${buffer.toString('base64')}`;
}
