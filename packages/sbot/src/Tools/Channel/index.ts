import { type StructuredToolInterface } from '@langchain/core/tools';

export const CHANNEL_LIST_TOOL_NAME = 'channel_list_data' as const;
export const CHANNEL_SEND_MESSAGE_TOOL_NAME = 'channel_send_message' as const;
export const CHANNEL_SEND_FILE_TOOL_NAME = 'channel_send_file' as const;

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
export { createChannelSendMessageTool } from './sendMessage';
export { createChannelSendFileTool } from './sendFile';

import { createChannelListTool } from './list';
import { createChannelSendMessageTool } from './sendMessage';
import { createChannelSendFileTool } from './sendFile';

export function createChannelTools(currentChannelId?: string): StructuredToolInterface[] {
    return [
        createChannelListTool(currentChannelId),
        createChannelSendMessageTool(),
        createChannelSendFileTool(),
    ];
}
