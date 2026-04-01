import {
  ChannelPlugin, ChannelPluginContext, IChannelService,
  SessionService, ChannelSessionHandler, getPluginThreadId,
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
    const { channelId, config, logger, filterEvent, handleReceiveMessage, onReceiveMessage, onTriggerAction } = ctx;

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
        const threadId = getPluginThreadId(larkPlugin, channelId, args.chat_id);
        const sessionName = chatInfo
          ? (chatInfo.chat_mode === 'p2p' ? `p2p_${userId}` : `${chatInfo.chat_mode}_${chatInfo.name}`)
          : '';
        await handleReceiveMessage({
          channelId,
          userId,
          userName: userInfo?.name ?? '',
          userInfo: JSON.stringify(userInfo ?? {}),
          sessionId: args.chat_id,
          sessionName,
          processMessage: (dbSessionId: number) =>
            onReceiveMessage(query, threadId, { ...args, channelType: 'lark', userInfo: userInfo ?? {}, channelId, dbSessionId }),
          sendUpdate: (msg: string) => service.sendMarkdownMessage(LarkReceiveIdType.ChatId, args.chat_id, msg).then(() => {}),
          userAvatar: userInfo?.avatar?.avatar_origin,
          sessionAvatar: chatInfo?.avatar || '',
        });
      },
      onTriggerAction: async (_userId: string, _userInfo: any, _chatInfo: any, args: LarkActionArgs) => {
        const threadId = getPluginThreadId(larkPlugin, channelId, args.chat_id);
        await onTriggerAction(threadId, args);
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
