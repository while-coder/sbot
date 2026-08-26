import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessageChunk } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ChatMessage } from "./messages";
import { toBaseMessages, toChatMessage } from "./messageConverter";
import { type LLMInfo, getLLMInfo } from "./capabilities";

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
   * 显式能力声明，优先级高于 models.dev 目录自动判断（vision / toolCall 等，
   * 只配需要覆盖的字段）。自定义网关配目录里没有的模型时用它声明。
   */
  llmInfo?: Partial<LLMInfo>;
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
  /**
   * 模型能力与限制（vision / toolCall / contextWindow / maxOutputTokens /
   * temperature / reasoning / structuredOutput / cost）。同步、无网络延迟，
   * llmInfo 显式声明优先于 models.dev 目录，结果进程内缓存。
   */
  getLLMInfo(): LLMInfo;
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
    this.applyCatalogDefaults();
  }

  async dispose(): Promise<void> {
    this.model = undefined;
    this.boundModel = undefined;
    this.llmInfoCache = undefined;
  }

  protected prepareInput(input: string | ChatMessage[]): string | BaseMessage[] {
    return typeof input === "string" ? input : toBaseMessages(input);
  }

  private llmInfoCache?: LLMInfo;

  getLLMInfo(): LLMInfo {
    const override = { ...this.config.llmInfo };
    if (this.config.contextWindow != null) override.contextWindow = this.config.contextWindow;
    if (this.config.maxTokens != null) override.maxOutputTokens = this.config.maxTokens;
    return (this.llmInfoCache ??= getLLMInfo(this.config.model, this.config.provider, override));
  }

  /**
   * 用 models.dev 目录补全构造参数级默认值（temperature / maxTokens）。
   * temperature=false 的模型（部分推理模型）发送该参数会被拒，
   * maxTokens 未配置时 LangChain 默认值普遍偏小易截断。
   */
  private applyCatalogDefaults(): void {
    const info = this.getLLMInfo();
    if (!info.fromCatalog) return;
    const model = this.model as any;
    if (info.temperature === false) model.temperature = undefined;
    if (this.config.maxTokens == null && info.maxOutputTokens != null) model.maxTokens = info.maxOutputTokens;
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
