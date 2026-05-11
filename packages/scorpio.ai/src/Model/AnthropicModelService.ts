import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessageChunk, BaseMessage, SystemMessage, HumanMessage } from "@langchain/core/messages";
import { IModelService } from "./IModelService";
import { ModelConfig } from "./types";
import { type ChatMessage } from "../Saver/IAgentSaverService";
import { toChatMessage, toBaseMessages } from "../Saver/messageConverter";

/**
 * Anthropic 模型服务实现
 * 封装 @langchain/anthropic 的 ChatAnthropic（Claude 系列）
 */
export class AnthropicModelService implements IModelService {
  private model?: ChatAnthropic;
  private boundModel?: any;
  private cacheControl?: { type: "ephemeral" };

  constructor(private config: ModelConfig) {
    if (config.anthropic?.promptCaching) {
      console.log("-----------------------------------------")
      this.cacheControl = { type: "ephemeral" };
    }
  }

  get contextWindow(): number | undefined { return this.config.contextWindow; }

  async initialize(): Promise<void> {
    this.model = new ChatAnthropic({
      anthropicApiKey: this.config.apiKey,
      anthropicApiUrl: this.config.baseURL,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
      ...(this.config.anthropic?.thinking && { thinking: this.config.anthropic.thinking as any }),
    });
  }

  async dispose(): Promise<void> {
    this.model = undefined;
    this.boundModel = undefined;
  }

  async invoke(prompt: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<ChatMessage> {
    const m = this.boundModel ?? this.model!;
    const input = typeof prompt === 'string' ? prompt : this.applyCache(toBaseMessages(prompt));
    const result = await m.invoke(input, {
      ...(options?.signal && { signal: options.signal }),
    });
    return toChatMessage(result);
  }

  bindTools(tools: any[]): void {
    this.boundModel = this.model!.bindTools(tools);
  }

  async invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<T> {
    const input = typeof prompt === 'string' ? prompt : toBaseMessages(prompt);
    return this.model!.withStructuredOutput(schema).invoke(input, options?.signal ? { signal: options.signal } : undefined) as Promise<T>;
  }

  async stream(messages: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<AsyncIterable<ChatMessage>> {
    const m = this.boundModel ?? this.model!;
    const input = typeof messages === 'string' ? messages : this.applyCache(toBaseMessages(messages));
    const lcStream = await m.stream(input, {
      ...(options?.signal && { signal: options.signal }),
    });
    return (async function* () {
      let accumulated: AIMessageChunk | undefined;
      for await (const chunk of lcStream) {
        accumulated = accumulated
          ? accumulated.concat(chunk as AIMessageChunk)
          : (chunk as AIMessageChunk);
        yield toChatMessage(accumulated);
      }
    })();
  }

  getModel(): any {
    return this.model!;
  }

  private applyCache(messages: BaseMessage[]): BaseMessage[] {
    if (!this.cacheControl) return messages;

    for (const msg of messages) {
      if (msg instanceof SystemMessage) {
        this.addCacheMarker(msg);
        break;
      }
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i] instanceof HumanMessage) {
        this.addCacheMarker(messages[i]);
        break;
      }
    }

    return messages;
  }

  private addCacheMarker(message: BaseMessage): void {
    const content = message.content;
    if (typeof content === 'string') {
      message.content = [{ type: "text", text: content, cache_control: this.cacheControl }];
    } else if (Array.isArray(content) && content.length > 0) {
      const last = content[content.length - 1];
      content[content.length - 1] = { ...last, cache_control: this.cacheControl };
    }
  }
}
