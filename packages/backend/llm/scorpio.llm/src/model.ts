import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessageChunk } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ChatMessage } from "./messages";
import { toBaseMessages, toChatMessage } from "./messageConverter";
import { resolveVisionSupport } from "./capabilities";

export enum ModelProvider {
  OpenAI = "openai",
  OpenAIResponse = "openai-response",
  Anthropic = "anthropic",
  Ollama = "ollama",
  Gemini = "gemini",
  GeminiImage = "gemini-image",
}

export interface ModelConfig {
  provider: ModelProvider | string;
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  maxTools?: number;
  /**
   * 显式声明模型是否支持图片输入，优先级高于 models.dev 目录与保守默认（false）。
   * 自定义网关配目录里没有的模型时用它声明；不配则按模型名查目录，查不到按不支持处理。
   */
  vision?: boolean;
  /** Provider 私有参数，由对应 provider 的 configSchema 定义。 */
  config?: Record<string, any>;
}

export interface ModelInvokeOptions {
  signal?: AbortSignal;
}

export interface StructuredInvokeOptions extends ModelInvokeOptions {
  strict?: boolean;
}

export interface IModelService {
  readonly config: ModelConfig;
  invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage>;
  bindTools(tools: any[]): void;
  invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: StructuredInvokeOptions): Promise<T>;
  stream(messages: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>>;
  /** 模型是否支持图片输入（显式配置 > models.dev 目录 > 保守默认 false），结果进程内缓存。 */
  supportsVision(): Promise<boolean>;
  dispose(): Promise<void>;
}

export const IModelService = Symbol("IModelService");

export abstract class ModelServiceBase<TModel extends BaseChatModel = BaseChatModel> implements IModelService {
  protected model?: TModel;
  protected boundModel?: any;

  constructor(public readonly config: ModelConfig) {}

  protected abstract createModel(): TModel;

  initialize(): void {
    this.model = this.createModel();
  }

  async dispose(): Promise<void> {
    this.model = undefined;
    this.boundModel = undefined;
  }

  protected prepareInput(input: string | ChatMessage[]): string | BaseMessage[] {
    return typeof input === "string" ? input : toBaseMessages(input);
  }

  private visionSupport?: Promise<boolean>;

  async supportsVision(): Promise<boolean> {
    this.visionSupport ??= resolveVisionSupport(this.config);
    return this.visionSupport;
  }

  protected get activeModel(): any {
    if (!this.model) throw new Error(`${this.constructor.name} is not initialized`);
    return this.boundModel ?? this.model;
  }

  async invoke(prompt: string | ChatMessage[], options?: ModelInvokeOptions): Promise<ChatMessage> {
    const result = await this.activeModel.invoke(
      this.prepareInput(prompt),
      options?.signal ? { signal: options.signal } : undefined,
    );
    return toChatMessage(result);
  }

  bindTools(tools: StructuredToolInterface[]): void {
    if (!this.model) throw new Error(`${this.constructor.name} is not initialized`);
    if (!this.model.bindTools) throw new Error(`${this.constructor.name} does not support tools`);
    this.boundModel = this.model.bindTools(tools);
  }

  abstract invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: StructuredInvokeOptions): Promise<T>;

  async stream(messages: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
    const lcStream = await this.activeModel.stream(
      this.prepareInput(messages),
      options?.signal ? { signal: options.signal } : undefined,
    );
    return (async function* () {
      let accumulated: AIMessageChunk | undefined;
      for await (const chunk of lcStream) {
        accumulated = accumulated ? accumulated.concat(chunk) : (chunk as AIMessageChunk);
        yield toChatMessage(accumulated);
      }
    })();
  }
}
