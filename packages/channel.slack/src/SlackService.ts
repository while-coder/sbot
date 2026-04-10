import { App } from "@slack/bolt";
import { SlackActionArgs, SlackMessageArgs, SlackSessionHandler } from "./SlackSessionHandler";
import { IChannelService, ChannelSessionHandler, SessionService, type ILogger, type MessageContent } from "channel.base";

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
  onTriggerAction: (
    userId: string,
    args: SlackActionArgs,
  ) => Promise<void>;
}

export class SlackService implements IChannelService {
  private app: App;
  private logger?: ILogger;
  private onReceiveMessage: SlackServiceOptions["onReceiveMessage"];
  private onTriggerAction: SlackServiceOptions["onTriggerAction"];

  constructor(options: SlackServiceOptions) {
    this.logger = options.logger;
    this.onReceiveMessage = options.onReceiveMessage;
    this.onTriggerAction = options.onTriggerAction;

    this.app = new App({
      token: options.botToken,
      appToken: options.appToken,
      socketMode: true,
    });
  }

  createUserService(session: SessionService): ChannelSessionHandler {
    return new SlackSessionHandler(session, this);
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

        if (!query) return;

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

    this.app.action(/.*/, async ({ action, body, ack }) => {
      await ack();
      try {
        const act = action as any;
        const userId: string = (body as any).user?.id;
        const channel: string =
          (body as any).channel?.id ?? (body as any).container?.channel_id ?? "";
        const messageTs: string = (body as any).message?.ts ?? "";

        // Extract input block values from state (for Ask forms)
        const stateValues = (body as any).state?.values ?? {};
        const answers: Record<string, any> = {};
        for (const [blockId, blockState] of Object.entries(stateValues)) {
          const blockEntry = blockState as Record<string, any>;
          for (const [, elementState] of Object.entries(blockEntry)) {
            const el = elementState as any;
            if (el.type === "plain_text_input") {
              answers[blockId] = el.value;
            } else if (el.type === "static_select") {
              answers[blockId] = el.selected_option?.value;
            } else if (el.type === "multi_static_select") {
              answers[blockId] = el.selected_options?.map((o: any) => o.value) ?? [];
            }
          }
        }

        let value: any;
        try {
          value = act.value ? JSON.parse(act.value) : undefined;
        } catch {
          value = act.value;
        }

        if (value && act.action_id?.startsWith("ask_submit_")) {
          value.answers = answers;
        }

        await this.onTriggerAction(userId, {
          sessionId: channel,
          messageTs,
          actionId: act.action_id,
          value,
        });
      } catch (e: any) {
        this.logger?.error(`Slack action handler error: ${e.stack}`);
      }
    });

    await this.app.start();
    this.logger?.info("Slack Socket Mode connected");
  }
}
