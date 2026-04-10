import { SlackService } from "./SlackService";
import { AbstractChatProvider, parseMessages2Text, GlobalLoggerService, type ChatMessage } from "channel.base";

const getLogger = () => GlobalLoggerService.getLogger("SlackChatProvider.ts");

const UPDATE_INTERVAL_MS = 300;

export class SlackChatProvider extends AbstractChatProvider {
  private channel: string = "";
  private ts: string = "";
  private approvalBlocks: any[] | undefined;
  private askBlocks: any[] | undefined;
  private lastUpdateTime = 0;

  constructor(private slackService: SlackService) {
    super();
  }

  async init(
    channel: string,
    incomingTs: string,
    threadTs: string | undefined,
  ): Promise<this> {
    const replyThreadTs = threadTs ?? incomingTs;
    const sent = await this.slackService.sendMessage(channel, `Processing...`, replyThreadTs);
    this.channel = sent.channel;
    this.ts = sent.ts;
    return this;
  }

  async setStreamMessage(message: ChatMessage): Promise<void> {
    this.streamMessage = message;
    await this.throttledUpdate();
  }

  async setApprovalBlocks(blocks: any[]): Promise<void> {
    this.approvalBlocks = blocks;
    await this.flushUpdate();
  }

  async clearApprovalBlocks(): Promise<void> {
    this.approvalBlocks = undefined;
    await this.flushUpdate();
  }

  async setAskBlocks(blocks: any[]): Promise<void> {
    this.askBlocks = blocks;
    await this.flushUpdate();
  }

  async clearAskBlocks(): Promise<void> {
    this.askBlocks = undefined;
    await this.flushUpdate();
  }

  protected async onMessagesUpdated(): Promise<void> {
    await this.flushUpdate();
  }

  private buildBlocks(text: string): any[] {
    const blocks: any[] = [
      {
        type: "section",
        text: { type: "mrkdwn", text: text || "…" },
      },
    ];
    if (this.approvalBlocks) blocks.push(...this.approvalBlocks);
    if (this.askBlocks) blocks.push(...this.askBlocks);
    return blocks;
  }

  private async throttledUpdate(): Promise<void> {
    const now = Date.now();
    if (now - this.lastUpdateTime < UPDATE_INTERVAL_MS) return;
    await this.flushUpdate();
  }

  private async flushUpdate(): Promise<void> {
    if (!this.channel || !this.ts) return;
    this.lastUpdateTime = Date.now();
    const msgs = this.getDisplayMessages();
    const text = parseMessages2Text(msgs);
    const blocks = this.buildBlocks(text);
    try {
      await this.slackService.updateMessage(this.channel, this.ts, text, blocks);
    } catch (e: any) {
      getLogger()?.error(`updateMessage error: ${e.message}`, e.stack);
    }
  }
}
