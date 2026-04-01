import { ChatOllama } from "@langchain/ollama";
import { AIMessage, AIMessageChunk } from "langchain";
import { BaseMessageLike } from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { IModelService } from "./IModelService";
import { ModelConfig } from "./types";

/**
 * Ollama 模型服务实现
 * 封装 @langchain/ollama 的 ChatOllama，支持本地部署模型
 */
export class OllamaModelService implements IModelService {
  private model?: ChatOllama;

  constructor(private config: ModelConfig) {}

  async initialize(): Promise<void> {
    this.model = new ChatOllama({
      baseUrl: this.config.baseURL ?? "http://localhost:11434",
      model: this.config.model,
      temperature: this.config.temperature,
      numPredict: this.config.maxTokens,
    });
  }

  async dispose(): Promise<void> {
    this.model = undefined;
  }

  invoke(prompt: string | BaseMessageLike[]): Promise<AIMessage> {
    return this.model!.invoke(prompt);
  }

  bindTools(tools: any[]) {
    return this.model!.bindTools(tools) as any;
  }

  withStructuredOutput<T extends Record<string, any>>(schema: any) {
    return this.model!.withStructuredOutput<T>(schema) as any;
  }

  stream(messages: string | BaseMessageLike[]): Promise<IterableReadableStream<AIMessageChunk>> {
    return this.model!.stream(messages);
  }

  getModel(): any {
    return this.model!;
  }
}
