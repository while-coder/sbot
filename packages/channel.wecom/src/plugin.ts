import {
  ChannelPlugin, ChannelPluginContext, IChannelService,
  SessionService, ChannelSessionHandler,
} from "channel.base";
import { WecomService } from "./WecomService";
import type { WecomMessageArgs, WecomActionArgs } from "./WecomService";
import { WecomSessionHandler } from "./WecomSessionHandler";
export const wecomPlugin: ChannelPlugin = {
  type: "wecom",

  configSchema: {
    botId:  { label: 'Bot ID',  type: 'string', required: true, description: 'WeCom bot ID' },
    secret: { label: 'Secret',  type: 'string', required: true, description: 'WeCom bot secret' },
  },

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { channelId, config, logger, filterEvent, initSession, onReceiveMessage, onTriggerAction } = ctx;

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
        const session = await initSession({
          userId,
          userName: userId,
          userInfo: JSON.stringify({ userid: userId }),
          sessionId: args.chatid,
          sessionName: args.chatid,
          sendUpdate: (msg: string) => service.sendMessage(args.chatid, { msgtype: 'markdown', markdown: { content: msg } } as any).then(() => {}),
        });
        await onReceiveMessage(session, query, { ...args, userInfo: { userid: userId } });
      },
      onTriggerAction: async (userId: string, args: WecomActionArgs) => {
        const session = await initSession({
          userId,
          userName: userId,
          userInfo: JSON.stringify({ userid: userId }),
          sessionId: args.chatid,
          sessionName: args.chatid,
        });
        await onTriggerAction(session, args);
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
