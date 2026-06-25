import {
  defineChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from "channel.base";
import { LarkService, LarkReceiveIdType, LarkUserIdType, type LarkUserInfo, type LarkChatInfo, type LarkDomain } from "./LarkService";
import { LarkMessageArgs, LarkActionArgs } from "./LarkSessionHandler";

function buildLarkExtraInfo(userInfo: LarkUserInfo | undefined, chatId?: string, messageId?: string): string {
  if (!userInfo) return '';
  return `<lark-info>
  <name>${userInfo.name}</name>
  <email>${userInfo.email}</email>
  <union-id>${userInfo.union_id}</union-id>
  <chat-id>${chatId ?? ''}</chat-id>
  <message-id>${messageId ?? ''}</message-id>
</lark-info>`;
}
const LARK_CHANNEL_PROMPT = `<channel-info name="lark">
你的输出会以飞书卡片 markdown 元素渲染，支持流式更新：
- 支持飞书 markdown 子集（标题、加粗、列表、链接、行内代码、代码块）。
- 表格请用列表代替，飞书 markdown 元素对表格支持有限。
</channel-info>`;

export const larkPlugin = defineChannelPlugin({
  type: "lark",
  label: "飞书 / Lark",
  channelPrompt: LARK_CHANNEL_PROMPT,

  configSchema: {
    domain:    { label: '部署域',     type: ConfigFieldType.Select, required: true, default: 'feishu',
                 description: '飞书（国内 open.feishu.cn）或 Lark（海外 open.larksuite.com）',
                 options: [
                   { label: '飞书（国内）', value: 'feishu' },
                   { label: 'Lark（海外）', value: 'lark' },
                 ] },
    appId:     { label: 'App ID',     type: ConfigFieldType.String, required: true, description: 'Lark app ID' },
    appSecret: { label: 'App Secret', type: ConfigFieldType.Password, required: true, description: 'Lark app secret' },
  },

  tools: [
    { name: '_ask', label: '询问用户' },
    { name: '_get_message_history', label: '获取消息历史' },
  ],

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, filterEvent, initSession, onReceiveMessage, onTriggerAction } = ctx;

    if (!config.appId?.trim() || !config.appSecret?.trim()) return undefined;

    const service = new LarkService({
      appId: config.appId,
      appSecret: config.appSecret,
      domain: (config.domain as LarkDomain) ?? 'feishu',
      logger,
      userIdType: LarkUserIdType.UnionId,
      filterEvent,
      onReceiveMessage: async (userId: string, userInfo: LarkUserInfo | undefined, chatInfo: LarkChatInfo | undefined, args: LarkMessageArgs, query: MessageContent) => {
        const sessionName = chatInfo
          ? (chatInfo.chat_mode === 'p2p' ? `p2p_${userInfo?.name || userId}` : `${chatInfo.chat_mode}_${chatInfo.name}`)
          : '';
        const session = await initSession({
          userId,
          userName: userInfo?.name ?? '',
          userInfo: JSON.stringify(userInfo ?? {}),
          sessionId: args.sessionId,
          sessionName,
          sendUpdate: (msg: string) => service.sendMarkdownMessage(LarkReceiveIdType.ChatId, args.sessionId, msg).then(() => {}, () => {}),
          userAvatar: userInfo?.avatar?.avatar_origin,
          sessionAvatar: chatInfo?.avatar || '',
        });
        await onReceiveMessage(session, query, { ...args, extraInfo: buildLarkExtraInfo(userInfo, args.sessionId, args.message_id) });
      },
      onTriggerAction: async (userId: string, userInfo: LarkUserInfo | undefined, chatInfo: LarkChatInfo | undefined, args: LarkActionArgs) => {
        const sessionName = chatInfo
          ? (chatInfo.chat_mode === 'p2p' ? `p2p_${userInfo?.name || userId}` : `${chatInfo.chat_mode}_${chatInfo.name}`)
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

});
