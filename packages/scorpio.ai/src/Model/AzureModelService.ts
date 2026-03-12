import { AzureChatOpenAI } from "@langchain/openai";
import { AIMessage, AIMessageChunk } from "langchain";
import { BaseMessageLike } from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { IModelService } from "./IModelService";
import { ModelConfig } from "./types";

/**
 * Azure OpenAI 模型服务实现
 * 封装 @langchain/openai 的 AzureChatOpenAI
 */
export class AzureModelService implements IModelService {
  private model?: AzureChatOpenAI;

  constructor(private config: ModelConfig) {}

  async initialize(): Promise<void> {
    this.model = new AzureChatOpenAI({
      azureOpenAIApiDeploymentName: this.config.azureDeployment || this.config.model,
      azureOpenAIApiKey: this.config.apiKey,
      azureOpenAIBasePath: this.config.baseURL,
      azureOpenAIApiVersion: this.config.azureApiVersion || "2024-02-01",
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

  getModel(): BaseChatModel {
    return this.model!;
  }
}
