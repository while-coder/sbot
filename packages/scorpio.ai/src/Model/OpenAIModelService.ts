import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, AIMessageChunk } from "langchain";
import { BaseMessageLike } from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { IModelService } from "./IModelService";
import { ModelConfig } from "./types";

/**
 * OpenAI 模型服务实现
 * 封装 @langchain/openai 的 ChatOpenAI
 */
export class OpenAIModelService implements IModelService {
  private model?: ChatOpenAI;

  constructor(private config: ModelConfig) {}

  async initialize(): Promise<void> {
    this.model = new ChatOpenAI({
      configuration: {
        baseURL: this.config.baseURL,
        apiKey: this.config.apiKey,
      },
      apiKey: this.config.apiKey,
      model: this.config.model,
      temperature: this.config.temperature,
      maxTokens: this.config.maxTokens,
    });
  }

  async dispose(): Promise<void> {
    this.model = undefined;
  }

  invoke(prompt: string | BaseMessageLike[]): Promise<AIMessage> {
    return this.model!.invoke(prompt);
  }

  bindTools(tools: any[]) {
    return this.model!.bindTools(tools);
  }

  withStructuredOutput<T extends Record<string, any>>(schema: any) {
    return this.model!.withStructuredOutput<T>(schema);
  }

  stream(messages: string | BaseMessageLike[]): Promise<IterableReadableStream<AIMessageChunk>> {
    return this.model!.stream(messages);
  }
}
