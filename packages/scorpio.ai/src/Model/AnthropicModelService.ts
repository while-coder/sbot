import { ChatAnthropic } from "@langchain/anthropic";
import { AIMessage, AIMessageChunk } from "langchain";
import { BaseMessageLike } from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { IModelService } from "./IModelService";
import { ModelConfig } from "./types";

/**
 * Anthropic 模型服务实现
 * 封装 @langchain/anthropic 的 ChatAnthropic（Claude 系列）
 */
export class AnthropicModelService implements IModelService {
  private model?: ChatAnthropic;

  constructor(private config: ModelConfig) {}

  async initialize(): Promise<void> {
    this.model = new ChatAnthropic({
      anthropicApiKey: this.config.apiKey,
      anthropicApiUrl: this.config.baseURL,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });
  }

  async dispose(): Promise<void> {
    this.model = undefined;
  }

  invoke(prompt: string | BaseMessageLike[]): Promise<AIMessage> {
    return this.model!.invoke(prompt) as Promise<AIMessage>;
  }

  bindTools(tools: any[]) {
    return this.model!.bindTools(tools) as any;
  }

  withStructuredOutput<T extends Record<string, any>>(schema: any) {
    return this.model!.withStructuredOutput<T>(schema) as any;
  }

  stream(messages: string | BaseMessageLike[]): Promise<IterableReadableStream<AIMessageChunk>> {
    return this.model!.stream(messages) as Promise<IterableReadableStream<AIMessageChunk>>;
  }

  getModel(): any {
    return this.model!;
  }
}
