import { type ChatMessage } from "../Saver/IAgentSaverService";

/**
 * 模型服务接口
 * 定义模型服务的标准接口，不依赖任何 LLM 框架类型
 */
export interface IModelService {
  /**
   * 简单文本调用 — 发送 prompt 字符串或消息列表，返回 AI 消息
   */
  invoke(prompt: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<ChatMessage>;

  /**
   * 绑定工具到模型（有状态）
   * 调用后 stream / invoke 自动使用绑定的工具，无需切换实例
   */
  bindTools(tools: any[]): void;

  /**
   * 结构化输出调用 — 使用给定 schema 对模型输出进行结构化解析
   */
  invokeStructured<T = any>(schema: any, prompt: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<T>;

  /**
   * 流式调用，返回逐步累积的消息块序列
   */
  stream(messages: string | ChatMessage[], options?: { signal?: AbortSignal }): Promise<AsyncIterable<ChatMessage>>;

  /**
   * 模型上下文窗口大小（token 数），用于历史消息截断
   */
  readonly contextWindow?: number;

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
