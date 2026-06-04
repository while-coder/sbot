import { DynamicStructuredTool, type StructuredToolInterface } from '@langchain/core/tools';
import { z } from 'zod';
import { createTextContent, createErrorResult, createSuccessResult, type MCPToolResult } from 'scorpio.ai';
import { channelDataService } from '../../Session/ChannelDataService';
import { channelManager } from '../../Channel/ChannelManager';
import { config } from '../../Core/Config';
import { LoggerService } from '../../Core/LoggerService';
import { loadPrompt } from '../../Core/PromptLoader';
import { CHANNEL_LIST_TOOL_NAME, ChannelListType } from './index';

const logger = LoggerService.getLogger('Tools/Channel/list.ts');

function escapeAttr(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function compilePattern(pattern: string | undefined): { matcher: (s: string) => boolean; error: string | null } {
    if (!pattern) return { matcher: () => true, error: null };
    try {
        const re = new RegExp(pattern, 'i');
        return { matcher: (s: string) => re.test(s ?? ''), error: null };
    } catch (e: any) {
        return { matcher: () => false, error: `Invalid name_pattern: ${e.message}` };
    }
}

async function buildSessionsBlock(scope: string, queryChannelId: string | undefined, matcher: (s: string) => boolean, currentChannelId?: string): Promise<string> {
    const sessions = await channelDataService.listSessions(queryChannelId);
    const filtered = sessions.filter(s => matcher(s.sessionName) || matcher(s.autoSessionName));
    const lines = filtered.map(s => {
        const name = s.sessionName || s.autoSessionName || '';
        const currentAttr = currentChannelId && s.channelId === currentChannelId ? ' current="1"' : '';
        return `  <session id="${s.id}"${currentAttr} name="${escapeAttr(name)}" />`;
    });
    return `<sessions channel_id="${scope}" count="${filtered.length}" total="${sessions.length}">\n${lines.join('\n')}\n</sessions>`;
}

async function buildUsersBlock(scope: string, queryChannelId: string | undefined, matcher: (s: string) => boolean): Promise<string> {
    const users = await channelDataService.listChannelUsers(queryChannelId);
    const filtered = users.filter(u => matcher(u.userName ?? ''));
    const lines = filtered.map(u =>
        `  <user id="${u.id}" channel_id="${u.channelId}" user_id="${u.userId}" name="${escapeAttr(u.userName ?? '')}" />`
    );
    return `<users channel_id="${scope}" count="${filtered.length}" total="${users.length}">\n${lines.join('\n')}\n</users>`;
}

export function createChannelListTool(currentChannelId?: string): StructuredToolInterface {
    return new DynamicStructuredTool({
        name: CHANNEL_LIST_TOOL_NAME,
        description: loadPrompt('tools/channel/list.txt'),
        schema: z.object({
            type: z.enum(ChannelListType).describe('What to list. "channel" ignores channel_id; "session_and_user" emits both blocks under the same filter.'),
            channel_id: z.string().optional().describe('Channel scope for type=session/user/session_and_user. Omit to query across all channels.'),
            name_pattern: z.string().optional().describe('JavaScript regex (case-insensitive) matched against the entry name. Omit to list all.'),
        }) as any,
        func: async ({ type, channel_id, name_pattern }: any): Promise<MCPToolResult> => {
            const { matcher, error: patternError } = compilePattern(name_pattern);
            if (patternError) return createErrorResult(patternError);

            try {
                if (type === ChannelListType.Channel) {
                    const all = Object.entries(config.settings.channels ?? {});
                    const filtered = all.filter(([, c]) => matcher(c.name ?? ''));
                    const lines = filtered.map(([id, c]) => {
                        const caps = channelManager.getChannelCapabilities(id).join(',');
                        return `  <channel id="${id}" type="${c.type}" name="${escapeAttr(c.name ?? '')}" caps="${caps}" />`;
                    });
                    return createSuccessResult(createTextContent(
                        `<channels count="${filtered.length}" total="${all.length}">\n${lines.join('\n')}\n</channels>`
                    ));
                }

                const scope = channel_id || '*';
                const queryChannelId = scope === '*' ? undefined : scope;

                if (type === ChannelListType.Session) {
                    return createSuccessResult(createTextContent(await buildSessionsBlock(scope, queryChannelId, matcher, currentChannelId)));
                }
                if (type === ChannelListType.User) {
                    return createSuccessResult(createTextContent(await buildUsersBlock(scope, queryChannelId, matcher)));
                }
                // ChannelListType.SessionAndUser
                const [sessionsBlock, usersBlock] = await Promise.all([
                    buildSessionsBlock(scope, queryChannelId, matcher, currentChannelId),
                    buildUsersBlock(scope, queryChannelId, matcher),
                ]);
                return createSuccessResult(createTextContent(`${sessionsBlock}\n${usersBlock}`));
            } catch (e: any) {
                logger.error(`${CHANNEL_LIST_TOOL_NAME} failed: ${e.message}`);
                return createErrorResult(`Failed to list: ${e.message}`);
            }
        },
    });
}
