import {
  defineChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from 'channel.base';
import { QqService } from './QqService';
import type { QqMessageArgs } from './QqSessionHandler';

function buildQqExtraInfo(args: QqMessageArgs): string {
  return `<qq-user>
  <chat-type>${args.chatType}</chat-type>
  <user-openid>${args.userOpenId}</user-openid>${args.groupOpenId ? `\n  <group-openid>${args.groupOpenId}</group-openid>` : ''}
</qq-user>`;
}

const QQ_CHANNEL_PROMPT = `<channel-info name="qq">
你正运行在 QQ 开放平台机器人上，输出有以下硬约束：
- 严禁在回复中包含任何 URL 或网址。平台会拦截/吞掉链接，代码层会自动把 https://... 替换为 "[链接已省略]"。
  如需引用资料，只描述内容、不贴链接，或让用户主动索取。
- 富文本能力极有限，优先使用纯文本。markdown 仅模板化支持，不要依赖。
- 仅能"被动回复"近期收到的消息。
</channel-info>`;

export const qqPlugin = defineChannelPlugin({
  type: 'qq',
  label: 'QQ',
  channelPrompt: QQ_CHANNEL_PROMPT,

  configSchema: {
    appId: {
      label: 'App ID', type: ConfigFieldType.String, required: true,
      description: 'QQ 开放平台机器人 App ID',
    },
    clientSecret: {
      label: 'Client Secret', type: ConfigFieldType.Password, required: true,
      description: 'QQ 开放平台机器人 AppSecret（即 Client Secret）',
    },
  },

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, filterEvent, initSession, onReceiveMessage } = ctx;

    if (!config.appId?.trim() || !config.clientSecret?.trim()) return undefined;

    const service = new QqService({
      appId: config.appId,
      clientSecret: config.clientSecret,
      logger,
      filterEvent,
      onReceiveMessage: async (userId: string, args: QqMessageArgs, query: MessageContent) => {
        const session = await initSession({
          userId,
          userOpenId: args.userOpenId,
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
    });
    await service.start();
    return service;
  },
});
