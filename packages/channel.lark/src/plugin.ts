import {
  ChannelPlugin, ChannelPluginContext, IChannelService,
  SessionService, ChannelSessionHandler,
} from "channel.base";
import { LarkService, LarkReceiveIdType, LarkUserIdType } from "./LarkService";
import { LarkSessionHandler, LarkMessageArgs, LarkActionArgs } from "./LarkSessionHandler";
export const larkPlugin: ChannelPlugin = {
  type: "lark",

  configSchema: {
    appId:     { label: 'App ID',     type: 'string', required: true, description: 'Lark app ID' },
    appSecret: { label: 'App Secret', type: 'string', required: true, description: 'Lark app secret' },
  },

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { channelId, config, logger, filterEvent, initSession, onReceiveMessage, onTriggerAction } = ctx;

    if (!config.appId?.trim() || !config.appSecret?.trim()) {
      logger.warn?.(`Lark channel [${config.name || channelId}] missing appId or appSecret, skipping`);
      return undefined;
    }

    const service = new LarkService({
      appId: config.appId,
      appSecret: config.appSecret,
      logger,
      userIdType: LarkUserIdType.UnionId,
      filterEvent,
      onReceiveMessage: async (userId: string, userInfo: any, chatInfo: any, args: LarkMessageArgs, query: string) => {
        const sessionName = chatInfo
          ? (chatInfo.chat_mode === 'p2p' ? `p2p_${userId}` : `${chatInfo.chat_mode}_${chatInfo.name}`)
          : '';
        const session = await initSession({
          userId,
          userName: userInfo?.name ?? '',
          userInfo: JSON.stringify(userInfo ?? {}),
          sessionId: args.chat_id,
          sessionName,
          sendUpdate: (msg: string) => service.sendMarkdownMessage(LarkReceiveIdType.ChatId, args.chat_id, msg).then(() => {}),
          userAvatar: userInfo?.avatar?.avatar_origin,
          sessionAvatar: chatInfo?.avatar || '',
        });
        await onReceiveMessage(session, query, { ...args, userInfo: userInfo ?? {} });
      },
      onTriggerAction: async (userId: string, userInfo: any, chatInfo: any, args: LarkActionArgs) => {
        const sessionName = chatInfo
          ? (chatInfo.chat_mode === 'p2p' ? `p2p_${userId}` : `${chatInfo.chat_mode}_${chatInfo.name}`)
          : '';
        const session = await initSession({
          userId,
          userName: userInfo?.name ?? '',
          userInfo: JSON.stringify(userInfo ?? {}),
          sessionId: args.chat_id,
          sessionName,
          userAvatar: userInfo?.avatar?.avatar_origin,
          sessionAvatar: chatInfo?.avatar || '',
        });
        await onTriggerAction(session, args);
      },
    });
    await service.registerEventDispatcher();
    logger.info?.(`Lark channel [${config.name || channelId}] started successfully`);
    return service;
  },

  createUserService(session: SessionService): ChannelSessionHandler {
    return new LarkSessionHandler(session);
  },
};
