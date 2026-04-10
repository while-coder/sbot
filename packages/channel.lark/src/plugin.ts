import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from "channel.base";
import { LarkService, LarkReceiveIdType, LarkUserIdType } from "./LarkService";
import { LarkMessageArgs, LarkActionArgs } from "./LarkSessionHandler";

function buildLarkExtraInfo(userInfo: any): string {
  if (!userInfo) return '';
  return `<lark-user>
  <name>${userInfo.name}</name>
  <email>${userInfo.email}</email>
  <user-id>${userInfo.user_id}</user-id>
  <open-id>${userInfo.open_id}</open-id>
  <union-id>${userInfo.union_id}</union-id>
</lark-user>`;
}
export const larkPlugin: ChannelPlugin = {
  type: "lark",

  configSchema: {
    appId:     { label: 'App ID',     type: ConfigFieldType.String, required: true, description: 'Lark app ID' },
    appSecret: { label: 'App Secret', type: ConfigFieldType.Password, required: true, description: 'Lark app secret' },
  },

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, filterEvent, initSession, onReceiveMessage, onTriggerAction } = ctx;

    if (!config.appId?.trim() || !config.appSecret?.trim()) return undefined;

    const service = new LarkService({
      appId: config.appId,
      appSecret: config.appSecret,
      logger,
      userIdType: LarkUserIdType.UnionId,
      filterEvent,
      onReceiveMessage: async (userId: string, userInfo: any, chatInfo: any, args: LarkMessageArgs, query: MessageContent) => {
        const sessionName = chatInfo
          ? (chatInfo.chat_mode === 'p2p' ? `p2p_${userId}` : `${chatInfo.chat_mode}_${chatInfo.name}`)
          : '';
        const session = await initSession({
          userId,
          userName: userInfo?.name ?? '',
          userInfo: JSON.stringify(userInfo ?? {}),
          sessionId: args.sessionId,
          sessionName,
          sendUpdate: (msg: string) => service.sendMarkdownMessage(LarkReceiveIdType.ChatId, args.sessionId, msg).then(() => {}),
          userAvatar: userInfo?.avatar?.avatar_origin,
          sessionAvatar: chatInfo?.avatar || '',
        });
        await onReceiveMessage(session, query, { ...args, extraInfo: buildLarkExtraInfo(userInfo) });
      },
      onTriggerAction: async (userId: string, userInfo: any, chatInfo: any, args: LarkActionArgs) => {
        const sessionName = chatInfo
          ? (chatInfo.chat_mode === 'p2p' ? `p2p_${userId}` : `${chatInfo.chat_mode}_${chatInfo.name}`)
          : '';
        const session = await initSession({
          userId,
          userName: userInfo?.name ?? '',
          userInfo: JSON.stringify(userInfo ?? {}),
          sessionId: args.sessionId,
          sessionName,
          userAvatar: userInfo?.avatar?.avatar_origin,
          sessionAvatar: chatInfo?.avatar || '',
        });
        await onTriggerAction(session, args);
      },
    });
    await service.registerEventDispatcher();
    return service;
  },

};
