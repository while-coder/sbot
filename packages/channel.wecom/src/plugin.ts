import {
  ChannelPlugin, ChannelPluginContext, IChannelService,
  SessionService, ChannelSessionHandler,
} from "channel.base";
import { WecomService } from "./WecomService";
import type { WecomMessageArgs, WecomActionArgs } from "./WecomService";
import { WecomSessionHandler } from "./WecomSessionHandler";
import { wecomThreadId } from "sbot.commons";

export const wecomPlugin: ChannelPlugin = {
  type: "wecom",

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { channelId, config, logger, filterEvent, handleReceiveMessage, onReceiveMessage, onTriggerAction } = ctx;

    if (!config.botId?.trim() || !config.secret?.trim()) {
      logger.warn?.(`WeCom channel [${config.name || channelId}] missing botId or secret, skipping`);
      return undefined;
    }

    const service = new WecomService({
      botId: config.botId,
      secret: config.secret,
      logger,
      filterEvent,
      onReceiveMessage: async (userId: string, args: WecomMessageArgs, query: string) => {
        const threadId = wecomThreadId(channelId, args.chatid);
        await handleReceiveMessage({
          channelId,
          userId,
          userName: userId,
          userInfo: JSON.stringify({ userid: userId }),
          sessionId: args.chatid,
          sessionName: args.chatid,
          processMessage: (dbSessionId: number) =>
            onReceiveMessage(query, threadId, { ...args, channelType: 'wecom', userInfo: { userid: userId }, channelId, dbSessionId }),
          sendUpdate: (msg: string) => service.sendMessage(args.chatid, { msgtype: 'markdown', markdown: { content: msg } } as any).then(() => {}),
        });
      },
      onTriggerAction: async (_userId: string, args: WecomActionArgs) => {
        const threadId = wecomThreadId(channelId, args.chatid);
        await onTriggerAction(threadId, args);
      },
    });
    service.connect();
    logger.info?.(`WeCom channel [${config.name || channelId}] started successfully`);
    return service;
  },

  createUserService(session: SessionService): ChannelSessionHandler {
    return new WecomSessionHandler(session);
  },
};
