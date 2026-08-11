import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, formatError, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';
import { loadPrompt } from '../../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/move.ts');

function moveOne(src: string, dst: string): void {
    try {
        fs.renameSync(src, dst);
    } catch (e: any) {
        if (e.code === 'EXDEV') {
            // Cross-device: copy then delete
            fs.cpSync(src, dst, { recursive: true });
            fs.rmSync(src, { recursive: true, force: true });
        } else {
            throw e;
        }
    }
}

/** Move/rename or copy files and directories, like bash mv / cp. Supports multiple sources. */
export function createMoveTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'move',
        description: loadPrompt('tools/fs/move.txt'),
        schema: z.object({
            sources: z.array(z.string()).min(1).describe('One or more absolute source paths'),
            dest: z.string().describe('Absolute destination path (directory or new name)'),
            copy: z.boolean().optional().default(false).describe('Copy instead of move (cp). Default false (mv)'),
            recursive: z.boolean().optional().default(false).describe('Copy directories recursively (-r). Only meaningful with copy=true. Default false'),
            overwrite: z.boolean().optional().default(true).describe('Overwrite existing destination files. Default true (matches bash mv/cp)'),
        }) as any,
        func: async ({ sources, dest, copy = false, recursive = false, overwrite = true }: any): Promise<MCPToolResult> => {
            try {
                const srcs = (sources as string[]).map(resolvePath);
                const dst = resolvePath(dest);

                for (const src of srcs) {
                    if (!fs.existsSync(src)) throw new Error(`Source path does not exist: ${src}`);
                    if (copy && fs.statSync(src).isDirectory() && !recursive) {
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

                    if (fs.existsSync(finalDst) && !overwrite) {
                        results.push(`Skipped (destination already exists): ${finalDst}`);
                        continue;
                    }

                    const parentDir = path.dirname(finalDst);
                    if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });

                    if (copy) {
                        fs.cpSync(src, finalDst, { recursive, force: overwrite });
                    } else {
                        moveOne(src, finalDst);
                    }
                    results.push(`${src} -> ${finalDst}`);
                }

                return createSuccessResult(createTextContent(results.join('\n')));
            } catch (e: any) {
                logger.error(`move: ${formatError(e, true)}`);
                return createErrorResult(formatError(e));
            }
        }
    });
}
