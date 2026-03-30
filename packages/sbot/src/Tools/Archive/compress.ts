import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { resolvePath, formatSize } from '../FileSystem/utils';
import { loadPrompt } from '../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/Archive/compress.ts');

export function createZipCompressTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'zip_compress',
        description: loadPrompt('tools/archive/compress.txt'),
        schema: z.object({
            sources: z.array(z.string()).min(1).describe('Absolute paths of files/directories to compress'),
            dest: z.string().describe('Absolute path of the output .zip file'),
            overwrite: z.boolean().optional().default(false).describe('Overwrite dest if it already exists, default false'),
        }) as any,
        func: async ({ sources, dest, overwrite = false }: any): Promise<MCPToolResult> => {
            try {
                const destAbs = resolvePath(dest);
                const srcs = (sources as string[]).map(resolvePath);

                if (fs.existsSync(destAbs) && !overwrite) {
                    return createErrorResult(`Destination already exists: ${destAbs}. Set overwrite=true to replace.`);
                }

                for (const src of srcs) {
                    if (!fs.existsSync(src)) return createErrorResult(`Source not found: ${src}`);
                }

                fs.mkdirSync(path.dirname(destAbs), { recursive: true });

                const zip = new AdmZip();
                for (const src of srcs) {
                    const stat = fs.statSync(src);
                    if (stat.isDirectory()) {
                        zip.addLocalFolder(src, path.basename(src));
                    } else {
                        const entryPath = path.dirname(src).replace(/^[A-Za-z]:[/\\]/, '').replace(/\\/g, '/');
                        zip.addLocalFile(src, entryPath || '');
                    }
                }
                zip.writeZip(destAbs);

                const size = fs.statSync(destAbs).size;
                const entryCount = zip.getEntries().length;
                logger.info(`zip_compress: ${destAbs} (${size} bytes)`);
                return createSuccessResult(
                    createTextContent(`Created: ${destAbs} (${formatSize(size)}, ${entryCount} entries)`),
                );
            } catch (e: any) {
                logger.error(`zip_compress: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}
