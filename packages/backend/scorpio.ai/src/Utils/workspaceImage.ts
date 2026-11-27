import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createImageContent, type MCPImageContent } from '../Tools/Core/mcp';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const SUPPORTED_FORMATS = new Set(['png', 'jpeg', 'webp', 'gif']);

function isWithinWorkspace(root: string, target: string): boolean {
    const relative = path.relative(root, target);
    return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
}

export async function readWorkspaceImage(workPath: string | undefined, relativePath: string): Promise<MCPImageContent> {
    if (!workPath) throw new Error('A session workspace is required.');
    if (!relativePath || path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath) || /[:\0]/.test(relativePath)) {
        throw new Error('Use a relative image path inside the session workspace.');
    }

    const root = await realpath(workPath);
    const candidate = path.resolve(root, relativePath);
    if (!isWithinWorkspace(root, candidate)) throw new Error('The image must be inside the session workspace.');
    const resolved = await realpath(candidate);
    if (!isWithinWorkspace(root, resolved)) throw new Error('The image resolves outside the session workspace.');

    const handle = await open(resolved, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0));
    let bytes: Buffer;
    try {
        const info = await handle.stat();
        if (!info.isFile()) throw new Error('The image path must point to a regular file.');
        if (!info.size || info.size > MAX_IMAGE_BYTES) throw new Error('The image must be nonempty and at most 10 MiB.');

        // Read at most one byte beyond the validated size, in case the file grows while open.
        const buffer = Buffer.allocUnsafe(info.size + 1);
        let offset = 0;
        while (offset < buffer.length) {
            const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
            if (!bytesRead) break;
            offset += bytesRead;
        }
        if (offset !== info.size) throw new Error('The image changed while it was being read. Retry with the saved file.');
        bytes = buffer.subarray(0, offset);
    } finally {
        await handle.close();
    }

    const { default: sharp } = await import('sharp');
    const metadata = await sharp(bytes).metadata().catch(() => undefined);
    if (!metadata?.format || !SUPPORTED_FORMATS.has(metadata.format)) {
        throw new Error('The file must be a PNG, JPEG, WebP, or GIF image.');
    }
    return createImageContent(bytes.toString('base64'), `image/${metadata.format}`);
}
