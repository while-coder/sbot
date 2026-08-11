import path from 'path';
import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, formatError, type MCPToolResult } from 'scorpio.ai';
import { channelManager } from '../../Channel/ChannelManager';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';
import { CHANNEL_SEND_TOOL_NAME, ChannelTargetType } from './index';

const logger = LoggerService.getLogger('Tools/Channel/send.ts');

export function createChannelSendTool(): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: CHANNEL_SEND_TOOL_NAME,
        description: loadPrompt('tools/channel/send.txt'),
        schema: z.object({
            type: z.enum(ChannelTargetType).describe('Target kind: "session" → dbSessionId, "user" → dbUserId.'),
            id: z.number().describe('dbSessionId when type="session", dbUserId when type="user". Discovered via channel_list_data.'),
            payload: z.discriminatedUnion('kind', [
                z.object({
                    kind: z.literal('text'),
                    content: z.string().describe('Message content in Markdown format.'),
                }),
                z.object({
                    kind: z.literal('file'),
                    file_path: z.string().describe('Absolute path of the local file to send.'),
                    file_name: z.string().optional().describe('File name with extension; defaults to the basename of file_path.'),
                }),
            ]),
        }) as any,
        func: async ({ type, id, payload }: any): Promise<MCPToolResult> => {
            if (typeof id !== 'number' || id <= 0) {
                return createErrorResult(`Invalid id: ${id}`);
            }
            try {
                const isUser = type === ChannelTargetType.User;
                let r;
                if (payload.kind === 'text') {
                    r = isUser
                        ? await channelManager.sendTextToUser(id, payload.content)
                        : await channelManager.sendTextToSession(id, payload.content);
                } else {
                    const name = payload.file_name ?? path.basename(payload.file_path);
                    r = isUser
                        ? await channelManager.sendFileToUser(id, payload.file_path, name)
                        : await channelManager.sendFileToSession(id, payload.file_path, name);
                }
                if (!r.ok) {
                    return createErrorResult(`Send failed: type=${type} id=${id} kind=${payload.kind}: ${r.error}`);
                }
                return createSuccessResult(createTextContent('ok'));
            } catch (e: any) {
                logger.error(`${CHANNEL_SEND_TOOL_NAME} failed: ${formatError(e, true)}`);
                return createErrorResult(formatError(e));
            }
        },
    });
}
