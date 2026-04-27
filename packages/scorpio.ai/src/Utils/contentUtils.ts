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

/** Remove empty/whitespace-only text parts from MessageContent. */
export function trimContent(content: MessageContent): MessageContent {
    if (typeof content === 'string') return content.trim();
    return content.filter(p => p.type !== 'text' || p.text?.trim());
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

const MEDIA_MIME_MAP: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
    '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg',
    '.flac': 'audio/flac', '.aac': 'audio/aac', '.m4a': 'audio/mp4', '.opus': 'audio/opus',
    '.pdf': 'application/pdf',
};

export type MediaCategory = 'image' | 'audio' | 'document' | 'other';

export function detectMediaType(filePath: string): { mimeType: string; category: MediaCategory } {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    const mimeType = MEDIA_MIME_MAP[ext] ?? 'application/octet-stream';
    let category: MediaCategory = 'other';
    if (mimeType.startsWith('image/')) category = 'image';
    else if (mimeType.startsWith('audio/')) category = 'audio';
    else if (mimeType === 'application/pdf') category = 'document';
    return { mimeType, category };
}

export type ContentPart = { type: string; text?: string; [key: string]: any };

export async function readMediaAsContentPart(filePath: string): Promise<{ part: ContentPart; category: MediaCategory }> {
    const { readFile } = await import('fs/promises');
    const buffer = await readFile(filePath);
    const { mimeType, category } = detectMediaType(filePath);

    switch (category) {
        case 'image': {
            const dataUrl = `data:${detectImageMimeType(buffer)};base64,${buffer.toString('base64')}`;
            return { part: { type: 'image_url', image_url: { url: dataUrl } }, category };
        }
        case 'audio':
            return { part: { type: 'audio', data: buffer.toString('base64'), mimeType }, category };
        case 'document':
            return { part: { type: 'document', data: buffer.toString('base64'), mimeType }, category };
        default: {
            const name = filePath.slice(filePath.lastIndexOf('/') + 1) || filePath.slice(filePath.lastIndexOf('\\') + 1);
            return { part: { type: 'text', text: `[file: ${name}](${filePath})` }, category };
        }
    }
}
