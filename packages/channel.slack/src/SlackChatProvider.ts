import { SlackService } from "./SlackService";
import { AbstractChatProvider, parseMessages2Text, GlobalLoggerService } from "channel.base";

const getLogger = () => GlobalLoggerService.getLogger("SlackChatProvider.ts");

export class SlackChatProvider extends AbstractChatProvider {
  private channel: string = "";
  private ts: string = "";
  private approvalBlocks: any[] | undefined;
  private askBlocks: any[] | undefined;

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

  setApprovalBlocks(blocks: any[]): void {
    this.approvalBlocks = blocks;
    this.flushUpdate();
  }

  clearApprovalBlocks(): void {
    this.approvalBlocks = undefined;
    this.flushUpdate();
  }

  setAskBlocks(blocks: any[]): void {
    this.askBlocks = blocks;
    this.flushUpdate();
  }

  clearAskBlocks(): void {
    this.askBlocks = undefined;
    this.flushUpdate();
  }

  protected onMessagesUpdated(): void {
    this.flushUpdate();
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

  private flushUpdate(): void {
    try {
      if (!this.channel || !this.ts) return;
      const msgs = this.getDisplayMessages();
      const text = parseMessages2Text(msgs);
      const blocks = this.buildBlocks(text);
      this.slackService.updateMessage(this.channel, this.ts, text, blocks);
    } catch (e: any) {
      getLogger()?.error(`flushUpdate exception: ${e.message || e}`, e.stack);
    }
  }
}
