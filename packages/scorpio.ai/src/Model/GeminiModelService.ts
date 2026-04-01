import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { AIMessage, AIMessageChunk } from "langchain";
import { BaseMessageLike } from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { IModelService } from "./IModelService";
import { ModelConfig } from "./types";

/**
 * Google Gemini 模型服务实现
 * 封装 @langchain/google-genai 的 ChatGoogleGenerativeAI
 */
export class GeminiModelService implements IModelService {
  private model?: ChatGoogleGenerativeAI;

  constructor(private config: ModelConfig) {}

  async initialize(): Promise<void> {
    this.model = new ChatGoogleGenerativeAI({
      apiKey: this.config.apiKey,
      model: this.config.model,
      apiVersion: this.config.apiVersion ?? 'v1',
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxTokens,
    } as any);
  }

  async dispose(): Promise<void> {
    this.model = undefined;
  }

  invoke(prompt: string | BaseMessageLike[]): Promise<AIMessage> {
    return (this.model as any).invoke(prompt) as Promise<AIMessage>;
  }

  bindTools(tools: any[]) {
    return (this.model as any).bindTools(tools);
  }

  withStructuredOutput(schema: any) {
    return (this.model as any).withStructuredOutput(schema);
  }

  stream(messages: string | BaseMessageLike[]): Promise<IterableReadableStream<AIMessageChunk>> {
    return (this.model as any).stream(messages) as Promise<IterableReadableStream<AIMessageChunk>>;
  }

  getModel(): any {
    return this.model!;
  }
}