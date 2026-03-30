import fs from 'fs';
import fsAsync from 'fs/promises';
import path from 'path';
import { createTwoFilesPatch } from 'diff';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath, writeAtomic, normalizeLineEndings } from '../utils';
import { loadPrompt } from '../../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/FileSystem/content/write.ts');

/** 写入文件，返回 diff（原子替换，防止竞态条件）*/
export function createWriteTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'write',
        description: loadPrompt('tools/fs/write.txt'),
        schema: z.object({
            filePath: z.string().describe('Absolute path of the file to write'),
            content: z.string().describe('Content to write to the file'),
        }) as any,
        func: async ({ filePath, content }: any): Promise<MCPToolResult> => {
            try {
                const abs = resolvePath(filePath);
                const dir = path.dirname(abs);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

                const exists = fs.existsSync(abs);
                const oldContent = exists ? normalizeLineEndings(await fsAsync.readFile(abs, 'utf-8')) : '';
                const newContent = normalizeLineEndings(content);

                await writeAtomic(abs, newContent, 'utf-8');

                if (!exists) {
                    const lines = newContent.split('\n').length;
                    const size = Buffer.byteLength(newContent, 'utf-8');
                    const sizeStr = size < 1024 ? `${size} B` : `${(size / 1024).toFixed(1)}KB`;
                    return createSuccessResult(createTextContent(`Created new file: ${abs} (${lines} lines, ${sizeStr})`));
                }

                const diff = createTwoFilesPatch(abs, abs, oldContent, newContent, 'original', 'modified');
                let ticks = 3;
                while (diff.includes('`'.repeat(ticks))) ticks++;
                return createSuccessResult(createTextContent(`${'`'.repeat(ticks)}diff\n${diff}${'`'.repeat(ticks)}`));
            } catch (e: any) {
                logger.error(`write ${filePath}: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
