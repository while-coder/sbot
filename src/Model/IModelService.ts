import { AIMessage, AIMessageChunk } from "langchain";
import { BaseMessageLike } from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";

/**
 * 模型服务抽象基类
 * 作为 DI 注入 token 使用（abstract class 可作为 token，interface 不行）
 */
export abstract class IModelService {
  /**
   * 简单文本调用 — 发送 prompt 字符串，返回 AI 消息
   */
  abstract invoke(prompt: string): Promise<AIMessage>;

  /**
   * 绑定工具到模型（内部保存，后续 stream 调用时自动使用）
   */
  abstract bindTools(tools: any[]): void;

  /**
   * 流式调用（如果已绑定工具，则使用绑定后的模型）
   */
  abstract stream(messages: BaseMessageLike[]): Promise<IterableReadableStream<AIMessageChunk>>;

  /**
   * 清理资源 — 释放模型实例占用的资源
   */
  abstract cleanup(): Promise<void>;
}
