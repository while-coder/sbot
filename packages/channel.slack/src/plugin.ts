import {
  ChannelPlugin, ChannelPluginContext, IChannelService,
} from "channel.base";
import { SlackService } from "./SlackService";
import { SlackMessageArgs, SlackActionArgs } from "./SlackSessionHandler";
export const slackPlugin: ChannelPlugin = {
  type: "slack",

  configSchema: {
    botToken: { label: 'Bot Token', type: 'string', required: true, description: 'Slack bot token (xoxb-...)' },
    appToken: { label: 'App Token', type: 'string', required: true, description: 'Slack app-level token (xapp-...)' },
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
          sessionId: args.channel,
          sessionName: args.channel,
          sendUpdate: (msg: string) => service.sendMessage(args.channel, msg, args.threadTs).then(() => {}),
        });
        await onReceiveMessage(session, query, { ...args, userInfo: userInfo ?? {} });
      },
      onTriggerAction: async (userId: string, args: SlackActionArgs) => {
        const session = await initSession({
          userId,
          userName: '',
          userInfo: '',
          sessionId: args.channel,
          sessionName: args.channel,
        });
        await onTriggerAction(session, args);
      },
    });
    await service.registerEventHandlers();
    return service;
  },
};
