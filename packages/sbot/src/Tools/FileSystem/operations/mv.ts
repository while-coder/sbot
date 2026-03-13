import fs from 'fs';
import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../utils';

const logger = LoggerService.getLogger('Tools/FileSystem/operations/mv.ts');

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

/** Move or rename files/directories, like bash mv */
export function createMvTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'mv',
        description: `Move or rename files and directories, like bash mv. Supports multiple sources.
- mv [src] [dest]: if dest is an existing directory, src is moved into it; otherwise src is renamed to dest.
- mv [src1] [src2] ... [destDir]: moves all sources into an existing directory.
Parent directories of dest are created automatically. All paths must be absolute.`,
        schema: z.object({
            sources: z.array(z.string()).min(1).describe('One or more absolute source paths'),
            dest: z.string().describe('Absolute destination path (directory or new name)'),
            noClobber: z.boolean().optional().default(false).describe('Do not overwrite existing files (-n), default false'),
        }) as any,
        func: async ({ sources, dest, noClobber = false }: any): Promise<MCPToolResult> => {
            try {
                const srcs = (sources as string[]).map(resolvePath);
                const dst = resolvePath(dest);

                for (const src of srcs) {
                    if (!fs.existsSync(src)) throw new Error(`Source path does not exist: ${src}`);
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

                    moveOne(src, finalDst);
                    results.push(`${src} -> ${finalDst}`);
                }

                return createSuccessResult(createTextContent(results.join('\n')));
            } catch (e: any) {
                logger.error(`mv: ${e.message}`);
                return createErrorResult(e.message);
            }
        }
    });
}
