/**
 * Embedding 服务接口
 * 提供文本向量化功能
 */
export interface IEmbeddingService {
  /**
   * 为单个文本生成 embedding
   * @param text 输入文本
   * @returns embedding 向量
   */
  embedQuery(text: string): Promise<number[]>;

  /**
   * 批量为多个文档生成 embedding
   * @param documents 文档文本数组
   * @returns 每个文档对应的 embedding 向量数组
   */
  embedDocuments(documents: string[]): Promise<number[][]>;

  /**
   * 初始化服务
   */
  initialize(): Promise<void>;

  /**
   * 清理资源 — 释放实例占用的资源
   */
  cleanup(): Promise<void>;
}

/**
 * IEmbeddingService 的依赖注入 token
 * 使用 Symbol 确保唯一性，避免命名冲突
 */
export const IEmbeddingService = Symbol("IEmbeddingService");
