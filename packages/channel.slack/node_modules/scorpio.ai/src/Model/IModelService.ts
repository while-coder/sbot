import { AIMessage, AIMessageChunk } from "langchain";
import { BaseMessageLike } from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";
import { Runnable } from "@langchain/core/runnables";
import { BaseLanguageModelInput, BaseLanguageModelCallOptions } from "@langchain/core/language_models/base";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { InteropZodType } from "@langchain/core/utils/types";
import { SerializableSchema } from "@langchain/core/utils/standard_schema";

/**
 * 模型服务接口
 * 定义模型服务的标准接口
 */
export interface IModelService {
  /**
   * 简单文本调用 — 发送 prompt 字符串，返回 AI 消息
   */
  invoke(prompt: string | BaseMessageLike[]): Promise<AIMessage>;

  /**
   * 绑定工具到模型，返回绑定后的 Runnable
   */
  bindTools(tools: any[]): Runnable<BaseLanguageModelInput, AIMessageChunk, BaseLanguageModelCallOptions>;

  /**
   * 结构化输出 — 绑定 schema，返回可 invoke 的 Runnable
   */
  withStructuredOutput<RunOutput extends Record<string, any> = Record<string, any>>(outputSchema: InteropZodType<RunOutput> | SerializableSchema<RunOutput> | Record<string, any>): Runnable<BaseLanguageModelInput, RunOutput>;

  /**
   * 流式调用（如果已绑定工具，则使用绑定后的模型）
   */
  stream(messages: string | BaseMessageLike[]): Promise<IterableReadableStream<AIMessageChunk>>;

  /**
   * 返回底层 BaseChatModel 实例，供 LangChain createAgent 等原生 API 使用
   */
  getModel(): BaseChatModel;

  /**
   * 清理资源 — 释放模型实例占用的资源
   */
  dispose(): Promise<void>;
}

/**
 * IModelService 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 *
 * @example
 * ```ts
 * // 注册实现
 * container.registerInstance(IModelService, modelInstance);
 *
 * // 注入依赖（推荐）
 * @inject(IModelService) private modelService: IModelService
 *
 * // 使用命名参数注册（不需要 as any！）
 * container.registerWithArgs(MyService, {
 *   [IModelService]: modelInstance
 * });
 * ```
 */
export const IModelService = Symbol("IModelService");
