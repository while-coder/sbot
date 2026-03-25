import fs from 'fs';
import AdmZip from 'adm-zip';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../FileSystem/utils';
import { loadPrompt } from '../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/Archive/list.ts');

export function createZipListTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'zip_list',
        description: loadPrompt('tools/archive/list.txt'),
        schema: z.object({
            zipPath: z.string().describe('Absolute path to the .zip file'),
        }) as any,
        func: async ({ zipPath }: any): Promise<MCPToolResult> => {
            try {
                const zipAbs = resolvePath(zipPath);
                if (!fs.existsSync(zipAbs)) return createErrorResult(`Zip file not found: ${zipAbs}`);

                const zip = new AdmZip(zipAbs);
                const entries = zip.getEntries().map(e => ({
                    name: e.entryName,
                    size: e.header.size,
                    compressedSize: e.header.compressedSize,
                    isDirectory: e.isDirectory,
                    date: isNaN(e.header.time.getTime()) ? 'unknown' : e.header.time.toISOString(),
                }));

                const lines = entries.map(e =>
                    `${e.isDirectory ? 'd' : 'f'}  ${e.name}  ${e.size}B (${e.compressedSize}B compressed)  ${e.date}`
                );
                logger.info(`zip_list: ${zipAbs} (${entries.length} entries)`);
                return createSuccessResult(
                    createTextContent(`${entries.length} entries in ${zipAbs}:\n${lines.join('\n')}`),
                );
            } catch (e: any) {
                logger.error(`zip_list: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}
