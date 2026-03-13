import fs from 'fs';
import fsAsync from 'fs/promises';
import path from 'path';
import { createTwoFilesPatch } from 'diff';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath, writeAtomic, normalizeLineEndings } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/content/write.ts');

/** 写入文件，返回 diff（原子替换，防止竞态条件）*/
export function createWriteTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'write',
        description: `Writes a file to the local filesystem. Creates the file and parent directories if they do not exist. Uses atomic write (temp + rename) to prevent data corruption. Returns a unified diff of the changes.
- This tool will overwrite the existing file if there is one at the provided path.
- If this is an existing file, you MUST use the read_file tool first to read the file's contents.
- ALWAYS prefer the edit_file tool for modifying existing files. Only use write for new files or full rewrites.
Path must be absolute.`,
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
                    return createSuccessResult(createTextContent(`Created new file: ${abs}`));
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
