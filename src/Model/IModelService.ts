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
 * 绑定工具后的模型，支持流式调用
 */
export interface IBoundModel {
  stream(messages: BaseMessageLike[]): Promise<IterableReadableStream<AIMessageChunk>>;
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
   * 绑定工具并返回支持流式调用的 BoundModel
   */
  abstract bindTools(tools: any[]): IBoundModel;

  /**
   * 直接流式调用（不绑定工具）
   */
  abstract stream(messages: BaseMessageLike[]): Promise<IterableReadableStream<AIMessageChunk>>;
}
