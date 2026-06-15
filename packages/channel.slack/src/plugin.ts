import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from "channel.base";
import { SlackService } from "./SlackService";
import { SlackMessageArgs } from "./SlackSessionHandler";

function buildSlackExtraInfo(userInfo: any): string {
  if (!userInfo) return '';
  return `<slack-user>
  <id>${userInfo.id}</id>
  <name>${userInfo.real_name ?? userInfo.name ?? ""}</name>
  <email>${userInfo.profile?.email ?? ""}</email>
</slack-user>`;
}
const SLACK_CHANNEL_PROMPT = `<channel-info name="slack">
你的输出会以 Slack mrkdwn 渲染（不是标准 markdown）：
- 粗体用 \`*单星号*\`，不是 \`**双星号**\`。
- 斜体用 \`_下划线_\`。
- 不支持 \`#\` 标题语法，用粗体行代替。
- 代码块用三反引号，行内代码用单反引号。
- 链接用 \`<https://url|文字>\` 格式。
</channel-info>`;

export const slackPlugin: ChannelPlugin = {
  type: "slack",
  label: "Slack",
  channelPrompt: SLACK_CHANNEL_PROMPT,

  configSchema: {
    botToken: { label: 'Bot Token', type: ConfigFieldType.Password, required: true, description: 'Slack bot token (xoxb-...)' },
    appToken: { label: 'App Token', type: ConfigFieldType.Password, required: true, description: 'Slack app-level token (xapp-...)' },
  },

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, initSession, onReceiveMessage } = ctx;

    if (!config.botToken?.trim() || !config.appToken?.trim()) return undefined;

    const service = new SlackService({
      botToken: config.botToken,
      appToken: config.appToken,
      logger,
      onReceiveMessage: async (userId: string, userInfo: any, args: SlackMessageArgs, query: MessageContent) => {
        const session = await initSession({
          userId,
          userName: userInfo?.real_name ?? userInfo?.name ?? '',
          userInfo: JSON.stringify(userInfo ?? {}),
          sessionId: args.sessionId,
          sessionName: args.sessionId,
          sendUpdate: (msg: string) => service.sendMessage(args.sessionId, msg, args.threadTs).then(() => {}),
        });
        await onReceiveMessage(session, query, { ...args, extraInfo: buildSlackExtraInfo(userInfo) });
      },
    });
    await service.registerEventHandlers();
    return service;
  },
};
