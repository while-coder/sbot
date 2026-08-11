import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { AIMessageChunk } from "@langchain/core/messages";
import type { StructuredToolInterface } from "@langchain/core/tools";
import type { ChatMessage } from "./messages";
import { toBaseMessages, toChatMessage } from "./messageConverter";

export enum ModelProvider {
  OpenAI = "openai",
  OpenAIResponse = "openai-response",
  Anthropic = "anthropic",
  Ollama = "ollama",
  Gemini = "gemini",
  GeminiImage = "gemini-image",
}

export interface ThinkingConfig {
  type: "adaptive" | "enabled" | "disabled";
  budget_tokens?: number;
}

export interface AnthropicConfig {
  thinking?: ThinkingConfig;
  promptCaching?: boolean;
}

export interface GeminiConfig {
  apiVersion?: string;
}

export interface ModelConfig {
  provider: ModelProvider;
  apiKey: string;
  baseURL: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  contextWindow?: number;
  maxTools?: number;
  anthropic?: AnthropicConfig;
  gemini?: GeminiConfig;
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
