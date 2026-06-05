import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from 'channel.base';
import { DingtalkService } from './DingtalkService';
import type { DingtalkMessageArgs } from './DingtalkSessionHandler';

function buildDingtalkExtraInfo(senderStaffId: string, senderNick: string, conversationType: '1' | '2'): string {
  return `<dingtalk-user>
  <staffid>${senderStaffId}</staffid>
  <nickname>${senderNick}</nickname>
  <chat-type>${conversationType === '2' ? 'group' : 'p2p'}</chat-type>
</dingtalk-user>`;
}

export const dingtalkPlugin: ChannelPlugin = {
  type: 'dingtalk',
  label: '钉钉 / DingTalk',

  configSchema: {
    clientId: {
      label: 'Client ID', type: ConfigFieldType.String, required: true,
      description: '钉钉应用 Client ID（即 AppKey）',
    },
    clientSecret: {
      label: 'Client Secret', type: ConfigFieldType.Password, required: true,
      description: '钉钉应用 Client Secret（即 AppSecret）',
    },
  },

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, filterEvent, initSession, onReceiveMessage } = ctx;

    if (!config.clientId?.trim() || !config.clientSecret?.trim()) return undefined;

    const clientId = config.clientId.trim();
    const service = new DingtalkService({
      clientId,
      clientSecret: config.clientSecret,
      logger,
      filterEvent,
      onReceiveMessage: async (userId: string, args: DingtalkMessageArgs, query: MessageContent) => {
        const session = await initSession({
          userId,
          userName: args.senderNick,
          userInfo: JSON.stringify({ staffId: userId, nick: args.senderNick }),
          sessionId: args.sessionId,
          sessionName: args.conversationType === '2' ? `group_${args.sessionId.slice(-8)}` : `p2p_${args.senderNick}`,
          sendUpdate: (msg: string) => service.sendMarkdown(args.sessionId, msg).then(() => {}),
        });
        await onReceiveMessage(session, query, {
          ...args,
          extraInfo: buildDingtalkExtraInfo(args.senderStaffId, args.senderNick, args.conversationType),
        });
      },
    });
    await service.start();
    return service;
  },
};
