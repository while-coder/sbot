import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { channelManager } from '../../Channel/ChannelManager';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';
import { CHANNEL_SEND_FILE_TOOL_NAME, ChannelTargetType } from './index';

const logger = LoggerService.getLogger('Tools/Channel/sendFile.ts');

export function createChannelSendFileTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: CHANNEL_SEND_FILE_TOOL_NAME,
        description: loadPrompt('tools/channel/send_file.txt'),
        schema: z.object({
            type: z.enum(ChannelTargetType).describe('Target kind: "session" → dbSessionId, "user" → dbUserId.'),
            id: z.number().describe('dbSessionId when type="session", dbUserId when type="user". Discovered via channel_list_data.'),
            file_path: z.string().describe('Absolute path of the local file to send.'),
            file_name: z.string().optional().describe('File name with extension; defaults to the basename of file_path.'),
        }) as any,
        func: async ({ type, id, file_path, file_name }: any): Promise<MCPToolResult> => {
            if (typeof id !== 'number' || id <= 0) {
                return createErrorResult(`Invalid id: ${id}`);
            }
            const name = file_name ?? path.basename(file_path);
            try {
                const ok = type === ChannelTargetType.User
                    ? await channelManager.sendFileToUser(id, file_path, name)
                    : await channelManager.sendFileToSession(id, file_path, name);
                if (!ok) {
                    return createErrorResult(`Send failed: type=${type} id=${id} unreachable or capability not supported.`);
                }
                return createSuccessResult(createTextContent('ok'));
            } catch (e: any) {
                logger.error(`${CHANNEL_SEND_FILE_TOOL_NAME} failed: ${e.message}`);
                return createErrorResult(`Send failed: ${e.message}`);
            }
        },
    });
}
