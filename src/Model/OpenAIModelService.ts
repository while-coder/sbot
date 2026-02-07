import { ChatOpenAI } from "@langchain/openai";
import { AIMessageChunk } from "langchain";
import { BaseMessageLike } from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { Runnable } from "@langchain/core/runnables";
import { IModelService, ModelInvokeResult } from "./IModelService";
import { singleton, init, dispose } from "../Core";
import { LoggerService } from "../LoggerService";

const logger = LoggerService.getLogger("OpenAIModelService");

/**
 * 模型服务配置
 */
export interface ModelServiceConfig {
  apiKey: string;
  baseURL?: string;
  model?: string;
  temperature?: number;
  defaultHeaders?: Record<string, string>;
}

/**
 * OpenAI 模型服务实现
 * 封装 @langchain/openai 的 ChatOpenAI
 */
@singleton()
export class OpenAIModelService extends IModelService {
  private model!: ChatOpenAI;
  private boundModel?: Runnable;

  constructor(private config: ModelServiceConfig) {
    super();
  }

  @init()
  async initialize(): Promise<void> {
    this.model = new ChatOpenAI({
      configuration: {
        baseURL: this.config.baseURL || "https://api.openai.com/v1",
        apiKey: this.config.apiKey,
        defaultHeaders: this.config.defaultHeaders,
      },
      apiKey: this.config.apiKey,
      model: this.config.model || "gpt-3.5-turbo",
      temperature: this.config.temperature,
    });
    logger.info("OpenAIModelService 已初始化");
  }

  @dispose()
  async cleanup(): Promise<void> {
    (this as any).model = undefined;
    this.boundModel = undefined;
    logger.info("OpenAIModelService 已释放");
  }

  async invoke(prompt: string): Promise<ModelInvokeResult> {
    const response = await this.model.invoke(prompt);
    return { content: response.content as string };
  }

  bindTools(tools: any[]): void {
    this.boundModel = this.model.bindTools(tools);
  }

  async stream(messages: BaseMessageLike[]): Promise<IterableReadableStream<AIMessageChunk>> {
    const target = this.boundModel ?? this.model;
    return target.stream(messages);
  }
}
