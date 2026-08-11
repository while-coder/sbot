import { App } from "@slack/bolt";
import { SlackMessageArgs, SlackSessionHandler } from "./SlackSessionHandler";
import { IChannelService, ChannelSessionHandler, SessionService, isEmptyContent, type ILogger, type MessageContent } from "channel.base";

export interface SlackServiceOptions {
  botToken: string;
  appToken: string;
  logger?: ILogger;
  onReceiveMessage: (
    userId: string,
    userInfo: any,
    args: SlackMessageArgs,
    query: MessageContent,
  ) => Promise<void>;
}

export class SlackService implements IChannelService {
  private app: App;
  private logger?: ILogger;
  private onReceiveMessage: SlackServiceOptions["onReceiveMessage"];
  // 速率限制：chat.update 全局排队，固定间隔 300ms
  private lastCallTime = 0;
  private readonly callInterval = 300;

  constructor(options: SlackServiceOptions) {
    this.logger = options.logger;
    this.onReceiveMessage = options.onReceiveMessage;

    this.app = new App({
      token: options.botToken,
      appToken: options.appToken,
      socketMode: true,
    });
  }

  createSessionHandler(session: SessionService): ChannelSessionHandler {
    return new SlackSessionHandler(session, this);
  }

  async sendTextToSession(sessionId: string, text: string): Promise<void> {
    await this.sendMessage(sessionId, text);
  }

  dispose() {
    this.app.stop().catch(() => {});
  }

  async sendMessage(
    channel: string,
    text: string,
    threadTs?: string,
  ): Promise<{ ts: string; channel: string }> {
    const result = await this.app.client.chat.postMessage({
      channel,
      text,
      ...(threadTs ? { thread_ts: threadTs } : {}),
    });
    if (!result.ok || !result.ts || !result.channel) {
      throw new Error(`Slack postMessage failed: ${result.error}`);
    }
    return { ts: result.ts, channel: result.channel };
  }

  async updateMessage(
    channel: string,
    ts: string,
    text: string,
    blocks?: any[],
  ): Promise<void> {
    while ((Date.now() - this.lastCallTime) < this.callInterval) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    this.lastCallTime = Date.now();
    await this.app.client.chat.update({
      channel,
      ts,
      text,
      ...(blocks ? { blocks } : {}),
    });
  }

  async getUserInfo(userId: string): Promise<any> {
    try {
      const result = await this.app.client.users.info({ user: userId });
      return result.user ?? {};
    } catch (e: any) {
      this.logger?.error(`getUserInfo error: ${e.message}`);
      return {};
    }
  }

  async registerEventHandlers(): Promise<void> {
    this.app.message(async ({ message, say: _say }) => {
      try {
        const msg = message as any;
        if (msg.subtype || msg.bot_id || !msg.text) return;

        const eventId: string = msg.event_ts ?? msg.ts;
        const userId: string = msg.user;
        const channel: string = msg.channel;
        const threadTs: string | undefined = msg.thread_ts;
        const ts: string = msg.ts;

        const query = (msg.text as string)
          .replace(/<@[A-Z0-9]+>/g, "")
          .trim();

        if (isEmptyContent(query)) return;

        const userInfo = await this.getUserInfo(userId);
        await this.onReceiveMessage(userId, userInfo, {
          eventId,
          sessionId: channel,
          ts,
          threadTs,
        }, query);
      } catch (e: any) {
        this.logger?.error(`Slack message handler error: ${e.stack}`);
      }
    });

    await this.app.start();
    this.logger?.info("Slack Socket Mode connected");
  }
}
