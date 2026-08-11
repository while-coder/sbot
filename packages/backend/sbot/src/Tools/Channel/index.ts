import { type StructuredToolInterface } from '@langchain/core/tools';

export const CHANNEL_LIST_TOOL_NAME = 'channel_list_data' as const;
export const CHANNEL_SEND_TOOL_NAME = 'channel_send' as const;

export enum ChannelListType {
    Channel        = 'channel',
    Session        = 'session',
    User           = 'user',
    SessionAndUser = 'session_and_user',
}

export enum ChannelTargetType {
    Session = 'session',
    User    = 'user',
}

export { createChannelListTool } from './list';
export { createChannelSendTool } from './send';

import { createChannelListTool } from './list';
import { createChannelSendTool } from './send';

export function createChannelTools(currentChannelId?: string): StructuredToolInterface[] {
    return [
        createChannelListTool(currentChannelId),
        createChannelSendTool(),
    ];
}
