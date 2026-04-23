import path from 'path';
import { z } from 'zod';
import { DynamicStructuredTool } from '@langchain/core/tools';

export type SendFileFn = (filePath: string, fileName: string) => Promise<void>;

export const SEND_FILE_TOOL_NAME = '_send_file';

export function createSendFileTool(prompt: string, sendFileFn: SendFileFn): DynamicStructuredTool {
    return new DynamicStructuredTool({
        name: SEND_FILE_TOOL_NAME,
        description: prompt,
        schema: z.object({
            file_path: z.string().describe('Absolute path of the local file to send'),
            file_name: z.string().optional().describe('File name with extension; defaults to the basename of file_path'),
        }),
        func: async ({ file_path, file_name }) => {
            const name = file_name ?? path.basename(file_path);
            await sendFileFn(file_path, name);
            return `File "${name}" sent successfully`;
        },
    });
}
