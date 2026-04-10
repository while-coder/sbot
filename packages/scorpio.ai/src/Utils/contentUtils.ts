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

/** Convert a local file to a base64 data URL. */
export async function readFileAsDataUrl(filePath: string, mimeType = 'image/png'): Promise<string> {
    const { readFile } = await import('fs/promises');
    const buffer = await readFile(filePath);
    return `data:${mimeType};base64,${buffer.toString('base64')}`;
}
