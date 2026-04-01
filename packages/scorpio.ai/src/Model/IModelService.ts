import { type ChatMessage } from "../Saver/IAgentSaverService";

/**
 * 模型服务接口
 * 定义模型服务的标准接口，不依赖任何 LLM 框架类型
 */
export interface IModelService {
  /**
   * 简单文本调用 — 发送 prompt 字符串或消息列表，返回 AI 消息
   */
  invoke(prompt: string | ChatMessage[]): Promise<ChatMessage>;

  /**
   * 绑定工具到模型，返回绑定后的 Runnable
   */
  bindTools(tools: any[]): any;

  /**
   * 结构化输出 — 绑定 schema，返回可 invoke 的 Runnable
   */
  withStructuredOutput<T extends Record<string, any> = Record<string, any>>(schema: any): any;

  /**
   * 流式调用，返回逐步累积的消息块序列
   */
  stream(messages: string | ChatMessage[]): Promise<AsyncIterable<ChatMessage>>;

  /**
   * 返回底层模型实例，供 LangChain createAgent 等原生 API 使用
   */
  getModel(): any;

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
