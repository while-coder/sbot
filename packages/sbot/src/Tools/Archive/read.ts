import fs from 'fs';
import AdmZip from 'adm-zip';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { LoggerService } from '../../Core/LoggerService';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { resolvePath, formatSize } from '../FileSystem/utils';
import { loadPrompt } from '../../Core/PromptLoader';

const logger = LoggerService.getLogger('Tools/Archive/read.ts');

const MAX_TEXT_SIZE = 50 * 1024; // 50KB, align with read tool
const MAX_LINE_LENGTH = 2000;
const MAX_LINE_SUFFIX = `... (line truncated to ${MAX_LINE_LENGTH} chars)`;

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

                if (encoding === 'base64') {
                    logger.info(`zip_read_file: ${zipAbs}!${entryPath}`);
                    return createSuccessResult(createTextContent(`size: ${formatSize(buf.length)}\nbase64: ${buf.toString('base64')}`));
                }

                const raw = buf.toString(encoding as BufferEncoding);
                const allLines = raw.split('\n');
                const totalLines = allLines.length;
                const outputLines: string[] = [];
                let bytes = 0;
                let truncated = false;

                for (const line of allLines) {
                    const text = line.length > MAX_LINE_LENGTH
                        ? line.substring(0, MAX_LINE_LENGTH) + MAX_LINE_SUFFIX
                        : line;
                    const size = Buffer.byteLength(text, 'utf-8') + (outputLines.length > 0 ? 1 : 0);
                    if (bytes + size > MAX_TEXT_SIZE) { truncated = true; break; }
                    outputLines.push(text);
                    bytes += size;
                }

                let output = outputLines.join('\n');
                if (truncated) {
                    output += `\n\n(Output capped at 50KB. Showing lines 1-${outputLines.length} of ${totalLines}.)`;
                } else {
                    output += `\n\n(End of entry - total ${totalLines} lines)`;
                }

                logger.info(`zip_read_file: ${zipAbs}!${entryPath}`);
                return createSuccessResult(createTextContent(output));
            } catch (e: any) {
                logger.error(`zip_read_file: ${e.message}`);
                return createErrorResult(e.message);
            }
        },
    });
}
