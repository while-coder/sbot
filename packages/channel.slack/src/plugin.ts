import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
} from "channel.base";
import { SlackService } from "./SlackService";
import { SlackMessageArgs, SlackActionArgs } from "./SlackSessionHandler";

function buildSlackExtraInfo(userInfo: any): string {
  if (!userInfo) return '';
  return `<slack-user>
  <id>${userInfo.id}</id>
  <name>${userInfo.real_name ?? userInfo.name ?? ""}</name>
  <email>${userInfo.profile?.email ?? ""}</email>
</slack-user>`;
}
export const slackPlugin: ChannelPlugin = {
  type: "slack",

  configSchema: {
    botToken: { label: 'Bot Token', type: ConfigFieldType.String, required: true, description: 'Slack bot token (xoxb-...)' },
    appToken: { label: 'App Token', type: ConfigFieldType.String, required: true, description: 'Slack app-level token (xapp-...)' },
  },

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, initSession, onReceiveMessage, onTriggerAction } = ctx;

    if (!config.botToken?.trim() || !config.appToken?.trim()) return undefined;

    const service = new SlackService({
      botToken: config.botToken,
      appToken: config.appToken,
      logger,
      onReceiveMessage: async (userId: string, userInfo: any, args: SlackMessageArgs, query: string) => {
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
      onTriggerAction: async (userId: string, args: SlackActionArgs) => {
        const session = await initSession({
          userId,
          userName: '',
          userInfo: '',
          sessionId: args.sessionId,
          sessionName: args.sessionId,
        });
        await onTriggerAction(session, args);
      },
    });
    await service.registerEventHandlers();
    return service;
  },
};
