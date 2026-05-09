import {
  ChannelPlugin, ChannelPluginContext, IChannelService, ConfigFieldType,
  type MessageContent,
} from "channel.base";
import { WecomService } from "./WecomService";
import type { WecomMessageArgs, WecomActionArgs } from "./WecomService";

function buildWecomExtraInfo(userId: string): string {
  if (!userId) return '';
  return `<wecom-user>
  <userid>${userId}</userid>
</wecom-user>`;
}
export const wecomPlugin: ChannelPlugin = {
  type: "wecom",
  label: "企业微信",

  configSchema: {
    botId:  { label: 'Bot ID',  type: ConfigFieldType.String, required: true, description: 'WeCom bot ID' },
    secret: { label: 'Secret',  type: ConfigFieldType.Password, required: true, description: 'WeCom bot secret' },
  },

  tools: [
    { name: '_send_file', label: '发送文件' },
  ],

  async init(ctx: ChannelPluginContext): Promise<IChannelService | undefined> {
    const { config, logger, filterEvent, initSession, onReceiveMessage, onTriggerAction } = ctx;

    if (!config.botId?.trim() || !config.secret?.trim()) return undefined;

    const service = new WecomService({
      botId: config.botId,
      secret: config.secret,
      logger,
      filterEvent,
      onReceiveMessage: async (userId: string, args: WecomMessageArgs, query: MessageContent) => {
        const session = await initSession({
          userId,
          userName: userId,
          userInfo: JSON.stringify({ userid: userId }),
          sessionId: args.sessionId,
          sessionName: args.sessionId,
          sendUpdate: (msg: string) => service.sendMessage(args.sessionId, { msgtype: 'markdown', markdown: { content: msg } } as any).then(() => {}),
        });
        await onReceiveMessage(session, query, { ...args, extraInfo: buildWecomExtraInfo(userId) });
      },
      onTriggerAction: async (userId: string, args: WecomActionArgs) => {
        const session = await initSession({
          userId,
          userName: userId,
          userInfo: JSON.stringify({ userid: userId }),
          sessionId: args.sessionId,
          sessionName: args.sessionId,
        });
        await onTriggerAction(session, args);
      },
    });
    service.connect();
    return service;
  },
};
