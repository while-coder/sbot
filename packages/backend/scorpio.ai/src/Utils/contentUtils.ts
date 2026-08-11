import { ContentPartType, type AttachmentInput, type ContentPart, type MessageContent } from "scorpio.saver";

type TextPart = Extract<ContentPart, { type: typeof ContentPartType.Text }>;
const isTextPart = (p: ContentPart): p is TextPart => p.type === ContentPartType.Text;

/**
 * Appends inline attachments to a standard message content value.
 * The channel owns persistence through `saveAttachment`; this utility owns the
 * shared MessageContent conversion and preserves multimodal parts.
 */
export async function appendAttachmentsToMessageContent(
    content: MessageContent,
    attachments: readonly AttachmentInput[] | undefined,
    saveAttachment: (attachment: AttachmentInput) => Promise<string>,
): Promise<MessageContent> {
    const parts: ContentPart[] = typeof content === 'string'
        ? [{ type: ContentPartType.Text, text: content }]
        : content.filter(isContentPart);
    let hasMultimodal = parts.some(part => part.type !== ContentPartType.Text);

    for (const attachment of attachments ?? []) {
        if (!attachment || typeof attachment.name !== 'string') continue;
        const name = safeAttachmentName(attachment.name);
        if (isImageDataUrl(attachment.dataUrl)) {
            parts.push({ type: ContentPartType.ImageUrl, image_url: { url: attachment.dataUrl } });
            hasMultimodal = true;
        } else if (typeof attachment.dataUrl === 'string' || typeof attachment.content === 'string') {
            const filePath = await saveAttachment({ ...attachment, name });
            parts.push({ type: ContentPartType.Text, text: `[file: ${name}](${filePath})` });
        }
    }

    if (parts.length === 0) return '';
    return hasMultimodal ? parts : parts
        .filter(isTextPart)
        .map(part => part.text)
        .join('\n');
}

/** Write an inline attachment to a channel-selected file path. */
export async function writeAttachmentInput(filePath: string, attachment: AttachmentInput): Promise<void> {
    const { writeFile } = await import('node:fs/promises');
    if (typeof attachment.dataUrl === 'string') {
        const match = /^data:[^;,]+;base64,([\s\S]*)$/i.exec(attachment.dataUrl);
        if (!match) throw new Error(`附件 ${attachment.name} 不是 base64 data URL`);
        await writeFile(filePath, Buffer.from(match[1], 'base64'));
        return;
    }
    if (typeof attachment.content === 'string') {
        await writeFile(filePath, attachment.content);
        return;
    }
    throw new Error(`附件 ${attachment.name} 没有内容`);
}

function isContentPart(value: unknown): value is ContentPart {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value) && typeof (value as { type?: unknown }).type === 'string');
}

function isImageDataUrl(value: unknown): value is string {
    return typeof value === 'string' && /^data:image\//i.test(value);
}

function safeAttachmentName(value: string): string {
    return value.split(/[\\/]/).at(-1)?.trim() || 'attachment';
}

/** Extract a plain-text representation from MessageContent. */
export function contentToString(content: MessageContent): string {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content
        .filter(isTextPart)
        .map(p => p.text)
        .filter((t): t is string => !!t)
        .join('\n');
}

/** Remove empty/whitespace-only text parts from MessageContent. */
export function trimContent(content: MessageContent): MessageContent {
    if (typeof content === 'string') return content.trim();
    return content.filter(p => !isTextPart(p) || !!p.text?.trim());
}

/** Check if MessageContent is empty. */
export function isEmptyContent(content: MessageContent): boolean {
    if (!content) return true;
    if (typeof content === 'string') return !content.trim();
    return content.length === 0;
}

/** Truncate a string for safe logging (avoids dumping huge payloads like base64). */
export function truncateForLog(s: string | undefined, maxLength = 2000): string {
    if (!s) return '';
    return s.length > maxLength ? s.slice(0, maxLength) + `...[truncated ${s.length - maxLength} chars]` : s;
}

/** Detect image MIME type from magic bytes. */
export function detectImageMimeType(buffer: Buffer): string {
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
    '.mp4': 'video/mp4', '.mkv': 'video/x-matroska',
    '.pdf': 'application/pdf',
};

export type MediaCategory = 'image' | 'audio' | 'video' | 'document' | 'other';

export function detectMediaType(filePath: string): { mimeType: string; category: MediaCategory } {
    const ext = filePath.slice(filePath.lastIndexOf('.')).toLowerCase();
    const mimeType = MEDIA_MIME_MAP[ext] ?? 'application/octet-stream';
    let category: MediaCategory = 'other';
    if (mimeType.startsWith('image/')) category = 'image';
    else if (mimeType.startsWith('audio/')) category = 'audio';
    else if (mimeType.startsWith('video/')) category = 'video';
    else if (mimeType === 'application/pdf') category = 'document';
    return { mimeType, category };
}

export let maxImageSize: number | undefined;

export function setMaxImageSize(size: number | undefined) {
    maxImageSize = size;
}

export async function resizeImageIfNeeded(input: Buffer): Promise<Buffer>;
export async function resizeImageIfNeeded(input: string): Promise<string>;
export async function resizeImageIfNeeded(input: Buffer | string): Promise<Buffer | string> {
    if (!maxImageSize) return input;
    if (typeof input === 'string') {
        const match = input.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (!match) return input;
        const buffer = Buffer.from(match[2], 'base64');
        const resized = await resizeImageIfNeeded(buffer);
        if (resized === buffer) return input;
        return `data:${detectImageMimeType(resized)};base64,${resized.toString('base64')}`;
    }
    const sharp = (await import('sharp')).default;
    const metadata = await sharp(input).metadata();
    const { width, height } = metadata;
    if (!width || !height) return input;
    if (Math.max(width, height) <= maxImageSize) return input;
    return sharp(input).resize(maxImageSize, maxImageSize, { fit: 'inside' }).toBuffer();
}

export async function readMediaAsContentPart(filePath: string, mediaAsFilePath = false): Promise<{ part: ContentPart; category: MediaCategory }> {
    const { mimeType, category } = detectMediaType(filePath);

    if (mediaAsFilePath) {
        const name = filePath.slice(filePath.lastIndexOf('/') + 1) || filePath.slice(filePath.lastIndexOf('\\') + 1);
        return { part: { type: ContentPartType.Text, text: `[${category}: ${name}](${filePath})` }, category };
    }

    const { readFile } = await import('fs/promises');
    const buffer = await readFile(filePath);

    switch (category) {
        case 'image': {
            return { part: { type: ContentPartType.ImageUrl, image_url: { url: `data:${detectImageMimeType(buffer)};base64,${buffer.toString('base64')}` } }, category };
        }
        // case 'audio':
        //     return { part: { type: 'audio', data: buffer.toString('base64'), mimeType }, category };
        // case 'document':
        //     return { part: { type: 'document', data: buffer.toString('base64'), mimeType }, category };
        // case 'video': {
        //     const name = filePath.slice(filePath.lastIndexOf('/') + 1) || filePath.slice(filePath.lastIndexOf('\\') + 1);
        //     return { part: { type: 'text', text: `[video: ${name}] (${mimeType}, ${buffer.length} bytes)` }, category };
        // }
        default: {
            const name = filePath.slice(filePath.lastIndexOf('/') + 1) || filePath.slice(filePath.lastIndexOf('\\') + 1);
            return { part: { type: ContentPartType.Text, text: `[${category}: ${name}] (${mimeType}, ${buffer.length} bytes)` }, category };
        }
    }
}
