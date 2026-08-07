import {
  ConfigFieldType, defineChannelPlugin,
  type ChannelPluginContext, type IChannelService, type MessageContent,
} from 'channel.base';
import { YuanbaoService } from './YuanbaoService';
import type { YuanbaoMessageArgs } from './YuanbaoSessionHandler';

const YUANBAO_CHANNEL_PROMPT = `<channel-info name="yuanbao">
你正运行在腾讯元宝 Bot 频道：
- 回复会以纯文本发送，不要依赖 markdown 表格、HTML 或交互组件。
- 用短段落、空行和序号组织内容。
</channel-info>`;

function buildExtraInfo(args: YuanbaoMessageArgs): string {
  return `<yuanbao-user>
  <chat-type>${args.chatType}</chat-type>
  <sender-id>${args.senderId}</sender-id>${args.groupCode ? `\n  <group-code>${args.groupCode}</group-code>` : ''}
</yuanbao-user>`;
}

export const yuanbaoPlugin = defineChannelPlugin({
  type: 'yuanbao',
  label: '元宝',
  channelPrompt: YUANBAO_CHANNEL_PROMPT,
  configSchema: {
    appId: {
      label: 'App ID', type: ConfigFieldType.String, required: true,
      description: '腾讯元宝「我的 Bot」中获取的 AppID',
    },
    appSecret: {
      label: 'App Secret', type: ConfigFieldType.Password, required: true,
      description: '腾讯元宝「我的 Bot」中获取的 AppSecret',
    },
    requireMention: {
      label: '群聊需@触发', type: ConfigFieldType.Boolean, default: true,
      description: '群聊中仅响应明确 @Bot 的消息',
    },
    acceptBotMessages: {
      label: '接收 Bot 消息', type: ConfigFieldType.Boolean, default: false,
      description: '允许处理其他 Bot 发来的消息',
    },
  },
  tools: [{ name: '_send_file', label: '发送文件' }],

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, filterEvent, initSession, loadSessionMetadata, onReceiveMessage } = ctx;
    const appId = String(config.appId ?? '').trim();
    const appSecret = String(config.appSecret ?? '').trim();
    if (!appId || !appSecret) return undefined;

    const service = new YuanbaoService({
      appId,
      appSecret,
      requireMention: config.requireMention !== false,
      acceptBotMessages: config.acceptBotMessages === true,
      logger,
      filterEvent,
      onReceiveMessage: async (userId: string, args: YuanbaoMessageArgs, query: MessageContent) => {
        const session = await initSession({
          userId,
          userOpenId: args.senderId,
          userName: args.senderName,
          userInfo: JSON.stringify({ senderId: args.senderId, senderName: args.senderName }),
          sessionId: args.sessionId,
          sessionName: args.chatType === 'group'
            ? (args.groupName || `group_${args.groupCode?.slice(-8)}`)
            : `c2c_${args.senderId.slice(-8)}`,
          sendUpdate: message => service.sendTextToSession(args.sessionId, message),
          metadata: {
            chatType: args.chatType,
            senderId: args.senderId,
            targetId: args.chatType === 'group' ? args.groupCode : args.senderId,
          },
        });
        await onReceiveMessage(session, query, { ...args, extraInfo: buildExtraInfo(args) });
      },
    });
    service.restoreSessions(await loadSessionMetadata());
    await service.start();
    return service;
  },
});
