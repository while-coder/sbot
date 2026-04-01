import {
  ChannelPlugin, ChannelPluginContext, IChannelService,
  SessionService, ChannelSessionHandler, getPluginThreadId,
} from "channel.base";
import { SlackService } from "./SlackService";
import { SlackSessionHandler, SlackMessageArgs, SlackActionArgs } from "./SlackSessionHandler";
export const slackPlugin: ChannelPlugin = {
  type: "slack",

  configSchema: {
    botToken: { label: 'Bot Token', type: 'string', required: true, description: 'Slack bot token (xoxb-...)' },
    appToken: { label: 'App Token', type: 'string', required: true, description: 'Slack app-level token (xapp-...)' },
  },

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { channelId, config, logger, handleReceiveMessage, onReceiveMessage, onTriggerAction } = ctx;

    if (!config.botToken?.trim() || !config.appToken?.trim()) {
      logger.warn?.(`Slack channel [${config.name || channelId}] missing botToken or appToken, skipping`);
      return undefined;
    }

    const service = new SlackService({
      botToken: config.botToken,
      appToken: config.appToken,
      logger,
      onReceiveMessage: async (userId: string, userInfo: any, args: SlackMessageArgs, query: string) => {
        const threadId = getPluginThreadId(slackPlugin, channelId, args.channel);
        await handleReceiveMessage({
          channelId,
          userId,
          userName: userInfo?.real_name ?? userInfo?.name ?? '',
          userInfo: JSON.stringify(userInfo ?? {}),
          sessionId: args.channel,
          sessionName: args.channel,
          processMessage: (dbSessionId: number) =>
            onReceiveMessage(query, threadId, { ...args, channelType: 'slack', userInfo: userInfo ?? {}, channelId, dbSessionId }),
          sendUpdate: (msg: string) => service.sendMessage(args.channel, msg, args.threadTs).then(() => {}),
        });
      },
      onTriggerAction: async (userId: string, args: SlackActionArgs) => {
        const threadId = getPluginThreadId(slackPlugin, channelId, args.channel);
        await onTriggerAction(threadId, args);
      },
    });
    await service.registerEventHandlers();
    logger.info?.(`Slack channel [${config.name || channelId}] started successfully`);
    return service;
  },

  createUserService(session: SessionService): ChannelSessionHandler {
    return new SlackSessionHandler(session);
  },
};
