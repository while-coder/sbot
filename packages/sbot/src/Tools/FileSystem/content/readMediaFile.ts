import fsAsync from 'fs/promises';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import {
    createTextContent, createImageContent, createAudioContent, createDocumentContent,
    createErrorResult, createSuccessResult, type MCPToolResult,
} from 'scorpio.ai';
import { checkFile, formatSize } from '../utils';
import { loadPrompt } from '../../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/FileSystem/content/readMediaFile.ts');

const MAX_SIZE = 100 * 1024;
const MAX_SIZE_LABEL = '100KB';

const MIME_MAP: Record<string, string> = {
    // image
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
    '.bmp': 'image/bmp',
    '.svg': 'image/svg+xml',
    // audio
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.aac': 'audio/aac',
    '.m4a': 'audio/mp4',
    // pdf
    '.pdf': 'application/pdf',
};

type MediaCategory = 'image' | 'audio' | 'document' | 'other';

function detectMedia(filePath: string): { mimeType: string; category: MediaCategory } {
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_MAP[ext] ?? 'application/octet-stream';
    let category: MediaCategory = 'other';
    if (mimeType.startsWith('image/')) category = 'image';
    else if (mimeType.startsWith('audio/')) category = 'audio';
    else if (mimeType === 'application/pdf') category = 'document';
    return { mimeType, category };
}

export function createReadMediaFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'read_media_file',
        description: loadPrompt('tools/fs/read_media_file.txt'),
        schema: z.object({
            filePath: z.string().describe('Absolute path of the media file'),
        }) as any,
        func: async ({ filePath }: any): Promise<MCPToolResult> => {
            try {
                const { abs, stat } = checkFile(filePath);
                if (stat.size > MAX_SIZE) {
                    return createErrorResult(`File too large: ${formatSize(stat.size)}, maximum is ${MAX_SIZE_LABEL}`);
                }

                const base64 = (await fsAsync.readFile(abs)).toString('base64');
                const { mimeType, category } = detectMedia(abs);

                switch (category) {
                    case 'image':
                        return createSuccessResult(createImageContent(base64, mimeType));
                    case 'audio':
                        return createSuccessResult(createAudioContent(base64, mimeType));
                    case 'document':
                        return createSuccessResult(createDocumentContent(base64, mimeType));
                    default:
                        return createSuccessResult(
                            createTextContent(`mimeType: ${mimeType}\nsize: ${formatSize(stat.size)}\nbase64: ${base64}`),
                        );
                }
            } catch (e: any) {
                logger.error(`read_media_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}
