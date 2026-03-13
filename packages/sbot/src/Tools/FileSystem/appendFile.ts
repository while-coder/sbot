import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from './utils';

const logger = LoggerService.getLogger('Tools/FileSystem/appendFile.ts');

/** 追加内容到文件末尾 */
export function createAppendFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'append_file',
        description: '追加内容到文件末尾。文件不存在时自动创建。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要追加的文件的绝对路径'),
            content: z.string().describe('要追加的内容'),
            encoding: z.enum(['utf8', 'utf-8', 'ascii']).optional().default('utf8').describe('文件编码'),
            newLine: z.boolean().optional().default(true).describe('追加前是否自动添加换行符，默认 true'),
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
