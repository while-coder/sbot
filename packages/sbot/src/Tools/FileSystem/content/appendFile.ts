import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/appendFile.ts');

/** Append content to end of file */
export function createAppendFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'append_file',
        description: 'Append content to the end of a file. Creates the file if it does not exist. Path must be absolute.',
        schema: z.object({
            filePath: z.string().describe('Absolute path of the file to append to'),
            content: z.string().describe('Content to append'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('File encoding'),
            newLine: z.boolean().optional().default(true).describe('Whether to prepend a newline before the content, default true'),
        }) as any,
        func: async ({ filePath, content, encoding = 'utf8', newLine = true }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(filePath);
                const dir = path.dirname(abs);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                const toAppend = (fs.existsSync(abs) && newLine) ? '\n' + content : content;
                fs.appendFileSync(abs, toAppend, encoding as BufferEncoding);
                return createSuccessResult(createTextContent(`内容追加成功: ${abs}`));
            } catch (e: any) {
                logger.error(`append_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
