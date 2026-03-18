import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';
import { loadPrompt } from '../../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/cp.ts');

/** Copy files and directories, like bash cp */
export function createCpTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'cp',
        description: loadPrompt('tools/fs/cp.txt'),
        schema: z.object({
            sources: z.array(z.string()).min(1).describe('One or more absolute source paths'),
            dest: z.string().describe('Absolute destination path (directory or new name)'),
            recursive: z.boolean().optional().default(false).describe('Copy directories recursively (-r), default false'),
            noClobber: z.boolean().optional().default(false).describe('Do not overwrite existing files (-n), default false'),
        }) as any,
        func: async ({ sources, dest, recursive = false, noClobber = false }: any): Promise<MCPToolResult> => {
            try {
                const srcs = (sources as string[]).map(resolvePath);
                const dst = resolvePath(dest);

                for (const src of srcs) {
                    if (!fs.existsSync(src)) throw new Error(`Source path does not exist: ${src}`);
                    if (fs.statSync(src).isDirectory() && !recursive) {
                        return createErrorResult(`${src} is a directory. Set recursive=true to copy directories`);
                    }
                }

                const dstExists = fs.existsSync(dst);
                const dstIsDir = dstExists && fs.statSync(dst).isDirectory();

                if (srcs.length > 1 && !dstIsDir) {
                    return createErrorResult(`When multiple sources are given, dest must be an existing directory: ${dst}`);
                }

                const results: string[] = [];

                for (const src of srcs) {
                    const finalDst = dstIsDir ? path.join(dst, path.basename(src)) : dst;

                    if (fs.existsSync(finalDst) && noClobber) {
                        results.push(`Skipped (destination already exists): ${finalDst}`);
                        continue;
                    }

                    const parentDir = path.dirname(finalDst);
                    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

                    fs.cpSync(src, finalDst, { recursive, force: !noClobber });
                    results.push(`${src} -> ${finalDst}`);
                }

                return createSuccessResult(createTextContent(results.join('\n')));
            } catch (e: any) {
                logger.error(`cp: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
