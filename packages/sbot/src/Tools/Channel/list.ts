import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { WEB_CHANNEL_TYPE } from 'sbot.commons';
import { channelDataService, type ChannelSessionWithProfile } from '../../Session/ChannelDataService';
import { channelManager } from '../../Channel/ChannelManager';
import { config } from '../../Core/Config';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';
import type { ChannelUserRow } from '../../Core/Database';
import { CHANNEL_LIST_TOOL_NAME, ChannelListType } from './index';

const logger = LoggerService.getLogger('Tools/Channel/list.ts');

function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function groupByChannel<T extends { channelId: string }>(items: T[]): Map<string, T[]> {
    const map = new Map<string, T[]>();
    for (const item of items) {
        const arr = map.get(item.channelId);
        if (arr) arr.push(item);
        else map.set(item.channelId, [item]);
    }
    return map;
}

export function createChannelListTool(currentChannelId?: string): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: CHANNEL_LIST_TOOL_NAME,
        description: loadPrompt('tools/channel/list.txt'),
        schema: z.object({
            type: z.enum(ChannelListType).describe('What to include under each <channel>: "channel" → no children; "session" → <session> rows; "user" → <user> rows; "session_and_user" → both.'),
        }) as any,
        func: async ({ type }: any): Promise<MCPToolResult> => {
            try {
                const includeSessions = type === ChannelListType.Session || type === ChannelListType.SessionAndUser;
                const includeUsers    = type === ChannelListType.User    || type === ChannelListType.SessionAndUser;

                const [allSessions, allUsers] = await Promise.all([
                    includeSessions ? channelDataService.listSessions()     : Promise.resolve([] as ChannelSessionWithProfile[]),
                    includeUsers    ? channelDataService.listChannelUsers() : Promise.resolve([] as ChannelUserRow[]),
                ]);

                const sessionsByChannel = groupByChannel(allSessions);
                const usersByChannel    = groupByChannel(allUsers);

                const channels = Object.entries(config.settings.channels ?? {})
                    .filter(([_, c]) => c.type !== WEB_CHANNEL_TYPE);
                const channelBlocks = channels.map(([id, c]) => {
                    const caps = channelManager.getChannelCapabilities(id).join(',');
                    const currentAttr = currentChannelId === id ? ' current="1"' : '';
                    const headAttrs = `type="${c.type}" name="${escapeAttr(c.name ?? '')}" caps="${caps}"${currentAttr}`;

                    const lines: string[] = [];
                    if (includeSessions) {
                        for (const s of sessionsByChannel.get(id) ?? []) {
                            lines.push(`    <session id="${s.id}" name="${escapeAttr(s.sessionName || s.autoSessionName || '')}" />`);
                        }
                    }
                    if (includeUsers) {
                        for (const u of usersByChannel.get(id) ?? []) {
                            lines.push(`    <user id="${u.id}" name="${escapeAttr(u.userName ?? '')}" />`);
                        }
                    }

                    if (lines.length === 0) return `  <channel ${headAttrs} />`;
                    return `  <channel ${headAttrs}>\n${lines.join('\n')}\n  </channel>`;
                });

                return createSuccessResult(createTextContent(
                    `<channels count="${channels.length}">\n${channelBlocks.join('\n')}\n</channels>`
                ));
            } catch (e: any) {
                logger.error(`${CHANNEL_LIST_TOOL_NAME} failed: ${e.message}`);
                return createErrorResult(`Failed to list: ${e.message}`);
            }
        },
    });
}
