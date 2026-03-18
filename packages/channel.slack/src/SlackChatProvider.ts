import { SlackService } from "./SlackService";
import { AgentMessage, GlobalLoggerService, MessageChunkType } from "scorpio.ai";
import { parseMessages2Text, ProviderMessage, ProviderMessageType, ProviderTextMessage, ProviderToolMessage } from "channel.base";

const getLogger = () => GlobalLoggerService.getLogger("SlackChatProvider.ts");

const UPDATE_INTERVAL_MS = 300;

export class SlackChatProvider {
  private channel: string = "";
  private ts: string = "";
  private messages: ProviderMessage[] = [];
  private streamMessage: ProviderTextMessage | undefined;
  private tools: Record<string, ProviderToolMessage> = {};
  private approvalBlocks: any[] | undefined;
  private askBlocks: any[] | undefined;
  private lastUpdateTime = 0;

  constructor(private slackService: SlackService) {}

  async init(
    channel: string,
    incomingTs: string,
    threadTs: string | undefined,
    query?: string,
  ): Promise<this> {
    const initialText = query
      ? `${query}\nThinking...`
      : `Processing...`;
    const replyThreadTs = threadTs ?? incomingTs;
    const sent = await this.slackService.sendMessage(channel, initialText, replyThreadTs);
    this.channel = sent.channel;
    this.ts = sent.ts;
    return this;
  }

  async addAIMessage(message: AgentMessage): Promise<void> {
    if (message.type === MessageChunkType.AI) {
      if (message.content) {
        this.messages.push({ type: ProviderMessageType.TEXT, content: message.content });
      }
      if (message.tool_calls?.length) {
        for (const t of message.tool_calls) {
          const toolMsg: ProviderToolMessage = {
            type: ProviderMessageType.TOOL,
            name: t.name,
            args: t.args,
          };
          if (t.id) this.tools[t.id] = toolMsg;
          this.messages.push(toolMsg);
        }
      }
    } else if (message.type === MessageChunkType.TOOL) {
      const toolMsg = this.tools[message.tool_call_id || ""];
      if (toolMsg) {
        toolMsg.result = true;
        toolMsg.status = message.status;
        toolMsg.response = message.content || "";
      }
    } else if (message.type === MessageChunkType.COMMAND) {
      this.messages.push({ type: ProviderMessageType.TEXT, content: message.content || "" });
    }
    await this.flushUpdate();
  }

  async setMessage(content: string): Promise<void> {
    this.messages = [{ type: ProviderMessageType.TEXT, content }];
    await this.flushUpdate();
  }

  async setStreamMessage(content: string): Promise<void> {
    this.streamMessage = { type: ProviderMessageType.TEXT, content };
    await this.throttledUpdate();
  }

  resetStreamMessage(): void {
    this.streamMessage = undefined;
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
    let msgs = this.messages;
    if (this.streamMessage) {
      msgs = [...this.messages, this.streamMessage];
    }
    const text = parseMessages2Text(msgs);
    const blocks = this.buildBlocks(text);
    try {
      await this.slackService.updateMessage(this.channel, this.ts, text, blocks);
    } catch (e: any) {
      getLogger()?.error(`updateMessage error: ${e.message}`, e.stack);
    }
  }
}
