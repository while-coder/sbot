import { AIMessageChunk } from "langchain";
import { BaseMessageLike } from "@langchain/core/messages";
import { IterableReadableStream } from "@langchain/core/utils/stream";

/**
 * 模型调用结果
 */
export interface ModelInvokeResult {
  content: string;
}

/**
 * 模型服务抽象基类
 * 作为 DI 注入 token 使用（abstract class 可作为 token，interface 不行）
 */
export abstract class IModelService {
  /**
   * 简单文本调用 — 发送 prompt 字符串，返回文本结果
   */
  abstract invoke(prompt: string): Promise<ModelInvokeResult>;

  /**
   * 绑定工具到模型（内部保存，后续 stream 调用时自动使用）
   */
  abstract bindTools(tools: any[]): void;

  /**
   * 流式调用（如果已绑定工具，则使用绑定后的模型）
   */
  abstract stream(messages: BaseMessageLike[]): Promise<IterableReadableStream<AIMessageChunk>>;
}
