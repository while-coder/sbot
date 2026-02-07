import { ChatOpenAI } from "@langchain/openai";
import { AIMessage, AIMessageChunk } from "langchain";
import { BaseMessageLike } from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { Runnable } from "@langchain/core/runnables";
import { IModelService } from "./IModelService";
import { ModelConfig } from "../Config";

/**
 * OpenAI 模型服务实现
 * 封装 @langchain/openai 的 ChatOpenAI
 */
export class OpenAIModelService extends IModelService {
  private model!: ChatOpenAI;
  private boundModel?: Runnable;

  constructor(private config: ModelConfig) {
    super();
  }

  async initialize(): Promise<void> {
    this.model = new ChatOpenAI({
      configuration: {
        baseURL: this.config.baseURL,
        apiKey: this.config.apiKey,
      },
      apiKey: this.config.apiKey,
      model: this.config.model,
      temperature: this.config.temperature,
    });
  }

  async cleanup(): Promise<void> {
    (this as any).model = undefined;
    this.boundModel = undefined;
  }

  async invoke(prompt: string): Promise<AIMessage> {
    const target = this.boundModel ?? this.model;
    return await target.invoke(prompt);
  }

  bindTools(tools: any[]): void {
    this.boundModel = this.model.bindTools(tools);
  }

  async stream(messages: BaseMessageLike[]): Promise<IterableReadableStream<AIMessageChunk>> {
    const target = this.boundModel ?? this.model;
    return target.stream(messages);
  }
}
