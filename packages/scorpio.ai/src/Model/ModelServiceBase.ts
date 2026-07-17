import { AIMessageChunk, type BaseMessage } from "@langchain/core/messages";
import { type BaseChatModel } from "@langchain/core/language_models/chat_models";
import { type StructuredToolInterface } from "@langchain/core/tools";
import { type ChatMessage } from "../Saver/IAgentSaverService";
import { toChatMessage, toBaseMessages } from "../Saver/messageConverter";
import { ModelConfig } from "./types";
import { type IModelService, type ModelInvokeOptions, type StructuredInvokeOptions } from "./IModelService";

/**
 * LangChain ChatModel 的公共实现基类。
 *
 * 统一模型生命周期、消息转换、默认工具绑定和流式 chunk 累积；provider 特有的
 * 初始化参数、结构化输出和兼容逻辑留在子类。
 */
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

  abstract invokeStructured<T = any>(
    schema: any,
    prompt: string | ChatMessage[],
    options?: StructuredInvokeOptions,
  ): Promise<T>;

  async stream(messages: string | ChatMessage[], options?: ModelInvokeOptions): Promise<AsyncIterable<ChatMessage>> {
    const lcStream = await this.activeModel.stream(
      this.prepareInput(messages),
      options?.signal ? { signal: options.signal } : undefined,
    );
    return (async function* () {
      let accumulated: AIMessageChunk | undefined;
      for await (const chunk of lcStream) {
        accumulated = accumulated ? accumulated.concat(chunk) : (chunk as AIMessageChunk);
        yield toChatMessage(accumulated!);
      }
    })();
  }
}
