import fs from 'fs';
import AdmZip from 'adm-zip';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../FileSystem/utils';
import { loadPrompt } from '../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/Archive/extract.ts');

export function createZipExtractTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'zip_extract',
        description: loadPrompt('tools/archive/extract.txt'),
        schema: z.object({
            zipPath: z.string().describe('Absolute path to the .zip file'),
            outputDir: z.string().describe('Absolute path of the output directory'),
            overwrite: z.boolean().optional().default(false).describe('Overwrite existing files, default false'),
        }) as any,
        func: async ({ zipPath, outputDir, overwrite = false }: any): Promise<MCPToolResult> => {
            try {
                const zipAbs = resolvePath(zipPath);
                const outAbs = resolvePath(outputDir);

                if (!fs.existsSync(zipAbs)) return createErrorResult(`Zip file not found: ${zipAbs}`);

                fs.mkdirSync(outAbs, { recursive: true });

                const zip = new AdmZip(zipAbs);
                zip.extractAllTo(outAbs, overwrite);

                const entries = zip.getEntries().length;
                logger.info(`zip_extract: ${zipAbs} -> ${outAbs} (${entries} entries)`);
                return createSuccessResult(
                    createTextContent(`Extracted ${entries} entries to: ${outAbs}`),
                );
            } catch (e: any) {
                logger.error(`zip_extract: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}
