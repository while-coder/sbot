import fs from 'fs';
import AdmZip from 'adm-zip';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { resolvePath } from '../FileSystem/utils';
import { loadPrompt } from '../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/Archive/read.ts');

export function createZipReadFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: 'zip_read_file',
        description: loadPrompt('tools/archive/read.txt'),
        schema: z.object({
            zipPath: z.string().describe('Absolute path to the .zip file'),
            entryPath: z.string().describe('File path inside the zip, e.g. "src/main.ts"'),
            encoding: z.string().optional().default('utf-8').describe('Text encoding (default utf-8) or "base64" for binary'),
        }) as any,
        func: async ({ zipPath, entryPath, encoding = 'utf-8' }: any): Promise<MCPToolResult> => {
            try {
                const zipAbs = resolvePath(zipPath);
                if (!fs.existsSync(zipAbs)) return createErrorResult(`Zip file not found: ${zipAbs}`);

                const zip = new AdmZip(zipAbs);
                const entry = zip.getEntry(entryPath);
                if (!entry) return createErrorResult(`Entry not found in zip: ${entryPath}`);
                if (entry.isDirectory) return createErrorResult(`Entry is a directory: ${entryPath}`);

                const buf = zip.readFile(entry);
                if (!buf) return createErrorResult(`Failed to read entry: ${entryPath}`);

                const content = encoding === 'base64'
                    ? buf.toString('base64')
                    : buf.toString(encoding as BufferEncoding);

                logger.info(`zip_read_file: ${zipAbs}!${entryPath}`);
                return createSuccessResult(createTextContent(content));
            } catch (e: any) {
                logger.error(`zip_read_file: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}
