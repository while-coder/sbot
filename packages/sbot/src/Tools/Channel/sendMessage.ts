import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { channelManager } from '../../Channel/ChannelManager';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';
import { CHANNEL_SEND_MESSAGE_TOOL_NAME, ChannelTargetType } from './index';

const logger = LoggerService.getLogger('Tools/Channel/sendMessage.ts');

export function createChannelSendMessageTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: CHANNEL_SEND_MESSAGE_TOOL_NAME,
        description: loadPrompt('tools/channel/send_message.txt'),
        schema: z.object({
            type: z.enum(ChannelTargetType).describe('Target kind: "session" → dbSessionId, "user" → dbUserId.'),
            id: z.number().describe('dbSessionId when type="session", dbUserId when type="user". Discovered via channel_list_data.'),
            content: z.string().describe('Message content in Markdown format.'),
        }) as any,
        func: async ({ type, id, content }: any): Promise<MCPToolResult> => {
            if (typeof id !== 'number' || id <= 0) {
                return createErrorResult(`Invalid id: ${id}`);
            }
            try {
                const ok = type === ChannelTargetType.User
                    ? await channelManager.sendTextToUser(id, content)
                    : await channelManager.sendTextToSession(id, content);
                if (!ok) {
                    return createErrorResult(`Send failed: type=${type} id=${id} unreachable or capability not supported.`);
                }
                return createSuccessResult(createTextContent('ok'));
            } catch (e: any) {
                logger.error(`${CHANNEL_SEND_MESSAGE_TOOL_NAME} failed: ${e.message}`);
                return createErrorResult(`Send failed: ${e.message}`);
            }
        },
    });
}
