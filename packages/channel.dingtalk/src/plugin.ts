import {
  defineChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from 'channel.base';
import { DingtalkConversationType, DingtalkService } from './DingtalkService';
import type { DingtalkMessageArgs } from './DingtalkSessionHandler';

function buildDingtalkExtraInfo(senderStaffId: string, senderNick: string, conversationType: DingtalkConversationType): string {
  return `<dingtalk-user>
  <staffid>${senderStaffId}</staffid>
  <nickname>${senderNick}</nickname>
  <chat-type>${conversationType === DingtalkConversationType.Group ? 'group' : 'p2p'}</chat-type>
</dingtalk-user>`;
}

const DINGTALK_CHANNEL_PROMPT = `<channel-info name="dingtalk">
你的输出会以钉钉 markdown 渲染：
- 普通 markdown 消息**不支持原地更新**，因此你的回答只在最后一次性发出，中间过程不会显示。请直接给最终答案，不要讲"我先 xxx，再 xxx"这种过程描述。
- 支持标准 markdown（标题、列表、代码块、图片、链接、表格）。
</channel-info>`;

export const dingtalkPlugin = defineChannelPlugin({
  type: 'dingtalk',
  label: '钉钉 / DingTalk',
  channelPrompt: DINGTALK_CHANNEL_PROMPT,

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
    const { config, logger, filterEvent, initSession, loadSessionMetadata, onReceiveMessage } = ctx;

    if (!config.clientId?.trim() || !config.clientSecret?.trim()) return undefined;

    const clientId = config.clientId.trim();
    const service = new DingtalkService({
      clientId,
      clientSecret: config.clientSecret,
      logger,
      filterEvent,
      onReceiveMessage: async (userId: string, args: DingtalkMessageArgs, query: MessageContent) => {
        const isGroup = args.conversationType === DingtalkConversationType.Group;
        const session = await initSession({
          userId,
          userName: args.senderNick,
          userInfo: JSON.stringify({ staffId: userId, nick: args.senderNick }),
          sessionId: args.sessionId,
          sessionName: isGroup ? `group_${args.sessionId.slice(-8)}` : `p2p_${args.senderNick}`,
          sendUpdate: (msg: string) => service.sendTextToSession(args.sessionId, msg).then(() => {}),
          // 群聊发送只需 conversationType（用 conversationId=sessionId 投递）；
          // 单聊还需 senderStaffId（batchSend 目标）。staffId 在 p2p 中稳定，避免群聊每条消息触发写库。
          metadata: isGroup
            ? { conversationType: args.conversationType }
            : { conversationType: args.conversationType, senderStaffId: args.senderStaffId },
        });
        await onReceiveMessage(session, query, {
          ...args,
          extraInfo: buildDingtalkExtraInfo(args.senderStaffId, args.senderNick, args.conversationType),
        });
      },
    });
    service.hydrateSessions(await loadSessionMetadata());
    await service.start();
    return service;
  },
});
