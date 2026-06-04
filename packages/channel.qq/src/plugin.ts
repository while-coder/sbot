import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from 'channel.base';
import { QqService } from './QqService';
import type { QqMessageArgs, QqActionArgs } from './QqSessionHandler';

function buildQqExtraInfo(args: QqMessageArgs): string {
  return `<qq-user>
  <chat-type>${args.chatType}</chat-type>
  <user-openid>${args.userOpenId}</user-openid>${args.groupOpenId ? `\n  <group-openid>${args.groupOpenId}</group-openid>` : ''}
</qq-user>`;
}

export const qqPlugin: ChannelPlugin = {
  type: 'qq',
  label: 'QQ',

  configSchema: {
    appId: {
      label: 'App ID', type: ConfigFieldType.String, required: true,
      description: 'QQ 开放平台机器人 App ID',
    },
    clientSecret: {
      label: 'Client Secret', type: ConfigFieldType.Password, required: true,
      description: 'QQ 开放平台机器人 AppSecret（即 Client Secret）',
    },
    atSenderOnReply: {
      label: '群聊回复时 @ 发送者', type: ConfigFieldType.Boolean, default: false,
      description: '群聊回复时是否 @ 提问者（QQ 官方 Bot API 不直接支持，目前仅作为 metadata）',
    },
  },

  tools: [
    { name: '_ask', label: '询问用户' },
  ],

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, filterEvent, initSession, onReceiveMessage, onTriggerAction } = ctx;

    if (!config.appId?.trim() || !config.clientSecret?.trim()) return undefined;

    const service = new QqService({
      appId: config.appId,
      clientSecret: config.clientSecret,
      atSenderOnReply: config.atSenderOnReply === true,
      logger,
      filterEvent,
      onReceiveMessage: async (userId: string, args: QqMessageArgs, query: MessageContent) => {
        const session = await initSession({
          userId,
          userName: userId.slice(-8),
          userInfo: JSON.stringify({ userOpenId: args.userOpenId, groupOpenId: args.groupOpenId }),
          sessionId: args.sessionId,
          sessionName: args.chatType === 'group' ? `group_${args.groupOpenId?.slice(-8)}` : `c2c_${args.userOpenId.slice(-8)}`,
          sendUpdate: (msg: string) => service.sendMarkdownOrText(args.sessionId, msg).then(() => {}),
        });
        await onReceiveMessage(session, query, {
          ...args,
          extraInfo: buildQqExtraInfo(args),
        });
      },
      onTriggerAction: async (userId: string, args: QqActionArgs) => {
        const session = await initSession({
          userId,
          userName: userId,
          userInfo: JSON.stringify({ userOpenId: userId }),
          sessionId: args.sessionId,
          sessionName: args.sessionId,
        });
        await onTriggerAction(session, args);
      },
    });
    await service.start();
    return service;
  },
};
