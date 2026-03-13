import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { checkFile, applyFileEdits } from './utils';

const logger = LoggerService.getLogger('Tools/FileSystem/editFile.ts');

/** 精确文本编辑（支持多处替换 + 模糊空白匹配 + 正则 + unified diff 输出）*/
export function createEditFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'edit_file',
        description: '对文件进行精确的文本替换编辑。支持多处修改、正则替换（useRegex）、模糊空白匹配、dry-run 预览，返回 unified diff。路径必须是绝对路径。',
        schema: z.object({
            filePath: z.string().describe('要编辑的文件的绝对路径'),
            edits: z.array(z.object({
                oldText: z.string().describe('要替换的原始文本；useRegex=true 时为正则表达式模式'),
                newText: z.string().describe('替换后的新文本'),
                useRegex: z.boolean().optional().default(false).describe('将 oldText 作为正则表达式，默认 false'),
                regexFlags: z.string().optional().default('g').describe('正则标志，默认 g（全局替换），仅 useRegex=true 时生效'),
            })).describe('编辑操作列表，按顺序依次应用'),
            dryRun: z.boolean().optional().default(false).describe('仅预览 diff，不实际写入文件，默认 false'),
        }) as any,
        func: async ({ filePath, edits, dryRun = false }: any): Promise<MCPToolResult> => {
            try {
                const { abs } = checkFile(filePath);
                return createSuccessResult(createTextContent(await applyFileEdits(abs, edits, dryRun)));
            } catch (e: any) {
                logger.error(`edit_file ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
