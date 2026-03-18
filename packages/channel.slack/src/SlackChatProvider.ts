import { SlackService } from "./SlackService";
import {
  AgentMessage,
  GlobalLoggerService,
  isMCPToolResult,
  MCPContentType,
  MCPToolResult,
  MessageChunkType,
  parseJson,
} from "scorpio.ai";

const getLogger = () => GlobalLoggerService.getLogger("SlackChatProvider.ts");

const UPDATE_INTERVAL_MS = 300;

enum ProviderMessageType {
  TEXT = "text",
  TOOL = "tool",
}

type ProviderTextMessage = { type: ProviderMessageType.TEXT; content: string };
type ProviderToolMessage = {
  type: ProviderMessageType.TOOL;
  name: string;
  args: Record<string, any>;
  result?: boolean;
  status?: string;
  response?: string;
};
type ProviderMessage = ProviderTextMessage | ProviderToolMessage;

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
      ? `${query}\n思考中... / Thinking...`
      : `开始处理...`;
    const replyThreadTs = threadTs ?? incomingTs;
    const sent = await this.slackService.sendMessage(channel, initialText, replyThreadTs);
    this.channel = sent.channel;
    this.ts = sent.ts;
    return this;
  }

  private parseMessages2Text(messages: ProviderMessage[]): string {
    const parts: string[] = [];
    for (const msg of messages) {
      if (msg.type === ProviderMessageType.TEXT) {
        parts.push(msg.content);
      } else {
        let block = `\`\`\`\n调用: ${msg.name}\n参数:\n${JSON.stringify(msg.args, null, 2)}`;
        if (msg.result) {
          let escapedResponse = "";
          const parsed = parseJson<MCPToolResult>(msg.response!, undefined);
          if (isMCPToolResult(parsed)) {
            const contentParts: string[] = [];
            for (const c of parsed.content) {
              if (c.type === MCPContentType.Text) {
                contentParts.push(`------${c.type}------\n${c.text}`);
              } else if (c.type === MCPContentType.Image) {
                contentParts.push(`------${c.type}------\n[image:${c.mimeType}]`);
              } else {
                contentParts.push(`------${c.type}------\n${JSON.stringify(c)}`);
              }
            }
            escapedResponse = contentParts.join("\n");
          } else {
            escapedResponse = String(parsed);
          }
          escapedResponse = escapedResponse.replace(/`/g, "\\`");
          block += `\n返回值:\n${escapedResponse}`;
        } else {
          block += `\n执行中...`;
        }
        block += `\n\`\`\`\n---`;
        parts.push(block);
      }
    }
    return parts.join("\n\n");
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
    const text = this.parseMessages2Text(msgs);
    const blocks = this.buildBlocks(text);
    try {
      await this.slackService.updateMessage(this.channel, this.ts, text, blocks);
    } catch (e: any) {
      getLogger()?.error(`updateMessage error: ${e.message}`, e.stack);
    }
  }
}
