import fsAsync from 'fs/promises';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkFile, formatSize } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/readMediaFile.ts');

/** 读取媒体文件（图片/音频）为 base64 */
export function createReadMediaFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'read_media_file',
        description: '读取图片、音频等二进制文件，以 base64 格式返回内容。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('媒体文件的绝对路径'),
        }) as any,
        func: async ({ filePath }: any): Promise<MCPToolResult> => {
            try {
                const { abs, stat } = checkFile(filePath);
                const base64 = (await fsAsync.readFile(abs)).toString('base64');
                const ext = path.extname(abs).toLowerCase().slice(1);
                return createSuccessResult(createTextContent(JSON.stringify({ filePath: abs, size: formatSize(stat.size), ext, base64 })));
            } catch (e: any) {
                logger.error(`read_media_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
