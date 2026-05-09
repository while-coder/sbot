import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from 'channel.base';
import { OnebotService } from './OnebotService';
import type { OnebotMessageArgs } from './OnebotService';

function buildOnebotExtraInfo(userId: number, nickname: string, groupId?: number): string {
  let info = `<onebot-user>\n  <userid>${userId}</userid>\n  <nickname>${nickname}</nickname>`;
  if (groupId) info += `\n  <groupid>${groupId}</groupid>`;
  info += '\n</onebot-user>';
  return info;
}

export const onebotPlugin: ChannelPlugin = {
  type: 'onebot',
  label: 'OneBot',

  configSchema: {
    wsHost: { label: 'WS Host', type: ConfigFieldType.String, description: 'WebSocket server bind host', default: '0.0.0.0' },
    wsPort: { label: 'WS Port', type: ConfigFieldType.Number, required: true, description: 'WebSocket server port', default: 6700 },
    accessToken: { label: 'Access Token', type: ConfigFieldType.Password, description: 'Optional access token for authentication' },
    requireMention: { label: '群聊需@触发', type: ConfigFieldType.Boolean, description: 'Require @bot mention in group chats', default: true },
  },

  tools: [
    { name: '_send_file', label: '发送文件' },
  ],

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, filterEvent, initSession, onReceiveMessage } = ctx;

    const wsPort = Number(config.wsPort);
    if (!wsPort) return undefined;

    const service = new OnebotService({
      wsHost: config.wsHost?.trim() || '0.0.0.0',
      wsPort,
      accessToken: config.accessToken?.trim() || undefined,
      requireMention: config.requireMention !== false,
      logger,
      filterEvent,
      onReceiveMessage: async (userId: string, args: OnebotMessageArgs, query: MessageContent) => {
        const session = await initSession({
          userId,
          userName: args.nickname,
          userInfo: JSON.stringify({ userId: args.userId, nickname: args.nickname, groupId: args.groupId }),
          sessionId: args.sessionId,
          sessionName: args.nickname,
          sendUpdate: (msg: string) => service.sendTextMessage(
            { userId: args.userId, groupId: args.groupId },
            msg,
          ).then(() => {}),
        });
        await onReceiveMessage(session, query, {
          ...args,
          extraInfo: buildOnebotExtraInfo(args.userId, args.nickname, args.groupId),
        });
      },
    });

    service.start();
    return service;
  },
};
